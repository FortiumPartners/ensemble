---
document_id: PRD-2026-1d3e0dd6
label: prd-new-feature-foreman-flag
version: 1.0.1
status: Draft
date: 2026-10-15
scale_depth: STANDARD
total_requirements: 11
readiness_score: 4.5
design_readiness_score: null
---

# PRD-2026-1d3e0dd6: `--foreman` Flag for `/ensemble:new-feature`

## PRD Health Summary

- **Risk flags:** REQ-004, REQ-007
- **Dependencies:** 14 cross-requirement dependencies (see Dependency Map)
- **Unresolved clarification markers:** 0
- **Constitution compliance:** passed (`docs/standards/constitution.md`, Non-Negotiable Rules 1-8)

## Product Summary

**Problem:** `/ensemble:new-feature` chains five stage skills and stops to ask the user at several points: retry-after-failure, implementation approval, PR approval, abandon confirmation, and review of event payloads. Under Foreman there is no user. The stage skills (`create-prd`, `refine-prd`, `create-trd`, `refine-trd`, `implement-trd-beads`) already accept `--foreman`, but `new-feature` does not, so it cannot forward the flag. A Foreman-dispatched run therefore stalls on a question nobody can answer, or lets the model improvise one.

**Who feels it:** Foreman operators and maintainers who dispatch `new-feature` (directly or through the `/ensemble:feature` front door) as an automated task.

**Solution:** Add a `--foreman` boolean to `new-feature` (and accept it through `/ensemble:feature`). When set, `new-feature` forwards `--foreman` to every stage skill it runs and replaces each of its own user prompts with a deterministic, recorded, non-interactive decision. Hard safety stops are unchanged. When the flag is absent, behavior is byte-for-byte what it is today.

**Success:** A Foreman-dispatched `new-feature --foreman` run never asks the user a question, every non-interactive decision it takes is recorded in the run record, and a run without the flag behaves exactly as before.

**Source:** The maintainer's request: "add --foreman flag to new-feature that passes the --foreman flag to the underlying skills/commands. Foreman needs a way to bypass the model from asking questions to the user when there is no user while running underneath foreman."

**Decisions already made by the maintainer:**
- At the `implementation_approval` and `pr_approval` checkpoints, `--foreman` auto-grants approval, recorded in the run (not parked, not human-gated). Rationale: matches `fix-issue --foreman`, which auto-creates its PR, and Foreman's own task approval precedes the dispatch.

