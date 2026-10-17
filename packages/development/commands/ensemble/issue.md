---
name: "ensemble:issue"
description: "Dispatch to an issue-management subcommand by keyword"
version: "1.1.0"
category: "implementation"
last-updated: "2026-10-06"
argument-hint: "<fix|list|resume|status|abandon> [subcommand args...]"
---
<!-- DO NOT EDIT - Generated from issue.yaml -->
<!-- To modify this file, edit the YAML source and run: npm run generate -->


Thin routing layer over issue-related subcommands. "fix" delegates to the existing
fix-issue workflow; "list" is a one-paragraph passthrough to br/bv for triage, per this
repo's AGENTS.md (br handles creating/modifying/closing beads, bv handles triage).
"resume"/"status"/"abandon" (REQ-019) construct the exact `/ensemble:fix-issue`
invocation matching that command's own existing no-arg/--status/--abandon
entry-point resolution convention, then forward unchanged -- no run-index or
stage-machine logic is re-implemented here.

## Subcommands

- **`fix`** - Fix a bug or small issue end to end (analysis, planning, delegated implementation, PR). Invoke `/ensemble:fix-issue` directly, or read and follow `packages/development/commands/ensemble/fix-issue.md`, passing the remaining arguments through as its $ARGUMENTS.
- **`list`** - List open Beads issues via br/bv for triage. Invoke `/ensemble:list-issue` directly, or read and follow `packages/development/commands/ensemble/list-issue.md`, passing the remaining arguments through as its $ARGUMENTS.
- **`resume`** - Resume the project's active/paused issue run from its last recorded checkpoint. Invoke `/ensemble:fix-issue` directly, or read and follow `packages/development/commands/ensemble/fix-issue.md`, passing the remaining arguments through as its $ARGUMENTS.
- **`status`** - Show the active/most-recent issue run's stage, outcome, and references without advancing it (read-only). Invoke `/ensemble:fix-issue` directly, or read and follow `packages/development/commands/ensemble/fix-issue.md`, passing the remaining arguments through as its $ARGUMENTS.
- **`abandon`** - Abandon the project's active/paused issue run after explicit confirmation. Invoke `/ensemble:fix-issue` directly, or read and follow `packages/development/commands/ensemble/fix-issue.md`, passing the remaining arguments through as its $ARGUMENTS.

## Workflow

### Phase 1: Dispatch

**1. Route by first argument token**
   Parse $ARGUMENTS and hand off to the matching sibling command

- Parse $ARGUMENTS. The first whitespace-delimited token selects a subcommand by its keyword below; the remaining text, unmodified, becomes that subcommand's own argument input.
- keyword `resume` with no remaining text: construct the bare invocation `/ensemble:fix-issue` with no flags, matching fix-issue's own existing no-arguments convention for resuming the project's active/paused run from its last recorded checkpoint (AC-019-2), then read and follow fix-issue's own generated command file for this runtime (see the Subcommands section this file renders) using that invocation as its argument input.
- keyword `status` with no remaining text: construct the invocation `/ensemble:fix-issue --status`, matching fix-issue's own existing `--status` convention for its read-only run report (AC-019-3), then read and follow fix-issue's own generated command file for this runtime using that invocation as its argument input.
- keyword `abandon`: the remaining text, if any, is an optional reason -- construct the invocation `/ensemble:fix-issue --abandon <remaining text>` (omit the trailing space when there is none), matching fix-issue's own existing `--abandon` convention for terminating the active/paused run after explicit confirmation (AC-019-4), then read and follow fix-issue's own generated command file for this runtime using that invocation as its argument input.
- If the first token matches a keyword below: read and follow that subcommand's own generated command file for this runtime (see the Subcommands section this file renders), passing the remaining argument text through unmodified. Do not re-implement its phases here.
- If the first token matches no keyword, or $ARGUMENTS is empty: print the keyword table below (keyword + one-line description) and HALT without side effects.

## Usage

```
/ensemble:issue <fix|list|resume|status|abandon> [subcommand args...]
```
