# PR Review Cycle-Time Workflow Plan

- **Status:** Proposed implementation plan
- **Date:** 2026-10-14
- **Repository:** Ensemble
- **Implementing harness:** OMP
- **Primary workflow:** Ensemble skills/spec-driven development, with HerdR as the user's multiplexer
- **Related commands:** `/ensemble:implement-trd-beads`, `/ensemble:fix-issue`
- **Reference only:** Foreman workflow definitions; do not change Foreman as part of this plan

## Objective

Reduce PR open-to-merge cycle time by at least 50% without reducing CodeRabbit review coverage or accepting unresolved actionable findings. Reduce avoidable review/fix rounds by doing a single base-correct local review, triaging findings together, fixing them as a batch, and verifying the combined result before requesting remote review.

Measure the target against a fresh baseline from a defined, comparable PR cohort. Report median and p75 open-to-merge time, first-review latency, number of CodeRabbit review/fix rounds, and time spent waiting on review separately. The target is a 50% reduction in median open-to-merge time; do not claim causality from historical PR duration alone.

## Scope and non-goals

- Add one reusable Ensemble skill that governs the local review → batched remediation → verification → remote-review disposition loop.
- Integrate that skill into `implement-trd-beads` and `fix-issue` at their real PR boundaries, preserving their existing test, requirements, task-closure, and completion gates.
- Make the generated OMP-facing command/skill artifacts consistent with their source files.
- Preserve CodeRabbit's existing review profile and the requirement to resolve actionable findings; do not suppress, weaken, or replace its review.
- Do not edit Foreman, change HerdR, automate merges, add a new review provider, or build a general PR dashboard as part of this work.
- Do not treat a worker's self-reported “done” or a successful local review as proof that remote CodeRabbit review is complete.

## Repository findings to preserve

- `packages/development/commands/implement-trd-beads.yaml` is the source for the generated command. It delegates task execution to `beads-build`, already has a per-task quality/reviewer lifecycle, phase quality gates, PR creation at phase or completion boundaries, and the independent `completion-verification` skill. Do not replace these safeguards with a second competing completion model.
- `packages/development/skills/complete-beads/SKILL.md` owns worker integration and leaf-bead closure. It already treats failed validation as non-integrable. If implementation reveals that the PR-boundary review must be enforced before bead/story closure, update this lifecycle at its owning layer rather than relying only on a later command-level reminder.
- `packages/development/commands/fix-issue.yaml` currently runs tests and then commits, pushes, and creates a PR. It has no local-review gate before publication. Its generated Codex command is `packages/codex/.codex/skills/commands/ensemble-fix-issue/SKILL.md`; generated files must not be hand-edited.
- `packages/development/skills/completion-verification/SKILL.md` independently checks task inventory, task/test closure, requirements, and the full suite. Keep it authoritative for those checks; add review evidence as a distinct completion condition rather than conflating review with test/requirement verification.
- Foreman's `fix.yaml` runs CodeRabbit and repo-rules review after the fix phase. Treat this as a sequencing/contract reference only. Keep any changes to Foreman outside this implementation unless separately requested.
- Existing Ensemble working-tree changes in `.beads/issues.jsonl`, `packages/agent-core/src/behavior/event-disposition.ts`, and `packages/agent-core/tests/file-source-adapter.test.ts` are unrelated user work and must remain untouched.

## Proposed reusable skill

Add `packages/development/skills/pr-review-cycle/SKILL.md` (final name may follow existing naming conventions) as the single reusable procedure. Commands should invoke it with explicit context rather than copy-paste divergent review instructions.

### Inputs

- Repository root, current branch, target base branch, and exact base commit SHA.
- PR URL/number when a PR exists; otherwise local branch diff.
- Workflow mode: pre-publication local review, post-CodeRabbit remediation, or resume.
- Existing test/quality results and, for TRD work, the affected phase/scope and relevant task IDs.
- Available GitHub review/comment access and whether this run is interactive or `--foreman`.

### Required review loop

