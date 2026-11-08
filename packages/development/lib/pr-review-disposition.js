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
 *   - a bead is OPEN only when the ledger finding carries `beadId`. A live
 *     finding whose bead a person closed carries `closedBeadId` instead: it is
 *     its own state (`findingsWithClosedBead`), never counted as an open bead,
 *     and it still counts as a finding without an open bead;
 *   - FAIL CLOSED: input this module cannot read, findings the gate cannot
 *     read included, yields `ok: false` with empty lists, never a quietly
 *     shorter list.
 */

const {
  normalizeSeverity,
  anchorOf,
  hasResolutionProvenance,
} = require('./pr-review-ledger');
const { findingsHeldOpen } = require('./pr-review-gate');

/** The groups, in the order they are presented. */
const GROUPS = Object.freeze(['blocking', 'nit', 'pre-existing']);

/** The only dispositions an operator can pick. */
const CHOICE_IDS = Object.freeze(['fix-here', 'follow-on', 'accept']);

/** More than this many undecided same-file findings in a group collapse into one entry. */
const COLLAPSE_THRESHOLD = 3;

const GROUP_LABELS = Object.freeze({
  blocking: 'Blocking',
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
 * security lane, or is Critical. Broader is the safe direction. This only
 * decides how an `accept` is offered (never batched, its own reason); whether
 * the finding BLOCKS is the gate's.
 */
function isSecurity(finding, fromSecurityLane) {
  if (fromSecurityLane) return true;
  if (flagged(finding.security) || flagged(finding.securityRelevant)) return true;
  if (isText(finding.lane) && finding.lane.trim().toLowerCase() === 'security') return true;
  return isText(finding.severity) && finding.severity.trim().toLowerCase() === 'critical';
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
function summarize({ openBeads, acceptedBlocking, undecidedBlocking, findingsWithClosedBead }) {
  const accepted = acceptedBlocking.length === 0
    ? '0 blocking findings accepted'
    : `${acceptedBlocking.length} blocking finding(s) accepted (${acceptedBlocking
      .map((a) => `${a.id}: ${a.reason}`)
      .join('; ')})`;
  const closed = findingsWithClosedBead.length === 0
    ? ''
    : `; ${findingsWithClosedBead.length} finding(s) live with a closed bead (${findingsWithClosedBead.join(', ')})`;
  return `${openBeads} open bead(s); ${accepted}; ${undecidedBlocking.length} blocking finding(s) undecided${closed}`;
}

/**
 * Build the per-finding disposition choices and the merge-confirmation data.
 *
 * @param {{ledger: object[], security?: {status?: string, findings?: object[]},
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
      const decided = hasResolutionProvenance(finding, headSha, policy);
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
    if (u.stale) entry.staleResolution = true;
    entries.push(entry);
  }

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
  const mergeConfirmation = {
    undecided: entries.map((entry) => entry.id),
    undecidedBlocking,
    openBeads,
    findingsWithoutBead: undecided.length - openBeads,
    findingsWithClosedBead,
    acceptedBlocking,
    staleResolutions: undecided.filter((u) => u.stale).map((u) => u.finding.id),
  };
  mergeConfirmation.summary = summarize({ openBeads, acceptedBlocking, undecidedBlocking, findingsWithClosedBead });

  return { ok: true, dispositionChoices: entries, groups, mergeConfirmation };
}

module.exports = { buildDispositionChoices, isSecurity, GROUPS, CHOICE_IDS, COLLAPSE_THRESHOLD };
