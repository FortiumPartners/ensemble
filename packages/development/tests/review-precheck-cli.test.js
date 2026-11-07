'use strict';

/**
 * Precheck entry point (kata 4ev6): the real deps against a real filesystem, with `gh`/`git` and the gate process
 * faked at the process boundary. Covers the parts the orchestrator tests cannot: the create-once start marker, the
 * detached start, finding OUR comment, and the protection read's classification of failures.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const { EventEmitter } = require('events');

const { makeDeps, validatePayload, main, STATE_SUBDIR } = require('../lib/review-precheck-cli');
const { runPrecheck, COMMENT_MARKER } = require('../lib/pr-review-precheck');

const HEAD = 'a'.repeat(40);
const BASE_SHA = 'e'.repeat(40);
const DEAD_PID = 2 ** 22 + 12345; // above every platform's pid range: no such process
// The repository's own committed gate config: a real, valid one (a hand-made stub would not pass validateConfig).
const CONFIG_YAML = fs.readFileSync(path.join(__dirname, '..', '..', '..', '.ensemble', 'local-ci.yaml'), 'utf8');
const CONTEXT = /^status_context:\s*(\S+)/m.exec(CONFIG_YAML)[1];

let root;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'precheck-cli-'));
});
afterEach(() => {
  jest.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
});

const ok = (stdout) => ({ status: 0, stdout: typeof stdout === 'string' ? stdout : JSON.stringify(stdout), stderr: '' });
const fail = (stderr, stdout = '') => ({ status: 1, stdout, stderr });

/** A fake process boundary: `gh` answers by endpoint, `git` by subcommand. */
function fakeRun(table = {}) {
  const calls = [];
  const run = async (cmd, args) => {
    calls.push([cmd, ...args]);
    const key = `${cmd} ${args.join(' ')}`;
    for (const [needle, answer] of Object.entries(table)) {
      if (key.includes(needle)) return typeof answer === 'function' ? answer(args) : answer;
    }
    return fail(`unexpected ${key}`);
  };
  return { run, calls };
}

function fakeSpawn() {
  const spawned = [];
  const spawnProcess = (cmd, args, opts) => {
    const child = new EventEmitter();
    child.pid = 5000 + spawned.length;
    child.unref = () => {};
    spawned.push({ cmd, args, opts });
    return child;
  };
  return { spawnProcess, spawned };
}

const deps = (over = {}) => makeDeps({ repo: 'o/r', pr: 9, repoRoot: root, ...over });

describe('validatePayload', () => {
  it('accepts the documented shape', () => {
    expect(validatePayload({ repo: 'o/r', pr: 9, repoRoot: '/x', dryRun: true })).toBeTruthy();
  });
  it('rejects unknown keys, a malformed repo, a bad PR number and a non-boolean dryRun', () => {
    for (const bad of [
      { repo: 'o/r', pr: 9, repoRoot: '/x', baseRef: 'origin/evil' },
      { repo: 'o/r; rm -rf', pr: 9, repoRoot: '/x' },
      { repo: '-o/r', pr: 9, repoRoot: '/x' },
      { repo: 'o/r', pr: '9', repoRoot: '/x' },
      { repo: 'o/r', pr: 0, repoRoot: '/x' },
      { repo: 'o/r', pr: 9, repoRoot: '' },
      { repo: 'o/r', pr: 9, repoRoot: '/x', dryRun: 'yes' },
    ]) {
      expect(() => validatePayload(bad)).toThrow();
    }
  });
});

describe('claimGateStart: a create-once marker', () => {
  it('exactly one of many concurrent claimers for a head wins', async () => {
    const d = deps();
    const results = await Promise.all(Array.from({ length: 8 }, () => Promise.resolve().then(() => d.claimGateStart({ headSha: HEAD, dryRun: false }))));
    expect(results.filter((r) => r.claimed === true)).toHaveLength(1);
    expect(results.filter((r) => r.claimed === false && r.existing)).toHaveLength(7);
  });

  it('a different head, and the dry-run namespace, are independent markers (a dry claim waits only while a real gate for the head is LIVE: they share one clone)', () => {
    const d = deps();
    expect(d.claimGateStart({ headSha: HEAD, dryRun: false }).claimed).toBe(true);
    expect(d.claimGateStart({ headSha: 'b'.repeat(40), dryRun: false }).claimed).toBe(true);
    // The real claim above is young and its run is alive, so it holds the head's one clone: a dry claim is refused ...
    expect(d.claimGateStart({ headSha: HEAD, dryRun: true })).toMatchObject({ claimed: false, blocked: { kind: 'gate-running-for-head' } });
    // ... until that gate has finished, and then the dry run has its OWN marker.
    const real = path.join(root, STATE_SUBDIR, `precheck-pr-9-${HEAD}.gate.json`);
    fs.writeFileSync(real, JSON.stringify({ ...JSON.parse(fs.readFileSync(real, 'utf8')), pid: DEAD_PID }));
    expect(d.claimGateStart({ headSha: HEAD, dryRun: true }).claimed).toBe(true);
    expect(d.claimGateStart({ headSha: HEAD, dryRun: false }).claimed).toBe(false);
  });

  it('release makes the head claimable again', () => {
    const d = deps();
    d.claimGateStart({ headSha: HEAD, dryRun: false });
    d.releaseGateStart({ headSha: HEAD, dryRun: false });
    expect(d.claimGateStart({ headSha: HEAD, dryRun: false }).claimed).toBe(true);
  });

  it('reports whether the earlier gate process is still alive', async () => {
    const d = deps();
    d.claimGateStart({ headSha: HEAD, dryRun: false });
    const marker = path.join(root, STATE_SUBDIR, `precheck-pr-9-${HEAD}.gate.json`);
    fs.writeFileSync(marker, JSON.stringify({ pid: process.pid, startedAt: 't0' }));
    expect(d.claimGateStart({ headSha: HEAD, dryRun: false }).existing).toMatchObject({ pid: process.pid, alive: true, startedAt: 't0' });
    fs.writeFileSync(marker, JSON.stringify({ pid: 2 ** 22 + 12345, startedAt: 't0' }));
    expect(d.claimGateStart({ headSha: HEAD, dryRun: false }).existing.alive).toBe(false);
  });
});

