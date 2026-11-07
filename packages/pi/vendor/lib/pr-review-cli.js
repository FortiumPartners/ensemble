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
 * Usage: node pr-review-cli.js <scope|review-range|ledger|remote|status|state-read|state-write|policy|rules|paths|description|votes|verify-assign|depth|slices|tier|mode|approvals|gate|explainer-offer|brief|metrics|metrics-compare|eval-score|eval-compare|eval-stale|reachability> < payload.json
 *
 * `review-range` (TRD-013) is a thin pass-through to `chooseReviewRange`:
 * given `lastReviewedSha`, `commits` and `remediationShas` on top of what
 * `scope` takes, it answers whether the next review is a `delta` against the
 * previously reviewed head or must fall back to the `full` base-correct
 * range -- the skill calls this for every round after the first (AC-010-1).
 *
 * `ledger` exposes six independent library functions; the payload selects
 * one via `action` (validate|isActionable|dedupe|merge|scopeViolations|recordRound) and
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
 *   status     { baseSha, headSha, reviewedHeadSha, findingCounts{ total, actionable, deferred }, tests?, remotePhase?,
 *                reviewedTreeSha?, headTreeSha?, roundsUsed?, roundCap?, access?, prUrl?, reportPath?, reviewOnly? }
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
 *   brief            { role: reviewer|verifier|classifier|second-assessor|security-lane,
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
 *   slices  { paths[{ path, lines }], areas?, threshold?, reviewed?, changedPaths? }
 *           -- plans the areas and, when `reviewed` slice ids are given, names
 *           every changed path they did not cover
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
 *   gate       { ledger[], approvals, tier?, description, security{ status, findings?, reason? },
 *                headSha?, unavailable?[] }
 *              -- the one answer to "may this PR merge?", with every blocker
 *              carrying its code, message and next action
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
} = require('./pr-review-ledger');
const { evaluateRemoteReview } = require('./pr-review-remote');
const { deriveStatus } = require('./pr-review-status');
const { statePath, writeState, readState, redact } = require('./pr-review-state');
const { loadPolicy } = require('./pr-review-policy');
const { resolveRuleFiles } = require('./pr-review-rules');
const { classifyPaths } = require('./pr-review-paths');
const { checkDescription } = require('./pr-review-description');
const { tallyVotes } = require('./pr-review-votes');
const { planVerification } = require('./pr-review-verify-assign');
const { resolveDepth, checkBounds, boundsFor, planSlices, verifyCoverage } = require('./pr-review-depth');
const { offerExplainers } = require('./pr-review-explainer-offer');
const { renderBriefFromFiles } = require('./pr-review-brief-files');
const { assignTier, effectiveTier, tierRecord } = require('./pr-review-tier');
const { selectMode } = require('./pr-review-mode');
const { evaluateApprovals } = require('./pr-review-approvals');
const { evaluateGate } = require('./pr-review-gate');
const { computeMetrics, compareCohorts } = require('./pr-review-metrics');
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
 * `votes` is a pass-through. `depth` and `slices` each call exactly two
 * functions of their one module -- resolve then grade, plan then verify --
 * because that is the single question the skill asks; the dispatcher still
 * decides nothing itself, and the only value it combines is `ok`, which it
 * can only make stricter.
 */
function runVotes(payload) {
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
 * `slices` plans the review by area and, when the caller names the slice ids
 * it actually reviewed, says which changed paths that left uncovered
 * (AC-018-1, AC-018-2). A plan the module refused is returned as the refusal
 * it is: coverage is never computed over an empty plan, because "no slices,
 * all reviewed" is exactly the false pass this gate exists to prevent.
 */
function runSlices(payload) {
  const plan = planSlices(payload);
  const request = isObject(payload) ? payload : {};
  if (!plan.ok || request.reviewed === undefined) return plan;

  const coverage = verifyCoverage({
    slices: plan.slices,
    reviewed: request.reviewed,
    changedPaths: request.changedPaths,
  });

  const result = {
    ...plan,
    ok: plan.ok && coverage.ok && coverage.covered,
    covered: coverage.covered,
    uncovered: coverage.uncovered,
    reviewedSlices: coverage.reviewedSlices,
    unreviewedSlices: coverage.unreviewedSlices,
    unknownReviewed: coverage.unknownReviewed,
  };
  if (coverage.reason !== undefined) result.coverageReason = coverage.reason;
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

function runGate(payload) {
  return evaluateGate(payload);
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
        error: `Unknown subcommand ${shown(subcommand)}. Usage: pr-review-cli <scope|review-range|ledger|remote|status|state-read|state-write|policy|rules|paths|description|votes|verify-assign|depth|slices|tier|mode|approvals|gate|explainer-offer|brief|metrics|metrics-compare|eval-score|eval-compare|eval-stale|reachability> < payload.json`,
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
  runApprovals,
  runGate,
  runExplainerOffer,
  runBrief,
  runMetrics,
  runMetricsCompare,
  runEvalScore,
  runEvalCompare,
  runEvalStale,
  LEDGER_ACTIONS,
  HANDLERS,
  main,
};

if (require.main === module) {
  const code = main(process.argv.slice(2));
  process.exit(code);
}
