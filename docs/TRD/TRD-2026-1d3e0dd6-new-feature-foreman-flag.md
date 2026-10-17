---
document_id: TRD-2026-1d3e0dd6
label: trd-new-feature-foreman-flag
kind: trd
prd_reference: PRD-2026-1d3e0dd6
prd_path: docs/PRD/PRD-2026-1d3e0dd6-new-feature-foreman-flag.md
version: 1.0.1
status: Draft
date: 2026-10-15
design_readiness_score: 4.4
Constitution compliance: passed
---

# TRD-2026-1d3e0dd6: `--foreman` Flag for `/ensemble:new-feature`

Based on PRD: docs/PRD/PRD-2026-1d3e0dd6-new-feature-foreman-flag.md

## Architecture Decision

**Chosen approach:** a prompt-only change to two YAML command sources. No TypeScript changes.

- `packages/development/commands/new-feature.yaml` gains a boolean `foreman` parameter and one derived variable, `FOREMAN`, defined once in Entry Point Resolution Step 1 and referenced by every later step. Each step that asks the user gets a `FOREMAN == true` branch that takes a deterministic, recorded, non-interactive decision. Each step that dispatches a stage skill appends `--foreman` when `FOREMAN == true`.
- `packages/development/commands/feature.yaml` (the `/ensemble:feature` front door) recognizes `--foreman` as the first token after the keyword and forwards it.
- Generated OMP, Pi and Codex artifacts are regenerated from the repo root, never hand-edited.

**Why prompt-only (Constitution Rule 8):** how a workflow behaves when no one can answer is something a maintainer would plausibly tune (for example, switching the PR gate to park instead of auto-grant). That belongs in the command prose, not in TypeScript. `RunIndexStore` already supports everything needed: `StageOutcome.detail` carries the "granted by `--foreman` policy" record.

**Additive-only edits (found in refinement):** the existing suites (`new-feature-command.test.js`, `feature-command.test.js`, `feature-input-validation-boundary.test.js`, `feature-concurrency-passthrough.test.js`) pin exact sentences in both YAML files, for example "any remaining text is an unsupported flag or argument rejected here". So no pre-existing sentence may be reworded or removed. Foreman behavior is added as new actions or appended sentences, and the existing suites must pass unchanged. For the front door that means: a new action, placed before the validation action, removes a leading `--foreman` token and sets `FOREMAN`, so the pinned validation sentences still read "remaining text" correctly; and a new action, placed after the invocation is constructed, inserts `--foreman` right after `/ensemble:new-feature` in whatever invocation was built.

**Alternatives rejected:**
- *Env-var-only detection (no flag).* Rejected: the maintainer asked for a `--foreman` flag, and the five stage skills already key on that flag.
- *A new RunRecord field `autoGranted`.* Rejected: TypeScript and schema change for information `StageOutcome.detail` already carries.
- *Parking at the approval gates.* Rejected by the maintainer: it stalls every no-user run.

## Domain Analysis

- **`FOREMAN` variable:** true iff the `--foreman` argument is present. It is the only switch; nothing infers it from the environment.
- **Question inventory in `new-feature.yaml`** (every place a user is asked or a user decision is awaited today): Entry Step 4 retry confirmation; Entry Step 5 event-payload review; Entry Step 6 abandon confirmation; Phase 3 Step 2 accept/decline/edit of stage output; Phase 3 Step 5 implementation approval; Phase 3 Step 6 PR opt-in and PR approval.
- **Decision under `--foreman` at each:** retry once, no prompt; event payload never auto-approved; abandon without confirmation; stage output auto-accepted; implementation approval auto-granted and recorded; PR opt-in and approval auto-granted and recorded.
- **Hard stops unchanged:** `RUN_ALREADY_ACTIVE`, `--skip-refine` rejection, stage-skill hard HALTs, `--status` read-only, no in-invocation retry loop, the `prApprovedAt`/`implementationApprovedAt` store-persisted precondition.

## Companion Artifacts

None. This TRD does not create standalone design documents.

## Reused Capabilities

- The `foreman` parameter and non-interactive semantics of `create-prd`, `refine-prd`, `create-trd`, `refine-trd` and `implement-trd-beads` (unchanged).
- `RunIndexStore.mutate()` / `abandon()` / `findActive()`, `StageOutcome.detail` (unchanged).
- The existing command tests (`new-feature-command.test.js`, `feature-command.test.js`, `feature-input-validation-boundary.test.js`, `feature-concurrency-passthrough.test.js`) as the style reference; they must keep passing.

