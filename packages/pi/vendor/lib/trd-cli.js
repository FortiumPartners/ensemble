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
 *   bead-context --bead <bead-id> [--trd <path>] [--issue-json <file>]   (read by the bead executors before ANY work)
 *   phase-status <trd-path> [--closed a,b,c]
 *   next-task    <trd-path> --ready a,b [--closed a,b] [--max N]
 *   pr-plan      <trd-path> [--stacked]
 *   validate-workstream <trd-path...>
 *   create-workstream-trd <trd-path...> [--out path] [--allow-invalid]   (run by /ensemble:implement-trd-beads --workstream)
 *   workstream-plan <trd-path...> [--stacked]
 *   workstream-status [--workstream slug] [--issues-json path]
 *   beads-label --label <l> --match <title-substring>
 *   beads-stage --match <title-substring> [--label <l>] [--check] [--dry-run]
 *   quickstart <trd-path> --out <path> [--json]
 *   resolve-sdlc --git-town-exit-code <0-4> --remote-url <url>
 *   validate     <trd-path> [--prd path]
 *   analyze      <trd-path> [--prd path]
 *   req-status   <trd-path> [--prd path] [--issues-json file] [--verified REQ-001,...] [--comments-json file]
 *   verify       <trd-path> [--prd path] [--mode m] [--beads-evidence file] [--run-tests] [--report-path p]
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

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
const { validateTrd, analyzeTrd, requirementStatus, evidenceFromComments, isChecked } = require('./trd-checks');
const { buildChain } = require('./verify-requirements-evidence');
const { buildScaffoldPlan } = require('./scaffold-planner');
const {
  parseReferencesBlock,
  parseTitlePrefix,
  kindFromRefs,
  UNRESOLVED_SUFFIX,
} = require('./bead-refs');
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
const { ensureLabel } = require('./beads-label');
const { stageBeadsExport, checkStagedExport } = require('./beads-stage');
const { resolveCategory } = require('./toolchain/config');
const { loadAdapter } = require('./toolchain/adapters');
const { detectAdapter } = require('./toolchain/detect');
const { runCapabilitySync } = require('./toolchain/runner');

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
    path.resolve(repoRoot(), prdRef),                   // relative to the repo root
  ];
  for (const c of candidates) {
    try {
      fs.accessSync(c, fs.constants.R_OK);
      if (fs.statSync(c).isFile()) return c;
    } catch {
      // try next candidate
    }
  }
  return null;
}

/** Forward-slash a path. */
function toPosix(p) {
  return String(p == null ? '' : p).replace(/\\/g, '/');
}

/** `git rev-parse --show-toplevel` of the cwd, falling back to the cwd (not a git repo / no git). */
function repoRoot() {
  try {
    const out = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (out) return out;
  } catch {
    // fall through
  }
  return process.cwd();
}

/** Repo-root-relative forward-slash form of `p`; stays absolute if `p` lies outside the repo. */
function toRepoRelative(p, root) {
  const real = (x) => {
    try { return fs.realpathSync(x); } catch { return x; }
  };
  const abs = real(path.resolve(String(p || '')));
  const rel = path.relative(real(root), abs);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return toPosix(abs);
  return toPosix(rel);
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
 * Repo-root-relative reference paths for a TRD, as written into every bead's References block:
 * { trdFilePath, prdFilePath, prdUnresolved }. prdFilePath is the raw reference when unresolved
 * and '' when the TRD names no PRD.
 */
function referencePaths(trdPath, parsed) {
  const root = repoRoot();
  const prdRef = (parsed && parsed.prdReference) || '';
  const prdAbs = resolvePrd(prdRef, trdPath);
  return {
    trdFilePath: toRepoRelative(trdPath, root),
    prdFilePath: prdAbs ? toRepoRelative(prdAbs, root) : toPosix(prdRef),
    prdUnresolved: !!prdRef && !prdAbs,
  };
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
    ...referencePaths(trdPath, parsed),
    prdContext,
  });
  return { ok: true, slug, plan };
}

