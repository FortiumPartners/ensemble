'use strict';

/**
 * Findings-as-beads for the PR-review cycle: what to record in the repository's tracker for the
 * findings of a review, and how to keep it right across re-reviews
 * (docs/plans/pr-review-speedup-plan.md, section 3H item 1; kata n350).
 *
 * NO side effects, NO shell, NO network, NO file reads, NO clock. Two pure functions over the
 * ledger, the security lane, the vote tally and what the tracker already holds:
 *
 *   beadKeys(input)               the dedupe keys the tracker must be asked about
 *   planBeads(input, lookups)     one action per bead: create | update | close | skip | error
 *
 * The tracker calls, and the one process that makes them, live in `pr-review-beads-cli.js`.
 *
 * THE RULES (the operator and the next reviewer rely on every one of them):
 *
 *   - IDENTITY. A bead's key is the repository, the file and the NORMALIZED claim (the same
 *     normalization the ledger's repeat suppression uses, `normalizeFailureMode`: case, punctuation
 *     and spacing only). The line, the head and the PR number are deliberately NOT in it: the same
 *     defect at a later head, after the file shifted, is the same bead. Two findings in one file
 *     with one claim share a bead. THE LIMITS, stated rather than hidden: a REWORDED claim is a
 *     different key and so a second bead (the planner does not guess that two sentences mean one
 *     defect; a person closes the stale one); a second PR that raises the same claim in the same
 *     file updates the first PR's bead (the description then names the latest PR and the update
 *     note names the record it replaced), and a bead already labelled `follow-on` stays so.
 *   - RE-REVIEW UPDATES. A finding whose bead exists is updated (title, description, priority,
 *     one appended note) when anything about it changed, and left alone when nothing did. It is
 *     never created twice: `br` refuses a second bead with a key, and the lookup is made first. A
 *     later head therefore rewrites the title, description and priority from the review (a manual
 *     re-prioritisation of a recorded bead is overwritten) and appends ONE note per head; the
 *     same head again writes nothing.
 *   - A FIX CLOSES. A finding the ledger marks `cleared` with a `clearedBy` commit the CALLER
 *     verified is on the PR (`input.commitsOnPr`, full commit ids: the executor checks them with
 *     git, this module never trusts the shape of a hex string) closes its open bead with that
 *     commit. A cleared mark with no commit id, with a commit nobody verified, or on a bead that
 *     is already closed, closes nothing. ABSENCE IS NOT A FIX: a finding that simply is not in
 *     this ledger leaves its bead open.
 *   - A CLOSE IS THIS PR'S. A bead is closed only by the PR that last confirmed it: the
 *     `Last confirmed: <repo> PR #<n> at head <sha>` footer this planner writes into every
 *     description must name THIS repository (case-insensitive) and PR (any earlier head). A
 *     footer naming another repository or PR leaves the bead open and is reported as
 *     `skip` / `recorded-by-other-pr` with `recordedBy: {repo, prNumber}`; a footer that is
 *     missing or unreadable is `skip` / `recorded-pr-unknown` (fail closed). This holds for a
 *     finding's own bead and for a collapsed file bead alike.
 *   - REOPEN LIMIT. A bead counts as closed by this recorder when its close reason has the
 *     recorder's own shape, `Fixed: ... changed at <sha> and was not reported again at <sha>
 *     (<repo> PR #<n>).`. A person who pastes a reason of that shape gets the bead reopened on
 *     the next live finding; real br records `done` for a plain person close, which stays closed.
 *   - A CLOSED BEAD ON A LIVE FINDING. If the closed bead is one this recorder closed as a fix
 *     (its reason is the one `fixedReason` writes) the finding is a regression: the bead is
 *     REOPENED, updated and noted. If anyone else closed it, their decision stands and it is NOT
 *     reopened, but it is reported as what it is: `closedBeadId`, never `beadId`, because it is not
 *     an open bead. The operator list then shows a live finding whose bead is closed as its own
 *     state instead of counting it among the open beads.
 *   - FORCE-PUSH. Nothing is keyed to a commit, so a rewritten history orphans no bead: the next
 *     review of the new head finds each by key and rewrites its head and line. A bead whose
 *     finding is gone from the new head's ledger stays open, naming the last head that confirmed
 *     it; a person closes it. The commit a close names is one the executor verified is on the PR;
 *     after a force-push it is no longer there, which is why a rewritten history closes nothing
 *     and the close reason also names the PR.
 *   - COLLAPSE. More than `COLLAPSE_THRESHOLD` (the operator list's own threshold) Nit, or
 *     Pre-existing, findings in one file WITHOUT a bead of their own become ONE bead for that file
 *     and group, per finding group and not per PR. Important findings and security findings are
 *     never collapsed. A finding that already has its own bead keeps it, is never folded into
 *     another bead (only a fix closes a bead) and so does not count toward the threshold: Nits
 *     that arrive a few reviews at a time can leave a file with more beads than the threshold, and
 *     a collapsed bead is never created for the one new finding of a file whose others hold their
 *     own beads. Once a file has a collapsed bead new findings join it even if the count later
 *     drops: the choice is sticky, so a count that moves around the threshold cannot flip a file
 *     between one bead and many. A sticky bucket may therefore hold a single member; its title
 *     is then the singular one without `(collapsed)`.
 *   - WHAT IS RECORDED. Every finding that is presented to the operator: confirmed by the
 *     verifier majority, but also unverified or disputed ones (the list shows them, each with its
 *     bead id, and the description says which). Filtered findings, duplicates and
 *     not-applicable ones are not recorded and their bead, if any, is left as it is.
 *   - LABELS. Every bead carries `pr-review`. `follow-on` is added only when the caller names
 *     the finding in `followOnIds` (the operator's own choice, never an agent's); a label is
 *     only ever added, never removed.
 *   - REDACTION. Every piece of finding text that reaches a bead (title, description, close
 *     reason) is redacted: the file names and the vote outcomes too, and each finished text is
 *     redacted once more as a whole, because the store is tracked by git.
 *   - FAIL CLOSED. Input this module cannot read yields `{ok:false, reason}` and no action. A
 *     finding that cannot be keyed (no claim) is reported as skipped, never dropped silently.
 *   - COVERAGE GAPS (kata k48x). `input.coverage`, the record of `pr-review-coverage.js`, adds one bead per OPEN gap (a slice, the
 *     whole-range read or the paths nobody read), keyed by repository, kind, slice and sorted paths: never by why it was not read
 *     or at which head, so the same gap at a later head is the same bead (updated, one note per head). A gap is Important and
 *     never collapsed; this recorder never closes its bead (absence is not a fix: a person closes it); the operator's decision
 *     about it, when there is one, is written into the text. A `complete` or `unavailable` coverage records nothing; one this
 *     module cannot read is refused (`ok:false`), never a quietly shorter plan.
 */

