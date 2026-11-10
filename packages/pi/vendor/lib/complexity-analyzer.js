#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { resolveCategory } = require('./toolchain/config');
const { loadAdapter } = require('./toolchain/adapters');
const { detectAdapter } = require('./toolchain/detect');
// `./toolchain/runner` is required LAZILY, inside `loadBead` below, not here: `runner.js`
// itself requires `../complexity-analyzer` at its own top level (for `redactSecrets`), so a
// require here would be circular -- whichever of the two modules loads first would see the
// OTHER'S `module.exports` only partially populated (verified empirically: a top-level
// require here makes `redactSecrets` resolve to `undefined` inside `runner.js` whenever this
// file is require()'d before `runner.js` is, which is the common case, e.g.
// `complexity-analyzer.test.js` requires this file directly). A lazy require inside a
// function body runs long after both modules have finished their own top-level execution, so
// the cycle never observes a half-initialized `module.exports` on either side.

const ROUTES = ['simple', 'medium', 'complex'];
const SECRET_PATTERNS = [
  { name: 'aws-access-key', pattern: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: 'github-token', pattern: /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g },
  { name: 'bearer-token', pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}\b/gi },
  { name: 'key-value-secret', pattern: /\b[A-Za-z0-9_-]*(?:api[_-]?key|token|secret|password)[A-Za-z0-9_-]*\s*[:=]\s*['\"]?[^\s'\"]{8,}/gi },
];

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function redactSecrets(text = '') {
  let redacted = String(text || '');
  const redactions = [];
  for (const { name, pattern } of SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, match => {
      redactions.push({ type: name, length: match.length });
      return `[REDACTED:${name}]`;
    });
  }
  return { text: redacted, redactions };
}

function parseArgs(argv = process.argv.slice(2), env = process.env) {
  const opts = { foreman: false, noAdaptivePlanning: false, json: false, args: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === 'analyze') continue;
    if (arg === '--json') opts.json = true;
    else if (arg === '--foreman') opts.foreman = true;
    else if (arg === '--no-adaptive-planning') opts.noAdaptivePlanning = true;
    else if (arg === '--route') opts.route = argv[++i];
    else if (arg === '--bead') opts.beadId = argv[++i];
    else if (arg.startsWith('--bead=')) opts.beadId = arg.slice('--bead='.length);
    else if (arg.startsWith('--route=')) opts.route = arg.slice('--route='.length);
    else if (arg === '--description') opts.args.push(argv[++i] || '');
    else opts.args.push(arg);
  }
  if (env.FOREMAN_WORKTREE === '1') opts.foreman = opts.foreman || argv.includes('--foreman');
  opts.description = opts.args.join(' ').trim();
  return opts;
}

function normalizeInput(opts = {}, env = process.env) {
  const argDescription = String(opts.description || '').trim();
  const foremanTitle = String(env.FOREMAN_TASK_TITLE || '').trim();
  const foremanDescription = String(env.FOREMAN_TASK_DESCRIPTION || '').trim();

  if (opts.foreman) {
    const subject = foremanTitle || argDescription;
    const description = foremanDescription || argDescription || foremanTitle;
    if (!subject && !description) {
      return { ok: false, error: 'ERROR: Missing work description: provide arguments or FOREMAN_TASK_TITLE/FOREMAN_TASK_DESCRIPTION. No route side effects performed.' };
    }
    return {
      ok: true,
      mode: 'foreman',
      source: foremanTitle ? 'foreman' : 'args',
      subject,
      description,
      originalSubject: subject,
      originalDescription: description,
      foreman: { title: foremanTitle, description: foremanDescription },
    };
  }

  const bead = opts.bead && typeof opts.bead === 'object' ? opts.bead : null;
  if (bead) {
    // A bead supplies its own title and description. Argument text, if any, is
    // appended rather than discarded: it is usually the user's gloss on the bead.
    const title = String(bead.title || '').trim();
    const description = [String(bead.description || '').trim(), argDescription].filter(Boolean).join('\n');
    if (!title && !description) {
      return { ok: false, error: `ERROR: Bead ${bead.id || '(unknown)'} has no title or description. No route side effects performed.` };
    }
    return {
      ok: true,
      mode: 'interactive',
      source: 'bead',
      subject: title || description,
      description: description || title,
      originalSubject: title || description,
      originalDescription: description || title,
      bead: { id: bead.id || null },
    };
  }

  if (!argDescription) {
    return { ok: false, error: 'ERROR: Missing work description: pass a work description or --bead <id>. No route side effects performed.' };
  }
  return {
    ok: true,
    mode: 'interactive',
    source: 'args',
    subject: argDescription,
    description: argDescription,
    originalSubject: argDescription,
    originalDescription: argDescription,
  };
}

