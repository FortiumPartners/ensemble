'use strict';
/**
 * Tests for TRD-2026-8d825f54 TRD-003: `resolveCategory()`/`loadToolchainConfigFile()` in
 * packages/development/lib/toolchain/config.js, covering the fixed resolution precedence
 * (project > user > env-compat > detection > shipped default) from PRD REQ-009
 * (AC-009-1, AC-009-2).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { resolveCategory, parseToolchainConfigText, loadToolchainConfigFile } = require('../../packages/development/lib/toolchain/config');
const { getUserToolchainConfigPath } = require('../../packages/development/lib/toolchain/config-path');

const tempDirs = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function mkProjectConfig(projectRoot, yamlContents) {
  const ensembleDir = path.join(projectRoot, '.ensemble');
  fs.mkdirSync(ensembleDir, { recursive: true });
  const configPath = path.join(ensembleDir, 'toolchain.yaml');
  fs.writeFileSync(configPath, yamlContents);
  return configPath;
}

function mkUserConfig(xdgConfigHome, yamlContents) {
  const configPath = getUserToolchainConfigPath({ XDG_CONFIG_HOME: xdgConfigHome });
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, yamlContents);
  return configPath;
}

describe('resolveCategory precedence', () => {
  test('AC-009-1: project config wins over user config for the same category', () => {
    const tmpProjectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ensemble-toolchain-project-'));
    const tmpXdgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ensemble-toolchain-xdg-'));
    tempDirs.push(tmpProjectDir, tmpXdgDir);

    mkProjectConfig(tmpProjectDir, 'tracker: a\n');

    const userConfigDir = path.join(tmpXdgDir, 'ensemble');
    fs.mkdirSync(userConfigDir, { recursive: true });
    fs.writeFileSync(path.join(userConfigDir, 'toolchain.yaml'), 'tracker: b\n');

    const result = resolveCategory('tracker', {
      projectRoot: tmpProjectDir,
      env: { XDG_CONFIG_HOME: tmpXdgDir }
    });

    expect(result).toEqual({ value: 'a', source: 'project' });
  });

  test('AC-009-2: falls back to the shipped default when no config or detection selects a value', () => {
    const tmpEmptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ensemble-toolchain-empty-'));
    tempDirs.push(tmpEmptyDir);

    const result = resolveCategory('tracker', { projectRoot: tmpEmptyDir, env: {} });

    expect(result).toEqual({ value: 'beads', source: 'default' });
  });

  test('an unknown category key in a project config throws naming the file and the key', () => {
    const tmpProjectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ensemble-toolchain-invalid-'));
    tempDirs.push(tmpProjectDir);

    const configPath = mkProjectConfig(tmpProjectDir, 'bogus-category: x\n');

    let thrown = null;
    try {
      resolveCategory('tracker', { projectRoot: tmpProjectDir, env: {} });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect(thrown.message).toContain(configPath);
    expect(thrown.message).toContain('bogus-category');
  });

  test('ENSEMBLE_PR_BACKEND selects host with source env-compat when no config files exist', () => {
    const tmpEmptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ensemble-toolchain-envcompat-'));
    tempDirs.push(tmpEmptyDir);

    const result = resolveCategory('host', {
      projectRoot: tmpEmptyDir,
      env: { ENSEMBLE_PR_BACKEND: 'azure-devops' }
    });

    expect(result).toEqual({ value: 'azure-devops', source: 'env-compat' });
  });

  test('env-compat is scoped to host/workflow only: ENSEMBLE_PR_BACKEND does not affect tracker', () => {
    const tmpEmptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ensemble-toolchain-envcompat-scope-'));
    tempDirs.push(tmpEmptyDir);

    const result = resolveCategory('tracker', {
      projectRoot: tmpEmptyDir,
      env: { ENSEMBLE_PR_BACKEND: 'azure-devops' }
    });

    expect(result).toEqual({ value: 'beads', source: 'default' });
  });

  test('the detection hook is consulted before falling back to the shipped default', () => {
    const tmpEmptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ensemble-toolchain-detect-'));
    tempDirs.push(tmpEmptyDir);

    const detect = jest.fn(() => ({ value: 'detected-tracker' }));

    const result = resolveCategory('tracker', { projectRoot: tmpEmptyDir, env: {}, detect });

    expect(result).toEqual({ value: 'detected-tracker', source: 'detection' });
    expect(detect).toHaveBeenCalledWith('tracker', expect.objectContaining({ projectRoot: tmpEmptyDir }));
  });
});

describe('resolveCategory: a supplied project config replaces the tree\'s own toolchain.yaml', () => {
  const isolatedEnv = () => {
    const xdg = fs.mkdtempSync(path.join(os.tmpdir(), 'ensemble-toolchain-supplied-xdg-'));
    tempDirs.push(xdg);
    return { XDG_CONFIG_HOME: xdg };
  };
  const tree = (yamlContents) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ensemble-toolchain-supplied-tree-'));
    tempDirs.push(dir);
    mkProjectConfig(dir, yamlContents);
    return dir;
  };

  test('control: with no projectConfig the tree\'s file is read, exactly as before', () => {
    expect(resolveCategory('tracker', { projectRoot: tree('tracker: from-tree\n'), env: isolatedEnv() })).toEqual({ value: 'from-tree', source: 'project' });
  });

  test('a supplied config wins over the tree\'s file, which is not consulted at all', () => {
    const projectRoot = tree('tracker: from-tree\n');
    const result = resolveCategory('tracker', { projectRoot, env: isolatedEnv(), projectConfig: parseToolchainConfigText('tracker: from-base\n', 'base') });
    expect(result).toEqual({ value: 'from-base', source: 'project' });
    // Even a tree whose file would throw is never read.
    const broken = tree('not-a-category: x\n');
    expect(resolveCategory('tracker', { projectRoot: broken, env: isolatedEnv(), projectConfig: { tracker: 'from-base' } })).toEqual({ value: 'from-base', source: 'project' });
  });

  test('a supplied null means "the base has none": the tree\'s file is ignored and the user config, then the default, decide', () => {
    const projectRoot = tree('tracker: from-tree\n');
    expect(resolveCategory('tracker', { projectRoot, env: isolatedEnv(), projectConfig: null })).toEqual({ value: 'beads', source: 'default' });
    const env = isolatedEnv();
    mkUserConfig(env.XDG_CONFIG_HOME, 'tracker: from-user\n');
    expect(resolveCategory('tracker', { projectRoot, env, projectConfig: null })).toEqual({ value: 'from-user', source: 'user' });
  });

  test('a supplied config that does not name the category falls through to the user config and the default, not to the tree', () => {
    const projectRoot = tree('tracker: from-tree\n');
    expect(resolveCategory('tracker', { projectRoot, env: isolatedEnv(), projectConfig: { host: 'github' } })).toEqual({ value: 'beads', source: 'default' });
  });

  test('parseToolchainConfigText validates like the file loader and names what it parsed', () => {
    expect(parseToolchainConfigText('', 'empty')).toEqual({});
    expect(parseToolchainConfigText('tracker: beads\n', 'x')).toEqual({ tracker: 'beads' });
    expect(() => parseToolchainConfigText('not-a-category: x\n', 'abc123:.ensemble/toolchain.yaml')).toThrow(/abc123:\.ensemble\/toolchain\.yaml: invalid toolchain config \(not-a-category\)/);
    expect(() => loadToolchainConfigFile(path.join(tree('not-a-category: x\n'), '.ensemble', 'toolchain.yaml'))).toThrow(/invalid toolchain config \(not-a-category\)/);
  });
});

/**
 * TRD-2026-8d825f54 TRD-003-TEST: the project > user and shipped-default fallback precedence
 * steps hold across the full real precedence chain for multiple categories, not just one
 * hand-picked category (PRD REQ-009, AC-009-1, AC-009-2).
 *
 * Scenario: Project config beats user config -- Given project config selects adapter A and user
 * config selects adapter B for a category, When resolved, Then A wins.
 *
 * Scenario: Shipped default fallback -- Given no config and no detectable signal, When resolved,
 * Then the shipped default is used.
 */
