'use strict';

/**
 * Advisory lock that serializes local-CI runs (`local-ci-cli.js gate` and `run`): one at a time per home directory.
 *
 * WHY: a gate run is a clean clone plus the repo's whole CI command list. Several reviewer swarms each starting one at
 * once is what drives the machine's load average into the tens and makes every gate (and every reviewer) flake. One
 * run at a time; the next one waits its turn and records how long it waited (`queuedMs`). The lock lives under the
 * user's home directory (never /tmp), so it serializes every process that shares that home: another account, or a
 * process started with a different `$HOME`, has its own lock.
 *
 * LOCK FILE: `<dir>/local-ci-gate.lock`, default dir `~/.ensemble/locks` (persistent, outside every worktree, never
 * /tmp). It holds `{pid, host, token, acquiredAt}` as JSON. It is created atomically WITH its content (write a private
 * temp file, then `link()` it into place: EEXIST means somebody holds it), so a reader never sees a half-written lock.
 *
 * STALE DETECTION: a lock whose holder pid is no longer alive (`kill(pid, 0)` says ESRCH), or whose content is not a
 * valid lock record, is reclaimed. A LIVE pid's lock is always honoured. A lock written by a different host (shared
 * home directory) cannot be judged from here and is honoured too; waiting on it ends in the timeout error, which names
 * the holder so the operator can remove it. A path that exists but cannot be read at all (a dangling symlink) is not
 * reclaimed either: it is waited on like any other blocked lock and ends in the same timeout error, which names the
 * path. Reclaiming renames the stale file to a private tombstone and checks the token it moved: if it was not the stale
 * lock we examined (somebody replaced it in between) it is put back.
 *
 * KNOWN GAPS, deliberately accepted:
 *   - a sub-millisecond window in which a third process creates the lock between that rename and the put-back; the
 *     displaced holder would then run concurrently with the new one for one gate;
 *   - PID reuse by an unrelated live process keeps a dead holder's lock "held" until the timeout;
 *   - a holder killed with SIGKILL leaves the CI step it was running alive (the runner starts every step in its own
 *     process group), so the next run can start while that step is still going: the lock sees only the dead pid.
 *
 * QUEUE: waiters poll. Order among waiters is NOT FIFO; every waiter is bounded by `timeoutMs`, after which it gets a
 * named error (`lock-timeout`) and runs nothing. The default bound is 30 minutes: three runs ahead of a waiter at the 8
 * to 9 minutes each that the plan measures under load. `acquireFromEnv` raises it to at least one holder's worst case
 * (`worstCaseHoldMs`, from the runner), so one holder that stays inside the runner's own limits can never make a waiter
 * give up. A deeper queue needs ENSEMBLE_LOCAL_CI_LOCK_TIMEOUT_MS (RUNBOOK, "Capacity").
 *
 * LOAD POLICY (optional, off unless `maxLoad` is set): while the 1-minute load average is above `maxLoad` the caller
 * either WAITS (`loadPolicy: 'wait'`, the default) or is REFUSED at once (`'refuse'`, code `load-too-high`).
 *
 * Every dependency (fs, clock, sleep, liveness, load, identity) is injectable. `acquire` never throws for lock
 * contention or for a filesystem failure (an unusable lock directory, a failed link or read): both resolve to
 * `{acquired:false, code, error}` with code `lock-timeout`, `load-too-high` or `lock-io`. `release()` is idempotent and
 * never throws.
 *
 * Environment knobs read by `acquireFromEnv` (a malformed value is an error, never silently ignored):
 *   ENSEMBLE_LOCAL_CI_LOCK_DIR         directory holding the lock file
 *   ENSEMBLE_LOCAL_CI_LOCK_TIMEOUT_MS  max wait, default 1800000 (30 min) or one worst-case holder if longer; 0 = try once
 *   ENSEMBLE_LOCAL_CI_MAX_LOAD         1-minute load-average ceiling; unset = no load check
 *   ENSEMBLE_LOCAL_CI_LOAD_POLICY      `wait` (default) | `refuse`
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const LOCK_FILE = 'local-ci-gate.lock';
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_POLL_MS = 250;
const LOAD_POLICIES = Object.freeze(['wait', 'refuse']);

/** Is `pid` a running process? EPERM means it exists but belongs to someone else: alive. */
function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

const realSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function defaultLockDir(env) {
  const configured = env && env.ENSEMBLE_LOCAL_CI_LOCK_DIR;
  return typeof configured === 'string' && configured.trim() !== '' ? path.resolve(configured) : path.join(os.homedir(), '.ensemble', 'locks');
}

function parseHolder(raw) {
  try {
    const v = JSON.parse(raw);
    if (v && Number.isInteger(v.pid) && v.pid > 0 && typeof v.token === 'string' && v.token !== '') return v;
  } catch (_e) {
    /* unreadable: not a lock record */
  }
  return null;
}

