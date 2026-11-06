#!/usr/bin/env node
'use strict';

/**
 * toolchain-cli.js — CLI over the toolchain configuration resolver library
 * (TRD-2026-8d825f54 TRD-004/TRD-007/TRD-014/TRD-018, PRD REQ-012, REQ-008, REQ-003, REQ-013,
 * REQ-011).
 *
 * Subcommands:
 *   resolve [--json]   Resolve every one of the 14 tool categories to its selected adapter
 *                      and the precedence tier (`project`|`user`|`env-compat`|`detection`|
 *                      `default`) that selected it, via `resolveCategory()` in
 *                      `./toolchain/config.js`. A `project`/`user`-tier selection naming an
 *                      adapter id that does not actually ship for its category fails the whole
 *                      call with `{ok:false, error:{code:'UNKNOWN_ADAPTER', message}}`
 *                      (`./toolchain/resolve-guard.js#assertKnownAdapter`, TRD-046; excludes
 *                      `tracker`/`host` and never fires for `default`/`detection`/`env-compat`
 *                      -- see that module's own doc).
 *   explain [--json]   Identical resolution to `resolve`; the distinct subcommand name exists
 *                      for callers that want the "why was this adapter chosen" framing.
 *   validate <adapter-dir> [--json]
 *                      Run the composed static validation gate `validateAdapterDir` (TRD-009,
 *                      PRD REQ-008/REQ-022/REQ-023) over `<adapter-dir>`: `validateManifest`,
 *                      `validateAllowlist`, `validateConformance` and `scanCredentials`, in
 *                      `./toolchain/validate.js`, returning the union of their errors. This is
 *                      the only entry point; do not re-wire a subset of the four checks here.
 *   run <capability> [--run-id <id>] [--arg k=v ...] [--json]
 *                      Invoke one capability (for example `tracker.close`) through
 *                      `runCapability()` in `./toolchain/runner.js` (TRD-011), against the
 *                      adapter `resolveCategory()`/`loadAdapter()` select for the capability's
 *                      category (`capability.split('.')[0]`), with `cwd` always explicitly set
 *                      to `ctx.projectRoot` (TRD review Finding 6: an adapter's relative
 *                      executables must resolve against the project root, never whatever
 *                      directory the CLI process happened to start in). When the capability's
 *                      category contract (`./toolchain/contracts.js#loadContracts()`) marks it
 *                      `sideEffect:true`, a passing preflight record for `--run-id` is required
 *                      first (`./toolchain/preflight.js#hasPassingPreflightRecord`, TRD-014,
 *                      PRD REQ-013): missing or failed preflight returns `PREFLIGHT_REQUIRED`
 *                      and never resolves an adapter or spawns anything. Once resolved, a
 *                      side-effecting capability's adapter must also be confirmed for this
 *                      session (`./toolchain/confirm.js#confirmStatus`, TRD-017, PRD REQ-011):
 *                      an unconfirmed adapter returns `CONFIRMATION_REQUIRED` and never calls
 *                      `loadAdapter`/`runCapability`; non-interactive runs (`--non-interactive`,
 *                      `ENSEMBLE_NON_INTERACTIVE=1`, a set `FOREMAN_TASK_TITLE`, or `CI=true`)
 *                      are auto-confirmed and logged, never silently skipped. `--arg k=v` may
 *                      repeat to supply the capability's argument values. A side-effecting
 *                      capability's SUCCESS appends one entry to `ledger-<runId>.jsonl`
 *                      (`./toolchain/ledger.js#recordSideEffect`, TRD System Architecture data-
 *                      flow step 4); its FAILURE instead writes `failure-<runId>.json`
 *                      (`#recordFailure`, data-flow step 6) naming every side-effecting
 *                      capability completed so far under this run id, read back from the
 *                      ledger itself (`#readLedgerEntries`), since each `toolchain-cli run`
 *                      invocation is its own process with no memory of an earlier one under the
 *                      same `--run-id`. No retry, no resume, exactly one `runCapability` call.
 *   preflight --require <capability> [--require <capability> ...] [--run-id <id>]
 *             [--non-interactive] [--json]
 *                      For the union of `--require`'d capabilities' categories
 *                      (`capability.split('.')[0]`), resolve each category's adapter and check
 *                      that its manifest declares every `--require`'d capability belonging to
 *                      that category (`./toolchain/resolve.js#requireCapabilities`, TRD-013,
 *                      PRD REQ-004) BEFORE running that category's declared health checks; the
 *                      first missing required capability returns `{ok:false,
 *                      error:{code:'UNAVAILABLE', message}}` naming the capability and the
 *                      adapter, with no health check spawned for any category and no preflight
 *                      record written. Once every category's required capabilities are present,
 *                      runs every health check declared by those adapters via `runPreflight()`
 *                      in `./toolchain/preflight.js` (TRD-014, PRD REQ-013). `--require` must
 *                      be supplied at least once (`INVALID_ARG` otherwise). `--run-id` is
 *                      optional: when supplied it is validated with the same
 *                      `./toolchain/run-id.js#isValidRunId` charset `run` uses (`INVALID_RUN_ID`
 *                      on failure, checked before anything else runs); when omitted, a fresh id
 *                      is generated with `crypto.randomUUID()` (always charset-valid, so it is
 *                      never separately re-validated). On a full pass this writes a preflight
 *                      record and returns `{ok:true, runId, categories, checkedAt}`; on the
 *                      first failing health check it returns `{ok:false,
 *                      error:{code:'HEALTH_FAILED', message}}` naming the adapter and check id,
 *                      writing no record. This is `run`'s own `PREFLIGHT_REQUIRED` gate's
 *                      production counterpart: a `--run-id` passed to `run` must have a prior
 *                      passing `preflight` invocation under the same id.
 *   confirm-status <capability> [--run-id <id>] [--non-interactive] [--json]
 *                      Look up whether `capability`'s category (`capability.split('.')[0]`)
 *                      has already been confirmed for this session, via
 *                      `./toolchain/confirm.js#confirmStatus` (TRD-017, PRD REQ-011), after
 *                      resolving the category's adapter (`resolveCategory`/`loadAdapter`, the
 *                      same `RESOLVE_FAILED`/`NOT_INSTALLED`-style errors `run` uses) and
 *                      looking up `sideEffect` from the category contract the same way `run`
 *                      does. Returns `{ok:true, capability, adapter, source, data}` where
 *                      `data` is `confirmStatus`'s own result verbatim (`{required:false}` |
 *                      `{confirmed:true, prompt:false}` | `{confirmed:true}` |
 *                      `{confirmed:false, adapter, source, allowlist?}`) -- a repo-local
 *                      adapter's manifest `allowlist` is passed through so a denied status can
 *                      show a caller exactly what the adapter is permitted to run.
 *   confirm-record <capability> [--run-id <id>] [--json]
 *                      Write a passive confirmation record for `capability`'s category's
 *                      currently-resolved adapter, via
 *                      `./toolchain/confirm.js#recordConfirmation` (TRD-017, PRD REQ-011), with
 *                      the same resolve/load prelude as `confirm-status`. This is
 *                      `recordConfirmation`'s first production/CLI caller (TRD-018): a future
 *                      interactive confirmation UI, or an operator confirming a session once up
 *                      front, calls this after a user says yes. Returns `{ok:true, capability,
 *                      adapter, source, data:{confirmed:true}}`.
 *   trace start --run-id <id> --name <name> [--kind <k>] [--parent <span-id>] [--attr k=v ...]
 *         [--json]
 *   trace end --run-id <id> --span-id <id> [--status <s>] [--attr k=v ...] [--json]
 *   trace summarize --run-id <id> [--json] [--brief]
 *                      Per-run span tracing (kata acvv), backed by `./run-trace.js`: appends to
 *                      `.ensemble/state/toolchain/trace-<runId>.jsonl` next to the ledger.
 *                      `start` prints the new span id (`{ok:true, span_id}` with `--json`);
 *                      `end` closes a span. Tracing must never fail the traced flow, so
 *                      `start`/`end` ALWAYS exit 0: on any failure (unwritable dir, bad clock,
 *                      invalid args, unknown span) they print exactly one stderr line
 *                      `trace: unavailable (<reason>)` (`start` still prints a fresh, valid
 *                      span id so the caller continues). `summarize` prints a text table, the
 *                      full `--json` summary, or the compact `--brief` object
 *                      (`{path, wall_ms, phases, unaccounted_ms, human_wait_ms, machine_ms,
 *                      unfinished}`); when the trace is missing/unreadable it prints
 *                      `trace: unavailable (<reason>)` (text) or `{"trace":"unavailable",
 *                      "reason":...}` (`--json`/`--brief`) and exits 1 (0 for `--brief`).
 *
 * Output:
 *   - Default (no `--json`): a human-readable table with columns `category`, `adapter`,
 *     `source`, one row per category, printed to stdout for `resolve`/`explain`; for
 *     `validate`, `ok` on success or one error per line (to stderr) on failure; for `run`, the
 *     capability's raw output on success (to stdout) or `<code>: <message>` on failure (to
 *     stderr); for `preflight`, a one-line `preflight ok: runId=<id> categories=<list>` on
 *     success (to stdout) or `<code>: <message>` on failure (to stderr); for `confirm-status`/
 *     `confirm-record`, a one-line human summary of `data` on success (to stdout) or
 *     `<code>: <message>` on failure (to stderr).
 *   - `--json`: `{ok:true, data:{<category>:{adapter, source}, ...}}` on success, or
 *     `{ok:false, error:{code, message}}` on failure, printed to stdout for `resolve`/`explain`;
 *     for `validate`, `{ok:true, errors:[]}` or `{ok:false, errors:[...]}` (matching
 *     `validateConformance`'s own return shape) printed to stdout either way; for `run`/
 *     `preflight`/`confirm-status`/`confirm-record`, the respective envelope (`{ok:true,
 *     capability, adapter, source, data}` or `{ok:true, runId, categories, checkedAt}`, or
 *     `{ok:false, error:{code, message}}`) printed to stdout either way.
 *   - Unknown or missing subcommand: with `--json`, `{ok:false, error:{code:'UNKNOWN_SUBCOMMAND',
 *     message}}` to stdout; without `--json`, a human error line to stderr naming all eight
 *     subcommands. Either way the process exits with code 2.
 *
 * The module is both importable (`resolve`, `explain`, `validate`, `run`, `preflight`,
 * `confirmStatus`, `confirmRecord`, `main` are exported for in-process callers such as other
 * `packages/development` CLIs) and executable (`if (require.main === module) { ... }`),
 * mirroring `trd-cli.js`'s convention. Note the JSON envelope and error shape here (`{ok,
 * data}` / `{ok:false, error:{code, message}}`) are distinct from `trd-cli.js`'s own `{error}`-
 * only shape; do not conflate the two.
 *
 * `resolve(ctx)`/`explain(ctx)`/`run(ctx,...)`/`preflight(ctx,...)`/`confirmStatus(ctx,...)`/
 * `confirmRecord(ctx,...)` all accept the same `{projectRoot, env, detect, installedRoots}`
 * context `resolveCategory()`/`loadAdapter()` accept and pass it straight through, unmodified,
 * never rebuilt as a hand-picked subset of fields (PR 4 independent review Finding 1, PR 5
 * independent review: a per-handler rebuild that names only some fields silently drops
 * whichever ones it forgot -- `detect` and `installedRoots` have both been bitten by this in
 * turn -- so every call site either passes `ctx` straight through or spreads it with `{...ctx,
 * ...overrides}`). `detect` is the TRD-016 detection-engine injection point
 * (`./toolchain/detect.js#detectAdapter`): `main()`'s default `ctx` (used by every real CLI
 * invocation) wires it in automatically, so `resolve`/`explain`/`run` detect a real adapter
 * from repo signals when config and env-compat decline to resolve a category.
 * `installedRoots` is `./toolchain/adapters.js#discoverAdapters`'s own extra installed-tier
 * search-root override (PR 5 independent review: the shipped default adapter for a category
 * was unreachable from any consumer outside this monorepo -- see that module's header doc),
 * never wired by `main()`'s own default `ctx` (no CLI flag, no environment variable). A caller
 * that supplies its own `ctx` (including every existing test) gets exactly what it passes --
 * no detect/installedRoots, or stubbed ones -- unaffected by any of this.
 *
 * `main(argv, ctx)` takes an optional second `ctx` argument purely so callers (tests) can
 * exercise the full argv-parsing/JSON/table-rendering path against an injected
 * `{projectRoot, env, detect}` without depending on `process.cwd()`/`process.env`/the real
 * detection engine. Real invocations never pass it, so `ctx` always defaults to
 * `{projectRoot: process.cwd(), env: process.env, detect: detectAdapter}`, matching this
 * command's documented behavior exactly.
 * `main()` returns a plain `number` exit code for every subcommand except `run` and
 * `preflight`, which are inherently asynchronous (each may spawn a child process): for those
 * two it returns a `Promise<number>` instead. This is the one place the return type varies; the
 * `if (require.main === module)` guard below handles both uniformly via `Promise.resolve(...)`,
 * and every synchronous subcommand's direct callers (including the existing test suite) keep
 * receiving a plain number exactly as before.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { resolveCategory } = require('./toolchain/config');
const { loadAdapter } = require('./toolchain/adapters');
const { runCapability } = require('./toolchain/runner');
const { loadContracts } = require('./toolchain/contracts');
const { hasPassingPreflightRecord, runPreflight } = require('./toolchain/preflight');
const { validateAdapterDir } = require('./toolchain/validate');
const { recordSideEffect, recordFailure, readLedgerEntries } = require('./toolchain/ledger');
const { isValidRunId, invalidRunIdMessage } = require('./toolchain/run-id');
const { detectAdapter } = require('./toolchain/detect');
const {
  confirmStatus: confirmAdapterStatus,
  recordConfirmation,
  isNonInteractive
} = require('./toolchain/confirm');
const { resolveWorkGraphAdapter } = require('./toolchain/work-graph-resolve');
const { runWorkGraphCapability } = require('./toolchain/builtin/work-graph-links-fallback');
const { assertKnownAdapter } = require('./toolchain/resolve-guard');
const runTrace = require('./run-trace');

const CATEGORIES = [
  'host',
  'workflow',
  'worktree',
  'tracker',
  'work-graph',
  'ci-local',
  'review',
  'lint',
  'test-runner',
  'e2e-quality',
  'container-deploy',
  'iac',
  'platform-cloud',
  'package-runner'
];

/**
 * Resolve every one of the 14 categories' adapter and source, passing `ctx` straight through
 * to `resolveCategory()` for each one.
 *
 * Each category gets its own fresh `diagnostics` array merged into the `ctx` passed down to
 * `resolveCategory`/detection (PR 4 review round 2, Finding 1): when `./toolchain/detect.js`
 * excludes a candidate adapter for a bad `remote_url_matches` pattern, it pushes one record
 * onto that array; if any were pushed, `data.<category>.detectionDiagnostics` carries them
 * (omitted entirely when empty, so the common case's JSON shape is unchanged).
 *
 * `work-graph` is special-cased (TRD-027): its value is resolved via
 * `./toolchain/work-graph-resolve.js#resolveWorkGraphAdapter`, which expands the shipped
 * default sentinel `auto` into the real, selected adapter id (TRD interpretation I7) instead
 * of reporting the literal string `'auto'`; when expansion happened, `data['work-graph']`
 * also carries `autoVia: 'tracker-capabilities'|'builtin-fallback'` naming which branch was
 * taken.
 *
 * Every non-`work-graph` category's resolution is also checked by
 * `./toolchain/resolve-guard.js#assertKnownAdapter` (TRD-046): a project- or user-level config
 * selecting an adapter id that does not actually ship for that category (any category other
 * than `tracker`/`host`, which are out of this guard's scope -- see that module's own doc)
 * throws `.code === 'UNKNOWN_ADAPTER'`, caught by this function's own outer `try`/`catch`
 * below and reported with that code unchanged, naming the category, the bogus id, and every
 * real adapter id shipped for it.
 *
 * @param {{projectRoot?: string, env?: NodeJS.ProcessEnv, detect?: Function, installedRoots?: string[]}} [ctx]
 * @returns {{ok: true, data: Record<string, {adapter: string, source: string,
 *   autoVia?: string, detectionDiagnostics?: object[]}>} | {ok: false, error: {code: string, message: string}}}
 */
