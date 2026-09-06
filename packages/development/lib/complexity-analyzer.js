#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROUTES = ['simple', 'medium', 'complex'];
const SECRET_PATTERNS = [
  { name: 'aws-access-key', pattern: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: 'github-token', pattern: /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g },
  { name: 'bearer-token', pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}\b/gi },
  { name: 'key-value-secret', pattern: /\b(api[_-]?key|token|secret|password)\s*[:=]\s*['\"]?[^\s'\"]{8,}/gi },
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

  if (!argDescription) {
    return { ok: false, error: 'ERROR: Missing work description: pass a work description. No route side effects performed.' };
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

function scoreTeamSize(text) {
  const evidence = [];
  const teamWords = text.match(/\b(teams?|pm|developers?|operators?|users?|reviewers?|qa|foreman|humans?|approvals?|owners?|tenants?|admins?|stakeholders?)\b/gi) || [];
  evidence.push(...teamWords.slice(0, 5).map(w => `team signal: ${w.toLowerCase()}`));
  if (/\bmulti[- ]team\b/i.test(text) || teamWords.length >= 5) return dimension(3, 'high', evidence);
  if (teamWords.length >= 2) return dimension(2, 'medium', evidence);
  if (teamWords.length === 1) return dimension(1, 'low', evidence);
  return dimension(0, 'low', evidence);
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
  const scored = Object.values(dimensions).filter(d => d.evidence.length > 0 || d.score > 0).length;
  const missingDetails = [];
  if (!dimensions.scopeSize.evidence.length && dimensions.scopeSize.score === 0) missingDetails.push('scope size');
  if (!dimensions.dependencies.evidence.length && dimensions.dependencies.score === 0) missingDetails.push('dependencies');
  if (!dimensions.riskFactors.evidence.length && dimensions.riskFactors.score === 0) missingDetails.push('risk factors');
  if (!dimensions.teamSize.evidence.length && dimensions.teamSize.score === 0) missingDetails.push('team size');
  let confidence = 'high';
  if (scored < 2) confidence = 'low';
  else if (scored < 4) confidence = 'medium';
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
      if (/adaptive_planning:\s*(?:\n|\r\n)(?:\s+[^\n]*\n)*?\s+enabled:\s*false\b/.test(text)) {
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
  const dimensions = {
    scopeSize: scoreScopeSize(text),
    dependencies: scoreDependencies(text),
    riskFactors: scoreRiskFactors(text),
    teamSize: scoreTeamSize(text),
  };
  const { confidence, missingDetails, scoredDimensionCount } = confidenceFor(dimensions);
  let score = 1 + Math.round(Object.values(dimensions).reduce((sum, d) => sum + d.score, 0) * 0.75);
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
  const rationale = Object.entries(dimensions)
    .flatMap(([name, dim]) => dim.evidence.slice(0, 2).map(e => `${name}: ${e}`))
    .slice(0, 6);

  // A description carrying no signal in any dimension scores at the floor, so the
  // route reads Simple — and Simple dispatches to /ensemble:fix-issue with no PRD
  // and no TRD. "Rework how we handle customers" lands there. That is the case the
  // command spec means by "ask for confirmation or clarification on low-confidence
  // interactive analysis before dispatch".
  //
  // Scoped narrowly on purpose. Blanket low-confidence escalation would also catch
  // "Fix a typo in the README", which reports low confidence and is nonetheless
  // correctly Simple; escalating it hands a typo a PRD. The discriminator is not
  // confidence alone but confidence WITH no extracted evidence — a typo scores low
  // because there is little to say, a vague subject scores low because nothing was
  // said. An explicit --route means the human already named the route, so there is
  // nothing left to confirm.
  //
  // This flags; it does not reroute. The recommendation stands and the caller
  // decides, which keeps the analyzer's output deterministic.
  const needsConfirmation =
    normalized.mode !== 'foreman' &&
    confidence === 'low' &&
    rationale.length === 0 &&
    !overrideResult.override.applied;

  return {
    ok: true,
    adaptivePlanning: config,
    needsConfirmation,
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
  lines.push('## Route Plan');
  if (result.needsConfirmation) {
    lines.push(
      '- CONFIRM BEFORE DISPATCH: no scope, dependency, risk or team signal was found in'
    );
    lines.push(
      '  this description, so the score sits at the floor and the route below is a guess.'
    );
    lines.push(
      '  Describe the work in more detail, or name the route with --route simple|medium|complex.'
    );
  }
  for (const step of result.routePlan || []) lines.push(`- ${step}`);
  return `${lines.join('\n')}\n`;
}

function main() {
  const opts = parseArgs();
  if (!process.argv.includes('analyze')) return;
  const result = analyze(null, opts, process.env);
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
  scoreTeamSize,
  scoreToRoute,
  routePlan,
  confidenceFor,
  resolveOverride,
  loadAdaptivePlanningEnabled,
  analyze,
  sidecarPath,
  renderReport,
};

if (require.main === module) main();
