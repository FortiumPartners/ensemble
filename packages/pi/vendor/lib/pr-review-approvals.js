'use strict';

/**
 * Approval evaluation: a human approval means a PERSON, on a SPECIFIC commit
 * (TRD-024, REQ-014, AC-014-1 .. AC-014-5).
 *
 * NO side effects, NO shell, NO network, NO file reads. A pure function over
 * the reviews a caller already fetched, the head the PR is at now, and the
 * effective tier from `pr-review-tier.js`.
 *
 * What counts, and what does not:
 *
 *   - an approval by a configured bot login, or one the platform marked as a
 *     bot, is IGNORED with reason `automated` and can never fill a required
 *     slot (AC-014-1). Bot logins come from the repository's policy block, so
 *     a maintainer can name their own agents without a code change;
 *   - an approval is bound to the commit it was given on. It still counts when
 *     that commit IS the head, or when its tree equals the head tree -- the
 *     same content, re-committed (a rebase, an amend, a snapshot commit). Any
 *     other commit is a push this module cannot vouch for, so the approval is
 *     ignored with reason `stale-commit` and approval is requested again
 *     (AC-014-2). An approval with no commit at all is `unbound`: it never
 *     counts, because "approved" with nothing to pin it to is not evidence;
 *   - the person who DIRECTED an agent-authored PR counts as one of the
 *     required reviewers, as if they had written the code themselves
 *     (AC-014-3). They fill exactly one slot, they are never also counted as
 *     an approver, and the PR author never fills a slot;
 *   - the SOLO-MAINTAINER discount (policy `soloMaintainer`) is the one place
 *     a director's word alone is not enough. It lowers High from two humans to
 *     one only for a director the tier record names the sole maintainer, and
 *     only when the PR author is known. A director who is NOT the PR author
 *     must also have an APPROVED review bound to the head (a `Directed by:`
 *     line is text the author writes, so on its own it never lowers the
 *     floor). A director who IS the PR author -- every agent PR in a repo
 *     whose agents commit under the maintainer's own login -- needs no host
 *     approval (the host refuses an author approving their own PR, so none
 *     can exist): the one human is the author-as-director, the discount rests
 *     on their own credit (AC-014-3), and the result carries the non-blocking
 *     warning `solo-maintainer-self-credit` so that is visible;
 *   - distinctness is per person: two approvals from one login are one human.
 *     High needs two DISTINCT people (AC-014-4);
 *   - the humans required come from the effective tier (`low` 0, `medium` 1,
 *     `high` 2, or 1 under the solo-maintainer discount). An effective-Low PR
 *     needs none -- and `effectiveTier` only reaches Low for a maintainer
 *     author with the recorded evidence, so the waiver can never relax a PR
 *     authored by anyone else (AC-014-5).
 *
 * FAIL CLOSED. A request this module cannot read, a tier it cannot read, or a
 * refusal recorded by the tier evaluator, is `satisfied: false` with the
 * reason named and nothing granted: two humans are then required, which is the
 * strictest answer, never the cheapest. An unreadable review is dropped from
 * the count and reported in `ignored[]` -- never silently treated as approval.
 */

const { HUMANS_REQUIRED, TIERS } = require('./pr-review-tier');

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isText = (value) => typeof value === 'string' && value.trim() !== '';

/** A login, compared the way a platform does: case-insensitive, `@` optional. */
const normalizeLogin = (value) => (isText(value) ? value.trim().replace(/^@/, '').toLowerCase() : null);

/** A full 40-character commit or tree object id. A short or bare ref is not one. */
const OBJECT_ID = /^[0-9a-f]{40}$/;
const normalizeSha = (value) => {
  if (!isText(value)) return null;
  const sha = value.trim().toLowerCase();
  return OBJECT_ID.test(sha) ? sha : null;
};

/** The states that are an approval. Anything else is not one (and is not a rejection either). */
const APPROVED_STATES = Object.freeze(['approved', 'approve']);

/** The states that withdraw an approval when they are a reviewer's latest. */
const DECISIVE_NON_APPROVALS = Object.freeze(['changes_requested', 'changes-requested', 'request_changes', 'dismissed']);

/**
 * The fail-closed answer: nothing approved, the strictest requirement, the
 * reason named.
 */
function blocked(reason) {
  return {
    ok: false,
    satisfied: false,
    reason,
    tier: 'high',
    humansRequired: HUMANS_REQUIRED.high,
    humansCounted: 0,
    approvedBy: [],
    directedBy: null,
    ignored: [],
    refusals: [],
    reasons: [reason],
    warnings: [reason],
  };
}

/** Whether a review object says "approved". */
function isApproval(review) {
  if (!isText(review.state)) return false;
  return APPROVED_STATES.includes(review.state.trim().toLowerCase());
}

/**
 * Whether this reviewer is an automated account (AC-014-1): the repository's
 * configured bot list names it, or the platform marked it as a bot.
 */
