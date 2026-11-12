'use strict';

/**
 * Put a scoping label on every bead that belongs to one TRD.
 *
 * `bv --robot-plan --label <L>` scopes a plan to one TRD only when beads carry <L>; a label
 * nothing carries is silently ignored and bv returns the unscoped plan. Beads scaffolded
 * before labels existed need this backfill, and it is safe to run every time.
 */

const { resolveCategory } = require('./toolchain/config');
const { loadAdapter } = require('./toolchain/adapters');
const { detectAdapter } = require('./toolchain/detect');
const { runCapabilitySync } = require('./toolchain/runner');

const IDS_PER_CALL = 50; // bounds how many ids one runBr('label', 'add', ...) batch labels

/** br 0.2.x wraps list output as { issues: [...] }; older versions print a bare array; jira/
 * azure-boards (PR 8 independent review item 5 / finding 5) normalize their tracker.list
 * output to { items: [...] } instead (see runBr's own 'list' branch for why this function
 * always receives a re-stringified-then-reparsed JSON string regardless of which shape the
 * resolved adapter's raw tracker.list `data` was). */
const issuesOf = (parsed) => (Array.isArray(parsed) ? parsed : (parsed && (parsed.issues || parsed.items)) || []);

/**
 * Resolve and load the `tracker` category's adapter (TRD-2026-8d825f54 TRD-025, PRD AC-016-2),
 * the same `resolveCategory`/`loadAdapter` pipeline `toolchain-cli.js#run` uses for every other
 * capability call -- never `br` directly. Confirmation/ledger/preflight gating (TRD-014/015/
 * 017) governs only the shell-invoked `toolchain-cli run` surface; this in-process CLI routing
 * intentionally omits it, matching every capability this file calls (`tracker.list`,
 * `tracker.label`), neither of which this adapter's own confirmation policy applies to outside
 * that surface.
 *
 * @returns {{manifest: object}}
 * @throws {Error} whatever `resolveCategory`/`loadAdapter` throws; `runBr`'s only caller
 *   (`ensureLabel`) never catches it, so an unresolved tracker surfaces as a thrown error out
 *   of `ensureLabel` exactly as an unusable `br` binary did before this change.
 */
function resolveTrackerAdapter() {
  const projectRoot = process.cwd();
  const env = process.env;
  const resolved = resolveCategory('tracker', { projectRoot, env, detect: detectAdapter });
  const loaded = loadAdapter(resolved.value, { projectRoot, env, category: 'tracker', interactive: false });
  return { manifest: loaded.manifest };
}

/** Raise a failed runner envelope as a thrown `Error` (the same shape `execFileSync` used to throw). */
function raiseOnFailure(result) {
  const err = new Error(result.error.message);
  err.code = result.error.code;
  throw err;
}

/**
 * Stand-in for `br`, routed through the toolchain runner's `tracker.list`/`tracker.label`
 * capabilities (TRD-025) instead of spawning `br` directly. Keeps `runBr`'s original argv-in/
 * JSON-string-out contract so `ensureLabel` below needs no change: `args` is the same raw `br`
 * argv shape `ensureLabel` already builds (`['list', ...]` / `['label', 'add', ...]`).
 *
 * `tracker.label`'s adapter run template has exactly one `${ids}` placeholder -- one argv
 * element, never split into several (`runner.js#buildArgv`'s own header) -- so it can only
 * ever label ONE issue per call; a batch therefore calls it once per id, discarding each call's
 * return value (the `label add` calls below already discard `run(...)`'s return value, same as
 * before this change). The outer `IDS_PER_CALL` batching in `ensureLabel` is unchanged: it
 * still bounds how many ids this function is asked to label in one `runBr` call.
 *
 * @param {string[]} args e.g. `['list', '--all', '--limit', '0', '--json']` or
 *   `['label', 'add', <id>, ..., '-l', <label>, '--json']`
 * @returns {string} raw JSON text (only the `list` call's text is read by `ensureLabel`)
 * @throws {Error} with `.unavailable === true` when `tracker.label` is not implemented by the
 *   resolved adapter (PR 8 review item 5 / finding 3: the category contract's new
 *   `fallback: title-prefix-scoping` entry makes that case `{ok:false, unavailable:true, ...}`
 *   instead of a generic `NOT_ALLOWED`) -- `ensureLabel` below catches this marker and
 *   degrades gracefully instead of letting it propagate as an uncaught, uncoded error the way
 *   it used to (PR 8 review finding 3 / item C).
 */
