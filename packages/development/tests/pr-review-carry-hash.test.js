'use strict';

/**
 * pr-review-carry-hash.js / pr-review-carry-hash-cli.js (kata qw98) against REAL git repositories. Fixtures live under
 * ~/.omp/pr-review-speedup/qw98/fixtures (never os.tmpdir()). Every test names the guard it covers: remove that guard and
 * the test fails.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { hashCitations } = require('../lib/pr-review-carry-hash');
const { main } = require('../lib/pr-review-carry-hash-cli');
const { planCarry, REASONS } = require('../lib/pr-review-carry');
const { planDeltaReview } = require('../lib/pr-review-delta');
const { buildImportGraph } = require('../lib/pr-review-import-graph');
const { scanReferenceLines, scanNameLines } = require('../lib/pr-review-prepare');
const realGit = require('../lib/review-prepare-runtime').defaultDeps().git;

const FIXTURE_ROOT = path.join(os.homedir(), '.omp', 'pr-review-speedup', 'qw98', 'fixtures');
const roots = [];

function git(cwd, args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' },
  }).trim();
}

function write(root, rel, content) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

/** A repo with one commit holding `files`; returns { root, commit(files) -> sha, head }. */
function makeRepo(files) {
  fs.mkdirSync(FIXTURE_ROOT, { recursive: true });
  const root = fs.mkdtempSync(path.join(FIXTURE_ROOT, 'repo-'));
  roots.push(root);
  git(root, ['init', '-q', '-b', 'main']);
  const commit = (changes) => {
    for (const [rel, content] of Object.entries(changes)) {
      if (content === null) fs.rmSync(path.join(root, rel), { force: true });
      else write(root, rel, content);
    }
    git(root, ['add', '-A']);
    git(root, ['commit', '-q', '--allow-empty', '-m', 'c']);
    return git(root, ['rev-parse', 'HEAD']);
  };
  const head = commit(files);
  return { root, commit, head };
}

