'use strict';

/**
 * Category-contract loading and structural validation.
 *
 * A category contract (`packages/development/toolchain/categories/<category>.yaml`) names
 * the capabilities of one of the 14 tool categories. For each capability the contract must
 * state its inputs, normalized outputs and whether it is required or optional (PRD REQ-002,
 * AC-002-1), matching `packages/development/toolchain/schemas/category-contract-schema.json`.
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const DEFAULT_CATEGORIES_DIR = path.join(__dirname, '..', '..', 'toolchain', 'categories');

/**
 * Read and parse every `*.yaml` file in `categoriesDir`.
 *
 * @param {string} [categoriesDir] defaults to packages/development/toolchain/categories
 * @returns {Record<string, unknown>} parsed contract keyed by file name (e.g. "tracker.yaml")
 */
function loadContracts(categoriesDir = DEFAULT_CATEGORIES_DIR) {
  const fileNames = fs.readdirSync(categoriesDir).filter((name) => name.endsWith('.yaml'));
  const contracts = {};
  for (const fileName of fileNames) {
    const raw = fs.readFileSync(path.join(categoriesDir, fileName), 'utf8');
    contracts[fileName] = yaml.load(raw);
  }
  return contracts;
}

/**
 * Structurally validate one parsed category contract: it must carry a `version: major.minor`
 * string (TRD-002, PRD REQ-003), and every capability must state non-empty `inputs`,
 * non-empty `outputs` and a boolean `required` field.
 *
 * @param {unknown} contract parsed YAML contract (as returned by `loadContracts`)
 * @param {string} fileName name used in error messages, e.g. "tracker.yaml"
 * @returns {{valid: true, errors: []} | {valid: false, errors: string[]}}
 */
function validateContract(contract, fileName) {
  const errors = [];

  if (!contract || typeof contract !== 'object') {
    return { valid: false, errors: [`${fileName}: contract is missing or is not an object`] };
  }

  if (typeof contract.category !== 'string' || contract.category.length === 0) {
    errors.push(`${fileName}: missing a string 'category' field`);
  }

  if (typeof contract.version !== 'string' || !/^\d+\.\d+$/.test(contract.version)) {
    errors.push(`${fileName}: missing or malformed 'version' field (expected 'major.minor', e.g. '1.0')`);
  }

  const capabilities = contract.capabilities;
  const capabilitiesIsEmpty =
    !capabilities ||
    typeof capabilities !== 'object' ||
    (Array.isArray(capabilities) ? capabilities.length === 0 : Object.keys(capabilities).length === 0);
  if (capabilitiesIsEmpty) {
    errors.push(`${fileName}: missing a non-empty 'capabilities' object`);
    return { valid: false, errors };
  }

  const entries = Array.isArray(capabilities)
    ? capabilities.map((capability, index) => [capability && capability.id ? capability.id : `#${index}`, capability])
    : Object.entries(capabilities);

  for (const [capabilityName, capability] of entries) {
    if (!capability || typeof capability !== 'object') {
      errors.push(`${fileName}: capability '${capabilityName}' is not an object`);
      continue;
    }
    if (!Array.isArray(capability.inputs) || capability.inputs.length === 0) {
      errors.push(`${fileName}: capability '${capabilityName}' is missing non-empty 'inputs'`);
    }
    if (!Array.isArray(capability.outputs) || capability.outputs.length === 0) {
      errors.push(`${fileName}: capability '${capabilityName}' is missing non-empty 'outputs'`);
    }
    if (typeof capability.required !== 'boolean') {
      errors.push(`${fileName}: capability '${capabilityName}' is missing a boolean 'required' field`);
    }
  }

  return errors.length === 0 ? { valid: true, errors: [] } : { valid: false, errors };
}

/**
 * Parse a strict `major.minor` version string.
 *
 * @param {string} versionString e.g. "1.0"
 * @param {string} label used in the thrown error message, e.g. "adapterTarget"
 * @returns {{major: number, minor: number}}
 */
