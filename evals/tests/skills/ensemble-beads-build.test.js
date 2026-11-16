'use strict';

/**
 * Proof that the checks of the `ensemble-beads-build` eval can pass and can fail (kit: evals/tests/skill-eval-kit.js). The model is faked:
 * each stub agent writes the report.md, the br and bv stubs' call logs and the git state a good or a bad run would leave. No model, no
 * network, no real br or bv. Also proves the reusable stubs (bin/br, bin/bv) and that the real toolchain-cli reads them.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const kit = require('../skill-eval-kit');

jest.setTimeout(120000);

const ID = 'ensemble-beads-build';
const REPO = path.resolve(__dirname, '../../..');
const SCRATCH = path.join(os.homedir(), '.omp', 'trd-skills-eval', 'jest');
const IDS = ['report-saved', 'scope-counts', 'ready-items', 'track-breakdown', 'final-hint', 'graph-read', 'tracker-read-only', 'files-unchanged', 'git-state'];
const REPORT_CHECKS = ['report-saved', 'scope-counts', 'ready-items', 'track-breakdown', 'final-hint', 'graph-read'];

const GOOD = `=== EPIC SCOPE: billing-export (bead: bb-e1) === Open: 5 | In-progress: 2 | Closed: 4
=== PLAN: ordering source: unknown (dependency-aware: false) ===
Track A (ready): bb-t07 billing-export: add csv writer, bb-t08 billing-export: add json writer
Track B (ready): bb-t09 billing-export: write docs page
Blocked: bb-t10 billing-export: wire export endpoint (waits on bb-t07, bb-t08)
Run /ensemble:beads-build bb-e1 to execute. For TRD-driven work run /ensemble:implement-trd-tasks <trd-path>.
`;
const BR = ['--version', '--version', '--version', 'sync --flush-only --json', 'list --all --limit 0 --json', 'show billing-export --json'];
const BV = ['--version', '--robot-plan --format json'];

const writeLog = (ws, name, calls) => fs.writeFileSync(path.join(ws.root, name), `${calls.join('\n')}\n`);
const GITENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'x', GIT_AUTHOR_EMAIL: 'x@example.invalid', GIT_COMMITTER_NAME: 'x', GIT_COMMITTER_EMAIL: 'x@example.invalid' };
const git = (ws, ...args) => {
  const r = spawnSync('git', args, { cwd: ws.dir, encoding: 'utf8', env: GITENV });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
};

/** A stub agent: report.md (null: none), the call logs (null: no log) and anything else the test does to the workspace. */
const run = (report, { br = BR, bv = BV, extra = () => {} } = {}) => async (ws) => {
  if (report !== null) ws.write('report.md', report);
  if (br !== null) writeLog(ws, 'br-calls.log', br);
  if (bv !== null) writeLog(ws, 'bv-calls.log', bv);
  await extra(ws);
};
const swap = (text, from, to) => {
  if (!text.includes(from)) throw new Error(`test setup: ${from} not in the report`);
  return text.replace(from, to);
};

