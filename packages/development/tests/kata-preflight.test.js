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

const { runPreflight, hasPassingPreflightRecord, preflightReportedCapability } = require('../lib/toolchain/preflight');
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

/**
 * TRD-004-TEST (TRD-2026-6995dc96; PRD REQ-018 AC-018-1, AC-018-3): the binding gate creates zero
 * items when unbound. Stateful stub `kata`: `doctor --json` reports bound iff `.kata.toml` is in
 * cwd (otherwise the doctor output the case supplies); `create` appends one line to an items file
 * (the item count); every invocation is logged. Scratch under ~/.omp/br-1xi7y/scratch, never the
 * system temp directory.
 */
describe('kata binding gate (stub kata): zero items when unbound (TRD-004-TEST)', () => {
  const cli = require('../lib/toolchain-cli');
  const yaml = require('js-yaml');
  const GATE_ROOT = path.join(os.homedir(), '.omp', 'br-1xi7y', 'scratch');
  const gateDirs = [];
  const gateSavedPath = process.env.PATH;

  // The real TRD flow's required capability list, parsed from the command source of truth.
  const TRD_REQUIRED = yaml.load(
    fs.readFileSync(path.join(__dirname, '..', 'commands', 'implement-trd-tasks.yaml'), 'utf8')
  ).metadata.capabilities.required;
  // Preflight is driven with the full required list: non-tracker capabilities resolve to their own
  // adapters (health checks run for real); the kata stub is only consulted for tracker.*.

  function gmk(label) {
    fs.mkdirSync(GATE_ROOT, { recursive: true });
    const d = fs.mkdtempSync(path.join(GATE_ROOT, `${label}-`));
    gateDirs.push(d);
    return d;
  }

  const BOUND = '{"checks":[{"id":"daemon.connection","status":"ok"},{"id":"config.workspace","status":"ok"}]}';

  /** Installs the stateful stub on PATH. `unboundDoctor` is what doctor prints without .kata.toml. */
  function statefulKata(unboundDoctor) {
    const dir = gmk('stub');
    const items = path.join(dir, 'items.txt');
    const log = path.join(dir, 'calls.log');
    fs.writeFileSync(items, '');
    fs.writeFileSync(log, '');
    fs.writeFileSync(path.join(dir, 'bound.json'), BOUND);
    fs.writeFileSync(path.join(dir, 'unbound.json'), unboundDoctor || BOUND);
    fs.writeFileSync(
      path.join(dir, 'kata'),
      [
        '#!/bin/sh',
        `echo "$*" >> "${log}"`,
        'if [ "$1" = "--version" ]; then echo "kata v0.23.0"; exit 0; fi',
        'if [ "$1" = "doctor" ]; then',
        `  if [ -f .kata.toml ]; then cat "${path.join(dir, 'bound.json')}"; else cat "${path.join(dir, 'unbound.json')}"; fi; exit 0`,
        'fi',
        'if [ "$1" = "create" ]; then',
        `  echo "item" >> "${items}"`,
        '  echo \'{"issue":{"short_id":"k-1"}}\'; exit 0',
        'fi',
        'if [ "$1" = "list" ]; then echo \'{"issues":[{"short_id":"k-1","title":"t","status":"open"}],"total":1,"complete":true,"truncated":false}\'; exit 0; fi',
        'echo \'{}\'',
        ''
      ].join('\n'),
      { mode: 0o755 }
    );
    process.env.PATH = `${dir}${path.delimiter}${gateSavedPath}`;
    return {
      count: () => fs.readFileSync(items, 'utf8').split('\n').filter(Boolean).length,
      calls: () => fs.readFileSync(log, 'utf8').split('\n').filter(Boolean)
    };
  }

  function gateProject({ bound }) {
    const projectRoot = gmk('proj');
    fs.mkdirSync(path.join(projectRoot, '.ensemble'), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, '.ensemble', 'toolchain.yaml'), 'tracker: kata\n');
    if (bound) fs.writeFileSync(path.join(projectRoot, '.kata.toml'), 'project = "scratch"\n');
    return {
      projectRoot,
      ctx: { projectRoot, env: { XDG_CONFIG_HOME: path.join(projectRoot, 'xdg'), ENSEMBLE_NON_INTERACTIVE: '1' } }
    };
  }

  const CREATE_ARGS = { title: 't', description: 'd' };

  /** The TRD flow: preflight, then (only if it passed) create. */
  async function trdFlow(ctx, runId, requires) {
    const pre = await cli.preflight(ctx, [], { requires, runId, nonInteractive: true });
    if (!pre.ok) return { pre, created: null };
    const created = await cli.run(ctx, ['tracker.create'], { runId, nonInteractive: true, args: CREATE_ARGS });
    return { pre, created };
  }

  afterEach(() => {
    process.env.PATH = gateSavedPath;
  });
  afterAll(() => {
    for (const d of gateDirs) fs.rmSync(d, { recursive: true, force: true });
  });

  test('Happy (stub kata): bound workspace passes preflight for every TRD required capability, reports each, and creates exactly one item', async () => {
    expect(TRD_REQUIRED).toHaveLength(8);
    const kata = statefulKata();
    const { projectRoot, ctx } = gateProject({ bound: true });
    const before = kata.count();
    const { pre, created } = await trdFlow(ctx, 'happy', TRD_REQUIRED);
    expect(pre.ok).toBe(true);
    for (const cap of TRD_REQUIRED) {
      expect(preflightReportedCapability('happy', cap, { projectRoot })).toBe(true);
    }
    if (!created.ok) throw new Error(JSON.stringify(created.error));
    expect(kata.count()).toBe(before + 1);
    // The remaining tracker capabilities the flow needs run through the same gated runner.
    for (const [cap, args] of [
      ['tracker.list', {}],
      ['tracker.comment', { id: 'k-1', text: 'note' }]
    ]) {
      const r = await cli.run(ctx, [cap], { runId: 'happy', nonInteractive: true, args });
      if (!r.ok) throw new Error(`${cap}: ${JSON.stringify(r.error)}`);
    }
    const calls = kata.calls();
    expect(calls.some((c) => c.startsWith('list '))).toBe(true);
    expect(calls.some((c) => c.startsWith('comment k-1'))).toBe(true);
    // TRD-011: a bare close is refused INVALID_ARG (naming tracker.close-with-reason), never a silent close.
    // The flow requires bare tracker.close (br-t15uf decision, f0ba84c3); tracker.close-with-reason is
    // optional with a NOT_ALLOWED fallback. The bare refusal is checked under its own preflight run.
    expect(TRD_REQUIRED).toContain('tracker.close');
    expect(TRD_REQUIRED).not.toContain('tracker.close-with-reason');
    const barePre = await cli.preflight(ctx, [], { requires: ['tracker.close'], runId: 'happy-bare', nonInteractive: true });
    expect(barePre.ok).toBe(true);
    const bare = await cli.run(ctx, ['tracker.close'], { runId: 'happy-bare', nonInteractive: true, args: { id: 'k-1' } });
    expect(bare.ok).toBe(false);
    expect(bare.error.code).toBe('INVALID_ARG');
    expect(bare.error.message).toContain('tracker.close-with-reason');
    expect(kata.calls().some((c) => c.startsWith('close k-1'))).toBe(false);
    expect(kata.count()).toBe(before + 1);
  });

  const UNBOUND_DOCTORS = {
    'config.workspace status warn':
      '{"checks":[{"id":"daemon.connection","status":"ok"},{"id":"config.workspace","status":"warn"}]}',
    'config.workspace status fail':
      '{"checks":[{"id":"daemon.connection","status":"ok"},{"id":"config.workspace","status":"fail"}]}',
    'config.workspace check missing': '{"checks":[{"id":"daemon.connection","status":"ok"}]}'
  };

  test.each(Object.entries(UNBOUND_DOCTORS))(
    'Edge (stub kata): unbound workspace (%s) stops during preflight; no kata write runs and the item count is unchanged',
    async (_label, doctorOut) => {
      const kata = statefulKata(doctorOut);
      const { projectRoot, ctx } = gateProject({ bound: false });
      const before = kata.count();
      const { pre, created } = await trdFlow(ctx, 'unbound', TRD_REQUIRED);
      expect(pre.ok).toBe(false);
      expect(pre.error.code).toBe('HEALTH_FAILED');
      expect(pre.error.message).toContain('kata init');
      expect(created).toBeNull();
      expect(kata.count()).toBe(before);
      expect(hasPassingPreflightRecord('unbound', { projectRoot })).toBe(false);
      // Even a caller that ignores the failed preflight and calls run directly creates nothing.
      const direct = await cli.run(ctx, ['tracker.create'], { runId: 'unbound', nonInteractive: true, args: CREATE_ARGS });
      expect(direct.ok).toBe(false);
      expect(direct.error.code).toBe('PREFLIGHT_REQUIRED');
      expect(kata.count()).toBe(before);
      const calls = kata.calls();
      expect(calls.length).toBeGreaterThan(0);
      expect(calls.every((c) => c === '--version' || c.startsWith('doctor'))).toBe(true);
    }
  );

  test('Edge (stub kata): a write capability preflight did not report is refused before any kata write runs', async () => {
    const kata = statefulKata();
    const { projectRoot, ctx } = gateProject({ bound: true });
    const requires = TRD_REQUIRED.filter((c) => c !== 'tracker.create');
    const pre = await cli.preflight(ctx, [], { requires, runId: 'unreported', nonInteractive: true });
    expect(pre.ok).toBe(true);
    // Preflight reports every capability the kata manifest declares, so drop tracker.create from the
    // written record to model a record that did not list it.
    const recordFile = path.join(projectRoot, '.ensemble', 'state', 'toolchain', 'preflight-unreported.json');
    const record = JSON.parse(fs.readFileSync(recordFile, 'utf8'));
    record.capabilities = record.capabilities.filter((c) => c !== 'tracker.create');
    fs.writeFileSync(recordFile, JSON.stringify(record));
    const before = kata.count();
    const refused = await cli.run(ctx, ['tracker.create'], { runId: 'unreported', nonInteractive: true, args: CREATE_ARGS });
    expect(refused.ok).toBe(false);
    expect(refused.error.code).toBe('CAPABILITY_NOT_REPORTED');
    expect(refused.error.message).toContain('tracker.create');
    expect(kata.count()).toBe(before);
    expect(kata.calls().some((c) => c.startsWith('create'))).toBe(false);
  });
});

