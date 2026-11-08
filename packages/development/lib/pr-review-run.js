'use strict';

/**
 * pr-review-run.js -- the light-mode review runner (kata znd1, epic ptqb, plan section 3G). LOGIC ONLY.
 *
 * A script cannot dispatch model agents. It CAN do every mechanical step of a light review and hand the model exactly
 * two jobs: start the agents a manifest names, and call `collect` again. This module is those steps, over injected
 * `deps`; it has no file system, process or network access of its own. `review-run-cli.js` supplies the real deps
 * (review-precheck-cli's `makeDeps` for `gh`/`git` reads, `prepareReview`, the result files, `writeState`, the tracer).
 *
 *   prepareRun(input, deps)   precheck -> prepare -> tier -> mode -> depth -> slices -> briefs -> DISPATCH (round review)
 *   collectRun(input, deps)   head check -> collect the outstanding wave -> (next wave | verify round | finalise)
 *
 * Statuses (stdout of the CLI; exit 0 when ok):
 *   ok:true   DISPATCH | PENDING | TRIAGE | DONE | ADJUDICATE       (TRIAGE: full mode only)
 *   ok:false  NEEDS_FULL_MODE | RUN_INVALIDATED | RUN_FAILED
 *
 * What this module never does -- each is a guard with a test:
 *   - The review's overall status is never computed here: `reviewStatus` is `deriveStatus` over real facts, nothing else,
 *     and the runner never supplies the remote phase, so it can never report a finished review by itself.
 *   - It never edits the reviewed tree and never pushes: its only git calls are `merge-base` and `rev-parse`, its only
 *     gh write is the precheck's one PR comment, everything it writes lives under `.ensemble/pr-review/`.
 *   - It never sets a ledger `resolution`, `cleared`, `blocking:false` or a waiver; an agent that writes one has it
 *     stripped. An adjudication (`fix` | `deferred` | `not-applicable`) is applied only to findings listed for adjudication
 *     and can never close an Important or security finding beyond what `isActionable` and the gate allow.
 *   - A head that moved is never reviewed on: RUN_INVALIDATED, nothing written to the ledger, the gate or the state report.
 *     That holds for a FINISHED run too: its stored answer is returned only while the live head is the reviewed one on an
 *     OPEN PR (collect re-reads the PR first), and a PR that is not OPEN gets no run and no verdict at all.
 *   - A head from outside this repository (a fork, or a repository GitHub did not state) is refused by name before anything
 *     is fetched, prepared, run or posted; a baseSha other than the merge base is refused (RUN_FAILED, no run).
 *   - A reviewer's `pre-existing` severity is a claim, borne out only by the diff and the head: on a changed line, on a path
 *     that names no regular file of the head (a mis-spelled, mis-cased or invented path, a symlink) or on a line past the end of
 *     that file, it is graded Important.
 *   - An agent that did not arrive is never read as reviewed: its slice is in `notReviewed`, a verifier's candidates are
 *     `unverified`, a missing security lane is not `clean`.
 *   - A candidate whose verifier brief the renderer refuses (a claim that reads as a vote, a verdict, the orchestrator or a
 *     conclusion, a path or location outside the closed grammar, an unusable claim) is never verified, never dropped and never
 *     read as verified: it is planned out of the verification round (K verifiers for every OTHER candidate still hold), recorded in
 *     `notReviewed.unbriefable` with the renderer's reason and its `kind`, and its ledger entry says `unverified` /
 *     `unbriefable` with no tally, no assigned verifier and no vote: nobody was asked. The renderer's rules never move to make a
 *     run complete; what moves is the claim: reviewers are told the rules in their output contract, a full run's TRIAGE answer
 *     names the refused candidates (the orchestrator may ADD a candidate whose claim the brief accepts), and a person decides
 *     the rest (kata 0g9n).
 *   - An unreadable, ambiguous, raised, High or sensitive tier selects FULL mode, which runs in this same runner (Deep depth,
 *     the security lane, a model-orchestrator TRIAGE stop, the re-review scope rule: pr-review-full.js). The mode comes from
 *     `selectMode` alone and is stored in the run. Every later call only CHECKS that label against `selectMode` over the tier
 *     the run stores (`modeInvariant`): a label rewritten to light, removed or unknown is RUN_FAILED `mode-invariant`, never a
 *     new mode, so nothing here can lower a full run to light.
 *     NEEDS_FULL_MODE is left for a LIGHT run whose brief the renderer refuses (nothing dispatched; the narrated procedure). A
 *     FULL run whose brief the renderer refuses is RUN_FAILED `brief-refused` and its answer states the decision (`decision`:
 *     never lowered to light, no verdict) and the way forward (`fallback`): the runner offers no narrated route for it itself.
 *
 * HONEST LIMITS: the runner computes and records agent deadlines and the concurrency cap, and cannot enforce either;
 * whoever dispatches must stop an agent at `deadlineAtIso` and keep to `maxConcurrentAgents`. The tier comes from the
 * changed paths alone (no classifier or second assessor), so a path-only reading can raise a tier but never lower one.
 * Coverage is the agents' own report (`pathsReviewed`) and their read-only access an instruction nobody here enforces. The
 * baseline test run (head code) happens inside prepare, before the tier is known. `agentAuthored` is the caller's word.
 * `run.json` is local, unauthenticated state: `modeInvariant` refuses a stored run whose mode label is not `selectMode`'s answer
 * for the tier it stores, and a FULL run whose depth, verifier count or lane was lowered. It cannot tell a run whose tier,
 * label, depth and lane were all rewritten together from an honest light run, so whoever can write the run directory can
 * still choose the mode of a run that has not finished by rewriting all of them. The mode of a NEW run is only ever
 * `selectMode`'s.
 *
 * STAGE SPANS (kata k0sh): the run records, through `makeTracer`, exactly the span names `lib/pr-review-timing.js` reads (its
 * STAGES and STAGE_KINDS are imported, never respelled here): one `review` root per run (opened by prepare, closed by the call
 * that ends the run, so it is the orchestrator window), `review.head-read` (fetching the base and head and finding the merge
 * base), `review.gate` (the host reads and the gate), `review.verdict` (deriving the review status and recording it: the state
 * report, `final.json` and the run file) and one `review.<role>`
 * span per dispatched agent with its `agent` name and its `wave`. Every one carries `round` (1, or 2 when `lastReviewedSha`
 * makes it a delta re-review; the runner cannot know how many re-reviews came before). `wave` is the agent's place among the
 * dispatch groups of its kind (the review agents, then the verifiers): the cap splits a round's agents into waves, each
 * dispatched only after the one before was collected, so the reader sums the slowest reviewer of every review wave and the
 * slowest verifier of every verify wave instead of taking one slowest across them (the security lane is no step of that
 * chain: the reader names a lane that outlasts the reviewers of its wave and makes the total a lower bound). An agent span
 * opens when the agent is dispatched and closes when its result is collected, with
 * `last_message_ts` = the moment its result file arrived, so the agent counts to its last message and never to the collect
 * call or the session's exit. A result dated before the agent was dispatched is no message of this dispatch (a stale file):
 * none is stamped. One dated well after the collect call that read it (clock skew) cannot be placed, so it is stamped as it
 * is, the reader refuses that agent's interval, and `deps.notices` says so in both cases. The verdict span ends ok when the
 * verdict was recorded and error when that attempt did not get that far (a failed state write, a throw); the reader takes an
 * error span for no verdict, so a collect retried after a failure leaves ONE verdict in the window (two would leave the
 * critical path without the verdict that ends its chain). An adjudication after the root has closed re-runs the gate and the
 * verdict outside the window, which the reader leaves out. HONEST LIMITS: the root opens after the
 * first read of the PR head (the run id depends on it), and does not record `turns` or `tool_calls` (the runner cannot see the
 * model). A trace file that already holds another `review` root (a second run sharing `traceRunId`) has no usable window: give
 * each run its own trace.
 *
 * SIZE (kata sfpb): what an agent has to read decides how it is planned. `planRunSlices` cuts the changed paths into slices of at
 * most `sliceMaxFiles` paths and about `sliceTargetLines` changed lines (policy keys; defaults derived from the one real full-mode
 * run, `lib/pr-review-sizing.js`), never more slices than let the whole review round, security lane included, run in ONE wave at
 * `maxConcurrentAgents` (the lane is the longest agent: it must not wait behind a wave of reviewers). With several slices each
 * reviewer's brief names a diff of ITS slice (`slices/slice-<n>.diff`), not the whole range. An agent's deadline is the policy's
 * `deadlineMinutes` as a floor, raised to the modelled time to read what it was given (a reviewer: its slice; the lane: every
 * changed path), with headroom, at most 60 minutes. Everything is recorded in `run.sizing` and the DISPATCH manifest, and nothing
 * relaxes a fail-closed rule: an agent that arrives after its (larger) deadline is `expired`, a reviewer that lists fewer paths
 * than its slice leaves the slice not reviewed, a slice or deadline the limits cannot hold is a recorded warning and not a pass.
 *
 * A light run cut into several slices has no TRIAGE step, so it gets ONE more reviewer, `reviewer-range`: the whole range diff, every
 * changed path, one lens, graded like any reviewer (a failed read is its own `whole-range` entry among the unreviewed slices). It is
 * planned only when the cap holds it beside the slices and the lane (`slices x lenses + lane + 1 <= maxConcurrentAgents`): a slice
 * that fits the limits is never given up for it, and the plan says (`reader-not-planned`) when it is left out.
 *
 * deps (every function may be async):
 *   now()                                    epoch ms
 *   makeTracer(traceRunId)                   -> {startSpan(name,{kind,attrs}), endSpan(id,{status,attrs})}   (never throws)
 *   readPr()                                 -> {ok, headSha, baseRefName, state, body, author, isCrossRepository}
 *   readReviews() / readProtection(base)     -> {ok, reviews} / {ok, notProtected?, protection?}
 *   git(args)                                -> {status, stdout, stderr}          (argv array, run in the repository)
 *   fetchRefs({headSha, baseRefName})        -> {ok} | {ok:false, error}          (fetch base and head)
 *   precheck({dryRun})                       -> a runPrecheck result
 *   prepareReview(options)                   -> a prepareReview result
 *   collectResults(input)                    -> a collectResults result            (real fs lives in the CLI)
 *   renderBrief(role, vars)                  -> markdown; THROWS when the renderer refuses an input
 *   writeState(path, state)                  -> {ok, path|reason}
 *   fs.{mkdirp(dir,mode), writeAtomic(file,text,mode), readText(file) -> string|null}
 *   fs.headFile(root, rel)                   -> {lines}|null     the regular file `rel` names in the head snapshot `root`, exactly spelled, never followed
 *   redact(value)                            optional deep redaction applied to everything written or returned
 *   notices                                  optional array a note for the caller is pushed to (the CLI adds it to the answer's `warnings`)
 */

const path = require('path');

const { isValidRunId } = require('./toolchain/run-id');
const { assignTier, effectiveTier, tierRecord } = require('./pr-review-tier');
const { selectMode } = require('./pr-review-mode');
const { planSlices, verifyCoverage } = require('./pr-review-depth');
const { reviewDeadlines, toVotesInput } = require('./pr-review-results');
const { DEFAULT_POLICY, DEADLINE_MINUTES_MAX } = require('./pr-review-policy');
const SZ = require('./pr-review-sizing');
const { dedupeFindings, isActionable, normalizeSeverity, validateLedger } = require('./pr-review-ledger');
const { tallyVotes } = require('./pr-review-votes');
const { evaluateApprovals } = require('./pr-review-approvals');
const { checkDescription } = require('./pr-review-description');
const { evaluateGate, SECURITY_REQUIRED_TIERS } = require('./pr-review-gate');
const { buildDispositionChoices } = require('./pr-review-disposition');
const { buildCoverage } = require('./pr-review-coverage');
const { deriveStatus } = require('./pr-review-status');
const { statePath } = require('./pr-review-state');
const { assessProtection } = require('./pr-review-precheck');
const { REFUSAL_KINDS } = require('./pr-review-briefs');
const S = require('./pr-review-run-support');
const F = require('./pr-review-full');
const { STAGES, STAGE_KINDS } = require('./pr-review-timing');

const SCHEMA = 1;
const RUN_SUBDIR = path.join('.ensemble', 'pr-review', 'run');
const LANE_NAME = 'security-lane';
const LANE_COVERAGE_SLICE = 'security-lane-coverage';
const DEFAULT_MAX_CONCURRENT = 8;
/** The whole-range reader (a light run cut into several slices): its agent name, and the id its coverage is kept under (never one of the plan's slices). */
const RANGE_NAME = 'reviewer-range';
const RANGE_COVERAGE_SLICE = 'whole-range';
const SHA = /^[0-9a-f]{40}$/;
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const ADJUDICATION_DISPOSITIONS = Object.freeze(['fix', 'deferred', 'not-applicable']);

const PREPARE_KEYS = Object.freeze(['repo', 'pr', 'repoRoot', 'runId', 'traceRunId', 'baseSha', 'lastReviewedSha', 'remediationShas', 'dryRun', 'skipPrecheck', 'testFiles', 'testCommand', 'baselineTimeoutMs', 'nodeModules', 'stateRoot', 'agentAuthored']);
const COLLECT_KEYS = Object.freeze(['repoRoot', 'runId', 'now', 'adjudications', 'triage']);

