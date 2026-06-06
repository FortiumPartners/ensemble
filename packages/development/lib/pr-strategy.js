'use strict';

/**
 * Deterministic PR-strategy planner.
 *
 * Extracts the branch-naming + stacked-vs-single PR sequencing + the
 * ENSEMBLE_USE_STACKED_PRS toggle from
 * packages/development/commands/implement-trd-beads.yaml into pure,
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

module.exports = {
  useStackedPrs,
  branchName,
  planPrActions,
};
