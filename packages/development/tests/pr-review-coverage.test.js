'use strict';

/**
 * lib/pr-review-coverage.js (kata k48x): the coverage record, how it is graded and how it crosses heads.
 *
 * Pure module, no doubles: every test builds a record with `buildCoverage` (the function the runner and the `slices` CLI
 * call) and grades it with `gradeCoverage` (the function the gate and the status call). The mutation table for the guards
 * these tests pin is in the kata report; a test that stays green with its guard removed is not here.
 */

const { buildCoverage, gradeCoverage, carryCoverage, summarizeOpen, GAP_KIND, GAP_SOURCE } = require('../lib/pr-review-coverage');
const { validateLedger, recordOperatorResolution } = require('../lib/pr-review-ledger');

const HEAD = 'a'.repeat(40);
const OLD_HEAD = 'b'.repeat(40);
const AT = '2026-11-08T10:00:00Z';

const SLICES = [
  { id: 's1', paths: ['src/a.js', 'src/b.js'] },
  { id: 's2', paths: ['src/c.js'] },
];
const CHANGED = ['src/a.js', 'src/b.js', 'src/c.js'];

const build = (over = {}) => buildCoverage({ changedPaths: CHANGED, slices: SLICES, ...over });
const unreadS2 = (over = {}) => build({ unreviewedSlices: ['s2'], uncovered: ['src/c.js'], ...over });
const decision = (over = {}) => ({ reason: 'the other lens read it; accepted', by: 'ldangelo', headSha: HEAD, at: AT, ...over });
const decided = (record, over) => ({ ...record, gaps: record.gaps.map((gap) => ({ ...gap, disposition: 'resolved', resolution: decision(over) })) });

