'use strict';

/**
 * br-0wx (items c, d): in a repo that TRACKS .beads/issues.jsonl the beads database is
 * shared by every branch, so the working export can hold other TRDs' beads, reordered
 * lines and status changes to beads this branch never touched. Committing the file
 * as-is would put all of that into the TRD's PR. `beads-stage` stages only this TRD's
 * beads, straight into the git index, and leaves the working file (br's) alone.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { buildScopedExport, stageBeadsExport, checkStagedExport } = require('../lib/beads-stage');
const { runBeadsStage, main } = require('../lib/trd-cli');

const OURS = ['[trd:ours'];
const rec = (id, title, extra = {}) => JSON.stringify({ id, title, status: 'open', labels: [], ...extra });
const text = (...lines) => lines.join('\n') + '\n';

// ---------------------------------------------------------------------------
// Pure scoping
// ---------------------------------------------------------------------------
describe('buildScopedExport', () => {
  const head = text(
    rec('f-1', '[trd:other:task:A] foreign one'),
    rec('o-1', '[trd:ours:task:A] ours one'),
    rec('f-2', '[trd:other:task:B] foreign two')
  );

  test('drops foreign additions and appends our new beads', () => {
    const work = text(
      rec('f-1', '[trd:other:task:A] foreign one'),
      rec('o-1', '[trd:ours:task:A] ours one'),
      rec('f-2', '[trd:other:task:B] foreign two'),
      rec('f-3', '[trd:other:task:C] foreign new'),
      rec('o-2', '[trd:ours:task:B] ours new')
    );
    const r = buildScopedExport(head, work, { matches: OURS });
    expect(r.text).toBe(text(
      rec('f-1', '[trd:other:task:A] foreign one'),
      rec('o-1', '[trd:ours:task:A] ours one'),
      rec('f-2', '[trd:other:task:B] foreign two'),
      rec('o-2', '[trd:ours:task:B] ours new')
    ));
    expect(r).toMatchObject({ added: 1, replaced: 0, foreignDropped: 1 });
  });

  test('replaces our changed bead in place', () => {
    const work = text(
      rec('f-1', '[trd:other:task:A] foreign one'),
      rec('o-1', '[trd:ours:task:A] ours one', { status: 'closed' }),
      rec('f-2', '[trd:other:task:B] foreign two')
    );
    const r = buildScopedExport(head, work, { matches: OURS });
    expect(r.text.split('\n')[1]).toBe(rec('o-1', '[trd:ours:task:A] ours one', { status: 'closed' }));
    expect(r).toMatchObject({ replaced: 1, added: 0, foreignDropped: 0 });
  });

  test('a status change to a foreign bead is not staged', () => {
    const work = text(
      rec('f-1', '[trd:other:task:A] foreign one', { status: 'closed' }),
      rec('o-1', '[trd:ours:task:A] ours one'),
      rec('f-2', '[trd:other:task:B] foreign two')
    );
    const r = buildScopedExport(head, work, { matches: OURS });
    expect(r.text).toBe(head);
    expect(r.foreignDropped).toBe(1);
  });

  test('a reordered working file does not reorder the staged one', () => {
    const work = text(
      rec('f-2', '[trd:other:task:B] foreign two'),
      rec('o-1', '[trd:ours:task:A] ours one'),
      rec('f-1', '[trd:other:task:A] foreign one')
    );
    expect(buildScopedExport(head, work, { matches: OURS }).text).toBe(head);
  });

  test('matches by label as well as by title', () => {
    const work = text(rec('f-1', 'no token in this title', { labels: ['my-trd'] }));
    const r = buildScopedExport('', work, { matches: [], labels: ['my-trd'] });
    expect(r.added).toBe(1);
  });

  test('normalises CRLF working lines and keeps raw lines otherwise untouched', () => {
    const work = rec('o-9', '[trd:ours:task:Z] crlf') + '\r\n';
    expect(buildScopedExport('', work, { matches: OURS }).text).toBe(rec('o-9', '[trd:ours:task:Z] crlf') + '\n');
  });

  test('is unchanged when nothing of ours differs', () => {
    expect(buildScopedExport(head, head, { matches: OURS })).toMatchObject({ text: head, unchanged: true });
  });
});

// ---------------------------------------------------------------------------
// Real git repositories
// ---------------------------------------------------------------------------
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' });

function makeRepo({ track = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'beads-stage-'));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@t');
  git(dir, 'config', 'user.name', 't');
  git(dir, 'config', 'core.autocrlf', 'false');
  fs.mkdirSync(path.join(dir, '.beads'));
  const exportFile = path.join(dir, '.beads', 'issues.jsonl');
  fs.writeFileSync(exportFile, text(
    rec('f-1', '[trd:other:task:A] foreign one'),
    rec('o-1', '[trd:ours:task:A] ours one')
  ));
  if (track) {
    git(dir, 'add', '.beads/issues.jsonl');
    git(dir, 'commit', '-q', '-m', 'base');
  } else {
    fs.writeFileSync(path.join(dir, '.gitignore'), '.beads/issues.jsonl\n');
    git(dir, 'add', '.gitignore');
    git(dir, 'commit', '-q', '-m', 'base');
  }
  return { dir, exportFile };
}

/** Pollute the working export the way a shared db does: foreign additions, a foreign status change, our new bead. */
function pollute(exportFile) {
  fs.writeFileSync(exportFile, text(
    rec('f-1', '[trd:other:task:A] foreign one', { status: 'closed' }), // foreign status change
    rec('o-1', '[trd:ours:task:A] ours one', { status: 'closed' }), // our change
    rec('f-9', '[trd:other:task:Q] foreign from another branch'), // foreign addition
    rec('o-2', '[trd:ours:task:B] ours new') // our addition
  ));
}

