---
document_id: PRD-2026-f08a2a09
label: prd-command-lifecycle-hooks
version: 1.0.5
status: Locked
date: 2026-10-15
scale_depth: STANDARD
total_requirements: 22
readiness_score: 3.8
design_readiness_score: null
---

# PRD-2026-f08a2a09: Command Lifecycle Hooks

## PRD Health Summary

- **Risk flags:** REQ-005, REQ-009, REQ-014, REQ-015, REQ-021, REQ-022
- **Dependencies:** 66 cross-requirement dependencies (see Dependency Map)
- **Unresolved clarification markers:** 0
- **Constitution compliance:** passed (`docs/standards/constitution.md`, Non-Negotiable Rules 1-8)

## Product Summary

**Problem:** An Ensemble command runs as instructions to an agent. Nothing marks "this command started" or "this command finished", so a team cannot attach deterministic automation to a command, such as an audit log entry, a notification, a policy check or a completion review. The harnesses' own hook events describe sessions, turns and tool calls. They do not describe an Ensemble command's start and end, and an agent turn ending does not mean a specific command completed.

**Who feels it:** Teams that run Ensemble commands (`create-prd`, `refine-prd`, `create-trd`, and others) and want auditing, notification or completion review around them, and the maintainers who would otherwise copy hook wiring into every command.

**Solution:** A logical command lifecycle with two events, `command.start` and `command.end`, and two handler types:

- **Shell handlers** run a configured executable with the event as input.
- **Prompt handlers** evaluate a configured prompt against the same event.

A project-level `.ensemble/hooks.yaml` defines reusable handlers and selects them per command. Harness adapters expose the lifecycle where they can reliably observe it, and each adapter declares which parts it supports. An adapter that cannot observe a boundary says so. It never approximates a command end with a session or turn event.

**Success:** In the first proving harness (Pi), a configured `command.start` handler runs before the command's workflow begins, and exactly one `command.end` handler set runs when the command completes, fails or is cancelled. A project with no `.ensemble/hooks.yaml` behaves exactly as it does today. A harness that cannot honor a configured hook says so visibly instead of silently doing nothing.

**Source:** The maintainer's design recommendation for a command lifecycle with `shell` and `prompt` handlers, exposed through harness adapters where possible.

**Decisions already made by the maintainer:**

- The lifecycle is defined independently of any harness's native hook events.
- The first release is **adapter-specific**: one adapter that can reliably bracket a real command invocation proves the contract, and a runtime-owned command wrapper is deferred.
- The first proving harness is **Pi**.
- Hook policy lives in a project-level `.ensemble/hooks.yaml`, separate from command workflow definitions.
- Handlers run serially in configured order.
- A start handler may block the command. An end handler never rewrites a completed command's outcome.