/**
 * Resolve and load the adapter manifest for the `tracker` category through the same
 * `resolveCategory`/`loadAdapter` pipeline `toolchain-cli.js#run` uses for every other
 * capability call (TRD-2026-8d825f54 TRD-025, PRD AC-016-2) -- never `br`/`bv` directly.
 * Confirmation/ledger/preflight gating (TRD-014/015/017) governs only the shell-invoked
 * `toolchain-cli run` surface; this in-process CLI routing intentionally omits it, matching
 * every capability this file calls (`tracker.show`, `tracker.list`), neither of which
 * `tracker.yaml` declares `sideEffect:true`.
 *
 * @returns {{manifest: object, source: string}}
 * @throws {Error} whatever `resolveCategory`/`loadAdapter` throws -- never caught here, so a
 *   caller decides whether an unresolved tracker is fatal (`bead-context`) or swallowed
 *   (`getBeadCounts`).
 */
function resolveTrackerAdapter() {
  const projectRoot = process.cwd();
  const env = process.env;
  const resolved = resolveCategory('tracker', { projectRoot, env, detect: detectAdapter });
  const loaded = loadAdapter(resolved.value, { projectRoot, env, interactive: false });
  return { manifest: loaded.manifest, source: resolved.source };
}

/**
 * `bead-context --bead <id> [--trd <path>] [--issue-json <file>]`
 *
 * Resolves a bead's `## References` block (or, for legacy beads without one, its title
 * prefix + `--trd`), re-reads the referenced TRD task / PRD requirements LIVE and returns
 * them. `ok:false` (and exit 1) when anything referenced cannot be resolved, with every
 * problem listed in `missing`.
 */