describe('buildCoverage', () => {
  test('every slice read: complete, no gap', () => {
    expect(build()).toEqual({ status: 'complete', gaps: [] });
  });

  test('an unreviewed slice is one gap that names the slice, every path of it and why it failed', () => {
    const record = unreadS2({ detail: [{ sliceId: 's2', reasons: [{ agent: 'reviewer-s2-a', reason: 'expired:deadline-passed' }], missingPaths: [] }] });
    expect(record.status).toBe('incomplete');
    expect(record.gaps).toHaveLength(1);
    expect(record.gaps[0]).toMatchObject({
      id: 'coverage:slice:s2',
      kind: GAP_KIND,
      source: GAP_SOURCE,
      gapType: 'slice',
      sliceId: 's2',
      severity: 'important',
      paths: ['src/c.js'],
      reasons: [{ agent: 'reviewer-s2-a', reason: 'expired:deadline-passed' }],
    });
    expect(record.gaps[0].failureMode).toContain('NOT REVIEWED: slice s2');
    expect(record.gaps[0].failureMode).toContain('src/c.js');
    expect(record.gaps[0].failureMode).toContain('reviewer-s2-a: expired:deadline-passed');
  });

  test('a gap is shaped like a ledger finding, so the operator\'s decision travels the existing path', () => {
    const record = unreadS2();
    expect(validateLedger(record.gaps).ok).toBe(true);
    const resolved = recordOperatorResolution(record.gaps[0], decision());
    expect(resolved.ok).toBe(true);
    expect(resolved.finding.resolution).toMatchObject({ by: 'ldangelo', headSha: HEAD });
  });

  test('a reviewer that listed fewer paths than its slice leaves the whole slice a gap and names the paths it did not list', () => {
    const record = build({
      unreviewedSlices: ['s1'],
      uncovered: ['src/a.js', 'src/b.js'],
      detail: [{ sliceId: 's1', reasons: [{ agent: 'reviewer-s1-b', reason: 'paths-not-reviewed' }], missingPaths: ['src/b.js'] }],
    });
    expect(record.gaps[0]).toMatchObject({ paths: ['src/a.js', 'src/b.js'], missingPaths: ['src/b.js'] });
    expect(record.gaps[0].failureMode).toContain('reviewer-s1-b: paths-not-reviewed');
    expect(record.gaps[0].evidence).toContain('not listed: src/b.js');
  });

  test('the whole-range reader is its own gap and covers every changed path', () => {
    const record = build({
      unreviewedSlices: ['whole-range'],
      detail: [{ sliceId: 'whole-range', reasons: [{ agent: 'reviewer-range', reason: 'expired:deadline-passed' }], missingPaths: [] }],
    });
    expect(record.status).toBe('incomplete');
    expect(record.gaps).toHaveLength(1);
    expect(record.gaps[0]).toMatchObject({ id: 'coverage:whole-range', gapType: 'whole-range', sliceId: 'whole-range', paths: CHANGED });
    expect(record.gaps[0].failureMode).toContain('reviewer-range: expired:deadline-passed');
  });

  test('a path no planned slice held is a gap of its own, never folded into a slice that did not hold it', () => {
    const record = buildCoverage({ changedPaths: [...CHANGED, 'docs/x.md'], slices: SLICES, uncovered: ['docs/x.md'] });
    expect(record.status).toBe('incomplete');
    expect(record.gaps.map((gap) => gap.id)).toEqual(['coverage:uncovered']);
    expect(record.gaps[0].paths).toEqual(['docs/x.md']);
  });

  test('a path of an unreviewed slice is named by the slice gap only, not twice', () => {
    const record = unreadS2();
    expect(record.gaps.map((gap) => gap.id)).toEqual(['coverage:slice:s2']);
  });

  test('paths read under fewer lenses than required are a gap that says which lenses read them', () => {
    const record = build({ underReviewed: [{ path: 'src/a.js', lenses: ['correctness'] }], requiredLenses: 2 });
    expect(record.status).toBe('incomplete');
    expect(record.gaps[0]).toMatchObject({ id: 'coverage:under-reviewed', gapType: 'under-reviewed', paths: ['src/a.js'] });
    expect(record.gaps[0].failureMode).toContain('fewer distinct lenses than the 2 the mode requires');
    expect(record.gaps[0].evidence).toBe('src/a.js: correctness');
  });

  test('"incomplete" with nothing named is never complete: every changed path is a gap', () => {
    const record = build({ incomplete: true });
    expect(record.status).toBe('incomplete');
    expect(record.gaps).toHaveLength(1);
    expect(record.gaps[0]).toMatchObject({ id: 'coverage:unnamed', gapType: 'unnamed', paths: CHANGED });
  });

  test('a slice id the plan does not hold names every changed path, never a narrower guess', () => {
    const record = build({ unreviewedSlices: ['ghost'] });
    expect(record.gaps[0]).toMatchObject({ id: 'coverage:slice:ghost', paths: CHANGED });
  });

  test.each([
    ['the caller says it could not compute it', { unavailable: 'reviewer x is reported under two lenses' }, /could not be computed \(reviewer x is reported under two lenses\)/],
    ['the changed paths are not a list', { changedPaths: 'src/a.js' }, /could not be read/],
    ['a slice has no paths', { slices: [{ id: 's1' }] }, /slice could not be read/],
  ])('%s: the record is unavailable and says every path is treated as not reviewed', (_label, over, message) => {
    const record = buildCoverage({ changedPaths: CHANGED, slices: SLICES, ...over });
    expect(record.status).toBe('unavailable');
    expect(record.gaps).toEqual([]);
    expect(record.reason).toMatch(message);
    expect(record.reason).toMatch(/treated as not reviewed/);
  });

  test('anything that is not an object is unavailable', () => {
    expect(buildCoverage(null).status).toBe('unavailable');
    expect(buildCoverage('complete').status).toBe('unavailable');
  });

  test('a long path list is named in part and complete in `paths`', () => {
    const many = Array.from({ length: 12 }, (_, index) => `src/f${index}.js`);
    const record = buildCoverage({ changedPaths: many, slices: [{ id: 'big', paths: many }], unreviewedSlices: ['big'], uncovered: many });
    expect(record.gaps[0].paths).toEqual(many);
    expect(record.gaps[0].failureMode).toContain('and 4 more');
  });
});

