# PRD-2026-018: Ensemble Pi Runtime

---
**Document ID:** PRD-2026-018
**Version:** 1.0.0
**Status:** Draft
**Date:** 2026-03-29
**Scale Depth:** DEEP
**Total Requirements:** 28
**Readiness Score:** 4.4 / 5.0 (PASS)
---

## PRD Health Summary

| Metric | Value |
|--------|-------|
| Must requirements | 18 |
| Should requirements | 7 |
| Could requirements | 3 |
| Won't (this release) | — |
| AC coverage | 28/28 (100%) |
| Risk flags | 4 |
| Cross-requirement dependencies | 11 |

---

## Product Summary

**Problem Statement:**
Ensemble's full-lifecycle development workflows — PRD/TRD creation, implementation orchestration, code review, git automation, and quality pipelines — are only available to Claude Code and OpenCode users. Pi, a rapidly growing open-source coding agent with 28k+ stars, 15+ providers, and an extensible package ecosystem, has no equivalent workflow suite. Pi developers either work without structured workflows or build their own from scratch.

**Solution Overview:**
Add `packages/pi` to the Ensemble monorepo — a translation layer that reads Ensemble's YAML command definitions (the single source of truth) and generates Pi-compatible artifacts: prompt templates, agent definitions, SKILL.md files, and a TypeScript extension bundle. The generated artifacts are published to npm as `@fortium/ensemble-pi` with the `pi-package` keyword, installable with a single `pi install` command.

**Value Proposition:**
- Pi developers gain production-grade AI workflows (PRD/TRD, code review, git automation) without building them from scratch
- Ensemble users gain Pi as a third runtime alongside Claude Code and OpenCode
- Fortium distributes Ensemble to a new ecosystem with zero ongoing maintenance overhead (single YAML source of truth)

**Target Users:**
- Solo developers using Pi who want structured product/engineering workflows
- Small teams (2-5) on Pi wanting the PRD → TRD → implementation pipeline
- Fortium team using Pi on client projects
- Enterprise/multi-team Ensemble users evaluating Pi as a runtime option
- Open-source contributors to the Pi ecosystem

---

## User Analysis

### User Roles

| Role | Pain Today | What They Gain |
|------|-----------|----------------|
| Pi solo dev | No structured PRD/TRD workflow; ad-hoc planning | `/create-prd`, `/create-trd` with full interview protocol |
| Pi team lead | Can't enforce consistent requirements process | Standardized PRD/TRD templates across team |
| Fortium consultant | Context-switches between Claude Code and Pi | Same Ensemble workflows on any runtime |
| Ensemble power user | Locked to Claude Code / OpenCode runtimes | Pi as third runtime option |
| Pi ecosystem contributor | Limited workflow packages available | Inspiration + foundation for extending ensemble-pi |

### Success Metrics
- `pi install npm:@fortium/ensemble-pi` completes without errors
- `/create-prd` runs in Pi and produces a PRD of equivalent quality to Claude Code
- `/create-trd` runs in Pi and produces a TRD of equivalent quality to Claude Code
- AskUserQuestion interview protocol functions interactively in Pi's TUI

---

## Goals and Non-Goals

### Goals (v1)
- Publish `@fortium/ensemble-pi` to npm as a Pi-installable package
- Translate all PRD/TRD commands to Pi prompt templates via generator script
- Ship a TypeScript extension that provides `AskUserQuestion` tool in Pi
- Generate Pi agent definitions for `product-management-orchestrator`
- Integrate `npm run generate:pi` into the Ensemble build pipeline
- Maintain YAML as the single source of truth — no Pi-specific YAML

### Non-Goals (v2+)
- Implementation commands (`implement-trd-beads`, `beads-plan`, `beads-build`)
- Code review, testing, infrastructure, git automation commands
- Full sub-agent orchestration mesh (28 agents)
- Foreman integration
- Beads task management extension (assumes `br` installed, v2)
- Pi-native plan mode extension

---

## Requirements by Feature Area

---

### Feature Area 1: Package Infrastructure

#### REQ-001: Monorepo Package Scaffold {#req-001}
**Priority:** Must | **Complexity:** Low

