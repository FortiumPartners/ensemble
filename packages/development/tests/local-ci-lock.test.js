'use strict';

/**
 * Per-user-home gate lock (kata mjyc). Real filesystem in a temp dir; the clock, sleep, pid liveness, load average and
 * host name are injected where a test needs to control them. Every test states a guard that, if removed, makes it fail.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const lock = require('../lib/local-ci-lock');

const HOLDER = path.join(__dirname, 'helpers', 'local-ci-lock-holder.js');
const HOST = 'test-host';
const dirs = [];

function tmpDir() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'local-ci-lock-'));
  dirs.push(d);
  return d;
}
afterAll(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

/** A fake clock: sleeping advances it, so timeouts are exercised without waiting. */
function fakeTime({ onSleep } = {}) {
  let t = 1_000_000;
  const sleeps = [];
  return {
    now: () => t,
    sleep: async (ms) => {
      sleeps.push(ms);
      t += ms;
      if (onSleep) onSleep(sleeps.length);
    },
    sleeps,
  };
}

function setup(extraDeps = {}) {
  const dir = tmpDir();
  const lockPath = path.join(dir, 'gate.lock');
  const time = fakeTime(extraDeps.timeOptions);
  const deps = { now: time.now, sleep: time.sleep, host: HOST, pid: process.pid, isAlive: () => true, ...extraDeps.deps };
  return { dir, lockPath, time, deps };
}

const writeHolder = (lockPath, holder) => fs.writeFileSync(lockPath, JSON.stringify({ host: HOST, token: 'other-token', acquiredAt: '2026-01-01T00:00:00.000Z', ...holder }));
const readHolder = (lockPath) => JSON.parse(fs.readFileSync(lockPath, 'utf8'));
const leftovers = (dir) => fs.readdirSync(dir).filter((f) => f !== 'gate.lock');

describe('acquire / release', () => {
  it('creates a lock record naming this process and removes it on release; release is idempotent', async () => {
    const { dir, lockPath, deps } = setup();
    const l = await lock.acquire({ lockPath, timeoutMs: 0, deps });
    expect(l).toMatchObject({ acquired: true, queuedMs: 0, reclaimed: null });
    expect(readHolder(lockPath)).toMatchObject({ pid: process.pid, host: HOST });
    l.release();
    expect(fs.existsSync(lockPath)).toBe(false);
    expect(() => l.release()).not.toThrow();
    expect(leftovers(dir)).toEqual([]);
  });

  it('release never removes a lock that belongs to someone else', async () => {
    const { lockPath, deps } = setup();
    const l = await lock.acquire({ lockPath, timeoutMs: 0, deps });
    writeHolder(lockPath, { pid: 424242, token: 'someone-else' }); // our lock was (wrongly) replaced
    l.release();
    expect(readHolder(lockPath).token).toBe('someone-else');
  });

  it('creates the lock directory when it does not exist yet', async () => {
    const { dir, deps } = setup();
    const lockPath = path.join(dir, 'a', 'b', 'gate.lock');
    const l = await lock.acquire({ lockPath, timeoutMs: 0, deps });
    expect(l.acquired).toBe(true);
    l.release();
  });
});