describe('gradeCoverage', () => {
  const grade = (record, context = { headSha: HEAD }) => gradeCoverage(record, context);

  test('a complete record has nothing open and is settled', () => {
    expect(grade({ status: 'complete', gaps: [] })).toMatchObject({ status: 'complete', open: [], missing: [], settled: true });
  });

  test('an incomplete record holds every gap open until it carries the operator\'s decision', () => {
    const graded = grade(unreadS2());
    expect(graded.status).toBe('incomplete');
    expect(graded.open.map(({ gap }) => gap.id)).toEqual(['coverage:slice:s2']);
    expect(graded.open[0].rejectedBecause).toBeNull();
    expect(graded.settled).toBe(false);
  });

  test('a decision with a reason, a login, a time and THIS head closes the gap', () => {
    const graded = grade(decided(unreadS2()));
    expect(graded.open).toEqual([]);
    expect(graded.decided).toEqual([{ gap: expect.objectContaining({ id: 'coverage:slice:s2' }), reason: 'the other lens read it; accepted', by: 'ldangelo', at: AT }]);
    expect(graded.settled).toBe(true);
  });

  test('a decision made on another head decides nothing here, and says why', () => {
    const graded = grade(decided(unreadS2(), { headSha: OLD_HEAD }));
    expect(graded.open).toHaveLength(1);
    expect(graded.open[0].rejectedBecause).toMatch(/recorded against b{40}, not the current head a{40}/);
  });

  test.each([
    ['no login', { by: undefined }],
    ['a login that is a sentence', { by: 'the operator said so' }],
    ['no timestamp', { at: undefined }],
    ['a date with no zone', { at: '2026-11-08' }],
    ['no reason', { reason: '   ' }],
    ['no head', { headSha: undefined }],
  ])('a decision with %s decides nothing', (_label, over) => {
    const record = unreadS2();
    const withResolution = { ...record, gaps: record.gaps.map((gap) => ({ ...gap, resolution: { ...decision(), ...over } })) };
    const graded = grade(withResolution);
    expect(graded.open).toHaveLength(1);
    expect(graded.decided).toEqual([]);
  });

  test('the policy decides who may decide: a bot login, or one outside maintainerLogins, is refused', () => {
    const resolved = decided(unreadS2(), { by: 'coderabbitai' });
    expect(grade(resolved, { headSha: HEAD, policy: { botLogins: ['coderabbitai'] } }).open).toHaveLength(1);
    expect(grade(resolved, { headSha: HEAD, policy: { maintainerLogins: ['ldangelo'] } }).open).toHaveLength(1);
    expect(grade(decided(unreadS2()), { headSha: HEAD, policy: { maintainerLogins: ['ldangelo'] } }).open).toEqual([]);
  });

  test('a policy that cannot be read refuses every decision', () => {
    expect(grade(decided(unreadS2()), { headSha: HEAD, policy: 'strict' }).open).toHaveLength(1);
  });

  test('`cleared`, `blocking:false` and a deferral are not a decision about a gap', () => {
    const record = unreadS2();
    const closures = [{ cleared: true }, { blocking: false, disposition: 'deferred', reason: 'later' }, { disposition: 'resolved' }];
    for (const closure of closures) {
      const graded = grade({ ...record, gaps: record.gaps.map((gap) => ({ ...gap, ...closure })) });
      expect([JSON.stringify(closure), graded.open.length]).toEqual([JSON.stringify(closure), 1]);
    }
  });

  test.each([
    ['not an object', 'complete', /the coverage record/],
    ['no status', {}, /the coverage status/],
    ['an unknown status', { status: 'fine' }, /the coverage status/],
    ['unavailable', { status: 'unavailable', gaps: [], reason: 'the plan was unreadable' }, /the coverage result: the plan was unreadable/],
    ['complete but listing a gap', { status: 'complete', gaps: [{}] }, /says complete and lists gaps/],
    ['incomplete naming nothing', { status: 'incomplete', gaps: [] }, /says incomplete and names none/],
    ['incomplete with gaps that are not a list', { status: 'incomplete', gaps: 'src/a.js' }, /the coverage gaps/],
  ])('%s is unreadable, never a pass', (_label, record, message) => {
    const graded = grade(record);
    expect(graded.missing.join('; ')).toMatch(message);
    expect(graded.settled).toBe(false);
  });

  test('a gap that is not finding-shaped, is not a coverage gap, names no path or repeats an id makes the record unreadable', () => {
    const [gap] = unreadS2().gaps;
    const broken = [
      { ...gap, failureMode: '' },
      { ...gap, kind: 'finding' },
      { ...gap, source: 'reviewer-s1-a' },
      { ...gap, paths: [] },
      { ...gap, paths: [''] },
    ];
    for (const entry of broken) {
      const graded = grade({ status: 'incomplete', gaps: [entry] });
      expect(graded.missing.join('; ')).toMatch(/unusable coverage gaps \(coverage:slice:s2\)/);
      expect(graded.open).toEqual([]);
    }
    const duplicated = grade({ status: 'incomplete', gaps: [gap, { ...gap }] });
    expect(duplicated.missing.join('; ')).toMatch(/unusable coverage gaps/);
  });

  test('a record with one decided and one open gap is open', () => {
    const record = build({ unreviewedSlices: ['s1', 's2'], uncovered: CHANGED });
    const mixed = { ...record, gaps: [{ ...record.gaps[0], disposition: 'resolved', resolution: decision() }, record.gaps[1]] };
    const graded = grade(mixed);
    expect(graded.decided.map(({ gap }) => gap.id)).toEqual(['coverage:slice:s1']);
    expect(graded.open.map(({ gap }) => gap.id)).toEqual(['coverage:slice:s2']);
    expect(graded.settled).toBe(false);
  });

  test('summarizeOpen names the slices, the reader and the other paths', () => {
    const record = build({ unreviewedSlices: ['s2', 'whole-range'], uncovered: ['src/c.js'] });
    expect(summarizeOpen(grade(record).open)).toBe('slice s2 (src/c.js); the whole-range read');
  });
});