## System Architecture

### Components and boundaries

| Component | Change |
|-----------|--------|
| `packages/development/commands/new-feature.yaml` | New parameter, `FOREMAN` variable, foreman branches at six question points, `--foreman` forwarding, hard-stop invariants. |
| `packages/development/commands/feature.yaml` | First-token `--foreman` recognition and forwarding for all four keywords. |
| `packages/development/tests/new-feature-foreman.test.js` (new) | Behavior/invariant tests over the parsed YAML. |
| `packages/development/tests/feature-foreman-passthrough.test.js` (new) | Front-door flag-parsing tests. |
| Generated OMP/Pi/Codex artifacts | Regenerated, verified read-only. |

Out of bounds: Foreman, HerdR, `RunIndexStore`, `types.ts`, `event-mapping.ts`, the stage skills' own `--foreman` semantics, and every unrelated working-tree file.

### Data flow

`/ensemble:feature new --foreman <idea>` -> front door builds `/ensemble:new-feature --foreman --idea "<idea>"` -> Entry Step 1 sets `FOREMAN=true` -> `createRun` -> stage dispatch passes `--foreman` to the stage skill -> stage result auto-accepted and recorded via `mutate()` -> at `implementation_approval` one `mutate()` grants and records -> `implementation` remains unwired, so the run stops there with a clear message exactly as today.

### Interface contract

- `/ensemble:new-feature [--foreman] [--idea <text> | --path <p> | --status | --abandon [reason]]`.
- `/ensemble:feature <new|resume|status|abandon> [--foreman] [args...]`; `--foreman` is recognized only as the first token after the keyword; elsewhere it is ordinary text.

### Auto-grant record

`stageOutcome` is set to `{ kind: "approval_wait", detail: "implementation approval granted by --foreman policy (no human present)", recordedAt }` together with `implementationApprovedAt = now()` and `stage = "implementation"`. `kind` stays `approval_wait` so Stage Resolution's rule never skips a stage, and `--status` prints the detail. The PR gate records the analogous `prApprovedAt` and detail.

### Integration points (existing files, edited at source)

`packages/development/commands/new-feature.yaml`, `packages/development/commands/feature.yaml`, plus generated outputs via `npm run generate`, `npm run generate:pi`, `npm run generate:codex`.

## Master Task List

### PR 1: `--foreman` for new-feature and the feature front door

**Shippable State:** A Foreman-dispatched `new-feature --foreman` run never asks the user a question; every non-interactive decision is recorded in the run; a run without the flag behaves exactly as before; the generated artifacts for all runtimes match their sources.

- [ ] **TRD-001** Add the `foreman` parameter, the `FOREMAN` variable and the supported-flag rule (`packages/development/commands/new-feature.yaml`) [satisfies REQ-001] (1h)
  - Validates PRD ACs: AC-001-1, AC-001-2, AC-001-3
  - Implementation AC:
    - [ ] Given the command source, when its parameters are read, then a boolean `foreman` parameter exists with default `false` whose description says it is for automated Foreman orchestration with no user present
    - [ ] Given Entry Step 1, when it runs, then it defines `FOREMAN` as true iff `--foreman` is present and states that `--foreman` is a supported flag and never an equivalent of `--skip-refine`
    - [ ] Given `--foreman` is absent, when the file is read, then every pre-existing prompt and message is unchanged

- [ ] **TRD-001-TEST** Parameter and variable behavior [Verifies TRD-001] [Satisfies REQ-001] [Depends: TRD-001] (1h)
  - Validates PRD ACs: AC-001-1, AC-001-2, AC-001-3
  - Test AC:
    - [ ] Scenario: parameter shape -- Given the parsed YAML, When `parameters` is read, Then `foreman` is a boolean with default false
    - [ ] Scenario: flag rejection unchanged -- Given the Step 1 actions, When read, Then `--skip-refine` rejection still precedes any createRun and `--foreman` is not listed as an equivalent
    - [ ] Scenario: existing suites unchanged -- Given the existing `new-feature-command` and `feature-*` suites, When run without modification, Then they pass

