'use strict';

/**
 * kata k48x: an incomplete review coverage stops the gate, the status and the decision list (epic ptqb).
 *
 * Every test here drives the REAL modules the review runs on: `evaluateGate`, `deriveStatus`, `buildDispositionChoices`, the
 * `ledger resolve` function (`recordOperatorResolution`), and the CLI handlers `gate`, `status`, `slices`, `carry`, `ledger`
 * and `state-write`. The coverage records are built by the production builder (`buildCoverage`), never typed in, so a record
 * the runner would not produce is not what is graded. Nothing is mocked. State reports live in a fixtures directory under
 * ~/.omp/pr-review-speedup/k48x (never os.tmpdir()), as the other pr-review fixtures do, and are removed afterwards.
 *
 * Each guard has a test that fails if the guard is removed; the mutation table is in the kata report.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { evaluateGate, findingsHeldOpen, coverageHeldOpen, BLOCKER_CODES } = require('../lib/pr-review-gate');
const { deriveStatus } = require('../lib/pr-review-status');
const { buildDispositionChoices } = require('../lib/pr-review-disposition');
const { buildCoverage } = require('../lib/pr-review-coverage');
const { recordOperatorResolution } = require('../lib/pr-review-ledger');
const cli = require('../lib/pr-review-cli');

const HEAD = 'a'.repeat(40);
const OLD_HEAD = 'b'.repeat(40);
const BASE = 'c'.repeat(40);
const AT = '2026-11-08T10:00:00Z';
const FIXTURES = path.join(os.homedir(), '.omp', 'pr-review-speedup', 'k48x', 'fixtures');

const SLICES = [
  { id: 's1', paths: ['src/a.js', 'src/b.js'] },
  { id: 's2', paths: ['src/c.js'] },
];
const CHANGED = ['src/a.js', 'src/b.js', 'src/c.js'];

const COMPLETE = { status: 'complete', gaps: [] };
const incomplete = (over = {}) => buildCoverage({ changedPaths: CHANGED, slices: SLICES, unreviewedSlices: ['s2'], uncovered: ['src/c.js'], origin: 'review run r1', ...over });
const READER_LOST = { unreviewedSlices: ['whole-range'], uncovered: [], detail: [{ sliceId: 'whole-range', reasons: [{ agent: 'reviewer-range', reason: 'expired:deadline-passed' }], missingPaths: [] }] };

/** What the operator's `ledger resolve` answer does to every gap: the decision shape (`{ reason, by, headSha, at }`). */
function accepted(record, over = {}) {
  const decision = { decision: 'accept', reason: 'nobody read src/c.js; it is generated output', by: 'ldangelo', headSha: HEAD, at: AT, ...over };
  return {
    ...record,
    gaps: record.gaps.map((gap) => {
      const result = recordOperatorResolution(gap, decision);
      expect(result.ok).toBe(true);
      return result.finding;
    }),
  };
}

const approvals = {
  ok: true, headSha: HEAD, satisfied: true, reason: 'required-approvals-present', tier: 'medium', humansRequired: 1, humansCounted: 1,
  approvedBy: ['human-a'], directedBy: null, ignored: [], refusals: [], reasons: [], warnings: [],
};
const tier = { ok: true, tier: 'medium', effectiveTier: 'medium', humansRequired: 1, refusals: [], reasons: [], warnings: [] };
const description = { ok: true, missing: [], present: ['testing', 'risk', 'rollback'], empty: [], ready: true, warnings: [] };

const gateInput = (over = {}) => ({ headSha: HEAD, ledger: [], approvals, tier, description, security: { status: 'clean', findings: [] }, coverage: COMPLETE, ...over });
const codes = (verdict) => verdict.blockers.map((blocker) => blocker.code);

const finding = (over = {}) => ({
  id: 'F-1', source: 'reviewer-s1-a', locationOrLink: 'src/a.js:3', severity: 'important', failureMode: 'reads past the end of the list',
  disposition: 'fix', evidence: 'src/a.js line 3 indexes list[list.length]', originalTextOrLink: 'src/a.js:3', ...over,
});

const statusFacts = (over = {}) => ({
  baseSha: BASE, headSha: HEAD, reviewedHeadSha: HEAD, roundsUsed: 0, findingCounts: { total: 0, actionable: 0, deferred: 0 },
  coverage: COMPLETE, tests: { exitCode: 0, skipped: false, command: 'npm test' }, remotePhase: 'REMOTE_REVIEW_COMPLETE', ...over,
});

