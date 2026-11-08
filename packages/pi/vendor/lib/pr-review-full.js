'use strict';

/**
 * pr-review-full.js -- the rules that make review-run's FULL mode more than the light mode with a different label
 * (kata dqcs, epic ptqb, docs/plans/pr-review-speedup-plan.md section 3G). LOGIC ONLY.
 *
 * NO side effects, NO shell, NO network, NO file reads: plain JSON in, plain JSON out, like the other pr-review-*
 * libraries. `pr-review-run.js` calls these over the facts it already holds.
 *
 * One runner, two modes. Full mode differs from light in exactly four things and nothing else, and the fourth changes what
 * the runner RECORDS, not what a reviewer reads: reviewers read the whole range in both modes until verdict carry-over
 * (kata qw98) lands.
 *   1. Deep depth always (`FULL_DEPTH_TIER`): at least 2 reviewers per slice and 5 verifiers per finding, whatever the
 *      tier word says -- an unreadable tier has no depth of its own, and the runner must not hand it a lighter one;
 *   2. the security lane always;
 *   3. a model-orchestrator TRIAGE stop between the review round and the verify round (`validateTriage`): the one
 *      place the orchestrator may act, and it may only ADD candidates the reviewers missed;
 *   4. the re-review scope rule (`planReReview`): delta only when nothing makes a delta unsafe, a full re-read otherwise;
 *      recorded in the run and in the answers, with `appliedRange` always `full-range` today.
 *
 * `modeInvariant` is the guard behind "no code path downgrades a full run": it reads the stored run, refuses a mode label
 * that is not what `selectMode` says for the tier the run stores (rewritten to light, removed or unknown), and refuses a
 * full run whose depth, security lane or verifier count is below what full mode requires.
 */

const { selectMode } = require('./pr-review-mode');

/** The tier the full mode plans its depth from, whatever the record says. */
const FULL_DEPTH_TIER = 'high';

/** Deep: the numbers `depth` gives the High tier (plan section 3A/3G). Read by `modeInvariant`; planned by `planDepth`. */
const FULL_MIN_REVIEWERS = 2;
const FULL_MIN_VERIFIERS = 5;

/** The most candidates one triage may add: a bound on what one model turn can push into a verification round. */
const MAX_ADDITIONAL_CANDIDATES = 20;
const TRIAGE_KEYS = Object.freeze(['additionalCandidates']);
const CANDIDATE_KEYS = Object.freeze(['locationOrLink', 'failureMode', 'severity', 'evidence']);
/** `pre-existing` is a provenance claim the runner checks against the diff for a reviewer; the orchestrator has no standing to make it. */
const TRIAGE_SEVERITIES = Object.freeze(['important', 'nit']);
const ORCHESTRATOR = 'orchestrator';

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isText = (value) => typeof value === 'string' && value.trim() !== '';
const sameSha = (a, b) => isText(a) && isText(b) && a.toLowerCase() === b.toLowerCase();
const stringList = (value) => Array.isArray(value) && value.every(isText);

/**
 * What a re-review of a new head reads, for a FULL-mode run.
 *
 * `delta` only when every one of these holds: a previous reviewed head was supplied, the prepared range is a delta whose
 * plan (`planDeltaReview`) is `delta`, the review state on record names that head (the CLI has seen it), the delta's
 * paths are all classified by this run's own path facts, and none of them is High or sensitive. Anything else is a FULL
 * re-read, with every applicable reason listed. The plan module already refuses a delta for these; this is checked again
 * from the run's own classification so that a plan that is missing, stale or wrong cannot narrow a High-tier review.
 *
 * `appliedRange` states what the runner actually has the reviewers read: today always the whole range (the superset),
 * because verdict carry-over (kata qw98) is what lets a round read only a delta and still account for every path.
 *
 * @param {{lastReviewedSha?:string, rangeMode?:string, deltaPlan?:Object, delta?:Object, paths?:Object}} input
 * @returns {{scope:'first-review'|'delta'|'full', reasons:string[], appliedRange:'full-range'}}
 */