/**
 * Take the lock, waiting up to `timeoutMs`.
 * @param {object} o
 * @param {string} o.lockPath
 * @param {number} [o.timeoutMs]    max wait (default 30 min); 0 tries exactly once
 * @param {number} [o.pollMs]
 * @param {number|null} [o.maxLoad] 1-minute load ceiling; null/undefined disables the check
 * @param {'wait'|'refuse'} [o.loadPolicy]
 * @param {object} [o.deps]         { fs, now, sleep, isAlive, loadavg, pid, host, token }
 * @returns {Promise<{acquired:true, queuedMs:number, reclaimed:object|null, release:Function}
 *   | {acquired:false, code:string, error:string, queuedMs:number, holder?:object, load?:number}>}
 */
async function acquire(o) {
  const d = {
    fs,
    now: Date.now,
    sleep: realSleep,
    isAlive: pidAlive,
    loadavg: () => os.loadavg()[0],
    pid: process.pid,
    host: os.hostname(),
    token: () => crypto.randomBytes(12).toString('hex'),
    ...(o.deps || {}),
  };
  const { lockPath } = o;
  const timeoutMs = o.timeoutMs === undefined ? DEFAULT_TIMEOUT_MS : o.timeoutMs;
  const pollMs = o.pollMs === undefined ? DEFAULT_POLL_MS : o.pollMs;
  const maxLoad = o.maxLoad === undefined ? null : o.maxLoad;
  const loadPolicy = o.loadPolicy === undefined ? 'wait' : o.loadPolicy;
  if (typeof lockPath !== 'string' || lockPath === '') throw new Error('lockPath is required');
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) throw new Error('timeoutMs must be a non-negative number');
  if (maxLoad !== null && (!Number.isFinite(maxLoad) || maxLoad <= 0)) throw new Error('maxLoad must be a positive number');
  if (!LOAD_POLICIES.includes(loadPolicy)) throw new Error(`loadPolicy must be one of ${LOAD_POLICIES.join(', ')}`);

  const started = d.now();
  const queued = () => Math.max(0, d.now() - started);
  const myToken = d.token();
  const mine = { pid: d.pid, host: d.host, token: myToken, acquiredAt: new Date(started).toISOString() };
  let reclaimed = null;

  /** Atomically create the lock with its content. true = we hold it, false = somebody else does. */
  const tryCreate = () => {
    const tmp = `${lockPath}.${d.pid}.${myToken}.tmp`;
    d.fs.writeFileSync(tmp, JSON.stringify(mine), { flag: 'wx' });
    try {
      d.fs.linkSync(tmp, lockPath);
      return true;
    } catch (err) {
      if (err.code === 'EEXIST') return false;
      throw err;
    } finally {
      try {
        d.fs.unlinkSync(tmp);
      } catch (_e) {
        /* already gone */
      }
    }
  };

  /** Move a stale lock aside. Returns true when the slot should now be free (or someone else freed it). */
  const reclaim = (stale, raw) => {
    const tomb = `${lockPath}.stale.${d.pid}.${myToken}`;
    try {
      d.fs.renameSync(lockPath, tomb);
    } catch (err) {
      if (err.code === 'ENOENT') return true; // somebody else reclaimed or released it first
      throw err;
    }
    let moved = '';
    try {
      moved = d.fs.readFileSync(tomb, 'utf8');
    } catch (_e) {
      /* unreadable tombstone: treated as not the lock we examined */
    }
    if (moved === raw) {
      try {
        d.fs.unlinkSync(tomb);
      } catch (_e) {
        /* best effort */
      }
      reclaimed = stale || { unreadable: true };
      return true;
    }
    // We moved a lock somebody created after we looked: put it back. link() refuses to overwrite.
    try {
      d.fs.linkSync(tomb, lockPath);
    } catch (_e) {
      /* the slot was taken again; nothing more can be done safely */
    }
    try {
      d.fs.unlinkSync(tomb);
    } catch (_e) {
      /* best effort */
    }
    return false;
  };

  const release = () => {
    try {
      const holder = parseHolder(d.fs.readFileSync(lockPath, 'utf8'));
      if (holder && holder.token === myToken) d.fs.unlinkSync(lockPath);
    } catch (_e) {
      /* absent, replaced or unreadable: nothing of ours to remove */
    }
  };

  const fail = (code, error, extra) => ({ acquired: false, code, error, queuedMs: queued(), ...(extra || {}) });

  try {
    d.fs.mkdirSync(path.dirname(lockPath), { recursive: true });

    for (;;) {
      let blocked; // why this round could not proceed: { by, text, holder?, load? }

      const load = maxLoad === null ? 0 : d.loadavg();
      if (maxLoad !== null && load > maxLoad) {
        const text = `load average ${load.toFixed(2)} is above the ${maxLoad} ceiling`;
        if (loadPolicy === 'refuse') return fail('load-too-high', `${text}; not starting a gate now`, { load });
        blocked = { by: 'load', text, load };
      } else if (tryCreate()) {
        return { acquired: true, queuedMs: queued(), reclaimed, release };
      } else {
        let raw = null;
        try {
          raw = d.fs.readFileSync(lockPath, 'utf8');
        } catch (err) {
          if (err.code !== 'ENOENT') throw err;
        }
        if (raw === null) {
          // link() just said the path exists, yet nothing can be read from it: the holder let go in between (the next
          // round takes it), or the path is a dangling symlink, which stays that way. Either way this round is blocked
          // like any other: it spends the wait budget and sleeps. Retrying at once instead let a dangling symlink spin
          // the loop at full CPU, past `timeoutMs`.
          blocked = { by: 'path', text: 'lock file unreadable: a dangling symlink, or released while it was read' };
        } else {
          const holder = parseHolder(raw);
          const foreign = holder !== null && holder.host !== undefined && holder.host !== d.host;
          if (!foreign && (holder === null || !d.isAlive(holder.pid))) {
            if (reclaim(holder, raw)) continue;
          }
          blocked = {
            by: 'holder',
            holder,
            text: holder
              ? `held by pid ${holder.pid} on ${holder.host || 'unknown host'} since ${holder.acquiredAt || 'unknown time'}`
              : 'held by an unreadable lock record',
          };
        }
      }

      const waited = queued();
      if (waited >= timeoutMs) {
        return fail('lock-timeout', `gave up after ${waited}ms: ${blocked.text} (${lockPath})`, {
          blockedBy: blocked.by,
          ...(blocked.holder ? { holder: blocked.holder } : {}),
          ...(blocked.load !== undefined ? { load: blocked.load } : {}),
        });
      }
      await d.sleep(Math.min(pollMs, timeoutMs - waited));
    }
  } catch (err) {
    // A filesystem failure (an unusable lock directory, a failed link, an unreadable lock file) ends the wait with a
    // named refusal, like contention does, instead of escaping as a bare exception with no code and no wait time. Only
    // system errors qualify; anything else is a bug and still throws.
    if (err && typeof err.code === 'string' && typeof err.syscall === 'string') {
      return fail('lock-io', `cannot use the lock at ${lockPath}: ${err.message}`);
    }
    throw err;
  }
}