function parseContractVersion(versionString, label) {
  const match = typeof versionString === 'string' ? versionString.match(/^(\d+)\.(\d+)$/) : null;
  if (!match) {
    throw new Error(`${label}: '${versionString}' is not a valid 'major.minor' version string`);
  }
  return { major: Number(match[1]), minor: Number(match[2]) };
}

/**
 * Check whether an adapter declaring `adapterTarget` can operate against `contract`,
 * per-category contract versioning (PRD REQ-003, AC-003-1, AC-003-2).
 *
 * A major-version mismatch is incompatible: every capability is reported as missing.
 * Within the same major, capabilities added in a later minor than the adapter targets
 * are reported as unavailable but the overall result is still ok.
 *
 * @param {string} adapterTarget 'major.minor' version the adapter declares it targets
 * @param {{version: string, capabilities: Record<string, {addedInMinor?: number}>}} contract
 * @returns {{ok: boolean, unavailableCapabilities: string[], missingCapabilities: string[], errors: string[]}}
 */
function checkCompat(adapterTarget, contract) {
  const adapterVersion = parseContractVersion(adapterTarget, 'adapterTarget');
  const contractVersion = parseContractVersion(contract.version, 'contract.version');
  const capabilityNames = Object.keys(contract.capabilities);

  if (adapterVersion.major !== contractVersion.major) {
    return {
      ok: false,
      unavailableCapabilities: [],
      missingCapabilities: capabilityNames,
      errors: [
        `adapterTarget '${adapterTarget}' and contract.version '${contract.version}' differ in major ` +
          `version; missing capabilities: ${capabilityNames.join(', ')}`
      ]
    };
  }

  const unavailableCapabilities = capabilityNames.filter(
    (name) => (contract.capabilities[name].addedInMinor || 0) > adapterVersion.minor
  );

  return { ok: true, unavailableCapabilities, missingCapabilities: [], errors: [] };
}

/**
 * Check that `nextContract` only adds to `previousContract` within the same major version:
 * no capability may be removed, no capability's `required` flag may change on a capability
 * both versions share, and a capability newly added in `nextContract` must be optional (PRD
 * REQ-003: "Within a contract major version, new capabilities are added only as optional.",
 * AC-003-3).
 *
 * A major-version bump is exempt from this rule; that is exactly where breaking changes
 * (removals, required-ness changes, required additions) are allowed.
 *
 * @param {{version: string, capabilities: Record<string, {required: boolean}>}} previousContract
 * @param {{version: string, capabilities: Record<string, {required: boolean}>}} nextContract
 * @returns {{ok: boolean, errors: string[]}}
 */
function checkAdditiveOnly(previousContract, nextContract) {
  const previousVersion = parseContractVersion(previousContract.version, 'previousContract.version');
  const nextVersion = parseContractVersion(nextContract.version, 'nextContract.version');

  if (previousVersion.major !== nextVersion.major) {
    return { ok: true, errors: [] };
  }

  const errors = [];
  for (const [capabilityName, previousCapability] of Object.entries(previousContract.capabilities)) {
    const nextCapability = nextContract.capabilities[capabilityName];
    if (!nextCapability) {
      errors.push(`capability '${capabilityName}' was removed within major version ${previousVersion.major}`);
      continue;
    }
    if (previousCapability.required !== nextCapability.required) {
      errors.push(
        `capability '${capabilityName}' had its 'required' flag changed within major version ${previousVersion.major}`
      );
    }
  }

  for (const [capabilityName, nextCapability] of Object.entries(nextContract.capabilities)) {
    if (Object.prototype.hasOwnProperty.call(previousContract.capabilities, capabilityName)) {
      continue;
    }
    if (nextCapability.required) {
      errors.push(
        `capability '${capabilityName}' was added as required within major version ${nextVersion.major}; ` +
          'new capabilities may only be added as optional'
      );
    }
  }

  return { ok: errors.length === 0, errors };
}

module.exports = {
  loadContracts,
  validateContract,
  DEFAULT_CATEGORIES_DIR,
  checkCompat,
  parseContractVersion,
  checkAdditiveOnly
};
