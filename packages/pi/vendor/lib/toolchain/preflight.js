'use strict';

/**
 * Preflight: health-check gating before any side-effecting capability runs (TRD-2026-8d825f54
 * TRD-014, PRD REQ-013, AC-013-1/2/3).
 *
 * `runPreflight({categories, runId, nonInteractive}, ctx)` resolves each category's adapter
 * (via `resolveCategory`/`loadAdapter`, the same `ctx = {projectRoot, env, detect}` convention
 * those modules already use -- `ctx.detect` is threaded all the way through from
 * `toolchain-cli.js`'s `preflight` handler, PR 4 review Finding 1: a prior wave's `ctx` here
 * only carried `{projectRoot, env}`, so a detection-selected adapter (`source: 'detection'` via
 * `resolve`/`explain`/`run`) silently fell through to the shipped default here instead and
 * `preflight` health-checked THAT, never the adapter actually configured), then runs every one
 * of those adapters' declared `health` checks concurrently (`Promise.all`, never sequentially)
 * through `runCapability` (TRD-011) -- this module never spawns a process directly. Only when
 * every check across every category passes does it write a preflight record to
 * `<projectRoot>/.ensemble/state/toolchain/preflight-<runId>.json`. On the first failing check
 * it resolves to `{ok:false, error:{code:'HEALTH_FAILED', message}}` naming the adapter and
 * check id (and containing the literal text "timed out" when the failure was a timeout) and
 * writes no record at all.
 *
 * Every health check runs with `cwd` set to `ctx.projectRoot` (kata vsg4 review round 1: they
 * used to inherit the CLI process's own cwd, so under `toolchain-cli.js --project-root <path>`
 * the health gate for the tree named by the flag was certified by a command that had run in a
 * different repository -- while the passing record `run` gates on was still written into the
 * flagged tree). This is the same directory `toolchain-cli.js`'s `run` hands every capability
 * as its `cwd`, so a health check observes exactly the tree its capability will act on.
 *
 * For every non-`work-graph` category, the resolved value is also checked by
 * `./resolve-guard.js#assertKnownAdapter` (TRD-046) BEFORE `loadAdapter` runs (PR 10 fix round,
 * item 2a): an explicit project-/user-config selection naming an adapter id that does not
 * actually ship for that category now fails `{code:'UNKNOWN_ADAPTER'}` naming the category,
 * the bogus id and every real shipped adapter id, instead of the generic `NOT_INSTALLED`
 * (mapped to `HEALTH_FAILED` here) `loadAdapter` would otherwise throw for the exact same
 * misconfiguration -- the envelope shape is unchanged (`{ok:false, error:{code, message}}`),
 * only the `code`/message for this one case changed from `HEALTH_FAILED` to `UNKNOWN_ADAPTER`.
 * `work-graph` is intentionally excluded, the same way every other `assertKnownAdapter` call
 * site excludes it (see that module's own header): it resolves through its own
 * `resolveWorkGraphAdapter`, never `resolveCategory` directly.
 *
 * `hasPassingPreflightRecord(runId, ctx)` reads that same record back: a missing file,
 * unreadable/unparsable JSON, a record whose `ok` field is not exactly `true`, or a `runId`
 * that fails the path-traversal guard below all count as "no passing record" (fail closed,
 * never thrown). `toolchain-cli.js`'s `run` subcommand (TRD-014) is this helper's production
 * caller: before invoking any `sideEffect:true` capability it calls
 * `hasPassingPreflightRecord` and refuses to proceed (`PREFLIGHT_REQUIRED`) whenever it
 * returns `false`.
 *
 * `loadAdapter`'s `interactive` flag is derived via `./confirm.js#isNonInteractive` applied to
 * `{nonInteractive, env}` (PR 4 review Finding 2), the SAME explicit-signal precedence
 * `toolchain-cli.js`'s `run`/`confirm-status`/`confirm-record` handlers use -- never the bare
 * `!nonInteractive` a prior wave used here, which ignored `ENSEMBLE_NON_INTERACTIVE=1`/
 * `FOREMAN_TASK_TITLE`/`CI=true` entirely when `input.nonInteractive` itself was `false`.
 *
 * Run-id charset guard (shared, see `./run-id.js`): a `runId` failing the shared charset
 * (`^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$`) is never used to build a filesystem path.
 * `runPreflight` rejects it up front -- before resolving any adapter or running any check --
 * with `{code:'INVALID_RUN_ID'}` (fail closed with a clear error, never a silent skip);
 * `hasPassingPreflightRecord` rejects it by returning `false`, matching its other fail-closed
 * "no record" cases.
 *
 * ## Known limits
 *
 * - A health check's `timeoutMs` comes straight from the adapter manifest's `health[]` entry.
 *   `adapter-manifest-schema.json` currently requires every health entry to declare
 *   `timeoutMs`, but `loadAdapter`/`readManifest` never enforce that schema at load time, so a
 *   manifest that omits it is still loadable; this module falls back to
 *   `DEFAULT_HEALTH_TIMEOUT_MS` (10000ms) in that case -- never `runner.js`'s own unrelated
 *   60000ms default, which exists for ordinary capability calls, not health checks.
 * - `runPreflight` stops at the first category whose adapter cannot be resolved or loaded at
 *   all (an unknown category, a `NOT_INSTALLED`/`UNTRUSTED_REPO_ADAPTER`/`CONFIG_INVALID`
 *   adapter error) and reports it as `HEALTH_FAILED` naming that category/adapter, rather than
 *   attempting partial progress across the remaining categories.
 * - The written preflight record never includes a health check's raw stdout/stderr (only
 *   `{ok, runId, categories, checkedAt}`), so no further `redactSecrets` pass is needed on the
 *   record itself; `redactSecrets` is still applied to every constructed `HEALTH_FAILED`
 *   message before it is returned, in case an adapter's health-check stderr echoes a
 *   credential.
 * - Preflight records are written atomically (write to a sibling temp file, then
 *   `fs.renameSync` onto the final path) so two processes racing to write the same `runId`'s
 *   record never interleave a corrupt, partially-written JSON file.
 */

