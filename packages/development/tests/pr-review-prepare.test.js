'use strict';

/**
 * Tests for the per-head preparation step (kata b1rv). Every test drives a REAL git repository built in a temp
 * directory and the real `git`/`tar`; only the baseline test command is pointed at `node --test` so no jest
 * install is needed. Each test names the guard it covers: removing that guard must make it fail.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync, spawnSync } = require('child_process');
const { prepareReview, removePrepared, parseNumstatZ, parseLsTreeZ, verifySnapshot, defaultDeps, PROBE_SOURCE, SCHEMA_VERSION } = require('../lib/pr-review-prepare');
const { BASELINE_ENV_ALLOWLIST, SECRET_NAME_RE, MIN_SECRET_LENGTH } = require('../lib/review-prepare-runtime');
const { main: cliMain } = require('../lib/pr-review-prepare-cli');

const CLI = path.join(__dirname, '..', 'lib', 'pr-review-prepare-cli.js');
const roots = [];
const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');
const NODE_TEST = [process.execPath, '--test'];

function git(cwd, args, env = {}) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t', ...env } }).trim();
}

function write(root, rel, content) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

const POLICY_BASE = '# Review\n\n```ensemble-review-policy\n{"sensitivePaths":["lib/**"]}\n```\n';
const POLICY_RELAXED = '# Review\n\n```ensemble-review-policy\n{"sensitivePaths":["nothing/**"]}\n```\n';

/**
 * base -> reviewed (R) -> head (H): R changes lib/thing.js; H is a remediation commit that changes it again and adds
 * awkward names, a binary file, a rename and a relaxed REVIEW.md. `refs/heads/pr` points at H.
 */
function makeFixture({ extra = {} } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prepare-fixture-'));
  roots.push(root);
  git(root, ['init', '-q', '-b', 'main']);
  write(root, 'REVIEW.md', POLICY_BASE);
  write(root, 'lib/thing.js', "module.exports = () => 'v0';\n");
  write(root, 'lib/old-name.js', 'module.exports = 1;\n');
  write(root, 'tests/thing.test.js', "const test = require('node:test');\nconst assert = require('node:assert');\ntest('thing', () => { assert.strictEqual(require('../lib/thing.js')(), 'v0'); });\n");
  for (const [rel, content] of Object.entries(extra)) write(root, rel, content);
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'base']);
  const base = git(root, ['rev-parse', 'HEAD']);

  write(root, 'lib/thing.js', "module.exports = () => 'v1';\n");
  git(root, ['commit', '-q', '-am', 'reviewed']);
  const reviewed = git(root, ['rev-parse', 'HEAD']);

  write(root, 'lib/thing.js', "module.exports = () => 'v2';\n");
  write(root, 'a b.txt', 'space\n');
  write(root, 'line\nbreak.txt', 'newline\n');
  write(root, 'tab\there.txt', 'tab\n');
  write(root, '\u00fcn\u00ef/caf\u00e9.txt', 'unicode\n');
  fs.writeFileSync(path.join(root, 'blob.bin'), Buffer.from([0, 1, 2, 0, 255]));
  git(root, ['mv', 'lib/old-name.js', 'lib/new-name.js']);
  write(root, 'REVIEW.md', POLICY_RELAXED);
  write(root, 'tests/thing.test.js', "const test = require('node:test');\nconst assert = require('node:assert');\nconst fs = require('fs');\ntest('thing', () => { fs.writeFileSync('written-by-test.txt', 'x'); assert.strictEqual(require('../lib/thing.js')(), 'v2'); });\n");
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'remediation']);
  const head = git(root, ['rev-parse', 'HEAD']);
  git(root, ['update-ref', 'refs/heads/pr', head]);
  return { root, base, reviewed, head };
}

function opts(fx, overrides = {}) {
  return {
    repoRoot: fx.root,
    runId: 'run-1',
    baseSha: fx.base,
    headSha: fx.head,
    headRef: 'refs/heads/pr',
    lastReviewedSha: fx.reviewed,
    remediationShas: [fx.head],
    testCommand: NODE_TEST,
    nodeModules: path.join(fx.root, 'no-node-modules'),
    ...overrides,
  };
}

/** Real deps with every call recorded; `after(kind, args)` may act once a call returned (e.g. move a ref). */
function recordingDeps(after) {
  const real = defaultDeps();
  const calls = { git: [], run: [] };
  return {
    calls,
    git(args, o) { const r = real.git(args, o); calls.git.push(args); if (after) after('git', args, o); return r; },
    run(argv, o) { const r = real.run(argv, o); calls.run.push(argv); if (after) after('run', argv, o); return r; },
  };
}

/** Everything the step left behind: published heads of the run, plus any staging directory anywhere in the state root. */
function stateEntries(fx, runId = 'run-1') {
  const root = path.join(fx.root, '.ensemble', 'pr-review', 'prepare');
  const dir = path.join(root, runId);
  const staging = fs.existsSync(root) ? fs.readdirSync(root).filter((n) => n.startsWith('.staging-')) : [];
  return [...(fs.existsSync(dir) ? fs.readdirSync(dir) : []), ...staging];
}

let fileTmp;
let tmpSpy;

/**
 * Every temp directory these tests (and the steps they run in this process) make lands in one private directory: a
 * scratch directory a step leaks is attributable to a test here, and nothing another process keeps in the OS temp
 * directory is touched. `os.tmpdir()` is spied rather than TMPDIR set: jest hands the tests a copy of process.env,
 * while `os.tmpdir()` reads the real one.
 */
beforeAll(() => {
  fileTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'prepare-tests-'));
  tmpSpy = jest.spyOn(os, 'tmpdir').mockReturnValue(fileTmp);
});

afterAll(() => {
  if (tmpSpy) tmpSpy.mockRestore();
  for (const r of roots.splice(0)) removePrepared(r);
  if (fileTmp) removePrepared(fileTmp);
});

/** The baseline's scratch directories live in the OS temp directory: no step may leave one behind, however it ended. */
afterEach(() => {
  const leaked = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('ensemble-prepare-'));
  for (const n of leaked) removePrepared(path.join(os.tmpdir(), n));
  expect(leaked).toEqual([]);
});

describe('prepareReview: one deterministic step per head (AC1)', () => {
  it('produces every artifact with a sha256 of its real content', () => {
    const fx = makeFixture();
    const r = prepareReview(opts(fx));
    expect(r).toMatchObject({ ok: true, status: 'PREPARED', reused: false, mode: 'delta' });
    for (const name of ['range.diff', 'delta.diff', 'facts.json', 'probe.js', 'baseline.json', 'baseline.log']) {
      const a = r.artifacts[name];
      expect(a.path.startsWith(r.dir)).toBe(true);
      expect(a.sha256).toBe(sha256(fs.readFileSync(a.path)));
      expect(r.hashes[name]).toBe(a.sha256);
    }
    expect(r.artifacts.snapshot.treeSha).toBe(git(fx.root, ['rev-parse', `${fx.head}^{tree}`]));
    expect(r.manifestSha256).toBe(sha256(fs.readFileSync(r.manifestPath)));
    // the state directory is persistent and under the repo's ignored state tree, never a temp dir; the fingerprint of
    // every input names the directory, so a preparation with other inputs never lands in (or replaces) this one
    expect(r.dir).toBe(path.join(fx.root, '.ensemble', 'pr-review', 'prepare', 'run-1', fx.head, r.fingerprint.slice(0, 16)));
  });

  it('range.diff is BASE...HEAD and delta.diff is lastReviewed..HEAD, byte for byte', () => {
    const fx = makeFixture();
    const r = prepareReview(opts(fx));
    const flags = ['diff', '--no-ext-diff', '--no-textconv', '--no-color', '--unified=3', '--src-prefix=a/', '--dst-prefix=b/'];
    expect(fs.readFileSync(r.artifacts['range.diff'].path, 'utf8')).toBe(execFileSync('git', [...flags, `${fx.base}...${fx.head}`], { cwd: fx.root, encoding: 'utf8' }));
    const delta = fs.readFileSync(r.artifacts['delta.diff'].path, 'utf8');
    expect(delta).toBe(execFileSync('git', [...flags, `${fx.reviewed}..${fx.head}`], { cwd: fx.root, encoding: 'utf8' }));
    // the delta holds the remediation change only, never what the reviewed head already contained
    expect(delta).toContain("+module.exports = () => 'v2';");
    expect(delta).not.toContain("+module.exports = () => 'v1';");
  });

  it('the snapshot is a git-archive export of the head tree, not the live checkout', () => {
    const fx = makeFixture();
    write(fx.root, 'lib/thing.js', "module.exports = () => 'UNCOMMITTED';\n"); // the live worktree differs from the head
    const r = prepareReview(opts(fx));
    const snap = r.artifacts.snapshot.path;
    expect(fs.readFileSync(path.join(snap, 'lib/thing.js'), 'utf8')).toBe("module.exports = () => 'v2';\n");
    expect(fs.existsSync(path.join(snap, '.git'))).toBe(false);
  });

  it('re-running for the same head is a no-op that returns identical hashes and runs nothing', () => {
    const fx = makeFixture();
    const first = prepareReview(opts(fx));
    const deps = recordingDeps();
    const second = prepareReview(opts(fx), deps);
    expect(second.reused).toBe(true);
    expect(second.hashes).toEqual(first.hashes);
    expect(second.manifestSha256).toBe(first.manifestSha256);
    expect(deps.calls.run).toEqual([]); // no baseline, no extraction
    expect(deps.calls.git.some((a) => a[0] === 'archive')).toBe(false); // no second archive
    // what git can tell is derived again and compared with the published bytes, never taken on the manifest's word
    expect(deps.calls.git.some((a) => a[0] === 'diff')).toBe(true);
    expect(stateEntries(fx)).toEqual([fx.head]); // no staging leftovers, no second directory
  });

  it('a published artifact that no longer matches its recorded hash is rebuilt, never trusted', () => {
    const fx = makeFixture();
    const first = prepareReview(opts(fx));
    fs.writeFileSync(first.artifacts['range.diff'].path, 'tampered\n');
    const second = prepareReview(opts(fx));
    expect(second.reused).toBe(false);
    // everything derived from the repo is rebuilt identically (the baseline log carries the test runner's own timings)
    for (const name of ['snapshot', 'range.diff', 'delta.diff', 'facts.json', 'probe.js']) expect(second.hashes[name]).toBe(first.hashes[name]);
    expect(fs.readFileSync(second.artifacts['range.diff'].path, 'utf8')).not.toBe('tampered\n');
  });

  it('a snapshot file edited after publishing is detected and rebuilt', () => {
    const fx = makeFixture();
    const first = prepareReview(opts(fx));
    const target = path.join(first.artifacts.snapshot.path, 'lib/thing.js');
    fs.chmodSync(path.dirname(target), 0o755);
    fs.chmodSync(target, 0o644);
    fs.writeFileSync(target, 'poisoned\n');
    const second = prepareReview(opts(fx));
    expect(second.reused).toBe(false);
    expect(fs.readFileSync(path.join(second.artifacts.snapshot.path, 'lib/thing.js'), 'utf8')).toBe("module.exports = () => 'v2';\n");
  });

  it('different inputs for the same head (another base) are not served from the old directory', () => {
    const fx = makeFixture();
    prepareReview(opts(fx));
    const other = prepareReview(opts(fx, { baseSha: fx.reviewed, lastReviewedSha: undefined, remediationShas: undefined }));
    expect(other.reused).toBe(false);
    expect(other.baseSha).toBe(fx.reviewed);
    expect(other.mode).toBe('full');
  });
});

