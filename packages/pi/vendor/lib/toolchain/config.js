'use strict';

/**
 * Toolchain configuration resolution (TRD-2026-8d825f54 TRD-003, PRD REQ-009).
 *
 * Each of the 14 tool categories defined by the contracts in
 * `packages/development/toolchain/categories/` selects exactly one adapter. `resolveCategory()`
 * applies a fixed precedence: project configuration (`.ensemble/toolchain.yaml`), then user
 * configuration (`$XDG_CONFIG_HOME/ensemble/toolchain.yaml`, see `./config-path.js`), then a
 * small set of legacy environment-variable compatibility inputs (host/workflow only), then an
 * optional detection hook (the TRD-016 injection point, absent until then), then the shipped
 * default in `../../toolchain/toolchain.default.yaml`.
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const Ajv = require('ajv');

const { getUserToolchainConfigPath } = require('./config-path');

const DEFAULT_TOOLCHAIN_PATH = path.join(__dirname, '..', '..', 'toolchain', 'toolchain.default.yaml');
const TOOLCHAIN_CONFIG_SCHEMA_PATH = path.join(
  __dirname,
  '..',
  '..',
  'toolchain',
  'schemas',
  'toolchain-config-schema.json'
);

/**
 * Legacy environment-variable compatibility inputs, keyed by the single category each one
 * feeds (PRD REQ-009). Every other category skips this precedence step entirely.
 */
const ENV_COMPAT = {
  host: 'ENSEMBLE_PR_BACKEND',
  workflow: 'ENSEMBLE_BRANCHING_STRATEGY'
};

let compiledValidator = null;

/**
 * Lazily compile and cache the ajv validator for the toolchain config schema.
 * @returns {import('ajv').ValidateFunction}
 */
function getValidator() {
  if (!compiledValidator) {
    const schema = JSON.parse(fs.readFileSync(TOOLCHAIN_CONFIG_SCHEMA_PATH, 'utf8'));
    const ajv = new Ajv({ allErrors: true });
    compiledValidator = ajv.compile(schema);
  }
  return compiledValidator;
}

/**
 * Describe the offending property for the first ajv validation error, for use in error
 * messages that must name the key (AC-009-3).
 *
 * @param {import('ajv').ErrorObject} error
 * @returns {string}
 */
function describeAjvError(error) {
  if (error.params && error.params.additionalProperty) {
    return error.params.additionalProperty;
  }
  if (error.instancePath) {
    return error.instancePath.replace(/^\//, '');
  }
  return error.message || 'invalid config';
}

let defaultConfigCache = null;

/**
 * Load and cache the shipped default adapter map.
 * @returns {Record<string, string>}
 */
function loadDefaultToolchainConfig() {
  if (!defaultConfigCache) {
    const raw = fs.readFileSync(DEFAULT_TOOLCHAIN_PATH, 'utf8');
    defaultConfigCache = yaml.load(raw);
  }
  return defaultConfigCache;
}

/**
 * Parse and validate the text of a toolchain config.
 *
 * @param {string} raw the YAML text of a `toolchain.yaml`
 * @param {string} label what the text is, named in the error (a file path, or e.g. `<sha>:.ensemble/toolchain.yaml`)
 * @returns {object} the parsed config (`{}` for empty text)
 * @throws {Error} naming `label` and the offending key if the text fails schema validation
 */
function parseToolchainConfigText(raw, label) {
  const parsed = yaml.load(raw) || {};

  const validate = getValidator();
  if (!validate(parsed)) {
    const key = describeAjvError(validate.errors[0]);
    throw new Error(`${label}: invalid toolchain config (${key})`);
  }

  return parsed;
}

/**
 * Read and validate a project- or user-level toolchain config file.
 *
 * @param {string} filePath absolute path to a `toolchain.yaml` config file
 * @returns {object|null} the parsed config, or `null` if the file does not exist
 * @throws {Error} naming `filePath` and the offending key if the file fails schema validation
 */
function loadToolchainConfigFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  return parseToolchainConfigText(fs.readFileSync(filePath, 'utf8'), filePath);
}

/**
 * Resolve the adapter selected for one tool category, applying the fixed precedence:
 * project config > user config > env-compat (host/workflow only) > detection > shipped default.
 *
 * @param {string} category one of the 14 toolchain categories
 * @param {object} [ctx]
 * @param {string} [ctx.projectRoot] defaults to `process.cwd()`
 * @param {NodeJS.ProcessEnv} [ctx.env] defaults to `process.env`
 * @param {(category: string, ctx: object) => ({value: string, source?: string}|null|undefined)} [ctx.detect]
 *   optional detection hook (the TRD-016 injection point); contributes nothing when absent or
 *   when it returns a nullish value
 * @param {object|null} [ctx.projectConfig] an ALREADY READ and validated project-level config
 *   (`parseToolchainConfigText`), or `null` for "the project has none". When it is given (even as
 *   `null`) it REPLACES `<projectRoot>/.ensemble/toolchain.yaml`, which is then never read: a
 *   caller that must not let a working tree choose its own adapter (the PR-review bead recorder
 *   reads the config as committed at the PR's base) supplies the config itself. Absent (the
 *   default), the file under `projectRoot` is read exactly as before.
 * @returns {{value: string, source: 'project'|'user'|'env-compat'|'detection'|'default'|string}}
 * @throws {Error} if `category` is unknown to the shipped default config (and no earlier
 *   precedence step resolved it), or if a config file fails schema validation
 */
