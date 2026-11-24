---
document_id: TRD-2026-d571763f
label: trd-ensemble-engine-cli
kind: foundational
version: 1.0.0
status: Draft
date: 2026-11-24
design_readiness_score: 4.2
test_approach: standard
Constitution compliance: passed
capabilities:
  - deterministic-engine-cli
  - llm-engine-handoff
  - implement-trd-orchestration
---

# TRD-2026-d571763f: The `ensemble` Engine CLI

## Purpose and Scope

Ensemble's workflows are prose that a model executes. `/ensemble:implement-trd-tasks` alone is five phase files and a reference skill, roughly 70 numbered steps. About two thirds of those steps already call a deterministic CLI (`trd-cli`, `toolchain-cli`), but every sequencing decision, id cache, HALT rule and gate is applied by the model from prose, so two runs of the same TRD can differ and a model can skip or reorder a gate.

This TRD introduces one CLI, `ensemble`, with subcommands that form a deterministic **engine**. The model stops being the executor and becomes the **planner and worker**: it decides what to do next, calls engine subcommands, and supplies only what needs judgement (writing code, reviewing, writing PR prose, answering a question for the user). The engine owns sequencing, state derivation, validation, gates, exit codes and bookkeeping.

**In scope (this TRD):**

- the `ensemble` binary: registry, argv, envelope, exit codes, discovery and input validation;
- mounting the existing `trd-cli` and `toolchain-cli` verbs under it with byte-identical output;
- a policy loader that keeps user-changeable values out of code;
- engine verbs that cover every deterministic step of `/ensemble:implement-trd-tasks` (preflight, resume, branch, scaffold, gate, verification, closure, checkbox sync, PR creation, completion report);
- the engine-to-model hand-off protocol (`NEEDS_AGENT`, `NEEDS_CHOICE`) and a review-loop host;
- a `plan`/`next` driver, the thinned skill, and entry-point proof through the real command.

**Out of scope:** changing what `/ensemble:beads-build` agents do inside a bead (writing code, review judgement), a durable scheduler or daemon (Constitution Rule 4), converting commands other than `implement-trd-tasks` (the conversion rubric below makes them mechanical follow-ups), and vendoring the engine into the codex and opencode bundles (see Open Questions).

**Deferred inside the converted command:** the deprecated `--legacy-multi` path and its `workstream-plan` scaffold with cross-TRD edges stay as prose in the skill until a follow-up TRD converts or removes them. Workstream generation, validation and status work through the mounted `trd` verbs (`create-workstream-trd`, `validate-workstream`, `workstream-status`), and running a generated workstream TRD is an ordinary single-TRD run, so `--workstream` is covered.

## Architecture Decision

### Alternatives considered

| Option | Shape | Verdict |
|---|---|---|
| A. One front CLI over existing libraries | `ensemble <group> <verb>`; mounts `trd-cli` and `toolchain-cli` unchanged, adds new engine verbs beside them | **Chosen.** Reuses ~66 working verbs, adds no dependency, existing skills keep working |
| B. Rewrite `trd-cli` and `toolchain-cli` into the engine | Move code, retire the old entry points | Rejected: large blast radius, breaks every skill that parses today's output, no benefit to the planner |
| C. Long-running orchestrator process | A daemon that drives the workflow and calls the model | Rejected: Constitution Rule 4 forbids a second scheduler or dispatcher, and a daemon needs durable recovery |

### Decision

Option A. The user-stated direction is a CLI named `ensemble` whose subcommands form a deterministic engine that an LLM plans and orchestrates. The engine is a set of short-lived, idempotent subcommands. It never calls a model and never starts an agent: when a step needs judgement it returns a structured `NEEDS_AGENT` or `NEEDS_CHOICE` envelope and the model runtime does the work, then hands the result back for validation.

## System Architecture

### Division of labour

| Concern | Owner | Why |
|---|---|---|
| Argument parsing, early exits, mutual exclusion | Engine | Pure function of argv |
| Which step is next, what is allowed now | Engine (`plan`, `next`, per-verb preconditions) | Derived from tracker, git and files, never from the model's claim |
| Bead hierarchy creation, edges, labels, ids | Engine | Deterministic given a TRD |
| Quality-gate arithmetic, closure preconditions, checkbox sync | Engine | Enforcement boundary (Rule 5) |
| Writing code and tests, reviewing a diff, judging a finding | Model, through a hand-off | Needs generation or judgement |
| Risk and How-to-revert text in a PR body | Model, through a hand-off slot | Judgement per change |
| Which test strategy fits, answering a user question | Model, with `NEEDS_CHOICE` where interactive | Preference or judgement |
| Thresholds, rosters, strategy tables | Policy files | Rule 8: an end-user may want to change them |
| Review criteria, tone, fix strategy | Skills and prompts | Rule 8: user-owned, never encoded in the engine |

**Conversion rubric** (used to decide whether any future step moves into the engine):

1. A pure function of files, tracker state, git state, policy and flags: engine verb.
2. Needs generation or judgement: model slot behind a hand-off, with a schema-validated result.
3. A value an end-user would plausibly tune: policy file or skill text, not code.
4. An enforcement boundary (a gate, a precondition, a refusal): engine, never prose.

### CLI shape

`ensemble <group> <verb> [args] [--json] [--non-interactive] [--run-id <id>] [--project-root <path>]`

| Group | Content | Source |
|---|---|---|
| `trd` | the 26 `trd-cli` verbs (parse, validate, scaffold-plan, phase-status, pr-plan, beads-stage, ...) | mounted from `lib/trd-cli.js`, output unchanged |
| `tool` | the toolchain verbs (preflight, run, confirm-status, confirm-record, resolve, explain, validate, trace) | mounted from `lib/toolchain-cli.js`, output unchanged |
| `implement` | the new engine verbs for `/ensemble:implement-trd-tasks` | new |
| `review` | the local review loop host over `review-run-cli` prepare and collect | new, wraps existing |
| `engine` | `verbs`, `schema`, `policy`, `doctor` | new, discovery for the planner |

`ensemble --describe` prints the whole registry (group, verb, summary, side-effect class, input schema, output schema, policy keys, exit codes) as one JSON envelope. This is how the planning model discovers what the engine can do without reading prose.

### Envelope and exit codes

Today there are two coexisting JSON shapes and no named exit codes: `run-index` prints `{ok:false}` and exits 0, `trd-graph-cli` uses exit 2 for a gate signal, and `toolchain-cli` uses exit 2 for an unknown subcommand. The engine verbs use one envelope and one table. Mounted groups keep their legacy output exactly.

```json
{"ok":true,"status":"OK","verb":"implement.resume","data":{},"next":null}
{"ok":false,"status":"REFUSED","verb":"implement.gate","error":{"code":"TESTS_FAILED","message":"...","details":{}}}
{"ok":true,"status":"NEEDS_AGENT","verb":"implement.delegate","data":{"agents":[]},"next":{"verb":"implement.accept","args":{}}}
```