function planReReview(input) {
  const request = isObject(input) ? input : {};
  const answer = (scope, reasons) => ({ scope, reasons: [...new Set(reasons)], appliedRange: 'full-range' });
  if (request.lastReviewedSha === undefined || request.lastReviewedSha === null) return answer('first-review', ['no-previous-head']);

  const reasons = [];
  if (!isText(request.lastReviewedSha)) reasons.push('previous-head-unreadable');
  if (request.rangeMode !== 'delta') reasons.push('range-is-full');
  const plan = request.deltaPlan;
  if (!isObject(plan) || plan.mode !== 'delta') {
    reasons.push('delta-plan-full');
    if (isObject(plan) && stringList(plan.reasons)) reasons.push(...plan.reasons);
  }
  const delta = request.delta;
  if (!isObject(delta) || !stringList(delta.changedPaths)) {
    reasons.push('delta-unreadable');
  } else {
    if (delta.changedPaths.length === 0) reasons.push('empty-delta');
    // The CLI has seen a head only when the review state it wrote names it (the plan's own `reviewed.headSha`).
    if (!sameSha(delta.reviewedHeadSha, request.lastReviewedSha)) reasons.push('head-never-seen');
    const classified = isObject(request.paths) && Array.isArray(request.paths.paths) ? request.paths.paths : null;
    if (classified === null || !Array.isArray(request.paths.high) || !Array.isArray(request.paths.sensitive)) {
      reasons.push('classification-unreadable');
    } else {
      const byPath = new Map(classified.filter((entry) => isObject(entry) && isText(entry.path)).map((entry) => [entry.path, entry]));
      for (const file of delta.changedPaths) {
        const entry = byPath.get(file);
        if (entry === undefined) reasons.push('classification-incomplete');
        else {
          if (entry.high === true || request.paths.high.includes(file)) reasons.push('high-path-touched');
          if (entry.sensitive === true || entry.declarationFile === true || request.paths.sensitive.includes(file)) reasons.push('sensitive-path-touched');
        }
      }
    }
  }
  return answer(reasons.length === 0 ? 'delta' : 'full', reasons);
}

/** `file:line` or `file:start-end`, the only location a verifier can be briefed with. */
const FILE_LINE = /^[^\s:][^:\r\n]*:\d+(?:-\d+)?$/;

