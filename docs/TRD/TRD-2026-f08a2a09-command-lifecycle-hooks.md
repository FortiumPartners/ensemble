---
document_id: TRD-2026-f08a2a09
label: trd-command-lifecycle-hooks
kind: trd
prd_reference: PRD-2026-f08a2a09
prd_path: docs/PRD/PRD-2026-f08a2a09-command-lifecycle-hooks.md
version: 1.0.4
status: Draft
date: 2026-10-15
design_readiness_score: 4.0
Constitution compliance: passed
---

# TRD-2026-f08a2a09: Command Lifecycle Hooks

Based on PRD: docs/PRD/PRD-2026-f08a2a09-command-lifecycle-hooks.md (v1.0.5, Locked)

## Architecture Decision

**Decision:** Build the lifecycle as a harness-neutral core in `packages/agent-core` (event payloads, configuration validation, redaction, a shell runner, a prompt runner, a serial dispatcher, and a per-session command-run tracker) and one adapter in `packages/pi-extension` that connects it to Pi. The adapter is the only code that knows Pi's event names.

**Decisions made by the maintainer during design (all recorded in PRD v1.0.2 to v1.0.4):**

- The first release is adapter-specific, with Pi as the proving harness. A runtime-owned wrapper is deferred.
- `command.start` fires from the runtime when the command's slash input is seen, so it never depends on the model and a start handler's block is enforced by the runtime. A command whose own prompt then rejects its arguments has already produced a start and ends as `failed`.
- A command's completion is signalled by a silent `ensemble_command_complete` tool that the model is told to call last. The instruction is injected per turn by the adapter, not generated into every Pi prompt, so projects without hooks see no change.
- A settled loop never ends a command. A command that never signals completion ends as `cancelled` when the session ends or the next command begins.
- A prompt handler is evaluated by an isolated headless child (`pi -p --no-session -ne -nt -np`), parsed against a typed response contract.
- No handler runs until the host reports the project as trusted (`ctx.isProjectTrusted()`) **and** the user has explicitly trusted this project's hooks. The Pi probe measured host trust as true by default in every mode, so it alone blocks nothing. The user's trust is recorded outside the repository against a digest of the hooks file and every handler file it names, and a change to any of them voids it.
- Cancellation is detected from `agent_settled.aborted === true`, not from an `aborted` outcome: the probe found that an abort fires no `agent_before_settle`. An error is detected from `agent_before_settle.outcome === "error"`.
- `on_error` is required on every handler. Default timeouts are 5 seconds for shell handlers and 30 seconds for prompt handlers.
- Selections list commands by name. Wildcards and groups are rejected.
- For harnesses with no adapter, the guide, a capability table and a status check say hooks are inactive. Nothing is shown at command time there.

**Why code and not a prompt (Constitution rule 8):** what runs at a command boundary, the trust check, the environment allowlist, redaction, timeouts and process cleanup are enforcement boundaries and must not be editable by a model or a user prompt. What a team wants to run (the hooks file, the executables, the prompt files) is user-owned and stays in files they edit without a toolchain.

## Domain Analysis

- **Lifecycle event:** `command.start` or `command.end`, one pair per actual command invocation, identified by a run ID.
- **Handler:** a named, reusable unit of type `shell` or `prompt`, defined in `.ensemble/hooks.yaml` and selected per command and event.
- **Adapter:** the harness-specific code that observes a command's boundaries and declares which capabilities it supports.
- **Command run:** the adapter's record of one in-flight command (run ID, command name, start time, whether it has ended).
- **Completion signal:** the model's call of `ensemble_command_complete`, carrying `succeeded` or `failed`.

## Reused Capabilities

| Capability | Where | Reuse |
| --- | --- | --- |
| Dispatcher keyword to target map | `packages/pi-extension/src/dispatcher-commands.ts` (`loadDispatchSubcommands`) | Resolves `/ensemble-prd create` to `ensemble:create-prd` (REQ-003) without a second map. |
| Extension entry point and bundle | `packages/pi-extension/src/extension.ts` (`activate`), `scripts/install.mjs` | The adapter is registered from `activate()` and ships in the same bundle. |
| Pi events and API | `input`, `before_agent_start`, `agent_before_settle`, `agent_settled`, `session_shutdown`, `registerTool`, `ctx.isProjectTrusted()`, `ctx.abort()` | Observed in Pi 1.2.0 typings; start, `completed`/`error` outcomes confirmed live (PRD probe evidence). |
| Existing test harness | `packages/agent-core/tests`, `packages/pi-extension/tests`, `scripts/smoke-activate.mjs` | New tests follow the same layout. |

### Reuse check: `pi-yaml-hooks`

Found after the first TRD draft, when the plan was already scaffolded. `pi-yaml-hooks` (third party, MIT, github.com/KristjanPikhof/pi-yaml-hooks, version 2026.9.26) is a YAML hook runner for Pi and OMP that is already installed in this repository owner's Pi settings. It overlaps this design in three places: YAML hook configuration, a trust gate (`/hooks-trust`) and bash actions that receive JSON on standard input. Its fixed events are `user.prompt.submit`, `tool.before.*`, `tool.after.*`, `file.changed`, `session.created`, `session.idle` and `session.deleted`.

**Decision: build the lifecycle here rather than layer on it.** Checked in its source and docs:

- It has no command start or end event, and no extension point for another package to add events. Its public surface is `registerHooksExtension(pi, profile)` plus type re-exports, its source says runtime internals stay private, and its `exports` map blocks deep imports. Layering would mean a fork or an upstream change.
- It never listens to the `input` event. Its `user.prompt.submit` sees only the already-expanded text, so a command's name is gone, and it "cannot rewrite or reject the prompt". REQ-002 (a start handler's block enforced by the runtime) and REQ-003 (resolving a dispatcher to its target) cannot be met through it.
- It serves Pi and OMP only, while this design keeps a harness-neutral core in `agent-core`.
- The two extensions register independently and can be installed together.

