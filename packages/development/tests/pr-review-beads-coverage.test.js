'use strict';

/**
 * kata k48x: the findings-as-beads recorder sees an incomplete review coverage (epic ptqb).
 *
 * A slice, a whole-range read or a path nobody read is presented to the operator as a decision-list entry and blocks the
 * gate; it must also be tracked, so an accepted gap is not forgotten once the PR merges. The planner (pure, real) is given
 * the coverage record the runner builds (`buildCoverage`, never a typed-in shape) beside the ledger and reads the plan back.
 */

const { reviewFindingKey, reviewCoverageKey, beadKeys, planBeads, BEAD_LABEL } = require('../lib/pr-review-beads');
const { buildCoverage } = require('../lib/pr-review-coverage');
const { recordOperatorResolution } = require('../lib/pr-review-ledger');
const { COLLAPSE_THRESHOLD } = require('../lib/pr-review-disposition');

const HEAD = 'a'.repeat(40);
const NEXT_HEAD = 'b'.repeat(40);
const FIX_COMMIT = 'c'.repeat(40);
const AT = '2026-11-08T10:00:00Z';

const SLICES = [
  { id: 's1', paths: ['src/a.js', 'src/b.js'] },
  { id: 's2', paths: ['src/c.js'] },
  { id: 's3', paths: ['src/d.js'] },
];
const CHANGED = ['src/a.js', 'src/b.js', 'src/c.js', 'src/d.js'];
const gapsFor = (over = {}) => buildCoverage({ changedPaths: CHANGED, slices: SLICES, unreviewedSlices: ['s2'], uncovered: ['src/c.js'], origin: 'review run r1', ...over });
const input = (over = {}) => ({ repo: 'Acme/Widgets', prNumber: 7, headSha: HEAD, ledger: [], coverage: gapsFor(), ...over });
const finding = (over = {}) => ({
  id: 'F-1', source: 'code-reviewer', locationOrLink: 'src/widget.js:12', severity: 'important', failureMode: 'Unchecked path join',
  disposition: 'fix', evidence: 'line 12 joins user input', originalTextOrLink: 'https://example.invalid/pr/1#r1', ...over,
});
const empty = (inp) => Object.fromEntries(beadKeys(inp).keys.map((key) => [key, { ok: true, found: false }]));
const held = (key, over = {}) => ({ [key]: { ok: true, found: true, item: { id: 'bd-1', status: 'open', labels: [BEAD_LABEL], title: 'old', description: 'old', priority: 9, ...over }, labels: [BEAD_LABEL] } });
const creates = (plan) => plan.actions.filter((action) => action.action === 'create');

describe('the dedupe key of a coverage gap: what was not read, never why or when', () => {
  const base = { repo: 'Acme/Widgets', gapType: 'slice', sliceId: 's2', paths: ['src/c.js'] };

  test('it is the repository, the kind of gap, the slice and the sorted paths, and it cannot equal a finding\'s key', () => {
    const key = reviewCoverageKey(base);
    expect(key).toMatch(/^pr-review:v1:acme\/widgets:coverage:[0-9a-f]{32}$/);
    expect(reviewCoverageKey({ ...base, repo: 'acme/widgets' })).toBe(key);
    expect(reviewCoverageKey({ ...base, paths: ['./src/c.js'] })).toBe(key);
    expect(reviewCoverageKey({ ...base, paths: ['src/b.js', 'src/a.js'] })).toBe(reviewCoverageKey({ ...base, paths: ['src/a.js', 'src/b.js'] }));
    expect(key).not.toBe(reviewFindingKey({ repo: 'acme/widgets', file: 'src/c.js', claim: 'x::' }));
  });

  test('another repository, kind, slice or path is another key; an unreadable gap has none', () => {
    const key = reviewCoverageKey(base);
    for (const other of [{ repo: 'acme/other' }, { gapType: 'whole-range' }, { sliceId: 's3' }, { paths: ['src/d.js'] }]) expect(reviewCoverageKey({ ...base, ...other })).not.toBe(key);
    for (const bad of [{ repo: 'no spaces allowed' }, { gapType: '' }, { paths: [] }, { paths: 'src/c.js' }]) expect(reviewCoverageKey({ ...base, ...bad })).toBeNull();
  });
});

