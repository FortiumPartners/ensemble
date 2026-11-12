'use strict';

/**
 * The delta plan through the real preparation step (kata 801a): a real git repository, the real `git`, and
 * pr-review-prepare-cli.js as an entry point. facts.json `deltaPlan` is what a re-review reads, so these tests run
 * prepare and read what it published, never a hand-built plan.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { prepareReview, removePrepared, defaultDeps, scanReferenceLines, scanNameLines } = require('../lib/pr-review-prepare');

const CLI = path.join(__dirname, '..', 'lib', 'pr-review-prepare-cli.js');
const NODE_TEST = [process.execPath, '--test'];
const POLICY = '# Review\n\n```ensemble-review-policy\n{"sensitivePaths":["secure/**"],"highPaths":["core/**"]}\n```\n';
const roots = [];

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } }).trim();
}

function write(root, rel, content) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

/**
 * base -> reviewed (R) -> head. `change(root)` makes the head commit, a remediation commit on top of R. With `middle(root)`
 * a commit U is made between them: it is in the history and readable, but no round ever reviewed it. `consumers` are
 * extra files the base holds (rel path -> content) that the delta leaves alone.
 * The repository holds a module with an importer, a test that imports it, a test that only carries its name, an
 * unrelated module and a module whose name has a space in it.
 */
function fixture(change, middle, consumers = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'delta-prepare-'));
  roots.push(root);
  git(root, ['init', '-q', '-b', 'main']);
  write(root, 'REVIEW.md', POLICY);
  write(root, 'src/thing.js', "module.exports = () => 'v0';\n");
  write(root, 'src/app.js', "const thing = require('./thing');\nmodule.exports = () => thing();\n");
  write(root, 'src/unrelated.js', 'module.exports = 1;\n');
  write(root, 'src/with space.js', 'module.exports = 2;\n');
  write(root, 'src/needs-space.js', "module.exports = require('./with space');\n");
  write(root, 'tests/app-flow.test.js', "require('../src/app');\n");
  write(root, 'tests/thing.test.js', "require('node:test')('thing', () => {});\n");
  write(root, 'core/engine.js', 'module.exports = 0;\n');
  write(root, 'secure/keys.js', 'module.exports = 0;\n');
  for (const [rel, content] of Object.entries(consumers)) write(root, rel, content);
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'base']);
  const base = git(root, ['rev-parse', 'HEAD']);
  write(root, 'src/unrelated.js', 'module.exports = 11;\n');
  git(root, ['commit', '-q', '-am', 'reviewed']);
  const reviewed = git(root, ['rev-parse', 'HEAD']);
  let unreviewed = null;
  if (middle) {
    middle(root);
    git(root, ['add', '-A']);
    git(root, ['commit', '-q', '-m', 'pushed outside the review loop']);
    unreviewed = git(root, ['rev-parse', 'HEAD']);
  }
  change(root);
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'remediation']);
  const head = git(root, ['rev-parse', 'HEAD']);
  git(root, ['update-ref', 'refs/heads/pr', head]);
  return { root, base, reviewed, unreviewed, head };
}

/** The options a caller builds from the review-state report of a completed round that reviewed `fx.reviewed` against `fx.base`. */
const options = (fx, overrides = {}) => ({
  repoRoot: fx.root,
  runId: 'run-delta',
  baseSha: fx.base,
  headSha: fx.head,
  headRef: 'refs/heads/pr',
  lastReviewedSha: fx.reviewed,
  reviewedHeadSha: fx.reviewed,
  reviewedBaseSha: fx.base,
  remediationShas: [fx.head],
  testCommand: NODE_TEST,
  nodeModules: path.join(fx.root, 'no-node-modules'),
  ...overrides,
});

/**
 * dev holds d1 and the PR forked from it: base d1 -> reviewed R -> head H. main moved on without it (m1). The last round
 * reviewed R against dev; the PR is then retargeted at main, so the commits are the same and the base is not.
 */
function retargetFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'delta-prepare-'));
  roots.push(root);
  const commit = (rel, content, message) => {
    write(root, rel, content);
    git(root, ['add', '-A']);
    git(root, ['commit', '-q', '-m', message]);
    return git(root, ['rev-parse', 'HEAD']);
  };
  git(root, ['init', '-q', '-b', 'main']);
  commit('REVIEW.md', POLICY, 'm0');
  git(root, ['checkout', '-q', '-b', 'dev']);
  const dev = commit('src/dev-feature.js', 'module.exports = 1;\n', 'd1');
  git(root, ['checkout', '-q', '-b', 'pr']);
  const reviewed = commit('src/pr-a.js', 'module.exports = 2;\n', 'reviewed');
  const head = commit('src/pr-b.js', 'module.exports = 3;\n', 'remediation');
  git(root, ['update-ref', 'refs/heads/pr', head]);
  git(root, ['checkout', '-q', 'main']);
  const main = commit('src/main-only.js', 'module.exports = 4;\n', 'm1');
  return { root, dev, main, reviewed, head };
}

/** Reviewed against dev; `baseSha` is what the plan resolves now. */
const retargetOptions = (fx, overrides = {}) => ({
  repoRoot: fx.root,
  runId: 'run-retarget',
  baseSha: fx.dev,
  headSha: fx.head,
  headRef: 'refs/heads/pr',
  lastReviewedSha: fx.reviewed,
  reviewedHeadSha: fx.reviewed,
  reviewedBaseSha: fx.dev,
  remediationShas: [fx.head],
  testCommand: NODE_TEST,
  nodeModules: path.join(fx.root, 'no-node-modules'),
  ...overrides,
});

function factsOf(result) {
  return JSON.parse(fs.readFileSync(result.artifacts['facts.json'].path, 'utf8'));
}

let tmp;
let tmpSpy;
beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'delta-prepare-tmp-'));
  tmpSpy = jest.spyOn(os, 'tmpdir').mockReturnValue(tmp);
});
afterAll(() => {
  if (tmpSpy) tmpSpy.mockRestore();
  for (const r of roots.splice(0)) removePrepared(r);
  if (tmp) removePrepared(tmp);
});

