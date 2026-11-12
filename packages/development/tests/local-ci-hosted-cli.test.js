'use strict';

/**
 * Hosted-CI reuse through the CLI entry points (fwj0): merge, gate and main with injected deps, plus a few runs of the
 * real process. GitHub is a fake: `prInfo` answers the PR identity, `ghApi` the Actions lookups. The runner result and
 * the status publisher are fakes too. Real: git, the temp repos, the config validator, verifyHosted, the status record.
 * What is proved is the ORDER and the TRUST: the PR identity and the config come first, a verified local status wins
 * without any lookup, hosted CI is only read from GitHub (never from the payload), and nothing is posted for it.
 */

const path = require('path');
const { spawnSync } = require('child_process');

const cli = require('../lib/local-ci-cli');
const { buildRecord } = require('../lib/local-ci-record');
const { cleanupBaseRepos, prInfoFor, fakePostStatus, CONFIG_PATH } = require('./helpers/local-ci-base-repo');
const H = require('./helpers/local-ci-hosted');

afterAll(() => {
  cleanupBaseRepos();
  H.cleanupHostedFixtures();
});

const { REPO, PR, CONTEXT, VALIDATE, TEST } = H;
const OTHER = 'c'.repeat(40);
const GIT = H.memoGit();

const passingRun = (sha) => ({ ok: true, sha, failures: [], unmirrored: [], nodes: [{ node: 22, ok: true, steps: [] }, { node: 24, ok: true, steps: [] }] });
const failingRun = (options) => ({
  ok: false,
  sha: options.headSha,
  failures: [{ kind: 'step-failed', step: 'test', node: 22, sha: options.headSha, message: 'boom' }],
  unmirrored: [],
  nodes: [{ node: 22, ok: false, steps: [] }],
});

/** Deps for one repo: fake GitHub (PR identity + Actions answers), fake publisher, injected runner result; real git. */
function makeDeps(repo, { entries = H.honest(repo.headSha), api, deps = {}, runGate } = {}) {
  const post = fakePostStatus();
  const run = jest.fn(runGate || ((options) => passingRun(options.headSha)));
  const ghApi = H.actionsApi(entries, api);
  return { deps: { ...cli.defaultDeps(), git: GIT, postStatus: post, runGate: run, env: {}, prInfo: prInfoFor(repo), ghApi, ...deps }, post, runGate: run, ghApi };
}
const gatePayload = (repo, extra) => ({ repoRoot: repo.dir, headSha: repo.headSha, baseRef: repo.baseRef, repo: REPO, pr: PR, ...extra });
const mergePayload = (repo, extra) => ({ ...gatePayload(repo), statuses: [], ...extra });
const redTest = (head) => H.swap(H.honest(head), TEST, (e) => H.withJob(e, 'test (24)', { conclusion: 'failure' }));

const fx = H.hostedRepo(); //                                      opted in to hosted reuse
const plain = H.hostedRepo({ config: H.CONFIG_WITHOUT_HOSTED }); // the same config without the opt-in
const forged = H.hostedRepo({ headFiles: { [VALIDATE]: H.WORKFLOW_FILES[VALIDATE].replace('npm run validate', 'true') } }); // the PR rewrote validate.yml
const HEAD = fx.headSha;

