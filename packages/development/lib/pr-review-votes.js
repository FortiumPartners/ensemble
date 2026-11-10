'use strict';

/**
 * Verification vote tally: which candidate findings the author is actually
 * asked to answer (TRD-016, REQ-005, REQ-006).
 *
 * NO side effects, NO shell, NO network, NO file reads. A pure function over
 * candidate findings and the votes independent verifiers cast on them.
 *
 * The rule the whole review loop rests on: a finding is PRESENT only when a
 * STRICT MAJORITY of the verifiers the depth EXPECTS voted it real -- 2 of 3
 * at Standard, 3 of 5 at Deep. The denominator is the expected count, never
 * the number of votes that happened to arrive, so a verifier that timed out,
 * crashed or was never dispatched can never be read as agreement.
 *
 * FAIL CLOSED, which here means two different things at once, and both
 * matter:
 *
 *   - nothing is ever waved through: a request, a finding or a vote this
 *     module cannot read never produces a `present` finding;
 *   - nothing is ever dropped (REQ-006): a finding whose votes cannot be read
 *     comes back as `unverified` and PRESENTED, with the reason attached. A
 *     silently discarded finding is the one outcome this module must not
 *     have.
 *
 * Outcomes:
 *   `present`     the majority voted it real -- the author answers it;
 *   `filtered`    a non-finding, or the majority was not reached;
 *   `disputed`    critical or security-relevant, and the verifiers split or
 *                 rejected it: a person decides, not a vote (AC-006-2);
 *   `unverified`  verification did not run, or could not be read, for this
 *                 finding -- presented and marked.
 *
 * Per-finding degradation, ledger recording and the author-facing wording of
 * these outcomes (TRD-039, AC-005-4, AC-006-1, AC-006-3):
 *
 *   - `authorLabel` on every finding is the exact word the author sees:
 *     "verifier disagrees" for a finding that FAILED verification (votes were
 *     cast, the majority was not reached), never "required fix" -- a finding
 *     that fails verification is still present in the ledger with its votes
 *     and the reason (AC-005-4, AC-006-1);
 *   - a finding may carry `incompleteVerifiers: [{verifier, reason}]` naming
 *     a verifier that was assigned to it but returned no usable vote
 *     (timeout, tool failure). That finding is `unverified` /
 *     `verifier-incomplete` -- presented and marked -- even when the votes
 *     that did arrive would otherwise have reached a majority; a finding
 *     whose verifiers all returned keeps its tally-based outcome untouched
 *     (AC-006-3);
 *   - `input.verificationCapability === false` means no subagent capability
 *     ran this round at all: every finding is `unverified` /
 *     `no-subagent-capability`, `result.verification` is `not-performed`,
 *     and nothing is dropped (AC-006-3);
 *   - `result.verification` is `partial` when some but not all findings are
 *     per-finding degraded, `not-performed` when none of them could be
 *     verified at all (Quick or no capability), `performed` otherwise;
 *   - every blocked or degraded result names `recoveryAction`:
 *     `re-run-verification` for a structural failure or a round with no
 *     capability at all, `supply-the-missing-votes` for per-finding
 *     incomplete coverage.
 *
 * SETTLING ON A MAJORITY (kata dx53; OPT-IN: only `input.settleOnMajority === true`, which the review runner sets and nothing
 * else does: the CLI `votes` drops the key from its payload, so the narrated procedure keeps the rule above to the letter). The last real-model measurement put 8 of 31
 * verifiers past their deadline, and 17 of the 23 candidates of those rounds ended `unverified`, 14 of them although the
 * verifiers that did return were already a strict majority. With the option a candidate whose STRICT
 * MAJORITY of the verifiers the depth expects voted `real` is `present` although another assigned verifier returned nothing
 * (expired, or no vote for it). It is not a relaxation, and what keeps it from being one is stated here and tested:
 *   - the denominator is still the expected count, never the arrived votes: 2 real of 3 expected is a majority, 2 real of 2 that
 *     arrived out of 5 expected is not read as one, and 1 real of 3 stays `unverified`;
 *   - no vote still missing can change the outcome: `present` needs `real >= needed` and a missing vote can only add to `real`,
 *     so the finding is `present` in every completion of the round (the same outcome the round would have given);
 *   - the missing verifiers stay NAMED on the finding (`incompleteVerifiers`, and `settledOnMajority: true`), so it is never read
 *     as a complete electorate, and `result.verification` is `partial` while any finding has one;
 *   - only a confirmation is settled: a candidate the arrived votes would REFUTE stays `unverified`, because a refuted finding is
 *     dropped from the author's list and nothing is dropped on an incomplete electorate; a split stays `unverified` too;
 *   - nothing is settled without the explicit `assignment` (only a plan names who was expected), for a candidate the planner could
 *     not give its verifiers (`verifier-pool-too-small`: a short electorate is never read as agreement) or for a non-finding.
 */

