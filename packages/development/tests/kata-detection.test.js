'use strict';

/**
 * TRD-005-TEST -- beads stays the default and binding files never select kata
 * (TRD-2026-6995dc96 TRD-005; PRD REQ-013, AC-013-1..AC-013-4).
 *
 * Reads only repo files (no kata binary), so no guardKata is needed. Scratch project dirs live
 * under ~/.omp (never os.tmpdir()); XDG_CONFIG_HOME is a scratch dir so a developer's real user
 * config cannot flip a result.
 *
 * RED evidence: the package root is taken from KATA_DETECTION_DEV_ROOT (default: this package),
 * so a mutated COPY of packages/development can be tested without touching shared files.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const yaml = require('js-yaml');

const DEV_ROOT = process.env.KATA_DETECTION_DEV_ROOT
  ? path.resolve(process.env.KATA_DETECTION_DEV_ROOT)
  : path.join(__dirname, '..');

const { resolveCategory } = require(path.join(DEV_ROOT, 'lib', 'toolchain', 'config'));
const { resolveWorkGraphAdapter } = require(path.join(DEV_ROOT, 'lib', 'toolchain', 'work-graph-resolve'));
const { detectAdapter } = require(path.join(DEV_ROOT, 'lib', 'toolchain', 'detect'));

const DEFAULT_TOOLCHAIN_PATH = path.join(DEV_ROOT, 'toolchain', 'toolchain.default.yaml');
const KATA_MANIFEST_PATH = path.join(DEV_ROOT, 'skills', 'adapter-tracker-kata', 'adapter.yaml');
const BEADS_MANIFEST_PATH = path.join(DEV_ROOT, 'skills', 'adapter-tracker-beads', 'adapter.yaml');

const SCRATCH_ROOT = path.join(os.homedir(), '.omp', 'trd005-kata-detection');

let scratchBase;
let counter = 0;

function scratchDir(label) {
  counter += 1;
  const dir = path.join(scratchBase, `${label}-${counter}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function readYaml(file) {
  return yaml.load(fs.readFileSync(file, 'utf8'));
}

/** Project root with the .beads workspace dir, optionally the kata binding file; no toolchain config. */
function makeProject({ binding = false } = {}) {
  const projectRoot = scratchDir('project');
  fs.mkdirSync(path.join(projectRoot, '.beads'), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, '.beads', 'issues.jsonl'), '', 'utf8');
  if (binding) fs.writeFileSync(path.join(projectRoot, '.kata.toml'), '# Kata workspace binding\n', 'utf8');
  return projectRoot;
}

function ctxFor(projectRoot) {
  return {
    projectRoot,
    env: { XDG_CONFIG_HOME: scratchDir('xdg') },
    diagnostics: [],
    detect: detectAdapter,
  };
}

beforeAll(() => {
  fs.mkdirSync(SCRATCH_ROOT, { recursive: true });
  scratchBase = fs.mkdtempSync(path.join(SCRATCH_ROOT, 'run-'));
});

afterAll(() => {
  fs.rmSync(scratchBase, { recursive: true, force: true });
});

describe('TRD-005-TEST: beads stays the default; binding files never select kata', () => {
  test('AC-013-1 (happy): no toolchain config -> tracker is beads from the default, .beads is the working tracker', () => {
    const projectRoot = makeProject();
    const ctx = ctxFor(projectRoot);
    expect(fs.existsSync(path.join(projectRoot, '.ensemble', 'toolchain.yaml'))).toBe(false);

    expect(resolveCategory('tracker', ctx)).toEqual({ value: 'beads', source: 'default' });

    const resolved = resolveWorkGraphAdapter(ctx);
    const beads = readYaml(BEADS_MANIFEST_PATH);
    expect(resolved.value).toBe('beads');
    expect(resolved.manifest.adapter).toBe('beads');
    expect(JSON.stringify(beads)).toContain('.beads/issues.jsonl');
    expect(fs.statSync(path.join(projectRoot, '.beads')).isDirectory()).toBe(true);
  });

  test('AC-013-2 (edge): .kata.toml and no config -> still beads, no detection-derived kata choice', () => {
    const ctx = ctxFor(makeProject({ binding: true }));

    const tracker = resolveCategory('tracker', ctx);
    const workGraph = resolveWorkGraphAdapter(ctx);

    expect(tracker).toEqual({ value: 'beads', source: 'default' });
    expect(workGraph.value).toBe('beads');
    for (const category of ['tracker', 'work-graph']) {
      expect(detectAdapter(category, ctx)).toBeNull();
    }
    expect(ctx.diagnostics.filter((d) => d && String(d.adapter).includes('kata'))).toEqual([]);
  });

  test('AC-013-3 / AC-013-4 (edge): deleting a kata project config returns to beads; shipped default reads beads, work-graph auto', () => {
    const projectRoot = makeProject({ binding: true });
    const configDir = path.join(projectRoot, '.ensemble');
    const configFile = path.join(configDir, 'toolchain.yaml');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(configFile, 'tracker: kata\n', 'utf8');
    const ctx = ctxFor(projectRoot);

    expect(resolveCategory('tracker', ctx)).toEqual({ value: 'kata', source: 'project' });

    fs.rmSync(configFile); // the only edit

    expect(resolveCategory('tracker', ctx)).toEqual({ value: 'beads', source: 'default' });
    const after = resolveWorkGraphAdapter(ctx);
    expect(after.value).toBe('beads');
    expect(after.source).toBe('default');

    const defaults = readYaml(DEFAULT_TOOLCHAIN_PATH);
    expect(defaults.tracker).toBe('beads');
    expect(defaults['work-graph']).toBe('auto');
  });

  test('AC-013-2 (happy): shipped kata manifest detect list is empty, so a binding file cannot make kata a candidate', () => {
    expect(readYaml(KATA_MANIFEST_PATH).detect).toEqual([]);
  });
});
