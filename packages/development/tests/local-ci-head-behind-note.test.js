'use strict';

/**
 * Kata w6tn: a FAILED gate run whose head does not contain the base ref carries ONE advisory note (`head-behind-base`,
 * with the commit count) in its report. The note never changes a verdict, never appears on a pass or when the head
 * contains the base, and a git error means no note. Real git repos, the real CLI handlers, an injected runner result.
 */

const cli = require('../lib/local-ci-cli');
const { makeBaseRepo, cleanupBaseRepos, prInfoFor, fakePostStatus, REPO, PR } = require('./helpers/local-ci-base-repo');

afterAll(cleanupBaseRepos);

const major = Number(process.versions.node.split('.')[0]);
const CONFIG = `workflows:\n  - file: .github/workflows/ci.yml\n    jobs:\n      - id: ci\n        matrix:\n          node-version: [${major}]\nsteps:\n  - name: real-check\n    cmd: exit 1\nstatus_context: x/local-ci\n`;
const WF = 'name: ci\non: [push]\njobs:\n  ci:\n    runs-on: ubuntu-latest\n    steps:\n      - run: exit 1\n';

const failing = (options) => ({
  ok: false,
  sha: options.headSha,
  failures: [{ kind: 'step-failed', step: 'real-check', node: major, sha: options.headSha, message: 'boom' }],
  unmirrored: [],
  nodes: [{ node: major, ok: false, steps: [] }],
});
const passing = (options) => ({ ok: true, sha: options.headSha, failures: [], unmirrored: [], nodes: [{ node: major, ok: true, steps: [] }] });

const repoFx = () => makeBaseRepo({ config: CONFIG, files: { '.github/workflows/ci.yml': WF } });
/** Move the base ref `n` commits ahead of where the head branched (the base gained commits the head lacks). */
function advanceBase(fx, n) {
  let tip = fx.baseSha;
  for (let i = 0; i < n; i++) tip = fx.git('commit-tree', `${fx.baseSha}^{tree}`, '-p', tip, '-m', `main ${i}`);
  fx.git('update-ref', `refs/remotes/${fx.baseRef}`, tip);
}
const payload = (fx, extra = {}) => ({ repoRoot: fx.dir, headSha: fx.headSha, baseRef: fx.baseRef, repo: REPO, pr: PR, dryRun: true, ...extra });
const mk = (fx, runGate, over = {}) => ({ ...cli.defaultDeps(), postStatus: fakePostStatus(), runGate, env: {}, prInfo: prInfoFor(fx), ...over });

