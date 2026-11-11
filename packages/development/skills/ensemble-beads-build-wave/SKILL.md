---
name: ensemble-beads-build-wave
description: "Run a single beads-build wave (one work-graph.plan/work-graph.ready schedule + concurrent Task() dispatch + barrier) and emit a JSON summary suitable for the parent loop"
disable-model-invocation: true
metadata:
  version: "1.4.0"
  category: implementation
---

Single-wave primitive for the beads-build execution engine. Each invocation
runs exactly one scheduling wave: the optional work-graph.plan capability (falling back to the required work-graph.ready capability when plan is unavailable or errors -- never when plan succeeds with zero tracks, which is an empty plan handled at Step 3's empty-plan edge) partitions the ready set,
the parent dispatches every track concurrently to tech-lead-orchestrator via
Task(), the parent waits for the barrier, and a structured JSON summary is
emitted so the caller can decide whether to dispatch another wave.

This command is intentionally non-recursive: at no point does this command
call itself or any sibling subagent. The loop lives in the caller
(beads-build.yaml Execute phase), which checks the summary
`remaining_scoped_count` and dispatches another wave-runner if non-zero.
That two-tier shape respects Codex max_depth=1 and works across claude/pi/codex/opencode via the universal Task() primitive.
Invoked standalone, it still exits with a JSON summary once the barrier settles;
callers re-invoke it themselves.

## Capabilities

**Required:** tracker.show, tracker.set-status, tracker.close, tracker.comment, work-graph.ready, workflow.status, workflow.commit
**Optional:** work-graph.plan, tracker.list, tracker.sync

## Workflow

Work through the phases in numbered order. Each phase's full instructions are in its own file under `references/`, in this skill's directory: open the file with your file-reading tool (not a shell command) when you reach that phase and follow it exactly. Resolve the paths below relative to this SKILL.md.

| Phase | Instructions | Steps |
|---|---|---|
| 1. Preflight | `references/phase-1-preflight.md` | Argument Parsing; Toolchain Preflight; Working Directory and Branch Verification; Epic and TRD Resolution; Strategy Detection |
| 2. Execute | `references/phase-2-execute.md` | Single-Wave Dispatch (sync, plan, parse tracks, scope check, track payload, concurrent dispatch, barrier, empty-plan edge, JSON summary) |

## Expected Output

**Format:** Single JSON summary line, then exit

**Structure:**

- **JSON Summary**: One line of valid JSON describing wave outcome; caller reads remaining_scoped_count and terminal_state to decide next step

## Expected Input

```yaml
format: Wave-runner arguments (required --epic, optional flags)
sections:
  - name: Epic ID
    required: true
    description: ROOT_EPIC_ID of the epic bead to advance
  - name: Max Parallel
    required: false
    description: Maximum tracks to dispatch concurrently (default 3)
  - name: TRD Path
    required: false
    description: Path to TRD file for traceability tokens, checkbox sync, requirement report
  - name: Strategy
    required: false
    description: 'Implementation strategy: tdd, characterization, bug-fix, refactor, test-after, flexible'
```