function resolveAll(ctx = {}) {
  const data = {};
  try {
    for (const category of CATEGORIES) {
      const diagnostics = [];
      if (category === 'work-graph') {
        const env = ctx.env || process.env;
        const interactive = !isNonInteractive({ nonInteractive: false, env });
        const resolved = resolveWorkGraphAdapter({ ...ctx, diagnostics, interactive });
        data[category] = { adapter: resolved.value, source: resolved.source };
        if (resolved.autoVia) {
          data[category].autoVia = resolved.autoVia;
        }
        if (diagnostics.length > 0) {
          data[category].detectionDiagnostics = diagnostics;
        }
        continue;
      }
      const { value, source } = resolveCategory(category, { ...ctx, diagnostics });
      assertKnownAdapter(category, { value, source }, ctx);
      data[category] = { adapter: value, source };
      if (diagnostics.length > 0) {
        data[category].detectionDiagnostics = diagnostics;
      }
    }
    return { ok: true, data };
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    const code = err && err.code ? err.code : 'RESOLVE_FAILED';
    return { ok: false, error: { code, message } };
  }
}

/**
 * `resolve` subcommand handler.
 * @param {{projectRoot?: string, env?: NodeJS.ProcessEnv, detect?: Function, installedRoots?: string[]}} [ctx]
 */
