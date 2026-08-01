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
 */

const fs = require('fs');
const path = require('path');

const { extractPrdContext } = require('./prd-parser');
const { parseTRD } = require('./trd-parser');
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
const { useStackedPrs, branchName, planPrActions } = require('./pr-strategy');

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
  'validate-workstream': (argv) => runValidateWorkstream(argv),
  'create-workstream-trd': (argv) => runCreateWorkstreamTrd(argv),
  'workstream-plan': (argv) => runWorkstreamPlan(argv, process.env),
  'workstream-status': (argv) => runWorkstreamStatus(argv),
  'choices-read': (argv) => runChoicesRead(argv),
  'choices-write': (argv) => runChoicesWrite(argv),
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
          'Usage: trd-cli <parse|scaffold-plan|phase-status|next-task|pr-plan|validate-workstream|create-workstream-trd|workstream-plan|workstream-status|choices-read|choices-write> <trd-path> [...]',
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
  runValidateWorkstream,
  runCreateWorkstreamTrd,
  runWorkstreamPlan,
  runWorkstreamStatus,
  main,
  runChoicesRead,
  runChoicesWrite,
  // exported for unit testing of the helpers
  deriveSlug,
  parseArgs,
};

if (require.main === module) {
  const code = main(process.argv.slice(2));
  process.exit(code);
}
