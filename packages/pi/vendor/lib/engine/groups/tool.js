'use strict';

/**
 * TRD-003 (TRD-2026-d571763f): the declared mount table for the `tool` group.
 *
 * Data only -- this file never requires `toolchain-cli.js` and contains no logic. `write` is
 * declared for the verbs that execute adapter commands or append to state (`run`, `preflight`,
 * `confirm-record`, `trace`); `read` for the pure resolution verbs. A verb added to `verbs`
 * without a `sideEffects` entry is refused by `mountLegacyGroup`.
 */

const path = require('path');

const CLI_PATH = path.join(__dirname, '..', '..', 'toolchain-cli.js');

/** The `HANDLERS` table of `toolchain-cli.js` (:882) plus `trace` (:1165). */
const VERBS = Object.freeze([
  'resolve',
  'explain',
  'validate',
  'run',
  'preflight',
  'confirm-status',
  'confirm-record',
  'trace',
]);

const SIDE_EFFECTS = Object.freeze({
  'confirm-record': 'write',
  'confirm-status': 'read',
  explain: 'read',
  preflight: 'write',
  resolve: 'read',
  run: 'write',
  trace: 'write',
  validate: 'read',
});

const SUMMARIES = Object.freeze({
  'confirm-record': 'record an operator confirmation for a capability',
  'confirm-status': 'report the confirmation status of a capability',
  explain: 'explain how each toolchain category resolved',
  preflight: 'run the preflight checks of a capability',
  resolve: 'resolve the adapter for each toolchain category',
  run: 'run a capability through its resolved adapter',
  trace: 'record a run trace span',
  validate: 'validate the resolved toolchain configuration',
});

module.exports = {
  cliPath: CLI_PATH,
  // `toolchain-cli.js` adds 2 for an unknown subcommand (toolchain-cli.js:1382).
  exitCodes: Object.freeze([0, 1, 2]),
  group: 'tool',
  sideEffects: SIDE_EFFECTS,
  summaries: SUMMARIES,
  verbs: VERBS,
};