**What stays overlapping, on purpose:** a team may see two hook systems. They differ in scope (command lifecycle against sessions, tools and files), location (`.ensemble/hooks.yaml` in the project against `~/.pi/agent/hook/hooks.yaml` or a project hooks file) and trust (the host's project trust against its own `/hooks-trust`). TRD-014 keeps this status check from sharing a command name with it, and TRD-016 documents the difference.

## System Architecture

### Components and boundaries

```text
.ensemble/hooks.yaml  (user-owned: handlers, per-command start/end selection)
        |
        v   loadHooksConfig + validateHooksConfig            [agent-core]
   HooksConfig ---------------------------------------------+
        |                                                   |
Pi host events                                              |
 input ----------> resolveCommand ----> CommandRunTracker.begin ----> dispatch(start)  [adapter]
 before_agent_start  (inject completion instruction)                       |
 ensemble_command_complete (tool) -> tracker.complete                      v
 agent_before_settle (error/aborted) -> tracker.fail/cancel        runShellHandler / runPromptHandler
 agent_settled -------> dispatch(end)                               (redact payload first)
 session_shutdown ----> tracker.cancel + dispatch(end)
```

| Component | File | Responsibility |
| --- | --- | --- |
| Types and configuration | `packages/agent-core/src/lifecycle-hooks/types.ts`, `config.ts` | Types; load and validate `.ensemble/hooks.yaml`; apply default timeouts. |
| Payload and redaction | `packages/agent-core/src/lifecycle-hooks/payload.ts` | Build the event payload; redact before any handler sees it. |
| Shell runner | `packages/agent-core/src/lifecycle-hooks/shell-runner.ts` | Run an executable without a shell, with an environment allowlist, bounded output, a timeout and process-group cleanup. |
| Prompt runner | `packages/agent-core/src/lifecycle-hooks/prompt-runner.ts` | Build the prompt input and parse the response against the typed contract, using an injected evaluator. |
| Dispatcher | `packages/agent-core/src/lifecycle-hooks/dispatch.ts` | Run the selected handlers serially, apply `on_error`, collect per-handler outcomes. |
| Run tracker | `packages/agent-core/src/lifecycle-hooks/run-tracker.ts` | Exactly one end per run; supersede and shutdown rules. |
| Capabilities | `packages/agent-core/src/lifecycle-hooks/capabilities.ts` | The per-harness capability table. |
| Pi adapter | `packages/pi-extension/src/lifecycle/` | Event wiring, trust gate, completion tool, injection, user-visible results, headless prompt evaluator. |
| Status check | `packages/pi-extension/scripts/hooks-status.mjs` | Prints the capability table and whether the current project's hooks are active. |

### Interface contract

```ts
type Outcome = "succeeded" | "failed" | "cancelled";
interface LifecycleEvent { event: "command.start" | "command.end"; run_id: string; command: string;
  arguments: string; cwd: string; session_id: string; timestamp: string;
  outcome?: Outcome; duration_ms?: number; reason?: string; artifacts?: string[]; summary?: string; }
interface HandlerOutcome { handler: string; status: "succeeded" | "failed" | "timed_out" | "blocked";
  duration_ms: number; exit_code?: number; truncated?: boolean; message?: string; findings?: Finding[]; }
// Prompt handler response (typed contract)
interface PromptResponse { continue: boolean; message?: string; findings?: Finding[]; }
```

Configuration shape (a handler's `command` is an executable path, never a shell line; `args` is an array):

```yaml
version: 1
hooks:
  audit:   { type: shell,  command: ./scripts/audit.sh, args: [], timeout_ms: 5000, on_error: continue }
  review:  { type: prompt, prompt: ./prompts/review.md, timeout_ms: 30000, on_error: continue }
commands:
  ensemble:create-prd: { start: [audit], end: [review, audit] }
```

### Completion tool

`ensemble_command_complete({ outcome: "succeeded" | "failed", reason?: string, summary?: string, artifacts?: string[] })` is registered only when a hooks file exists. It marks the in-flight run complete and returns a short acknowledgement. It never runs a handler itself. End handlers run at `agent_settled`, after the command's final output.

### Integration points

- `packages/pi-extension/src/extension.ts`: `activate()` calls `registerLifecycleHooks(pi, repoRoot)` after the dispatcher registrations. With no `.ensemble/hooks.yaml` it registers nothing.
- `packages/agent-core/src/index.ts`: exports the lifecycle module.
- Root `package.json`: no new generator step. No generated command file changes.

## Probe results

Measured in a running Pi **1.2.0** (`/opt/homebrew/bin/pi`, which execs the Nix-built 1.2.0; model `litellm/qwen`) with a throwaway extension loaded by `pi -e <file> -ne` that logged every event with a millisecond timestamp. Modes: print (`pi -p --no-session`), RPC (`pi --mode rpc --no-session`, driven over JSON lines with `prompt` and `abort`), and the interactive TUI (driven through tmux). All four items below are **measured**. Every run listed completed; no run failed or was discarded. Where a count is given it is the number of separate Pi processes.

### 1. Abort: no `agent_before_settle` is emitted

- Runs: 10 aborted runs. Print mode, `ctx.abort()` called from `before_agent_start` +1.5 s while the model streamed: 3 runs. RPC `{"type":"abort"}` sent 1.5 s after `agent_start`, model streaming: 3 runs. RPC `abort` sent 1.5 s after `tool_execution_start` of a `bash` `sleep 60`: 3 runs. Interactive TUI, Escape pressed 2 s into a prompt: 1 run.
- Observed in all 10: `agent_before_settle` **never fired**, so no `outcome: aborted` (or any other outcome) was observed. The event order was `agent_end` then `agent_settled`. `agent_settled.aborted` was `true` in all 10.
- `agent_end.messages` last message: `stopReason: "aborted"` in the 7 runs that aborted during model streaming (print, RPC, TUI). In the 3 runs that aborted during the `bash` tool, the last message had `stopReason: "error"`; `agent_settled.aborted` was still `true`.
- Control, completed runs (print 1, RPC 1, TUI 2): order `agent_end`, `agent_before_settle` with `outcome: "completed"` (event keys `type, outcome, entries, continue, context`), `agent_settled` with `aborted: false`.
- RPC wire order on abort: `agent_end`, `agent_settled`, then the `abort` response (`success: true`), all within 5 ms of the abort request.
- Answer: an abort does **not** produce outcome `aborted`; it produces no `agent_before_settle` at all. The reliable cancel signal is `agent_settled` with `aborted: true`. The `error` outcome was not exercised in this probe.

### 2. Shutdown budget: the host waits, and no limit was reached

Every `session_shutdown` event carried `reason: "quit"`. The handler awaited timed sleeps and logged before and after each.

| Mode and exit trigger | Handler wait requested | Handler completed | Process exit |
|---|---|---|---|
| Print, normal end of run | 1, 2, 5, 10, 20 s in sequence (38 s total) | all five, 38.0 s | 0, immediately after the handler |
| Print, normal end of run | one 100 s wait | yes, 100.0 s | 0, 60 ms after the handler |
| RPC, stdin closed | 1, 2, 5, 10, 20 s (38 s total) | all five | 0, about 38 s after stdin closed |
| RPC, `SIGTERM` | 1, 2, 5, 10, 20 s (38 s total) | all five | 143, about 38 s after the signal |
| RPC, `SIGINT` | same | **handler never ran** (no `session_shutdown` logged) | killed by `SIGINT` within 10 ms |
| TUI, `/quit` | 1, 2, 5, 10 s (18 s total) | all four | exited |
| TUI, Ctrl+D | 1, 2, 5 s (8 s total) | all three | exited |
| TUI, Ctrl+C twice | 1, 2, 5 s (8 s total) | all three | exited |

- Runs: print 2, RPC 3, TUI 3.
- Longest wait that completed: **100 000 ms** (print mode). The upper bound was not found; the host showed no timeout up to that value. Not measured: waits above 100 s, `SIGHUP`, `SIGKILL` (cannot run a handler), and `SIGTERM` or `SIGINT` in print and TUI modes.
- Answer: the host awaits an async `session_shutdown` handler before exiting in every normal exit path measured. It does not run the handler when the process is killed by `SIGINT` in RPC mode.

### 3. Trust: `ctx.isProjectTrusted()` is `true` by default in every mode

| Mode | Directory | `session_start` | `input` |
|---|---|---|---|
| Print | this repo (has a `.pi` directory) | true | true |
| Print | fresh empty `/tmp` directory | true | true |
| RPC | this repo | true | true |
| RPC | fresh empty `/tmp` directory | true | true |
| TUI | this repo | true | true |
| TUI | fresh empty `/tmp` directory | true | true |

- Runs: 1 per row. Extra runs in print mode in this repo: with `--no-approve` it was `false` at both points; with `--approve` it was `true`.
- Answer: the default is `true` with no trust prompt appearing in any mode, and `false` only when the user passes `--no-approve`. Whether a repository with untrusted project-local extensions reaches `false` without a flag was not exercised.

### 4. Input forms: a skill arrives as `/skill:<name> <args>`

Template `probe-cmd.md` loaded with `--prompt-template`; skill directory `probe-skill/SKILL.md` loaded with `--skill`. Each was invoked with the arguments `hello world`. Runs: 1 per form in print, RPC and TUI (6 total); the raw text and prompt were identical in all three modes.

| Form | `input.text` (raw) | `before_agent_start.prompt` |
|---|---|---|
| Prompt template | `/probe-cmd hello world` | `Reply with the single word OK. Args: hello world` (the template body with `$ARGUMENTS` expanded; no command name) |
| Skill | `/skill:probe-skill hello world` | `<skill name="probe-skill" location="/tmp/pi-probe2/skills/probe-skill/SKILL.md">\nReferences are relative to /tmp/pi-probe2/skills/probe-skill.\n\n<SKILL.md body>\n</skill>\n\nhello world` |

- `input.source` was `"interactive"` in print mode and in the TUI, and `"rpc"` in RPC mode. The `input` event keys were `type, text, images, source, streamingBehavior`.
- Answer: TRD-008 must resolve two raw forms from `input.text`: `/<template-name> <args>` and `/skill:<skill-name> <args>`. The skill body is wrapped in a `<skill name=... location=...>` block in the prompt, so the prompt cannot be used to recover the command name. In this probe the skill directory name and its frontmatter `name` were the same, so which of the two `<skill-name>` uses was not distinguished.

## Master Task List

### PR 1: Lifecycle core in agent-core

**Shippable State:** A harness-neutral library validates a hooks file, builds redacted event payloads, runs shell and prompt handlers serially with the stated error behavior, and tracks command runs so each has exactly one end. It is not reachable from a harness yet, so it merges together with PR 2 as one stack (Constitution rule 6 is judged at the end of PR 2).

- [ ] **TRD-001** Probe Pi: an aborted run, the shutdown time budget and the trust check in a running host (throwaway extension outside the repository; results recorded in this TRD under "Probe results") [satisfies REQ-004] [satisfies REQ-021] [satisfies REQ-015] (2h)
  - Validates PRD ACs: AC-004-3, AC-004-4, AC-015-5, AC-021-3
  - Implementation AC:
    - [ ] Given a throwaway extension logging `agent_before_settle`, `agent_settled` and `session_shutdown` in an RPC or interactive Pi session, when a running command is aborted, then the recorded `outcome` and event order are written under "Probe results" with the Pi version
    - [ ] Given the same extension, when the session is shut down, then the time a `session_shutdown` handler can run before the host exits is measured and recorded
    - [ ] Given `ctx.isProjectTrusted()` read in print mode and in an interactive session, when each runs, then both values are recorded
    - [ ] Given the probe results, when TRD-014 declares capabilities, then `command_end_on_cancel` is `true` only if a reliable abort signal was observed in the probe (the signal need not be an `aborted` outcome; the probe measured `agent_settled.aborted === true` in 10 of 10 aborts)
    - [ ] Given a command available both as a prompt template and as a skill, when each is invoked in Pi, then the raw `input` text for each form is recorded under "Probe results", and TRD-008 resolves exactly the forms recorded there

- [ ] **TRD-002** Types and the configuration validator with default timeouts (`packages/agent-core/src/lifecycle-hooks/types.ts`, `config.ts`) [satisfies REQ-006] [satisfies REQ-007] [satisfies REQ-010] (4h)
  - Validates PRD ACs: AC-006-1, AC-006-2, AC-006-3, AC-006-4, AC-007-1, AC-007-2, AC-007-3, AC-007-5, AC-009-5, AC-010-3, AC-010-4, AC-011-5
  - Implementation AC:
    - [ ] Given a hooks file, when `loadHooksConfig(projectRoot)` runs, then it returns the validated configuration or a list of errors, each naming the handler or command and the offending field
    - [ ] Given a handler missing `type`, an event selection or `on_error`, an unknown handler reference, an unknown command name, a wildcard or group entry, an event name other than `start`/`end`, a non-positive `timeout_ms`, a missing handler file, or an unknown field, when validated, then each is rejected with a message naming the entry
    - [ ] Given an end handler with `on_error: block`, when validated, then it is rejected
    - [ ] Given a shell handler with no `timeout_ms`, when validated, then 5000 is applied; given a prompt handler with none, then 30000
    - [ ] Given a valid file, when validated, then the only output is a success value with no extra messages

- [ ] **TRD-002-TEST** Configuration validation behavior [Verifies TRD-002] [Satisfies REQ-007] [Depends: TRD-002] (3h)
  - Validates PRD ACs: AC-006-1, AC-006-2, AC-006-3, AC-006-4, AC-007-1, AC-007-2, AC-007-3, AC-007-5, AC-009-5, AC-010-3, AC-010-4, AC-011-5
  - Test AC:
    - [ ] Scenario: each invalid case -- Given one file per invalid case in TRD-002, When validated, Then each is rejected and the message contains the offending handler or command name
    - [ ] Scenario: defaults -- Given handlers without timeouts, When validated, Then shell gets 5000 and prompt gets 30000
    - [ ] Scenario: one definition many commands -- Given a handler named by two commands, When validated, Then one definition is used for both
    - [ ] Scenario: commands carry no hook wiring -- Given the command YAML sources, When read, Then none contains hook configuration

- [ ] **TRD-003** Event payload builder and redaction (`packages/agent-core/src/lifecycle-hooks/payload.ts`) [satisfies REQ-005] (3h) [Depends: TRD-002]
  - Validates PRD ACs: AC-005-1, AC-005-2, AC-005-3, AC-005-4
  - Implementation AC:
    - [ ] Given a start or end input, when the payload is built, then it carries `event`, `run_id`, `command`, `arguments`, `cwd`, `session_id` and `timestamp`, and an end adds `outcome`, `duration_ms` and, when given, `reason`, `artifacts` and `summary`
    - [ ] Given a value matching a documented secret pattern or a documented sensitive variable name, when the payload is built, then it is replaced by the fixed marker `[REDACTED]`, and no transcript field exists on the payload type
    - [ ] Given one payload, when it is serialized for a shell handler and for a prompt handler, then both serializations have identical fields and values

- [ ] **TRD-003-TEST** Payload and redaction behavior [Verifies TRD-003] [Satisfies REQ-005] [Depends: TRD-003] (2h)
  - Validates PRD ACs: AC-005-1, AC-005-2, AC-005-3, AC-005-4
  - Test AC:
    - [ ] Scenario: required fields -- Given a start and an end input, When built, Then every required field is present and typed
    - [ ] Scenario: redaction -- Given arguments containing a documented secret pattern, When built, Then the value is `[REDACTED]`
    - [ ] Scenario: no transcript -- Given a payload, When its keys are listed, Then none carries a transcript
    - [ ] Scenario: identical delivery -- Given one payload, When serialized twice, Then the two are equal

- [ ] **TRD-004** Shell handler runner (`packages/agent-core/src/lifecycle-hooks/shell-runner.ts`) [satisfies REQ-009] [Depends: TRD-002] (5h)
  - Validates PRD ACs: AC-009-1, AC-009-2, AC-009-3, AC-009-4, AC-009-5, AC-009-6
  - Implementation AC:
    - [ ] Given a shell handler, when run, then the executable is started with an argument array and no shell, and the event JSON is written to its standard input
    - [ ] Given arguments containing shell metacharacters, when run, then they reach the executable unchanged and are never interpreted
    - [ ] Given a documented environment allowlist, when the handler starts, then it sees only the allowlisted variables
    - [ ] Given output beyond the documented bound, when the handler runs, then the output is truncated at the bound and the outcome says it was truncated
    - [ ] Given a handler exceeding its timeout, when the timeout elapses, then the handler and every process it started are terminated and the outcome is `timed_out`
    - [ ] Given an exit status of zero or nonzero, when the handler finishes, then the outcome is `succeeded` or `failed` with the exit code

- [ ] **TRD-004-TEST** Shell runner behavior [Verifies TRD-004] [Satisfies REQ-009] [Depends: TRD-004] (4h)
  - Validates PRD ACs: AC-009-1, AC-009-2, AC-009-3, AC-009-4, AC-009-5, AC-009-6
  - Test AC:
    - [ ] Scenario: input delivery -- Given a fixture executable that echoes standard input, When run, Then it received the exact event JSON
    - [ ] Scenario: metacharacters inert -- Given arguments `; touch marker`, When run, Then no marker file appears
    - [ ] Scenario: environment allowlist -- Given a secret variable in the parent environment, When the fixture prints its environment, Then the variable is absent
    - [ ] Scenario: output bound -- Given a fixture that prints more than the bound, When run, Then the outcome is truncated
    - [ ] Scenario: timeout kills the tree -- Given a fixture that spawns a child and sleeps, When the timeout elapses, Then neither process is alive afterwards
    - [ ] Scenario: exit codes -- Given exit 0 and exit 3, When run, Then outcomes are `succeeded` and `failed` with code 3

- [ ] **TRD-005** Prompt handler runner and the typed response contract (`packages/agent-core/src/lifecycle-hooks/prompt-runner.ts`) [satisfies REQ-011] [Depends: TRD-002] (3h)
  - Validates PRD ACs: AC-011-1, AC-011-2, AC-011-3, AC-011-4, AC-011-5
  - Implementation AC:
    - [ ] Given a prompt handler and an injected evaluator, when run, then the prompt file's contents and the event JSON are passed to the evaluator with the handler's timeout
    - [ ] Given a response, when parsed, then only `{ continue, message?, findings? }` is accepted
    - [ ] Given a malformed or non-conforming response, when parsed, then the outcome is `failed` and the response is never treated as `continue`
    - [ ] Given a response with findings, when returned, then the findings are reported and the runner has no means to edit an artifact

- [ ] **TRD-005-TEST** Prompt runner behavior [Verifies TRD-005] [Satisfies REQ-011] [Depends: TRD-005] (2h)
  - Validates PRD ACs: AC-011-1, AC-011-2, AC-011-3, AC-011-4, AC-011-5
  - Test AC:
    - [ ] Scenario: input -- Given a fake evaluator, When run, Then it receives the prompt text and the event JSON
    - [ ] Scenario: valid response -- Given `{"continue":true}`, When parsed, Then the outcome is `succeeded`
    - [ ] Scenario: malformed response -- Given prose or an object with extra fields, When parsed, Then the outcome is `failed`
    - [ ] Scenario: default timeout -- Given a prompt handler with no timeout, When run, Then the evaluator is given 30000

- [ ] **TRD-006** Serial dispatcher with the error policy (`packages/agent-core/src/lifecycle-hooks/dispatch.ts`) [satisfies REQ-010] [satisfies REQ-012] [satisfies REQ-013] [satisfies REQ-020] [Depends: TRD-004] [Depends: TRD-005] (3h)
  - Validates PRD ACs: AC-010-1, AC-010-2, AC-012-1, AC-012-2, AC-012-3, AC-013-1, AC-013-2, AC-020-1, AC-020-2
  - Implementation AC:
    - [ ] Given several handlers selected for an event, when dispatched, then they run one at a time in configured order
    - [ ] Given a handler fails with `continue`, when the next is due, then it still runs and the command outcome is untouched
    - [ ] Given a start handler fails with `block`, when it fails, then later start handlers do not run and the result is `blocked` and names the handler
    - [ ] Given the dispatch result, when read, then every handler has a status (succeeded, failed, timed out or blocked) and a duration
    - [ ] Given a failure, when recorded, then nothing retries, schedules or recovers it, and no dispatcher competing with Foreman is added

- [ ] **TRD-006-TEST** Dispatcher behavior [Verifies TRD-006] [Satisfies REQ-012] [Depends: TRD-006] (2h)
  - Validates PRD ACs: AC-010-1, AC-010-2, AC-012-1, AC-012-2, AC-012-3, AC-013-1, AC-013-2, AC-020-1, AC-020-2
  - Test AC:
    - [ ] Scenario: order -- Given three fake handlers, When dispatched, Then they ran in configured order and never overlapped
    - [ ] Scenario: continue -- Given the first fails with `continue`, When dispatched, Then the second ran
    - [ ] Scenario: block -- Given a start handler fails with `block`, When dispatched, Then later handlers did not run
    - [ ] Scenario: no retry -- Given a failing handler, When dispatched, Then it ran exactly once

- [ ] **TRD-007** Command run tracker (`packages/agent-core/src/lifecycle-hooks/run-tracker.ts`) [satisfies REQ-001] [satisfies REQ-004] [satisfies REQ-021] [Depends: TRD-002] (4h)
  - Validates PRD ACs: AC-001-1, AC-001-2, AC-001-3, AC-004-1, AC-004-2, AC-004-5, AC-021-2, AC-021-3, AC-021-4, AC-021-5, AC-021-6, AC-021-7
  - Implementation AC:
    - [ ] Given a command begins, when `begin` is called, then it returns a run ID that no other run in the session has and records one in-flight run
    - [ ] Given an in-flight run, when it is completed, failed or cancelled more than once, then exactly one end is produced
    - [ ] Given a loop settles with no completion, when asked, then the run is still in flight and no end is produced
    - [ ] Given a run is in flight, when a new command begins or the session shuts down, then the run ends as `cancelled` with a reason naming the missing completion signal
    - [ ] Given a run whose start handler blocked, when it is ended, then the end carries `failed` and a reason naming the block
    - [ ] Given a completion with `failed` and a reason, when ended, then the end carries that outcome and reason

- [ ] **TRD-007-TEST** Run tracker behavior [Verifies TRD-007] [Satisfies REQ-001] [Depends: TRD-007] (3h)
  - Validates PRD ACs: AC-001-1, AC-001-2, AC-001-3, AC-004-1, AC-004-2, AC-004-5, AC-021-2, AC-021-3, AC-021-4, AC-021-5, AC-021-6, AC-021-7
  - Test AC:
    - [ ] Scenario: unique ids -- Given two runs in one session, When begun, Then their ids differ
    - [ ] Scenario: exactly one end -- Given complete then complete again, When ended, Then one end exists
    - [ ] Scenario: settle is not an end -- Given a settle without completion, When asked, Then no end exists
    - [ ] Scenario: supersede -- Given a run in flight, When another begins, Then the first ended as `cancelled` and the reason names the missing signal
    - [ ] Scenario: never succeeded by inference -- Given a run that never signalled completion, When the session ends, Then the end is `cancelled`, never `succeeded`

- [ ] **TRD-019** Trust store: a digest of the hooks file and its handler files, and the user-level trust record (`packages/agent-core/src/lifecycle-hooks/trust-store.ts`) [satisfies REQ-022] [Depends: TRD-002] (4h)
  - Validates PRD ACs: AC-022-5, AC-022-6, AC-022-7, AC-022-8
  - Implementation AC:
    - [ ] Given a project root and its valid hooks configuration, when a trust digest is computed, then it covers the hooks file's content and the content of every handler file the configuration names that lies inside the project (an executable path containing a slash, and each prompt file), each identified by its relative path and a SHA-256 of its content, in a stable order
    - [ ] Given a trust record, when trust is recorded for a project, then an entry keyed by the project's real path holds the digest, in a store under the user's home directory (outside any repository), written atomically with owner-only permissions
    - [ ] Given a stored digest, when trust is checked, then it is trusted only if the stored digest equals the current one, so a change to the hooks file or to any named handler file makes it untrusted; an unknown project, a missing store or a corrupted store is untrusted and never throws
    - [ ] Given a repository that contains a file shaped like the trust store, when trust is checked, then that file is never read
    - [ ] Given a valid configuration, when the confirmation text is built, then it lists every handler with its exact executable and arguments, or its prompt file, in configured order

- [ ] **TRD-019-TEST** Trust store behavior [Verifies TRD-019] [Satisfies REQ-022] [Depends: TRD-019] (3h)
  - Validates PRD ACs: AC-022-5, AC-022-6, AC-022-7, AC-022-8
  - Test AC:
    - [ ] Scenario: digest sensitivity -- Given a trusted project, When the hooks file, a named shell script or a named prompt file is edited, Then trust is false for each
    - [ ] Scenario: digest ignores the unrelated -- Given a trusted project, When an unrelated file changes, Then trust is still true
    - [ ] Scenario: record round trip -- Given a temporary home directory, When trust is recorded and checked, Then it is true, and the store file is outside the project and has owner-only permissions
    - [ ] Scenario: real path key -- Given a symlink to the project, When trust is checked through it, Then it matches the real path's record
    - [ ] Scenario: repository cannot grant trust -- Given a project containing a file named like the store with a matching digest, When trust is checked, Then it is false
    - [ ] Scenario: bad store -- Given a corrupted or empty store, When trust is checked, Then it is false and nothing throws
    - [ ] Scenario: confirmation text -- Given a configuration, When the text is built, Then it names each handler's exact command and arguments or prompt file
### PR 2: Pi adapter and the entry-point proof

**Shippable State:** In a Pi project with a valid, trusted `.ensemble/hooks.yaml`, a command's start handlers run before its workflow, a start handler can block it, the model is given the completion instruction, and exactly one set of end handlers runs per command. A project with no hooks file is unchanged. The capability table and a status check say what Pi supports.

- [ ] **TRD-008** Resolve a slash input to a concrete command (`packages/pi-extension/src/lifecycle/resolve-command.ts`) [satisfies REQ-003] [Depends: TRD-002] (2h)
  - Validates PRD ACs: AC-003-1, AC-003-2
  - Implementation AC:
    - [ ] Given the input `/ensemble-create-prd foo`, when resolved, then the command is `ensemble:create-prd` and the rest is its arguments
    - [ ] Given a dispatcher input such as `/ensemble-prd create foo`, when resolved, then it uses the dispatcher keyword map to return the target `ensemble:create-prd`, not the dispatcher; the map is embedded, because the dispatcher YAML exists only inside this repository, and a drift test compares it to that YAML
    - [ ] Given an input that is not a slash command or names no known dispatcher keyword, when resolved, then it returns no command
    - [ ] Given the skill form `/skill:ensemble-create-prd foo` (measured in the probe), when resolved, then it returns the same command name and arguments as the prompt-template form

- [ ] **TRD-008-TEST** Command resolution behavior [Verifies TRD-008] [Satisfies REQ-003] [Depends: TRD-008] (1h)
  - Validates PRD ACs: AC-003-1, AC-003-2
  - Test AC:
    - [ ] Scenario: direct -- Given `/ensemble-refine-prd x`, When resolved, Then `ensemble:refine-prd`
    - [ ] Scenario: dispatcher -- Given `/ensemble-prd create x`, When resolved, Then the target, never `ensemble:prd`
    - [ ] Scenario: dispatcher-only hook -- Given a hook configured for `ensemble:prd` only, When `/ensemble-prd create x` runs, Then no handler is selected
    - [ ] Scenario: skill form -- Given `/skill:ensemble-refine-prd x`, When resolved, Then it returns the same command as `/ensemble-refine-prd x`

- [ ] **TRD-009** Adapter core: inert without a hooks file, validation errors, the two-condition trust gate and the trust command (`packages/pi-extension/src/lifecycle/adapter.ts`, `packages/pi-extension/src/extension.ts`) [satisfies REQ-006] [satisfies REQ-008] [satisfies REQ-022] [satisfies REQ-009] [Depends: TRD-002] [Depends: TRD-003] [Depends: TRD-008] [Depends: TRD-019] (5h)
  - Validates PRD ACs: AC-006-1, AC-007-4, AC-008-1, AC-008-2, AC-009-7, AC-022-1, AC-022-2, AC-022-3, AC-022-4, AC-022-5, AC-022-6, AC-022-7, AC-022-8
  - Implementation AC:
    - [ ] Given no `.ensemble/hooks.yaml`, when `activate()` runs, then nothing is registered and no output is produced
    - [ ] Given a hooks file for command A only, when command B runs, then no handler runs and no extra output appears
    - [ ] Given an invalid hooks file, when a command runs, then no handler runs and the user sees the validation errors
    - [ ] Given `ctx.isProjectTrusted()` is false, when a selected command runs, then no handler runs and a warning names the hooks file and how trust is granted; the file may still be validated
    - [ ] Given a harness context with no trust decision, when a selected command runs, then no handler runs and the user is told why
    - [ ] Given the host trusts the project but no trust record matches the current digest (none exists, or the hooks file or a handler file it names changed), when a selected command runs, then no handler runs and a warning names the hooks file and says to run `/ensemble-lifecycle-trust`
    - [ ] Given `/ensemble-lifecycle-trust` is run in a project with a valid hooks file and an interactive UI, when it runs, then it shows every handler's exact executable and arguments or prompt file and records trust only after the user confirms
    - [ ] Given no interactive UI, when `/ensemble-lifecycle-trust` is run, then it refuses and records nothing
    - [ ] Given the validation of a hooks file that names commands, when the configuration is loaded, then the adapter supplies the set of known commands (from the slash commands the host reports) so a hook for a command that does not exist is rejected
    - [ ] Given the commands the adapter registers, when they are listed, then the trust command is named `ensemble-lifecycle-trust` (no `hooks-` prefix) and no tool the model can call can grant trust
    - [ ] Given the model's own output or tool calls, when a command runs, then no tool parameter or text can name a handler or executable to run

- [ ] **TRD-009-TEST** Adapter inertness and trust behavior [Verifies TRD-009] [Satisfies REQ-022] [Depends: TRD-009] (3h)
  - Validates PRD ACs: AC-006-1, AC-007-4, AC-008-1, AC-008-2, AC-009-7, AC-022-1, AC-022-2, AC-022-3, AC-022-4, AC-022-5, AC-022-6, AC-022-7, AC-022-8
  - Test AC:
    - [ ] Scenario: inert -- Given a project with no hooks file, When `activate(fakePi)` runs, Then no handler and no tool is registered
    - [ ] Scenario: host untrusted -- Given a hooks file and `isProjectTrusted() === false`, When a selected command's input arrives, Then no executable runs
    - [ ] Scenario: host trusted but not user-trusted -- Given the same file, trust true and no record, When it arrives, Then no executable runs and the warning names `/ensemble-lifecycle-trust`
    - [ ] Scenario: both trusted -- Given the record exists for the current digest, When it arrives, Then the start handler runs
    - [ ] Scenario: edit voids trust -- Given a trusted project, When the hooks file is edited, Then the next command runs no handler
    - [ ] Scenario: trust command confirms -- Given a UI that declines, When `/ensemble-lifecycle-trust` runs, Then nothing is recorded; given one that confirms, Then trust is recorded
    - [ ] Scenario: no UI -- Given no interactive UI, When the trust command runs, Then it refuses
    - [ ] Scenario: no collision -- Given `activate(fakePi)` with a hooks file, When the registered commands are listed, Then none starts with `hooks-` and the trust command is `ensemble-lifecycle-trust`
    - [ ] Scenario: model cannot start handlers -- Given the completion tool's parameter schema, When read, Then it has no field that names a handler or executable

- [ ] **TRD-010** Start path: input to start handlers, with runtime-enforced block (`packages/pi-extension/src/lifecycle/adapter.ts`) [satisfies REQ-001] [satisfies REQ-002] [satisfies REQ-004] [Depends: TRD-006] [Depends: TRD-007] [Depends: TRD-008] [Depends: TRD-009] (3h)
  - Validates PRD ACs: AC-001-1, AC-002-1, AC-002-2, AC-002-3, AC-004-5
  - Implementation AC:
    - [ ] Given a resolved, selected, trusted command, when its `input` arrives, then the run begins and the start handlers run before the command's prompt reaches the model
    - [ ] Given a run begins, when its payload is built, then `session_id` is the host session's id, or a generated per-process id when the session is ephemeral
    - [ ] Given a start handler blocks, when it blocks, then the input is marked handled so the workflow never begins, the user is told which handler blocked, and the run ends as `failed` naming the block
    - [ ] Given a command whose own prompt later rejects its arguments, when it signals completion as `failed`, then the run that already started ends as `failed` with that reason
    - [ ] Given an input that is plain text answering a pending question, when it arrives, then it neither begins nor supersedes a run

- [ ] **TRD-010-TEST** Start path behavior [Verifies TRD-010] [Satisfies REQ-002] [Depends: TRD-010] (2h)
  - Validates PRD ACs: AC-001-1, AC-002-1, AC-002-2, AC-002-3, AC-004-5
  - Test AC:
    - [ ] Scenario: start before workflow -- Given a selected command, When its input arrives, Then the start handler ran before the handler returns `continue`
    - [ ] Scenario: block is enforced -- Given a blocking start handler, When the input arrives, Then the handler returns `handled`
    - [ ] Scenario: rejected arguments -- Given a started run, When the model completes it as `failed`, Then the end carries `failed`
    - [ ] Scenario: plain-text reply -- Given a run in flight, When a non-slash input arrives, Then the run is unchanged

- [ ] **TRD-011** Completion tool and per-turn injection (`packages/pi-extension/src/lifecycle/completion.ts`) [satisfies REQ-021] [Depends: TRD-007] [Depends: TRD-009] (3h)
  - Validates PRD ACs: AC-021-1, AC-021-2, AC-021-6, AC-021-7
  - Implementation AC:
    - [ ] Given a hooks file exists, when `activate()` runs, then `ensemble_command_complete` is registered with parameters `outcome`, `reason`, `summary` and `artifacts` and its execute only marks the run and returns an acknowledgement
    - [ ] Given a run is in flight, when `before_agent_start` fires, then the same completion instruction is appended to that turn's system prompt, and nothing is injected when no run is in flight or no hooks file exists
    - [ ] Given the tool is called twice, when the second call arrives, then exactly one end results
    - [ ] Given the generated Pi prompts, when the feature ships, then none contains a hook, handler or completion step

- [ ] **TRD-011-TEST** Completion tool and injection behavior [Verifies TRD-011] [Satisfies REQ-021] [Depends: TRD-011] (2h)
  - Validates PRD ACs: AC-021-1, AC-021-2, AC-021-6, AC-021-7
  - Test AC:
    - [ ] Scenario: same instruction -- Given two different commands in flight in turn, When `before_agent_start` fires for each, Then the appended instruction is identical
    - [ ] Scenario: no injection -- Given no run in flight, When `before_agent_start` fires, Then the system prompt is unchanged
    - [ ] Scenario: failed completion -- Given a call with `failed` and a reason, When ended, Then the end carries both
    - [ ] Scenario: generated prompts untouched -- Given `packages/pi/prompts`, When searched, Then no completion step or hook text appears

- [ ] **TRD-012** End path: settle outcomes, supersede, shutdown, visible results (`packages/pi-extension/src/lifecycle/adapter.ts`) [satisfies REQ-004] [satisfies REQ-013] [satisfies REQ-021] [Depends: TRD-001] [Depends: TRD-006] [Depends: TRD-007] [Depends: TRD-010] [Depends: TRD-011] (4h)
  - Validates PRD ACs: AC-004-1, AC-004-2, AC-004-3, AC-004-4, AC-013-1, AC-013-2, AC-021-3, AC-021-4, AC-021-5
  - Implementation AC:
    - [ ] Given `agent_before_settle` reports `error`, when the loop settles, then the run ends as `failed`; given `agent_settled` reports `aborted: true` (an abort fires no `agent_before_settle`, measured), then `cancelled`; given `completed` with no completion signal, then the run stays in flight
    - [ ] Given a run has ended, when `agent_settled` fires, then the end handlers run once, serially, after the command's final output
    - [ ] Given a run is in flight, when the session shuts down or a new selected command's input arrives, then it ends as `cancelled` with a reason naming the missing completion signal, and its end handlers run within the shutdown bound (the sum of their timeouts, capped at 60000 ms; the host awaited shutdown handlers for at least 100000 ms in every normal exit it measured)
    - [ ] Given any handler ran, when the event finishes, then the user sees each handler's status and duration, and a failed `continue` handler is shown as a handler failure, not a command failure
    - [ ] Given `agent_settled` reports `aborted: false`, when a loop settles, then no `cancelled` outcome is produced
    - [ ] Given the end handlers cannot all finish within the shutdown bound, when a run ends at shutdown, then those that cannot finish are skipped and the user is told they were skipped, never silently; the adapter also states that a process killed by `SIGINT` in RPC mode runs no handler, as measured

- [ ] **TRD-012-TEST** End path behavior [Verifies TRD-012] [Satisfies REQ-004] [Depends: TRD-012] (3h)
  - Validates PRD ACs: AC-004-1, AC-004-2, AC-004-3, AC-004-4, AC-013-1, AC-013-2, AC-021-3, AC-021-4, AC-021-5
  - Test AC:
    - [ ] Scenario: error and abort -- Given `agent_before_settle` with `error`, then an abort that fires only `agent_settled` with `aborted: true`, When settled, Then the ends are `failed` and `cancelled`
    - [ ] Scenario: completed without signal -- Given `completed` and no completion call, When settled, Then no end handler ran
    - [ ] Scenario: end after output -- Given a completion call, When `agent_settled` fires, Then end handlers ran once
    - [ ] Scenario: shutdown and supersede -- Given a run in flight, When shutdown or another command arrives, Then the end is `cancelled` naming the missing signal
    - [ ] Scenario: start failure does not suppress end -- Given a failing start handler with `continue`, When the command completes, Then the end handlers still ran
    - [ ] Scenario: unusable shutdown budget -- Given a shutdown budget shorter than the handlers' timeouts, When a run ends at shutdown, Then the end handlers are skipped and the user is told they were skipped

- [ ] **TRD-013** Headless prompt-handler evaluator (`packages/pi-extension/src/lifecycle/prompt-evaluator.ts`) [satisfies REQ-011] [Depends: TRD-005] (3h)
  - Validates PRD ACs: AC-011-1, AC-011-4
  - Implementation AC:
    - [ ] Given a prompt handler, when evaluated, then a child `pi -p --no-session -ne -nt -np` is run with the prompt and the event JSON and its standard output is returned to the prompt runner
    - [ ] Given the child exceeds the handler's timeout, when the timeout elapses, then the child and its process group are terminated
    - [ ] Given the child, when it runs, then it has no tools and no extensions, so it cannot edit an artifact or fire a lifecycle event of its own

- [ ] **TRD-013-TEST** Evaluator behavior [Verifies TRD-013] [Satisfies REQ-011] [Depends: TRD-013] (2h)
  - Validates PRD ACs: AC-011-1, AC-011-4
  - Test AC:
    - [ ] Scenario: arguments -- Given a fake `pi` on the path, When evaluated, Then it was started with `-p --no-session -ne -nt -np`
    - [ ] Scenario: timeout -- Given a fake `pi` that sleeps, When the timeout elapses, Then it is no longer alive
    - [ ] Scenario: output returned -- Given a fake `pi` printing JSON, When evaluated, Then the runner receives that text

- [ ] **TRD-014** Capability table, unsupported-hook warning and the status check (`packages/agent-core/src/lifecycle-hooks/capabilities.ts`, `packages/pi-extension/scripts/hooks-status.mjs`) [satisfies REQ-014] [satisfies REQ-017] [Depends: TRD-001] [Depends: TRD-009] (3h)
  - Validates PRD ACs: AC-014-1, AC-014-2, AC-014-3, AC-014-4, AC-015-5, AC-017-1, AC-017-2
  - Implementation AC:
    - [ ] Given the capability table, when read, then it states for Pi `command_start` true, `command_end` true and `command_end_on_cancel` true (detected through `agent_settled.aborted`, measured 10 of 10), and `false` for all three for Claude Code, Codex and OpenCode
    - [ ] Given Pi's end definition, when declared, then it states that a command ends at the completion signal, an error outcome, an abort signal, the next command, or session shutdown
    - [ ] Given a configured hook for a capability the active harness does not support, when the configuration loads, then the user sees a warning naming the hook and the capability, and the command runs
    - [ ] Given the status check is run, when no command runs, then it prints the table and whether the current project's hooks are active, and says hooks are inactive in harnesses with no adapter
    - [ ] Given the status check, when implemented, then it is a script and no slash command named `/hooks-status`, `/hooks-validate` or any other `/hooks-*` is registered, so it cannot collide with the same-named commands of `pi-yaml-hooks`

- [ ] **TRD-014-TEST** Capability and status behavior [Verifies TRD-014] [Satisfies REQ-014] [Depends: TRD-014] (2h)
  - Validates PRD ACs: AC-014-1, AC-014-2, AC-014-3, AC-014-4, AC-015-5, AC-017-1, AC-017-2
  - Test AC:
    - [ ] Scenario: table complete -- Given the table, When read, Then every harness states all three capabilities and the three adapter-less harnesses are all `false`
    - [ ] Scenario: warning not silent -- Given a hook that needs an unsupported capability, When loaded, Then a warning names it
    - [ ] Scenario: status without a command -- Given the status script, When run in a project, Then it prints the table and the activity of the project's hooks
    - [ ] Scenario: no command-name collision -- Given `activate(fakePi)` with a hooks file, When the registered commands are listed, Then none starts with `hooks-`

- [ ] **TRD-015** Entry-point integration test through `activate()` and the bundled build, with an opt-in live smoke (`packages/pi-extension/tests/lifecycle-entrypoint.test.ts`, `packages/pi-extension/scripts/smoke-lifecycle.mjs`) [satisfies REQ-015] [satisfies REQ-019] [Depends: TRD-010] [Depends: TRD-011] [Depends: TRD-012] [Depends: TRD-013] [Depends: TRD-014] (5h)
  - Validates PRD ACs: AC-015-1, AC-015-2, AC-015-3, AC-015-4, AC-019-3
  - Implementation AC:
    - [ ] Given a fake Pi host, when `activate(fakePi)` is called with a hooks file and the host events are replayed (input, before_agent_start, the completion tool, settle), then start handlers ran before the workflow and one set of end handlers ran after it
    - [ ] Given a dispatcher input, when replayed, then the lifecycle fired once for the target
    - [ ] Given a handler that exceeds its timeout and a start handler with `block`, when replayed, then the stated behavior occurs
    - [ ] Given the bundled extension built by `scripts/install.mjs`, when the extension loads, then `activate` succeeds with agent-core imported into the bundle
    - [ ] Given a working model, when `smoke-lifecycle.mjs` runs `pi -p` against a command with a shell hook that appends to a file, then the file shows the start and the end in order (opt-in, skipped when no model is available)

### PR 3: Guide, documentation and verification

**Shippable State:** The guide documents the events, payload, file, handlers, semantics and a per-harness capability table that a test keeps in step with the code; the changelog and README mention the feature; and the guards have been shown capable of failing.

- [ ] **TRD-016** Guide with capability table and validated examples (`docs/guides/command-lifecycle-hooks.md`) [satisfies REQ-018] [satisfies REQ-016] [satisfies REQ-005] [Depends: TRD-014] [Depends: TRD-015] (3h)
  - Validates PRD ACs: AC-005-3, AC-016-1, AC-016-2, AC-018-1, AC-018-2
  - Implementation AC:
    - [ ] Given the guide, when read, then it documents the two events, the payload, the hooks file, both handler types, exit and error semantics, the redaction patterns and sensitive variable names, the default timeouts and output bound, and a per-harness capability table
    - [ ] Given any best-effort path the guide mentions, when read, then it is labelled best-effort and never described as deterministic shell-hook execution
    - [ ] Given each YAML example in the guide, when run through the validator, then it validates
    - [ ] Given the guide, when read, then it states how lifecycle hooks differ from `pi-yaml-hooks` in scope, file location, trust and blocking, and says both can be installed together

- [ ] **TRD-016-TEST** Guide stays true [Verifies TRD-016] [Satisfies REQ-018] [Depends: TRD-016] (1h)
  - Validates PRD ACs: AC-016-1, AC-016-2, AC-018-1, AC-018-2
  - Test AC:
    - [ ] Scenario: examples validate -- Given the guide's YAML blocks, When validated, Then none is rejected
    - [ ] Scenario: table matches code -- Given the guide's capability table and the capability constants, When compared, Then they agree
    - [ ] Scenario: no overclaim -- Given the guide, When searched, Then a best-effort path never appears next to the word deterministic
    - [ ] Scenario: relationship stated -- Given the guide, When searched, Then it names `pi-yaml-hooks` and says how the two differ

- [ ] **TRD-017** Changelog and README entries (`packages/pi-extension/README.md`, `packages/development/CHANGELOG.md`) [satisfies REQ-018] [Depends: TRD-015] (1h)
  - Validates PRD ACs: AC-018-1
  - Implementation AC:
    - [ ] Given the changelog and README, when read, then they describe lifecycle hooks, say Pi is the only supported harness, and point to the guide

- [ ] **TRD-018** Mutation proof and repository gates [satisfies REQ-019] [satisfies REQ-008] [satisfies REQ-020] [Depends: TRD-015] [Depends: TRD-016] [Depends: TRD-017] (2h)
  - Validates PRD ACs: AC-008-3, AC-019-1, AC-019-2, AC-020-2
  - Implementation AC:
    - [ ] Given each guard (trust check, block enforcement, one-end rule, redaction, no-shell execution, validation), when it is deliberately broken on disk, then at least one named test fails, and each file is restored byte-identical
    - [ ] Given the existing command definitions, when the feature ships, then no `packages/*/commands/*.yaml` and no generated command file changed
    - [ ] Given the repository gates, when run, then `npm run validate`, `npm run generate:validate` and the `agent-core`, `pi-extension` and `development` suites pass
    - [ ] Given the diff, when reviewed, then it adds no scheduler, retry or competing dispatcher

## Sprint Planning

### Sprint 1: Core and probe (PR 1)

TRD-001 to TRD-007 and TRD-019 with their test tasks. TRD-001 ran first; its measurements set a capability and corrected TRD-012 (see Probe results).

### Sprint 2: Pi adapter (PR 2)

TRD-008 to TRD-015.

### Sprint 3: Documentation and verification (PR 3)

TRD-016 to TRD-018.

## Dependency Mapping and PR Boundary Design

PR 1 has no dependency on PR 2 or PR 3. PR 2 depends on PR 1. PR 3 depends on PR 2. PR 1 and PR 2 merge as one stack because the capability is reachable only after PR 2 (Constitution rule 6).

**Critical path:** TRD-002 -> TRD-019 -> TRD-009 -> TRD-010 -> TRD-012 -> TRD-015 -> TRD-016 -> TRD-018, about 30 hours of 97 hours total (4 + 4 + 5 + 3 + 4 + 5 + 3 + 2). Every arrow is a `Depends:` edge in the task list: TRD-019 depends on TRD-002; TRD-009 on TRD-019; TRD-010 on TRD-009; TRD-012 on TRD-010; TRD-015 on TRD-012; TRD-016 on TRD-015; TRD-018 on TRD-016. The trust store replaced the shell runner as the longest route into TRD-010. TRD-001 (the probe) is complete and not on the path.

## Acceptance Criteria Traceability

| REQ | Tasks |
| --- | --- |
| REQ-001 | TRD-007, TRD-010 |
| REQ-002 | TRD-010 |
| REQ-003 | TRD-008 |
| REQ-004 | TRD-001, TRD-007, TRD-010, TRD-012 |
| REQ-005 | TRD-003, TRD-016 |
| REQ-006 | TRD-002, TRD-009 |
| REQ-007 | TRD-002, TRD-009 |
| REQ-008 | TRD-009, TRD-018 |
| REQ-009 | TRD-004, TRD-009 |
| REQ-010 | TRD-002, TRD-006 |
| REQ-011 | TRD-005, TRD-013 |
| REQ-012 | TRD-006 |
| REQ-013 | TRD-006, TRD-012 |
| REQ-014 | TRD-014 |
| REQ-015 | TRD-001, TRD-014, TRD-015 |
| REQ-016 | TRD-016 |
| REQ-017 | TRD-014 |
| REQ-018 | TRD-016, TRD-017 |
| REQ-019 | TRD-015, TRD-018 |
| REQ-020 | TRD-006, TRD-018 |
| REQ-021 | TRD-001, TRD-007, TRD-011, TRD-012 |
| REQ-022 | TRD-009, TRD-019 |

## Traceability Validation

Checked by running the repository's TRD parser (`trd-cli.js parse`) and a script over the PRD and this document:

- The parser reports `ok` with 0 warnings and 34 tasks, every one with acceptance-criteria items and an hour estimate; there are 52 dependency edges and none points at a missing task.
- All 22 PRD requirements have at least one `[satisfies REQ-NNN]` task, and all 85 PRD acceptance criteria are cited by at least one task. No task cites an acceptance criterion the PRD does not have.
- No task depends on a task that does not exist.

## Adversarial Review and Design Gate

### Architecture issues and resolutions

1. **Model-dependent completion.** The model may skip `ensemble_command_complete`. Resolution: the end is never inferred as `succeeded`. It becomes `cancelled` with a reason naming the missing signal (AC-021-5), so an audit log never records a false success, only an honest unknown.
2. **Plain-text questions.** A pause to ask the user settles the loop. Resolution: a settle never ends a command (PRD amendment 1.0.3). Plain-text input never supersedes a run; only a new selected command's input does.
3. **Shutdown budget.** End handlers at `session_shutdown` may exceed what the host allows. Resolution: TRD-001 measures the budget and TRD-012 caps end handlers to it. If the budget is unusable, the end handlers for a shutdown-ended run are skipped and the user is told, never silently.
4. **Bundle resolution.** The host resolves the extension file but not its `node_modules`. Resolution: TRD-015 builds the bundle and loads it, so an agent-core import that does not bundle fails a check.
5. **Prompt-handler recursion and cost.** A child Pi could load this extension or act on files. Resolution: `-ne -nt -np` removes extensions and tools, and a prompt handler costs a model call, which the guide states.
6. **Adapter-less harnesses.** Nothing runs there, so AC-017-2 is met only by the guide, the capability table and the status check (PRD amendment 1.0.4), not at command time. This is a stated gap, not a hidden one.

### Task coverage issues

- Every REQ-001 to REQ-022 has at least one implementing task and a verifying one (`Traceability Validation`).
- TRD-001, TRD-016, TRD-017 and TRD-018 have no paired test task by design: TRD-001 is a recorded probe, TRD-016 has TRD-016-TEST, and TRD-017 and TRD-018 are documentation and the verification itself.

### Dependency and estimate issues

- The probe (TRD-001) is on the path to TRD-012 and TRD-014. If it shows Pi cannot observe an abort, `command_end_on_cancel` is declared `false` and AC-004-3 is met only in the sense of AC-004-4.
- Estimates assume the Pi typings match runtime behavior; the live smoke in TRD-015 is the check.

### Testability

- The adapter is tested through `activate(fakePi)` with host events replayed, which is the real entry point (Constitution rule 6). The shell runner is tested with real fixture executables, not mocks.
- Guards are proven capable of failing by TRD-018, not assumed (Constitution rule 7).

### Design Readiness Scorecard

| Dimension | Score | Note |
| --- | --- | --- |
| Architecture soundness | 4 | Core and adapter split; completion model-dependence is bounded, not removed. |
| Task coverage | 4 | All 22 REQs and 85 ACs covered; AC-017-2 is met only partly by design. |
| Dependency and estimate quality | 4 | Probe first; estimates unverified against runtime. |
| Testability | 4 | Real entry point and real fixtures; live smoke is opt-in and model-dependent. |

**Overall: 4.0.** The abort path and the shutdown budget were measured by TRD-001 and the design corrected from them. Not re-scored.

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Model skips the completion tool | Medium | End reported late as `cancelled` | Never inferred as success; documented in the guide |
| Shutdown budget too short for end handlers | Medium | Some end handlers skipped at exit | Measured by TRD-001; skipped visibly, never silently |
| Abort not observable in Pi | Low | `command_end_on_cancel` declared unsupported | TRD-001; capability declared from the result |
| agent-core import does not bundle | Low | Extension fails to load | TRD-015 builds and loads the bundle |
| Untrusted repository runs code | Medium | Arbitrary execution | REQ-022 two-condition gate: host trust (true by default in Pi, so alone it blocks nothing) and the user's explicit, digest-bound trust; tested both ways |
| Prompt handler cost or unavailability | Medium | Handler fails per `on_error` | Stated in the guide; per-handler timeout |

## Constitution Gate

Constitution Gate: running

- **Rule 1 (no secrets in code):** the environment allowlist and redaction (TRD-003, TRD-004); no credentials in code.
- **Rule 2 (input validation):** the hooks file is validated at the boundary before anything runs (TRD-002); arguments never reach a shell (TRD-004).
- **Rule 3 (tests accompany features):** a test task for every behavior task, and TRD-018.
- **Rule 4 (ownership boundary):** no retries, scheduling or recovery and no competing dispatcher (TRD-006, TRD-018).
- **Rule 5 (enforced at runtime, not at the model):** handlers are started only by the runtime boundary, a block marks the input handled, and no tool parameter names a handler (TRD-009, TRD-010).
- **Rule 6 (reachable from the entry point):** the adapter is registered from `activate()` and tested through it (TRD-015).
- **Rule 7 (a verification must be able to fail):** TRD-018 breaks each guard and observes a failure.
- **Rule 8 (user-owned artifacts in files):** the hooks file, executables and prompt files are user-owned; only enforcement boundaries are code.

Constitution Gate: PASSED

## Changelog

- 1.0.0 (2026-10-15): Initial draft.
- 1.0.1 (2026-10-15): Refinement. TRD-001 and TRD-008 now cover the skill form of a command's input; TRD-012 states what happens when the shutdown budget is unusable; TRD-010 states where `session_id` comes from. No task added or removed; hours and dependencies unchanged. Design readiness score unchanged at 4.0.
- 1.0.2 (2026-10-15): Reuse check against `pi-yaml-hooks` (a third-party Pi and OMP hook runner), found after the plan was scaffolded: recorded the evidence and the decision to build here; TRD-014 forbids a `/hooks-*` command name; TRD-016 documents the difference. Two acceptance criteria and two test scenarios added; no task added or removed, hours and dependencies unchanged.
- 1.0.3 (2026-10-15): TRD-001 probe run in Pi 1.2.0 (print, RPC, interactive): an abort emits no `agent_before_settle`; `session_shutdown` handlers were awaited up to 100 s; `isProjectTrusted()` is `true` by default; a skill arrives as `/skill:<name> <args>`. Recorded under Probe results; no task changed.
- 1.0.4 (2026-10-15): Corrections from the TRD-001 probe and a trust decision. Cancellation is detected from `agent_settled.aborted`, not an `aborted` outcome (TRD-001, TRD-012, TRD-014); the shutdown bound is stated (TRD-012); TRD-008 now describes the embedded dispatcher map and the `/skill:` form as built. Host trust is true by default, so REQ-022 now needs the user's explicit trust: TRD-019 (trust store) and TRD-019-TEST added, TRD-009 and TRD-009-TEST extended (trust command `ensemble-lifecycle-trust`, supplying the set of known commands). Two tasks added, 10 hours added, PRD reference moved to v1.0.5.
