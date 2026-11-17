'use strict';

/**
 * TRD-003 (TRD-2026-6995dc96; PRD REQ-018 AC-018-2, REQ-001 AC-001-2): the preflight
 * minimum-version gate, the version reported on pass, and the contract-major check at resolution.
 *
 * Hermetic: every run uses a `kata` stub script prepended to PATH (the runner builds the child
 * env from process.env, so PATH is the seam) that prints a canned `--version` and appends every
 * invocation to a log. Scratch lives under ~/.omp/br-7fx8c/, never the system temp directory.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const yaml = require('js-yaml');
const Ajv = require('ajv');

const { runPreflight } = require('../lib/toolchain/preflight');
const { loadAdapter } = require('../lib/toolchain/adapters');
const { resolveWorkGraphAdapter } = require('../lib/toolchain/work-graph-resolve');
const { kataAvailable } = require('./helpers/kata-guard');

const PKG = path.join(__dirname, '..');
const KATA_ADAPTER_DIR = path.join(PKG, 'skills', 'adapter-tracker-kata');
const SCRATCH_ROOT = path.join(os.homedir(), '.omp', 'br-7fx8c', 'scratch');

const scratchDirs = [];
const savedPath = process.env.PATH;

function mkScratch(label) {
  fs.mkdirSync(SCRATCH_ROOT, { recursive: true });
  const dir = fs.mkdtempSync(path.join(SCRATCH_ROOT, `${label}-`));
  scratchDirs.push(dir);
  return dir;
}

afterEach(() => {
  process.env.PATH = savedPath;
});

afterAll(() => {
  for (const dir of scratchDirs) fs.rmSync(dir, { recursive: true, force: true });
});

/** A `kata` stub: `--version` prints `versionOutput`; everything else is only logged. */
function installKataStub(versionOutput) {
  const dir = mkScratch('stub');
  const log = path.join(dir, 'calls.log');
  const payload = path.join(dir, 'version.txt');
  fs.writeFileSync(payload, versionOutput);
  const script = [
    '#!/bin/sh',
    `echo "$*" >> "${log}"`,
    'if [ "$1" = "--version" ]; then',
    `  cat "${payload}"`,
    '  exit 0',
    'fi',
    // doctor reports a bound workspace so the TRD-004 binding gate passes.
    'echo \'{"checks":[{"id":"config.workspace","status":"ok"}]}\'',
    'exit 0',
    ''
  ].join('\n');
  const bin = path.join(dir, 'kata');
  fs.writeFileSync(bin, script, { mode: 0o755 });
  process.env.PATH = `${dir}${path.delimiter}${savedPath}`;
  return {
    calls: () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : [])
  };
}

function kataProject(categoryMap = { tracker: 'kata' }) {
  const projectRoot = mkScratch('proj');
  fs.mkdirSync(path.join(projectRoot, '.ensemble'), { recursive: true });
  fs.writeFileSync(
    path.join(projectRoot, '.ensemble', 'toolchain.yaml'),
    Object.entries(categoryMap)
      .map(([c, a]) => `${c}: ${a}`)
      .join('\n') + '\n'
  );
  return { projectRoot, ctx: { projectRoot, env: { XDG_CONFIG_HOME: path.join(projectRoot, 'xdg') } } };
}

function recordPath(projectRoot, runId) {
  return path.join(projectRoot, '.ensemble', 'state', 'toolchain', `preflight-${runId}.json`);
}

describe('shipped kata manifest declares the floor', () => {
  const manifest = yaml.load(fs.readFileSync(path.join(KATA_ADAPTER_DIR, 'adapter.yaml'), 'utf8'));

  test('kata-version declares minVersion 0.23.0 and the manifest validates against the schema', () => {
    const versionCheck = manifest.health.find((h) => h.id === 'kata-version');
    expect(versionCheck.minVersion).toBe('0.23.0');
    const schema = JSON.parse(
      fs.readFileSync(path.join(PKG, 'toolchain', 'schemas', 'adapter-manifest-schema.json'), 'utf8')
    );
    const validate = new Ajv({ allErrors: true }).compile(schema);
    expect(validate(manifest)).toBe(true);
  });

  test('schema rejects a malformed minVersion and unknown health keys', () => {
    const schema = JSON.parse(
      fs.readFileSync(path.join(PKG, 'toolchain', 'schemas', 'adapter-manifest-schema.json'), 'utf8')
    );
    const validate = new Ajv({ allErrors: true }).compile(schema);
    const withHealth = (h) => ({ ...manifest, health: [{ id: 'x', run: ['kata', '--version'], timeoutMs: 1, ...h }] });
    expect(validate(withHealth({ minVersion: 'newer' }))).toBe(false);
    expect(validate(withHealth({ bogus: 1 }))).toBe(false);
    expect(validate(withHealth({ minVersion: '1.2.3', versionPattern: 'v(\\d+\\.\\d+\\.\\d+)' }))).toBe(true);
  });
});

