'use strict';

/**
 * Auto-resolution for the `work-graph` category's shipped default value `auto` (TRD-027,
 * br-jo8y; PRD REQ-016/AC-016-3, REQ-020/AC-020-2/AC-020-3, REQ-004/AC-004-1/AC-004-2; TRD
 * interpretation I7).
 *
 * `packages/development/toolchain/toolchain.default.yaml` ships `work-graph: auto`, a sentinel
 * value, not a real adapter id -- `../adapters.js#loadAdapter('auto', ctx)` has no directory
 * literally named `auto` to find and always throws `NOT_INSTALLED`. `resolveWorkGraphAdapter`
 * below is the one place that expands `auto` into a real, loadable adapter, per I7: use the
 * resolved TRACKER adapter's own work-graph capabilities when its manifest declares the
 * `work-graph` category, else the built-in `work-graph-links-fallback` adapter
 * (`./builtin/work-graph-links-fallback`).
 *
 * Every shipped entry point that resolves the `work-graph` category (`toolchain-cli.js`'s
 * `resolveAll`/`run`/`confirmStatus`/`confirmRecord`, `./preflight.js#runPreflight`) calls this
 * function instead of the plain `resolveCategory`+`loadAdapter` pair those same call sites use
 * for every other category, so `auto` resolves to a working adapter from every one of them, not
 * just some (the TRD's hard requirement beyond its literal Implementation AC text: "auto
 * resolution reachable from the shipped CLI for every entry point").
 *
 * A non-`auto` `work-graph` value (set via project/user config, env-compat, or detection) is
 * loaded exactly the way every other category's adapter already is -- this function changes
 * nothing about that path beyond routing it through the same single call site.
 */

const { resolveCategory } = require('./config');
const { loadAdapter } = require('./adapters');
const { runCapability } = require('./runner');
const { confineModulePath } = require('./adapter-module');
const {
  ADAPTER_ID: BUILTIN_WORK_GRAPH_ADAPTER_ID,
  loadBuiltinWorkGraphAdapter,
  runWorkGraphCapability
} = require('./builtin/work-graph-links-fallback');

/**
 * Resolve the `work-graph` category to a real, loadable adapter, expanding the shipped default
 * `auto` per I7.
 *
 * @param {{projectRoot?: string, env?: NodeJS.ProcessEnv, detect?: Function,
 *   installedRoots?: string[], interactive?: boolean, diagnostics?: object[]}} [ctx] forwarded
 *   to `resolveCategory`/`loadAdapter` exactly as every other call site in this repo forwards
 *   it (never narrowed to a hand-picked subset of fields); `ctx.interactive` is read by
 *   `loadAdapter`'s own repo-local trust gate for both the `work-graph` category's own
 *   possible explicit (non-`auto`) adapter AND, in the `auto` case, the resolved tracker
 *   adapter.
 * @returns {{value: string, source: string, autoVia: 'tracker-capabilities'|'builtin-fallback'|
 *   null, origin: 'repo-local'|'user'|'installed'|'builtin', dir: string, manifest: object,
 *   skillMd?: {ok: true, content: string} | {ok: false, error: string},
 *   trackerAdapterId?: string, trackerManifest?: object}} `trackerAdapterId`/`trackerManifest`
 *   are present only when `autoVia === 'builtin-fallback'` -- the resolved tracker's own id and
 *   manifest, needed by a caller that must route the fallback's capabilities through
 *   `./builtin/work-graph-links-fallback#runWorkGraphCapability` (which calls
 *   `tracker.list`/`tracker.show` against THIS manifest, not the fallback's own).
 * @throws {Error} the same `.code`-carrying errors `resolveCategory`/`loadAdapter` already
 *   throw (`NOT_INSTALLED`, `UNTRUSTED_REPO_ADAPTER`, `CONFIG_INVALID`, or an uncoded
 *   `resolveCategory` failure) -- callers catch these exactly as they already catch a plain
 *   `resolveCategory`/`loadAdapter` failure for every other category.
 */
