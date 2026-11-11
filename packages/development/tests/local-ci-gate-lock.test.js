'use strict';

/**
 * `gate` and `run` are serialized per user home (kata mjyc). Layers:
 *  - runGateFlow and runRun in-process: the lock brackets the run (and only the run), is released when the run throws,
 *    and a lock that cannot be had stops it before anything runs or posts.
 *  - the real CLI entry point against a real fixture repo: the CI step itself records when it started and finished, and
 *    the intervals must not overlap, for two gates, for a run started during a gate and for the gate the precheck
 *    starts. Fake: only `gh` and `npx` (no network, no Node download).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const cli = require('../lib/local-ci-cli');
const lock = require('../lib/local-ci-lock');
const { makeDeps } = require('../lib/review-precheck-cli');
const { runPrecheck } = require('../lib/pr-review-precheck');
const { makeBaseRepo, cleanupBaseRepos, prInfoFor, fakePostStatus, fakeGhDir, PR } = require('./helpers/local-ci-base-repo');

const CLI_PATH = path.join(__dirname, '..', 'lib', 'local-ci-cli.js');
const NODE_MAJOR = Number(process.versions.node.split('.')[0]);
const WORKFLOW = '.github/workflows/proof.yml';
const CONFIG_YAML = `workflows:
  - file: ${WORKFLOW}
    jobs:
      - id: proof
        matrix:
          node-version: [${NODE_MAJOR}]
steps:
  - name: unit-check
    cmd: node scripts/unit-check.js
status_context: ensemble/local-ci
`;
const WORKFLOW_YAML = `name: proof
on: [push]
jobs:
  proof:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: node scripts/unit-check.js
`;

const scratch = [];
const tmpDir = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'local-ci-gate-lock-'));
  scratch.push(d);
  return d;
};
afterAll(() => {
  cleanupBaseRepos();
  for (const d of scratch.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const passingRun = (sha) => ({ ok: true, sha, failures: [], unmirrored: [], nodes: [{ node: 22, ok: true, steps: [] }] });

/** Deps for runGateFlow with a REAL lock in a private directory. */
function flowDeps(fx, lockDir, over = {}) {
  const post = fakePostStatus();
  const lockPath = path.join(lockDir, lock.LOCK_FILE);
  const deps = {
    ...cli.defaultDeps(),
    env: {},
    prInfo: prInfoFor(fx),
    postStatus: post,
    runGate: jest.fn((o) => passingRun(o.headSha)),
    acquireGateLock: () => lock.acquireFromEnv({ ENSEMBLE_LOCAL_CI_LOCK_DIR: lockDir, ENSEMBLE_LOCAL_CI_LOCK_TIMEOUT_MS: '0' }),
    ...over,
  };
  return { deps, post, lockPath };
}

const flowFixture = () => makeBaseRepo({ config: CONFIG_YAML, files: { [WORKFLOW]: WORKFLOW_YAML } });
const payload = (fx, extra = {}) => ({ repoRoot: fx.dir, headSha: fx.headSha, baseRef: fx.baseRef, repo: 'o/r', pr: PR, ...extra });

