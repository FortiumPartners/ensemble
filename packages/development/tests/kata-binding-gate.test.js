'use strict';

/**
 * TRD-004 (TRD-2026-6995dc96; PRD REQ-018 AC-018-1, AC-018-3): preflight binding gate and
 * capability report gate, against a fake `kata` on PATH (no daemon is ever started).
 * Scratch under ~/.omp/br-do022/, never the system temp directory.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { runPreflight, hasPassingPreflightRecord, preflightReportedCapability, preflightGatesCapability } = require('../lib/toolchain/preflight');
const cli = require('../lib/toolchain-cli');

const SCRATCH_ROOT = path.join(os.homedir(), '.omp', 'br-do022', 'scratch');
const savedPath = process.env.PATH;
const dirs = [];

function mk(label) {
  fs.mkdirSync(SCRATCH_ROOT, { recursive: true });
  const d = fs.mkdtempSync(path.join(SCRATCH_ROOT, `${label}-`));
  dirs.push(d);
  return d;
}

const DOCTOR_UNBOUND = {
  checks: [
    { id: 'daemon.connection', status: 'ok' },
    { id: 'config.workspace', status: 'warn', summary: 'No project binding or explicit project; project lookup will be skipped' }
  ]
};
const DOCTOR_BOUND = {
  checks: [
    { id: 'daemon.connection', status: 'ok' },
    { id: 'config.workspace', status: 'ok', summary: 'Workspace bound' }
  ]
};

/** Fake kata: `doctor --json` answers by whether `.kata.toml` is in cwd; any other verb is a "write" and is logged. */
function stubKata({ doctorOutput } = {}) {
  const dir = mk('stub');
  const log = path.join(dir, 'calls.log');
  fs.writeFileSync(path.join(dir, 'unbound.json'), JSON.stringify(DOCTOR_UNBOUND));
  fs.writeFileSync(path.join(dir, 'bound.json'), JSON.stringify(DOCTOR_BOUND));
  if (doctorOutput !== undefined) fs.writeFileSync(path.join(dir, 'custom.json'), doctorOutput);
  fs.writeFileSync(
    path.join(dir, 'kata'),
    [
      '#!/bin/sh',
      `echo "$*" >> "${log}"`,
      'if [ "$1" = "--version" ]; then echo "kata v0.23.0"; exit 0; fi',
      'if [ "$1" = "doctor" ]; then',
      doctorOutput !== undefined
        ? `  cat "${path.join(dir, 'custom.json')}"; exit 0`
        : `  if [ -f .kata.toml ]; then cat "${path.join(dir, 'bound.json')}"; else cat "${path.join(dir, 'unbound.json')}"; fi; exit 0`,
      'fi',
      'echo \'{"issue":{"short_id":"k-1"}}\'',
      ''
    ].join('\n'),
    { mode: 0o755 }
  );
  process.env.PATH = `${dir}${path.delimiter}${savedPath}`;
  return () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : []);
}

function project({ bound }) {
  const projectRoot = mk('proj');
  fs.mkdirSync(path.join(projectRoot, '.ensemble'), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, '.ensemble', 'toolchain.yaml'), 'tracker: kata\n');
  if (bound) fs.writeFileSync(path.join(projectRoot, '.kata.toml'), 'project = "scratch"\n');
  return { projectRoot, ctx: { projectRoot, env: { XDG_CONFIG_HOME: path.join(projectRoot, 'xdg'), ENSEMBLE_NON_INTERACTIVE: '1' } } };
}

const recordPath = (root, id) => path.join(root, '.ensemble', 'state', 'toolchain', `preflight-${id}.json`);
const isWrite = (line) => !/^(--version|doctor)\b/.test(line);

