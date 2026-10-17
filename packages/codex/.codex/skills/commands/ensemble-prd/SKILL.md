---
name: ensemble-prd
description: Dispatch to a PRD-authoring or PRD-refinement subcommand by keyword (Codex skill for /ensemble:prd)
user-invocable: true
argument-hint: <create|create-meeting|refine|refine-meeting> [subcommand args...]
---

# Ensemble Command: /ensemble:prd

This Codex skill mirrors the Ensemble slash command `/ensemble:prd`.
Follow the workflow below, adapt to the current repository, and keep outputs structured.

## Subcommands

- **`create`** - Create a new PRD through a live structured interview. see the `ensemble-create-prd` skill (`packages/codex/.codex/skills/commands/ensemble-create-prd/SKILL.md`).
- **`create-meeting`** - Create a PRD from a meeting summary instead of a live interview. see the `ensemble-create-prd-meeting` skill (`packages/codex/.codex/skills/commands/ensemble-create-prd-meeting/SKILL.md`).
- **`refine`** - Refine an existing PRD with stakeholder feedback. see the `ensemble-refine-prd` skill (`packages/codex/.codex/skills/commands/ensemble-refine-prd/SKILL.md`).
- **`refine-meeting`** - Refine an existing PRD using a meeting summary as the feedback source. see the `ensemble-refine-prd-meeting` skill (`packages/codex/.codex/skills/commands/ensemble-refine-prd-meeting/SKILL.md`).

<!-- DO NOT EDIT - Generated from prd.yaml -->
<!-- To modify this file, edit the YAML source and run: npm run generate -->


Thin routing layer over the existing create-prd / create-prd-meeting / refine-prd /
refine-prd-meeting commands. Reads and follows the matching sibling command's own
generated file for this runtime, passing the rest of $ARGUMENTS unchanged, and does
not re-implement any of their phases.

## Workflow

### Phase 1: Dispatch

**1. Route by first argument token**
   Parse $ARGUMENTS and hand off to the matching sibling command

- Parse $ARGUMENTS. The first whitespace-delimited token selects a subcommand by its keyword below; the remaining text, unmodified, becomes that subcommand's own argument input.
- If the first token matches a keyword below: read and follow that subcommand's own generated command file for this runtime (see the Subcommands section this file renders), passing the remaining argument text through unmodified. Do not re-implement its phases here.
- If the first token matches no keyword, or $ARGUMENTS is empty: print the keyword table below (keyword + one-line description) and HALT without side effects.

## Usage

```
/ensemble:prd <create|create-meeting|refine|refine-meeting> [subcommand args...]
```
