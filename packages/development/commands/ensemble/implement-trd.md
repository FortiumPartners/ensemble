---
name: implement-trd
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
   Check git-town installation and configuration

   - Verify git-town is installed
   - Check repository is git-initialized
   - Validate git-town configuration
   - Ensure clean working directory

**2. Feature Branch Creation**
   Create feature branch using git town hack

   - Extract branch name from TRD filename
   - Execute git town hack feature/<branch-name>
   - Verify branch creation successful

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
/implement-trd
```
