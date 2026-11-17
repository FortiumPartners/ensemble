'use strict';

/**
 * Built-in `work-graph-links-fallback` adapter (TRD-027, br-jo8y; PRD REQ-016/AC-016-3,
 * REQ-020/AC-020-2/AC-020-3, REQ-004/AC-004-1/AC-004-2; TRD interpretation I7).
 *
 * Implements `work-graph.ready`, `work-graph.plan` and `work-graph.graph-health` (TRD-026: the last
 * answers from the shared scan, `../work-graph-scan.js`) for a tracker adapter whose own manifest
 * does not declare the `work-graph` category (`../work-graph-resolve.js#resolveWorkGraphAdapter`
 * is the only caller that selects this adapter, and only when the resolved tracker's manifest
 * `categories[]` omits `'work-graph'`).
 *
 * This file is a FLAT module directly under `lib/toolchain/builtin/` (not
 * `builtin/work-graph-links-fallback/index.js`) deliberately: `packages/pi`'s
 * `lib-bundler.ts` (the vendoring transform that ships this toolchain into the Pi/Codex
 * runtimes) resolves a relative require of a bare module specifier (no extension) by
 * appending `.js` to the SIBLING path -- it has no directory/`index.js` resolution step, so a nested
 * `builtin/work-graph-links-fallback/index.js` would silently vanish from both vendored
 * bundles (confirmed by direct experiment: `npm run generate:pi` logged `cannot read
 * .../builtin/work-graph-links-fallback.js: ENOENT` until this file moved here). Its
 * `adapter.yaml` lives under the sibling DATA directory,
 * `packages/development/toolchain/builtin/work-graph-links-fallback/adapter.yaml` (not inside
 * `lib/`), matching every other toolchain module's own established convention for non-`.js`
 * data (category contracts, schemas, `toolchain.default.yaml`) -- that whole directory is
 * vendored recursively, unlike `lib/`, which is vendored only via the require-closure walk.
 *
 * ## Execution design: in-process module, not a declarative subprocess adapter
 *
 * Every other adapter in this toolchain is "declarative": its manifest's `capabilities[].run[]`
 * argv template is substituted and spawned by `../runner.js#runCapability`. This adapter is
 * different by necessity -- its whole purpose is to COMPUTE a result from calls to a DIFFERENT
 * (tracker) adapter, which is not an argv template `runner.js` can express. Two designs were
 * considered:
 *   1. Add a small, generic "module capability" hook to `runner.js` itself (a new kind of
 *      `capabilities[]` entry, dispatched by `runCapability` to an in-process function instead
 *      of `execFile`).
 *   2. Keep `runner.js` untouched and have each of this fallback's few callers (the four
 *      `toolchain-cli.js` subcommand handlers that resolve `work-graph`, plus
 *      `../preflight.js#runPreflight`) detect "the resolved work-graph adapter is this builtin
 *      fallback" and call `runWorkGraphCapability` below directly instead of `runCapability`.
 * (2) was chosen: `runner.js` is a small, heavily-reviewed, heavily-tested module whose own
 * header documents an exact, audited envelope/error-code contract shared verbatim between its
 * async and sync entry points (`tests/toolchain-runner-sync-parity.test.js`) -- adding a second,
 * fundamentally different execution kind to it would widen that contract for a single caller.
 * The four CLI call sites and `runPreflight` already each resolve a category's adapter via their
 * own small, explicitly-duplicated block (`toolchain-cli.js`'s own documented convention, "a
 * deliberate, small duplication"), so adding one more conditional branch at each of those
 * existing resolution points is the smaller, more consistent change, and it keeps every other
 * adapter's execution path (including a tracker that genuinely implements `work-graph.*`
 * itself, e.g. `beads` via `bv`) completely unaffected.
 *
 * This module DOES still call `../runner.js#runCapability` -- twice, against the resolved
 * TRACKER adapter's own manifest (`tracker.list`, then `tracker.show` once per listed item) --
 * exactly as the TRD requires ("it calls tracker.list and tracker.show through the runner").
 * Only this fallback's OWN three capabilities bypass `runCapability`; the tracker calls it makes
 * use the real, unmodified runner execution/allowlist/timeout/error-taxonomy path.
 *
 * ## Dependency data shape
 *
 * A work item's dependency links are read from its (already runner-mapped) `tracker.show`
 * result's `dependencies` field, matching the existing normalized work-item schema
 * (`packages/development/toolchain/schemas/normalized/work-item.json`): an array of
 * `{id, type?}` objects. A bare array of id strings is also accepted for robustness, but the
 * canonical, already-documented shape a conforming tracker adapter's `tracker.show` `parse.map`
 * produces is the object form.
 *
 * ## Ordering source / dependency awareness
 *
 * After fetching every listed item's detail via `tracker.show`, this module checks whether ANY
 * fetched item carries a `dependencies` array at all:
 *  - if yes, `orderingSource: 'tracker-links'`, `dependencyAware: true` -- readiness and
 *    ordering are computed from the dependency graph (an item with no `dependencies` field of
 *    its own is treated as having none, i.e. vacuously ready).
 *  - if no (no fetched item's mapped `tracker.show` result carries `dependencies` at all --
 *    the tracker adapter simply does not expose this data), `orderingSource: 'plan-order'`,
 *    `dependencyAware: false` -- items are reported in the order `tracker.list` returned them,
 *    unfiltered by status (TRD Implementation AC 2: "items return in the supplied plan order").
 * All three capabilities' results carry `orderingSource`/`dependencyAware` (TRD: "Every result
 * carries orderingSource so commands print it" -- not just `work-graph.plan`, whose category
 * contract happens to be the one that names the field in its declared `outputs`).
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const { runCapability } = require('../runner');
const { scanWorkGraph, isGraphHealthy } = require('../work-graph-scan');

const ADAPTER_ID = 'work-graph-links-fallback';
const MANIFEST_PATH = path.join(
  __dirname,
  '..',
  '..',
  '..',
  'toolchain',
  'builtin',
  'work-graph-links-fallback',
  'adapter.yaml'
);
const CLOSED_STATUS = 'closed';

/**
 * Read this adapter's `adapter.yaml` fresh off disk (no cache, mirroring
 * `../adapters.js#readManifest`'s own no-cache convention) and present it in the same
 * `{origin, dir, manifest}` shape `../adapters.js#loadAdapter` returns, so callers that already
 * destructure that shape (`../work-graph-resolve.js`, every `toolchain-cli.js` call site) need
 * no special case for this adapter's own identity, only for how its CAPABILITIES execute.
 * `dir` reports the DATA directory the manifest actually lives in (not this file's own
 * `__dirname`, which is a `lib/` directory with no `adapter.yaml` next to it).
 *
 * @returns {{origin: 'builtin', dir: string, manifest: object}}
 */