| Exit | Status | Meaning |
|---|---|---|
| 0 | `OK` | success, including the terminal states EXIT and COMPLETE |
| 1 | `REFUSED` | a gate or precondition refused (the HALT of today's prose) |
| 2 | `INVALID_INPUT` | bad argv, bad JSON, schema violation, path escape |
| 3 | `NEEDS_AGENT` | the model must do work and hand the result back |
| 4 | `NEEDS_CHOICE` | an interactive decision is needed; the model asks the user and passes the answer as a flag |
| 5 | `UNAVAILABLE` | a required tool, capability or adapter is missing or unhealthy |
| 6 | `INTERNAL` | a bug in the engine; never used for an expected condition |

stdout is exactly one JSON object; diagnostics go to stderr; secrets pass through the existing `redact`. Decision output is **deterministic**: it is a pure function of argv, stdin, files, tracker responses, git state and policy. It contains no clock reading and no random value; ids that must exist are content-derived or supplied by the caller (`--run-id` comes from `ensemble tool preflight`). Keys are emitted in sorted order.

### The hand-off protocol

The pattern already exists and works: `review-run-cli` `prepare` runs every mechanical step and returns a `DISPATCH` manifest of `agents[]` (name, role, briefPath, outPath, prompt, deadlineAtIso) and a `next` command; the model starts exactly those agents; `collect` validates their result files. The engine generalises it.

- A verb that needs judgement returns `NEEDS_AGENT` with `agents[]` in the same field names, a recorded base `HEAD` sha, and a `next` that names `ensemble implement accept`.
- `ensemble implement accept --step <id> --result-file <path>` validates the file against the role's schema, requires the path to sit under `.ensemble/state/engine/<runId>/results/`, caps its size, rejects a result whose recorded `HEAD` no longer matches, re-checks the step's precondition, and only then records it.
- A malformed, oversized, escaped or stale result is `INVALID_INPUT` or `REFUSED`; the engine never repairs it.
- Roles in this TRD: `builder-wave` (run `/ensemble:beads-build`), `reviewer` (a review round), `pr-prose` (Risk and How-to-revert text).
- `NEEDS_CHOICE` carries `options[]` and the flag that supplies the answer, so a non-interactive run (`--non-interactive`, `--foreman`) resolves from policy or returns `REFUSED` with the exact flag to pass, never a prompt.

### Policy versus mechanics (Constitution Rule 8)

The engine holds mechanics and enforcement. Anything an end-user would plausibly change is data. Policy keys: design-readiness pass and warn thresholds, default `max_parallel`, the minimum length of a closure reason, the test-strategy detection table, the strategies whose gate is informational, and the default team roster reference. Defaults ship in `lib/engine/policy/defaults.json`; a repository overrides them in `.ensemble/engine.yaml`, loaded the way `lib/toolchain/config.js` loads `toolchain.yaml`. Review criteria, fix strategies and tone are not policy and are never encoded in the engine: they stay in skills and prompts.

### State and resumability (Constitution Rule 4)

The engine adds no durable store and no scheduler. Resumability is **derived**: the open epic `[trd:<slug>]`, the closed task beads, git state and the TRD file are the truth, exactly as today. Every mutating verb re-derives its preconditions from live state and never trusts the caller or a ledger. An audit ledger under `.ensemble/state/engine/<runId>/` (self-ignoring, written with the existing `state-dir` helper) records step inputs, outputs and hashes for diagnosis only; nothing reads it to decide. Verbs are idempotent: re-running one after a crash produces the same result or a precise REFUSED.

**Pure derivation steps are folded into `next`.** The steps that only compute a decision (`args`, `env`, `team`, `branch`, `resume`) leave no trace in the tracker, so completion cannot be read back from state. `implement next` therefore evaluates them itself on every call, returns their results as a `context` object, and surfaces only the steps that act: mutations, hand-offs and choices.

**Choices that no existing mechanism persists are re-supplied on every call.** The branch intent is saved through the TRD frontmatter `choices-write` as today. The PR backend and the branching strategy are never persisted (the reference requires re-resolving them on every invocation), so the model passes `--pr-backend` or sets `ENSEMBLE_PR_BACKEND` on each call.

**Concurrency.** The engine takes no lock. Two sessions running mutating verbs on one TRD at once are unsupported, exactly as today; idempotent title-prefix reuse limits the damage but does not prevent a race.

### Packaging and resolution

- Code: entry `packages/development/lib/ensemble-cli.js`, modules under `packages/development/lib/engine/`. CommonJS, Node builtins plus `ajv` and `js-yaml`, which `packages/development` already depends on and `packages/full/lib/node_modules` already vendors. **No new runtime dependency.**
- Claude Code plugin: `packages/full/bin/ensemble`, a dependency-free launcher following the `packages/full/bin/jira` precedent (executable, `#!/usr/bin/env node`, builtins and relative bundle requires only), plus the `packages/full/lib` mirror symlinks `validate-all.js` requires.
- pi and omp: add the entry to `ENTRY_FILES` in `packages/pi/src/transformers/lib-bundler.ts` and regenerate `packages/pi/vendor`.
- Skills resolve it as `ENSEMBLE_CLI` through a new row in the `tool-path-resolution` cheat sheet, using the same four tiers as `TRD_CLI`.
- codex and opencode do not vendor `packages/development/lib` today (only the toolchain files); the engine reaches exactly the runtimes where `trd-cli` reaches today, so there is no regression, and extending vendoring is an Open Question.

### Security and input validation

- Every external input is validated at the boundary (Rule 2): argv, stdin JSON, result files and tracker output. Model-supplied data is external input.
- Schema validation with `ajv`, `additionalProperties: false`, a 4 MiB stdin cap, and a path-escape guard that resolves real paths under the project root or `.ensemble/state`.
- Subprocesses use argument arrays and never a shell; a value starting with `-` is refused where a value is expected (the rule `toolchain-cli` already applies). Tracker and host operations go only through toolchain capabilities and their adapter allowlists. There is no verb that executes an arbitrary command.
- Gates are enforced by the engine, so prompt text cannot bypass a refusal (Rule 5).

## Reused Capabilities

`trd-graph-cli capabilities docs/TRD --json` returns an empty registry: no foundational TRD exists to reuse. The engine reuses these existing components rather than duplicating them:

| Existing component | Used for |
|---|---|
| `lib/trd-cli.js`, `lib/trd-parser.js`, `lib/scaffold-planner.js` | parse, scaffold plan, phase status, pr-plan, choices, beads-stage and label |
| `lib/toolchain-cli.js`, `lib/toolchain/*` | every tracker, workflow, host and test-runner operation, consent, run ledger |
| `lib/review-run-cli.js`, `lib/pr-review-*.js` | the review loop, gate verdict, PR body grading |
| `lib/team-defaults.js` | default team roster |
| `lib/verify-requirements-evidence.js` | the requirement to acceptance criterion to code chain |
| `lib/toolchain/state-dir.js`, redaction helper | audit ledger location and secret redaction |

## Master Task List

### PR 1: The `ensemble` binary and its protocol

**Shippable State:** A maintainer can run `ensemble --describe` and see every verb with its schemas, run `ensemble trd parse <trd>` and `ensemble tool preflight ...` and get output byte-identical to `trd-cli.js` and `toolchain-cli.js`, and run `ensemble` from the installed Claude Code plugin without an npm install; the old entry points work unchanged.

- [ ] **TRD-001** Envelope, exit codes and input validation boundary [satisfies ARCH] (5h)
  - Target Files: `packages/development/lib/engine/envelope.js`, `packages/development/lib/engine/validate.js`
  - Implementation AC:
    - [ ] Given any verb result, when emitted, then stdout is exactly one JSON object with `ok`, `status`, `verb` and `data` or `error`, keys in sorted order, and diagnostics go to stderr
    - [ ] Given each status, when mapped, then the exit code follows the table: OK 0, REFUSED 1, INVALID_INPUT 2, NEEDS_AGENT 3, NEEDS_CHOICE 4, UNAVAILABLE 5, INTERNAL 6, and no other code is produced
    - [ ] Given argv, stdin JSON or a result file, when validated, then it is checked against the verb's JSON schema with `additionalProperties: false`, stdin is capped at 4 MiB, and a violation is `INVALID_INPUT` naming the field
    - [ ] Given a path supplied by the caller, when resolved, then its real path must sit under the project root or `.ensemble/state`, otherwise `INVALID_INPUT` with code `PATH_ESCAPE`
    - [ ] Given output containing a token-shaped string, when emitted, then it passes through the existing redaction
    - [ ] Given an unexpected exception inside a verb, when caught, then the status is `INTERNAL`, exit 6, and no stack trace reaches stdout

- [ ] **TRD-001-TEST** Envelope, exit-code and validation behaviour [verifies TRD-001] [satisfies ARCH] [depends: TRD-001] (3h)
  - Target Files: `packages/development/tests/engine-envelope.test.js`
  - Test AC:
    - [ ] Scenario: one object on stdout -- Given a verb that also logs a warning, When run, Then stdout parses as a single object and the warning is on stderr
    - [ ] Scenario: exit codes match statuses -- Given one result per status, When emitted, Then the seven exit codes are exactly 0 to 6 as tabled
    - [ ] Scenario: schema violation named -- Given stdin with an unknown key, When validated, Then `INVALID_INPUT` names the key
    - [ ] Scenario: oversize stdin refused -- Given 5 MiB on stdin, When read, Then it is refused before parsing
    - [ ] Scenario: path escape refused -- Given `--result-file ../../etc/passwd`, When resolved, Then `PATH_ESCAPE`
    - [ ] Scenario: internal error contained -- Given a verb that throws, When run, Then the status is `INTERNAL`, exit 6 and stdout holds no stack

- [ ] **TRD-002** Verb registry, argv parser and discovery [satisfies ARCH] [depends: TRD-001] (6h)
  - Target Files: `packages/development/lib/ensemble-cli.js`, `packages/development/lib/engine/registry.js`, `packages/development/lib/engine/argv.js`, `packages/development/lib/engine/describe.js`
  - Implementation AC:
    - [ ] Given verbs registered with group, name, summary, side-effect class, input schema, output schema and policy keys, when `ensemble --describe` runs, then stdout is one JSON envelope listing every verb with those fields in sorted order and nothing else
    - [ ] Given `ensemble <group> --help` or `ensemble <group> <verb> --help`, when run, then text generated from the registry lists the verbs or the verb's flags and the exit code is 0
    - [ ] Given an unknown group or verb, when run, then the status is `INVALID_INPUT`, the message names the nearest known verbs and the exit code is 2
    - [ ] Given the global flags `--json`, `--non-interactive`, `--run-id`, `--project-root`, when passed before or after the verb, then they parse identically and an unknown flag is `INVALID_INPUT` rather than ignored
    - [ ] Given `main(argv, ctx)` is required from a test, when called, then it returns the envelope and exit code without calling `process.exit`, so tests run in process

- [ ] **TRD-002-TEST** Registry, argv and discovery behaviour [verifies TRD-002] [satisfies ARCH] [depends: TRD-002] (3h)
  - Target Files: `packages/development/tests/engine-registry.test.js`
  - Test AC:
    - [ ] Scenario: describe lists every verb -- Given three registered verbs, When `--describe` runs, Then the JSON names all three with their schemas in sorted order
    - [ ] Scenario: unknown verb refused -- Given `ensemble implement frobnicate`, When run, Then the exit code is 2 and the message names the nearest verbs
    - [ ] Scenario: flag position independent -- Given `--run-id r1` before and after the verb, When parsed, Then both give the same context
    - [ ] Scenario: unknown flag rejected -- Given `--no-such-flag`, When parsed, Then the status is `INVALID_INPUT` and nothing runs
    - [ ] Scenario: describe can fail -- Given a verb registered without an output schema, When `--describe` runs, Then it is refused naming the verb

- [ ] **TRD-003** Mount the `trd` and `tool` groups with legacy parity [satisfies ARCH] [depends: TRD-002] (7h)
  - Target Files: `packages/development/lib/engine/mount.js`, `packages/development/lib/engine/groups/trd.js`, `packages/development/lib/engine/groups/tool.js`
  - Implementation AC:
    - [ ] Given each `trd-cli` subcommand, when run as `ensemble trd <verb> ...` on a fixture TRD, then stdout and exit code are byte-identical to `node trd-cli.js <verb> ...`
    - [ ] Given each `toolchain-cli` subcommand, when run as `ensemble tool <verb> ...`, then stdout and exit code are byte-identical to `node toolchain-cli.js <verb> ...`
    - [ ] Given the legacy files `trd-cli.js` and `toolchain-cli.js`, when this task lands, then they are unmodified and their existing tests pass
    - [ ] Given a mounted verb, when `--describe` runs, then it appears with a side-effect class (read, write) taken from a declared table, and a verb missing from the table is refused at registration
    - [ ] Given the mount adapter, when a legacy handler writes to `process.exit` or a global, then it is invoked in a way that cannot terminate the engine process

- [ ] **TRD-003-TEST** Legacy parity across every mounted verb [verifies TRD-003] [satisfies ARCH] [depends: TRD-003] (4h)
  - Target Files: `packages/development/tests/engine-mount-parity.test.js`, `packages/development/tests/fixtures/engine/trd-parity.md`
  - Test AC:
    - [ ] Scenario: trd parity -- Given every trd-cli verb with fixture arguments, When run through both entry points, Then stdout and exit code are byte-equal
    - [ ] Scenario: tool parity -- Given every toolchain verb with fixture arguments, When run through both entry points, Then stdout and exit code are byte-equal
    - [ ] Scenario: parity is computed live -- Given the legacy CLI changes its output, When the test runs, Then it fails because it compares against the live legacy run and not a stored copy
    - [ ] Scenario: undeclared verb refused -- Given a legacy verb absent from the side-effect table, When the engine starts, Then registration is refused naming it
    - [ ] Scenario: legacy untouched -- Given the legacy CLI files, When hashed before and after this PR, Then they are identical

- [ ] **TRD-004** Packaging, bin launcher and path resolution [satisfies INFRA] [depends: TRD-002] [depends: TRD-003] (7h)
  - Target Files: `packages/full/bin/ensemble`, `packages/full/lib/ensemble-cli.js`, `packages/full/lib/engine`, `packages/pi/src/transformers/lib-bundler.ts`, `packages/development/skills/tool-path-resolution/SKILL.md`, `scripts/validate-all.js`
  - Implementation AC:
    - [ ] Given the Claude Code plugin bundle, when installed without `npm install`, then `ensemble --describe` runs and prints the registry
    - [ ] Given `packages/full/bin/ensemble`, when validated, then it is executable, starts with `#!/usr/bin/env node`, and requires only builtins and relative bundle paths, and `ensemble` is added to the required bundled commands
    - [ ] Given the `full/lib` mirror rules, when `npm run validate` runs, then it exits 0 with the new entry file and `engine` directory mirrored
    - [ ] Given pi, when `npm run generate:pi` runs from the repo root, then the engine files are vendored and the generated-drift check is clean
    - [ ] Given a skill that needs the CLI, when it resolves `ENSEMBLE_CLI`, then the cheat sheet gives the same four tiers as `TRD_CLI`, and an unresolvable CLI prints a named error and HALTs
    - [ ] Given no new dependency is allowed, when the bundle requires run, then every bare require is a builtin or already vendored in `full/lib/node_modules`

- [ ] **TRD-004-TEST** Bundle and resolution behaviour [verifies TRD-004] [satisfies INFRA] [depends: TRD-004] (4h)
  - Target Files: `scripts/tests/ensemble-bundle-smoke.test.js`
  - Test AC:
    - [ ] Scenario: dereferenced bundle runs -- Given the full plugin copied with symlinks dereferenced, When `bin/ensemble --describe` runs, Then it prints the registry with exit 0
    - [ ] Scenario: bin rules enforced -- Given a launcher that is not executable or requires a non-builtin, When validated, Then the validator fails naming it
    - [ ] Scenario: missing mirror detected -- Given an engine file without its `full/lib` mirror, When validated, Then it fails naming the file
    - [ ] Scenario: pi vendoring present -- Given a fresh `generate:pi`, When `git status --porcelain` runs, Then it is empty and `vendor/lib/ensemble-cli.js` exists
    - [ ] Scenario: unresolvable CLI halts -- Given no tier resolves, When a skill resolves `ENSEMBLE_CLI`, Then it prints the named error and stops

### PR 2: Preflight decisions as read-only verbs

**Shippable State:** For any TRD, a maintainer can run `ensemble implement args|env|resume|team|branch` and read, as JSON, every decision Phase 1 of implement-trd-tasks makes today (modes, branching strategy, PR backend, resume state, roster, branch plan), with policy values changeable in `.ensemble/engine.yaml`; nothing in the repository or tracker is modified.

- [ ] **TRD-005** Policy loader and engine discovery verbs [satisfies ARCH] [depends: TRD-002] (4h)
  - Target Files: `packages/development/lib/engine/policy.js`, `packages/development/lib/engine/policy/defaults.json`, `packages/development/lib/engine/groups/engine.js`
  - Implementation AC:
    - [ ] Given the shipped defaults, when no repository file exists, then every policy key resolves from `defaults.json`
    - [ ] Given `.ensemble/engine.yaml`, when it overrides a key, then the repository value wins, an unknown key is `INVALID_INPUT` naming it, and a wrong type is refused
    - [ ] Given `ensemble engine policy --json`, when run, then each effective value is printed with its source (`default` or `repo`)
    - [ ] Given `ensemble engine schema <group.verb>` and `ensemble engine verbs`, when run, then they print the verb's input and output schema and the verb list from the registry
    - [ ] Given `ensemble engine doctor`, when run, then it reports the resolved CLI path, Node version, project root and whether `.ensemble/engine.yaml` parsed
    - [ ] Given the policy schema, when validated, then every value is a number, a boolean, an enumerated string or a table of enumerated strings, and no free-text field longer than 80 characters is accepted, so review criteria, tone and fix strategy cannot be stored as policy

- [ ] **TRD-005-TEST** Policy resolution and discovery [verifies TRD-005] [satisfies ARCH] [depends: TRD-005] (3h)
  - Target Files: `packages/development/tests/engine-policy.test.js`
  - Test AC:
    - [ ] Scenario: defaults apply -- Given no repository file, When the policy loads, Then every key equals the default
    - [ ] Scenario: repository override wins -- Given `design_readiness_pass: 3.5` in the repository file, When the policy loads, Then the effective value is 3.5 with source `repo`
    - [ ] Scenario: unknown key refused -- Given a repository file with an unknown key, When loaded, Then `INVALID_INPUT` names the key
    - [ ] Scenario: schema printed -- Given a registered verb, When `engine schema` runs, Then the printed schema equals the registry's
    - [ ] Scenario: malformed YAML refused -- Given a syntactically broken repository file, When loaded, Then the status is `INVALID_INPUT` and defaults are not silently used
    - [ ] Scenario: free text refused -- Given a repository file setting a policy value to a 500 character sentence, When loaded, Then `INVALID_INPUT` names the key

- [ ] **TRD-006** `implement args`: arguments and early exits [satisfies ARCH] [depends: TRD-002] [depends: TRD-005] (5h)
  - Target Files: `packages/development/lib/engine/verbs/implement-args.js`
  - Implementation AC:
    - [ ] Given `$ARGUMENTS` for implement-trd-tasks, when parsed, then the output states PLAN_ONLY, EXECUTE_ONLY, workstream, generate-only, foreman, the TRD paths (excluding the value after `--out`), BRANCH_REQUESTED, USE_CURRENT_BRANCH_REQUESTED and MAX_PARALLEL
    - [ ] Given `--plan` with `--execute`, or `--generate-only` with a conflicting flag, or two TRD paths without `--workstream`, when parsed, then the status is `REFUSED` with the exact error text the skill prints today
    - [ ] Given `--branch` with `--use-current-branch`, when parsed, then it is `REFUSED` before any tracker or git side effect
    - [ ] Given MAX_PARALLEL, when resolved, then precedence is `--max-parallel`, then TRD frontmatter `max_parallel`, then the policy default
    - [ ] Given `--foreman` or a non-empty `FOREMAN_TASK_TITLE`, when parsed, then non-interactive mode is on, and `CI` or `ENSEMBLE_NON_INTERACTIVE` alone never imply it
    - [ ] Given `--list`, `--status` or `--reset-task`, when parsed, then the verb returns the early-exit action to perform and performs none itself

- [ ] **TRD-006-TEST** Argument decisions [verifies TRD-006] [satisfies ARCH] [depends: TRD-006] (3h)
  - Target Files: `packages/development/tests/engine-implement-args.test.js`
  - Test AC:
    - [ ] Scenario: mutual exclusion -- Given `--plan --execute`, When parsed, Then `REFUSED` with the exact message and exit 1
    - [ ] Scenario: out value is not a path -- Given `a.md --out b.md`, When parsed, Then only `a.md` is a TRD path
    - [ ] Scenario: parallel precedence -- Given the flag, the frontmatter and the policy default all set, When resolved, Then the flag wins, then the frontmatter, then the policy
    - [ ] Scenario: foreman detection -- Given `FOREMAN_TASK_TITLE` set, When parsed, Then non-interactive is on; Given only `CI=true`, Then it is off
    - [ ] Scenario: ambiguous multi TRD refused -- Given two TRD paths and no `--workstream`, When parsed, Then `REFUSED` before any side effect

- [ ] **TRD-007** `implement env`: git-town, PR backend and working tree [satisfies ARCH] [depends: TRD-003] [depends: TRD-005] (5h)
  - Target Files: `packages/development/lib/engine/verbs/implement-env.js`
  - Implementation AC:
    - [ ] Given a repository, when run, then the output carries the branching strategy, the PR backend, the working-tree status with `.beads/` paths excluded, and whether the tree is dirty
    - [ ] Given `validate-git-town.sh` exit codes 3 or 4, or a branching strategy action of halt, when run, then the status is `REFUSED`
    - [ ] Given an unresolvable PR backend and an interactive run, when run, then the status is `NEEDS_CHOICE` listing `gh`, `ado`, `manual` and the flag that supplies the answer
    - [ ] Given an unresolvable PR backend and a non-interactive run, when run, then it is `REFUSED` printing the `ENSEMBLE_PR_BACKEND=<ado|manual|gh>` options
    - [ ] Given a resolved backend, when `--pr-backend` or `ENSEMBLE_PR_BACKEND` is set, then it is used and never persisted
    - [ ] Given the run, when it completes, then nothing in the tree or tracker has changed
    - [ ] Given `--preflight`, when run, then the engine runs the toolchain preflight with the required capability list for the mode (the plan-only mode omits the agent-registration requirement), returns the `runId`, and treats the optional capabilities as degradable
    - [ ] Given a preflight health failure, when run, then the status is `UNAVAILABLE` and the adapter's message is returned verbatim, so the kata message `the kata workspace is not bound. Run kata init --project <name> ...` reaches the user unchanged and nothing has been written

- [ ] **TRD-007-TEST** Environment decisions [verifies TRD-007] [satisfies ARCH] [depends: TRD-007] (3h)
  - Target Files: `packages/development/tests/engine-implement-env.test.js`
  - Test AC:
    - [ ] Scenario: halt on bad git-town -- Given a git-town exit code of 3, When run, Then `REFUSED`
    - [ ] Scenario: backend choice offered -- Given no remote and interactive, When run, Then `NEEDS_CHOICE` with three options and the flag name
    - [ ] Scenario: backend chosen by flag -- Given `--pr-backend manual`, When run, Then the backend is manual and no state is written
    - [ ] Scenario: beads paths ignored -- Given only `.beads/issues.jsonl` modified, When run, Then the tree is reported clean
    - [ ] Scenario: read only -- Given the run, When the tree and tracker are hashed before and after, Then they are identical
    - [ ] Scenario: preflight list by mode -- Given plan-only and execute modes, When `--preflight` runs, Then each calls preflight with its own required capabilities
    - [ ] Scenario: health failure verbatim -- Given an unbound kata workspace, When `--preflight` runs, Then `UNAVAILABLE` carries the adapter message unchanged and no work item exists

- [ ] **TRD-008** `implement resume`: TRD selection, epic discovery, staleness and strategy [satisfies ARCH] [depends: TRD-003] [depends: TRD-005] (7h)
  - Target Files: `packages/development/lib/engine/verbs/implement-resume.js`
  - Implementation AC:
    - [ ] Given a TRD, when run, then TRD_SLUG and TRD_LABEL are derived by the skill's rule, and the TRD must contain `## Master Task List` and at least one task line or the status is `REFUSED`
    - [ ] Given the tracker, when listed, then an open epic titled `[trd:<slug>]` sets IS_RESUME and ROOT_EPIC_ID, and the closed and open task counts are returned
    - [ ] Given a fresh run and a dirty tree, when run, then `REFUSED`; given a resume and a dirty tree, then the output notes it and continues
    - [ ] Given a fresh run, when the staleness gate is evaluated, then it is a pure function of file ages and `git ls-files` drift and returns pass or the named stale reason; on resume it is skipped
    - [ ] Given the design readiness score, when evaluated, then at or above the pass threshold passes, between the warn and pass thresholds warns (continue when non-interactive), below warn is `REFUSED` suggesting refine-trd, and absent is noted, with thresholds from policy
    - [ ] Given a strategy argument, a TRD declaration, a constitution default or neither, when resolved, then precedence is argument, TRD, constitution, detection table from policy, then `tdd`
    - [ ] Given no `.md` argument, when run, then the TRD is the one named by a search of `docs/TRD`, else the single in-progress TRD, else `NEEDS_CHOICE` listing candidates; an unresolvable TRD is `REFUSED`
    - [ ] Given the TRD, when run, then `trd validate` must return ok, any error is `REFUSED` with the orphaned annotations named, warnings continue, and the test approach is resolved through `resolve-bdd`
    - [ ] Given `--execute` and no existing epic, when run, then it is `REFUSED` with `--execute requires an existing bead scaffold. Run /ensemble:implement-trd-tasks --plan first.`
    - [ ] Given any state, when run, then it never stashes, commits, checks out or cleans the user's paths to satisfy a gate

- [ ] **TRD-008-TEST** Resume and gate decisions [verifies TRD-008] [satisfies ARCH] [depends: TRD-008] (4h)
  - Target Files: `packages/development/tests/engine-implement-resume.test.js`
  - Test AC:
    - [ ] Scenario: resume detected -- Given a tracker with an open `[trd:x]` epic, When run, Then IS_RESUME is true with the epic id and counts
    - [ ] Scenario: fresh dirty tree refused -- Given no epic and a dirty tree, When run, Then `REFUSED`
    - [ ] Scenario: readiness bands -- Given scores 4.2, 3.5 and 2.9, When run, Then pass, warn and `REFUSED`
    - [ ] Scenario: policy moves the band -- Given a repository threshold of 3.5, When run with 3.6, Then it passes
    - [ ] Scenario: strategy precedence -- Given an argument and a TRD declaration, When resolved, Then the argument wins
    - [ ] Scenario: missing master task list -- Given a TRD without the heading, When run, Then `REFUSED` naming the heading
    - [ ] Scenario: TRD selection by search -- Given a TRD name fragment and two candidates, When run, Then `NEEDS_CHOICE` lists both
    - [ ] Scenario: traceability error refused -- Given a TRD with an orphaned satisfies annotation, When run, Then `REFUSED` naming it
    - [ ] Scenario: execute needs a scaffold -- Given `--execute` and no epic, When run, Then `REFUSED` with the exact message
    - [ ] Scenario: tree never mutated -- Given a dirty tree on a fresh run, When run, Then the tree is byte-identical afterwards

- [ ] **TRD-009** `implement team`: roster and agent alias map [satisfies ARCH] [depends: TRD-002] [depends: TRD-005] (4h)
  - Target Files: `packages/development/lib/engine/verbs/implement-team.js`
  - Implementation AC:
    - [ ] Given a TRD with a `team:` block, when run, then TEAM_ROLES is that block; otherwise `resolveDefaultTeamRoles` supplies the default roster
    - [ ] Given the agent definitions under `packages/*/agents/*.yaml` and the installed runtime agents, when run, then AGENT_ALIAS_MAP maps each unqualified name to `<plugin>:<name>`, with an exact unqualified entry winning over an alias
    - [ ] Given a roster agent with no alias, when run, then the status is `REFUSED` naming the agent
    - [ ] Given the roster, when run, then one `Team mode` log line is returned as data and TEAM_ROLES_JSON is emitted compactly in sorted key order
    - [ ] Given the deprecated `--builder` or `builder_agent`, when present, then the compatibility roster is produced

- [ ] **TRD-009-TEST** Roster and alias decisions [verifies TRD-009] [satisfies ARCH] [depends: TRD-009] (3h)
  - Target Files: `packages/development/tests/engine-implement-team.test.js`
  - Test AC:
    - [ ] Scenario: TRD roster wins -- Given a TRD team block, When run, Then TEAM_ROLES equals it
    - [ ] Scenario: default roster -- Given no block, When run, Then eight roles are returned
    - [ ] Scenario: alias resolved -- Given `backend-developer` defined in a package, When run, Then it maps to its namespaced id
    - [ ] Scenario: missing alias refused -- Given a roster agent with no definition, When run, Then `REFUSED` names it
    - [ ] Scenario: deterministic output -- Given two runs on the same inputs, When compared, Then the output is byte-equal

- [ ] **TRD-010** `implement branch`: branch intent and PR plan [satisfies ARCH] [depends: TRD-003] [depends: TRD-005] [depends: TRD-006] (6h)
  - Target Files: `packages/development/lib/engine/verbs/implement-branch.js`
  - Implementation AC:
    - [ ] Given the saved choices, the PR plan and the requested flags, when run, then resolution order is `--branch`, then `--use-current-branch` (refused on a detached HEAD), then the single local branch whose last segment equals the slug, then the saved choice
    - [ ] Given none of those and an interactive run, when run, then the status is `NEEDS_CHOICE` with the three branch-intent options and the flag that supplies the answer
    - [ ] Given none of those and a non-interactive run, when run, then the proposed branch is used and recorded as the decision
    - [ ] Given reuse of an existing branch, when run, then PR_ACTIONS is rewritten so the completion entry has `createPr` true and the stated branch, as the reference defines
    - [ ] Given a resolved plan, when `--apply` is passed, then the branch is created through the workflow capability and the choices are written back, and a write failure is a warning
    - [ ] Given the output, when read, then STACKED_PRS, PR_ACTIONS, CURRENT_PHASE_BRANCH, PHASE_BRANCH_MAP and PHASE_PR_MAP are all present
    - [ ] Given the proposed branch is used and exists locally, when applied, then it is switched to; when it does not exist, then it is created from the remote's default branch (fallback `main`) through `workflow.branch-create`; given the proposed branch is not used and does not exist, then `REFUSED`
    - [ ] Given a resolved plan, when run, then an execution-plan summary (TRD, mode, strategy, proposed branch, current branch, PR topology) is returned as data before any mutating step

- [ ] **TRD-010-TEST** Branch and PR plan decisions [verifies TRD-010] [satisfies ARCH] [depends: TRD-010] (4h)
  - Target Files: `packages/development/tests/engine-implement-branch.test.js`
  - Test AC:
    - [ ] Scenario: explicit branch wins -- Given `--branch feature/x`, When run, Then it is chosen over detection
    - [ ] Scenario: detached head refused -- Given a detached HEAD and `--use-current-branch`, When run, Then `REFUSED`
    - [ ] Scenario: auto detect -- Given exactly one local branch ending in the slug, When run, Then it is chosen
    - [ ] Scenario: interactive choice offered -- Given nothing resolvable and interactive, When run, Then `NEEDS_CHOICE`
    - [ ] Scenario: reuse rewrites actions -- Given reuse mode, When run, Then the completion action has `createPr` true
    - [ ] Scenario: dry by default -- Given no `--apply`, When run, Then no branch is created
    - [ ] Scenario: proposed branch created from default -- Given the proposed branch absent, When applied, Then it is created from the remote default
    - [ ] Scenario: existing branch required -- Given proposed-branch use off and no such branch, When run, Then `REFUSED`

### PR 3: Scaffold the bead hierarchy

**Shippable State:** A maintainer can run `ensemble implement scaffold <trd>` and get the full epic, story and task bead hierarchy with its dependency edges, re-run it after a crash without creating a duplicate, and run `ensemble implement bead-health <trd>` to see exactly which edges, labels or reference blocks differ from the TRD.

- [ ] **TRD-011** `implement scaffold`: idempotent hierarchy creation [satisfies ARCH] [depends: TRD-003] [depends: TRD-005] [depends: TRD-008] (7h)
  - Target Files: `packages/development/lib/engine/verbs/implement-scaffold.js`
  - Implementation AC:
    - [ ] Given a TRD, when run, then the epic, stories, tasks and synthesised tests are created in plan order from `scaffold-plan` and nothing is re-derived
    - [ ] Given beads already present, when run, then each title prefix found in one `tracker.list` cache is reused and a missing one is looked up by external key before creating
    - [ ] Given a crash after N beads, when re-run, then no duplicate is created and the output reports created, reused and skipped counts
    - [ ] Given the plan's dependency edges, when run, then each is added once, an existing edge is a no-op, an unresolvable endpoint is reported, and stale inter-phase edges from older scaffolds are removed
    - [ ] Given `tracker.dep-add` is unavailable, when run, then the edges are warned once and skipped, and the status is still `OK` with the skipped count
    - [ ] Given any create failure or empty id, when run, then the status is `REFUSED` naming the title prefix and nothing further is created
    - [ ] Given the run, when it completes, then it returns ROOT_EPIC_ID, the story id per phase, TRD_TO_BEAD_MAP and PHASE_TASK_IDS
    - [ ] Given the tracker adapter named in the `tracker.list` envelope is kata, when run, then creation uses `scaffold-calls` with `find-by-key` then `tracker.create-detailed`, falling back to `tracker.create` when detailed create is unavailable, and edges use `scaffold-dep-args`
    - [ ] Given a phase N of 2 or more, when run, then the stale edge from the first task bead of phase N to the last task bead of phase N-1 is removed through `tracker.dep-remove`, and an edge-not-found failure is ignored

- [ ] **TRD-011-TEST** Scaffold idempotence and failure handling [verifies TRD-011] [satisfies ARCH] [depends: TRD-011] (4h)
  - Target Files: `packages/development/tests/engine-implement-scaffold.test.js`, `packages/development/tests/fixtures/engine/tracker-stub.js`
  - Test AC:
    - [ ] Scenario: fresh scaffold -- Given an empty tracker stub, When run, Then the stub holds one epic, N stories, M tasks and the plan's edges
    - [ ] Scenario: re-run creates nothing -- Given a completed scaffold, When run again, Then created is 0 and reused equals the bead count
    - [ ] Scenario: resume after crash -- Given a stub that fails on the 10th create, When run twice, Then the second run completes with no duplicates
    - [ ] Scenario: empty id refused -- Given a create returning no id, When run, Then `REFUSED` and no later bead exists
    - [ ] Scenario: stale edge removed -- Given an inter-phase edge from an older scaffold, When run, Then it is removed
    - [ ] Scenario: map returned -- Given a completed run, When read, Then TRD_TO_BEAD_MAP covers every task id
    - [ ] Scenario: kata path -- Given a stub whose envelope names kata, When run, Then beads are created through `scaffold-calls` and the same end state results
    - [ ] Scenario: detailed create unavailable -- Given `create-detailed` unavailable, When run, Then `tracker.create` is used and nothing fails
    - [ ] Scenario: stale edge not found ignored -- Given no stale edge exists, When run, Then removal reports not-found and the run still succeeds

- [ ] **TRD-012** `implement bead-health`, labels, Foreman tagging and `reset-task` [satisfies ARCH] [depends: TRD-011] (6h)
  - Target Files: `packages/development/lib/engine/verbs/implement-bead-health.js`
  - Implementation AC:
    - [ ] Given a scaffolded TRD, when run, then live edges are diffed against the plan and the output lists missing and extra edges
    - [ ] Given the work-graph capability, when available, then cycle and stale-blocker findings are returned and a non-empty `findings` is `REFUSED`; when unavailable it is warned and skipped
    - [ ] Given scoped beads, when run, then the count lacking a `## References` block is returned and `bead-context` failures are listed with every missing entry
    - [ ] Given `--label`, when run, then scoped beads are labelled through `beads-label`, an unavailable backend is a warning, and any other failure is `REFUSED`
    - [ ] Given `--foreman`, when run, then task beads are tagged for dispatch per the reference and only after the work-graph step succeeded
    - [ ] Given the run without `--label` or `--foreman`, when it completes, then the tracker is unchanged
    - [ ] Given `reset-task TRD-XXX`, when run, then beads whose title contains `[trd:<slug>:task:<id>]` are selected: exactly one is set to open; none is `REFUSED` with `No bead found for TASK_ID=<id> with TRD_SLUG=<slug>`; several is `REFUSED` with `Multiple beads match - ambiguous TASK_ID, please be more specific`
    - [ ] Given `--foreman` tagging, when run, then only task-level beads are labelled `foreman-exec` (never the epic or stories), the tracker is synced, and a `tracker.list` count for that label that differs from the number tagged is `REFUSED` with `foreman-exec tagging incomplete`

- [ ] **TRD-012-TEST** Bead health and labelling [verifies TRD-012] [satisfies ARCH] [depends: TRD-012] (3h)
  - Target Files: `packages/development/tests/engine-implement-bead-health.test.js`
  - Test AC:
    - [ ] Scenario: edge drift reported -- Given a stub missing one edge, When run, Then it is listed as missing
    - [ ] Scenario: cycle refused -- Given a work-graph finding, When run, Then `REFUSED` with the finding
    - [ ] Scenario: references counted -- Given two beads without a references block, When run, Then the count is 2
    - [ ] Scenario: read only by default -- Given no flags, When the stub is hashed before and after, Then it is unchanged
    - [ ] Scenario: label backfill -- Given unlabelled beads and `--label`, When run, Then they are labelled and a re-run reports them as already labelled
    - [ ] Scenario: reset one bead -- Given exactly one matching task bead, When `reset-task` runs, Then it is set to open
    - [ ] Scenario: reset none or ambiguous refused -- Given zero or two matching beads, When run, Then `REFUSED` with the exact message for each
    - [ ] Scenario: foreman tags tasks only -- Given a scaffold, When tagging runs, Then no epic or story carries the label and a count mismatch is refused

### PR 4: Quality gates and closure

**Shippable State:** After a phase's beads are closed, a maintainer can run `ensemble implement gate` and see the phase's tests run and the result recorded on its story, with a refusal that names the failing tests; `ensemble implement verify` produces the completion verdict and gap list, and `ensemble implement close` closes the epic and syncs the TRD checkboxes only when every precondition holds.

- [ ] **TRD-013** `implement gate`: per-phase quality gate [satisfies ARCH] [depends: TRD-003] [depends: TRD-005] [depends: TRD-011] (6h)
  - Target Files: `packages/development/lib/engine/verbs/implement-gate.js`
  - Implementation AC:
    - [ ] Given the tracker, when run, then closed task ids are derived from bead titles and `phase-status` identifies each complete, not-yet-closed phase
    - [ ] Given a complete phase, when run, then the phase's tests run through `test-runner.run` and the output carries passed, failed, skipped, total and failures by file and line
    - [ ] Given the strategy, when it is in the informational set from policy, then a failure does not refuse; otherwise a failure is `REFUSED` with the failing tests named
    - [ ] Given the result, when recorded, then a quality-gate comment is added to the story bead before any state change
    - [ ] Given single-PR mode, when the gate passes, then the story is closed with a templated reason of at least the policy minimum length and the HEAD sha, and the checkpoint commit is made through `workflow.commit` with only the TRD's beads staged
    - [ ] Given stacked mode, when the gate passes, then the story is not closed and the output states that a pre-PR test run and a local review are the next required steps
    - [ ] Given the same phase run twice, when re-run, then the comment and close are not duplicated
    - [ ] Given a failing gate under `tdd`, `refactor` or `bug-fix` in an interactive run, when run, then the status is `NEEDS_CHOICE` with the options fix, skip and abort and the flag that supplies the answer; non-interactively it is `REFUSED`

- [ ] **TRD-013-TEST** Phase gate decisions [verifies TRD-013] [satisfies ARCH] [depends: TRD-013] (4h)
  - Target Files: `packages/development/tests/engine-implement-gate.test.js`
  - Test AC:
    - [ ] Scenario: gate passes and closes -- Given a complete phase, passing tests and single-PR mode, When run, Then the story is closed and a checkpoint commit is made
    - [ ] Scenario: gate can fail -- Given failing tests under `tdd`, When run, Then `REFUSED` naming the failing tests and no close
    - [ ] Scenario: informational strategy -- Given failing tests under `characterization`, When run, Then it does not refuse
    - [ ] Scenario: stacked mode defers close -- Given stacked mode, When the gate passes, Then the story stays open and the next action is stated
    - [ ] Scenario: idempotent -- Given a phase already closed, When run again, Then no second comment or close
    - [ ] Scenario: incomplete phase skipped -- Given one open task bead, When run, Then that phase is not gated
    - [ ] Scenario: interactive failure offers options -- Given failing tests under `tdd` and interactive, When run, Then `NEEDS_CHOICE` lists fix, skip and abort

- [ ] **TRD-014** `implement verify`: completion verification as a deterministic recipe [satisfies ARCH] [depends: TRD-003] [depends: TRD-005] (6h)
  - Target Files: `packages/development/lib/engine/verbs/implement-verify.js`
  - Implementation AC:
    - [ ] Given a TRD and the tracker, when run, then the task inventory comes from `trd-cli parse` and each task is checked against its bead status
    - [ ] Given the requirements, when run, then the requirement to acceptance criterion to code chain is built by `verify-requirements-evidence` and a requirement with no satisfying closed task is a gap
    - [ ] Given the tests, when run, then the full suite runs through `package-runner.run-script` and a failure is a gap
    - [ ] Given the gaps, when counted, then `gapCount` equals the length of the gap list and the verdict is `COMPLETE` only when it is 0
    - [ ] Given the run, when it completes, then a report file is written under the TRD's report path and `reportPath` is returned
    - [ ] Given the same inputs, when run twice, then the verdict and the gap list are identical

- [ ] **TRD-014-TEST** Verification verdicts [verifies TRD-014] [satisfies ARCH] [depends: TRD-014] (4h)
  - Target Files: `packages/development/tests/engine-implement-verify.test.js`
  - Test AC:
    - [ ] Scenario: complete -- Given every task closed, every requirement satisfied and tests passing, When run, Then `COMPLETE` with 0 gaps
    - [ ] Scenario: open task is a gap -- Given one task bead open, When run, Then `INCOMPLETE` and the gap names the task
    - [ ] Scenario: unsatisfied requirement -- Given a requirement no closed task satisfies, When run, Then it is a gap
    - [ ] Scenario: failing suite is a gap -- Given a failing test run, When run, Then `INCOMPLETE`
    - [ ] Scenario: count matches list -- Given any run, When read, Then `gapCount` equals the list length
    - [ ] Scenario: deterministic -- Given two runs, When compared, Then the verdict and gaps are equal

- [ ] **TRD-015** `implement close`, `sync-checkboxes` and `report` [satisfies ARCH] [depends: TRD-013] [depends: TRD-014] (6h)
  - Target Files: `packages/development/lib/engine/verbs/implement-close.js`
  - Implementation AC:
    - [ ] Given a verification verdict, when `close` runs, then it proceeds only on `COMPLETE` or an explicit `--override-incomplete`, and a non-interactive `INCOMPLETE` is `REFUSED` before any change
    - [ ] Given the completion action, when it is single-PR mode, then the whole-branch local review result must be `LOCAL_REVIEW_COMPLETE`, and a missing or unparseable result is `REFUSED`; a missing completion entry is never treated as skipped
    - [ ] Given open task or story beads for the TRD, when listed, then any open bead, or a listing that fails or cannot be parsed, is `REFUSED`
    - [ ] Given all preconditions, when run, then the epic is closed with a templated reason of at least the policy minimum length and the HEAD sha
    - [ ] Given `sync-checkboxes`, when run, then each Master Task List task whose bead is closed changes from `- [ ]` to `- [x]`, only that file is staged with the TRD's beads, and the commit message is the fixed one; a re-run changes nothing
    - [ ] Given `sync-checkboxes`, when the TRD file changed since it was read, then it is `REFUSED` on a hash mismatch
    - [ ] Given `report`, when run, then it returns the TRD status, branch, strategy, epic id, per-requirement SATISFIED or NOT VERIFIED and the total

- [ ] **TRD-015-TEST** Closure preconditions and checkbox sync [verifies TRD-015] [satisfies ARCH] [depends: TRD-015] (4h)
  - Target Files: `packages/development/tests/engine-implement-close.test.js`
  - Test AC:
    - [ ] Scenario: close refused when incomplete -- Given verdict `INCOMPLETE` and non-interactive, When run, Then `REFUSED` and the epic is still open
    - [ ] Scenario: close refused with open beads -- Given one open task bead, When run, Then `REFUSED`
    - [ ] Scenario: unparseable listing refused -- Given a listing that cannot be parsed, When run, Then `REFUSED` as if beads remained
    - [ ] Scenario: review gate enforced -- Given single-PR mode and no review result, When run, Then `REFUSED`
    - [ ] Scenario: checkboxes synced -- Given two closed task beads, When run, Then exactly those two lines flip
    - [ ] Scenario: sync idempotent and hash guarded -- Given a second run, Then no change; Given the file edited in between, Then `REFUSED`

### PR 5: Hand-off to the model, the review loop and PRs

**Shippable State:** The engine can pause with a validated hand-off and resume from the model's result: `ensemble review run` drives a full local review round and ends in a pass or a named block, `ensemble implement pr` opens phase and completion PRs with the model supplying only the Risk and How-to-revert text, and a malformed or stale model result is refused instead of repaired.

- [ ] **TRD-016** Hand-off protocol and `implement accept` [satisfies ARCH] [depends: TRD-002] [depends: TRD-005] (6h)
  - Target Files: `packages/development/lib/engine/handoff.js`, `packages/development/lib/engine/roles.js`, `packages/development/lib/engine/verbs/implement-accept.js`
  - Implementation AC:
    - [ ] Given a step that needs judgement, when the engine returns, then the status is `NEEDS_AGENT` with `agents[]` carrying name, role, briefPath, outPath, prompt and deadlineAtIso, the recorded base HEAD sha, and a `next` naming `implement accept`
    - [ ] Given a result file, when accepted, then its path must sit under `.ensemble/state/engine/<runId>/results/`, its size is capped, and it validates against the role's schema with `additionalProperties: false`
    - [ ] Given a result recorded against an earlier HEAD, when accepted, then it is `REFUSED` as stale
    - [ ] Given the step's precondition, when accepted, then it is re-derived from live state and not taken from the manifest
    - [ ] Given a malformed, oversized, escaped or stale result, when accepted, then the engine refuses it and never repairs or partially applies it
    - [ ] Given the roles `builder-wave`, `reviewer` and `pr-prose`, when registered, then each has an input brief schema and a result schema in the registry and `--describe`
    - [ ] Given a non-interactive run, when a `NEEDS_CHOICE` is reached, then it resolves from policy or is `REFUSED` with the exact flag to pass

- [ ] **TRD-016-TEST** Hand-off validation [verifies TRD-016] [satisfies ARCH] [depends: TRD-016] (4h)
  - Target Files: `packages/development/tests/engine-handoff.test.js`
  - Test AC:
    - [ ] Scenario: manifest shape -- Given a verb needing an agent, When it returns, Then the manifest has the agents fields, the HEAD sha and a next
    - [ ] Scenario: valid result accepted -- Given a schema-valid result under the results directory, When accepted, Then it is recorded
    - [ ] Scenario: malformed refused -- Given a result with an unknown key, When accepted, Then `INVALID_INPUT` and nothing recorded
    - [ ] Scenario: stale head refused -- Given HEAD moved after the manifest, When accepted, Then `REFUSED`
    - [ ] Scenario: escape refused -- Given a result path outside the results directory, When accepted, Then `PATH_ESCAPE`
    - [ ] Scenario: precondition re-derived -- Given the live state no longer satisfies the step, When accepted, Then `REFUSED` regardless of the manifest

- [ ] **TRD-017** `review run`: the local review loop host [satisfies ARCH] [depends: TRD-003] [depends: TRD-016] (5h)
  - Target Files: `packages/development/lib/engine/verbs/review-run.js`
  - Implementation AC:
    - [ ] Given a base and head sha and a PR id, when run, then it calls `review-run-cli` prepare and returns `NEEDS_AGENT` carrying the `agents[]` from the DISPATCH manifest unedited
    - [ ] Given the agents' result files, when `review run --collect` is called, then it calls collect and returns `NEEDS_AGENT` again for a further wave, an adjudication or triage request, or a final status
    - [ ] Given the final status, when read, then only `LOCAL_REVIEW_COMPLETE` is a pass and any other, missing or unparseable status is a named block with the report path
    - [ ] Given the head moved or the PR is not open, when collected, then the runner's `RUN_INVALIDATED` is surfaced as `REFUSED`
    - [ ] Given the engine, when it runs, then it never composes a brief, tallies a vote or sets a status itself; those stay in the review runner
    - [ ] Given `--mode remote` for a stacked phase PR, when run, then the status is informational: it never refuses and never blocks closure, an unrecognised result is recorded as `REVIEW_PENDING`, and a phase whose PR was never created is reported as pending with no PR

- [ ] **TRD-017-TEST** Review loop behaviour [verifies TRD-017] [satisfies ARCH] [depends: TRD-017] (4h)
  - Target Files: `packages/development/tests/engine-review-run.test.js`
  - Test AC:
    - [ ] Scenario: dispatch passthrough -- Given a prepared round, When run, Then the agents equal the runner's manifest exactly
    - [ ] Scenario: further wave -- Given collect returns PENDING, When called, Then `NEEDS_AGENT` again
    - [ ] Scenario: pass only on complete -- Given statuses DONE with open findings, When read, Then it is a block, not a pass
    - [ ] Scenario: invalidated head -- Given the head moved, When collected, Then `REFUSED`
    - [ ] Scenario: engine adds no judgement -- Given a runner result, When wrapped, Then the verdict equals the runner's with no engine-side change
    - [ ] Scenario: remote is informational -- Given a remote review that is blocked, When run, Then the status is reported and the exit code is 0

- [ ] **TRD-018** `implement pr`: phase and completion pull requests [satisfies ARCH] [depends: TRD-003] [depends: TRD-010] [depends: TRD-013] [depends: TRD-016] (6h)
  - Target Files: `packages/development/lib/engine/verbs/implement-pr.js`, `packages/development/lib/engine/templates/pr-body.md`
  - Implementation AC:
    - [ ] Given a phase gate result and `PR_ACTIONS[N]`, when run, then the pre-PR full test run must pass or the status is `REFUSED`, and the base is the action's parent branch
    - [ ] Given the PR backend, when run, then `gh` with git-town uses propose, `gh` with plain git pushes then creates the change request, `ado` returns a hand-off for the Azure DevOps tool, and `manual` returns the exact commands
    - [ ] Given the body template, when rendered, then it carries the shippable state, strategy, task ids, coverage and story bead id, and Testing, Risk, How to revert and a `Directed by` line naming the person who asked, never the agent
    - [ ] Given the Risk and How-to-revert sections, when not supplied, then the status is `NEEDS_AGENT` for role `pr-prose`; when supplied they are validated and inserted unedited
    - [ ] Given the rendered body, when graded by the PR-description grader with agent authorship, then a failing grade is `REFUSED` naming the missing section
    - [ ] Given a created PR, when run, then its URL is returned for PHASE_PR_MAP and the PR is never described as merged or landed
    - [ ] Given the `ado` backend with the Azure DevOps tool connected, when run, then the hand-off names that tool's create-pull-request call, and without it the change-request capability is used and a failure there prints manual instructions without refusing
    - [ ] Given the `manual` backend, when run, then the exact push and create commands are returned for the user and nothing is pushed or created, at every phase gate where a PR is due
    - [ ] Given stacked mode with git-town, when the next branch is appended, then the engine returns git-town's native stacked-append instruction rather than a capability call, as the reference documents

- [ ] **TRD-018-TEST** PR creation and body grading [verifies TRD-018] [satisfies ARCH] [depends: TRD-018] (4h)
  - Target Files: `packages/development/tests/engine-implement-pr.test.js`
  - Test AC:
    - [ ] Scenario: tests gate the PR -- Given failing full tests, When run, Then `REFUSED` and no PR is created
    - [ ] Scenario: backend switch -- Given each of the four backends, When run, Then the matching operation or hand-off is produced
    - [ ] Scenario: prose requested -- Given no Risk text, When run, Then `NEEDS_AGENT` for `pr-prose`
    - [ ] Scenario: body graded -- Given a body missing How to revert, When graded, Then `REFUSED` names the section
    - [ ] Scenario: directed-by is a person -- Given the authenticated login, When rendered, Then the line names that login and not the agent
    - [ ] Scenario: never merged -- Given a created PR, When the output is read, Then it never claims merged
    - [ ] Scenario: ado fallback -- Given no Azure DevOps tool, When run, Then the change-request capability is used
    - [ ] Scenario: manual does nothing -- Given the manual backend, When run, Then no push or PR is made and the commands are returned

- [ ] **TRD-019** `implement delegate`: the execution hand-off to beads-build [satisfies ARCH] [depends: TRD-003] [depends: TRD-011] [depends: TRD-012] [depends: TRD-016] (4h)
  - Target Files: `packages/development/lib/engine/verbs/implement-delegate.js`
  - Implementation AC:
    - [ ] Given a missing ROOT_EPIC_ID, when run, then the status is `REFUSED` with the stated message
    - [ ] Given the scoped beads, when run, then labels are backfilled, the references health check runs and every missing entry is listed before `REFUSED`
    - [ ] Given the roster, when run, then TEAM_ROLES_JSON, MAX_PARALLEL, the label, the TRD path and `--defer-completion` are assembled into the exact `beads-build` invocation, in sorted flag order
    - [ ] Given the invocation, when returned, then the status is `NEEDS_AGENT` for role `builder-wave`, with the slash-dispatch form and the skill form for runtimes without slash dispatch
    - [ ] Given the model's summary, when accepted, then a non-zero exit becomes a Debug Loop entry and `REFUSED`, and a zero exit records bead counts, branch state and the last task closed
    - [ ] Given a builder-wave summary with `terminal_state=blocked`, when accepted, then current_phase is the lowest phase with an unclosed task, a task absent from the work-graph ready and plan data is `REFUSED` as `EXECUTION BLOCKED` naming the phase, a task present but unclosed is retried once, and blockers in later phases or static traceability dependencies never refuse

- [ ] **TRD-019-TEST** Delegation payload [verifies TRD-019] [satisfies ARCH] [depends: TRD-019] (3h)
  - Target Files: `packages/development/tests/engine-implement-delegate.test.js`
  - Test AC:
    - [ ] Scenario: epic required -- Given no ROOT_EPIC_ID, When run, Then `REFUSED`
    - [ ] Scenario: health gate -- Given a bead lacking references, When run, Then `REFUSED` listing it
    - [ ] Scenario: invocation exact -- Given a roster and flags, When run, Then the returned command equals the documented invocation with sorted flags
    - [ ] Scenario: both dispatch forms -- Given a runtime without slash dispatch, When run, Then the skill form is returned
    - [ ] Scenario: failure becomes a debug entry -- Given a non-zero summary, When accepted, Then `REFUSED` with a Debug Loop entry
    - [ ] Scenario: blocked wave refused -- Given a blocked summary and a current-phase task absent from the ready list, When accepted, Then `REFUSED` as `EXECUTION BLOCKED`
    - [ ] Scenario: present but unclosed retried -- Given the task is in the ready list, When accepted, Then one retry is requested
    - [ ] Scenario: later-phase blockers ignored -- Given blockers only in later phases, When accepted, Then no refusal

### PR 6: The driver, the thin skill and proof through the real command

**Shippable State:** `/ensemble:implement-trd-tasks` runs through the engine from start to finish: the skill is a short loop of asking `ensemble implement next`, doing what it says, and repeating, a model that tries a step out of order is refused by the engine, and the eval fixture produces the same tracker end state as the prose-driven run.

- [ ] **TRD-020** `implement plan` and `next`: the planner interface and audit ledger [satisfies ARCH] [depends: TRD-007] [depends: TRD-009] [depends: TRD-010] [depends: TRD-012] [depends: TRD-015] [depends: TRD-017] [depends: TRD-018] [depends: TRD-019] (7h)
  - Target Files: `packages/development/lib/engine/plan.js`, `packages/development/lib/engine/ledger.js`, `packages/development/lib/engine/verbs/implement-plan.js`, `packages/development/lib/engine/verbs/implement-next.js`
  - Implementation AC:
    - [ ] Given a TRD and flags, when `implement plan` runs, then it returns the ordered step graph with, per step, its id, verb, kind (`engine`, `agent` or `choice`), preconditions and what it produces, as a pure function of the inputs
    - [ ] Given live tracker, git and file state, when `implement next` runs, then it returns the first step whose preconditions hold and whose completion is not already evident in that state, or the terminal `COMPLETE`, `EXIT` or `REFUSED`
    - [ ] Given `next`, when it decides, then it reads no ledger and no private store: completion is judged from the epic and bead states, git and the TRD file
    - [ ] Given a model that calls a verb whose preconditions do not hold, when run, then the verb refuses with the unmet precondition named, whatever the plan said
    - [ ] Given any verb run with a `--run-id`, when it finishes, then the audit ledger under `.ensemble/state/engine/<runId>/` records the step, input hash, output hash and status, is self-ignoring and is never read to decide
    - [ ] Given two runs on identical state, when `plan` and `next` are compared, then their output is byte-equal
    - [ ] Given the derivation steps `args`, `env`, `team`, `branch` and `resume`, when `next` runs, then it evaluates them itself and returns their results as `context`, so a read-only step is never returned as outstanding work
    - [ ] Given a choice that no existing mechanism persists, when `next` runs without the flag or environment value, then it returns `NEEDS_CHOICE` again rather than assuming an earlier answer

- [ ] **TRD-020-TEST** Planner and precondition enforcement [verifies TRD-020] [satisfies ARCH] [depends: TRD-020] (5h)
  - Target Files: `packages/development/tests/engine-plan-next.test.js`
  - Test AC:
    - [ ] Scenario: plan is deterministic -- Given the same TRD and flags, When `plan` runs twice, Then the output is byte-equal
    - [ ] Scenario: next advances with state -- Given a stub tracker progressing through scaffold, delegate and gate, When `next` is called after each, Then it names the following step each time
    - [ ] Scenario: out of order refused -- Given an unscaffolded TRD, When `implement gate` is called directly, Then `REFUSED` naming the unmet precondition
    - [ ] Scenario: no ledger dependence -- Given the audit ledger deleted, When `next` runs, Then the answer is unchanged
    - [ ] Scenario: terminal states -- Given a closed epic, When `next` runs, Then `COMPLETE`
    - [ ] Scenario: ledger ignored by git -- Given a run that wrote the ledger, When `git status` runs, Then the ledger is not listed
    - [ ] Scenario: derivation folded in -- Given a fresh TRD, When `next` runs, Then `context` carries args, env, team, branch and resume results and the action is the first mutating step
    - [ ] Scenario: unpersisted choice re-asked -- Given no `--pr-backend` and no environment value, When `next` runs twice, Then it returns `NEEDS_CHOICE` both times

- [ ] **TRD-021** Thin the implement-trd-tasks skill to the engine loop [satisfies ARCH] [depends: TRD-020] (6h)
  - Target Files: `packages/development/skills/ensemble-implement-trd-tasks/SKILL.md`, `packages/development/skills/ensemble-implement-trd-tasks/references/phase-1-preflight.md`, `packages/development/skills/ensemble-implement-trd-tasks/references/phase-2-scaffold.md`, `packages/development/skills/ensemble-implement-trd-tasks/references/phase-3-execute.md`, `packages/development/skills/ensemble-implement-trd-tasks/references/phase-4-quality-gate.md`, `packages/development/skills/ensemble-implement-trd-tasks/references/phase-5-completion.md`, `packages/development/skills/implement-trd-tasks-reference/SKILL.md`
  - Implementation AC:
    - [ ] Given the skill, when read, then it tells the model to resolve `ENSEMBLE_CLI`, run `ensemble implement next`, act on the returned step (run the named verb, perform the `NEEDS_AGENT` work and call `accept`, or ask the user for a `NEEDS_CHOICE`), and repeat until a terminal state
    - [ ] Given the mechanical steps, when the skill is rewritten, then none of them is described in prose any more: they are engine verbs, and the skill names the verb instead
    - [ ] Given judgement content (strategy choice guidance, review criteria, PR risk narrative, how to ask the user), when rewritten, then it stays in the skill or a prompt file and is not moved into code (Rule 8)
    - [ ] Given the preserved behaviours (foreman mode, `FOREMAN_ARTIFACT_PATH`, terminal states HALT, EXIT and COMPLETE, the kata starting point), when compared with the old skill, then each has an equivalent in the engine or the skill
    - [ ] Given the generated pi, codex and opencode mirrors, when `npm run generate` and the runtime generators run, then they are regenerated and committed, and the prompt-budget ratchet does not rise
    - [ ] Given a runtime where the engine cannot be resolved, when the skill starts, then it prints the named error and HALTs rather than falling back to improvising the steps
    - [ ] Given the deferred `--legacy-multi` section and the guidance that needs judgement, when the skill is rewritten, then the legacy-multi section is retained verbatim and the strategy, review and risk guidance sections are still present

- [ ] **TRD-021-TEST** Skill and mirror integrity [verifies TRD-021] [satisfies ARCH] [depends: TRD-021] (4h)
  - Target Files: `packages/development/tests/implement-trd-tasks-engine-skill.test.js`
  - Test AC:
    - [ ] Scenario: loop present -- Given the skill text, When read, Then it names `ensemble implement next`, `accept` and the three terminal states
    - [ ] Scenario: no mechanical prose -- Given the skill text, When scanned for the old mechanical step markers, Then none remain
    - [ ] Scenario: behaviours preserved -- Given the preserved-behaviour list, When checked against the skill and the engine registry, Then each has a home
    - [ ] Scenario: mirrors in sync -- Given a regeneration, When `git status --porcelain` runs, Then it is empty
    - [ ] Scenario: budget does not rise -- Given the prompt-budget baseline, When checked, Then the skill's word count is not above it
    - [ ] Scenario: judgement guidance retained -- Given the thin skill, When scanned, Then the strategy, review-criteria and PR-risk guidance sections and the legacy-multi section are present

- [ ] **TRD-022** Entry-point eval harness over the engine [satisfies ARCH] [depends: TRD-020] [depends: TRD-021] (6h)
  - Target Files: `evals/skills/ensemble-implement-trd-tasks/eval.json`, `evals/checks/ensemble-implement-trd-tasks.js`, `evals/tests/skills/ensemble-implement-trd-tasks.test.js`
  - Implementation AC:
    - [ ] Given the existing fixture workspace and TRD, when the eval runs the real command, then the tracker end state (epic, stories, tasks, closed beads, labels, edges) is captured as a normalised snapshot
    - [ ] Given the snapshot from the prose-driven baseline, when compared with the engine-driven run, then they are equal except for fields the eval lists as run-specific
    - [ ] Given the eval, when it asserts, then it asserts through the command entry point and not by calling engine modules directly
    - [ ] Given a scripted fake model, when it answers every `NEEDS_AGENT` and `NEEDS_CHOICE` deterministically, then the whole run is reproducible and runs in CI without a real model

- [ ] **TRD-022-TEST** Proofs that the gates can fail [verifies TRD-022] [satisfies ARCH] [depends: TRD-022] (5h)
  - Target Files: `evals/tests/skills/ensemble-implement-trd-tasks-mutation.test.js`
  - Test AC:
    - [ ] Scenario: gate mutation -- Given the gate verb patched to ignore failing tests, When the eval runs with a failing test, Then the eval fails
    - [ ] Scenario: close mutation -- Given the close verb patched to ignore open beads, When the eval runs with one open bead, Then the eval fails
    - [ ] Scenario: accept mutation -- Given accept patched to skip schema validation, When the eval feeds a malformed result, Then the eval fails
    - [ ] Scenario: precondition mutation -- Given the precondition check removed from `gate`, When the eval calls it out of order, Then the eval fails
    - [ ] Scenario: unpatched run passes -- Given no patches, When the eval runs, Then it passes, so the failures above are caused by the patches

- [ ] **TRD-023** Documentation, versions and changelog [satisfies INFRA] [depends: TRD-004] [depends: TRD-021] (4h)
  - Target Files: `docs/guides/ensemble-engine.md`, `packages/development/README.md`, `packages/development/CHANGELOG.md`, `packages/development/package.json`, `packages/full/package.json`, `packages/pi/package.json`, `marketplace.json`, `.claude-plugin/marketplace.json`, `package-lock.json`
  - Implementation AC:
    - [ ] Given the guide, when read, then it states the engine and model division of labour, the conversion rubric, the envelope and exit-code table, the hand-off protocol and how to add a verb
    - [ ] Given the changed packages (`development`, `full`, `pi`), when versions are bumped, then they are changed in all five places with both marketplace files byte-identical and the changelog entries written below `[Unreleased]`
    - [ ] Given `npm run validate`, when run, then it exits 0
    - [ ] Given the legacy CLIs, when documented, then they are listed as supported entry points whose output is unchanged

## Quality Requirements

### Test coverage

Constitution targets: unit at least 60%, integration at least 50%. Every implementation task has a paired `-TEST` task; TRD-023 (documentation and versions) is verified by `npm run validate` and inspection and has no pair. Tests call `main(argv, ctx)` in process and use one stub tracker and one stub host throughout, with a small number of spawn tests for exit codes and the bundle smoke test.

### Determinism

Every read verb is run twice in its test and its output compared byte for byte. No verb reads the clock or a random source for a decision. Ids come from the caller or from content hashes.

### Performance

`ensemble --describe` completes in under 200 ms on a cold start. Read verbs complete in under 2 s excluding tracker and test subprocess time. The engine adds no polling and no background process.

### Security

Inputs are validated at the boundary, subprocesses use argument arrays with no shell, no verb executes an arbitrary command, results from the model are schema-validated and path-confined, and gates are enforced by the engine rather than by prompt text.

### Compatibility

`trd-cli.js` and `toolchain-cli.js` stay unmodified and supported. CI runs Node 22 and 24. No new runtime dependency is introduced.

### Test discipline

Tests assert only the order the engine itself owns, such as the plan order in which beads are created, and never the interleaving of a stub tracker's writes with the engine's (Constitution Rule 9). Each gate has a mutation test proving it can fail (Rule 7). The engine adds no feature that is not reachable from a registered verb, and the skill reaches every verb through the real command (Rule 6).

### Definition of Done

- [ ] Every verb is registered with schemas and appears in `ensemble --describe`
- [ ] Every gate has a mutation test showing it can fail (Rule 7)
- [ ] The thin skill drives the real command through the engine, proven by the eval (Rule 6)
- [ ] `npm run validate`, the generated-drift checks and the bundle smoke test pass
- [ ] Documentation and versions updated
- [ ] Security-sensitive tasks (TRD-001 and TRD-016) have a human security reviewer before merge, as Constitution section 4 requires, and auto-merge stays off for those PRs

## Design Readiness Scorecard

| Dimension | Score | Basis |
|---|---|---|
| Architecture completeness | 4.3 | Division of labour, envelope, exit codes, hand-off, policy boundary, state model and packaging are specified; codex and opencode vendoring is an open question, not a hole in the design |
| Task coverage | 4.4 | Every deterministic step of the five phases and reference sections 1 to 3 and 5 to 7 maps to a verb; `--legacy-multi` is explicitly deferred; every implementation task has a paired test task (154 implementation criteria, 145 test scenarios) |
| Dependency clarity | 4.2 | All dependencies are declared, acyclic, with no forward or later-PR reference; the critical path is long but measured (see Adversarial Review Resolutions) |
| Estimate confidence | 3.9 | First CLI of this shape in the repo; total 213h with the largest task at 7h; the mount parity work and the packaging validators are the main uncertainty and were given a buffer |
| **Overall** | **4.2** | PASS (4.0 or above) |

## Adversarial Review Resolutions

| Finding | Resolution |
|---|---|
| Read-only derivation steps leave no trace, so `next` could never see them as done | Folded into `next` as a `context` object; only acting steps are surfaced (TRD-020) |
| The kata scaffold path was missing | Added to `implement scaffold` with its own test scenarios (TRD-011) |
| `--reset-task`, the Foreman tagging verification and the stale-edge rule were absent | Added with the reference's exact refusal messages (TRD-011, TRD-012) |
| Blocked-wave recovery was not assigned | Added to the builder-wave accept step (TRD-019) |
| The preflight capability list was left to the model | `implement env --preflight` supplies it per mode, and a health failure is passed through verbatim (TRD-007) |
| TRD selection, traceability validation and test-approach resolution were unassigned | Added to `implement resume` (TRD-008) |
| `ado`, `manual` and git-town stacked-append semantics were under-specified | Specified from the reference (TRD-018) |
| An interactive gate failure needs the fix, skip or abort choice | `NEEDS_CHOICE` with those options (TRD-013) |
| Remote review status must stay informational | Added as `review run --mode remote` (TRD-017) |
| The policy boundary criterion was not objectively checkable | Replaced with a schema rule: numbers, booleans, enums and tables only, no free text over 80 characters (TRD-005) |
| `--legacy-multi` cannot be converted within this scope | Deferred explicitly and retained verbatim in the skill (TRD-021) |
| PR backend and branching strategy are never persisted | Re-supplied on every call, and `next` re-asks (TRD-020) |
| Two sessions could race on one TRD | Documented as unsupported, as today; the engine takes no lock |
| The dependency chain is long: critical path 68h through TRD-001, TRD-002, TRD-003, TRD-008, TRD-011, TRD-013, TRD-015, TRD-020, TRD-021, TRD-022, TRD-022-TEST | Accepted. TRD-005, TRD-006, TRD-007, TRD-009, TRD-010, TRD-012, TRD-014 and TRD-016 to TRD-019 sit off that chain and can be built in parallel; only the PR stack merges in order |
| Estimates for the mount parity, packaging, resume and scaffold tasks looked optimistic | Raised to 7h each, and TRD-012 to 6h |
| Dependencies were declared but incomplete: the registry came before the envelope it returns, and the mount task declared none; found when the live tracker's ready set was compared with the plan after the first scaffold | The envelope is now TRD-001 and the registry TRD-002 depends on it; TRD-003 depends on the registry; a check now asserts a single root task and that every task reaches the envelope and every verb task reaches the registry |

## Open Questions

1. **Bin on PATH.** The only end-user bin precedent is `packages/full/bin/jira`. This TRD follows it. Confirm that putting `ensemble` on PATH through the plugin is wanted, or whether the CLI should stay reachable only through skills.
2. **Package location.** The engine lives in `packages/development/lib/engine/` because that is where `trd-cli` and `toolchain-cli` live and where pi vendoring already reaches. A dedicated `packages/engine` package would need its own plugin manifest and vendoring work.
3. **codex and opencode.** Neither bundle vendors `packages/development/lib` today. Extending `toolchain-vendor.js` to carry the engine is a follow-up TRD.
4. **Policy file format.** `.ensemble/engine.yaml` mirrors `toolchain.yaml` and reuses `js-yaml`. A JSON file would avoid the parser dependency; YAML was chosen for consistency.
5. **Legacy CLIs.** They remain supported entry points. Whether to deprecate them after the engine is established is a later decision.

## Capability Traceability

| Capability | Provided by |
|---|---|
| `deterministic-engine-cli` | TRD-001, TRD-002, TRD-003, TRD-004, TRD-005 |
| `llm-engine-handoff` | TRD-016, TRD-017, TRD-018, TRD-019 |
| `implement-trd-orchestration` | TRD-006 to TRD-015, TRD-020, TRD-021, TRD-022 |

Tasks verified by inspection and `npm run validate` rather than a paired test: TRD-023.

## Files this TRD creates

`packages/development/lib/ensemble-cli.js`, `packages/development/lib/engine/` (registry, argv, describe, envelope, validate, mount, policy, handoff, roles, plan, ledger, groups, verbs, templates, policy defaults), `packages/full/bin/ensemble`, `docs/guides/ensemble-engine.md`, and the test and fixture files named in each task.
