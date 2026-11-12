'use strict';

/**
 * Gate end to end (TRD-005-TEST). Real local-ci-* modules and a fake synchronous `postStatus` (the gate publishes with
 * the maintainer's own `gh` login); the runner result is injected because running CI needs Node downloads.
 * No network, no real login.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const cli = require('../lib/local-ci-cli');
const { validateConfig } = require('../lib/local-ci-config');
const { buildRecord, verifyRecord } = require('../lib/local-ci-record');
const { makeBaseRepo, cleanupBaseRepos, prInfoFor, fakePostStatus, fakeGhDir, postedArgs, statusesApi, asGithub, PR } = require('./helpers/local-ci-base-repo');

const CLI_PATH = path.join(__dirname, '..', 'lib', 'local-ci-cli.js');
const REPO_CONFIG = path.join(__dirname, '..', '..', '..', '.ensemble', 'local-ci.yaml');
const CONFIG = validateConfig(fs.readFileSync(REPO_CONFIG, 'utf8'));
const WORKFLOW_SET = CONFIG.approvalSet.workflows.map((w) => w.file);
const CONTEXT = CONFIG.approvalSet.statusContext;
if (typeof CONTEXT !== 'string' || CONTEXT === '') throw new Error('fixture config has no status context');
const OTHER = 'b'.repeat(40);

/** A repo whose base ref carries the trusted config (`config` overrides its text, null omits it); the head is checked out. */
function tempRepo({ config } = {}) {
  return makeBaseRepo({ config: config === undefined ? fs.readFileSync(REPO_CONFIG, 'utf8') : config });
}

const passingRun = (sha) => ({ ok: true, sha, failures: [], unmirrored: [], nodes: [{ node: 22, ok: true, steps: [] }, { node: 24, ok: true, steps: [] }] });

function makeDeps(overrides = {}) {
  const post = fakePostStatus();
  const runGate = jest.fn((options) => passingRun(options.headSha));
  const deps = {
    ...cli.defaultDeps(),
    postStatus: post,
    ghApi: statusesApi([]), // GitHub lists no status of the head unless a test says so
    runGate,
    env: {},
    ...overrides,
  };
  return { deps, post, runGate };
}

function gatePayload(repo, extra = {}) {
  return { repoRoot: repo.dir, headSha: repo.sha, baseRef: repo.baseRef, repo: 'owner/name', pr: PR, ...extra };
}

afterAll(cleanupBaseRepos);
const repoWith = (opts) => tempRepo(opts);

