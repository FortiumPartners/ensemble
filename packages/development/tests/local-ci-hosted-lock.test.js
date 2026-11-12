'use strict';

/**
 * Hosted-CI reuse (kata fwj0) meeting the gate lock (kata mjyc) in `gate` (kata ehsm). The two changes were built apart and
 * meet in one function, so the property to prove is the ORDER: PR identity and config first, then the hosted check, then
 * the lock, then the run. The hosted check only reads GitHub and runs nothing, so it sits OUTSIDE the lock: a gate that
 * accepts hosted CI never queues behind a running gate and never takes the lock. A gate that does not accept it (hosted
 * refused, `forceLocal`, no opt-in) takes the lock like any other, and one that cannot have it stops at `stage:"lock"`
 * with nothing run or posted, still saying why hosted CI was not used. `merge` and `run` are not changed by the meeting:
 * `merge` never takes the lock, `run` never consults hosted CI.
 * Layers: in-process with a REAL lock in a private directory that a live process (this one) holds; and the real CLI as a
 * process against that same kind of lock, with a fake `gh` on PATH and real git.
 * Fake: GitHub (PR identity, Actions lookups), the runner result and the status publisher.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const cli = require('../lib/local-ci-cli');
const lock = require('../lib/local-ci-lock');
const { cleanupBaseRepos, prInfoFor, fakePostStatus } = require('./helpers/local-ci-base-repo');
const H = require('./helpers/local-ci-hosted');

const { REPO, PR, VALIDATE, TEST } = H;
const GIT = H.memoGit();
const CLI_PATH = path.join(__dirname, '..', 'lib', 'local-ci-cli.js');

const scratch = [];
const tmpDir = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'local-ci-hosted-lock-'));
  scratch.push(d);
  return d;
};
afterAll(() => {
  cleanupBaseRepos();
  H.cleanupHostedFixtures();
  for (const d of scratch.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const fx = H.hostedRepo(); //                                       opted in to hosted reuse
const plain = H.hostedRepo({ config: H.CONFIG_WITHOUT_HOSTED }); // the same config without the opt-in
const HEAD = fx.headSha;

const passingRun = (options) => ({ ok: true, sha: options.headSha, failures: [], unmirrored: [], nodes: [{ node: 22, ok: true, steps: [] }, { node: 24, ok: true, steps: [] }] });
const redTest = (head) => H.swap(H.honest(head), TEST, (e) => H.withJob(e, 'test (24)', { conclusion: 'failure' }));
const gatePayload = (repo, extra) => ({ repoRoot: repo.dir, headSha: repo.headSha, baseRef: repo.baseRef, repo: REPO, pr: PR, ...extra });

const lockPathOf = (dir) => path.join(dir, lock.LOCK_FILE);
/** A live holder: this very process, so its lock is honoured (never reclaimed) and a waiter with a zero timeout gives up. */
function holdLock(dir) {
  const holder = { pid: process.pid, host: os.hostname(), token: 'busy-gate', acquiredAt: '2026-01-01T00:00:00.000Z' };
  fs.writeFileSync(lockPathOf(dir), JSON.stringify(holder));
  return holder;
}

/**
 * Deps for `gate` in-process: real git, a REAL lock in a private directory (zero wait), spies for everything whose order
 * or absence is asserted. `order` records, in sequence, each GitHub lookup, each lock request and the run.
 */
function setup(repo, { held = false, entries = H.honest(repo.headSha), runGate = passingRun } = {}) {
  const lockDir = tmpDir();
  const holder = held ? holdLock(lockDir) : null;
  const order = [];
  const seen = {};
  const inner = H.actionsApi(entries);
  const ghApi = Object.assign((apiPath) => {
    order.push('lookup');
    return inner(apiPath);
  }, { calls: inner.calls });
  const acquireGateLock = jest.fn((hold) => {
    order.push('lock');
    return lock.acquireFromEnv({ ENSEMBLE_LOCAL_CI_LOCK_DIR: lockDir, ENSEMBLE_LOCAL_CI_LOCK_TIMEOUT_MS: '0' }, undefined, hold);
  });
  const run = jest.fn((options) => {
    order.push('run');
    seen.lockFileDuringRun = fs.existsSync(lockPathOf(lockDir));
    return runGate(options);
  });
  const post = fakePostStatus();
  const deps = { ...cli.defaultDeps(), git: GIT, env: {}, prInfo: prInfoFor(repo), ghApi, postStatus: post, runGate: run, acquireGateLock };
  return { deps, order, seen, ghApi, acquireGateLock, runGate: run, post, lockDir, holder };
}
const holderUntouched = (s) => expect(JSON.parse(fs.readFileSync(lockPathOf(s.lockDir), 'utf8'))).toEqual(s.holder);