afterAll(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

const lines = (n, mark = {}) => Array.from({ length: n }, (_, i) => mark[i + 1] || `// line ${i + 1}`).join('\n') + '\n';
const one = (repo, headSha, citation) => {
  const out = hashCitations({ repoRoot: repo.root, headSha, citations: [citation] });
  expect(out.ok).toBe(true);
  return out.candidates[0];
};
const SHA = /^[0-9a-f]{64}$/;

describe('hunkHash', () => {
  const repo = makeRepo({ 'src/a.js': lines(30) });

  test('is stable across calls and returns the citation verbatim', () => {
    const citation = { id: 'F1', file: 'src/a.js', line: 15, claim: 'x is wrong' };
    const first = one(repo, repo.head, citation);
    const second = one(repo, repo.head, citation);
    expect(first).toEqual(second);
    expect(first).toMatchObject(citation);
    expect(first.hunkHash).toMatch(SHA);
    expect(first.depHashes).toEqual({});
  });

  test('a change inside the cited region plus 3 lines of context changes it; 4+ lines away does not', () => {
    const base = one(repo, repo.head, { file: 'src/a.js', line: 15 }).hunkHash;
    const inside = repo.commit({ 'src/a.js': lines(30, { 18: '// changed' }) }); // line 18 = cited + 3
    expect(one(repo, inside, { file: 'src/a.js', line: 15 }).hunkHash).not.toBe(base);
    const outside = repo.commit({ 'src/a.js': lines(30, { 19: '// changed' }) }); // cited + 4
    expect(one(repo, outside, { file: 'src/a.js', line: 15 }).hunkHash).toBe(base);
    const above = repo.commit({ 'src/a.js': lines(30, { 11: '// changed' }) }); // cited - 4
    expect(one(repo, above, { file: 'src/a.js', line: 15 }).hunkHash).toBe(base);
    const lineAbove = repo.commit({ 'src/a.js': lines(30, { 12: '// changed' }) }); // cited - 3
    expect(one(repo, lineAbove, { file: 'src/a.js', line: 15 }).hunkHash).not.toBe(base);
    repo.commit({ 'src/a.js': lines(30) });
  });

  test('a `lines` range is the same region as its endpoints, and clamps context to the file', () => {
    const range = one(repo, repo.head, { file: 'src/a.js', lines: [10, 12] }).hunkHash;
    const edit = repo.commit({ 'src/a.js': lines(30, { 9: '// changed' }) });
    expect(one(repo, edit, { file: 'src/a.js', lines: [10, 12] }).hunkHash).not.toBe(range);
    const edge = one(repo, repo.head, { file: 'src/a.js', line: 1 });
    expect(edge.hunkHash).toMatch(SHA);
    expect(one(repo, repo.head, { file: 'src/a.js', line: 30 }).hunkHash).toMatch(SHA);
    repo.commit({ 'src/a.js': lines(30) });
  });

  test('reads the commit, not the working tree', () => {
    const before = one(repo, repo.head, { file: 'src/a.js', line: 15 });
    write(repo.root, 'src/a.js', lines(30, { 15: '// DIRTY' }));
    write(repo.root, 'src/untracked-dep.js', 'x');
    try {
      expect(one(repo, repo.head, { file: 'src/a.js', line: 15 })).toEqual(before);
    } finally {
      git(repo.root, ['checkout', '--', 'src/a.js']);
    }
  });

  test.each([
    ['no line or range', { file: 'src/a.js' }],
    ['line and lines together', { file: 'src/a.js', line: 3, lines: [3, 4] }],
    ['range past the end of the file', { file: 'src/a.js', lines: [28, 31] }],
    ['line 0', { file: 'src/a.js', line: 0 }],
    ['reversed range', { file: 'src/a.js', lines: [5, 4] }],
    ['non-integer line', { file: 'src/a.js', line: 2.5 }],
    ['file absent at head', { file: 'src/missing.js', line: 1 }],
    ['path escaping the repository', { file: '../a.js', line: 1 }],
  ])('%s => hashError and no hash fields', (_name, citation) => {
    const out = one(repo, repo.head, citation);
    expect(typeof out.hashError).toBe('string');
    expect(out).not.toHaveProperty('hunkHash');
    expect(out).not.toHaveProperty('depHashes');
    expect(out).not.toHaveProperty('dependents');
  });

  test('a file that exists only in the working tree, not at the head, is absent', () => {
    write(repo.root, 'src/new.js', lines(5));
    try {
      expect(one(repo, repo.head, { file: 'src/new.js', line: 1 }).hashError).toMatch(/does not exist/);
    } finally {
      fs.rmSync(path.join(repo.root, 'src/new.js'));
    }
  });
});

describe('depHashes', () => {
  const FILES = {
    'src/a.js': "const b = require('./b');\nconst c = require('../lib/c.json');\n" + lines(10),
    'src/b.js': "import d from './deep/d.js';\nmodule.exports = 1;\n",
    'src/deep/d.js': "module.exports = 'd';\n",
    'lib/c.json': '{"v":1}\n',
    'docs/readme.md': "# doc\nsee require('./nothing') in prose\n",
    'src/unrelated.js': 'module.exports = 0;\n',
  };
  const repo = makeRepo(FILES);
  const base = one(repo, repo.head, { file: 'src/a.js', line: 5 });

  test('holds the transitive closure (direct, nested, json) and never the cited file itself', () => {
    expect(Object.keys(base.depHashes).sort()).toEqual(['lib/c.json', 'src/b.js', 'src/deep/d.js']);
    for (const hash of Object.values(base.depHashes)) expect(hash).toMatch(SHA);
  });

  test('changing a direct dependency changes depHashes', () => {
    const next = repo.commit({ 'src/b.js': "import d from './deep/d.js';\nmodule.exports = 2;\n" });
    const after = one(repo, next, { file: 'src/a.js', line: 5 });
    expect(after.depHashes['src/b.js']).not.toBe(base.depHashes['src/b.js']);
    expect(after.depHashes['src/deep/d.js']).toBe(base.depHashes['src/deep/d.js']);
    expect(after.hunkHash).toBe(base.hunkHash);
    repo.commit({ 'src/b.js': FILES['src/b.js'] });
  });

  test('changing a TRANSITIVE dependency changes depHashes', () => {
    const next = repo.commit({ 'src/deep/d.js': "module.exports = 'changed';\n" });
    const after = one(repo, next, { file: 'src/a.js', line: 5 });
    expect(after.depHashes['src/deep/d.js']).not.toBe(base.depHashes['src/deep/d.js']);
    expect(after.depHashes['src/b.js']).toBe(base.depHashes['src/b.js']);
    repo.commit({ 'src/deep/d.js': FILES['src/deep/d.js'] });
  });

  test('adding an import changes the key set; an unrelated change does not', () => {
    const added = repo.commit({ 'src/a.js': FILES['src/a.js'] + "require('./unrelated');\n" });
    expect(Object.keys(one(repo, added, { file: 'src/a.js', line: 5 }).depHashes)).toContain('src/unrelated.js');
    const unrelated = repo.commit({ 'src/a.js': FILES['src/a.js'], 'src/unrelated.js': 'module.exports = 9;\n' });
    expect(one(repo, unrelated, { file: 'src/a.js', line: 5 }).depHashes).toEqual(base.depHashes);
  });

  test('resolves an index file and a compiled-extension specifier to the tracked file', () => {
    const r = makeRepo({
      'a.ts': "import x from './pkg';\nimport y from './y.js';\n",
      'pkg/index.js': 'export default 1;\n',
      'y.ts': 'export default 2;\n',
    });
    expect(Object.keys(one(r, r.head, { file: 'a.ts', line: 1 }).depHashes).sort()).toEqual(['pkg/index.js', 'y.ts']);
  });

  test('a cycle terminates and still excludes the cited file', () => {
    const r = makeRepo({ 'a.js': "require('./b');\n", 'b.js': "require('./a');\n" });
    expect(Object.keys(one(r, r.head, { file: 'a.js', line: 1 }).depHashes)).toEqual(['b.js']);
  });

  test('a documentation/data file has depHashes {} and its prose is not scanned for imports', () => {
    const out = one(repo, repo.head, { file: 'docs/readme.md', line: 2 });
    expect(out.depHashes).toEqual({});
    expect(out.hashError).toBeUndefined();
  });

  test.each([
    ['a computed specifier in the cited file', { 'a.js': "require(pick());\n" }, 'a.js', /computed/],
    ['a computed specifier in a closure member', { 'a.js': "require('./b');\n", 'b.js': 'require(`./x/${n}`);\n' }, 'a.js', /computed/],
    ['an unanalyzable source type', { 'tool.py': 'import os\n' }, 'tool.py', /cannot be analyzed/],
  ])('%s => hashError and no hash fields', (_name, files, file, pattern) => {
    const r = makeRepo(files);
    const out = one(r, r.head, { file, line: 1 });
    expect(out.hashError).toMatch(pattern);
    expect(out).not.toHaveProperty('hunkHash');
    expect(out).not.toHaveProperty('depHashes');
    expect(out).not.toHaveProperty('dependents');
  });

  test('an unresolved relative specifier (cited file or closure member) is hashed as an ABSENT dependency, not a failure', () => {
    const absent = require('crypto').createHash('sha256').update('absent').digest('hex');
    const r = makeRepo({ 'src/a.js': "require('./gone');\nrequire('./b');\n", 'src/b.js': "// see ../docs/missing in prose\nrequire('./gone2');\n" });
    const out = one(r, r.head, { file: 'src/a.js', line: 1 });
    expect(out.hashError).toBeUndefined();
    expect(out.hunkHash).toMatch(SHA);
    expect(out.depHashes['src/gone']).toBe(absent);
    expect(out.depHashes['src/gone2']).toBe(absent);
    expect(out.depHashes['src/b.js']).toMatch(SHA);
    expect(Object.keys(out.depHashes)).toHaveLength(3);
  });

  test('a specifier climbing above the repository root is ignored', () => {
    const r = makeRepo({ 'a.js': "require('../../outside');\n" });
    const out = one(r, r.head, { file: 'a.js', line: 1 });
    expect(out.hashError).toBeUndefined();
    expect(out.depHashes).toEqual({});
  });

  test('absent entries do not count toward the 200-file cap', () => {
    const files = { 'entry.js': Array.from({ length: 250 }, (_, i) => `require('./nope/${i}');`).join('\n') + '\n' };
    const r = makeRepo(files);
    const out = one(r, r.head, { file: 'entry.js', line: 1 });
    expect(out.hashError).toBeUndefined();
    expect(Object.keys(out.depHashes)).toHaveLength(250);
  });

  test('a closure of 200 files hashes, 201 fails closed', () => {
    const build = (n) => {
      const files = { 'entry.js': Array.from({ length: n }, (_, i) => `require('./m/${i}');`).join('\n') + '\n' };
      for (let i = 0; i < n; i += 1) files[`m/${i}.js`] = `module.exports = ${i};\n`;
      return makeRepo(files);
    };
    const ok = build(200);
    const okOut = one(ok, ok.head, { file: 'entry.js', line: 1 });
    expect(Object.keys(okOut.depHashes)).toHaveLength(200);
    const over = build(201);
    const overOut = one(over, over.head, { file: 'entry.js', line: 1 });
    expect(overOut.hashError).toMatch(/exceeds 200/);
    expect(overOut).not.toHaveProperty('depHashes');
    expect(overOut).not.toHaveProperty('dependents');
    expect(overOut).not.toHaveProperty('hunkHash');
  });

  test('one bad citation does not poison the others, and git is called a bounded number of times', () => {
    const calls = [];
    const real = require('../lib/review-prepare-runtime').defaultDeps().git;
    const out = hashCitations({
      repoRoot: repo.root,
      headSha: repo.head,
      citations: [
        { id: 'ok', file: 'src/a.js', line: 5 },
        { id: 'same', file: 'src/a.js', line: 6 },
        { id: 'bad', file: 'src/missing.js', line: 1 },
      ],
    }, { git: (args, opts) => { calls.push(args[0]); return real(args, opts); } });
    expect(out.candidates.map((c) => ('hashError' in c ? 'err' : 'ok'))).toEqual(['ok', 'ok', 'err']);
    // ls-tree once; cat-file per level (cited blob(s), then b/c.json, then d): the second citation hits the cache.
    expect(calls.filter((c) => c === 'ls-tree')).toHaveLength(1);
    expect(calls.filter((c) => c === 'cat-file').length).toBeLessThanOrEqual(5);
    // reference scan + (computed-specifier name scan): at most two greps per call, however many citations.
    expect(calls.filter((c) => c === 'grep').length).toBeLessThanOrEqual(2);
    expect(calls.filter((c) => c === 'grep').length).toBeGreaterThanOrEqual(1);
  });
});

describe('request validation and the CLI', () => {
  const repo = makeRepo({ 'a.js': 'x\n' });

  test('hashCitations refuses unknown keys, a short headSha and malformed citations', () => {
    expect(hashCitations({ headSha: repo.head, citations: [], extra: 1 }).ok).toBe(false);
    expect(hashCitations({ headSha: 'abc123', citations: [] }).ok).toBe(false);
    expect(hashCitations({ headSha: repo.head, citations: [{ file: 'a.js', line: 1, severity: 'High' }] }).ok).toBe(false);
    expect(hashCitations({ headSha: repo.head, citations: 'a.js' }).ok).toBe(false);
  });

  test('an unreadable head is a request error, not a hash', () => {
    const out = hashCitations({ repoRoot: repo.root, headSha: '0'.repeat(40), citations: [{ file: 'a.js', line: 1 }] });
    expect(out.ok).toBe(false);
  });

  test('CLI: exit 0 with hashes; unknown key and bad JSON exit 1', () => {
    const emitted = [];
    const emit = (v) => emitted.push(v);
    expect(main({ readJson: () => ({ repoRoot: repo.root, headSha: repo.head, citations: [{ file: 'a.js', line: 1 }] }), emit })).toBe(0);
    expect(emitted[0].candidates[0].hunkHash).toMatch(SHA);
    expect(main({ readJson: () => ({ headSha: repo.head, citations: [], bogus: true }), emit })).toBe(1);
    expect(emitted[1]).toMatchObject({ ok: false });
    expect(main({ readJson: () => { throw new Error('Unexpected token'); }, emit })).toBe(1);
    expect(emitted[2].error).toMatch(/invalid JSON/);
  });

  test('CLI: default output goes through redact', () => {
    const secret = `ghp_${'a'.repeat(30)}`;
    const writes = [];
    const spy = jest.spyOn(process.stdout, 'write').mockImplementation((chunk) => { writes.push(String(chunk)); return true; });
    try {
      main({ readJson: () => ({ repoRoot: repo.root, headSha: repo.head, citations: [{ file: 'a.js', line: 1, claim: `leaks ${secret}` }] }) });
    } finally {
      spy.mockRestore();
    }
    const printed = writes.join('');
    expect(printed).not.toContain(secret);
    expect(printed).toContain('[REDACTED]');
    expect(printed.trim().split('\n')).toHaveLength(1);
    expect(JSON.parse(printed).ok).toBe(true);
  });
});

describe('every candidate carries the head it was hashed at (the stamp planCarry and recordVerdicts check)', () => {
  const repo = makeRepo({ 'src/a.js': lines(10), 'src/dyn.js': 'require(pick());\n' + lines(5) });
  const h1 = repo.head;
  const h2 = repo.commit({ 'src/a.js': lines(10, { 1: '// edited' }) });
  const CITATIONS = [
    { id: 'ok', file: 'src/a.js', line: 5 },
    { id: 'gone', file: 'src/missing.js', line: 1 },
    { id: 'computed', file: 'src/dyn.js', line: 3 },
    { id: 'noline', file: 'src/a.js' },
  ];

  test.each([['the first head', h1], ['the second head', h2]])('at %s every candidate, hashed or refused, is stamped with it', (_name, head) => {
    const out = hashCitations({ repoRoot: repo.root, headSha: head, citations: CITATIONS });
    expect(out.ok).toBe(true);
    expect(out.candidates.map((c) => ('hashError' in c ? 'refused' : 'hashed'))).toEqual(['hashed', 'refused', 'refused', 'refused']);
    for (const candidate of out.candidates) expect(candidate.headSha).toBe(head);
  });

  test('a candidate whose git read failed is stamped as well', () => {
    const failing = (args, opts) => (args[0] === 'grep' ? { status: 2, stdout: '', stderr: 'boom' } : realGit(args, opts));
    const out = hashCitations({ repoRoot: repo.root, headSha: h2, citations: [{ id: 'ok', file: 'src/a.js', line: 5 }] }, { git: failing });
    expect(out.candidates[0].hashError).toMatch(/^git read failed/);
    expect(out.candidates[0].headSha).toBe(h2);
  });

  test('a citation cannot bring a head of its own: the request is refused, so the stamp is always the hashed head', () => {
    const out = hashCitations({ repoRoot: repo.root, headSha: h2, citations: [{ file: 'src/a.js', line: 5, headSha: h1 }] });
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/unknown citation key\(s\): headSha/);
  });

  test('the CLI output keeps the stamp (redaction does not touch a head) on hashed and refused candidates alike', () => {
    const writes = [];
    const spy = jest.spyOn(process.stdout, 'write').mockImplementation((chunk) => { writes.push(String(chunk)); return true; });
    try {
      expect(main({ readJson: () => ({ repoRoot: repo.root, headSha: h2, citations: CITATIONS }) })).toBe(0);
    } finally {
      spy.mockRestore();
    }
    const printed = JSON.parse(writes.join(''));
    expect(printed.headSha).toBe(h2);
    expect(printed.candidates.map((c) => c.headSha)).toEqual([h2, h2, h2, h2]);
  });
});

