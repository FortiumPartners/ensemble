# Product Requirements Document: Ensemble vNext Testing Phase

**Document Version**: 1.2.0
**Status**: In Review
**Created**: 2026-01-13
**Last Updated**: 2026-01-13
**Author**: Product Management

---

## Version History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0.0 | 2026-01-13 | Product Management | Initial draft |
| 1.1.0 | 2026-01-13 | Product Management | Stakeholder feedback incorporated: (1) Replaced NestJS with developing-with-typescript skill for A/B testing, (2) Removed CI/CD integration scope - tests are manual execution only, (3) Clarified no mock-based testing for external services, (4) Added parallel implementation tracks strategy |
| 1.2.0 | 2026-01-13 | Product Management | Comprehensive feedback round: (1) Added Unified Test Scenario Approach for end-to-end validation, (2) Added OpenTelemetry observability section, (3) Updated test infrastructure for remote test repository, (4) Specified web-based execution for vendoring and A/B tests, (5) Added A/B comparison for agent effectiveness, (6) Command flow updates for local/remote delegation, (7) Deferred Wiggum bounded testing to Phase 2, (8) New acceptance criteria for telemetry and parallel execution |

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Problem Statement](#2-problem-statement)
3. [User Analysis](#3-user-analysis)
4. [Goals and Non-Goals](#4-goals-and-non-goals)
5. [Functional Requirements](#5-functional-requirements)
   - 5.1 [Unit Tests: Hooks](#51-unit-tests-hooks)
   - 5.2 [Unit Tests: Scripts](#52-unit-tests-scripts)
   - 5.3 [Integration Tests: Headless Claude Sessions](#53-integration-tests-headless-claude-sessions)
   - 5.4 [Observability and Telemetry](#54-observability-and-telemetry)
6. [Non-Functional Requirements](#6-non-functional-requirements)
7. [Acceptance Criteria](#7-acceptance-criteria)
8. [Success Metrics](#8-success-metrics)
9. [Dependencies and Risks](#9-dependencies-and-risks)

---

## 1. Executive Summary

This PRD defines requirements for the Ensemble vNext Testing Phase, which establishes a comprehensive testing strategy covering both deterministic components (hooks, scripts) and non-deterministic components (agents, skills, commands). The testing infrastructure must support unit tests, integration tests via headless Claude sessions, A/B skill comparisons, and Wiggum autonomous mode validation.

### 1.1 Scope

The Testing Phase addresses the unique challenge of testing a system where most components are LLM prompts rather than executable code. This requires a hybrid approach:

- **Deterministic components** (hooks, scripts): Traditional unit testing with coverage targets
- **Non-deterministic components** (agents, skills, commands): Headless Claude session testing with behavioral verification

### 1.2 Key Deliverables

| Category | Test Type | Framework | Coverage Target |
|----------|-----------|-----------|-----------------|
| Hook Unit Tests | Unit | Jest/pytest/BATS | 80%+ |
| Script Unit Tests | Unit | Jest/BATS | 80%+ |
| Local Vendoring | Integration | Headless Claude (Web) | Manual verification |
| Skills Testing | A/B Comparison | Headless Claude (Web, Parallel) | 5 key skills |
| Agent Testing | Workflow + A/B | Headless Claude | 4 agent paths |
| Command Testing | E2E | Session logs | Full flow |
| Wiggum Mode | Autonomous | Controlled scenario | Phase 2 (Deferred) |

---

## 2. Problem Statement

### 2.1 Current State

Ensemble vNext contains multiple component types with different testing requirements:

1. **Deterministic components** (hooks, scripts) have executable logic that can be unit tested
2. **Non-deterministic components** (agents, skills, commands) are Markdown prompts interpreted by the LLM at runtime
3. **Behavioral verification** is challenging because LLM outputs vary between runs

### 2.2 The Challenge

Without comprehensive testing:

- **Hook regressions** may break critical functionality (permissions, routing, formatting)
- **Script failures** may corrupt project initialization or validation
- **Skill degradation** may produce lower-quality code without detection
- **Agent routing issues** may send tasks to incorrect subagents
- **Command flow breaks** may interrupt the PRD->TRD->Implementation pipeline
- **Wiggum mode bugs** may cause unbounded autonomous execution

### 2.3 Existing Assets

The legacy Ensemble project contains mature test suites that can be leveraged:

- **Permitter Hook**: 485 tests across 7 test files (security, performance, parsing)
- **Router Hook**: 106+ tests in pytest format (configuration, routing, integration)
- **Wiggum Hook**: 75+ tests already created for Ensemble vNext

These existing tests represent significant investment that should be copied and adapted rather than recreated.

---

## 3. User Analysis

### 3.1 Primary Users

**Ensemble vNext Developers**: Engineers building and maintaining the Ensemble framework who need to verify changes do not introduce regressions.

**Key Activities**:
- Making changes to hooks, scripts, agents, skills, or commands
- Running tests locally before committing
- Reviewing test results
- Diagnosing test failures

### 3.2 Secondary Users

**Ensemble vNext End Users**: Developers using Ensemble vNext in their projects who benefit from a thoroughly tested, reliable framework.

**Indirect Benefits**:
- Consistent behavior across updates
- Fewer bugs in production usage
- Confidence in autonomous (Wiggum) mode
- Reliable skill recommendations

### 3.3 User Needs

| User Need | Testing Solution |
|-----------|------------------|
| Confidence in hook behavior | Unit tests with 80%+ coverage |
| Validation of routing logic | Router hook pytest suite |
| Assurance skills improve output | A/B comparison testing |
| Verification of agent delegation | Workflow path testing + A/B comparison |
| Trust in autonomous mode | Bounded Wiggum execution test (Phase 2) |

---

## 4. Goals and Non-Goals

### 4.1 Goals

#### G1: Achieve 80%+ Unit Test Coverage for Deterministic Components
- Cover all hooks: Permitter, Router, Status, Formatter, Learning, Wiggum
- Cover all scripts: validate-init, scaffold-project
- Enable coverage reporting for manual execution

#### G2: Validate Non-Deterministic Components via Headless Claude Sessions
- Verify `/init-project` creates correct vendored structure
- Confirm skills are invoked when prompted
- Validate agent routing matches expected paths
- Test command flows produce expected artifacts

#### G3: Establish A/B Testing Protocol for Skills
- Define methodology for comparing output with/without skills
- Test 5 key skills that do not require external services
- Document quality differences for framework validation
- Execute A/B tests in parallel on Claude Web

#### G4: Verify Wiggum Mode Bounded Execution (Phase 2)
- Confirm autonomous mode terminates on completion
- Validate iteration limits prevent runaway execution
- Test completion detection via promise markers AND 100% task completion
- **Note**: Deferred to Phase 2 - requires more complex multi-phase test scenarios

### 4.2 Non-Goals

#### NG1: Testing External Service Integrations
The following skills/integrations are explicitly excluded from testing scope:
- Railway deployment (`managing-railway`)
- Vercel deployment (`managing-vercel`)
- Supabase integration (`managing-supabase`)
- Linear integration (`managing-linear-issues`)
- Jira integration (`managing-jira-issues`)

These require external credentials and infrastructure not suitable for automated testing.

**No Mock-Based Testing**: External services will not be mocked for testing purposes. For skills that integrate with external services, skill invocation verification (confirming the Skill tool was called with correct parameters) is sufficient. Testing actual external service behavior is out of scope.

#### NG2: Testing End User Projects
This testing phase validates the Ensemble framework itself, not projects built using Ensemble.

#### NG3: Fuzzing or Security Penetration Testing
Security testing is limited to the existing Permitter security test suite. Comprehensive penetration testing is out of scope.

#### NG4: Performance Benchmarking Beyond Existing Suite
Performance testing is limited to existing Permitter latency benchmarks. Comprehensive performance profiling is out of scope.

### 4.3 Implementation Strategy: Parallel Tracks

Implementation of testing requirements should proceed in parallel tracks to maximize efficiency:

**Track 1: Unit Tests** (Independent)
- Hook unit tests (Permitter, Router, Status, Formatter, Learning, Wiggum)
- Script unit tests (validate-init, scaffold-project)
- Can proceed immediately with existing codebase

**Track 2: Integration Tests** (Independent)
- Local vendoring tests
- Skills A/B testing
- Agent routing tests
- Command flow tests
- Can proceed once test infrastructure is established

**Track 3: Wiggum Mode Tests** (Phase 2 - Deferred)
- Requires integration test infrastructure
- Requires redesign for multi-phase test scenarios
- Current 3-task scenario is too trivial (will be one-shotted)
- Unit tests for wiggum.js (75+ tests) provide sufficient coverage for Phase 1

Tracks 1 and 2 can be developed simultaneously by different team members or in parallel work sessions. Track 3 is deferred to Phase 2.

---

## 5. Functional Requirements

### 5.1 Unit Tests: Hooks

#### F5.1.1 Permitter Hook Tests (COPY FROM LEGACY)

**Source**: `~/dev/ensemble/packages/permitter/tests/`
**Destination**: `packages/permitter/tests/`
**Framework**: Jest

| Test File | Test Count | Purpose |
|-----------|------------|---------|
| `allowlist-loader.test.js` | 29 | Settings loading and parsing |
| `command-parser.test.js` | 119 | Shell command tokenization |
| `matcher.test.js` | 138 | Pattern matching logic |
| `integration.test.js` | 54 | Full permission flow |
| `security.test.js` | 96 | Adversarial input handling |
| `performance.test.js` | 19 | Latency benchmarks |
| `docker-compose-command.test.js` | 30 | Complex multi-command parsing |

**Library modules to copy**:
- `lib/allowlist-loader.js`
- `lib/command-parser.js`
- `lib/matcher.js`

#### F5.1.2 Router Hook Tests (COPY FROM LEGACY)

**Source**: `~/dev/ensemble/packages/router/tests/test_router.py`
**Destination**: `packages/router/tests/test_router.py`
**Framework**: pytest

| Test Class | Test Count | Purpose |
|------------|------------|---------|
| `TestLoadConfig` | 14 | Environment variable parsing, defaults |
| `TestReadInput` | 3 | JSON input handling |
| `TestWriteOutput` | 1 | JSON output format |
| `TestLoadRulesFile` | 3 | Rules file loading |
| `TestValidateRules` | 4 | Basic validation |
| `TestValidateRulesStructure` | 17 | Detailed structure validation |
| `TestMergeRules` | 13 | Project/global rule merging |
| `TestCountWords` | 4 | Word counting |
| `TestMatchAgentCategories` | 4 | Agent keyword matching |
| `TestMatchSkills` | 4 | Skill pattern matching |
| `TestAnalyzePrompt` | 7 | Full analysis pipeline |
| `TestDetermineScenario` | 6 | Scenario routing |
| `TestBuildHint*` | 9 | Template generation |
| `TestBuildOutput` | 6 | Output format |
| `TestIntegration` | 6 | End-to-end flows |
| `TestEdgeCases` | 5 | Edge cases |
| `TestNormalizeText` | 3 | Text normalization |
| `TestScenarioEnum` | 2 | Enum validation |
| `TestMatchResult` | 2 | Data class validation |

#### F5.1.3 Status Hook Tests (CREATE NEW)

**File**: `packages/core/hooks/status.test.js`
**Framework**: Jest + mock-fs

| Test Case | Description |
|-----------|-------------|
| `findTrdStateDir()` | Directory traversal from current location |
| `findImplementFiles()` | Discovery of implement.json files |
| `readImplementJson()` | Safe JSON parsing with error handling |
| `wasModifiedRecently()` | Time-based modification checking |
| `clearSessionId()` | State mutation for session cleanup |
| Error handling | Missing files, corrupt JSON, permission errors |

#### F5.1.4 Formatter Hook Tests (CREATE NEW)

**File**: `packages/core/hooks/formatter.test.sh`
**Framework**: BATS (Bash Automated Testing System)

| Test Case | Description |
|-----------|-------------|
| `get_formatter_command()` | Extension routing for all 12+ formatters |
| `get_extension()` | Edge cases (dotfiles, no extension, multiple dots) |
| `parse_file_path()` | JSON extraction with jq and grep fallback |
| Integration | Mock file formatting end-to-end |

#### F5.1.5 Learning Hook Tests (CREATE NEW)

**File**: `packages/core/hooks/learning.test.sh`
**Framework**: BATS

| Test Case | Description |
|-----------|-------------|
| `find_project_root()` | Directory traversal to find project root |
| `is_git_repo()` | Git repository detection |
| `get_changed_files()` | Git status parsing for modified files |
| `is_remote_environment()` | CLAUDE_CODE_REMOTE detection |
| `stage_files()` | File staging with mock git repository |

#### F5.1.6 Wiggum Hook Tests (EXISTING)

**File**: `packages/core/hooks/wiggum.test.js`
**Status**: 75+ tests already created
**Framework**: Jest

Tests already cover:
- Prompt injection logic
- Iteration counting
- Completion detection
- Environment variable handling
- Stop hook pattern

### 5.2 Unit Tests: Scripts

#### F5.2.1 Validation Script Tests

**Script**: `packages/core/scripts/validate-init.sh`
**Test File**: `packages/core/scripts/validate-init.test.sh`
**Framework**: BATS

| Test Case | Description |
|-----------|-------------|
| Valid structure | Complete project structure passes validation |
| Missing directories | Specific error for missing `.claude/`, `docs/`, etc. |
| Missing required files | Specific error for missing `CLAUDE.md`, settings, etc. |
| Invalid JSON | Error handling for malformed settings.json |
| Missing agents | Validation of 12 required agent files |
| Missing governance | Validation of constitution.md, stack.md, process.md |

#### F5.2.2 Scaffolding Script Tests (CREATE NEW)

**Script**: `packages/core/scripts/scaffold-project.sh`
**Test File**: `packages/core/scripts/scaffold-project.test.sh`
**Framework**: BATS

**Note**: Scaffolding logic is currently inline in init-project.md and must be extracted to a testable script.

| Test Case | Description |
|-----------|-------------|
| Creates directories | All required directories created (.claude/, docs/, .trd-state/) |
| Idempotent | Re-running does not fail or duplicate |
| Correct permissions | Directories have correct permissions |
| CWD independence | Works correctly from any current working directory |

### 5.3 Integration Tests: Headless Claude Sessions

#### F5.3.0 Unified Test Scenario Approach

**Purpose**: Create consistent end-to-end validation where test scenarios reinforce each other across the testing pipeline.

**Key Insight**: The test scenarios for skill A/B testing should directly correlate with what `/init-project` installs based on user stories. This creates a complete validation chain: user stories specify tech stack expectations, init-project discovers and installs appropriate skills, and those installed skills are then tested for effectiveness.

**Test Repository Structure**:
```
ensemble-vnext-test-fixtures/
  user-stories/
    python-cli/
      story.md           # "Build a CLI calculator" - specifies Python, pytest
      expected-skills.json  # ["developing-with-python", "pytest"]
    flutter-widget/
      story.md           # "Build a counter widget" - specifies Flutter, Dart
      expected-skills.json  # ["developing-with-flutter"]
    typescript-validation/
      story.md           # "Build a validation module" - specifies TypeScript
      expected-skills.json  # ["developing-with-typescript"]
    fastapi-endpoint/
      story.md           # "Build an API endpoint" - specifies FastAPI, Python
      expected-skills.json  # ["using-fastapi", "developing-with-python"]
    pytest-tests/
      story.md           # "Write tests for validation" - specifies pytest
      expected-skills.json  # ["pytest", "developing-with-python"]
  fixtures/
    empty-project/       # Clean starting point for init tests
    pre-initialized/     # Already has .claude/ structure
```

**Validation Chain**:
1. **Stack Detection Test**: Run `/init-project` in empty directory with user story context
2. **Skill Installation Verification**: Confirm expected skills are installed based on story
3. **Skill A/B Test**: Test those same skills for effectiveness with/without
4. **End-to-End Validation**: User story requirements lead to correct skills lead to quality improvement

**Benefits**:
- Single source of truth for test scenarios
- Skills tested are exactly the skills that would be installed
- Validates complete workflow from requirements to implementation
- User stories can be synced to Claude Web for parallel execution

#### F5.3.1 Test Infrastructure

**Test Repository**: Create new GitHub repository `ensemble-vnext-test-fixtures`:
- Enables syncing with Claude on the web for parallel execution
- Stores test fixtures, user stories, and expected outcomes
- Provides sandboxed test environment separate from main codebase
- Supports web-based parallel test execution

**Test Directory Structure**:
```
test/
  integration/
    fixtures/           # Symlink or reference to test-fixtures repo
    sessions/           # Session log output directory
    scripts/
      run-headless.sh   # Wrapper for Claude execution
      verify-output.sh  # Output verification utilities
    config/
      permissive-allowlist.json  # Bypass permissions for testing
```

**Execution Pattern** (Local):
```bash
claude --prompt "$PROMPT" \
       --session-id "$(uuidgen)" \
       --permissionMode bypassPermissions \
       --output-format jsonl \
       > session-$UUID.jsonl
```

**Execution Pattern** (Web-Based):
```bash
# For tests running on Claude Web
# Clone test-fixtures repo in web session
# Execute test prompt in sandboxed environment
# Capture results for comparison
```

#### F5.3.2 Local Vendoring Tests

**Purpose**: Verify `/init-project` creates correct vendored structure

**Execution Environment**: Claude Web (not local CLI)
- Faster execution
- Parallel execution capabilities
- Sandboxed environment
- Validates a key capability (web execution works correctly)

**Test Scenario**:
1. Create empty test directory in `ensemble-vnext-test-fixtures`
2. Run `/init-project` with predefined stack answers via Claude Web
3. Verify output structure

**Verification Checklist**:
- [ ] `.claude/agents/` contains 12 agent files
- [ ] `.claude/rules/` contains constitution.md, stack.md, process.md
- [ ] `.claude/hooks/` contains all hook files
- [ ] `.claude/skills/` contains stack-appropriate skills
- [ ] `docs/PRD/` directory exists
- [ ] `docs/TRD/` directory exists
- [ ] `.trd-state/` directory exists
- [ ] `CLAUDE.md` created at project root

#### F5.3.3 Skills A/B Testing

**Purpose**: Validate that skills improve code output quality

**Execution Environment**: Claude Web with parallel execution
- Run A and Run B execute simultaneously (not sequentially)
- Faster overall test execution
- Both runs in identical sandboxed environments

**Skills to Test**:

| Skill | Language | Test Assignment |
|-------|----------|-----------------|
| `developing-with-python` | Python | Create a CLI calculator with unit tests |
| `developing-with-flutter` | Dart | Create a counter widget with widget tests |
| `developing-with-typescript` | TypeScript | Create a data validation module with type guards |
| `using-fastapi` | Python | Create an API endpoint with Pydantic models |
| `pytest` | Python | Write tests for a data validation module |

**Note**: Skills selected to avoid external service dependencies. These match the 5 tested skills from the Unified Test Scenario Approach (F5.3.0).

**A/B Test Protocol** (Parallel Web Execution):

For each skill:

1. **Run A (without skill)** - Execute on Claude Web:
   - Remove skill from `.claude/skills/`
   - Run prompt: "Create [assignment description]"
   - Save session log and output files

2. **Run B (with skill)** - Execute on Claude Web simultaneously:
   - Restore skill to `.claude/skills/`
   - Run prompt: "Create [assignment description]. Use the Skill tool to invoke [skill-name]."
   - Save session log and output files

3. **Compare** (after both complete):
   - Skill invocation verified (session log shows Skill tool call)
   - Code quality differences documented
   - Test coverage differences documented
   - Framework-specific patterns applied

**Parallelization**: Run A and Run B for each skill can execute in parallel since they are independent. All 5 skills (10 runs total) can potentially execute simultaneously.

#### F5.3.4 Agent Routing Tests

**Purpose**: Verify agents receive correct delegation and provide value over direct execution

**Agents to Test**:

| Agent | Test Scenario | Verification |
|-------|---------------|--------------|
| `backend-implementer` | Create REST endpoint | Routes to backend agent, uses appropriate skill |
| `verify-app` | Run tests on existing code | Invokes test framework, reports results |
| `code-simplifier` | Refactor complex function | Preserves behavior, reduces complexity |
| `code-reviewer` | Review PR diff | Identifies security issues, follows DoD |

**Standard Verification**:
- Session log shows correct `@agent-name` delegation
- Task tool usage with correct subagent_type

**A/B Comparison for Agent Effectiveness**:

For each agent test scenario, save the prompts and settings as reusable test cases. Then run TWO tests:

1. **Run A (With Agent Delegation)**:
   - Execute prompt with agent routing enabled
   - Agent receives delegation via Task tool
   - Record output quality, time, and accuracy

2. **Run B (Without Agent - Direct Execution)**:
   - Run the same prompt directly in main Claude session
   - No subagent delegation
   - Record output quality, time, and accuracy

3. **Compare and Document**:
   - Quality differences (code quality, completeness)
   - Behavioral differences (tool usage, approach)
   - Value assessment: Does agent specialization improve outcomes?
   - Document findings for each agent

**Rationale**: This A/B comparison validates whether agent delegation provides measurable value over direct execution, helping optimize the agent architecture.

#### F5.3.5 Command Flow Tests

**Purpose**: Verify command execution produces expected artifacts

**Execution Environment**: Local CLI for command orchestration, with remote delegation where appropriate

**Commands to Test**:

| Command | Artifacts | Verification | Execution |
|---------|-----------|--------------|-----------|
| `/init-project` | `.claude/`, `docs/`, `CLAUDE.md` | Full structure validation | Local |
| `/create-prd` | `docs/PRD/*.md` | PRD file created with correct sections | Local |
| `/create-trd` | `docs/TRD/*.md` | TRD file created from PRD reference | Local |
| `/implement-trd` | Implementation + `.trd-state/` | Tasks executed, status tracked | Local with remote delegation |

**Special Verification for `/create-trd`**:
- Verify that the generated TRD documents parallel execution opportunities
- TRD should include session delegation recommendations
- Execution plan should identify independent vs. dependent tasks

**Special Verification for `/implement-trd`**:
- Runs locally as orchestrator
- Should correctly delegate implementation sessions to Claude Web for parallel execution
- Verify remote session delegation occurs when tasks are parallelizable
- Track state coordination between local orchestrator and remote workers

**General Verification**:
- Session log shows correct command loading
- Artifacts created in expected locations
- State files updated correctly
- Git operations performed (if applicable)

#### F5.3.6 Hook Integration Tests

**Purpose**: Verify hooks fire and produce expected effects

| Hook | Trigger | Verification |
|------|---------|--------------|
| Permitter | Any Bash command | Decision logged in session |
| Router | User prompt | Additional context injected |
| Formatter | File edit | File was formatted |
| Learning | Session end | Files staged |
| Status | Subagent stop | implement.json updated |

#### F5.3.7 Wiggum Mode Bounded Test (Phase 2 - Deferred)

**Status**: Deferred to Phase 2

**Rationale for Deferral**:
1. **Current scenario too trivial**: The 3-task test scenario (create hello.txt, world.txt, done.txt) will be one-shotted by Claude without exercising iteration logic
2. **Need multi-phase scenarios**: Effective Wiggum testing requires tasks that force iteration cycles (implement -> verify -> fix cycles)
3. **Unit test coverage sufficient**: The 75+ existing unit tests for wiggum.js provide sufficient coverage for Phase 1, testing:
   - Prompt injection logic
   - Iteration counting
   - Completion detection via BOTH methods:
     - `<promise>COMPLETE</promise>` tag in transcript
     - 100% task completion in implement.json
   - Environment variable handling
   - Stop hook patterns

**Phase 2 Requirements** (to be designed):
- Design multi-phase tasks that cannot be one-shotted
- Include deliberate failures that require fix iterations
- Test scenarios with dependencies between tasks
- Verify Wiggum correctly handles implement -> verify -> debug cycles

**Original Test Scenario** (preserved for Phase 2 reference):

Create TRD with tasks that require iteration:
```markdown
## Master Task List
- [ ] **TRD-T01**: Create a function with intentional bug
- [ ] **TRD-T02**: Write tests that catch the bug
- [ ] **TRD-T03**: Fix the bug to make tests pass
- [ ] **TRD-T04**: Add edge case handling
- [ ] **TRD-T05**: Verify all tests pass
```

**Execution** (Phase 2):
```bash
WIGGUM_ACTIVE=1 WIGGUM_MAX_ITERATIONS=10 \
claude --prompt "/implement-trd --wiggum" \
       --session-id "$(uuidgen)" \
       --permissionMode bypassPermissions
```

**Verification** (Phase 2):
- [ ] Multiple iterations occurred (not one-shotted)
- [ ] Wiggum re-injected prompt (check session log for iterations)
- [ ] Exited on completion (found `<promise>COMPLETE</promise>` OR 100% tasks in implement.json)
- [ ] Did NOT hit max iterations (would indicate bug)
- [ ] Implement -> verify -> fix cycle observed

### 5.4 Observability and Telemetry

**Purpose**: Enable comprehensive analysis of test execution through OpenTelemetry integration

#### 5.4.1 OpenTelemetry Background

Claude Code natively supports OpenTelemetry via environment variables:

```bash
# Enable telemetry for headless test sessions
export CLAUDE_CODE_ENABLE_TELEMETRY=1
export OTEL_METRICS_EXPORTER=otlp
export OTEL_LOGS_EXPORTER=otlp
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317
```

**Events Captured** (useful for test analysis):
- `claude_code.tool_result` - Tool completion with timing and results
- `claude_code.api_request` - API calls to Claude including token usage
- `claude_code.tool_decision` - Permission decisions from Permitter hook

#### 5.4.2 Telemetry Requirements

**R-OT1: Enable for All Headless Sessions**
- All integration test runs MUST have OpenTelemetry enabled
- Update `run-headless.sh` to set telemetry environment variables
- Telemetry should be captured regardless of test pass/fail

**R-OT2: Telemetry Data Analysis**
- Tool usage patterns: Which tools are invoked, frequency, timing
- API call analysis: Token usage, latency, error rates
- Permission decisions: Allowed vs. denied patterns
- Skill invocation verification via telemetry (supplement to session logs)

**R-OT3: Backend Options**
- **CI/Development**: Console exporter for immediate visibility
- **Detailed Analysis**: Lightweight backend (ClickHouse, Grafana Tempo, or Jaeger)
- **Minimum Viable**: File-based export for post-hoc analysis

#### 5.4.3 Telemetry Integration Points

| Test Type | Telemetry Use |
|-----------|---------------|
| Skills A/B Testing | Compare tool usage patterns with/without skills |
| Agent Routing | Verify delegation via tool_decision events |
| Command Flow | Track end-to-end execution timing |
| Hook Integration | Validate hook firing via tool_result events |

#### 5.4.4 Implementation Notes

```bash
# Example: Updated run-headless.sh with telemetry
#!/bin/bash
export CLAUDE_CODE_ENABLE_TELEMETRY=1
export OTEL_METRICS_EXPORTER=console  # or otlp for collector
export OTEL_LOGS_EXPORTER=console
export OTEL_EXPORTER_OTLP_ENDPOINT=${OTEL_ENDPOINT:-http://localhost:4317}

claude --prompt "$PROMPT" \
       --session-id "$(uuidgen)" \
       --permissionMode bypassPermissions \
       --output-format jsonl \
       > "session-$UUID.jsonl"
```

---

## 6. Non-Functional Requirements

### 6.1 Test Execution Performance

| Requirement | Target | Rationale |
|-------------|--------|-----------|
| Unit test suite execution | <2 minutes | Suitable for pre-commit and manual runs |
| Individual hook test file | <30 seconds | Fast feedback during development |
| Headless Claude session (Web) | <5 minutes each | Reasonable for web-based integration testing |
| Full integration suite | <30 minutes | Acceptable for periodic manual verification |
| Parallel A/B tests | <10 minutes total | Web parallelization reduces wall-clock time |

### 6.2 Framework Compatibility

| Component | Framework | Version |
|-----------|-----------|---------|
| JavaScript/Node.js tests | Jest | ^29.0.0 |
| Python tests | pytest | ^7.0.0 |
| Bash tests | BATS | ^1.9.0 |
| Coverage (JS) | Jest built-in | - |
| Coverage (Python) | pytest-cov | ^4.0.0 |
| Telemetry | OpenTelemetry | Claude Code native |

### 6.3 Reproducibility

| Requirement | Implementation |
|-------------|----------------|
| Deterministic test inputs | Fixtures stored in `ensemble-vnext-test-fixtures` repo |
| Session isolation | Unique session IDs per test run |
| Environment consistency | Document required environment variables |
| Seed data | Pre-configured test repositories |
| Telemetry capture | OTel data for post-hoc analysis |

### 6.4 Manual Test Execution

CI/CD integration is not in scope for this repository at this time. Tests are executed manually by developers during development and before merging changes.

**Test Execution Workflow**:
1. Run unit tests locally before committing changes
2. Run integration tests when modifying agents, skills, or commands
3. Run full test suite before creating pull requests
4. Document test results in PR description

---

## 7. Acceptance Criteria

### 7.1 Hook Unit Test Acceptance Criteria

| ID | Criterion |
|----|-----------|
| AC-H1 | Permitter tests: 485/485 tests passing |
| AC-H2 | Router tests: All new tests passing |
| AC-H3 | Status tests: All new tests passing with mock-fs |
| AC-H4 | Formatter tests: All extension mappings covered |
| AC-H5 | Learning tests: Git staging logic verified |
| AC-H6 | Wiggum tests: 75/75 existing tests passing |
| AC-H7 | Combined hook coverage >= 80% |

### 7.2 Script Unit Test Acceptance Criteria

| ID | Criterion |
|----|-----------|
| AC-S1 | validate-init tests cover all validation rules |
| AC-S2 | scaffold-project tests verify idempotency |
| AC-S3 | Combined script coverage >= 80% |

### 7.3 Local Vendoring Acceptance Criteria

| ID | Criterion |
|----|-----------|
| AC-V1 | Empty directory + /init-project produces valid structure |
| AC-V2 | All 12 agent files present in `.claude/agents/` |
| AC-V3 | All governance files present in `.claude/rules/` |
| AC-V4 | Stack-appropriate skills present in `.claude/skills/` |
| AC-V5 | CLAUDE.md generated at project root |

### 7.4 Skills A/B Test Acceptance Criteria

| ID | Criterion |
|----|-----------|
| AC-SK1 | All 5 test skills successfully invoke via Skill tool |
| AC-SK2 | Session logs show skill tool call for Run B |
| AC-SK3 | Quality differences documented for each skill |
| AC-SK4 | No external service dependencies in test assignments |

### 7.5 Agent Routing Acceptance Criteria

| ID | Criterion |
|----|-----------|
| AC-A1 | backend-implementer receives backend tasks |
| AC-A2 | verify-app receives test execution tasks |
| AC-A3 | code-simplifier receives refactoring tasks |
| AC-A4 | code-reviewer receives review tasks |
| AC-A5 | Session logs confirm correct delegation |
| AC-A6 | A/B comparison completed for all 4 agents |
| AC-A7 | Agent effectiveness documented with quality differences |

### 7.6 Command Flow Acceptance Criteria

| ID | Criterion |
|----|-----------|
| AC-C1 | /init-project creates complete vendored structure |
| AC-C2 | /create-prd generates PRD in docs/PRD/ |
| AC-C3 | /create-trd generates TRD from PRD reference with parallelization recommendations |
| AC-C4 | /implement-trd executes tasks and updates status |
| AC-C5 | /implement-trd correctly delegates to remote sessions for parallel tasks |

### 7.7 Wiggum Mode Acceptance Criteria (Phase 2 - Deferred)

| ID | Criterion | Status |
|----|-----------|--------|
| AC-W1 | Multi-phase test completes all tasks | Deferred |
| AC-W2 | Execution terminates on completion signal (promise tag OR 100% tasks) | Deferred |
| AC-W3 | Multiple iterations observed (not one-shotted) | Deferred |
| AC-W4 | Session log shows iteration re-injection | Deferred |
| AC-W5 | Implement -> verify -> fix cycle observed | Deferred |

**Phase 1 Coverage**: Unit tests (75+) for wiggum.js provide sufficient coverage of Wiggum logic.

### 7.8 Telemetry Acceptance Criteria

| ID | Criterion |
|----|-----------|
| AC-T1 | OpenTelemetry enabled for all headless sessions |
| AC-T2 | Telemetry data successfully captured and accessible |

### 7.9 Test Repository Acceptance Criteria

| ID | Criterion |
|----|-----------|
| AC-TR1 | Test repository created and accessible from Claude Web |

### 7.10 Parallel Execution Acceptance Criteria

| ID | Criterion |
|----|-----------|
| AC-AB1 | A/B tests execute in parallel on Claude Web |

---

## 8. Success Metrics

### 8.1 Coverage Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Hook unit test line coverage | >= 80% | Jest/pytest coverage reports |
| Script unit test line coverage | >= 80% | BATS + kcov |
| Permitter test pass rate | 100% (485/485) | Jest test results |
| Router test pass rate | 100% | pytest test results |

### 8.2 Integration Test Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Local vendoring structure validity | 100% checks pass | Verification script |
| Skill invocation success | 5/5 skills | Session log analysis |
| Agent routing accuracy | 4/4 agents | Session log analysis |
| Agent A/B comparison | 4/4 agents documented | Quality assessment reports |
| Telemetry capture rate | 100% of headless sessions | OTel data presence |

### 8.3 Quality Indicators

| Indicator | Success Definition |
|-----------|-------------------|
| Zero regressions | All legacy tests continue passing |
| Documentation | All test procedures documented |
| Manual execution | Clear instructions for running all test types |
| Reproducibility | Tests produce consistent results across runs |
| Parallel execution | Web-based tests run in parallel successfully |
| Telemetry analysis | OTel data informs test result interpretation |

---

## 9. Dependencies and Risks

### 9.1 Dependencies

#### External Dependencies

| Dependency | Purpose | Risk if Unavailable |
|------------|---------|---------------------|
| Claude Code CLI | Headless session execution | Integration tests blocked |
| Claude Web | Parallel test execution | Tests run sequentially only |
| Jest | JavaScript unit testing | Hook tests blocked |
| pytest | Python unit testing | Router tests blocked |
| BATS | Bash unit testing | Shell tests blocked |
| mock-fs | File system mocking for Node.js | Status hook tests limited |
| OpenTelemetry | Test execution analysis | Limited observability |
| GitHub | Test fixtures repository | Must use local fixtures |

#### Internal Dependencies

| Dependency | Purpose | Risk if Unavailable |
|------------|---------|---------------------|
| Legacy Permitter tests | Foundation for permission testing | Must recreate from scratch |
| Legacy Router tests | Foundation for routing testing | Must recreate from scratch |
| Existing Wiggum tests | Autonomous mode testing | Already available |
| ensemble-vnext-test-fixtures | Test scenarios and fixtures | Must create manually |

### 9.2 Risks

#### R1: Non-Deterministic Test Flakiness

**Risk**: Headless Claude session tests may produce inconsistent results due to LLM output variance.

**Mitigation**:
- Design tests to verify behavioral outcomes (artifact created, tool invoked) rather than exact output
- Allow multiple valid outcomes where appropriate
- Document expected variance and acceptable result ranges
- Use telemetry data to diagnose flaky tests

#### R2: Claude Code CLI Changes

**Risk**: Claude Code CLI flags or behavior may change, breaking headless test execution.

**Mitigation**:
- Pin to specific Claude Code version for testing
- Monitor Claude Code release notes
- Maintain abstraction layer in `run-headless.sh`

#### R3: Legacy Test Compatibility

**Risk**: Copied legacy tests may have dependencies on legacy code structure.

**Mitigation**:
- Copy library modules alongside tests
- Update import paths as needed
- Verify tests pass after migration

#### R4: Test Execution Time

**Risk**: Headless Claude sessions may take significant time during manual execution.

**Mitigation**:
- Separate unit tests (fast) from integration tests (slow)
- Provide clear guidance on when to run full vs. partial test suites
- Implement test timeout mechanisms
- Use web-based parallel execution to reduce wall-clock time

#### R5: Permission Bypass Security

**Risk**: Tests using `--permissionMode bypassPermissions` could mask permission-related bugs.

**Mitigation**:
- Dedicated permission integration tests that verify normal permission flow
- Permitter unit tests cover permission logic thoroughly
- Manual verification of permission behavior in real sessions

#### R6: Claude Web Availability

**Risk**: Claude Web may have availability issues or rate limits affecting parallel test execution.

**Mitigation**:
- Fallback to sequential local CLI execution
- Implement retry logic with backoff
- Document both web and local execution options

### 9.3 Assumptions

| Assumption | Rationale |
|------------|-----------|
| Claude Code CLI supports headless execution | Required for integration tests |
| Claude Web supports test repository access | Required for parallel execution |
| Legacy tests are compatible with Jest 29 | Legacy ensemble uses Jest |
| BATS is available in development environment | May require installation step |
| Session logs capture tool invocations | Required for verification |
| OpenTelemetry environment variables work | Documented in Claude Code |

---

## Appendix A: Files to Create

### New Files

| File Path | Purpose |
|-----------|---------|
| `packages/permitter/tests/*.test.js` | Copy from legacy |
| `packages/permitter/lib/*.js` | Copy from legacy |
| `packages/router/tests/test_router.py` | Copy from legacy |
| `packages/core/hooks/status.test.js` | New tests |
| `packages/core/hooks/formatter.test.sh` | New tests |
| `packages/core/hooks/learning.test.sh` | New tests |
| `packages/core/scripts/scaffold-project.sh` | Extract from init-project |
| `packages/core/scripts/validate-init.test.sh` | New tests |
| `packages/core/scripts/scaffold-project.test.sh` | New tests |
| `test/integration/fixtures/*` | Test repositories |
| `test/integration/scripts/run-headless.sh` | Test wrapper with OTel |
| `test/integration/scripts/verify-*.sh` | Verification scripts |
| `test/integration/config/permissive-allowlist.json` | Test config |

### New Repository

| Repository | Purpose |
|------------|---------|
| `ensemble-vnext-test-fixtures` | GitHub repo for test fixtures and user stories |

### Modified Files

| File Path | Modification |
|-----------|--------------|
| `packages/core/commands/init-project.md` | Extract scaffolding to script |
| `package.json` | Add test scripts |

---

## Appendix B: Test Execution Commands

```bash
# Unit Tests
npm run test:permitter   # Jest - Permitter hook
npm run test:hooks       # Jest - All Node.js hooks
pytest packages/router/  # pytest - Router hook
bats packages/core/hooks/*.test.sh  # BATS - Shell hooks
bats packages/core/scripts/*.test.sh  # BATS - Shell scripts

# Integration Tests (with telemetry)
CLAUDE_CODE_ENABLE_TELEMETRY=1 ./test/integration/run-all.sh

# Coverage Reports
npm run test:coverage    # Jest coverage
pytest --cov packages/router/  # pytest coverage
```

---

*This PRD defines the testing requirements for Ensemble vNext. Implementation details will be specified in the corresponding TRD.*
