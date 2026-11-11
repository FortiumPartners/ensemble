'use strict';

/**
 * REGRESSION (br-kk3, br-0ho): `br list --json` printed a bare array in older
 * versions and prints `{ issues: [...], total, limit, offset, has_more }` since
 * br 0.2.x (`br ready --json` still prints a bare array). Command snippets that
 * assumed the bare array threw (`data.filter is not a function`) or, worse, quietly
 * counted zero beads. And beads-build only recognised an epic id that
 * looked like `beads-NNN`, so a repo with any other prefix got a false "no epic found".
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const yaml = require('js-yaml');
const { readCommandProse } = require('../../../scripts/lib/skill-backed-command');

const COMMANDS = path.join(__dirname, '..', 'commands');
// A skill-backed command's YAML is a manifest; its prompt is in its skill (SKILL.md + references/),
// so the prose assertions read the manifest plus that skill. Non-skill-backed files read as before.
const read = (f) => {
  const file = path.join(COMMANDS, f);
  const raw = fs.readFileSync(file, 'utf8');
  return readCommandProse(file, yaml.load(raw), raw);
};

const ISSUES = [
  { id: 't-1', title: '[trd:demo:task:TRD-001] first', status: 'closed' },
  { id: 't-2', title: '[trd:demo:task:TRD-002] second', status: 'in_progress' },
  { id: 't-3', title: '[trd:demo:task:TRD-003] third', status: 'open' },
  { id: 't-4', title: '[trd:other:task:TRD-001] unrelated', status: 'open' },
];
const wrapped = (issues) => ({ issues, total: issues.length, limit: 0, offset: 0, has_more: false });
const SHAPES = [
  ['bare array (older br, br ready)', ISSUES],
  ['wrapped object (br 0.2.x list)', wrapped(ISSUES)],
];

describe('trd-cli getBeadCounts (used by list and status)', () => {
  // getBeadCounts shells out to `br list --all --json`; stand in for br's output.
  function countsFrom(payload) {
    let counts;
    jest.isolateModules(() => {
      jest.doMock('../lib/toolchain/runner', () => ({
        ...jest.requireActual('../lib/toolchain/runner'),
        runCapabilitySync: () => ({ ok: true, data: JSON.stringify(payload) }),
      }));
      counts = require('../lib/trd-cli').getBeadCounts('demo');
    });
    jest.dontMock('../lib/toolchain/runner');
    return counts;
  }

  test.each(SHAPES)('counts beads from a %s', (_name, payload) => {
    expect(countsFrom(payload)).toEqual({ total: 3, open: 1, in_progress: 1, closed: 1 });
  });
});

describe('command prose does not assume a bare array', () => {
  const FILES = ['implement-trd-beads', 'beads-build', 'requirement-status', 'verify-requirements'];

  test.each(FILES)('%s.yaml never tells the reader to parse a "JSON array"', (name) => {
    expect(read(`${name}.yaml`)).not.toMatch(/parse (a )?json array/i);
  });

  test('requirement-status does not reject output that does not start with "["', () => {
    expect(read('requirement-status.yaml')).not.toMatch(/starts with '\['/);
  });

  test.each(['beads-build'])('%s.yaml states the .issues unwrap rule', (name) => {
    expect(read(`${name}.yaml`)).toMatch(/array or its `?\.issues`?/);
  });
});

describe('beads-build epic id detection', () => {
  test.each(['beads-build'])(
    '%s.yaml confirms an epic id with tracker.show, not a "beads-NNN" pattern',
    (name) => {
      const text = read(`${name}.yaml`);
      expect(text).not.toMatch(/matches pattern beads-NNN/);
      expect(text).toMatch(/run tracker\.show --arg id=<RAW_INPUT>/);
    }
  );
});