- [ ] **TRD-002** Forward `--foreman` to the stage skills and auto-accept stage output (`packages/development/commands/new-feature.yaml`) [satisfies REQ-002] [Depends: TRD-001] (2h)
  - Validates PRD ACs: AC-002-1, AC-002-2, AC-002-3, AC-002-4, AC-002-5, AC-002-6
  - Implementation AC:
    - [ ] Given `FOREMAN == true`, when Phase 3 Step 1 dispatches a stage, then the invocation of `create-prd`, `refine-prd`, `create-trd`, `refine-trd` and `implement-trd-beads --plan` includes `--foreman`
    - [ ] Given `FOREMAN` is not true, when it dispatches, then no `--foreman` is added
    - [ ] Given `FOREMAN == true`, when a stage saved real output, then Step 2 records success without asking and offers no decline or edit path; a stage-skill hard HALT is still recorded as a failure
    - [ ] Given `FOREMAN == true`, when stages run, then the `idea` is passed unchanged and no `FOREMAN_*` variable is set, cleared or reinterpreted

- [ ] **TRD-002-TEST** Forwarding and auto-accept behavior [Verifies TRD-002] [Satisfies REQ-002] [Depends: TRD-002] (2h)
  - Validates PRD ACs: AC-002-1, AC-002-2, AC-002-3, AC-002-4, AC-002-5, AC-002-6
  - Test AC:
    - [ ] Scenario: every stage forwards -- Given Phase 3 Step 1, When read, Then each of the five stage skills is named together with a `FOREMAN == true` condition for `--foreman`
    - [ ] Scenario: forwarding is conditional -- Given Step 1, When read, Then `--foreman` is added only under the foreman condition
    - [ ] Scenario: no prompt on acceptance -- Given Step 2, When read, Then the foreman branch records success and does not offer decline or edit
    - [ ] Scenario: artifact path rule kept -- Given Step 1, When read, Then the exact-path rule and the `--plan` flag are still present

- [ ] **TRD-003** Retry a failed stage without confirmation (`packages/development/commands/new-feature.yaml`) [satisfies REQ-003] [Depends: TRD-002] (1h)
  - Validates PRD ACs: AC-003-1, AC-003-2, AC-003-3
  - Implementation AC:
    - [ ] Given `FOREMAN == true` and a failure-parked run, when Entry Step 4 runs, then the "Retry <stage>?" question is not asked and the parked stage is retried once as the explicit retry
    - [ ] Given that retry fails, when the invocation ends, then the failure is recorded at the same stage and nothing retries again in the invocation
    - [ ] Given `FOREMAN` is not true, when Step 4 runs, then the question is asked as today

- [ ] **TRD-003-TEST** Retry behavior [Verifies TRD-003] [Satisfies REQ-003] [Depends: TRD-003] (1h)
  - Validates PRD ACs: AC-003-1, AC-003-2, AC-003-3
  - Test AC:
    - [ ] Scenario: foreman skips the question -- Given Entry Step 4's failure action, When read, Then it has a foreman branch that proceeds to Stage Resolution without asking
    - [ ] Scenario: no retry loop -- Given Phase 3 Step 3, When read, Then it still forbids retrying within the same invocation and the foreman branch does not weaken it
    - [ ] Scenario: interactive path intact -- Given the same action, When read, Then the original "Retry <stage>? [yes/no]" sentence is still present

- [ ] **TRD-004** Auto-grant implementation approval and record it (`packages/development/commands/new-feature.yaml`) [satisfies REQ-004] [Depends: TRD-003] (2h)
  - Validates PRD ACs: AC-004-1, AC-004-2, AC-004-3, AC-004-4
  - Implementation AC:
    - [ ] Given `FOREMAN == true` at `implementation_approval`, when the checkpoint runs, then no question is asked and one `mutate()` sets `implementationApprovedAt` and `stage = "implementation"` with `stageOutcome` `{ kind: "approval_wait", detail: "implementation approval granted by --foreman policy (no human present)" }`
    - [ ] Given the staleness check clears approval under `FOREMAN == true`, when the checkpoint re-runs, then approval is re-granted through the same recorded path
    - [ ] Given `FOREMAN` is not true, when the checkpoint runs, then it asks for explicit approval and makes no `mutate()` call on absent or declined approval
    - [ ] Given `--status` reports a run, when the detail is present, then it is printed so an auto-grant is never mistaken for a human approval

