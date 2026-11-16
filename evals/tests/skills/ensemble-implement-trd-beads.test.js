'use strict';

/**
 * Kit test for `ensemble-implement-trd-beads-plan` (plan-only scope: Phases 1 and 2). The stub "agent" is a function that does what a
 * good run leaves behind, using the REAL `br` in the sandbox's br workspace (the one `setup: br init --prefix itb` made) and real
 * `git` for the branch: so the bead export the checks read is the genuine `.beads/issues.jsonl` br writes. HOME for those calls is a throwaway
 * directory under the sandbox root. Needs `br` and `git` on PATH (`which br`); no model, no network, no real gh.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const kit = require('../skill-eval-kit');
const { expected } = require('../../checks/ensemble-implement-trd-beads');

const ID = 'ensemble-implement-trd-beads-plan';
const CHECK_IDS = [
  'preflight-artifact', 'bead-hierarchy', 'bead-types', 'bead-edges', 'beads-untouched', 'foreman-tags', 'feature-branch',
  'no-product-code', 'gh-readonly', 'nothing-pushed', 'noProtectedBranchCommit', 'remoteBranchUnchanged',
];

const sh = (ws, bin, args) => {
  const home = path.join(ws.root, 'stub-home');
  fs.mkdirSync(home, { recursive: true });
  const r = spawnSync(bin, args, {
    cwd: ws.dir, encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: home, LANG: 'C', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0' },
  });
  if (r.status !== 0) throw new Error(`${bin} ${args.join(' ')} failed: ${r.stderr || r.stdout}`);
  return (r.stdout || '').trim();
};
const br = (ws, ...args) => sh(ws, 'br', args);
const git = (ws, ...args) => sh(ws, 'git', ['-c', 'commit.gpgsign=false', ...args]);

/**
 * A stub plan-only run. Options each introduce one defect:
 *   skipBeads, dropTask (omit that task id's bead), dropEdge (omit the edge from the task id to its story), extraBead, closeBead,
 *   productCode, editSource, deleteSource, testFile, docsCode, commitMain, ghCall (a line in gh-calls.log), wrongBase, noBranch, headOnMain,
 *   extraBranch, pushBranch, tagStory, partialTags, wrongType, dupBead, noPreflight, badPreflight.
 */
