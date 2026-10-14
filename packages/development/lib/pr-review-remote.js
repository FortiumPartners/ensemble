'use strict';

/**
 * Head-bound remote review evaluator.
 *
 * Collects reviews, inline comments, threads and check runs for a PR and
 * determines whether a configured bot's review is actually bound to the
 * exact current head commit. NO side effects, NO network calls -- the
 * caller supplies the already-fetched facts.
 */

function hasValue(value) {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

/**
 * @param {Object} facts
 * @param {string} facts.headSha
 * @param {Array}  [facts.reviews]
 * @param {Array}  [facts.comments]
 * @param {Array}  [facts.threads]      Each thread: { id, resolved }
 * @param {Array}  [facts.checkRuns]
 * @param {Array}  [facts.botLogins]    Configured bot usernames (e.g. CodeRabbit)
 * @param {Object} [facts.access]       { ok, reason } -- review retrieval access result
 * @returns {{remotePhase: string, collected: Array, unresolvedThreads: Array, unverifiable: Array, reasons: string[]}}
 */
function evaluateRemoteReview(facts = {}) {
  const {
    headSha,
    reviews = [],
    comments = [],
    threads = [],
    checkRuns = [],
    botLogins = [],
    access,
  } = facts;

  const reasons = [];
  if (!hasValue(headSha)) reasons.push('missing headSha');

  const allItems = [
    ...reviews.map((item) => ({ ...item, kind: 'review' })),
    ...comments.map((item) => ({ ...item, kind: 'comment' })),
    ...checkRuns.map((item) => ({ ...item, kind: 'check' })),
  ];

  // Every item for the current head -- not only the latest summary -- and
  // never an item bound to a different (stale, pre-rebase) commit.
  const collected = allItems.filter((item) => hasValue(item.commitSha) && item.commitSha === headSha);

  // Items with no commit identity at all can't be bound to any head; they
  // are reported separately rather than silently counted or dropped.
  const unverifiable = allItems.filter((item) => !hasValue(item.commitSha));

  const unresolvedThreads = threads.filter((thread) => thread && thread.resolved !== true);

  const botLoginSet = new Set(botLogins.map((login) => String(login).toLowerCase()));
  const boundBotEntries = collected.filter((item) => botLoginSet.has(String(item.author || '').toLowerCase()));

  if (access && access.ok === false) {
    reasons.push(access.reason || 'review access unavailable');
    return { remotePhase: 'REMOTE_REVIEW_PENDING', collected, unresolvedThreads, unverifiable, reasons };
  }

  if (boundBotEntries.length === 0) {
    reasons.push(
      unverifiable.some((item) => botLoginSet.has(String(item.author || '').toLowerCase()))
        ? 'bot summary lacks commit identity and is unverifiable'
        : 'no bot review bound to the current head commit'
    );
  }
  if (unresolvedThreads.length > 0) {
    reasons.push('unresolved review threads remain');
  }

  const remotePhase =
    boundBotEntries.length > 0 && unresolvedThreads.length === 0 ? 'REMOTE_REVIEW_COMPLETE' : 'REMOTE_REVIEW_PENDING';

  return { remotePhase, collected, unresolvedThreads, unverifiable, reasons };
}

module.exports = { evaluateRemoteReview };