- [ ] **TRD-004-TEST** Implementation approval behavior [Verifies TRD-004] [Satisfies REQ-004] [Depends: TRD-004] (2h)
  - Validates PRD ACs: AC-004-1, AC-004-2, AC-004-3, AC-004-4
  - Test AC:
    - [ ] Scenario: grant is one atomic call -- Given the checkpoint's foreman action, When read, Then `implementationApprovedAt` and the stage advance are set in a single `mutate()` call
    - [ ] Scenario: grant is labelled -- Given that action, When read, Then the recorded detail names `--foreman` policy
    - [ ] Scenario: human path intact -- Given the checkpoint, When read, Then the original ask and the no-mutate-on-decline rule are present
    - [ ] Scenario: staleness re-grants through the same path -- Given Phase 2 Step 1's staleness action, When read, Then it routes to the checkpoint rather than keeping the old approval

- [ ] **TRD-005** Auto-grant PR approval and PR creation (`packages/development/commands/new-feature.yaml`) [satisfies REQ-005] [Depends: TRD-004] (2h)
  - Validates PRD ACs: AC-005-1, AC-005-2, AC-005-3, AC-005-4
  - Implementation AC:
    - [ ] Given `FOREMAN == true` at `pr_approval`, when the checkpoint runs, then neither the opt-in nor the repo/branch/title/body question is asked and one `mutate()` sets `prApprovedAt` and `stage = "pr_create"` with a detail naming `--foreman` policy, never in the same call as `implementationApprovedAt`
    - [ ] Given `isAvailable()` is false, when the checkpoint runs under `FOREMAN == true`, then no PR is created, the outcome records "no PR provider available" and the run advances to `done`
    - [ ] Given `prApprovedAt` is null in the loaded run, when `pr_create` runs, then the call is denied regardless of any claim of approval
    - [ ] Given `FOREMAN` is not true, when the checkpoint runs, then opt-in and separate explicit approval are required as today

- [ ] **TRD-005-TEST** PR approval behavior [Verifies TRD-005] [Satisfies REQ-005] [Depends: TRD-005] (2h)
  - Validates PRD ACs: AC-005-1, AC-005-2, AC-005-3, AC-005-4
  - Test AC:
    - [ ] Scenario: no prompt, separate grant -- Given Step 6's foreman action, When read, Then it asks nothing and sets `prApprovedAt` in a call distinct from the implementation grant
    - [ ] Scenario: provider-unavailable terminal state kept -- Given that action, When read, Then the `isAvailable()` false path to `done` is still present
    - [ ] Scenario: store precondition kept -- Given Step 7, When read, Then the null-`prApprovedAt` denial is unchanged
    - [ ] Scenario: human path intact -- Given Step 6, When read, Then the opt-in and separate approval sentences are present

- [ ] **TRD-006** Abandon without confirmation under `--foreman` (`packages/development/commands/new-feature.yaml`) [satisfies REQ-006] [Depends: TRD-005] (1h)
  - Validates PRD ACs: AC-006-1, AC-006-2
  - Implementation AC:
    - [ ] Given `FOREMAN == true` and `--abandon`, when Entry Step 6 runs with an active run, then the confirmation is not asked and `RunIndexStore.abandon()` is called with the given reason; with no active run it prints that there is nothing to abandon
    - [ ] Given `FOREMAN` is not true, when Step 6 runs, then the confirmation is required as today

- [ ] **TRD-006-TEST** Abandon behavior [Verifies TRD-006] [Satisfies REQ-006] [Depends: TRD-006] (1h)
  - Validates PRD ACs: AC-006-1, AC-006-2
  - Test AC:
    - [ ] Scenario: foreman abandons directly -- Given Step 6's confirmation action, When read, Then it has a foreman branch that calls abandon without asking
    - [ ] Scenario: no-active-run case unchanged -- Given Step 6, When read, Then the "nothing to abandon" path makes no mutate call
    - [ ] Scenario: interactive path intact -- Given Step 6, When read, Then the explicit-confirmation sentence is present

