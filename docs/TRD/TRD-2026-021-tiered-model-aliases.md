# TRD-2026-021: Tiered Model Aliases & Project-Level Model Config

---
document_id: TRD-2026-021
prd_reference: PRD-2026-021
version: 1.0.0
status: Draft
date: 2026-05-27
architecture: "Option B — Full PRD, clean break (single-pass migration)"
design_readiness_score: 4.4
total_tasks: 40
---

## TRD Health Summary

| Metric | Value |
|--------|-------|
| Implementation tasks | 23 |
| Test tasks | 23 |
| Sprint 1 (Core Foundation) | 12 tasks |
| Sprint 2 (Schema + YAML Migration) | 14 tasks |
| Sprint 3 (Wizard + Migration Commands) | 10 tasks |
| Sprint 4 (CI + Docs + Cleanup) | 10 tasks |
| REQ coverage | 24/24 (100%) |
| Orphaned annotations | 0 |

---

## Architecture Decision

### Chosen Approach: Option B — Full PRD, Clean Break

A single-pass brownfield refactor that replaces all legacy model alias infrastructure in one coordinated release. No feature flags, no dual code paths.

**Key component boundaries:**

```
┌─────────────────────────────────────────────────────────────────┐
│  packages/core/lib/known-model-ids.js                          │
│  Single source of truth: exported immutable array of pinned    │
│  Claude model IDs. No dependencies.                             │
└───────────────────┬─────────────────────────────────────────────┘
                    │ imports
    ┌───────────────▼──────────────┐   ┌─────────────────────────┐
    │  config-loader.js (rewrite)  │   │  map-model-wizard.js    │
    │  - Walks dirs to find .git   │   │  - TTY detection        │
    │  - Loads .claude/ensemble-   │   │  - KNOWN_MODEL_IDS list │
    │    model-config.json         │   │  - readline prompts     │
    │  - Validates against schema  │   │  - atomic file write    │
    │  - Emits first-run hint      │   └──────────┬──────────────┘
    │  - Warns about XDG legacy    │              │
    └───────────┬──────────────────┘              │
                │ provides resolved config         │
    ┌───────────▼──────────────────┐              │
    │  model-resolver.js (rewrite) │              │
    │  - Pre-flight validation     │◄─────────────┘
    │  - Tier-alias-only env var   │
    │  - 6-level priority chain    │
    │  - Bypasses for map-model /  │
    │    migrate-model-config      │
    └──────────────────────────────┘

    ┌──────────────────────────────────────────────────────────────┐
    │  legacy-config-migrator.js (new)                            │
    │  Reads ~/.config/ensemble/model-selection.json              │
    │  Translates opus→high, sonnet→medium, haiku→low             │
    │  Writes <project>/.claude/ensemble-model-config.json        │
    └──────────────────────────────────────────────────────────────┘

    ┌──────────────────────────────────────────────────────────────┐
    │  scripts/lint-model-ids.js (new)                            │
    │  Scans all command/agent YAML files                         │
    │  Validates model IDs against KNOWN_MODEL_IDS                │
    │  Used in CI via npm run lint:model-ids                      │
    └──────────────────────────────────────────────────────────────┘
```

**Data flow for a normal command invocation:**
1. Command YAML declares `model: high` (or `medium` / `low`)
2. `config-loader.js` reads `<project_root>/.claude/ensemble-model-config.json`
3. `model-resolver.js` pre-flights all three tiers against `KNOWN_MODEL_IDS`; halts on any failure
4. `model-resolver.js` applies 6-level priority (env var → CLI flag → YAML → defaults)
5. Resolved tier (e.g., `high`) is mapped to a pinned model ID (e.g., `claude-opus-4-7`)
6. Command executes with the pinned model ID

**Data flow for `/ensemble:map-model`:**
1. `model-resolver.js` recognizes the command name and bypasses pre-flight
2. `map-model-wizard.js` reads current config (or defaults), loads `KNOWN_MODEL_IDS`
3. Wizard prompts user for each tier (TTY required; exit 1 in non-TTY unless `--non-interactive`)
4. Writes atomically to `<project_root>/.claude/ensemble-model-config.json`
5. Prints final mappings + absolute file path

### Alternatives Considered

**Option A — Additive, keep XDG fallback**: Rejected because maintaining two code paths (XDG legacy + project-level) creates confusion about which config is active. Pre-flight validation (REQ-020) cannot work correctly when config source is ambiguous.

**Option C — Phased with feature flag**: Rejected because the YAML migration (18 commands, 28 agents) is atomic — a half-migrated state where some files reference `high` and others reference `opus` would break schema validation. The feature flag would need to gate the entire YAML pass anyway, so three sprints add overhead without benefit.

### Technology Choices

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Config format | JSON (not YAML) | Same format as existing `model-selection.json`; avoids YAML parser dependency in Node.js loader |
| Wizard I/O | Node.js `readline` (built-in) | No new npm dependency; readline is available in any Node 16+ environment |
| Atomic write | `fs.writeFileSync` to `.tmp` + `fs.renameSync` | POSIX-compliant atomic replace; no dep needed |
| Seen-hints store | `~/.config/ensemble/seen-hints.json` | Outside project so it doesn't pollute `.claude/`; same XDG root as existing logs |
| Lint script | Plain JS `glob` + `js-yaml` (already used by generator) | No new dep; consistent with existing tooling |

---

## Master Task List

### Phase 1: Core Foundation
- [x] **TRD-001**: Create `packages/core/lib/known-model-ids.js` — exported immutable array of pinned Claude model IDs [satisfies REQ-024]
- [x] **TRD-001-TEST**: Test `known-model-ids.js` — frozen array, non-empty strings, no moving aliases [verifies TRD-001] [satisfies REQ-024] [depends: TRD-001]
- [x] **TRD-002**: Create `schemas/ensemble-model-config-schema.json` — JSON Schema draft-07 for config file [satisfies REQ-002]
- [x] **TRD-002-TEST**: Validate schema against conforming and non-conforming sample configs [verifies TRD-002] [satisfies REQ-002] [depends: TRD-002]
- [x] **TRD-003**: Rewrite `packages/core/lib/config-loader.js` — project-root detection, project config loading, XDG warning, first-run hint [satisfies REQ-001, REQ-003, REQ-004, REQ-015, REQ-016]
- [x] **TRD-003-TEST**: Test `config-loader.js` — root detection, load, defaults, XDG warning, legacy rejection [verifies TRD-003] [satisfies REQ-001, REQ-003, REQ-004, REQ-015, REQ-016] [depends: TRD-003]
- [x] **TRD-004**: Rewrite `packages/core/lib/model-resolver.js` — pre-flight validation, tier-alias-only env var, bypass list [satisfies REQ-020, REQ-023]
- [x] **TRD-004-TEST**: Test `model-resolver.js` — pre-flight pass/fail, env var tier/legacy/raw-ID rejection, bypass [verifies TRD-004] [satisfies REQ-020, REQ-023] [depends: TRD-004, TRD-003, TRD-001]
- [x] **TRD-005**: Add legacy alias rejection (`opus`/`sonnet`/`haiku`) in config-loader + model-resolver [satisfies REQ-005]
- [x] **TRD-005-TEST**: Test legacy alias rejection in config and env var paths [verifies TRD-005] [satisfies REQ-005] [depends: TRD-005]
- [x] **TRD-006**: Implement first-run hint + seen-hints sentinel in config-loader [satisfies REQ-022]
- [x] **TRD-006-TEST**: Test first-run hint logic — first run, repeat suppression, corrupted file, write failure [verifies TRD-006] [satisfies REQ-022] [depends: TRD-006]

