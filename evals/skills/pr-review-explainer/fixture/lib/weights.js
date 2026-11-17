'use strict';

// Reviewer weight by role. A role this table does not know counts for nothing,
// so an unknown or misspelled role can never tip a tally.
const ROLE_WEIGHTS = { maintainer: 2, reviewer: 1, bot: 0 };

function weightFor(role) {
  return Object.prototype.hasOwnProperty.call(ROLE_WEIGHTS, role) ? ROLE_WEIGHTS[role] : 0;
}

module.exports = { weightFor };
