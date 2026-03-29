# Comprehensive Framework Comparison: Ensemble vs. AgentOS vs. GSD vs. Superpowers vs. BMAD

> Competitive analysis conducted 2026-03-28. All external framework details sourced from current GitHub READMEs.

## Context

This analysis compares five AI coding agent frameworks to identify Ensemble's competitive position, strengths, weaknesses, and features worth incorporating. All five target the same problem space -- making AI coding assistants more reliable and productive -- but take radically different approaches.

---

## Framework Profiles

### Ensemble (v5.1.0) -- Fortium Partners
**Philosophy:** Full-lifecycle orchestration platform with specialized agent mesh.
**Size:** 23 npm packages, 28 agents, 15+ commands, 5 framework skills, 5 test framework skills.
**Architecture:** 4-tier monorepo (Core -> Workflow -> Framework Skills -> Test Frameworks) with YAML agents, JSON manifests, and hook system.
**Runtimes:** Claude Code + OpenCode (via translation layer).

### AgentOS (v3.0) -- Builder Methods
**Philosophy:** Standards-first. Capture your team's coding conventions and inject them into AI context at the right time. Deliberately removed orchestration/task management in v3 because frontier models handle it natively.
**Size:** ~30 files. 5 markdown commands, bash scripts, no dependencies.
**Architecture:** File-based profiles with inheritance. Standards organized by folder, indexed for selective injection.
**Runtimes:** Tool-agnostic (any tool that reads markdown).

### GSD (Get Shit Done) -- TACHES
**Philosophy:** Anti-enterprise. Solves context rot through fresh-window-per-agent architecture. "The complexity is in the system, not in your workflow."
**Size:** 44 commands, 46 workflows, 18 agents, 17 CLI tools.
**Architecture:** 4-layer stack (Commands -> Workflows -> Agents -> CLI Tools) with `.planning/` file-based state.
**Runtimes:** 8 (Claude Code, OpenCode, Gemini CLI, Codex, Copilot, Cursor, Windsurf, Antigravity).

### Superpowers (v5.0.6) -- Jesse Vincent (obra)
**Philosophy:** Methodology enforcement through pure prompt engineering. Skills trigger automatically based on context. TDD and brainstorming are non-negotiable.
**Size:** 14 skill directories, 1 agent, 3 deprecated commands, 1 hook.
**Architecture:** Flat repo, no build step, no dependencies. Skills are pure markdown.
**Runtimes:** 6 (Claude Code, Cursor, Codex, OpenCode, Gemini CLI, any markdown-reading tool).

### BMAD Method -- BMAD Code Org
**Philosophy:** Expert AI personas guide structured 4-phase development (Analysis -> Planning -> Solutioning -> Implementation). Scale-adaptive depth.
**Size:** 9 named persona agents, npm module ecosystem (BMad Builder, Test Architect, Creative Intelligence Suite).
**Architecture:** Module-based with self-contained skills per phase. Each module publishable to npm.
**Runtimes:** Claude Code, Cursor.

---

## Head-to-Head Comparison

| Dimension | Ensemble | AgentOS | GSD | Superpowers | BMAD |
|-----------|----------|---------|-----|-------------|------|
| **Agents** | 28 YAML agents, 6 orchestrators | None (defers to tool) | 18 functional specialists | 1 formal + 3 prompt templates | 9 named personas |
| **Commands** | 15+ YAML/MD | 5 markdown | 44 markdown | 3 (deprecated) | Menu-based per persona |
| **Plugin model** | NPM packages + JSON manifests | File-based profiles | Config skill injection + SDK | Write a SKILL.md | npm modules (BMad Builder) |
| **Task mgmt** | Beads (Dolt-backed, persistent) | None | STATE.md + milestones + seeds | TodoWrite only | Epics/stories/sprints (YAML) |
| **Hooks** | 4 types (Pre/Post ToolUse, UserPromptSubmit, PermissionRequest) | None | 5 runtime hooks | 1 (SessionStart) | None |
| **Context engineering** | fold-prompt optimization | Standards index + selective injection | Fresh windows + runtime monitor + XML formatting | Fresh subagent per task + SessionStart injection | Document distillation (3.2:1 compression) |
| **Testing** | Jest/Vitest + Playwright E2E | None | Nyquist validation + plan checker | Behavioral (subagent scenarios) | Quinn QA + Test Architect module |
| **Parallel execution** | Beads-based with conflict detection | None | Wave-based with file locking | Subagent per task | Not emphasized |
| **Methodology** | TDD via agent architecture | None (standards only) | Phase-gated with verification | Hard gates (TDD iron laws, brainstorming mandatory) | Implementation readiness gate |
| **Multi-runtime** | 2 (Claude Code, OpenCode) | Tool-agnostic | 8 runtimes | 6 runtimes | 2 (Claude Code, Cursor) |
| **SDK/headless** | Metrics API only | None | TypeScript SDK with CLI/WebSocket transport | None | None |
| **Dependencies** | Node.js ecosystem | Zero | Node.js (CLI tools) | Zero | Node.js (npm modules) |