afterEach(() => {
  process.env.PATH = savedPath;
});
afterAll(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

describe('binding gate (TRD-004, AC-018-1)', () => {
  test('Edge: unbound workspace stops in preflight with the binding prerequisite, no record, no write', async () => {
    const calls = stubKata();
    const { projectRoot, ctx } = project({ bound: false });
    const result = await runPreflight({ categories: ['tracker'], runId: 'unbound', requires: ['tracker.create'] }, ctx);
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('HEALTH_FAILED');
    expect(result.error.message).toContain('kata init');
    expect(result.error.message).toContain('.kata.toml');
    expect(result.error.message).toContain('not bound');
    expect(fs.existsSync(recordPath(projectRoot, 'unbound'))).toBe(false);
    expect(calls().filter(isWrite)).toEqual([]);
    expect(calls()).toContain('doctor --json');
    expect(calls().some((c) => /daemon/.test(c))).toBe(false);
  });

  test('Edge: unparsable doctor output fails closed as a binding failure', async () => {
    stubKata({ doctorOutput: 'not json at all' });
    const { projectRoot, ctx } = project({ bound: true });
    const result = await runPreflight({ categories: ['tracker'], runId: 'garbled', requires: [] }, ctx);
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('HEALTH_FAILED');
    expect(fs.existsSync(recordPath(projectRoot, 'garbled'))).toBe(false);
  });

  test('Edge: config.workspace status `info` is not a bound workspace (allow is `ok` only)', async () => {
    stubKata({ doctorOutput: JSON.stringify({ checks: [{ id: 'config.workspace', status: 'info' }] }) });
    const { projectRoot, ctx } = project({ bound: true });
    const result = await runPreflight({ categories: ['tracker'], runId: 'info', requires: [] }, ctx);
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('HEALTH_FAILED');
    expect(fs.existsSync(recordPath(projectRoot, 'info'))).toBe(false);
  });

  test('Edge: doctor output without a workspace check fails closed', async () => {
    stubKata({ doctorOutput: '{"checks":[]}' });
    const { ctx } = project({ bound: true });
    const result = await runPreflight({ categories: ['tracker'], runId: 'nocheck', requires: [] }, ctx);
    expect(result.ok).toBe(false);
    expect(result.error.message).toContain('kata init');
  });

  test('Happy: bound workspace passes and the record lists the reported capabilities', async () => {
    const calls = stubKata();
    const { projectRoot, ctx } = project({ bound: true });
    const requires = ['tracker.create', 'tracker.close-with-reason'];
    const result = await runPreflight({ categories: ['tracker'], runId: 'bound', requires }, ctx);
    expect(result.ok).toBe(true);
    expect(result.capabilities).toEqual(requires);
    const rec = JSON.parse(fs.readFileSync(recordPath(projectRoot, 'bound'), 'utf8'));
    expect(rec.capabilities).toEqual(requires);
    expect(calls().filter(isWrite)).toEqual([]);
  });
});

describe('capability report gate (TRD-004, AC-018-3)', () => {
  test('preflightReportedCapability: true only for capabilities the record lists; fail closed otherwise', async () => {
    stubKata();
    const { projectRoot, ctx } = project({ bound: true });
    await runPreflight({ categories: ['tracker'], runId: 'rep', requires: ['tracker.create'] }, ctx);
    expect(hasPassingPreflightRecord('rep', { projectRoot })).toBe(true);
    expect(preflightReportedCapability('rep', 'tracker.create', { projectRoot })).toBe(true);
    expect(preflightReportedCapability('rep', 'tracker.close-with-reason', { projectRoot })).toBe(false);
    expect(preflightReportedCapability('missing', 'tracker.create', { projectRoot })).toBe(false);
    expect(preflightReportedCapability('../x', 'tracker.create', { projectRoot })).toBe(false);
    // A record with no capabilities list (legacy / hand-written) reports nothing.
    fs.writeFileSync(recordPath(projectRoot, 'legacy'), JSON.stringify({ ok: true, runId: 'legacy' }));
    expect(preflightReportedCapability('legacy', 'tracker.create', { projectRoot })).toBe(false);
  });

  test('Edge: run refuses a side-effecting capability preflight did not report, before any kata write', async () => {
    const calls = stubKata();
    const { projectRoot, ctx } = project({ bound: true });
    const pre = await cli.preflight(ctx, [], { requires: ['tracker.create'], runId: 'gate', nonInteractive: true });
    expect(pre.ok).toBe(true);
    const refused = await cli.run(ctx, ['tracker.close-with-reason'], {
      runId: 'gate',
      nonInteractive: true,
      args: { id: 'x', reason: 'r', commit: 'c' }
    });
    expect(refused.ok).toBe(false);
    expect(refused.error.code).toBe('CAPABILITY_NOT_REPORTED');
    expect(refused.error.message).toContain('tracker.close-with-reason');
    expect(calls().filter(isWrite)).toEqual([]);
    expect(fs.existsSync(recordPath(projectRoot, 'gate'))).toBe(true);
  });

  test('Happy: a reported side-effecting capability is not refused by the report gate', async () => {
    stubKata();
    const { ctx } = project({ bound: true });
    await cli.preflight(ctx, [], { requires: ['tracker.create'], runId: 'ok', nonInteractive: true });
    const result = await cli.run(ctx, ['tracker.create'], { runId: 'ok', nonInteractive: true, args: { title: 't', description: 'd' } });
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    expect(result.ok).toBe(true);
  });

  test('Regression: an ungated (beads-style) adapter may run an unreported side-effecting capability', async () => {
    // Stub `br`/`bv` (beads' health probes and its create capability); beads declares no jsonAssert.
    const dir = mk('beadsstub');
    fs.writeFileSync(path.join(dir, 'br'), '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "br 0.6.0"; exit 0; fi\necho \'{"id":"bd-1"}\'\n', { mode: 0o755 });
    fs.writeFileSync(path.join(dir, 'bv'), '#!/bin/sh\necho "bv 0.1.0"\n', { mode: 0o755 });
    process.env.PATH = `${dir}${path.delimiter}${savedPath}`;
    const { projectRoot, ctx } = project({ bound: false });
    fs.writeFileSync(path.join(projectRoot, '.ensemble', 'toolchain.yaml'), 'tracker: beads\n');
    const pre = await runPreflight({ categories: ['tracker'], runId: 'bd', requires: [] }, ctx);
    expect(pre.ok).toBe(true);
    const rec = JSON.parse(fs.readFileSync(recordPath(projectRoot, 'bd'), 'utf8'));
    expect(rec.capabilityGate).toBeUndefined();
    expect(rec.gatedCategories).toBeUndefined();
    expect(preflightGatesCapability('bd', 'tracker.create', { projectRoot })).toBe(false);
    const result = await cli.run(ctx, ['tracker.create'], {
      runId: 'bd',
      nonInteractive: true,
      args: { title: 't', type: 'task', description: 'd' }
    });
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    expect(result.ok).toBe(true);
  });
});
