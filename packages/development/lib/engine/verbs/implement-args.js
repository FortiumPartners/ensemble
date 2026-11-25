'use strict';

/**
 * TRD-006 (TRD-2026-d571763f): `ensemble implement args` -- every decision Step 1.1 of
 * implement-trd-tasks makes about its own arguments, as data.
 *
 * The verb reads arguments and the repository's policy file and answers; it starts nothing,
 * writes nothing and performs no early exit itself. `--list`, `--status` and `--reset-task` come
 * back as an `EARLY_EXIT` action for the caller to carry out, because the engine must not decide
 * to talk to the tracker on the strength of a flag it merely parsed.
 *
 * The refusals are the skill's own texts, in the skill's order
 * (`skills/ensemble-implement-trd-tasks/references/phase-1-preflight.md:7-16`). They run before
 * the early exits: the skill would early-exit `--status` first, which hides the fact that both
 * branch flags were given, and a hidden contradiction is exactly what a preflight exists to
 * surface.
 */

const path = require('path');

const MESSAGES = require('../messages');
const { STRATEGIES, loadPolicy } = require('../policy');
const { readFrontmatter, toProjectRelative } = require('../trd-source');
const { refused } = require('../result');
const { resolveInteractivity } = require('../interactivity');
const { getFrontmatterField } = require('../../trd-parser');
const { resolveCallerPath } = require('../validate');

/**
 * The flags `--generate-only` may not be combined with (preflight :8). Split by kind, because a
 * boolean given as `false` over `--stdin` is the caller saying "not that mode": counting its mere
 * presence as a conflict would refuse a run the skill accepts.
 */
const GENERATE_ONLY_CONFLICTS = Object.freeze({
  booleans: ['plan', 'execute', 'status', 'list', 'use-current-branch'],
  values: ['reset-task', 'branch'],
});

const MD_RE = /\.md$/i;
const STRATEGY_OPERAND_RE = /^strategy=(.*)$/;
const POSITIVE_INTEGER_RE = /^[1-9][0-9]*$/;

/**
 * A positive whole number this runtime holds exactly, or null. `9007199254740993` passes a digit
 * check, but `Number` rounds it, so the count that would run is not the count that was asked for.
 * @param {*} value
 * @returns {number|null}
 */
function positiveWholeNumber(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value).trim();
  if (!POSITIVE_INTEGER_RE.test(text)) return null;
  const parsed = Number(text);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function flag(input, key) {
  return input[key] === true;
}

/**
 * Split the non-flag arguments into the four things the skill recognises: TRD paths, a strategy,
 * the `max parallel N` text form (the manifest's own spelling,
 * `commands/implement-trd-tasks.yaml:31`) and leftover words that make up a TRD search query.
 *
 * @param {string[]} operands
 * @param {string} projectRoot
 * @returns {{trdPaths: string[], strategy: string|null, maxParallel: number|null, query: string[], refusal: object|null}}
 */
function classifyOperands(operands, projectRoot) {
  const result = { maxParallel: null, query: [], refusal: null, strategy: null, trdPaths: [] };

  for (let index = 0; index < operands.length; index += 1) {
    const token = operands[index];

    if (MD_RE.test(token)) {
      // Contained here rather than through `x-path`, because the operand list also carries words
      // that are not paths at all and must not be resolved as if they were.
      const relative = toProjectRelative(projectRoot, resolveCallerPath(projectRoot, token));
      // The same file named twice is one TRD, not two.
      if (!result.trdPaths.includes(relative)) result.trdPaths.push(relative);
      continue;
    }

    const strategyMatch = STRATEGY_OPERAND_RE.exec(token);
    if (strategyMatch) {
      const value = strategyMatch[1];
      if (!STRATEGIES.includes(value)) {
        result.refusal = refused(
          'INVALID_STRATEGY',
          `ERROR: unknown strategy '${value}'; expected one of ${STRATEGIES.join(', ')}.`
        );
        return result;
      }
      result.strategy = value;
      continue;
    }

    if (token === 'max' && operands[index + 1] === 'parallel') {
      const count = operands[index + 2];
      const text = count === undefined ? '' : String(count).trim();
      const whole = POSITIVE_INTEGER_RE.test(text) ? Number(text) : null;
      if (whole === null) {
        result.refusal = refused(
          'INVALID_MAX_PARALLEL',
          `ERROR: 'max parallel' expects a positive whole number, got '${count === undefined ? '' : count}'.`
        );
        return result;
      }
      if (!Number.isSafeInteger(whole)) {
        result.refusal = refused(
          'INVALID_MAX_PARALLEL',
          `ERROR: 'max parallel' expects a positive whole number up to ${Number.MAX_SAFE_INTEGER}, got '${count}'.`
        );
        return result;
      }
      result.maxParallel = whole;
      index += 2;
      continue;
    }

    result.query.push(token);
  }

  return result;
}

