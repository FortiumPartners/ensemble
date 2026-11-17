// DO NOT EDIT - generated from packages/agent-core/src/new-feature/types.ts by scripts/generate-run-index-lib.js (npm run generate)
"use strict";
/**
 * Types for the `new-feature` orchestrating workflow's run index.
 *
 * See docs/TRD/TRD-2026-d6bbf322-new-feature-workflow.md (TRD-001, Component
 * Design's data contracts) for the authoritative shape this file implements.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.STAGE_ORDER = void 0;
/** Fixed stage order; index N+1 is the only legal successor of index N. */
exports.STAGE_ORDER = [
    "prd_create",
    "prd_refine",
    "trd_create",
    "trd_refine",
    "beads_plan",
    "implementation_approval",
    "implementation",
    "pr_approval",
    "pr_create",
    "done",
];
