---
document_id: TRD-2026-022
prd_reference: docs/PRD/PRD-2026-021-tiered-model-aliases.md
version: 1.0.0
status: Draft
date: 2026-05-30
design_readiness_score: 4.3
total_tasks: 56
architecture: "Option C — Balanced brownfield: git-root config, core/lib foundation, additive-first then YAML migration"
---

# TRD-2026-022: Tiered Model Aliases & Project-Level Model Config

**PRD:** docs/PRD/PRD-2026-021-tiered-model-aliases.md
**PRD Readiness:** 4.6 / 5.0 (PASS)

---

## TRD Health Summary

| Metric | Value |
|--------|-------|
| Implementation tasks | 28 |
| Test tasks | 28 |
| Total tasks | 56 |
| PR boundaries | 4 |
| REQ coverage | 24/24 (100%) |
| Orphaned annotations | 0 |

---

## Architecture Decision

### Chosen Approach: Option C — Balanced Brownfield

Keep `packages/core/lib/` as the home for all config logic. New config schema is additive in PR 1 (no breaking changes). The breaking alias rename happens atomically in PR 2 (all YAML files migrate at once). PR 3 delivers the user-facing tooling. PR 4 adds operational guards.

### Component Boundaries

```
packages/core/lib/
  known-model-ids.js         ← source of truth for valid model IDs (new)
  config-loader.js           ← updated: new path, schema, legacy removal
  usage-logger.js            ← unchanged (hardcoded sane defaults)

schemas/
  ensemble-model-config-schema.json  ← new JSON schema file
  agent-yaml-schema.json              ← add optional model field

packages/core/commands/
  map-model.yaml             ← wizard skill (new)
  migrate-model-config.yaml  ← migration skill (new)

scripts/
  lint-model-ids.js          ← new lint script
```

### Data Flow

```
Command/Agent invocation
  → config-loader.js reads <project_root>/.claude/ensemble-model-config.json
  → validates against ensemble-model-config-schema.json
  → pre-flights all 3 tier IDs against known-model-ids.js
  → resolves tier alias → model ID
  → passes to Claude SDK

ENSEMBLE_MODEL_OVERRIDE env var
  → accepted: high | medium | low (tier aliases only)
  → rejected: opus/sonnet/haiku (legacy) + full model IDs
```

### Alternatives Considered

- **Option A (minimal):** Just update config-loader.js defaults; no schema validation, no wizard. Fast but no safeguards against stale IDs.
- **Option B (full prod):** Same as Option C but with per-command tier in the global config (commandOverrides block). Rejected — PRD explicitly lists this as non-goal.

### Technology Choices

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Schema format | JSON Schema draft-07 | Consistent with existing `schemas/` files |
| Config write | write-temp + fs.rename | Atomic on POSIX; NTFS best-effort |
| Lint script | Node.js script | No new tooling dependency |

---

## Master Task List

### PR 1: Config Infrastructure Foundation
**Shippable State:** The new `ensemble-model-config.json` format is accepted by the plugin; commands load tier mappings from the git-root project file if present, falling back to updated defaults; no breaking changes — existing users are unaffected.

- [ ] **TRD-001**: Create `packages/core/lib/known-model-ids.js` exporting immutable KNOWN_MODEL_IDS array of all current pinned Claude model IDs [satisfies REQ-024]
  **Estimate:** 2h
  **Validates PRD ACs:** AC-024-1, AC-024-3
  Implementation AC:
  - [ ] Given the file is imported, when KNOWN_MODEL_IDS is read, then it is an immutable array of fully-pinned model IDs (no moving aliases)
  - [ ] Given a new ID is added to the file, when imported, then all three consumers (validator, wizard, lint) see it without any other changes

- [ ] **TRD-001-TEST**: Unit test known-model-ids exports [verifies TRD-001] [satisfies REQ-024] [depends: TRD-001]
  **Estimate:** 1h
  **Validates PRD ACs:** AC-024-1, AC-024-3
  Test AC:
  - [ ] Given KNOWN_MODEL_IDS is imported, when inspected, then every entry matches the fully-pinned format and the array is frozen