describe('merge readiness', () => {
  const fixture = repoWith();
  const HEAD = fixture.sha;
  const trustedBlob = fixture.git('rev-parse', `${fixture.baseRef}:.ensemble/local-ci.yaml`);
  const record = buildRecord({ runnerBlobSha: trustedBlob, workflowSet: WORKFLOW_SET, log: 'run' });
  const status = (over = {}) => ({ context: CONTEXT, state: 'success', description: record.description, sha: HEAD, ...over });
  const merge = (statuses, extra = {}) => cli.runMerge({ headSha: HEAD, statuses, repoRoot: fixture.dir, baseRef: fixture.baseRef, repo: 'owner/name', pr: PR, ...extra }, { ...cli.defaultDeps(), prInfo: prInfoFor(fixture), ghApi: statusesApi(asGithub(statuses)) });

  it('passing run merges: a verified status bound to the exact head is ready without hosted CI', () => {
    const r = merge([status()]);
    expect(r).toMatchObject({ ok: true, mergeReady: true, headSha: HEAD, hostedCiWaitRequired: false });
    expect(verifyRecord({ description: record.description, statusCommitSha: HEAD, headSha: HEAD, runnerBlobSha: trustedBlob, workflowSet: WORKFLOW_SET }).ok).toBe(true);
  });

  it('HONEST-ACTOR LIMIT (deliberate): a verifying status is accepted whoever posted it; merge never consults the creator', () => {
    const posters = [
      { creator: { login: 'some-unrelated-user', type: 'User' } },
      { creator: { login: 'ensemble-local-ci[bot]', type: 'Bot' }, app_id: 424242, app: { id: 424242, slug: 'other-app' } },
      { creator: null },
      {},
    ];
    for (const who of posters) expect(merge([status(who)])).toMatchObject({ ok: true, mergeReady: true });
    // ...while the checks merge DOES make still bite on the very same posters: the head binding and the record.
    expect(merge([status({ creator: { login: 'some-unrelated-user' }, sha: OTHER })]).mergeReady).toBe(false);
    const forged = buildRecord({ runnerBlobSha: 'c0ffee123456', workflowSet: WORKFLOW_SET, log: 'run' });
    expect(merge([status({ creator: { login: 'some-unrelated-user' }, description: forged.description })]).mergeReady).toBe(false);
  });

  it('no run refuses and reports the missing run', () => {
    const r = merge([{ ...status(), context: 'some/other-check' }]);
    expect(r.mergeReady).toBe(false);
    expect(r.missingRun).toBe(true);
    expect(r.reason).toContain(HEAD);
  });

  it('a status on an older commit refuses, naming both SHAs', () => {
    const r = merge([status({ sha: OTHER })]);
    expect(r.mergeReady).toBe(false);
    expect(r.headMoved).toBe(true);
    expect(r.reason).toContain(OTHER);
    expect(r.reason).toContain(HEAD);
  });

  it('a failure status, a record for a different workflow set, or a blocking review refuses', () => {
    expect(merge([status({ state: 'failure' })]).mergeReady).toBe(false);
    const other = buildRecord({ runnerBlobSha: trustedBlob, workflowSet: ['.github/workflows/other.yml'], log: 'run' });
    expect(merge([status({ description: other.description })]).mergeReady).toBe(false);
    const blocked = merge([status()], {
      reviews: [{ author: { login: 'alice', type: 'User' }, state: 'CHANGES_REQUESTED', submittedAt: '2026-01-01T00:00:00Z' }],
    });
    expect(blocked.mergeReady).toBe(false);
    expect(blocked.reason).toMatch(/alice/);
  });

  it('an unusable config refuses rather than guessing', () => {
    const bad = repoWith({ config: 'not: [valid' });
    const r = cli.runMerge({ headSha: bad.sha, statuses: [status({ sha: bad.sha })], repoRoot: bad.dir, baseRef: bad.baseRef, repo: 'owner/name', pr: PR }, { ...cli.defaultDeps(), prInfo: prInfoFor(bad) });
    expect(r.mergeReady).toBe(false);
    expect(r.reason).toMatch(/config invalid/);
    const none = repoWith({ config: null });
    expect(cli.runMerge({ headSha: none.sha, statuses: [status({ sha: none.sha })], repoRoot: none.dir, baseRef: none.baseRef, repo: 'owner/name', pr: PR }, { ...cli.defaultDeps(), prInfo: prInfoFor(none) }).mergeReady).toBe(false);
  });
});

