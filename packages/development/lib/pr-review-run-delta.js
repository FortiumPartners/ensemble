'use strict';

/**
 * Delta re-review for the review runner (kata xb4j; plan 3B of docs/plans/pr-review-speedup-plan.md).
 *
 * `pr-review-run.js` calls these steps itself, so a re-review of a head after a fix push needs nothing from the orchestrator
 * but `lastReviewedSha`:
 *
 *   1. `priorRound`    what the runner knows about the last round: the review state it WROTE at `lastReviewedSha`, bound to
 *                      the run record that wrote it. The previously reviewed head and base come from there and nowhere
 *                      else, so prepare's `reviewedHeadSha` / `reviewedBaseSha` are never caller words. Anything missing,
 *                      unreadable or incomplete is a reason, and the round is a FULL review (head-never-seen).
 *   2. `deltaScope`    what a delta round reads: the delta plan's read set (changed paths, their callers and tests) and the
 *                      sizes of the delta diff, so the slices, the agents and the coverage are those of the delta.
 *   3. `hashCandidates` / `planRunCarry`  every candidate is hashed at the head (lib/pr-review-carry-hash.js) and judged by
 *                      `planCarry` (lib/pr-review-carry.js) against the prior round's verdicts: the ones whose cited hunk and
 *                      dependencies are untouched keep their verdict (no verifier is asked), every other one is verified again.
 *   4. `composeDeltaLedger`  the round's ledger is the prior ledger (carried entries restamped with this head, findings the
 *                      push fixed cleared by `deriveCleared`, findings re-reported replaced by their fresh entry) plus the
 *                      fresh entries, so a finding in code nobody re-read is never dropped.
 *
 * Pure apart from what the caller injects (`read`, `git` through `hashCitations`/`deriveCleared`): NO shell, NO network of its own.
 * Every unreadable input is a reason and a full read or a fresh verification, never a silent skip.
 */

const path = require('path');
const { isObjectId } = require('./pr-review-scope');
const { planCarry, recordVerdicts, stampLedger, keyOf } = require('./pr-review-carry');
const { tallyVotes, resolveExpected } = require('./pr-review-votes');

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isText = (value) => typeof value === 'string' && value.trim() !== '';
const sameId = (a, b) => isObjectId(a) && isObjectId(b) && a.toLowerCase() === b.toLowerCase();
const identity = (value) => (isText(value) ? value.trim() : Number.isFinite(value) ? String(value) : null);

/** The lists of a state report's `notReviewed` that must all be empty before the round can stand for the paths a delta does not read. */
const NOT_REVIEWED_LISTS = Object.freeze(['unreviewedSlices', 'unreviewedPaths', 'underReviewedPaths', 'incompleteVerifiers', 'unbriefable', 'expiredAgents']);

/**
 * What a delta round does NOT see, said in its answer (kata xb4j review): the plan's read set is the changed files, their direct
 * importers, their tests and name matches, so a module the changed file itself imports, a caller of a caller, and anything the
 * graph cannot resolve are in no read set (the security lane and the whole-range reader keep the whole range); the carry's own
 * declared limits hold (direct dependents only, bare npm packages and lockfile changes unseen, symlinks and computed specifiers
 * fail closed); a High or sensitive file can be in the read set as a caller of a changed file, while a changed path never is.
 */
function deltaLimits({ lane, reader, triage }) {
  const whole = [lane ? 'the security lane' : null, reader ? 'the whole-range reader' : null, triage ? 'the TRIAGE step' : null].filter((name) => name !== null);
  return Object.freeze([
    'read-set: changed files, their direct importers and tests, and name matches; not the modules a changed file imports, nor callers of callers',
    whole.length > 0 ? `read on the whole range in this round: ${whole.join(', ')}` : 'no agent of this round reads the whole range: a defect outside the read set is seen by no one',
    'carry: direct dependents only; bare npm packages and lockfile changes are not seen; symlinks and computed specifiers re-verify',
    'a High or sensitive file can be in the read set as a caller of a changed file; a changed path never is',
    'remediationShas is the caller\'s statement of which commits are the fix round\'s own',
  ]);
}

