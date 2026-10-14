#!/usr/bin/env node
'use strict';

/**
 * trd-cli.js — JSON CLI wrapper over the four committed pure TRD libs.
 *
 * Invoked by the `implement-trd-beads` command prose via `node` to obtain
 * deterministic, structured (JSON) output instead of prose-parsing markdown.
 *
 * Contract:
 *   - Reads the TRD markdown from a PATH argument (not stdin).
 *   - On success: prints a single JSON object to stdout, exits 0.
 *   - On failure: prints `{"error":"<msg>"}` to stdout, exits 1.
 *   - NEVER prints non-JSON to stdout. Diagnostics/logs go to stderr.
 *
 * The module is both importable (exports handler functions) and executable
 * (`if (require.main === module) main(...)`).
 *
 * Subcommands:
 *   parse        <trd-path>
 *   scaffold-plan <trd-path>
 *   phase-status <trd-path> [--closed a,b,c]
 *   next-task    <trd-path> --ready a,b [--closed a,b] [--max N]
 *   pr-plan      <trd-path> [--stacked]
 *   validate-workstream <trd-path...>
 *   create-workstream-trd <trd-path...> [--out path]
 *   workstream-plan <trd-path...> [--stacked]
 *   workstream-status [--workstream slug] [--issues-json path]
 *   quickstart <trd-path> --out <path> [--json]
 *   resolve-sdlc --git-town-exit-code <0-4> --remote-url <url>
 */

const fs = require('fs');
const path = require('path');

let yaml = null;
try { yaml = require('js-yaml'); } catch { yaml = null; }

const { extractPrdContext } = require('./prd-parser');

const {
  parseTRD,
  extractDesignReadinessScore,
  getFrontmatterField,
  PRD_REFERENCE_KEYS,
} = require('./trd-parser');
const {
  buildPhaseTaskIds,
  currentPhase,
  isPhaseComplete,
  selectNextTasks,
} = require('./phase-tracker');
const { buildScaffoldPlan } = require('./scaffold-planner');
const { buildWorkstreamPlan, validateWorkstream } = require('./workstream-planner');
const { resolveCrossTrdDeps } = require('./cross-trd-deps');
const { summarizeWorkstream } = require('./workstream-status');
const { generateWorkstreamTrd, nextWorkstreamPath } = require('./workstream-trd');
const {
  useStackedPrs,
  branchName,
  planPrActions,
  resolveBranchingStrategy,
  resolvePrBackend,
  buildConsolidatedResolutionMessage,
} = require('./pr-strategy');
const { buildQuickstart } = require('./quickstart-generator');

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------

