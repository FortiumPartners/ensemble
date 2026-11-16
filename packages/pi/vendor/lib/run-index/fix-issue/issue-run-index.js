// DO NOT EDIT - generated from packages/agent-core/src/fix-issue/issue-run-index.ts by scripts/generate-run-index-lib.js (npm run generate)
"use strict";
/**
 * `IssueRunIndexStore`: atomic, concurrency-safe CRUD over project-local
 * `fix-issue` run records.
 *
 * Delegates its atomic-write, active-lock acquire/release, revision-conflict
 * mutate, and corrupt-file-validation I/O primitives to the shared,
 * stage-agnostic `../run-index-core.ts` (TRD-014), supplying this
 * workflow's own `.ensemble/fix-issue` runs-dir resolver and `IssueRunRecord`
 * shape validator as the generic parameters. This file's own public API,
 * `IssueStage`, and `IssueRunRecord` shape are independent from the feature
 * workflow's `RunIndexStore` (`../new-feature/run-index.ts`) -- a sibling
 * store, not a shared one (REQ-002, REQ-019). See
 * docs/TRD/TRD-2026-87e64cc6-command-surface-consolidation-data-model.md
 * (TRD-015) and the companion research doc's "Option C" rationale for the
 * full design.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.isRunAlreadyActiveError = exports.isRevisionConflictError = void 0;
exports.createRun = createRun;
exports.abandon = abandon;
exports.complete = complete;
exports.findActive = findActive;
exports.resolveByArtifact = resolveByArtifact;
exports.loadRun = loadRun;
exports.mutate = mutate;
const path = __importStar(require("path"));
const randomBytes = __importStar(require("crypto"));
const run_index_core_1 = require("../run-index-core");
Object.defineProperty(exports, "isRevisionConflictError", { enumerable: true, get: function () { return run_index_core_1.isRevisionConflictError; } });
Object.defineProperty(exports, "isRunAlreadyActiveError", { enumerable: true, get: function () { return run_index_core_1.isRunAlreadyActiveError; } });
const types_1 = require("./types");
const ISSUE_STAGE_MEMBERSHIP = Object.fromEntries(types_1.ISSUE_STAGE_ORDER.map((stage) => [stage, true]));
/**
 * Directory holding every `IssueRunRecord` JSON file for a given project --
 * its own, independent run-file directory, distinct from the feature
 * workflow's `.ensemble/new-feature` (REQ-019/AC-019-1).
 */
function runsDir(projectRoot) {
    return path.join(projectRoot, ".ensemble", "fix-issue");
}
/** An issue run file's absolute path. Shared by every call site below. */
function runFilePath(projectRoot, runId) {
    return (0, run_index_core_1.runFilePath)(runsDir, projectRoot, runId);
}
/**
 * Validate the shape of a value loaded from an issue run file. Throws
 * `RUN_INDEX_CORRUPT` on the first violation rather than letting a
 * partially-trusted object through.
 */
function validateIssueRunRecordShape(value, filePath) {
    if (typeof value !== "object" || value === null) {
        throw (0, run_index_core_1.makeRunIndexCorrupt)(filePath, "not a JSON object");
    }
    const r = value;
    const requiredStrings = ["runId", "projectRoot", "issueDescription", "createdAt", "updatedAt"];
    for (const key of requiredStrings) {
        if (typeof r[key] !== "string") {
            throw (0, run_index_core_1.makeRunIndexCorrupt)(filePath, `missing or non-string field "${key}"`);
        }
    }
    if (typeof r.stage !== "string" || !ISSUE_STAGE_MEMBERSHIP[r.stage]) {
        throw (0, run_index_core_1.makeRunIndexCorrupt)(filePath, `stage "${String(r.stage)}" is not in the fixed enum`);
    }
    if (r.status !== "active" && r.status !== "paused" && r.status !== "completed" && r.status !== "abandoned") {
        throw (0, run_index_core_1.makeRunIndexCorrupt)(filePath, `status "${String(r.status)}" is not in the fixed enum`);
    }
    if (typeof r.revision !== "number") {
        throw (0, run_index_core_1.makeRunIndexCorrupt)(filePath, "missing or non-number field \"revision\"");
    }
    if (typeof r.stageOutcome !== "object" || r.stageOutcome === null) {
        throw (0, run_index_core_1.makeRunIndexCorrupt)(filePath, "missing or non-object field \"stageOutcome\"");
    }
    if (!Array.isArray(r.artifacts)) {
        throw (0, run_index_core_1.makeRunIndexCorrupt)(filePath, "missing or non-array field \"artifacts\"");
    }
    if (!Array.isArray(r.beadRefs)) {
        throw (0, run_index_core_1.makeRunIndexCorrupt)(filePath, "missing or non-array field \"beadRefs\"");
    }
}
/**
 * Read and validate a single issue run file. Throws `RUN_INDEX_CORRUPT` on
 * parse failure or shape violation -- never falls back to directory-scan
 * guessing.
 */
