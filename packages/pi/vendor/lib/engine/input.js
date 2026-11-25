'use strict';

/**
 * TRD-005 (TRD-2026-d571763f): turning argv (or a stdin body) into a native verb's input.
 *
 * A native verb declares one JSON schema and gets exactly one input object, however the caller
 * spelled it. Flags, operands and `--stdin` are three spellings of the same declaration, so all
 * three meet the same schema and the same path containment -- this is the boundary that makes
 * `validate.js` reachable from the entry point (Constitution Rule 6).
 *
 * Conventions the schema encodes:
 * - a property `foo-bar` is the flag `--foo-bar`; its type decides whether a value follows;
 * - `"x-operand": true` marks the one property that collects non-flag arguments;
 * - `"x-path": true` marks a string (or array of strings) that must stay inside the project.
 *
 * `--stdin` is reserved: it makes the whole input object arrive as one JSON document, and it is
 * refused together with any flag or operand so there is never a question which one won.
 */

const path = require('path');

const {
  invalidInputError,
  parseInput,
  resolveCallerPath,
  validateInput,
} = require('./validate');

/** Flags the dispatcher owns; a verb may not redeclare them. */
const RESERVED = Object.freeze([
  'describe',
  'help',
  'json',
  'non-interactive',
  'project-root',
  'run-id',
  'stdin',
]);

/** The property types a native verb may declare. */
const SCALAR_TYPES = Object.freeze(['boolean', 'integer', 'number', 'string']);

const PROPERTY_NAME_RE = /^[a-z][a-z0-9-]*$/;

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Refuse a native verb whose schema cannot be driven from argv, at registration time rather
 * than when a caller first trips over it.
 * @param {string} label `<group> <name>`
 * @param {object} schema
 * @throws {Error} naming the verb and the property at fault
 */
function assertNativeInputSchema(label, schema) {
  if (!isPlainObject(schema) || schema.type !== 'object') {
    throw new Error(`verb '${label}' inputSchema must be an object schema`);
  }
  if (schema.additionalProperties !== false) {
    throw new Error(`verb '${label}' inputSchema must set additionalProperties: false`);
  }
  const properties = schema.properties || {};
  let operands = 0;
  for (const key of Object.keys(properties)) {
    if (!PROPERTY_NAME_RE.test(key)) {
      throw new Error(`verb '${label}' input property '${key}' is not a lowercase flag name`);
    }
    if (RESERVED.includes(key)) {
      throw new Error(`verb '${label}' input property '${key}' is a reserved global flag`);
    }
    const property = properties[key];
    if (!isPlainObject(property)) {
      throw new Error(`verb '${label}' input property '${key}' has no schema`);
    }
    if (property['x-operand'] === true) operands += 1;
    if (property.type === 'array') {
      const items = property.items || {};
      if (items.type !== 'string') {
        throw new Error(`verb '${label}' input property '${key}' must be an array of strings`);
      }
    } else if (!SCALAR_TYPES.includes(property.type)) {
      throw new Error(
        `verb '${label}' input property '${key}' has unsupported type '${property.type}'`
      );
    }
  }
  if (operands > 1) {
    throw new Error(`verb '${label}' declares ${operands} operand properties; at most one is allowed`);
  }
}

/**
 * Build the flag table the argv parser consults for this verb.
 * @param {object} schema
 * @returns {object} flag name (without `--`) to `{key, type, repeatable}`
 */
function flagTable(schema) {
  const table = { stdin: { key: '$stdin', repeatable: false, type: 'boolean' } };
  const properties = (schema && schema.properties) || {};
  for (const key of Object.keys(properties)) {
    const property = properties[key];
    if (property['x-operand'] === true) continue;
    table[key] = {
      key,
      repeatable: property.type === 'array',
      type: property.type === 'array' ? 'string' : property.type,
    };
  }
  return table;
}

/**
 * Resolve the project root the verb works in.
 * @param {string} cwd
 * @param {string|null} flagValue the `--project-root` value, when given
 * @returns {string} an absolute, existing directory
 * @throws {Error} `INVALID_PROJECT_ROOT`
 */