/** The exact word the author sees for an outcome/reason pair; `undefined` when none applies. */
const AUTHOR_LABELS = Object.freeze({
  'filtered:verifier-majority-not-reached': 'verifier disagrees',
  'disputed:security-finding-not-verified': 'disputed',
  'unverified:verifier-incomplete': 'unverified',
  'unverified:no-subagent-capability': 'unverified',
  'unverified:verification-not-performed': 'unverified',
  'unverified:unreadable-votes': 'unverified',
});

function authorLabelFor(outcome, reason) {
  return AUTHOR_LABELS[`${outcome}:${reason}`];
}

/** The verifiers each depth expects (AC-005-1). Quick runs no verification at all. */
const EXPECTED_VERIFIERS = Object.freeze({ quick: 0, standard: 3, deep: 5 });

/** The only verdicts that are votes. Anything else is not a vote (not a "no", not a "yes"). */
const VERDICTS = Object.freeze(['real', 'not-real', 'abstain']);

/** Kinds that need no answer from the author (AC-005-2). */
const NON_FINDING_KINDS = Object.freeze(['style', 'diagnostic', 'cleanup']);

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isText = (value) => typeof value === 'string' && value.trim() !== '';

/** Text identity for ids that may be written as a string or a finite number. */
const identity = (value) => (isText(value) ? value.trim() : Number.isFinite(value) ? String(value) : null);

/** The name recorded on a finding's `incompleteVerifiers` for a verifier slot the planner could not fill. */
const UNASSIGNED_VERIFIER = '(unassigned)';

/** Lower-cased names from a text or a list of texts; `null` when present but not readable as names. */
function namesFrom(value) {
  if (value === undefined || value === null) return [];
  const list = Array.isArray(value) ? value : [value];
  return list.every(isText) ? list.map((name) => name.trim().toLowerCase()) : null;
}

/**
 * Everyone who raised a finding, so nobody verifies their own: its `reviewer`, its ledger `source` (the raiser's
 * login: Step 3 candidates are ledger entries, which carry `source` and no `reviewer`), and, for a finding
 * merged from several raisers, each `mergedFrom[]` entry's `source` (or `reviewer`). One definition for the
 * planner (`planVerification`) and for the vote check, so they can never disagree on who the raiser is.
 *
 * @returns {{names:string[], ok:boolean}}  lower-cased names; `ok` is false when a present field cannot be
 *   read as names (the readable ones are still returned).
 */
function raisersOf(finding) {
  const names = [];
  let ok = true;
  const take = (value) => {
    const read = namesFrom(value);
    if (read === null) ok = false;
    else names.push(...read);
  };
  take(finding.reviewer);
  take(finding.source);
  if (finding.mergedFrom !== undefined && finding.mergedFrom !== null) {
    if (!Array.isArray(finding.mergedFrom) || !finding.mergedFrom.every(isObject)) ok = false;
    else {
      for (const entry of finding.mergedFrom) {
        take(entry.source);
        take(entry.reviewer);
      }
    }
  }
  return { names: [...new Set(names)], ok };
}

/** A strict majority of `expected`: 2 of 3, 3 of 5, 1 of 1. */
function majorityOf(expected) {
  if (!Number.isInteger(expected) || expected < 0) return null;
  return Math.floor(expected / 2) + 1;
}

/** The fail-closed answer: nothing verified, nothing presented as agreed, the reason named. */
function blocked(reason) {
  return { ok: false, verification: 'blocked', reason, recoveryAction: 're-run-verification', findings: [], presented: [] };
}

/**
 * Fail closed on a malformed flag: anything except absent, false, null, 0 or an
 * explicit "no" word reads as set, so "true", "yes" and 1 all mean the flag is on.
 */
function flagged(value) {
  if (value === undefined || value === null || value === false) return false;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') return !['', 'false', 'no', 'n', '0', 'off'].includes(value.trim().toLowerCase());
  return true;
}