describe('facts.json deltaPlan, from a real repository', () => {
  it('a vouched remediation commit is a delta whose read set holds the importers and the tests of what it changed', () => {
    const fx = fixture((root) => write(root, 'src/thing.js', "module.exports = () => 'v1';\n"));
    const result = prepareReview(options(fx));
    expect(result).toMatchObject({ ok: true, mode: 'delta' });
    const facts = factsOf(result);
    expect(facts.delta).toEqual({ lastReviewedSha: fx.reviewed, reviewedHeadSha: fx.reviewed, reviewedBaseSha: fx.base, changedPaths: ['src/thing.js'], numstat: [expect.objectContaining({ path: 'src/thing.js', binary: false })] });
    expect(facts.deltaPlan.mode).toBe('delta');
    expect(facts.deltaPlan.readSet.map((e) => e.path)).toEqual(['src/app.js', 'src/thing.js', 'tests/thing.test.js']);
    // the importer of the importer is not part of the radius, and nothing unrelated is read
    expect(facts.deltaPlan.readSet.map((e) => e.path)).not.toContain('tests/app-flow.test.js');
    expect(facts.deltaPlan.readSet.map((e) => e.path)).not.toContain('src/unrelated.js');
  });

  it('finds the importers of a file whose name has a space, and a deleted file keeps its importers', () => {
    const fx = fixture((root) => {
      write(root, 'src/with space.js', 'module.exports = 3;\n');
      fs.rmSync(path.join(root, 'src/unrelated.js'));
    });
    const facts = factsOf(prepareReview(options(fx)));
    expect(facts.deltaPlan.mode).toBe('delta');
    expect(facts.deltaPlan.readSet.map((e) => e.path)).toEqual(['src/needs-space.js', 'src/unrelated.js', 'src/with space.js']);
  });

  it('a delta touching a High path is a full re-read', () => {
    const fx = fixture((root) => {
      write(root, 'src/thing.js', "module.exports = () => 'v1';\n");
      write(root, 'core/engine.js', 'module.exports = 9;\n');
    });
    const facts = factsOf(prepareReview(options(fx)));
    expect(facts.deltaPlan).toEqual({ mode: 'full', reasons: ['high-path-touched'], readSet: [] });
  });

  it('a delta touching a sensitive path is a full re-read', () => {
    const fx = fixture((root) => write(root, 'secure/keys.js', 'module.exports = 9;\n'));
    expect(factsOf(prepareReview(options(fx))).deltaPlan.reasons).toEqual(['sensitive-path-touched']);
  });

  it('a delta that changes source the graph cannot read is a full re-read', () => {
    const fx = fixture((root) => write(root, 'tools/run.sh', '#!/bin/sh\necho hi\n'));
    expect(factsOf(prepareReview(options(fx))).deltaPlan.reasons).toEqual(['unanalyzed-source-changed']);
  });

  it('a last reviewed head this repository does not hold is a full re-read, never a delta', () => {
    const fx = fixture((root) => write(root, 'src/thing.js', "module.exports = () => 'v1';\n"));
    const never = 'd'.repeat(40);
    const result = prepareReview(options(fx, { lastReviewedSha: never }));
    expect(result).toMatchObject({ ok: true, mode: 'full' });
    const facts = factsOf(result);
    expect(facts.delta).toBeNull();
    expect(facts.deltaPlan).toMatchObject({ mode: 'full', readSet: [] });
    expect(facts.deltaPlan.reasons[0]).toBe('range-is-full');
  });

  it('the first round and a history nobody vouched for are full re-reads and keep the range reason', () => {
    const first = fixture((root) => write(root, 'src/thing.js', "module.exports = () => 'v1';\n"));
    const noLast = options(first);
    delete noLast.lastReviewedSha;
    expect(factsOf(prepareReview(noLast)).deltaPlan).toEqual({ mode: 'full', reasons: ['range-is-full', 'first-round'], readSet: [] });

    const unvouched = fixture((root) => write(root, 'src/thing.js', "module.exports = () => 'v1';\n"));
    const result = prepareReview(options(unvouched, { remediationShas: [] }));
    expect(factsOf(result).deltaPlan).toEqual({ mode: 'full', reasons: ['range-is-full', 'unvouched-history'], readSet: [] });
  });

  it('a repository scan that fails is a full re-read, not a failed preparation and not a delta with no radius', () => {
    const fx = fixture((root) => write(root, 'src/thing.js', "module.exports = () => 'v1';\n"));
    const real = defaultDeps();
    const deps = { ...real, git: (args, o) => (args[0] === 'grep' ? { status: 2, stdout: '', stderr: 'boom' } : real.git(args, o)) };
    const result = prepareReview(options(fx), deps);
    expect(result.ok).toBe(true);
    expect(factsOf(result).deltaPlan).toEqual({ mode: 'full', reasons: ['import-graph-unavailable'], readSet: [] });
  });

  // The range decision (chooseReviewRange) only checks that the commits since the last reviewed head are vouched for. A head
  // that is readable and in history is not thereby a head any round reviewed, so "seen" comes from the review state.
  const withUnreviewedCommit = () => fixture(
    (root) => write(root, 'src/thing.js', "module.exports = () => 'v1';\n"),
    (root) => write(root, 'src/unreviewed.js', 'module.exports = 5;\n'),
  );

  it('a readable commit no round reviewed is not a head the review state has seen: a full re-read, never a delta', () => {
    const fx = withUnreviewedCommit();
    // no record, a record of another head, a record of a later head: none of them says a round reviewed U
    for (const reviewedHeadSha of [undefined, fx.reviewed, fx.head]) {
      const result = prepareReview(options(fx, { lastReviewedSha: fx.unreviewed, reviewedHeadSha }));
      expect(result).toMatchObject({ ok: true, mode: 'delta' });
      const facts = factsOf(result);
      expect(facts.delta.reviewedHeadSha).toBe(reviewedHeadSha || null);
      expect(facts.deltaPlan).toEqual({ mode: 'full', reasons: ['head-never-seen'], readSet: [] });
    }
  });

  it('the record decides: the same commit, recorded by the state as reviewed, is a delta', () => {
    const fx = withUnreviewedCommit();
    const facts = factsOf(prepareReview(options(fx, { lastReviewedSha: fx.unreviewed, reviewedHeadSha: fx.unreviewed })));
    expect(facts.deltaPlan.mode).toBe('delta');
    expect(facts.deltaPlan.readSet.map((e) => e.path)).toEqual(['src/app.js', 'src/thing.js', 'tests/thing.test.js']);
  });

  it('a reviewed head that is not a full object id is refused, never read as "unseen"', () => {
    const fx = fixture((root) => write(root, 'src/thing.js', "module.exports = () => 'v1';\n"));
    expect(prepareReview(options(fx, { reviewedHeadSha: 'main' }))).toMatchObject({ ok: false, status: 'PREPARE_FAILED', reason: 'invalid-input' });
  });

  it('preparations with different review records have directories of their own, so a reader holding one never loses it', () => {
    const fx = fixture((root) => write(root, 'src/thing.js', "module.exports = () => 'v1';\n"));
    const recorded = prepareReview(options(fx));
    const unrecorded = prepareReview(options(fx, { reviewedHeadSha: undefined }));
    expect(unrecorded.dir).not.toBe(recorded.dir);
    expect(fs.existsSync(recorded.dir)).toBe(true);
    expect(factsOf(recorded).deltaPlan.mode).toBe('delta');
    expect(factsOf(unrecorded).deltaPlan.reasons).toEqual(['head-never-seen']);
  });

  it('a record naming another base is a full re-read too, and has a directory of its own', () => {
    const fx = fixture((root) => write(root, 'src/thing.js', "module.exports = () => 'v1';\n"));
    const recorded = prepareReview(options(fx));
    const otherBase = prepareReview(options(fx, { reviewedBaseSha: fx.head }));
    expect(otherBase.dir).not.toBe(recorded.dir);
    expect(fs.existsSync(recorded.dir)).toBe(true);
    expect(factsOf(otherBase).deltaPlan.reasons).toEqual(['base-moved']);
  });

  it('the same inputs publish the same facts: the plan is part of what a reuse re-derives', () => {
    const fx = fixture((root) => write(root, 'src/thing.js', "module.exports = () => 'v1';\n"));
    const first = prepareReview(options(fx));
    const second = prepareReview(options(fx));
    expect(second.reused).toBe(true);
    expect(second.hashes['facts.json']).toBe(first.hashes['facts.json']);
  });
});

