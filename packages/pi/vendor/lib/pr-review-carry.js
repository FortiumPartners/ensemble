'use strict';

/**
 * pr-review-carry.js -- carries settled verification verdicts across heads (kata qw98;
 * docs/plans/pr-review-speedup-plan.md section 3B, first bullet).
 *
 * After a fix push the next round re-verifies only what the push can have changed. This module decides, per candidate,
 * whether the verdict a PRIOR head settled still stands (`carried`, recorded with the head it was originally settled on)
 * or must be verified again (`reverify`, with every reason that applies). It is the riskiest piece of the speedup: a wrong
 * "carry" silently reuses a stale verdict, so every rule below fails toward re-verification.
 *
 * Pure: NO shell, NO file reads, NO network. The hashes and the dependents are inputs: the caller hashed the cited hunk and
 * each dependency file at the head being reviewed and listed the files that use the cited file (lib/pr-review-carry-hash.js
 * does both over git), exactly as `paths` takes the CODEOWNERS text the caller read. A fact this module is not given is a
 * fact that does not match. The hash step stamps every candidate with the head it hashed (`headSha`), and a candidate hashed
 * at any other head, or at none, is never carried from or recorded: its hashes and dependents describe another tree. That the
 * hashing itself was done honestly at the head it names is the one thing this module cannot check.
 *
 * Identity of a settled candidate: (file, claim). The claim is compared as written -- runs of whitespace collapsed, NOTHING
 * else erased, case INCLUDED -- because every symbol (and every capital: `Foo` and `foo` can be two names) is part of what a claim says: `x < y` and `x > y`, `if (!ok)` and
 * `if (ok)`, `a && b` and `a || b` are opposite claims, and flattening them to their words (the first version did) let one
 * inherit the other's `filtered` verdict with no verifier run. A re-worded, re-punctuated or re-capitalised claim is a new
 * candidate; that costs a verifier run, never a dropped finding.
 *
 * Whether a verdict still holds is decided by:
 *   - `hunkHash`    the sha256 of the cited hunk at the head, and its location (`line` / `lines`);
 *   - `depHashes`   `{ path: sha256 }` of every file the cited file depends on (imports, transitively) at the head;
 *   - `dependents`  the files that USE the cited file at the head (its importers, name-matched tests and computed-specifier
 *                   files naming it): listed, not hashed -- ANY of them in the delta forces re-verification, because a
 *                   verdict such as "every caller guards this" is about them. Direct dependents only: a caller of a caller
 *                   is not on the list;
 *   - the delta plan's `readSet` (`planDeltaReview`): a candidate whose file the planner puts in front of a reviewer for any
 *                   reason other than `changed` (`caller-of`, `test-of`, `names`) is verified again;
 *   - the range of the delta (`deltaRange`): `deltaPlan` and `deltaPaths` are the delta of the range `prepare` computed them
 *                   for, `{ headSha, lastReviewedSha }`, and that range must be this round's own. The facts of an earlier push
 *                   are consistent inside themselves and say nothing of what THIS push changed (a caller it added, an edit to
 *                   the cited file outside the cited window). Nothing here reads the repository, so the content of `deltaPlan`
 *                   and `deltaPaths` AND the range are the caller's assertions, the range checked only against this round's own
 *                   heads: it holds when the orchestrator copies `deltaRange` from the facts of this head, and facts of an
 *                   earlier push passed with a range written to match this round carry stale verdicts, unseen here;
 *   - the binding of the verdict to THIS round: the PR (`prId`), the base (`baseSha`), the verifier depth and count it was
 *                   settled under (`depth`, `expectedVerifiers`) and the ledger finding it is about (`priorLedger`).
 * What is NOT checked: callers of callers, bare npm packages, and anything the cited file reads at run time that no
 * relative specifier names.
 *
 * ANY of these forces re-verification (reasons are listed, none dropped). Gates that hold for the whole round -- when one
 * holds, NOTHING carries:
 *   range-not-delta         the delta plan is not a readable `delta`: a full range carries nothing;
 *   head-unknown            the head or the last reviewed head is not a full object id;
 *   delta-range-mismatch    `deltaRange` (the head and last reviewed head the delta facts were computed for) is missing,
 *                           malformed, or is not this round's `headSha` and `lastReviewedSha`: the delta is of another range;
 *   delta-paths-unreadable  the delta's changed paths are not a list of paths;
 *   high-paths-unreadable   the High/sensitive paths are not a list of paths;
 *   high-path-touched       the delta touched a High or sensitive path;
 *   read-set-unreadable     the delta plan carries no readable `readSet`, so its blast radius is unknown;
 *   delta-inconsistent      the changed paths differ from the read set's `changed` entries: the two came from different deltas;
 *   pr-unknown              no PR to bind verdicts to;
 *   base-unknown            the base is not a full object id;
 *   depth-unreadable        the depth is unreadable or expects no verifier (Quick settles nothing);
 *   ledger-unreadable       the prior ledger is not a list of findings.
 * Per candidate:
 *   new-candidate           no prior verdict for it;
 *   candidate-unreadable    no file, or a claim with no words, or a duplicate of another candidate's key;
 *   candidate-head-mismatch the candidate's `headSha` (the head the hash step hashed it at) is missing or is not `headSha`;
 *   ambiguous-prior-verdict two prior verdicts for one key;
 *   id-mismatch             the candidate's id is not the id of the verdict it would inherit;
 *   head-unknown            the verdict's own head (or its `carriedFrom`) is not a full object id;
 *   head-not-last-reviewed  the verdict was last confirmed on a head other than the delta's start, so the delta does not
 *                           cover everything that changed since (a carried verdict is re-stamped with each head it passes);
 *   verdict-not-settled     the prior outcome is not `present` or `filtered` (`disputed` and `unverified` are not settled), or
 *                           its votes are not distinct verifiers' `real` / `not-real` / `abstain`, or an assigned verifier was
 *                           incomplete: a verdict nobody recorded is not carried;
 *   verdict-other-pr        the verdict was recorded for another PR (or for none);
 *   verdict-other-base      the verdict was recorded against another base (or none);
 *   verdict-other-depth     the verdict was settled at another depth or verifier count than this round runs;
 *   verdict-retally-differs its votes, counted again under this round's verifier count, do not give its outcome (exactly K
 *                           distinct voters; `present` needs a strict majority of K `real`, `filtered` must not have one);
 *   verdict-not-in-ledger   the prior ledger holds no finding with the verdict's id, file and claim;
 *   hash-missing            the prior or the current hunk hash, its location, or either dependency hash map is missing;
 *   dependents-missing      the candidate's dependents are not a list of paths;
 *   cited-file-in-delta     the cited file is among the delta's changed paths (whatever the hashes say);
 *   blast-radius            the cited file is in the delta plan's read set for a reason other than `changed`;
 *   dependent-changed       a file that uses the cited file is among the changed paths;
 *   hunk-changed            the cited hunk's hash differs;
 *   hunk-moved              the cited lines differ from the verdict's (identical text elsewhere in the file is not it);
 *   dependency-changed      a dependency file is among the changed paths, or the dependency set or a hash differs.
 *
 * A prior verdict nobody re-presents (no candidate at this head) is never carried: it is listed as `unmatched`. That changes
 * nothing in the ledger: a finding is cleared only by the clear verb (lib/pr-review-clear-cli.js), which reads git.
 *
 * What `carried` means for the ledger: each carried record's `head` is the CURRENT head (the finding is settled on it, so
 * `mergeFindings` does not re-open it and `clearFixedFindings` does not clear it) and `carriedFrom` is the head the verdict
 * was originally settled on, kept through any number of carries. `stampLedger` applies exactly that to the prior ledger and
 * refuses a ledger that already holds a finding stamped with the current head: the only stamps are the ones a carried
 * record produces. `recordVerdicts` is the one producer of verdict records: it stamps the binding the checks above read.
 */

