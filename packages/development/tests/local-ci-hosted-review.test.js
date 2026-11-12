'use strict';

/**
 * Independent security review of the hosted-CI reuse (PR 297, kata ehsm): five fixes, each pinned through the REAL CLI
 * (a real process with a fake `gh` on PATH, real git, a real lock) as well as the module and in-process entry points.
 *   1. shape surprises fail closed: a run id that is not an integer, a listing without an integer `total_count`;
 *   2. only runs of THIS pull request count (`pull_requests[]` lists its number and base branch); others are ignored;
 *   3. a failure the local gate recorded on this head vetoes hosted acceptance (`merge` refuses, `gate` runs locally);
 *   4. a required job that uses a repo-local action or reusable workflow is refused (the workflow FILE can be equal while
 *      what it runs is not);
 *   5. the PR is read again after the hosted lookups, and a moved or closed PR is refused.
 * Every test changes ONE thing about an otherwise honest answer. Nothing here posts, or reaches the network.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const cli = require('../lib/local-ci-cli');
const lock = require('../lib/local-ci-lock');
const { verifyHosted, repoLocalUse } = require('../lib/local-ci-hosted');
const { cleanupBaseRepos, prInfoFor, fakePostStatus, BASE_BRANCH } = require('./helpers/local-ci-base-repo');
const H = require('./helpers/local-ci-hosted');
const W = require('./helpers/local-ci-wal');

const { REPO, PR, CONTEXT, VALIDATE, TEST } = H;
const GIT = H.memoGit();
const CLI_PATH = path.join(__dirname, '..', 'lib', 'local-ci-cli.js');
const OTHER = 'c'.repeat(40);

const scratch = [];
const tmpDir = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'local-ci-hosted-review-'));
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
const where = (f) => ({ headSha: f.headSha, baseSha: f.baseSha, repoRoot: f.dir });
const BIND = { pr: PR, baseRefName: BASE_BRANCH };

/** The module, against a fake GitHub answering with `entries`. */
function verify(entries, { fixture = fx, over = {}, api } = {}) {
  const ghApi = H.actionsApi(entries, api);
  const r = verifyHosted({ repo: REPO, ...where(fixture), ...BIND, approvalSet: H.APPROVAL_SET, ...over }, { git: GIT, ghApi });
  return { r, ghApi };
}
const refused = (r, ...causes) => {
  expect(r.ok).toBe(false);
  expect(r.reason).toMatch(/^hosted CI not accepted: /);
  for (const cause of causes) expect(r.reason).toContain(cause);
  return r;
};
const bound = (pullRequests) => ({ pull_requests: pullRequests });
const redTest = (head) => H.swap(H.honest(head), TEST, (e) => H.withJob(e, 'test (24)', { conclusion: 'failure' }));

/* ---------------------------------------------------------------- 1. shape surprises */

