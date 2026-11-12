'use strict';

/**
 * The veto of hosted-CI reuse (PR 297, kata ehsm): a failure the local gate recorded on a head must stop green hosted
 * jobs from standing in, and the veto must be impossible to dodge. Pinned through the real CLI entry (`cli.main`, real
 * git, a stateful fake GitHub whose commit statuses are exactly what `postStatus` posted, newest first), through the
 * real runner for one refusal, and through real child processes with a fake `gh`.
 *   D1  every HEAD-BOUND refusal of a local run publishes a failure status; a TRANSIENT one publishes nothing;
 *   D2  ONE veto rule, read from GitHub by `merge` and by `gate` (latest status in the context decides, fail closed);
 *   D3  a payload failure that names no usable commit cannot be attributed to another commit, so it vetoes `merge`;
 *   D4  a run bound to this PR with a malformed id is refused, never dropped;
 *   D5  static checks of a required job and its `needs:` closure: repo-local uses, continue-on-error, PR-controlled `if:`.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const cli = require('../lib/local-ci-cli');
const { runGate: realRunGate } = require('../lib/local-ci-runner');
const { verifyHosted } = require('../lib/local-ci-hosted');
const { cleanupBaseRepos, prInfoFor, BASE_BRANCH } = require('./helpers/local-ci-base-repo');
const H = require('./helpers/local-ci-hosted');
const W = require('./helpers/local-ci-wal');
const { REPO, PR, CONTEXT, VALIDATE, TEST, DRIFT } = H;
const GIT = H.memoGit();
const CLI_PATH = path.join(__dirname, '..', 'lib', 'local-ci-cli.js');
const OTHER = 'c'.repeat(40);

const scratch = [];
const tmpDir = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'local-ci-hosted-veto-'));
  scratch.push(d);
  return d;
};
afterAll(() => {
  cleanupBaseRepos();
  H.cleanupHostedFixtures();
  for (const d of scratch.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const fx = H.hostedRepo();
const HEAD = fx.headSha;
const SHA8 = HEAD.slice(0, 8);
const payloadFor = (fixture, extra) => ({ repoRoot: fixture.dir, headSha: fixture.headSha, baseRef: fixture.baseRef, repo: REPO, pr: PR, ...extra });

const passingRun = () => ({ ok: true, sha: HEAD, failures: [], unmirrored: [], nodes: [{ node: 22, ok: true, steps: [] }, { node: 24, ok: true, steps: [] }] });
const refusedRun = (failure) => ({
  ok: false,
  sha: HEAD,
  failures: [{ step: null, node: null, sha: HEAD, message: 'refused', ...failure }],
  unmirrored: [],
  nodes: [{ node: 22, ok: false, steps: [] }],
});

/**
 * One world: real git, a fake GitHub (Actions answers from `entries`, commit statuses from a stateful store), a runGate
 * whose answer a test changes with `world.runs.next = ...`, a postStatus that stores what is posted.
 */
function world({ entries = H.honest(HEAD), initial = [], fixture = fx, api = {}, prAnswers = [{}], deps = {} } = {}) {
  const gh = H.statefulStatuses({ initial });
  const ghApi = H.actionsApi(entries, { ...api, answer: api.answer || gh.answer });
  const prCalls = [];
  const prInfo = (args) => {
    const n = prCalls.length;
    prCalls.push(args);
    const over = prAnswers[Math.min(n, prAnswers.length - 1)];
    return over.error ? { ok: false, error: over.error } : prInfoFor(fixture, over)(args);
  };
  prInfo.calls = prCalls;
  const w = { gh, ghApi, prInfo, localRuns: 0, next: passingRun };
  w.deps = {
    ...cli.defaultDeps(),
    git: GIT,
    env: {},
    prInfo,
    ghApi,
    postStatus: gh.postStatus,
    runGate: (options) => {
      w.localRuns += 1;
      return w.next(options);
    },
    acquireGateLock: async () => ({ acquired: true, queuedMs: 0, release() {} }),
    ...deps,
  };
  return w;
}

/** A subcommand through `cli.main`: resolves `{ code, body }` (stdout parsed). */
async function call(sub, payload, w) {
  let out = '';
  const code = await cli.main([sub], { ...w.deps, io: { readJson: () => payload, write: (s) => (out += s) } });
  return { code, body: JSON.parse(out) };
}
const gate = (w, extra, fixture = fx) => call('gate', payloadFor(fixture, extra), w);
const merge = (w, statuses = [], fixture = fx, extra) => call('merge', payloadFor(fixture, { statuses, ...extra }), w);
const gh = (state, over) => ({ context: CONTEXT, state, description: 'x', ...over });
/** A success a passing gate would have posted: its record verifies for this fixture. */
const verifiedOk = () => gh('success', { description: W.verifiedDescription(fx) });