describe('startGate', () => {
  const gitOk = { 'fetch --quiet origin dev': ok(''), [`fetch --quiet origin ${HEAD}`]: ok('') };

  it('runs `local-ci-cli gate` detached with its payload from a file and its output to a log, then records the pid', async () => {
    const { run } = fakeRun(gitOk);
    const { spawnProcess, spawned } = fakeSpawn();
    const d = deps({ run, spawnProcess, now: () => new Date('2026-11-06T00:00:00Z') });
    d.claimGateStart({ headSha: HEAD, dryRun: false });
    const r = await d.startGate({ headSha: HEAD, baseRefName: 'dev', dryRun: false });
    expect(r).toMatchObject({ ok: true, pid: 5000, startedAt: '2026-11-06T00:00:00.000Z' });
    expect(spawned).toHaveLength(1);
    expect(spawned[0].args[1]).toBe('gate');
    expect(spawned[0].opts.detached).toBe(true);
    const input = JSON.parse(fs.readFileSync(path.join(root, STATE_SUBDIR, `precheck-pr-9-${HEAD}.gate-input.json`), 'utf8'));
    expect(input).toEqual({ repoRoot: root, headSha: HEAD, baseRef: 'origin/dev', repo: 'o/r', pr: 9 });
    const marker = JSON.parse(fs.readFileSync(path.join(root, STATE_SUBDIR, `precheck-pr-9-${HEAD}.gate.json`), 'utf8'));
    expect(marker.pid).toBe(5000);
  });

  it('a dry run starts the gate in the gate\'s own dry-run mode so it publishes no status', async () => {
    const { run } = fakeRun(gitOk);
    const { spawnProcess } = fakeSpawn();
    const d = deps({ run, spawnProcess });
    d.claimGateStart({ headSha: HEAD, dryRun: true });
    await d.startGate({ headSha: HEAD, baseRefName: 'dev', dryRun: true });
    const input = JSON.parse(fs.readFileSync(path.join(root, STATE_SUBDIR, `precheck-pr-9-${HEAD}.dry.gate-input.json`), 'utf8'));
    expect(input.dryRun).toBe(true);
  });

  it('does not start the gate when the base cannot be fetched fresh', async () => {
    const { run } = fakeRun({ 'fetch --quiet origin dev': fail('network down') });
    const { spawnProcess, spawned } = fakeSpawn();
    const d = deps({ run, spawnProcess });
    const r = await d.startGate({ headSha: HEAD, baseRefName: 'dev', dryRun: false });
    expect(r.ok).toBe(false);
    expect(spawned).toHaveLength(0);
  });

  it('fetches the PR head before the gate starts: the gate checks base/head history in this clone first', async () => {
    const { run, calls } = fakeRun(gitOk);
    const { spawnProcess, spawned } = fakeSpawn();
    const d = deps({ run, spawnProcess });
    await d.startGate({ headSha: HEAD, baseRefName: 'dev', dryRun: false });
    const fetchHead = calls.findIndex((c) => c.join(' ') === `git fetch --quiet origin ${HEAD}`);
    expect(fetchHead).toBeGreaterThan(-1);
    expect(spawned).toHaveLength(1);
  });

  it('falls back to the PR ref when the sha cannot be fetched, and does not start when neither can', async () => {
    const viaRef = fakeRun({ 'fetch --quiet origin dev': ok(''), [`fetch --quiet origin ${HEAD}`]: fail('no'), 'refs/pull/9/head': ok('') });
    const a = fakeSpawn();
    expect((await deps({ run: viaRef.run, spawnProcess: a.spawnProcess }).startGate({ headSha: HEAD, baseRefName: 'dev', dryRun: false })).ok).toBe(true);
    const neither = fakeRun({ 'fetch --quiet origin dev': ok(''), [`fetch --quiet origin ${HEAD}`]: fail('no'), 'refs/pull/9/head': fail('no') });
    const b = fakeSpawn();
    const r = await deps({ run: neither.run, spawnProcess: b.spawnProcess }).startGate({ headSha: HEAD, baseRefName: 'dev', dryRun: false });
    expect(r.ok).toBe(false);
    expect(b.spawned).toHaveLength(0);
  });

  it('reports a spawn that fails asynchronously instead of claiming the gate started', async () => {
    const { run } = fakeRun(gitOk);
    const spawnProcess = () => {
      const child = new EventEmitter();
      child.unref = () => {};
      process.nextTick(() => child.emit('error', new Error('ENOENT')));
      return child;
    };
    const r = await deps({ run, spawnProcess }).startGate({ headSha: HEAD, baseRefName: 'dev', dryRun: false });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('ENOENT');
  });
});

/** What `gh` and `git` answer for a healthy open PR whose head is on this repository. */
const table = (extra = {}) => ({
  'pr view': ok({ headRefOid: HEAD, baseRefName: 'dev', state: 'OPEN', body: '## Testing\nx\n## Risk\nx\n## How to revert\nx\n', author: { login: 'author' }, isCrossRepository: false }),
  'pulls/9/reviews': ok([[]]),
  'git/commits': ok({ tree: { sha: 'c'.repeat(40) } }),
  'branches/dev/protection': fail('gh: Branch not protected (HTTP 404)', JSON.stringify({ message: 'Branch not protected' })),
  '/statuses': ok([[]]),
  'fetch --quiet origin dev': ok(''),
  [`fetch --quiet origin ${HEAD}`]: ok(''),
  'rev-parse --verify --end-of-options refs/remotes/origin/dev^{commit}': ok(`${BASE_SHA}\n`),
  [`show ${BASE_SHA}:.ensemble/local-ci.yaml`]: ok(CONFIG_YAML),
  'cat-file -e': fail('missing'),
  'api user': ok({ login: 'me' }),
  'issues/9/comments': ok([[]]),
  '-X POST': ok({ id: 1, html_url: 'u' }),
  ...extra,
});