describe('1. an unexpected shape is a refusal, never an accept with nothing verified', () => {
  it.each([
    ['a string', '101'],
    ['null', null],
    ['a float', 101.5],
    ['missing', undefined],
    ['NaN', NaN],
  ])('every pull_request run has an id that is %s: refused, and no job listing is asked for', (_n, id) => {
    const entries = H.honest(HEAD).map((e) => H.withRun(e, { id }));
    const { r, ghApi } = verify(entries);
    refused(r, 'pull_request run of', VALIDATE, 'malformed id', 'rather than ignoring it');
    expect(r.jobs).toBeUndefined();
    expect(ghApi.calls).toHaveLength(1); // the runs listing only
  });

  it('one required workflow whose only pull_request run has a bad id is refused although the others are honest', () => {
    const entries = H.swap(H.honest(HEAD), TEST, (e) => H.withRun(e, { id: '102' }));
    refused(verify(entries).r, `pull_request run of ${TEST}`, 'malformed id ("102")');
  });

  it.each([
    ['absent', (answer) => delete answer.json.total_count],
    ['a string', (answer) => { answer.json.total_count = '3'; }],
    ['null', (answer) => { answer.json.total_count = null; }],
    ['a float', (answer) => { answer.json.total_count = 3.5; }],
  ])('a runs listing whose total_count is %s cannot be known to be complete: refused, no job listing asked for', (_n, change) => {
    const { r, ghApi } = verify(H.honest(HEAD), { api: { answer: (p, proceed) => { const a = proceed(); if (/actions\/runs\?head_sha/.test(p)) change(a); return a; } } });
    refused(r, 'carries no integer total_count');
    expect(ghApi.calls).toHaveLength(1);
  });

  it.each([
    ['absent', (answer) => delete answer.json.total_count],
    ['a string', (answer) => { answer.json.total_count = '1'; }],
  ])('a jobs listing whose total_count is %s is refused too', (_n, change) => {
    const { r } = verify(H.honest(HEAD), { api: { answer: (p, proceed) => { const a = proceed(); if (/\/jobs\?/.test(p)) change(a); return a; } } });
    refused(r, 'jobs listing of run 101 carries no integer total_count');
  });

  it('through the real CLI: a listing without total_count refuses `merge` and names the cause', () => {
    const entries = H.honest(HEAD).map((e) => H.withRun(e, { id: null }));
    const gh = H.fakeGhActionsDir({ pr: prAnswer(), entries, head: HEAD });
    const r = runCli('merge', { ...gatePayload(fx), statuses: [] }, gh);
    expect(r.status).toBe(1);
    expect(JSON.parse(r.stdout)).toMatchObject({ ok: false, mergeReady: false, hostedRefused: true });
    expect(JSON.parse(r.stdout).source).toBeUndefined();
    expect(JSON.parse(r.stdout).reason).toContain('malformed id');
  });
});

/* ----------------------------------------------------- 2. runs are bound to this pull request */