describe('prepareReview: fail closed (AC2)', () => {
  it('a head that moves during preparation is an error and publishes nothing', () => {
    const fx = makeFixture();
    // The author force-pushes while the baseline test run is in flight.
    const deps = recordingDeps((kind) => {
      if (kind === 'run') git(fx.root, ['update-ref', 'refs/heads/pr', fx.reviewed]);
    });
    const r = prepareReview(opts(fx), deps);
    expect(r).toMatchObject({ ok: false, status: 'PREPARE_FAILED', reason: 'head-moved' });
    expect(r.artifacts).toBeUndefined();
    expect(stateEntries(fx)).toEqual([]); // not even a staging directory survives
  });

  it('a head ref that is not the head being prepared is refused before any work', () => {
    const fx = makeFixture();
    git(fx.root, ['update-ref', 'refs/heads/pr', fx.reviewed]);
    const deps = recordingDeps();
    const r = prepareReview(opts(fx), deps);
    expect(r).toMatchObject({ ok: false, reason: 'head-mismatch' });
    expect(deps.calls.run).toEqual([]);
    expect(stateEntries(fx)).toEqual([]);
  });

  it('a head that moved after a successful preparation is an error even on the reuse path', () => {
    const fx = makeFixture();
    prepareReview(opts(fx));
    const deps = recordingDeps((kind, args) => {
      if (kind === 'git' && args[0] === 'ls-tree') git(fx.root, ['update-ref', 'refs/heads/pr', fx.reviewed]);
    });
    expect(prepareReview(opts(fx), deps)).toMatchObject({ ok: false, reason: 'head-moved' });
  });

  it('an unreadable base is an error', () => {
    const fx = makeFixture();
    const r = prepareReview(opts(fx, { baseSha: 'd'.repeat(40), lastReviewedSha: undefined, remediationShas: undefined }));
    expect(r).toMatchObject({ ok: false, status: 'PREPARE_FAILED', reason: 'base-unreadable' });
    expect(stateEntries(fx)).toEqual([]);
  });

  it('an unreadable head is an error', () => {
    const fx = makeFixture();
    const r = prepareReview(opts(fx, { headSha: 'e'.repeat(40), headRef: undefined, lastReviewedSha: undefined, remediationShas: undefined }));
    expect(r).toMatchObject({ ok: false, reason: 'head-unreadable' });
    expect(stateEntries(fx)).toEqual([]);
  });

  it('a ref name or abbreviated sha is not accepted as a sha', () => {
    const fx = makeFixture();
    expect(prepareReview(opts(fx, { baseSha: 'main' }))).toMatchObject({ ok: false, reason: 'invalid-input' });
    expect(prepareReview(opts(fx, { headSha: fx.head.slice(0, 10) }))).toMatchObject({ ok: false, reason: 'invalid-input' });
    expect(prepareReview(opts(fx, { runId: '' }))).toMatchObject({ ok: false, reason: 'invalid-input' });
  });

  it('a snapshot that is not exactly the head tree (export-ignore) fails instead of being close enough', () => {
    const fx = makeFixture({ extra: { '.gitattributes': 'lib/thing.js export-ignore\n' } });
    const r = prepareReview(opts(fx));
    expect(r).toMatchObject({ ok: false, reason: 'snapshot-mismatch', stage: 'snapshot' });
    expect(stateEntries(fx)).toEqual([]);
  });

  it('a baseline that cannot be started is an error, but a failing baseline is recorded with its exit code', () => {
    const fx = makeFixture();
    expect(prepareReview(opts(fx, { testCommand: ['/nonexistent/test-runner'] }))).toMatchObject({ ok: false, reason: 'baseline-not-run' });
    expect(stateEntries(fx)).toEqual([]);

    write(fx.root, 'tests/thing.test.js', "const test = require('node:test');\ntest('boom', () => { throw new Error('baseline-boom-marker'); });\n");
    git(fx.root, ['commit', '-q', '-am', 'break test']);
    const head = git(fx.root, ['rev-parse', 'HEAD']);
    const r = prepareReview(opts(fx, { headSha: head, headRef: undefined, lastReviewedSha: undefined, remediationShas: undefined }));
    expect(r.ok).toBe(true);
    expect(r.baseline).toMatchObject({ ran: true, exitCode: 1, timedOut: false });
    expect(fs.readFileSync(r.artifacts['baseline.log'].path, 'utf8')).toContain('baseline-boom-marker');
  });

  it('a runId cannot steer the run directory out of the state root', () => {
    const fx = makeFixture();
    const r = prepareReview(opts(fx, { runId: '../../../escape' }));
    expect(r.ok).toBe(true);
    const root = path.join(fx.root, '.ensemble', 'pr-review', 'prepare');
    expect(r.dir.startsWith(root + path.sep)).toBe(true);
    expect(fs.existsSync(path.join(fx.root, '..', 'escape'))).toBe(false);
  });
});

describe('changedPaths is NUL-delimited and rename-safe (AC3)', () => {
  it('lists spaces, newline, tab, unicode, a binary file and BOTH sides of a rename verbatim', () => {
    const fx = makeFixture();
    const r = prepareReview(opts(fx, { lastReviewedSha: undefined, remediationShas: undefined }));
    const facts = JSON.parse(fs.readFileSync(r.artifacts['facts.json'].path, 'utf8'));
    expect(facts.changedPaths).toEqual([
      'REVIEW.md',
      'a b.txt',
      'blob.bin',
      'lib/new-name.js',
      'lib/old-name.js',
      'lib/thing.js',
      'line\nbreak.txt',
      'tab\there.txt',
      'tests/thing.test.js',
      '\u00fcn\u00ef/caf\u00e9.txt',
    ]);
    expect(facts.numstat.find((f) => f.path === 'blob.bin')).toEqual({ path: 'blob.bin', added: null, deleted: null, binary: true });
    expect(facts.numstat.find((f) => f.path === 'lib/old-name.js')).toMatchObject({ added: 0, deleted: 1 });
    expect(facts.totals.binary).toBe(1);
  });

  it('changedPaths holds the two-argument diff the skill pins (BASE HEAD); range.diff stays BASE...HEAD', () => {
    const fx = makeFixture();
    // A base that has moved on since the fork: not an ancestor of the head, so the two forms differ.
    git(fx.root, ['checkout', '-q', '-b', 'moved', fx.base]);
    write(fx.root, 'landed-on-base.txt', 'x\n');
    git(fx.root, ['add', '-A']);
    git(fx.root, ['commit', '-q', '-m', 'landed on base branch']);
    const movedBase = git(fx.root, ['rev-parse', 'HEAD']);
    const r = prepareReview(opts(fx, { baseSha: movedBase, lastReviewedSha: undefined, remediationShas: undefined }));
    const facts = JSON.parse(fs.readFileSync(r.artifacts['facts.json'].path, 'utf8'));
    expect(facts.changedPaths).toContain('landed-on-base.txt'); // the skill's form lists it: more review, never less
    expect(fs.readFileSync(r.artifacts['range.diff'].path, 'utf8')).not.toContain('landed-on-base.txt');
    // Both listings are recorded because changedPaths is their union (a path only the merge-base listing names must
    // not be dropped: see 'a path the base already has the identical change for' below).
    expect(facts.diffForm).toEqual({
      range: `${movedBase}...${fx.head}`,
      changedPaths: [
        `git diff --numstat -z --no-renames ${movedBase} ${fx.head}`,
        `git diff --numstat -z --no-renames ${movedBase}...${fx.head}`,
      ],
    });
  });

  it('parseNumstatZ keeps a path with tabs and newlines whole and refuses output it cannot read', () => {
    expect(parseNumstatZ('1\t2\ta\tb\nc\0')).toEqual([{ path: 'a\tb\nc', added: 1, deleted: 2, binary: false }]);
    expect(() => parseNumstatZ('1\t2\tno-terminator')).toThrow();
    expect(() => parseNumstatZ('x\ty\tp\0')).toThrow();
  });
});