function resolveProjectRoot(cwd, flagValue) {
  const candidate = path.resolve(cwd, flagValue || '.');
  // Required lazily: `--describe` must not pay for the filesystem.
  const fs = require('fs');
  let stat;
  try {
    stat = fs.statSync(candidate);
  } catch (err) {
    throw invalidInputError(
      'INVALID_PROJECT_ROOT',
      `project root '${candidate}' does not exist: ${err.code || err.message}`
    );
  }
  if (!stat.isDirectory()) {
    throw invalidInputError('INVALID_PROJECT_ROOT', `project root '${candidate}' is not a directory`);
  }
  return fs.realpathSync(candidate);
}

function coerce(key, property, raw) {
  if (property.type === 'integer' || property.type === 'number') {
    const value = Number(raw);
    if (!Number.isFinite(value)) {
      throw invalidInputError('SCHEMA_VIOLATION', `input field '${key}' is not a number: '${raw}'`);
    }
    return value;
  }
  return raw;
}

function operandProperty(schema) {
  const properties = (schema && schema.properties) || {};
  for (const key of Object.keys(properties)) {
    if (properties[key]['x-operand'] === true) return key;
  }
  return null;
}

function pathProperties(schema) {
  const properties = (schema && schema.properties) || {};
  return Object.keys(properties).filter(key => properties[key]['x-path'] === true);
}

/**
 * Build the input object for one call, from flags and operands or from a stdin body.
 * @param {object} spec the registry spec
 * @param {object} parsed the `parseArgv` result
 * @param {{projectRoot: string, stdin?: string|null}} context
 * @returns {object} the validated input
 * @throws {Error} `INVALID_INPUT`, naming the offending field
 */
function resolveInput(spec, parsed, { projectRoot, stdin }) {
  const schema = spec.inputSchema;
  const properties = schema.properties || {};
  const flags = parsed.verbFlags || {};
  const operands = parsed.operands || [];
  const useStdin = flags.$stdin === true;

  let input;
  if (useStdin) {
    const others = Object.keys(flags).filter(key => key !== '$stdin');
    if (others.length > 0 || operands.length > 0) {
      throw invalidInputError(
        'STDIN_WITH_FLAGS',
        '--stdin carries the whole input object, so it cannot be combined with flags or operands'
      );
    }
    if (typeof stdin !== 'string') {
      throw invalidInputError(
        'STDIN_NOT_READ',
        '--stdin was given but no input body was read from stdin'
      );
    }
    input = parseInput(stdin, schema);
  } else {
    input = {};
    for (const key of Object.keys(flags)) {
      if (key === '$stdin') continue;
      const property = properties[key];
      const raw = flags[key];
      if (property.type === 'array') {
        input[key] = (Array.isArray(raw) ? raw : [raw]).map(String);
      } else if (property.type === 'boolean') {
        input[key] = raw === true;
      } else {
        input[key] = coerce(key, property, raw);
      }
    }

    const operandKey = operandProperty(schema);
    if (operands.length > 0) {
      if (!operandKey) {
        throw invalidInputError(
          'UNEXPECTED_OPERAND',
          `verb '${spec.group} ${spec.name}' takes no arguments, got '${operands[0]}'`
        );
      }
      const property = properties[operandKey];
      if (property.type === 'array') {
        input[operandKey] = operands.map(String);
      } else if (operands.length > 1) {
        throw invalidInputError(
          'UNEXPECTED_OPERAND',
          `verb '${spec.group} ${spec.name}' takes one argument, got '${operands[1]}' as well`
        );
      } else {
        input[operandKey] = coerce(operandKey, property, operands[0]);
      }
    }

    validateInput(input, schema);
  }

  for (const key of pathProperties(schema)) {
    if (!Object.prototype.hasOwnProperty.call(input, key)) continue;
    const value = input[key];
    const resolveOne = candidate => {
      try {
        return resolveCallerPath(projectRoot, candidate);
      } catch (err) {
        throw invalidInputError(err.code || 'PATH_ESCAPE', `input field '${key}': ${err.message}`);
      }
    };
    input[key] = Array.isArray(value) ? value.map(resolveOne) : resolveOne(value);
  }

  return input;
}

module.exports = {
  RESERVED,
  assertNativeInputSchema,
  flagTable,
  resolveInput,
  resolveProjectRoot,
};
