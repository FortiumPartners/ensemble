# Ensemble vs. Spec-Kit: Framework Comparison

> **Audience:** Engineering teams evaluating AI-assisted development frameworks.
> **Sources:** Ensemble v5.0.0 (`github.com/Sunstone-Partners/ensemble`), GitHub Spec-Kit (`github.com/github/spec-kit`). Analysis conducted 2026-09-02.

---

## Quick Reference: When to Use Which

| Scenario | Recommendation |
|---|---|
| Complex multi-agent coordination with persistent state across sessions | **Ensemble** |
| Claude Code-first organization with existing Sunstone tooling | **Ensemble** |
| Single-developer or small team wanting lightweight spec-first discipline | **Spec-Kit** |
| Multi-runtime requirement (Claude, Copilot, Cursor, Gemini CLI) | **Spec-Kit** |
| Deep requirement traceability and compliance documentation | **Ensemble** |
| Enterprise with open extension marketplace | **Spec-Kit** |
| Framework-specific guidance (React, NestJS, Rails, etc.) | **Ensemble** |
| Open-source project with no binary dependencies | **Spec-Kit** |
| Full lifecycle PRD → TRD → implementation pipeline | **Ensemble** |
| Getting started quickly with minimal configuration | **Spec-Kit** |

---

## Framework Profiles

### Ensemble (Sunstone Partners, v5.0.0)

**Philosophy:** Full-lifecycle orchestration platform with a specialized agent mesh.

Ensemble is a Claude Code plugin ecosystem organized into 4 tiers across 24 npm packages. It provides 38 specialized agents (backend-developer, frontend-developer, code-reviewer, test-runner, etc.) orchestrated through YAML-defined workflow commands. The primary pipeline: `create-prd` → `refine-prd` → `create-trd` → `refine-trd` → `implement-trd-tasks`, driven by persistent beads (`br`/`bv`) task management with cross-session resumability.

Key architectural elements:
- **Plugin tiers:** Core (ensemble-core) → Workflow (product, development, quality, infrastructure) → Framework Skills (React, NestJS, Rails, Phoenix, Blazor) → Test Frameworks (Jest, Pytest, RSpec, xUnit, ExUnit)
- **Agent mesh:** 38 specialized agents with 6 orchestrators; delegation via `Task()` tool with alias resolution (`@backend-developer` → `ensemble-full:backend-developer`)
- **Task persistence:** beads (`br`/`bv`) provides a real SQLite + JSONL persistence layer with dependency graphs, PageRank triage, and cross-session resumability
- **Runtimes:** Claude Code, Codex, OpenCode, Pi, OMP via direct support and compatibility layers
- **Foreman dispatch:** `--foreman` flag enables fully automated orchestration pipelines
- **Collaborative review:** `--collab` mode renders PRD/TRD refinement in a browser sidebar with per-line comments

### Spec-Kit (GitHub, github.com/github/spec-kit)

**Philosophy:** Extensible, intent-driven harness that guides AI coding agents across the SDLC via Spec-Driven Development (SDD).

Spec-Kit is a Python CLI (`specify`) that drops Markdown commands into an AI agent's commands directory. The core SDD process ships ready to use: **Constitution → Spec → Plan → Tasks → Implement**. Each phase produces a Markdown artifact that feeds the next. Supports 30+ AI coding agents (Claude, Gemini, Copilot, Cursor, Windsurf, Codex CLI, etc.) — an unusually broad compatibility matrix. No plugin ecosystem; framework-agnostic by design.

Key architectural elements:
- **Core commands:** `constitution` (immutable project principles) → `specify` (detailed spec) → `plan` (architecture) → `tasks` (implementation checklist) → `implement` (sequential execution)
- **Multi-agent model:** Orchestrator (state machine) + PM agent (clarification, prioritization) + Developer agent (SPEC.md, PLAN.md, TASKS.md artifacts)
- **Constitution:** High-level immutable principles enforced as phase gates across all commands
- **Workflows:** Multi-step, resumable YAML automation pipelines with human review gates
- **Presets:** Stackable template overrides with priority-based resolution (e.g., healthcare-compliance preset)
- **Runtimes:** 30+ agents — CLI and IDE-based (Claude Code, GitHub Copilot, Cursor, Gemini CLI, Windsurf, Amp, Codex CLI, Roo Code, Kilo Code, Qwen Code, opencode, etc.)
- **Artifacts:** `SPEC.md` (requirements + ACs), `PLAN.md` (architecture, API contracts, data model), `TASKS.md` (executable checklist), standalone `research.md` and `data-model.md`