function resolveCategory(category, ctx = {}) {
  const { projectRoot = process.cwd(), env = process.env, detect } = ctx;

  const projectConfig =
    ctx.projectConfig !== undefined
      ? ctx.projectConfig
      : loadToolchainConfigFile(path.join(projectRoot, '.ensemble', 'toolchain.yaml'));
  if (projectConfig && projectConfig[category] != null) {
    return { value: projectConfig[category], source: 'project' };
  }

  const userConfig = loadToolchainConfigFile(getUserToolchainConfigPath(env));
  if (userConfig && userConfig[category] != null) {
    return { value: userConfig[category], source: 'user' };
  }

  const envVarName = ENV_COMPAT[category];
  if (envVarName && env[envVarName]) {
    return { value: env[envVarName], source: 'env-compat' };
  }

  if (typeof detect === 'function') {
    const detected = detect(category, ctx);
    if (detected && detected.value != null) {
      return { value: detected.value, source: detected.source || 'detection' };
    }
  }

  const defaults = loadDefaultToolchainConfig();
  if (defaults && defaults[category] != null) {
    return { value: defaults[category], source: 'default' };
  }

  throw new Error(`resolveCategory: unknown category '${category}' (not found in ${DEFAULT_TOOLCHAIN_PATH})`);
}

/**
 * The project-level per-class timeout bounds (`timeouts: {short, long}`, TRD-2026-6995dc96
 * TRD-028, PRD REQ-017) for the runner's `opts.timeouts`. Read from the same project config
 * `resolveCategory` reads (`ctx.projectConfig` when supplied, else `.ensemble/toolchain.yaml`).
 * Project config only: the user-level file does not set per-project bounds.
 *
 * @param {{projectRoot?: string, projectConfig?: object|null}} [ctx]
 * @returns {{short?: number, long?: number}|undefined} undefined when the project sets none
 * @throws {Error} if the project config fails schema validation, or `timeouts` has an unknown
 *   key or a value that is not a positive integer (also for a hand-built `ctx.projectConfig`)
 */
function resolveProjectTimeouts(ctx = {}) {
  const { projectRoot = process.cwd() } = ctx;
  const projectConfig =
    ctx.projectConfig !== undefined
      ? ctx.projectConfig
      : loadToolchainConfigFile(path.join(projectRoot, '.ensemble', 'toolchain.yaml'));
  const timeouts = projectConfig && projectConfig.timeouts;
  if (timeouts === undefined || timeouts === null) return undefined;
  // Validate here too: a hand-built `ctx.projectConfig` never passed through the file loader, and
  // `resolveCapabilityTimeout` silently ignores invalid values, which would hide a bad bound.
  const validate = getValidator();
  if (!validate({ timeouts })) {
    throw new Error(`invalid project timeouts (${describeAjvError(validate.errors[0])})`);
  }
  return timeouts;
}

/**
 * The project-level per-adapter overrides (`adapters: { <adapterId>: { statusMap, statusNames } }`)
 * for the runner's status-vocabulary extension. Read from the same project config
 * `resolveCategory` reads (`ctx.projectConfig` when supplied, else `.ensemble/toolchain.yaml`).
 * Project config only: a repository extends an adapter's own status vocabulary in its own
 * checkout, never in the user-level file.
 *
 * @param {string} adapterId the adapter id (e.g. `jira`)
 * @param {{projectRoot?: string, projectConfig?: object|null}} [ctx]
 * @returns {{statusMap: Record<string,string>, statusNames: Record<string,string>}} the
 *   overrides for `adapterId`; empty maps when the project sets none
 * @throws {Error} if the project config fails schema validation, or the `adapters` block has an
 *   unknown key or an invalid value (also for a hand-built `ctx.projectConfig`)
 */
function resolveAdapterOverrides(adapterId, ctx = {}) {
  const { projectRoot = process.cwd() } = ctx;
  const projectConfig =
    ctx.projectConfig !== undefined
      ? ctx.projectConfig
      : loadToolchainConfigFile(path.join(projectRoot, '.ensemble', 'toolchain.yaml'));
  const adapters = projectConfig && projectConfig.adapters;
  if (adapters === undefined || adapters === null) return { statusMap: {}, statusNames: {} };
  // Validate here too: a hand-built `ctx.projectConfig` never passed through the file loader, and
  // the runner silently ignores an invalid override, which would hide a misconfigured vocabulary.
  const validate = getValidator();
  if (!validate({ adapters })) {
    throw new Error(`invalid adapter overrides (${describeAjvError(validate.errors[0])})`);
  }
  const block = adapters[adapterId];
  if (!block) return { statusMap: {}, statusNames: {} };
  return {
    statusMap: block.statusMap || {},
    statusNames: block.statusNames || {}
  };
}

module.exports = {
  resolveCategory,
  resolveProjectTimeouts,
  resolveAdapterOverrides,
  loadToolchainConfigFile,
  parseToolchainConfigText,
  loadDefaultToolchainConfig,
  DEFAULT_TOOLCHAIN_PATH,
  TOOLCHAIN_CONFIG_SCHEMA_PATH
};