describe('preflight version gate (stub kata)', () => {
  test('0.22.9 fails naming the minimum, issues no kata call beyond --version, writes no record', async () => {
    const stub = installKataStub('kata v0.22.9\n commit: abc\n');
    const { projectRoot, ctx } = kataProject();
    const result = await runPreflight({ categories: ['tracker', 'work-graph'], runId: 'old' }, ctx);

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('HEALTH_FAILED');
    expect(result.error.message).toContain('0.23.0');
    expect(result.error.message).toContain('0.22.9');
    expect(result.error.message).toContain('kata');
    expect(fs.existsSync(recordPath(projectRoot, 'old'))).toBe(false);
    const calls = stub.calls();
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((c) => c === '--version')).toBe(true);
    expect(calls.some((c) => c.includes('doctor'))).toBe(false);
  });

  test('0.23.0 passes, record (written and returned) carries the reported version', async () => {
    const stub = installKataStub('kata v0.23.0\n commit: abc\n');
    const { projectRoot, ctx } = kataProject();
    const result = await runPreflight({ categories: ['tracker', 'work-graph'], runId: 'ok' }, ctx);

    expect(result.ok).toBe(true);
    expect(result.versions).toEqual({ kata: '0.23.0' });
    const onDisk = JSON.parse(fs.readFileSync(recordPath(projectRoot, 'ok'), 'utf8'));
    expect(onDisk.versions).toEqual({ kata: '0.23.0' });
    expect(onDisk.ok).toBe(true);
    // the remaining checks still run once the gate passes
    expect(stub.calls().some((c) => c.startsWith('doctor'))).toBe(true);
  });

  test('0.100.0 compares numerically, not lexically', async () => {
    installKataStub('kata v0.100.0\n');
    const { ctx } = kataProject();
    const result = await runPreflight({ categories: ['tracker'], runId: 'big' }, ctx);
    expect(result.ok).toBe(true);
    expect(result.versions.kata).toBe('0.100.0');
  });

  test('a pre-release of the floor (0.23.0-rc.1) is older than 0.23.0 and fails', async () => {
    installKataStub('kata v0.23.0-rc.1\n');
    const { ctx } = kataProject();
    const result = await runPreflight({ categories: ['tracker'], runId: 'rc' }, ctx);
    expect(result.ok).toBe(false);
    expect(result.error.message).toContain('0.23.0');
  });

  test('a pre-release of a later version (0.24.0-rc.1) passes and is reported as printed', async () => {
    installKataStub('kata v0.24.0-rc.1\n');
    const { ctx } = kataProject();
    const result = await runPreflight({ categories: ['tracker'], runId: 'rc2' }, ctx);
    expect(result.ok).toBe(true);
    expect(result.versions.kata).toBe('0.24.0-rc.1');
  });

  test('unparsable --version output fails naming the minimum and skips the other checks', async () => {
    const stub = installKataStub('kata dev build\n');
    const { projectRoot, ctx } = kataProject();
    const result = await runPreflight({ categories: ['tracker'], runId: 'junk' }, ctx);
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('HEALTH_FAILED');
    expect(result.error.message).toContain('0.23.0');
    expect(fs.existsSync(recordPath(projectRoot, 'junk'))).toBe(false);
    expect(stub.calls().some((c) => c.includes('doctor'))).toBe(false);
  });
});

describe('adapters without minVersion are unchanged', () => {
  test('no versions key, all checks run', async () => {
    const stub = installKataStub('kata dev build\n');
    const projectRoot = mkScratch('plain');
    const skillDir = path.join(projectRoot, 'packages', 'p', 'skills', 'adapter-tracker-nomin');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, 'adapter.yaml'),
      yaml.dump({
        adapter: 'nomin',
        version: '1.0.0',
        categories: ['tracker'],
        contract: { tracker: '1.0' },
        binaries: ['kata'],
        allowlist: [{ bin: 'kata', sub: ['--version', 'doctor'] }],
        env: [],
        health: [
          { id: 'v', run: ['kata', '--version'], timeoutMs: 5000 },
          { id: 'd', run: ['kata', 'doctor'], timeoutMs: 5000 }
        ],
        detect: [],
        capabilities: {}
      })
    );
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# nomin\n');
    fs.mkdirSync(path.join(projectRoot, '.ensemble'), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, '.ensemble', 'toolchain.yaml'), 'tracker: nomin\n');
    const result = await runPreflight(
      { categories: ['tracker'], runId: 'n1' },
      { projectRoot, env: { XDG_CONFIG_HOME: path.join(projectRoot, 'xdg') } }
    );
    expect(result.ok).toBe(true);
    expect(result.versions).toBeUndefined();
    expect(stub.calls().sort()).toEqual(['--version', 'doctor']);
  });
});