---

## Ensemble Strengths

1. **Most sophisticated agent mesh.** 28 specialized agents with a formal delegation hierarchy, handoff protocols, and conflict resolution strategies. No other framework comes close to this level of agent specialization.

2. **Best parallel execution.** Beads-based dispatch with file conflict detection (`selectConflictFree()`), builder slot management, sequential commit queuing, and failure isolation. GSD has wave-based execution but lacks the conflict detection sophistication.

3. **Strongest task management.** Beads is a real persistence layer (Dolt-backed) with dependencies, blocking, priorities, and cross-session resumability. Every other framework uses ephemeral markdown or TodoWrite.

4. **Framework-aware skill loading.** Automatic detection of NestJS, React, Rails, Phoenix, Blazor with dynamic skill injection. No competitor does this.

5. **Most complete quality pipeline.** code-reviewer -> test-runner -> playwright-tester chain with DoD enforcement, security scanning (OWASP), and coverage targets (80% unit, 70% integration).

6. **Structured plugin ecosystem.** JSON schemas, validation CI, NPM packaging, marketplace. Closest competitor is BMAD's npm modules, but Ensemble's is more mature.

7. **Multi-orchestrator coordination.** 6 specialized orchestrators (ensemble, tech-lead, product-management, QA, infrastructure, deployment) vs. single orchestrators elsewhere.

---

## Ensemble Weaknesses

### Critical Gaps

1. **No context window monitoring.** GSD has runtime context monitors that warn at 35%/25% remaining. Superpowers uses fresh-window-per-task. Ensemble has no awareness of context consumption during execution. This is the single biggest operational gap.

2. **Only 2 runtimes.** GSD supports 8 runtimes, Superpowers supports 6. Ensemble supports Claude Code + OpenCode. Missing: Cursor, Gemini CLI, Codex, Copilot, Windsurf, Antigravity. The OpenCode translation layer proves the architecture can support more, but coverage is thin.

3. **No standards discovery/injection.** AgentOS's `/discover-standards` extracts coding conventions from your codebase and injects them selectively into context. Ensemble's `fold-prompt` optimizes CLAUDE.md but doesn't discover or manage project-specific standards as a first-class concept.

4. **No headless/SDK mode.** GSD has a TypeScript SDK with CLI transport, WebSocket transport, event streaming, and prompt building. Ensemble has no programmatic API for spawning agents or running commands outside Claude Code/OpenCode.

### Moderate Gaps

5. **Methodology enforcement is architectural, not technical.** Superpowers uses hard gates ("NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST") and the `using-superpowers` skill auto-injects at session start with "red flag thought" detection. Ensemble relies on agents following their YAML instructions, with no system-level enforcement hooks.

6. **No brainstorming/design gate.** Superpowers requires brainstorming approval before ANY implementation. BMAD has an Implementation Readiness Gate (PASS/CONCERNS/FAIL). Ensemble goes from TRD -> implementation without a formal "design approved" checkpoint.

7. **Heavy footprint.** 23 npm packages with build steps, schema validation, and CI. AgentOS is ~30 files with zero dependencies. Superpowers is 14 markdown files. Ensemble's complexity is justified by its capabilities but creates a higher barrier to entry and maintenance burden.

8. **No session pause/resume.** GSD has HANDOFF.json for session continuity. Ensemble relies on beads for cross-session state but has no general-purpose session handoff mechanism.

---

## Skills/Features Worth Incorporating into Ensemble

### High Priority (addresses critical gaps)

#### 1. Context Window Monitor (from GSD)
**What:** A `PreToolUse` or `PostToolUse` hook that estimates context usage and injects warnings when approaching limits. GSD warns at 35% and 25% remaining.
**Why:** Context rot is the #1 cause of quality degradation in long sessions. Ensemble has no visibility into this.
**Implementation:** Add a hook to `packages/core/hooks/` that tracks tool call count/output sizes as a proxy for context usage. Inject `<system-reminder>` warnings suggesting session split or context compaction.
**Effort:** Small. One hook script + hooks.json entry.
**Bead:** `ensemble-4m5`

#### 2. Standards Discovery & Injection (from AgentOS)
**What:** Two new commands: `/ensemble:discover-standards` (analyze codebase, extract conventions into `standards/` directory with index.yml) and `/ensemble:inject-standards` (selectively inject relevant standards into agent context based on current task).
**Why:** Ensemble's agents follow their own built-in patterns but don't learn or enforce project-specific conventions. This is the gap between "generic best practices" and "how YOUR team writes code."
**Implementation:** New package `packages/standards/` or add to `packages/core/`. Index-based approach (like AgentOS) for token efficiency.
**Effort:** Medium. Two commands, index management, integration with fold-prompt.
**Bead:** `ensemble-7ft`

