'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { main, deriveCleared } = require('../lib/pr-review-clear-cli');
const { defaultGit } = require('../lib/review-record-runtime');

const CLI = path.join(__dirname, '..', 'lib', 'pr-review-clear-cli.js');
const roots = [];

// The fixture repositories must never see a GIT_* variable (GIT_DIR, GIT_WORK_TREE, GIT_INDEX_FILE, ...) of the process that
// runs the tests: the verb strips them from its own git child, and so does this helper.
const GIT_ENV = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))), GIT_TERMINAL_PROMPT: '0' };

function sh(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: GIT_ENV });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout.trim();
}

function commit(dir, files, message, remove = []) {
  for (const [name, content] of Object.entries(files)) {
    const full = path.join(dir, name);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  for (const name of remove) fs.unlinkSync(path.join(dir, name));
  sh(dir, ['add', '-A']);
  sh(dir, ['commit', '-q', '-m', message]);
  return sh(dir, ['rev-parse', 'HEAD']);
}

const numbered = (n, replace = {}) => Array.from({ length: n }, (_, i) => replace[i + 1] || `line ${i + 1}`).join('\n') + '\n';

const deepFreeze = (value) => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
};

const finding = (id, locationOrLink, failureMode, extra = {}) => ({
  id,
  source: 'reviewer',
  locationOrLink,
  severity: 'important',
  failureMode,
  disposition: 'fix',
  evidence: `evidence ${id}`,
  originalTextOrLink: `https://example.test/${id}`,
  ...extra
});

let dir;
let base;
let p1;
let p2;
let p3;
let old;
let unrelated;

beforeAll(() => {
  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'prr-clear-')));
  roots.push(dir);
  sh(dir, ['init', '-q', '-b', 'main']);
  sh(dir, ['config', 'user.name', 'T']);
  sh(dir, ['config', 'user.email', 't@example.com']);
  sh(dir, ['config', 'commit.gpgsign', 'false']);
  base = commit(dir, { 'README.md': 'base\n' }, 'base');
  p1 = commit(dir, { 'src/widget.js': numbered(30), 'src/other.js': numbered(5), 'src/doomed.js': numbered(4) }, 'p1');
  // The PR head after a "fix": line 12 edited, two lines inserted above it, a file deleted.
  const edited = numbered(30, { 12: 'CHANGED 12' }).replace('line 2\n', 'line 2\nins a\nins b\n');
  p2 = commit(dir, { 'src/widget.js': edited }, 'p2', ['src/doomed.js']);
  // A history that replaced P1 (force-push): not an ancestor of p2.
  sh(dir, ['checkout', '-q', '-b', 'old', p1]);
  old = commit(dir, { 'src/widget.js': numbered(30, { 12: 'OTHER' }) }, 'old');
  sh(dir, ['checkout', '-q', '--orphan', 'unrelated']);
  sh(dir, ['rm', '-rf', '-q', '.']);
  unrelated = commit(dir, { 'z.txt': 'z\n' }, 'unrelated');
  sh(dir, ['checkout', '-q', 'main']);
  // A later PR head that edits another file only: the finding's own file is untouched between p2 and p3.
  p3 = commit(dir, { 'src/other.js': numbered(5, { 3: 'CHANGED OTHER 3' }) }, 'p3');
});

afterAll(() => {
  for (const r of roots) fs.rmSync(r, { recursive: true, force: true });
});

const derive = (ledger, extra = {}) =>
  deriveCleared({ git: defaultGit(), cwd: dir, baseSha: base, headSha: p2, ledger, incoming: [], now: () => 0, ...extra });

const reasonOf = (result, id) => result.kept.find((k) => k.id === id).reason;