describe('contract with planCarry', () => {
  const BASE = 'e'.repeat(40);
  /** The planCarry input of one round: prior verdicts hashed at h1, candidates hashed at h2, `deltaPaths` changed between. */
  function round(repo, h1, h2, citations, deltaPaths, overrides = {}) {
    const at = (sha) => hashCitations({ repoRoot: repo.root, headSha: sha, citations }).candidates;
    const stamp = { prId: '268', baseSha: BASE, depth: 'standard', expectedVerifiers: 1 };
    const prior = at(h1);
    return {
      ...stamp,
      headSha: h2,
      lastReviewedSha: h1,
      deltaPlan: { mode: 'delta', readSet: deltaPaths.map((p) => ({ path: p, reasons: ['changed'] })) },
      deltaPaths,
      deltaRange: { headSha: h2, lastReviewedSha: h1 },
      highPaths: [],
      priorVerdicts: prior.map(({ headSha: _hashedAt, ...c }) => ({ ...c, ...stamp, head: h1, outcome: 'present', votes: [{ verifier: 'v1', verdict: 'real' }] })),
      priorLedger: prior.map((c) => ({ id: c.id, file: c.file, failureMode: c.claim })),
      candidates: at(h2),
      ...overrides,
    };
  }
  const changedBetween = (repo, h1, h2) => git(repo.root, ['diff', '--name-only', h1, h2]).split('\n').sort();

  test('untouched citation carries; a citation whose dependency changed in the delta is reverify dependency-changed', () => {
    const repo = makeRepo({
      'src/a.js': "require('./dep');\n" + lines(10),
      'src/dep.js': 'module.exports = 1;\n',
      'src/b.js': "require('./other');\n" + lines(10),
      'src/other.js': 'module.exports = 1;\n',
    });
    const h1 = repo.head;
    const citations = [
      { id: 'A', file: 'src/a.js', line: 5, claim: 'a is wrong' },
      { id: 'B', file: 'src/b.js', line: 5, claim: 'b is wrong' },
    ];
    const h2 = repo.commit({ 'src/dep.js': 'module.exports = 2;\n', 'src/unrelated.md': 'note\n' });
    const deltaPaths = changedBetween(repo, h1, h2);
    expect(deltaPaths).toEqual(['src/dep.js', 'src/unrelated.md']);
    const plan = planCarry(round(repo, h1, h2, citations, deltaPaths));
    expect(plan.ok).toBe(true);
    expect(plan.carried.map((c) => c.id)).toEqual(['B']);
    expect(plan.carried[0]).toMatchObject({ head: h2, carriedFrom: h1 });
    expect(plan.reverify).toHaveLength(1);
    expect(plan.reverify[0]).toMatchObject({ id: 'A' });
    expect(plan.reverify[0].reasons).toContain(REASONS.DEPENDENCY_CHANGED);
  });

  test('a delta that ADDS the file a dangling import named makes the verdict dependency-changed', () => {
    const repo = makeRepo({ 'src/a.js': "require('./gone');\n" + lines(10), 'src/b.js': lines(10) });
    const h1 = repo.head;
    const citations = [{ id: 'A', file: 'src/a.js', line: 5, claim: 'a is wrong' }, { id: 'B', file: 'src/b.js', line: 5, claim: 'b is wrong' }];
    const h2 = repo.commit({ 'src/gone.js': 'module.exports = 1;\n' });
    const plan = planCarry(round(repo, h1, h2, citations, changedBetween(repo, h1, h2)));
    expect(plan.carried.map((c) => c.id)).toEqual(['B']);
    expect(plan.reverify).toHaveLength(1);
    expect(plan.reverify[0]).toMatchObject({ id: 'A' });
    expect(plan.reverify[0].reasons).toContain(REASONS.DEPENDENCY_CHANGED);
  });

  test('a changed CALLER of an unchanged cited file is dependent-changed (the dependents the producer lists feed planCarry)', () => {
    const repo = makeRepo({
      'lib/core.js': lines(10),
      'lib/caller.js': "require('./core');\n" + lines(5),
      'lib/solo.js': lines(10),
    });
    const h1 = repo.head;
    const citations = [
      { id: 'A', file: 'lib/core.js', line: 5, claim: 'core is wrong' },
      { id: 'B', file: 'lib/solo.js', line: 5, claim: 'solo is wrong' },
    ];
    const h2 = repo.commit({ 'lib/caller.js': "require('./core');\n// edited\n" + lines(5) });
    const plan = planCarry(round(repo, h1, h2, citations, changedBetween(repo, h1, h2)));
    expect(plan.carried.map((c) => c.id)).toEqual(['B']);
    expect(plan.reverify[0]).toMatchObject({ id: 'A' });
    expect(plan.reverify[0].reasons).toContain(REASONS.DEPENDENT_CHANGED);
  });

  test('candidates hashed at the PREVIOUS head cannot see a NEW caller: they are not carried from (candidate-head-mismatch), though every hash they hold is right for the file', () => {
    const repo = makeRepo({
      'lib/core.js': lines(10),
      'lib/caller.js': "require('./core');\n" + lines(5),
    });
    const h1 = repo.head;
    const citations = [{ id: 'A', file: 'lib/core.js', line: 5, claim: 'core is wrong' }];
    const h2 = repo.commit({ 'lib/new-caller.js': "require('./core');\n" + lines(5) });
    const deltaPaths = changedBetween(repo, h1, h2);
    expect(deltaPaths).toEqual(['lib/new-caller.js']);
    // control: candidates hashed at the head under review list the new caller
    const fresh = planCarry(round(repo, h1, h2, citations, deltaPaths));
    expect(fresh.carried).toEqual([]);
    expect(fresh.reverify[0].reasons).toEqual([REASONS.DEPENDENT_CHANGED]);
    // hashed at h1 they do not, so without the head stamp the planner saw a delta that touches none of their dependents
    const stale = hashCitations({ repoRoot: repo.root, headSha: h1, citations }).candidates;
    expect(stale[0].dependents).toEqual(['lib/caller.js']);
    const plan = planCarry(round(repo, h1, h2, citations, deltaPaths, { candidates: stale }));
    expect(plan.carried).toEqual([]);
    expect(plan.reverify[0].reasons).toEqual([REASONS.CANDIDATE_HEAD_MISMATCH]);
  });

  test('a citation that could not be hashed at the new head is re-verified (hash-missing), never carried', () => {
    const repo = makeRepo({ 'src/a.js': lines(10) });
    const h1 = repo.head;
    const citations = [{ id: 'A', file: 'src/a.js', line: 5, claim: 'a is wrong' }];
    const h2 = repo.commit({ 'src/a.js': 'require(pick());\n' + lines(10) });
    const input = round(repo, h1, h2, citations, ['unrelated.md']);
    expect(input.candidates[0].hashError).toBeDefined();
    const plan = planCarry(input);
    expect(plan.carried).toEqual([]);
    expect(plan.reverify[0].reasons).toContain(REASONS.HASH_MISSING);
  });
});