describe('merge: a verified local status wins; otherwise hosted CI verified on the head', () => {
  const trustedBlob = fx.git('rev-parse', `${fx.baseRef}:${CONFIG_PATH}`);
  const localStatus = (over) => ({
    context: CONTEXT,
    state: 'success',
    sha: HEAD,
    description: buildRecord({ runnerBlobSha: trustedBlob, workflowSet: [VALIDATE, TEST], log: 'run' }).description,
    ...over,
  });
  const noStatusReason = `no local CI status (${CONTEXT}) found: the local gate has not run for ${HEAD}`;

  it('(a) no local status but hosted CI green on the head: merge-ready, source hosted, with the verified jobs', () => {
    const { deps, ghApi } = makeDeps(fx);
    expect(cli.runMerge(mergePayload(fx), deps)).toEqual({ ok: true, mergeReady: true, headSha: HEAD, source: 'hosted', hostedJobs: H.VERIFIED, hostedCiWaitRequired: false });
    expect(ghApi.calls).toHaveLength(5); // runs, three job listings, then the commit statuses (the veto is read from GitHub)
  });

  it('(a) through main: exit 0 and the verdict on stdout', async () => {
    const { deps } = makeDeps(fx);
    let out = '';
    const code = await cli.main(['merge'], { ...deps, io: { readJson: () => mergePayload(fx), write: (s) => (out += s) } });
    expect(code).toBe(0);
    expect(JSON.parse(out)).toMatchObject({ ok: true, mergeReady: true, source: 'hosted', headSha: HEAD });
  });

  it.each([
    ['a moved head', { headRefOid: OTHER }, /not the current head of pull request #7/],
    ['a base branch the author chose', { baseRefName: 'feature-x' }, /not the base branch of pull request #7/],
    ['a merged pull request', { state: 'MERGED' }, /not OPEN/],
    ['a closed pull request', { state: 'CLOSED' }, /not OPEN/],
    ['a failed PR lookup', { error: 'HTTP 404' }, /cannot verify pull request #7/],
  ])('(b) %s is refused by the PR identity check BEFORE hosted CI is consulted', (_n, answer, cause) => {
    // hosted CI is green for the head the caller names: a verdict reached through it would be wrong
    const { deps, ghApi } = makeDeps(fx, { deps: { prInfo: prInfoFor(fx, answer) } });
    const r = cli.runMerge(mergePayload(fx), deps);
    expect(r).toMatchObject({ ok: false, mergeReady: false });
    expect(r.reason).toMatch(cause);
    expect(r.source).toBeUndefined();
    expect(ghApi.calls).toEqual([]);
  });

  it('(b) no PR lookup at all is a refusal as well, and GitHub Actions is not consulted', () => {
    const { deps, ghApi } = makeDeps(fx, { deps: { prInfo: undefined } });
    const r = cli.runMerge(mergePayload(fx), deps);
    expect(r.mergeReady).toBe(false);
    expect(r.reason).toMatch(/no GitHub lookup is available/);
    expect(ghApi.calls).toEqual([]);
  });

  it('(c) hosted CI red: refused, and the reason carries BOTH the local reason and the hosted one, local first', () => {
    const { deps } = makeDeps(fx, { entries: redTest(HEAD) });
    const r = cli.runMerge(mergePayload(fx), deps);
    const hosted = 'hosted CI not accepted: job "test (24)" of run 102 concluded failure, not success';
    expect(r).toMatchObject({ ok: false, mergeReady: false, headSha: HEAD, missingRun: true, hostedRefused: true });
    expect(r.reason).toContain(noStatusReason);
    expect(r.reason).toContain(hosted);
    expect(r.reason.indexOf(noStatusReason)).toBeLessThan(r.reason.indexOf(hosted));
    expect(r.source).toBeUndefined();
  });

  it('(c) a failed local status plus red hosted CI: both reasons again', () => {
    const { deps } = makeDeps(fx, { entries: redTest(HEAD) });
    const r = cli.runMerge(mergePayload(fx, { statuses: [localStatus({ state: 'failure' })] }), deps);
    expect(r).toMatchObject({ ok: false, mergeReady: false, hostedRefused: true });
    expect(r.reason).toContain(`status on ${HEAD} is failure`);
    expect(r.reason).toContain('job "test (24)" of run 102 concluded failure, not success');
  });

  it('(c) a local record made under another config plus red hosted CI: both reasons', () => {
    const stale = localStatus({ description: buildRecord({ runnerBlobSha: 'deadbeef'.repeat(5), workflowSet: [VALIDATE, TEST], log: 'run' }).description });
    const { deps } = makeDeps(fx, { entries: redTest(HEAD) });
    const r = cli.runMerge(mergePayload(fx, { statuses: [stale] }), deps);
    expect(r).toMatchObject({ ok: false, mergeReady: false, hostedRefused: true });
    expect(r.reason).toContain('deadbeef'); // the local verifier's reason: the record names another config blob
    expect(r.reason).toContain('job "test (24)" of run 102 concluded failure, not success');
  });

  it('(c) hosted CI still running: refused, and the reason says so', () => {
    const entries = H.swap(H.honest(HEAD), TEST, (e) => H.withRun(e, { status: 'in_progress', conclusion: null }));
    const r = cli.runMerge(mergePayload(fx), makeDeps(fx, { entries }).deps);
    expect(r).toMatchObject({ ok: false, mergeReady: false, hostedRefused: true });
    expect(r.reason).toContain(noStatusReason);
    expect(r.reason).toContain(`the latest pull_request run of ${TEST} (102) is in_progress, not completed`);
  });

  it('(c) a PR that rewrote validate.yml: hosted CI is green but refused with both reasons, and GitHub is not asked', () => {
    const { deps, ghApi } = makeDeps(forged);
    const r = cli.runMerge(mergePayload(forged), deps);
    expect(r).toMatchObject({ ok: false, mergeReady: false, hostedRefused: true });
    expect(r.reason).toContain(`no local CI status (${CONTEXT}) found`);
    expect(r.reason).toContain(`${VALIDATE} at the PR head differs from the base ref`);
    expect(ghApi.calls).toEqual([]);
  });

  it('(d) a verified local status still passes WITHOUT asking GitHub Actions, even when hosted CI is red (only the head\'s statuses are read)', () => {
    const { deps, ghApi } = makeDeps(fx, { entries: redTest(HEAD) });
    const r = cli.runMerge(mergePayload(fx, { statuses: [localStatus()] }), deps);
    expect(r).toMatchObject({ ok: true, mergeReady: true, headSha: HEAD, context: CONTEXT, hostedCiWaitRequired: false });
    expect(r.source).toBeUndefined();
    expect(r.hostedJobs).toBeUndefined();
    expect(ghApi.calls).toEqual([`repos/${REPO}/commits/${HEAD}/statuses?per_page=100`]);
  });

  it('a blocking human review refuses even though hosted CI is green, before anything is looked up', () => {
    const reviews = [{ author: { login: 'alice', type: 'User' }, state: 'CHANGES_REQUESTED', submittedAt: '2026-01-01T00:00:00Z' }];
    const { deps, ghApi } = makeDeps(fx);
    const r = cli.runMerge(mergePayload(fx, { reviews }), deps);
    expect(r.mergeReady).toBe(false);
    expect(r.reason).toMatch(/blocked by review/);
    expect(r.reason).toMatch(/alice/);
    expect(ghApi.calls).toEqual([]);
  });

  it('statuses the caller supplies under the hosted job names are not hosted CI', () => {
    const claimed = ['validate', 'test (22)', 'test (24)', 'drift'].map((context) => ({ context, state: 'success', description: 'passed', sha: HEAD }));
    const { deps, ghApi } = makeDeps(fx, { entries: [] }); // GitHub knows no run for the head
    const r = cli.runMerge(mergePayload(fx, { statuses: claimed }), deps);
    expect(r.mergeReady).toBe(false);
    // they are not even our statuses (the configured context is x/local-ci), and hosted CI is what GitHub says it is
    expect(r.reason).toContain(`no local CI status (${CONTEXT}) found: the local gate has not run for ${HEAD}`);
    expect(r.reason).toContain(`no pull_request run of ${VALIDATE} exists for ${HEAD}`);
    expect(ghApi.calls).toHaveLength(1); // the runs lookup, nothing the payload said
  });

  it('no GitHub lookup dependency: hosted CI cannot be read, so the refusal stands (never "no answer, so fine")', () => {
    const { deps } = makeDeps(fx, { deps: { ghApi: undefined } });
    const r = cli.runMerge(mergePayload(fx), deps);
    expect(r).toMatchObject({ ok: false, mergeReady: false, hostedRefused: true });
    expect(r.reason).toContain('no GitHub lookup is available');
  });
});

describe('(e) a base config WITHOUT hosted_reuse behaves exactly as before and never asks GitHub Actions', () => {
  const PLAIN_HEAD = plain.headSha;

  it('merge: the refusal is exactly the pre-change one, although hosted CI is green', () => {
    const { deps, ghApi } = makeDeps(plain);
    expect(cli.runMerge(mergePayload(plain), deps)).toEqual({
      ok: false,
      mergeReady: false,
      headSha: PLAIN_HEAD,
      reason: `no local CI status (${CONTEXT}) found: the local gate has not run for ${PLAIN_HEAD}`,
      missingRun: true,
    });
    expect(ghApi.calls).toEqual([]);
  });

  it('merge: a failed local status refuses with the pre-change reason and no hosted data', () => {
    const { deps, ghApi } = makeDeps(plain);
    const status = { context: CONTEXT, state: 'failure', description: 'ci-local failed', sha: PLAIN_HEAD };
    expect(cli.runMerge(mergePayload(plain, { statuses: [status] }), deps)).toEqual({
      ok: false,
      mergeReady: false,
      headSha: PLAIN_HEAD,
      reason: `status on ${PLAIN_HEAD} is failure`,
      missingRun: true,
    });
    expect(ghApi.calls).toEqual([]);
  });

  it('gate: runs locally as before, reports nothing about hosted CI and never asks GitHub Actions', async () => {
    const { deps, post, runGate, ghApi } = makeDeps(plain);
    const r = await cli.runGateFlow(gatePayload(plain), deps);
    expect(r).toMatchObject({ ok: true, mergeReady: true, posted: true, stage: 'attest' });
    expect(r.hostedRefused).toBeUndefined();
    expect(r.source).toBeUndefined();
    expect(r.ranLocally).toBeUndefined();
    expect(runGate).toHaveBeenCalledTimes(1);
    expect(post.statuses().map((s) => s.body.state)).toEqual(['pending', 'success']);
    expect(ghApi.calls).toEqual([]);
  });

  it('an invalid hosted_reuse block refuses the config on merge and gate: hosted CI is neither consulted nor accepted', async () => {
    const invalid = H.hostedRepo({ config: H.CONFIG.replace('covers: [validate, test]', 'covers: [validate]') });
    const m = makeDeps(invalid);
    const merged = cli.runMerge(mergePayload(invalid), m.deps);
    expect(merged.mergeReady).toBe(false);
    expect(merged.reason).toMatch(/local CI config invalid: .*hosted_reuse\.covers: step "test" is not declared as run by hosted CI/);
    expect(merged.source).toBeUndefined();
    expect(m.ghApi.calls).toEqual([]);

    const g = makeDeps(invalid);
    const gated = await cli.runGateFlow(gatePayload(invalid), g.deps);
    expect(gated).toMatchObject({ ok: false, mergeReady: false, stage: 'config' });
    expect(gated.error).toMatch(/hosted_reuse\.covers: step "test" is not declared/);
    expect(gated.source).toBeUndefined();
    expect(g.ghApi.calls).toEqual([]);
    expect(g.runGate).not.toHaveBeenCalled();
  });
});

describe('gate: hosted CI green on the head replaces the local run', () => {
  it.each([
    ['dryRun false', { dryRun: false }],
    ['no dryRun', {}],
    ['dryRun true', { dryRun: true }],
  ])('(f) %s: nothing is run and nothing is posted, and the report says so', async (_n, extra) => {
    const { deps, post, runGate, ghApi } = makeDeps(fx);
    const r = await cli.runGateFlow(gatePayload(fx, extra), deps);
    expect(r).toEqual({
      ok: true,
      stage: 'hosted',
      headSha: HEAD,
      dryRun: extra.dryRun === true,
      posted: false,
      mergeReady: true,
      failures: [],
      source: 'hosted',
      hostedJobs: H.VERIFIED,
      ranLocally: false,
    });
    expect(runGate).not.toHaveBeenCalled();
    expect(post.calls).toEqual([]);
    expect(ghApi.calls).toHaveLength(5); // the runs, the three job listings and the commit statuses read before accepting
  });

  it('(f) through main: exit 0, stage hosted, nothing run or posted', async () => {
    const { deps, post, runGate } = makeDeps(fx);
    let out = '';
    const code = await cli.main(['gate'], { ...deps, io: { readJson: () => gatePayload(fx, { dryRun: false }), write: (s) => (out += s) } });
    expect(code).toBe(0);
    expect(JSON.parse(out)).toMatchObject({ ok: true, stage: 'hosted', source: 'hosted', ranLocally: false, mergeReady: true });
    expect(runGate).not.toHaveBeenCalled();
    expect(post.calls).toEqual([]);
  });

  it('(f) the PR identity is still checked first: a moved head stops at the config stage and GitHub Actions is not asked', async () => {
    const { deps, ghApi, runGate } = makeDeps(fx, { deps: { prInfo: prInfoFor(fx, { headRefOid: OTHER }) } });
    const r = await cli.runGateFlow(gatePayload(fx), deps);
    expect(r).toMatchObject({ ok: false, mergeReady: false, stage: 'config' });
    expect(r.error).toMatch(/not the current head of pull request #7/);
    expect(r.source).toBeUndefined();
    expect(ghApi.calls).toEqual([]);
    expect(runGate).not.toHaveBeenCalled();
  });
});

describe('gate: hosted CI that is not accepted falls back to the local run, exactly as before', () => {
  it.each([
    ['a red job', { entries: redTest(HEAD) }, 'concluded failure, not success'],
    ['a run still in progress', { entries: H.swap(H.honest(HEAD), TEST, (e) => H.withRun(e, { status: 'in_progress', conclusion: null })) }, 'is in_progress, not completed'],
    ['no run for the head', { entries: [] }, `no pull_request run of ${VALIDATE} exists`],
    ['a failing GitHub lookup', { api: { answer: () => ({ ok: false, error: 'gh api failed: HTTP 502' }) } }, 'cannot read workflow runs'],
    ['no GitHub lookup at all', { deps: { ghApi: undefined } }, 'no GitHub lookup is available'],
  ])('(g) %s: the local run happens, its pass is posted, and the hosted reason is reported', async (_n, setup, cause) => {
    const { deps, post, runGate } = makeDeps(fx, setup);
    const r = await cli.runGateFlow(gatePayload(fx), deps);
    expect(runGate).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ ok: true, mergeReady: true, posted: true, stage: 'attest' });
    expect(r.hostedRefused).toMatch(/^hosted CI not accepted: /);
    expect(r.hostedRefused).toContain(cause);
    expect(r.source).toBeUndefined();
    expect(r.ranLocally).toBeUndefined();
    expect(post.statuses().map((s) => s.body.state)).toEqual(['pending', 'success']);
    expect(post.statuses()[1]).toMatchObject({ sha: HEAD, repo: REPO, body: { state: 'success', context: CONTEXT } });
  });

  it('(g) the runner gets exactly the options a forced local run gets, and only the documented ones', async () => {
    const refusedHosted = makeDeps(fx, { entries: redTest(HEAD) });
    await cli.runGateFlow(gatePayload(fx), refusedHosted.deps);
    const forced = makeDeps(fx);
    await cli.runGateFlow(gatePayload(fx, { forceLocal: true }), forced.deps);
    expect(refusedHosted.runGate.mock.calls[0]).toEqual(forced.runGate.mock.calls[0]);
    const options = refusedHosted.runGate.mock.calls[0][0];
    expect(Object.keys(options).sort()).toEqual(['approvalSet', 'equivalents', 'excludedSteps', 'failureLogDir', 'headSha', 'repoRoot', 'secretNames']);
    expect(options.headSha).toBe(HEAD);
    expect(options.approvalSet.steps.map((s) => s.name)).toEqual(['validate', 'test']);
  });

  it('(g) a hosted refusal does not soften a FAILING local run: the failure is posted and the gate refuses', async () => {
    const { deps, post } = makeDeps(fx, { entries: redTest(HEAD), runGate: failingRun });
    const r = await cli.runGateFlow(gatePayload(fx), deps);
    expect(r).toMatchObject({ ok: false, mergeReady: false, stage: 'run', posted: true });
    expect(r.hostedRefused).toContain('concluded failure');
    expect(post.statuses().map((s) => s.body.state)).toEqual(['pending', 'failure']);
  });

  it('(g) the status that run posts is an ordinary local status: merge accepts it without asking GitHub Actions', async () => {
    const gated = makeDeps(fx, { entries: redTest(HEAD) });
    await cli.runGateFlow(gatePayload(fx), gated.deps);
    const posted = gated.post.statuses().find((p) => p.body.state === 'success');
    expect(gated.post.statuses().map((p) => p.body.state)).toEqual(['pending', 'success']);
    const merging = makeDeps(fx, { entries: redTest(HEAD) });
    const status = { context: posted.body.context, state: posted.body.state, description: posted.body.description, sha: posted.sha };
    const r = cli.runMerge(mergePayload(fx, { statuses: [status] }), merging.deps);
    expect(r).toMatchObject({ ok: true, mergeReady: true, context: CONTEXT });
    expect(r.source).toBeUndefined();
    expect(merging.ghApi.calls).toEqual([`repos/${REPO}/commits/${HEAD}/statuses?per_page=100`]); // only the veto read, no Actions lookup
  });

  it('(g) a PR that rewrote validate.yml is not helped by green hosted CI: the clone run decides', async () => {
    const { deps, runGate, ghApi } = makeDeps(forged);
    const r = await cli.runGateFlow(gatePayload(forged), deps);
    expect(runGate).toHaveBeenCalledTimes(1);
    expect(r.hostedRefused).toContain(`${VALIDATE} at the PR head differs from the base ref`);
    expect(r.source).toBeUndefined();
    expect(ghApi.calls).toEqual([]);
  });
});

describe('gate: forceLocal', () => {
  it('(h) forceLocal:true never consults hosted CI and runs locally, although hosted CI is green', async () => {
    const { deps, post, runGate, ghApi } = makeDeps(fx);
    const r = await cli.runGateFlow(gatePayload(fx, { forceLocal: true }), deps);
    expect(ghApi.calls).toEqual([]);
    expect(runGate).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ ok: true, mergeReady: true, posted: true, stage: 'attest' });
    expect(r.hostedRefused).toBeUndefined();
    expect(r.source).toBeUndefined();
    expect(post.statuses().map((p) => p.body.state)).toEqual(['pending', 'success']);
  });

  it('(h) forceLocal:false is the default: hosted CI is consulted and accepted', async () => {
    const { deps, runGate, ghApi } = makeDeps(fx);
    const r = await cli.runGateFlow(gatePayload(fx, { forceLocal: false }), deps);
    expect(r).toMatchObject({ ok: true, stage: 'hosted', source: 'hosted' });
    expect(runGate).not.toHaveBeenCalled();
    expect(ghApi.calls.length).toBeGreaterThan(0);
  });

  it.each([
    ['the text true', 'true'],
    ['the text false', 'false'],
    ['the number 1', 1],
    ['the number 0', 0],
    ['null', null],
    ['an object', {}],
    ['a list', []],
  ])('(h) forceLocal as %s is rejected; nothing is looked up, run or posted', async (_n, value) => {
    const { deps, post, runGate, ghApi } = makeDeps(fx);
    await expect(cli.runGateFlow(gatePayload(fx, { forceLocal: value }), deps)).rejects.toThrow('gate: forceLocal must be a boolean');
    expect(ghApi.calls).toEqual([]);
    expect(runGate).not.toHaveBeenCalled();
    expect(post.calls).toEqual([]);
  });

  it('(h) forceLocal is a gate option only: merge rejects it as an unknown key', () => {
    const { deps, ghApi } = makeDeps(fx);
    expect(() => cli.runMerge(mergePayload(fx, { forceLocal: true }), deps)).toThrow(/unknown payload key.*"forceLocal"/);
    expect(ghApi.calls).toEqual([]);
  });
});