describe('deriveCleared rules', () => {
  test('1 already cleared is unchanged', () => {
    const e = finding('a', 'src/widget.js:12', 'bad', { headSha: p1, cleared: true, clearedBy: 'f'.repeat(40) });
    const r = derive([e]);
    expect(r.kept).toEqual([{ id: 'a', reason: 'already-cleared' }]);
    expect(r.ledger).toEqual([e]);
  });

  test('2 no readable recorded head is kept', () => {
    const r = derive([
      finding('none', 'src/widget.js:12', 'bad'),
      finding('junk', 'src/widget.js:12', 'bad', { headSha: 'main' }),
      finding('gone', 'src/widget.js:12', 'bad', { headSha: 'deadbeefdeadbeef' }),
      finding('num', 'src/widget.js:12', 'bad', { headSha: 7 })
    ]);
    expect(r.kept.map((k) => k.reason)).toEqual(['no-recorded-head', 'no-recorded-head', 'no-recorded-head', 'no-recorded-head']);
    expect(r.cleared).toEqual([]);
  });

  test('3 recorded at this very head is kept, also by abbreviation', () => {
    const r = derive([finding('a', 'src/widget.js:12', 'bad', { headSha: p2 }), finding('b', 'src/widget.js:12', 'bad', { headSha: p2.slice(0, 10) })]);
    expect(r.kept.map((k) => k.reason)).toEqual(['recorded-at-this-head', 'recorded-at-this-head']);
  });

  test('4 a head in base history, a force-pushed old head and an unrelated head are kept', () => {
    const r = derive([
      finding('base', 'src/widget.js:12', 'bad', { headSha: base }),
      finding('old', 'src/widget.js:12', 'bad', { headSha: old }),
      finding('unrel', 'src/widget.js:12', 'bad', { headSha: unrelated })
    ]);
    expect(r.kept.map((k) => k.reason)).toEqual(['recorded-head-not-on-pr', 'recorded-head-not-on-pr', 'recorded-head-not-on-pr']);
    expect(r.cleared).toEqual([]);
  });

  test('5 a defect re-reported two lines lower after the shift is re-reported, not cleared', () => {
    const e = finding('shift', 'src/widget.js:12', 'Off by one in loop', { headSha: p1 });
    const r = derive([e], { incoming: [finding('new', 'src/widget.js:14', 'off by one in loop!')] });
    expect(r.kept).toEqual([{ id: 'shift', reason: 're-reported' }]);
    expect(r.cleared).toEqual([]);
    expect(r.ledger[0]).toEqual({ ...e, locationOrLink: 'src/widget.js:14', locationAsOf: p2 });
  });

  test('5 without a fingerprint the same location and failure mode counts', () => {
    const a = finding('a', 'https://example.test/pr/1#c', 'same words', { headSha: p1 });
    const r = derive([a], { incoming: [{ ...a, id: 'b' }] });
    expect(r.kept).toEqual([{ id: 'a', reason: 're-reported' }]);
  });

  test('5 a different failure mode at the same place is not a re-report', () => {
    const e = finding('a', 'src/widget.js:12', 'Off by one', { headSha: p1 });
    const r = derive([e], { incoming: [finding('n', 'src/widget.js:12', 'Null dereference')] });
    expect(r.cleared.map((c) => c.id)).toEqual(['a']);
  });

  test('6 a finding citing no file is kept', () => {
    const r = derive([finding('link', 'https://example.test/pr/1#c', 'bad', { headSha: p1 })]);
    expect(r.kept).toEqual([{ id: 'link', reason: 'no-location' }]);
  });

  test('7 an untouched location is kept; a diff git cannot produce is diff-failed', () => {
    const untouched = finding('u', 'src/other.js:3', 'bad', { headSha: p1 });
    const lineOnly = finding('l', 'src/widget.js:20', 'bad', { headSha: p1 });
    const r = derive([untouched, lineOnly]);
    expect(r.kept).toEqual([
      { id: 'u', reason: 'location-unchanged' },
      { id: 'l', reason: 'location-unchanged' }
    ]);

    const real = defaultGit();
    const failing = (args, opts) => (args.includes('diff') ? { status: 128, stdout: '', stderr: 'boom' } : real(args, opts));
    const f = derive([finding('d', 'src/widget.js:12', 'bad', { headSha: p1 })], { git: failing });
    expect(f.kept).toEqual([{ id: 'd', reason: 'diff-failed' }]);
  });

  test('8 an edited line clears with the full head id and the ledger mark shape', () => {
    const e = finding('hit', 'src/widget.js:12', 'bad', { headSha: p1.slice(0, 12), custom: { keep: 1 } });
    const r = derive([e]);
    expect(r.cleared).toEqual([{ id: 'hit', clearedBy: p2, recordedAt: '1970-01-01T00:00:00.000Z' }]);
    expect(r.kept).toEqual([]);
    expect(r.ledger[0]).toEqual({ ...e, cleared: true, clearedBy: p2, clearedReason: 'location-changed' });
    expect(r.headSha).toBe(p2);
  });

  test('8 a finding in a deleted file and a file-only citation clear; an unchanged file-only one is kept', () => {
    const r = derive([
      finding('del', 'src/doomed.js:2', 'bad', { headSha: p1 }),
      finding('fileonly', 'src/widget.js', 'bad', { headSha: p1 }),
      finding('same', 'src/other.js', 'bad', { headSha: p1 })
    ]);
    expect(r.cleared.map((c) => c.id)).toEqual(['del', 'fileonly']);
    expect(r.kept).toEqual([{ id: 'same', reason: 'location-unchanged' }]);
  });

  test('a cited file the head does not hold is kept location-unanchored, never location-unchanged: an empty diff does not say a line stayed put in a file that is not there (kata p5dt)', () => {
    const r = derive([
      finding('ghost', 'src/never-there.js:2', 'bad', { headSha: p1 }),
      finding('ghostfile', 'src/never-there.js', 'bad', { headSha: p1 }),
      finding('same', 'src/other.js:2', 'bad', { headSha: p1 })
    ]);
    expect(r.cleared).toEqual([]);
    expect(r.kept).toEqual([{ id: 'ghost', reason: 'location-unanchored' }, { id: 'ghostfile', reason: 'location-unanchored' }, { id: 'same', reason: 'location-unchanged' }]);
    // as recorded: neither moved nor stamped
    expect(r.ledger[0]).toEqual(finding('ghost', 'src/never-there.js:2', 'bad', { headSha: p1 }));
  });

  test('a changed line OTHER than the cited one does not clear a line-anchored finding', () => {
    const r = derive([finding('x', 'src/widget.js:13', 'bad', { headSha: p1 })]);
    expect(r.kept).toEqual([{ id: 'x', reason: 'location-unchanged' }]);
  });
});

describe('deriveCleared whole-ledger properties', () => {
  const ledger = () => [
    finding('hit', 'src/widget.js:12', 'bad', { headSha: p1 }),
    finding('keep', 'src/other.js:3', 'bad', { headSha: p1 }),
    finding('nohead', 'src/widget.js:12', 'bad'),
    finding('basehist', 'src/widget.js:12', 'bad', { headSha: base, odd: ' spaced ' }),
    finding('del', 'src/doomed.js:2', 'bad', { headSha: p1 })
  ];

  test('same length and order; kept entries are returned as given', () => {
    const input = ledger();
    const r = derive(input);
    expect(r.ledger.map((e) => e.id)).toEqual(['hit', 'keep', 'nohead', 'basehist', 'del']);
    expect(r.cleared.map((c) => c.id)).toEqual(['hit', 'del']);
    expect(r.ledger[1]).toEqual({ ...input[1], locationAsOf: p2 });
    expect(r.ledger[3]).toEqual(input[3]);
    expect(r.ledger[0].cleared).toBe(true);
    expect(r.ledger[1].cleared).toBeUndefined();
  });

  test('idempotent: a second run over its own output changes nothing', () => {
    const first = derive(ledger());
    const second = derive(first.ledger);
    expect(second.ledger).toEqual(first.ledger);
    expect(second.cleared).toEqual([]);
    expect(reasonOf(second, 'hit')).toBe('already-cleared');
  });

  test('never mutates a deep-frozen input', () => {
    const input = deepFreeze(ledger());
    const incoming = deepFreeze([finding('n', 'src/other.js:1', 'x')]);
    expect(() => derive(input, { incoming })).not.toThrow();
  });

  test('failures: head or base not a commit, head not descending from base', () => {
    expect(derive([], { headSha: 'a'.repeat(40) })).toEqual({ ok: false, status: 'FAILED', reason: 'headSha is not a commit of this repository' });
    expect(derive([], { baseSha: 'a'.repeat(40) })).toEqual({ ok: false, status: 'FAILED', reason: 'baseSha is not a commit of this repository' });
    expect(derive([], { headSha: unrelated }).reason).toBe('headSha does not descend from baseSha');
    expect(derive([], { baseSha: p2, headSha: p1 }).reason).toBe('headSha does not descend from baseSha');
  });

  test('never writes: HEAD, refs, status and the index are identical after a run', () => {
    const snap = () => ({
      head: sh(dir, ['rev-parse', 'HEAD']),
      refs: sh(dir, ['for-each-ref']),
      status: sh(dir, ['status', '--porcelain']),
      index: fs.readFileSync(path.join(dir, '.git', 'index')).toString('hex')
    });
    const before = snap();
    derive(ledger());
    expect(snap()).toEqual(before);
  });
});

