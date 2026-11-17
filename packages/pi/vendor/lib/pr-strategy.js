'use strict';

/**
 * Deterministic PR-strategy planner.
 *
 * Extracts the branch-naming + stacked-vs-single PR sequencing + the
 * ENSEMBLE_USE_STACKED_PRS toggle from
 * packages/development/commands/implement-trd-tasks.yaml into pure,
 * tested functions. NO side effects, NO shell, NO br/git calls.
 *
 * @typedef {Object} Phase
 * @property {number} n            Phase number (ascending).
 * @property {string} title        Human-readable phase/PR title.
 * @property {string|null} [shippableState] Optional shippable-state line.
 *
 * @typedef {Object} PhaseGateAction
 * @property {number} phaseN
 * @property {'phase-gate'} kind
 * @property {boolean} createPr
 * @property {string|null} proposeTitle
 * @property {string} branch
 * @property {string|null} parentBranch
 * @property {string|null} appendNextBranch
 * @property {string|null} shippableState
 *
 * @typedef {Object} CompletionAction
 * @property {'completion'} kind
 * @property {boolean} createPr
 * @property {string|null} proposeTitle
 * @property {string|null} branch
 * @property {'stacked'|'single'} summaryKind
 */

/**
 * Decide whether stacked PRs are enabled.
 *
 * Stacked PRs are OPT-IN. The default (unset, empty, 'false', '0', 'yes',
 * or any non-'true' value) is SINGLE PR for the entire TRD. Only the exact
 * value 'true' (case-insensitive) enables stacked PRs.
 *
 * @param {Object} [env] Environment-like object (pass process.env at call site).
 * @returns {boolean} true only when env.ENSEMBLE_USE_STACKED_PRS === 'true'
 *   (case-insensitive); false otherwise (default = single PR).
 */
function useStackedPrs(env) {
  const raw = (env || {}).ENSEMBLE_USE_STACKED_PRS;
  return String(raw).toLowerCase() === 'true';
}

/**
 * Compute the git branch name for a phase under the chosen strategy.
 *
 * - stacked=true:  feature/<slug>-<prefix>-<phaseN>
 *                  where prefix = prFormat ? 'pr' : 'phase'
 * - stacked=false: feature/<slug>  (one branch for the whole TRD; phaseN ignored)
 *
 * @param {string} trdSlug
 * @param {Object} opts
 * @param {boolean} opts.prFormat
 * @param {boolean} opts.stacked
 * @param {number} [opts.phaseN]
 * @returns {string}
 */
function branchName(trdSlug, opts) {
  const { prFormat, stacked, phaseN } = opts || {};
  if (!stacked) {
    return `feature/${trdSlug}`;
  }
  const prefix = prFormat ? 'pr' : 'phase';
  return `feature/${trdSlug}-${prefix}-${phaseN}`;
}

/**
 * Build the propose title for a stacked per-phase PR.
 * @private
 */
function phaseProposeTitle(trdSlug, prFormat, phase) {
  const label = prFormat ? 'PR' : 'Phase';
  return `feat(${trdSlug}): ${label} ${phase.n} — ${phase.title}`;
}

/**
 * Plan the ordered sequence of PR/branch actions across phase boundaries and
 * at completion, for either stacked or single PR strategy.
 *
 * Pure and deterministic. Never throws on empty phases — returns just the
 * completion entry with a sensible summaryKind.
 *
 * @param {Object} opts
 * @param {string} opts.trdSlug
 * @param {boolean} opts.prFormat
 * @param {boolean} opts.stacked
 * @param {Phase[]} opts.phases   Ascending list of phases.
 * @param {string} [opts.trdTitle] Title for the single-PR completion title;
 *   falls back to the slug when absent.
 * @returns {Array<PhaseGateAction|CompletionAction>}
 */
function planPrActions(opts) {
  const {
    trdSlug,
    prFormat,
    stacked,
    phases,
    trdTitle,
  } = opts || {};

  const list = Array.isArray(phases) ? phases : [];
  const actions = [];

  list.forEach((phase, idx) => {
    const next = list[idx + 1];
    const shippableState =
      phase.shippableState === undefined ? null : phase.shippableState;

    let parentBranch = null;
    let appendNextBranch = null;
    let proposeTitle = null;

    if (stacked) {
      parentBranch =
        phase.n > 1
          ? branchName(trdSlug, { prFormat, stacked: true, phaseN: phase.n - 1 })
          : 'main';
      appendNextBranch = next
        ? branchName(trdSlug, { prFormat, stacked: true, phaseN: next.n })
        : null;
      proposeTitle = phaseProposeTitle(trdSlug, prFormat, phase);
    }

    actions.push({
      phaseN: phase.n,
      kind: 'phase-gate',
      createPr: Boolean(stacked),
      proposeTitle,
      branch: branchName(trdSlug, { prFormat, stacked, phaseN: phase.n }),
      parentBranch,
      appendNextBranch,
      shippableState,
    });
  });

  // Final completion entry.
  if (stacked) {
    actions.push({
      kind: 'completion',
      createPr: false,
      proposeTitle: null,
      branch: null,
      summaryKind: 'stacked',
    });
  } else {
    actions.push({
      kind: 'completion',
      createPr: true,
      proposeTitle: `feat(${trdSlug}): ${trdTitle || trdSlug}`,
      branch: `feature/${trdSlug}`,
      summaryKind: 'single',
    });
  }

  return actions;
}

