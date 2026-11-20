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
 * ## Minimum-version gate (TRD-2026-6995dc96 TRD-003, PRD AC-018-2, AC-001-2)
 *
 * A health check that declares `minVersion` (optionally with `versionPattern`, one capture group)
 * is a version probe. Every such check across every resolved adapter runs FIRST, as its own
 * stage (deduplicated per adapter+check id, concurrently among themselves), BEFORE any other
 * health check is issued -- so a too-old tool is never sent a second call (kata's `doctor`).
 * It fails `HEALTH_FAILED`, naming the adapter, the check, the minimum and the reported version,
 * when the reported version is older than `minVersion` or cannot be parsed from stdout (the
 * message names the minimum either way); no record is written. The remaining checks (every
 * check without `minVersion`) then run concurrently exactly as before.
 *
 * Version parsing: the default pattern takes the first `x.y.z` in stdout with an optional
 * `-prerelease` suffix (`kata v0.23.0\n commit: ...` reads `0.23.0`; `v0.24.0-rc.1` reads
 * `0.24.0-rc.1`); a `+build` suffix is ignored. Comparison is numeric per component (`0.100.0`
 * is newer than `0.23.0`), and per semver a pre-release sorts BEFORE its own release
 * (`0.23.0-rc.1 < 0.23.0`, `0.24.0-rc.1 > 0.23.0`). A two-component `minVersion` ("1.2") means
 * "1.2.0". On pass the record (written AND returned) carries `versions: {<adapterId>: <reported
 * version string>}`; the key is absent when no check declared `minVersion`.
 *
 * Resolution errors keep their code when it is `CONTRACT_MAJOR_MISMATCH` (TRD-003: an adapter
 * declaring a contract major that differs from the shipped category contract is refused by
 * `loadAdapter`); every other load error is still wrapped as `HEALTH_FAILED`.
 *
 * ## Binding gate and capability report (TRD-2026-6995dc96 TRD-004, PRD AC-018-1, AC-018-3)
 *
 * A health check that declares `jsonAssert` ({arrayPath, match:{key:value}, field, allow[],
 * failMessage}) parses its stdout as JSON, finds the first element of `arrayPath` whose `match`
 * keys all equal, and requires its `field` to be one of `allow`. Anything else (unparsable
 * output, no matching element, a field outside `allow`) fails closed as `HEALTH_FAILED` carrying
 * `failMessage` verbatim. Kata uses it on `kata doctor --json` (read-only, never starts a daemon)
 * so an unbound workspace stops here, before any work item is written. It runs in stage 2, after
 * the version gate.
 *
 * On pass the record (written AND returned) carries `capabilities`: the `requires` list this
 * preflight verified available (`requireCapabilities`), plus, for a gated category, every capability
 * the adapter's manifest declares. `preflightReportedCapability(runId, cap,
 * ctx)` reads it back (fail closed: no record, no `capabilities` list, or a capability not in it
 * is `false`); `toolchain-cli.js`'s `run` refuses a side-effecting capability preflight did not
 * report with `CAPABILITY_NOT_REPORTED`, before the confirmation step and any adapter call. The
 * refusal is scoped: the record carries `capabilityGate: true` and `gatedCategories` only when a
 * resolved adapter declares `jsonAssert`, and `preflightGatesCapability` is `false` for any other
 * category or a record without the flag, so ungated adapters (beads) keep their prior behaviour.
 *
 * ## Missing binary (TRD-2026-6995dc96 TRD-006, PRD AC-001-3, AC-012-2, AC-012-3)
 *
 * When a selected adapter's health check cannot spawn its binary at all (`runner.js` marks a
 * spawn ENOENT with `error.missingBinary`), preflight fails `{code:'MISSING_BINARY'}` naming the
 * adapter and the binary and telling the user to install it / put it on PATH (or select another
 * adapter) -- never the generic `HEALTH_FAILED`/`TOOL_FAILED` text. Only adapters actually
 * selected for the requested categories are health-checked, so a project that did not select
 * kata never sees a kata failure; and there is no fallback: the failure stops preflight, no
 * record is written and no other adapter (beads) is ever tried in place of the selected one.
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
const { ensureStateDir } = require('./state-dir');
const { isNonInteractive } = require('./confirm');
const { requireCapabilities } = require('./resolve');
const { resolveWorkGraphAdapter } = require('./work-graph-resolve');
const { assertKnownAdapter } = require('./resolve-guard');
const { detectStack, normalizeLanguage } = require('./detect-stack');

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
 * Whether a health check declares a language condition (`when.languages`). Manifests are
 * schema-validated elsewhere, so this only guards against an absent or malformed condition.
 *
 * @param {{when?: {languages?: unknown}}} check
 * @returns {string[]|null} the canonical languages the check applies to, or null when it is
 *   unconditional and must always run
 */
function conditionLanguages(check) {
  const when = check && check.when;
  if (!when || typeof when !== 'object' || !Array.isArray(when.languages) || when.languages.length === 0) {
    return null;
  }
  return when.languages.map(normalizeLanguage).filter(Boolean);
}

/**
 * Drop the health checks whose `when.languages` condition the project does not meet (TRD-less
 * fix for reporter finding 9). Detection runs once per preflight and only when some check is
 * conditional. A project whose languages cannot be detected keeps today's behaviour: an EMPTY
 * detection result means "unknown", so every check still runs and no existing gate can silently
 * disappear. Unconditional checks (no `when`) are never dropped.
 *
 * @param {Array<{adapterId: string, manifest: object, check: object, category: string}>} tasks
 * @param {string} projectRoot directory the checks run in (`ctx.projectRoot`)
 * @returns {Promise<typeof tasks>} the tasks that must run, in the original order
 */
async function applyLanguageConditions(tasks, projectRoot) {
  const conditional = tasks.some((task) => conditionLanguages(task.check) !== null);
  if (!conditional) {
    return tasks;
  }
  let detected = [];
  try {
    const result = await detectStack(projectRoot);
    detected = Array.isArray(result.languages) ? result.languages : [];
  } catch {
    detected = [];
  }
  if (detected.length === 0) {
    return tasks;
  }
  const detectedSet = new Set(detected.map(normalizeLanguage));
  return tasks.filter((task) => {
    const wanted = conditionLanguages(task.check);
    if (wanted === null) {
      return true;
    }
    return wanted.some((language) => detectedSet.has(language));
  });
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
    return { ok: true, stdout: typeof result.data === 'string' ? result.data : '' };
  }

  if (result.error.missingBinary) {
    const binary = path.basename(String(result.error.missingBinary));
    return {
      ok: false,
      error: {
        code: 'MISSING_BINARY',
        message: redactSecrets(
          `${adapterId}: required binary '${binary}' was not found on PATH (health check '${check.id}'); ` +
            `install ${binary} and make sure it is on PATH, or select a different adapter for this project`
        ).text
      }
    };
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
 * Parse a dotted version string into comparable parts, or `null` when it is not one.
 * `0.23.0-rc.1+build5` -> `{core:[0,23,0], pre:'rc.1'}`; `1.2` -> `{core:[1,2,0], pre:null}`.
 *
 * @param {unknown} text
 * @returns {{core: number[], pre: string|null}|null}
 */
function parseVersion(text) {
  const match =
    typeof text === 'string' ? text.trim().match(/^(\d+)\.(\d+)(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/) : null;
  if (!match) {
    return null;
  }
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3] || 0)],
    pre: match[4] || null
  };
}

/**
 * Numeric semver-style comparison: negative when `a < b`, 0 when equal, positive when `a > b`.
 * A pre-release sorts before the release with the same core; two pre-releases compare as strings.
 *
 * @param {{core:number[], pre:string|null}} a
 * @param {{core:number[], pre:string|null}} b
 * @returns {number}
 */
function compareVersions(a, b) {
  for (let i = 0; i < 3; i += 1) {
    if (a.core[i] !== b.core[i]) {
      return a.core[i] < b.core[i] ? -1 : 1;
    }
  }
  if (a.pre === b.pre) return 0;
  if (a.pre === null) return 1;
  if (b.pre === null) return -1;
  return a.pre < b.pre ? -1 : 1;
}

const DEFAULT_VERSION_PATTERN = /(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/;

/**
 * Run one health check carrying `jsonAssert` (see "Binding gate" in the header).
 *
 * @returns {Promise<{ok:true}|{ok:false, error:{code:'HEALTH_FAILED', message:string}}>}
 */
async function runJsonAssertCheck(adapterId, manifest, check, projectRoot) {
  const ran = await runHealthCheck(adapterId, manifest, check, projectRoot);
  if (!ran.ok) {
    return ran;
  }
  const spec = check.jsonAssert;
  const fail = () => ({
    ok: false,
    error: { code: 'HEALTH_FAILED', message: redactSecrets(`${adapterId}: ${spec.failMessage}`).text }
  });
  let parsed;
  try {
    parsed = JSON.parse(ran.stdout);
  } catch {
    return fail();
  }
  const list = parsed && Array.isArray(parsed[spec.arrayPath]) ? parsed[spec.arrayPath] : [];
  const entry = list.find(
    (item) => item && typeof item === 'object' && Object.entries(spec.match).every(([k, v]) => item[k] === v)
  );
  if (!entry || !spec.allow.includes(entry[spec.field])) {
    return fail();
  }
  return { ok: true };
}

/**
 * Run one `minVersion`-declaring check, parse the version from its stdout and compare it with
 * the declared minimum.
 *
 * @returns {Promise<{ok:true, version:string}|{ok:false, error:{code:'HEALTH_FAILED', message:string}}>}
 */
async function runVersionGate(adapterId, manifest, check, projectRoot) {
  const ran = await runHealthCheck(adapterId, manifest, check, projectRoot);
  if (!ran.ok) {
    return ran;
  }

  const fail = (detail) => ({
    ok: false,
    error: {
      code: 'HEALTH_FAILED',
      message: redactSecrets(
        `${adapterId}: health check '${check.id}' requires ${adapterId} minimum version ${check.minVersion}; ${detail}`
      ).text
    }
  });

  const minimum = parseVersion(check.minVersion);
  if (!minimum) {
    return fail(`the declared minVersion '${check.minVersion}' is not a dotted numeric version`);
  }

  let pattern = DEFAULT_VERSION_PATTERN;
  if (typeof check.versionPattern === 'string' && check.versionPattern.length > 0) {
    try {
      pattern = new RegExp(check.versionPattern);
    } catch {
      return fail(`the declared versionPattern '${check.versionPattern}' is not a valid regular expression`);
    }
  }
  const matched = pattern.exec(ran.stdout);
  const reported = matched && (matched[1] !== undefined ? matched[1] : matched[0]);
  const parsed = parseVersion(reported);
  if (!parsed) {
    return fail(`could not read a version from its output, so the minimum cannot be confirmed`);
  }
  if (compareVersions(parsed, minimum) < 0) {
    return fail(`it reported version ${reported}, which is older than the minimum; upgrade ${adapterId}`);
  }
  return { ok: true, version: reported };
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
 * @returns {Promise<{ok:true, runId:string, categories:string[], capabilities:string[], checkedAt:string, versions?:Record<string,string>} |
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
        if (error.code === 'CONTRACT_MAJOR_MISMATCH') {
          return { ok: false, error: { code: error.code, message: error.message } };
        }
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
          // Resolution is keyed on (id, category), not the id alone: an id split across two
          // directories by category (the shipped `plain-git`) otherwise resolves to whichever
          // sorted first and `requireCapabilities` below then fails for every capability of
          // the half that lost (#146).
          category,
          interactive: !isNonInteractive({ nonInteractive, env })
        });
      } catch (error) {
        if (error.code === 'CONTRACT_MAJOR_MISMATCH') {
          return { ok: false, error: { code: error.code, message: error.message } };
        }
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
      checkTasks.push({ adapterId, manifest, check, category });
    }
  }

  // Language-conditional health checks: a check may declare `when.languages`, and then it only
  // applies to a project detected as one of those languages. Filtering happens here, before either
  // stage, so a conditional `minVersion` probe is skipped too and the capability-gate record below
  // only reflects checks that actually ran. Detection is read once per run and only when at least
  // one check is conditional. When no language can be detected, every check runs exactly as before.
  const applicableTasks = await applyLanguageConditions(checkTasks, projectRoot);

  // Stage 1: version probes (checks declaring `minVersion`), deduplicated per adapter+check id,
  // run before ANY other health check is issued (see "Minimum-version gate" in the header).
  const gateTasks = [];
  const seenGates = new Set();
  for (const task of applicableTasks) {
    if (typeof task.check.minVersion !== 'string') continue;
    const key = `${task.adapterId}\u0000${task.check.id}`;
    if (seenGates.has(key)) continue;
    seenGates.add(key);
    gateTasks.push(task);
  }
  const gateResults = await Promise.all(
    gateTasks.map((task) => runVersionGate(task.adapterId, task.manifest, task.check, projectRoot))
  );
  const gateFailure = gateResults.find((result) => !result.ok);
  if (gateFailure) {
    return gateFailure;
  }
  const versions = {};
  gateTasks.forEach((task, index) => {
    versions[task.adapterId] = gateResults[index].version;
  });

  // Stage 2: every remaining check, concurrently, exactly as before.
  const results = await Promise.all(
    applicableTasks
      .filter((task) => typeof task.check.minVersion !== 'string')
      .map((task) =>
        task.check.jsonAssert
          ? runJsonAssertCheck(task.adapterId, task.manifest, task.check, projectRoot)
          : runHealthCheck(task.adapterId, task.manifest, task.check, projectRoot)
      )
  );

  const firstFailure = results.find((result) => !result.ok);
  if (firstFailure) {
    return firstFailure;
  }

  const checkedAt = new Date().toISOString();
  const record = { ok: true, runId, categories: categoryList, capabilities: [...new Set(requires)], checkedAt };
  // Only categories whose resolved adapter declares the binding gate (jsonAssert) enforce the
  // capability report in `run`; every other adapter (beads, ...) is unaffected.
  const gatedCategories = [...new Set(applicableTasks.filter((t) => t.check.jsonAssert).map((t) => t.category))];
  if (gatedCategories.length > 0) {
    record.capabilityGate = true;
    record.gatedCategories = gatedCategories;
    // A passing preflight verified the adapter works, so every capability its manifest declares in a
    // gated category is reported available, not only the `--require` set. The gate still refuses a
    // capability the manifest does not declare.
    const declared = new Set(record.capabilities);
    for (const task of applicableTasks) {
      if (!task.check.jsonAssert) continue;
      for (const id of Object.keys((task.manifest && task.manifest.capabilities) || {})) {
        if (gatedCategories.includes(id.split('.')[0])) declared.add(id);
      }
    }
    record.capabilities = [...declared];
  }
  if (gateTasks.length > 0) {
    record.versions = versions;
  }
  const targetPath = preflightRecordPath(projectRoot, runId);
  const targetDir = path.dirname(targetPath);
  ensureStateDir(projectRoot, targetDir);
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

/**
 * Whether a passing preflight record for `runId` lists `capability` among the capabilities it
 * verified available. Fail closed: no/unreadable/failed record, a record without a
 * `capabilities` array, or a capability not in it all return `false`.
 *
 * @param {unknown} runId
 * @param {string} capability e.g. `tracker.create`
 * @param {{projectRoot?: string}} [ctx]
 * @returns {boolean}
 */
function preflightReportedCapability(runId, capability, ctx = {}) {
  if (!hasPassingPreflightRecord(runId, ctx)) {
    return false;
  }
  const { projectRoot = process.cwd() } = ctx;
  try {
    const parsed = JSON.parse(fs.readFileSync(preflightRecordPath(projectRoot, runId), 'utf8'));
    return Array.isArray(parsed.capabilities) && parsed.capabilities.includes(capability);
  } catch {
    return false;
  }
}

/**
 * Whether `run` must refuse `capability` when the preflight did not report it: true only when a
 * passing record carries `capabilityGate: true` and lists the capability's category in
 * `gatedCategories`. A record without the flag (ungated adapter, or legacy) never refuses.
 *
 * @param {unknown} runId
 * @param {string} capability
 * @param {{projectRoot?: string}} [ctx]
 * @returns {boolean}
 */
function preflightGatesCapability(runId, capability, ctx = {}) {
  if (!hasPassingPreflightRecord(runId, ctx)) {
    return false;
  }
  const { projectRoot = process.cwd() } = ctx;
  try {
    const parsed = JSON.parse(fs.readFileSync(preflightRecordPath(projectRoot, runId), 'utf8'));
    return (
      parsed.capabilityGate === true &&
      Array.isArray(parsed.gatedCategories) &&
      parsed.gatedCategories.includes(String(capability).split('.')[0])
    );
  } catch {
    return false;
  }
}

module.exports = {
  runPreflight,
  preflightGatesCapability,
  hasPassingPreflightRecord,
  preflightReportedCapability,
  DEFAULT_HEALTH_TIMEOUT_MS
};