const no = (reason) => ({ ok: false, reason });

/**
 * What the last round recorded, or why there is none the runner can stand on.
 *
 * @param {Object} input
 * @param {function(string):Object} input.read      `readState(statePath, head)` bound to this PR's report.
 * @param {function(string):?Object} input.readRun  The `run.json` of a run id (null when absent or unreadable).
 * @param {string|number} input.pr
 * @param {string} input.lastReviewedSha
 * @returns {{ok:true, state:Object, runId:string}|{ok:false, reason:string}}
 */
function priorRound(input) {
  const { read, readRun, pr, lastReviewedSha } = input;
  if (typeof read !== 'function' || typeof readRun !== 'function') return no('state-reader-unavailable');
  let result;
  try {
    result = read(lastReviewedSha);
  } catch (_error) {
    return no('state-unreadable');
  }
  if (!isObject(result) || result.ok !== true) return no('state-unreadable');
  if (result.exists !== true) return no('state-absent');
  if (result.discarded === true || !isObject(result.state)) return no('state-other-head');
  const state = result.state;
  if (identity(state.prId) !== identity(pr)) return no('state-other-pr');
  // The head the report says it reviewed is the one named, and is also the head the report was written for.
  if (!sameId(state.reviewedHeadSha, lastReviewedSha) || !sameId(state.headSha, lastReviewedSha)) return no('state-other-head');
  if (!isObjectId(state.baseSha)) return no('state-base-unknown');
  if (!isText(state.runId)) return no('state-not-from-a-run');

  // A report counts only as the verdict of a finished run: the run record it names says the same head, base and PR, and done.
  let run = null;
  try {
    run = readRun(state.runId);
  } catch (_error) {
    run = null;
  }
  if (!isObject(run) || run.phase !== 'done' || !sameId(run.headSha, lastReviewedSha) || !sameId(run.baseSha, state.baseSha) || identity(run.pr) !== identity(pr)) {
    return no('state-run-record-mismatch');
  }

  if (!Array.isArray(state.ledger) || !state.ledger.every(isObject)) return no('state-ledger-unreadable');
  if (!Array.isArray(state.verdicts) || !state.verdicts.every(isObject)) return no('state-verdicts-unrecorded');
  // A delta read stands for the rest of the PR only when the round it follows read all of it.
  const notReviewed = state.notReviewed;
  if (!isObject(notReviewed) || NOT_REVIEWED_LISTS.some((key) => !Array.isArray(notReviewed[key]) || notReviewed[key].length > 0)) {
    return no('state-round-incomplete');
  }
  // The security lane's findings are not in the ledger: a delta round would drop them, so a round that holds any is re-read whole.
  const security = state.security;
  if (!isObject(security) || (security.status !== 'clean' && security.status !== 'not-run')) return no('state-security-open');
  return { ok: true, state, runId: state.runId };
}

/**
 * What a delta round reads, from the delta plan of the prepared facts.
 *
 * @param {{deltaPlan:Object, delta:Object}} facts
 * @param {?string} deltaDiffText  The text of `delta.diff` (it must be readable; the line counts come from git's own numstat in `facts.delta.numstat`).
 * @returns {{ok:true, readPaths:string[], numstat:Object[], changedPaths:string[]}|{ok:false, reason:string}}
 */