Create `packages/pi/` with the standard Ensemble package structure: `src/`, `skills/`, `prompts/`, `agents/`, `tests/`, `package.json`, `tsconfig.json`, `README.md`, `CHANGELOG.md`.

- AC-001-1: Given the monorepo root, when `npm install` runs, then `packages/pi` resolves as a workspace package without errors.
- AC-001-2: Given `packages/pi`, when `npm run validate` runs from the monorepo root, then the package passes schema and structure validation.

#### REQ-002: Pi-Compatible package.json {#req-002}
**Priority:** Must | **Complexity:** Low

`packages/pi/package.json` must include: name `@fortium/ensemble-pi`, `pi-package` in keywords, a `pi` manifest field declaring extensions/skills/prompts/agents directories, and be publishable to npm.

- AC-002-1: Given `packages/pi/package.json`, when `pi install npm:@fortium/ensemble-pi` runs, then Pi discovers and loads all declared extensions, skills, prompts, and agents.
- AC-002-2: Given `package.json`, when `npm publish --dry-run` runs, then all required fields are present and valid.
- AC-002-3: Given the `pi` manifest field, when Pi auto-discovers, then it finds extensions in `extensions/`, skills in `skills/`, prompts in `prompts/`, agents in `agents/`.

#### REQ-003: Version Synchronization {#req-003}
**Priority:** Must | **Complexity:** Low

`packages/pi` version must stay in sync with the ensemble monorepo version. The `validate:version` script must enforce this, consistent with `packages/opencode`.

- AC-003-1: Given a version bump in `marketplace.json`, when `npm run validate:version` runs in `packages/pi`, then it passes only if `package.json` version matches.
- AC-003-2: Given a version mismatch, when `prepublishOnly` runs, then the publish fails with a clear error message.

---

### Feature Area 2: Translation Layer (Generator)

#### REQ-004: `generate:pi` Script {#req-004}
**Priority:** Must | **Complexity:** Medium | **[RISK: generator parity with OpenCode]**

Add `npm run generate:pi` to the monorepo root `package.json`. The script reads Ensemble YAML command definitions and outputs Pi-compatible artifacts to `packages/pi/dist/` (or inline to `prompts/`, `agents/`, `skills/`).

- AC-004-1: Given valid YAML command files, when `npm run generate:pi` runs, then all output files are created in the correct Pi directories.
- AC-004-2: Given `--dry-run` flag, when the script runs, then it prints what would be generated without writing files.
- AC-004-3: Given `--verbose` flag, when the script runs, then each translated artifact is logged with source path → output path.
- AC-004-4: Given a YAML parse error, when the script runs, then it reports the error with file path and line number and exits non-zero.

#### REQ-005: Command YAML → Pi Prompt Template Translation {#req-005}
**Priority:** Must | **Complexity:** High | **[RISK: interview protocol fidelity]**

The generator translates Ensemble command YAML (phases/steps/actions structure) into Pi prompt templates (`.md` files in `prompts/`). The translation must preserve:
- Phase structure as numbered markdown sections
- Step actions as instruction lists
- Interview protocol directives (INTERVIEW PROTOCOL annotations)
- References to `AskUserQuestion` tool (mapped to `ask_user` extension tool)
- Constraints and mission sections from YAML metadata

- AC-005-1: Given `create-prd.yaml`, when the generator runs, then `prompts/create-prd.md` is produced with all 4 phases, all steps, and interview protocol directives intact.
- AC-005-2: Given a command YAML with AskUserQuestion references, when translated, then the output references `ask_user` tool (Pi extension equivalent).
- AC-005-3: Given two runs of the generator on unchanged YAML, when comparing outputs, then the files are identical (deterministic).
- AC-005-4: Given a command with `{{variable}}` argument placeholders, when translated, then Pi template variables are used correctly.

#### REQ-006: Agent YAML → Pi Agent Definition Translation {#req-006}
**Priority:** Must | **Complexity:** Medium

The generator translates Ensemble agent YAML files to Pi agent definition markdown files (YAML frontmatter + description body) in `agents/`. Frontmatter must include: `name`, `description`, `model`, `tools`.

