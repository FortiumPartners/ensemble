# Ensemble vs. BMAD vs. Spec-Kit: Framework Comparison

> **Audience:** Engineering teams evaluating AI-assisted development frameworks.
> **Sources:** Ensemble v5.0.0 (`github.com/Sunstone-Partners/ensemble`), BMAD Method v6.8.0 (`github.com/bmad-code-org/bmad-method`), GitHub Spec-Kit (`github.com/github/spec-kit`). Analysis conducted 2026-09-02.

---

## Quick Reference: When to Use Which

| Scenario | Recommendation |
|---|---|
| Complex multi-agent team orchestration with persistent state | **Ensemble** |
| Scale-adaptive planning (small changes → complex initiatives) | **BMAD** |
| Multi-runtime requirement (Claude, Copilot, Cursor, Gemini CLI) | **Spec-Kit** |
| Deep requirement traceability with compliance documentation | **Ensemble** |
| Lightweight, agile-first AI-driven development | **BMAD** |
| Framework-specific guidance (React, NestJS, Rails, etc.) | **Ensemble** |
| Universal domain expansion (not just software) | **BMAD** |
| Single-developer with spec-first discipline | **Spec-Kit** |
| Enterprise with persistent cross-session task state | **Ensemble** |
| Rapid iteration with right-sized planning | **BMAD** |

---

## Framework Profiles

### Ensemble (Sunstone Partners, v5.0.0)

**Philosophy:** Full-lifecycle orchestration platform with specialized agent mesh and persistent task state.

Ensemble is a Claude Code plugin ecosystem organized into 4 tiers across 24 npm packages. It provides 38 specialized agents orchestrated through YAML-defined workflow commands. The primary pipeline: `create-prd` → `refine-prd` → `create-trd` → `refine-trd` → `implement-trd-tasks`, driven by persistent beads (`br`/`bv`) task management with cross-session resumability and dependency-aware triage.

Key architectural elements:
- **Plugin tiers:** Core → Workflow → Framework Skills → Test Frameworks
- **Agent mesh:** 38 specialized agents; delegation via Task() tool
- **Task persistence:** beads SQLite + JSONL with dependency graphs and PageRank
- **Runtimes:** Claude Code, Codex, OpenCode, Pi, OMP
- **Enforcement:** Hard-gate constitution in create-prd/create-trd (violations block phase, no override)
- **Scope:** Full lifecycle PRD → TRD → implement, plus `fix-issue` for quick fixes without PRD/TRD overhead

### BMAD (BMAD Code, v6.8.0)

**Philosophy:** Scale-adaptive, agile-first AI-driven development that right-sizes planning to work complexity.

BMAD is an npm-installable Node.js CLI providing specialized agents organized by agile roles (Analyst, Product Manager, Architect, Developer, Tester). The framework uses markdown agents and YAML workflows to orchestrate planning and delivery. Scale-adaptive intelligence automatically adjusts depth: Quick Flow for bug fixes and small features (straight to spec/build); fuller planning for complex initiatives. Expansion packs extend beyond software into any domain.

Key architectural elements:
- **Agent roles:** Analyst, Product Manager, Architect, Product Owner, Developer, Scrum Master, Tester
- **Scale-adaptive workflows:** Brief → PRD → Architecture → Stories → Code (depth varies)
- **Quick Flow:** Bypass planning for trivial changes
- **Documentation-first:** All decisions become version-controlled artifacts
- **Runtimes:** Claude Code, Cursor, OpenAI Codex CLI
- **Expansion packs:** Domain specialization (Game Dev, Creative, Testing, etc.)
- **Web bundles:** Planning via Gemini Gems and ChatGPT Custom GPTs

### Spec-Kit (GitHub, github.com/github/spec-kit)

**Philosophy:** Extensible, intent-driven harness via Spec-Driven Development with constitutional governance.

Spec-Kit is a Python CLI providing 30+ agent support and core SDD process: Constitution → Spec → Plan → Tasks → Implement. Each phase produces Markdown artifacts. No plugin ecosystem; framework-agnostic by design. Constitutional governance via immutable Nine Articles enforced as hard phase gates.

---

## Feature Comparison Matrix

