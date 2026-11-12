#!/usr/bin/env node
'use strict';

/**
 * pr-review-cli.js -- JSON-in/JSON-out CLI over the pure pr-review-*.js
 * helper modules (TRD-2026-82b6a138-pr-review-cycle-time, TRD-006;
 * TRD-2026-70e784f2-code-review-process, TRD-005).
 *
 * A thin dispatcher: every subcommand reads one JSON payload from stdin,
 * delegates directly to the matching module function, and prints that
 * function's return value verbatim as JSON on stdout -- so the CLI and a
 * direct `require(...)` call on the same input can never diverge. NO
 * business logic lives here, NO network calls, NO shell calls.
 *
 * Usage: node pr-review-cli.js <scope|review-range|ledger|remote|status|state-read|state-write|policy|rules|paths|description|votes|verify-assign|depth|slices|tier|mode|carry|approvals|gate|explainer-offer|brief|metrics|metrics-compare|eval-score|eval-compare|eval-stale|reachability|results|timing|walltime> < payload.json
 *
 * `review-range` (TRD-013) is a thin pass-through to `chooseReviewRange`:
 * given `lastReviewedSha`, `commits` and `remediationShas` on top of what
 * `scope` takes, it answers whether the next review is a `delta` against the
 * previously reviewed head or must fall back to the `full` base-correct
 * range -- the skill calls this for every round after the first (AC-010-1).
 *
 * `ledger` exposes seven independent library functions; the payload selects
 * one via `action` (validate|isActionable|dedupe|merge|scopeViolations|recordRound|resolve) and
 * carries that action's keys:
 *   validate         { findings }
 *   isActionable     { finding }
 *   dedupe           { findings } -- one entry per defect: identical findings, and findings different
 *                    reviewers probably wrote up twice (same file, nearby lines, matching description),
 *                    keep every original link; an entry joined that way lists its `mergedFrom`
 *   merge            { existingLedger, incomingFindings, headSha }
 *   scopeViolations  { changedFiles, scope, ledger }
 *   recordRound      { ledger, incoming, round } -- suppresses repeats, attaches
 *                    class instances to their one class finding and reports
 *                    both (AC-010-2, AC-011-1, AC-011-2)
 *   resolve          { finding, resolution:{ reason, by, headSha, at }, policy? } -- records a decision on a
 *                    finding (`recordOperatorResolution`): all four resolution keys are required, `by` is a login,
 *                    `headSha` the head the decision was made against, `at` an ISO-8601 timestamp with a zone. Given
 *                    `policy` (the base-branch policy block) `by` must also be a login it lets decide: not one of its
 *                    `botLogins`, and one of its `maintainerLogins` when it names any. Answers `{ finding }` on
 *                    success; a refusal is an error (exit 1). The merge gate only honours an Important or security
 *                    resolution that passes the same check and whose `headSha` is the gate's head. HONEST LIMIT: that
 *                    proves a reason, a named login (a bot or a stranger is refused only when a policy says so) and a
 *                    head binding, never that a human typed it -- the skill must put the operator's own answer here,
 *                    never an agent's.
 * `state-read` takes { headSha } plus an optional { treeSha } (the tree of that
 * head) and `state-write` { state } (whose `reviewedTreeSha`, when present, must
 * be a full object id), each with either an explicit `targetPath` or a `prId`
 * (resolved via `statePath`) plus an optional `cwd`. The tier decision this
 * CLI's `tier` subcommand answers is stored by `state-write` under the
 * report's `tier` key (data model: `{ tier, effectiveTier, reasons[],
 * raised[], assignedBy }` and the rest of the record), and `state-read`
 * returns it verbatim for the same head (AC-015-1, AC-015-2). `state-write`
 * writes the state object it is handed as-is: the report is a report, so
 * nothing here re-grades, trims or defaults a recorded decision.
 *
 * `status` grades the accumulated review facts IN BAND (a missing or invalid fact is a BLOCKED result, never a default):
 *   status     { baseSha, headSha, reviewedHeadSha, findingCounts{ total, actionable, deferred }, coverage, tests?, remotePhase?,
 *                reviewedTreeSha?, headTreeSha?, roundsUsed?, roundCap?, access?, prUrl?, reportPath?, reviewOnly?, policy? }
 *              `coverage` (kata k48x) is the review's coverage record (lib/pr-review-coverage.js: the `coverage` the `slices`
 *              answer carries when it is given `reviewedBy`, or the one `carry` `coverage` answers for a delta round) and is a
 *              REQUIRED fact: absent, unreadable or `unavailable` is a missing fact (LOCAL_REVIEW_BLOCKED, named), and an open
 *              gap (a slice, the whole-range read or a path nobody read, with no operator decision bound to this head) is
 *              LOCAL_REVIEW_PENDING (`next: complete-review-coverage`): a review that left a path unread is never
 *              LOCAL_REVIEW_COMPLETE. The record is echoed as `coverage`, so the state report written from this result carries it.
 *              `policy` (optional) is the base-branch policy block: a gap's decision counts only from a login it lets decide.
 *              `tests` is ONE of two facts, and `passed` is never supplied -- it is derived:
 *                { exitCode, skipped?, command? }     a LOCAL run the caller really made (`skipped: true` needs no exit code)
 *                { source: 'ci', checkRuns[{ id?, name?, commitSha, conclusion }], totalCount, command? }
 *                                                     the host's CI for `headSha`, derived from the check runs
 *                                                     (lib/pr-review-ci-tests.js) -- a review-only run's tests, nobody else's
 *              Only a check run bound to `headSha` (its `commitSha`, exactly) that concluded `success` counts. A run for
 *              another commit is ignored; a failed, unfinished or unreadable one, an empty or unreadable list, or a list
 *              shorter than the host's own `totalCount` is NOT a pass: the tests stay unshown (PENDING, `next: run-tests`)
 *              and the next call carries a real local `exitCode` instead. A `tests` that claims `source: 'ci'` with an
 *              `exitCode`, with `skipped: true`, with a `passed` the runs do not show, or on a run that is not review-only
 *              is a typed pass, not a CI result: an invalid fact (BLOCKED).
 *              `reviewOnly: true` (default false; null counts as absent, any non-boolean blocks) marks a review of someone
 *              else's PR that ran no fix and no re-review: the status is REVIEW_PENDING with a reason that says so, the
 *              local phase is never LOCAL_REVIEW_COMPLETE, and `next` is `report-to-author` once the tests are shown.
 *              Nothing a caller adds can make a review-only run REVIEW_COMPLETE. The result echoes `reviewOnly`.
 *
 * The guidance subcommands (TRD-005) each take the facts their module grades,
 * all read FROM THE BASE COMMIT by the caller, never from the PR head:
 *   policy       { text?, baseSha, sourceSha? }  -- root REVIEW.md text
 *   rules        { changedPaths, ruleFiles, rulesFileName?, baseSha?, sourceSha? }
 *   paths        { changedPaths, declaration?, codeowners?, baseSha }
 *   description  { body, agentAuthored? } (or the PR body as a bare JSON string)
 *                -- an omitted `agentAuthored` is read as agent-authored; only an explicit `false` says a person wrote it
 *
 * `explainer-offer` (TRD-043) decides what a review report OFFERS, never what
 * it writes: given the effective tier and the `paths` classification, it names
 * one explainer per touched sensitive module on a High-tier PR, and `generate`
 * stays empty until `requested` names one of them:
 *   explainer-offer  { tier, paths, requested? }
 *
 * `brief` renders one agent's brief from its template file
 * (`skills/pr-review-cycle/templates/<role>-brief.md`, found by
 * `pr-review-brief-files.js`); it refuses -- exit 1, an `error` -- an unknown
 * role, a missing or undeclared input and, for a verifier, anything but the
 * claim, its cited `file:line`, the path list and the snapshot directory:
 *   brief            { role: reviewer|range-reviewer|verifier|classifier|second-assessor|security-lane,
 *                      vars: { ...the inputs that role declares } }
 *                    -> { ok: true, role, brief }
 *
 * The metrics and eval subcommands (TRD-032) take the records a maintainer
 * fetched with `gh` (see docs/guides/pr-review-metrics.md) and answer with
 * their module's result verbatim:
 *   metrics          { prs[{ number, title, author, createdAt, mergedAt, reviews, comments, commits, tier? }],
 *                      findingResponses?, incidents?, revertCommitsOnDefaultBranch?, botLogins? }
 *   metrics-compare  { baseline, current } -- each a `metrics` payload, a
 *                    `metrics` result or a committed baseline file; answers
 *                    the per-target comparison and the revert/incident
 *                    guardrail (AC-019-3, AC-019-4)
 *   eval-score       { cases[], findingsByCase{}, codeowners?, evalCasesDir? } -- with
 *                    `codeowners` (the base commit's CODEOWNERS text) a case no owner
 *                    confirmed scores `case-unconfirmed`; without it the check is off
 *   eval-compare     { previous, current } -- each an `eval-score` result
 *   eval-stale       { cases[], rulesHashes{} }
 *
 * The verification subcommands (TRD-018) each take the facts their module
 * grades and answer with that module's result verbatim:
 *   votes   { findings[{ id, severity?, kind?, security?, reviewer?, votes[{ verifier, verdict }],
 *             incompleteVerifiers? }], depth, expectedVerifiers?, verificationCapability?,
 *             assignment?[{ id, verifiers[] }] }
 *           -- with `assignment` (the `verify-assign` plan) every finding must be assigned exactly
 *           K distinct verifiers; an assigned verifier with no vote makes the finding `unverified`
 *   verify-assign { candidates[{ id, reviewer? }], depth, verifierPool[] | verifierCount, expectedVerifiers?,
 *             maxCandidatesPerVerifier? }
 *           -- plans which K distinct verifiers settle each candidate (never its own reviewer) and
 *           which candidates each verifier agent is briefed on; a pool smaller than K is an error
 *   depth   { tier, effectiveTier?, requested?, lowWaiverEnabled?, planned?, used?, bounds? }
 *           -- resolves the mode AND, when planned or used counts are given,
 *           grades them against that mode's bounds in the same answer
 *   slices  { paths[{ path, lines }], areas?, threshold?, targetLines?, maxSlices?, mode?, lenses?, lensesPerSlice?,
 *             reviewedBy?[{ sliceId, lens, reviewer, paths }], changedPaths? }
 *           -- plans the areas (cut by size when `targetLines` is given) and the reviewer assignments
 *           (`reviewerAssignments[{ reviewer, sliceId, lens }]`: every slice crossed with at least two distinct
 *           lenses at Standard and Deep; at Quick ONE slice, however large the PR, and one reviewer); when
 *           `reviewedBy` is given, names every changed path that was not read under enough distinct lenses
 *           (`uncovered` when nobody read it, `underReviewed` when too few lenses did, or when no reviewer's `paths`
 *           names it: a lens counts for the paths it read, never for the rest of its slice) and answers `coverage`, the
 *           coverage record (lib/pr-review-coverage.js) `status` and `gate` take as it is (kata k48x): `complete`, or
 *           `incomplete` with one gap per unread slice, per unplanned path and per under-read path, or `unavailable` (always so
 *           when `changedPaths` is not given: a plan cannot be held against files it was never cut from).
 *
 * `results` (kata et2k) is the file-based half of the verification subcommands:
 * agents write `out-<name>.json` and this reads them, instead of the orchestrator
 * parsing what an agent yielded. One payload selects one function via `action`:
 *   deadlines        { role, tier?, depth?, now?, policy? } -- the `dispatchedAt` (= `now`, default: the current time)
 *                    and the `deadlineAt` an agent must be stopped by: reviewer 15 min, verifier 5, security lane 15 (bases),
 *                    per-role overridable by the policy's `deadlineMinutes`, and never below a measured floor: a verifier 8 min
 *                    (kata dx53), a reviewer or the lane 22 min when `work` is given (kata d9sy)
 *   collect          { expected[{ name, role, dispatchedAt, deadlineAt, sliceId?, lens?, paths?, candidateIds?, read?, reread? }], dir,
 *                    now?, scratchDir?, depth?, expectedVerifiers?, candidates? } -- classifies each agent
 *                    arrived|missing|expired|invalid from `<dir>/out-<name>.json`. It arrived when the file's last
 *                    change (its inode change time, never the modification time a writer can set) is within
 *                    [dispatchedAt, deadlineAt]; an older file is stale, a later one expired. A reviewer given a
 *                    `sliceId` must give its `paths` and its `lens`. Each arrival is copied to scratch (default: the hidden sibling
 *                    `.<dir name>.collected` beside `dir`, never inside it), and the answer holds `reviewedBy` (the
 *                    `reviewedBy` of `slices`: one `{ sliceId, lens, reviewer, paths }` per reviewer that arrived and
 *                    covered its slice, `paths` being the paths it was asked to read and reported), `reviewedSlices`
 *                    and, when `depth` is given, `votesInput` (the payload of `votes`). An
 *                    agent that did not arrive is never reviewed: its slice is unreviewed, its candidates unverified
 *   failure          { status?, retryAfterSec?, message?, attempt?, failFastAfterSec?, waitedSec?, deadlineAt?, now? }
 *                    -- retry, back off, fall back to the alternate model route, or fail fast to a recorded `partial`
 *                    state; `waitedSec` (the wait already spent on this agent) counts toward `failFastAfterSec`, and
 *                    given the agent's `deadlineAt` (and `now`, default: the current time) a wait that would end at or
 *                    after the deadline fails fast
 *              HONEST LIMIT: this computes deadlines and classifies; it does not stop an agent. Killing one at its
 *              `deadlineAt` is the dispatcher's job, and nothing here may be read as enforcement. No skill or command
 *              calls `results` yet.
 *
 * `timing` (kata gkt9) reads a run trace (lib/run-trace.js, recorded with `toolchain-cli trace`) and answers the review's
 * timing from it, never from omp session files: the orchestrator window, orchestrator-only time (wall minus the union
 * of the intervals in which a dispatched agent was active), the critical path (slowest reviewer -> slowest verifier ->
 * verdict, per round) and a per-stage table. The stage span names and the rule that an agent ends at its last `message`,
 * never at `session_exit`, are in lib/pr-review-timing.js. A figure that was not recorded is
 * `{ ms: null, missing: true, reason }`, never zero. Store the answer under the state report's `timing` key.
 *   timing     { runId, cwd? } | { spans }
 *              -- `runId` reads `<cwd or the current directory>/.ensemble/state/toolchain/trace-<runId>.jsonl`;
 *              `spans` takes materialized run-trace spans directly. Exactly one of the two is required.
 *              The answer ends with `hostLoad` and `agentStats` (kata nj2d): the host's 1-minute load average from `lib/pr-review-load.js`
 *              samples next to the trace, and, per agent and by role, the tool calls, turns, effort, model, retries and 429s the dispatcher
 *              supplied at `review-run collect` (`agentStats`). A figure nobody supplied is `null` with a reason in `without`, never 0.
 *
 * `walltime` (kata vrda) answers review WALL TIME by tier from cohort documents (the committed
 * docs/guides/review-walltime-baseline-<date>.json is one) and compares a post-change cohort with that baseline:
 * median and p75 per tier and round, gate runs and review chains per PR, and whether the 5x claim may be made. The
 * schema, the minimum of three PRs per stratum, the 20% target and the carry rule are in lib/pr-review-walltime.js and
 * docs/guides/pr-review-walltime.md. One `action` per call; a payload key the action does not know is an error (exit 1),
 * never an ignored one. Everything else is graded in band (exit 0): a cohort it cannot read, a tier with too few PRs
 * (`unknown`) and a 5x claim without a real re-review that carried verdicts are refusing RESULTS, never a clean pass.
 *   walltime   { action: 'summarize', cohort } -- the statistics of one cohort document
 *              { action: 'row', pr, tier, round, origin, runId, cwd? | timing, id?, source?, notes?, carry? }
 *              -- one cohort row from a `timing` answer: `runId` reads the trace as `timing` does, `timing` takes a
 *              `timing` answer directly (exactly one of the two); `carry` is `{ headSha, verdicts }` from the PR's state report
 *              { action: 'compare', baseline, current, cwd?, targetFactors? } -- two cohort documents. Each counted current row's wall time,
 *              chains and gate runs are re-derived from the trace its `run_id` names (<cwd>/.ensemble/state/toolchain/), and a
 *              5x `met` is withheld unless every such row of a required stratum passes; `fiveX.attestation` says what stays attested
 *              `targetFactors` ({ '<tier>/<round>': factor >= 1 }, default 5) grades a stratum at another factor, marked `rebased`;
 *              `fiveX` never reads it (kata js1p)
 *
 * The tier, approval and merge-gate subcommands (TRD-026) each take the facts
 * their module grades and answer with that module's result verbatim:
 *   tier       { kinds[{ kind, paths[] }], paths, secondAssessment?, proposedTier?,
 *                proposedBy?, author?, policy?, evidence?, enabledBy?, assignedBy?, at? }
 *              -- assigns the tier from the CHANGE, resolves the Low waiver into
 *              the effective tier, and answers the RECORD that `state-write`
 *              stores under the report's `tier` key: tier and effective tier,
 *              humans required, the characteristics and paths that drove it, who
 *              or what assigned it, and every raise with its original tier,
 *              final tier and reason (AC-015-1, AC-015-2)
 *   approvals  { reviews[{ author|login, state, commitSha, treeSha?, isBot? }], headSha,
 *                headTreeSha?, tier, policy?, author?, directedBy?, agentAuthored? }
 *              -- `tier` is a `tier` result (or an `effectiveTier` one): the
 *              humans required come from it, never from this CLI. `author` is
 *              what the solo-maintainer discount compares the director with:
 *              a director who is not the author needs an APPROVED review of
 *              the head; a director who is the author is credited on their
 *              own word (warning `solo-maintainer-self-credit`)
 *   gate       { ledger[], approvals, tier?, description, security{ status, findings?, reason? }, coverage{ status, gaps?, reason? },
 *                headSha?, policy?, unavailable?[] }
 *              -- the one answer to "may this PR merge?", with every blocker
 *              carrying its code, message and next action. An Important or
 *              security finding is closed only by a later head that cleared it
 *              or by a resolution WITH provenance (`by`, a login the optional
 *              `policy` lets decide; `at`; and a `headSha` equal to this head).
 *              A resolution without it, and the review's own deferral of a
 *              non-blocking Major (`blocking: false`), still block.
 *              On top of that answer the CLI adds the operator's decision
 *              list (`dispositionChoices`, `dispositionGroups`,
 *              `mergeConfirmation`; lib/pr-review-disposition.js), computed
 *              from the same `ledger`, `security`, `headSha` and `policy` plus
 *              an optional `votes` (a `votes` result) for the per-finding
 *              tally, and asking the gate which findings block.
 *              `evaluateGate`'s own answer is unchanged by it.
 *              `coverage` (kata k48x) is REQUIRED, like `security`: the review's coverage record (the state report's `coverage`
 *              for this head, or the `slices` answer's). Absent or `unavailable` is `review-data-unavailable`; an open gap is a
 *              `review-coverage-incomplete` blocker naming the slice and paths; an operator's decision on a gap (`ledger resolve`,
 *              the same four-key resolution as for a finding, spliced into `coverage.gaps`) closes it only on this head. The
 *              decision list carries each open gap in its own `coverage` group (Accept is its only choice).
 *
 *   carry      { action, ... } -- (lib/pr-review-carry.js) settled verification verdicts across heads. One `action` per call.
 *              A carried verdict is a verification fact about a finding and never a claim that anyone read a path: `coverage`
 *              carries what a delta round did not read (below).
 *              Its REQUEST parameters (`prId` and `candidates` for plan; `findings` and `candidates` for record; `ledger`,
 *              `changedLocations`, `headSha` and `observations` for reconcile) are required, as `ledger`'s keys are: an absent or
 *              misspelt one is exit 1. Every other fact is graded in band (re-verification, exit 0):
 *                plan       { prId, headSha, lastReviewedSha, baseSha, depth, expectedVerifiers?, deltaPlan, deltaPaths[],
 *                             deltaRange, highPaths[], candidates[], cwd? } -- which settled verdicts of the prior round still stand
 *                             after a fix push. The prior verdicts and the prior ledger are NOT payload keys (one is refused):
 *                             the CLI reads them from the PR's own state report at `lastReviewedSha` (state-read's rule), so
 *                             a verdict can only come from a report written for this PR at the head the delta starts from.
 *                             `deltaRange` is `{ headSha: facts.headSha, lastReviewedSha: facts.delta.lastReviewedSha }`, the
 *                             range `deltaPlan` and `deltaPaths` were computed for, and it must be this round's `headSha` and
 *                             `lastReviewedSha`: a missing, malformed or different one carries nothing (`delta-range-mismatch`).
 *                             Answers { ok, carried[], reverify[], unmatched[], reasons[], ledger[]|null, priorState }: a
 *                             carried record keeps its verdict and votes, is stamped `head` = this head and keeps `carriedFrom`;
 *                             `ledger` is the prior ledger with exactly those findings stamped (`stampLedger`; refused,
 *                             `ok:false`, when it already holds a finding stamped with this head, and then `null`); a `reverify`
 *                             entry lists every reason (the module header has the table). A missing, discarded, corrupt or
 *                             unreadable report (`priorState` other than `read`) carries nothing (`prior-state-unavailable`) and
 *                             answers `ledger: null`, NEVER `[]`: the answer is the round's existing ledger, and an empty one
 *                             reads as "no open findings". `candidates` are the hash step's answer as it gave
 *                             it: each is stamped with the `headSha` it was hashed at, and one stamped with another head (or
 *                             none) is verified again (`candidate-head-mismatch`), never carried.
 *                record     { prId, baseSha, headSha, depth, expectedVerifiers?, findings[], candidates[] } -- the verdict
 *                             records of a finished round (`recordVerdicts`): the settled findings of the `votes` result
 *                             joined to their hashed citations and stamped with the binding `plan` checks. Answers
 *                             { ok, verdicts[], skipped[{id, reason}] }; write the verdicts to the state report's `verdicts`.
 *                             A candidate stamped with another head than `headSha` is skipped (`candidate-head-mismatch`).
 *                reconcile  { ledger[], changedLocations[], headSha, observations[] } -- writes NO `cleared` mark. Answers
 *                             { ok, ledger[], cleared: [] }: the ledger read into the current taxonomy and redacted, otherwise
 *                             as sent (a mark already on an entry stays). `changedLocations`, `headSha` and `observations` are
 *                             still required (a call written for the earlier contract keeps working) and are not read. It used to
 *                             clear a finding from the delta's hunks and an exact `locationOrLink` + `failureMode` match of the
 *                             observations, at the line numbers the ledger holds, so a defect that was still there was marked
 *                             cleared (a line shifted across a skipped round, a force-pushed head, a partial fix raised again) and
 *                             the gate and the bead recorder took it as fixed. The one writer of `cleared` is
 *                             lib/pr-review-clear-cli.js, which reads git.
 *              `deltaPlan`, `deltaPaths`, `deltaRange`, `highPaths`, heads, `baseSha`, `depth` and every hash are graded in-band and a
 *              missing one means re-verification (exit 0). HONEST LIMITS: it never hashes anything -- `hunkHash`,
 *              `depHashes` and `dependents` are inputs the caller computed (lib/pr-review-carry-hash-cli.js; the `headSha`
 *              stamp names the head that step read, it cannot show the output was passed on unaltered), and the content of
 *              `deltaPlan` and `deltaPaths` is taken to be what `prepare` computed for `deltaRange` (only their agreement with
 *              each other and with the range is checked); only
 *              `present`/`filtered` verdicts carry; a High or sensitive path touched by the delta carries nothing; a
 *              `full` range carries nothing; the state report is untracked and writable by whoever can write the
 *              repository, so binding stops a verdict from the wrong PR, base, depth or ledger, not a forged report.
 *                coverage   { prId, coverage, lastReviewedSha, deltaPlan?, cwd? } -- the coverage record of a review round that
 *                             reads a delta (kata k48x). `coverage` is this round's own record; the prior round's is read from the
 *                             PR's state report at `lastReviewedSha` (a payload `priorCoverage` is refused). Answers
 *                             { ok, carried[], reasons[], coverage, priorState }: a delta round carries EVERY gap of the round it
 *                             starts from (re-stamped `carriedFrom`; an old decision stays on it and is stale at the new head), so a
 *                             delta can never turn an incomplete coverage into a complete one; `deltaPlan.mode: 'full'` (the whole
 *                             range was read) carries none. A prior state that was not read, or one with no readable coverage,
 *                             answers `unavailable` (never `complete`): what the delta did not read is unknown. Hand the answer's
 *                             `coverage` to `status` and `gate`.
 *
 * FAIL CLOSED at the boundary. Two kinds of payload value are told apart:
 *   - the review FACTS of `scope`, `remote`, `status`, `policy`, `rules`,
 *     `paths` and `description` are graded in-band by their modules, so a
 *     missing or invalid fact is a blocked, strict-default or not-ready
 *     RESULT (exit 0), never a completed phase, a repository policy in force
 *     or a PR that is ready for approval;
 *   - the REQUEST parameters -- a ledger action and its keys, `headSha` for
 *     state-read, `treeSha` for state-read when given, `state` for
 *     state-write, `prId`/`targetPath`/`cwd` -- are checked here. One that is
 *     missing, misspelt or of the wrong type is an ERROR (exit 1, `{error}`),
 *     so a caller that gets a key wrong can never receive a clean result built
 *     on a default. (Whether a `treeSha` is a real tree id is graded in-band by
 *     the state module, like the SHAs of the graded subcommands.)
 * Subcommand and action names are matched as own properties only, so inherited
 * names (`constructor`, `toString`, `__proto__`, ...) are unknown, not handlers.
 */