/* ------------------------------------------------------------------------------------------- D1 */

describe('D1. every head-bound refusal of a local run publishes a failure status; a transient one publishes nothing', () => {
  const cases = [
    ['clone-tampered', { kind: 'clone-tampered', step: 'test', node: 22 }, `ci-local refused (clone-tampered): node 22 / test @ ${SHA8}`],
    ['unexpected-output', { kind: 'unexpected-output', step: 'test', node: 24 }, `ci-local refused (unexpected-output): node 24 / test @ ${SHA8}`],
    ['unreadable-workflow', { kind: 'unreadable-workflow', step: '.github/workflows/test.yml' }, `ci-local refused (unreadable-workflow): .github/workflows/test.yml @ ${SHA8}`],
    ['clone-moved', { kind: 'clone-moved' }, `ci-local refused (clone-moved): clean clone @ ${SHA8}`],
    ['clone-config-changed', { kind: 'clone-config-changed' }, `ci-local refused (clone-config-changed): clean clone @ ${SHA8}`],
    ['runner-error', { kind: 'runner-error' }, `ci-local refused (runner-error): clean clone @ ${SHA8}`],
    ['an unknown future kind', { kind: 'brand-new-kind', step: 's', node: 22 }, `ci-local refused (brand-new-kind): node 22 / s @ ${SHA8}`],
  ];

  it.each(cases)('%s: a forceLocal gate posts the pending and then exactly one failure; merge is then refused with green hosted CI; the next gate runs locally', async (_n, failure, description) => {
    const w = world();
    w.next = () => refusedRun(failure);

    const first = await gate(w, { forceLocal: true });
    expect(first.body).toMatchObject({ ok: false, stage: 'run', posted: true, mergeReady: false });
    expect(w.gh.posts).toHaveLength(2);
    expect(w.gh.posts[0]).toEqual({ repo: REPO, sha: HEAD, state: 'pending', context: CONTEXT, description: `ci-local running @ ${SHA8}` });
    expect(w.gh.posts[1]).toEqual({ repo: REPO, sha: HEAD, state: 'failure', context: CONTEXT, description });

    // what the probe showed: GitHub now holds the failure; the merge payload may well not (statuses [])
    const m = await merge(w, []);
    expect(m.body).toMatchObject({ ok: false, mergeReady: false, hostedRefused: true, localFailure: true });
    expect(m.body.source).toBeUndefined();
    expect(m.body.reason).toContain(`the local gate recorded failure for ${CONTEXT} on ${HEAD}`);
    expect(m.body.reason).toContain('re-run the gate with forceLocal:true');

    const second = await gate(w);
    expect(second.body.stage).toBe('run');
    expect(second.body.source).toBeUndefined();
    expect(second.body.hostedRefused).toContain(`the local gate recorded failure for ${CONTEXT} on ${HEAD}`);
    expect(w.localRuns).toBe(2); // the local run is repeated, hosted CI did not stand in
  });

  it('step-failed keeps today\'s description exactly', async () => {
    const w = world();
    w.next = () => refusedRun({ kind: 'step-failed', step: 'test', node: 22 });
    await gate(w, { forceLocal: true });
    expect(w.gh.posts.map((p) => [p.state, p.description])).toEqual([['pending', `ci-local running @ ${SHA8}`], ['failure', `ci-local failed: local-ci steps / node 22 / test @ ${SHA8}`]]);
    expect((await merge(w, [])).body).toMatchObject({ ok: false, localFailure: true });
    expect((await gate(w)).body.stage).toBe('run');
  });

  it('unsupported-step keeps today\'s description exactly', async () => {
    const w = world();
    w.next = () => ({ ...refusedRun({ kind: 'unmirrored-step', step: 'Upload' }), unmirrored: [{ workflow: TEST, job: 'test', step: 'Upload', reason: 'not mirrored' }] });
    const r = await gate(w, { forceLocal: true });
    expect(r.body.failures.map((f) => f.kind)).toEqual(['unsupported-step']);
    expect(w.gh.posts.map((p) => [p.state, p.description])).toEqual([['pending', `ci-local running @ ${SHA8}`], ['failure', `ci-local failed: ${TEST} / test / Upload @ ${SHA8}`]]);
    expect((await merge(w, [])).body).toMatchObject({ ok: false, localFailure: true });
    expect((await gate(w)).body.stage).toBe('run');
  });

  // Replaced: this pinned "a transient kind posts nothing and hosted CI still stands in". The pending written ahead of the
  // run now stays (availability, not safety) and vetoes hosted acceptance until a forceLocal run passes.
  it.each(['node-version', 'unfetchable-head', 'prerequisite', 'secrets', 'cleanup', 'invalid-input'])(
    '%s is transient: no failure is posted, the pending stays and vetoes merge and gate until a forced local run passes',
    async (kind) => {
      const w = world();
      w.next = () => refusedRun({ kind, step: 'git', node: null });
      const first = await gate(w, { forceLocal: true });
      expect(first.body).toMatchObject({ ok: false, stage: 'run', posted: false, pendingRemains: true });
      expect(w.gh.posts.map((p) => p.state)).toEqual(['pending']);
      expect((await merge(w, [])).body).toMatchObject({ ok: false, hostedRefused: true, localFailure: true });
      expect((await gate(w)).body.stage).toBe('run');
      w.next = passingRun;
      expect((await gate(w, { forceLocal: true })).body).toMatchObject({ ok: true, stage: 'attest', posted: true });
      expect((await merge(w, [])).body).toMatchObject({ ok: true, mergeReady: true, source: 'hosted' });
      expect((await gate(w)).body).toMatchObject({ ok: true, stage: 'hosted', source: 'hosted' });
    }
  );

  it('mixed: a transient failure listed first and a head-bound one after it: the head-bound one is posted', async () => {
    const w = world();
    w.next = () => ({ ...refusedRun({ kind: 'node-version', node: 24 }), failures: [
      { kind: 'node-version', step: null, node: 24, sha: HEAD, message: 'no node' },
      { kind: 'clone-tampered', step: null, node: null, sha: HEAD, message: 'tampered' },
      { kind: 'step-failed', step: 'test', node: 22, sha: HEAD, message: 'red' },
    ] });
    await gate(w, { forceLocal: true });
    expect(w.gh.posts.map((p) => p.state)).toEqual(['pending', 'failure']);
    expect(w.gh.posts[1]).toMatchObject({ state: 'failure', description: `ci-local refused (clone-tampered): clean clone @ ${SHA8}` });
    expect((await merge(w, [])).body).toMatchObject({ ok: false, localFailure: true });
  });

  it('a dry run posts nothing, whatever the kind', async () => {
    const w = world();
    w.next = () => refusedRun({ kind: 'clone-tampered' });
    const r = await gate(w, { forceLocal: true, dryRun: true });
    expect(r.body).toMatchObject({ ok: false, posted: false, dryRun: true });
    expect(w.gh.posts).toEqual([]);
    expect((await merge(w, [])).body).toMatchObject({ ok: true, source: 'hosted' });
  });

  // Replaced: this pinned "a refusal that lists no failure posts nothing (and does not veto)". It still posts no failure, but
  // the write-ahead pending stays and vetoes (nothing was recorded about the head, so fail closed).
  it('a refusal that lists no failure posts no failure: the pending stays and vetoes', async () => {
    const w = world();
    w.next = () => ({ ok: false, sha: HEAD, failures: [], unmirrored: [], nodes: [], error: 'boom' });
    const r = await gate(w, { forceLocal: true });
    expect(r.body).toMatchObject({ ok: false, posted: false, pendingRemains: true });
    expect(w.gh.posts.map((p) => p.state)).toEqual(['pending']);
    expect((await merge(w, [])).body).toMatchObject({ ok: false, localFailure: true, hostedRefused: true });
  });

  it('the description is clipped like today\'s (no more than the status limit)', async () => {
    const w = world();
    w.next = () => refusedRun({ kind: 'clone-tampered', step: 's'.repeat(300), node: 22 });
    await gate(w, { forceLocal: true });
    expect(w.gh.posts[1].description.length).toBeLessThanOrEqual(100);
    expect(w.gh.posts[1].description.startsWith('ci-local refused (clone-tampered): node 22 / sss')).toBe(true);
  });

  it('a later forceLocal PASS posts success, which supersedes the failure: merge accepts the verified local status and a plain gate accepts hosted again', async () => {
    const w = world();
    w.next = () => refusedRun({ kind: 'clone-moved' });
    await gate(w, { forceLocal: true });
    expect((await merge(w, [])).body).toMatchObject({ ok: false, localFailure: true });

    w.next = passingRun;
    const pass = await gate(w, { forceLocal: true });
    expect(pass.body).toMatchObject({ ok: true, stage: 'attest', posted: true });
    expect(w.gh.store.map((s) => s.state)).toEqual(['success', 'pending', 'failure', 'pending']); // newest first: each run wrote ahead

    const verified = await merge(w, w.gh.store); // the local success verifies, no hosted needed
    expect(verified.body).toMatchObject({ ok: true, mergeReady: true });
    expect(verified.body.source).toBeUndefined();
    const hosted = await merge(w, []); // with no payload statuses hosted stands in: GitHub's latest is success
    expect(hosted.body).toMatchObject({ ok: true, source: 'hosted' });
    expect((await gate(w)).body).toMatchObject({ ok: true, stage: 'hosted', source: 'hosted' });
  });

  it('REAL runner: a step that tampers with a tracked file makes the runner itself return clone-tampered; that refusal is posted and vetoes', async () => {
    const w = world();
    const tamper = { status: 0, stdout: '', stderr: '' };
    w.deps.runnerDeps = {
      resolveNodeBinDir: (major) => `/fake/node${major}/bin`,
      run: (cmd, o) => {
        if (cmd === 'node --version') return { status: 0, stdout: `v${/node(\d+)/.exec(o.env.PATH)[1]}.0.0\n`, stderr: '' };
        if (cmd === 'npm run validate') spawnSync('bash', ['-c', 'echo tampered >> README.md'], { cwd: o.cwd });
        return { ...tamper };
      },
    };
    w.deps.runGate = (options, injected) => {
      w.localRuns += 1;
      return realRunGate(options, injected);
    };
    const r = await gate(w, { forceLocal: true });
    expect(r.body.failures.map((f) => f.kind)).toEqual(['clone-tampered']);
    expect(r.body).toMatchObject({ ok: false, posted: true });
    expect(w.gh.posts.map((p) => p.state)).toEqual(['pending', 'failure']);
    expect(w.gh.posts[1]).toMatchObject({ state: 'failure', description: `ci-local refused (clone-tampered): clean clone @ ${SHA8}` });
    expect((await merge(w, [])).body).toMatchObject({ ok: false, localFailure: true, hostedRefused: true });
    const again = await gate(w);
    expect(again.body.stage).toBe('run');
    expect(again.body.hostedRefused).toContain('the local gate recorded failure');
    expect(w.localRuns).toBe(2);
  });
});