function resolve(ctx = {}) {
  return resolveAll(ctx);
}

/**
 * `explain` subcommand handler. Same resolution as `resolve`; this task defines no behavioral
 * difference beyond the subcommand name (both show adapter and source for every category).
 * @param {{projectRoot?: string, env?: NodeJS.ProcessEnv, detect?: Function, installedRoots?: string[]}} [ctx]
 */
function explain(ctx = {}) {
  return resolveAll(ctx);
}

/**
 * `validate <adapter-dir>` subcommand handler: runs the composed static validation gate
 * `validateAdapterDir` (`./toolchain/validate.js`, TRD-009, PRD REQ-008/REQ-022/REQ-023,
 * AC-008-1..3, AC-022-1, AC-023-1, AC-023-3) over `<adapter-dir>` and returns its result
 * unchanged. Do not call `validateManifest`/`validateAllowlist`/`validateConformance`/
 * `scanCredentials` directly here — `validateAdapterDir` is the single production caller that
 * composes all four (TRD-009 review finding: a validator with no production caller enforces
 * nothing).
 *
 * @param {{projectRoot?: string, env?: NodeJS.ProcessEnv, detect?: Function}} [ctx] unused by
 *   `validate`; accepted so every handler shares the same `(ctx, positionals)` signature
 * @param {string[]} [positionals] `positionals[0]` is the adapter directory
 * @returns {{ok: true, errors: []} | {ok: false, errors: string[]}}
 */
function validate(ctx = {}, positionals = []) {
  const adapterDir = positionals[0];
  if (!adapterDir) {
    return { ok: false, errors: ['validate: missing required <adapter-dir> argument'] };
  }

  return validateAdapterDir(adapterDir);
}