| Dimension | Ensemble | BMAD | Spec-Kit |
|---|---|---|---|
| **Orchestration Model** | YAML workflow commands + agent mesh + Foreman dispatch | YAML workflows + markdown agents; scale-adaptive | State machine orchestrator + PM/developer roles |
| **Core Pipeline** | PRD → TRD → implement | Brief → PRD → Architecture → Stories → Code | Constitution → Spec → Plan → Tasks → Implement |
| **Planning Depth** | Fixed (PRD + TRD phases) | Adaptive (Quick Flow or full) | Fixed (5 phases) |
| **Requirement IDs** | REQ-NNN, AC-NNN-M, TRD-NNN | Document-based (artifact references) | Implicit (document position) |
| **Bidirectional Traceability** | ID-based chains with closure tokens | Story→Architecture→Code mapping | Document position linking |
| **Persistent Task State** | beads (SQLite + JSONL, cross-session) | Workflow artifacts only (session ephemeral) | Markdown checkboxes (session ephemeral) |
| **Multi-Agent Execution** | 38 agents; role-based state machine | Multiple agents; agile role-based orchestration | PM + developer agent pair |
| **Parallel Execution** | `bv --robot-plan` concurrent dispatch | Sequential workflow phases | Sequential task execution |
| **Cross-Session Resumability** | Full — beads survive session end | No — workflow artifacts restart | No — state lost |
| **Team Mode** | Auto-detects complexity; generates config | Built-in agile team roles | Single agent guidance |
| **Design/Architecture Artifact** | Embedded in TRD | Standalone `architecture.md` | Standalone `PLAN.md` |
| **Research Artifact** | Standalone `research.md` when research domain detected | Embedded in Brief/PRD | Standalone `research.md` |
| **Data Model Artifact** | Standalone `-data-model.md` when database domain detected | Embedded in architecture | Standalone `data-model.md` |
| **Quick/Lightweight Path** | `fix-issue` command (lightweight bug fixes) | Quick Flow (spec straight to build) | Spec-only path (skip plan if clear) |
| **Constitution / Principles** | `docs/standards/constitution.md` via `/init-project`; hard-gated in create-prd/create-trd | Implicit in agent personas; not formalized | `memory/constitution.md` Nine Articles; hard-gated |
| **Expansion/Specialization** | Framework-specific plugins only | Expansion packs (domain-agnostic) | Community catalog (third-party) |
| **Multi-Runtime Support** | Claude Code, Codex, OpenCode, Pi, OMP (5) | Claude Code, Cursor, Codex CLI (3) | 30+ agents (broadest) |
| **Setup Complexity** | High (Node.js, br/bv binaries, Claude Code) | Medium (Node.js CLI, AI agent) | Low (Python uv, any agent) |
| **Learning Curve** | Steep (24 packages, YAML, beads) | Medium (agile roles, workflows, markdown) | Low (Python, Markdown) |
| **Maintenance Overhead** | High (npm packages, schema CI) | Medium (expansion packs, npm) | Low (~30 files) |

---

## Detailed Analysis

### 1. Planning Depth & Scope Adaptivity

**Ensemble** enforces a fixed pipeline: PRD → TRD → implement. Every feature receives the same depth of planning regardless of complexity. This ensures consistency but may add overhead for trivial changes.

**BMAD** implements scale-adaptive intelligence. Quick Flow skips planning for well-defined bug fixes or small features, jumping straight to spec and build. Larger initiatives receive fuller planning (Brief → PRD → Architecture → Stories). The framework sizes itself to the work.

**Spec-Kit** offers a middle ground: five fixed phases but allows skipping plan phase if the spec is sufficiently detailed. Less adaptive than BMAD, less prescriptive than Ensemble.

**Assessment:** For organizations with mixed-complexity workloads (both trivial and complex changes), BMAD's scale-adaptivity is a significant advantage. Ensemble's fixed depth is better for consistency-heavy environments. Spec-Kit requires manual judgment to skip phases.

### 2. Agent Organization & Specialization

**Ensemble** provides 38 specialized agents with deep expertise per domain (backend-developer, frontend-developer, code-reviewer, etc.). Agents are Claude Code plugins with framework-specific skills (React, NestJS, Rails).

**BMAD** provides agents organized by agile roles (Analyst, Product Manager, Architect, Developer, Tester, Scrum Master). Role-based rather than domain-specific; expansion packs add domain expertise (Game Dev, Creative, Testing).

**Spec-Kit** uses a simpler model: PM agent + developer agent. No specialized domain agents.

**Assessment:** Ensemble offers the deepest specialization for specific stacks. BMAD's role-based model is more intuitive for agile teams. Spec-Kit's simplicity reduces cognitive overhead for small teams.

### 3. Documentation-First vs. Code-First

**Ensemble** prioritizes specs (PRD/TRD) but keeps implementation at the center. Agents orchestrate code delivery; specs guide, not constrain.

**BMAD** is explicitly documentation-first: every decision becomes a version-controlled artifact (Brief, PRD, Architecture, Stories, Code). Artifacts drive decisions; code follows.

**Spec-Kit** is spec-driven: SPEC.md → PLAN.md → TASKS.md → code. Documentation is the single source of truth.