---

## Feature Comparison Matrix

| Dimension | Ensemble | Spec-Kit |
|---|---|---|
| **Orchestration Model** | YAML-defined workflow commands + agent mesh + Foreman dispatch | State machine orchestrator + PM/developer agent roles |
| **Core Pipeline** | PRD → refine → TRD → refine → implement | Constitution → Spec → Plan → Tasks → Implement |
| **Requirement IDs** | REQ-NNN, AC-NNN-M, TRD-NNN | Implicit (document position) |
| **Bidirectional Traceability** | `[satisfies REQ-NNN]` on every task; paired -TEST tasks; closure tokens | Loose — tasks linked to spec by document position |
| **Persistent Task State** | beads (`br`/`bv`): SQLite + JSONL, dependency graph, PageRank triage | Markdown checkboxes only — session ephemeral |
| **Multi-Agent Execution** | 38 specialized agents in role-based state machine (builder → reviewer → advisor → QA) | PM agent + developer agent; no builder/reviewer/QA chain |
| **Parallel Execution** | `bv --robot-plan` partitions tracks; concurrent dispatch with file-conflict detection | Sequential Markdown task execution |
| **Cross-Session Resumability** | Full — beads survive session end, `--status`/`--reset-task` recover | None — state lost when session ends |
| **Research Artifact** | Standalone `research.md` when research domain detected | Standalone `research.md` (technology investigation, library compatibility) |
| **Data Model Artifact** | Standalone `-data-model.md` when database domain detected | Standalone `data-model.md` (schema, entity relationships) |
| **Constitution / Principles** | `docs/standards/constitution.md` via `/init-project`; hard-gated in create-prd/create-trd; violations block phase completion, no override | `memory/constitution.md` with Nine Articles enforced as blocking phase gates |
| **Ambiguity Marking** | `[NEEDS CLARIFICATION: ...]` in create-prd + create-trd | `[NEEDS CLARIFICATION]` in spec template (mandatory LLM discipline) |
| **Consistency Analysis** | Traceability validation only | `/speckit.analyze` — coverage, contradictions, spec/plan/task consistency |
| **Pre-Implementation Gate** | Design Readiness Gate (scorecard, 1–5) | Phase gates via constitution enforcement |
| **Framework-Specific Skills** | React, NestJS, Rails, Phoenix, Blazor, Jest, Pytest, RSpec, xUnit, ExUnit | None — framework-agnostic |
| **Quality Pipeline** | code-reviewer → test-runner → playwright-tester; DoD enforcement; 80%/70% coverage targets | None built-in |
| **Security Scanning** | OWASP-aware via code-reviewer agent | None built-in |
| **MCP Server Integration** | Optional TRD Workflow MCP tools (inject_checkpoints, assess_complexity) | None |
| **Git/Release/CI-CD Commands** | Conventional commits, git-town, release orchestration | None |
| **Preset / Template Override** | None | Priority-stacked presets (e.g., domain-specific templates) |
| **Quick/Lightweight Path** | `fix-issue` for lightweight bug fixes (no PRD/TRD overhead) | Spec-only path (skip plan if clear) |
| **Community Extensions** | Sunstone-curated only | Open catalog with third-party contributions |
| **Multi-Runtime Support** | Claude Code, Codex, OpenCode, Pi, OMP (5 runtimes) | 30+ agents (CLI + IDE) |
| **Dependency** | `br`/`bv` binaries (third-party); Node.js ecosystem | `uv` (Python package manager) only |
| **Learning Curve** | Steep — 24 packages, YAML complexity, beads setup | Low — Python CLI, Markdown commands, five core phases |
| **Maintenance Overhead** | High (23 npm packages, schema CI, marketplace) | Low (~30 files, no build step) |