describe('delta.diff is absent with a reason unless review-range says delta (AC4)', () => {
  it('first round: no delta.diff, reason first-round', () => {
    const fx = makeFixture();
    const r = prepareReview(opts(fx, { lastReviewedSha: undefined, remediationShas: undefined }));
    expect(r.mode).toBe('full');
    expect(r.absent).toEqual({ 'delta.diff': 'first-round' });
    expect(r.artifacts['delta.diff']).toBeUndefined();
    expect(fs.existsSync(path.join(r.dir, 'delta.diff'))).toBe(false);
  });

  it('a commit nobody vouched for as remediation forces the full range: no delta.diff', () => {
    const fx = makeFixture();
    const r = prepareReview(opts(fx, { remediationShas: [] }));
    expect(r.mode).toBe('full');
    expect(r.absent['delta.diff']).toBe('unvouched-history');
    expect(fs.existsSync(path.join(r.dir, 'delta.diff'))).toBe(false);
  });

  it('a reviewed head that is not an ancestor (force-push) forces the full range', () => {
    const fx = makeFixture();
    git(fx.root, ['checkout', '-q', '-b', 'side', fx.base]);
    write(fx.root, 'side.txt', 's\n');
    git(fx.root, ['add', '-A']);
    git(fx.root, ['commit', '-q', '-m', 'side']);
    const side = git(fx.root, ['rev-parse', 'HEAD']);
    const r = prepareReview(opts(fx, { lastReviewedSha: side }));
    expect(r.mode).toBe('full');
    expect(fs.existsSync(path.join(r.dir, 'delta.diff'))).toBe(false);
  });

  it('an unchanged head is a delta with an empty delta.diff', () => {
    const fx = makeFixture();
    const r = prepareReview(opts(fx, { lastReviewedSha: fx.head }));
    expect(r.mode).toBe('delta');
    expect(fs.readFileSync(r.artifacts['delta.diff'].path, 'utf8')).toBe('');
  });
});

describe('facts.json', () => {
  it('reads policy and CODEOWNERS from the BASE commit, never the head that relaxed them', () => {
    const fx = makeFixture({ extra: { '.github/CODEOWNERS': 'lib/** @team/core\n' } });
    const r = prepareReview(opts(fx, { lastReviewedSha: undefined, remediationShas: undefined }));
    const facts = JSON.parse(fs.readFileSync(r.artifacts['facts.json'].path, 'utf8'));
    expect(facts.policy.source).toBe('policy');
    expect(facts.policy.policy.sensitivePaths).toEqual(['lib/**']); // the head's REVIEW.md says ["nothing/**"]
    expect(facts.paths.sensitive).toContain('lib/thing.js');
    expect(facts.pathsInput.declaration.sourceSha).toBe(fx.base);
    expect(facts.pathsInput.codeowners).toBe('lib/** @team/core\n');
    expect(facts.guidance).toMatchObject({ sourceSha: fx.base, rulesFilePresent: true, codeownersPath: '.github/CODEOWNERS' });
    expect(facts.tierInputs.paths).toEqual(facts.paths);
    expect(facts.tierInputs.kinds).toBeNull();
    expect(facts).toMatchObject({ baseSha: fx.base, headSha: fx.head, range: { mode: 'full' } });
  });

  describe('an untrusted policy never lowers the tier (kata vhpf)', () => {
    const STALE = '# Review\n\n```ensemble-review-policy\n{"sourceSha":"4c1639e0000000000000000000000000000000aa","highPaths":["lib/**"]}\n```\n';
    const factsOf = (fx) => JSON.parse(fs.readFileSync(prepareReview(opts(fx, { lastReviewedSha: undefined, remediationShas: undefined })).artifacts['facts.json'].path, 'utf8'));

    it('a stale sourceSha in the base REVIEW.md: every changed path is High, with the reason named', () => {
      const facts = factsOf(makeFixture({ extra: { 'REVIEW.md': STALE } }));
      expect(facts.policy).toMatchObject({ ok: false, reason: 'policy-not-from-base', source: 'defaults' });
      expect(facts.paths.ok).toBe(true);
      expect(facts.paths.high.sort()).toEqual(facts.changedPaths.slice().sort());
      expect(facts.paths.high).toContain('lib/thing.js');
      expect(facts.paths.warnings).toContain('policy-untrusted-all-high:policy-not-from-base');
      expect(facts.paths.paths.every((p) => p.high && p.highMatchedBy === 'policy-untrusted:policy-not-from-base')).toBe(true);
    });
    it('an unparseable policy block fails up the same way', () => {
      const bad = '# Review\n\n```ensemble-review-policy\n{not json\n```\n';
      const facts = factsOf(makeFixture({ extra: { 'REVIEW.md': bad } }));
      expect(facts.paths.high.length).toBe(facts.changedPaths.length);
      expect(facts.paths.warnings).toContain('policy-untrusted-all-high:policy-unparseable');
    });
    it('a trusted policy keeps its own highPaths and is not untrusted', () => {
      const good = '# Review\n\n```ensemble-review-policy\n{"highPaths":["lib/**"]}\n```\n';
      const facts = factsOf(makeFixture({ extra: { 'REVIEW.md': good } }));
      expect(facts.policy.ok).toBe(true);
      expect(facts.paths.high).toContain('lib/thing.js');
      expect(facts.paths.high).not.toContain('a b.txt');
      expect(facts.paths.warnings.some((w) => w.startsWith('policy-untrusted'))).toBe(false);
    });
    it('a base with NO REVIEW.md is the documented defaults, never untrusted: no High path, no policy-untrusted warning', () => {
      const fx = makeFixture();
      git(fx.root, ['rm', '-q', '--cached', 'REVIEW.md']);
      git(fx.root, ['commit', '-q', '-m', 'drop review']);
      const nextBase = git(fx.root, ['rev-parse', 'HEAD']);
      write(fx.root, 'x.txt', 'x\n');
      git(fx.root, ['add', 'x.txt']);
      git(fx.root, ['commit', '-q', '-m', 'more']);
      const head = git(fx.root, ['rev-parse', 'HEAD']);
      const r = prepareReview(opts(fx, { baseSha: nextBase, headSha: head, headRef: undefined, lastReviewedSha: undefined, remediationShas: undefined }));
      const facts = JSON.parse(fs.readFileSync(r.artifacts['facts.json'].path, 'utf8'));
      expect(facts.policy).toMatchObject({ ok: true, source: 'defaults' });
      expect(facts.paths.high).toEqual([]);
      expect(facts.paths.warnings.some((w) => w.startsWith('policy-untrusted'))).toBe(false);
    });
    it('a REVIEW.md with no policy fence is the defaults too, never untrusted', () => {
      const facts = factsOf(makeFixture({ extra: { 'REVIEW.md': '# Review\n\nprose only, no fence\n' } }));
      expect(facts.policy).toMatchObject({ ok: true, source: 'defaults' });
      expect(facts.paths.high).toEqual([]);
      expect(facts.paths.warnings.some((w) => w.startsWith('policy-untrusted'))).toBe(false);
    });
  });

  it('a base with no REVIEW.md yields the defaults, said so, not an error', () => {
    const fx = makeFixture();
    git(fx.root, ['rm', '-q', '--cached', 'REVIEW.md']);
    git(fx.root, ['commit', '-q', '-m', 'drop review']);
    const nextBase = git(fx.root, ['rev-parse', 'HEAD']);
    write(fx.root, 'x.txt', 'x\n');
    git(fx.root, ['add', 'x.txt']);
    git(fx.root, ['commit', '-q', '-m', 'more']);
    const head = git(fx.root, ['rev-parse', 'HEAD']);
    const r = prepareReview(opts(fx, { baseSha: nextBase, headSha: head, headRef: undefined, lastReviewedSha: undefined, remediationShas: undefined }));
    const facts = JSON.parse(fs.readFileSync(r.artifacts['facts.json'].path, 'utf8'));
    expect(facts.guidance.rulesFilePresent).toBe(false);
    expect(facts.policy).toMatchObject({ ok: true, source: 'defaults' });
  });
});

describe('the snapshot is never written to', () => {
  it('is read-only once published, and the baseline run happens on a scratch copy', () => {
    const fx = makeFixture();
    const r = prepareReview(opts(fx));
    const snap = r.artifacts.snapshot.path;
    // the changed test writes a file into its cwd; it must not land in the reviewed snapshot
    expect(fs.existsSync(path.join(snap, 'written-by-test.txt'))).toBe(false);
    expect(r.baseline).toMatchObject({ ran: true, exitCode: 0 });
    expect(fs.existsSync(path.join(r.dir, '.baseline-work'))).toBe(false);
    if (process.getuid && process.getuid() !== 0) {
      expect(() => fs.writeFileSync(path.join(snap, 'lib/thing.js'), 'x')).toThrow(/EACCES|EPERM/);
      expect(() => fs.writeFileSync(path.join(snap, 'new-file.txt'), 'x')).toThrow(/EACCES|EPERM/);
    }
    expect(prepareReview(opts(fx)).reused).toBe(true); // and a re-verify finds it unchanged
  });

  it('runs the changed tests and the tests of changed sources, and records why', () => {
    const fx = makeFixture();
    const r = prepareReview(opts(fx));
    const baseline = JSON.parse(fs.readFileSync(r.artifacts['baseline.json'].path, 'utf8'));
    expect(baseline.selection).toEqual([{ file: 'tests/thing.test.js', why: 'changed' }]);
    expect(baseline.command.slice(-1)).toEqual(['--test']);
  });

  it('records that no test file was relevant instead of pretending a run happened', () => {
    const fx = makeFixture();
    write(fx.root, 'docs.md', 'doc\n');
    git(fx.root, ['add', 'docs.md']);
    git(fx.root, ['commit', '-q', '-m', 'docs']);
    const head = git(fx.root, ['rev-parse', 'HEAD']);
    const r = prepareReview(opts(fx, { baseSha: fx.head, headSha: head, headRef: undefined, lastReviewedSha: undefined, remediationShas: undefined }));
    expect(r.baseline).toMatchObject({ ran: false, reason: 'no-test-files', exitCode: null });
  });
});