- [ ] **TRD-002**: Implement git-root config path resolution in `config-loader.js` — walk up from CWD to find `.git`, fall back to CWD if not found [satisfies REQ-001]
  **Estimate:** 2h
  **Validates PRD ACs:** AC-001-1, AC-001-2, AC-001-3, AC-001-4
  Implementation AC:
  - [ ] Given a subdirectory of a git repo, when getConfigPath() is called, then it returns `<git_root>/.claude/ensemble-model-config.json`
  - [ ] Given no `.git` found, when called, then returns `<cwd>/.claude/ensemble-model-config.json`

- [ ] **TRD-002-TEST**: Test config path resolution logic [verifies TRD-002] [satisfies REQ-001] [depends: TRD-002]
  **Estimate:** 1h
  **Validates PRD ACs:** AC-001-1, AC-001-2, AC-001-3, AC-001-4

- [ ] **TRD-003**: Create `schemas/ensemble-model-config-schema.json` with version, tiers (high/medium/low), and optional extraKnownModelIds [satisfies REQ-002]
  **Estimate:** 2h
  **Validates PRD ACs:** AC-002-1, AC-002-2, AC-002-3, AC-002-4, AC-002-5
  Implementation AC:
  - [ ] Given a valid config, when validated against the schema, then it passes
  - [ ] Given version: 999, when validated, then error message is exactly: "Unsupported ensemble-model-config version 999. Upgrade the plugin or downgrade the config to version 1."
  - [ ] Given extra keys (e.g., commandOverrides), when validated, then a warning lists unknown keys without failing

- [ ] **TRD-003-TEST**: Validate schema against conformant and non-conformant sample configs [verifies TRD-003] [satisfies REQ-002] [depends: TRD-003]
  **Estimate:** 1h
  **Validates PRD ACs:** AC-002-1, AC-002-2, AC-002-3, AC-002-4, AC-002-5

- [ ] **TRD-004**: Update `getDefaultConfig()` in config-loader.js to return new tier-based schema (`high`/`medium`/`low` mapped to current model IDs); update `getConfigPaths()` to return only the project-level path [satisfies REQ-003] [satisfies REQ-015] [depends: TRD-002, TRD-003]
  **Estimate:** 2h
  **Validates PRD ACs:** AC-003-1, AC-003-2, AC-015-1
  Implementation AC:
  - [ ] Given getDefaultConfig() is called, then modelAliases keys are exactly ["high","medium","low"]
  - [ ] Given the defaults ship, then no tier maps to a retired model ID

- [ ] **TRD-004-TEST**: Test default config structure and values [verifies TRD-004] [satisfies REQ-003] [depends: TRD-004]
  **Estimate:** 1h
  **Validates PRD ACs:** AC-003-1, AC-003-2, AC-015-1

---

### PR 2: Command & Agent YAML Migration + Legacy Rejection
**Shippable State:** All 18 command YAMLs and all 28 agent files use `high`/`medium`/`low` tier aliases; legacy `opus`/`sonnet`/`haiku` are rejected by schema validation; old XDG config loading is removed; this is the breaking change PR.

- [ ] **TRD-005**: Migrate all command YAML files in `packages/*/commands/**/*.yaml`: replace `model: opus` → `model: high`, `model: sonnet` → `model: medium`, `model: haiku` → `model: low` (18 files) [satisfies REQ-011]
  **Estimate:** 3h
  **Validates PRD ACs:** AC-011-1, AC-011-2
  Implementation AC:
  - [ ] Given migration is complete, when grepping for `model: opus|sonnet|haiku` in all command YAMLs, then zero matches return
  - [ ] Given migration is complete, when grepping for `model: high|medium|low`, then all prior commands appear

- [ ] **TRD-005-TEST**: Grep verification script confirms zero legacy aliases in command YAMLs [verifies TRD-005] [satisfies REQ-011] [depends: TRD-005]
  **Estimate:** 1h
  **Validates PRD ACs:** AC-011-1, AC-011-2