describe('main', () => {
  const run = (payload, io = {}) => {
    const out = [];
    const code = main({ readJson: () => payload, emit: (v) => out.push(v), now: () => 5, ...io });
    return { code, result: out[0] };
  };
  const good = () => ({ repoRoot: dir, baseSha: base, headSha: p2, ledger: [finding('hit', 'src/widget.js:12', 'bad', { headSha: p1 })], incoming: [] });
  const noHead = () => ({ ...good(), ledger: [finding('hit', 'src/widget.js:12', 'bad')] });

  test('exit 0 with a DERIVED result and wallMs', () => {
    const { code, result } = run(good());
    expect(code).toBe(0);
    expect(result).toMatchObject({ ok: true, status: 'DERIVED', headSha: p2, wallMs: 0 });
    expect(result.cleared.map((c) => c.id)).toEqual(['hit']);
  });

  test('incoming is required: omitted it is FAILED and nothing is derived; given it is used', () => {
    const { incoming, ...without } = good();
    expect(incoming).toEqual([]);
    const failed = run(without);
    expect(failed.code).toBe(1);
    expect(failed.result).toMatchObject({ ok: false, status: 'FAILED' });
    expect(failed.result.reason).toMatch(/'incoming' is required/);
    expect(failed.result.ledger).toBeUndefined();
    const payload = { ...good(), incoming: [finding('n', 'src/widget.js:14', 'bad')] };
    expect(run(payload).result.kept).toEqual([{ id: 'hit', reason: 're-reported' }]);
  });

  test('lastReviewedSha is the baseline of an entry that carries no head, and is optional', () => {
    expect(run(noHead()).result.kept).toEqual([{ id: 'hit', reason: 'no-recorded-head' }]);
    const { code, result } = run({ ...noHead(), lastReviewedSha: p1 });
    expect(code).toBe(0);
    expect(result.cleared.map((c) => c.id)).toEqual(['hit']);
  });

  test('exit 1 FAILED for bad input, in validation order, with nothing partial', () => {
    const cases = [
      [null, /JSON object/],
      [[], /JSON object/],
      [{ ...good(), repoRoot: undefined }, /repoRoot/],
      [{ ...good(), repoRoot: '  ' }, /repoRoot/],
      [{ ...good(), baseSha: 'abc' }, /baseSha/],
      [{ ...good(), headSha: 'abc' }, /headSha/],
      [{ ...good(), ledger: {} }, /ledger/],
      [{ ...good(), ledger: [1] }, /ledger/],
      [{ ...good(), incoming: 'x' }, /incoming/],
      [{ ...good(), lastReviewedSha: 'abc' }, /lastReviewedSha/],
      [{ ...good(), lastReviewedSha: null }, /lastReviewedSha/],
      [{ ...good(), repoRoot: path.join(dir, 'src') }, /not a git repository root/],
      [{ ...good(), headSha: 'a'.repeat(40) }, /not a commit/],
      [{ ...good(), headSha: unrelated }, /does not descend/]
    ];
    for (const [payload, pattern] of cases) {
      const { code, result } = run(payload);
      expect(code).toBe(1);
      expect(result.ok).toBe(false);
      expect(result.status).toBe('FAILED');
      expect(result.reason).toMatch(pattern);
      expect(result.ledger).toBeUndefined();
    }
  });

  test('invalid JSON is a failure', () => {
    const out = [];
    const code = main({
      readJson: () => {
        throw new Error('nope');
      },
      emit: (v) => out.push(v)
    });
    expect(code).toBe(1);
    expect(out[0].reason).toMatch(/invalid JSON/);
  });

  test('uses an injected git', () => {
    const calls = [];
    const git = (args) => {
      calls.push(args);
      return { status: 128, stdout: '', stderr: '' };
    };
    const { code, result } = run(good(), { git });
    expect(code).toBe(1);
    expect(result.reason).toMatch(/not a commit/);
    expect(calls.length).toBeGreaterThan(0);
  });
});

describe('lastReviewedSha: the one baseline every carried entry shares', () => {
  test('an entry with no head of its own is compared from lastReviewedSha; without it that entry is kept', () => {
    const e = finding('a', 'src/widget.js:12', 'bad');
    const r = derive([e], { lastReviewedSha: p1 });
    expect(r.cleared).toEqual([{ id: 'a', clearedBy: p2, recordedAt: '1970-01-01T00:00:00.000Z' }]);
    expect(r.ledger[0]).toEqual({ ...e, cleared: true, clearedBy: p2, clearedReason: 'location-changed' });
    expect(derive([e]).kept).toEqual([{ id: 'a', reason: 'no-recorded-head' }]);
  });

  test('an edit the finding SURVIVED is not counted: it was alive at lastReviewedSha, so only what changed since can have fixed it', () => {
    // Raised at p1. p2 edited its line and the review of p2 raised it again, so it carried on. p3 touches another file only.
    const survivor = finding('survivor', 'src/widget.js:12', 'Off by one', { headSha: p1 });
    // From its own head the edit p2 made would count, so a delta review of p3 that cannot see line 12 would clear it.
    expect(derive([survivor], { headSha: p3 }).cleared.map((c) => c.id)).toEqual(['survivor']);
    const r = derive([survivor], { headSha: p3, lastReviewedSha: p2 });
    expect(r.cleared).toEqual([]);
    // The entry was never moved (the verb did not run at p2), so its line is numbered at p1 and the p1..p2 edit that
    // touched it leaves no place to look at: kept as unanchored and not stamped, where this pin used to assume the
    // stored number was valid at p2 (the old numbering-at-lastReviewedSha assumption).
    expect(r.kept).toEqual([{ id: 'survivor', reason: 'location-unanchored' }]);
    expect(r.ledger[0]).toEqual(survivor);
    // In the documented flow the verb ran at p2 and stamped the entry, and the outcome is the one this test always meant.
    const carried = derive([{ ...survivor, locationAsOf: p2 }], { headSha: p3, lastReviewedSha: p2 });
    expect(carried.cleared).toEqual([]);
    expect(carried.kept).toEqual([{ id: 'survivor', reason: 'location-unchanged' }]);
    expect(carried.ledger[0]).toEqual({ ...survivor, locationAsOf: p3 });
  });

  test('an edit made since lastReviewedSha clears, whatever head the entry carries', () => {
    const r = derive([finding('a', 'src/other.js:3', 'bad', { headSha: p1 })], { headSha: p3, lastReviewedSha: p2 });
    expect(r.cleared).toEqual([{ id: 'a', clearedBy: p3, recordedAt: '1970-01-01T00:00:00.000Z' }]);
  });

  test('lastReviewedSha equal to the head is the same head reviewed again: nothing clears', () => {
    const r = derive([finding('a', 'src/widget.js:12', 'bad')], { lastReviewedSha: p2 });
    expect(r.kept).toEqual([{ id: 'a', reason: 'recorded-at-this-head' }]);
    expect(r.cleared).toEqual([]);
  });

  test('a lastReviewedSha that is not on the PR keeps every entry, though its own head is', () => {
    const entries = [finding('a', 'src/widget.js:12', 'bad', { headSha: p1 }), finding('b', 'src/widget.js:12', 'bad')];
    for (const lastReviewedSha of [old, base, unrelated, 'a'.repeat(40)]) {
      const r = derive(entries, { lastReviewedSha });
      expect(r.kept).toEqual([
        { id: 'a', reason: 'recorded-head-not-on-pr' },
        { id: 'b', reason: 'recorded-head-not-on-pr' }
      ]);
      expect(r.cleared).toEqual([]);
    }
  });

  test('an entry stamped with this very head is never cleared by it', () => {
    const r = derive([finding('a', 'src/widget.js:12', 'bad', { headSha: p2 })], { lastReviewedSha: p1 });
    expect(r.kept).toEqual([{ id: 'a', reason: 'recorded-at-this-head' }]);
  });

  test('a re-report still keeps the entry', () => {
    const e = finding('a', 'src/widget.js:12', 'Off by one');
    const r = derive([e], { lastReviewedSha: p1, incoming: [finding('n', 'src/widget.js:14', 'off by one')] });
    expect(r.kept).toEqual([{ id: 'a', reason: 're-reported' }]);
    expect(r.ledger[0]).toEqual({ ...e, locationOrLink: 'src/widget.js:14', locationAsOf: p2 });
  });
});

