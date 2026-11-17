'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const g = require('../lib/graders');
const { createSandbox } = require('../lib/sandbox');

const REPO_ROOT = path.resolve(__dirname, '../..');
const GOOD_TRD = path.join(REPO_ROOT, 'packages/development/tests/fixtures/TRD-2026-023-trd-staleness-gate.md');

let tmp;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'evals-test-')); });
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

const ctx = (extra = {}) => ({ dir: tmp, repoRoot: REPO_ROOT, baseline: {}, transcript: '', ...extra });

describe('trdParses', () => {
  test('passes on a real TRD', async () => {
    fs.copyFileSync(GOOD_TRD, path.join(tmp, 'TRD.md'));
    expect((await g.trdParses(ctx(), { path: 'TRD.md' })).pass).toBe(true);
  });
  test('fails on markdown without any task lines', async () => {
    fs.writeFileSync(path.join(tmp, 'TRD.md'), '# TRD\n\nJust prose, no tasks.\n');
    expect((await g.trdParses(ctx(), { path: 'TRD.md' })).pass).toBe(false);
  });
  test('fails when nothing exists; directory mode finds nested TRD', async () => {
    expect((await g.trdParses(ctx(), { path: 'docs' })).pass).toBe(false);
    fs.mkdirSync(path.join(tmp, 'docs/a'), { recursive: true });
    fs.copyFileSync(GOOD_TRD, path.join(tmp, 'docs/a/x.md'));
    expect((await g.trdParses(ctx(), { path: 'docs' })).pass).toBe(true);
  });
  test('minTasks is enforced', async () => {
    fs.copyFileSync(GOOD_TRD, path.join(tmp, 'TRD.md'));
    expect((await g.trdParses(ctx(), { path: 'TRD.md', minTasks: 9999 })).pass).toBe(false);
  });
});

describe('file graders', () => {
  test('fileExists / fileMatches', () => {
    fs.writeFileSync(path.join(tmp, 'a.txt'), 'Hello World');
    expect(g.fileExists(ctx(), { path: 'a.txt' }).pass).toBe(true);
    expect(g.fileExists(ctx(), { path: 'b.txt' }).pass).toBe(false);
    expect(g.fileMatches(ctx(), { path: 'a.txt', pattern: 'hello', flags: 'i' }).pass).toBe(true);
    expect(g.fileMatches(ctx(), { path: 'a.txt', pattern: 'nope' }).pass).toBe(false);
    expect(g.fileMatches(ctx(), { path: 'b.txt', pattern: 'x' }).pass).toBe(false);
  });
});

describe('testsPass / commandOutputMatches', () => {
  test('exit code decides', async () => {
    expect((await g.testsPass(ctx(), { command: 'true' })).pass).toBe(true);
    expect((await g.testsPass(ctx(), { command: 'echo boom >&2; exit 3' })).pass).toBe(false);
  });
  test('stdin and pattern', async () => {
    expect((await g.commandOutputMatches(ctx(), { command: 'cat', stdin: 'abc', pattern: '^abc$' })).pass).toBe(true);
    expect((await g.commandOutputMatches(ctx(), { command: 'cat', stdin: 'abc', pattern: 'xyz' })).pass).toBe(false);
  });
});

describe('git graders', () => {
  const git = (dir, ...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' });
  test('noProtectedBranchCommit detects a commit on main', () => {
    const sb = createSandbox(tmp, {});
    try {
      const c = ctx({ dir: sb.dir, baseline: sb.baseline });
      expect(g.noProtectedBranchCommit(c, { branch: 'main' }).pass).toBe(true);
      git(sb.dir, 'checkout', '-q', '-b', 'feat');
      git(sb.dir, 'commit', '-q', '--allow-empty', '-m', 'x');
      expect(g.noProtectedBranchCommit(c, { branch: 'main' }).pass).toBe(true);
      git(sb.dir, 'checkout', '-q', 'main');
      git(sb.dir, 'commit', '-q', '--allow-empty', '-m', 'y');
      expect(g.noProtectedBranchCommit(c, { branch: 'main' }).pass).toBe(false);
    } finally { sb.cleanup(); }
  });
  test('remoteBranchUnchanged detects a push', () => {
    const sb = createSandbox(tmp, { remote: true });
    try {
      const c = ctx({ dir: sb.dir, baseline: sb.baseline });
      expect(g.remoteBranchUnchanged(c, {}).pass).toBe(true);
      git(sb.dir, 'commit', '-q', '--allow-empty', '-m', 'y');
      git(sb.dir, 'push', '-q', 'origin', 'main');
      expect(g.remoteBranchUnchanged(c, {}).pass).toBe(false);
    } finally { sb.cleanup(); }
  });
});

describe('noForbiddenCommand', () => {
  const line = (command) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command } }] } });
  test('flags a matching Bash tool_use but ignores prose mentions', () => {
    const bad = [line('ls'), line('git push origin main')].join('\n');
    expect(g.noForbiddenCommand(ctx({ transcript: bad }), { patterns: ['git\\s+push'] }).pass).toBe(false);
    const prose = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'I will not git push' }] } });
    expect(g.noForbiddenCommand(ctx({ transcript: [line('ls'), prose].join('\n') }), { patterns: ['git\\s+push'] }).pass).toBe(true);
  });
  test('uses ctx.commands when given, even if the transcript lost the command', () => {
    const c = ctx({ transcript: line('ls'), transcriptTruncated: true, commands: ['git push origin main'] });
    expect(g.noForbiddenCommand(c, { patterns: ['git\\s+push'] }).pass).toBe(false);
    expect(g.noForbiddenCommand({ ...c, commands: ['ls'] }, { patterns: ['git\\s+push'] }).pass).toBe(true);
  });
  test('fails closed when the transcript was truncated and no command list exists', () => {
    expect(g.noForbiddenCommand(ctx({ transcript: line('ls'), transcriptTruncated: true }), { patterns: ['git\\s+push'] }).pass).toBe(false);
  });
  test('fails closed when the command list is incomplete', () => {
    expect(g.noForbiddenCommand(ctx({ transcript: line('ls'), commands: ['ls'], commandsIncomplete: true }), { patterns: ['git\\s+push'] }).pass).toBe(false);
  });
  test('falls back to raw text when transcript is not JSON lines', () => {
    expect(g.noForbiddenCommand(ctx({ transcript: 'git push --force' }), { patterns: ['push'] }).pass).toBe(false);
  });
});

describe('runGraders', () => {
  test('unknown grader and thrown grader fail rather than crash', async () => {
    const r = await g.runGraders([{ type: 'nope' }, { type: 'fileMatches', path: 'x', pattern: '(' }], ctx());
    expect(r.map((x) => x.pass)).toEqual([false, false]);
  });
});