describe('probe.js: the ready probe runner', () => {
  it('loads head modules, resolves third-party requires, runs read-only and chains steps, in a fresh process', () => {
    const nm = fs.mkdtempSync(path.join(os.tmpdir(), 'prepare-nm-'));
    roots.push(nm);
    write(nm, 'fakedep/index.js', "module.exports = 'fakedep-ok';\n");
    const fx = makeFixture({ extra: { 'lib/uses-dep.js': "module.exports = require('fakedep');\n" } });
    const r = prepareReview(opts(fx, { nodeModules: nm }));
    const script = `
      const probe = require(${JSON.stringify(r.artifacts['probe.js'].path)});
      const out = {
        thing: probe.load('lib/thing.js')(),
        dep: probe.load('lib/uses-dep.js'),
        atBase: probe.readAtBase('lib/thing.js'),
        missingAtBase: probe.readAtBase('nope.txt'),
        head: probe.facts.headSha,
        write: probe.run([process.execPath, '-e', "require('fs').writeFileSync('probe-wrote.txt','x')"]).status,
        chain: probe.chain([
          { name: 'a', run: () => 1 },
          { name: 'b', run: (c) => c.results.a + 1 },
          { name: 'c', run: () => { throw new Error('boom'); } },
          { name: 'd', run: () => 'never' },
        ]),
      };
      try { probe.load('../../escape.js'); out.escape = 'allowed'; } catch (e) { out.escape = e.message; }
      process.stdout.write(JSON.stringify(out));
    `;
    const p = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8' });
    expect(p.stderr).toBe('');
    const out = JSON.parse(p.stdout);
    expect(out.thing).toBe('v2');
    expect(out.dep).toBe('fakedep-ok');
    expect(out.atBase).toBe("module.exports = () => 'v0';\n");
    expect(out.missingAtBase).toBeNull();
    expect(out.head).toBe(fx.head);
    expect(fs.statSync(r.artifacts.snapshot.path).mode & 0o222).toBe(0); // the snapshot is read-only, whoever runs this
    if (NOT_ROOT) {
      expect(out.write).not.toBe(0); // so the probe's write is refused
      expect(fs.existsSync(path.join(r.artifacts.snapshot.path, 'probe-wrote.txt'))).toBe(false);
    }
    expect(out.chain).toEqual({
      ok: false,
      steps: [{ name: 'a', ok: true, value: 1 }, { name: 'b', ok: true, value: 2 }, { name: 'c', ok: false, error: 'boom' }],
    });
    expect(out.escape).toMatch(/escapes the snapshot/);
  });
});

describe('entry point', () => {
  it('prepares a head from a JSON payload on stdin and reports the wall time; the second run reuses', () => {
    const fx = makeFixture();
    const payload = JSON.stringify(opts(fx));
    const run = () => spawnSync(process.execPath, [CLI], { input: payload, encoding: 'utf8', cwd: os.homedir() });
    const first = run();
    expect(first.status).toBe(0);
    const a = JSON.parse(first.stdout);
    expect(a).toMatchObject({ ok: true, reused: false, headSha: fx.head });
    expect(typeof a.wallMs).toBe('number');
    const second = JSON.parse(run().stdout);
    expect(second.reused).toBe(true);
    expect(second.hashes).toEqual(a.hashes);
  });

  it('exits 1 with an error object for a failed preparation and for unreadable JSON', () => {
    const fx = makeFixture();
    const bad = spawnSync(process.execPath, [CLI], { input: JSON.stringify(opts(fx, { baseSha: 'd'.repeat(40) })), encoding: 'utf8' });
    expect(bad.status).toBe(1);
    expect(JSON.parse(bad.stdout)).toMatchObject({ ok: false, reason: 'base-unreadable' });

    const emitted = [];
    expect(cliMain({ readJson: () => { throw new Error('nope'); }, emit: (v) => emitted.push(v) })).toBe(1);
    expect(emitted[0]).toMatchObject({ ok: false, reason: 'invalid-input' });
  });
});

/* ------------------------------------------------------------------------------------------ review round 1 */

const stateRootOf = (fx) => path.join(fx.root, '.ensemble', 'pr-review', 'prepare');
const FIRST_ROUND = { lastReviewedSha: undefined, remediationShas: undefined };
const RANGE_DIFF_FLAGS = ['diff', '--no-ext-diff', '--no-textconv', '--no-color', '--unified=3', '--src-prefix=a/', '--dst-prefix=b/'];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const NOT_ROOT = !!process.getuid && process.getuid() !== 0; // root ignores permission bits
const PLANTED = ['facts.json', 'range.diff', 'delta.diff', 'probe.js', 'baseline.json', 'baseline.log', 'manifest.json', 'PLANTED.txt'];

/** One more commit on the fixture whose tests/thing.test.js is `source` (or `source(fx)`); `refs/heads/pr` follows it. */
function withHeadTest(fx, source) {
  write(fx.root, 'tests/thing.test.js', typeof source === 'function' ? source(fx) : source);
  git(fx.root, ['add', '-A']);
  git(fx.root, ['commit', '-q', '-m', 'head test']);
  const head = git(fx.root, ['rev-parse', 'HEAD']);
  git(fx.root, ['update-ref', 'refs/heads/pr', head]);
  return { ...fx, head };
}

/**
 * Source of a head test (what the baseline run executes): `lines` run after a prelude that gives it the fixture, the
 * state root, the staging directories (the ones holding snapshot/), `observe(value)` (writes <fixture>/observed.json,
 * the channel back to the test) and `unseal(dir)` (undoes the read-only seal a determined head can undo).
 */
function headTestSource(fx, lines) {
  return [
    "const test = require('node:test');",
    "const fs = require('fs');",
    "const path = require('path');",
    `const FIXTURE = ${JSON.stringify(fx.root)};`,
    `const STATE_ROOT = ${JSON.stringify(stateRootOf(fx))};`,
    `const PLANTED = ${JSON.stringify(PLANTED)};`,
    `const OBSERVED = ${JSON.stringify(path.join(fx.root, 'observed.json'))};`,
    "const stagingDirs = () => fs.readdirSync(STATE_ROOT).filter((n) => n.startsWith('.staging-')).map((n) => path.join(STATE_ROOT, n)).filter((d) => fs.existsSync(path.join(d, 'snapshot')));",
    'const observe = (value) => fs.writeFileSync(OBSERVED, JSON.stringify(value));',
    "function unseal(dir) { fs.chmodSync(dir, 0o755); for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const abs = path.join(dir, e.name); if (e.isDirectory()) unseal(abs); else if (!e.isSymbolicLink()) fs.chmodSync(abs, 0o644); } }",
    ...lines,
    '',
  ].join('\n');
}

const observed = (fx) => JSON.parse(fs.readFileSync(path.join(fx.root, 'observed.json'), 'utf8'));
const readFacts = (r) => JSON.parse(fs.readFileSync(r.artifacts['facts.json'].path, 'utf8'));

/** Real git state: a base whose `rel` is a symlink to `target` (a regular file), and a head one commit later. */
function baseWithSymlink(fx, rel, target, content) {
  git(fx.root, ['checkout', '-q', '-b', `linked-${rel.replace(/\W/g, '_')}`, fx.base]);
  write(fx.root, target, content);
  fs.mkdirSync(path.dirname(path.join(fx.root, rel)), { recursive: true });
  fs.rmSync(path.join(fx.root, rel), { force: true });
  fs.symlinkSync(path.relative(path.dirname(rel), target), path.join(fx.root, rel));
  git(fx.root, ['add', '-A']);
  git(fx.root, ['commit', '-q', '-m', `${rel} as a symlink`]);
  const baseSha = git(fx.root, ['rev-parse', 'HEAD']);
  write(fx.root, 'lib/x.js', 'module.exports = 1;\n');
  git(fx.root, ['add', '-A']);
  git(fx.root, ['commit', '-q', '-m', 'change']);
  return { baseSha, headSha: git(fx.root, ['rev-parse', 'HEAD']) };
}