const RULES = Object.freeze([
  'Start exactly the agents of `agents`, in fresh contexts with READ-ONLY access, and pass each `prompt` through unedited; compose nothing yourself.',
  'Never run more agents at once than `maxConcurrentAgents`. The runner records the cap and cannot enforce it: the dispatcher must.',
  'Stop every agent at its `deadlineAtIso`. The runner records the deadline and cannot stop an agent: the dispatcher must. A result written later is not read.',
  'When the agents are done (or their deadlines have passed), call `collect`. Never read a result file, tally votes or decide a gate yourself.',
  'On ADJUDICATE decide only the findings listed, with a reason, and call `collect` with `adjudications`.',
  'Coverage is self-reported: the runner counts a slice as reviewed when the agent lists its paths in `pathsReviewed`, and cannot tell a read from a claim. Read-only access is an instruction in the prompt that the runner cannot enforce: the dispatcher must.',
]);

/** What a TRIAGE answer tells the orchestrating model, on top of RULES. */
const TRIAGE_RULES = Object.freeze([
  'This is a FULL-mode run: nothing is dispatched on this answer. Read the candidates, the coverage and the security lane, then call `collect` again with `triage`.',
  'Triage can only ADD candidates the reviewers missed (for example an interaction between slices): `{"triage":{"additionalCandidates":[{"locationOrLink":"path/file.js:12","failureMode":"what goes wrong","severity":"important|nit","evidence":"what you read"}]}}`. `{"triage":{}}` adds none. A location must be a line of a regular file of the head, named by a repository-relative path; an entry that matches a candidate a verifier will be asked about is dropped and theirs stays as it was. Every entry must also be one a verifier can be briefed with: an entry the verifier brief refuses (for example a claim that reads as a vote, a verdict, the orchestrator or a conclusion, or a path with whitespace) is refused as `triage-refused`, naming the entry and why, and nothing of that payload is kept: reword it or leave it out.',
  'A candidate marked `unbriefable` (its `kind` and `reason` are given) will NOT be put to any verifier: the verifier brief refuses what it carries, so it stays in the ledger as `unverified` and a person decides it. You cannot reword or remove it. If the defect is real and worth an independent check, ADD a candidate for it whose claim the verifier brief accepts (say what goes wrong in plain words about the code, avoiding what the reason names): it is verified like any other, and the unbriefable one stays as it is.',
  'Every candidate, yours included, is then settled by independent fresh-context verifiers who are briefed with the claim and its location only. You can not remove, merge away, re-grade, close or waive a candidate, mark a slice reviewed, or decide a verdict: the gate and whether the review is complete are computed by the runner alone.',
  'A `collect` without `triage` repeats this answer; the run cannot reach verification without it.',
]);

/**
 * What a FULL run whose brief the renderer refuses says in its RUN_FAILED answer. Before full mode ran in this runner every
 * full PR answered NEEDS_FULL_MODE and the narrated Steps 1-10 applied; a full run that cannot be briefed now fails closed
 * (never lowered to light, never run without briefs), and the answer states that decision and the operator's way forward, so
 * a bare RUN_FAILED is not left to be read as a dead end. A LIGHT run's NEEDS_FULL_MODE carries neither: the narrated
 * procedure is its route, and its name says so.
 */
const FULL_BRIEF_REFUSED = Object.freeze({
  decision: 'Full mode fails closed: a run whose brief the renderer refuses is never lowered to light mode and never run without that brief; nothing was dispatched, so this runner gives no review and no verdict for this pull request.',
  fallback: 'Either change what the renderer refused (for example rename the path it names) and start a new run, or review this pull request by hand: the narrated Steps 1-10 of the pr-review-cycle skill are the manual procedure, and the CLI `brief` they use is the same renderer, so it refuses the same input.',
});

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isText = (value) => typeof value === 'string' && value.trim() !== '';
const msg = (error) => (error && error.message ? error.message : String(error));

/* ------------------------------------------------------------------ plumbing */

const failure = (status, fields) => ({ ok: false, status, ...fields });
const redactor = (deps) => (typeof deps.redact === 'function' ? deps.redact : (value) => value);

/** A PR the host does not state as exactly OPEN gets no review and no verdict. */
const notOpen = (state, runId, headSha) => failure('RUN_FAILED', { reason: 'pr-not-open', error: `the pull request is ${JSON.stringify(state)}, not OPEN`, prState: state, ...(runId === undefined ? {} : { runId }), ...(headSha === undefined ? {} : { headSha }) });

const runDirOf = (repoRoot, runId) => path.join(repoRoot, RUN_SUBDIR, runId);

function noopTracer() {
  return { startSpan: () => null, endSpan: () => false };
}

/** A tracer that can never throw, whatever the injected one does. */
function safeTracer(deps, traceRunId) {
  let tracer;
  try {
    tracer = typeof deps.makeTracer === 'function' ? deps.makeTracer(traceRunId) : noopTracer();
  } catch (_error) {
    tracer = noopTracer();
  }
  return {
    start(name, kind, attrs) {
      try {
        return tracer.startSpan(name, { kind, attrs });
      } catch (_error) {
        return null;
      }
    },
    end(spanId, status, attrs) {
      if (spanId === null || spanId === undefined) return;
      try {
        tracer.endSpan(spanId, { status, attrs });
      } catch (_error) {
        // tracing never fails the run
      }
    },
  };
}

async function settle(fn) {
  try {
    return await fn();
  } catch (error) {
    return { ok: false, error: msg(error) };
  }
}

/** The PR's head as the host states it now: a full sha, or the reason it could not be read. */
async function readHead(deps) {
  const pr = await settle(() => deps.readPr());
  if (!isObject(pr) || pr.ok !== true) return { ok: false, error: isObject(pr) && isText(pr.error) ? pr.error : 'the pull request could not be read' };
  const headSha = typeof pr.headSha === 'string' ? pr.headSha.toLowerCase() : '';
  if (!SHA.test(headSha)) return { ok: false, error: 'the pull request reports no usable head commit' };
  return { ok: true, headSha, pr };
}

function saveRun(deps, run) {
  const dir = runDirOf(run.repoRoot, run.runId);
  deps.fs.mkdirp(dir, 0o700);
  deps.fs.writeAtomic(path.join(dir, 'run.json'), `${JSON.stringify(redactor(deps)(run), null, 2)}\n`, 0o600);
}

function loadRun(deps, repoRoot, runId) {
  const text = deps.fs.readText(path.join(runDirOf(repoRoot, runId), 'run.json'));
  if (text === null) return null;
  try {
    const run = JSON.parse(text);
    return isObject(run) && run.schema === SCHEMA && run.runId === runId ? run : undefined;
  } catch (_error) {
    return undefined;
  }
}

/** The hunks of the prepared range diff, or null when it cannot be read (a claim that needs it is then not borne out). */
function readDiffIndex(deps, file) {
  try {
    const text = typeof file === 'string' ? deps.fs.readText(file) : null;
    return text === null ? null : S.parseDiffHunks(text);
  } catch (_error) {
    return null;
  }
}

function logCall(run, call, startedAt, deps, adjudication = false, flags = {}) {
  run.calls = Array.isArray(run.calls) ? run.calls : [];
  run.calls.push({ call, startedAt, endedAt: deps.now(), ...(adjudication ? { adjudication: true } : {}), ...flags });
}

/** Records a terminal phase with its answer, so every later call repeats it. */
function terminate(run, phase, answer, call, startedAt, deps) {
  run.phase = phase;
  run.result = answer;
  logCall(run, call, startedAt, deps);
  saveRun(deps, run);
  return answer;
}

/* ------------------------------------------------------------------- prepare */

function validatePrepare(input) {
  if (!isObject(input)) return 'the payload must be a JSON object';
  for (const key of Object.keys(input)) if (!PREPARE_KEYS.includes(key)) return `unknown payload key ${JSON.stringify(key)}`;
  if (!isText(input.repo) || !REPO.test(input.repo)) return 'repo must be "owner/name"';
  if (!Number.isInteger(input.pr) || input.pr < 1) return 'pr must be a positive integer';
  if (!isText(input.repoRoot) || !path.isAbsolute(input.repoRoot)) return 'repoRoot must be an absolute path';
  for (const key of ['runId', 'traceRunId', 'nodeModules', 'stateRoot']) if (input[key] !== undefined && !isText(input[key])) return `${key} must be a non-empty string`;
  for (const key of ['baseSha', 'lastReviewedSha']) if (input[key] !== undefined && !SHA.test(String(input[key]))) return `${key} must be a full 40-hex object id`;
  if (input.remediationShas !== undefined && !(Array.isArray(input.remediationShas) && input.remediationShas.every((s) => SHA.test(String(s))))) return 'remediationShas must be full object ids';
  for (const key of ['dryRun', 'skipPrecheck', 'agentAuthored']) if (input[key] !== undefined && typeof input[key] !== 'boolean') return `${key} must be true or false`;
  if (input.testFiles !== undefined && !(Array.isArray(input.testFiles) && input.testFiles.every(isText))) return 'testFiles must be an array of paths';
  if (input.testCommand !== undefined && !(Array.isArray(input.testCommand) && input.testCommand.length > 0 && input.testCommand.every(isText))) return 'testCommand must be a non-empty argv array';
  if (input.baselineTimeoutMs !== undefined && !(Number.isInteger(input.baselineTimeoutMs) && input.baselineTimeoutMs > 0)) return 'baselineTimeoutMs must be a positive integer';
  return null;
}

function summarisePrecheck(result) {
  if (!isObject(result)) return { ok: false, error: 'the precheck returned nothing' };
  const comment = isObject(result.comment) ? { action: result.comment.action, id: result.comment.id, url: result.comment.url, error: result.comment.error } : undefined;
  return {
    ok: result.ok === true,
    error: result.error,
    stage: result.stage,
    blockers: result.blockers,
    notEstablished: result.notEstablished,
    approvals: result.approvals,
    description: result.description,
    protection: result.protection,
    gate: result.gate,
    comment,
  };
}

/** The changed lines of one `numstat` entry: added plus deleted (a binary file holds none). */
const changedLines = (entry) => (entry.added || 0) + (entry.deleted || 0);

/**
 * Plans the review round's slices from the size model (kata sfpb): every slice holds at most `sliceMaxFiles` paths and about
 * `sliceTargetLines` changed lines, so a reviewer can reach every path of it, and there are never more slices than let the WHOLE
 * round (every lens of every slice, and the security lane) run in one wave at `maxConcurrentAgents`. When that ceiling is lower
 * than the limits need, a slice is bigger than the limits say: the plan records it (`slice-over-limit`, with the number of agents
 * that would hold the limits) and still plans every path, so an agent that does not reach all of its paths is reported not
 * reviewed like any other. Quick is one reviewer and one slice whatever the size, so nothing is over its limits.
 *
 * Returns the `planSlices` refusal as it is, or `{ ok: true, plan, sizing }`: `plan` is the `planSlices` answer, `sizing` the
 * record stored in the run and shown in the manifest.
 */
function planRunSlices(run, numstat) {
  const resolved = SZ.resolveSizing(run.policy, DEFAULT_POLICY);
  const paths = numstat.map((entry) => ({ path: entry.path, lines: changedLines(entry) }));
  const lenses = run.depth.reviewersPerSlice;
  const lane = run.securityLane ? 1 : 0;
  // The slices come first: as many as the limits ask for, never more than let the whole round (every lens of every slice, and the
  // lane) run in ONE wave. A light run (it has no TRIAGE step) cut into several slices then gets ONE whole-range reader beside them,
  // the one non-security reader of the whole diff, but only when the cap holds it as well: a slice that fits the limits is never given
  // up for it, and the plan says so when it is left out (`reader-not-planned`).
  const quick = run.depth.mode === 'quick';
  const light = !quick && isObject(run.mode) && run.mode.mode === 'light';
  const maxSlices = Math.max(1, Math.floor((run.maxConcurrentAgents - lane) / lenses));
  const request = {
    paths,
    threshold: run.policy && Number.isInteger(run.policy.sliceThreshold) ? run.policy.sliceThreshold : undefined,
    mode: run.depth.mode,
    lensesPerSlice: lenses,
    targetLines: resolved.targetLines,
    maxFiles: resolved.maxFiles,
  };
  const plan = planSlices({ ...request, maxSlices });
  if (plan.ok !== true) return plan;
  // the same request with room for every slice the limits ask for (at most one per path): what the cap kept from the plan
  const wanted = planSlices({ ...request, maxSlices: Math.max(1, paths.length) });
  const cut = light && plan.slices.length > 1;
  const withReader = plan.slices.length * lenses + lane + 1;
  const reader = cut && withReader <= run.maxConcurrentAgents;
  const wantedReader = light && wanted.slices.length > 1;
  const slices = plan.slices.map((slice) => ({
    id: slice.id,
    files: slice.paths.length,
    lines: slice.lines,
    overLimit: !quick && (slice.paths.length > resolved.maxFiles || (slice.paths.length > 1 && slice.lines > resolved.targetLines)),
  }));
  const warnings = resolved.warnings.map((code) => ({ code, message: `the policy's ${code.slice('invalid-'.length)} is not readable, so the default applies` }));
  // a value the policy loader rejected never reaches `run.policy` (the default stands in its place): name it here, so the verdict says so
  const SIZING_KEYS = ['sliceMaxFiles', 'sliceTargetLines', 'deadlineHeadroom'];
  for (const rejected of Array.isArray(run.policyRejected) ? run.policyRejected : []) {
    if (!isObject(rejected) || !SIZING_KEYS.includes(rejected.key)) continue;
    warnings.push({ code: `invalid-${rejected.key}`, message: `the policy's ${rejected.key} (${JSON.stringify(rejected.value)}) was rejected (${rejected.reason}), so the default applies` });
  }
  const over = slices.filter((slice) => slice.overLimit);
  if (over.length > 0) {
    const agents = wanted.slices.length * lenses + lane + (wantedReader ? 1 : 0);
    warnings.push({
      code: 'slice-over-limit',
      message: `slice ${over.map((slice) => slice.id).join(', ')} hold${over.length === 1 ? 's' : ''} more than ${resolved.maxFiles} paths or ${resolved.targetLines} changed lines: those limits need ${wanted.slices.length} slices (${agents} agents at once${wantedReader ? ', the whole-range reader among them' : ''}), and the concurrency cap of ${run.maxConcurrentAgents} allows ${maxSlices} slices of ${lenses} lenses${lane === 1 ? ' beside the security lane' : ''}; raise maxConcurrentAgents to ${agents} (the policy allows at most 32) to hold them. A reviewer that does not reach every path of its slice is reported not reviewed`,
    });
  }
  if (cut && !reader) {
    warnings.push({
      code: 'reader-not-planned',
      message: `no whole-range reader is planned: ${plan.slices.length} slices of ${lenses} lenses${lane === 1 ? ' and the security lane' : ''} make ${withReader - 1} agents at once, the concurrency cap is ${run.maxConcurrentAgents} and the reader would be one more; raise maxConcurrentAgents to ${withReader} (the policy allows at most 32) to add it`,
    });
  }
  const sizing = {
    model: { ...SZ.MODEL, headroom: resolved.headroom, maxMinutes: DEADLINE_MINUTES_MAX, derivedFrom: SZ.OBSERVED.run },
    limits: { sliceMaxFiles: resolved.maxFiles, sliceTargetLines: resolved.targetLines, slicesAllowed: maxSlices, slicesWanted: wanted.slices.length },
    work: { files: paths.length, lines: plan.totalLines },
    slices,
    wholeRangeReader: reader,
    warnings,
  };
  return { ok: true, plan, sizing };
}

