---
document_id: PRD-2026-022
version: 1.0.0
status: Draft
date: 2026-06-01
scale_depth: LIGHT
total_requirements: 8
readiness_score: 4.75
---

# PRD-2026-022: TRD Staleness Gate

## PRD Health Summary

| Metric | Value |
|--------|-------|
| Must requirements | 7 |
| Should requirements | 1 |
| Could requirements | 0 |
| Won't requirements | 0 |
| AC coverage | 8/8 (100%) |
| Risk flags | 1 |
| Cross-requirement dependencies | 4 |

## Product Summary

**Problem:** Developers and AI agents invoke `implement-trd` (and its flavors) against TRD files that have grown stale — either because time has passed since the TRD was last reviewed, or because source files have changed in ways that affect requirements. The result is implementation work built on outdated specifications.

**Solution:** A mandatory staleness gate added to the Preflight phase of all `implement-trd` flavors. On first invocation, the gate checks two conditions: TRD age > 24 hours, and whether any source file in the worktree is newer than the TRD. If either condition is true, `refine-trd` runs automatically before implementation begins. If refinement fails, the command halts with a hard stop.

**Value proposition:** No implementation ever starts against a stale TRD.

**Target users:** Developers and AI agents running `implement-trd`, `implement-trd-beads`, or `beads-build --trd`.

**Known limitation:** `git clone`, `git checkout`, and `git pull` reset all file mtimes to the current time. A freshly-cloned repo where the TRD content is months old will appear "fresh" to the mtime-based check. This is a best-effort guard for ongoing work; it cannot detect staleness introduced by checking out an old branch in a fresh environment.

## Goals and Non-Goals

**Goals:**
- Prevent implementation from starting against any TRD older than 24 hours
- Prevent implementation from starting when source files have changed since the TRD was last updated
- Apply consistently across all three `implement-trd` flavors
- Hard-stop (no bypass flag) — enforcement is mandatory

**Non-Goals:**
- Content-aware staleness detection (semantic diff of TRD vs codebase)
- Configurable age thresholds (24h is hardcoded in this release)
- Detection of staleness introduced by fresh git clone/checkout (known limitation)
- Bypass or skip flag

---

## Requirements

### Staleness Detection

#### REQ-001: Age-Based Staleness Detection
**Priority:** Must | **Complexity:** Low

The staleness gate triggers when the TRD file's last-modified time (mtime) is more than 24 hours before the current system time at the moment the command is invoked.

- **AC-001-1:** Given a TRD file whose mtime is more than 24 hours before the current system time, when any `implement-trd` flavor is invoked on a first invocation, then the staleness gate triggers before any git operations or scaffold creation begins.
- **AC-001-2:** Given a TRD file whose mtime is less than 24 hours old and no source files are newer than the TRD, when any `implement-trd` flavor is invoked, then the staleness gate does not trigger and implementation proceeds normally.

#### REQ-002: Content-Drift Staleness Detection
**Priority:** Must | **Complexity:** Medium | [RISK: exclusion list must be maintained as new generated paths are added]

The staleness gate also triggers when any source file in the worktree has an mtime newer than the TRD file, even if the TRD itself is less than 24 hours old.

"Source files" are determined by running `git ls-files` (tracked files) and filtering out:
- All paths matching `.gitignore` patterns (covers `dist/`, `build/`, `node_modules/`, `coverage/`, `.beads.bd/`, `.bv/`, `.ntm/`, `.opencode/`, `.dolt/`, etc.)
- `packages/*/commands/ensemble/` (generated markdown)
- `packages/pi/prompts/` (generated pi prompts)
- `packages/codex/.codex/` (generated codex skills)
- Any path containing `/dist/` or `/build/` as a path segment

- **AC-002-1:** Given a TRD file where one or more source files (after exclusion filtering) have mtime newer than the TRD mtime, when any `implement-trd` flavor is invoked fresh, then the staleness gate triggers even if the TRD itself is less than 24 hours old.
- **AC-002-2:** Given the only files newer than the TRD are in `dist/`, `.beads.bd/`, `packages/*/commands/ensemble/`, `packages/pi/prompts/`, or `packages/codex/.codex/`, when any `implement-trd` flavor is invoked, then the staleness gate does NOT trigger.

### Staleness Gate Behavior

#### REQ-003: Auto-Invoke refine-trd on Stale Detection
**Priority:** Must | **Complexity:** Medium

When the staleness gate triggers on first invocation, the command halts its normal flow, prints a clear message identifying which condition was met, and automatically invokes `refine-trd` on the TRD file before proceeding.

- **AC-003-1:** Given a stale TRD is detected (either condition), when the gate triggers, then the command prints a message stating the triggering condition (e.g., "TRD is 36 hours old — running refine-trd before implementation" or "3 source files are newer than the TRD: src/foo.ts, src/bar.ts, src/baz.ts — running refine-trd") and invokes `refine-trd` automatically.
- **AC-003-2:** Given the staleness gate triggers, when the message is printed, then it lists up to 10 of the newer source files by path (if the drift condition was met) so the user understands what changed.

#### REQ-004: Proceed After Successful Refinement
**Priority:** Must | **Complexity:** Low