describe('start-once through the entry flow (AC1)', () => {
  it('two precheck runs on one head start the gate once and the second says it was already started', async () => {
    const { run } = fakeRun(table());
    const { spawnProcess, spawned } = fakeSpawn();
    const first = await runPrecheck({}, deps({ run, spawnProcess }));
    const second = await runPrecheck({}, deps({ run, spawnProcess }));
    expect(first.gate.action).toBe('started');
    expect(second.gate.action).toBe('already-started');
    expect(spawned).toHaveLength(1);
  });

  it('does not start the gate when GitHub already shows the status on this head', async () => {
    const { run } = fakeRun(table({ '/statuses': ok([[{ context: CONTEXT, state: 'success' }]]) }));
    const { spawnProcess, spawned } = fakeSpawn();
    const r = await runPrecheck({}, deps({ run, spawnProcess }));
    expect(r.gate.action).toBe('status-present');
    expect(spawned).toHaveLength(0);
  });

  it('reads the status context from the base-ref config: a config naming another context changes the decision', async () => {
    const { run } = fakeRun(table({ '/statuses': ok([[{ context: CONTEXT, state: 'success' }]]), [`show ${BASE_SHA}:.ensemble/local-ci.yaml`]: ok(CONFIG_YAML.replace(CONTEXT, 'other/ci')) }));
    const { spawnProcess, spawned } = fakeSpawn();
    const r = await runPrecheck({}, deps({ run, spawnProcess }));
    expect(r.gate.action).toBe('started');
    expect(spawned).toHaveLength(1);
  });

  it('an absent policy file means strict defaults, so the approvals floor is one human', async () => {
    const { run } = fakeRun(table());
    const r = await runPrecheck({ dryRun: true }, deps({ run, spawnProcess: fakeSpawn().spawnProcess }));
    expect(r.approvals).toMatchObject({ required: 1, lowerBound: true });
  });

  it('asks GitHub whether the head is on a fork and starts nothing for one: no fetch, no claim, no gate (review round 1, finding 3)', async () => {
    const forkPr = ok({ headRefOid: HEAD, baseRefName: 'dev', state: 'OPEN', body: '## Testing\nx\n## Risk\nx\n## How to revert\nx\n', author: { login: 'author' }, isCrossRepository: true });
    const { run, calls } = fakeRun(table({ 'pr view': forkPr }));
    const { spawnProcess, spawned } = fakeSpawn();
    const r = await runPrecheck({}, deps({ run, spawnProcess }));
    const view = calls.find((c) => c[0] === 'gh' && c[1] === 'pr' && c[2] === 'view');
    expect(view[view.indexOf('--json') + 1].split(',')).toContain('isCrossRepository');
    expect(r.gate).toMatchObject({ action: 'not-started', code: 'cross-repository-head' });
    expect(spawned).toHaveLength(0);
    expect(fs.existsSync(path.join(root, STATE_SUBDIR))).toBe(false);
    expect(calls.some((c) => c[0] === 'git' && c.includes('fetch') && c.includes(HEAD))).toBe(false);
    expect(r.comment.action).toBe('created');
  });

  it('does its network steps BEFORE the claim marker exists, so a run that dies while fetching leaves no claim (review round 1, finding 4)', async () => {
    const marker = path.join(root, STATE_SUBDIR, `precheck-pr-9-${HEAD}.gate.json`);
    const markerWhenFetching = [];
    const { run } = fakeRun(table({ [`fetch --quiet origin ${HEAD}`]: () => { markerWhenFetching.push(fs.existsSync(marker)); return ok(''); } }));
    const { spawnProcess, spawned } = fakeSpawn();
    const r = await runPrecheck({}, deps({ run, spawnProcess }));
    expect(r.gate.action).toBe('started');
    expect(markerWhenFetching).toEqual([false]);
    expect(spawned).toHaveLength(1);
  });

  it('a failed fetch leaves no marker and starts nothing; the next run can start the gate', async () => {
    const { run } = fakeRun(table({ [`fetch --quiet origin ${HEAD}`]: fail('network down'), 'refs/pull/9/head': fail('network down') }));
    const { spawnProcess, spawned } = fakeSpawn();
    const first = await runPrecheck({}, deps({ run, spawnProcess }));
    expect(first.gate).toMatchObject({ action: 'start-failed' });
    expect(fs.existsSync(path.join(root, STATE_SUBDIR, `precheck-pr-9-${HEAD}.gate.json`))).toBe(false);
    const again = fakeRun(table());
    expect((await runPrecheck({}, deps({ run: again.run, spawnProcess }))).gate.action).toBe('started');
    expect(spawned).toHaveLength(1);
  });

  it('a claim whose run died before it recorded a gate is reported as interrupted and no second gate is started (review round 1, finding 4)', async () => {
    const { run } = fakeRun(table());
    const { spawnProcess, spawned } = fakeSpawn();
    // The run that claimed the start and then died: the marker holds the claim and a claimer pid that no longer exists.
    expect(deps({ run, spawnProcess }).claimGateStart({ headSha: HEAD, dryRun: false }).claimed).toBe(true);
    const marker = path.join(root, STATE_SUBDIR, `precheck-pr-9-${HEAD}.gate.json`);
    fs.writeFileSync(marker, JSON.stringify({ ...JSON.parse(fs.readFileSync(marker, 'utf8')), claimer: DEAD_PID }));
    for (let i = 0; i < 2; i += 1) {
      const r = await runPrecheck({}, deps({ run, spawnProcess }));
      expect(r.gate).toMatchObject({ action: 'already-started', existing: { orphaned: true, alive: false, claimer: DEAD_PID } });
      expect(r.comment.body).toContain('an earlier start was interrupted');
      expect(r.comment.body).toContain(`\`.ensemble/pr-review/precheck-pr-9-${HEAD}.gate.json\``);
    }
    expect(spawned).toHaveLength(0);
  });

  describe('once a gate exists its claim is never released while it may still run (review round 1, finding 5)', () => {
    /** A spawn that tracks which gate processes are alive, and a `kill` that ends them (nothing real is ever signalled). */
    const tracked = (firstPid = 7000) => {
      const live = new Set();
      const pids = [];
      const killed = [];
      const spawnProcess = () => {
        const child = new EventEmitter();
        child.pid = firstPid + pids.length;
        child.unref = () => {};
        pids.push(child.pid);
        live.add(child.pid);
        return child;
      };
      const kill = (target, signal) => {
        killed.push([target, signal]);
        live.delete(Math.abs(target));
      };
      return { spawnProcess, kill, live, pids, killed };
    };
    const failRecordOnce = () => jest.spyOn(fs, 'renameSync').mockImplementationOnce(() => { throw new Error('ENOSPC: simulated'); });

    it('when the gate cannot be recorded it is killed (its whole process group) and the claim is released only because it is dead: the next run starts exactly ONE live gate', async () => {
      const t = tracked();
      const { run } = fakeRun(table());
      failRecordOnce();
      const first = await runPrecheck({}, deps({ run, spawnProcess: t.spawnProcess, kill: t.kill }));
      expect(first.gate).toMatchObject({ action: 'start-failed' });
      expect(first.gate.reason).toContain('could not be recorded');
      expect(first.gate.mayBeRunning).toBeUndefined();
      expect(t.killed).toEqual([[-7000, 'SIGKILL']]);
      const second = await runPrecheck({}, deps({ run, spawnProcess: t.spawnProcess, kill: t.kill }));
      expect(second.gate.action).toBe('started');
      expect([...t.live]).toEqual([7001]);
    });

    it('when the gate cannot be stopped either, the claim is KEPT: the next run starts no second gate', async () => {
      const t = tracked();
      const { run } = fakeRun(table());
      failRecordOnce();
      const kill = () => { throw Object.assign(new Error('EPERM'), { code: 'EPERM' }); };
      const first = await runPrecheck({}, deps({ run, spawnProcess: t.spawnProcess, kill }));
      expect(first.gate).toMatchObject({ action: 'start-failed', mayBeRunning: true, pid: 7000 });
      expect(first.comment.body).toContain('may still be running');
      expect(first.gate.reason).toContain('kill -KILL -- -7000');
      const second = await runPrecheck({}, deps({ run, spawnProcess: t.spawnProcess, kill }));
      expect(second.gate.action).toBe('already-started');
      expect(t.pids).toEqual([7000]);
    });

    it('a gate that is already gone (ESRCH) counts as stopped, so the claim is released', async () => {
      const t = tracked();
      const { run } = fakeRun(table());
      failRecordOnce();
      const kill = () => { throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' }); };
      const first = await runPrecheck({}, deps({ run, spawnProcess: t.spawnProcess, kill }));
      expect(first.gate.mayBeRunning).toBeUndefined();
      expect((await runPrecheck({}, deps({ run, spawnProcess: t.spawnProcess, kill: t.kill }))).gate.action).toBe('started');
    });

    it('a start that fails before any process exists signals nothing and releases the claim', async () => {
      const t = tracked();
      const { run } = fakeRun(table());
      const first = await runPrecheck({}, deps({ run, spawnProcess: () => { throw new Error('EACCES'); }, kill: t.kill }));
      expect(first.gate).toMatchObject({ action: 'start-failed' });
      expect(first.gate.mayBeRunning).toBeUndefined();
      expect(t.killed).toEqual([]);
      expect((await runPrecheck({}, deps({ run, spawnProcess: t.spawnProcess, kill: t.kill }))).gate.action).toBe('started');
    });

    it('never signals a pid that could name every process (1, 0 or negative): the claim is kept instead', async () => {
      for (const pid of [1, 0, -5]) {
        const killed = [];
        const spawnProcess = () => Object.assign(new EventEmitter(), { pid, unref: () => {} });
        const { run } = fakeRun(table());
        failRecordOnce();
        const d = deps({ run, spawnProcess, kill: (...a) => killed.push(a) });
        const first = await runPrecheck({}, d);
        expect(killed).toEqual([]);
        expect(first.gate).toMatchObject({ action: 'start-failed', mayBeRunning: true });
        fs.rmSync(path.join(root, STATE_SUBDIR), { recursive: true, force: true });
      }
    });

    it('records the gate by replacing the claim marker whole: pid, start time and log are added, the claim fields stay, no temp file is left', async () => {
      const t = tracked();
      const { run } = fakeRun(table());
      await runPrecheck({}, deps({ run, spawnProcess: t.spawnProcess, kill: t.kill }));
      const dir = path.join(root, STATE_SUBDIR);
      const marker = JSON.parse(fs.readFileSync(path.join(dir, `precheck-pr-9-${HEAD}.gate.json`), 'utf8'));
      expect(marker).toMatchObject({ headSha: HEAD, pr: 9, claimer: process.pid, pid: 7000 });
      expect(typeof marker.claimedAt).toBe('string');
      expect(typeof marker.startedAt).toBe('string');
      expect(fs.readdirSync(dir).filter((n) => n.endsWith('.tmp'))).toEqual([]);
    });
  });
});

describe('claim markers: recorded gate, young claim, orphaned claim (review round 1, finding 4)', () => {
  const claimed = (over = {}) => {
    const d = deps(over);
    expect(d.claimGateStart({ headSha: HEAD, dryRun: false }).claimed).toBe(true);
    const marker = path.join(root, STATE_SUBDIR, `precheck-pr-9-${HEAD}.gate.json`);
    const rewrite = (patch) => fs.writeFileSync(marker, JSON.stringify({ ...JSON.parse(fs.readFileSync(marker, 'utf8')), ...patch }));
    return { d, rewrite, marker };
  };
  const existing = (d) => d.claimGateStart({ headSha: HEAD, dryRun: false }).existing;

  it('a claim records who made it, and a young claim from a run that is still going is in progress, not orphaned', () => {
    const { d, marker } = claimed();
    expect(JSON.parse(fs.readFileSync(marker, 'utf8'))).toMatchObject({ headSha: HEAD, pr: 9, claimer: process.pid });
    expect(existing(d)).toMatchObject({ alive: null, orphaned: false, claimer: process.pid });
  });

  it('a claim whose run is gone is orphaned at once, without waiting for the grace period', () => {
    const { d, rewrite } = claimed();
    rewrite({ claimer: DEAD_PID });
    expect(existing(d)).toMatchObject({ alive: false, orphaned: true, claimer: DEAD_PID, marker: `.ensemble/pr-review/precheck-pr-9-${HEAD}.gate.json` });
  });

  it('a claim with no gate recorded that is older than the grace period is orphaned even if its claimer pid looks alive (a reused pid)', () => {
    const { rewrite } = claimed();
    rewrite({ claimedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString() });
    expect(existing(deps())).toMatchObject({ alive: false, orphaned: true });
  });

  it('a marker from before claims recorded their claimer (only headSha and claimedAt) is in progress while young and orphaned once old', () => {
    const { rewrite, marker } = claimed();
    fs.writeFileSync(marker, JSON.stringify({ headSha: HEAD, claimedAt: new Date().toISOString() }));
    expect(existing(deps())).toMatchObject({ alive: null, orphaned: false });
    rewrite({ claimedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString() });
    expect(existing(deps())).toMatchObject({ alive: false, orphaned: true });
  });

  it('an empty or unreadable marker is judged by its age: in progress while young', () => {
    const { marker } = claimed();
    fs.writeFileSync(marker, '');
    expect(existing(deps())).toMatchObject({ alive: null, orphaned: false });
    const old = new Date(Date.now() - 10 * 60 * 1000);
    fs.utimesSync(marker, old, old);
    expect(existing(deps())).toMatchObject({ alive: false, orphaned: true });
  });

  it('a recorded gate is not orphaned: it is alive or it is not', () => {
    const { rewrite } = claimed();
    rewrite({ pid: process.pid, startedAt: 't0' });
    expect(existing(deps())).toMatchObject({ pid: process.pid, alive: true, orphaned: false });
    rewrite({ pid: DEAD_PID });
    expect(existing(deps())).toMatchObject({ pid: DEAD_PID, alive: false, orphaned: false });
  });

  it('prepareGate fetches the base and the head, and skips the head fetch when the commit is already local', async () => {
    const missing = fakeRun({ 'fetch --quiet origin dev': ok(''), [`fetch --quiet origin ${HEAD}`]: ok('') });
    expect(await deps({ run: missing.run }).prepareGate({ headSha: HEAD, baseRefName: 'dev', dryRun: false })).toEqual({ ok: true });
    expect(missing.calls.map((c) => c.join(' '))).toEqual(['git fetch --quiet origin dev', `git cat-file -e ${HEAD}^{commit}`, `git fetch --quiet origin ${HEAD}`]);
    const local = fakeRun({ 'fetch --quiet origin dev': ok(''), 'cat-file -e': ok('') });
    expect(await deps({ run: local.run }).prepareGate({ headSha: HEAD, baseRefName: 'dev', dryRun: false })).toEqual({ ok: true });
    expect(local.calls.map((c) => c.join(' '))).toEqual(['git fetch --quiet origin dev', `git cat-file -e ${HEAD}^{commit}`]);
  });

  it('prepareGate reports a failed fetch and answers the same to every caller of the run', async () => {
    const { run, calls } = fakeRun({ 'fetch --quiet origin dev': fail('network down') });
    const d = deps({ run });
    const a = await d.prepareGate({ headSha: HEAD, baseRefName: 'dev', dryRun: false });
    const b = await d.prepareGate({ headSha: HEAD, baseRefName: 'dev', dryRun: false });
    expect(a.ok).toBe(false);
    expect(a.error).toContain('network down');
    expect(b).toBe(a);
    expect(calls).toHaveLength(1);
  });
});

describe('one gate per head: the runner keys its clone by the sha alone (review round 1, finding 6)', () => {
  const marker = (name) => path.join(root, STATE_SUBDIR, name);
  const DRY = `precheck-pr-9-${HEAD}.dry.gate.json`;
  const REAL = `precheck-pr-9-${HEAD}.gate.json`;
  const patch = (name, fields) => fs.writeFileSync(marker(name), JSON.stringify({ ...JSON.parse(fs.readFileSync(marker(name), 'utf8')), ...fields }));
  const claim = (d, dryRun, headSha = HEAD) => d.claimGateStart({ headSha, dryRun });
  /** A spawn whose gates stay alive for the whole test (their pid is this process's own). */
  const alive = () => {
    const spawned = [];
    const spawnProcess = () => {
      const child = new EventEmitter();
      child.pid = process.pid;
      child.unref = () => {};
      spawned.push(child);
      return child;
    };
    return { spawnProcess, spawned };
  };

  it('premise: the real runner keeps ONE clone per sha and refuses a second, and this module sees the clone the runner made', () => {
    const runner = require('../lib/local-ci-runner');
    const run = (cwd, ...args) => cp.execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } }).trim();
    const work = path.join(root, 'work');
    fs.mkdirSync(work);
    run(work, 'init', '--quiet');
    fs.writeFileSync(path.join(work, 'a.txt'), 'a');
    run(work, 'add', 'a.txt');
    run(work, 'commit', '--quiet', '-m', 'c1');
    const sha = run(work, 'rev-parse', 'HEAD');
    const gitDeps = { git: (args, o = {}) => { const r = cp.spawnSync('git', args, { cwd: o.cwd, encoding: 'utf8', input: o.input }); return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' }; } };
    expect(runner.DEFAULT_STALE_MS).toBe(60 * 60 * 1000);
    const before = makeDeps({ repo: 'o/r', pr: 9, repoRoot: work }).claimGateStart({ headSha: sha, dryRun: false });
    expect(before.claimed).toBe(true);
    makeDeps({ repo: 'o/r', pr: 9, repoRoot: work }).releaseGateStart({ headSha: sha, dryRun: false });
    const first = runner.cloneAtSha({ repoRoot: work, sha, deps: gitDeps });
    const second = runner.cloneAtSha({ repoRoot: work, sha, deps: gitDeps });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    expect(second.error).toContain('already exists');
    expect(makeDeps({ repo: 'o/r', pr: 9, repoRoot: work }).claimGateStart({ headSha: sha, dryRun: false })).toMatchObject({ claimed: false, blocked: { kind: 'clone-exists' } });
  });

  it('a live dry-run gate blocks a real claim for the same head, and the refused claim leaves nothing behind', () => {
    const d = deps();
    expect(claim(d, true).claimed).toBe(true);
    patch(DRY, { pid: process.pid, startedAt: 't0' });
    const r = claim(d, false);
    expect(r).toMatchObject({ claimed: false, blocked: { kind: 'gate-running-for-head' } });
    expect(r.blocked.reason).toContain(`a dry-run gate for this head is still running (pid ${process.pid}, started t0)`);
    expect(r.blocked.reason).toContain(`.ensemble/pr-review/${DRY}`);
    expect(fs.existsSync(marker(REAL))).toBe(false);
  });

  it('a live real gate blocks a dry-run claim for the same head', () => {
    const d = deps();
    expect(claim(d, false).claimed).toBe(true);
    patch(REAL, { pid: process.pid, startedAt: 't0' });
    expect(claim(d, true)).toMatchObject({ claimed: false, blocked: { kind: 'gate-running-for-head' } });
    expect(fs.existsSync(marker(DRY))).toBe(false);
  });

  it('once the other mode\'s gate has finished (its process is gone) the claim goes through: a dry run does not block a later real run', () => {
    const d = deps();
    expect(claim(d, true).claimed).toBe(true);
    patch(DRY, { pid: DEAD_PID, startedAt: 't0' });
    expect(claim(d, false).claimed).toBe(true);
  });

  it('a young claim of the other mode (its run alive, no gate recorded yet) blocks, and so does an orphaned one: a gate may have been launched in the instant before its run died', () => {
    const d = deps();
    expect(claim(d, true).claimed).toBe(true);
    expect(claim(d, false)).toMatchObject({ claimed: false, blocked: { kind: 'gate-running-for-head' } });
    expect(claim(d, false).blocked.reason).toContain('being started, or was interrupted while starting');
    patch(DRY, { claimer: DEAD_PID });
    expect(claim(d, false)).toMatchObject({ claimed: false, blocked: { kind: 'gate-running-for-head' } });
  });

  it('another pull request with the same head shares the clone and blocks; a different head does not', () => {
    const other = deps({ pr: 77 });
    expect(claim(other, false).claimed).toBe(true);
    patch(`precheck-pr-77-${HEAD}.gate.json`, { pid: process.pid, startedAt: 't0' });
    expect(claim(deps(), false)).toMatchObject({ claimed: false, blocked: { kind: 'gate-running-for-head' } });
    expect(claim(deps(), false, 'b'.repeat(40)).claimed).toBe(true);
  });

  it('a clone left in the runner\'s directory blocks the claim while the runner would still refuse it, and not once the runner would sweep it', () => {
    const clone = path.join(root, '.ensemble', 'local-ci-runs', HEAD);
    fs.mkdirSync(clone, { recursive: true });
    const d = deps();
    const r = claim(d, false);
    expect(r).toMatchObject({ claimed: false, blocked: { kind: 'clone-exists' } });
    expect(r.blocked.reason).toContain('.ensemble/local-ci-runs/');
    expect(fs.existsSync(marker(REAL))).toBe(false);
    const old = new Date(Date.now() - 61 * 60 * 1000);
    fs.utimesSync(clone, old, old);
    expect(claim(d, false).claimed).toBe(true);
  });

  it('refuses to claim for anything but a full sha: the head names a file', () => {
    expect(deps().claimGateStart({ headSha: '../../x', dryRun: false })).toMatchObject({ claimed: false, error: expect.stringContaining('not a full sha') });
    expect(fs.existsSync(path.join(root, STATE_SUBDIR))).toBe(false);
  });

  it('through the entry flow: while a dry gate runs the real run starts nothing and says why; after it has finished the real run starts its gate', async () => {
    const { run } = fakeRun(table());
    const a = alive();
    const dry = await runPrecheck({ dryRun: true }, deps({ run, spawnProcess: a.spawnProcess }));
    expect(dry.gate.action).toBe('started');
    const blocked = await runPrecheck({}, deps({ run, spawnProcess: a.spawnProcess }));
    expect(blocked.gate).toMatchObject({ action: 'not-started', code: 'gate-running-for-head' });
    expect(blocked.comment.body).toContain('a dry-run gate for this head is still running');
    expect(a.spawned).toHaveLength(1);
    patch(DRY, { pid: DEAD_PID });
    const real = await runPrecheck({}, deps({ run, spawnProcess: a.spawnProcess }));
    expect(real.gate.action).toBe('started');
    expect(a.spawned).toHaveLength(2);
  });

  it('through the entry flow: a clone the runner is holding stops the start before any process is spawned', async () => {
    fs.mkdirSync(path.join(root, '.ensemble', 'local-ci-runs', HEAD), { recursive: true });
    const a = alive();
    const r = await runPrecheck({}, deps({ run: fakeRun(table()).run, spawnProcess: a.spawnProcess }));
    expect(r.gate).toMatchObject({ action: 'not-started', code: 'clone-exists' });
    expect(a.spawned).toHaveLength(0);
  });
});