describe('2. only runs that belong to THIS pull request count', () => {
  const siblingTest = (over = {}) => H.hostedRun(202, TEST, ['test (22)', 'test (24)'], HEAD, { run: bound([{ number: 9, base: { ref: 'rig' } }]), ...over });

  it('a sibling PR\'s NEWER green run does not replace this PR\'s red run (the exploit): refused, and the sibling\'s jobs are never read', () => {
    const { r, ghApi } = verify([...redTest(HEAD), siblingTest()]);
    refused(r, 'job "test (24)" of run 102 concluded failure, not success');
    expect(ghApi.calls.some((p) => p.includes('/runs/202/'))).toBe(false);
  });

  it('the same exploit through the real CLI: `merge` refuses, `gate` falls through to the local run (here stopped at the lock)', () => {
    const entries = [...redTest(HEAD), siblingTest()];
    const gh = H.fakeGhActionsDir({ pr: prAnswer(), entries, head: HEAD });
    const merged = runCli('merge', { ...gatePayload(fx), statuses: [] }, gh);
    expect(merged.status).toBe(1);
    expect(JSON.parse(merged.stdout)).toMatchObject({ ok: false, mergeReady: false, hostedRefused: true });
    expect(JSON.parse(merged.stdout).reason).toContain('job "test (24)" of run 102 concluded failure');

    const dir = heldLockDir();
    const gated = runCli('gate', gatePayload(fx), H.fakeGhActionsDir({ pr: prAnswer(), entries, head: HEAD }), { lockDir: dir });
    expect(gated.status).toBe(1);
    expect(JSON.parse(gated.stdout)).toMatchObject({ ok: false, stage: 'lock', errorCode: 'lock-timeout', posted: false });
    expect(JSON.parse(gated.stdout).hostedRefused).toContain('concluded failure');
  });

  it('a sibling PR\'s green run does not stand in for a run this PR does not have', () => {
    const entries = [...H.honest(HEAD).filter((e) => e.run.path !== TEST), siblingTest()];
    refused(verify(entries).r, `no pull_request run of ${TEST} exists for ${HEAD} that belongs to pull request #${PR} (base ${BASE_BRANCH})`);
  });

  it.each([
    ['another pull request number on the same base branch', [{ number: PR + 1, base: { ref: BASE_BRANCH } }]],
    ['this pull request number but another base branch', [{ number: PR, base: { ref: 'rig' } }]],
    ['the pull request number as text', [{ number: String(PR), base: { ref: BASE_BRANCH } }]],
    ['a pull request without a base', [{ number: PR }]],
    ['no pull requests at all (a fork PR run, or a closed PR)', []],
    ['a pull_requests value that is not a list', { number: PR, base: { ref: BASE_BRANCH } }],
    ['a pull_requests list holding non-objects', [null, 7, 'x']],
  ])('a validate run listing %s is ignored and refused', (_n, pullRequests) => {
    const entries = H.swap(H.honest(HEAD), VALIDATE, (e) => H.withRun(e, bound(pullRequests)));
    refused(verify(entries).r, `no pull_request run of ${VALIDATE}`, `pull request #${PR} (base ${BASE_BRANCH})`);
  });

  it('a run with no pull_requests property at all is ignored', () => {
    const entries = H.swap(H.honest(HEAD), VALIDATE, (e) => {
      const run = { ...e.run };
      delete run.pull_requests;
      return { run, jobs: e.jobs };
    });
    refused(verify(entries).r, `no pull_request run of ${VALIDATE}`);
  });

  it('every run of a fork-like head (empty pull_requests, another head repository) means hosted reuse is refused: the gate runs locally', () => {
    const entries = H.honest(HEAD).map((e) => H.withRun(e, { ...bound([]), head_repository: { full_name: 'fork-owner/ensemble' } }));
    refused(verify(entries).r, 'no pull_request run of');
  });

  it('positive control: a run that lists this pull request among others counts', () => {
    const both = bound([{ number: 9, base: { ref: 'rig' } }, { number: PR, base: { ref: BASE_BRANCH, sha: 'a'.repeat(40) } }]);
    const entries = H.honest(HEAD).map((e) => H.withRun(e, both));
    const { r } = verify(entries);
    expect(r.ok).toBe(true);
    expect(r.jobs.map((j) => j.name)).toEqual(['validate', 'test (22)', 'test (24)', 'drift']);
  });

  it('the base commit a run listed is not compared: a base branch that moved since the run does not switch reuse off', () => {
    const entries = H.honest(HEAD).map((e) => H.withRun(e, bound([{ number: PR, base: { ref: BASE_BRANCH, sha: 'f'.repeat(40) } }])));
    expect(verify(entries).r.ok).toBe(true);
  });

  it('a run of another pull request is ignored whichever way it differs: it cannot mask a green run of this one either', () => {
    // this PR is green; a sibling's NEWER red run (other base) must not make this PR red
    const sibling = H.hostedRun(204, TEST, ['test (22)', 'test (24)'], HEAD, { run: { ...bound([{ number: 9, base: { ref: 'rig' } }]), conclusion: 'failure' }, job: { conclusion: 'failure' } });
    expect(verify([...H.honest(HEAD), sibling]).r.ok).toBe(true);
  });

  it('an unbound PUSH run is ignored as well, while a bound red push run still refuses', () => {
    const unbound = H.hostedRun(205, VALIDATE, ['validate'], HEAD, { run: { event: 'push', ...bound([]), conclusion: 'failure' }, job: { conclusion: 'failure' } });
    expect(verify([...H.honest(HEAD), unbound]).r.ok).toBe(true);
    const mine = H.hostedRun(206, VALIDATE, ['validate'], HEAD, { run: { event: 'push', conclusion: 'failure' }, job: { conclusion: 'failure' } });
    refused(verify([...H.honest(HEAD), mine]).r, 'job "validate" of run 206 concluded failure');
  });

  it.each([
    ['no pull request number', { pr: undefined }, 'no pull request number to bind the runs to'],
    ['a pull request number that is not an integer', { pr: '7' }, 'no pull request number to bind the runs to'],
    ['a pull request number of zero', { pr: 0 }, 'no pull request number to bind the runs to'],
    ['no base branch', { baseRefName: undefined }, 'no base branch name to bind the runs to'],
    ['an empty base branch', { baseRefName: '' }, 'no base branch name to bind the runs to'],
  ])('the caller supplying %s is refused before GitHub is asked', (_n, over, cause) => {
    const { r, ghApi } = verify(H.honest(HEAD), { over });
    refused(r, cause);
    expect(ghApi.calls).toEqual([]);
  });
});

