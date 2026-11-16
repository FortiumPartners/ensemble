// DO NOT EDIT - generated from packages/agent-core/src/run-index-core.ts by scripts/generate-run-index-lib.js (npm run generate)
"use strict";
/**
 * Shared, stage-agnostic run-index I/O primitives.
 *
 * Extracted from `new-feature/run-index.ts` (TRD-002) so a second,
 * independent run-index store (the issue workflow's `fix-issue/issue-run-index.ts`,
 * TRD-015) can reuse the same atomic-write, active-lock,
 * optimistic-concurrency `mutate()`, and corrupt-file-validation plumbing
 * without duplicating it (REQ-019). See the companion research doc's
 * Option C (docs/TRD/TRD-2026-87e64cc6-command-surface-consolidation-research.md):
 * only the stage-agnostic I/O primitives live here; each workflow keeps its
 * own public API, `Stage` union, and record shape in its own thin wrapper.
 *
 * Every primitive below is generic over a caller-supplied runs-dir
 * resolver (how to compute a project's run-file directory from its root)
 * and a record-shape validator (the caller's own `asserts`-style shape
 * check) -- this module knows nothing about `Stage`, `RunRecord`, or
 * `.ensemble/new-feature`; that stays in each workflow's own wrapper.
 *
 * Ports `packages/core/lib/refinement-review/session.js`'s proven
 * temp-file-then-`renameSync` atomic write plus `expectedRevision`/409-style
 * optimistic concurrency pattern. See
 * docs/TRD/TRD-2026-d6bbf322-new-feature-workflow.md (TRD-002, Component
 * Design's data contracts and failure paths) for the original design this
 * ports forward unchanged.
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
exports.isRevisionConflictError = isRevisionConflictError;
exports.makeRunIndexCorrupt = makeRunIndexCorrupt;
exports.isRunAlreadyActiveError = isRunAlreadyActiveError;
exports.runFilePath = runFilePath;
exports.writeRunAtomic = writeRunAtomic;
exports.readRunFile = readRunFile;
exports.listRunFiles = listRunFiles;
exports.acquireActiveLock = acquireActiveLock;
exports.releaseActiveLockIfOwned = releaseActiveLockIfOwned;
exports.mutateRecord = mutateRecord;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
function isRevisionConflictError(err) {
    return typeof err === "object" && err !== null && "code" in err && err.code === "REVISION_CONFLICT";
}
/**
 * Construct a `RUN_INDEX_CORRUPT` error. Exported so each caller's own
 * record-shape validator can throw the exact same error shape this core
 * throws internally on read/parse failure, keeping corrupt-file reporting
 * consistent across every workflow built on this core.
 */
function makeRunIndexCorrupt(filePath, reason) {
    return Object.assign(new Error(`run index corrupt at ${filePath}: ${reason}`), {
        code: "RUN_INDEX_CORRUPT",
        filePath,
        reason,
    });
}
function isRunAlreadyActiveError(err) {
    return typeof err === "object" && err !== null && "code" in err && err.code === "RUN_ALREADY_ACTIVE";
}
/** A run file's absolute path: `<runsDir(projectRoot)>/<runId>.json`. */
function runFilePath(runsDir, projectRoot, runId) {
    return path.join(runsDir(projectRoot), `${runId}.json`);
}
/**
 * Atomic JSON write: write to a temp file in the same directory, fsync,
 * then rename over the destination. A crash between `openSync` and
 * `renameSync` leaves the prior valid file intact and an orphaned `.tmp`
 * file -- never a partially written destination.
 */
function writeRunAtomic(filePath, value) {
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
    const data = JSON.stringify(value, null, 2);
    const fd = fs.openSync(tmp, "w");
    try {
        fs.writeSync(fd, data);
        fs.fsyncSync(fd);
    }
    finally {
        fs.closeSync(fd);
    }
    fs.renameSync(tmp, filePath);
}
/**
 * Read and validate a single run file using the caller-supplied
 * `validateShape`. Throws `RUN_INDEX_CORRUPT` on parse failure or shape
 * violation -- never falls back to directory-scan guessing.
 */
