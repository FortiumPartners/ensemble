#!/usr/bin/env node
'use strict';

/**
 * issue-run-index-cli.js -- CLI over the fix-issue run index (IssueRunIndexStore, generated into
 * lib/run-index/fix-issue/ from packages/agent-core/src/fix-issue/issue-run-index.ts).
 *
 * Usage: node issue-run-index-cli.js <subcommand> < payload.json
 *
 *   create       { issueDescription }                  start a run at analysis_planning
 *   find-active  {}                                    the active/paused run, or null
 *   load         { runId }
 *   abandon      { runId, reason? }                    terminal; releases active.lock
 *   complete     { runId }                             terminal; releases active.lock
 *   mutate       { runId, expectedRevision, patch[] }  one revision-checked write
 *
 * Every payload may carry `projectRoot` (default: the git toplevel of the cwd, else the cwd).
 * Output is one JSON object: {ok:true, run} or {ok:false, code, message, ...}; see
 * run-index-cli-core.js for the codes, the exit-code rule and the path guards.
 *
 * Patch ops (applied in order; the CLI stamps every timestamp):
 *   {op:"setStage", stage}                  analysis_planning | execution | validation_delivery | done
 *   {op:"setStageOutcome", kind?, detail?}  kind: success | decline | failure | approval_wait;
 *                                           an omitted kind keeps the current one
 *   {op:"appendArtifact", type, path}       type: free-form label; path stays inside the project
 *   {op:"appendBeadRef", ref}               bead id or "pr:<url>"; skipped when already present
 *   {op:"setPrApprovedAt", value}           "now" | null
 */

const store = require('./run-index/fix-issue/issue-run-index');
const { ISSUE_STAGE_ORDER } = require('./run-index/fix-issue/types');
const { createCli, requireText, checkArtifactPath } = require('./run-index-cli-core');

const cli = createCli({
  name: 'issue-run-index-cli.js',
  runsRel: '.ensemble/fix-issue',
  store,
  stages: ISSUE_STAGE_ORDER,
  create: { field: 'issueDescription' },
  extraOps: [],
  hasArtifactLookup: false,
  artifactFields: ['type', 'path'],
  artifact: (op, root, at) => {
    return { type: requireText(op.type, `${at}.type`), path: checkArtifactPath(op.path, root, `${at}.path`) };
  },
});

module.exports = { SUBCOMMANDS: cli.SUBCOMMANDS, PATCH_OPS: cli.PATCH_OPS, PAYLOAD_KEYS: cli.PAYLOAD_KEYS, OP_FIELDS: cli.OP_FIELDS, main: cli.main, run: cli.run };

if (require.main === module) {
  process.exit(cli.main());
}
