---
document_id: TRD-2026-023
prd_reference: docs/PRD/PRD-2026-022-trd-staleness-gate.md
version: 1.0.0
status: Draft
date: 2026-06-01
design_readiness_score: 4.63
---

# TRD-2026-023: TRD Staleness Gate

Based on PRD: docs/PRD/PRD-2026-022-trd-staleness-gate.md

---

## Architecture Decision

**Chosen approach: Option B — Shared Skill + Thin Reference Steps**

A new skill file `packages/development/skills/staleness-gate/SKILL.md` defines the canonical staleness detection algorithm (mtime age check, source file drift check, `refine-trd` invocation, success/failure paths, resume skip logic). Each of the three `implement-trd` flavors adds a single thin Preflight step that supplies its flavor-specific IS_RESUME signal and delegates to the skill for all logic.

**Why Option B over alternatives:**
- Option A (full inline per command) would duplicate ~40 lines of action items across 3 files, creating drift risk as the exclusion list evolves.
- Option C (inline on beads, abbreviated references) creates an asymmetry where two commands depend on a third for their full algorithm.
- Option B keeps each command self-describing (the Preflight step says exactly what it does and where to find the algorithm) while making the algorithm a single-edit update path.

**Alternatives considered:**
- Option A: full inline duplication per command — rejected (maintenance burden)
- Option C: full inline on beads, cross-references on others — rejected (asymmetric documentation)

---

## System Architecture

### Components

```
packages/development/skills/staleness-gate/
└── SKILL.md                          ← canonical staleness gate algorithm

packages/development/commands/
├── implement-trd-beads.yaml          ← Preflight step 7 added (new); steps 7-11 → 8-12
├── implement-trd.yaml                ← Preflight step 2 added (new); steps 2-5 → 3-6
└── beads-build.yaml                  ← Preflight step 6 added (new); steps 6-7 → 7-8
```

### Data Flow

```
$ARGUMENTS (TRD_PATH)
      │
      ▼
Each command's new Preflight step
      │
      ├─── IS_RESUME? ─────yes──→ SKIP (print "skipped: resume")
      │
      no
      │
      ▼
SKILL.md: staleness-gate
      │
      ├── stat TRD_PATH → TRD_MTIME
      ├── Check age: (NOW - TRD_MTIME) > 86400s → STALE_AGE
      ├── git ls-files | filter exclusions | mtime > TRD_MTIME → NEWER_FILES
      │
      ├─── Not stale ──→ RETURN (continue to next preflight step)
      │
      └─── Stale ──→ print message + invoke /ensemble:refine-trd <TRD_PATH>
                          │
                          ├── exit 0 ──→ RETURN (proceed without re-check)
                          └── exit ≠0 ──→ HALT ("Fix TRD manually and re-run")
```

### Resume Detection Signals per Flavor

| Flavor | IS_RESUME = true when |
|--------|----------------------|
| `implement-trd-beads` | ROOT_EPIC_ID found in `br list --json` for this TRD slug (Preflight step 6) |
| `implement-trd` | `git branch --list feature/<TRD_SLUG>-sprint-1` returns a match (checked before branch creation) |
| `beads-build --trd` | ROOT_EPIC_ID found in Epic Discovery step (Preflight step 4) |

### Source File Exclusion List (REQ-002)

Files excluded from the drift check — these do not signal staleness:
- All paths matching `.gitignore` (via `git ls-files --exclude-standard`): covers `dist/`, `build/`, `node_modules/`, `coverage/`, `.beads.bd/`, `.bv/`, `.ntm/`, `.opencode/`, `.dolt/`
- `packages/*/commands/ensemble/` — generated markdown command files
- `packages/pi/prompts/` — generated pi prompt files
- `packages/codex/.codex/` — generated codex skill files

### Integration Points

- **`/ensemble:refine-trd`**: invoked as a sub-command when staleness detected; exit code 0 = success, non-zero = failure
- **`git ls-files --exclude-standard`**: lists tracked source files respecting `.gitignore`
- **`stat`**: platform-aware mtime retrieval (macOS: `stat -f %m`; Linux: `stat -c %Y`; fallback: `python3 -c "import os; print(int(os.path.getmtime(...)))"`)

### Known Limitation

File mtimes reset to current time after `git clone`, `git checkout`, or `git pull`. A freshly-checked-out repo cannot detect semantic staleness introduced by checking out an old branch. This is documented in the PRD non-goals and in the SKILL.md.

