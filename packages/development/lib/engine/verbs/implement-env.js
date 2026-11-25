'use strict';

/**
 * TRD-007 (TRD-2026-d571763f): `ensemble implement env` -- every decision Step 1.2 and Step 1.3 of
 * implement-trd-tasks make about the environment the run will happen in: whether git-town can be
 * used, which branching strategy follows from that, which backend will open the pull request, and
 * whether the working tree is clean enough to start.
 *
 * The decisions themselves are not re-derived here: `lib/pr-strategy.js` already holds them as
 * pure functions and stays the single source of that truth. This verb runs the tools those
 * functions need answers from (`validate-git-town.sh`, `workflow.remote-url`, `workflow.status`)
 * and reports what they said.
 *
 * The verb is read-only except for `--preflight`, which runs the toolchain preflight the skill
 * runs at Step 1.2 and therefore writes that run's preflight record. Nothing about the branching
 * strategy or the PR backend is ever persisted: both are re-resolved on every invocation
 * (`skills/implement-trd-tasks-reference/SKILL.md:15`), so a stale choice cannot outlive the
 * environment that justified it.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const MESSAGES = require('../messages');
const { runToolchain, toolchainFailure } = require('../cli-json');
const { isResult, needsChoice, refused, unavailable } = require('../result');
const { resolveInteractivity } = require('../interactivity');
const { readWorktree } = require('../worktree');
const {
  buildConsolidatedResolutionMessage,
  resolveBranchingStrategy,
  resolvePrBackend,
} = require('../../pr-strategy');

/**
 * Where `validate-git-town.sh` sits in each layout this file can be installed in: the monorepo
 * checkout, the Claude plugin bundle, and the Pi vendor tree. Held as segment arrays rather than
 * as literal `path.join(__dirname, '...')` calls on purpose: `scripts/validate-all.js`'s
 * `validateBundleDataPaths` checks that every literal `__dirname`-relative data path exists in
 * the bundle, and only one of these three candidates ever does.
 */
const GIT_TOWN_SCRIPT_CANDIDATES = Object.freeze([
  Object.freeze(['..', '..', '..', '..', 'git', 'skills', 'git-town', 'scripts', 'validate-git-town.sh']),
  Object.freeze(['..', '..', '..', 'skills', 'git', 'git-town', 'scripts', 'validate-git-town.sh']),
  Object.freeze(['..', '..', '..', 'scripts', 'validate-git-town.sh']),
]);

/** The capabilities `commands/implement-trd-tasks.yaml:10-21` declares as required. */
const REQUIRED_CAPABILITIES = Object.freeze([
  'tracker.list',
  'tracker.create',
  'tracker.comment',
  'tracker.close',
  'test-runner.run',
  'package-runner.run-script',
  'workflow.commit',
  'workflow.merge-base',
]);

/**
 * What a plan-only run actually uses: only phases 1 and 2 run, and phase 2 creates beads
 * (`references/phase-2-scaffold.md:10`, Step 2.1). Requiring the execute-only capabilities here
 * would refuse a `--plan` run in a repository that cannot run tests yet.
 */
const PLAN_CAPABILITIES = Object.freeze(['tracker.list', 'tracker.create']);

/** The capabilities `commands/implement-trd-tasks.yaml:22-31` declares as optional. */
const OPTIONAL_CAPABILITIES = Object.freeze([
  'work-graph.plan',
  'work-graph.ready',
  'tracker.create-detailed',
  'tracker.find-by-key',
  'work-graph.graph-health',
  'tracker.stage-export',
  'tracker.comments',
  'tracker.dep-add',
  'tracker.sync',
  'tracker.close-with-reason',
]);

/**
 * The subagent the execute phase dispatches waves through. A file on disk does not prove the Task
 * tool accepts it, so the engine reports the requirement and the caller checks its own registry
 * (`references/phase-1-preflight.md:26`).
 */
const BUILD_WAVE_AGENT = 'beads-build-wave';

/** The PR backends, in the order the skill offers them (reference SKILL.md:15). */
const PR_BACKEND_OPTIONS = Object.freeze([
  Object.freeze({ label: 'azure-devops MCP, manual steps if not connected', value: 'ado' }),
  Object.freeze({ label: 'always print manual steps', value: 'manual' }),
  Object.freeze({ label: 'proceed with gh anyway (not recommended)', value: 'gh' }),
]);

