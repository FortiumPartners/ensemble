### Phase 3: Execution

Create branch, generate tasks, and implement the fix

#### Step 3.1: Branch Creation

Resolve TOOLCHAIN_CLI (RELATIVE_PATH packages/development/lib/toolchain-cli.js) via tool-path-resolution; node "$TOOLCHAIN_CLI" preflight --require host.change-request-create --require host.change-request-view --require host.change-request-list --require workflow.branch-create --require workflow.merge-base --require workflow.commit --require workflow.push --json [add --non-interactive when --foreman]; ok:false -> print it and HALT; RUN_ID = runId; every later toolchain-cli call passes --run-id "$RUN_ID" --json [add --non-interactive when --foreman].
Branch name is --branch if given, else fix/issue-{number}-{slugified-description} for --issue, else fix/{slugified-description}. If it already exists, ask the user to switch or pick another name; otherwise node "$TOOLCHAIN_CLI" run workflow.branch-create --arg name=<branch>.

#### Step 3.2: Task List Generation

Break the plan into 3-10 specific, testable tasks (implementation, test updates, validation), each tied to a file or component, tracked with TodoWrite.

#### Step 3.3: Task Execution

For each task set TodoWrite status "in_progress", delegate via Task (backend to backend-developer, frontend to frontend-developer, infrastructure to infrastructure-developer, else tech-lead-orchestrator), then set "completed". On failure leave it "in_progress", log the error, continue, and report failures at the end.

#### Step 3.4: Record Stage Checkpoint

Persist this phase's outcome and advance the run via issue-run-index.ts: IssueRunIndexStore.mutate(projectRoot, runId, revision, (record) => { record.stage = "validation_delivery"; record.stageOutcome = { kind: "success", recordedAt: now() }; }). On a thrown error halt; never proceed unrecorded.
