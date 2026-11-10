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

/**
 * The lists of a state report's `notReviewed`, every one of which must be a list. Five of them must also be EMPTY before the round can
 * stand for the paths a delta does not read (`UNREAD_LISTS`): what no agent read (unreviewed slices and paths, paths read under too few
 * lenses), a claim no verifier could be asked about (`unbriefable`) and, kata 271n, a result file rewritten after the runner read it
 * (`changedResults`: the round counted the first version, so its verdicts may miss a vote or a finding and cannot be carried). The other
 * two (`VERIFIER_LISTS`) are what a verifier that did not return leaves, which is no gap in what was READ (kata p5dt): see
 * `verifierGapAccounted`.
 */
const NOT_REVIEWED_LISTS = Object.freeze(['unreviewedSlices', 'unreviewedPaths', 'underReviewedPaths', 'incompleteVerifiers', 'unbriefable', 'expiredAgents', 'changedResults']);
const VERIFIER_LISTS = Object.freeze(['incompleteVerifiers', 'expiredAgents']);
const UNREAD_LISTS = Object.freeze(NOT_REVIEWED_LISTS.filter((key) => !VERIFIER_LISTS.includes(key)));

/**
 * A finding the last round could not settle with its whole electorate because a verifier that was to vote on it did not return: the
 * `verifier-incomplete` outcome of the votes contract (`unverified`: presented and marked, never confirmed and never refuted), or, since
 * kata dx53, a finding `present` that a strict majority of the EXPECTED verifiers settled while the missing ones stayed named
 * (`verification.settledOnMajority`). The second is never carried (a carry needs every expected vote: `recordVerdicts` skips it), so a
 * delta round has to verify it again like the first: it is no more a verdict of this head than an unverified finding is.
 */
const lacksVerifier = (entry) => isObject(entry) && isObject(entry.verification)
  && ((entry.verification.outcome === 'unverified' && entry.verification.reason === 'verifier-incomplete')
    || (entry.verification.outcome === 'present' && entry.verification.settledOnMajority === true));
const settledOnMajority = (entry) => isObject(entry) && isObject(entry.verification) && entry.verification.settledOnMajority === true;

/** The findings of a ledger the last round left without their whole electorate for want of a verifier (see `lacksVerifier`) and that nothing has cleared since. */
const lastRoundUnverified = (ledger) => (Array.isArray(ledger) ? ledger.filter((entry) => lacksVerifier(entry) && entry.cleared !== true) : []);

/**
 * Whether the verifiers a round lost are accounted for by its ledger (kata p5dt). A verifier that returned nothing leaves no part of the
 * diff unread: the reviewers read every path and the lane found nothing, and each candidate the verifier held stands in the ledger
 * `unverified`, where a delta round can verify it again. So a round whose ONLY missing agents are verifiers is a delta base, provided
 * that every missing verifier is named with the candidates it was assigned, every one of those candidates stands in the ledger unverified
 * for want of a verifier (or settled on a majority without it, kata dx53), and the agents `expiredAgents` lists are exactly the verifiers `incompleteVerifiers` names. Anything that does
 * not add up is no base: a lost reviewer or security lane is never a verifier gap.
 *
 * @param {{incompleteVerifiers:Array, expiredAgents:Array}} notReviewed  both already known to be lists
 * @param {Object[]} ledger
 */
function verifierGapAccounted(notReviewed, ledger) {
  const lost = notReviewed.incompleteVerifiers;
  const expired = notReviewed.expiredAgents;
  if (lost.length === 0 && expired.length === 0) return true;
  const waiting = new Set(ledger.filter(lacksVerifier).map((entry) => identity(entry.id)));
  const named = new Set();
  for (const entry of lost) {
    if (!isObject(entry) || !isText(entry.verifier) || !Array.isArray(entry.candidateIds) || entry.candidateIds.length === 0) return false;
    if (!entry.candidateIds.every((id) => identity(id) !== null && waiting.has(identity(id)))) return false;
    named.add(entry.verifier.trim().toLowerCase());
  }
  const gone = new Set();
  for (const agent of expired) {
    if (!isObject(agent) || agent.role !== 'verifier' || !isText(agent.name)) return false;
    gone.add(agent.name.trim().toLowerCase());
  }
  return named.size === gone.size && [...named].every((name) => gone.has(name));
}

/**
 * What a delta round does NOT see, said in its answer (kata xb4j review): the plan's read set is the changed files, their direct
 * importers, their tests and name matches, so a module the changed file itself imports, a caller of a caller, and anything the
 * graph cannot resolve are in no read set (the security lane and the whole-range reader keep the whole range); the carry's own
 * declared limits hold (direct dependents only, bare npm packages and lockfile changes unseen, symlinks and computed specifiers
 * fail closed); a High or sensitive file can be in the read set as a caller of a changed file, while a changed path never is.
 * `unverified` (kata p5dt): how many candidates the last round left unverified for want of a verifier, and what the round does with them.
 */
