'use strict';

/**
 * Runner: template substitution, argument validation, process execution and TRD-012's output
 * normalization (TRD-2026-8d825f54 TRD-010, TRD-011, TRD-012, PRD REQ-002, REQ-022, REQ-023).
 *
 * `buildArgv(runTemplate, args, contract)` is the first half of the runner described in the
 * TRD's System Architecture (Data Flow step 4): it substitutes `{name}` placeholders found
 * inside a capability's argv template with validated argument values and returns a flat argv
 * array, with no shell ever involved. It never spawns a process itself; `runCapability`
 * (TRD-011, documented in its own section below) is the only function in this module -- and,
 * per the TRD, the only path anywhere in the toolchain -- that executes a binary, using
 * `child_process.execFile` with `shell:false` against the argv this function returns. Do not
 * add output-mapping (`mapOutput`, TRD-012) or capability-requirement (`requireCapabilities`,
 * TRD-013) code here; those remain separate beads with separate review.
 *
 * Substitution contract:
 * - A `{name}` placeholder may appear anywhere inside an argv template string; every
 *   occurrence of `{name}` in that string is replaced with the validated, stringified value of
 *   `args[name]` (or the input's `default`, see below). Substitution is a plain string
 *   replace: it never splits one template element into multiple argv elements and never
 *   interprets the substituted value as shell syntax, so a value such as `a; rm -rf /` or
 *   `$(x)` is carried through unchanged as a single argv element (PRD REQ-023: no shell
 *   interpretation).
 * - A template element with no `{name}` placeholder (for example the literal `"br"` or
 *   `"show"` in `["br","show","{id}"]`) passes through completely unchanged and is never
 *   checked against `contract.inputs`.
 * - Every substituted value is rejected with `INVALID_ARG` when its string form begins with
 *   `-`, modelling "values rejected when they begin with `-` where a value is expected" from
 *   the TRD. This applies to every type, not only `path` (see Known limits below).
 *
 * `contract` shape (module-local; see Design note below):
 * ```
 * contract = {
 *   inputs: {
 *     <name>: {
 *       type: 'string' | 'integer' | 'enum' | 'path',
 *       values?: string[],   // required when type is 'enum'
 *       default?: unknown    // used when args[name] is undefined
 *     }
 *   },
 *   variants: {              // optional, mirrors an adapter manifest capability's `variants`
 *     <selectorArgName>: { <value>: string[] }   // <value> maps to an alternate argv template
 *   }
 * }
 * ```
 * A placeholder name with no entry in `contract.inputs` defaults to `type: 'string'`: it still
 * gets the presence check and the leading-`-` rejection, just no extra type-specific check.
 *
 * ## Design note
 *
 * No existing schema (`category-contract-schema.json`, `adapter-manifest-schema.json`,
 * `categories/*.yaml`) attaches a type to a capability input today; they carry plain name
 * arrays (`inputs: [id]`). TRD-010 is the first task that needs typed inputs, so this module
 * defines its own minimal `contract` object (above) used only by `buildArgv` and this file's
 * test. It is intentionally not yet part of `category-contract-schema.json`. `runCapability`
 * (TRD-011) assembles a real `contract` value from the resolved capability before calling
 * `buildArgv`; today that value is `{inputs: {}, variants: cap.variants}` because category
 * contracts still carry no per-input type information (see `contracts.js`/`categories/*.yaml`)
 * -- extend this shape there if a future task needs typed inputs, not by inventing a second
 * shape here.
 *
 * This module's placeholder syntax is `{name}` (no leading `$`), matching TRD-010's own
 * Implementation AC verbatim (`["br","show","{id}"]`). This is a different token than the
 * `${name}` syntax documented for adapter manifest `capabilities[].run[]` templates
 * (`adapter-manifest-schema.json`, `validate.js`'s `extractRunPlaceholders`). `runCapability`
 * (TRD-011), which assembles the real call from a resolved adapter manifest, reconciles the two
 * by translating `${name}` manifest templates into the `{name}` form before calling
 * `buildArgv` (see its own section below) -- do not change either pattern here as a side effect
 * of unrelated work.
 *
 * ## Known limits
 *
 * The leading-`-` rejection applies to every substituted value, including `type: 'integer'`,
 * because the TRD's rule is phrased generally ("values rejected when they begin with `-`
 * where a value is expected") and gives only one example (a generic `id` field). One
 * consequence: `buildArgv` can never accept a negative integer through a placeholder, since
 * its string form begins with `-`. If a future capability legitimately needs negative integer
 * arguments, that is a contract/schema change for a later task, not a special case added here.
 *
 * `type: 'path'` is validated identically to `type: 'string'` (any string, subject to the
 * leading-`-` rule): this function never touches the filesystem, never normalizes, resolves or
 * checks existence of a path value. Path existence/escape checks, if ever needed, belong to a
 * later task; adding them here would be an invented restriction the TRD does not ask for.
 *
 * When `contract.variants` declares more than one selector argument name and more than one of
 * them is present in `args`, the later one (in `Object.keys` order) wins; this is an untested
 * edge case kept minimal because every capability in this repo uses at most one variant
 * selector today.
 *
 * ## runCapability (TRD-011)
 *
 * `runCapability(adapter, capability, args, opts)` is the second half of the runner: it
 * resolves a capability from an already-parsed, already-validated adapter manifest (the same
 * shape `validate.js` consumes), builds its argv via `buildArgv` above, re-validates that argv
 * against the manifest's own `binaries`/`allowlist` at runtime, and is the ONLY function in
 * this module -- and, per the TRD, the only path anywhere in the toolchain -- that spawns a
 * process. It always spawns via `child_process.execFile` with `shell` explicitly set to
 * `false` and `killSignal` set to `'SIGKILL'` (see the execFile call below): `opts
 * .execFileOptions` is spread FIRST into the options object and `env`/`timeout`/`killSignal`/
 * `shell` are applied LAST so a caller can never override any of the four -- not a truthy
 * shell option, not a weaker `killSignal`, not a wider `env` -- so a substituted argument is
 * never reinterpreted as shell syntax (PRD REQ-023), a hung/SIGTERM-ignoring child is always
 * actually killed on timeout, and a child process never inherits a credential the resolved
 * adapter did not declare (see "Child environment" below, Threat Model trust boundary 2).
 *
 * `opts.execFileOptions` MAY still override one thing no caller is blocked from changing:
 * `maxBuffer`. Node's own `execFile` default (1 MiB) is too small for some capabilities' real
 * stdout (`tracker.list` against this repo's own live `.beads/` database measured ~3.4 MB --
 * TRD-024 reviewer round 2, P2) and was observed to hard-fail with a `RangeError` mapped to
 * `TOOL_FAILED` well before any tool-side error occurred; this module therefore sets
 * `maxBuffer: DEFAULT_MAX_BUFFER_BYTES` (64 MiB, matching this repo's own sibling `execFile`/
 * `spawnSync` callers' convention, e.g. `beads-label.js`, `complexity-analyzer.js`) as the
 * FIRST key in the options object, before `opts.execFileOptions` is spread -- a caller may
 * still raise or lower it per call, unlike `env`/`timeout`/`killSignal`/`shell` above, since a
 * wider buffer carries no shell-injection or credential-widening risk.
 *
 * ## Child environment (TRD trust boundary 2, "credentials from environment variable names
 * the manifest declares, never values")
 *
 * The child process NEVER inherits the runner's full `process.env` (a P1 finding fixed here: a
 * parent secret with no entry in any adapter's `env[]` used to reach every adapter's child
 * regardless). `buildChildEnv(adapterEnvNames, parentEnv, callerEnvOverride)` below builds the
 * exact object passed as `execFile`'s `env` option instead, as the union of:
 * - `BASE_ENV_ALLOWLIST` (`PATH`, `HOME`, `USER`, `LOGNAME`, `LANG`, `TMPDIR`, `TERM`, `TZ`)
 *   plus every `LC_*`-prefixed variable -- the small, documented set most POSIX binaries need
 *   merely to execute and resolve themselves on `PATH`, never a credential;
 * - every name in the resolved adapter's own `env[]` (manifest variable NAMES only) that the
 *   real parent environment actually has set.
 * Each is copied from `parentEnv` (`process.env`, unless a test injects `opts.parentEnv`) only
 * when present there -- an allowlisted or declared name the parent never set is simply absent
 * from the child's env, never `undefined`-valued. A caller-supplied `opts.execFileOptions.env`
 * is folded in LAST, but only for keys that already passed this same allow/declare test: a
 * caller may override the VALUE of an already-allowed variable, never widen the set the child
 * receives -- this is the "merged only after the same filtering" choice the review asked for,
 * not a silent re-widening door. `preflight.js`'s health checks reach this same filtering for
 * free: they call this file's own `runCapability` (see that module's header), never spawning a
 * process of their own.
 *
 * ## Timeout containment: the whole process tree, not just the direct child
 *
 * `execFile`'s own `timeout`/`killSignal` options (always applied, per above) kill only the
 * DIRECT child `execFile` itself spawned -- proven by direct experiment on this repo's pinned
 * Node versions: `child_process.execFile` does NOT forward a `detached` option to the `spawn`
 * call it makes internally (it forwards only `cwd`/`env`/`gid`/`shell`/`signal`/`uid`/
 * `windowsHide`/`windowsVerbatimArguments`), so the direct child is never made the leader of
 * its own process group through `execFile` alone, and a plain `process.kill(-pid, ...)` cannot
 * target a group that does not exist (a P2 finding: a tool that spawns a further child and
 * detaches it -- e.g. `spawn(cmd, {detached:true}).unref()` -- used to survive the timeout,
 * reparented to pid 1, after the direct child was killed). Since `execFile` must remain the
 * only spawning primitive in this module (see this file's top-level header; never a shell,
 * no `spawn`), containment instead tracks the direct child's REAL descendant set by POSIX pid
 * table (`listProcessTable`/`collectDescendants` below, via `ps -A -o pid=,ppid=,lstart=`, no
 * shell), polled every `PROCESS_TREE_POLL_MS` while the call is in flight PLUS one extra,
 * PROACTIVE poll scheduled to land `FINAL_POLL_MARGIN_MS` before the deadline itself (reviewer
 * round 3, P3: this must run BEFORE `execFile`'s own timeout fires, never reactively inside its
 * callback -- by the time that callback runs the direct child is already dead and reaped, so
 * any detached descendant it had has ALREADY been reparented away from it, which breaks
 * ppid-based descendant discovery entirely; a "final snapshot" taken inside the callback would
 * silently find nothing, which is why this polls proactively instead), recording not just each
 * pid but `ps`'s own `lstart` start-time string alongside it (an opaque per-process identity).
 * `listProcessTable` requires a `ps` that supports the combined `-A -o pid=,ppid=,lstart=`
 * invocation (macOS's and procps-ng Linux's `ps` both do); it returns `null` -- never a table
 * that merely LOOKS usable -- whenever that invocation fails outright OR succeeds but produces
 * not even one row with a real pid, ppid AND non-empty `lstart` (reviewer round 3, P2: a `ps`
 * that silently drops or blanks the `lstart` column instead of erroring used to make
 * `listProcessTable` return `[]`, which `killVerifiedPidsSafe` treated as "nothing to check,
 * verified, done" and silently skipped the `child.kill` fallback too -- a `ps` table must
 * never be trusted as meaningful unless it parsed at least one real identity out of it; see
 * `listProcessTable`'s own header). On timeout, every pid observed by the last poll that ran
 * (regular or proactive) -- the direct child's own pid included, since it is just as reusable
 * by the OS as any descendant once it exits -- is RE-VERIFIED against ANOTHER fresh
 * process-table read immediately before signaling (`killVerifiedPidsSafe`): only a pid whose
 * CURRENT `lstart` still matches the one recorded when it was last observed gets `SIGKILL`; a
 * pid that is gone, or now belongs to a different process the OS reused it for, is left alone
 * (reviewer round 2, P2: a stale ~100ms-old snapshot's raw pids are never trusted without this
 * re-check).
 * `killVerifiedPidsSafe` returns `false` -- "verification itself failed, trust nothing it did
 * or didn't do" -- whenever the fresh read comes back `null`, any identity it was asked to
 * check carries no recorded `startedAt` at all (should never happen given how identities are
 * built above, but never trusted blindly if it somehow does), or the table reader itself
 * throws (always called through a `try`/`catch`, so a throw here can never escape as an
 * uncaught exception inside the `execFile` callback or surface as `TOOL_FAILED` instead of
 * `TIMEOUT`); `true` means every candidate was either verified-and-signaled or verifiably
 * absent from a real, successfully-read table -- never merely "nothing could be checked". Only
 * on that `false` does this function fall back to the one thing that is always safe regardless
 * of any pid-reuse race or unusable `ps`: killing the direct child through Node's own tracked
 * `ChildProcess` handle (`child.kill('SIGKILL')`, which needs no identity check since it
 * targets the exact process `execFile` returned), never an unverified raw descendant pid. This
 * reaches an ordinary descendant regardless of whether its immediate parent (the direct child)
 * has already been reaped by the time the kill runs, but -- being a single handle -- never a
 * grandchild once that fallback is all that is left; a `ps` without working
 * `pid`/`ppid`/`lstart` support degrades this module to direct-child-only containment,
 * documented, not faked. Polling is skipped entirely on `win32` and whenever the
 * mocked/stubbed `execFile` this module is given returns no real `ChildProcess` (every pid
 * check in this module tolerates `child`/`child.pid` being absent, which is exactly what every
 * `jest.mock('child_process')`-based test in this repo's suite already does) -- see "Known
 * limits" below for what this containment strategy still cannot reach.
 *
 * Manifest `capabilities[].run[]` templates use `${name}` placeholders (see
 * `adapter-manifest-schema.json` and `validate.js`'s `extractRunPlaceholders`), while
 * `buildArgv` above expects the bare `{name}` form documented earlier in this header.
 * `runCapability` is the reconciliation point the "Design note" above points to: before calling
 * `buildArgv` it rewrites every `${name}` occurrence in the manifest's `run` template to
 * `{name}`, then proceeds exactly as `buildArgv` already documents. No other function in this
 * file performs this rewrite.
 *
 * Runtime allowlist check: `validate.js#validateAllowlist` is a STATIC check -- it validates a
 * manifest's own declared `run` templates against its own `binaries`/`allowlist` at
 * install/validate time, before any placeholder substitution (see that function's own header).
 * `runCapability` performs its own, separate check on the real, substituted `argv` array
 * immediately before spawning: `argv[0]` must be one of `adapter.binaries`, and the subcommand
 * words that follow it must match one `adapter.allowlist` entry's `sub` (a single word or a
 * space-separated multi-word subcommand such as `boards work-item show`, TRD-033, matched
 * positionally -- see `matchesSubcommandWords` below). This is an intentional, documented
 * duplication, not a refactor of `validateAllowlist`, because it operates on a concrete argv
 * array rather than a manifest template string. Any failure here returns `NOT_ALLOWED` and
 * never spawns a process.
 *
 * Envelope contract (TRD System Architecture): on success, resolves to
 * `{ok:true, capability, adapter: adapter.adapter, source, data}`, where `source` is
 * `opts.source` passed through verbatim (defaulting to `null`) -- `runCapability` never
 * re-derives or infers a source, that is `config.js`/`adapters.js`'s responsibility. `data` is
 * the raw stdout string from the child process when the resolved capability declares no
 * `parse` block (every adapter shipped today); when it does declare one, `data` is instead
 * `./mapping.js#mapOutput(stdout, cap.parse)`'s return value (TRD-012, PRD REQ-002, REQ-022),
 * additionally Ajv-validated against the category's normalized schema when
 * `CATEGORY_NORMALIZED_SCHEMA` (below) declares one for `capability`'s category -- see
 * `BAD_OUTPUT` below for the rejection path, which never passes a malformed value on. On
 * failure, resolves to `{ok:false, error:{code, message}}` with one of:
 * - `NOT_ALLOWED`: the capability is not declared by the adapter, a `buildArgv`/`selectTemplate`
 *   `NOT_ALLOWED` error was thrown (an invalid variant selector), or the runtime allowlist check
 *   above rejected the resolved argv. Every `NOT_ALLOWED` message names the adapter and the
 *   capability, binary or subcommand that failed.
 * - `INVALID_ARG`: bubbled up unchanged from `buildArgv`/`resolveArg` (missing/malformed
 *   argument value); never thrown past `runCapability`'s own boundary, always converted here.
 * - `TIMEOUT`: the child process exceeded `opts.timeoutMs` (default 60000ms) and was killed,
 *   together with every descendant pid this module's polling had observed by then (see
 *   "Timeout containment" above). The message names the adapter, the capability and the
 *   configured timeout.
 * - `TOOL_FAILED`: any other `execFile` callback error (binary not found, non-zero exit, and so
 *   on). The message names the adapter and the capability and includes the child's stderr (or,
 *   when stderr is empty, the tool's own JSON error envelope printed on stdout -- `br` prints
 *   `{error:{code,message,hint}}` there -- and failing that the raw error message), with every
 *   string leaf of that envelope redacted before serialization, passed through `redactSecrets` (same function
 *   `ledger.js`/`preflight.js` use for their own on-disk records) and truncated to
 *   `MAX_TOOL_FAILED_DETAIL_LENGTH` characters before it ever leaves this function -- a failing
 *   tool's stderr is attacker- or misconfiguration-influenced input the CLI prints verbatim, so
 *   it must never carry a credential or grow unbounded (reviewer Finding 4). A non-zero exit
 *   that IS listed in the resolved capability's own manifest-declared `successExitCodes`
 *   integer array (TRD-2026-8d825f54 PR 10 fix round, item 3; `adapter-manifest-schema.json`)
 *   is the one exception: it is NOT `TOOL_FAILED` by itself -- the shipped test-runner adapters'
 *   `test-runner.run` declares `successExitCodes: [0, 1]` because the per-language runner
 *   scripts it wraps exit 1 to report a FAILING suite, not a crash, so without this opt-in
 *   EVERY failing-suite run would surface as `TOOL_FAILED` and the normalized `{success:false,
 *   failed, failures[]}` the category contract promises would never be reachable. A tolerated
 *   exit still falls through to the SAME stdout handling a zero exit gets below (the zero-exit
 *   error-envelope check, then `parse`/schema validation); when the resolved capability also
 *   declares `parse.format: 'json'`, stdout that does not even parse as JSON at all is still
 *   indistinguishable from a real crash and stays `TOOL_FAILED` rather than reaching
 *   `BAD_OUTPUT`/`ok:true` -- only an exit code OUTSIDE the declared set, a signal/timeout, or
 *   genuinely unparseable JSON stay `TOOL_FAILED`; nothing else uses this field today, so every
 *   other adapter's non-zero exit is `TOOL_FAILED` exactly as before this option existed.
 *   `TOOL_FAILED` is also reached on a
 *   ZERO exit when stdout parses as a JSON object whose top-level `error` property is itself
 *   an object -- an "error envelope on a successful exit" shape some tools use (e.g. `br
 *   sync`/`br comments list`/`br label add` reporting a failure on stdout with exit 0, TRD-024
 *   reviewer round 2 P1); this check runs for EVERY capability, parse-declaring or not, before
 *   any `parse` handling, and only matches a top-level JSON OBJECT -- a top-level JSON ARRAY
 *   (e.g. `br show`'s own `[{...}]` envelope) is unaffected and still reaches `BAD_OUTPUT`/the
 *   normal mapping path exactly as before.
 * - `BAD_OUTPUT`: only reachable when the resolved capability declares a `parse` block
 *   (TRD-012). Either `mapOutput` threw (malformed stdout relative to `parse`, e.g. unparsable
 *   JSON or a `map` path that does not resolve) or the mapped value failed Ajv validation
 *   against the category's normalized schema (e.g. a missing required field such as `id`);
 *   either way `data` is absent from the envelope entirely and the raw tool output is never
 *   passed on (PRD REQ-002 AC-002-2).
 *
 * `runCapability` never lets a `child_process`, parsing or validation exception escape
 * uncaught: every branch above is reached through a try/catch or an `execFile` callback, never
 * a thrown error crossing this function's own boundary.
 *
 * ## Known limits (runCapability)
 *
 * Normalized-schema validation (the `BAD_OUTPUT` branch above) only runs for a category listed
 * in `CATEGORY_NORMALIZED_SCHEMA`; a capability in any other category that still declares
 * `parse` gets `mapOutput`'s own `BAD_OUTPUT` checks, just no additional Ajv shape check, since
 * no normalized schema ships for that category yet. Extend `CATEGORY_NORMALIZED_SCHEMA` when
 * one does, rather than special-casing a category in this function.
 *
 * The process-tree timeout containment above is POSIX-only (`listProcessTable` returns `null`
 * on `win32`, so only `execFile`'s own direct-child kill applies there -- document, do not
 * fake, a Windows guarantee this module cannot make without `taskkill /T`, which is out of
 * scope). Even on POSIX it cannot reach a descendant spawned after the LAST poll that ran
 * before the direct child actually dies (the regular `PROCESS_TREE_POLL_MS`-interval one or
 * the proactive `FINAL_POLL_MARGIN_MS`-before-deadline one, whichever is later) -- once a
 * process dies, ALL its children (detached session leader or not) are reparented away from it
 * by the kernel, so there is no read this module could ever take AFTER that moment that would
 * still show such a descendant as the direct child's child; this is a fundamental property of
 * how orphaned processes are reparented, not a gap a tighter poll interval alone can close
 * (reviewer round 3, P3: an earlier version of this fix tried to read the table reactively
 * INSIDE the `execFile` callback, i.e. after the direct child was already dead and reaped --
 * that read always came back empty-of-descendants for exactly this reason and was removed).
 * The fix here narrows this gap to `FINAL_POLL_MARGIN_MS` (currently 500ms) in the common case
 * of a timeout at least that long, without claiming a stronger guarantee (cgroups/job objects)
 * this task does not ask for and this repo has no dependency budget to add.
 *
 * `buildChildEnv`'s base allowlist is POSIX-oriented (`HOME`/`LOGNAME`/`TMPDIR` have no
 * standard Windows equivalent); a `win32` adapter binary needing `SystemRoot`/`ComSpec`/
 * `USERPROFILE` must declare those names in its own manifest `env[]` like any other variable
 * it needs -- this module does not special-case Windows base variables, since every adapter
 * shipped in this repo targets POSIX tools today.
 *
 * ## runCapabilitySync (TRD-025) -- known limit vs. the process-tree containment above
 *
 * `runCapabilitySync` (documented in full at its own JSDoc below) shares `runCapability`'s
 * 64 MiB `DEFAULT_MAX_BUFFER_BYTES` default and its `NOT_ALLOWED`/`INVALID_ARG`/`TIMEOUT`/
 * `TOOL_FAILED`/`BAD_OUTPUT` taxonomy, but spawns via `child_process.execFileSync`, which
 * blocks the one JS thread for its whole duration: NONE of the "Timeout containment" process-
 * tree polling above can run alongside it. On timeout, `runCapabilitySync` relies solely on
 * `execFileSync`'s own `timeout`/`killSignal` option -- like plain `execFile` with no
 * containment layered on top, this kills only the DIRECT child, never a detached grandchild it
 * may have spawned (PR 6 review item 2). This is an accepted, documented reduction, not an
 * oversight: every real synchronous caller today (`trd-cli.js#getBeadCounts`/
 * `#runBeadContext`, `beads-label.js#runBr`, `complexity-analyzer.js#loadBead`) invokes a
 * short-lived, one-shot `br` read/write, which never spawns a detached descendant of its own.
 * A future synchronous caller whose underlying tool might do so should use `runCapability`
 * (accepting becoming `async`) instead of `runCapabilitySync`.
 */

