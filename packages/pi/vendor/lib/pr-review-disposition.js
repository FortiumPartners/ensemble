'use strict';

/**
 * Disposition choices for the PR-review cycle: what the operator is asked to
 * decide about each still-undecided finding, and the data behind the final
 * merge question (docs/plans/pr-review-speedup-plan.md, section 3H).
 *
 * NO side effects, NO shell, NO network, NO file reads, NO clock. A pure
 * function over the ledger, the security lane, the vote tally, the policy and
 * the head SHA.
 *
 * What this module guarantees, because the operator relies on it:
 *
 *   - it says what the gate says. Which findings BLOCK is not decided here, it
 *     is asked of the gate (`findingsHeldOpen`): the "undecided blocking"
 *     findings are exactly the ones the gate holds open, and the "accepted"
 *     ones are exactly those the gate no longer holds open because of a
 *     decision it takes (a resolution with provenance, from a login the
 *     policy lets decide). A finding the verifiers filtered out is still listed
 *     while the gate blocks on it, with the tally that filtered it;
 *   - what the gate does not block on is the operator's own view of what the
 *     merge accepts: a Nit or Pre-existing ledger finding is listed until a
 *     resolution with provenance is recorded on it, unless it is `cleared` or
 *     the verifiers filtered it out. A resolution that does not count (a stale
 *     head, no `by`, a bot...) decides nothing: the finding is listed again and
 *     marked `staleResolution`;
 *   - a blocking finding is never offered `follow-on` (a follow-on PR cannot
 *     unblock the gate), is never defaulted to `accept`, and its `accept` is
 *     never batchable;
 *   - a SECURITY finding's `accept` is never the default, never batchable and
 *     always needs its own reason; security findings are never collapsed;
 *   - a finding nobody could vote on is never shown as if somebody had: an entry whose outcome is `unverified` carries
 *     `verification` (`outcome`, `reason`, and for a claim the verifier brief refused, `unbriefable` with its kind and the
 *     renderer's reason), and its `votes` is null when it has no tally. A list built with no `votes` (the recorded state
 *     report, `MODE=gate`) reads the record from the ledger finding itself. The operator decides such a finding with no
 *     verifier's help, and the entry says so (kata 0g9n);
 *   - a bead is OPEN only when the ledger finding carries `beadId`. A live
 *     finding whose bead a person closed carries `closedBeadId` instead: it is
 *     its own state (`findingsWithClosedBead`), never counted as an open bead,
 *     and it still counts as a finding without an open bead;
 *   - FAIL CLOSED: input this module cannot read, findings the gate cannot
 *     read included, yields `ok: false` with empty lists, never a quietly
 *     shorter list;
 *   - a COVERAGE GAP (a slice, the whole-range read or a path nobody read, kata k48x) is listed in its own group,
 *     `coverage` ("Not reviewed"), once the gate holds it open: Accept is its only choice (it is never defaulted, never
 *     batched and always needs its own reason; there is nothing to fix on this PR, the remedy is to run the review again),
 *     and the entry says what was not read. The gate decides which gaps are open (`coverageHeldOpen`) and takes the
 *     operator's decision on one exactly as it takes it on a finding, so an accepted gap is reported in
 *     `mergeConfirmation.acceptedCoverage`. A coverage the gate reports `unavailable` has no gap to decide: the gate says
 *     so, and the findings are still listed.
 */

const {
  normalizeSeverity,
  anchorOf,
  hasResolutionProvenance,
  isCritical,
} = require('./pr-review-ledger');
const { findingsHeldOpen, coverageHeldOpen } = require('./pr-review-gate');

/** The groups, in the order they are presented. */
const GROUPS = Object.freeze(['blocking', 'coverage', 'nit', 'pre-existing']);

/** The only dispositions an operator can pick. */
const CHOICE_IDS = Object.freeze(['fix-here', 'follow-on', 'accept']);

/** More than this many undecided same-file findings in a group collapse into one entry. */
const COLLAPSE_THRESHOLD = 3;

const GROUP_LABELS = Object.freeze({
  blocking: 'Blocking',
  coverage: 'Not reviewed',
  nit: 'Nits',
  'pre-existing': 'Pre-existing',
});