describe('the gate: an unread path is not mergeable', () => {
  test('control: a complete coverage and nothing else open is mergeable, and the answer records the coverage it read', () => {
    const verdict = evaluateGate(gateInput());
    expect(verdict).toMatchObject({ mergeable: true, blockers: [], coverage: { status: 'complete', open: [], decided: [], unreadable: [] } });
  });

  test('an unreviewed slice makes the PR NOT mergeable, with a named blocker listing the slice and its paths', () => {
    const verdict = evaluateGate(gateInput({ coverage: incomplete({ detail: [{ sliceId: 's2', reasons: [{ agent: 'reviewer-s2-a', reason: 'expired:deadline-passed' }], missingPaths: [] }] }) }));
    expect(verdict.mergeable).toBe(false);
    expect(codes(verdict)).toEqual([BLOCKER_CODES.COVERAGE_INCOMPLETE]);
    const [blocker] = verdict.blockers;
    expect(blocker.code).toBe('review-coverage-incomplete');
    expect(blocker.message).toContain('NOT REVIEWED: slice s2');
    expect(blocker.message).toContain('src/c.js');
    expect(blocker).toMatchObject({ gapId: 'coverage:slice:s2', gapType: 'slice', sliceId: 's2', paths: ['src/c.js'] });
    expect(blocker.reasons).toEqual([{ agent: 'reviewer-s2-a', reason: 'expired:deadline-passed' }]);
    expect(blocker.nextAction).toMatch(/run the review again on this head/);
    expect(blocker.nextAction).toMatch(/ledger resolve/);
    expect(verdict.reasons).toEqual(['review-coverage-incomplete']);
    expect(verdict.coverage).toMatchObject({ status: 'incomplete', open: ['coverage:slice:s2'], decided: [] });
  });

  test('a whole-range reader that expired or listed too few paths blocks the same way', () => {
    const verdict = evaluateGate(gateInput({ coverage: incomplete(READER_LOST) }));
    expect(verdict.mergeable).toBe(false);
    expect(verdict.blockers[0]).toMatchObject({ code: 'review-coverage-incomplete', gapId: 'coverage:whole-range', gapType: 'whole-range', paths: CHANGED });
    expect(verdict.blockers[0].message).toContain('reviewer-range: expired:deadline-passed');
  });

  test.each([
    ['a slice', { unreviewedSlices: ['s1'], uncovered: ['src/a.js', 'src/b.js'] }, 'coverage:slice:s1'],
    ['the whole-range read', READER_LOST, 'coverage:whole-range'],
    ['a path no slice held', { unreviewedSlices: [], uncovered: ['docs/x.md'], changedPaths: [...CHANGED, 'docs/x.md'] }, 'coverage:uncovered'],
    ['paths read under too few lenses', { unreviewedSlices: [], uncovered: [], underReviewed: [{ path: 'src/a.js', lenses: ['correctness'] }], requiredLenses: 2 }, 'coverage:under-reviewed'],
    ['an incomplete coverage that names nothing', { unreviewedSlices: [], uncovered: [], incomplete: true }, 'coverage:unnamed'],
  ])('%s blocks the merge', (_label, over, gapId) => {
    const verdict = evaluateGate(gateInput({ coverage: incomplete(over) }));
    expect(verdict.mergeable).toBe(false);
    expect(verdict.blockers.map((blocker) => blocker.gapId)).toEqual([gapId]);
  });

  test('every open gap is a blocker of its own: two unread slices are two blockers', () => {
    const verdict = evaluateGate(gateInput({ coverage: incomplete({ unreviewedSlices: ['s1', 's2'], uncovered: CHANGED }) }));
    expect(verdict.blockers.map((blocker) => blocker.gapId)).toEqual(['coverage:slice:s1', 'coverage:slice:s2']);
  });

  test('a clean security lane does not cover a path the reviewers did not read, and the gap does not hide an open finding', () => {
    const verdict = evaluateGate(gateInput({ ledger: [finding()], coverage: incomplete(), security: { status: 'clean', findings: [] } }));
    expect(codes(verdict)).toEqual(['open-important-finding', 'review-coverage-incomplete']);
  });

  describe('coverage is a REQUIRED input: what the gate cannot read is unavailable data, never "nothing was missed"', () => {
    test.each([
      ['absent', undefined],
      ['a word instead of a record', 'complete'],
      ['an array', []],
      ['null', null],
      ['an unknown status', { status: 'fine', gaps: [] }],
      ['unavailable', { status: 'unavailable', gaps: [], reason: 'the slice plan could not be read' }],
      ['complete but listing a gap', { status: 'complete', gaps: incomplete().gaps }],
      ['incomplete and naming nothing', { status: 'incomplete', gaps: [] }],
      ['incomplete with a gap that is not a coverage gap', { status: 'incomplete', gaps: [finding({ id: 'coverage:slice:s2' })] }],
    ])('%s answers review-data-unavailable naming coverage', (_label, coverage) => {
      const input = gateInput({ coverage });
      if (coverage === undefined) delete input.coverage;
      const verdict = evaluateGate(input);
      expect(verdict.mergeable).toBe(false);
      expect(codes(verdict)).toContain('review-data-unavailable');
      expect(verdict.blockers[0].missing.join(' ')).toMatch(/coverage/);
    });

    test('an unavailable coverage carries its reason into the blocker', () => {
      const verdict = evaluateGate(gateInput({ coverage: { status: 'unavailable', gaps: [], reason: 'the slice plan could not be read' } }));
      expect(verdict.blockers[0].message).toContain('the slice plan could not be read');
      expect(verdict.coverage.unreadable[0]).toContain('the slice plan could not be read');
    });
  });

  describe('only the operator\'s recorded decision, bound to this head, accepts a gap', () => {
    test('a decision with a reason, a login, a time and this head (the `ledger resolve` answer) accepts it and says so', () => {
      const verdict = evaluateGate(gateInput({ coverage: accepted(incomplete()) }));
      expect(verdict.mergeable).toBe(true);
      expect(verdict.warnings).toContain('coverage-gap-accepted');
      expect(verdict.coverage).toMatchObject({ status: 'incomplete', open: [], decided: [{ id: 'coverage:slice:s2', by: 'ldangelo', at: AT }] });
      expect(verdict.coverage.decided[0].reason).toContain('generated output');
    });

    test('a decision made on an earlier head is stale: the gap blocks again, and the blocker says why', () => {
      const stale = accepted(incomplete(), { headSha: OLD_HEAD });
      const verdict = evaluateGate(gateInput({ coverage: stale }));
      expect(verdict.mergeable).toBe(false);
      expect(verdict.blockers[0].resolutionRejected).toMatch(/not the current head/);
      expect(verdict.blockers[0].message).toMatch(/its recorded decision does not count/);
    });

    test('a resolution typed without a login, a timestamp or a head is not a decision', () => {
      const record = incomplete();
      for (const resolution of [{ decision: 'accept', reason: 'fine' }, { decision: 'accept', reason: 'fine', by: 'ldangelo' }, { decision: 'accept', reason: 'fine', by: 'ldangelo', at: AT }, { decision: 'accept', reason: 'fine', by: 'ldangelo', headSha: HEAD }]) {
        const verdict = evaluateGate(gateInput({ coverage: { ...record, gaps: record.gaps.map((gap) => ({ ...gap, disposition: 'resolved', resolution })) } }));
        expect([JSON.stringify(resolution), verdict.mergeable]).toEqual([JSON.stringify(resolution), false]);
      }
    });

    test('a gap resolution without a decision, with follow-on, or with another word is not a decision: the gap stays open at the gate and in the list', () => {
      const record = incomplete();
      const full = { reason: 'fine', by: 'ldangelo', at: AT, headSha: HEAD };
      for (const resolution of [full, { ...full, decision: 'follow-on' }, { ...full, decision: 'ACCEPT' }, { ...full, decision: 'fix-here' }, { ...full, decision: 1 }]) {
        const coverage = { ...record, gaps: record.gaps.map((gap) => ({ ...gap, disposition: 'resolved', resolution })) };
        const verdict = evaluateGate(gateInput({ coverage }));
        expect([JSON.stringify(resolution), verdict.mergeable]).toEqual([JSON.stringify(resolution), false]);
        expect(verdict.blockers[0].resolutionRejected).toContain('decision');
        const listed = buildDispositionChoices({ ledger: [], security: { status: 'clean', findings: [] }, headSha: HEAD, coverage });
        expect(listed.dispositionChoices.map((entry) => entry.id)).toEqual(['coverage:slice:s2']);
        expect(listed.mergeConfirmation.acceptedCoverage).toEqual([]);
      }
    });

    test('a bot, or a login the policy does not name as a maintainer, cannot decide a gap', () => {
      const bot = evaluateGate(gateInput({ policy: { botLogins: ['ldangelo'] }, coverage: accepted(incomplete()) }));
      expect(bot.mergeable).toBe(false);
      expect(bot.blockers[0].resolutionRejected).toMatch(/bot/);
      const stranger = evaluateGate(gateInput({ policy: { maintainerLogins: ['someone-else'] }, coverage: accepted(incomplete()) }));
      expect(stranger.mergeable).toBe(false);
      const named = evaluateGate(gateInput({ policy: { maintainerLogins: ['ldangelo'] }, coverage: accepted(incomplete()) }));
      expect(named.mergeable).toBe(true);
    });

    test('`cleared`, the review\'s own deferral and `blocking:false` are never a decision about a gap', () => {
      const record = incomplete();
      for (const closure of [{ cleared: true, clearedBy: HEAD }, { blocking: false, disposition: 'deferred', reason: 'later' }, { disposition: 'not-applicable', reason: 'no' }, { disposition: 'resolved' }]) {
        const verdict = evaluateGate(gateInput({ coverage: { ...record, gaps: record.gaps.map((gap) => ({ ...gap, ...closure })) } }));
        expect([JSON.stringify(closure), verdict.mergeable]).toEqual([JSON.stringify(closure), false]);
      }
    });

    test('accepting one gap leaves the others, and the findings, to block', () => {
      const record = incomplete({ unreviewedSlices: ['s1', 's2'], uncovered: CHANGED });
      const mixed = { ...record, gaps: [accepted({ ...record, gaps: [record.gaps[0]] }).gaps[0], record.gaps[1]] };
      const verdict = evaluateGate(gateInput({ coverage: mixed }));
      expect(verdict.blockers.map((blocker) => blocker.gapId)).toEqual(['coverage:slice:s2']);
      expect(verdict.coverage.decided.map((entry) => entry.id)).toEqual(['coverage:slice:s1']);
      const withFinding = evaluateGate(gateInput({ ledger: [finding()], coverage: accepted(incomplete()) }));
      expect(codes(withFinding)).toEqual(['open-important-finding']);
    });
  });

  describe('coverageHeldOpen: the decision list asks the gate, it keeps no copy of the rule', () => {
    test('the open gaps, the decided ones and a coverage that says unavailable', () => {
      const open = coverageHeldOpen({ coverage: incomplete(), headSha: HEAD });
      expect(open).toMatchObject({ ok: true, unavailable: false });
      expect([...open.open]).toEqual(['coverage:slice:s2']);
      const decided = coverageHeldOpen({ coverage: accepted(incomplete()), headSha: HEAD });
      expect([...decided.open]).toEqual([]);
      expect(decided.decided).toHaveLength(1);
      expect(coverageHeldOpen({ coverage: { status: 'unavailable', gaps: [], reason: 'x' }, headSha: HEAD })).toMatchObject({ ok: true, unavailable: true });
    });

    test('a coverage the gate cannot read is refused, never an empty set', () => {
      expect(coverageHeldOpen({ coverage: 'complete', headSha: HEAD }).ok).toBe(false);
      expect(coverageHeldOpen({ coverage: { status: 'incomplete', gaps: [] }, headSha: HEAD }).ok).toBe(false);
      expect(coverageHeldOpen({ coverage: { status: 'complete', gaps: incomplete().gaps }, headSha: HEAD }).ok).toBe(false);
    });

    test('the findings helper is unaffected by a coverage it was never given', () => {
      expect(findingsHeldOpen({ ledger: [finding()], headSha: HEAD })).toMatchObject({ ok: true, ledgerOpen: new Set(['F-1']) });
    });
  });
});