function deltaScope(facts, deltaDiffText) {
  const plan = isObject(facts) ? facts.deltaPlan : undefined;
  if (!isObject(plan) || plan.mode !== 'delta' || !Array.isArray(plan.readSet) || plan.readSet.length === 0) return no('delta-read-set-unreadable');
  if (!plan.readSet.every((entry) => isObject(entry) && isText(entry.path))) return no('delta-read-set-unreadable');
  if (!isObject(facts.delta) || !Array.isArray(facts.delta.changedPaths) || !facts.delta.changedPaths.every(isText) || facts.delta.changedPaths.length === 0) return no('delta-paths-unreadable');
  if (typeof deltaDiffText !== 'string') return no('delta-diff-unreadable');
  const readPaths = [...new Set(plan.readSet.map((entry) => entry.path))].sort();
  // git's own per-path counts (`diff --numstat -z`, names verbatim: a quoted name in a diff header is never parsed here); a read-set
  // caller the push did not change has no hunk and counts 0
  const counts = new Map();
  for (const entry of Array.isArray(facts.delta.numstat) ? facts.delta.numstat : []) if (isObject(entry) && isText(entry.path)) counts.set(entry.path, entry);
  if (!facts.delta.changedPaths.every((file) => counts.has(file))) return no('delta-numstat-unreadable');
  const numstat = readPaths.map((file) => {
    const entry = counts.get(file);
    return entry === undefined ? { path: file, added: 0, deleted: 0, binary: false } : { path: file, added: entry.added, deleted: entry.deleted, binary: entry.binary === true };
  });
  return { ok: true, readPaths, changedPaths: facts.delta.changedPaths, numstat };
}

/** The numbers after the highest `f<N>` among the ids of a ledger (and what they merged), so a new round's ids never collide with it. */
function idSeed(ledger) {
  let top = 0;
  for (const entry of ledger) {
    const ids = [entry.id, ...(Array.isArray(entry.mergedFrom) ? entry.mergedFrom.map((m) => isObject(m) ? m.id : undefined) : [])];
    for (const id of ids) {
      const match = /^f(\d+)$/.exec(String(id));
      if (match !== null) top = Math.max(top, Number(match[1]));
    }
  }
  return top;
}

/** `{file, line}` or `{file, lines}` of a plain `file:line` / `file:start-end` location (the snapshot prefix stripped), else `{}`. */
function citationOf(location, snapshotDir) {
  const match = isText(location) ? /^([^:]+):(\d+)(?:-(\d+))?$/.exec(location.trim()) : null;
  if (match === null) return {};
  let file = match[1];
  if (isText(snapshotDir)) {
    const prefix = `${snapshotDir.replace(/\/+$/, '')}/`;
    if (file.startsWith(prefix)) file = file.slice(prefix.length);
  }
  file = path.posix.normalize(file);
  if (file === '.' || file === '..' || file.startsWith('/') || file.startsWith('../')) return {};
  const first = Number(match[2]);
  if (match[3] === undefined) return { file, line: first };
  return { file, lines: [first, Number(match[3])] };
}

/**
 * Hashes every candidate at the head. Never throws and never returns fewer entries than candidates: a candidate that cannot be
 * hashed (a link, a path the head does not hold, a failed git read, no hasher at all) comes back stamped with the head and
 * with NO hash, which the carry reads as "re-verify" and the verdict record reads as "not recorded".
 *
 * @returns {Object[]} one entry per candidate: `{id, file?, line|lines?, claim, headSha, hunkHash?, depHashes?, dependents?, hashError?}`
 */
function hashCandidates(run, candidates, hash) {
  const citations = candidates.map((candidate) => ({ id: candidate.id, ...citationOf(candidate.locationOrLink, run.prepared && run.prepared.snapshotDir), claim: typeof candidate.failureMode === 'string' ? candidate.failureMode : '' }));
  const unhashed = (reason) => citations.map((citation) => ({ ...citation, headSha: run.headSha, hashError: reason }));
  if (citations.length === 0) return [];
  if (typeof hash !== 'function') return unhashed('no hasher');
  let answer;
  try {
    answer = hash({ repoRoot: run.repoRoot, headSha: run.headSha, citations });
  } catch (error) {
    return unhashed(`hash step threw: ${error && error.message ? error.message : String(error)}`);
  }
  if (!isObject(answer) || answer.ok !== true || !Array.isArray(answer.candidates) || answer.candidates.length !== citations.length) {
    return unhashed(isObject(answer) && isText(answer.error) ? answer.error : 'hash step returned nothing usable');
  }
  return answer.candidates;
}