const { execFile, execFileSync } = require('child_process');
const resolve = require('./resolve');
const fs = require('fs');
const path = require('path');
const Ajv = require('ajv');
const { mapOutput } = require('./mapping');
const { redactSecrets } = require('../complexity-analyzer');

// A placeholder is `{name}` where `name` is a bare identifier-like token (no whitespace). A
// brace group containing whitespace (e.g. a GraphQL selection set `{ login __typename }`) is
// literal text, and `\{` / `\}` escape a brace that would otherwise read as a placeholder
// (e.g. `gh api`'s own `\{owner\}` repository placeholder). See host-github
// `host.change-request-reviews`.
const PLACEHOLDER_TEST_PATTERN = /\\[{}]|\{[A-Za-z0-9_.-]+\}/;
const PLACEHOLDER_REPLACE_PATTERN = /\\([{}])|\{([A-Za-z0-9_.-]+)\}/g;
const INTEGER_PATTERN = /^-?\d+$/;

/**
 * Resolve, type-check and stringify one placeholder's value against `contract.inputs[name]`.
 *
 * @param {string} name placeholder name (the text between `{` and `}`)
 * @param {Record<string, unknown>} args supplied argument values, keyed by name
 * @param {Record<string, {type?: string, values?: string[], default?: unknown}>} inputs
 * @returns {string} the validated value, stringified, ready to substitute
 */
