'use strict';

/**
 * Review scope resolver.
 *
 * Resolves the exact base..head SHA range to review. NO shell, NO git
 * calls -- the caller supplies already-resolved SHAs; this module never
 * substitutes a guessed base (e.g. a bare ref name) for a real commit.
 */

/**
 * @param {Object} input
 * @param {string} [input.baseRef]            Informational only -- never used to guess a base SHA.
 * @param {string} [input.baseSha]
 * @param {string} [input.headSha]
 * @param {string} [input.mergeBaseSha]
 * @param {string} [input.prBaseSha]
 * @param {string} [input.parentPhaseTipSha]   Stacked-phase parent branch tip; takes priority over baseSha/mergeBaseSha/prBaseSha.
 * @returns {{ok:true, baseSha:string, headSha:string, range:string} | {ok:false, status:'REVIEW_BLOCKED', missing:string[]}}
 */
function resolveReviewScope(input = {}) {
  const { headSha, baseSha, mergeBaseSha, prBaseSha, parentPhaseTipSha } = input;

  // Stacked-phase tip excludes the parent phase's own history and any later
  // phase, so it always wins over a trunk base SHA when present.
  const resolvedBase = parentPhaseTipSha || baseSha || prBaseSha || mergeBaseSha || null;

  const missing = [];
  if (!resolvedBase) missing.push('baseSha');
  if (!headSha) missing.push('headSha');

  if (missing.length > 0) {
    return { ok: false, status: 'REVIEW_BLOCKED', missing };
  }

  return { ok: true, baseSha: resolvedBase, headSha, range: `${resolvedBase}..${headSha}` };
}

module.exports = { resolveReviewScope };