- [ ] **TRD-007** Never auto-approve untrusted event payloads (`packages/development/commands/new-feature.yaml`) [satisfies REQ-007] [Depends: TRD-006] (1h)
  - Validates PRD ACs: AC-007-1, AC-007-2, AC-007-3
  - Implementation AC:
    - [ ] Given an accepted event payload and `FOREMAN == true`, when Entry Step 5 reaches the review step, then no PRD work starts, no run is created, and the pending step reports that human review of the event payload is required
    - [ ] Given `FOREMAN` is not true, when Step 5 runs, then the user review happens as today
    - [ ] Given no `event-mapping.json`, when an event arrives, then default-deny is unchanged

- [ ] **TRD-007-TEST** Event payload behavior [Verifies TRD-007] [Satisfies REQ-007] [Depends: TRD-007] (1h)
  - Validates PRD ACs: AC-007-1, AC-007-2, AC-007-3
  - Test AC:
    - [ ] Scenario: never auto-approved -- Given Step 5's review action, When read, Then its foreman branch stops without creating a run or starting PRD work
    - [ ] Scenario: validation order kept -- Given Step 5, When read, Then validation still precedes any RunIndexStore call
    - [ ] Scenario: default-deny kept -- Given Step 5's first action, When read, Then the null-mapping default-deny is present

- [ ] **TRD-008** Front door accepts and forwards `--foreman` (`packages/development/commands/feature.yaml`) [satisfies REQ-008] (2h)
  - Validates PRD ACs: AC-008-1, AC-008-2, AC-008-3, AC-008-4
  - Implementation AC:
    - [ ] Given `new --foreman <idea>`, when the front door dispatches, then a new action placed before the validation action removes the leading `--foreman` token and sets `FOREMAN`, and a new action placed after the invocation is constructed inserts `--foreman` immediately after `/ensemble:new-feature`, giving `/ensemble:new-feature --foreman --idea "<idea>"` with the idea text otherwise unchanged
    - [ ] Given `resume`, `status` or `abandon` with `--foreman`, when it dispatches, then the flag is inserted into the constructed invocation by the same post-construction action and `abandon` still forwards any reason after it
    - [ ] Given `--foreman` anywhere other than the first token after the keyword, when it dispatches, then it is ordinary text
    - [ ] Given an unknown keyword, empty arguments, or extra text after `resume`/`status` once a leading `--foreman` has been removed, when it dispatches, then it is rejected with the keyword table and no side effects, by the existing validation sentences, which are not reworded

- [ ] **TRD-008-TEST** Front-door flag parsing [Verifies TRD-008] [Satisfies REQ-008] [Depends: TRD-008] (2h)
  - Validates PRD ACs: AC-008-1, AC-008-2, AC-008-3, AC-008-4
  - Test AC:
    - [ ] Scenario: new forwards the flag -- Given the post-construction action, When read, Then it inserts `--foreman` immediately after `/ensemble:new-feature` and changes nothing else in the invocation
    - [ ] Scenario: first-token only -- Given the extraction action, When read, Then it recognizes `--foreman` only as the token immediately after the keyword and appears before the validation action
    - [ ] Scenario: validation still rejects -- Given the validation action, When read, Then unknown keywords and stray text after `resume`/`status` are still rejected
    - [ ] Scenario: existing front-door suites -- Given the existing feature tests, When run, Then they pass unchanged

- [ ] **TRD-009** Hard-stop invariants stated in the constraints (`packages/development/commands/new-feature.yaml`) [satisfies REQ-009] [Depends: TRD-007] (1h)
  - Validates PRD ACs: AC-009-1, AC-009-2, AC-009-3
  - Implementation AC:
    - [ ] Given the constraints block, when read, then it states that `--foreman` never bypasses `RUN_ALREADY_ACTIVE`, the read-only `--status`, or the no-retry-in-invocation rule
    - [ ] Given `--foreman` with `--status`, when it runs, then it is read-only and makes no `mutate()` call

- [ ] **TRD-009-TEST** Invariants and the question guard [Verifies TRD-009] [Satisfies REQ-009] [Depends: TRD-009] (2h)
  - Validates PRD ACs: AC-009-1, AC-009-2, AC-009-3
  - Test AC:
    - [ ] Scenario: every question has a foreman branch -- Given every action across all phases that asks or awaits the user, When scanned, Then each also names `FOREMAN` or `--foreman`
    - [ ] Scenario: status stays read-only -- Given Entry Step 4's status action, When read, Then it still makes no mutate call and the foreman text does not alter it
    - [ ] Scenario: exclusivity kept -- Given Steps 2 and 3, When read, Then `RUN_ALREADY_ACTIVE` handling is unchanged