function resolveArg(name, args, inputs) {
  let value = Object.prototype.hasOwnProperty.call(args, name) ? args[name] : undefined;
  const inputDef = inputs[name];

  if ((value === undefined || value === null) && inputDef && inputDef.default !== undefined) {
    value = inputDef.default;
  }

  if (value === undefined || value === null) {
    const error = new Error(`'${name}': no value supplied and the contract declares no default`);
    error.code = 'INVALID_ARG';
    throw error;
  }

  const type = (inputDef && inputDef.type) || 'string';
  const strValue = String(value);

  if (type === 'integer') {
    const isIntegerShaped = typeof value === 'number' ? Number.isInteger(value) : INTEGER_PATTERN.test(strValue);
    if (!isIntegerShaped) {
      const error = new Error(`'${name}': '${strValue}' is not a valid integer`);
      error.code = 'INVALID_ARG';
      throw error;
    }
  } else if (type === 'enum') {
    const allowed = Array.isArray(inputDef && inputDef.values) ? inputDef.values : [];
    if (!allowed.includes(strValue)) {
      const error = new Error(
        `'${name}': '${strValue}' is not one of the allowed values (${allowed.join(', ')})`
      );
      error.code = 'INVALID_ARG';
      throw error;
    }
  } else if (type !== 'string' && type !== 'path') {
    const error = new Error(`'${name}': contract declares unknown input type '${type}'`);
    error.code = 'INVALID_ARG';
    throw error;
  }

  if (strValue.startsWith('-')) {
    const error = new Error(`'${name}': value '${strValue}' begins with '-' where a value is expected`);
    error.code = 'INVALID_ARG';
    throw error;
  }

  return strValue;
}

/**
 * Select the effective argv template for a capability given `contract.variants` and the
 * supplied args (TRD-010, PRD REQ-023). The selector arg's value is `args[selectorArgName]`
 * when supplied (and not `null`), else `inputs[selectorArgName].default` when the contract
 * declares one, matching `resolveArg`'s own presence/default rule for ordinary placeholders —
 * a variants selector is itself a declared contract input, so it must resolve defaults the
 * same way. When a resolved selector value is not one of the variant's declared keys, throws
 * `NOT_ALLOWED` naming the selector arg and the invalid value, and never substitutes anything.
 * When no selector value is supplied and no default is declared, the base `runTemplate` is
 * kept.
 *
 * @param {string[]} runTemplate base argv template
 * @param {Record<string, unknown>} args supplied argument values
 * @param {Record<string, Record<string, string[]>>} [variants]
 * @param {Record<string, {type?: string, values?: string[], default?: unknown}>} [inputs]
 * @returns {string[]} the argv template to substitute against
 */
function selectTemplate(runTemplate, args, variants, inputs = {}) {
  if (!variants || typeof variants !== 'object') {
    return runTemplate;
  }

  let effectiveTemplate = runTemplate;

  for (const selectorArgName of Object.keys(variants)) {
    const suppliedValue = args[selectorArgName];
    const inputDef = inputs[selectorArgName];
    const selectedValue =
      suppliedValue !== undefined && suppliedValue !== null
        ? suppliedValue
        : inputDef && inputDef.default;

    if (selectedValue === undefined || selectedValue === null) {
      continue;
    }

    const variantMap = variants[selectorArgName];
    const key = String(selectedValue);
    if (!Object.prototype.hasOwnProperty.call(variantMap, key)) {
      const error = new Error(
        `${selectorArgName}: '${key}' is not an allowed variant (expected one of: ` +
          `${Object.keys(variantMap).join(', ')})`
      );
      error.code = 'NOT_ALLOWED';
      throw error;
    }

    effectiveTemplate = variantMap[key];
  }

  return effectiveTemplate;
}

/**
 * Build a flat argv array from a capability's argv template, substituting `{name}`
 * placeholders with validated argument values (TRD-010, PRD REQ-022, REQ-023). Never invokes
 * a child process, never references `child_process`, and never builds or returns a
 * shell-concatenated string: the return value is always a flat array of strings, ready to be
 * passed to `execFile` (by `runCapability`, TRD-011) with `shell:false`.
 *
 * @param {string[]} runTemplate base argv template, e.g. `["br","show","{id}"]`
 * @param {Record<string, unknown>} [args] supplied argument values, keyed by placeholder name
 * @param {{inputs?: Record<string, {type?: string, values?: string[], default?: unknown}>,
 *   variants?: Record<string, Record<string, string[]>>}} [contract] module-local contract
 *   shape, see this file's header
 * @returns {string[]} the substituted argv array
 * @throws {Error} `.code === 'NOT_ALLOWED'` when a variant selector's value is not declared;
 *   `.code === 'INVALID_ARG'` when a placeholder has no value/default, fails its declared
 *   type, or begins with `-` where a value is expected
 */
function buildArgv(runTemplate, args = {}, contract = {}) {
  if (!Array.isArray(runTemplate)) {
    throw new TypeError('buildArgv: runTemplate must be an array of strings');
  }

  const inputs = (contract && contract.inputs) || {};
  const effectiveTemplate = selectTemplate(runTemplate, args, contract && contract.variants, inputs);

  return effectiveTemplate.map((element) => {
    if (typeof element !== 'string' || !PLACEHOLDER_TEST_PATTERN.test(element)) {
      return element;
    }
    return element.replace(PLACEHOLDER_REPLACE_PATTERN, (match, escaped, name) =>
      escaped === undefined ? resolveArg(name, args, inputs) : escaped
    );
  });
}

const MANIFEST_PLACEHOLDER_PATTERN = /\$\{([^{}]+)\}/g;
const DEFAULT_TIMEOUT_MS = 60000;
// See this file's header, "`opts.execFileOptions` MAY still override..." -- 64 MiB, matching
// this repo's own sibling execFile/spawnSync callers (beads-label.js, complexity-analyzer.js);
// strictly larger than Node's 1 MiB execFile default, so this can only turn a previously
// crashing large-stdout capability into a working one, never the reverse (TRD-024 reviewer
// round 2, P2).
const DEFAULT_MAX_BUFFER_BYTES = 64 * 1024 * 1024;