describe('the status: an unread path is never a complete review', () => {
  test('control: everything settled is REVIEW_COMPLETE, and the coverage is echoed for the report', () => {
    const result = deriveStatus(statusFacts());
    expect(result).toMatchObject({ status: 'REVIEW_COMPLETE', localPhase: 'LOCAL_REVIEW_COMPLETE', coverage: COMPLETE });
  });

  test('an incomplete coverage is not LOCAL_REVIEW_COMPLETE even with every other fact perfect, and says what was not read', () => {
    const result = deriveStatus(statusFacts({ coverage: incomplete() }));
    expect(result.localPhase).toBe('LOCAL_REVIEW_PENDING');
    expect(result.status).toBe('REVIEW_PENDING');
    expect(result.next).toBe('complete-review-coverage');
    expect(result.reasons).toContain('incomplete review coverage: slice s2 (src/c.js)');
    expect(result.coverage.gaps[0].id).toBe('coverage:slice:s2');
  });

  test('a lost whole-range reader and a path nobody read are just as incomplete', () => {
    for (const over of [READER_LOST, { unreviewedSlices: [], uncovered: ['docs/x.md'], changedPaths: [...CHANGED, 'docs/x.md'] }]) {
      expect(deriveStatus(statusFacts({ coverage: incomplete(over) })).localPhase).toBe('LOCAL_REVIEW_PENDING');
    }
  });

  test.each([
    ['absent', undefined],
    ['a word', 'complete'],
    ['unavailable', { status: 'unavailable', gaps: [], reason: 'the slice plan could not be read' }],
    ['unreadable gaps', { status: 'incomplete', gaps: [{ id: 'x' }] }],
  ])('a coverage that is %s is a missing fact: LOCAL_REVIEW_BLOCKED, named, never complete', (_label, coverage) => {
    const facts = statusFacts({ coverage });
    if (coverage === undefined) delete facts.coverage;
    const result = deriveStatus(facts);
    expect(result.localPhase).toBe('LOCAL_REVIEW_BLOCKED');
    expect(result.status).toBe('REVIEW_BLOCKED');
    expect(result.reasons[0]).toMatch(/missing or invalid review facts: coverage/);
  });

  test('the operator\'s decision on this head settles the gap and the review completes; a decision on another head does not', () => {
    expect(deriveStatus(statusFacts({ coverage: accepted(incomplete()) }))).toMatchObject({ localPhase: 'LOCAL_REVIEW_COMPLETE', status: 'REVIEW_COMPLETE' });
    const stale = deriveStatus(statusFacts({ coverage: accepted(incomplete(), { headSha: OLD_HEAD }) }));
    expect(stale.localPhase).toBe('LOCAL_REVIEW_PENDING');
    expect(stale.next).toBe('complete-review-coverage');
  });

  test('the policy says who may decide a gap for the status as it does for the gate', () => {
    const policy = { botLogins: ['ldangelo'] };
    expect(deriveStatus(statusFacts({ policy, coverage: accepted(incomplete()) })).localPhase).toBe('LOCAL_REVIEW_PENDING');
    expect(deriveStatus(statusFacts({ policy: 'strict', coverage: accepted(incomplete()) })).localPhase).toBe('LOCAL_REVIEW_PENDING');
  });

  test('the gate and the status agree on every shape: open for one is open for the other', () => {
    const sentenceLogin = (record) => ({ ...record, gaps: record.gaps.map((gap) => ({ ...gap, disposition: 'resolved', resolution: { decision: 'accept', reason: 'fine', by: 'a sentence with spaces', headSha: HEAD, at: AT } })) });
    const shapes = [incomplete(), accepted(incomplete()), accepted(incomplete(), { headSha: OLD_HEAD }), sentenceLogin(incomplete()), incomplete(READER_LOST), COMPLETE];
    for (const coverage of shapes) {
      const gateOpen = evaluateGate(gateInput({ coverage })).blockers.some((blocker) => blocker.code === 'review-coverage-incomplete');
      const statusOpen = deriveStatus(statusFacts({ coverage })).localPhase !== 'LOCAL_REVIEW_COMPLETE';
      expect([JSON.stringify(coverage).slice(0, 80), statusOpen]).toEqual([JSON.stringify(coverage).slice(0, 80), gateOpen]);
    }
  });

  test('a gap is read first: the next step is to read it, then to fix what the read found', () => {
    const both = deriveStatus(statusFacts({ coverage: incomplete(), findingCounts: { total: 1, actionable: 1, deferred: 0 } }));
    expect(both.next).toBe('complete-review-coverage');
    expect(both.reasons).toEqual(expect.arrayContaining(['unresolved actionable finding', 'incomplete review coverage: slice s2 (src/c.js)']));
  });

  test('the round cap still blocks, and a review-only run still never completes: a gap changes neither', () => {
    const capped = deriveStatus(statusFacts({ coverage: incomplete(), roundsUsed: 3, findingCounts: { total: 1, actionable: 1, deferred: 0 } }));
    expect([capped.localPhase, capped.next]).toEqual(['LOCAL_REVIEW_BLOCKED', 'reconsider-approach-with-author']);
    const reviewOnly = deriveStatus(statusFacts({ coverage: incomplete(), reviewOnly: true }));
    expect([reviewOnly.localPhase, reviewOnly.next]).toEqual(['LOCAL_REVIEW_PENDING', 'complete-review-coverage']);
    expect(deriveStatus(statusFacts({ coverage: COMPLETE, reviewOnly: true })).next).toBe('report-to-author');
    expect(deriveStatus(statusFacts({ coverage: incomplete(), reviewOnly: true, headSha: OLD_HEAD, reviewedHeadSha: HEAD })).next).toBe('re-run-review-for-current-head');
  });

  test('nothing the caller adds relaxes it: a typed coverage-complete flag, an unreviewedSlices list or a bare status are refused, never read (review of PR 278, round 1)', () => {
    for (const coverage of [{ ...incomplete(), complete: true }, { status: 'complete', gaps: [], complete: false }, { status: 'complete', gaps: [], unreviewedSlices: ['s2'] }, { status: 'complete' }, { status: 'complete', gaps: null }]) {
      const result = deriveStatus(statusFacts({ coverage, override: true }));
      expect([JSON.stringify(coverage), result.localPhase]).toEqual([JSON.stringify(coverage), 'LOCAL_REVIEW_BLOCKED']);
      expect(result.reasons[0]).toMatch(/missing or invalid review facts: coverage/);
    }
  });
});