1. **Establish the review base.** Resolve the intended target branch and merge base from the actual repository/PR metadata. Record base SHA and head SHA. Review only the change relative to that base; do not review the whole repository or stale commit range. If the base cannot be established reliably, report a blocker instead of guessing.
2. **Run one independent local review before publication.** Inspect the complete diff and relevant surrounding code for correctness, regressions, tests, security, and repository-specific rules. Use the configured reviewer agent/skill where available; do not invent agent aliases. Include the authoritative tool that obtains CodeRabbit's published review profile where feasible, but if an equivalent local invocation is unavailable, document the limitation and still run the repository's independent review. Local review supplements, never substitutes for, CodeRabbit.
3. **Produce a compact finding ledger.** For each finding record stable ID, source (local reviewer or CodeRabbit), file/line or comment URL, severity/actionability, concise failure mode, disposition (fix, duplicate, not applicable, or deferred), and evidence/reason. Preserve the original finding text or link. Do not silently discard uncertain findings; mark them for explicit adjudication.
4. **Batch remediation.** Triage the full set before editing. Apply compatible fixes together, avoid serial one-comment-at-a-time patches, and add a regression test for every correctness finding when practical. Do not make unrelated cleanup changes. Findings that are duplicates may share one fix while retaining links to every original comment.
5. **Verify the batch once.** Run focused tests for changed behavior, then the workflow's required quality/full-suite gate. Re-run the base-correct diff review after edits. Confirm the final diff contains no accidental or unrelated changes. If a new blocking defect is discovered, repair it and rerun the affected verification; do not repeatedly restart the entire loop for unchanged findings.
6. **Handle remote CodeRabbit review explicitly.** After publication, collect the complete review set for the current head (reviews, inline comments, and unresolved threads—not only the latest summary). Associate findings with the exact head SHA. Batch all actionable findings, record justified dispositions for non-fixes, commit/push the fixes, and wait for a review of the updated head. A prior review of an older SHA is not a pass for a newer head.
7. **Bound the loop without false completion.** Allow at most two automatic remediation rounds per head/review cycle. If actionable findings remain, CodeRabbit has not reviewed the latest head, review access is unavailable, or a required check fails, return a blocked/pending result with the ledger and next action. Never claim “review complete” merely because the retry limit was reached. Do not poll indefinitely; in interactive OMP, wait only for a bounded interval and then preserve a resumable pending state. In Foreman mode, emit the prescribed phase artifact with exact status and findings; do not invent a human response or claim remote review completion.
8. **Completion contract.** Return one of `REVIEW_COMPLETE`, `REVIEW_PENDING`, or `REVIEW_BLOCKED`, plus base/head SHAs, PR URL if known, rounds used, finding counts/dispositions, test commands/results, and report/artifact path. `REVIEW_COMPLETE` requires: current-head CodeRabbit review obtained; all actionable findings fixed or explicitly adjudicated with rationale; final required tests pass; no unresolved blocking comment/thread remains; and the final diff is understood. A user's explicit override may proceed past an incomplete workflow only where the calling command already supports an override; preserve the incomplete status and never relabel it complete.

### Efficiency rules

- Prefer one correct local review before opening/updating a PR, followed by one remote CodeRabbit review of the resulting head.
- Fetch comments and classify all findings before beginning fixes. Keep one ledger for a given head; update it instead of re-triaging already-dispositioned comments.
- Do not run redundant full suites after each individual comment fix. Run targeted tests during the batch, then the required broad suite once after the batch; rerun only impacted gates after a subsequent fix.
- Do not ask the user to approve routine, reversible code fixes. Ask only when scope/semantics are genuinely ambiguous, a finding is disputed, an irreversible action is required, or the existing workflow requires a user decision.
- Reuse repository test commands, review profile, and existing reviewer/QA roles. Avoid adding tools, dependencies, configuration knobs, or provider abstractions unless implementation proves a required capability is missing.

## Command integration plan

### `fix-issue`

Source: `packages/development/commands/fix-issue.yaml`.

1. Keep existing analysis, task execution, tests, commit conventions, and PR template.
2. Insert a **Local Review and Batch Fix** step after implementation and initial tests, but before commit/push/PR creation. Invoke the reusable skill in pre-publication mode against the resolved PR base. Apply the batch, rerun focused tests and the required test suite, then create the PR from the reviewed diff.
3. After PR creation, invoke the skill in remote-review mode when this command owns the complete PR lifecycle. Do not return success while CodeRabbit is pending or while actionable findings remain; return a resumable pending/blocked report and exact next action instead. In `--foreman` mode, do not wait forever or misrepresent completion: produce the required `FOREMAN_ARTIFACT_PATH` report with review status/head SHA/finding ledger. Foreman remains responsible for its separately configured downstream CodeRabbit phase.
4. Preserve the behavior that Foreman mode is non-interactive. If an unresolved finding requires a human decision, return `REVIEW_BLOCKED` with the decision required rather than prompting or silently dismissing it.
5. Update command metadata/version only if project conventions require it; retain all current parameters unless implementation evidence requires a narrowly justified change.

### `implement-trd-beads`

Source: `packages/development/commands/implement-trd-beads.yaml`; execution owner is `packages/development/skills/complete-beads/SKILL.md` / `beads-build`.

1. Preserve per-task reviewer and QA lifecycle, phase-specific quality gates, PR topology from `pr-plan`, and the independent completion-verification gate.
2. At each actual shippable PR boundary (each phase in stacked mode; once at completion in single-PR mode), run the reusable skill on the exact proposed branch/base before creating or updating the PR. Review only the current phase diff in stacked mode and the whole TRD branch diff at the single-PR boundary.
3. For stacked PRs, require the local review/fix/verification gate before proposing that phase's PR or appending the next branch. For single-PR mode, require it before the completion PR. Preserve the final full-suite/requirement verification.
4. Determine the correct ownership point for non-completion: because `complete-beads` closes task/story beads during execution, ensure a blocking local finding cannot be hidden behind a closed bead or completed phase. Prefer adding the finding ledger and review status to the existing worker/quality-gate result contract, and close/roll up only when existing definition-of-done conditions plus required review status pass. If CodeRabbit review is necessarily post-PR, distinguish `LOCAL_REVIEW_COMPLETE` from `REMOTE_REVIEW_PENDING`; do not force remote waiting into each worker or prevent integration of independently validated work solely because the remote service has not yet responded.
5. Keep the command's final completion-verification skill authoritative for TRD inventory, requirements, and tests. Add a separate PR-review completion check before epic closure/completion messaging for any PR the command owns. Pending remote review must remain visibly pending/resumable and must not be described as a merged/landed PR.
6. If the PR backend is manual or ADO MCP is absent, print the manual PR/review steps and report a truthful pending status; do not claim review evidence was gathered.