const { isObjectId } = require('./pr-review-scope');
const { majorityOf, resolveExpected, VERDICTS } = require('./pr-review-votes');

const REASONS = Object.freeze({
  RANGE_NOT_DELTA: 'range-not-delta',
  HEAD_UNKNOWN: 'head-unknown',
  DELTA_RANGE_MISMATCH: 'delta-range-mismatch',
  DELTA_PATHS_UNREADABLE: 'delta-paths-unreadable',
  HIGH_PATHS_UNREADABLE: 'high-paths-unreadable',
  HIGH_PATH_TOUCHED: 'high-path-touched',
  READ_SET_UNREADABLE: 'read-set-unreadable',
  DELTA_INCONSISTENT: 'delta-inconsistent',
  PR_UNKNOWN: 'pr-unknown',
  BASE_UNKNOWN: 'base-unknown',
  DEPTH_UNREADABLE: 'depth-unreadable',
  LEDGER_UNREADABLE: 'ledger-unreadable',
  PRIOR_STATE_UNAVAILABLE: 'prior-state-unavailable',
  NEW_CANDIDATE: 'new-candidate',
  CANDIDATE_UNREADABLE: 'candidate-unreadable',
  CANDIDATE_HEAD_MISMATCH: 'candidate-head-mismatch',
  AMBIGUOUS_PRIOR_VERDICT: 'ambiguous-prior-verdict',
  ID_MISMATCH: 'id-mismatch',
  HEAD_NOT_LAST_REVIEWED: 'head-not-last-reviewed',
  VERDICT_NOT_SETTLED: 'verdict-not-settled',
  VERDICT_OTHER_PR: 'verdict-other-pr',
  VERDICT_OTHER_BASE: 'verdict-other-base',
  VERDICT_OTHER_DEPTH: 'verdict-other-depth',
  VERDICT_RETALLY_DIFFERS: 'verdict-retally-differs',
  VERDICT_NOT_IN_LEDGER: 'verdict-not-in-ledger',
  HASH_MISSING: 'hash-missing',
  DEPENDENTS_MISSING: 'dependents-missing',
  CITED_FILE_IN_DELTA: 'cited-file-in-delta',
  BLAST_RADIUS: 'blast-radius',
  DEPENDENT_CHANGED: 'dependent-changed',
  HUNK_CHANGED: 'hunk-changed',
  HUNK_MOVED: 'hunk-moved',
  DEPENDENCY_CHANGED: 'dependency-changed',
  NO_CURRENT_CANDIDATE: 'no-current-candidate',
});