- [ ] **TRD-006**: Regenerate all `packages/*/commands/ensemble/*.md` files via `npm run generate` to reflect new `model:` values in frontmatter [satisfies REQ-012] [depends: TRD-005]
  **Estimate:** 1h
  **Validates PRD ACs:** AC-012-1
  Implementation AC:
  - [ ] Given regeneration runs, when comparing each .md frontmatter to its YAML source, then the model: field matches exactly

- [ ] **TRD-007**: Add optional `model` field with enum `["high","medium","low"]` to `schemas/agent-yaml-schema.json` [satisfies REQ-013]
  **Estimate:** 1h
  **Validates PRD ACs:** AC-013-1, AC-013-2
  Implementation AC:
  - [ ] Given agent YAML with `model: high`, when validated, then validation passes
  - [ ] Given agent YAML without model field, when validated, then validation passes

- [ ] **TRD-007-TEST**: Validate agent schema accepts valid tiers and rejects invalid values [verifies TRD-007] [satisfies REQ-013] [depends: TRD-007]
  **Estimate:** 1h
  **Validates PRD ACs:** AC-013-1, AC-013-2

- [ ] **TRD-008**: Add `model: high|medium|low` to all 28 agent YAML files per assignment table in REQ-014; remove `model: inherit` from mobile-developer.yaml [satisfies REQ-014] [depends: TRD-007]
  **Estimate:** 3h
  **Validates PRD ACs:** AC-014-1, AC-014-2, AC-014-3
  Implementation AC:
  - [ ] Given all 28 agents updated, when grepping for `model: inherit`, then zero matches
  - [ ] Given all 28 agents updated, when listing agents with `model: high`, then exactly 9 appear per the table

- [ ] **TRD-008-TEST**: Verify all 28 agent files have correct tier assignment matching the PRD table [verifies TRD-008] [satisfies REQ-014] [depends: TRD-008]
  **Estimate:** 1h
  **Validates PRD ACs:** AC-014-1, AC-014-2, AC-014-3

- [ ] **TRD-009**: Add legacy alias rejection to config schema validation: config with key `opus`/`sonnet`/`haiku` triggers error "legacy alias 'X' no longer supported — rename to 'Y'" [satisfies REQ-005] [depends: TRD-003]
  **Estimate:** 1h
  **Validates PRD ACs:** AC-005-1, AC-005-2
  Implementation AC:
  - [ ] Given config with key `opus`, when loaded, then validation fails with the exact migration message
  - [ ] Given command YAML with `metadata.model: opus`, when generator runs, then schema validation fails

- [ ] **TRD-009-TEST**: Test legacy alias rejection messages for all three legacy keys [verifies TRD-009] [satisfies REQ-005] [depends: TRD-009]
  **Estimate:** 1h
  **Validates PRD ACs:** AC-005-1, AC-005-2

- [ ] **TRD-010**: Integrate JSON schema validation into config loader load path — on failure, fall back to defaults and emit stderr warning with parse error details and file path [satisfies REQ-004] [depends: TRD-003, TRD-009]
  **Estimate:** 2h
  **Validates PRD ACs:** AC-004-1, AC-004-2
  Implementation AC:
  - [ ] Given invalid JSON, when loaded, then defaults are used and a warning identifies the parse error and file path
  - [ ] Given a model ID matching `^claude-[a-z0-9-]+$`, when validated, then the ID is accepted

- [ ] **TRD-010-TEST**: Test validation error handling: invalid JSON, missing tier, unknown version [verifies TRD-010] [satisfies REQ-004] [depends: TRD-010]
  **Estimate:** 1h
  **Validates PRD ACs:** AC-004-1, AC-004-2

- [ ] **TRD-011**: Remove `~/.config/ensemble/model-selection.json` and `~/.ensemble/model-selection.json` load paths from config-loader.js; add one-time stderr warning when a legacy file is detected on first post-upgrade run (sentinel: `~/.config/ensemble/seen-hints.json`) [satisfies REQ-016] [depends: TRD-002]
  **Estimate:** 2h
  **Validates PRD ACs:** AC-016-1, AC-016-2, AC-016-3
  Implementation AC:
  - [ ] Given legacy file present and no project config, when command runs first time, then defaults are used and single stderr warning names the legacy file and recommends /migrate-model-config
  - [ ] Given warning has been emitted once, when subsequent commands run, then warning is not repeated