describe('incoming is required (a re-raised finding must never read as a fixed one)', () => {
  test('an omitted or malformed incoming is FAILED with a named reason, whatever the diff says', () => {
    const e = finding('hit', 'src/widget.js:12', 'bad', { headSha: p1 });
    const omitted = deriveCleared({ git: defaultGit(), cwd: dir, baseSha: base, headSha: p2, ledger: [e], now: () => 0 });
    expect(omitted).toEqual({ ok: false, status: 'FAILED', reason: expect.stringMatching(/^'incoming' is required/) });
    for (const bad of [null, {}, 'x', 7, [1], [null], [[]]]) {
      const r = deriveCleared({ git: defaultGit(), cwd: dir, baseSha: base, headSha: p2, ledger: [e], incoming: bad, now: () => 0 });
      expect(r).toMatchObject({ ok: false, status: 'FAILED' });
      expect(r.cleared).toBeUndefined();
      expect(r.ledger).toBeUndefined();
    }
  });

  test('control: the same ledger with an explicit empty incoming clears the touched finding', () => {
    const e = finding('hit', 'src/widget.js:12', 'bad', { headSha: p1 });
    expect(derive([e], { incoming: [] }).cleared.map((c) => c.id)).toEqual(['hit']);
  });
});

describe('the cited line is carried forward through every round (a fix after an earlier edit above it is found)', () => {
  let w;
  let b0;
  let r1;
  let r2;
  let r3;
  let r3b;
  let r2d;
  let r3m;
  let r2e;
  let r3e;
  const withInserted = numbered(40).replace('line 3\n', 'line 3\nn1\nn2\nn3\nn4\nn5\n');
  const at = (extra) => deriveCleared({ git: defaultGit(), cwd: w, baseSha: b0, incoming: [], now: () => 0, ...extra });

  beforeAll(() => {
    w = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'prr-clear-shift-')));
    roots.push(w);
    sh(w, ['init', '-q', '-b', 'main']);
    sh(w, ['config', 'user.name', 'T']);
    sh(w, ['config', 'user.email', 't@example.com']);
    sh(w, ['config', 'commit.gpgsign', 'false']);
    b0 = commit(w, { 'README.md': 'base\n' }, 'base');
    // Round 1: the defect sits on line 20.
    r1 = commit(w, { 'src/a.js': numbered(40) }, 'r1');
    // Round 2: five lines are inserted above it, so it is on line 25.
    r2 = commit(w, { 'src/a.js': withInserted }, 'r2');
    // Round 3: the fix, on line 25 of round 2's numbering.
    r3 = commit(w, { 'src/a.js': withInserted.replace('line 20\n', 'FIXED\n') }, 'r3');
    // Round 3 instead: an unrelated edit at the number the defect used to have (round 2's line 20).
    sh(w, ['checkout', '-q', '-b', 'alt', r2]);
    r3b = commit(w, { 'src/a.js': withInserted.replace('line 15\n', 'EDITED\n') }, 'r3b');
    // A history that removed two lines above the defect instead of adding five.
    sh(w, ['checkout', '-q', '-b', 'del', r1]);
    r2d = commit(w, { 'src/a.js': numbered(40).replace('line 5\nline 6\n', '') }, 'r2d');
    // A round 2 that edited the defect's own line (the finding survived it), then a round 3.
    sh(w, ['checkout', '-q', '-b', 'edited', r1]);
    r2e = commit(w, { 'src/a.js': numbered(40).replace('line 20\n', 'line twenty\n') }, 'r2e');
    r3e = commit(w, { 'src/a.js': numbered(40).replace('line 20\n', 'line twenty\n').replace('line 30\n', 'line thirty\n') }, 'r3e');
    // A mode-only round 3: a chmod, no content change.
    sh(w, ['checkout', '-q', '-b', 'mode', r2]);
    fs.chmodSync(path.join(w, 'src/a.js'), 0o755);
    sh(w, ['add', '-A']);
    sh(w, ['commit', '-q', '-m', 'chmod']);
    r3m = sh(w, ['rev-parse', 'HEAD']);
    sh(w, ['checkout', '-q', 'main']);
  });

  test('round 2 moves the stored line to the head it reviewed; round 3 then finds the fix', () => {
    const e = finding('F', 'src/a.js:20', 'defect');
    const round2 = at({ headSha: r2, lastReviewedSha: r1, ledger: [e] });
    expect(round2.kept).toEqual([{ id: 'F', reason: 'location-unchanged' }]);
    expect(round2.ledger[0]).toEqual({ ...e, locationOrLink: 'src/a.js:25', locationAsOf: r2 });

    const round3 = at({ headSha: r3, lastReviewedSha: r2, ledger: round2.ledger });
    expect(round3.cleared).toEqual([{ id: 'F', clearedBy: r3, recordedAt: '1970-01-01T00:00:00.000Z' }]);
  });

  test('a mode-only commit clears nothing: a chmod touches no line', () => {
    const e = finding('F', 'src/a.js:25', 'defect', { locationAsOf: r2 });
    const r = at({ headSha: r3m, lastReviewedSha: r2, ledger: [e] });
    expect(r.cleared).toEqual([]);
    expect(r.kept).toEqual([{ id: 'F', reason: 'location-unchanged' }]);
  });

  test('an unrelated edit at the number the defect used to have no longer clears it', () => {
    const round2 = at({ headSha: r2, lastReviewedSha: r1, ledger: [finding('F', 'src/a.js:20', 'defect')] });
    const round3 = at({ headSha: r3b, lastReviewedSha: r2, ledger: round2.ledger });
    expect(round3.cleared).toEqual([]);
    expect(round3.kept).toEqual([{ id: 'F', reason: 'location-unchanged' }]);
    expect(round3.ledger[0]).toMatchObject({ locationOrLink: 'src/a.js:25', locationAsOf: r3b });
  });

  test('a first run that comes late (an earlier round was never run) still reads the entry at its own numbering, so the fix is found', () => {
    // Recorded at r1 on line 20 and never moved: the line is 25 at r2, the round the fix is compared from.
    const e = finding('F', 'src/a.js:20', 'defect', { headSha: r1 });
    const r = at({ headSha: r3, lastReviewedSha: r2, ledger: [e] });
    expect(r.cleared).toEqual([{ id: 'F', clearedBy: r3, recordedAt: '1970-01-01T00:00:00.000Z' }]);
    expect(r.ledger[0]).toMatchObject({ id: 'F', cleared: true, clearedBy: r3 });
  });

  test('a first run that comes late is not fooled by an unrelated edit at the number the defect used to have', () => {
    const e = finding('F', 'src/a.js:20', 'defect', { headSha: r1 });
    const r = at({ headSha: r3b, lastReviewedSha: r2, ledger: [e] });
    expect(r.cleared).toEqual([]);
    expect(r.kept).toEqual([{ id: 'F', reason: 'location-unchanged' }]);
    expect(r.ledger[0]).toMatchObject({ locationOrLink: 'src/a.js:25', locationAsOf: r3b });
  });

  test('a first run that comes late cannot place a line an in-between round edited: location-unanchored, never cleared, never stamped', () => {
    const e = finding('F', 'src/a.js:20', 'defect', { headSha: r1 });
    const r = at({ headSha: r3e, lastReviewedSha: r2e, ledger: [e] });
    expect(r.cleared).toEqual([]);
    expect(r.kept).toEqual([{ id: 'F', reason: 'location-unanchored' }]);
    expect(r.ledger[0]).toEqual(e);
  });

  test('a stamp the repository no longer holds is a numbering base that is not on the PR: kept, never cleared', () => {
    const e = finding('F', 'src/a.js:25', 'defect', { headSha: r1, locationAsOf: '3'.repeat(40) });
    const r = at({ headSha: r3, lastReviewedSha: r2, ledger: [e] });
    expect(r.kept).toEqual([{ id: 'F', reason: 'recorded-head-not-on-pr' }]);
    expect(r.cleared).toEqual([]);
  });

  test('a range citation moves as a range, and removed lines above pull the line up', () => {
    const ranged = at({ headSha: r2, lastReviewedSha: r1, ledger: [finding('R', 'src/a.js:20-22', 'defect')] });
    expect(ranged.ledger[0].locationOrLink).toBe('src/a.js:25-27');
    const pulled = at({ headSha: r2d, lastReviewedSha: r1, ledger: [finding('D', 'src/a.js:20', 'defect')] });
    expect(pulled.ledger[0]).toMatchObject({ locationOrLink: 'src/a.js:18', locationAsOf: r2d });
  });

  test('a re-raised finding takes the location the new review gave it', () => {
    const e = finding('F', 'src/a.js:20', 'Unchecked path join');
    const r = at({ headSha: r2, lastReviewedSha: r1, ledger: [e], incoming: [finding('N', 'src/a.js:25', 'unchecked path join!')] });
    expect(r.kept).toEqual([{ id: 'F', reason: 're-reported' }]);
    expect(r.ledger[0]).toEqual({ ...e, locationOrLink: 'src/a.js:25', locationAsOf: r2 });
  });

  test('a second run over the verb\'s own output changes nothing (the stamp says the line is current)', () => {
    const first = at({ headSha: r2, lastReviewedSha: r1, ledger: [finding('F', 'src/a.js:20', 'defect')] });
    const second = at({ headSha: r2, lastReviewedSha: r1, ledger: first.ledger });
    expect(second.kept).toEqual([{ id: 'F', reason: 'location-current' }]);
    expect(second.ledger).toEqual(first.ledger);
  });

  test('an entry the verb already moved is compared from the head it was moved to, whatever earlier head lastReviewedSha names', () => {
    const stamped = finding('F', 'src/a.js:25', 'defect', { locationAsOf: r2 });
    const r = at({ headSha: r3, lastReviewedSha: r1, ledger: [stamped] });
    expect(r.cleared.map((c) => c.id)).toEqual(['F']);
  });

  test('a file-only citation and a link carry no line to move and are returned as given', () => {
    const fileOnly = finding('A', 'src/a.js', 'defect');
    const link = finding('B', 'https://example.test/pr/1#c', 'defect');
    const r = at({ headSha: r2, lastReviewedSha: r1, ledger: [fileOnly, link] });
    expect(r.ledger[1]).toEqual(link);
    expect(r.ledger[0]).toEqual(fileOnly);
  });
});