const fs = require('fs');

const { resolveReviewScope, chooseReviewRange } = require('./pr-review-scope');
const {
  validateLedger,
  isActionable,
  dedupeFindings,
  mergeFindings,
  scopeViolations,
  recordRound,
  recordOperatorResolution,
  normalizeLedger,
} = require('./pr-review-ledger');
const { evaluateRemoteReview } = require('./pr-review-remote');
const { deriveStatus } = require('./pr-review-status');
const { statePath, writeState, readState, redact } = require('./pr-review-state');
const { loadPolicy } = require('./pr-review-policy');
const { resolveRuleFiles } = require('./pr-review-rules');
const { classifyPaths } = require('./pr-review-paths');
const { checkDescription } = require('./pr-review-description');
const { reviewDeadlines, collectResults, toVotesInput, classifyAgentFailure } = require('./pr-review-results');
const { computeReviewTiming, loadReviewTiming } = require('./pr-review-timing');
const { tallyVotes } = require('./pr-review-votes');
const { planVerification } = require('./pr-review-verify-assign');
const { resolveDepth, checkBounds, boundsFor, planSlices, verifyCoverage } = require('./pr-review-depth');
const { buildCoverage, carryCoverage } = require('./pr-review-coverage');
const { offerExplainers } = require('./pr-review-explainer-offer');
const { renderBriefFromFiles } = require('./pr-review-brief-files');
const { assignTier, effectiveTier, tierRecord } = require('./pr-review-tier');
const { selectMode } = require('./pr-review-mode');
const { planCarry, recordVerdicts, stampLedger, REASONS: CARRY_REASONS } = require('./pr-review-carry');
const { evaluateApprovals } = require('./pr-review-approvals');
const { evaluateGate } = require('./pr-review-gate');
const { buildDispositionChoices } = require('./pr-review-disposition');
const { computeMetrics, compareCohorts } = require('./pr-review-metrics');
const { computeWalltimeCohort, compareWalltime, rowFromTiming } = require('./pr-review-walltime');
const { scoreEval, compareEval, staleCases } = require('./pr-review-eval');
const { traceCapabilities, compareRuntimes, gradeSecretHygiene } = require('./pr-review-reachability');