**Out of scope (Won't, this release):**
- Any change to Foreman, HerdR, scheduling, durable retries or recovery (Constitution rule 4: Foreman owns those).
- Any TypeScript change (`RunIndexStore`, `types.ts`, `event-mapping.ts` are unchanged; `StageOutcome.detail` carries the record).
- Wiring the `implementation` stage, which remains unwired by design.
- A `FOREMAN_ARTIFACT_PATH` phase report written by `new-feature` itself. Stage skills that honor it keep doing so under their own contracts.
- Changing the `--foreman` semantics of any stage skill.

## Approvals and Decision Ownership

- **Approver:** The Ensemble repository owner (maintainer).
- **Acceptance criteria the approver judges against:** REQ-001 through REQ-011 below.

## Entry and Exit Criteria

**Entry:**
- The `--foreman` parameter exists on `create-prd`, `refine-prd`, `create-trd`, `refine-trd` and `implement-trd-beads` (verified in their YAML sources).
- Unrelated working-tree changes remain untouched.

**Exit:**
- `new-feature.yaml` and `feature.yaml` carry the behavior below; generated OMP, Pi and Codex artifacts match their sources.
- Focused tests, `npm run validate`, `npm run generate:validate` and the `packages/development` suite pass.
- The tests can fail: breaking the flag forwarding or removing a foreman branch from any prompt makes a test fail.

## Requirements

### Flag and forwarding

### REQ-001: `new-feature` accepts `--foreman` (Must)

- AC-001-1: Given `new-feature.yaml`, when its parameters are read, then a boolean `foreman` parameter exists with default `false` and a description stating it is for automated Foreman orchestration with no user present.
- AC-001-2: Given `--foreman` is absent, when any entry point or stage runs, then every user prompt, confirmation gate and message is exactly what it is today.
- AC-001-3: Given `--foreman` is present, when the invocation is parsed, then it never changes the validation done before any run is created: `--skip-refine` and its equivalents are still rejected, and a rejected invocation creates no run.

### REQ-002: The flag is forwarded to every stage skill (Must)

- AC-002-1: Given `--foreman` is set, when a stage dispatches its skill, then the invocation passed to `create-prd`, `refine-prd`, `create-trd`, `refine-trd` and `implement-trd-beads --plan` includes `--foreman`.
- AC-002-2: Given `--foreman` is absent, when a stage dispatches its skill, then no `--foreman` is added.
- AC-002-3: Given `--foreman` is set, when a stage input is chosen, then it is still the exact `path` from the named `artifacts[]` entry (never a globbed or recalled path), and the `--plan` flag on bead planning is unchanged.
- AC-002-4: Given a stage skill hard-HALTs under `--foreman` (for example an Implementation Readiness Gate FAIL or a Constitution Gate Contract failure), when the stage body reports it, then it is recorded as a stage failure exactly as today and is never converted into success.
- AC-002-5: Given `--foreman` is set and a stage saved a real output artifact, when the stage result is recorded, then it is recorded as success without asking the user to accept it, and no decline or edit-and-regenerate path is offered (there is no user to take it).
- AC-002-6: Given Foreman dispatches `new-feature --foreman`, when stage skills run, then `new-feature` passes the run's `idea` as the product description exactly as today and does not set, clear or reinterpret any `FOREMAN_*` environment variable; each stage skill's own `FOREMAN_TASK_TITLE` / `FOREMAN_ARTIFACT_PATH` contract is unchanged.

### Replacing the model's questions

### REQ-003: Retry of a failed stage needs no confirmation (Must)

- AC-003-1: Given a run parked with `stageOutcome.kind == "failure"` and an invocation with `--foreman`, when entry resolution runs, then the "Retry <stage>?" question is not asked and the parked stage is retried once, as the explicit retry.
- AC-003-2: Given that retry fails, when the invocation ends, then the failure is recorded at the same stage and nothing retries again within that invocation (Foreman owns any further retry).
- AC-003-3: Given a failed run and an invocation without `--foreman`, when it runs, then the confirmation question is asked as today.

### REQ-004: Approval checkpoints auto-grant and are recorded (Must) [RISK: weakens a human checkpoint, so the record must be unambiguous]

- AC-004-1: Given `--foreman` and `ELIGIBLE_STAGE == implementation_approval`, when the checkpoint runs, then no question is asked and one `RunIndexStore.mutate()` call sets `implementationApprovedAt` and advances `stage` to `implementation`, with `stageOutcome.detail` stating the approval was granted by `--foreman` policy with no human present.
- AC-004-2: Given the grant happened, when `--status` later reports the run, then it shows that detail, so an auto-grant can never be mistaken for a human approval.
- AC-004-3: Given `--foreman` is absent, when the checkpoint runs, then it asks for explicit approval and, on absent or declined approval, makes no `mutate()` call, exactly as today.
- AC-004-4: Given the material-plan-change staleness check finds the approved plan changed, when `--foreman` is set, then approval is cleared and re-granted through the same recorded path, never silently kept.

### REQ-005: PR approval and PR creation need no human (Must)

- AC-005-1: Given `--foreman` and `ELIGIBLE_STAGE == pr_approval`, when the checkpoint runs, then the opt-in and the repo/branch/title/body question are not asked; one `mutate()` call sets `prApprovedAt` and advances to `pr_create`, never in the same call as `implementationApprovedAt`.
- AC-005-2: Given `isAvailable()` is false under `--foreman`, when the checkpoint runs, then no PR is created, the outcome records "no PR provider available", and the run advances to `done`, exactly as without the flag.
- AC-005-3: Given `pr_create` runs, when `prApprovedAt` is null in the loaded run, then the call is still denied regardless of any claim of approval (the store-persisted-approval precondition is unchanged).
- AC-005-4: Given `--foreman` is absent, when the checkpoint runs, then the opt-in and the separate explicit approval are both required as today.

### REQ-006: Abandon needs no confirmation under `--foreman` (Should)

- AC-006-1: Given `--abandon` and `--foreman` together, when entry resolution runs, then the confirmation question is not asked and `RunIndexStore.abandon()` is called with the given reason; with no active run it prints "nothing to abandon" and changes nothing.
- AC-006-2: Given `--abandon` without `--foreman`, when it runs, then the explicit confirmation is required as today.

### REQ-007: Untrusted event payloads are never auto-approved (Must) [RISK: prompt-injection surface]

- AC-007-1: Given an event-triggered start under `--foreman`, when the payload passes `validateEventPayload`, then it is not auto-approved: no PRD work starts, no run is created, and the pending step reports that review of the event payload requires a human.
- AC-007-2: Given an event-triggered start without `--foreman`, when it runs, then the user review happens as today.
- AC-007-3: Given no `event-mapping.json`, when an event arrives, then the default-deny behavior is unchanged.

### Front door

### REQ-008: `/ensemble:feature` accepts and forwards `--foreman` (Must)

- AC-008-1: Given `/ensemble:feature new --foreman <idea>`, when it dispatches, then it builds `/ensemble:new-feature --foreman --idea "<idea>"`, and the idea text is forwarded exactly as given (the flag is removed from it, nothing else is).
- AC-008-2: Given `resume`, `status` or `abandon` with `--foreman`, when it dispatches, then the flag is forwarded; `abandon` still forwards any reason text after it.
- AC-008-3: Given `--foreman` appears anywhere other than as the first token after the keyword (for example inside the idea prose), when it dispatches, then it is treated as ordinary text and not as the flag.
- AC-008-4: Given an unknown keyword, empty arguments, or extra text after `resume` or `status` other than the flag, when it dispatches, then it is rejected with the keyword table and no side effects, as today.

### Delivery and safety

### REQ-009: Hard stops and exclusivity are unchanged (Must)

- AC-009-1: Given `--foreman`, when a run is already active, then `RUN_ALREADY_ACTIVE` is still reported and no run is created.
- AC-009-2: Given `--foreman`, when `--status` runs, then it is still read-only and makes no `mutate()` call.
- AC-009-3: Given `--foreman`, when a stage fails, then it is parked at that stage and never auto-retried in the same invocation.

### REQ-010: Generated artifacts match their sources (Must)

- AC-010-1: Given the edited sources, when `npm run generate`, `npm run generate:pi` and `npm run generate:codex` run from the repo root, then the generated command docs, Pi prompts and Codex skills carry the new behavior in the rendered step text, and `npm run generate:validate` and `npm run validate` pass.
- AC-010-2: Given the rendered text carries only a step's `description` and `actions[]`, when rules live in a step's `instructions`, then they are mirrored into the description or actions so no runtime loses them.

### REQ-011: The checks can fail (Must)

- AC-011-1: Given the new tests, when the `--foreman` parameter is removed, or forwarding to any one of the five stage skills is removed, or any prompt that asks the user is left without a `--foreman` branch, then at least one test fails.
- AC-011-2: Given the front-door tests, when the first-token-only rule is broken, then a test fails.

## Dependency Map

- REQ-002 depends on REQ-001.
- REQ-003 depends on REQ-001 and REQ-002.
- REQ-004 depends on REQ-001 and REQ-002.
- REQ-005 depends on REQ-004.
- REQ-006 depends on REQ-001.
- REQ-007 depends on REQ-001.
- REQ-008 depends on REQ-001.
- REQ-009 depends on REQ-001.
- REQ-010 depends on REQ-002, REQ-003, REQ-004, REQ-005, REQ-006, REQ-007 and REQ-008.
- REQ-011 depends on REQ-002, REQ-004 and REQ-008.
- **Clusters implemented together:** {REQ-001..REQ-007, REQ-009} (`new-feature.yaml`); {REQ-008} (`feature.yaml`).
- **Circular dependencies:** none identified.

## Implementation Readiness Gate

| Dimension | Score (1-5) |
|-----------|-------------|
| Completeness | 4.5 |
| Testability | 4.5 |
| Clarity | 4.5 |
| Feasibility | 4.5 |
| **Overall** | **4.5 (PASS)** |

## Changelog

| Date | Version | Changes |
|------|---------|---------|
| 2026-10-15 | 1.0.0 | Initial PRD |
| 2026-10-15 | 1.0.1 | Refinement: AC-002-5 (stage output accepted without a prompt) and AC-002-6 (`FOREMAN_*` contract untouched) |