/** The carry facts of a run, copied from the prepared facts: the delta, its range and the High / sensitive paths. */
function carryFacts(facts) {
  const high = isObject(facts.paths) ? [...(Array.isArray(facts.paths.high) ? facts.paths.high : []), ...(Array.isArray(facts.paths.sensitive) ? facts.paths.sensitive : [])] : null;
  return {
    deltaPlan: facts.deltaPlan,
    deltaPaths: isObject(facts.delta) ? facts.delta.changedPaths : undefined,
    deltaRange: { headSha: facts.headSha, lastReviewedSha: isObject(facts.delta) ? facts.delta.lastReviewedSha : undefined },
    highPaths: high === null ? undefined : [...new Set(high.map((entry) => (isObject(entry) ? entry.path : entry)))],
  };
}

/**
 * Which candidates keep the prior round's verdict. A candidate with no hash, a verdict whose hunk or dependencies the delta
 * touched, a High path, an unreadable ledger... all of `planCarry`'s reasons are re-verification, never a carry.
 *
 * @returns {{applied:true, carriedIds:string[], carried:Object[], tally:Object[], reverify:number, unmatched:number, reasons:string[], planOk:boolean}}
 *   `tally` is the votes outcome of each carried finding (its prior ledger id), counted again under this round's rule.
 */
function planRunCarry(run, hashed) {
  const prior = run.priorRound;
  const facts = run.carryFacts;
  const none = (reasons) => ({ applied: true, planOk: false, carriedIds: [], carried: [], tally: [], reverify: run.candidates.length, unmatched: 0, reasons });
  if (!isObject(prior) || !isObject(facts)) return none(['no-prior-round']);
  const plan = planCarry({
    prId: run.pr,
    baseSha: run.baseSha,
    headSha: run.headSha,
    lastReviewedSha: run.lastReviewedSha,
    depth: run.depth.mode,
    expectedVerifiers: run.depth.verifiersPerCandidate,
    deltaPlan: facts.deltaPlan,
    deltaPaths: facts.deltaPaths,
    deltaRange: facts.deltaRange,
    highPaths: facts.highPaths,
    priorVerdicts: prior.verdicts,
    priorLedger: prior.ledger,
    // The candidates' ids are this round's own (the prior verdicts carry the ids of the round that settled them), so a verdict
    // meets a candidate by file and claim alone.
    candidates: hashed.map(({ id: _id, ...rest }) => rest),
  });
  if (!isObject(plan) || plan.ok !== true) return none(isObject(plan) && Array.isArray(plan.reasons) && plan.reasons.length > 0 ? plan.reasons : ['carry-plan-refused']);

  const byKey = new Map();
  hashed.forEach((entry) => {
    const key = keyOf({ file: entry.file, claim: entry.claim });
    if (key !== null) byKey.set(key, entry);
  });
  const priorById = new Map(prior.ledger.map((entry) => [identity(entry.id), entry]));
  const expected = resolveExpected({ depth: run.depth.mode, expectedVerifiers: run.depth.verifiersPerCandidate });
  const carried = [];
  const carriedIds = [];
  const tally = [];
  // the round's own reasons, then why each candidate that was not carried is verified again
  const reasons = [...plan.reasons, ...plan.reverify.flatMap((entry) => (Array.isArray(entry.reasons) ? entry.reasons : []))];
  for (const record of plan.carried) {
    const candidate = byKey.get(keyOf(record));
    const entry = priorById.get(identity(record.id));
    if (candidate === undefined || entry === undefined || !expected.ok) {
      reasons.push('carried-record-unplaced');
      continue;
    }
    // The ledger finding meets this round's rule once more: the carried votes must give the very outcome the record holds.
    const tallied = tallyVotes({ findings: [{ ...entry, votes: record.votes, incompleteVerifiers: [] }], depth: run.depth.mode, expectedVerifiers: run.depth.verifiersPerCandidate });
    const result = tallied.ok === true ? tallied.findings[0] : undefined;
    if (result === undefined || result.outcome !== record.outcome) {
      reasons.push('carried-verdict-retally-differs');
      continue;
    }
    carried.push(record);
    carriedIds.push(String(candidate.id));
    tally.push(result);
  }
  // The restamp must be possible for every carried record, or none is carried.
  const stamped = stampLedger({ ledger: prior.ledger, carried, headSha: run.headSha });
  if (stamped.ok !== true) return none([...reasons, `stamp-refused: ${stamped.reason}`]);
  return { applied: true, planOk: true, carriedIds, carried, tally, reverify: plan.reverify.length, unmatched: plan.unmatched.length, reasons: [...new Set(reasons)] };
}

