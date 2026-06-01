---
name: ensemble:map-model
description: Interactive wizard to pin Claude model tier mappings for this project
version: 1.0.1
category: configuration
model: medium
---
<!-- DO NOT EDIT - Generated from map-model.yaml -->
<!-- To modify this file, edit the YAML source and run: npm run generate -->


Interactively remap the three Claude model tiers (high/medium/low) to specific
Claude model IDs for this project. Creates or updates
<project_root>/.claude/ensemble-model-config.json.

## Workflow

### Phase 1: Model Tier Configuration

**1. Pre-flight Bypass**
   This command bypasses pre-flight validation (it exists to repair invalid configs)

   - Bypass pre-flight model validation (command is in BYPASS_COMMANDS list)

**2. Load and Display Current Config**
   Show existing tier mappings before prompting

   - Load config from .claude/ensemble-model-config.json (or defaults if missing)
   - Display current high/medium/low mappings with numbered KNOWN_MODEL_IDS suggestions

**3. Prompt Per Tier**
   Interactively collect new mapping for each tier

   - For each tier (high, medium, low) - prompt user to keep current or select from list
   - Accept empty input (keep current), numbered selection, or reject unknown IDs

**4. Atomic Write and Report**
   Write updated config and confirm

   - Write .claude/ensemble-model-config.json atomically (tmp+rename)
   - Print final mappings and absolute file path

**5. One-Shot Mode (non-interactive)**
   Direct single-tier update without wizard

   - Usage: /ensemble:map-model <tier> <model-id>
   - Validate tier is high/medium/low and model-id is in allowList
   - Update only the specified tier; print confirmation

## Expected Output

**Format:** Config confirmation

**Structure:**
- **Saved path and tier mappings**: Absolute path to written file plus three tier -> model-id lines

## Usage

```
/ensemble:map-model
```