describe('(i) a payload cannot carry hosted data', () => {
  const HOSTED_KEYS = [
    ['hosted', { ok: true }],
    ['hostedRuns', [{ id: 1, conclusion: 'success' }]],
    ['jobs', [{ name: 'validate', conclusion: 'success' }]],
    ['hostedJobs', H.VERIFIED],
    ['workflow_runs', []],
    ['checks', ['validate']],
    ['hostedCi', true],
    ['source', 'hosted'],
  ];

  it.each(HOSTED_KEYS)('merge rejects the payload key %s before anything is looked up', (key, value) => {
    const { deps, ghApi } = makeDeps(fx);
    expect(() => cli.runMerge(mergePayload(fx, { [key]: value }), deps)).toThrow(new RegExp(`unknown payload key.*"${key}"`));
    expect(deps.prInfo.calls).toEqual([]);
    expect(ghApi.calls).toEqual([]);
  });

  it.each(HOSTED_KEYS)('gate rejects the payload key %s before anything is looked up, run or posted', async (key, value) => {
    const { deps, post, runGate, ghApi } = makeDeps(fx);
    await expect(cli.runGateFlow(gatePayload(fx, { [key]: value }), deps)).rejects.toThrow(new RegExp(`unknown payload key.*"${key}"`));
    expect(deps.prInfo.calls).toEqual([]);
    expect(ghApi.calls).toEqual([]);
    expect(runGate).not.toHaveBeenCalled();
    expect(post.calls).toEqual([]);
  });

  it.each(['merge', 'gate'])('through main, %s exits 1 with the error and no hosted verdict', async (sub) => {
    const { deps, ghApi } = makeDeps(fx);
    let out = '';
    const payload = sub === 'merge' ? mergePayload(fx, { hosted: { ok: true } }) : gatePayload(fx, { hosted: { ok: true } });
    const code = await cli.main([sub], { ...deps, io: { readJson: () => payload, write: (s) => (out += s) } });
    expect(code).toBe(1);
    expect(JSON.parse(out).error).toMatch(/unknown payload key.*"hosted"/);
    expect(ghApi.calls).toEqual([]);
  });

  it.each(['o/r?x=1', 'o/r/../x', '-x/r', 'o r/x', 'o/r#frag', 'o/r&per_page=1'])('a repo like %j never reaches a lookup, so it can never shape the Actions path', async (repo) => {
    const { deps, ghApi } = makeDeps(fx);
    expect(() => cli.runMerge(mergePayload(fx, { repo }), deps)).toThrow(/repo is missing or malformed/);
    await expect(cli.runGateFlow(gatePayload(fx, { repo }), deps)).rejects.toThrow(/repo is missing or malformed/);
    expect(ghApi.calls).toEqual([]);
  });
});

