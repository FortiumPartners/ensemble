'use strict';

/**
 * TRD-010 (TRD-2026-d571763f): `ensemble implement branch` -- the branch intent and the PR plan
 * Step 1 of implement-trd-tasks decides, as data.
 *
 * The branch decision is the one preflight decision with a real side effect at the end of it, so
 * the verb separates deciding from doing: everything up to and including `EXECUTION_PLAN` is
 * computed without touching the repository, and only `--apply` checks a branch out, creates one
 * through the `workflow` capability or writes the choices back. Without `--apply` the verb is a
 * read of git refs and of the TRD, which is what lets a maintainer see the plan before it runs
 * (`skills/implement-trd-tasks-reference/SKILL.md:27`: the EXECUTION PLAN box is printed BEFORE
 * the first mutating git command).
 *
 * `STACKED_PRS` and `PR_ACTIONS` come from `trd-cli pr-plan`, which the reference names as their
 * only source (SKILL.md:24). Re-deriving the branch names here would be a second implementation
 * of `pr-strategy.js` that could disagree with the one the build uses.
 */

const path = require('path');
const fs = require('fs');

const MESSAGES = require('../messages');
const { STRATEGIES } = require('../policy');
const { isResult, needsChoice, refused, unavailable } = require('../result');
const { currentBranch, localBranches, remoteDefaultBranch, switchTo } = require('../git');
const { resolveInteractivity } = require('../interactivity');
const { runToolchain, runTrd, toolchainFailure } = require('../cli-json');
const { slugOf, toProjectRelative } = require('../trd-source');
const { resolveCallerPath } = require('../validate');

const MD_RE = /\.md$/i;

/** The two topology sentences the reference prints, verbatim (SKILL.md:27). */
const TOPOLOGY = Object.freeze({
  single: 'Single PR (all phases on one branch)',
  stacked: 'Stacked (one PR per phase)',
});

function flag(input, key) {
  return input[key] === true;
}

/**
 * The TRD the decision is about. Named explicitly here rather than discovered: `implement resume`
 * already owns discovery, and a branch is created against one document.
 * @param {object} call the dispatcher's call object
 * @returns {{path: string}|object} the project-relative path, or a tagged engine result
 */
function selectTrd(call) {
  const operand = call.input.trd;
  if (typeof operand !== 'string' || !MD_RE.test(operand)) {
    return refused('TRD_REQUIRED', "name the TRD as a '.md' path");
  }
  const absolute = resolveCallerPath(call.projectRoot, operand);
  let stat;
  try {
    stat = fs.statSync(absolute);
  } catch {
    stat = null;
  }
  if (!stat || !stat.isFile()) {
    return refused('TRD_NOT_FOUND', `TRD '${operand}' does not exist`);
  }
  return { path: toProjectRelative(call.projectRoot, absolute) };
}

/**
 * The choices a previous run saved in the TRD's frontmatter (SKILL.md:23).
 * @param {object} call the dispatcher's call object
 * @param {string} trdPath project-relative
 * @returns {{branchName: string, stackedPrs: boolean|null, useProposed: boolean}|object}
 */
function readSavedChoices(call, trdPath) {
  const result = runTrd(call, ['choices-read', trdPath]);
  if (!result.json) {
    return unavailable(
      'CHOICES_UNREADABLE',
      `trd-cli choices-read produced no JSON result (exit ${result.exitCode})${
        result.stderr ? `: ${result.stderr.trim()}` : ''
      }`
    );
  }
  if (typeof result.json.error === 'string') {
    return refused('CHOICES_UNREADABLE', result.json.error);
  }
  const choices = result.json.choices || {};
  return {
    branchName: typeof choices.branch_name === 'string' ? choices.branch_name : '',
    stackedPrs: typeof choices.stacked_prs === 'boolean' ? choices.stacked_prs : null,
    useProposed: choices.use_proposed === true,
  };
}

/**
 * Whether this run plans stacked PRs (SKILL.md:24): the environment toggle wins, then the saved
 * choice, then `false`.
 * @param {object} env
 * @param {boolean|null} saved
 * @returns {boolean}
 */
function effectiveStacked(env, saved) {
  const raw = env && env.ENSEMBLE_USE_STACKED_PRS;
  if (typeof raw === 'string') {
    const value = raw.trim().toLowerCase();
    if (value === 'true') return true;
    if (value === 'false') return false;
  }
  return saved === true;
}

/**
 * The PR plan, from the one CLI that owns it.
 * @param {object} call the dispatcher's call object
 * @param {string} trdPath project-relative
 * @param {boolean} stacked
 * @returns {{actions: object[], branchFirst: string, slug: string, stacked: boolean}|object}
 */
