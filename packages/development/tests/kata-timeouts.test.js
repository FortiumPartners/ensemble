'use strict';

/**
 * TRD-028-TEST -- a hung read and a hung write each time out with class and bound named
 * (TRD-2026-6995dc96 TRD-028, PRD REQ-017 / AC-017-1).
 *
 * Every test drives the SHIPPED kata and beads manifests through `runCapability` against a stub
 * `kata` binary on PATH (no daemon, no real kata). The stub hangs or answers depending on
 * STUB_MODE, so a mistyped default bound, a dropped `timeoutClass`, or a TIMEOUT message that
 * stops naming class or bound turns one of these red.
 *
 * `KATA_TIMEOUTS_MANIFEST` points the suite at a mutated COPY of the kata manifest (TDD RED
 * evidence); the shipped file is never modified.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const yaml = require('js-yaml');

const { runCapability, resolveCapabilityTimeout } = require('../lib/toolchain/runner');
const { resolveProjectTimeouts } = require('../lib/toolchain/config');

const ADAPTERS = path.join(__dirname, '..', 'skills');
const KATA = yaml.load(
  fs.readFileSync(process.env.KATA_TIMEOUTS_MANIFEST || path.join(ADAPTERS, 'adapter-tracker-kata', 'adapter.yaml'), 'utf8')
);
const BEADS = yaml.load(fs.readFileSync(process.env.KATA_TIMEOUTS_BEADS_MANIFEST || path.join(ADAPTERS, 'adapter-tracker-beads', 'adapter.yaml'), 'utf8'));

const scratch = path.join(os.homedir(), '.omp', 'br-i5ris', 'jest');
let root;
let stubDir;

beforeAll(() => {
  fs.mkdirSync(scratch, { recursive: true });
  root = fs.mkdtempSync(path.join(scratch, 'kt-'));
  stubDir = path.join(root, 'bin');
  fs.mkdirSync(stubDir);
  const stub = path.join(stubDir, 'kata');
  fs.writeFileSync(
    stub,
    [
      '#!/usr/bin/env node',
      "if (process.env.STUB_MODE === 'hang') {",
      "  require('fs').appendFileSync(require('path').join(__dirname, '..', 'pids'), process.pid + '\\n');",
      '  setInterval(() => {}, 1000);',
      '}',
      "else { process.stdout.write(JSON.stringify({ complete: true, truncated: false, total: 0, issues: [] })); }",
      ''
    ].join('\n')
  );
  fs.chmodSync(stub, 0o755);
});

afterAll(() => {
  // Belt and braces: no hung stub may outlive the suite.
  try {
    for (const pid of fs.readFileSync(path.join(root, 'pids'), 'utf8').split('\n').filter(Boolean)) {
      try { process.kill(Number(pid), 'SIGKILL'); } catch (_) { /* already gone */ }
    }
  } catch (_) { /* no hang test ran */ }
  if (root) fs.rmSync(root, { recursive: true, force: true });
});

function opts(mode, extra = {}) {
  return {
    parentEnv: { PATH: `${stubDir}:${process.env.PATH}`, HOME: os.homedir(), STUB_MODE: mode },
    execFileOptions: { cwd: root },
    ...extra
  };
}

// The manifest allowlists STUB_MODE only if declared; keep the stub's switch out of the manifest by
// threading it through an env-allowlist clone (never mutating the shipped manifest object).
function withStubEnv(manifest, extraCaps = {}) {
  return { ...manifest, env: [...(manifest.env || []), 'STUB_MODE'], capabilities: { ...manifest.capabilities, ...extraCaps } };
}

