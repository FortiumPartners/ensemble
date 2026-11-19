'use strict';

/**
 * Capability coverage classification (TRD-026, PRD REQ-015/AC-015-1).
 *
 * For one category contract and one adapter manifest, says per capability whether the adapter
 * answers it `native`ly, whether it is reached by `fallback` (the contract names a fallback the
 * adapter does not itself provide), or is `unavailable` (neither). Pure: fs, path and js-yaml
 * only, so the Pi/Codex bundler can vendor it by require-closure.
 *
 * Rule:
 *  - the manifest declares the capability with a `module` (served in-process by the adapter's own
 *    module, e.g. kata work-graph.plan and work-graph.graph-health) => `native`, whatever the
 *    contract names as a fallback.
 *  - the manifest declares the capability without a `module` => `native`, EXCEPT when the
 *    declaration has no `parse` block, the contract names a `fallback` that is a builtin adapter id,
 *    and that id is not the manifest's own adapter: the builtin analyzer computes the answer from
 *    the raw run output (beads-style declarations) => `fallback`.
 *  - not declared: the contract names a `fallback` => `fallback`, otherwise `unavailable`.
 */

const fs = require('fs');
const path = require('path');

// lib/toolchain/ -> ../../toolchain/builtin (the vendored layout keeps the same relative shape).
const BUILTIN_DIR = path.join(__dirname, '..', '..', 'toolchain', 'builtin');

/** @returns {string[]} ids of the builtin adapters (directory names holding an adapter.yaml) */
function builtinFallbackIds() {
  let names;
  try {
    names = fs.readdirSync(BUILTIN_DIR);
  } catch {
    return [];
  }
  return names
    .filter((name) => fs.existsSync(path.join(BUILTIN_DIR, name, 'adapter.yaml')))
    .sort();
}

/**
 * @param {{capabilities?: Record<string, {fallback?: string}>}} contract
 * @param {{adapter?: string, capabilities?: Record<string, object>}} manifest
 * @param {string[]} [builtinIds]
 * @returns {Record<string, 'native'|'fallback'|'unavailable'>}
 */
function classifyCapabilities(contract, manifest, builtinIds = builtinFallbackIds()) {
  const declared = (manifest && manifest.capabilities) || {};
  const result = {};
  for (const [id, cap] of Object.entries((contract && contract.capabilities) || {})) {
    const fallback = cap && cap.fallback;
    const decl = declared[id];
    if (decl !== undefined && decl !== null) {
      const computedByBuiltin =
        !decl.module &&
        !decl.parse &&
        typeof fallback === 'string' &&
        builtinIds.includes(fallback) &&
        fallback !== (manifest && manifest.adapter);
      result[id] = computedByBuiltin ? 'fallback' : 'native';
    } else {
      result[id] = fallback ? 'fallback' : 'unavailable';
    }
  }
  return result;
}

module.exports = { builtinFallbackIds, classifyCapabilities };