const CHOICE_LABELS = Object.freeze({
  'fix-here': 'Fix on this PR',
  'follow-on': 'Fix in a follow-on PR',
  accept: 'Accept without fixing',
});

const FIX_HERE_NOTE =
  'Queued: one fix agent, one push. The head moves and any approvals reset.';
const FOLLOW_ON_NOTE = 'The bead stays open, labelled follow-on.';

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isText(value) {
  return typeof value === 'string' && value.trim() !== '';
}

/** A finding id as the gate reads one: text, or a finite number. */
function hasId(finding) {
  return isText(finding.id) || Number.isFinite(finding.id);
}

/** One key per id whichever way it was written (`7` and `'7'` are the same finding). */
function keyOf(id) {
  return typeof id === 'string' ? id.trim() : String(id);
}

/** Same lenient truthiness as the vote tally's `flagged`: anything but an explicit "no". */
function flagged(value) {
  if (value === undefined || value === null || value === false) return false;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') return !['', 'false', 'no', 'n', '0', 'off'].includes(value.trim().toLowerCase());
  return true;
}

function failClosed(reason) {
  return { ok: false, reason, dispositionChoices: [], groups: [], mergeConfirmation: null };
}

/**
 * Security if it came through the security lane, is flagged, sits on the
 * security lane, or is Critical (as written or read into the taxonomy since:
 * `isCritical`). Broader is the safe direction. This only decides how an
 * `accept` is offered (never batched, its own reason); whether the finding
 * BLOCKS is the gate's.
 */
function isSecurity(finding, fromSecurityLane) {
  if (fromSecurityLane) return true;
  if (flagged(finding.security) || flagged(finding.securityRelevant)) return true;
  if (isText(finding.lane) && finding.lane.trim().toLowerCase() === 'security') return true;
  return isCritical(finding);
}

/** The severity word shown for a finding: the canonical one, else the word as written. */
function severityWord(finding) {
  const canonical = normalizeSeverity(finding.severity);
  if (canonical !== null) return canonical;
  return isText(finding.severity) ? finding.severity.trim() : 'unrecognised';
}

/** The file a finding is about, or null when it has none (then it is not collapsible). */
function fileOf(finding) {
  if (isText(finding.file)) return finding.file.trim();
  const anchor = anchorOf(finding);
  if (anchor !== null) return anchor.file;
  if (isText(finding.locationOrLink)) {
    const stripped = finding.locationOrLink.trim().replace(/:\d+(?:-\d+)?$/, '');
    if (stripped !== finding.locationOrLink.trim() && stripped !== '') return stripped;
  }
  return null;
}

function buildChoices(group, security) {
  const blocking = group === 'blocking';
  const defaultId = blocking ? 'fix-here' : 'follow-on';
  const fixHere = {
    id: 'fix-here',
    label: CHOICE_LABELS['fix-here'],
    requiresReason: false,
    batchable: true,
    default: defaultId === 'fix-here',
    note: FIX_HERE_NOTE,
  };
  const followOn = {
    id: 'follow-on',
    label: CHOICE_LABELS['follow-on'],
    requiresReason: false,
    batchable: true,
    default: defaultId === 'follow-on',
    note: FOLLOW_ON_NOTE,
  };
  const accept = {
    id: 'accept',
    label: CHOICE_LABELS.accept,
    requiresReason: true,
    // Blocking findings and security findings are decided one by one.
    batchable: !blocking && !security,
    default: false,
  };
  // A blocking finding offers no follow-on: a follow-on PR cannot unblock the gate.
  const choices = blocking ? [fixHere, accept] : [fixHere, followOn, accept];
  return { choices, default: defaultId };
}

function tallyOf(votesById, id) {
  const entry = votesById.get(keyOf(id));
  if (!entry || !isObject(entry.tally)) return null;
  const { real, notReal, abstain, expected } = entry.tally;
  return { real, notReal, abstain, expected };
}

/**
 * What the operator must be told about a finding nobody could vote on: its outcome is `unverified`, so a tally beside it (or
 * none) is not a verdict. `{outcome, reason, unbriefable?}`; `unbriefable` (`kind`, `reason`, `input`) is present when the
 * verifier brief refused the claim or the location and no verifier was ever asked. Null for every other outcome: a `present`
 * or `filtered` finding is described by its tally, as before.
 *
 * The run's tally speaks first. A list built from the recorded state report is given no votes, so it reads the `verification`
 * record the ledger finding carries (the review runner writes it there): the finding is named as not verified on that path
 * too, and no vote is invented for it (`votes` stays null).
 */