/* ------------------------------------------------------------ 3. a recorded local failure vetoes */

describe('3. a failure the local gate recorded on this head vetoes hosted acceptance', () => {
  const failedStatus = () => ({ context: CONTEXT, state: 'failure', sha: HEAD, description: 'ci-local failed: x / y / z @ e4c4130' });
  const mergePayload = (statuses) => ({ ...gatePayload(fx), statuses });

  // (Replaced: this used to pin a veto decided from the caller's payload; the veto is now read from GitHub, so the failure is on GitHub too.)
  it.each(['failure', 'error'])('merge: a %s status on this head (on GitHub) and GREEN hosted CI is refused, naming the status and forceLocal', (state) => {
    const { deps, ghApi } = makeDeps(fx, { statuses: [{ context: CONTEXT, state, description: 'x' }] });
    const r = cli.runMerge(mergePayload([{ ...failedStatus(), state }]), deps);
    expect(r).toMatchObject({ ok: false, mergeReady: false, hostedRefused: true, localFailure: true, headSha: HEAD });
    expect(r.source).toBeUndefined();
    expect(r.reason).toContain(`status on ${HEAD} is ${state}`);
    expect(r.reason).toContain(`the local gate recorded ${state} for ${CONTEXT} on ${HEAD}`);
    expect(r.reason).toContain('re-run the gate with forceLocal:true');
    expect(ghApi.calls.length).toBeGreaterThan(0); // hosted CI was verified green, and still not accepted
  });

  it('merge: the same refusal through the real CLI process', () => {
    const gh = H.fakeGhActionsDir({ pr: prAnswer(), entries: H.honest(HEAD), head: HEAD, statuses: [{ context: CONTEXT, state: 'failure', description: 'x' }] });
    const r = runCli('merge', mergePayload([failedStatus()]), gh);
    expect(r.status).toBe(1);
    expect(JSON.parse(r.stdout)).toMatchObject({ ok: false, mergeReady: false, localFailure: true, hostedRefused: true });
  });

  it('merge: a failure status on ANOTHER commit is not this head\'s and does not veto', () => {
    const { deps } = makeDeps(fx);
    const r = cli.runMerge(mergePayload([{ ...failedStatus(), sha: OTHER }]), deps);
    expect(r).toMatchObject({ ok: true, mergeReady: true, source: 'hosted' });
  });

  it('merge: a failure status in ANOTHER context is not ours and does not veto', () => {
    const { deps } = makeDeps(fx);
    const r = cli.runMerge(mergePayload([{ ...failedStatus(), context: 'some/other-check' }]), deps);
    expect(r).toMatchObject({ ok: true, mergeReady: true, source: 'hosted' });
  });

  // Replaced: this pinned "a pending status does not veto" (round 3). A pending latest status is a local run that did not
  // finish (it is running, or it died): it vetoes (round 5, write-ahead).
  it('merge: a pending status (the latest on GitHub) vetoes: a local run that did not finish', () => {
    const { deps } = makeDeps(fx, { statuses: [{ context: CONTEXT, state: 'pending', description: 'ci-local running' }] });
    const r = cli.runMerge(mergePayload([]), deps);
    expect(r).toMatchObject({ ok: false, mergeReady: false, hostedRefused: true, localFailure: true });
    expect(r.reason).toContain('did not finish');
  });

  it('merge: with RED hosted CI the refusal still carries both reasons (the veto changes nothing there)', () => {
    const { deps } = makeDeps(fx, { entries: redTest(HEAD) });
    const r = cli.runMerge(mergePayload([failedStatus()]), deps);
    expect(r).toMatchObject({ ok: false, hostedRefused: true });
    expect(r.localFailure).toBeUndefined();
    expect(r.reason).toContain(`status on ${HEAD} is failure`);
    expect(r.reason).toContain('concluded failure');
  });

  it('gate: a recorded failure and GREEN hosted CI: the hosted shortcut is skipped and the local run decides, reporting why', async () => {
    const { deps, runGate, post, ghApi } = makeDeps(fx, { statuses: [{ context: CONTEXT, state: 'failure', description: 'x' }] });
    const r = await cli.runGateFlow(gatePayload(fx), deps);
    expect(runGate).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ ok: true, posted: true, stage: 'attest' });
    expect(r.source).toBeUndefined();
    expect(r.ranLocally).toBeUndefined();
    expect(r.hostedRefused).toContain(`the local gate recorded failure for ${CONTEXT} on ${HEAD}`);
    expect(r.hostedRefused).toMatch(/^hosted CI not accepted: /);
    expect(post.statuses().map((p) => p.body.state)).toEqual(['pending', 'success']); // the write-ahead pending, then the local run's fresh status
    expect(ghApi.calls.some((p) => p.includes(`/commits/${HEAD}/statuses`))).toBe(true);
    expect(deps.prInfo.calls).toHaveLength(1); // no hosted acceptance, so no second read
  });

  // Replaced: this used to pin "success after an old failure does not veto" for ANY success. A success clears an older
  // failure only when its record VERIFIES (round 5): the gate's own success carries one, a bare success does not.
  it('gate: a VERIFIED success after an old failure supersedes it: hosted CI is accepted', async () => {
    const statuses = [{ context: CONTEXT, state: 'success', description: W.verifiedDescription(fx) }, { context: CONTEXT, state: 'failure', description: 'old' }];
    const { deps, runGate } = makeDeps(fx, { statuses: W.asGithub(statuses) });
    const r = await cli.runGateFlow(gatePayload(fx), deps);
    expect(r).toMatchObject({ ok: true, stage: 'hosted', source: 'hosted' });
    expect(runGate).not.toHaveBeenCalled();
  });

  it('gate: a bare (unverified) success after an old failure does NOT clear it: the local run decides', async () => {
    const statuses = [{ context: CONTEXT, state: 'success', description: 'ok' }, { context: CONTEXT, state: 'failure', description: 'old' }];
    const { deps, runGate } = makeDeps(fx, { statuses: W.asGithub(statuses) });
    const r = await cli.runGateFlow(gatePayload(fx), deps);
    expect(runGate).toHaveBeenCalledTimes(1);
    expect(r.source).toBeUndefined();
    expect(r.hostedRefused).toContain('a success whose record does not verify');
  });

  it('gate: another context\'s failure does not veto', async () => {
    const { deps } = makeDeps(fx, { statuses: [{ context: 'some/other-check', state: 'failure', description: 'x' }] });
    expect(await cli.runGateFlow(gatePayload(fx), deps)).toMatchObject({ ok: true, stage: 'hosted', source: 'hosted' });
  });

  it.each([
    ['the statuses lookup fails', { answer: (p, proceed) => (/\/statuses\?/.test(p) ? { ok: false, error: 'gh api failed: HTTP 502' } : proceed()) }, 'cannot read the commit statuses'],
    ['the statuses answer is not a list', { answer: (p, proceed) => (/\/statuses\?/.test(p) ? { ok: true, json: { state: 'success' } } : proceed()) }, 'cannot read the commit statuses'],
  ])('gate: %s, so hosted CI is not accepted (fail closed) and the local run decides', async (_n, api, cause) => {
    const { deps, runGate } = makeDeps(fx, { api });
    const r = await cli.runGateFlow(gatePayload(fx), deps);
    expect(runGate).toHaveBeenCalledTimes(1);
    expect(r.source).toBeUndefined();
    expect(r.hostedRefused).toContain(cause);
  });

  it('gate: no GitHub lookup at all means no hosted CI either (nothing to read the statuses with)', async () => {
    const { deps, runGate } = makeDeps(fx, { deps: { ghApi: undefined } });
    const r = await cli.runGateFlow(gatePayload(fx), deps);
    expect(runGate).toHaveBeenCalledTimes(1);
    expect(r.hostedRefused).toContain('no GitHub lookup is available');
  });

  it('gate: forceLocal never reads the statuses (hosted CI is not consulted at all)', async () => {
    const { deps, ghApi } = makeDeps(fx);
    await cli.runGateFlow(gatePayload(fx, { forceLocal: true }), deps);
    expect(ghApi.calls).toEqual([]);
  });

  it('gate through the real CLI process: a recorded failure and green hosted CI never end in stage hosted (here stopped at the lock)', () => {
    const gh = H.fakeGhActionsDir({ pr: prAnswer(), entries: H.honest(HEAD), head: HEAD, statuses: [{ context: CONTEXT, state: 'failure', description: 'x' }] });
    const r = runCli('gate', gatePayload(fx), gh, { lockDir: heldLockDir() });
    expect(r.status).toBe(1);
    const body = JSON.parse(r.stdout);
    expect(body).toMatchObject({ ok: false, stage: 'lock', errorCode: 'lock-timeout', posted: false, mergeReady: false });
    expect(body.source).toBeUndefined();
    expect(body.hostedRefused).toContain('the local gate recorded failure');
    const asked = H.ghInvocations(gh);
    expect(asked[asked.length - 1]).toEqual(['api', `repos/${REPO}/commits/${HEAD}/statuses?per_page=100`]); // no second PR read: nothing was accepted
  });
});