const fs = require('fs');
const path = require('path');

const { resolveCategory } = require('./config');
const { loadAdapter } = require('./adapters');
const { runCapability } = require('./runner');
const { redactSecrets } = require('../complexity-analyzer');
const { isValidRunId, invalidRunIdMessage } = require('./run-id');
const { isNonInteractive } = require('./confirm');
const { requireCapabilities } = require('./resolve');
const { resolveWorkGraphAdapter } = require('./work-graph-resolve');
const { assertKnownAdapter } = require('./resolve-guard');

const DEFAULT_HEALTH_TIMEOUT_MS = 10000;

/**
 * Whether `runId` is safe to interpolate into a filesystem path (shared charset, see
 * `./run-id.js` for the full rationale -- this module no longer keeps its own, narrower
 * path-traversal-only check).
 *
 * @param {unknown} runId
 * @returns {boolean}
 */
function isSafeRunId(runId) {
  return isValidRunId(runId);
}

/**
 * `<projectRoot>/.ensemble/state/toolchain` -- the project-local toolchain runtime state root
 * (distinct from the user-level XDG config directory `config-path.js` resolves).
 *
 * @param {string} projectRoot
 * @returns {string}
 */
function stateDir(projectRoot) {
  return path.join(projectRoot, '.ensemble', 'state', 'toolchain');
}

/**
 * The preflight record path for one run id. Callers MUST have already validated `runId` with
 * `isSafeRunId` before calling this.
 *
 * @param {string} projectRoot
 * @param {string} runId
 * @returns {string}
 */
function preflightRecordPath(projectRoot, runId) {
  return path.join(stateDir(projectRoot), `preflight-${runId}.json`);
}