/** The first layout whose `validate-git-town.sh` exists, or `null`. */
function findGitTownScript() {
  for (const segments of GIT_TOWN_SCRIPT_CANDIDATES) {
    const candidate = path.resolve(__dirname, ...segments);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Run `validate-git-town.sh` and report its exit code.
 * @param {object} call
 * @returns {{exitCode: number, output: string}|object} a tagged engine result when the script
 *   could not be run or answered outside its documented range
 */
function runGitTownValidation(call) {
  const script = findGitTownScript();
  if (script === null) {
    return unavailable(
      'GIT_TOWN_VALIDATION_FAILED',
      'validate-git-town.sh could not be located, so git-town cannot be ruled in or out'
    );
  }
  const result = spawnSync('bash', [script], {
    cwd: call.projectRoot,
    encoding: 'utf8',
    env: call.env,
  });
  if (result.error || result.status === null) {
    return unavailable(
      'GIT_TOWN_VALIDATION_FAILED',
      `validate-git-town.sh could not be run: ${result.error ? result.error.message : 'it was killed by a signal'}`
    );
  }
  if (result.status < 0 || result.status > 4) {
    return unavailable(
      'GIT_TOWN_VALIDATION_FAILED',
      `validate-git-town.sh exited ${result.status}, which is not one of its documented codes 0-4`
    );
  }
  return { exitCode: result.status, output: `${result.stdout || ''}${result.stderr || ''}` };
}

/**
 * Run the toolchain preflight for this mode.
 * @param {object} call
 * @param {boolean} planOnly
 * @returns {object} the `PREFLIGHT` payload, or a tagged engine result
 */
function runModePreflight(call, planOnly) {
  const capabilities = planOnly ? PLAN_CAPABILITIES : REQUIRED_CAPABILITIES;
  const argv = ['preflight'];
  for (const capability of capabilities) argv.push('--require', capability);
  const result = runToolchain(call, argv);
  if (!result.json) {
    return unavailable(
      'PREFLIGHT_UNREADABLE',
      `toolchain preflight produced no JSON result (exit ${result.exitCode})${
        result.stderr ? `: ${result.stderr.trim()}` : ''
      }`
    );
  }
  if (result.json.ok !== true) return toolchainFailure(result.json.error);
  return {
    AGENT_REGISTRATION_REQUIRED: planOnly ? [] : [BUILD_WAVE_AGENT],
    CAPABILITIES: [...capabilities],
    MODE: planOnly ? 'plan' : 'execute',
    OPTIONAL_CAPABILITIES: [...OPTIONAL_CAPABILITIES],
    RUN_ID: result.json.runId,
  };
}

/** `origin`'s URL, or `none` when the repository has no reachable remote. */
function readRemoteUrl(call) {
  const result = runToolchain(call, ['run', 'workflow.remote-url', '--arg', 'remote=origin']);
  if (!result.json || result.json.ok !== true) return 'none';
  const url = result.json.data && result.json.data.url;
  return typeof url === 'string' && url.trim().length > 0 ? url.trim() : 'none';
}

/**
 * @param {object} call the dispatcher's call object
 * @returns {object} the environment decisions, or a tagged engine result
 */
function handler(call) {
  const input = call.input;
  const planOnly = input.plan === true;
  if (planOnly && input.execute === true) {
    return refused('PLAN_EXECUTE_EXCLUSIVE', MESSAGES.PLAN_EXECUTE_EXCLUSIVE);
  }

  // Tools first, exactly as Step 1.2 runs before Step 1.3: a repository whose tracker is not even
  // healthy must hear that, not a branching-strategy answer it cannot use.
  let preflight = null;
  if (input.preflight === true) {
    preflight = runModePreflight(call, planOnly);
    if (isResult(preflight)) return preflight;
  }

  const validation = runGitTownValidation(call);
  if (isResult(validation)) return validation;
  if (validation.exitCode === 3 || validation.exitCode === 4) {
    return refused('GIT_TOWN_UNUSABLE', MESSAGES.gitTownUnusable(validation.exitCode), {
      exitCode: validation.exitCode,
      output: validation.output,
    });
  }

  const branching = resolveBranchingStrategy(call.env, validation.exitCode);
  if (branching.action === 'halt') {
    return refused('BRANCHING_STRATEGY_HALT', branching.message);
  }
  const warnings = branching.action === 'warn' && branching.message ? [branching.message] : [];

  const { interactive } = resolveInteractivity({ env: call.env, globals: call.globals });
  const remoteUrl = readRemoteUrl(call);
  const flagBackend = input['pr-backend'];
  const backend = resolvePrBackend(
    {
      ...call.env,
      ENSEMBLE_PR_BACKEND: flagBackend === undefined ? call.env.ENSEMBLE_PR_BACKEND : flagBackend,
    },
    remoteUrl
  );
  if (backend.needsResolution) {
    if (!interactive) return refused('PR_BACKEND_UNRESOLVED', MESSAGES.PR_BACKEND_UNRESOLVED);
    return needsChoice({
      flag: '--pr-backend',
      id: 'pr_backend',
      options: PR_BACKEND_OPTIONS.map(option => ({
        args: ['--pr-backend', option.value],
        label: option.label,
        value: option.value,
      })),
      question: 'Which backend should open the pull requests for this run?',
    });
  }

  const worktree = readWorktree(call);
  if (isResult(worktree)) return worktree;

  const data = {
    BRANCHING_STRATEGY: branching.strategy,
    BRANCHING_STRATEGY_SOURCE: branching.source,
    CONSOLIDATED_MESSAGE: buildConsolidatedResolutionMessage(branching, backend),
    GIT_TOWN_EXIT_CODE: validation.exitCode,
    INTERACTIVE: interactive,
    PR_BACKEND: backend.backend,
    PR_BACKEND_SOURCE: flagBackend === undefined ? backend.source : 'flag',
    REMOTE_URL: remoteUrl,
    WARNINGS: warnings,
    WORKTREE_DIRTY: worktree.dirty,
    WORKTREE_STATUS: worktree.files,
  };
  if (preflight !== null) data.PREFLIGHT = preflight;
  return data;
}

const spec = {
  // `--preflight` writes this run's toolchain preflight record; every other path only reads.
  exitCodes: [0, 1, 2, 4, 5],
  group: 'implement',
  handler,
  inputSchema: {
    additionalProperties: false,
    properties: {
      execute: { type: 'boolean' },
      plan: { type: 'boolean' },
      'pr-backend': { enum: ['gh', 'ado', 'manual'], type: 'string' },
      preflight: { type: 'boolean' },
    },
    type: 'object',
  },
  name: 'env',
  outputSchema: {
    additionalProperties: false,
    properties: {
      BRANCHING_STRATEGY: { enum: ['git-town', 'plain-git'], type: 'string' },
      BRANCHING_STRATEGY_SOURCE: { enum: ['auto-detect', 'env'], type: 'string' },
      CHOICE: {
        additionalProperties: false,
        properties: {
          flag: { type: ['string', 'null'] },
          id: { type: 'string' },
          options: {
            items: {
              additionalProperties: false,
              properties: {
                args: { items: { type: 'string' }, type: 'array' },
                label: { type: 'string' },
                value: { type: 'string' },
              },
              required: ['args', 'label', 'value'],
              type: 'object',
            },
            type: 'array',
          },
          question: { type: 'string' },
        },
        required: ['flag', 'id', 'options', 'question'],
        type: 'object',
      },
      CONSOLIDATED_MESSAGE: { type: ['string', 'null'] },
      GIT_TOWN_EXIT_CODE: { maximum: 2, minimum: 0, type: 'integer' },
      INTERACTIVE: { type: 'boolean' },
      PREFLIGHT: {
        additionalProperties: false,
        properties: {
          AGENT_REGISTRATION_REQUIRED: { items: { type: 'string' }, type: 'array' },
          CAPABILITIES: { items: { type: 'string' }, type: 'array' },
          MODE: { enum: ['execute', 'plan'], type: 'string' },
          OPTIONAL_CAPABILITIES: { items: { type: 'string' }, type: 'array' },
          RUN_ID: { type: 'string' },
        },
        required: ['AGENT_REGISTRATION_REQUIRED', 'CAPABILITIES', 'MODE', 'OPTIONAL_CAPABILITIES', 'RUN_ID'],
        type: 'object',
      },
      PR_BACKEND: { enum: ['gh', 'ado', 'manual'], type: 'string' },
      PR_BACKEND_SOURCE: { enum: ['auto-detect', 'env', 'flag'], type: 'string' },
      REMOTE_URL: { type: 'string' },
      WARNINGS: { items: { type: 'string' }, type: 'array' },
      WORKTREE_DIRTY: { type: 'boolean' },
      WORKTREE_STATUS: { items: { type: 'string' }, type: 'array' },
    },
    type: 'object',
  },
  policyKeys: [],
  sideEffect: 'write',
  summary: 'report the branching strategy, PR backend and working-tree state a run would use',
};

module.exports = { spec };
