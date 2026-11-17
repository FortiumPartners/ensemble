'use strict';

/**
 * Passive confirmation records for side-effecting capabilities (TRD-2026-8d825f54 TRD-017, PRD
 * REQ-011, AC-011-1..5). `confirmStatus(category, ctx)` answers "has this adapter already been
 * confirmed in this session for this category/config?" without ever prompting itself (no TTY
 * read, no readline — this module is passive by design: the interactive surface that would
 * actually show a user a prompt and call `recordConfirmation` on "yes" does not exist yet, see
 * "Known limits" below). `recordConfirmation(category, ctx)` writes the record a future
 * confirmation UI would call after a user says yes.
 *
 * ## Spike: which session id does each runtime actually expose?
 *
 * TRD-017 requires this module to begin with a spike recording which session id each runtime
 * exposes, since no stable session id is uniformly available (TRD interpretation I4). Verified
 * by grep against this repo's own runtime-integration docs/code before writing this table (not
 * taken on faith):
 *
 * | Runtime | Session-id variable | Notes |
 * |---|---|---|
 * | Claude Code | `CLAUDE_SESSION_ID` | Confirmed: `docs/guides/environment-variables.md`'s
 * |   |   | "Injected by Claude Code" section documents it as injected automatically into every
 * |   |   | process. The one real, confirmed host session variable in this repo today. |
 * | Ensemble (canonical) | `ENSEMBLE_SESSION_ID` | NOT currently set by any runtime integration
 * |   |   | in this repo (grep across the repo finds it referenced only in this TRD's own task
 * |   |   | prose, never produced by code). Reserved as the highest-precedence lookup below so
 * |   |   | no future code change is needed once a runtime starts setting it. |
 * | Ensemble lifecycle hooks | `ENSEMBLE_RUN_ID` (not a session id) | `docs/guides/command-lifecycle-hooks.md`
 * |   |   | confirms the lifecycle-hook runner sets `ENSEMBLE_RUN_ID` (plus `ENSEMBLE_EVENT`,
 * |   |   | `ENSEMBLE_COMMAND`, `ENSEMBLE_PROJECT_ROOT`) — but ONLY inside the hook-handler
 * |   |   | child processes it spawns itself; `toolchain-cli` invoked from an ordinary agent
 * |   |   | shell command does not inherit it. |
 * | Pi / OMP | none found | `grep -rl SESSION_ID packages/pi` and `grep -rl RUN_ID packages/pi`
 * |   |   | both return no matches in this repo. |
 * | Codex | none found | `grep -rl SESSION_ID packages/codex` and `grep -rl RUN_ID
 * |   |   | packages/codex` both return no matches in this repo. |
 * | OpenCode | none found | No `packages/opencode` integration and no `SESSION_ID`/`RUN_ID`
 * |   |   | reference anywhere outside the runtimes above exist in this repo. |
 * | Foreman | none found | No `SESSION_ID`/`RUN_ID` environment-variable producer for Foreman
 * |   |   | exists in this repo's `docs/guides`/`docs/architecture`. |
 *
 * Conclusion (I4 materializes): most runtimes expose nothing. `resolveSessionKey` therefore
 * returns `null` far more often than not, and both `confirmStatus`/`recordConfirmation` fall
 * back to the caller-supplied run id (`ctx.runId`) when `resolveSessionKey` returns `null`
 * (PR 4 review Finding 3: the OLD code fell back further, to the literal string `'no-session'`,
 * when `ctx.runId` was also absent -- that created a single, persistent, SHARED confirmation
 * token: any keyless caller for the same `(category, adapter, configHash)` satisfied every
 * OTHER keyless caller, with no session or run tying them together at all. There is no such
 * further fallback now: see "Keyless rejection" below).
 *
 * ## Fallback precedence chain
 *
 * `resolveSessionKey(ctx)`: `ctx.env.ENSEMBLE_SESSION_ID` (a valid candidate per "Session-key
 * validation" below) -> else `ctx.env.CLAUDE_SESSION_ID` (same validation) -> else `null`.
 * Callers (`confirmStatus`/`recordConfirmation`, via the internal `effectiveSessionKey` helper
 * below) then fall back to `ctx.runId` (also validated) when `resolveSessionKey` returns
 * `null`; when BOTH are absent or invalid, `effectiveSessionKey` returns `null` and callers
 * fail closed per "Keyless rejection" below -- this chain never throws itself, only its two
 * callers do, and only in the keyless case.
 *
 * ## Session-key validation
 *
 * Every raw candidate (`ENSEMBLE_SESSION_ID`, `CLAUDE_SESSION_ID`, `ctx.runId`) is checked by
 * `isValidSessionKeyCandidate` before use as a session key: it must be a non-empty string, at
 * most `MAX_SESSION_KEY_LENGTH` characters, and contain no NUL byte. A candidate failing this
 * is treated exactly like an absent one (never thrown, never used) -- it is still eventually
 * hashed into a filename-safe sha256 digest (see "File-naming / hashing scheme" below) so this
 * is not a path-traversal defense; it exists so one runtime's malformed or absurdly large
 * injected env var can never silently become part of a confirmation key, and so the key a
 * human would actually recognize in a log line stays bounded.
 *
 * ## Keyless rejection
 *
 * When `effectiveSessionKey` returns `null` (no session id, no usable run id):
 * `confirmStatus` never reads the filesystem and returns `{confirmed: false, required: true,
 * reason: 'NO_CONFIRM_KEY', adapter, source, ...(allowlist pass-through)}` -- always
 * unconfirmed, never `confirmed: true`. `recordConfirmation` writes nothing and throws an
 * `Error` with `.code === 'CONFIRM_KEY_REQUIRED'` naming the two ways to supply a key (set
 * `ENSEMBLE_SESSION_ID`/`CLAUDE_SESSION_ID`, or pass `--run-id`).
 *
 * ## Unknown-selection rejection
 *
 * `confirmStatus`/`recordConfirmation` also reject a missing/non-string/empty `ctx.adapter` or
 * `ctx.source` BEFORE ever computing `configHash` -- `configHash(adapter, source)` is never
 * called with a null/undefined operand. `confirmStatus` returns `{confirmed: false, required:
 * true, reason: 'ADAPTER_SOURCE_REQUIRED'}`; `recordConfirmation` throws `.code ===
 * 'ADAPTER_SOURCE_REQUIRED'` and writes nothing. This check runs first, before the keyless
 * check above.
 *
 * ## File-naming / hashing scheme
 *
 * `configHash(adapter, source)` is `sha256(JSON.stringify({adapter, source}))` hex: it changes
 * whenever a config edit changes which adapter/source is selected for the category (AC-011-4),
 * and stays stable when nothing changed (AC-011-2). The confirmation record's file key is
 * `sha256([sessionKey, category, adapter, hash].join('\u0000'))` hex, stored at
 * `<projectRoot>/.ensemble/state/toolchain/confirmations/<fileKey>.json`. A sha256 hex digest is
 * inherently filename-safe (fixed charset `[0-9a-f]{64}`, no path-traversal risk) regardless of
 * what `sessionKey`/`category`/`adapter` themselves contain, satisfying the shared
 * filename-safety bar without routing through `./run-id.js` (that validator is for
 * caller-supplied run ids used verbatim in a filename; this module never does that — it only
 * ever uses a run id as one hashed input among several).
 *
 * ## Concurrency safety
 *
 * Two processes confirming at the same instant for DIFFERENT categories (or different
 * adapters, or different configs) hash to two different `fileKey`s and therefore two different
 * files — they never contend for the same path, so no lock is needed for that case. Two
 * processes confirming the SAME `(sessionKey, category, adapter, configHash)` tuple at the same
 * instant both write via the atomic temp-file-then-rename pattern (`preflight.js#runPreflight`'s
 * exact pattern, reused here), so the record file itself is never observed half-written; the
 * last rename to land simply wins, which is correct here since both writers were recording an
 * identical confirmation for an identical tuple.
 *
 * ## Known limits
 *
 * - `recordConfirmation` is now reachable from the CLI via `toolchain-cli.js confirm-record`
 *   (TRD-018), which shares `confirmStatus`'s own `confirm-status` subcommand's resolve/load
 *   prelude. Both `confirmStatus`'s deny path (`CONFIRMATION_REQUIRED`, wired into
 *   `toolchain-cli.js`'s `run` subcommand) and `recordConfirmation` are reachable from the
 *   shipped CLI.
 * - This module never prompts a user itself (no TTY read); it is a passive status check plus a
 *   passive record-writer. The interactive confirmation UI that would call `recordConfirmation`
 *   after a real user says "yes" is out of scope here (TRD-018).
 * - `configHash` is keyed on the *selection* (adapter id + precedence tier) per the bead's
 *   AC-011-2 wording, not on the selected adapter's own manifest/SKILL content: an edit to an
 *   already-selected adapter's `adapter.yaml` (allowlist, capabilities, contractVersion) does
 *   not by itself invalidate an existing confirmation.
 * - **`confirm-record` is a consent UX gate, not a security boundary (PR 4 review, NOT a code
 *   defect).** Per the TRD System Architecture data-flow step 3, a command's intended flow is:
 *   ask the user via `AskUserQuestion` (rewritten to `ask` on Pi/OMP), then call
 *   `confirm-record`. This module has no way to verify that call actually followed a real
 *   user's "yes" -- any process able to invoke `toolchain-cli confirm-record` (including a
 *   malicious in-session agent, or a hostile script already executing with the user's
 *   privileges) can call it directly and skip the question entirely. The gate exists to catch
 *   silent provider mix-ups (Threat Model row "A resolved adapter silently differs from the
 *   user's expectation"), i.e. an honest command picking the wrong adapter without the human
 *   noticing -- it is not, and was never designed to be, a defense against an already-compromised
 *   or adversarial caller. The TRD explicitly forbids inferring interactivity from TTY presence
 *   (I4/TRD-017), so no TTY check is added here to "harden" this: that would not change who can
 *   call `confirm-record`, only add a false sense of protection against a threat this gate was
 *   never scoped to mitigate.
 * - **One record covers a whole category per session, not one per capability (PR 4 review, NOT
 *   a code defect).** The confirmation record key is `(sessionKey, category, adapter,
 *   configHash)` -- there is no capability dimension at all. This is the TRD-017/AC-011-2
 *   design intent: confirming `tracker`'s resolved adapter once in a session covers every
 *   `tracker.*` capability that session invokes against that same adapter/config, not just the
 *   one capability that happened to trigger the prompt. A command calling multiple
 *   side-effecting capabilities in the same category within one session only ever prompts (or
 *   auto-confirms, non-interactively) once.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ensureStateDir } = require('./state-dir');

const MAX_SESSION_KEY_LENGTH = 512;

/**
 * Whether `value` is usable as a session-key candidate (raw `ENSEMBLE_SESSION_ID`/
 * `CLAUDE_SESSION_ID`/`ctx.runId`, before hashing): a non-empty string, at most
 * `MAX_SESSION_KEY_LENGTH` characters, containing no NUL byte. See this file's header
 * "Session-key validation" section -- this is a defensive input-shape check, not a
 * path-traversal defense (every candidate is hashed before it ever reaches a filename).
 *
 * @param {unknown} value
 * @returns {boolean}
 */