/** The outcomes of `votes` that settle a candidate. `disputed` needs a person; `unverified` was never verified. */
const SETTLED_OUTCOMES = Object.freeze(['present', 'filtered']);

/** The one reason of a read-set entry that the delta itself already covers (`cited-file-in-delta`). */
const CHANGED_REASON = 'changed';

const SHA256_HEX = /^[0-9a-f]{64}$/i;
const URL_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;
const HAS_WORD = /[\p{L}\p{N}]/u;

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isText = (value) => typeof value === 'string' && value.trim() !== '';
/** An id as every comparison here spells it: trimmed text, or a finite number as text; null for anything else. */
const identity = (value) => (isText(value) ? value.trim() : Number.isFinite(value) ? String(value) : null);
const sameId = (a, b) => isObjectId(a) && isObjectId(b) && a.toLowerCase() === b.toLowerCase();
const sameHash = (a, b) => typeof a === 'string' && typeof b === 'string' && SHA256_HEX.test(a) && SHA256_HEX.test(b) && a.toLowerCase() === b.toLowerCase();

/** A path as every comparison here spells it: forward slashes, no leading `./`. */
function normalizePath(value) {
  return value.trim().replace(/\\/g, '/').replace(/^(?:\.\/)+/, '');
}

/**
 * A claim as compared: runs of whitespace collapsed, nothing else erased, case kept (see the module header: a symbol is
 * part of what a claim says). Null when it has no word at all: a claim of only symbols names nothing.
 */
function normalizeClaim(value) {
  if (!isText(value)) return null;
  const collapsed = value.replace(/\s+/g, ' ').trim();
  return HAS_WORD.test(collapsed) ? collapsed : null;
}

/** The identity of a settled candidate, or null when it has no file or no claim words. */
function keyOf(entry) {
  if (!isObject(entry) || !isText(entry.file)) return null;
  const claim = normalizeClaim(entry.claim);
  return claim === null ? null : `${normalizePath(entry.file)}\u0000${claim}`;
}

/** `{ path: sha256 }` with at least zero entries, every path text and every hash a sha256: else null. An empty map is "no dependencies". */
function readDepHashes(value) {
  if (!isObject(value)) return null;
  const map = new Map();
  for (const [file, hash] of Object.entries(value)) {
    if (!isText(file) || typeof hash !== 'string' || !SHA256_HEX.test(hash)) return null;
    const key = normalizePath(file);
    if (map.has(key) && map.get(key) !== hash.toLowerCase()) return null;
    map.set(key, hash.toLowerCase());
  }
  return map;
}

function readPathList(value) {
  if (!Array.isArray(value) || !value.every(isText)) return null;
  return new Set(value.map(normalizePath));
}