/** Slugify any string: lowercase, non-alphanumerics -> single hyphen, trim. */
function slugify(s) {
  return String(s == null ? '' : s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Derive a stable TRD slug from the FILENAME ONLY.
 *
 * This MUST match the `implement-trd-beads` command's Preflight "TRD Selection
 * and Validation" step exactly: take the TRD filename (basename, minus the
 * extension), lowercase it, replace every run of non-alphanumerics with a
 * single hyphen, and strip leading/trailing hyphens.
 *
 * The slug feeds every bead title prefix (`[trd:<SLUG>:...]`), idempotency
 * matching, and resume detection. If the CLI's slug diverged from the
 * command's slug, beads created by one would not match on resume by the other.
 * For this reason there is deliberately NO title-preference branch: the
 * filename is the single source of truth, identical to the live command.
 *
 * @param {string} trdPath
 * @returns {string}
 */
function deriveSlug(trdPath) {
  const base = path.basename(String(trdPath || ''));
  const noExt = base.replace(/\.[^.]+$/, '');
  return slugify(noExt);
}

/** Split a comma-separated list into a trimmed, non-empty string array. */
function splitList(value) {
  if (value == null) return [];
  return String(value)
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Minimal argv parser. Supports `--flag value` and `--flag` (boolean) forms.
 * Positionals are collected in order. Returns { positionals, flags }.
 *
 * A flag is treated as boolean when it is the last token or the following
 * token is itself a `--flag`. Known value-flags (passed in `valueFlags`) always
 * consume the next token when present.
 *
 * @param {string[]} argv
 * @param {Set<string>} [valueFlags] flags that always take a value
 */
function parseArgs(argv, valueFlags) {
  const vf = valueFlags || new Set();
  const positionals = [];
  const flags = {};
  const list = Array.isArray(argv) ? argv : [];
  for (let i = 0; i < list.length; i++) {
    const tok = list[i];
    if (typeof tok === 'string' && tok.startsWith('--')) {
      const name = tok.slice(2);
      const next = list[i + 1];
      const nextIsFlag = typeof next === 'string' && next.startsWith('--');
      if (vf.has(name)) {
        // Known value-flag: always consume the next token as the value (which
        // may be undefined or another --flag, in which case the value is '').
        flags[name] = nextIsFlag || next === undefined ? '' : next;
        if (!nextIsFlag && next !== undefined) i += 1;
      } else {
        // Unknown flag: treated as a boolean. We deliberately do NOT consume
        // the following token so positionals are never accidentally swallowed.
        flags[name] = true;
      }
    } else {
      positionals.push(tok);
    }
  }
  return { positionals, flags };
}

/**
 * Read a TRD file from disk. Throws a friendly Error when missing/unreadable.
 * @param {string} trdPath
 * @returns {string} file contents
 */
/**
 * Resolve a PRD reference to an absolute filesystem path, trying:
 *   1. As-given (existing file from cwd)
 *   2. Relative to the TRD file's directory
 * Returns null if the file cannot be read.
 * @param {string} prdRef  parsed.prdReference (as-written in the TRD, e.g. "docs/PRD/foo.md")
 * @param {string} trdPath  absolute path of the TRD file
 * @returns {string|null}
 */
function resolvePrd(prdRef, trdPath) {
  if (!prdRef) return null;
  const candidates = [
    prdRef,                                             // as-given from cwd
    path.join(path.dirname(path.resolve(trdPath)), prdRef), // relative to TRD dir
  ];
  for (const c of candidates) {
    try {
      fs.accessSync(c, fs.constants.R_OK);
      return c;
    } catch {
      // try next candidate
    }
  }
  return null;
}

function readTrd(trdPath) {
  if (!trdPath) throw new Error('Missing required <trd-path> argument');
  let contents;
  try {
    contents = fs.readFileSync(trdPath, 'utf8');
  } catch (err) {
    throw new Error(`Cannot read TRD file '${trdPath}': ${err.message}`);
  }
  return contents;
}
/**
 * Parse a TRD path into { slug, parsed, prdContext }. Shared by every subcommand.
 * PRD context is enriched by loading and extracting the PRD if its reference
 * is resolvable — callers that need prdContext pass it to buildScaffoldPlan.
 * @param {string} trdPath
 */
function loadParsed(trdPath) {
  const markdown = readTrd(trdPath);
  const parsed = parseTRD(markdown);
  const slug = deriveSlug(trdPath);
  const prdRef = parsed.prdReference || '';
  const prdAbsPath = resolvePrd(prdRef, trdPath);
  const prdContext =
    prdAbsPath && prdRef
      ? extractPrdContext(fs.readFileSync(prdAbsPath, 'utf8'))
      : { requirements: {}, acs: {} };
  return { slug, parsed, prdContext };
}

// ---------------------------------------------------------------------------
// Subcommand handlers — each returns a plain object and never throws for
// the "happy path"; file/argument errors propagate as Error to be caught and
// rendered as `{error}` by main().
// ---------------------------------------------------------------------------

/**
 * `parse <trd-path>` -> { ok:true, trd: <ParsedTRD + slug> }
 */
function runParse(argv) {
  const { positionals } = parseArgs(argv);
  const trdPath = positionals[0];
  const { slug, parsed } = loadParsed(trdPath);
  // Do not mutate the parser output; emit a shallow copy with `slug` added.
  const trd = Object.assign({}, parsed, { slug });
  return { ok: true, trd };
}

/**
 * `scaffold-plan <trd-path>` -> { ok:true, slug, plan }
 */
function runScaffoldPlan(argv) {
  const { positionals } = parseArgs(argv);
  const trdPath = positionals[0];
  const { slug, parsed, prdContext } = loadParsed(trdPath);
  const plan = buildScaffoldPlan(parsed, {
    trdSlug: slug,
    trdFilePath: trdPath,
    prdFilePath: parsed.prdReference || '',
    prdContext,
  });
  return { ok: true, slug, plan };
}

/**
 * `phase-status <trd-path> [--closed a,b,c]`
 *   -> { ok:true, slug, prFormat, phaseTaskIds, currentPhase, phases:[{n, complete}] }
 */
function runPhaseStatus(argv) {
  const { positionals, flags } = parseArgs(argv, new Set(['closed']));
  const trdPath = positionals[0];
  const { slug, parsed } = loadParsed(trdPath);

  const closed = splitList(flags.closed);
  const phaseTaskIds = buildPhaseTaskIds(parsed);
  const cp = currentPhase(phaseTaskIds, closed);

  const phases = Object.keys(phaseTaskIds)
    .map((k) => Number(k))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b)
    .map((n) => ({ n, complete: isPhaseComplete(phaseTaskIds, n, closed) }));

  return {
    ok: true,
    slug,
    prFormat: !!parsed.prFormat,
    phaseTaskIds,
    currentPhase: cp,
    phases,
  };
}

/**
 * `next-task <trd-path> --ready a,b [--closed a,b] [--max N]`
 *   -> { ok:true, selected:[ids] }
 */
function runNextTask(argv, env) {
  const { positionals, flags } = parseArgs(argv, new Set(['ready', 'closed', 'max']));
  const trdPath = positionals[0];
  const { parsed } = loadParsed(trdPath);

  const ready = splitList(flags.ready);
  const closed = splitList(flags.closed);
  const maxRaw = flags.max != null && flags.max !== '' ? Number(flags.max) : NaN;
  const max = Number.isFinite(maxRaw) && maxRaw > 0 ? Math.floor(maxRaw) : 1;
  // Phase-strict filtering only applies in stacked PR mode (one PR per phase).
  // Single-PR mode lets any phase's ready tasks run as bv schedules them.
  const stacked = flags.stacked === true ? true : useStackedPrs(env || {});
  const phaseTaskIds = buildPhaseTaskIds(parsed);
  const selected = selectNextTasks(ready, phaseTaskIds, closed, { stacked, max });

  return { ok: true, selected };
}
/**
 * `pr-plan <trd-path> [--stacked]`
 *   -> { ok:true, slug, stacked, prFormat, branchFirst, actions }
 */
function runPrPlan(argv, env) {
  const { positionals, flags } = parseArgs(argv);
  const trdPath = positionals[0];
  const { slug, parsed } = loadParsed(trdPath);

  const prFormat = !!parsed.prFormat;
  // --stacked flag forces stacked; absent the flag, fall back to env toggle.
  const stacked = flags.stacked === true ? true : useStackedPrs(env || {});

  const branchFirst = branchName(slug, { prFormat, stacked, phaseN: 1 });

  const phases = (Array.isArray(parsed.phases) ? parsed.phases : []).map((p) => ({
    n: p.n,
    title: p.title,
    shippableState: p.shippableState,
  }));

  const actions = planPrActions({
    trdSlug: slug,
    prFormat,
    stacked,
    phases,
    trdTitle: parsed.title,
  });

  return {
    ok: true,
    slug,
    stacked,
    prFormat,
    branchFirst,
    actions,
  };
}

// Valid git-town exit codes per validate-git-town.sh (0-4). Anything else is
// a malformed/unexpected value the CLI should reject rather than pass through.
const VALID_GIT_TOWN_EXIT_CODES = new Set([0, 1, 2, 3, 4]);

/**
 * `resolve-sdlc --git-town-exit-code <0-4> --remote-url <url>`
 *   -> { ok:true, branchingStrategy, prBackend, consolidatedMessage }
 *
 * Thin CLI adapter over pr-strategy.js's resolveBranchingStrategy /
 * resolvePrBackend / buildConsolidatedResolutionMessage (TRD §1.1-1.4).
 * Reads ENSEMBLE_BRANCHING_STRATEGY / ENSEMBLE_PR_BACKEND from the `env`
 * param rather than process.env directly, matching runPrPlan/runNextTask's
 * pattern for testability.
 */
function runQuickstart(argv) {
  const { positionals, flags } = parseArgs(argv, new Set(['out']));
  const trdPath = positionals[0];
  if (!trdPath) throw new Error('Missing required <trd-path> argument');
  const outPath = flags.out;
  if (!outPath) throw new Error('Missing required --out path');

  const { parsed, prdContext } = loadParsed(trdPath);
  const result = buildQuickstart(Object.assign({}, parsed, { prdContext }), {
    trdPath,
    outPath,
  });

  try {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, result.markdown, 'utf8');
  } catch (err) {
    throw new Error(`Failed to write quickstart artifact '${outPath}': ${err.message}`);
  }

  return {
    ok: true,
    quickstartPath: outPath,
    coverage: result.coverage,
  };
}