function isValidSessionKeyCandidate(value) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_SESSION_KEY_LENGTH &&
    !value.includes('\u0000')
  );
}

/**
 * The canonical Ensemble session id, then Claude Code's injected session id, then `null` when
 * neither is set or valid (see this file's header spike table/fallback-chain/session-key
 * validation sections). A candidate failing `isValidSessionKeyCandidate` (absurd length, a NUL
 * byte) is treated exactly like an absent one -- never thrown, never used.
 *
 * @param {{env?: NodeJS.ProcessEnv}} ctx
 * @returns {string|null}
 */
function resolveSessionKey(ctx) {
  const env = (ctx && ctx.env) || {};
  if (isValidSessionKeyCandidate(env.ENSEMBLE_SESSION_ID)) {
    return env.ENSEMBLE_SESSION_ID;
  }
  if (isValidSessionKeyCandidate(env.CLAUDE_SESSION_ID)) {
    return env.CLAUDE_SESSION_ID;
  }
  return null;
}

/**
 * `resolveSessionKey(ctx)`, falling back to `ctx.runId` (also validated by
 * `isValidSessionKeyCandidate`), and `null` when neither is available or valid (PR 4 review
 * Finding 3: no further fallback to a shared literal bucket -- see this file's header "Keyless
 * rejection" section). Callers (`confirmStatus`/`recordConfirmation`) are the ones that fail
 * closed on `null`; this helper itself never throws.
 *
 * @param {{env?: NodeJS.ProcessEnv, runId?: string}} ctx
 * @returns {string|null}
 */