const crypto = require('crypto');

const { normalizeSeverity, anchorOf, normalizeFailureMode, fingerprintPath } = require('./pr-review-ledger');
const { redact } = require('./pr-review-state');
const { COLLAPSE_THRESHOLD, isSecurity } = require('./pr-review-disposition');

const BEAD_LABEL = 'pr-review';
const FOLLOW_ON_LABEL = 'follow-on';
const KEY_PREFIX = 'pr-review:v1:';
/** A commit id as `closeFinding` accepts one. */
const COMMIT_RE = /^[0-9a-f]{7,40}$/i;
/** A full commit id: the form `commitsOnPr` carries. */
const FULL_COMMIT_RE = /^[0-9a-f]{40}$/i;
/** The dedupe-footer line every bead description ends with (see `footer`). */
const LAST_CONFIRMED_RE = /^Last confirmed: (\S+) PR #(\d+) at head ([0-9a-f]{7,40})$/m;
/** A close reason as `fixedReason` writes it: how a bead this recorder closed is recognised later. */
const FIXED_REASON_RE = /^Fixed: .+ changed at [0-9a-f]{7,40} and was not reported again at [0-9a-f]{7,40} \(.+ PR #\d+\)\.$/;
/** A repository identity with no whitespace, usable inside a bead's external reference. */
const REPO_RE = /^[A-Za-z0-9._~@-]+(?:\/[A-Za-z0-9._~@-]+)*$/;
const TITLE_CLAIM_MAX = 80;
const CLAIM_MAX = 300;
const EVIDENCE_MAX = 400;
const MEMBERS_LISTED_MAX = 50;

const GROUP_RANK = { important: 2, nit: 1, 'pre-existing': 0 };
const PRIORITY = { important: 1, nit: 3, 'pre-existing': 4 };
const ISSUE_TYPE = { important: 'bug', nit: 'chore', 'pre-existing': 'task' };
const GROUP_WORD = { nit: 'Nit', 'pre-existing': 'Pre-existing' };

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isText = (value) => typeof value === 'string' && value.trim() !== '';
const hasId = (finding) => isText(finding.id) || Number.isFinite(finding.id);

/** One line, redacted, at most `max` characters. */
function flat(value, max) {
  const line = redact(String(value === undefined || value === null ? '' : value))
    .replace(/\s+/g, ' ')
    .trim();
  return line.length > max ? `${line.slice(0, max - 1)}\u2026` : line;
}

/** A finished title, description or reason, redacted once more as a whole: the last stop before the git-tracked store. */
const clean = (text) => redact(text);

function normalizeRepo(repo) {
  return isText(repo) && REPO_RE.test(repo.trim()) ? repo.trim().toLowerCase() : null;
}

function normalizeFile(file) {
  if (!isText(file)) return null;
  const slashed = file.trim().replace(/\\/g, '/').replace(/^(?:\.\/)+/, '');
  return slashed === '' ? null : slashed;
}

function digest(...parts) {
  return crypto.createHash('sha256').update(parts.join('\0')).digest('hex').slice(0, 32);
}

/**
 * The dedupe key of one finding: repository, file and normalized claim.
 *
 * @param {{repo: string, file?: string|null, claim: string}} parts  `claim` as `claimOf` makes it
 * @returns {string|null}  `null` when the repository or the claim cannot be read: such a finding
 *   is never keyed, and so never matched against (or written over) someone else's bead.
 */
function reviewFindingKey({ repo, file, claim } = {}) {
  const normalizedRepo = normalizeRepo(repo);
  if (normalizedRepo === null || !isText(claim)) return null;
  const normalizedFile = file === undefined || file === null ? '' : normalizeFile(file);
  if (normalizedFile === null) return null;
  return `${KEY_PREFIX}${normalizedRepo}:${digest(normalizedFile, claim)}`;
}

/** The key of the collapsed bead of one file and group. Cannot equal a finding key (`group:`). */
function reviewGroupKey({ repo, file, group } = {}) {
  const normalizedRepo = normalizeRepo(repo);
  const normalizedFile = normalizeFile(file);
  if (normalizedRepo === null || normalizedFile === null || !GROUP_WORD[group]) return null;
  return `${KEY_PREFIX}${normalizedRepo}:group:${digest(normalizedFile, group)}`;
}

/**
 * The key of the bead of one coverage gap: repository, kind of gap, slice and the sorted paths nobody read. Cannot equal a
 * finding's key or a collapsed bead's (`coverage:`).
 *
 * @returns {string|null}  `null` when the repository, the kind or the paths cannot be read.
 */
function reviewCoverageKey({ repo, gapType, sliceId, paths } = {}) {
  const normalizedRepo = normalizeRepo(repo);
  if (normalizedRepo === null || !isText(gapType) || !Array.isArray(paths) || paths.length === 0) return null;
  const files = paths.map(normalizeFile);
  if (files.some((file) => file === null)) return null;
  return `${KEY_PREFIX}${normalizedRepo}:coverage:${digest(gapType.trim(), isText(sliceId) ? sliceId.trim() : '', [...new Set(files)].sort().join('\n'))}`;
}

/**
 * The claim of a finding as the ledger's repeat suppression reads it: its failure mode,
 * lower-cased with punctuation and whitespace flattened, and its class. A class finding's
 * failure mode carries its instance count, which moves, so it is identified by its class alone.
 *
 * @returns {string|null}
 */
function claimOf(finding) {
  if (!isObject(finding)) return null;
  const className = isText(finding.class) ? finding.class.trim().toLowerCase() : '';
  if (finding.kind === 'class' && className !== '') return `class-finding::${className}`;
  const mode = normalizeFailureMode(finding.failureMode);
  return mode === null ? null : `${mode}::${className}`;
}

function votesLine(vote) {
  if (!isObject(vote)) return 'not recorded';
  const outcome = isText(vote.outcome) ? flat(vote.outcome, 40) : 'unknown';
  const tally = vote.tally;
  if (!isObject(tally)) return `no tally (${outcome})`;
  const n = (value) => flat(value, 12);
  const abstain = Number(tally.abstain) > 0 ? ` / ${n(tally.abstain)} abstain` : '';
  return `${n(tally.real)} real / ${n(tally.notReal)} not-real${abstain} of ${n(tally.expected)} expected (${outcome})`;
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

function fail(reason) {
  return { ok: false, reason, keys: [], actions: [], byFinding: {}, counts: emptyCounts() };
}

function emptyCounts() {
  return { create: 0, update: 0, close: 0, skip: 0, error: 0 };
}

/** Validate the request and read it into one entry per finding id, in the order given. */
function readInput(input) {
  if (!isObject(input)) return { reason: 'input must be an object' };
  const repo = normalizeRepo(input.repo);
  if (repo === null) return { reason: "input 'repo' must be a repository identity without whitespace (owner/name)" };
  if (!Number.isInteger(input.prNumber) || input.prNumber < 1) return { reason: "input 'prNumber' must be a positive integer" };
  if (!isText(input.headSha) || !COMMIT_RE.test(input.headSha.trim())) {
    return { reason: "input 'headSha' must be a 7-40 character hex commit id" };
  }
  if (!Array.isArray(input.ledger)) return { reason: "input 'ledger' must be an array" };

  let laneFindings = [];
  if (input.security !== undefined && input.security !== null) {
    if (!isObject(input.security)) return { reason: "input 'security' must be an object" };
    if (input.security.findings !== undefined) {
      if (!Array.isArray(input.security.findings)) return { reason: "input 'security.findings' must be an array" };
      laneFindings = input.security.findings;
    }
  }

  let coverageGaps = [];
  if (input.coverage !== undefined && input.coverage !== null) {
    const { coverage } = input;
    if (!isObject(coverage) || !Array.isArray(coverage.gaps)) return { reason: "input 'coverage' must be a coverage record with a gaps array" };
    if (coverage.status === 'incomplete') {
      if (coverage.gaps.length === 0) return { reason: "input 'coverage' says incomplete and lists no gap" };
      coverageGaps = coverage.gaps;
    } else if (coverage.status !== 'complete' && coverage.status !== 'unavailable') {
      return { reason: "input 'coverage.status' must be complete, incomplete or unavailable" };
    }
  }

  const votesById = new Map();
  if (input.votes !== undefined && input.votes !== null) {
    if (!isObject(input.votes) || !Array.isArray(input.votes.findings)) {
      return { reason: "input 'votes' must be a `votes` result with a findings array" };
    }
    for (const entry of input.votes.findings) {
      if (isObject(entry) && hasId(entry)) votesById.set(String(entry.id).trim(), entry);
    }
  }

  let followOn = new Set();
  if (input.followOnIds !== undefined && input.followOnIds !== null) {
    if (!Array.isArray(input.followOnIds)) return { reason: "input 'followOnIds' must be an array of finding ids" };
    followOn = new Set(input.followOnIds.map((id) => String(id).trim()));
  }
  if (input.reportLink !== undefined && input.reportLink !== null && !isText(input.reportLink)) {
    return { reason: "input 'reportLink' must be a non-empty string when given" };
  }
  let commitsOnPr = [];
  if (input.commitsOnPr !== undefined && input.commitsOnPr !== null) {
    if (!Array.isArray(input.commitsOnPr) || !input.commitsOnPr.every((commit) => isText(commit) && FULL_COMMIT_RE.test(commit.trim()))) {
      return { reason: "input 'commitsOnPr' must be an array of full 40-character commit ids" };
    }
    commitsOnPr = input.commitsOnPr.map((commit) => commit.trim().toLowerCase());
  }

  const byId = new Map();
  for (const [list, fromLane] of [
    [input.ledger, false],
    [laneFindings, true],
  ]) {
    for (const finding of list) {
      if (!isObject(finding) || !hasId(finding)) return { reason: 'every finding must be an object with an id' };
      const id = String(finding.id).trim();
      if (byId.has(id)) {
        if (fromLane) byId.get(id).fromLane = true;
        continue;
      }
      byId.set(id, { id, finding, fromLane });
    }
  }
  for (const gap of coverageGaps) {
    if (!isObject(gap) || !isText(gap.id)) return { reason: 'every coverage gap must be an object with an id' };
    const id = gap.id.trim();
    if (!byId.has(id)) byId.set(id, { id, finding: gap, fromLane: false, coverage: true });
  }

  const entries = [...byId.values()].map(({ id, finding, fromLane, coverage }) => {
    if (coverage === true) {
      return {
        id,
        finding,
        group: 'important',
        security: false,
        coverage: true,
        severityWord: 'not reviewed',
        file: null,
        line: null,
        location: isText(finding.locationOrLink) ? finding.locationOrLink.trim() : id,
        claim: isText(finding.failureMode) ? finding.failureMode : null,
        key: reviewCoverageKey({ repo, gapType: finding.gapType, sliceId: finding.sliceId, paths: finding.paths }),
        vote: undefined,
        followOn: followOn.has(id),
      };
    }
    const canonical = normalizeSeverity(finding.severity);
    // An unreadable severity is treated as Important: the ledger never ranks it below a Nit.
    const group = canonical === 'nit' || canonical === 'pre-existing' ? canonical : 'important';
    const rawFile = fingerprintPath(finding);
    const anchor = anchorOf(finding);
    const claim = claimOf(finding);
    const file = rawFile === null ? null : normalizeFile(rawFile);
    return {
      id,
      finding,
      group,
      security: isSecurity(finding, fromLane),
      severityWord: canonical !== null ? canonical : isText(finding.severity) ? finding.severity.trim() : 'unrecognised',
      file,
      line: anchor === null ? null : anchor.line,
      location: isText(finding.locationOrLink) ? finding.locationOrLink.trim() : file,
      claim,
      key: claim === null ? null : reviewFindingKey({ repo, file, claim }),
      vote: votesById.get(id),
      followOn: followOn.has(id),
    };
  });

  return {
    context: {
      repo,
      prNumber: input.prNumber,
      headSha: input.headSha.trim().toLowerCase(),
      reportLink: isText(input.reportLink) ? input.reportLink.trim() : null,
      commitsOnPr,
    },
    entries,
  };
}

/** What a finding is to the planner: skip (with why), fixed (with the verified commit) or live. */
function stateOf(entry, commitsOnPr) {
  const { finding } = entry;
  if (entry.key === null) return { kind: 'skip', reason: 'unkeyable' };
  // A coverage gap is live for as long as the review lists it: no mark closes its bead, only a person does.
  if (entry.coverage === true) return { kind: 'live' };
  if (finding.cleared === true) {
    const written = isText(finding.clearedBy) ? finding.clearedBy.trim().toLowerCase() : '';
    if (!COMMIT_RE.test(written)) return { kind: 'skip', reason: 'cleared-without-commit' };
    // The shape proves nothing: only a commit the caller verified is on the PR closes a bead.
    const verified = commitsOnPr.filter((commit) => commit.startsWith(written));
    if (verified.length !== 1) return { kind: 'skip', reason: 'cleared-unverified' };
    return { kind: 'fixed', commit: verified[0] };
  }
  if (finding.disposition === 'duplicate' || finding.disposition === 'not-applicable') {
    return { kind: 'skip', reason: `not-recorded:${finding.disposition}` };
  }
  if (isObject(entry.vote) && entry.vote.presented === false) return { kind: 'skip', reason: 'filtered' };
  return { kind: 'live' };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function worstGroup(entries) {
  return entries.reduce((worst, e) => (GROUP_RANK[e.group] > GROUP_RANK[worst] ? e.group : worst), entries[0].group);
}

function locationOf(entry) {
  return entry.location === null ? '(no location)' : entry.location;
}

function memberLine(entry) {
  const resolved = isObject(entry.finding.resolution) && isText(entry.finding.resolution.reason);
  const decision = resolved ? ` -- operator: ${flat(entry.finding.resolution.reason, 160)}` : '';
  return `- ${flat(locationOf(entry), 200)}: ${flat(entry.finding.failureMode, CLAIM_MAX)} [${votesLine(entry.vote)}]${decision}`;
}

function footer(context) {
  return [
    `State report: ${context.reportLink === null ? 'not recorded' : flat(context.reportLink, 400)}`,
    `Last confirmed: ${context.repo} PR #${context.prNumber} at head ${context.headSha}`,
  ];
}

/** What each kind of gap says about itself in its bead: the title's prefix and the heading over its paths (a gap is not always unread). */
const GAP_BEAD_WORDS = {
  slice: { prefix: 'Not reviewed', heading: 'Paths of a slice that was not fully reviewed (a slice counts as reviewed only when every reviewer of it arrived and listed every path):' },
  'whole-range': { prefix: 'Whole-range read missing', heading: 'Paths the whole-range read did not cover (the slice reviewers read each slice on its own):' },
  uncovered: { prefix: 'Not reviewed', heading: 'Paths no slice held and no reviewer read:' },
  'under-reviewed': { prefix: 'Under-reviewed', heading: 'Paths read under fewer distinct lenses than the mode requires:' },
  unnamed: { prefix: 'Not reviewed', heading: 'Paths treated as not reviewed (the review named none):' },
};

/** The bead of one coverage gap: what was not read, why, and what the operator decided about it. */
function renderGap(entry, context) {
  const gap = entry.finding;
  const words = GAP_BEAD_WORDS[gap.gapType] || GAP_BEAD_WORDS.unnamed;
  const paths = Array.isArray(gap.paths) ? gap.paths : [];
  const lines = [`PR review coverage gap in ${context.repo}, PR #${context.prNumber}`, '', 'Claim: ' + flat(gap.failureMode, CLAIM_MAX), '', words.heading];
  paths.slice(0, MEMBERS_LISTED_MAX).forEach((file) => lines.push(`- ${flat(file, 200)}`));
  if (paths.length > MEMBERS_LISTED_MAX) lines.push(`- ... and ${paths.length - MEMBERS_LISTED_MAX} more`);
  if (isText(gap.evidence)) lines.push('', 'Evidence: ' + flat(gap.evidence, EVIDENCE_MAX));
  const resolution = isObject(gap.resolution) ? gap.resolution : null;
  if (resolution !== null && isText(resolution.reason)) {
    lines.push('', `Operator decision: accepted by ${flat(resolution.by, 80)}${isText(resolution.at) ? ` at ${flat(resolution.at, 40)}` : ''}: ${flat(resolution.reason, 300)}`);
  }
  lines.push('', ...footer(context));
  return {
    title: clean(`[${words.prefix}] ${flat(entry.location, 200)}`),
    description: clean(lines.join('\n')),
    priority: PRIORITY.important,
    type: 'task',
  };
}

/** The bead of one claim: one or more locations of one defect. */
function renderUnit(unit, context) {
  const { entries } = unit;
  const first = entries[0];
  if (first.coverage === true) return renderGap(first, context);
  const security = unit.security ? ', security' : '';
  const word = flat(unit.severityWord, 40);
  const head = `PR review finding (${word}${security}) in ${context.repo}, PR #${context.prNumber}`;
  const lines = [head, '', 'Claim: ' + flat(first.finding.failureMode, CLAIM_MAX), '', 'Locations and verifier votes:'];
  entries.slice(0, MEMBERS_LISTED_MAX).forEach((entry) => lines.push(memberLine(entry)));
  if (entries.length > MEMBERS_LISTED_MAX) lines.push(`- ... and ${entries.length - MEMBERS_LISTED_MAX} more`);
  if (isText(first.finding.evidence)) lines.push('', 'Evidence: ' + flat(first.finding.evidence, EVIDENCE_MAX));
  lines.push('', ...footer(context));
  return {
    title: clean(`[${word}${security}] ${first.file === null ? '(no file)' : flat(first.file, 200)}: ${flat(first.finding.failureMode, TITLE_CLAIM_MAX)}`),
    description: clean(lines.join('\n')),
    priority: unit.security ? PRIORITY.important : PRIORITY[unit.group],
    type: unit.security ? ISSUE_TYPE.important : ISSUE_TYPE[unit.group],
  };
}

/** The collapsed bead of one file and group. */
function renderBucket(bucket, entries, context) {
  const word = GROUP_WORD[bucket.group];
  const count = entries.length;
  const lines = [
    `PR review findings (${word}, collapsed: ${count} in one file) in ${context.repo}, PR #${context.prNumber}`,
    '',
    `File: ${flat(bucket.file, 300)}`,
    '',
    'Findings and verifier votes:',
  ];
  entries.slice(0, MEMBERS_LISTED_MAX).forEach((entry) => lines.push(memberLine(entry)));
  if (entries.length > MEMBERS_LISTED_MAX) lines.push(`- ... and ${entries.length - MEMBERS_LISTED_MAX} more`);
  lines.push('', ...footer(context));
  return {
    title: clean(`[${bucket.group}] ${flat(bucket.file, 200)}: ${count} ${word} finding${count === 1 ? '' : 's (collapsed)'}`),
    description: clean(lines.join('\n')),
    priority: PRIORITY[bucket.group],
    type: ISSUE_TYPE[bucket.group],
  };
}

// ---------------------------------------------------------------------------
// Units and buckets
// ---------------------------------------------------------------------------

/** Entries sharing a key, split into the live and the fixed. */
function buildUnits(entries, states) {
  const units = new Map();
  for (const entry of entries) {
    const state = states.get(entry.id);
    if (state.kind === 'skip') continue;
    if (!units.has(entry.key)) units.set(entry.key, { key: entry.key, live: [], fixed: [], commits: [] });
    const unit = units.get(entry.key);
    if (state.kind === 'live') unit.live.push(entry);
    else {
      unit.fixed.push(entry);
      unit.commits.push(state.commit);
    }
  }
  for (const unit of units.values()) {
    const shown = unit.live.length > 0 ? unit.live : unit.fixed;
    unit.entries = shown;
    unit.isLive = unit.live.length > 0;
    unit.group = worstGroup(shown);
    unit.security = shown.some((e) => e.security);
    unit.severityWord = shown.find((e) => e.group === unit.group).severityWord;
    unit.file = shown[0].file;
    unit.followOn = shown.every((e) => e.followOn);
    unit.collapsible = !unit.security && unit.group !== 'important' && unit.file !== null;
  }
  return units;
}

function labelsFor(followOn) {
  return followOn ? [BEAD_LABEL, FOLLOW_ON_LABEL] : [BEAD_LABEL];
}

/** The same bead as the tracker holds it? Text is compared as the tracker returns it (trimmed). */
function sameFields(item, desired) {
  const text = (value) => (typeof value === 'string' ? value.trim() : value);
  return (
    text(item.title) === text(desired.title) &&
    text(item.description) === text(desired.description) &&
    Number(item.priority) === desired.priority
  );
}

function missingLabels(item, wanted) {
  const have = new Set(Array.isArray(item.labels) ? item.labels : []);
  return wanted.filter((label) => !have.has(label));
}

/**
 * The note a re-confirmation appends. When the description it replaces was last confirmed by
 * ANOTHER PR (the key carries no PR: a second PR raising the same claim in the same file updates
 * the first one's bead) the note names that earlier record, so rewriting the description loses
 * nothing.
 */
function reconfirmNote(item, context, count) {
  const note = `Re-confirmed at head ${context.headSha} (PR #${context.prNumber}): ${count} location${count === 1 ? '' : 's'}.`;
  const earlier = typeof item.description === 'string' ? LAST_CONFIRMED_RE.exec(item.description) : null;
  if (earlier === null) return note;
  const [, repo, pr, head] = earlier;
  if (repo.toLowerCase() === context.repo && Number(pr) === context.prNumber) return note;
  return `${note} Replaces the description's earlier record: ${repo} PR #${pr} at head ${head}.`;
}

/** The reason of a fix close. `closedByRecorder` recognises exactly this shape later. */
function fixedReason({ what, commit, context }) {
  return clean(`Fixed: ${what} changed at ${commit} and was not reported again at ${context.headSha} (${context.repo} PR #${context.prNumber}).`);
}

/** True when the closed bead was closed by this recorder as a fix (a person's close never reads like one). */
const closedByRecorder = (item) => typeof item.close_reason === 'string' && FIXED_REASON_RE.test(item.close_reason.trim());

/**
 * The action for one bead the findings map onto, given what the tracker holds for its key.
 * `lookup` is a `findByKey` result. A skip carries `beadId` only for an OPEN bead and
 * `closedBeadId` for a closed one, so no caller can read a closed bead as an open one.
 */
function actionFor({ key, findingIds, desired, followOn, lookup, context, count }) {
  const base = { key, findingIds };
  if (!isObject(lookup) || lookup.ok !== true) {
    const error = isObject(lookup) && isObject(lookup.error) ? lookup.error : {};
    return { ...base, action: 'error', reason: error.code === 'AMBIGUOUS_KEY' ? 'ambiguous-key' : 'lookup-failed', error };
  }
  if (!lookup.found) {
    return {
      ...base,
      action: 'create',
      reason: 'new',
      create: { ...desired, labels: labelsFor(followOn), key },
    };
  }
  const item = lookup.item;
  const beadId = item.id;
  const addLabels = missingLabels(item, labelsFor(followOn));
  if (item.status === 'closed') {
    // The finding is live. A bead this recorder closed as a fix means the defect is back: reopen it.
    // Anyone else's close stands, and is reported as closed.
    if (!closedByRecorder(item)) return { ...base, action: 'skip', reason: 'bead-closed', closedBeadId: beadId, status: 'closed' };
    const reopened = {
      ...base,
      action: 'update',
      reason: 'reopened',
      beadId,
      reopen: true,
      update: {
        id: beadId,
        title: desired.title,
        description: desired.description,
        priority: desired.priority,
        note: `Reopened at head ${context.headSha} (PR #${context.prNumber}): the finding this bead was closed as fixed for is back, ${count} location${count === 1 ? '' : 's'}.`,
      },
    };
    if (addLabels.length > 0) reopened.addLabels = addLabels;
    return reopened;
  }
  const fields = !sameFields(item, desired);
  if (!fields && addLabels.length === 0) return { ...base, action: 'skip', reason: 'unchanged', beadId };
  const action = { ...base, action: 'update', reason: fields ? 'changed' : 'labels', beadId };
  if (fields) {
    action.update = {
      id: beadId,
      title: desired.title,
      description: desired.description,
      priority: desired.priority,
      note: reconfirmNote(item, context, count),
    };
  }
  if (addLabels.length > 0) action.addLabels = addLabels;
  return action;
}

function closeActionFor({ key, findingIds, lookup, commits, context, what }) {
  const base = { key, findingIds };
  if (!isObject(lookup) || lookup.ok !== true) {
    const error = isObject(lookup) && isObject(lookup.error) ? lookup.error : {};
    return { ...base, action: 'error', reason: error.code === 'AMBIGUOUS_KEY' ? 'ambiguous-key' : 'lookup-failed', error };
  }
  if (!lookup.found) return { ...base, action: 'skip', reason: 'fixed-without-bead' };
  const beadId = lookup.item.id;
  if (lookup.item.status === 'closed') return { ...base, action: 'skip', reason: 'already-closed', closedBeadId: beadId, status: 'closed' };
  // A bead is closed only by the PR that last confirmed it (the footer this planner wrote).
  // Another PR's fix of the same claim leaves it open: that PR still raises the claim.
  const recorded = typeof lookup.item.description === 'string' ? LAST_CONFIRMED_RE.exec(lookup.item.description) : null;
  if (recorded === null) return { ...base, action: 'skip', reason: 'recorded-pr-unknown', beadId };
  if (recorded[1].toLowerCase() !== context.repo || Number(recorded[2]) !== context.prNumber) {
    return {
      ...base,
      action: 'skip',
      reason: 'recorded-by-other-pr',
      beadId,
      recordedBy: { repo: recorded[1], prNumber: Number(recorded[2]) },
    };
  }
  const commit = commits[commits.length - 1];
  return {
    ...base,
    action: 'close',
    reason: 'fixed',
    beadId,
    close: { id: beadId, commit, reason: fixedReason({ what, commit, context }) },
  };
}

// ---------------------------------------------------------------------------
// Public
// ---------------------------------------------------------------------------

/** Group the collapsible units by (group, file). Needs the repo for the group key. */
function groupBuckets(units, repo) {
  const buckets = new Map();
  for (const unit of units.values()) {
    if (!unit.collapsible) continue;
    const id = `${unit.group}\0${unit.file}`;
    if (!buckets.has(id)) {
      buckets.set(id, { id, group: unit.group, file: unit.file, key: reviewGroupKey({ repo, file: unit.file, group: unit.group }), units: [] });
    }
    buckets.get(id).units.push(unit);
  }
  return buckets;
}

/**
 * Every dedupe key the tracker must be asked about for this input, in a stable order. Ask all of
 * them in one lookup, then hand the answers to `planBeads`.
 *
 * @returns {{ok:true, keys:string[]} | {ok:false, reason:string, keys:[]}}
 */
function beadKeys(input) {
  const read = readInput(input);
  if (read.reason !== undefined) return { ok: false, reason: read.reason, keys: [] };
  const states = new Map(read.entries.map((entry) => [entry.id, stateOf(entry, read.context.commitsOnPr)]));
  const units = buildUnits(read.entries, states);
  const keys = [...units.keys()];
  for (const bucket of groupBuckets(units, read.context.repo).values()) keys.push(bucket.key);
  return { ok: true, keys };
}

/**
 * Plan what to do in the tracker.
 *
 * @param {{repo: string, prNumber: number, headSha: string, ledger: object[], security?: {findings?: object[]},
 *   votes?: object, followOnIds?: Array<string|number>, reportLink?: string, commitsOnPr?: string[]}} input
 *   `ledger` entries are the ledger's findings; `cleared`/`clearedBy` (from `pr-review-clear-cli.js`) mark a fix,
 *   and close a bead only when `clearedBy` is a commit named in `commitsOnPr` (full ids the caller verified are on the PR).
 *   `votes` is the `votes` subcommand's result; `followOnIds` the findings the operator chose to defer.
 * @param {Object<string, object>} lookups  `findByKey`'s result for every key `beadKeys` named
 * @returns {{ok:true, actions:object[], byFinding:Object<string, object>, counts:object}|{ok:false, reason:string}}
 *   `byFinding[id]` is `{action, reason, key?, beadId?}`: what happens to that finding, and the bead
 *   it lives in when that is already known (a `create`'s id is only known once it has run).
 */
function planBeads(input, lookups) {
  const read = readInput(input);
  if (read.reason !== undefined) return fail(read.reason);
  if (!isObject(lookups)) return fail("'lookups' must be an object keyed by dedupe key");
  const { context, entries } = read;

  const states = new Map(entries.map((entry) => [entry.id, stateOf(entry, context.commitsOnPr)]));
  const units = buildUnits(entries, states);
  const buckets = groupBuckets(units, context.repo);
  for (const key of [...units.keys(), ...[...buckets.values()].map((b) => b.key)]) {
    if (!Object.prototype.hasOwnProperty.call(lookups, key)) return fail(`no lookup result for key ${key}`);
  }

  // Which live units join their file's collapsed bead: the ones with no bead of their own, once the
  // file has a collapsed bead or more than the threshold of such findings. A finding that has its
  // own bead is never folded in (only a fix closes a bead), so it does not count toward the
  // threshold either: a collapsed bead is never made for the one new finding of a file whose
  // others hold their own beads.
  const hasOwnBead = (unit) => isObject(lookups[unit.key]) && lookups[unit.key].ok === true && lookups[unit.key].found === true;
  const collapsedOf = new Map(); // unit key -> bucket
  const bucketInfo = new Map();
  for (const bucket of buckets.values()) {
    const joinable = bucket.units.filter((u) => u.isLive && !hasOwnBead(u));
    const joinableCount = joinable.reduce((n, u) => n + u.live.length, 0);
    const lookup = lookups[bucket.key];
    const exists = isObject(lookup) && lookup.ok === true && lookup.found === true;
    const collapse = exists || joinableCount > COLLAPSE_THRESHOLD;
    const joiners = collapse ? joinable : [];
    const fixedWithoutBead = collapse ? bucket.units.filter((u) => !u.isLive && !hasOwnBead(u)) : [];
    joiners.forEach((u) => collapsedOf.set(u.key, bucket));
    fixedWithoutBead.forEach((u) => collapsedOf.set(u.key, bucket));
    bucketInfo.set(bucket.id, { collapse, joiners, fixedWithoutBead, lookup });
  }

  const actions = [];
  const byFinding = {};
  const record = (action) => {
    actions.push(action);
    for (const id of action.findingIds) {
      byFinding[id] = { action: action.action, reason: action.reason, key: action.key };
      // `beadId` only ever names an OPEN bead. A close leaves a closed one.
      if (action.closedBeadId !== undefined) byFinding[id].closedBeadId = action.closedBeadId;
      else if (action.beadId !== undefined) byFinding[id][action.action === 'close' ? 'closedBeadId' : 'beadId'] = action.beadId;
      if (action.recordedBy !== undefined) byFinding[id].recordedBy = action.recordedBy;
    }
  };
  const emitted = new Set();

  for (const entry of entries) {
    const state = states.get(entry.id);
    if (state.kind === 'skip') {
      record({ key: entry.key, findingIds: [entry.id], action: 'skip', reason: state.reason });
      continue;
    }
    const unit = units.get(entry.key);
    const bucket = collapsedOf.get(unit.key);

    if (bucket !== undefined) {
      const info = bucketInfo.get(bucket.id);
      if (!unit.isLive && info.joiners.length > 0) {
        // Fixed, but the file's collapsed bead still holds live findings: nothing to close yet.
        if (!emitted.has(unit.key)) {
          emitted.add(unit.key);
          const lookup = info.lookup;
          const action = { key: unit.key, findingIds: unit.fixed.map((e) => e.id), action: 'skip', reason: 'collapsed-member-fixed' };
          if (isObject(lookup) && lookup.ok === true && lookup.found === true) {
            action[lookup.item.status === 'closed' ? 'closedBeadId' : 'beadId'] = lookup.item.id;
          }
          record(action);
        }
        continue;
      }
      if (emitted.has(bucket.id)) continue;
      emitted.add(bucket.id);
      const memberEntries = info.joiners.flatMap((u) => u.live);
      if (info.joiners.length > 0) {
        const desired = renderBucket(bucket, memberEntries, context);
        record(
          actionFor({
            key: bucket.key,
            findingIds: memberEntries.map((e) => e.id),
            desired,
            followOn: memberEntries.every((e) => e.followOn),
            lookup: info.lookup,
            context,
            count: memberEntries.length,
          })
        );
      } else {
        // Every finding that joined this file's bead is fixed: close it.
        const fixedEntries = info.fixedWithoutBead.flatMap((u) => u.fixed);
        const commits = info.fixedWithoutBead.flatMap((u) => u.commits);
        record(
          closeActionFor({
            key: bucket.key,
            findingIds: fixedEntries.map((e) => e.id),
            lookup: info.lookup,
            commits,
            context,
            what: `the cited locations in ${bucket.file}`,
          })
        );
      }
      continue;
    }

    if (emitted.has(unit.key)) continue;
    emitted.add(unit.key);
    if (unit.isLive) {
      record(
        actionFor({
          key: unit.key,
          findingIds: unit.live.map((e) => e.id),
          desired: renderUnit(unit, context),
          followOn: unit.followOn,
          lookup: lookups[unit.key],
          context,
          count: unit.live.length,
        })
      );
    } else {
      record(
        closeActionFor({
          key: unit.key,
          findingIds: unit.fixed.map((e) => e.id),
          lookup: lookups[unit.key],
          commits: unit.commits,
          context,
          what: 'the cited location',
        })
      );
    }
  }

  const counts = emptyCounts();
  actions.forEach((action) => {
    counts[action.action] += 1;
  });
  return { ok: true, actions, byFinding, counts };
}

module.exports = {
  BEAD_LABEL,
  FOLLOW_ON_LABEL,
  KEY_PREFIX,
  reviewFindingKey,
  reviewGroupKey,
  reviewCoverageKey,
  claimOf,
  beadKeys,
  planBeads,
};
