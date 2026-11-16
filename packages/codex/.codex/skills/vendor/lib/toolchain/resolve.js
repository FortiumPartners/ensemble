'use strict';

/**
 * Capability resolution: require/optional-capability checking against a resolved adapter
 * manifest, cross-referenced with the declaring category contract (TRD-2026-8d825f54 TRD-013,
 * PRD REQ-004, AC-004-1, AC-004-2).
 *
 * `requireCapabilities(adapter, required, optional)` is the pre-flight check a caller runs
 * BEFORE invoking `runCapability` (`./runner.js`): it inspects the already-parsed, already-
 * validated adapter manifest's own `capabilities` map directly (no process is spawned, no
 * `runCapability` call is made) and:
 * - throws an `Error` with `error.code === 'UNAVAILABLE'` for the first entry in `required`
 *   that the adapter does not declare. The message names both the missing capability id and
 *   the adapter id (AC-004-1), so a caller never needs to re-derive which of several required
 *   capabilities failed.
 * - returns a per-capability result map for every entry in `optional`: `{available: true}`
 *   when the adapter declares it, or `{available: false, unavailable: true, fallback, message}`
 *   when it does not, where `fallback` is the `fallback` field from the capability's category
 *   contract entry (`packages/development/toolchain/categories/<category>.yaml`, loaded via
 *   `./contracts.js#loadContracts`) when the contract declares one, else `null` (AC-004-2).
 *
 * `lookupContractCapability(capabilityId, categoriesDir)` is the shared lookup both this
 * module and `./runner.js` use to find a capability's category-contract entry (description,
 * inputs, outputs, required, sideEffect, optional fallback) from a dotted `<category>.<name>`
 * id. `./runner.js#runCapability` calls it directly (not `requireCapabilities`) inside its own
 * `!cap` branch so a single, un-declared-but-optional-with-a-fallback capability returns an
 * `unavailable:true` envelope naming the documented fallback instead of a bare `NOT_ALLOWED`,
 * while every other `!cap` case (capability absent from the adapter AND either required or
 * declared nowhere in any contract) keeps returning the original `NOT_ALLOWED` envelope
 * byte-for-byte -- do not change that precedence here as a side effect of unrelated work.
 *
 * ## Known limits
 *
 * `requireCapabilities`'s `required` check only consults `adapter.capabilities`, never the
 * category contract's own `required: true/false` flag: the TRD's AC phrases "required" as
 * "the set of capability ids this feature needs", a caller-supplied list, not an inference from
 * the contract. A caller that wants only contract-mandatory capabilities enforced must build
 * that list itself (e.g. by filtering `loadContracts()` output for `required: true`); this
 * module does not do that inference, to avoid silently requiring capabilities the caller never
 * actually uses.
 *
 * `lookupContractCapability` re-reads and re-parses every `*.yaml` file in `categoriesDir` on
 * every call (via `loadContracts`, which does no caching) -- acceptable for this toolchain's
 * small (14-category) contract set and CLI-invocation lifetime, but a caller resolving many
 * capabilities in a hot loop should memoize `loadContracts()`'s result itself rather than
 * calling this function repeatedly; no caching is added here since none of the real callers in
 * this repo are a hot loop (preflight check, one-off CLI subcommand).
 *
 * ## Reachable from a shipped entry point
 *
 * `requireCapabilities`'s production caller is `toolchain-cli.js`'s `preflight --require
 * <capability>` subcommand (via `./preflight.js#runPreflight`, TRD-013/TRD-014): for each
 * `--require`'d capability's category, `runPreflight` resolves that category's adapter, loads
 * its manifest, and calls `requireCapabilities(manifest, <that category's slice of
 * --require'd ids>, [])` BEFORE running the category's declared health checks -- a missing
 * required capability aborts the whole preflight (`{ok:false, error:{code:'UNAVAILABLE',
 * message}}`) with no health check spawned for any category. `preflight` has no `--optional`
 * flag and never passes a non-empty `optional` list: an optional capability's documented
 * fallback is reported at CALL time instead, by `./runner.js#runCapability`'s own `!cap`
 * branch (see this file's own `lookupContractCapability` doc above) -- `optional` exists on
 * this function's signature for direct callers (and this module's own tests) that want
 * per-capability availability reporting, not because `preflight` uses it.
 *
 * What does NOT exist yet: a command YAML's own `capabilities: {required, optional}` field
 * does not yet make the command's dispatch automatically call `toolchain-cli preflight
 * --require` with those ids before running the command's body. That property, its schema/
 * validator/generator wiring, ships with TRD-022 (PR 5, which depends on TRD-013, this file's
 * own task) -- TRD-022 does NOT wire a runtime caller. The command-preamble refactor that
 * actually inserts a `toolchain-cli preflight --require <ids from capabilities.required>` call
 * into each refactored command's body (`implement-trd-tasks.yaml`, `pr-review-cycle/SKILL.md`,
 * `pr-review-remediation/SKILL.md`, `act-local-ci/SKILL.md`) is TRD-045 (PR 10: Long-tail
 * categories, depends on TRD-022/TRD-042/TRD-043/TRD-036); TRD-047 (PR 11: Lint, equivalence,
 * documentation)'s `lint-provider-refs.js` then enforces the pattern with a `MISSING_PREFLIGHT`
 * violation class for any refactored command missing that preamble call. Do not invent that
 * caller here or elsewhere in this wave; `preflight --require` itself being wired to
 * `requireCapabilities` (this section) is a separate, already-shipped step.
 */