- [ ] **TRD-010** Regenerate all runtime artifacts from the repo root [satisfies REQ-010] [Depends: TRD-008, TRD-009] (1h)
  - Validates PRD ACs: AC-010-1, AC-010-2
  - Implementation AC:
    - [ ] Given the edited sources, when `npm run generate`, `npm run generate:pi` and `npm run generate:codex` run from the repo root, then the OMP command docs, Pi prompts and Codex skills for `new-feature` and `feature` carry the new behavior in their rendered step text
    - [ ] Given a rule lives only in a step's `instructions`, when rendering is checked, then it is mirrored into the description or actions
    - [ ] Given the regeneration, when `git status` is read, then only the expected generated files changed and the Pi version bumped at most once

- [ ] **TRD-010-TEST** Generated parity [Verifies TRD-010] [Satisfies REQ-010] [Depends: TRD-010] (1h)
  - Validates PRD ACs: AC-010-1, AC-010-2
  - Test AC:
    - [ ] Scenario: parity holds -- Given the regenerated tree, When `npm run generate:validate` and `npm run validate` run, Then both pass without rewriting tracked files
    - [ ] Scenario: rendered text carries the behavior -- Given the generated OMP doc, Pi prompt and Codex skill for `new-feature`, When read, Then each contains the `foreman` parameter and the forwarding rule
    - [ ] Scenario: tests stay read-only -- Given the new tests, When run, Then they never invoke a generator

- [ ] **TRD-011** The question guard and flag tests exist and are wired into the suite [satisfies REQ-011] [Depends: TRD-010] (1h)
  - Validates PRD ACs: AC-011-1, AC-011-2
  - Implementation AC:
    - [ ] Given the two new test files, when the `packages/development` suite runs, then they run and pass
    - [ ] Given the guard scan, when a new prompt that asks the user is added without a foreman branch, then the scan fails naming the action

- [ ] **TRD-011-TEST** Mutation proof that the checks can fail [Verifies TRD-011] [Satisfies REQ-011] [Depends: TRD-011] (1h)
  - Validates PRD ACs: AC-011-1, AC-011-2
  - Test AC:
    - [ ] Scenario: remove the parameter -- Given the `foreman` parameter removed, When the suite runs, Then at least one test fails
    - [ ] Scenario: drop one forward -- Given `--foreman` removed from one stage skill's dispatch, When the suite runs, Then at least one test fails
    - [ ] Scenario: unguarded prompt -- Given an asking action with no foreman branch, When the suite runs, Then the guard scan fails
    - [ ] Scenario: break first-token rule -- Given the front door recognizing the flag anywhere, When the suite runs, Then a test fails
    - [ ] Scenario: restore -- Given each mutation reverted, When the suite runs, Then it passes and the tracked tree is unchanged

## Sprint Planning

### Sprint 1: new-feature and front door (PR 1)

Tasks TRD-001 through TRD-011 and their tests. Informational grouping only.

## Dependency Mapping and PR Boundary Design

- **Serial (same file):** TRD-001 -> TRD-002 -> TRD-003 -> TRD-004 -> TRD-005 -> TRD-006 -> TRD-007 -> TRD-009, all editing `new-feature.yaml`, so they are ordered rather than parallel.
- **Parallel with that chain:** TRD-008 (`feature.yaml`).
- **Join:** TRD-010 depends on TRD-008 and TRD-009; TRD-011 follows TRD-010.
- **PR boundary shippability:** one PR; nothing is half-wired because no step is changed without its generated output in the same PR.
- **No cycles:** every task depends only on lower-numbered tasks.

## Acceptance Criteria Traceability