/**
 * Rewrite a manifest `capabilities[].run[]` template's `${name}` placeholders (the syntax
 * `adapter.yaml` files use) into the bare `{name}` form `buildArgv` expects (see this file's
 * header, "runCapability" section). Non-string elements and elements with no `${name}`
 * placeholder pass through unchanged. Does not mutate `run`; returns a new array (or `run`
 * itself unchanged when it is not an array, so `buildArgv`'s own type check reports the error).
 *
 * @param {unknown} run a capability's manifest `run` template
 * @returns {unknown} the translated template, or `run` unchanged when it is not an array
 */
function translateManifestTemplate(run) {
  if (!Array.isArray(run)) {
    return run;
  }
  return run.map((element) =>
    typeof element === 'string' ? element.replace(MANIFEST_PLACEHOLDER_PATTERN, '{$1}') : element
  );
}

/**
 * Compare a declared allowlist subcommand (a single word like `show`, or a space-separated
 * multi-word subcommand like `boards work-item show`, TRD-033) against the argv elements that
 * follow the binary, matching each word positionally. Every word of `allowedSub` must equal
 * the argv element at the same index -- this is never a substring or prefix match on a single
 * token, so `showall` never matches an argv of `show`, and `boards` alone never matches a
 * declared `boards work-item show` entry. Mirrors `validate.js#matchesSubcommandWords`
 * (intentional duplication, see this module's runtime allowlist header above).
 *
 * @param {string} allowedSub one `allowlist[].sub` entry, e.g. 'show' or 'boards work-item show'
 * @param {string[]} argvAfterBin the argv elements after the binary (argv[1], argv[2], ...)
 * @returns {boolean} true only when every word of `allowedSub` equals the argv element at the
 *   same position
 */
function matchesSubcommandWords(allowedSub, argvAfterBin) {
  if (typeof allowedSub !== 'string' || allowedSub.length === 0) {
    return false;
  }
  const words = allowedSub.split(' ');
  if (words.length > argvAfterBin.length) {
    return false;
  }
  return words.every((word, i) => argvAfterBin[i] === word);
}

/**
 * Runtime counterpart to `validate.js#validateAllowlist`: that function statically checks a
 * manifest's own declared `run` templates against its own `binaries`/`allowlist` at
 * install/validate time, before any placeholder substitution. This function instead checks the
 * real, already-substituted `argv` array immediately before `runCapability` spawns it, mirroring
 * `validateAllowlist`'s binary/subcommand lookup logic (see its own header for why this
 * duplication is intentional).
 *
 * @param {string} adapterId `adapter.adapter`, used only to name the adapter in the message
 * @param {string[]} binaries `adapter.binaries`
 * @param {{bin: string, sub?: string[]}[]} allowlist `adapter.allowlist`
 * @param {string[]} argv the substituted argv about to be spawned
 * @returns {string|null} a message naming the offending binary/subcommand when denied, else
 *   `null` when `argv` is permitted
 */
function denyRuntimeAllowlist(adapterId, binaries, allowlist, argv) {
  const bin = argv[0];
  if (!binaries.includes(bin)) {
    return `${adapterId}: resolved call to binary '${bin}' which is not declared in 'binaries'`;
  }

  const entry = allowlist.find((candidate) => candidate && candidate.bin === bin);
  if (!entry) {
    return `${adapterId}: resolved call to '${bin}' but '${bin}' has no 'allowlist' entry`;
  }

  const sub = argv.length > 1 ? argv[1] : undefined;
  const allowedSubs = (Array.isArray(entry.sub) && entry.sub) || [];
  const argvAfterBin = argv.slice(1);
  const matched = sub !== undefined && allowedSubs.some((candidateSub) => matchesSubcommandWords(candidateSub, argvAfterBin));
  if (!matched) {
    return (
      `${adapterId}: resolved call '${bin} ${sub}' is not permitted by the allowlist for '${bin}' ` +
      `(allowed subcommands: ${allowedSubs.join(', ') || '(none)'})`
    );
  }

  return null;
}

const SCHEMA_DIR = path.join(__dirname, '..', '..', 'toolchain', 'schemas', 'normalized');

/**
 * Capability id (exact, e.g. 'tracker.list') -> normalized schema filename, checked BEFORE
 * `CATEGORY_NORMALIZED_SCHEMA` below (TRD-033/TRD-2026-8d825f54 PR 8 review item 3: a
 * capability that returns a COLLECTION -- `tracker.list`'s `{items:[...]}`, `tracker.comments`'
 * `{comments:[...]}` -- can never satisfy `work-item.json`'s single-work-item `required:
 * ["id"]` gate, which is why every adapter shipped before this table existed (beads, and
 * jira/azure-boards for these two capabilities specifically) declared NO `parse` block for
 * them at all and left `data` as raw, Ajv-unvalidated stdout text (see each adapter's own
 * `tracker.list`/`tracker.comments` manifest comments). This table lets a capability declare
 * `parse` and still validate, against a schema shaped for what it ACTUALLY returns, without
 * widening `work-item.json`'s own single-item contract to accommodate it. A capability with no
 * entry here falls through to `CATEGORY_NORMALIZED_SCHEMA` exactly as before this table was
 * added.
 */
const CAPABILITY_NORMALIZED_SCHEMA = {
  'tracker.list': 'work-item-list.json',
  'tracker.comments': 'comment-list.json'
};

/**
 * Capability category -> normalized schema filename each category's mapped output
 * (`./mapping.js#mapOutput`) is Ajv-validated against before `runCapability` hands it back to
 * a caller (TRD-012, PRD REQ-002 AC-002-2, REQ-022 AC-022-2). Exactly one entry today:
 * `tracker` is the only category with a shipped normalized schema (`work-item.json`,
 * `packages/development/toolchain/schemas/normalized/work-item.json`). A capability whose
 * category has no entry here still runs through `mapOutput` (and its own `BAD_OUTPUT` checks)
 * when it declares `parse`; it is simply not additionally schema-validated, since no normalized
 * schema ships for that category yet -- extend this table, not this file's logic, when one
 * does. Checked only when `CAPABILITY_NORMALIZED_SCHEMA` above has no entry for the exact
 * capability id.
 */
const CATEGORY_NORMALIZED_SCHEMA = {
  tracker: 'work-item.json'
};

const compiledNormalizedValidators = new Map();

/**
 * Lazily compile and cache (module-level, keyed by schema filename, never per-call) the ajv
 * validator for one normalized schema under `SCHEMA_DIR` (`config.js`/`validate.js`
 * `getValidator()` convention).
 *
 * @param {string} schemaFileName e.g. `'work-item.json'`
 * @returns {import('ajv').ValidateFunction}
 */
function getNormalizedValidator(schemaFileName) {
  let validator = compiledNormalizedValidators.get(schemaFileName);
  if (!validator) {
    const schema = JSON.parse(fs.readFileSync(path.join(SCHEMA_DIR, schemaFileName), 'utf8'));
    const ajv = new Ajv({ allErrors: true });
    validator = ajv.compile(schema);
    compiledNormalizedValidators.set(schemaFileName, validator);
  }
  return validator;
}

/**
 * Describe one ajv normalized-schema validation error as a short human-readable fragment
 * naming the offending field (`validate.js#describeAjvError` convention).
 *
 * @param {import('ajv').ErrorObject} error
 * @returns {string}
 */