const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** What a request parameter must be. */
const ARRAY = { check: Array.isArray, describe: 'an array' };
const OBJECT = { check: isObject, describe: 'an object' };
const TEXT = { check: (value) => typeof value === 'string' && value.trim() !== '', describe: 'a non-empty string' };
const INTEGER = { check: (value) => Number.isInteger(value), describe: 'an integer' };

/**
 * Every key in `keys` must be on `payload` with a value of the kind named. Nothing is defaulted: an absent key
 * (typically a misspelt one) fails the check like any other wrong value, so it throws instead of being read as an
 * empty list or a missing-and-fine value.
 */
function requireKeys(payload, keys, what) {
  for (const [key, kind] of Object.entries(keys)) {
    if (!kind.check(payload[key])) throw new Error(`${what} requires payload key '${key}' to be ${kind.describe}`);
  }
}

/** An optional request key: absent is fine, but one that is present must be of the kind named -- never read as absent. */
function optionalKeys(payload, keys, what) {
  for (const [key, kind] of Object.entries(keys)) {
    if (payload[key] !== undefined && !kind.check(payload[key])) {
      throw new Error(`${what} payload key '${key}' must be ${kind.describe} when given`);
    }
  }
}

/** A name as shown in an error: quoted text, or the JSON of whatever else was sent. */
function shown(name) {
  return typeof name === 'string' ? `'${name}'` : String(JSON.stringify(name));
}

