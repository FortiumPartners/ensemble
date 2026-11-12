'use strict';

/**
 * A legacy Critical stays Critical when the ledger reads it into the current taxonomy (kata 1jp6).
 *
 * REVIEW.md: "Older ledgers written as Critical, Major, Minor or Nitpick are read as Important (Critical, Major) and Nit
 * (Minor, Nitpick); nothing is lost and no blocking outcome changes." `normalizeFinding` rewrites `severity` to the canonical
 * word (`important`) and keeps the word as written in `originalSeverity`. Every rule the word Critical carries read `severity`
 * ALONE, so each lost the Critical the moment a ledger went through `partitionFindings`, `ledger recordRound`, `ledger resolve`,
 * `clear` or `carry reconcile`:
 *
 *   - the stopping rule never defers a Critical (`isActionable`);
 *   - a verifier vote never closes a Critical (`tallyVotes`: it is `disputed`, a person decides it);
 *   - the operator's list offers a Critical's Accept as a security finding's: its own reason, never batched
 *     (`buildDispositionChoices`), and the bead the recorder files says `security` (`planBeads`);
 *   - a Critical re-report outranks a recorded Major (`recordRound`, `dedupeFindings`);
 *   - the merge gate's blocker names a Critical as one (it said "Important");
 *   - and a re-report that outranks a recorded finding clears the decision taken before it (`recordRound`): the operator's
 *     acceptance of a Major is not a decision on the Critical it became.
 *
 * THE MERGE GATE. Before #253 the repro (a Critical, `blocking: false`, `deferred`, with a reason) was `mergeable: true`:
 * `partitionFindings` normalized it before the gate asked `isActionable`. Since #253 the gate takes no deferral of an
 * Important finding as an answer (`applyProvenance` strips `blocking`), which refuses the repro for that reason and masks the
 * hole: on origin/dev the repro's verdict is already `mergeable: false`, so the cases that pin the verdict pass there. They are
 * here so that relaxing the strip can never again let a Critical through (one compiles the real gate without it). The one
 * verdict this change does alter is the stricter one: an escalated finding whose earlier decision was cleared (see above).
 *
 * WHAT "FAILING FIRST" MEANS. The baseline is the library on origin/dev (84c6739; 04c15ec after it holds the same lib), the
 * code this change fixes. A case marked FAILING FIRST fails on that library with an assertion about behaviour. A case without
 * the mark either passes there (it pins behaviour that already held, such as the gate's verdict) or calls `isCritical`, which
 * origin/dev does not export, and fails there with a TypeError because the function is new: that says nothing about
 * behaviour, so it is not marked. The marks are checked by running this file against an export of origin/dev's lib and
 * reading each case's first failure, not by hand.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createRequire } = require('module');
const { spawnSync } = require('child_process');

const cli = require('../lib/pr-review-cli');
const { evaluateGate, BLOCKER_CODES } = require('../lib/pr-review-gate');
const { tallyVotes } = require('../lib/pr-review-votes');
const { buildDispositionChoices } = require('../lib/pr-review-disposition');
const { planBeads, beadKeys } = require('../lib/pr-review-beads');
const {
  isActionable,
  isCritical,
  normalizeFinding,
  partitionFindings,
  dedupeFindings,
  mergeFindings,
  classFindings,
} = require('../lib/pr-review-ledger');

const CLI_PATH = path.join(__dirname, '..', 'lib', 'pr-review-cli.js');
const HEAD = 'a'.repeat(40);
const OLD_HEAD = 'b'.repeat(40);
const DECISION = { decision: 'accept', by: 'ldangelo', at: '2026-11-10T10:00:00Z', headSha: HEAD };

function finding(overrides = {}) {
  return {
    id: 'F',
    source: 'code-reviewer',
    locationOrLink: 'a.js:1',
    severity: 'critical',
    failureMode: 'unchecked input reaches the widget',
    disposition: 'fix',
    evidence: 'line 1 reads the payload without validating it',
    originalTextOrLink: 'https://example.invalid/pr/1#discussion_r1',
    ...overrides,
  };
}

/** A finding the triager deferred as non-blocking with a reason: the stopping rule's deferral, whatever the severity. */
const deferred = (severity, overrides = {}) => finding({ severity, blocking: false, disposition: 'deferred', reason: 'x', ...overrides });

/** What the repro in kata 1jp6 hands the gate: a Critical the triager deferred as non-blocking, with a reason. */
const deferredCritical = (overrides = {}) => deferred('critical', overrides);

const inProcess = (subcommand, payload) => JSON.parse(JSON.stringify(cli.HANDLERS[subcommand](JSON.parse(JSON.stringify(payload)))));

const viaProcess = (subcommand, payload) => {
  const run = spawnSync(process.execPath, [CLI_PATH, subcommand], { input: JSON.stringify(payload), encoding: 'utf8' });
  if (run.status !== 0) throw new Error(`pr-review-cli ${subcommand} exited ${run.status}: ${run.stdout}${run.stderr}`);
  return JSON.parse(run.stdout);
};

const RUNNERS = [
  ['the in-process CLI handler', inProcess],
  ['the real `node pr-review-cli.js` process', viaProcess],
];

function gateInput(overrides = {}) {
  return {
    headSha: HEAD,
    ledger: [],
    approvals: { ok: true, satisfied: true, humansRequired: 1, humansCounted: 1, tier: 'medium', headSha: HEAD, approvedBy: ['human-a'] },
    tier: { ok: true, tier: 'medium', effectiveTier: 'medium', humansRequired: 1 },
    description: { ok: true, missing: [], present: ['testing', 'risk', 'rollback'], empty: [], ready: true, warnings: [] },
    security: { status: 'clean', findings: [] },
    coverage: { status: 'complete', gaps: [] },
    ...overrides,
  };
}

/** A ledger entry exactly as `ledger recordRound` writes it down (the form every later step reads). */
const recorded = (run, entry, round = 1, ledger = []) => run('ledger', { action: 'recordRound', ledger, incoming: [entry], round });

const blockersOf = (verdict, code = BLOCKER_CODES.OPEN_IMPORTANT_FINDING) => verdict.blockers.filter((entry) => entry.code === code);

const FAILING_FIRST = ' (FAILING FIRST)';

// ---------------------------------------------------------------------------------------------------------------------
/** The STORED state `ledger resolve` reads a finding from: its id, and the ledger that holds it (kata 0465). */
const stored = (entry) => ({ id: entry.id, ledger: [entry] });

