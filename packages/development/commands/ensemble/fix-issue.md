---
name: ensemble:fix-issue
description: Lightweight workflow for bug fixes and small issues
model: sonnet
---
<!-- DO NOT EDIT - Generated from fix-issue.yaml -->
<!-- To modify this file, edit the YAML source and run: npm run generate -->


Orchestrate a complete bug fix workflow from analysis to PR creation,
assembling a virtual team of specialized agents (Product Manager, Tech Lead,
Architect, QA Lead) to ensure high-quality fixes with minimal user intervention.

## Workflow

### Phase 1: Analysis & Planning

**1. Codebase Analysis**
   Explore codebase to identify affected files, patterns, and scope.
Use Grep, Glob, and Read tools to understand context.


**2. Collaborative Planning**
   Assemble virtual team of 4 specialized agents to create comprehensive
fix plan with multiple perspectives.


**3. User Interview (Conditional)**
   If issue description is ambiguous or --interactive flag is set,
ask clarifying questions (max 5).


### Phase 2: Execution

**1. Branch Creation**
   Create git branch with conventional naming

**2. Task List Generation**
   Break down plan into actionable tasks

**3. Task Execution**
   Execute all tasks with appropriate agent delegation and
real-time progress tracking.


### Phase 3: Validation & Delivery

**1. Test Validation**
   Run test suite with auto-fix retry logic. Ensure all tests
pass before creating PR.


**2. PR Creation**
   Create comprehensive pull request with GitHub CLI

## Expected Output

**Format:** Pull Request

**Structure:**
- **Git Branch**: Feature branch following fix/issue-{num}-{slug} convention
- **Code Changes**: Implementation fixes with test coverage
- **Pull Request**: Comprehensive PR with problem, solution, changes, and test plan

## Usage

```
/ensemble:fix-issue
```