describe('TRD-003-TEST: provider selection precedence chain', () => {
  test('Scenario: Project config beats user config -- Given project config selects adapter A and user config selects adapter B for a category, When resolved, Then A wins. -- holds simultaneously for multiple categories (host, workflow), not just one, and the user tier is actually consulted when project config omits a category', () => {
    const tmpProjectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ensemble-toolchain-multi-project-'));
    const tmpXdgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ensemble-toolchain-multi-xdg-'));
    tempDirs.push(tmpProjectDir, tmpXdgDir);

    mkProjectConfig(tmpProjectDir, 'host: a\nworkflow: a\n');
    mkUserConfig(tmpXdgDir, 'host: b\nworkflow: b\ntracker: b\n');

    const ctx = { projectRoot: tmpProjectDir, env: { XDG_CONFIG_HOME: tmpXdgDir } };

    for (const category of ['host', 'workflow']) {
      expect(resolveCategory(category, ctx)).toEqual({ value: 'a', source: 'project' });
    }

    // project config has no 'tracker' key, proving the user config file is actually read
    // (not merely present on disk) rather than silently ignored.
    expect(resolveCategory('tracker', ctx)).toEqual({ value: 'b', source: 'user' });
  });

  test('Scenario: Shipped default fallback -- Given no config and no detectable signal, When resolved, Then the shipped default is used. -- holds for all 14 shipped categories against hardcoded expected values', () => {
    const tmpEmptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ensemble-toolchain-multi-default-'));
    tempDirs.push(tmpEmptyDir);

    // Hardcoded independently of packages/development/toolchain/toolchain.default.yaml so this
    // test actually verifies the shipped file's content instead of echoing it back to itself.
    const expectedDefaults = {
      host: 'github',
      workflow: 'plain-git',
      worktree: 'plain-git',
      tracker: 'beads',
      'work-graph': 'auto',
      'ci-local': 'act',
      review: 'coderabbit',
      lint: 'reviewdog',
      'test-runner': 'default',
      'e2e-quality': 'playwright',
      'container-deploy': 'docker-kubectl',
      iac: 'terraform',
      'platform-cloud': 'aws',
      'package-runner': 'npm'
    };
    expect(Object.keys(expectedDefaults)).toHaveLength(14);

    for (const [category, expectedValue] of Object.entries(expectedDefaults)) {
      const result = resolveCategory(category, { projectRoot: tmpEmptyDir, env: {} });

      expect(result).toEqual({ value: expectedValue, source: 'default' });
    }
  });
});