describe('the comment leaves this machine redacted and path-free (review round 1, finding 8)', () => {
  const SECRET = `ghp_${'A'.repeat(36)}`;
  /** The `body=` field of the gh call that wrote the comment (stdout is redacted by `main`; this is what GitHub receives). */
  const sent = (calls, method) => {
    const call = calls.find((c) => c[0] === 'gh' && c.includes('-X') && c.includes(method));
    return call === undefined ? undefined : call.find((a) => a.startsWith('body=')).slice('body='.length);
  };
  const leaky = (message) => table({ [`fetch --quiet origin ${HEAD}`]: fail(message), 'refs/pull/9/head': fail(message) });

  it('a token-shaped string in a git error reaches neither a new comment nor an updated one', async () => {
    const message = `fatal: unable to access 'https://x:${SECRET}@github.com/o/r.git/'`;
    const created = fakeRun(leaky(message));
    const r = await runPrecheck({}, deps({ run: created.run, spawnProcess: fakeSpawn().spawnProcess }));
    expect(r.gate.action).toBe('start-failed');
    const body = sent(created.calls, 'POST');
    expect(body).toContain('could NOT be started');
    expect(body).not.toContain(SECRET);
    expect(body).toContain('[REDACTED]');
    expect(body.startsWith(COMMENT_MARKER)).toBe(true);

    const updated = fakeRun({ ...leaky(message), 'issues/9/comments': ok([[{ id: 5, body: `${COMMENT_MARKER}\nold`, user: { login: 'me' } }]]), '-X PATCH': ok({ id: 5, html_url: 'u' }) });
    await runPrecheck({}, deps({ run: updated.run, spawnProcess: fakeSpawn().spawnProcess }));
    expect(sent(updated.calls, 'PATCH')).not.toContain(SECRET);
    expect(sent(updated.calls, 'PATCH')).toContain('[REDACTED]');
  });

  it('the GH_TOKEN / GITHUB_TOKEN values in the environment are redacted even when they match no token pattern', async () => {
    const saved = { GH_TOKEN: process.env.GH_TOKEN, GITHUB_TOKEN: process.env.GITHUB_TOKEN };
    process.env.GH_TOKEN = 'plain-value-that-looks-like-nothing';
    process.env.GITHUB_TOKEN = 'another-plain-value-123';
    try {
      const { run, calls } = fakeRun(leaky('fatal: auth plain-value-that-looks-like-nothing and another-plain-value-123 rejected'));
      await runPrecheck({}, deps({ run, spawnProcess: fakeSpawn().spawnProcess }));
      const body = sent(calls, 'POST');
      expect(body).toContain('could NOT be started');
      expect(body).not.toContain('plain-value-that-looks-like-nothing');
      expect(body).not.toContain('another-plain-value-123');
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });

  it('names no absolute path of this checkout or of the user home: they are repo-relative or ~', async () => {
    const t = (() => {
      const live = [];
      const spawnProcess = () => { const child = new EventEmitter(); child.pid = 7000; child.unref = () => {}; live.push(child); return child; };
      return { spawnProcess };
    })();
    jest.spyOn(fs, 'renameSync').mockImplementationOnce(() => { throw new Error(`ENOSPC: rename '${root}/.ensemble/pr-review/x.tmp' to '${os.homedir()}/elsewhere/y'`); });
    const { run, calls } = fakeRun(table());
    const r = await runPrecheck({}, deps({ run, spawnProcess: t.spawnProcess, kill: () => {} }));
    expect(r.gate.action).toBe('start-failed');
    expect(r.comment.body).toContain(root); // the result carries what happened; only what is SENT is scrubbed
    const body = sent(calls, 'POST');
    expect(body).toContain("rename '.ensemble/pr-review/x.tmp' to '~/elsewhere/y'");
    expect(body).not.toContain(root);
    expect(body).not.toContain(os.homedir());
  });
});

describe('what a run touches is what the header says (review round 1, finding 7)', () => {
  const walk = (dir, base = dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name), base) : [path.relative(base, path.join(dir, e.name))]));

  it('the header no longer claims to touch only .ensemble/pr-review/, and names everything else a run touches', () => {
    const header = fs.readFileSync(path.join(__dirname, '..', 'lib', 'review-precheck-cli.js'), 'utf8').split('*/')[0];
    expect(header).not.toMatch(/reads and writes only/i);
    for (const needle of ['git fetch origin <base>', 'refs/remotes/origin/<base>', 'FETCH_HEAD', '.ensemble/local-ci-runs/<sha>', 'the ONE PR comment', 'kill -KILL -- -<pid>']) {
      expect(header).toContain(needle);
    }
  });

  it('against a real repository: the fetch moves origin/<base> and writes FETCH_HEAD, and every file this module creates outside .git is under .ensemble/pr-review/', async () => {
    const git = (cwd, ...args) => cp.execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } }).trim();
    const origin = path.join(root, 'origin.git');
    const work = path.join(root, 'work');
    fs.mkdirSync(work);
    git(root, 'init', '--quiet', '--bare', origin);
    git(work, 'init', '--quiet');
    git(work, 'remote', 'add', 'origin', origin);
    fs.writeFileSync(path.join(work, 'a.txt'), '1');
    git(work, 'add', 'a.txt');
    git(work, 'commit', '--quiet', '-m', 'c1');
    const first = git(work, 'rev-parse', 'HEAD');
    fs.writeFileSync(path.join(work, 'b.txt'), '2');
    git(work, 'add', 'b.txt');
    git(work, 'commit', '--quiet', '-m', 'c2');
    const tip = git(work, 'rev-parse', 'HEAD');
    git(work, 'push', '--quiet', 'origin', 'HEAD:refs/heads/dev');
    git(work, 'update-ref', 'refs/remotes/origin/dev', first); // a stale tracking ref
    fs.rmSync(path.join(work, '.git', 'FETCH_HEAD'), { force: true });
    const files = () => walk(work).filter((f) => !f.startsWith('.git/')).sort();
    const before = files();

    const d = makeDeps({ repo: 'o/r', pr: 9, repoRoot: work, spawnProcess: fakeSpawn().spawnProcess, kill: () => {} }); // real git
    expect(await d.prepareGate({ headSha: tip, baseRefName: 'dev', dryRun: false })).toEqual({ ok: true });
    expect(git(work, 'rev-parse', 'refs/remotes/origin/dev')).toBe(tip);
    expect(fs.existsSync(path.join(work, '.git', 'FETCH_HEAD'))).toBe(true);
    expect(d.claimGateStart({ headSha: tip, dryRun: false }).claimed).toBe(true);
    expect((await d.startGate({ headSha: tip, baseRefName: 'dev', dryRun: false })).ok).toBe(true);
    const created = files().filter((f) => !before.includes(f));
    expect(created.length).toBeGreaterThan(0);
    expect(created.filter((f) => !f.startsWith('.ensemble/pr-review/'))).toEqual([]);
  });

  it('the posted comment shows the gate log repo-relative, never the absolute location on this machine', async () => {
    const { run, calls } = fakeRun(table());
    const r = await runPrecheck({}, deps({ run, spawnProcess: fakeSpawn().spawnProcess }));
    expect(r.gate.action).toBe('started');
    const body = calls.find((c) => c[0] === 'gh' && c.includes('POST')).find((a) => a.startsWith('body='));
    expect(body).toContain(`log \`.ensemble/pr-review/precheck-pr-9-${HEAD}.gate.log\``);
    expect(body).not.toContain(root);
  });
});

