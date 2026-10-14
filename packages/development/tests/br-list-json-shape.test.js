'use strict';

/**
 * REGRESSION (br-kk3, br-0ho): `br list --json` printed a bare array in older
 * versions and prints `{ issues: [...], total, limit, offset, has_more }` since
 * br 0.2.x (`br ready --json` still prints a bare array). Command snippets that
 * assumed the bare array threw (`data.filter is not a function`) or, worse, quietly
 * counted zero beads. And beads-build/beads-plan only recognised an epic id that
 * looked like `beads-NNN`, so a repo with any other prefix got a false "no epic found".
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const COMMANDS = path.join(__dirname, '..', 'commands');
const read = (f) => fs.readFileSync(path.join(COMMANDS, f), 'utf8');

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

describe('implement-trd-beads trd_progress() snippet', () => {
  // Pull the documented `node -e '...'` body out of the command and run it as written.
  const script = read('implement-trd-beads.yaml').match(
    /counts=\$\(node -e '([\s\S]*?)' "\$issues_json" "\$slug"\)/
  );

  test('the snippet is present in the command', () => {
    expect(script).not.toBeNull();
  });

  test.each(SHAPES)('counts beads for the slug from a %s', (_name, payload) => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'br-shape-')), 'issues.json');
    fs.writeFileSync(file, JSON.stringify(payload));
    try {
      const out = execFileSync(process.execPath, ['-e', script[1], file, 'demo'], { encoding: 'utf8' });
      expect(out.trim()).toBe('3 1 1 1 33.3'); // total closed in_progress open pct
    } finally {
      fs.rmSync(path.dirname(file), { recursive: true, force: true });
    }
  });
});

describe('trd-cli getBeadCounts (used by list and status)', () => {
  // getBeadCounts shells out to `br list --all --json`; stand in for br's output.
  function countsFrom(payload) {
    let counts;
    jest.isolateModules(() => {
      jest.doMock('child_process', () => ({
        ...jest.requireActual('child_process'),
        execSync: () => Buffer.from(JSON.stringify(payload)),
      }));
      counts = require('../lib/trd-cli').getBeadCounts('demo');
    });
    jest.dontMock('child_process');
    return counts;
  }

  test.each(SHAPES)('counts beads from a %s', (_name, payload) => {
    expect(countsFrom(payload)).toEqual({ total: 3, open: 1, in_progress: 1, closed: 1 });
  });
});

describe('command prose does not assume a bare array', () => {
  const FILES = ['implement-trd-beads', 'beads-build', 'beads-plan', 'requirement-status', 'verify-requirements'];

  test.each(FILES)('%s.yaml never tells the reader to parse a "JSON array"', (name) => {
    expect(read(`${name}.yaml`)).not.toMatch(/parse (a )?json array/i);
  });

  test('requirement-status does not reject output that does not start with "["', () => {
    expect(read('requirement-status.yaml')).not.toMatch(/starts with '\['/);
  });

  test.each(['beads-build', 'beads-plan'])('%s.yaml states the .issues unwrap rule', (name) => {
    expect(read(`${name}.yaml`)).toMatch(/otherwise its `?\.issues`? (array|property)/);
  });
});

describe('beads-build and beads-plan epic id detection', () => {
  test.each(['beads-build', 'beads-plan'])(
    '%s.yaml confirms an epic id with br show, not a "beads-NNN" pattern',
    (name) => {
      const text = read(`${name}.yaml`);
      expect(text).not.toMatch(/matches pattern beads-NNN/);
      expect(text).toMatch(/br show <first-token>/);
    }
  );
});