- [ ] **TRD-011-TEST**: Test legacy file detection, warning emission, and one-time suppression [verifies TRD-011] [satisfies REQ-016] [depends: TRD-011]
  **Estimate:** 1h
  **Validates PRD ACs:** AC-016-1, AC-016-2, AC-016-3

---

### PR 3: /map-model Wizard + /migrate-model-config
**Shippable State:** Users can create or update their tier config via the interactive `/ensemble:map-model` wizard or the one-shot CLI form; users with legacy configs can migrate automatically via `/ensemble:migrate-model-config`; breaking changes are documented in CHANGELOG.

- [ ] **TRD-012**: Implement `/ensemble:map-model` skill — interactive wizard that lists current tiers, prompts user for each, stages changes in memory, saves on completion [satisfies REQ-006] [depends: TRD-003, TRD-001]
  **Estimate:** 4h
  **Validates PRD ACs:** AC-006-1, AC-006-2, AC-006-3
  Implementation AC:
  - [ ] Given existing config, when wizard invoked, then displays `high: <id>`, `medium: <id>`, `low: <id>` and prompts each
  - [ ] Given user presses enter at a prompt, when wizard advances, then that tier is unchanged
  - [ ] Given user supplies a new ID, when wizard advances, then it is staged for write

- [ ] **TRD-012-TEST**: Test wizard display, accept-current flow, and change-tier flow [verifies TRD-012] [satisfies REQ-006] [depends: TRD-012]
  **Estimate:** 2h
  **Validates PRD ACs:** AC-006-1, AC-006-2, AC-006-3

- [ ] **TRD-013**: Add KNOWN_MODEL_IDS numbered list suggestions at each wizard prompt; validate input against KNOWN_MODEL_IDS + extraKnownModelIds; reject unknowns with message pointing to extraKnownModelIds [satisfies REQ-007] [depends: TRD-012, TRD-001]
  **Estimate:** 2h
  **Validates PRD ACs:** AC-007-1, AC-007-2, AC-007-3
  Implementation AC:
  - [ ] Given wizard prompts for `high`, when displayed, then numbered list shows every KNOWN_MODEL_IDS entry
  - [ ] Given user types unlisted ID, when validated, then rejected with exact message: "Model ID '<id>' is not in the allow-list. Add it to extraKnownModelIds..."

- [ ] **TRD-013-TEST**: Test suggestions list and rejection of unknown IDs [verifies TRD-013] [satisfies REQ-007] [depends: TRD-013]
  **Estimate:** 1h
  **Validates PRD ACs:** AC-007-1, AC-007-2, AC-007-3

- [ ] **TRD-014**: Implement atomic config write in wizard: write to `.claude/ensemble-model-config.json.tmp`, then `fs.rename` to final path [satisfies REQ-008] [depends: TRD-012]
  **Estimate:** 1h
  **Validates PRD ACs:** AC-008-1, AC-008-2
  Implementation AC:
  - [ ] Given wizard completes, when file inspected, then contains valid JSON with all three tiers
  - [ ] Given process killed mid-write, when file inspected, then either prior or new full contents present

- [ ] **TRD-015**: Wizard creates `.claude/` directory if missing before writing config file [satisfies REQ-009] [depends: TRD-012]
  **Estimate:** 1h
  **Validates PRD ACs:** AC-009-1
  Implementation AC:
  - [ ] Given no `.claude/` directory, when wizard saves, then `.claude/` created with default permissions

- [ ] **TRD-016**: Wizard prints the three final tier mappings and absolute config file path after save [satisfies REQ-010] [depends: TRD-012]
  **Estimate:** 1h
  **Validates PRD ACs:** AC-010-1
  Implementation AC:
  - [ ] Given wizard saves successfully, then output shows all three mappings and the absolute file path

- [ ] **TRD-017**: Add one-shot CLI form: `/ensemble:map-model <tier> <model-id>` updates a single tier without entering the wizard [satisfies REQ-018] [depends: TRD-012]
  **Estimate:** 1h
  **Validates PRD ACs:** AC-018-1
  Implementation AC:
  - [ ] Given `/ensemble:map-model medium claude-sonnet-4-6` invoked, then only medium tier is updated, wizard not shown