/** Whether a finding is in the security lane: a person adjudicates it, never a vote alone. */
function isSecurityLane(finding) {
  if (flagged(finding.security)) return true;
  if (isText(finding.lane) && finding.lane.trim().toLowerCase() === 'security') return true;
  if (flagged(finding.critical)) return true;
  return isText(finding.severity) && finding.severity.trim().toLowerCase() === 'critical';
}

/** Whether a finding needs no answer: style, diagnostic or cleanup. The security lane is never one. */
function isNonFinding(finding) {
  if (isSecurityLane(finding)) return false;
  if (finding.nonFinding === true) return true;
  return isText(finding.kind) && NON_FINDING_KINDS.includes(finding.kind.trim().toLowerCase());
}

/**
 * The verifier count a round expects per finding: the depth's own, unless the policy's bounds override it.
 * One answer for `tallyVotes` and for `planVerification`, so what is planned and what is checked can never
 * disagree on K.
 *
 * @returns {{ok:true, depth:string, expected:number}|{ok:false, reason:string}}
 */
function resolveExpected(input) {
  const depth = isText(input.depth) ? input.depth.trim().toLowerCase() : null;
  if (depth === null || !Object.prototype.hasOwnProperty.call(EXPECTED_VERIFIERS, depth)) {
    return { ok: false, reason: `unknown depth ${JSON.stringify(input.depth)} (expected quick, standard or deep)` };
  }
  let expected = EXPECTED_VERIFIERS[depth];
  if (input.expectedVerifiers !== undefined) {
    if (!Number.isInteger(input.expectedVerifiers) || input.expectedVerifiers < 0) {
      return { ok: false, reason: 'expectedVerifiers must be an integer >= 0 when given' };
    }
    expected = input.expectedVerifiers;
  }
  return { ok: true, depth, expected };
}

/**
 * Reads and checks the explicit candidate-to-verifier assignment (`planVerification`'s `assignments`).
 *
 * This is a STRUCTURAL check, so a plan that is wrong blocks the whole tally rather than degrading one
 * finding: every finding needs exactly one entry naming exactly `expected` DISTINCT verifiers, none of them
 * anyone who raised the finding (`raisersOf`), and no entry may name something that is not a finding. A
 * finding with fewer assigned verifiers than the depth expects would otherwise be read as a finding whose
 * verifiers merely stayed quiet; the one exception is an entry the planner explicitly flagged `incomplete`
 * (a pool too short to fill it), which is recorded as verifier-incomplete instead of blocking.
 *
 * @returns {{ok:true, byId:Map<string, string[]>}|{ok:false, reason:string}}
 */
function readAssignment(input, findings, expected) {
  if (!Array.isArray(input.assignment)) return { ok: false, reason: 'assignment must be an array of { id, verifiers }' };

  const byId = new Map();
  const incompleteIds = new Map();
  for (const entry of input.assignment) {
    const id = isObject(entry) ? identity(entry.id) : null;
    if (id === null || !Array.isArray(entry.verifiers) || !entry.verifiers.every(isText)) {
      return { ok: false, reason: 'every assignment entry needs an id and a verifiers array of names' };
    }
    if (entry.incomplete !== undefined && typeof entry.incomplete !== 'boolean') {
      return { ok: false, reason: 'an assignment entry\'s incomplete flag must be true or false when given' };
    }
    if (byId.has(id)) return { ok: false, reason: `assignment names finding ${JSON.stringify(id)} more than once` };
    byId.set(id, entry.verifiers.map((name) => name.trim()));
    incompleteIds.set(id, entry.incomplete === true);
  }

  const known = new Set(findings.map((finding) => identity(finding.id)));
  for (const id of byId.keys()) {
    if (!known.has(id)) return { ok: false, reason: `assignment names ${JSON.stringify(id)}, which is not a candidate finding` };
  }

  for (const finding of findings) {
    const id = identity(finding.id);
    const assigned = byId.get(id);
    if (assigned === undefined) return { ok: false, reason: `finding ${JSON.stringify(id)} has no verifier assignment` };
    const keys = assigned.map((name) => name.toLowerCase());
    if (new Set(keys).size !== keys.length) {
      return { ok: false, reason: `finding ${JSON.stringify(id)} is assigned the same verifier more than once` };
    }
    // Nobody verifies a finding they raised, and the raiser of a ledger candidate is its `source` (and each
    // merged co-raiser's), not only a `reviewer` field. A finding that names no raiser at all cannot be
    // checked for that, so it is refused when anyone is expected to verify it.
    const raisers = raisersOf(finding);
    if (expected > 0 && !raisers.ok) {
      return { ok: false, reason: `finding ${JSON.stringify(id)} has an unreadable reviewer or source` };
    }
    if (expected > 0 && raisers.names.length === 0) {
      return { ok: false, reason: `finding ${JSON.stringify(id)} names no reviewer or source, so its own raiser cannot be excluded` };
    }
    if (keys.length > expected || (keys.length < expected && incompleteIds.get(id) !== true)) {
      return {
        ok: false,
        reason: `finding ${JSON.stringify(id)} is assigned ${keys.length} distinct verifiers but the depth expects ${expected}`,
      };
    }
    if (incompleteIds.get(id) === true && keys.length === expected) {
      return { ok: false, reason: `finding ${JSON.stringify(id)} is marked incomplete but is assigned all ${expected} verifiers` };
    }
    if (keys.some((key) => raisers.names.includes(key))) {
      return { ok: false, reason: `finding ${JSON.stringify(id)} is assigned its own reviewer as a verifier` };
    }
  }
  return { ok: true, byId, incomplete: new Set([...incompleteIds].filter(([, flag]) => flag).map(([id]) => id)) };
}