function describeNormalizedSchemaError(error) {
  if (error.keyword === 'required' && error.params && error.params.missingProperty) {
    return `missing required property '${error.params.missingProperty}'`;
  }
  const atPath = error.instancePath ? error.instancePath.replace(/^\//, '') : '(root)';
  return `${atPath}: ${error.message || 'invalid'}`;
}

const BASE_ENV_ALLOWLIST = ['PATH', 'HOME', 'USER', 'LOGNAME', 'LANG', 'TMPDIR', 'TERM', 'TZ'];
const LC_ENV_PREFIX_PATTERN = /^LC_/;
const MAX_TOOL_FAILED_DETAIL_LENGTH = 4000;
const PROCESS_TREE_POLL_MS = 100;
// How long before the timeout fires to schedule one extra, PROACTIVE poll tick (in addition to
// the regular `PROCESS_TREE_POLL_MS`-interval ones) -- see "Timeout containment" in this
// file's header for why this must run BEFORE the deadline, never reactively inside the
// `execFile` callback (by the time that callback runs, the direct child is already dead and
// any detached descendant it had has already been reparented away from it, which breaks
// ppid-based descendant discovery entirely). 500ms, not a razor-thin value, because this poll
// still needs the event loop to actually be SCHEDULED and its own `execFileSync('ps', ...)`
// call to COMPLETE before the real, OS-level deadline fires: measured live under a 34-way
// concurrent test-suite load, a single `ps` call itself stays fast (~25ms), but there is no
// bound on how long a congested process can wait for the OS to schedule it at all, so this
// margin is sized for scheduling jitter headroom, not `ps`'s own (small, measured) latency.
const FINAL_POLL_MARGIN_MS = 500;

/**
 * Build the exact environment object a capability's child process receives (see this file's
 * header, "Child environment"). Never the parent's full `process.env`: only
 * `BASE_ENV_ALLOWLIST`/`LC_*` plus the resolved adapter's own declared `env[]` names, each only
 * when actually set in `parentEnv`; `callerEnvOverride` (`opts.execFileOptions.env`) is merged
 * last but filtered through this exact same allow/declare test, so it can override an already-
 * allowed value but never widen the set of variables the child receives.
 *
 * @param {unknown} adapterEnvNames the resolved adapter manifest's own `env[]` (expected
 *   `string[]`; anything else is treated as no declared names, fail-closed)
 * @param {NodeJS.ProcessEnv} parentEnv the real parent environment to filter
 * @param {unknown} [callerEnvOverride] `opts.execFileOptions.env`, if supplied
 * @returns {NodeJS.ProcessEnv}
 */
function buildChildEnv(adapterEnvNames, parentEnv, callerEnvOverride) {
  const allowedNames = new Set(BASE_ENV_ALLOWLIST);
  for (const name of Array.isArray(adapterEnvNames) ? adapterEnvNames : []) {
    if (typeof name === 'string') allowedNames.add(name);
  }

  const env = {};
  const source = (parentEnv && typeof parentEnv === 'object' && parentEnv) || {};
  for (const key of Object.keys(source)) {
    if (allowedNames.has(key) || LC_ENV_PREFIX_PATTERN.test(key)) {
      env[key] = source[key];
    }
  }

  if (callerEnvOverride && typeof callerEnvOverride === 'object') {
    for (const [key, value] of Object.entries(callerEnvOverride)) {
      if (allowedNames.has(key) || LC_ENV_PREFIX_PATTERN.test(key)) {
        env[key] = value;
      }
    }
  }

  return env;
}

/**
 * Best-effort, POSIX-only process-table snapshot -- `{pid, ppid, startedAt}` for every process
 * `ps` currently reports, used only to find a timed-out capability's surviving descendants
 * (see `collectDescendants`/`killVerifiedPidsSafe` and this file's header, "Timeout
 * containment"). `startedAt` is `ps`'s own `lstart=` text (an absolute, human-readable start
 * timestamp string, e.g. `'Wed Oct 22 14:23:11 2026'`) treated as an OPAQUE identity, never
 * parsed into a `Date`: two `ps` snapshots taken through this SAME function report the exact
 * same string for the exact same still-living process, and a DIFFERENT string the instant that
 * pid is reused by a new process (reviewer round 2: raw pids alone are reused by the OS and
 * must never be trusted across two separate snapshots without this check).
 *
 * Returns `null` -- never an array that merely LOOKS usable -- for EVERY failure mode: a
 * missing `ps`, a non-zero exit, a mocked/stubbed `child_process` module (as every test in
 * this repo's suite that exercises this file provides), `win32` (no POSIX `ps`), OR `ps`
 * running and printing something but producing not even one line with a parseable pid, ppid
 * AND non-empty `lstart` (reviewer round 3, P2: a `ps` that does not support this combined
 * `-o pid=,ppid=,lstart=` invocation -- e.g. busybox, or any `ps` silently dropping/blanking an
 * unrecognized `lstart` column instead of erroring -- used to make every line fail the
 * `tokens.length < 3` check below, leaving `rows` an EMPTY-BUT-NOT-NULL array that callers
 * could not distinguish from "ps legitimately reported zero processes", which never happens in
 * practice: at minimum this process's own line and PID 1 always exist whenever `ps` itself ran
 * and printed non-empty output). Requires a `ps` supporting `pid`/`ppid`/`lstart` together
 * (macOS's and procps-ng Linux's both do); callers must treat `null` as "no table available
 * this call, verification impossible", never as "nothing is running".
 *
 * @returns {{pid: number, ppid: number, startedAt: string}[]|null}
 */
function listProcessTable() {
  if (process.platform === 'win32') return null;
  let raw;
  try {
    raw = execFileSync('ps', ['-A', '-o', 'pid=,ppid=,lstart='], {
      encoding: 'utf8',
      timeout: 2000,
      windowsHide: true
    });
  } catch {
    return null;
  }
  if (typeof raw !== 'string') return null;

  const rows = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // `lstart` itself contains internal spaces (e.g. 'Wed Oct 22 14:23:11 2026'); splitting the
    // whole line on runs of whitespace and taking everything after the first two tokens is
    // robust to that (and to the single-extra-space BSD `ps` pads a single-digit day with).
    const tokens = trimmed.split(/\s+/);
    if (tokens.length < 3) continue;
    const pid = Number(tokens[0]);
    const ppid = Number(tokens[1]);
    const startedAt = tokens.slice(2).join(' ');
    if (Number.isInteger(pid) && Number.isInteger(ppid) && startedAt) {
      rows.push({ pid, ppid, startedAt });
    }
  }
  // Non-empty `ps` output that did not yield even one valid row is indistinguishable from "ps
  // cannot do what we asked" (see header above) -- never return it as if it meant something.
  if (rows.length === 0) return null;
  return rows;
}

/**
 * Every transitive descendant of `rootPid` in a `{pid, ppid, startedAt}` table snapshot
 * (breadth-first over the parent-of relation), as a `pid -> startedAt` identity map; never
 * includes `rootPid` itself (its own identity is tracked separately -- see `runCapability`).
 *
 * @param {number} rootPid
 * @param {{pid: number, ppid: number, startedAt: string}[]} rows
 * @returns {Map<number, string>}
 */
function collectDescendants(rootPid, rows) {
  const childrenByParent = new Map();
  const startedAtByPid = new Map();
  for (const { pid, ppid, startedAt } of rows) {
    startedAtByPid.set(pid, startedAt);
    if (!childrenByParent.has(ppid)) childrenByParent.set(ppid, []);
    childrenByParent.get(ppid).push(pid);
  }

  const found = new Map();
  const visited = new Set([rootPid]);
  const queue = [rootPid];
  while (queue.length > 0) {
    const current = queue.shift();
    for (const kid of childrenByParent.get(current) || []) {
      if (!visited.has(kid)) {
        visited.add(kid);
        found.set(kid, startedAtByPid.get(kid));
        queue.push(kid);
      }
    }
  }
  return found;
}

/**
 * Re-verify each `pid -> startedAt` identity against a FRESH process-table read and SIGKILL
 * only the ones still alive with the EXACT SAME start-time identity -- never a bare pid with
 * no identity check, which could by now belong to an unrelated process the OS reused that pid
 * for (reviewer round 2, P2: a 100ms-stale snapshot alone is not enough; a pid that is present
 * in the fresh read but with a DIFFERENT `startedAt` is a different process and is left alone;
 * a pid absent from the fresh read entirely is skipped, not signaled).
 *
 * Fails CLOSED (returns `false`, meaning "verification itself failed, trust nothing") rather
 * than silently signaling nothing and reporting success, in every case where verification is
 * not actually possible (reviewer round 3, P2): `identities` containing an entry with no
 * recorded `startedAt` at all (should never happen given how `collectDescendants`/the root
 * identity above are built, but never trusted blindly if it somehow does);
 * `listProcessTableFn` returning `null`/anything that is not an array (see `listProcessTable`'s
 * own header for the failure modes this covers, including a `ps` that cannot report `lstart`);
 * or `listProcessTableFn` THROWING synchronously -- always called through a `try`/`catch` here
 * so such a throw can never escape into the `execFile` callback that calls this function and
 * surface as an uncaught exception or a `TOOL_FAILED` instead of the `TIMEOUT` the caller
 * already decided to report. Returning `true` means every candidate was either
 * verified-and-signaled or verifiably ABSENT from a real, successfully-read table -- never
 * merely "nothing could be checked".
 *
 * @param {Map<number, string>} identities pid -> the startedAt string recorded when this pid
 *   was last observed as the live root or one of its descendants
 * @param {() => ({pid:number, ppid:number, startedAt:string}[]|null)} [listProcessTableFn]
 *   injection point for tests; defaults to the real `listProcessTable` above
 * @returns {boolean} `true` when every identity was conclusively verified (signaled if still
 *   alive under the same identity, left alone if verifiably gone), `false` when verification
 *   itself could not be trusted -- fail safe: callers must treat `false` as "verification
 *   failed" and fall back to a narrower, already-safe cleanup path (killing only the direct
 *   child via its Node-tracked handle, never an unverified raw pid)
 */
function killVerifiedPidsSafe(identities, listProcessTableFn = listProcessTable) {
  if (identities.size === 0) return true;

  for (const startedAt of identities.values()) {
    if (!startedAt) return false; // no recorded start time -- can never be verified.
  }

  let currentRows;
  try {
    currentRows = listProcessTableFn();
  } catch {
    return false; // the reader itself threw -- verification impossible, never let this escape.
  }
  if (!Array.isArray(currentRows) || currentRows.length === 0) return false;

  const currentStartedAtByPid = new Map(currentRows.map((row) => [row.pid, row.startedAt]));
  for (const [pid, startedAt] of identities) {
    if (currentStartedAtByPid.get(pid) !== startedAt) {
      continue; // gone, or a different process now holds this pid -- never signal it.
    }
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // Already exited between the re-check above and this call -- fine, nothing to clean up.
    }
  }
  return true;
}

/**
 * Shared envelope-building guards between `runCapability` (async) and `runCapabilitySync`
 * (sync, TRD-025) below: capability lookup/fallback, argv building, the runtime allowlist
 * re-check, `TOOL_FAILED` detail redaction/truncation, the zero-exit stdout-error-envelope
 * check, and `mapOutput`/normalized-schema validation. Neither entry point builds any of these
 * envelopes inline any more -- every failure-mode message/code in this file's own header
 * ("Envelope contract") above is produced by exactly one of the functions below, called by
 * both entry points, so the two can never silently diverge on what counts as `NOT_ALLOWED`/
 * `INVALID_ARG`/`TOOL_FAILED`/`BAD_OUTPUT`/`UNAVAILABLE`. `TIMEOUT` is the one error code NOT
 * built here: `runCapability`'s own process-tree-verified kill (see this file's header,
 * "Timeout containment") and `runCapabilitySync`'s direct-child-only kill (see its own header)
 * reach the same code and the same message TEMPLATE, but by genuinely different mechanisms
 * that cannot share a single function (one needs the concurrent `setInterval`/`setTimeout`
 * polling only an async call can run alongside; the other blocks the one JS thread for its
 * whole duration) -- see `runCapabilitySync`'s own header for why.
 */

/**
 * Look up `capability` on `adapter.capabilities`, or build the `UNAVAILABLE`-with-fallback /
 * `NOT_ALLOWED` envelope `runCapability`'s and `runCapabilitySync`'s own `!cap` branch used to
 * build inline -- shared so an undeclared capability (with or without a documented category
 * fallback) resolves to the exact same envelope from either entry point.
 *
 * @param {{adapter?: string, capabilities?: Record<string, object>}} adapter
 * @param {string} adapterId `adapter.adapter`, already defaulted
 * @param {string} capability
 * @param {{categoriesDir?: string}} opts
 * @returns {{cap: object} | {envelope: {ok:false, unavailable?: true, fallback?: string,
 *   capability?: string, adapter?: string, error:{code:string, message:string}}}}
 */
function lookupCapability(adapter, adapterId, capability, opts) {
  const cap = adapter && adapter.capabilities && adapter.capabilities[capability];
  if (cap) return { cap };

  const declared = resolve.lookupContractCapability(capability, opts.categoriesDir);
  if (declared && declared.required === false && declared.fallback) {
    return {
      envelope: {
        ok: false,
        unavailable: true,
        fallback: declared.fallback,
        capability,
        adapter: adapterId,
        error: {
          code: 'UNAVAILABLE',
          message:
            `${adapterId}: capability '${capability}' is unavailable; using documented ` +
            `fallback '${declared.fallback}'`
        }
      }
    };
  }
  return {
    envelope: {
      ok: false,
      error: {
        code: 'NOT_ALLOWED',
        message: `capability '${capability}' is not declared by adapter '${adapterId}'`
      }
    }
  };
}