/** A repository-relative path: no absolute or home-relative start, no backslash or NUL, no empty, `.` or `..` segment. */
function isRepoRelative(location) {
  const file = location.slice(0, location.lastIndexOf(':'));
  return !(file.startsWith('/') || file.startsWith('~') || /[\\\0]/.test(file)) && file.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

/**
 * Validates a triage payload: `{ additionalCandidates: [{locationOrLink, failureMode, severity?, evidence?}] }`.
 * Triage can only ADD: there is no key that removes, merges away, re-grades, closes or waives a candidate, and an unknown
 * key is refused rather than ignored.
 *
 * @returns {{ok:true, additional:Array<Object>} | {ok:false, reason:string}}
 */
function validateTriage(triage) {
  if (!isObject(triage)) return { ok: false, reason: 'triage must be a JSON object' };
  for (const key of Object.keys(triage)) if (!TRIAGE_KEYS.includes(key)) return { ok: false, reason: `unknown triage key ${JSON.stringify(key)}: triage can only add candidates (additionalCandidates)` };
  const list = triage.additionalCandidates === undefined ? [] : triage.additionalCandidates;
  if (!Array.isArray(list)) return { ok: false, reason: 'additionalCandidates must be an array' };
  if (list.length > MAX_ADDITIONAL_CANDIDATES) return { ok: false, reason: `at most ${MAX_ADDITIONAL_CANDIDATES} additional candidates` };
  const additional = [];
  for (const [index, item] of list.entries()) {
    const at = `additionalCandidates[${index}]`;
    if (!isObject(item)) return { ok: false, reason: `${at} must be an object` };
    for (const key of Object.keys(item)) if (!CANDIDATE_KEYS.includes(key)) return { ok: false, reason: `${at}: unknown key ${JSON.stringify(key)}` };
    if (!isText(item.locationOrLink) || !FILE_LINE.test(item.locationOrLink.trim()) || !isRepoRelative(item.locationOrLink.trim())) return { ok: false, reason: `${at}.locationOrLink must be "path/to/file:line" (or "file:start-end") with a repository-relative path (no absolute, home-relative or ".." path): a verifier is briefed with the claim and that location` };
    if (!isText(item.failureMode)) return { ok: false, reason: `${at}.failureMode must say, in a sentence, what goes wrong` };
    if (item.severity !== undefined && !TRIAGE_SEVERITIES.includes(item.severity)) return { ok: false, reason: `${at}.severity must be one of ${TRIAGE_SEVERITIES.join(', ')} (a pre-existing label is not the orchestrator's to give)` };
    if (item.evidence !== undefined && !isText(item.evidence)) return { ok: false, reason: `${at}.evidence must be text` };
    additional.push({
      locationOrLink: item.locationOrLink.trim(),
      failureMode: item.failureMode,
      severity: item.severity === undefined ? 'important' : item.severity,
      disposition: 'fix',
      evidence: item.evidence === undefined ? 'raised by the orchestrator at triage; not yet verified' : item.evidence,
      originalTextOrLink: item.locationOrLink.trim(),
    });
  }
  return { ok: true, additional };
}

/**
 * Why a stored run is no longer the run `prepare` made, or null.
 *
 * The mode LABEL is part of the invariant. Every later call reads `run.mode.mode` (stop at TRIAGE or not, which mode an
 * answer reports), so a label that was rewritten, removed or is unknown is refused: the stored label must be what
 * `selectMode` says for the tier the run itself stores, which is how `prepare` chose it. This only CHECKS the label: the
 * stored mode is still the only mode there is, and nothing here picks or changes one. The same check refuses a tier that was
 * lowered under a full label.
 *
 * A full run must also still have what full mode requires: Deep depth, at least the full reviewer and verifier counts and the
 * security lane. A light run is checked for its label only; its depth is its own tier's.
 *
 * The honest limit: `run.json` is local state nobody authenticates. This refuses a record that contradicts itself, so an edit
 * of the label, the depth, the lane or the tier alone is caught; whoever can write the run directory can still rewrite the
 * tier, label, depth and lane together into a consistent light run.
 *
 * @param {Object} run  A stored run (`run.mode.mode`, `run.tier`, `run.depth`, `run.securityLane`).
 * @returns {string|null}
 */
function modeInvariant(run) {
  const stored = isObject(run) && isObject(run.mode) ? run.mode.mode : undefined;
  const selected = selectMode(isObject(run) ? run.tier : undefined).mode;
  if (stored !== selected) {
    return `the run records ${stored === undefined ? 'no mode' : `mode ${JSON.stringify(stored)}`}, but the tier it stores selects ${selected}: a stored mode is only ever selectMode's answer for its tier, so this record was edited after prepare (or written by a version with other rules); start a new run`;
  }
  if (selected !== 'full') return null;
  const depth = isObject(run.depth) ? run.depth : {};
  if (depth.mode !== 'deep') return `full mode requires deep depth, the run records ${JSON.stringify(depth.mode)}`;
  if (!Number.isInteger(depth.reviewersPerSlice) || depth.reviewersPerSlice < FULL_MIN_REVIEWERS) return `full mode requires at least ${FULL_MIN_REVIEWERS} reviewers per slice, the run records ${JSON.stringify(depth.reviewersPerSlice)}`;
  if (!Number.isInteger(depth.verifiersPerCandidate) || depth.verifiersPerCandidate < FULL_MIN_VERIFIERS) return `full mode requires at least ${FULL_MIN_VERIFIERS} verifiers per finding, the run records ${JSON.stringify(depth.verifiersPerCandidate)}`;
  if (run.securityLane !== true) return 'full mode requires the security lane';
  return null;
}

module.exports = {
  planReReview,
  validateTriage,
  modeInvariant,
  FULL_DEPTH_TIER,
  FULL_MIN_REVIEWERS,
  FULL_MIN_VERIFIERS,
  MAX_ADDITIONAL_CANDIDATES,
  ORCHESTRATOR,
};
