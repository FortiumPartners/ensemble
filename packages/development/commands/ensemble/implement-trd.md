---
name: ensemble:implement-trd
description: Complete TRD implementation using git-town workflow with ensemble-orchestrator delegation and TDD methodology
version: 2.1.0
category: implementation
last-updated: 2026-05-27
model: medium
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

**2. Feature Branch Creation**
   Create sprint-1 feature branch using git-town skill interview template

   - Load interview template from packages/git/skills/git-town/templates/interview-branch-creation.md
   - Extract TRD slug from TRD filename (lowercase, hyphens replacing spaces/underscores)
   - Set CURRENT_SPRINT=1; set CURRENT_BRANCH=feature/<trd-slug>-sprint-1
   - Validate branch name against pattern - ^[a-z0-9-]+(/[a-z0-9-]+)*$
   - Set base_branch to main (or current default branch)
   - Execute - git-town hack feature/<trd-slug>-sprint-1 --parent <base-branch>
   - Verify branch creation successful (check git branch output)

**3. TRD Ingestion**
   Parse and analyze existing TRD document with checkbox tracking

**4. Technical Feasibility Review**
   Validate implementation approach and architecture

**5. Resource Assessment**
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

   - Run - git town propose --title "feat(<trd-slug>){{colon}} Sprint <CURRENT_SPRINT> implementation" --body "Sprint <CURRENT_SPRINT> of TRD complete. Stacked PR targeting <base_branch>."
   - Record PR URL output from git town propose as SPRINT_PR_MAP[CURRENT_SPRINT]
   - If more sprints remain - set NEXT_SPRINT=CURRENT_SPRINT+1; run git town hack feature/<trd-slug>-sprint-<NEXT_SPRINT> --parent feature/<trd-slug>-sprint-<CURRENT_SPRINT>; set CURRENT_BRANCH=feature/<trd-slug>-sprint-<NEXT_SPRINT>; set CURRENT_SPRINT=NEXT_SPRINT; continue to next sprint
   - If no more sprints - print stacked PR summary with all SPRINT_PR_MAP entries; implementation complete

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