describe('gate flow', () => {
  it('a missing or invalid maintainer config stops at the config stage, never runs or posts', async () => {
    for (const config of [null, 'not: [valid', 'workflows: []\n']) {
      const repo = repoWith({ config });
      const { deps, post, runGate } = makeDeps({ prInfo: prInfoFor(repo) });
      const r = await cli.runGateFlow(gatePayload(repo), deps);
      expect(r).toMatchObject({ ok: false, mergeReady: false, posted: false, stage: 'config' });
      expect(r.error).toMatch(/config invalid/);
      expect(runGate).not.toHaveBeenCalled();
      expect(post.calls).toHaveLength(0);
    }
  });

  it.each([
    ['node', { node: () => ({ status: 127, stdout: '', stderr: 'not found' }) }],
    ['git', { git: () => ({ status: 127, stdout: '', stderr: 'not found' }) }],
  ])('missing %s stops naming it, never runs or posts', async (name, override) => {
    const repo = repoWith();
    const { deps, post, runGate } = makeDeps({ ...override, prInfo: prInfoFor(repo) });
    const r = await cli.runGateFlow(gatePayload(repo), deps);
    expect(r).toMatchObject({ ok: false, mergeReady: false, posted: false, prerequisite: name });
    expect(runGate).not.toHaveBeenCalled();
    expect(post.calls).toHaveLength(0);
  });

  it('dry run reports readiness and posts nothing', async () => {
    const repo = repoWith();
    const { deps, post } = makeDeps({ prInfo: prInfoFor(repo) });
    const r = await cli.runGateFlow(gatePayload(repo, { dryRun: true }), deps);
    expect(r).toMatchObject({ ok: true, dryRun: true, mergeReady: true, posted: false, wouldPost: true });
    expect(post.calls).toHaveLength(0);
  });

  it('dry run never invokes gh at all (it cannot know whether gh could post), even when gh would fail', async () => {
    const repo = repoWith();
    const { deps, post } = makeDeps({ postStatus: fakePostStatus({ fail: 'gh not logged in' }), prInfo: prInfoFor(repo) });
    const r = await cli.runGateFlow(gatePayload(repo, { dryRun: true }), deps);
    expect(r).toMatchObject({ ok: true, dryRun: true, posted: false, wouldPost: true });
    expect(post.calls).toHaveLength(0);
  });

  it('gh could not publish the pending: the gate does not run, nothing else is posted, merge refused', async () => {
    const repo = repoWith();
    const refusing = fakePostStatus({ fail: 'gh not logged in' });
    const { deps, runGate } = makeDeps({ postStatus: refusing, prInfo: prInfoFor(repo) });
    const r = await cli.runGateFlow(gatePayload(repo), deps);
    expect(r).toMatchObject({ ok: false, mergeReady: false, posted: false, stage: 'pending' });
    expect(r.error).toContain('cannot record that a local run is starting');
    expect(r.error).toContain('gh not logged in');
    expect(runGate).not.toHaveBeenCalled();
    expect(refusing.calls).toHaveLength(1); // the pending, once; nothing after it
  });

  it('gh could not publish the success (the pending went out): nothing attested, merge refused, the pending remains', async () => {
    const repo = repoWith();
    const sent = [];
    const postStatus = (req) => {
      sent.push(req.state);
      return req.state === 'pending' ? { published: true, id: 1 } : { published: false, reason: 'gh not logged in' };
    };
    const { deps } = makeDeps({ postStatus, prInfo: prInfoFor(repo) });
    const r = await cli.runGateFlow(gatePayload(repo), deps);
    expect(r).toMatchObject({ ok: false, mergeReady: false, posted: false, cannotAttest: true, pendingRemains: true });
    expect(r.error).toContain('cannot attest');
    expect(sent).toEqual(['pending', 'success']);
  });

  it('a passing run posts one success status on the exact head that then verifies as merge-ready', async () => {
    const repo = repoWith();
    const { deps, post, runGate } = makeDeps({ prInfo: prInfoFor(repo) });
    const r = await cli.runGateFlow(gatePayload(repo), deps);
    expect(runGate).toHaveBeenCalledTimes(1);
    expect(runGate.mock.calls[0][0]).toMatchObject({ headSha: repo.sha, repoRoot: path.resolve(repo.dir) });
    // the approval set and command list handed to the runner are the maintainer file's
    expect(runGate.mock.calls[0][0].approvalSet).toEqual(CONFIG.approvalSet);
    expect(r).toMatchObject({ ok: true, posted: true, mergeReady: true });

    const posted = post.statuses();
    expect(posted.map((p) => p.body.state)).toEqual(['pending', 'success']);
    expect(posted.every((p) => p.sha === repo.sha)).toBe(true);
    expect(posted[1].body).toMatchObject({ state: 'success', context: CONTEXT });

    const ready = cli.runMerge(
      { headSha: repo.sha, repoRoot: repo.dir, baseRef: repo.baseRef, repo: 'owner/name', pr: PR, statuses: [{ context: CONTEXT, state: 'success', description: posted[1].body.description, sha: repo.sha }] },
      deps
    );
    expect(ready.mergeReady).toBe(true);
    // The same status no longer counts once the head moves (a real new commit on the PR branch).
    fs.writeFileSync(path.join(repo.dir, 'later.txt'), 'later\n');
    repo.git('add', '-A');
    repo.git('commit', '-qm', 'head moves');
    const movedHead = repo.git('rev-parse', 'HEAD');
    const moved = cli.runMerge(
      { headSha: movedHead, repoRoot: repo.dir, baseRef: repo.baseRef, repo: 'owner/name', pr: PR, statuses: [{ context: CONTEXT, state: 'success', description: posted[1].body.description, sha: repo.sha }] },
      { ...deps, prInfo: prInfoFor(repo, { headRefOid: movedHead }) }
    );
    expect(moved.mergeReady).toBe(false);
    expect(moved.headMoved).toBe(true);
  });

  it('a failing step is reported with workflow, job, step and head SHA, and never posts success', async () => {
    const repo = repoWith();
    const runGate = jest.fn(() => ({
      ok: false,
      sha: repo.sha,
      failures: [{ kind: 'step-failed', step: 'test', node: 22, sha: repo.sha, message: `required step "test" failed on Node 22 at ${repo.sha}` }],
      unmirrored: [],
      nodes: [{ node: 22, ok: false, steps: [{ name: 'test', status: 'FAIL' }] }],
    }));
    const { deps, post } = makeDeps({ runGate, prInfo: prInfoFor(repo) });
    const r = await cli.runGateFlow(gatePayload(repo), deps);
    expect(r.ok).toBe(false);
    expect(r.mergeReady).toBe(false);
    expect(r.failures).toHaveLength(1);
    expect(r.failures[0]).toMatchObject({ step: 'test', sha: repo.sha, job: 'node 22' });
    expect(r.failures[0].workflow).toBeTruthy();
    const posted = post.statuses();
    expect(posted.map((p) => p.body.state)).toEqual(['pending', 'failure']);
    expect(posted[1].body.description).toContain('test');
  });

  it('an unsupported step names workflow, job, step and SHA and never becomes success', async () => {
    const repo = repoWith();
    const runGate = jest.fn(() => ({
      ok: false,
      sha: repo.sha,
      failures: [{ kind: 'unmirrored-step', step: 'Deploy', node: null, sha: repo.sha, message: 'x' }],
      unmirrored: [{ workflow: '.github/workflows/test.yml', job: 'test', step: 'Deploy', reason: 'no configured step mirrors it' }],
      nodes: [],
    }));
    const { deps, post } = makeDeps({ runGate, prInfo: prInfoFor(repo) });
    const r = await cli.runGateFlow(gatePayload(repo), deps);
    expect(r.mergeReady).toBe(false);
    expect(r.failures[0]).toMatchObject({ kind: 'unsupported-step', workflow: '.github/workflows/test.yml', job: 'test', step: 'Deploy', sha: repo.sha });
    expect(post.statuses().every((p) => p.body.state !== 'success')).toBe(true);
  });

  it.each([
    ['unfetchable head', { kind: 'unfetchable-head', message: 'cannot fetch' }],
    ['unprovidable Node', { kind: 'node-version', message: 'required Node 22 cannot be provided' }],
    ['secrets', { kind: 'secrets', message: 'secrets file unreadable' }],
  ])('transient runner failure (%s) never becomes success and publishes nothing but the pending (which stays and vetoes)', async (_n, failure) => {
    const repo = repoWith();
    const runGate = jest.fn(() => ({ ok: false, sha: repo.sha, error: failure.message, failures: [{ ...failure, step: null, node: null, sha: repo.sha }], unmirrored: [], nodes: [] }));
    const { deps, post } = makeDeps({ runGate, prInfo: prInfoFor(repo) });
    const r = await cli.runGateFlow(gatePayload(repo), deps);
    expect(r).toMatchObject({ ok: false, mergeReady: false, posted: false, pendingRemains: true });
    expect(post.statuses().map((p) => p.body.state)).toEqual(['pending']);
  });

  // Replaces the old 'runner error posts nothing' case: a runner-error is HEAD-BOUND (D1), so it is published as a failure
  // status, which is what lets it veto green hosted CI; it still never becomes success.
  it('a runner error never becomes success; it posts the pending and then exactly one failure status', async () => {
    const repo = repoWith();
    const runGate = jest.fn(() => ({ ok: false, sha: repo.sha, error: 'boom', failures: [{ kind: 'runner-error', message: 'boom', step: null, node: null, sha: repo.sha }], unmirrored: [], nodes: [] }));
    const { deps, post } = makeDeps({ runGate, prInfo: prInfoFor(repo) });
    const r = await cli.runGateFlow(gatePayload(repo), deps);
    expect(r).toMatchObject({ ok: false, mergeReady: false, posted: true });
    expect(post.statuses().map((p) => p.body.state)).toEqual(['pending', 'failure']);
    expect(post.statuses()[1].body.description).toBe(`ci-local refused (runner-error): clean clone @ ${repo.sha.slice(0, 8)}`);
  });

  it('a runner claiming ok with zero nodes or failures present is not success', async () => {
    const repo = repoWith();
    for (const result of [
      { ok: true, sha: repo.sha, failures: [], unmirrored: [], nodes: [] },
      { ok: true, sha: repo.sha, failures: [{ kind: 'step-failed', step: 's', node: 22, sha: repo.sha, message: 'm' }], unmirrored: [], nodes: [{ node: 22, ok: true }] },
    ]) {
      const { deps, post } = makeDeps({ runGate: () => result, prInfo: prInfoFor(repo) });
      const r = await cli.runGateFlow(gatePayload(repo), deps);
      expect(r.mergeReady).toBe(false);
      expect(post.statuses().every((p) => p.body.state !== 'success')).toBe(true);
    }
  });
});