/* ------------------------------------------------------------ 4. repo-local actions and workflows */

describe('4. a required job that uses a repo-local action or reusable workflow is refused', () => {
  const validateWith = (uses) => `name: validate\non:\n  pull_request:\n  push:\n    branches: [main, dev]\njobs:\n  validate:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: ${uses}\n      - run: npm run validate\n`;
  const reusable = (uses) => `name: validate\non:\n  pull_request:\njobs:\n  validate:\n    uses: ${uses}\n`;
  const repoWith = (text) => H.hostedRepo({ files: { [VALIDATE]: text } });

  it.each([
    ['a composite action', validateWith('./.github/actions/setup'), './.github/actions/setup'],
    ['a composite action through a parent path', validateWith('../elsewhere/action'), '../elsewhere/action'],
    ['a reusable workflow in this repository', reusable('./.github/workflows/reusable.yml'), './.github/workflows/reusable.yml'],
  ])('%s: refused, naming the job, the file and the reference, before GitHub is asked', (_n, text, ref) => {
    const fixture = repoWith(text);
    const { r, ghApi } = verify(H.honest(fixture.headSha), { fixture });
    refused(r, 'job "validate"', VALIDATE, 'repo-local action or reusable workflow', ref, 'graded by the local gate instead');
    expect(ghApi.calls).toEqual([]);
  });

  it('a step whose uses is not text cannot be judged and is refused', () => {
    const fixture = repoWith(`name: validate\non: [pull_request]\njobs:\n  validate:\n    runs-on: ubuntu-latest\n    steps:\n      - uses:\n          x: 1\n`);
    refused(verify(H.honest(fixture.headSha), { fixture }).r, 'a non-text uses');
  });

  it('positive control: external actions (checkout, setup-node) are fine and the run is accepted', () => {
    const fixture = repoWith(validateWith('actions/checkout@v6'));
    expect(verify(H.honest(fixture.headSha, { [VALIDATE]: validateWith('actions/checkout@v6') }), { fixture }).r.ok).toBe(true);
  });

  it('only the REQUIRED jobs are looked at: a local action in a job nothing requires does not refuse', () => {
    const text = `name: validate\non: [pull_request]\njobs:\n  validate:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm run validate\n  unrelated:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: ./.github/actions/setup\n`;
    const fixture = repoWith(text);
    expect(verify(H.honest(fixture.headSha, { [VALIDATE]: text }), { fixture }).r.ok).toBe(true);
  });

  it('repoLocalUse: the reference text, null for external or absent uses', () => {
    expect(repoLocalUse({ steps: [{ uses: 'actions/checkout@v6' }, { run: 'x' }] })).toBeNull();
    expect(repoLocalUse({ steps: [{ uses: ' ./a ' }] })).toBe('./a');
    expect(repoLocalUse({ uses: './.github/workflows/r.yml' })).toBe('./.github/workflows/r.yml');
    expect(repoLocalUse({ uses: 'octo/repo/.github/workflows/r.yml@v1' })).toBeNull();
    expect(repoLocalUse(undefined)).toBeNull();
    expect(repoLocalUse({ steps: 'not a list' })).toBeNull();
  });

  it('through the real CLI: `merge` refuses with the named reason', () => {
    const fixture = repoWith(validateWith('./.github/actions/setup'));
    const gh = H.fakeGhActionsDir({ pr: prAnswer(fixture), entries: H.honest(fixture.headSha), head: fixture.headSha });
    const r = runCli('merge', { ...gatePayload(fixture), statuses: [] }, gh);
    expect(r.status).toBe(1);
    expect(JSON.parse(r.stdout)).toMatchObject({ ok: false, mergeReady: false, hostedRefused: true });
    expect(JSON.parse(r.stdout).reason).toContain('repo-local action or reusable workflow (./.github/actions/setup)');
  });
});

