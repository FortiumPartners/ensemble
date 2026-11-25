'use strict';

/**
 * TRD-005 (TRD-2026-d571763f): the engine's policy loader.
 *
 * Policy is the one place a repository may change what the engine decides, so its schema is
 * deliberately narrow: a value may be a number, a boolean, a string from a fixed enum, or a
 * table whose keys are short and whose values come from a fixed enum. Nothing else validates.
 *
 * That narrowness is the mechanism behind Constitution Rule 8, not a style choice. Review
 * criteria, tone and fix strategy are prose; prose cannot be expressed as a number, a boolean or
 * an enumerated token, so it cannot be smuggled into `.ensemble/engine.yaml` and quietly become
 * behaviour nobody reviewed. The 80-character ceiling makes that explicit: a value long enough
 * to be an instruction is refused by name.
 *
 * Every refusal is `INVALID_INPUT` and names the offending key, so an operator can fix the file
 * without reading this module. A malformed file is never tolerated by falling back to the
 * shipped defaults: that would make a typo look like a working configuration (Rule 7).
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const Ajv = require('ajv');

const { invalidInputError } = require('./validate');

const DEFAULTS = require('./policy/defaults.json');

/** Where a repository states its overrides, relative to the project root. */
const POLICY_FILE = '.ensemble/engine.yaml';

/** Hard cap on the policy file, in bytes. */
const MAX_POLICY_BYTES = 64 * 1024;

/** The longest string any policy value may be; anything longer is prose, not policy. */
const MAX_VALUE_LENGTH = 80;

/**
 * The implementation strategies the wave scheduler accepts
 * (`skills/ensemble-beads-build-wave/SKILL.md:56`).
 */
const STRATEGIES = Object.freeze([
  'tdd',
  'characterization',
  'bug-fix',
  'refactor',
  'test-after',
  'flexible',
]);

/** A table key: a short lowercase phrase, never a sentence. */
const TABLE_KEY_SCHEMA = Object.freeze({
  maxLength: 40,
  pattern: '^[a-z][a-z0-9 -]{0,39}$',
  type: 'string',
});

function strategyTable(description) {
  return {
    additionalProperties: { enum: [...STRATEGIES], type: 'string' },
    description,
    propertyNames: { ...TABLE_KEY_SCHEMA },
    type: 'object',
  };
}

/**
 * The whole of policy. Every property is enumerated here; `additionalProperties: false` is what
 * makes an unknown key a refusal rather than a silently ignored line.
 */
const POLICY_SCHEMA = Object.freeze({
  additionalProperties: false,
  properties: {
    constitution_methodology: strategyTable(
      'constitution methodology to implementation strategy'
    ),
    default_strategy: {
      description: 'the strategy used when nothing else determines one',
      enum: [...STRATEGIES],
      type: 'string',
    },
    design_readiness_pass: {
      description: 'design readiness score at or above which a TRD passes',
      maximum: 5,
      minimum: 0,
      type: 'number',
    },
    design_readiness_warn: {
      description: 'design readiness score at or above which a TRD warns instead of halting',
      maximum: 5,
      minimum: 0,
      type: 'number',
    },
    max_parallel_default: {
      description: 'default number of tasks dispatched in one wave',
      maximum: 64,
      minimum: 1,
      type: 'integer',
    },
    staleness_hours: {
      description: 'age in hours beyond which a TRD is treated as stale',
      maximum: 8760,
      minimum: 1,
      type: 'integer',
    },
    strategy_detection: strategyTable('keyword to implementation strategy, applied in order'),
  },
  required: [],
  type: 'object',
});

/** Every policy key, sorted. */
const POLICY_KEYS = Object.freeze(Object.keys(POLICY_SCHEMA.properties).sort());

const ajv = new Ajv({ allErrors: false, strict: false });
const validatePolicy = ajv.compile(POLICY_SCHEMA);

// A defect in the shipped defaults is a programming error in this package, not caller input, so
// it is a plain `Error`: it must not be reported to an operator as if their file were at fault.
if (!validatePolicy(DEFAULTS)) {
  throw new Error(
    `lib/engine/policy/defaults.json does not satisfy POLICY_SCHEMA: ${ajv.errorsText(
      validatePolicy.errors
    )}`
  );
}

/**
 * @param {string} projectRoot
 * @returns {string} the absolute path of the repository's policy file
 */
function policyFilePath(projectRoot) {
  return path.join(projectRoot, ...POLICY_FILE.split('/'));
}

/**
 * @param {string} file
 * @returns {string|null} the file's text, or null when it does not exist
 * @throws {Error} `POLICY_TOO_LARGE` when the file exceeds the cap
 */