/** The cited region as `[start, end]` from `line` or `lines`, or null when it is absent, ambiguous or not positive integers. */
function locationOf(entry) {
  const hasLine = entry.line !== undefined;
  const hasLines = entry.lines !== undefined;
  if (hasLine === hasLines) return null;
  const isLine = (n) => Number.isInteger(n) && n >= 1;
  if (hasLine) return isLine(entry.line) ? [entry.line, entry.line] : null;
  const range = entry.lines;
  return Array.isArray(range) && range.length === 2 && isLine(range[0]) && isLine(range[1]) && range[0] <= range[1] ? [range[0], range[1]] : null;
}

/**
 * The delta plan's read set as `Map(path -> Set(reasons))`, or null when it is not a list of `{ path, reasons[] }` with at
 * least one reason each: an entry with no reason is not something the planner produces.
 */
function readReadSet(value) {
  if (!Array.isArray(value)) return null;
  const map = new Map();
  for (const entry of value) {
    if (!isObject(entry) || !isText(entry.path) || !Array.isArray(entry.reasons) || entry.reasons.length === 0 || !entry.reasons.every(isText)) return null;
    const key = normalizePath(entry.path);
    if (!map.has(key)) map.set(key, new Set());
    for (const why of entry.reasons) map.get(key).add(why.trim());
  }
  return map;
}

/** The file part of a ledger finding's `file` or `file:line` location; null for a link or nothing. */
function fileOfFinding(finding) {
  if (isText(finding.file)) return normalizePath(finding.file);
  if (!isText(finding.locationOrLink) || URL_SCHEME.test(finding.locationOrLink.trim())) return null;
  const file = finding.locationOrLink.trim().split(':')[0].trim();
  return file === '' ? null : normalizePath(file);
}

/** The prior ledger as `Map(id -> finding | null)` (null: two findings share the id), or null when it is not a list of findings. */
function readLedger(value) {
  if (!Array.isArray(value) || !value.every(isObject)) return null;
  const map = new Map();
  for (const finding of value) {
    const id = identity(finding.id);
    if (id === null) continue;
    map.set(id, map.has(id) ? null : finding);
  }
  return map;
}

/** True when `votes` are distinct verifiers' votes, every verdict one of `real`, `not-real`, `abstain`. */
function wellFormedVotes(votes) {
  if (!Array.isArray(votes) || votes.length === 0) return false;
  const seen = new Set();
  for (const vote of votes) {
    if (!isObject(vote) || !isText(vote.verifier) || !VERDICTS.includes(vote.verdict)) return false;
    const voter = vote.verifier.trim().toLowerCase();
    if (seen.has(voter)) return false;
    seen.add(voter);
  }
  return true;
}

function settled(prior) {
  if (!SETTLED_OUTCOMES.includes(prior.outcome)) return false;
  if (!wellFormedVotes(prior.votes)) return false;
  if (prior.incompleteVerifiers !== undefined && !(Array.isArray(prior.incompleteVerifiers) && prior.incompleteVerifiers.length === 0)) return false;
  return true;
}

/**
 * The votes counted again under `expected` verifiers (the round's own `votes` rule: the denominator is the expected count,
 * never the number of votes that arrived): exactly `expected` voters, and `present` needs a strict majority of them `real`
 * where `filtered` must not have one.
 */
function retallies(prior, expected) {
  if (prior.votes.length !== expected) return false;
  const real = prior.votes.filter((vote) => vote.verdict === 'real').length;
  return prior.outcome === 'present' ? real >= majorityOf(expected) : real < majorityOf(expected);
}

function unreadable(reason) {
  return { ok: false, carried: [], reverify: [], unmatched: [], reasons: [reason] };
}

