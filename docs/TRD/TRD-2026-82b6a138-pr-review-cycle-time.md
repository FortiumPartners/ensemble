---
document_id: TRD-2026-82b6a138
label: trd-pr-review-cycle-time
kind: trd
prd_reference: PRD-2026-82b6a138
prd_path: docs/PRD/PRD-2026-82b6a138-pr-review-cycle-time.md
version: 1.0.6
status: Draft
date: 2026-10-14
design_readiness_score: 4.38
Constitution compliance: passed
---

# TRD-2026-82b6a138: PR Review Cycle-Time Workflow

Based on PRD: docs/PRD/PRD-2026-82b6a138-pr-review-cycle-time.md

## Architecture Decision

**Chosen approach (Option C):** One shared, prose-defined review procedure plus a small deterministic helper library.

- `packages/development/skills/pr-review-cycle/SKILL.md` is the single reusable procedure. It owns the *user-editable* parts (Constitution Rule 8): review criteria, the order of the loop, the 10-minute interactive wait, Foreman-mode rules. It **composes** `packages/quality/skills/pr-review-remediation/SKILL.md` for per-finding triage, regression tests and minimal fixes and does not restate those rules.
- A set of small pure-JS modules in `packages/development/lib/` owns only what *grades the model's own claim* (Constitution Rule 8's enforcement exception, and Rule 7): base/head scope resolution, ledger validation, head-bound remote-review evaluation, terminal-status derivation with the bounded-round cap, and the untracked review-state report. A thin CLI, `pr-review-cli.js`, exposes them as JSON-in/JSON-out commands, following the `trd-cli.js` / `complete-beads-planner.js` precedent.
- `fix-issue.yaml`, `implement-trd-beads.yaml` and `complete-beads/SKILL.md` invoke the skill at their real PR boundaries; none re-states review steps.

**Alternatives considered (user chose C):**

- **Option A -- prose-only skill:** fewest files, but "no early REVIEW_COMPLETE", head-binding and the round cap would be prose a model can misread, and tests could only assert text ordering. Rejected: the plan's core guarantee would not be falsifiable (Rule 7).
- **Option B -- TypeScript runtime in agent-core:** strongest typing, but a new build/dist surface and cross-package coupling for a prompt-level feature, and it pulls editable criteria toward code (against Rule 8). Rejected.

**Rationale:** Option C is the best fit for this brownfield repo: the helper is the minimum code that makes the status contract testable and unforgeable, everything a maintainer would plausibly tune stays in a skill file, and it needs no new dependency, provider or config knob.

## Domain Analysis

| Domain | Present? | Notes |
|---|---|---|
| Skill/prompt content | Yes | New `pr-review-cycle` skill; edits to command YAML sources and `complete-beads` skill |
| Library/CLI (Node.js, pure functions) | Yes | `pr-review-*.js` modules + `pr-review-cli.js` in `packages/development/lib/` |
| Data model | No | The review-state report is a small untracked JSON file, not a schema/migration/persistent entity change |
| Infrastructure / external services | Read-only | GitHub review/comment/check data is fetched by the skill with the already-authenticated `gh` CLI and passed to the helper as JSON; the helper makes no network calls |
| Security | Yes | Review comments are untrusted input; reports must not contain secrets; boundary validation in the CLI |
| Packaging/generation | Yes | Pi vendor bundle (`lib-bundler.ts` ENTRY_FILES), `packages/full` mirrors, Pi/Codex/markdown generators |

**Greenfield or brownfield:** brownfield.

**COMPANION_DOMAINS:** empty (no persistence-schema change; the architecture alternatives are recorded inline above, not a vendor/tool selection).

## Companion Artifacts

No companion artifacts generated.

## Reused Capabilities

No foundational TRD capabilities matched (`trd-graph-cli capabilities docs/TRD` returned an empty registry). Reused existing code instead: `pr-review-remediation` skill (per-finding remediation), `tool-path-resolution` skill (CLI lookup), `trd-cli.js`-style CLI convention, `lib-bundler.ts` require-closure vendoring.

## System Architecture

### Components and boundaries

1. **`SKILL.md` (pr-review-cycle)** -- orchestrates the loop; the only component that talks to `git`, `gh`, the reviewer agent and `pr-review-remediation`. Calls the CLI for every grading decision.
2. **`pr-review-scope.js`** -- `resolveReviewScope({ baseRef, baseSha, headSha, mergeBaseSha, prBaseSha })` -> `{ ok, baseSha, headSha, range }` or `{ ok:false, status:'REVIEW_BLOCKED', missing:[...] }`. Never guesses a base; `range` is always `baseSha..headSha`.
3. **`pr-review-ledger.js`** -- `validateLedger`, `isActionable`, `dedupeFindings`, `scopeViolations`. Fail-closed validation of the finding ledger (REQ-004, AC-009-2/4).
4. **`pr-review-remote.js`** -- `evaluateRemoteReview({ headSha, reviews, checkRuns, threads, botLogins })` -> remote-phase qualifier + unresolved threads. Counts only a bot-authored review/check whose commit identity equals `headSha`.
5. **`pr-review-status.js`** -- `deriveStatus(facts)` -> `{ status, localPhase, remotePhase, reasons }` and `MAX_AUTO_ROUNDS = 2`. The only place `REVIEW_COMPLETE` can be produced.
6. **`pr-review-state.js`** -- read/write/invalidate the per-PR review-state report at `.ensemble/pr-review/<key>.json`; redacts secrets; discards state when the head changed.
7. **`pr-review-cli.js`** -- subcommands `scope`, `ledger`, `remote`, `status`, `state-read`, `state-write`; JSON on stdin/stdout; exit non-zero only on malformed input.
8. **Callers** -- `fix-issue.yaml`, `implement-trd-beads.yaml`, `complete-beads/SKILL.md` (invoke the skill; never grade by prose).

### Data flow

```
caller (fix-issue | implement-trd-beads) --context--> SKILL.md
SKILL.md --git/gh read--> raw review data --JSON--> pr-review-cli.js --> pure modules
pr-review-cli.js --status/qualifiers--> SKILL.md --> caller (gates PR publication / epic closure)
SKILL.md --> .ensemble/pr-review/<key>.json (untracked; never part of the PR head)
```

### Interface contract (CLI)

- `status` input: `{ local:{ phase, blockers[] }, remote:{ phase, headSha }, tests:{ passed, skipped }, ledger:{ findings[] }, roundsUsed, headSha, reviewedHeadSha, scope:{ violations[] } }` -> `{ status:'REVIEW_COMPLETE'|'REVIEW_PENDING'|'REVIEW_BLOCKED', localPhase, remotePhase, reasons[] }`.
- Failure semantics: unknown/missing required input -> `REVIEW_BLOCKED` with `reasons` naming the missing field; the CLI itself exits non-zero only for unparseable JSON.
- The helper performs **no network I/O** and holds **no wait interval**: the 10-minute wait lives in the skill text (Rule 8).

### Review-state report (resume)

- Path: `.ensemble/pr-review/<repo-slug>-pr-<number|branch>.json`, listed in `.gitignore`. It is deliberately **untracked**: committing it to the PR branch would change the head SHA and invalidate the very review it records.
- Contents: head SHA, base SHA, ledger, qualifiers, rounds used, next action, timestamps. Secrets are redacted on write.
- Resume is operator-invoked and in-session only; nothing schedules or retries (Rule 4).

### Integration points (existing files, edited at source)

- `packages/development/commands/fix-issue.yaml` -- Validation & Delivery: `Test Validation` -> **Local Review and Batch Fix** -> `PR Creation` -> **Remote Review Disposition** -> `Record Stage Checkpoint`.
- `packages/development/commands/implement-trd-beads.yaml` -- Quality Gate "Gate Result Recording" (per-phase PR, stacked mode) and Completion "Completion Report" (single PR); a PR-review check runs before Epic Closure, after the unchanged `completion-verification`.
- `packages/development/skills/complete-beads/SKILL.md` -- worker/quality-gate result carries the ledger and local status; story roll-up and epic closure are gated on `LOCAL_REVIEW_COMPLETE`; `COMPLETE_BEADS_RESULT` gains review fields.
- Packaging: `packages/pi/src/transformers/lib-bundler.ts` `ENTRY_FILES`, `packages/full/lib/*` symlinks, `packages/full/skills` mirror, `.gitignore`.