---

## Master Task List

### PR 1: Staleness Gate Skill

**Shippable State:** The canonical staleness gate algorithm is documented in a standalone skill file that can be referenced by any command and manually applied; the algorithm itself is reviewable and testable in isolation.

- [ ] **TRD-001**: Create `packages/development/skills/staleness-gate/SKILL.md` with the full staleness gate algorithm (2h) [satisfies REQ-001] [satisfies REQ-002] [satisfies REQ-003] [satisfies REQ-004] [satisfies REQ-005] [satisfies REQ-006] [satisfies REQ-008]
  - Target File: `packages/development/skills/staleness-gate/SKILL.md`
  - Actions:
    1. Create directory `packages/development/skills/staleness-gate/`
    2. Write `SKILL.md` with the following canonical content:
       - **Inputs table**: TRD_PATH, IS_RESUME (boolean), FLAVOR (string for messages)
       - **Resume Detection by Flavor table** (all three flavors)
       - **Step 1 — Resume Check**: if IS_RESUME=true → print "Staleness check: skipped (resume detected)" and RETURN
       - **Step 2 — Get TRD mtime**: `TRD_MTIME=$(stat -f %m "<TRD_PATH>")` (macOS) OR `TRD_MTIME=$(stat -c %Y "<TRD_PATH>")` (Linux) OR `python3 -c "import os; print(int(os.path.getmtime('<TRD_PATH>')))"` (fallback); on failure → print "WARNING: Cannot determine TRD file age — skipping staleness check." and RETURN
       - **Step 3 — Age Check**: `CURRENT_TIME=$(date +%s); AGE_SECONDS=$((CURRENT_TIME - TRD_MTIME)); AGE_HOURS=$((AGE_SECONDS / 3600)); if AGE_HOURS > 24 → STALE=true, STALE_REASON=age`
       - **Step 4 — Source File Drift Check**: `git ls-files --exclude-standard | grep -vE "^packages/[^/]+/commands/ensemble/|^packages/pi/prompts/|^packages/codex/\.codex/"` → for each file get mtime → collect NEWER_FILES where file_mtime > TRD_MTIME; if NEWER_FILES non-empty and not already stale → STALE=true, STALE_REASON=drift
       - **Step 5 — Gate Decision**: if STALE=false → print "Staleness check: TRD is current" and RETURN; if STALE=true and STALE_REASON=age → print "STALENESS GATE: TRD is ${AGE_HOURS}h old (threshold: 24h). Running /ensemble:refine-trd before implementation." and invoke `/ensemble:refine-trd <TRD_PATH>`; if STALE=true and STALE_REASON=drift → print "STALENESS GATE: ${NEWER_COUNT} source files are newer than the TRD." + list up to 10 file paths (show count if >10) + "Running /ensemble:refine-trd before implementation." and invoke `/ensemble:refine-trd <TRD_PATH>`
       - **Step 6 — Post-Refinement Decision**: if refine-trd exits 0 → print "Staleness gate satisfied — TRD refreshed. Proceeding with implementation." and RETURN (no re-check); if refine-trd exits non-zero → print "STALENESS GATE FAILURE: TRD refinement failed. Fix the TRD manually and re-run." and HALT
       - **Known Limitation section**: document mtime reset on git clone/checkout/pull
  - Implementation AC:
    - Given IS_RESUME=true, when the skill runs, then it returns immediately without performing any mtime checks
    - Given TRD is 36h old with no newer source files, when the skill runs, then it prints the age message and invokes refine-trd
    - Given refine-trd exits 0, when post-refinement decision runs, then implementation proceeds without a second staleness check
    - Given refine-trd exits non-zero, when post-refinement decision runs, then HALT is reached with the correct error message

- [ ] **TRD-001-TEST**: Verify SKILL.md documents all required behaviors with complete accuracy (1h) [verifies TRD-001] [satisfies REQ-001] [satisfies REQ-002] [satisfies REQ-003] [satisfies REQ-004] [satisfies REQ-005] [satisfies REQ-006] [satisfies REQ-008] [depends: TRD-001]
  - Target Files: `packages/development/skills/staleness-gate/SKILL.md`
  - Actions:
    1. Read the SKILL.md and verify: (a) all 6 algorithm steps are present, (b) both platform-specific stat variants documented, (c) exclusion list matches PRD REQ-002 exactly, (d) NEWER_FILES truncation at 10 entries specified, (e) post-refinement no-recheck is explicit, (f) Known Limitation section present
    2. Verify Given/When/Then format on all Implementation AC items
    3. Verify resume detection table covers all 3 flavors
  - Test AC:
    - Given the SKILL.md, when each REQ (001-006, 008) is checked against the document, then every AC from the PRD has a corresponding documented behavior
    - Given the exclusion list in SKILL.md, when compared to PRD REQ-002's list, then all excluded path patterns are present and correct
  - Proof of requirement: All 14 ACs from PRD-2026-022 map to documented SKILL.md behaviors