- AC-006-1: Given `product-management-orchestrator.yaml`, when the generator runs, then `agents/product-management-orchestrator.md` is produced with valid Pi frontmatter.
- AC-006-2: Given an agent YAML with tool list, when translated, then the Pi agent's `tools` frontmatter lists only tools available in Pi (read, write, edit, bash, plus registered extensions).
- AC-006-3: Given a Pi agent definition, when loaded by Pi's subagent extension, then it initializes without errors.

#### REQ-007: SKILL.md Propagation {#req-007}
**Priority:** Must | **Complexity:** Low

SKILL.md files from Ensemble packages (e.g., `packages/core/skills/`) are copied into `packages/pi/skills/` by the generator. Pi's SKILL.md format is compatible with Ensemble's — no transformation required.

- AC-007-1: Given `packages/core/skills/framework-detector/SKILL.md`, when the generator runs, then `packages/pi/skills/framework-detector/SKILL.md` exists with identical content.
- AC-007-2: Given a Pi session with `ensemble-pi` installed, when the agent needs framework detection, then the skill is available and loadable.

#### REQ-008: AGENTS.md Generation {#req-008}
**Priority:** Should | **Complexity:** Low

The generator produces an `AGENTS.md` file for `packages/pi/` containing the Ensemble-relevant sections of context (constraints, agent mesh overview, delegation protocol). Pi loads `AGENTS.md` from installed packages.

- AC-008-1: Given the generated `AGENTS.md`, when Pi starts with `ensemble-pi` installed, then the Ensemble context (agent delegation rules, constraints) is present in the session context.
- AC-008-2: Given `AGENTS.md` content, when validated against Pi's loading behavior, then it does not duplicate content already in user's project `AGENTS.md`.

#### REQ-009: Generator Validation Step {#req-009}
**Priority:** Should | **Complexity:** Low

The generator includes a `--validate` flag that parses generated artifacts and reports structural issues without writing files.

- AC-009-1: Given `--validate` flag, when run after generation, then all prompt templates, agent definitions, and SKILL.md files are confirmed parseable.
- AC-009-2: Given a malformed generated artifact (e.g., invalid frontmatter), when `--validate` runs, then it reports the file path and issue.

---

### Feature Area 3: AskUserQuestion Extension

#### REQ-010: `ask_user` Tool Registration {#req-010}
**Priority:** Must | **Complexity:** Medium | **[RISK: Pi TUI integration complexity]**

The Pi package ships a TypeScript extension (`extensions/ask-user.ts`) that registers an `ask_user` tool in Pi's runtime. The tool accepts a `question: string` parameter and returns the user's typed answer.

- AC-010-1: Given `ensemble-pi` installed, when the model calls `ask_user({ question: "..." })`, then Pi displays the question and captures the user's response.
- AC-010-2: Given a multi-step interview (5 questions), when each `ask_user` call completes, then the response is returned to the model before the next call is made.
- AC-010-3: Given the user pressing Ctrl+C during an `ask_user` prompt, then the tool returns an interruption signal and the model handles it gracefully.

#### REQ-011: Extension Entry Point {#req-011}
**Priority:** Must | **Complexity:** Low

The extension exports a default function receiving `ExtensionAPI` and registers `ask_user` via `pi.registerTool()`. The extension must be loadable without errors in Pi's TypeScript runtime.

- AC-011-1: Given `extensions/ask-user.ts`, when Pi loads the extension, then no import or runtime errors occur.
- AC-011-2: Given `pi list` after installation, then `ensemble-pi` appears with extension status active.

#### REQ-012: Tool Discoverability in Prompt Templates {#req-012}
**Priority:** Must | **Complexity:** Low

All translated prompt templates that use the interview protocol reference `ask_user` by its registered tool name. The generator handles the `AskUserQuestion` → `ask_user` mapping automatically.

- AC-012-1: Given `prompts/create-prd.md`, when inspected, then all interview protocol steps reference `ask_user` not `AskUserQuestion`.
- AC-012-2: Given a Pi session running `/create-prd`, when the interview phase begins, then `ask_user` is called for each question sequentially.