describe('readPr', () => {
  const prWith = (over) => fakeRun({ 'pr view': ok({ headRefOid: HEAD, baseRefName: 'dev', state: 'OPEN', body: 'b', author: { login: 'a' }, isCrossRepository: false, ...over }) }).run;

  it('passes the fork answer through unchanged', async () => {
    expect(await deps({ run: prWith({ isCrossRepository: true }) }).readPr()).toMatchObject({ ok: true, isCrossRepository: true });
    expect(await deps({ run: prWith({}) }).readPr()).toMatchObject({ ok: true, isCrossRepository: false });
  });

  it('refuses a base branch that could be read as an option, that gh did not state, or that the gate would refuse', async () => {
    for (const baseRefName of ['--prune', '-x', '.hidden', 'a..b', 'x.lock', 'dev/', undefined, 42]) {
      expect((await deps({ run: prWith({ baseRefName }) }).readPr()).ok).toBe(false);
    }
    for (const baseRefName of ['dev', 'release/1.2', 'feat/a_b-c.d']) {
      expect((await deps({ run: prWith({ baseRefName }) }).readPr()).ok).toBe(true);
    }
  });
});

describe('readProtection classification', () => {
  const read = (answer) => deps({ run: fakeRun({ '/protection': answer }).run }).readProtection('dev');

  it('only GitHub\'s exact "Branch not protected" 404 means no rule', async () => {
    expect(await read(fail('gh: Branch not protected (HTTP 404)', JSON.stringify({ message: 'Branch not protected' })))).toEqual({ ok: true, notProtected: true });
  });
  it('a plain 404 (no access, or no such branch), a 403 and a network error are unreadable, never "no rule"', async () => {
    for (const answer of [
      fail('gh: Not Found (HTTP 404)', JSON.stringify({ message: 'Not Found' })),
      fail('gh: Resource not accessible (HTTP 403)', JSON.stringify({ message: 'Resource not accessible by integration' })),
      fail('dial tcp: no route to host'),
    ]) {
      expect((await read(answer)).ok).toBe(false);
    }
  });
  it('a successful read returns the rule; output that is not JSON is unreadable', async () => {
    expect((await read(ok({ required_pull_request_reviews: { required_approving_review_count: 2 } }))).protection.required_pull_request_reviews.required_approving_review_count).toBe(2);
    expect((await read(ok('<html>'))).ok).toBe(false);
  });
  it('refuses a branch name that could be an option or a path escape without calling gh', async () => {
    const { run, calls } = fakeRun({});
    expect((await deps({ run }).readProtection('--hostname=evil')).ok).toBe(false);
    expect(calls).toHaveLength(0);
  });
});

