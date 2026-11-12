'use strict';

/**
 * Trust boundary of the local CI gate CLI: the approval set and the command list
 * come ONLY from the maintainer's .ensemble/local-ci.yaml as committed at the PR
 * BASE ref (`git show <baseRef>:...`); the checked-out head is never read. A caller
 * (the JSON payload) cannot supply, replace or shrink them, and cannot smuggle
 * runner options. Also: the merge/gate verdict logic is exercised THROUGH the CLI
 * entry points (human vs bot reviews, status-context case, result gating).
 * Real modules, real temp git repos; fake only the status publisher and the runner
 * result. No network, no real login.
 */

const fs = require('fs');
const path = require('path');

const cli = require('../lib/local-ci-cli');
const { validateConfig } = require('../lib/local-ci-config');
const { buildRecord } = require('../lib/local-ci-record');
const { makeBaseRepo, cleanupBaseRepos, prInfoFor, fakePostStatus, statusesApi, asGithub, PR, REPO, CONFIG_PATH } = require('./helpers/local-ci-base-repo');

const REPO_CONFIG = path.join(__dirname, '..', '..', '..', '.ensemble', 'local-ci.yaml');
const TRUSTED_TEXT = fs.readFileSync(REPO_CONFIG, 'utf8');
const TRUSTED = validateConfig(TRUSTED_TEXT);
const CONTEXT = TRUSTED.approvalSet.statusContext;
const WORKFLOW_SET = TRUSTED.approvalSet.workflows.map((w) => w.file);

afterAll(cleanupBaseRepos);

/** Real temp repo: `config` committed at the trusted base, a descendant head checked out. */
function maintainer(config = TRUSTED_TEXT, extra = {}) {
  const repo = makeBaseRepo({ config, ...extra });
  const blob = repo.git('rev-parse', `${repo.baseRef}:${CONFIG_PATH}`);
  return { ...repo, blob, short: blob.slice(0, 12) };
}