const NO_FIELDS = (out) => {
  expect(out).not.toHaveProperty('hunkHash');
  expect(out).not.toHaveProperty('depHashes');
  expect(out).not.toHaveProperty('dependents');
};

describe('symlinks are refused (git mode 120000)', () => {
  const repo = makeRepo({
    'real/target.js': lines(10),
    'src/plain.js': 'module.exports = 1;\n',
    'src/ok.js': "require('./plain');\n" + lines(10),
    'src/uses-link.js': "require('./via-link');\n" + lines(10),
  });
  fs.mkdirSync(path.join(repo.root, 'link'), { recursive: true });
  fs.symlinkSync('../real/target.js', path.join(repo.root, 'link/cited.js'));
  fs.symlinkSync('../real/target.js', path.join(repo.root, 'src/via-link.js'));
  const head = repo.commit({});

  test('the ls-tree listing carries the symlink mode', () => {
    expect(git(repo.root, ['ls-tree', head, 'link/cited.js'])).toMatch(/^120000 blob /);
  });

  test('a cited symlink => hashError "is a symlink", no hash fields (its link text must never be hashed)', () => {
    const out = one(repo, head, { file: 'link/cited.js', line: 1 });
    expect(out.hashError).toBe('link/cited.js is a symlink');
    NO_FIELDS(out);
  });

  test('a dependency reached through a symlink => hashError for the whole citation', () => {
    const out = one(repo, head, { file: 'src/uses-link.js', line: 5 });
    expect(out.hashError).toBe('src/via-link.js is a symlink');
    NO_FIELDS(out);
  });

  test('control: a regular file next to the symlinks still hashes, with its dependency', () => {
    const out = one(repo, head, { file: 'src/ok.js', line: 5 });
    expect(out.hashError).toBeUndefined();
    expect(out.hunkHash).toMatch(SHA);
    expect(Object.keys(out.depHashes)).toEqual(['src/plain.js']);
  });

  test('a changed symlink target can no longer leave a stale hash behind: the citation fails at both heads', () => {
    const next = repo.commit({ 'real/target.js': lines(10, { 1: '// CHANGED' }) });
    expect(one(repo, next, { file: 'link/cited.js', line: 1 }).hashError).toMatch(/symlink/);
    expect(one(repo, head, { file: 'link/cited.js', line: 1 }).hashError).toMatch(/symlink/);
  });

  test('a submodule gitlink (mode 160000) stays fail-closed, cited or as a dependency', () => {
    const r = makeRepo({ 'src/uses-gl.js': "require('./gl');\n" + lines(5), 'a.js': lines(3) });
    git(r.root, ['update-index', '--add', '--cacheinfo', `160000,${r.head},src/gl.js`]);
    git(r.root, ['commit', '-q', '-m', 'gitlink']);
    const sha = git(r.root, ['rev-parse', 'HEAD']);
    expect(git(r.root, ['ls-tree', sha, 'src/gl.js'])).toMatch(/^160000 commit /);
    const cited = one(r, sha, { file: 'src/gl.js', line: 1 });
    expect(cited.hashError).toBeDefined();
    NO_FIELDS(cited);
    const dep = one(r, sha, { file: 'src/uses-gl.js', line: 3 });
    expect(dep.hashError).toMatch(/src\/gl\.js cannot be read/);
    NO_FIELDS(dep);
  });
});