**Assessment:** For compliance-heavy or audit-intensive environments, documentation-first (BMAD, Spec-Kit) is superior. For rapid iteration, code-first (Ensemble) may be faster.

### 4. Task Persistence & Cross-Session Workflow

**Ensemble** shines here: beads persistence layer survives session interruptions. Teams can resume work across time zones or after crashes with full audit trail.

**BMAD** and **Spec-Kit** both rely on session ephemeral state. Workflow artifacts are version-controlled but not actively managed across sessions.

**Assessment:** Ensemble is far superior for long-running projects, asynchronous teams, or complex implementations. BMAD and Spec-Kit are acceptable for single-session or short feature work.

### 5. Constitutional Governance

**Ensemble** provides `/init-project` generating `docs/standards/constitution.md` with guardrails and quality gates. Enforcement is hard-gated in `create-prd` and `create-trd`: violations halt the phase with no override — matching Spec-Kit's rigor.

**BMAD** embeds governance in agent personas (Analyst ensures scope, Architect ensures contracts). Governance is implicit, not formalized as a document.

**Spec-Kit** enforces Nine Articles as immutable hard-phase-gates that block spec/plan generation.

**Assessment:** Ensemble and Spec-Kit are equally rigorous on constitutional governance. BMAD's persona-based governance is lightweight but less formally enforceable.

### 6. Lightweight vs. Comprehensive Tooling

**Ensemble** is comprehensive: includes git-town, conventional commits, release orchestration, CI/CD templates, E2E testing, security scanning, MCP integration.

**BMAD** is lean core + modular expansion packs. Core focuses on planning/delivery; specializations (Game Dev, Creative, Testing) via opt-in packs.

**Spec-Kit** is spec-focused only; infrastructure/testing/release are user's responsibility.

**Assessment:** Ensemble provides the most complete lifecycle. BMAD's modular approach scales better. Spec-Kit's narrowness makes it lightweight.

---

## Pros and Cons

### Ensemble

