'use strict';

/**
 * Review scope resolver.
 *
 * Resolves the exact base..head SHA range to review. NO shell, NO git
 * calls -- the caller supplies already-resolved SHAs; this module never
 * substitutes a guessed base (e.g. a bare ref name) for a real commit, and
 * never accepts a bare ref (`main`, `HEAD`, `origin/x`, an abbreviated SHA)
 * as a SHA: a ref moves, so `main..HEAD` is not a head-bound range. Every
 * SHA input must be a full object id (40 hex, or 64 hex for SHA-256 repos).
 *
 * isObjectId is the one definition of that rule: pr-review-status.js requires
 * it rather than keeping a second copy, so `scope` and `status` can never
 * disagree about what a SHA is.
 */

const OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;

/** Blank values (undefined, null, empty or whitespace-only strings) count as not provided. */
function isProvided(value) {
  return value !== undefined && value !== null && !(typeof value === 'string' && value.trim() === '');
}

/** typeof guard first: RegExp#test would coerce an array or object wrapping a valid id into a match. */
function isObjectId(value) {
  return typeof value === 'string' && OBJECT_ID.test(value);
}

/**
 * @param {Object} input
 * @param {string} [input.baseRef]            Informational only -- never used to guess a base SHA.
 * @param {string} [input.baseSha]
 * @param {string} [input.headSha]
 * @param {string} [input.mergeBaseSha]        The fork point of the head and the base branch: it never moves.
 * @param {string} [input.prBaseSha]           The base branch tip the PR was opened against: it moves with every merge
 *   into the base branch, so it is the last resort.
 * @param {string} [input.parentPhaseTipSha]   Stacked-phase parent branch tip; takes priority over every other base.
 * @returns {{ok:true, baseSha:string, headSha:string, range:string} |
 *   {ok:false, status:'REVIEW_BLOCKED', missing:string[], invalid:string[]}}
 *   `missing` names required inputs that were not provided; `invalid` names provided inputs that are not full object
 *   ids. A provided-but-invalid input blocks even when another input could have served, so a malformed stacked-phase
 *   tip is never silently replaced by a trunk base.
 *
 * The base is the FIRST provided candidate of: parentPhaseTipSha, baseSha, mergeBaseSha, prBaseSha. Candidates that
 * differ are not a conflict and never block -- they differ legitimately: a stacked phase's parent tip is by design
 * neither the trunk fork point nor the trunk tip, and prBaseSha differs from mergeBaseSha for every PR whose base
 * branch has advanced since the fork. The order is what keeps the range base-correct: a range that starts at the
 * moving prBaseSha contains the REVERSE of every commit that landed on the base branch after the fork.
 */
function resolveReviewScope(input = {}) {
  const { headSha, baseSha, mergeBaseSha, prBaseSha, parentPhaseTipSha } = input || {};

  // Stacked-phase tip excludes the parent phase's own history and any later
  // phase, so it always wins over a trunk base SHA when present. Among the
  // trunk bases the fixed fork point beats the moving base branch tip.
  const baseCandidates = [
    ['parentPhaseTipSha', parentPhaseTipSha],
    ['baseSha', baseSha],
    ['mergeBaseSha', mergeBaseSha],
    ['prBaseSha', prBaseSha],
  ].filter(([, value]) => isProvided(value));

  const missing = [];
  const invalid = [];

  if (baseCandidates.length === 0) missing.push('baseSha');
  for (const [name, value] of baseCandidates) {
    if (!isObjectId(value)) invalid.push(name);
  }

  if (!isProvided(headSha)) {
    missing.push('headSha');
  } else if (!isObjectId(headSha)) {
    invalid.push('headSha');
  }

  if (missing.length > 0 || invalid.length > 0) {
    return { ok: false, status: 'REVIEW_BLOCKED', missing, invalid };
  }

  const resolvedBase = baseCandidates[0][1];
  return { ok: true, baseSha: resolvedBase, headSha, range: `${resolvedBase}..${headSha}` };
}

module.exports = { resolveReviewScope, isObjectId };