/* ----------------------------------------------------------- 5. the PR is read again after the lookups */

describe('5. the pull request is read again after the hosted lookups', () => {
  const moved = (over) => ({ headRefOid: OTHER, ...over });
  const answers = (second) => [{}, second]; // the first read is honest; the second is `second`

  it('merge: a head that moved while GitHub was being asked is refused (and the PR was read twice)', () => {
    const { deps, ghApi } = makeDeps(fx, { prAnswers: answers(moved()) });
    const r = cli.runMerge({ ...gatePayload(fx), statuses: [] }, deps);
    expect(r).toMatchObject({ ok: false, mergeReady: false, hostedRefused: true });
    expect(r.source).toBeUndefined();
    expect(r.reason).toContain('is not the current head of pull request #7');
    expect(r.reason).toContain('re-read after the hosted lookups');
    expect(deps.prInfo.calls).toHaveLength(2);
    expect(ghApi.calls.length).toBeGreaterThan(0);
  });

  it.each([['CLOSED'], ['MERGED']])('merge: a pull request that became %s meanwhile is refused', (state) => {
    const { deps } = makeDeps(fx, { prAnswers: answers({ state }) });
    const r = cli.runMerge({ ...gatePayload(fx), statuses: [] }, deps);
    expect(r).toMatchObject({ ok: false, mergeReady: false });
    expect(r.reason).toContain('not OPEN');
  });

  it('merge: a failing second read is a refusal, not a pass', () => {
    const { deps } = makeDeps(fx, { prAnswers: answers({ error: 'HTTP 502' }) });
    const r = cli.runMerge({ ...gatePayload(fx), statuses: [] }, deps);
    expect(r).toMatchObject({ ok: false, mergeReady: false });
    expect(r.reason).toContain('cannot verify pull request #7');
  });

  it('merge: an unchanged head is accepted after exactly two reads', () => {
    const { deps } = makeDeps(fx);
    expect(cli.runMerge({ ...gatePayload(fx), statuses: [] }, deps)).toMatchObject({ ok: true, mergeReady: true, source: 'hosted' });
    expect(deps.prInfo.calls).toHaveLength(2);
  });

  it('gate: a head that moved meanwhile stops at the config stage like the first check: nothing run, nothing posted, no local fallback', async () => {
    const { deps, runGate, post } = makeDeps(fx, { prAnswers: answers(moved()) });
    const r = await cli.runGateFlow(gatePayload(fx), deps);
    expect(r).toMatchObject({ ok: false, stage: 'config', mergeReady: false, posted: false });
    expect(r.source).toBeUndefined();
    expect(r.error).toContain('is not the current head of pull request #7');
    expect(r.error).toContain('re-read after the hosted lookups');
    expect(runGate).not.toHaveBeenCalled();
    expect(post.calls).toEqual([]);
  });

  it('gate: an unchanged head is accepted after two reads', async () => {
    const { deps } = makeDeps(fx);
    expect(await cli.runGateFlow(gatePayload(fx), deps)).toMatchObject({ ok: true, stage: 'hosted', source: 'hosted' });
    expect(deps.prInfo.calls).toHaveLength(2);
  });

  it('through the real CLI process: a head that moves between the two reads is refused by `merge` and by `gate`', () => {
    for (const sub of ['merge', 'gate']) {
      const gh = H.fakeGhActionsDir({ pr: prAnswer(), entries: H.honest(HEAD), head: HEAD });
      movingHeadGh(gh, { baseRefName: BASE_BRANCH, headRefOid: OTHER, state: 'OPEN' });
      const payload = sub === 'merge' ? { ...gatePayload(fx), statuses: [] } : gatePayload(fx);
      const r = runCli(sub, payload, gh, { lockDir: tmpDir() });
      expect(r.status).toBe(1);
      const body = JSON.parse(r.stdout);
      expect(body.mergeReady).toBe(false);
      expect(body.source).toBeUndefined();
      expect(sub === 'merge' ? body.reason : body.error).toContain('re-read after the hosted lookups');
      const views = H.ghInvocations(gh).filter((argv) => argv[0] === 'pr');
      expect(views).toHaveLength(2);
    }
  });
});