/**
 * The diff file each slice's reviewers are handed. With one slice it is the range diff itself. With several it is the slice's own
 * hunks (`slices/slice-<n>.diff` in the run directory), so the slice is the unit of work the reviewer brief says it is. A slice
 * whose paths cannot all be placed in the diff, a diff that cannot be read and a file that cannot be written leave the slice the
 * WHOLE range diff: more to read, never less. Which each slice got is recorded in `run.sizing.slices[n].diff`.
 */
function sliceDiffFiles(run, deps, dir) {
  const whole = run.prepared.rangeDiff;
  const files = run.slices.map(() => whole);
  for (const entry of run.sizing.slices) entry.diff = 'whole-range';
  if (run.slices.length <= 1) return files;
  let text = null;
  try {
    text = typeof whole === 'string' ? deps.fs.readText(whole) : null;
  } catch (_error) {
    text = null;
  }
  const cut = text === null ? null : S.splitDiffBySlice(text, run.slices);
  if (cut === null) return files;
  cut.forEach((entry, index) => {
    if (entry.missing.length > 0 || entry.text === '') return;
    const file = path.join(dir, 'slices', `slice-${index + 1}.diff`);
    try {
      deps.fs.mkdirp(path.dirname(file), 0o700);
      deps.fs.writeAtomic(file, entry.text, 0o600);
    } catch (_error) {
      return;
    }
    files[index] = file;
    run.sizing.slices[index].diff = 'slice';
  });
  return files;
}

/** Builds the review round's agents and writes their brief files. Throws the renderer's refusal. */
function buildReviewAgents(run, deps, ctx) {
  const dir = runDirOf(run.repoRoot, run.runId);
  const agents = [];
  const diffs = sliceDiffFiles(run, deps, dir);
  // The deadline the agent is given at dispatch (`dispatchWave` asks the same question of the same inputs), so a brief's timebox is
  // its deadline. A modelled need over the maximum is capped and said, once per slice or lane.
  const deadline = (agent, work, label) => {
    const answer = reviewDeadlines({ role: agent.role, now: ctx.now, tier: run.tier.effectiveTier, depth: run.depth.mode, policy: run.policy, work });
    if (answer.ok !== true) throw new Error(`no deadline for ${agent.name}: ${answer.reason}`);
    if (answer.sizing !== undefined && answer.sizing.capped) {
      const message = `${label}: reading ${work.files} paths and ${work.lines} changed lines is modelled at ${answer.sizing.modeledMinutes} minutes, over the ${DEADLINE_MINUTES_MAX}-minute maximum, so its deadline is capped at ${DEADLINE_MINUTES_MAX} minutes; if it does not arrive in time it is reported not reviewed`;
      if (!run.sizing.warnings.some((warning) => warning.message === message)) run.sizing.warnings.push({ code: 'deadline-capped', message });
    }
    return answer;
  };
  // What a reviewer may spend (policy `reviewerToolCalls`, `reviewerSnippets`; the default when the policy holds neither).
  const stated = (key, fallback) => (run.policy && Number.isInteger(run.policy[key]) ? run.policy[key] : fallback);
  // a REVIEW.md whose Severity section could not be read is NAMED, never replaced by the built-in copy in silence ('no-rules-file' is the documented defaults)
  if (run.severityGuide === null && run.severityGuideProblem !== null && run.severityGuideProblem !== 'no-rules-file') {
    run.sizing.warnings.push({ code: 'severity-guide-fallback', message: `REVIEW.md at the base has no readable Severity section (${run.severityGuideProblem}), so the reviewers are given the built-in copy of the severity words, not your edit; fix the section (a "## Severity" heading with one "- **Important** ...", "- **Nit** ..." and "- **Pre-existing** ..." bullet, under 2000 characters)` });
  }
  const budget = { toolCalls: stated('reviewerToolCalls', DEFAULT_POLICY.reviewerToolCalls), snippets: stated('reviewerSnippets', DEFAULT_POLICY.reviewerSnippets) };
  run.slices.forEach((slice, sliceIndex) => {
    // a reviewer handed the WHOLE range diff (its slice could not be cut from it) reads the whole diff: its deadline is sized for that
    const wholeDiff = run.slices.length > 1 && run.sizing.slices[sliceIndex].diff === 'whole-range';
    const work = wholeDiff ? { files: run.changedPaths.length, lines: run.sizing.work.lines } : { files: slice.paths.length, lines: slice.lines };
    // one reviewer per (slice, lens) pass; the lenses come from the shared plan (planSlices), the names stay `reviewer-s<n>-<a|b|..>`
    run.assignments.filter((assignment) => assignment.sliceId === slice.id).forEach((assignment, lensIndex) => {
      const agent = { name: `reviewer-s${sliceIndex + 1}-${S.LENSES[lensIndex]}`, role: 'reviewer', sliceId: slice.id, lens: assignment.lens, paths: slice.paths, work, _role: 'reviewer' };
      agent._vars = { slice: slice.id, lens: assignment.lens, timeboxMinutes: deadline(agent, work, `slice ${slice.id}`).minutes, ...budget, paths: slice.paths, diffPath: diffs[sliceIndex], snapshotDir: run.prepared.snapshotDir };
      agents.push(agent);
    });
  });
  if (run.sizing.wholeRangeReader === true) {
    const work = { files: run.changedPaths.length, lines: run.sizing.work.lines };
    const lens = run.assignments[0].lens;
    // its own brief (`range-reviewer`): the whole range, and what only a reader of the whole range can find
    const reader = { name: RANGE_NAME, role: 'reviewer', sliceId: RANGE_COVERAGE_SLICE, lens, paths: run.changedPaths, work, _role: 'range-reviewer' };
    reader._vars = { lens, timeboxMinutes: deadline(reader, work, 'the whole-range reader').minutes, ...budget, paths: run.changedPaths, diffPath: run.prepared.rangeDiff, snapshotDir: run.prepared.snapshotDir };
    agents.push(reader);
  }
  if (run.securityLane) {
    const work = { files: run.changedPaths.length, lines: run.sizing.work.lines };
    const lane = { name: LANE_NAME, role: 'security', sliceId: LANE_COVERAGE_SLICE, lens: 'security', paths: run.changedPaths, work, _role: 'security-lane', _vars: { range: `${run.baseSha}..${run.headSha}`, diffPath: run.prepared.rangeDiff, snapshotDir: run.prepared.snapshotDir, sensitivePaths: run.sensitivePaths } };
    deadline(lane, work, 'the security lane');
    agents.push(lane);
  }
  return agents.map((agent) => {
    const briefPath = path.join(dir, 'briefs', `${agent.name}.md`);
    const outPath = path.join(dir, 'results', 'review', `out-${agent.name}.json`);
    const { _vars, _role, ...record } = agent;
    const rendered = deps.renderBrief(_role, _vars);
    const full = { ...record, briefPath, outPath };
    deps.fs.mkdirp(path.dirname(briefPath), 0o700);
    deps.fs.writeAtomic(briefPath, `${rendered.replace(/\s*$/, '\n')}\n${S.reviewerContract(full, run.severityGuide)}`, 0o600);
    return full;
  });
}

/** Stamps a wave's agents with their dispatch time and deadline, opens their spans and makes their result directory. */
function dispatchWave(run, wave, now, deps, tracer) {
  const dispatched = [];
  const resultDir = path.join(runDirOf(run.repoRoot, run.runId), 'results', wave.round);
  deps.fs.mkdirp(resultDir, 0o700);
  for (const agent of wave.agents) {
    const deadline = reviewDeadlines({ role: agent.role, now, tier: run.tier.effectiveTier, depth: run.depth.mode, policy: run.policy, ...(agent.work === undefined ? {} : { work: agent.work }) });
    if (deadline.ok !== true) throw new Error(`no deadline for ${agent.name}: ${deadline.reason}`);
    agent.dispatchedAt = deadline.dispatchedAt;
    agent.deadlineAt = deadline.deadlineAt;
    agent.deadlineAtIso = deadline.deadlineAtIso;
    agent.deadlineMinutes = deadline.minutes;
    agent.prompt = S.agentPrompt(agent);
    const stage = stageOfAgent(agent);
    agent.spanId = tracer.start(stage, STAGE_KINDS[stage], { agent: agent.name, role: agent.role, round: run.round, wave: wave.wave });
    dispatched.push(agent);
  }
  wave.status = 'dispatched';
  wave.dispatchedAt = now;
  return dispatched;
}

function manifestOf(run, wave) {
  return {
    ok: true,
    status: 'DISPATCH',
    runId: run.runId,
    round: wave.round,
    wave: `${wave.wave} of ${wave.of}`,
    headSha: run.headSha,
    mode: run.mode,
    ...(run.reReview === undefined ? {} : { reReview: run.reReview }),
    tier: run.tier,
    depth: { mode: run.depth.mode, reviewersPerSlice: run.depth.reviewersPerSlice, verifiersPerCandidate: run.depth.verifiersPerCandidate, bounds: run.depth.bounds },
    maxConcurrentAgents: run.maxConcurrentAgents,
    ...(wave.round === 'review' && run.sizing !== undefined ? { sizing: run.sizing } : {}),
    agents: wave.agents.map((a) => ({
      name: a.name,
      role: a.role,
      briefPath: a.briefPath,
      outPath: a.outPath,
      prompt: a.prompt,
      dispatchedAt: a.dispatchedAt,
      deadlineAt: a.deadlineAt,
      deadlineAtIso: a.deadlineAtIso,
      ...(a.deadlineMinutes === undefined ? {} : { deadlineMinutes: a.deadlineMinutes }),
      ...(a.work === undefined ? {} : { work: a.work }),
      ...(a.sliceId !== undefined && a.role === 'reviewer' ? { sliceId: a.sliceId, paths: a.paths } : {}),
      ...(a.candidateIds !== undefined ? { candidateIds: a.candidateIds } : {}),
    })),
    next: `node review-run-cli.js collect  (payload {"repoRoot": ${JSON.stringify(run.repoRoot)}, "runId": ${JSON.stringify(run.runId)}})`,
    rules: run.mode && run.mode.mode === 'full' ? [...RULES, 'Full mode: when the review round is collected the runner answers TRIAGE, not a verify wave; follow its rules.'] : RULES,
  };
}

/** The span a dispatched agent is recorded under: `review.<role>`, the security lane being `review.security-lane`. */
function stageOfAgent(agent) {
  return agent.name === LANE_NAME ? STAGES['security-lane'] : STAGES[agent.role];
}

/** Closes the `review` root span (when one is open), whatever the run's outcome. */
function endRoot(tracer, rootSpanId, status, attrs) {
  if (tracer !== null && rootSpanId !== null && rootSpanId !== undefined) tracer.end(rootSpanId, status, attrs);
}

/**
 * Prepare. The `review` root span opens inside and stays open on DISPATCH (the run carries its id; collect closes it when the
 * run ends); every other outcome is the end of the run, so it is closed here.
 */
async function prepareRun(input, deps) {
  const ctx = { tracer: null, root: null };
  let answer;
  try {
    answer = await prepareStages(input, deps, ctx);
  } catch (error) {
    endRoot(ctx.tracer, ctx.root, 'error', { error: msg(error) });
    throw error;
  }
  if (!(isObject(answer) && answer.ok === true && answer.status === 'DISPATCH')) {
    endRoot(ctx.tracer, ctx.root, isObject(answer) && answer.ok === true ? 'ok' : 'error', { status: isObject(answer) ? answer.status : undefined });
  }
  return answer;
}