## Master Task List

### PR 1: Shared Review Procedure and Status Contract
**Shippable State:** A maintainer can invoke the `pr-review-cycle` skill from an OMP, Claude or Codex install and get a deterministic, head-bound `REVIEW_COMPLETE` / `REVIEW_PENDING` / `REVIEW_BLOCKED` result with a validated finding ledger and an untracked, resumable review-state report; no command calls it yet.

- [ ] **TRD-001** Review scope resolver (`pr-review-scope.js`) [satisfies REQ-002] (3h)
  - Validates PRD ACs: AC-002-1, AC-002-2, AC-002-3
  - Implementation AC:
    - [ ] Given a resolvable base and head, when `resolveReviewScope` runs, then it returns `baseSha`, `headSha` and `range = baseSha..headSha` and nothing else is reviewable
    - [ ] Given the base SHA or merge-base cannot be established, when it runs, then it returns `ok:false`, `status:'REVIEW_BLOCKED'` and `missing[]` naming each absent input, and never substitutes a guessed base
    - [ ] Given a stacked phase whose base is the parent phase branch tip, when it runs, then `range` starts at that parent tip so later phases and the base's own commits are excluded

- [ ] **TRD-001-TEST** Review scope resolution [Verifies TRD-001] [Satisfies REQ-002] [Depends: TRD-001] (3h)
  - Validates PRD ACs: AC-002-1, AC-002-2, AC-002-3
  - Test AC:
    - [ ] Scenario: base and head recorded -- Given a PR with a resolvable base, When the scope is resolved, Then both SHAs are returned and the range is base..head
    - [ ] Scenario: unknown base blocks -- Given metadata with no base SHA, When the scope is resolved, Then the result is REVIEW_BLOCKED naming the missing base and no range is produced
    - [ ] Scenario: stacked phase excludes later phases -- Given phase 2 branching from phase 1's tip, When the scope is resolved, Then the range excludes phase 1 commits and any phase 3 commits

- [ ] **TRD-002** Finding ledger validation, actionability and scope check (`pr-review-ledger.js`) [satisfies REQ-004, REQ-009] (4h)
  - Validates PRD ACs: AC-004-1, AC-004-2, AC-004-3, AC-004-4, AC-009-2, AC-009-4
  - Implementation AC:
    - [ ] Given a ledger, when `validateLedger` runs, then every finding must carry id, source, location-or-link, severity, failure mode, disposition (fix|duplicate|not-applicable|deferred), evidence, and original text or link, else it is rejected with the offending ids
    - [ ] Given findings, when `isActionable` runs, then any unresolved thread or Critical/Major finding is actionable and a Minor/nitpick finding may be `deferred` only with a recorded disposition and reason; an uncertain finding is marked `adjudicate` and never dropped
    - [ ] Given duplicate findings, when `dedupeFindings` runs, then they share one fix id and keep every original link, and an already-dispositioned finding for the same head is not re-opened
    - [ ] Given changed files and a declared scope, when `scopeViolations` runs, then each changed file outside the scope without a ledger entry is returned

- [ ] **TRD-002-TEST** Finding ledger behavior [Verifies TRD-002] [Satisfies REQ-004, REQ-009] [Depends: TRD-002] (4h)
  - Validates PRD ACs: AC-004-1, AC-004-2, AC-004-3, AC-004-4, AC-009-2, AC-009-4
  - Test AC:
    - [ ] Scenario: complete finding accepted, incomplete rejected -- Given one full finding and one missing its evidence, When the ledger is validated, Then only the incomplete one is reported
    - [ ] Scenario: uncertain finding is kept -- Given a finding of uncertain validity, When the ledger is built, Then it is marked adjudicate and remains in the ledger
    - [ ] Scenario: duplicates share a fix -- Given two comments on the same defect, When they are deduplicated, Then one fix id exists and both original links are retained
    - [ ] Scenario: dispositioned findings are not re-triaged -- Given a head with dispositioned findings, When new comments arrive, Then only new findings are added
    - [ ] Scenario: out-of-scope file needs a ledger entry -- Given a changed file outside the declared scope with no ledger entry, When scope is checked, Then it is returned as a violation
    - [ ] Scenario: actionability boundary -- Given an unresolved thread, a Major finding and a deferred Minor finding, When actionability is classified, Then the first two are actionable and the third needs an explicit disposition