/* ---------------------------------------------------------------------------- helpers */

function prAnswer(fixture = fx) {
  return { baseRefName: BASE_BRANCH, headRefOid: fixture.headSha, state: 'OPEN' };
}
function gatePayload(fixture, extra) {
  return { repoRoot: fixture.dir, headSha: fixture.headSha, baseRef: fixture.baseRef, repo: REPO, pr: PR, ...extra };
}
const passingRun = (options) => ({ ok: true, sha: options.headSha, failures: [], unmirrored: [], nodes: [{ node: 22, ok: true, steps: [] }, { node: 24, ok: true, steps: [] }] });

/**
 * In-process deps: real git, fake GitHub. `prAnswers` is the sequence of answers `gh pr view` gives (each merged over the
 * honest one; the last repeats); `statuses` is what the head's commit statuses list says; no lock is needed for a run here.
 */
function makeDeps(fixture, { entries = H.honest(fixture.headSha), prAnswers = [{}], statuses = [], api, deps = {} } = {}) {
  const post = fakePostStatus();
  const runGate = jest.fn((options) => passingRun(options));
  const ghApi = H.actionsApi(entries, { statuses, ...(api || {}) });
  const calls = [];
  const prInfo = (args) => {
    const n = calls.length;
    calls.push(args);
    const over = prAnswers[Math.min(n, prAnswers.length - 1)];
    return over.error ? { ok: false, error: over.error } : prInfoFor(fixture, over)(args);
  };
  prInfo.calls = calls;
  const acquireGateLock = async () => ({ acquired: true, queuedMs: 0, release() {} });
  return { deps: { ...cli.defaultDeps(), git: GIT, env: {}, prInfo, ghApi, postStatus: post, runGate, acquireGateLock, ...deps }, post, runGate, ghApi };
}