function runResolveSdlc(argv, env) {
  const { flags } = parseArgs(argv, new Set(['git-town-exit-code', 'remote-url']));

  const rawExitCode = flags['git-town-exit-code'];
  if (rawExitCode == null || rawExitCode === '') {
    throw new Error('Missing required --git-town-exit-code flag');
  }
  const gitTownExitCode = Number(rawExitCode);
  if (!VALID_GIT_TOWN_EXIT_CODES.has(gitTownExitCode)) {
    throw new Error(`Invalid --git-town-exit-code '${rawExitCode}': must be an integer 0-4`);
  }

  const remoteUrl = flags['remote-url'];
  if (remoteUrl == null || remoteUrl === '') {
    throw new Error('Missing required --remote-url flag');
  }

  const branchingStrategy = resolveBranchingStrategy(env || {}, gitTownExitCode);
  const prBackend = resolvePrBackend(env || {}, remoteUrl);
  const consolidatedMessage = buildConsolidatedResolutionMessage(branchingStrategy, prBackend);

  return { ok: true, branchingStrategy, prBackend, consolidatedMessage };
}

/** Load all TRD paths for combined workstream helpers. */
function loadWorkstreamItems(trdPaths) {
  const paths = Array.isArray(trdPaths) ? trdPaths : [];
  return paths.map((trdPath) => {
    const { slug, parsed, prdContext } = loadParsed(trdPath);
    return { trdPath, slug, parsed, prdContext };
  });
}