async function prepareStages(input, deps, ctx) {
  const startedAt = deps.now();
  const invalid = validatePrepare(input);
  if (invalid !== null) return failure('RUN_FAILED', { reason: 'invalid-input', error: invalid });

  const first = await readHead(deps);
  if (!first.ok) return failure('RUN_FAILED', { reason: 'pr-unreadable', error: first.error });
  const { headSha } = first;
  const baseRefName = first.pr.baseRefName;

  // The baseline runs the head's own test code on this machine and the reviewers read (and may run) the head's snapshot,
  // so a head from outside this repository is not reviewed here: the precheck refuses a fork for its gate the same way.
  // A head whose repository GitHub did not state is not "this repository" either. Refused by name, before anything is
  // fetched, prepared, posted or written.
  if (first.pr.isCrossRepository !== false) {
    const fork = first.pr.isCrossRepository === true;
    return failure('RUN_FAILED', {
      reason: fork ? 'cross-repository-head' : 'head-repository-unknown',
      error: fork
        ? 'the head of this pull request is on a fork, and the runner would run the head\'s own test code on this machine and hand its snapshot to agents, so it does not review a head from outside this repository; read the diff by hand'
        : 'GitHub did not say whether the head of this pull request is on this repository, and the runner runs the head\'s own test code on this machine, so it does not review it',
      headSha,
    });
  }

  // Only an open PR is reviewed: a merged or closed one gets no agents and no answer that could read as mergeable (the
  // precheck refuses it too, but its refusal is advisory here).
  if (first.pr.state !== 'OPEN') return notOpen(first.pr.state, undefined, headSha);

  const runId = input.runId !== undefined ? input.runId : `pr${input.pr}-${headSha.slice(0, 12)}-${Math.floor(startedAt / 1000)}`;
  if (!isValidRunId(runId)) return failure('RUN_FAILED', { reason: 'invalid-runId', error: `runId ${JSON.stringify(runId)} is not file-name safe (letters, digits, "_", "-"; no dots)` });
  const traceRunId = input.traceRunId !== undefined ? input.traceRunId : runId;
  if (deps.fs.readText(path.join(runDirOf(input.repoRoot, runId), 'run.json')) !== null) {
    return failure('RUN_FAILED', { reason: 'run-exists', error: `run ${runId} already exists; call collect, or choose another runId` });
  }
  const tracer = safeTracer(deps, traceRunId);
  const round = input.lastReviewedSha === undefined ? 1 : 2;
  ctx.tracer = tracer;
  ctx.root = tracer.start(STAGES.root, STAGE_KINDS[STAGES.root], { pr: input.pr, round, headSha });

  // 2. precheck (advisory: a failed precheck never stops the review)
  let precheck;
  if (input.skipPrecheck === true) {
    precheck = { skipped: true, reason: 'requested' };
  } else {
    precheck = summarisePrecheck(await settle(() => deps.precheck({ dryRun: input.dryRun === true })));
  }

  // base: always the merge base of the freshly fetched base branch and the head. A caller-stated baseSha is checked
  // against it, never trusted: a commit inside the PR would narrow the changed paths, tier, slices and coverage to the
  // suffix, and the gate would grade only that suffix with no sign that the earlier commits went unreviewed.
  const headReadSpan = tracer.start(STAGES.headRead, STAGE_KINDS[STAGES.headRead], { headSha, round });
  const refs = await settle(() => deps.fetchRefs({ headSha, baseRefName }));
  const refsFetched = isObject(refs) && refs.ok === true;
  const mb = refsFetched ? await settle(() => deps.git(['merge-base', `refs/remotes/origin/${baseRefName}`, headSha])) : null;
  tracer.end(headReadSpan, refsFetched ? 'ok' : 'error', {});
  if (!refsFetched) return failure('RUN_FAILED', { reason: 'refs-unavailable', error: isObject(refs) && refs.error ? refs.error : 'the base and head could not be fetched', precheck });
  const baseSha = isObject(mb) && mb.status === 0 ? String(mb.stdout).trim().toLowerCase() : '';
  if (!SHA.test(baseSha)) return failure('RUN_FAILED', { reason: 'base-unresolved', error: `no merge base of origin/${baseRefName} and ${headSha}`, precheck });
  if (input.baseSha !== undefined && input.baseSha !== baseSha) {
    return failure('RUN_FAILED', { reason: 'base-not-merge-base', error: `baseSha ${input.baseSha} is not the merge base of origin/${baseRefName} and ${headSha} (${baseSha}); any other base reviews a different range than this pull request's own changes (a later one leaves earlier commits unreviewed and unreported), so the runner takes the merge base itself and accepts a stated baseSha only when it is that commit`, precheck });
  }

  // 3. prepare (snapshot, diffs, facts, baseline)
  const options = { repoRoot: input.repoRoot, runId, baseSha, headSha };
  for (const key of ['lastReviewedSha', 'remediationShas', 'stateRoot', 'testFiles', 'testCommand', 'baselineTimeoutMs', 'nodeModules']) if (input[key] !== undefined) options[key] = input[key];
  const prepared = await settle(() => deps.prepareReview(options));
  if (!isObject(prepared) || prepared.ok !== true) {
    return failure('RUN_FAILED', { reason: 'prepare-failed', error: isObject(prepared) ? `${prepared.reason || 'unknown'}: ${prepared.detail || ''}`.trim() : 'prepare returned nothing', stage: isObject(prepared) ? prepared.stage : undefined, precheck });
  }
  const artifact = (name) => (isObject(prepared.artifacts) && isObject(prepared.artifacts[name]) ? prepared.artifacts[name].path : null);
  const readArtifact = (name) => {
    const file = artifact(name);
    const text = file === null ? null : deps.fs.readText(file);
    try {
      return text === null ? null : JSON.parse(text);
    } catch (_error) {
      return null;
    }
  };
  const facts = readArtifact('facts.json');
  const baselineRecord = readArtifact('baseline.json');
  if (!isObject(facts) || !Array.isArray(facts.changedPaths) || !Array.isArray(facts.numstat) || artifact('range.diff') === null || artifact('snapshot') === null) {
    return failure('RUN_FAILED', { reason: 'facts-unreadable', error: 'facts.json, range.diff or the snapshot of the prepared directory could not be read', precheck });
  }
  if (prepared.headSha !== headSha || prepared.baseSha !== baseSha) {
    return failure('RUN_FAILED', { reason: 'prepared-other-range', error: 'the prepared directory is not for this base and head', precheck });
  }

  const run = {
    schema: SCHEMA,
    runId,
    traceRunId,
    round,
    repo: input.repo,
    pr: input.pr,
    repoRoot: input.repoRoot,
    headSha,
    baseSha,
    baseRefName,
    author: first.pr.author,
    prState: first.pr.state,
    agentAuthored: input.agentAuthored,
    dryRun: input.dryRun === true,
    lastReviewedSha: input.lastReviewedSha,
    remediationShas: input.remediationShas,
    precheck,
    prepared: {
      dir: prepared.dir,
      reused: prepared.reused === true,
      manifestPath: prepared.manifestPath,
      rangeDiff: artifact('range.diff'),
      deltaDiff: artifact('delta.diff') || undefined,
      snapshotDir: artifact('snapshot'),
      factsPath: artifact('facts.json'),
      mode: prepared.mode,
      absent: prepared.absent,
    },
    baseline: isObject(baselineRecord) ? { ran: baselineRecord.ran === true, exitCode: baselineRecord.exitCode, timedOut: baselineRecord.timedOut === true, reason: baselineRecord.reason || null, command: baselineRecord.command, files: Array.isArray(baselineRecord.selection) ? baselineRecord.selection.map((s) => s.file) : [] } : null,
    changedPaths: facts.changedPaths,
    numstat: facts.numstat,
    policy: isObject(facts.policy) && isObject(facts.policy.policy) ? facts.policy.policy : null,
    // Whether the base policy was usable; ok:false names why every path is High (kata vhpf).
    policyStatus: isObject(facts.policy) ? { ok: facts.policy.ok !== false, reason: facts.policy.ok === false ? facts.policy.reason || 'policy-untrusted' : null } : null,
    policyRejected: isObject(facts.policy) && Array.isArray(facts.policy.rejected) ? facts.policy.rejected : [],
    // the Severity bullets of REVIEW.md at the base (null: a cached prepare without them, or a REVIEW.md without the section)
    severityGuide: isObject(facts.guidance) && typeof facts.guidance.severityGuide === 'string' ? facts.guidance.severityGuide : null,
    severityGuideProblem: isObject(facts.guidance) && typeof facts.guidance.severityGuideProblem === 'string' ? facts.guidance.severityGuideProblem : null,
    sensitivePaths: isObject(facts.paths) && Array.isArray(facts.paths.sensitive) ? facts.paths.sensitive : [],
    phase: 'preparing',
    waves: [],
    calls: [],
    createdAt: startedAt,
  };

  // the head must not have moved while the preparation ran
  const second = await readHead(deps);
  if (!second.ok) return failure('RUN_FAILED', { reason: 'head-unreadable', error: second.error, precheck });
  if (second.headSha !== headSha) {
    return terminate(run, 'invalidated', failure('RUN_INVALIDATED', { reason: 'head-moved', runId, expectedHead: headSha, currentHead: second.headSha, precheck }), 'prepare', startedAt, deps);
  }
  if (second.pr.state !== 'OPEN') return notOpen(second.pr.state, runId, headSha);

  // 5-6. tier from the paths alone, then the mode
  const assignment = assignTier({ paths: facts.paths, kinds: S.deriveKinds(facts.changedPaths) });
  const effective = effectiveTier({ assignment, policy: run.policy === null ? undefined : run.policy, author: run.author });
  const record = tierRecord({ assignment, effective, assignedBy: 'review-run (changed paths only)', at: new Date(startedAt).toISOString() });
  const tier = { ...record, ok: record.ok === true && assignment.ok === true && effective.ok === true };
  const mode = selectMode(tier);
  run.tier = tier;
  run.mode = mode;
  const isFull = mode.mode === 'full';
  if (isFull) {
    run.reReview = F.planReReview({ lastReviewedSha: input.lastReviewedSha, rangeMode: prepared.mode, deltaPlan: facts.deltaPlan, delta: facts.delta, paths: facts.paths });
  }

  // 7-8. depth, then the slices from the size model (kata sfpb)
  // Full mode is always Deep, whatever the tier word says (an unreadable tier resolves no depth of its own).
  const planned = S.planDepth(isFull ? { tier: F.FULL_DEPTH_TIER, effectiveTier: F.FULL_DEPTH_TIER } : tier);
  if (planned.ok !== true) return failure('RUN_FAILED', { reason: 'depth-refused', error: planned.reason, precheck });
  run.depth = planned.depth;
  run.securityLane = isFull || SECURITY_REQUIRED_TIERS.includes(tier.tier) || SECURITY_REQUIRED_TIERS.includes(tier.effectiveTier) || mode.securityLane === true;
  const cap = run.policy && Number.isInteger(run.policy.maxConcurrentAgents) ? run.policy.maxConcurrentAgents : DEFAULT_MAX_CONCURRENT;
  run.maxConcurrentAgents = cap;
  const sliced = planRunSlices(run, facts.numstat);
  if (sliced.ok !== true) return failure('RUN_FAILED', { reason: 'slices-refused', error: sliced.reason, precheck });
  run.slices = sliced.plan.slices;
  run.assignments = sliced.plan.reviewerAssignments;
  run.sliced = sliced.plan.sliced;
  run.sizing = sliced.sizing;
  const downgraded = F.modeInvariant(run);
  if (downgraded !== null) return failure('RUN_FAILED', { reason: 'mode-invariant', error: downgraded, precheck });

  // 9-11. briefs, waves, deadlines. A brief the renderer refuses cannot be reviewed mechanically: a light run is handed to the
  // narrated procedure (NEEDS_FULL_MODE); a full run fails closed and says so (FULL_BRIEF_REFUSED), and is never lowered to light.
  let agents;
  try {
    agents = buildReviewAgents(run, deps, { now: startedAt });
  } catch (error) {
    if (isFull) return terminate(run, 'failed', failure('RUN_FAILED', { runId, headSha, reason: `brief-refused: ${msg(error)}`, ...FULL_BRIEF_REFUSED, mode, tier, dispatched: [], precheck }), 'prepare', startedAt, deps);
    return terminate(run, 'needs-full-mode', failure('NEEDS_FULL_MODE', { runId, headSha, mode: { ...mode, reasons: [...mode.reasons, 'brief-refused'] }, tier, reason: `brief-refused: ${msg(error)}`, dispatched: [], precheck }), 'prepare', startedAt, deps);
  }
  const groups = S.chunk(agents, cap);
  run.waves = groups.map((group, index) => ({ round: 'review', wave: index + 1, of: groups.length, status: 'planned', agents: group }));
  const now = deps.now();
  dispatchWave(run, run.waves[0], now, deps, tracer);
  run.phase = 'review-dispatched';
  run.rootSpanId = ctx.root;
  logCall(run, 'prepare', startedAt, deps);
  saveRun(deps, run);
  return { ...manifestOf(run, run.waves[0]), precheck, prState: run.prState };
}

/* ------------------------------------------------------------------- collect */

function validateCollect(input) {
  if (!isObject(input)) return 'the payload must be a JSON object';
  for (const key of Object.keys(input)) if (!COLLECT_KEYS.includes(key)) return `unknown payload key ${JSON.stringify(key)}`;
  if (!isText(input.repoRoot) || !path.isAbsolute(input.repoRoot)) return 'repoRoot must be an absolute path';
  if (!isValidRunId(input.runId)) return 'runId must be a valid run id';
  if (input.now !== undefined && !Number.isFinite(typeof input.now === 'string' ? Date.parse(input.now) : input.now)) return 'now must be epoch milliseconds or an ISO timestamp';
  if (input.adjudications !== undefined && !Array.isArray(input.adjudications)) return 'adjudications must be an array';
  if (input.triage !== undefined && !isObject(input.triage)) return 'triage must be a JSON object';
  return null;
}

function expectedOf(wave) {
  return wave.agents.map((a) => ({ name: a.name, role: a.role, dispatchedAt: a.dispatchedAt, deadlineAt: a.deadlineAt, ...(a.sliceId !== undefined ? { sliceId: a.sliceId, lens: a.lens, paths: a.paths } : {}), ...(a.candidateIds !== undefined ? { candidateIds: a.candidateIds } : {}) }));
}

/**
 * How far after the clock read of the call that collected it a result file's change time may lie before it is skew and not
 * the clock's resolution (the collector rounds a change time to the millisecond, so it can lie a millisecond past the call).
 */