describe('TRD-028-TEST timeouts through the kata manifest', () => {
  test('Happy: a kata listing that completes inside the short bound returns normally', async () => {
    const res = await runCapability(withStubEnv(KATA), 'tracker.list', {}, opts('ok'));
    expect(res.ok).toBe(true);
    expect(res.error).toBeUndefined();
  }, 20000);

  test('Edge: a never-exiting short-class read times out naming capability, class short and the bound, without blocking', async () => {
    const started = Date.now();
    const res = await runCapability(withStubEnv(KATA), 'tracker.list', {}, opts('hang', { timeouts: { short: 300 } }));
    expect(Date.now() - started).toBeLessThan(10000);
    expect(res.ok).toBe(false);
    expect(res.error.code).toBe('TIMEOUT');
    expect(res.error.message).toContain("capability 'tracker.list'");
    expect(res.error.message).toContain("(timeout class 'short')");
    expect(res.error.message).toContain('timeout of 300ms');
  }, 20000);

  test('Edge: the shipped short class bound is what a hung read reports when the project sets none', async () => {
    // Prove the default end-to-end without waiting 60s: the class and bound reported are the
    // resolved ones, checked via the resolver the runner calls for the TIMEOUT message.
    expect(resolveCapabilityTimeout(KATA, KATA.capabilities['tracker.list'], {})).toEqual({
      timeoutClass: 'short',
      boundMs: 60000
    });
  });

  test('Edge: a project overriding the long bound is named when a stub write hangs', async () => {
    const root2 = fs.mkdtempSync(path.join(scratch, 'proj-'));
    try {
      fs.mkdirSync(path.join(root2, '.ensemble'));
      fs.writeFileSync(path.join(root2, '.ensemble', 'toolchain.yaml'), 'timeouts:\n  long: 350\n');
      const timeouts = resolveProjectTimeouts({ projectRoot: root2 });
      expect(timeouts).toEqual({ long: 350 });
      expect(KATA.capabilities['tracker.create'].timeoutClass).toBe('long');
      // tracker.create's argv is kata create ...; the stub hangs on any argv.
      const res = await runCapability(withStubEnv(KATA), 'tracker.create', { title: 't', description: 'd' }, opts('hang', { timeouts }));
      expect(res.ok).toBe(false);
      expect(res.error.code).toBe('TIMEOUT');
      expect(res.error.message).toContain("capability 'tracker.create'");
      expect(res.error.message).toContain("(timeout class 'long')");
      expect(res.error.message).toContain('timeout of 350ms');
    } finally {
      fs.rmSync(root2, { recursive: true, force: true });
    }
  }, 20000);
});

describe('TRD-028-TEST hang containment and class assignment', () => {
  const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (_) { return false; } };

  test('the timed-out stub process is killed, not leaked', async () => {
    const pidFile = path.join(root, 'pids');
    fs.rmSync(pidFile, { force: true });
    const res = await runCapability(withStubEnv(KATA), 'tracker.list', {}, opts('hang', { timeouts: { short: 300 } }));
    expect(res.error.code).toBe('TIMEOUT');
    const pids = fs.readFileSync(pidFile, 'utf8').split('\n').filter(Boolean).map(Number);
    expect(pids.length).toBeGreaterThan(0);
    await new Promise((r) => setTimeout(r, 300));
    for (const pid of pids) expect(alive(pid)).toBe(false);
  }, 20000);

  test('a long override does not change the short-class bound, and vice versa', () => {
    expect(resolveCapabilityTimeout(KATA, KATA.capabilities['tracker.list'], { timeouts: { long: 350 } })).toEqual({ timeoutClass: 'short', boundMs: 60000 });
    expect(resolveCapabilityTimeout(KATA, KATA.capabilities['tracker.create'], { timeouts: { short: 300 } })).toEqual({ timeoutClass: 'long', boundMs: 120000 });
  });

  test('reads are class short and writes are class long in the kata manifest', () => {
    for (const n of ['tracker.list', 'tracker.show', 'tracker.comments']) expect(KATA.capabilities[n].timeoutClass).toBe('short');
    for (const n of ['tracker.create', 'tracker.update', 'tracker.close', 'tracker.comment']) expect(KATA.capabilities[n].timeoutClass).toBe('long');
  });
});

describe('TRD-028-TEST default bounds', () => {
  const classesOf = (manifest) =>
    Object.entries(manifest.capabilities)
      .filter(([, cap]) => cap.run)
      .map(([name, cap]) => ({ name, cap }));

  test('Happy: beads short and long bounds both resolve to exactly 60000 for every argv capability', () => {
    expect(BEADS.timeouts).toEqual({ short: 60000, long: 60000 });
    for (const { name, cap } of classesOf(BEADS)) {
      const { timeoutClass, boundMs } = resolveCapabilityTimeout(BEADS, cap, {});
      expect([name, ['short', 'long'].includes(cap.timeoutClass), timeoutClass === cap.timeoutClass, boundMs]).toEqual([
        name,
        true,
        true,
        60000
      ]);
    }
    expect(resolveCapabilityTimeout(BEADS, { timeoutClass: 'short' }, {}).boundMs).toBe(60000);
    expect(resolveCapabilityTimeout(BEADS, { timeoutClass: 'long' }, {}).boundMs).toBe(60000);
  });

  test('kata resolves short 60000 and long 120000', () => {
    expect(KATA.timeouts).toEqual({ short: 60000, long: 120000 });
    expect(resolveCapabilityTimeout(KATA, { timeoutClass: 'short' }, {}).boundMs).toBe(60000);
    expect(resolveCapabilityTimeout(KATA, { timeoutClass: 'long' }, {}).boundMs).toBe(120000);
  });
});
