---
name: "ensemble:feature"
description: "Dispatch to the feature-lifecycle workflow by keyword (new, resume, status, abandon)"
version: "1.0.0"
category: "implementation"
last-updated: "2026-10-06"
argument-hint: "<new|resume|status|abandon> [args...]"
---
<!-- DO NOT EDIT - Generated from feature.yaml -->
<!-- To modify this file, edit the YAML source and run: npm run generate -->


Single canonical front door for the feature lifecycle. Thin routing layer over the
existing resumable, checkpointed `/ensemble:new-feature` workflow -- "new" starts a
run from an idea, "resume" continues the project's active/paused run from its last
recorded checkpoint, "status" reports it read-only, and "abandon" terminates it after
explicit confirmation. Each keyword below constructs the exact `/ensemble:new-feature`
invocation matching that command's own existing idea/status/abandon argument
convention, then reads and follows its generated file for this runtime unchanged --
no PRD/TRD authoring, bead planning, implementation, or PR stage logic is
re-implemented here.

## Subcommands

- **`new`** - Start a new feature run from an idea. Invoke `/ensemble:new-feature` directly, or read and follow `packages/development/commands/ensemble/new-feature.md`, passing the remaining arguments through as its $ARGUMENTS.
- **`resume`** - Resume the project's active/paused run from its last recorded checkpoint. Invoke `/ensemble:new-feature` directly, or read and follow `packages/development/commands/ensemble/new-feature.md`, passing the remaining arguments through as its $ARGUMENTS.
- **`status`** - Show the active/most-recent run's stage, outcome, and references without advancing it (read-only). Invoke `/ensemble:new-feature` directly, or read and follow `packages/development/commands/ensemble/new-feature.md`, passing the remaining arguments through as its $ARGUMENTS.
- **`abandon`** - Abandon the project's active/paused run after explicit confirmation. Invoke `/ensemble:new-feature` directly, or read and follow `packages/development/commands/ensemble/new-feature.md`, passing the remaining arguments through as its $ARGUMENTS.

## Workflow

### Phase 1: Dispatch

**1. Route by first argument token and construct the forward invocation**
   Parse $ARGUMENTS, select an action by its keyword below, and build the exact /ensemble:new-feature invocation that keyword forwards into

- Delegation-availability guard (REQ-006): before doing anything else, confirm `/ensemble:new-feature`'s generated command file for this runtime (see the Subcommands section this file renders) resolves. If it does not resolve, HALT immediately: name the missing capability (`ensemble-new-feature`) and state how to obtain it (install/enable the `development` package), creating no run state and performing no other action below. If it resolves, proceed silently -- print no availability confirmation of any kind, for any keyword, including the ordinary case of a project's first-ever `new` run with no prior `.ensemble/new-feature/` state (that remains the normal, silent first-run case).
- Parse $ARGUMENTS. The first whitespace-delimited token selects an action by its keyword below; everything after it is this step's own remaining text.
- Foreman flag extraction (REQ-008), done after the keyword is selected and BEFORE the validation below: if the token immediately after the keyword is exactly `--foreman`, remove that one token from the remaining text and set FOREMAN = true; otherwise FOREMAN = false. Only that position counts: `--foreman` anywhere else (for example inside the feature description) is ordinary text, never the flag, and is forwarded untouched as part of the text. Everything below -- the validation and each keyword's construction -- then sees the remaining text without the flag, so `resume --foreman` and `status --foreman` have no remaining text and are valid, and `new --foreman <idea>` forwards exactly `<idea>`.
- Command input validation at the boundary (REQ-015): before any RunIndexStore access or forward invocation is constructed, reject the input in either of these cases -- printing the keyword table below (keyword + one-line description) and HALTing with no side effects, identically to the Fallback action below: (1) the first token matches none of `new`/`resume`/`status`/`abandon`, or $ARGUMENTS is empty; (2) the first token is `resume` or `status` and there is any remaining text -- `resume` and `status` take no arguments, so any remaining text is an unsupported flag or argument rejected here, not silently ignored.
- keyword `new`: the remaining text is the feature description -- construct the invocation `/ensemble:new-feature --idea "<remaining text>"`, matching new-feature's own existing idea-argument convention for starting a run (its Entry Point Resolution Step 2, AC-001-1). The description text is forwarded exactly as given -- never reworded, summarized, or truncated.
- keyword `resume` with no remaining text (any remaining text is rejected above, REQ-015): construct the bare invocation `/ensemble:new-feature` with no flags, matching new-feature's own existing no-arguments convention for resuming the project's active/paused run from its last recorded checkpoint (its Entry Point Resolution Step 4, status=false).
- keyword `status` with no remaining text (any remaining text is rejected above, REQ-015): construct the invocation `/ensemble:new-feature --status`, matching new-feature's own existing `--status` convention for its read-only run report (its Entry Point Resolution Step 4, status=true). That path makes no mutate() call.
- keyword `abandon`: the remaining text, if any, is an optional reason -- construct the invocation `/ensemble:new-feature --abandon <remaining text>` (omit the trailing space when there is none), matching new-feature's own existing `--abandon` convention for terminating the active/paused run after explicit confirmation (its Entry Point Resolution Step 6, AC-007-3).
- Foreman flag forwarding (REQ-008): when FOREMAN == true, INSERT `--foreman` immediately after `/ensemble:new-feature` in whichever invocation the keyword action above constructed, and change nothing else in it: `new` -> `/ensemble:new-feature --foreman --idea "<remaining text>"`; `resume` -> `/ensemble:new-feature --foreman`; `status` -> `/ensemble:new-feature --foreman --status`; `abandon` -> `/ensemble:new-feature --foreman --abandon <remaining text>` (omit the trailing space when there is no reason). When FOREMAN is false the constructed invocation is used exactly as built. new-feature owns what `--foreman` does from there; this dispatcher adds no behavior of its own.
- For whichever keyword matched: read and follow new-feature's own generated command file for this runtime (see the Subcommands section this file renders) using the invocation constructed above as its argument input. Do not re-implement any of its stages here -- this file performs zero stage-machine logic of its own. This includes concurrency refusal: a second concurrent `new` while a run is already active is never detected or reported by this dispatcher -- it forwards the identical invocation into new-feature's own entry logic, which surfaces its own existing `RUN_ALREADY_ACTIVE` refusal unchanged (REQ-013), naming the existing run exactly as a direct `/ensemble:new-feature` invocation would.
- If the first token matches no keyword above, or $ARGUMENTS is empty: print the keyword table below (keyword + one-line description) and HALT without side effects.

## Usage

```
/ensemble:feature <new|resume|status|abandon> [args...]
```