const ARRIVAL_JITTER_MS = 1000;

/** A note for the caller: the CLI adds `deps.notices` to the answer's `warnings`. Nothing when the deps carry no such channel. */
function notify(deps, text) {
  if (Array.isArray(deps.notices)) deps.notices.push(text);
}

/**
 * The span attr that ends an agent at its last message: the arrival of its result file. An agent that never arrived has none
 * (its span ends where the collect call found it). A change time before the agent was dispatched is no message of this
 * dispatch (a stale file of an earlier round): none is stamped, the agent is listed in `problems.before`, and the span ends
 * at the collect call as it does for an agent that never arrived. A change time a little past the call's own clock reading
 * is the clock's resolution and is read as the call. One further past cannot be placed: it is stamped as it is, so the
 * reader refuses that agent's interval instead of counting the agent to the collect call, and the agent is listed in
 * `problems.after`.
 */
function lastMessageOf(agent, record, closedAt, problems) {
  if (!Number.isFinite(record.arrivedAt)) return {};
  let at = record.arrivedAt;
  if (at < agent.dispatchedAt) {
    problems.before.push(agent.name);
    return {};
  }
  if (at > closedAt) {
    if (at - closedAt <= ARRIVAL_JITTER_MS) at = closedAt;
    else problems.after.push(agent.name);
  }
  return { last_message_ts: new Date(at).toISOString() };
}

/** Records one collected wave in the run and ends its agents' spans. */
function recordWave(run, wave, collected, now, tracer, deps) {
  const problems = { before: [], after: [] };
  for (const record of collected.agents) {
    const agent = wave.agents.find((a) => a.name === record.name);
    agent.state = record.state;
    agent.reason = record.reason;
    if (Number.isFinite(record.arrivedAt)) agent.arrivedAt = record.arrivedAt;
    const lastMessage = lastMessageOf(agent, record, deps.now(), problems);
    tracer.end(agent.spanId, record.state === 'arrived' ? 'ok' : record.state, { state: record.state, reason: record.reason, ...lastMessage });
  }
  if (problems.before.length > 0) {
    notify(deps, `trace: the result file of ${problems.before.join(', ')} is dated before the agent was dispatched (a stale file of an earlier round?), so no last message is recorded for it: its span ends at the collect call`);
  }
  if (problems.after.length > 0) {
    notify(deps, `trace: the result file of ${problems.after.join(', ')} is dated more than ${ARRIVAL_JITTER_MS / 1000} s after the collect call that read it (clock skew?), so its last message cannot be placed: the span is recorded as it is and \`pr-review-cli timing\` will refuse that agent's interval rather than count it to the collect call`);
  }
  wave.status = 'collected';
  wave.collectedAt = now;
  wave.result = { findings: collected.findings, votes: collected.votes, incompleteVerifiers: collected.incompleteVerifiers, reviewedSlices: collected.reviewedSlices, unreviewedDetail: collected.unreviewedDetail, warnings: collected.warnings };
}

/** Everything after the review round: complete and dedupe the findings, the lane, the coverage, the verification plan. */
function processReview(run, deps, { deferVerification = false } = {}) {
  const reviewWaves = run.waves.filter((w) => w.round === 'review');
  const agents = reviewWaves.flatMap((w) => w.agents);
  const raw = reviewWaves.flatMap((w) => w.result.findings);

  // A finding labelled `pre-existing` never blocks, and the label is the agent's own word about provenance: it stands only
  // when the cited lines lie outside the PR's diff (S.gradePreExisting). The diff is read once, and only when a claim needs it.
  const claimsPreExisting = raw.some((finding) => finding.reviewer !== LANE_NAME && normalizeSeverity(finding.severity) === 'pre-existing');
  const snapshotDir = run.prepared.snapshotDir;
  // The file a citation names, looked up once per path: exactly spelled, a regular file of the head snapshot, never followed,
  // with its line count (S.gradePreExisting then refuses a label whose path names no such file or whose line is past its end).
  // A file system that cannot look it up, or throws, names nothing.
  const headFiles = new Map();
  const headFileOf = (rel) => {
    if (!headFiles.has(rel)) {
      let found = null;
      try {
        found = typeof snapshotDir === 'string' && typeof deps.fs.headFile === 'function' ? deps.fs.headFile(snapshotDir, rel) : null;
      } catch (_error) {
        found = null;
      }
      headFiles.set(rel, isObject(found) ? found : null);
    }
    return headFiles.get(rel);
  };
  const linesOf = (rel) => (headFileOf(rel) === null ? null : headFileOf(rel).lines);
  const diff = claimsPreExisting ? { index: readDiffIndex(deps, run.prepared.rangeDiff), changedPaths: run.changedPaths, snapshotDir, exists: (rel) => headFileOf(rel) !== null, lines: linesOf } : null;

  const completed = [];
  const laneFindings = [];
  let nextId = 0;
  let nextLaneId = 0;
  for (const finding of raw) {
    const name = finding.reviewer;
    const { reviewer, ...own } = finding;
    const entry = S.completeFinding(own, name, name === LANE_NAME ? `s${(nextLaneId += 1)}` : `f${(nextId += 1)}`);
    if (name === LANE_NAME) laneFindings.push(entry);
    else completed.push(diff === null ? entry : S.gradePreExisting(entry, diff));
  }
  const deduped = dedupeFindings(completed);
  if (!Array.isArray(deduped)) return failure('RUN_FAILED', { reason: 'dedupe-refused', error: deduped.reason });
  run.candidates = deduped;

  // coverage: a slice is reviewed only when no wave lists it unreviewed
  const unreviewed = new Map();
  for (const wave of reviewWaves) for (const detail of wave.result.unreviewedDetail) {
    const known = unreviewed.get(detail.sliceId) || { sliceId: detail.sliceId, reasons: [], missingPaths: [] };
    known.reasons.push(...detail.reasons);
    for (const p of detail.missingPaths) if (!known.missingPaths.includes(p)) known.missingPaths.push(p);
    unreviewed.set(detail.sliceId, known);
  }
  // the whole-range reader reads the whole diff beside the slices: it is no pass of any slice's lens, and its failure (expired, or a
  // path it did not list) is its own unreviewed entry
  const rangeFailure = unreviewed.get(RANGE_COVERAGE_SLICE) || null;
  const reviewedBy = agents.filter((a) => a.role === 'reviewer' && a.sliceId !== undefined && a.sliceId !== RANGE_COVERAGE_SLICE && !unreviewed.has(a.sliceId)).map((a) => ({ sliceId: a.sliceId, lens: a.lens, reviewer: a.name, paths: a.paths }));
  const coverage = verifyCoverage({ slices: run.slices, reviewedBy, mode: run.depth.mode, changedPaths: run.changedPaths });
  // A coverage the module could not compute is never "nothing is unreviewed": `verifyCoverage` answers empty lists then, so the
  // fallback to every slice and every path is decided here and not by `||` (an empty list is truthy).
  const computed = coverage.ok === true;
  run.coverage = {
    ok: coverage.ok,
    complete: computed && coverage.covered === true && rangeFailure === null,
    reviewedSlices: coverage.reviewedSlices || [],
    unreviewedSlices: [...(computed ? coverage.unreviewedSlices : run.slices.map((s) => s.id)), ...(rangeFailure === null ? [] : [RANGE_COVERAGE_SLICE])],
    uncovered: computed ? coverage.uncovered : run.changedPaths.slice(),
    underReviewed: computed ? coverage.underReviewed : [],
    requiredLenses: computed ? coverage.requiredLenses : undefined,
    ...(computed ? {} : { reason: coverage.reason }),
    detail: [...unreviewed.values()].filter((d) => d.sliceId !== LANE_COVERAGE_SLICE),
  };

  // the security lane: only a lane that arrived AND covered every changed path is ever `clean`
  const lane = agents.find((a) => a.name === LANE_NAME);
  if (lane === undefined) {
    run.security = { status: 'not-run', findings: [], reason: 'the tier does not call for the security lane' };
  } else if (lane.state !== 'arrived') {
    run.security = { status: 'not-run', findings: [], reason: `the security lane did not return (${lane.state}${lane.reason ? `: ${lane.reason}` : ''})` };
  } else if (unreviewed.has(LANE_COVERAGE_SLICE)) {
    run.security = { status: 'unavailable', findings: laneFindings, reason: `the security lane did not cover: ${unreviewed.get(LANE_COVERAGE_SLICE).missingPaths.join(', ') || 'every changed path'}` };
  } else {
    run.security = laneFindings.length > 0 ? { status: 'findings', findings: laneFindings } : { status: 'clean', findings: [] };
  }

  // verification plan: K distinct fresh verifiers per candidate, nobody on their own finding. A full run plans it only
  // after the orchestrator's triage, which may add candidates (planVerifyRound is then called with the grown list).
  if (deferVerification) return null;
  return planVerifyRound(run, deps);
}

/**
 * The verifier's brief for one candidate; THROWS the renderer's refusal. The one place the claim, the location and the path a
 * verifier is briefed with are assembled: `briefCandidates` (the verify plan, the TRIAGE answer and the triage dedupe) calls it
 * for every candidate, and `triageStep` calls it for what the orchestrator adds before the run depends on it, so triage
 * accepts exactly what the renderer will brief and the grammar and the leak screen live in the renderer alone.
 */
function verifierBrief(run, deps, candidate) {
  const file = S.locationFile(candidate.locationOrLink);
  return deps.renderBrief('verifier', { claim: candidate.failureMode, location: candidate.locationOrLink, paths: file === null ? [] : [file], snapshotDir: run.prepared.snapshotDir });
}

/**
 * What the run records for a candidate the verifier brief refused: the renderer's own message (`reason`), why in the closed
 * vocabulary of `BriefRefusal.kind` (`kind`: anything the renderer did not tag, a stand-in that threw a plain Error included,
 * is `other`) and the refused input (`input`, when the renderer named it). Nothing here reads the message.
 */
function refusalRecord(candidate, error) {
  const tagged = isObject(error) ? error : {};
  return { id: candidate.id, reason: msg(error), kind: REFUSAL_KINDS.includes(tagged.kind) ? tagged.kind : 'other', ...(isText(tagged.input) ? { input: tagged.input } : {}) };
}

/**
 * Asks the renderer, once per candidate, whether a verifier can be briefed with it: `briefs` is id -> brief for the ones it
 * accepts, `refused` the records (`refusalRecord`) of the ones it refuses, in candidate order. The single predicate behind
 * the verify plan, the TRIAGE answer and the triage dedupe, so they cannot disagree about which candidates are verifiable.
 */
function briefCandidates(run, deps, candidates) {
  const briefs = new Map();
  const refused = [];
  for (const candidate of candidates) {
    try {
      briefs.set(candidate.id, verifierBrief(run, deps, candidate));
    } catch (error) {
      refused.push(refusalRecord(candidate, error));
    }
  }
  return { briefs, refused };
}

/**
 * Plans and briefs the verify round for `run.candidates`. Null on success, a RUN_FAILED answer otherwise.
 *
 * Only the candidates a verifier can be briefed with are planned: each of THEM gets its K distinct verifiers, and the pool is
 * sized for them alone. A candidate the renderer refuses has no verifier slot at all (it would be an assigned verifier nobody
 * asks), is recorded in `run.unbriefable`, and stays in the ledger unverified, named and unmistakable (`buildLedger`).
 */
function planVerifyRound(run, deps) {
  const candidates = run.candidates;
  const k = run.depth.verifiersPerCandidate;
  run.unbriefable = [];
  run.verifyAgents = [];
  // Quick (no verifier is expected) and an empty list plan nothing to brief.
  if (k === 0 || candidates.length === 0) {
    const plan = S.planVerifierPool({ candidates, mode: run.depth.mode, k });
    if (plan.ok !== true) return failure('RUN_FAILED', { reason: 'verify-plan-refused', error: plan.reason });
    run.assignment = plan.assignments;
    return null;
  }

  const { briefs, refused } = briefCandidates(run, deps, candidates);
  run.unbriefable = refused;
  const plan = S.planVerifierPool({ candidates: candidates.filter((candidate) => briefs.has(candidate.id)), mode: run.depth.mode, k });
  if (plan.ok !== true) return failure('RUN_FAILED', { reason: 'verify-plan-refused', error: plan.reason });
  run.assignment = plan.assignments;

  const dir = runDirOf(run.repoRoot, run.runId);
  for (const entry of plan.agents) {
    const ids = entry.candidates;
    const name = entry.verifier;
    const record = { name, role: 'verifier', candidateIds: ids, briefPath: path.join(dir, 'briefs', `${name}.md`), outPath: path.join(dir, 'results', 'verify', `out-${name}.json`) };
    const body = ids.map((id) => `### Candidate ${id}\n\n${briefs.get(id).replace(/\s*$/, '\n')}`).join('\n---\n\n');
    deps.fs.mkdirp(path.dirname(record.briefPath), 0o700);
    deps.fs.writeAtomic(record.briefPath, `# Findings to settle (${ids.length})\n\nEach finding below is a separate claim. Settle each on its own.\n\n${body}\n${S.verifierContract(record)}`, 0o600);
    run.verifyAgents.push(record);
  }
  return null;
}

function addWaves(run, round, agents) {
  const groups = S.chunk(agents, run.maxConcurrentAgents);
  groups.forEach((group, index) => run.waves.push({ round, wave: index + 1, of: groups.length, status: 'planned', agents: group }));
}

/* ------------------------------------------------------------- finalisation */

/**
 * The tally entry of a candidate nobody could be asked about, because the verifier brief refused it. It is in no tally: it has
 * no assignment, no vote and no tally to show (`tally: null`, never a zero count that would read as "0 of 5 voted real"), and
 * says so: `unverified` / `unbriefable`, with the kind, the refused input and the renderer's reason. It is presented, never
 * hidden, and the gate reads it like every other finding (its severity and the operator's decision, not its verification).
 * Never `present` or `filtered`: those need votes, and nobody voted.
 */