describe('the baseline run cannot change what is attested (finding 1)', () => {
  it("a baseline test writing ../facts.json, ../range.diff, ../probe.js and ../snapshot/... (the first review's experiment) cannot change a published artifact", () => {
    const fx = withHeadTest(makeFixture(), (f) => headTestSource(f, [
      "test('plant beside the working directory', () => {",
      '  const beside = path.dirname(process.cwd());',
      "  for (const name of PLANTED) fs.writeFileSync(path.join(beside, name), 'TAMPERED');",
      "  try { fs.writeFileSync(path.join(beside, 'snapshot', 'lib', 'thing.js'), 'TAMPERED'); } catch (e) { /* no snapshot there */ }",
      '});',
    ]));
    const r = prepareReview(opts(fx, FIRST_ROUND));
    expect(r).toMatchObject({ ok: true, status: 'PREPARED' });
    expect(sha256(fs.readFileSync(r.artifacts['range.diff'].path))).toBe(sha256(execFileSync('git', [...RANGE_DIFF_FLAGS, `${fx.base}...${fx.head}`], { cwd: fx.root })));
    expect(fs.readFileSync(r.artifacts['probe.js'].path, 'utf8')).toBe(PROBE_SOURCE);
    expect(readFacts(r)).toMatchObject({ headSha: fx.head, baseSha: fx.base });
    expect(fs.readFileSync(path.join(r.artifacts.snapshot.path, 'lib/thing.js'), 'utf8')).toBe("module.exports = () => 'v2';\n");
    // nothing but the attested artifacts is published
    expect(fs.readdirSync(r.dir).sort()).toEqual(['baseline.json', 'baseline.log', 'facts.json', 'manifest.json', 'probe.js', 'range.diff', 'snapshot']);
    expect(prepareReview(opts(fx, FIRST_ROUND)).reused).toBe(true);
  }, 30000);

  it('the baseline works outside the repository, so no path relative to its working directory reaches the state root, node_modules or .git', () => {
    const fx = withHeadTest(makeFixture(), (f) => headTestSource(f, [
      "test('where am I', () => {",
      '  observe({ cwd: process.cwd(), home: fs.realpathSync(process.env.HOME) });',
      '});',
    ]));
    const r = prepareReview(opts(fx, FIRST_ROUND));
    expect(r.ok).toBe(true);
    const seen = observed(fx);
    const repo = fs.realpathSync(fx.root);
    for (const where of [seen.cwd, seen.home]) {
      expect(path.relative(repo, where).startsWith('..')).toBe(true); // not inside the repository
    }
    expect(seen.cwd.startsWith(fs.realpathSync(os.tmpdir()) + path.sep)).toBe(true); // in the OS temp directory
  }, 30000);

  it('a baseline test that reaches the staging directory by its absolute path fails the preparation', () => {
    const fx = withHeadTest(makeFixture(), (f) => headTestSource(f, [
      "test('plant into the staging directory', () => {",
      "  for (const staging of stagingDirs()) for (const name of PLANTED) fs.writeFileSync(path.join(staging, name), 'TAMPERED');",
      '});',
    ]));
    const r = prepareReview(opts(fx, FIRST_ROUND));
    expect(r).toMatchObject({ ok: false, status: 'PREPARE_FAILED', reason: 'baseline-tampered', stage: 'baseline' });
    expect(r.artifacts).toBeUndefined();
    expect(stateEntries(fx)).toEqual([]);
  }, 30000);

  it('a baseline test that edits the staged snapshot (after undoing the read-only seal) fails instead of publishing it', () => {
    const fx = withHeadTest(makeFixture(), (f) => headTestSource(f, [
      "test('edit the staged snapshot', () => {",
      '  for (const staging of stagingDirs()) {',
      "    const snap = path.join(staging, 'snapshot');",
      '    unseal(snap);',
      "    fs.writeFileSync(path.join(snap, 'lib', 'thing.js'), 'TAMPERED');",
      "    fs.writeFileSync(path.join(snap, 'lib', 'PLANTED.js'), 'TAMPERED');",
      '  }',
      '});',
    ]));
    const r = prepareReview(opts(fx, FIRST_ROUND));
    expect(r).toMatchObject({ ok: false, status: 'PREPARE_FAILED', reason: 'snapshot-mismatch', stage: 'baseline' });
    expect(r.detail).toMatch(/baseline run/);
    expect(stateEntries(fx)).toEqual([]);
  }, 30000);

  it('the snapshot is already read-only while the baseline runs, not only once it is published', () => {
    const fx = withHeadTest(makeFixture(), (f) => headTestSource(f, [
      "test('the staged snapshot while the baseline runs', () => {",
      '  const out = { snapshots: 0 };',
      '  for (const staging of stagingDirs()) {',
      "    const snap = path.join(staging, 'snapshot');",
      '    out.snapshots += 1;',
      "    out.fileWritable = (fs.statSync(path.join(snap, 'lib', 'thing.js')).mode & 0o222) !== 0;",
      "    out.dirWritable = (fs.statSync(path.join(snap, 'lib')).mode & 0o222) !== 0;",
      "    try { fs.writeFileSync(path.join(snap, 'lib', 'thing.js'), 'TAMPERED'); out.edit = 'written'; } catch (e) { out.edit = e.code; }",
      "    try { fs.writeFileSync(path.join(snap, 'lib', 'PLANTED.js'), 'TAMPERED'); out.create = 'written'; } catch (e) { out.create = e.code; }",
      '  }',
      '  observe(out);',
      '});',
    ]));
    const r = prepareReview(opts(fx, FIRST_ROUND));
    // the permission bits are checked whoever runs this; the refusal of the writes only means something for a non-root user
    expect(observed(fx)).toMatchObject({ snapshots: 1, fileWritable: false, dirWritable: false });
    if (NOT_ROOT) expect(observed(fx)).toMatchObject({ edit: expect.stringMatching(/^(EACCES|EPERM)$/), create: expect.stringMatching(/^(EACCES|EPERM)$/) });
    expect(r.ok).toBe(NOT_ROOT); // as root the writes land and the snapshot check after the baseline fails the step
  }, 30000);

  it('nothing the baseline started outlives it: a background process cannot rewrite artifacts after they are attested', async () => {
    const fx0 = makeFixture();
    const go = path.join(fx0.root, 'go.flag');
    const started = path.join(fx0.root, 'started.flag');
    const marker = path.join(fx0.root, 'survived.txt');
    const child = `const fs = require('fs'); fs.writeFileSync(${JSON.stringify(started)}, 'x'); const t = setInterval(() => { if (fs.existsSync(${JSON.stringify(go)})) { fs.writeFileSync(${JSON.stringify(marker)}, 'x'); clearInterval(t); } }, 50); setTimeout(() => process.exit(0), 15000);`;
    const fx = withHeadTest(fx0, (f) => headTestSource(f, [
      "test('leave a background process behind', () => {",
      "  const { spawn } = require('child_process');",
      `  spawn(process.execPath, ['-e', ${JSON.stringify(child)}], { stdio: 'ignore' }).unref();`,
      '  // the child is certainly running when this test ends',
      '  const deadline = Date.now() + 10000;',
      `  while (!fs.existsSync(${JSON.stringify(started)}) && Date.now() < deadline) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);`,
      '});',
    ]));
    const r = prepareReview(opts(fx, FIRST_ROUND));
    expect(r.ok).toBe(true);
    expect(fs.existsSync(started)).toBe(true); // it was running when the baseline ended
    fs.writeFileSync(go, 'go');
    await sleep(1000);
    expect(fs.existsSync(marker)).toBe(false);
  }, 30000);

  it('a snapshot directory that is itself a symlink to a look-alike is not the snapshot', () => {
    const fx = makeFixture();
    const r = prepareReview(opts(fx, FIRST_ROUND));
    const entries = parseLsTreeZ(execFileSync('git', ['ls-tree', '-r', '-z', '--full-tree', fx.head], { cwd: fx.root, encoding: 'utf8' }));
    const holder = fs.mkdtempSync(path.join(os.tmpdir(), 'prepare-lookalike-'));
    roots.push(holder);
    fs.cpSync(r.artifacts.snapshot.path, path.join(holder, 'real'), { recursive: true });
    fs.symlinkSync(path.join(holder, 'real'), path.join(holder, 'link'));
    expect(() => verifySnapshot(path.join(holder, 'real'), entries, 'sha1')).not.toThrow(); // control: the copy is the tree
    expect(() => verifySnapshot(path.join(holder, 'link'), entries, 'sha1')).toThrow(/not a directory/);
  }, 30000);

  it('a published directory whose hashes agree with its manifest but whose content is not what git says is rebuilt, not reused', () => {
    const fx = makeFixture();
    const first = prepareReview(opts(fx));
    // a forger rewrites range.diff and the manifest's record of it, so every hash still agrees with the manifest
    const forged = 'diff --git a/nothing b/nothing\n';
    fs.writeFileSync(first.artifacts['range.diff'].path, forged);
    const manifest = JSON.parse(fs.readFileSync(first.manifestPath, 'utf8'));
    manifest.artifacts['range.diff'] = { ...manifest.artifacts['range.diff'], sha256: sha256(forged), bytes: forged.length };
    fs.writeFileSync(first.manifestPath, JSON.stringify(manifest, null, 2));
    const second = prepareReview(opts(fx));
    expect(second.reused).toBe(false);
    expect(second.hashes['range.diff']).toBe(first.hashes['range.diff']);
    expect(fs.readFileSync(second.artifacts['range.diff'].path, 'utf8')).not.toBe(forged);
  }, 30000);

  it.each([
    ['delta.diff planted where the manifest declares it absent', (m, dir) => { fs.writeFileSync(path.join(dir, 'delta.diff'), 'planted\n'); }],
    ['an artifact this module never makes', (m) => { m.artifacts['evil.js'] = { path: 'evil.js', sha256: sha256(''), bytes: 0 }; }],
    ['a baseline summary that disagrees with baseline.json', (m) => { m.baseline.exitCode = 1; }],
    ['another head', (m) => { m.headSha = 'f'.repeat(40); }],
    ['another range decision', (m) => { m.range.reason = 'delta-since-last-review'; }],
    ['another snapshot tree', (m) => { m.artifacts.snapshot.treeSha = 'f'.repeat(40); }],
    ['another snapshot digest', (m) => { m.artifacts.snapshot.sha256 = 'f'.repeat(64); }],
  ])('a published directory with %s is rebuilt, not reused', (name, forge) => {
    const fx = makeFixture();
    const first = prepareReview(opts(fx, FIRST_ROUND));
    const manifest = JSON.parse(fs.readFileSync(first.manifestPath, 'utf8'));
    forge(manifest, first.dir);
    fs.writeFileSync(first.manifestPath, JSON.stringify(manifest, null, 2));
    const second = prepareReview(opts(fx, FIRST_ROUND));
    expect(second.reused).toBe(false);
    expect(JSON.parse(fs.readFileSync(second.manifestPath, 'utf8')).headSha).toBe(fx.head);
    expect(fs.existsSync(path.join(second.dir, 'delta.diff'))).toBe(false);
    expect(fs.existsSync(path.join(second.dir, 'evil.js'))).toBe(false);
  }, 30000);

  /** Copies the published directory aside and removes the original; `plant()` later puts the copy back mid-run. */
  function copyAside(first, fx, name) {
    const aside = path.join(fx.root, name);
    fs.cpSync(first.dir, aside, { recursive: true });
    removePrepared(first.dir);
    let planted = false;
    return {
      aside,
      deps: recordingDeps((kind) => {
        // after the snapshot extraction: while the step is still building, before it publishes
        if (kind === 'run' && !planted) { planted = true; fs.renameSync(aside, first.dir); }
      }),
      wasPlanted: () => planted,
    };
  }

  it('a directory a baseline test creates for these very inputs is not adopted unless it holds what git says', () => {
    const fx = makeFixture();
    const first = prepareReview(opts(fx));
    const { aside, deps, wasPlanted } = copyAside(first, fx, 'forged-copy');
    // the copy agrees with its own manifest after range.diff is forged
    const forged = 'diff --git a/nothing b/nothing\n';
    fs.writeFileSync(path.join(aside, 'range.diff'), forged);
    const manifest = JSON.parse(fs.readFileSync(path.join(aside, 'manifest.json'), 'utf8'));
    manifest.artifacts['range.diff'] = { ...manifest.artifacts['range.diff'], sha256: sha256(forged), bytes: forged.length };
    fs.writeFileSync(path.join(aside, 'manifest.json'), JSON.stringify(manifest, null, 2));
    const r = prepareReview(opts(fx), deps);
    expect(wasPlanted()).toBe(true);
    expect(r).toMatchObject({ ok: false, status: 'PREPARE_FAILED', reason: 'publish-failed', stage: 'publish' });
    expect(stateEntries(fx)).toEqual([fx.head]); // the staging directory is gone; the planted one is not adopted
  }, 30000);

  it('a directory a concurrent preparer published for the same inputs is adopted when it holds exactly what git says', () => {
    const fx = makeFixture();
    const first = prepareReview(opts(fx));
    const { deps, wasPlanted } = copyAside(first, fx, 'twin');
    const r = prepareReview(opts(fx), deps);
    expect(wasPlanted()).toBe(true);
    expect(r).toMatchObject({ ok: true, reused: true, dir: first.dir });
    expect(r.hashes).toEqual(first.hashes);
    expect(stateEntries(fx)).toEqual([fx.head]);
  }, 30000);

  it('the cleanup never follows a symlink a baseline test put in place of its scratch directory', () => {
    const victim = fs.mkdtempSync(path.join(os.tmpdir(), 'prepare-victim-'));
    const moved = path.join(os.tmpdir(), `prepare-moved-by-head-${process.pid}`);
    roots.push(victim, moved);
    fs.writeFileSync(path.join(victim, 'precious.txt'), 'keep');
    fs.chmodSync(path.join(victim, 'precious.txt'), 0o400);
    const fx = withHeadTest(makeFixture(), (f) => headTestSource(f, [
      "test('swap the scratch directory for a link', () => {",
      '  const scratch = path.dirname(process.cwd());',
      `  fs.renameSync(scratch, ${JSON.stringify(moved)});`,
      `  fs.symlinkSync(${JSON.stringify(victim)}, scratch);`,
      '});',
    ]));
    const r = prepareReview(opts(fx, FIRST_ROUND));
    expect(r.ok).toBe(true);
    expect(fs.statSync(path.join(victim, 'precious.txt')).mode & 0o777).toBe(0o400); // no permission of the link's target was rewritten
    expect(fs.readFileSync(path.join(victim, 'precious.txt'), 'utf8')).toBe('keep');
  }, 30000);

  it('a cleanup that fails is reported with the result instead of being thrown', () => {
    if (!NOT_ROOT) return; // root is not stopped by a read-only directory
    const fx = withHeadTest(makeFixture(), (f) => headTestSource(f, [
      "test('make the state root read-only', () => {",
      '  fs.chmodSync(STATE_ROOT, 0o500);',
      '});',
    ]));
    let r;
    try {
      expect(() => { r = prepareReview(opts(fx, FIRST_ROUND)); }).not.toThrow();
    } finally {
      fs.chmodSync(stateRootOf(fx), 0o755);
      for (const n of fs.readdirSync(stateRootOf(fx))) if (n.startsWith('.staging-')) removePrepared(path.join(stateRootOf(fx), n));
    }
    expect(r).toMatchObject({ ok: false, status: 'PREPARE_FAILED' });
    expect(r.detail).toMatch(/could not remove/);
  }, 30000);
});