describe('the plan records one bead per open gap', () => {
  test('an unread slice is one create: priority 1, a task, the pr-review label, the slice and its paths in the text, never a follow-on unless the operator said so', () => {
    const inp = input();
    const plan = planBeads(inp, empty(inp));
    expect(plan.ok).toBe(true);
    const [create] = creates(plan);
    expect(plan.actions).toHaveLength(1);
    expect(create.findingIds).toEqual(['coverage:slice:s2']);
    expect(create.key).toBe(reviewCoverageKey({ repo: 'Acme/Widgets', gapType: 'slice', sliceId: 's2', paths: ['src/c.js'] }));
    expect(create.create).toMatchObject({ priority: 1, type: 'task', labels: [BEAD_LABEL] });
    expect(create.create.title).toBe('[Not reviewed] slice s2: src/c.js');
    expect(create.create.description).toContain('NOT REVIEWED: slice s2');
    expect(create.create.description).toContain('src/c.js');
    expect(create.create.description).toContain('Last confirmed: acme/widgets PR #7 at head ' + HEAD);
    expect(plan.byFinding['coverage:slice:s2']).toMatchObject({ action: 'create', key: create.key });
  });

  test('every open gap is its own bead, however many: they are never collapsed into one per file', () => {
    const many = SLICES.length + COLLAPSE_THRESHOLD + 2;
    const slices = Array.from({ length: many }, (_, i) => ({ id: `w${i + 1}`, paths: [`wide/f${i + 1}.js`] }));
    const record = buildCoverage({ changedPaths: slices.flatMap((slice) => slice.paths), slices, unreviewedSlices: slices.map((slice) => slice.id), uncovered: slices.flatMap((slice) => slice.paths), origin: 'review run r1' });
    const inp = input({ coverage: record });
    const plan = planBeads(inp, empty(inp));
    expect(creates(plan)).toHaveLength(many);
    expect(new Set(creates(plan).map((action) => action.key)).size).toBe(many);
  });

  test('the operator\'s decision is written into the bead, so an accepted gap is tracked with who accepted it and why', () => {
    const record = gapsFor();
    const decided = { ...record, gaps: record.gaps.map((gap) => recordOperatorResolution(gap, { reason: 'generated output nobody reads', by: 'ldangelo', headSha: HEAD, at: AT }).finding) };
    const inp = input({ coverage: decided });
    const [create] = creates(planBeads(inp, empty(inp)));
    expect(create.create.description).toContain('Operator decision: accepted by ldangelo');
    expect(create.create.description).toContain('generated output nobody reads');
  });

  test('what the bead says matches what the gap is: a whole-range gap names the slices that WERE read, an under-reviewed one the lenses it lacks (review of PR 278, round 1)', () => {
    const made = (over) => {
      const inp = input({ coverage: gapsFor(over) });
      return creates(planBeads(inp, empty(inp)))[0].create;
    };
    const range = made({ unreviewedSlices: ['whole-range'], uncovered: [] });
    expect(range.title).toMatch(/^\[Whole-range read missing\]/);
    expect(range.description).toContain('the slice reviewers read each slice on its own');
    expect(range.description).not.toMatch(/Paths not reviewed|no reviewer read/);
    const under = made({ unreviewedSlices: [], uncovered: [], underReviewed: [{ path: 'src/a.js', lenses: ['correctness'] }], requiredLenses: 2 });
    expect(under.title).toMatch(/^\[Under-reviewed\]/);
    expect(under.description).toContain('fewer distinct lenses than the mode requires');
    expect(under.description).not.toMatch(/Paths not reviewed|no reviewer read/);
  });

  test('a later head that still has the gap updates the same bead (one note per head), never a second one', () => {
    const first = input();
    const key = planBeads(first, empty(first)).actions[0].key;
    const later = input({ headSha: NEXT_HEAD });
    expect(beadKeys(later).keys).toEqual([key]);
    const plan = planBeads(later, held(key, { description: `Body.\n\nLast confirmed: acme/widgets PR #7 at head ${HEAD}` }));
    expect(plan.actions).toHaveLength(1);
    expect(plan.actions[0]).toMatchObject({ action: 'update', beadId: 'bd-1', key });
  });

  test('a gap is never closed by the recorder: a cleared mark, a verified commit and a gap that is gone leave its bead open', () => {
    const record = gapsFor();
    const key = beadKeys(input()).keys[0];
    const cleared = { ...record, gaps: record.gaps.map((gap) => ({ ...gap, cleared: true, clearedBy: FIX_COMMIT })) };
    const withCommit = input({ coverage: cleared, commitsOnPr: [FIX_COMMIT] });
    // the bead carries this PR's own footer, so a close WOULD be planned if a cleared mark and a verified commit could close a gap
    const plan = planBeads(withCommit, held(key, { description: `Body.\n\nLast confirmed: acme/widgets PR #7 at head ${'1'.repeat(40)}` }));
    expect(plan.actions.map((action) => action.action)).toEqual(['update']);
    // absence is not a fix: with the gap gone from the record, the plan has nothing to do with its bead
    const gone = input({ coverage: { status: 'complete', gaps: [] } });
    expect(planBeads(gone, {})).toMatchObject({ ok: true, actions: [] });
  });

  test('findings keep their beads: a ledger finding and a gap are planned side by side, and the finding\'s action is what it was without the gap', () => {
    const alone = input({ ledger: [finding()], coverage: undefined });
    const both = input({ ledger: [finding()] });
    const planAlone = planBeads(alone, empty(alone));
    const planBoth = planBeads(both, empty(both));
    expect(planBoth.actions.find((action) => action.findingIds.includes('F-1'))).toEqual(planAlone.actions[0]);
    expect(planBoth.actions).toHaveLength(2);
    expect(planBoth.counts.create).toBe(2);
  });

  test('a coverage that is complete or unavailable records nothing, and the input without one reads exactly as it did', () => {
    for (const coverage of [{ status: 'complete', gaps: [] }, { status: 'unavailable', gaps: [], reason: 'the slice plan could not be read' }, undefined, null]) {
      const inp = input({ ledger: [finding()], coverage });
      expect(planBeads(inp, empty(inp)).actions).toHaveLength(1);
    }
  });

  test('a coverage the recorder cannot read is refused, never a quietly shorter plan', () => {
    for (const coverage of ['incomplete', [], { status: 'incomplete' }, { status: 'incomplete', gaps: 'src/c.js' }, { status: 'incomplete', gaps: [{ failureMode: 'no id' }] }]) {
      const inp = input({ coverage });
      expect(beadKeys(inp)).toMatchObject({ ok: false, keys: [] });
      expect(planBeads(inp, {})).toMatchObject({ ok: false });
    }
  });

  test('the text that reaches the tracker is redacted like a finding\'s', () => {
    const record = gapsFor();
    const token = `sk-${'a1B2c3D4e5'.repeat(3)}`;
    const leaky = { ...record, gaps: record.gaps.map((gap) => ({ ...gap, failureMode: `${gap.failureMode} (the reviewer was shown ${token})` })) };
    const inp = input({ coverage: leaky });
    const [create] = creates(planBeads(inp, empty(inp)));
    expect(create.create.description).not.toContain(token);
    expect(create.create.description).toContain('[REDACTED]');
  });
});

describe('a slice one reviewer read is not called unread in its bead (kata k48x, review of PR 278, round 2)', () => {
  test('the heading says the slice was not fully reviewed, and the claim names the reviewer that failed', () => {
    const coverage = gapsFor({ unreviewedSlices: ['s1'], uncovered: ['src/a.js', 'src/b.js'], detail: [{ sliceId: 's1', reasons: [{ agent: 'reviewer-s1-b', reason: 'expired:deadline-passed' }], missingPaths: [] }] });
    const inp = input({ coverage });
    const [create] = creates(planBeads(inp, empty(inp)));
    expect(create.create.description).toContain('Paths of a slice that was not fully reviewed');
    expect(create.create.description).toContain('reviewer-s1-b: expired');
    expect(create.create.description).not.toMatch(/no reviewer read/);
  });
});