describe('a retargeted PR (AC1: the base the last round reviewed is compared)', () => {
  it('the unchanged base keeps the delta: the commits since the last round, and nothing else', () => {
    const fx = retargetFixture();
    const facts = factsOf(prepareReview(retargetOptions(fx)));
    expect(facts.deltaPlan).toEqual({ mode: 'delta', reasons: ['delta-since-last-review'], readSet: [{ path: 'src/pr-b.js', reasons: ['changed'] }] });
  });

  it('a base other than the reviewed one is a full re-read, though review-range still offers the delta', () => {
    const fx = retargetFixture();
    const result = prepareReview(retargetOptions(fx, { baseSha: fx.main }));
    expect(result).toMatchObject({ ok: true, mode: 'delta' });
    const facts = factsOf(result);
    // what the PR changes against the new base is not what the last round read: the delta would have hidden all of it
    expect(facts.changedPaths).toEqual(['src/dev-feature.js', 'src/main-only.js', 'src/pr-a.js', 'src/pr-b.js']);
    expect(facts.deltaPlan).toEqual({ mode: 'full', reasons: ['base-moved'], readSet: [] });
  });

  it('no record of the reviewed base is a full re-read, never a delta', () => {
    const fx = retargetFixture();
    const facts = factsOf(prepareReview(retargetOptions(fx, { reviewedBaseSha: undefined })));
    expect(facts.delta.reviewedBaseSha).toBeNull();
    expect(facts.deltaPlan).toEqual({ mode: 'full', reasons: ['reviewed-base-unknown'], readSet: [] });
  });

  it('a reviewed base that is not a full object id is refused, never read as "unknown"', () => {
    const fx = retargetFixture();
    expect(prepareReview(retargetOptions(fx, { reviewedBaseSha: 'dev' }))).toMatchObject({ ok: false, status: 'PREPARE_FAILED', reason: 'invalid-input' });
  });
});