- [ ] **TRD-017-TEST**: Test one-shot form updates single tier and leaves others unchanged [verifies TRD-017] [satisfies REQ-018] [depends: TRD-017]
  **Estimate:** 1h
  **Validates PRD ACs:** AC-018-1

- [ ] **TRD-018**: Implement `/ensemble:migrate-model-config` skill — reads legacy `model-selection.json`, translates opus→high/sonnet→medium/haiku→low, writes to project config; prompts before overwrite; warns about dropped commandOverrides; warns about dropped costTracking logPath [satisfies REQ-019] [depends: TRD-002, TRD-011]
  **Estimate:** 3h
  **Validates PRD ACs:** AC-019-1, AC-019-2, AC-019-3, AC-019-4, AC-019-5, AC-019-6
  Implementation AC:
  - [ ] Given legacy config present and no project config, when migrated, then project config written with three tiers
  - [ ] Given both legacy and project config exist, when migration invoked, then user is prompted before overwrite
  - [ ] Given no legacy config, when invoked, then "nothing to migrate" message and /map-model suggested
  - [ ] Given commandOverrides in legacy config, when migrated, then stderr lists dropped commands with instructions

- [ ] **TRD-018-TEST**: Test all five migration scenarios (new, overwrite prompt, nothing-to-migrate, commandOverrides warning, costTracking warning) [verifies TRD-018] [satisfies REQ-019] [depends: TRD-018]
  **Estimate:** 2h
  **Validates PRD ACs:** AC-019-1, AC-019-2, AC-019-3, AC-019-4, AC-019-5, AC-019-6

- [ ] **TRD-019**: Add breaking-change entry to CHANGELOG in relevant package describing alias rename and config path change with /ensemble:map-model pointer [satisfies REQ-017]
  **Estimate:** 1h
  **Validates PRD ACs:** AC-017-1
  Implementation AC:
  - [ ] Given the release is cut, when reading the package CHANGELOG, then an entry under "Breaking Changes" describes the rename

---

### PR 4: Operational Safeguards + Discoverability
**Shippable State:** Pre-flight validation halts commands before doing any work when tier config is invalid; CI lint script catches stale model IDs in YAML before they ship; new users see a single-line hint pointing at `/map-model`; the `ENSEMBLE_MODEL_OVERRIDE` env var enforces tier-aliases-only.

- [ ] **TRD-020**: Implement pre-flight model ID validation in config-loader.js: before any command or agent runs, validate all three tier mappings against KNOWN_MODEL_IDS + extraKnownModelIds; halt non-zero with help block on failure; skip pre-flight for /map-model and /migrate-model-config [satisfies REQ-020] [depends: TRD-001, TRD-010]
  **Estimate:** 3h
  **Validates PRD ACs:** AC-020-1, AC-020-2, AC-020-3, AC-020-4, AC-020-5, AC-020-6, AC-020-7
  Implementation AC:
  - [ ] Given tier maps to unknown ID, when command invoked, then workflow does not execute; stderr shows "Invalid model ID detected.", offending tier/value, file path, and "Run /ensemble:map-model to fix."
  - [ ] Given /map-model invoked with invalid config, when pre-flight runs, then validation is bypassed
  - [ ] Given extraKnownModelIds contains an ID used by a tier, when pre-flight runs, then validation passes

- [ ] **TRD-020-TEST**: Test pre-flight halt for invalid ID, missing tier, unreadable file, and bypass for repair commands [verifies TRD-020] [satisfies REQ-020] [depends: TRD-020]
  **Estimate:** 2h
  **Validates PRD ACs:** AC-020-1, AC-020-2, AC-020-3, AC-020-5, AC-020-6

- [ ] **TRD-021**: Add `npm run lint:model-ids` script at `scripts/lint-model-ids.js` — scans all `packages/*/commands/**/*.yaml` and `packages/*/agents/*.yaml` for model IDs not in KNOWN_MODEL_IDS; exits non-zero and lists offenders [satisfies REQ-021] [depends: TRD-001]
  **Estimate:** 2h
  **Validates PRD ACs:** AC-021-1, AC-021-2, AC-021-3
  Implementation AC:
  - [ ] Given command YAML references unlisted model ID, when lint runs, then exits non-zero listing offending file and value
  - [ ] Given all files use known IDs, when lint runs, then exits zero with single-line success