function loadBuiltinWorkGraphAdapter() {
  const manifest = yaml.load(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  return { origin: 'builtin', dir: path.dirname(MANIFEST_PATH), manifest };
}

/** @param {unknown} status @returns {boolean} */
function isClosedStatus(status) {
  return status === CLOSED_STATUS;
}

/**
 * Normalize one `tracker.list` runner result's `data` into a flat array of (at least)
 * `{id}`-shaped entries, accepting every shape a real, shipped tracker.list capability is
 * documented to return (see `adapter-tracker-beads/adapter.yaml`'s own `tracker.list` comment):
 * a bare array, `{issues:[...]}`, or `{items:[...]}`. `data` may be the raw JSON text (no
 * `parse` block declared, the documented convention for this capability) or an already-mapped
 * value.
 *
 * @param {unknown} rawData
 * @returns {object[]}
 */
function parseListItems(rawData) {
  let parsed = rawData;
  if (typeof rawData === 'string') {
    try {
      parsed = JSON.parse(rawData);
    } catch {
      return [];
    }
  }
  if (Array.isArray(parsed)) return parsed;
  if (parsed && Array.isArray(parsed.issues)) return parsed.issues;
  if (parsed && Array.isArray(parsed.items)) return parsed.items;
  return [];
}

/**
 * Extract dependency ids from a `tracker.show` mapped result's `dependencies` field, or `null`
 * when the field is absent entirely (distinct from an empty array, which means "present, no
 * dependencies" -- `null` means "this tracker never told us").
 *
 * @param {unknown} dependencies
 * @returns {string[] | null}
 */
function dependencyIds(dependencies) {
  if (!Array.isArray(dependencies)) return null;
  return dependencies
    .map((dep) => {
      if (typeof dep === 'string') return dep;
      if (dep && typeof dep === 'object' && typeof dep.id === 'string') return dep.id;
      return null;
    })
    .filter((id) => typeof id === 'string' && id.length > 0);
}

/**
 * Call `tracker.show` (through the runner, against the resolved tracker adapter's manifest)
 * once per listed item, in list order, collecting each mapped result.
 *
 * @param {object} trackerManifest
 * @param {object[]} items from `parseListItems`
 * @param {object} execOpts forwarded verbatim to `runCapability` (`timeoutMs`,
 *   `execFileOptions`, `categoriesDir`, `parentEnv`)
 * @returns {Promise<{detailed: object[]} | {errorEnvelope: {ok:false, error:object}}>}
 */
async function fetchDetailedItems(trackerManifest, items, execOpts) {
  const detailed = [];
  for (const item of items) {
    const id = item && (item.id ?? item.Id ?? item.ID);
    if (typeof id !== 'string' || id.length === 0) continue;

    const showResult = await runCapability(trackerManifest, 'tracker.show', { id }, execOpts);
    if (!showResult.ok) {
      return {
        errorEnvelope: {
          ok: false,
          error: {
            code: showResult.error.code,
            message:
              `${ADAPTER_ID}: calling tracker '${trackerManifest.adapter}' capability ` +
              `'tracker.show' for '${id}' failed: ${showResult.error.message}`
          }
        }
      };
    }
    detailed.push(
      showResult.data && typeof showResult.data === 'object' ? showResult.data : { id }
    );
  }
  return { detailed };
}

/**
 * `work-graph.ready` over dependency-linked data (TRD Implementation AC 1): a non-closed item
 * is ready when every one of its own `dependencies[]` ids resolves to a closed item.
 *
 * @param {object[]} detailed
 * @returns {object[]}
 */
function readyItemsFromDeps(detailed) {
  const closedIds = new Set(detailed.filter((item) => isClosedStatus(item.status)).map((item) => item.id));
  return detailed.filter((item) => {
    if (closedIds.has(item.id)) return false;
    const deps = dependencyIds(item.dependencies);
    if (deps === null) return true;
    return deps.every((depId) => closedIds.has(depId));
  });
}

/**
 * `work-graph.plan` over dependency-linked data: a stable Kahn's-algorithm-style ordering --
 * repeatedly place every non-placed, non-closed item whose own dependencies are all closed or
 * already placed, in original list order, until no further progress is possible. Any leftover
 * (a dependency cycle, or a dependency id this tracker's scope never returned) is appended in
 * original order rather than dropped, so the plan always accounts for every item it was given.
 * Already-closed items are excluded (nothing to plan for work that is already done).
 *
 * @param {object[]} detailed
 * @returns {object[]}
 */
function topoOrderByDependencies(detailed) {
  const closedIds = new Set(detailed.filter((item) => isClosedStatus(item.status)).map((item) => item.id));
  const pending = detailed.filter((item) => !closedIds.has(item.id));
  const placed = [];
  const placedIds = new Set();

  let progressed = true;
  while (pending.length > 0 && progressed) {
    progressed = false;
    for (let i = 0; i < pending.length; ) {
      const item = pending[i];
      const deps = dependencyIds(item.dependencies) || [];
      const satisfied = deps.every((depId) => closedIds.has(depId) || placedIds.has(depId));
      if (satisfied) {
        placed.push(item);
        placedIds.add(item.id);
        pending.splice(i, 1);
        progressed = true;
      } else {
        i += 1;
      }
    }
  }

  placed.push(...pending);
  return placed;
}

/**
 * Execute `work-graph.ready`, `work-graph.plan` or `work-graph.graph-health` in-process against the resolved TRACKER
 * adapter's manifest, calling `tracker.list`/`tracker.show` through the real runner
 * (`../runner.js#runCapability`). Never spawns a process itself; every subprocess this
 * function's execution causes is a `tracker.*` capability of `trackerManifest`, run exactly as
 * `runCapability` would run it for any other caller.
 *
 * @param {string} capability `work-graph.ready` | `work-graph.plan` | `work-graph.graph-health`
 * @param {object} trackerManifest the resolved tracker adapter's parsed, validated manifest
 * @param {Record<string, unknown>} [args] accepted for signature parity with `runCapability`;
 *   the category contract's `scope` input has no defined filtering semantics yet (not exercised
 *   by any Implementation AC), so it is accepted but currently unused rather than invented.
 * @param {{source?: unknown, execOpts?: {timeoutMs?: number, execFileOptions?: object,
 *   categoriesDir?: string, parentEnv?: NodeJS.ProcessEnv}}} [opts]
 * @returns {Promise<{ok:true, capability:string, adapter:string, source:unknown,
 *   data:{items:object[], orderingSource:'tracker-links'|'plan-order', dependencyAware:boolean}}|
 *   {ok:false, error:{code:string, message:string}}>}
 */
async function runWorkGraphCapability(capability, trackerManifest, args = {}, opts = {}) {
  if (
    capability !== 'work-graph.ready' &&
    capability !== 'work-graph.plan' &&
    capability !== 'work-graph.graph-health'
  ) {
    return {
      ok: false,
      error: {
        code: 'NOT_ALLOWED',
        message: `capability '${capability}' is not declared by adapter '${ADAPTER_ID}'`
      }
    };
  }

  const execOpts = opts.execOpts || {};

  const listResult = await runCapability(trackerManifest, 'tracker.list', {}, execOpts);
  if (!listResult.ok) {
    return {
      ok: false,
      error: {
        code: listResult.error.code,
        message:
          `${ADAPTER_ID}: calling tracker '${trackerManifest.adapter}' capability 'tracker.list' ` +
          `failed: ${listResult.error.message}`
      }
    };
  }

  const items = parseListItems(listResult.data);
  const fetched = await fetchDetailedItems(trackerManifest, items, execOpts);
  if (fetched.errorEnvelope) {
    return fetched.errorEnvelope;
  }
  const { detailed } = fetched;

  const hasDependencyData = detailed.some((item) => Array.isArray(item.dependencies));
  const orderingSource = hasDependencyData ? 'tracker-links' : 'plan-order';
  const dependencyAware = hasDependencyData;

  if (capability === 'work-graph.graph-health') {
    // Answers from the shared scan. A tracker that gives no dependency data yields no findings,
    // and `dependencyAware:false` / `orderingSource:'plan-order'` say nothing was checked.
    const { status, findings } = isGraphHealthy(scanWorkGraph(detailed));
    return {
      ok: true,
      capability,
      adapter: ADAPTER_ID,
      source: opts.source ?? null,
      data: { status, findings, orderingSource, dependencyAware }
    };
  }

  let resultItems;
  if (capability === 'work-graph.ready') {
    resultItems = hasDependencyData
      ? readyItemsFromDeps(detailed)
      : detailed.filter((item) => !isClosedStatus(item.status));
  } else {
    resultItems = hasDependencyData ? topoOrderByDependencies(detailed) : detailed;
  }

  return {
    ok: true,
    capability,
    adapter: ADAPTER_ID,
    source: opts.source ?? null,
    data: { items: resultItems, orderingSource, dependencyAware }
  };
}

module.exports = { ADAPTER_ID, loadBuiltinWorkGraphAdapter, runWorkGraphCapability };