describe('through a real process, with a gh that answers the PR and the Actions lookups', () => {
  const CLI_PATH = path.join(__dirname, '..', 'lib', 'local-ci-cli.js');
  const run = (sub, payload, ghDir) =>
    spawnSync(process.execPath, [CLI_PATH, sub], {
      input: JSON.stringify(payload),
      encoding: 'utf8',
      env: { ...process.env, PATH: `${ghDir}${path.delimiter}${process.env.PATH}` },
    });
  const prAnswer = { baseRefName: 'trusted-base', headRefOid: HEAD, state: 'OPEN' };
  const PR_VIEW = ['pr', 'view', '7', '--repo', REPO, '--json', 'baseRefName,headRefOid,state'];
  const ACTIONS = [
    ['api', `repos/${REPO}/actions/runs?head_sha=${HEAD}&per_page=100`],
    ['api', `repos/${REPO}/actions/runs/101/jobs?filter=latest&per_page=100`],
    ['api', `repos/${REPO}/actions/runs/102/jobs?filter=latest&per_page=100`],
    ['api', `repos/${REPO}/actions/runs/103/jobs?filter=latest&per_page=100`],
  ];
  // identity, the Actions lookups, the head's commit statuses (did the local gate record a failure?), then the PR read again
  // after them (the head may have moved meanwhile): the same order for `merge` and `gate`
  const STATUSES = ['api', `repos/${REPO}/commits/${HEAD}/statuses?per_page=100`];
  const EXPECTED_MERGE = [PR_VIEW, ...ACTIONS, STATUSES, PR_VIEW];
  const EXPECTED_GATE = EXPECTED_MERGE;

  it('merge: hosted CI green -> exit 0, source hosted; gh was asked for the PR and exactly the runs and jobs, as separate argv elements', () => {
    const dir = H.fakeGhActionsDir({ pr: prAnswer, entries: H.honest(HEAD), head: HEAD });
    const r = run('merge', mergePayload(fx), dir);
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({ ok: true, mergeReady: true, source: 'hosted', hostedJobs: H.VERIFIED });
    expect(H.ghInvocations(dir)).toEqual(EXPECTED_MERGE);
  });

  it('merge: a red job -> exit 1 with both reasons', () => {
    const dir = H.fakeGhActionsDir({ pr: prAnswer, entries: redTest(HEAD), head: HEAD });
    const r = run('merge', mergePayload(fx), dir);
    expect(r.status).toBe(1);
    const body = JSON.parse(r.stdout);
    expect(body).toMatchObject({ ok: false, mergeReady: false, hostedRefused: true });
    expect(body.reason).toContain(`no local CI status (${CONTEXT}) found`);
    expect(body.reason).toContain('job "test (24)" of run 102 concluded failure, not success');
  });

  it('merge: gh api failing (HTTP 502) is a refusal that says so, not a pass', () => {
    const dir = H.fakeGhActionsDir({ pr: prAnswer, entries: H.honest(HEAD), head: HEAD, apiMode: 'fails' });
    const r = run('merge', mergePayload(fx), dir);
    expect(r.status).toBe(1);
    const body = JSON.parse(r.stdout);
    expect(body.mergeReady).toBe(false);
    expect(body.reason).toContain(`cannot read workflow runs for ${HEAD}: gh api failed: gh: HTTP 502`);
  });

  it('merge: a gh api answer that is not JSON is a refusal that says so, not a pass', () => {
    const dir = H.fakeGhActionsDir({ pr: prAnswer, entries: H.honest(HEAD), head: HEAD, apiMode: 'garbage' });
    const r = run('merge', mergePayload(fx), dir);
    expect(r.status).toBe(1);
    const body = JSON.parse(r.stdout);
    expect(body.mergeReady).toBe(false);
    expect(body.reason).toContain(`cannot read workflow runs for ${HEAD}: gh api returned output that is not JSON`);
  });

  it('gate: hosted CI green -> exit 0, stage hosted, and gh was never asked to post anything', () => {
    const dir = H.fakeGhActionsDir({ pr: prAnswer, entries: H.honest(HEAD), head: HEAD });
    const r = run('gate', gatePayload(fx, { dryRun: false }), dir);
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({ ok: true, stage: 'hosted', source: 'hosted', ranLocally: false, posted: false, mergeReady: true });
    expect(H.ghInvocations(dir)).toEqual(EXPECTED_GATE);
  });
});