/**
 * Translate every variant run template's `${name}` manifest placeholders into the bare
 * `{name}` form `buildArgv` expects, mirroring `translateManifestTemplate` above but applied
 * to each `<selectorArg>: {<value>: run[]}` entry of a capability's `variants` block (TRD-010/
 * TRD-033, PR 8 independent review item 1 follow-up). `selectTemplate` (inside `buildArgv`)
 * substitutes a SELECTED variant's template in place of the base `run[]` template this file's
 * caller already translates; before this function existed, `buildCapabilityArgv` passed
 * `cap.variants` through UNTRANSLATED, so a selected variant's literal `${id}` left a stray
 * `$` in the substituted argv (e.g. `$test-id` instead of `test-id`) -- `buildArgv`'s own
 * placeholder regex (`PLACEHOLDER_REPLACE_PATTERN = /\{([^{}]+)\}/g`) matches only the bare
 * `{id}` portion of `${id}`, never the leading `$`, so it substitutes the value in place but
 * leaves the `$` behind. Confirmed live against the real `beads` adapter's `tracker.set-status`
 * capability (the first shipped manifest to ever use `variants` with a placeholder inside a
 * variant template -- no prior adapter or unit test exercised this path, see this function's
 * own test file). Every shipped adapter manifest using `variants` (all three trackers'
 * `tracker.set-status`) depends on this translation running for variant templates exactly as
 * it already does for the base template.
 *
 * @param {unknown} variants a capability's manifest `variants` block, or undefined
 * @returns {unknown} the same `{<selectorArg>: {<value>: run[]}}` shape with every nested run[]
 *   template translated; `variants` itself (or a malformed entry within it) passed through
 *   unchanged when it is not a plain, non-array object, so `buildArgv`'s own `selectTemplate`
 *   reports any structural error exactly as it already does for a malformed manifest
 */
function translateManifestVariants(variants) {
  if (!variants || typeof variants !== 'object' || Array.isArray(variants)) {
    return variants;
  }
  const translated = {};
  for (const [selectorArgName, variantMap] of Object.entries(variants)) {
    if (!variantMap || typeof variantMap !== 'object' || Array.isArray(variantMap)) {
      translated[selectorArgName] = variantMap;
      continue;
    }
    const translatedMap = {};
    for (const [value, template] of Object.entries(variantMap)) {
      translatedMap[value] = translateManifestTemplate(template);
    }
    translated[selectorArgName] = translatedMap;
  }
  return translated;
}

/**
 * Translate a resolved capability's manifest `run[]` template and substitute `args` into a
 * flat argv array (`translateManifestTemplate` + `buildArgv` above), wrapped as the same
 * `{argv}` | `{envelope}` result shape every other shared helper in this section returns --
 * shared so `runCapability` and `runCapabilitySync` build the exact same argv, or fail with
 * the exact same `INVALID_ARG`/`NOT_ALLOWED` envelope, from the exact same inputs.
 *
 * @param {{run: string[], variants?: object}} cap the resolved capability definition
 * @param {Record<string, unknown>} args
 * @returns {{argv: string[]} | {envelope: {ok:false, error:{code:string, message:string}}}}
 */
function buildCapabilityArgv(cap, args) {
  try {
    const translatedTemplate = translateManifestTemplate(cap.run);
    const translatedVariants = translateManifestVariants(cap.variants);
    const argv = buildArgv(translatedTemplate, args, { inputs: {}, variants: translatedVariants });
    return { argv };
  } catch (error) {
    return { envelope: { ok: false, error: { code: error.code || 'INVALID_ARG', message: error.message } } };
  }
}

/**
 * Build the `NOT_ALLOWED` envelope for `denyRuntimeAllowlist`'s runtime allowlist check, or
 * `null` when the substituted argv is permitted -- shared so `runCapability` and
 * `runCapabilitySync` apply the exact same binary/subcommand gate to the exact same argv.
 *
 * @param {string} adapterId
 * @param {{binaries?: string[], allowlist?: {bin:string,sub?:string[]}[]}} adapter
 * @param {string[]} argv the substituted argv about to be spawned
 * @returns {{ok:false, error:{code:'NOT_ALLOWED', message:string}} | null}
 */
function checkRuntimeAllowlistEnvelope(adapterId, adapter, argv) {
  const binaries = (adapter && Array.isArray(adapter.binaries) && adapter.binaries) || [];
  const allowlist = (adapter && Array.isArray(adapter.allowlist) && adapter.allowlist) || [];
  const denialMessage = denyRuntimeAllowlist(adapterId, binaries, allowlist, argv);
  return denialMessage ? { ok: false, error: { code: 'NOT_ALLOWED', message: denialMessage } } : null;
}

/**
 * Redact secrets from, then length-bound, one `TOOL_FAILED` detail string -- the exact
 * `redactSecrets(...).text` plus `MAX_TOOL_FAILED_DETAIL_LENGTH` truncation both
 * `runCapability` and `runCapabilitySync` apply to a failing tool's stderr (or stdout error
 * envelope) before it ever leaves this module (reviewer Finding 4: a failing tool's output is
 * attacker- or misconfiguration-influenced input the CLI prints verbatim, so it must never
 * carry a credential or grow unbounded).
 *
 * @param {string} rawDetail
 * @returns {string}
 */
function redactAndBound(rawDetail) {
  const redacted = redactSecrets(rawDetail).text;
  return redacted.length > MAX_TOOL_FAILED_DETAIL_LENGTH
    ? `${redacted.slice(0, MAX_TOOL_FAILED_DETAIL_LENGTH)}... [truncated]`
    : redacted;
}

/**
 * Redact every string leaf of a decoded error envelope with `redactSecrets` BEFORE it is
 * serialized. Redacting the `JSON.stringify` output instead misses a double-quoted value such
 * as `password="..."`: JSON escapes the embedded quotes to `\"`, which the key-value-secret
 * pattern (an optional quote directly after the separator, then non-space non-quote
 * characters) no longer matches, so the secret would reach the caller verbatim while the same
 * text on stderr is redacted.
 *
 * @param {unknown} value
 * @returns {unknown} a structural copy with every string leaf redacted
 */
function redactEnvelopeLeaves(value) {
  if (typeof value === 'string') return redactSecrets(value).text;
  if (Array.isArray(value)) return value.map(redactEnvelopeLeaves);
  if (value !== null && typeof value === 'object') {
    const copy = {};
    for (const [key, leaf] of Object.entries(value)) copy[key] = redactEnvelopeLeaves(leaf);
    return copy;
  }
  return value;
}

/**
 * The serialized, leaf-redacted text of a stdout error envelope's `error` object -- the one
 * helper behind both the zero-exit check and the non-zero-exit detail. The caller still
 * length-bounds the final message with `redactAndBound`.
 *
 * @param {object} envelopeError
 * @returns {string}
 */
function serializeEnvelopeError(envelopeError) {
  return JSON.stringify(redactEnvelopeLeaves(envelopeError));
}

/**
 * Parse `stdout` as a tool error envelope: a top-level JSON OBJECT with its own `error`
 * property that is itself an object. A top-level JSON ARRAY (e.g. `br show`'s `[{...}]`) is
 * never an envelope. Shared by the zero-exit check and the non-zero-exit detail fallback.
 *
 * @param {string|Buffer|undefined} stdout raw child stdout
 * @returns {object|null} the `error` object, else `null`
 */
function extractStdoutErrorEnvelope(stdout) {
  const trimmedStdout = stdout ? String(stdout).trim() : '';
  if (!trimmedStdout) return null;

  let parsedStdout;
  try {
    parsedStdout = JSON.parse(trimmedStdout);
  } catch {
    return null;
  }

  if (
    parsedStdout !== null &&
    typeof parsedStdout === 'object' &&
    !Array.isArray(parsedStdout) &&
    Object.prototype.hasOwnProperty.call(parsedStdout, 'error') &&
    parsedStdout.error !== null &&
    typeof parsedStdout.error === 'object'
  ) {
    return parsedStdout.error;
  }

  return null;
}

/**
 * Zero exit, but stdout is itself an error envelope (some `br` subcommands this adapter wraps
 * report failure this way, e.g. `sync`/`comments list`/`label add` -- TRD-024 reviewer round 2,
 * P1). Runs for EVERY capability, parse-declaring or not, BEFORE any `parse` handling -- shared
 * between `runCapability` and `runCapabilitySync` so this fail-closed check can never silently
 * apply to only one of them.
 *
 * @param {string} adapterId
 * @param {string} capability
 * @param {string} stdout raw child stdout
 * @returns {{ok:false, error:{code:'TOOL_FAILED', message:string}} | null} the envelope when
 *   stdout is an error envelope, else `null`
 */
function checkZeroExitErrorEnvelope(adapterId, capability, stdout) {
  const envelopeError = extractStdoutErrorEnvelope(stdout);
  if (envelopeError === null) return null;

  const boundedDetail = redactAndBound(serializeEnvelopeError(envelopeError));
  return {
    ok: false,
    error: {
      code: 'TOOL_FAILED',
      message:
        `${adapterId}: capability '${capability}' failed: tool reported an error ` +
        `envelope on stdout despite a zero exit (${boundedDetail})`
    }
  };
}

/**
 * The raw (pre-`redactAndBound`) detail for a NON-ZERO exit's `TOOL_FAILED` message, shared by
 * `runCapability` and `runCapabilitySync`: the child's stderr when it has any; otherwise the
 * tool's own JSON error envelope on stdout (`br` prints `{error:{code,message,hint}}` on
 * STDOUT and exits non-zero, leaving stderr empty, so without this the caller sees only
 * "Command failed: br ..." and never br's own code, e.g. NOT_INITIALIZED); otherwise Node's
 * own `error.message`. The caller still passes the result through `redactAndBound`.
 *
 * @param {string|Buffer|undefined} stderr
 * @param {string|Buffer|undefined} stdout
 * @param {string} fallbackMessage Node's `error.message`
 * @returns {string}
 */