function verificationOf(votesById, finding) {
  const entry = votesById.get(keyOf(finding.id)) || (isObject(finding.verification) ? finding.verification : null);
  if (!entry || entry.outcome !== 'unverified') return null;
  const refusal = isObject(entry.unbriefable) ? entry.unbriefable : null;
  return {
    outcome: 'unverified',
    reason: isText(entry.reason) ? entry.reason : null,
    ...(refusal === null ? {} : { unbriefable: { kind: refusal.kind, ...(isText(refusal.input) ? { input: refusal.input } : {}), reason: refusal.reason } }),
  };
}

function aggregateVotes(members) {
  const withVotes = members.filter((m) => m.votes !== null);
  if (withVotes.length === 0) return null;
  const sum = (key) => withVotes.reduce((total, m) => total + (Number(m.votes[key]) || 0), 0);
  return {
    real: sum('real'),
    notReal: sum('notReal'),
    abstain: sum('abstain'),
    expected: Math.max(...withVotes.map((m) => Number(m.votes.expected) || 0)),
  };
}

/** Intersection of the choice ids every entry allows batching on, in CHOICE_IDS order. */
function batchChoicesOf(entries) {
  return CHOICE_IDS.filter((id) =>
    entries.every((entry) => entry.choices.some((choice) => choice.id === id && choice.batchable === true)),
  );
}

/** One short human line for the merge question. */
function summarize({ openBeads, acceptedBlocking, undecidedBlocking, findingsWithClosedBead, undecidedCoverage = [], acceptedCoverage = [] }) {
  const accepted = acceptedBlocking.length === 0
    ? '0 blocking findings accepted'
    : `${acceptedBlocking.length} blocking finding(s) accepted (${acceptedBlocking
      .map((a) => `${a.id}: ${a.reason}`)
      .join('; ')})`;
  const closed = findingsWithClosedBead.length === 0
    ? ''
    : `; ${findingsWithClosedBead.length} finding(s) live with a closed bead (${findingsWithClosedBead.join(', ')})`;
  // Said only when there is a gap to say it about, so a review whose coverage is complete reads exactly as it always did.
  const gapsUndecided = undecidedCoverage.length === 0 ? '' : `; ${undecidedCoverage.length} coverage gap(s) undecided (${undecidedCoverage.join(', ')})`;
  const gapsAccepted = acceptedCoverage.length === 0
    ? ''
    : `; ${acceptedCoverage.length} coverage gap(s) accepted as not reviewed (${acceptedCoverage.map((a) => `${a.id}: ${a.reason}`).join('; ')})`;
  return `${openBeads} open bead(s); ${accepted}; ${undecidedBlocking.length} blocking finding(s) undecided${closed}${gapsUndecided}${gapsAccepted}`;
}

/** What Accept means for each kind of gap, said where the operator reads it (a gap is not always a path nobody read). */
const COVERAGE_ACCEPT_NOTES = {
  'whole-range': 'Records that the whole-range reader (the one read of an interaction between slices) did not read the whole diff: the slice reviewers read these paths one slice at a time. You accept merging without that read.',
  uncovered: 'Records that no slice held these paths and no reviewer read them, and you accept merging without that read.',
  'under-reviewed': 'Records that these paths were read under fewer distinct lenses than the mode requires, and you accept merging with that shorter review.',
  'result-changed': 'Records that this agent rewrote its result after the review read it, so the review counted the first version and not the later one: a finding or a vote that only the later version holds was not counted. Read the file named in the gap before you accept; you accept merging without what the later version holds.',
  unnamed: 'Records that the review reported incomplete coverage without saying what it missed, so every changed path counts as not reviewed, and you accept merging without that read.',
};
const COVERAGE_ACCEPT_TAIL = ' The other way out is to run the review again.';

/** Why a slice's reviewers failed, as the gap carries it: `reviewer-s1-b: expired:deadline-passed; ...`. */
const reasonsLine = (gap) => (Array.isArray(gap.reasons) ? gap.reasons.filter(isObject).map((entry) => `${entry.agent}: ${entry.reason}`).join('; ') : '');

