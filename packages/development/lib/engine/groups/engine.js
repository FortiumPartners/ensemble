'use strict';

/**
 * TRD-005 (TRD-2026-d571763f): the `engine` group -- the engine describing itself.
 *
 * These four verbs are how a planning model (or a maintainer) learns what the engine can do and
 * what it currently decides, without reading prose and without running anything that has an
 * effect. All four are `read`.
 *
 * `doctor` deliberately reports a broken `.ensemble/engine.yaml` as data instead of refusing:
 * the verb exists to diagnose that file, so refusing would withhold the one answer it is for.
 * Every other verb still refuses the same file, so a broken policy cannot be worked around by
 * asking `doctor` first.
 */

const path = require('path');

const { POLICY_KEYS, inspectPolicyFile, loadPolicy } = require('../policy');
const { nearestVerbs } = require('../describe');
const { engineError } = require('../result');

const VERB_RE = '^[a-z][a-z0-9-]*\\.[a-z][a-z0-9-]*$';

const NO_INPUT_SCHEMA = Object.freeze({
  additionalProperties: false,
  properties: {},
  type: 'object',
});

/**
 * @param {object} call
 * @returns {{verbs: object[]}} every registered verb, from the registry the call was dispatched
 *   through -- so `verbs` cannot disagree with what the dispatcher would accept
 */
function listVerbs(call) {
  return {
    verbs: call.registry.verbs().map(spec => ({
      group: spec.group,
      name: spec.name,
      sideEffect: spec.sideEffect,
      summary: spec.summary,
    })),
  };
}

/**
 * @param {object} call
 * @returns {{group: string, name: string, inputSchema: object, outputSchema: object}}
 * @throws {Error} `INVALID_INPUT` `UNKNOWN_VERB`, offering the nearest verbs
 */
function verbSchema(call) {
  const [group, name] = call.input.verb.split('.');
  const spec = call.registry.get(group, name);
  if (!spec) {
    throw engineError(
      'INVALID_INPUT',
      'UNKNOWN_VERB',
      `unknown verb '${group} ${name}'`,
      { nearestVerbs: nearestVerbs(call.registry, group, name) }
    );
  }
  return {
    group: spec.group,
    inputSchema: spec.inputSchema,
    name: spec.name,
    outputSchema: spec.outputSchema,
  };
}

/**
 * @param {object} call
 * @returns {{file: object, policy: object}} every effective value with the source it came from
 */
function effectivePolicyReport(call) {
  const { file, sources, values } = loadPolicy({ projectRoot: call.projectRoot });
  const policy = {};
  for (const key of POLICY_KEYS) policy[key] = { source: sources[key], value: values[key] };
  return { file, policy };
}

/**
 * @param {object} call
 * @returns {{cliPath: string, engineYaml: object, nodeVersion: string, projectRoot: string}}
 */
function doctor(call) {
  return {
    cliPath: path.join(__dirname, '..', '..', 'ensemble-cli.js'),
    engineYaml: inspectPolicyFile(call.projectRoot),
    nodeVersion: process.version,
    projectRoot: call.projectRoot,
  };
}

const SPECS = [
  {
    exitCodes: [0, 2],
    group: 'engine',
    handler: listVerbs,
    inputSchema: NO_INPUT_SCHEMA,
    name: 'verbs',
    outputSchema: {
      additionalProperties: false,
      properties: {
        verbs: {
          items: {
            additionalProperties: false,
            properties: {
              group: { type: 'string' },
              name: { type: 'string' },
              sideEffect: { type: 'string' },
              summary: { type: 'string' },
            },
            required: ['group', 'name', 'sideEffect', 'summary'],
            type: 'object',
          },
          type: 'array',
        },
      },
      required: ['verbs'],
      type: 'object',
    },
    policyKeys: [],
    sideEffect: 'read',
    summary: 'list every registered verb with its side-effect class',
  },
  {
    exitCodes: [0, 2],
    group: 'engine',
    handler: verbSchema,
    inputSchema: {
      additionalProperties: false,
      properties: {
        verb: { pattern: VERB_RE, type: 'string', 'x-operand': true },
      },
      required: ['verb'],
      type: 'object',
    },
    name: 'schema',
    outputSchema: {
      additionalProperties: false,
      properties: {
        group: { type: 'string' },
        inputSchema: { type: 'object' },
        name: { type: 'string' },
        outputSchema: { type: 'object' },
      },
      required: ['group', 'inputSchema', 'name', 'outputSchema'],
      type: 'object',
    },
    policyKeys: [],
    sideEffect: 'read',
    summary: "print one verb's input and output schema",
  },
  {
    exitCodes: [0, 2],
    group: 'engine',
    handler: effectivePolicyReport,
    inputSchema: NO_INPUT_SCHEMA,
    name: 'policy',
    outputSchema: {
      additionalProperties: false,
      properties: {
        file: {
          additionalProperties: false,
          properties: { path: { type: 'string' }, present: { type: 'boolean' } },
          required: ['path', 'present'],
          type: 'object',
        },
        policy: {
          additionalProperties: {
            additionalProperties: false,
            properties: { source: { enum: ['default', 'repo'] }, value: {} },
            required: ['source', 'value'],
            type: 'object',
          },
          type: 'object',
        },
      },
      required: ['file', 'policy'],
      type: 'object',
    },
    policyKeys: [...POLICY_KEYS],
    sideEffect: 'read',
    summary: 'print every effective policy value with its source',
  },
  {
    exitCodes: [0, 2],
    group: 'engine',
    handler: doctor,
    inputSchema: NO_INPUT_SCHEMA,
    name: 'doctor',
    outputSchema: {
      additionalProperties: false,
      properties: {
        cliPath: { type: 'string' },
        engineYaml: {
          additionalProperties: false,
          properties: {
            error: { type: ['string', 'null'] },
            parsed: { type: 'boolean' },
            path: { type: 'string' },
            present: { type: 'boolean' },
          },
          required: ['error', 'parsed', 'path', 'present'],
          type: 'object',
        },
        nodeVersion: { type: 'string' },
        projectRoot: { type: 'string' },
      },
      required: ['cliPath', 'engineYaml', 'nodeVersion', 'projectRoot'],
      type: 'object',
    },
    policyKeys: [],
    sideEffect: 'read',
    summary: 'report the resolved CLI path, Node version, project root and policy file state',
  },
];

/**
 * @param {{register: Function}} registry
 * @returns {object[]} the registered specs
 */
function register(registry) {
  return SPECS.map(spec => registry.register(spec));
}

module.exports = { group: 'engine', register };
