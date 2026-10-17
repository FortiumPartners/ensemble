---
name: "ensemble:list-issue"
description: "List open Beads issues for triage using this repo's standard br/bv CLI tools"
version: "1.0.0"
category: "implementation"
last-updated: "2026-10-05"
argument-hint: "[--ranked | --robot-triage]"
model: "haiku"
---
<!-- DO NOT EDIT - Generated from list-issue.yaml -->
<!-- To modify this file, edit the YAML source and run: npm run generate -->


Thin passthrough with no ensemble-specific workflow, per AGENTS.md's existing br/bv
ownership of listing and triage. Integration section.

## Workflow

### Phase 1: Beads Work Discovery

**1. Run br/bv listing for ranked or flat output**
   Run `br list --status=open --json` for a flat list, or `bv --robot-triage` for ranked/scored triage output, per the caller's preference (default to `br list --status=open --json` if $ARGUMENTS is empty).

- Present the result to the user as-is. Do not create, modify, or close any issues. Do not invoke bare `bv` without a --robot-* flag (it launches a blocking interactive TUI).

## Expected Output

**Format:** br/bv listing output, unmodified

**Structure:**
- **Issue List**: Whatever br/bv printed for the requested mode (flat list or ranked triage)

## Usage

```
/ensemble:list-issue [--ranked | --robot-triage]
```