/**
 * A slice counts as reviewed only when EVERY reviewer of it arrived in time and listed every path, so a slice one of its two reviewers
 * did read is still a gap: the note says what failed and why that slice does not count, instead of calling it unread.
 */
function sliceAcceptNote(gap) {
  const why = reasonsLine(gap);
  return why === ''
    ? 'Records that no reviewer result covered this slice and you accept merging without that read.'
    : `Records that this slice was not fully reviewed (${why}): a slice counts as reviewed only when every reviewer of it arrived in time and listed every path, so it does not count even where another reviewer of it did read its paths. You accept merging without the full review.`;
}
const coverageAcceptNote = (gap) => `${gap.gapType === 'slice' ? sliceAcceptNote(gap) : COVERAGE_ACCEPT_NOTES[gap.gapType] || COVERAGE_ACCEPT_NOTES.unnamed}${COVERAGE_ACCEPT_TAIL}`;

/**
 * The operator's list entry for one coverage gap the gate holds open: Accept is its only choice (it is never defaulted, never
 * batched and always needs its own reason: there is no code to change, so there is nothing to fix on this PR or in a follow-on).
 */
function coverageEntry(gap) {
  const stale = isObject(gap.resolution);
  return {
    id: gap.id,
    severity: 'important',
    locationOrLink: gap.locationOrLink,
    votes: null,
    beadId: isText(gap.beadId) ? gap.beadId : null,
    closedBeadId: isText(gap.beadId) || !isText(gap.closedBeadId) ? null : gap.closedBeadId,
    group: 'coverage',
    security: false,
    choices: [{ id: 'accept', label: CHOICE_LABELS.accept, requiresReason: true, batchable: false, default: false, note: coverageAcceptNote(gap) }],
    default: null,
    requiresReason: true,
    reasonPerFinding: true,
    coverage: {
      gapType: gap.gapType,
      ...(isText(gap.sliceId) ? { sliceId: gap.sliceId } : {}),
      paths: gap.paths.slice(),
      ...(Array.isArray(gap.reasons) && gap.reasons.length > 0 ? { reasons: gap.reasons } : {}),
      ...(isText(gap.carriedFrom) ? { carriedFrom: gap.carriedFrom } : {}),
      failureMode: gap.failureMode,
    },
    ...(stale ? { staleResolution: true } : {}),
  };
}

/**
 * Build the per-finding disposition choices and the merge-confirmation data.
 *
 * @param {{ledger: object[], security?: {status?: string, findings?: object[]},
 *   coverage?: {status?: string, gaps?: object[]},
 *   votes?: {ok?: boolean, findings?: object[]}, policy?: object, headSha: string}} input
 *   `policy` is the base-branch policy block, handed to the gate so a decision
 *   by a login it refuses is not counted here either.
 * @returns {{ok: boolean, reason?: string, dispositionChoices: object[],
 *   groups: object[], mergeConfirmation: object|null}}
 */