If `refine-trd` completes successfully, the command proceeds to implementation from its normal starting point without re-running the staleness check.

- **AC-004-1:** Given `refine-trd` exits successfully (exit code 0), when it finishes, then the `implement-trd` command continues from its first normal preflight step (git-town verification, TRD validation, etc.) as if freshly invoked — without re-running the staleness check.

#### REQ-005: Hard Stop on Refinement Failure
**Priority:** Must | **Complexity:** Low

If `refine-trd` exits with an error or exception, the `implement-trd` command halts immediately. No implementation work begins. The user must fix the TRD manually and re-run.

- **AC-005-1:** Given `refine-trd` exits with a non-zero exit code or throws an unhandled exception, when the error occurs, then the command prints "TRD refinement failed. Fix the TRD manually and re-run." and exits without creating any branches, beads, or implementation artifacts.

#### REQ-006: Skip Staleness Check on Resume
**Priority:** Must | **Complexity:** Low

The staleness check runs only on first invocation. On resume, it is skipped entirely.

Resume is detected as follows per flavor:
- `implement-trd-beads`: existing root epic bead found (ROOT_EPIC_ID present in `br list`)
- `implement-trd`: feature branch `feature/<TRD_SLUG>-sprint-1` already exists (`git branch --list` returns a match)
- `beads-build --trd`: root epic for the TRD slug already exists in the beads store

- **AC-006-1:** Given an existing bead scaffold (root epic present) is detected for `implement-trd-beads` or `beads-build --trd`, when the command is invoked, then the staleness gate step is skipped entirely and implementation resumes from the next appropriate step.
- **AC-006-2:** Given the feature branch `feature/<TRD_SLUG>-sprint-1` already exists for `implement-trd`, when the command is invoked, then the staleness gate step is skipped and implementation resumes normally.

### Coverage

#### REQ-007: Apply Gate to All implement-trd Flavors
**Priority:** Must | **Complexity:** Low

The staleness gate is added to the Preflight phase of all three flavors: `implement-trd`, `implement-trd-beads`, and `beads-build` (when `--trd` flag is provided and `TRD_MODE=true`).

- **AC-007-1:** Given `beads-build --trd <path>` is invoked with no existing root epic, when the command starts, then the staleness gate runs on the specified TRD before any scaffold is created.
- **AC-007-2:** Given `beads-build --trd <path>` is invoked and a root epic for the TRD slug already exists, when the command starts, then the staleness gate step is skipped and implementation proceeds directly.

### Observability

#### REQ-008: Staleness Message Identifies Condition and Affected Files
**Priority:** Should | **Complexity:** Low

The staleness gate message clearly identifies which condition triggered (age vs. content drift) and, for content drift, lists the newer source files so the user understands what changed.

- **AC-008-1:** Given the age condition triggered, when the message is printed, then it states the TRD age in hours (e.g., "TRD is 36h old, threshold is 24h").
- **AC-008-2:** Given the content-drift condition triggered, when the message is printed, then it lists up to 10 newer source file paths and the total count if more than 10 exist (e.g., "14 source files are newer than the TRD. Showing first 10: ...").

---

## Acceptance Criteria Summary

| REQ | Description | Priority | Complexity | AC Count |
|-----|-------------|----------|------------|----------|
| REQ-001 | Age-based staleness detection (>24h) | Must | Low | 2 |
| REQ-002 | Content-drift staleness (newer source files) | Must | Medium | 2 |
| REQ-003 | Auto-invoke refine-trd on stale detection | Must | Medium | 2 |
| REQ-004 | Proceed after successful refinement | Must | Low | 1 |
| REQ-005 | Hard stop on refinement failure | Must | Low | 1 |
| REQ-006 | Skip staleness check on resume | Must | Low | 2 |
| REQ-007 | Apply gate to all three flavors | Must | Low | 2 |
| REQ-008 | Staleness message identifies condition + files | Should | Low | 2 |

---

## Dependency Map

- REQ-003 depends on REQ-001 and REQ-002 (gate behavior requires detection to be defined)
- REQ-004 depends on REQ-003 (success path follows auto-invocation)
- REQ-005 depends on REQ-003 (failure path follows auto-invocation)
- REQ-006 is a modifier on REQ-001/REQ-002/REQ-003 (resume skips all three)
- REQ-007 depends on REQ-001 through REQ-006 (coverage is a cross-cutting concern)
- REQ-008 depends on REQ-003 (message content is part of gate invocation)

**Implementation cluster:** REQ-001 + REQ-002 + REQ-003 + REQ-006 must be implemented together as a single Preflight step in each command. REQ-004, REQ-005, and REQ-008 are additive to that step.

---

## Implementation Readiness Scorecard

| Dimension | Score | Notes |
|-----------|-------|-------|
| Completeness | 5.0 | All 3 flavors, both staleness signals, resume, success/failure paths covered |
| Testability | 4.5 | All Must ACs are Given/When/Then; exclusion list is explicitly enumerated |
| Clarity | 4.5 | Preflight insertion point and resume detection signal specified per flavor |
| Feasibility | 5.0 | Uses `git ls-files` + mtime — no new runtime dependencies |
| **Overall** | **4.75** | **PASS — ready for TRD handoff** |