function automatedReason(login, review, botLogins) {
  if (review.isBot === true) return 'automated';
  if (isText(review.authorType) && review.authorType.trim().toLowerCase() === 'bot') return 'automated';
  if (login !== null && botLogins.has(login)) return 'automated';
  return null;
}

/**
 * Whether the commit an approval was given on still represents the head
 * (AC-014-2).
 *
 * `null` means it does; a string is the reason it does not.
 */
function bindingReason(review, headSha, headTreeSha) {
  const commit = normalizeSha(review.commitSha);
  if (commit === null) return 'unbound';
  if (commit === headSha) return null;
  const tree = normalizeSha(review.treeSha);
  if (tree !== null && headTreeSha !== null && tree === headTreeSha) return null;
  return 'stale-commit';
}

/**
 * Evaluate whether a PR has the human approvals its effective tier requires.
 *
 * @param {Object} input
 * @param {Object[]} input.reviews            Reviews already fetched: `{author|login, state, commitSha, treeSha?, isBot?, authorType?}`.
 * @param {string}  input.headSha             The 40-char SHA of the commit under evaluation.
 * @param {string}  [input.headTreeSha]       The 40-char tree of `headSha`; without it only an exact commit match counts.
 * @param {Object}  input.tier                The `effectiveTier` result from `pr-review-tier.js`.
 * @param {Object}  [input.policy]            The policy block: `botLogins` is read from it.
 * @param {string}  [input.author]            The PR author's login; the author never fills a required slot, and without it the solo-maintainer discount is refused.
 * @param {string}  [input.directedBy]        The person who directed an agent-authored PR (AC-014-3); the solo-maintainer discount also needs their APPROVED review.
 * @param {boolean} [input.agentAuthored]     True when an agent wrote the PR; `directedBy` is read only then.
 * @returns {{ok:boolean, satisfied:boolean, reason:string, tier:string, humansRequired:number,
 *   soloMaintainer:boolean, humansCounted:number, approvedBy:string[], directedBy:string|null,
 *   ignored:Array<{login:string|null, reason:string, commitSha:string|null}>,
 *   refusals:Object[], reasons:string[], warnings:string[]}}
 */
