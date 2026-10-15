/**
 * QuickTunnel lifecycle tests.
 *
 * Uses an injectable `_spawn` factory so we can exercise the URL-discovery,
 * timeout, and stop() paths without depending on a real Cloudflare daemon
 * or shell timing. The factory returns a stand-in ChildProcess that mimics
 * the surface `start()` reads: `stdout.on('data')`, `stderr.on('data')`,
 * `once('error')`, `once('exit')`, `kill`, `exitCode`, `signalCode`.
 */
'use strict';

const { EventEmitter } = require('events');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { resolveCloudflared } = require('../../lib/refinement-review/tunnel');

/**
 * Build a fake Cloudflare "child process" that emits a configurable
 * sequence of stdout/stderr chunks and then exits.
 */
function fakeProc({ chunks = [], exitAfter = 5, exitCode = 0, signalCode = null, onKill } = {}) {
  const proc = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.exitCode = null;
  proc.signalCode = null;
  proc.kill = (sig) => {
    if (onKill) onKill(sig);
    // Don't auto-emit exit; the caller decides.
  };
  const timer = setTimeout(() => {
    proc.exitCode = exitCode;
    proc.signalCode = signalCode;
    proc.emit('exit', exitCode, signalCode);
  }, exitAfter);
  if (typeof timer.unref === 'function') timer.unref();
  for (const { stream, value, delay } of chunks) {
    setTimeout(() => {
      proc[stream].emit('data', Buffer.from(value));
    }, delay).unref();
  }
  return proc;
}

function spawnFactory(proc) {
  return () => proc;
}

/**
 * Pin the binary resolution to a path this test owns.
 *
 * `resolveCloudflared` searches the host — ~/.cloudflared, /usr/local/bin,
 * /opt/homebrew/bin, /usr/bin — and falls back to the bare name `cloudflared`
 * only when it finds nothing. A test that injects `_spawn` but leaves
 * resolution alone therefore asserts a different string depending on whether
 * the host happens to have cloudflared installed, and the bare-name assertion
 * holds only on a host that does not. Passing `cloudflaredPath` makes the
 * assertion the same everywhere, and it is the override the module documents
 * for exactly this.
 *
 * The file has to exist, because resolution skips a candidate it cannot stat.
 * Registered for cleanup rather than removed in a `finally`, so the assertion
 * stays readable.
 */
const pinnedBinaryDirs = [];
function withPinnedBinary() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rr-bin-'));
  pinnedBinaryDirs.push(dir);
  const bin = path.join(dir, 'cloudflared');
  fs.writeFileSync(bin, '#!/bin/sh\n');
  return bin;
}

/** Match the `(attempted: …)` suffix for one resolved path, specials escaped. */
function attemptedRe(bin) {
  return new RegExp(`\\(attempted: ${bin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)`);
}

afterAll(() => {
  for (const dir of pinnedBinaryDirs) fs.rmSync(dir, { recursive: true, force: true });
});

