'use strict';

const fs = require('fs');
const path = require('path');
const { findUntracked, findingKey, failureKey, isId, isCount } = require('../lib/local-ci-sweep');

const finding = { prNumber: 12, commentId: 345, body: 'nit' };
const failure = { checkRunId: 999, sha: 'abc' };

describe('local-ci-sweep findUntracked', () => {
  test('unresolved findings become beads: one returned per finding with its comment', () => {
    const r = findUntracked({ findings: [finding, { prNumber: 12, commentId: 346 }], failures: [] }, new Set());
    expect(r.findings.map((f) => f.commentId)).toEqual([345, 346]);
    expect(r.findings[0].key).toBe(findingKey(12, 345));
  });

  test('late finding found: only the untracked one is returned', () => {
    const tracked = new Set([findingKey(12, 345)]);
    const r = findUntracked({ findings: [finding, { prNumber: 12, commentId: 400 }], failures: [] }, tracked);
    expect(r.findings.map((f) => f.commentId)).toEqual([400]);
  });

  test('no duplicates: second sweep with returned keys tracked returns nothing new', () => {
    const facts = { findings: [finding], failures: [failure] };
    const first = findUntracked(facts, new Set());
    const tracked = new Set([...first.findings, ...first.failures].map((x) => x.key));
    const second = findUntracked(facts, tracked);
    expect(first.findings).toHaveLength(1);
    expect(first.failures).toHaveLength(1);
    expect(second).toEqual({ findings: [], failures: [], invalid: [] });
  });

  test('clean merge creates nothing', () => {
    expect(findUntracked({ findings: [], failures: [] }, new Set())).toEqual({ findings: [], failures: [], invalid: [] });
  });

  test('CI failure becomes a regression item linking the run', () => {
    const r = findUntracked({ findings: [], failures: [failure] }, []);
    expect(r.failures).toHaveLength(1);
    expect(r.failures[0].checkRunId).toBe(999);
    expect(r.failures[0].key).toBe(failureKey(999));
  });

  test('failure not duplicated when recorded', () => {
    expect(findUntracked({ findings: [], failures: [failure] }, [failureKey(999)]).failures).toEqual([]);
  });

  test('dedupe key derives from ids, never text', () => {
    expect(findingKey(12, 345)).toBe(findingKey(12, 345));
    const a = findUntracked({ findings: [{ ...finding, body: 'A' }], failures: [] }, []);
    const b = findUntracked({ findings: [{ ...finding, body: 'completely different' }], failures: [] }, []);
    expect(a.findings[0].key).toBe(b.findings[0].key);
    expect(findingKey(12, 345)).not.toBe(findingKey(13, 345));
    expect(findingKey(12, 345)).not.toBe(findingKey(12, 346));
    expect(findingKey(12, 345)).not.toBe(failureKey(345));
  });

  test('same finding listed twice in one run is returned once', () => {
    expect(findUntracked({ findings: [finding, { ...finding }], failures: [] }, []).findings).toHaveLength(1);
  });

  test('resolved findings are not returned', () => {
    expect(findUntracked({ findings: [{ ...finding, resolved: true }], failures: [] }, []).findings).toEqual([]);
  });

  test('fails closed: unkeyable entries are reported, bad input throws', () => {
    const r = findUntracked({ findings: [{ prNumber: 1 }, null], failures: [{}] }, []);
    expect(r.invalid).toHaveLength(3);
    expect(r.findings).toEqual([]);
    expect(() => findUntracked(null, [])).toThrow(TypeError);
    expect(() => findUntracked({ findings: [], failures: 'x' }, [])).toThrow(TypeError);
    expect(() => findUntracked({ findings: [], failures: [] }, 'x')).toThrow(TypeError);
  });
});

describe('local-ci-sweep id shapes (kata mdfr review round 2)', () => {
  const credentialShaped = [
    ['sk', 'live', 'A1b2C3d4E5f6G7h8I9j0K1'].join('_'),
    ['glpat', 'A1b2C3d4E5f6G7h8I9j0K1'].join('-'),
    ['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiJ4In0', 'abc123_-DEF456xyz'].join('.'),
    `AIza${'A1b2C3d4E5'.repeat(3)}f6G7h`,
    ['ghp', 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8'].join('_'),
  ];

  test.each([[345], ['345'], [0], ['IC_kwDOA1b2C3d4'], ['PRRC_kwDOA1b2C3d4e5']])('%p is a comment or check run id and becomes part of the key as written', (id) => {
    expect(isId(id)).toBe(true);
    expect(findingKey(12, id)).toBe(`finding:pr12:comment${id}`);
    expect(failureKey(id)).toBe(`ci-failure:checkrun${id}`);
  });

  test.each([
    ...credentialShaped.map((value) => [value]),
    [''], ['bad id'], ['ic_kwDOabcdef'], ['IC_short'], ['1'.repeat(19)], [-1], [1.5], [null], [{}], ['../x'], ['12\n34'],
  ])('%p is not an id: no key is built from it', (value) => {
    expect(isId(value)).toBe(false);
    expect(findingKey(12, value)).toBeNull();
    expect(failureKey(value)).toBeNull();
  });

  test('a pull request number is a number or its digits: a node id is not one', () => {
    expect(isCount(12)).toBe(true);
    expect(isCount('12')).toBe(true);
    expect(isCount('IC_kwDOA1b2C3d4')).toBe(false);
    expect(findingKey('IC_kwDOA1b2C3d4', 345)).toBeNull();
    expect(findingKey('12', 345)).toBe('finding:pr12:comment345');
  });

  test('an invalid entry carries its kind and its position in its own list', () => {
    const r = findUntracked({ findings: [finding, { prNumber: 1 }, null], failures: [failure, { checkRunId: credentialShaped[0] }] }, []);
    expect(r.invalid.map(({ kind, index }) => [kind, index])).toEqual([['finding', 1], ['finding', 2], ['failure', 1]]);
    expect(r.findings).toHaveLength(1);
    expect(r.failures).toHaveLength(1);
  });
});

describe('hosted CI and background-work guarantees', () => {
  test('hosted CI still runs on push: pull_request and push triggers are unchanged', () => {
    const dir = path.join(__dirname, '..', '..', '..', '.github', 'workflows');
    for (const name of ['test.yml', 'validate.yml']) {
      const text = fs.readFileSync(path.join(dir, name), 'utf8');
      expect(text).toMatch(/^on:\n {2}pull_request:\n {2}push:\n {4}branches: \[main, dev\]\n/m);
    }
    for (const name of ['pi-generate.yml', 'generated-drift.yml', 'secret-scan.yml']) {
      const text = fs.readFileSync(path.join(dir, name), 'utf8');
      expect(text).toMatch(/^ {2}pull_request:$/m);
      expect(text).toMatch(/^ {2}push:$/m);
    }
  });

  test.each([
    ['sweep module', ['lib', 'local-ci-sweep.js']],
    ['CLI that runs the sweep', ['lib', 'local-ci-cli.js']],
    ['runner', ['lib', 'local-ci-runner.js']],
    ['gate skill', ['skills', 'local-ci-gate', 'SKILL.md']],
  ])('no background mechanism: %s has no timers, daemons, hooks or schedules', (_name, parts) => {
    const src = fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8').toLowerCase();
    for (const word of ['setinterval', 'settimeout', 'cron', 'schedule', 'daemon', 'watch', 'launchd', 'systemd']) {
      expect(src).not.toContain(word);
    }
  });

});