/**
 * `run <capability> [--run-id <id>] [--arg k=v ...]` subcommand handler (TRD-014, TRD-015, PRD
 * REQ-013, REQ-014, AC-013-1/2/3, AC-014-1/2/3). Looks up whether `capability` is declared
 * `sideEffect:true` by its category contract (`loadContracts()`, `./toolchain/contracts.js`;
 * the category is derived as `capability.split('.')[0]`, mirroring the same ~5-line lookup
 * technique used elsewhere in this wave — this is a deliberate, small duplication, not a shared
 * helper, since the two callers must not depend on each other's new files this wave).
 *
 * TRD review Finding 3 (round 2): when `--run-id` is supplied at all, it is validated FIRST
 * (`./toolchain/run-id.js#isValidRunId`, the SAME shared charset `preflight.js`/`ledger.js`
 * use) and rejected with `{ok:false, error:{code:'INVALID_RUN_ID', message}}` before anything
 * else runs -- before the sideEffect lookup, before `hasPassingPreflightRecord`, before
 * `resolveCategory`/`loadAdapter`/`runCapability` -- so a malformed id (wrong charset, a
 * filename-colliding value, control characters) can never reach a filesystem path, regardless
 * of whether the capability turns out to be side-effecting. `--run-id` omitted entirely is NOT
 * validated here (there is nothing to validate); a non-side-effecting capability still runs
 * with no run id at all, exactly as before.
 *
 * `resolveCategory(category, ctx)` is called with `ctx` passed straight through, unmodified --
 * including `ctx.detect` (TRD-016's detection hook) -- so a detection-selected adapter (PR 4
 * review Finding 1) resolves here exactly as it does for `resolve`/`explain`/`preflight`. Its
 * result is checked by `./toolchain/resolve-guard.js#assertKnownAdapter` (TRD-046) and the
 * adapter is then loaded via `loadAdapter` -- BOTH now run BEFORE the
 * `hasPassingPreflightRecord` gate below (PR 10 fix round, item 1): an explicit project-/user-
 * config selection naming an adapter id that does not actually ship for this category always
 * fails `UNKNOWN_ADAPTER` (or `NOT_INSTALLED` for a shipped-but-uninstalled one), even for a
 * side-effecting capability with no `--run-id`/no passing preflight record. Previously the
 * preflight gate ran FIRST and masked this as `PREFLIGHT_REQUIRED` (or, once some unrelated
 * preflight had already passed for that run id, a confusing success) instead of naming the
 * real misconfiguration. A read (non-side-effecting) capability's resolution order is
 * unchanged by this move: it always resolved before any side-effect-only gate ran.
 *
 * When the capability is side-effecting and `hasPassingPreflightRecord(runId, ctx)`
 * (`./toolchain/preflight.js`, TRD-014) is `false` — including when `--run-id` was omitted
 * entirely — this returns `{ok:false, error:{code:'PREFLIGHT_REQUIRED', message}}` WITHOUT
 * calling `runCapability`: nothing is spawned. Resolution/loading above has already happened
 * by this point (needed to even know whether the configured adapter is a real, shipped one).
 * `interactive` (PR 4 review Finding 2) is derived ONCE, via `./toolchain/confirm.js
 * #isNonInteractive` -- the SAME explicit-signal precedence (`--non-interactive`,
 * `ENSEMBLE_NON_INTERACTIVE=1`, a non-empty `FOREMAN_TASK_TITLE`, `CI=true`; never TTY
 * presence) the confirmation gate itself uses -- and passed to `loadAdapter`. `loadAdapter` is
 * called BEFORE the confirmation gate below (not after, as a prior wave left it): this lets a
 * repo-local adapter's `allowlist` reach `confirmAdapterStatus`'s `ctx.allowlist`, so an
 * interactive run's `CONFIRMATION_REQUIRED` denial (and a `confirm-status` call for the same
 * capability) can surface the allowlist for display, matching `confirmStatus`'s own CLI handler
 * below. `loadAdapter` never spawns a process, so moving it earlier never lets a side-effecting
 * capability's actual tool call happen before confirmation passes -- that guarantee is
 * unchanged: `runCapability` (the only spawn point) still runs strictly after the confirmation
 * check below.
 *
 * Both the confirmation gate and `runCapability` consume the SAME `adapterId`/`source` this one
 * `resolveCategory` call produced -- `opts.source` (PR 4 review Finding 2) is now forwarded to
 * `runCapability` so a successful envelope's `source` field reports the adapter's true
 * precedence tier (project/user/env-compat/detection/default) instead of always `null`.
 *
 * TRD-015 ledger wiring (TRD review Finding 2: this used to end at `runCapability` and never
 * touched `./toolchain/ledger.js`, so neither data-flow step 4 nor step 6 was reachable from
 * any shipped entry point): when the capability is side-effecting,
 * - on success, `recordSideEffect` appends one entry to `ledger-<runId>.jsonl` and the
 *   envelope is returned unchanged;
 * - on failure, `readLedgerEntries(runId, ctx)` reads every capability already recorded under
 *   this `--run-id` (across every earlier `toolchain-cli run` invocation sharing it, not just
 *   this process) and `recordFailure` writes `failure-<runId>.json` naming them; the returned
 *   envelope gains `completedSideEffects` (that same list) and `failureRecord` (the paths
 *   `recordFailure` wrote to) alongside the unchanged `error`.
 * A non-side-effecting capability never touches the ledger at all, success or failure.
 *
 * @param {{projectRoot?: string, env?: NodeJS.ProcessEnv, detect?: Function, installedRoots?: string[]}} [ctx]
 * @param {string[]} [positionals] `positionals[0]` is the capability id, e.g. `tracker.close`
 * @param {{runId?: string, args?: Record<string, string>, nonInteractive?: boolean}} [parsed]
 *   the `--run-id`/`--arg`/`--non-interactive` values `parseArgs` extracted from argv
 * @returns {Promise<{ok:true, capability:string, adapter:string, source:unknown, data:string} |
 *   {ok:false, error:{code:string, message:string}, completedSideEffects?: string[],
 *   failureRecord?: {filePath:string, artifactPath:string|null}}>}
 */
async function run(ctx = {}, positionals = [], parsed = {}) {
  const capability = positionals[0];
  if (!capability) {
    return {
      ok: false,
      error: { code: 'INVALID_ARG', message: 'run: missing required <capability> argument' }
    };
  }

  const { runId, args = {} } = parsed;

  if (runId !== undefined && !isValidRunId(runId)) {
    return { ok: false, error: { code: 'INVALID_RUN_ID', message: invalidRunIdMessage(runId) } };
  }

  const category = capability.split('.')[0];

  const contracts = loadContracts();
  const contractFile = contracts[`${category}.yaml`];
  const capabilityDef =
    contractFile && contractFile.capabilities && contractFile.capabilities[capability];
  const sideEffect = Boolean(capabilityDef && capabilityDef.sideEffect);

  const env = ctx.env || process.env;
  const interactive = !isNonInteractive({ nonInteractive: Boolean(parsed.nonInteractive), env });

  let adapterId;
  let source;
  let loaded;
  let workGraphTrackerManifest = null;
  if (category === 'work-graph') {
    let resolved;
    try {
      resolved = resolveWorkGraphAdapter({ ...ctx, interactive });
    } catch (error) {
      return { ok: false, error: { code: error.code || 'RESOLVE_FAILED', message: error.message } };
    }
    adapterId = resolved.value;
    source = resolved.source;
    loaded = { origin: resolved.origin, dir: resolved.dir, manifest: resolved.manifest };
    if (resolved.autoVia === 'builtin-fallback') {
      workGraphTrackerManifest = resolved.trackerManifest;
    }
  } else {
    try {
      const resolvedCategory = resolveCategory(category, ctx);
      assertKnownAdapter(category, resolvedCategory, ctx);
      adapterId = resolvedCategory.value;
      source = resolvedCategory.source;
    } catch (error) {
      return { ok: false, error: { code: error.code || 'RESOLVE_FAILED', message: error.message } };
    }
    try {
      loaded = loadAdapter(adapterId, { ...ctx, interactive });
    } catch (error) {
      return { ok: false, error: { code: error.code || 'NOT_INSTALLED', message: error.message } };
    }
  }

  if (sideEffect && !hasPassingPreflightRecord(runId, ctx)) {
    return {
      ok: false,
      error: {
        code: 'PREFLIGHT_REQUIRED',
        message:
          `capability '${capability}' is side-effecting and requires a passing preflight ` +
          `record for run id '${runId === undefined ? '(none)' : runId}'; run preflight first`
      }
    };
  }

  if (sideEffect) {
    const confirmation = confirmAdapterStatus(category, {
      projectRoot: ctx.projectRoot || process.cwd(),
      env,
      nonInteractive: Boolean(parsed.nonInteractive),
      sideEffect: true,
      adapter: adapterId,
      source,
      runId,
      allowlist: loaded.origin === 'repo-local' ? loaded.manifest.allowlist : undefined
    });

    if (confirmation.required !== false && confirmation.confirmed !== true) {
      return {
        ok: false,
        error: {
          code: 'CONFIRMATION_REQUIRED',
          message:
            `capability '${capability}' is side-effecting and adapter '${adapterId}' ` +
            `(source: ${source}) has not been confirmed for category '${category}' in this ` +
            `session; run an interactive session once to confirm, or set ` +
            `--non-interactive/ENSEMBLE_NON_INTERACTIVE=1/CI=true for a non-interactive run`
        }
      };
    }
  }

  const projectRoot = ctx.projectRoot || process.cwd();
  const result = workGraphTrackerManifest
    ? await runWorkGraphCapability(capability, workGraphTrackerManifest, args, {
        source,
        execOpts: { execFileOptions: { cwd: projectRoot } }
      })
    : await runCapability(loaded.manifest, capability, args, {
        source,
        execFileOptions: { cwd: projectRoot }
      });

  if (!sideEffect) {
    return result;
  }

  if (result.ok) {
    recordSideEffect(
      runId,
      { capability, adapter: adapterId, args, timestamp: new Date().toISOString() },
      { projectRoot }
    );
    return result;
  }

  const completedSideEffects = readLedgerEntries(runId, { projectRoot }).map(
    (entry) => entry.capability
  );
  const { filePath, artifactPath } = recordFailure(
    runId,
    { adapter: adapterId, capability, completedSideEffects, error: result.error },
    { projectRoot, env: ctx.env }
  );

  return { ...result, completedSideEffects, failureRecord: { filePath, artifactPath } };
}