/** Reads and parses the entire stdin as JSON. Throws on empty/invalid input. */
function readStdinJson() {
  const raw = fs.readFileSync(0, 'utf8');
  return JSON.parse(raw);
}

function runScope(payload) {
  return resolveReviewScope(payload);
}

function runReviewRange(payload) {
  return chooseReviewRange(payload);
}

/** dedupe, merge and scopeViolations answer with an array; anything else is the module refusing input it cannot read. */
function arrayOrThrow(result) {
  if (!Array.isArray(result)) throw new Error(result && result.reason ? result.reason : 'ledger input rejected');
  return result;
}

/** action -> the keys its payload must carry, and the module call it delegates to. Looked up by own name only. */
const LEDGER_ACTIONS = Object.freeze({
  validate: {
    keys: { findings: ARRAY },
    run: (p) => validateLedger(p.findings),
  },
  isActionable: {
    keys: { finding: OBJECT },
    run: (p) => ({ actionable: isActionable(p.finding) }),
  },
  dedupe: {
    keys: { findings: ARRAY },
    run: (p) => ({ findings: arrayOrThrow(dedupeFindings(p.findings)) }),
  },
  merge: {
    keys: { existingLedger: ARRAY, incomingFindings: ARRAY, headSha: TEXT },
    run: (p) => ({ ledger: arrayOrThrow(mergeFindings(p.existingLedger, p.incomingFindings, p.headSha)) }),
  },
  scopeViolations: {
    keys: { changedFiles: ARRAY, scope: ARRAY, ledger: ARRAY },
    run: (p) => ({ violations: arrayOrThrow(scopeViolations(p.changedFiles, p.scope, p.ledger)) }),
  },
  recordRound: {
    keys: { ledger: ARRAY, incoming: ARRAY, round: INTEGER },
    run: (p) => {
      const result = recordRound({ ledger: p.ledger, incoming: p.incoming, round: p.round });
      if (!result.ok) throw new Error(result.reason);
      return result;
    },
  },
  resolve: {
    keys: { finding: OBJECT, resolution: OBJECT },
    optional: { policy: OBJECT },
    run: (p) => {
      const result = recordOperatorResolution(p.finding, p.resolution, p.policy);
      if (!result.ok) throw new Error(result.reason);
      return { finding: result.finding };
    },
  },
});

function runLedger(payload) {
  if (!isObject(payload)) throw new Error('ledger payload must be a JSON object');
  const name = payload.action;
  const action = typeof name === 'string' && hasOwn(LEDGER_ACTIONS, name) ? LEDGER_ACTIONS[name] : undefined;
  if (action === undefined) {
    throw new Error(
      `Unknown ledger action ${shown(name)}. Expected one of: ${Object.keys(LEDGER_ACTIONS).join(', ')}`
    );
  }
  requireKeys(payload, action.keys, `ledger action '${name}'`);
  if (action.optional !== undefined) optionalKeys(payload, action.optional, `ledger action '${name}'`);
  return action.run(payload);
}

function runRemote(payload) {
  return evaluateRemoteReview(payload);
}

function runStatus(payload) {
  return deriveStatus(payload);
}