### Phase 2: Schema + YAML Migration
- [x] **TRD-007**: Update `schemas/command-yaml-schema.json` model enum from `opus/sonnet/haiku` to `high/medium/low` [satisfies REQ-011, ARCH]
- [x] **TRD-007-TEST**: Validate updated command schema — new values pass, legacy values fail [verifies TRD-007] [satisfies REQ-011, ARCH] [depends: TRD-007]
- [x] **TRD-008**: Update `schemas/agent-yaml-schema.json` — add optional `model` field with enum `high/medium/low` [satisfies REQ-013]
- [x] **TRD-008-TEST**: Validate agent schema — model field optional, valid values pass, legacy values fail [verifies TRD-008] [satisfies REQ-013] [depends: TRD-008]
- [x] **TRD-009**: Migrate all 18 command YAMLs — replace `opus`→`high`, `sonnet`→`medium`, `haiku`→`low` in metadata.model [satisfies REQ-011]
- [x] **TRD-009-TEST**: Grep verify — zero legacy aliases in command YAMLs, `npm run validate` passes [verifies TRD-009] [satisfies REQ-011] [depends: TRD-009, TRD-007]
- [x] **TRD-010**: Add `model: high` to 9 high-tier agent YAMLs (orchestrators, code-reviewer, deep-debugger, agent-meta-engineer, release-agent) [satisfies REQ-014]
- [x] **TRD-011**: Add `model: medium` to 16 medium-tier agent YAMLs; remove `model: inherit` from mobile-developer [satisfies REQ-014]
- [x] **TRD-012**: Add `model: low` to 3 low-tier agent YAMLs (file-creator, context-fetcher, directory-monitor) [satisfies REQ-014]
- [x] **TRD-012-TEST**: Verify all 28 agents have valid `model` field matching assignment table; zero `model: inherit` [verifies TRD-010, TRD-011, TRD-012] [satisfies REQ-014] [depends: TRD-010, TRD-011, TRD-012, TRD-008]
- [x] **TRD-013**: Regenerate all `.md` files in `packages/*/commands/ensemble/` to sync frontmatter `model:` field [satisfies REQ-012]
- [x] **TRD-013-TEST**: Compare each `.md` frontmatter `model:` to its YAML source — must match exactly [verifies TRD-013] [satisfies REQ-012] [depends: TRD-013, TRD-009]

### Phase 3: Wizard + Migration Commands
- [x] **TRD-014**: Create `packages/core/lib/map-model-wizard.js` — TTY detection, KNOWN_MODEL_IDS suggestions, readline prompts, atomic write, .claude/ creation, final state output [satisfies REQ-006, REQ-007, REQ-008, REQ-009, REQ-010]
- [x] **TRD-014-TEST**: Test wizard logic — TTY detection, suggestion list, Enter keep, valid pick, invalid rejection, dir creation, atomic write, output format [verifies TRD-014] [satisfies REQ-006, REQ-007, REQ-008, REQ-009, REQ-010] [depends: TRD-014, TRD-001, TRD-003]
- [x] **TRD-015**: Create `packages/core/commands/map-model.yaml` + generated `.md` — wizard and one-shot CLI form [satisfies REQ-006, REQ-018, ARCH]
- [x] **TRD-016**: Create `packages/core/lib/legacy-config-migrator.js` — read XDG legacy, translate aliases, write project config, warn about commandOverrides/costTracking [satisfies REQ-019]
- [x] **TRD-016-TEST**: Test migration logic — legacy exists, both exist (overwrite prompt), nothing to migrate, legacy intact after, commandOverrides warning, costTracking notice [verifies TRD-016] [satisfies REQ-019] [depends: TRD-016, TRD-003]
- [x] **TRD-017**: Create `packages/core/commands/migrate-model-config.yaml` + generated `.md` + add to pre-flight bypass list [satisfies REQ-019, ARCH]
- [x] **TRD-018**: Add one-shot CLI form `runOneShotUpdate(tier, modelId)` to `map-model-wizard.js` [satisfies REQ-018]
- [x] **TRD-018-TEST**: Test one-shot CLI — valid tier+ID updates only that tier; invalid tier/ID errors; wizard not invoked [verifies TRD-018] [satisfies REQ-018] [depends: TRD-018, TRD-014]

### Phase 4: CI + Docs + Cleanup
- [x] **TRD-019**: Create `scripts/lint-model-ids.js` — glob YAMLs, extract model values, validate against KNOWN_MODEL_IDS, exit codes [satisfies REQ-021]
- [x] **TRD-019-TEST**: Test lint script — unknown ID exits non-zero with file listed; clean files exit 0; KNOWN_MODEL_IDS update accepted [verifies TRD-019] [satisfies REQ-021] [depends: TRD-019, TRD-001]
- [x] **TRD-020**: Add `lint:model-ids` to root `package.json` scripts; integrate into `npm run validate` [satisfies REQ-021, ARCH]
- [x] **TRD-020-TEST**: Smoke test `npm run lint:model-ids` exits 0 on clean migrated codebase [verifies TRD-020] [satisfies REQ-021] [depends: TRD-020, TRD-019, TRD-009]
- [x] **TRD-021**: Write CHANGELOG breaking-change entry describing alias rename and config path change [satisfies REQ-017]
- [x] **TRD-022**: Update plugin README — add "Model Tier Configuration" top-level section with tier model, wizard docs, upgrader instructions [satisfies REQ-022]
- [x] **TRD-023**: Update `packages/core/lib/usage-logger.js` — remove `costTracking` config dependency, hardcode log path, update MODEL_PRICING to current IDs [satisfies ARCH]
- [x] **TRD-023-TEST**: Test `usage-logger.js` — getLogPath returns hardcoded default, MODEL_PRICING uses current IDs [verifies TRD-023] [satisfies ARCH] [depends: TRD-023]

---

## Sprint Implementation Details

### Sprint 1: Core Foundation

#### TRD-001: Create `packages/core/lib/known-model-ids.js` [satisfies REQ-024]
**Estimate:** 1h  
**Validates PRD ACs:** AC-024-1, AC-024-3

Export an immutable `Object.freeze()`-wrapped array `KNOWN_MODEL_IDS` containing the current pinned Claude model IDs. Must include at minimum: `claude-opus-4-7`, `claude-sonnet-4-6`, `claude-haiku-4-5-20251001`. Every entry must be a fully-pinned ID (no moving aliases like `claude-opus-latest`).

**Implementation AC checklist:**
- [ ] Given the file is imported, when `KNOWN_MODEL_IDS` is read, then it is an Array (not modified after creation)
- [ ] Given each entry, when matched against `/^claude-[a-z0-9-]+-\d{8}$/` or known short-dated forms, then all pass (no moving aliases)
- [ ] Given the array, when imported by config-loader, model-resolver, map-model-wizard, and lint-script, then all four receive identical reference

---

#### TRD-001-TEST: Test `known-model-ids.js` [verifies TRD-001] [satisfies REQ-024] [depends: TRD-001]
**Estimate:** 1h  
**Validates PRD ACs:** AC-024-1, AC-024-3

Write Jest unit tests: assert array is frozen, assert all entries are non-empty strings, assert no entry equals a generic moving alias pattern (`*-latest`), assert count ≥ 3.

---

#### TRD-002: Create `schemas/ensemble-model-config-schema.json` [satisfies REQ-002]
**Estimate:** 2h  
**Validates PRD ACs:** AC-002-1, AC-002-2, AC-002-3, AC-002-4, AC-002-5