/**
 * `preflight --require <capability> [--require <capability> ...] [--run-id <id>]` subcommand
 * handler (TRD-013, TRD-014, TRD-018, PRD REQ-004, REQ-013, AC-004-1). Derives the unique set
 * of categories (`capability.split('.')[0]`) across every `--require`'d capability and, via
 * `runPreflight()` (`./toolchain/preflight.js`), resolves each category's adapter and checks
 * that adapter's manifest declares every `--require`'d capability belonging to that category
 * BEFORE running that category's declared health checks.
 *
 * The capability check itself is `./toolchain/resolve.js#requireCapabilities`, called per
 * category with that category's slice of `requires` as the `required` list and `[]` as the
 * `optional` list -- this handler has no `--optional` flag; a capability's documented fallback
 * when it is unavailable is reported at CALL time by `./toolchain/runner.js#runCapability`'s
 * own `!cap` branch (TRD-013), not here. The first missing required capability aborts the
 * whole preflight with `{ok:false, error:{code:'UNAVAILABLE', message}}` naming the capability
 * and the adapter (`requireCapabilities`'s own thrown `error.code`/`message`, mapped into this
 * envelope unchanged) -- no health check for ANY category is spawned once this happens
 * (`runPreflight` only reaches its health-check `Promise.all` after every category's loop
 * iteration, including this check, has completed without error) -- and no preflight record is
 * written.
 *
 * `parsed.requires` must be non-empty (`INVALID_ARG` otherwise -- `preflight` with nothing to
 * check is never meaningful). When `parsed.runId` was actually supplied by the caller it is
 * validated FIRST with the same `./toolchain/run-id.js#isValidRunId`/`invalidRunIdMessage`
 * pair `run()` already uses (`INVALID_RUN_ID` on failure, checked before `runPreflight` is
 * ever called); when omitted entirely, a fresh id is generated with `crypto.randomUUID()`,
 * which always satisfies `isValidRunId` so no separate validation branch exists for that case.
 * `runPreflight`'s own result (`{ok:true, runId, categories, checkedAt}` or `{ok:false,
 * error:{code:'HEALTH_FAILED'|'INVALID_RUN_ID'|'UNAVAILABLE', message}}`) is returned
 * unchanged.
 *
 * `ctx` is forwarded to `runPreflight`'s own `ctx` in full (`{...ctx, projectRoot, env}`), not
 * rebuilt field-by-field (PR 4 independent review Finding 1: a prior wave rebuilt this call's
 * `ctx` as only `{projectRoot, env}`, silently dropping `detect` -- a detection-selected
 * adapter resolved fine for `resolve`/`explain`/`run` but `preflight` fell through to the
 * shipped default and tried to health-check THAT instead, which is not what was configured;
 * PR 5 independent review: the same narrowing would have dropped `ctx.installedRoots` too, so
 * this handler now spreads the whole object instead of naming a fixed subset of fields, the
 * same "no per-handler rebuilds that can drop fields" rule applied everywhere else in this
 * file). `runPreflight` itself threads the full `ctx` the rest of the way into its own
 * `resolveCategory`/`loadAdapter` calls.
 *
 * @param {{projectRoot?: string, env?: NodeJS.ProcessEnv, detect?: Function,
 *   installedRoots?: string[]}} [ctx]
 * @param {string[]} [positionals] unused by `preflight`; accepted so every handler shares the
 *   same `(ctx, positionals, parsed)` signature
 * @param {{requires?: string[], runId?: string, nonInteractive?: boolean}} [parsed]
 * @returns {Promise<{ok:true, runId:string, categories:string[], checkedAt:string} |
 *   {ok:false, error:{code:string, message:string}}>}
 */
async function preflight(ctx = {}, positionals = [], parsed = {}) {
  const requires = Array.isArray(parsed.requires) ? parsed.requires : [];
  if (requires.length === 0) {
    return {
      ok: false,
      error: {
        code: 'INVALID_ARG',
        message: 'preflight: at least one --require <capability> is required'
      }
    };
  }

  for (const capability of requires) {
    if (
      !capability.includes('.') ||
      capability.split('.')[0].length === 0 ||
      capability.split('.')[1].length === 0
    ) {
      return {
        ok: false,
        error: {
          code: 'INVALID_ARG',
          message: `preflight: '${capability}' is not a valid '<category>.<capability>' id`
        }
      };
    }
  }

  const categories = [...new Set(requires.map((capability) => capability.split('.')[0]))];

  let runId = parsed.runId;
  if (runId !== undefined) {
    if (!isValidRunId(runId)) {
      return { ok: false, error: { code: 'INVALID_RUN_ID', message: invalidRunIdMessage(runId) } };
    }
  } else {
    runId = crypto.randomUUID();
  }

  return runPreflight(
    { categories, runId, nonInteractive: Boolean(parsed.nonInteractive), requires },
    { ...ctx, projectRoot: ctx.projectRoot || process.cwd(), env: ctx.env || process.env }
  );
}

/**
 * `confirm-status <capability> [--run-id <id>] [--non-interactive]` subcommand handler
 * (TRD-017, TRD-018, PRD REQ-011). Resolves `capability`'s category's adapter and looks up
 * `sideEffect` from the category contract the same ~5-line way `run()` already does (a
 * deliberate, small duplication per this file's own documented convention for these lookups --
 * not a shared helper), then calls `./toolchain/confirm.js#confirmStatus` (imported here as
 * `confirmAdapterStatus` to avoid colliding with this function's own name) and returns its
 * result verbatim as `data`.
 *
 * `interactive` is derived via `./toolchain/confirm.js#isNonInteractive` (PR 4 review Finding
 * 2) -- the SAME explicit-signal precedence `confirmAdapterStatus` itself uses internally --
 * rather than the bare `!parsed.nonInteractive` a prior wave used here: that bare check ignored
 * `ENSEMBLE_NON_INTERACTIVE=1`/`FOREMAN_TASK_TITLE`/`CI=true`, so a run with one of those env
 * signals set (but no literal `--non-interactive` flag) could tell `loadAdapter` it was
 * "interactive" (skipping the repo-local trust check) while `confirmAdapterStatus` itself
 * simultaneously treated it as non-interactive (auto-confirming) -- two different answers to
 * the same question, computed from two different rules, inside one call.
 *
 * `resolveCategory(category, ctx)`'s result is also checked by
 * `./toolchain/resolve-guard.js#assertKnownAdapter` (TRD-046), the same way `run()` checks it;
 * see that function's own doc.
 *
 * @param {{projectRoot?: string, env?: NodeJS.ProcessEnv, detect?: Function, installedRoots?: string[]}} [ctx]
 * @param {string[]} [positionals] `positionals[0]` is the capability id, e.g. `tracker.create`
 * @param {{runId?: string, nonInteractive?: boolean}} [parsed]
 * @returns {{ok:true, capability:string, adapter:string, source:string, data:object} |
 *   {ok:false, error:{code:string, message:string}}}
 */