/**
 * Run one health check through `runCapability` (TRD-011) -- never spawning a process directly
 * -- by presenting it as a synthetic single-capability view of the real adapter manifest (same
 * `adapter`/`binaries`/`allowlist`, `capabilities` replaced with just this check keyed by its
 * own `id`), so the runtime allowlist check still denies a health check that calls an
 * undeclared binary or subcommand exactly as it would for an ordinary capability. The check
 * runs with `cwd = projectRoot` (see this file's header); `runCapability` applies its own
 * `env`/`timeout`/`killSignal`/`shell` after `execFileOptions`, so passing `cwd` here cannot
 * widen any of those.
 *
 * @param {string} adapterId
 * @param {object} manifest the adapter's parsed manifest
 * @param {{id: string, run: string[], timeoutMs?: number}} check
 * @param {string} projectRoot directory the check runs in (`ctx.projectRoot`)
 * @returns {Promise<{ok:true}|{ok:false, error:{code:'HEALTH_FAILED', message:string}}>}
 */
async function runHealthCheck(adapterId, manifest, check, projectRoot) {
  const timeoutMs =
    Number.isInteger(check && check.timeoutMs) && check.timeoutMs > 0
      ? check.timeoutMs
      : DEFAULT_HEALTH_TIMEOUT_MS;

  const syntheticAdapter = {
    ...manifest,
    adapter: adapterId,
    capabilities: { [check.id]: { run: check.run } }
  };

  const result = await runCapability(
    syntheticAdapter,
    check.id,
    {},
    { timeoutMs, execFileOptions: { cwd: projectRoot } }
  );

  if (result.ok) {
    return { ok: true };
  }

  const isTimeout = result.error.code === 'TIMEOUT';
  const rawMessage = isTimeout
    ? `${adapterId}: health check '${check.id}' timed out after ${timeoutMs}ms`
    : `${adapterId}: health check '${check.id}' failed (${result.error.code}): ${result.error.message}`;

  return {
    ok: false,
    error: { code: 'HEALTH_FAILED', message: redactSecrets(rawMessage).text }
  };
}

/**
 * Run every health check declared by the adapters selected for `categories`, concurrently, and
 * on full pass write a preflight record for `runId` (TRD-014, PRD REQ-013, AC-013-1/2/3). See
 * this file's header for the full contract.
 *
 * @param {{categories?: string[], runId?: string, nonInteractive?: boolean}} [input]
 * @param {{projectRoot?: string, env?: NodeJS.ProcessEnv, detect?: Function,
 *   installedRoots?: string[]}} [ctx] passed straight through to `resolveCategory`/
 *   `loadAdapter` for every category -- never narrowed to a hand-picked subset of fields, so a
 *   field neither of those two call sites explicitly destructures (for example
 *   `ctx.installedRoots`, PR 5 independent review) still reaches them (PR 4 independent review
 *   Finding 1's "no per-handler rebuilds that can drop fields" rule, applied here too).
 * @returns {Promise<{ok:true, runId:string, categories:string[], checkedAt:string} |
 *   {ok:false, error:{code:string, message:string}}>}
 */