function deltaLimits({ lane, reader, triage, unverified = 0 }) {
  const whole = [lane ? 'the security lane' : null, reader ? 'the whole-range reader' : null, triage ? 'the TRIAGE step' : null].filter((name) => name !== null);
  const limits = [
    'read-set: changed files, their direct importers and tests, and name matches; not the modules a changed file imports, nor callers of callers',
    whole.length > 0 ? `read on the whole range in this round: ${whole.join(', ')}` : 'no agent of this round reads the whole range: a defect outside the read set is seen by no one',
    'carry: direct dependents only; bare npm packages and lockfile changes are not seen; symlinks and computed specifiers re-verify',
    'a High or sensitive file can be in the read set as a caller of a changed file; a changed path never is',
    'remediationShas is the caller\'s statement of which commits are the fix round\'s own',
  ];
  if (unverified > 0) {
    limits.push(`the last round left ${unverified} ${unverified === 1 ? 'candidate' : 'candidates'} unverified or settled on a majority (a verifier did not return): the ones in code this push left alone are verified again here, one the push fixed is cleared, and one this head cannot place stays as recorded, without its whole electorate`);
  }
  return Object.freeze(limits);
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
  // A delta read stands for the rest of the PR only when the round it follows read all of it. A verifier that did not return is the one
  // gap that is not a gap in what was read (kata p5dt), and only when the ledger accounts for it.
  const notReviewed = state.notReviewed;
  if (!isObject(notReviewed) || NOT_REVIEWED_LISTS.some((key) => !Array.isArray(notReviewed[key])) || UNREAD_LISTS.some((key) => notReviewed[key].length > 0) || !verifierGapAccounted(notReviewed, state.ledger)) {
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
  // The last round's unverified candidates this round put to verifiers again are the SAME findings (their ids, their records): the
  // fresh entry takes the prior one's place whatever the fixed-finding check says, so no ledger holds one finding twice (kata p5dt).
  const again = new Set(isObject(run.reverifyPrior) && Array.isArray(run.reverifyPrior.reverified) ? run.reverifyPrior.reverified.map(String) : []);
  let base = prior.ledger.filter((entry) => !again.has(String(entry.id)));
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

/**
 * What `reverifyPrior` leaves out when it copies a ledger entry into a candidate: the old verification, and the marks of earlier
 * fixed-finding checks and carries (this round stamps its own).
 */
const NOT_COPIED = Object.freeze(['verification', 'locationAsOf', 'cleared', 'clearedBy', 'clearedReason', 'headSha', 'carriedFrom']);

/**
 * The last round's candidates that no verifier returned for (unverified, or settled on a majority without it, kata dx53), put to verifiers again in this round (kata p5dt). They stand in the prior
 * ledger `unverified` (never confirmed, never refuted), so a delta round that only kept them would keep them unverified for good, and the
 * full re-read this replaces dropped the ones nobody raised again. Which ones come back is the fixed-finding check's call, the same one
 * `composeDeltaLedger` applies to every prior finding (`deriveCleared`: git, the cited lines against the push):
 *   - the push touched the cited lines and nobody raised the finding again: it is CLEARED, like any prior finding, and is not verified;
 *   - a candidate of this round is the same defect (`re-reported`: the same path and claim): that candidate is verified, as itself;
 *   - the cited lines are untouched (`location-unchanged`): the finding comes back as a candidate of this round, the ledger entry as it
 *     was recorded (its id, its raiser, its adjudication, everything but the old verification) at the line this head numbers it, and K
 *     fresh verifiers are asked about it from the claim and the place alone. The votes that did arrive last round are not counted again:
 *     they were cast on another head, and a verdict is only ever this round's verifiers' own;
 *   - anything else (a renamed file, a place the check cannot move, a check that cannot run): it is NOT verified again. It stays in the
 *     ledger as recorded, unverified, and the round says so (`kept`, and a `partial` verification status).
 *
 * @param {Object} run   `run.priorRound`, and the heads and repository `deriveCleared` needs
 * @param {Object[]} fresh  every candidate this round's reviewers raised (what a prior finding is `re-reported` by)
 * @param {?function(Object):Object} derive  `deriveCleared`
 * @returns {{candidates:Object[], reverified:Array, kept:Array<{id:*, reason:string}>}}
 *   `candidates` are to be verified this round, `reverified` their ids (the prior findings' own), `kept` the ones left unverified, with why.
 */
function reverifyPrior(run, fresh, derive) {
  const prior = isObject(run.priorRound) ? run.priorRound : null;
  const waiting = new Set(prior === null ? [] : lastRoundUnverified(prior.ledger));
  const out = { candidates: [], reverified: [], kept: [] };
  if (waiting.size === 0) return out;
  const keepAll = (reason) => ({ ...out, kept: [...waiting].map((entry) => ({ id: entry.id, reason })) });
  if (typeof derive !== 'function') return keepAll('fixed-finding-check-unavailable');
  let derived;
  try {
    derived = derive({ cwd: run.repoRoot, baseSha: run.baseSha, headSha: run.headSha, lastReviewedSha: run.lastReviewedSha, ledger: prior.ledger, incoming: fresh });
  } catch (error) {
    derived = { ok: false, reason: error && error.message ? error.message : String(error) };
  }
  if (!isObject(derived) || derived.ok !== true || !Array.isArray(derived.ledger) || derived.ledger.length !== prior.ledger.length) {
    return keepAll(`fixed-finding-check-unavailable: ${isObject(derived) && isText(derived.reason) ? derived.reason : 'no usable answer'}`);
  }
  const why = new Map((Array.isArray(derived.kept) ? derived.kept : []).filter(isObject).map((entry) => [identity(entry.id), entry.reason]));
  const cleared = new Set((Array.isArray(derived.cleared) ? derived.cleared : []).filter(isObject).map((entry) => identity(entry.id)));
  prior.ledger.forEach((entry, index) => {
    if (!waiting.has(entry)) return;
    const id = identity(entry.id);
    if (id !== null && (cleared.has(id) || why.get(id) === 're-reported')) return;
    const moved = derived.ledger[index];
    const placed = id !== null && why.get(id) === 'location-unchanged' && isObject(moved) && identity(moved.id) === id && isText(moved.locationOrLink) && isText(moved.failureMode);
    if (!placed) {
      out.kept.push({ id: entry.id, reason: id !== null && isText(why.get(id)) && why.get(id) !== 'location-unchanged' ? why.get(id) : 'not-placed' });
      return;
    }
    // a candidate with no raiser cannot be given verifiers who are not its raiser: it would fail the whole verification plan
    if (!isText(moved.source) && !isText(moved.reviewer)) {
      out.kept.push({ id: entry.id, reason: 'no-raiser' });
      return;
    }
    const candidate = { ...moved };
    for (const key of NOT_COPIED) delete candidate[key];
    out.candidates.push(candidate);
    out.reverified.push(entry.id);
  });
  return out;
}

/**
 * The last round's unverified candidates still in the finished round's ledger that this round did not put to verifiers (and nothing
 * cleared), each with why (`run.reverifyPrior.kept`, else just that it was not verified again). `fresh` is the ids of this round's own
 * candidates.
 */
function leftoverUnverified(run, ledger, fresh) {
  const why = new Map((isObject(run.reverifyPrior) && Array.isArray(run.reverifyPrior.kept) ? run.reverifyPrior.kept : []).filter(isObject).map((entry) => [String(entry.id), entry.reason]));
  return lastRoundUnverified(ledger).filter((entry) => !fresh.has(String(entry.id))).map((entry) => ({ id: entry.id, reason: `${settledOnMajority(entry) ? 'settled-on-a-majority, ' : ''}${why.get(String(entry.id)) || 'not-verified-again'}` }));
}

/**
 * The round's verification status with that leftover in its ledger (kata p5dt). The votes of a round range over the candidates it asked
 * verifiers about, so on their own they would call it `performed` whatever its ledger still holds unverified: such a round is at best
 * `partial`, and the tally's own reason and recovery stay when it has them.
 */
function withLastRoundUnverified(tally, leftover) {
  if (leftover.length === 0) return tally;
  return {
    ...tally,
    verification: tally.verification === 'not-performed' ? 'not-performed' : 'partial',
    reason: [tally.reason, `unverified-from-the-last-round: ${leftover.map((entry) => `${entry.id} (${entry.reason})`).join(', ')}`].filter(isText).join('; '),
    recoveryAction: isText(tally.recoveryAction) ? tally.recoveryAction : 'supply-the-missing-votes',
  };
}

module.exports = { deltaLimits, priorRound, deltaScope, idSeed, hashCandidates, carryFacts, planRunCarry, composeDeltaLedger, verdictRecords, reverifyPrior, leftoverUnverified, withLastRoundUnverified, lastRoundUnverified, lacksVerifier, NOT_REVIEWED_LISTS, UNREAD_LISTS, VERIFIER_LISTS };