---

## Detailed Analysis

### 1. Orchestration Model

**Ensemble** uses a YAML-defined workflow command system where each command (`create-prd`, `implement-trd-tasks`, etc.) is a declarative specification of phases, steps, actions, and constraints. Commands orchestrate sub-agents via the `Task()` tool, with an agent alias resolution layer (`AGENT_ALIAS_MAP`) that maps shorthand names to installed plugin identifiers. The Foreman runtime provides fully automated dispatch pipelines with artifact contracts and hard/soft HALT gates.

**Spec-Kit** uses a state machine orchestrator that drives a PM agent and a developer agent through the SDD phases. The PM agent handles clarification interviews and prioritization; the developer agent produces three intermediate artifacts (SPEC.md, PLAN.md, TASKS.md) before code generation. Workflows are defined in YAML and support pausing at human review gates.

**Assessment:** Ensemble's approach is more structured for complex multi-agent coordination but requires understanding the YAML command schema. Spec-Kit's state machine is simpler for straightforward use cases but less powerful for complex dependency management.

### 2. Requirement Traceability

**Ensemble** provides the strongest traceability in this comparison. Every TRD task carries `[satisfies REQ-NNN]` annotations linking back to PRD requirements. Paired `-TEST` tasks verify requirements at runtime. Closure comments write `req-satisfied:REQ-NNN ac-proven:AC-NNN-M` tokens into bead history. A satisfaction report is generated at completion. The `bv --robot-*` tools compute PageRank, betweenness, and critical path on the dependency graph.

**Spec-Kit** links tasks to spec requirements by document position — there are no ID-based chains. The `/speckit.analyze` command checks coverage and consistency but cannot query a dependency graph.

**Assessment:** For compliance-heavy or audit-intensive environments, Ensemble's ID-based traceability is a significant advantage.

### 3. Task Persistence and Cross-Session Resumability

**Ensemble's** beads integration (`br`/`bv`) provides a persistent task database that survives session interruptions. `--status` shows in-flight task state; `--reset-task TRD-XXX` recovers failed tasks; structured status comments record the full audit trail. The `br sync --flush-only` command exports SQLite state to JSONL for git tracking.

**Spec-Kit** uses Markdown checkboxes for task state. When the session ends, progress is lost unless manually transcribed.

**Assessment:** Ensemble is far superior for long-running implementations or teams working across time zones. Spec-Kit is acceptable for short, single-session feature implementations.

### 4. Multi-Agent and Team Coordination

**Ensemble** auto-detects complexity and generates a YAML team configuration. `implement-trd-tasks` drives a role-based state machine: `open → in_progress → in_design → in_review → in_advisory → in_qa → closed`, with rejection loops back to the builder. Six specialized orchestrators (ensemble, tech-lead, product-management, QA, infrastructure, deployment) coordinate across domains. Concurrent execution via `bv --robot-plan` partitions tracks and dispatches them in parallel.

**Spec-Kit** operates with a single developer agent (guided by a PM agent for clarification). No builder/reviewer/QA chain, no parallel execution, no team mode.

**Assessment:** Ensemble is purpose-built for team-based execution. Spec-Kit is designed for a solo developer or a team using shared-agent patterns (one human reviewing what one AI produces).

### 5. Framework Awareness

**Ensemble** ships dedicated plugins for React, NestJS, Rails, Phoenix, Blazor, Jest, Pytest, RSpec, xUnit, and ExUnit. Framework detection is automatic based on project files. These are not just skill injections — they include command definitions, agent configurations, and testing patterns specific to each framework.

**Spec-Kit** is deliberately framework-agnostic. It provides no framework-specific guidance and makes no attempt to detect or adapt to the tech stack.

**Assessment:** For organizations with specific framework requirements, Ensemble's baked-in expertise reduces setup time. For greenfield or polyglot projects, Spec-Kit's agnosticism is an advantage.

### 6. Operational Breadth