describe('contention and stale detection', () => {
  it("a live holder's lock is honoured and left untouched (AC2)", async () => {
    const { lockPath, deps } = setup({ deps: { isAlive: () => true } });
    writeHolder(lockPath, { pid: 777 });
    const before = fs.readFileSync(lockPath, 'utf8');
    const r = await lock.acquire({ lockPath, timeoutMs: 0, deps });
    expect(r).toMatchObject({ acquired: false, code: 'lock-timeout', blockedBy: 'holder', holder: { pid: 777 } });
    expect(r.error).toContain('pid 777');
    expect(fs.readFileSync(lockPath, 'utf8')).toBe(before);
  });

  it('a lock whose pid is dead is reclaimed, and the reclaimed holder is reported (AC2, real dead pid)', async () => {
    const { dir, lockPath, time } = setup();
    const dead = spawnSync(process.execPath, ['-e', '0']).pid;
    writeHolder(lockPath, { pid: dead });
    const l = await lock.acquire({ lockPath, timeoutMs: 0, deps: { now: time.now, sleep: time.sleep, host: HOST } });
    expect(l.acquired).toBe(true);
    expect(l.reclaimed).toMatchObject({ pid: dead });
    expect(readHolder(lockPath).pid).toBe(process.pid);
    expect(leftovers(dir)).toEqual([]); // no tombstone left behind
  });

  it('an unreadable lock record is reclaimed rather than blocking forever', async () => {
    const { lockPath, deps } = setup();
    fs.writeFileSync(lockPath, '{not json');
    const l = await lock.acquire({ lockPath, timeoutMs: 0, deps });
    expect(l.acquired).toBe(true);
    expect(l.reclaimed).toEqual({ unreadable: true });
  });

  it('a lock written by another host cannot be judged stale from here and is honoured', async () => {
    const { lockPath, deps } = setup({ deps: { isAlive: () => false } });
    writeHolder(lockPath, { pid: 5, host: 'some-other-machine' });
    const r = await lock.acquire({ lockPath, timeoutMs: 0, deps });
    expect(r).toMatchObject({ acquired: false, code: 'lock-timeout' });
    expect(readHolder(lockPath).host).toBe('some-other-machine');
  });

  it('a waiter takes the lock once the holder releases, and reports how long it queued (AC1)', async () => {
    const { lockPath, deps } = setup();
    writeHolder(lockPath, { pid: 777 });
    // The holder lets go during the third poll.
    const time = fakeTime({ onSleep: (n) => n === 3 && fs.rmSync(lockPath) });
    const r = await lock.acquire({ lockPath, timeoutMs: 10_000, pollMs: 100, deps: { ...deps, now: time.now, sleep: time.sleep } });
    expect(r).toMatchObject({ acquired: true, queuedMs: 300 });
    expect(time.sleeps).toEqual([100, 100, 100]);
    expect(readHolder(lockPath).pid).toBe(process.pid);
  });

  it('times out with a named error, runs nothing and leaks no files (AC3)', async () => {
    const { dir, lockPath, deps, time } = setup();
    writeHolder(lockPath, { pid: 777 });
    const r = await lock.acquire({ lockPath, timeoutMs: 450, pollMs: 100, deps });
    expect(r).toMatchObject({ acquired: false, code: 'lock-timeout', queuedMs: 450, blockedBy: 'holder' });
    expect(time.sleeps).toEqual([100, 100, 100, 100, 50]); // the last sleep is clipped to the remaining budget
    expect(readHolder(lockPath).pid).toBe(777);
    expect(leftovers(dir)).toEqual([]);
  });

  it('puts back a live lock it moved aside by mistake instead of destroying it', async () => {
    // The lock looked stale when read, but a live process replaced it before our rename moved it aside.
    const { lockPath, deps } = setup({ deps: { isAlive: (pid) => pid !== 111 } });
    writeHolder(lockPath, { pid: 111, token: 'stale-token' });
    const realFs = require('fs');
    const racing = {
      ...realFs,
      renameSync: (from, to) => {
        writeHolder(lockPath, { pid: 222, token: 'fresh-live-token' });
        return realFs.renameSync(from, to);
      },
    };
    const r = await lock.acquire({ lockPath, timeoutMs: 0, deps: { ...deps, fs: racing } });
    expect(r.acquired).toBe(false);
    expect(readHolder(lockPath)).toMatchObject({ pid: 222, token: 'fresh-live-token' });
  });
});