function dimension(score, label, evidence = []) {
  return { score: clamp(score, 0, 3), label, evidence: unique(evidence) };
}

function scoreScopeSize(text) {
  const evidence = [];
  let score = 0;
  // Narrow-scope markers carry no SCORE — small work should score low — but they do
  // carry EVIDENCE, and that distinction is what separates "this is recognisably
  // small" from "nothing was recognised at all". Without the second list, "Fix a
  // typo in the README" produces zero evidence for the same reason "Rework how we
  // handle customers" does, and anything keyed on absence-of-evidence cannot tell
  // a finished small task from an unstated large one.
  // Two tiers, because a narrow marker that fires on ordinary prose is worse than
  // no marker at all: it silently disarms the confirmation gate on exactly the
  // vague, large descriptions the gate exists to catch. "Rework how we handle
  // customer comments and complaints" and "rename several fields throughout the
  // codebase" both did that on a bare word list.
  //
  // Compound and domain-specific markers are safe bare — nobody writes "off-by-one"
  // or "broken link" while describing a platform migration. Generic verbs and nouns
  // need a singular-article anchor, which is what separates "rename a variable"
  // from "rename several fields".
  const narrow = [
    /\b(single|one)\s+(file|line|component|endpoint)\b/i,
    /\b(typo|typos|whitespace|indentation|off[- ]by[- ]one|broken link|copyright)\b/i,
    /\b(null check|version bump|bump the|lint rule|lockfile)\b/i,
    /\b(rename|renaming|reword|rewording)\s+(a|an|the|one|this)\s/i,
    /\b(a|an|the|one|this)\s+(comment|docstring|log message|variable)\b/i,
  ];
  if (narrow.some(r => r.test(text))) evidence.push('narrow, single-artifact scope');
  const medium = [
    /\b(files|modules|components|commands|workflows)\b/i,
    /\badd\b|\bcreate\b|\bimplement\b|\bbuild\b|\bintroduce\b/i,
  ];
  // A quantifier in front of a plural noun is the strongest available scope signal.
  // "multiple services" is the only form the original matched; "three services",
  // "every service" and "all repos" say the same thing and were scoring zero.
  const QUANTIFIER = '(?:multiple|several|many|all|every|each|both|two|three|four|five|six|\\d+)';
  const SCOPE_NOUN = '(?:packages?|services?|repos?|repositor(?:y|ies)|workflows?|systems?|apps?|applications?|modules?|components?|tenants?)';
  const high = [
    /\bcross[- ]cutting\b/i,
    /\bend[- ]to[- ]end\b/i,
    /\bplatform\b/i,
    new RegExp(`\\b${QUANTIFIER}\\s+${SCOPE_NOUN}\\b`, 'i'),
    new RegExp(`\\bacross\\s+(?:${QUANTIFIER}\\s+)?${SCOPE_NOUN}\\b`, 'i'),
  ];
  if (medium.some(r => r.test(text))) { score = Math.max(score, 1); evidence.push('multi-artifact implementation language'); }
  if (high.some(r => r.test(text))) { score = Math.max(score, 3); evidence.push('cross-cutting or platform-wide scope'); }
  return score === 0 ? dimension(0, 'low', evidence) : score >= 3 ? dimension(3, 'high', evidence) : dimension(1, 'medium', evidence);
}

