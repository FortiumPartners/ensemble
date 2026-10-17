'use strict';

/**
 * br-0wx: `bv --robot-plan --label <L>` scopes a plan to one TRD, but a label that no bead
 * carries is silently ignored and bv returns the UNSCOPED plan (checked on bv 0.17.1: 11
 * beads from three TRDs instead of 0). So TRDs scaffolded before beads were labelled must
 * be labelled before anything passes --label to bv. `beads-label` does that, idempotently.
 */

const { ensureLabel, titleMatches } = require('../lib/beads-label');
const { runBeadsLabel, main } = require('../lib/trd-cli');

const LABEL = 'trd-2026-aaaaaaaa-demo';
const MATCH = '[trd:trd-2026-aaaaaaaa-demo';

const ISSUES = [
  { id: 'b-1', title: `${MATCH}] Implement TRD: Demo`, status: 'open', labels: [] },
  { id: 'b-2', title: `${MATCH}:task:TRD-001] first`, status: 'closed' }, // no labels key at all
  { id: 'b-3', title: `${MATCH}:task:TRD-002] second`, status: 'open', labels: [LABEL] },
  { id: 'b-4', title: '[trd:trd-2026-bbbbbbbb-other:task:X-1] foreign', status: 'open', labels: [] },
  { id: 'b-5', title: `${MATCH}:task:TRD-003] third`, status: 'open', labels: ['unrelated'] },
];
const wrapped = (issues) => ({ issues, total: issues.length, limit: 0, offset: 0, has_more: false });

/** A fake `br`: answers `list` with `listed` and records every other call. */
function fakeBr(listed) {
  const calls = [];
  const run = (args) => {
    calls.push(args);
    return args[0] === 'list' ? JSON.stringify(listed) : '[]';
  };
  return { run, calls, writes: () => calls.filter((a) => a[0] !== 'list') };
}

describe('ensureLabel', () => {
  test.each([
    ['a bare array (older br)', ISSUES],
    ['a wrapped object (br 0.2.x)', wrapped(ISSUES)],
  ])('labels only this TRD\'s unlabeled beads, from %s', (_name, listed) => {
    const br = fakeBr(listed);
    const res = ensureLabel({ label: LABEL, match: MATCH }, br.run);

    expect(res).toEqual({ label: LABEL, matched: 4, labeled: 3, already: 1 });
    expect(br.writes()).toEqual([['label', 'add', 'b-1', 'b-2', 'b-5', '-l', LABEL, '--json']]);
  });

  test('never touches a bead of another TRD', () => {
    const br = fakeBr(ISSUES);
    ensureLabel({ label: LABEL, match: MATCH }, br.run);
    expect(JSON.stringify(br.writes())).not.toContain('b-4');
  });

  test('is idempotent: nothing to do when every match already carries the label', () => {
    const labelled = ISSUES.map((b) => (b.title.includes(MATCH) ? { ...b, labels: [LABEL] } : b));
    const br = fakeBr(labelled);
    expect(ensureLabel({ label: LABEL, match: MATCH }, br.run)).toEqual({
      label: LABEL, matched: 4, labeled: 0, already: 4,
    });
    expect(br.writes()).toEqual([]);
  });

  test('does not label a TRD whose slug merely starts with this slug', () => {
    const issues = [
      { id: 'b-1', title: `${MATCH}:task:TRD-001] mine`, labels: [] },
      { id: 'b-9', title: `${MATCH}-v2] Implement TRD: sibling`, labels: [] },
      { id: 'b-10', title: `${MATCH}-v2:task:TRD-001] sibling task`, labels: [] },
    ];
    const br = fakeBr(issues);
    expect(ensureLabel({ label: LABEL, match: MATCH }, br.run)).toMatchObject({ matched: 1, labeled: 1 });
    expect(br.writes()).toEqual([['label', 'add', 'b-1', '-l', LABEL, '--json']]);
  });

  test('matches nothing when no title carries the token', () => {
    const br = fakeBr(ISSUES);
    expect(ensureLabel({ label: LABEL, match: '[trd:nope' }, br.run)).toMatchObject({ matched: 0, labeled: 0 });
    expect(br.writes()).toEqual([]);
  });

  test('splits a long id list into several `br label add` calls', () => {
    const many = Array.from({ length: 120 }, (_, i) => ({ id: `m-${i}`, title: `${MATCH}:task:T-${i}]`, labels: [] }));
    const br = fakeBr(many);
    expect(ensureLabel({ label: LABEL, match: MATCH }, br.run)).toMatchObject({ matched: 120, labeled: 120 });
    // ids per call = args minus `label add` and `-l <label> --json`
    expect(br.writes().map((a) => a.length - 5)).toEqual([50, 50, 20]);
  });

  test('requires both --label and --match', () => {
    expect(() => ensureLabel({ label: LABEL }, fakeBr([]).run)).toThrow(/--label and --match/);
    expect(() => ensureLabel({ match: MATCH }, fakeBr([]).run)).toThrow(/--label and --match/);
  });
});

describe('trd-cli beads-label', () => {
  test('is a registered subcommand and rejects missing flags with the shared {error} contract', () => {
    expect(typeof runBeadsLabel).toBe('function');
    const out = [];
    const spy = jest.spyOn(process.stdout, 'write').mockImplementation((s) => { out.push(String(s)); return true; });
    try {
      expect(main(['beads-label'])).toBe(1);
    } finally {
      spy.mockRestore();
    }
    expect(JSON.parse(out.join(''))).toEqual({ error: expect.stringMatching(/--label and --match/) });
  });
});

describe('titleMatches', () => {
  test('requires the match to end at ], : or end-of-title', () => {
    expect(titleMatches('[trd:foo] Implement', '[trd:foo')).toBe(true);
    expect(titleMatches('[trd:foo:task:T-1] x', '[trd:foo')).toBe(true);
    expect(titleMatches('prefix [trd:foo', '[trd:foo')).toBe(true);
    expect(titleMatches('[trd:foo-v2] Implement', '[trd:foo')).toBe(false);
    expect(titleMatches('[trd:foobar:task:T-1] x', '[trd:foo')).toBe(false);
  });

  test('a match that already ends with a delimiter is a plain substring', () => {
    expect(titleMatches('[trd:foo] Implement', '[trd:foo]')).toBe(true);
    expect(titleMatches('[trd:foo:task:T-1] x', '[trd:foo:')).toBe(true);
    expect(titleMatches('[trd:foo-v2] x', '[trd:foo]')).toBe(false);
  });
});