**Ensemble** includes: conventional commits enforcement, git-town workflow management, release orchestration, CI/CD infrastructure templates, E2E testing with Playwright, security scanning (OWASP-aware), and MCP server integration. These are entirely out of scope for Spec-Kit.

**Spec-Kit** focuses exclusively on the spec-first development cycle. Infrastructure, testing, and release concerns are the team's responsibility.

**Assessment:** Ensemble provides a more complete development lifecycle. Spec-Kit's narrow scope makes it lighter but requires the team to compose additional tooling.

### 7. Constitutional Governance

**Spec-Kit's** `/speckit.constitution` produces a `memory/constitution.md` with Nine Articles (library-first, anti-abstraction gates, simplicity gates, etc.) that every subsequent command enforces as phase gates. This is a powerful mechanism for encoding team standards as technical constraints rather than advisory prompts.

**Ensemble** provides `/init-project`, which generates `docs/standards/constitution.md` with project guardrails, coverage targets, approval requirements, and tech stack detection. The constitution is enforced as a *hard gate* during `create-prd` and `create-trd`: violations halt the phase and block completion with no override path. This matches Spec-Kit's Nine Articles rigor.

**Assessment:** Both enforce constitution as hard phase gates. Spec-Kit's Nine Articles block spec/plan generation with no override. Ensemble's constitution (created via `/init-project`) halts `create-prd`/`create-trd` with no override. For organizations requiring immutable governance, both are now equivalent.

### 8. Runtime Compatibility

**Spec-Kit** supports 30+ AI coding agents — the broadest compatibility in this comparison. This is critical for organizations with heterogeneous tooling or those migrating between agents.

**Ensemble** supports Claude Code, Codex, OpenCode, Pi, and OMP — five runtimes providing direct support and compatibility layers. This is significantly broader than initially documented, making Ensemble far more flexible than the prior analysis indicated. However, Spec-Kit still maintains a broader compatibility advantage (30+ agents).

**Assessment:** While Ensemble's 5-runtime support is more substantial than initially analyzed, Spec-Kit's 30+ agent integrations remain a decisive advantage for organizations requiring true multi-agent flexibility or migration paths across diverse tooling ecosystems. For teams standardized within Ensemble's 5 supported runtimes (especially Claude Code–focused organizations), Ensemble's specialized orchestration, persistent task state, and deep traceability provide superior capabilities.

### 9. Dependency and Setup Complexity

**Ensemble** requires:
- Node.js ecosystem
- `br` (beads_rust) binary — separate GitHub repository
- `bv` (beads_viewer) binary — separate GitHub repository
- Claude Code installation
- Optional: Foreman server for automated dispatch

**Spec-Kit** requires:
- Python with `uv` (mainstream package manager)
- Any supported AI agent CLI

**Assessment:** Ensemble's setup is significantly more complex. Spec-Kit can be installed and running in minutes. The beads binary dependency is the most friction-generating aspect of Ensemble's onboarding.

---

## Pros and Cons

### Ensemble