function effectiveSessionKey(ctx) {
  const sessionKey = resolveSessionKey(ctx);
  if (sessionKey !== null) {
    return sessionKey;
  }
  if (isValidSessionKeyCandidate(ctx.runId)) {
    return ctx.runId;
  }
  return null;
}

/**
 * Whether `ctx` carries an EXPLICIT non-interactive signal. The absence of a TTY is never one
 * of these signals (TRD-017 AC: "the absence of a TTY alone never counts as non-interactive") —
 * this function never inspects `process.stdout.isTTY` or anything like it.
 *
 * Precedence: `ctx.nonInteractive === true` (the CLI's own `--non-interactive` flag), OR
 * `ctx.env.ENSEMBLE_NON_INTERACTIVE === '1'`, OR a non-empty `ctx.env.FOREMAN_TASK_TITLE`, OR
 * `ctx.env.CI === 'true'`.
 *
 * @param {{nonInteractive?: boolean, env?: NodeJS.ProcessEnv}} ctx
 * @returns {boolean}
 */
function isNonInteractive(ctx) {
  const env = (ctx && ctx.env) || {};
  if (ctx && ctx.nonInteractive === true) {
    return true;
  }
  if (env.ENSEMBLE_NON_INTERACTIVE === '1') {
    return true;
  }
  if (typeof env.FOREMAN_TASK_TITLE === 'string' && env.FOREMAN_TASK_TITLE.trim() !== '') {
    return true;
  }
  if (env.CI === 'true') {
    return true;
  }
  return false;
}

