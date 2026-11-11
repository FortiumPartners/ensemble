'use strict';

/**
 * Review round 4 of kata n350 ("two writers"). A delta round runs `carry reconcile` (step 6 of the carry procedure) and then
 * the clear verb on the ledger reconcile answered. Reconcile used to clear a finding from the delta's hunks alone, at the line
 * numbers the ledger holds, with an exact `locationOrLink` + `failureMode` match of the observations as its only guard. Three
 * real rounds in which the defect was STILL THERE therefore came out `cleared` before the verb ran; the verb reported
 * `already-cleared` and could not take the mark back, the gate stopped blocking the finding and the bead recorder closed its
 * bead:
 *
 *   S1  a round the verb skipped shifted the line (the defect moved from 25 to 45), then an unrelated edit landed on 25;
 *   S2  a force-push replaced the head the finding was raised at, and the rebuilt head edits line 25, defect kept;
 *   S3  a partial fix edits the cited line, the defect remains, a reviewer raises it again and the verifiers vote it present.
 *
 * Real git, the real `carry reconcile` action and the real verb. Reconcile writes no mark now: the verb is the one writer.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { HANDLERS } = require('../lib/pr-review-cli');
const { deriveCleared } = require('../lib/pr-review-clear-cli');
const { defaultGit } = require('../lib/review-record-runtime');
const { isActionable } = require('../lib/pr-review-ledger');

const roots = [];
afterAll(() => {
  for (const r of roots) fs.rmSync(r, { recursive: true, force: true });
});

// Never inherit a GIT_* variable (GIT_DIR, GIT_WORK_TREE, ...) from the process running the tests.
const ENV = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))), GIT_TERMINAL_PROMPT: '0' };

function sh(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: ENV });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout.trim();
}

function fresh(name) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `prr-twowriters-${name}-`)));
  roots.push(dir);
  sh(dir, ['init', '-q', '-b', 'main']);
  sh(dir, ['config', 'user.name', 'T']);
  sh(dir, ['config', 'user.email', 't@example.com']);
  sh(dir, ['config', 'commit.gpgsign', 'false']);
  return dir;
}

function put(dir, rel, lines) {
  const file = path.join(dir, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${lines.join('\n')}\n`);
}

function commit(dir, message) {
  sh(dir, ['add', '-A']);
  sh(dir, ['commit', '-q', '--allow-empty', '-m', message]);
  return sh(dir, ['rev-parse', 'HEAD']);
}

const DEFECT = 'return items[idx]; // DEFECT: unchecked index';
const foo40 = () => Array.from({ length: 40 }, (_, i) => (i === 24 ? DEFECT : `// line ${i + 1}`));

/** The old-side lines each file's hunks touch between two heads, as an orchestrator reads them off `delta.diff`. */
function changedLocations(dir, from, to) {
  return sh(dir, ['diff', '--name-only', from, to])
    .split('\n')
    .filter(Boolean)
    .map((file) => {
      const lines = [];
      for (const row of sh(dir, ['diff', '--unified=0', '--no-color', '--no-ext-diff', from, to, '--', file]).split('\n')) {
        const hunk = /^@@ -(\d+)(?:,(\d+))? \+\d+(?:,\d+)? @@/.exec(row);
        if (hunk) for (let i = 0; i < (hunk[2] === undefined ? 1 : Number(hunk[2])); i += 1) lines.push(Number(hunk[1]) + i);
      }
      return { path: file, lines };
    });
}

/** S1: H1 (a round the verb was not run at) inserts 20 lines above the defect, H2 edits H1's line 25, an unrelated line. */
function buildS1() {
  const dir = fresh('s1');
  put(dir, 'README.md', ['base']);
  const base = commit(dir, 'base');
  put(dir, 'src/foo.js', foo40());
  const H0 = commit(dir, 'add foo with the defect on line 25');
  const first = foo40();
  const shifted = [...first.slice(0, 10), ...Array.from({ length: 20 }, (_, i) => `// inserted ${i + 1}`), ...first.slice(10)];
  put(dir, 'src/foo.js', shifted);
  const H1 = commit(dir, 'insert twenty lines above the defect (the round the verb skipped)');
  const edited = [...shifted];
  edited[24] = '// inserted 15 (edited)';
  put(dir, 'src/foo.js', edited);
  const head = commit(dir, 'an unrelated edit at H1 line 25');
  return { dir, base, H0, lastReviewed: H1, head, incoming: [], outcome: 'unverified', reason: 'location-unchanged', movedTo: 'src/foo.js:45' };
}

/** S2: H0 is replaced by a force-push; the rebuilt head H2 edits line 25 and keeps the defect. */
function buildS2() {
  const dir = fresh('s2');
  put(dir, 'README.md', ['base']);
  const base = commit(dir, 'base');
  put(dir, 'src/foo.js', foo40());
  const H0 = commit(dir, 'add foo with the defect (the head the finding was raised at)');
  sh(dir, ['reset', '-q', '--hard', base]);
  put(dir, 'src/foo.js', foo40());
  commit(dir, 'add foo with the defect (re-created after the force-push)');
  put(dir, 'README.md', ['base', 'round 2']);
  const H1 = commit(dir, 'round 2 head');
  const edited = foo40();
  edited[24] = `${DEFECT} (reviewed)`;
  put(dir, 'src/foo.js', edited);
  const head = commit(dir, 'edit line 25, the defect remains');
  return { dir, base, H0, lastReviewed: H1, head, incoming: [], outcome: 'unverified', reason: 'location-unanchored', movedTo: 'src/foo.js:25' };
}

