'use strict';

/**
 * Verification assignment: which verifiers settle which candidate finding
 * (docs/plans/pr-review-speedup-plan.md, section 3A, "Verify per candidate").
 *
 * Verification used to be one agent per verifier slot, each judging EVERY
 * candidate, so a round took as long as its slowest verifier on the whole
 * list. Here every candidate gets K DISTINCT verifiers (K = 3 Standard, 5 Deep,
 * the count `votes` expects) but each agent is handed only one or a few
 * candidates, so the round takes the time of the slowest small agent.
 *
 * `planVerification` is the planning half; `votes` (with its `assignment`
 * input) is the validating half. The plan it returns is what `votes` checks
 * the tally against, so a candidate that lost a verifier shows up as missing
 * a vote instead of as a smaller electorate.
 *
 * Pure: NO side effects, NO shell, NO network, NO file reads. FAIL CLOSED:
 *
 *  - a pool that cannot give some candidate K verifiers is an explicit error
 *    naming those candidates, never a candidate quietly given fewer;
 *  - nobody who raised a finding is one of its verifiers: its `reviewer`, its ledger `source` and each
 *    `mergedFrom[].source` (`raisersOf`, the same case-insensitive comparison `votes` applies); a candidate
 *    that names no raiser is refused, since it could not be excluded;
 *  - anything it cannot read is a refusal with a reason and an EMPTY plan.
 *
 * Independence ("no verifier sees another's vote") is a property of the
 * dispatch, not of this plan: each agent is briefed on its own candidates
 * only, and nothing here carries a vote.
 */

const { resolveExpected, raisersOf } = require('./pr-review-votes');

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isText = (value) => typeof value === 'string' && value.trim() !== '';

/** Text identity for ids that may be written as a string or a finite number (the same rule `votes` uses). */
const identity = (value) => (isText(value) ? value.trim() : Number.isFinite(value) ? String(value) : null);

function refuse(reason, extra = {}) {
  return { ok: false, reason, k: null, verifiersPerCandidate: null, assignments: [], agents: [], ...extra };
}

/**
 * Extra names to exclude for a candidate, beyond the raisers `raisersOf` reads from the candidate itself:
 * `reviewerOf(candidate)`, a name or a list of names (programmatic callers only: JSON cannot carry a function).
 *
 * @returns {string[]|null}  lower-cased names, or null when the value cannot be read.
 */
function extraReviewers(candidate, reviewerOf) {
  if (reviewerOf === undefined) return [];
  const raw = reviewerOf(candidate);
  if (raw === undefined || raw === null) return [];
  const names = Array.isArray(raw) ? raw : [raw];
  if (!names.every(isText)) return null;
  return names.map((name) => name.trim().toLowerCase());
}

/** The pool as trimmed names: `verifierPool` as given, or `verifierCount` generated ones. */
function readPool(input, k) {
  const hasPool = input.verifierPool !== undefined;
  const hasCount = input.verifierCount !== undefined;
  if (hasPool && hasCount) return { ok: false, reason: 'give verifierPool or verifierCount, not both' };

  if (hasPool) {
    if (!Array.isArray(input.verifierPool) || !input.verifierPool.every(isText)) {
      return { ok: false, reason: 'verifierPool must be an array of non-empty names' };
    }
    const names = input.verifierPool.map((name) => name.trim());
    if (new Set(names.map((name) => name.toLowerCase())).size !== names.length) {
      return { ok: false, reason: 'verifierPool must not name the same verifier twice' };
    }
    return { ok: true, names };
  }

  if (hasCount) {
    if (!Number.isInteger(input.verifierCount) || input.verifierCount < 0) {
      return { ok: false, reason: 'verifierCount must be an integer >= 0' };
    }
    return { ok: true, names: Array.from({ length: input.verifierCount }, (_, index) => `verifier-${index + 1}`) };
  }

  // Quick expects no verifier, so it needs no pool; any other count with nobody to draw on cannot be met.
  if (k === 0) return { ok: true, names: [] };
  return { ok: false, reason: 'a verifierPool or verifierCount is required' };
}

/**
 * Plans which K distinct verifiers settle each candidate.
 *
 * @param {Object} input
 * @param {Object[]} input.candidates  Candidate findings, each `{ id, source | reviewer, mergedFrom? }`.
 * @param {string} input.depth         `quick` | `standard` | `deep`; sets K (0 | 3 | 5).
 * @param {number} [input.expectedVerifiers]  Overrides K, exactly as it does for `votes`.
 * @param {string[]} [input.verifierPool]     The verifier names available.
 * @param {number} [input.verifierCount]      Or just how many: they are named `verifier-1` ... `verifier-N`.
 * @param {number} [input.maxCandidatesPerVerifier]  A ceiling on any one agent's batch (keeps each agent to
 *   "one or a few" candidates); a plan over it is refused rather than overloaded.
 * @param {function(Object):(string|string[]|undefined)} [input.reviewerOf]  Extra names to exclude for a
 *   candidate, added to the raisers read from the candidate itself.
 * @param {boolean} [input.allowShortPool]  Accept a pool that cannot give some candidate K verifiers: that
 *   candidate is planned with every verifier it can have and flagged `incomplete: true` (the result reads
 *   `complete: false` with the `shortfalls`), and `votes` records it verifier-incomplete while the rest of the
 *   round stays structural. Off by default: a short pool is then a refusal.
 * @returns {{ok:boolean, reason?:string, k:number|null, verifiersPerCandidate:number|null,
 *   candidates?:number, complete?:boolean,
 *   assignments:Array<{id:string, verifiers:string[], incomplete?:boolean}>,
 *   agents:Array<{verifier:string, candidates:string[]}>,
 *   load?:{min:number, max:number}, shortfalls?:Array<{id:string, eligible:number, needed:number}>}}
 *   An ok plan carries `candidates`, the number it planned for, which can be ZERO (a round with nothing to
 *   verify: `ok: true`, no assignments, nothing to dispatch). Pass it to `depth` beside the assignments so a
 *   plan for zero candidates is told apart from a refused plan, whose empty list never passes a floor.
 */
