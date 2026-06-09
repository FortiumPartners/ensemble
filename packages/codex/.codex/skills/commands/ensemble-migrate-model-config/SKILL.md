---
name: ensemble-migrate-model-config
description: One-shot migration from legacy ~/.config/ensemble/model-selection.json to project-level .claude/ensemble-model-config.json (Codex skill for /ensemble:migrate-model-config)
user-invocable: true
model: gpt-5.1-codex
---

# Ensemble Command: /ensemble:migrate-model-config

This Codex skill mirrors the Ensemble slash command `/ensemble:migrate-model-config`.
Follow the workflow below, adapt to the current repository, and keep outputs structured.

<!-- DO NOT EDIT - Generated from migrate-model-config.yaml -->
<!-- To modify this file, edit the YAML source and run: npm run generate -->


Detect and migrate a legacy XDG-based model-selection.json config file
to the new project-level .claude/ensemble-model-config.json format.
Maps old opus/sonnet/haiku alias keys to the current high/medium/low tier names.
Warns about per-command overrides and custom cost-tracking log paths that
cannot be automatically migrated.

## Workflow

### Phase 1: Legacy Config Migration

**1. Pre-flight Bypass**
   This command bypasses pre-flight validation to allow it to run even when the current config is invalid

   - Bypass pre-flight model validation (command is in BYPASS_COMMANDS list)

**2. Locate Legacy Config**
   Search standard XDG paths for an existing legacy config file

   - Check ~/.config/ensemble/model-selection.json (or $XDG_CONFIG_HOME/ensemble/model-selection.json)
   - Check ~/.ensemble/model-selection.json
   - Report path found or abort with helpful message if none found

**3. Parse and Map Legacy Keys**
   Read legacy config and translate to new format

   - Parse JSON from legacy config file
   - Map modelAliases.opus -> tiers.high
   - Map modelAliases.sonnet -> tiers.medium
   - Map modelAliases.haiku -> tiers.low
   - Preserve already-valid tier keys (high/medium/low) unchanged

**4. Warn About Non-Migratable Fields**
   Surface deprecation warnings for fields that require manual action

   - If commandOverrides present - print stderr list of affected commands with instructions to set metadata.model in each command YAML
   - If costTracking.logPath present - print stderr notice that custom log path was not migrated

**5. Write Project Config**
   Atomically write the new config to the project directory

   - Detect project root by walking up to the nearest .git directory
   - If .claude/ensemble-model-config.json already exists - abort unless --overwrite flag given
   - Write new config atomically (tmp+rename)
   - Print confirmation with absolute path to written file
   - Leave the legacy file intact (do not delete)

## Expected Output

**Format:** Migration confirmation

**Structure:**
- **Migrated config path**: Absolute path to the newly written .claude/ensemble-model-config.json
- **Deprecation warnings (stderr)**: Warnings for commandOverrides and costTracking.logPath if present in legacy config

## Usage

```
/ensemble:migrate-model-config
```