const planRun = (o = {}) => (ws) => {
  const exp = expected();
  if (!o.noPreflight) {
    ws.write('.ensemble/state/toolchain/preflight-11111111-2222-3333-4444-555555555555.json',
      JSON.stringify({ ok: true, runId: '11111111-2222-3333-4444-555555555555', categories: ['tracker', 'test-runner', 'package-runner', 'workflow'], checkedAt: '2026-11-13T23:28:11.673Z' }).replace('"ok":true', o.badPreflight ? '"ok":false' : '"ok":true'));
  }
  if (o.commitMain) git(ws, 'commit', '--allow-empty', '-m', 'oops: committed on main');
  if (!o.skipBeads) {
    const ids = new Map();
    for (const b of exp.beads) {
      if (o.dropTask && b.titlePrefix.endsWith(`:task:${o.dropTask}]`)) continue;
      ids.set(b.titlePrefix, br(ws, 'create', '--title', b.title, '--type', o.wrongType && b.kind === 'story' && b.phaseN === 1 ? 'task' : b.type, '--silent'));
    }
    if (o.dupBead) br(ws, 'create', '--title', exp.plan.stories[0].title, '--type', 'feature', '--silent');
    if (o.extraBead) br(ws, 'create', '--title', 'Some unrelated bead', '--type', 'task', '--silent');
    for (const d of exp.plan.deps) {
      const blocked = ids.get(d.blockedId);
      const blocker = ids.get(d.blockerId);
      if (!blocked || !blocker) continue;
      if (o.dropEdge && d.blockerId.endsWith(`:task:${o.dropEdge}]`) && /:pr:\d\]$/.test(d.blockedId)) continue;
      br(ws, 'dep', 'add', blocked, blocker, '--type', 'blocks');
    }
    // --foreman: tag task-level beads after work-graph.plan; never epic/stories
    const taskIds = exp.beads.filter((b) => b.kind === 'task').map((b) => ids.get(b.titlePrefix)).filter(Boolean);
    for (const t of o.partialTags ? taskIds.slice(1) : taskIds) br(ws, 'label', 'add', t, 'foreman-exec');
    if (o.tagStory) br(ws, 'label', 'add', ids.get(exp.plan.stories[0].titlePrefix), 'foreman-exec');
    if (o.closeBead) br(ws, 'close', ids.get(exp.plan.tasks[0].titlePrefix), '--reason', 'oops');
    br(ws, 'sync', '--flush-only');
  }
  if (!o.noBranch) {
    if (o.wrongBase) {
      git(ws, 'switch', '-c', 'scratch');
      git(ws, 'commit', '--allow-empty', '-m', 'unrelated');
      git(ws, 'switch', '-c', exp.firstBranch);
      git(ws, 'branch', '-D', 'scratch');
    } else {
      git(ws, 'switch', '-c', exp.firstBranch);
    }
  }
  if (o.headOnMain) git(ws, 'switch', 'main');
  if (o.extraBranch) git(ws, 'branch', 'feature/trd-2026-b1c2d3e4-slugify-pr-2');
  if (o.pushBranch) {
    const origin = path.join(ws.root, 'origin.git');
    fs.copyFileSync(path.join(ws.dir, '.git', 'refs', 'heads', exp.firstBranch), path.join(origin, 'refs', 'heads', 'feature-pushed'));
  }
  if (o.productCode) ws.write('src/slugify.js', "'use strict';\nmodule.exports = { slugify: (s) => s };\n");
  if (o.deleteSource) ws.remove('src/index.js');
  if (o.testFile) ws.write('test/slugify.test.js', "'use strict';\n");
  if (o.docsCode) ws.write('docs/helper.js', 'module.exports = {};\n');
  if (o.editSource) ws.write('src/index.js', 'module.exports = { changed: true };\n');
  // the stub gh logs outside the worktree, like the real fixture stub
  const lines = ['--version', 'auth status', 'repo view --json nameWithOwner', 'pr list --state open --json number'];
  if (o.ghCall) lines.push(o.ghCall);
  ws.write('../gh-calls.log', `${lines.join('\n')}\n`);
};