// git-town's validate-git-town.sh exit codes (mirrored here so callers don't
// have to pass magic numbers — see packages/git/skills/git-town/scripts/validate-git-town.sh).
const GIT_TOWN_EXIT_SUCCESS = 0;
const GIT_TOWN_EXIT_NOT_FOUND = 1;
const GIT_TOWN_EXIT_NOT_CONFIGURED = 2;

// Remote-host patterns git-town's `forge-type` cannot support today. Expressed
// as a list of patterns (not a one-off string check) per REQ-007 — add future
// unsupported hosts here.
const UNSUPPORTED_FORGE_HOST_PATTERNS = [/(^|\.)dev\.azure\.com$/i];

/**
 * Extract the hostname from a git remote URL, supporting the shapes git
 * actually produces: `https://host/path`, `ssh://user@host/path`,
 * `git://host/path`, and the scp-like `user@host:path` syntax.
 * @private
 * @param {string} remoteUrl
 * @returns {string} lowercase hostname, or '' if it can't be parsed.
 */
function extractRemoteHost(remoteUrl) {
  const url = String(remoteUrl || '');
  const scpMatch = url.match(/^[^@/]+@([^:/]+):/);
  if (scpMatch) {
    return scpMatch[1].toLowerCase();
  }
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/**
 * Decide whether a git remote URL points at a host git-town's `propose`/`ship`
 * cannot support natively (currently: Azure DevOps / `dev.azure.com`).
 * GitHub, GitLab, Bitbucket, and Gitea/Forgejo hosts are never flagged.
 *
 * Pure — no shell, no network. Only inspects the string.
 *
 * @param {string} remoteUrl e.g. `https://dev.azure.com/org/project/_git/repo`
 * @returns {boolean}
 */
function isUnsupportedForgeHost(remoteUrl) {
  const host = extractRemoteHost(remoteUrl);
  if (!host) {
    return false;
  }
  return UNSUPPORTED_FORGE_HOST_PATTERNS.some((pattern) => pattern.test(host));
}

/**
 * Resolve which branching strategy ('git-town' or 'plain-git') Preflight
 * should use, applying the exact precedence table from TRD §1.3:
 *
 * | ENSEMBLE_BRANCHING_STRATEGY | git-town exit code | Result                 |
 * |---|---|---|
 * | unset      | 0       | git-town, silent                             |
 * | unset      | 1       | plain-git, silent                            |
 * | unset      | 2       | plain-git, warn once                         |
 * | plain-git  | any     | plain-git, silent (explicit request always honored) |
 * | git-town   | 0       | git-town, silent (explicit request matches reality) |
 * | git-town   | 1 or 2  | HALT (explicit request cannot be honored)    |
 *
 * Exit codes 3 (old version) / 4 (not a git repo) are out of scope for this
 * function — callers HALT on those before ever resolving a branching
 * strategy, per REQ-002. If reached anyway, they HALT here too rather than
 * silently proceeding.
 *
 * Pure — no shell, no side effects, no br/git calls.
 *
 * @param {Object} [env] Environment-like object (pass process.env at call site).
 * @param {number} gitTownExitCode Exit code from validate-git-town.sh (0-4).
 * @returns {{strategy: ('git-town'|'plain-git'|null), source: ('env'|'auto-detect'), action: ('proceed'|'warn'|'halt'), message: (string|null)}}
 */
function resolveBranchingStrategy(env, gitTownExitCode) {
  const raw = (env || {}).ENSEMBLE_BRANCHING_STRATEGY;
  const requested = raw === 'plain-git' || raw === 'git-town' ? raw : undefined;

  if (requested === 'plain-git') {
    // Explicit request always wins — git-town's state is irrelevant.
    return { strategy: 'plain-git', source: 'env', action: 'proceed', message: null };
  }

  if (requested === 'git-town') {
    if (gitTownExitCode === GIT_TOWN_EXIT_SUCCESS) {
      return { strategy: 'git-town', source: 'env', action: 'proceed', message: null };
    }
    return {
      strategy: null,
      source: 'env',
      action: 'halt',
      message:
        'ENSEMBLE_BRANCHING_STRATEGY=git-town was requested, but git-town is not usable in ' +
        `this repository (validate-git-town.sh exit code ${gitTownExitCode}). Run ` +
        '`git town init` to configure git-town, or unset ENSEMBLE_BRANCHING_STRATEGY to ' +
        'auto-fallback to plain-git.',
    };
  }

  // Unset (or an unrecognized value) — auto-detect from git-town's state.
  if (gitTownExitCode === GIT_TOWN_EXIT_SUCCESS) {
    return { strategy: 'git-town', source: 'auto-detect', action: 'proceed', message: null };
  }
  if (gitTownExitCode === GIT_TOWN_EXIT_NOT_FOUND) {
    return { strategy: 'plain-git', source: 'auto-detect', action: 'proceed', message: null };
  }
  if (gitTownExitCode === GIT_TOWN_EXIT_NOT_CONFIGURED) {
    return {
      strategy: 'plain-git',
      source: 'auto-detect',
      action: 'warn',
      message:
        'git-town is installed but not configured for this repository; falling back to the ' +
        'plain-git branching strategy. Run `git town init` to configure git-town, or set ' +
        'ENSEMBLE_BRANCHING_STRATEGY=plain-git to silence this warning.',
    };
  }

  // Exit codes 3/4: unrelated to branching-strategy fallback. Callers HALT on
  // these before reaching here (REQ-002); HALT defensively if reached anyway.
  return {
    strategy: null,
    source: 'auto-detect',
    action: 'halt',
    message: `git-town validation failed with exit code ${gitTownExitCode}, which is unrelated to branching-strategy fallback; resolve the underlying git-town issue.`,
  };
}

// Valid explicit values for ENSEMBLE_PR_BACKEND (REQ-006).
const VALID_PR_BACKENDS = ['gh', 'ado', 'manual'];

/**
 * Resolve which PR-creation backend ('gh', 'ado', or 'manual') should be
 * used, independently of the branching strategy (REQ-006):
 *
 * - ENSEMBLE_PR_BACKEND set to one of gh/ado/manual: honored as-is,
 *   regardless of remote URL.
 * - Unset (or unrecognized): auto-detect from the remote URL. An
 *   unsupported forge host (e.g. dev.azure.com) can't be resolved
 *   automatically and needs a prompt/HALT (REQ-008); any other host
 *   defaults to 'gh' (today's behavior, zero new output per REQ-001).
 *
 * Pure — no shell, no side effects, no br/git calls.
 *
 * @param {Object} [env] Environment-like object (pass process.env at call site).
 * @param {string} remoteUrl Git remote URL, e.g. `https://github.com/org/repo`.
 * @returns {{backend: ('gh'|'ado'|'manual'|null), source: ('env'|'auto-detect'), needsResolution: boolean}}
 */
function resolvePrBackend(env, remoteUrl) {
  const raw = (env || {}).ENSEMBLE_PR_BACKEND;
  if (VALID_PR_BACKENDS.includes(raw)) {
    return { backend: raw, source: 'env', needsResolution: false };
  }

  if (isUnsupportedForgeHost(remoteUrl)) {
    return { backend: null, source: 'auto-detect', needsResolution: true };
  }
  return { backend: 'gh', source: 'auto-detect', needsResolution: false };
}

/**
 * Compose the single consolidated Preflight message summarizing both
 * resolution axes (REQ-013), or `null` when both are pure defaults — the
 * common case where nothing new needs to be surfaced (REQ-001: zero new
 * output vs. today's behavior).
 *
 * "Pure default" means: branching strategy auto-detected to 'git-town' (no
 * env override, no plain-git fallback) AND PR backend auto-detected with no
 * resolution needed (no env override, no unsupported-host prompt/HALT).
 * Anything else — an env override on either axis, a branching-strategy
 * fallback/warn/halt, or a PR-backend prompt — produces exactly ONE string
 * naming both axes' resolved values and their sources (never two separate
 * messages).
 *
 * Pure — no shell, no side effects, no br/git calls.
 *
 * @param {ReturnType<typeof resolveBranchingStrategy>} branchingStrategy
 * @param {ReturnType<typeof resolvePrBackend>} prBackend
 * @returns {string|null}
 */
function buildConsolidatedResolutionMessage(branchingStrategy, prBackend) {
  const bs = branchingStrategy || {};
  const pb = prBackend || {};

  const branchingIsDefault = bs.source === 'auto-detect' && bs.strategy === 'git-town';
  const backendIsDefault = pb.source === 'auto-detect' && pb.needsResolution === false;

  if (branchingIsDefault && backendIsDefault) {
    return null;
  }

  const branchingPart = `branching strategy resolved to '${bs.strategy || '(unresolved)'}' (${bs.source || 'unknown'})`;
  const backendPart = pb.needsResolution
    ? "PR backend resolution needed (unsupported host, no ENSEMBLE_PR_BACKEND set)"
    : `PR backend resolved to '${pb.backend || '(unresolved)'}' (${pb.source || 'unknown'})`;

  return `Ensemble SDLC config: ${branchingPart}; ${backendPart}.`;
}

module.exports = {
  useStackedPrs,
  branchName,
  planPrActions,
  resolveBranchingStrategy,
  isUnsupportedForgeHost,
  resolvePrBackend,
  buildConsolidatedResolutionMessage,
};