Write a JSON Schema (draft-07) for `.claude/ensemble-model-config.json`. Required fields: `version` (integer, const 1), `tiers` (object with required keys `high`, `medium`, `low`, each non-empty string). Optional field: `extraKnownModelIds` (array of strings, default `[]`). Additional properties at root level: warn (use `additionalProperties: true` but document convention). Include `$schema`, `$id`, and descriptive `title`/`description`.

**Implementation AC checklist:**
- [ ] Given a conforming config (version 1, all three tiers, empty extraKnownModelIds), when validated with Ajv, then validation passes
- [ ] Given a config missing `tiers.low`, when validated, then error path is `tiers.low` with keyword `required`
- [ ] Given a config with `version: 999`, when validated against const constraint, then validation fails
- [ ] Given a config with extra root key `commandOverrides`, when validated with additionalProperties handling, then schema does not block it (warning only, not schema enforcement)
- [ ] Given `extraKnownModelIds: ["claude-opus-5-preview"]`, when validated, then schema passes (array of strings)

---

#### TRD-002-TEST: Test schema against sample configs [verifies TRD-002] [satisfies REQ-002] [depends: TRD-002]
**Estimate:** 1h  
**Validates PRD ACs:** AC-002-1, AC-002-2, AC-002-3

Write Jest tests using Ajv to validate: valid config (passes), config missing tier (fails with specific path), config with wrong version (fails), config with extra key (passes with additionalProperties), config with extraKnownModelIds (passes).

---

#### TRD-003: Rewrite `packages/core/lib/config-loader.js` [satisfies REQ-001, REQ-003, REQ-004, REQ-015, REQ-016]
**Estimate:** 5h  
**Validates PRD ACs:** AC-001-1, AC-001-2, AC-001-3, AC-001-4, AC-003-1, AC-003-2, AC-004-1, AC-004-2, AC-015-1, AC-016-1, AC-016-2, AC-016-3

Rewrite the module with these exported functions:
- `findProjectRoot(startDir?)`: walk up from `startDir` (default `process.cwd()`) looking for `.git`; return first directory containing `.git`; if not found, return `startDir`.
- `getProjectConfigPath()`: returns `path.join(findProjectRoot(), '.claude', 'ensemble-model-config.json')`
- `getDefaultConfig()`: returns the new tier-based default object with `version: 1`, `tiers: { high: "claude-opus-4-7", medium: "claude-sonnet-4-6", low: "claude-haiku-4-5-20251001" }`, `extraKnownModelIds: []`
- `validateConfig(config)`: validates against `ensemble-model-config-schema.json` using Ajv; detects unknown version; checks for legacy alias keys; returns `{ valid: boolean, errors: string[] }`
- `checkLegacyXdgFile()`: checks for `~/.config/ensemble/model-selection.json` or `~/.ensemble/model-selection.json`; if found, checks `~/.config/ensemble/seen-warnings.json` for warning already emitted; if not seen, emits loud stderr warning and records it
- `loadConfig()`: reads project config path; validates; on failure falls back to defaults + emits stderr warning; calls `checkLegacyXdgFile()`; returns config object

**Implementation AC checklist:**
- [ ] Given `.claude/ensemble-model-config.json` at git root, when `loadConfig()` is called from a subdirectory, then config is read from root
- [ ] Given no project config, when `loadConfig()` is called, then `getDefaultConfig()` is returned and no error is raised
- [ ] Given directory not in a git repo, when `findProjectRoot()` is called, then it returns `process.cwd()`
- [ ] Given a monorepo with one `.claude/ensemble-model-config.json` at root, when called from any sub-package, then root config is used
- [ ] Given `getDefaultConfig()`, when called, then returned object has `modelAliases` keys exactly `["high","medium","low"]` (for backward compat, `modelAliases` is an alias for `tiers`)
- [ ] Given config with invalid JSON, when `loadConfig()` is called, then defaults returned + stderr warning names file path
- [ ] Given model ID matching `^claude-[a-z0-9-]+$`, when `validateConfig()` runs, then it is accepted
- [ ] Given XDG legacy file exists and warning not yet emitted, when `loadConfig()` runs, then stderr warning names file and recommends `/ensemble:migrate-model-config`
- [ ] Given warning emitted once (sentinel written), when `loadConfig()` runs again, then warning not repeated

---

#### TRD-003-TEST: Test `config-loader.js` [verifies TRD-003] [satisfies REQ-001, REQ-003, REQ-004, REQ-015, REQ-016] [depends: TRD-003]
**Estimate:** 4h  
**Validates PRD ACs:** AC-001-1 through AC-001-4, AC-003-1, AC-003-2, AC-004-1, AC-004-2, AC-015-1, AC-016-1 through AC-016-3

Jest unit tests using `mock-fs` or `tmp` for filesystem isolation. Cover: project root detection (git found, git not found, monorepo), config load (valid, invalid JSON, missing file), default config shape, XDG legacy warning (first-time, subsequent-suppressed), validateConfig edge cases (missing tier, unknown version, extra keys).

---

#### TRD-004: Rewrite `packages/core/lib/model-resolver.js` with pre-flight validation [satisfies REQ-020, REQ-023]
**Estimate:** 4h  
**Validates PRD ACs:** AC-020-1 through AC-020-7, AC-023-1 through AC-023-4

Rewrite `selectModel()` to:
1. Accept `commandName` to check bypass list (`map-model`, `migrate-model-config`)
2. Run pre-flight: validate all three tiers of resolved config against `KNOWN_MODEL_IDS ∪ extraKnownModelIds`; on failure print structured error block to stderr and `process.exit(1)` (or throw `PreflightError` for testability)
3. Validate `ENSEMBLE_MODEL_OVERRIDE` env var: must be `high`|`medium`|`low`; reject legacy aliases and raw model IDs with specific messages
4. Apply 6-level priority chain using only tier aliases; resolve tier → model ID via `config.tiers[tier]`
5. Export `preflightValidate(config)` as standalone function for reuse by agent loader

**Implementation AC checklist:**
- [ ] Given `ENSEMBLE_MODEL_OVERRIDE=high`, when `selectModel()` runs, then resolved model is `config.tiers.high`
- [ ] Given `ENSEMBLE_MODEL_OVERRIDE=opus`, when `selectModel()` runs, then `PreflightError` thrown with message containing "no longer supported"
- [ ] Given `ENSEMBLE_MODEL_OVERRIDE=claude-opus-4-7` (raw ID), when `selectModel()` runs, then error says "must be a tier alias"
- [ ] Given config maps `high` to model not in KNOWN_MODEL_IDS, when `preflightValidate()` runs, then error names tier, value, and file path
- [ ] Given config missing `low` tier, when `preflightValidate()` runs, then error names missing tier
- [ ] Given command name is `map-model`, when `selectModel()` called, then pre-flight is skipped
- [ ] Given `extraKnownModelIds: ["claude-opus-5-preview"]` and tier mapping pointing to it, when pre-flight runs, then validation passes
- [ ] Given plugin defaults map to an ID not in KNOWN_MODEL_IDS (regression), when pre-flight runs, then error references "plugin defaults"

---

#### TRD-004-TEST: Test `model-resolver.js` [verifies TRD-004] [satisfies REQ-020, REQ-023] [depends: TRD-004, TRD-003, TRD-001]
**Estimate:** 3h  
**Validates PRD ACs:** AC-020-1 through AC-020-7, AC-023-1 through AC-023-4

Jest tests for each AC. Mock `KNOWN_MODEL_IDS` to a known set. Test: pre-flight pass, pre-flight fail (invalid ID, missing tier, unreadable config), env var tier bypass (valid, legacy, raw ID), command bypass list (map-model, migrate-model-config), extraKnownModelIds extension.

---