/**
 * @param {Object} input
 * @param {string|number} input.prId      The PR the round reviews; a verdict recorded for another PR is not carried.
 * @param {string} input.baseSha          The base the round reviews against (full object id).
 * @param {string} input.headSha          The head being reviewed now (full object id).
 * @param {string} input.lastReviewedSha  The head the previous round reviewed, the start of the delta (full object id).
 * @param {string} input.depth            The round's verifier depth word (`votes` input): `standard` or `deep`.
 * @param {number} [input.expectedVerifiers]  The round's verifier count override (`votes` input); the depth's own by default.
 * @param {{mode:string, readSet:Array<{path:string, reasons:string[]}>}} input.deltaPlan  The `deltaPlan` of `facts.json`
 *                                        (`planDeltaReview`); only `mode: 'delta'` carries and its `readSet` must be readable.
 * @param {string[]} input.deltaPaths     The paths changed between `lastReviewedSha` and `headSha` (`facts.delta.changedPaths`);
 *                                        they must be the read set's `changed` entries.
 * @param {{headSha:string, lastReviewedSha:string}} input.deltaRange  The range `deltaPlan` and `deltaPaths` were computed for
 *                                        (`facts.headSha`, `facts.delta.lastReviewedSha`, copied from the facts of this head and never
 *                                        written from the round's own heads); it must be `headSha` and `lastReviewedSha`.
 * @param {string[]} input.highPaths      The paths classified High or sensitive (the `paths` result), changed or not.
 * @param {Object[]} input.priorVerdicts  `{ id, file, claim, lines, hunkHash, depHashes, head, carriedFrom?, outcome,
 *                                          votes[{verifier, verdict}], prId, baseSha, depth, expectedVerifiers }` as
 *                                          `recordVerdicts` stamped them in the previous round.
 * @param {Object[]} input.priorLedger    The findings ledger of that round: every verdict must be about one of its findings.
 * @param {Object[]} input.candidates     `{ id?, file, claim, line|lines, hunkHash, depHashes, dependents, headSha }`: every
 *                                        candidate this round has, hashed at `headSha` (the hash step stamps the head it
 *                                        hashed at on each one). A prior verdict is only ever carried onto one of these.
 * @returns {{ok:boolean, carried:Object[], reverify:Object[], unmatched:Object[], reasons:string[]}}
 */