describe('head-behind-base note', () => {
  test('gate: failing run, head behind base by 3 -> one note with the count; verdict fields as without it', async () => {
    const fx = repoFx();
    const control = await cli.runGateFlow(payload(fx), mk(fx, jest.fn(failing))); // head contains base: no note
    advanceBase(fx, 3);
    const r = await cli.runGateFlow(payload(fx), mk(fx, jest.fn(failing)));
    expect(r.notes).toHaveLength(1);
    expect(r.notes[0]).toMatchObject({ kind: 'head-behind-base', behind: 3, baseRef: fx.baseRef });
    expect(r.notes[0].message).toContain('behind origin/trusted-base by 3 commits');
    expect(r.notes[0].message).toContain('hosted CI grades the merge ref');
    const { notes, queued_ms: q1, ...rest } = r;
    const { queued_ms: q2, ...controlRest } = control;
    expect(control.notes).toBeUndefined();
    expect(rest).toEqual(controlRest);
    expect(r.ok).toBe(false);
    expect(r.mergeReady).toBe(false);
    expect(r.failures.map((f) => f.kind)).toEqual(['step-failed']);
  });

  test('gate: head contains the base -> no note', async () => {
    const fx = repoFx();
    const r = await cli.runGateFlow(payload(fx), mk(fx, jest.fn(failing)));
    expect(r.ok).toBe(false);
    expect(r.notes).toBeUndefined();
  });

  test('gate: a passing run behind the base -> no note, still passes', async () => {
    const fx = repoFx();
    advanceBase(fx, 2);
    const r = await cli.runGateFlow(payload(fx), mk(fx, jest.fn(passing)));
    expect(r.ok).toBe(true);
    expect(r.mergeReady).toBe(true);
    expect(r.notes).toBeUndefined();
  });

  test('gate: a git error while checking gives no note (fail safe) and the failure stands', async () => {
    const fx = repoFx();
    advanceBase(fx, 1);
    const real = cli.defaultDeps().git;
    const git = (args, cwd) => (args[0] === 'rev-list' ? { status: 128, stdout: '', stderr: 'fatal' } : real(args, cwd));
    const r = await cli.runGateFlow(payload(fx), mk(fx, jest.fn(failing), { git }));
    expect(r.ok).toBe(false);
    expect(r.notes).toBeUndefined();
  });

  test('run: failing run behind the base carries the note; passing and up-to-date runs do not', async () => {
    const fx = repoFx();
    const upToDate = await cli.runRun({ repoRoot: fx.dir, headSha: fx.headSha, baseRef: fx.baseRef }, mk(fx, jest.fn(failing)));
    expect(upToDate.notes).toBeUndefined();
    advanceBase(fx, 2);
    const bad = await cli.runRun({ repoRoot: fx.dir, headSha: fx.headSha, baseRef: fx.baseRef }, mk(fx, jest.fn(failing)));
    expect(bad.ok).toBe(false);
    expect(bad.notes).toEqual([expect.objectContaining({ kind: 'head-behind-base', behind: 2 })]);
    const good = await cli.runRun({ repoRoot: fx.dir, headSha: fx.headSha, baseRef: fx.baseRef }, mk(fx, jest.fn(passing)));
    expect(good.ok).toBe(true);
    expect(good.notes).toBeUndefined();
  });

  test('gate (NOT a dry run): the posted failure status is identical with and without the note, and the note rides the report', async () => {
    const control = repoFx();
    const cPoster = fakePostStatus();
    const c = await cli.runGateFlow(payload(control, { dryRun: false }), mk(control, jest.fn(failing), { postStatus: cPoster }));
    const fx = repoFx();
    advanceBase(fx, 4);
    const poster = fakePostStatus();
    const r = await cli.runGateFlow(payload(fx, { dryRun: false }), mk(fx, jest.fn(failing), { postStatus: poster }));
    expect(c.notes).toBeUndefined();
    expect(r.notes).toEqual([expect.objectContaining({ kind: 'head-behind-base', behind: 4 })]);
    const failurePosts = (p) => p.statuses().filter((x) => x.body.state === 'failure').map((x) => x.body.description.replace(/@ [0-9a-f]{8}/, '@ SHA'));
    expect(failurePosts(poster)).toHaveLength(1);
    expect(failurePosts(poster)).toEqual(failurePosts(cPoster));
    expect(poster.statuses().map((x) => x.body.state)).toEqual(cPoster.statuses().map((x) => x.body.state));
    for (const k of ['ok', 'mergeReady', 'posted', 'stage', 'pendingRemains']) expect(r[k]).toEqual(c[k]);
    expect(r.posted).toBe(true);
  });

  test('gate: the ancestry probe itself erroring (status other than 0/1) gives no note', async () => {
    const fx = repoFx();
    advanceBase(fx, 2);
    const real = cli.defaultDeps().git;
    const git = (args, cwd) => (args[0] === 'merge-base' && args[1] === '--is-ancestor' && args[2] === fx.git('rev-parse', fx.baseRef) ? { status: 128, stdout: '', stderr: 'fatal: not a valid object' } : real(args, cwd));
    const r = await cli.runGateFlow(payload(fx), mk(fx, jest.fn(failing), { git }));
    expect(r.ok).toBe(false);
    expect(r.failures.map((f) => f.kind)).toEqual(['step-failed']);
    expect(r.notes).toBeUndefined();
  });
});