describe('the operator\'s decision list: a gap is asked about, in its own group, with Accept as its only choice', () => {
  const list = (over = {}) => buildDispositionChoices({ ledger: [], security: { status: 'clean', findings: [] }, headSha: HEAD, coverage: incomplete(), ...over });

  test('an open gap is one entry in the `coverage` group: no fix choice, no default, a reason of its own, nothing to batch', () => {
    const result = list();
    expect(result.ok).toBe(true);
    const [entry] = result.dispositionChoices;
    expect(entry).toMatchObject({
      id: 'coverage:slice:s2', severity: 'important', group: 'coverage', security: false, default: null, requiresReason: true, reasonPerFinding: true, votes: null, beadId: null,
    });
    expect(entry.choices.map((choice) => choice.id)).toEqual(['accept']);
    expect(entry.choices[0]).toMatchObject({ requiresReason: true, batchable: false, default: false });
    expect(entry.coverage).toMatchObject({ gapType: 'slice', sliceId: 's2', paths: ['src/c.js'] });
    expect(entry.locationOrLink).toBe('slice s2: src/c.js');
    expect(result.groups).toEqual([{ group: 'coverage', label: 'Not reviewed', ids: ['coverage:slice:s2'], batchChoices: [] }]);
    expect(result.mergeConfirmation).toMatchObject({ undecided: ['coverage:slice:s2'], undecidedBlocking: [], undecidedCoverage: ['coverage:slice:s2'], acceptedCoverage: [] });
    expect(result.mergeConfirmation.summary).toContain('1 coverage gap(s) undecided (coverage:slice:s2)');
  });

  test('the gate says what is open: an accepted gap is not listed, and is reported as accepted with its reason and login', () => {
    const result = list({ coverage: accepted(incomplete()) });
    expect(result.dispositionChoices).toEqual([]);
    expect(result.mergeConfirmation.acceptedCoverage).toEqual([{ id: 'coverage:slice:s2', paths: ['src/c.js'], reason: 'nobody read src/c.js; it is generated output', by: 'ldangelo', at: AT }]);
    expect(result.mergeConfirmation.summary).toContain('1 coverage gap(s) accepted as not reviewed (coverage:slice:s2: nobody read src/c.js; it is generated output)');
  });

  test('a decision that does not count is listed again and marked stale, as a finding\'s is', () => {
    const result = list({ coverage: accepted(incomplete(), { headSha: OLD_HEAD }) });
    expect(result.dispositionChoices[0].staleResolution).toBe(true);
    expect(result.mergeConfirmation.staleResolutions).toEqual(['coverage:slice:s2']);
  });

  test('a review whose coverage is complete reads exactly as it always did: no coverage clause, no coverage group', () => {
    const result = list({ coverage: COMPLETE, ledger: [finding()] });
    expect(result.groups.map((group) => group.group)).toEqual(['blocking']);
    expect(result.mergeConfirmation.summary).toBe('0 open bead(s); 0 blocking finding(s) accepted; 1 blocking finding(s) undecided'.replace('0 blocking finding(s) accepted', '0 blocking findings accepted'));
    const without = list({ coverage: undefined, ledger: [finding()] });
    expect(without.mergeConfirmation.summary).toBe(result.mergeConfirmation.summary);
    expect(without.mergeConfirmation).not.toHaveProperty('undecidedCoverage');
  });

  test('the findings keep their group, their choices and their batch choice; the gap sits right after the blocking findings', () => {
    const nit = finding({ id: 'N-1', severity: 'nit', locationOrLink: 'src/b.js:9' });
    const result = list({ ledger: [nit, finding()] });
    expect(result.dispositionChoices.map((entry) => [entry.id, entry.group])).toEqual([['F-1', 'blocking'], ['coverage:slice:s2', 'coverage'], ['N-1', 'nit']]);
    expect(result.groups.map((group) => [group.group, group.batchChoices])).toEqual([['blocking', ['fix-here']], ['coverage', []], ['nit', ['fix-here', 'follow-on', 'accept']]]);
    expect(result.dispositionChoices[0].choices.map((choice) => choice.id)).toEqual(['fix-here', 'accept']);
  });

  test('a coverage the gate calls unavailable has no gap to decide: the findings are still listed', () => {
    const result = list({ coverage: { status: 'unavailable', gaps: [], reason: 'x' }, ledger: [finding()] });
    expect(result.ok).toBe(true);
    expect(result.dispositionChoices.map((entry) => entry.id)).toEqual(['F-1']);
  });

  test('a coverage that is given and cannot be read is refused, never a quietly shorter list', () => {
    for (const coverage of ['incomplete', { status: 'incomplete', gaps: [] }, { status: 'incomplete', gaps: [{ id: 'x' }] }]) {
      const result = list({ coverage });
      expect([JSON.stringify(coverage), result.ok, result.dispositionChoices]).toEqual([JSON.stringify(coverage), false, []]);
    }
  });
});