describe('reading a finding into the taxonomy changes no blocking outcome (REVIEW.md: nothing is lost)', () => {
  const WORDS = ['critical', 'Critical', 'CRITICAL', 'major', 'Major', 'minor', 'nitpick', 'important', 'Important', 'nit', 'pre-existing', 'spicy'];
  const SHAPES = [
    ['deferred non-blocking with a reason', { disposition: 'deferred', blocking: false, reason: 'opt-in component' }],
    ['deferred with a reason and no blocking flag', { disposition: 'deferred', reason: 'opt-in component' }],
    ['a bare resolution reason', { disposition: 'resolved', resolution: { reason: 'accepted' } }],
    ['an operator resolution', { disposition: 'resolved', resolution: { reason: 'accepted', ...DECISION } }],
    ['cleared by a later head', { disposition: 'fix', cleared: true }],
    ['an open thread on a deferral', { disposition: 'deferred', blocking: false, reason: 'x', unresolvedThread: true }],
    ['an uncertain flag on a deferral', { disposition: 'deferred', blocking: false, reason: 'x', uncertain: true }],
    ['still open', { disposition: 'fix' }],
    // `originalSeverity` is the word the ledger keeps, and a caller can write one of its own: the claim is part of the shape.
    ['a deferral beside a Critical claim in originalSeverity', { disposition: 'deferred', blocking: false, reason: 'opt-in component', originalSeverity: 'critical' }],
    ['an operator resolution beside a Critical claim in originalSeverity', { disposition: 'resolved', resolution: { reason: 'accepted', ...DECISION }, originalSeverity: 'critical' }],
  ];
  // The rows that fail on origin/dev's library: the WRITTEN word Critical with the stopping rule's deferral (the raw finding was
  // refused, the same finding read into the taxonomy was taken). Every other row agrees there too.
  const failsOnOriginDev = (severity, extra) =>
    /^critical$/i.test(severity) && extra.disposition === 'deferred' && extra.blocking === false && extra.unresolvedThread === undefined && extra.uncertain === undefined;
  const CASES = WORDS.flatMap((severity) => SHAPES.map(([shape, extra]) => [severity, shape, failsOnOriginDev(severity, extra) ? FAILING_FIRST : '', { severity, ...extra }]));

  test.each(CASES)('%s, %s: isActionable answers the same before and after normalizeFinding%s', (_severity, _shape, _mark, extra) => {
    const written = finding(extra);

    expect(isActionable(normalizeFinding(written))).toBe(isActionable(written));
  });

  test.each(CASES.map(([severity, shape, , extra]) => [severity, shape, extra]))('%s, %s: the merge gate answers the same for the finding as written and as normalized', (_severity, _shape, extra) => {
    const written = finding(extra);
    const asked = (entry) => {
      const verdict = evaluateGate(gateInput({ ledger: [entry] }));
      return { mergeable: verdict.mergeable, codes: verdict.blockers.map((blocker) => blocker.code), open: verdict.findings.open };
    };

    expect(asked(normalizeFinding(written))).toEqual(asked(written));
  });

  test.each(['critical', 'Critical', 'CRITICAL'])(`a deferred non-blocking %s is actionable after normalizeFinding: the stopping rule never defers it${FAILING_FIRST}`, (severity) => {
    const normalized = normalizeFinding(deferred(severity));

    expect(normalized.severity).toBe('important');
    expect(normalized.originalSeverity).toBe(severity);
    expect(isActionable(normalized)).toBe(true);
  });

  test('a deferred non-blocking Major still is not actionable, written or normalized: only a Critical is never deferrable', () => {
    const major = finding({ severity: 'major', blocking: false, disposition: 'deferred', reason: 'opt-in component' });

    expect(isActionable(major)).toBe(false);
    expect(isActionable(normalizeFinding(major))).toBe(false);
  });

  test(`partitionFindings keeps a deferred Critical in \`blocking\`, and a deferred Major out of it${FAILING_FIRST}`, () => {
    const parts = partitionFindings([
      deferredCritical({ id: 'C', locationOrLink: 'a.js:1' }),
      deferred('major', { id: 'M', locationOrLink: 'a.js:2', reason: 'opt-in component' }),
    ]);

    expect(parts.ok).toBe(true);
    expect(parts.blocking.map((entry) => entry.id)).toEqual(['C']);
    expect(parts.important.map((entry) => entry.id).sort()).toEqual(['C', 'M']);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('a Critical claim beside a severity word counts while the finding reads Important, never against a Nit (review of #296)', () => {
  // `originalSeverity` is the word `normalizeFinding` keeps of a Critical it read, and a caller can write one of its own.
  // `isActionable` and the gate read a Nit or Pre-existing finding as that, whatever else it carries, so a Critical claim beside
  // such a word is stale: the vote tally, the rank and the operator's list read it as a Critical where `isActionable` and the
  // gate did not. All of them now agree. Beside Important, a word nobody can read or no word at all the claim stands (fail
  // closed), and `normalizeFinding` never trades it for a lesser word. The claim is never erased from a record: it is dormant
  // beside a Nit and counts again if a report raises the finding to Important.
  const rejected = [
    { verifier: 'v1', verdict: 'not-real' },
    { verifier: 'v2', verdict: 'not-real' },
    { verifier: 'v3', verdict: 'abstain' },
  ];
  const voteOutcome = (entry) => tallyVotes({ depth: 'standard', findings: [{ ...entry, kind: 'bug', votes: rejected }] }).findings[0];
  const listed = (entry) => buildDispositionChoices({ ledger: [entry], security: { status: 'clean', findings: [] }, headSha: HEAD }).dispositionChoices;

  test.each([
    // written as Critical: always Critical, whatever originalSeverity says
    ['critical', undefined, true],
    ['Critical', 'nit', true],
    [' CRITICAL ', 'major', true],
    // beside Important, as `normalizeFinding` writes a Critical it read, or as a caller claims it
    ['important', 'critical', true],
    ['Important', 'Critical', true],
    ['major', 'critical', true],
    ['Major', ' critical ', true],
    // beside a word nobody can read, or none: the finding blocks as Important, so the claim stands
    [undefined, 'critical', true],
    [null, 'critical', true],
    [5, 'critical', true],
    ['spicy', 'critical', true],
    [' nit ', 'critical', true],
    // beside Nit or Pre-existing the claim is stale
    ['nit', 'critical', false],
    ['Nit', 'Critical', false],
    ['minor', 'critical', false],
    ['nitpick', 'critical', false],
    ['pre-existing', 'critical', false],
    ['Pre-Existing', 'critical', false],
    ['preexisting', 'critical', false],
    ['pre existing', 'critical', false],
    // and nothing else is a claim
    ['important', 'nit', false],
    ['important', 'major', false],
    ['important', undefined, false],
    ['important', 5, false],
    ['major', 'criticalx', false],
  ])('severity %p beside originalSeverity %p: Critical is %p', (severity, originalSeverity, expected) => {
    expect(isCritical({ severity, originalSeverity })).toBe(expected);
  });

  const RECOGNISED = ['critical', 'Critical', 'major', 'Major', 'important', 'Important', 'minor', 'nitpick', 'nit', 'Nit', 'pre-existing', 'Pre-existing', 'preexisting', 'pre existing'];
  const BESIDE = [undefined, 'critical', 'Critical', 'major', 'nit'];

  test.each(RECOGNISED.flatMap((severity) => BESIDE.map((originalSeverity) => [severity, originalSeverity])))(
    'severity %p beside originalSeverity %p: a deferral closes it if and only if it is not a Critical, written or read into the taxonomy',
    (severity, originalSeverity) => {
      const entry = deferred(severity, originalSeverity === undefined ? {} : { originalSeverity });

      expect(isActionable(entry)).toBe(isCritical(entry));
      expect(isActionable(normalizeFinding(entry))).toBe(isCritical(entry));
      expect(isCritical(normalizeFinding(entry))).toBe(isCritical(entry));
    }
  );

  test.each([
    ['critical', undefined, 'critical', ''],
    ['Critical', 'nit', 'Critical', ''],
    ['major', undefined, 'major', ''],
    ['Major', 'nit', 'Major', ''],
    ['major', 'critical', 'critical', FAILING_FIRST],
    ['Major', 'Critical', 'Critical', FAILING_FIRST],
    ['minor', 'critical', 'minor', ''],
    ['nitpick', 'Critical', 'nitpick', ''],
    ['important', 'critical', 'critical', ''],
    ['nit', 'critical', 'critical', ''],
  ])('normalizeFinding keeps severity %p beside originalSeverity %p as originalSeverity %p%s', (severity, originalSeverity, kept) => {
    const normalized = normalizeFinding(finding({ severity, ...(originalSeverity === undefined ? {} : { originalSeverity }) }));

    expect(normalized.originalSeverity).toBe(kept);
    expect(normalizeFinding(normalized)).toEqual(normalized);
  });

  describe('a Major that claims Critical in originalSeverity, deferred non-blocking (the review\'s probe)', () => {
    const forged = () => deferred('major', { originalSeverity: 'critical' });

    test(`the stopping rule never defers it, as written and as read into the taxonomy${FAILING_FIRST}`, () => {
      expect(isActionable(forged())).toBe(true);
      expect(isActionable(normalizeFinding(forged()))).toBe(true);
      expect(normalizeFinding(forged())).toMatchObject({ severity: 'important', originalSeverity: 'critical' });
      expect(isCritical(normalizeFinding(forged()))).toBe(true);
    });

    test(`a vote cannot close it, as written and as read: it is disputed and a person decides it${FAILING_FIRST}`, () => {
      for (const entry of [forged(), normalizeFinding(forged())]) {
        expect(voteOutcome(entry)).toMatchObject({ outcome: 'disputed', presented: true });
      }
    });

    test(`the operator's list offers it as a security finding, as written and as read${FAILING_FIRST}`, () => {
      for (const entry of [forged(), normalizeFinding(forged())]) {
        expect(listed(entry).map((item) => item.security)).toEqual([true]);
      }
    });
  });

  describe('a Nit or Pre-existing finding that carries a stale Critical claim is that, to every rule', () => {
    test.each(['nit', 'Nit', 'minor', 'nitpick', 'pre-existing'])('%s: the stopping rule, the gate, the vote tally and the list read it as they always did', (severity) => {
      const stale = deferred(severity, { originalSeverity: 'critical' });
      const open = finding({ severity, originalSeverity: 'critical' });

      expect(isActionable(stale)).toBe(false);
      expect(isActionable(normalizeFinding(stale))).toBe(false);
      expect(evaluateGate(gateInput({ ledger: [stale] })).mergeable).toBe(true);
      expect(voteOutcome(open)).toMatchObject({ outcome: 'filtered', presented: false });
      expect(voteOutcome(normalizeFinding(open))).toMatchObject({ outcome: 'filtered', presented: false });
      expect(listed(open).map((item) => item.security)).not.toContain(true);
      expect(listed(normalizeFinding(open)).map((item) => item.security)).not.toContain(true);
      expect(isCritical(stale)).toBe(false);
      expect(isCritical(normalizeFinding(stale))).toBe(false);
    });

    test('and in the rank: it does not outrank an open Important finding of another reviewer, whichever comes first', () => {
      const stale = finding({ id: 'S', source: 'reviewer-b', severity: 'nit', originalSeverity: 'critical' });
      const important = finding({ id: 'M', source: 'reviewer-a', severity: 'major' });

      for (const group of [[important, stale], [stale, important]]) {
        expect(dedupeFindings(group).map((entry) => entry.id)).toEqual(['M']);
      }
    });

    test('normalizeFinding keeps the claim on the record: nothing is erased', () => {
      expect(normalizeFinding(deferred('nit', { originalSeverity: 'critical' }))).toMatchObject({ severity: 'nit', originalSeverity: 'critical' });
    });
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe.each(RUNNERS)('the ledger verbs keep a Critical Critical: %s', (_name, run) => {
  test('`ledger recordRound` writes a deferred Critical down as actionable, and `ledger isActionable` says so (FAILING FIRST)', () => {
    const round = recorded(run, deferredCritical());
    const entry = round.findings[0];

    expect(entry).toMatchObject({ id: 'F', severity: 'important', originalSeverity: 'critical' });
    expect(run('ledger', { action: 'isActionable', finding: entry })).toEqual({ actionable: true });
    expect(run('ledger', { action: 'isActionable', finding: deferredCritical() })).toEqual({ actionable: true });
  });

  test('a Critical re-report of a recorded, deferred Major is an escalation, and the record is no longer deferrable (FAILING FIRST)', () => {
    const major = deferred('major', { id: 'M', reason: 'opt-in component' });
    const first = recorded(run, major);
    expect(run('ledger', { action: 'isActionable', finding: first.findings[0] })).toEqual({ actionable: false });

    const second = recorded(run, finding({ id: 'C', source: 'security-reviewer', severity: 'critical', disposition: 'fix' }), 2, first.findings);

    expect(second.repeats).toEqual([expect.objectContaining({ id: 'C', repeatOf: 'M', reason: 'severity-escalated' })]);
    expect(second.presented.map((entry) => entry.id)).toEqual(['M']);
    const stored = second.findings.find((entry) => entry.id === 'M');
    expect(stored).toMatchObject({ severity: 'important', originalSeverity: 'critical', escalatedInRound: 2, escalatedFrom: 'important' });
    expect(run('ledger', { action: 'isActionable', finding: stored })).toEqual({ actionable: true });
  });

  test('a Critical re-report of a recorded Critical, and a Major re-report of one, stay repeats (nothing is escalated twice) (FAILING FIRST)', () => {
    const first = recorded(run, deferredCritical());

    const critical = recorded(run, finding({ id: 'C2', source: 'security-reviewer' }), 2, first.findings);
    const major = recorded(run, finding({ id: 'M2', source: 'security-reviewer', severity: 'major' }), 2, first.findings);

    expect(critical.repeats.map((repeat) => repeat.reason)).toEqual(['already-recorded']);
    expect(major.repeats.map((repeat) => repeat.reason)).toEqual(['already-recorded']);
    expect(major.findings.find((entry) => entry.id === 'F')).toMatchObject({ originalSeverity: 'critical' });
    expect(run('ledger', { action: 'isActionable', finding: major.findings[0] })).toEqual({ actionable: true });
  });

  test('a lower-severity first record is escalated by a Critical report and keeps what it was first recorded as in `escalatedFrom` (FAILING FIRST)', () => {
    const nit = recorded(run, finding({ id: 'N', severity: 'nit', disposition: 'deferred', reason: 'style' }));
    const second = recorded(run, finding({ id: 'C', source: 'security-reviewer', severity: 'critical' }), 2, nit.findings);

    expect(second.repeats.map((repeat) => repeat.reason)).toEqual(['severity-escalated']);
    expect(second.findings.find((entry) => entry.id === 'N')).toMatchObject({ severity: 'important', originalSeverity: 'critical', escalatedFrom: 'nit' });
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe.each(RUNNERS)('a re-report that outranks a recorded finding clears the decision taken before it: `ledger recordRound` through %s', (_name, run) => {
  const reported = (overrides) => finding({ id: 'M', source: 'reviewer-a', severity: 'major', ...overrides });
  const worse = (overrides) => finding({ id: 'C', source: 'security-reviewer', severity: 'critical', ...overrides });
  /** The operator's decision on a recorded finding, as `ledger resolve` writes it: a reason, their login, a time and this head. */
  const decide = (entry, reason = 'the caller validates it upstream') => run('ledger', { action: 'resolve', ...stored(entry), resolution: { reason, ...DECISION } }).finding;
  const gateOn = (ledger) => run('gate', gateInput({ ledger }));
  const isOpen = (entry) => run('ledger', { action: 'isActionable', finding: entry }).actionable;
  /** Round 1 records the finding and the operator accepts it; round 2 reports it again as `second`. */
  const reportedAgain = (first, second) => {
    const accepted = decide(recorded(run, first).findings[0]);
    return { accepted, round: recorded(run, second, 2, [accepted]) };
  };
  const REPEAT = { id: 'C', repeatOf: 'M', fingerprint: expect.any(String), reason: 'severity-escalated' };

  test('the operator\'s acceptance of a Major closes it and the gate takes it (the baseline)', () => {
    const accepted = decide(recorded(run, reported()).findings[0]);

    expect(accepted).toMatchObject({ disposition: 'resolved', resolution: { reason: 'the caller validates it upstream', ...DECISION } });
    expect(isOpen(accepted)).toBe(false);
    expect(gateOn([accepted]).mergeable).toBe(true);
  });

  test(`a Critical re-report of the accepted Major escalates it and clears the acceptance: the record is open again and says what was cleared${FAILING_FIRST}`, () => {
    const { accepted, round } = reportedAgain(reported(), worse());
    const [stored] = round.findings;

    expect(round.repeats).toEqual([{ ...REPEAT, resolutionCleared: true }]);
    expect(round.presented.map((entry) => entry.id)).toEqual(['M']);
    expect(stored).toMatchObject({ id: 'M', severity: 'important', originalSeverity: 'critical', escalatedInRound: 2, escalatedFrom: 'important', disposition: 'fix' });
    expect(stored.resolution).toBeUndefined();
    expect(stored.supersededResolutions).toEqual([{ severity: 'important', supersededInRound: 2, resolution: accepted.resolution }]);
  });

  test(`the gate does not take the acceptance of a Major as the decision on the Critical it became (origin/dev: mergeable true)${FAILING_FIRST}`, () => {
    const { round } = reportedAgain(reported(), worse());
    const verdict = gateOn(round.findings);

    expect(isOpen(round.findings[0])).toBe(true);
    expect(verdict.mergeable).toBe(false);
    expect(blockersOf(verdict)).toEqual([expect.objectContaining({ findingId: 'M', severity: 'critical' })]);
    expect(blockersOf(verdict)[0].message).toMatch(/^Critical finding M \(a\.js:1\) is still open/);
    // the old decision was cleared, not refused: the blocker does not claim a resolution was rejected
    expect(blockersOf(verdict)[0].resolutionRejected).toBeUndefined();
  });

  test('a new decision with its own reason closes the Critical, and replaying the same round does not clear it again', () => {
    const { round } = reportedAgain(reported(), worse());
    const again = decide(round.findings[0], 'accepted as a Critical: the caller validates it upstream');

    expect(again.resolution.reason).toBe('accepted as a Critical: the caller validates it upstream');
    expect(gateOn([again]).mergeable).toBe(true);

    for (const [roundNumber, repeat] of [[2, worse()], [3, worse({ id: 'C3', source: 'reviewer-b' })]]) {
      const replay = recorded(run, repeat, roundNumber, [again]);

      expect(replay.repeats.map((entry) => entry.reason)).toEqual(['already-recorded']);
      expect(replay.repeats[0].resolutionCleared).toBeUndefined();
      expect(replay.findings[0].resolution).toEqual(again.resolution);
      expect(gateOn(replay.findings).mergeable).toBe(true);
    }
  });

  test.each([
    ['a Major re-report of the accepted Major', () => reported({ id: 'M2', source: 'reviewer-b' })],
    ['an Important re-report of the accepted Major', () => reported({ id: 'M2', source: 'reviewer-b', severity: 'important' })],
    ['a Nit re-report of the accepted Major', () => reported({ id: 'N2', source: 'reviewer-b', severity: 'nit' })],
  ])('%s is no escalation: the acceptance stands and the gate takes it', (_name, second) => {
    const { accepted, round } = reportedAgain(reported(), second());

    expect(round.repeats.map((entry) => entry.reason)).toEqual(['already-recorded']);
    expect(round.findings[0].resolution).toEqual(accepted.resolution);
    expect(round.findings[0].supersededResolutions).toBeUndefined();
    expect(gateOn(round.findings).mergeable).toBe(true);
  });

  test('a Critical re-report of an accepted Critical is no escalation either: the acceptance stands', () => {
    const { accepted, round } = reportedAgain(worse(), worse({ id: 'C2', source: 'reviewer-b' }));

    expect(round.repeats.map((entry) => entry.reason)).toEqual(['already-recorded']);
    expect(round.findings[0].resolution).toEqual(accepted.resolution);
    expect(round.findings[0].supersededResolutions).toBeUndefined();
    expect(gateOn(round.findings).mergeable).toBe(true);
  });

  test(`any escalation clears it, not only one to Critical: an accepted Nit that is reported again as Important${FAILING_FIRST}`, () => {
    const { accepted, round } = reportedAgain(reported({ id: 'N', severity: 'nit' }), finding({ id: 'I', source: 'reviewer-b', severity: 'important' }));
    const [stored] = round.findings;

    expect(accepted).toMatchObject({ severity: 'nit', disposition: 'resolved' });
    expect(round.repeats).toEqual([{ id: 'I', repeatOf: 'N', fingerprint: expect.any(String), reason: 'severity-escalated', resolutionCleared: true }]);
    expect(stored).toMatchObject({ severity: 'important', escalatedFrom: 'nit', disposition: 'fix' });
    expect(stored.resolution).toBeUndefined();
    expect(stored.supersededResolutions).toEqual([{ severity: 'nit', supersededInRound: 2, resolution: accepted.resolution }]);
    expect(isOpen(stored)).toBe(true);
  });

  test(`two escalations clear two decisions and the record keeps both, in order${FAILING_FIRST}`, () => {
    const { accepted, round } = reportedAgain(reported({ id: 'N', severity: 'nit' }), finding({ id: 'I', source: 'reviewer-b', severity: 'important' }));
    const decidedAgain = decide(round.findings[0], 'accepted as an Important finding');
    const third = recorded(run, worse({ id: 'C3' }), 3, [decidedAgain]);

    expect(third.repeats).toEqual([{ id: 'C3', repeatOf: 'N', fingerprint: expect.any(String), reason: 'severity-escalated', resolutionCleared: true }]);
    expect(third.findings[0].resolution).toBeUndefined();
    expect(third.findings[0].supersededResolutions).toEqual([
      { severity: 'nit', supersededInRound: 2, resolution: accepted.resolution },
      { severity: 'important', supersededInRound: 3, resolution: decidedAgain.resolution },
    ]);
    expect(gateOn(third.findings).mergeable).toBe(false);
  });

  test(`a bare recorded reason is cleared too, and a finding that is also uncertain goes back to adjudication${FAILING_FIRST}`, () => {
    const bare = { ...reported(), disposition: 'resolved', resolution: { reason: 'accepted' } };

    expect(recorded(run, worse(), 2, [bare]).findings[0]).toMatchObject({ disposition: 'fix', supersededResolutions: [{ resolution: { reason: 'accepted' } }] });
    expect(recorded(run, worse(), 2, [bare]).findings[0].resolution).toBeUndefined();
    expect(recorded(run, worse(), 2, [{ ...bare, uncertain: true }]).findings[0]).toMatchObject({ disposition: 'adjudicate' });
  });

  test(`an escalation that finds no decision on the record reports none cleared${FAILING_FIRST}`, () => {
    const first = recorded(run, reported());
    const round = recorded(run, worse(), 2, first.findings);

    expect(round.repeats).toEqual([REPEAT]);
    expect(round.findings[0].supersededResolutions).toBeUndefined();
    expect(round.findings[0]).toMatchObject({ disposition: 'fix', severity: 'important', originalSeverity: 'critical' });
  });
});

describe('dedupe and merge keep a Critical on top however the ledger was written', () => {
  const major = finding({ id: 'M', source: 'reviewer-a', severity: 'major', blocking: false, disposition: 'deferred', reason: 'opt-in component' });

  test.each([
    ['a Critical written as such', '', (entry) => entry],
    ['a Critical already read into the taxonomy', FAILING_FIRST, normalizeFinding],
  ])('%s: a deferred Major cannot hide it, whichever comes first%s', (_name, _mark, read) => {
    const critical = read(deferredCritical({ id: 'C', source: 'reviewer-b' }));

    for (const group of [[major, critical], [critical, major]]) {
      const [collapsed] = dedupeFindings(group);
      expect(isActionable(collapsed)).toBe(true);
    }
  });

  test('mergeFindings lets a Critical report replace a recorded Major for the same defect, and a Major report does not replace a recorded Critical', () => {
    const existingMajor = normalizeFinding(major);
    const existingCritical = normalizeFinding(deferredCritical({ id: 'C' }));
    const key = { locationOrLink: 'a.js:1', failureMode: 'unchecked input reaches the widget' };

    expect(mergeFindings([existingMajor], [finding({ id: 'C2', ...key, source: 'reviewer-b' })])[0].id).toBe('C2');
    expect(mergeFindings([existingCritical], [{ ...major, ...key }])[0].id).toBe('C');
  });

  describe('when both findings are open the rank alone decides, and a Critical outranks a Major however the ledger was written', () => {
    const openMajor = finding({ id: 'M', source: 'reviewer-a', severity: 'major' });
    const openCritical = (read) => read(finding({ id: 'C', source: 'reviewer-b' }));

    test.each([
      ['written as such', (entry) => entry],
      ['read into the taxonomy (FAILING FIRST)', normalizeFinding],
    ])('dedupe collapses onto the Critical whichever comes first: %s', (_name, read) => {
      const critical = openCritical(read);

      for (const group of [[openMajor, critical], [critical, openMajor]]) {
        const [collapsed] = dedupeFindings(group);

        expect(collapsed.id).toBe('C');
        expect(isCritical(collapsed)).toBe(true);
      }
    });

    test.each([
      ['written as such', (entry) => entry],
      ['read into the taxonomy (FAILING FIRST)', normalizeFinding],
    ])('mergeFindings lets the Critical report replace a recorded Major: %s', (_name, read) => {
      expect(mergeFindings([normalizeFinding(openMajor)], [openCritical(read)])[0].id).toBe('C');
    });

    test('and does not let a Major report replace a recorded Critical', () => {
      expect(mergeFindings([openCritical(normalizeFinding)], [openMajor])[0].id).toBe('C');
      expect(mergeFindings([openCritical(normalizeFinding)], [normalizeFinding(openMajor)])[0].id).toBe('C');
    });
  });

  test('a class finding is Important when any of its instances is a Critical, read or written', () => {
    const [classFinding] = classFindings([normalizeFinding(finding({ class: 'unvalidated-input' })), finding({ id: 'G', class: 'unvalidated-input', severity: 'nit' })]);

    expect(classFinding.severity).toBe('important');
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe.each(RUNNERS)('a verifier vote never closes a Critical, read or written: `votes` through %s', (_name, run) => {
  const rejected = [
    { verifier: 'v1', verdict: 'not-real' },
    { verifier: 'v2', verdict: 'not-real' },
    { verifier: 'v3', verdict: 'abstain' },
  ];
  const tally = (entry) => run('votes', { depth: 'standard', findings: [{ ...entry, kind: 'bug', votes: rejected }] }).findings[0];

  test('a Critical as written is disputed and presented: a person decides it', () => {
    expect(tally(finding())).toMatchObject({ outcome: 'disputed', reason: 'security-finding-not-verified', presented: true });
  });

  test('a Critical as `ledger recordRound` recorded it is disputed and presented too (FAILING FIRST)', () => {
    const entry = recorded(run, finding()).findings[0];

    expect(entry).toMatchObject({ severity: 'important', originalSeverity: 'critical' });
    expect(tally(entry)).toMatchObject({ outcome: 'disputed', reason: 'security-finding-not-verified', presented: true });
  });

  test('a Major, written or recorded, that the verifiers reject is still filtered: only a Critical goes to a person', () => {
    const entry = recorded(run, finding({ severity: 'major' })).findings[0];

    expect(tally(entry)).toMatchObject({ outcome: 'filtered', presented: false });
    expect(tally(finding({ severity: 'major' }))).toMatchObject({ outcome: 'filtered', presented: false });
  });

  test('tallyVotes itself agrees with the CLI (FAILING FIRST)', () => {
    const entry = normalizeFinding(finding());

    expect(tallyVotes({ depth: 'standard', findings: [{ ...entry, kind: 'bug', votes: rejected }] }).findings[0].outcome).toBe('disputed');
  });

  test(`a Major that claims Critical in originalSeverity is disputed too, as written and as \`ledger recordRound\` recorded it${FAILING_FIRST}`, () => {
    const forged = deferred('major', { originalSeverity: 'critical' });
    const entry = recorded(run, forged).findings[0];

    expect(tally(forged)).toMatchObject({ outcome: 'disputed', presented: true });
    expect(tally(entry)).toMatchObject({ outcome: 'disputed', presented: true });
    expect(entry).toMatchObject({ severity: 'important', originalSeverity: 'critical' });
  });

  test('a Nit that carries a stale Critical claim is filtered like any Nit the verifiers reject', () => {
    expect(tally(deferred('nit', { originalSeverity: 'critical' }))).toMatchObject({ outcome: 'filtered', presented: false });
  });
});

describe('the vote tally reads Critical exactly as the ledger does (it mirrors `isCritical`, being a leaf that imports nothing)', () => {
  const WORDS = [undefined, null, '', 5, 'critical', 'Critical', ' CRITICAL ', 'major', 'important', 'minor', 'nit', 'nitpick', 'Nit', 'Pre-Existing', 'preexisting', 'pre existing', ' nit ', 'spicy'];
  const CASES = WORDS.flatMap((severity) => WORDS.map((originalSeverity) => [severity, originalSeverity]));
  const rejected = [
    { verifier: 'v1', verdict: 'not-real' },
    { verifier: 'v2', verdict: 'not-real' },
    { verifier: 'v3', verdict: 'abstain' },
  ];

  test.each(CASES)('severity %p, originalSeverity %p: disputed if and only if isCritical', (severity, originalSeverity) => {
    const entry = { id: 'F', reviewer: 'reviewer-a', kind: 'bug', votes: rejected };
    if (severity !== undefined) entry.severity = severity;
    if (originalSeverity !== undefined) entry.originalSeverity = originalSeverity;

    const { outcome } = tallyVotes({ depth: 'standard', findings: [entry] }).findings[0];

    expect(outcome).toBe(isCritical(entry) ? 'disputed' : 'filtered');
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('the operator\'s list and the recorder read a Critical as a security finding, read or written', () => {
  const askList = (entry) => buildDispositionChoices({ ledger: [entry], security: { status: 'clean', findings: [] }, headSha: HEAD }).dispositionChoices;
  const shape = (entries) =>
    entries.map((entry) => ({
      id: entry.id,
      group: entry.group,
      security: entry.security,
      requiresReason: entry.requiresReason,
      reasonPerFinding: entry.reasonPerFinding,
      accept: entry.choices.find((choice) => choice.id === 'accept').batchable,
    }));

  test('the decision list for a Critical as written: security, its own reason, Accept never batched', () => {
    expect(shape(askList(finding()))).toEqual([{ id: 'F', group: 'blocking', security: true, requiresReason: true, reasonPerFinding: true, accept: false }]);
  });

  test('the decision list for the same Critical already read into the taxonomy is the same list (FAILING FIRST)', () => {
    expect(shape(askList(normalizeFinding(finding())))).toEqual(shape(askList(finding())));
  });

  test('an Important finding is still not a security finding (nothing else changed)', () => {
    expect(shape(askList(finding({ severity: 'important' })))).toEqual([{ id: 'F', group: 'blocking', security: false, requiresReason: true, reasonPerFinding: undefined, accept: false }]);
    expect(shape(askList(normalizeFinding(finding({ severity: 'major' }))))[0].security).toBe(false);
  });

  test(`an open Major that claims Critical in originalSeverity is listed as a security finding, as written and as read into the taxonomy${FAILING_FIRST}`, () => {
    const forged = finding({ severity: 'major', originalSeverity: 'critical' });

    expect(shape(askList(forged))).toEqual(shape(askList(finding())));
    expect(shape(askList(normalizeFinding(forged)))).toEqual(shape(askList(finding())));
  });

  test('an open Nit that carries a stale Critical claim is listed as any Nit is, as written and as read', () => {
    const stale = finding({ severity: 'nit', originalSeverity: 'critical' });

    expect(askList(stale).map((entry) => entry.security)).toEqual([false]);
    expect(askList(normalizeFinding(stale)).map((entry) => entry.security)).toEqual([false]);
  });

  const bead = (entry) => {
    const input = { repo: 'Acme/Widgets', prNumber: 7, headSha: HEAD, ledger: [entry] };
    const lookups = Object.fromEntries(beadKeys(input).keys.map((key) => [key, { ok: true, found: false }]));
    return planBeads(input, lookups).actions.find((action) => action.action === 'create').create;
  };

  test('the bead filed for a Critical says `security` whether or not the ledger was read into the taxonomy (FAILING FIRST)', () => {
    const written = bead(finding());

    expect(written.title).toContain('[important, security]');
    expect(bead(normalizeFinding(finding())).title).toBe(written.title);
    expect(bead(normalizeFinding(finding())).priority).toBe(written.priority);
  });

  test('the bead filed for an Important finding does not say security', () => {
    expect(bead(normalizeFinding(finding({ severity: 'major' }))).title).not.toContain('security');
  });

  test(`the bead filed for an open Major that claims Critical in originalSeverity says security too${FAILING_FIRST}`, () => {
    const forged = finding({ severity: 'major', originalSeverity: 'critical' });

    expect(bead(forged).title).toContain('[important, security]');
    expect(bead(normalizeFinding(forged)).title).toBe(bead(forged).title);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('the merge gate refuses a deferred Critical, names it, and lets the operator close it (kata 1jp6)', () => {
  test(`the repro of kata 1jp6, evaluateGate: not mergeable, one blocker that names a Critical and says it is never deferrable${FAILING_FIRST}`, () => {
    const verdict = evaluateGate(gateInput({ ledger: [deferredCritical()] }));

    expect(verdict.mergeable).toBe(false);
    expect(verdict.findings.open).toEqual(['F']);
    const [blocker, ...rest] = blockersOf(verdict);
    expect(rest).toEqual([]);
    expect(blocker).toMatchObject({ findingId: 'F', locationOrLink: 'a.js:1', severity: 'critical' });
    expect(blocker.message).toMatch(/^Critical finding F \(a\.js:1\) is still open/);
    expect(blocker.message).toMatch(/deferral/);
    expect(blocker.deferralRejected).toMatch(/Critical is never deferrable/);
    expect(blocker.message).toContain(blocker.deferralRejected);
    expect(blocker.nextAction).toContain('ledger resolve');
    expect(verdict.blockers).toHaveLength(1);
  });

  describe('the Critical stays refused on the ledger rule alone: the gate as it was before #253, with no deferral stripped', () => {
    // #253 made the gate strip `blocking` from every Important finding, which refuses the repro for a reason of the gate's own. That
    // strip now lives in the one shared reading (`findingAsGateReads`, kata rsja). This compiles the REAL ledger with that one line
    // removed and hands it to the REAL gate (an anchor that stops matching is an error, never a silent pass; the way
    // pr-review-vote-gate-scenarios compiles a mutant of the vote tally), so the refusal of a Critical is shown to rest on
    // `isActionable` and not on the line above it.
    const STRIP = 'return { entry: withoutDeferral(kept), refusal };';
    const LEDGER_PATH = path.join(__dirname, '..', 'lib', 'pr-review-ledger.js');
    const GATE_PATH = path.join(__dirname, '..', 'lib', 'pr-review-gate.js');
    const compile = (file, source, requireFn) => {
      const mod = { exports: {} };
      const wrapper = vm.runInThisContext(`(function (exports, module, require, __filename, __dirname) {${source}\n})`, { filename: `${file}#no-strip` });
      wrapper(mod.exports, mod, requireFn, file, path.dirname(file));
      return mod.exports;
    };
    const gateWithoutStrip = () => {
      const ledgerSource = fs.readFileSync(LEDGER_PATH, 'utf8');
      expect(ledgerSource).toContain(STRIP);
      const mutantLedger = compile(LEDGER_PATH, ledgerSource.replace(STRIP, 'return { entry: kept, refusal };'), createRequire(LEDGER_PATH));
      const real = createRequire(GATE_PATH);
      const gate = compile(GATE_PATH, fs.readFileSync(GATE_PATH, 'utf8'), (id) => (id === './pr-review-ledger' ? mutantLedger : real(id)));
      return gate.evaluateGate;
    };

    test.each(['critical', 'Critical'])('a deferred non-blocking %s: not mergeable, as written and as read into the taxonomy (FAILING FIRST: without the strip the gate answered mergeable:true for the one read into the taxonomy)', (severity) => {
      const evaluate = gateWithoutStrip();

      for (const entry of [deferred(severity), normalizeFinding(deferred(severity))]) {
        const verdict = evaluate(gateInput({ ledger: [entry] }));

        expect(verdict.mergeable).toBe(false);
        expect(verdict.findings.open).toEqual(['F']);
        expect(verdict.blockers.map((blocker) => blocker.code)).toEqual([BLOCKER_CODES.OPEN_IMPORTANT_FINDING]);
      }
    });

    test.each([
      ['a Major that claims Critical in originalSeverity', () => deferred('major', { originalSeverity: 'critical' })],
      ['an Important finding that claims Critical in originalSeverity', () => deferred('important', { originalSeverity: 'critical' })],
    ])(`%s, deferred non-blocking: not mergeable, as written and as read into the taxonomy${FAILING_FIRST}`, (_name, entry) => {
      const evaluate = gateWithoutStrip();

      for (const asked of [entry(), normalizeFinding(entry())]) {
        const verdict = evaluate(gateInput({ ledger: [asked] }));

        expect(verdict.mergeable).toBe(false);
        expect(verdict.findings.open).toEqual(['F']);
        expect(verdict.blockers.map((blocker) => blocker.code)).toEqual([BLOCKER_CODES.OPEN_IMPORTANT_FINDING]);
      }
    });

    test('the same gate still takes the deferral of a Nit that carries a stale Critical claim: the claim was never read for a Nit', () => {
      const evaluate = gateWithoutStrip();

      for (const asked of [deferred('nit', { originalSeverity: 'critical' }), normalizeFinding(deferred('nit', { originalSeverity: 'critical' }))]) {
        expect(evaluate(gateInput({ ledger: [asked] })).mergeable).toBe(true);
      }
    });

    test('the same gate does take the deferral of a non-blocking Major, so the strip really is what is missing', () => {
      const evaluate = gateWithoutStrip();

      expect(evaluate(gateInput({ ledger: [deferred('major')] })).mergeable).toBe(true);
      expect(evaluate(gateInput({ ledger: [deferred('important')] })).mergeable).toBe(true);
    });
  });

  describe('the blocker names a Critical as one, however the ledger was written (it said "Important")', () => {
    test.each([
      ['a deferred Critical as written', () => deferredCritical()],
      ['an open Critical as written', () => finding()],
      ['a Critical as the ledger records it', () => normalizeFinding(deferredCritical())],
      ['a Major that claims Critical in originalSeverity', () => deferred('major', { originalSeverity: 'critical' })],
    ])(`%s: "Critical finding ... is still open", severity critical, the verdict, code and next action unchanged${FAILING_FIRST}`, (_name, entry) => {
      const verdict = evaluateGate(gateInput({ ledger: [entry()] }));
      const [blocker, ...rest] = blockersOf(verdict);

      expect(verdict.mergeable).toBe(false);
      expect(rest).toEqual([]);
      expect(blocker).toMatchObject({ code: BLOCKER_CODES.OPEN_IMPORTANT_FINDING, findingId: 'F', severity: 'critical', locationOrLink: 'a.js:1' });
      expect(blocker.message).toMatch(/^Critical finding F \(a\.js:1\) is still open/);
      expect(blocker.nextAction).toContain('ledger resolve');
    });

    test.each(['important', 'Important', 'major'])('an open %s finding is still "Important finding ... is still open", severity important', (severity) => {
      const [blocker] = blockersOf(evaluateGate(gateInput({ ledger: [finding({ severity })] })));

      expect(blocker).toMatchObject({ code: BLOCKER_CODES.OPEN_IMPORTANT_FINDING, findingId: 'F', severity: 'important' });
      expect(blocker.message).toMatch(/^Important finding F \(a\.js:1\) is still open/);
    });

    test.each(['spicy', ' Critical '])('a severity the gate cannot read (%p) keeps its own wording and its own word as the severity', (severity) => {
      const verdict = evaluateGate(gateInput({ ledger: [finding({ severity })] }));
      const [blocker] = blockersOf(verdict, BLOCKER_CODES.OPEN_UNRECOGNISED_FINDING);

      expect(verdict.mergeable).toBe(false);
      expect(blocker.severity).toBe(severity);
      expect(blocker.message).toContain('carries a severity this gate cannot read');
    });
  });

  test.each(['critical', 'Critical', 'CRITICAL'])('%s is held the same way, and a Critical that is also an open thread still names it (FAILING FIRST)', (severity) => {
    for (const extra of [{}, { unresolvedThread: true }]) {
      const verdict = evaluateGate(gateInput({ ledger: [deferred(severity, extra)] }));

      expect(verdict.mergeable).toBe(false);
      expect(blockersOf(verdict)[0].deferralRejected).toMatch(/Critical is never deferrable/);
    }
  });

  test('the gate says the same about a Critical already read into the taxonomy', () => {
    const asked = (entry) => evaluateGate(gateInput({ ledger: [entry] }));

    expect(asked(normalizeFinding(deferredCritical()))).toEqual(asked(deferredCritical()));
  });

  test('an Important or Major finding deferred the same way is unchanged: refused as the review\'s own classification, never called a Critical', () => {
    for (const severity of ['important', 'major']) {
      const verdict = evaluateGate(gateInput({ ledger: [deferred(severity)] }));
      const [blocker] = blockersOf(verdict);

      expect(verdict.mergeable).toBe(false);
      expect(blocker.deferralRejected).toContain("the review's own classification");
      expect(blocker.deferralRejected).not.toMatch(/Critical/);
      expect(blocker.severity).toBe('important');
      expect(blocker.message).toMatch(/^Important finding F \(a\.js:1\) is still open/);
    }
  });

  test('a Nit deferred the same way still does not block', () => {
    const verdict = evaluateGate(gateInput({ ledger: [deferred('nit')] }));

    expect(verdict.mergeable).toBe(true);
    expect(verdict.findings.open).toEqual([]);
  });

  test('a deferred Critical in the security lane blocks as an open lane finding', () => {
    const verdict = evaluateGate(gateInput({ security: { status: 'findings', findings: [deferredCritical()] } }));

    expect(verdict.mergeable).toBe(false);
    expect(verdict.securityLane.open).toEqual(['F']);
  });

  describe('the operator can still accept a Critical, the one way the gate takes: a decision with a login, a time and this head', () => {
    const accepted = (decision) => ({ ...deferredCritical(), disposition: 'resolved', resolution: { reason: 'the caller validates it upstream', ...decision } });

    test('with every part: the Critical stops blocking (a Critical is accepted like an Important finding, with its own reason)', () => {
      const verdict = evaluateGate(gateInput({ ledger: [accepted(DECISION)] }));

      expect(verdict.mergeable).toBe(true);
      expect(verdict.findings.open).toEqual([]);
    });

    test.each([
      ['a bare reason', {}],
      ['no deciding login', { decision: 'accept', at: DECISION.at, headSha: HEAD }],
      ['no timestamp', { decision: 'accept', by: DECISION.by, headSha: HEAD }],
      ['an earlier head', { ...DECISION, headSha: OLD_HEAD }],
    ])('%s still blocks, and the blocker says the resolution does not count', (_name, decision) => {
      const verdict = evaluateGate(gateInput({ ledger: [accepted(decision)] }));

      expect(verdict.mergeable).toBe(false);
      expect(blockersOf(verdict)[0].resolutionRejected).toEqual(expect.any(String));
    });

    test.each(RUNNERS)('`ledger resolve` records the decision on a Critical and the gate takes it (%s)', (_name, run) => {
      const { finding: resolved } = run('ledger', { action: 'resolve', ...stored(deferredCritical()), resolution: { reason: 'the caller validates it upstream', ...DECISION } });

      expect(resolved).toMatchObject({ disposition: 'resolved', severity: 'important', originalSeverity: 'critical' });
      expect(run('ledger', { action: 'isActionable', finding: resolved })).toEqual({ actionable: false });
      expect(run('gate', gateInput({ ledger: [resolved] })).mergeable).toBe(true);
    });

    test.each(RUNNERS)('`ledger resolve` refuses a decision with no login, and the Critical stays blocked (%s)', (_name, run) => {
      expect(() => run('ledger', { action: 'resolve', ...stored(deferredCritical()), resolution: { decision: 'accept', reason: 'accepted', headSha: HEAD, at: DECISION.at } })).toThrow();
    });
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe.each(RUNNERS)('the real gate action over a ledger the CLI wrote: %s', (_name, run) => {
  test('the repro verbatim: not mergeable, named, and the same answer as the library (FAILING FIRST)', () => {
    const request = gateInput({ ledger: [deferredCritical()] });
    const answer = run('gate', request);

    expect(answer.mergeable).toBe(false);
    expect(answer.reasons).toEqual([BLOCKER_CODES.OPEN_IMPORTANT_FINDING]);
    expect(blockersOf(answer)[0]).toMatchObject({ findingId: 'F', severity: 'critical' });
    expect(blockersOf(answer)[0].deferralRejected).toMatch(/Critical is never deferrable/);
    expect(answer.blockers).toEqual(evaluateGate(request).blockers);
  });

  test('a deferred Critical from `ledger recordRound` (read into the taxonomy): not mergeable, and the operator list still offers it as security (FAILING FIRST)', () => {
    const { findings } = recorded(run, deferredCritical());
    const answer = run('gate', gateInput({ ledger: findings }));

    expect(answer.mergeable).toBe(false);
    expect(blockersOf(answer)[0].deferralRejected).toMatch(/Critical is never deferrable/);
    expect(answer.dispositionChoices).toHaveLength(1);
    expect(answer.dispositionChoices[0]).toMatchObject({ id: 'F', group: 'blocking', security: true, requiresReason: true, reasonPerFinding: true });
    expect(answer.dispositionChoices[0].choices.find((choice) => choice.id === 'accept')).toMatchObject({ batchable: false, requiresReason: true, default: false });
    expect(answer.dispositionChoices[0].choices.some((choice) => choice.id === 'follow-on')).toBe(false);
  });

  test('a Critical the operator accepted with a full decision, carried through `recordRound`, lets the gate pass and is still listed as a security acceptance (FAILING FIRST for the listing)', () => {
    const { finding: resolved } = run('ledger', { action: 'resolve', ...stored(deferredCritical()), resolution: { reason: 'the caller validates it upstream', ...DECISION } });
    const { findings } = recorded(run, resolved);
    const answer = run('gate', gateInput({ ledger: findings }));

    expect(answer.mergeable).toBe(true);
    expect(answer.dispositionChoices).toEqual([]);
    expect(answer.mergeConfirmation.acceptedBlocking).toEqual([expect.objectContaining({ id: 'F', security: true, by: 'ldangelo' })]);
  });

  test('an Important finding deferred the same way stays refused, and is not offered as security', () => {
    const answer = run('gate', gateInput({ ledger: [deferred('important')] }));

    expect(answer.mergeable).toBe(false);
    expect(answer.dispositionChoices[0]).toMatchObject({ id: 'F', security: false });
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe.each(RUNNERS)('the review status over the counts the skill derives from a ledger the CLI wrote: %s', (_name, run) => {
  const BASE = '8b87a6d71146cd2e36e09c4fc265b6bb336f8798';
  const REVIEWED = 'b8fe66aeb70b304237e584311a2b481a3c990f91';
  const statusOf = (findingCounts) =>
    run('status', {
      baseSha: BASE,
      headSha: REVIEWED,
      reviewedHeadSha: REVIEWED,
      prUrl: 'https://github.com/org/repo/pull/1',
      roundsUsed: 1,
      findingCounts,
      coverage: { status: 'complete', gaps: [] },
      tests: { exitCode: 0, skipped: false, command: 'npx jest tests/foo.test.js' },
      remotePhase: 'REMOTE_REVIEW_COMPLETE',
      access: { ok: true },
      reportPath: '.ensemble/pr-review/pr-1.json',
    });
  /** The counts `status` takes: one `ledger isActionable` per recorded finding, the rest of the deferred ones counted deferred. */
  const countsOf = (ledger) => {
    const actionable = ledger.filter((entry) => run('ledger', { action: 'isActionable', finding: entry }).actionable);
    const deferredEntries = ledger.filter((entry) => !actionable.includes(entry) && entry.disposition === 'deferred');
    return { total: ledger.length, actionable: actionable.length, deferred: deferredEntries.length };
  };

  test('a deferred non-blocking Critical is counted actionable, so the local review is not complete (FAILING FIRST: it was counted deferred, and the review read complete)', () => {
    const counts = countsOf(recorded(run, deferredCritical()).findings);

    expect(counts).toEqual({ total: 1, actionable: 1, deferred: 0 });
    const status = statusOf(counts);
    expect(status.localPhase).not.toBe('LOCAL_REVIEW_COMPLETE');
    expect(status.status).not.toBe('REVIEW_COMPLETE');
  });

  test('a deferred non-blocking Major is still counted deferred, and the local review may complete (unchanged)', () => {
    const counts = countsOf(recorded(run, deferred('major', { reason: 'opt-in component' })).findings);

    expect(counts).toEqual({ total: 1, actionable: 0, deferred: 1 });
    expect(statusOf(counts).localPhase).toBe('LOCAL_REVIEW_COMPLETE');
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('the word Critical is read where it is defined, and only in the places that cannot import it', () => {
  const LIB = path.join(__dirname, '..', 'lib');

  // The ledger defines `isCritical`. `pr-review-votes.js` imports nothing (two harnesses load it alone) and mirrors it; the
  // agreement table above keeps the mirror honest. Every other review module asks `isCritical`.
  const ALLOWED = ['pr-review-ledger.js', 'pr-review-votes.js'];

  test('no other review module compares a severity with the literal `critical`: they ask `isCritical` (FAILING FIRST)', () => {
    const readers = fs
      .readdirSync(LIB)
      .filter((name) => /^(pr-review|review)-.*\.js$/.test(name) && !ALLOWED.includes(name))
      .filter((name) => /toLowerCase\(\)\s*===\s*'critical'/.test(fs.readFileSync(path.join(LIB, name), 'utf8')));

    expect(readers).toEqual([]);
  });
});
