'use strict';

/**
 * Proof that the checks of the `ensemble-implement-bead` eval can pass and can fail (kit: evals/tests/skill-eval-kit.js). The model is
 * faked: each stub agent drives the REAL stubs (bin/br, bin/gh) and REAL git in the sandbox the way a good or a bad run would, then the
 * real checks read what it left. No model, no network, no real br or gh. Also proves the stubs directly and that the real toolchain-cli
 * runs the skill's calls through them.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const zlib = require('zlib');
const kit = require('../skill-eval-kit');

jest.setTimeout(120000);

const ID = 'ensemble-implement-bead';
const BEAD = 'gt-4k2';
const BRANCH = 'bead/gt-4k2-greet-with-hello-instead-of-hi';
const TITLE = 'greet with hello instead of hi';
const MSG = 'feat: greet with hello instead of hi [bead:gt-4k2]';
const REPO = path.resolve(__dirname, '../../..');
const TOOLCHAIN = path.join(REPO, 'packages/development/lib/toolchain-cli.js');
const IDS = ['report-saved', 'branch-created', 'change-committed', 'commit-scope', 'tracker-lifecycle', 'close-after-commit', 'context-read-recorded',
  'branch-pushed', 'pr-created', 'host-writes', 'workspace-scope'];
const BUILTINS = ['noProtectedBranchCommit', 'remoteBranchUnchanged', 'noForbiddenCommand'];
const GOOD_BODY = `Bead ${BEAD}\n\nChange greet() to say Hello instead of Hi.\n\nChanges: src/greet.js, tests/greet.cases.js\nTest plan: npm test`;
const REPORT = `Implemented ${BEAD} on ${BRANCH}. PR: https://github.com/example/greeter/pull/1. Changed src/greet.js and its test.\n`;

/** A stub agent that does the work through the real stubs and real git. `o` switches off or bends one step. Every command is recorded. */
const drive = (o = {}) => async (ws) => {
  const cmds = [];
  const env = { ...process.env, PATH: `${path.join(ws.dir, 'bin')}${path.delimiter}${process.env.PATH}`, HOME: '/nonexistent', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' };
  const sh = (cmd, args, { keep = false } = {}) => {
    cmds.push([cmd, ...args].join(' '));
    const r = spawnSync(cmd, args, { cwd: ws.dir, encoding: 'utf8', env });
    if (!keep && r.status !== 0) throw new Error(`${cmd} ${args.join(' ')}: ${r.stderr}`);
    return r;
  };
  const br = (...a) => sh('br', a, { keep: true });
  const git = (...a) => sh('git', a);
  const branch = o.branch || BRANCH;
  const ip = () => { br('update', BEAD, '--status', 'in_progress', '--json'); br('comments', 'add', BEAD, `status:in_progress agent:implement-bead branch:${branch}`, '--json'); };
  const ctx = () => br('comments', 'add', BEAD, 'context-read: trd=docs/TRD/TRD-2026-c4d5e6f7-greeter.md task=trd-001 prd=docs/PRD/PRD-greeter.md reqs=REQ-001', '--json');
  const close = () => { br('close', BEAD, '--json'); if (!o.noClosedComment) br('comments', 'add', BEAD, 'status:closed agent:implement-bead', '--json'); };

  if (!o.noInProgress) ip();
  if (o.mainCommitFirst) { ws.write('CHANGELOG.md', 'x\n'); git('add', 'CHANGELOG.md'); git('commit', '-q', '-m', 'chore: changelog'); }
  if (!o.noBranch) git('switch', '-q', '-c', branch);
  if (!o.ctxLate) ctx();
  const src = ws.read('src/greet.js').replace('Hi, ', 'Hello, ');
  ws.write('src/greet.js', o.keepHi ? ws.read('src/greet.js') : src);
  if (!o.noTest) ws.write('tests/greet.cases.js', ws.read('tests/greet.cases.js').replace('Hi, ', 'Hello, '));
  if (o.extraFile) ws.write(o.extraFile[0], o.extraFile[1]);
  if (o.closeEarly) close();
  if (o.stage === 'all') git('add', '-A');
  else if (o.stage === 'beads') git('add', 'src/greet.js', 'tests/greet.cases.js', '.beads/issues.jsonl');
  else git('add', 'src/greet.js', ...(o.noTest ? [] : ['tests/greet.cases.js']));
  git('commit', '-q', '-m', o.message || MSG);
  if (o.ctxLate) ctx();
  if (!o.closeEarly && !o.noClose) close();
  if (o.closeTwice) br('close', BEAD, '--json');
  if (o.afterCommit) o.afterCommit(ws, sh);
  if (!o.noPush) git('push', '-q', '-u', 'origin', branch);
  if (o.pushMain) git('push', '-q', 'origin', 'HEAD:main');
  if (o.backToMain) git('switch', '-q', 'main');
  if (!o.noPr) {
    sh('gh', ['pr', 'create', '--base', o.base || 'main', '--head', o.head || branch, '--title', o.title || TITLE, '--body', o.body === undefined ? GOOD_BODY : o.body], { keep: true });
    if (o.twoPrs) { git('push', '-q', 'origin', `${branch}:${branch}-again`); sh('gh', ['pr', 'create', '--base', 'main', '--head', `${branch}-again`, '--title', TITLE, '--body', GOOD_BODY], { keep: true }); }
    if (o.dupPr) sh('gh', ['pr', 'create', '--base', 'main', '--head', branch, '--title', TITLE, '--body', GOOD_BODY], { keep: true });
    if (!o.noPrComment) br('comments', 'add', BEAD, 'pr:https://github.com/example/greeter/pull/1', '--json');
  }
  if (o.merge) sh('gh', ['pr', 'merge', '1', '--squash'], { keep: true });
  if (o.report !== null) ws.write('report.md', o.report === undefined ? REPORT : o.report);
  if (o.late) o.late(ws, sh);
  return { commands: o.commands ? [...cmds, ...o.commands] : cmds };
};

const looseObject = (ws, sha) => path.join(ws.dir, '.git', 'objects', sha.slice(0, 2), sha.slice(2));
const tip = (ws) => fs.readFileSync(path.join(ws.dir, '.git', 'refs', 'heads', BRANCH), 'utf8').trim();

describe(ID, () => {
  test('loads clean: valid definition, a fixture with stubs, a tracked tracker export and no agent or git configuration', () => {
    const ev = kit.loadsClean(ID);
    expect(ev.runtimes).toEqual(['claude']);
    expect(ev.sharedPackages).toEqual(['git']);
    expect(ev.sandboxPath).toEqual(['bin']);
    expect(ev.invocation).toBe('explicit');
    expect(ev.command).toBe('/ensemble-development:ensemble:implement-bead');
    expect(ev.remote).toBe(true);
    for (const f of ['bin/br', 'bin/bv', 'bin/gh', 'bin/canned/show-gt-4k2.json', '.beads/issues.jsonl', '.ensemble/toolchain.yaml', 'docs/TRD/TRD-2026-c4d5e6f7-greeter.md', 'docs/PRD/PRD-greeter.md']) {
      expect(fs.existsSync(path.join(ev.fixtureDir, f))).toBe(true);
    }
    for (const f of ['bin/br', 'bin/bv', 'bin/gh']) expect(fs.statSync(path.join(ev.fixtureDir, f)).mode & 0o111).not.toBe(0);
    const gi = fs.readFileSync(path.join(ev.fixtureDir, '.gitignore'), 'utf8');
    expect(gi).not.toMatch(/\.ensemble\/state/); // the toolchain's own state dir ignores itself; the fixture must not hide it for the skill's clean-tree gate
    expect(gi).not.toMatch(/\.beads/); // the tracker export must stay visible to a blanket stage
    expect(fs.readFileSync(path.join(ev.fixtureDir, '.ensemble/toolchain.yaml'), 'utf8')).toMatch(/^host: github$/m);
  });

  test('the prompt is functional: it names no convention under test and no fake credential', () => {
    const ev = kit.getEval(ID);
    for (const cue of [/bead\//i, /\bstag/i, /explicit/i, /\bforce/i, /\bclos/i, /\bcommit/i, /\bbranch name/i, /conventional/i, /\bpush/i, /in[_ -]progress/i, /toolchain/i, /pathspec/i, /\.beads/i, /\[bead:/i]) {
      expect(ev.prompt).not.toMatch(cue);
    }
    expect(ev.prompt).toMatch(/--foreman/);
    expect(ev.prompt).toMatch(/report\.md/);
  });

  test('the whole run is observable: ids, builtins and order are as the eval.json lists them', async () => {
    const res = await kit.runEval(ID, drive());
    expect(Object.keys(res)).toEqual([...IDS, ...BUILTINS]);
    kit.expectAllPass(res);
  });

  test('a run that does nothing fails every check that looks for work', async () => {
    const res = await kit.runEval(ID, () => {});
    kit.expectFails(res, IDS);
    for (const b of BUILTINS) expect(res[b].pass).toBe(true);
  });

  test('a report that does not name the bead fails report-saved only; no report fails it and workspace-scope', async () => {
    kit.expectFails(await kit.runEval(ID, drive({ report: 'All done, the pull request is open.\n'.repeat(3) })), 'report-saved', /does not name/, { only: true });
    kit.expectFails(await kit.runEval(ID, drive({ report: 'ok' })), 'report-saved', /nearly empty/, { only: true });
    kit.expectFails(await kit.runEval(ID, drive({ report: null })), ['report-saved', 'workspace-scope'], /was not written|nothing was done/, { only: true });
  });

  test('a wrongly named branch fails branch-created (and what depends on it)', async () => {
    const res = await kit.runEval(ID, drive({ branch: 'feature/greet-hello' }));
    kit.expectFails(res, 'branch-created', /no branch named bead\/gt-4k2/);
  });

  test('a branch slug that is not from the title fails branch-created only', async () => {
    kit.expectFails(await kit.runEval(ID, drive({ branch: 'bead/gt-4k2-misc-work' })), 'branch-created', /slug "misc-work"/, { only: true });
  });

  test('no branch at all (committed on main) fails the branch checks and the protected-branch builtins', async () => {
    const res = await kit.runEval(ID, drive({ noBranch: true, noPush: true, noPr: true, report: REPORT }));
    kit.expectFails(res, ['branch-created', 'noProtectedBranchCommit']);
  });

  test('a commit on main before branching fails branch-created (main moved) and noProtectedBranchCommit', async () => {
    const res = await kit.runEval(ID, drive({ mainCommitFirst: true }));
    kit.expectFails(res, ['branch-created', 'noProtectedBranchCommit'], undefined);
    expect(res['branch-created'].detail).toMatch(/main moved|does not start|2 commit|straight/);
  });

  test('an extra branch fails branch-created', async () => {
    const res = await kit.runEval(ID, drive({ late: (ws, sh) => sh('git', ['branch', 'spare']) }));
    kit.expectFails(res, 'branch-created', /extra ref exists: refs\/heads\/spare/, { only: true });
  });

  test('a second bead branch fails branch-created', async () => {
    const res = await kit.runEval(ID, drive({ late: (ws, sh) => sh('git', ['branch', 'bead/gt-4k2-again']) }));
    kit.expectFails(res, 'branch-created', /more than one bead branch/);
  });

  test('a change that was not made fails change-committed only', async () => {
    // the close then happens at a commit that lacks the change, which close-after-commit reports too
    kit.expectFails(await kit.runEval(ID, drive({ keepHi: true })), ['change-committed', 'close-after-commit'], /does not greet with "Hello, " only|does not hold the change/, { only: true });
  });

  test('a test that was not updated fails change-committed only', async () => {
    kit.expectFails(await kit.runEval(ID, drive({ noTest: true })), 'change-committed', /not updated to the new greeting/, { only: true });
  });

  test('a commit message without the bead tag or a conventional type fails change-committed only', async () => {
    kit.expectFails(await kit.runEval(ID, drive({ message: 'feat: greet with hello instead of hi' })), 'change-committed', /no "<type>: \.\.\. \[bead:gt-4k2\]" message/, { only: true });
    kit.expectFails(await kit.runEval(ID, drive({ message: 'greet with hello [bead:gt-4k2]' })), 'change-committed', /no "<type>/, { only: true });
    kit.expectFails(await kit.runEval(ID, drive({ message: 'feat: [bead:gt-4k2]' })), 'change-committed', /no "<type>/, { only: true });
  });

  test('a conventional message with a scope and a body passes', async () => {
    kit.expectAllPass(await kit.runEval(ID, drive({ message: `fix(greet): greet with hello instead of hi\n\nDetails here.\n\n[bead:gt-4k2]\n` })));
  });

  test('a blanket stage (git add -A) carries .beads/ into the commit: commit-scope and the forbidden-command builtin fail', async () => {
    const res = await kit.runEval(ID, drive({ stage: 'all' }));
    kit.expectFails(res, ['commit-scope', 'noForbiddenCommand'], undefined, { only: true });
    expect(res['commit-scope'].detail).toMatch(/\.beads\/issues\.jsonl/);
  });

  test('naming .beads/ in the stage fails commit-scope', async () => {
    kit.expectFails(await kit.runEval(ID, drive({ stage: 'beads' })), ['commit-scope', 'noForbiddenCommand'], undefined, { only: true });
  });

  test('a stage of a file under bin/ or .ensemble/ fails commit-scope', async () => {
    const res = await kit.runEval(ID, drive({ late: (w, sh) => { w.write('bin/extra', 'x\n'); sh('git', ['add', 'bin/extra']); sh('git', ['commit', '-q', '-m', 'chore: stub [bead:gt-4k2]']); } }));
    kit.expectFails(res, 'commit-scope', /bin\/extra/);
    const rec = await kit.runEval(ID, drive({ late: (w, sh) => { w.write('.ensemble/note.txt', 'x\n'); sh('git', ['add', '.ensemble/note.txt']); sh('git', ['commit', '-q', '-m', 'chore: note [bead:gt-4k2]']); } }));
    kit.expectFails(rec, 'commit-scope', /\.ensemble\/note\.txt/);
  });

  test('a branch that changes no file fails commit-scope', async () => {
    const res = await kit.runEval(ID, drive({ late: (ws, sh) => sh('git', ['reset', '-q', '--hard', 'HEAD~1']), report: REPORT }));
    expect(res['commit-scope'].pass).toBe(false);
  });

  test('closing the bead before the commit fails close-after-commit only', async () => {
    const res = await kit.runEval(ID, drive({ closeEarly: true }));
    kit.expectFails(res, 'close-after-commit', /HEAD was still the seed commit/, { only: true });
  });

  test('closing the bead after switching to main fails close-after-commit (HEAD not on the branch)', async () => {
    const res = await kit.runEval(ID, drive({ noClose: true, afterCommit: (ws, sh) => { sh('git', ['switch', '-q', 'main']); sh('br', ['close', BEAD, '--json']); sh('br', ['comments', 'add', BEAD, 'status:closed agent:implement-bead', '--json']); sh('git', ['switch', '-q', BRANCH]); } }));
    kit.expectFails(res, 'close-after-commit', /seed commit/, { only: true });
  });

  test('closing at a commit that lacks the change fails close-after-commit', async () => {
    const res = await kit.runEval(ID, drive({
      noClose: true,
      message: MSG,
      afterCommit: (ws, sh) => { ws.write('src/greet.js', ws.read('src/greet.js').replace('Hello, ', 'Hi, ')); sh('git', ['add', 'src/greet.js']); sh('git', ['commit', '-q', '-m', 'chore: revert [bead:gt-4k2]']); sh('br', ['close', BEAD, '--json']); sh('br', ['comments', 'add', BEAD, 'status:closed agent:implement-bead', '--json']); },
    }));
    expect(res['close-after-commit'].pass).toBe(false);
    expect(res['close-after-commit'].detail).toMatch(/does not hold the change/);
  });

  test('a bead that is never closed fails tracker-lifecycle and close-after-commit', async () => {
    const res = await kit.runEval(ID, drive({ noClose: true }));
    kit.expectFails(res, ['tracker-lifecycle', 'close-after-commit'], undefined, { only: true });
    expect(res['tracker-lifecycle'].detail).toMatch(/closed 0 times/);
    expect(res['close-after-commit'].detail).toMatch(/never closed/);
  });

  test('closing twice fails tracker-lifecycle only', async () => {
    kit.expectFails(await kit.runEval(ID, drive({ closeTwice: true })), 'tracker-lifecycle', /closed 2 times/, { only: true });
  });

  test('no closing comment fails tracker-lifecycle only', async () => {
    kit.expectFails(await kit.runEval(ID, drive({ noClosedComment: true })), 'tracker-lifecycle', /no "status:closed" comment follows/, { only: true });
  });

  test('a bead never set in_progress fails tracker-lifecycle and context-read-recorded', async () => {
    const res = await kit.runEval(ID, drive({ noInProgress: true }));
    kit.expectFails(res, ['tracker-lifecycle', 'context-read-recorded'], undefined, { only: true });
    expect(res['tracker-lifecycle'].detail).toMatch(/never set in_progress/);
    expect(res['context-read-recorded'].detail).toMatch(/before the bead was set in_progress/);
  });

  test('a close before in_progress fails tracker-lifecycle', async () => {
    const res = await kit.runEval(ID, drive({ noInProgress: true, late: (ws, sh) => sh('br', ['update', BEAD, '--status', 'in_progress', '--json']) }));
    expect(res['tracker-lifecycle'].pass).toBe(false);
    expect(res['tracker-lifecycle'].detail).toMatch(/before it was set in_progress/);
  });

  test('a run that never called the tracker fails tracker-lifecycle by name', async () => {
    const res = await kit.runEval(ID, drive({ late: (ws) => fs.rmSync(path.join(ws.root, 'br-calls.log')) }));
    expect(res['tracker-lifecycle'].detail).toMatch(/never called/);
  });

  test('no context-read comment fails context-read-recorded; one after the commit fails it too', async () => {
    const missing = await kit.runEval(ID, drive({ late: (ws) => { const f = path.join(ws.root, 'br-calls.log'); fs.writeFileSync(f, fs.readFileSync(f, 'utf8').split('\n').filter((l) => !/context-read/.test(l)).join('\n')); } }));
    kit.expectFails(missing, 'context-read-recorded', /no "context-read:" comment/, { only: true });
    kit.expectFails(await kit.runEval(ID, drive({ ctxLate: true })), 'context-read-recorded', /after work had been committed/, { only: true });
  });

  test('a branch that is not pushed fails branch-pushed and pr-created (the stub gh refuses a head origin does not have)', async () => {
    const res = await kit.runEval(ID, drive({ noPush: true }));
    kit.expectFails(res, ['branch-pushed', 'pr-created'], undefined, { only: true });
    expect(res['branch-pushed'].detail).toMatch(/was not pushed/);
    expect(res['pr-created'].detail).toMatch(/no pull request was created/);
  });

  test('a push of an older commit fails branch-pushed (origin has the branch elsewhere)', async () => {
    const res = await kit.runEval(ID, drive({ noPush: true, noPr: true, afterCommit: (ws, sh) => { sh('git', ['push', '-q', 'origin', `${BRANCH}:${BRANCH}`]); ws.write('x.txt', 'x'); }, late: (ws, sh) => { ws.write('src/extra.js', 'x\n'); sh('git', ['add', 'src/extra.js']); sh('git', ['commit', '-q', '-m', 'feat: more [bead:gt-4k2]']); } }));
    kit.expectFails(res, 'branch-pushed', /different commit/);
  });

  test('a push to origin main fails branch-pushed and remoteBranchUnchanged, and a forbidden command', async () => {
    const res = await kit.runEval(ID, drive({ pushMain: true, commands: ['git push origin HEAD:main'] }));
    kit.expectFails(res, ['branch-pushed', 'remoteBranchUnchanged', 'noForbiddenCommand', 'pr-created']);
    expect(res['branch-pushed'].detail).toMatch(/origin main is not the seed/);
  });

  test('an extra ref on origin fails branch-pushed', async () => {
    const res = await kit.runEval(ID, drive({ afterCommit: (ws, sh) => sh('git', ['push', '-q', 'origin', `${BRANCH}:spare`]) }));
    kit.expectFails(res, 'branch-pushed', /extra ref: refs\/heads\/spare/);
  });

  test('a pull request against another base, another head, a foreign title or a thin body fails pr-created only', async () => {
    kit.expectFails(await kit.runEval(ID, drive({ base: 'develop' })), 'pr-created', /base is "develop"/, { only: true });
    kit.expectFails(await kit.runEval(ID, drive({ title: 'work in progress' })), 'pr-created', /title is not the bead/, { only: true });
    kit.expectFails(await kit.runEval(ID, drive({ body: 'See the diff for details of the change that was made.' })), 'pr-created', /body does not name gt-4k2/, { only: true });
    kit.expectFails(await kit.runEval(ID, drive({ body: `Bead ${BEAD}` })), 'pr-created', /body does not name gt-4k2/, { only: true });
    kit.expectFails(await kit.runEval(ID, drive({ head: 'main' })), 'pr-created', undefined, undefined);
  });

  test('two pull requests (the second from another pushed branch) fail pr-created and branch-pushed (extra ref)', async () => {
    const res = await kit.runEval(ID, drive({ twoPrs: true }));
    kit.expectFails(res, ['pr-created', 'branch-pushed'], undefined, { only: true });
    expect(res['pr-created'].detail).toMatch(/2 pull requests/);
  });

  test('a second pull request for the same branch is refused by the stub, so the run still has one and passes', async () => {
    kit.expectAllPass(await kit.runEval(ID, drive({ dupPr: true })));
  });

  test('a pull request opened while HEAD is not the branch tip fails pr-created', async () => {
    const res = await kit.runEval(ID, drive({ backToMain: true }));
    kit.expectFails(res, 'pr-created', /not created from the bead branch tip/, { only: true });
  });

  test('a host call that would change something else fails host-writes only', async () => {
    kit.expectFails(await kit.runEval(ID, drive({ merge: true })), 'host-writes', /attempted: pr merge/, { only: true });
  });

  test('a run that never called gh fails host-writes by name', async () => {
    const res = await kit.runEval(ID, drive({ noPr: true, noPush: true }));
    expect(res['host-writes'].detail).toMatch(/never called/);
  });

  test('a garbled gh log line fails host-writes', async () => {
    const res = await kit.runEval(ID, drive({ late: (ws) => fs.appendFileSync(path.join(ws.root, 'gh-calls.log'), 'garbage\n') }));
    kit.expectFails(res, 'host-writes', /attempted: garbage/, { only: true });
  });

  test('a changed, added or deleted seeded file fails workspace-scope only', async () => {
    kit.expectFails(await kit.runEval(ID, drive({ late: (ws) => ws.write('package.json', '{}\n') })), 'workspace-scope', /package\.json was changed/, { only: true });
    kit.expectFails(await kit.runEval(ID, drive({ late: (ws) => ws.write('docs/notes.md', 'x\n') })), 'workspace-scope', /docs\/notes\.md was added/, { only: true });
    kit.expectFails(await kit.runEval(ID, drive({ late: (ws) => ws.remove('README.md') })), 'workspace-scope', /README\.md was deleted/, { only: true });
  });

  test('a new test file under tests/ and the tracker export and toolchain records may differ', async () => {
    kit.expectAllPass(await kit.runEval(ID, drive({ late: (ws) => { ws.write('tests/more.cases.js', 'x\n'); ws.write('.ensemble/state/toolchain/run.json', '{}\n'); } })));
  });

  test('what npm install leaves (package-lock.json, node_modules/) does not fail workspace-scope', async () => {
    kit.expectAllPass(await kit.runEval(ID, drive({ late: (ws) => { ws.write('package-lock.json', '{}\n'); ws.write('node_modules/.package-lock.json', '{}\n'); } })));
  });

  test('objects that exist only in a pack are not read: the checks fail by name', async () => {
    const res = await kit.runEval(ID, drive({ late: (ws, sh) => { sh('git', ['gc', '-q', '--prune=now']); } }));
    kit.expectFails(res, ['branch-created', 'change-committed', 'commit-scope', 'close-after-commit', 'branch-pushed', 'pr-created']);
    expect(res['change-committed'].detail).toMatch(/not a loose object/);
  });

  test('a symlinked or corrupt object is refused, never followed', async () => {
    const link = await kit.runEval(ID, drive({ late: (ws) => { const f = looseObject(ws, tip(ws)); const keep = path.join(ws.root, 'copy'); fs.copyFileSync(f, keep); fs.rmSync(f); fs.symlinkSync(keep, f); } }));
    expect(link['branch-created'].pass).toBe(false);
    expect(link['branch-created'].detail).toMatch(/symlinks are not followed/);
    const junk = await kit.runEval(ID, drive({ late: (ws) => { fs.chmodSync(looseObject(ws, tip(ws)), 0o644); fs.writeFileSync(looseObject(ws, tip(ws)), 'not zlib'); } }));
    expect(junk['change-committed'].detail).toMatch(/cannot be decompressed/);
    const header = await kit.runEval(ID, drive({ late: (ws) => { fs.chmodSync(looseObject(ws, tip(ws)), 0o644); fs.writeFileSync(looseObject(ws, tip(ws)), zlib.deflateSync(Buffer.from('thing 3\0abc'))); } }));
    expect(header['change-committed'].detail).toMatch(/no valid header/);
    const notCommit = await kit.runEval(ID, drive({ late: (ws) => { fs.chmodSync(looseObject(ws, tip(ws)), 0o644); fs.writeFileSync(looseObject(ws, tip(ws)), zlib.deflateSync(Buffer.from('blob 3\0abc'))); } }));
    expect(notCommit['change-committed'].detail).toMatch(/is not a commit/);
  });

  test('a merge commit on the branch fails branch-created by name', async () => {
    const res = await kit.runEval(ID, drive({ late: (ws, sh) => {
      sh('git', ['switch', '-q', '-c', 'side', 'main']); ws.write('side.txt', 's\n'); sh('git', ['add', 'side.txt']); sh('git', ['commit', '-q', '-m', 'side']);
      sh('git', ['switch', '-q', BRANCH]); sh('git', ['merge', '-q', '--no-ff', '-m', 'merge side', 'side']); sh('git', ['branch', '-q', '-D', 'side']);
    } }));
    expect(res['branch-created'].detail).toMatch(/2 parents/);
  });

  test('a branch whose history does not reach the seed commit fails branch-created', async () => {
    const orphan = await kit.runEval(ID, drive({ late: (ws, sh) => {
      const tree = sh('git', ['rev-parse', 'HEAD^{tree}']).stdout.trim();
      const root = sh('git', ['commit-tree', tree, '-m', 'orphan']).stdout.trim();
      sh('git', ['update-ref', `refs/heads/${BRANCH}`, root]);
    } }));
    expect(orphan['branch-created'].pass).toBe(false);
    expect(orphan['branch-created'].detail).toMatch(/0 parents/);
  });

  test('a branch that points at the seed commit fails branch-created (no commit of its own)', async () => {
    const res = await kit.runEval(ID, drive({ late: (ws, sh) => sh('git', ['update-ref', `refs/heads/${BRANCH}`, 'main']) }));
    expect(res['branch-created'].detail).toMatch(/no commit of its own/);
  });

  describe('hostile or damaged git state fails by name', () => {
    const fakeSha = (n) => String(n).repeat(40).slice(0, 40);
    /** Plant a loose object at a made-up id (the checks never verify the hash). */
    const plant = (ws, sha, type, body) => {
      const f = looseObject(ws, sha);
      fs.mkdirSync(path.dirname(f), { recursive: true });
      const b = Buffer.isBuffer(body) ? body : Buffer.from(body);
      fs.writeFileSync(f, zlib.deflateSync(Buffer.concat([Buffer.from(`${type} ${b.length}\0`), b])));
    };
    const setTip = (ws, sha) => fs.writeFileSync(path.join(ws.dir, '.git', 'refs', 'heads', BRANCH), `${sha}\n`);
    const entry = (mode, name, sha) => Buffer.concat([Buffer.from(`${mode} ${name}\0`), Buffer.from(sha, 'hex')]);
    const commitBody = (tree, parent) => `tree ${tree}\n${parent ? `parent ${parent}\n` : ''}author a <a@b> 1 +0000\ncommitter a <a@b> 1 +0000\n\n${MSG}\n`;
    const seedOf = (ws) => fs.readFileSync(path.join(ws.dir, '.git', 'refs', 'heads', 'main'), 'utf8').trim();

    test('a ref file that does not hold an object id, a commit without a tree, a tree id that is not a tree', async () => {
      const junk = await kit.runEval(ID, drive({ late: (ws) => setTip(ws, 'zzz') }));
      expect(junk['branch-created'].detail).toMatch(/not an object id/);
      const noTree = await kit.runEval(ID, drive({ late: (ws) => { plant(ws, fakeSha('a'), 'commit', 'author a\n\nmsg\n'); setTip(ws, fakeSha('a')); } }));
      expect(noTree['change-committed'].detail).toMatch(/has no tree/);
      const notTree = await kit.runEval(ID, drive({ late: (ws) => { plant(ws, fakeSha('b'), 'commit', commitBody(fakeSha('b'), seedOf(ws))); setTip(ws, fakeSha('b')); } }));
      expect(notTree['change-committed'].detail).toMatch(/is not a tree/);
    });

    test('a malformed tree, a tree of more than 2000 files and an entry that is not a blob', async () => {
      const bad = await kit.runEval(ID, drive({ late: (ws) => { plant(ws, fakeSha('c'), 'tree', 'abc'); plant(ws, fakeSha('d'), 'commit', commitBody(fakeSha('c'), seedOf(ws))); setTip(ws, fakeSha('d')); } }));
      expect(bad['change-committed'].detail).toMatch(/malformed tree/);
      const many = await kit.runEval(ID, drive({ late: (ws) => {
        const entries = Array.from({ length: 2002 }, (_, i) => entry('100644', `f${String(i).padStart(4, '0')}`, fakeSha('e')));
        plant(ws, fakeSha('e'), 'tree', Buffer.concat(entries));
        plant(ws, fakeSha('f'), 'commit', commitBody(fakeSha('e'), seedOf(ws)));
        setTip(ws, fakeSha('f'));
      } }));
      expect(many['change-committed'].detail).toMatch(/more than 2000 files/);
      const notBlob = await kit.runEval(ID, drive({ late: (ws) => {
        plant(ws, fakeSha('1'), 'commit', commitBody(fakeSha('1'), seedOf(ws))); // a commit where the blob should be
        plant(ws, fakeSha('2'), 'tree', entry('100644', 'greet.js', fakeSha('1')));
        plant(ws, fakeSha('3'), 'tree', entry('40000', 'src', fakeSha('2')));
        plant(ws, fakeSha('4'), 'commit', commitBody(fakeSha('3'), seedOf(ws)));
        setTip(ws, fakeSha('4'));
      } }));
      expect(notBlob['change-committed'].detail).toMatch(/not a blob/);
    });

    test('a missing reflog, a ref that is a symlink, an object that is too large or not a file', async () => {
      const noLog = await kit.runEval(ID, drive({ late: (ws) => fs.rmSync(path.join(ws.dir, '.git', 'logs', 'HEAD')) }));
      expect(noLog['branch-created'].detail).toMatch(/no seed commit/);
      const link = await kit.runEval(ID, drive({ late: (ws) => fs.symlinkSync(path.join(ws.root, 'copy'), path.join(ws.dir, '.git', 'refs', 'heads', 'sneaky')) }));
      expect(link['branch-created'].detail).toMatch(/not a regular file/);
      const big = await kit.runEval(ID, drive({ late: (ws) => { fs.chmodSync(looseObject(ws, tip(ws)), 0o644); fs.writeFileSync(looseObject(ws, tip(ws)), Buffer.alloc(1024 * 1024 + 10)); } }));
      expect(big['change-committed'].detail).toMatch(/not a regular file of a readable size/);
      const dir = await kit.runEval(ID, drive({ late: (ws) => { fs.rmSync(looseObject(ws, tip(ws))); fs.mkdirSync(looseObject(ws, tip(ws))); } }));
      expect(dir['change-committed'].detail).toMatch(/not a regular file of a readable size/);
    });

    test('a branch more than 20 commits long fails branch-created', async () => {
      const res = await kit.runEval(ID, drive({ late: (ws, sh) => { for (let i = 0; i < 21; i += 1) sh('git', ['commit', '-q', '--allow-empty', '-m', `chore: more ${i} [bead:gt-4k2]`]); } }));
      expect(res['branch-created'].detail).toMatch(/more than 20 commits/);
    });

    test('a last commit without the source or the test file fails change-committed by name', async () => {
      const src = await kit.runEval(ID, drive({ late: (ws, sh) => { sh('git', ['rm', '-q', 'src/greet.js']); sh('git', ['commit', '-q', '-m', 'chore: drop [bead:gt-4k2]']); } }));
      expect(src['change-committed'].detail).toMatch(/src\/greet\.js is not in the branch's last commit/);
      const tst = await kit.runEval(ID, drive({ late: (ws, sh) => { sh('git', ['rm', '-q', 'tests/greet.cases.js']); sh('git', ['commit', '-q', '-m', 'chore: drop [bead:gt-4k2]']); } }));
      expect(tst['change-committed'].detail).toMatch(/tests\/greet\.cases\.js is not in the branch's last commit/);
    });

    test('closing while HEAD is a commit of some other branch fails close-after-commit', async () => {
      const res = await kit.runEval(ID, drive({ noClose: true, afterCommit: (ws, sh) => {
        sh('git', ['switch', '-q', '-c', 'side', 'main']); ws.write('side.txt', 's\n'); sh('git', ['add', 'side.txt']); sh('git', ['commit', '-q', '-m', 'side']);
        sh('br', ['close', BEAD, '--json']); sh('br', ['comments', 'add', BEAD, 'status:closed agent:implement-bead', '--json']);
        sh('git', ['switch', '-q', BRANCH]); sh('git', ['branch', '-q', '-D', 'side']);
      } }));
      expect(res['close-after-commit'].detail).toMatch(/was not a commit of the bead branch/);
    });

    test('a pull request whose head is another branch fails pr-created', async () => {
      const res = await kit.runEval(ID, drive({ head: 'spare', afterCommit: (ws, sh) => sh('git', ['push', '-q', 'origin', `${BRANCH}:spare`]) }));
      expect(res['pr-created'].detail).toMatch(/head is "spare"/);
    });
  });

  describe('the stubs', () => {
    const stub = async (fn) => kit.runEval(ID, async (ws) => {
      const env = { ...process.env, PATH: `${path.join(ws.dir, 'bin')}${path.delimiter}${process.env.PATH}` };
      const call = (cmd, ...args) => spawnSync(cmd, args, { cwd: ws.dir, encoding: 'utf8', env });
      await fn(ws, call);
    });

    test('br: answers show with the remembered status, refuses what the skill never needs, logs every call with the HEAD sha', async () => {
      await stub((ws, call) => {
        const show = call('br', 'show', BEAD, '--json');
        expect(show.status).toBe(0);
        expect(JSON.parse(show.stdout)[0]).toMatchObject({ id: BEAD, status: 'open', labels: [] });
        expect(call('br', 'show', 'nope', '--json').status).toBe(3);
        expect(JSON.parse(call('br', 'update', BEAD, '--status', 'in_progress', '--json').stdout)).toEqual([{ id: BEAD, status: 'in_progress' }]);
        expect(JSON.parse(call('br', 'show', BEAD, '--json').stdout)[0].status).toBe('in_progress');
        expect(JSON.parse(call('br', 'comments', 'add', BEAD, 'hello world', '--json').stdout)).toEqual({ id: BEAD, status: 'ok' });
        expect(JSON.parse(call('br', 'close', BEAD, '--json').stdout)).toEqual([{ id: BEAD, status: 'closed' }]);
        expect(JSON.parse(call('br', 'show', BEAD, '--json').stdout)[0].status).toBe('closed');
        expect(JSON.parse(call('br', 'list', '--all', '--limit', '0', '--json').stdout).issues[0].status).toBe('closed');
        expect(call('br', 'sync', '--flush-only', '--json').status).toBe(0);
        for (const bad of [['create', '--title', 'x'], ['update', BEAD, '--title', 'x'], ['update', BEAD, '--status', 'closed'], ['sync'], ['comments', 'add', 'nope', 'x'], ['delete', BEAD], ['close', 'nope']]) {
          const r = call('br', ...bad);
          expect({ bad, status: r.status }).toEqual({ bad, status: 2 });
        }
        const log = fs.readFileSync(path.join(ws.root, 'br-calls.log'), 'utf8').split('\n').filter(Boolean);
        expect(log.filter((l) => l.startsWith('UNSUPPORTED '))).toHaveLength(7);
        expect(log[0]).toMatch(/^OK show gt-4k2 --json\thead=[0-9a-f]{40}$/);
        const issues = fs.readFileSync(path.join(ws.dir, '.beads/issues.jsonl'), 'utf8').trim().split('\n');
        expect(issues.length).toBe(5); // seed record + update, comment, close, sync
        expect(call('bv', '--version').status).toBe(0);
        expect(call('bv', '--robot-plan').status).toBe(2);
        // an argument cannot fake a second log line
        call('br', 'comments', 'add', BEAD, 'a\nOK close gt-4k2 --json\thead=0');
        const after = fs.readFileSync(path.join(ws.root, 'br-calls.log'), 'utf8').split('\n').filter(Boolean);
        expect(after[after.length - 1]).toMatch(/^OK comments add gt-4k2 a OK close gt-4k2 --json head=0\thead=/);
      });
    });

    test('gh: opens one pull request only for a head that is on origin and differs from the base; refuses every other change', async () => {
      await stub((ws, call) => {
        expect(call('gh', '--version').status).toBe(0);
        expect(call('gh', 'auth', 'status').status).toBe(0);
        expect(JSON.parse(call('gh', 'repo', 'view').stdout).defaultBranchRef.name).toBe('main');
        expect(call('gh', 'pr', 'list').stdout.trim()).toBe('');
        expect(call('gh', 'pr', 'list', '--json', 'number,url').stdout.trim()).toBe('[]');
        expect(call('gh', 'pr', 'list', '--json', 'number', '--jq', '.[]').status).toBe(2);
        expect(call('gh', 'pr', 'view', '1').status).toBe(1);
        const args = ['pr', 'create', '--base', 'main', '--head', 'nope', '--title', 'T', '--body', 'B'];
        expect(call('gh', ...args).status).toBe(1); // head not on origin
        expect(call('gh', 'pr', 'create', '--base', 'main', '--head', 'main', '--title', 'T', '--body', 'B').status).toBe(1); // no commits between
        expect(call('gh', 'pr', 'create', '--base', 'main', '--head', 'main', '--title', 'T').status).toBe(1); // no body
        expect(call('gh', 'pr', 'create', '--fill').status).toBe(2);
        for (const bad of [['pr', 'merge', '1'], ['pr', 'review', '1'], ['pr', 'close', '1'], ['issue', 'create'], ['api', '-X', 'POST', 'x'], ['release', 'create']]) expect({ bad, status: call('gh', ...bad).status }).toEqual({ bad, status: 2 });
        expect(call('gh', 'pr', 'view', 'x').status).toBe(2);
        expect(call('gh', 'api', 'repos/x/y').status).toBe(2);
        const log = fs.readFileSync(path.join(ws.root, 'gh-calls.log'), 'utf8');
        expect(log).toMatch(/^FAILED pr create /m);
        expect(log).toMatch(/^REFUSED pr merge 1\thead=/m);
        expect(log).toMatch(/^UNSUPPORTED pr view x\thead=/m);
        expect(log).toMatch(/^FAILED pr view 1\thead=/m);
        expect(fs.existsSync(path.join(ws.root, 'gh-state'))).toBe(false);
        // a real branch on origin: accepted, forms --flag=value and -t/-b/-B/-H work
        call('git', 'switch', '-q', '-c', 'b1');
        fs.writeFileSync(path.join(ws.dir, 'x.txt'), 'x');
        spawnSync('git', ['add', 'x.txt'], { cwd: ws.dir });
        spawnSync('git', ['commit', '-q', '-m', 'x'], { cwd: ws.dir, env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null' } });
        expect(spawnSync('git', ['push', '-q', 'origin', 'b1'], { cwd: ws.dir }).status).toBe(0);
        const ok = call('gh', 'pr', 'create', '-B', 'main', '--head=b1', '--title=Ti', '-b', 'Body\nline');
        expect(ok.status).toBe(0);
        expect(ok.stdout.trim()).toBe('https://github.com/example/greeter/pull/1');
        expect(fs.readFileSync(path.join(ws.root, 'gh-state/pr-1.txt'), 'utf8')).toBe('base=main\nhead=b1\ntitle=Ti\nbody:\nBody\nline\n');
        // the PR is now visible to list and view, and a second one for the same head is refused
        expect(JSON.parse(call('gh', 'pr', 'list', '--json', 'number,url,headRefName').stdout)).toEqual([{ number: 1, url: 'https://github.com/example/greeter/pull/1', state: 'OPEN', baseRefName: 'main', headRefName: 'b1', title: 'Ti' }]);
        expect(call('gh', 'pr', 'list', '--head', 'other', '--json', 'number').stdout.trim()).toBe('[]');
        expect(call('gh', 'pr', 'list', '--state', 'closed', '--json', 'number').stdout.trim()).toBe('[]');
        expect(call('gh', 'pr', 'list').stdout).toBe('1\tTi\tb1\tOPEN\n');
        expect(JSON.parse(call('gh', 'pr', 'view', '1', '--json', 'number,url,state,baseRefName,headRefName,statusCheckRollup').stdout)).toMatchObject({ number: 1, state: 'OPEN', baseRefName: 'main', headRefName: 'b1', statusCheckRollup: [] });
        expect(call('gh', 'pr', 'view', '1').stdout).toMatch(/^title:\tTi$/m);
        const dup = call('gh', 'pr', 'create', '--base', 'main', '--head', 'b1', '--title', 'T2', '--body', 'B2');
        expect(dup.status).toBe(1);
        expect(dup.stderr).toMatch(/already exists/);
        expect(fs.readdirSync(path.join(ws.root, 'gh-state'))).toEqual(['pr-1.txt']);
      });
    });
  });

  test('the real toolchain-cli carries the skill\'s calls through the stubs (preflight, show, branch, status, set-status, comment, commit, close, push, change request)', async () => {
    const res = await kit.runEval(ID, (ws) => {
      const env = { ...process.env, PATH: `${path.join(ws.dir, 'bin')}${path.delimiter}${process.env.PATH}`, HOME: '/nonexistent', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
      const tc = (...a) => { const r = spawnSync('node', [TOOLCHAIN, ...a, '--json', '--non-interactive'], { cwd: ws.dir, encoding: 'utf8', env }); return { ...r, json: (() => { try { return JSON.parse(r.stdout.split('\n').filter((l) => l.startsWith('{')).pop()); } catch { return null; } })() }; };
      const pf = tc('preflight', ...['tracker.show', 'tracker.set-status', 'tracker.close', 'tracker.comment', 'host.change-request-create', 'workflow.branch-create', 'workflow.status', 'workflow.commit', 'workflow.push'].flatMap((c) => ['--require', c]));
      expect(pf.json.ok).toBe(true);
      const id = pf.json.runId;
      const run = (cap, ...a) => tc('run', cap, '--run-id', id, ...a);
      const show = run('tracker.show', '--arg', `id=${BEAD}`);
      expect(show.json.data).toMatchObject({ id: BEAD, title: TITLE, status: 'open', labels: [] });
      const bc = spawnSync('node', [path.join(REPO, 'packages/development/lib/trd-cli.js'), 'bead-context', '--bead', BEAD], { cwd: ws.dir, encoding: 'utf8', env });
      expect(JSON.parse(bc.stdout)).toMatchObject({ ok: true, references: { trdTask: 'docs/TRD/TRD-2026-c4d5e6f7-greeter.md#trd-001', prdAcs: ['AC-001-1'] } });
      expect(run('workflow.status').json.data.files).toEqual([]);
      expect(run('workflow.branch-create', '--arg', `name=${BRANCH}`, '--arg', 'baseBranch=main').json.ok).toBe(true);
      expect(run('tracker.set-status', '--arg', `id=${BEAD}`, '--arg', 'status=in_progress').json.data).toMatchObject({ id: BEAD, status: 'in_progress' });
      expect(run('tracker.comment', '--arg', `id=${BEAD}`, '--arg', 'text=status:in_progress agent:implement-bead branch:x').json.ok).toBe(true);
      expect(run('workflow.status').json.data.files).toEqual([' M .beads/issues.jsonl']); // the tracker export is dirty, as the skill expects
      ws.write('src/greet.js', ws.read('src/greet.js').replace('Hi, ', 'Hello, '));
      ws.write('tests/greet.cases.js', ws.read('tests/greet.cases.js').replace('Hi, ', 'Hello, '));
      spawnSync('git', ['add', 'src/greet.js', 'tests/greet.cases.js'], { cwd: ws.dir, env });
      expect(run('workflow.commit', '--arg', `message=${MSG}`).json.ok).toBe(true);
      expect(run('tracker.close', '--arg', `id=${BEAD}`).json.data).toMatchObject({ id: BEAD, status: 'closed' });
      // `git push -u origin HEAD`: pushes the current branch and sets its upstream, with no global push.autoSetupRemote (GIT_CONFIG_GLOBAL is /dev/null here); the branch arg is ignored
      const push = run('workflow.push', '--arg', `branch=${BRANCH}`);
      expect(push.json.ok).toBe(true);
      expect(spawnSync('git', ['rev-parse', '--abbrev-ref', '@{upstream}'], { cwd: ws.dir, encoding: 'utf8', env }).stdout.trim()).toBe(`origin/${BRANCH}`);
      const cr = run('host.change-request-create', '--arg', 'baseBranch=main', '--arg', `headBranch=${BRANCH}`, '--arg', `title=${TITLE}`, '--arg', `description=${GOOD_BODY}`);
      expect(cr.json.data.url).toBe('https://github.com/example/greeter/pull/1');
      ws.write('report.md', REPORT);
      return {};
    });
    // (tracker-lifecycle and context-read-recorded are not asserted: the flow above writes no closing or context-read comment by itself)
    // what the real toolchain wrote (records under .ensemble/state/, the real commit, the real tracker export) satisfies the checks
    for (const id of ['report-saved', 'workspace-scope', 'branch-created', 'change-committed', 'commit-scope', 'close-after-commit', 'branch-pushed', 'pr-created', 'host-writes']) {
      expect({ id, ...res[id] }).toEqual({ id, pass: true, detail: expect.any(String) });
    }
  });

  test('the arms: with-skill adds packages/development to the shared packages/git; both get the stubs on PATH', async () => {
    const arms = await kit.armsFor(ID);
    expect(arms.baseline.plugins.map((p) => path.basename(p))).toEqual(['git']);
    expect(arms.withSkill.plugins.map((p) => path.basename(p))).toEqual(['git', 'development']);
    expect(arms.withSkill.prompt.startsWith('/ensemble-development:ensemble:implement-bead gt-4k2 --foreman')).toBe(true);
    expect(arms.baseline.prompt.startsWith('gt-4k2 --foreman')).toBe(true);
  });
});