function readPrPlan(call, trdPath, stacked) {
  const result = runTrd(call, ['pr-plan', trdPath, ...(stacked ? ['--stacked'] : [])]);
  if (!result.json) {
    return unavailable(
      'PR_PLAN_UNREADABLE',
      `trd-cli pr-plan produced no JSON result (exit ${result.exitCode})${
        result.stderr ? `: ${result.stderr.trim()}` : ''
      }`
    );
  }
  if (typeof result.json.error === 'string') {
    return refused('PR_PLAN_FAILED', result.json.error);
  }
  if (result.json.ok !== true) {
    return refused('PR_PLAN_FAILED', `trd-cli pr-plan refused '${trdPath}'`);
  }
  return {
    actions: Array.isArray(result.json.actions) ? result.json.actions : [],
    branchFirst: String(result.json.branchFirst || ''),
    slug: String(result.json.slug || ''),
    stacked: result.json.stacked === true,
  };
}

/**
 * The branch-intent question, with the flag that answers each option. The "use current branch"
 * option is only offered when there is one (SKILL.md:26).
 * @param {string} current the current branch, `''` when HEAD is detached
 * @returns {object} a tagged `NEEDS_CHOICE` result
 */
function branchIntentChoice(current) {
  const options = [
    { args: ['--use-proposed-branch'], label: 'Use proposed branch', value: 'proposed' },
    { args: ['--branch', '<name>'], label: 'Specify existing branch', value: 'existing' },
  ];
  if (current.length > 0) {
    options.push({ args: ['--use-current-branch'], label: 'Use current branch', value: 'current' });
  }
  return needsChoice({
    flag: null,
    id: 'branch_intent',
    options,
    question: 'Which branch should this build run on?',
  });
}

/**
 * Resolve the branch intent, first match wins (SKILL.md:26).
 *
 * The non-interactive case takes the proposed branch and records that it did so, rather than
 * halting the way the reference does: this verb decides, and a caller that wants the reference's
 * halt reads `BRANCH_RESOLVED_BY` and refuses for itself (TRD-010's third Implementation AC).
 *
 * @param {{current: string, input: object, interactive: boolean, locals: string[],
 *   proposed: string, saved: object, slug: string, warnings: string[]}} context
 * @returns {{branch: string, candidates: string[], resolvedBy: string, useProposed: boolean}|object}
 */
function resolveIntent(context) {
  const { current, input, interactive, locals, proposed, saved, slug, warnings } = context;
  const requested = typeof input.branch === 'string' ? input.branch : null;
  const useCurrent = flag(input, 'use-current-branch');

  const candidates = locals.filter(name => name.split('/').pop() === slug);

  if (requested !== null) {
    return {
      branch: requested,
      candidates,
      resolvedBy: 'flag-branch',
      useProposed: requested === proposed,
    };
  }
  if (useCurrent) {
    if (current.length === 0) return refused('DETACHED_HEAD', MESSAGES.DETACHED_HEAD);
    return {
      branch: current,
      candidates,
      resolvedBy: 'flag-current',
      useProposed: current === proposed,
    };
  }
  if (flag(input, 'use-proposed-branch')) {
    return { branch: proposed, candidates, resolvedBy: 'flag-proposed', useProposed: true };
  }
  if (candidates.length === 1) {
    return {
      branch: candidates[0],
      candidates,
      resolvedBy: 'auto-detect',
      useProposed: candidates[0] === proposed,
    };
  }
  if (candidates.length > 1) {
    warnings.push(
      `${candidates.length} local branches end in '${slug}', so none was auto-detected: ${candidates.join(', ')}`
    );
  }
  if (saved.useProposed) {
    return { branch: proposed, candidates, resolvedBy: 'saved', useProposed: true };
  }
  if (saved.branchName.length > 0) {
    return {
      branch: saved.branchName,
      candidates,
      resolvedBy: 'saved',
      useProposed: saved.branchName === proposed,
    };
  }
  if (interactive) return branchIntentChoice(current);
  return {
    branch: proposed,
    candidates,
    resolvedBy: 'non-interactive-proposed',
    useProposed: true,
  };
}

/**
 * Reuse mode: the whole build runs on one existing branch, so every per-phase branch and parent
 * link in the plan is replaced and only the completion entry opens a PR (SKILL.md:28).
 * @param {{actions: object[], branch: string, slug: string, trdPath: string}} input
 * @returns {object[]} the rewritten actions
 */