function unbriefableEntry(candidate, refusal) {
  return {
    ...candidate,
    outcome: 'unverified',
    reason: 'unbriefable',
    authorLabel: 'unverified',
    presented: true,
    tally: null,
    ignoredVotes: [],
    assigned: [],
    incompleteVerifiers: [],
    unbriefable: { kind: REFUSAL_KINDS.includes(refusal.kind) ? refusal.kind : 'other', ...(isText(refusal.input) ? { input: refusal.input } : {}), reason: refusal.reason },
  };
}

/**
 * What a round with unbriefable candidates says about its verification. `tallyVotes` ranges over the candidates a verifier was
 * asked about, so on its own it would call a round `performed` whatever was never asked: a round with an unbriefable candidate
 * is at best `partial`, and `not-performed` when no candidate could be asked about (or none of the others was verified). The
 * tally's own reason and recovery stay when it has them (a missing vote can still be supplied); otherwise a person decides.
 */
function withUnbriefable(tally, findings, refused) {
  const verification = refused === findings.length || tally.verification === 'not-performed' ? 'not-performed' : 'partial';
  return {
    ...tally,
    verification,
    reason: [tally.reason, 'unbriefable-candidates'].filter(isText).join('; '),
    recoveryAction: isText(tally.recoveryAction) ? tally.recoveryAction : 'reword-the-claim-or-decide',
    findings,
    presented: findings.filter((f) => f.presented === true),
  };
}

function buildLedger(run) {
  const verifyWaves = run.waves.filter((w) => w.round === 'verify' && w.status === 'collected');
  const votes = verifyWaves.flatMap((w) => w.result.votes);
  const incompleteVerifiers = verifyWaves.flatMap((w) => w.result.incompleteVerifiers);
  const agents = verifyWaves.flatMap((w) => w.agents.map((a) => ({ name: a.name, role: a.role, state: a.state, candidateIds: a.candidateIds })));
  // The tally and the plan range over the candidates a verifier was asked about; the others (`run.unbriefable`) are never
  // given an assignment, a vote or a tally (a plan stored before they were planned out lists them too: it is read as if not).
  const refusals = new Map(run.unbriefable.map((u) => [String(u.id), u]));
  const verifiable = run.candidates.filter((candidate) => !refusals.has(String(candidate.id)));
  const planned = new Set(verifiable.map((candidate) => String(candidate.id)));
  const input = toVotesInput({ votes, incompleteVerifiers, agents, findings: [] }, { depth: run.depth.mode, expectedVerifiers: run.depth.verifiersPerCandidate, candidates: verifiable });
  if (input.ok === false) return { ok: false, reason: input.reason };
  const asked = tallyVotes({ findings: input.findings, depth: input.depth, expectedVerifiers: input.expectedVerifiers, assignment: run.assignment.filter((entry) => planned.has(String(entry.id))) });
  if (asked.ok !== true) return { ok: false, reason: `votes blocked: ${asked.reason}` };
  const byId = new Map(asked.findings.map((f) => [String(f.id), f]));
  const findings = run.candidates.map((candidate) => (refusals.has(String(candidate.id)) ? unbriefableEntry(candidate, refusals.get(String(candidate.id))) : byId.get(String(candidate.id))));
  const tally = refusals.size === 0 ? asked : withUnbriefable(asked, findings, refusals.size);
  // The ledger is every deduped candidate, unchanged, with its verification outcome UNDER `verification`: tally fields
  // such as `reason` would otherwise read as a ledger deferral reason.
  const ledger = run.candidates.map((candidate, index) => {
    const t = findings[index];
    return { ...candidate, verification: { outcome: t.outcome, reason: t.reason, authorLabel: t.authorLabel, presented: t.presented, tally: t.tally, assigned: t.assigned, incompleteVerifiers: t.incompleteVerifiers, ignoredVotes: t.ignoredVotes, ...(t.unbriefable === undefined ? {} : { unbriefable: t.unbriefable }) } };
  });
  return { ok: true, ledger, tally };
}

function testsFact(baseline) {
  if (!isObject(baseline) || baseline.ran !== true || baseline.timedOut === true || !Number.isInteger(baseline.exitCode)) return undefined;
  const files = Array.isArray(baseline.files) ? baseline.files.length : 0;
  return { exitCode: baseline.exitCode, skipped: false, command: `relevant test files only (${files} file${files === 1 ? '' : 's'}), not the full suite: ${(baseline.command || []).join(' ')}` };
}

/**
 * The run's coverage as the record the gate, the status and the operator's list read (`pr-review-coverage.js`, kata k48x), built
 * from what the run stored: the unreviewed slices and the whole-range read, the paths nobody read and the paths read under too few
 * lenses, with why each failed. A coverage the run could not compute is `unavailable`. A run that says `complete: false` and names
 * nothing (one stored by an earlier version, which kept no `underReviewed`) is still incomplete: it names every changed path.
 * Nothing here is a decision: it is a pure function of the run, so every `finalise` of one run (an adjudication included) answers
 * the same coverage.
 */
function coverageOf(run) {
  const covered = run.coverage;
  return buildCoverage({
    changedPaths: run.changedPaths,
    slices: run.slices,
    unreviewedSlices: covered.unreviewedSlices,
    uncovered: covered.uncovered,
    underReviewed: covered.underReviewed,
    requiredLenses: covered.requiredLenses,
    detail: covered.detail,
    incomplete: covered.complete !== true,
    origin: `review run ${run.runId}`,
    ...(covered.ok === true ? {} : { unavailable: covered.reason || 'the coverage module refused its input' }),
  });
}

/** One read, and ONE retry of it, before it is called unavailable. */
async function twice(fn) {
  let result = await settle(fn);
  if (!isObject(result) || result.ok !== true) result = await settle(fn);
  return result;
}

async function treeOf(deps, sha) {
  if (!SHA.test(String(sha))) return undefined;
  const r = await settle(() => deps.git(['rev-parse', '--verify', '--end-of-options', `${sha}^{tree}`]));
  const out = isObject(r) && r.status === 0 ? String(r.stdout).trim().toLowerCase() : '';
  return SHA.test(out) ? out : undefined;
}

/**
 * The gate stage, from the host: reviews, the head re-read, tree ids from the local object database, protection,
 * unavailable[] for reads that failed twice, then tier -> approvals -> gate exactly as merge-gate.md 10d/10e.
 * Returns `{invalid}` (head moved / unreadable) or the graded pieces.
 */
async function gateStage(run, built, deps, tracer) {
  const span = tracer.start(STAGES.gate, STAGE_KINDS[STAGES.gate], { headSha: run.headSha, round: run.round });
  const unavailable = [];
  const warnings = [];
  const reviewsRead = await twice(() => deps.readReviews());
  if (reviewsRead.ok !== true || !Array.isArray(reviewsRead.reviews)) unavailable.push('reviews');
  const protectionRead = await twice(() => deps.readProtection(run.baseRefName));
  if (protectionRead.ok !== true) unavailable.push('branch-protection');

  const head = await readHead(deps);
  if (!head.ok) {
    tracer.end(span, 'error', { reason: 'head-unreadable' });
    return { invalid: failure('RUN_FAILED', { reason: 'head-unreadable', error: head.error, runId: run.runId }) };
  }
  if (head.headSha !== run.headSha) {
    tracer.end(span, 'error', { reason: 'head-moved' });
    return { invalid: failure('RUN_INVALIDATED', { reason: 'head-moved', runId: run.runId, expectedHead: run.headSha, currentHead: head.headSha }), moved: true };
  }
  if (head.pr.state !== 'OPEN') {
    tracer.end(span, 'error', { reason: 'pr-not-open' });
    return { invalid: notOpen(head.pr.state, run.runId), moved: false };
  }

  const headTreeSha = await treeOf(deps, run.headSha);
  if (headTreeSha === undefined) warnings.push('head-tree-unreadable: only approvals given on the head commit itself are counted');
  const trees = new Map();
  const reviews = [];
  for (const review of reviewsRead.ok === true && Array.isArray(reviewsRead.reviews) ? reviewsRead.reviews : []) {
    if (!isObject(review)) continue;
    const commit = typeof review.commitSha === 'string' ? review.commitSha.toLowerCase() : null;
    if (commit !== null && commit !== run.headSha && !trees.has(commit)) trees.set(commit, await treeOf(deps, commit));
    reviews.push({ ...review, ...(commit !== null && trees.get(commit) ? { treeSha: trees.get(commit) } : {}) });
  }

  // Who wrote the PR is not something the runner can read: the author's login cannot say it (an agent PR is committed under
  // the maintainer's own login), so `agentAuthored` is the caller's statement, passed on as given. The answer says so, so a
  // relaxation (or a credit) that rests on that word is visible instead of silent. Absent is the strictest reading.
  if (run.agentAuthored === true) warnings.push('agent-authored-unverified: the caller stated agentAuthored:true, so a "Directed by:" line in the PR body credits the person it names as one approval; the runner cannot verify who wrote this pull request');
  else if (run.agentAuthored === false) warnings.push('agent-authored-unverified: the caller stated agentAuthored:false, so no "Directed by:" line was required and nobody was credited as the director; the runner cannot verify who wrote this pull request');
  const description = checkDescription({ body: head.pr.body, agentAuthored: run.agentAuthored });
  const policy = run.policy === null ? undefined : run.policy;
  const approvals = evaluateApprovals({ reviews, headSha: run.headSha, headTreeSha, tier: run.tier, policy, author: run.author, directedBy: description.directedBy || undefined, agentAuthored: run.agentAuthored });
  const coverage = coverageOf(run);
  const gate = evaluateGate({ ledger: built.ledger, approvals, tier: run.tier, description, security: run.security, coverage, headSha: run.headSha, policy, unavailable });
  const disposition = buildDispositionChoices({ ledger: built.ledger, security: run.security, coverage, votes: built.tally, policy, headSha: run.headSha });
  tracer.end(span, gate.mergeable === true ? 'ok' : 'blocked', { mergeable: gate.mergeable, blockers: gate.blockers.length });
  const gated = { ...gate, dispositionChoices: disposition.dispositionChoices, dispositionGroups: disposition.groups, mergeConfirmation: disposition.mergeConfirmation, ...(disposition.ok === true ? {} : { dispositionReason: disposition.reason }) };
  const protection = assessProtection(protectionRead, run.baseRefName, { required: approvals.humansRequired });

  // The verdict span covers the verdict from deriving the status to recording it, and `finalise` ends it: ok when the verdict
  // was recorded, error when this attempt did not get that far (a failed state write, a throw). The reader takes an error
  // span for no verdict, so a collect retried after a failure leaves ONE verdict in the window; two would leave the critical
  // path without the verdict that ends its chain. After the root has closed (an adjudication) the re-run lies outside the
  // window, which the reader leaves out.
  const verdictSpan = tracer.start(STAGES.verdict, STAGE_KINDS[STAGES.verdict], { headSha: run.headSha, round: run.round });
  let reviewStatus;
  let tests;
  try {
    const actionable = built.ledger.filter((entry) => isActionable(entry)).length;
    const deferred = built.ledger.filter((entry) => !isActionable(entry) && entry.disposition === 'deferred').length;
    tests = testsFact(run.baseline);
    reviewStatus = deriveStatus({
      baseSha: run.baseSha,
      headSha: run.headSha,
      reviewedHeadSha: run.headSha,
      ...(headTreeSha === undefined ? {} : { reviewedTreeSha: headTreeSha, headTreeSha }),
      findingCounts: { total: built.ledger.length, actionable, deferred },
      // An incomplete coverage is not a complete review: the status is given the same record the gate was (and the policy that
      // says who may decide a gap), so the local phase that publication is gated on can never rest on paths nobody read.
      coverage,
      ...(policy === undefined ? {} : { policy }),
      // No usable baseline (no relevant test files, a timed-out run, none at all) is a run that did not happen, never a
      // failure it did not have: recorded as skipped, so the status reads `tests skipped` and can never be complete.
      tests: tests === undefined ? { skipped: true, command: 'none: the baseline run produced no usable result (no relevant test files, a timed-out run or no run)' } : tests,
      roundsUsed: 0,
      ...(run.policy && Number.isInteger(run.policy.roundCap) ? { roundCap: run.policy.roundCap } : {}),
      reportPath: statePath(run.pr, run.repoRoot),
    });
  } catch (error) {
    tracer.end(verdictSpan, 'error', { error: msg(error) });
    throw error;
  }
  return { gate: gated, approvals, description, reviewStatus, headTreeSha, tests, protection, unavailable, warnings, headState: head.pr.state, verdictSpan, coverage };
}