/**
 * `sha256(JSON.stringify({adapter, source}))` hex — see this file's header "File-naming /
 * hashing scheme" section for why this is the right change signal for AC-011-2/AC-011-4.
 *
 * @param {string} adapter
 * @param {string} source
 * @returns {string}
 */
function configHash(adapter, source) {
  return crypto.createHash('sha256').update(JSON.stringify({ adapter, source })).digest('hex');
}

/**
 * Whether `ctx.adapter`/`ctx.source` are both non-empty strings -- the minimum shape
 * `configHash`/`confirmationRecordPath` require. See this file's header "Unknown-selection
 * rejection" section: this is checked BEFORE `configHash` is ever called, so that function is
 * never invoked with a null/undefined operand.
 *
 * @param {{adapter?: unknown, source?: unknown}} ctx
 * @returns {boolean}
 */
function hasValidSelection(ctx) {
  return (
    typeof ctx.adapter === 'string' &&
    ctx.adapter !== '' &&
    typeof ctx.source === 'string' &&
    ctx.source !== ''
  );
}

/**
 * The confirmation record path for one `(sessionKey, category, adapter, hash)` tuple. See this
 * file's header "File-naming / hashing scheme" / "Concurrency safety" sections.
 *
 * @param {string} projectRoot
 * @param {string} sessionKey
 * @param {string} category
 * @param {string} adapter
 * @param {string} hash
 * @returns {string}
 */