describe('CLI boundary and output', () => {
  const run = (args, input) => spawnSync(process.execPath, [CLI_PATH, ...args], { input, encoding: 'utf8' });

  it('rejects malformed JSON with exit 1 and {error}', () => {
    const r = run(['config'], '{not json');
    expect(r.status).toBe(1);
    expect(JSON.parse(r.stdout).error).toMatch(/invalid JSON/);
  });

  it('rejects oversized payloads before parsing, with no side effects', () => {
    const big = JSON.stringify({ reviews: [], pad: 'x'.repeat(cli.MAX_STDIN_BYTES) });
    const r = run(['review'], big);
    expect(r.status).toBe(1);
    expect(JSON.parse(r.stdout).error).toMatch(/exceeds/);
  });

  it('rejects unknown and prototype-named subcommands', () => {
    for (const name of ['nope', 'constructor', '__proto__', 'toString']) {
      const r = run([name], '{}');
      expect(r.status).toBe(1);
      expect(JSON.parse(r.stdout).error).toMatch(/Unknown subcommand/);
    }
    expect(run([], '{}').status).toBe(1);
  });

  it('a gate refusal exits 1; a ready merge exits 0, through the real process', () => {
    const fx = repoWith();
    const blob = fx.git('rev-parse', `${fx.baseRef}:.ensemble/local-ci.yaml`);
    const record = buildRecord({ runnerBlobSha: blob, workflowSet: WORKFLOW_SET, log: 'run' });
    const verifiedStatus = { context: CONTEXT, state: 'success', description: record.description, sha: fx.sha };
    const fakeDir = fakeGhDir({ baseRefName: 'trusted-base', headRefOid: fx.sha, state: 'OPEN' }, { statuses: asGithub([verifiedStatus]) });
    const env = { ...process.env, PATH: fakeDir + path.delimiter + process.env.PATH };
    const runGh = (args, input) => spawnSync(process.execPath, [CLI_PATH, ...args], { input, encoding: 'utf8', env });
    const ok = runGh(['merge'], JSON.stringify({ headSha: fx.sha, repoRoot: fx.dir, baseRef: fx.baseRef, repo: 'owner/name', pr: PR, statuses: [verifiedStatus] }));
    expect(ok.status).toBe(0);
    expect(JSON.parse(ok.stdout).mergeReady).toBe(true);
    const no = runGh(['merge'], JSON.stringify({ headSha: fx.sha, repoRoot: fx.dir, baseRef: fx.baseRef, repo: 'owner/name', pr: PR, statuses: [] }));
    expect(no.status).toBe(1);
    expect(JSON.parse(no.stdout).mergeReady).toBe(false);
  });

  it('redacts secrets in everything it emits', async () => {
    const token = 'ghp_' + 'A'.repeat(36);
    const repo = repoWith();
    const runGate = () => ({
      ok: false,
      sha: repo.sha,
      error: `clone failed with ${token}`,
      failures: [{ kind: 'step-failed', step: 'test', node: 22, sha: repo.sha, message: `leaked ${token}` }],
      unmirrored: [],
      nodes: [],
    });
    const { deps } = makeDeps({ runGate, prInfo: prInfoFor(repo) });
    let out = '';
    const code = await cli.main(['gate'], { ...deps, io: { readJson: () => gatePayload(repo), write: (s) => (out += s) } });
    expect(code).toBe(1);
    expect(out).not.toContain(token);
    expect(out).toContain('[REDACTED]');
  });

  it('delegating subcommands return the module verdicts verbatim', async () => {
    const call = async (sub, payload, injected = {}) => {
      let out = '';
      const code = await cli.main([sub], { ...cli.defaultDeps(), ...injected, io: { readJson: () => payload, write: (s) => (out += s) } });
      return { code, body: JSON.parse(out) };
    };
    const fx = repoWith();
    expect((await call('config', { repoRoot: fx.dir, baseRef: fx.baseRef })).body.approvalSet.statusContext).toBe(CONTEXT);
    const built = await call('record', { action: 'build', input: { runnerBlobSha: 'c0ffee123456', workflowSet: WORKFLOW_SET, log: 'l' } });
    expect(built.body.ok).toBe(true);
    expect((await call('record', { action: 'parse', input: built.body.description })).body.fields).toEqual(built.body.fields);
    expect((await call('record', { action: 'parse', input: 'garbage' })).code).toBe(1);
    expect((await call('review', { action: 'decide', reviews: 'nope' })).body.blocked).toBe(true);
    // `sweep` records what the tracker does not hold: the dedupe set comes from the tracker, never from the payload.
    const sweepFx = repoWith();
    sweepFx.git('checkout', '-q', '--detach', sweepFx.baseSha); // the primary checkout sits on the base, as a maintainer's does
    sweepFx.git('remote', 'add', 'origin', 'https://github.com/owner/name.git'); // the checkout is the repository the sweep names
    const issues = [];
    const tracker = {
      run: (capability, args) =>
        capability === 'tracker.find-by-key'
          ? { ok: true, data: JSON.stringify({ issues }) }
          : (issues.push({ id: 'bd-1', external_ref: args.externalKey, status: 'open' }), { ok: true, data: { id: 'bd-1' } }),
    };
    const hostSays = () => ({ ok: true, isCrossRepository: false, headRefOid: sweepFx.sha, baseRefName: 'trusted-base', baseRefOid: sweepFx.baseSha, state: 'OPEN' });
    const sweepPayload = { facts: { findings: [{ prNumber: 1, commentId: 2 }], failures: [] }, repoRoot: sweepFx.dir, repo: 'owner/name', pr: PR, headSha: sweepFx.sha, baseSha: sweepFx.baseSha };
    const swept = await call('sweep', sweepPayload, { readPr: hostSays, trackerFor: () => tracker });
    expect(swept.code).toBe(0);
    expect(swept.body).toMatchObject({ ok: true, status: 'RECORDED', counts: { create: 1 }, beads: { 'finding:pr1:comment2': { action: 'create', beadId: 'bd-1' } } });
    expect((await call('sweep', sweepPayload, { readPr: hostSays, trackerFor: () => tracker })).body.counts).toEqual({ create: 0, skip: 1, error: 0 });
    const oldStyle = await call('sweep', { facts: sweepPayload.facts, trackedKeys: [] });
    expect(oldStyle.code).toBe(1);
    expect(oldStyle.body.error).toContain('trackedKeys');
    expect((await call('timing', { action: 'verdict', input: { localMs: 10, hostedMs: 20, toleranceMs: 1 } })).body.verdict).toBe('faster');
    expect((await call('timing', { action: 'ready', input: { note: '' } })).code).toBe(1);
    expect((await call('record', { action: 'constructor', input: {} })).code).toBe(1);
  });

  it('post where gh could not publish reports published:false with the reason', async () => {
    const post = fakePostStatus({ fail: 'gh not logged in' });
    const r = await cli.runPost(
      { input: { repo: 'owner/name', sha: OTHER, state: 'success', context: CONTEXT, description: 'd' } },
      { ...cli.defaultDeps(), postStatus: post }
    );
    expect(r).toMatchObject({ published: false, reason: 'gh not logged in' });
    expect(post.calls).toHaveLength(1);
  });

  it('the real process posts through gh as an argv array, with the maintainer login (no token on argv)', () => {
    const fx = repoWith();
    const ghDir = fakeGhDir({ baseRefName: 'trusted-base', headRefOid: fx.sha, state: 'OPEN' });
    const env = { ...process.env, PATH: ghDir + path.delimiter + process.env.PATH, GH_TOKEN: 'sekrit-token-value-1' };
    const input = { input: { repo: 'owner/name', sha: OTHER, state: 'success', context: CONTEXT, description: 'd' } };
    const r = spawnSync(process.execPath, [CLI_PATH, 'post'], { input: JSON.stringify(input), encoding: 'utf8', env });
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({ published: true, sha: OTHER, state: 'success', context: CONTEXT });
    expect(postedArgs(ghDir)).toEqual(['api', '-X', 'POST', `repos/owner/name/statuses/${OTHER}`, '-f', 'state=success', '-f', `context=${CONTEXT}`, '-f', 'description=d']);
    expect(r.stdout + r.stderr).not.toContain('sekrit-token-value-1');
  });

  it('the real process refuses (exit 1, nothing published) when gh cannot post', () => {
    const fx = repoWith();
    const ghDir = fakeGhDir({ baseRefName: 'trusted-base', headRefOid: fx.sha, state: 'OPEN' }, { postFails: true });
    const env = { ...process.env, PATH: ghDir + path.delimiter + process.env.PATH, GH_TOKEN: 'sekrit-token-value-1' };
    const input = { input: { repo: 'owner/name', sha: OTHER, state: 'success', context: CONTEXT, description: 'd' } };
    const r = spawnSync(process.execPath, [CLI_PATH, 'post'], { input: JSON.stringify(input), encoding: 'utf8', env });
    expect(JSON.parse(r.stdout)).toMatchObject({ published: false });
    expect(JSON.parse(r.stdout).reason).toMatch(/403/);
    expect(postedArgs(ghDir)).toEqual([]);
    expect(r.stdout + r.stderr).not.toContain('sekrit-token-value-1');
  });
});
