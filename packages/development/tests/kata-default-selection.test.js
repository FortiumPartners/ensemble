'use strict';

/**
 * TRD-005-TEST -- kata stays out of detection and default selection
 * (TRD-2026-6995dc96 TRD-005; PRD REQ-013, AC-013-1..AC-013-4).
 *
 * Every assertion goes through the real resolveCategory / resolveWorkGraphAdapter / detectAdapter,
 * reading the shipped toolchain.default.yaml and the shipped adapter manifests. AC-013-2 is also
 * covered in kata-manifest.test.js; it is repeated here for the config-less + .kata.toml +
 * .beads shape this file builds, plus a check that detect.js itself carries no kata signal.
 *
 * Scratch dirs live under ~/.omp (never os.tmpdir()); XDG_CONFIG_HOME is a scratch dir so a
 * developer's real user-level toolchain config cannot flip a result.
 *
 * Mutation hooks (RED evidence only; unset in normal runs): none -- the RED run copies this
 * package to a scratch tree and mutates the copy, so shared library files are never touched.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const yaml = require('js-yaml');

const { resolveCategory } = require('../lib/toolchain/config');
const { resolveWorkGraphAdapter } = require('../lib/toolchain/work-graph-resolve');
const { detectAdapter } = require('../lib/toolchain/detect');

const DEV_ROOT = path.join(__dirname, '..');
const DEFAULT_TOOLCHAIN_PATH = path.join(DEV_ROOT, 'toolchain', 'toolchain.default.yaml');
const KATA_MANIFEST_PATH = path.join(DEV_ROOT, 'skills', 'adapter-tracker-kata', 'adapter.yaml');
const BEADS_MANIFEST_PATH = path.join(DEV_ROOT, 'skills', 'adapter-tracker-beads', 'adapter.yaml');
const DETECT_JS_PATH = path.join(DEV_ROOT, 'lib', 'toolchain', 'detect.js');

const SCRATCH_ROOT = path.join(os.homedir(), '.omp', 'trd005-kata-default-selection');

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

/** A project root with the .beads workspace dir and the Kata binding file, no toolchain config. */
function makeProject() {
  const projectRoot = scratchDir('project');
  fs.mkdirSync(path.join(projectRoot, '.beads'), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, '.beads', 'issues.jsonl'), '', 'utf8');
  fs.writeFileSync(path.join(projectRoot, '.kata.toml'), '# Kata workspace binding\n', 'utf8');
  return projectRoot;
}

/** Real detector, real project-file lookup, hermetic user config. */
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

describe('TRD-005-TEST: kata is reachable only by explicit configuration', () => {
  describe('AC-013-1: no toolchain configuration', () => {
    test('tracker resolves to beads from the shipped default', () => {
      const projectRoot = makeProject();
      const ctx = ctxFor(projectRoot);
      expect(fs.existsSync(path.join(projectRoot, '.ensemble', 'toolchain.yaml'))).toBe(false);

      const resolved = resolveCategory('tracker', ctx);

      expect(resolved).toEqual({ value: 'beads', source: 'default' });
    });

    test('the beads workspace directory is the working tracker per the beads manifest', () => {
      // The shipped beads adapter is the one that operates on `.beads/` (its allowlisted
      // `cat .beads/issues.jsonl` reader) and the default resolution lands on exactly that adapter.
      const projectRoot = makeProject();
      const resolved = resolveWorkGraphAdapter(ctxFor(projectRoot));
      const beads = readYaml(BEADS_MANIFEST_PATH);

      expect(resolved.value).toBe('beads');
      expect(resolved.manifest.adapter).toBe('beads');
      expect(beads.adapter).toBe('beads');
      expect(JSON.stringify(beads.allowlist || beads)).toContain('.beads/issues.jsonl');
      expect(fs.statSync(path.join(projectRoot, '.beads')).isDirectory()).toBe(true);
    });
  });

  describe('AC-013-2: Kata binding file present, no toolchain configuration', () => {
    test('tracker and work-graph resolve to beads with no detection-derived kata choice', () => {
      const ctx = ctxFor(makeProject());

      const tracker = resolveCategory('tracker', ctx);
      const workGraph = resolveWorkGraphAdapter(ctx);

      expect(tracker.value).toBe('beads');
      expect(tracker.source).toBe('default');
      expect(workGraph.value).toBe('beads');
      expect(workGraph.value).not.toBe('kata');
      for (const category of ['tracker', 'work-graph']) {
        expect(detectAdapter(category, ctx)).toBeNull();
      }
      expect(ctx.diagnostics.filter((d) => d && String(d.adapter).includes('kata'))).toEqual([]);
    });

    test('a .kata directory is not a signal either', () => {
      const projectRoot = makeProject();
      fs.mkdirSync(path.join(projectRoot, '.kata'), { recursive: true });
      const ctx = ctxFor(projectRoot);

      expect(resolveCategory('tracker', ctx)).toEqual({ value: 'beads', source: 'default' });
      expect(detectAdapter('tracker', ctx)).toBeNull();
    });
  });

  describe('AC-013-3: deleting the toolchain configuration reverts to beads', () => {
    test('tracker: kata resolves to kata, and after deleting the file resolves to beads', () => {
      const projectRoot = makeProject();
      const configDir = path.join(projectRoot, '.ensemble');
      const configFile = path.join(configDir, 'toolchain.yaml');
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(configFile, 'tracker: kata\n', 'utf8');
      const ctx = ctxFor(projectRoot);

      expect(resolveCategory('tracker', ctx)).toEqual({ value: 'kata', source: 'project' });
      const workGraphBefore = resolveWorkGraphAdapter(ctx);
      expect(workGraphBefore.value).toBe('kata');

      // The one and only edit: delete the file.
      fs.rmSync(configFile);

      expect(resolveCategory('tracker', ctx)).toEqual({ value: 'beads', source: 'default' });
      const workGraphAfter = resolveWorkGraphAdapter(ctx);
      expect(workGraphAfter.value).toBe('beads');
      expect(workGraphAfter.source).toBe('default');
    });
  });

  describe('AC-013-4: the shipped default configuration', () => {
    test('tracker is beads and work-graph is auto', () => {
      const defaults = readYaml(DEFAULT_TOOLCHAIN_PATH);

      expect(defaults.tracker).toBe('beads');
      expect(defaults['work-graph']).toBe('auto');
      expect(Object.values(defaults)).not.toContain('kata');
    });
  });

  describe('why it holds: no detection path reaches kata', () => {
    test('the kata manifest declares no detect signals', () => {
      expect(readYaml(KATA_MANIFEST_PATH).detect).toEqual([]);
    });

    test('detect.js contains no kata signal', () => {
      expect(fs.readFileSync(DETECT_JS_PATH, 'utf8')).not.toMatch(/kata/i);
    });
  });
});