describe('a force-push between rounds clears nothing (an entry raised at a head that left the PR is never judged against another baseline)', () => {
  let w;
  let b0;
  let dead;
  let s;
  let h;
  const top = 'top1\ntop2\ntop3\ntop4\ntop5\n';
  const at = (extra) => deriveCleared({ git: defaultGit(), cwd: w, baseSha: b0, incoming: [], now: () => 0, ...extra });
  const entryOf = (round, id = 'F') => round.ledger.find((e) => e.id === id);

  beforeAll(() => {
    w = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'prr-clear-force-')));
    roots.push(w);
    sh(w, ['init', '-q', '-b', 'main']);
    sh(w, ['config', 'user.name', 'T']);
    sh(w, ['config', 'user.email', 't@example.com']);
    sh(w, ['config', 'commit.gpgsign', 'false']);
    b0 = commit(w, { 'src/a.js': numbered(30) }, 'base');
    // Round 1 reviewed this head: the defect is on line 20.
    dead = commit(w, { 'src/a.js': numbered(30, { 20: 'DEFECT' }) }, 'round 1 head');
    // The author rebuilds the branch from the base and force-pushes: `dead` is no longer on the PR. The rebuilt head
    // carries the defect five lines lower (line 25), and round 2's review did not raise it again.
    sh(w, ['checkout', '-q', '-b', 'rebuilt', b0]);
    s = commit(w, { 'src/a.js': top + numbered(30, { 20: 'DEFECT' }) }, 'round 2 head (rebuilt)');
    // Round 3: an UNRELATED edit lands on line 20 (the number the defect had at `dead`); the defect is still on line 25.
    h = commit(w, { 'src/a.js': top + numbered(30, { 20: 'DEFECT', 15: 'unrelated edit' }) }, 'round 3 head');
    sh(w, ['checkout', '-q', 'main']);
  });

  const raisedAtDead = () => finding('F', 'src/a.js:20', 'defect', { headSha: dead });

  test('round 2 keeps the entry unstamped (its baseline, the dead head, is not on the PR); round 3 must not judge it by lastReviewedSha', () => {
    const e = raisedAtDead();
    const round2 = at({ headSha: s, lastReviewedSha: dead, ledger: [e] });
    expect(round2.kept).toEqual([{ id: 'F', reason: 'recorded-head-not-on-pr' }]);
    expect(entryOf(round2)).toEqual(e);

    const round3 = at({ headSha: h, lastReviewedSha: s, ledger: round2.ledger });
    expect(round3.cleared).toEqual([]);
    expect(round3.kept).toEqual([{ id: 'F', reason: 'location-unanchored' }]);
    expect(entryOf(round3)).toEqual(e);
  });

  test('an own head the repository no longer holds is no better: location-unanchored, never cleared', () => {
    for (const headSha of ['a'.repeat(40), 'not a commit', 12345]) {
      const r = at({ headSha: h, lastReviewedSha: s, ledger: [finding('F', 'src/a.js:20', 'defect', { headSha })] });
      expect(r.cleared).toEqual([]);
      expect(r.kept).toEqual([{ id: 'F', reason: 'location-unanchored' }]);
    }
  });

  test('a file-only citation is held the same way: the entry says nothing the verb can place', () => {
    const r = at({ headSha: h, lastReviewedSha: s, ledger: [finding('F', 'src/a.js', 'defect', { headSha: dead })] });
    expect(r.cleared).toEqual([]);
    expect(r.kept).toEqual([{ id: 'F', reason: 'location-unanchored' }]);
  });

  test('an entry the verb stamped at a head that has since left the PR is kept the same way: recorded-head-not-on-pr', () => {
    const stamped = finding('F', 'src/a.js:20', 'defect', { headSha: dead, locationAsOf: dead });
    const r = at({ headSha: h, lastReviewedSha: s, ledger: [stamped] });
    expect(r.cleared).toEqual([]);
    expect(r.kept).toEqual([{ id: 'F', reason: 'recorded-head-not-on-pr' }]);
    expect(r.ledger).toEqual([stamped]);
  });

  test('the entry is let go again once a review raises it: re-reported, stamped, and compared from there', () => {
    const r = at({ headSha: h, lastReviewedSha: s, ledger: [raisedAtDead()], incoming: [finding('N', 'src/a.js:25', 'defect')] });
    expect(r.kept).toEqual([{ id: 'F', reason: 're-reported' }]);
    expect(r.ledger[0]).toMatchObject({ locationOrLink: 'src/a.js:25', locationAsOf: h });
  });

  test('control: an entry with no head of its own is still compared from lastReviewedSha (that is its documented baseline)', () => {
    const r = at({ headSha: h, lastReviewedSha: s, ledger: [finding('F', 'src/a.js:20', 'defect')] });
    expect(r.cleared.map((c) => c.id)).toEqual(['F']);
  });
});

