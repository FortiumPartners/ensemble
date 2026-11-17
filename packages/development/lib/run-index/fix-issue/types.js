// DO NOT EDIT - generated from packages/agent-core/src/fix-issue/types.ts by scripts/generate-run-index-lib.js (npm run generate)
"use strict";
/**
 * Types for the `fix-issue` workflow's run index.
 *
 * See docs/TRD/TRD-2026-87e64cc6-command-surface-consolidation-data-model.md
 * (TRD-015, "IssueRunRecord"/"IssueArtifactRef") for the authoritative shape
 * this file implements. Structurally parallel to, but never joined with,
 * `new-feature/types.ts`'s `RunRecord` -- an issue run never references or
 * is referenced by a feature run (REQ-002).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ISSUE_STAGE_ORDER = void 0;
/** Fixed stage order; index N+1 is the only legal successor of index N. */
exports.ISSUE_STAGE_ORDER = [
    "analysis_planning",
    "execution",
    "validation_delivery",
    "done",
];