describe('the baseline run is sandboxed like a local-ci step (finding 2)', () => {
  const CANARIES = { PREPARE_CANARY_API_TOKEN: 'canary-token-value-0123456789', PREPARE_CANARY_PLAIN: 'canary-plain-value', AWS_SECRET_ACCESS_KEY: 'canary-aws-secret-0123' };

  function withEnv(vars, fn) {
    const saved = {};
    for (const [k, v] of Object.entries(vars)) { saved[k] = process.env[k]; process.env[k] = v; }
    try {
      return fn();
    } finally {
      for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    }
  }

  it('sees only the allowlisted environment, CI and a scratch HOME that is gone afterwards', () => {
    const fx = withHeadTest(makeFixture(), (f) => headTestSource(f, [
      "test('what the baseline sees', () => {",
      '  const home = process.env.HOME;',
      '  let homeWritable = false;',
      "  try { fs.writeFileSync(path.join(home, '.gitconfig'), '[user]\\n'); homeWritable = true; } catch (e) { /* read-only home */ }",
      '  observe({ home, homeExists: fs.existsSync(home), homeWritable, env: process.env });',
      '});',
    ]));
    const r = withEnv(CANARIES, () => prepareReview(opts(fx, FIRST_ROUND)));
    expect(r).toMatchObject({ ok: true, baseline: { ran: true, exitCode: 0 } });
    const seen = observed(fx);
    for (const name of Object.keys(CANARIES)) expect(seen.env[name]).toBeUndefined();
    // NODE_TEST_* are set by `node --test` itself for the file it runs; everything else must come from the allowlist
    // or be one of the variables the baseline sets on purpose.
    const allowed = new Set([...BASELINE_ENV_ALLOWLIST, 'HOME', 'CI', 'PATH', 'GIT_CEILING_DIRECTORIES', '__CF_USER_TEXT_ENCODING']);
    expect(Object.keys(seen.env).filter((name) => !allowed.has(name) && !name.startsWith('NODE_TEST_'))).toEqual([]);
    expect(seen.env.CI).toBe('true');
    expect(seen.env.NODE_PATH).toBeUndefined(); // no node_modules to point it at
    expect(seen.home).not.toBe(os.homedir());
    expect(seen.home).not.toBe(process.env.HOME);
    expect(seen).toMatchObject({ homeExists: true, homeWritable: true });
    expect(fs.existsSync(seen.home)).toBe(false); // a throwaway: nothing the run wrote into it outlives the run
  }, 30000);

  it('runs against a private copy of node_modules: writes through the working directory or NODE_PATH never reach the real tree', () => {
    const nm = fs.mkdtempSync(path.join(os.tmpdir(), 'prepare-nm-'));
    roots.push(nm);
    write(nm, 'fakedep/index.js', "module.exports = 'fakedep-ok';\n");
    const fx = withHeadTest(makeFixture(), (f) => headTestSource(f, [
      "test('use and abuse node_modules', () => {",
      "  const out = { value: require('fakedep'), resolved: require.resolve('fakedep'), nodePath: process.env.NODE_PATH };",
      "  fs.writeFileSync(path.join(process.cwd(), 'node_modules', 'fakedep', 'index.js'), \"module.exports = 'poisoned-via-cwd';\\n\");",
      "  fs.writeFileSync(path.join(process.cwd(), 'node_modules', 'planted-via-cwd.txt'), 'x');",
      "  fs.writeFileSync(path.join(process.env.NODE_PATH, 'planted-via-node-path.txt'), 'x');",
      '  observe(out);',
      '});',
    ]));
    const r = prepareReview(opts(fx, { nodeModules: nm, ...FIRST_ROUND }));
    expect(r).toMatchObject({ ok: true, baseline: { ran: true, exitCode: 0 } });
    const seen = observed(fx);
    expect(seen.value).toBe('fakedep-ok'); // the copy serves the head's requires
    const realNm = fs.realpathSync(nm);
    expect(seen.resolved.startsWith(realNm + path.sep)).toBe(false);
    expect(seen.nodePath.startsWith(realNm)).toBe(false);
    expect(fs.readFileSync(path.join(nm, 'fakedep/index.js'), 'utf8')).toBe("module.exports = 'fakedep-ok';\n");
    expect(fs.readdirSync(nm)).toEqual(['fakedep']);
    expect(readFacts(r).nodeModules).toBe(realNm); // the probe still resolves third-party requires from the real one
  }, 30000);

  it('runs the default jest command from the private copy and records the command with the real path', () => {
    const nm = fs.mkdtempSync(path.join(os.tmpdir(), 'prepare-nm-'));
    roots.push(nm);
    const fx = makeFixture();
    const marker = path.join(fx.root, 'fake-jest-ran.json');
    write(nm, 'jest/bin/jest.js', `require('fs').writeFileSync(${JSON.stringify(marker)}, JSON.stringify({ argv: process.argv.slice(1), cwd: process.cwd() }));\n`);
    const r = prepareReview(opts(fx, { nodeModules: nm, testCommand: undefined, ...FIRST_ROUND }));
    expect(r).toMatchObject({ ok: true, baseline: { ran: true, exitCode: 0 } });
    const realJest = path.join(fs.realpathSync(nm), 'jest', 'bin', 'jest.js');
    const seen = JSON.parse(fs.readFileSync(marker, 'utf8'));
    expect(seen.argv[0]).not.toBe(realJest);
    expect(seen.argv[0].endsWith(path.join('node_modules', 'jest', 'bin', 'jest.js'))).toBe(true);
    expect(seen.argv.slice(1)).toEqual(['--ci', '--runTestsByPath', 'tests/thing.test.js']);
    expect(JSON.parse(fs.readFileSync(r.artifacts['baseline.json'].path, 'utf8')).command).toEqual([process.execPath, realJest, '--ci', '--runTestsByPath']);
  }, 30000);

  it('leaves an absolute symlink out of the private node_modules, so nothing can be written through it', () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'prepare-linked-'));
    const nm = fs.mkdtempSync(path.join(os.tmpdir(), 'prepare-nm-'));
    roots.push(outside, nm);
    write(nm, 'fakedep/index.js', "module.exports = 'fakedep-ok';\n");
    fs.symlinkSync(outside, path.join(nm, 'linked-abs')); // an `npm link`: an absolute target
    fs.symlinkSync('fakedep', path.join(nm, 'linked-rel')); // a relative link inside the tree keeps working, inside the copy
    const fx = withHeadTest(makeFixture(), (f) => headTestSource(f, [
      "test('write through node_modules links', () => {",
      "  const modules = path.join(process.cwd(), 'node_modules');",
      "  const out = { abs: fs.existsSync(path.join(modules, 'linked-abs')), rel: require('linked-rel') };",
      "  try { fs.writeFileSync(path.join(modules, 'linked-abs', 'planted.txt'), 'x'); out.write = 'written'; } catch (e) { out.write = e.code; }",
      "  try { fs.writeFileSync(path.join(modules, 'linked-rel', 'planted-via-rel.txt'), 'x'); out.relWrite = 'written'; } catch (e) { out.relWrite = e.code; }",
      '  observe(out);',
      '});',
    ]));
    const r = prepareReview(opts(fx, { nodeModules: nm, ...FIRST_ROUND }));
    expect(r).toMatchObject({ ok: true, baseline: { ran: true, exitCode: 0 } });
    expect(observed(fx)).toEqual({ abs: false, rel: 'fakedep-ok', write: 'ENOENT', relWrite: 'written' });
    expect(fs.readdirSync(outside)).toEqual([]);
    expect(fs.existsSync(path.join(nm, 'fakedep', 'planted-via-rel.txt'))).toBe(false); // the relative link led into the copy, not the real tree
    expect(JSON.parse(fs.readFileSync(r.artifacts['baseline.json'].path, 'utf8')).skippedLinks).toEqual([`linked-abs -> ${outside}`]);
  }, 30000);

  it('a git command the baseline runs in its working directory is outside any repository, not the maintainer\'s', () => {
    const fx = withHeadTest(makeFixture(), (f) => headTestSource(f, [
      "test('git in the working directory', () => {",
      "  const { spawnSync } = require('child_process');",
      "  const r = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' });",
      '  observe({ cwd: process.cwd(), status: r.status, out: String(r.stdout).trim(), err: String(r.stderr).trim() });',
      '});',
    ]));
    // The scratch directory is made under os.tmpdir(). A setup that keeps its temp files in the checkout puts it inside
    // the repository: without a ceiling git would find that repository from the working directory and act on it.
    const inRepoTmp = path.join(fx.root, '.tmp');
    fs.mkdirSync(inRepoTmp);
    tmpSpy.mockReturnValue(inRepoTmp);
    let r;
    try {
      r = prepareReview(opts(fx, FIRST_ROUND));
    } finally {
      tmpSpy.mockReturnValue(fileTmp);
    }
    expect(r.ok).toBe(true);
    expect(observed(fx)).toMatchObject({ status: 128, out: '', err: expect.stringMatching(/not a git repository/i) });
  }, 30000);

  it('a head that carries its own node_modules is refused rather than mixed with the provided one', () => {
    const nm = fs.mkdtempSync(path.join(os.tmpdir(), 'prepare-nm-'));
    roots.push(nm);
    write(nm, 'fakedep/index.js', 'module.exports = 1;\n');
    const fx0 = makeFixture();
    write(fx0.root, 'node_modules/committed.txt', 'in the head tree\n');
    git(fx0.root, ['add', '-f', 'node_modules/committed.txt']);
    git(fx0.root, ['commit', '-q', '-m', 'commit a node_modules']);
    const head = git(fx0.root, ['rev-parse', 'HEAD']);
    git(fx0.root, ['update-ref', 'refs/heads/pr', head]);
    const r = prepareReview(opts({ ...fx0, head }, { nodeModules: nm, ...FIRST_ROUND }));
    expect(r).toMatchObject({ ok: false, status: 'PREPARE_FAILED', reason: 'baseline-not-run', stage: 'baseline' });
    expect(r.detail).toContain('node_modules');
    expect(stateEntries(fx0)).toEqual([]);
  }, 30000);

  it('scrubs the values of inherited credential-named variables from baseline.log, token-shaped or not', () => {
    const fx = makeFixture();
    const secret = 'plain-looking-value-that-is-no-known-token-shape';
    const real = defaultDeps();
    const deps = {
      run: (argv, o) => (argv[0] === 'tar'
        ? real.run(argv, o)
        : { status: 0, signal: null, stdout: `leaked ${secret} here`, stderr: `and ${secret} there`, timedOut: false, spawnError: null }),
    };
    const r = withEnv({ PREPARE_CANARY_API_KEY: secret }, () => prepareReview(opts(fx, FIRST_ROUND), deps));
    expect(r.ok).toBe(true);
    const log = fs.readFileSync(r.artifacts['baseline.log'].path, 'utf8');
    expect(log).not.toContain(secret);
    expect(log).toContain('leaked [REDACTED] here');
    expect(log).toContain('and [REDACTED] there');
  }, 30000);

  it('uses the same allowlist and credential-name rule as the local-ci gate runner it follows', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'lib', 'local-ci-runner.js'), 'utf8');
    const list = /const ENV_ALLOWLIST = \[([^\]]*)\];/.exec(source);
    const rule = /const SECRET_NAME_RE = (\/.*\/[a-z]*);/.exec(source);
    const length = /const MIN_SECRET_LENGTH = (\d+);/.exec(source);
    // If local-ci-runner.js stops declaring them in this form, change this test and review-prepare-runtime.js together.
    expect([list, rule, length].every((m) => m !== null)).toBe(true);
    expect([...list[1].matchAll(/'([^']+)'/g)].map((m) => m[1])).toEqual([...BASELINE_ENV_ALLOWLIST]);
    expect(String(SECRET_NAME_RE)).toBe(rule[1]);
    expect(MIN_SECRET_LENGTH).toBe(Number(length[1]));
  });
});