function resolveWorkGraphAdapter(ctx = {}) {
  const resolved = resolveCategory('work-graph', ctx);

  if (resolved.value !== 'auto') {
    const loaded = loadAdapter(resolved.value, { ...ctx, category: 'work-graph' });
    return { value: resolved.value, source: resolved.source, autoVia: null, ...loaded };
  }

  // The internal tracker lookup below is a separate category resolution purely to inspect its
  // manifest; any detection diagnostics it produces belong to 'tracker''s own entry in a
  // resolveAll-style caller, never folded into 'work-graph''s -- so it gets its own, isolated,
  // discarded diagnostics array rather than reusing `ctx.diagnostics` (a shared array would
  // otherwise misattribute a 'tracker' detection exclusion under 'work-graph' instead).
  const trackerCtx = { ...ctx, diagnostics: [] };
  const trackerResolved = resolveCategory('tracker', trackerCtx);
  // Loaded as the tracker it is (resolution is keyed on (id, category) -- #146), then asked
  // whether that same manifest also declares `work-graph`, which is what `auto` means here.
  const trackerLoaded = loadAdapter(trackerResolved.value, { ...trackerCtx, category: 'tracker' });
  const trackerProvidesWorkGraph =
    Array.isArray(trackerLoaded.manifest && trackerLoaded.manifest.categories) &&
    trackerLoaded.manifest.categories.includes('work-graph');

  if (trackerProvidesWorkGraph) {
    return {
      value: trackerResolved.value,
      // The work-graph value is the `auto` default, but the adapter came from the tracker
      // selection, so report that selection's origin (TRD-031): a project that names the tracker
      // reports `project`, and only an unconfigured tracker keeps `default`.
      source: trackerResolved.source,
      autoVia: 'tracker-capabilities',
      ...trackerLoaded
    };
  }

  const builtin = loadBuiltinWorkGraphAdapter();
  return {
    value: BUILTIN_WORK_GRAPH_ADAPTER_ID,
    source: resolved.source,
    autoVia: 'builtin-fallback',
    ...builtin,
    trackerAdapterId: trackerResolved.value,
    trackerManifest: trackerLoaded.manifest
  };
}

/**
 * The single resolver-owned dispatch for every work-graph capability call (TRD-016).
 *
 * 1. A capability declaring `module` is loaded in-process, only from inside the adapter's own
 *    directory (confined before require()).
 * 2. `builtin-fallback` routes to the builtin links analyzer with the tracker manifest.
 * 3. Otherwise the declarative argv runner (`runCapability`) runs it, unchanged.
 *
 * @param {object} resolved result of resolveWorkGraphAdapter
 * @param {string} capability
 * @param {object} args
 * @param {{source?: string, cwd?: string, runCapabilityImpl?: Function, runBuiltinImpl?: Function}} [opts]
 */
async function dispatchWorkGraphCapability(resolved, capability, args, opts = {}) {
  const manifest = resolved && resolved.manifest;
  const cap = manifest && manifest.capabilities && manifest.capabilities[capability];

  if (cap && cap.module && !cap.run) {
    const confined = confineModulePath(resolved.dir, cap.module);
    if (!confined.ok) return confined;
    const exportName = cap.export || 'run';
    try {
      // eslint-disable-next-line global-require, import/no-dynamic-require
      const mod = require(confined.file);
      const fn = mod && mod[exportName];
      if (typeof fn !== 'function') {
        return { ok: false, error: { code: 'MODULE_FAILED', message: `adapter module '${cap.module}' does not export a function '${exportName}'` } };
      }
      const result = await fn(capability, args, { source: opts.source, manifest, dir: resolved.dir, cwd: opts.cwd, timeouts: opts.timeouts });
      if (!result || typeof result !== 'object') {
        return { ok: false, error: { code: 'MODULE_FAILED', message: `adapter module '${cap.module}' returned a non-object result` } };
      }
      return result;
    } catch (error) {
      return { ok: false, error: { code: 'MODULE_FAILED', message: `adapter module '${cap.module}' failed: ${error && error.message ? error.message : error}` } };
    }
  }

  if (resolved.autoVia === 'builtin-fallback') {
    const runBuiltin = opts.runBuiltinImpl || runWorkGraphCapability;
    return runBuiltin(capability, resolved.trackerManifest, args, {
      source: opts.source,
      execOpts: { timeouts: opts.timeouts, execFileOptions: { cwd: opts.cwd } }
    });
  }

  const run = opts.runCapabilityImpl || runCapability;
  return run(manifest, capability, args, { source: opts.source, timeouts: opts.timeouts, execFileOptions: { cwd: opts.cwd } });
}

module.exports = { resolveWorkGraphAdapter, dispatchWorkGraphCapability };