#### 3. Expanded Runtime Support (from GSD/Superpowers)
**What:** Add Cursor, Gemini CLI, and Codex support to the OpenCode translation layer, or create lightweight runtime bridges.
**Why:** Market coverage. GSD's 8-runtime support is a major adoption driver.
**Implementation:** Extend `packages/opencode/` with additional runtime adapters. Superpowers shows this can be done with minimal platform-specific code (mostly tool name mapping + hook format translation).
**Effort:** Medium-large per runtime. Cursor would be highest-value add.
**Bead:** `ensemble-zo9`

### Medium Priority (competitive parity)

#### 4. Fresh-Window-Per-Task Pattern (from Superpowers/GSD)
**What:** Formalize that each Task() dispatch starts with curated context, not inherited session history. Document the pattern and enforce it in orchestrator agents.
**Why:** Prevents context pollution between tasks. Superpowers and GSD both treat this as a core architectural principle.
**Implementation:** Update orchestrator agents (ensemble-orchestrator, tech-lead-orchestrator) to explicitly construct task context rather than relying on implicit inheritance. Add to CLAUDE.md as a documented pattern.
**Effort:** Small. Mostly documentation and agent YAML updates.
**Bead:** `ensemble-chh`

#### 5. Hard Methodology Gates (from Superpowers)
**What:** Add a `PreToolUse` hook that detects when agents attempt to write production code before tests exist, or skip design review. Inject warnings or block the action.
**Why:** Architectural enforcement (agent YAML says "do TDD") is weaker than technical enforcement (hook prevents non-TDD code). Superpowers' "iron laws" demonstrably improve output quality.
**Implementation:** Hook that checks: does a test file exist for the file being edited? Has a plan been approved? Could integrate with beads status.
**Effort:** Medium. Hook logic + integration with existing quality pipeline.
**Bead:** `ensemble-8se`

#### 6. Brainstorming/Design Gate (from Superpowers/BMAD)
**What:** Add a mandatory design review checkpoint between TRD creation and implementation. User must explicitly approve the design before code generation begins.
**Why:** Catches architectural issues before expensive implementation. BMAD's Implementation Readiness Gate and Superpowers' brainstorming hard gate both address this.
**Implementation:** Add a `--design-review` phase to `implement-trd-beads` that presents the plan and requires explicit approval before dispatching builders.
**Effort:** Small. Already partially exists in plan mode; formalize it.
**Bead:** `ensemble-iby`

#### 7. Session Handoff (from GSD)
**What:** A `/ensemble:handoff` command that serializes current session state (active beads, decisions made, files changed, next steps) to a HANDOFF.json for cross-session continuity.
**Why:** Beads handles task state but not conversation context. When a session compacts or a new session starts, decisions and rationale are lost.
**Implementation:** New command in `packages/core/commands/`. Could integrate with sessionlog.
**Effort:** Small-medium.
**Bead:** `ensemble-rf2`

### Lower Priority (nice-to-have differentiators)

#### 8. Document Distillation (from BMAD)
**What:** Lossless compression of large context documents with round-trip verification. BMAD achieves 3.2:1 compression ratios.
**Why:** Useful for injecting large PRDs/TRDs into agent context without consuming entire windows.
**Effort:** Medium.
**Bead:** `ensemble-xkb`

#### 9. Seed System (from GSD)
**What:** Forward-looking ideas with trigger conditions that surface at the right milestone.
**Why:** Prevents good ideas from getting lost during execution. Complements beads' task tracking.
**Effort:** Small-medium.
**Bead:** `ensemble-77a`

#### 10. Party Mode / Multi-Agent Debate (from BMAD)
**What:** Multiple agent personas discussing/debating a design decision in a single session.
**Why:** Produces more robust designs by surfacing disagreements.
**Effort:** Medium.
**Bead:** `ensemble-zkw`

#### 11. Headless SDK (from GSD)
**What:** TypeScript SDK for programmatic agent invocation with CLI/WebSocket transport.
**Why:** Enables CI/CD integration, custom tooling, and automated workflows without a terminal.
**Effort:** Large.
**Bead:** `ensemble-67x`

---

## Strategic Positioning Summary

| Framework | Core Identity | Best At |
|-----------|--------------|---------|
| **Ensemble** | Enterprise orchestration platform | Complex multi-agent coordination, persistent task management, framework-aware development |
| **AgentOS** | Standards library | Capturing and injecting team conventions |
| **GSD** | Context rot prevention | Fresh-window architecture, runtime coverage, solo dev productivity |
| **Superpowers** | Methodology enforcer | TDD discipline, brainstorming gates, process compliance |
| **BMAD** | Expert persona system | Structured 4-phase development, scale-adaptive planning |

**Ensemble's moat:** No other framework combines persistent task management (beads), parallel execution with conflict detection, 28 specialized agents, and framework-aware skill loading. The closest competitor on any single axis is GSD (parallel execution) but it lacks Ensemble's agent depth and persistence.

**Biggest risk:** Context engineering. Both GSD and Superpowers have made context management a first-class concern. Ensemble treats it as an afterthought. As sessions get longer and more complex, this gap will compound.
