---
name: ensemble:implement-trd
description: Complete TRD implementation using git-town workflow with ensemble-orchestrator delegation and TDD methodology
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
   Create feature branch using git-town skill interview template

   - Load interview template from packages/git/skills/git-town/templates/interview-branch-creation.md
   - Extract branch name from TRD filename (format - feature/<trd-slug>)
   - Validate branch name against pattern - ^[a-z0-9-]+(/[a-z0-9-]+)*$
   - Set base_branch to main (or current default branch)
   - Execute - git-town hack <branch-name> --parent <base-branch>
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

## Expected Output

**Format:** Implemented Features with Quality Gates

**Structure:**
- **Feature Branch**: Git-town feature branch with all implementation commits
- **Implementation Code**: Working code with tests (≥80% unit, ≥70% integration)
- **Quality Validation**: Code review passed, security scan clean, DoD met
- **Documentation**: Updated documentation including API docs and deployment notes

## Usage

```
/ensemble:implement-trd
```