/** S3: H1 edits the cited line, the defect remains, and the review raises it again. */
function buildS3() {
  const dir = fresh('s3');
  put(dir, 'README.md', ['base']);
  const base = commit(dir, 'base');
  put(dir, 'src/foo.js', foo40());
  const H0 = commit(dir, 'add foo with the defect');
  const partial = foo40();
  partial[24] = 'return items[i]; // DEFECT: unchecked index';
  put(dir, 'src/foo.js', partial);
  const head = commit(dir, 'rename the index variable, the defect remains');
  return {
    dir,
    base,
    H0,
    lastReviewed: H0,
    head,
    outcome: 'present',
    incoming: [{ id: 'F-2', severity: 'Important', source: 'reviewer-b', failureMode: 'unchecked index', locationOrLink: 'src/foo.js:25' }],
    reason: 're-reported',
    movedTo: 'src/foo.js:25'
  };
}

const entryOf = (s) => ({ id: 'F-1', severity: 'Important', source: 'reviewer-a', failureMode: 'unchecked index', locationOrLink: 'src/foo.js:25', headSha: s.H0 });

// The two shapes an observation can have: the fields the votes contract names (ledger-and-verification.md), which carry
// neither `locationOrLink` nor `failureMode`, and the ledger entry echoed back.
const votesShape = (e, outcome) => ({ id: e.id, severity: e.severity, source: e.source, mergedFrom: [], votes: [{ verifier: 'v1', verdict: 'real' }], outcome, presented: true });
const echoShape = (e, outcome) => ({ ...e, outcome, presented: true });

const scenarios = {};
beforeAll(() => {
  scenarios.S1 = buildS1();
  scenarios.S2 = buildS2();
  scenarios.S3 = buildS3();
});

const reconcile = (s, observations, ledger = [entryOf(s)]) =>
  HANDLERS.carry({ action: 'reconcile', ledger, changedLocations: changedLocations(s.dir, s.lastReviewed, s.head), headSha: s.head, observations });

const verb = (s, ledger) =>
  deriveCleared({ git: defaultGit(), cwd: s.dir, baseSha: s.base, headSha: s.head, lastReviewedSha: s.lastReviewed, ledger, incoming: s.incoming, now: () => 0 });

describe.each([
  ['S1 a skipped round shifted the line, then an unrelated edit landed on the old number', 'S1'],
  ['S2 a force-push replaced the head the finding was raised at', 'S2'],
  ['S3 a partial fix edits the cited line and the defect is raised again and voted present', 'S3']
])('%s', (_title, key) => {
  test('premise: the defect is still in the file at the head, and the delta touches the line the ledger holds', () => {
    const s = scenarios[key];
    expect(sh(s.dir, ['show', `${s.head}:src/foo.js`])).toContain('DEFECT: unchecked index');
    expect(changedLocations(s.dir, s.lastReviewed, s.head)).toEqual([{ path: 'src/foo.js', lines: [25] }]);
  });

  test.each([
    ['the votes contract fields', (s) => [votesShape(entryOf(s), s.outcome)]],
    ['the ledger entry echoed back', (s) => [echoShape(entryOf(s), s.outcome)]],
    ['no observation at all', () => []]
  ])('reconcile writes no mark, whatever the observations are (%s)', (_shape, observations) => {
    const s = scenarios[key];
    const out = reconcile(s, observations(s));
    expect(out.ok).toBe(true);
    expect(out.cleared).toEqual([]);
    expect(out.ledger).toHaveLength(1);
    expect(out.ledger[0].cleared).toBeUndefined();
    expect(out.ledger[0].clearedBy).toBeUndefined();
  });

  test('the documented order (reconcile, then the verb) keeps the finding open, for a reason that is about the defect', () => {
    const s = scenarios[key];
    const reconciled = reconcile(s, [votesShape(entryOf(s), s.outcome)]);
    const r = verb(s, reconciled.ledger);
    expect(r.ok).toBe(true);
    expect(r.cleared).toEqual([]);
    expect(r.kept).toEqual([{ id: 'F-1', reason: s.reason }]);
    expect(r.ledger[0].cleared).toBeUndefined();
    expect(r.ledger[0].locationOrLink).toBe(s.movedTo);
    // What the gate and the bead recorder read: an open finding still blocks, and nothing marks it fixed.
    expect(isActionable(r.ledger[0])).toBe(true);
  });

  test('the verb alone reaches the same answer, so reconcile in front of it changes nothing', () => {
    const s = scenarios[key];
    const alone = verb(s, [entryOf(s)]);
    const reconciled = reconcile(s, [votesShape(entryOf(s), s.outcome)]);
    const both = verb(s, reconciled.ledger);
    expect(both.kept).toEqual(alone.kept);
    expect(both.cleared).toEqual(alone.cleared);
    expect(both.ledger[0]).toMatchObject({ id: 'F-1', locationOrLink: alone.ledger[0].locationOrLink });
  });
});

describe('what is left of reconcile', () => {
  test('a mark already on an entry stays (reconcile neither writes nor removes one)', () => {
    const s = scenarios.S3;
    const already = { ...entryOf(s), cleared: true, clearedBy: s.head, clearedReason: 'location-changed' };
    const out = reconcile(s, [], [already]);
    expect(out.cleared).toEqual([]);
    expect(out.ledger[0]).toMatchObject({ cleared: true, clearedBy: s.head });
  });

  test('the ledger comes back read into the current taxonomy', () => {
    const s = scenarios.S3;
    const out = reconcile(s, [], [entryOf(s)]);
    expect(out.ledger[0]).toMatchObject({ id: 'F-1', severity: 'important', severityRecognised: true, preExisting: false });
  });
});
