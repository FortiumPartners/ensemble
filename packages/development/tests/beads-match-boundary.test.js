'use strict';

/**
 * A TRD scope entry "[trd:foo" must not capture the beads of a TRD whose slug merely starts
 * with "foo" (e.g. "[trd:foo-bar]"): beads-stage would stage them and beads-label would
 * mislabel them, defeating the per-TRD scoping.
 */

const { buildScopedExport } = require('../lib/beads-stage');
const { ensureLabel, titleMatches } = require('../lib/beads-label');

const rec = (id, title, extra = {}) => JSON.stringify({ id, title, status: 'open', labels: [], ...extra });

describe('titleMatches', () => {
  test('open-ended TRD prefix matches only the exact slug', () => {
    expect(titleMatches('[trd:foo] Implement TRD: x', '[trd:foo')).toBe(true);
    expect(titleMatches('[trd:foo:task:TRD-1] t', '[trd:foo')).toBe(true);
    expect(titleMatches('[trd:foo-bar] Implement TRD: x', '[trd:foo')).toBe(false);
    expect(titleMatches('[trd:foo-bar:task:TRD-1] t', '[trd:foo')).toBe(false);
  });

  test('closed or non-TRD entries stay plain substring matches', () => {
    expect(titleMatches('[trd:foo] x', '[trd:foo]')).toBe(true);
    expect(titleMatches('[trd:foo-bar] x', '[trd:foo]')).toBe(false);
    expect(titleMatches('hello world', 'lo wo')).toBe(true);
  });
});

describe('prefix-sharing slugs', () => {
  test('buildScopedExport does not stage a sibling TRD whose slug extends ours', () => {
    const head = rec('a', '[trd:foo:task:TRD-1] a') + '\n';
    const work = head + rec('b', '[trd:foo-bar:task:TRD-1] b') + '\n' + rec('c', '[trd:foo:task:TRD-2] c') + '\n';
    const res = buildScopedExport(head, work, { matches: ['[trd:foo'] });
    expect(res.added).toBe(1);
    expect(res.foreignDropped).toBe(1);
    expect(res.text).toContain('"id":"c"');
    expect(res.text).not.toContain('"id":"b"');
  });

  test('ensureLabel does not label a sibling TRD whose slug extends ours', () => {
    const calls = [];
    const run = (args) => {
      calls.push(args);
      if (args[0] === 'list') {
        return JSON.stringify([
          { id: 'x1', title: '[trd:foo:task:TRD-1] a', labels: [] },
          { id: 'y1', title: '[trd:foo-bar:task:TRD-1] b', labels: [] },
        ]);
      }
      return '[]';
    };
    const res = ensureLabel({ label: 'foo', match: '[trd:foo' }, run);
    expect(res).toEqual({ label: 'foo', matched: 1, labeled: 1, already: 0 });
    expect(calls.find((c) => c[0] === 'label')).toEqual(['label', 'add', 'x1', '-l', 'foo', '--json']);
  });
});