/** Resolves the on-disk state report path from either a direct path or a prId. */
function resolveTargetPath(payload) {
  if (!isObject(payload)) throw new Error('state command payload must be a JSON object');
  if (payload.cwd !== undefined && !TEXT.check(payload.cwd)) throw new Error('state command: cwd must be a non-empty string');
  if (payload.targetPath !== undefined) {
    if (!TEXT.check(payload.targetPath)) throw new Error('state command: targetPath must be a non-empty string');
    return payload.targetPath;
  }
  if (!TEXT.check(payload.prId)) throw new Error('state command requires targetPath or prId (each a non-empty string)');
  return statePath(payload.prId, payload.cwd || process.cwd());
}

function runStateRead(payload) {
  const targetPath = resolveTargetPath(payload);
  requireKeys(payload, { headSha: TEXT }, 'state-read');
  optionalKeys(payload, { treeSha: TEXT }, 'state-read');
  return readState(targetPath, payload.headSha, { cwd: payload.cwd, treeSha: payload.treeSha });
}

function runStateWrite(payload) {
  const targetPath = resolveTargetPath(payload);
  requireKeys(payload, { state: OBJECT }, 'state-write');
  return writeState(targetPath, payload.state, { cwd: payload.cwd });
}

/**
 * The four guidance subcommands (TRD-005). Each is a pass-through to one pure
 * module: the payload is NOT pre-checked here, because every one of these
 * modules grades its own input in band and fails closed on anything it cannot
 * read (strict default policy, no rules applied, a sensitive PR, a PR that is
 * not ready). Checking here as well could only make the CLI answer differently
 * from the library on the same input, which is the one thing this file exists
 * to prevent.
 */
function runPolicy(payload) {
  return loadPolicy(payload);
}

function runRules(payload) {
  return resolveRuleFiles(payload);
}

function runPaths(payload) {
  return classifyPaths(payload);
}

function runDescription(payload) {
  return checkDescription(payload);
}

/**
 * The three verification subcommands (TRD-018). Like the guidance four, each
 * is graded IN BAND by its module: a payload the module cannot read is a
 * blocked, deepest-mode or no-plan RESULT (exit 0), never a clean pass.
 *
 * `votes` is a pass-through but for two keys: `settleOnMajority` (kata dx53) and `quorumFirst` (kata 3ezq) are the review runner's options, which
 * calls the tally itself, and the narrated procedure keeps the strict rule (AC-006-3) and the whole electorate, so both keys are dropped from the
 * payload here, whatever their value, and the answer is the one the payload without them gives (the caller's object is not changed; an assignment
 * entry that leaves seats `unasked` is then refused by the tally, since only a quorum-first tally accepts one). `depth` and `slices` each
 * call exactly two functions of their one module -- resolve then grade, plan then verify --
 * because that is the single question the skill asks; the dispatcher still
 * decides nothing itself, and the only value it combines is `ok`, which it
 * can only make stricter.
 */
function runVotes(payload) {
  if (payload !== null && typeof payload === 'object' && !Array.isArray(payload) && ['settleOnMajority', 'quorumFirst'].some((key) => Object.prototype.hasOwnProperty.call(payload, key))) {
    const strict = { ...payload };
    delete strict.settleOnMajority;
    delete strict.quorumFirst;
    return tallyVotes(strict);
  }
  return tallyVotes(payload);
}

/**
 * `verify-assign` is a pass-through to `planVerification`: which K distinct verifiers settle each candidate,
 * and which candidates each verifier agent is briefed on. Its `assignments` go back into `votes` as
 * `assignment`, which validates the tally against the plan.
 */
function runVerifyAssign(payload) {
  return planVerification(payload);
}

/**
 * `depth` answers one question with two parts, because the skill asks them
 * together: which mode this PR gets, and -- when the caller already knows the
 * reviewer and verifier counts it planned or ran -- whether those counts sit
 * inside that mode's bounds (AC-016-1, AC-016-3).
 *
 * The grading never softens the resolution: an unreadable tier still resolves
 * to the deepest mode, bounds the policy made unreadable stay `null` rather
 * than silently falling back to the defaults, and `ok` is true only when both
 * halves are. A `bounds` override is honoured on both paths -- a caller that
 * has not planned anyone yet is still told the bounds the policy puts it
 * under, not the defaults.
 */
function runDepth(payload) {
  const resolved = resolveDepth(payload);
  const request = isObject(payload) ? payload : {};
  if (request.planned === undefined && request.used === undefined) {
    const { bounds, warnings } = boundsFor(resolved.mode, request.bounds);
    return {
      ...resolved,
      ok: resolved.ok && bounds !== null,
      bounds,
      violations: [],
      warnings: [...new Set([...resolved.warnings, ...warnings])],
    };
  }

  const graded = checkBounds({
    mode: resolved.mode,
    planned: request.planned,
    used: request.used,
    bounds: request.bounds,
  });

  const result = {
    ok: resolved.ok && graded.ok,
    mode: resolved.mode,
    tier: resolved.tier,
    source: resolved.source,
    bounds: graded.bounds,
    violations: graded.violations,
    reasons: resolved.reasons,
    warnings: [...new Set([...resolved.warnings, ...graded.warnings])],
  };
  if (graded.reason !== undefined) result.reason = graded.reason;
  return result;
}

/**
 * `slices` plans the review by area and size and who reads each slice under which lens and, when the caller
 * names who reviewed what (`reviewedBy`), says which changed paths were not read under enough distinct lenses
 * (AC-018-1, AC-018-2, plan 3A). A plan the module refused is returned as the refusal
 * it is: coverage is never computed over an empty plan, because "no slices,
 * all reviewed" is exactly the false pass this gate exists to prevent. The old `reviewed` slice-id list is
 * REFUSED, not ignored: a caller still sending it would otherwise get a plan back with no coverage verdict
 * at all, which reads as a pass.
 */
function runSlices(payload) {
  const plan = planSlices(payload);
  const request = isObject(payload) ? payload : {};
  if (plan.ok && request.reviewed !== undefined) {
    return { ...plan, ok: false, reason: 'reviewed is no longer accepted: pass reviewedBy, an array of { sliceId, lens, reviewer, paths }' };
  }
  if (!plan.ok || request.reviewedBy === undefined) return plan;

  const coverage = verifyCoverage({
    slices: plan.slices,
    reviewedBy: request.reviewedBy,
    mode: request.mode,
    changedPaths: request.changedPaths,
  });

  const changedGiven = Array.isArray(request.changedPaths);
  const planned = plan.slices.flatMap((slice) => slice.paths);
  const notChanged = changedGiven ? planned.filter((file) => !request.changedPaths.includes(file)) : [];
  // A plan is only as complete as the paths it was cut from: with no `changedPaths` to hold it against, a changed file the plan
  // never held cannot be seen, and a plan holding a path `changedPaths` does not name was cut from another listing. Either way the
  // record is `unavailable` (never complete) instead of graded against the plan's own paths.
  const unavailable =
    coverage.ok !== true
      ? coverage.reason || 'the coverage could not be computed'
      : !changedGiven
        ? 'changedPaths was not given, so the plan cannot be checked against the changed files: a changed file the plan never held would read as covered'
        : notChanged.length > 0
          ? `the plan holds paths that changedPaths does not name (${notChanged.slice(0, 5).join(', ')}${notChanged.length > 5 ? ', ...' : ''}), so the two lists were not cut from one listing and the plan cannot be graded against the changed files`
          : null;
  // The record `status` and `gate` take: a path nobody read is a named gap there, never a quiet `covered:false` a caller can drop.
  const record = buildCoverage({
    changedPaths: changedGiven ? request.changedPaths : plan.slices.flatMap((slice) => slice.paths),
    slices: plan.slices,
    unreviewedSlices: coverage.unreviewedSlices,
    uncovered: coverage.uncovered,
    underReviewed: coverage.underReviewed,
    requiredLenses: coverage.requiredLenses,
    incomplete: coverage.covered !== true,
    origin: 'slices coverage (reviewedBy)',
    ...(unavailable === null ? {} : { unavailable }),
  });

  const result = {
    ...plan,
    ok: plan.ok && coverage.ok && coverage.covered,
    covered: coverage.covered,
    uncovered: coverage.uncovered,
    underReviewed: coverage.underReviewed,
    requiredLenses: coverage.requiredLenses,
    reviewedSlices: coverage.reviewedSlices,
    unreviewedSlices: coverage.unreviewedSlices,
    unknownReviewed: coverage.unknownReviewed,
    coverage: record,
  };
  if (coverage.reason !== undefined) result.coverageReason = coverage.reason;
  // The verdict and the record must not disagree: a plan the record does not call complete (no `changedPaths`, a plan and a changed
  // list cut from different listings, or no path at all) is not `covered`.
  if (coverage.ok === true && coverage.covered === true && record.status !== 'complete') {
    result.ok = false;
    result.covered = false;
    result.coverageReason = record.reason || 'the coverage record lists gaps the verdict did not';
  }
  return result;
}

