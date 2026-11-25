'use strict';

/**
 * TRD-006 (TRD-2026-d571763f): the `implement` group -- the preflight decisions of
 * implement-trd-tasks, each one a verb.
 *
 * The group is a table, not a dispatcher: it holds the verb specs and hands them to the registry,
 * which is the one place a verb becomes callable (Constitution Rule 4 -- there is no second
 * dispatcher). Each verb lives in its own module under `verbs/` and exports its full spec.
 */

const SPECS = [
  require('../verbs/implement-args').spec,
  require('../verbs/implement-branch').spec,
  require('../verbs/implement-env').spec,
  require('../verbs/implement-resume').spec,
  require('../verbs/implement-team').spec,
];

/**
 * @param {{register: Function}} registry
 * @returns {object[]} the registered specs
 */
function register(registry) {
  return SPECS.map(spec => registry.register(spec));
}

module.exports = { group: 'implement', register, verbs: SPECS };