describe(`${ID} (plan scope)`, () => {
  test('br and git are available for the stub agent', () => {
    expect(spawnSync('br', ['--version'], { encoding: 'utf8' }).status).toBe(0);
    expect(spawnSync('git', ['--version'], { encoding: 'utf8' }).status).toBe(0);
  });

  test('loads clean; plan-only definition, fixture parses and validates through trd-cli', () => {
    const ev = kit.loadsClean(ID);
    expect(ev.runtimes).toEqual(['claude']);
    expect(ev.env).toEqual({ ENSEMBLE_NON_INTERACTIVE: '1' });
    expect(ev.setup).toEqual([['br', 'init', '--prefix', 'itb']]);
    expect(ev.prompt).toMatch(/--plan --foreman/);
    expect(ev.command).toBe('/ensemble-development:ensemble:implement-trd-beads');
    expect(ev.description).toMatch(/PLAN ONLY/);
    expect(ev.description).toMatch(/MEANINGLESS BY CONSTRUCTION/);
    const exp = expected();
    expect(exp.plan.stories).toHaveLength(2);
    expect(exp.beads).toHaveLength(9); // 1 epic + 2 stories + 6 tasks
    expect(exp.firstBranch).toBe('feature/trd-2026-b1c2d3e4-slugify-pr-1');
    const cli = require('../../../packages/development/lib/trd-cli.js');
    const v = cli.runValidate ? cli.runValidate([path.join(ev.fixtureDir, 'docs/TRD/TRD-2026-b1c2d3e4-slugify.md')]) : null;
    if (v) { expect(v.ok).toBe(true); expect(v.errors).toEqual([]); expect(v.warnings).toEqual([]); }
  });

  test('the sandbox carries an initialised br workspace, the stub gh, a bare origin and the pinned toolchain', async () => {
    let seen;
    await kit.runEval(ID, (ws) => {
      seen = {
        beads: ws.exists('.beads/config.yaml'), gh: ws.exists('bin/gh'), origin: ws.exists('../origin.git'),
        tc: ws.read('.ensemble/toolchain.yaml'), ignored: ws.read('.gitignore'),
        status: git(ws, 'status', '--porcelain'),
      };
    });
    expect(seen.beads && seen.gh && seen.origin).toBe(true);
    expect(seen.tc).toMatch(/host: github/);
    expect(seen.ignored).toMatch(/\.beads\//);
    expect(seen.ignored).toMatch(/\.ensemble\/state\//);
    expect(seen.status).toBe(''); // a clean tree at the start: .beads and state are ignored
  }, 60000);

  test('a good plan run passes every check', async () => {
    const res = await kit.runEval(ID, planRun());
    expect(Object.keys(res)).toEqual(CHECK_IDS);
    kit.expectAllPass(res);
  }, 120000);

  test('the fixture alone (an agent that did nothing) fails the checks about the output', async () => {
    const res = await kit.runEval(ID, () => {});
    kit.expectFails(res, ['preflight-artifact', 'bead-hierarchy', 'bead-types', 'bead-edges', 'beads-untouched', 'foreman-tags', 'feature-branch']);
    for (const ok of ['no-product-code', 'gh-readonly', 'nothing-pushed', 'noProtectedBranchCommit', 'remoteBranchUnchanged']) expect(res[ok].pass).toBe(true);
  }, 60000);

  test('no beads created fails every bead check (and not the git or gh ones)', async () => {
    const res = await kit.runEval(ID, planRun({ skipBeads: true }));
    kit.expectFails(res, ['bead-hierarchy', 'bead-types', 'bead-edges', 'beads-untouched', 'foreman-tags'], /no beads exported/, { only: true });
  }, 120000);

  test('a missing task bead fails bead-hierarchy (wrong count)', async () => {
    const res = await kit.runEval(ID, planRun({ dropTask: 'TRD-003-TEST' }));
    kit.expectFails(res, ['bead-hierarchy', 'bead-types', 'bead-edges', 'foreman-tags'], /no bead with title prefix .*TRD-003-TEST/);
    expect(res['beads-untouched'].pass).toBe(true);
  }, 120000);

  test('an extra bead fails bead-hierarchy only', async () => {
    const res = await kit.runEval(ID, planRun({ extraBead: true }));
    kit.expectFails(res, 'bead-hierarchy', /10 beads, the plan has 9; unexpected bead "Some unrelated bead"/, { only: true });
  }, 120000);

  test('a missing task-to-story edge fails bead-edges only', async () => {
    const res = await kit.runEval(ID, planRun({ dropEdge: 'TRD-003' }));
    kit.expectFails(res, 'bead-edges', /missing edge: .*pr:2\] must depend on .*TRD-003\]/, { only: true });
  }, 120000);

  test('a closed bead fails beads-untouched only', async () => {
    const res = await kit.runEval(ID, planRun({ closeBead: true }));
    kit.expectFails(res, 'beads-untouched', /is closed/, { only: true });
  }, 120000);

  test('foreman-exec on a story fails foreman-tags only', async () => {
    const res = await kit.runEval(ID, planRun({ tagStory: true }));
    kit.expectFails(res, 'foreman-tags', /non-task bead/, { only: true });
  }, 120000);

  test('product code written fails no-product-code only', async () => {
    kit.expectFails(await kit.runEval(ID, planRun({ productCode: true })), 'no-product-code', /src\/slugify\.js/, { only: true });
    kit.expectFails(await kit.runEval(ID, planRun({ editSource: true })), 'no-product-code', /source file changed: src\/index\.js/, { only: true });
    kit.expectFails(await kit.runEval(ID, planRun({ deleteSource: true })), 'no-product-code', /fixture file removed: src\/index\.js/, { only: true });
    kit.expectFails(await kit.runEval(ID, planRun({ testFile: true })), 'no-product-code', /outside docs\/\.beads\/\.ensemble written by a plan run: test\/slugify\.test\.js/, { only: true });
    kit.expectFails(await kit.runEval(ID, planRun({ docsCode: true })), 'no-product-code', /non-documentation file written under docs\/: docs\/helper\.js/, { only: true });
  }, 120000);

  test('a bead of the wrong type fails bead-types only', async () => {
    const res = await kit.runEval(ID, planRun({ wrongType: true }));
    kit.expectFails(res, 'bead-types', /PR 1|pr:1\] has type task, the plan says feature/, { only: true });
  }, 120000);

  test('a duplicated bead fails bead-hierarchy only', async () => {
    const res = await kit.runEval(ID, planRun({ dupBead: true }));
    kit.expectFails(res, ['bead-hierarchy', 'bead-types', 'bead-edges', 'foreman-tags'], /2 beads share title prefix/);
    expect(res['beads-untouched'].pass).toBe(true);
  }, 120000);

  test('foreman-exec on only some task beads fails foreman-tags only', async () => {
    const res = await kit.runEval(ID, planRun({ partialTags: true }));
    kit.expectFails(res, 'foreman-tags', /on 5 of 6 task beads/, { only: true });
  }, 120000);

  test('a commit on main fails noProtectedBranchCommit', async () => {
    const res = await kit.runEval(ID, planRun({ commitMain: true }));
    kit.expectFails(res, 'noProtectedBranchCommit', /moved/, { only: true });
  }, 120000);

  test('a mutating gh call (pr create) fails gh-readonly only', async () => {
    const res = await kit.runEval(ID, planRun({ ghCall: 'pr create --base main --head feature/trd-2026-b1c2d3e4-slugify-pr-1 --title t --body b' }));
    kit.expectFails(res, 'gh-readonly', /gh call outside the plan-scope reads: gh pr create/, { only: true });
  }, 120000);

  test('a branch created from the wrong base fails feature-branch only', async () => {
    const res = await kit.runEval(ID, planRun({ wrongBase: true }));
    kit.expectFails(res, 'feature-branch', /wrong base/, { only: true });
  }, 120000);

  test('HEAD left on main after the branch was created fails feature-branch only', async () => {
    const res = await kit.runEval(ID, planRun({ headOnMain: true }));
    kit.expectFails(res, 'feature-branch', /HEAD is "ref: refs\/heads\/main"/, { only: true });
  }, 120000);

  test('a stray extra local branch (the later stacked branch, created too early) fails feature-branch only', async () => {
    const res = await kit.runEval(ID, planRun({ extraBranch: true }));
    kit.expectFails(res, 'feature-branch', /unexpected branch\(es\) at plan scope: feature\/trd-2026-b1c2d3e4-slugify-pr-2/, { only: true });
  }, 120000);

  test('no feature branch fails feature-branch only', async () => {
    const res = await kit.runEval(ID, planRun({ noBranch: true }));
    kit.expectFails(res, 'feature-branch', /was not created/, { only: true });
  }, 120000);

  test('a branch pushed to origin fails nothing-pushed only', async () => {
    const res = await kit.runEval(ID, planRun({ pushBranch: true }));
    kit.expectFails(res, 'nothing-pushed', /feature-pushed/, { only: true });
  }, 120000);

  test('no preflight record fails preflight-artifact only', async () => {
    const res = await kit.runEval(ID, planRun({ noPreflight: true }));
    kit.expectFails(res, 'preflight-artifact', /no \.ensemble\/state\/toolchain\/preflight-\*\.json/, { only: true });
  }, 120000);

  test('a preflight record with ok:false fails preflight-artifact only', async () => {
    const res = await kit.runEval(ID, planRun({ badPreflight: true }));
    kit.expectFails(res, 'preflight-artifact', /none is ok:true/, { only: true });
  }, 120000);

  test('computing the expectation leaves cwd and PATH as they were', () => {
    const before = process.cwd();
    const pathBefore = process.env.PATH;
    expect(expected().beads).toHaveLength(9);
    expect(process.env.PATH).toBe(pathBefore);
    expect(process.cwd()).toBe(before);
    expect(process.env.PATH).toBeTruthy();
  });

  // kit.armsFor passes the eval id to `run.js --skill`, which selects by SKILL name; this eval's id (`...-plan`) differs from its skill, so the
  // arms are checked here the same way armsFor does (a stub `claude` that records argv and plugin dirs, run.js with both arms, one repeat).
  test('arms: baseline plain prompt and no plugin; with-skill loads packages/development and the command prefixes only that arm', () => {
    const ev = kit.getEval(ID);
    fs.mkdirSync(kit.SCRATCH, { recursive: true });
    const t = fs.mkdtempSync(path.join(kit.SCRATCH, 'itb-arms-'));
    try {
      const bin = path.join(t, 'bin');
      fs.mkdirSync(bin, { recursive: true });
      const stub = `#!/usr/bin/env node
'use strict';
const fs = require('fs'); const path = require('path');
const argv = process.argv.slice(2);
const plugins = []; argv.forEach((a, i) => { if (argv[i - 1] === '--plugin-dir') plugins.push(a); });
fs.appendFileSync(path.join(__dirname, 'calls.jsonl'), JSON.stringify({ argv, plugins, cwd: process.cwd() }) + '\\n');
const skills = plugins.length ? ['ensemble-development:ensemble-implement-trd-beads'] : ['verify'];
console.log(JSON.stringify({ type: 'system', subtype: 'init', skills, plugins: plugins.map((p) => ({ name: 'ensemble-' + path.basename(p), path: p })), model: 'claude-stub-1' }));
console.log(JSON.stringify({ type: 'result', num_turns: 1, total_cost_usd: 0.01 }));
`;
      fs.writeFileSync(path.join(bin, 'claude'), stub, { mode: 0o755 });
      const r = spawnSync('node', [path.join(kit.REPO_ROOT, 'evals/run.js'), '--skill', ev.skill, '--repeats', '1', '--concurrency', '1', '--model', 'claude-stub-1', '--refresh'], {
        encoding: 'utf8', cwd: kit.REPO_ROOT,
        env: {
          ...process.env, CI: 'false', GITHUB_ACTIONS: 'false', PATH: `${bin}${path.delimiter}${process.env.PATH}`, EVALS_WORKDIR: path.join(t, 'work'),
          EVALS_RESULTS_DIR: path.join(t, 'results'), EVALS_BASELINES_DIR: path.join(t, 'baselines'), EVALS_CACHE_DIR: path.join(t, 'cache'),
        },
      });
      expect(r.stderr).not.toMatch(/REJECTED|leaked|isolation unverifiable/);
      const calls = fs.readFileSync(path.join(bin, 'calls.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
      expect(calls).toHaveLength(2);
      const promptOf = (c) => c.argv[c.argv.indexOf('-p') + 1];
      const baseline = calls.find((c) => c.plugins.length === 0);
      const withSkill = calls.find((c) => c.plugins.length > 0);
      expect(withSkill.plugins).toEqual([path.join(kit.REPO_ROOT, 'packages', 'development')]);
      expect(promptOf(withSkill)).toBe(`${ev.command} ${ev.prompt}`);
      expect(promptOf(baseline)).toBe(ev.prompt);
      expect(promptOf(baseline)).not.toMatch(/^\//);
      expect(promptOf(withSkill).startsWith('/ensemble-development:ensemble:implement-trd-beads docs/TRD/TRD-2026-b1c2d3e4-slugify.md --plan --foreman')).toBe(true);
      for (const c of calls) expect(c.cwd.startsWith(path.join(t, 'work'))).toBe(true);
      // the agent env carries the non-interactive switch only through eval.env (asserted on the definition above), and the PATH gets the stub bin
      expect(ev.sandboxPath).toEqual(['bin']);
    } finally {
      fs.rmSync(t, { recursive: true, force: true });
    }
  }, 120000);
});