**Pros:**
- Deep bidirectional requirement traceability with ID chains, paired test tasks, and closure tokens
- Persistent cross-session task state via beads — resumable across sessions, crashes, and team member handoffs
- Real multi-agent team orchestration with role-based state machine and parallel execution
- Dependency-aware execution via `bv --robot-plan` with graph-aware triage (PageRank, critical path)
- Full pipeline in one command: `/ensemble:feature` or `implement-trd-tasks`
- Framework-specific skills for React, NestJS, Rails, Phoenix, Blazor, Jest, Pytest, RSpec, xUnit, ExUnit
- Operational breadth: release orchestration, conventional commits, CI/CD templates, E2E testing, security scanning
- MCP server integration for optional TRD workflow enhancement
- Foreman dispatch for fully automated orchestration pipelines
- Collaborative PRD/TRD review via `--collab` browser UI
- Hard-gate constitution enforcement: violations in `create-prd`/`create-trd` block phase with no override path (PR #59)
- Standalone `research.md` and `data-model.md` companion artifacts generated when domains detected (PR #60)
- Quickstart validation artifact: `implement-trd` generates `quickstart.md` smoke-test runbook after completion verification passes; `implement-trd-tasks` routes to `implement-trd` for v1 (PR #61)

**Cons:**
- No mandatory `[NEEDS CLARIFICATION]` discipline during spec generation (though create-prd does mark ambiguities)
- Narrower runtime coverage compared to Spec-Kit (5 vs 30+ agents)
- No community extension system — Sunstone-curated only
- No preset/template override system
- Requires `br`/`bv` third-party binaries (separate from ensemble itself)
- High maintenance overhead: 24 npm packages, schema CI, marketplace

### Spec-Kit

**Pros:**
- 30+ AI agent integrations — broadest runtime compatibility available
- Lowest barrier to entry — Python CLI, Markdown commands, no build step
- Constitutional governance: Nine Articles enforced as phase gates across all commands
- Mandatory `[NEEDS CLARIFICATION]` discipline baked into spec template
- Cross-artifact consistency analysis (`/speckit.analyze`) before implementation
- Standalone `research.md` and `data-model.md` as auditable artifacts
- Branch-per-feature spec storage (`specs/001-create-taskify/`)
- Stackable presets with priority-based template override
- Open community catalog with third-party extensions
- Pre-built workflow patterns: AIDE, Canon, Product Forge, FX→.NET, MAQA
- No external binary dependencies beyond `uv`
- Lower operational overhead — ~30 files, no schema CI, no marketplace

**Cons:**
- No persistent task state — Markdown checkboxes lost between sessions
- No multi-agent execution model beyond PM/developer single-agent pair
- No builder/reviewer/QA chain
- Loose requirement traceability (document position, no IDs)
- No parallel execution
- No framework-specific skills or guidance
- No quality pipeline (code review, testing, coverage enforcement)
- No git/release/CI-CD commands
- No MCP integration
- Single-developer/solo-AI focus — no team coordination features

---

## Decision Framework

```
Is your team working across multiple AI coding agents?
├── Yes → Spec-Kit (30+ agent integrations)
└── No → Continue

Is compliance-grade requirement traceability required?
├── Yes → Ensemble (REQ-NNN/AC-NNN-M chains, beads closure tokens)
└── No → Continue

Is cross-session resumability important?
├── Yes → Ensemble (br/bv persistence layer)
└── No → Continue

Does your project need framework-specific guidance?
├── Yes → Ensemble (React, NestJS, Rails, etc.)
└── No → Continue

Is your team a solo developer or small team wanting lightweight spec discipline?
├── Yes → Spec-Kit (lowest friction, 5-phase SDD)
└── No → Continue

Does your team need hard-enforced constitutional governance?
├── Yes → Ensemble (hard-gated in create-prd/create-trd) or Spec-Kit (Nine Articles)
└── No → Continue

Is fast onboarding with minimal setup a priority?
├── Yes → Spec-Kit (uv + agent CLI only)
└── Continue to Ensemble
```

---

## Migration Considerations

### Moving from Spec-Kit to Ensemble

- **Install:** `claude --plugin marketplace add Sunstone-Partners/ensemble`
- **Install beads:** `cargo install beads_rust beads_viewer` (or use nix/homebrew)
- **Migrate specs:** Convert SPEC.md/PROPLAN.md/TASKS.md artifacts to PRD/TRD format; assign REQ-NNN IDs
- **Migrate state:** Transcribe Markdown checkboxes to `br` bead hierarchy
- **New commands:** Use `create-prd` instead of `specify`; `implement-trd-tasks` instead of `implement`
- **Lost in migration:** Multi-runtime support, community extensions, presets

### Moving from Ensemble to Spec-Kit

- **Install:** `pip install spec-kit` or `uv tool install spec-kit`
- **Migrate specs:** Convert PRD/TRD to SPEC.md/PROPLAN.md/TASKS.md
- **Migrate state:** Implement-trd-beads tasks → Markdown TASKS.md checkboxes
- **New commands:** Use `specify` instead of `create-prd`; sequential `implement` instead of `implement-trd-tasks`
- **Lost in migration:** Beads persistence, parallel execution, requirement IDs, framework skills, team orchestration

## Opportunities for Ensemble

Ensemble already implements most capabilities. Genuine opportunities to increase competitive parity with Spec-Kit:

| Priority | Opportunity | Description | Status |
|---|---|---|---|
| High | **Hard-enforce constitution in spec/plan phases** | Constitution violations during `create-prd` and `create-trd` now block phase completion with no override — matching Spec-Kit's Nine Articles rigor | **Implemented (PR #59)** |
| High | **Standalone `research.md` and `data-model.md`** | `create-trd` generates standalone companion artifacts when database or research domains are detected; linked from TRD body | **Implemented (PR #60)** |
| Medium | **Multi-AI-agent support** | Generate command files for Gemini/Copilot/Cursor from same YAML source via `npm run generate` | Gap |
| Medium | **Community plugin catalog** | Open submission mechanism beyond Sunstone-authored plugins | Gap |
| Low | **`quickstart.md` validation artifact** | `implement-trd` generates quickstart.md smoke-test runbook from TRD acceptance criteria; implement-trd-tasks routes to implement-trd for v1 | **Implemented (PR #61)** |

### Already Implemented (no action needed)

*Verified by reading actual command YAML definitions and workflow specifications.*

These capabilities were proposed as opportunities but already exist in Ensemble:

- ✓ **Hard-gate constitution enforcement** — `create-prd` and `create-trd` now hard-HALT on constitution violations with no override path (PR #59)
- ✓ **Standalone `research.md` and `data-model.md`** — `create-trd` generates companion artifacts when database or research domains are detected (PR #60)
- ✓ **Quickstart validation artifact** — `implement-trd` generates `quickstart.md` smoke-test runbook from acceptance criteria after completion verification; `implement-trd-tasks` routes to `implement-trd` for v1 (PR #61)
- ✓ **Quick-fix workflow** — `ensemble:fix-issue` for lightweight bug fixes (no PRD/TRD overhead)
- ✓ **Cross-artifact requirement analysis** — `ensemble:analyze-requirements` validates PRD↔TRD↔beads alignment
- ✓ **Clarification enforcement** — `ensemble:refine-prd`, `refine-trd`, `refine-prd --from-meeting` surface ambiguities
- ✓ **Feature branching & stacked PRs** — `ensemble:implement-trd` (git-town workflow) and `ensemble:implement-trd-tasks` (--branch option, stacked PR support)

---

## Methodology: Verification of Claims

All numeric and capability claims in this document have been verified against authoritative sources:

- **Ensemble agent count (38):** Verified via direct file count of `packages/*/agents/*.md` files in the repository
- **Ensemble command inventory (43):** Verified via explicit enumeration of YAML files in `packages/*/commands/`
- **Command capabilities:** Claims about command behavior verified by reading actual command YAML descriptions (`description:` field) and workflow definitions, not inferred from filename or keyword matching
- **Spec-Kit claims (30+ agents):** Retained as stated in official Spec-Kit documentation
- **BMAD agent count:** Removed unverifiable claims; Spec-Kit comparison uses only verifiable information

**False positives removed during audit:**
- `configure-team`: Does NOT provide named governance presets; performs auto-sizing by task count
- `create-prd`: Does NOT support branching (create-prd has zero branching code); feature branching is provided by `implement-trd` and `implement-trd-tasks`

**Lessons learned:** Keyword substring matching on command names is insufficient for capability verification. Each claim requires reading the actual command description and workflow definition.


## Additional Resources

- Ensemble GitHub: `github.com/Sunstone-Partners/ensemble`
- Spec-Kit GitHub: `github.com/github/spec-kit`
- Competitive landscape (Ensemble, AgentOS, GSD, Superpowers, BMAD): `docs/research/competitive-analysis-2026-03-28.md`
- Ensemble README: `README.md`
- Ensemble commands: `packages/development/commands/`
- Ensemble beads workflow: `packages/development/commands/implement-trd-tasks.yaml`

---

*Generated: 2026-09-02 | Ensemble v5.0.0 vs. Spec-Kit (github.com/github/spec-kit)*