function readRunFile(filePath) {
    return (0, run_index_core_1.readRunFile)(filePath, validateIssueRunRecordShape);
}
/**
 * Create a new run for `projectRoot` at stage `analysis_planning`. Enforces
 * single-active-run-per-project exclusivity (REQ-019/AC-019-1, mirroring
 * the feature store's own `.ensemble/fix-issue/active.lock`) independently
 * of the feature workflow's own `.ensemble/new-feature/active.lock` -- no
 * cross-store coupling.
 */
function createRun(projectRoot, issueDescription) {
    const runId = randomBytes.randomBytes(8).toString("hex");
    (0, run_index_core_1.acquireActiveLock)(runsDir, projectRoot, runId);
    const now = new Date().toISOString();
    const record = {
        runId,
        projectRoot,
        issueDescription,
        status: "active",
        stage: "analysis_planning",
        stageOutcome: { kind: "approval_wait", detail: "run created, stage not yet attempted", recordedAt: now },
        artifacts: [],
        beadRefs: [],
        prApprovedAt: null,
        revision: 0,
        createdAt: now,
        updatedAt: now,
    };
    (0, run_index_core_1.writeRunAtomic)(runFilePath(projectRoot, runId), record);
    return record;
}
/**
 * Mark `runId` abandoned (a terminal state) and release `active.lock`,
 * permitting a subsequent `createRun()` to succeed. The run's own `.json`
 * history file is never deleted.
 */
function abandon(projectRoot, runId, reason) {
    const updated = (0, run_index_core_1.mutateRecord)(runFilePath(projectRoot, runId), readRunFile(runFilePath(projectRoot, runId)).revision, (r) => {
        r.status = "abandoned";
        r.stageOutcome = { ...r.stageOutcome, detail: reason, recordedAt: new Date().toISOString() };
    }, validateIssueRunRecordShape);
    (0, run_index_core_1.releaseActiveLockIfOwned)(runsDir, projectRoot, runId);
    return updated;
}
/**
 * Mark `runId` completed (a terminal state) and release `active.lock`,
 * permitting a subsequent `createRun()` to succeed. The run's own `.json`
 * history file is never deleted.
 */
function complete(projectRoot, runId) {
    const updated = (0, run_index_core_1.mutateRecord)(runFilePath(projectRoot, runId), readRunFile(runFilePath(projectRoot, runId)).revision, (r) => {
        r.status = "completed";
    }, validateIssueRunRecordShape);
    (0, run_index_core_1.releaseActiveLockIfOwned)(runsDir, projectRoot, runId);
    return updated;
}
/**
 * Find the single active-or-paused run for a project, if any. Throws
 * `RUN_INDEX_CORRUPT` (does not skip) on any malformed run file it
 * encounters, even if it is not the one ultimately returned.
 */
function findActive(projectRoot) {
    const files = (0, run_index_core_1.listRunFiles)(runsDir, projectRoot);
    let found;
    for (const file of files) {
        const record = readRunFile(file);
        if (record.status === "active" || record.status === "paused")
            found = record;
    }
    return found;
}
/**
 * Find the run (if any) whose `artifacts[]` contains an entry with this
 * exact `path`. Returns `undefined` (not a thrown error) when no indexed
 * run references it.
 */
function resolveByArtifact(projectRoot, artifactPath) {
    const files = (0, run_index_core_1.listRunFiles)(runsDir, projectRoot);
    for (const file of files) {
        const record = readRunFile(file);
        if (record.artifacts.some((a) => a.path === artifactPath))
            return record;
    }
    return undefined;
}
/** Load a run by id. Throws `RUN_INDEX_CORRUPT` if missing or malformed. */
function loadRun(projectRoot, runId) {
    return readRunFile(runFilePath(projectRoot, runId));
}
/**
 * Mutate a run through `updater`, persisting with optimistic concurrency.
 * `updater` receives the current record and mutates it in place; `revision`
 * must not touch `revision` itself. Throws `REVISION_CONFLICT` (`{ code,
 * status: 409, currentRevision }`) on a stale `expectedRevision`, mirroring
 * the feature store's `mutate()`'s own contract.
 */
function mutate(projectRoot, runId, expectedRevision, updater) {
    return (0, run_index_core_1.mutateRecord)(runFilePath(projectRoot, runId), expectedRevision, updater, validateIssueRunRecordShape);
}