function scoreDependencies(text) {
  const evidence = [];
  let count = 0;
  const patterns = [
    /\b(api|database|queue|cache|service|provider|integration|mcp|cli|config|environment|artifact|pr|branch|schema|webhook|endpoint|job|worker|dashboard|handler)s?\b/gi,
    /\bdepends? on\b|\bafter\b|\bbefore\b|\bsequence\b/gi,
  ];
  for (const re of patterns) {
    const matches = text.match(re) || [];
    count += matches.length;
    evidence.push(...matches.slice(0, 4).map(m => `dependency signal: ${m.toLowerCase()}`));
  }
  if (count >= 6) return dimension(3, 'high', evidence);
  if (count >= 2) return dimension(2, 'medium', evidence);
  if (count === 1) return dimension(1, 'low', evidence);
  return dimension(0, 'low', evidence);
}

function scoreRiskFactors(text) {
  const evidence = [];
  const riskWords = text.match(/\b(security|secrets?|tokens?|approvals?|production|breaking|migrat(?:e|es|ed|ing|ion|ions)|rollbacks?|fallbacks?|low[- ]confidence|malformed|audits?|compliance|risks?|unsafe|halt)\b/gi) || [];
  evidence.push(...riskWords.slice(0, 6).map(w => `risk signal: ${w.toLowerCase()}`));
  if (riskWords.length >= 5) return dimension(3, 'high', evidence);
  if (riskWords.length >= 2) return dimension(2, 'medium', evidence);
  if (riskWords.length === 1) return dimension(1, 'low', evidence);
  return dimension(0, 'low', evidence);
}

// Team size is deliberately NOT a dimension. Nothing classify can read says how
// many people will work on something: the previous scorer counted words like
// "users", "approvals" and "owners", which describe the product, not the team,
// and turned their presence into a confident-looking number. An input that is
// never available is reported as missing instead (see TEAM_SIZE_UNREADABLE).
const TEAM_SIZE_UNREADABLE = 'team size: not readable from a description or the repository; not scored';

// Path-like mentions: anything with a slash, or a bare filename with a known
// source/config extension. URLs are excluded before matching.
const PATH_MENTION = /(?:[\w@.-]+\/)+[\w@.-]+|\b[\w-]+\.(?:[cm]?[jt]sx?|py|rb|go|rs|exs?|java|cs|kt|swift|php|md|ya?ml|json|toml|sh|sql|css|scss|html|vue|svelte)\b/g;
const PACKAGE_ROOTS = new Set(['packages', 'apps', 'libs', 'services', 'modules', 'crates']);