### PR 2: Command Integration

**Shippable State:** All three `implement-trd` flavors enforce the staleness gate on first invocation — no implementation starts against a TRD older than 24 hours or with newer source files; resume paths are unaffected.

- [ ] **TRD-002**: Add TRD Staleness Gate step to `implement-trd-beads.yaml` Preflight (2h) [satisfies REQ-007] [depends: TRD-001]
  - Target File: `packages/development/commands/implement-trd-beads.yaml`
  - Actions:
    1. Insert new Preflight step between current step 6 (Resume Detection) and current step 7 (Feature Branch Creation). The new step becomes order 7; renumber existing steps 7→8, 8→9, 9→10, 10→11, 11→12.
    2. New step content:
       ```yaml
       - order: 7
         title: TRD Staleness Gate
         description: |
           Check TRD freshness before committing to a feature branch. Skip on resume.
           Algorithm defined in packages/development/skills/staleness-gate/SKILL.md.
         actions:
           - "If resume was detected in Preflight step 6 (ROOT_EPIC_ID is set / IS_RESUME=true): skip this step — staleness check does not apply to resuming an existing scaffold. Print 'Staleness check: skipped (resume detected)' and continue to step 8."
           - "If first invocation (IS_RESUME=false / no ROOT_EPIC_ID found in step 6): execute the TRD Staleness Gate per packages/development/skills/staleness-gate/SKILL.md using TRD_PATH from Preflight step 4 and IS_RESUME=false."
           - "On HALT from skill: do not proceed. Implementation stops."
           - "On RETURN from skill (TRD fresh or successfully refined): continue to Preflight step 8 (Feature Branch Creation)."
       ```
    3. Update existing step numbers: change `order: 7` → `order: 8` through `order: 11` → `order: 12` for the five subsequent Preflight steps.
  - Implementation AC:
    - Given a stale TRD and first invocation, when Preflight step 7 runs, then the SKILL.md gate executes before any feature branch is created
    - Given a resume (ROOT_EPIC_ID set in step 6), when Preflight step 7 runs, then it prints the skip message and continues to step 8 without any file system checks

- [ ] **TRD-002-TEST**: Verify implement-trd-beads staleness step is correct, correctly numbered, and does not disturb existing step references (1h) [verifies TRD-002] [satisfies REQ-007] [depends: TRD-002]
  - Target File: `packages/development/commands/implement-trd-beads.yaml`
  - Actions:
    1. Parse Preflight steps; confirm new step order 7 exists with title "TRD Staleness Gate"
    2. Confirm Feature Branch Creation is now order 8 (was 7)
    3. Confirm Traceability Validation Gate is now order 12 (was 11)
    4. Confirm step 7 references `packages/development/skills/staleness-gate/SKILL.md`
    5. Confirm step 7 IS_RESUME condition references Preflight step 6 (Resume Detection)
    6. Run `npm run validate` — must exit 0
  - Test AC:
    - Given the updated YAML, when `npm run validate` runs, then it exits 0 with no schema errors
    - Given the Preflight step list, when step orders 1-12 are enumerated, then all are sequential with no gaps

