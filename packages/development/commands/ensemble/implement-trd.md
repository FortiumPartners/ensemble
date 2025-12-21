---
name: implement-trd
description: Complete TRD implementation with flexible strategies, state tracking, constitution guardrails, and ensemble-orchestrator delegation
---
<!-- DO NOT EDIT - Generated from implement-trd.yaml -->
<!-- To modify this file, edit the YAML source and run: npm run generate -->


This command implements a complete Technical Requirements Document (TRD) using modern
git-town feature branch workflow with flexible implementation strategies. It supports
six methodologies (TDD, characterization, test-after, bug-fix, refactor, flexible),
integrates with project constitution for guardrails, provides resume capability with
state tracking, and delegates to ensemble-orchestrator for structured development.

## Workflow

### Phase 1: Preflight - Constitution, Branch, TRD, Strategy

**1. Constitution Loading**
   Load guardrails from docs/standards/constitution.md if present

   - Extract Core Principles (methodology, non-negotiable rules)
   - Extract Tech Stack (languages, frameworks, testing tools)
   - Extract Quality Gates (coverage targets, security requirements)
   - Extract Approval Requirements (what needs user consent)
   - If absent, warn and continue with sensible defaults

**2. TRD Location and Selection**
   Find and validate TRD document

   - Check $ARGUMENTS for TRD path or name
   - Search docs/TRD/ for in-progress TRDs
   - If multiple candidates, prompt user for selection
   - Validate TRD has Master Task List section
   - Warn if TRD appears 100% complete

**3. Feature Branch Enforcement**
   Ensure feature branch exists

   - Derive branch name from TRD filename or title
   - Check if already on correct branch
   - Prefer git town hack feature/<trd-name>
   - Fallback to git switch -c feature/<trd-name>
   - Record branch in state for resume

**4. Strategy Determination**
   Determine implementation strategy using priority order

   - Check $ARGUMENTS for strategy override
   - Check TRD for explicit "Implementation Strategy" declaration
   - Check constitution for default methodology
   - Apply auto-detection rules based on TRD content
   - Default to tdd if no match
   - Report strategy and source

### Phase 2: Parse Master Task List

**1. Extract Tasks from TRD**
   Parse Master Task List section

   - Parse task format "- [ ] **TRD-XXX**: Description"
   - Extract id, description, estimate, priority, dependencies
   - Identify [P] parallelizable markers
   - Infer file_touches from descriptions

**2. Build DAG and Phases**
   Construct execution plan

   - Group tasks by Sprint/Phase headings
   - Parse dependency declarations
   - Validate no circular dependencies
   - Identify parallel groups with file mutex

**3. Strategy-Aware Validation**
   Validate task ordering against strategy

   - tdd: Advisory warning if implementation before tests
   - bug-fix: Expect reproduce → test → fix → verify pattern
   - refactor: Expect test verification at start and end
   - flexible: No validation

**4. Load Resume State**
   Check for existing state and handle resume

   - Read .trd-state/<trd-name>/implement.json if exists
   - Compare TRD content hash
   - Skip completed tasks if hash unchanged
   - Invalidate affected tasks if hash changed

### Phase 3: Ensemble Orchestrator Delegation

**1. Context Preparation**
   Bundle context for delegation

   - Include TRD content and constitution
   - Include strategy and strategy source
   - Include phase to execute and parsed tasks
   - Include quality gate targets

**2. Delegate to Ensemble Orchestrator**
   Route to ensemble-orchestrator for mesh coordination

   **Delegation:** @ensemble-orchestrator
   Development project requiring technical implementation.
Strategy context overrides default TDD enforcement when appropriate.


**3. Tech Lead Orchestrator Receives Context**
   Routes to tech-lead-orchestrator with strategy awareness

   **Delegation:** @tech-lead-orchestrator
   TRD implementation with strategy context.
Adjust Phase 5 behavior based on specified methodology.