/** GitHub's honest answer when a test overrides the base ref: the PR targets that very branch. */
const prAnswer = (extra) => (extra.baseRef ? { baseRefName: extra.baseRef.replace(/^origin\//, '') } : {});

const passing = (sha) => ({ ok: true, sha, failures: [], unmirrored: [], nodes: [{ node: 22, ok: true, steps: [] }] });

function makeDeps(runGateImpl, fx, answer) {
  const post = fakePostStatus();
  const runGate = jest.fn(runGateImpl || ((o) => passing(o.headSha)));
  return { deps: { ...cli.defaultDeps(), postStatus: post, runGate, env: {}, prInfo: fx ? prInfoFor(fx, answer) : undefined }, post, runGate };
}

const SMUGGLED = [
  ['config', TRUSTED_TEXT],
  ['config', { workflows: [] }],
  ['path', '/tmp/attacker/local-ci.yaml'],
  ['ciScript', 'scripts/evil.js'],
  ['ciCommand', 'true'],
  ['ciSteps', [{ name: 'x', cmd: 'true' }]],
  ['extraSteps', [{ name: 'x', cmd: 'true' }]],
  ['runner', { nodeVersions: [22] }],
  ['runner', { ciCommand: 'true', env: { PATH: '/x' }, secretsFile: 'x', keep: true, remote: 'evil' }],
  ['options', { nodeVersions: [22] }],
  ['nodeVersions', [22]],
  ['approvalSet', { workflows: [] }],
];

describe('gate: payload cannot carry config or runner options', () => {
  it.each(SMUGGLED)('rejects payload key %s before anything runs or posts', async (key, value) => {
    const repo = maintainer();
    const { deps, post, runGate } = makeDeps(undefined, repo);
    await expect(
      cli.runGateFlow({ repoRoot: repo.dir, headSha: repo.sha, baseRef: repo.baseRef, repo: REPO, pr: PR, [key]: value }, deps)
    ).rejects.toThrow(new RegExp(`unknown payload key.*"${key}"`));
    expect(runGate).not.toHaveBeenCalled();
    expect(post.calls).toHaveLength(0);
  });

  it('baseRef is an allowed key: the same payload without a smuggled key goes through', async () => {
    const repo = maintainer();
    const { deps, runGate } = makeDeps(undefined, repo);
    await expect(cli.runGateFlow({ repoRoot: repo.dir, headSha: repo.sha, baseRef: repo.baseRef, repo: REPO, pr: PR, dryRun: true }, deps)).resolves.toMatchObject({ ok: true });
    expect(runGate).toHaveBeenCalledTimes(1);
  });

  it('a payload runner override cannot change the required Node versions: it is refused, the runner never sees it', async () => {
    const repo = maintainer();
    const { deps, runGate } = makeDeps(undefined, repo);
    await expect(
      cli.runGateFlow({ repoRoot: repo.dir, headSha: repo.sha, baseRef: repo.baseRef, repo: REPO, pr: PR, runner: { nodeVersions: [99] } }, deps)
    ).rejects.toThrow(/runner/);
    expect(runGate).not.toHaveBeenCalled();
    // and without the override the runner gets exactly the maintainer's matrix and only the documented option keys
    await cli.runGateFlow({ repoRoot: repo.dir, headSha: repo.sha, baseRef: repo.baseRef, repo: REPO, pr: PR, dryRun: true }, deps);
    const options = runGate.mock.calls[0][0];
    expect(Object.keys(options).sort()).toEqual(['approvalSet', 'equivalents', 'excludedSteps', 'failureLogDir', 'headSha', 'repoRoot', 'secretNames']);
    // where failing-step logs go is fixed by the CLI under the repo's gitignored runs directory, never taken from the payload
    expect(options.failureLogDir).toBe(require('path').join(repo.dir, '.ensemble', 'local-ci-runs', 'logs'));
    expect(options.approvalSet.checks.map((c) => c.matrix['node-version']).filter(Boolean)).toEqual([22, 24]);
  });

  it('the command list and approval set handed to the runner are the BASE-committed file, not the checked-out head', async () => {
    const baseText = TRUSTED_TEXT.replace('node-version: [22, 24]', 'node-version: [22]').replace('cmd: npm test', 'cmd: npm run test-trusted');
    const headText = TRUSTED_TEXT.replace('cmd: npm test', 'cmd: npm run test-attacker');
    const own = maintainer(baseText, { headFiles: { [CONFIG_PATH]: headText } });
    expect(fs.readFileSync(path.join(own.dir, CONFIG_PATH), 'utf8')).toBe(headText); // head really is checked out
    const { deps, runGate } = makeDeps(undefined, own);
    await cli.runGateFlow({ repoRoot: own.dir, headSha: own.sha, baseRef: own.baseRef, repo: REPO, pr: PR, dryRun: true }, deps);
    const { approvalSet } = runGate.mock.calls[0][0];
    const cmds = approvalSet.steps.map((s) => s.cmd);
    expect(cmds).toContain('npm run test-trusted');
    expect(cmds).not.toContain('npm run test-attacker');
    expect(approvalSet.checks.map((c) => c.matrix['node-version']).filter(Boolean)).toEqual([22]);
  });

  it('the CLI process boundary refuses a smuggled key with exit 1 and an {error}', async () => {
    const repo = maintainer();
    let out = '';
    const code = await cli.main(['gate'], {
      ...makeDeps(undefined, repo).deps,
      io: { readJson: () => ({ repoRoot: repo.dir, headSha: repo.sha, baseRef: repo.baseRef, repo: REPO, pr: PR, config: TRUSTED_TEXT }), write: (s) => (out += s) },
    });
    expect(code).toBe(1);
    expect(JSON.parse(out).error).toMatch(/unknown payload key.*"config"/);
  });

  it('baseRef is required', async () => {
    const repo = maintainer();
    const { deps, runGate } = makeDeps(undefined, repo);
    await expect(cli.runGateFlow({ repoRoot: repo.dir, headSha: repo.sha, repo: REPO, pr: PR }, deps)).rejects.toThrow(/baseRef/);
    expect(runGate).not.toHaveBeenCalled();
  });
});

describe('merge: payload cannot carry config', () => {
  const repo = maintainer();
  const record = buildRecord({ runnerBlobSha: repo.short, workflowSet: WORKFLOW_SET, log: 'run' });
  const status = (over = {}) => ({ context: CONTEXT, state: 'success', description: record.description, sha: repo.sha, ...over });
  const merge = (extra = {}, over = {}) =>
    cli.runMerge({ headSha: repo.sha, baseRef: repo.baseRef, statuses: [status()], repoRoot: repo.dir, repo: REPO, pr: PR, ...extra }, { ...cli.defaultDeps(), prInfo: prInfoFor(repo, prAnswer(extra)), ghApi: statusesApi(asGithub([status()])), ...over });

  it('control: a status carrying the base config hash is merge-ready', () => {
    expect(merge()).toMatchObject({ ok: true, mergeReady: true });
  });

  it.each(SMUGGLED)('rejects payload key %s', (key, value) => {
    expect(() => merge({ [key]: value })).toThrow(new RegExp(`unknown payload key.*"${key}"`));
  });

  it('a caller-supplied config can no longer make a different workflow set or context pass', () => {
    const lax = TRUSTED_TEXT.replace(/status_context: .*/, 'status_context: attacker/ctx');
    expect(() => merge({ statuses: [status({ context: 'attacker/ctx' })], config: lax })).toThrow(/unknown payload key/);
    // without it the same status is not in the trusted context: no run
    expect(merge({ statuses: [status({ context: 'attacker/ctx' })] })).toMatchObject({ mergeReady: false, missingRun: true });
  });

  it('repoRoot is required: there is no fallback to the current directory', () => {
    expect(() => cli.runMerge({ headSha: repo.sha, baseRef: repo.baseRef, statuses: [status()], repo: REPO, pr: PR }, { ...cli.defaultDeps(), prInfo: prInfoFor(repo) })).toThrow(/repoRoot/);
  });

  it('baseRef is required', () => {
    expect(() => cli.runMerge({ headSha: repo.sha, statuses: [status()], repoRoot: repo.dir, repo: REPO, pr: PR }, { ...cli.defaultDeps(), prInfo: prInfoFor(repo) })).toThrow(/baseRef/);
  });

  it('a status whose record config hash differs from the trusted base blob is refused, naming both hashes', () => {
    const other = buildRecord({ runnerBlobSha: 'deadbeef1234', workflowSet: WORKFLOW_SET, log: 'run' });
    expect(other.ok).toBe(true); // a well-formed record under a DIFFERENT config: refused for that reason alone
    const r = merge({ statuses: [status({ description: other.description })] });
    expect(r.mergeReady).toBe(false);
    expect(r.reason).toContain('deadbeef1234');
    expect(r.reason).toContain(repo.short);
  });

  it('a head that edits the config does not change what the record is checked against', () => {
    const edited = maintainer(TRUSTED_TEXT, { headFiles: { [CONFIG_PATH]: TRUSTED_TEXT + '\n# head edit\n' } });
    const headBlob = edited.git('rev-parse', `HEAD:${CONFIG_PATH}`);
    expect(headBlob).not.toBe(edited.blob);
    const rec = buildRecord({ runnerBlobSha: headBlob.slice(0, 12), workflowSet: WORKFLOW_SET, log: 'run' });
    const r = cli.runMerge(
      { headSha: edited.sha, baseRef: edited.baseRef, repoRoot: edited.dir, statuses: [{ context: CONTEXT, state: 'success', description: rec.description, sha: edited.sha }], repo: REPO, pr: PR },
      { ...cli.defaultDeps(), prInfo: prInfoFor(edited) }
    );
    expect(r.mergeReady).toBe(false);
  });

  it('a remote-tracking base ref equal to the head is refused (the head cannot be its own base)', () => {
    repo.git('update-ref', 'refs/remotes/origin/pr-self', repo.sha);
    const r = merge({ baseRef: 'origin/pr-self' });
    expect(r.mergeReady).toBe(false);
    expect(r.reason).toMatch(/own base/);
  });

  it('the head SHA itself is not accepted as a base ref at all (boundary refusal)', () => {
    expect(() => merge({ baseRef: repo.sha })).toThrow(/baseRef/);
  });

  it('a maintainer config without steps is refused (the command list is required)', () => {
    const bad = maintainer(TRUSTED_TEXT.replace(/\nsteps:[\s\S]*?\n# A workflow step covered/, '\n# A workflow step covered'));
    const r = cli.runMerge({ headSha: bad.sha, baseRef: bad.baseRef, statuses: [{ context: CONTEXT, state: 'success', description: record.description, sha: bad.sha }], repoRoot: bad.dir, repo: REPO, pr: PR }, { ...cli.defaultDeps(), prInfo: prInfoFor(bad) });
    expect(r.mergeReady).toBe(false);
    expect(r.reason).toMatch(/missing required key "steps"/);
  });

  it('no config at the base ref is refused even if the head has one', () => {
    const none = makeBaseRepo({ config: null, headFiles: { [CONFIG_PATH]: TRUSTED_TEXT } });
    const r = cli.runMerge({ headSha: none.sha, baseRef: none.baseRef, statuses: [status({ sha: none.sha })], repoRoot: none.dir, repo: REPO, pr: PR }, { ...cli.defaultDeps(), prInfo: prInfoFor(none) });
    expect(r.mergeReady).toBe(false);
  });
});

describe('run and config subcommands', () => {
  it('run accepts only repoRoot, headSha and baseRef and builds the runner options from the base-committed file', async () => {
    const repo = maintainer();
    const { deps, runGate } = makeDeps(undefined, repo);
    await cli.runRun({ repoRoot: repo.dir, headSha: repo.sha, baseRef: repo.baseRef }, deps);
    expect(runGate.mock.calls[0][0].approvalSet).toEqual(TRUSTED.approvalSet);
    for (const bad of [{ options: { nodeVersions: [1] } }, { config: TRUSTED_TEXT }, { remote: 'x' }, { keep: true }, { env: {} }]) {
      await expect(cli.runRun({ repoRoot: repo.dir, headSha: repo.sha, baseRef: repo.baseRef, ...bad }, deps)).rejects.toThrow(/unknown payload key/);
    }
    expect(runGate).toHaveBeenCalledTimes(1);
  });

  it('run requires baseRef and refuses a base equal to the head without running', async () => {
    const repo = maintainer();
    const { deps, runGate } = makeDeps(undefined, repo);
    await expect(cli.runRun({ repoRoot: repo.dir, headSha: repo.sha }, deps)).rejects.toThrow(/baseRef/);
    repo.git('update-ref', 'refs/remotes/origin/pr-self', repo.sha);
    const r = await cli.runRun({ repoRoot: repo.dir, headSha: repo.sha, baseRef: 'origin/pr-self' }, deps);
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).toMatch(/own base/);
    await expect(cli.runRun({ repoRoot: repo.dir, headSha: repo.sha, baseRef: repo.sha }, deps)).rejects.toThrow(/baseRef/);
    expect(runGate).not.toHaveBeenCalled();
  });

  it('config accepts source text for validation or a repoRoot plus baseRef, never an arbitrary path', () => {
    const repo = maintainer();
    expect(cli.runConfig({ source: TRUSTED_TEXT }, cli.defaultDeps()).ok).toBe(true);
    expect(cli.runConfig({ repoRoot: repo.dir, baseRef: repo.baseRef }, cli.defaultDeps()).approvalSet.statusContext).toBe(CONTEXT);
    expect(() => cli.runConfig({ repoRoot: repo.dir }, cli.defaultDeps())).toThrow(/baseRef/);
    expect(() => cli.runConfig({ path: REPO_CONFIG }, cli.defaultDeps())).toThrow(/unknown payload key.*"path"/);
  });

  it('config reads the base-committed file, not the working tree', () => {
    const repo = maintainer(TRUSTED_TEXT, { headFiles: { [CONFIG_PATH]: TRUSTED_TEXT.replace(/status_context: .*/, 'status_context: attacker/ctx') } });
    expect(cli.runConfig({ repoRoot: repo.dir, baseRef: repo.baseRef }, cli.defaultDeps()).approvalSet.statusContext).toBe(CONTEXT);
  });
});

describe('merge through the CLI: reviews and context matching', () => {
  const repo = maintainer();
  const HEAD = repo.sha;
  const record = buildRecord({ runnerBlobSha: repo.short, workflowSet: WORKFLOW_SET, log: 'run' });
  const status = (over = {}) => ({ context: CONTEXT, state: 'success', description: record.description, sha: HEAD, ...over });
  const merge = (extra = {}, statuses = [status()]) => cli.runMerge({ headSha: HEAD, baseRef: repo.baseRef, statuses, repoRoot: repo.dir, repo: REPO, pr: PR, ...extra }, { ...cli.defaultDeps(), prInfo: prInfoFor(repo), ghApi: statusesApi(asGithub(statuses)) });
  const review = (login, type, state, submittedAt) => ({ author: { login, type }, state, submittedAt });

  it('a human reviewer whose latest decisive review is CHANGES_REQUESTED blocks the merge', () => {
    const r = merge({ reviews: [review('alice', 'User', 'CHANGES_REQUESTED', '2026-01-01T00:00:00Z')] });
    expect(r).toMatchObject({ ok: false, mergeReady: false });
    expect(r.reason).toMatch(/blocked by review/);
    expect(r.reviewers).toEqual(['alice']);
  });

  it('a BOT requesting changes never blocks, even alone', () => {
    const r = merge({ reviews: [review('coderabbitai[bot]', 'Bot', 'CHANGES_REQUESTED', '2026-01-01T00:00:00Z')] });
    expect(r).toMatchObject({ ok: true, mergeReady: true });
  });

  it('a bot never masks a human: both requesting changes still blocks, naming only the human', () => {
    const r = merge({
      reviews: [
        review('coderabbitai[bot]', 'Bot', 'CHANGES_REQUESTED', '2026-01-01T00:00:00Z'),
        review('alice', 'User', 'CHANGES_REQUESTED', '2026-01-02T00:00:00Z'),
      ],
    });
    expect(r.mergeReady).toBe(false);
    expect(r.reviewers).toEqual(['alice']);
  });

  it('a human who later approved no longer blocks; omitting reviews consults nothing', () => {
    expect(
      merge({ reviews: [review('alice', 'User', 'CHANGES_REQUESTED', '2026-01-01T00:00:00Z'), review('alice', 'User', 'APPROVED', '2026-01-02T00:00:00Z')] }).mergeReady
    ).toBe(true);
    expect(merge().mergeReady).toBe(true);
  });

  it('an unreadable reviews value blocks (fail closed), it is not ignored', () => {
    expect(merge({ reviews: 'nope' }).mergeReady).toBe(false);
  });

  it('status contexts match case-insensitively; the status SHA too', () => {
    expect(merge({}, [status({ context: CONTEXT.toUpperCase() })]).mergeReady).toBe(true);
    expect(merge({}, [status({ context: CONTEXT.toLowerCase() })]).mergeReady).toBe(true);
    expect(merge({}, [status({ sha: HEAD.toUpperCase() })]).mergeReady).toBe(true);
    // a different context is still not ours
    expect(merge({}, [status({ context: `${CONTEXT}-other` })]).missingRun).toBe(true);
  });

  it('an upper-case head SHA in the payload matches a lower-case status SHA', () => {
    const r = merge({ headSha: HEAD.toUpperCase() });
    expect(r.mergeReady).toBe(true);
  });
});

describe('gate through the CLI: a pass needs ok, no failures, no unmirrored steps and passing nodes', () => {
  const nodesOk = [{ node: 22, ok: true, steps: [] }];
  const run = async (mk) => {
    const repo = maintainer();
    const { deps, post } = makeDeps(() => mk(repo.sha), repo);
    const r = await cli.runGateFlow({ repoRoot: repo.dir, headSha: repo.sha, baseRef: repo.baseRef, repo: REPO, pr: PR }, deps);
    return { r, posts: post.statuses().map((p) => p.body.state) };
  };
  const fail = (sha) => ({ kind: 'step-failed', step: 's', node: 22, sha, message: 'm' });

  it('control: a clean result is success and posts the exact configured context', async () => {
    const repo = maintainer();
    const { deps, post } = makeDeps(undefined, repo);
    const r = await cli.runGateFlow({ repoRoot: repo.dir, headSha: repo.sha, baseRef: repo.baseRef, repo: REPO, pr: PR }, deps);
    expect(r).toMatchObject({ ok: true, posted: true, mergeReady: true });
    expect(post.statuses().map((p) => p.body.state)).toEqual(['pending', 'success']);
    expect(post.statuses()[1].body).toMatchObject({ state: 'success', context: CONTEXT });
  });

  it('ok:true with a recorded failure is NOT success', async () => {
    const { r, posts } = await run((sha) => ({ ok: true, sha, failures: [fail(sha)], unmirrored: [], nodes: nodesOk }));
    expect(r).toMatchObject({ ok: false, mergeReady: false });
    expect(posts).not.toContain('success');
  });

  it('ok:true with an unmirrored step is NOT success', async () => {
    const { r, posts } = await run((sha) => ({
      ok: true,
      sha,
      failures: [],
      unmirrored: [{ workflow: 'w.yml', job: 'j', step: 'Deploy', reason: 'no configured step mirrors it' }],
      nodes: nodesOk,
    }));
    expect(r).toMatchObject({ ok: false, mergeReady: false });
    expect(posts).not.toContain('success');
  });

  it('ok:true with a failed node is NOT success', async () => {
    const { r } = await run((sha) => ({ ok: true, sha, failures: [], unmirrored: [], nodes: [{ node: 22, ok: true }, { node: 24, ok: false }] }));
    expect(r.mergeReady).toBe(false);
  });

  it('the success record is bound to the trusted base config blob (git rev-parse <baseRef>:path), not to the head file', async () => {
    const repo = maintainer(TRUSTED_TEXT, { headFiles: { [CONFIG_PATH]: TRUSTED_TEXT + '\n# head edit\n' } });
    const { deps, post } = makeDeps(undefined, repo);
    const r = await cli.runGateFlow({ repoRoot: repo.dir, headSha: repo.sha, baseRef: repo.baseRef, repo: REPO, pr: PR }, deps);
    const baseBlob = repo.git('rev-parse', `${repo.baseRef}:${CONFIG_PATH}`);
    const headBlob = repo.git('hash-object', path.join(repo.dir, CONFIG_PATH));
    expect(headBlob).not.toBe(baseBlob);
    expect(r.record.runner).toBe(baseBlob.slice(0, 12));
    expect(r.record.runner).not.toBe(headBlob.slice(0, 12));
    expect(post.statuses()[1].body.description).toContain(`ci-local ${baseBlob.slice(0, 12)}`);
  });

  it('a base ref that is the head, or does not resolve, posts nothing and runs nothing', async () => {
    const repo = maintainer();
    repo.git('update-ref', 'refs/remotes/origin/pr-self', repo.sha);
    const { deps, post, runGate } = makeDeps(undefined, repo);
    // a real remote-tracking ref at the head, and a well-formed one that does not exist: refused by the gate, not the boundary
    for (const baseRef of ['origin/pr-self', 'origin/no-such-branch']) {
      const honestPr = { ...deps, prInfo: prInfoFor(repo, { baseRefName: baseRef.replace(/^origin\//, '') }) };
      const r = await cli.runGateFlow({ repoRoot: repo.dir, headSha: repo.sha, baseRef, repo: REPO, pr: PR }, honestPr);
      expect(r).toMatchObject({ ok: false, posted: false, mergeReady: false });
    }
    // the head's own SHA, and a bare local branch name, are not remote-tracking refs: refused at the boundary
    for (const baseRef of [repo.sha, 'no-such-branch']) {
      await expect(cli.runGateFlow({ repoRoot: repo.dir, headSha: repo.sha, baseRef, repo: REPO, pr: PR }, deps)).rejects.toThrow(/baseRef/);
    }
    expect(runGate).not.toHaveBeenCalled();
    expect(post.calls).toHaveLength(0);
  });
});