describe('a specifier that passes through a symlinked DIRECTORY is refused (an ancestor with git mode 120000)', () => {
  const ABSENT = require('crypto').createHash('sha256').update('absent').digest('hex');
  const repo = makeRepo({
    'lib/real-a/pkg.js': 'module.exports = {};\n',
    'lib/real-b/pkg.js': 'module.exports = null;\n',
    'lib/plain/pkg.js': 'module.exports = 1;\n',
    // cited files, each reading a package through another kind of path
    'lib/core9.js': "const pkg = require('./vendor.js/pkg');\n" + lines(6),
    'lib/deep.js': "const pkg = require('./vendor.js/sub/pkg');\n" + lines(6),
    'lib/bare-dir.js': "const pkg = require('./vendordir/pkg');\n" + lines(6),
    'lib/via-member.js': "require('./member');\n" + lines(6),
    'lib/member.js': "require('./vendor.js/pkg');\n",
    'lib/ctl.js': "const pkg = require('./plain/pkg');\n" + lines(6),
    'lib/dangling.js': "const pkg = require('./plain/missing');\n" + lines(6),
  });
  // two directories, linked: one named like a module (a name the delta planner sizes), one named like a directory
  fs.symlinkSync('real-a', path.join(repo.root, 'lib/vendor.js'));
  fs.symlinkSync('real-a', path.join(repo.root, 'lib/vendordir'));
  const head = repo.commit({});

  test('git lists the link as ONE entry (mode 120000) and nothing under it: no hash can see its target', () => {
    expect(git(repo.root, ['ls-tree', '-r', head, '--', 'lib/vendor.js'])).toMatch(/^120000 blob /);
    const names = git(repo.root, ['ls-tree', '-r', '--name-only', head]).split('\n');
    expect(names.filter((name) => name.startsWith('lib/vendor.js/'))).toEqual([]);
  });

  test('an import through a directory symlink named like a module (./vendor.js/pkg) is hashError and carries no hash fields', () => {
    const out = one(repo, head, { file: 'lib/core9.js', line: 3 });
    expect(out.hashError).toMatch(/symlinked directory lib\/vendor\.js/);
    NO_FIELDS(out);
  });

  test.each([
    ['an ancestor two levels up (./vendor.js/sub/pkg)', 'lib/deep.js', /symlinked directory lib\/vendor\.js/],
    ['a link that does not look like a file (./vendordir/pkg)', 'lib/bare-dir.js', /symlinked directory lib\/vendordir/],
    ['a specifier of a closure MEMBER, not of the cited file', 'lib/via-member.js', /symlinked directory lib\/vendor\.js/],
  ])('%s is refused too', (_name, file, pattern) => {
    const out = one(repo, head, { file, line: 3 });
    expect(out.hashError).toMatch(pattern);
    NO_FIELDS(out);
  });

  test('a CITED path behind the link says it passes through the link: the file does exist, through it, and "does not exist at the head" would misdirect the reader', () => {
    const out = one(repo, head, { file: 'lib/vendor.js/pkg.js', line: 1 });
    expect(out.hashError).toBe('lib/vendor.js/pkg.js passes through the symlinked directory lib/vendor.js');
    NO_FIELDS(out);
  });

  test('control: a specifier through an ORDINARY directory still hashes, resolved or (when nothing is there) absent', () => {
    const ok = one(repo, head, { file: 'lib/ctl.js', line: 3 });
    expect(ok.hashError).toBeUndefined();
    expect(Object.keys(ok.depHashes)).toEqual(['lib/plain/pkg.js']);
    const gone = one(repo, head, { file: 'lib/dangling.js', line: 3 });
    expect(gone.hashError).toBeUndefined();
    expect(gone.depHashes).toEqual({ 'lib/plain/missing': ABSENT });
  });

  test('retargeting the link (real-a -> real-b) can no longer leave a stale hash behind: the citation fails closed at both heads', () => {
    fs.unlinkSync(path.join(repo.root, 'lib/vendor.js'));
    fs.symlinkSync('real-b', path.join(repo.root, 'lib/vendor.js'));
    const next = repo.commit({});
    expect(git(repo.root, ['diff', '--name-only', head, next])).toBe('lib/vendor.js');
    expect(one(repo, next, { file: 'lib/core9.js', line: 3 }).hashError).toMatch(/symlinked directory/);
    expect(one(repo, head, { file: 'lib/core9.js', line: 3 }).hashError).toMatch(/symlinked directory/);
  });
});

