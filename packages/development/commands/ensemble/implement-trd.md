---
name: ensemble:implement-trd
description: Complete TRD implementation using git-town workflow with ensemble-orchestrator delegation and TDD methodology
version: 2.4.0
category: implementation
last-updated: 2026-06-05
model: claude-sonnet-4-6
---
<!-- DO NOT EDIT - Generated from implement-trd.yaml -->
<!-- To modify this file, edit the YAML source and run: npm run generate -->


This command implements a complete Technical Requirements Document (TRD) using modern
git-town feature branch workflow. It creates a feature branch and delegates to
ensemble-orchestrator which routes to tech-lead-orchestrator for structured TDD-based
development including planning, implementation, testing, and quality gates.

## Workflow

### Phase 1: Prerequisites & Feature Branch Setup

**1. Git Town Verification**
   Check git-town installation and configuration using validation script

   - Execute validation script - bash packages/git/skills/git-town/scripts/validate-git-town.sh
   - Handle exit codes - 0 (success), 1 (not installed), 2 (not configured), 3 (version mismatch), 4 (not git repo)
   - If validation fails, escalate with specific error message
   - Ensure clean working directory (git status)

**2. TRD Staleness Gate**
   Check TRD freshness before creating a feature branch. Skip if branch already exists (resume).
Algorithm defined in packages/development/skills/staleness-gate/SKILL.md.


   - Derive TRD_PATH from $ARGUMENTS (the .md path argument).
   - Derive TRD_SLUG from TRD_PATH filename (lowercase, replace non-alphanumeric with hyphens).
   - Resume detection: run 'git branch --list feature/<TRD_SLUG>-sprint-1'. If this returns a branch name: IS_RESUME=true. If empty: IS_RESUME=false.
   - Execute the TRD Staleness Gate per packages/development/skills/staleness-gate/SKILL.md using TRD_PATH and IS_RESUME.
   - On HALT from skill: do not proceed. Implementation stops.
   - On RETURN from skill: continue to step 3 (Feature Branch Creation).

**3. Feature Branch Creation**
   Create sprint-1 feature branch using git-town skill interview template

   - Load interview template from packages/git/skills/git-town/templates/interview-branch-creation.md
   - Extract TRD slug from TRD filename (lowercase, hyphens replacing spaces/underscores)
   - Read ENSEMBLE_USE_STACKED_PRS env var: STACKED_PRS=true only if its value equals 'true' (case-insensitive), else false (DEFAULT — single PR). Log: 'Stacked PRs: <enabled if STACKED_PRS else disabled (single PR)>'.
   - Set CURRENT_SPRINT=1. If STACKED_PRS=true: set CURRENT_BRANCH=feature/<trd-slug>-sprint-1. If STACKED_PRS=false: set CURRENT_BRANCH=feature/<trd-slug> (single branch for the whole TRD).
   - Validate branch name against pattern - ^[a-z0-9-]+(/[a-z0-9-]+)*$
   - Set base_branch to main (or current default branch)
   - Execute - git town hack <CURRENT_BRANCH> (creates the first branch off the default branch; fallback - git switch -c <CURRENT_BRANCH>)
   - Verify branch creation successful (check git branch output)

**4. TRD Ingestion**
   Parse and analyze existing TRD document with checkbox tracking

**5. Technical Feasibility Review**
   Validate implementation approach and architecture

**6. Resource Assessment**
   Identify required specialist agents and tools

### Phase 2: Ensemble Orchestrator Delegation

**1. Strategic Request Analysis**
   ensemble-orchestrator analyzes TRD requirements

   **Delegation:** @ensemble-orchestrator
   Complete TRD with task breakdown and acceptance criteria

**2. Development Project Classification**
   Identifies as development project requiring full methodology

**3. Tech Lead Orchestrator Delegation**
   Routes to tech-lead-orchestrator for development methodology

   **Delegation:** @tech-lead-orchestrator
   TRD implementation requirements with task tracking

### Phase 3: Progressive Implementation with TDD

**1. Planning & Architecture Validation**
   Validate TRD architecture against current system

**2. Task Status Assessment**
   Review completed work before proceeding

   - Check which tasks are already completed
   - Identify blockers and dependencies
   - Prioritize next tasks

**3. Test-Driven Implementation**
   Follow TDD Red-Green-Refactor cycle for all code

   - RED - Write failing tests first
   - GREEN - Implement minimal code to pass
   - REFACTOR - Improve code quality

**4. Quality Gates**
   Code review, security scanning, DoD enforcement

   **Delegation:** @code-reviewer
   Completed implementation requiring quality validation

**5. Sprint Review**
   Mark completed tasks and validate objectives

**6. Sprint PR Stacking**
   After quality gate passes, create a stacked PR for the current sprint and advance to the next sprint branch

   - Pre-PR test gate (runs before ANY PR creation, both modes): run 'npm run test --workspaces --if-present'. If exit code != 0: print 'ERROR: Local tests failed — PR creation blocked. Fix failing tests and re-run the sprint review to retry.' and HALT. If exit code == 0: print 'Pre-PR test gate: PASSED.'
   - If STACKED_PRS=true: run git town propose --title "feat(<trd-slug>){{colon}} Sprint <CURRENT_SPRINT> implementation" --body "Sprint <CURRENT_SPRINT> of TRD complete. Stacked PR targeting <base_branch>."; record PR URL as SPRINT_PR_MAP[CURRENT_SPRINT]
   - If STACKED_PRS=true AND more sprints remain: set NEXT_SPRINT=CURRENT_SPRINT+1; ensure currently on feature/<trd-slug>-sprint-<CURRENT_SPRINT> (git switch if needed); run git town append feature/<trd-slug>-sprint-<NEXT_SPRINT> (fallback - git switch -c feature/<trd-slug>-sprint-<NEXT_SPRINT>); set CURRENT_BRANCH=feature/<trd-slug>-sprint-<NEXT_SPRINT>; set CURRENT_SPRINT=NEXT_SPRINT; continue to next sprint
   - If STACKED_PRS=true AND no more sprints: print stacked PR summary with all SPRINT_PR_MAP entries; implementation complete
   - If STACKED_PRS=false: do NOT propose a PR or create a new branch per sprint. Stay on CURRENT_BRANCH=feature/<trd-slug> and continue to the next sprint's tasks. When NO more sprints remain: run git town propose --title "feat(<trd-slug>){{colon}} <trd-title>" --body "Implements TRD <trd-slug>. All sprints complete."; print 'Single PR created: <PR_URL>'; implementation complete

## Expected Output

**Format:** Implemented Features with Quality Gates and Stacked PRs

**Structure:**
- **Stacked Sprint PRs**: One git-town PR per sprint, each targeting the previous sprint's branch (Sprint 1 targets main)
- **Implementation Code**: Working code with tests (≥80% unit, ≥70% integration)
- **Quality Validation**: Code review passed, security scan clean, DoD met
- **Documentation**: Updated documentation including API docs and deployment notes

## Usage

```
/ensemble:implement-trd
```