/**
 * `tier` answers the one question the skill asks -- "what tier is this PR
 * reviewed and approved at, and what gets recorded?" -- by calling the three
 * functions of its one module in the only order they compose: assign the tier
 * from the change, resolve the Low waiver into the effective tier, then build
 * the record (AC-015-1, AC-015-2). The dispatcher decides nothing: it never
 * picks a tier, never grants a waiver, and the only value it combines is
 * `ok`, which it can only make STRICTER.
 *
 * Graded IN BAND and fail-closed UPWARDS: a payload the module cannot read is
 * a High record requiring two humans with the reason named (exit 0), never a
 * cheaper review. A blocked assignment therefore still answers a record --
 * an unrecorded tier is never an absent requirement.
 */
function runTier(payload) {
  const request = isObject(payload) ? payload : {};
  const assignment = assignTier(payload);
  const effective = effectiveTier({
    assignment,
    policy: request.policy,
    evidence: request.evidence,
    enabledBy: request.enabledBy,
    author: request.author,
  });
  const record = tierRecord({
    assignment,
    effective,
    assignedBy: request.assignedBy,
    at: request.at,
  });
  return { ...record, ok: record.ok === true && assignment.ok === true && effective.ok === true };
}

/**
 * `mode` answers which of the two review-run modes this PR gets -- `light`
 * or `full` -- from the `tier` result the payload carries as `tierResult`
 * (the `tier` subcommand's output, verbatim). The mode comes from that tier
 * and nothing else: never the size of the diff, never an agent's judgement.
 * Fail closed means FULL: a missing, unreadable or ambiguous `tierResult`
 * answers `mode:'full'` with `ok:false` and the reason named (exit 0).
 */
function runMode(payload) {
  const request = isObject(payload) ? payload : {};
  return selectMode(request.tierResult);
}

/**
 * `carry` (lib/pr-review-carry.js; kata qw98), one `action` per call like `ledger`:
 *   - `plan` says, after a fix push, which settled verification verdicts of the prior round still stand (`carried`,
 *     re-stamped with the current head and keeping `carriedFrom`) and which must be verified again (`reverify`, with every
 *     reason; `unmatched` for a prior verdict no candidate re-presents). It reads the prior verdicts and ledger from the
 *     PR's state report itself, at `lastReviewedSha`: a payload that supplies them is refused, so a verdict can never be
 *     injected from stdin. It answers the prior ledger with the carried findings stamped (`stampLedger`).
 *   - `record` builds the stamped verdict records of a finished round (`recordVerdicts`).
 *   - `reconcile` writes no mark: it answers the ledger normalized and `cleared: []`. The clear verb is the only writer.
 * The REQUEST parameters of each action (`prId`, `candidates`, `findings`, `ledger`, ...) are checked here (a missing or
 * misspelt key is an error, exit 1, never read as empty); every fact `planCarry` grades (heads, `baseSha`, `depth`,
 * `deltaPlan`, `deltaPaths`, `deltaRange`, `highPaths`, a hash) is graded in-band and a missing one means re-verification (exit 0).
 */

/**
 * What the PR's state report said about the round the delta starts from. `verdicts` and `ledger` are what `planCarry` is
 * given: both empty when nothing was read (there is nothing to carry from); for a report that was read, what it holds
 * (no `verdicts` is none, but no `ledger` is NOT an empty one: a ledger that is not a list is `ledger-unreadable`). That is
 * not what the answer's `ledger` says either: only `priorState: 'read'` AND a ledger array make it a ledger.
 */
function readPriorRound(payload) {
  const unavailable = (priorState) => ({ priorState, verdicts: [], ledger: [], coverage: null });
  const read = readState(statePath(payload.prId, payload.cwd || process.cwd()), payload.lastReviewedSha, { cwd: payload.cwd });
  if (!read.ok) return unavailable(read.reason === 'corrupt' ? 'corrupt' : 'unreadable');
  if (!read.exists) return unavailable('absent');
  if (read.discarded || !isObject(read.state)) return unavailable('discarded');
  const { verdicts, ledger, coverage } = read.state;
  return { priorState: 'read', verdicts: verdicts === undefined ? [] : verdicts, ledger, coverage: coverage === undefined ? null : coverage };
}

function carryPlan(payload) {
  for (const key of ['priorVerdicts', 'priorLedger']) {
    if (payload[key] !== undefined) throw new Error(`carry plan reads '${key}' from the PR's state report at lastReviewedSha; it is not a payload key`);
  }
  const prior = readPriorRound(payload);
  const plan = planCarry({ ...payload, priorVerdicts: prior.verdicts, priorLedger: prior.ledger });
  // The answer's `ledger` is the round's existing ledger, so an empty one reads as "no open findings": it is an array only
  // for a prior state that was READ and holds a ledger array. An absent, discarded, corrupt or unreadable state, and a read
  // report with no ledger list, answer `null`, never `[]`.
  const answer = { ...plan, ledger: prior.priorState === 'read' && Array.isArray(prior.ledger) ? prior.ledger : null, priorState: prior.priorState };
  if (prior.priorState !== 'read') {
    const unavailable = CARRY_REASONS.PRIOR_STATE_UNAVAILABLE;
    return {
      ...answer,
      reasons: [...new Set([...plan.reasons, unavailable])],
      reverify: plan.reverify.map((entry) => ({ ...entry, reasons: [...new Set([...entry.reasons, unavailable])] })),
    };
  }
  if (!plan.ok || !Array.isArray(prior.ledger) || typeof payload.headSha !== 'string' || payload.headSha.trim() === '') return answer;
  const stamped = stampLedger({ ledger: prior.ledger, carried: plan.carried, headSha: payload.headSha });
  if (!stamped.ok) {
    return { ok: false, carried: [], reverify: [], unmatched: [], reasons: [stamped.reason], ledger: null, priorState: prior.priorState };
  }
  return { ...answer, ledger: stamped.ledger };
}

/**
 * `carry coverage`: the coverage record of a delta round, with every gap of the round it starts from carried in (see
 * `carryCoverage`). The prior record is read from the PR's own state report at `lastReviewedSha`, never from the payload.
 */
function carryCoverageAction(payload) {
  if (payload.priorCoverage !== undefined) throw new Error("carry coverage reads 'priorCoverage' from the PR's state report at lastReviewedSha; it is not a payload key");
  const prior = readPriorRound(payload);
  const fullRange = isObject(payload.deltaPlan) && payload.deltaPlan.mode === 'full';
  const answer = carryCoverage({
    current: payload.coverage,
    prior: prior.coverage,
    priorState: prior.priorState,
    priorHeadSha: payload.lastReviewedSha,
    fullRange,
  });
  return { ...answer, priorState: prior.priorState };
}

/** action -> the keys its payload must carry, and the call it delegates to. Looked up by own name only. */
const CARRY_ACTIONS = Object.freeze({
  plan: {
    keys: { prId: TEXT, candidates: ARRAY },
    optional: { cwd: TEXT },
    run: carryPlan,
  },
  record: {
    keys: { findings: ARRAY, candidates: ARRAY },
    run: (p) => recordVerdicts(p),
  },
  coverage: {
    keys: { prId: TEXT, coverage: OBJECT },
    optional: { cwd: TEXT },
    run: carryCoverageAction,
  },
  reconcile: {
    keys: { ledger: ARRAY, changedLocations: ARRAY, headSha: TEXT, observations: ARRAY },
    run: (p) => {
      const ledger = normalizeLedger(p.ledger);
      if (!Array.isArray(ledger)) throw new Error(ledger.reason);
      return { ok: true, ledger, cleared: [] };
    },
  },
});