describe('contract major check at resolution', () => {
  function writeAdapter(contract, categories) {
    const projectRoot = mkScratch('contract');
    const dir = path.join(projectRoot, 'packages', 'p', 'skills', 'adapter-x');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'adapter.yaml'),
      yaml.dump({
        adapter: 'majorprobe',
        version: '1.0.0',
        categories,
        contract,
        binaries: ['kata'],
        allowlist: [{ bin: 'kata', sub: ['show'] }],
        env: [],
        health: [],
        detect: [],
        capabilities: {}
      })
    );
    fs.writeFileSync(path.join(dir, 'SKILL.md'), '# x\n');
    return { projectRoot, env: { XDG_CONFIG_HOME: path.join(projectRoot, 'xdg') } };
  }

  test('tracker major mismatch is refused with CONTRACT_MAJOR_MISMATCH naming adapter, category, versions', () => {
    const ctx = writeAdapter({ tracker: '2.0' }, ['tracker']);
    let error;
    try {
      loadAdapter('majorprobe', { ...ctx, category: 'tracker' });
    } catch (e) {
      error = e;
    }
    expect(error).toBeDefined();
    expect(error.code).toBe('CONTRACT_MAJOR_MISMATCH');
    expect(error.message).toContain('majorprobe');
    expect(error.message).toContain('tracker');
    expect(error.message).toContain('2.0');
    expect(error.message).toContain('1.1');
  });

  test('work-graph major mismatch is refused', () => {
    const ctx = writeAdapter({ 'work-graph': '1.0' }, ['work-graph']);
    expect(() => loadAdapter('majorprobe', { ...ctx, category: 'work-graph' })).toThrow(/work-graph/);
    try {
      loadAdapter('majorprobe', { ...ctx, category: 'work-graph' });
    } catch (e) {
      expect(e.code).toBe('CONTRACT_MAJOR_MISMATCH');
    }
  });

  test('matching major (older minor) resolves', () => {
    const ctx = writeAdapter({ tracker: '1.0', 'work-graph': '2.0' }, ['tracker', 'work-graph']);
    expect(loadAdapter('majorprobe', { ...ctx, category: 'tracker' }).manifest.adapter).toBe('majorprobe');
    expect(loadAdapter('majorprobe', { ...ctx, category: 'work-graph' }).manifest.adapter).toBe('majorprobe');
    expect(loadAdapter('majorprobe', ctx).manifest.adapter).toBe('majorprobe');
  });

  test('only the category being resolved is checked; without a category every declared one is', () => {
    const ctx = writeAdapter({ tracker: '1.0', 'work-graph': '1.0' }, ['tracker', 'work-graph']);
    expect(loadAdapter('majorprobe', { ...ctx, category: 'tracker' }).manifest.adapter).toBe('majorprobe');
    expect(() => loadAdapter('majorprobe', ctx)).toThrow(/work-graph/);
  });

  test('an unknown category with no shipped contract does not newly throw', () => {
    const ctx = writeAdapter({ tracker: '1.0', 'no-such-category': '9.0' }, ['tracker']);
    expect(loadAdapter('majorprobe', { ...ctx, category: 'tracker' }).manifest.adapter).toBe('majorprobe');
    expect(loadAdapter('majorprobe', ctx).manifest.adapter).toBe('majorprobe');
  });

  test('preflight surfaces CONTRACT_MAJOR_MISMATCH', async () => {
    const ctx = writeAdapter({ tracker: '2.0' }, ['tracker']);
    fs.mkdirSync(path.join(ctx.projectRoot, '.ensemble'), { recursive: true });
    fs.writeFileSync(path.join(ctx.projectRoot, '.ensemble', 'toolchain.yaml'), 'tracker: majorprobe\n');
    const result = await runPreflight({ categories: ['tracker'], runId: 'cm' }, ctx);
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('CONTRACT_MAJOR_MISMATCH');
    expect(result.error.message).toContain('majorprobe');
  });

  test('work-graph resolution through the resolver refuses a mismatched adapter', () => {
    const ctx = writeAdapter({ tracker: '1.0', 'work-graph': '1.0' }, ['tracker', 'work-graph']);
    fs.mkdirSync(path.join(ctx.projectRoot, '.ensemble'), { recursive: true });
    fs.writeFileSync(
      path.join(ctx.projectRoot, '.ensemble', 'toolchain.yaml'),
      'tracker: majorprobe\nwork-graph: majorprobe\n'
    );
    expect(() => resolveWorkGraphAdapter({ ...ctx, interactive: true })).toThrow(/CONTRACT|major/i);
  });

  test('the shipped kata adapter resolves for both categories', () => {
    for (const category of ['tracker', 'work-graph']) {
      const loaded = loadAdapter('kata', { projectRoot: mkScratch('empty'), env: {}, category });
      expect(loaded.manifest.adapter).toBe('kata');
    }
  });
});

describe('real kata (guarded)', () => {
  const available = kataAvailable();
  (available ? test : test.skip)('real preflight passes and reports the installed kata version', async () => {
    const { projectRoot, ctx } = kataProject();
    const result = await runPreflight({ categories: ['tracker'], runId: 'real' }, ctx);
    // kata doctor can fail on a machine without a reachable daemon; the version gate itself must
    // not be the reason, and on success the version is recorded.
    if (result.ok) {
      expect(result.versions.kata).toMatch(/^\d+\.\d+\.\d+/);
    } else {
      expect(result.error.message).not.toMatch(/minimum/i);
    }
    expect(projectRoot).toBeTruthy();
  });
});