function nonZeroExitDetail(stderr, stdout, fallbackMessage) {
  const trimmedStderr = stderr ? String(stderr).trim() : '';
  if (trimmedStderr) return trimmedStderr;
  const envelopeError = extractStdoutErrorEnvelope(stdout);
  if (envelopeError !== null) {
    return `tool reported an error envelope on stdout (${serializeEnvelopeError(envelopeError)})`;
  }
  return fallbackMessage;
}

/**
 * Apply a capability's `parse` block (if any) to raw stdout and, for categories declaring a
 * normalized schema, Ajv-validate the mapped result -- the `mapOutput`/`BAD_OUTPUT`/schema-
 * validation portion of the runner envelope contract (TRD-012, PRD REQ-002 AC-002-2, REQ-022
 * AC-022-2), shared verbatim between `runCapability` and `runCapabilitySync` so the two can
 * never diverge on what counts as a mapping or schema failure.
 *
 * @param {string} adapterId
 * @param {string} capability
 * @param {{parse?: object}} cap the resolved capability definition (`adapter.capabilities[capability]`)
 * @param {string} stdout raw child stdout
 * @returns {{data: (string|unknown)} | {envelope: {ok:false, error:{code:string, message:string}}}}
 *   `{data}` is `stdout` unchanged when `cap` declares no `parse` block, else `mapOutput`'s
 *   mapped value once it has passed normalized-schema validation (when the category has one)
 */
function mapAndValidateOutput(adapterId, capability, cap, stdout) {
  if (!cap.parse) {
    return { data: stdout };
  }

  let mapped;
  try {
    mapped = mapOutput(stdout, cap.parse);
  } catch (mapError) {
    return { envelope: { ok: false, error: { code: mapError.code || 'BAD_OUTPUT', message: mapError.message } } };
  }

  const schemaFileName = CAPABILITY_NORMALIZED_SCHEMA[capability] || CATEGORY_NORMALIZED_SCHEMA[capability.split('.')[0]];
  if (!schemaFileName) {
    return { data: mapped };
  }

  let validateNormalized;
  try {
    validateNormalized = getNormalizedValidator(schemaFileName);
  } catch (schemaError) {
    return {
      envelope: {
        ok: false,
        error: {
          code: 'TOOL_FAILED',
          message:
            `${adapterId}: capability '${capability}' could not load its normalized ` +
            `schema: ${schemaError.message}`
        }
      }
    };
  }

  if (!validateNormalized(mapped)) {
    const firstError = validateNormalized.errors && validateNormalized.errors[0];
    const detail = firstError
      ? describeNormalizedSchemaError(firstError)
      : 'does not match the normalized schema';
    return {
      envelope: {
        ok: false,
        error: {
          code: 'BAD_OUTPUT',
          message: `${adapterId}: capability '${capability}' output failed normalized-schema validation (${detail})`
        }
      }
    };
  }

  return { data: mapped };
}

/**
 * Build the `ok:true` runner envelope -- shared so a successful `runCapability`/
 * `runCapabilitySync` call returns the exact same shape.
 *
 * @param {string} capability
 * @param {string} adapterId
 * @param {unknown} source `opts.source`, passed through verbatim
 * @param {string|unknown} data
 * @returns {{ok:true, capability:string, adapter:string, source:unknown, data:(string|unknown)}}
 */
function successEnvelope(capability, adapterId, source, data) {
  return { ok: true, capability, adapter: adapterId, source: source ?? null, data };
}

/**
 * Execute one capability of a resolved, already-validated adapter manifest and resolve to the
 * runner envelope (TRD-011, TRD-012, TRD System Architecture; PRD REQ-023, REQ-002, REQ-022).
 * See this file's header, "runCapability" section, for the full envelope/error-code contract,
 * and the "Shared envelope-building guards" section above for the helpers this function and
 * `runCapabilitySync` both call. Never throws: every failure mode resolves to `{ok:false,
 * error:{code, message}}` instead.
 *
 * @param {{adapter: string, binaries?: string[], allowlist?: {bin:string,sub?:string[]}[],
 *   capabilities?: Record<string, {run: string[], variants?: Record<string, Record<string,
 *   string[]>>}>}} adapter a parsed, already-validated adapter manifest
 * @param {string} capability the capability id to invoke, e.g. `tracker.show`
 * @param {Record<string, unknown>} [args] argument values keyed by placeholder name
 * @param {{timeoutMs?: number, source?: unknown, execFileOptions?: object, categoriesDir?:
 *   string, parentEnv?: NodeJS.ProcessEnv}} [opts] `categoriesDir` is forwarded to
 *   `resolve.lookupContractCapability`'s category-contract lookup in the `!cap` branch below;
 *   defaults to that function's own default (the real
 *   `packages/development/toolchain/categories` directory) when omitted, so no existing caller
 *   is affected -- it exists solely so tests can inject a fixture contract directory without
 *   touching the real on-disk contracts. `parentEnv` defaults to `process.env` and exists
 *   solely so a test can inject a fake parent environment for `buildChildEnv` to filter without
 *   mutating real process state.
 * @returns {Promise<{ok:true, capability:string, adapter:string, source:unknown, data:(string|unknown)}|
 *   {ok:false, error:{code:string, message:string}}>}
 */
async function runCapability(adapter, capability, args = {}, opts = {}) {
  const adapterId = (adapter && adapter.adapter) || '(unknown adapter)';

  const lookup = lookupCapability(adapter, adapterId, capability, opts);
  if (lookup.envelope) return lookup.envelope;
  const cap = lookup.cap;

  const built = buildCapabilityArgv(cap, args);
  if (built.envelope) return built.envelope;
  const argv = built.argv;

  const allowlistEnvelope = checkRuntimeAllowlistEnvelope(adapterId, adapter, argv);
  if (allowlistEnvelope) return allowlistEnvelope;

  const timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT_MS;
  const childEnv = buildChildEnv(
    adapter && adapter.env,
    opts.parentEnv || process.env,
    opts.execFileOptions && opts.execFileOptions.env
  );

  return new Promise((resolve) => {
    let pollTimer = null;
    // `rootIdentity` is `{pid, startedAt}` once the direct child's own ps-table row has been
    // observed at least once -- it is ALSO a candidate for pid reuse (after it exits, the OS
    // can hand its pid to an unrelated process before this callback runs), so it goes through
    // the exact same re-verify-then-kill path as every descendant, never a bare
    // `process.kill(rootPid, ...)` (reviewer round 2).
    let rootIdentity = null;
    let descendantIdentities = new Map();

    let finalPollTimer = null;
    const stopTracking = () => {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      if (finalPollTimer) {
        clearTimeout(finalPollTimer);
        finalPollTimer = null;
      }
    };

    let child;
    try {
      child = execFile(
        argv[0],
        argv.slice(1),
        {
          maxBuffer: DEFAULT_MAX_BUFFER_BYTES,
          encoding: 'utf8',
          ...opts.execFileOptions,
          env: childEnv,
          timeout: timeoutMs,
          killSignal: 'SIGKILL',
          shell: false
        },
        (error, stdout, stderr) => {
          stopTracking();

          if (error) {
            if (error.killed || error.signal) {
              const toVerify = new Map(descendantIdentities);
              if (rootIdentity) toVerify.set(rootIdentity.pid, rootIdentity.startedAt);
              // If polling was expected (a real, non-mocked child on a POSIX platform) but the
              // root's own identity was NEVER successfully observed even once (an
              // always-unusable `ps` -- see `listProcessTable`'s header), `toVerify` is
              // guaranteed empty here and `killVerifiedPidsSafe`'s own "nothing to verify"
              // shortcut would otherwise misreport this as a vacuous `true` (reviewer round 3,
              // P2): harmless for the fallback below, which only ever reaches the direct child
              // regardless, but `verified` must still honestly report "never actually checked"
              // rather than "checked, all clear".
              const neverObservedRoot =
                rootPid !== null && process.platform !== 'win32' && rootIdentity === null;
              const verified = !neverObservedRoot && killVerifiedPidsSafe(toVerify);
              if (!verified && child && typeof child.kill === 'function') {
                // Verification itself could not be trusted (e.g. `ps` unavailable or unusable --
                // see `listProcessTable`/`killVerifiedPidsSafe` headers): fall back to the one
                // thing that is always safe regardless -- Node's own tracked handle for the
                // direct child, which targets the exact process it spawned with no pid-identity
                // check needed. Never signal an unverified raw descendant pid.
                try {
                  child.kill('SIGKILL');
                } catch {
                  // Already exited -- nothing to clean up.
                }
              }
              resolve({
                ok: false,
                error: {
                  code: 'TIMEOUT',
                  message:
                    `${adapterId}: capability '${capability}' exceeded its timeout of ` +
                    `${timeoutMs}ms and was killed`
                }
              });
              return;
            }

            const exitCode = typeof error.code === 'number' ? error.code : null;
            const successExitCodes = Array.isArray(cap.successExitCodes) ? cap.successExitCodes : null;
            const toleratedExit =
              exitCode !== null && successExitCodes !== null && successExitCodes.includes(exitCode);

            if (!toleratedExit) {
              const rawDetail = nonZeroExitDetail(stderr, stdout, error.message);
              resolve({
                ok: false,
                error: {
                  code: 'TOOL_FAILED',
                  message: `${adapterId}: capability '${capability}' failed: ${redactAndBound(rawDetail)}`
                }
              });
              return;
            }

            // A manifest-declared tolerated non-zero exit (`cap.successExitCodes`, TRD-
            // 2026-8d825f54 PR 10 fix round item 3): some tools (the shipped per-language test
            // runners) exit non-zero to report a FAILING suite, not a crash -- fall through to
            // the same stdout handling a zero exit gets below instead of TOOL_FAILED. Stdout
            // that does not even parse as the capability's own declared JSON `parse.format` is
            // still indistinguishable from a real crash, so it stays TOOL_FAILED rather than
            // reaching BAD_OUTPUT/ok:true below.
            if (cap.parse && cap.parse.format === 'json') {
              const trimmedStdout = stdout ? String(stdout).trim() : '';
              try {
                JSON.parse(trimmedStdout);
              } catch (parseError) {
                resolve({
                  ok: false,
                  error: {
                    code: 'TOOL_FAILED',
                    message:
                      `${adapterId}: capability '${capability}' exited ${exitCode} (declared a ` +
                      `tolerated exit code) with output that does not parse as JSON: ` +
                      `${redactAndBound(parseError.message)}`
                  }
                });
                return;
              }
            }
          }

          const errorEnvelope = checkZeroExitErrorEnvelope(adapterId, capability, stdout);
          if (errorEnvelope) {
            resolve(errorEnvelope);
            return;
          }

          const mapped = mapAndValidateOutput(adapterId, capability, cap, stdout);
          if (mapped.envelope) {
            resolve(mapped.envelope);
            return;
          }

          resolve(successEnvelope(capability, adapterId, opts.source, mapped.data));
        }
      );

      const rootPid = child && typeof child.pid === 'number' ? child.pid : null;
      if (rootPid !== null && process.platform !== 'win32') {
        const refreshIdentities = () => {
          const rows = listProcessTable();
          if (!rows) return;
          const rootRow = rows.find((row) => row.pid === rootPid);
          if (rootRow) rootIdentity = { pid: rootPid, startedAt: rootRow.startedAt };
          // MERGE, never overwrite: a poll that happens to race the root's actual death (the
          // kernel reparents every descendant away from it at that exact instant, which can
          // land before `execFile`'s own exit-callback delivery, especially under heavy
          // concurrent system load) would otherwise see an EMPTY ppid-walk this one time and
          // wipe out an identity a PRIOR poll had already correctly, verifiably observed --
          // destroying real evidence of a still-alive descendant (reviewer round 4 follow-up:
          // measured live, under 34-way concurrent jest load, a descendant correctly tracked
          // across dozens of prior polls vanishing from `toVerify` on the exact poll that
          // coincided with the root's death). A stale leftover entry for a pid that is
          // genuinely gone is harmless: `killVerifiedPidsSafe` always re-verifies the EXACT
          // current `startedAt` at kill time and skips anything that does not match or is
          // absent, so never pruning here costs nothing and loses nothing.
          for (const [pid, startedAt] of collectDescendants(rootPid, rows)) {
            descendantIdentities.set(pid, startedAt);
          }
        };
        // Read once immediately (not just on the first interval tick, PROCESS_TREE_POLL_MS
        // later): a timeout shorter than one poll interval must still have a root identity to
        // verify against on timeout. This immediate read captures the root but is not
        // meaningful for descendants (none exist yet, an instant after spawn).
        refreshIdentities();
        pollTimer = setInterval(refreshIdentities, PROCESS_TREE_POLL_MS);
        if (typeof pollTimer.unref === 'function') pollTimer.unref();
        // One more PROACTIVE poll scheduled to land shortly BEFORE the timeout itself fires
        // (never reactively inside the `execFile` callback above -- by the time that callback
        // runs the direct child is already dead and reaped, so any detached descendant it had
        // has already been reparented away from it, which breaks ppid-based descendant
        // discovery entirely; see this file's header, "Timeout containment"). This narrows,
        // without eliminating, the gap for a descendant spawned after the last regular
        // `PROCESS_TREE_POLL_MS` tick but before the deadline (reviewer round 3, P3), including
        // when the whole timeout is shorter than one regular poll interval and the
        // `setInterval` above would otherwise never tick at all before the deadline.
        const finalPollDelay = Math.max(0, timeoutMs - FINAL_POLL_MARGIN_MS);
        finalPollTimer = setTimeout(refreshIdentities, finalPollDelay);
        if (typeof finalPollTimer.unref === 'function') finalPollTimer.unref();
      }
    } catch (error) {
      stopTracking();
      resolve({
        ok: false,
        error: {
          code: 'TOOL_FAILED',
          message: `${adapterId}: capability '${capability}' could not be started: ${error.message}`
        }
      });
    }
  });
}