---

### Feature Area 4: V1 Command Coverage (PRD/TRD)

#### REQ-013: `/create-prd` Prompt Template {#req-013}
**Priority:** Must | **Complexity:** Medium

`create-prd` is translated to a Pi prompt template at `prompts/create-prd.md`. The interview protocol (one question at a time via `ask_user`), all 4 phases, adversarial review, and readiness gate must be preserved.

- AC-013-1: Given `/create-prd [product description]` in Pi, when run, then the model begins the Scale Detection step and asks Q1 of the interview.
- AC-013-2: Given a complete interview run, when the PRD is generated, then it passes the Implementation Readiness Gate (score ≥ 4.0) at equivalent quality to Claude Code output.
- AC-013-3: Given `/create-prd` without arguments, when run, then the model prompts for a product description before beginning.

#### REQ-014: `/refine-prd` Prompt Template {#req-014}
**Priority:** Must | **Complexity:** Low

`refine-prd` is translated to a Pi prompt template preserving the one-at-a-time interview and PRD update workflow.

- AC-014-1: Given `/refine-prd [prd-path]` in Pi, when run, then the model reads the PRD and begins the review interview.
- AC-014-2: Given refinement questions answered, when complete, then the PRD file is updated in place.

#### REQ-015: `/analyze-product` Prompt Template {#req-015}
**Priority:** Should | **Complexity:** Low

`analyze-product` is translated to a Pi prompt template.

- AC-015-1: Given `/analyze-product [description]` in Pi, when run, then the model produces a structured product analysis.

#### REQ-016: `/create-trd` Prompt Template {#req-016}
**Priority:** Must | **Complexity:** Medium

`create-trd` is translated to a Pi prompt template preserving all phases, technical elicitation, and TRD quality gate.

- AC-016-1: Given `/create-trd [prd-path]` in Pi, when run, then the model reads the PRD and begins TRD elicitation.
- AC-016-2: Given a complete TRD generation, when output is compared to Claude Code output for the same PRD, then structure and quality are equivalent.

#### REQ-017: `/refine-trd` Prompt Template {#req-017}
**Priority:** Must | **Complexity:** Low

`refine-trd` is translated to a Pi prompt template preserving the one-at-a-time interview and TRD update workflow.

- AC-017-1: Given `/refine-trd [trd-path]` in Pi, when run, then the model reads the TRD and begins the review interview.
- AC-017-2: Given refinement answers, when complete, then the TRD file is updated in place.

---

### Feature Area 5: Agent Definitions

#### REQ-018: `product-management-orchestrator` Agent {#req-018}
**Priority:** Must | **Complexity:** Medium

The `product-management-orchestrator` agent YAML is translated to a Pi agent definition (`agents/product-management-orchestrator.md`) usable with Pi's subagent extension.

- AC-018-1: Given `agents/product-management-orchestrator.md`, when loaded by Pi's subagent extension, then the agent initializes with the correct tools and system context.
- AC-018-2: Given a `/create-prd` run that delegates to the orchestrator, when the orchestrator runs as a subagent, then it returns a structured PRD artifact.

#### REQ-019: Agent Discovery Configuration {#req-019}
**Priority:** Should | **Complexity:** Low

The Pi package's `pi` manifest or extension configures Pi to discover `agents/` at the package install location, so agents are available without manual path configuration.

- AC-019-1: Given `ensemble-pi` installed globally, when Pi starts, then all `agents/*.md` from the package are discoverable by the subagent extension.

---

### Feature Area 6: Distribution & CI

#### REQ-020: npm Publish Pipeline {#req-020}
**Priority:** Must | **Complexity:** Low

`packages/pi` is included in the existing `npm run publish:changed` script. The package publishes as `@fortium/ensemble-pi` with `pi-package` keyword.

- AC-020-1: Given a version bump, when `npm run publish:changed` runs, then `@fortium/ensemble-pi` is published to npm.
- AC-020-2: Given the published package, when `pi install npm:@fortium/ensemble-pi` runs, then installation succeeds and `pi list` shows the package.