describe('a specifier that passes through a SUBMODULE is refused (an ancestor with git mode 160000)', () => {
  const POINTER_A = 'a'.repeat(40);
  const POINTER_B = 'b'.repeat(40);
  const repo = makeRepo({
    'lib/plain/x.js': 'module.exports = 1;\n',
    // cited files, each reading through another kind of path
    'lib/core10.js': "const x = require('./gl.js/x');\n" + lines(6),
    'lib/deep10.js': "const x = require('./gl.js/sub/x');\n" + lines(6),
    'lib/bare10.js': "const x = require('./gldir/x');\n" + lines(6),
    'lib/via-member10.js': "require('./member10');\n" + lines(6),
    'lib/member10.js': "require('./gl.js/x');\n",
    'lib/ctl10.js': "const x = require('./plain/x');\n" + lines(6),
  });
  // two submodules, one named like a module (a name the delta planner sizes), one named like a directory; committed by hand
  // because `commit()` stages with `add -A`, which would drop an index entry whose path is not in the working tree
  const pointAt = (sha) => {
    for (const submodule of ['lib/gl.js', 'lib/gldir']) git(repo.root, ['update-index', '--add', '--cacheinfo', `160000,${sha},${submodule}`]);
    git(repo.root, ['commit', '-q', '--allow-empty', '-m', 'pointer']);
    return git(repo.root, ['rev-parse', 'HEAD']);
  };
  const head = pointAt(POINTER_A);

  test('git lists the submodule as ONE commit entry (mode 160000) and nothing under it: no hash can see where it points', () => {
    expect(git(repo.root, ['ls-tree', '-r', head, '--', 'lib/gl.js'])).toMatch(/^160000 commit /);
    const names = git(repo.root, ['ls-tree', '-r', '--name-only', head]).split('\n');
    expect(names.filter((name) => name.startsWith('lib/gl.js/'))).toEqual([]);
  });

  test('an import through a submodule named like a module (./gl.js/x) is hashError and carries no hash fields', () => {
    const out = one(repo, head, { file: 'lib/core10.js', line: 3 });
    expect(out.hashError).toMatch(/passes through the submodule lib\/gl\.js/);
    NO_FIELDS(out);
  });

  test.each([
    ['an ancestor two levels up (./gl.js/sub/x)', 'lib/deep10.js', /submodule lib\/gl\.js/],
    ['a submodule that does not look like a file (./gldir/x)', 'lib/bare10.js', /submodule lib\/gldir/],
    ['a specifier of a closure MEMBER, not of the cited file', 'lib/via-member10.js', /submodule lib\/gl\.js/],
  ])('%s is refused too', (_name, file, pattern) => {
    const out = one(repo, head, { file, line: 3 });
    expect(out.hashError).toMatch(pattern);
    NO_FIELDS(out);
  });

  test('control: a specifier through an ORDINARY directory still hashes next to the submodules', () => {
    const ok = one(repo, head, { file: 'lib/ctl10.js', line: 3 });
    expect(ok.hashError).toBeUndefined();
    expect(Object.keys(ok.depHashes)).toEqual(['lib/plain/x.js']);
  });

  test('a CITED path behind the submodule says it passes through it, not that the file does not exist', () => {
    const out = one(repo, head, { file: 'lib/gl.js/x.js', line: 1 });
    expect(out.hashError).toBe('lib/gl.js/x.js passes through the submodule lib/gl.js');
    NO_FIELDS(out);
  });

  test('moving the pointer can no longer leave a stale hash behind: the citation fails closed at both heads', () => {
    const next = pointAt(POINTER_B);
    expect(git(repo.root, ['diff', '--name-only', head, next]).split('\n')).toEqual(['lib/gl.js', 'lib/gldir']);
    expect(one(repo, next, { file: 'lib/core10.js', line: 3 }).hashError).toMatch(/submodule/);
    expect(one(repo, head, { file: 'lib/core10.js', line: 3 }).hashError).toMatch(/submodule/);
  });
});