describe('every reference form reaches the read set, through the real scan (AC1)', () => {
  // Each consumer loads src/thing.js in one form the first graph read as nothing. The delta changes only src/thing.js.
  const CONSUMERS = {
    'src/f-actual.js': "const real = jest.requireActual('./thing');\n",
    'src/f-resolve.js': "const p = require.resolve('./thing');\n",
    'src/f-template.js': 'const t = require(`./thing`);\n',
    'src/f-multiline.js': "const t = require(\n  './thing'\n);\n",
    'src/f-interpolated.js': 'const base = __dirname;\nconst t = require(`${base}/thing.js`);\n',
    'src/f-computed.js': "const file = require('path').join(__dirname, 'thing.js');\nconst t = require(file);\n",
    'src/page.html': '<script src="./thing.js"></script>\n',
    'src/page-plain.html': '<script src="thing.js"></script>\n',
    'ui/page-root.html': '<script src="/src/thing.js"></script>\n',
    // a computed specifier that names nothing the delta changed, and a literal one that names something else
    'src/f-unrelated.js': 'const t = require(somethingElse);\n',
    'src/f-other.js': "const t = require('./unrelated');\n",
  };
  let facts;

  beforeAll(() => {
    const fx = fixture((root) => write(root, 'src/thing.js', "module.exports = () => 'v1';\n"), undefined, CONSUMERS);
    facts = factsOf(prepareReview(options(fx)));
  });

  const reasonsOf = (file) => (facts.deltaPlan.readSet.find((entry) => entry.path === file) || { reasons: null }).reasons;

  it.each([
    ['jest.requireActual', 'src/f-actual.js', ['caller-of:src/thing.js']],
    ['require.resolve', 'src/f-resolve.js', ['caller-of:src/thing.js']],
    ['a template literal without interpolation', 'src/f-template.js', ['caller-of:src/thing.js']],
    ['an argument on the line after the call', 'src/f-multiline.js', ['caller-of:src/thing.js', 'names:src/thing.js']],
    ['an interpolated template literal', 'src/f-interpolated.js', ['names:src/thing.js']],
    ['a computed specifier whose file name is spelled in the file', 'src/f-computed.js', ['names:src/thing.js']],
    ['an HTML script src', 'src/page.html', ['caller-of:src/thing.js']],
    ['an HTML script src without ./', 'src/page-plain.html', ['caller-of:src/thing.js']],
    ['an HTML root-relative script src', 'ui/page-root.html', ['caller-of:src/thing.js']],
  ])('%s', (_form, consumer, reasons) => {
    expect(facts.deltaPlan.mode).toBe('delta');
    expect(reasonsOf(consumer)).toEqual(reasons);
  });

  it('and nothing else: a computed specifier that names no changed file, and a file that loads something else, are not read', () => {
    expect(reasonsOf('src/f-unrelated.js')).toBeNull();
    expect(reasonsOf('src/f-other.js')).toBeNull();
    expect(facts.deltaPlan.readSet.map((e) => e.path)).toEqual([
      'src/app.js', 'src/f-actual.js', 'src/f-computed.js', 'src/f-interpolated.js', 'src/f-multiline.js', 'src/f-resolve.js',
      'src/f-template.js', 'src/page-plain.html', 'src/page.html', 'src/thing.js', 'tests/thing.test.js', 'ui/page-root.html',
    ]);
  });

  it('a name scan that fails is a full re-read, not a failed preparation and not a delta that missed the computed files', () => {
    const fx = fixture((root) => write(root, 'src/thing.js', "module.exports = () => 'v1';\n"), undefined, CONSUMERS);
    const real = defaultDeps();
    const deps = { ...real, git: (args, o) => (args[0] === 'grep' && args.includes('-F') ? { status: 2, stdout: '', stderr: 'boom' } : real.git(args, o)) };
    const result = prepareReview(options(fx), deps);
    expect(result.ok).toBe(true);
    expect(factsOf(result).deltaPlan).toEqual({ mode: 'full', reasons: ['name-scan-unavailable'], readSet: [] });
  });
});