describe('stageBeadsExport (real git)', () => {
  let repo;
  beforeEach(() => { repo = makeRepo(); });
  afterEach(() => fs.rmSync(repo.dir, { recursive: true, force: true }));

  test('stages only this TRD\'s beads and leaves the working export exactly as br wrote it', () => {
    pollute(repo.exportFile);
    const before = fs.readFileSync(repo.exportFile, 'utf8');

    const res = stageBeadsExport({ cwd: repo.dir, matches: OURS });

    expect(res).toMatchObject({ ok: true, tracked: true, replaced: 1, added: 1, foreignDropped: 2 });
    expect(fs.readFileSync(repo.exportFile, 'utf8')).toBe(before);

    const staged = git(repo.dir, 'diff', '--cached', '-U0', '--', '.beads/issues.jsonl');
    expect(staged).toContain('ours new');
    expect(staged).toContain('"status":"closed"'); // our own change
    expect(staged).not.toMatch(/trd:other:task:Q/); // foreign addition
    expect(staged).not.toMatch(/^\+.*"id":"f-1".*closed/m); // foreign status change
  });

  test('the resulting commit touches only our lines', () => {
    pollute(repo.exportFile);
    stageBeadsExport({ cwd: repo.dir, matches: OURS });
    git(repo.dir, 'commit', '-q', '-m', 'ours');
    const changed = git(repo.dir, 'diff', 'HEAD~1', 'HEAD', '-U0', '--', '.beads/issues.jsonl')
      .split('\n').filter((l) => /^[+-]\{/.test(l));
    expect(changed.length).toBeGreaterThan(0);
    expect(changed.every((l) => l.includes('trd:ours'))).toBe(true);
  });

  test('is idempotent', () => {
    pollute(repo.exportFile);
    stageBeadsExport({ cwd: repo.dir, matches: OURS });
    const first = git(repo.dir, 'ls-files', '-s', '.beads/issues.jsonl');
    stageBeadsExport({ cwd: repo.dir, matches: OURS });
    expect(git(repo.dir, 'ls-files', '-s', '.beads/issues.jsonl')).toBe(first);
  });

  test('repairs an index that someone staged with the whole polluted export', () => {
    pollute(repo.exportFile);
    git(repo.dir, 'add', '.beads/issues.jsonl'); // the `git add .beads/` the old reminder told users to run
    stageBeadsExport({ cwd: repo.dir, matches: OURS });
    expect(git(repo.dir, 'diff', '--cached', '--', '.beads/issues.jsonl')).not.toMatch(/trd:other:task:Q/);
  });
});

describe('stageBeadsExport when the repo does not track the export', () => {
  test('is a no-op (this repo ignores its own issues.jsonl)', () => {
    const repo = makeRepo({ track: false });
    try {
      pollute(repo.exportFile);
      expect(stageBeadsExport({ cwd: repo.dir, matches: OURS })).toMatchObject({ ok: true, skipped: true });
      expect(git(repo.dir, 'diff', '--cached', '--name-only')).toBe('');
    } finally {
      fs.rmSync(repo.dir, { recursive: true, force: true });
    }
  });
});

describe('checkStagedExport', () => {
  let repo;
  beforeEach(() => { repo = makeRepo(); pollute(repo.exportFile); });
  afterEach(() => fs.rmSync(repo.dir, { recursive: true, force: true }));

  test('passes after beads-stage', () => {
    stageBeadsExport({ cwd: repo.dir, matches: OURS });
    expect(checkStagedExport({ cwd: repo.dir, matches: OURS })).toMatchObject({ ok: true, foreign: [] });
  });

  test('fails and names the foreign beads when the whole export was staged by hand', () => {
    git(repo.dir, 'add', '.beads/issues.jsonl');
    const res = checkStagedExport({ cwd: repo.dir, matches: OURS });
    expect(res.ok).toBe(false);
    expect(res.foreign.sort()).toEqual(['f-1', 'f-9']);
  });
});

describe('trd-cli beads-stage', () => {
  test('is a registered subcommand', () => {
    expect(typeof runBeadsStage).toBe('function');
  });

  test('without --match or --label it fails with the shared {error} contract', () => {
    const out = [];
    const spy = jest.spyOn(process.stdout, 'write').mockImplementation((s) => { out.push(String(s)); return true; });
    try {
      expect(main(['beads-stage'])).toBe(1);
    } finally {
      spy.mockRestore();
    }
    expect(JSON.parse(out.join(''))).toEqual({ error: expect.stringMatching(/--match or --label/) });
  });

  test('stages from the current directory and reports counts', () => {
    const repo = makeRepo();
    const cwd = process.cwd();
    try {
      pollute(repo.exportFile);
      process.chdir(repo.dir);
      expect(runBeadsStage(['--match', '[trd:ours'])).toMatchObject({ ok: true, replaced: 1, added: 1, foreignDropped: 2 });
      expect(() => runBeadsStage(['--match', '[trd:ours', '--check'])).not.toThrow();
    } finally {
      process.chdir(cwd);
      fs.rmSync(repo.dir, { recursive: true, force: true });
    }
  });

  test('--check throws, naming the foreign beads, when the staged export touches another TRD', () => {
    const repo = makeRepo();
    const cwd = process.cwd();
    try {
      pollute(repo.exportFile);
      git(repo.dir, 'add', '.beads/issues.jsonl');
      process.chdir(repo.dir);
      expect(() => runBeadsStage(['--match', '[trd:ours', '--check'])).toThrow(/f-1, f-9|f-9, f-1/);
    } finally {
      process.chdir(cwd);
      fs.rmSync(repo.dir, { recursive: true, force: true });
    }
  });
});
