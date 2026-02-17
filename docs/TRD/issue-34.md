# Technical Requirements Document: Lightweight Issue & Bug Fix Workflow

> **Document ID:** TRD-FIX-001
> **Version:** 1.0.0
> **Status:** Draft
> **Created:** 2026-02-16
> **Last Updated:** 2026-02-16
> **PRD Reference:** [/docs/PRD/issue-34.md](../PRD/issue-34.md)
> **Issue:** #34

---

## Table of Contents

1. [Document Overview](#document-overview)
2. [Master Task List](#master-task-list)
3. [System Architecture](#system-architecture)
4. [Component Specifications](#component-specifications)
5. [Technical Implementation Details](#technical-implementation-details)
6. [Sprint Planning](#sprint-planning)
7. [Acceptance Criteria Mapping](#acceptance-criteria-mapping)
8. [Quality Requirements](#quality-requirements)
9. [Risk Mitigation](#risk-mitigation)
10. [Testing Strategy](#testing-strategy)
11. [Deliverables Checklist](#deliverables-checklist)
12. [Revision History](#revision-history)
13. [Appendices](#appendices)

---

## 1. Document Overview

### 1.1 Purpose

This Technical Requirements Document (TRD) provides the implementation blueprint for `/ensemble:fix-issue`, a streamlined command that orchestrates a complete bug fix workflow from analysis to pull request creation, reducing workflow time by 60-70% compared to the full PRD/TRD cycle.

### 1.2 Scope

The Fix-Issue system will implement a complete workflow:

1. **Codebase Analysis**: Automated exploration to identify affected files and patterns
2. **Collaborative Planning**: Multi-agent team (Product, Tech Lead, Architect, QA) creates comprehensive fix plan
3. **User Interview**: Conditional clarification when requirements are ambiguous
4. **Branch Creation**: Automated git branch with conventional naming
5. **Task Execution**: Delegated implementation with real-time progress tracking
6. **Test Validation**: Automated test execution with failure recovery
7. **PR Creation**: Comprehensive pull request with detailed description

**In-Scope for v1.0:**
- Command YAML structure with multi-phase workflow
- Codebase analysis with general-purpose agent
- 4-agent collaborative planning (product, tech, architect, QA)
- Conditional user interview system
- Git workflow automation (branch, commit, push, PR)
- Task list generation and progress tracking
- Test validation with auto-fix retry logic
- PR creation via GitHub CLI

**Out-of-Scope for v1.0:**
- GitLab/Bitbucket support (GitHub only)
- Multi-issue batch processing
- Custom workflow step ordering
- Project management integration (Jira, Linear)
- Automatic PR approval/merge
- Cost budgeting and tracking

### 1.3 Key Technical Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Command Location | `packages/development/commands/` | Development workflow category |
| Agent Team | 4 agents (PM, Tech, Arch, QA) | Balanced quality vs speed |
| Analysis Model | Haiku | Fast, cost-effective for exploration |
| Implementation Model | Sonnet | Quality coding without Opus cost |
| Test Framework Detection | Auto-detect from package.json | Framework-agnostic support |
| PR Tool | GitHub CLI (gh) | Standard tool with excellent UX |
| Branch Naming | `fix/issue-{num}-{slug}` | Conventional, semantic |
| Task Tracking | TodoWrite integration | Existing ensemble infrastructure |
| Default Behavior | Tests required (--skip-tests to override) | Quality-first approach |
| Interview Trigger | Ambiguity detection + --interactive flag | Balance automation and clarification |

### 1.4 Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Workflow Time Reduction | 60-70% vs manual PRD/TRD | Time tracking logs |
| Workflow Success Rate | >90% (no manual intervention) | Completion telemetry |
| PR Quality Score | 4+/5 (human review) | Code review ratings |
| Test Pass Rate (First Try) | >80% | Test execution logs |
| User Adoption Rate | 50%+ of bug fixes | Usage analytics |
| Time to PR (p90) | <90 minutes | End-to-end timing |
| Average Cost per Bug | <$0.50 | Model usage costs |

---

## 2. Master Task List

### Task ID Convention

Format: `FIX-<PHASE>-<CATEGORY>-<NUMBER>`

- **FIX**: Project prefix (Fix-Issue)
- **PHASE**: P1 (Foundation), P2 (Analysis), P3 (Planning), P4 (Execution), P5 (Validation), P6 (Testing)
- **CATEGORY**: CMD, AGENT, GIT, TASK, TEST, DOC
- **NUMBER**: Sequential within category (001-999)

### 2.1 Phase 1: Command Foundation (FIX-P1)

| Task ID | Description | Est. Hours | Dependencies | Agent Assignment | Status |
|---------|-------------|------------|--------------|------------------|--------|
| FIX-P1-CMD-001 | Create fix-issue.yaml command structure | 2 | None | file-creator | [ ] |
| FIX-P1-CMD-002 | Define command metadata (name, description, version) | 1 | FIX-P1-CMD-001 | file-creator | [ ] |
| FIX-P1-CMD-003 | Define command parameters (description, issue, branch, etc.) | 2 | FIX-P1-CMD-001 | backend-developer | [ ] |
| FIX-P1-CMD-004 | Add parameter validation schema | 1.5 | FIX-P1-CMD-003 | backend-developer | [ ] |
| FIX-P1-CMD-005 | Create command parameter parser logic | 2 | FIX-P1-CMD-003 | backend-developer | [ ] |
| FIX-P1-CMD-006 | Implement --issue flag handler | 1.5 | FIX-P1-CMD-005 | backend-developer | [ ] |
| FIX-P1-CMD-007 | Implement --branch flag handler | 1 | FIX-P1-CMD-005 | backend-developer | [ ] |
| FIX-P1-CMD-008 | Implement --skip-tests flag handler | 0.5 | FIX-P1-CMD-005 | backend-developer | [ ] |
| FIX-P1-CMD-009 | Implement --draft-pr flag handler | 0.5 | FIX-P1-CMD-005 | backend-developer | [ ] |
| FIX-P1-CMD-010 | Implement --interactive flag handler | 0.5 | FIX-P1-CMD-005 | backend-developer | [ ] |
| FIX-P1-CMD-011 | Add error handling for missing required inputs | 1.5 | FIX-P1-CMD-010 | backend-developer | [ ] |
| FIX-P1-CMD-012 | Create workflow phase structure (3 phases) | 1.5 | FIX-P1-CMD-002 | backend-developer | [ ] |
| FIX-P1-TEST-001 | Unit tests for parameter validation | 2 | FIX-P1-CMD-011 | test-runner | [ ] |
| FIX-P1-TEST-002 | Unit tests for flag handlers | 2 | FIX-P1-CMD-011 | test-runner | [ ] |
| FIX-P1-DOC-001 | Create command usage documentation | 2 | FIX-P1-CMD-011 | documentation-specialist | [ ] |

**Phase 1 Total: 21.5 hours (15 tasks)**

### 2.2 Phase 2: Codebase Analysis Implementation (FIX-P2)

| Task ID | Description | Est. Hours | Dependencies | Agent Assignment | Status |
|---------|-------------|------------|--------------|------------------|--------|
| FIX-P2-AGENT-001 | Create analysis workflow step in YAML | 1.5 | FIX-P1-CMD-012 | backend-developer | [ ] |
| FIX-P2-AGENT-002 | Configure general-purpose agent for analysis | 1 | FIX-P2-AGENT-001 | backend-developer | [ ] |
| FIX-P2-AGENT-003 | Set analysis model to haiku | 0.5 | FIX-P2-AGENT-002 | backend-developer | [ ] |
| FIX-P2-AGENT-004 | Implement keyword extraction from issue description | 2 | FIX-P2-AGENT-002 | backend-developer | [ ] |
| FIX-P2-AGENT-005 | Implement codebase search (Grep) for keywords | 2.5 | FIX-P2-AGENT-004 | general-purpose | [ ] |
| FIX-P2-AGENT-006 | Implement file pattern detection (Glob) | 1.5 | FIX-P2-AGENT-004 | general-purpose | [ ] |
| FIX-P2-AGENT-007 | Implement test file identification | 1.5 | FIX-P2-AGENT-006 | general-purpose | [ ] |
| FIX-P2-AGENT-008 | Implement framework detection (Jest, React, etc.) | 2 | FIX-P2-AGENT-006 | general-purpose | [ ] |
| FIX-P2-AGENT-009 | Create analysis result structure (JSON) | 1.5 | FIX-P2-AGENT-008 | backend-developer | [ ] |
| FIX-P2-AGENT-010 | Implement scope estimation (file count, LOC) | 1.5 | FIX-P2-AGENT-009 | backend-developer | [ ] |
| FIX-P2-AGENT-011 | Add analysis result logging | 1 | FIX-P2-AGENT-010 | backend-developer | [ ] |
| FIX-P2-TEST-001 | Integration test: Analysis identifies relevant files | 3 | FIX-P2-AGENT-011 | test-runner | [ ] |
| FIX-P2-TEST-002 | Integration test: Framework detection accuracy | 2 | FIX-P2-AGENT-011 | test-runner | [ ] |
| FIX-P2-TEST-003 | Performance test: Analysis completes in <2 minutes | 1.5 | FIX-P2-AGENT-011 | test-runner | [ ] |

**Phase 2 Total: 23 hours (14 tasks)**

### 2.3 Phase 3: Collaborative Planning System (FIX-P3)

| Task ID | Description | Est. Hours | Dependencies | Agent Assignment | Status |
|---------|-------------|------------|--------------|------------------|--------|
| FIX-P3-AGENT-001 | Create planning workflow step in YAML | 1.5 | FIX-P2-AGENT-011 | backend-developer | [ ] |
| FIX-P3-AGENT-002 | Configure product-management-orchestrator delegation | 2 | FIX-P3-AGENT-001 | backend-developer | [ ] |
| FIX-P3-AGENT-003 | Configure tech-lead-orchestrator delegation | 2 | FIX-P3-AGENT-001 | backend-developer | [ ] |
| FIX-P3-AGENT-004 | Configure infrastructure-orchestrator delegation | 2 | FIX-P3-AGENT-001 | backend-developer | [ ] |
| FIX-P3-AGENT-005 | Configure qa-orchestrator delegation | 2 | FIX-P3-AGENT-001 | backend-developer | [ ] |
| FIX-P3-AGENT-006 | Create agent coordination orchestration logic | 3 | FIX-P3-AGENT-005 | ensemble-orchestrator | [ ] |
| FIX-P3-AGENT-007 | Implement Product Manager validation prompt | 2 | FIX-P3-AGENT-002 | product-management-orchestrator | [ ] |
| FIX-P3-AGENT-008 | Implement Tech Lead review prompt | 2 | FIX-P3-AGENT-003 | tech-lead-orchestrator | [ ] |
| FIX-P3-AGENT-009 | Implement Architect evaluation prompt | 2 | FIX-P3-AGENT-004 | infrastructure-orchestrator | [ ] |
| FIX-P3-AGENT-010 | Implement QA test strategy prompt | 2 | FIX-P3-AGENT-005 | qa-orchestrator | [ ] |
| FIX-P3-AGENT-011 | Create plan synthesis logic | 3 | FIX-P3-AGENT-010 | ensemble-orchestrator | [ ] |
| FIX-P3-AGENT-012 | Create unified plan document template | 2 | FIX-P3-AGENT-011 | documentation-specialist | [ ] |
| FIX-P3-AGENT-013 | Implement plan result structure (JSON) | 1.5 | FIX-P3-AGENT-012 | backend-developer | [ ] |
| FIX-P3-AGENT-014 | Add plan output to user | 1 | FIX-P3-AGENT-013 | backend-developer | [ ] |
| FIX-P3-AGENT-015 | Implement ambiguity detection logic | 2.5 | FIX-P3-AGENT-014 | backend-developer | [ ] |
| FIX-P3-AGENT-016 | Create user interview question generator | 2.5 | FIX-P3-AGENT-015 | product-management-orchestrator | [ ] |
| FIX-P3-AGENT-017 | Implement conditional interview trigger | 1.5 | FIX-P3-AGENT-016 | backend-developer | [ ] |
| FIX-P3-AGENT-018 | Implement interview response integration | 2 | FIX-P3-AGENT-017 | backend-developer | [ ] |
| FIX-P3-AGENT-019 | Add --interactive flag override | 1 | FIX-P3-AGENT-017 | backend-developer | [ ] |
| FIX-P3-TEST-001 | Unit test: Ambiguity detection accuracy | 2.5 | FIX-P3-AGENT-019 | test-runner | [ ] |
| FIX-P3-TEST-002 | Integration test: All 4 agents contribute to plan | 3 | FIX-P3-AGENT-019 | test-runner | [ ] |
| FIX-P3-TEST-003 | Integration test: Plan quality evaluation | 2.5 | FIX-P3-AGENT-019 | test-runner | [ ] |
| FIX-P3-TEST-004 | Integration test: Interview triggered when needed | 2 | FIX-P3-AGENT-019 | test-runner | [ ] |

**Phase 3 Total: 47 hours (23 tasks)**

### 2.4 Phase 4: Git Workflow & Task Execution (FIX-P4)

| Task ID | Description | Est. Hours | Dependencies | Agent Assignment | Status |
|---------|-------------|------------|--------------|------------------|--------|
| FIX-P4-GIT-001 | Create execution workflow phase in YAML | 1.5 | FIX-P3-AGENT-019 | backend-developer | [ ] |
| FIX-P4-GIT-002 | Implement branch name slug generator | 2 | FIX-P4-GIT-001 | backend-developer | [ ] |
| FIX-P4-GIT-003 | Implement branch naming logic | 2 | FIX-P4-GIT-002 | backend-developer | [ ] |
| FIX-P4-GIT-004 | Add issue number extraction from --issue flag | 1 | FIX-P4-GIT-003 | backend-developer | [ ] |
| FIX-P4-GIT-005 | Add custom branch name support (--branch flag) | 1 | FIX-P4-GIT-003 | backend-developer | [ ] |
| FIX-P4-GIT-006 | Implement git checkout -b branch creation | 1.5 | FIX-P4-GIT-005 | git-workflow | [ ] |
| FIX-P4-GIT-007 | Add branch conflict detection | 2 | FIX-P4-GIT-006 | git-workflow | [ ] |
| FIX-P4-GIT-008 | Add branch creation error handling | 1.5 | FIX-P4-GIT-007 | git-workflow | [ ] |
| FIX-P4-TASK-001 | Implement task list generation from plan | 3 | FIX-P4-GIT-008 | ensemble-orchestrator | [ ] |
| FIX-P4-TASK-002 | Create TodoWrite integration | 2 | FIX-P4-TASK-001 | backend-developer | [ ] |
| FIX-P4-TASK-003 | Implement task status tracking (pending/in_progress/completed) | 2 | FIX-P4-TASK-002 | backend-developer | [ ] |
| FIX-P4-TASK-004 | Create task execution orchestration loop | 3 | FIX-P4-TASK-003 | ensemble-orchestrator | [ ] |
| FIX-P4-TASK-005 | Implement agent selection logic per task type | 2.5 | FIX-P4-TASK-004 | ensemble-orchestrator | [ ] |
| FIX-P4-TASK-006 | Create backend task delegation (backend-developer) | 1.5 | FIX-P4-TASK-005 | backend-developer | [ ] |
| FIX-P4-TASK-007 | Create frontend task delegation (frontend-developer) | 1.5 | FIX-P4-TASK-005 | frontend-developer | [ ] |
| FIX-P4-TASK-008 | Create infrastructure task delegation | 1.5 | FIX-P4-TASK-005 | infrastructure-developer | [ ] |
| FIX-P4-TASK-009 | Implement task progress updates (TodoWrite) | 2 | FIX-P4-TASK-006 | backend-developer | [ ] |
| FIX-P4-TASK-010 | Add real-time progress visibility | 1.5 | FIX-P4-TASK-009 | backend-developer | [ ] |
| FIX-P4-TASK-011 | Implement task failure handling | 2 | FIX-P4-TASK-009 | backend-developer | [ ] |
| FIX-P4-TEST-001 | Unit test: Branch naming conventions | 2 | FIX-P4-GIT-008 | test-runner | [ ] |
| FIX-P4-TEST-002 | Unit test: Task list generation quality | 2.5 | FIX-P4-TASK-011 | test-runner | [ ] |
| FIX-P4-TEST-003 | Integration test: Correct agent per task type | 3 | FIX-P4-TASK-011 | test-runner | [ ] |
| FIX-P4-TEST-004 | Integration test: Task progress tracking | 2.5 | FIX-P4-TASK-011 | test-runner | [ ] |

**Phase 4 Total: 46.5 hours (23 tasks)**

### 2.5 Phase 5: Test Validation & PR Creation (FIX-P5)

| Task ID | Description | Est. Hours | Dependencies | Agent Assignment | Status |
|---------|-------------|------------|--------------|------------------|--------|
| FIX-P5-TEST-001 | Create validation workflow phase in YAML | 1.5 | FIX-P4-TASK-011 | backend-developer | [ ] |
| FIX-P5-TEST-002 | Implement test framework auto-detection | 3 | FIX-P5-TEST-001 | test-runner | [ ] |
| FIX-P5-TEST-003 | Add Jest framework detection | 1.5 | FIX-P5-TEST-002 | test-runner | [ ] |
| FIX-P5-TEST-004 | Add Pytest framework detection | 1.5 | FIX-P5-TEST-002 | test-runner | [ ] |
| FIX-P5-TEST-005 | Add RSpec framework detection | 1 | FIX-P5-TEST-002 | test-runner | [ ] |
| FIX-P5-TEST-006 | Add generic npm test detection | 1 | FIX-P5-TEST-002 | test-runner | [ ] |
| FIX-P5-TEST-007 | Implement test execution via test-runner agent | 2.5 | FIX-P5-TEST-006 | test-runner | [ ] |
| FIX-P5-TEST-008 | Add test output parsing | 2.5 | FIX-P5-TEST-007 | test-runner | [ ] |
| FIX-P5-TEST-009 | Implement failure detection logic | 2 | FIX-P5-TEST-008 | test-runner | [ ] |
| FIX-P5-TEST-010 | Implement auto-fix attempt logic | 3 | FIX-P5-TEST-009 | test-runner | [ ] |
| FIX-P5-TEST-011 | Add retry mechanism (max 2 attempts) | 2 | FIX-P5-TEST-010 | test-runner | [ ] |
| FIX-P5-TEST-012 | Implement failure escalation to user | 1.5 | FIX-P5-TEST-011 | test-runner | [ ] |
| FIX-P5-TEST-013 | Add --skip-tests flag implementation | 1 | FIX-P5-TEST-011 | backend-developer | [ ] |
| FIX-P5-TEST-014 | Add test skip warning message | 0.5 | FIX-P5-TEST-013 | backend-developer | [ ] |
| FIX-P5-GIT-001 | Create PR creation workflow step | 1.5 | FIX-P5-TEST-014 | github-specialist | [ ] |
| FIX-P5-GIT-002 | Implement PR title generation logic | 2 | FIX-P5-GIT-001 | github-specialist | [ ] |
| FIX-P5-GIT-003 | Create PR description template | 2 | FIX-P5-GIT-001 | documentation-specialist | [ ] |
| FIX-P5-GIT-004 | Implement PR body generation | 2.5 | FIX-P5-GIT-003 | github-specialist | [ ] |
| FIX-P5-GIT-005 | Add issue linking (Fixes #N) | 1 | FIX-P5-GIT-004 | github-specialist | [ ] |
| FIX-P5-GIT-006 | Add files changed summary | 2 | FIX-P5-GIT-004 | github-specialist | [ ] |
| FIX-P5-GIT-007 | Add test plan section to PR | 1.5 | FIX-P5-GIT-004 | github-specialist | [ ] |
| FIX-P5-GIT-008 | Implement git commit with conventional message | 2 | FIX-P5-GIT-007 | git-workflow | [ ] |
| FIX-P5-GIT-009 | Implement git push with upstream tracking | 1.5 | FIX-P5-GIT-008 | git-workflow | [ ] |
| FIX-P5-GIT-010 | Implement gh pr create command | 2 | FIX-P5-GIT-009 | github-specialist | [ ] |
| FIX-P5-GIT-011 | Add --draft-pr flag implementation | 1 | FIX-P5-GIT-010 | github-specialist | [ ] |
| FIX-P5-GIT-012 | Add PR URL extraction and display | 1 | FIX-P5-GIT-011 | github-specialist | [ ] |
| FIX-P5-TEST-015 | Unit test: Test framework detection | 2.5 | FIX-P5-TEST-014 | test-runner | [ ] |
| FIX-P5-TEST-016 | Unit test: Failure analysis accuracy | 2.5 | FIX-P5-TEST-014 | test-runner | [ ] |
| FIX-P5-TEST-017 | Integration test: Auto-fix success rate | 3 | FIX-P5-TEST-014 | test-runner | [ ] |
| FIX-P5-TEST-018 | Unit test: PR description completeness | 2 | FIX-P5-GIT-012 | test-runner | [ ] |
| FIX-P5-TEST-019 | Integration test: End-to-end PR creation | 3.5 | FIX-P5-GIT-012 | test-runner | [ ] |

**Phase 5 Total: 55.5 hours (31 tasks)**

### 2.6 Phase 6: Error Handling, Documentation & Testing (FIX-P6)

| Task ID | Description | Est. Hours | Dependencies | Agent Assignment | Status |
|---------|-------------|------------|--------------|------------------|--------|
| FIX-P6-ERR-001 | Implement git authentication error detection | 2 | FIX-P5-GIT-012 | git-workflow | [ ] |
| FIX-P6-ERR-002 | Add gh CLI authentication check | 1.5 | FIX-P6-ERR-001 | github-specialist | [ ] |
| FIX-P6-ERR-003 | Implement network failure retry logic | 2.5 | FIX-P6-ERR-002 | backend-developer | [ ] |
| FIX-P6-ERR-004 | Add branch conflict error messages | 1.5 | FIX-P6-ERR-003 | git-workflow | [ ] |
| FIX-P6-ERR-005 | Add test failure error messages | 1.5 | FIX-P6-ERR-003 | test-runner | [ ] |
| FIX-P6-ERR-006 | Implement missing issue number handling | 1 | FIX-P6-ERR-003 | backend-developer | [ ] |
| FIX-P6-ERR-007 | Add API rate limit detection | 1.5 | FIX-P6-ERR-003 | backend-developer | [ ] |
| FIX-P6-ERR-008 | Create error recovery guide (inline) | 2 | FIX-P6-ERR-007 | documentation-specialist | [ ] |
| FIX-P6-DOC-001 | Create comprehensive user guide | 4 | FIX-P6-ERR-008 | documentation-specialist | [ ] |
| FIX-P6-DOC-002 | Create decision tree (fix-issue vs PRD/TRD) | 2 | FIX-P6-DOC-001 | documentation-specialist | [ ] |
| FIX-P6-DOC-003 | Create workflow phase documentation | 2.5 | FIX-P6-DOC-001 | documentation-specialist | [ ] |
| FIX-P6-DOC-004 | Create troubleshooting guide | 2.5 | FIX-P6-ERR-008 | documentation-specialist | [ ] |
| FIX-P6-DOC-005 | Create examples for common scenarios | 3 | FIX-P6-DOC-001 | documentation-specialist | [ ] |
| FIX-P6-DOC-006 | Update CLAUDE.md with command reference | 1.5 | FIX-P6-DOC-005 | documentation-specialist | [ ] |
| FIX-P6-DOC-007 | Create CHANGELOG entries | 1 | FIX-P6-DOC-001 | documentation-specialist | [ ] |
| FIX-P6-TEST-001 | E2E test: Simple bug fix workflow | 4 | FIX-P6-ERR-008 | test-runner | [ ] |
| FIX-P6-TEST-002 | E2E test: Complex multi-file bug | 4 | FIX-P6-ERR-008 | test-runner | [ ] |
| FIX-P6-TEST-003 | E2E test: Test failure and recovery | 3.5 | FIX-P6-ERR-008 | test-runner | [ ] |
| FIX-P6-TEST-004 | E2E test: User interview triggered | 3 | FIX-P6-ERR-008 | test-runner | [ ] |
| FIX-P6-TEST-005 | E2E test: All flags combination | 3.5 | FIX-P6-ERR-008 | test-runner | [ ] |
| FIX-P6-TEST-006 | Error scenario test: Git auth failure | 2 | FIX-P6-ERR-002 | test-runner | [ ] |
| FIX-P6-TEST-007 | Error scenario test: Network timeout | 2 | FIX-P6-ERR-003 | test-runner | [ ] |
| FIX-P6-TEST-008 | Error scenario test: Branch conflict | 2 | FIX-P6-ERR-004 | test-runner | [ ] |
| FIX-P6-TEST-009 | Performance benchmark: 10 real bugs | 5 | FIX-P6-TEST-005 | test-runner | [ ] |
| FIX-P6-TEST-010 | Cost analysis: Model usage tracking | 2.5 | FIX-P6-TEST-009 | test-runner | [ ] |
| FIX-P6-TEST-011 | Quality evaluation: PR description review | 3 | FIX-P6-TEST-009 | code-reviewer | [ ] |
| FIX-P6-TEST-012 | User acceptance testing preparation | 2 | FIX-P6-DOC-005 | qa-orchestrator | [ ] |

**Phase 6 Total: 62.5 hours (27 tasks)**

### Summary

| Phase | Tasks | Estimated Hours |
|-------|-------|-----------------|
| Phase 1: Command Foundation | 15 | 21.5 |
| Phase 2: Codebase Analysis | 14 | 23 |
| Phase 3: Collaborative Planning | 23 | 47 |
| Phase 4: Git Workflow & Task Execution | 23 | 46.5 |
| Phase 5: Test Validation & PR Creation | 31 | 55.5 |
| Phase 6: Error Handling & Documentation | 27 | 62.5 |
| **Total** | **133** | **256 hours** |

---

## 3. System Architecture

### 3.1 High-Level Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                    User Layer                                     │
│  Command: /ensemble:fix-issue "Fix auth timeout bug"             │
└────────────────────────┬─────────────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────────────┐
│                  Command Orchestrator                             │
│  (ensemble-orchestrator)                                          │
│  - Coordinates 3 workflow phases                                 │
│  - Manages state transitions                                     │
│  - Delegates to specialized agents                               │
└────────────────────────┬─────────────────────────────────────────┘
                         │
         ┌───────────────┴───────────────┬───────────────┐
         ▼                               ▼               ▼
┌──────────────────┐  ┌──────────────────────┐  ┌───────────────────┐
│ Phase 1:         │  │ Phase 2:             │  │ Phase 3:          │
│ Analysis &       │  │ Execution            │  │ Validation &      │
│ Planning         │  │                      │  │ Delivery          │
└──────────────────┘  └──────────────────────┘  └───────────────────┘
         │                      │                         │
         ▼                      ▼                         ▼
┌──────────────────┐  ┌──────────────────────┐  ┌───────────────────┐
│ Codebase         │  │ Branch Creation      │  │ Test Validation   │
│ Analysis         │  │ (git-workflow)       │  │ (test-runner)     │
│ (general-purpose)│  └──────────────────────┘  └───────────────────┘
└──────────────────┘            │                         │
         │                      ▼                         ▼
         ▼             ┌──────────────────────┐  ┌───────────────────┐
┌──────────────────┐  │ Task Generation      │  │ PR Creation       │
│ Collaborative    │  │ (TodoWrite)          │  │ (github-specialist│
│ Planning         │  └──────────────────────┘  │  + gh CLI)        │
│ - Product Mgr    │            │               └───────────────────┘
│ - Tech Lead      │            ▼                         │
│ - Architect      │  ┌──────────────────────┐            │
│ - QA Lead        │  │ Task Execution       │            │
└──────────────────┘  │ - backend-developer  │            │
         │            │ - frontend-developer │            │
         │            │ - infra-developer    │            │
         │            └──────────────────────┘            │
         │                                                │
         └───────────┬────────────────────────────────────┘
                     │
                     ▼
         ┌─────────────────────────┐
         │  Workflow State Manager │
         │  - Analysis results     │
         │  - Plan document        │
         │  - Task list            │
         │  - Branch info          │
         │  - Test status          │
         │  - PR URL               │
         └─────────────────────────┘
```

### 3.2 Data Flow Diagram

```
User Input
  │
  ├─ Issue Description: "Fix timeout bug in auth flow"
  ├─ Flags: --issue 34, --interactive
  │
  ▼
┌──────────────────────────────────────────────────────────────┐
│  Phase 1: Analysis & Planning                                 │
└──────────────────────────────────────────────────────────────┘
  │
  ├─ Step 1: Codebase Analysis (model: haiku)
  │    │
  │    ├─ Grep("timeout", "auth", "login")
  │    ├─ Glob("**/*auth*.{ts,js}", "**/*timeout*")
  │    ├─ Read(affected files)
  │    │
  │    └─ Output: {
  │           affectedFiles: ["auth/timeout.ts", "auth/AuthService.test.ts"],
  │           patterns: ["Jest", "TypeScript", "NestJS"],
  │           scope: "small"
  │         }
  │
  ├─ Step 2: Collaborative Planning (model: sonnet)
  │    │
  │    ├─ Task(product-management-orchestrator)
  │    │    └─ Validates: problem statement, acceptance criteria
  │    │
  │    ├─ Task(tech-lead-orchestrator)
  │    │    └─ Reviews: technical approach, patterns
  │    │
  │    ├─ Task(infrastructure-orchestrator)
  │    │    └─ Evaluates: design implications, dependencies
  │    │
  │    ├─ Task(qa-orchestrator)
  │    │    └─ Defines: test coverage, edge cases
  │    │
  │    └─ Output: {
  │           approach: "Increase timeout constant from 30s to 60s",
  │           testStrategy: "Unit tests + integration test",
  │           edgeCases: ["Session persistence", "Network delays"],
  │           files: ["auth/timeout.ts", "auth/AuthService.test.ts"]
  │         }
  │
  └─ Step 3: User Interview (conditional)
       │
       ├─ IF (description.length < 20 OR --interactive flag):
       │    ├─ AskUserQuestion("What timeout value is needed?")
       │    ├─ AskUserQuestion("Should this apply to all auth flows?")
       │    └─ Incorporate responses into plan
       │
       └─ ELSE: Skip interview
  │
  ▼
┌──────────────────────────────────────────────────────────────┐
│  Phase 2: Execution                                           │
└──────────────────────────────────────────────────────────────┘
  │
  ├─ Step 1: Branch Creation
  │    │
  │    ├─ Generate branch name: "fix/issue-34-auth-timeout"
  │    ├─ Bash(git checkout -b fix/issue-34-auth-timeout)
  │    │
  │    └─ Output: { branchName: "fix/issue-34-auth-timeout", created: true }
  │
  ├─ Step 2: Task List Generation
  │    │
  │    ├─ Generate tasks from plan:
  │    │    - "Update timeout constant in auth/timeout.ts"
  │    │    - "Add unit tests for timeout edge cases"
  │    │    - "Add integration test for session persistence"
  │    │
  │    ├─ TodoWrite({ todos: [...], status: "pending" })
  │    │
  │    └─ Output: Task list displayed to user
  │
  └─ Step 3: Task Execution (model: sonnet)
       │
       ├─ FOR EACH task:
       │    │
       │    ├─ TodoWrite({ taskId: 1, status: "in_progress" })
       │    │
       │    ├─ Task(backend-developer)
       │    │    └─ Implement: Update timeout.ts
       │    │
       │    └─ TodoWrite({ taskId: 1, status: "completed" })
       │
       └─ Output: All tasks completed
  │
  ▼
┌──────────────────────────────────────────────────────────────┐
│  Phase 3: Validation & Delivery                               │
└──────────────────────────────────────────────────────────────┘
  │
  ├─ Step 1: Test Validation (model: haiku)
  │    │
  │    ├─ Detect framework: Jest (from package.json)
  │    ├─ Task(test-runner)
  │    │    ├─ Bash(npm test)
  │    │    ├─ Parse output
  │    │    │
  │    │    ├─ IF tests fail:
  │    │    │    ├─ Analyze failures
  │    │    │    ├─ Attempt fix
  │    │    │    ├─ Bash(npm test) [retry]
  │    │    │    │
  │    │    │    └─ IF still fail: Report to user, halt
  │    │    │
  │    │    └─ ELSE: Proceed
  │    │
  │    └─ Output: { testsPassed: true, attempts: 1 }
  │
  └─ Step 2: PR Creation (model: haiku)
       │
       ├─ Generate PR title: "Fix #34: Increase auth timeout to 60s"
       │
       ├─ Generate PR body:
       │    ## Problem
       │    Authentication timeout was too short (30s), causing failures
       │
       │    ## Solution
       │    Increased timeout to 60s with proper test coverage
       │
       │    ## Changes
       │    - auth/timeout.ts: Updated TIMEOUT constant
       │    - auth/AuthService.test.ts: Added edge case tests
       │
       │    ## Test Plan
       │    - Unit tests pass
       │    - Integration tests verify session persistence
       │
       │    Fixes #34
       │
       ├─ Bash(git add . && git commit -m "Fix: increase auth timeout")
       ├─ Bash(git push -u origin fix/issue-34-auth-timeout)
       ├─ Bash(gh pr create --title "..." --body "...")
       │
       └─ Output: { prUrl: "https://github.com/org/repo/pull/156" }
  │
  ▼
User receives PR URL and completion summary
```

### 3.3 Agent Interaction Sequence

```
User
  │
  ├─ /ensemble:fix-issue "Fix auth timeout" --issue 34
  │
  ▼
ensemble-orchestrator
  │
  ├─ Phase 1: Analysis & Planning
  │   │
  │   ├─ Task(general-purpose, model=haiku, prompt="Analyze codebase for auth timeout issue")
  │   │     │
  │   │     ├─ Grep("timeout", glob="**/*auth*")
  │   │     ├─ Glob("**/*auth*.ts")
  │   │     ├─ Read("auth/timeout.ts")
  │   │     │
  │   │     └─ Returns: { affectedFiles: [...], patterns: [...] }
  │   │
  │   ├─ Task(product-management-orchestrator, prompt="Validate problem and acceptance criteria")
  │   │     └─ Returns: { problem: "...", acceptanceCriteria: [...] }
  │   │
  │   ├─ Task(tech-lead-orchestrator, prompt="Review technical approach")
  │   │     └─ Returns: { approach: "...", patterns: [...] }
  │   │
  │   ├─ Task(infrastructure-orchestrator, prompt="Evaluate architecture impact")
  │   │     └─ Returns: { designNotes: "...", dependencies: [...] }
  │   │
  │   ├─ Task(qa-orchestrator, prompt="Define test strategy")
  │   │     └─ Returns: { testStrategy: "...", coverage: [...] }
  │   │
  │   ├─ Synthesize unified plan
  │   │
  │   └─ IF ambiguous: AskUserQuestion([...clarifying questions])
  │
  ├─ Phase 2: Execution
  │   │
  │   ├─ Bash(git checkout -b fix/issue-34-auth-timeout)
  │   │
  │   ├─ TodoWrite({ todos: [
  │   │     { content: "Update timeout.ts", status: "pending" },
  │   │     { content: "Add unit tests", status: "pending" }
  │   │   ]})
  │   │
  │   ├─ FOR EACH task:
  │   │   │
  │   │   ├─ TodoWrite({ update task: status="in_progress" })
  │   │   │
  │   │   ├─ Task(backend-developer, model=sonnet, prompt="Update timeout.ts...")
  │   │   │     │
  │   │   │     ├─ Edit("auth/timeout.ts", old="30000", new="60000")
  │   │   │     │
  │   │   │     └─ Returns: { success: true }
  │   │   │
  │   │   └─ TodoWrite({ update task: status="completed" })
  │   │
  │
  ├─ Phase 3: Validation & Delivery
  │   │
  │   ├─ Task(test-runner, model=haiku, prompt="Run tests and fix failures")
  │   │   │
  │   │   ├─ Detect framework: Jest
  │   │   ├─ Bash(npm test)
  │   │   │
  │   │   ├─ IF tests pass:
  │   │   │     └─ Returns: { passed: true }
  │   │   │
  │   │   └─ ELSE:
  │   │         ├─ Analyze failures
  │   │         ├─ Fix issues
  │   │         ├─ Bash(npm test) [retry]
  │   │         │
  │   │         └─ IF still fail:
  │   │               └─ Returns: { passed: false, errors: [...] } → HALT
  │   │
  │   ├─ Bash(git add .)
  │   ├─ Bash(git commit -m "Fix: increase auth timeout to 60s")
  │   ├─ Bash(git push -u origin fix/issue-34-auth-timeout)
  │   │
  │   └─ Bash(gh pr create --title "Fix #34: Increase auth timeout" --body "...")
  │         │
  │         └─ Returns: PR URL
  │
  ▼
User receives: "✓ PR created: https://github.com/org/repo/pull/156"
```

### 3.4 State Management

**Workflow State Object:**

```javascript
{
  "workflowId": "fix-issue-34-2026-02-16T10:30:00Z",
  "command": "/ensemble:fix-issue",
  "timestamp": "2026-02-16T10:30:00Z",

  "input": {
    "description": "Fix auth timeout bug",
    "issueNumber": 34,
    "flags": {
      "interactive": false,
      "skipTests": false,
      "draftPr": false,
      "branch": null
    }
  },

  "phase1": {
    "analysis": {
      "affectedFiles": [
        "auth/timeout.ts",
        "auth/AuthService.test.ts"
      ],
      "patterns": ["Jest", "TypeScript", "NestJS"],
      "scope": "small",
      "estimatedLOC": 20,
      "framework": "NestJS",
      "testFramework": "Jest"
    },

    "plan": {
      "approach": "Increase timeout constant and add tests",
      "productPerspective": {
        "problem": "Users timing out during auth flow",
        "acceptanceCriteria": [
          "Auth flow completes within 60s",
          "No timeout errors in logs"
        ]
      },
      "techPerspective": {
        "approach": "Update TIMEOUT constant in timeout.ts",
        "patterns": "Follow NestJS service pattern"
      },
      "architecturePerspective": {
        "designImpact": "Low - isolated constant change",
        "dependencies": []
      },
      "qaPerspective": {
        "testStrategy": "Unit tests + integration test",
        "coverage": ["Timeout edge case", "Session persistence"]
      }
    },

    "interview": {
      "triggered": false,
      "questions": [],
      "responses": []
    }
  },

  "phase2": {
    "branch": {
      "name": "fix/issue-34-auth-timeout",
      "created": true,
      "base": "main",
      "createdAt": "2026-02-16T10:32:00Z"
    },

    "tasks": [
      {
        "id": 1,
        "content": "Update timeout constant in auth/timeout.ts",
        "activeForm": "Updating timeout constant",
        "status": "completed",
        "agent": "backend-developer",
        "startedAt": "2026-02-16T10:33:00Z",
        "completedAt": "2026-02-16T10:35:00Z"
      },
      {
        "id": 2,
        "content": "Add unit tests for timeout edge cases",
        "activeForm": "Adding unit tests",
        "status": "completed",
        "agent": "backend-developer",
        "startedAt": "2026-02-16T10:35:00Z",
        "completedAt": "2026-02-16T10:38:00Z"
      }
    ]
  },

  "phase3": {
    "testing": {
      "framework": "jest",
      "command": "npm test",
      "attempts": 1,
      "results": [
        {
          "attempt": 1,
          "passed": true,
          "totalTests": 45,
          "passedTests": 45,
          "failedTests": 0,
          "output": "Test Suites: 5 passed, 5 total..."
        }
      ]
    },

    "pr": {
      "title": "Fix #34: Increase auth timeout to 60s",
      "body": "## Problem\n...",
      "url": "https://github.com/org/repo/pull/156",
      "number": 156,
      "status": "ready-for-review",
      "createdAt": "2026-02-16T10:45:00Z"
    }
  },

  "metrics": {
    "totalDuration": 900,  // 15 minutes in seconds
    "phase1Duration": 180,
    "phase2Duration": 480,
    "phase3Duration": 240,
    "modelUsage": {
      "haiku": { "inputTokens": 5230, "outputTokens": 1240, "cost": 0.03 },
      "sonnet": { "inputTokens": 12450, "outputTokens": 3820, "cost": 0.25 }
    },
    "totalCost": 0.28
  },

  "status": "completed",
  "completedAt": "2026-02-16T10:45:00Z"
}
```

---

## 4. Component Specifications

### 4.1 Command YAML Structure

**File:** `packages/development/commands/fix-issue.yaml`

```yaml
metadata:
  name: ensemble:fix-issue
  description: Lightweight workflow for bug fixes and small issues
  version: 1.0.0
  category: development
  model: sonnet  # Default model for orchestrator
  output_path: ensemble/fix-issue.md
  source: fortium

parameters:
  - name: description
    type: string
    required: false
    description: Issue description (free text or omit if using --issue)

  - name: issue
    type: number
    required: false
    description: GitHub issue number (e.g., --issue 34)

  - name: branch
    type: string
    required: false
    description: Custom branch name (default: auto-generated)

  - name: skip-tests
    type: boolean
    default: false
    description: Skip test validation (not recommended)

  - name: draft-pr
    type: boolean
    default: false
    description: Create draft PR instead of ready-for-review

  - name: interactive
    type: boolean
    default: false
    description: Enable detailed user interviews during planning

mission:
  summary: |
    Orchestrate a complete bug fix workflow from analysis to PR creation,
    assembling a virtual team of specialized agents (Product Manager, Tech Lead,
    Architect, QA Lead) to ensure high-quality fixes with minimal user intervention.

  behavior:
    - Execute 3-phase workflow: Analysis & Planning, Execution, Validation & Delivery
    - Delegate codebase analysis to general-purpose agent (Haiku for speed)
    - Assemble 4-agent team for collaborative planning (Sonnet for quality)
    - Conduct user interview only if description is ambiguous or --interactive flag set
    - Create git branch following convention: fix/issue-{num}-{slug}
    - Generate actionable task list and track progress with TodoWrite
    - Delegate implementation to appropriate agents (backend, frontend, infrastructure)
    - Run test suite with auto-fix retry logic (max 2 attempts)
    - Create comprehensive PR with GitHub CLI
    - Provide clear error messages and recovery guidance

  constraints:
    - GitHub only (no GitLab/Bitbucket in v1.0)
    - GitHub CLI (gh) must be installed and authenticated
    - Tests must pass unless --skip-tests flag is used
    - Maximum 2 auto-fix attempts for test failures
    - User interview limited to 5 questions maximum
    - Branch naming follows fixed convention (customizable via --branch)

workflow:
  phases:
    - name: Analysis & Planning
      order: 1
      description: Understand codebase context and create comprehensive fix plan

      steps:
        - order: 1
          title: Codebase Analysis
          description: |
            Explore codebase to identify affected files, patterns, and scope.
            Use Grep, Glob, and Read tools to understand context.
          agent: general-purpose
          model: haiku
          instructions: |
            1. Extract keywords from issue description
            2. Search codebase for relevant files (Grep)
            3. Identify related test files
            4. Detect framework and testing patterns (package.json, imports)
            5. Estimate scope (file count, estimated LOC)
            6. Return structured analysis result

        - order: 2
          title: Collaborative Planning
          description: |
            Assemble virtual team of 4 specialized agents to create comprehensive
            fix plan with multiple perspectives.
          model: sonnet
          instructions: |
            Delegate planning to 4 agents in sequence:

            1. Task(product-management-orchestrator)
               - Validate problem statement
               - Define acceptance criteria
               - Identify user impact and edge cases

            2. Task(tech-lead-orchestrator)
               - Review technical approach
               - Ensure consistency with codebase patterns
               - Validate feasibility

            3. Task(infrastructure-orchestrator)
               - Evaluate architecture implications
               - Identify dependencies and integration points
               - Assess scalability and maintainability

            4. Task(qa-orchestrator)
               - Define test coverage requirements
               - Create test strategy
               - Identify quality gates

            Synthesize responses into unified plan with:
            - Approach summary
            - Files to modify
            - Test strategy
            - Edge cases to handle

        - order: 3
          title: User Interview (Conditional)
          description: |
            If issue description is ambiguous or --interactive flag is set,
            ask clarifying questions (max 5).
          conditional: true
          trigger: |
            Ambiguity detection:
            - Description < 20 words
            - Vague terms ("doesn't work", "broken", "issue")
            - Multiple possible interpretations
            - OR --interactive flag is set
          instructions: |
            1. Generate 3-5 focused questions
            2. Use AskUserQuestion tool
            3. Incorporate responses into plan
            4. Update approach and acceptance criteria

    - name: Execution
      order: 2
      description: Create branch, generate tasks, and implement fix

      steps:
        - order: 1
          title: Branch Creation
          description: Create git branch with conventional naming
          tool: Bash
          instructions: |
            1. Generate branch name:
               - IF --branch flag: Use custom name
               - ELIF --issue flag: fix/issue-{number}-{slugified-description}
               - ELSE: fix/{slugified-description}

            2. Check if branch exists:
               - git branch --list {branch-name}
               - If exists: Ask user to switch or use different name

            3. Create branch:
               - git checkout -b {branch-name}
               - Verify creation: git branch --show-current

        - order: 2
          title: Task List Generation
          description: Break down plan into actionable tasks
          tool: TodoWrite
          instructions: |
            Generate 3-10 specific, actionable tasks from plan:

            Format:
            - content: "Update timeout.ts constant from 30s to 60s"
              activeForm: "Updating timeout constant"
              status: "pending"

            Include:
            - Implementation tasks (file modifications)
            - Test update tasks
            - Validation tasks

            Each task should be:
            - Specific to a file or component
            - Actionable (clear what to do)
            - Testable (clear success criteria)

        - order: 3
          title: Task Execution
          description: |
            Execute all tasks with appropriate agent delegation and
            real-time progress tracking.
          model: sonnet
          instructions: |
            FOR EACH task in task list:

            1. Mark task as in_progress:
               TodoWrite({ taskId: X, status: "in_progress" })

            2. Select appropriate agent:
               - Backend code → backend-developer
               - Frontend code → frontend-developer
               - Infrastructure → infrastructure-developer
               - Generic → general-purpose

            3. Delegate task:
               Task(agent-type, prompt=task.content)

            4. Mark task as completed:
               TodoWrite({ taskId: X, status: "completed" })

            5. IF task fails:
               - Keep status as "in_progress"
               - Log error details
               - Continue with remaining tasks
               - Report failures at end

    - name: Validation & Delivery
      order: 3
      description: Validate tests pass and create pull request

      steps:
        - order: 1
          title: Test Validation
          description: |
            Run test suite with auto-fix retry logic. Ensure all tests
            pass before creating PR.
          agent: test-runner
          model: haiku
          retry: 2
          instructions: |
            1. Detect test framework:
               - Check package.json for jest, pytest, rspec, etc.
               - Check for test files and imports
               - Determine test command (npm test, pytest, rspec)

            2. Run tests (Attempt 1):
               - Bash({test-command})
               - Parse output for pass/fail

            3. IF tests fail:
               - Analyze failure output
               - Identify root causes
               - Attempt fixes (Edit files)
               - Run tests again (Attempt 2)

            4. IF tests still fail after 2 attempts:
               - Report failures to user with details
               - HALT workflow (do not create PR)
               - Provide recovery instructions

            5. IF --skip-tests flag:
               - Log warning message
               - Skip test execution
               - Proceed to PR creation

        - order: 2
          title: PR Creation
          description: Create comprehensive pull request with GitHub CLI
          tool: Bash
          model: haiku
          instructions: |
            1. Generate commit message:
               - Format: "Fix: {brief description}"
               - OR if issue number: "Fix #{number}: {description}"
               - Use conventional commit format

            2. Commit changes:
               - git add .
               - git commit -m "{message}"

            3. Push branch:
               - git push -u origin {branch-name}
               - Handle push errors (auth, network)

            4. Generate PR title:
               - IF issue number: "Fix #{number}: {description}"
               - ELSE: "Fix: {description}"

            5. Generate PR body (template):
               ```markdown
               ## Problem
               {Issue description from user or GitHub issue}

               ## Solution
               {Summary of changes made, approach taken}

               ## Changes
               - {File 1}: {Description}
               - {File 2}: {Description}

               ## Test Plan
               {What was tested, coverage added}

               ## Checklist
               - [x] Tests pass locally
               - [x] Code follows project conventions
               - [x] No new warnings or errors

               Fixes #{issue-number}

               🤖 Generated with [Ensemble Fix-Issue](https://github.com/FortiumPartners/ensemble)
               ```

            6. Create PR:
               - IF --draft-pr: gh pr create --draft --title "..." --body "..."
               - ELSE: gh pr create --title "..." --body "..."

            7. Extract PR URL from output

            8. Display to user:
               - "✓ PR created: {url}"
               - "✓ Branch pushed: {branch-name}"
               - "✓ All tests passed"

validation:
  required_tools:
    - Bash
    - Read
    - Write
    - Edit
    - Grep
    - Glob
    - Task
    - TodoWrite

  required_agents:
    - general-purpose
    - product-management-orchestrator
    - tech-lead-orchestrator
    - infrastructure-orchestrator
    - qa-orchestrator
    - backend-developer
    - frontend-developer
    - infrastructure-developer
    - test-runner
    - git-workflow
    - github-specialist

  required_external:
    - git (version 2.0+)
    - gh (GitHub CLI, authenticated)
```

### 4.2 Analysis Result Schema

**Purpose:** Structure output from codebase analysis phase.

```typescript
interface AnalysisResult {
  affectedFiles: string[];              // Files likely needing changes
  testFiles: string[];                  // Related test files
  patterns: {
    framework?: string;                 // "NestJS", "React", "Rails", etc.
    testFramework?: string;             // "Jest", "Pytest", "RSpec", etc.
    language: string;                   // "TypeScript", "Python", "Ruby", etc.
    architecture?: string;              // "MVC", "Microservices", etc.
  };
  scope: "small" | "medium" | "large";  // Complexity estimate
  estimatedLOC: number;                 // Estimated lines of code to change
  keywords: string[];                   // Extracted from issue description
  searchResults: {
    files: number;                      // Files found in search
    matches: number;                    // Total matches found
  };
}
```

### 4.3 Plan Document Schema

**Purpose:** Structure output from collaborative planning phase.

```typescript
interface PlanDocument {
  summary: string;                      // One-sentence approach

  productPerspective: {
    problem: string;                    // Problem statement
    acceptanceCriteria: string[];       // Success criteria
    userImpact: string;                 // Who is affected
    edgeCases: string[];                // Edge cases to consider
  };

  techPerspective: {
    approach: string;                   // Technical approach
    patterns: string[];                 // Patterns to follow
    feasibility: "high" | "medium" | "low";
    risks: string[];                    // Technical risks
  };

  architecturePerspective: {
    designImpact: "none" | "low" | "medium" | "high";
    dependencies: string[];             // System dependencies
    scalability: string;                // Scalability notes
    maintainability: string;            // Maintainability notes
  };

  qaPerspective: {
    testStrategy: string;               // Overall test strategy
    coverage: string[];                 // Areas requiring test coverage
    qualityGates: string[];             // Quality criteria
  };

  filesToModify: Array<{
    path: string;
    reason: string;
    type: "implementation" | "test" | "config";
  }>;

  estimatedComplexity: "low" | "medium" | "high";
  recommendWorkflow: "fix-issue" | "prd-trd";  // Workflow recommendation
}
```

### 4.4 Task List Schema

**Purpose:** TodoWrite task structure for progress tracking.

```typescript
interface Task {
  id: number;                           // Sequential ID
  content: string;                      // Task description (imperative)
  activeForm: string;                   // Present continuous form
  status: "pending" | "in_progress" | "completed";
  agent?: string;                       // Assigned agent type
  startedAt?: string;                   // ISO timestamp
  completedAt?: string;                 // ISO timestamp
  error?: {
    message: string;
    stack?: string;
  };
}

interface TaskList {
  todos: Task[];
  total: number;
  completed: number;
  inProgress: number;
  pending: number;
}
```

### 4.5 PR Description Template

**Purpose:** Standardized PR body format.

```markdown
## Problem

{issue.description}

{Optional: Why this is a problem, user impact}

## Solution

{plan.summary}

{Detailed explanation of approach taken}

## Changes

- **{file1.path}**: {file1.changeDescription}
- **{file2.path}**: {file2.changeDescription}
- **{file3.path}**: {file3.changeDescription}

## Test Plan

{qaPerspective.testStrategy}

**Coverage added:**
- {coverage1}
- {coverage2}

**Test results:**
- Total tests: {testResults.total}
- Passed: {testResults.passed}
- Failed: {testResults.failed}

## Technical Details

**Framework:** {patterns.framework}
**Test Framework:** {patterns.testFramework}
**Complexity:** {plan.estimatedComplexity}

## Checklist

- [x] Tests pass locally
- [x] Code follows project conventions
- [x] No new warnings or errors
- [x] Edge cases covered: {edgeCases.join(", ")}

## Related

Fixes #{issueNumber}

---

🤖 Generated with [Ensemble Fix-Issue](https://github.com/FortiumPartners/ensemble)
```

---

## 5. Technical Implementation Details

### 5.1 File Structure

```
packages/development/
├── .claude-plugin/
│   └── plugin.json                      # Plugin manifest
├── package.json
├── README.md
├── CHANGELOG.md
├── commands/
│   ├── fix-issue.yaml                   # Main command (NEW)
│   ├── fix-issue.md                     # Generated markdown (NEW)
│   ├── implement-trd.yaml               # Existing
│   └── ... (other commands)
├── agents/
│   └── ... (existing agents)
├── skills/
│   └── ... (existing skills)
├── lib/
│   ├── fix-issue/                       # Support utilities (NEW)
│   │   ├── analysis-helpers.js          # Codebase analysis utilities
│   │   ├── branch-naming.js             # Branch name generation
│   │   ├── plan-synthesizer.js          # Plan document synthesis
│   │   ├── task-generator.js            # Task list generation
│   │   ├── test-detector.js             # Test framework detection
│   │   ├── pr-template.js               # PR description generation
│   │   └── ambiguity-detector.js        # Interview trigger logic
│   └── ... (existing utilities)
└── tests/
    ├── fix-issue/                       # Test suite (NEW)
    │   ├── command.test.js              # Command YAML validation
    │   ├── analysis.test.js             # Analysis phase tests
    │   ├── planning.test.js             # Planning phase tests
    │   ├── execution.test.js            # Execution phase tests
    │   ├── validation.test.js           # Test validation tests
    │   ├── pr-creation.test.js          # PR creation tests
    │   ├── e2e.test.js                  # End-to-end scenarios
    │   └── fixtures/                    # Test fixtures
    └── ... (existing tests)
```

### 5.2 Branch Naming Implementation

**File:** `packages/development/lib/fix-issue/branch-naming.js`

```javascript
/**
 * Generate conventional branch name for fix-issue workflow.
 *
 * Format: fix/issue-{number}-{slug} or fix/{slug}
 */

/**
 * Slugify text for branch name.
 * @param {string} text - Text to slugify
 * @returns {string} Slugified text
 */
function slugify(text) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')       // Remove non-word chars
    .replace(/\s+/g, '-')           // Replace spaces with -
    .replace(/--+/g, '-')           // Replace multiple - with single -
    .replace(/^-+/, '')             // Trim - from start
    .replace(/-+$/, '')             // Trim - from end
    .substring(0, 50);              // Max 50 chars
}

/**
 * Generate branch name from issue description and number.
 * @param {Object} options
 * @param {string} options.description - Issue description
 * @param {number} [options.issueNumber] - GitHub issue number
 * @param {string} [options.customBranch] - Custom branch name override
 * @returns {string} Branch name
 */
function generateBranchName({ description, issueNumber, customBranch }) {
  if (customBranch) {
    return customBranch;
  }

  const slug = slugify(description);

  if (issueNumber) {
    return `fix/issue-${issueNumber}-${slug}`;
  }

  return `fix/${slug}`;
}

/**
 * Validate branch name doesn't already exist.
 * @param {string} branchName
 * @returns {Promise<boolean>} True if branch exists
 */
async function branchExists(branchName) {
  const { execSync } = require('child_process');

  try {
    const output = execSync(`git branch --list ${branchName}`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    });

    return output.trim().length > 0;
  } catch (error) {
    return false;
  }
}

module.exports = {
  slugify,
  generateBranchName,
  branchExists
};
```

### 5.3 Test Framework Detection

**File:** `packages/development/lib/fix-issue/test-detector.js`

```javascript
/**
 * Detect test framework and test command from project files.
 */

const fs = require('fs');
const path = require('path');

/**
 * Detect test framework from package.json.
 * @param {string} projectRoot - Project root directory
 * @returns {Object} { framework, testCommand }
 */
function detectTestFramework(projectRoot) {
  const packageJsonPath = path.join(projectRoot, 'package.json');

  // JavaScript/TypeScript projects
  if (fs.existsSync(packageJsonPath)) {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));

    // Check dependencies and devDependencies
    const deps = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies
    };

    // Jest
    if (deps.jest) {
      return {
        framework: 'jest',
        testCommand: packageJson.scripts?.test || 'npm test'
      };
    }

    // Vitest
    if (deps.vitest) {
      return {
        framework: 'vitest',
        testCommand: packageJson.scripts?.test || 'npm test'
      };
    }

    // Mocha
    if (deps.mocha) {
      return {
        framework: 'mocha',
        testCommand: packageJson.scripts?.test || 'npm test'
      };
    }

    // Generic npm test
    if (packageJson.scripts?.test) {
      return {
        framework: 'npm',
        testCommand: 'npm test'
      };
    }
  }

  // Python projects
  const requirementsPaths = [
    path.join(projectRoot, 'requirements.txt'),
    path.join(projectRoot, 'requirements-dev.txt'),
    path.join(projectRoot, 'setup.py')
  ];

  for (const reqPath of requirementsPaths) {
    if (fs.existsSync(reqPath)) {
      const content = fs.readFileSync(reqPath, 'utf-8');

      if (content.includes('pytest')) {
        return { framework: 'pytest', testCommand: 'pytest' };
      }

      if (content.includes('unittest')) {
        return { framework: 'unittest', testCommand: 'python -m unittest' };
      }
    }
  }

  // Ruby projects
  const gemfilePath = path.join(projectRoot, 'Gemfile');
  if (fs.existsSync(gemfilePath)) {
    const content = fs.readFileSync(gemfilePath, 'utf-8');

    if (content.includes('rspec')) {
      return { framework: 'rspec', testCommand: 'rspec' };
    }

    if (content.includes('minitest')) {
      return { framework: 'minitest', testCommand: 'rake test' };
    }
  }

  // .NET projects
  const csprojFiles = fs.readdirSync(projectRoot)
    .filter(f => f.endsWith('.csproj'));

  if (csprojFiles.length > 0) {
    return { framework: 'xunit', testCommand: 'dotnet test' };
  }

  // Default fallback
  return { framework: 'unknown', testCommand: null };
}

/**
 * Parse test output to determine pass/fail status.
 * @param {string} output - Test command output
 * @param {string} framework - Test framework name
 * @returns {Object} { passed, total, failed, summary }
 */
function parseTestOutput(output, framework) {
  const result = {
    passed: false,
    total: 0,
    failed: 0,
    summary: ''
  };

  switch (framework) {
    case 'jest':
    case 'vitest':
      // Example: "Tests: 2 failed, 8 passed, 10 total"
      const jestMatch = output.match(/Tests:\s+(\d+)\s+failed,\s+(\d+)\s+passed,\s+(\d+)\s+total/);
      if (jestMatch) {
        result.failed = parseInt(jestMatch[1]);
        result.total = parseInt(jestMatch[3]);
        result.passed = result.failed === 0;
        result.summary = jestMatch[0];
      }
      break;

    case 'pytest':
      // Example: "10 passed, 2 failed in 1.23s"
      const pytestMatch = output.match(/(\d+)\s+passed(?:,\s+(\d+)\s+failed)?/);
      if (pytestMatch) {
        result.total = parseInt(pytestMatch[1]) + (parseInt(pytestMatch[2]) || 0);
        result.failed = parseInt(pytestMatch[2]) || 0;
        result.passed = result.failed === 0;
        result.summary = pytestMatch[0];
      }
      break;

    case 'rspec':
      // Example: "10 examples, 2 failures"
      const rspecMatch = output.match(/(\d+)\s+examples?,\s+(\d+)\s+failures?/);
      if (rspecMatch) {
        result.total = parseInt(rspecMatch[1]);
        result.failed = parseInt(rspecMatch[2]);
        result.passed = result.failed === 0;
        result.summary = rspecMatch[0];
      }
      break;

    default:
      // Generic detection based on exit code
      result.passed = !output.toLowerCase().includes('fail');
  }

  return result;
}

module.exports = {
  detectTestFramework,
  parseTestOutput
};
```

### 5.4 Ambiguity Detection

**File:** `packages/development/lib/fix-issue/ambiguity-detector.js`

```javascript
/**
 * Detect when issue description is too ambiguous and requires user interview.
 */

const VAGUE_TERMS = [
  'doesn\'t work',
  'broken',
  'issue',
  'problem',
  'bug',
  'fix',
  'help',
  'not working',
  'error',
  'fails',
  'crash'
];

const MIN_DESCRIPTION_LENGTH = 20;  // Characters

/**
 * Detect if description is too ambiguous.
 * @param {string} description - Issue description
 * @returns {Object} { isAmbiguous, reasons }
 */
function detectAmbiguity(description) {
  const reasons = [];

  // Check length
  if (description.length < MIN_DESCRIPTION_LENGTH) {
    reasons.push(`Description too short (${description.length} chars, min ${MIN_DESCRIPTION_LENGTH})`);
  }

  // Check for vague terms without details
  const lowerDesc = description.toLowerCase();
  const foundVagueTerms = VAGUE_TERMS.filter(term => lowerDesc.includes(term));

  if (foundVagueTerms.length > 0 && description.length < 50) {
    reasons.push(`Contains vague terms without details: ${foundVagueTerms.join(', ')}`);
  }

  // Check for missing specifics (no file names, no error messages)
  const hasFilePath = /[\w-]+\.(ts|js|py|rb|cs|java|go|rs)/i.test(description);
  const hasErrorMessage = /error|exception|fail|timeout/i.test(description);
  const hasSpecifics = hasFilePath || hasErrorMessage;

  if (!hasSpecifics && description.length < 100) {
    reasons.push('No specific files or error messages mentioned');
  }

  return {
    isAmbiguous: reasons.length > 0,
    reasons
  };
}

/**
 * Generate clarifying questions based on ambiguity reasons.
 * @param {Object} ambiguityResult
 * @param {Object} analysisResult
 * @returns {string[]} Questions to ask user
 */
function generateQuestions(ambiguityResult, analysisResult) {
  const questions = [];

  if (ambiguityResult.reasons.includes('Description too short')) {
    questions.push('Can you provide more details about the issue? What specific behavior is incorrect?');
  }

  if (ambiguityResult.reasons.some(r => r.includes('vague terms'))) {
    questions.push('What exactly happens when the issue occurs? Do you see an error message?');
  }

  if (ambiguityResult.reasons.includes('No specific files or error messages mentioned')) {
    if (analysisResult.affectedFiles.length > 3) {
      questions.push(`We found ${analysisResult.affectedFiles.length} potentially affected files. Which files are most relevant to this issue?`);
    } else {
      questions.push('Which files or components are affected by this issue?');
    }
  }

  // Always ask about acceptance criteria if not obvious
  questions.push('How will you know when this issue is fixed? What should work correctly?');

  // Limit to 5 questions
  return questions.slice(0, 5);
}

module.exports = {
  detectAmbiguity,
  generateQuestions,
  VAGUE_TERMS,
  MIN_DESCRIPTION_LENGTH
};
```

---

## 6. Sprint Planning

### Sprint 1: Foundation & Analysis (Weeks 1-2)

**Goal:** Command infrastructure and codebase analysis implementation

**Tasks:**
- FIX-P1-CMD-001 through FIX-P1-DOC-001 (15 tasks, 21.5 hours)
- FIX-P2-AGENT-001 through FIX-P2-TEST-003 (14 tasks, 23 hours)

**Deliverables:**
- Command YAML structure complete
- Parameter validation working
- Codebase analysis functional
- Framework detection accurate

**Success Criteria:**
- Command validates correctly
- Analysis identifies 80%+ relevant files
- Analysis completes in <2 minutes

### Sprint 2: Collaborative Planning (Weeks 3-4)

**Goal:** Multi-agent planning system and user interview

**Tasks:**
- FIX-P3-AGENT-001 through FIX-P3-TEST-004 (23 tasks, 47 hours)

**Deliverables:**
- 4-agent planning system operational
- Ambiguity detection logic
- User interview system
- Plan synthesis working

**Success Criteria:**
- All 4 agents contribute to plan
- Plan quality rated 4+/5 by reviewers
- Interview triggers when appropriate
- User responses integrated correctly

### Sprint 3: Git Workflow & Task Execution (Weeks 5-6)

**Goal:** Branch creation, task generation, and execution

**Tasks:**
- FIX-P4-GIT-001 through FIX-P4-TEST-004 (23 tasks, 46.5 hours)

**Deliverables:**
- Branch naming working
- Task list generation functional
- Task execution with progress tracking
- Agent delegation logic complete

**Success Criteria:**
- Branch names follow convention
- Tasks are specific and actionable
- Correct agents delegated to
- Progress visible in real-time

### Sprint 4: Test Validation & PR Creation (Weeks 7-8)

**Goal:** Test validation with auto-fix and PR generation

**Tasks:**
- FIX-P5-TEST-001 through FIX-P5-TEST-019 (31 tasks, 55.5 hours)

**Deliverables:**
- Test framework detection
- Auto-fix retry logic
- PR generation with gh CLI
- End-to-end workflow complete

**Success Criteria:**
- Framework detected 90%+ accuracy
- Auto-fix resolves 50%+ failures
- PRs have comprehensive descriptions
- PR creation succeeds reliably

### Sprint 5: Polish, Testing & Documentation (Weeks 9-10)

**Goal:** Error handling, comprehensive testing, and documentation

**Tasks:**
- FIX-P6-ERR-001 through FIX-P6-TEST-012 (27 tasks, 62.5 hours)

**Deliverables:**
- Comprehensive error handling
- Full test suite (unit, integration, E2E)
- User documentation
- Performance benchmarks

**Success Criteria:**
- All error scenarios handled
- 90%+ test coverage
- E2E workflows succeed on 10 real bugs
- Documentation complete and clear

---

## 7. Acceptance Criteria Mapping

### AC-1: Command Invocation ✓

**Criteria:** User can invoke command with various parameter combinations

**Mapped Tasks:**
- FIX-P1-CMD-001 through FIX-P1-CMD-012

**Validation:**
- Unit tests: FIX-P1-TEST-001, FIX-P1-TEST-002
- All parameter flags work correctly
- Error messages are clear and actionable

### AC-2: Codebase Analysis ✓

**Criteria:** Analysis phase identifies relevant files and patterns in <2 minutes

**Mapped Tasks:**
- FIX-P2-AGENT-001 through FIX-P2-AGENT-011

**Validation:**
- Integration tests: FIX-P2-TEST-001, FIX-P2-TEST-002
- Performance test: FIX-P2-TEST-003
- 80%+ accuracy on file identification

### AC-3: Collaborative Planning ✓

**Criteria:** All 4 agents contribute to comprehensive plan

**Mapped Tasks:**
- FIX-P3-AGENT-001 through FIX-P3-AGENT-014

**Validation:**
- Integration test: FIX-P3-TEST-002
- Quality evaluation: FIX-P3-TEST-003
- Plan includes all required sections

### AC-4: User Interview (Conditional) ✓

**Criteria:** Interview triggered when needed, responses integrated

**Mapped Tasks:**
- FIX-P3-AGENT-015 through FIX-P3-AGENT-019

**Validation:**
- Unit test: FIX-P3-TEST-001
- Integration test: FIX-P3-TEST-004
- E2E test: FIX-P6-TEST-004

### AC-5: Branch Creation ✓

**Criteria:** Git branch created with conventional naming

**Mapped Tasks:**
- FIX-P4-GIT-001 through FIX-P4-GIT-008

**Validation:**
- Unit test: FIX-P4-TEST-001
- Branch names follow convention
- Conflicts detected and reported

### AC-6: Task List Generation ✓

**Criteria:** 3-10 specific, actionable tasks created

**Mapped Tasks:**
- FIX-P4-TASK-001 through FIX-P4-TASK-003

**Validation:**
- Unit test: FIX-P4-TEST-002
- Tasks are specific and actionable
- Tasks cover implementation and testing

### AC-7: Task Execution with Progress Tracking ✓

**Criteria:** Tasks executed with real-time progress updates

**Mapped Tasks:**
- FIX-P4-TASK-004 through FIX-P4-TASK-011

**Validation:**
- Integration tests: FIX-P4-TEST-003, FIX-P4-TEST-004
- Correct agent per task type
- Progress visible to user

### AC-8: Test Validation ✓

**Criteria:** Tests run with auto-fix retry logic

**Mapped Tasks:**
- FIX-P5-TEST-001 through FIX-P5-TEST-014

**Validation:**
- Unit tests: FIX-P5-TEST-015, FIX-P5-TEST-016
- Integration test: FIX-P5-TEST-017
- E2E test: FIX-P6-TEST-003

### AC-9: Pull Request Creation ✓

**Criteria:** PR created with comprehensive description

**Mapped Tasks:**
- FIX-P5-GIT-001 through FIX-P5-GIT-012

**Validation:**
- Unit test: FIX-P5-TEST-018
- Integration test: FIX-P5-TEST-019
- PR description completeness

### AC-10: End-to-End Workflow ✓

**Criteria:** Complete workflow in 40-90 minutes with no manual intervention

**Mapped Tasks:**
- All phases integrated

**Validation:**
- E2E tests: FIX-P6-TEST-001 through FIX-P6-TEST-005
- Performance benchmark: FIX-P6-TEST-009
- Success rate >90%

### AC-11: Error Handling ✓

**Criteria:** Clear error messages with recovery guidance

**Mapped Tasks:**
- FIX-P6-ERR-001 through FIX-P6-ERR-008

**Validation:**
- Error scenario tests: FIX-P6-TEST-006 through FIX-P6-TEST-008
- Error messages are actionable
- Recovery instructions are clear

---

## 8. Quality Requirements

### 8.1 Code Quality

**Standards:**
- ESLint configuration for JavaScript/TypeScript code
- Consistent coding style with Prettier
- JSDoc comments for all exported functions
- Type safety where applicable (TypeScript for utilities)
- No hardcoded credentials or secrets

**Metrics:**
- ESLint: 0 errors, <5 warnings
- Code duplication: <5%
- Function complexity: McCabe < 10
- File length: <500 lines

**Enforcement:**
- Pre-commit hooks run linting
- CI pipeline validates code quality
- Code review required before merge

### 8.2 Testing Requirements

**Coverage Targets:**
- Unit tests: >85% code coverage
- Integration tests: All workflow phases
- E2E tests: 10+ real bug scenarios
- Error scenarios: All common failure modes

**Test Frameworks:**
- Jest for JavaScript/TypeScript tests
- Fixtures for realistic test data
- Mocking for external dependencies (gh CLI, git)

**Test Categories:**
1. **Unit Tests:**
   - Parameter validation
   - Branch naming logic
   - Test framework detection
   - Ambiguity detection
   - PR template generation

2. **Integration Tests:**
   - Codebase analysis accuracy
   - Multi-agent planning coordination
   - Task execution with agent delegation
   - Test validation workflow
   - PR creation workflow

3. **End-to-End Tests:**
   - Simple bug fix (single file)
   - Complex bug (multiple files)
   - Test failure and recovery
   - User interview flow
   - All flag combinations

4. **Error Scenario Tests:**
   - Git authentication failure
   - Network timeout
   - Branch conflict
   - Test failures (unrecoverable)

### 8.3 Performance Requirements

**Latency Targets:**
- Command initialization: <5 seconds
- Codebase analysis: <2 minutes (p90)
- Collaborative planning: <3 minutes (p90)
- Task execution: Varies by complexity
- Test validation: Depends on test suite
- PR creation: <30 seconds
- **Total workflow (p90): <90 minutes**

**Resource Usage:**
- Memory: <500MB peak
- Disk I/O: Minimal (read-only codebase exploration)
- Network: Only for gh CLI operations

**Optimization Strategies:**
- Use Haiku for analysis and validation (fast, cheap)
- Use Sonnet for implementation (quality)
- Parallel agent delegation where possible
- Caching analysis results within workflow

### 8.4 Reliability Requirements

**Success Rate:**
- Workflow completion: >90% without manual intervention
- Test framework detection: >90% accuracy
- PR creation: >95% success rate

**Error Recovery:**
- Test failures: Max 2 auto-fix attempts
- Network failures: 3 retries with exponential backoff
- Git errors: Clear instructions for manual resolution

**Fault Tolerance:**
- Graceful degradation if optional steps fail
- State preserved across failures where possible
- Idempotent operations (safe to retry)

### 8.5 Security Requirements

**Git Safety:**
- No force-push operations
- No destructive git commands (reset --hard, clean -f)
- Branch conflicts detected, never overridden
- User confirmation for potentially destructive actions

**Credential Handling:**
- Use gh CLI for GitHub authentication (no token storage)
- No credentials logged or stored
- Respect .gitignore for sensitive files

**Input Validation:**
- Sanitize user-provided branch names
- Validate issue numbers
- Escape shell commands properly

---

## 9. Risk Mitigation

### 9.1 Technical Risks

#### Risk T-1: Test Failures Block Workflow

**Impact:** High
**Probability:** Medium
**Mitigation:**
- Implement robust test failure analysis (FIX-P5-TEST-009)
- Allow up to 2 auto-fix attempts (FIX-P5-TEST-010, FIX-P5-TEST-011)
- Provide detailed failure report (FIX-P5-TEST-012)
- Enable --skip-tests escape hatch (FIX-P5-TEST-013)
- User can manually fix and re-run

**Contingency:**
- If auto-fix fails, provide specific error details
- Suggest manual fixes based on failure patterns
- Allow user to continue without tests (with warning)

#### Risk T-2: Ambiguous Issue Descriptions

**Impact:** High (wrong fix implemented)
**Probability:** Medium
**Mitigation:**
- Implement ambiguity detection (FIX-P3-AGENT-015)
- Trigger user interview when needed (FIX-P3-AGENT-017)
- Product Manager validates problem statement (FIX-P3-AGENT-007)
- Multiple agent perspectives catch issues early

**Contingency:**
- User reviews plan before execution (future: approval gate)
- Clear error if implementation doesn't match requirements

#### Risk T-3: Complex Bugs Exceed Workflow Scope

**Impact:** Medium
**Probability:** Low
**Mitigation:**
- Scope estimation in analysis phase (FIX-P2-AGENT-010)
- Recommend PRD/TRD workflow if high complexity
- Document decision criteria in user guide (FIX-P6-DOC-002)

**Contingency:**
- User can override and proceed anyway
- Workflow may take longer but should complete

#### Risk T-4: Git Workflow Conflicts

**Impact:** High
**Probability:** Medium
**Mitigation:**
- Check git status before branch creation (FIX-P4-GIT-007)
- Detect remote authentication before push (FIX-P6-ERR-001)
- Never use destructive git operations
- Clear error messages with resolution steps (FIX-P6-ERR-004)

**Contingency:**
- User resolves manually
- Workflow can be resumed after resolution

#### Risk T-5: Agent Delegation Failures

**Impact:** High
**Probability:** Low
**Mitigation:**
- Ensure all required agents in ensemble-full
- Fallback to general-purpose if specialist unavailable
- Validate agent responses before proceeding
- Comprehensive integration testing (FIX-P4-TEST-003)

**Contingency:**
- Use general-purpose agent as fallback
- Log agent failures for debugging

#### Risk T-6: GitHub CLI Issues

**Impact:** High
**Probability:** Low
**Mitigation:**
- Check gh CLI availability early (FIX-P6-ERR-002)
- Validate authentication before PR creation
- Clear error messages for common issues
- Retry logic for network failures (FIX-P6-ERR-003)

**Contingency:**
- Provide manual PR creation instructions
- Save PR description to file for manual use

### 9.2 Quality Risks

#### Risk Q-1: Inconsistent PR Quality

**Impact:** Medium
**Probability:** Medium
**Mitigation:**
- Structured PR template (FIX-P5-GIT-003)
- Detailed change summary from agents
- Link to issue for context
- Human review in testing phase (FIX-P6-TEST-011)

**Contingency:**
- Users can edit PR description after creation
- Iterate on template based on feedback

#### Risk Q-2: Poor Task List Quality

**Impact:** Medium
**Probability:** Low
**Mitigation:**
- Task generation from comprehensive plan (FIX-P4-TASK-001)
- Tasks validated against plan goals
- Quality testing (FIX-P4-TEST-002)

**Contingency:**
- Users can modify task list manually if needed
- Iterate on task generation logic

### 9.3 User Experience Risks

#### Risk U-1: Workflow Too Slow

**Impact:** High
**Probability:** Low
**Mitigation:**
- Use Haiku for analysis and validation (fast)
- Parallel agent delegation where safe
- Performance benchmarking (FIX-P6-TEST-009)
- Optimize based on metrics

**Contingency:**
- Identify slow phases
- Add caching where applicable
- Reduce redundant analysis

#### Risk U-2: Unclear Error Messages

**Impact:** Medium
**Probability:** Medium
**Mitigation:**
- Error recovery guide (FIX-P6-ERR-008)
- Specific error messages with context
- Troubleshooting documentation (FIX-P6-DOC-004)

**Contingency:**
- User feedback collection
- Iterate on error messages

---

## 10. Testing Strategy

### 10.1 Unit Testing

**Scope:** Individual utility functions and logic components

**Test Files:**
- `tests/fix-issue/branch-naming.test.js`
- `tests/fix-issue/test-detector.test.js`
- `tests/fix-issue/ambiguity-detector.test.js`
- `tests/fix-issue/pr-template.test.js`

**Test Cases:**

1. **Branch Naming (30 tests)**
   - Slugify edge cases (special chars, unicode, length limits)
   - Issue number formatting
   - Custom branch name handling
   - Branch existence detection

2. **Test Framework Detection (25 tests)**
   - Jest detection from package.json
   - Pytest detection from requirements.txt
   - RSpec detection from Gemfile
   - Generic npm test fallback
   - Test output parsing for each framework

3. **Ambiguity Detection (20 tests)**
   - Short descriptions trigger
   - Vague terms detection
   - Specifics detection (files, errors)
   - Question generation logic

4. **PR Template (15 tests)**
   - Template variable substitution
   - Section completeness
   - Issue linking
   - Markdown formatting

### 10.2 Integration Testing

**Scope:** Multi-component workflows and agent interactions

**Test Files:**
- `tests/fix-issue/analysis.test.js`
- `tests/fix-issue/planning.test.js`
- `tests/fix-issue/execution.test.js`
- `tests/fix-issue/validation.test.js`

**Test Cases:**

1. **Codebase Analysis (15 tests)**
   - File identification accuracy
   - Framework detection
   - Scope estimation
   - Analysis completion time

2. **Collaborative Planning (20 tests)**
   - All 4 agents contribute
   - Plan synthesis quality
   - Interview triggering logic
   - Response integration

3. **Task Execution (25 tests)**
   - Agent delegation correctness
   - Progress tracking updates
   - Task completion verification
   - Error handling per task

4. **Test Validation (20 tests)**
   - Framework auto-detection
   - Test execution
   - Failure analysis
   - Auto-fix attempts
   - Retry logic

### 10.3 End-to-End Testing

**Scope:** Complete workflows from command invocation to PR creation

**Test File:** `tests/fix-issue/e2e.test.js`

**Test Scenarios:**

1. **Simple Bug Fix (Backend)**
   - Single file change
   - Unit tests pass on first try
   - PR created successfully
   - Total time <30 minutes

2. **Simple Bug Fix (Frontend)**
   - React component change
   - Jest tests pass
   - PR created successfully

3. **Multi-File Bug Fix**
   - 3-5 file changes
   - Implementation + test files
   - Tests pass after 1 retry
   - Total time <60 minutes

4. **Bug with User Interview**
   - Ambiguous description triggers interview
   - User answers questions
   - Plan updated with responses
   - Fix implemented correctly

5. **Test Failure Recovery**
   - Initial tests fail
   - Auto-fix resolves issue
   - Tests pass on retry 2
   - PR created successfully

6. **Flag Combinations**
   - `--issue 34 --interactive`
   - `--branch custom-name --skip-tests`
   - `--issue 34 --draft-pr`
   - All combinations work correctly

7. **Error Scenarios**
   - Git authentication failure → clear error
   - Branch conflict → clear error
   - Test failures (unrecoverable) → workflow halts
   - Network timeout → retry and recover

### 10.4 Performance Testing

**Test File:** `tests/fix-issue/performance.test.js`

**Benchmarks:**

1. **10 Real Bug Scenarios**
   - Variety of complexity levels
   - Different frameworks (React, NestJS, Rails)
   - Measure time per phase
   - Measure total workflow time

**Metrics to Collect:**
- Analysis phase: p50, p90, p99
- Planning phase: p50, p90, p99
- Execution phase: varies by complexity
- Validation phase: p50, p90, p99
- Total workflow: p50, p90, p99
- Model usage: tokens, cost per workflow

**Targets:**
- p90 total workflow: <90 minutes
- Analysis: <2 minutes (p90)
- Planning: <3 minutes (p90)
- PR creation: <30 seconds

### 10.5 Quality Testing

**Test File:** `tests/fix-issue/quality.test.js`

**Human Review:**

1. **PR Description Quality (20 PRs)**
   - Completeness: All sections present
   - Accuracy: Matches actual changes
   - Clarity: Understandable by reviewers
   - Rating scale: 1-5

2. **Task List Quality (20 workflows)**
   - Specificity: Tasks are actionable
   - Completeness: Covers all needed work
   - Accuracy: Tasks match plan
   - Rating scale: 1-5

3. **Plan Quality (20 workflows)**
   - Product perspective: Problem validated
   - Tech perspective: Approach sound
   - Architecture perspective: Design impact assessed
   - QA perspective: Test strategy defined
   - Rating scale: 1-5

**Targets:**
- 80% of PRs rated 4+/5
- 80% of task lists rated 4+/5
- 80% of plans rated 4+/5

### 10.6 User Acceptance Testing

**Participants:** 5 power users, 5 new users

**Scenarios:**
1. Fix a simple backend bug
2. Fix a frontend component bug
3. Fix a bug with ambiguous description
4. Use --interactive flag
5. Use --draft-pr flag

**Metrics:**
- Success rate (completed without help)
- Time to completion
- Satisfaction rating (1-5)
- Would use again (yes/no)

**Targets:**
- 80% complete successfully on first try
- 80% satisfied (4+/5)
- 85% would use again

---

## 11. Deliverables Checklist

### Phase 1: Command Foundation ✓

- [ ] Command YAML structure (`fix-issue.yaml`)
- [ ] Parameter validation schema
- [ ] Flag handlers (issue, branch, skip-tests, draft-pr, interactive)
- [ ] Error handling for invalid inputs
- [ ] Workflow phase structure (3 phases)
- [ ] Unit tests for parameters
- [ ] Command usage documentation

### Phase 2: Codebase Analysis ✓

- [ ] Analysis workflow step in YAML
- [ ] Keyword extraction from description
- [ ] Codebase search (Grep, Glob)
- [ ] Test file identification
- [ ] Framework detection logic
- [ ] Analysis result structure (JSON)
- [ ] Integration tests for analysis
- [ ] Performance test (<2 minutes)

### Phase 3: Collaborative Planning ✓

- [ ] Planning workflow step in YAML
- [ ] 4-agent delegation (PM, Tech, Arch, QA)
- [ ] Agent prompts for each role
- [ ] Plan synthesis logic
- [ ] Plan document template
- [ ] Ambiguity detection
- [ ] User interview question generator
- [ ] Interview response integration
- [ ] Integration tests for planning

### Phase 4: Git Workflow & Execution ✓

- [ ] Execution workflow phase in YAML
- [ ] Branch name generation (slugify)
- [ ] Branch conflict detection
- [ ] Task list generation from plan
- [ ] TodoWrite integration
- [ ] Task execution orchestration
- [ ] Agent selection logic
- [ ] Progress tracking (TodoWrite updates)
- [ ] Integration tests for execution

### Phase 5: Test Validation & PR ✓

- [ ] Validation workflow phase in YAML
- [ ] Test framework detection
- [ ] Test execution via test-runner
- [ ] Test output parsing
- [ ] Auto-fix retry logic (max 2)
- [ ] --skip-tests implementation
- [ ] PR title generation
- [ ] PR description template
- [ ] PR creation with gh CLI
- [ ] PR URL extraction
- [ ] Integration tests for PR creation

### Phase 6: Polish & Testing ✓

- [ ] Git authentication error handling
- [ ] Network failure retry logic
- [ ] Branch conflict error messages
- [ ] Test failure error messages
- [ ] Comprehensive error messages
- [ ] User guide
- [ ] Decision tree diagram
- [ ] Troubleshooting guide
- [ ] Usage examples
- [ ] CLAUDE.md updates
- [ ] E2E test suite (10 scenarios)
- [ ] Performance benchmarks
- [ ] Quality evaluation tests
- [ ] User acceptance testing

---

## 12. Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0.0 | 2026-02-16 | Ensemble TRD Team | Initial TRD creation for Issue #34 |

---

## 13. Appendices

### Appendix A: Command Examples

**Example 1: Simple Bug Fix**
```bash
/ensemble:fix-issue "Fix timeout bug in authentication flow"
```

**Example 2: With Issue Number**
```bash
/ensemble:fix-issue --issue 34
```

**Example 3: Interactive Mode**
```bash
/ensemble:fix-issue "Auth timeout" --interactive
```

**Example 4: Custom Branch**
```bash
/ensemble:fix-issue "Fix login bug" --branch feature/custom-fix
```

**Example 5: Draft PR**
```bash
/ensemble:fix-issue --issue 127 --draft-pr
```

**Example 6: Skip Tests (Not Recommended)**
```bash
/ensemble:fix-issue "Quick fix" --skip-tests
```

### Appendix B: Decision Tree

**When to use `/ensemble:fix-issue` vs PRD/TRD workflow:**

```
Is this a bug fix or small enhancement?
├── YES → Continue
└── NO → Use /ensemble:create-prd

Does it affect >5 files?
├── YES → Use /ensemble:create-prd
└── NO → Continue

Does it change architecture or APIs?
├── YES → Use /ensemble:create-prd
└── NO → Continue

Does it require stakeholder alignment?
├── YES → Use /ensemble:create-prd
└── NO → Continue

→ Use /ensemble:fix-issue ✓
```

### Appendix C: Model Selection Strategy

| Workflow Phase | Model | Rationale | Est. Cost |
|---------------|-------|-----------|-----------|
| Codebase Analysis | Haiku | Fast exploration, low cost | $0.01-0.03 |
| Collaborative Planning | Sonnet | Balanced quality/cost | $0.15-0.25 |
| Task Execution | Sonnet | Quality coding | $0.20-0.40 |
| Test Validation | Haiku | Simple validation | $0.01-0.02 |
| PR Creation | Haiku | Template filling | $0.01-0.02 |
| **Total** | Mixed | Optimized | **$0.38-0.72** |

### Appendix D: Agent Responsibilities

| Agent | Role | Responsibilities |
|-------|------|------------------|
| `ensemble-orchestrator` | Chief | Coordinate workflow, manage state |
| `general-purpose` | Analyst | Codebase exploration, research |
| `product-management-orchestrator` | Product | Validate requirements, acceptance criteria |
| `tech-lead-orchestrator` | Tech Lead | Technical approach, patterns |
| `infrastructure-orchestrator` | Architect | Design impact, dependencies |
| `qa-orchestrator` | QA Lead | Test strategy, quality gates |
| `backend-developer` | Developer | Backend implementation |
| `frontend-developer` | Developer | Frontend implementation |
| `infrastructure-developer` | Developer | Infrastructure code |
| `test-runner` | Tester | Test execution, failure analysis |
| `git-workflow` | Git Expert | Branch, commit, push operations |
| `github-specialist` | GitHub Expert | PR creation, issue linking |

### Appendix E: Glossary

| Term | Definition |
|------|------------|
| **Ambiguity Detection** | Logic to determine if issue description lacks sufficient detail |
| **Collaborative Planning** | Multi-agent team approach to creating fix plan |
| **Fix-Issue Workflow** | 3-phase workflow: Analysis & Planning, Execution, Validation & Delivery |
| **Slugify** | Convert text to URL-safe format (lowercase, hyphens, no special chars) |
| **Test Auto-Fix** | Automatic attempt to fix test failures by analyzing error output |
| **TodoWrite** | Ensemble tool for task list creation and progress tracking |
| **User Interview** | Conditional clarification questions asked when requirements unclear |

### Appendix F: Error Messages Reference

| Error Code | Message | Recovery Action |
|-----------|---------|-----------------|
| FIX-E001 | GitHub CLI not authenticated | Run `gh auth login` |
| FIX-E002 | Branch already exists | Switch to branch or use --branch flag |
| FIX-E003 | Tests failed after 2 attempts | Review failure output, fix manually |
| FIX-E004 | No issue description or --issue flag | Provide description or --issue number |
| FIX-E005 | Git push failed (auth) | Check git remote authentication |
| FIX-E006 | Network timeout | Check connection, retry command |
| FIX-E007 | Test framework not detected | Manually specify test command |

### Appendix G: Performance Benchmarks

**Target Benchmarks (from 10 real bug scenarios):**

| Metric | p50 | p90 | p99 |
|--------|-----|-----|-----|
| Total Workflow | 45 min | 90 min | 120 min |
| Analysis Phase | 1 min | 2 min | 3 min |
| Planning Phase | 2 min | 3 min | 5 min |
| Execution Phase | 30 min | 60 min | 90 min |
| Validation Phase | 5 min | 15 min | 20 min |

**Cost Benchmarks:**

| Scenario Type | Avg Cost | Model Mix |
|--------------|----------|-----------|
| Simple bug (1 file) | $0.25-0.35 | Haiku: 40%, Sonnet: 60% |
| Medium bug (3 files) | $0.45-0.65 | Haiku: 30%, Sonnet: 70% |
| Complex bug (5+ files) | $0.70-1.00 | Haiku: 25%, Sonnet: 75% |

---

**End of Technical Requirements Document**