/**
 * Counts the votes that actually count for one finding.
 *
 * A vote is discarded, with its reason recorded, when the verifier is the
 * finding's own reviewer (nobody verifies themselves), when the verdict is
 * not one of real / not-real / abstain, when the verifier is unnamed, or when
 * that verifier has already voted on this finding. When the finding has an
 * explicit `assigned` list, a vote from anyone outside it is discarded too
 * (`not-assigned`), and the assigned verifiers who cast no counted vote are
 * returned as `silent`.
 */
function countVotes(finding, assigned) {
  const votes = finding.votes === undefined || finding.votes === null ? [] : finding.votes;
  if (!Array.isArray(votes)) return { ok: false, reason: 'unreadable-votes' };

  const raisers = new Set(raisersOf(finding).names);
  const counted = { real: 0, notReal: 0, abstain: 0 };
  const ignoredVotes = [];
  const seen = new Set();
  const assignedKeys = assigned === undefined ? null : new Set(assigned.map((name) => name.toLowerCase()));

  for (const vote of Array.from(votes)) {
    if (!isObject(vote)) return { ok: false, reason: 'unreadable-votes' };
    const verifier = isText(vote.verifier) ? vote.verifier.trim() : null;
    if (verifier === null) {
      ignoredVotes.push({ verifier: null, reason: 'unnamed-verifier' });
      continue;
    }
    const key = verifier.toLowerCase();
    if (raisers.has(key)) {
      ignoredVotes.push({ verifier, reason: 'own-finding' });
      continue;
    }
    if (assignedKeys !== null && !assignedKeys.has(key)) {
      ignoredVotes.push({ verifier, reason: 'not-assigned' });
      continue;
    }
    const verdict = isText(vote.verdict) ? vote.verdict.trim().toLowerCase() : null;
    if (verdict === null || !VERDICTS.includes(verdict)) {
      ignoredVotes.push({ verifier, reason: 'unknown-verdict' });
      continue;
    }
    if (seen.has(key)) {
      ignoredVotes.push({ verifier, reason: 'duplicate-vote' });
      continue;
    }
    seen.add(key);
    if (verdict === 'real') counted.real += 1;
    else if (verdict === 'not-real') counted.notReal += 1;
    else counted.abstain += 1;
  }

  const silent = assigned === undefined ? [] : assigned.filter((name) => !seen.has(name.toLowerCase()));
  return { ok: true, counted, ignoredVotes, silent };
}