#### TRD-005: Implement legacy alias rejection in config-loader + model-resolver [satisfies REQ-005]
**Estimate:** 2h  
**Validates PRD ACs:** AC-005-1, AC-005-2

In `config-loader.js` `validateConfig()`: detect keys `opus`, `sonnet`, `haiku` in `config.tiers`; return specific error `"legacy alias 'opus' no longer supported — rename to 'high'"`. In command schema validation (generator integration): detect `metadata.model: opus|sonnet|haiku`; fail with migration message. Add `LEGACY_ALIASES = ['opus', 'sonnet', 'haiku']` constant to `known-model-ids.js` for shared reference.

**Implementation AC checklist:**
- [ ] Given config tiers contain key `opus`, when `validateConfig()` runs, then error message contains "legacy alias 'opus' no longer supported"
- [ ] Given each of the three legacy keys, when rejected, then error names the specific key and its tier replacement
- [ ] Given command YAML with `metadata.model: opus`, when npm run validate runs, then schema validation fails with migration message

---

#### TRD-005-TEST: Test legacy alias rejection [verifies TRD-005] [satisfies REQ-005] [depends: TRD-005]
**Estimate:** 1h  
**Validates PRD ACs:** AC-005-1, AC-005-2

Jest tests: config with `tiers.opus` → rejected with correct message; config with `tiers.sonnet` → rejected; config with correct `tiers.high` → passes; command YAML schema validation test (mock schema validator).

---

#### TRD-006: Implement first-run hint + seen-hints sentinel [satisfies REQ-022]
**Estimate:** 2h  
**Validates PRD ACs:** AC-022-1, AC-022-2, AC-022-4

Add to `config-loader.js` `loadConfig()`:
- After loading (or falling back to defaults), check if project config is missing
- If missing: read `~/.config/ensemble/seen-hints.json`; if current `projectRoot` not in the map, emit to stderr: `Tip: run /ensemble:map-model to pin Claude model tiers for this project (.claude/ensemble-model-config.json).`; best-effort write project root to seen-hints map (swallow errors)
- If seen-hints read fails: emit hint anyway (treat as unseen)

**Implementation AC checklist:**
- [ ] Given project with no config and no seen-hints entry, when `loadConfig()` runs, then hint emitted to stderr
- [ ] Given hint shown once (projectRoot in seen-hints), when `loadConfig()` runs again, then hint not emitted
- [ ] Given seen-hints file unreadable, when `loadConfig()` runs, then hint emitted anyway (no crash)
- [ ] Given seen-hints write fails, when `loadConfig()` runs, then command still executes (error swallowed)

---

#### TRD-006-TEST: Test first-run hint logic [verifies TRD-006] [satisfies REQ-022] [depends: TRD-006]
**Estimate:** 1h  
**Validates PRD ACs:** AC-022-1, AC-022-2, AC-022-4

Jest tests mocking filesystem: first run (no seen-hints) → hint emitted; second run (seen-hints has project) → no hint; corrupted seen-hints → hint emitted, no crash; seen-hints write failure → command continues.

---

### Sprint 2: Schema Updates + YAML Migration

#### TRD-007: Update `schemas/command-yaml-schema.json` model enum [satisfies REQ-011, ARCH]
**Estimate:** 1h  
**Validates PRD ACs:** AC-011-2

Change `metadata.model` enum from `["opus","sonnet","haiku"]` to `["high","medium","low"]`. This makes old YAML files fail schema validation (intentional — migration check).

**Implementation AC checklist:**
- [ ] Given command YAML with `model: high`, when schema validated, then it passes
- [ ] Given command YAML with `model: opus`, when schema validated, then it fails (legacy alias rejection via schema)
- [ ] Given command YAML with no `model` field, when schema validated, then it passes (field remains optional)

---

#### TRD-007-TEST: Validate updated command schema [verifies TRD-007] [satisfies REQ-011, ARCH] [depends: TRD-007]
**Estimate:** 1h  
**Validates PRD ACs:** AC-011-2, AC-005-2

Jest tests: `model: high` passes; `model: opus` fails; `model: medium` passes; missing `model` passes; `model: unknown` fails.

---

#### TRD-008: Update `schemas/agent-yaml-schema.json` — add optional `model` field [satisfies REQ-013]
**Estimate:** 1h  
**Validates PRD ACs:** AC-013-1, AC-013-2

Add to `metadata.properties`:
```json
"model": {
  "type": "string",
  "enum": ["high", "medium", "low"],
  "description": "Preferred compute tier for this agent"
}
```
Field is NOT in `required` array (remains optional).

**Implementation AC checklist:**
- [ ] Given agent YAML with `model: high` in metadata, when schema validated, then passes
- [ ] Given agent YAML with no `model` field, when schema validated, then passes
- [ ] Given agent YAML with `model: opus`, when schema validated, then fails

---

#### TRD-008-TEST: Validate agent schema [verifies TRD-008] [satisfies REQ-013] [depends: TRD-008]
**Estimate:** 1h  
**Validates PRD ACs:** AC-013-1, AC-013-2

Jest tests: agent metadata with `model: high` passes; agent metadata without model passes; agent metadata with `model: opus` fails; agent metadata with `model: invalid` fails.

---

#### TRD-009: Migrate all 18 command YAMLs to tier aliases [satisfies REQ-011]
**Estimate:** 3h  
**Validates PRD ACs:** AC-011-1, AC-011-2

**Files to edit** (18 YAMLs with existing `model:` in metadata, plus fix inline model references in fix-issue.yaml):

| File | Current | New |
|------|---------|-----|
| `packages/core/commands/discover-standards.yaml` | `sonnet` | `medium` |
| `packages/core/commands/inject-standards.yaml` | `sonnet` | `medium` |
| `packages/development/commands/analyze-requirements.yaml` | `sonnet` | `medium` |
| `packages/development/commands/beads-plan.yaml` | `sonnet` | `medium` |
| `packages/development/commands/beads-build.yaml` | `sonnet` | `medium` |
| `packages/development/commands/configure-team.yaml` | `opus` | `high` |
| `packages/development/commands/create-trd.yaml` | `opus` | `high` |
| `packages/development/commands/create-trd-foreman.yaml` | `opus` | `high` |
| `packages/development/commands/fix-issue.yaml` | `sonnet`/`haiku` | `medium`/`low` |
| `packages/development/commands/implement-bead.yaml` | `sonnet` | `medium` |
| `packages/development/commands/implement-trd.yaml` | `sonnet` | `medium` |
| `packages/development/commands/implement-trd-beads.yaml` | `sonnet` | `medium` |
| `packages/development/commands/refine-trd.yaml` | `opus` | `high` |
| `packages/development/commands/requirement-status.yaml` | `sonnet` | `medium` |
| `packages/development/commands/validate-requirements.yaml` | `sonnet` | `medium` |
| `packages/product/commands/create-prd.yaml` | `opus` | `high` |
| `packages/product/commands/feature.yaml` | `opus` | `high` |
| `packages/product/commands/refine-prd.yaml` | `opus` | `high` |

**Note on `fix-issue.yaml`:** Contains 6 inline `model:` references (metadata + step-level delegation). Map: `opus`→`high`, `sonnet`→`medium`, `haiku`→`low`.

**Implementation AC checklist:**
- [ ] Given all 18 YAMLs edited, when grep runs for `model: opus|sonnet|haiku` in metadata, then zero matches
- [ ] Given each YAML, when `npm run validate` runs, then schema validation passes with new enum

---

#### TRD-009-TEST: Grep verification of command YAML migration [verifies TRD-009] [satisfies REQ-011] [depends: TRD-009, TRD-007]
**Estimate:** 1h  
**Validates PRD ACs:** AC-011-1, AC-011-2