#### REQ-021: CI Integration {#req-021}
**Priority:** Must | **Complexity:** Low

`npm run generate:pi` is added to the `validate.yml` GitHub Actions workflow so generated artifacts are always in sync with YAML sources.

- AC-021-1: Given a YAML change without running `generate:pi`, when CI runs, then the workflow fails with a diff error.
- AC-021-2: Given a PR with both YAML and generated artifact changes, when CI runs, then the workflow passes.

#### REQ-022: Installation README {#req-022}
**Priority:** Must | **Complexity:** Low

`packages/pi/README.md` includes: installation command, quick-start examples for `/create-prd` and `/create-trd`, list of included commands, and link to full Ensemble docs.

- AC-022-1: Given the README, when a Pi developer reads it, then they can install and run `/create-prd` without consulting any other documentation.

#### REQ-023: Local Development Install {#req-023}
**Priority:** Should | **Complexity:** Low

Developers can test the Pi package locally without publishing, using `pi install git:github.com/FortiumPartners/ensemble` or a local path install.

- AC-023-1: Given a local clone of the ensemble repo, when `pi -e git:github.com/FortiumPartners/ensemble` runs (or local path equivalent), then the package loads without errors.

---

### Feature Area 7: Quality & Parity

#### REQ-024: Output Quality Equivalence {#req-024}
**Priority:** Must | **Complexity:** Medium | **[RISK: prompt fidelity loss in translation]**

PRD and TRD outputs produced by `ensemble-pi` must be structurally equivalent to outputs produced by `ensemble-full` on Claude Code, given identical inputs.

- AC-024-1: Given the same product description run through `/create-prd` on Claude Code and Pi, when both PRDs are compared, then both contain: frontmatter, health summary, REQ-NNN requirements, AC-NNN-M acceptance criteria, dependency map, and readiness scorecard.
- AC-024-2: Given the Pi version, when a PRD passes the readiness gate (≥4.0), then the document is reviewable by a product manager without knowing which runtime generated it.

#### REQ-025: Generator Test Coverage {#req-025}
**Priority:** Should | **Complexity:** Medium

The generator script has Jest tests covering: YAML→prompt template translation, agent definition translation, SKILL.md copy, and error handling for malformed inputs.

- AC-025-1: Given `packages/pi/tests/`, when `npm test` runs, then generator tests pass with ≥80% coverage of translation logic.
- AC-025-2: Given a malformed YAML input in tests, when the generator is called, then it throws a descriptive error (not a raw stack trace).

#### REQ-026: Marketplace Registration {#req-026}
**Priority:** Should | **Complexity:** Low

`packages/pi` is registered in `marketplace.json` with name `ensemble-pi`, consistent with other Ensemble packages.

- AC-026-1: Given `marketplace.json`, when `npm run validate` runs, then `ensemble-pi` passes schema validation.

#### REQ-027: Pi Version Compatibility {#req-027}
**Priority:** Could | **Complexity:** Low

`package.json` declares a `peerDependencies` or `engines` range specifying the minimum Pi version required.

- AC-027-1: Given `@mariozechner/pi-coding-agent` below the minimum version, when `pi install` runs, then a compatibility warning is shown.

#### REQ-028: Changelog {#req-028}
**Priority:** Could | **Complexity:** Low

`packages/pi/CHANGELOG.md` is initialized with v1.0.0 entry documenting v1 scope.

- AC-028-1: Given `CHANGELOG.md`, when reviewed, then v1.0.0 entry documents all REQ-001 through REQ-028 delivered capabilities.

---

## Dependency Map