/**
 * The skill's precedence for MAX_PARALLEL (preflight :17): the flag or its text form, then the
 * single TRD's frontmatter, then policy. A frontmatter value that is not a positive whole number
 * is reported as a warning and skipped -- silently treating it as the default would let a typo in
 * a TRD change how much work runs at once with nothing said about it.
 *
 * @param {{flagValue: number|undefined, textValue: number|null, trdPaths: string[], projectRoot: string, policyDefault: number, warnings: string[]}} input
 * @returns {{value: number, source: string}}
 */
function resolveMaxParallel({ flagValue, policyDefault, projectRoot, textValue, trdPaths, warnings }) {
  if (flagValue !== undefined) return { source: 'flag', value: flagValue };
  if (textValue !== null) return { source: 'text', value: textValue };

  if (trdPaths.length === 1) {
    const { frontmatter, present } = readFrontmatter(path.resolve(projectRoot, trdPaths[0]));
    if (present && frontmatter) {
      const raw = getFrontmatterField(frontmatter, 'max_parallel');
      if (raw !== undefined) {
        const parsed = positiveWholeNumber(raw);
        if (parsed !== null) {
          return { source: 'frontmatter', value: parsed };
        }
        warnings.push(
          `TRD frontmatter 'max_parallel' is not a positive whole number ('${raw}'); using the policy default`
        );
      }
    }
  }

  return { source: 'policy', value: policyDefault };
}

/**
 * The early exit the caller should perform, in the skill's order (preflight :12-14). The verb
 * never performs it.
 * @param {object} input
 * @returns {object|null}
 */
function earlyExit(input) {
  if (flag(input, 'list')) return { action: 'list' };
  if (flag(input, 'status')) return { action: 'status' };
  if (input['reset-task'] !== undefined) {
    return { action: 'reset-task', taskId: input['reset-task'] };
  }
  return null;
}

/**
 * @param {object} call
 * @returns {object} the decisions, or a refusal
 */
function handler(call) {
  const input = call.input;
  const projectRoot = call.projectRoot;
  const warnings = [];

  const classified = classifyOperands(input.operands || [], projectRoot);
  if (classified.refusal) return classified.refusal;

  const generateOnly = flag(input, 'generate-only');
  const branchRequested = input.branch === undefined ? null : input.branch;
  const useCurrentBranch = flag(input, 'use-current-branch');

  if (flag(input, 'plan') && flag(input, 'execute')) {
    return refused('PLAN_EXECUTE_EXCLUSIVE', MESSAGES.PLAN_EXECUTE_EXCLUSIVE);
  }
  const conflicts =
    GENERATE_ONLY_CONFLICTS.booleans.some(key => flag(input, key)) ||
    GENERATE_ONLY_CONFLICTS.values.some(key => input[key] !== undefined);
  if (generateOnly && conflicts) {
    return refused('GENERATE_ONLY_CONFLICT', MESSAGES.GENERATE_ONLY_CONFLICT);
  }
  if (classified.trdPaths.length >= 2 && !flag(input, 'workstream') && !flag(input, 'legacy-multi')) {
    return refused('MULTIPLE_TRDS', MESSAGES.MULTIPLE_TRDS);
  }
  if (
    generateOnly &&
    (flag(input, 'legacy-multi') || !flag(input, 'workstream') || classified.trdPaths.length < 2)
  ) {
    return refused('GENERATE_ONLY_REQUIRES_WORKSTREAM', MESSAGES.GENERATE_ONLY_REQUIRES_WORKSTREAM);
  }
  if (branchRequested !== null && useCurrentBranch) {
    return refused('BRANCH_FLAGS_EXCLUSIVE', MESSAGES.BRANCH_FLAGS_EXCLUSIVE);
  }

  const { foreman, interactive, nonInteractive } = resolveInteractivity({
    env: call.env,
    foremanFlag: flag(input, 'foreman'),
    globals: call.globals,
  });

  const policy = loadPolicy({ projectRoot }).values;
  const maxParallel = resolveMaxParallel({
    flagValue: input['max-parallel'],
    policyDefault: policy.max_parallel_default,
    projectRoot,
    textValue: classified.maxParallel,
    trdPaths: classified.trdPaths,
    warnings,
  });

  return {
    ALLOW_INVALID: flag(input, 'allow-invalid'),
    BRANCH_REQUESTED: branchRequested,
    EARLY_EXIT: earlyExit(input),
    EXECUTE_ONLY: flag(input, 'execute'),
    FOREMAN: foreman,
    GENERATE_ONLY: generateOnly,
    INTERACTIVE: interactive,
    LEGACY_MULTI: flag(input, 'legacy-multi'),
    MAX_PARALLEL: maxParallel.value,
    MAX_PARALLEL_SOURCE: maxParallel.source,
    NON_INTERACTIVE: nonInteractive,
    OUT_PATH: input.out === undefined ? null : toProjectRelative(projectRoot, input.out),
    PLAN_ONLY: flag(input, 'plan'),
    STRATEGY_ARGUMENT: input.strategy === undefined ? classified.strategy : input.strategy,
    TRD_PATHS: classified.trdPaths,
    TRD_QUERY: classified.query.length === 0 ? null : classified.query.join(' '),
    USE_CURRENT_BRANCH_REQUESTED: useCurrentBranch,
    WARNINGS: warnings,
    WORKSTREAM: flag(input, 'workstream'),
  };
}