function runBeadContext(argv) {
  const { flags } = parseArgs(argv, new Set(['bead', 'trd', 'issue-json']));
  const beadId = flags.bead && flags.bead !== true ? String(flags.bead) : '';
  if (!beadId) throw new Error('Missing required --bead <bead-id> argument');
  const root = repoRoot();
  const missing = [];
  const out = {
    ok: false,
    beadId,
    source: null,
    kind: null,
    references: { trd: null, trdTask: null, prd: null, prdRequirements: [], prdAcs: [] },
    context: { trdTask: null, prdRequirements: [], architectureDecision: null, keyTechnicalDecisions: [] },
    missing,
  };

  // ---- load the bead -------------------------------------------------------
  let issue = null;
  try {
    if (flags['issue-json'] && flags['issue-json'] !== true) {
      const raw = fs.readFileSync(String(flags['issue-json']), 'utf8');
      const data = JSON.parse(raw);
      issue = Array.isArray(data) ? data[0] : data;
    } else {
      const { manifest } = resolveTrackerAdapter();
      // Synchronous: killed-on-timeout containment is direct-child-only, never a detached
      // descendant (runner.js's "## runCapabilitySync" header section) -- acceptable here
      // since `tracker.show` is a short, one-shot `br` read.
      const result = runCapabilitySync(manifest, 'tracker.show', { id: beadId }, {
        execFileOptions: { cwd: process.cwd() },
      });
      if (!result.ok) {
        const err = new Error(result.error.message);
        err.code = result.error.code;
        throw err;
      }
      issue = result.data;
    }
  } catch (err) {
    missing.push(`bead ${beadId} could not be loaded: ${err && err.message ? err.message.split('\n')[0] : err}`);
    return out;
  }
  if (!issue || typeof issue !== 'object') {
    missing.push(`bead ${beadId} not found`);
    return out;
  }
  const title = String(issue.title || '');
  const description = String(issue.description || '');
  const titleInfo = parseTitlePrefix(title);
  const block = parseReferencesBlock(description);
  const trdFlag = flags.trd && flags.trd !== true ? String(flags.trd) : '';

  // ---- resolve references (description block, else legacy fallback) -----------
  let trdRel = '';
  let trdTaskId = '';
  let prdRel = '';
  let prdRawUnresolved = false;
  let reqIds = [];
  let acIds = [];
  let prdFallback = false;

  if (block) {
    out.source = 'description';
    trdRel = block.trd;
    trdTaskId = block.trdTask ? block.trdTask.id : '';
    prdRel = block.prd;
    prdRawUnresolved = block.prdUnresolved;
    reqIds = block.prdRequirements.map((r) => r.id);
    acIds = block.prdAcs.slice();
    if (!trdRel) missing.push('References block has no TRD line');
    out.kind = (titleInfo && titleInfo.kind) || kindFromRefs(block);
  } else {
    out.source = 'fallback';
    if (!titleInfo) {
      missing.push(`bead has no ## References block and its title has no [trd:<slug>...] prefix: '${title}'`);
    }
    if (!trdFlag) {
      missing.push('bead has no ## References block and no --trd <path> was given to fall back on');
    }
    if (missing.length) return out;
    out.kind = titleInfo.kind;
    const trdFound = [trdFlag, path.resolve(root, trdFlag)].find((c) => {
      try { return fs.statSync(c).isFile(); } catch { return false; }
    });
    trdRel = toRepoRelative(trdFound || trdFlag, root);
    trdTaskId = titleInfo.taskId || '';
    prdFallback = true;
  }
  out.references.trd = trdRel || null;
  if (!trdRel) return out;

  // ---- TRD -------------------------------------------------------------------
  const trdAbs = path.resolve(root, trdRel);
  let parsed = null;
  try {
    parsed = parseTRD(fs.readFileSync(trdAbs, 'utf8'));
  } catch (err) {
    missing.push(`TRD file ${trdRel} cannot be read: ${err.code || err.message}`);
  }

  let task = null;
  if (parsed && trdTaskId) {
    const key = Object.keys(parsed.tasksById || {}).find((k) => k.toLowerCase() === trdTaskId.toLowerCase());
    task = key ? parsed.tasksById[key] : null;
    if (!task) missing.push(`TRD task ${trdTaskId} not found in ${trdRel}`);
  }
  if (trdTaskId) {
    out.references.trdTask = `${trdRel}#${trdTaskId.toLowerCase()}`;
  }
  if (task) {
    out.context.trdTask = {
      id: task.id,
      description: task.description,
      targetFiles: task.targetFiles || [],
      actions: task.actions || [],
      implementationAc: task.implementationAc || [],
      testAc: task.testAc || [],
      dependsOn: task.dependsOn || [],
    };
    if (out.kind === 'task' && task.isTest) out.kind = 'test';
  }
  if (parsed) {
    out.context.architectureDecision = parsed.architectureDecision || null;
    out.context.keyTechnicalDecisions = parsed.keyTechnicalDecisions || [];
  }

  // ---- PRD -------------------------------------------------------------------
  if (prdFallback) {
    const ref = parsed ? parsed.prdReference || '' : '';
    if (ref) {
      const abs = resolvePrd(ref, trdAbs);
      if (abs) prdRel = toRepoRelative(abs, root);
      else { prdRel = toPosix(ref); prdRawUnresolved = true; }
    }
    if (task) {
      reqIds = (task.satisfies || []).filter((s) => !/^(INFRA|ARCH)$/i.test(String(s).trim())).map((s) => String(s).trim());
      acIds = (task.validatesAcs || []).map((a) => String(a).trim());
    }
  }
  out.references.prd = prdRel ? `${prdRel}${prdRawUnresolved ? UNRESOLVED_SUFFIX : ''}` : null;
  out.references.prdRequirements = reqIds;
  out.references.prdAcs = acIds;

  if (prdRawUnresolved) {
    missing.push(`PRD ${prdRel} is UNRESOLVED (the TRD names a PRD that could not be found)`);
  } else if (prdRel) {
    let prdCtx = null;
    try {
      prdCtx = extractPrdContext(fs.readFileSync(path.resolve(root, prdRel), 'utf8'));
    } catch (err) {
      missing.push(`PRD file ${prdRel} cannot be read: ${err.code || err.message}`);
    }
    if (prdCtx) {
      // Anchors are lower-cased in the block, so recover ids case-insensitively against the PRD.
      const ciKey = (map, id) => Object.keys(map).find((k) => k.toLowerCase() === String(id).toLowerCase());
      const resolvedReqIds = [];
      for (const id of reqIds) {
        const reqKey = ciKey(prdCtx.requirements, id);
        if (!reqKey) {
          resolvedReqIds.push(id.toUpperCase());
          missing.push(`PRD requirement ${id.toUpperCase()} not found in ${prdRel}`);
          continue;
        }
        const req = prdCtx.requirements[reqKey];
        resolvedReqIds.push(req.id);
        // The ACs the bead lists that belong to THIS requirement; when it lists none of its own
        // (e.g. a secondary REQ of a multi-REQ task), fall back to all of the requirement's ACs.
        const owned = (req.acIds || []).map((a) => String(a));
        const listed = acIds.map((a) => ciKey(prdCtx.acs, a)).filter((k) => k && prdCtx.acs[k].reqId === req.id);
        const acs = (listed.length ? listed : owned.map((a) => ciKey(prdCtx.acs, a)).filter(Boolean))
          .map((k) => prdCtx.acs[k])
          .map((ac) => ({ id: ac.id, given: ac.given, when: ac.when, then: ac.then, text: ac.text }));
        out.context.prdRequirements.push({ id: req.id, title: req.title, text: req.text, acs });
      }
      out.references.prdRequirements = resolvedReqIds;
    }
  } else if (reqIds.length) {
    missing.push(`bead references PRD requirement(s) ${reqIds.join(', ')} but no PRD is referenced`);
  }

  out.ok = missing.length === 0;
  return out;
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

// Legacy `ENSEMBLE_PR_BACKEND` values (pr-strategy.js's `gh`/`ado`/`manual`, REQ-006) predate
// the toolchain resolver's adapter-name vocabulary (TRD-036 `github`, TRD-040 `azure-devops`).
// `workflow`'s legacy `ENSEMBLE_BRANCHING_STRATEGY` vocabulary (`git-town`/`plain-git`) already
// matches adapter names 1:1, so only `host` needs this translation. Applied to a CLONE of `env`
// BEFORE calling `resolveCategory('host', ...)` so config.js's generic, category-agnostic
// ENV_COMPAT precedence step (TRD-003) keeps reading `ENSEMBLE_PR_BACKEND` verbatim and still
// reports `source: 'env-compat'` -- config.js itself must never special-case host's legacy
// spelling (TRD-037).
const LEGACY_HOST_BACKEND_TO_ADAPTER = { gh: 'github', ado: 'azure-devops', manual: 'manual' };

function translateHostEnvCompat(env) {
  const raw = (env || {}).ENSEMBLE_PR_BACKEND;
  const adapterName = raw != null ? LEGACY_HOST_BACKEND_TO_ADAPTER[raw] : undefined;
  if (adapterName == null) return env || {};
  return { ...(env || {}), ENSEMBLE_PR_BACKEND: adapterName };
}

/**
 * `resolve-sdlc --git-town-exit-code <0-4> --remote-url <url>`
 *   -> { ok:true, branchingStrategy, prBackend, consolidatedMessage, host, workflow }
 *
 * Thin CLI adapter over pr-strategy.js's resolveBranchingStrategy / resolvePrBackend /
 * buildConsolidatedResolutionMessage (TRD §1.1-1.4) for the pre-existing `branchingStrategy` /
 * `prBackend` / `consolidatedMessage` fields -- kept byte-for-byte so every existing caller of
 * this command is unchanged (TRD-037, AC-037-2/3). Reads ENSEMBLE_BRANCHING_STRATEGY /
 * ENSEMBLE_PR_BACKEND from the `env` param rather than process.env directly, matching
 * runPrPlan/runNextTask's pattern for testability.
 *
 * Additionally delegates host/workflow resolution to the toolchain resolver
 * (`./toolchain/config.js#resolveCategory`, TRD-003/TRD-036), through the SAME
 * resolveCategory/detectAdapter pipeline `resolveTrackerAdapter` above uses, surfacing the
 * result as new `host`/`workflow` fields (TRD-037, AC-037-1). `ENSEMBLE_PR_BACKEND`'s legacy
 * `gh`/`ado`/`manual` vocabulary is translated to the toolchain's adapter-name vocabulary
 * before that call (see `translateHostEnvCompat` above); `ENSEMBLE_BRANCHING_STRATEGY` needs no
 * translation since its legacy `git-town`/`plain-git` values already are adapter names.
 */
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

  const projectRoot = process.cwd();
  const hostResolved = resolveCategory('host', {
    projectRoot,
    env: translateHostEnvCompat(env),
    detect: detectAdapter,
  });
  const workflowResolved = resolveCategory('workflow', { projectRoot, env: env || {}, detect: detectAdapter });

  return {
    ok: true,
    branchingStrategy,
    prBackend,
    consolidatedMessage,
    host: { adapter: hostResolved.value, source: hostResolved.source },
    workflow: { adapter: workflowResolved.value, source: workflowResolved.source },
  };
}