/** `validate-workstream <trd-path...>` -> all-or-nothing validation. */
function runValidateWorkstream(argv) {
  const { positionals } = parseArgs(argv);
  if (positionals.length < 2) {
    throw new Error('validate-workstream requires two or more TRD paths');
  }
  const items = loadWorkstreamItems(positionals);
  return validateWorkstream(items);
}

/** `create-workstream-trd <trd-path...> [--out path]` -> write normalized executable TRD. */
function runCreateWorkstreamTrd(argv) {
  const { positionals, flags } = parseArgs(argv, new Set(['out']));
  if (positionals.length < 2) {
    throw new Error('create-workstream-trd requires two or more TRD paths');
  }
  const items = loadWorkstreamItems(positionals);
  const generated = generateWorkstreamTrd(items, { allowInvalid: flags['allow-invalid'] === true });
  if (!generated.ok) return generated;
  const outPath = flags.out || nextWorkstreamPath('docs/TRD/workstreams', new Date().getFullYear(), generated.workstreamSlug);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, generated.markdown);
  return { ok: true, path: outPath, workstreamSlug: generated.workstreamSlug, sourceTrds: positionals, errors: generated.errors || [] };
}

/** `workstream-plan <trd-path...> [--stacked]` -> release train + per-TRD scaffold plans. */
function runWorkstreamPlan(argv, env) {
  const { positionals, flags } = parseArgs(argv);
  if (positionals.length < 2) {
    throw new Error('workstream-plan requires two or more TRD paths');
  }
  const items = loadWorkstreamItems(positionals);
  const stackedPrs = flags.stacked === true ? true : useStackedPrs(env || {});
  const plan = buildWorkstreamPlan(items, { stackedPrs });
  const crossTrd = resolveCrossTrdDeps(plan.scaffoldPlans);
  return { ...plan, ok: plan.ok && crossTrd.ok, crossTrd };
}

/** `workstream-status [--workstream slug] [--issues-json path]` -> combined status summary. */
function runWorkstreamStatus(argv) {
  const { flags } = parseArgs(argv, new Set(['workstream', 'issues-json']));
  let issuesInput = [];
  if (flags['issues-json']) {
    const raw = fs.readFileSync(flags['issues-json'], 'utf8');
    issuesInput = JSON.parse(raw);
  }
  return summarizeWorkstream(issuesInput, { workstreamSlug: flags.workstream || null });
}
// ---------------------------------------------------------------------------
// Frontmatter scanner — handles H1-then-frontmatter layout used by TRD/PRDs
// ---------------------------------------------------------------------------

/**
 * Parse a markdown file that may have a title/H1 before the frontmatter block.
 * Strategy:
 * 1. Find first `---` on its own line → frontmatter start
 * 2. Find second `---` on its own line → frontmatter end
 * 3. If yaml is available, use it; otherwise fall back to parseSimpleFrontmatter
 * Returns { frontmatter, body, yamlFailed } where yamlFailed=true when the
 * yaml parser threw (indicating the frontmatter uses non-standard syntax
 * such as bold-keyed lines).
 *
 * @param {string} md
 * @returns {{frontmatter: Object|null, body: string, yamlFailed: boolean}}
 */
function scanFrontmatter(md) {
  const lines = md.split('\n');
  let start = -1;
  let end = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      if (start === -1) start = i;
      else if (start !== -1 && end === -1) { end = i; break; }
    }
  }
  if (start === -1 || end === -1) {
    return { frontmatter: null, body: md, yamlFailed: false };
  }
  const raw = lines.slice(start + 1, end).join('\n');
  let frontmatter = null;
  let yamlFailed = false;
  if (yaml) {
    try {
      const loaded = yaml.load(raw);
      if (loaded && typeof loaded === 'object') frontmatter = loaded;
    } catch {
      yamlFailed = true;
    }
  }
  if (!frontmatter) { frontmatter = parseSimpleFrontmatter(raw); yamlFailed = true; }
  const body = lines.slice(end + 1).join('\n');
  return { frontmatter, body, yamlFailed };
}

/** Minimal key:value parser used as fallback when yaml is unavailable. */
function parseSimpleFrontmatter(raw) {
  const out = {};
  for (const line of String(raw || '').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const m = trimmed.match(/^([^:]+):\s*(.*)$/);
    if (!m) continue;
    const key = m[1].trim();
    let value = m[2].trim();
    const commentIndex = value.search(/\s+#/);
    if (commentIndex !== -1) value = value.slice(0, commentIndex).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    } else if (/^-?\d+(?:\.\d+)?$/.test(value)) {
      value = Number(value);
    } else if (/^(true|false)$/i.test(value)) {
      value = /^true$/i.test(value);
    }
    out[key] = value;
  }
  return Object.keys(out).length ? out : null;
}

