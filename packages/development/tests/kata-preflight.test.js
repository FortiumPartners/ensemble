'use strict';

/**
 * TRD-003-TEST (TRD-2026-6995dc96; PRD REQ-018 AC-018-2, REQ-001 AC-001-2): version floor and
 * version reporting at preflight, with a stub `kata` on PATH. Deeper coverage (pre-releases,
 * numeric compare, contract-major) lives in toolchain-preflight-version-gate.test.js.
 * Scratch under ~/.omp/br-4jh85/, never the system temp directory.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { runPreflight } = require('../lib/toolchain/preflight');
const { kataAvailable } = require('./helpers/kata-guard');

const SCRATCH_ROOT = path.join(os.homedir(), '.omp', 'br-4jh85', 'scratch');
const savedPath = process.env.PATH;
const dirs = [];

function mk(label) {
  fs.mkdirSync(SCRATCH_ROOT, { recursive: true });
  const d = fs.mkdtempSync(path.join(SCRATCH_ROOT, `${label}-`));
  dirs.push(d);
  return d;
}

function stubKata(versionOutput) {
  const dir = mk('stub');
  const log = path.join(dir, 'calls.log');
  fs.writeFileSync(path.join(dir, 'version.txt'), versionOutput);
  fs.writeFileSync(
    path.join(dir, 'kata'),
    [
      '#!/bin/sh',
      `echo "$*" >> "${log}"`,
      'if [ "$1" = "--version" ]; then',
      `  cat "${path.join(dir, 'version.txt')}"`,
      '  exit 0',
      'fi',
      // doctor reports a bound workspace so the TRD-004 binding gate passes.
      'echo \'{"checks":[{"id":"config.workspace","status":"ok"}]}\'',
      ''
    ].join('\n'),
    { mode: 0o755 }
  );
  process.env.PATH = `${dir}${path.delimiter}${savedPath}`;
  return () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : []);
}

function project() {
  const projectRoot = mk('proj');
  fs.mkdirSync(path.join(projectRoot, '.ensemble'), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, '.ensemble', 'toolchain.yaml'), 'tracker: kata\n');
  return { projectRoot, ctx: { projectRoot, env: { XDG_CONFIG_HOME: path.join(projectRoot, 'xdg') } } };
}

afterEach(() => {
  process.env.PATH = savedPath;
});
afterAll(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

describe('kata preflight version floor (TRD-003-TEST)', () => {
  test('Happy: kata 0.23.0 passes and the record names the reported version', async () => {
    stubKata('kata v0.23.0\n commit: abc\n');
    const { projectRoot, ctx } = project();
    const result = await runPreflight({ categories: ['tracker'], runId: 'happy' }, ctx);
    expect(result.ok).toBe(true);
    expect(result.versions).toEqual({ kata: '0.23.0' });
    const rec = JSON.parse(
      fs.readFileSync(path.join(projectRoot, '.ensemble', 'state', 'toolchain', 'preflight-happy.json'), 'utf8')
    );
    expect(rec.versions).toEqual({ kata: '0.23.0' });
  });

  test('Edge: kata 0.22.9 fails naming 0.23.0; the stub sees only the version probe', async () => {
    const calls = stubKata('kata v0.22.9\n');
    const { projectRoot, ctx } = project();
    const result = await runPreflight({ categories: ['tracker'], runId: 'edge' }, ctx);
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('HEALTH_FAILED');
    expect(fs.existsSync(path.join(projectRoot, '.ensemble', 'state', 'toolchain', 'preflight-edge.json'))).toBe(false);
    expect(result.error.message).toContain('0.23.0');
    const c = calls();
    expect(c.length).toBeGreaterThan(0);
    expect(c.every((x) => x === '--version')).toBe(true);
  });
});

describe('real kata (guarded)', () => {
  (kataAvailable() ? test : test.skip)('installed kata passes the version floor and is reported', async () => {
    const { ctx } = project();
    const result = await runPreflight({ categories: ['tracker'], runId: 'real' }, ctx);
    if (result.ok) expect(result.versions.kata).toMatch(/^\d+\.\d+\.\d+/);
    else expect(result.error.message).not.toMatch(/minimum/i);
  });
});