describe('QuickTunnel', () => {
  test('resolveCloudflared finds the explicit path', () => {
    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rr-bin-'));
    const fake = path.join(dir, 'cloudflared');
    fs.writeFileSync(fake, '#!/bin/sh\n');
    try {
      expect(resolveCloudflared({ cloudflaredPath: fake })).toBe(fake);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('rejects with TypeError when targetUrl is missing', () => {
    const { QuickTunnel } = require('../../lib/refinement-review/tunnel');
    expect(() => new QuickTunnel({})).toThrow(TypeError);
  });

  test('start() resolves when URL is printed on stdout with newline', async () => {
    const { QuickTunnel } = require('../../lib/refinement-review/tunnel');
    const proc = fakeProc({
      chunks: [
        { stream: 'stdout', value: 'https://abc123.trycloudflare.com\n', delay: 5 },
      ],
      exitAfter: 50,
    });
    const t = new QuickTunnel({
      targetUrl: 'http://127.0.0.1:1',
      timeoutMs: 4000,
      _spawn: spawnFactory(proc),
    });
    const h = await t.start();
    expect(h.url).toBe('https://abc123.trycloudflare.com');
    expect(h.host).toBe('abc123.trycloudflare.com');
    expect(t.proc).toBe(proc);
  });

  test('start() resolves when URL is split across chunks (no newline between)', async () => {
    const { QuickTunnel } = require('../../lib/refinement-review/tunnel');
    const proc = fakeProc({
      chunks: [
        { stream: 'stdout', value: 'https://', delay: 5 },
        { stream: 'stdout', value: 'split-xyz.trycloudflare.com', delay: 20 },
      ],
      exitAfter: 100,
    });
    const t = new QuickTunnel({
      targetUrl: 'http://127.0.0.1:1',
      timeoutMs: 4000,
      _spawn: spawnFactory(proc),
    });
    const h = await t.start();
    expect(h.url).toBe('https://split-xyz.trycloudflare.com');
  });

  test('start() resolves when URL is printed with no trailing newline at all', async () => {
    const { QuickTunnel } = require('../../lib/refinement-review/tunnel');
    const proc = fakeProc({
      chunks: [
        { stream: 'stdout', value: 'https://nolf-xyz.trycloudflare.com', delay: 5 },
      ],
      exitAfter: 100,
    });
    const t = new QuickTunnel({
      targetUrl: 'http://127.0.0.1:1',
      timeoutMs: 4000,
      _spawn: spawnFactory(proc),
    });
    const h = await t.start();
    expect(h.url).toBe('https://nolf-xyz.trycloudflare.com');
  });

  test('start() rejects with timeout message when URL never appears', async () => {
    const { QuickTunnel } = require('../../lib/refinement-review/tunnel');
    const proc = fakeProc({
      chunks: [],
      exitAfter: 10000, // way past timeout
    });
    const t = new QuickTunnel({
      targetUrl: 'http://127.0.0.1:1',
      timeoutMs: 80,
      _spawn: spawnFactory(proc),
    });
    await expect(t.start()).rejects.toThrow(/within 80ms/);
  });

  test('start() rejects when process exits before URL', async () => {
    const { QuickTunnel } = require('../../lib/refinement-review/tunnel');
    const proc = fakeProc({
      chunks: [{ stream: 'stdout', value: 'no tunnel here\n', delay: 5 }],
      exitAfter: 20,
      exitCode: 0,
    });
    const t = new QuickTunnel({
      targetUrl: 'http://127.0.0.1:1',
      timeoutMs: 4000,
      _spawn: spawnFactory(proc),
    });
    await expect(t.start()).rejects.toThrow(/exited before publishing URL/);
  });

  test('stop() resolves immediately when the process has already exited', async () => {
    const { QuickTunnel } = require('../../lib/refinement-review/tunnel');
    const proc = fakeProc({
      chunks: [{ stream: 'stdout', value: 'https://quick-exit.trycloudflare.com\n', delay: 5 }],
      exitAfter: 20,
    });
    const t = new QuickTunnel({
      targetUrl: 'http://127.0.0.1:1',
      timeoutMs: 4000,
      _spawn: spawnFactory(proc),
    });
    const h = await t.start();
    expect(h.url).toBe('https://quick-exit.trycloudflare.com');
    // Wait for the fake proc to exit (timer fires at 20ms).
    await new Promise((resolve) => proc.once('exit', resolve));
    // Mark the proc as exited in the fake (the real timer above emits
    // 'exit' AND sets exitCode; in this fake we set exitCode). Stop()
    // should see exitCode !== null and resolve without registering a
    // listener that would never fire.
    const timer = setTimeout(() => {
      throw new Error('stop() did not resolve after process exited');
    }, 200);
    try {
      await t.stop();
    } finally {
      clearTimeout(timer);
    }
    expect(t.proc).toBeNull();
    expect(t.url).toBeNull();
    expect(t.host).toBeNull();
  });

  test('stop() is idempotent (resolves when called with no proc)', async () => {
    const { QuickTunnel } = require('../../lib/refinement-review/tunnel');
    const t = new QuickTunnel({ targetUrl: 'http://127.0.0.1:1' });
    await t.stop();
    await t.stop();
  });

  test('start() rejects when spawn synchronously throws', async () => {
    const { QuickTunnel } = require('../../lib/refinement-review/tunnel');
    const t = new QuickTunnel({
      targetUrl: 'http://127.0.0.1:1',
      _spawn: () => {
        throw new Error('ENOENT');
      },
    });
    await expect(t.start()).rejects.toThrow(/failed to spawn cloudflared/);
  });

  test('start() rejects with install hint when spawn throws synchronously with ENOENT', async () => {
    const { QuickTunnel } = require('../../lib/refinement-review/tunnel');
    const bin = withPinnedBinary();
    const t = new QuickTunnel({
      targetUrl: 'http://127.0.0.1:1',
      cloudflaredPath: bin,
      _spawn: () => {
        const err = new Error('spawn missing');
        err.code = 'ENOENT';
        throw err;
      },
    });
    await expect(t.start()).rejects.toThrow(/brew install cloudflared/);
    await expect(t.start()).rejects.toThrow(attemptedRe(bin));
  });

  test('start() can retry after async ENOENT failure (clears stale proc state)', async () => {
    const { QuickTunnel } = require('../../lib/refinement-review/tunnel');
    const proc1 = new EventEmitter();
    proc1.stdout = new EventEmitter();
    proc1.stderr = new EventEmitter();
    proc1.exitCode = null;
    proc1.signalCode = null;
    proc1.kill = () => {};
    const proc2 = new EventEmitter();
    proc2.stdout = new EventEmitter();
    proc2.stderr = new EventEmitter();
    proc2.exitCode = null;
    proc2.signalCode = null;
    proc2.kill = () => {};
    const spawned = [];
    const t = new QuickTunnel({
      targetUrl: 'http://127.0.0.1:1',
      _spawn: () => {
        const next = spawned.length === 0 ? proc1 : proc2;
        spawned.push(next);
        return next;
      },
    });
    // First start() — async ENOENT, must reject.
    const p1 = t.start();
    const err = new Error('spawn cloudflared ENOENT');
    err.code = 'ENOENT';
    proc1.emit('error', err);
    await expect(p1).rejects.toThrow(/brew install cloudflared/);
    // Second start() — must actually spawn again. If start() failed to clear
    // this.proc on rejection, the early-return at the top of start() would
    // silently resolve with the dead proc1's _handle() instead of spawning.
    const p2 = t.start();
    proc2.stdout.emit('data', 'https://abc.trycloudflare.com\n');
    await expect(p2).resolves.toMatchObject({ host: 'abc.trycloudflare.com' });
    expect(spawned).toEqual([proc1, proc2]);
  });

  test('start() can retry after async non-ENOENT spawn error (e.g. EACCES)', async () => {
    const { QuickTunnel } = require('../../lib/refinement-review/tunnel');
    const proc1 = new EventEmitter();
    proc1.stdout = new EventEmitter();
    proc1.stderr = new EventEmitter();
    proc1.exitCode = null;
    proc1.signalCode = null;
    proc1.kill = () => {};
    const proc2 = new EventEmitter();
    proc2.stdout = new EventEmitter();
    proc2.stderr = new EventEmitter();
    proc2.exitCode = null;
    proc2.signalCode = null;
    proc2.kill = () => {};
    const spawned = [];
    const t = new QuickTunnel({
      targetUrl: 'http://127.0.0.1:1',
      _spawn: () => {
        const next = spawned.length === 0 ? proc1 : proc2;
        spawned.push(next);
        return next;
      },
    });
    const p1 = t.start();
    const err = new Error('permission denied');
    err.code = 'EACCES';
    proc1.emit('error', err);
    await expect(p1).rejects.toThrow(/cloudflared spawn error/);
    const p2 = t.start();
    proc2.stdout.emit('data', 'https://xyz.trycloudflare.com\n');
    await expect(p2).resolves.toMatchObject({ host: 'xyz.trycloudflare.com' });
    expect(spawned).toEqual([proc1, proc2]);
  });


  test('start() rejects with install hint when child emits async ENOENT (primary missing-binary path)', async () => {
    const { QuickTunnel } = require('../../lib/refinement-review/tunnel');
    const proc = new EventEmitter();
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.exitCode = null;
    proc.signalCode = null;
    proc.kill = () => {};
    const bin = withPinnedBinary();
    const t = new QuickTunnel({
      targetUrl: 'http://127.0.0.1:1',
      cloudflaredPath: bin,
      _spawn: () => proc,
    });
    const promise = t.start();
    // spawn(2) reports missing executables asynchronously via the child
    // 'error' event on POSIX. Mirror that by emitting it from the fake proc.
    const err = new Error('spawn cloudflared ENOENT');
    err.code = 'ENOENT';
    proc.emit('error', err);
    await expect(promise).rejects.toThrow(/brew install cloudflared/);
    // Canonical Cloudflare downloads page — lists packages and binaries
    // by architecture so the user picks the match for their distro/arch
    // (avoids pinning to linux-amd64, which is wrong on ARM64).
    await expect(promise).rejects.toThrow(
      /developers\.cloudflare\.com\/cloudflare-one\/connections\/connect-networks\/downloads/,
    );
    await expect(promise).rejects.toThrow(/CLOUDFLARED_PATH/);
    await expect(promise).rejects.toThrow(attemptedRe(bin));
  });

  test('start() rejects with raw error when child emits non-ENOENT async error (e.g. EACCES)', async () => {
    const { QuickTunnel } = require('../../lib/refinement-review/tunnel');
    const proc = new EventEmitter();
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.exitCode = null;
    proc.signalCode = null;
    proc.kill = () => {};
    const t = new QuickTunnel({
      targetUrl: 'http://127.0.0.1:1',
      _spawn: () => proc,
    });
    const promise = t.start();
    const err = new Error('permission denied');
    err.code = 'EACCES';
    proc.emit('error', err);
    // Pass-through: install hint must NOT appear for non-ENOENT errors.
    await expect(promise).rejects.toThrow(/cloudflared spawn error/);
    await expect(promise).rejects.not.toThrow(/brew install/);
  });
});