describe('gate: the hosted check is made BEFORE the lock, so accepting hosted CI never queues and never locks', () => {
  it.each([
    ['a live process holds the lock', true],
    ['the lock is free', false],
  ])('(a) hosted CI green and %s: stage hosted, the lock is never asked for and nothing is run or posted', async (_n, held) => {
    const s = setup(fx, { held });
    const r = await cli.runGateFlow(gatePayload(fx), s.deps);
    expect(r).toMatchObject({ ok: true, stage: 'hosted', source: 'hosted', ranLocally: false, mergeReady: true, posted: false });
    expect(r.queued_ms).toBeUndefined();
    expect(s.acquireGateLock).not.toHaveBeenCalled();
    expect(s.runGate).not.toHaveBeenCalled();
    expect(s.post.calls).toEqual([]);
    expect(s.order.every((step) => step === 'lookup')).toBe(true);
    expect(s.ghApi.calls.length).toBeGreaterThan(0);
    if (held) holderUntouched(s);
    else expect(fs.existsSync(lockPathOf(s.lockDir))).toBe(false);
  });

  it('(b) hosted CI refused, lock free: every lookup comes before the single lock request, which brackets the run and nothing else', async () => {
    const s = setup(fx, { entries: redTest(HEAD) });
    const r = await cli.runGateFlow(gatePayload(fx), s.deps);
    expect(r).toMatchObject({ ok: true, mergeReady: true, posted: true, stage: 'attest', queued_ms: expect.any(Number) });
    expect(r.hostedRefused).toMatch(/^hosted CI not accepted: .*concluded failure/);
    expect(r.source).toBeUndefined();
    expect(s.order.filter((step) => step === 'lookup').length).toBeGreaterThan(0);
    expect(s.order.filter((step) => step === 'lock')).toHaveLength(1);
    expect(s.order.indexOf('lock')).toBeGreaterThan(s.order.lastIndexOf('lookup'));
    expect(s.order[s.order.length - 1]).toBe('run');
    expect(s.acquireGateLock).toHaveBeenCalledWith({ worstCaseHoldMs: expect.any(Number) });
    expect(s.seen.lockFileDuringRun).toBe(true);
    expect(s.post.statuses().map((p) => p.body.state)).toEqual(['pending', 'success']); // the pending is written ahead, inside the lock
    expect(fs.existsSync(lockPathOf(s.lockDir))).toBe(false); // released
  });

  it('(c) hosted CI refused and a live process holds the lock: stage lock, nothing run or posted, and the report still says why hosted CI was not used', async () => {
    const s = setup(fx, { held: true, entries: redTest(HEAD) });
    const r = await cli.runGateFlow(gatePayload(fx), s.deps);
    expect(r).toMatchObject({ ok: false, stage: 'lock', errorCode: 'lock-timeout', mergeReady: false, posted: false, lockHolder: { token: 'busy-gate' } });
    expect(r.hostedRefused).toMatch(/^hosted CI not accepted: .*concluded failure/);
    expect(r.error).toContain('lock-timeout');
    expect(r.source).toBeUndefined();
    expect(s.runGate).not.toHaveBeenCalled();
    expect(s.post.calls).toEqual([]);
    holderUntouched(s);
  });

  it('(d) forceLocal and a live holder: stage lock, hosted CI is never consulted, nothing is run or posted', async () => {
    const s = setup(fx, { held: true });
    const r = await cli.runGateFlow(gatePayload(fx, { forceLocal: true }), s.deps);
    expect(r).toMatchObject({ ok: false, stage: 'lock', errorCode: 'lock-timeout', posted: false });
    expect(r.hostedRefused).toBeUndefined();
    expect(s.ghApi.calls).toEqual([]);
    expect(s.order).toEqual(['lock']);
    expect(s.runGate).not.toHaveBeenCalled();
    expect(s.post.calls).toEqual([]);
    holderUntouched(s);
  });

  it('(e) a base config without hosted_reuse and a live holder: the pre-change lock refusal, with no hosted lookup and no hosted field', async () => {
    const s = setup(plain, { held: true });
    const r = await cli.runGateFlow(gatePayload(plain), s.deps);
    expect(r).toMatchObject({ ok: false, stage: 'lock', errorCode: 'lock-timeout', posted: false });
    expect(r.hostedRefused).toBeUndefined();
    expect(r.source).toBeUndefined();
    expect(s.ghApi.calls).toEqual([]);
    expect(s.runGate).not.toHaveBeenCalled();
    holderUntouched(s);
  });

  it('(f) a PR that rewrote a hosted workflow is refused for reuse, then needs the lock like any other local run', async () => {
    const forged = H.hostedRepo({ headFiles: { [VALIDATE]: H.WORKFLOW_FILES[VALIDATE].replace('npm run validate', 'true') } });
    const s = setup(forged, { held: true });
    const r = await cli.runGateFlow(gatePayload(forged), s.deps);
    expect(r).toMatchObject({ ok: false, stage: 'lock', errorCode: 'lock-timeout' });
    expect(r.hostedRefused).toContain(`${VALIDATE} at the PR head differs from the base ref`);
    expect(s.runGate).not.toHaveBeenCalled();
    expect(s.ghApi.calls).toEqual([]); // refused from the git blobs, before GitHub was asked
  });
});