function runCarry(payload) {
  if (!isObject(payload)) throw new Error('carry payload must be a JSON object');
  const name = payload.action;
  const action = typeof name === 'string' && hasOwn(CARRY_ACTIONS, name) ? CARRY_ACTIONS[name] : undefined;
  if (action === undefined) {
    throw new Error(`Unknown carry action ${shown(name)}. Expected one of: ${Object.keys(CARRY_ACTIONS).join(', ')}`);
  }
  requireKeys(payload, action.keys, `carry action '${name}'`);
  if (action.optional !== undefined) optionalKeys(payload, action.optional, `carry action '${name}'`);
  return action.run(payload);
}

/**
 * `approvals` and `gate` are pass-throughs to the one module that owns each
 * question. Both grade their input IN BAND and fail closed: a request, a tier
 * or a review record they cannot read is `satisfied:false` / `mergeable:false`
 * with the reason named (exit 0). Nothing here re-grades, softens or
 * aggregates what the module answered -- a gate that passed because this
 * dispatcher defaulted a missing key is exactly the false pass these gates
 * exist to prevent.
 */
function runApprovals(payload) {
  return evaluateApprovals(payload);
}

/**
 * `gate` answers `evaluateGate` verbatim and ADDS the operator's decision
 * list, computed by the separate pure `buildDispositionChoices` so the gate's
 * own input contract and answer stay exactly what they were. The list is built
 * from what the gate was handed (`ledger`, `security`, `headSha`, the optional
 * `policy`) plus an optional `votes` result, and it asks the gate which
 * findings block (`findingsHeldOpen`), so it cannot disagree with the verdict
 * about them. When it cannot be built, the gate's answer is still returned and
 * `dispositionChoices` is empty with the refusal in `dispositionReason`. The
 * gate never reads the list, so nothing about the list can make it more
 * permissive.
 */
function runGate(payload) {
  const gate = evaluateGate(payload);
  const request = isObject(payload) ? payload : {};
  const disposition = buildDispositionChoices({
    ledger: request.ledger,
    security: request.security,
    coverage: request.coverage,
    votes: request.votes,
    policy: request.policy,
    headSha: request.headSha,
  });
  return {
    ...gate,
    dispositionChoices: disposition.dispositionChoices,
    dispositionGroups: disposition.groups,
    mergeConfirmation: disposition.mergeConfirmation,
    ...(disposition.ok === true ? {} : { dispositionReason: disposition.reason }),
  };
}

/**
 * `explainer-offer` is a pass-through to `offerExplainers`. Like the guidance
 * subcommands it is graded IN BAND: a payload the module cannot read answers
 * `ok:false` with `offered:false` and an empty `generate` (exit 0), never an
 * offer and never an explainer nobody asked for.
 */
function runExplainerOffer(payload) {
  return offerExplainers(payload);
}

/**
 * `brief` renders one agent brief from its template. It does not grade, it refuses:
 * a role or input the renderer does not accept throws (exit 1), because a brief
 * that was rendered from guessed input is exactly the hand-written brief this
 * subcommand exists to replace. The file reads live in `pr-review-brief-files.js`.
 */
function runBrief(payload) {
  requireKeys(payload, { role: TEXT, vars: OBJECT }, 'brief');
  const extra = Object.keys(payload).filter((key) => key !== 'role' && key !== 'vars');
  if (extra.length > 0) {
    throw new Error(`brief does not accept payload key(s) ${extra.map((key) => `'${key}'`).join(', ')}; inputs go under 'vars'`);
  }
  return { ok: true, role: payload.role, brief: renderBriefFromFiles(payload.role, payload.vars) };
}

/**
 * The metrics and eval subcommands (TRD-032). Each is a pass-through to the
 * one module function that owns the question, graded IN BAND exactly like
 * the guidance subcommands: a cohort too small, a comparison it cannot read,
 * a case the owner never confirmed or a rules hash it does not recognise is
 * a refusing RESULT (exit 0), never a clean pass. Nothing here aggregates,
 * re-grades or softens what the module answered.
 */
function runMetrics(payload) {
  return computeMetrics(payload);
}

function runMetricsCompare(payload) {
  return compareCohorts(payload);
}

function runEvalScore(payload) {
  return scoreEval(payload);
}

function runEvalCompare(payload) {
  return compareEval(payload);
}

function runEvalStale(payload) {
  return staleCases(payload);
}

/**
 * `reachability` (TRD-037) grades the cross-runtime proof. One payload
 * selects one grader via `action`, mirroring the `ledger` precedent:
 *   trace     { entryPoints, skills, subcommands, capabilities? }
 *   runtimes  { runtimes, baseline?, expected? }
 *   secrets   { workflows, allowedSecrets?, hostedReviewerConfigured?, samples? }
 * An unknown action is refused in-band rather than guessed at, because a
 * guessed proof is worse than no proof.
 */
function runReachability(payload) {
  const action = isObject(payload) && typeof payload.action === 'string' ? payload.action.trim().toLowerCase() : null;
  if (action === 'trace') return traceCapabilities(payload);
  if (action === 'runtimes') return compareRuntimes(payload);
  if (action === 'secrets') return gradeSecretHygiene(payload);
  return { ok: false, reason: `unknown reachability action ${JSON.stringify(action)} (expected trace, runtimes or secrets)` };
}

/**
 * `results` selects one function of pr-review-results.js via `action`, mirroring the `reachability` precedent. The
 * module owns the file reads (injectable deps, real fs here); this dispatcher only supplies the clock when the payload
 * names none (the deadline of `failure` is checked against it) and, for `collect`, attaches the `votes` payload built
 * from what was collected. An unknown action is refused in-band: a guessed deadline or classification would be worse
 * than none.
 */
function runResults(payload) {
  const request = isObject(payload) ? payload : {};
  const action = typeof request.action === 'string' ? request.action.trim().toLowerCase() : null;
  const now = request.now === undefined ? Date.now() : request.now;
  if (action === 'deadlines') return reviewDeadlines({ ...request, now });
  if (action === 'failure') return classifyAgentFailure({ ...request, now });
  if (action === 'collect') {
    const collected = collectResults({ ...request, now });
    if (request.depth === undefined) return collected;
    return {
      ...collected,
      votesInput: toVotesInput(collected, {
        depth: request.depth,
        expectedVerifiers: request.expectedVerifiers,
        candidates: request.candidates,
      }),
    };
  }
  return { ok: false, reason: `unknown results action ${JSON.stringify(action)} (expected deadlines, collect or failure)` };
}

/**
 * `timing` answers the review timing of one run trace. The file read lives in pr-review-timing.js (injectable deps);
 * this dispatcher only checks the request: exactly one of `runId` (a trace on disk) or `spans` (already materialized).
 * Anything else is an error, so a misspelt key can never be answered with an empty timing.
 */
function runTiming(payload) {
  if (!isObject(payload)) throw new Error('timing payload must be a JSON object');
  optionalKeys(payload, { runId: TEXT, cwd: TEXT, spans: ARRAY }, 'timing');
  if ((payload.runId === undefined) === (payload.spans === undefined)) {
    throw new Error("timing requires exactly one of the payload keys 'runId' or 'spans'");
  }
  if (payload.spans !== undefined) return computeReviewTiming({ spans: payload.spans });
  return loadReviewTiming({ runId: payload.runId, projectRoot: payload.cwd || process.cwd() });
}

/**
 * `walltime` selects one function of pr-review-walltime.js via `action`, mirroring the `ledger` and `carry` precedent.
 * The file read of `row` lives in pr-review-timing.js (injectable deps), as for `timing`; this dispatcher only checks
 * the request. A payload key the action does not know is refused so that a misspelt `carry` or `cwd` can never be read
 * as an absent one (a row without its carry evidence, a trace read from the wrong directory).
 */