/**
 * TRD-006-TEST (TRD-2026-6995dc96; PRD REQ-001 AC-001-3, REQ-012 AC-012-2/3): missing-binary
 * diagnosis for kata, silence for non-kata projects. PATH holds scratch stub dirs only. Fuller
 * coverage lives in kata-missing-binary-preflight.test.js.
 */
describe('kata missing-binary diagnosis (TRD-006-TEST)', () => {
  function stubBin(name, body) {
    const dir = mk(`bin-${name}`);
    const log = path.join(dir, 'calls.log');
    fs.writeFileSync(path.join(dir, name), ['#!/bin/sh', `echo "$*" >> "${log}"`, body, ''].join('\n'), { mode: 0o755 });
    return { dir, calls: () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : []) };
  }
  const kataBody = [
    'if [ "$1" = "--version" ]; then echo "kata v0.23.0"; exit 0; fi',
    'echo \'{"checks":[{"id":"config.workspace","status":"ok"}]}\''
  ].join('\n');
  const recordFile = (root, id) => path.join(root, '.ensemble', 'state', 'toolchain', `preflight-${id}.json`);

  test('Happy: kata absent and a beads project reports no kata-related failure', async () => {
    const br = stubBin('br', 'echo "br 0.1.0"');
    const bv = stubBin('bv', 'echo "bv v0.26.0"');
    process.env.PATH = `${br.dir}${path.delimiter}${bv.dir}`;
    const projectRoot = mk('beads-proj');
    fs.mkdirSync(path.join(projectRoot, '.ensemble'), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, '.ensemble', 'toolchain.yaml'), 'tracker: beads\n');
    const result = await runPreflight(
      { categories: ['tracker'], runId: 'beads' },
      { projectRoot, env: { XDG_CONFIG_HOME: path.join(projectRoot, 'xdg') } }
    );
    expect(result.ok).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/kata/i);
    const record = recordFile(projectRoot, 'beads');
    expect(fs.existsSync(record)).toBe(true);
    expect(fs.readFileSync(record, 'utf8')).not.toMatch(/kata/i);
  });

  test('Edge: kata absent and a kata project fails naming the kata adapter and the missing binary', async () => {
    process.env.PATH = mk('empty');
    const { projectRoot, ctx } = project();
    const result = await runPreflight({ categories: ['tracker'], runId: 'absent' }, ctx);
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('MISSING_BINARY');
    expect(result.error.message).toMatch(/kata/);
    expect(result.error.message).toMatch(/PATH/);
    expect(fs.existsSync(recordFile(projectRoot, 'absent'))).toBe(false);
  });

  test('Edge: binary present at selection then removed fails with MISSING_BINARY and creates no beads item', async () => {
    const kata = stubBin('kata', kataBody);
    const br = stubBin('br', 'echo "br 0.1.0"');
    process.env.PATH = `${kata.dir}${path.delimiter}${br.dir}`;
    const { projectRoot, ctx } = project();
    expect((await runPreflight({ categories: ['tracker'], runId: 'pre' }, ctx)).ok).toBe(true);

    fs.rmSync(path.join(kata.dir, 'kata'));
    const result = await runPreflight({ categories: ['tracker'], runId: 'post' }, ctx);
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('MISSING_BINARY');
    expect(result.error.message).toContain('kata');
    expect(result.error.message).not.toMatch(/beads|\bbr\b/i);
    expect(fs.existsSync(recordFile(projectRoot, 'post'))).toBe(false);
    expect(br.calls()).toEqual([]);
  });
});