function readRunFile(filePath, validateShape) {
    let raw;
    try {
        raw = fs.readFileSync(filePath, "utf8");
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw makeRunIndexCorrupt(filePath, `cannot read file: ${message}`);
    }
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw makeRunIndexCorrupt(filePath, `invalid JSON: ${message}`);
    }
    validateShape(parsed, filePath);
    return parsed;
}
/** List every run file's absolute path under `runsDir(projectRoot)`, if any. */
function listRunFiles(runsDir, projectRoot) {
    const dir = runsDir(projectRoot);
    let entries;
    try {
        entries = fs.readdirSync(dir);
    }
    catch (err) {
        const isEnoent = typeof err === "object" && err !== null && "code" in err && err.code === "ENOENT";
        if (isEnoent)
            return [];
        throw err;
    }
    return entries
        .filter((name) => name.endsWith(".json") && !name.startsWith("."))
        .map((name) => path.join(dir, name));
}
/**
 * Acquire `active.lock` for a new run (REQ-008): write-exclusive create of
 * the lock file naming `runId`. Throws `RUN_ALREADY_ACTIVE` (naming the
 * existing run) on `EEXIST`, writing nothing.
 */
function acquireActiveLock(runsDir, projectRoot, runId) {
    const lockPath = path.join(runsDir(projectRoot), "active.lock");
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    try {
        fs.writeFileSync(lockPath, runId, { flag: "wx" });
    }
    catch (err) {
        const isEexist = typeof err === "object" && err !== null && "code" in err && err.code === "EEXIST";
        if (isEexist) {
            const existingRunId = fs.readFileSync(lockPath, "utf8").trim();
            throw Object.assign(new Error(`a run is already active for this project: ${existingRunId}`), {
                code: "RUN_ALREADY_ACTIVE",
                existingRunId,
            });
        }
        throw err;
    }
}
/**
 * Release `active.lock` if (and only if) it is currently held by `runId`.
 * Never removes a lock owned by a different run, and never removes it
 * based on elapsed time alone.
 */
function releaseActiveLockIfOwned(runsDir, projectRoot, runId) {
    const lockPath = path.join(runsDir(projectRoot), "active.lock");
    let owner;
    try {
        owner = fs.readFileSync(lockPath, "utf8").trim();
    }
    catch (err) {
        const isEnoent = typeof err === "object" && err !== null && "code" in err && err.code === "ENOENT";
        if (isEnoent)
            return;
        throw err;
    }
    if (owner === runId) {
        fs.unlinkSync(lockPath);
    }
}
/**
 * Mutate a run file through `updater`, persisting with optimistic
 * concurrency. `updater` receives the current record and mutates it in
 * place; `revision` is bumped by exactly 1 after `updater` returns --
 * `updater` must not touch `revision` itself.
 *
 * Throws `REVISION_CONFLICT` (`{ code, status: 409, currentRevision }`) on
 * a stale `expectedRevision`.
 */
function mutateRecord(filePath, expectedRevision, updater, validateShape) {
    const record = readRunFile(filePath, validateShape);
    if (record.revision !== expectedRevision) {
        throw Object.assign(new Error(`revision conflict (current ${record.revision})`), {
            code: "REVISION_CONFLICT",
            status: 409,
            currentRevision: record.revision,
        });
    }
    const preRevision = record.revision;
    updater(record);
    if (record.revision !== preRevision) {
        throw Object.assign(new Error("updater must not change revision; mutate() owns the +1 bump"), {
            code: "REVISION_TAMPERED",
            status: 400,
        });
    }
    record.revision = preRevision + 1;
    record.updatedAt = new Date().toISOString();
    writeRunAtomic(filePath, record);
    return record;
}