describe('reuse is keyed by every input and never replaces another preparation (finding 3)', () => {
  it('a different range decision for the same base and head is not served from the old directory', () => {
    const fx = makeFixture();
    const first = prepareReview(opts(fx, FIRST_ROUND));
    expect(first.range).toMatchObject({ mode: 'full', reason: 'first-round', unvouched: [] });
    // the same base and head, now with a reviewed head nobody vouched the history of: also a full range, other reason
    const second = prepareReview(opts(fx, { remediationShas: [] }));
    expect(second.reused).toBe(false);
    expect(second.range).toMatchObject({ mode: 'full', reason: 'unvouched-history' });
    expect(second.range.unvouched.length).toBeGreaterThan(0);
    expect(second.dir).not.toBe(first.dir);
    expect(JSON.parse(fs.readFileSync(second.manifestPath, 'utf8')).range.reason).toBe('unvouched-history');
    const again = prepareReview(opts(fx, FIRST_ROUND));
    expect(again).toMatchObject({ reused: true, dir: first.dir });
    expect(again.range.reason).toBe('first-round');
  }, 30000);

  it('a different nodeModules is a different preparation and facts record the one used', () => {
    const one = fs.mkdtempSync(path.join(os.tmpdir(), 'prepare-nm-'));
    const two = fs.mkdtempSync(path.join(os.tmpdir(), 'prepare-nm-'));
    roots.push(one, two);
    const fx = makeFixture();
    const first = prepareReview(opts(fx, { nodeModules: one }));
    const second = prepareReview(opts(fx, { nodeModules: two }));
    expect(second.reused).toBe(false);
    expect(second.dir).not.toBe(first.dir);
    expect(readFacts(first).nodeModules).toBe(fs.realpathSync(one));
    expect(readFacts(second).nodeModules).toBe(fs.realpathSync(two));
    expect(prepareReview(opts(fx, { nodeModules: one }))).toMatchObject({ reused: true, dir: first.dir });
  }, 30000);

  it('a different baselineTimeoutMs is a different preparation', () => {
    const fx = makeFixture();
    const first = prepareReview(opts(fx));
    const second = prepareReview(opts(fx, { baselineTimeoutMs: 123456 }));
    expect(second.reused).toBe(false);
    expect(second.dir).not.toBe(first.dir);
    expect(prepareReview(opts(fx))).toMatchObject({ reused: true, dir: first.dir });
  }, 30000);

  it('a preparation with other inputs never removes or rewrites a directory another reader holds', () => {
    const fx = makeFixture();
    const first = prepareReview(opts(fx));
    const heldFile = path.join(first.dir, 'reader-holds-this.txt');
    fs.writeFileSync(heldFile, 'held');
    const hashesBefore = { ...first.hashes };
    const second = prepareReview(opts(fx, { testFiles: ['tests/thing.test.js'], baselineTimeoutMs: 99999 }));
    expect(second.ok).toBe(true);
    expect(second.dir).not.toBe(first.dir);
    expect(fs.readFileSync(heldFile, 'utf8')).toBe('held');
    expect(first.dir.startsWith(path.dirname(second.dir) + path.sep)).toBe(true); // both live under the head's directory
    const again = prepareReview(opts(fx));
    expect(again).toMatchObject({ reused: true, dir: first.dir });
    expect(again.hashes).toEqual(hashesBefore);
  }, 30000);

  it("another preparation's directory under this one's name is rebuilt, not reused", () => {
    const fx = makeFixture();
    const a = prepareReview(opts(fx, { ...FIRST_ROUND, baselineTimeoutMs: 60000 }));
    const b = prepareReview(opts(fx, { ...FIRST_ROUND, baselineTimeoutMs: 120000 }));
    expect(a.dir).not.toBe(b.dir);
    // everything else about the two is identical (the timeout is in no artifact): only the manifest's fingerprint differs
    removePrepared(b.dir);
    fs.cpSync(a.dir, b.dir, { recursive: true });
    const again = prepareReview(opts(fx, { ...FIRST_ROUND, baselineTimeoutMs: 120000 }));
    expect(again.reused).toBe(false);
    expect(JSON.parse(fs.readFileSync(again.manifestPath, 'utf8')).fingerprint).toBe(b.fingerprint);
  }, 30000);
});