function planVerification(input) {
  if (!isObject(input)) return refuse('invalid-input');
  if (!Array.isArray(input.candidates) || !input.candidates.every(isObject)) {
    return refuse('candidates must be an array of objects');
  }

  const resolved = resolveExpected(input);
  if (!resolved.ok) return refuse(resolved.reason);
  const k = resolved.expected;

  if (input.reviewerOf !== undefined && typeof input.reviewerOf !== 'function') {
    return refuse('reviewerOf must be a function when given');
  }
  if (input.allowShortPool !== undefined && typeof input.allowShortPool !== 'boolean') {
    return refuse('allowShortPool must be true or false when given');
  }
  const limit = input.maxCandidatesPerVerifier;
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
    return refuse('maxCandidatesPerVerifier must be an integer >= 1 when given');
  }

  const ids = input.candidates.map((candidate) => identity(candidate.id));
  if (ids.some((id) => id === null)) return refuse('every candidate needs an id');
  if (new Set(ids).size !== ids.length) return refuse('candidate ids must be unique');

  // Nobody to verify (Quick, or no candidates) needs no pool; for anything else a pool must be given.
  const pool = readPool(input, k === 0 || input.candidates.length === 0 ? 0 : k);
  if (!pool.ok) return refuse(pool.reason);

  // Who raised each candidate must be readable and known before anyone is assigned: a raiser nobody can name
  // would be a verifier nobody could exclude. The raiser is the candidate's `reviewer`, its ledger `source`
  // and every `mergedFrom[].source` (the definition `votes` checks the plan against); `reviewerOf` can only
  // ADD names to exclude, never replace them, so the plan can never be one `votes` would refuse.
  const reviewers = [];
  for (let index = 0; index < input.candidates.length; index += 1) {
    const candidate = input.candidates[index];
    const raisers = raisersOf(candidate);
    if (!raisers.ok) return refuse(`candidate ${JSON.stringify(ids[index])} has an unreadable reviewer or source`);
    if (k > 0 && raisers.names.length === 0) {
      return refuse(`candidate ${JSON.stringify(ids[index])} names no reviewer or source, so its own raiser cannot be excluded`);
    }
    const extra = extraReviewers(candidate, input.reviewerOf);
    if (extra === null) return refuse(`candidate ${JSON.stringify(ids[index])} has an unreadable reviewer`);
    reviewers.push([...raisers.names, ...extra]);
  }

  const eligible = input.candidates.map((_, index) =>
    pool.names.filter((name) => !reviewers[index].includes(name.toLowerCase()))
  );

  const shortfalls = [];
  ids.forEach((id, index) => {
    if (eligible[index].length < k) shortfalls.push({ id, eligible: eligible[index].length, needed: k });
  });
  // A short pool is an error unless the caller explicitly accepts it: then each short candidate is planned
  // with every verifier it can have and flagged `incomplete`, and `votes` records it verifier-incomplete.
  if (shortfalls.length > 0 && input.allowShortPool !== true) {
    return refuse('verifier-pool-too-small', { k, poolSize: pool.names.length, shortfalls });
  }
  const shortIds = new Set(shortfalls.map((item) => item.id));

  // Spread evenly: each candidate takes its K least-loaded eligible verifiers (pool order breaks ties), so with
  // nobody excluded no verifier ever holds more than one candidate above another.
  const load = new Map(pool.names.map((name) => [name, []]));
  const assignments = input.candidates.map((candidate, index) => {
    const chosen = eligible[index]
      .map((name, order) => ({ name, order }))
      .sort((a, b) => load.get(a.name).length - load.get(b.name).length || a.order - b.order)
      .slice(0, k)
      .map((entry) => entry.name);
    for (const name of chosen) load.get(name).push(ids[index]);
    const entry = { id: ids[index], verifiers: chosen };
    if (shortIds.has(ids[index])) entry.incomplete = true;
    return entry;
  });

  const agents = pool.names
    .filter((name) => load.get(name).length > 0)
    .map((name) => ({ verifier: name, candidates: load.get(name) }));
  const sizes = agents.map((agent) => agent.candidates.length);
  const heaviest = sizes.length === 0 ? 0 : Math.max(...sizes);

  if (limit !== undefined && heaviest > limit) {
    return refuse('verifier-overloaded', { k, maxCandidatesPerVerifier: limit, heaviest });
  }

  const result = { ok: true, k, verifiersPerCandidate: k, candidates: ids.length, assignments, agents };
  if (shortfalls.length > 0) {
    result.complete = false;
    result.shortfalls = shortfalls;
  }
  if (sizes.length > 0) result.load = { min: Math.min(...sizes), max: heaviest };
  return result;
}

module.exports = { planVerification };