function confirmStatus(ctx = {}, positionals = [], parsed = {}) {
  const capability = positionals[0];
  if (!capability) {
    return {
      ok: false,
      error: { code: 'INVALID_ARG', message: 'confirm-status: missing required <capability> argument' }
    };
  }

  if (parsed.runId !== undefined && !isValidRunId(parsed.runId)) {
    return { ok: false, error: { code: 'INVALID_RUN_ID', message: invalidRunIdMessage(parsed.runId) } };
  }

  const category = capability.split('.')[0];

  const contracts = loadContracts();
  const contractFile = contracts[`${category}.yaml`];
  const capabilityDef =
    contractFile && contractFile.capabilities && contractFile.capabilities[capability];
  const sideEffect = Boolean(capabilityDef && capabilityDef.sideEffect);

  const env = ctx.env || process.env;
  const interactive = !isNonInteractive({ nonInteractive: Boolean(parsed.nonInteractive), env });

  let adapterId;
  let source;
  let loaded;
  if (category === 'work-graph') {
    let resolved;
    try {
      resolved = resolveWorkGraphAdapter({ ...ctx, interactive });
    } catch (error) {
      return { ok: false, error: { code: error.code || 'RESOLVE_FAILED', message: error.message } };
    }
    adapterId = resolved.value;
    source = resolved.source;
    loaded = { origin: resolved.origin, dir: resolved.dir, manifest: resolved.manifest };
  } else {
    try {
      const resolvedCategory = resolveCategory(category, ctx);
      assertKnownAdapter(category, resolvedCategory, ctx);
      adapterId = resolvedCategory.value;
      source = resolvedCategory.source;
    } catch (error) {
      return { ok: false, error: { code: error.code || 'RESOLVE_FAILED', message: error.message } };
    }
    try {
      loaded = loadAdapter(adapterId, { ...ctx, interactive });
    } catch (error) {
      return { ok: false, error: { code: error.code || 'NOT_INSTALLED', message: error.message } };
    }
  }

  const data = confirmAdapterStatus(category, {
    projectRoot: ctx.projectRoot || process.cwd(),
    env,
    nonInteractive: Boolean(parsed.nonInteractive),
    sideEffect,
    adapter: adapterId,
    source,
    runId: parsed.runId,
    allowlist: loaded.origin === 'repo-local' ? loaded.manifest.allowlist : undefined
  });

  return { ok: true, capability, adapter: adapterId, source, data };
}

/**
 * `confirm-record <capability> [--run-id <id>]` subcommand handler (TRD-017, TRD-018, PRD
 * REQ-011). Same capability/category/resolve/load prelude as `confirmStatus` above (including
 * the same `isNonInteractive`-derived `interactive` flag, PR 4 review Finding 2), then writes a
 * passive confirmation record via `./toolchain/confirm.js#recordConfirmation` --
 * `recordConfirmation`'s first production/CLI caller.
 *
 * `recordConfirmation` now throws (PR 4 review Finding 3) when the selection is incomplete
 * (`.code === 'ADAPTER_SOURCE_REQUIRED'`) or no session id/run id is available to key the
 * record (`.code === 'CONFIRM_KEY_REQUIRED'`): both are caught here and returned as the usual
 * `{ok:false, error:{code, message}}` envelope, never an uncaught exception out of `main()`.
 *
 * `resolveCategory(category, ctx)`'s result is also checked by
 * `./toolchain/resolve-guard.js#assertKnownAdapter` (TRD-046), the same way `run()` checks it;
 * see that function's own doc.
 *
 * @param {{projectRoot?: string, env?: NodeJS.ProcessEnv, detect?: Function, installedRoots?: string[]}} [ctx]
 * @param {string[]} [positionals] `positionals[0]` is the capability id, e.g. `tracker.create`
 * @param {{runId?: string, nonInteractive?: boolean}} [parsed]
 * @returns {{ok:true, capability:string, adapter:string, source:string,
 *   data:{confirmed:true}} | {ok:false, error:{code:string, message:string}}}
 */
function confirmRecord(ctx = {}, positionals = [], parsed = {}) {
  const capability = positionals[0];
  if (!capability) {
    return {
      ok: false,
      error: { code: 'INVALID_ARG', message: 'confirm-record: missing required <capability> argument' }
    };
  }

  if (parsed.runId !== undefined && !isValidRunId(parsed.runId)) {
    return { ok: false, error: { code: 'INVALID_RUN_ID', message: invalidRunIdMessage(parsed.runId) } };
  }

  const category = capability.split('.')[0];

  const env = ctx.env || process.env;
  const interactive = !isNonInteractive({ nonInteractive: Boolean(parsed.nonInteractive), env });

  let adapterId;
  let source;
  if (category === 'work-graph') {
    let resolved;
    try {
      resolved = resolveWorkGraphAdapter({ ...ctx, interactive });
    } catch (error) {
      return { ok: false, error: { code: error.code || 'RESOLVE_FAILED', message: error.message } };
    }
    adapterId = resolved.value;
    source = resolved.source;
  } else {
    try {
      const resolvedCategory = resolveCategory(category, ctx);
      assertKnownAdapter(category, resolvedCategory, ctx);
      adapterId = resolvedCategory.value;
      source = resolvedCategory.source;
    } catch (error) {
      return { ok: false, error: { code: error.code || 'RESOLVE_FAILED', message: error.message } };
    }
    try {
      loadAdapter(adapterId, { ...ctx, interactive });
    } catch (error) {
      return { ok: false, error: { code: error.code || 'NOT_INSTALLED', message: error.message } };
    }
  }

  try {
    recordConfirmation(category, {
      projectRoot: ctx.projectRoot || process.cwd(),
      env,
      adapter: adapterId,
      source,
      runId: parsed.runId
    });
  } catch (error) {
    return {
      ok: false,
      error: { code: error.code || 'CONFIRM_RECORD_FAILED', message: error.message }
    };
  }

  return { ok: true, capability, adapter: adapterId, source, data: { confirmed: true } };
}

const HANDLERS = {
  resolve,
  explain,
  validate,
  run,
  preflight,
  'confirm-status': confirmStatus,
  'confirm-record': confirmRecord
};

/**
 * Render a resolved category map as a human-readable table.
 * @param {Record<string, {adapter: string, source: string}>} data
 * @returns {string}
 */