describe('the schema moved past the three-dot changedPaths form (finding 4)', () => {
  it('is past version 1', () => {
    expect(SCHEMA_VERSION).toBeGreaterThan(1);
  });

  it('a directory whose manifest says the old schema is rebuilt, not reused', () => {
    const fx = makeFixture();
    const first = prepareReview(opts(fx));
    const manifest = JSON.parse(fs.readFileSync(first.manifestPath, 'utf8'));
    expect(manifest.schema).toBe(SCHEMA_VERSION);
    fs.writeFileSync(first.manifestPath, JSON.stringify({ ...manifest, schema: 1 }));
    const second = prepareReview(opts(fx));
    expect(second.reused).toBe(false);
    expect(JSON.parse(fs.readFileSync(second.manifestPath, 'utf8')).schema).toBe(SCHEMA_VERSION);
    expect(readFacts(second).schema).toBe(SCHEMA_VERSION);
  }, 30000);
});

describe('changedPaths never omits a path the PR changes (finding 5)', () => {
  it('a path the base already has the identical change for is still a changed path, sensitive when the policy says so', () => {
    const fx = makeFixture();
    // The base branch moved past the fork and ALREADY holds the same lib/thing.js change (a squash, a backport, a
    // cherry-pick): the two-argument diff of that tip against the head no longer lists the file, range.diff still does.
    git(fx.root, ['checkout', '-q', '-b', 'moved', fx.base]);
    write(fx.root, 'lib/thing.js', "module.exports = () => 'v2';\n");
    git(fx.root, ['commit', '-q', '-am', 'the same change landed on the base branch first']);
    const movedBase = git(fx.root, ['rev-parse', 'HEAD']);
    const pinned = execFileSync('git', ['diff', '--name-only', '-z', '--no-renames', movedBase, fx.head], { cwd: fx.root, encoding: 'utf8' }).split('\0');
    expect(pinned).not.toContain('lib/thing.js'); // the premise
    const r = prepareReview(opts(fx, { baseSha: movedBase, ...FIRST_ROUND }));
    const facts = readFacts(r);
    const prOwn = execFileSync('git', ['diff', '--name-only', '-z', '--no-renames', `${movedBase}...${fx.head}`], { cwd: fx.root, encoding: 'utf8' }).split('\0').filter((p) => p !== '');
    expect(prOwn).toContain('lib/thing.js');
    for (const p of prOwn) expect(facts.changedPaths).toContain(p); // nothing range.diff shows is missing from the list
    expect(facts.paths.sensitive).toContain('lib/thing.js');
    expect(fs.readFileSync(r.artifacts['range.diff'].path, 'utf8')).toContain('diff --git a/lib/thing.js b/lib/thing.js');
    // one count per changed path (the slicing check matches them name for name), in git's own byte order
    expect(facts.numstat.map((f) => f.path)).toEqual(facts.changedPaths);
    expect(facts.totals.files).toBe(facts.changedPaths.length);
    expect([...facts.changedPaths].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)))).toEqual(facts.changedPaths);
  }, 30000);
});

describe('the probe refuses a path that leaves the snapshot through a committed symlink (finding 6)', () => {
  it('read and load follow no symlink out of the snapshot, and still follow one inside it', () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'prepare-outside-'));
    roots.push(outside);
    const marker = path.join(outside, 'evil-ran.txt');
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'TOP-SECRET');
    fs.writeFileSync(path.join(outside, 'evil.js'), `require('fs').writeFileSync(${JSON.stringify(marker)}, 'ran'); module.exports = 'evil';\n`);
    const fx0 = makeFixture();
    fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(fx0.root, 'lib/leak.txt'));
    fs.symlinkSync(path.join(outside, 'evil.js'), path.join(fx0.root, 'lib/leak.js'));
    fs.symlinkSync(outside, path.join(fx0.root, 'lib/leakdir'));
    fs.symlinkSync(path.join(outside, 'gone.txt'), path.join(fx0.root, 'lib/dangling.txt'));
    fs.symlinkSync('thing.js', path.join(fx0.root, 'lib/alias.js'));
    git(fx0.root, ['add', '-A']);
    git(fx0.root, ['commit', '-q', '-m', 'symlinks']);
    const head = git(fx0.root, ['rev-parse', 'HEAD']);
    git(fx0.root, ['update-ref', 'refs/heads/pr', head]);
    const fx = { ...fx0, head };
    const r = prepareReview(opts(fx, FIRST_ROUND));
    expect(r.ok).toBe(true);
    const script = `
      const probe = require(${JSON.stringify(r.artifacts['probe.js'].path)});
      const attempts = {
        readLeak: () => probe.read('lib/leak.txt'),
        loadLeak: () => probe.load('lib/leak.js'),
        readThroughDir: () => probe.read('lib/leakdir/secret.txt'),
        readDangling: () => probe.read('lib/dangling.txt'),
        readLexical: () => probe.read('../../x'),
        readAlias: () => probe.read('lib/alias.js'),
        loadAlias: () => probe.load('lib/alias.js')(),
        readMissing: () => probe.read('lib/nope.txt'),
      };
      const out = {};
      for (const [name, attempt] of Object.entries(attempts)) {
        try { out[name] = { ok: true, value: String(attempt()) }; } catch (e) { out[name] = { ok: false, error: e.message }; }
      }
      process.stdout.write(JSON.stringify(out));
    `;
    const p = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8' });
    expect(p.stderr).toBe('');
    const out = JSON.parse(p.stdout);
    for (const name of ['readLeak', 'loadLeak', 'readThroughDir', 'readDangling', 'readLexical']) {
      expect(out[name]).toMatchObject({ ok: false, error: expect.stringMatching(/escapes the snapshot/) });
    }
    expect(JSON.stringify(out)).not.toContain('TOP-SECRET');
    expect(fs.existsSync(marker)).toBe(false); // the module outside was never executed
    expect(out.readAlias).toEqual({ ok: true, value: "module.exports = () => 'v2';\n" });
    expect(out.loadAlias).toEqual({ ok: true, value: 'v2' });
    expect(out.readMissing).toMatchObject({ ok: false, error: expect.stringMatching(/ENOENT/) }); // an absent file is still just absent
  }, 30000);
});

describe('an unreadable guidance file at the base is a named failure, not the default policy (finding 7)', () => {
  it.each([
    ['REVIEW.md', 'policy/REVIEW.md', POLICY_BASE],
    ['.github/CODEOWNERS', 'CODEOWNERS.real', 'lib/** @team/core\n'],
  ])('%s as a symlink', (rel, target, content) => {
    const fx = makeFixture();
    const { baseSha, headSha } = baseWithSymlink(fx, rel, target, content);
    const r = prepareReview(opts(fx, { baseSha, headSha, headRef: undefined, ...FIRST_ROUND }));
    expect(r).toMatchObject({ ok: false, status: 'PREPARE_FAILED', reason: 'base-guidance-unreadable', stage: 'facts' });
    expect(r.detail).toContain(rel);
    expect(stateEntries(fx)).toEqual([]);
  }, 30000);
});