function reducedReviewNotice(run, built, notReviewed, stage) {
  const lines = [];
  const sliceIds = notReviewed.unreviewedSlices.filter((id) => id !== RANGE_COVERAGE_SLICE);
  if (notReviewed.unreviewedSlices.length > 0) {
    const parts = [];
    if (sliceIds.length > 0) parts.push(`slice(s) ${sliceIds.join(', ')}`);
    if (notReviewed.unreviewedSlices.includes(RANGE_COVERAGE_SLICE)) parts.push('whole-range read');
    if (notReviewed.unreviewedPaths.length > 0) parts.push(`path(s) ${notReviewed.unreviewedPaths.join(', ')}`);
    lines.push(`NOT REVIEWED: ${parts.join('; ')}`);
  }
  // The gate does not pass on an unread path: said here, where the report is read, as well as in the gate's blockers.
  const gaps = stage.coverage.status === 'complete' ? [] : stage.coverage.gaps;
  if (stage.coverage.status === 'unavailable') lines.push(`coverage UNAVAILABLE (${stage.coverage.reason}): the merge gate is not mergeable until the review is run again`);
  else if (gaps.length > 0) lines.push(`the merge gate is NOT MERGEABLE on ${gaps.length} coverage gap(s) (${gaps.map((gap) => gap.id).join(', ')}) until the review is run again on this head or the operator accepts each with a recorded reason`);
  const sizing = isObject(run.sizing) ? run.sizing : null;
  if (sizing !== null && Array.isArray(sizing.warnings)) for (const warning of sizing.warnings) lines.push(`plan ${warning.code}: ${warning.message}`);
  const rangeDetail = isObject(run.coverage) && Array.isArray(run.coverage.detail) ? run.coverage.detail.find((d) => d.sliceId === RANGE_COVERAGE_SLICE) : undefined;
  // who read the whole diff, by what happened and not by what was planned: the security lane counts only when it arrived and covered every
  // changed path, the TRIAGE step is a full run's, the whole-range reader counts only when it was planned and its read did not fail
  const laneRead = run.security.status === 'clean' || run.security.status === 'findings';
  if (rangeDetail !== undefined) lines.push(`whole-range read NOT REVIEWED (${rangeDetail.reasons.map((r) => `${r.agent}: ${r.reason}`).join(', ')}${rangeDetail.missingPaths.length > 0 ? `; paths it did not list: ${rangeDetail.missingPaths.join(', ')}` : ''}): an interaction between slices was then read as a whole ${laneRead ? 'only by the security lane' : 'by no agent'}`);
  const narrowed = sizing !== null && Array.isArray(sizing.slices) ? sizing.slices.filter((slice) => slice.diff === 'slice').length : 0;
  if (narrowed > 0) {
    const full = run.mode.mode === 'full';
    const readerRead = sizing.wholeRangeReader === true && rangeDetail === undefined;
    const named = [laneRead ? 'the security lane' : null, full ? 'the TRIAGE step' : null].filter((name) => name !== null).join(' and ');
    const readers = readerRead ? `${named === '' ? '' : `${named} and by `}one whole-range reader (${RANGE_NAME}: one pass under one lens, with no second reader of the whole diff)` : named;
    lines.push(`cross-slice: ${narrowed} of ${sizing.slices.length} slices were each reviewed on their own slice's diff, so an interaction between slices was read as a whole ${readers === '' ? 'by no agent' : `only by ${readers}`}${full || readerRead ? '' : ' (this mode has no TRIAGE step)'}`);
  }
  if (run.security.status !== 'clean') lines.push(`security lane ${run.security.status}${run.security.reason ? `: ${run.security.reason}` : ''}`);
  if (built.tally.verification !== 'performed') lines.push(`verification ${built.tally.verification}${built.tally.reason ? `: ${built.tally.reason}` : ''}`);
  if (notReviewed.unbriefable.length > 0) lines.push(`UNVERIFIED, no verifier was asked (the verifier brief refuses the candidate, so a person decides it; the renderer's reason is in notReviewed.unbriefable): ${notReviewed.unbriefable.map((u) => `${u.id} (${u.kind || 'other'}${u.input ? `, ${u.input}` : ''})`).join(', ')}`);
  const regraded = built.ledger.filter((entry) => entry.claimedSeverity !== undefined);
  if (regraded.length > 0) lines.push(`graded Important, not pre-existing as the reviewer called them, because the diff does not bear the label out: ${regraded.map((entry) => `${entry.id} (${entry.locationOrLink})`).join(', ')}`);
  if (stage.tests === undefined) lines.push('tests not shown: no baseline run, a timed-out one, or no relevant test files');
  else lines.push(`tests: the baseline ran the relevant test files only (exit ${stage.tests.exitCode}), not the full suite`);
  return lines.join('\n');
}

function notReviewedOf(run) {
  const agents = run.waves.filter((w) => w.status === 'collected').flatMap((w) => w.agents);
  const verifyWaves = run.waves.filter((w) => w.round === 'verify' && w.status === 'collected');
  return {
    unreviewedSlices: run.coverage.unreviewedSlices,
    unreviewedPaths: run.coverage.uncovered,
    underReviewedPaths: Array.isArray(run.coverage.underReviewed) ? run.coverage.underReviewed : [],
    incompleteVerifiers: verifyWaves.flatMap((w) => w.result.incompleteVerifiers),
    unbriefable: run.unbriefable,
    expiredAgents: agents.filter((a) => a.state !== 'arrived').map((a) => ({ name: a.name, role: a.role, state: a.state, reason: a.reason })),
  };
}

/**
 * The final computation, from a run whose waves are all collected. `ledger`/`tally` may come from an adjudication. The verdict
 * span opened by the gate stage ends here: ok once the verdict is recorded, error when this attempt did not get that far, so
 * that a retried collect leaves one verdict in the window (the reader takes an error span for no verdict). The root span
 * closes right after the verdict that ends the run.
 */
async function finalise(run, built, deps, now, startedAt, tracer, extra) {
  const stage = await gateStage(run, built, deps, tracer);
  if (stage.invalid) return { invalid: stage.invalid, moved: stage.moved === true };
  let outcome;
  try {
    outcome = await recordFinal(run, built, stage, deps, now, startedAt, extra);
  } catch (error) {
    tracer.end(stage.verdictSpan, 'error', { error: msg(error) });
    throw error;
  }
  if (outcome.answer === undefined) {
    tracer.end(stage.verdictSpan, 'error', { reason: outcome.invalid.reason });
    return outcome;
  }
  tracer.end(stage.verdictSpan, 'ok', { status: isObject(stage.reviewStatus) ? stage.reviewStatus.status : undefined });
  if (outcome.closesRoot) endRoot(tracer, run.rootSpanId, 'ok', { phase: 'done' });
  return { answer: outcome.answer };
}

/** Records the verdict of a run: the state report, `final.json` and the run file. `{invalid, moved}` when the state report cannot be written. */
async function recordFinal(run, built, stage, deps, now, startedAt, extra) {
  const notReviewed = notReviewedOf(run);
  const adjudicate = S.adjudicateList(built.ledger);
  const reducedReview = reducedReviewNotice(run, built, notReviewed, stage);
  const fullFields = run.mode.mode === 'full' ? { reReview: run.reReview, triage: run.triage } : {};
  const state = {
    ...stage.reviewStatus,
    prId: run.pr,
    runId: run.runId,
    mode: run.mode.mode,
    tier: run.tier,
    depth: { mode: run.depth.mode, reasons: run.depth.reasons, reviewersPerSlice: run.depth.reviewersPerSlice, verifiersPerCandidate: run.depth.verifiersPerCandidate },
    verification: { verification: built.tally.verification, reason: built.tally.reason, recoveryAction: built.tally.recoveryAction },
    reducedReview,
    ledger: built.ledger,
    security: run.security,
    notReviewed,
    gate: { mergeable: stage.gate.mergeable, blockers: stage.gate.blockers },
    ...fullFields,
    ...(extra.adjudications ? { adjudicatedBy: 'orchestrator', adjudications: extra.adjudications } : {}),
  };
  const written = await settle(() => deps.writeState(statePath(run.pr, run.repoRoot), state));
  if (!isObject(written) || written.ok !== true) {
    return { invalid: failure('RUN_FAILED', { reason: 'state-write-failed', error: isObject(written) ? written.reason || written.error : 'no answer', runId: run.runId }), moved: false };
  }

  logCall(run, extra.call, startedAt, deps, extra.adjudications !== undefined, extra.flags || {});
  const metrics = S.computeMetrics(run, deps.now());
  const answer = {
    ok: true,
    status: adjudicate.length > 0 ? 'ADJUDICATE' : 'DONE',
    runId: run.runId,
    headSha: run.headSha,
    baseSha: run.baseSha,
    prState: run.prState,
    mode: run.mode,
    ...fullFields,
    tier: run.tier,
    depth: { mode: run.depth.mode, verifiersPerCandidate: run.depth.verifiersPerCandidate, reviewersPerSlice: run.depth.reviewersPerSlice },
    gate: stage.gate,
    reviewStatus: stage.reviewStatus,
    ledger: built.ledger,
    votes: { verification: built.tally.verification, reason: built.tally.reason, recoveryAction: built.tally.recoveryAction, outcomes: built.tally.findings.map((f) => ({ id: f.id, outcome: f.outcome, reason: f.reason, authorLabel: f.authorLabel, tally: f.tally })) },
    security: run.security,
    coverage: { complete: run.coverage.complete && run.security.status !== 'not-run', unreviewedSlices: run.coverage.unreviewedSlices, uncovered: run.coverage.uncovered },
    notReviewed,
    approvals: stage.approvals,
    protection: stage.protection,
    precheck: run.precheck,
    unavailable: stage.unavailable,
    warnings: stage.warnings,
    reducedReview,
    statePath: written.path,
    metrics,
    ...(adjudicate.length > 0 ? { adjudicate } : {}),
    ...(extra.adjudications ? { adjudicatedBy: 'orchestrator', adjudications: extra.adjudications } : {}),
  };
  deps.fs.writeAtomic(path.join(runDirOf(run.repoRoot, run.runId), 'final.json'), `${JSON.stringify(redactor(deps)(answer), null, 2)}\n`, 0o600);
  run.phase = 'done';
  run.votesResult = built.tally;
  run.finalLedger = built.ledger;
  run.metrics = metrics;
  if (extra.adjudications) run.adjudications = extra.adjudications;
  // The root span closes right after the verdict (`finalise` ends it), and the run file records that in THIS write: a second
  // save for it could fail after the review was recorded, and the caller would see a failure for a review that completed.
  const closesRoot = run.rootSpanId !== null && run.rootSpanId !== undefined && run.rootEnded !== true;
  if (closesRoot) run.rootEnded = true;
  saveRun(deps, run);
  return { answer, closesRoot };
}

/** Validates and applies adjudications; only findings that were LISTED can be decided, and no decision closes an Important. */
function applyAdjudications(ledger, listed, adjudications, now) {
  const allowed = new Set(listed.map((l) => String(l.id)));
  const seen = new Set();
  for (const item of adjudications) {
    if (!isObject(item) || !isText(String(item.id)) || !ADJUDICATION_DISPOSITIONS.includes(item.disposition) || !isText(item.reason)) {
      return { ok: false, reason: 'each adjudication needs id, disposition (fix | deferred | not-applicable) and a reason' };
    }
    if (!allowed.has(String(item.id))) return { ok: false, reason: `finding ${JSON.stringify(item.id)} was not listed for adjudication` };
    if (seen.has(String(item.id))) return { ok: false, reason: `finding ${JSON.stringify(item.id)} is adjudicated twice` };
    seen.add(String(item.id));
  }
  const byId = new Map(adjudications.map((a) => [String(a.id), a]));
  const next = ledger.map((entry) => {
    const decision = byId.get(String(entry.id));
    if (decision === undefined) return entry;
    return {
      ...entry,
      disposition: decision.disposition,
      uncertain: false,
      ...(decision.disposition === 'deferred' ? { reason: decision.reason } : {}),
      adjudicatedBy: 'orchestrator',
      adjudication: { by: 'orchestrator', disposition: decision.disposition, reason: decision.reason, at: new Date(now).toISOString() },
    };
  });
  return { ok: true, ledger: next };
}

/**
 * The TRIAGE answer: the full-mode stop where the orchestrating model may add candidates, and nothing else. Dispatches nothing.
 * A candidate the verifier brief refuses carries `unbriefable: {kind, reason}` (`input` when named): it will not be verified,
 * and the orchestrator is told before it decides what to add, instead of learning it from the ledger.
 */
function triageManifest(run, deps) {
  const refused = new Map(briefCandidates(run, deps, run.candidates).refused.map((record) => [String(record.id), record]));
  return {
    ok: true,
    status: 'TRIAGE',
    runId: run.runId,
    headSha: run.headSha,
    mode: run.mode,
    tier: run.tier,
    reReview: run.reReview,
    depth: { mode: run.depth.mode, reviewersPerSlice: run.depth.reviewersPerSlice, verifiersPerCandidate: run.depth.verifiersPerCandidate },
    dispatched: [],
    candidates: run.candidates.map((c) => {
      const refusal = refused.get(String(c.id));
      return { id: c.id, locationOrLink: c.locationOrLink, severity: c.severity, failureMode: c.failureMode, source: c.source, ...(refusal === undefined ? {} : { unbriefable: { kind: refusal.kind, ...(refusal.input === undefined ? {} : { input: refusal.input }), reason: refusal.reason } }) };
    }),
    coverage: { complete: run.coverage.complete, unreviewedSlices: run.coverage.unreviewedSlices, uncovered: run.coverage.uncovered },
    rangeDiff: isObject(run.prepared) && typeof run.prepared.rangeDiff === 'string' ? run.prepared.rangeDiff : null,
    slices: Array.isArray(run.slices) ? run.slices.map((slice) => ({ id: slice.id, paths: slice.paths })) : [],
    security: { status: run.security.status, findings: run.security.findings.length, ...(run.security.reason === undefined ? {} : { reason: run.security.reason }) },
    maxAdditionalCandidates: F.MAX_ADDITIONAL_CANDIDATES,
    next: `node review-run-cli.js collect  (payload {"repoRoot": ${JSON.stringify(run.repoRoot)}, "runId": ${JSON.stringify(run.runId)}, "triage": {"additionalCandidates": []}})`,
    rules: [...RULES, ...TRIAGE_RULES],
  };
}

/**
 * One collect call while the run waits for triage (phase `triage`). Returns an answer to hand back (the TRIAGE answer again,
 * a refusal, a failure, or the verify wave), or null when triage is complete and nothing needs verifying, so collect goes on
 * to the ledger. Triage only ever GROWS `run.candidates`: nothing here removes, edits or closes one.
 */
