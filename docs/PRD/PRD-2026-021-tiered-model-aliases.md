# PRD-2026-021: Tiered Model Aliases & Project-Level Model Config

---
**Document ID:** PRD-2026-021
**Version:** 1.0.0
**Status:** Draft
**Date:** 2026-05-27
**Scale Depth:** STANDARD
**Total Requirements:** 24
**Readiness Score:** 4.6 / 5.0 (PASS)
---

## PRD Health Summary

| Metric | Value |
|--------|-------|
| Must requirements | 19 |
| Should requirements | 4 |
| Could requirements | 1 |
| Won't (this release) | — |
| AC coverage | 24/24 (100%) |
| Risk flags | 6 |
| Cross-requirement dependencies | 18 |

---

## Product Summary

**Problem Statement:**
Ensemble's model-selection system uses product-specific aliases (`opus`, `sonnet`, `haiku`) that tie configuration to a particular Anthropic model lineup. When Anthropic ships new generations the aliases either keep pointing to retired model IDs or get rewritten everywhere they appear. Today the hardcoded defaults in `config-loader.js` already point at three retired model IDs. Users have no convenient way to edit mappings — they must hand-write JSON to an XDG path that the plugin never installs. Project teams cannot pin a project to a tier without coordinating shell-level env vars.

**Solution Overview:**
Replace the three product-named aliases with three abstract tier aliases — `high`, `medium`, `low` — that every command and agent references. The actual model ID behind each tier is configured per project in a checked-in file at `<project>/.claude/ensemble-model-config.json`. A new `/ensemble:map-model` slash command launches an interactive wizard that lists current mappings and prompts the user to update each tier. The wizard validates inputs against a list of known Claude model IDs and writes the file atomically. Existing commands and agents are migrated from `opus`/`sonnet`/`haiku` to `high`/`medium`/`low` in one pass.

**Value Proposition:**
- Model retirements no longer cause configuration rot — only one file needs updating per project.
- Project teams pin a tier mapping in git, ensuring all collaborators use the same models.
- Agents can declare their tier preference, enabling per-agent quality/cost tuning.
- The wizard removes JSON hand-editing as a usability barrier.

**Target Users:**
- Developers running ensemble commands locally who want predictable model behavior per project.
- Project leads who want to pin a project's tier mapping (e.g., budget-constrained projects use `medium` for what would default to `high`).
- Agent authors who want their agent to request a specific tier.

---

## User Analysis

### User Roles

| Role | Pain Today | What They Gain |
|------|-----------|----------------|
| Developer | Edits JSON manually, no validation, configs go stale on model retirement | Wizard-driven editing; project-pinned mapping |
| Project lead | Cannot enforce tier mapping across the team | Committed `.claude/ensemble-model-config.json` is the team's source of truth |
| Agent author | Cannot declare model preference | `model:` field in agent YAML lets an agent request `high`/`medium`/`low` |
| Plugin maintainer | Three places need updates when model IDs change | One config file per project; defaults shipped with plugin |

### Success Metrics
- Zero commands or agents reference `opus`/`sonnet`/`haiku` after migration.
- New `/ensemble:map-model` command completes a tier remap in under 30 seconds without user touching JSON.
- Adding a new Claude model version requires editing only one file (`.claude/ensemble-model-config.json`) per project, not the plugin source.

---

## Goals and Non-Goals

### Goals (v1)
- Replace all `opus`/`sonnet`/`haiku` aliases with `high`/`medium`/`low` across commands, agents, schema, and hardcoded defaults.
- Introduce `<project>/.claude/ensemble-model-config.json` as the project-level config source.
- Ship `/ensemble:map-model` as an interactive wizard.
- Add an optional `model` field to the agent schema and populate it on a starter set of agents.
- Keep the priority hierarchy (`ENSEMBLE_MODEL_OVERRIDE` env → CLI flag → command YAML → config → defaults) intact.

