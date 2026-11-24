'use strict';

/**
 * TRD-003 (TRD-2026-d571763f): the declared mount table for the `trd` group.
 *
 * Data only -- this file never requires `trd-cli.js` and contains no logic. The side-effect
 * column is authored, not inferred: `write` is declared for the verbs that touch disk
 * (`quickstart` trd-cli.js:745, `create-workstream-trd` :928, `migrate-frontmatter` :1293,
 * `choices-write` :1428, `verify` :1626, and the two bead-mutating verbs), `read` for the rest.
 * A verb added to `verbs` without a `sideEffects` entry is refused by `mountLegacyGroup`.
 */

const path = require('path');

const CLI_PATH = path.join(__dirname, '..', '..', 'trd-cli.js');

/** The 26 subcommands of `trd-cli.js` (its `HANDLERS` table, trd-cli.js:1657). */
const VERBS = Object.freeze([
  'parse',
  'scaffold-plan',
  'scaffold-calls',
  'scaffold-dep-args',
  'bead-context',
  'phase-status',
  'next-task',
  'pr-plan',
  'resolve-sdlc',
  'resolve-bdd',
  'validate-workstream',
  'create-workstream-trd',
  'workstream-plan',
  'workstream-status',
  'beads-label',
  'beads-stage',
  'quickstart',
  'choices-read',
  'choices-write',
  'list',
  'status',
  'migrate-frontmatter',
  'validate',
  'analyze',
  'req-status',
  'verify',
]);

const SIDE_EFFECTS = Object.freeze({
  analyze: 'read',
  'bead-context': 'read',
  'beads-label': 'write',
  'beads-stage': 'write',
  'choices-read': 'read',
  'choices-write': 'write',
  'create-workstream-trd': 'write',
  list: 'read',
  'migrate-frontmatter': 'write',
  'next-task': 'read',
  parse: 'read',
  'phase-status': 'read',
  'pr-plan': 'read',
  quickstart: 'write',
  'req-status': 'read',
  'resolve-bdd': 'read',
  'resolve-sdlc': 'read',
  'scaffold-calls': 'read',
  'scaffold-dep-args': 'read',
  'scaffold-plan': 'read',
  status: 'read',
  validate: 'read',
  'validate-workstream': 'read',
  verify: 'write',
  'workstream-plan': 'read',
  'workstream-status': 'read',
});

const SUMMARIES = Object.freeze({
  analyze: 'analyze a TRD for complexity and readiness',
  'bead-context': 'print the implementation context of one bead',
  'beads-label': 'apply TRD-derived labels to beads',
  'beads-stage': 'stage beads for a TRD phase',
  'choices-read': 'read the recorded design choices of a TRD',
  'choices-write': 'record design choices for a TRD',
  'create-workstream-trd': 'create a workstream TRD from a parent TRD',
  list: 'list the TRDs or PRDs in a directory',
  'migrate-frontmatter': 'migrate a TRD to the current frontmatter format',
  'next-task': 'print the next implementable task of a TRD',
  parse: 'parse a TRD into its structured form',
  'phase-status': 'report per-phase completion for a TRD',
  'pr-plan': 'plan the stacked pull requests of a TRD',
  quickstart: 'scaffold a new TRD',
  'req-status': 'report requirement coverage for a TRD',
  'resolve-bdd': 'resolve the BDD toolchain for a TRD',
  'resolve-sdlc': 'resolve the SDLC toolchain for a TRD',
  'scaffold-calls': 'scaffold the tool calls of a TRD phase',
  'scaffold-dep-args': 'scaffold dependency arguments for a TRD phase',
  'scaffold-plan': 'scaffold an implementation plan for a TRD',
  status: 'report the overall status of a TRD',
  validate: 'validate a TRD against the house format',
  'validate-workstream': 'validate a workstream TRD against its parent',
  verify: 'verify the completion state of a TRD',
  'workstream-plan': 'plan the workstreams of a TRD',
  'workstream-status': 'report workstream status for a TRD',
});

module.exports = {
  cliPath: CLI_PATH,
  // `trd-cli.js` returns 0 on success and 1 on failure (its `main`, trd-cli.js:1694).
  exitCodes: Object.freeze([0, 1]),
  group: 'trd',
  sideEffects: SIDE_EFFECTS,
  summaries: SUMMARIES,
  verbs: VERBS,
};