describe(ID, () => {
  test('loads clean: valid definition, a fixture with the stubs and canned data and no agent or git configuration', () => {
    const ev = kit.loadsClean(ID);
    expect(ev.runtimes).toEqual(['claude']);
    expect(ev.sandboxPath).toEqual(['bin']);
    expect(ev.invocation).toBe('explicit');
    expect(ev.command).toBe('/ensemble-development:ensemble:beads-build');
    for (const f of ['bin/br', 'bin/bv', 'bin/canned/issues.json', 'bin/canned/bv-plan.json', '.ensemble/toolchain.yaml']) {
      expect(fs.existsSync(path.join(ev.fixtureDir, f))).toBe(true);
    }
    for (const f of ['bin/br', 'bin/bv']) expect(fs.statSync(path.join(ev.fixtureDir, f)).mode & 0o755).toBe(0o755);
  });

  test('the prompt is functional: it names the epic and the mode, and none of the skill\'s own output words or convention names', () => {
    const { prompt } = kit.loadsClean(ID);
    expect(prompt.startsWith('billing-export --plan\n')).toBe(true);
    for (const cue of [/EPIC SCOPE/i, /in-progress/i, /ordering source/i, /beads-build/i, /implement-trd-tasks/i, /\bRun \/ensemble/i, /\btracks?\b/i, /\bready\b/i, /\bblocked\b/i, /toolchain/i, /\bsync\b/i]) {
      expect(prompt).not.toMatch(cue);
    }
  });

  test('a good report with the stubs\' logs and an untouched repository passes every check', async () => {
    const res = await kit.runEval(ID, run(GOOD));
    expect(Object.keys(res)).toEqual(IDS);
    kit.expectAllPass(res);
  });

  test('the fixture alone (a run that does nothing) fails every report and tracker check and passes the three no-mutation checks', async () => {
    const res = await kit.runEval(ID, run(null, { br: null, bv: null }));
    kit.expectFails(res, REPORT_CHECKS, undefined, { only: true });
  });

  test('other layouts pass: number-first counts without the epic bead, a table, `track 1` labels, bullet hint', async () => {
    const alt = `# Plan for billing-export (bb-e1)

4 open, 2 in progress, 4 closed

## Ready work

### Track 1
- bb-t07 add csv writer
- bb-t08 add json writer

### Track 2
- bb-t09 write docs page

Not yet ready: bb-t10 (blocked by the writers).

Next: /ensemble:beads-build bb-e1 to execute (TRD-driven work: /ensemble:implement-trd-tasks)
`;
    kit.expectAllPass(await kit.runEval(ID, run(alt)));
    const table = `# billing-export (bb-e1)

| Status | Count |
|---|---|
| Open | 4 |
| In progress | 2 |
| Closed | 4 |

| Track | Beads |
|---|---|
| track-A | bb-t07, bb-t08 |
| track-B | bb-t09 |

Run /ensemble:beads-build bb-e1 to execute. For TRD work: /ensemble:implement-trd-tasks.
`;
    kit.expectAllPass(await kit.runEval(ID, run(table)));
  });

  test('a report for the other epic or no epic id fails report-saved; a one-line stub report is too short', async () => {
    kit.expectFails(await kit.runEval(ID, run(GOOD.split('bb-e1').join('bb-e2'))), 'report-saved', /does not name the epic bb-e1/);
    kit.expectFails(await kit.runEval(ID, run('Open: 5 In-progress: 2 Closed: 4\n')), 'report-saved', /too short/);
    kit.expectFails(await kit.runEval(ID, run(swap(GOOD, '(bead: bb-e1)', '').replace(/bb-e1/g, 'it'))), 'report-saved', /does not name the epic/);
  });

  test('whole-repo counts fail scope-counts (the other epic\'s beads were counted)', async () => {
    kit.expectFails(await kit.runEval(ID, run(swap(GOOD, 'Open: 5 | In-progress: 2 | Closed: 4', 'Open: 9 | In-progress: 3 | Closed: 7'))), 'scope-counts', /Open count was 9, expected 4 or 5/, { only: true });
  });

  test('each count is checked: a wrong in-progress, a wrong closed, a wrong open, a missing count', async () => {
    kit.expectFails(await kit.runEval(ID, run(swap(GOOD, 'In-progress: 2', 'In-progress: 3'))), 'scope-counts', /In-progress count was 3, expected 2/, { only: true });
    kit.expectFails(await kit.runEval(ID, run(swap(GOOD, 'Closed: 4', 'Closed: 5'))), 'scope-counts', /Closed count was 5, expected 4/, { only: true });
    kit.expectFails(await kit.runEval(ID, run(swap(GOOD, 'Open: 5', 'Open: 3'))), 'scope-counts', /Open count was 3, expected 4 or 5/, { only: true });
    kit.expectFails(await kit.runEval(ID, run(swap(GOOD, 'Open: 5 | In-progress: 2 | Closed: 4', 'Ten beads, some open.'))), 'scope-counts', /no Open count/, { only: true });
    kit.expectFails(await kit.runEval(ID, run(swap(GOOD, ' | In-progress: 2 | Closed: 4', ''))), 'scope-counts', /no In-progress count/, { only: true });
  });

  test('a count read from a ready-item row (a task id on the line) is not a count; the first count printed wins', async () => {
    const noScope = GOOD.split('\n').filter((l) => !l.startsWith('=== EPIC SCOPE')).join('\n');
    kit.expectFails(await kit.runEval(ID, run(`${noScope}\nbb-t07 open 4\n`)), 'scope-counts', /no Open count/, { only: true });
    kit.expectFails(await kit.runEval(ID, run(`Open: 9 | In-progress: 3 | Closed: 7\n${GOOD}`)), 'scope-counts', /Open count was 9/, { only: true });
  });

  test('a missing ready item fails ready-items', async () => {
    kit.expectFails(await kit.runEval(ID, run(swap(GOOD, ', bb-t08 billing-export: add json writer', ''))), ['ready-items'], /not named: bb-t08/);
    const noIds = GOOD.replace(/bb-t07/g, 'the csv writer').replace(/bb-t08/g, 'the json writer');
    kit.expectFails(await kit.runEval(ID, run(noIds)), 'ready-items', /not named: bb-t07, bb-t08/);
  });

  test('a blocked, in-progress or closed bead offered as ready fails ready-items; saying it is blocked does not', async () => {
    kit.expectFails(await kit.runEval(ID, run(swap(GOOD, 'Blocked: bb-t10 billing-export: wire export endpoint (waits on bb-t07, bb-t08)', 'Ready: bb-t10 billing-export: wire export endpoint'))), 'ready-items', /bb-t10 is offered as ready/, { only: true });
    kit.expectFails(await kit.runEval(ID, run(swap(GOOD, 'Track B (ready): bb-t09', 'Track B (ready): bb-t05 billing-export: add retry logic, bb-t09'))), 'ready-items', /bb-t05 is offered as ready/, { only: true });
    kit.expectFails(await kit.runEval(ID, run(`${GOOD.trimEnd().split('\n').slice(0, -1).join('\n')}\nTrack C: bb-t01 define export schema\n${GOOD.trimEnd().split('\n').pop()}\n`)), 'ready-items', /bb-t01 is offered as ready/, { only: true });
    kit.expectAllPass(await kit.runEval(ID, run(swap(GOOD, 'Blocked: bb-t10 billing-export: wire export endpoint (waits on bb-t07, bb-t08)', 'Next up, but not ready: bb-t10 (blocked)'))));
  });

  test('a ready item described with what it unblocks still counts as named', async () => {
    kit.expectAllPass(await kit.runEval(ID, run(swap(GOOD, 'bb-t08 billing-export: add json writer', 'bb-t08 add json writer (unblocks bb-t10)'))));
  });

  test('ids match whole tokens: bb-t1 is not bb-t10, and a longer id does not satisfy a shorter one', async () => {
    const res = await kit.runEval(ID, run(GOOD.replace(/bb-t07/g, 'bb-t070')));
    kit.expectFails(res, ['ready-items', 'track-breakdown'], /bb-t07/, { only: true });
  });

  test('ready beads in one flat list with no track grouping fail track-breakdown only', async () => {
    const flat = GOOD.replace(/Track A \(ready\): /, 'Ready: ').replace(/Track B \(ready\): /, 'Ready: ');
    kit.expectFails(await kit.runEval(ID, run(flat)), 'track-breakdown', /the report has no track-labelled section/, { only: true });
  });

  test('a track-labelled section that lacks the first id fails track-breakdown by name', async () => {
    const t = `# billing-export (bb-e1)\n\nOpen: 5, In-progress: 2, Closed: 4\n\nReady also: bb-t07\n\nTrack A: bb-t08\n\nRun /ensemble:beads-build bb-e1 (TRD: /ensemble:implement-trd-tasks)\n`;
    kit.expectFails(await kit.runEval(ID, run(t)), 'track-breakdown', /bb-t07 is in no track-labelled section/, { only: true });
  });

  test('the two track-A beads split across tracks, or grouped with the docs bead, fail track-breakdown', async () => {
    const split = swap(swap(GOOD, 'Track A (ready): bb-t07 billing-export: add csv writer, bb-t08 billing-export: add json writer', 'Track A (ready): bb-t07 billing-export: add csv writer'), 'Track B (ready): bb-t09', 'Track B (ready): bb-t08 billing-export: add json writer, bb-t09');
    kit.expectFails(await kit.runEval(ID, run(split)), 'track-breakdown', /bb-t08 not in the same track as bb-t07/, { only: true });
    const merged = swap(GOOD, 'Track A (ready): bb-t07 billing-export: add csv writer, bb-t08 billing-export: add json writer\nTrack B (ready): bb-t09 billing-export: write docs page', 'Track A (ready): bb-t07 add csv writer, bb-t08 add json writer, bb-t09 write docs page');
    kit.expectFails(await kit.runEval(ID, run(merged)), 'track-breakdown', /bb-t09 grouped in the same track as bb-t07/, { only: true });
  });

  test('a grouping that stops at a heading: ids under a later heading are not in the track', async () => {
    const t = `# billing-export (bb-e1)\n\nOpen: 5, In-progress: 2, Closed: 4\n\n## Track A\nbb-t07\n\n## Others\nbb-t08\n\nRun /ensemble:beads-build bb-e1 (TRD: /ensemble:implement-trd-tasks)\n`;
    kit.expectFails(await kit.runEval(ID, run(t)), 'track-breakdown', /bb-t08 not in the same track as bb-t07/, { only: true });
  });

  test('a missing hint, a hint for another epic, a hint without implement-trd-tasks, or a hint buried mid-report fails final-hint', async () => {
    const hint = 'Run /ensemble:beads-build bb-e1 to execute. For TRD-driven work run /ensemble:implement-trd-tasks <trd-path>.\n';
    kit.expectFails(await kit.runEval(ID, run(swap(GOOD, hint, ''))), 'final-hint', /no hint line/, { only: true });
    kit.expectFails(await kit.runEval(ID, run(swap(GOOD, hint, 'Run /ensemble:beads-build bb-e2 to execute. For TRD-driven work run /ensemble:implement-trd-tasks <trd-path>.\n'))), 'final-hint', /no hint line running beads-build bb-e1/, { only: true });
    kit.expectFails(await kit.runEval(ID, run(swap(GOOD, hint, 'Run /ensemble:beads-build bb-e1 to execute.\n'))), 'final-hint', /does not mention implement-trd-tasks/, { only: true });
    kit.expectFails(await kit.runEval(ID, run(swap(GOOD, hint, `${hint}${'Starting the build now.\n'.repeat(7)}`))), 'final-hint', /followed by 7 more lines/, { only: true });
    kit.expectAllPass(await kit.runEval(ID, run(swap(GOOD, hint, `${hint}\nSaved.\n`))));
  });

  test('no tracker calls, or a list without the plan, or the plan without the list, fails graph-read', async () => {
    kit.expectFails(await kit.runEval(ID, run(GOOD, { br: null, bv: null })), 'graph-read', /recorded no call/, { only: true });
    kit.expectFails(await kit.runEval(ID, run(GOOD, { bv: null })), 'graph-read', /no `bv --robot-plan`/, { only: true });
    kit.expectFails(await kit.runEval(ID, run(GOOD, { bv: ['--version'] })), 'graph-read', /no `bv --robot-plan`/, { only: true });
    kit.expectFails(await kit.runEval(ID, run(GOOD, { br: ['--version', 'show bb-e1 --json'] })), 'graph-read', /no `br list`/, { only: true });
  });

  test('every br write verb fails tracker-read-only; the reads and the skill\'s own flush do not', async () => {
    for (const w of ['update bb-t07 --status in_progress --json', 'close bb-t01 --json', 'comments add bb-t07 hi --json', 'create --title x --json', 'dep add bb-t10 bb-t07', 'label add bb-t07 -l x', 'sync', 'sync --import-only', 'sync --flush-only --force', 'init', 'comments bb-t07']) {
      kit.expectFails(await kit.runEval(ID, run(GOOD, { br: [...BR, w] })), 'tracker-read-only', /br was asked to do more than read/, { only: true });
    }
    kit.expectAllPass(await kit.runEval(ID, run(GOOD, { br: [...BR, 'show bb-e1 --json', 'comments list bb-t07 --json', 'sync --flush-only'] })));
  });

  test('a bv call beyond the reads fails tracker-read-only', async () => {
    kit.expectFails(await kit.runEval(ID, run(GOOD, { bv: [...BV, '--robot-triage'] })), 'tracker-read-only', /bv was asked to do more than read/, { only: true });
    kit.expectAllPass(await kit.runEval(ID, run(GOOD, { bv: [...BV, '--robot-insights --format json'] })));
  });

  test('a changed canned file, a removed or a written file fails files-unchanged; the toolchain state and the report do not', async () => {
    const edit = (rel, fn) => async (ws) => ws.write(rel, fn(ws.read(rel)));
    kit.expectFails(await kit.runEval(ID, run(GOOD, { extra: edit('bin/canned/issues.json', (t) => t.replace('"closed"', '"open"')) })), 'files-unchanged', /seeded file changed: bin\/canned\/issues\.json/);
    kit.expectFails(await kit.runEval(ID, run(GOOD, { extra: (ws) => ws.remove('README.md') })), 'files-unchanged', /seeded file removed: README\.md/);
    kit.expectFails(await kit.runEval(ID, run(GOOD, { extra: (ws) => ws.write('src/export.js', 'module.exports = {};\n') })), 'files-unchanged', /wrote outside the report: src\/export\.js/, { only: true });
    kit.expectFails(await kit.runEval(ID, run(GOOD, { extra: (ws) => ws.write('.beads/issues.jsonl', '{}\n') })), 'files-unchanged', /wrote outside the report: \.beads/);
    kit.expectAllPass(await kit.runEval(ID, run(GOOD, { extra: (ws) => ws.write('.ensemble/state/toolchain/run.json', '{}\n') })));
  });

  test('a damaged .git/index fails git-state by name: not an index, another version, too many entries, truncated', async () => {
    const damage = (fn) => (ws) => {
      const f = path.join(ws.dir, '.git', 'index');
      fs.writeFileSync(f, fn(fs.readFileSync(f)));
    };
    const withU32 = (at, v) => (b) => { const c = Buffer.from(b); c.writeUInt32BE(v, at); return c; };
    const cases = [
      [() => Buffer.from('not an index at all, but more than thirty-two bytes long'), /is not a git index/],
      [withU32(4, 4), /version 4 is not read/],
      [withU32(8, 9999), /lists too many entries/],
      [(b) => b.subarray(0, 40), /index is truncated/],
      [(b) => b.subarray(0, 80), /ends inside an entry/],
      [(b) => { const c = Buffer.from(b.subarray(0, 12 + 62 + 2)); c.writeUInt16BE(0xfff, 12 + 60); return c; }, /ends inside an entry/],
    ];
    for (const [fn, re] of cases) kit.expectFails(await kit.runEval(ID, run(GOOD, { extra: damage(fn) })), 'git-state', re, { only: true });
    kit.expectFails(await kit.runEval(ID, run(GOOD, { extra: (ws) => fs.rmSync(path.join(ws.dir, '.git', 'index')) })), 'git-state', /\.git\/index is missing/, { only: true });
  });

  test('a missing HEAD, a missing main ref, or a file swapped for another in the index fails git-state by name', async () => {
    kit.expectFails(await kit.runEval(ID, run(GOOD, { extra: (ws) => fs.rmSync(path.join(ws.dir, '.git', 'HEAD')) })), 'git-state', /\.git\/HEAD is missing/, { only: true });
    kit.expectFails(await kit.runEval(ID, run(GOOD, { extra: (ws) => fs.rmSync(path.join(ws.dir, '.git', 'refs', 'heads', 'main')) })), 'git-state', /refs\/heads\/main is missing/, { only: true });
    kit.expectFails(await kit.runEval(ID, run(GOOD, { extra: (ws) => { git(ws, 'rm', '-q', '--cached', 'README.md'); git(ws, 'add', 'report.md'); } })), 'git-state', /README\.md is not in the index/, { only: true });
  });

  test('a seeded file replaced by a symlink, a directory or a huge file fails files-unchanged by name (hostile workspace reads)', async () => {
    const replace = (make) => (ws) => { ws.remove('README.md'); make(ws); };
    kit.expectFails(await kit.runEval(ID, run(GOOD, { extra: replace((ws) => fs.symlinkSync('/dev/null', path.join(ws.dir, 'README.md'))) })), 'files-unchanged', /cannot read README\.md/);
    kit.expectFails(await kit.runEval(ID, run(GOOD, { extra: replace((ws) => fs.mkdirSync(path.join(ws.dir, 'README.md'))) })), 'files-unchanged', /README\.md is not a regular file/);
    kit.expectFails(await kit.runEval(ID, run(GOOD, { extra: replace((ws) => ws.write('README.md', 'x'.repeat(1024 * 1024 + 1))) })), 'files-unchanged', /README\.md is larger than/);
  });

  test('a commit, a branch, a stash-like ref, a checkout, a tag each fail git-state', async () => {
    kit.expectFails(await kit.runEval(ID, run(GOOD, { extra: (ws) => { git(ws, 'add', '-A'); git(ws, 'commit', '-q', '-m', 'plan'); } })), 'git-state', /has 2 entries/);
    kit.expectFails(await kit.runEval(ID, run(GOOD, { extra: (ws) => git(ws, 'branch', 'feature/billing-export') })), 'git-state', /refs other than main exist: refs\/heads\/feature\/billing-export/, { only: true });
    kit.expectFails(await kit.runEval(ID, run(GOOD, { extra: (ws) => git(ws, 'tag', 'plan-1') })), 'git-state', /refs other than main exist: refs\/tags\/plan-1/, { only: true });
    kit.expectFails(await kit.runEval(ID, run(GOOD, { extra: (ws) => git(ws, 'checkout', '-q', '-b', 'feature/billing-export') })), 'git-state', /HEAD is "ref: refs\/heads\/feature\/billing-export"/);
    kit.expectFails(await kit.runEval(ID, run(GOOD, { extra: (ws) => { git(ws, 'checkout', '-q', '--detach'); } })), 'git-state', /HEAD is "[0-9a-f]{40}"/);
  });

  test('anything staged fails git-state: a new file, an edit, a removal; unstaged edits do not', async () => {
    kit.expectFails(await kit.runEval(ID, run(GOOD, { extra: (ws) => git(ws, 'add', 'report.md') })), 'git-state', /the index holds 9 files, the fixture has 8/, { only: true });
    kit.expectFails(await kit.runEval(ID, run(GOOD, { extra: (ws) => { ws.write('README.md', 'changed\n'); git(ws, 'add', 'README.md'); ws.write('README.md', fs.readFileSync(path.join(kit.loadsClean(ID).fixtureDir, 'README.md'), 'utf8')); } })), 'git-state', /README\.md is staged with other contents/, { only: true });
    kit.expectFails(await kit.runEval(ID, run(GOOD, { extra: (ws) => { git(ws, 'rm', '-q', '--cached', 'README.md'); } })), 'git-state', /the index holds 7 files, the fixture has 8/);
    kit.expectFails(await kit.runEval(ID, run(GOOD, { extra: (ws) => { ws.write('.ensemble/state/x.json', '{}\n'); git(ws, 'add', '-f', '.ensemble/state/x.json'); } })), 'git-state', /the index holds 9 files/);
    // an unstaged edit is a files-unchanged failure, not a git-state one
    const res = await kit.runEval(ID, run(GOOD, { extra: (ws) => ws.write('README.md', 'changed\n') }));
    kit.expectFails(res, 'files-unchanged', /README\.md/, { only: true });
  });

  test('a staged state from a real `git add -A` of an untouched tree also reads as unchanged (the index is readable after git touched it)', async () => {
    kit.expectAllPass(await kit.runEval(ID, run(GOOD, { extra: (ws) => { git(ws, 'status', '--short'); git(ws, 'add', '-A', 'README.md'); } })));
  });

  describe('the reusable stubs', () => {
    const fixtureBin = () => path.join(kit.loadsClean(ID).fixtureDir, 'bin');
    const call = (name, args, env = {}) => {
      fs.mkdirSync(SCRATCH, { recursive: true });
      const dir = fs.mkdtempSync(path.join(SCRATCH, 'stub-'));
      try {
        const log = path.join(dir, 'log');
        const r = spawnSync('sh', [path.join(fixtureBin(), name), ...args], { encoding: 'utf8', env: { PATH: process.env.PATH, BR_STUB_LOG: log, BV_STUB_LOG: log, ...env } });
        return { status: r.status, out: r.stdout, err: r.stderr, log: fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '' };
      } finally { fs.rmSync(dir, { recursive: true, force: true }); }
    };

    test('br answers its read verbs from the canned files and logs each call', () => {
      expect(call('br', ['--version']).out).toMatch(/stub/);
      const list = call('br', ['list', '--all', '--limit', '0', '--json']);
      expect(list.status).toBe(0);
      const issues = JSON.parse(list.out).issues;
      expect(issues).toHaveLength(18);
      expect(call('br', ['show', 'bb-e1', '--json']).out).toMatch(/"id": "bb-e1"/);
      expect(call('br', ['comments', 'list', 'bb-t07', '--json']).out.trim()).toBe('[]');
      const sync = call('br', ['sync', '--flush-only', '--json']);
      expect(sync.status).toBe(0);
      expect(sync.log).toBe('sync --flush-only --json\n');
    });

    test('br refuses everything else with exit 2 and still logs it; an unknown or unsafe show id is not found (exit 3)', () => {
      for (const args of [['update', 'bb-t07', '--status', 'closed'], ['close', 'bb-t01'], ['comments', 'add', 'bb-t07', 'x'], ['create'], ['sync'], ['sync', '--import-only'], ['init'], []]) {
        const r = call('br', args);
        expect(r.status).toBe(2);
        expect(r.err).toMatch(/unsupported call/);
        expect(r.log).toBe(`${args.join(' ')}\n`);
      }
      expect(call('br', ['show', 'nope-1']).status).toBe(3);
      expect(call('br', ['show', '../canned/issues']).status).toBe(3);
      expect(call('br', ['show']).status).toBe(3);
    });

    test('a newline in an argument cannot fake a second logged call', () => {
      expect(call('br', ['comments', 'add', 'bb-t07', 'a\nlist --all']).log.split('\n').filter(Boolean)).toHaveLength(1);
    });

    test('BR_STUB_CANNED points the stubs at another data set (the sibling eval\'s reuse)', () => {
      fs.mkdirSync(SCRATCH, { recursive: true });
      const dir = fs.mkdtempSync(path.join(SCRATCH, 'canned-'));
      try {
        fs.writeFileSync(path.join(dir, 'issues.json'), '{"issues":[]}\n');
        fs.writeFileSync(path.join(dir, 'bv-plan.json'), '{"plan":{"tracks":[]}}\n');
        fs.writeFileSync(path.join(dir, 'show-x-1.json'), '[{"id":"x-1"}]\n');
        expect(call('br', ['list'], { BR_STUB_CANNED: dir }).out.trim()).toBe('{"issues":[]}');
        expect(call('br', ['show', 'x-1'], { BR_STUB_CANNED: dir }).out.trim()).toBe('[{"id":"x-1"}]');
        expect(call('bv', ['--robot-plan'], { BR_STUB_CANNED: dir }).out.trim()).toBe('{"plan":{"tracks":[]}}');
      } finally { fs.rmSync(dir, { recursive: true, force: true }); }
    });

    test('bv answers --version and --robot-plan, refuses the rest (insights only when its canned file exists), and logs', () => {
      expect(call('bv', ['--version']).out).toMatch(/stub/);
      const plan = call('bv', ['--robot-plan', '--format', 'json']);
      expect(plan.status).toBe(0);
      const tracks = JSON.parse(plan.out).plan.tracks;
      expect(tracks.map((t) => t.items.map((i) => i.id))).toEqual([['bb-t07', 'bb-t08'], ['bb-t09'], ['bb-p05']]);
      for (const args of [['--robot-triage'], ['--robot-insights'], ['--robot-next'], []]) {
        const r = call('bv', args);
        expect(r.status).toBe(2);
        expect(r.log).toBe(`${args.join(' ')}\n`);
      }
    });

    test('the canned data holds what the checks assume: 4 closed, 2 in progress, 4 open under the epic; the plan\'s ready beads are open', () => {
      const issues = JSON.parse(call('br', ['list']).out).issues;
      const mine = issues.filter((i) => i.title.startsWith('billing-export'));
      const by = (s) => mine.filter((i) => i.status === s && i.id !== 'bb-e1').length;
      expect({ open: by('open'), progress: by('in_progress'), closed: by('closed') }).toEqual({ open: 4, progress: 2, closed: 4 });
      const status = Object.fromEntries(issues.map((i) => [i.id, i.status]));
      const plan = JSON.parse(call('bv', ['--robot-plan']).out).plan;
      for (const t of plan.tracks) for (const i of t.items) expect(status[i.id]).toBe('open');
      expect(plan.tracks.flatMap((t) => t.items.map((i) => i.id))).not.toContain('bb-t10');
      expect(issues.find((i) => i.id === 'bb-e1').status).toBe('open');
      expect(issues.filter((i) => i.issue_type === 'epic').map((i) => i.title)).toEqual(['billing-export', 'payments-gateway']);
    });
  });

  test('the real toolchain-cli preflights and reads the stubs in the sandbox: slug mode, counts, sync, ready and plan', async () => {
    const seen = {};
    await kit.runEval(ID, (ws) => {
      const env = { ...process.env, PATH: `${path.join(ws.dir, 'bin')}${path.delimiter}${process.env.PATH}` };
      const cli = (...args) => spawnSync('node', [path.join(REPO, 'packages/development/lib/toolchain-cli.js'), ...args], { cwd: ws.dir, encoding: 'utf8', env });
      const pre = JSON.parse(cli('preflight', '--require', 'tracker.show', '--require', 'tracker.list', '--require', 'tracker.comment', '--require', 'tracker.close', '--require', 'work-graph.ready', '--require', 'workflow.status', '--require', 'workflow.remote-url', '--require', 'workflow.commit', '--non-interactive', '--json').stdout);
      seen.pre = pre;
      const go = (...a) => { const r = cli('run', ...a, '--run-id', pre.runId, '--non-interactive', '--json'); return JSON.parse(r.stdout.split('\n').filter((l) => l.startsWith('{')).pop()); };
      seen.slug = go('tracker.show', '--arg', 'id=billing-export');
      seen.id = go('tracker.show', '--arg', 'id=bb-e1');
      seen.list = go('tracker.list');
      seen.sync = go('tracker.sync');
      seen.ready = go('work-graph.ready');
      seen.plan = go('work-graph.plan');
      seen.calls = fs.readFileSync(path.join(ws.root, 'br-calls.log'), 'utf8');
    });
    expect(seen.pre.ok).toBe(true);
    expect(seen.slug.ok).toBe(false);
    expect(seen.id).toMatchObject({ ok: true, data: { id: 'bb-e1', title: 'billing-export', status: 'open', type: 'epic' } });
    const issues = JSON.parse(seen.list.data).issues.filter((i) => i.title.startsWith('billing-export'));
    expect(issues.filter((i) => i.status === 'open')).toHaveLength(5);
    expect(seen.sync.ok).toBe(true);
    expect(seen.ready.data.items.map((i) => i.id)).toEqual(['bb-t07', 'bb-t08']);
    expect(seen.plan.data.items.map((i) => i.id)).toEqual(['bb-t07', 'bb-t08']);
    expect(seen.calls).toMatch(/^sync --flush-only --json$/m);
  });

  test('arms: the command prefixes only the with-skill prompt; baseline loads no plugin, with-skill loads packages/development', async () => {
    const ev = kit.loadsClean(ID);
    const { baseline, withSkill } = await kit.armsFor(ID);
    expect(withSkill.prompt.startsWith(`${ev.command} billing-export --plan`)).toBe(true);
    expect(baseline.prompt).not.toMatch(/^\//);
    expect(baseline.prompt.startsWith('billing-export --plan')).toBe(true);
    expect(baseline.plugins).toEqual([]);
    expect(withSkill.plugins).toHaveLength(1);
    expect(withSkill.plugins[0]).toMatch(/packages\/development$/);
  }, 60000);
});