- [ ] **TRD-003**: Add TRD Staleness Gate step to `implement-trd.yaml` Preflight (1h) [satisfies REQ-007] [depends: TRD-001]
  - Target File: `packages/development/commands/implement-trd.yaml`
  - Actions:
    1. Insert new Preflight step between current step 1 (Git Town Verification) and current step 2 (Feature Branch Creation). New step becomes order 2; renumber existing steps 2→3, 3→4, 4→5, 5→6.
    2. New step content:
       ```yaml
       - order: 2
         title: TRD Staleness Gate
         description: |
           Check TRD freshness before creating a feature branch. Skip if branch already exists (resume).
           Algorithm defined in packages/development/skills/staleness-gate/SKILL.md.
         actions:
           - "Derive TRD_PATH from $ARGUMENTS (the .md path argument)."
           - "Derive TRD_SLUG from TRD_PATH filename (lowercase, replace non-alphanumeric with hyphens)."
           - "Resume detection: run 'git branch --list feature/<TRD_SLUG>-sprint-1'. If this returns a branch name: IS_RESUME=true. If empty: IS_RESUME=false."
           - "Execute the TRD Staleness Gate per packages/development/skills/staleness-gate/SKILL.md using TRD_PATH and IS_RESUME."
           - "On HALT from skill: do not proceed. Implementation stops."
           - "On RETURN from skill: continue to step 3 (Feature Branch Creation)."
       ```
    3. Update existing step numbers: `order: 2` → `order: 3` through `order: 5` → `order: 6`.
  - Implementation AC:
    - Given a stale TRD and no existing feature branch, when Preflight step 2 runs, then the gate executes before `git town hack` creates any branch
    - Given the feature branch `feature/<TRD_SLUG>-sprint-1` already exists, when Preflight step 2 runs, then IS_RESUME=true and the gate is skipped

- [ ] **TRD-003-TEST**: Verify implement-trd staleness step is correct and correctly numbered (0.5h) [verifies TRD-003] [satisfies REQ-007] [depends: TRD-003]
  - Target File: `packages/development/commands/implement-trd.yaml`
  - Actions:
    1. Confirm new step order 2 with title "TRD Staleness Gate" exists
    2. Confirm Feature Branch Creation is now order 3 (was 2)
    3. Confirm Resource Assessment is now order 6 (was 5)
    4. Confirm step 2 derives TRD_SLUG and checks `git branch --list` for resume detection
    5. Run `npm run validate` — must exit 0
  - Test AC:
    - Given the updated YAML, when `npm run validate` runs, then it exits 0
    - Given the Preflight steps, when steps 1-6 are enumerated, then all are sequential with no gaps

- [ ] **TRD-004**: Add TRD Staleness Gate step to `beads-build.yaml` Preflight (1h) [satisfies REQ-007] [depends: TRD-001]
  - Target File: `packages/development/commands/beads-build.yaml`
  - Actions:
    1. Insert new Preflight step between current step 5 (TRD Augmentation Setup) and current step 6 (Strategy Detection). New step becomes order 6; renumber existing steps 6→7, 7→8.
    2. New step content:
       ```yaml
       - order: 6
         title: TRD Staleness Gate
         description: |
           When TRD_MODE=true and first invocation, check TRD freshness before execution begins.
           Skip when TRD_MODE=false or when resuming an existing epic.
           Algorithm defined in packages/development/skills/staleness-gate/SKILL.md.
         actions:
           - "If TRD_MODE=false: skip this step entirely. Print 'Staleness check: skipped (no --trd flag)' and continue to step 7."
           - "If TRD_MODE=true AND ROOT_EPIC_ID was found in Preflight step 4 (Epic Discovery) — IS_RESUME=true: skip this step. Print 'Staleness check: skipped (resume detected)' and continue to step 7."
           - "If TRD_MODE=true AND no ROOT_EPIC_ID found in step 4 (first invocation): execute the TRD Staleness Gate per packages/development/skills/staleness-gate/SKILL.md using TRD_PATH from Preflight step 1 and IS_RESUME=false."
           - "On HALT from skill: do not proceed. Implementation stops."
           - "On RETURN from skill: continue to step 7 (Strategy Detection)."
       ```
    3. Update existing step numbers: `order: 6` → `order: 7` and `order: 7` → `order: 8`.
  - Implementation AC:
    - Given `beads-build` invoked without `--trd`, when Preflight step 6 runs, then it prints the no-trd skip message and continues
    - Given `beads-build --trd <stale-trd>` with no existing root epic, when Preflight step 6 runs, then the staleness gate executes before any execution begins

- [ ] **TRD-004-TEST**: Verify beads-build staleness step is correct and correctly numbered (0.5h) [verifies TRD-004] [satisfies REQ-007] [depends: TRD-004]
  - Target File: `packages/development/commands/beads-build.yaml`
  - Actions:
    1. Confirm new step order 6 with title "TRD Staleness Gate" exists
    2. Confirm Strategy Detection is now order 7 (was 6)
    3. Confirm Team Configuration Detection is now order 8 (was 7)
    4. Confirm step 6 handles TRD_MODE=false and resume cases explicitly
    5. Run `npm run validate` — must exit 0
  - Test AC:
    - Given the updated YAML, when `npm run validate` runs, then it exits 0
    - Given the Preflight steps, when steps 1-8 are enumerated, then all are sequential with no gaps

