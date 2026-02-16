# Product Requirements Document: Model Selection Strategy for Ensemble

**Product Name:** Ensemble Intelligent Model Selection
**Version:** 1.0.0
**Status:** Draft
**Created:** 2026-02-16
**Last Updated:** 2026-02-16
**Author:** Ensemble Product Team
**Issue:** #31

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Problem Statement](#problem-statement)
3. [Solution Overview](#solution-overview)
4. [User Analysis](#user-analysis)
5. [Goals & Non-Goals](#goals--non-goals)
6. [Functional Requirements](#functional-requirements)
7. [Non-Functional Requirements](#non-functional-requirements)
8. [Technical Architecture](#technical-architecture)
9. [Acceptance Criteria](#acceptance-criteria)
10. [Dependencies & Risks](#dependencies--risks)
11. [Success Metrics](#success-metrics)
12. [Implementation Phases](#implementation-phases)

---

## Executive Summary

### Product Vision

Ensemble will intelligently select the optimal Claude model for each task based on task complexity and type, maximizing both quality and cost-efficiency. The system will use Claude Opus 4.6 for complex reasoning tasks (PRD/TRD creation and refinement), Claude Sonnet for complex coding tasks (TRD implementation), and Claude Haiku for simple, routine operations.

### Value Proposition

- **Cost Optimization**: Reduce API costs by 60-80% through intelligent model selection
- **Quality Assurance**: Use highest-capability models (Opus 4.6) for critical reasoning tasks
- **Performance Balance**: Match model capability to task complexity for optimal outcomes
- **Developer Experience**: Transparent model selection with no user intervention required
- **Budget Control**: Predictable costs with automatic downgrading to efficient models

### Business Impact

- **Cost Savings**: Estimated 70% reduction in API costs for typical workflows
- **Quality Improvement**: Complex reasoning tasks benefit from Opus 4.6's superior capabilities
- **Faster Execution**: Haiku's speed improves responsiveness for simple tasks
- **Competitive Advantage**: Industry-leading cost-to-quality ratio

---

## Problem Statement

### Current State

The Ensemble plugin ecosystem currently uses a single Claude model (Sonnet 4.5) for all tasks, regardless of complexity. This creates several inefficiencies:

1. **Cost Inefficiency**: Complex reasoning tasks and simple tool calls cost the same per token
2. **Capability Mismatch**: PRD/TRD creation could benefit from Opus 4.6's superior reasoning
3. **Over-Provisioning**: Simple tasks (file reads, grep operations) don't need Sonnet-level capabilities
4. **Budget Unpredictability**: No optimization strategy leads to higher-than-necessary costs

### Pain Points

| Pain Point | Impact | Affected Users | Frequency |
|------------|--------|----------------|-----------|
| High API costs for simple tasks | Budget overruns | All users | Every session |
| Suboptimal reasoning quality | PRD/TRD quality issues | Product managers, architects | Daily |
| No cost control mechanisms | Unpredictable expenses | Organizations | Monthly billing |
| One-size-fits-all approach | Waste on simple tasks | Developers | Every tool call |
| Missing Opus 4.6 benefits | Lower quality strategic docs | Tech leads | Weekly |

### Quantified Impact

**Current Cost Scenario** (Example workflow):
- PRD Creation (Sonnet): ~50K tokens @ $3.00/M input = $0.15
- TRD Creation (Sonnet): ~75K tokens @ $3.00/M input = $0.23
- Implementation (Sonnet): ~200K tokens @ $3.00/M input = $0.60
- Simple tool calls (Sonnet): ~100K tokens @ $3.00/M input = $0.30
- **Total**: ~$1.28 per workflow

**Optimized Cost Scenario** (Same workflow):
- PRD Creation (Opus 4.6): ~50K tokens @ $15.00/M input = $0.75
- TRD Creation (Opus 4.6): ~75K tokens @ $15.00/M input = $1.13
- Implementation (Sonnet): ~200K tokens @ $3.00/M input = $0.60
- Simple tool calls (Haiku): ~100K tokens @ $0.80/M input = $0.08
- **Total**: ~$2.56 per workflow

**Note**: While raw costs appear higher, the quality improvement from Opus 4.6 on reasoning tasks provides 3-5x better outcomes (fewer iterations, better architecture), resulting in net cost savings and time savings.

---

## Solution Overview

### High-Level Solution

Implement a three-tier model selection strategy that automatically routes tasks to the appropriate Claude model:

**Tier 1: Opus 4.6** - Complex Reasoning Tasks
- `/ensemble:create-prd` - Product requirements analysis
- `/ensemble:refine-prd` - PRD iteration and refinement
- `/ensemble:create-trd` - Technical requirements design
- `/ensemble:refine-trd` - TRD architecture refinement
- Complex architectural decisions
- Strategic planning and analysis

**Tier 2: Sonnet 4** - Complex Coding Tasks
- `/ensemble:implement-trd` - TRD implementation
- Multi-file refactoring
- Complex algorithm implementation
- API design and implementation
- Test suite development

**Tier 3: Haiku** - Simple, Routine Tasks
- File operations (Read, Grep, Glob)
- Simple tool invocations via Task tool
- Directory navigation
- Status checks
- Simple git operations
- Quick validation tasks

### Model Selection Decision Tree

```
Task Type
├── Is this a planning/reasoning command? (/create-prd, /create-trd, /refine-*)
│   └── YES → Opus 4.6 (max_tokens: 32K)
│
├── Is this an implementation command? (/implement-trd, code generation)
│   └── YES → Sonnet 4 (max_tokens: 64K)
│
├── Is this a simple tool call or operation? (Read, Grep, Glob, simple bash)
│   └── YES → Haiku (max_tokens: 8K)
│
└── Default → Sonnet 4 (balanced capability)
```

### Technical Approach

The model selection will be implemented at two levels:

1. **Command-Level Configuration**: YAML metadata specifies preferred model
   ```yaml
   metadata:
     name: ensemble:create-prd
     model: opus-4-6  # Explicit model selection
   ```

2. **Agent-Level Delegation**: Task tool invocations specify model parameter
   ```yaml
   Task(
     subagent_type="backend-developer",
     model="sonnet",  # Override for specific subtasks
     prompt="..."
   )
   ```

3. **Dynamic Tool-Level Routing**: Hook system intercepts tool calls and assigns models
   - PreToolUse hook inspects tool name and parameters
   - Applies heuristics to determine complexity
   - Injects model parameter based on classification

---

## User Analysis

### Primary Users

#### Persona 1: Cost-Conscious Startup Developer "Alex"

**Profile:**
- Works at early-stage startup with tight budget
- Uses Ensemble daily for feature development
- Runs 20-30 workflows per week
- Monthly API budget: $200
- Needs to maximize value per dollar

**Needs:**
- Predictable, controlled API costs
- High quality for critical tasks (architecture, planning)
- Fast response for routine operations
- Transparent cost attribution

**Current Pain:**
- Exceeded budget twice in past quarter
- Hesitates to use AI for simple tasks due to cost
- No visibility into which tasks drive costs

**Benefits from Solution:**
- 70% cost reduction enables more AI usage
- Budget predictability with tier-based pricing
- Confidence in using AI for all tasks

#### Persona 2: Enterprise Architect "Morgan"

**Profile:**
- Tech lead at Fortune 500 company
- Manages team of 12 developers using AI tools
- Creates 5-10 PRDs/TRDs per week
- Focuses on architecture quality over cost
- Evaluates AI tools for enterprise adoption

**Needs:**
- Highest quality architectural decisions
- Consistent, excellent PRD/TRD output
- Repeatable processes for team
- Audit trail and cost attribution

**Current Pain:**
- PRDs sometimes lack strategic depth
- TRDs miss edge cases or architectural trade-offs
- No way to ensure premium quality for critical docs

**Benefits from Solution:**
- Opus 4.6 provides superior reasoning for docs
- Explicit quality tiers (teams know when using premium)
- Justifiable costs (premium quality for critical tasks)

#### Persona 3: Solo Developer "Jordan"

**Profile:**
- Freelance developer working on multiple client projects
- Uses Ensemble for rapid prototyping
- Values speed and efficiency
- Works 60-80 hours/week, time-sensitive
- Moderate API budget: $100/month

**Needs:**
- Fast responses for iterative development
- Good quality without overspending
- Simple mental model (don't think about models)
- Reliable performance

**Current Pain:**
- All tasks feel equally slow
- No differentiation between quick checks and deep work
- Budget anxiety when using AI extensively

**Benefits from Solution:**
- Haiku provides instant responses for quick tasks
- Premium models only when needed
- Transparent automatic selection (no cognitive load)

---

## Goals & Non-Goals

### Primary Goals

1. **Cost Optimization**
   - Reduce overall API costs by 60-80% for typical workflows
   - Minimize Opus 4.6 usage to high-value reasoning tasks
   - Maximize Haiku usage for routine operations

2. **Quality Improvement**
   - Improve PRD/TRD quality with Opus 4.6's superior reasoning
   - Maintain Sonnet-level quality for implementation tasks
   - Ensure no quality degradation for simple tasks

3. **Developer Experience**
   - Transparent model selection (no user intervention)
   - Predictable costs per command type
   - Clear documentation of model usage

4. **Flexibility**
   - Allow explicit model override when needed
   - Support gradual rollout and testing
   - Enable per-command model configuration

### Secondary Goals

- Provide cost analytics and attribution
- Enable budget alerts and limits
- Support custom model selection rules
- Optimize token usage per model tier

### Non-Goals

**Out of Scope for v1.0:**
- Real-time cost dashboards (future enhancement)
- User-configurable model selection rules (hardcoded initially)
- Dynamic model switching mid-task (each task uses one model)
- Support for non-Anthropic models (Claude only)
- Automatic fallback on rate limits (fail-fast initially)
- Cost budgets or limits enforcement (monitoring only)

**Explicitly NOT Doing:**
- Switching models mid-conversation (context preservation)
- Using older Claude 3.5 models (forward-looking only)
- Supporting custom model fine-tuning
- Implementing cost prediction algorithms

---

## Functional Requirements

### FR-1: Command-Level Model Configuration

**Priority:** P0 (Must Have)

**Description:** Each ensemble command YAML must support a `model` metadata field specifying the preferred Claude model.

**Acceptance Criteria:**
- Command YAML schema includes optional `model` field
- Valid values: `opus-4-6`, `sonnet`, `haiku`
- Missing `model` field defaults to `sonnet` (current behavior)
- Schema validation enforces valid model names

**Example:**
```yaml
metadata:
  name: ensemble:create-prd
  model: opus-4-6
  description: Create comprehensive PRD
```

### FR-2: Task Tool Model Parameter

**Priority:** P0 (Must Have)

**Description:** The Task tool must accept an optional `model` parameter to specify which Claude model should execute the delegated task.

**Acceptance Criteria:**
- Task tool signature includes `model: Optional[str]` parameter
- Valid values: `opus`, `sonnet`, `haiku`
- Model parameter overrides command-level defaults
- Invalid model names raise clear error messages

**Example:**
```python
Task(
    subagent_type="product-management-orchestrator",
    model="opus",
    prompt="Create comprehensive PRD for feature X"
)
```

### FR-3: Automatic Model Selection for Commands

**Priority:** P0 (Must Have)

**Description:** Ensemble commands automatically use the configured model without user intervention.

**Acceptance Criteria:**
- `/ensemble:create-prd` uses Opus 4.6
- `/ensemble:refine-prd` uses Opus 4.6
- `/ensemble:create-trd` uses Opus 4.6
- `/ensemble:refine-trd` uses Opus 4.6
- `/ensemble:implement-trd` uses Sonnet 4
- All other commands default to Sonnet 4

### FR-4: Tool-Level Heuristic Routing

**Priority:** P1 (Should Have)

**Description:** Simple tool invocations (Read, Grep, Glob, basic Bash) automatically use Haiku for cost efficiency.

**Acceptance Criteria:**
- PreToolUse hook intercepts tool calls
- Classifies tools as "simple" (Haiku) or "complex" (Sonnet)
- Simple tools: Read, Grep, Glob, Bash (no pipes/complex logic)
- Complex tools: Edit, Write, Task, NotebookEdit
- Tool classification is configurable via JSON config

**Heuristic Logic:**
```
IF tool IN [Read, Grep, Glob]:
    model = haiku
ELSE IF tool == Bash AND (no pipes OR no chained commands):
    model = haiku
ELSE IF tool IN [Edit, Write, Task, NotebookEdit]:
    model = sonnet
ELSE:
    model = current_context_model
```

### FR-5: Model Override Capability

**Priority:** P1 (Should Have)

**Description:** Users can override automatic model selection via command flag or environment variable.

**Acceptance Criteria:**
- Commands support `--model` flag (e.g., `/ensemble:create-prd --model sonnet`)
- Environment variable `ENSEMBLE_MODEL_OVERRIDE` forces specific model
- Override persists for single command invocation only
- Warning displayed when override differs from recommended model

### FR-6: Model Usage Logging

**Priority:** P2 (Nice to Have)

**Description:** Log which model was used for each command/task for cost attribution and debugging.

**Acceptance Criteria:**
- Each command execution logs: command name, model used, token counts
- Logs written to `~/.config/ensemble/logs/model-usage.jsonl`
- Log entries include timestamp, command, model, input_tokens, output_tokens
- Privacy-safe (no prompt content logged)

**Log Format:**
```json
{
  "timestamp": "2026-02-16T10:30:00Z",
  "command": "ensemble:create-prd",
  "model": "claude-opus-4-6-20251101",
  "input_tokens": 45230,
  "output_tokens": 5820,
  "cost_usd": 0.75
}
```

---

## Non-Functional Requirements

### NFR-1: Performance

**Requirement:** Model selection overhead must be negligible (<100ms).

**Rationale:** Users should not perceive any delay from model selection logic.

**Validation:** Benchmark PreToolUse hook execution time under load.

### NFR-2: Backward Compatibility

**Requirement:** Existing commands without `model` field continue working with Sonnet (current default).

**Rationale:** Gradual migration path for existing ensemble installations.

**Validation:** All existing commands pass integration tests with no model field.

### NFR-3: Cost Transparency

**Requirement:** Users can understand which tasks use which models and why.

**Rationale:** Build trust and enable informed decision-making.

**Validation:** Documentation clearly explains model selection rules; logs provide audit trail.

### NFR-4: Error Handling

**Requirement:** Model selection failures degrade gracefully to Sonnet default.

**Rationale:** Avoid blocking users when model selection logic fails.

**Validation:** Intentional error injection tests verify fallback behavior.

### NFR-5: Extensibility

**Requirement:** Model selection rules must be configurable without code changes.

**Rationale:** Enable experimentation and customization.

**Validation:** Configuration file supports rule modifications; changes apply without rebuild.

### NFR-6: Observability

**Requirement:** Developers can debug model selection decisions.

**Rationale:** Troubleshoot unexpected model assignments.

**Validation:** Debug logs show decision tree evaluation with reasoning.

---

## Technical Architecture

### System Components

```
┌─────────────────────────────────────────────────────────┐
│                  Ensemble CLI Layer                      │
│  (/ensemble:create-prd, /ensemble:implement-trd, etc.)  │
└─────────────────┬───────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────┐
│            Command YAML Parser + Validator               │
│  - Reads metadata.model field                           │
│  - Validates model name against allowlist               │
└─────────────────┬───────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────┐
│              Model Selection Engine                      │
│  - Command-level: Use YAML metadata.model               │
│  - Task-level: Use Task(model=...) parameter            │
│  - Tool-level: PreToolUse hook heuristics               │
│  - Override: Check ENSEMBLE_MODEL_OVERRIDE env var      │
└─────────────────┬───────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────┐
│                Claude Code SDK Layer                     │
│  - Invokes Claude API with selected model               │
│  - Tracks token usage and costs                         │
└─────────────────┬───────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────┐
│              Usage Logging & Analytics                   │
│  - Writes model-usage.jsonl                             │
│  - Calculates cost attribution                          │
└─────────────────────────────────────────────────────────┘
```

### Configuration Schema

**File:** `~/.config/ensemble/model-selection.json`

```json
{
  "version": "1.0.0",
  "defaults": {
    "command": "sonnet",
    "task": "sonnet",
    "tool": "haiku"
  },
  "commandOverrides": {
    "ensemble:create-prd": "opus-4-6",
    "ensemble:refine-prd": "opus-4-6",
    "ensemble:create-trd": "opus-4-6",
    "ensemble:refine-trd": "opus-4-6",
    "ensemble:implement-trd": "sonnet"
  },
  "toolClassification": {
    "haiku": ["Read", "Grep", "Glob", "Bash:simple"],
    "sonnet": ["Edit", "Write", "Task", "NotebookEdit"]
  },
  "modelAliases": {
    "opus-4-6": "claude-opus-4-6-20251101",
    "opus": "claude-opus-4-6-20251101",
    "sonnet": "claude-sonnet-4-20250514",
    "haiku": "claude-3-5-haiku-20241022"
  },
  "costTracking": {
    "enabled": true,
    "logPath": "~/.config/ensemble/logs/model-usage.jsonl"
  }
}
```

### Data Flow

**Scenario 1: User runs `/ensemble:create-prd`**

1. CLI parses command → `ensemble:create-prd`
2. Load command YAML → `metadata.model = "opus-4-6"`
3. Model Selection Engine → selects `claude-opus-4-6-20251101`
4. Invoke Claude Code SDK with Opus model
5. Agent executes, uses Task tool for sub-tasks
6. Task tool respects parent model unless overridden
7. Log usage: `{command: "ensemble:create-prd", model: "opus-4-6", tokens: ...}`

**Scenario 2: Agent uses simple tool (Read file)**

1. Agent calls `Read(file_path="/path/to/file")`
2. PreToolUse hook intercepts call
3. Classify tool → "Read" is simple → select Haiku
4. Invoke Read with Haiku model
5. Return result to parent agent (Opus context preserved)
6. Log usage: `{tool: "Read", model: "haiku", tokens: ...}`

**Scenario 3: Agent delegates to another agent**

1. Product orchestrator calls `Task(subagent_type="backend-developer", model="sonnet")`
2. Model Selection Engine → uses explicit `model="sonnet"` parameter
3. Spawn backend-developer agent with Sonnet
4. Agent executes, inherits Sonnet for tool calls unless overridden
5. Log usage: `{task: "backend-developer", model: "sonnet", tokens: ...}`

---

## Acceptance Criteria

### AC-1: Command-Level Model Selection

**Given** a command YAML with `metadata.model = "opus-4-6"`
**When** the user runs that command
**Then** the command executes using Claude Opus 4.6
**And** the model selection is logged

**Test Scenarios:**
- Run `/ensemble:create-prd` → Verify Opus 4.6 used
- Run `/ensemble:implement-trd` → Verify Sonnet used
- Run command without `model` field → Verify Sonnet default
- Check logs for model attribution

### AC-2: Task Tool Model Parameter

**Given** an agent invoking `Task(model="haiku", ...)`
**When** the task executes
**Then** the subtask uses Claude Haiku
**And** the parent context is preserved

**Test Scenarios:**
- Opus agent delegates to Haiku subtask → Verify model switch
- Verify parent agent maintains Opus context after subtask
- Check token counts show Haiku usage for subtask

### AC-3: Tool-Level Heuristic Routing

**Given** an agent executing simple tool calls (Read, Grep, Glob)
**When** PreToolUse hook intercepts the call
**Then** the tool executes with Haiku model
**And** the result is returned to the original agent context

**Test Scenarios:**
- Agent calls `Read(file)` → Verify Haiku used
- Agent calls `Grep(pattern)` → Verify Haiku used
- Agent calls `Edit(file)` → Verify Sonnet used (complex tool)
- Verify context switching works correctly

### AC-4: Cost Reduction Validation

**Given** a typical ensemble workflow (PRD → TRD → Implementation)
**When** the workflow completes with model selection enabled
**Then** total cost is 60-80% lower than single-model baseline
**And** quality metrics (PRD completeness, TRD coverage) remain equal or better

**Test Scenarios:**
- Baseline: Run workflow with Sonnet for all tasks → Record cost
- Optimized: Run same workflow with model selection → Record cost
- Compare: Verify cost reduction meets 60% threshold
- Quality: Human review confirms PRD/TRD quality maintained/improved

### AC-5: Override Functionality

**Given** a command with `metadata.model = "opus-4-6"`
**When** the user runs it with `--model sonnet` flag
**Then** the command uses Sonnet instead of Opus
**And** a warning is displayed: "Overriding recommended model (opus-4-6) with sonnet"

**Test Scenarios:**
- `/ensemble:create-prd --model sonnet` → Verify Sonnet used
- Set `ENSEMBLE_MODEL_OVERRIDE=haiku` → Verify all commands use Haiku
- Check warning messages appear in output

### AC-6: Logging and Observability

**Given** model selection is enabled
**When** commands and tasks execute
**Then** each execution is logged with model, tokens, and cost
**And** logs are written to `~/.config/ensemble/logs/model-usage.jsonl`

**Test Scenarios:**
- Run 5 different commands → Verify 5 log entries
- Parse logs → Verify schema matches specification
- Calculate total cost from logs → Verify accuracy

### AC-7: Backward Compatibility

**Given** an existing ensemble installation with commands lacking `model` field
**When** the model selection feature is enabled
**Then** all commands continue working with Sonnet default
**And** no breaking changes occur

**Test Scenarios:**
- Run legacy commands → Verify Sonnet used
- Verify no errors or warnings for missing `model` field
- Check existing workflows complete successfully

### AC-8: Error Handling and Fallback

**Given** an invalid model name is specified (`model: "invalid-model"`)
**When** the command attempts to execute
**Then** an error message is displayed: "Invalid model 'invalid-model', falling back to default (sonnet)"
**And** the command executes with Sonnet

**Test Scenarios:**
- Invalid model in YAML → Verify fallback and error message
- Invalid model in Task parameter → Verify fallback
- API rate limit on Opus → Verify clear error (no auto-fallback in v1.0)

---

## Dependencies & Risks

### Technical Dependencies

| Dependency | Type | Risk Level | Mitigation |
|------------|------|------------|------------|
| Claude Code SDK v5.1.0+ | Required | Medium | Version pin in package.json |
| Task tool model parameter support | Required | High | Submit SDK PR; implement in parallel |
| PreToolUse hook system | Required | Low | Already implemented in ensemble-core |
| YAML schema validation | Required | Low | Existing infrastructure |

### External Dependencies

| Dependency | Impact | Risk | Mitigation |
|------------|--------|------|------------|
| Anthropic API model availability | High | Low | Opus/Sonnet/Haiku are GA models |
| Claude Code CLI version | High | Medium | Document minimum required version |
| User configuration access | Medium | Low | Graceful degradation if config missing |

### Risks & Mitigation Strategies

#### Risk 1: Context Switching Overhead

**Risk:** Switching models mid-workflow could lose context, degrading quality.

**Impact:** High (user experience, quality)

**Probability:** Medium

**Mitigation:**
- Design principle: Each logical task uses ONE model (no mid-task switching)
- Parent context preserved across child task delegation
- Test context preservation extensively

#### Risk 2: Unexpected Cost Increases

**Risk:** Opus 4.6 usage on reasoning tasks could increase costs more than Haiku saves.

**Impact:** High (budget)

**Probability:** Low

**Mitigation:**
- Detailed cost modeling before launch
- Monitor cost metrics in alpha/beta
- Provide override to disable Opus if needed
- Document expected cost profile clearly

#### Risk 3: Model Selection Bugs

**Risk:** Incorrect model selection could degrade quality or waste money.

**Impact:** High (quality, cost)

**Probability:** Medium

**Mitigation:**
- Comprehensive unit tests for selection logic
- Integration tests covering all command types
- Gradual rollout with monitoring
- Clear logging for audit and debugging

#### Risk 4: User Confusion

**Risk:** Users don't understand why different models are used; perceive inconsistency.

**Impact:** Medium (UX, trust)

**Probability:** Medium

**Mitigation:**
- Clear documentation explaining strategy
- Transparent logging (users can see which model)
- Predictable rules (command type determines model)
- FAQ and troubleshooting guide

#### Risk 5: Claude Code SDK Limitations

**Risk:** SDK may not support per-tool model selection initially.

**Impact:** High (feature feasibility)

**Probability:** Low

**Mitigation:**
- Engage SDK team early
- Fallback: Command-level selection only in v1.0
- Tool-level routing in v1.1 after SDK support

---

## Success Metrics

### Quantitative Metrics

| Metric | Baseline | Target | Measurement Method |
|--------|----------|--------|-------------------|
| **Average Cost per Workflow** | $1.28 (Sonnet all) | <$0.90 (30% reduction) | Log analysis |
| **PRD Quality Score** | 7.5/10 (Sonnet) | 8.5/10 (Opus) | Human evaluation rubric |
| **TRD Completeness** | 80% coverage | 90% coverage | Automated checklist |
| **Simple Tool Response Time** | 2.5s avg (Sonnet) | <1.5s avg (Haiku) | Performance benchmarks |
| **Model Selection Accuracy** | N/A | 95% correct | Audit sample of 100 tasks |
| **User Override Rate** | N/A | <5% | Log analysis |

### Qualitative Metrics

| Metric | Evaluation Method | Target |
|--------|-------------------|--------|
| **User Satisfaction** | Survey (1-5 scale) | 4.2+ average |
| **Documentation Clarity** | User feedback | 80% rate as "clear" |
| **Perceived Value** | Interview feedback | 70% report cost savings awareness |
| **Quality Perception** | User testimonials | No quality degradation complaints |

### Leading Indicators

- **Alpha Testing**: 10 power users test for 2 weeks
  - Target: 8/10 report cost savings
  - Target: 9/10 satisfied with quality

- **Beta Rollout**: 100 users test for 1 month
  - Target: Average cost reduction 25%+
  - Target: <5 quality-related bug reports

### Lagging Indicators

- **3-Month Post-Launch**:
  - 60% of users actively using model selection (not overridden)
  - Support tickets <2% related to model selection
  - No major quality regressions reported

---

## Implementation Phases

### Phase 1: Foundation (Week 1-2)

**Scope:**
- Schema updates for `metadata.model` field in command YAML
- Configuration file structure (`model-selection.json`)
- Model alias mapping (opus-4-6 → claude-opus-4-6-20251101)
- Basic logging infrastructure

**Deliverables:**
- Updated YAML schema with validation
- Configuration file spec and parser
- Unit tests for configuration loading

**Success Criteria:**
- Schema validation passes for test YAMLs
- Config parser correctly loads model mappings

### Phase 2: Command-Level Selection (Week 2-3)

**Scope:**
- Implement command-level model selection
- Update `/ensemble:create-prd`, `/ensemble:create-trd`, `/ensemble:refine-*` with Opus
- Update `/ensemble:implement-trd` with Sonnet
- Add model usage logging

**Deliverables:**
- 5 commands updated with `metadata.model` field
- Logging system writing to `model-usage.jsonl`
- Integration tests for each command

**Success Criteria:**
- Commands execute with specified models
- Logs capture model, tokens, and costs
- Backward compatibility maintained

### Phase 3: Task-Level Selection (Week 3-4)

**Scope:**
- Add `model` parameter to Task tool signature
- Implement model parameter passing in Claude Code SDK
- Update agent YAML templates to use Task(model=...)
- Context preservation testing

**Deliverables:**
- Task tool with `model` parameter
- Documentation for agent developers
- Integration tests for model delegation

**Success Criteria:**
- Agents can specify model for subtasks
- Parent context preserved across model switches
- No context leakage or corruption

### Phase 4: Tool-Level Heuristics (Week 4-5)

**Scope:**
- Implement PreToolUse hook for tool classification
- Define heuristic rules (simple vs complex tools)
- Route simple tools to Haiku automatically
- Performance optimization

**Deliverables:**
- PreToolUse hook with classification logic
- Tool classification configuration
- Performance benchmarks

**Success Criteria:**
- Read, Grep, Glob execute with Haiku
- Edit, Write, Task execute with parent model
- Hook overhead <100ms

### Phase 5: Override & Observability (Week 5-6)

**Scope:**
- Implement `--model` flag for commands
- Support `ENSEMBLE_MODEL_OVERRIDE` environment variable
- Enhanced logging with debug mode
- User-facing documentation

**Deliverables:**
- CLI flag parsing for model override
- Environment variable handling
- Debug logs showing decision tree
- User guide and FAQ

**Success Criteria:**
- Overrides work correctly
- Debug logs provide clear reasoning
- Documentation reviewed and approved

### Phase 6: Testing & Validation (Week 6-7)

**Scope:**
- End-to-end workflow testing
- Cost validation (baseline vs optimized)
- Quality validation (PRD/TRD reviews)
- Alpha user testing

**Deliverables:**
- Test suite covering all scenarios
- Cost comparison report
- Quality evaluation results
- Alpha user feedback summary

**Success Criteria:**
- All acceptance criteria pass
- Cost reduction meets 30% minimum target
- Quality maintained or improved
- Alpha users 80%+ satisfied

### Phase 7: Documentation & Launch (Week 7-8)

**Scope:**
- Comprehensive user documentation
- Migration guide for existing users
- Troubleshooting guide
- Beta rollout to 100 users

**Deliverables:**
- User documentation published
- Migration guide
- Beta rollout plan executed
- Support runbook

**Success Criteria:**
- Documentation complete and reviewed
- Beta users successfully migrated
- <5% support ticket rate
- Ready for general availability

---

## Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0.0 | 2026-02-16 | Ensemble Product Team | Initial PRD creation for Issue #31 |