// ---------------------------------------------------------------------------
// Registry subcommands — list, status, migrate-frontmatter
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------

const VALID_STATUSES = new Set(['Draft', 'In Progress', 'Approved', 'Completed', 'Deprecated']);

/**
 * Infer status from frontmatter status field + bead state.
 * If frontmatter status is present and valid, use it.
 * Otherwise derive from bead state: has open/in_progress beads → "In Progress"
 * Fallback: "Draft".
 *
 * @param {Object|null} frontmatter
 * @param {string} slug
 * @param {Object} beadCounts  {total, open, in_progress, closed}
 */
function inferStatus(frontmatter, slug, beadCounts) {
  const declared = getFrontmatterField(frontmatter, 'status');
  if (declared) {
    const s = String(declared).trim();
    if (VALID_STATUSES.has(s)) return s;
  }
  if (beadCounts && (beadCounts.open > 0 || beadCounts.in_progress > 0)) {
    return 'In Progress';
  }
  return 'Draft';
}

/**
 * Run `br list --all --json` and return counts for beads whose title
 * contains the given slug prefix.
 * @param {string} slug
 * @returns {Object} {total, open, in_progress, closed}
 */
function getBeadCounts(slug) {
  try {
    const { execSync } = require('child_process');
    const needle = `[trd:${slug}:`;
    let raw;
    try {
      raw = execSync('br list --all --json', { cwd: process.cwd(), timeout: 10000 });
    } catch {
      return { total: 0, open: 0, in_progress: 0, closed: 0 };
    }
    const beads = JSON.parse(raw.toString('utf8'));
    const matches = (Array.isArray(beads) ? beads : []).filter(
      (b) => (b.title || '').includes(needle)
    );
    return {
      total: matches.length,
      open: matches.filter((b) => b.status === 'open').length,
      in_progress: matches.filter((b) => b.status === 'in_progress').length,
      closed: matches.filter((b) => b.status === 'closed').length,
    };
  } catch {
    return { total: 0, open: 0, in_progress: 0, closed: 0 };
  }
}

/**
 * Compute staleness in days from file mtime.
 * @param {string} filePath
 * @returns {number}
 */
function stalenessDays(filePath) {
  try {
    const mtime = fs.statSync(filePath).mtime;
    return Math.floor((Date.now() - mtime.getTime()) / (1000 * 60 * 60 * 24));
  } catch {
    return 0;
  }
}

/**
 * `list [--type trd|prd] [--dir <path>]` -> { ok:true, items:[…] }
 * Scans the given directory for .md files, parses frontmatter, returns
 * a JSON array sorted by filename.
 */
function runList(argv) {
  const { positionals, flags } = parseArgs(argv, new Set(['type', 'dir']));

  const docType = flags.type || 'trd';
  if (docType !== 'trd' && docType !== 'prd') {
    throw new Error(`--type must be 'trd' or 'prd', got '${docType}'`);
  }

  const scanDir =
    flags.dir ||
    path.join(process.cwd(), docType === 'trd' ? 'docs/TRD' : 'docs/PRD');

  let files;
  try {
    files = fs.readdirSync(scanDir).filter((f) => f.endsWith('.md'));
  } catch (err) {
    throw new Error(`Cannot read directory '${scanDir}': ${err.message}`);
  }

  const items = [];
  for (const file of files.sort()) {
    const filePath = path.join(scanDir, file);
    let raw;
    try {
      raw = fs.readFileSync(filePath, 'utf8');
    } catch {
      continue;
    }

    const { frontmatter } = scanFrontmatter(raw);
    const slug = deriveSlug(filePath);
    const beadCounts = docType === 'trd' ? getBeadCounts(slug) : { total: 0, open: 0, in_progress: 0, closed: 0 };
    const status = inferStatus(frontmatter, slug, beadCounts);
    const design_readiness_score =
      extractDesignReadinessScore(frontmatter);

    let lastModified;
    try {
      lastModified = fs.statSync(filePath).mtime.toISOString();
    } catch {
      lastModified = null;
    }

    // Determine document_id from frontmatter or filename
    const frontmatterId = getFrontmatterField(frontmatter, 'document_id', 'id', 'documentId');
    const version = getFrontmatterField(frontmatter, 'version');

    items.push({
      id: frontmatterId || slug,
      slug,
      status,
      design_readiness_score,
      version: version ? String(version) : null,
      prd_reference: getFrontmatterField(frontmatter, ...PRD_REFERENCE_KEYS) || null,
      last_modified: lastModified,
      total_beads: beadCounts.total,
      open_beads: beadCounts.open,
      in_progress_beads: beadCounts.in_progress,
      closed_beads: beadCounts.closed,
    });
  }

  return { ok: true, type: docType, items };
}