/** A real `gh` that answers the first `pr view` with its pr.json and every later one with `moved`. */
function movingHeadGh(dir, movedAnswer) {
  const script = path.join(dir, 'gh');
  const text = fs.readFileSync(script, 'utf8');
  const first = JSON.stringify(path.join(dir, 'pr.json'));
  const second = path.join(dir, 'pr-second.json');
  const counter = JSON.stringify(path.join(dir, 'pr.count'));
  fs.writeFileSync(second, JSON.stringify(movedAnswer));
  const patched = text.replace(`cat ${first}; exit 0; fi`, `if [ -f ${counter} ]; then cat ${JSON.stringify(second)}; else touch ${counter}; cat ${first}; fi; exit 0; fi`);
  expect(patched).not.toBe(text);
  fs.writeFileSync(script, patched, { mode: 0o755 });
}

/** A lock directory whose lock a LIVE process (this one) holds: a zero-wait gate that needs the lock is refused at it. */
function heldLockDir() {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, lock.LOCK_FILE), JSON.stringify({ pid: process.pid, host: os.hostname(), token: 'busy-gate', acquiredAt: '2026-01-01T00:00:00.000Z' }));
  return dir;
}

/** The real CLI as a process, a fake `gh` first on PATH, a private lock directory with no wait. */
function runCli(sub, payload, ghDir, { lockDir = tmpDir() } = {}) {
  return spawnSync(process.execPath, [CLI_PATH, sub], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, PATH: `${ghDir}${path.delimiter}${process.env.PATH}`, ENSEMBLE_LOCAL_CI_LOCK_DIR: lockDir, ENSEMBLE_LOCAL_CI_LOCK_TIMEOUT_MS: '0' },
  });
}