function extractPathMentions(text) {
  const withoutUrls = String(text || '').replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, ' ');
  return unique((withoutUrls.match(PATH_MENTION) || []).map(m => m.replace(/^\.\//, '').replace(/[.,;:)]+$/, '')));
}

function packageOf(relPath) {
  const parts = relPath.split('/');
  if (parts.length >= 2 && PACKAGE_ROOTS.has(parts[0])) return `${parts[0]}/${parts[1]}`;
  return parts.length > 1 ? parts[0] : '(root)';
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function defaultExec(cmd, args, cwd) {
  return execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
}

/**
 * Resolves paths named in the text against the repository and reports only what
 * git can show: whether each exists, its size, which package it sits in, and how
 * many tracked files import it. A mention that does not resolve, or resolves to
 * several files, is recorded as missing rather than guessed at.
 */
function collectRepoFacts(text, repoRoot, exec = defaultExec) {
  const mentions = extractPathMentions(text);
  const facts = { available: false, resolved: [], unresolved: [], ambiguous: [], packages: [], maxFanIn: 0 };
  if (!repoRoot) return { ...facts, reason: 'no repository root supplied' };
  let tracked;
  try {
    tracked = exec('git', ['ls-files'], repoRoot).split('\n').filter(Boolean);
  } catch {
    return { ...facts, reason: 'not a git repository' };
  }
  facts.available = true;
  facts.mentions = mentions;
  const trackedSet = new Set(tracked);

  for (const mention of mentions.slice(0, 8)) {
    let matches;
    if (trackedSet.has(mention)) matches = [mention];
    else if (mention.includes('/')) {
      const prefix = mention.replace(/\/$/, '') + '/';
      const under = tracked.filter(f => f.startsWith(prefix));
      matches = under.length ? [{ dir: mention.replace(/\/$/, ''), files: under.length }] : tracked.filter(f => f.endsWith('/' + mention));
    } else {
      matches = tracked.filter(f => f === mention || f.endsWith('/' + mention));
    }
    if (matches.length === 0) { facts.unresolved.push(mention); continue; }
    if (matches.length > 1) { facts.ambiguous.push({ mention, count: matches.length }); continue; }

    const match = matches[0];
    if (typeof match === 'object') {
      facts.resolved.push({ mention, path: match.dir, kind: 'dir', files: match.files, package: packageOf(match.dir + '/x') });
      continue;
    }
    let lines = null;
    try { lines = fs.readFileSync(path.join(repoRoot, match), 'utf8').split('\n').length; } catch { /* unreadable: size unknown */ }
    const base = path.basename(match).replace(/\.[^.]+$/, '');
    const stem = base === 'index' ? path.basename(path.dirname(match)) : base;
    let fanIn = 0;
    try {
      // POSIX classes, not \s: git grep -E does not support Perl escapes, and an
      // unsupported escape silently matches nothing, i.e. a fan-in of zero.
      const importPattern = `(from|require\\(|import\\()[[:space:]]*['"]([^'"]*/)?${escapeRegExp(stem)}(\\.[a-z]+)?['"]`;
      const importers = exec('git', ['grep', '-l', '-E', importPattern], repoRoot).split('\n').filter(f => f && f !== match);
      fanIn = importers.length;
    } catch { fanIn = 0; /* git grep exits 1 on no match */ }
    facts.resolved.push({ mention, path: match, kind: 'file', lines, fanIn, package: packageOf(match) });
    facts.maxFanIn = Math.max(facts.maxFanIn, fanIn);
  }
  facts.packages = unique(facts.resolved.map(r => r.package));
  return facts;
}

/**
 * Resolve and load the `tracker` category's adapter (TRD-2026-8d825f54 TRD-025, PRD AC-016-2),
 * the same `resolveCategory`/`loadAdapter` pipeline `toolchain-cli.js#run` uses -- never `br`
 * directly.
 * @param {string} cwd
 * @returns {{manifest: object}}
 */
function resolveTrackerAdapter(cwd) {
  const env = process.env;
  const resolved = resolveCategory('tracker', { projectRoot: cwd, env, detect: detectAdapter });
  const loaded = loadAdapter(resolved.value, { projectRoot: cwd, env, category: 'tracker', interactive: false });
  return { manifest: loaded.manifest };
}

/** Reads a bead through the tracker runner's `tracker.show` capability. Returns null when it cannot be read. */
function loadBead(id, cwd) {
  try {
    // Lazy require: see the top-of-file comment next to the other `./toolchain/*` requires.
    const { runCapabilitySync } = require('./toolchain/runner');
    const { manifest } = resolveTrackerAdapter(cwd);
    // Synchronous: killed-on-timeout containment is direct-child-only, never a detached
    // descendant (runner.js's "## runCapabilitySync" header section) -- acceptable here since
    // `tracker.show` is a short, one-shot `br` read.
    const result = runCapabilitySync(manifest, 'tracker.show', { id }, { execFileOptions: { cwd } });
    if (!result.ok) return null;
    const bead = result.data;
    return bead && bead.id ? bead : null;
  } catch {
    return null;
  }
}

function raise(dim, score, evidence) {
  const next = Math.max(dim.score, score);
  const label = next === dim.score ? dim.label : next >= 3 ? 'high' : next >= 2 ? 'medium' : 'low';
  return dimension(next, label, [...dim.evidence, ...evidence]);
}

/** Folds repository and bead facts into the text-derived dimensions, each with a citation. */
function applyReadableFacts(dimensions, repo, bead) {
  let { scopeSize, dependencies, riskFactors } = dimensions;
  for (const r of repo.resolved) {
    const detail = r.kind === 'dir'
      ? `${r.path}/ (${r.files} tracked files, ${r.package})`
      : `${r.path} (${r.lines ?? '?'} lines, ${r.package}, imported by ${r.fanIn} files)`;
    scopeSize = raise(scopeSize, 0, [`repo: ${detail}`]);
  }
  if (repo.packages.length >= 2) {
    scopeSize = raise(scopeSize, 3, [`repo: named paths span ${repo.packages.length} packages (${repo.packages.join(', ')})`]);
  } else if (repo.resolved.length >= 2 || repo.resolved.some(r => r.kind === 'dir')) {
    scopeSize = raise(scopeSize, 1, [`repo: ${repo.resolved.length} named paths in ${repo.packages[0]}`]);
  }
  if (repo.maxFanIn > 0) {
    const top = repo.resolved.reduce((a, b) => ((b.fanIn || 0) > (a.fanIn || 0) ? b : a));
    const score = repo.maxFanIn >= 10 ? 3 : repo.maxFanIn >= 3 ? 2 : 1;
    dependencies = raise(dependencies, score, [`repo: ${top.path} is imported by ${top.fanIn} files`]);
  }

  if (bead) {
    const type = String(bead.issue_type || '').toLowerCase();
    if (type === 'epic') scopeSize = raise(scopeSize, 3, [`bead: type ${type}`]);
    else if (type === 'feature') scopeSize = raise(scopeSize, 1, [`bead: type ${type}`]);
    else if (type) scopeSize = raise(scopeSize, 0, [`bead: type ${type}`]);
    const deps = Array.isArray(bead.dependencies) ? bead.dependencies.length : Number(bead.dependency_count) || 0;
    const dependents = Array.isArray(bead.dependents) ? bead.dependents.length : Number(bead.dependents ?? bead.dependent_count) || 0;
    if (deps + dependents > 0) {
      dependencies = raise(dependencies, deps + dependents >= 3 ? 2 : 1, [`bead: ${deps} dependencies, ${dependents} dependents`]);
    }
  }
  return { scopeSize, dependencies, riskFactors };
}

/**
 * Bead fields that are real but say nothing about size. Cited in the rationale so
 * the user sees them; kept out of the dimensions so they cannot raise confidence.
 */
function beadCitations(bead) {
  if (!bead) return [];
  const out = [];
  if (bead.priority !== undefined && bead.priority !== null) out.push(`bead: priority P${bead.priority} (urgency; not scored)`);
  if (Array.isArray(bead.labels) && bead.labels.length) out.push(`bead: labels ${bead.labels.join(', ')} (not scored)`);
  return out;
}

function missingRepoInputs(repo, bead) {
  const missing = [];
  if (!repo.available) missing.push(`repository facts: ${repo.reason}`);
  else if (!repo.mentions.length) missing.push('repository facts: no file or path named in the description');
  for (const m of repo.unresolved) missing.push(`named path not found in repository: ${m}`);
  for (const a of repo.ambiguous) missing.push(`named path ambiguous (${a.count} tracked matches): ${a.mention}`);
  if (!bead) missing.push('bead metadata: no --bead given');
  return missing;
}

function scoreToRoute(score) {
  if (!Number.isFinite(score)) throw new Error('score must be numeric');
  const rounded = clamp(Math.round(score), 1, 10);
  if (rounded <= 3) return 'simple';
  if (rounded <= 6) return 'medium';
  return 'complex';
}

function routePlan(route) {
  if (route === 'simple') return ['/ensemble:fix-issue'];
  if (route === 'medium') return ['/ensemble:create-prd', '/ensemble:create-trd', 'STOP: await implementation approval'];
  if (route === 'complex') return ['/ensemble:create-prd', '/ensemble:refine-prd', '/ensemble:create-trd', '/ensemble:refine-trd', 'STOP: await implementation approval'];
  throw new Error(`invalid route: ${route}`);
}

function confidenceFor(dimensions) {
  const names = { scopeSize: 'scope size', dependencies: 'dependencies', riskFactors: 'risk factors' };
  const scored = Object.values(dimensions).filter(d => d.evidence.length > 0 || d.score > 0).length;
  const missingDetails = Object.entries(names)
    .filter(([key]) => !dimensions[key].evidence.length && dimensions[key].score === 0)
    .map(([, label]) => label);
  let confidence = 'high';
  if (scored < 2) confidence = 'low';
  else if (scored < 3) confidence = 'medium';
  return { confidence, missingDetails, scoredDimensionCount: scored };
}

function resolveOverride(route) {
  if (!route) return { ok: true, override: { applied: false, source: null } };
  const normalized = String(route).toLowerCase();
  if (!ROUTES.includes(normalized)) {
    return { ok: false, error: `ERROR: Invalid route override '${route}'. Valid choices: simple, medium, complex.` };
  }
  return { ok: true, route: normalized, override: { applied: true, source: 'flag', value: normalized } };
}

/**
 * Whether the text of an Ensemble config file sets `adaptive_planning.enabled: false`: an
 * `adaptive_planning:` line, any lines that start with whitespace, then `enabled: false`.
 *
 * Matching is linear: `\s+`, `[^\S\n]*` and `[^\n]*` are each followed by a character they
 * cannot match, so a line splits only one way and the lazy loop tries each line boundary once.
 * The earlier form, `\s*(?:\n|\r\n)(?:\s+[^\n]*\n)*?\s+`, let `\s+` (newline included) and
 * `[^\n]*` consume the same blanks, so a run of whitespace-only lines backtracked exponentially
 * (CodeQL js/redos). `\S` now pins where a line's text begins and `[^\S\n]*\n` ends the key line
 * at its first newline (`\r\n` too); the accepted texts are the same.
 */
function isAdaptivePlanningDisabled(text) {
  return /adaptive_planning:[^\S\n]*\n(?:\s+\S[^\n]*\n)*?\s+enabled:\s*false\b/.test(text);
}

function loadAdaptivePlanningEnabled(opts = {}, cwd = process.cwd()) {
  if (opts.noAdaptivePlanning) return { enabled: false, source: '--no-adaptive-planning' };
  const candidates = [
    path.join(cwd, 'ensemble.yaml'),
    path.join(cwd, 'ensemble.yml'),
    path.join(cwd, '.ensemble.yaml'),
    path.join(cwd, '.ensemble.yml'),
  ];
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    try {
      const text = fs.readFileSync(file, 'utf8');
      if (isAdaptivePlanningDisabled(text)) {
        return { enabled: false, source: path.relative(cwd, file) };
      }
    } catch (error) {
      return { enabled: true, source: 'default', warning: `config read failed: ${path.basename(file)}` };
    }
  }
  return { enabled: true, source: 'default' };
}

function analyze(input, opts = {}, env = process.env) {
  const normalized = input && input.ok !== undefined ? input : normalizeInput(opts, env);
  if (!normalized.ok) return { ok: false, error: normalized.error };
  const config = loadAdaptivePlanningEnabled(opts, opts.cwd || process.cwd());
  if (!config.enabled) {
    return { ok: true, adaptivePlanning: config, normalized, disabled: true, selectedRoute: null, recommendedRoute: null };
  }

  const safe = redactSecrets(`${normalized.subject}\n${normalized.description}`);
  const text = safe.text;
  const textDimensions = {
    scopeSize: scoreScopeSize(text),
    dependencies: scoreDependencies(text),
    riskFactors: scoreRiskFactors(text),
  };
  const bead = normalized.source === 'bead' ? opts.bead : null;
  const repo = collectRepoFacts(text, opts.repoRoot || null, opts.exec);
  const dimensions = applyReadableFacts(textDimensions, repo, bead);
  const conf = confidenceFor(dimensions);
  const { confidence, scoredDimensionCount } = conf;
  const missingDetails = [...conf.missingDetails, TEAM_SIZE_UNREADABLE, ...missingRepoInputs(repo, bead)];
  // Three dimensions of 0-3 each: 1 + sum spans 1-10 without rescaling.
  let score = 1 + Object.values(dimensions).reduce((sum, d) => sum + d.score, 0);
  score = clamp(score, 1, 10);
  let recommendedRoute = scoreToRoute(score);

  const fallback = { applied: false, reason: null };
  if (opts.aiOutputMalformed) {
    if (scoredDimensionCount < 2) {
      return { ok: false, error: 'ERROR: Analyzer output malformed and insufficient structural detail for deterministic fallback. No route side effects performed.', normalized, dimensions };
    }
    fallback.applied = true;
    fallback.reason = 'malformed AI output; deterministic heuristic used';
    if (confidence === 'low' && normalized.mode === 'foreman') recommendedRoute = 'medium';
  }

  if (confidence === 'low' && normalized.mode === 'foreman' && recommendedRoute === 'simple') {
    recommendedRoute = 'medium';
    score = Math.max(score, 4);
    fallback.applied = true;
    fallback.reason = fallback.reason || 'low confidence in Foreman mode; safer higher-depth plausible route selected';
  }

  const overrideResult = resolveOverride(opts.route);
  if (!overrideResult.ok) return { ok: false, error: overrideResult.error, normalized, recommendedRoute };
  const selectedRoute = overrideResult.route || recommendedRoute;
  const band = selectedRoute;
  // Repository and bead citations are listed first: they are facts, where the
  // text signals are keyword matches.
  const dimensionRationale = Object.entries(dimensions)
    .flatMap(([name, dim]) => {
      const facts = dim.evidence.filter(e => /^(repo|bead):/.test(e));
      const words = dim.evidence.filter(e => !/^(repo|bead):/.test(e)).slice(0, 2);
      return [...facts, ...words].map(e => `${name}: ${e}`);
    })
    .slice(0, 10);
  const rationale = dimensionRationale.concat(beadCitations(bead));

  // Confirmation policy (br-0r3, operator decision 2026-09-29, option C): low
  // confidence asks before dispatch UNLESS the work is recognisably small.
  //
  // Low confidence means at most one of the three dimensions had any evidence, so
  // the score rests on very little. That covers two different situations:
  //   - nothing recognised at all ("Rework how we handle customers"), which #65
  //     already gated because it scores at the floor and would route to Simple;
  //   - one weak signal ("Add a caching layer"), which #65 let through silently.
  // Both now ask. The exemption is work that is recognisably small: a narrow
  // marker (typo, off-by-one, "rename a variable"), or a single named file that
  // nothing imports. Asking about those would put a prompt in front of every
  // one-line fix, which is the overhead the Simple route exists to remove.
  //
  // Evidence here is dimension evidence only: a bead's priority or labels are real
  // but say nothing about size, and must not exempt anything. An explicit --route
  // means the human already chose, and Foreman is unattended and keeps its own
  // safety bump instead. This flags; it does not reroute.
  const singleLeafFile =
    repo.resolved.length === 1 && repo.resolved[0].kind === 'file' && (repo.resolved[0].fanIn || 0) < 3;
  const recognisablySmall =
    dimensions.scopeSize.evidence.includes('narrow, single-artifact scope') || singleLeafFile;
  const needsConfirmation =
    normalized.mode !== 'foreman' &&
    confidence === 'low' &&
    !recognisablySmall &&
    !overrideResult.override.applied;
  const confirmationReason = !needsConfirmation
    ? null
    : dimensionRationale.length === 0
      ? 'no scope, dependency or risk signal was found, so the score sits at the floor and the route below is a guess'
      : `confidence is low: only ${scoredDimensionCount} of 3 dimensions had evidence, so the route below rests on one signal`;

  return {
    ok: true,
    adaptivePlanning: config,
    needsConfirmation,
    confirmationReason,
    subject: normalized.subject,
    descriptionPresent: Boolean(normalized.description),
    score,
    band,
    confidence,
    selectedRoute,
    recommendedRoute,
    override: overrideResult.override,
    dimensions,
    missingDetails,
    repoFacts: repo,
    rationale,
    redactions: safe.redactions,
    routePlan: routePlan(selectedRoute),
    normalized,
    fallback,
  };
}

function sidecarPath(artifactPath) {
  if (!artifactPath) return null;
  const ext = path.extname(artifactPath);
  return artifactPath.slice(0, artifactPath.length - ext.length) + '.classification.json';
}

function renderReport(result, artifactPath) {
  if (!result.ok) return `${result.error}\n`;
  const lines = [];
  lines.push('# Adaptive Planning Complexity Analysis');
  lines.push('');
  lines.push(`- Subject: ${redactSecrets(result.subject || '').text}`);
  lines.push(`- Score: ${result.score}`);
  lines.push(`- Recommended route: ${result.recommendedRoute}`);
  lines.push(`- Selected route: ${result.selectedRoute}`);
  lines.push(`- Confidence: ${result.confidence}`);
  lines.push(`- Override: ${result.override?.applied ? result.override.value : 'none'}`);
  lines.push(`- Adaptive planning: ${result.adaptivePlanning?.enabled === false ? 'disabled' : 'enabled'}`);
  if (result.needsConfirmation) lines.push('- Confirmation required: yes');
  if (artifactPath) lines.push(`- Classification sidecar: ${sidecarPath(artifactPath)}`);
  lines.push('');
  lines.push('## Rationale');
  for (const item of result.rationale || []) lines.push(`- ${item}`);
  if (!result.rationale?.length) lines.push('- No high-signal rationale extracted.');
  lines.push('');
  lines.push('## Missing Inputs');
  for (const item of result.missingDetails || []) lines.push(`- ${item}`);
  lines.push('');
  lines.push('## Route Plan');
  if (result.needsConfirmation) {
    lines.push(`- CONFIRM BEFORE DISPATCH: ${result.confirmationReason || 'confidence is low'}.`);
    lines.push(
      '  Describe the work in more detail, or name the route with --route simple|medium|complex.'
    );
  }
  for (const step of result.routePlan || []) lines.push(`- ${step}`);
  return `${lines.join('\n')}\n`;
}

function repoRootOf(cwd) {
  try {
    return defaultExec('git', ['rev-parse', '--show-toplevel'], cwd).trim() || null;
  } catch {
    return null;
  }
}

function main() {
  const opts = parseArgs();
  if (!process.argv.includes('analyze')) return;
  const cwd = process.cwd();
  opts.repoRoot = repoRootOf(cwd);
  let result;
  if (opts.beadId && !opts.foreman) {
    opts.bead = loadBead(opts.beadId, cwd);
    if (!opts.bead) {
      result = { ok: false, error: `ERROR: Could not read bead ${opts.beadId} via 'br show --json'. No route side effects performed.` };
    }
  }
  result = result || analyze(null, opts, process.env);
  const artifactPath = process.env.FOREMAN_ARTIFACT_PATH || '';
  if (opts.foreman && artifactPath) {
    fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
    fs.writeFileSync(artifactPath, renderReport(result, artifactPath));
    const sidecar = sidecarPath(artifactPath);
    fs.writeFileSync(sidecar, `${JSON.stringify(result, null, 2)}\n`);
  }
  if (opts.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else process.stdout.write(renderReport(result, artifactPath));
  if (!result.ok) process.exitCode = 1;
}

module.exports = {
  ROUTES,
  redactSecrets,
  parseArgs,
  normalizeInput,
  scoreScopeSize,
  scoreDependencies,
  scoreRiskFactors,
  TEAM_SIZE_UNREADABLE,
  extractPathMentions,
  collectRepoFacts,
  loadBead,
  scoreToRoute,
  routePlan,
  confidenceFor,
  resolveOverride,
  isAdaptivePlanningDisabled,
  loadAdaptivePlanningEnabled,
  analyze,
  sidecarPath,
  renderReport,
};

if (require.main === module) main();