Bash-based test (or Jest shell test): `grep -r "model: opus\|model: sonnet\|model: haiku" packages/*/commands/*.yaml` must return empty. `grep -r "model: high\|model: medium\|model: low" packages/*/commands/*.yaml` must return ≥18 matches. Run `npm run validate` — must exit 0.

---

#### TRD-010: Add `model: high` to 9 high-tier agent YAMLs [satisfies REQ-014]
**Estimate:** 2h  
**Validates PRD ACs:** AC-014-1, AC-014-3

Add `model: high` to `metadata` block of these agents:
- `packages/core/agents/ensemble-orchestrator.yaml`
- `packages/development/agents/tech-lead-orchestrator.yaml`
- `packages/product/agents/product-management-orchestrator.yaml`
- `packages/quality/agents/qa-orchestrator.yaml`
- `packages/infrastructure/agents/infrastructure-orchestrator.yaml`
- `packages/quality/agents/code-reviewer.yaml`
- `packages/quality/agents/deep-debugger.yaml`
- `packages/core/agents/agent-meta-engineer.yaml`
- `packages/git/agents/release-agent.yaml`

**Implementation AC checklist:**
- [ ] Given each of the 9 agents, when grep runs for `model: high`, then all 9 appear
- [ ] Given each agent file, when `npm run validate` runs, then schema passes

---

#### TRD-011: Add `model: medium` to 16 medium-tier agent YAMLs [satisfies REQ-014]
**Estimate:** 2h  
**Validates PRD ACs:** AC-014-2, AC-014-3

Add `model: medium` to `metadata` block of these agents. Also remove `model: inherit` from `mobile-developer.yaml` and replace with `model: medium`:
- `packages/development/agents/backend-developer.yaml`
- `packages/development/agents/frontend-developer.yaml`
- `packages/development/agents/mobile-developer.yaml` ← remove `model: inherit`, add `model: medium`
- `packages/infrastructure/agents/infrastructure-developer.yaml`
- `packages/development/agents/documentation-specialist.yaml`
- `packages/development/agents/api-documentation-specialist.yaml`
- `packages/infrastructure/agents/postgresql-specialist.yaml`
- `packages/infrastructure/agents/helm-chart-specialist.yaml`
- `packages/infrastructure/agents/build-orchestrator.yaml`
- `packages/infrastructure/agents/deployment-orchestrator.yaml`
- `packages/e2e-testing/agents/playwright-tester.yaml`
- `packages/quality/agents/test-runner.yaml`
- `packages/git/agents/github-specialist.yaml`
- `packages/git/agents/git-workflow.yaml`
- `packages/metrics/agents/manager-dashboard-agent.yaml`
- `packages/core/agents/general-purpose.yaml`

**Implementation AC checklist:**
- [ ] Given `mobile-developer.yaml`, when grep runs for `model: inherit`, then zero matches
- [ ] Given all 16 agents, when grep runs for `model: medium`, then all 16 appear

---

#### TRD-012: Add `model: low` to 3 low-tier agent YAMLs [satisfies REQ-014]
**Estimate:** 1h  
**Validates PRD ACs:** AC-014-3

Add `model: low` to `metadata` block of:
- `packages/core/agents/file-creator.yaml`
- `packages/core/agents/context-fetcher.yaml`
- `packages/core/agents/directory-monitor.yaml`

**Implementation AC checklist:**
- [ ] Given all 3 agents, when grep runs for `model: low`, then all 3 appear
- [ ] Given all 28 agent files, when iterated, then every one has exactly one `model:` field set to `high`, `medium`, or `low`

---

#### TRD-012-TEST: Verify all 28 agents have valid `model` field [verifies TRD-010, TRD-011, TRD-012] [satisfies REQ-014] [depends: TRD-010, TRD-011, TRD-012, TRD-008]
**Estimate:** 1h  
**Validates PRD ACs:** AC-014-1, AC-014-2, AC-014-3

Bash + Jest: count agents with `model: high` (expect 9), `model: medium` (expect 16), `model: low` (expect 3). Total must equal 28. `grep -r "model: inherit"` must return empty. `npm run validate` must pass all agent files.

---

#### TRD-013: Regenerate all `.md` files in `packages/*/commands/ensemble/` [satisfies REQ-012]
**Estimate:** 3h  
**Validates PRD ACs:** AC-012-1

Run `npm run generate` (after ensuring node_modules are available) to regenerate all command markdown files. If the private package issue (`@fortium/ensemble-development`) prevents `npm install`, manually update each `.md` frontmatter `model:` field to match the corresponding YAML source.

**Note:** The `npm install` issue (private package `@fortium/ensemble-development@^4.0.0` not on registry) may require manual `.md` updates. In that case, use a targeted script: `grep -l "model:" packages/*/commands/ensemble/*.md` and edit each file's frontmatter to match the YAML.

**Implementation AC checklist:**
- [ ] Given each `.md` file in `packages/*/commands/ensemble/`, when its `model:` frontmatter field is compared to its YAML source, then they match
- [ ] Given a YAML with `model: high`, when `.md` is read, then frontmatter shows `model: high`

---

#### TRD-013-TEST: Compare `.md` frontmatter to YAML source [verifies TRD-013] [satisfies REQ-012] [depends: TRD-013, TRD-009]
**Estimate:** 1h  
**Validates PRD ACs:** AC-012-1

Script that for each YAML file with `metadata.model`: reads YAML model value, reads corresponding `.md` frontmatter model value, asserts they match. Fails if any pair diverges.

---

### Sprint 3: Wizard + Migration Commands

#### TRD-014: Create `packages/core/lib/map-model-wizard.js` [satisfies REQ-006, REQ-007, REQ-008, REQ-009, REQ-010]
**Estimate:** 5h  
**Validates PRD ACs:** AC-006-1 through AC-006-3, AC-007-1 through AC-007-3, AC-008-1, AC-008-2, AC-009-1, AC-010-1

Implement the interactive wizard using Node.js `readline`. Exported function: `runWizard(options = {})`.

Steps:
1. Detect TTY (`process.stdin.isTTY`); if not TTY and no `--non-interactive` flag, print error and exit 1
2. Resolve project root and config path
3. Load current config (or defaults)
4. Build suggestion list: `KNOWN_MODEL_IDS + config.extraKnownModelIds`
5. For each tier (`high`, `medium`, `low`): print numbered list of suggestions; show current value; prompt user; accept: number from list, or Enter (keep current); reject typed IDs not in list with AC-007-2 message; retry prompt
6. Stage all three new values
7. Ensure `.claude/` directory exists (create if missing, AC-009-1)
8. Write to `.tmp` file then `fs.renameSync` to final path (atomic write, AC-008)
9. Print final state: three tier mappings + absolute path (AC-010-1)

**Implementation AC checklist:**
- [ ] Given existing config, when wizard starts, then each tier shows `high: <current_id>` before prompting
- [ ] Given user presses Enter, when wizard advances, then tier unchanged in staged state
- [ ] Given user types valid ID from list, when wizard advances, then ID staged for write
- [ ] Given user types ID not in KNOWN_MODEL_IDS or extraKnownModelIds, when wizard validates, then rejection message matches AC-007-2 verbatim
- [ ] Given user picks number from list, when wizard advances, then corresponding ID staged
- [ ] Given wizard completes, when file inspected, then valid JSON with all three tiers
- [ ] Given process killed mid-write (simulated), when file inspected, then either old or fully new content (no partial)
- [ ] Given `.claude/` does not exist, when wizard saves, then directory created and file written
- [ ] Given wizard saves successfully, when output read, then absolute file path and three final mappings printed
- [ ] Given non-TTY environment, when wizard invoked without `--non-interactive`, then exit 1 with descriptive message