**Pros:**
- Deep bidirectional requirement traceability with ID chains and closure tokens
- Persistent cross-session task state via beads — resumable across sessions/crashes
- 38 specialized agents with framework-specific skills (React, NestJS, Rails, etc.)
- Dependency-aware execution with PageRank triage
- Complete operational breadth (git, CI/CD, release, metrics, testing, security)
- Multi-runtime support (Claude Code, Codex, OpenCode, Pi, OMP — 5 runtimes)
- Standalone `research.md` and `data-model.md` companion artifacts when domains detected
- Quickstart validation runbook: `implement-trd` generates `quickstart.md` smoke-test runbook from acceptance criteria; `implement-trd-tasks` routes to `implement-trd` for v1
- Hard-gate constitution enforcement in create-prd/create-trd (matching Spec-Kit's rigor)

**Cons:**
- Fixed planning depth (all work follows PRD→TRD pipeline; lightweight `fix-issue` for trivial changes)
- High setup complexity (br/bv binaries, Node.js ecosystem)
- High maintenance overhead (24 npm packages)
- Requires Claude Code (OpenCode/Codex/Pi/OMP require translation)
- Learning curve steep (YAML, beads, 4-tier plugin system)

### BMAD

**Pros:**
- Scale-adaptive planning (Quick Flow for small, fuller for complex)
- Documentation-first with all decisions version-controlled
- Lightweight core + opt-in expansion packs (lean and extensible)
- Multiple agents organized by intuitive agile roles
- Medium setup complexity (Node.js CLI)
- Multi-agent orchestration with clear role separation
- Web Bundles for planning via Gemini/ChatGPT
- Open-source community (strong community)

**Cons:**
- No persistent task state (artifacts only)
- No cross-session resumability
- No multi-runtime support (Claude Code, Cursor, Codex CLI only — 3)
- No specialized framework skills (agile roles only)
- No hard-enforce constitution (implicit governance via personas)
- No built-in quality pipeline (code review, testing, coverage enforcement)
- Sequential workflow phases (no parallel execution)

### Spec-Kit

**Pros:**
- Broadest multi-runtime support (30+ agents)
- Hard-enforce constitution (immutable Nine Articles)
- Lowest barrier to entry (Python, Markdown)
- Mandatory [NEEDS CLARIFICATION] discipline
- Cross-artifact consistency analysis
- Standalone research.md and data-model.md
- Open community catalog with third-party extensions

**Cons:**
- No persistent task state
- No multi-agent execution (PM + developer only)
- Loose requirement traceability (document position, no IDs)
- No specialized framework skills
- No quality pipeline (testing, coverage enforcement)
- No git/release/CI-CD commands
- Single-developer focus (no team mode)

---

## Decision Framework

```
Does your team need persistent, resumable task state across sessions?
├── Yes → Ensemble (beads persistence)
└── No → Continue

Does your team work on mixed-complexity changes (small + large)?
├── Yes → BMAD (scale-adaptive planning)
└── No → Continue

Do you need 30+ AI agent runtimes (Copilot, Cursor, etc.)?
├── Yes → Spec-Kit (broadest support)
└── No → Continue

Is deep requirement traceability + compliance documentation critical?
├── Yes → Ensemble (REQ-NNN/AC-NNN-M chains)
└── No → Continue

Do you want a lean, extensible core with opt-in specializations?
├── Yes → BMAD (expansion packs)
└── No → Continue

Is your team organized by agile roles (Analyst, Architect, Developer, Tester)?
├── Yes → BMAD (role-based agents)
└── No → Continue

Does your stack include React, NestJS, Rails, Phoenix, or Blazor?
├── Yes → Ensemble (framework-specific plugins)
└── No → Continue

Do you need immutable, hard-enforced constitutional governance?
├── Yes → Ensemble (create-prd/create-trd hard-gate) or Spec-Kit (Nine Articles phase gates)
└── No → Continue

Is multi-runtime support essential?
├── Yes → Spec-Kit (30+) or BMAD (3)
└── No → Ensemble or BMAD
```

---

## Migration Paths

### Ensemble → BMAD
- **Loss:** Persistent beads state, framework-specific skills, full requirement traceability, hard-gate constitution
- **Gain:** Scale-adaptive planning, lightweight core, expansion packs, role-based agents
- **Path:** Export TRD tasks → BMAD story format; migrate architecture to architecture.md; rebuild in BMAD workflows

### BMAD → Ensemble

- **Loss:** Scale-adaptive quick paths, expansion packs, lean core
- **Gain:** Persistent task state, framework-specific expertise, requirement ID chains, comprehensive tooling
- **Path:** Convert Brief/PRD → Ensemble PRD format; convert stories → TRD format; assign REQ-NNN IDs; set up beads

### Spec-Kit ↔ BMAD

- **Loss:** Hard-enforce constitution (BMAD has none); persistent state (neither has it)
- **Gain (BMAD):** Scale-adaptive planning, expansion packs, multiple agents vs. 2
- **Gain (Spec-Kit):** 30+ runtimes, hard-enforce constitution, consistent discipline
- **Path:** Both use Markdown artifacts; convert Spec.md/Plan.md/Tasks.md to BMAD format or vice versa

---

## When to Choose Each

### Choose Ensemble If:
- Cross-session, asynchronous team coordination is critical
- Requirement traceability and compliance documentation required
- Your stack includes React/NestJS/Rails/Phoenix/Blazor
- You need end-to-end lifecycle orchestration (PRD through release)
- Claude Code is your primary (or only acceptable) runtime
- You want persistent, resumable task graphs with dependency awareness

### Choose BMAD If:
- Your workload is mixed (small fixes + complex features)
- You want lightweight core with opt-in specializations
- Agile team roles (Analyst, Architect, Developer) are natural to your org
- Documentation-first discipline appeals to your team
- You want rapid iteration without excessive planning overhead for trivial changes
- You're building a custom domain via expansion packs

### Choose Spec-Kit If:
- You need to support 30+ AI agent runtimes (Copilot, Cursor, Gemini, etc.)
- Hard-enforce constitutional governance is non-negotiable
- Your team is solo/small and spec-first discipline fits your culture
- You want the lowest barrier to entry and setup friction
- You need framework-agnostic guidance (polyglot stacks)
- You plan to extend via community-contributed plugins

---

## Ecosystem & Community

| Framework | Community Size | Ecosystem | Maturity |
|---|---|---|---|
| **Ensemble** | Sunstone-curated; growing | 24 npm packages; 4-tier plugins | v5.0.0 (stable) |
| **BMAD** | Open-source community | Lean core + 5+ expansion packs | v6.8.0 (active development) |
| **Spec-Kit** | GitHub community; Discord | Open catalog with third-party plugins | Stable |

---

## Additional Resources

- **Ensemble GitHub:** github.com/Sunstone-Partners/ensemble
- **Ensemble README:** README.md (this repo)
- **Ensemble Commands:** packages/development/commands/
- **BMAD GitHub:** github.com/bmad-code-org/bmad-method
- **BMAD Documentation:** docs.bmad-method.org
- **Spec-Kit GitHub:** github.com/github/spec-kit
- **Competitive Landscape:** docs/research/competitive-analysis-2026-03-28.md

---

*Generated: 2026-09-02 | Ensemble v5.0.0 vs. BMAD v6.8.0 vs. Spec-Kit | Analysis of orchestration models, planning depth, agent specialization, and governance*