## Generated artifacts and source of truth

- Edit YAML command sources and skill source files only; regenerate outputs with the repository scripts rather than editing generated markdown.
- Relevant scripts: `npm run generate` (command markdown), `npm run generate:codex` (Codex outputs), and the appropriate package-specific generator if the new skill is packaged separately. Inspect generator routing before implementation and use only the needed commands.
- Verify generated Claude/OMP and Codex outputs include the same review gate, status meanings, and anti-early-completion behavior. Generated wrappers may summarize but must link/route to the authoritative skill procedure.
- Do not modify unrelated generated artifacts or bump versions without following existing generator/version policy.

## Tests and proof

Add/update focused structural contract tests, not tests that merely assert prose tokens without checking ordering and terminal conditions.

- **Skill tests:** valid inputs/status return contract; exact base/head identity; all-comment collection; deduplicated batch disposition; bounded rounds; latest-head re-review; fail-closed behavior when base/review data is missing; no `REVIEW_COMPLETE` on unresolved actionable findings, failed tests, pending review, or stale review SHA.
- **`fix-issue` tests:** local review is ordered after implementation/tests and before commit/push/PR; PR success is gated on local review/verification; remote pending is distinguishable from complete; `--foreman` writes status to exact artifact path when provided and does not wait/prompt; generated artifact parity.
- **`implement-trd-beads` / `complete-beads` tests:** gates land at phase PR and single-PR boundaries as appropriate; phase/stacked topology remains unchanged; no bead/story/epic can be closed or reported complete while a required blocking local review remains; remote review pending is accurately represented; existing `completion-verification` behavior and manual/ADO backend paths remain intact.
- **Regression tests:** no changes to unrelated user modifications; review of one phase does not accidentally include later phases or base commits; a newer pushed head invalidates earlier CodeRabbit approval; explicit existing override paths preserve an incomplete audit status.
- **Repository verification:** run focused Jest tests for affected command/skill packages, generation validation (`npm run generate:validate` and relevant generator validation), then the repository's required tests (`npm test` / workspace equivalent). Inspect `git diff` and generated files; do not commit or push as part of implementation unless separately requested.

## Implementation sequence for OMP

1. Inspect skill packaging/generation rules, existing review agent aliases and test harnesses; identify exact GitHub review/comment access already available. Do not assume a CodeRabbit CLI or an OMP-native API that is not present.
2. Implement the reusable skill and its testable status/evidence contract first. Keep it procedural unless an existing library seam makes deterministic behavior materially safer.
3. Integrate `fix-issue`; update its structural tests and generate its supported OMP/Codex artifacts.
4. Trace `implement-trd-beads` through `beads-build`/`complete-beads` and phase/single-PR paths; implement the smallest ownership-correct integration and update closure/completion tests. Do not duplicate its existing quality or completion-verification logic.
5. Run focused tests and generators; inspect the final diff and confirm no Foreman files or unrelated local changes were touched.
6. Report what changed, test evidence, any capability gaps (especially CodeRabbit review retrieval/resume), and what must be measured in a pilot. Do not report the 50% goal as achieved until a comparable post-change cohort proves it.

## Acceptance criteria

- Both commands call one shared review procedure and cannot claim successful review completion early.
- Local review is base-correct and precedes PR publication; actionable local findings are triaged together, fixed as a batch, and verified before publication.
- CodeRabbit remains enabled and authoritative for remote review; only a review for the current head can satisfy the remote-review condition.
- Every finding is fixed or has an explicit, evidence-backed disposition; unresolved blocking findings and unavailable review evidence remain pending/blocked, never silently complete.
- Stacked phase PRs, single-PR mode, manual/ADO paths, non-interactive Foreman artifact contract, existing bead and TRD completion gates, and test-skip behavior remain truthful and compatible.
- Generated OMP-facing and Codex artifacts match source behavior, and focused tests cover ordering, status transitions, resume, and early-finish regressions.
- A pilot measures the defined cycle-time metrics and demonstrates at least 50% median open-to-merge reduction before the target is considered met.

## Stop condition

Stop once the shared skill, both integrations, generation parity, focused regression proof, and a pilot measurement plan satisfy the acceptance criteria. Do not broaden scope into Foreman implementation, review-profile changes, merge automation, or generalized orchestration.
