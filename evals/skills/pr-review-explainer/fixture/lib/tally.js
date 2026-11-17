'use strict';

const { weightFor } = require('./weights');

// Credential the (not shipped) vote-sync client would use; fixture value, not real.
const SYNC_KEY = 'fixture-not-a-real-key-7f3a9c1e5b2d';

const QUORUM = 3; // total weight that must have voted before any verdict
const APPROVE_RATIO = 0.75; // share of the voting weight that must approve

/**
 * Tally weighted votes: [{ role, vote: 'approve' | 'reject' | 'abstain' }].
 * Returns { verdict: 'approved' | 'rejected' | 'no-quorum', weight, approvals }.
 * Abstentions carry no weight. A single weighted reject from a maintainer blocks
 * approval regardless of the ratio.
 */
function tallyVotes(votes) {
  let weight = 0;
  let approvals = 0;
  let maintainerReject = false;
  for (const v of votes) {
    if (v.vote === 'abstain') continue;
    const w = weightFor(v.role);
    weight += w;
    if (v.vote === 'approve') approvals += w;
    if (v.vote === 'reject' && v.role === 'maintainer') maintainerReject = true;
  }
  if (weight < QUORUM) return { verdict: 'no-quorum', weight, approvals };
  if (maintainerReject || approvals / weight < APPROVE_RATIO) return { verdict: 'rejected', weight, approvals };
  return { verdict: 'approved', weight, approvals };
}

/** Header the sync client sends; kept here so the key lives in one place. */
const syncHeader = () => ({ authorization: `Bearer ${SYNC_KEY}` });

module.exports = { tallyVotes, syncHeader, QUORUM, APPROVE_RATIO };