function readPolicyFile(file) {
  let stat;
  try {
    stat = fs.statSync(file);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
  if (stat.size > MAX_POLICY_BYTES) {
    throw invalidInputError(
      'POLICY_TOO_LARGE',
      `${POLICY_FILE} is ${stat.size} bytes; the limit is ${MAX_POLICY_BYTES} bytes`
    );
  }
  return fs.readFileSync(file, 'utf8');
}

/**
 * Parse the policy document, refusing anything that is not a mapping of known keys.
 * @param {string} text
 * @returns {object} the overrides
 * @throws {Error} `INVALID_INPUT`, naming the key where one is at fault
 */
function parsePolicyText(text) {
  let document;
  try {
    document = yaml.load(text, { schema: yaml.JSON_SCHEMA });
  } catch (err) {
    throw invalidInputError('POLICY_YAML_INVALID', `${POLICY_FILE} is not valid YAML: ${err.message}`);
  }
  // An empty file is a present file with no overrides, not a malformed one.
  if (document === null || document === undefined) return {};
  if (typeof document !== 'object' || Array.isArray(document)) {
    throw invalidInputError(
      'POLICY_NOT_A_MAPPING',
      `${POLICY_FILE} must be a mapping of policy keys to values`
    );
  }

  const overrides = {};
  for (const key of Object.keys(document)) {
    if (!Object.prototype.hasOwnProperty.call(POLICY_SCHEMA.properties, key)) {
      throw invalidInputError(
        'POLICY_UNKNOWN_KEY',
        `policy key '${key}' is not a known policy key; known keys: ${POLICY_KEYS.join(', ')}`
      );
    }
    overrides[key] = document[key];
  }
  return overrides;
}

/**
 * Refuse a value that is long enough to be an instruction before the schema reports it as a
 * mere enum mismatch: the operator needs to be told the value is prose, not a typo.
 * @param {string} key
 * @param {*} value
 * @throws {Error} `POLICY_FREE_TEXT`
 */
function assertNotFreeText(key, value) {
  const strings = [];
  if (typeof value === 'string') strings.push(value);
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const inner of Object.keys(value)) {
      strings.push(inner);
      if (typeof value[inner] === 'string') strings.push(value[inner]);
    }
  }
  for (const text of strings) {
    if (text.length > MAX_VALUE_LENGTH) {
      throw invalidInputError(
        'POLICY_FREE_TEXT',
        `policy key '${key}' has a ${text.length}-character value; policy values are at most ` +
          `${MAX_VALUE_LENGTH} characters, so instructions cannot be stored as policy`
      );
    }
  }
}

/**
 * @param {object} values the merged values
 * @throws {Error} `INVALID_INPUT`, naming the key at fault
 */
function assertValid(values) {
  for (const key of Object.keys(values)) assertNotFreeText(key, values[key]);

  if (!validatePolicy(values)) {
    const error = (validatePolicy.errors || [])[0];
    const key =
      (error && error.params && error.params.additionalProperty) ||
      (error && error.instancePath ? error.instancePath.replace(/^\//, '').split('/')[0] : '') ||
      '(root)';
    throw invalidInputError(
      'POLICY_INVALID_VALUE',
      `policy key '${key}' ${error ? error.message : 'is not valid'}`
    );
  }

  if (values.design_readiness_warn > values.design_readiness_pass) {
    throw invalidInputError(
      'POLICY_BAND_ORDER',
      `policy key 'design_readiness_warn' (${values.design_readiness_warn}) must not exceed ` +
        `'design_readiness_pass' (${values.design_readiness_pass})`
    );
  }
}

/**
 * Merge the shipped defaults with the repository's overrides.
 * @param {object} overrides
 * @returns {{values: object, sources: object}}
 */
function effectivePolicy(overrides = {}) {
  const values = {};
  const sources = {};
  for (const key of POLICY_KEYS) {
    const overridden = Object.prototype.hasOwnProperty.call(overrides, key);
    values[key] = overridden ? overrides[key] : DEFAULTS[key];
    sources[key] = overridden ? 'repo' : 'default';
  }
  assertValid(values);
  return { sources, values };
}

/**
 * Resolve policy for one project root.
 * @param {{projectRoot: string}} options
 * @returns {{values: object, sources: object, file: {path: string, present: boolean}}}
 * @throws {Error} `INVALID_INPUT` when the repository file is unusable
 */
function loadPolicy({ projectRoot }) {
  const file = policyFilePath(projectRoot);
  const text = readPolicyFile(file);
  const overrides = text === null ? {} : parsePolicyText(text);
  const { sources, values } = effectivePolicy(overrides);
  return { file: { path: POLICY_FILE, present: text !== null }, sources, values };
}

/**
 * Report on the repository's policy file without ever throwing: `engine doctor` exists to
 * diagnose a broken file, so it must be able to describe one.
 * @param {string} projectRoot
 * @returns {{path: string, present: boolean, parsed: boolean, error: string|null}}
 */
function inspectPolicyFile(projectRoot) {
  const report = { error: null, parsed: false, path: POLICY_FILE, present: false };
  let text;
  try {
    text = readPolicyFile(policyFilePath(projectRoot));
  } catch (err) {
    report.present = true;
    report.error = err.message;
    return report;
  }
  if (text === null) return report;

  report.present = true;
  try {
    effectivePolicy(parsePolicyText(text));
    report.parsed = true;
  } catch (err) {
    report.error = err.message;
  }
  return report;
}

module.exports = {
  MAX_POLICY_BYTES,
  MAX_VALUE_LENGTH,
  POLICY_FILE,
  POLICY_KEYS,
  POLICY_SCHEMA,
  STRATEGIES,
  effectivePolicy,
  inspectPolicyFile,
  loadPolicy,
};