function renderTable(data) {
  const header = ['category', 'adapter', 'source'];
  const rows = CATEGORIES.filter((category) => data[category]).map((category) => [
    category,
    data[category].adapter,
    data[category].source
  ]);
  const widths = header.map((heading, i) =>
    Math.max(heading.length, ...rows.map((row) => String(row[i]).length))
  );
  const formatRow = (row) => row.map((cell, i) => String(cell).padEnd(widths[i])).join('  ');
  return [formatRow(header), ...rows.map(formatRow)].join('\n');
}

/**
 * Parse CLI argv into a subcommand name, the `--json` flag, positional arguments, and the
 * flags various subcommands consume: `run`'s own `--run-id <id>` / repeated `--arg k=v`,
 * `preflight`'s repeated `--require <capability>`, and `confirm-status`/`confirm-record`'s
 * shared `--run-id <id>` / `--non-interactive`. Every consumed flag's value is removed (never
 * left in `positionals`) so `validate <adapter-dir>` and `resolve`/`explain` (which ignore
 * `positionals` entirely) are unaffected when those flags are absent, which is always true for
 * every subcommand except `run`, `preflight`, `confirm-status` and `confirm-record`.
 *
 * TRD review Finding 5: `--run-id`/`--arg` used to blindly consume the NEXT token as their
 * value even when that token was itself another flag (e.g. `--run-id --json` used to silently
 * set `runId` to the literal string `'--json'`), and a malformed `--arg` value (`oops` with no
 * `=`, or `=v` with an empty key) was silently dropped rather than reported. Both are now
 * explicit, named `INVALID_ARG` errors returned via the `error` field below: `main()` prints
 * them and exits non-zero instead of silently proceeding with a wrong or missing value. Because
 * a flag-looking token can therefore never be consumed as a `--run-id`/`--arg` value, the
 * top-level `--json` flag below is unambiguously a real flag wherever it appears in `argv`,
 * never something that was actually meant as an `--arg`'s value.
 *
 * @param {string[]} argv
 * @returns {{subcommand: string|undefined, json: boolean, positionals: string[],
 *   runId: string|undefined, args: Record<string, string>, requires: string[],
 *   error?: {code: string, message: string}}}
 */
function parseArgs(argv) {
  const list = Array.isArray(argv) ? argv : [];
  const subcommand = list[0];
  const rest = list.slice(1);

  // `--json` is detected across the whole argv (matching the original implementation's
  // `list.includes('--json')`), not just `rest`: when no subcommand is supplied at all,
  // `--json` itself lands in `subcommand` (list[0]), and the "missing subcommand" error path
  // below still needs `json:true` in that case.
  const json = list.includes('--json');
  const nonInteractive = list.includes('--non-interactive');
  let runId;
  const args = {};
  const requires = [];
  const positionals = [];
  const traceOpts = { attrs: {}, brief: false };

  const invalidArg = (message) => ({
    subcommand,
    json,
    nonInteractive,
    positionals,
    runId,
    args,
    requires,
    trace: traceOpts,
    error: { code: 'INVALID_ARG', message }
  });

  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (token === '--json') {
      continue;
    } else if (token === '--non-interactive') {
      continue;
    } else if (token === '--run-id') {
      const value = rest[i + 1];
      if (typeof value !== 'string' || value.startsWith('--')) {
        return invalidArg(
          `--run-id requires a value (got ${value === undefined ? 'nothing' : JSON.stringify(value)})`
        );
      }
      runId = value;
      i += 1;
    } else if (token === '--arg') {
      const pair = rest[i + 1];
      if (typeof pair !== 'string' || pair.startsWith('--')) {
        return invalidArg(
          `--arg requires a 'key=value' value (got ${pair === undefined ? 'nothing' : JSON.stringify(pair)})`
        );
      }
      const eqIndex = pair.indexOf('=');
      if (eqIndex <= 0) {
        return invalidArg(`--arg value ${JSON.stringify(pair)} is not in 'key=value' form`);
      }
      args[pair.slice(0, eqIndex)] = pair.slice(eqIndex + 1);
      i += 1;
    } else if (token === '--brief') {
      traceOpts.brief = true;
    } else if (
      token === '--name' ||
      token === '--kind' ||
      token === '--parent' ||
      token === '--span-id' ||
      token === '--status'
    ) {
      const value = rest[i + 1];
      if (typeof value !== 'string' || value.startsWith('--')) {
        return invalidArg(
          `${token} requires a value (got ${value === undefined ? 'nothing' : JSON.stringify(value)})`
        );
      }
      const key = token === '--span-id' ? 'spanId' : token.slice(2);
      traceOpts[key] = value;
      i += 1;
    } else if (token === '--attr') {
      const pair = rest[i + 1];
      if (typeof pair !== 'string' || pair.startsWith('--')) {
        return invalidArg(
          `--attr requires a 'key=value' value (got ${pair === undefined ? 'nothing' : JSON.stringify(pair)})`
        );
      }
      const eqIndex = pair.indexOf('=');
      if (eqIndex <= 0) {
        return invalidArg(`--attr value ${JSON.stringify(pair)} is not in 'key=value' form`);
      }
      traceOpts.attrs[pair.slice(0, eqIndex)] = pair.slice(eqIndex + 1);
      i += 1;
    } else if (token === '--require') {
      const value = rest[i + 1];
      if (typeof value !== 'string' || value.startsWith('--')) {
        return invalidArg(
          `--require requires a value (got ${value === undefined ? 'nothing' : JSON.stringify(value)})`
        );
      }
      requires.push(value);
      i += 1;
    } else {
      positionals.push(token);
    }
  }

  return { subcommand, json, nonInteractive, positionals, runId, args, requires, trace: traceOpts };
}

/**
 * Print `result` in the format `subcommand`/`json` select, matching this file's own "Output"
 * doc above exactly. Shared by every subcommand's branch in `main()` so there is exactly one
 * envelope-printing path, not one per subcommand.
 *
 * @param {string|undefined} subcommand
 * @param {boolean} json
 * @param {{ok: boolean, [key: string]: unknown}} result
 */
function printResult(subcommand, json, result) {
  if (json) {
    process.stdout.write(JSON.stringify(result) + '\n');
    return;
  }

  if (subcommand === 'validate') {
    if (result.ok) {
      process.stdout.write('ok\n');
    } else {
      process.stderr.write(result.errors.join('\n') + '\n');
    }
    return;
  }

  if (subcommand === 'run') {
    if (result.ok) {
      process.stdout.write(String(result.data) + '\n');
    } else {
      process.stderr.write(`${result.error.code}: ${result.error.message}\n`);
      if (Array.isArray(result.completedSideEffects)) {
        process.stderr.write(
          `Completed side effects: ${result.completedSideEffects.join(', ') || '(none)'}\n`
        );
      }
    }
    return;
  }

  if (subcommand === 'preflight') {
    if (result.ok) {
      process.stdout.write(
        `preflight ok: runId=${result.runId} categories=${result.categories.join(',')}\n`
      );
    } else {
      process.stderr.write(`${result.error.code}: ${result.error.message}\n`);
    }
    return;
  }

  if (subcommand === 'confirm-status' || subcommand === 'confirm-record') {
    if (result.ok) {
      process.stdout.write(
        `${subcommand} ok: capability=${result.capability} adapter=${result.adapter} ` +
          `source=${result.source} data=${JSON.stringify(result.data)}\n`
      );
    } else {
      process.stderr.write(`${result.error.code}: ${result.error.message}\n`);
    }
    return;
  }

  if (result.ok) {
    process.stdout.write(renderTable(result.data) + '\n');
  } else {
    process.stderr.write(`${result.error.code}: ${result.error.message}\n`);
  }
}