async function runPreflight(input = {}, ctx = {}) {
  const { categories, runId, nonInteractive = false, requires = [] } = input;
  const { projectRoot = process.cwd(), env = process.env } = ctx;

  if (!isSafeRunId(runId)) {
    return {
      ok: false,
      error: {
        code: 'INVALID_RUN_ID',
        message: invalidRunIdMessage(runId)
      }
    };
  }

  const categoryList = Array.isArray(categories) ? categories : [];
  const checkTasks = [];

  for (const category of categoryList) {
    let adapterId;
    let loaded;

    if (category === 'work-graph') {
      // TRD-027: expand the shipped default sentinel `auto` into the real, selected adapter
      // (tracker's own work-graph capabilities, else the built-in `work-graph-links-fallback`)
      // via the same resolver every other `work-graph`-resolving entry point uses.
      let resolved;
      try {
        resolved = resolveWorkGraphAdapter({
          ...ctx,
          projectRoot,
          env,
          interactive: !isNonInteractive({ nonInteractive, env })
        });
      } catch (error) {
        return {
          ok: false,
          error: {
            code: 'HEALTH_FAILED',
            message: `${category}: could not resolve an adapter for preflight (${error.message})`
          }
        };
      }
      adapterId = resolved.value;
      loaded = { origin: resolved.origin, dir: resolved.dir, manifest: resolved.manifest };
    } else {
      let resolvedCategory;
      try {
        resolvedCategory = resolveCategory(category, ctx);
      } catch (error) {
        return {
          ok: false,
          error: {
            code: 'HEALTH_FAILED',
            message: `${category}: could not resolve an adapter for preflight (${error.message})`
          }
        };
      }

      try {
        assertKnownAdapter(category, resolvedCategory, ctx);
      } catch (error) {
        return {
          ok: false,
          error: { code: error.code || 'UNKNOWN_ADAPTER', message: error.message }
        };
      }
      adapterId = resolvedCategory.value;

      try {
        loaded = loadAdapter(adapterId, {
          ...ctx,
          projectRoot,
          env,
          interactive: !isNonInteractive({ nonInteractive, env })
        });
      } catch (error) {
        return {
          ok: false,
          error: {
            code: 'HEALTH_FAILED',
            message: `${adapterId}: could not load the adapter for category '${category}' (${error.message})`
          }
        };
      }
    }

    const requiredForCategory = requires.filter((capability) => capability.split('.')[0] === category);
    try {
      requireCapabilities(loaded.manifest || {}, requiredForCategory, []);
    } catch (error) {
      return {
        ok: false,
        error: { code: error.code || 'UNAVAILABLE', message: error.message }
      };
    }

    const manifest = loaded.manifest || {};
    const healthChecks = Array.isArray(manifest.health) ? manifest.health : [];
    for (const check of healthChecks) {
      checkTasks.push({ adapterId, manifest, check });
    }
  }

  const results = await Promise.all(
    checkTasks.map((task) => runHealthCheck(task.adapterId, task.manifest, task.check, projectRoot))
  );

  const firstFailure = results.find((result) => !result.ok);
  if (firstFailure) {
    return firstFailure;
  }

  const checkedAt = new Date().toISOString();
  const record = { ok: true, runId, categories: categoryList, checkedAt };
  const targetPath = preflightRecordPath(projectRoot, runId);
  const targetDir = path.dirname(targetPath);
  fs.mkdirSync(targetDir, { recursive: true });
  const tmpPath = path.join(
    targetDir,
    `.tmp-${path.basename(targetPath)}-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  fs.writeFileSync(tmpPath, JSON.stringify(record));
  fs.renameSync(tmpPath, targetPath);

  return record;
}

/**
 * Read back a run's preflight record, failing closed: a missing file, unreadable/unparsable
 * JSON, a record whose `ok` field is not exactly `true`, or a traversal-unsafe `runId` all
 * count as "no passing record" and resolve to `false` -- never thrown. This is
 * `toolchain-cli.js`'s `run` subcommand's production gate (TRD-014, see this file's header).
 *
 * @param {unknown} runId
 * @param {{projectRoot?: string}} [ctx]
 * @returns {boolean}
 */
function hasPassingPreflightRecord(runId, ctx = {}) {
  if (!isSafeRunId(runId)) {
    return false;
  }

  const { projectRoot = process.cwd() } = ctx;
  const targetPath = preflightRecordPath(projectRoot, runId);

  let raw;
  try {
    raw = fs.readFileSync(targetPath, 'utf8');
  } catch {
    return false;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return false;
  }

  return Boolean(parsed) && parsed.ok === true;
}

module.exports = {
  runPreflight,
  hasPassingPreflightRecord,
  DEFAULT_HEALTH_TIMEOUT_MS
};
