### Phase 1: Entry Point Resolution

Start, resume, report, or reject from `idea`/`path`/`status`; produces ACTIVE_RUN.

#### Step 1.1: Reject Unsupported Flags Before Any Stage Runs

--skip-refine and equivalents are rejected before any RunIndexStore call.

- Invocation arguments: $ARGUMENTS -- read `idea`, `path`, `status` and flags such as `--foreman` from it.
- If the invocation includes `--skip-refine` or any equivalent flag that would bypass prd_refine or trd_refine: reject with 'Both PRD and TRD refinement are mandatory in new-feature's fixed stage order; to skip orchestration but not refinement, run the standalone /ensemble:refine-prd or /ensemble:refine-trd commands (unmodified by new-feature).' and HALT. No run is created or mutated.
- This workflow is the internal implementation behind the canonical front door `/ensemble:feature` (keywords `new`/`resume`/`status`/`abandon`); direct invocation behaves identically.
- Foreman mode: FOREMAN = true when `--foreman` is present, else false. `--foreman` is a supported flag, never a `--skip-refine` equivalent (it bypasses no refinement stage). Nothing infers FOREMAN from the environment.

#### Step 1.2: Idea Input -- Start a New Run

An `idea` starts a fresh run at prd_create.

- If `idea` is provided (and `path` is not): call RunIndexStore.createRun(projectRoot, idea).
- If it throws RUN_ALREADY_ACTIVE, print 'A run is already active for this project: <existingRunId>. Resume it with no arguments (or --status), or abandon it before starting a new one.' and stop -- no new run is created.
- Otherwise print the new run's identifier (runId) and that it starts at stage prd_create; set ACTIVE_RUN and proceed to Stage Resolution.

#### Step 1.3: Artifact-Path Input -- Resume an Indexed Run, or Adopt an Unindexed PRD

Resume the run that indexed `path`, or adopt an unindexed PRD at prd_refine.