function planCarry(input) {
  if (!isObject(input)) return unreadable('invalid-input');
  const { prId, baseSha, headSha, lastReviewedSha, depth, expectedVerifiers, deltaPlan, deltaPaths, deltaRange, highPaths, priorVerdicts, priorLedger, candidates } = input;
  if (!Array.isArray(priorVerdicts) || !priorVerdicts.every(isObject)) return unreadable('priorVerdicts must be an array of objects');
  if (!Array.isArray(candidates) || !candidates.every(isObject)) return unreadable('candidates must be an array of objects');

  // ---- gates that apply to every candidate: when one holds, nothing carries ----
  const global = [];
  const isDelta = isObject(deltaPlan) && deltaPlan.mode === 'delta';
  if (!isDelta) global.push(REASONS.RANGE_NOT_DELTA);
  if (!isObjectId(headSha) || !isObjectId(lastReviewedSha)) global.push(REASONS.HEAD_UNKNOWN);
  // The delta handed in must be the one `prepare` computed for THIS range: the facts of an earlier push are consistent inside
  // themselves and cannot show what this push changed (a caller it added, an edit to the cited file outside the cited window).
  if (!isObject(deltaRange) || !sameId(deltaRange.headSha, headSha) || !sameId(deltaRange.lastReviewedSha, lastReviewedSha)) global.push(REASONS.DELTA_RANGE_MISMATCH);
  const delta = readPathList(deltaPaths);
  if (delta === null) global.push(REASONS.DELTA_PATHS_UNREADABLE);
  const high = readPathList(highPaths);
  if (high === null) global.push(REASONS.HIGH_PATHS_UNREADABLE);
  if (delta !== null && high !== null && [...high].some((file) => delta.has(file))) global.push(REASONS.HIGH_PATH_TOUCHED);

  // The planner's blast radius for this delta: which files a reviewer is made to read, and why.
  let radius = null;
  if (isDelta) {
    radius = readReadSet(deltaPlan.readSet);
    if (radius === null) {
      global.push(REASONS.READ_SET_UNREADABLE);
    } else if (delta !== null) {
      const changed = [...radius].filter(([, why]) => why.has(CHANGED_REASON)).map(([file]) => file);
      if (changed.length !== delta.size || !changed.every((file) => delta.has(file))) global.push(REASONS.DELTA_INCONSISTENT);
    }
  }

  // What the verdicts must be bound to.
  const round = { pr: identity(prId), base: isObjectId(baseSha) ? baseSha : null, depth: resolveExpected({ depth, expectedVerifiers }) };
  if (round.pr === null) global.push(REASONS.PR_UNKNOWN);
  if (round.base === null) global.push(REASONS.BASE_UNKNOWN);
  const depthOk = round.depth.ok && round.depth.expected >= 1;
  if (!depthOk) global.push(REASONS.DEPTH_UNREADABLE);
  const ledger = readLedger(priorLedger);
  if (ledger === null) global.push(REASONS.LEDGER_UNREADABLE);

  // ---- index the prior verdicts and the candidates by key ----
  const priorsByKey = new Map();
  for (const prior of priorVerdicts) {
    const key = keyOf(prior);
    if (key === null) continue;
    if (!priorsByKey.has(key)) priorsByKey.set(key, []);
    priorsByKey.get(key).push(prior);
  }
  const candidateCount = new Map();
  for (const candidate of candidates) {
    const key = keyOf(candidate);
    if (key !== null) candidateCount.set(key, (candidateCount.get(key) || 0) + 1);
  }

  const carried = [];
  const reverify = [];
  const matched = new Set();

  for (const candidate of candidates) {
    const key = keyOf(candidate);
    const base = { file: isText(candidate.file) ? candidate.file : null, claim: typeof candidate.claim === 'string' ? candidate.claim : null };
    if (candidate.id !== undefined) base.id = candidate.id;
    // A candidate hashed at another head, or at none, says nothing about this one: its hashes and its dependents describe
    // another tree (a caller added since is not among them), so nothing here may rest on them.
    const stale = sameId(candidate.headSha, headSha) ? [] : [REASONS.CANDIDATE_HEAD_MISMATCH];
    if (key === null) {
      reverify.push({ ...base, reasons: [...new Set([...global, REASONS.CANDIDATE_UNREADABLE, ...stale])] });
      continue;
    }
    matched.add(key);
    const reasons = [...global, ...stale];
    if (candidateCount.get(key) > 1) reasons.push(REASONS.CANDIDATE_UNREADABLE);

    const priors = priorsByKey.get(key) || [];
    if (priors.length === 0) reasons.push(REASONS.NEW_CANDIDATE);
    if (priors.length > 1) reasons.push(REASONS.AMBIGUOUS_PRIOR_VERDICT);

    if (priors.length === 1) {
      const prior = priors[0];
      if (candidate.id !== undefined && prior.id !== undefined && identity(candidate.id) !== identity(prior.id)) reasons.push(REASONS.ID_MISMATCH);

      // Which head this verdict was last confirmed on, and where it was first settled.
      if (!isObjectId(prior.head) || (prior.carriedFrom !== undefined && !isObjectId(prior.carriedFrom))) reasons.push(REASONS.HEAD_UNKNOWN);
      else if (!sameId(prior.head, lastReviewedSha)) reasons.push(REASONS.HEAD_NOT_LAST_REVIEWED);
      const isSettled = settled(prior);
      if (!isSettled) reasons.push(REASONS.VERDICT_NOT_SETTLED);

      // What the verdict was recorded for. A fact the round does not give (a global reason above) is not asked again here.
      if (round.pr !== null && identity(prior.prId) !== round.pr) reasons.push(REASONS.VERDICT_OTHER_PR);
      if (round.base !== null && !sameId(prior.baseSha, round.base)) reasons.push(REASONS.VERDICT_OTHER_BASE);
      const priorDepth = isText(prior.depth) ? prior.depth.trim().toLowerCase() : null;
      if (depthOk && (priorDepth !== round.depth.depth || prior.expectedVerifiers !== round.depth.expected)) reasons.push(REASONS.VERDICT_OTHER_DEPTH);
      if (depthOk && isSettled && !retallies(prior, round.depth.expected)) reasons.push(REASONS.VERDICT_RETALLY_DIFFERS);
      if (ledger !== null) {
        const finding = ledger.get(identity(prior.id));
        const inLedger = isObject(finding) && fileOfFinding(finding) === normalizePath(prior.file) && normalizeClaim(finding.failureMode) === normalizeClaim(prior.claim);
        if (!inLedger) reasons.push(REASONS.VERDICT_NOT_IN_LEDGER);
      }

      const priorDeps = readDepHashes(prior.depHashes);
      const currentDeps = readDepHashes(candidate.depHashes);
      const priorAt = locationOf(prior);
      const currentAt = locationOf(candidate);
      const hashesReadable = priorDeps !== null && currentDeps !== null && priorAt !== null && currentAt !== null
        && SHA256_HEX.test(String(prior.hunkHash)) && SHA256_HEX.test(String(candidate.hunkHash));
      if (!hashesReadable) {
        reasons.push(REASONS.HASH_MISSING);
      } else {
        if (!sameHash(prior.hunkHash, candidate.hunkHash)) reasons.push(REASONS.HUNK_CHANGED);
        if (priorAt[0] !== currentAt[0] || priorAt[1] !== currentAt[1]) reasons.push(REASONS.HUNK_MOVED);
        const sameSet = priorDeps.size === currentDeps.size && [...priorDeps.keys()].every((file) => currentDeps.has(file) && currentDeps.get(file) === priorDeps.get(file));
        // The two maps are equal when `sameSet` holds, so the current keys are the dependencies to look for in the delta.
        const depTouched = delta !== null && [...currentDeps.keys()].some((file) => delta.has(file));
        if (!sameSet || depTouched) reasons.push(REASONS.DEPENDENCY_CHANGED);
      }

      const dependents = readPathList(candidate.dependents);
      if (dependents === null) reasons.push(REASONS.DEPENDENTS_MISSING);
      else if (delta !== null && [...dependents].some((file) => delta.has(file))) reasons.push(REASONS.DEPENDENT_CHANGED);

      const file = normalizePath(candidate.file);
      if (delta !== null && delta.has(file)) reasons.push(REASONS.CITED_FILE_IN_DELTA);
      if (radius !== null && radius.has(file) && [...radius.get(file)].some((why) => why !== CHANGED_REASON)) reasons.push(REASONS.BLAST_RADIUS);

      if (reasons.length === 0) {
        carried.push({
          id: prior.id,
          file: prior.file,
          claim: prior.claim,
          lines: currentAt,
          hunkHash: candidate.hunkHash.toLowerCase(),
          depHashes: Object.fromEntries(currentDeps),
          head: headSha,
          carriedFrom: prior.carriedFrom !== undefined ? prior.carriedFrom : prior.head,
          outcome: prior.outcome,
          votes: prior.votes,
          prId: prior.prId,
          baseSha: prior.baseSha,
          depth: prior.depth,
          expectedVerifiers: prior.expectedVerifiers,
        });
        continue;
      }
    }
    reverify.push({ ...base, reasons: [...new Set(reasons)] });
  }

  const unmatched = [];
  for (const prior of priorVerdicts) {
    const key = keyOf(prior);
    if (key !== null && matched.has(key)) continue;
    unmatched.push({
      file: isText(prior.file) ? prior.file : null,
      claim: typeof prior.claim === 'string' ? prior.claim : null,
      ...(prior.id !== undefined ? { id: prior.id } : {}),
      reasons: [REASONS.NO_CURRENT_CANDIDATE],
    });
  }

  return { ok: true, carried, reverify, unmatched, reasons: [...new Set(global)] };
}