function confirmationRecordPath(projectRoot, sessionKey, category, adapter, hash) {
  const fileKey = crypto
    .createHash('sha256')
    .update([sessionKey, category, adapter, hash].join('\u0000'))
    .digest('hex');
  return path.join(
    projectRoot,
    '.ensemble',
    'state',
    'toolchain',
    'confirmations',
    `${fileKey}.json`
  );
}

/**
 * Whether `category`'s resolved adapter is already confirmed for this session (TRD-017, PRD
 * REQ-011, AC-011-1..5). See this file's header doc for the full contract.
 *
 * - `ctx.sideEffect` falsy (contract marks the capability `sideEffect:false`, or the caller is
 *   checking a local-only capability never routed through this gate at all) -> `{required:
 *   false}` immediately, no filesystem access.
 * - `!hasValidSelection(ctx)` (missing/empty `ctx.adapter`/`ctx.source`) -> fails closed with
 *   `{confirmed: false, required: true, reason: 'ADAPTER_SOURCE_REQUIRED', ...}`, never hashes
 *   a null/undefined selection (see header "Unknown-selection rejection").
 * - `isNonInteractive(ctx)` -> logs one line naming `ctx.adapter`/`ctx.source`/`category` via
 *   `process.stderr.write` and returns `{confirmed: true, prompt: false}` (AC-011-3: no prompt,
 *   the log records adapter and source).
 * - `effectiveSessionKey(ctx) === null` (no session id, no usable run id) -> fails closed with
 *   `{confirmed: false, required: true, reason: 'NO_CONFIRM_KEY', ...}`, no filesystem access
 *   (see header "Keyless rejection" -- PR 4 review Finding 3: no shared `'no-session'` bucket).
 * - Otherwise: reads back the record at `confirmationRecordPath(...)` (fail closed to
 *   unconfirmed on any missing/unreadable/corrupt file — this NEVER throws for that); a record
 *   whose `category`/`adapter`/`configHash` all match the current ones means `{confirmed:
 *   true}`; anything else means `{confirmed: false, adapter, source, ...(allowlist pass-through
 *   when ctx.allowlist was supplied)}`.
 *
 * @param {string} category
 * @param {{projectRoot?: string, env?: NodeJS.ProcessEnv, nonInteractive?: boolean,
 *   sideEffect?: boolean, adapter?: string, source?: string, runId?: string,
 *   allowlist?: unknown}} [ctx]
 * @returns {{required: false} | {confirmed: true, prompt: false} | {confirmed: true} |
 *   {confirmed: false, adapter: string, source: string, allowlist?: unknown} |
 *   {confirmed: false, required: true, reason: string, adapter?: string, source?: string,
 *   allowlist?: unknown}}
 */