describe('a lock path that holds no readable record (review round 1: the wait must always spend its budget)', () => {
  /** A fs whose reads are counted and capped: a loop that stops spending its budget fails the test instead of hanging it. */
  function cappedFs(limit = 200) {
    const counts = { reads: 0 };
    const capped = {
      ...fs,
      readFileSync: (...args) => {
        if (++counts.reads > limit) throw new Error(`the lock was read ${counts.reads} times without the wait budget being spent`);
        return fs.readFileSync(...args);
      },
    };
    return { capped, counts };
  }

  it('a dangling symlink at the lock path ends in lock-timeout when the budget is 0, instead of spinning', async () => {
    const { dir, lockPath, deps } = setup();
    fs.symlinkSync(path.join(dir, 'no-such-target'), lockPath); // link() says EEXIST, every read says ENOENT
    const { capped, counts } = cappedFs();
    const r = await lock.acquire({ lockPath, timeoutMs: 0, deps: { ...deps, fs: capped } });
    expect(r).toMatchObject({ acquired: false, code: 'lock-timeout', blockedBy: 'path', queuedMs: 0 });
    expect(r.error).toContain(lockPath);
    expect(counts.reads).toBe(1);
    expect(fs.lstatSync(lockPath).isSymbolicLink()).toBe(true); // left for the operator: a gate never deletes what it cannot judge
    expect(leftovers(dir)).toEqual([]);
  });

  it('a dangling symlink is waited on like any blocked lock: it polls and gives up exactly at the budget', async () => {
    const { dir, lockPath, deps, time } = setup();
    fs.symlinkSync(path.join(dir, 'no-such-target'), lockPath);
    const { capped } = cappedFs();
    const r = await lock.acquire({ lockPath, timeoutMs: 450, pollMs: 100, deps: { ...deps, fs: capped } });
    expect(r).toMatchObject({ acquired: false, code: 'lock-timeout', blockedBy: 'path', queuedMs: 450 });
    expect(time.sleeps).toEqual([100, 100, 100, 100, 50]); // the last sleep is clipped to the remaining budget
  });

  it('a lock released between the create attempt and the read is taken on the next round, after one poll', async () => {
    const { lockPath, deps, time } = setup();
    writeHolder(lockPath, { pid: 777 });
    let released = false;
    const racing = {
      ...fs,
      readFileSync: (...args) => {
        if (!released) {
          released = true;
          fs.rmSync(lockPath); // the holder lets go right before we look
        }
        return fs.readFileSync(...args);
      },
    };
    const r = await lock.acquire({ lockPath, timeoutMs: 10_000, pollMs: 100, deps: { ...deps, fs: racing } });
    expect(r).toMatchObject({ acquired: true, queuedMs: 100 });
    expect(time.sleeps).toEqual([100]);
    expect(readHolder(lockPath).pid).toBe(process.pid);
  });
});