function refused(reason) {
  return { ok: false, verdicts: [], skipped: [], reason };
}

/**
 * The verdict records of a finished round: the settled findings of the `votes` result, each joined to the hashed citation
 * of the same id and stamped with what `planCarry` binds a verdict to (`prId`, `baseSha`, `depth`, `expectedVerifiers`) and
 * the head it was settled on. A finding that is not settled, has no usable hash, was hashed at another head than `headSha`,
 * cites another file or claim than its ledger entry says, or whose votes do not give its outcome under the round's
 * verifier count is `skipped` with the reason and recorded NOWHERE: the next round verifies it again.
 *
 * @param {Object} input
 * @param {string|number} input.prId
 * @param {string} input.baseSha
 * @param {string} input.headSha
 * @param {string} input.depth
 * @param {number} [input.expectedVerifiers]
 * @param {Object[]} input.findings    The `findings` of the `votes` result (ledger entries with `outcome` and `votes`).
 * @param {Object[]} input.candidates  The hash step's `candidates` for this head, matched to the findings by `id`; each is
 *                                     stamped with the head it was hashed at, which must be `headSha`.
 * @returns {{ok:true, verdicts:Object[], skipped:Array<{id:*, reason:string}>}|{ok:false, verdicts:[], skipped:[], reason:string}}
 */