describe('the repository scans do not depend on the directory they run in', () => {
  // `git grep` has no --full-tree: without a top-anchored pathspec it searches only the subtree of its working directory
  it('the reference scan from a subdirectory finds what it finds from the top', () => {
    const fx = fixture((root) => write(root, 'src/thing.js', "module.exports = () => 'v1';\n"));
    const fromTop = scanReferenceLines(defaultDeps(), fx.root, fx.head);
    const fromSubdirectory = scanReferenceLines(defaultDeps(), path.join(fx.root, 'src'), fx.head);
    expect(fromTop.map((line) => line.path)).toContain('tests/app-flow.test.js');
    expect(fromSubdirectory).toEqual(fromTop);
  });

  it('the name scan from a subdirectory finds what it finds from the top', () => {
    const fx = fixture((root) => write(root, 'src/thing.js', "module.exports = () => 'v1';\n"));
    const names = (cwd) => scanNameLines(defaultDeps(), cwd, fx.head, ['tests/app-flow.test.js', 'src/app.js'], ['src/app.js']);
    expect(names(fx.root).map((line) => line.path)).toEqual(['tests/app-flow.test.js']);
    expect(names(path.join(fx.root, 'src'))).toEqual(names(fx.root));
  });

  it('a file whose name has a space, brackets or a leading dash is searched by its literal name', () => {
    const fx = fixture((root) => write(root, 'src/thing.js', "module.exports = () => 'v1';\n"), undefined, {
      'src/we ird[1]/a b.js': 'const t = require(`${base}/thing.js`);\n',
      'src/-dash.js': 'const t = require(`${base}/thing.js`);\n',
    });
    const lines = scanNameLines(defaultDeps(), fx.root, fx.head, ['src/we ird[1]/a b.js', 'src/-dash.js'], ['src/thing.js']);
    expect(lines.map((line) => line.path).sort()).toEqual(['src/-dash.js', 'src/we ird[1]/a b.js']);
  });
});

describe('through the entry point', () => {
  it('pr-review-prepare-cli.js prints the artifacts and its facts.json carries the plan', () => {
    const fx = fixture((root) => write(root, 'src/thing.js', "module.exports = () => 'v1';\n"));
    const run = spawnSync(process.execPath, [CLI], {
      cwd: fx.root,
      input: JSON.stringify({ ...options(fx), repoRoot: undefined }),
      encoding: 'utf8',
    });
    expect(run.status).toBe(0);
    const out = JSON.parse(run.stdout);
    expect(out).toMatchObject({ ok: true, status: 'PREPARED', mode: 'delta' });
    expect(factsOf(out).deltaPlan.readSet.map((e) => e.path)).toEqual(['src/app.js', 'src/thing.js', 'tests/thing.test.js']);
  });
});
