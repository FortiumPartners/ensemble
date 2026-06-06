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
 */

const fs = require('fs');
const path = require('path');

const { parseTRD } = require('./trd-parser');
const {
  buildPhaseTaskIds,
  currentPhase,
  isPhaseComplete,
  selectNextTasks,
} = require('./phase-tracker');
const { buildScaffoldPlan } = require('./scaffold-planner');
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
function readTrd(trdPath) {
  if (!trdPath) {
    throw new Error('Missing required <trd-path> argument');
  }
  let contents;
  try {
    contents = fs.readFileSync(trdPath, 'utf8');
  } catch (err) {
    throw new Error(`Cannot read TRD file '${trdPath}': ${err.message}`);
  }
  return contents;
}

/**
 * Parse a TRD path into { slug, parsed }. Shared by every subcommand.
 * @param {string} trdPath
 */
function loadParsed(trdPath) {
  const markdown = readTrd(trdPath);
  const parsed = parseTRD(markdown);
  const slug = deriveSlug(trdPath);
  return { slug, parsed };
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
  const { slug, parsed } = loadParsed(trdPath);
  const plan = buildScaffoldPlan(parsed, {
    trdSlug: slug,
    trdFilePath: trdPath,
    prdFilePath: parsed.prdReference || '',
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
function runNextTask(argv) {
  const { positionals, flags } = parseArgs(
    argv,
    new Set(['ready', 'closed', 'max'])
  );
  const trdPath = positionals[0];
  const { parsed } = loadParsed(trdPath);

  const ready = splitList(flags.ready);
  const closed = splitList(flags.closed);
  const maxRaw = flags.max != null && flags.max !== '' ? Number(flags.max) : NaN;
  const max = Number.isFinite(maxRaw) && maxRaw > 0 ? Math.floor(maxRaw) : 1;

  const phaseTaskIds = buildPhaseTaskIds(parsed);
  const selected = selectNextTasks(ready, phaseTaskIds, closed, {
    prFormat: !!parsed.prFormat,
    max,
  });

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

// ---------------------------------------------------------------------------
// CLI dispatch
// ---------------------------------------------------------------------------

const HANDLERS = {
  parse: (argv) => runParse(argv),
  'scaffold-plan': (argv) => runScaffoldPlan(argv),
  'phase-status': (argv) => runPhaseStatus(argv),
  'next-task': (argv) => runNextTask(argv),
  'pr-plan': (argv) => runPrPlan(argv, process.env),
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
          'Missing subcommand. Usage: trd-cli <parse|scaffold-plan|phase-status|next-task|pr-plan> <trd-path> [...]',
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
  main,
  // exported for unit testing of the helpers
  deriveSlug,
  parseArgs,
};

if (require.main === module) {
  const code = main(process.argv.slice(2));
  process.exit(code);
}