**Out of scope (Won't, this release):**

- A runtime-owned command wrapper that every harness routes through.
- Adapters for harnesses other than Pi (Claude Code, OpenCode, Codex), beyond the capability declaration and honest-labeling rules that apply to all of them.
- Parallel handler execution.
- Durable scheduling, retries or recovery of handlers (Constitution rule 4: Foreman owns those).
- A second dispatcher or any change to how commands are resolved or dispatched.
- Handlers that rewrite artifacts or alter a command's outcome.

## User Analysis

**Roles:**

- **Team lead / maintainer:** decides which commands get hooks and which handlers run.
- **Hook author:** writes the shell executable or the prompt file a handler runs.
- **Command user:** runs commands and sees the hooks' effects and failures.
- **Harness adapter author:** makes a harness honor the lifecycle.

**Pain points:** no deterministic place to attach automation to a command; native harness events do not line up with command boundaries; copying hook wiring into every command; silent no-ops when a harness cannot honor a hook.

**Success metrics:**

- Every actual command invocation in the proving harness produces exactly one start and one end event.
- The invalid-configuration cases listed in REQ-007 are each rejected with a message naming the offending entry.
- With no hooks configured, there is no change in command output or behavior.

## Approvals and Decision Ownership

- **Approver:** The Ensemble repository owner (maintainer).
- **Acceptance criteria the approver judges against:** REQ-001 through REQ-020 below, and in particular that no hook is ever approximated, and that a harness that cannot honor a hook says so.

## Entry and Exit Criteria

**Entry:**

- The Pi abort signal, the `session_shutdown` wait and the default project-trust value were measured in Pi 1.2.0 (see Probe evidence, "Measured in the implementation probe"). Nothing remains to be probed before work starts.
- Unrelated working-tree changes remain untouched.

**Exit:**

- A project with a valid `.ensemble/hooks.yaml` runs its start and end handlers around a real command invocation in Pi, in order, with the stated error behavior.
- Invalid configuration is rejected with actionable messages.
- The Pi adapter declares its capabilities, and a configured hook for an unsupported capability produces a visible warning.
- Tests cover every acceptance criterion below, and the checks can fail: breaking a guard makes a check fail.
- Generated command artifacts match their sources, and `npm run validate` and `npm run generate:validate` pass.

## Requirements

### Lifecycle Events

### REQ-001: Every command invocation has a run ID and exactly one start and one end (Must)

Each actual command invocation receives a unique run ID and exactly two lifecycle events: `command.start` and `command.end`.

- AC-001-1: Given a command is invoked, when it begins, then exactly one `command.start` event is produced carrying a run ID that no other invocation has.
- AC-001-2: Given a command was started, when it completes, fails or is cancelled, then exactly one `command.end` event is produced carrying the same run ID.
- AC-001-3: Given two invocations of the same command in one session, when both run, then their run IDs differ and each has its own start and end.

### REQ-002: `command.start` fires after resolution, before the workflow (Must)

- AC-002-1: Given a command invocation, when the command has been resolved from its input, then `command.start` fires before the first step of the command's workflow.
- AC-002-2: Given an invocation whose arguments the command's own workflow then rejects, when it rejects them, then the invocation has already produced a `command.start`, and it ends with outcome `failed` and a reason naming the rejection. The adapter cannot know before the workflow runs whether the command will reject its arguments, because the command validates them itself.
- AC-002-3: Given a `command.start` handler is configured to block, when it blocks, then the command's workflow does not begin.

### REQ-003: Dispatchers resolve to the concrete command first (Must)

- AC-003-1: Given a dispatcher command such as `prd` selects `create-prd`, when it runs, then the lifecycle fires once for `create-prd` and not for the dispatcher.
- AC-003-2: Given a hook is configured for the dispatcher's name but not for the target, when the dispatcher runs, then that hook does not fire.

### REQ-004: `command.end` is attempted in every outcome (Must)

- AC-004-1: Given a `command.start` handler failed with `on_error: continue`, when the command later finishes, then `command.end` is still produced.
- AC-004-2: Given a command fails, when it ends, then `command.end` carries outcome `failed`.
- AC-004-3: Given a command is cancelled in a harness that can observe cancellation, when it ends, then `command.end` carries outcome `cancelled` and fires exactly once.
- AC-004-4: Given a harness that cannot observe cancellation, when a command is cancelled, then no `cancelled` outcome is fabricated, and the harness's declared capabilities state that cancellation is not observed.
- AC-004-5: Given a `command.start` handler blocked the command, when the block occurs, then `command.end` is produced with outcome `failed` and a reason naming the block, so every start has exactly one end.

### REQ-005: One stable event payload (Must) [RISK: leaking secrets or whole transcripts to handlers]

- AC-005-1: Given any lifecycle event, when it is delivered to a handler, then it carries `event`, `run_id`, `command`, `arguments`, `cwd`, `session_id` and `timestamp`.
- AC-005-2: Given a `command.end` event, when it is delivered, then it additionally carries `outcome` (`succeeded`, `failed` or `cancelled`), `duration_ms` and, where available, artifact paths and a concise completion summary.
- AC-005-3: Given an argument or result value that matches a documented secret pattern or names a documented sensitive variable, when the event is built, then that value is replaced by a fixed redaction marker and the payload never includes a full transcript. The patterns and variable names are listed in the guide (REQ-018).
- AC-005-4: Given the same event is delivered to a shell handler and to a prompt handler, when both receive it, then the fields and their values are identical.

### Configuration

### REQ-006: Hook policy lives in a project-level hooks file (Must)

- AC-006-1: Given a project has `.ensemble/hooks.yaml` defining named handlers and per-command start and end selections, when a selected command runs, then the named handlers run for the selected events.
- AC-006-2: Given a handler is named in several commands' selections, when each command runs, then the single handler definition is used for all of them.
- AC-006-3: Given hook configuration exists, when the command's own definition is read, then it contains no hook wiring and no shell implementation detail.
- AC-006-4: Given a selection names a wildcard or a group instead of an explicit command, when the configuration is validated, then it is rejected as an unknown command, so every command that carries hooks is listed by name.

### REQ-007: Invalid hook configuration is rejected before any command runs (Must)

- AC-007-1: Given a handler lacks an explicit `type`, an event selection or an error behavior, when the configuration is validated, then it is rejected with a message naming the handler and the missing field.
- AC-007-2: Given a command selection references a handler that is not defined, when validated, then it is rejected naming the command and the unknown handler.
- AC-007-3: Given the configuration names a command that does not exist, an event name that is not `start` or `end`, a non-positive timeout, a missing handler file, or an unknown field, when validated, then each is rejected with a message naming the offending entry.
- AC-007-4: Given the configuration is invalid, when a command runs, then no handler runs and the user sees the validation error.
- AC-007-5: Given the configuration is valid, when validated, then no output other than a success indication is produced.

### REQ-008: Without hooks, nothing changes (Must)

- AC-008-1: Given a project with no `.ensemble/hooks.yaml`, when any command runs, then its behavior and output are identical to today's.
- AC-008-2: Given a project with hooks configured only for command A, when command B runs, then no lifecycle handler runs and no extra output appears.
- AC-008-3: Given the existing command definitions, when the feature ships, then their meaning is unchanged.

### Handlers

### REQ-009: Shell handlers run an executable with the event as input (Must) [RISK: arbitrary code execution at a command boundary]

- AC-009-1: Given a shell handler is configured, when its event fires, then the configured executable runs with the event delivered as structured input.
- AC-009-2: Given the command's arguments contain shell metacharacters, when the handler runs, then they are never interpreted by a shell.
- AC-009-3: Given a shell handler runs, when it starts, then it sees only a documented allowlist of environment variables and not the full environment.
- AC-009-4: Given a handler produces more output than the stated bound, when it runs, then the output is truncated at the bound and the user is told it was truncated.
- AC-009-5: Given a handler exceeds its timeout (5 seconds when a shell handler states none), when the timeout elapses, then the handler and every process it started are terminated and its error behavior applies.
- AC-009-6: Given a handler exits with status zero, when it finishes, then it is a success. Given a nonzero exit, then its configured error behavior applies.
- AC-009-7: Given the agent's own output or tool use, when a command runs, then no text produced by the model can start a shell handler or add one to the configuration. Only the runtime's lifecycle boundary starts handlers.

### REQ-010: Error behavior is explicit, with safe defaults (Must)

- AC-010-1: Given an end handler fails and its error behavior is `continue`, when it fails, then the command's recorded outcome is unchanged.
- AC-010-2: Given a start handler fails and its error behavior is `block`, when it fails, then the command does not run and the user is told which handler blocked it.
- AC-010-3: Given an end handler is configured with error behavior `block`, when the configuration is validated, then it is rejected, because only start handlers may block.
- AC-010-4: Given any handler, start or end, has no error behavior stated, when the configuration is validated, then it is rejected under REQ-007 and no default is silently applied.

### REQ-011: Prompt handlers evaluate a prompt against the event (Must)

- AC-011-1: Given a prompt handler is configured, when its event fires, then the configured prompt is evaluated with the event as context.
- AC-011-2: Given a prompt handler responds, when the response is read, then it conforms to a typed contract of `continue`, an optional user-facing message and optional structured findings.
- AC-011-3: Given a prompt handler's response is malformed, when it is read, then it is handled by the handler's error behavior and is never treated as `continue`.
- AC-011-4: Given an end prompt handler finds a missing or inconsistent deliverable, when it responds, then the finding is reported to the user and no artifact is edited and the command is not recorded as having succeeded because of it.
- AC-011-5: Given a prompt handler states no timeout, when it runs, then a 30 second timeout applies, and exceeding it applies the handler's error behavior.

### REQ-012: Handlers run serially, in configured order (Must)

- AC-012-1: Given several handlers are selected for an event, when it fires, then they run one at a time in the configured order.
- AC-012-2: Given an earlier handler fails with `continue`, when the next is due, then it still runs.
- AC-012-3: Given an earlier start handler blocks, when it blocks, then later start handlers do not run.

### REQ-013: Handler outcomes are visible to the user (Should)

- AC-013-1: Given a handler ran, when the event finishes, then the user can see, for each handler, whether it succeeded, failed, timed out or blocked, and how long it took.
- AC-013-2: Given a handler failed with `continue`, when the command finishes, then the failure is visible and does not read as a command failure.

### Harness Adapters

### REQ-014: Each adapter declares its lifecycle capabilities (Must) [RISK: approximating command end with a session or turn event]

- AC-014-1: Given an adapter, when it is described, then it states whether it supports `command_start`, `command_end` and `command_end_on_cancel`.
- AC-014-2: Given an adapter cannot reliably observe a boundary, when its capabilities are declared, then that capability is marked unsupported and is never approximated with a session or turn event.
- AC-014-3: Given a hook is configured for a capability the active harness does not support, when a command runs, then the user sees a warning naming the hook and the unsupported capability, and the command runs.
- AC-014-4: Given the capability declarations, when they are read, then they are discoverable without running a command.

### REQ-015: The Pi adapter proves the lifecycle end to end (Must) [RISK: Pi's host may not expose a reliable command-end boundary]

- AC-015-1: Given a project with hooks configured and a real command invoked in Pi, when the command runs, then the start handlers ran before its first workflow step.
- AC-015-2: Given the same invocation, when it ends, then exactly one end set of handlers ran, for the outcomes the Pi adapter declares support for.
- AC-015-3: Given a dispatcher invoked in Pi, when it selects a target, then the lifecycle fired once for the target (REQ-003).
- AC-015-4: Given a handler that exceeds its timeout and a handler whose error behavior is `block`, when each runs in Pi, then the stated behavior occurs.
- AC-015-5: Given the Pi adapter defines a command's end by the completion step of REQ-021, when it declares its capabilities, then it states exactly that definition, and the declaration is checked against the real host.

### REQ-016: Best-effort support is labeled as best-effort (Should)

- AC-016-1: Given a harness with no lifecycle-capable adapter, when generated command instructions offer a prompt-handler path, then it is labeled best-effort.
- AC-016-2: Given that best-effort path, when documented or shown, then it is never described as deterministic shell-hook execution.

### REQ-017: A hook for an unsupported capability is never a silent no-op (Must)

- AC-017-1: Given a hook is selected for `command_end_on_cancel` on an adapter that does not support it, when the configuration is loaded in that harness, then the unsupported capability is reported.
- AC-017-2: Given a harness with no adapter at all, when the guide's capability table or the hooks status check is read, then it states that lifecycle hooks are not active in that harness. Nothing is shown when a command runs in such a harness, because no code runs there.

### Quality

### REQ-018: Hook documentation exists (Should)

- AC-018-1: Given the feature ships, when a user looks for it, then a guide documents the two events, the payload, the configuration file, both handler types, the exit and error semantics, and a capability table per harness.
- AC-018-2: Given the guide's examples, when run against the shipped validator, then each example validates.

### REQ-019: Checks accompany every acceptance criterion and can fail (Must)

- AC-019-1: Given the acceptance criteria above, when the test suite runs, then each Must criterion is covered by at least one check.
- AC-019-2: Given a guard is deliberately broken (for example, a handler started from model text, a missing end event, an unvalidated configuration), when the checks run, then at least one fails.
- AC-019-3: Given the lifecycle is exercised, when acceptance is asserted, then it goes through the real command entry point in the proving harness and not around it.

### REQ-020: Hooks do not reimplement Foreman's responsibilities (Must)

- AC-020-1: Given a handler fails, when the failure is recorded, then nothing retries it, schedules it or recovers it.
- AC-020-2: Given the feature, when reviewed, then it adds no dispatcher competing with Foreman.

### REQ-021: A command signals its own completion through one uniform step (Must) [RISK: the completion signal is performed by the model]

Pi marks when an agent loop settles, but nothing marks that one command has finished, and a command that pauses to ask the user a question as plain text settles the loop mid-command. The command therefore signals its own completion, and a settled loop never ends a command by itself.

- AC-021-1: Given any command that supports lifecycle hooks, when the adapter starts it in a harness, then the model is given the same completion instruction as for every other command, carried by the adapter at run time, and no generated command definition contains hook configuration, handler detail or a completion step.
- AC-021-2: Given a command signals completion, when the adapter observes it, then that is the command's end with the outcome the command stated, `succeeded` or `failed`, and a stated reason when `failed`.
- AC-021-3: Given the agent loop ends in an error or an abort before the completion step, when the adapter observes it, then the command's end carries outcome `failed` or `cancelled` respectively.
- AC-021-4: Given the agent loop settles before the command has signalled completion, when it settles, then no end is produced and the command is still considered running, whether or not it is waiting for the user to answer.
- AC-021-5: Given a command never signals completion, when the session ends or the next command's input arrives in the same session, then the end is produced with outcome `cancelled` and a reason naming the missing completion signal, and it is never recorded as `succeeded`.
- AC-021-6: Given a command performs its completion step twice, when the second occurs, then exactly one end has been produced.
- AC-021-7: Given a command stops because its own workflow hit a hard stop or rejected its arguments, when it signals completion with outcome `failed`, then the end carries `failed` and that reason.

### REQ-022: Hooks run only in a project the user has explicitly trusted (Must) [RISK: a cloned repository could run arbitrary executables at its first command]

Measured in Pi 1.2.0: the host reports a project as trusted by default in every mode, with no prompt, and as untrusted only when the user passes `--no-approve`. Host trust alone therefore protects almost no one, so the user's explicit trust of a project's hooks is a separate, required condition.

- AC-022-1: Given a project the host has not trusted, when a command runs, then no handler runs, and the user sees a warning that names the hooks file and says how trust is granted.
- AC-022-2: Given the host trusts the project and the user has explicitly trusted this project's hooks, when a command runs, then the handlers run per the configuration.
- AC-022-3: Given the active harness offers no project-trust decision, when a command runs, then no handler runs and the user is told why.
- AC-022-4: Given an untrusted project, when the hooks file is read, then it may be validated, but nothing it names is executed.
- AC-022-5: Given the host trusts the project but the user has not explicitly trusted its hooks, when a command runs, then no handler runs, and the user sees a warning that names the hooks file and says how to trust it.
- AC-022-6: Given the user trusted a project's hooks, when the hooks file or any handler file it names (an executable or a prompt file inside the project) later changes, then the next command runs no handler until the user trusts it again.
- AC-022-7: Given a repository ships its own trust data or its own hooks file, when it is opened, then that data cannot grant trust, because the user's trust is stored outside the repository.
- AC-022-8: Given the user is asked to trust a project's hooks, when the question is shown, then it lists every handler with its exact executable and arguments or prompt file, and trust is recorded only after an explicit confirmation made by the user, never by a model's tool call.

## Goals and Non-Goals

**Goals:**

- Deterministic start and end boundaries for Ensemble commands, in a harness that can honor them.
- A configuration contract that is validated before it can do anything.
- Honest reporting where a harness cannot honor a hook.

**Non-goals:**

- Replacing or wrapping every harness's command execution (deferred wrapper).
- Observing sessions, turns or tool calls (the harnesses' own events already do).
- Letting a handler change what a command did.

## Open Questions

These become the interview agenda in `/ensemble:refine-prd`.

1. Can the Pi extension host observe an aborted run? Settled by measurement: an abort emits no `agent_before_settle`, but `agent_settled` reports `aborted: true` (10 of 10 runs), so cancellation is observable. (REQ-004, REQ-021)
2. What is the handler output bound? The TRD sets it; the PRD requires only that a documented bound exists. (AC-009-4)

**Probe evidence (2026-10-15, Pi 1.2.0, `pi -p`, a throwaway extension logging events; not part of the repository):**

- **Start is observable.** `input` fired with the raw slash text (`/probe-cmd hello`), then `before_agent_start` fired with the expanded template prompt, then `agent_start` and `turn_start`. The command's name and arguments are readable at `input`.
- **A loop's end is observable, in this order:** `agent_end`, then `agent_before_settle`, then `agent_settled`.
- **Outcome is carried by `agent_before_settle`.** It reported `outcome: "completed"` for a model that answered and `outcome: "error"` for three runs where the model call failed. In those error runs `agent_settled` still reported `aborted: false`, so `agent_settled` alone cannot tell success from failure.
- **Not observed:** `ui_prompt_start` / `ui_prompt_end` and any event that names one command's completion. This confirms that a completion step (REQ-021) is needed, because a loop's settling says only that the loop stopped.

**Measured in the implementation probe (2026-10-15, Pi 1.2.0; print, RPC and the interactive TUI; `litellm/qwen`):**

- **Abort:** in 10 of 10 aborted runs `agent_before_settle` never fired, so no `aborted` outcome exists; the event order was `agent_end` then `agent_settled` with `aborted: true`. The reliable cancel signal is `agent_settled.aborted === true`. Completed runs fire `agent_before_settle` with `outcome: "completed"`; an error run fires it with `outcome: "error"` (observed earlier).
- **Shutdown:** the host awaited an async `session_shutdown` handler on every normal exit measured (print, RPC stdin close and `SIGTERM`, TUI `/quit`, Ctrl+D, Ctrl+C twice), up to the longest wait tried, 100 000 ms. RPC `SIGINT` kills the process at once and runs no handler.
- **Trust:** `ctx.isProjectTrusted()` was `true` in all six combinations of mode and directory with no prompt, and `false` only with `--no-approve`.
- **Input forms:** a prompt template arrives as `/<name> <args>` and a skill as `/skill:<name> <args>`.
- **Limits of this evidence:** one `completed` run, three `error` runs with the outcome logged, three runs that produced no settle event (timeout or no response), and print mode only. The first error run predates logging of the outcome field and is not counted.

**Resolved in refinement (2026-10-15):**

- A rejected invocation produces a start and an end with outcome `failed` (AC-002-2). This replaced the earlier decision that a rejected invocation produces no events: in Pi the command's own prompt validates its arguments, so the start must fire from the runtime before the workflow if it is to be deterministic and a start handler's block is to be enforced by the runtime. Found while designing the TRD (2026-10-15).
- For harnesses with no adapter, the guide, the capability table and a status check state that hooks are inactive; nothing is shown at command time (AC-017-2).
- A start handler's block produces an end event with outcome `failed` (AC-004-5).
- `on_error` is required on every handler (AC-010-4). The source recommendation both required explicit error behavior and defaulted end hooks to `continue`; the maintainer chose to require it.
- A command's end in Pi is an explicit completion step (REQ-021).
- Default timeouts are 5 seconds for shell handlers and 30 seconds for prompt handlers, overridable per handler (AC-009-5, AC-011-5).
- Selections list each command explicitly; wildcards and groups are rejected (AC-006-4).
- No handler runs until the host trusts the project **and** the user has explicitly trusted that project's hooks (REQ-022). The second condition was added after the Pi probe showed host trust is true by default; the user's trust is stored outside the repository and is voided when the hooks file or a handler file it names changes.
- A settled loop never ends a command (AC-021-4); a command that never signals completion ends as `cancelled` when the session ends or the next command begins (AC-021-5). This replaced an earlier rule that ended it as `failed` on every settle, which would have ended any command that paused to ask the user a plain-text question. Found while designing the TRD (2026-10-15).
- The completion instruction is carried by the adapter at run time rather than generated into every command (AC-021-1).

## Dependency Map

- REQ-001 -> none.
- REQ-002 depends on REQ-001.
- REQ-003 depends on REQ-001.
- REQ-004 depends on REQ-001, REQ-002.
- REQ-005 depends on REQ-001.
- REQ-006 -> none.
- REQ-007 depends on REQ-006.
- REQ-008 depends on REQ-006.
- REQ-009 depends on REQ-005, REQ-006, REQ-010.
- REQ-010 depends on REQ-006, REQ-007.
- REQ-011 depends on REQ-005, REQ-006, REQ-010.
- REQ-012 depends on REQ-009, REQ-011.
- REQ-013 depends on REQ-012.
- REQ-014 depends on REQ-001.
- REQ-015 depends on REQ-001 through REQ-007, REQ-009, REQ-010, REQ-012, REQ-014, REQ-021, REQ-022.
- REQ-016 depends on REQ-014.
- REQ-017 depends on REQ-014.
- REQ-018 depends on REQ-005, REQ-006, REQ-009, REQ-011, REQ-014.
- REQ-019 depends on REQ-001 through REQ-017, REQ-021, REQ-022.
- REQ-020 depends on REQ-009, REQ-011.
- REQ-021 depends on REQ-001, REQ-004, REQ-014.
- REQ-022 depends on REQ-006, REQ-009, REQ-017.

**Clusters to deliver together:**

- Lifecycle contract: REQ-001 to REQ-005.
- Configuration: REQ-006 to REQ-008.
- Handlers: REQ-009 to REQ-013, REQ-020 and REQ-022.
- Adapter proof: REQ-014, REQ-015, REQ-017 and REQ-021.

No circular dependencies.

## Implementation Readiness Gate

| Dimension | Score | Note |
| --- | --- | --- |
| Completeness | 4 | All feature areas covered; the handler output bound is deliberately left to the TRD. |
| Testability | 4 | Every Must requirement has verifiable ACs. |
| Clarity | 4 | Edge cases around rejected, blocked and unfinished invocations are decided or marked, not guessed. |
| Feasibility | 3 | Start, the completed/error outcomes, the abort signal, tool registration, the trust check and per-turn injection are confirmed in Pi. The completion signal is still performed by the model. |

**Overall: 3.75 (CONCERNS), not re-scored.** The amendments since 1.0.2 removed rules that could not be implemented and added the trust requirement, but the score was not re-evaluated, so it is left as it was. No open question remains except the handler output bound, which the TRD sets.

## Changelog

- 1.0.0 (2026-10-15): Initial draft.
- 1.0.1 (2026-10-15): Refinement. Resolved 5 of 6 clarification items and added REQ-021 (uniform completion step) and REQ-022 (project trust). AC-005-3 made testable, AC-006-4 added, default timeouts stated.
- 1.0.2 (2026-10-15): Second refinement pass. Recorded Pi 1.2.0 probe evidence (start, loop end, `completed`/`error` outcome from `agent_before_settle`); narrowed Open Question 1 to the pending-question and abort cases.
- 1.0.3 (2026-10-15): Amended during TRD design. AC-021-1, AC-021-4 and AC-021-5 rewritten (a settle never ends a command; completion instruction carried at run time); Open Question 2 closed; clarification markers now 0. Readiness score not re-evaluated.
- 1.0.4 (2026-10-15): Amended during TRD design. AC-002-1, AC-002-2, AC-017-2 and AC-021-2 rewritten, AC-021-7 added: `command.start` fires at input, a rejected invocation ends as `failed`, and adapter-less harnesses are covered by documentation and a status check. Readiness score not re-evaluated.
- 1.0.5 (2026-10-15): Amended during implementation after the Pi probe. REQ-022 now requires the user's explicit trust of a project's hooks in addition to host trust, because host trust is true by default; AC-022-5 to AC-022-8 added. Open Question 1 closed by measurement (cancellation is observable through `agent_settled.aborted`). Probe measurements recorded. Readiness score not re-evaluated.