function rewriteForReuse({ actions, branch, slug, trdPath }) {
  const rewritten = [];
  for (const action of actions) {
    if (action.kind === 'completion') continue;
    rewritten.push({
      ...action,
      appendNextBranch: '',
      branch,
      createPr: false,
      parentBranch: '',
    });
  }
  rewritten.push({
    appendNextBranch: '',
    branch,
    createPr: true,
    kind: 'completion',
    parentBranch: '',
    proposeTitle: `Implement ${slug} (${path.basename(trdPath)})`,
    summaryKind: 'single',
  });
  return rewritten;
}

/**
 * The run's mode, as the execution-plan box names it.
 * @param {object} input
 * @returns {string}
 */
function modeOf(input) {
  if (flag(input, 'plan')) return 'plan-only';
  if (flag(input, 'execute')) return 'execute-only';
  return 'full';
}

/**
 * Carry the decision out: check the branch out, creating it through the `workflow` capability
 * when the proposed branch does not exist yet (SKILL.md:29), then persist the choices, whose
 * failure is a warning and not a halt (SKILL.md:31).
 * @param {{base: string, branch: string, call: object, exists: boolean, stacked: boolean,
 *   trdPath: string, useProposed: boolean, warnings: string[]}} context
 * @returns {true|object} `true`, or a tagged engine result
 */
function applyDecision(context) {
  const { base, branch, call, exists, stacked, trdPath, useProposed, warnings } = context;

  if (exists) {
    const switched = switchTo(call, branch);
    if (isResult(switched)) return switched;
  } else {
    const created = runToolchain(call, [
      'run',
      'workflow.branch-create',
      '--arg',
      `name=${branch}`,
      '--arg',
      `baseBranch=${base}`,
    ]);
    if (!created.json) {
      return unavailable(
        'BRANCH_CREATE_UNREADABLE',
        `workflow.branch-create produced no JSON result (exit ${created.exitCode})${
          created.stderr ? `: ${created.stderr.trim()}` : ''
        }`
      );
    }
    if (created.json.ok !== true) return toolchainFailure(created.json.error);
  }

  const written = runTrd(call, [
    'choices-write',
    trdPath,
    '--branch-name',
    branch,
    ...(useProposed ? ['--use-proposed'] : []),
    ...(stacked ? ['--stacked-prs'] : []),
  ]);
  const writeError =
    written.json && typeof written.json.error === 'string'
      ? written.json.error
      : written.json
        ? null
        : `trd-cli choices-write produced no JSON result (exit ${written.exitCode})`;
  if (writeError !== null) {
    warnings.push(`the branch choices were not saved to ${trdPath}: ${writeError}`);
  }
  return true;
}

/**
 * @param {object} call the dispatcher's call object
 * @returns {object} the branch decision, or a tagged engine result
 */
function handler(call) {
  const input = call.input;
  const warnings = [];

  if (typeof input.branch === 'string' && flag(input, 'use-current-branch')) {
    return refused('BRANCH_FLAGS_EXCLUSIVE', MESSAGES.BRANCH_FLAGS_EXCLUSIVE);
  }
  if (flag(input, 'plan') && flag(input, 'execute')) {
    return refused('PLAN_EXECUTE_EXCLUSIVE', MESSAGES.PLAN_EXECUTE_EXCLUSIVE);
  }

  const selected = selectTrd(call);
  if (isResult(selected)) return selected;
  const trdPath = selected.path;

  const saved = readSavedChoices(call, trdPath);
  if (isResult(saved)) return saved;

  const stacked = effectiveStacked(call.env, saved.stackedPrs);
  const plan = readPrPlan(call, trdPath, stacked);
  if (isResult(plan)) return plan;

  const slug = plan.slug.length > 0 ? plan.slug : slugOf(path.resolve(call.projectRoot, trdPath));
  const proposed = plan.branchFirst;

  const current = currentBranch(call);
  if (isResult(current)) return current;
  const locals = localBranches(call);
  if (isResult(locals)) return locals;

  const { interactive } = resolveInteractivity({ env: call.env, globals: call.globals });
  const intent = resolveIntent({
    current,
    input,
    interactive,
    locals,
    proposed,
    saved,
    slug,
    warnings,
  });
  if (isResult(intent)) return intent;

  const branch = intent.branch;
  const exists = locals.includes(branch);
  if (!intent.useProposed && !exists) {
    return refused('BRANCH_NOT_FOUND', MESSAGES.branchNotFound(branch));
  }

  const stackedPrs = intent.useProposed ? plan.stacked : false;
  const actions = intent.useProposed
    ? plan.actions
    : rewriteForReuse({ actions: plan.actions, branch, slug, trdPath });

  const executionPlan = {
    CURRENT_BRANCH: current,
    MODE: modeOf(input),
    PROPOSED_BRANCH: proposed,
    SELECTED_BRANCH: branch,
    STRATEGY: typeof input.strategy === 'string' ? input.strategy : null,
    TOPOLOGY: stackedPrs ? TOPOLOGY.stacked : TOPOLOGY.single,
    TRD: trdPath,
  };

  const base = exists ? null : remoteDefaultBranch(call);
  const applied = flag(input, 'apply');
  if (applied) {
    const result = applyDecision({
      base,
      branch,
      call,
      exists,
      stacked: stackedPrs,
      trdPath,
      useProposed: intent.useProposed,
      warnings,
    });
    if (isResult(result)) return result;
  }

  return {
    APPLIED: applied,
    AUTO_DETECT_CANDIDATES: intent.candidates,
    BASE_BRANCH: base,
    BRANCH_ACTION: exists ? (current === branch ? 'stay' : 'switch') : 'create',
    BRANCH_NAME: branch,
    BRANCH_RESOLVED_BY: intent.resolvedBy,
    CURRENT_BRANCH_NAME: current,
    CURRENT_PHASE_BRANCH: branch,
    EXECUTION_PLAN: executionPlan,
    PHASE_BRANCH_MAP: { 1: branch },
    PHASE_PR_MAP: {},
    PR_ACTIONS: actions,
    STACKED_PRS: stackedPrs,
    USE_PROPOSED: intent.useProposed,
    WARNINGS: warnings,
  };
}

