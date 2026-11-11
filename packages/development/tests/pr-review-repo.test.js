'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const repo = require('../lib/pr-review-repo');
const runtime = require('../lib/review-record-runtime');

const roots = [];

// The fixture repositories must never see a GIT_* variable (GIT_DIR, GIT_WORK_TREE, GIT_INDEX_FILE, ...) of the process that
// runs the tests.
const GIT_ENV = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))), GIT_TERMINAL_PROMPT: '0' };

function sh(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: GIT_ENV });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout.trim();
}

function mkdir(prefix) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  roots.push(dir);
  return dir;
}

function initRepo(dir) {
  sh(dir, ['init', '-q', '-b', 'main']);
  sh(dir, ['config', 'user.name', 'T']);
  sh(dir, ['config', 'user.email', 't@example.com']);
  sh(dir, ['config', 'commit.gpgsign', 'false']);
}

function commit(dir, files, message) {
  for (const [name, content] of Object.entries(files)) {
    const full = path.join(dir, name);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  sh(dir, ['add', '-A']);
  sh(dir, ['commit', '-q', '-m', message]);
  return sh(dir, ['rev-parse', 'HEAD']);
}

const numbered = (n, replace = {}) =>
  Array.from({ length: n }, (_, i) => replace[i + 1] || `line ${i + 1}`).join('\n') + '\n';

const git = runtime.defaultGit();
let dir;
let base;
let p1;
let p2;
let other;

beforeAll(() => {
  dir = mkdir('prr-repo-');
  initRepo(dir);
  base = commit(dir, { 'README.md': 'base\n' }, 'base');
  p1 = commit(dir, { 'src/widget.js': numbered(30), 'src/other.js': numbered(5), 'bin.dat': Buffer.from([0, 1, 2, 3]) }, 'p1');
  p2 = commit(dir, { 'src/widget.js': numbered(30, { 12: 'CHANGED 12' }) }, 'p2');
  sh(dir, ['checkout', '-q', '--orphan', 'unrelated']);
  sh(dir, ['rm', '-rf', '-q', '.']);
  other = commit(dir, { 'z.txt': 'z\n' }, 'unrelated');
  sh(dir, ['checkout', '-q', 'main']);
});

afterAll(() => {
  for (const r of roots) fs.rmSync(r, { recursive: true, force: true });
});

const scripted = (reply) => {
  const calls = [];
  const fake = (args, opts) => {
    calls.push({ args, opts });
    return reply(args);
  };
  fake.calls = calls;
  return fake;
};

describe('resolveCommit', () => {
  test('resolves an abbreviation to the full lowercase id', () => {
    expect(repo.resolveCommit(git, dir, p2.slice(0, 8))).toBe(p2);
    expect(repo.resolveCommit(git, dir, p2.toUpperCase())).toBe(p2);
  });

  test('an unknown hex id is null', () => {
    expect(repo.resolveCommit(git, dir, 'deadbeefdeadbeef')).toBeNull();
  });

  test('anything that is not 7-64 hex never reaches git', () => {
    const fake = scripted(() => ({ status: 0, stdout: `${p2}\n`, stderr: '' }));
    for (const bad of ['main', 'HEAD', '--output=x', '-h', 'abc123', 'g'.repeat(10), `${'a'.repeat(65)}`, '', null, undefined, 42, {}]) {
      expect(repo.resolveCommit(fake, dir, bad)).toBeNull();
    }
    expect(fake.calls).toHaveLength(0);
  });

  test('asks git for the commit peel of a verified, quiet rev', () => {
    const fake = scripted(() => ({ status: 1, stdout: '', stderr: '' }));
    expect(repo.resolveCommit(fake, '/x', 'abcdef1')).toBeNull();
    expect(fake.calls[0]).toEqual({ args: ['rev-parse', '--verify', '--quiet', 'abcdef1^{commit}'], opts: { cwd: '/x' } });
  });

  test('a git that could not be spawned is null', () => {
    expect(repo.resolveCommit(() => ({ status: 127, stdout: '', stderr: 'ENOENT' }), dir, p2)).toBeNull();
  });
});

describe('isAncestor', () => {
  test('true, false, and null for anything else', () => {
    expect(repo.isAncestor(git, dir, p1, p2)).toBe(true);
    expect(repo.isAncestor(git, dir, p2, p1)).toBe(false);
    expect(repo.isAncestor(git, dir, p2, p2)).toBe(true);
    expect(repo.isAncestor(() => ({ status: 128, stdout: '', stderr: '' }), dir, p1, p2)).toBeNull();
  });

  test('a non-hex argument is null without a git call', () => {
    const fake = scripted(() => ({ status: 0, stdout: '', stderr: '' }));
    expect(repo.isAncestor(fake, dir, '--foo', p2)).toBeNull();
    expect(repo.isAncestor(fake, dir, p1, 'main')).toBeNull();
    expect(fake.calls).toHaveLength(0);
  });
});

describe('commitOnPr', () => {
  const on = (commitId, head = p2, baseSha = base) => repo.commitOnPr(git, dir, { commit: commitId, headSha: head, baseSha });

  test('accepts a PR commit, the head itself, and an abbreviation', () => {
    expect(on(p1)).toEqual({ ok: true, commit: p1 });
    expect(on(p2)).toEqual({ ok: true, commit: p2 });
    expect(on(p1.slice(0, 9))).toEqual({ ok: true, commit: p1 });
  });

  test('rejects base history, including the base itself', () => {
    expect(on(base)).toEqual({ ok: false, reason: 'in-base-history' });
  });

  test('rejects a commit on an unrelated branch', () => {
    expect(on(other)).toEqual({ ok: false, reason: 'not-an-ancestor-of-head' });
  });

  test('distinct reasons for an unknown commit, a missing head and a missing base', () => {
    expect(on('deadbeefdeadbeef')).toEqual({ ok: false, reason: 'commit-not-found' });
    expect(on('main')).toEqual({ ok: false, reason: 'commit-not-found' });
    expect(on(p1, 'deadbeefdeadbeef')).toEqual({ ok: false, reason: 'head-not-found' });
    expect(on(p1, p2, 'deadbeefdeadbeef')).toEqual({ ok: false, reason: 'base-not-found' });
  });

  test('a null ancestry answer fails closed as ancestry-unknown', () => {
    const fake = scripted((args) =>
      args[0] === 'rev-parse' ? { status: 0, stdout: `${p1}\n`, stderr: '' } : { status: 128, stdout: '', stderr: 'boom' }
    );
    expect(repo.commitOnPr(fake, dir, { commit: p1, headSha: p2, baseSha: base })).toEqual({ ok: false, reason: 'ancestry-unknown' });
  });

  test('an unknown ancestry against the base fails closed too', () => {
    const fake = scripted((args) => {
      if (args[0] === 'rev-parse') return { status: 0, stdout: `${p1}\n`, stderr: '' };
      return args[3] === base || args[4] === base ? { status: 128, stdout: '', stderr: '' } : { status: 0, stdout: '', stderr: '' };
    });
    const result = repo.commitOnPr(fake, dir, { commit: p1, headSha: p1, baseSha: base });
    expect(result.ok).toBe(false);
    expect(['ancestry-unknown', 'in-base-history']).toContain(result.reason);
  });
});

describe('primaryWorktree', () => {
  test('returns the primary from the primary and from a linked worktree', () => {
    expect(repo.primaryWorktree(git, dir)).toEqual({ ok: true, path: dir });
    const linked = path.join(mkdir('prr-linked-'), 'wt');
    sh(dir, ['worktree', 'add', '-q', '--detach', linked, p1]);
    expect(repo.primaryWorktree(git, linked)).toEqual({ ok: true, path: dir });
    sh(dir, ['worktree', 'remove', '--force', linked]);
  });

  test('a bare repository common dir fails', () => {
    const bare = mkdir('prr-bare-');
    sh(bare, ['init', '-q', '--bare']);
    expect(repo.primaryWorktree(git, bare)).toEqual({ ok: false, reason: 'no-primary-worktree' });
  });

  test('git failing fails', () => {
    expect(repo.primaryWorktree(() => ({ status: 128, stdout: '', stderr: '' }), dir)).toEqual({ ok: false, reason: 'no-primary-worktree' });
  });
});

describe('bindRepository (shared by the PR-review recorder and the merge sweep)', () => {
  const remoteV = (lines) => () => ({ status: 0, stdout: lines.join('\n') + '\n', stderr: '' });
  const both = (name, url) => [`${name}\t${url} (fetch)`, `${name}\t${url} (push)`];

  test('names the repository: every fetch and push URL of origin, any case, any URL form', () => {
    for (const url of ['https://github.com/Acme/Widgets.git', 'https://github.com/acme/widgets', 'ssh://git@github.com:2222/Acme/Widgets.git/', 'git@github.com:ACME/Widgets.git']) {
      expect(repo.bindRepository(remoteV(both('origin', url)), '/r', 'Acme/Widgets')).toEqual({ ok: true });
    }
  });

  test('another repository is repository-mismatch, also from the push URL alone and whatever another remote says', () => {
    const mismatch = (lines) => repo.bindRepository(remoteV(lines), '/r', 'Acme/Widgets');
    expect(mismatch(both('origin', 'https://github.com/o/Widgets.git'))).toMatchObject({ ok: false, code: 'repository-mismatch' });
    expect(mismatch([...both('origin', 'https://github.com/o/Widgets.git'), ...both('upstream', 'https://github.com/Acme/Widgets.git')])).toMatchObject({ ok: false, code: 'repository-mismatch' });
    expect(mismatch(['origin\thttps://github.com/Acme/Widgets.git (fetch)', 'origin\thttps://github.com/o/Widgets.git (push)'])).toMatchObject({ ok: false, code: 'repository-mismatch' });
  });

  test('no origin, a URL naming no owner/name, and a git that fails or answers nothing usable are repository-unknown', () => {
    const unknown = (git) => repo.bindRepository(git, '/r', 'Acme/Widgets');
    expect(unknown(remoteV([]))).toMatchObject({ ok: false, code: 'repository-unknown' });
    expect(unknown(remoteV(both('github', 'https://github.com/Acme/Widgets.git')))).toMatchObject({ ok: false, code: 'repository-unknown' });
    expect(unknown(remoteV(both('origin', '/srv/git/widgets.git')))).toMatchObject({ ok: false, code: 'repository-unknown' });
    expect(unknown(() => ({ status: 128, stdout: 'origin\thttps://github.com/Acme/Widgets.git (fetch)\n', stderr: '' }))).toMatchObject({ ok: false, code: 'repository-unknown' });
    expect(unknown(() => undefined)).toMatchObject({ ok: false, code: 'repository-unknown' });
    expect(unknown(() => null)).toMatchObject({ ok: false, code: 'repository-unknown' });
  });

  test('asks git for the remotes of the checkout it was given', () => {
    const calls = [];
    repo.bindRepository((args, options) => (calls.push([args, options]), { status: 0, stdout: both('origin', 'https://github.com/Acme/Widgets.git').join('\n'), stderr: '' }), '/some/root', 'Acme/Widgets');
    expect(calls).toEqual([[['remote', '-v'], { cwd: '/some/root' }]]);
  });
});

describe('holdsHead', () => {
  test('true on the head and when HEAD is a descendant; false on the base and for a sha not in the repository', () => {
    expect(repo.holdsHead(git, dir, p2)).toBe(true);
    expect(repo.holdsHead(git, dir, p1)).toBe(true);
    const wt = path.join(mkdir('prr-hold-'), 'wt');
    sh(dir, ['worktree', 'add', '-q', '--detach', wt, p1]);
    expect(repo.holdsHead(git, wt, p1)).toBe(true);
    expect(repo.holdsHead(git, wt, p2)).toBe(false);
    expect(repo.holdsHead(git, wt, base)).toBe(true);
    sh(dir, ['worktree', 'remove', '--force', wt]);
    expect(repo.holdsHead(git, dir, 'deadbeefdeadbeef')).toBe(false);
  });

  test('other git failures are null', () => {
    const fake = scripted((args) =>
      args[0] === 'rev-parse' ? { status: 0, stdout: `${p1}\n`, stderr: '' } : { status: 128, stdout: '', stderr: '' }
    );
    expect(repo.holdsHead(fake, dir, p1)).toBeNull();
  });
});

describe('readBlobAt', () => {
  test('reads committed text, not the working tree', () => {
    fs.writeFileSync(path.join(dir, 'src/other.js'), 'dirty\n');
    expect(repo.readBlobAt(git, dir, p1, 'src/other.js')).toEqual({ ok: true, text: numbered(5) });
    sh(dir, ['checkout', '--', 'src/other.js']);
  });

  test('text is null for a path absent at that commit', () => {
    expect(repo.readBlobAt(git, dir, base, 'src/widget.js')).toEqual({ ok: true, text: null });
  });

  test('rejects bad paths and unknown commits', () => {
    for (const bad of ['../x', 'a/../../x', '/etc/passwd', 'a\0b', '', 'src/..']) {
      expect(repo.readBlobAt(git, dir, p1, bad)).toEqual({ ok: false, reason: 'bad-path' });
    }
    expect(repo.readBlobAt(git, dir, 'deadbeefdeadbeef', 'README.md')).toEqual({ ok: false, reason: 'commit-not-found' });
    expect(repo.readBlobAt(git, dir, p1, 'src')).toEqual({ ok: false, reason: 'not-a-blob' });
  });
});

describe('changedOldLines', () => {
  const lines = (from, to, file) => repo.changedOldLines(git, dir, { from, to, file });

  test('a modified line gives its exact old number', () => {
    expect(lines(p1, p2, 'src/widget.js')).toEqual({
      ok: true,
      lines: [12],
      hunks: [{ oldStart: 12, oldCount: 1, newStart: 12, newCount: 1 }]
    });
  });

  test('an unchanged file is []', () => {
    expect(lines(p1, p2, 'src/other.js')).toEqual({ ok: true, lines: [], hunks: [] });
  });

  test('a pure insertion contributes no old lines; a multi-hunk edit lists each', () => {
    const w = mkdir('prr-diff-');
    initRepo(w);
    const a = commit(w, { 'f.txt': numbered(40) }, 'a');
    const ins = commit(w, { 'f.txt': numbered(40).replace('line 5\n', 'line 5\nnew\nnew2\n') }, 'ins');
    expect(repo.changedOldLines(git, w, { from: a, to: ins, file: 'f.txt' })).toEqual({
      ok: true,
      lines: [],
      hunks: [{ oldStart: 5, oldCount: 0, newStart: 6, newCount: 2 }]
    });
    const multi = commit(
      w,
      { 'f.txt': numbered(40).replace('line 5\n', 'line 5\nnew\nnew2\n').replace('line 10\nline 11\n', 'X\n').replace('line 30\n', 'Y\nZ\n') },
      'multi'
    );
    expect(repo.changedOldLines(git, w, { from: a, to: multi, file: 'f.txt' })).toEqual({
      ok: true,
      lines: [10, 11, 30],
      hunks: [
        { oldStart: 5, oldCount: 0, newStart: 6, newCount: 2 },
        { oldStart: 10, oldCount: 2, newStart: 12, newCount: 1 },
        { oldStart: 30, oldCount: 1, newStart: 31, newCount: 2 }
      ]
    });
  });

  test('deleted and created files and a binary change are the whole file (null)', () => {
    const w = mkdir('prr-diff2-');
    initRepo(w);
    const a = commit(w, { 'gone.txt': 'x\n', 'bin.dat': Buffer.from([0, 1, 2]) }, 'a');
    fs.unlinkSync(path.join(w, 'gone.txt'));
    fs.writeFileSync(path.join(w, 'bin.dat'), Buffer.from([0, 9, 9, 9]));
    fs.writeFileSync(path.join(w, 'new.txt'), 'n\n');
    sh(w, ['add', '-A']);
    sh(w, ['commit', '-q', '-m', 'b']);
    const b = sh(w, ['rev-parse', 'HEAD']);
    for (const file of ['gone.txt', 'bin.dat', 'new.txt']) {
      expect(repo.changedOldLines(git, w, { from: a, to: b, file })).toEqual({ ok: true, lines: null, hunks: null });
    }
  });

  test('a mode-only change touches no line (a chmod is not a fix)', () => {
    const w = mkdir('prr-mode-');
    initRepo(w);
    const a = commit(w, { 'run.sh': 'echo\nexit 0\n' }, 'a');
    fs.chmodSync(path.join(w, 'run.sh'), 0o755);
    sh(w, ['add', '-A']);
    sh(w, ['commit', '-q', '-m', 'chmod']);
    const b = sh(w, ['rev-parse', 'HEAD']);
    expect(sh(w, ['diff', '--summary', a, b])).toContain('mode change');
    expect(repo.changedOldLines(git, w, { from: a, to: b, file: 'run.sh' })).toEqual({ ok: true, lines: [], hunks: [] });
  });

  test('a file named like an option stays a pathspec and writes nothing', () => {
    const w = mkdir('prr-diff3-');
    initRepo(w);
    const a = commit(w, { '--output=x': 'one\n' }, 'a');
    const b = commit(w, { '--output=x': 'two\n' }, 'b');
    const before = sh(w, ['status', '--porcelain']);
    expect(repo.changedOldLines(git, w, { from: a, to: b, file: '--output=x' })).toMatchObject({ ok: true, lines: [1] });
    expect(fs.existsSync(path.join(w, 'x'))).toBe(false);
    expect(sh(w, ['status', '--porcelain'])).toBe(before);
  });

  test('a glob character is literal', () => {
    const w = mkdir('prr-diff4-');
    initRepo(w);
    const a = commit(w, { 'a.js': '1\n', 'b.js': '1\n' }, 'a');
    const b = commit(w, { 'a.js': '2\n' }, 'b');
    expect(repo.changedOldLines(git, w, { from: a, to: b, file: '*.js' })).toEqual({ ok: true, lines: [], hunks: [] });
  });

  test('unresolvable commits and bad paths fail', () => {
    expect(lines('deadbeefdeadbeef', p2, 'src/widget.js').ok).toBe(false);
    expect(lines(p1, 'main', 'src/widget.js').ok).toBe(false);
    expect(lines(p1, p2, '../x')).toEqual({ ok: false, reason: 'bad-path' });
  });

  test('a diff that git fails on is not read as "no change"', () => {
    const fake = scripted((args) =>
      args[0] === 'rev-parse' ? { status: 0, stdout: `${p1}\n`, stderr: '' } : { status: 128, stdout: '', stderr: 'bad' }
    );
    expect(repo.changedOldLines(fake, dir, { from: p1, to: p2, file: 'a' })).toEqual({ ok: false, reason: 'diff-failed' });
  });

  test('runs a read-only diff with the file after --', () => {
    const fake = scripted((args) =>
      args[0] === 'rev-parse' ? { status: 0, stdout: `${p1}\n`, stderr: '' } : { status: 0, stdout: '', stderr: '' }
    );
    repo.changedOldLines(fake, dir, { from: p1, to: p2, file: 'a.js' });
    const diff = fake.calls.map((c) => c.args).find((a) => a.includes('diff'));
    expect(diff.slice(-2)).toEqual(['--', 'a.js']);
    expect(diff).toEqual(expect.arrayContaining(['-U0', '--no-color', '--no-ext-diff', '--no-textconv', '--no-renames']));
  });
});

describe('renamedPaths', () => {
  let w;
  let a;
  let c1;
  let c2;
  let c3;
  const moves = (from, to) => repo.renamedPaths(git, w, { from, to });

  beforeAll(() => {
    w = mkdir('prr-rename-');
    initRepo(w);
    a = commit(w, { 'src/a.js': numbered(30), 'src/keep.js': numbered(5), 'docs/old name.md': numbered(10), 'src/caf\u00e9.js': numbered(8) }, 'a');
    sh(w, ['mv', 'src/a.js', 'src/b.js']);
    c1 = commit(w, {}, 'rename only');
    sh(w, ['mv', 'docs/old name.md', 'docs/new name.md']);
    sh(w, ['mv', 'src/caf\u00e9.js', 'src/m\u00fcnchen.js']);
    c2 = commit(w, { 'src/b.js': numbered(30, { 12: 'CHANGED 12' }) }, 'rename two more, edit one');
    sh(w, ['rm', '-q', 'src/keep.js']);
    c3 = commit(w, {}, 'delete outright');
  });

  test('a rename is paired old path to new path', () => {
    expect(moves(a, c1)).toEqual({ ok: true, moves: new Map([['src/a.js', 'src/b.js']]) });
  });

  test('a name with a space, a name that is not ASCII and an edited rename are paired too (the paths are not quoted)', () => {
    const r = moves(c1, c2);
    expect(r.ok).toBe(true);
    expect([...r.moves.entries()].sort()).toEqual(
      [
        ['docs/old name.md', 'docs/new name.md'],
        ['src/caf\u00e9.js', 'src/m\u00fcnchen.js']
      ].sort()
    );
    expect(moves(a, c2).moves.get('src/a.js')).toBe('src/b.js');
  });

  test('a file deleted outright, or nothing changed at all, is no rename', () => {
    expect(moves(c2, c3)).toEqual({ ok: true, moves: new Map() });
    expect(moves(a, a)).toEqual({ ok: true, moves: new Map() });
  });

  test('unresolvable commits fail', () => {
    expect(repo.renamedPaths(git, w, { from: 'deadbeefdeadbeef', to: c1 })).toEqual({ ok: false, reason: 'from-not-found' });
    expect(repo.renamedPaths(git, w, { from: a, to: 'main' })).toEqual({ ok: false, reason: 'to-not-found' });
  });

  test('a diff git fails on, or output that is not a rename list, is not read as "nothing was renamed"', () => {
    const answering = (diff) => scripted((args) => (args[0] === 'rev-parse' ? { status: 0, stdout: `${a}\n`, stderr: '' } : diff));
    expect(repo.renamedPaths(answering({ status: 128, stdout: '', stderr: 'bad' }), w, { from: a, to: c1 })).toEqual({ ok: false, reason: 'diff-failed' });
    for (const stdout of ['R100\0src/a.js\0', 'M\0src/a.js\0src/b.js\0', 'R100\0\0src/b.js\0', 'R100\0src/a.js\0src/b.js\0R100\0x\0']) {
      expect(repo.renamedPaths(answering({ status: 0, stdout, stderr: '' }), w, { from: a, to: c1 })).toEqual({ ok: false, reason: 'unreadable-diff' });
    }
  });

  test('runs a read-only whole-tree diff between two full ids, with rename detection and no pathspec', () => {
    const fake = scripted((args) => (args[0] === 'rev-parse' ? { status: 0, stdout: `${a}\n`, stderr: '' } : { status: 0, stdout: '', stderr: '' }));
    repo.renamedPaths(fake, w, { from: a, to: c1 });
    const diff = fake.calls.map((c) => c.args).find((args) => args.includes('diff'));
    expect(diff).toEqual(expect.arrayContaining(['--name-status', '-z', '--find-renames', '--diff-filter=R', '--no-ext-diff']));
    expect(diff).not.toContain('--');
    expect(diff.slice(-2)).toEqual([a, a]);
  });
});

describe('advanceLine', () => {
  const h = (oldStart, oldCount, newStart, newCount) => ({ oldStart, oldCount, newStart, newCount });

  test('an insertion above pushes a line down; one after it leaves it', () => {
    expect(repo.advanceLine([h(5, 0, 6, 5)], 20)).toEqual({ touched: false, line: 25 });
    expect(repo.advanceLine([h(5, 0, 6, 5)], 5)).toEqual({ touched: false, line: 5 });
    expect(repo.advanceLine([h(5, 0, 6, 5)], 6)).toEqual({ touched: false, line: 11 });
    expect(repo.advanceLine([h(30, 0, 31, 5)], 20)).toEqual({ touched: false, line: 20 });
    expect(repo.advanceLine([h(0, 0, 1, 2)], 1)).toEqual({ touched: false, line: 3 });
  });

  test('a removal above pulls a line up; a line inside a modified or removed range is touched', () => {
    expect(repo.advanceLine([h(5, 2, 4, 0)], 20)).toEqual({ touched: false, line: 18 });
    expect(repo.advanceLine([h(5, 2, 4, 0)], 6)).toEqual({ touched: true, line: null });
    expect(repo.advanceLine([h(10, 2, 12, 1)], 11)).toEqual({ touched: true, line: null });
    expect(repo.advanceLine([h(10, 2, 12, 1)], 12)).toEqual({ touched: false, line: 11 });
    expect(repo.advanceLine([h(10, 2, 12, 1)], 9)).toEqual({ touched: false, line: 9 });
  });

  test('several hunks add up, in order', () => {
    const hunks = [h(5, 0, 6, 2), h(10, 2, 12, 1), h(30, 1, 31, 2)];
    expect(repo.advanceLine(hunks, 4)).toEqual({ touched: false, line: 4 });
    expect(repo.advanceLine(hunks, 20)).toEqual({ touched: false, line: 21 });
    expect(repo.advanceLine(hunks, 35)).toEqual({ touched: false, line: 37 });
    expect(repo.advanceLine(hunks, 30)).toEqual({ touched: true, line: null });
    expect(repo.advanceLine([], 7)).toEqual({ touched: false, line: 7 });
  });

  test('applied to the hunks git printed, it names where each old line went', () => {
    const w = mkdir('prr-adv-');
    initRepo(w);
    const a = commit(w, { 'f.txt': numbered(40) }, 'a');
    const b = commit(w, { 'f.txt': numbered(40).replace('line 5\n', 'line 5\nnew\nnew2\n').replace('line 10\nline 11\n', 'X\n') }, 'b');
    const { hunks } = repo.changedOldLines(git, w, { from: a, to: b, file: 'f.txt' });
    const contentAt = (sha, n) => sh(w, ['show', `${sha}:f.txt`]).split('\n')[n - 1];
    for (const old of [1, 5, 6, 9, 12, 13, 30, 40]) {
      const moved = repo.advanceLine(hunks, old);
      expect(moved.touched).toBe(false);
      expect(contentAt(b, moved.line)).toBe(contentAt(a, old));
    }
    for (const old of [10, 11]) expect(repo.advanceLine(hunks, old).touched).toBe(true);
  });
});

describe('insertsWithin (kata bh8w)', () => {
  const h = (oldStart, oldCount, newStart, newCount) => ({ oldStart, oldCount, newStart, newCount });

  test('new lines are inside a range when at least one cited line is on each side of them', () => {
    // `@@ -587,0 +588,5 @@` is five lines after old line 587: inside 583-601
    expect(repo.insertsWithin([h(587, 0, 588, 5)], 583, 601)).toBe(true);
    expect(repo.insertsWithin([h(10, 0, 11, 1)], 10, 20)).toBe(true); // right after the first cited line
    expect(repo.insertsWithin([h(19, 0, 20, 1)], 10, 20)).toBe(true); // right before the last cited line
    expect(repo.insertsWithin([h(9, 0, 10, 1)], 10, 20)).toBe(false); // right before the first cited line
    expect(repo.insertsWithin([h(20, 0, 21, 1)], 10, 20)).toBe(false); // right after the last cited line
    expect(repo.insertsWithin([h(0, 0, 1, 3)], 10, 20)).toBe(false); // the top of the file
    expect(repo.insertsWithin([h(40, 0, 41, 3)], 10, 20)).toBe(false); // far below
  });

  test('a one-line range has no inside', () => {
    for (const after of [14, 15, 16]) expect(repo.insertsWithin([h(after, 0, after + 1, 2)], 15, 15)).toBe(false);
  });

  test('only a PURE insertion counts: a modified or removed range is the old lines\' business', () => {
    expect(repo.insertsWithin([h(12, 2, 12, 3)], 10, 20)).toBe(false);
    expect(repo.insertsWithin([h(12, 1, 11, 0)], 10, 20)).toBe(false);
  });

  test('any of several hunks may be the one, and no hunk is none', () => {
    expect(repo.insertsWithin([h(2, 0, 3, 1), h(15, 0, 16, 1), h(30, 1, 31, 1)], 10, 20)).toBe(true);
    expect(repo.insertsWithin([h(2, 0, 3, 1), h(30, 0, 31, 1)], 10, 20)).toBe(false);
    expect(repo.insertsWithin([], 10, 20)).toBe(false);
  });

  test('applied to the hunks git printed for a real fix that only adds lines', () => {
    const w = mkdir('prr-ins-');
    initRepo(w);
    const a = commit(w, { 'f.txt': numbered(40) }, 'a');
    const b = commit(w, { 'f.txt': numbered(40).replace('line 14\n', 'line 14\nnew 1\nnew 2\nnew 3\n') }, 'b');
    const { lines, hunks } = repo.changedOldLines(git, w, { from: a, to: b, file: 'f.txt' });
    expect(lines).toEqual([]);
    expect(hunks).toEqual([h(14, 0, 15, 3)]);
    expect(repo.insertsWithin(hunks, 10, 20)).toBe(true);
    expect(repo.insertsWithin(hunks, 15, 20)).toBe(false);
    expect(repo.insertsWithin(hunks, 10, 14)).toBe(false);
  });
});

describe('defaultGit is bound to the cwd, not to the caller\'s environment', () => {
  const cases = [
    ['GIT_DIR', (other) => path.join(other, '.git'), ['rev-parse', '--git-dir']],
    ['GIT_WORK_TREE', (other) => other, ['rev-parse', '--show-toplevel']],
    ['GIT_INDEX_FILE', (other) => path.join(other, '.git', 'index'), ['rev-parse', '--git-path', 'index']],
    ['GIT_OBJECT_DIRECTORY', (other) => path.join(other, '.git', 'objects'), ['rev-parse', '--git-path', 'objects']],
    ['GIT_COMMON_DIR', (other) => path.join(other, '.git'), ['rev-parse', '--git-common-dir']]
  ];

  test.each(cases)('%s in the environment does not rebind the repository', (name, valueFor, args) => {
    const other = mkdir('prr-env-other-');
    initRepo(other);
    commit(other, { 'x.txt': 'x\n' }, 'x');
    const clean = runtime.defaultGit()(args, { cwd: dir });
    expect(clean.status).toBe(0);
    const saved = process.env[name];
    process.env[name] = valueFor(other);
    try {
      expect(runtime.defaultGit()(args, { cwd: dir })).toEqual(clean);
    } finally {
      if (saved === undefined) delete process.env[name];
      else process.env[name] = saved;
    }
  });
});