describe('a skipped round clears nothing it should not (the stamp is older than lastReviewedSha)', () => {
  let w;
  let b0;
  let s1;
  let yEdit;
  let hEdit;
  let yShift;
  let hFix;
  let hOther;
  let yGone;
  const inserted = numbered(40).replace('line 3\n', 'line 3\nn1\nn2\nn3\nn4\nn5\n');
  const at = (extra) => deriveCleared({ git: defaultGit(), cwd: w, baseSha: b0, incoming: [], now: () => 0, ...extra });
  /** What the verb left behind at round 1: the defect on line 20, stamped with that head. */
  const stampedAtS1 = () => finding('F', 'src/a.js:20', 'defect', { locationAsOf: s1 });

  beforeAll(() => {
    w = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'prr-clear-skip-')));
    roots.push(w);
    sh(w, ['init', '-q', '-b', 'main']);
    sh(w, ['config', 'user.name', 'T']);
    sh(w, ['config', 'user.email', 't@example.com']);
    sh(w, ['config', 'commit.gpgsign', 'false']);
    b0 = commit(w, { 'README.md': 'base\n' }, 'base');
    s1 = commit(w, { 'src/a.js': numbered(40) }, 'round 1: the verb ran here and stamped the entry');
    // Round 2 is reviewed but the verb is NOT run. It edits the defect's own line (the finding survives the edit).
    yEdit = commit(w, { 'src/a.js': numbered(40, { 20: 'line 20 (reformatted)' }) }, 'round 2: the cited line is reformatted');
    // Round 3: an unrelated edit far from the cited line.
    hEdit = commit(w, { 'src/a.js': numbered(40, { 20: 'line 20 (reformatted)', 30: 'unrelated edit' }) }, 'round 3: an edit elsewhere');
    // The same, but round 2 only moves the line (five lines inserted above it).
    sh(w, ['checkout', '-q', '-b', 'shift', s1]);
    yShift = commit(w, { 'src/a.js': inserted }, 'round 2: five lines inserted above');
    hFix = commit(w, { 'src/a.js': inserted.replace('line 20\n', 'FIXED\n') }, 'round 3: the fix');
    sh(w, ['checkout', '-q', '-b', 'shift-other', yShift]);
    hOther = commit(w, { 'src/a.js': inserted.replace('line 15\n', 'EDITED\n') }, 'round 3: an unrelated edit at the number the defect had at round 1');
    // A round 2 that a force-push has since replaced.
    sh(w, ['checkout', '-q', '-b', 'gone', s1]);
    yGone = commit(w, { 'src/a.js': numbered(40, { 21: 'a different round 2' }) }, 'round 2, force-pushed away');
    sh(w, ['checkout', '-q', 'main']);
  });

  test('an edit the finding survived in the skipped round is not a fix: location-unanchored, never cleared', () => {
    const e = stampedAtS1();
    const r = at({ headSha: hEdit, lastReviewedSha: yEdit, ledger: [e] });
    expect(r.cleared).toEqual([]);
    expect(r.kept).toEqual([{ id: 'F', reason: 'location-unanchored' }]);
    expect(r.ledger).toEqual([e]);
  });

  test('a skipped round that only moved the line still lets the fix be found', () => {
    const r = at({ headSha: hFix, lastReviewedSha: yShift, ledger: [stampedAtS1()] });
    expect(r.cleared).toEqual([{ id: 'F', clearedBy: hFix, recordedAt: '1970-01-01T00:00:00.000Z' }]);
  });

  test('...and an unrelated edit at the number the line had at round 1 does not clear it: the line is moved to the head and stamped', () => {
    const r = at({ headSha: hOther, lastReviewedSha: yShift, ledger: [stampedAtS1()] });
    expect(r.cleared).toEqual([]);
    expect(r.kept).toEqual([{ id: 'F', reason: 'location-unchanged' }]);
    expect(r.ledger[0]).toMatchObject({ locationOrLink: 'src/a.js:25', locationAsOf: hOther });
  });

  test('a skipped round that a force-push replaced keeps the entry: its baseline is not on the PR', () => {
    const r = at({ headSha: hEdit, lastReviewedSha: yGone, ledger: [stampedAtS1()] });
    expect(r.cleared).toEqual([]);
    expect(r.kept).toEqual([{ id: 'F', reason: 'recorded-head-not-on-pr' }]);
  });

  test('a re-raised finding is still re-anchored whatever the skipped round did', () => {
    const r = at({ headSha: hEdit, lastReviewedSha: yEdit, ledger: [stampedAtS1()], incoming: [finding('N', 'src/a.js:20', 'defect')] });
    expect(r.kept).toEqual([{ id: 'F', reason: 're-reported' }]);
    expect(r.ledger[0]).toMatchObject({ locationOrLink: 'src/a.js:20', locationAsOf: hEdit });
  });

  test('control: the documented flow (the verb ran at the prior head, so the stamp is lastReviewedSha) compares from the stamp as before', () => {
    const stampedAtY = finding('F', 'src/a.js:25', 'defect', { locationAsOf: yShift });
    expect(at({ headSha: hFix, lastReviewedSha: yShift, ledger: [stampedAtY] }).cleared.map((c) => c.id)).toEqual(['F']);
    expect(at({ headSha: hOther, lastReviewedSha: yShift, ledger: [stampedAtY] }).kept).toEqual([{ id: 'F', reason: 'location-unchanged' }]);
  });
});