const spec = {
  exitCodes: [0, 1, 2, 4, 5],
  group: 'implement',
  handler,
  inputSchema: {
    additionalProperties: false,
    properties: {
      apply: { type: 'boolean' },
      branch: { pattern: '^[A-Za-z0-9._/][A-Za-z0-9._/-]{0,199}$', type: 'string' },
      execute: { type: 'boolean' },
      plan: { type: 'boolean' },
      strategy: { enum: [...STRATEGIES], type: 'string' },
      trd: { type: 'string', 'x-operand': true },
      'use-current-branch': { type: 'boolean' },
      'use-proposed-branch': { type: 'boolean' },
    },
    type: 'object',
  },
  name: 'branch',
  outputSchema: {
    additionalProperties: false,
    properties: {
      APPLIED: { type: 'boolean' },
      AUTO_DETECT_CANDIDATES: { items: { type: 'string' }, type: 'array' },
      BASE_BRANCH: { type: ['string', 'null'] },
      BRANCH_ACTION: { enum: ['create', 'stay', 'switch'], type: 'string' },
      BRANCH_NAME: { type: 'string' },
      BRANCH_RESOLVED_BY: {
        enum: [
          'auto-detect',
          'flag-branch',
          'flag-current',
          'flag-proposed',
          'non-interactive-proposed',
          'saved',
        ],
        type: 'string',
      },
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
      CURRENT_BRANCH_NAME: { type: 'string' },
      CURRENT_PHASE_BRANCH: { type: 'string' },
      EXECUTION_PLAN: {
        additionalProperties: false,
        properties: {
          CURRENT_BRANCH: { type: 'string' },
          MODE: { enum: ['execute-only', 'full', 'plan-only'], type: 'string' },
          PROPOSED_BRANCH: { type: 'string' },
          SELECTED_BRANCH: { type: 'string' },
          STRATEGY: { type: ['string', 'null'] },
          TOPOLOGY: { enum: [TOPOLOGY.single, TOPOLOGY.stacked], type: 'string' },
          TRD: { type: 'string' },
        },
        required: [
          'CURRENT_BRANCH',
          'MODE',
          'PROPOSED_BRANCH',
          'SELECTED_BRANCH',
          'STRATEGY',
          'TOPOLOGY',
          'TRD',
        ],
        type: 'object',
      },
      PHASE_BRANCH_MAP: { type: 'object' },
      PHASE_PR_MAP: { type: 'object' },
      PR_ACTIONS: { items: { type: 'object' }, type: 'array' },
      STACKED_PRS: { type: 'boolean' },
      USE_PROPOSED: { type: 'boolean' },
      WARNINGS: { items: { type: 'string' }, type: 'array' },
    },
    type: 'object',
  },
  policyKeys: [],
  sideEffect: 'write',
  summary: 'report the branch a build would run on and the PR plan that follows from it',
};

module.exports = { spec };
