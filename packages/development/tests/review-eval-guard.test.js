'use strict';

/**
 * kata cwd4: the quality guard (`review-eval-guard.js`) fails when an
 * Important finding the eval set expects is lost.
 *
 * Three layers:
 *   1. the decision logic, driven through injected deps (an in-memory BASE
 *      commit and git) so every fail-closed path can be reached;
 *   2. a REAL git repository built for the test: the cases, CODEOWNERS, rules
 *      hash and history are read from the base commit by real git, and a change
 *      that edits, deletes or rewrites them in its own working tree does not
 *      move the grade;
 *   3. the committed eval set (`docs/review-eval/cases`) and the committed
 *      reconstructed deep-review output, run through the REAL entry point at
 *      `--base HEAD`: the guard passes on that output, and removing any one
 *      expected Important finding from it makes the process exit 1 naming that
 *      case.
 * What the documentation says the guard does is checked in
 * `review-eval-guard-docs.test.js`.
 *
 * Each assertion fails if the guard it covers is removed: a guard that read its
 * inputs from the working tree, treated a missing history as a first run,
 * scored a Nit or another file's finding as a find, skipped an unreadable case
 * file, accepted a case with no pinned commit or an unverifiable pin, or
 * compared nothing with the previous run would turn the matching test red.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { runGuard, main, checkPin, defaultDeps, PINNED_SHA } = require('../lib/review-eval-guard');
const { validateCase, staleCases } = require('../lib/pr-review-eval');

// The real-git layer builds a repository and spawns processes; the machine can be busy.
jest.setTimeout(60000);

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const GUARD = path.join(REPO_ROOT, 'packages', 'development', 'lib', 'review-eval-guard.js');
const SHA = 'a'.repeat(40);
const BASE = 'b'.repeat(40);
const HISTORY = 'docs/review-eval/history.jsonl';

const CODEOWNERS = '* @owner\n';
const RULES_HASH = 'rules-hash-1';

const evalCase = (id, overrides = {}) => ({
  id,
  change: `https://example.test/pull/1 head ${SHA}`,
  bug: `bug ${id}`,
  location: { path: `src/${id}.js`, startLine: 10, endLine: 20 },
  confirmedBy: 'owner',
  rulesFile: 'REVIEW.md',
  rulesHash: RULES_HASH,
  ...overrides,
});

const important = (id, line = 15) => ({ id: `f-${id}`, severity: 'Important', locationOrLink: `src/${id}.js:${line}` });

/**
 * An in-memory repository. `base` holds the files of the BASE commit (the cases,
 * CODEOWNERS, the rules file and the history); `files` holds what is on disk
 * under the change being graded (the pipeline's findings, and the history file
 * this run appends to). `reads` records every disk read and `gitCalls` every
 * git call; a git call the guard has no business making throws.
 */
function fakeRepo({ cases, findings, history, commits = { [SHA]: { 'src/a.js': 100, 'src/b.js': 100 } }, rulesHash = RULES_HASH, codeowners = CODEOWNERS }) {
  const root = '/repo';
  const base = new Map();
  for (const [name, record] of Object.entries(cases)) {
    base.set(`docs/review-eval/cases/${name}`, typeof record === 'string' ? record : JSON.stringify(record));
  }
  base.set('REVIEW.md', 'rules');
  if (codeowners !== null) base.set('.github/CODEOWNERS', codeowners);
  if (history !== undefined) base.set(HISTORY, history);
  const files = new Map([['/out/findings.json', JSON.stringify({ findingsByCase: findings })]]);
  const reads = [];
  const gitCalls = [];
  const appended = [];
  const ok = (stdout = '') => ({ status: 0, stdout, stderr: '' });
  const fail = (stderr = 'fatal: not found') => ({ status: 128, stdout: '', stderr });
  const deps = {
    readFile: (file) => {
      reads.push(file);
      if (!files.has(file)) throw new Error(`ENOENT ${file}`);
      return files.get(file);
    },
    appendFile: (file, text) => {
      appended.push(text);
      files.set(file, `${files.get(file) || ''}${text}`);
    },
    now: () => '2026-11-06T00:00:00.000Z',
    git: (args) => {
      gitCalls.push(args);
      const [command, second] = args;
      if (command === 'rev-parse') {
        const spec = args[args.length - 1];
        if (spec === 'main^{commit}') return ok(`${BASE}\n`);
        if (spec.startsWith(`${BASE}:`)) {
          const rel = spec.slice(BASE.length + 1);
          return base.has(rel) ? ok(`${rel === 'REVIEW.md' ? rulesHash : `blob-of-${rel}`}\n`) : fail();
        }
        return fail();
      }
      if (command === 'ls-tree') {
        const [, , , sha, , spec] = args;
        if (sha !== BASE) return fail('fatal: not a tree object');
        const wanted = spec.endsWith('/')
          ? [...base.keys()].filter((rel) => rel.startsWith(spec) && !rel.slice(spec.length).includes('/'))
          : [...base.keys()].filter((rel) => rel === spec);
        return ok(wanted.map((rel) => `100644 blob object:${rel}\t${rel}\0`).join(''));
      }
      if (command === 'cat-file' && second === 'blob') {
        const rel = args[2].replace(/^object:/, '');
        return base.has(rel) ? ok(base.get(rel)) : fail();
      }
      if (command === 'cat-file' && second === '-e') {
        const sha = args[2].replace(/\^\{commit\}$/, '');
        return commits[sha] ? ok() : fail();
      }
      if (command === 'show') {
        const [sha, file] = args[1].split(':');
        const count = commits[sha] && commits[sha][file];
        return count ? ok('x\n'.repeat(count)) : fail();
      }
      throw new Error(`unexpected git call: ${args.join(' ')}`);
    },
  };
  return { root, deps, files, base, appended, reads, gitCalls };
}

