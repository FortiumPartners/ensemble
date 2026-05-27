---
name: ensemble:migrate-model-config
description: One-shot migration from legacy ~/.config/ensemble/model-selection.json to project-level .claude/ensemble-model-config.json
version: 1.0.0
category: configuration
model: medium
---
<!-- DO NOT EDIT - Generated from migrate-model-config.yaml -->
<!-- To modify this file, edit the YAML source and run: npm run generate -->

One-shot migration from the legacy `~/.config/ensemble/model-selection.json` format to the new project-level `.claude/ensemble-model-config.json` format.

## Usage

```
/ensemble:migrate-model-config
/ensemble:migrate-model-config --overwrite
```

## Description

Detects and migrates a legacy XDG-based model config to the new project-level tiered format. The legacy `opus`/`sonnet`/`haiku` alias keys are mapped to the current `high`/`medium`/`low` tier names.

### Key behaviors

- Searches `~/.config/ensemble/model-selection.json` and `~/.ensemble/model-selection.json` for a legacy config.
- Maps `modelAliases.opus` → `tiers.high`, `modelAliases.sonnet` → `tiers.medium`, `modelAliases.haiku` → `tiers.low`.
- Writes the new config to `.claude/ensemble-model-config.json` in the current project root (nearest `.git` ancestor).
- Does **not** delete the legacy file.
- Prints `stderr` warnings for `commandOverrides` and `costTracking.logPath` fields that cannot be automatically migrated.

### Overwrite flag

If `.claude/ensemble-model-config.json` already exists, the command aborts unless `--overwrite` is passed.

## Notes

- This command is in the `BYPASS_COMMANDS` list and skips pre-flight model validation so it can run even when the current config is invalid.
- After migration, run `/ensemble:map-model` to verify or adjust tier assignments.