describe('merge and run are not changed by the meeting', () => {
  it('(g) merge accepts hosted CI without ever asking for the lock', () => {
    const s = setup(fx, { held: true });
    const r = cli.runMerge({ ...gatePayload(fx), statuses: [] }, s.deps);
    expect(r).toMatchObject({ ok: true, mergeReady: true, source: 'hosted', headSha: HEAD });
    expect(s.acquireGateLock).not.toHaveBeenCalled();
    expect(s.runGate).not.toHaveBeenCalled();
  });

  it('(h) run never consults hosted CI: with hosted CI green it still queues for the lock and runs locally', async () => {
    const s = setup(fx);
    const r = await cli.runRun({ repoRoot: fx.dir, headSha: HEAD, baseRef: fx.baseRef }, s.deps);
    expect(r).toMatchObject({ ok: true, queued_ms: expect.any(Number) });
    expect(r.source).toBeUndefined();
    expect(s.ghApi.calls).toEqual([]);
    expect(s.acquireGateLock).toHaveBeenCalledTimes(1);
    expect(s.runGate).toHaveBeenCalledTimes(1);
    expect(s.post.calls).toEqual([]);
  });

  it('(h) run with a live holder is refused at the lock exactly as before, hosted CI green or not', async () => {
    const s = setup(fx, { held: true });
    const r = await cli.runRun({ repoRoot: fx.dir, headSha: HEAD, baseRef: fx.baseRef }, s.deps);
    expect(r).toMatchObject({ ok: false, stage: 'lock', errorCode: 'lock-timeout' });
    expect(s.ghApi.calls).toEqual([]);
    expect(s.runGate).not.toHaveBeenCalled();
  });
});

describe('through the real CLI process, with a live process holding the gate lock', () => {
  const prAnswer = { baseRefName: 'trusted-base', headRefOid: HEAD, state: 'OPEN' };
  const run = (payload, ghDir, lockDir) =>
    spawnSync(process.execPath, [CLI_PATH, 'gate'], {
      input: JSON.stringify(payload),
      encoding: 'utf8',
      env: { ...process.env, PATH: `${ghDir}${path.delimiter}${process.env.PATH}`, ENSEMBLE_LOCAL_CI_LOCK_DIR: lockDir, ENSEMBLE_LOCAL_CI_LOCK_TIMEOUT_MS: '0' },
    });
  const heldDir = () => {
    const dir = tmpDir();
    return { dir, holder: holdLock(dir) };
  };

  it('(i) hosted CI green: exit 0, stage hosted, the holder\'s lock file exactly as it was, gh asked only for the PR and the Actions lookups', () => {
    const { dir, holder } = heldDir();
    const gh = H.fakeGhActionsDir({ pr: prAnswer, entries: H.honest(HEAD), head: HEAD });
    const r = run(gatePayload(fx, { dryRun: false }), gh, dir);
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({ ok: true, stage: 'hosted', source: 'hosted', ranLocally: false, posted: false, mergeReady: true });
    expect(JSON.parse(fs.readFileSync(lockPathOf(dir), 'utf8'))).toEqual(holder);
    const asked = H.ghInvocations(gh);
    expect(asked[0]).toEqual(['pr', 'view', String(PR), '--repo', REPO, '--json', 'baseRefName,headRefOid,state']);
    expect(asked.slice(1).every((argv) => (argv[0] === 'pr' && argv[1] === 'view') || (argv[0] === 'api' && /^repos\/o\/r\/(actions\/runs|commits\/[0-9a-f]{40}\/statuses)/.test(argv[1])))).toBe(true);
  });

  it('(j) hosted CI red: exit 1, stage lock (lock-timeout), hostedRefused names the red job, and gh was asked for nothing to post', () => {
    const { dir, holder } = heldDir();
    const gh = H.fakeGhActionsDir({ pr: prAnswer, entries: redTest(HEAD), head: HEAD });
    const r = run(gatePayload(fx), gh, dir);
    expect(r.status).toBe(1);
    const body = JSON.parse(r.stdout);
    expect(body).toMatchObject({ ok: false, stage: 'lock', errorCode: 'lock-timeout', posted: false, mergeReady: false });
    expect(body.hostedRefused).toContain('job "test (24)" of run 102 concluded failure, not success');
    expect(JSON.parse(fs.readFileSync(lockPathOf(dir), 'utf8'))).toEqual(holder);
    expect(H.ghInvocations(gh).every((argv) => argv[0] === 'pr' || (argv[0] === 'api' && argv[1].includes('/actions/runs')))).toBe(true);
  });

  it('(k) forceLocal with hosted CI green: exit 1 at the lock, and gh was asked only for the PR, never for Actions', () => {
    const { dir } = heldDir();
    const gh = H.fakeGhActionsDir({ pr: prAnswer, entries: H.honest(HEAD), head: HEAD });
    const r = run(gatePayload(fx, { forceLocal: true }), gh, dir);
    expect(r.status).toBe(1);
    expect(JSON.parse(r.stdout)).toMatchObject({ ok: false, stage: 'lock', errorCode: 'lock-timeout' });
    expect(H.ghInvocations(gh)).toEqual([['pr', 'view', String(PR), '--repo', REPO, '--json', 'baseRefName,headRefOid,state']]);
  });
});