describe('carryCoverage: a delta says nothing about the paths it did not read', () => {
  const prior = (over = {}) => ({ ...unreadS2(), ...over });
  const currentComplete = { status: 'complete', gaps: [] };
  const carry = (over = {}) => carryCoverage({ current: currentComplete, prior: prior(), priorState: 'read', priorHeadSha: OLD_HEAD, fullRange: false, ...over });

  test('a delta round carries every gap of the round it starts from, so a complete delta stays incomplete', () => {
    const result = carry();
    expect(result.ok).toBe(true);
    expect(result.coverage.status).toBe('incomplete');
    expect(result.carried).toEqual(['coverage:slice:s2']);
    expect(result.coverage.gaps[0]).toMatchObject({ id: 'coverage:slice:s2', carriedFrom: OLD_HEAD });
  });

  test('the old decision stays on the carried gap and is stale at the new head: asked again, never inherited', () => {
    const result = carry({ prior: decided(unreadS2(), { headSha: OLD_HEAD }) });
    expect(result.coverage.gaps[0].resolution).toMatchObject({ headSha: OLD_HEAD });
    const graded = gradeCoverage(result.coverage, { headSha: HEAD });
    expect(graded.open).toHaveLength(1);
    expect(graded.open[0].rejectedBecause).toMatch(/not the current head/);
  });

  test('the earliest head a gap was carried from is kept through any number of carries', () => {
    const first = carry();
    const second = carryCoverage({ current: currentComplete, prior: first.coverage, priorState: 'read', priorHeadSha: HEAD, fullRange: false });
    expect(second.coverage.gaps[0].carriedFrom).toBe(OLD_HEAD);
  });

  test('this round\'s own gaps stay, and a carried id that collides is kept apart', () => {
    const own = unreadS2();
    const result = carry({ current: own });
    expect(result.coverage.gaps.map((gap) => gap.id)).toEqual(['coverage:slice:s2', `coverage:slice:s2@${OLD_HEAD.slice(0, 7)}`]);
    expect(validateLedger(result.coverage.gaps).ok).toBe(true);
  });

  test('a round of the full range carries nothing: it read every path itself', () => {
    const result = carry({ fullRange: true });
    expect(result).toMatchObject({ ok: true, carried: [], reasons: ['range-full'] });
    expect(result.coverage).toBe(currentComplete);
  });

  test('a complete earlier coverage carries nothing', () => {
    const result = carry({ prior: currentComplete });
    expect(result).toMatchObject({ ok: true, carried: [], reasons: ['prior-coverage-complete'] });
    expect(result.coverage.status).toBe('complete');
  });

  test.each(['absent', 'discarded', 'corrupt', 'unreadable'])('an earlier state that is %s makes the coverage unavailable, never complete', (priorState) => {
    const result = carry({ prior: null, priorState });
    expect(result.ok).toBe(false);
    expect(result.coverage.status).toBe('unavailable');
    expect(result.reasons[0]).toContain(`prior-state-unavailable (${priorState})`);
    expect(gradeCoverage(result.coverage, { headSha: HEAD }).settled).toBe(false);
  });

  test.each([
    ['no coverage in the report', null],
    ['an unavailable one', { status: 'unavailable', gaps: [], reason: 'x' }],
    ['one that is not a record', 'complete'],
    ['one that says complete and lists a gap', { status: 'complete', gaps: unreadS2().gaps }],
  ])('an earlier report with %s makes the coverage unavailable', (_label, record) => {
    const result = carry({ prior: record });
    expect(result.ok).toBe(false);
    expect(result.coverage.status).toBe('unavailable');
    expect(result.reasons[0]).toContain('prior-coverage-unavailable');
  });

  test('this round\'s own unavailable coverage stays unavailable even when the earlier one carries gaps', () => {
    const result = carry({ current: { status: 'unavailable', gaps: [], reason: 'could not be computed' } });
    expect(result.coverage.status).toBe('unavailable');
  });

  test('a round whose own record is not an object is unavailable', () => {
    const result = carryCoverage({ current: undefined, prior: prior(), priorState: 'read', priorHeadSha: OLD_HEAD });
    expect(result.ok).toBe(false);
    expect(result.coverage.status).toBe('unavailable');
  });
});