describe('runGateFlow and the gate lock', () => {
  it('holds the lock for the run and for nothing else, and reports queued_ms', async () => {
    const fx = flowFixture();
    const lockDir = tmpDir();
    const seen = {};
    const { deps, post, lockPath } = flowDeps(fx, lockDir);
    deps.runGate = jest.fn((o) => {
      seen.heldDuringRun = fs.existsSync(lockPath);
      return passingRun(o.headSha);
    });
    const origPost = deps.postStatus;
    deps.postStatus = (req) => {
      seen.heldDuringPost = fs.existsSync(lockPath);
      return origPost(req);
    };
    const r = await cli.runGateFlow(payload(fx), deps);
    expect(r).toMatchObject({ ok: true, posted: true, queued_ms: expect.any(Number) });
    expect(seen).toEqual({ heldDuringRun: true, heldDuringPost: false });
    expect(post.calls).toHaveLength(1);
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it('a run that throws still releases the lock, so the next gate starts at once (AC3)', async () => {
    const fx = flowFixture();
    const lockDir = tmpDir();
    const { deps, lockPath } = flowDeps(fx, lockDir);
    deps.runGate = jest.fn(() => {
      throw new Error('runner exploded');
    });
    await expect(cli.runGateFlow(payload(fx), deps)).rejects.toThrow('runner exploded');
    expect(fs.existsSync(lockPath)).toBe(false);

    const next = flowDeps(fx, lockDir);
    const r = await cli.runGateFlow(payload(fx), next.deps);
    expect(r).toMatchObject({ ok: true, posted: true }); // the lock timeout is 0: a still-held lock would have refused
  });

  it('when the lock cannot be had the gate stops with a named error: nothing runs, nothing posts, the holder is untouched (AC3)', async () => {
    const fx = flowFixture();
    const lockDir = tmpDir();
    const lockPath = path.join(lockDir, lock.LOCK_FILE);
    const holder = { pid: process.pid, host: os.hostname(), token: 'busy-gate', acquiredAt: '2026-01-01T00:00:00.000Z' };
    fs.writeFileSync(lockPath, JSON.stringify(holder)); // this very process is alive, so its lock is honoured
    const { deps, post } = flowDeps(fx, lockDir);
    const r = await cli.runGateFlow(payload(fx), deps);
    expect(r).toMatchObject({ ok: false, stage: 'lock', errorCode: 'lock-timeout', posted: false, mergeReady: false, lockHolder: { token: 'busy-gate' } });
    expect(r.error).toContain('lock-timeout');
    expect(deps.runGate).not.toHaveBeenCalled();
    expect(post.calls).toHaveLength(0);
    expect(JSON.parse(fs.readFileSync(lockPath, 'utf8'))).toEqual(holder);
  });

  it('the default wiring reads the policy from the process environment, and a malformed value refuses the gate', async () => {
    const fx = flowFixture();
    const { deps, post } = flowDeps(fx, tmpDir());
    deps.acquireGateLock = cli.defaultDeps().acquireGateLock;
    const saved = process.env.ENSEMBLE_LOCAL_CI_MAX_LOAD;
    process.env.ENSEMBLE_LOCAL_CI_MAX_LOAD = 'lots';
    try {
      const r = await cli.runGateFlow(payload(fx), deps);
      expect(r).toMatchObject({ ok: false, stage: 'lock', errorCode: 'bad-lock-policy' });
    } finally {
      if (saved === undefined) delete process.env.ENSEMBLE_LOCAL_CI_MAX_LOAD;
      else process.env.ENSEMBLE_LOCAL_CI_MAX_LOAD = saved;
    }
    expect(deps.runGate).not.toHaveBeenCalled();
    expect(post.calls).toHaveLength(0);
  });

  it('a gate with no lock available at all is refused, never run unserialized', async () => {
    const fx = flowFixture();
    const { deps } = flowDeps(fx, tmpDir());
    delete deps.acquireGateLock;
    const r = await cli.runGateFlow(payload(fx), deps);
    expect(r).toMatchObject({ ok: false, stage: 'lock' });
    expect(deps.runGate).not.toHaveBeenCalled();
  });

  it('an invalid request never queues: the lock is not even asked for', async () => {
    const fx = flowFixture();
    const { deps } = flowDeps(fx, tmpDir(), { prInfo: prInfoFor(fx, { baseRefName: 'main' }) }); // wrong base branch
    deps.acquireGateLock = jest.fn(deps.acquireGateLock);
    const r = await cli.runGateFlow(payload(fx), deps);
    expect(r).toMatchObject({ ok: false, stage: 'config' });
    expect(deps.acquireGateLock).not.toHaveBeenCalled();
  });

  it('dry runs queue too: they clone and run the same CI', async () => {
    const fx = flowFixture();
    const lockDir = tmpDir();
    const { deps, lockPath } = flowDeps(fx, lockDir);
    let held = false;
    deps.runGate = jest.fn((o) => {
      held = fs.existsSync(lockPath);
      return passingRun(o.headSha);
    });
    const r = await cli.runGateFlow(payload(fx, { dryRun: true }), deps);
    expect(r).toMatchObject({ ok: true, dryRun: true });
    expect(held).toBe(true);
  });
});

describe('run takes the same lock as gate (review round 1)', () => {
  const runPayload = (fx, extra = {}) => ({ repoRoot: fx.dir, headSha: fx.headSha, baseRef: fx.baseRef, ...extra });

  it('holds the lock for the runner and for nothing else, and reports queued_ms', async () => {
    const fx = flowFixture();
    const { deps, lockPath } = flowDeps(fx, tmpDir());
    let held = null;
    deps.runGate = jest.fn((o) => {
      held = fs.existsSync(lockPath);
      return passingRun(o.headSha);
    });
    const r = await cli.runRun(runPayload(fx), deps);
    expect(r).toMatchObject({ ok: true, sha: fx.headSha, queued_ms: expect.any(Number) });
    expect(held).toBe(true);
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it('a runner that throws still releases the lock', async () => {
    const fx = flowFixture();
    const lockDir = tmpDir();
    const { deps, lockPath } = flowDeps(fx, lockDir);
    let held = null;
    deps.runGate = jest.fn(() => {
      held = fs.existsSync(lockPath);
      throw new Error('runner exploded');
    });
    await expect(cli.runRun(runPayload(fx), deps)).rejects.toThrow('runner exploded');
    expect(held).toBe(true);
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it('while another run holds the lock it is refused at stage "lock": nothing runs and the holder is untouched', async () => {
    const fx = flowFixture();
    const lockDir = tmpDir();
    const lockPath = path.join(lockDir, lock.LOCK_FILE);
    const holder = { pid: process.pid, host: os.hostname(), token: 'busy-run', acquiredAt: '2026-01-01T00:00:00.000Z' };
    fs.writeFileSync(lockPath, JSON.stringify(holder)); // this very process is alive, so its lock is honoured
    const { deps } = flowDeps(fx, lockDir);
    const r = await cli.runRun(runPayload(fx), deps);
    expect(r).toMatchObject({ ok: false, stage: 'lock', errorCode: 'lock-timeout', lockHolder: { token: 'busy-run' }, queued_ms: expect.any(Number) });
    expect(r.error).toContain('lock-timeout');
    expect(deps.runGate).not.toHaveBeenCalled();
    expect(JSON.parse(fs.readFileSync(lockPath, 'utf8'))).toEqual(holder);
  });

  it('a run with no lock available at all is refused, never run unserialized', async () => {
    const fx = flowFixture();
    const { deps } = flowDeps(fx, tmpDir());
    delete deps.acquireGateLock;
    const r = await cli.runRun(runPayload(fx), deps);
    expect(r).toMatchObject({ ok: false, stage: 'lock' });
    expect(deps.runGate).not.toHaveBeenCalled();
  });

  it('an invalid request never queues: the lock is not even asked for', async () => {
    const fx = flowFixture();
    const { deps } = flowDeps(fx, tmpDir());
    deps.acquireGateLock = jest.fn(deps.acquireGateLock);
    const r = await cli.runRun(runPayload(fx, { baseRef: 'origin/no-such-branch' }), deps);
    expect(r.ok).toBe(false);
    expect(r.stage).toBeUndefined();
    expect(deps.acquireGateLock).not.toHaveBeenCalled();
    expect(deps.runGate).not.toHaveBeenCalled();
  });
});

describe('the lock request carries the runner worst case, and a lock that cannot be used fails by name (review round 1)', () => {
  it('gate and run ask for the lock with the worst case of THIS config', async () => {
    const fx = flowFixture();
    const { deps } = flowDeps(fx, tmpDir());
    const asked = [];
    const inner = deps.acquireGateLock;
    deps.acquireGateLock = (hold) => {
      asked.push(hold);
      return inner(hold);
    };
    await cli.runGateFlow(payload(fx), deps);
    await cli.runRun({ repoRoot: fx.dir, headSha: fx.headSha, baseRef: fx.baseRef }, deps);
    // The fixture config requires one Node version and one trusted step: the node check and the step, 10 minutes each at most.
    expect(asked).toEqual([{ worstCaseHoldMs: 20 * 60 * 1000 }, { worstCaseHoldMs: 20 * 60 * 1000 }]);
  });

  it('the default wiring hands it on to the lock policy', async () => {
    const spy = jest.spyOn(lock, 'acquireFromEnv').mockResolvedValue({ acquired: false, code: 'lock-timeout', error: 'stub', queuedMs: 0 });
    try {
      await cli.defaultDeps().acquireGateLock({ worstCaseHoldMs: 123456 });
      expect(spy).toHaveBeenCalledWith(process.env, undefined, { worstCaseHoldMs: 123456 });
    } finally {
      spy.mockRestore();
    }
  });

  it('an unusable lock directory stops gate and run at stage "lock" with errorCode lock-io: nothing runs, nothing posts', async () => {
    const fx = flowFixture();
    const aFile = path.join(tmpDir(), 'a-file');
    fs.writeFileSync(aFile, 'not a directory');
    const { deps, post } = flowDeps(fx, path.join(aFile, 'locks')); // the lock directory's parent is a regular file: ENOTDIR
    const g = await cli.runGateFlow(payload(fx), deps);
    expect(g).toMatchObject({ ok: false, stage: 'lock', errorCode: 'lock-io', posted: false, mergeReady: false, queued_ms: expect.any(Number) });
    expect(g.error).toMatch(/^lock-io: cannot use the lock at .*ENOTDIR/);
    const r = await cli.runRun({ repoRoot: fx.dir, headSha: fx.headSha, baseRef: fx.baseRef }, deps);
    expect(r).toMatchObject({ ok: false, stage: 'lock', errorCode: 'lock-io', queued_ms: expect.any(Number) });
    expect(deps.runGate).not.toHaveBeenCalled();
    expect(post.calls).toHaveLength(0);
  });
});

describe('the real CLI entry point, two gates at once (AC5)', () => {
  it('serializes them: the CI steps never overlap and the second reports queued_ms', async () => {
    const stepLog = path.join(tmpDir(), 'steps.jsonl');
    const lockDir = tmpDir();
    const HOLD_MS = 1500;
    const unitCheck = `'use strict';
const fs = require('fs');
fs.appendFileSync(${JSON.stringify(stepLog)}, JSON.stringify({ event: 'start', at: Date.now() }) + '\\n');
setTimeout(() => {
  fs.appendFileSync(${JSON.stringify(stepLog)}, JSON.stringify({ event: 'end', at: Date.now() }) + '\\n');
}, ${HOLD_MS});
`;
    const fx = makeBaseRepo({
      config: CONFIG_YAML,
      files: { 'scripts/unit-check.js': unitCheck, [WORKFLOW]: WORKFLOW_YAML, '.gitignore': '.ensemble/local-ci-runs/\n' },
    });
    // Fake only the outside world: `gh pr view` answers for the PR, and `npx` "provides" the Node we are already running.
    const fakeDir = fakeGhDir({ baseRefName: 'trusted-base', headRefOid: fx.headSha, state: 'OPEN' });
    fs.writeFileSync(path.join(fakeDir, 'npx'), `#!/bin/sh\nprintf '%s\\n' '${process.execPath}'\n`, { mode: 0o755 });
    const env = {
      ...process.env,
      PATH: fakeDir + path.delimiter + process.env.PATH,
      ENSEMBLE_LOCAL_CI_LOCK_DIR: lockDir,
      ENSEMBLE_LOCAL_CI_LOCK_TIMEOUT_MS: '60000',
    };
    const input = JSON.stringify({ repoRoot: fx.dir, headSha: fx.headSha, baseRef: fx.baseRef, repo: 'o/r', pr: PR, dryRun: true });
    const gate = () =>
      new Promise((resolve) => {
        const child = spawn(process.execPath, [CLI_PATH, 'gate'], { env, stdio: ['pipe', 'pipe', 'pipe'] });
        let out = '';
        let err = '';
        child.stdout.on('data', (c) => (out += c));
        child.stderr.on('data', (c) => (err += c));
        child.on('close', (code) => resolve({ code, out, err }));
        child.stdin.end(input);
      });

    const [a, b] = await Promise.all([gate(), gate()]);
    const reports = [a, b].map((r) => {
      expect({ code: r.code, err: r.err }).toEqual({ code: 0, err: '' });
      return JSON.parse(r.out);
    });
    for (const r of reports) expect(r).toMatchObject({ ok: true, dryRun: true, mergeReady: true });

    const events = fs.readFileSync(stepLog, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(events.map((e) => e.event)).toEqual(['start', 'end', 'start', 'end']); // never start, start
    expect(events[2].at).toBeGreaterThanOrEqual(events[1].at);

    const queued = reports.map((r) => r.queued_ms).sort((x, y) => x - y);
    expect(queued[1]).toBeGreaterThanOrEqual(HOLD_MS * 0.6); // the later one waited for most of the first one's step
    expect(fs.existsSync(path.join(lockDir, lock.LOCK_FILE))).toBe(false);
  }, 120000);
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Poll until `predicate()` is truthy; reject after `ms` so a broken run fails the test instead of hanging it. */
async function until(predicate, ms, what) {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = predicate();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await sleep(25);
  }
}

/** A fixture repo whose one CI step logs `start`, waits for the release file, then logs `end`; `npx` and `gh` are fakes. */
function holdableFixture() {
  const dir = tmpDir();
  const stepLog = path.join(dir, 'steps.jsonl');
  const releaseFile = path.join(dir, 'release');
  const unitCheck = `'use strict';
const fs = require('fs');
fs.appendFileSync(${JSON.stringify(stepLog)}, JSON.stringify({ event: 'start', at: Date.now() }) + '\\n');
const cap = setTimeout(() => process.exit(3), 60000);
const timer = setInterval(() => {
  if (!fs.existsSync(${JSON.stringify(releaseFile)})) return;
  clearInterval(timer);
  clearTimeout(cap);
  fs.appendFileSync(${JSON.stringify(stepLog)}, JSON.stringify({ event: 'end', at: Date.now() }) + '\\n');
}, 20);
`;
  const fx = makeBaseRepo({
    config: CONFIG_YAML,
    files: { 'scripts/unit-check.js': unitCheck, [WORKFLOW]: WORKFLOW_YAML, '.gitignore': '.ensemble/local-ci-runs/\n' },
  });
  const fakeDir = fakeGhDir({ baseRefName: 'trusted-base', headRefOid: fx.headSha, state: 'OPEN' });
  fs.writeFileSync(path.join(fakeDir, 'npx'), `#!/bin/sh\nprintf '%s\\n' '${process.execPath}'\n`, { mode: 0o755 });
  const steps = () => (fs.existsSync(stepLog) ? fs.readFileSync(stepLog, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
  return { fx, fakeDir, steps, releaseStep: () => fs.writeFileSync(releaseFile, 'go') };
}

describe('run and gate share one lock across real processes (review round 1)', () => {
  it('a run started while a gate is running its CI waits for it: the steps never overlap', async () => {
    const { fx, fakeDir, steps, releaseStep } = holdableFixture();
    const lockDir = tmpDir();
    const env = { ...process.env, PATH: fakeDir + path.delimiter + process.env.PATH, ENSEMBLE_LOCAL_CI_LOCK_DIR: lockDir, ENSEMBLE_LOCAL_CI_LOCK_TIMEOUT_MS: '60000' };
    const subcommand = (name, input) =>
      new Promise((resolve) => {
        const child = spawn(process.execPath, [CLI_PATH, name], { env, stdio: ['pipe', 'pipe', 'pipe'] });
        let out = '';
        let err = '';
        child.stdout.on('data', (c) => (out += c));
        child.stderr.on('data', (c) => (err += c));
        child.on('close', (code) => resolve({ code, out, err }));
        child.stdin.end(JSON.stringify(input));
      });

    try {
      const gate = subcommand('gate', { repoRoot: fx.dir, headSha: fx.headSha, baseRef: fx.baseRef, repo: 'o/r', pr: PR, dryRun: true });
      await until(() => steps().length >= 1, 60000, 'the gate to start its CI step'); // the gate now holds the lock
      const run = subcommand('run', { repoRoot: fx.dir, headSha: fx.headSha, baseRef: fx.baseRef });
      await sleep(2000); // ample time for an unserialized run to start its own step
      expect(steps().map((e) => e.event)).toEqual(['start']); // still only the gate's step: the run is queued
      releaseStep();
      const [g, r] = await Promise.all([gate, run]);
      expect({ code: g.code, err: g.err }).toEqual({ code: 0, err: '' });
      expect({ code: r.code, err: r.err }).toEqual({ code: 0, err: '' });
      expect(JSON.parse(g.out)).toMatchObject({ ok: true, dryRun: true, mergeReady: true });
      const ran = JSON.parse(r.out);
      expect(ran).toMatchObject({ ok: true, sha: fx.headSha, queued_ms: expect.any(Number) });
      expect(steps().map((e) => e.event)).toEqual(['start', 'end', 'start', 'end']); // never start, start
    } finally {
      releaseStep();
    }
    expect(fs.existsSync(path.join(lockDir, lock.LOCK_FILE))).toBe(false);
  }, 120000);
});

describe('the gate the precheck starts goes through the lock (AC4, review round 1)', () => {
  const ok = (stdout) => ({ status: 0, stdout: typeof stdout === 'string' ? stdout : JSON.stringify(stdout), stderr: '' });

  /** What `gh` and `git` answer the precheck's own reads for a healthy open PR on this repository. */
  function scriptedRun(fx) {
    const table = {
      'pr view': ok({ headRefOid: fx.headSha, baseRefName: 'trusted-base', state: 'OPEN', body: '## Testing\nx\n## Risk\nx\n## How to revert\nx\n', author: { login: 'author' }, isCrossRepository: false }),
      [`pulls/${PR}/reviews`]: ok([[]]),
      'git/commits': ok({ tree: { sha: 'c'.repeat(40) } }),
      'branches/trusted-base/protection': { status: 1, stdout: JSON.stringify({ message: 'Branch not protected' }), stderr: 'gh: Branch not protected (HTTP 404)' },
      '/statuses': ok([[]]),
      'fetch --quiet origin trusted-base': ok(''),
      'rev-parse --verify --end-of-options refs/remotes/origin/trusted-base^{commit}': ok(`${fx.baseSha}\n`),
      [`show ${fx.baseSha}:.ensemble/local-ci.yaml`]: ok(CONFIG_YAML),
      'cat-file -e': ok(''),
      'api user': ok({ login: 'me' }),
      [`issues/${PR}/comments`]: ok([[]]),
      '-X POST': ok({ id: 1, html_url: 'u' }),
    };
    return async (cmd, args) => {
      const key = `${cmd} ${args.join(' ')}`;
      for (const [needle, answer] of Object.entries(table)) if (key.includes(needle)) return answer;
      return { status: 1, stdout: '', stderr: `unexpected ${key}` };
    };
  }

  it('starts ONE gate per head even while it is queued behind another gate, and that gate runs once the lock is free', async () => {
    const { fx, fakeDir, steps, releaseStep } = holdableFixture();
    releaseStep(); // this test never holds the step: it holds the lock instead
    const lockDir = tmpDir();
    const env = { ...process.env, PATH: fakeDir + path.delimiter + process.env.PATH, ENSEMBLE_LOCAL_CI_LOCK_DIR: lockDir, ENSEMBLE_LOCAL_CI_LOCK_TIMEOUT_MS: '60000' };
    const spawned = [];
    // The real detached `local-ci-cli.js gate`, with only its environment pointed at the fixture's lock, `gh` and `npx`.
    const spawnProcess = (cmd, args, opts) => {
      const child = spawn(cmd, args, { ...opts, env });
      spawned.push(child);
      return child;
    };
    const precheck = () => runPrecheck({ dryRun: true }, makeDeps({ repo: 'o/r', pr: PR, repoRoot: fx.dir, run: scriptedRun(fx), spawnProcess }));

    // Another gate holds the lock: this very process, which is alive.
    const held = await lock.acquire({ lockPath: path.join(lockDir, lock.LOCK_FILE), timeoutMs: 0 });
    expect(held.acquired).toBe(true);
    let gatePid = null;
    try {
      const first = await precheck();
      expect(first.gate).toMatchObject({ action: 'started', dryRun: true });
      gatePid = first.gate.pid;
      await sleep(3000); // the gate is up and queued
      expect(process.kill(gatePid, 0)).toBe(true); // alive, waiting
      expect(steps()).toEqual([]); // and no CI step has run: it is waiting for the lock

      const second = await precheck();
      expect(second.gate.action).toBe('already-started');
      expect(spawned).toHaveLength(1); // at most one gate for the head, queued or not

      held.release();
      const finished = await until(() => {
        const text = fs.existsSync(first.gate.logPath) ? fs.readFileSync(first.gate.logPath, 'utf8') : '';
        const line = text.split('\n').find((l) => l.startsWith('{'));
        return line ? JSON.parse(line) : null;
      }, 60000, 'the queued gate to report');
      expect(finished).toMatchObject({ ok: true, dryRun: true, mergeReady: true });
      expect(finished.queued_ms).toBeGreaterThan(0); // it spent time in the queue
      expect(steps().map((e) => e.event)).toEqual(['start', 'end']);
    } finally {
      held.release();
      if (gatePid !== null) {
        try {
          process.kill(-gatePid, 'SIGKILL');
        } catch {
          /* already gone */
        }
      }
    }
  }, 120000);
});