- [ ] **TRD-021-TEST**: Test lint exits non-zero on stale IDs and zero on clean files [verifies TRD-021] [satisfies REQ-021] [depends: TRD-021]
  **Estimate:** 1h
  **Validates PRD ACs:** AC-021-1, AC-021-2

- [ ] **TRD-022**: Implement first-run discoverability hint in config-loader.js — when no project config found, check `~/.config/ensemble/seen-hints.json`; if project path not present, emit single-line stderr hint and record it [satisfies REQ-022] [depends: TRD-002]
  **Estimate:** 2h
  **Validates PRD ACs:** AC-022-1, AC-022-2, AC-022-4
  Implementation AC:
  - [ ] Given no project config and unseen project path, when command runs, then hint fires: "Tip: run /ensemble:map-model to pin Claude model tiers for this project (.claude/ensemble-model-config.json)."
  - [ ] Given hint already emitted once, when subsequent command runs, then hint not repeated

- [ ] **TRD-022-TEST**: Test hint fires once, is suppressed on repeat, and does not block on seen-hints.json write failure [verifies TRD-022] [satisfies REQ-022] [depends: TRD-022]
  **Estimate:** 1h
  **Validates PRD ACs:** AC-022-1, AC-022-2, AC-022-4

- [ ] **TRD-023**: Enforce tier-aliases-only in ENSEMBLE_MODEL_OVERRIDE: reject legacy aliases with exact error message; reject full model IDs with exact error message [satisfies REQ-023] [depends: TRD-020]
  **Estimate:** 1h
  **Validates PRD ACs:** AC-023-1, AC-023-2, AC-023-3, AC-023-4
  Implementation AC:
  - [ ] Given `ENSEMBLE_MODEL_OVERRIDE=opus`, then halts with: "ENSEMBLE_MODEL_OVERRIDE value 'opus' is no longer supported. Use 'high', 'medium', or 'low'..."
  - [ ] Given `ENSEMBLE_MODEL_OVERRIDE=claude-opus-4-7`, then halts with: "ENSEMBLE_MODEL_OVERRIDE must be a tier alias ('high', 'medium', 'low'), not a model ID..."
  - [ ] Given `ENSEMBLE_MODEL_OVERRIDE=high`, then resolves to project's high tier mapping

- [ ] **TRD-023-TEST**: Test ENV VAR enforcement for legacy alias, full model ID, and valid tier [verifies TRD-023] [satisfies REQ-023] [depends: TRD-023]
  **Estimate:** 1h
  **Validates PRD ACs:** AC-023-1, AC-023-2, AC-023-3

---

## Sprint Planning

This section is for project management only. PRs above are the delivery unit; sprints below are for time-boxing.

## Sprint 1 (Days 1–3): PR 1 (Config Infrastructure Foundation)
TRD-001 through TRD-004-TEST. ~12h estimated. No breaking changes. Merge before PR 2 work begins.

## Sprint 2 (Days 4–7): PR 2 (YAML Migration + Legacy Rejection)
TRD-005 through TRD-011-TEST. ~18h estimated. Breaking change sprint — requires PR 1 merged first.

## Sprint 3 (Days 8–11): PR 3 (Wizard + Migration Command)
TRD-012 through TRD-019. ~20h estimated. Requires PR 2 merged for rejection enforcement.

## Sprint 4 (Days 12–14): PR 4 (Operational Safeguards + Discoverability)
TRD-020 through TRD-023-TEST. ~14h estimated. Can be developed in parallel with PR 3 review.

---

## Acceptance Criteria Traceability