function runBr(args) {
  const { manifest } = resolveTrackerAdapter();
  const execFileOptions = { cwd: process.cwd() };
  // Synchronous: killed-on-timeout containment is direct-child-only, never a detached
  // descendant (runner.js's "## runCapabilitySync" header section) -- acceptable for both
  // calls below since `br list`/`br label add` are short, one-shot invocations.

  if (args[0] === 'list') {
    const result = runCapabilitySync(manifest, 'tracker.list', {}, { timeoutMs: 60000, execFileOptions });
    if (!result.ok) raiseOnFailure(result);
    // jira/azure-boards (PR 8 review item 5 / finding 5) declare a tracker.list `parse`
    // block, so `result.data` for them is already the mapped `{items:[...]}` OBJECT, never a
    // JSON string -- re-stringify so this function's documented "always a JSON string"
    // contract (and `ensureLabel`'s own `JSON.parse(run(...))` call) never changes.
    return typeof result.data === 'string' ? result.data : JSON.stringify(result.data);
  }

  if (args[0] === 'label' && args[1] === 'add') {
    const flagAt = args.indexOf('-l');
    const ids = args.slice(2, flagAt);
    const labels = args[flagAt + 1];
    let data = '';
    for (const id of ids) {
      const result = runCapabilitySync(manifest, 'tracker.label', { ids: id, labels }, { timeoutMs: 60000, execFileOptions });
      if (!result.ok) {
        if (result.unavailable) {
          const err = new Error(result.error.message);
          err.code = result.error.code;
          err.unavailable = true;
          throw err;
        }
        raiseOnFailure(result);
      }
      data = result.data;
    }
    return data;
  }

  throw new Error(`beads-label: runBr does not know how to route 'br ${args.join(' ')}' through the tracker runner`);
}

/**
 * Does `title` belong to the scope entry `match`? A TRD scope entry such as "[trd:foo" (no
 * closing delimiter) must not match the beads of a sibling TRD "[trd:foo-v2]", so it has to be
 * followed by `]`, `:` or the end of the title. Any other entry (a TRD entry that already ends
 * with `]` or `:`, or a non-TRD entry) is a plain substring match.
 */
function titleMatches(title, match) {
  if (!match.startsWith('[trd:') || /[\]:]$/.test(match)) return title.includes(match);
  for (let at = title.indexOf(match); at !== -1; at = title.indexOf(match, at + 1)) {
    const next = title[at + match.length];
    if (next === undefined || next === ']' || next === ':') return true;
  }
  return false;
}

/**
 * @param {{label: string, match: string}} opts  match = substring of the TRD's bead titles, e.g. "[trd:<slug>"
 * @param {(args: string[]) => string} [run]     stand-in for `br`, for tests
 * @returns {{label: string, matched: number, labeled: number, already: number} |
 *   {ok: false, unavailable: true, reason: string, label: string, matched: number}} the
 *   second shape (PR 8 independent review item 5 / finding 3) is returned, never thrown, when
 *   the resolved tracker adapter does not implement `tracker.label` (e.g. jira, azure-boards)
 *   -- `trd-cli.js#runBeadsLabel`'s own `{ ok: true, ...ensureLabel(...) }` spread already
 *   handles this correctly with no change there: this shape's own `ok: false` key, spread
 *   LAST, overwrites that initial `ok: true` literal. The SUCCESS shape above is intentionally
 *   left byte-for-byte unchanged (no new `ok` key added to it) so `scripts/tests/
 *   beads-label.test.js`'s existing exact-match (`toEqual`) assertions keep passing.
 */
function ensureLabel({ label, match } = {}, run = runBr) {
  if (!label || !match) throw new Error('beads-label needs --label and --match');

  const mine = issuesOf(JSON.parse(run(['list', '--all', '--limit', '0', '--json']))).filter((b) =>
    titleMatches(String(b.title || ''), match)
  );
  const missing = mine.filter((b) => !(Array.isArray(b.labels) && b.labels.includes(label)));

  try {
    for (let i = 0; i < missing.length; i += IDS_PER_CALL) {
      run(['label', 'add', ...missing.slice(i, i + IDS_PER_CALL).map((b) => b.id), '-l', label, '--json']);
    }
  } catch (err) {
    if (err.unavailable) {
      return { ok: false, unavailable: true, reason: err.message, label, matched: mine.length };
    }
    throw err;
  }
  return { label, matched: mine.length, labeled: missing.length, already: mine.length - missing.length };
}

module.exports = { ensureLabel, titleMatches };