function confirmStatus(category, ctx = {}) {
  if (!ctx.sideEffect) {
    return { required: false };
  }

  if (!hasValidSelection(ctx)) {
    return {
      confirmed: false,
      required: true,
      reason: 'ADAPTER_SOURCE_REQUIRED',
      adapter: ctx.adapter,
      source: ctx.source,
      ...(ctx.allowlist ? { allowlist: ctx.allowlist } : {})
    };
  }

  if (isNonInteractive(ctx)) {
    process.stderr.write(
      `toolchain confirm: non-interactive, adapter=${ctx.adapter} source=${ctx.source} category=${category}\n`
    );
    return { confirmed: true, prompt: false };
  }

  if (effectiveSessionKey(ctx) === null) {
    return {
      confirmed: false,
      required: true,
      reason: 'NO_CONFIRM_KEY',
      adapter: ctx.adapter,
      source: ctx.source,
      ...(ctx.allowlist ? { allowlist: ctx.allowlist } : {})
    };
  }

  const projectRoot = ctx.projectRoot || process.cwd();
  const sessionKey = effectiveSessionKey(ctx);
  const hash = configHash(ctx.adapter, ctx.source);
  const recordPath = confirmationRecordPath(projectRoot, sessionKey, category, ctx.adapter, hash);

  let parsed = null;
  try {
    const raw = fs.readFileSync(recordPath, 'utf8');
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }

  if (
    parsed &&
    parsed.category === category &&
    parsed.adapter === ctx.adapter &&
    parsed.configHash === hash
  ) {
    return { confirmed: true };
  }

  return {
    confirmed: false,
    adapter: ctx.adapter,
    source: ctx.source,
    ...(ctx.allowlist ? { allowlist: ctx.allowlist } : {})
  };
}

/**
 * Write a passive confirmation record for `category`'s currently-resolved adapter/source/config
 * (TRD-017, PRD REQ-011). Atomic temp-file-then-rename, the exact pattern
 * `preflight.js#runPreflight` already uses, so two writers never observe a half-written record.
 *
 * Fails closed, writing nothing, in two cases (see header "Unknown-selection rejection" /
 * "Keyless rejection"): `!hasValidSelection(ctx)` throws `.code === 'ADAPTER_SOURCE_REQUIRED'`;
 * `effectiveSessionKey(ctx) === null` throws `.code === 'CONFIRM_KEY_REQUIRED'` naming the two
 * ways to supply a key.
 *
 * @param {string} category
 * @param {{projectRoot?: string, env?: NodeJS.ProcessEnv, adapter?: string, source?: string,
 *   runId?: string}} [ctx]
 * @returns {{confirmed: true}}
 * @throws {Error} with `.code === 'ADAPTER_SOURCE_REQUIRED'` or `.code ===
 *   'CONFIRM_KEY_REQUIRED'`
 */
function recordConfirmation(category, ctx = {}) {
  if (!hasValidSelection(ctx)) {
    const error = new Error(
      `recordConfirmation: category '${category}' needs a resolved adapter and source before ` +
        `it can be recorded (got adapter=${JSON.stringify(ctx.adapter)}, ` +
        `source=${JSON.stringify(ctx.source)})`
    );
    error.code = 'ADAPTER_SOURCE_REQUIRED';
    throw error;
  }

  const sessionKey = effectiveSessionKey(ctx);
  if (sessionKey === null) {
    const error = new Error(
      `recordConfirmation: no session id or run id available to key this confirmation for ` +
        `category '${category}'; set ENSEMBLE_SESSION_ID/CLAUDE_SESSION_ID, or pass --run-id`
    );
    error.code = 'CONFIRM_KEY_REQUIRED';
    throw error;
  }

  const projectRoot = ctx.projectRoot || process.cwd();
  const hash = configHash(ctx.adapter, ctx.source);
  const targetPath = confirmationRecordPath(projectRoot, sessionKey, category, ctx.adapter, hash);
  const targetDir = path.dirname(targetPath);
  ensureStateDir(projectRoot, targetDir);

  const record = {
    category,
    adapter: ctx.adapter,
    source: ctx.source,
    configHash: hash,
    confirmedAt: new Date().toISOString()
  };

  const tmpPath = path.join(
    targetDir,
    `.tmp-${path.basename(targetPath)}-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  fs.writeFileSync(tmpPath, JSON.stringify(record));
  fs.renameSync(tmpPath, targetPath);

  return { confirmed: true };
}

module.exports = { confirmStatus, recordConfirmation, isNonInteractive };
