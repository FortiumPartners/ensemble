---
name: "ensemble:prd"
description: "Dispatch to a PRD-authoring or PRD-refinement subcommand by keyword"
version: "1.0.0"
category: "planning"
last-updated: "2026-10-05"
argument-hint: "<create|create-meeting|refine|refine-meeting> [subcommand args...]"
---
<!-- DO NOT EDIT - Generated from prd.yaml -->
<!-- To modify this file, edit the YAML source and run: npm run generate -->


Thin routing layer over the existing create-prd / create-prd-meeting / refine-prd /
refine-prd-meeting commands. Reads and follows the matching sibling command's own
generated file for this runtime, passing the rest of $ARGUMENTS unchanged, and does
not re-implement any of their phases.

## Subcommands

- **`create`** - Create a new PRD through a live structured interview. Invoke `/ensemble:create-prd` directly, or read and follow `packages/product/commands/ensemble/create-prd.md`, passing the remaining arguments through as its $ARGUMENTS.
- **`create-meeting`** - Create a PRD from a meeting summary instead of a live interview. Invoke `/ensemble:create-prd-meeting` directly, or read and follow `packages/product/commands/ensemble/create-prd-meeting.md`, passing the remaining arguments through as its $ARGUMENTS.
- **`refine`** - Refine an existing PRD with stakeholder feedback. Invoke `/ensemble:refine-prd` directly, or read and follow `packages/product/commands/ensemble/refine-prd.md`, passing the remaining arguments through as its $ARGUMENTS.
- **`refine-meeting`** - Refine an existing PRD using a meeting summary as the feedback source. Invoke `/ensemble:refine-prd-meeting` directly, or read and follow `packages/product/commands/ensemble/refine-prd-meeting.md`, passing the remaining arguments through as its $ARGUMENTS.

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