- [ ] **TRD-003** Head-bound remote review evaluator (`pr-review-remote.js`) [satisfies REQ-007] (4h)
  - Validates PRD ACs: AC-007-1, AC-007-2, AC-007-3, AC-007-4
  - Implementation AC:
    - [ ] Given reviews, inline comments, threads and check runs for a PR, when `evaluateRemoteReview` runs, then all of them for the current head are returned (not only the latest summary) along with every unresolved thread
    - [ ] Given any bound or unbound bot item, when `evaluateRemoteReview` decides, then every item kind and state has a defined verdict and the evaluator fails closed: a review in an unrecognised, missing or non-string state blocks; an effective `CHANGES_REQUESTED` (computed per author over all of that author's reviews on every head, superseded only by a later `APPROVED` or `DISMISSED`) blocks; a check run counts only with conclusion `success` or `neutral` and a failed, cancelled, timed-out, action-required, unfinished or unknown bot check blocks; a thread counts as resolved only when `resolved === true`; a malformed `access` or a missing collection never completes; a comment can be evidence but never overrides a block; and completion still requires positive evidence bound to the current head
    - [ ] Given a review whose commit identity differs from `headSha`, when it runs, then that review does not count and `remotePhase` is `REMOTE_REVIEW_PENDING` (including after a rebase or force-push)
    - [ ] Given reviews from several authors, when it runs, then only a review or check authored by a configured CodeRabbit bot login and bound to the exact head commit counts
    - [ ] Given only a summary comment with no commit identity, when it runs, then it is reported unverifiable and `remotePhase` is `REMOTE_REVIEW_PENDING`

- [ ] **TRD-003-TEST** Head-bound remote review [Verifies TRD-003] [Satisfies REQ-007] [Depends: TRD-003] (4h)
  - Validates PRD ACs: AC-007-1, AC-007-2, AC-007-3, AC-007-4
  - Test AC:
    - [ ] Scenario: complete set collected -- Given reviews, inline comments and an unresolved thread on the head, When evaluated, Then all are present in the result
    - [ ] Scenario: older head review does not count -- Given a bot review of head A and a current head B, When evaluated, Then the phase is REMOTE_REVIEW_PENDING
    - [ ] Scenario: non-bot review does not count -- Given a human approval bound to the head and no bot review, When evaluated, Then the phase is not REMOTE_REVIEW_COMPLETE
    - [ ] Scenario: summary without commit identity is unverifiable -- Given only a SHA-less bot summary, When evaluated, Then the phase is REMOTE_REVIEW_PENDING and the summary is flagged unverifiable

- [ ] **TRD-004** Status derivation and bounded rounds (`pr-review-status.js`) [satisfies REQ-008, REQ-009, REQ-010, REQ-014] (6h)
  - Validates PRD ACs: AC-008-1, AC-008-2, AC-008-4, AC-008-5, AC-008-6, AC-009-1, AC-009-3, AC-009-5, AC-009-6, AC-010-1, AC-014-1, AC-014-2
  - Implementation AC:
    - [ ] Given facts, when `deriveStatus` runs, then it returns exactly one of the three statuses plus `localPhase` and `remotePhase` qualifiers and the AC-009-1 fields (SHAs, PR URL if known, rounds, finding counts, test commands/results, report path)
    - [ ] Given any of: unresolved actionable finding, failed test, pending review, stale `reviewedHeadSha`, or skipped tests, when it runs, then `REVIEW_COMPLETE` is never returned; `REVIEW_COMPLETE` requires `LOCAL_REVIEW_COMPLETE` and `REMOTE_REVIEW_COMPLETE`
    - [ ] Given `roundsUsed >= MAX_AUTO_ROUNDS` (2) with actionable findings, when it runs, then the result is `REVIEW_PENDING` or `REVIEW_BLOCKED` with the ledger and next action, never complete
    - [ ] Given unavailable or unauthorized review access, when it runs, then it returns `REVIEW_BLOCKED`; given access works but the head's review is not posted, it returns `REVIEW_PENDING`
    - [ ] Given `tests.skipped`, when it runs, then it returns `REVIEW_PENDING` with reason `tests skipped` and the test command to run; given an explicit override flag from a caller that supports it, the incomplete status is preserved and never relabeled

- [ ] **TRD-004-TEST** Status derivation contract [Verifies TRD-004] [Satisfies REQ-008, REQ-009, REQ-010, REQ-014] [Depends: TRD-004] (6h)
  - Validates PRD ACs: AC-008-1, AC-008-2, AC-008-4, AC-008-5, AC-008-6, AC-009-1, AC-009-3, AC-009-5, AC-009-6, AC-010-1, AC-014-1, AC-014-2
  - Test AC:
    - [ ] Scenario: at most two rounds -- Given roundsUsed of 2 and an unresolved finding, When status is derived, Then no third automatic round is permitted
    - [ ] Scenario: round limit never completes -- Given the limit reached with actionable findings, When status is derived, Then it is not REVIEW_COMPLETE
    - [ ] Scenario: unauthorized access blocks -- Given a 403 from review retrieval, When status is derived, Then it is REVIEW_BLOCKED naming the access problem
    - [ ] Scenario: not-yet-posted review is pending -- Given working access and no review for the head, When status is derived, Then it is REVIEW_PENDING not blocked
    - [ ] Scenario: failed required check prevents completion -- Given a failing required check, When status is derived, Then it is not REVIEW_COMPLETE
    - [ ] Scenario: result carries the full contract -- Given a derived status, When serialized, Then it holds SHAs, rounds, counts, tests and report path
    - [ ] Scenario: each blocker alone prevents completion -- Given exactly one of unresolved finding, failed test, pending review or stale SHA, When status is derived, Then none yields REVIEW_COMPLETE
    - [ ] Scenario: qualifiers are reported -- Given local and remote phases, When status is derived, Then both qualifiers appear beside the terminal status
    - [ ] Scenario: local complete plus remote pending is pending -- Given LOCAL_REVIEW_COMPLETE and REMOTE_REVIEW_PENDING, When status is derived, Then REVIEW_PENDING is returned
    - [ ] Scenario: override never relabels -- Given a caller override on an incomplete result, When status is derived, Then the status stays incomplete
    - [ ] Scenario: skip-tests keeps local review but not completion -- Given skipped tests, When status is derived, Then the local phase may complete but the status is not REVIEW_COMPLETE
    - [ ] Scenario: skip-tests reports its reason -- Given skipped tests, When status is derived, Then REVIEW_PENDING carries the reason tests skipped and the test command

- [ ] **TRD-005** Untracked review-state report (`pr-review-state.js`) [satisfies REQ-024, REQ-025] (4h)
  - Validates PRD ACs: AC-024-2, AC-025-1, AC-025-2, AC-025-3
  - Implementation AC:
    - [ ] Given a pending or blocked result, when `writeState` runs, then it writes one report per PR under `.ensemble/pr-review/` containing head and base identity, ledger, qualifiers, rounds and next action
    - [ ] Given a report written for head H and a resume for head H, when `readState` runs, then the dispositioned findings are returned so they are not redone; given a different head, the prior review state is discarded
    - [ ] Given text that matches credential patterns (tokens, keys, `Authorization` headers), when the report is written, then those values are redacted
    - [ ] Given a path outside `.ensemble/pr-review/`, when `writeState` runs, then it refuses to write

- [ ] **TRD-005-TEST** Review-state report [Verifies TRD-005] [Satisfies REQ-024, REQ-025] [Depends: TRD-005] (4h)
  - Validates PRD ACs: AC-024-2, AC-025-1, AC-025-2, AC-025-3
  - Test AC:
    - [ ] Scenario: secrets are redacted -- Given a ledger entry containing a token, When the report is written, Then the file contains no token value
    - [ ] Scenario: resume re-checks the same head -- Given a pending report for head H, When it is read for head H, Then dispositioned findings are returned
    - [ ] Scenario: new head discards old state -- Given a pending report for head A, When it is read for head B, Then the earlier review state is not returned
    - [ ] Scenario: report holds the required fields and lives in the untracked area -- Given a pending result, When the report is written, Then it contains head, ledger, qualifiers and next action under .ensemble/pr-review/

- [ ] **TRD-006** CLI entry point (`pr-review-cli.js`) [satisfies REQ-001, REQ-009, REQ-025] [Depends: TRD-001, TRD-002, TRD-003, TRD-004, TRD-005] (3h)
  - Validates PRD ACs: AC-009-1, AC-025-1, AC-025-2
  - Implementation AC:
    - [ ] Given JSON on stdin, when `scope|ledger|remote|status|state-read|state-write` runs, then it delegates to the matching module and prints JSON on stdout
    - [ ] Given a required review fact is missing or invalid (a SHA that is not a full hex object id, a missing `reviewedHeadSha`, a non-numeric actionable count), when `scope` or `status` runs, then the result is never a completed phase: every returned `localPhase`/`remotePhase` is a member of the exported `LOCAL_PHASES`/`REMOTE_PHASES`, `LOCAL_REVIEW_BLOCKED` is actually emittable (access failure, missing facts, round limit), and `LOCAL_REVIEW_COMPLETE` additionally requires the tests to have passed or been explicitly skipped, so callers can gate on exactly `LOCAL_REVIEW_COMPLETE` and treat every other value as blocked (fail-closed)
    - [ ] Given the local review is bound to a snapshot commit and the pushed commit is a different commit of the same files, when `status` or `state-read` receives matching `reviewedTreeSha`/`headTreeSha` (`treeSha`, full object ids), then the review is fresh and `REVIEW_COMPLETE` is reachable end to end; given different trees, a tree supplied on one side only, or an unreadable tree id, then it is stale or blocked and never complete (head equality alone also suffices)
    - [ ] Given unparseable JSON, when any subcommand runs, then it exits non-zero with a message and writes no state
    - [ ] Given the CLI is invoked from a shell, when run end to end, then the result equals the module's direct result (no divergence between CLI and library)
    - [ ] Given a 200-finding ledger and a 50-review remote payload, when `ledger` and `remote` run through the CLI, then each completes in under 1 second and makes no network call

- [ ] **TRD-006-TEST** CLI end to end [Verifies TRD-006] [Satisfies REQ-001, REQ-009, REQ-025] [Depends: TRD-006] (3h)
  - Validates PRD ACs: AC-009-1, AC-025-1, AC-025-2
  - Test AC:
    - [ ] Scenario: status through the real CLI returns the contract -- Given facts on stdin, When `node pr-review-cli.js status` runs, Then stdout is JSON with status, qualifiers, SHAs and counts, and a 200-finding ledger with 50 reviews evaluates in under 1 second with no network access
    - [ ] Scenario: resume through the CLI -- Given state written for head H, When `state-read` runs for H, Then dispositioned findings are returned
    - [ ] Scenario: stale head through the CLI -- Given state written for head A, When `state-read` runs for head B, Then no earlier state is returned

- [ ] **TRD-007** Packaging: Pi vendor bundle, `packages/full` mirrors, `.gitignore` [satisfies REQ-001, REQ-019, REQ-025] [Depends: TRD-006] (3h)
  - Validates PRD ACs: AC-001-3, AC-019-3, AC-025-3
  - Implementation AC:
    - [ ] Given an OMP install, when the skill resolves the CLI via `tool-path-resolution`, then `pr-review-cli.js` and every `pr-review-*.js` sibling are present because `pr-review-cli.js` is in `lib-bundler.ts` `ENTRY_FILES` and the require closure vendors the rest, and `packages/pi/tests/lib-bundler.test.ts` (which enumerates the real entry points explicitly) lists `pr-review-cli.js`
    - [ ] Given `packages/full`, when `npm run validate` runs, then every new `packages/development/lib/pr-review-*.js` has a `packages/full/lib` symlink and the new skill has its per-skill mirror, and the mirror check passes
    - [ ] Given `.gitignore`, when `git check-ignore .ensemble/pr-review/x.json` runs, then it reports the path ignored, so a state report can never alter the PR head

- [ ] **TRD-007-TEST** Packaging reachability [Verifies TRD-007] [Satisfies REQ-001, REQ-019, REQ-025] [Depends: TRD-007] (3h)
  - Validates PRD ACs: AC-001-3, AC-019-3, AC-025-3
  - Test AC:
    - [ ] Scenario: vendored bundle contains the CLI and its modules -- Given the lib bundler runs, When the vendor directory is listed, Then pr-review-cli.js and all pr-review-* modules are present
    - [ ] Scenario: mirror validation passes -- Given the new files exist, When the repository validation runs, Then the packages/full mirror check passes with no missing link
    - [ ] Scenario: state reports are untracked -- Given a report under .ensemble/pr-review/, When git check-ignore runs, Then the path is ignored

- [ ] **TRD-008** `pr-review-cycle` skill (`SKILL.md`) [satisfies REQ-001, REQ-003, REQ-005, REQ-006, REQ-007, REQ-008, REQ-023, REQ-024, REQ-025] [Depends: TRD-006] (6h)
  - Validates PRD ACs: AC-003-1, AC-003-2, AC-005-1, AC-005-2, AC-005-4, AC-006-1, AC-006-2, AC-007-5, AC-008-3, AC-023-1, AC-024-1, AC-025-4
  - Implementation AC:
    - [ ] Given the skill, when read in order, then the steps run: resolve scope (CLI `scope`) -> independent local review of the full diff -> build ledger (CLI `ledger`) -> triage all findings before any edit -> batch fix by delegating to `pr-review-remediation` -> verify once (focused tests, then the broad gate once) and re-review the diff -> (after publication) collect the full remote set and evaluate (CLI `remote`) -> derive status (CLI `status`) -> write state (CLI `state-write`)
    - [ ] Given a CodeRabbit-equivalent local invocation is unavailable, when the skill reports, then it states the limitation and still runs the independent local review; given an interactive run waiting on the remote review, then it waits at most 10 minutes (stated in the skill text, not in code) and returns `REVIEW_PENDING` with a resume instruction
    - [ ] Given review comments, when processed, then they are treated as data and embedded instructions are not followed; given resume, then it is operator-invoked in-session only and never schedules, polls in the background, retries after the wait, or recovers unattended
    - [ ] Given the skill, when it specifies remediation, then it delegates to `pr-review-remediation` and does not re-specify its triage/test/minimal-fix rules
    - [ ] Given `pr-review-remediation` (package ensemble-quality) is not installed, when the skill reaches remediation, then it halts as `REVIEW_BLOCKED` naming the missing capability and how to obtain it (install/enable the quality package), creates no review state, and never silently skips remediation

- [ ] **TRD-008-TEST** Skill structure and delegation [Verifies TRD-008] [Satisfies REQ-001, REQ-003, REQ-005, REQ-006, REQ-007, REQ-008, REQ-023, REQ-024, REQ-025] [Depends: TRD-008] (4h)
  - Validates PRD ACs: AC-003-1, AC-003-2, AC-005-1, AC-005-2, AC-005-4, AC-006-1, AC-006-2, AC-007-5, AC-008-3, AC-023-1, AC-024-1, AC-025-4
  - Test AC:
    - [ ] Scenario: local review precedes publication -- Given the skill's step order, When parsed, Then the local review step index is before any publish or remote step
    - [ ] Scenario: missing local equivalent is documented -- Given the skill text, When the unavailable-local-tool case is read, Then it requires stating the limitation and still running the independent review
    - [ ] Scenario: all findings are triaged before the first edit -- Given the step order, When parsed, Then triage-all precedes the first fix step
    - [ ] Scenario: fixes are one batch -- Given the remediation step, When read, Then it applies compatible fixes together and forbids serial one-comment patches
    - [ ] Scenario: remediation is delegated and its absence blocks -- Given the skill, When searched for remediation rules or run without pr-review-remediation installed, Then it references that skill, does not restate its triage rules, and returns REVIEW_BLOCKED naming the missing capability
    - [ ] Scenario: broad gate runs once after the batch -- Given the verify step, When read, Then focused tests precede a single broad gate
    - [ ] Scenario: diff is re-reviewed after edits -- Given the verify step, When read, Then a base-correct diff re-review follows the edits
    - [ ] Scenario: remote fixes are batched before push -- Given the remote step, When read, Then all actionable findings are fixed or dispositioned before the push
    - [ ] Scenario: ten-minute wait lives in the skill -- Given the repo, When searched, Then the 10-minute wait is in SKILL.md and no wait constant exists in the lib modules
    - [ ] Scenario: criteria are editable without a rebuild -- Given a change to the skill text, When the CLI runs, Then no code change or rebuild is needed
    - [ ] Scenario: comments are untrusted -- Given the skill's input handling, When read, Then embedded instructions in comments are treated as data
    - [ ] Scenario: resume is operator-invoked only -- Given the skill's resume rules, When read, Then no scheduling, background polling or unattended retry is specified

### PR 2: fix-issue Review Gate
**Shippable State:** A developer running `/ensemble:fix-issue` gets a base-correct local review and batch fix before anything is committed or pushed, and the command reports `REVIEW_PENDING`/`REVIEW_BLOCKED` instead of success while CodeRabbit has not reviewed the latest head, in both OMP and Codex.

- [ ] **TRD-009** fix-issue: Local Review and Batch Fix step before publication [satisfies REQ-011, REQ-014] [Depends: TRD-008] (4h)
  - Validates PRD ACs: AC-011-1, AC-011-2, AC-011-3, AC-011-4, AC-014-1, AC-014-2
  - Implementation AC:
    - [ ] Given `fix-issue.yaml`, when the Validation & Delivery steps are read in `order`, then Test Validation (1) -> Local Review and Batch Fix (2) -> PR Creation (3) -> Remote Review Disposition (4) -> Record Stage Checkpoint (5), and the new step invokes `pr-review-cycle` in pre-publication mode against the resolved PR base
    - [ ] Given any `localPhase` other than exactly `LOCAL_REVIEW_COMPLETE` (pending, blocked, a missing or unparseable result, or the skill returning nothing, for example when `pr-review-remediation` is not installed), when the step finishes, then `prApprovedAt` stays null, a failure `stageOutcome` is recorded, the Foreman artifact is written first under `--foreman`, and the run HALTs before any commit, push or PR; the reviewed head is a snapshot commit that includes untracked files (built from a temporary index, never `git stash create`) and is re-resolved after the batch fix
    - [ ] Given the local review returns `LOCAL_REVIEW_COMPLETE` (including on the `--skip-tests` path), when the Local Review and Batch Fix step ends, then it alone calls `IssueRunIndexStore.mutate()` to set `prApprovedAt`; Test Validation no longer sets it, so a `LOCAL_REVIEW_BLOCKED` or unfinished review leaves `prApprovedAt` null and PR Creation's existing "read prApprovedAt directly, null denies" precondition denies the call with no commit, push or PR
    - [ ] Given the existing prApprovedAt tests in `fix-issue-command.test.js` (the Test Validation and PR Creation cases), when this change lands, then they are updated in the same PR to assert the new location of the mutate
    - [ ] Given `--skip-tests`, when the review runs, then it still runs, the PR may be created as today, and the status is `REVIEW_PENDING` with reason `tests skipped` and the test command
    - [ ] Given the change, when `fix-issue` runs, then all parameters, analysis/planning steps, commit conventions and the PR template are unchanged

- [ ] **TRD-009-TEST** fix-issue review gate ordering [Verifies TRD-009] [Satisfies REQ-011, REQ-014] [Depends: TRD-009] (4h)
  - Validates PRD ACs: AC-011-1, AC-011-2, AC-011-3, AC-011-4, AC-014-1, AC-014-2
  - Test AC:
    - [ ] Scenario: review runs after tests and before commit -- Given the parsed step order, When read, Then Local Review follows Test Validation and precedes any git commit, push or gh pr create
    - [ ] Scenario: PR is created from the reviewed diff -- Given a completed batch, When PR Creation runs, Then it follows verification of the batch
    - [ ] Scenario: existing contract preserved -- Given the updated YAML, When parameters, commit format and PR template are compared, Then they are unchanged
    - [ ] Scenario: blocked local review publishes nothing -- Given a LOCAL_REVIEW_BLOCKED result, When the step ends, Then prApprovedAt stays null and PR Creation's precondition denies the call
    - [ ] Scenario: skip-tests still reviews -- Given --skip-tests, When the step list is read, Then the review step is not skipped
    - [ ] Scenario: skip-tests status is pending with a reason -- Given --skip-tests, When the final status is specified, Then it is REVIEW_PENDING with reason tests skipped

- [ ] **TRD-010** fix-issue: Remote Review Disposition, Foreman artifact, resumable pending [satisfies REQ-012, REQ-013, REQ-025] [Depends: TRD-009] (5h)
  - Validates PRD ACs: AC-012-1, AC-012-2, AC-013-1, AC-013-2, AC-013-3, AC-013-4, AC-025-1
  - Implementation AC:
    - [ ] Given the PR was created, when Remote Review Disposition runs, then it invokes `pr-review-cycle` in remote mode and only a status of exactly `REVIEW_COMPLETE` reaches Record Stage Checkpoint; every other outcome, including a missing, unparseable or unknown status, is an OTHERWISE branch that does not call `IssueRunIndexStore.complete()`: it records `pr:<url>` and sets `stageOutcome` to `{ kind: "approval_wait", detail: "REVIEW_PENDING|REVIEW_BLOCKED: <next action>" }` and returns a resumable report with the exact next action; on resume the PR URL is read from the recorded `pr:` bead reference (and a resume without one halts) instead of being re-derived from a PR Creation that did not run
    - [ ] Given a later bare invocation finds a run at `validation_delivery` whose recorded PR exists and whose outcome detail starts with `REVIEW_`, when it resumes, then it jumps to Remote Review Disposition and does not re-run Test Validation or PR Creation
    - [ ] Given `--foreman` with a non-empty `FOREMAN_ARTIFACT_PATH`, when the command ends, then the phase report with status, head SHA and ledger is written to that exact path in addition to any repo-local report, with no prompt and no indefinite wait; given the variable is unset, behavior is unchanged and no error is raised
    - [ ] Given a finding needs a human decision under `--foreman`, when status is derived, then it is `REVIEW_BLOCKED` stating the decision required and the finding is not dismissed

- [ ] **TRD-010-TEST** fix-issue remote disposition and Foreman contract [Verifies TRD-010] [Satisfies REQ-012, REQ-013, REQ-025] [Depends: TRD-010] (4h)
  - Validates PRD ACs: AC-012-1, AC-012-2, AC-013-1, AC-013-2, AC-013-3, AC-013-4, AC-025-1
  - Test AC:
    - [ ] Scenario: pending remote review is not success -- Given a created PR with no review of the head, When the checkpoint step runs, Then the run is not completed and the outcome is pending
    - [ ] Scenario: pending result is resumable -- Given a pending result, When the command ends, Then a report with the exact next action is returned
    - [ ] Scenario: foreman never prompts or waits indefinitely -- Given --foreman, When the review steps are read, Then no ask step and no unbounded wait exist
    - [ ] Scenario: artifact written to the exact path -- Given FOREMAN_ARTIFACT_PATH is set, When the command ends, Then the report with status, head SHA and ledger is at that path
    - [ ] Scenario: unresolved human decision blocks -- Given a finding needing a decision under --foreman, When status is derived, Then it is REVIEW_BLOCKED stating the decision
    - [ ] Scenario: unset artifact path changes nothing -- Given FOREMAN_ARTIFACT_PATH is unset, When the command runs, Then no error is raised and behavior is unchanged
    - [ ] Scenario: resume does not redo earlier stages -- Given a run with a recorded PR and a REVIEW_PENDING detail, When it is resumed, Then Test Validation and PR Creation are not re-run

- [ ] **TRD-011** Regenerate fix-issue outputs and prove parity [satisfies REQ-019] [Depends: TRD-010] (3h)
  - Validates PRD ACs: AC-019-1, AC-019-2, AC-019-3
  - Implementation AC:
    - [ ] Given the `fix-issue.yaml` source, when `npm run generate`, `npm run generate:pi` and `npm run generate:codex` run, then the OMP prompt and Codex `ensemble-fix-issue` outputs contain the same review gate, status meanings and anti-early-completion behavior, with no hand edits to generated files, and the Codex output references `packages/development/skills/pr-review-cycle/SKILL.md` by the same repo-root path pattern `implement-trd-beads` uses for `completion-verification`
    - [ ] Given the regeneration, when `npm run generate:validate` runs, then it passes; the generated-parity tests run only the read-only validators (`generate:validate`, `validate`) and never regenerate tracked output from inside a unit test (`generate:codex` deletes and rebuilds `.codex/`, so concurrent suites racing it deleted tracked files); regeneration idempotency stays with the CI generate check
    - [ ] Given the working tree, when the diff is inspected, then no unrelated generated artifact changed and no version was bumped outside the repository's version policy

- [ ] **TRD-011-TEST** fix-issue generated parity [Verifies TRD-011] [Satisfies REQ-019] [Depends: TRD-011] (3h)
  - Validates PRD ACs: AC-019-1, AC-019-2, AC-019-3
  - Test AC:
    - [ ] Scenario: OMP and Codex outputs agree -- Given the regenerated files, When the review gate, statuses, early-completion rules and the skill reference are extracted from each, Then they match the source and the Codex skill reference uses the repo-root path pattern
    - [ ] Scenario: generation validation passes -- Given the sources, When generate:validate runs, Then it exits zero
    - [ ] Scenario: only intended artifacts changed -- Given regeneration, When changed files are listed, Then only artifacts derived from the edited sources appear

### PR 3: implement-trd-beads and complete-beads Review Gates
**Shippable State:** A developer running `/ensemble:implement-trd-beads` gets the local review/fix/verify gate before each phase PR (stacked) or the completion PR (single), cannot close a story or epic over a blocking local finding, and sees remote review shown as pending rather than merged.

- [ ] **TRD-012** complete-beads: review status in worker result and closure gating [satisfies REQ-016] [Depends: TRD-008] (5h)
  - Validates PRD ACs: AC-016-1, AC-016-2, AC-016-3, AC-016-4, AC-016-5
  - Implementation AC:
    - [ ] Given a worker or quality-gate result, when produced, then it carries the finding ledger and local review status (`LOCAL_REVIEW_COMPLETE|LOCAL_REVIEW_BLOCKED`), and `COMPLETE_BEADS_RESULT` gains `local_review` and `remote_review` fields per PR
    - [ ] Given a story or phase roll-up, when it would close, then it closes only if the existing definition-of-done conditions pass and `LOCAL_REVIEW_COMPLETE` holds for it; in stacked mode the story's `br close` is deferred until the PR Review Gate returns `LOCAL_REVIEW_COMPLETE` (a blocked gate leaves the story open)
    - [ ] Given any PR the run owns without a recorded `LOCAL_REVIEW_COMPLETE` (a blocking finding, or no review recorded yet), when root-epic closure is attempted, then the epic is not closed (in single-PR mode the Quality Gate Review runs first); given every owned PR is `LOCAL_REVIEW_COMPLETE` and remote review is `REMOTE_REVIEW_PENDING`, the epic may close and each PR is shown as pending; in stacked mode a non-`LOCAL_REVIEW_COMPLETE` phase gate stops dispatch of later phases so the blocked phase branch is not contaminated
    - [ ] Given a recorded `local_review` that is missing, is anything other than exactly `LOCAL_REVIEW_COMPLETE`, or is bound to a head SHA different from THAT PR's own branch tip (stacked phase PRs compare with the tip of their own phase branch, never the moving integration HEAD; the single-PR completion action compares with the current HEAD), when complete-beads is invoked again (for example after the user fixed a blocking finding), then a fresh Quality Gate Review of that PR alone runs before any roll-up or closure decision, so a recorded `LOCAL_REVIEW_BLOCKED` can recover to complete, a stale approval can never close an epic, and later phases never invalidate earlier valid reviews; the single-PR `completion` action resolves its base from the default branch and an empty or unresolvable base is `LOCAL_REVIEW_BLOCKED`
    - [ ] Given independently validated work, when the remote service has not responded, then integration of that work is not blocked for that reason alone

- [ ] **TRD-012-TEST** complete-beads closure gating [Verifies TRD-012] [Satisfies REQ-016] [Depends: TRD-012] (4h)
  - Validates PRD ACs: AC-016-1, AC-016-2, AC-016-3, AC-016-4, AC-016-5
  - Test AC:
    - [ ] Scenario: result carries ledger and local status -- Given a worker result, When parsed, Then it includes the ledger and local review status
    - [ ] Scenario: roll-up needs local review complete -- Given a story whose children are closed but local review is blocked, When roll-up runs, Then the story does not close
    - [ ] Scenario: blocking finding keeps the epic open -- Given a blocking local finding on an owned PR, When epic closure is attempted, Then the epic is not closed
    - [ ] Scenario: remote pending does not block the epic -- Given all owned PRs LOCAL_REVIEW_COMPLETE with remote pending, When epic closure is attempted, Then it may close and each PR shows pending
    - [ ] Scenario: integration is not held for the remote service -- Given validated work and no remote review yet, When integration runs, Then it proceeds

- [ ] **TRD-013** implement-trd-beads: gates at stacked-phase and single-PR boundaries [satisfies REQ-015] [Depends: TRD-012] (5h)
  - Validates PRD ACs: AC-015-1, AC-015-2, AC-015-3, AC-002-3
  - Implementation AC:
    - [ ] Given stacked mode, when a phase reaches Quality Gate "Gate Result Recording", then `pr-review-cycle` runs on that phase's exact branch and `parentBranch` before `git town propose`/`append` (or the `gh`/`ado`/manual equivalents), reviewing only that phase's diff, and the phase's story bead is closed only after the gate passes
    - [ ] Given single-PR mode, when Completion Verification returns, then the PR Review Completion Check runs `pr-review-cycle` once over the whole TRD branch diff BEFORE Epic Closure; a blocked review HALTs there (epic stays open, no completion PR is created), and the completion PR is created later in Completion Report on an already-reviewed head and reported `REVIEW_PENDING`
    - [ ] Given the change, when a TRD is implemented, then `pr-plan` topology, per-task reviewer/QA lifecycle, phase quality gates and the final full-suite and requirement verification are unchanged

- [ ] **TRD-013-TEST** implement-trd-beads boundary gates [Verifies TRD-013] [Satisfies REQ-015] [Depends: TRD-013] (4h)
  - Validates PRD ACs: AC-015-1, AC-015-2, AC-015-3, AC-002-3
  - Test AC:
    - [ ] Scenario: stacked gate precedes propose and append -- Given the parsed Quality Gate steps, When ordered, Then the review gate precedes propose and append
    - [ ] Scenario: single-PR gate precedes the completion PR -- Given the parsed Completion steps, When ordered, Then the review runs once before the completion PR
    - [ ] Scenario: existing safeguards intact -- Given the updated YAML, When pr-plan use, reviewer lifecycle, quality gates and completion-verification are compared, Then they are unchanged
    - [ ] Scenario: a phase review excludes later phases -- Given phase 2's scope, When resolved, Then later phases and base commits are excluded

- [ ] **TRD-014** implement-trd-beads: PR-review completion check, messaging, manual/ADO backends [satisfies REQ-017, REQ-018] [Depends: TRD-013] (4h)
  - Validates PRD ACs: AC-017-1, AC-017-2, AC-018-1, AC-018-2
  - Implementation AC:
    - [ ] Given Completion, when `completion-verification` returns, then a separate PR-review check runs before Epic Closure and completion messaging; its only HALT is the single-PR local gate, its remote evaluation never blocks Epic Closure, and `completion-verification` remains authoritative for task inventory, requirements and tests
    - [ ] Given a PR the command owns has pending remote review, when completion is reported, then it is shown as pending and resumable and never described as merged or landed
    - [ ] Given `PR_BACKEND` is `manual` or the `ado` MCP tool is absent, when a PR boundary is reached, then the manual PR and review steps are printed and the status is reported pending, and no review evidence is claimed as gathered

- [ ] **TRD-014-TEST** completion check and backends [Verifies TRD-014] [Satisfies REQ-017, REQ-018] [Depends: TRD-014] (3h)
  - Validates PRD ACs: AC-017-1, AC-017-2, AC-018-1, AC-018-2
  - Test AC:
    - [ ] Scenario: pending remote review is never called merged -- Given an owned PR with pending remote review, When completion is reported, Then it is labeled pending and not merged or landed
    - [ ] Scenario: completion-verification stays authoritative -- Given the Completion steps, When ordered, Then completion-verification runs first and the PR-review check is a separate step before Epic Closure
    - [ ] Scenario: manual backend prints steps and reports pending -- Given PR_BACKEND is manual, When a boundary is reached, Then manual steps are printed and status is pending
    - [ ] Scenario: no evidence is claimed when none was gathered -- Given no review evidence, When the result is reported, Then it does not claim evidence was gathered

- [ ] **TRD-015** Regenerate implement-trd-beads and complete-beads outputs and prove parity [satisfies REQ-019] [Depends: TRD-014] (3h)
  - Validates PRD ACs: AC-019-1, AC-019-2, AC-019-3
  - Implementation AC:
    - [ ] Given the sources, when the generators run, then OMP, Claude and Codex outputs for `implement-trd-beads` and the `complete-beads` skill copies carry the same gates, status meanings and anti-early-completion behavior, with no hand edits, and the Codex output references `packages/development/skills/pr-review-cycle/SKILL.md` by the repo-root path pattern
    - [ ] Given the regeneration, when `npm run generate:validate` and `npm run validate` run, then both pass
    - [ ] Given the working tree, when the diff is inspected, then no unrelated generated artifact changed and no version bump occurred outside the version policy

- [ ] **TRD-015-TEST** implement-trd-beads generated parity [Verifies TRD-015] [Satisfies REQ-019] [Depends: TRD-015] (3h)
  - Validates PRD ACs: AC-019-1, AC-019-2, AC-019-3
  - Test AC:
    - [ ] Scenario: runtimes agree on gates and statuses -- Given regenerated outputs, When extracted, Then OMP, Claude and Codex carry the same review gates and statuses and Codex references the skill by repo-root path
    - [ ] Scenario: validation passes -- Given regeneration, When generate:validate and validate run, Then both exit zero
    - [ ] Scenario: only intended artifacts changed -- Given regeneration, When changed files are listed, Then only artifacts derived from the edited sources appear

### PR 4: Measurement Plan, Guard Proof and Final Audit
**Shippable State:** A maintainer has a documented pilot plan that defines comparable cohorts and metrics and refuses to claim the 50% target before post-change data exists, and the gating checks are proven able to fail.

- [ ] **TRD-016** Pilot measurement plan document [satisfies REQ-020] [Depends: TRD-010, TRD-012] (3h)
  - Validates PRD ACs: AC-020-1, AC-020-2
  - Implementation AC:
    - [ ] Given the plan at `docs/guides/pr-review-cycle-time-pilot.md`, when read, then it defines the baseline and post-change cohorts as PRs created by `fix-issue` or `implement-trd-beads`, each at least 20 PRs and at least 30 days (whichever is reached later)
    - [ ] Given the plan, when read, then it defines median and p75 open-to-merge time, first-review latency, review/fix rounds and review wait time as separate metrics and gives the read-only `gh` queries that produce them
    - [ ] Given post-change data does not yet exist, when results are described, then the plan states the 50% median reduction is not met and that causality is not inferred from historical durations

- [ ] **TRD-017** Guard mutation harness (gating checks can fail) [satisfies REQ-022] [Depends: TRD-009, TRD-012] (5h)
  - Validates PRD ACs: AC-022-1, AC-022-2
  - Implementation AC:
    - [ ] Given a Jest test `pr-review-cycle-mutation.test.js`, when it runs, then for each guard (head-binding, no early `REVIEW_COMPLETE`, round cap, review-before-publication ordering in `fix-issue`, closure gating in `complete-beads`) it applies a mutation to a temporary copy and asserts the matching contract test fails against the mutant
    - [ ] Given the suite, when reviewed, then no test only asserts the presence of prose tokens; each asserts ordering or a terminal condition

- [ ] **TRD-018** Final audit, documentation and verification [satisfies ARCH, REQ-021] [Depends: TRD-016, TRD-017] (4h)
  - Validates PRD ACs: AC-021-1, AC-021-2
  - Implementation AC:
    - [ ] Given the complete change, when `git diff --name-only` is inspected, then no Foreman file and none of `.beads/issues.jsonl`, `packages/agent-core/src/behavior/event-disposition.ts`, `packages/agent-core/tests/file-source-adapter.test.ts` appear
    - [ ] Given the complete change, when it is inspected, then no HerdR change, merge automation, new review provider, dashboard, new dependency or new configuration knob has been added
    - [ ] Given the documentation, when updated, then the `packages/development` CHANGELOG and README describe the skill and both integrations, and `npm run validate`, `npm run generate:validate` and `npm test` all pass

## Sprint Planning

### Sprint 1: Shared procedure (PR 1)
Tasks TRD-001 through TRD-008 and their tests. Informational grouping only.

### Sprint 2: Command integrations (PR 2, PR 3)
Tasks TRD-009 through TRD-015 and their tests.

### Sprint 3: Measurement and proof (PR 4)
Tasks TRD-016 through TRD-018.

## Dependency Mapping and PR Boundary Design

- **Parallelizable inside PR 1:** TRD-001, -002, -003, -004, -005 touch separate modules and have no mutual dependency; TRD-006 joins them; TRD-007 and TRD-008 follow TRD-006.
- **Critical path:** TRD-001..005 -> TRD-006 -> TRD-008 -> TRD-009 -> TRD-010 -> TRD-011 (PR 2); TRD-008 -> TRD-012 -> TRD-013 -> TRD-014 -> TRD-015 (PR 3); TRD-010/012 -> TRD-016; TRD-009 + TRD-012 -> TRD-017; TRD-016 + TRD-017 -> TRD-018.
- **PR boundary shippability:** PR 1 delivers a callable skill and CLI (nothing half-wired; no command route is changed). PR 2 changes only `fix-issue` and leaves `implement-trd-beads` untouched. PR 3 changes only `implement-trd-beads`/`complete-beads`. PR 4 adds documentation and tests only. Each leaves all existing tests passing.
- **No cycles:** the graph is acyclic (every task depends only on lower-numbered tasks).

## Acceptance Criteria Traceability

| REQ | Description | Implementation Tasks | Test Tasks |
|---|---|---|---|
| REQ-001 | One shared review procedure | TRD-006, TRD-007, TRD-008 | TRD-006-TEST, TRD-007-TEST, TRD-008-TEST |
| REQ-002 | Base-correct review scope | TRD-001 | TRD-001-TEST, TRD-013-TEST |
| REQ-003 | Independent local review before publication | TRD-008 | TRD-008-TEST |
| REQ-004 | Finding ledger | TRD-002 | TRD-002-TEST |
| REQ-005 | Batch remediation composing the existing skill | TRD-008 | TRD-008-TEST |
| REQ-006 | Verify the batch once | TRD-008 | TRD-008-TEST |
| REQ-007 | Remote review bound to the current head | TRD-003, TRD-008 | TRD-003-TEST, TRD-008-TEST |
| REQ-008 | Bounded rounds without false completion | TRD-004, TRD-008 | TRD-004-TEST, TRD-008-TEST |
| REQ-009 | Completion contract | TRD-002, TRD-004, TRD-006 | TRD-002-TEST, TRD-004-TEST, TRD-006-TEST |
| REQ-010 | Explicit overrides never relabel | TRD-004 | TRD-004-TEST |
| REQ-011 | fix-issue local review gate | TRD-009 | TRD-009-TEST |
| REQ-012 | fix-issue remote disposition, no early success | TRD-010 | TRD-010-TEST |
| REQ-013 | Foreman mode non-interactive and truthful | TRD-010 | TRD-010-TEST |
| REQ-014 | Truthful --skip-tests | TRD-004, TRD-009 | TRD-004-TEST, TRD-009-TEST |
| REQ-015 | Gate at every real PR boundary | TRD-013 | TRD-013-TEST |
| REQ-016 | Blocking findings cannot hide behind closed beads | TRD-012 | TRD-012-TEST |
| REQ-017 | Truthful completion messaging | TRD-014 | TRD-014-TEST |
| REQ-018 | Manual and no-ADO backends stay truthful | TRD-014 | TRD-014-TEST |
| REQ-019 | Generated artifacts match sources | TRD-007, TRD-011, TRD-015 | TRD-007-TEST, TRD-011-TEST, TRD-015-TEST |
| REQ-020 | Cycle-time measurement plan | TRD-016 | (reviewed document; see Adversarial Review) |
| REQ-021 | Preserve boundaries and unrelated work | TRD-018 | (audit task; see Adversarial Review) |
| REQ-022 | Gating checks can fail | TRD-017 | (the harness is itself the test) |
| REQ-023 | Review criteria remain user-editable | TRD-008 | TRD-008-TEST |
| REQ-024 | Review input untrusted, secrets out | TRD-005, TRD-008 | TRD-005-TEST, TRD-008-TEST |
| REQ-025 | Resume from preserved pending state | TRD-005, TRD-006, TRD-008, TRD-010 | TRD-005-TEST, TRD-006-TEST, TRD-010-TEST |

## Traceability Validation

Traceability check: 25 requirements covered, 0 uncovered, 0 orphaned annotations. (REQ-020, REQ-021 and REQ-022 are covered by implementation tasks whose verification is a document review, a diff audit and the mutation harness respectively.)

## Adversarial Review and Design Gate

### Architecture issues and resolutions

1. **A committed state report would invalidate its own review.** A report stored in the tracked tree changes the head SHA once committed. *Resolved:* the report lives under `.ensemble/pr-review/`, is gitignored and is refused outside that path (TRD-005, TRD-007).
2. **No interface between the LLM-driven skill and the grading code.** Without a contract the two drift. *Resolved:* a JSON-in/JSON-out CLI contract with fail-closed semantics (unknown input -> `REVIEW_BLOCKED`), and a CLI-vs-library equivalence test (TRD-006).
3. **Closure ownership spans two layers** (`implement-trd-beads` and `complete-beads`). *Resolved:* the status lives in the worker/quality-gate result and `COMPLETE_BEADS_RESULT` (TRD-012); the command only consumes it (TRD-013, TRD-014).
4. **New CLI absent in OMP installs.** The Pi vendor bundle seeds from an explicit list. *Resolved:* TRD-007 adds the entry point and relies on require-closure vendoring for the siblings.
5. **`prApprovedAt` was recorded before the new review step.** `fix-issue` sets it at the end of Test Validation, so a blocked local review would not have been denied by the store precondition (AC-011-4). *Resolved:* the mutate moves into the Local Review and Batch Fix step and runs only on `LOCAL_REVIEW_COMPLETE`; existing tests are updated in the same PR (TRD-009).
6. **Cross-package dependency.** `pr-review-remediation` ships in ensemble-quality, so an install with only ensemble-development lacks it. *Resolved:* `pr-review-cycle` halts as `REVIEW_BLOCKED` naming the missing capability rather than skipping remediation or duplicating its rules (TRD-008).

### Task coverage issues

1. REQs with fewer than 3 PRD ACs (REQ-010, REQ-012, REQ-014, REQ-017, REQ-018, REQ-020, REQ-021, REQ-022, REQ-023, REQ-024) are flagged as insufficient BDD scenario depth at the PRD level; their test tasks reach the minimum scenario count by grouping related REQs' ACs.
2. REQ-020 (document), REQ-021 (diff audit) and REQ-022 (the harness itself) have no separate `-TEST` task. *Resolved:* each has measurable Implementation ACs and a named verification (TRD-016, TRD-018, TRD-017).
3. No task estimates 8h or more.
4. Every `### PR N:` section has a user-observable **Shippable State:** statement.
5. Scratch-copy parse check with `trd-cli.js parse` found all tasks (see Design Readiness Scorecard).

### Dependency and estimate issues

1. The longest chain exceeded depth 3 and still does, by construction. *Mitigated, not eliminated:* TRD-017 now depends on TRD-009 and TRD-012 (the guards it mutates) instead of TRD-015, which removed it from the PR 3 tail. Measured with `trd-cli.js parse`, the longest remaining chain is 8 nodes (TRD-001 -> 006 -> 008 -> 012 -> 013 -> 014 -> 015 -> 015-TEST), inherent to a shared lead-in (PR 1) followed by ordered edits to one generated file family. PR 2 and PR 3 both depend only on TRD-008 and can proceed in parallel, and TRD-018 is the only task after TRD-016/017.
2. Estimates are consistent across similar tasks (CLI/module tasks 3-6h; YAML integration tasks 4-5h; regeneration 3h). The highest-risk estimate is TRD-008 (6h) because skill prose is the least mechanically checkable.

### Testability

All Implementation ACs name an observable pass/fail condition. The 10-minute wait is verified by location (skill text) rather than elapsed time.

### Design Readiness Scorecard

| Dimension | Score (1-5) | Notes |
|---|---|---|
| Architecture completeness | 4.75 | Components, interfaces, data flow, packaging and the approval-ordering gap are defined |
| Task coverage | 4.25 | All 25 REQs mapped; Codex/bundler test gaps closed; 3 REQs verified without a separate test task |
| Dependency clarity | 4.5 | Explicit and acyclic; chain shortened |
| Estimate confidence | 4.0 | Skill-prose and generator-parity tasks carry the most uncertainty |
| **Overall** | **4.38 (PASS)** | |

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| CodeRabbit posts reviews without a commit identity, so a head can never be verified | Medium | High | SHA-less summaries yield `REVIEW_PENDING`, never complete (AC-007-4); surfaced to the pilot as a metric gap |
| Existing `fix-issue` tests assert step orders that move | High | Medium | TRD-009 updates them in the same PR; ordering is asserted structurally |
| Pi vendor bundle or `packages/full` mirror misses the new files | Medium | High | TRD-007 tests both; `npm run validate` gates |
| Skill prose drifts from the helper contract | Medium | Medium | Skill calls the CLI for every grade; TRD-017 mutation harness |
| Interactive waits annoy users | Low | Low | 10-minute bound, editable in the skill text |
| `prApprovedAt` ordering regresses the store-persisted approval precondition | Medium | High | Moved into the review step with updated tests (TRD-009); mutation harness covers review-before-publication (TRD-017) |
| An install without ensemble-quality lacks `pr-review-remediation` | Medium | Medium | `REVIEW_BLOCKED` naming the missing capability (TRD-008) |

## Constitution Gate

Constitution Gate: running

Canonical source: `docs/standards/constitution.md` (`.specify/memory/constitution.md` absent). Checks map to Non-Negotiable Rules 1-8:

- Rule 1 (no secrets): TRD-005 redacts secrets and the CLI takes no credentials. Pass.
- Rule 2 (input validation): CLI validates JSON at the boundary and fails closed (TRD-001, TRD-004, TRD-006). Pass.
- Rule 3 (tests accompany features): every implementation task has a `-TEST` task except the three named exceptions above, each with a stated verification. Pass.
- Rule 4 (ownership boundary): no scheduling, retries or recovery; resume is operator-invoked; Foreman files untouched (TRD-008, TRD-018). Pass.
- Rule 5 (governed tool boundary): no tool grants changed. Pass.
- Rule 6 (reachable from entry point): TRD-009 and TRD-013 call the skill from the real commands; TRD-007 proves reachability in an OMP install. Pass.
- Rule 7 (a verification must be able to fail): TRD-017 mutation harness. Pass.
- Rule 8 (editable behavior in prompts, enforcement in code): criteria, loop order and wait live in `SKILL.md`; only claim-grading and enforcement live in code. Pass.

Constitution Gate: PASSED

Constitution compliance: passed

## Changelog

| Date | Version | Changes |
|------|---------|---------|
| 2026-10-14 | 1.0.0 | Initial TRD from PRD-2026-82b6a138 v1.0.1. |
| 2026-10-14 | 1.0.1 | Refinement: moved `prApprovedAt` into the Local Review step with test updates (TRD-009); added the missing-remediation-skill `REVIEW_BLOCKED` halt (TRD-008); added Codex repo-path skill reference and the `lib-bundler.test.ts` entry-point update (TRD-007/011/015); rewired TRD-017 to depend on TRD-009 and TRD-012; added a bounded-latency AC to the CLI (TRD-006); readiness 4.25 -> 4.38. |
| 2026-10-14 | 1.0.2 | Implementation notes: supervisor review of the built command found and fixed two ordering holes (stacked story closed before its review gate could block; single-PR whole-branch review ran after Epic Closure and the check mislabelled the not-yet-created PR), reflected in TRD-012/013/014; the generated-parity tests no longer regenerate tracked output (concurrent `generate:codex` runs deleted 37 tracked `.codex` files), reflected in TRD-011; PR 1 also regenerated the Pi skill/vendor bundle (`generate:pi` from the repo root) so the CI generate check passes on every PR in the stack; OMP/Codex renderers omit step `instructions:` bodies (fix-issue), so key rules are mirrored into step descriptions. |
| 2026-10-14 | 1.0.3 | Added a body `Based on PRD:` path reference: `trd-cli` parses only a path-shaped PRD reference (a `docs/PRD/*.md` path in the body, or a path-like `prd_reference`), so the ID-only frontmatter left `prdReference` null and made `completion-verification` silently skip its REQ coverage check. |
| 2026-10-14 | 1.0.4 | Local-review remediation (20 findings: 3 Critical, 10 Major, 7 Minor, from four independent per-phase reviews of the stack). Root cause was one fail-open pattern at three layers: the status grader defaulted missing facts to "fine", `LOCAL_REVIEW_BLOCKED` was documented and branched on but never emitted, and callers (fix-issue, complete-beads) tested for the one bad value instead of requiring the one good value. Contract now fail-closed and stated in TRD-006, TRD-009 and TRD-012; also bare-ref scope inputs rejected, remote review state respected (per-author effective reviewer state), dedupe/merge never drop a more severe finding, atomic state writes, snapshot head includes untracked files, stacked blocked phase stops dispatch. A vocabulary drift test now ties every review token in commands and skills to the status module. |
| 2026-10-14 | 1.0.5 | Second (final) automatic remediation pass from the round-2 re-review of the remediated heads (14 findings: 1 Critical, 5 Major, 8 Minor), reflected in TRD-003, TRD-010 and the TRD-012 closure rules. Round 1 had patched the case each reviewer named and left siblings open, so this pass specified completeness by construction: the remote evaluator now has a defined verdict for every item kind and state; `status` re-validates SHAs and counts itself; ledger and CLI inputs fail closed on missing or mistyped keys; the fix-issue remote step has an OTHERWISE halt so a missing status can never reach `complete()`; complete-beads re-runs the Quality Gate Review whenever the recorded review is missing, not COMPLETE, or bound to a different HEAD; single-PR completion resolves its base from the default branch. The mutation harness copies the scope module, uses a private jest cache, and no longer leaks cache entries. |
| 2026-10-14 | 1.0.6 | User-authorized manual fix pass for the 5 findings of the final re-review (3 Major, 2 Minor): tree-aware freshness so `REVIEW_COMPLETE` is reachable when the pushed commit differs from the review snapshot (TRD-006, TRD-009 wiring); per-PR branch-tip head binding in complete-beads so stacked phases do not re-stale each other (TRD-012); the fix-issue resume gate and `pr:` bead-reference recording mirrored into rendered step descriptions because the generators omit `instructions` (TRD-010, with parity assertions on the generated outputs); an empty-PR-URL halt that records a resumable `approval_wait` and writes the Foreman artifact; fork-point-first review scope. |