/**
 * Tallies verifier votes over the candidate findings of one review round.
 *
 * @param {Object} input
 * @param {Object[]} input.findings  Candidate findings, each `{ id, severity?, kind?,
 *   security?, reviewer?, votes:[{ verifier, verdict }], incompleteVerifiers?:
 *   [{verifier, reason}] }`. `incompleteVerifiers` names a verifier assigned to
 *   THIS finding that returned no usable vote (timeout, tool failure) -- the
 *   finding is degraded even when the votes that did arrive would otherwise
 *   reach a majority (AC-006-3).
 * @param {string} input.depth       `quick` | `standard` | `deep`.
 * @param {number} [input.expectedVerifiers]  Overrides the depth's expected count.
 * @param {Array<{id:string, verifiers:string[], incomplete?:boolean}>} [input.assignment]  The explicit
 *   candidate-to-verifier plan (`planVerification`'s `assignments`). When given, every finding needs exactly
 *   one entry naming exactly the expected number of DISTINCT verifiers, none of them anyone who raised it
 *   (its `reviewer`, `source` or a merged `mergedFrom[].source`; a finding naming no raiser is refused) --
 *   anything else blocks the round. An entry flagged `incomplete: true` (a pool too short for that finding,
 *   planned with `allowShortPool`) may name fewer, down to none: that finding alone is `unverified` /
 *   `verifier-incomplete` (an `(unassigned)` entry in its `incompleteVerifiers`) and the rest of the round
 *   stays structural. A vote from someone not assigned to that finding does not count (`not-assigned`); and
 *   an assigned verifier with no counted vote is named in the finding's `incompleteVerifiers` (reason
 *   `no-vote`), so the finding is `unverified` / `verifier-incomplete` however the other votes fell.
 * @param {boolean} [input.settleOnMajority]  `true` (nothing else counts) settles a finding as `present` when a strict
 *   majority of the EXPECTED verifiers voted it real although another assigned verifier returned nothing (kata dx53;
 *   see SETTLING ON A MAJORITY above for what keeps it from being a relaxation). Needs `assignment`. Default: off, and
 *   a missing verifier makes a finding `unverified` / `verifier-incomplete` however the other votes fell (AC-006-3).
 * @param {boolean} [input.verificationCapability]  `false` means no subagent
 *   capability ran this round at all: every finding comes back `unverified`
 *   and nothing is dropped (AC-006-3). Anything other than an explicit
 *   `false` is read as capable.
 * @returns {{ok:boolean, verification:string, reason?:string, recoveryAction?:string,
 *   findings:Object[], presented:Object[]}}
 */