describe('dependents (the blast radius of the cited file)', () => {
  const FILES = {
    'lib/core.js': lines(10),
    'z/user.js': "require('../lib/core');\n",
    'app/user2.js': "const c = require('../lib/core.js');\n",
    // imports core AND is the name-matched test of core: listed once
    'tests/core.test.js': "require('../lib/core');\n",
    // a test of core by name only: no import edge
    'a/core.spec.js': 'test(1);\n',
    // computed specifier that names core
    'lib/dyn.js': "const p = require(path.join(dir, 'core.js'));\n",
    // computed specifier that does not name core
    'lib/dyn2.js': 'require(pick(x));\n',
    'lib/unrelated.js': 'module.exports = 0;\n',
    // a test whose stem equals ownerStemOf of the cited test file 'tests/core.test.js'
    'b/core.test.test.js': 'test(2);\n',
  };
  const repo = makeRepo(FILES);
  const dependentsOf = (file) => one(repo, repo.head, { file, line: 1 });

  test('importers: every file importing the cited one (extension and extensionless specifiers)', () => {
    const { dependents } = dependentsOf('lib/core.js');
    expect(dependents).toEqual(expect.arrayContaining(['z/user.js', 'app/user2.js']));
  });

  test('a name-matched test with NO import edge is a dependent', () => {
    expect(dependentsOf('lib/core.js').dependents).toContain('a/core.spec.js');
  });

  test('a computed-specifier file whose text names the cited file is a dependent; one that does not is not', () => {
    const { dependents } = dependentsOf('lib/core.js');
    expect(dependents).toContain('lib/dyn.js');
    expect(dependents).not.toContain('lib/dyn2.js');
    expect(dependents).not.toContain('lib/unrelated.js');
  });

  test('the cited file never lists itself, even when it imports itself', () => {
    const r = makeRepo({ 'self.js': "require('./self');\n" + lines(4), 'other.js': "require('./self');\n" });
    const out = one(r, r.head, { file: 'self.js', line: 1 });
    expect(out.dependents).toEqual(['other.js']);
  });

  test('dependents are sorted and de-duplicated (a file reached by several rules is listed once)', () => {
    expect(dependentsOf('lib/core.js').dependents).toEqual([
      'a/core.spec.js', 'app/user2.js', 'lib/dyn.js', 'tests/core.test.js', 'z/user.js',
    ]);
  });

  test('a cited TEST file does not apply the stem rule: a test whose stem equals the cited test\'s own stem is not listed', () => {
    // ownerStemOf('tests/core.test.js') is 'core.test'; 'b/core.test.test.js' has testStem 'core.test'.
    const out = dependentsOf('tests/core.test.js');
    expect(out.dependents).toEqual([]);
    expect(out.depHashes['lib/core.js']).toMatch(SHA);
  });

  test('a file nothing uses has dependents []', () => {
    expect(dependentsOf('lib/unrelated.js').dependents).toEqual([]);
  });

  test('a documentation citation also gets its dependents', () => {
    const r = makeRepo({ 'docs/guide.md': '# g\nline\n', 'x.js': 'x\n' });
    const out = one(r, r.head, { file: 'docs/guide.md', line: 2 });
    expect(out.dependents).toEqual([]);
    expect(out.depHashes).toEqual({});
  });

  test('the graph and name lines are built once per call: <= 2 greps and 1 ls-tree for many citations', () => {
    const calls = [];
    const out = hashCitations({
      repoRoot: repo.root,
      headSha: repo.head,
      citations: [{ file: 'lib/core.js', line: 1 }, { file: 'z/user.js', line: 1 }, { file: 'lib/unrelated.js', line: 1 }],
    }, { git: (args, opts) => { calls.push(args[0]); return realGit(args, opts); } });
    expect(out.candidates.every((c) => Array.isArray(c.dependents))).toBe(true);
    expect(calls.filter((c) => c === 'ls-tree')).toHaveLength(1);
    expect(calls.filter((c) => c === 'grep')).toHaveLength(2);
  });

  test('no grep at all when every citation fails before the dependents step', () => {
    const calls = [];
    hashCitations({ repoRoot: repo.root, headSha: repo.head, citations: [{ file: 'nope.js', line: 1 }] },
      { git: (args, opts) => { calls.push(args[0]); return realGit(args, opts); } });
    expect(calls).not.toContain('grep');
  });

  test('a failed reference scan fails closed: hashError, no hash fields; a citation that failed earlier keeps its own error', () => {
    const failing = (args, opts) => (args[0] === 'grep' ? { status: 2, stdout: '', stderr: 'boom' } : realGit(args, opts));
    const out = hashCitations({
      repoRoot: repo.root,
      headSha: repo.head,
      citations: [{ id: 'gone', file: 'nope.js', line: 1 }, { id: 'ok', file: 'lib/core.js', line: 1 }],
    }, { git: failing });
    expect(out.ok).toBe(true);
    expect(out.candidates[0].hashError).toMatch(/does not exist/);
    expect(out.candidates[1].hashError).toMatch(/^git read failed: .*reference scan/);
    NO_FIELDS(out.candidates[1]);
    expect(out.candidates[1]).toMatchObject({ id: 'ok', file: 'lib/core.js', line: 1 });
  });

  test('a failed name scan (computed-specifier files) fails closed too', () => {
    const failing = (args, opts) => (args[0] === 'grep' && args.includes('-F') ? { status: 2, stdout: '', stderr: 'boom' } : realGit(args, opts));
    const out = hashCitations({ repoRoot: repo.root, headSha: repo.head, citations: [{ file: 'lib/core.js', line: 1 }] }, { git: failing });
    expect(out.candidates[0].hashError).toMatch(/^git read failed: .*name scan/);
    NO_FIELDS(out.candidates[0]);
  });

  test('PARITY with planDeltaReview: dependents of C == the readSet of changedPaths [C] minus C', () => {
    const C = 'lib/core.js';
    const deps = { git: realGit };
    const refLines = scanReferenceLines(deps, repo.root, repo.head);
    const graph = buildImportGraph({ filePaths: git(repo.root, ['ls-tree', '-r', '--name-only', repo.head]).split('\n'), lines: refLines });
    expect(graph.computed.length).toBeGreaterThan(0);
    const nameLines = scanNameLines(deps, repo.root, repo.head, graph.computed, [C]);
    const plan = planDeltaReview({
      changedPaths: [C],
      pathsClassification: { ok: true, paths: [{ path: C }] },
      delta: { ok: true, mode: 'delta', baseSha: repo.head, lastReviewedSha: repo.head, headSha: repo.head, reason: 'x' },
      reviewed: { headSha: repo.head, baseSha: repo.head },
      importGraph: graph,
      nameLines,
    });
    expect(plan.mode).toBe('delta');
    const expected = plan.readSet.map((e) => e.path).filter((p) => p !== C).sort();
    expect(expected.length).toBeGreaterThanOrEqual(5);
    expect(dependentsOf(C).dependents).toEqual(expected);
  });
});

describe('redaction limit', () => {
  test('CLI default emit replaces a depHashes value whose KEY looks sensitive: planCarry then sees a missing hash', () => {
    const r = makeRepo({ 'a.js': "require('./lib/token-cache');\n" + lines(5), 'lib/token-cache.js': 'module.exports = 1;\n', 'lib/plain.js': 'x\n' });
    const writes = [];
    const spy = jest.spyOn(process.stdout, 'write').mockImplementation((chunk) => { writes.push(String(chunk)); return true; });
    try {
      expect(main({ readJson: () => ({ repoRoot: r.root, headSha: r.head, citations: [{ file: 'a.js', line: 3 }] }) })).toBe(0);
    } finally {
      spy.mockRestore();
    }
    const printed = JSON.parse(writes.join(''));
    expect(printed.candidates[0].depHashes['lib/token-cache.js']).toBe('[REDACTED]');
    expect(printed.candidates[0].hunkHash).toMatch(SHA);
  });
});
