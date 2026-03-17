---
date: 2026-03-16
author: ensemble analysis
---

# ensemble vs spec-kit: Gap Analysis

> Comparison of [ensemble](https://github.com/FortiumPartners/ensemble) and [spec-kit](https://github.com/github/spec-kit) — two AI-assisted software development frameworks.

## What is spec-kit?

GitHub's spec-kit is a "Spec-Driven Development" toolkit centered on specifications as the primary artifact. A Python CLI (`specify`) drops plain Markdown commands into your AI agent's commands directory. Five core commands: `constitution` → `specify` → `plan` → `tasks` → `implement`. Supports 20+ AI agents (Claude, Gemini, Copilot, Cursor, etc.). Framework-agnostic by design.

## What is ensemble?

Ensemble is a Claude Code-specific plugin ecosystem providing a 4-tier hierarchy of plugins and a mesh of 28 specialized AI agents. Commands are YAML-defined workflows that orchestrate specialist sub-agents (backend-developer, frontend-developer, qa-orchestrator, etc.) via the `Task` tool. Primary commands: `create-prd` → `refine-prd` → `create-trd` → `refine-trd` → `implement-trd-beads`, with `/ensemble:feature` as a full pipeline wrapper.

---

## Feature Comparison

| Capability | spec-kit | ensemble |
|---|---|---|
| Project constitution / principles | ✅ `constitution.md` with phase gates | ❌ Only CLAUDE.md (informal) |
| PRD / spec creation | ✅ | ✅ REQ-NNN IDs + Given/When/Then ACs |
| Structured clarification Q&A | ✅ `[NEEDS CLARIFICATION]` markers | ✅ AskUserQuestion interview |
| Technical planning | ✅ plan.md + API contracts + data model | ✅ TRD with traceability matrix |
| Cross-artifact consistency analysis | ✅ `/speckit.analyze` before implementation | ⚠️ traceability validation only |
| Requirement traceability | ❌ loose (document position) | ✅ `[satisfies REQ-NNN]`, paired tests, AC matrix |
| Implementation execution | ✅ sequential, Markdown checkboxes | ✅ br/bv beads, dependency-aware, resumable |
| Multi-agent / team mode | ❌ single agent only | ✅ builder→reviewer→QA state machine |
| Cross-session state | ❌ Markdown only | ✅ persistent beads JSONL |
| Framework-specific skills | ❌ | ✅ React, NestJS, Rails, Jest, Pytest, etc. |
| Preset / template overrides | ✅ stackable presets | ❌ |
| Community plugin marketplace | ✅ open catalog | ❌ Fortium-curated only |
| Multi-AI-agent support | ✅ 20+ agents | ❌ Claude Code only |
| Full pipeline command | ❌ manual sequential steps | ✅ `/ensemble:feature` |
| Git / release / CI/CD commands | ❌ | ✅ |
| Standalone data model artifact | ✅ `data-model.md` | ❌ embedded in TRD |
| Standalone research artifact | ✅ `research.md` | ❌ embedded in TRD |
| MCP server integration | ❌ | ✅ optional trd-workflow MCP |
| External binary dependency | ❌ (only uv + agent CLI) | ⚠️ requires br/bv binaries |

---

## Ensemble Strengths

### 1. Deep Bidirectional Requirement Traceability

`[satisfies REQ-NNN]` annotations link every TRD task to a PRD requirement. Paired `-TEST` tasks verify requirements at runtime. Closure comments write `req-satisfied:REQ-NNN ac-proven:AC-NNN-M` tokens into bead history. A satisfaction report is generated at completion. spec-kit links tasks to user stories only by document position — no ID-based chain.

### 2. Persistent Cross-Session State

The `beads` integration (`br`/`bv`) provides a real task database that survives session interruptions. `--status` shows in-flight task state; `--reset-task TRD-NNN` recovers failed tasks; structured status comments record the full audit trail. spec-kit's state is Markdown checkboxes — lost when the session ends.

### 3. Real Team Orchestration

`create-trd` auto-detects complexity (Simple/Medium/Complex) and generates a YAML team configuration. `implement-trd-beads` drives a role-based state machine: `open → in_progress → in_review → in_qa → closed`, with rejection loops back to the builder. spec-kit has no multi-agent execution model.

### 4. Dependency-Aware Execution

`bv --robot-next` queries the dependency graph embedded in `[depends: TRD-NNN]` annotations to determine the optimal next task. Parallel tracks are computed via `bv --robot-plan`. spec-kit's `[P]` markers are advisory hints to the LLM, not graph queries.

### 5. Full Pipeline Command

`/ensemble:feature` collapses a 5-step pipeline (PRD → refine → TRD → refine → implementation plan) into a single invokable command with controlled pause-points and a `--skip-refine` fast-path. spec-kit requires each step to be invoked manually.

### 6. Framework and Testing Specialization

Dedicated plugins for React, NestJS, Rails, Phoenix, Blazor, Jest, Pytest, RSpec, xUnit, and ExUnit. spec-kit is deliberately framework-agnostic and provides no framework-specific guidance.

### 7. Operational Breadth

Release orchestration, git-town workflow management, conventional commits enforcement, CI/CD infrastructure templates, productivity metrics, sprint status, and E2E testing with Playwright — entirely out of scope for spec-kit.

---

## Ensemble Weaknesses / Gaps

### 1. No Constitution / Governing Principles Artifact

spec-kit's `/speckit.constitution` produces a `memory/constitution.md` with Nine Articles (library-first, anti-abstraction gates, simplicity gates, etc.) that every subsequent command enforces as phase gates. Ensemble has no equivalent — project constraints live informally in `CLAUDE.md` and are not enforced during spec or plan generation.

### 2. No `[NEEDS CLARIFICATION]` Discipline

spec-kit mandates that LLMs mark every ambiguity with `[NEEDS CLARIFICATION: specific question]` rather than making assumptions. This is built into the spec template itself. Ensemble's PRD generation does not impose this — ambiguities may be silently resolved by the LLM's best guess.

### 3. No Cross-Artifact Consistency Analysis

spec-kit's `/speckit.analyze` runs after tasks are generated and before implementation, checking for specification coverage, contradictions, and consistency between spec, plan, and tasks. Ensemble validates traceability annotations (after TRD generation) but has no equivalent pre-implementation sweep.

### 4. Spec Storage is Flat, Not Branch-Per-Feature

spec-kit creates a Git branch per feature (`001-create-taskify`) and stores all spec artifacts in `specs/001-create-taskify/`. Ensemble stores PRDs and TRDs in flat `docs/PRD/` and `docs/TRD/` directories with no automatic branch creation tied to spec creation.

### 5. No Standalone Research or Data Model Artifacts

spec-kit's plan phase generates `research.md` (technology investigation, library compatibility) and `data-model.md` (schema, entity relationships) as separate auditable documents. Ensemble embeds this content inside TRD prose with no standalone artifacts.

### 6. Claude Code Only

spec-kit supports 20+ AI agents out of the box. Ensemble works only with Claude Code. The OpenCode translation layer is supplemental and does not expose the full agent mesh. This limits adoption in organizations with heterogeneous tooling.

### 7. No Community Extension System

Ensemble's marketplace is entirely Fortium-authored with no mechanism for community extensions. spec-kit has an open community catalog with third-party contributions (Azure DevOps integration, archive extension) and documented extension development guides.

### 8. No Preset / Template Override System

spec-kit presets let teams swap any template with domain-specific versions (e.g., healthcare-compliance preset) with priority-based stacking. Ensemble's YAML command definitions are authoritative and cannot be overridden without editing plugin source.

### 9. External Binary Dependency

`implement-trd-beads` requires `br` (beads_rust) and optionally `bv` (beads_viewer) — third-party binaries from a separate GitHub repository with no ensemble-managed installation. spec-kit's only binary dependency is `uv` (mainstream Python package manager).

---

## Opportunities

| Priority | Opportunity | Description |
|---|---|---|
| High | **`/ensemble:create-constitution`** | Project architectural principles doc that `create-trd` and `implement-trd-beads` reference and enforce as phase gates |
| High | **`[NEEDS CLARIFICATION]` markers in `create-prd`** | Ambiguities become the structured agenda for `refine-prd`, mirroring spec-kit's discipline |
| High | **`/ensemble:analyze-requirements`** | Cross-artifact sweep before implementation: coverage, consistency, completeness — fills the gap between traceability validation and pre-implementation analysis |
| Medium | **Auto feature-branch on `create-prd`** | Branch name derived from PRD-YYYY-NNN slug, created via git-town; makes specs first-class Git citizens |
| Medium | **Standalone `research.md` and `data-model.md`** | Generated by `create-trd` when database/research domains are detected; auditable separately from TRD body |
| Medium | **Preset system for command templates** | Allow teams to override YAML command definitions for compliance, domain, or organizational needs |
| Low | **Community plugin catalog** | Open submission mechanism beyond Fortium-authored plugins |
| Low | **Multi-AI-agent support** | Generate command files for Gemini/Copilot/Cursor from the same YAML source via `npm run generate` |
| Low | **`quickstart.md` validation artifact** | Key end-to-end validation scenarios derived from ACs; gives QA a manual smoke test runbook |

---

*Generated: 2026-03-16 | Source: ensemble v5.9.0 vs spec-kit (github.com/github/spec-kit)*