- If `path` is provided: call RunIndexStore.resolveByArtifact(projectRoot, path).
- Found: print the matched artifact reference (type, documentId, version, producingStage) and the run's recorded stage; set ACTIVE_RUN; proceed to Stage Resolution.
- Not found, and `path` does not exist or cannot be read: reject with 'No indexed run references <path>, and no file exists at that path to adopt as a new run's source.' Create no run; advance nothing.
- Not found, `path` is readable but its frontmatter has no `document_id` matching `PRD-*` (a TRD, an unrelated file, or malformed frontmatter): reject with 'No indexed run references <path>. Only artifact paths recorded by a prior new-feature run can be resumed, and <path> is not a PRD document -- use the standalone /ensemble:refine-prd or /ensemble:refine-trd command instead.' Create no run; advance nothing.
- Not found, `path` is readable and has a `document_id` matching `PRD-*`: adopt it. Read `document_id` and `version` from its frontmatter and call RunIndexStore.createRunFromArtifact(projectRoot, <the PRD's H1 title, falling back to its document_id>, { type: 'prd', path, documentId, version, producingStage: 'prd_create' }, 'prd_refine'). It enters at prd_refine, not prd_create (the PRD already exists). Print the new run's identifier and that it starts at prd_refine; set ACTIVE_RUN; proceed to Stage Resolution.
- RunIndexStore.createRunFromArtifact() enforces the same single-active-run exclusivity as createRun(): on RUN_ALREADY_ACTIVE print the same message and stop.

#### Step 1.4: No Arguments -- Resume Active or Show Status

Resume the active/paused run, or (--status) report it read-only. A failure-parked run is never auto-re-executed.

- If `status` is true: this is a read-only report -- never a resume. No stage executes and no mutate() call is made regardless of what is found. Call RunIndexStore.findActive(projectRoot) for STATUS_RUN; if none, read the run files under .ensemble/new-feature/ (excluding active.lock) and take the one with the latest updatedAt (undefined if none).
- status=true, STATUS_RUN undefined: print 'No runs found for this project. Start one with --idea "<description>".' Stop here.
- status=true, STATUS_RUN found: print the run identifier, current stage, last stageOutcome.kind (with detail for a pending decision or failure), and every recorded artifacts[] and beadRefs[] reference; state a "completed"/"abandoned" status explicitly. Claim a PR exists only if STATUS_RUN.prApprovedAt is non-null AND a beadRefs[] entry has the "pr:" prefix; otherwise state plainly that no PR exists. Stop here -- status is always read-only and never proceeds to Stage Resolution.
- If `status` is false, `abandon` is not provided, and neither `idea` nor `path` is provided: call RunIndexStore.findActive(projectRoot).
- status=false, not found: print that no active run exists and how to start one (`--idea "<description>"`). Stop.
- status=false, found, and ACTIVE_RUN.stageOutcome.kind is "failure": the run is paused by failure. Print the parked stage and failure detail and ask the user (AskUserQuestion) 'Retry <stage>? [yes/no]' -- do NOT proceed to Stage Resolution on a bare invocation alone. Only an explicit 'yes' proceeds; otherwise stop with the run unchanged -- no mutate() call is made merely by viewing this prompt.
- Foreman mode: when FOREMAN == true and the outcome is "failure", do not ask (no question, no prompt). The invocation is the explicit retry: proceed to Stage Resolution, which retries the parked stage once; a second failure is recorded and the run ends.
- status=false, found, any other stageOutcome.kind ("approval_wait", "decline", or a fresh run): set ACTIVE_RUN and proceed to Stage Resolution; re-running these on resume is normal.

#### Step 1.5: Event-Triggered Entry (Opt-In)

Applies only to invocations from a configured event delivery (.ensemble/new-feature/event-mapping.json); absent that file it never fires.

- Call EventMappingConfig.loadEventMapping(projectRoot) (packages/agent-core/src/new-feature/event-mapping.ts). If it returns null: default-deny -- no run starts and nothing under RunIndexStore is touched. Stop; this is the normal state for a project that has not opted in.
- Otherwise call validateEventPayload(mapping, event) BEFORE any RunIndexStore call. Rejected (`ok: false`): create no PRD, advance no run, report the exact `reason` as the pending step, and stop.
- Accepted: present the event source and full payload to the user via AskUserQuestion for explicit review BEFORE any PRD-stage work (the payload's `summary` only seeds the normal PRD elicitation). On decline create no PRD, advance no run, and stop. On approval proceed as Step 2 with `event.summary` as the `idea`.
- Foreman mode: when FOREMAN == true an accepted payload is NOT auto-approved (untrusted input, no reviewer): create no PRD and no run, and report the pending step as 'human review of the event payload is required; --foreman cannot approve an untrusted event payload'. Stop.

#### Step 1.6: Abandon Confirmation Gate

Checked before Step 4; when `abandon` is provided, Step 4's resume/status branches never apply.

- If `abandon` is provided (empty string counts; only an omitted parameter skips this step): call RunIndexStore.findActive(projectRoot).
- Not found: print 'No active run exists for this project; nothing to abandon.' and stop -- no mutate()/abandon() call is made, no state is touched.
- Found: ask the user for explicit confirmation (AskUserQuestion), naming the run's identifier and current stage, before calling RunIndexStore.abandon(). Declined or no response: make no mutate()/abandon() call; the run is left untouched.
- Foreman mode: when FOREMAN == true do not ask for confirmation (no question, no prompt) -- `--abandon` with `--foreman` is the explicit instruction: call RunIndexStore.abandon(projectRoot, runId, reason) directly and print the run's identifier and the stage it was abandoned at.
- On explicit confirmation: call RunIndexStore.abandon(projectRoot, runId, reason), where `reason` is the `abandon` parameter's text (empty string if none). This sets status to "abandoned" and releases active.lock; artifacts and history are retained for a later `--status`.