| REQ | Description | Implementation Tasks | Test Tasks |
|-----|-------------|----------------------|------------|
| REQ-001 | `new-feature` accepts `--foreman` | TRD-001 | TRD-001-TEST |
| REQ-002 | Flag forwarded to every stage skill | TRD-002 | TRD-002-TEST |
| REQ-003 | Retry of a failed stage needs no confirmation | TRD-003 | TRD-003-TEST |
| REQ-004 | Approval checkpoints auto-grant and are recorded | TRD-004 | TRD-004-TEST |
| REQ-005 | PR approval and creation need no human | TRD-005 | TRD-005-TEST |
| REQ-006 | Abandon needs no confirmation under `--foreman` | TRD-006 | TRD-006-TEST |
| REQ-007 | Untrusted event payloads never auto-approved | TRD-007 | TRD-007-TEST |
| REQ-008 | `/ensemble:feature` accepts and forwards `--foreman` | TRD-008 | TRD-008-TEST |
| REQ-009 | Hard stops and exclusivity unchanged | TRD-009 | TRD-009-TEST |
| REQ-010 | Generated artifacts match sources | TRD-010 | TRD-010-TEST |
| REQ-011 | The checks can fail | TRD-011 | TRD-011-TEST |

## Traceability Validation

- Every REQ-001..REQ-011 maps to at least one implementation task and one test task.
- Every AC in the PRD (AC-001-1 through AC-011-2, including the added AC-002-5 and AC-002-6) is named in at least one task's "Validates PRD ACs" line.
- No task names an AC that does not exist in the PRD.

## Adversarial Review and Design Gate

### Architecture issues and resolutions

- **A recorded auto-grant could be mistaken for a human approval.** Resolved: the detail string is mandatory in TRD-004/005, and `--status` prints it.
- **`stage`/`success` recording can skip a stage.** Resolved: the grant records `kind: "approval_wait"`, the same shape the previous run ended on, so Stage Resolution never advances past `implementation`.
- **A `--foreman` token inside idea prose could silently turn the mode on.** Resolved: first-token-only recognition (TRD-008).
- **Untrusted event payload plus no human would auto-approve a prompt-injection surface.** Resolved: TRD-007 refuses rather than auto-approves.

### Task coverage issues

- Every task is a single file or a single regeneration step; the serial chain through `new-feature.yaml` prevents write conflicts.

### Dependency and estimate issues

- Estimates are 1-2h per task; the serial chain through `new-feature.yaml` (TRD-001, -002, -003, -004, -005, -006, -007, -009) is 11h, and TRD-010 and TRD-011 follow it, so the critical path is about 13h.

### Testability

- Tests parse the YAML and assert structure, ordering and presence of the foreman condition, not exact wording. The guard scan fails closed: a new asking action without a foreman branch fails it.

### Design Readiness Scorecard

| Dimension | Score (1-5) |
|-----------|-------------|
| Completeness | 4.5 |
| Testability | 4.5 |
| Clarity | 4.5 |
| Feasibility | 4.5 |
| Risk handling | 4.0 |
| **Overall** | **4.4 (PASS)** |

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Auto-granting weakens the human checkpoint | Medium | High | Recorded detail, `--status` surfacing, off unless `--foreman` is passed, maintainer decision recorded in the PRD |
| Prompt-only rules are followed loosely by a model | Medium | Medium | Guard scan, structural tests, explicit hard-stop invariants |
| Existing front-door and new-feature tests pin exact sentences, so rewording breaks them | High | Medium | Additive-only edits (see Architecture Decision); the existing suites are run unchanged in TRD-001-TEST and TRD-008-TEST |
| Stage skills also write `FOREMAN_ARTIFACT_PATH`, overwriting each other | Medium | Low | Out of scope in the PRD; documented, not changed |

## Constitution Gate

| Rule | Status |
|------|--------|
| 1. No secrets in code | Pass: no credentials involved |
| 2. Input validation at boundaries | Pass: first-token flag parsing; event payloads never auto-approved |
| 3. Tests accompany features | Pass: a test task for every task |
| 4. Ownership boundary preserved | Pass: no retries, scheduling or recovery added; Foreman owns any further retry |
| 5. Governed tool boundary | Pass: no tool grants changed |
| 6. Reachable from the product entry point | Pass: reachable through `/ensemble:feature new --foreman` |
| 7. A verification must be able to fail | Pass: TRD-011-TEST mutation proof |
| 8. User-changeable behavior in prompts, not TypeScript | Pass: prompt-only change |

## Changelog

| Date | Version | Changes |
|------|---------|---------|
| 2026-10-15 | 1.0.0 | Initial TRD |
| 2026-10-15 | 1.0.1 | Refinement: additive-only edit rule (existing suites pin exact sentences); front-door design reworked to extract the flag before validation and insert it after construction; TRD-001-TEST and TRD-008-TEST now run the existing suites unchanged |