const { loadContracts } = require('./contracts');

/**
 * Look up one capability's entry in its declaring category contract.
 *
 * @param {string} capabilityId dotted `<category>.<name>` id, e.g. `tracker.close`
 * @param {string} [categoriesDir] forwarded to `loadContracts`; defaults to the real
 *   `packages/development/toolchain/categories` directory
 * @returns {{description?: string, inputs?: string[], outputs?: string[], required?: boolean,
 *   sideEffect?: boolean, fallback?: string} | null} the contract capability entry, or `null`
 *   when the category file is missing, unparsable to an object, or does not declare this id
 */
function lookupContractCapability(capabilityId, categoriesDir) {
  const contracts = loadContracts(categoriesDir);
  const category = typeof capabilityId === 'string' ? capabilityId.split('.')[0] : '';
  const contract = contracts[`${category}.yaml`];
  const capabilities = contract && contract.capabilities;
  return (capabilities && capabilities[capabilityId]) || null;
}

/**
 * Check a resolved adapter manifest's own declared capabilities against a caller-required list
 * (throwing `UNAVAILABLE` on the first gap) and a caller-optional list (returning per-capability
 * availability, with the category contract's documented fallback when absent).
 *
 * @param {{adapter?: string, capabilities?: Record<string, unknown>} | null | undefined} adapter
 *   a parsed adapter manifest, same shape `./runner.js#runCapability` consumes
 * @param {string[]} [required] capability ids that MUST be declared by `adapter.capabilities`
 * @param {string[]} [optional] capability ids to report availability for, never throwing
 * @returns {Record<string, {available: boolean, unavailable?: boolean, fallback?: string|null,
 *   message?: string}>} keyed by capability id, one entry per id in `optional`
 * @throws {Error} with `error.code === 'UNAVAILABLE'` naming the first missing `required`
 *   capability id and the adapter id, before touching `optional` or spawning anything
 */
function requireCapabilities(adapter, required = [], optional = []) {
  const adapterId = (adapter && adapter.adapter) || '(unknown adapter)';
  const adapterCapabilities = (adapter && adapter.capabilities) || {};

  for (const capabilityId of required) {
    if (!Object.prototype.hasOwnProperty.call(adapterCapabilities, capabilityId)) {
      const error = new Error(
        `adapter '${adapterId}' does not declare required capability '${capabilityId}'`
      );
      error.code = 'UNAVAILABLE';
      throw error;
    }
  }

  const result = {};
  for (const capabilityId of optional) {
    if (Object.prototype.hasOwnProperty.call(adapterCapabilities, capabilityId)) {
      result[capabilityId] = { available: true };
      continue;
    }

    const declared = lookupContractCapability(capabilityId);
    const fallback = declared && declared.fallback;
    result[capabilityId] = {
      available: false,
      unavailable: true,
      fallback: fallback || null,
      message: fallback
        ? `capability '${capabilityId}' is unavailable on adapter '${adapterId}'; using ` +
          `documented fallback '${fallback}'`
        : `capability '${capabilityId}' is unavailable on adapter '${adapterId}' and has no ` +
          'documented fallback'
    };
  }
  return result;
}

module.exports = { requireCapabilities, lookupContractCapability };
