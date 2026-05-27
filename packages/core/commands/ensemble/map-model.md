---
name: ensemble:map-model
description: Interactive wizard to pin Claude model tier mappings for this project
version: 1.0.0
category: configuration
---
<!-- DO NOT EDIT - Generated from map-model.yaml -->
<!-- To modify this file, edit the YAML source and run: npm run generate -->

Interactive wizard to pin Claude model tier mappings for this project. Creates or updates `.claude/ensemble-model-config.json`.

## Usage

```
/ensemble:map-model
/ensemble:map-model <tier> <model-id>
```

## Description

Interactively remap the three Claude model tiers (high/medium/low) to specific Claude model IDs for this project.

### Interactive Mode

Running `/ensemble:map-model` with no arguments launches the interactive wizard. For each tier you will see a numbered list of known model IDs, the current assignment, and a prompt to keep or change it.

### One-Shot Mode

Running `/ensemble:map-model <tier> <model-id>` performs a non-interactive single-tier update:

```
/ensemble:map-model high claude-opus-4-7
/ensemble:map-model medium claude-sonnet-4-6
/ensemble:map-model low claude-haiku-4-5-20251001
```

## Notes

- This command is in the `BYPASS_COMMANDS` list and skips pre-flight model validation, allowing it to repair invalid configurations.
- Model IDs must be in the `KNOWN_MODEL_IDS` list or the `extraKnownModelIds` field of `.claude/ensemble-model-config.json`.
- Config is written atomically (temp file + rename) to prevent corruption.