- [ ] **TRD-005**: Regenerate all downstream artifacts (0.5h) [satisfies INFRA] [depends: TRD-002] [depends: TRD-003] [depends: TRD-004]
  - Target Files: all generated `.md`, pi, codex artifacts
  - Actions:
    1. Run `npm run generate` — must exit 0
    2. Run `npm run validate` — must exit 0
    3. Run `npm run generate:pi`
    4. Run `npm run generate:codex`
    5. Stage and commit all changed artifacts
  - Implementation AC:
    - Given all three command YAMLs updated, when `npm run generate && npm run validate` runs, then both exit 0 and no new schema errors are introduced

---

## Sprint Planning

### Sprint 1 (PR 1 + PR 2 — single sprint, ~9.5h total)

PR 1 can be reviewed independently (skill file only). PR 2 depends on PR 1 merging. Both fit within a single sprint given the bounded scope.

- **PR 1 tasks** (3h): TRD-001, TRD-001-TEST
- **PR 2 tasks** (6.5h): TRD-002, TRD-002-TEST, TRD-003, TRD-003-TEST, TRD-004, TRD-004-TEST, TRD-005

TRD-002, TRD-003, TRD-004 can execute in parallel after TRD-001 merges (no file conflicts between the three command YAMLs).

---

## Acceptance Criteria Traceability

| REQ | Description | Implementation Tasks | Test Tasks |
|-----|-------------|---------------------|------------|
| REQ-001 | Age-based staleness detection (>24h) | TRD-001 | TRD-001-TEST |
| REQ-002 | Content-drift staleness (newer source files) | TRD-001 | TRD-001-TEST |
| REQ-003 | Auto-invoke refine-trd on stale detection | TRD-001 | TRD-001-TEST |
| REQ-004 | Proceed after successful refinement | TRD-001 | TRD-001-TEST |
| REQ-005 | Hard stop on refinement failure | TRD-001 | TRD-001-TEST |
| REQ-006 | Skip staleness check on resume | TRD-001 | TRD-001-TEST |
| REQ-007 | Apply gate to all three flavors | TRD-002, TRD-003, TRD-004 | TRD-002-TEST, TRD-003-TEST, TRD-004-TEST |
| REQ-008 | Message identifies condition + files | TRD-001 | TRD-001-TEST |

---

## Team Configuration

> Auto-configured by `/ensemble:configure-team` on 2026-06-01
>
> **Complexity metrics:** tasks=9 | estimated_hours=9.5 | domains=2 (documentation, testing) | cross_cutting=1 | dependency_depth=3 | tier=**Medium**
>
> Medium tier: lead + builder roles only (no reviewer or QA — add manually if desired).

```yaml
team:
  roles:
    - name: lead
      agent: tech-lead-orchestrator
      owns:
        - task-selection
        - architecture-review
        - final-approval
    - name: builder
      agents:
        - documentation-specialist
        - backend-developer
      owns:
        - implementation
```

---

## Quality Requirements

### Testing Standards
- `npm run validate` must exit 0 after each YAML edit (step numbering is schema-validated)
- Test tasks verify both the skill content (TRD-001-TEST) and the command integration (TRD-002/3/4-TEST)

### Compatibility
- No changes to existing Preflight step logic — only insertions + renumbering
- All resume paths explicitly preserved per flavor
- Cross-session resume unaffected (staleness step is skipped on resume for all three flavors)

### Known Limitation (from PRD)
Git mtime reset on clone/checkout is accepted and documented. Semantic staleness detection is out of scope for this release.

---

## Design Readiness Scorecard

| Dimension | Score | Notes |
|-----------|-------|-------|
| Architecture completeness | 4.5 | All components, interfaces, data flows defined; platform-specific stat noted; mtime fallback documented |
| Task coverage | 4.5 | All 8 REQs covered; all 5 impl tasks have paired test tasks; INFRA task for regen included |
| Dependency clarity | 5.0 | Clean 2-level tree: TRD-001 → {TRD-002, TRD-003, TRD-004} → TRD-005; no cycles |
| Estimate confidence | 4.5 | Well-scoped YAML edits; TRD-002 (beads renumbering 7→12) is most complex at 2h |
| **Overall** | **4.63** | **PASS — ready for implementation** |