const BOOLEAN_FLAGS = [
  'allow-invalid',
  'execute',
  'foreman',
  'generate-only',
  'legacy-multi',
  'list',
  'plan',
  'status',
  'use-current-branch',
  'workstream',
];

function booleanProperties() {
  const properties = {};
  for (const key of BOOLEAN_FLAGS) properties[key] = { type: 'boolean' };
  return properties;
}

const spec = {
  exitCodes: [0, 1, 2],
  group: 'implement',
  handler,
  inputSchema: {
    additionalProperties: false,
    properties: {
      ...booleanProperties(),
      branch: { pattern: '^[A-Za-z0-9._/][A-Za-z0-9._/-]{0,199}$', type: 'string' },
      'max-parallel': { maximum: Number.MAX_SAFE_INTEGER, minimum: 1, type: 'integer' },
      operands: { items: { type: 'string' }, type: 'array', 'x-operand': true },
      out: { type: 'string', 'x-path': true },
      'reset-task': { pattern: '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$', type: 'string' },
      strategy: { enum: [...STRATEGIES], type: 'string' },
    },
    type: 'object',
  },
  name: 'args',
  outputSchema: {
    additionalProperties: false,
    properties: {
      ALLOW_INVALID: { type: 'boolean' },
      BRANCH_REQUESTED: { type: ['string', 'null'] },
      EARLY_EXIT: {
        oneOf: [
          { type: 'null' },
          {
            additionalProperties: false,
            properties: {
              action: { enum: ['list', 'status', 'reset-task'] },
              taskId: { type: 'string' },
            },
            required: ['action'],
            type: 'object',
          },
        ],
      },
      EXECUTE_ONLY: { type: 'boolean' },
      FOREMAN: { type: 'boolean' },
      GENERATE_ONLY: { type: 'boolean' },
      INTERACTIVE: { type: 'boolean' },
      LEGACY_MULTI: { type: 'boolean' },
      MAX_PARALLEL: { type: 'integer' },
      MAX_PARALLEL_SOURCE: { enum: ['flag', 'text', 'frontmatter', 'policy'] },
      NON_INTERACTIVE: { type: 'boolean' },
      OUT_PATH: { type: ['string', 'null'] },
      PLAN_ONLY: { type: 'boolean' },
      STRATEGY_ARGUMENT: { type: ['string', 'null'] },
      TRD_PATHS: { items: { type: 'string' }, type: 'array' },
      TRD_QUERY: { type: ['string', 'null'] },
      USE_CURRENT_BRANCH_REQUESTED: { type: 'boolean' },
      WARNINGS: { items: { type: 'string' }, type: 'array' },
      WORKSTREAM: { type: 'boolean' },
    },
    required: [
      'ALLOW_INVALID',
      'BRANCH_REQUESTED',
      'EARLY_EXIT',
      'EXECUTE_ONLY',
      'FOREMAN',
      'GENERATE_ONLY',
      'INTERACTIVE',
      'LEGACY_MULTI',
      'MAX_PARALLEL',
      'MAX_PARALLEL_SOURCE',
      'NON_INTERACTIVE',
      'OUT_PATH',
      'PLAN_ONLY',
      'STRATEGY_ARGUMENT',
      'TRD_PATHS',
      'TRD_QUERY',
      'USE_CURRENT_BRANCH_REQUESTED',
      'WARNINGS',
      'WORKSTREAM',
    ],
    type: 'object',
  },
  policyKeys: ['max_parallel_default'],
  sideEffect: 'read',
  summary: "report the mode, TRD paths and early exits an implement-trd-tasks run's arguments ask for",
};

module.exports = { spec };