describe('a lastReviewedSha that is not on the PR clears nothing, whatever stamp an entry carries', () => {
  let w;
  let b0;
  let ha;
  let hb;
  let hc;
  let deadX;
  const at = (extra) => deriveCleared({ git: defaultGit(), cwd: w, baseSha: b0, headSha: hc, incoming: [], now: () => 0, ...extra });
  /** What the verb left at round 2: the defect (line 25 at round 1) is on line 28, stamped with that head. */
  const stampedAtHb = () => finding('F', 'src/a.js:28', 'defect', { headSha: ha, locationAsOf: hb });

  beforeAll(() => {
    w = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'prr-clear-offpr-')));
    roots.push(w);
    sh(w, ['init', '-q', '-b', 'main']);
    sh(w, ['config', 'user.name', 'T']);
    sh(w, ['config', 'user.email', 't@example.com']);
    sh(w, ['config', 'commit.gpgsign', 'false']);
    b0 = commit(w, { 'README.md': 'base\n' }, 'base');
    ha = commit(w, { 'src/a.js': numbered(40, { 25: 'DEFECT' }) }, 'round 1: the defect is on line 25');
    // A commit that is not on the PR: it hangs off round 1 on a branch the PR never contained, and the stamp below does
    // not lead to it (a stamp that did would be caught by the skipped-round rule, which is not what this is about).
    sh(w, ['checkout', '-q', '-b', 'dead', ha]);
    deadX = commit(w, { 'README.md': 'base\ndead\n' }, 'a commit off the PR');
    sh(w, ['checkout', '-q', 'main']);
    const shifted = numbered(40, { 25: 'DEFECT' }).replace('line 2\n', 'line 2\nn1\nn2\nn3\n');
    hb = commit(w, { 'src/a.js': shifted }, 'round 2: three lines inserted above (the defect is on line 28)');
    hc = commit(w, { 'src/a.js': shifted.replace('DEFECT\n', 'DEFECT (edited)\n') }, 'round 3: the stamped line is edited, the defect remains');
  });

  test('premise: the stamp is on the PR, the lastReviewedSha is not, and the stamp does not lead to it', () => {
    const git = defaultGit();
    expect(git(['merge-base', '--is-ancestor', hb, hc], { cwd: w }).status).toBe(0);
    expect(git(['merge-base', '--is-ancestor', deadX, hc], { cwd: w }).status).toBe(1);
    expect(git(['merge-base', '--is-ancestor', hb, deadX], { cwd: w }).status).toBe(1);
  });

  test('a stamp on the PR and a lastReviewedSha off it: a touched defect is kept, not cleared', () => {
    const e = stampedAtHb();
    const r = at({ lastReviewedSha: deadX, ledger: [e] });
    expect(r.cleared).toEqual([]);
    expect(r.kept).toEqual([{ id: 'F', reason: 'recorded-head-not-on-pr' }]);
    expect(r.ledger).toEqual([e]);
  });

  test('a lastReviewedSha the repository does not hold, or the base, is no better', () => {
    for (const lastReviewedSha of ['a'.repeat(40), b0]) {
      const r = at({ lastReviewedSha, ledger: [stampedAtHb()] });
      expect(r.cleared).toEqual([]);
      expect(r.kept).toEqual([{ id: 'F', reason: 'recorded-head-not-on-pr' }]);
    }
  });

  test('control: a lastReviewedSha that is on the PR (the head the stamp names) still compares from the stamp, and the edit clears', () => {
    const r = at({ lastReviewedSha: hb, ledger: [stampedAtHb()] });
    expect(r.cleared.map((c) => c.id)).toEqual(['F']);
  });

  test('an entry that needs no comparison is reported as before, whatever the lastReviewedSha is', () => {
    const done = finding('A', 'src/a.js:28', 'defect', { cleared: true, clearedBy: hb });
    const own = finding('B', 'src/a.js:28', 'defect', { headSha: hc });
    const current = finding('C', 'src/a.js:28', 'defect', { locationAsOf: hc });
    const r = at({ lastReviewedSha: deadX, ledger: [done, own, current] });
    expect(r.kept).toEqual([
      { id: 'A', reason: 'already-cleared' },
      { id: 'B', reason: 'recorded-at-this-head' },
      { id: 'C', reason: 'location-current' }
    ]);
    expect(r.ledger).toEqual([done, own, current]);
  });
});

