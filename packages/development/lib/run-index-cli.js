#!/usr/bin/env node
'use strict';

/**
 * run-index-cli.js -- CLI over the new-feature run index (RunIndexStore, generated into
 * lib/run-index/new-feature/ from packages/agent-core/src/new-feature/run-index.ts).
 *
 * Usage: node run-index-cli.js <subcommand> < payload.json
 *
 *   create                { idea }                           start a run at prd_create
 *   create-from-artifact  { idea, artifact, startStage }     adopt an existing PRD; artifact is
 *                         { type, path, documentId, version, producingStage }
 *   resolve-by-artifact   { path }                           the run indexing that exact path, or null
 *   find-active           {}                                 the active/paused run, or null
 *   load                  { runId }
 *   abandon               { runId, reason? }                 terminal; releases active.lock
 *   complete              { runId }                          terminal; releases active.lock
 *   mutate                { runId, expectedRevision, patch[] }  one revision-checked write
 *
 * Every payload may carry `projectRoot` (default: the git toplevel of the cwd, else the cwd).
 * Output is one JSON object: {ok:true, run} or {ok:false, code, message, ...}; see
 * run-index-cli-core.js for the codes, the exit-code rule and the path guards.
 *
 * Patch ops (applied in order; the CLI stamps every timestamp):
 *   {op:"setStage", stage}                  prd_create .. done (the store's Stage enum)
 *   {op:"setStageOutcome", kind?, detail?}  kind: success | decline | failure | approval_wait;
 *                                           an omitted kind keeps the current one
 *   {op:"appendArtifact", type, path, documentId, version, producingStage}   type: prd | trd
 *   {op:"appendBeadRef", ref}               bead id or "pr:<url>"; skipped when already present
 *   {op:"setImplementationApprovedAt", value}   "now" | null
 *   {op:"setPrApprovedAt", value}               "now" | null
 */

const store = require('./run-index/new-feature/run-index');
const { STAGE_ORDER } = require('./run-index/new-feature/types');
const { createCli, requireText, checkArtifactPath, invalid } = require('./run-index-cli-core');

const ARTIFACT_TYPES = ['prd', 'trd'];

const cli = createCli({
  name: 'run-index-cli.js',
  runsRel: '.ensemble/new-feature',
  store,
  stages: STAGE_ORDER,
  create: { field: 'idea' },
  extraOps: ['setImplementationApprovedAt'],
  hasArtifactLookup: true,
  artifactFields: ['type', 'path', 'documentId', 'version', 'producingStage'],
  artifact: (op, root, at) => {
    if (!ARTIFACT_TYPES.includes(op.type)) throw invalid(`${at}.type must be one of ${ARTIFACT_TYPES.join(', ')}`);
    if (!STAGE_ORDER.includes(op.producingStage)) throw invalid(`${at}.producingStage must be one of ${STAGE_ORDER.join(', ')}`);
    return {
      type: op.type,
      path: checkArtifactPath(op.path, root, `${at}.path`),
      documentId: requireText(op.documentId, `${at}.documentId`),
      version: requireText(op.version, `${at}.version`),
      producingStage: op.producingStage,
    };
  },
});

module.exports = { SUBCOMMANDS: cli.SUBCOMMANDS, PATCH_OPS: cli.PATCH_OPS, PAYLOAD_KEYS: cli.PAYLOAD_KEYS, OP_FIELDS: cli.OP_FIELDS, main: cli.main, run: cli.run };

if (require.main === module) {
  process.exit(cli.main());
}