function triageStep(run, input, deps, tracer, startedAt, now) {
  if (input.triage === undefined) {
    logCall(run, 'collect', startedAt, deps, false, { triage: true });
    saveRun(deps, run);
    return triageManifest(run, deps);
  }
  const validated = F.validateTriage(input.triage);
  if (validated.ok !== true) return failure('RUN_FAILED', { reason: 'triage-refused', error: validated.reason, runId: run.runId });

  // A cited location must be a regular file of the head snapshot, exactly spelled and never followed, with the line in it:
  // a verifier is briefed with that path, so a path the snapshot does not hold (a home-relative or absolute path included)
  // is never passed on.
  for (const raw of validated.additional) {
    const cited = /^(.+):(\d+)(?:-(\d+))?$/.exec(raw.locationOrLink);
    let found = null;
    try {
      found = typeof run.prepared.snapshotDir === 'string' && typeof deps.fs.headFile === 'function' ? deps.fs.headFile(run.prepared.snapshotDir, cited[1]) : null;
    } catch (_error) {
      found = null;
    }
    const last = Number(cited[3] === undefined ? cited[2] : cited[3]);
    if (!isObject(found) || !(Number(cited[2]) >= 1 && last >= Number(cited[2]) && last <= found.lines)) {
      return failure('RUN_FAILED', { reason: 'triage-refused', error: `${raw.locationOrLink} is not a line of a regular file of the head snapshot (spell the repository-relative path exactly)`, runId: run.runId });
    }
  }

  const used = run.candidates.flatMap((c) => [c.id, ...(Array.isArray(c.mergedFrom) ? c.mergedFrom.map((m) => m.id) : [])]);
  const top = used.map((id) => /^f(\d+)$/.exec(String(id))).filter((m) => m !== null).map((m) => Number(m[1]));
  const first = Math.max(0, ...top) + 1;
  const entries = validated.additional.map((raw, index) => S.completeFinding(raw, F.ORCHESTRATOR, `f${first + index}`));
  // An entry the dedupe would merge with a candidate a verifier will be asked about is dropped: that candidate stays exactly as
  // it was (id, source, severity), so triage can never displace or re-grade one. A candidate the verifier brief refuses is not
  // one of them: nobody will check what it says, so an entry that restates it is not a duplicate of anything verifiable and is
  // kept (the only way its defect gets an independent check), and the refused candidate stays as it is. Only a distinct entry is
  // appended, unchanged, and only when a verifier can be briefed with it. An entry the verifier brief refuses (verifierBrief is
  // the call the verify round makes) would be kept unverified and block the gate, and the orchestrator that wrote it is the one
  // who can reword it in this run, so the whole payload is refused here, naming the entry and the renderer's own reason, before
  // anything is kept.
  let candidates = run.candidates;
  const unverifiable = new Set(briefCandidates(run, deps, candidates).refused.map((record) => String(record.id)));
  for (const [index, entry] of entries.entries()) {
    const verifiable = candidates.filter((candidate) => !unverifiable.has(String(candidate.id)));
    const combined = dedupeFindings([...verifiable, entry]);
    if (!Array.isArray(combined)) return failure('RUN_FAILED', { reason: 'triage-refused', error: combined.reason, runId: run.runId });
    if (combined.length <= verifiable.length) continue;
    try {
      verifierBrief(run, deps, entry);
    } catch (error) {
      return failure('RUN_FAILED', { reason: 'triage-refused', error: `additionalCandidates[${index}] (${entry.locationOrLink}) cannot be briefed to a verifier, so it would stay unverified and block the gate: ${msg(error)}; change its claim or location so the verifier brief accepts it, or leave it out, and call collect again`, runId: run.runId });
    }
    candidates = [...candidates, entry];
  }
  const kept = entries.filter((e) => candidates.some((c) => c.id === e.id)).map((e) => e.id);
  run.candidates = candidates;
  run.triage = { turns: 1, requested: entries.length, additionalCandidateIds: kept, mergedIntoExisting: entries.length - kept.length, at: new Date(now).toISOString() };

  const failed = planVerifyRound(run, deps);
  if (failed !== null) return terminate(run, 'failed', { ...failed, runId: run.runId }, 'collect', startedAt, deps);
  run.phase = 'triaged';
  if (run.verifyAgents.length > 0) {
    addWaves(run, 'verify', run.verifyAgents);
    return emit(run, run.waves.find((w) => w.status === 'planned'), deps, tracer, startedAt, now, { triage: true });
  }
  saveRun(deps, run);
  return null;
}

const TERMINAL_PHASES = Object.freeze(['done', 'invalidated', 'needs-full-mode', 'failed']);

/**
 * Collect. The `review` root span stays open across PENDING and DISPATCH answers and is closed by the call after which the
 * run is over, once: the run records that it did. A finished run closes it in `finalise`, in the write that records the
 * verdict; this closes it for a run that ended without one (invalidated, failed) and records that in a write of its own,
 * which is trace bookkeeping: a failure of it never changes the answer of a call whose run is already over.
 */
async function collectRun(input, deps) {
  const ctx = { tracer: null, run: null };
  const answer = await collectStages(input, deps, ctx);
  const { run, tracer } = ctx;
  if (run !== null && run.rootSpanId !== null && run.rootSpanId !== undefined && run.rootEnded !== true && TERMINAL_PHASES.includes(run.phase)) {
    endRoot(tracer, run.rootSpanId, run.phase === 'done' ? 'ok' : 'error', { phase: run.phase });
    run.rootEnded = true;
    try {
      saveRun(deps, run);
    } catch (_error) {
      // the root is closed in the trace; a later collect tries the bookkeeping again
    }
  }
  return answer;
}

async function collectStages(input, deps, ctx) {
  const startedAt = deps.now();
  const invalid = validateCollect(input);
  if (invalid !== null) return failure('RUN_FAILED', { reason: 'invalid-input', error: invalid });
  const now = input.now === undefined ? startedAt : typeof input.now === 'string' ? Date.parse(input.now) : input.now;

  const run = loadRun(deps, input.repoRoot, input.runId);
  if (run === null) return failure('RUN_FAILED', { reason: 'run-not-found', error: `no run ${input.runId} under ${input.repoRoot}` });
  if (run === undefined) return failure('RUN_FAILED', { reason: 'run-unreadable', error: 'run.json is not a run of this version' });
  const tracer = safeTracer(deps, run.traceRunId);
  ctx.run = run;
  ctx.tracer = tracer;

  if (['invalidated', 'needs-full-mode', 'failed'].includes(run.phase)) return run.result;

  // Every other call, in every stored phase (a finished run's replay included), first checks the record against its own mode:
  // the stored label must be selectMode's answer for the stored tier, and a full run must still be Deep, with its lane.
  const downgraded = F.modeInvariant(run);
  if (downgraded !== null) return terminate(run, 'failed', failure('RUN_FAILED', { reason: 'mode-invariant', error: downgraded, runId: run.runId }), 'collect', startedAt, deps);
  if (input.triage !== undefined && run.phase !== 'triage') return failure('RUN_FAILED', { reason: 'triage-not-pending', error: `run ${run.runId} is not waiting for triage (phase ${run.phase})`, runId: run.runId });

  // ---- a finished run: the stored answer, or an adjudication of what it listed
  if (run.phase === 'done') {
    // The stored answer is for the head the run reviewed. It is returned (or adjudicated) only while the host still states
    // that head on an OPEN PR: a head that moved invalidates it whatever it said (AC4). Nothing is recorded here, so if
    // the head comes back to the reviewed commit the stored answer is that commit's answer again.
    const live = await readHead(deps);
    if (!live.ok) return failure('RUN_FAILED', { reason: 'head-unreadable', error: live.error, runId: run.runId });
    if (live.headSha !== run.headSha) {
      return failure('RUN_INVALIDATED', { reason: 'head-moved', runId: run.runId, expectedHead: run.headSha, currentHead: live.headSha, error: 'the head moved after this run finished: its stored answer is for the old head and is not returned' });
    }
    if (live.pr.state !== 'OPEN') return notOpen(live.pr.state, run.runId);
    const stored = deps.fs.readText(path.join(runDirOf(run.repoRoot, run.runId), 'final.json'));
    let final = null;
    try {
      final = stored === null ? null : JSON.parse(stored);
    } catch (_error) {
      final = null;
    }
    if (!isObject(final)) return failure('RUN_FAILED', { reason: 'final-unreadable', error: 'final.json of a done run cannot be read', runId: run.runId });
    if (input.adjudications === undefined) return final;
    const listed = S.adjudicateList(run.finalLedger);
    const applied = applyAdjudications(run.finalLedger, listed, input.adjudications, now);
    if (applied.ok !== true) return failure('RUN_FAILED', { reason: 'adjudication-refused', error: applied.reason, runId: run.runId });
    const history = [...(run.adjudications || []), ...input.adjudications];
    const outcome = await finalise(run, { ledger: applied.ledger, tally: run.votesResult }, deps, now, startedAt, tracer, { call: 'collect', adjudications: history });
    // The stored answer stays the answer for the old head: a moved head decides nothing new.
    return outcome.invalid ? outcome.invalid : outcome.answer;
  }

  // ---- 1. the head, re-read: never advance on an unconfirmed head
  const head = await readHead(deps);
  if (!head.ok) return failure('RUN_FAILED', { reason: 'head-unreadable', error: head.error, runId: run.runId });
  if (head.headSha !== run.headSha) {
    return terminate(run, 'invalidated', failure('RUN_INVALIDATED', { reason: 'head-moved', runId: run.runId, expectedHead: run.headSha, currentHead: head.headSha }), 'collect', startedAt, deps);
  }
  if (head.pr.state !== 'OPEN') return notOpen(head.pr.state, run.runId);

  // ---- 1b. a full run waits here for the orchestrator's triage; it cannot reach the ledger without passing through it
  if (run.phase === 'triage') {
    const triaged = triageStep(run, input, deps, tracer, startedAt, now);
    if (triaged !== null) return triaged;
  }

  // ---- 2. the outstanding wave
  const wave = run.waves.find((w) => w.status === 'dispatched');
  if (wave !== undefined) {
    const collected = await settle(() => deps.collectResults({ expected: expectedOf(wave), dir: path.join(runDirOf(run.repoRoot, run.runId), 'results', wave.round), now }));
    if (!isObject(collected) || !Array.isArray(collected.agents)) {
      return failure('RUN_FAILED', { reason: 'collect-refused', error: isObject(collected) ? collected.reason || collected.error : 'no answer', runId: run.runId });
    }
    const pending = collected.agents.filter((a) => a.pending === true);
    if (pending.length > 0) {
      const earliest = Math.min(...pending.map((a) => a.deadlineAt));
      logCall(run, 'collect', startedAt, deps);
      saveRun(deps, run);
      return { ok: true, status: 'PENDING', runId: run.runId, round: wave.round, wave: `${wave.wave} of ${wave.of}`, waitingOn: pending.map((a) => a.name), retryAfterMs: Math.max(1000, Math.min(15000, earliest - now)), earliestDeadlineAt: earliest, earliestDeadlineAtIso: new Date(earliest).toISOString() };
    }
    recordWave(run, wave, collected, now, tracer, deps);
    saveRun(deps, run);
  }

  // ---- 3. what comes next: another planned wave, the verify round, or the end
  const next = run.waves.find((w) => w.status === 'planned');
  if (next !== undefined) return emit(run, next, deps, tracer, startedAt, now);

  if (run.candidates === undefined) {
    const isFull = run.mode.mode === 'full';
    const failed = processReview(run, deps, { deferVerification: isFull });
    if (failed !== null) return terminate(run, 'failed', { ...failed, runId: run.runId }, 'collect', startedAt, deps);
    if (isFull) {
      run.phase = 'triage';
      run.triage = { turns: 0, requested: 0, additionalCandidateIds: [], mergedIntoExisting: 0 };
      logCall(run, 'collect', startedAt, deps, false, { triage: true });
      saveRun(deps, run);
      return triageManifest(run, deps);
    }
    if (run.verifyAgents.length > 0) {
      addWaves(run, 'verify', run.verifyAgents);
      return emit(run, run.waves.find((w) => w.status === 'planned'), deps, tracer, startedAt, now);
    }
    saveRun(deps, run);
  }

  const built = buildLedger(run);
  if (built.ok !== true) return terminate(run, 'failed', failure('RUN_FAILED', { reason: 'ledger-refused', error: built.reason, runId: run.runId }), 'collect', startedAt, deps);
  const validation = validateLedger(built.ledger);
  if (validation.ok !== true) return terminate(run, 'failed', failure('RUN_FAILED', { reason: 'ledger-unusable', error: `findings fail validation: ${validation.offendingIds.join(', ')}`, runId: run.runId }), 'collect', startedAt, deps);

  const outcome = await finalise(run, built, deps, now, startedAt, tracer, { call: 'collect', flags: run.phase === 'triaged' ? { triage: true } : {} });
  if (outcome.invalid) {
    return outcome.moved ? terminate(run, 'invalidated', outcome.invalid, 'collect', startedAt, deps) : outcome.invalid;
  }
  return outcome.answer;
}

function emit(run, wave, deps, tracer, startedAt, now, flags = {}) {
  try {
    dispatchWave(run, wave, now, deps, tracer);
  } catch (error) {
    return terminate(run, 'failed', failure('RUN_FAILED', { reason: 'dispatch-failed', error: msg(error), runId: run.runId }), 'collect', startedAt, deps);
  }
  run.phase = wave.round === 'review' ? 'review-dispatched' : 'verify-dispatched';
  logCall(run, 'collect', startedAt, deps, false, flags);
  saveRun(deps, run);
  return manifestOf(run, wave);
}

module.exports = { prepareRun, collectRun, planRunSlices, PREPARE_KEYS, COLLECT_KEYS, RUN_SUBDIR, LANE_NAME, SCHEMA, RULES };