/**
 * The ledger of a delta round: the prior ledger brought to this head, then this round's fresh entries.
 *
 * @param {Object} run
 * @param {Object[]} fresh        The ledger entries of the candidates verified this round (the carried ones are the prior entries).
 * @param {function(Object):Object} derive  `deriveCleared`.
 * @returns {{ok:true, ledger:Object[], cleared:string[], notes:string[]}|{ok:false, reason:string}}
 */
function composeDeltaLedger(run, fresh, derive) {
  const prior = run.priorRound;
  const carry = run.carry;
  const carried = isObject(carry) ? carry.carried : [];
  let base = prior.ledger;
  if (carried.length > 0) {
    const stamped = stampLedger({ ledger: base, carried, headSha: run.headSha });
    if (stamped.ok !== true) return { ok: false, reason: `the prior ledger cannot be restamped: ${stamped.reason}` };
    base = stamped.ledger;
  }
  const carriedIds = new Set(isObject(carry) ? carry.carriedIds : []);
  const presented = [...fresh, ...run.candidates.filter((candidate) => carriedIds.has(String(candidate.id)))];
  const notes = [];
  let derived = null;
  if (typeof derive === 'function') {
    try {
      derived = derive({ cwd: run.repoRoot, baseSha: run.baseSha, headSha: run.headSha, lastReviewedSha: run.lastReviewedSha, ledger: base, incoming: presented });
    } catch (error) {
      derived = { ok: false, reason: error && error.message ? error.message : String(error) };
    }
  }
  if (!isObject(derived) || derived.ok !== true || !Array.isArray(derived.ledger)) {
    // Nothing is cleared and nothing is dropped: every prior finding keeps blocking, and a re-reported one appears twice.
    notes.push(`prior findings kept as recorded: ${isObject(derived) && isText(derived.reason) ? derived.reason : 'the fixed-finding check is unavailable'}`);
    return { ok: true, ledger: [...base, ...fresh], cleared: [], notes };
  }
  const replaced = new Set((Array.isArray(derived.kept) ? derived.kept : []).filter((k) => k.reason === 're-reported').map((k) => String(k.id)));
  const ledger = derived.ledger.filter((entry) => !replaced.has(String(entry.id)));
  return { ok: true, ledger: [...ledger, ...fresh], cleared: (derived.cleared || []).map((c) => String(c.id)), notes };
}

/**
 * The verdict records of a finished round, to be written into the state report: the carried records (restamped with this head)
 * and the verdicts this round settled, each joined to the hash made at this head.
 *
 * @returns {{verdicts:Object[], recorded:number, skipped:Object[]}}
 */
function verdictRecords(run, findings) {
  const carried = isObject(run.carry) && Array.isArray(run.carry.carried) ? run.carry.carried : [];
  const recorded = recordVerdicts({
    prId: run.pr,
    baseSha: run.baseSha,
    headSha: run.headSha,
    depth: run.depth.mode,
    expectedVerifiers: run.depth.verifiersPerCandidate,
    findings,
    candidates: Array.isArray(run.hashed) ? run.hashed : [],
  });
  const fresh = recorded.ok === true ? recorded.verdicts : [];
  return { verdicts: [...carried, ...fresh], recorded: fresh.length, skipped: recorded.ok === true ? recorded.skipped : [{ id: null, reason: recorded.reason }] };
}

module.exports = { deltaLimits, priorRound, deltaScope, idSeed, hashCandidates, carryFacts, planRunCarry, composeDeltaLedger, verdictRecords, NOT_REVIEWED_LISTS };