function evaluateApprovals(input) {
  if (!isObject(input)) return blocked('invalid-input');

  const tierResult = input.tier;
  if (!isObject(tierResult)) return blocked('invalid-tier');
  if (tierResult.ok === false) return blocked('tier-blocked');

  const effective = isText(tierResult.effectiveTier) ? tierResult.effectiveTier.trim().toLowerCase() : null;
  if (effective === null || !TIERS.includes(effective)) return blocked('unknown-tier');

  // The tier record's floor is never lowered here: a provided count above it
  // raises the requirement, one below it (or a missing one) cannot. The
  // solo-maintainer discount below is the one exception, and it is decided
  // from the reviews, never from the tier record's say-so.
  const floor = HUMANS_REQUIRED[effective];
  const humansRequired = Number.isInteger(tierResult.humansRequired)
    ? Math.max(tierResult.humansRequired, floor)
    : floor;
  if (!Number.isInteger(humansRequired) || humansRequired < 0) return blocked('unreadable-humans-required');

  const headSha = normalizeSha(input.headSha);
  if (headSha === null) return blocked('invalid-head-sha');
  const headTreeSha = normalizeSha(input.headTreeSha);

  const reviews = input.reviews;
  if (!Array.isArray(reviews)) return blocked('invalid-reviews');

  const warnings = [];
  const reasons = [];
  if (input.headTreeSha !== undefined && input.headTreeSha !== null && headTreeSha === null) {
    warnings.push('unreadable-head-tree-sha');
  }

  const policy = isObject(input.policy) ? input.policy : null;
  if (input.policy !== undefined && input.policy !== null && policy === null) warnings.push('unreadable-policy');
  const botLogins = new Set(
    policy !== null && Array.isArray(policy.botLogins)
      ? policy.botLogins.map(normalizeLogin).filter((login) => login !== null)
      : []
  );

  const author = normalizeLogin(input.author);

  // The tier evaluator's refusals travel with the result: a relaxation that
  // was refused there must still be visible here (AC-013-4).
  const refusals = Array.isArray(tierResult.refusals) ? tierResult.refusals.map((entry) => ({ ...entry })) : [];

  const ignored = [];
  const approvers = [];

  // Only each reviewer's LATEST decisive review counts: a later
  // CHANGES_REQUESTED or DISMISSED removes an earlier approval; COMMENTED and
  // PENDING reviews do not cancel it. Later = later `submittedAt` when both
  // carry a readable one, else later array position.
  const latest = new Map();
  for (const review of reviews) {
    if (!isObject(review) || !isText(review.state)) continue;
    const state = review.state.trim().toLowerCase();
    if (!APPROVED_STATES.includes(state) && !DECISIVE_NON_APPROVALS.includes(state)) continue;
    const who = normalizeLogin(review.author) || normalizeLogin(review.login);
    if (who === null) continue;
    const current = latest.get(who);
    if (current !== undefined) {
      const a = Date.parse(current.submittedAt);
      const b = Date.parse(review.submittedAt);
      if (Number.isFinite(a) && Number.isFinite(b) && b < a) continue;
    }
    latest.set(who, review);
  }

  for (const review of reviews) {
    if (!isObject(review)) {
      ignored.push({ login: null, reason: 'unreadable-review', commitSha: null });
      continue;
    }
    const login = normalizeLogin(review.author) || normalizeLogin(review.login);
    const commitSha = normalizeSha(review.commitSha);
    if (!isApproval(review)) continue; // Not an approval: nothing to count and nothing to ignore.
    if (login !== null && latest.get(login) !== review) continue; // Superseded by the reviewer's later review.
    if (login === null) {
      ignored.push({ login: null, reason: 'unreadable-approver', commitSha });
      continue;
    }
    const automated = automatedReason(login, review, botLogins);
    if (automated !== null) {
      ignored.push({ login, reason: automated, commitSha });
      continue;
    }
    const binding = bindingReason(review, headSha, headTreeSha);
    if (binding !== null) {
      ignored.push({ login, reason: binding, commitSha });
      continue;
    }
    if (author !== null && login === author) {
      ignored.push({ login, reason: 'self-approval', commitSha });
      continue;
    }
    if (!approvers.includes(login)) approvers.push(login);
  }

  // The person who directed an agent-authored PR fills one slot (AC-014-3).
  // They are credited once: as the director, never also as an approver.
  const directedByLogin = input.agentAuthored === true ? normalizeLogin(input.directedBy) : null;
  let directedBy = null;
  if (directedByLogin !== null) {
    if (botLogins.has(directedByLogin)) {
      ignored.push({ login: directedByLogin, reason: 'automated', commitSha: null });
    } else {
      directedBy = directedByLogin;
    }
  } else if (input.agentAuthored === true && input.directedBy !== undefined && input.directedBy !== null) {
    warnings.push('unreadable-directed-by');
  }

  const counted = directedBy === null ? approvers.slice() : [directedBy, ...approvers.filter((login) => login !== directedBy)];
  const humansCounted = counted.length;

  const hasRefusal = refusals.length > 0;
  if (hasRefusal) reasons.push('tier-relaxation-refused');

  // Solo maintainer: the tier evaluator decides ELIGIBILITY (policy flag, one
  // maintainer, High, a path list it can trust, no sensitive path, nobody
  // else demanded). The facts only this module sees are checked here:
  //   - the PR author must be known (else `solo-maintainer-author-unknown`);
  //   - a director who is NOT the author must have an APPROVED review bound
  //     to this head -- exactly who is in `approvers` (a withdrawn, stale,
  //     automated or self-approval never is), else
  //     `solo-maintainer-director-not-approved`;
  //   - a director who IS the author (an agent PR committed under the
  //     maintainer's own login) cannot be approved by the host, so the one
  //     human is the author-as-director and the discount rests on that self-
  //     credit: it applies, with the non-blocking warning
  //     `solo-maintainer-self-credit`.
  // The security lane still blocks High in the gate. An unreadable tier
  // record, refusal, director or author leaves two humans required.
  const solo = isObject(tierResult.soloMaintainer) ? tierResult.soloMaintainer : null;
  const soloLogin = solo !== null && solo.eligible === true ? normalizeLogin(solo.login) : null;
  const soloFactsHold =
    soloLogin !== null &&
    effective === 'high' &&
    humansRequired === HUMANS_REQUIRED.high &&
    !hasRefusal &&
    directedBy === soloLogin;
  // The first fact that stops the discount, if any.
  let soloRefusal = null;
  let soloSelfCredit = false;
  if (soloFactsHold) {
    if (author === null) soloRefusal = 'solo-maintainer-author-unknown';
    else if (author === directedBy) soloSelfCredit = true;
    else if (!approvers.includes(directedBy)) soloRefusal = 'solo-maintainer-director-not-approved';
  }
  const soloApplies = soloFactsHold && soloRefusal === null;
  const required = soloApplies ? 1 : humansRequired;
  if (soloApplies) reasons.push('solo-maintainer-applied');
  else if (soloRefusal !== null) warnings.push(soloRefusal);
  if (soloSelfCredit) warnings.push('solo-maintainer-self-credit');

  const satisfied = !hasRefusal && humansCounted >= required;
  const reason = satisfied
    ? required === 0
      ? 'no-human-approval-required'
      : 'required-approvals-present'
    : hasRefusal
      ? 'tier-relaxation-refused'
      : 'insufficient-human-approvals';
  reasons.push(reason);

  return {
    ok: true,
    satisfied,
    reason,
    tier: effective,
    headSha,
    humansRequired: required,
    soloMaintainer: soloApplies,
    humansCounted,
    approvedBy: counted,
    directedBy,
    ignored,
    refusals,
    reasons,
    warnings,
  };
}

module.exports = { evaluateApprovals, APPROVED_STATES, HUMANS_REQUIRED };