| Requirement | Depends On | Notes |
|-------------|-----------|-------|
| REQ-004 (generator script) | REQ-001 (package scaffold) | Generator lives in the package |
| REQ-005 (command translation) | REQ-004 (generator) | Translation is a generator output |
| REQ-006 (agent translation) | REQ-004 (generator) | Translation is a generator output |
| REQ-007 (skill propagation) | REQ-004 (generator) | Copying is a generator step |
| REQ-008 (AGENTS.md) | REQ-004 (generator) | Generator produces AGENTS.md |
| REQ-010 (ask_user tool) | REQ-001 (package scaffold) | Extension lives in package |
| REQ-012 (tool refs in templates) | REQ-005 (command translation), REQ-010 (ask_user) | Translation must know tool name |
| REQ-013 (create-prd) | REQ-005, REQ-010, REQ-012 | Depends on translation + ask_user |
| REQ-014 (refine-prd) | REQ-005, REQ-010 | — |
| REQ-016 (create-trd) | REQ-005, REQ-010 | — |
| REQ-017 (refine-trd) | REQ-005, REQ-010 | — |
| REQ-018 (orchestrator agent) | REQ-006 (agent translation) | — |
| REQ-020 (npm publish) | REQ-002 (package.json), REQ-003 (version sync) | — |
| REQ-021 (CI) | REQ-004 (generator) | CI runs generator |
| REQ-024 (quality parity) | REQ-013, REQ-016 | Validates end-to-end |
| REQ-025 (test coverage) | REQ-004, REQ-005, REQ-006 | Tests the generator |

### Implementation Clusters

**Cluster A — Foundation (ship first):** REQ-001, REQ-002, REQ-003, REQ-011
**Cluster B — Generator core:** REQ-004, REQ-005, REQ-006, REQ-007, REQ-008
**Cluster C — ask_user extension:** REQ-010, REQ-012
**Cluster D — V1 commands:** REQ-013, REQ-014, REQ-015, REQ-016, REQ-017
**Cluster E — Agent definitions:** REQ-018, REQ-019
**Cluster F — Distribution:** REQ-020, REQ-021, REQ-022, REQ-023
**Cluster G — Quality:** REQ-024, REQ-025, REQ-026

---

## Adversarial Review

Issues identified and resolutions applied:

1. **Interview protocol fidelity** — Pi prompt templates use `{{variable}}` substitution; Ensemble's interview protocol is procedural (call `ask_user` N times). Risk: the generator produces a template that lists questions rather than calling them sequentially. **Resolution:** REQ-005 explicitly requires interview protocol directives to be preserved; REQ-010/REQ-012 ensure `ask_user` is the mechanism, not inline text.

2. **Pi TUI integration for ask_user** — Pi's `ExtensionAPI.registerTool()` returns values synchronously to the model; interactive TUI input requires async awaiting on Pi's input stream. **Resolution:** REQ-010-AC-010-2 validates multi-step sequential behavior end-to-end. Marked [RISK] on REQ-010.

3. **Agent subagent dependency not declared** — The orchestrator agent (REQ-018) requires Pi's subagent extension to be loaded. This is not bundled in `ensemble-pi`. **Resolution:** REQ-019 adds agent discovery configuration; README (REQ-022) must document the subagent extension dependency.

4. **Generator artifact drift in CI** — If a developer edits YAML without running `generate:pi`, the committed artifacts are stale. **Resolution:** REQ-021 adds CI enforcement.

5. **No `feature.md` command** — `feature.md` orchestrates the full PRD→TRD→implement pipeline. It's excluded from v1 scope but should be noted as a v2 priority. **Resolution:** Added to Non-Goals with explicit v2 callout.

6. **Pi version compatibility unknown** — Pi's extension API may change between versions. **Resolution:** REQ-027 (Could) addresses minimum version declaration; the risk is low given Pi's active development and MIT license.

---

## Implementation Readiness Gate

| Dimension | Score | Notes |
|-----------|-------|-------|
| Completeness | 4.5 | All v1 feature areas covered; v2 scope explicitly bounded |
| Testability | 4.5 | Every requirement has ≥1 verifiable AC; generator and E2E parity testable |
| Clarity | 4.5 | Translation layer pattern is established (mirrors OpenCode); Pi format well documented |
| Feasibility | 4.0 | `ask_user` TUI integration is the highest-risk item; all other requirements follow established patterns |

**Overall Score: 4.4 / 5.0 — PASS**

---

## Suggested Next Step

```
/ensemble:create-trd docs/PRD/PRD-2026-018-ensemble-pi-runtime.md
```