describe('a filesystem failure is a named refusal, not an exception (review round 1: lock-io)', () => {
  const sysError = (code, syscall, message) => Object.assign(new Error(message), { code, syscall });

  it('an unusable lock directory resolves to lock-io naming the lock path and the cause', async () => {
    const { dir, deps } = setup();
    const aFile = path.join(dir, 'a-file');
    fs.writeFileSync(aFile, 'not a directory');
    const lockPath = path.join(aFile, 'locks', 'gate.lock'); // the parent is a regular file: mkdir fails with ENOTDIR
    const r = await lock.acquire({ lockPath, timeoutMs: 0, deps });
    expect(r).toMatchObject({ acquired: false, code: 'lock-io', queuedMs: expect.any(Number) });
    expect(r.error).toContain(lockPath);
    expect(r.error).toMatch(/ENOTDIR/);
  });

  it('a link that fails for a reason other than EEXIST leaves no lock and no temp file', async () => {
    const { dir, lockPath, deps } = setup();
    const failing = {
      ...fs,
      linkSync: () => {
        throw sysError('EPERM', 'link', 'EPERM: operation not permitted, link');
      },
    };
    const r = await lock.acquire({ lockPath, timeoutMs: 0, deps: { ...deps, fs: failing } });
    expect(r).toMatchObject({ acquired: false, code: 'lock-io' });
    expect(r.error).toContain('EPERM');
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it('a lock file that cannot be read resolves to lock-io and is left untouched', async () => {
    const { lockPath, deps } = setup();
    writeHolder(lockPath, { pid: 777 });
    const denied = {
      ...fs,
      readFileSync: () => {
        throw sysError('EACCES', 'open', "EACCES: permission denied, open 'gate.lock'");
      },
    };
    const r = await lock.acquire({ lockPath, timeoutMs: 0, deps: { ...deps, fs: denied } });
    expect(r).toMatchObject({ acquired: false, code: 'lock-io' });
    expect(r.error).toContain('EACCES');
    expect(readHolder(lockPath).pid).toBe(777);
  });

  it('only system errors become lock-io: a bug in an injected dependency still throws', async () => {
    const { lockPath, deps } = setup({ deps: { loadavg: () => { throw new TypeError('broken load probe'); } } });
    await expect(lock.acquire({ lockPath, timeoutMs: 0, maxLoad: 5, deps })).rejects.toThrow('broken load probe');
  });
});

describe('load policy', () => {
  it('refuse: a load above the ceiling is refused at once and takes no lock', async () => {
    const { dir, lockPath, deps } = setup({ deps: { loadavg: () => 30 } });
    const r = await lock.acquire({ lockPath, timeoutMs: 10_000, maxLoad: 12, loadPolicy: 'refuse', deps });
    expect(r).toMatchObject({ acquired: false, code: 'load-too-high', load: 30 });
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it('wait: proceeds once the load falls under the ceiling', async () => {
    const loads = [30, 25, 8];
    const { lockPath, deps, time } = setup({ deps: { loadavg: () => loads.shift() } });
    const r = await lock.acquire({ lockPath, timeoutMs: 10_000, pollMs: 100, maxLoad: 12, loadPolicy: 'wait', deps });
    expect(r).toMatchObject({ acquired: true, queuedMs: 200 });
    expect(time.sleeps).toEqual([100, 100]);
  });

  it('wait: a load that never falls ends in a timeout that names the load', async () => {
    const { lockPath, deps } = setup({ deps: { loadavg: () => 30 } });
    const r = await lock.acquire({ lockPath, timeoutMs: 300, pollMs: 100, maxLoad: 12, deps });
    expect(r).toMatchObject({ acquired: false, code: 'lock-timeout', blockedBy: 'load', load: 30 });
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it('no ceiling configured: the load average is never consulted', async () => {
    const { lockPath, deps } = setup({ deps: { loadavg: () => { throw new Error('must not be read'); } } });
    expect((await lock.acquire({ lockPath, timeoutMs: 0, deps })).acquired).toBe(true);
  });
});

describe('environment policy', () => {
  it('defaults to a persistent per-user directory outside /tmp, a 30 minute wait and no load check', () => {
    const p = lock.policyFromEnv({});
    expect(p).toMatchObject({ ok: true, timeoutMs: 30 * 60 * 1000, maxLoad: null, loadPolicy: 'wait' });
    expect(p.lockPath).toBe(path.join(os.homedir(), '.ensemble', 'locks', lock.LOCK_FILE));
  });

  it('reads the directory, timeout, ceiling and policy', () => {
    const p = lock.policyFromEnv({ ENSEMBLE_LOCAL_CI_LOCK_DIR: '/x/y', ENSEMBLE_LOCAL_CI_LOCK_TIMEOUT_MS: '0', ENSEMBLE_LOCAL_CI_MAX_LOAD: '12.5', ENSEMBLE_LOCAL_CI_LOAD_POLICY: 'refuse' });
    expect(p).toMatchObject({ ok: true, lockPath: path.join('/x/y', lock.LOCK_FILE), timeoutMs: 0, maxLoad: 12.5, loadPolicy: 'refuse' });
  });

  it.each([
    [{ ENSEMBLE_LOCAL_CI_LOCK_TIMEOUT_MS: 'soon' }, /TIMEOUT_MS/],
    [{ ENSEMBLE_LOCAL_CI_LOCK_TIMEOUT_MS: '-5' }, /TIMEOUT_MS/],
    [{ ENSEMBLE_LOCAL_CI_MAX_LOAD: 'high' }, /MAX_LOAD/],
    [{ ENSEMBLE_LOCAL_CI_MAX_LOAD: '0' }, /MAX_LOAD/],
    [{ ENSEMBLE_LOCAL_CI_LOAD_POLICY: 'ignore' }, /LOAD_POLICY/],
  ])('a malformed knob %j is an error, never silently ignored', async (env, re) => {
    expect(lock.policyFromEnv(env)).toMatchObject({ ok: false, error: expect.stringMatching(re) });
    const r = await lock.acquireFromEnv({ ENSEMBLE_LOCAL_CI_LOCK_DIR: tmpDir(), ...env });
    expect(r).toMatchObject({ acquired: false, code: 'bad-lock-policy' });
  });

  it('the default wait is at least one worst-case holder and never under 30 minutes; an explicit value always wins (review round 1)', () => {
    const minutes = 60 * 1000;
    expect(lock.policyFromEnv({}, { worstCaseHoldMs: 200 * minutes }).timeoutMs).toBe(200 * minutes);
    expect(lock.policyFromEnv({}, { worstCaseHoldMs: 10 * minutes }).timeoutMs).toBe(30 * minutes);
    expect(lock.policyFromEnv({}, { worstCaseHoldMs: Number.NaN }).timeoutMs).toBe(30 * minutes);
    expect(lock.policyFromEnv({}).timeoutMs).toBe(30 * minutes);
    expect(lock.policyFromEnv({ ENSEMBLE_LOCAL_CI_LOCK_TIMEOUT_MS: '60000' }, { worstCaseHoldMs: 200 * minutes }).timeoutMs).toBe(60000);
    expect(lock.policyFromEnv({ ENSEMBLE_LOCAL_CI_LOCK_TIMEOUT_MS: '0' }, { worstCaseHoldMs: 200 * minutes }).timeoutMs).toBe(0);
  });

  it('acquireFromEnv waits on a live holder for the worst case it was told about, and for 30 minutes when told nothing', async () => {
    const minute = 60 * 1000;
    const dir = tmpDir();
    writeHolder(path.join(dir, lock.LOCK_FILE), { pid: 777 });
    let t = 0;
    // Every sleep advances the clock a minute, so a wait of tens of minutes is dozens of rounds, not thousands.
    const deps = { now: () => t, sleep: async () => { t += minute; }, host: HOST, isAlive: () => true };
    const env = { ENSEMBLE_LOCAL_CI_LOCK_DIR: dir };
    const told = await lock.acquireFromEnv(env, deps, { worstCaseHoldMs: 90 * minute });
    expect(told).toMatchObject({ acquired: false, code: 'lock-timeout' });
    expect(told.queuedMs).toBeGreaterThanOrEqual(90 * minute);
    t = 0;
    const untold = await lock.acquireFromEnv(env, deps);
    expect(untold).toMatchObject({ acquired: false, code: 'lock-timeout' });
    expect(untold.queuedMs).toBeGreaterThanOrEqual(30 * minute);
    expect(untold.queuedMs).toBeLessThan(40 * minute);
  });
});

describe('across real processes (AC1)', () => {
  it('two processes contending for one lock run one after the other; neither is lost', async () => {
    const dir = tmpDir();
    const lockPath = path.join(dir, 'gate.lock');
    const logFile = path.join(dir, 'log.jsonl');
    const run = (label) =>
      new Promise((resolve) => {
        const child = spawn(process.execPath, [HOLDER, lockPath, logFile, '500', label], { stdio: ['ignore', 'pipe', 'inherit'] });
        let out = '';
        child.stdout.on('data', (c) => (out += c));
        child.on('close', (code) => resolve({ code, result: JSON.parse(out) }));
      });
    const [a, b] = await Promise.all([run('a'), run('b')]);
    expect([a.code, b.code]).toEqual([0, 0]);

    const events = fs.readFileSync(logFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(events.map((e) => e.event)).toEqual(['start', 'end', 'start', 'end']); // never start, start
    expect(events[0].label).toBe(events[1].label);
    expect(events[2].at).toBeGreaterThanOrEqual(events[1].at);

    const second = [a, b].find((r) => r.result.label === events[2].label).result;
    expect(second.queuedMs).toBeGreaterThanOrEqual(300); // it waited for most of the first holder's 500ms
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it('four processes contending for one lock (three queued behind the holder) run one at a time; none is lost', async () => {
    const dir = tmpDir();
    const lockPath = path.join(dir, 'gate.lock');
    const logFile = path.join(dir, 'log.jsonl');
    const run = (label) =>
      new Promise((resolve) => {
        const child = spawn(process.execPath, [HOLDER, lockPath, logFile, '200', label], { stdio: ['ignore', 'pipe', 'inherit'] });
        let out = '';
        child.stdout.on('data', (c) => (out += c));
        child.on('close', (code) => resolve({ code, result: JSON.parse(out) }));
      });
    const done = await Promise.all(['a', 'b', 'c', 'd'].map(run));
    expect(done.map((r) => r.code)).toEqual([0, 0, 0, 0]);

    const events = fs.readFileSync(logFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(events.map((e) => e.event)).toEqual(['start', 'end', 'start', 'end', 'start', 'end', 'start', 'end']); // never start, start
    for (let i = 0; i < events.length; i += 2) expect(events[i].label).toBe(events[i + 1].label); // each holder ends before the next begins
    expect(events.filter((e) => e.event === 'start').map((e) => e.label).sort()).toEqual(['a', 'b', 'c', 'd']);
    expect(fs.existsSync(lockPath)).toBe(false);
  });
});