/* ------------------------------------------------------------------------------------------- D2 */

describe('D2. one veto rule, read from GitHub by merge and by gate, after verifyHosted', () => {
  it.each(['failure', 'error'])('merge: a %s on GitHub with a payload that carries nothing is refused (the payload cannot hide it)', async (state) => {
    const w = world({ initial: [gh(state, { sha: HEAD })] });
    const r = await merge(w, []);
    expect(r.code).toBe(1);
    expect(r.body).toMatchObject({ ok: false, mergeReady: false, hostedRefused: true, localFailure: true });
    expect(r.body.source).toBeUndefined();
    expect(r.body.reason).toContain(`the local gate recorded ${state} for ${CONTEXT} on ${HEAD}`);
    expect(w.prInfo.calls).toHaveLength(1); // refused before the PR re-read
  });

  it('merge: the same through a real process with a fake gh (veto-probe B)', () => {
    const dir = H.fakeGhActionsDir({ pr: { baseRefName: BASE_BRANCH, headRefOid: HEAD, state: 'OPEN' }, entries: H.honest(HEAD), head: HEAD, statuses: [gh('failure')] });
    const r = spawnSync(process.execPath, [CLI_PATH, 'merge'], {
      input: JSON.stringify({ ...payloadFor(fx), statuses: [] }),
      encoding: 'utf8',
      env: { ...process.env, PATH: `${dir}${path.delimiter}${process.env.PATH}`, ENSEMBLE_LOCAL_CI_LOCK_DIR: tmpDir() },
    });
    expect(r.status).toBe(1);
    expect(JSON.parse(r.stdout)).toMatchObject({ ok: false, mergeReady: false, hostedRefused: true, localFailure: true });
    const asked = H.ghInvocations(dir).filter((argv) => argv[0] === 'api').map((argv) => argv[1]);
    expect(asked[asked.length - 1]).toBe(`repos/${REPO}/commits/${HEAD}/statuses?per_page=100`);
  });

  it('merge: with no failure anywhere hosted is accepted, and the statuses were read after the Actions lookups and before the PR re-read', async () => {
    const w = world();
    const r = await merge(w, []);
    expect(r.body).toMatchObject({ ok: true, mergeReady: true, source: 'hosted' });
    expect(r.body.localFailure).toBeUndefined();
    expect(w.ghApi.calls.map((p) => p.replace(/^repos\/[^/]+\/[^/]+\//, ''))).toEqual([
      `actions/runs?head_sha=${HEAD}&per_page=100`,
      'actions/runs/101/jobs?filter=latest&per_page=100',
      'actions/runs/102/jobs?filter=latest&per_page=100',
      'actions/runs/103/jobs?filter=latest&per_page=100',
      `commits/${HEAD}/statuses?per_page=100`,
    ]);
    expect(w.prInfo.calls).toHaveLength(2);
  });

  it.each([
    ['the lookup fails', { answer: (p, proceed) => (/\/statuses\?/.test(p) ? { ok: false, error: 'gh api failed: HTTP 502' } : proceed()) }],
    ['the answer is not a list', { answer: (p, proceed) => (/\/statuses\?/.test(p) ? { ok: true, json: { state: 'success' } } : proceed()) }],
    ['there is no answer at all', { answer: (p, proceed) => (/\/statuses\?/.test(p) ? undefined : proceed()) }],
  ])('merge: unreadable statuses (%s) refuse hosted acceptance (fail closed) but are not a recorded failure', async (_n, api) => {
    const w = world({ api });
    const r = await merge(w, []);
    expect(r.body).toMatchObject({ ok: false, mergeReady: false, hostedRefused: true });
    expect(r.body.localFailure).toBeUndefined();
    expect(r.body.reason).toContain('cannot read the commit statuses');
    expect(w.prInfo.calls).toHaveLength(1);
  });

  // Replaced rows (round 3 -> round 5): "success after an old failure" for ANY success, and "pending on top of ..." not vetoing.
  // A success clears only with a record that verifies; a pending latest status is a run that did not finish and vetoes.
  it.each([
    ['a VERIFIED success after an old failure', [verifiedOk(), gh('failure')], true],
    ['an UNVERIFIED success after an old failure', [gh('success'), gh('failure')], false],
    ['failure after an old success', [gh('failure'), verifiedOk()], false],
    ['error after an old success', [gh('error'), verifiedOk()], false],
    ['pending on top of an old failure (a run that did not finish)', [gh('pending'), gh('failure')], false],
    ['pending on top of an old verified success', [gh('pending'), verifiedOk()], false],
    ['a failure of ANOTHER context', [gh('failure', { context: 'some/other-check' })], true],
    ['another context\'s failure on top of our verified success', [gh('failure', { context: 'some/other-check' }), verifiedOk()], true],
    ['another context\'s success on top of our failure', [gh('success', { context: 'some/other-check' }), gh('failure')], false],
    ['the context in other letters (failure)', [gh('failure', { context: CONTEXT.toUpperCase() })], false],
    ['the context in other letters (verified success on top of failure)', [{ ...verifiedOk(), context: CONTEXT.toUpperCase() }, gh('failure')], true],
  ])('latest wins, merge and gate agree: %s', async (_n, initial, accepted) => {
    const wm = world({ initial });
    const m = await merge(wm, []);
    expect(m.body.ok).toBe(accepted);
    if (accepted) expect(m.body.source).toBe('hosted');
    else expect(m.body).toMatchObject({ hostedRefused: true, localFailure: true });

    const wg = world({ initial });
    const g = await gate(wg);
    expect(g.body.stage === 'hosted').toBe(accepted);
    expect(wg.localRuns).toBe(accepted ? 0 : 1);
    if (!accepted) expect(g.body.hostedRefused).toMatch(/^hosted CI not accepted: /);
  });

  it.each([
    ['an unknown text state', 'weird'],
    ['a state that is not text', 5],
    ['a missing state', undefined],
    ['the empty state', ''],
  ])('%s as the latest status vetoes (fail closed), in merge and in gate', async (_n, state) => {
    const initial = [{ context: CONTEXT, state, description: 'x' }, gh('success')];
    const m = await merge(world({ initial }), []);
    expect(m.body).toMatchObject({ ok: false, hostedRefused: true, localFailure: true });
    const w = world({ initial });
    const g = await gate(w);
    expect(g.body.stage).not.toBe('hosted');
    expect(g.body.hostedRefused).toMatch(/^hosted CI not accepted: /);
    expect(w.localRuns).toBe(1);
  });

  it('a full page (100) with no entry in our context vetoes: the context may lie beyond it; 99 other entries do not', async () => {
    const page = (n) => Array.from({ length: n }, () => gh('success', { context: 'ci/other' }));
    const wm = world({ initial: page(100) });
    const m = await merge(wm, []);
    expect(m.body).toMatchObject({ ok: false, hostedRefused: true });
    expect(m.body.localFailure).toBeUndefined(); // judged, not recorded
    expect(m.body.reason).toContain('hold none in');
    const wg = world({ initial: page(100) });
    expect((await gate(wg)).body.stage).not.toBe('hosted');
    expect(wg.localRuns).toBe(1);

    expect((await merge(world({ initial: page(99) }), [])).body).toMatchObject({ ok: true, source: 'hosted' });
    expect((await gate(world({ initial: page(99) }))).body.stage).toBe('hosted');
    // a full page that DOES hold our context decides by it (a success only if its record verifies)
    expect((await merge(world({ initial: [...page(99), verifiedOk()] }), [])).body).toMatchObject({ ok: true, source: 'hosted' });
    expect((await merge(world({ initial: [...page(99), gh('failure')] }), [])).body).toMatchObject({ ok: false, localFailure: true });
  });

  it('the payload\'s statuses do not decide the veto: an older payload success cannot hide a newer GitHub failure that fails to verify', async () => {
    const w = world({ initial: [gh('failure')] });
    const r = await merge(w, [{ context: CONTEXT, state: 'success', description: 'not a record', sha: HEAD }]);
    expect(r.body).toMatchObject({ ok: false, hostedRefused: true, localFailure: true });
  });
});

/* ------------------------------------------------------------------------------------------- D3 */

describe('D3. a payload failure that names no usable commit cannot be attributed to another commit', () => {
  it.each([
    ['no sha', undefined],
    ['a malformed sha', 'abc123'],
    ['a sha that is not text', 42],
    ['an empty sha', ''],
  ])('merge: a failure status with %s vetoes hosted acceptance even when GitHub holds nothing', async (_n, sha) => {
    const w = world();
    const status = { context: CONTEXT, state: 'failure', description: 'x', ...(sha === undefined ? {} : { sha }) };
    const r = await merge(w, [status]);
    expect(r.body).toMatchObject({ ok: false, mergeReady: false, hostedRefused: true, localFailure: true });
    expect(r.body.reason).toContain('carries no usable commit SHA');
    expect(w.prInfo.calls).toHaveLength(1);
  });

  it('merge: an error status with no sha vetoes too', async () => {
    const r = await merge(world(), [{ context: CONTEXT, state: 'error', description: 'x' }]);
    expect(r.body).toMatchObject({ ok: false, localFailure: true });
  });

  it('merge: a failure on ANOTHER full commit does not veto', async () => {
    const r = await merge(world(), [{ context: CONTEXT, state: 'failure', description: 'x', sha: OTHER }]);
    expect(r.body).toMatchObject({ ok: true, source: 'hosted' });
  });

  it('merge: a failure with no sha in ANOTHER context does not veto', async () => {
    const r = await merge(world(), [{ context: 'some/other-check', state: 'failure', description: 'x' }]);
    expect(r.body).toMatchObject({ ok: true, source: 'hosted' });
  });
});

/* ------------------------------------------------------------------------------------------- D4 */

describe('D4. a run bound to this pull request with a malformed id is refused, never dropped', () => {
  const where = { headSha: fx.headSha, baseSha: fx.baseSha, repoRoot: fx.dir };
  const verify = (entries) => verifyHosted({ repo: REPO, ...where, pr: PR, baseRefName: BASE_BRANCH, approvalSet: H.APPROVAL_SET }, { git: GIT, ghApi: H.actionsApi(entries) });
  const redNewer = (id, over = {}) => H.hostedRun(999, TEST, ['test (22)', 'test (24)'], HEAD, { run: { id, conclusion: 'failure', ...over }, job: { conclusion: 'failure' } });

  it.each([
    ['a string', '999'],
    ['null', null],
    ['a float', 999.5],
    ['missing', undefined],
  ])('a newer pull_request run with an id that is %s beside an older green run is refused, naming the file and the id', (_n, id) => {
    const r = verify([...H.honest(HEAD), redNewer(id)]);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/^hosted CI not accepted: a pull_request run of /);
    expect(r.reason).toContain(TEST);
    expect(r.reason).toContain('malformed id');
    if (id !== undefined) expect(r.reason).toContain(`(${JSON.stringify(id)})`);
    expect(r.reason).toContain('rather than ignoring it');
  });

  it('a bound push run with a malformed id is refused too', () => {
    const r = verify([...H.honest(HEAD), redNewer('x', { event: 'push' })]);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('a push run of');
    expect(r.reason).toContain('malformed id ("x")');
  });

  it('merge through the CLI: the probe E scenario is refused', async () => {
    const w = world({ entries: [...H.honest(HEAD), redNewer('999')] });
    const r = await merge(w, []);
    expect(r.body).toMatchObject({ ok: false, mergeReady: false, hostedRefused: true });
    expect(r.body.reason).toContain('malformed id');
  });

  it('an UNBOUND run with a malformed id stays ignored (another PR, another base, no pull_requests)', () => {
    for (const bound of [[{ number: 9, base: { ref: BASE_BRANCH } }], [{ number: PR, base: { ref: 'other-base' } }], []]) {
      const r = verify([...H.honest(HEAD), redNewer('999', { pull_requests: bound })]);
      expect(r.ok).toBe(true);
    }
  });

  it('a malformed-id run of a workflow that is not required is ignored', () => {
    const stray = H.hostedRun(5, '.github/workflows/other.yml', ['x'], HEAD, { run: { id: 'five' } });
    expect(verify([...H.honest(HEAD), stray]).ok).toBe(true);
  });

  it('positive control: the honest listing is accepted', () => {
    expect(verify(H.honest(HEAD))).toMatchObject({ ok: true, jobs: H.VERIFIED });
  });
});

