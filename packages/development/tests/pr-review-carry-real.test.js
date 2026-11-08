'use strict';

/**
 * qw98 AC4, the safety property, over REAL git history: a carry round must report exactly what a full re-review would.
 *
 * Every scenario builds a real git repository, settles verdicts at a first head, pushes a fix and runs the second round
 * through the real pieces (the hash step over git, `votes`, `carry` record / plan / reconcile, the state report on disk,
 * `ledger merge`, `planDeltaReview` over the repository's real import graph). The "verifiers" are an ORACLE that reads
 * the repository at a head and says whether the claimed defect is real there: it is what a full re-review would find, so
 * a carried verdict that disagrees with it is a stale carry, which is the failure this feature must never produce.
 *
 * Each scenario seeds a verdict that the push makes stale (the oracle flips) and asserts both that the flip happened
 * (so the scenario is not vacuous) and that the carry round did not keep the old answer. Remove the guard that covers
 * the scenario and its test fails; tests/pr-review-carry.test.js pins each guard on its own.
 *
 * Fixtures live under ~/.omp/pr-review-speedup/qw98/fixtures (never os.tmpdir()), as pr-review-carry-hash.test.js does.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { hashCitations } = require('../lib/pr-review-carry-hash');
const { HANDLERS } = require('../lib/pr-review-cli');
const { planDeltaReview } = require('../lib/pr-review-delta');
const { buildImportGraph } = require('../lib/pr-review-import-graph');
const { parseLsTreeZ, scanReferenceLines, scanNameLines } = require('../lib/pr-review-prepare');
const { REASONS } = require('../lib/pr-review-carry');

const FIXTURE_ROOT = path.join(os.homedir(), '.omp', 'pr-review-speedup', 'qw98', 'fixtures');
const BASE = 'e'.repeat(40);
const PR = '268';
const dirs = [];

const realGit = require('../lib/review-prepare-runtime').defaultDeps().git;

function git(cwd, args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' },
  }).trim();
}

function scratch(prefix) {
  fs.mkdirSync(FIXTURE_ROOT, { recursive: true });
  const dir = fs.mkdtempSync(path.join(FIXTURE_ROOT, prefix));
  dirs.push(dir);
  return dir;
}

/** A repo with a first commit holding `files` (a value `{ link }` is a symlink); `commit(changes)` -> new head sha. */
function makeRepo(files) {
  const root = scratch('real-');
  git(root, ['init', '-q', '-b', 'main']);
  const commit = (changes) => {
    for (const [rel, content] of Object.entries(changes)) {
      const abs = path.join(root, rel);
      fs.rmSync(abs, { force: true });
      if (content === null) continue;
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      if (typeof content === 'object') fs.symlinkSync(content.link, abs);
      else fs.writeFileSync(abs, content);
    }
    git(root, ['add', '-A']);
    git(root, ['commit', '-q', '--allow-empty', '-m', 'c']);
    return git(root, ['rev-parse', 'HEAD']);
  };
  return { root, commit, head: commit(files) };
}

afterAll(() => {
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
});

const pad = (n, marks = {}) => Array.from({ length: n }, (_, i) => marks[i + 1] || `// filler ${i + 1}`).join('\n') + '\n';