/**
 * `status <slug> [--type trd|prd] [--dir <path>]` -> { ok:true, … }
 * Takes a slug (filename stem), resolves to the .md file, parses frontmatter,
 * queries bead counts, returns full detail object.
 */
function runStatus(argv) {
  const { positionals, flags } = parseArgs(argv, new Set(['type', 'dir']));
  const slug = positionals[0];
  if (!slug) throw new Error('Missing required <slug> argument');

  const docType = flags.type || 'trd';
  const scanDir =
    flags.dir ||
    path.join(process.cwd(), docType === 'trd' ? 'docs/TRD' : 'docs/PRD');

  // Find matching file: exact → suffix (slug ends with) → prefix (slug starts with)
  let filePath;
  try {
    const files = fs.readdirSync(scanDir).filter((f) => f.endsWith('.md'));
    const mapped = files.map((f) => ({ name: f, path: path.join(scanDir, f), slug: deriveSlug(f) }));
    const exact = mapped.find(({ slug: s }) => s === slug);
    const suffix = exact || mapped.find(({ slug: s }) => s.endsWith('-' + slug));
    const prefix = suffix || mapped.find(({ slug: s }) => s.startsWith(slug + '-'));
    filePath = prefix ? prefix.path : null;
  } catch (err) {
    throw new Error(`Cannot read directory '${scanDir}': ${err.message}`);
  }
  if (!filePath) throw new Error(`No ${docType.toUpperCase()} found with slug '${slug}'`);

  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    throw new Error(`Cannot read '${filePath}': ${err.message}`);
  }

  const { frontmatter } = scanFrontmatter(raw);
  const beadCounts = docType === 'trd' ? getBeadCounts(slug) : { total: 0, open: 0, in_progress: 0, closed: 0 };
  const status = inferStatus(frontmatter, slug, beadCounts);
  const design_readiness_score = extractDesignReadinessScore(frontmatter);
  const completion_pct =
    beadCounts.total > 0
      ? parseFloat(((beadCounts.closed / beadCounts.total) * 100).toFixed(1))
      : null;
  const days = stalenessDays(filePath);
  const version = getFrontmatterField(frontmatter, 'version');

  return {
    ok: true,
    type: docType,
    slug,
    file: filePath,
    status,
    design_readiness_score,
    completion_pct,
    staleness_days: days,
    version: version ? String(version) : null,
    prd_reference: getFrontmatterField(frontmatter, ...PRD_REFERENCE_KEYS) || null,
    bead_counts: beadCounts,
    frontmatter: frontmatter || {},
  };
}

/**
 * `migrate-frontmatter <dir>` -> { ok:true, migrated:[…], errors:[…] }
 * Reads all .md files in the given directory, fills missing status: Draft,
 * recomputes design_readiness_score (stub — scoring logic lives in evaluator),
 * and writes the updated frontmatter back.
 *
 * Uses scanFrontmatter (handles H1-then-frontmatter layout) and re-serialises.
 * Scoring is stubbed: design_readiness_score left as-is if present, else null.
 */
function runMigrateFrontmatter(argv) {
  const { positionals, flags } = parseArgs(argv, new Set([]));
  const dir = positionals[0];
  if (!dir) throw new Error('Missing required <dir> argument');

  const absDir = path.resolve(dir);
  if (!fs.existsSync(absDir) || !fs.statSync(absDir).isDirectory()) {
    throw new Error(`'${absDir}' is not a directory`);
  }

  let files;
  try {
    files = fs.readdirSync(absDir).filter((f) => f.endsWith('.md'));
  } catch (err) {
    throw new Error(`Cannot read directory '${absDir}': ${err.message}`);
  }

  const migrated = [];
  const errors = [];

  for (const file of files) {
    const filePath = path.join(absDir, file);
    let raw;
    try {
      raw = fs.readFileSync(filePath, 'utf8');
    } catch (err) {
      errors.push({ file, error: `read failed: ${err.message}` });
      continue;
    }

    const { frontmatter, body, yamlFailed } = scanFrontmatter(raw);
    const fm = Object.assign({}, frontmatter || {});

    let changed = false;
    if (!fm.status || fm.status === '') {
      fm.status = 'Draft';
      changed = true;
    }
    // Only add design_readiness_score when YAML parsing succeeded and the field
    // is truly absent (undefined key, not null). This avoids re-migrating files
    // where YAML null (from `key:` or a previous migration) would otherwise
    // always trigger a re-write.
    if (!yamlFailed && !Object.prototype.hasOwnProperty.call(fm, 'design_readiness_score')) {
      fm.design_readiness_score = null;
      changed = true;
    }

    if (!changed) {
      migrated.push({ file, action: 'unchanged' });
      continue;
    }

    // Only re-serialise when YAML succeeded (safe round-trip)
    if (!yamlFailed) {
      const fmLines = Object.entries(fm).map(([k, v]) => {
        const val = v === null ? 'null' : String(v);
        return `${k}: ${val}`;
      });
      const newContent = `---\n${fmLines.join('\n')}\n---\n${body}`;
      try {
        fs.writeFileSync(filePath, newContent, 'utf8');
        migrated.push({ file, action: 'migrated', changes: Object.keys(fm) });
      } catch (err) {
        errors.push({ file, error: `write failed: ${err.message}` });
      }
    } else {
      // YAML failed — file uses bold-keyed format; log as skipped
      migrated.push({ file, action: 'skipped', reason: 'bold-keyed frontmatter (YAML parse failed)' });
    }
  }

  return { ok: true, migrated, errors };
}
// Workflow choices persistence
// ---------------------------------------------------------------------------