function recordVerdicts(input) {
  if (!isObject(input)) return refused('invalid-input');
  const { prId, baseSha, headSha, depth, expectedVerifiers, findings, candidates } = input;
  const pr = identity(prId);
  if (pr === null) return refused('prId must be a PR number or non-empty text');
  if (!isObjectId(baseSha)) return refused('baseSha must be a full object id');
  if (!isObjectId(headSha)) return refused('headSha must be a full object id');
  const resolved = resolveExpected({ depth, expectedVerifiers });
  if (!resolved.ok) return refused(resolved.reason);
  if (resolved.expected < 1) return refused('the depth expects no verifier: nothing was settled');
  if (!Array.isArray(findings) || !findings.every(isObject)) return refused('findings must be an array of objects');
  if (!Array.isArray(candidates) || !candidates.every(isObject)) return refused('candidates must be an array of objects');

  const byId = new Map();
  for (const candidate of candidates) {
    const id = identity(candidate.id);
    if (id !== null) byId.set(id, byId.has(id) ? null : candidate);
  }

  const verdicts = [];
  const skipped = [];
  for (const finding of findings) {
    const skip = (reason) => skipped.push({ id: finding.id === undefined ? null : finding.id, reason });
    const id = identity(finding.id);
    if (id === null) { skip('no-id'); continue; }
    if (!SETTLED_OUTCOMES.includes(finding.outcome)) { skip('not-settled'); continue; }
    const candidate = byId.get(id);
    if (candidate === undefined) { skip('no-candidate'); continue; }
    if (candidate === null) { skip('ambiguous-candidate'); continue; }
    if (!sameId(candidate.headSha, headSha)) { skip(REASONS.CANDIDATE_HEAD_MISMATCH); continue; }
    const depHashes = readDepHashes(candidate.depHashes);
    const lines = locationOf(candidate);
    if (depHashes === null || lines === null || !SHA256_HEX.test(String(candidate.hunkHash))) { skip('no-hash'); continue; }
    const wanted = keyOf({ file: fileOfFinding(finding), claim: finding.failureMode });
    if (wanted === null || wanted !== keyOf(candidate)) { skip('candidate-differs'); continue; }

    const record = {
      id: finding.id,
      file: candidate.file,
      claim: candidate.claim,
      lines,
      hunkHash: candidate.hunkHash.toLowerCase(),
      depHashes: Object.fromEntries(depHashes),
      head: headSha,
      outcome: finding.outcome,
      votes: Array.isArray(finding.votes) ? finding.votes.map((vote) => ({ verifier: vote && vote.verifier, verdict: vote && vote.verdict })) : finding.votes,
      prId: pr,
      baseSha,
      depth: resolved.depth,
      expectedVerifiers: resolved.expected,
    };
    if (!settled(record) || !retallies(record, resolved.expected)) { skip('votes-unsupported'); continue; }
    verdicts.push(record);
  }
  return { ok: true, verdicts, skipped };
}

/**
 * Applies a carry to the prior ledger: each carried finding is stamped `headSha` = the carried record's head and
 * `carriedFrom` (so `mergeFindings` does not re-open it and `clearFixedFindings` does not clear it), and a `carriedFrom`
 * left by an earlier carry on a finding that is NOT carried now is removed. A ledger that already holds a finding stamped
 * with the current head is REFUSED: at this point (before this round's observations are merged) no finding can legitimately
 * be on the current head, so such a stamp was not produced by a carried record. A carried record with no finding in the
 * ledger is refused for the same reason.
 *
 * @param {{ledger:Object[], carried:Object[], headSha:string}} input
 * @returns {{ok:true, ledger:Object[]}|{ok:false, reason:string}}
 */
function stampLedger(input) {
  if (!isObject(input)) return { ok: false, reason: 'invalid-input' };
  const { ledger, carried, headSha } = input;
  if (!Array.isArray(ledger) || !ledger.every(isObject)) return { ok: false, reason: 'ledger must be an array of objects' };
  if (!Array.isArray(carried) || !carried.every(isObject)) return { ok: false, reason: 'carried must be an array of objects' };
  if (!isText(headSha)) return { ok: false, reason: 'headSha must be a non-empty string' };

  const byId = new Map();
  for (const record of carried) {
    const id = identity(record.id);
    if (id === null || byId.has(id) || record.head !== headSha || !isObjectId(record.carriedFrom)) return { ok: false, reason: 'a carried record is not one planCarry produced for this head' };
    byId.set(id, record);
  }
  const stamped = new Set();
  const out = [];
  for (const finding of ledger) {
    if (finding.headSha === headSha) {
      return { ok: false, reason: `ledger finding ${JSON.stringify(finding.id)} is already stamped with the current head, which no carried record produced` };
    }
    const id = identity(finding.id);
    const record = id === null ? undefined : byId.get(id);
    if (record !== undefined) {
      stamped.add(id);
      out.push({ ...finding, headSha: record.head, carriedFrom: record.carriedFrom });
    } else if (Object.prototype.hasOwnProperty.call(finding, 'carriedFrom')) {
      const { carriedFrom: _earlierCarry, ...rest } = finding;
      out.push(rest);
    } else {
      out.push(finding);
    }
  }
  if (stamped.size !== byId.size) return { ok: false, reason: 'a carried record has no finding in the ledger' };
  return { ok: true, ledger: out };
}

module.exports = { planCarry, recordVerdicts, stampLedger, normalizeClaim, keyOf, REASONS, SETTLED_OUTCOMES };