/**
 * Synchronous counterpart to `runCapability` above (TRD-025, PRD AC-016-2): the in-process
 * entry point an existing SYNCHRONOUS caller (`trd-cli.js#getBeadCounts`/`#runBeadContext`,
 * `beads-label.js#runBr`, `complexity-analyzer.js#loadBead`) routes through instead of calling
 * `br`/`bv` directly, without itself becoming `async` -- every one of those callers' own
 * callers (and their existing tests) expect a synchronous return value; TRD-025's own
 * Implementation AC requires their behavior to stay unchanged. Shares every pure guard with
 * `runCapability` through the "Shared envelope-building guards" functions above it in this
 * file (capability lookup/`UNAVAILABLE` fallback, argv building, the runtime allowlist
 * re-check, child-environment filtering via `buildChildEnv`, `TOOL_FAILED` detail redaction/
 * truncation, the zero-exit stdout-error-envelope check, `mapOutput` + normalized-schema
 * validation, and the full `NOT_ALLOWED`/`INVALID_ARG`/`TIMEOUT`/`TOOL_FAILED`/`BAD_OUTPUT`/
 * `UNAVAILABLE` error taxonomy) so the two entry points cannot silently diverge; see
 * `tests/toolchain-runner-sync-parity.test.js`, which calls both with the SAME manifest/
 * capability/args and asserts identical envelopes for each guard. Never throws: every failure
 * mode resolves to `{ok:false, error:{code, message}}`, exactly like `runCapability`.
 *
 * Spawns via `child_process.execFileSync` with `shell` explicitly `false` -- never a shell,
 * same as `runCapability` -- and, unlike the sync family's own default (`encoding:'buffer'`,
 * confirmed by direct experiment on this repo's pinned Node: `execFileSync` defaults to a
 * `Buffer` return where `execFile`'s callback defaults to a `utf8` STRING), sets
 * `encoding:'utf8'` as part of the same FIRST, caller-overridable options block `maxBuffer`
 * already occupies, so a capability with no `parse` block returns the identical `data` type
 * (`string`) from either entry point given the identical child stdout.
 *
 * Known limits: `execFileSync` blocks the one JS thread for its whole duration, so no
 * concurrent `setInterval`/`setTimeout` polling can run alongside it the way `runCapability`'s
 * process-tree timeout containment does (see this file's header, "Timeout containment") -- on
 * timeout this function relies solely on `execFileSync`'s own `timeout`/`killSignal` option,
 * which (like plain `execFile` with no containment layered on top) kills only the DIRECT
 * child, never a detached grandchild the direct child may have spawned. This is a documented,
 * deliberate reduction versus `runCapability`'s guarantee, not an oversight: none of this
 * task's real callers' capabilities (`tracker.show`/`tracker.list`/`tracker.label`, backed by
 * `br`, a plain one-shot CLI) spawn a detached descendant. A future synchronous caller whose
 * capability's tool might do so should use `runCapability` (accepting becoming `async`)
 * instead, not this function.
 *
 * @param {Parameters<typeof runCapability>[0]} adapter a parsed, already-validated adapter
 *   manifest
 * @param {string} capability the capability id to invoke, e.g. `tracker.show`
 * @param {Record<string, unknown>} [args] argument values keyed by placeholder name
 * @param {{timeoutMs?: number, source?: unknown, execFileOptions?: object, categoriesDir?:
 *   string, parentEnv?: NodeJS.ProcessEnv}} [opts] identical meaning to `runCapability`'s own
 * @returns {{ok:true, capability:string, adapter:string, source:unknown, data:(string|unknown)}|
 *   {ok:false, error:{code:string, message:string}}} the same envelope shape `runCapability`
 *   resolves to, returned synchronously instead of via `Promise`
 */
function runCapabilitySync(adapter, capability, args = {}, opts = {}) {
  const adapterId = (adapter && adapter.adapter) || '(unknown adapter)';

  const lookup = lookupCapability(adapter, adapterId, capability, opts);
  if (lookup.envelope) return lookup.envelope;
  const cap = lookup.cap;

  const built = buildCapabilityArgv(cap, args);
  if (built.envelope) return built.envelope;
  const argv = built.argv;

  const allowlistEnvelope = checkRuntimeAllowlistEnvelope(adapterId, adapter, argv);
  if (allowlistEnvelope) return allowlistEnvelope;

  const timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT_MS;
  const childEnv = buildChildEnv(
    adapter && adapter.env,
    opts.parentEnv || process.env,
    opts.execFileOptions && opts.execFileOptions.env
  );

  let stdout;
  try {
    stdout = execFileSync(argv[0], argv.slice(1), {
      maxBuffer: DEFAULT_MAX_BUFFER_BYTES,
      encoding: 'utf8',
      ...opts.execFileOptions,
      env: childEnv,
      timeout: timeoutMs,
      killSignal: 'SIGKILL',
      shell: false
    });
  } catch (error) {
    // `execFileSync`'s own maxBuffer-exceeded shape (Node's documented `err.code ===
    // 'ENOBUFS'` contract for this case) ALSO sets `error.signal` (observed: `'SIGTERM'` --
    // Node's own internal kill signal for this failure, never this function's own configured
    // `killSignal:'SIGKILL'`), which would otherwise be misread as a real timeout-triggered
    // kill by the check below (PR 6 review item 2 follow-up: confirmed by direct experiment
    // that `runCapability`'s own `execFile` maxBuffer-exceeded error sets NEITHER `killed` nor
    // `signal`, so it already falls through to the generic `TOOL_FAILED` branch there -- this
    // `error.code !== 'ENOBUFS'` guard makes this function classify the SAME failure the SAME
    // way, instead of reporting a buffer-size problem as a misleading "exceeded its timeout").
    // A genuine sync timeout kill is unaffected: it reports `code: 'ETIMEDOUT'`, never
    // `'ENOBUFS'`.
    if (error.code !== 'ENOBUFS' && (error.killed || error.signal)) {
      return {
        ok: false,
        error: {
          code: 'TIMEOUT',
          message:
            `${adapterId}: capability '${capability}' exceeded its timeout of ` +
            `${timeoutMs}ms and was killed`
        }
      };
    }
    const rawDetail = nonZeroExitDetail(error.stderr, error.stdout, error.message);
    return {
      ok: false,
      error: {
        code: 'TOOL_FAILED',
        message: `${adapterId}: capability '${capability}' failed: ${redactAndBound(rawDetail)}`
      }
    };
  }

  const errorEnvelope = checkZeroExitErrorEnvelope(adapterId, capability, stdout);
  if (errorEnvelope) return errorEnvelope;

  const mapped = mapAndValidateOutput(adapterId, capability, cap, stdout);
  if (mapped.envelope) return mapped.envelope;

  return successEnvelope(capability, adapterId, opts.source, mapped.data);
}

module.exports = {
  buildArgv,
  buildChildEnv,
  listProcessTable,
  collectDescendants,
  killVerifiedPidsSafe,
  runCapability,
  runCapabilitySync
};