describe('the CLI: the `gate`, `status`, `slices` and `carry coverage` subcommands carry it', () => {
  test('`gate` returns the blocker and the decision list from the same payload, and the list never changes mergeable', () => {
    const answer = cli.runGate(gateInput({ coverage: incomplete() }));
    expect(answer.mergeable).toBe(false);
    expect(codes(answer)).toEqual(['review-coverage-incomplete']);
    expect(answer.dispositionChoices.map((entry) => entry.id)).toEqual(['coverage:slice:s2']);
    expect(answer.dispositionGroups.map((group) => group.group)).toEqual(['coverage']);
    const decided = cli.runGate(gateInput({ coverage: accepted(incomplete()) }));
    expect(decided.mergeable).toBe(true);
    expect(decided.dispositionChoices).toEqual([]);
  });

  test('`gate` without a coverage is review-data-unavailable, and the findings list is still built', () => {
    const input = gateInput({ ledger: [finding()] });
    delete input.coverage;
    const answer = cli.runGate(input);
    expect(answer.mergeable).toBe(false);
    expect(answer.blockers[0].code).toBe('review-data-unavailable');
    expect(answer.blockers[0].missing).toContain('coverage');
    expect(answer.dispositionChoices.map((entry) => entry.id)).toEqual(['F-1']);
  });

  test('`status` echoes the coverage it graded, so the report written from it carries it', () => {
    const coverage = incomplete();
    const answer = cli.runStatus(statusFacts({ coverage }));
    expect(answer.coverage).toEqual(coverage);
    expect(answer.localPhase).toBe('LOCAL_REVIEW_PENDING');
  });

  test('`slices` with `reviewedBy` answers the record: a path nobody, or too few lenses, read is a named gap, not a quiet `covered:false`', () => {
    const paths = [{ path: 'src/a.js', lines: 10 }, { path: 'src/b.js', lines: 10 }, { path: 'src/c.js', lines: 10 }];
    const all = paths.map((entry) => entry.path);
    const read = (reviewer, lens, readPaths) => ({ sliceId: 'whole-pr', lens, reviewer, paths: readPaths });
    const answer = cli.runSlices({
      paths,
      mode: 'standard',
      reviewedBy: [read('s1-correctness', 'correctness', all), read('s1-security', 'security', ['src/a.js', 'src/b.js'])],
      changedPaths: [...all, 'docs/x.md'],
    });
    expect(answer.covered).toBe(false);
    expect(answer.coverage.status).toBe('incomplete');
    expect(answer.coverage.gaps.map((gap) => [gap.id, gap.paths])).toEqual([['coverage:uncovered', ['docs/x.md']], ['coverage:under-reviewed', ['src/c.js']]]);
    expect(evaluateGate(gateInput({ coverage: answer.coverage })).mergeable).toBe(false);
    const complete = cli.runSlices({ paths, mode: 'standard', reviewedBy: [read('s1-correctness', 'correctness', all), read('s1-security', 'security', all)], changedPaths: all });
    expect(complete.covered).toBe(true);
    expect(complete.coverage).toMatchObject({ status: 'complete', gaps: [] });
    expect(evaluateGate(gateInput({ coverage: complete.coverage })).mergeable).toBe(true);
  });

  test('`slices` that cannot compute the coverage answers it unavailable, never complete', () => {
    const answer = cli.runSlices({ paths: [{ path: 'src/a.js', lines: 1 }], mode: 'standard', reviewedBy: [{ sliceId: 'src', lens: 'x', reviewer: 'r', paths: [] }] });
    expect(answer.coverage.status).toBe('unavailable');
    expect(answer.ok).toBe(false);
    expect(evaluateGate(gateInput({ coverage: answer.coverage })).blockers[0].code).toBe('review-data-unavailable');
  });

  test('a plan that never held a changed file cannot read complete: with `changedPaths` the path is a gap, without it the record is unavailable (review of PR 278, round 1)', () => {
    const paths = [{ path: 'src/a.js', lines: 10 }];
    const read = (lens, reviewer) => ({ sliceId: 'whole-pr', lens, reviewer, paths: ['src/a.js'] });
    const reviewedBy = [read('correctness', 's1-correctness'), read('security', 's1-security')];
    const held = cli.runSlices({ paths, mode: 'standard', reviewedBy, changedPaths: ['src/a.js', 'src/b.js'] });
    expect(held.coverage.status).toBe('incomplete');
    expect(held.coverage.gaps.map((gap) => [gap.id, gap.paths])).toEqual([['coverage:uncovered', ['src/b.js']]]);
    const bare = cli.runSlices({ paths, mode: 'standard', reviewedBy });
    expect(bare.coverage.status).toBe('unavailable');
    expect(bare.coverage.reason).toMatch(/changedPaths was not given/);
    expect(evaluateGate(gateInput({ coverage: bare.coverage })).blockers[0].code).toBe('review-data-unavailable');
    expect(deriveStatus(statusFacts({ coverage: bare.coverage })).localPhase).toBe('LOCAL_REVIEW_BLOCKED');
    expect(cli.runSlices({ paths, mode: 'standard', reviewedBy, changedPaths: ['src/a.js'] }).coverage).toEqual(COMPLETE);
  });

  test('a plan of no path at all is not `covered` beside a record that is not complete', () => {
    const answer = cli.runSlices({ paths: [], mode: 'standard', reviewedBy: [], changedPaths: [] });
    expect(answer.coverage.status).not.toBe('complete');
    expect([answer.ok, answer.covered]).toEqual([false, false]);
  });

  describe('`carry coverage`: a delta round carries what it did not read (real state reports on disk)', () => {
    let dir;
    beforeEach(() => {
      fs.mkdirSync(FIXTURES, { recursive: true });
      dir = fs.mkdtempSync(path.join(FIXTURES, 'carry-'));
    });
    afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

    /** Records round 1's report the way the skill does: the full status result, written with `state-write`. */
    function recordRound1(coverage) {
      const status = cli.runStatus(statusFacts({ headSha: OLD_HEAD, reviewedHeadSha: OLD_HEAD, coverage }));
      expect(cli.runStateWrite({ prId: '42', cwd: dir, state: status }).ok).toBe(true);
      return status;
    }
    const carry = (over = {}) => cli.runCarry({ action: 'coverage', prId: '42', cwd: dir, lastReviewedSha: OLD_HEAD, deltaPlan: { mode: 'delta' }, coverage: COMPLETE, ...over });

    test('a delta round that read all of ITS paths still carries the gap of the round before: not complete, not mergeable, not LOCAL_REVIEW_COMPLETE', () => {
      recordRound1(incomplete());
      const answer = carry();
      expect(answer).toMatchObject({ ok: true, priorState: 'read', carried: ['coverage:slice:s2'], reasons: ['prior-coverage-incomplete'] });
      expect(answer.coverage.status).toBe('incomplete');
      expect(answer.coverage.gaps[0]).toMatchObject({ id: 'coverage:slice:s2', carriedFrom: OLD_HEAD });
      expect(cli.runGate(gateInput({ coverage: answer.coverage })).mergeable).toBe(false);
      expect(cli.runStatus(statusFacts({ coverage: answer.coverage })).localPhase).toBe('LOCAL_REVIEW_PENDING');
    });

    test('a decision recorded on the earlier head does not carry over: the new head asks again', () => {
      recordRound1(accepted(incomplete(), { headSha: OLD_HEAD }));
      const answer = carry();
      const verdict = cli.runGate(gateInput({ coverage: answer.coverage }));
      expect(verdict.mergeable).toBe(false);
      expect(verdict.dispositionChoices[0].staleResolution).toBe(true);
      const again = accepted({ ...answer.coverage, gaps: answer.coverage.gaps.map(({ resolution, ...rest }) => rest) });
      expect(cli.runGate(gateInput({ coverage: again })).mergeable).toBe(true);
    });

    test('a round of the full range reads every path itself and carries nothing', () => {
      recordRound1(incomplete());
      const answer = carry({ deltaPlan: { mode: 'full' } });
      expect(answer).toMatchObject({ ok: true, carried: [], reasons: ['range-full'] });
      expect(answer.coverage).toEqual(COMPLETE);
    });

    test('an earlier round that was complete carries nothing', () => {
      recordRound1(COMPLETE);
      expect(carry()).toMatchObject({ ok: true, carried: [], reasons: ['prior-coverage-complete'] });
    });

    test('no earlier report, one written for another head, or one with no coverage: unavailable, never complete', () => {
      expect(carry()).toMatchObject({ ok: false, priorState: 'absent' });
      expect(carry().coverage.status).toBe('unavailable');
      recordRound1(incomplete());
      const other = carry({ lastReviewedSha: 'd'.repeat(40) });
      expect(other).toMatchObject({ ok: false, priorState: 'discarded' });
      expect(other.coverage.status).toBe('unavailable');
      expect(cli.runGate(gateInput({ coverage: other.coverage })).blockers[0].code).toBe('review-data-unavailable');
      const old = { ...cli.runStatus(statusFacts({ headSha: OLD_HEAD, reviewedHeadSha: OLD_HEAD })) };
      delete old.coverage;
      expect(cli.runStateWrite({ prId: '42', cwd: dir, state: old }).ok).toBe(true);
      const unreadable = carry();
      expect(unreadable.ok).toBe(false);
      expect(unreadable.reasons[0]).toContain('prior-coverage-unavailable');
      expect(unreadable.coverage.status).toBe('unavailable');
    });

    test('the earlier coverage is read from the report, never from the payload; the request keys are checked', () => {
      recordRound1(incomplete());
      expect(() => carry({ priorCoverage: COMPLETE })).toThrow(/priorCoverage/);
      expect(() => cli.runCarry({ action: 'coverage', prId: '42', cwd: dir })).toThrow(/'coverage'/);
      expect(() => cli.runCarry({ action: 'coverage', coverage: COMPLETE })).toThrow(/'prId'/);
    });
  });
});