---

#### TRD-014-TEST: Test wizard logic [verifies TRD-014] [satisfies REQ-006, REQ-007, REQ-008, REQ-009, REQ-010] [depends: TRD-014, TRD-001, TRD-003]
**Estimate:** 4h  
**Validates PRD ACs:** AC-006-1 through AC-006-3, AC-007-1 through AC-007-3, AC-008-1, AC-009-1, AC-010-1

Jest tests mocking `readline` and `fs`. Test: TTY detection (TTY allowed, non-TTY rejected), suggestion list composition (KNOWN_MODEL_IDS + extraKnownModelIds), Enter keeps current, valid pick stages ID, invalid ID rejected + retry, directory creation, atomic write (tmp → rename), final output format.

---

#### TRD-015: Create `packages/core/commands/map-model.yaml` [satisfies REQ-006, REQ-018, ARCH]
**Estimate:** 2h  
**Validates PRD ACs:** AC-006-1, AC-018-1

Write the command YAML for `/ensemble:map-model`. Include:
- `metadata.name: ensemble:map-model`
- `metadata.model: medium` (meta-irony: wizard uses medium tier)
- Workflow describing: preflight bypass, wizard launch, one-shot CLI form (`/ensemble:map-model <tier> <model-id>`)
- Generate the corresponding `.md` file in `packages/core/commands/ensemble/`

**Implementation AC checklist:**
- [ ] Given YAML file, when `npm run validate` runs, then schema passes
- [ ] Given no arguments, when command description read, then it describes interactive wizard mode
- [ ] Given positional args form `<tier> <model-id>`, when description read, then one-shot behavior documented

---

#### TRD-016: Create `packages/core/lib/legacy-config-migrator.js` [satisfies REQ-019]
**Estimate:** 3h  
**Validates PRD ACs:** AC-019-1 through AC-019-6

Implement `migrateLegacyConfig(options = {})`:
1. Check for legacy file at `~/.config/ensemble/model-selection.json` or `~/.ensemble/model-selection.json`
2. If not found: print "Nothing to migrate. Run /ensemble:map-model to create a new config." and return
3. Parse legacy file; extract `modelAliases`: map `opus`→`high`, `sonnet`→`medium`, `haiku`→`low`
4. Detect `commandOverrides` in legacy: if present, print stderr warning listing affected commands per AC-019-5
5. Detect `costTracking.logPath` in legacy: if custom, print stderr notice per AC-019-6
6. Resolve project config path via `config-loader.findProjectRoot()`
7. If project config already exists: prompt user (via readline) before overwriting; allow preserve-existing
8. Write new format atomically; do NOT delete legacy file
9. Print success with file path

**Implementation AC checklist:**
- [ ] Given legacy file exists and no project config, when migrator runs, then project config written with `high`/`medium`/`low` keys
- [ ] Given both legacy and project config exist, when migrator runs, then user prompted before overwrite
- [ ] Given no legacy file, when migrator runs, then message reports nothing to migrate
- [ ] Given migration succeeds, when legacy file checked, then it is untouched (not deleted)
- [ ] Given legacy has `commandOverrides`, when migration runs, then stderr lists affected commands per AC-019-5 verbatim
- [ ] Given legacy has custom `costTracking.logPath`, when migration runs, then stderr notice per AC-019-6 verbatim

---

#### TRD-016-TEST: Test migration logic [verifies TRD-016] [satisfies REQ-019] [depends: TRD-016, TRD-003]
**Estimate:** 2h  
**Validates PRD ACs:** AC-019-1 through AC-019-6

Jest tests with mocked filesystem: legacy exists → project config written; both exist → overwrite prompt shown; nothing to migrate → message shown; legacy intact after migration; commandOverrides warning; costTracking notice.

---

#### TRD-017: Create `packages/core/commands/migrate-model-config.yaml` [satisfies REQ-019, ARCH]
**Estimate:** 2h  
**Validates PRD ACs:** AC-019-1

Write command YAML for `/ensemble:migrate-model-config`. Include:
- `metadata.name: ensemble:migrate-model-config`
- `metadata.model: medium`
- Workflow: preflight bypass → detect legacy file → translate aliases → write project config → report
- Generate corresponding `.md` file

**Implementation AC checklist:**
- [ ] Given YAML, when `npm run validate` runs, then schema passes
- [ ] Given command name `migrate-model-config`, when pre-flight bypass list checked in model-resolver, then it is in the bypass list

---

#### TRD-018: Add one-shot CLI form to `map-model-wizard.js` [satisfies REQ-018]
**Estimate:** 2h  
**Validates PRD ACs:** AC-018-1

Add to `runWizard()` (or as separate exported `runOneShotUpdate(tier, modelId)`): detect when called with two positional args; validate tier is one of `high`|`medium`|`low`; validate modelId is in `KNOWN_MODEL_IDS ∪ extraKnownModelIds`; update only that tier atomically; print updated mapping; do not enter interactive mode.

**Implementation AC checklist:**
- [ ] Given `/ensemble:map-model medium claude-sonnet-4-6`, when executed, then only `medium` tier updated, wizard loop not shown
- [ ] Given one-shot with unknown tier arg, when validated, then error names valid tiers
- [ ] Given one-shot with model ID not in allow-list, when validated, then AC-007-2 message shown

---

#### TRD-018-TEST: Test one-shot CLI form [verifies TRD-018] [satisfies REQ-018] [depends: TRD-018, TRD-014]
**Estimate:** 1h  
**Validates PRD ACs:** AC-018-1

Jest tests: valid tier + valid ID → only that tier updated; invalid tier → error; invalid ID → AC-007-2 message; wizard readline not invoked in one-shot path.

---

### Sprint 4: CI Lint Script + Docs + Cleanup

#### TRD-019: Create `scripts/lint-model-ids.js` [satisfies REQ-021]
**Estimate:** 3h  
**Validates PRD ACs:** AC-021-1, AC-021-2, AC-021-3

Implement lint script:
1. Import `KNOWN_MODEL_IDS` from `packages/core/lib/known-model-ids.js`
2. Glob all `packages/*/commands/*.yaml` and `packages/*/agents/*.yaml`
3. Parse each YAML file; extract any `model:` field values at metadata or step level
4. For fields that look like full model IDs (contain more than 2 hyphens): check against `KNOWN_MODEL_IDS`
5. For fields that are tier aliases (`high`/`medium`/`low`): resolve via bundled defaults; check resolved ID against `KNOWN_MODEL_IDS`
6. Collect violations; exit non-zero with list of offending files + values if any found; exit 0 with one-line success if clean

**Implementation AC checklist:**
- [ ] Given YAML references model ID not in KNOWN_MODEL_IDS, when script runs, then exit non-zero + offending file listed
- [ ] Given all files reference known IDs, when script runs, then exit 0 + single-line success
- [ ] Given KNOWN_MODEL_IDS updated with new ID, when script runs, then new ID accepted without other changes

---

#### TRD-019-TEST: Test lint script [verifies TRD-019] [satisfies REQ-021] [depends: TRD-019, TRD-001]
**Estimate:** 2h  
**Validates PRD ACs:** AC-021-1, AC-021-2, AC-021-3

Jest tests with fixture YAML files: clean file → exit 0; file with unknown model ID → exit 1 + file named; file with tier alias resolving to known ID → exit 0; KNOWN_MODEL_IDS updated → new ID accepted.

---

#### TRD-020: Add `lint:model-ids` script to root `package.json` [satisfies REQ-021, ARCH]
**Estimate:** 1h  
**Validates PRD ACs:** AC-021-1