/**
 * Parse the ENSEMBLE_LOCAL_CI_* knobs. Malformed values are errors: a typo must not silently disable a policy.
 * `hold.worstCaseHoldMs` (the longest one holder can take inside the runner's own limits) raises the DEFAULT wait to at
 * least that long; an explicit ENSEMBLE_LOCAL_CI_LOCK_TIMEOUT_MS, including 0, always wins.
 */
function policyFromEnv(env, hold) {
  const e = env || {};
  const worst = hold && hold.worstCaseHoldMs;
  const defaultWait = Number.isFinite(worst) && worst > DEFAULT_TIMEOUT_MS ? worst : DEFAULT_TIMEOUT_MS;
  const out = { lockPath: path.join(defaultLockDir(e), LOCK_FILE), timeoutMs: defaultWait, maxLoad: null, loadPolicy: 'wait' };
  const num = (name) => {
    const raw = e[name];
    if (raw === undefined || raw === '') return undefined;
    return /^\d+(\.\d+)?$/.test(String(raw).trim()) ? Number(raw) : NaN;
  };
  const timeout = num('ENSEMBLE_LOCAL_CI_LOCK_TIMEOUT_MS');
  if (Number.isNaN(timeout)) return { ok: false, error: 'ENSEMBLE_LOCAL_CI_LOCK_TIMEOUT_MS must be a non-negative number of milliseconds' };
  if (timeout !== undefined) out.timeoutMs = timeout;
  const maxLoad = num('ENSEMBLE_LOCAL_CI_MAX_LOAD');
  if (Number.isNaN(maxLoad) || maxLoad === 0) return { ok: false, error: 'ENSEMBLE_LOCAL_CI_MAX_LOAD must be a positive number' };
  if (maxLoad !== undefined) out.maxLoad = maxLoad;
  const policy = e.ENSEMBLE_LOCAL_CI_LOAD_POLICY;
  if (policy !== undefined && policy !== '') {
    if (!LOAD_POLICIES.includes(policy)) return { ok: false, error: `ENSEMBLE_LOCAL_CI_LOAD_POLICY must be one of ${LOAD_POLICIES.join(', ')}` };
    out.loadPolicy = policy;
  }
  return { ok: true, ...out };
}

/** acquire() configured from the environment; a malformed knob resolves to a refusal rather than throwing. */
async function acquireFromEnv(env, deps, hold) {
  const policy = policyFromEnv(env, hold);
  if (!policy.ok) return { acquired: false, code: 'bad-lock-policy', error: policy.error, queuedMs: 0 };
  const { ok: _ok, ...options } = policy;
  return acquire({ ...options, deps });
}

module.exports = { acquire, acquireFromEnv, policyFromEnv, defaultLockDir, pidAlive, LOCK_FILE, DEFAULT_TIMEOUT_MS, DEFAULT_POLL_MS };