describe('the record\'s contract: a coverage written by hand, or merged from another answer, is refused (review of PR 278, round 1)', () => {
  const PROBES = [
    ['a bare complete', { status: 'complete' }],
    ['complete with the answer\'s `complete: false` beside it', { status: 'complete', gaps: [], complete: false }],
    ['complete with the answer\'s unreviewedSlices beside it', { status: 'complete', gaps: [], unreviewedSlices: ['s2'] }],
    ['complete with null gaps', { status: 'complete', gaps: null }],
    ['incomplete with a key outside the contract', { ...incomplete(), covered: true }],
    ['incomplete with no gaps array', { status: 'incomplete' }],
  ];

  test.each(PROBES)('%s: the gate answers review-data-unavailable naming coverage, the status is LOCAL_REVIEW_BLOCKED, and no list is built from it', (_label, coverage) => {
    const verdict = evaluateGate(gateInput({ coverage }));
    expect(verdict.mergeable).toBe(false);
    expect(codes(verdict)).toContain('review-data-unavailable');
    expect(verdict.blockers[0].missing.join(' ')).toMatch(/coverage/);
    expect(verdict.coverage.status).toBe('unavailable');
    expect(deriveStatus(statusFacts({ coverage })).localPhase).toBe('LOCAL_REVIEW_BLOCKED');
    expect(buildDispositionChoices({ ledger: [], security: { status: 'clean', findings: [] }, headSha: HEAD, coverage }).ok).toBe(false);
  });

  test('every record a producer writes is inside the contract, so the refusal never fires on a real one', () => {
    const paths = [{ path: 'src/a.js', lines: 10 }];
    const records = [
      COMPLETE,
      incomplete(),
      incomplete(READER_LOST),
      buildCoverage({ changedPaths: [], slices: [], unavailable: 'nothing to read' }),
      cli.runSlices({ paths, mode: 'standard', reviewedBy: [], changedPaths: ['src/a.js'] }).coverage,
    ];
    for (const record of records) expect(Object.keys(record).filter((key) => !['status', 'gaps', 'reason'].includes(key))).toEqual([]);
    expect(evaluateGate(gateInput({ coverage: incomplete() })).blockers[0].code).toBe('review-coverage-incomplete');
  });

  test('what Accept says matches what the gap is: a whole-range gap is not "no reviewer read these paths", an under-reviewed one is not unread', () => {
    const noteOf = (coverage) => buildDispositionChoices({ ledger: [], security: { status: 'clean', findings: [] }, headSha: HEAD, coverage }).dispositionChoices[0].choices[0].note;
    expect(noteOf(incomplete())).toMatch(/no reviewer result covered this slice/);
    const range = noteOf(incomplete(READER_LOST));
    expect(range).toMatch(/whole-range reader/);
    expect(range).toMatch(/slice reviewers read these paths one slice at a time/);
    expect(range).not.toMatch(/nobody read|no reviewer read/);
    const under = noteOf(incomplete({ unreviewedSlices: [], uncovered: [], underReviewed: [{ path: 'src/a.js', lenses: ['correctness'] }], requiredLenses: 2 }));
    expect(under).toMatch(/fewer distinct lenses/);
    expect(under).not.toMatch(/nobody read|no reviewer read/);
    expect(noteOf(incomplete({ unreviewedSlices: [], uncovered: ['docs/x.md'], changedPaths: [...CHANGED, 'docs/x.md'] }))).toMatch(/no slice held these paths/);
  });

  test('a slice one reviewer of two read is not described as unread: the note names what failed and why the slice does not count (review of PR 278, round 2)', () => {
    const noteOf = (coverage) => buildDispositionChoices({ ledger: [], security: { status: 'clean', findings: [] }, headSha: HEAD, coverage }).dispositionChoices[0].choices[0].note;
    const partial = incomplete({ unreviewedSlices: ['s1'], uncovered: ['src/a.js', 'src/b.js'], detail: [{ sliceId: 's1', reasons: [{ agent: 'reviewer-s1-b', reason: 'expired:deadline-passed' }], missingPaths: [] }] });
    const note = noteOf(partial);
    expect(note).toContain('reviewer-s1-b: expired:deadline-passed');
    expect(note).toMatch(/was not fully reviewed/);
    expect(note).toMatch(/even where another reviewer of it did read/);
    expect(note).not.toMatch(/no reviewer read|nobody read/);
  });

  test('slices: ok and covered follow the record, and a plan holding a path changedPaths does not name is unavailable (review of PR 278, round 2)', () => {
    const paths = [{ path: 'src/a.js', lines: 10 }, { path: 'src/b.js', lines: 10 }];
    const all = paths.map((entry) => entry.path);
    const reviewedBy = ['correctness', 'security'].map((lens) => ({ sliceId: 'whole-pr', lens, reviewer: `s1-${lens}`, paths: all }));
    const omitted = cli.runSlices({ paths, mode: 'standard', reviewedBy });
    expect([omitted.ok, omitted.covered, omitted.coverage.status]).toEqual([false, false, 'unavailable']);
    expect(omitted.coverageReason).toMatch(/changedPaths was not given/);
    const empty = cli.runSlices({ paths, mode: 'standard', reviewedBy, changedPaths: [] });
    expect([empty.ok, empty.covered, empty.coverage.status]).toEqual([false, false, 'unavailable']);
    expect(empty.coverage.reason).toMatch(/plan holds paths that changedPaths does not name \(src\/a\.js, src\/b\.js\)/);
    expect(cli.runSlices({ paths, mode: 'standard', reviewedBy, changedPaths: ['src/a.js'] }).coverage.status).toBe('unavailable');
    const full = cli.runSlices({ paths, mode: 'standard', reviewedBy, changedPaths: all });
    expect([full.ok, full.covered, full.coverage.status]).toEqual([true, true, 'complete']);
  });

  test('an under-reviewed gap says so for a path no reviewer named, and an unusable gap says why (review of PR 278, round 2)', () => {
    const named = incomplete({ unreviewedSlices: [], uncovered: [], underReviewed: [{ path: 'src/a.js', lenses: [] }, { path: 'src/b.js', lenses: ['correctness'] }], requiredLenses: 2 });
    expect(named.gaps[0].failureMode).toMatch(/no reviewer named 1 path \(src\/a\.js\), so nobody read it/);
    const zero = cli.runSlices({ paths: [], mode: 'standard', reviewedBy: [], changedPaths: [] });
    const verdict = evaluateGate(gateInput({ coverage: zero.coverage }));
    expect(verdict.blockers[0].code).toBe('review-data-unavailable');
    expect(verdict.blockers[0].missing.join(' ')).toMatch(/it names no path/);
  });
});