Add to `scripts` section of root `package.json`:
```json
"lint:model-ids": "node scripts/lint-model-ids.js"
```
Also add `"prevalidate": "npm run lint:model-ids"` or include in existing `validate` script so CI catches it.

**Implementation AC checklist:**
- [ ] Given `npm run lint:model-ids` run from repo root, when executed, then script runs without module-not-found errors
- [ ] Given `npm run validate`, when executed, then lint:model-ids runs as part of the validation suite

---

#### TRD-020-TEST: Smoke test `npm run lint:model-ids` [verifies TRD-020] [satisfies REQ-021] [depends: TRD-020, TRD-019, TRD-009]
**Estimate:** 30min  
**Validates PRD ACs:** AC-021-2

Run `npm run lint:model-ids` in CI; assert exit 0 after YAML migration is complete. This is an integration test — the lint script runs against the real migrated YAML files.

---

#### TRD-021: Write CHANGELOG breaking-change entry [satisfies REQ-017]
**Estimate:** 1h  
**Validates PRD ACs:** AC-017-1

Add a `## Breaking Changes` section to `packages/core/CHANGELOG.md` (and `packages/ensemble-full/CHANGELOG.md` if it exists) describing:
- `opus`/`sonnet`/`haiku` aliases replaced by `high`/`medium`/`low`
- Config path moved from `~/.config/ensemble/model-selection.json` to `<project>/.claude/ensemble-model-config.json`
- Migration path: run `/ensemble:migrate-model-config` to translate, then `/ensemble:map-model` to verify

**Implementation AC checklist:**
- [ ] Given CHANGELOG read, when searching for "Breaking Changes" section, then it exists and describes alias rename
- [ ] Given CHANGELOG, when read by a new user, then `/ensemble:map-model` is named as the resolution path

---

#### TRD-022: Update plugin README with tier model documentation [satisfies REQ-022]
**Estimate:** 2h  
**Validates PRD ACs:** AC-022-3

Update `packages/core/README.md` (or root `README.md` if that is the user-facing entry point) with a top-level section "Model Tier Configuration" that:
- Explains `high`/`medium`/`low` tiers and their defaults
- Shows example `ensemble-model-config.json`
- Documents `/ensemble:map-model` wizard command
- Documents `/ensemble:migrate-model-config` for upgraders

**Implementation AC checklist:**
- [ ] Given plugin README, when read by new user, then "Model Tier Configuration" section visible without scrolling past first major section
- [ ] Given README, when `/ensemble:map-model` searched, then command is documented with usage examples

---

#### TRD-023: Update `packages/core/lib/usage-logger.js` — remove `costTracking` dependency [satisfies ARCH]
**Estimate:** 2h  
**Validates PRD ACs:** (non-goal cleanup, no direct PRD AC)

`usage-logger.js` currently reads `config.costTracking.logPath`. Per PRD non-goals, `costTracking` is not carried into the new schema. Rewrite `getLogPath()` to hardcode the default path `~/.config/ensemble/logs/model-usage.jsonl` directly (tilde-expanded via `os.homedir()`). Remove any reference to `config.costTracking`. Update `MODEL_PRICING` map to current model IDs (`claude-opus-4-7`, `claude-sonnet-4-6`, `claude-haiku-4-5-20251001`).

**Implementation AC checklist:**
- [ ] Given `usage-logger.js`, when `getLogPath()` called without config arg, then returns `~/.config/ensemble/logs/model-usage.jsonl` (tilde expanded)
- [ ] Given updated MODEL_PRICING, when keys listed, then no retired model IDs appear

---

#### TRD-023-TEST: Test `usage-logger.js` [verifies TRD-023] [satisfies ARCH] [depends: TRD-023]
**Estimate:** 1h  
**Validates PRD ACs:** (coverage of cleanup)

Jest tests: `getLogPath()` returns expected default path; `MODEL_PRICING` keys match current IDs in `KNOWN_MODEL_IDS`; logger does not import from config-loader's `costTracking` block.

---

## Sprint Planning

### Sprint 1: Core Foundation
**Goal:** Runtime infrastructure ready — config loads from project path, pre-flight validates, first-run hint works.  
**Branch:** `feature/tiered-model-aliases-phase-1`  
**Estimated hours:** 29h

| Task | Estimate | Dependencies |
|------|----------|--------------|
| TRD-001 | 1h | — |
| TRD-001-TEST | 1h | TRD-001 |
| TRD-002 | 2h | TRD-001 |
| TRD-002-TEST | 1h | TRD-002 |
| TRD-003 | 5h | TRD-001, TRD-002 |
| TRD-003-TEST | 4h | TRD-003 |
| TRD-004 | 4h | TRD-001, TRD-003 |
| TRD-004-TEST | 3h | TRD-004 |
| TRD-005 | 2h | TRD-003, TRD-004 |
| TRD-005-TEST | 1h | TRD-005 |
| TRD-006 | 2h | TRD-003 |
| TRD-006-TEST | 1h | TRD-006 |
| **Total** | **27h** | |

**Sprint 1 Exit Criteria:**
- `packages/core/lib/known-model-ids.js` passes all tests
- `schemas/ensemble-model-config-schema.json` validates sample configs correctly
- `config-loader.js` loads from project path; falls back to defaults; emits legacy warning; first-run hint fires once
- `model-resolver.js` pre-flight blocks invalid IDs; bypasses for map-model; rejects legacy env var aliases
- All Sprint 1 tests passing

---

### Sprint 2: Schema + YAML Migration
**Goal:** All 18 commands and 28 agents migrated to tier aliases; schema enforces new enum; markdown re-synced.  
**Branch:** `feature/tiered-model-aliases-phase-2`  
**Estimated hours:** 17h

| Task | Estimate | Dependencies |
|------|----------|--------------|
| TRD-007 | 1h | TRD-005 |
| TRD-007-TEST | 1h | TRD-007 |
| TRD-008 | 1h | — |
| TRD-008-TEST | 1h | TRD-008 |
| TRD-009 | 3h | TRD-007 |
| TRD-009-TEST | 1h | TRD-009 |
| TRD-010 | 2h | TRD-008 |
| TRD-011 | 2h | TRD-008 |
| TRD-012 | 1h | TRD-008 |
| TRD-012-TEST | 1h | TRD-010, TRD-011, TRD-012 |
| TRD-013 | 3h | TRD-009 |
| TRD-013-TEST | 1h | TRD-013 |
| **Total** | **18h** | |

**Sprint 2 Exit Criteria:**
- Zero `opus`/`sonnet`/`haiku` aliases in any command or agent YAML
- All 28 agents have explicit `model: high|medium|low`
- `mobile-developer.yaml` has no `model: inherit`
- All `.md` frontmatter matches YAML source
- `npm run validate` passes clean

---

### Sprint 3: Wizard + Migration Commands
**Goal:** `/ensemble:map-model` and `/ensemble:migrate-model-config` commands ship and work end-to-end.  
**Branch:** `feature/tiered-model-aliases-phase-3`  
**Estimated hours:** 19h

| Task | Estimate | Dependencies |
|------|----------|--------------|
| TRD-014 | 5h | TRD-001, TRD-003 |
| TRD-014-TEST | 4h | TRD-014 |
| TRD-015 | 2h | TRD-014 |
| TRD-016 | 3h | TRD-003 |
| TRD-016-TEST | 2h | TRD-016 |
| TRD-017 | 2h | TRD-016 |
| TRD-018 | 2h | TRD-014 |
| TRD-018-TEST | 1h | TRD-018 |
| **Total** | **21h** | |