function walltimeRow(payload) {
  if ((payload.runId === undefined) === (payload.timing === undefined)) {
    throw new Error("walltime action 'row' requires exactly one of the payload keys 'runId' or 'timing'");
  }
  if (payload.timing !== undefined && payload.cwd !== undefined) {
    throw new Error("walltime action 'row' takes 'cwd' only with 'runId'");
  }
  const timing = payload.timing !== undefined ? payload.timing : loadReviewTiming({ runId: payload.runId, projectRoot: payload.cwd || process.cwd() });
  return rowFromTiming({
    timing,
    pr: payload.pr,
    tier: payload.tier,
    round: payload.round,
    origin: payload.origin,
    id: payload.id,
    source: payload.source,
    notes: payload.notes,
    carry: payload.carry,
  });
}

/**
 * Whether one current row's figures are what its trace says: the row's `run_id` names a trace under
 * <cwd>/.ensemble/state/toolchain/, and its wall time, chains and gate runs equal what `timing` derives from it (the same
 * derivation `walltime row` uses). Tier, round and origin are not in a trace, so they stay attested.
 */
function checkRowAgainstTrace(run, cwd) {
  if (typeof run.run_id !== 'string' || run.run_id === '') return { ok: false, reason: 'the row names no trace (run_id), so its figures cannot be re-derived' };
  let rebuilt;
  try {
    const timing = loadReviewTiming({ runId: run.run_id, projectRoot: cwd });
    rebuilt = rowFromTiming({ timing, pr: run.pr, tier: run.tier, round: run.round, origin: run.origin, id: run.id });
  } catch (error) {
    return { ok: false, reason: `trace '${run.run_id}' cannot be read: ${error.message}` };
  }
  if (!rebuilt.ok) return { ok: false, reason: `trace '${run.run_id}' is not a readable review: ${rebuilt.reason}` };
  const differs = ['wall_min', 'chains', 'gate_runs', 'review_gate_spans'].filter((key) => (key === 'review_gate_spans' && !Object.prototype.hasOwnProperty.call(run, key) ? false : rebuilt.row[key] !== run[key]));
  const same = differs.length === 0;
  return same
    ? { ok: true }
    : { ok: false, reason: differs.map((key) => `${key} is ${JSON.stringify(run[key])}, its trace says ${JSON.stringify(rebuilt.row[key])}`).join('; ') };
}

/** `compare`: the module's grade, plus the trace check of every real current row. */
function walltimeCompare(payload) {
  const cwd = payload.cwd || process.cwd();
  const runs = isObject(payload.current) && Array.isArray(payload.current.runs) ? payload.current.runs : [];
  const traceChecks = {};
  for (const run of runs) {
    if (isObject(run) && typeof run.id === 'string' && run.origin === 'real') traceChecks[run.id] = checkRowAgainstTrace(run, cwd);
  }
  return compareWalltime({ baseline: payload.baseline, current: payload.current, traceChecks, targetFactors: payload.targetFactors });
}

const WALLTIME_ACTIONS = Object.freeze({
  summarize: {
    keys: { cohort: OBJECT },
    run: (p) => computeWalltimeCohort(p.cohort),
  },
  row: {
    keys: { pr: INTEGER, tier: TEXT, round: TEXT, origin: TEXT },
    optional: { runId: TEXT, cwd: TEXT, timing: OBJECT, id: TEXT, source: TEXT, notes: TEXT, carry: OBJECT },
    run: walltimeRow,
  },
  compare: {
    keys: { baseline: OBJECT, current: OBJECT },
    optional: { cwd: TEXT, targetFactors: OBJECT },
    run: walltimeCompare,
  },
});

function runWalltime(payload) {
  if (!isObject(payload)) throw new Error('walltime payload must be a JSON object');
  const name = payload.action;
  const action = typeof name === 'string' && hasOwn(WALLTIME_ACTIONS, name) ? WALLTIME_ACTIONS[name] : undefined;
  if (action === undefined) {
    throw new Error(`Unknown walltime action ${shown(name)}. Expected one of: ${Object.keys(WALLTIME_ACTIONS).join(', ')}`);
  }
  requireKeys(payload, action.keys, `walltime action '${name}'`);
  optionalKeys(payload, action.optional || {}, `walltime action '${name}'`);
  const known = ['action', ...Object.keys(action.keys), ...Object.keys(action.optional || {})];
  const extra = Object.keys(payload).filter((key) => !known.includes(key));
  if (extra.length > 0) {
    throw new Error(`walltime action '${name}' does not accept payload key(s) ${extra.map((key) => `'${key}'`).join(', ')}`);
  }
  return action.run(payload);
}

const HANDLERS = Object.freeze({
  scope: runScope,
  'review-range': runReviewRange,
  ledger: runLedger,
  remote: runRemote,
  status: runStatus,
  'state-read': runStateRead,
  'state-write': runStateWrite,
  policy: runPolicy,
  rules: runRules,
  paths: runPaths,
  description: runDescription,
  votes: runVotes,
  'verify-assign': runVerifyAssign,
  depth: runDepth,
  slices: runSlices,
  tier: runTier,
  mode: runMode,
  carry: runCarry,
  approvals: runApprovals,
  gate: runGate,
  'explainer-offer': runExplainerOffer,
  brief: runBrief,
  metrics: runMetrics,
  'metrics-compare': runMetricsCompare,
  'eval-score': runEvalScore,
  'eval-compare': runEvalCompare,
  'eval-stale': runEvalStale,
  reachability: runReachability,
  results: runResults,
  timing: runTiming,
  walltime: runWalltime,
});

/**
 * Entry point. Reads one JSON payload from stdin, dispatches to the
 * matching module, and prints exactly one JSON object to stdout. Returns
 * the process exit code (0 success, 1 failure). Never writes state when the
 * stdin JSON fails to parse -- parsing happens before any handler runs.
 *
 * @param {string[]} argv  argv WITHOUT node + script (process.argv.slice(2))
 * @returns {number}
 */
function main(argv) {
  const subcommand = Array.isArray(argv) ? argv[0] : undefined;
  const handler = typeof subcommand === 'string' && hasOwn(HANDLERS, subcommand) ? HANDLERS[subcommand] : undefined;

  if (handler === undefined) {
    process.stdout.write(
      JSON.stringify({
        error: `Unknown subcommand ${shown(subcommand)}. Usage: pr-review-cli <scope|review-range|ledger|remote|status|state-read|state-write|policy|rules|paths|description|votes|verify-assign|depth|slices|tier|mode|carry|approvals|gate|explainer-offer|brief|metrics|metrics-compare|eval-score|eval-compare|eval-stale|reachability|results|timing|walltime> < payload.json`,
      }) + '\n'
    );
    return 1;
  }

  let payload;
  try {
    payload = readStdinJson();
  } catch (err) {
    process.stdout.write(JSON.stringify({ error: `invalid JSON on stdin: ${err.message}` }) + '\n');
    return 1;
  }

  try {
    const result = handler(payload);
    // REQ-024/AC-024-2: this stdout is the text that becomes a finding, a PR
    // comment or a ledger entry, so a credential a reviewer was shown must not
    // survive it. Redaction belongs at the one output boundary rather than in
    // each handler: a subcommand added later is covered without anyone
    // remembering to ask. `redact` is the same deep, key-aware pass already
    // applied before anything touches disk.
    const json = JSON.stringify(redact(result));
    if (typeof json !== 'string') {
      throw new Error('Result was not JSON-serializable');
    }
    process.stdout.write(json + '\n');
    return 0;
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    // An error message echoes the payload that caused it, so it is redacted
    // on the same terms as a success.
    process.stdout.write(JSON.stringify({ error: redact(message) }) + '\n');
    return 1;
  }
}

module.exports = {
  runScope,
  runReviewRange,
  runLedger,
  runRemote,
  runStatus,
  runStateRead,
  runStateWrite,
  runPolicy,
  runRules,
  runPaths,
  runDescription,
  runVotes,
  runVerifyAssign,
  runDepth,
  runSlices,
  runTier,
  runMode,
  runCarry,
  runApprovals,
  runGate,
  runExplainerOffer,
  runBrief,
  runMetrics,
  runMetricsCompare,
  runEvalScore,
  runEvalCompare,
  runEvalStale,
  runResults,
  runTiming,
  LEDGER_ACTIONS,
  HANDLERS,
  main,
};

if (require.main === module) {
  const code = main(process.argv.slice(2));
  process.exit(code);
}