### Non-Goals (v1)
- Supporting non-Anthropic models (OpenAI, local, etc.).
- A GUI editor — wizard is terminal-only.
- Auto-migration of existing `~/.config/ensemble/model-selection.json` user files (clean break; user re-runs `/map-model` per project).
- Per-command tier overrides inside `.claude/ensemble-model-config.json` (current `commandOverrides` block in the old config goes away; per-command tier is declared in each command's own YAML).
- Carrying the legacy `costTracking` block into the new schema. `packages/core/lib/usage-logger.js` continues to operate but reads hardcoded sane defaults (enabled, `~/.config/ensemble/logs/model-usage.jsonl`). Users who customized the log path lose that customization.
- Updating hook scripts (`packages/router/hooks/`, `packages/permitter/hooks/`) to consume the new schema. Today's hooks do not touch model selection. A future PRD can address hook integration if hook authors begin using tier mappings.

---

## Requirements by Feature Area

### Config File & Loading

#### REQ-001: Project-Level Config Location [Must, Low]
The plugin loads `<project_root>/.claude/ensemble-model-config.json` as the primary source of tier mappings. `project_root` is resolved as: walk up from the current working directory until a `.git` directory or `.git` file (worktree) is found; if no `.git` is encountered before the filesystem root, fall back to the current working directory.
- AC-001-1: Given a project with `.claude/ensemble-model-config.json` present at the git root, when a command runs from any subdirectory of the project, then mappings are read from that file.
- AC-001-2: Given a project with no `.claude/ensemble-model-config.json`, when a command runs, then hardcoded plugin defaults are used and no error is raised.
- AC-001-3: Given a directory that is not inside a git repository, when a command runs, then the loader looks for `.claude/ensemble-model-config.json` in the current working directory only.
- AC-001-4: Given a monorepo with a single `.git` at the root and one `.claude/ensemble-model-config.json` at the root, when commands run from any sub-package, then the same config is used everywhere (monorepo-wide consistency).

#### REQ-002: Tier Alias Schema [Must, Low]
The config file conforms to the following canonical structure:

```json
{
  "version": 1,
  "tiers": {
    "high":   "claude-opus-4-7",
    "medium": "claude-sonnet-4-6",
    "low":    "claude-haiku-4-5-20251001"
  },
  "extraKnownModelIds": []
}
```

**Field semantics:**
- `version` (integer, required): Schema version. Current value is `1`. Loader rejects unknown versions with an upgrade message.
- `tiers` (object, required): Exactly three keys (`high`, `medium`, `low`), each mapping to a non-empty string Claude model ID.
- `extraKnownModelIds` (array of strings, optional, default `[]`): Project-local additions to KNOWN_MODEL_IDS for early adoption of new Claude models.

A JSON Schema file is published at `schemas/ensemble-model-config-schema.json` and referenced via the file's `$schema` field (optional, recommended).

- AC-002-1: Given a config file with `version: 1`, all three tiers populated with non-empty strings, and a valid (possibly empty) `extraKnownModelIds` array, when validated, then validation passes.
- AC-002-2: Given a config file missing one of the three tiers, when validated, then a specific error names the missing tier.
- AC-002-3: Given a config file with `version: 999` (unknown version), when loaded, then the loader rejects it with message `Unsupported ensemble-model-config version 999. Upgrade the plugin or downgrade the config to version 1.`
- AC-002-4: Given a config file with extra keys beyond the canonical schema (e.g., `commandOverrides`), when validated, then a warning lists the unknown keys (does not fail), nudging users toward the new shape.
- AC-002-5: Given a config file with `extraKnownModelIds: ["claude-opus-5-preview"]`, when validated, then validation passes and that ID is added to the allow-list for this project.

#### REQ-003: Hardcoded Plugin Defaults [Must, Low]
If no project config exists, the plugin uses bundled defaults that map `high` → latest Opus, `medium` → latest Sonnet, `low` → latest Haiku, using current model IDs at release time.
- AC-003-1: Given no `.claude/ensemble-model-config.json` and no `~/.config/ensemble/` files, when a `medium`-tier command runs, then the latest Sonnet model ID is used.
- AC-003-2: Given the defaults shipped at release, when read, then no model ID points at a retired model.

#### REQ-004: Config Validation [Must, Medium] [RISK: invalid model IDs cause runtime errors]
Loaded configs are validated against a JSON schema. Validation errors fall back to defaults and emit a clear stderr warning.
- AC-004-1: Given a config file with invalid JSON, when loaded, then defaults are used and a warning identifies the parse error and file path.
- AC-004-2: Given a config with a model ID matching `^claude-[a-z0-9-]+$`, when validated, then the ID is accepted (loose validation — exact existence is not verified at load time).

#### REQ-005: Removal of Legacy Aliases [Must, Medium] [RISK: breaks existing users]
`opus`, `sonnet`, `haiku` are no longer valid alias keys. Any reference to them in a config or command YAML produces a validation error with a migration hint.
- AC-005-1: Given a config file containing key `opus`, when loaded, then validation fails with message "legacy alias 'opus' no longer supported — rename to 'high'".
- AC-005-2: Given a command YAML with `metadata.model: opus`, when the generator runs, then schema validation fails with a clear migration message.

### Edit Command

#### REQ-006: /ensemble:map-model Wizard Mode [Must, Medium]
Invoking `/ensemble:map-model` with no arguments opens an interactive wizard that lists the three tiers, shows the current model ID for each, and prompts the user to change each one.
- AC-006-1: Given a project with an existing config, when `/ensemble:map-model` is invoked, then the wizard displays `high: <current_id>`, `medium: <current_id>`, `low: <current_id>` and prompts for each.
- AC-006-2: Given the user accepts the current value at a prompt (press enter), when the wizard advances, then that tier remains unchanged.
- AC-006-3: Given the user supplies a new model ID at a prompt, when the wizard advances, then the new ID is staged for write.

#### REQ-007: Wizard Model ID Suggestions [Must, Medium]
At each tier prompt, the wizard offers a numbered list of all model IDs in `KNOWN_MODEL_IDS` plus any entries from the existing config's `extraKnownModelIds` array. The wizard accepts only IDs from this combined list — typed custom IDs not present in either list are rejected with a message pointing the user to add the ID to `extraKnownModelIds` first.
- AC-007-1: Given the wizard prompts for `high`, when displayed, then a numbered list shows every entry from KNOWN_MODEL_IDS (typically 3+ current generations) plus any entries from the project's existing `extraKnownModelIds`.
- AC-007-2: Given the user types a model ID not present in KNOWN_MODEL_IDS or extraKnownModelIds, when the wizard validates input, then the input is rejected with message `Model ID '<id>' is not in the allow-list. Add it to extraKnownModelIds in .claude/ensemble-model-config.json first, then re-run /ensemble:map-model.`
- AC-007-3: Given the user picks a number from the suggestion list, when the wizard advances, then the corresponding ID is staged for write.

#### REQ-008: Atomic Config Write [Must, Medium]
The wizard writes the config file atomically (write to temp, rename to final) so a crash mid-write cannot corrupt the file.
- AC-008-1: Given the wizard completes successfully, when the file is inspected, then it contains valid JSON with all three tiers populated.
- AC-008-2: Given the wizard process is killed mid-write, when the file is inspected, then either the prior contents or fully new contents are present — never a partial write.

#### REQ-009: Wizard Creates .claude Directory If Missing [Must, Low]
If `<project>/.claude/` does not exist, the wizard creates it before writing the config file.
- AC-009-1: Given a project with no `.claude/` directory, when the wizard saves, then `.claude/` is created with default permissions and the config file lands inside it.

#### REQ-010: Wizard Reports Final State [Must, Low]
After saving, the wizard prints the new mappings and the file path it wrote to.
- AC-010-1: Given the wizard saves successfully, when control returns to the user, then output shows the three final mappings and the absolute path of the config file.

### Command & Agent Migration

#### REQ-011: Command YAML Migration [Must, Medium] [RISK: incomplete migration leaves orphans]
All 18 command YAML files currently using `opus`/`sonnet` are rewritten to use `high`/`medium`/`low`. Migration rule: `opus` → `high`, `sonnet` → `medium`, `haiku` → `low`.
- AC-011-1: Given the migration is complete, when grepping `packages/*/commands/**/*.yaml` for `model: opus|sonnet|haiku`, then zero matches return.
- AC-011-2: Given the migration is complete, when grepping for `model: high|medium|low`, then all 18 prior commands plus any newly tagged commands appear.

#### REQ-012: Generated Markdown Re-Sync [Must, Low]
Regenerate all `.md` files in `packages/*/commands/ensemble/` so they reflect the new alias values in their frontmatter.
- AC-012-1: Given regeneration runs, when comparing each `.md` frontmatter to its YAML source, then the `model:` field matches exactly.

#### REQ-013: Agent Schema Adds Optional model Field [Must, Low]
`schemas/agent-yaml-schema.json` adds an optional `model` field with enum `["high","medium","low"]`.
- AC-013-1: Given the schema is updated, when validating an agent YAML with `model: high`, then validation passes.
- AC-013-2: Given an agent YAML without a `model` field, when validated, then validation passes (field is optional).

#### REQ-014: Per-Agent Tier Assignments [Must, Medium]
All 28 agents are explicitly assigned a tier per the table below. The non-standard `model: inherit` on `mobile-developer.md` is removed and replaced with the explicit tier shown.

**Tier rules:**
- `high` — strategic reasoning, architecture, security-critical review, complex debugging
- `medium` — routine implementation, documentation, testing, scaffolding
- `low` — context retrieval, file watching, lightweight orchestration utilities

**Assignments:**

| Agent | Tier | Rationale |
|-------|------|-----------|
| ensemble-orchestrator | high | Chief orchestrator; decomposition + delegation |
| tech-lead-orchestrator | high | Architecture decisions |
| product-management-orchestrator | high | Requirements elicitation, stakeholder reasoning |
| qa-orchestrator | high | Quality strategy, gate reasoning |
| infrastructure-orchestrator | high | Multi-cloud architecture |
| code-reviewer | high | Security-critical review; DoD enforcement |
| deep-debugger | high | Root-cause analysis |
| agent-meta-engineer | high | Designing/spawning agents |
| release-agent | high | Release coordination, risk judgment |
| backend-developer | medium | Routine implementation |
| frontend-developer | medium | Routine implementation |
| mobile-developer | medium | Routine implementation (replaces `model: inherit`) |
| infrastructure-developer | medium | Routine implementation |
| documentation-specialist | medium | Doc generation |
| api-documentation-specialist | medium | OpenAPI/Swagger generation |
| postgresql-specialist | medium | Schema work, SQL tuning |
| helm-chart-specialist | medium | Helm chart authoring |
| build-orchestrator | medium | CI/CD pipeline configuration |
| deployment-orchestrator | medium | Release automation |
| playwright-tester | medium | E2E test authoring |
| test-runner | medium | Test execution + triage |
| github-specialist | medium | PR/branch operations |
| git-workflow | medium | Conventional commits, semver |
| manager-dashboard-agent | medium | Metrics aggregation |
| general-purpose | medium | Mixed research/analysis |
| file-creator | low | Template scaffolding |
| context-fetcher | low | Doc retrieval |
| directory-monitor | low | File-system surveillance |

- AC-014-1: Given the migration is complete, when listing agents with `model: high`, then exactly the 9 agents in the table above appear (orchestrators + code-reviewer + deep-debugger + agent-meta-engineer + release-agent).
- AC-014-2: Given the migration is complete, when grepping all agent files for `model: inherit`, then zero matches return.
- AC-014-3: Given the migration is complete, when iterating all 28 agent files, then every agent has exactly one `model:` field set to `high`, `medium`, or `low` matching the table.

### Compatibility & Migration

#### REQ-015: Removal of Legacy Defaults from config-loader.js [Must, Low]
`getDefaultConfig()` in `packages/core/lib/config-loader.js` is rewritten to return the new tier-based schema.
- AC-015-1: Given the change is complete, when `getDefaultConfig()` is called, then the returned object's `modelAliases` keys are exactly `["high","medium","low"]`.

#### REQ-016: Removal of Old XDG Config Loading [Should, Medium] [RISK: breaks users with custom ~/.config/ensemble/model-selection.json]
`config-loader.js` no longer reads from `~/.config/ensemble/model-selection.json` or `~/.ensemble/model-selection.json`. Only the project-level path is consulted. When the loader detects an existing user-level file on first run after upgrade, it emits a one-time loud stderr warning pointing the user to `/ensemble:migrate-model-config` and `/ensemble:map-model`.
- AC-016-1: Given a project with no `.claude/ensemble-model-config.json` and a populated `~/.config/ensemble/model-selection.json`, when a command runs for the first time after upgrade, then the user-level file is ignored, plugin defaults are used, and a single stderr warning names the legacy file and recommends `/ensemble:migrate-model-config`.
- AC-016-2: Given the migration is complete, when `getConfigPaths()` is called, then it returns a single path under the project root.
- AC-016-3: Given the warning has been emitted once (recorded via a sentinel file under `~/.config/ensemble/`), when subsequent commands run, then the warning is not repeated.

#### REQ-017: Migration Notes in CHANGELOG [Must, Low]
A breaking-change entry is added to the relevant CHANGELOG describing the alias rename and the config path change, with the migration command (`/ensemble:map-model`).
- AC-017-1: Given the release is cut, when reading the package CHANGELOG, then an entry under "Breaking Changes" describes the rename and points users to `/ensemble:map-model`.

#### REQ-018: One-Shot CLI Form for Power Users [Could, Low]
`/ensemble:map-model high claude-opus-4-7` accepts positional args to update one tier without entering the wizard.
- AC-018-1: Given `/ensemble:map-model medium claude-sonnet-4-6` is invoked, when execution completes, then only the `medium` tier is updated and the wizard is not shown.

#### REQ-019: One-Shot Migration Command [Must, Medium]
`/ensemble:migrate-model-config` reads the legacy `~/.config/ensemble/model-selection.json` (or `~/.ensemble/model-selection.json`), translates `opus`→`high`, `sonnet`→`medium`, `haiku`→`low`, and writes the result to `<project>/.claude/ensemble-model-config.json`. The command is opt-in — no automatic migration happens.
- AC-019-1: Given a legacy user config exists and no project config exists, when `/ensemble:migrate-model-config` is invoked, then a project config is written with the three legacy model IDs mapped to high/medium/low.
- AC-019-2: Given a legacy user config and an existing project config both exist, when the migration command is invoked, then the user is prompted before overwriting and the existing project config can be preserved.
- AC-019-3: Given no legacy config exists, when the migration command is invoked, then a clear message reports nothing to migrate and `/ensemble:map-model` is suggested instead.
- AC-019-4: Given the migration writes successfully, when complete, then the legacy file is left untouched (not deleted), so users can roll back manually.
- AC-019-5: Given the legacy config contains a `commandOverrides` block, when migration runs, then the override entries are NOT carried into the new project config (per non-goal) but ARE printed to stderr as a list with instructions: "These per-command overrides are no longer supported in the config file. To preserve them, edit each command's YAML and set its `metadata.model` field. Affected commands: <list>".
- AC-019-6: Given the legacy config contains a `costTracking` block with a custom `logPath`, when migration runs, then a stderr notice prints: "Custom cost-tracking log path '<path>' was not migrated — usage-logger now writes to ~/.config/ensemble/logs/model-usage.jsonl unconditionally."

### Runtime Validation & Operational Safeguards

#### REQ-020: Pre-Flight Model ID Validation on Every Invocation [Must, Medium] [RISK: stale model IDs run unnoticed until SDK rejects them]
Before any command or agent invocation does work, the loader pre-flights the resolved tier mapping. If any of the three tier mappings (`high`, `medium`, `low`) fails validation, the invocation halts before doing any work, prints a help block pointing at `/ensemble:map-model`, and exits non-zero. Validation is performed against an embedded KNOWN_MODEL_IDS list shipped with the plugin (updated on plugin release).
- AC-020-1: Given `.claude/ensemble-model-config.json` maps `high` to a model ID not in KNOWN_MODEL_IDS, when any ensemble command is invoked, then the command does not execute its workflow and stderr contains: a header (`Invalid model ID detected.`), the offending tier and value, the file path, and the suggestion `Run /ensemble:map-model to fix.`
- AC-020-2: Given a tier mapping is missing (e.g., `low` key absent), when any ensemble command is invoked, then the command exits non-zero with a message naming the missing tier and the suggestion to run `/ensemble:map-model`.
- AC-020-3: Given the config file is unreadable (permission error), when any ensemble command is invoked, then the command exits non-zero with a message naming the file and the OS error, and the suggestion to run `/ensemble:map-model` or check permissions.
- AC-020-4: Given an agent is delegated to (e.g., by ensemble-orchestrator) and the agent declares `model: high` which fails pre-flight, when the agent loads, then the same halt-and-help behavior fires before the agent processes its prompt.
- AC-020-5: Given the invoked command is `/ensemble:map-model` or `/ensemble:migrate-model-config`, when pre-flight runs, then validation is bypassed (these commands exist to repair the config and must run even when the config is invalid).
- AC-020-6: Given the project's config file contains an `extraKnownModelIds` array (e.g., `["claude-opus-5-preview"]`), when pre-flight evaluates a tier mapping pointing at one of those IDs, then validation passes (the array extends KNOWN_MODEL_IDS for this project).
- AC-020-7: Given the bundled plugin defaults themselves contain a model ID no longer in the current KNOWN_MODEL_IDS list (release-pipeline regression), when pre-flight runs on a project with no config file, then validation fails fast with a message naming the plugin defaults and instructing the user to upgrade the plugin or create a project config.

#### REQ-021: Model ID Lint Script [Should, Low]
A repo-level lint script (`npm run lint:model-ids` or similar) scans all command/agent YAML and the bundled defaults for model IDs not present in the KNOWN_MODEL_IDS list. Used in CI to prevent retired IDs from shipping.
- AC-021-1: Given a command or agent YAML references a model ID not in KNOWN_MODEL_IDS, when the lint script runs, then it exits non-zero and lists the offending files and tier values.
- AC-021-2: Given all files reference known IDs, when the lint script runs, then it exits zero with a single-line success message.
- AC-021-3: Given a new Claude model ID needs to be added to the project, when the developer updates KNOWN_MODEL_IDS, then the lint script accepts it on next run with no other file changes required.

#### REQ-022: Discoverability — First-Run Hint, README, Post-Install [Should, Low]
First-time users of the plugin in a project without `.claude/ensemble-model-config.json` see a brief one-line hint pointing at `/ensemble:map-model`. The plugin README documents the command and tier model. The plugin's post-install (if any) prints the hint as well.
- AC-022-1: Given a project with no `.claude/ensemble-model-config.json`, when an ensemble command is run for the first time in that project, then a single-line stderr hint appears: `Tip: run /ensemble:map-model to pin Claude model tiers for this project (.claude/ensemble-model-config.json).`
- AC-022-2: Given the hint has been shown once for a project, when subsequent commands run in that project, then the hint is not repeated. Implementation: the loader maintains `~/.config/ensemble/seen-hints.json` — a JSON object keyed by absolute project path; the first-run hint adds the current project_root to the map; the loader skips the hint when the key is already present. This file lives outside the project so it does not touch `.claude/`.
- AC-022-3: Given the plugin README, when read by a new user, then the tier model and `/ensemble:map-model` command are documented in a top-level section visible without scrolling.
- AC-022-4: Given the seen-hints file does not exist or is unreadable, when the loader checks for the hint, then it treats the project as unseen (hint fires) and best-effort creates/writes the file (errors swallowed — never block a command on this).

#### REQ-023: Priority Hierarchy Preserved, Tier-Aliases-Only [Must, Medium]
The existing 6-level priority hierarchy (env var → CLI flag → command YAML → config defaults → hardcoded fallback) is preserved. `ENSEMBLE_MODEL_OVERRIDE` and the future `--model` CLI flag accept tier aliases (`high`/`medium`/`low`) ONLY — full model IDs are rejected, as are legacy aliases (`opus`/`sonnet`/`haiku`).
- AC-023-1: Given `ENSEMBLE_MODEL_OVERRIDE=high` is set, when a command runs, then the env var overrides any command-YAML tier and the resolved model is the project's `high` mapping.
- AC-023-2: Given `ENSEMBLE_MODEL_OVERRIDE=opus` (legacy alias), when a command runs, then the command halts with message `ENSEMBLE_MODEL_OVERRIDE value 'opus' is no longer supported. Use 'high', 'medium', or 'low'. Run /ensemble:map-model to inspect or change project tier mappings.`
- AC-023-3: Given `ENSEMBLE_MODEL_OVERRIDE=claude-opus-4-7` (full model ID), when a command runs, then the command halts with message `ENSEMBLE_MODEL_OVERRIDE must be a tier alias ('high', 'medium', 'low'), not a model ID. Map tiers to model IDs via /ensemble:map-model.`
- AC-023-4: Given the config file has no `commandOverrides` section (per non-goal), when a command runs, then the loader does not look for one — per-command tier comes only from each command's own YAML.

#### REQ-024: KNOWN_MODEL_IDS Ownership & Release Discipline [Must, Low]
The list of valid Claude model IDs lives in a single source-of-truth file at `packages/core/lib/known-model-ids.js`, exporting an immutable array of dated/pinned model IDs. The runtime validator (REQ-020), the wizard (REQ-007), and the lint script (REQ-021) all import from this one file. The file is updated as part of each plugin release that supports new Claude model IDs, and a release-time smoke test verifies every ID in the list resolves against the Anthropic API.
- AC-024-1: Given the list is updated for a release, when imported by the validator, wizard, and lint script, then all three see the same set of IDs (no per-consumer copy).
- AC-024-2: Given a release PR adds a new model ID, when CI runs, then a smoke test invokes a no-op API call against each ID in the list and fails the PR if any ID is rejected by the Anthropic API.
- AC-024-3: Given the list file, when read, then every entry is a fully-pinned model ID (e.g., `claude-opus-4-7-20260105`) or an Anthropic-blessed dated alias — never a moving alias like `claude-opus-latest`.

---

## Dependency Map

| REQ | Depends On | Notes |
|-----|------------|-------|
| REQ-002 | REQ-001 | Schema only meaningful once load path is decided |
| REQ-003 | REQ-002 | Defaults must match schema |
| REQ-004 | REQ-002 | Validation depends on schema definition |
| REQ-005 | REQ-002 | Legacy rejection is a schema check |
| REQ-006 | REQ-001, REQ-002 | Wizard reads/writes the file |
| REQ-007 | REQ-006, REQ-024 | Suggestions are part of wizard UX; read KNOWN_MODEL_IDS |
| REQ-008 | REQ-006 | Atomic write is wizard-internal |
| REQ-009 | REQ-006 | Directory creation is wizard-internal |
| REQ-010 | REQ-006 | Output reporting is wizard-internal |
| REQ-011 | REQ-005 | Can only migrate once legacy aliases reject |
| REQ-012 | REQ-011 | MD regeneration follows YAML changes |
| REQ-013 | — | Independent schema change |
| REQ-014 | REQ-013 | Population requires schema first |
| REQ-015 | REQ-002, REQ-003 | Defaults update follows schema |
| REQ-016 | REQ-001 | Old path removal follows new path adoption |
| REQ-017 | REQ-011, REQ-015, REQ-016, REQ-019 | Changelog summarizes breaking changes |
| REQ-018 | REQ-006 | CLI form alternative to wizard |
| REQ-019 | REQ-001, REQ-016 | Migration command writes to new path, complements warning |
| REQ-020 | REQ-002, REQ-004, REQ-024 | Pre-flight imports KNOWN_MODEL_IDS |
| REQ-021 | REQ-002, REQ-024 | Lint imports KNOWN_MODEL_IDS |
| REQ-022 | REQ-006 | First-run hint points at the wizard |
| REQ-023 | REQ-002, REQ-019 | Hierarchy depends on tier schema; migration must warn about dropped overrides |
| REQ-024 | — | KNOWN_MODEL_IDS is foundational — no upstream dependencies |

---

## Risks

| Risk | Mitigation |
|------|-----------|
| Existing users on `~/.config/ensemble/model-selection.json` lose settings silently | Loud one-time warning (REQ-016) plus opt-in `/ensemble:migrate-model-config` command (REQ-019) that translates legacy aliases automatically |
| Stale model IDs in shipped defaults | Bundle defaults at release time; lint script (REQ-021) blocks retired IDs in CI |
| Runtime validation false-positive blocks valid future Claude model | KNOWN_MODEL_IDS is updated per plugin release; users can also add IDs locally via an `extraKnownModelIds` array in the config (escape hatch) |
| Wizard runs in non-TTY environments (CI) | Detect non-TTY; print message and exit 1 unless `--non-interactive` form is used |
| `.claude/ensemble-model-config.json` causes merge conflicts | Document recommended practice: commit baseline mapping, document overrides in README |
| User maps a tier to a non-existent model ID | Loose schema validation accepts any `claude-*` string; runtime failure surfaces from the SDK, not the config loader |

---

## Implementation Readiness Scorecard

| Dimension | Score | Notes |
|-----------|-------|-------|
| Completeness | 4.5 | All feature areas covered; one optional Could requirement |
| Testability | 4.5 | Every REQ has at least one AC; ACs are file/state assertions |
| Clarity | 4.5 | Concrete file paths, alias names, migration rules |
| Feasibility | 4.0 | Touches schema, 18 commands, 28 agents, config loader, new commands — sizable but mechanical |
| **Overall** | **4.4** | PASS |