function tallyVotes(input) {
  if (!isObject(input)) return blocked('invalid-input');
  if (!Array.isArray(input.findings)) return blocked('findings must be an array');
  if (!input.findings.every(isObject)) return blocked('findings must contain only objects');

  const resolved = resolveExpected(input);
  if (!resolved.ok) return blocked(resolved.reason);
  const { expected } = resolved;

  const ids = input.findings.map((finding) => identity(finding.id));
  if (ids.some((id) => id === null)) return blocked('every finding needs an id');

  let assignment = null;
  if (input.assignment !== undefined) {
    assignment = readAssignment(input, input.findings, expected);
    if (!assignment.ok) return blocked(assignment.reason);
  }

  const needed = majorityOf(expected);
  const quick = expected === 0;
  const capable = input.verificationCapability !== false;
  /** The one opt-in that lets the arrived votes settle a finding some assigned verifier did not answer (kata dx53). */
  const settle = input.settleOnMajority === true;

  /** Verifiers named on `finding.incompleteVerifiers` that returned no usable vote for it. */
  const incompleteVerifiersOf = (finding) => {
    if (!Array.isArray(finding.incompleteVerifiers)) return [];
    return finding.incompleteVerifiers.filter((entry) => isObject(entry) && isText(entry.verifier));
  };

  const withLabel = (entry) => ({ ...entry, authorLabel: authorLabelFor(entry.outcome, entry.reason) });

  const findings = input.findings.map((finding, index) => {
    const base = { ...finding, id: finding.id };

    if (!capable) {
      return withLabel({
        ...base,
        outcome: 'unverified',
        reason: 'no-subagent-capability',
        presented: true,
        tally: { real: 0, notReal: 0, abstain: 0, expected, needed },
        ignoredVotes: [],
      });
    }

    const votes = countVotes(finding, assignment === null ? undefined : assignment.byId.get(identity(finding.id)));

    if (!votes.ok) {
      // Unreadable votes: the finding stays, marked, and is presented.
      return withLabel({
        ...base,
        outcome: 'unverified',
        reason: votes.reason,
        presented: true,
        tally: { real: 0, notReal: 0, abstain: 0, expected, needed },
        ignoredVotes: [],
      });
    }

    const tally = { ...votes.counted, expected, needed };
    const entry = { ...base, tally, ignoredVotes: votes.ignoredVotes };
    if (assignment !== null) entry.assigned = assignment.byId.get(identity(finding.id));
    // Assigned verifiers who cast no counted vote are named here, so a candidate that lost one of its K
    // verifiers is degraded rather than confirmed by the others (a silent verifier is not a "yes").
    const named = incompleteVerifiersOf(finding);
    const namedKeys = new Set(named.map((item) => item.verifier.trim().toLowerCase()));
    const assignedHere = assignment === null ? undefined : assignment.byId.get(identity(finding.id));
    const incompleteVerifiers = [
      ...named,
      ...votes.silent.filter((name) => !namedKeys.has(name.toLowerCase())).map((verifier) => ({ verifier, reason: 'no-vote' })),
      // A candidate the planner could not give K verifiers (an explicit `incomplete` entry) is recorded as
      // incomplete however its assigned verifiers voted: a short electorate is never read as agreement.
      ...(assignment !== null && assignment.incomplete.has(identity(finding.id))
        ? [{ verifier: UNASSIGNED_VERIFIER, reason: 'verifier-pool-too-small', missing: expected - assignedHere.length }]
        : []),
    ];

    if (quick) {
      // No verifier was expected, so no vote can speak for this finding.
      return withLabel({ ...entry, outcome: 'unverified', reason: 'verification-not-performed', presented: true });
    }

    if (incompleteVerifiers.length > 0) {
      // Settling on a majority (opt-in, kata dx53): the strict majority of the EXPECTED verifiers already voted it real, so no vote still
      // missing can change the outcome (present needs real >= needed, and a missing vote can only add to real). The missing verifiers stay
      // named. Never for a refutation or a split (they stay unverified: nothing is dropped on an incomplete electorate), without the
      // explicit assignment, for a candidate the planner could not give its verifiers, or for a non-finding (filtered, not presented).
      const shortElectorate = assignment !== null && assignment.incomplete.has(identity(finding.id));
      if (settle && assignment !== null && !shortElectorate && !isNonFinding(finding) && votes.counted.real >= needed) {
        return withLabel({ ...entry, outcome: 'present', reason: 'verifier-majority', presented: true, incompleteVerifiers, settledOnMajority: true });
      }
      // Coverage for THIS finding is incomplete (timeout, tool failure): degraded even if the
      // votes that did arrive would otherwise reach a majority (AC-006-3).
      return withLabel({
        ...entry,
        outcome: 'unverified',
        reason: 'verifier-incomplete',
        presented: true,
        incompleteVerifiers,
      });
    }

    if (isNonFinding(finding)) {
      return withLabel({ ...entry, outcome: 'filtered', reason: 'non-finding', presented: false });
    }

    if (votes.counted.real >= needed) {
      return withLabel({ ...entry, outcome: 'present', reason: 'verifier-majority', presented: true });
    }

    if (isSecurityLane(finding)) {
      // Critical and security-relevant findings are never closed by a vote:
      // they go to a person (AC-006-2).
      return withLabel({ ...entry, outcome: 'disputed', reason: 'security-finding-not-verified', presented: true });
    }

    const usable = votes.counted.real + votes.counted.notReal + votes.counted.abstain;
    if (usable === 0) {
      // No usable vote at all: silence is not a verdict, so the finding is kept and marked, never filtered.
      return withLabel({ ...entry, outcome: 'unverified', reason: 'verifier-incomplete', presented: true });
    }

    return withLabel({ ...entry, outcome: 'filtered', reason: 'verifier-majority-not-reached', presented: false, index });
  });

  const cleaned = findings.map((entry) => {
    const copy = { ...entry };
    delete copy.index;
    return copy;
  });

  const degraded = cleaned.filter((entry) => entry.outcome === 'unverified');
  let verification = 'performed';
  let reason;
  let recoveryAction;
  if (!capable) {
    verification = 'not-performed';
    reason = 'no-subagent-capability';
    recoveryAction = 're-run-verification';
  } else if (quick) {
    verification = 'not-performed';
    reason = 'depth-quick-no-verifiers';
    recoveryAction = 're-run-verification';
  } else if (degraded.length === cleaned.length && cleaned.length > 0) {
    verification = 'not-performed';
    reason = 'verifier-incomplete';
    recoveryAction = 'supply-the-missing-votes';
  } else if (degraded.length > 0 || cleaned.some((entry) => entry.settledOnMajority === true)) {
    // some finding is unverified, or every finding is settled but a verifier assigned to one of them returned nothing: not a complete round
    verification = 'partial';
    reason = 'some-verifiers-did-not-return';
    recoveryAction = 'supply-the-missing-votes';
  }

  const result = {
    ok: true,
    verification,
    findings: cleaned,
    presented: cleaned.filter((entry) => entry.presented),
  };
  if (reason !== undefined) result.reason = reason;
  if (recoveryAction !== undefined) result.recoveryAction = recoveryAction;
  return result;
}

module.exports = { tallyVotes, majorityOf, resolveExpected, raisersOf, EXPECTED_VERIFIERS, VERDICTS, NON_FINDING_KINDS };