/**
 * `trace <start|end|summarize>` (kata acvv). Never throws. `start`/`end` always return 0 and
 * degrade to a single `trace: unavailable (<reason>)` stderr line; see this file's header.
 *
 * @param {string[]} argv
 * @param {ReturnType<typeof parseArgs>} parsed
 * @param {{projectRoot?: string}} ctx
 * @returns {number}
 */
function traceCommand(argv, parsed, ctx) {
  const verb = argv[1];
  const { json, trace: opts } = parsed;
  const projectRoot = (ctx && ctx.projectRoot) || process.cwd();
  const unavailable = (reason) => process.stderr.write(`trace: unavailable (${reason})\n`);

  if (verb === 'start' || verb === 'end') {
    let notice = null;
    let spanId = verb === 'end' ? opts.spanId : undefined;
    let failure = parsed.error ? parsed.error.message : null;
    if (!failure && parsed.runId === undefined) failure = '--run-id is required';
    if (!failure && verb === 'start' && !opts.name) failure = '--name is required';
    if (!failure && verb === 'end' && !opts.spanId) failure = '--span-id is required';
    if (!failure) {
      const tracer = runTrace.createTracer({
        runId: parsed.runId,
        projectRoot,
        onUnavailable: (reason) => {
          notice = reason;
        }
      });
      try {
        if (verb === 'start') {
          spanId = tracer.startSpan(opts.name, {
            kind: opts.kind,
            parentId: opts.parent,
            attrs: opts.attrs
          });
        } else {
          tracer.endSpan(opts.spanId, { status: opts.status, attrs: opts.attrs });
        }
      } catch (error) {
        notice = notice || error.message;
      }
      failure = notice;
    }
    if (verb === 'start' && !spanId) spanId = crypto.randomBytes(6).toString('hex');
    if (failure) unavailable(failure);
    if (verb === 'start') {
      process.stdout.write(
        json ? JSON.stringify({ ok: true, span_id: spanId, ...(failure ? { trace: 'unavailable' } : {}) }) + '\n' : spanId + '\n'
      );
    } else if (json) {
      process.stdout.write(
        JSON.stringify(failure ? { ok: true, trace: 'unavailable', reason: failure } : { ok: true }) + '\n'
      );
    }
    return 0;
  }

  if (verb === 'summarize') {
    const brief = opts.brief;
    const fail = (reason) => {
      if (json || brief) process.stdout.write(JSON.stringify({ trace: 'unavailable', reason }) + '\n');
      else unavailable(reason);
      return brief ? 0 : 1;
    };
    if (parsed.error) return fail(parsed.error.message);
    if (parsed.runId === undefined) return fail('--run-id is required');
    let file;
    try {
      file = runTrace.tracePath(projectRoot, parsed.runId);
    } catch (error) {
      return fail(error.message.replace(/^trace: /, ''));
    }
    let read;
    try {
      read = runTrace.readTrace(file);
    } catch (error) {
      if (error.code === 'ENOENT') {
        let why = 'no span was recorded';
        try {
          fs.accessSync(path.dirname(file), fs.constants.W_OK);
        } catch (accessError) {
          why = `the trace dir is not writable (${accessError.code || accessError.message})`;
        }
        return fail(`cannot read ${file} (ENOENT): ${why}`);
      }
      return fail(`cannot read ${file}: ${error.code || error.message}`);
    }
    const summary = runTrace.summarize(read, { path: file });
    if (!summary) return fail(`no spans recorded in ${file}`);
    summary.warnings = read.warnings;
    if (brief) process.stdout.write(JSON.stringify(runTrace.briefSummary(summary, { path: file })) + '\n');
    else if (json) process.stdout.write(JSON.stringify(summary) + '\n');
    else process.stdout.write(runTrace.formatSummary(summary) + '\n');
    return 0;
  }

  const message = `Unknown trace verb '${verb === undefined ? '' : verb}'. Usage: toolchain-cli trace <start|end|summarize> --run-id <id> ...`;
  if (json) process.stdout.write(JSON.stringify({ ok: false, error: { code: 'UNKNOWN_SUBCOMMAND', message } }) + '\n');
  else process.stderr.write(message + '\n');
  return 2;
}

/**
 * CLI entry point.
 *
 * @param {string[]} argv `process.argv.slice(2)`
 * @param {{projectRoot?: string, env?: NodeJS.ProcessEnv, detect?: Function,
 *   installedRoots?: string[]}} [ctx] Defaults to `{projectRoot: process.cwd(), env:
 *   process.env, detect: detectAdapter}`; real invocations never override this.
 *   `ctx.installedRoots` (`./toolchain/adapters.js`) is a programmatic-only escape hatch for
 *   tests/advanced embedders -- there is no `--installed-root` CLI flag and no environment
 *   variable for it (an attacker-controlled env var would let any process widen adapter
 *   discovery, unlike a caller-supplied in-process `ctx`).
 * @returns {number|Promise<number>} process exit code; a `Promise<number>` only for the `run`
 *   and `preflight` subcommands (see this file's header doc).
 */
function main(argv, ctx = { projectRoot: process.cwd(), env: process.env, detect: detectAdapter }) {
  const parsed = parseArgs(argv);
  const { subcommand, json, positionals, error } = parsed;

  if (subcommand === 'trace') {
    return traceCommand(Array.isArray(argv) ? argv : [], parsed, ctx);
  }

  if (error) {
    if (json) {
      process.stdout.write(JSON.stringify({ ok: false, error }) + '\n');
    } else {
      process.stderr.write(`${error.code}: ${error.message}\n`);
    }
    return 1;
  }

  const handler = subcommand && HANDLERS[subcommand];

  if (!handler) {
    const usage =
      'Usage: toolchain-cli <resolve|explain|validate|run|preflight|confirm-status|confirm-record|trace> [--json]';
    const message = subcommand
      ? `Unknown subcommand '${subcommand}'. ${usage}`
      : `Missing subcommand. ${usage}`;
    if (json) {
      process.stdout.write(
        JSON.stringify({ ok: false, error: { code: 'UNKNOWN_SUBCOMMAND', message } }) + '\n'
      );
    } else {
      process.stderr.write(message + '\n');
    }
    return 2;
  }

  if (subcommand === 'run' || subcommand === 'preflight') {
    return handler(ctx, positionals, parsed).then((result) => {
      printResult(subcommand, json, result);
      return result.ok ? 0 : 1;
    });
  }

  const result = handler(ctx, positionals, parsed);
  printResult(subcommand, json, result);
  return result.ok ? 0 : 1;
}

module.exports = { resolve, explain, validate, run, preflight, confirmStatus, confirmRecord, main };

if (require.main === module) {
  Promise.resolve(main(process.argv.slice(2))).then((code) => process.exit(code));
}