### Phase 4: Execute Tasks by Phase

**1. Phase-by-Phase Execution**
   Execute phases in DAG order

   - Announce phase start
   - Load tasks for this phase
   - Respect dependencies (topological sort)
   - Execute with parallelism where safe (max 2 concurrent)
   - Use file-touch mutex to prevent conflicts
   - Update state after each task

**2. Strategy-Specific Execution**
   Apply methodology appropriate to strategy

   - tdd: RED-GREEN-REFACTOR cycle, test commits before implementation
   - characterization: Explore → Document → Test AS-IS behavior
   - test-after: Implement → Test → Validate
   - bug-fix: Reproduce → Failing test → Fix → Passing test
   - refactor: Verify tests → Change → Verify tests
   - flexible: Execute as ordered

**3. On Task Success**
   Handle successful task completion

   - Update TRD checkbox from [ ] to [x]
   - Create commit with format "<type>(TRD-XXX): <description>"
   - Update state file with status, commit SHA, timestamp
   - Log progress

**4. On Task Failure**
   Handle task failures

   - Sequential: Halt phase, record error, suggest remediation
   - Parallel: Allow others to finish, fail at group boundary

### Phase 5: Artifact Synchronization

**1. Update TRD After Phase**
   Ensure TRD reflects actual progress

   - Mark all completed tasks [x] in Master Task List
   - Update Sprint/Phase progress if tracking section exists
   - Add implementation notes for significant decisions
   - Commit TRD updates

**2. Artifact Sync Validation Gate**
   Block phase completion on desync

   - Verify TRD checkboxes match actual completion
   - Verify no completed tasks still marked [ ]
   - Verify constitution quality gates satisfied
   - If desync detected, STOP and report mismatches
   - Require fixes before proceeding

### Phase 6: Quality Gates

**1. Test Coverage Validation**
   Validate coverage against targets

   - Compare against constitution targets
   - Default targets 80% unit, 70% integration
   - Block phase if below threshold (unless flexible)

   **Delegation:** @test-runner
   Run full test suite and collect coverage metrics

**2. Security Validation**
   Security scanning and compliance

   - Scan for security issues
   - Check for hardcoded secrets
   - Validate input sanitization

   **Delegation:** @code-reviewer
   Security scan and OWASP compliance check

**3. Constitution Compliance Check**
   Verify all guardrails satisfied

   - Verify quality gate checkboxes satisfiable
   - Check approval requirements weren't bypassed
   - Validate tech stack constraints honored
   - Report compliance status

**4. Phase Checkpoint Commit**
   Create checkpoint after validations pass

   - Commit: chore(phase N): checkpoint (tests pass; cov unit X%, integ Y%)
   - Optional tag phase-N-pass for rollback reference

### Phase 7: Write Resume State

**1. Update State File**
   Persist state for resume capability

   - Write to .trd-state/<trd-name>/implement.json
   - Include trd_hash for change detection
   - Include all task statuses with commits
   - Include coverage metrics
   - Include checkpoint history

### Phase 8: Completion Report

**1. Generate Summary**
   Produce final implementation report

   - Report TRD name and branch
   - Report strategy used and source
   - Report phases completed/total
   - Report task counts (done/failed/skipped)
   - Report coverage metrics vs targets
   - Report constitution compliance status
   - Report final commit reference
   - Suggest next steps (PR creation, TRD archival)

## Expected Output

**Format:** Implemented Features with Quality Gates

**Structure:**
- **Feature Branch**: Git-town feature branch with all implementation commits
- **Implementation Code**: Working code with tests meeting coverage targets
- **Quality Validation**: Code review passed, security scan clean, DoD met
- **Updated TRD**: All completed tasks marked [x], progress documented
- **Resume State**: .trd-state/<trd-name>/implement.json for continuation
- **Completion Report**: Summary with strategy, coverage, compliance status

## Usage

```
/implement-trd
```