describe('our one comment', () => {
  const comments = (list) => deps({ run: fakeRun({ 'api user': ok({ login: 'Me' }), 'issues/9/comments': ok([list]) }).run }).findComment();

  it('finds the comment carrying the marker that the current gh login wrote (logins compare case-insensitively)', async () => {
    const r = await comments([{ id: 3, body: `${COMMENT_MARKER}\nx`, user: { login: 'me' } }]);
    expect(r.comment.id).toBe(3);
  });
  it('ignores a marker comment written by someone else: it cannot be edited and would hide that ours is missing', async () => {
    const r = await comments([{ id: 3, body: `${COMMENT_MARKER}\nforged`, user: { login: 'attacker' } }]);
    expect(r).toEqual({ ok: true, comment: null });
  });
  it('ignores our own comments that lack the marker at the start', async () => {
    expect((await comments([{ id: 4, body: `quoting ${COMMENT_MARKER}`, user: { login: 'me' } }])).comment).toBeNull();
  });
  it('picks the oldest when more than one exists, so it never adds another', async () => {
    const r = await comments([{ id: 9, body: COMMENT_MARKER, user: { login: 'me' } }, { id: 2, body: COMMENT_MARKER, user: { login: 'me' } }]);
    expect(r.comment.id).toBe(2);
  });
  it('fails closed when the current login cannot be read', async () => {
    const r = await deps({ run: fakeRun({ 'api user': fail('no auth') }).run }).findComment();
    expect(r.ok).toBe(false);
  });
  it('rejects updating a comment without a usable id', async () => {
    expect((await deps({ run: fakeRun({}).run }).updateComment('x', 'b')).ok).toBe(false);
  });
});