const twoCases = () => ({
  'a.json': evalCase('a', { location: { path: 'src/a.js', startLine: 10, endLine: 20 } }),
  'b.json': evalCase('b', { location: { path: 'src/b.js', startLine: 10, endLine: 20 } }),
});
const bothFound = () => ({ a: [important('a')], b: [important('b')] });
const previousBoth = () => `${JSON.stringify({ cases: [{ id: 'a', found: true }, { id: 'b', found: true }] })}\n`;

const run = (repo, extra = {}) =>
  runGuard({ repoRoot: repo.root, base: 'main', findingsPath: '/out/findings.json', ...extra }, repo.deps);

describe('quality guard decision logic', () => {
  test('passes, with a zero false-negative rate, when every expected Important finding is present', () => {
    const result = run(fakeRepo({ cases: twoCases(), findings: bothFound() }));
    expect(result).toMatchObject({ pass: true, cases: 2, found: 2, missed: [], falseNegativeRate: 0, problems: [] });
  });

  test('fails and names the case when one expected Important finding is removed', () => {
    const result = run(fakeRepo({ cases: twoCases(), findings: { a: [important('a')], b: [] } }));
    expect(result.pass).toBe(false);
    expect(result.problems).toContain('important-finding-lost');
    expect(result.missed).toEqual([{ id: 'b', reason: 'no-important-finding-at-location' }]);
    expect(result.falseNegativeRate).toBe(0.5);
  });

  test('a Nit, a Pre-existing finding or an Important finding outside the range does not stand in for the lost one', () => {
    const findings = {
      a: [important('a')],
      b: [
        { id: 'n', severity: 'Nit', locationOrLink: 'src/b.js:15' },
        { id: 'p', severity: 'Pre-existing', locationOrLink: 'src/b.js:16' },
        { id: 'far', severity: 'Important', locationOrLink: 'src/b.js:99' },
      ],
    };
    const result = run(fakeRepo({ cases: twoCases(), findings }));
    expect(result.pass).toBe(false);
    expect(result.missed.map((entry) => entry.id)).toEqual(['b']);
  });

  test('an Important finding in ANOTHER file at a line inside the range does not stand in for the lost one', () => {
    // src/a.js:15 is a line number inside b's range (10-20), but it is a.js, not b.js.
    const findings = { a: [important('a')], b: [{ id: 'other-file', severity: 'Important', locationOrLink: 'src/a.js:15' }] };
    const result = run(fakeRepo({ cases: twoCases(), findings }));
    expect(result.pass).toBe(false);
    expect(result.problems).toEqual(['important-finding-lost']);
    expect(result.missed).toEqual([{ id: 'b', reason: 'no-important-finding-at-location' }]);
  });

  test('matches by location and severity, not by what a finding says: unrelated text inside the range still counts (the documented limit)', () => {
    const unrelated = { id: 'x', severity: 'Important', locationOrLink: 'src/b.js:15', failureMode: 'unrelated: what to have for lunch', claim: 'lunch' };
    const result = run(fakeRepo({ cases: twoCases(), findings: { a: [important('a')], b: [unrelated] } }));
    expect(result).toMatchObject({ pass: true, found: 2, missed: [] });
  });

  test('a range anchor is not read: file:12-14 is no finding at the location, only file:line is (the documented limit)', () => {
    const ranged = { id: 'r', severity: 'Important', locationOrLink: 'src/b.js:12-14' };
    const result = run(fakeRepo({ cases: twoCases(), findings: { a: [important('a')], b: [ranged] } }));
    expect(result.pass).toBe(false);
    expect(result.missed).toEqual([{ id: 'b', reason: 'no-important-finding-at-location' }]);
  });

  test('a case file that does not parse fails the run instead of shrinking the eval set', () => {
    const cases = { ...twoCases(), 'c.json': '{ not json' };
    const result = run(fakeRepo({ cases, findings: bothFound() }));
    expect(result.pass).toBe(false);
    expect(result.problems).toContain('unloadable-case-file');
    expect(result.unloadable).toHaveLength(1);
  });

  test('a case no CODEOWNERS owner confirmed is invalid and fails the run', () => {
    const cases = { ...twoCases(), 'a.json': evalCase('a', { confirmedBy: 'someone-else', location: { path: 'src/a.js', startLine: 10, endLine: 20 } }) };
    const result = run(fakeRepo({ cases, findings: bothFound() }));
    expect(result.pass).toBe(false);
    expect(result.problems).toEqual(expect.arrayContaining(['invalid-case', 'important-finding-lost']));
    expect(result.invalid[0].errors).toEqual([{ field: 'confirmedBy', reason: 'confirmed-by-not-owner' }]);
  });

  test('a case file whose name does not match its id is invalid', () => {
    const cases = { 'a.json': evalCase('other', { location: { path: 'src/a.js', startLine: 10, endLine: 20 } }) };
    const result = run(fakeRepo({ cases, findings: { other: [important('other')] } }));
    expect(result.invalid[0].errors).toEqual([{ field: 'path', reason: 'case-filename-mismatch' }]);
  });

  test('an empty case directory or an unreadable findings file is a failure, never a pass', () => {
    expect(run(fakeRepo({ cases: {}, findings: {} })).pass).toBe(false);
    const repo = fakeRepo({ cases: twoCases(), findings: bothFound() });
    repo.files.set('/out/findings.json', 'not json');
    expect(run(repo)).toMatchObject({ pass: false, ok: false });
    repo.files.set('/out/findings.json', JSON.stringify({ findings: [] }));
    expect(run(repo)).toMatchObject({ pass: false, ok: false });
  });

  describe('the eval set comes from the base commit, never from the change under test', () => {
    test('nothing is read from disk but the findings: cases, CODEOWNERS, rules hash and history are all git reads at the base', () => {
      const repo = fakeRepo({ cases: twoCases(), findings: bothFound(), history: previousBoth() });
      const result = run(repo, { historyPath: HISTORY });
      expect(result.pass).toBe(true);
      expect(repo.reads).toEqual(['/out/findings.json']);
      const treeCalls = repo.gitCalls.filter(([command]) => command === 'ls-tree');
      expect(treeCalls.map((call) => call[5]).sort()).toEqual(['.github/CODEOWNERS', 'docs/review-eval/cases/', HISTORY]);
      for (const call of treeCalls) expect(call[3]).toBe(BASE);
      const hashCalls = repo.gitCalls.filter(([command, , , spec]) => command === 'rev-parse' && String(spec).includes(':'));
      expect(hashCalls.map((call) => call[3])).toEqual([`${BASE}:REVIEW.md`]);
    });

    test('the result and the history line it appends name the commit that graded', () => {
      const repo = fakeRepo({ cases: twoCases(), findings: bothFound(), history: previousBoth() });
      const result = run(repo, { historyPath: HISTORY });
      expect(result.base).toBe(BASE);
      expect(JSON.parse(repo.appended[0]).base).toBe(BASE);
    });

    test('a base that does not resolve to a commit is a failure, not an empty eval set', () => {
      const result = run(fakeRepo({ cases: twoCases(), findings: bothFound() }), { base: 'no-such-ref' });
      expect(result).toMatchObject({ ok: false, pass: false });
      expect(result.reason).toMatch(/cannot resolve the base revision "no-such-ref"/);
    });

    test('no base revision, or one that is an option, is a failure', () => {
      const repo = fakeRepo({ cases: twoCases(), findings: bothFound() });
      expect(run(repo, { base: undefined })).toMatchObject({ ok: false, pass: false, reason: expect.stringMatching(/base revision is required/) });
      expect(run(repo, { base: '--upload-pack=x' })).toMatchObject({ ok: false, pass: false, reason: expect.stringMatching(/is an option, not a commit/) });
      expect(repo.gitCalls).toEqual([]);
    });

    test('a base without CODEOWNERS fails: no case can be confirmed', () => {
      const result = run(fakeRepo({ cases: twoCases(), findings: bothFound(), codeowners: null }));
      expect(result).toMatchObject({ ok: false, pass: false });
      expect(result.reason).toMatch(/\.github\/CODEOWNERS at the base commit .*absent/);
    });

    test('a cases directory or history file outside the repository is refused before any tree is read', () => {
      const repo = fakeRepo({ cases: twoCases(), findings: bothFound(), history: previousBoth() });
      expect(run(repo, { casesDir: '../elsewhere' })).toMatchObject({ ok: false, pass: false, reason: expect.stringMatching(/cases directory/) });
      expect(run(repo, { historyPath: '/out/history.jsonl' })).toMatchObject({ ok: false, pass: false, reason: expect.stringMatching(/history file/) });
      expect(run(repo, { historyPath: 'docs/*.jsonl' })).toMatchObject({ ok: false, pass: false, reason: expect.stringMatching(/history file/) });
      expect(repo.gitCalls.filter(([command]) => command === 'ls-tree')).toEqual([]);
    });
  });

  describe('pinned commits (base drift cannot silently invalidate a case)', () => {
    test('a case with no 40-hex commit in `change` fails', () => {
      const cases = { 'a.json': evalCase('a', { change: 'PR 1', location: { path: 'src/a.js', startLine: 10, endLine: 20 } }) };
      const result = run(fakeRepo({ cases, findings: { a: [important('a')] } }));
      expect(result.pass).toBe(false);
      expect(result.problems).toContain('case-not-pinned-to-a-commit');
      expect(result.pins.a.status).toBe('no-pinned-sha');
    });

    test('a recorded range past the end of the file at the pinned commit fails', () => {
      const repo = fakeRepo({ cases: twoCases(), findings: bothFound(), commits: { [SHA]: { 'src/a.js': 100, 'src/b.js': 12 } } });
      const result = run(repo);
      expect(result.pass).toBe(false);
      expect(result.pins.b).toMatchObject({ status: 'pin-mismatch', reason: 'file-has-12-lines' });
      expect(result.pins.a.status).toBe('verified');
    });

    test('a range ending exactly on the last line verifies; one line further is a mismatch', () => {
      const exact = run(fakeRepo({ cases: twoCases(), findings: bothFound(), commits: { [SHA]: { 'src/a.js': 20, 'src/b.js': 20 } } }));
      expect(exact.pins.a.status).toBe('verified');
      expect(exact.pass).toBe(true);
      const short = run(fakeRepo({ cases: twoCases(), findings: bothFound(), commits: { [SHA]: { 'src/a.js': 19, 'src/b.js': 20 } } }));
      expect(short.pins.a).toMatchObject({ status: 'pin-mismatch', reason: 'file-has-19-lines' });
      expect(short.pass).toBe(false);
    });

    test('a file absent at the pinned commit fails', () => {
      const repo = fakeRepo({ cases: twoCases(), findings: bothFound(), commits: { [SHA]: { 'src/a.js': 100 } } });
      expect(run(repo).pins.b).toMatchObject({ status: 'pin-mismatch', reason: 'path-absent-at-pinned-commit' });
    });

    test('a pin checks the commit, the file and its length, not the lines: a wrong range inside the file still verifies (the documented limit)', () => {
      const deps = { git: (args) => (args[0] === 'cat-file' ? { status: 0, stdout: '', stderr: '' } : { status: 0, stdout: 'x\n'.repeat(100), stderr: '' }) };
      const wrongLines = { change: `PR 1 ${SHA}`, location: { path: 'src/a.js', startLine: 1, endLine: 2 } };
      expect(checkPin(deps, '/r', wrongLines)).toEqual({ status: 'verified', sha: SHA });
    });

    test('a commit this checkout lacks (shallow clone) is `unverifiable`, never `verified`, and fails the run by name', () => {
      const result = run(fakeRepo({ cases: twoCases(), findings: bothFound(), commits: {} }));
      expect(result.pins.a).toEqual({ status: 'unverifiable', sha: SHA });
      expect(result.pass).toBe(false);
      expect(result.problems).toEqual(['pin-unverifiable']);
      expect(result.unverifiableCommits).toEqual([SHA]);
    });

    test('--allow-unverifiable-pins reports the same pins as an advisory and passes', () => {
      const result = run(fakeRepo({ cases: twoCases(), findings: bothFound(), commits: {} }), { allowUnverifiablePins: true });
      expect(result.pins.a).toEqual({ status: 'unverifiable', sha: SHA });
      expect(result.pass).toBe(true);
      expect(result.problems).toEqual([]);
      expect(result.advisories).toEqual([expect.stringMatching(/2 of 2 cases are pinned to commits this checkout lacks/)]);
    });

    test('checkPin takes the first 40-hex run and ignores a longer hex string', () => {
      const deps = { git: () => ({ status: 1, stdout: '', stderr: '' }) };
      expect(checkPin(deps, '/r', { change: `x ${'b'.repeat(41)}`, location: { path: 'p', endLine: 1 } }).status).toBe('no-pinned-sha');
    });
  });

  describe('stale cases (the rules file moved on the base: owner re-review)', () => {
    test('are reported with their reason, as an advisory, and do not fail the run by default', () => {
      const result = run(fakeRepo({ cases: twoCases(), findings: bothFound(), rulesHash: 'rules-hash-2' }));
      expect(result.stale.sort()).toEqual(['a', 'b']);
      expect(result.staleReasons).toEqual({ a: 'rules-hash-changed', b: 'rules-hash-changed' });
      expect(result.advisories).toEqual([expect.stringMatching(/2 of 2 cases are stale.*Advisory: only --fail-on-stale fails the run/)]);
      expect(result.pass).toBe(true);
    });

    test('fail the run under failOnStale', () => {
      const result = run(fakeRepo({ cases: twoCases(), findings: bothFound(), rulesHash: 'rules-hash-2' }), { failOnStale: true });
      expect(result.pass).toBe(false);
      expect(result.problems).toEqual(['stale-case']);
      expect(result.advisories).toEqual([]);
    });

    test('an unreadable rules file makes the cases stale, never current', () => {
      const repo = fakeRepo({ cases: twoCases(), findings: bothFound() });
      repo.base.delete('REVIEW.md');
      expect(run(repo).staleReasons).toEqual({ a: 'rules-file-unknown', b: 'rules-file-unknown' });
    });

    test('a rules file outside the repository is never hashed: its case is stale, not current', () => {
      const cases = { 'a.json': evalCase('a', { rulesFile: '../outside/REVIEW.md', location: { path: 'src/a.js', startLine: 10, endLine: 20 } }) };
      const repo = fakeRepo({ cases, findings: { a: [important('a')] } });
      expect(run(repo).staleReasons).toEqual({ a: 'rules-file-unknown' });
      expect(repo.gitCalls.some((call) => call.join(' ').includes('outside'))).toBe(false);
    });
  });

  describe('eval history (the false-negative rate over time)', () => {
    test('records every run, failures included, and the next run is compared with it', () => {
      const first = fakeRepo({ cases: twoCases(), findings: { a: [important('a')], b: [] }, history: previousBoth() });
      const failed = run(first, { historyPath: HISTORY, reviewer: 'candidate' });
      expect(failed.historyRecorded).toBe(true);
      const entry = JSON.parse(first.appended[0]);
      expect(entry).toMatchObject({ reviewer: 'candidate', found: 1, total: 2, falseNegativeRate: 0.5, missed: ['b'], pass: false });
      expect(entry.cases).toEqual([{ id: 'a', found: true }, { id: 'b', found: false }]);
    });

    test('a case found by the previous run and lost now is a regression naming it', () => {
      const result = run(fakeRepo({ cases: twoCases(), findings: { a: [important('a')], b: [] }, history: previousBoth() }), { historyPath: HISTORY });
      expect(result.comparison).toMatchObject({ regression: true, flipped: [{ id: 'b', from: true, to: false }] });
      expect(result.problems).toContain('regression-against-previous-run');
    });

    test('a case the base dropped but its history still lists is a regression against history, not a smaller passing set', () => {
      const cases = { 'a.json': twoCases()['a.json'] };
      const result = run(fakeRepo({ cases, findings: { a: [important('a')] }, history: previousBoth() }), { historyPath: HISTORY });
      expect(result.found).toBe(1);
      expect(result.missed).toEqual([]);
      expect(result.comparison.missing).toEqual(['b']);
      expect(result.pass).toBe(false);
      expect(result.problems).toEqual(['regression-against-previous-run']);
    });

    test('gaining a case is not a regression', () => {
      const previous = `${JSON.stringify({ cases: [{ id: 'a', found: true }] })}\n`;
      const result = run(fakeRepo({ cases: twoCases(), findings: bothFound(), history: previous }), { historyPath: HISTORY });
      expect(result.comparison).toMatchObject({ regression: false, added: ['b'] });
      expect(result.pass).toBe(true);
    });

    test('a corrupt last history entry fails the run and appends nothing', () => {
      const repo = fakeRepo({ cases: twoCases(), findings: bothFound(), history: 'not json\n' });
      const result = run(repo, { historyPath: HISTORY });
      expect(result.pass).toBe(false);
      expect(result.problems).toContain('eval-history-unreadable');
      expect(repo.appended).toEqual([]);
    });

    test('a base with cases but no history fails by name and appends nothing: a vanished history is not a first run', () => {
      const repo = fakeRepo({ cases: twoCases(), findings: bothFound() });
      const result = run(repo, { historyPath: HISTORY });
      expect(result.pass).toBe(false);
      expect(result.problems).toEqual(['eval-history-missing']);
      expect(result.historyProblem).toMatch(/has cases but no docs\/review-eval\/history\.jsonl/);
      expect(repo.appended).toEqual([]);
    });

    test('a history with no entries at the base is missing too', () => {
      const repo = fakeRepo({ cases: twoCases(), findings: bothFound(), history: '\n  \n' });
      const result = run(repo, { historyPath: HISTORY });
      expect(result.problems).toEqual(['eval-history-missing']);
      expect(repo.appended).toEqual([]);
    });

    test('without a history path nothing is read or written', () => {
      const repo = fakeRepo({ cases: twoCases(), findings: bothFound() });
      const result = run(repo);
      expect(result.comparison).toBeNull();
      expect(repo.appended).toEqual([]);
      expect(repo.gitCalls.some(([command, , , , , spec]) => command === 'ls-tree' && spec === HISTORY)).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// A real git repository: the base commit, not the working tree.
// ---------------------------------------------------------------------------

const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_SYSTEM: os.devNull, GIT_CONFIG_NOSYSTEM: '1' };

function git(cwd, args, { input, env } = {}) {
  const result = spawnSync('git', ['-c', 'user.name=Guard Test', '-c', 'user.email=guard-test@example.invalid', '-c', 'commit.gpgsign=false', ...args], {
    cwd,
    input,
    encoding: 'utf8',
    env: { ...GIT_ENV, ...(env || {}) },
  });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout.trim();
}

describe('against a real git repository (the base commit, not the working tree)', () => {
  const REVIEW_TEXT = fs.readFileSync(path.join(REPO_ROOT, 'REVIEW.md'), 'utf8');
  const CASES_REL = 'docs/review-eval/cases';
  let root;
  let repo;
  let outDir;
  let pinned;
  let base;
  let drifted;
  let unpinned;
  let noHistory;
  let variants = 0;
  const touched = new Map();

  const abs = (rel) => path.join(repo, rel);
  const write = (rel, text) => {
    fs.mkdirSync(path.dirname(abs(rel)), { recursive: true });
    fs.writeFileSync(abs(rel), text);
  };
  const remember = (rel) => {
    if (!touched.has(rel)) touched.set(rel, fs.existsSync(abs(rel)) ? fs.readFileSync(abs(rel)) : null);
  };
  /** An edit the change under test makes to its own working tree (null deletes); undone after the test. */
  const change = (rel, text) => {
    remember(rel);
    if (text === null) fs.rmSync(abs(rel), { force: true });
    else write(rel, text);
  };
  /** A commit like `from` with some files replaced (text) or removed (null), made without touching the working tree. */
  const variant = (from, changes) => {
    variants += 1;
    const env = { GIT_INDEX_FILE: path.join(root, `variant-index-${variants}`) };
    git(repo, ['read-tree', from], { env });
    for (const [rel, text] of Object.entries(changes)) {
      if (text === null) {
        git(repo, ['update-index', '--force-remove', '--', rel], { env });
      } else {
        const blob = git(repo, ['hash-object', '-w', '--stdin'], { input: text, env });
        git(repo, ['update-index', '--add', '--cacheinfo', `100644,${blob},${rel}`], { env });
      }
    }
    return git(repo, ['commit-tree', git(repo, ['write-tree'], { env }), '-p', from, '-m', 'variant'], { env });
  };
  const findingsFile = (name, findingsByCase) => {
    const file = path.join(outDir, `${name}.json`);
    fs.writeFileSync(file, JSON.stringify({ findingsByCase }));
    return file;
  };
  const cli = (args) => {
    const result = spawnSync(process.execPath, [GUARD, '--repo', repo, ...args], { encoding: 'utf8' });
    return { status: result.status, out: result.stdout.trim() === '' ? null : JSON.parse(result.stdout) };
  };

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'review-eval-guard-repo-'));
    repo = path.join(root, 'repo');
    outDir = path.join(root, 'out');
    fs.mkdirSync(repo);
    fs.mkdirSync(outDir);
    git(repo, ['init', '-q']);

    const lines = (count) => Array.from({ length: count }, (_, index) => `line ${index + 1}\n`).join('');
    write('src/a.js', lines(100));
    write('src/b.js', lines(100));
    write('src/empty.js', '');
    write('src/no-newline.js', 'only line');
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-q', '-m', 'the code the cases are pinned to']);
    pinned = git(repo, ['rev-parse', 'HEAD']);

    write('.github/CODEOWNERS', CODEOWNERS);
    write('REVIEW.md', REVIEW_TEXT);
    const rulesHash = git(repo, ['hash-object', 'REVIEW.md']);
    const caseFor = (id, overrides = {}) =>
      evalCase(id, { change: `https://example.test/pull/1 head ${pinned}`, rulesHash, location: { path: `src/${id}.js`, startLine: 10, endLine: 20 }, ...overrides });
    write(`${CASES_REL}/a.json`, JSON.stringify(caseFor('a')));
    write(`${CASES_REL}/b.json`, JSON.stringify(caseFor('b')));
    write(HISTORY, previousBoth());
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-q', '-m', 'base: the eval set']);
    base = git(repo, ['rev-parse', 'HEAD']);

    drifted = variant(base, { 'REVIEW.md': `${REVIEW_TEXT}\nA rule the owner changed after confirming the cases.\n` });
    unpinned = variant(base, { [`${CASES_REL}/b.json`]: JSON.stringify(caseFor('b', { change: `https://example.test/pull/1 head ${'c'.repeat(40)}` })) });
    noHistory = variant(base, { [HISTORY]: null });
  });

  afterEach(() => {
    for (const [rel, original] of touched) {
      if (original === null) fs.rmSync(abs(rel), { force: true });
      else fs.writeFileSync(abs(rel), original);
    }
    touched.clear();
  });

  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

  test('passes against the base with every pin verified by real git, and the history line it appends names the base', () => {
    remember(HISTORY);
    const { status, out } = cli(['--base', base, '--findings', findingsFile('both', bothFound()), '--history', HISTORY, '--reviewer', 'probe']);
    expect(status).toBe(0);
    expect(out).toMatchObject({ pass: true, problems: [], advisories: [], base, cases: 2, found: 2, stale: [], historyRecorded: true });
    expect(Object.values(out.pins).map((pin) => pin.status)).toEqual(['verified', 'verified']);
    const history = fs.readFileSync(abs(HISTORY), 'utf8').trim().split('\n');
    expect(history).toHaveLength(2);
    expect(JSON.parse(history[1])).toMatchObject({ base, reviewer: 'probe', found: 2, total: 2, pass: true });
  });

  test('a change that deletes a case, the history and the owner line from its own checkout is still graded against the base', () => {
    // The pipeline now loses b. The change also deletes b's case file and the history, and rewrites CODEOWNERS.
    change(`${CASES_REL}/b.json`, null);
    change(HISTORY, null);
    change('.github/CODEOWNERS', '* @somebody-else\n');
    const { status, out } = cli(['--base', base, '--findings', findingsFile('lost-b', { a: [important('a')] }), '--history', HISTORY]);
    expect(status).toBe(1);
    expect(out.cases).toBe(2);
    expect(out.invalid).toEqual([]);
    expect(out.missed.map((entry) => entry.id)).toEqual(['b']);
    expect(out.problems).toEqual(expect.arrayContaining(['important-finding-lost', 'regression-against-previous-run']));
  });

  test('edits to a case file, CODEOWNERS or REVIEW.md in the working tree do not move the grade', () => {
    change(`${CASES_REL}/a.json`, JSON.stringify(evalCase('a', { location: { path: 'src/a.js', startLine: 50, endLine: 60 }, rulesHash: 'x' })));
    change('.github/CODEOWNERS', '* @somebody-else\n');
    change('REVIEW.md', `${REVIEW_TEXT}\nedited in the working tree only\n`);
    const { status, out } = cli(['--base', base, '--findings', findingsFile('both', bothFound()), '--fail-on-stale']);
    expect(status).toBe(0);
    expect(out).toMatchObject({ pass: true, found: 2, cases: 2, invalid: [], stale: [] });
  });

  test('a base with cases but no history fails by name and the working-tree history is left alone', () => {
    remember(HISTORY);
    const before = fs.readFileSync(abs(HISTORY), 'utf8');
    const { status, out } = cli(['--base', noHistory, '--findings', findingsFile('both', bothFound()), '--history', HISTORY]);
    expect(status).toBe(1);
    expect(out.problems).toEqual(['eval-history-missing']);
    expect(fs.readFileSync(abs(HISTORY), 'utf8')).toBe(before);
    // Without --history the same base passes: the history check is what the documented command opts into.
    expect(cli(['--base', noHistory, '--findings', findingsFile('both', bothFound())]).status).toBe(0);
  });

  test('a base revision that does not resolve is a failure, and one that looks like an option is refused', () => {
    const missing = cli(['--base', 'no-such-ref', '--findings', findingsFile('both', bothFound())]);
    expect(missing.status).toBe(1);
    expect(missing.out).toMatchObject({ ok: false, pass: false, reason: expect.stringMatching(/cannot resolve the base revision "no-such-ref"/) });
    const option = cli(['--base', '--upload-pack=x', '--findings', findingsFile('both', bothFound())]);
    expect(option.status).toBe(1);
    expect(option.out.reason).toMatch(/is an option, not a commit/);
  });

  describe('a rules file that changed on the base (drift), with the real REVIEW.md text', () => {
    test('is an advisory by default: exit 0, the cases listed as stale with the reason', () => {
      const { status, out } = cli(['--base', drifted, '--findings', findingsFile('both', bothFound())]);
      expect(status).toBe(0);
      expect(out.pass).toBe(true);
      expect(out.stale.sort()).toEqual(['a', 'b']);
      expect(out.staleReasons).toEqual({ a: 'rules-hash-changed', b: 'rules-hash-changed' });
      expect(out.advisories).toEqual([expect.stringMatching(/2 of 2 cases are stale.*Advisory/)]);
    });

    test('fails the run under --fail-on-stale', () => {
      const { status, out } = cli(['--base', drifted, '--findings', findingsFile('both', bothFound()), '--fail-on-stale']);
      expect(status).toBe(1);
      expect(out.problems).toEqual(['stale-case']);
    });

    test('an unchanged rules file is not stale, with the flag too', () => {
      const { status, out } = cli(['--base', base, '--findings', findingsFile('both', bothFound()), '--fail-on-stale']);
      expect(status).toBe(0);
      expect(out).toMatchObject({ pass: true, stale: [], advisories: [] });
    });
  });

  describe('pins, with real git', () => {
    const record = (location) => evalCase('p', { change: `https://example.test/pull/1 head ${pinned}`, location });
    const pin = (location) => checkPin(defaultDeps(), repo, record(location));

    test('a range ending on the last line of the file verifies; one line further does not', () => {
      expect(pin({ path: 'src/a.js', startLine: 91, endLine: 100 })).toEqual({ status: 'verified', sha: pinned });
      expect(pin({ path: 'src/a.js', startLine: 91, endLine: 101 })).toEqual({ status: 'pin-mismatch', sha: pinned, reason: 'file-has-100-lines' });
    });

    test('an empty file has no lines, and a file without a final newline still counts its last line', () => {
      expect(pin({ path: 'src/empty.js', startLine: 1, endLine: 1 })).toMatchObject({ status: 'pin-mismatch', reason: 'file-has-0-lines' });
      expect(pin({ path: 'src/no-newline.js', startLine: 1, endLine: 1 }).status).toBe('verified');
      expect(pin({ path: 'src/no-newline.js', startLine: 1, endLine: 2 })).toMatchObject({ status: 'pin-mismatch', reason: 'file-has-1-lines' });
    });

    test('a path absent at the pinned commit is a mismatch', () => {
      expect(pin({ path: 'src/none.js', startLine: 1, endLine: 1 })).toMatchObject({ status: 'pin-mismatch', reason: 'path-absent-at-pinned-commit' });
    });

    test('a pin does not read the lines: a wrong range inside the file still verifies (the documented limit)', () => {
      expect(pin({ path: 'src/a.js', startLine: 1, endLine: 2 }).status).toBe('verified');
    });

    test('a commit the checkout lacks is unverifiable', () => {
      const lacking = checkPin(defaultDeps(), repo, evalCase('p', { change: `PR 1 ${'c'.repeat(40)}` }));
      expect(lacking).toEqual({ status: 'unverifiable', sha: 'c'.repeat(40) });
    });

    test('a case pinned to a commit the checkout lacks fails the run as pin-unverifiable, naming the commit to fetch', () => {
      const { status, out } = cli(['--base', unpinned, '--findings', findingsFile('both', bothFound())]);
      expect(status).toBe(1);
      expect(out.problems).toEqual(['pin-unverifiable']);
      expect(out.unverifiableCommits).toEqual(['c'.repeat(40)]);
      expect([out.pins.a.status, out.pins.b.status]).toEqual(['verified', 'unverifiable']);
    });

    test('--allow-unverifiable-pins reports the same pin as an advisory and passes', () => {
      const { status, out } = cli(['--base', unpinned, '--findings', findingsFile('both', bothFound()), '--allow-unverifiable-pins']);
      expect(status).toBe(0);
      expect(out).toMatchObject({ pass: true, problems: [], unverifiableCommits: ['c'.repeat(40)] });
      expect(out.advisories).toEqual([expect.stringMatching(/1 of 2 cases are pinned to commits this checkout lacks/)]);
    });
  });
});

// ---------------------------------------------------------------------------
// The committed eval set, through the real entry point.
// ---------------------------------------------------------------------------

const CASES_DIR = path.join(REPO_ROOT, 'docs', 'review-eval', 'cases');
const BASELINE = path.join(REPO_ROOT, 'docs', 'review-eval', 'baselines', 'deep-review-reconstructed.json');
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const guardCli = (args) => {
  const result = spawnSync(process.execPath, [GUARD, ...args], { cwd: REPO_ROOT, encoding: 'utf8' });
  return { status: result.status, out: result.stdout.trim() === '' ? null : JSON.parse(result.stdout) };
};
/** The committed eval set graded against HEAD: the PR under test is its own base here. A pinned commit this checkout lacks is allowed (and asserted below). */
const AT_HEAD = ['--base', 'HEAD', '--allow-unverifiable-pins'];
const commitPresent = (sha) => spawnSync('git', ['cat-file', '-e', `${sha}^{commit}`], { cwd: REPO_ROOT }).status === 0;

describe('the committed eval set (#228, #233, #234 findings)', () => {
  const caseFiles = fs.readdirSync(CASES_DIR).filter((name) => name.endsWith('.json')).sort();
  const cases = caseFiles.map((name) => readJson(path.join(CASES_DIR, name)));
  const codeowners = fs.readFileSync(path.join(REPO_ROOT, '.github', 'CODEOWNERS'), 'utf8');
  let scratch;

  beforeAll(() => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'review-eval-guard-'));
  });
  afterAll(() => fs.rmSync(scratch, { recursive: true, force: true }));

  test('covers PR 228, PR 233 and PR 234 and every case is valid, confirmed by a CODEOWNERS owner, in the eval directory', () => {
    const changes = cases.map((record) => /pull\/(\d+)/.exec(record.change)[1]);
    expect(new Set(changes)).toEqual(new Set(['228', '233', '234']));
    cases.forEach((record, index) => {
      const verdict = validateCase({ case: record, codeowners, path: `docs/review-eval/cases/${caseFiles[index]}` });
      expect({ id: record.id, errors: verdict.errors }).toEqual({ id: record.id, errors: [] });
    });
  });

  test('stale detection fires on the committed cases when their rules file changes', () => {
    const changed = staleCases({ cases, rulesHashes: { 'REVIEW.md': 'a-different-hash' } });
    expect(changed.stale).toHaveLength(cases.length);
    expect(Object.values(changed.reasons)).toEqual(Array(cases.length).fill('rules-hash-changed'));
    const unchanged = staleCases({ cases, rulesHashes: { 'REVIEW.md': cases[0].rulesHash } });
    expect(unchanged.stale).toEqual([]);
  });

  test('the guard passes on the reconstructed deep-review output: exit 0, false-negative rate 0, no pin mismatch', () => {
    const { status, out } = guardCli([...AT_HEAD, '--findings', BASELINE]);
    expect(out.invalid).toEqual([]);
    expect(out.unloadable).toEqual([]);
    expect(Object.values(out.pins).filter((pin) => pin.status === 'pin-mismatch' || pin.status === 'no-pinned-sha')).toEqual([]);
    // Every pin is verified where its commit is in this checkout, and `unverifiable` where it is not -- never silently verified.
    for (const record of cases) {
      const sha = PINNED_SHA.exec(record.change)[0].toLowerCase();
      expect([record.id, out.pins[record.id].status]).toEqual([record.id, commitPresent(sha) ? 'verified' : 'unverifiable']);
    }
    expect({ status, pass: out.pass, found: out.found, cases: out.cases, rate: out.falseNegativeRate }).toEqual({
      status: 0,
      pass: true,
      found: cases.length,
      cases: cases.length,
      rate: 0,
    });
  });

  test('without --allow-unverifiable-pins the same run fails exactly when a pinned commit is missing from this checkout', () => {
    const missing = cases.filter((record) => !commitPresent(PINNED_SHA.exec(record.change)[0].toLowerCase()));
    const { status, out } = guardCli(['--base', 'HEAD', '--findings', BASELINE]);
    expect(status).toBe(missing.length === 0 ? 0 : 1);
    expect(out.problems).toEqual(missing.length === 0 ? [] : ['pin-unverifiable']);
  });

  test.each(cases.map((record) => [record.id]))('removing the expected Important finding for %s makes the guard exit 1 naming it', (id) => {
    const mutated = readJson(BASELINE);
    mutated.findingsByCase[id] = mutated.findingsByCase[id].filter((entry) => entry.severity !== 'Important');
    const file = path.join(scratch, `${id}.json`);
    fs.writeFileSync(file, JSON.stringify(mutated));
    const { status, out } = guardCli([...AT_HEAD, '--findings', file]);
    expect(status).toBe(1);
    expect(out.pass).toBe(false);
    expect(out.missed.map((entry) => entry.id)).toEqual([id]);
    expect(out.found).toBe(cases.length - 1);
  });

  test('an Important finding on the right lines of ANOTHER file does not rescue F-02 (moved to pr-review-approvals.js:299, inside its 292-300 range)', () => {
    const id = 'pr233-f02-solo-discount-trusts-unverified-changed-paths';
    const mutated = readJson(BASELINE);
    mutated.findingsByCase[id] = mutated.findingsByCase[id].map((entry) => ({ ...entry, locationOrLink: 'packages/development/lib/pr-review-approvals.js:299' }));
    const file = path.join(scratch, 'wrong-file.json');
    fs.writeFileSync(file, JSON.stringify(mutated));
    const { status, out } = guardCli([...AT_HEAD, '--findings', file]);
    expect(status).toBe(1);
    expect(out.missed.map((entry) => entry.id)).toEqual([id]);
    expect(out.found).toBe(cases.length - 1);
  });

  test('exit codes: 2 for bad usage (no --base, no --findings), 1 for an unreadable findings file', () => {
    expect(guardCli([]).status).toBe(2);
    const noBase = guardCli(['--findings', BASELINE]);
    expect(noBase.status).toBe(2);
    expect(noBase.out.error).toMatch(/--base <rev> is required/);
    expect(guardCli([...AT_HEAD, '--findings', path.join(scratch, 'absent.json')]).status).toBe(1);
  });

  test('main returns the exit code and prints one JSON object', () => {
    const writes = [];
    const spy = jest.spyOn(process.stdout, 'write').mockImplementation((text) => {
      writes.push(text);
      return true;
    });
    let code;
    try {
      code = main([...AT_HEAD, '--findings', BASELINE, '--repo', REPO_ROOT]);
    } finally {
      spy.mockRestore();
    }
    expect(code).toBe(0);
    expect(writes).toHaveLength(1);
    expect(JSON.parse(writes[0]).pass).toBe(true);
  });
});
