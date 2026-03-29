# TRD-2026-018: Ensemble Pi Runtime

---
**Document ID:** TRD-2026-018
**PRD Reference:** PRD-2026-018-ensemble-pi-runtime.md
**Version:** 1.1.0
**Status:** Draft
**Date:** 2026-03-29
**Architecture Option:** B — Standalone `packages/pi` (mirrors OpenCode)
**Design Readiness Score:** 4.5 / 5.0 (PASS)
---

## Architecture Decision

### Chosen Approach: Option B — Standalone `packages/pi`

`packages/pi` is a self-contained monorepo package with its own TypeScript generator, extension, and generated output directories. It follows the `packages/opencode` pattern exactly. The generator reads Ensemble's YAML sources (single source of truth) and writes Pi-compatible artifacts to `prompts/`, `agents/`, `skills/`, and `AGENTS.md`. A TypeScript extension (`extensions/ask-user.ts`) bridges Pi's missing `AskUserQuestion` primitive.

### Alternatives Considered

**Option A — Extend existing generator (`scripts/generate-markdown.js`)**
Rejected: Couples Pi format logic into an already-complex script; harder to isolate Pi-specific translation and test independently.

**Option C — packages/pi generator delegates to scripts/lib/**
Deferred to v2: `scripts/lib/` was not designed as a public API and would require refactoring. Lower risk to mirror OpenCode's self-contained approach for v1.

### Architecture Rationale
- Single source of truth: YAML stays unchanged; no Pi-specific YAML authoring required
- Established pattern: OpenCode precedent means the team knows how to maintain this
- Independent publishability: `@fortium/ensemble-pi` is its own npm package
- Clean test boundary: generator logic is isolated and fully unit-testable

---

## System Architecture

### Package Structure

```
packages/pi/
├── src/
│   ├── index.ts                    # Generator CLI entry point
│   ├── generator.ts                # Orchestrator: discovers YAML, calls transformers
│   ├── transformers/
│   │   ├── command-transformer.ts  # YAML command phases/steps → Pi prompt template
│   │   ├── agent-transformer.ts    # YAML agent definition → Pi agent markdown
│   │   └── skill-copier.ts         # SKILL.md → packages/pi/skills/ (copy)
│   └── types.ts                    # Shared TypeScript interfaces
├── extensions/
│   └── ask-user.ts                 # Registers ask_user tool via Pi ExtensionAPI
├── prompts/                        # Generated — committed to repo
├── agents/                         # Generated — committed to repo
├── skills/                         # Generated — committed to repo
├── AGENTS.md                       # Generated — committed to repo
├── tests/
│   ├── command-transformer.test.ts
│   ├── agent-transformer.test.ts
│   ├── skill-copier.test.ts
│   └── generator.test.ts
├── .claude-plugin/
│   └── plugin.json                 # Ensemble plugin manifest
├── package.json                    # @fortium/ensemble-pi, pi-package keyword
├── tsconfig.json
├── README.md
└── CHANGELOG.md
```

### Component Boundaries

| Component | Responsibility | Inputs | Outputs |
|-----------|---------------|--------|---------|
| `index.ts` | CLI flags parsing, error reporting | `--dry-run`, `--verbose`, `--validate` | Exit codes, console output |
| `generator.ts` | YAML discovery, transformer orchestration | `packages/*/` paths | Artifact files written to `packages/pi/` |
| `command-transformer.ts` | YAML command → Pi prompt template | Command YAML object | Markdown string |
| `agent-transformer.ts` | YAML agent → Pi agent markdown | Agent YAML object | Markdown string with YAML frontmatter |
| `skill-copier.ts` | SKILL.md propagation | Source SKILL.md path | Copied file at `packages/pi/skills/` |
| `ask-user.ts` | Pi `ask_user` tool registration | Pi `ExtensionAPI` | Registered tool + TUI prompt handler |

### Data Flow

```
packages/*/commands/*.yaml
    → generator.ts
        → command-transformer.ts
            → AskUserQuestion refs → ask_user tool name
            → phases/steps/actions → numbered markdown sections
        → packages/pi/prompts/<command>.md

packages/*/agents/*.yaml
    → generator.ts
        → agent-transformer.ts
            → name/description/tools/model → YAML frontmatter
            → behavior section → markdown body
        → packages/pi/agents/<agent>.md

packages/*/skills/*/SKILL.md
    → generator.ts
        → skill-copier.ts (no transformation)
        → packages/pi/skills/<skill>/SKILL.md

packages/CLAUDE.md (ensemble sections)
    → generator.ts
        → AGENTS.md generator
        → packages/pi/AGENTS.md
```

### Integration Points

| Integration | Protocol | Notes |
|------------|----------|-------|
| Pi runtime loads `ask_user` | Pi `ExtensionAPI.registerTool()` | Async Promise-based; must await user input before resolving |
| Pi runtime loads prompt templates | Pi `/prompts/` directory convention | `.md` files with optional `{{variable}}` substitution |
| Pi runtime loads agent definitions | Pi `agents/` directory + subagent extension | Requires `@tungthedev/pi-extensions` or equivalent for sub-agent support |
| npm publish | `npm publish` + `publish:changed` script | Requires `pi-package` keyword to appear in Pi package registry |

### Technology Choices

| Choice | Rationale |
|--------|-----------|
| TypeScript for generator | Consistent with OpenCode, type-safe YAML parsing |
| `js-yaml` for YAML parsing | Already a monorepo dependency (OpenCode uses it) |
| `gray-matter` for frontmatter | Already a monorepo dependency |
| Jest for tests | Consistent with rest of monorepo |
| Committed generated output | Same as OpenCode — generated artifacts are versioned, CI detects drift |

---

## Master Task List

### Cluster A — Foundation

**TRD-001: Scaffold packages/pi directory structure** [satisfies REQ-001]
- Create all directories: `src/transformers/`, `extensions/`, `prompts/`, `agents/`, `skills/`, `tests/`, `.claude-plugin/`
- Create stub files: `src/index.ts`, `src/generator.ts`, `src/types.ts`, `src/transformers/command-transformer.ts`, `src/transformers/agent-transformer.ts`, `src/transformers/skill-copier.ts`
- Estimate: 2h
- Validates PRD ACs: AC-001-1

**TRD-001-TEST: Validate packages/pi workspace resolution** [verifies TRD-001][satisfies REQ-001][depends: TRD-001]
- Run `npm install` from monorepo root — packages/pi resolves as workspace package
- Run `npm run validate` — packages/pi passes schema and structure checks
- Estimate: 1h
- Validates PRD ACs: AC-001-1, AC-001-2

---

**TRD-002: Create package.json** [satisfies REQ-002]
- `name: "@fortium/ensemble-pi"`, `keywords: ["pi-package", "ensemble", "ai-agents"]`
- `pi` manifest field: `{ "extensions": ["./extensions"], "skills": ["./skills"], "prompts": ["./prompts"], "agents": ["./agents"] }`
- `dependencies: { "js-yaml": "^4.1.0", "gray-matter": "^4.0.3" }`
- `devDependencies: { "jest", "typescript", "@types/node", "@types/js-yaml" }`
- `scripts: { "build": "tsc", "test": "jest", "generate": "node src/index.js", "prepublishOnly": "npm run build && npm test && npm run validate:version" }`
- Estimate: 2h
- Validates PRD ACs: AC-002-1, AC-002-2, AC-002-3

**TRD-002-TEST: Validate pi install and manifest discovery** [verifies TRD-002][satisfies REQ-002][depends: TRD-002]
- Run `pi install npm:@fortium/ensemble-pi` (against published or local package)
- Run `pi list` — ensemble-pi appears in installed packages
- Verify Pi discovers extensions, skills, prompts, agents from declared manifest directories
- Estimate: 2h
- Validates PRD ACs: AC-002-1, AC-002-2, AC-002-3

---

**TRD-003: Create tsconfig.json** [satisfies ARCH]
- Target: `ES2020`, `module: commonjs`, `outDir: "dist"`, `rootDir: "src"`
- Strict mode enabled
- Consistent with `packages/opencode/tsconfig.json`
- Estimate: 1h

---

**TRD-004: Implement validate:version script** [satisfies REQ-003]
- Script: `node -e "const p=require('./package.json'); const c=require('./.claude-plugin/plugin.json'); if(p.version!==c.version){...}"`
- Add to `package.json scripts.validate:version`
- Add to `prepublishOnly` chain
- Estimate: 1h
- Validates PRD ACs: AC-003-1, AC-003-2

**TRD-004-TEST: Verify version sync enforcement** [verifies TRD-004][satisfies REQ-003][depends: TRD-004]
- Temporarily set mismatched versions → `validate:version` exits non-zero with clear message
- Restore matching versions → `validate:version` exits 0
- Estimate: 1h
- Validates PRD ACs: AC-003-1, AC-003-2

---

### Cluster B — Generator Core

**TRD-005: Implement generator CLI entry point (src/index.ts)** [satisfies REQ-004]
- Accept flags: `--dry-run` (no file writes), `--verbose` (log each transform), `--validate` (parse-check output without writing)
- Exit 0 on success, exit 1 on any error (parse errors AND structural errors)
- Validate structural requirements before transforming: `metadata.name`, `metadata.version`, `workflow.phases` must be present; exit 1 with specific message (e.g., "Missing required field: workflow in create-prd.yaml") if absent
- Call `generator.ts` with parsed options
- Add `generate:pi` to monorepo root `package.json` scripts: `"generate:pi": "npm run generate --workspace=packages/pi"`
- Estimate: 3h
- Validates PRD ACs: AC-004-1, AC-004-2, AC-004-3, AC-004-4

**TRD-005-TEST: Test generator CLI flags** [verifies TRD-005][satisfies REQ-004][depends: TRD-005]
- Default run: all output files created in correct Pi directories (`prompts/`, `agents/`, `skills/`, `AGENTS.md`)
- `--dry-run`: no files written, output logged to console
- `--verbose`: each source→output path pair logged
- Malformed YAML input: exits 1 with file path + line number in error message
- Structurally invalid YAML (missing `workflow` or `metadata`): exits 1 with specific field-level error message
- Estimate: 2h
- Validates PRD ACs: AC-004-1, AC-004-2, AC-004-3, AC-004-4

---

**TRD-006a: Implement command transformer — phase/step/action translation** [satisfies REQ-005]
- Read YAML `workflow.phases` array → render as numbered markdown `## Phase N: Name` sections
- Render `steps` as `### Step N: Title` with description and action bullet list
- Render `constraints` as a fenced callout block at top of template
- Render `mission.summary` as template preamble
- Preserve `metadata.version` and `metadata.description` in template header comment
- Output: `.md` file per command in `packages/pi/prompts/`
- Estimate: 4h
- Validates PRD ACs: AC-005-1, AC-005-3

**TRD-006b: Implement command transformer — interview protocol + tool mapping** [satisfies REQ-005, REQ-012]
- Detect `INTERVIEW PROTOCOL` action annotations and preserve them verbatim
- Map all occurrences of `AskUserQuestion` → `ask_user` (the Pi extension tool name)
- Map `{{variable}}` argument placeholders to Pi template variable syntax
- Ensure interview protocol directives ("ONE question at a time", "wait for answer") are present in output
- Estimate: 4h
- Validates PRD ACs: AC-005-2, AC-005-4

**TRD-006-TEST: Unit test command transformer** [verifies TRD-006a, TRD-006b][satisfies REQ-005][depends: TRD-006a, TRD-006b]
- Test: all 4 phases of `create-prd.yaml` appear in output with correct structure
- Test: `AskUserQuestion` → `ask_user` substitution (no occurrences of `AskUserQuestion` remain)
- Test: interview protocol directives preserved verbatim
- Test: two runs on same input produce identical output (determinism)
- Test: command with `{{args}}` produces correct Pi template variable
- Estimate: 3h
- Validates PRD ACs: AC-005-1, AC-005-2, AC-005-3, AC-005-4

---

**TRD-007: Implement agent transformer** [satisfies REQ-006]
- Read YAML `name`, `description`, `tools`, `model` → render YAML frontmatter block
- Filter `tools` list to Pi-available tools: `[read, write, edit, bash, ask_user]` (strip Claude Code-only tools like `Task`, `TodoWrite`)
- Render agent `behavior` / `mission` sections as markdown body
- Output: `.md` file per agent in `packages/pi/agents/`
- Estimate: 4h
- Validates PRD ACs: AC-006-1, AC-006-2

**TRD-007-TEST: Unit test agent transformer** [verifies TRD-007][satisfies REQ-006][depends: TRD-007]
- Test: `product-management-orchestrator.yaml` produces valid YAML frontmatter
- Test: Claude Code-only tools (`Task`, `TodoWrite`, `Agent`) absent from Pi agent tools list
- Test: agent definition loads in Pi subagent extension without errors (integration test)
- Estimate: 2h
- Validates PRD ACs: AC-006-1, AC-006-2, AC-006-3

---

**TRD-008: Implement skill copier** [satisfies REQ-007]
- Scan `packages/*/skills/*/SKILL.md` (and `packages/*/skills/*/REFERENCE.md`)
- Copy to `packages/pi/skills/<skill-name>/` preserving directory name
- No content transformation — Pi SKILL.md format is compatible with Ensemble's
- Estimate: 2h
- Validates PRD ACs: AC-007-1

**TRD-008-TEST: Test skill copier** [verifies TRD-008][satisfies REQ-007][depends: TRD-008]
- Test: `framework-detector/SKILL.md` content in output is byte-identical to source
- Test: `test-detector/SKILL.md` present in `packages/pi/skills/`
- Test: Pi session with ensemble-pi installed can load framework-detector skill
- Estimate: 1h
- Validates PRD ACs: AC-007-1, AC-007-2

---

**TRD-009: Implement AGENTS.md generator** [satisfies REQ-008]
- Extract from `packages/CLAUDE.md`: constraints section, agent mesh overview, delegation protocol
- Strip Claude Code-specific sections (plugin install, permissions, hooks configuration)
- Output: `packages/pi/AGENTS.md`
- Estimate: 2h
- Validates PRD ACs: AC-008-1, AC-008-2

**TRD-009-TEST: Test AGENTS.md content** [verifies TRD-009][satisfies REQ-008][depends: TRD-009]
- Test: generated `AGENTS.md` contains ensemble constraints and delegation protocol
- Test: no Claude Code plugin-specific content (hooks, settings.json, plugin install) in output
- Test: Pi session with ensemble-pi installed reflects AGENTS.md context
- Estimate: 1h
- Validates PRD ACs: AC-008-1, AC-008-2

---

**TRD-010: Implement --validate flag and performance target** [satisfies REQ-009]
- After generation, parse all output `.md` files with `gray-matter` + markdown parser
- Parse all agent `.md` frontmatter as YAML
- Report any parse errors with file path and line number
- `--validate` flag: runs validation only, no write
- Exit 1 if any artifact fails validation
- Performance target: full `npm run generate:pi` completes in < 10 seconds for the current YAML source set
- Estimate: 2h
- Validates PRD ACs: AC-009-1, AC-009-2

**TRD-010-TEST: Test --validate catches malformed artifacts** [verifies TRD-010][satisfies REQ-009][depends: TRD-010]
- Inject malformed frontmatter into a test agent file → `--validate` reports it with path
- Valid artifacts → `--validate` exits 0
- Estimate: 1h
- Validates PRD ACs: AC-009-1, AC-009-2

---

### Cluster C — AskUserQuestion Extension

**TRD-011: Implement extensions/ask-user.ts** [satisfies REQ-010, REQ-011]
- Export default function `(pi: ExtensionAPI) => void`
- Call `pi.registerTool({ name: "ask_user", description: "Ask the user a single question and return their answer. Use for interactive interviews — one question at a time.", parameters: { question: { type: "string", description: "The question to display to the user" } }, execute: async ({ question }) => { return await pi.prompt(question) } })`
- Handle interruption (Ctrl+C) by returning empty string with interruption note
- Estimate: 6h
- Validates PRD ACs: AC-010-1, AC-010-2, AC-010-3, AC-011-1, AC-011-2

**TRD-011-TEST: Integration test ask_user tool** [verifies TRD-011][satisfies REQ-010, REQ-011][depends: TRD-011]
- Test: extension loads in Pi without errors (`pi list` shows ensemble-pi active)
- Test: model call to `ask_user({ question: "test?" })` returns user input
- Test: sequential calls (simulating 5-question interview) each wait for input before proceeding
- Test: Ctrl+C during `ask_user` returns gracefully (no hang)
- Estimate: 3h
- Validates PRD ACs: AC-010-1, AC-010-2, AC-010-3, AC-011-1, AC-011-2

---

**TRD-012: Verify ask_user references in generated templates** [satisfies REQ-012]
- Run `npm run generate:pi` against all PRD/TRD commands
- Grep generated `prompts/*.md` for any remaining `AskUserQuestion` → must be zero occurrences
- Grep generated `prompts/*.md` for `ask_user` → must appear in all interview-protocol commands
- Estimate: 1h (verification task post-generation)
- Validates PRD ACs: AC-012-1

**TRD-012-TEST: Automated reference check** [verifies TRD-012][satisfies REQ-012][depends: TRD-012, TRD-006b]
- Jest test: load `prompts/create-prd.md`, assert zero occurrences of `AskUserQuestion`
- Jest test: load `prompts/create-prd.md`, assert `ask_user` appears in interview phase sections
- Estimate: 1h
- Validates PRD ACs: AC-012-1, AC-012-2

---

### Cluster D — V1 Command Verification

**TRD-013: Verify create-prd and create-trd prompt template quality** [satisfies REQ-013, REQ-016]
- Run generator, open `prompts/create-prd.md` and `prompts/create-trd.md`
- Manual review: all phases present, interview protocol directives present, `ask_user` referenced
- Fix any transformer gaps discovered during review
- Estimate: 2h
- Validates PRD ACs: AC-013-1, AC-013-3, AC-016-1

**TRD-013-TEST: End-to-end create-prd run in Pi** [verifies TRD-013][satisfies REQ-013][depends: TRD-013, TRD-011]
- Run `/create-prd "test product description"` in a Pi session with ensemble-pi installed
- Verify: Scale Detection step runs, Q1 asked via `ask_user`, subsequent questions asked one at a time
- Verify: final PRD contains frontmatter, health summary, REQ-NNN requirements, AC-NNN-M criteria, readiness scorecard
- Estimate: 2h
- Validates PRD ACs: AC-013-1, AC-013-2, AC-013-3

---

**TRD-014: Verify refine-prd, analyze-product, refine-trd, create-trd outputs** [satisfies REQ-014, REQ-015, REQ-016, REQ-017]
- Run generator, manual review of all four prompt templates
- Verify interview protocols present in refine-prd and refine-trd
- Estimate: 2h
- Validates PRD ACs: AC-014-1, AC-015-1, AC-016-1, AC-017-1

**TRD-014-TEST: Smoke test refine and analyze commands in Pi** [verifies TRD-014][satisfies REQ-014, REQ-015, REQ-017][depends: TRD-014, TRD-011]
- Run `/refine-prd` against a sample PRD — verify interview and file update
- Run `/analyze-product` — verify structured analysis output
- Run `/refine-trd` against a sample TRD — verify interview and file update
- Estimate: 3h
- Validates PRD ACs: AC-014-1, AC-014-2, AC-015-1, AC-017-1, AC-017-2

---

### Cluster E — Agent Definitions

**TRD-015: Generate and verify product-management-orchestrator agent** [satisfies REQ-018]
- Run generator for `product-management-orchestrator.yaml`
- Review `agents/product-management-orchestrator.md` frontmatter and body
- Ensure tools list is Pi-compatible (no Task, TodoWrite, Agent)
- Estimate: 2h
- Validates PRD ACs: AC-018-1

**TRD-015-TEST: Load orchestrator in Pi subagent extension** [verifies TRD-015][satisfies REQ-018][depends: TRD-015]
- With `@tungthedev/pi-extensions` or Pi subagent example installed, load the orchestrator as a subagent
- Verify it initializes with the correct tools and context
- Note: requires external subagent extension — document as prerequisite in README
- Estimate: 2h
- Validates PRD ACs: AC-018-1, AC-018-2

---

**TRD-016: Configure agent discovery in Pi manifest** [satisfies REQ-019]
- Verify `pi` manifest in `package.json` includes `"agents": ["./agents"]`
- Test that Pi discovers agents from the installed package without manual path config
- Estimate: 1h
- Validates PRD ACs: AC-019-1

**TRD-016-TEST: Verify agent discovery after install** [verifies TRD-016][satisfies REQ-019][depends: TRD-016, TRD-002]
- Install package, run `pi list` or equivalent — agents from `agents/` are discoverable
- Estimate: 1h
- Validates PRD ACs: AC-019-1

---

### Cluster F — Distribution

**TRD-017: Add packages/pi to publish:changed pipeline** [satisfies REQ-020]
- Update root `scripts/publish-plugin.js` (or equivalent) to include `packages/pi`
- Verify `prepublishOnly` chain: `build → test → validate:version`
- Estimate: 1h
- Validates PRD ACs: AC-020-1

**TRD-017-TEST: Verify publish pipeline** [verifies TRD-017][satisfies REQ-020][depends: TRD-017]
- Run `npm publish --dry-run` in `packages/pi` — all required fields present, no errors
- Estimate: 1h
- Validates PRD ACs: AC-020-1, AC-020-2

---

**TRD-018: Add generate:pi to validate.yml CI workflow** [satisfies REQ-021]
- Add step to `.github/workflows/validate.yml`: run `npm run generate:pi`, then `git diff --exit-code packages/pi/prompts packages/pi/agents packages/pi/skills packages/pi/AGENTS.md`
- CI fails if generated artifacts differ from committed versions
- Estimate: 2h
- Validates PRD ACs: AC-021-1, AC-021-2

**TRD-018-TEST: Trigger CI drift detection** [verifies TRD-018][satisfies REQ-021][depends: TRD-018]
- Modify a YAML source without running generator → CI fails with diff
- Run generator after YAML change → commit artifacts → CI passes
- Estimate: 1h
- Validates PRD ACs: AC-021-1, AC-021-2

---

**TRD-019: Write README.md** [satisfies REQ-022]
- Installation: `pi install npm:@fortium/ensemble-pi`
- Prerequisites: note that sub-agent support (for orchestrator) requires a Pi subagent extension
- Quick-start: `/create-prd "your product idea"` and `/create-trd docs/PRD/...`
- Full command list with one-line descriptions
- Link to ensemble docs and Pi docs
- Estimate: 2h
- Validates PRD ACs: AC-022-1

---

**TRD-020: Validate local development install** [satisfies REQ-023]
- Document `pi -e git:github.com/FortiumPartners/ensemble` or local path equivalent
- Test that this loads the package without errors
- Document in README under "Development" section
- Estimate: 1h
- Validates PRD ACs: AC-023-1

---

**TRD-021: Write CHANGELOG.md** [satisfies REQ-028]
- Initialize with `## [1.0.0] - 2026-03-29` entry
- List all v1 capabilities: commands, extension, agent, skills
- Follow keep-a-changelog format consistent with other ensemble packages
- Estimate: 1h
- Validates PRD ACs: AC-028-1

---

### Cluster G — Quality

**TRD-022: Register ensemble-pi in marketplace.json** [satisfies REQ-026]
- Add entry: `{ "name": "ensemble-pi", "version": "...", "source": "./packages/pi", "description": "Pi runtime support — translates ensemble artifacts for Pi coding agent", "category": "core" }`
- Run `npm run validate` — passes schema validation
- Estimate: 1h
- Validates PRD ACs: AC-026-1

---

**TRD-023: Add Pi version compatibility declaration** [satisfies REQ-027]
- Add `engines: { "pi": ">=1.0.0" }` or `peerDependencies` entry for `@mariozechner/pi-coding-agent`
- Research minimum compatible Pi version that supports current ExtensionAPI signature
- Estimate: 1h
- Validates PRD ACs: AC-027-1

---

**TRD-024: Jest tests for generator** [satisfies REQ-025]
- `command-transformer.test.ts`: 5+ test cases covering phase rendering, interview protocol, tool name mapping, determinism, empty actions
- `agent-transformer.test.ts`: 3+ test cases covering frontmatter validity, tool filtering, body rendering
- `skill-copier.test.ts`: 2+ test cases covering content identity, directory structure
- `generator.test.ts`: error handling (malformed YAML exits 1 with message), --dry-run (no writes)
- Target: ≥80% coverage of `src/` excluding `index.ts`
- Estimate: 8h
- Validates PRD ACs: AC-025-1, AC-025-2

---

**TRD-025: End-to-end quality parity test** [satisfies REQ-024, REQ-016]
- Run `/create-prd "build a task management app"` on both Claude Code and Pi with identical inputs
- Run `/create-trd` on the resulting PRD on both Claude Code and Pi with identical inputs
- Compare PRD outputs for: presence of frontmatter, health summary, ≥5 REQ-NNN requirements, ≥1 AC per requirement, dependency map, readiness scorecard
- Compare TRD outputs for: architecture decision, master task list with TRD-NNN IDs, sprint planning, traceability matrix, design readiness scorecard
- Document any structural differences and address in transformer if needed
- Estimate: 4h
- Validates PRD ACs: AC-024-1, AC-024-2, AC-016-2

**TRD-025-TEST: Automated structural equivalence check** [verifies TRD-025][satisfies REQ-024, REQ-016][depends: TRD-025, TRD-013-TEST]
- Write a comparison script that parses both PRDs and TRDs and checks for required sections
- PRD pass criteria: both contain all 6 required sections (see AC-024-1)
- TRD pass criteria: both contain architecture decision, task list, sprint plan, traceability matrix, scorecard (see AC-016-2)
- Estimate: 2h
- Validates PRD ACs: AC-024-1, AC-024-2, AC-016-2

---

## Sprint Planning

### Sprint 1 — Foundation (~7h)
| Task | Hours |
|------|-------|
| TRD-001: Scaffold directory structure | 2h |
| TRD-002: Create package.json | 2h |
| TRD-003: Create tsconfig.json | 1h |
| TRD-004: Implement validate:version | 1h |
| TRD-001-TEST | 1h |

Dependencies: none — these are the root of all dependency chains.

### Sprint 2 — Generator Core (~20h)
| Task | Hours |
|------|-------|
| TRD-005: Generator CLI entry point | 3h |
| TRD-006a: Command transformer — phase/step/action | 4h |
| TRD-006b: Command transformer — interview protocol + tool mapping | 4h |
| TRD-007: Agent transformer | 4h |
| TRD-008: Skill copier | 2h |
| TRD-009: AGENTS.md generator | 2h |
| TRD-010: --validate flag | 2h |

Dependencies: Sprint 1 (package scaffold must exist).

### Sprint 2 Tests (~13h)
| Task | Hours |
|------|-------|
| TRD-002-TEST, TRD-004-TEST | 3h |
| TRD-005-TEST, TRD-006-TEST | 5h |
| TRD-007-TEST, TRD-008-TEST, TRD-009-TEST, TRD-010-TEST | 5h |

### Sprint 3 — Extension + Wiring (~10h)
| Task | Hours |
|------|-------|
| TRD-011: ask-user.ts extension | 6h |
| TRD-012: Verify ask_user refs in templates | 1h |
| TRD-011-TEST | 3h |
| TRD-012-TEST | 1h |

Dependencies: Sprint 2 (TRD-006b must be complete for tool mapping).

### Sprint 4 — V1 Verification + Agents (~14h)
| Task | Hours |
|------|-------|
| TRD-013: Verify create-prd, create-trd | 2h |
| TRD-014: Verify refine-prd, analyze-product, refine-trd | 2h |
| TRD-015: Generate orchestrator agent | 2h |
| TRD-016: Configure agent discovery | 1h |
| TRD-013-TEST | 2h |
| TRD-014-TEST | 3h |
| TRD-015-TEST, TRD-016-TEST | 3h |

Dependencies: Sprint 3 (ask_user extension needed for command smoke tests).

### Sprint 5 — Distribution + Quality (~25h)
| Task | Hours |
|------|-------|
| TRD-017: Publish pipeline | 1h |
| TRD-018: CI workflow | 2h |
| TRD-019: README | 2h |
| TRD-020: Local dev install | 1h |
| TRD-021: CHANGELOG | 1h |
| TRD-022: marketplace.json | 1h |
| TRD-023: Pi version compat | 1h |
| TRD-024: Jest tests | 8h |
| TRD-025: Quality parity | 4h |
| TRD-017-TEST, TRD-018-TEST | 2h |
| TRD-025-TEST | 2h |

Dependencies: Sprint 4 (commands and agents verified before distribution).

**Total:** ~89h across 43 tasks (26 implementation + 17 test)

---

## Acceptance Criteria Traceability

| REQ-NNN | Description | Implementation Tasks | Test Tasks |
|---------|-------------|---------------------|-----------|
| REQ-001 | Monorepo package scaffold | TRD-001 | TRD-001-TEST |
| REQ-002 | Pi-compatible package.json | TRD-002 | TRD-002-TEST |
| ARCH | TypeScript config (tsconfig) | TRD-003 | — (manual review) |
| REQ-003 | Version synchronization | TRD-004 | TRD-004-TEST |
| REQ-004 | generate:pi script | TRD-005 | TRD-005-TEST |
| REQ-005 | Command → prompt template | TRD-006a, TRD-006b | TRD-006-TEST, TRD-012-TEST |
| REQ-006 | Agent → Pi agent definition | TRD-007 | TRD-007-TEST |
| REQ-007 | SKILL.md propagation | TRD-008 | TRD-008-TEST |
| REQ-008 | AGENTS.md generation | TRD-009 | TRD-009-TEST |
| REQ-009 | Generator validation step | TRD-010 | TRD-010-TEST |
| REQ-010 | ask_user tool registration | TRD-011 | TRD-011-TEST |
| REQ-011 | Extension entry point | TRD-011 | TRD-011-TEST |
| REQ-012 | Tool refs in templates | TRD-012 | TRD-012-TEST |
| REQ-013 | /create-prd template | TRD-013 | TRD-013-TEST |
| REQ-014 | /refine-prd template | TRD-014 | TRD-014-TEST |
| REQ-015 | /analyze-product template | TRD-014 | TRD-014-TEST |
| REQ-016 | /create-trd template | TRD-013, TRD-025 | TRD-013-TEST, TRD-025-TEST |
| REQ-017 | /refine-trd template | TRD-014 | TRD-014-TEST |
| REQ-018 | product-management-orchestrator | TRD-015 | TRD-015-TEST |
| REQ-019 | Agent discovery config | TRD-016 | TRD-016-TEST |
| REQ-020 | npm publish pipeline | TRD-017 | TRD-017-TEST |
| REQ-021 | CI integration | TRD-018 | TRD-018-TEST |
| REQ-022 | Installation README | TRD-019 | — (manual review) |
| REQ-023 | Local dev install | TRD-020 | — (manual) |
| REQ-024 | Output quality parity | TRD-025 | TRD-025-TEST |
| REQ-025 | Generator test coverage | TRD-024 | TRD-024 (is the test) |
| REQ-026 | Marketplace registration | TRD-022 | TRD-022 (validate script) |
| REQ-027 | Pi version compat | TRD-023 | — (manual) |
| REQ-028 | Changelog | TRD-021 | — (review) |

Traceability check: 28 requirements covered, 0 uncovered, 0 orphaned annotations.

---

## Design Readiness Scorecard

| Dimension | Score | Notes |
|-----------|-------|-------|
| Architecture Completeness | 4.5 | All components, interfaces, and data flows defined; Option B rationale clear; structural validation and performance target specified |
| Task Coverage | 5.0 | All 28 PRD requirements + ARCH tasks have implementation and test tasks; AC-016-2 coverage gap resolved; traceability matrix complete |
| Dependency Clarity | 4.0 | Sprint ordering explicit; one external dependency (Pi subagent extension for TRD-015-TEST) documented |
| Estimate Confidence | 4.5 | Sprint hour totals corrected; TRD-011 (ask_user extension) carries uncertainty; Pi TUI API unknown until hands-on |

**Overall Score: 4.5 / 5.0 — PASS**

### Known Risks

1. **ask_user TUI integration (TRD-011)** — Pi's `ExtensionAPI.prompt()` method (or equivalent) needs validation against actual Pi source before coding. If Pi doesn't expose a synchronous prompt API, an alternative (streaming input via `pi.on("input")`) may be needed. Mitigation: spike TRD-011 first in Sprint 3.

2. **Subagent extension external dependency (TRD-015)** — The orchestrator agent requires a Pi subagent extension not shipped by ensemble-pi. README must clearly state this prerequisite; v2 should consider bundling a minimal subagent extension.

3. **Generated artifact size** — Pi prompt templates for commands like `create-trd` (256-line YAML) may produce very long prompt templates. Test that Pi's context window handles them gracefully.

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2026-03-29 | Initial TRD with 43 tasks, 5 sprints |
| 1.1.0 | 2026-03-29 | Refinement: corrected sprint hour totals (84h→89h), added AC-016-2 coverage to TRD-025, added structural YAML validation to TRD-005, added performance target (<10s) to TRD-010, fixed TRD-024 naming, added AC-004-1 coverage to TRD-005-TEST, added TRD-003 to traceability table |

---

## Suggested Next Steps

```
/ensemble:configure-team docs/TRD/TRD-2026-018-ensemble-pi-runtime.md
/ensemble:implement-trd-beads docs/TRD/TRD-2026-018-ensemble-pi-runtime.md
```