const CHOICES_KEY = 'ensemble_implement_trd_beads';

/**
 * `choices-read <trd-path>` -> { ok:true, choices:{ branch_name, use_proposed, stacked_prs } }
 *
 * Reads only the `ensemble_implement_trd_beads:` block from the TRD frontmatter.
 * Returns empty strings/false for missing keys rather than erroring.
 */
function runChoicesRead(argv) {
  const { positionals } = parseArgs(argv);
  const trdPath = positionals[0];
  if (!trdPath) throw new Error('Missing required <trd-path> argument');

  const text = fs.readFileSync(trdPath, 'utf8');

  // Find first frontmatter block: lines between first two `---`
  const lines = text.split('\n');
  const fmStart = lines.findIndex((l) => l.trim() === '---');
  if (fmStart === -1) {
    // No frontmatter at all
    return { ok: true, choices: { branch_name: '', use_proposed: false, stacked_prs: false } };
  }
  const fmEnd = lines.findIndex((l, i) => i > fmStart && l.trim() === '---');
  if (fmEnd === -1) {
    // Unclosed frontmatter
    return { ok: true, choices: { branch_name: '', use_proposed: false, stacked_prs: false } };
  }

  // Extract ensemble_implement_trd_beads: block
  const fmLines = lines.slice(fmStart + 1, fmEnd);
  let inBlock = false;
  let branchName = '';
  let useProposed = false;
  let stackedPrs = false;

  for (const line of fmLines) {
    if (line.match(new RegExp(`^\\s*${CHOICES_KEY}\\s*:`))) {
      inBlock = true;
      continue;
    }
    if (inBlock) {
      const trimmed = line.trim();
      // End of block: un-indented non-empty line — stop parsing choices
      if (trimmed !== '' && !line.startsWith(' ') && !line.startsWith('\t')) {
        break; // do NOT re-process as top-level — block is authoritative
      }
      // Indented child line — parse key:value
      const colonIdx = trimmed.indexOf(':');
      if (colonIdx > 0) {
        const key = trimmed.slice(0, colonIdx).trim();
        const val = trimmed.slice(colonIdx + 1).trim();
        if (key === 'branch_name') branchName = val.replace(/^['"]|['"]$/g, '');
        else if (key === 'use_proposed') useProposed = val === 'true';
        else if (key === 'stacked_prs') stackedPrs = val === 'true';
      }
    }
  }

  return { ok: true, choices: { branch_name: branchName, use_proposed: useProposed, stacked_prs: stackedPrs } };
}

/**
 * `choices-write <trd-path> [--branch-name x] [--use-proposed] [--stacked-prs]`
 *
 * Performs a surgical textual upsert of only the `ensemble_implement_trd_beads:` block
 * in the TRD frontmatter. Every other line is preserved verbatim.
 */
function runChoicesWrite(argv) {
  const { flags } = parseArgs(argv, new Set(['branch-name']));
  const trdPath = argv[0];
  if (!trdPath) throw new Error('Missing required <trd-path> argument');

  const text = fs.readFileSync(trdPath, 'utf8');
  const lines = text.split('\n');

  const fmStart = lines.findIndex((l) => l.trim() === '---');
  if (fmStart === -1) {
    throw new Error('TRD has no frontmatter — cannot write choices');
  }
  const fmEnd = lines.findIndex((l, i) => i > fmStart && l.trim() === '---');
  if (fmEnd === -1) {
    throw new Error('TRD frontmatter is unclosed');
  }

  const branchName = flags['branch-name'] != null ? String(flags['branch-name']) : '';
  const useProposed = !!flags['use-proposed']; // boolean flag — true when present
  const stackedPrs = !!flags['stacked-prs'];   // boolean flag — true when present

  // Top-level YAML key + indented children
  const newBlockLines = [
    `${CHOICES_KEY}:`,
    `  branch_name: ${branchName}`,
    `  use_proposed: ${useProposed}`,
    `  stacked_prs: ${stackedPrs}`,
  ];

  // Build replacement: find existing block, replace or insert
  const beforeFm = lines.slice(0, fmStart + 1);
  const afterFmEnd = lines.slice(fmEnd);

  const fmBody = lines.slice(fmStart + 1, fmEnd);
  const blockStartIdx = fmBody.findIndex((l) => l.match(new RegExp(`^\\s*${CHOICES_KEY}\\s*:`)));
  const blockEndIdx = blockStartIdx !== -1
    ? fmBody.findIndex((l, i) => i > blockStartIdx && l.trim() !== '' && !l.startsWith(' ') && !l.startsWith('\t'))
    : -1;

  let newFmBody;
  if (blockStartIdx !== -1) {
    // Replace existing block
    const endIdx = blockEndIdx !== -1 ? blockEndIdx : fmBody.length;
    const before = fmBody.slice(0, blockStartIdx);
    const after = fmBody.slice(endIdx);
    newFmBody = [...before, ...newBlockLines, ...after];
  } else {
    // No existing block — append just before the closing --- (safe, unambiguous)
    newFmBody = [...fmBody, ...newBlockLines];
  }

  const newText = [...beforeFm, ...newFmBody, ...afterFmEnd].join('\n');
  fs.writeFileSync(trdPath, newText, 'utf8');
  return { ok: true };
}

// ---------------------------------------------------------------------------
// CLI dispatch
// ---------------------------------------------------------------------------
// CLI dispatch
// ---------------------------------------------------------------------------

const HANDLERS = {
  parse: (argv) => runParse(argv),
  'scaffold-plan': (argv) => runScaffoldPlan(argv),
  'phase-status': (argv) => runPhaseStatus(argv),
  'next-task': (argv) => runNextTask(argv, process.env),
  'pr-plan': (argv) => runPrPlan(argv, process.env),
  'resolve-sdlc': (argv) => runResolveSdlc(argv, process.env),
  'validate-workstream': (argv) => runValidateWorkstream(argv),
  'create-workstream-trd': (argv) => runCreateWorkstreamTrd(argv),
  'workstream-plan': (argv) => runWorkstreamPlan(argv, process.env),
  'workstream-status': (argv) => runWorkstreamStatus(argv),
  quickstart: (argv) => runQuickstart(argv),
  'choices-read': (argv) => runChoicesRead(argv),
  'choices-write': (argv) => runChoicesWrite(argv),
  list: (argv) => runList(argv),
  status: (argv) => runStatus(argv),
  'migrate-frontmatter': (argv) => runMigrateFrontmatter(argv),
};

/**
 * Entry point. Prints exactly one JSON object to stdout. Returns the process
 * exit code (0 success, 1 failure). Does NOT call process.exit itself when
 * imported with `return`-style use; the CLI wrapper below handles exit.
 *
 * @param {string[]} argv  argv WITHOUT node + script (i.e. process.argv.slice(2))
 * @returns {number} exit code
 */
function main(argv) {
  const list = Array.isArray(argv) ? argv : [];
  const subcommand = list[0];
  const rest = list.slice(1);

  if (!subcommand) {
    process.stdout.write(
      JSON.stringify({
        error:
          'Missing subcommand. Usage: trd-cli <parse|scaffold-plan|phase-status|next-task|pr-plan|resolve-sdlc|validate-workstream|create-workstream-trd|workstream-plan|workstream-status|quickstart|list|status|migrate-frontmatter|choices-read|choices-write> <trd-path> [...]',
      }) + '\n'
    );
    return 1;
  }

  const handler = HANDLERS[subcommand];
  if (!handler) {
    process.stdout.write(
      JSON.stringify({ error: `Unknown subcommand '${subcommand}'` }) + '\n'
    );
    return 1;
  }

  try {
    const result = handler(rest);
    // Guard against accidental undefined-throwing during serialization.
    const json = JSON.stringify(result);
    if (typeof json !== 'string') {
      throw new Error('Result was not JSON-serializable');
    }
    process.stdout.write(json + '\n');
    return 0;
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    process.stdout.write(JSON.stringify({ error: message }) + '\n');
    return 1;
  }
}

module.exports = {
  runParse,
  runScaffoldPlan,
  runPhaseStatus,
  runNextTask,
  runPrPlan,
  runResolveSdlc,
  runQuickstart,
  runValidateWorkstream,
  runCreateWorkstreamTrd,
  runWorkstreamPlan,
  runWorkstreamStatus,
  main,
  runChoicesRead,
  runChoicesWrite,
  runList,
  runStatus,
  runMigrateFrontmatter,
  // exported for unit testing of the helpers
  deriveSlug,
  parseArgs,
};

if (require.main === module) {
  const code = main(process.argv.slice(2));
  process.exit(code);
}