/** Load all TRD paths for combined workstream helpers. */
function loadWorkstreamItems(trdPaths) {
  const paths = Array.isArray(trdPaths) ? trdPaths : [];
  return paths.map((trdPath) => {
    const { slug, parsed, prdContext } = loadParsed(trdPath);
    return { trdPath, slug, parsed, prdContext, refs: referencePaths(trdPath, parsed) };
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

/** `create-workstream-trd <trd-path...> [--out path] [--allow-invalid]` -> write normalized executable TRD. Run by `/ensemble:implement-trd-beads --workstream`; with `--generate-only` the command stops after this call. */
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

/**
 * `beads-label --label <l> --match <substr>` -> { ok:true, label, matched, labeled, already }
 * Labels every bead whose title contains <substr> that lacks <l>. A "[trd:<slug>" substring (no
 * closing bracket) matches only that exact slug, not "[trd:<slug>-other...".
 */
function runBeadsLabel(argv) {
  const { flags } = parseArgs(argv, new Set(['label', 'match']));
  return { ok: true, ...ensureLabel({ label: flags.label, match: flags.match }) };
}

/**
 * `beads-stage --match <title-substring[,..]> [--label <l[,..]>] [--file <path>] [--check] [--dry-run]`
 * Stages only this TRD's beads from a tracked .beads/issues.jsonl into the git index (the working
 * file is left alone). A no-op when the export is not tracked. `--check` instead verifies the
 * STAGED export touches no other TRD's beads and throws (exit 1) naming the ones that do.
 */
function runBeadsStage(argv) {
  const { flags } = parseArgs(argv, new Set(['match', 'label', 'file']));
  const split = (v) => (typeof v === 'string' && v ? v.split(',').filter(Boolean) : []);
  const scope = { matches: split(flags.match), labels: split(flags.label) };
  if (!scope.matches.length && !scope.labels.length) throw new Error('beads-stage needs --match or --label');
  const file = typeof flags.file === 'string' && flags.file ? flags.file : undefined;

  if (flags.check) {
    const res = checkStagedExport({ ...scope, file });
    if (!res.ok) {
      throw new Error(
        `staged ${file || '.beads/issues.jsonl'} touches beads outside this TRD: ${res.foreign.join(', ')}. ` +
          'Run beads-stage to restage it.'
      );
    }
    return { ok: true, ...res };
  }
  return { ok: true, ...stageBeadsExport({ ...scope, file, dryRun: !!flags['dry-run'] }) };
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
 * Run `tracker.list` (via the resolved tracker adapter, TRD-025) and return counts for beads
 * whose title contains the given slug prefix.
 *
 * By contract (TRD-025 AC), EVERY failure -- adapter resolution, the runner call itself
 * (`TOOL_FAILED`/`TIMEOUT`/any other `runCapabilitySync` error code), a non-JSON or
 * unexpectedly-shaped `raw` -- is swallowed to the same `{total:0, open:0, in_progress:0,
 * closed:0}` zero envelope, never thrown or logged; this function intentionally has no way to
 * tell a caller "zero real matches" apart from "the read itself failed" -- that distinction is
 * only ever visible by calling `runCapabilitySync` directly (as this function does internally)
 * and inspecting its own `{ok:false, error:{code, message}}` envelope, never through this
 * function's return value. Do not change this swallow-to-zeros behavior: callers (CLI status
 * output, TRD staleness inference) were built around it.
 *
 * @param {string} slug
 * @returns {Object} {total, open, in_progress, closed}
 */
function getBeadCounts(slug) {
  try {
    const needle = `[trd:${slug}:`;
    let raw;
    try {
      const { manifest } = resolveTrackerAdapter();
      // Synchronous: killed-on-timeout containment is direct-child-only, never a detached
      // descendant (runner.js's "## runCapabilitySync" header section) -- acceptable here
      // since `tracker.list` is a short, one-shot `br` read; its real ~MB-scale output (TRD-024
      // reviewer round 2, P2) is handled by this same runner's 64 MiB default `maxBuffer`, not
      // by anything in this function.
      const result = runCapabilitySync(manifest, 'tracker.list', {}, {
        timeoutMs: 10000,
        execFileOptions: { cwd: process.cwd() },
      });
      if (!result.ok) return { total: 0, open: 0, in_progress: 0, closed: 0 };
      raw = result.data;
    } catch {
      return { total: 0, open: 0, in_progress: 0, closed: 0 };
    }
    // br 0.2.x wraps list output as { issues: [...] }; older versions print a bare array;
    // jira/azure-boards (PR 8 independent review item 5 / finding 5) declare a tracker.list
    // `parse` block, so `raw` for them is already the mapped `{items: [...]}` OBJECT, never a
    // JSON string -- `JSON.parse` would throw on a non-string. Branch on typeof first, then
    // apply the same issues-or-items unwrap either way.
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const beads = Array.isArray(parsed) ? parsed : (parsed && (parsed.issues || parsed.items)) || [];
    const matches = beads.filter((b) => (b.title || '').includes(needle));
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
// Requirement checks: validate / analyze / req-status / verify
// ---------------------------------------------------------------------------

/**
 * Load the TRD and its PRD. `--prd <path>` wins over the TRD's own PRD
 * reference; an explicit `--prd` that cannot be read is an error, an
 * unresolvable TRD reference degrades to "no PRD" (prdPath null).
 */
function loadWithPrd(positionals, flags) {
  const trdPath = positionals[0];
  const markdown = readTrd(trdPath);
  const parsed = parseTRD(markdown);
  let prdPath = null;
  if (flags.prd) {
    prdPath = resolvePrd(String(flags.prd), trdPath);
    if (!prdPath) throw new Error(`PRD file not found: ${flags.prd}`);
  } else if (parsed.prdReference) {
    prdPath = resolvePrd(parsed.prdReference, trdPath);
  }
  const prdMarkdown = prdPath ? fs.readFileSync(prdPath, 'utf8') : '';
  const prdContext = prdPath
    ? extractPrdContext(prdMarkdown)
    : { requirements: {}, acs: {} };
  return { trdPath, slug: deriveSlug(trdPath), parsed, prdPath, prdMarkdown, prdContext };
}

/**
 * `validate <trd-path> [--prd <path>]` -> { ok, errors[], warnings[], passed[], skipped[], stats }
 * `ok` is false when any error exists (callers translate that to a CI exit).
 */
function runValidate(argv) {
  const { positionals, flags } = parseArgs(argv, new Set(['prd']));
  const { slug, parsed, prdPath, prdContext } = loadWithPrd(positionals, flags);
  return Object.assign({ slug, prdPath }, validateTrd(parsed, prdContext));
}

/**
 * `analyze <trd-path> [--prd <path>]` -> consistency/coverage statistics + verdict.
 */
function runAnalyze(argv) {
  const { positionals, flags } = parseArgs(argv, new Set(['prd']));
  const { slug, parsed, prdPath, prdMarkdown, prdContext } = loadWithPrd(positionals, flags);
  return Object.assign({ ok: true, slug, prdPath }, analyzeTrd(parsed, prdContext, prdMarkdown));
}

/** Read a `br list --json` result (bare array or {issues:[...]}) into task id -> status. */
function beadStatusFromIssuesJson(file, slug) {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`Cannot read issues JSON '${file}': ${err.message}`);
  }
  const issues = Array.isArray(data) ? data : data && Array.isArray(data.issues) ? data.issues : null;
  if (!issues) throw new Error(`Issues JSON '${file}' is neither an array nor an object with an "issues" array`);
  const out = {};
  const byBead = {};
  const re = new RegExp(`\\[trd:${slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:task:([^\\]]+)\\]`);
  for (const issue of issues) {
    const m = String(issue.title || '').match(re);
    if (m) {
      out[m[1]] = String(issue.status || 'open');
      if (issue.id) byBead[issue.id] = m[1];
    }
  }
  Object.defineProperty(out, 'taskIdByBead', { value: byBead, enumerable: false });
  return out;
}

/**
 * `req-status <trd-path> [--prd <path>] [--issues-json <file>] [--verified REQ-001,REQ-002]`
 *   -> { checklist:{total,done,pct,phases[]}, requirements[], summary }
 * Checkbox state is the baseline; bead statuses from --issues-json (merged
 * `br list --json` output) override it per task. `--verified` is the list of
 * REQ ids that carry a req-verified comment token. `--comments-json` is a
 * map/array of bead comments (`br comment list <id> --json` per bead); with it
 * a closed test bead counts only with a `verdict:passed` comment and
 * `ac-proven` tokens fill `acsProven` (output `evidence: verdict-verified`;
 * without it `evidence: closed-only`).
 */
function runReqStatus(argv) {
  const { positionals, flags } = parseArgs(argv, new Set(['prd', 'issues-json', 'verified', 'comments-json']));
  const { slug, parsed, prdContext } = loadWithPrd(positionals, flags);
  const beadStatusByTask = flags['issues-json'] ? beadStatusFromIssuesJson(flags['issues-json'], slug) : {};
  let verifiedReqs = flags.verified !== undefined ? splitList(flags.verified) : null;
  let evidence = null;
  if (flags['comments-json']) {
    let data;
    try {
      data = JSON.parse(fs.readFileSync(flags['comments-json'], 'utf8'));
    } catch (err) {
      throw new Error(`Cannot read comments JSON '${flags['comments-json']}': ${err.message}`);
    }
    evidence = evidenceFromComments(data, beadStatusByTask.taskIdByBead);
    if (verifiedReqs) verifiedReqs = [...new Set([...verifiedReqs, ...evidence.verifiedReqs])];
  }
  return Object.assign(
    { ok: true, slug, beadsConsulted: Boolean(flags['issues-json']) },
    requirementStatus(parsed, { prdContext, beadStatusByTask, verifiedReqs, evidence })
  );
}

function gitLines(args, cwd) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .split('\n')
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * `verify <trd-path> [--prd <path>] [--mode auto|beads|checkbox|both] [--beads-evidence <file>]
 *   [--run-tests] [--report-path <path>]`
 * Builds the REQ->AC->code chain: checkbox leg (TRD checkboxes + git log +
 * target-file existence) and optional beads leg (JSON map task id ->
 * {status, verdict, req_satisfied, acs_proven, qa_agent, commit_sha} collected
 * by the caller). Writes a markdown report only when --report-path is given.
 */
function runVerify(argv) {
  const { positionals, flags } = parseArgs(
    argv,
    new Set(['prd', 'mode', 'beads-evidence', 'report-path'])
  );
  const { trdPath, slug, parsed, prdPath, prdContext } = loadWithPrd(positionals, flags);
  if (parsed.warnings.includes('No tasks found in the TRD')) {
    throw new Error('TRD parse failed: no tasks found');
  }

  const beadsEvidence = flags['beads-evidence']
    ? JSON.parse(fs.readFileSync(flags['beads-evidence'], 'utf8'))
    : {};
  const hasBeads = Object.keys(beadsEvidence).length > 0;
  const mode = flags.mode || 'auto';
  if (!['auto', 'beads', 'checkbox', 'both'].includes(mode)) {
    throw new Error(`Invalid --mode '${mode}' (expected auto|beads|checkbox|both)`);
  }
  if (mode === 'beads' && !hasBeads) throw new Error('--mode beads requires --beads-evidence with data');
  const modeEffective = mode === 'auto' ? (hasBeads ? 'both' : 'checkbox') : mode;

  const cwd = process.cwd();
  const checkboxEvidence = {};
  if (modeEffective !== 'beads') {
    for (const t of Object.values(parsed.tasksById)) {
      if (t.syntheticKind) continue;
      const commits = gitLines(
        ['log', '--all', '--fixed-strings', '--pretty=format:%H\t%s\t%aI', `--grep=feat(${slug}): ${t.id}`],
        cwd
      ).map((l) => {
        const [sha, subject, date] = l.split('\t');
        return { sha, subject, date };
      });
      const files = t.targetFiles.map((p) => {
        const [sha, date] = (gitLines(['log', '-1', '--pretty=format:%H\t%aI', '--', p], cwd)[0] || '').split('\t');
        return {
          path: p,
          exists: fs.existsSync(path.resolve(cwd, p)),
          commit_sha: sha || null,
          commit_date: date || null,
        };
      });
      checkboxEvidence[t.id] = {
        complete: isChecked(t),
        file_evidence: files,
        commit_evidence: commits,
      };
    }
  }

  const prdRequirements = Object.keys(prdContext.requirements).length
    ? Object.fromEntries(
        Object.values(prdContext.requirements).map((r) => [r.id, { description: r.title, acs: r.acIds }])
      )
    : null;

  const result = buildChain({
    trd_path: trdPath,
    trd_slug: slug,
    prd_path: prdPath,
    mode,
    mode_effective: modeEffective,
    parsed_trd_json: { ok: true, trd: Object.assign({}, parsed, { slug }) },
    prd_requirements: prdRequirements,
    checkbox_evidence: checkboxEvidence,
    beads_evidence: beadsEvidence,
    helper_options: { run_tests: Boolean(flags['run-tests']), cwd },
  });

  let reportPath = null;
  if (flags['report-path']) {
    reportPath = path.resolve(String(flags['report-path']));
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, renderVerifyReport(result, { slug, modeEffective, prdPath }), 'utf8');
  }
  return Object.assign({ prdPath, warnings: parsed.warnings, reportPath }, result);
}

function renderVerifyReport(result, meta) {
  const lines = [
    `# Requirement Traceability: ${meta.slug}`,
    '',
    `Generated: ${new Date().toISOString()}`,
    `Mode: ${meta.modeEffective}`,
    `PRD: ${meta.prdPath || 'none'}`,
    '',
    `**Overall verdict: ${result.verdict}**`,
    '',
    '| REQ | Status | Impl | Test | Files | Commits | Tests |',
    '|-----|--------|------|------|-------|---------|-------|',
  ];
  for (const c of result.chain) {
    lines.push(
      `| ${c.req_id} | ${c.status_icon} | ${c.primary_impl_task_id || '-'} | ${c.primary_test_task_id || '-'} | ${c.target_files.length} | ${c.commit_evidence.length} | ${c.test_result} |`
    );
  }
  lines.push('', '## Summary', '', '```json', JSON.stringify(result.summary, null, 2), '```', '');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// CLI dispatch
// ---------------------------------------------------------------------------

const HANDLERS = {
  parse: (argv) => runParse(argv),
  'scaffold-plan': (argv) => runScaffoldPlan(argv),
  'bead-context': (argv) => runBeadContext(argv),
  'phase-status': (argv) => runPhaseStatus(argv),
  'next-task': (argv) => runNextTask(argv, process.env),
  'pr-plan': (argv) => runPrPlan(argv, process.env),
  'resolve-sdlc': (argv) => runResolveSdlc(argv, process.env),
  'validate-workstream': (argv) => runValidateWorkstream(argv),
  'create-workstream-trd': (argv) => runCreateWorkstreamTrd(argv),
  'workstream-plan': (argv) => runWorkstreamPlan(argv, process.env),
  'workstream-status': (argv) => runWorkstreamStatus(argv),
  'beads-label': (argv) => runBeadsLabel(argv),
  'beads-stage': (argv) => runBeadsStage(argv),
  quickstart: (argv) => runQuickstart(argv),
  'choices-read': (argv) => runChoicesRead(argv),
  'choices-write': (argv) => runChoicesWrite(argv),
  list: (argv) => runList(argv),
  status: (argv) => runStatus(argv),
  'migrate-frontmatter': (argv) => runMigrateFrontmatter(argv),
  validate: (argv) => runValidate(argv),
  analyze: (argv) => runAnalyze(argv),
  'req-status': (argv) => runReqStatus(argv),
  verify: (argv) => runVerify(argv),
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
          'Missing subcommand. Usage: trd-cli <parse|scaffold-plan|bead-context|phase-status|next-task|pr-plan|resolve-sdlc|validate-workstream|create-workstream-trd|workstream-plan|workstream-status|beads-label|beads-stage|quickstart|list|status|migrate-frontmatter|choices-read|choices-write|validate|analyze|req-status|verify> <trd-path> [...]   (bead-context takes --bead <id> [--trd <path>] [--issue-json <file>] instead of <trd-path>)',
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
    // `bead-context` reports an unusable bead as a full JSON object with ok:false; that must
    // also fail the process so shell callers (`|| stop`) cannot miss it.
    return subcommand === 'bead-context' && result && result.ok === false ? 1 : 0;
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    process.stdout.write(JSON.stringify({ error: message }) + '\n');
    return 1;
  }
}

module.exports = {
  runParse,
  runBeadContext,
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
  runBeadsLabel,
  runBeadsStage,
  main,
  runChoicesRead,
  runChoicesWrite,
  runList,
  runStatus,
  runMigrateFrontmatter,
  runValidate,
  runAnalyze,
  runReqStatus,
  runVerify,
  // exported for unit testing of the helpers
  deriveSlug,
  parseArgs,
  getBeadCounts,
};

if (require.main === module) {
  // `process.exit()` discards whatever is still sitting in stdout's buffer. When stdout is
  // a pipe Node writes it asynchronously, so anything past the 64 KiB (65536-byte) pipe
  // buffer - which is every large TRD's `parse`/`scaffold-plan` JSON - was silently truncated:
  // the consumer saw invalid JSON cut at position 65536. Setting `process.exitCode` instead
  // lets the event loop drain stdout and exit naturally with the same code, so piping and
  // redirecting produce byte-identical output.
  process.exitCode = main(process.argv.slice(2));
}