**Sprint 3 Exit Criteria:**
- `/ensemble:map-model` wizard runs interactively; writes valid config atomically; creates `.claude/` if missing
- `/ensemble:map-model high claude-opus-4-7` one-shot form works
- `/ensemble:migrate-model-config` translates legacy config; warns about commandOverrides and costTracking
- Both commands bypass pre-flight validation
- All wizard and migrator tests passing

---

### Sprint 4: CI + Docs + Cleanup
**Goal:** Lint script in CI, breaking-change CHANGELOG, README updated, usage-logger cleaned up.  
**Branch:** `feature/tiered-model-aliases-phase-4`  
**Estimated hours:** 13h

| Task | Estimate | Dependencies |
|------|----------|--------------|
| TRD-019 | 3h | TRD-001 |
| TRD-019-TEST | 2h | TRD-019 |
| TRD-020 | 1h | TRD-019 |
| TRD-020-TEST | 0.5h | TRD-020, TRD-009 |
| TRD-021 | 1h | — |
| TRD-022 | 2h | — |
| TRD-023 | 2h | — |
| TRD-023-TEST | 1h | TRD-023 |
| **Total** | **12.5h** | |

**Sprint 4 Exit Criteria:**
- `npm run lint:model-ids` exits 0 on clean codebase, exits 1 on stale ID
- `npm run validate` includes lint:model-ids step
- CHANGELOG has Breaking Changes section
- README has "Model Tier Configuration" section visible at top
- `usage-logger.js` does not depend on `costTracking` config field

---

## Acceptance Criteria Traceability

| REQ | Description | Implementation Tasks | Test Tasks |
|-----|-------------|---------------------|------------|
| REQ-001 | Project-level config location | TRD-003 | TRD-003-TEST |
| REQ-002 | Tier alias schema | TRD-002, TRD-003 | TRD-002-TEST |
| REQ-003 | Hardcoded plugin defaults | TRD-003 | TRD-003-TEST |
| REQ-004 | Config validation | TRD-003 | TRD-003-TEST |
| REQ-005 | Removal of legacy aliases | TRD-005 | TRD-005-TEST, TRD-007-TEST |
| REQ-006 | /ensemble:map-model wizard | TRD-014, TRD-015 | TRD-014-TEST |
| REQ-007 | Wizard model ID suggestions | TRD-014 | TRD-014-TEST |
| REQ-008 | Atomic config write | TRD-014 | TRD-014-TEST |
| REQ-009 | Wizard creates .claude dir | TRD-014 | TRD-014-TEST |
| REQ-010 | Wizard reports final state | TRD-014 | TRD-014-TEST |
| REQ-011 | Command YAML migration | TRD-009 | TRD-009-TEST, TRD-020-TEST |
| REQ-012 | Generated markdown re-sync | TRD-013 | TRD-013-TEST |
| REQ-013 | Agent schema adds model field | TRD-008 | TRD-008-TEST |
| REQ-014 | Per-agent tier assignments | TRD-010, TRD-011, TRD-012 | TRD-012-TEST |
| REQ-015 | Remove legacy defaults | TRD-003 | TRD-003-TEST |
| REQ-016 | Remove old XDG config loading | TRD-003, TRD-006 | TRD-003-TEST, TRD-006-TEST |
| REQ-017 | Migration notes in CHANGELOG | TRD-021 | (manual review) |
| REQ-018 | One-shot CLI form | TRD-018 | TRD-018-TEST |
| REQ-019 | /ensemble:migrate-model-config | TRD-016, TRD-017 | TRD-016-TEST |
| REQ-020 | Pre-flight model ID validation | TRD-004 | TRD-004-TEST |
| REQ-021 | Model ID lint script | TRD-019, TRD-020 | TRD-019-TEST, TRD-020-TEST |
| REQ-022 | Discoverability | TRD-006, TRD-022 | TRD-006-TEST |
| REQ-023 | Priority hierarchy, tier-only | TRD-004 | TRD-004-TEST |
| REQ-024 | KNOWN_MODEL_IDS ownership | TRD-001 | TRD-001-TEST |

---

## Traceability Check

```
Traceability check: 24 requirements covered, 0 uncovered, 0 orphaned annotations
```

All 24 PRD requirements (REQ-001 through REQ-024) have at least one implementation task and one test task. No `[satisfies]` annotations reference REQ IDs absent from the PRD.

---

## Design Readiness Scorecard

| Dimension | Score | Notes |
|-----------|-------|-------|
| Architecture Completeness | 4.5 | All components defined with interfaces; data flow documented; atomic write + TTY detection + bypass list all specified |
| Task Coverage | 4.5 | 24/24 PRD requirements covered; every implementation task has a paired test task; ARCH/INFRA tasks cover non-PRD necessities |
| Dependency Clarity | 4.0 | All dependencies explicit in `[depends: TRD-NNN]` annotations; no circular dependencies; Sprint ordering respects critical path (TRD-001 is foundation for 8 downstream tasks) |
| Estimate Confidence | 4.0 | Estimates are granular (1h–5h range); TRD-014 at 5h is the largest single task (wizard complexity justified); all 8h+ tasks decomposed |
| **Overall** | **4.25** | **PASS** |

### Residual Risks

| Risk | Mitigation in TRD |
|------|------------------|
| `npm install` blocked by private package | TRD-013 explicitly notes fallback: manual `.md` frontmatter edits if generator fails |
| `readline` API differences across Node versions | TRD-014 implementation should use `readline.createInterface` (stable since Node 0.1); test on Node 18+ |
| `fs.renameSync` not atomic across filesystems (e.g., `/tmp` on different mount) | TRD-014 must write temp file to same directory as target (`.claude/`) so rename is same-filesystem |
| Pre-flight using `process.exit(1)` makes tests hard | TRD-004 spec says "throw `PreflightError` for testability" — implementation must use throw, not exit, in non-CLI paths |

---

## New Files Created by This TRD

| File | Type | Task |
|------|------|------|
| `packages/core/lib/known-model-ids.js` | New | TRD-001 |
| `schemas/ensemble-model-config-schema.json` | New | TRD-002 |
| `packages/core/lib/map-model-wizard.js` | New | TRD-014 |
| `packages/core/commands/map-model.yaml` | New | TRD-015 |
| `packages/core/commands/ensemble/map-model.md` | New | TRD-015 |
| `packages/core/lib/legacy-config-migrator.js` | New | TRD-016 |
| `packages/core/commands/migrate-model-config.yaml` | New | TRD-017 |
| `packages/core/commands/ensemble/migrate-model-config.md` | New | TRD-017 |
| `scripts/lint-model-ids.js` | New | TRD-019 |

## Files Modified by This TRD

| File | Change | Task |
|------|--------|------|
| `packages/core/lib/config-loader.js` | Rewrite | TRD-003 |
| `packages/core/lib/model-resolver.js` | Rewrite | TRD-004 |
| `packages/core/lib/usage-logger.js` | Remove costTracking dep | TRD-023 |
| `schemas/command-yaml-schema.json` | Update model enum | TRD-007 |
| `schemas/agent-yaml-schema.json` | Add model field | TRD-008 |
| `packages/*/commands/*.yaml` (18 files) | Alias migration | TRD-009 |
| `packages/*/agents/*.yaml` (28 files) | Add model field | TRD-010, TRD-011, TRD-012 |
| `packages/*/commands/ensemble/*.md` (18+ files) | Re-sync frontmatter | TRD-013 |
| `package.json` (root) | Add lint:model-ids script | TRD-020 |
| `packages/core/CHANGELOG.md` | Breaking change entry | TRD-021 |
| `packages/core/README.md` | Tier model docs | TRD-022 |