/* ------------------------------------------------------------------------------------------- D5 */

describe('D5. static checks of a required job and its needs closure', () => {
  const job = (body) => `    runs-on: ubuntu-latest\n${body}`;
  const steps = (...items) => `    steps:\n${items.map((i) => `      - ${i}`).join('\n')}\n`;
  const workflow = (jobsText, header = 'name: validate\non:\n  pull_request:\n  push:\n    branches: [main, dev]\n') => `${header}jobs:\n${jobsText}`;
  const verifyText = (text, names = ['validate']) => {
    const fixture = H.hostedRepo({ files: { [VALIDATE]: text } });
    // hosted CI ran the head's jobs of this workflow text: `names` are the jobs in the run listing (a needed job must be there too)
    const entries = H.swap(H.honest(fixture.headSha, { [VALIDATE]: text }), VALIDATE, () => H.hostedRun(101, VALIDATE, names, fixture.headSha, { workflow: text }));
    const ghApi = H.actionsApi(entries);
    const r = verifyHosted({ repo: REPO, headSha: fixture.headSha, baseSha: fixture.baseSha, repoRoot: fixture.dir, pr: PR, baseRefName: BASE_BRANCH, approvalSet: H.APPROVAL_SET }, { git: GIT, ghApi });
    return { r, ghApi };
  };
  const refuses = (text, ...causes) => {
    const { r, ghApi } = verifyText(text);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/^hosted CI not accepted: /);
    expect(r.reason).toContain(VALIDATE);
    for (const c of causes) expect(r.reason).toContain(c);
    expect(ghApi.calls).toEqual([]); // before any GitHub call
  };
  const accepts = (text, names) => expect(verifyText(text, names).r.ok).toBe(true);
  const checkout = 'uses: actions/checkout@v6';
  const run = 'run: npm run validate';

  describe('(a) a repo-local uses reached only through needs', () => {
    it('a job-level reusable workflow in a needed job', () => {
      refuses(
        workflow(`  setup:\n    uses: ./.github/workflows/reusable.yml\n  validate:\n    needs: setup\n${job(steps(checkout, run))}`),
        'job "setup"', 'required job "validate" needs', 'repo-local action or reusable workflow', './.github/workflows/reusable.yml'
      );
    });
    it('a step-level local action in a needed job (needs as a list)', () => {
      refuses(
        workflow(`  setup:\n${job(steps('uses: ./.github/actions/setup'))}  validate:\n    needs: [lint, setup]\n${job(steps(checkout, run))}  lint:\n${job(steps(checkout))}`),
        'job "setup"', './.github/actions/setup'
      );
    });
    it('a transitive chain: validate needs b, b needs c, c uses a local action', () => {
      refuses(
        workflow(`  c:\n${job(steps('uses: ./.github/actions/deep'))}  b:\n    needs: c\n${job(steps(checkout))}  validate:\n    needs: b\n${job(steps(checkout, run))}`),
        'job "c"', './.github/actions/deep'
      );
    });
    it('positive controls: a needs chain of external actions, and a cycle, are accepted (the needed jobs are in the run listing)', () => {
      accepts(workflow(`  c:\n${job(steps(checkout))}  b:\n    needs: c\n${job(steps('uses: actions/setup-node@v6'))}  validate:\n    needs: [b]\n${job(steps(checkout, run))}`), ['c', 'b', 'validate']);
      accepts(workflow(`  a:\n    needs: b\n${job(steps(checkout))}  b:\n    needs: a\n${job(steps(checkout))}  validate:\n    needs: a\n${job(steps(checkout, run))}`), ['a', 'b', 'validate']);
    });
    it('a local action in a job that is NOT in the closure is still fine', () => {
      accepts(workflow(`  other:\n${job(steps('uses: ./.github/actions/x'))}  validate:\n${job(steps(checkout, run))}`));
    });
  });

  describe('(b) continue-on-error other than literal false', () => {
    it.each([
      ['true at job level', `  validate:\n    continue-on-error: true\n${job(steps(checkout, run))}`, 'job'],
      ['"true" at job level', `  validate:\n    continue-on-error: 'true'\n${job(steps(checkout, run))}`, 'job'],
      ['an expression at job level', `  validate:\n    continue-on-error: \${{ matrix.experimental }}\n${job(steps(checkout, run))}`, 'job'],
      ['true at step level', `  validate:\n${job(steps(checkout, `${run}\n        continue-on-error: true`))}`, 'step 2'],
      ['"true" at step level', `  validate:\n${job(steps(checkout, `${run}\n        continue-on-error: 'true'`))}`, 'step 2'],
      ['an expression at step level', `  validate:\n${job(steps(checkout, `${run}\n        continue-on-error: \${{ github.ref != 'x' }}`))}`, 'step 2'],
      ['true in a needed job', `  setup:\n    continue-on-error: true\n${job(steps(checkout))}  validate:\n    needs: setup\n${job(steps(checkout, run))}`, 'job "setup"'],
    ])('%s is refused', (_n, jobsText, where) => {
      refuses(workflow(jobsText), 'continue-on-error', where);
    });
    it('positive control: continue-on-error: false (job and step) is accepted', () => {
      accepts(workflow(`  validate:\n    continue-on-error: false\n${job(steps(checkout, `${run}\n        continue-on-error: false`))}`));
    });
  });

  describe('(c) an if: that reads a PR-controlled context', () => {
    it.each([
      ['github.head_ref at job level', `  validate:\n    if: github.head_ref != 'skip'\n${job(steps(checkout, run))}`],
      ['github.event.pull_request.title at step level', `  validate:\n${job(steps(checkout, `${run}\n        if: \${{ !contains(github.event.pull_request.title, 'wip') }}`))}`],
      ['github.actor at step level', `  validate:\n${job(steps(checkout, `${run}\n        if: github.actor != 'mallory'`))}`],
      ['github.triggering_actor at job level', `  validate:\n    if: github.triggering_actor != 'x'\n${job(steps(checkout, run))}`],
      ['github.event in a needed job', `  setup:\n    if: github.event_name == 'pull_request' && github.event.action != 'x'\n${job(steps(checkout))}  validate:\n    needs: setup\n${job(steps(checkout, run))}`],
    ])('%s is refused', (_n, jobsText) => {
      refuses(workflow(jobsText), 'PR-controlled context');
    });
    it('positive controls: an if: on matrix or env values only is accepted', () => {
      accepts(workflow(`  validate:\n    env:\n      FOO: x\n${job(steps(checkout, `${run}\n        if: matrix.node-version == 24`, `run: echo\n        if: env.FOO == 'x' && github.ref == 'refs/heads/main'`))}`));
    });
  });

  it('through the CLI: merge is refused with the named reason', async () => {
    const fixture = H.hostedRepo({ files: { [VALIDATE]: workflow(`  validate:\n    continue-on-error: true\n${job(steps(checkout, run))}`) } });
    const w = world({ entries: H.honest(fixture.headSha), fixture });
    const r = await call('merge', payloadFor(fixture, { statuses: [] }), w);
    expect(r.body).toMatchObject({ ok: false, mergeReady: false, hostedRefused: true });
    expect(r.body.reason).toContain('continue-on-error');
  });

  it('the REAL required workflows of this repository (validate, test, generated-drift) pass the static checks', () => {
    const dir = path.join(__dirname, '..', '..', '..', '.github', 'workflows');
    const files = Object.fromEntries([VALIDATE, TEST, DRIFT].map((f) => [f, fs.readFileSync(path.join(dir, path.basename(f)), 'utf8')]));
    const fixture = H.hostedRepo({ files });
    const r = verifyHosted(
      { repo: REPO, headSha: fixture.headSha, baseSha: fixture.baseSha, repoRoot: fixture.dir, pr: PR, baseRefName: BASE_BRANCH, approvalSet: H.APPROVAL_SET },
      { git: GIT, ghApi: H.actionsApi(H.honest(fixture.headSha, files)) }
    );
    expect(r).toMatchObject({ ok: true, jobs: H.VERIFIED });
  });
});