function buildDispositionChoices(input) {
  if (!isObject(input)) return failClosed('input must be an object');
  if (!Array.isArray(input.ledger)) return failClosed('ledger must be an array');
  if (!isText(input.headSha)) return failClosed('headSha is required');
  const headSha = input.headSha.trim();
  const { policy } = input;

  let securityFindings = [];
  if (input.security !== undefined && input.security !== null) {
    if (!isObject(input.security)) return failClosed('security must be an object');
    if (input.security.findings !== undefined) {
      if (!Array.isArray(input.security.findings)) return failClosed('security.findings must be an array');
      securityFindings = input.security.findings;
    }
  }
  for (const finding of [...input.ledger, ...securityFindings]) {
    if (!isObject(finding)) return failClosed('every finding must be an object');
    if (!hasId(finding)) return failClosed('every finding needs an id');
  }

  // What blocks is the gate's to say, and what the gate cannot read is refused here too.
  const held = findingsHeldOpen({ ledger: input.ledger, laneFindings: securityFindings, headSha, policy });
  if (!held.ok) return failClosed(held.reason);

  // A coverage gap is listed once the gate holds it open (its own `coverageHeldOpen`: the rule is the gate's, never copied here).
  // `coverage` is optional HERE (the gate is the one that requires it and says so); one that is given and cannot be read is
  // refused like unreadable findings. A coverage the gate calls `unavailable` has no gap to decide.
  const openGaps = [];
  const acceptedCoverage = [];
  if (input.coverage !== undefined && input.coverage !== null) {
    if (!isObject(input.coverage)) return failClosed('coverage must be an object');
    const heldCoverage = coverageHeldOpen({ coverage: input.coverage, headSha, policy });
    if (!heldCoverage.ok) return failClosed(heldCoverage.reason);
    const gaps = Array.isArray(input.coverage.gaps) ? input.coverage.gaps : [];
    for (const gap of gaps) {
      if (heldCoverage.open.has(String(gap.id))) openGaps.push(gap);
    }
    for (const decided of heldCoverage.decided) {
      const gap = gaps.find((candidate) => String(candidate.id) === decided.id);
      acceptedCoverage.push({ id: decided.id, paths: gap.paths.slice(), reason: decided.reason, by: decided.by, at: decided.at });
    }
  }

  // One finding per id, whichever list it came in. Each copy was graded by the gate on its own.
  const merged = new Map();
  const lanes = [
    [input.ledger, false],
    [securityFindings, true],
  ];
  for (const [list, fromSecurity] of lanes) {
    for (const finding of list) {
      const key = keyOf(finding.id);
      const heldOpen = (fromSecurity ? held.laneOpen : held.ledgerOpen).has(String(finding.id));
      if (!merged.has(key)) merged.set(key, []);
      merged.get(key).push({ finding, fromSecurity, heldOpen });
    }
  }

  const votesById = new Map();
  if (isObject(input.votes) && Array.isArray(input.votes.findings)) {
    for (const entry of input.votes.findings) {
      if (isObject(entry) && hasId(entry)) votesById.set(keyOf(entry.id), entry);
    }
  }

  const undecided = [];
  const acceptedBlocking = [];
  for (const copies of merged.values()) {
    // The copy the gate blocks on is the one asked about (the lane's first: security wins), else the lane's, else the ledger's.
    const blocking = copies.find((c) => c.fromSecurity && c.heldOpen) || copies.find((c) => c.heldOpen) || null;
    const { finding, fromSecurity } = blocking || copies.find((c) => c.fromSecurity) || copies[0];
    const security = copies.some((c) => c.fromSecurity) || isSecurity(finding, false);
    const severity = severityWord(finding);
    const canonical = normalizeSeverity(finding.severity);
    let group = 'blocking';

    if (blocking === null) {
      if (finding.cleared === true) continue;
      const decided = hasResolutionProvenance(finding, headSha, policy, fromSecurity === true);
      // The gate no longer holds it open. A finding the operator had to answer was closed by a decision it takes.
      if (fromSecurity || (canonical !== 'nit' && canonical !== 'pre-existing')) {
        if (decided) {
          const { reason, by, at } = finding.resolution;
          acceptedBlocking.push({ id: finding.id, severity, security, reason, by, at });
        }
        continue;
      }
      // A Nit or Pre-existing ledger finding never blocks: it is listed until the operator's decision is recorded on it.
      if (decided) continue;
      const vote = votesById.get(keyOf(finding.id));
      if (vote !== undefined && vote.presented === false) continue;
      group = canonical === 'pre-existing' ? 'pre-existing' : 'nit';
    }

    undecided.push({
      finding,
      security,
      group,
      severity,
      votes: tallyOf(votesById, finding.id),
      verification: verificationOf(votesById, finding),
      stale: finding.resolution !== undefined && finding.resolution !== null,
      file: fileOf(finding),
      index: undecided.length,
    });
  }

  // Order: group, then security before non-security inside blocking, then input order.
  const rank = (u) => GROUPS.indexOf(u.group) * 2 + (u.group === 'blocking' && !u.security ? 1 : 0);
  undecided.sort((a, b) => rank(a) - rank(b) || a.index - b.index);

  // Collapse: more than COLLAPSE_THRESHOLD non-security same-file findings in nit / pre-existing.
  const bucketKey = (u) => `${u.group}\u0000${u.file}`;
  const collapsible = (u) => u.group !== 'blocking' && !u.security && u.file !== null;
  const buckets = new Map();
  for (const u of undecided) {
    if (!collapsible(u)) continue;
    const key = bucketKey(u);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(u);
  }
  const collapsedKeys = new Set(
    [...buckets.entries()].filter(([, list]) => list.length > COLLAPSE_THRESHOLD).map(([key]) => key),
  );

  const entries = [];
  const emitted = new Set();
  for (const u of undecided) {
    const { choices, default: defaultId } = buildChoices(u.group, u.security);
    const key = bucketKey(u);
    if (collapsible(u) && collapsedKeys.has(key)) {
      if (emitted.has(key)) continue;
      emitted.add(key);
      const members = buckets.get(key);
      const beadIds = members.map((m) => m.finding.beadId).filter(isText);
      const closedBeadIds = members
        .filter((m) => !isText(m.finding.beadId))
        .map((m) => m.finding.closedBeadId)
        .filter(isText);
      const entry = {
        id: `file:${u.file}`,
        collapsed: true,
        members: members.map((m) => ({ id: m.finding.id, locationOrLink: m.finding.locationOrLink })),
        file: u.file,
        severity: u.severity,
        locationOrLink: u.file,
        votes: aggregateVotes(members),
        beadId: null,
        beadIds,
        closedBeadIds,
        group: u.group,
        security: false,
        choices,
        default: defaultId,
        requiresReason: false,
      };
      if (members.some((m) => m.stale)) entry.staleResolution = true;
      entries.push(entry);
      continue;
    }
    const entry = {
      id: u.finding.id,
      severity: u.severity,
      locationOrLink: u.finding.locationOrLink,
      votes: u.votes,
      beadId: isText(u.finding.beadId) ? u.finding.beadId : null,
      closedBeadId: isText(u.finding.beadId) || !isText(u.finding.closedBeadId) ? null : u.finding.closedBeadId,
      group: u.group,
      security: u.security,
      choices,
      default: defaultId,
      requiresReason: u.group === 'blocking' || u.security,
    };
    if (u.security) entry.reasonPerFinding = true;
    if (u.verification !== null) entry.verification = u.verification;
    if (u.stale) entry.staleResolution = true;
    entries.push(entry);
  }

  // The coverage group sits right after the blocking findings.
  const coverageEntries = openGaps.map(coverageEntry);
  const firstOther = entries.findIndex((entry) => entry.group !== 'blocking');
  entries.splice(firstOther === -1 ? entries.length : firstOther, 0, ...coverageEntries);

  const groups = GROUPS.map((group) => {
    const inGroup = entries.filter((entry) => entry.group === group);
    return {
      group,
      label: GROUP_LABELS[group],
      ids: inGroup.map((entry) => entry.id),
      batchChoices: batchChoicesOf(inGroup),
      _size: inGroup.length,
    };
  })
    .filter((g) => g._size > 0)
    .map(({ _size, ...rest }) => rest);

  const hasOpenBead = (u) => isText(u.finding.beadId);
  const closedBeadOf = (u) => (!hasOpenBead(u) && isText(u.finding.closedBeadId) ? u.finding.closedBeadId : null);
  const openBeads = undecided.filter(hasOpenBead).length;
  const findingsWithClosedBead = undecided.filter((u) => closedBeadOf(u) !== null).map((u) => u.finding.id);
  const undecidedBlocking = entries.filter((entry) => entry.group === 'blocking').map((entry) => entry.id);
  const undecidedCoverage = coverageEntries.map((entry) => entry.id);
  const mergeConfirmation = {
    undecided: entries.map((entry) => entry.id),
    undecidedBlocking,
    openBeads,
    findingsWithoutBead: undecided.length - openBeads,
    findingsWithClosedBead,
    acceptedBlocking,
    staleResolutions: [...undecided.filter((u) => u.stale).map((u) => u.finding.id), ...coverageEntries.filter((entry) => entry.staleResolution === true).map((entry) => entry.id)],
    ...(input.coverage === undefined || input.coverage === null ? {} : { undecidedCoverage, acceptedCoverage }),
  };
  mergeConfirmation.summary = summarize({ openBeads, acceptedBlocking, undecidedBlocking, findingsWithClosedBead, undecidedCoverage, acceptedCoverage });

  return { ok: true, dispositionChoices: entries, groups, mergeConfirmation };
}

module.exports = { buildDispositionChoices, isSecurity, GROUPS, CHOICE_IDS, COLLAPSE_THRESHOLD };