describe('a state report written before the coverage existed: the migration is one full-range round, then delta rounds carry (review of PR 278, round 2)', () => {
  const H2 = 'd'.repeat(40);
  const H3 = 'e'.repeat(40);
  let dir;
  beforeEach(() => {
    fs.mkdirSync(FIXTURES, { recursive: true });
    dir = fs.mkdtempSync(path.join(FIXTURES, 'migrate-'));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  /** The report of a round, written the way the skill writes it; `coverage: undefined` is a report of the release before this one. */
  function record(head, coverage) {
    const status = cli.runStatus(statusFacts({ headSha: head, reviewedHeadSha: head, coverage: coverage === undefined ? COMPLETE : coverage }));
    if (coverage === undefined) delete status.coverage;
    expect(cli.runStateWrite({ prId: '42', cwd: dir, state: status }).ok).toBe(true);
  }
  const carry = (lastReviewedSha, mode) => cli.runCarry({ action: 'coverage', prId: '42', cwd: dir, lastReviewedSha, deltaPlan: { mode }, coverage: COMPLETE });

  test('a delta round over a report with no coverage is unavailable AND says what clears it; the full-range round clears it and the next delta round carries', () => {
    record(OLD_HEAD, undefined);
    const delta = carry(OLD_HEAD, 'delta');
    expect(delta).toMatchObject({ ok: false, fullRangeRequired: true, priorState: 'read' });
    expect(delta.coverage.status).toBe('unavailable');
    expect(delta.coverage.reason).toMatch(/FULL range/);
    const full = carry(OLD_HEAD, 'full');
    expect(full).toMatchObject({ ok: true, carried: [], reasons: ['range-full'] });
    expect(full.fullRangeRequired).toBeUndefined();
    expect(full.coverage).toEqual(COMPLETE);
    record(H2, full.coverage);
    const next = carry(H2, 'delta');
    expect(next).toMatchObject({ ok: true, carried: [], reasons: ['prior-coverage-complete'] });
    expect(next.fullRangeRequired).toBeUndefined();
    expect(cli.runStatus(statusFacts({ headSha: H3, reviewedHeadSha: H3, coverage: next.coverage })).localPhase).toBe('LOCAL_REVIEW_COMPLETE');
  });

  test('a delta re-review of the migrating head stays unavailable and says the same, round after round, until a full range is read', () => {
    record(OLD_HEAD, undefined);
    const first = carry(OLD_HEAD, 'delta');
    record(H2, first.coverage); // the report that delta round writes holds the unavailable record
    const second = carry(H2, 'delta');
    expect(second).toMatchObject({ ok: false, fullRangeRequired: true });
    expect(second.coverage.status).toBe('unavailable');
    const full = carry(H2, 'full');
    expect(full.coverage).toEqual(COMPLETE);
    record(H3, full.coverage);
    expect(carry(H3, 'delta')).toMatchObject({ ok: true, reasons: ['prior-coverage-complete'] });
  });
});