| REQ-NNN | Description | Implementation Tasks | Test Tasks |
|---------|-------------|---------------------|-----------|
| REQ-001 | Project-level config location | TRD-002 | TRD-002-TEST |
| REQ-002 | Tier alias schema | TRD-003 | TRD-003-TEST |
| REQ-003 | Hardcoded plugin defaults | TRD-004 | TRD-004-TEST |
| REQ-004 | Config validation | TRD-010 | TRD-010-TEST |
| REQ-005 | Removal of legacy aliases | TRD-009 | TRD-009-TEST |
| REQ-006 | /map-model wizard mode | TRD-012 | TRD-012-TEST |
| REQ-007 | Wizard model ID suggestions | TRD-013 | TRD-013-TEST |
| REQ-008 | Atomic config write | TRD-014 | (covered by TRD-012-TEST) |
| REQ-009 | Wizard creates .claude dir | TRD-015 | (covered by TRD-012-TEST) |
| REQ-010 | Wizard reports final state | TRD-016 | (covered by TRD-012-TEST) |
| REQ-011 | Command YAML migration | TRD-005 | TRD-005-TEST |
| REQ-012 | Generated markdown re-sync | TRD-006 | (verified by npm run generate + grep) |
| REQ-013 | Agent schema optional model field | TRD-007 | TRD-007-TEST |
| REQ-014 | Per-agent tier assignments | TRD-008 | TRD-008-TEST |
| REQ-015 | Remove legacy defaults | TRD-004 | TRD-004-TEST |
| REQ-016 | Remove old XDG config loading | TRD-011 | TRD-011-TEST |
| REQ-017 | Migration notes in CHANGELOG | TRD-019 | (manual review) |
| REQ-018 | One-shot CLI form | TRD-017 | TRD-017-TEST |
| REQ-019 | One-shot migration command | TRD-018 | TRD-018-TEST |
| REQ-020 | Pre-flight model ID validation | TRD-020 | TRD-020-TEST |
| REQ-021 | Model ID lint script | TRD-021 | TRD-021-TEST |
| REQ-022 | Discoverability — first-run hint | TRD-022 | TRD-022-TEST |
| REQ-023 | Priority hierarchy preserved | TRD-023 | TRD-023-TEST |
| REQ-024 | KNOWN_MODEL_IDS ownership | TRD-001 | TRD-001-TEST |

---

## Design Readiness Scorecard

| Dimension | Score | Notes |
|-----------|-------|-------|
| Architecture completeness | 4.5 | All components, interfaces, and data flows defined |
| Task coverage | 4.5 | All 24 REQs covered; every implementation task has a paired test |
| Dependency clarity | 4.0 | Critical path (TRD-001→TRD-003→TRD-009→TRD-010→TRD-020) is explicit |
| Estimate confidence | 4.0 | YAML migration (TRD-005, TRD-008) estimates are mechanical; wizard estimates may vary |
| **Overall** | **4.25** | **PASS** |

---

## Adversarial Review Notes

**Architecture Issues:**
1. **Pre-flight bypass scope** (TRD-020): The bypass list (`/map-model`, `/migrate-model-config`) must be maintained manually. If new repair commands are added, they must be explicitly added to the bypass list — there's no auto-discovery. Resolution: document the bypass list as a named constant in `known-model-ids.js` or a config stanza.
2. **seen-hints.json race condition** (TRD-022): Two concurrent commands in the same new project could both emit the hint before either writes the sentinel. Resolution: treat as acceptable (hint fires at most twice in a race; silently swallow write errors per AC-022-4).

**Coverage Issues:**
1. REQ-012 (MD regeneration) has no dedicated test task — it's validated by running `npm run generate` and doing a grep check. TRD-006 is mechanical and its outcome is verified by the existing generate script. Acceptable.
2. TRD-019 (CHANGELOG) has no automated test. Manual review is the verification method per AC-017-1. Acceptable.

**Dependency Review:**
- Critical path: TRD-001 → TRD-003 → TRD-009 → TRD-010 → TRD-020 (6 levels — within acceptable depth)
- TRD-005 and TRD-008 have no upstream blockers within their PR and can run in parallel

---

## Quality Requirements

- All new JS files: Jest test coverage ≥ 90%
- Config validation errors must never cause an unhandled exception — always fall back to defaults
- Wizard must detect non-TTY environment and exit 1 with a clear message
- No new npm dependencies unless unavoidable (use Node.js built-ins: `fs`, `path`, `readline`)