describe('main', () => {
  it('prints one redacted JSON object and exits 0 on success, 1 on a failed result or a bad payload', async () => {
    const out = [];
    const base = { write: (s) => out.push(s) };
    const goodDeps = {
      readPr: async () => ({ ok: true, headSha: HEAD, baseRefName: 'dev', state: 'OPEN', body: '', author: 'a' }),
      readReviews: async () => ({ ok: true, reviews: [] }),
      readHeadTree: async () => ({ ok: false }),
      readProtection: async () => ({ ok: false, error: `token ghp_${'A'.repeat(36)}` }),
      readStatuses: async () => ({ ok: true, statuses: [{ context: CONTEXT, state: 'success', sha: HEAD }] }),
      readGateConfig: async () => ({ ok: true, statusContext: CONTEXT }),
      readPolicy: async () => ({ ok: false }),
      findComment: async () => ({ ok: true, comment: null }),
      postComment: async () => ({ ok: true, id: 1, url: 'u' }),
    };
    expect(await main({ ...base, readJson: () => ({ repo: 'o/r', pr: 9, repoRoot: root }), deps: goodDeps })).toBe(0);
    expect(out).toHaveLength(1);
    expect(out[0]).not.toContain('ghp_');
    expect(JSON.parse(out[0]).gate.action).toBe('status-present');

    out.length = 0;
    expect(await main({ ...base, readJson: () => ({ repo: 'o/r', pr: 9, repoRoot: root, nope: 1 }) })).toBe(1);
    expect(JSON.parse(out[0]).ok).toBe(false);

    out.length = 0;
    expect(await main({ ...base, readJson: () => ({ repo: 'o/r', pr: 9, repoRoot: root }), deps: { ...goodDeps, readPr: async () => ({ ok: false, error: 'gone' }) } })).toBe(1);
  });
});