/** What the oracle reads: the file at a head (null when absent), through git, never the working tree; a submodule reads as its pointer. */
const reader = (repo, head) => (file) => {
  try {
    return execFileSync('git', ['show', `${head}:${file}`], { cwd: repo.root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    // not a blob: a submodule is only a pointer in the superproject, and that pointer is what the oracle can read of it
    try {
      const entry = execFileSync('git', ['ls-tree', head, '--', file], { cwd: repo.root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      const pointer = /^160000 commit ([0-9a-f]+)\t/.exec(entry);
      return pointer === null ? null : `submodule ${pointer[1]}\n`;
    } catch {
      return null;
    }
  }
};
const has = (text, needle) => typeof text === 'string' && text.includes(needle);
const lineOf = (text, n) => (typeof text === 'string' ? text.split('\n')[n - 1] || '' : '');

/** Votes of K verifiers for what the oracle says: `real`, `not-real`, or `borderline` (2 real: a majority of 3, not of 5). */
function votesFor(verdict, K) {
  const names = Array.from({ length: K }, (_, i) => `verifier-${i + 1}`);
  if (verdict === 'real') return names.map((verifier) => ({ verifier, verdict: 'real' }));
  if (verdict === 'not-real') return names.map((verifier) => ({ verifier, verdict: 'not-real' }));
  return names.map((verifier, i) => ({ verifier, verdict: i < 2 ? 'real' : 'not-real' }));
}
const K_OF = { standard: 3, deep: 5 };

const finding = (id, file, line, claim, truth) => ({ id, file, line, claim, truth });
const ledgerOf = (f, head) => ({
  id: f.id, source: 'reviewer-a', locationOrLink: `${f.file}:${f.line}`, failureMode: f.claim, severity: 'Important', headSha: head,
  evidence: `evidence ${f.id}`, originalTextOrLink: `https://example.test/${f.id}`,
});

/**
 * The delta facts the prepare step would write for `lastHead..head`: the real import graph of the new head and the planner
 * over it, with the range they were computed for (`facts.headSha` and `facts.delta.lastReviewedSha`, which `plan` takes as `deltaRange`).
 */
function deltaFacts(repo, lastHead, head) {
  const deltaPaths = git(repo.root, ['diff', '--name-only', lastHead, head]).split('\n').filter(Boolean).sort();
  const filePaths = parseLsTreeZ(execFileSync('git', ['ls-tree', '-r', '-z', '--full-tree', head], { cwd: repo.root, encoding: 'utf8' })).map((entry) => entry.path);
  const lines = scanReferenceLines({ git: realGit }, repo.root, head);
  const importGraph = buildImportGraph({ filePaths, lines });
  const nameLines = importGraph.computed.length > 0 ? scanNameLines({ git: realGit }, repo.root, head, importGraph.computed, deltaPaths) : undefined;
  const deltaPlan = planDeltaReview({
    delta: { ok: true, mode: 'delta', baseSha: BASE, lastReviewedSha: lastHead, headSha: head, reason: 'delta' },
    changedPaths: deltaPaths,
    pathsClassification: { ok: true, paths: deltaPaths.map((file) => ({ path: file, high: false, sensitive: false })) },
    reviewed: { headSha: lastHead, baseSha: BASE },
    importGraph,
    nameLines,
  });
  expect(deltaPlan.mode).toBe('delta');
  return { deltaPaths, deltaPlan, deltaRange: { headSha: head, lastReviewedSha: lastHead } };
}

/** `votes` over fresh verification of `findings` at `head`: what a full re-review reports for them. */
function verify(repo, head, findings, depth, ledgerHead) {
  const read = reader(repo, head);
  const K = K_OF[depth];
  const result = HANDLERS.votes({
    depth,
    findings: findings.map((f) => ({ ...ledgerOf(f, ledgerHead), votes: votesFor(f.truth(read, K), K) })),
  });
  expect(result.ok).toBe(true);
  return result.findings;
}

/**
 * One round at `head` through the real pipeline. `prior` is the previous round (null for the first). `findings` are the
 * candidates this round presents (every open finding, re-presented, plus any new one). `mutatePlan(payload, context)` may
 * replace what the plan call is given (`context`: `{ repo, prior, head, citations }`), to hand it facts of another head.
 */
function round({ repo, state, head, prior, findings, depth = 'standard', prId = PR, baseSha = BASE, mutatePlan = (p) => p }) {
  const citations = findings.map((f) => ({ id: f.id, file: f.file, line: f.line, claim: f.claim }));
  const hashed = hashCitations({ repoRoot: repo.root, headSha: head, citations });
  expect(hashed.ok).toBe(true);
  const candidates = hashed.candidates;

  let plan = null;
  let toVerify = findings;
  let existingLedger = [];
  let carriedVerdicts = [];
  const outcomes = {};
  if (prior !== null) {
    const facts = deltaFacts(repo, prior.head, head);
    plan = HANDLERS.carry(mutatePlan({
      action: 'plan', prId, cwd: state, headSha: head, lastReviewedSha: prior.head, baseSha, depth,
      deltaPlan: facts.deltaPlan, deltaPaths: facts.deltaPaths, deltaRange: facts.deltaRange, highPaths: [], candidates,
    }, { repo, prior, head, citations }));
    expect(plan.ok).toBe(true);
    const carriedIds = new Set(plan.carried.map((record) => String(record.id)));
    for (const record of plan.carried) outcomes[record.id] = record.outcome;
    toVerify = findings.filter((f) => !carriedIds.has(f.id));
    existingLedger = plan.ledger;
    carriedVerdicts = plan.carried;
  }

  const verified = verify(repo, head, toVerify, depth, head);
  for (const entry of verified) outcomes[entry.id] = entry.outcome;
  const recorded = HANDLERS.carry({ action: 'record', prId, baseSha, headSha: head, depth, findings: verified, candidates });
  expect(recorded.ok).toBe(true);

  const merged = HANDLERS.ledger({ action: 'merge', existingLedger, incomingFindings: verified.map((entry) => ({ ...entry, headSha: head })), headSha: head }).ledger;
  const reconciled = HANDLERS.carry({ action: 'reconcile', ledger: merged, changedLocations: [], headSha: head, observations: verified });
  expect(reconciled.cleared).toEqual([]);
  const verdicts = [...carriedVerdicts, ...recorded.verdicts];
  expect(HANDLERS['state-write']({ prId, cwd: state, state: { headSha: head, reviewedHeadSha: head, baseSha, ledger: reconciled.ledger, verdicts } }).ok).toBe(true);
  return { head, plan, outcomes, verdicts, recorded, ledger: reconciled.ledger, candidates };
}

/** What a full re-review reports at `head`: every finding verified fresh. */
function fullReview(repo, head, findings, depth = 'standard') {
  return Object.fromEntries(verify(repo, head, findings, depth, head).map((entry) => [entry.id, entry.outcome]));
}

/** Runs a scenario: round 1 at the first head, the fix push, round 2; returns what the tests assert on. */
function scenario({ files, findings, push, depth1 = 'standard', depth2 = 'standard', findings2 = findings, mutatePlan }) {
  const repo = makeRepo(files);
  const state = scratch('state-');
  const first = round({ repo, state, head: repo.head, prior: null, findings, depth: depth1 });
  const h2 = repo.commit(push);
  const second = round({ repo, state, head: h2, prior: first, findings: findings2, depth: depth2, mutatePlan });
  const full1 = fullReview(repo, first.head, findings, depth1);
  const full2 = fullReview(repo, h2, findings2, depth2);
  return { repo, state, first, second, h2, full1, full2 };
}

const flippedIds = (before, after) => Object.keys(after).filter((id) => before[id] !== after[id]).sort();
const carriedIds = (result) => result.second.plan.carried.map((record) => String(record.id)).sort();
const reasonsOf = (result, id) => (result.second.plan.reverify.find((entry) => String(entry.id) === id) || { reasons: [] }).reasons;

describe('a stale verdict is never carried: each push below flips the oracle, and the carry round still equals a full re-review', () => {
  test('a changed DEPENDENCY: the cited file is untouched, a file it imports lost its validation', () => {
    const f = finding('F-dep', 'src/a.js', 10, 'a.js hands unvalidated input to helper', (read) => (has(read('src/helper.js'), 'validate(') ? 'not-real' : 'real'));
    const r = scenario({
      files: { 'src/a.js': pad(20, { 1: "const helper = require('./helper');", 10: 'module.exports = (x) => helper(x);' }), 'src/helper.js': pad(5, { 1: 'module.exports = (x) => { validate(x); return x; };' }) },
      findings: [f],
      push: { 'src/helper.js': pad(5, { 1: 'module.exports = (x) => x;' }) },
    });
    expect(r.full1).toEqual({ 'F-dep': 'filtered' });
    expect(flippedIds(r.full1, r.full2)).toEqual(['F-dep']);
    expect(r.second.plan.carried).toEqual([]);
    expect(reasonsOf(r, 'F-dep')).toContain(REASONS.DEPENDENCY_CHANGED);
    expect(r.second.outcomes).toEqual(r.full2);
  });

  test('a changed CALLER: the cited file is untouched, a file that calls it dropped its guard (reverse edge)', () => {
    const guarded = (read) => ['lib/caller.js', 'lib/other-caller.js'].every((file) => has(read(file), 'if (!i)'));
    const f = finding('F-callee', 'lib/callee.js', 10, 'callee reads input.value with no null check', (read) => (guarded(read) ? 'not-real' : 'real'));
    const caller = (guard) => pad(8, { 1: "const callee = require('./callee');", 5: `module.exports = (i) => { ${guard}return callee(i); };` });
    const r = scenario({
      files: { 'lib/callee.js': pad(20, { 10: 'module.exports = (input) => input.value;' }), 'lib/caller.js': caller('if (!i) return null; '), 'lib/other-caller.js': caller('if (!i) return null; ') },
      findings: [f],
      push: { 'lib/caller.js': caller('') },
    });
    expect(r.full1).toEqual({ 'F-callee': 'filtered' });
    expect(flippedIds(r.full1, r.full2)).toEqual(['F-callee']);
    // the planner's own read set does NOT list the callee (it lists callers of changed files), so only the reverse edge catches it
    expect(r.second.plan.carried).toEqual([]);
    expect(reasonsOf(r, 'F-callee')).toContain(REASONS.DEPENDENT_CHANGED);
    expect(r.second.outcomes).toEqual(r.full2);
  });

  const guardedCallers = (read) => ['lib/caller.js', 'lib/new-caller.js'].every((file) => read(file) === null || has(read(file), 'if (!i)'));
  const callerOf = (guard) => pad(8, { 1: "const callee = require('./callee');", 5: `module.exports = (i) => { ${guard}return callee(i); };` });
  const newCallerScenario = (mutatePlan) => scenario({
    files: { 'lib/callee.js': pad(20, { 10: 'module.exports = (input) => input.value;' }), 'lib/caller.js': callerOf('if (!i) return null; ') },
    findings: [finding('F-new-caller', 'lib/callee.js', 10, 'callee reads input.value with no null check', (read) => (guardedCallers(read) ? 'not-real' : 'real'))],
    push: { 'lib/new-caller.js': callerOf('') },
    mutatePlan,
  });

  test('a NEW unguarded caller of an unchanged cited file: candidates hashed at the new head list it, so the filtered verdict is verified again', () => {
    const r = newCallerScenario();
    expect(r.full1).toEqual({ 'F-new-caller': 'filtered' });
    expect(flippedIds(r.full1, r.full2)).toEqual(['F-new-caller']);
    expect(r.second.plan.carried).toEqual([]);
    expect(reasonsOf(r, 'F-new-caller')).toEqual([REASONS.DEPENDENT_CHANGED]);
    expect(r.second.outcomes).toEqual(r.full2);
  });

  test('the same push with candidates hashed at the PREVIOUS head (they cannot list the new caller): the head stamp stops the carry, and the round still equals the full re-review', () => {
    let staleDependents;
    const r = newCallerScenario((plan, { repo, prior, citations }) => {
      const candidates = hashCitations({ repoRoot: repo.root, headSha: prior.head, citations }).candidates;
      staleDependents = candidates[0].dependents;
      return { ...plan, candidates };
    });
    // not vacuous: the stale hashes really do lack the new caller, and every hash they hold is still right for the cited file
    expect(staleDependents).toEqual(['lib/caller.js']);
    expect(flippedIds(r.full1, r.full2)).toEqual(['F-new-caller']);
    expect(r.second.plan.carried).toEqual([]);
    expect(reasonsOf(r, 'F-new-caller')).toEqual([REASONS.CANDIDATE_HEAD_MISMATCH]);
    expect(r.second.outcomes).toEqual(r.full2);
  });

  test('a TEST named after a changed file with no import edge: the planner reads it (test-of), so its verdict is verified again', () => {
    const f = finding('F-test', 'tests/foo.test.js', 10, 'foo.test.js never exercises the empty-input branch of foo', (read) => (has(read('lib/foo.js'), 'branch: empty-input') && !has(read('tests/foo.test.js'), 'empty-input') ? 'real' : 'not-real'));
    const r = scenario({
      files: { 'lib/foo.js': pad(20, { 10: '// branch: empty-input' }), 'tests/foo.test.js': pad(20, { 10: "test('foo handles typical input', () => {});" }) },
      findings: [f],
      push: { 'lib/foo.js': pad(20) },
    });
    expect(r.full1).toEqual({ 'F-test': 'present' });
    expect(flippedIds(r.full1, r.full2)).toEqual(['F-test']);
    expect(r.second.plan.carried).toEqual([]);
    expect(reasonsOf(r, 'F-test')).toEqual([REASONS.BLAST_RADIUS]);
    expect(r.second.outcomes).toEqual(r.full2);
  });

  test('a changed CITED HUNK: the defect is edited away', () => {
    const f = finding('F-hunk', 'src/c.js', 10, 'c.js evals user input', (read) => (has(lineOf(read('src/c.js'), 10), 'eval(') ? 'real' : 'not-real'));
    const r = scenario({
      files: { 'src/c.js': pad(20, { 10: 'const out = eval(userInput);' }) },
      findings: [f],
      push: { 'src/c.js': pad(20, { 10: 'const out = JSON.parse(userInput);' }) },
    });
    expect(flippedIds(r.full1, r.full2)).toEqual(['F-hunk']);
    expect(r.second.plan.carried).toEqual([]);
    expect(reasonsOf(r, 'F-hunk')).toEqual(expect.arrayContaining([REASONS.CITED_FILE_IN_DELTA, REASONS.HUNK_CHANGED]));
    expect(r.second.outcomes).toEqual(r.full2);
  });

  test('a SYMLINK whose target changed: the link text never changes, so the citation is never hashed and never carried', () => {
    const f = finding('F-link', 'full/lib/x.js', 1, 'x exports a shared mutable singleton', (read) => (has(read('development/lib/x.js'), 'singleton = {}') ? 'real' : 'not-real'));
    const r = scenario({
      files: { 'development/lib/x.js': pad(10, { 1: 'const singleton = {};' }), 'full/lib/x.js': { link: '../../development/lib/x.js' } },
      findings: [f],
      push: { 'development/lib/x.js': pad(10, { 1: 'const fresh = () => ({});' }) },
    });
    expect(flippedIds(r.full1, r.full2)).toEqual(['F-link']);
    // the producer refused it at both heads: nothing was recorded, so nothing can be carried
    expect(r.first.recorded.skipped).toEqual([{ id: 'F-link', reason: 'no-hash' }]);
    expect(r.second.plan.carried).toEqual([]);
    expect(r.second.outcomes).toEqual(r.full2);
  });

  test('a symlinked DIRECTORY on a specifier path whose target moved (S8b): the import resolves to nothing the hash can see, so the citation is never hashed or carried', () => {
    // lib/vendor.js is a directory link; git stores its text ('real-a', then 'real-b') and nothing under it, and the planner keeps
    // delta mode because the name ends in .js. The oracle follows the link text, as the file system would.
    const linkTarget = (read) => (read('lib/vendor.js') || '').trim();
    const f = finding('F-vendor', 'lib/core9.js', 3, 'core9 dereferences the vendored package without a null check', (read) => (has(read(`lib/${linkTarget(read)}/pkg.js`), 'module.exports = null') ? 'real' : 'not-real'));
    const r = scenario({
      files: {
        'lib/core9.js': pad(10, { 1: "const pkg = require('./vendor.js/pkg');" }),
        'lib/real-a/pkg.js': 'module.exports = {};\n',
        'lib/real-b/pkg.js': 'module.exports = null;\n',
        'lib/vendor.js': { link: 'real-a' },
      },
      findings: [f],
      push: { 'lib/vendor.js': { link: 'real-b' } },
    });
    expect(r.full1).toEqual({ 'F-vendor': 'filtered' });
    expect(flippedIds(r.full1, r.full2)).toEqual(['F-vendor']);
    // what matters: the carry round is the full re-review, and nothing was carried across the retarget
    expect(r.second.plan.carried).toEqual([]);
    expect(r.second.outcomes).toEqual(r.full2);
    // and why: the producer refused the citation at both heads, so nothing was recorded to be carried
    expect(r.first.candidates[0].hashError).toMatch(/symlinked directory lib\/vendor\.js/);
    expect(r.first.recorded.skipped).toEqual([{ id: 'F-vendor', reason: 'no-hash' }]);
  });

  test('a SUBMODULE on a specifier path whose pointer moved (G1): the import resolves to nothing the hash can see, so the citation is never hashed or carried', () => {
    // lib/gl.js is a submodule: git stores its commit id and nothing under it, and the planner keeps delta mode because the
    // name ends in .js. The oracle reads the pointer, which is all the superproject records of it.
    const POINTER_A = 'a'.repeat(40);
    const POINTER_B = 'b'.repeat(40);
    const f = finding('F-gl', 'lib/core10.js', 3, 'core10 trusts the vendored submodule without a check', (read) => (has(read('lib/gl.js'), POINTER_B) ? 'real' : 'not-real'));
    const repo = makeRepo({ 'lib/core10.js': pad(10, { 1: "const x = require('./gl.js/x');" }) });
    const state = scratch('state-');
    // by hand: `commit()` stages with `add -A`, which would drop an index entry whose path is not in the working tree
    const pointAt = (sha) => {
      git(repo.root, ['update-index', '--add', '--cacheinfo', `160000,${sha},lib/gl.js`]);
      git(repo.root, ['commit', '-q', '-m', 'pointer']);
      return git(repo.root, ['rev-parse', 'HEAD']);
    };
    const h1 = pointAt(POINTER_A);
    const first = round({ repo, state, head: h1, prior: null, findings: [f] });
    const h2 = pointAt(POINTER_B);
    const second = round({ repo, state, head: h2, prior: first, findings: [f] });
    const full1 = fullReview(repo, h1, [f]);
    const full2 = fullReview(repo, h2, [f]);
    expect(full1).toEqual({ 'F-gl': 'filtered' });
    expect(flippedIds(full1, full2)).toEqual(['F-gl']);
    // what matters: the carry round is the full re-review, and nothing was carried across the pointer move
    expect(second.plan.carried).toEqual([]);
    expect(second.outcomes).toEqual(full2);
    // and why: the producer refused the citation at both heads, so nothing was recorded to be carried
    expect(first.candidates[0].hashError).toMatch(/submodule lib\/gl\.js/);
    expect(first.recorded.skipped).toEqual([{ id: 'F-gl', reason: 'no-hash' }]);
  });

  test.each([
    ['< and >', 'x < y', 'x > y'],
    ['= and !', 'x == y', 'x != y'],
    ['& and |', 'a && b', 'a || b'],
    ['+ and -', 'n + 1', 'n - 1'],
    ['% and ^', 'n % 2', 'n ^ 2'],
    ['! and brackets', '!ready', 'ready()'],
    ['brackets', 'items[0]', 'items(0)'],
    ['quotes', 'name = "s"', 'name = s'],
    ['. and ,', 'a.b', 'a,b'],
    ['? and :', 'x ? y', 'x : y'],
    ['@ and #', 'a@b', 'a#b'],
  ])('an OPPOSITE claim on the same hunk (%s) is a new finding: it is verified, it does not inherit the filtered verdict of its opposite', (_name, here, there) => {
    const says = (code, other) => `${code} should be ${other}`;
    const present = finding('F-here', 'src/cmp.js', 10, says(here, there), (read) => (has(lineOf(read('src/cmp.js'), 10), here) ? 'real' : 'not-real'));
    const absent = finding('F-there', 'src/cmp.js', 10, says(there, here), (read) => (has(lineOf(read('src/cmp.js'), 10), there) ? 'real' : 'not-real'));
    // round 1 reports only `absent` (the code has `here`, so the claim about `there` is not real); round 2 reports `present`, the OPPOSITE claim, and it is real
    const r = scenario({
      files: { 'src/cmp.js': pad(20, { 10: `// ${here}` }) },
      findings: [absent],
      findings2: [present],
      push: { 'docs/note.md': 'unrelated\n' },
    });
    expect(r.full1).toEqual({ 'F-there': 'filtered' });
    expect(r.full2).toEqual({ 'F-here': 'present' });
    expect(r.second.plan.carried).toEqual([]);
    expect(reasonsOf(r, 'F-here')).toEqual([REASONS.NEW_CANDIDATE]);
    expect(r.second.outcomes).toEqual({ 'F-here': 'present' });
    expect(r.second.plan.unmatched.map((entry) => entry.id)).toEqual(['F-there']);
  });

  test('a claim that differs only in CAPITALISATION on the same hunk is a new finding: `Foo` was filtered, `foo` is real, and the filtered verdict is not inherited', () => {
    const says = (name) => `${name} is unchecked`;
    const upper = finding('F-upper', 'src/names.js', 10, says('Foo'), (read) => (has(lineOf(read('src/names.js'), 10), 'Foo(') ? 'real' : 'not-real'));
    const lower = finding('F-lower', 'src/names.js', 10, says('foo'), (read) => (has(lineOf(read('src/names.js'), 10), 'foo(') ? 'real' : 'not-real'));
    // round 1 reports only the `Foo` claim: the code calls foo(), so it is not real and is filtered; round 2 reports the `foo` claim, which is real
    const r = scenario({
      files: { 'src/names.js': pad(20, { 10: 'foo(input);' }) },
      findings: [upper],
      findings2: [lower],
      push: { 'docs/note.md': 'unrelated\n' },
    });
    expect(r.full1).toEqual({ 'F-upper': 'filtered' });
    expect(r.full2).toEqual({ 'F-lower': 'present' });
    expect(r.second.plan.carried).toEqual([]);
    expect(reasonsOf(r, 'F-lower')).toEqual([REASONS.NEW_CANDIDATE]);
    expect(r.second.outcomes).toEqual({ 'F-lower': 'present' });
    expect(r.second.plan.unmatched.map((entry) => entry.id)).toEqual(['F-upper']);
  });

  test.each([
    ['Standard into Deep', 'standard', 'deep'],
    ['Deep into Standard', 'deep', 'standard'],
  ])('a verifier DEPTH that changed across the push (%s): nothing carries although no file moved', (_name, depth1, depth2) => {
    const f = finding('F-border', 'src/d.js', 10, 'd.js borderline defect', () => 'borderline');
    const r = scenario({ files: { 'src/d.js': pad(20) }, findings: [f], push: { 'docs/note.md': 'unrelated\n' }, depth1, depth2 });
    // a borderline defect is `present` at 2 of 3 verifiers and `filtered` at 2 of 5: the answer depends on the depth
    expect(r.full1).toEqual({ 'F-border': depth1 === 'standard' ? 'present' : 'filtered' });
    expect(flippedIds(r.full1, r.full2)).toEqual(['F-border']);
    expect(r.second.plan.carried).toEqual([]);
    expect(reasonsOf(r, 'F-border')).toContain(REASONS.VERDICT_OTHER_DEPTH);
    expect(r.second.outcomes).toEqual(r.full2);
  });
});

describe('the delta must be the one of THIS range: facts of an earlier push never decide a carry', () => {
  // Three commits. C0 is where the scenario starts, C1 is the head round 1 reviewed (a push that changed only a note) and C2 is
  // the push under review. `prepare` computed round 1's facts for C0..C1; the plan at C2 must be given those of C1..C2, and
  // `deltaRange` says which range the facts it is given were computed for. `staleFacts` hands it round 1's instead.
  function threeCommits({ files, findings, push, staleFacts }) {
    const repo = makeRepo(files);
    const state = scratch('state-');
    const c0 = repo.head;
    const c1 = repo.commit({ 'docs/note.md': 'round one\n' });
    const first = round({ repo, state, head: c1, prior: null, findings });
    const c2 = repo.commit(push);
    let handed;
    const second = round({
      repo,
      state,
      head: c2,
      prior: first,
      findings,
      mutatePlan: staleFacts ? (plan) => {
        handed = deltaFacts(repo, c0, c1);
        return { ...plan, deltaPlan: handed.deltaPlan, deltaPaths: handed.deltaPaths, deltaRange: handed.deltaRange };
      } : undefined,
    });
    return { repo, c0, c1, c2, first, second, handed, full1: fullReview(repo, c1, findings), full2: fullReview(repo, c2, findings) };
  }

  const callerOf = (guard) => pad(8, { 1: "const callee = require('./callee');", 5: `module.exports = (i) => { ${guard}return callee(i); };` });
  const guardedCallers = (read) => ['lib/caller.js', 'lib/new-caller.js'].every((file) => read(file) === null || has(read(file), 'if (!i)'));
  const newCaller = (staleFacts) => threeCommits({
    files: { 'lib/callee.js': pad(20, { 10: 'module.exports = (input) => input.value;' }), 'lib/caller.js': callerOf('if (!i) return null; ') },
    findings: [finding('F-callee', 'lib/callee.js', 10, 'callee reads input.value with no null check', (read) => (guardedCallers(read) ? 'not-real' : 'real'))],
    push: { 'lib/new-caller.js': callerOf('') },
    staleFacts,
  });

  test('a NEW unguarded caller: with the facts of this push it is dependent-changed; with the previous push\'s, which cannot know it, the range binding stops the carry', () => {
    const control = newCaller(false);
    expect(control.full1).toEqual({ 'F-callee': 'filtered' });
    expect(flippedIds(control.full1, control.full2)).toEqual(['F-callee']);
    expect(control.second.plan.carried).toEqual([]);
    expect(reasonsOf(control, 'F-callee')).toEqual([REASONS.DEPENDENT_CHANGED]);
    expect(control.second.outcomes).toEqual(control.full2);

    const r = newCaller(true);
    // not vacuous: the facts handed over really are the previous push's, and they do not list the new caller
    expect(r.handed.deltaPaths).toEqual(['docs/note.md']);
    expect(r.handed.deltaRange).toEqual({ headSha: r.c1, lastReviewedSha: r.c0 });
    expect(r.second.plan.carried).toEqual([]);
    expect(r.second.plan.reasons).toEqual([REASONS.DELTA_RANGE_MISMATCH]);
    expect(reasonsOf(r, 'F-callee')).toEqual([REASONS.DELTA_RANGE_MISMATCH]);
    expect(r.second.outcomes).toEqual(r.full2);
  });

  const windowed = (staleFacts) => threeCommits({
    files: { 'lib/win.js': pad(30, { 4: 'const out = run(input);', 14: 'validate(input);' }) },
    findings: [finding('F-window', 'lib/win.js', 4, 'win.js runs its input unvalidated', (read) => (has(lineOf(read('lib/win.js'), 14), 'validate(') ? 'not-real' : 'real'))],
    push: { 'lib/win.js': pad(30, { 4: 'const out = run(input);' }) },
    staleFacts,
  });

  test('an edit to the cited file OUTSIDE the cited window: this push\'s delta lists the file (cited-file-in-delta, the only guard the hunk hash leaves), the previous push\'s does not, so the range binding stops the carry', () => {
    const control = windowed(false);
    expect(control.full1).toEqual({ 'F-window': 'filtered' });
    expect(flippedIds(control.full1, control.full2)).toEqual(['F-window']);
    // the edit is on line 14, the citation on line 4: the hunk hash (lines 1-7) cannot see it
    expect(control.second.candidates[0].hunkHash).toBe(control.first.candidates[0].hunkHash);
    expect(control.second.plan.carried).toEqual([]);
    expect(reasonsOf(control, 'F-window')).toEqual([REASONS.CITED_FILE_IN_DELTA]);
    expect(control.second.outcomes).toEqual(control.full2);

    const r = windowed(true);
    expect(r.handed.deltaPaths).toEqual(['docs/note.md']);
    expect(r.second.plan.carried).toEqual([]);
    expect(r.second.plan.reasons).toEqual([REASONS.DELTA_RANGE_MISMATCH]);
    expect(reasonsOf(r, 'F-window')).toEqual([REASONS.DELTA_RANGE_MISMATCH]);
    expect(r.second.outcomes).toEqual(r.full2);
  });
});

describe('what may carry does carry: a push that cannot change a finding saves its verification, and the answer is still the full re-review\'s', () => {
  const real = (file, n) => (read) => (has(lineOf(read(file), n), 'eval(') ? 'real' : 'not-real');
  const FILES = {
    'src/ctl.js': pad(20, { 10: "const x = eval('1');" }),
    'src/dep-user.js': pad(20, { 1: "const dep = require('./dep');", 10: 'const y = eval(dep);' }),
    'src/dep.js': 'module.exports = 1;\n',
    'docs/readme.md': '# doc\n',
  };
  const findings = [finding('F-ctl', 'src/ctl.js', 10, 'ctl evals', real('src/ctl.js', 10)), finding('F-dep-user', 'src/dep-user.js', 10, 'dep-user evals', real('src/dep-user.js', 10))];

  test('a documentation-only push carries both findings (carriedFrom is the head they were settled on), and nothing is verified again', () => {
    const r = scenario({ files: FILES, findings, push: { 'docs/readme.md': '# doc, edited\n' } });
    expect(carriedIds(r)).toEqual(['F-ctl', 'F-dep-user']);
    expect(r.second.plan.reverify).toEqual([]);
    for (const record of r.second.plan.carried) expect(record).toMatchObject({ head: r.h2, carriedFrom: r.first.head, outcome: 'present' });
    expect(flippedIds(r.full1, r.full2)).toEqual([]);
    expect(r.second.outcomes).toEqual(r.full2);
    // the ledger the answer returned has exactly those findings stamped, and the state written for the new head keeps the verdicts
    expect(r.second.ledger.map((entry) => [entry.id, entry.headSha, entry.carriedFrom])).toEqual([['F-ctl', r.h2, r.first.head], ['F-dep-user', r.h2, r.first.head]]);
    expect(r.second.verdicts.map((record) => record.carriedFrom)).toEqual([r.first.head, r.first.head]);
  });

  test('a push that changes one finding\'s dependency verifies only that finding; the other carries; both equal the full re-review', () => {
    const r = scenario({ files: FILES, findings, push: { 'src/dep.js': 'module.exports = 2;\n' } });
    expect(carriedIds(r)).toEqual(['F-ctl']);
    expect(r.second.plan.reverify.map((entry) => entry.id)).toEqual(['F-dep-user']);
    expect(r.second.outcomes).toEqual(r.full2);
  });

  test('a carried verdict stays carried through a second push, keeps its ORIGINAL head, and a third round still equals the full re-review', () => {
    const repo = makeRepo(FILES);
    const state = scratch('state-');
    const r1 = round({ repo, state, head: repo.head, prior: null, findings });
    const h2 = repo.commit({ 'docs/readme.md': '# doc 2\n' });
    const r2 = round({ repo, state, head: h2, prior: r1, findings });
    const h3 = repo.commit({ 'docs/readme.md': '# doc 3\n' });
    const r3 = round({ repo, state, head: h3, prior: r2, findings });
    expect(r3.plan.carried.map((record) => record.carriedFrom)).toEqual([r1.head, r1.head]);
    expect(r3.plan.carried.map((record) => record.head)).toEqual([h3, h3]);
    expect(r3.outcomes).toEqual(fullReview(repo, h3, findings));
    expect(r3.ledger.map((entry) => entry.carriedFrom)).toEqual([r1.head, r1.head]);
  });

  test('a push that ADDS a new finding verifies it (new candidate) and still carries the settled ones', () => {
    const extra = finding('F-new', 'src/ctl.js', 12, 'ctl evals again', () => 'real');
    const r = scenario({ files: FILES, findings, findings2: [...findings, extra], push: { 'docs/readme.md': '# doc, edited\n' } });
    expect(carriedIds(r)).toEqual(['F-ctl', 'F-dep-user']);
    expect(reasonsOf(r, 'F-new')).toEqual([REASONS.NEW_CANDIDATE]);
    expect(r.second.outcomes).toEqual(r.full2);
  });
});

describe('a verdict is bound to its PR, base and report: nothing carries across them even though no file moved', () => {
  const f = finding('F-ctl', 'src/ctl.js', 10, 'ctl evals', () => 'real');
  const files = { 'src/ctl.js': pad(20, { 10: "const x = eval('1');" }), 'docs/readme.md': '# doc\n' };

  test('the unmodified control carries (so the three cases below are not carrying nothing for another reason)', () => {
    const r = scenario({ files, findings: [f], push: { 'docs/readme.md': '# doc 2\n' } });
    expect(carriedIds(r)).toEqual(['F-ctl']);
  });

  test('a round that reviews ANOTHER BASE does not inherit the verdicts of the base they were settled against', () => {
    const r = scenario({ files, findings: [f], push: { 'docs/readme.md': '# doc 2\n' }, mutatePlan: (plan) => ({ ...plan, baseSha: 'f'.repeat(40) }) });
    expect(r.second.plan.carried).toEqual([]);
    expect(reasonsOf(r, 'F-ctl')).toEqual([REASONS.VERDICT_OTHER_BASE]);
  });

  test('a report written for ANOTHER PR that sits where this PR\'s is read is not carried from', () => {
    const repo = makeRepo(files);
    const state = scratch('state-');
    const r1 = round({ repo, state, head: repo.head, prior: null, findings: [f], prId: '1' });
    // PR 1's report, copied to PR 268's file: every verdict in it is stamped for PR 1
    fs.copyFileSync(path.join(state, '.ensemble', 'pr-review', 'pr-1.json'), path.join(state, '.ensemble', 'pr-review', `pr-${PR}.json`));
    const h2 = repo.commit({ 'docs/readme.md': '# doc 2\n' });
    const facts = deltaFacts(repo, r1.head, h2);
    const candidates = hashCitations({ repoRoot: repo.root, headSha: h2, citations: [{ id: 'F-ctl', file: 'src/ctl.js', line: 10, claim: f.claim }] }).candidates;
    const plan = HANDLERS.carry({
      action: 'plan', prId: PR, cwd: state, headSha: h2, lastReviewedSha: r1.head, baseSha: BASE, depth: 'standard',
      deltaPlan: facts.deltaPlan, deltaPaths: facts.deltaPaths, deltaRange: facts.deltaRange, highPaths: [], candidates,
    });
    expect(plan.carried).toEqual([]);
    expect(plan.reverify[0].reasons).toEqual([REASONS.VERDICT_OTHER_PR]);
  });

  test('a verdict injected on stdin is refused outright, and the report is the only source', () => {
    const repo = makeRepo(files);
    const state = scratch('state-');
    const r1 = round({ repo, state, head: repo.head, prior: null, findings: [f] });
    const h2 = repo.commit({ 'docs/readme.md': '# doc 2\n' });
    const facts = deltaFacts(repo, r1.head, h2);
    const candidates = hashCitations({ repoRoot: repo.root, headSha: h2, citations: [{ id: 'F-ctl', file: 'src/ctl.js', line: 10, claim: f.claim }] }).candidates;
    const forged = { ...r1.verdicts[0], outcome: 'filtered' };
    expect(() => HANDLERS.carry({
      action: 'plan', prId: PR, cwd: state, headSha: h2, lastReviewedSha: r1.head, baseSha: BASE, depth: 'standard',
      deltaPlan: facts.deltaPlan, deltaPaths: facts.deltaPaths, deltaRange: facts.deltaRange, highPaths: [], candidates, priorVerdicts: [forged],
    })).toThrow(/priorVerdicts/);
  });
});