describe('a renamed file keeps its findings (a rename is not a fix: the defect went with the file)', () => {
  let w;
  let b0;
  let r1;
  const heads = {};
  const at = (head, extra = {}) => deriveCleared({ git: defaultGit(), cwd: w, baseSha: b0, headSha: heads[head], lastReviewedSha: r1, incoming: [], now: () => 0, ...extra });
  const content = numbered(30);
  const lineEntry = () => finding('F', 'src/a.js:20', 'defect');
  const fileEntry = () => finding('G', 'src/a.js', 'defect');
  const branch = (name) => sh(w, ['checkout', '-q', '-b', name, r1]);

  beforeAll(() => {
    w = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'prr-clear-rename-')));
    roots.push(w);
    sh(w, ['init', '-q', '-b', 'main']);
    sh(w, ['config', 'user.name', 'T']);
    sh(w, ['config', 'user.email', 't@example.com']);
    sh(w, ['config', 'commit.gpgsign', 'false']);
    b0 = commit(w, { 'README.md': 'base\n' }, 'base');
    r1 = commit(w, { 'src/a.js': content, 'src/other.js': numbered(10) }, 'r1: the defect is on line 20 of src/a.js');

    branch('rename');
    heads.rename = commit(w, { 'src/b.js': content }, 'rename only', ['src/a.js']);
    branch('rename-edit');
    heads.renameEdit = commit(w, { 'src/c.js': numbered(30, { 12: 'CHANGED 12' }) }, 'rename and edit another line', ['src/a.js']);
    branch('rename-fix');
    heads.renameFix = commit(w, { 'src/d.js': numbered(30, { 20: 'FIXED 20' }) }, 'rename and edit the cited line', ['src/a.js']);
    branch('move');
    heads.move = commit(w, { 'lib/a.js': content }, 'move to another directory', ['src/a.js']);
    branch('delete');
    heads.delete = commit(w, {}, 'delete', ['src/a.js']);
    branch('dissimilar');
    heads.dissimilar = commit(w, { 'src/e.js': Array.from({ length: 30 }, (_, i) => `entirely different ${i}`).join('\n') + '\n' }, 'delete and create something else', ['src/a.js']);
    branch('other-rename');
    heads.otherRename = commit(w, { 'src/a.js': numbered(30, { 20: 'FIXED 20' }), 'src/other2.js': numbered(10) }, 'fix in place, rename another file', ['src/other.js']);
    sh(w, ['checkout', '-q', 'main']);
  });

  test.each([
    ['a rename only (identical content)', 'rename'],
    ['a rename with an edit on another line', 'renameEdit'],
    ['a rename with an edit on the cited line itself', 'renameFix'],
    ['a move to another directory', 'move']
  ])('%s clears nothing: location-unanchored, for a cited line and a file-only citation alike', (_label, head) => {
    const r = at(head, { ledger: [lineEntry(), fileEntry()] });
    expect(r.cleared).toEqual([]);
    expect(r.kept).toEqual([
      { id: 'F', reason: 'location-unanchored' },
      { id: 'G', reason: 'location-unanchored' }
    ]);
    expect(r.ledger).toEqual([lineEntry(), fileEntry()]);
  });

  test('the defect raised again under the new path does not make the old entry a fix either', () => {
    const r = at('rename', { ledger: [lineEntry()], incoming: [finding('N', 'src/b.js:20', 'defect')] });
    expect(r.cleared).toEqual([]);
    expect(r.kept).toEqual([{ id: 'F', reason: 'location-unanchored' }]);
  });

  test('control: a file deleted outright is still a fix', () => {
    const r = at('delete', { ledger: [lineEntry(), fileEntry()] });
    expect(r.cleared.map((c) => c.id)).toEqual(['F', 'G']);
  });

  test('control: a file replaced by one too dissimilar for git to pair is a deletion, not a rename', () => {
    const r = at('dissimilar', { ledger: [lineEntry()] });
    expect(r.cleared.map((c) => c.id)).toEqual(['F']);
  });

  test('control: another file being renamed does not hold back a fix made in place', () => {
    const r = at('otherRename', { ledger: [lineEntry(), fileEntry()] });
    expect(r.cleared.map((c) => c.id)).toEqual(['F', 'G']);
  });

  test('a rename lookup git cannot answer keeps the entry (diff-failed) instead of clearing on a guess', () => {
    const real = defaultGit();
    const flaky = (args, opts) => (args.includes('--find-renames') ? { status: 128, stdout: '', stderr: 'boom' } : real(args, opts));
    const r = at('delete', { ledger: [lineEntry()], git: flaky });
    expect(r.cleared).toEqual([]);
    expect(r.kept).toEqual([{ id: 'F', reason: 'diff-failed' }]);
  });
});

describe('entry point', () => {
  test('reads the payload on stdin and prints one JSON result', () => {
    const payload = { repoRoot: dir, baseSha: base, headSha: p2, ledger: [finding('hit', 'src/widget.js:12', 'bad', { headSha: p1 })], incoming: [] };
    const r = spawnSync('node', [CLI], { input: JSON.stringify(payload), encoding: 'utf8' });
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.status).toBe('DERIVED');
    expect(out.ledger[0]).toMatchObject({ id: 'hit', cleared: true, clearedBy: p2, clearedReason: 'location-changed' });
    expect(out.cleared[0]).toMatchObject({ id: 'hit', clearedBy: p2 });
  });

  test('a failure exits 1', () => {
    const r = spawnSync('node', [CLI], { input: '{}', encoding: 'utf8' });
    expect(r.status).toBe(1);
    expect(JSON.parse(r.stdout).status).toBe('FAILED');
  });
});
