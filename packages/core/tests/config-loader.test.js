'use strict';

/**
 * Unit tests for config-loader.js (tier-based model selection)
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

describe('config-loader', () => {
  // We use real tmp directories for filesystem isolation, not mock-fs.
  // Each test that touches the filesystem creates its own tmpdir and cleans up.

  let tmpDir;
  let stderrSpy;
  let originalEnv;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ensemble-test-'));
    stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => {});
    originalEnv = { ...process.env };
    jest.resetModules();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    stderrSpy.mockRestore();
    // Restore env
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) delete process.env[key];
    }
    Object.assign(process.env, originalEnv);
    jest.resetModules();
  });

  // Helper: fresh require after resetModules
  function getLoader() {
    return require('../lib/config-loader');
  }

  // ---------------------------------------------------------------------------
  // findProjectRoot
  // ---------------------------------------------------------------------------
  describe('findProjectRoot', () => {
    test('returns directory containing .git when found', () => {
      // Create: tmpDir/.git/
      const projectRoot = path.join(tmpDir, 'project');
      const childDir = path.join(projectRoot, 'src', 'deep');
      fs.mkdirSync(childDir, { recursive: true });
      fs.mkdirSync(path.join(projectRoot, '.git'));

      const { findProjectRoot } = getLoader();
      expect(findProjectRoot(childDir)).toBe(projectRoot);
    });

    test('returns startDir when .git not found anywhere in tree', () => {
      // tmpDir has no .git — but we cannot walk all the way to real root
      // so we use a directory nested inside tmpDir that has no .git
      const orphan = path.join(tmpDir, 'orphan');
      fs.mkdirSync(orphan);

      // We need to prevent the real repo's .git from being found.
      // Use a path deep inside tmpDir which is under /tmp — unlikely to have .git above it.
      const { findProjectRoot } = getLoader();
      // The function will walk up to / and return startDir.
      expect(findProjectRoot(orphan)).toBe(orphan);
    });

    test('handles .git as a file (git worktree)', () => {
      const projectRoot = path.join(tmpDir, 'worktree');
      const subDir = path.join(projectRoot, 'lib');
      fs.mkdirSync(subDir, { recursive: true });
      // Write a .git file (as git worktrees do)
      fs.writeFileSync(path.join(projectRoot, '.git'), 'gitdir: ../.git/worktrees/branch\n');

      const { findProjectRoot } = getLoader();
      expect(findProjectRoot(subDir)).toBe(projectRoot);
    });
  });

  // ---------------------------------------------------------------------------
  // getDefaultConfig
  // ---------------------------------------------------------------------------
  describe('getDefaultConfig', () => {
    test('returns object with tiers keys exactly ["high","medium","low"]', () => {
      const { getDefaultConfig } = getLoader();
      const cfg = getDefaultConfig();
      expect(Object.keys(cfg.tiers).sort()).toEqual(['high', 'low', 'medium']);
    });

    test('tiers contain non-empty model ID strings', () => {
      const { getDefaultConfig } = getLoader();
      const cfg = getDefaultConfig();
      expect(typeof cfg.tiers.high).toBe('string');
      expect(cfg.tiers.high.length).toBeGreaterThan(0);
      expect(typeof cfg.tiers.medium).toBe('string');
      expect(cfg.tiers.medium.length).toBeGreaterThan(0);
      expect(typeof cfg.tiers.low).toBe('string');
      expect(cfg.tiers.low.length).toBeGreaterThan(0);
    });

    test('has modelAliases pointing to same object as tiers', () => {
      const { getDefaultConfig } = getLoader();
      const cfg = getDefaultConfig();
      expect(cfg.modelAliases).toBe(cfg.tiers);
    });

    test('version is 1', () => {
      const { getDefaultConfig } = getLoader();
      const cfg = getDefaultConfig();
      expect(cfg.version).toBe(1);
    });

    test('extraKnownModelIds is an empty array', () => {
      const { getDefaultConfig } = getLoader();
      const cfg = getDefaultConfig();
      expect(cfg.extraKnownModelIds).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // validateConfig
  // ---------------------------------------------------------------------------
  describe('validateConfig', () => {
    test('valid config passes', () => {
      const { validateConfig } = getLoader();
      const cfg = {
        version: 1,
        tiers: { high: 'claude-opus-4-7', medium: 'claude-sonnet-4-6', low: 'claude-haiku-4-5-20251001' },
      };
      const { valid, errors } = validateConfig(cfg);
      expect(valid).toBe(true);
      expect(errors).toHaveLength(0);
    });

    test('missing low tier returns error naming low', () => {
      const { validateConfig } = getLoader();
      const cfg = {
        version: 1,
        tiers: { high: 'claude-opus-4-7', medium: 'claude-sonnet-4-6' },
      };
      const { valid, errors } = validateConfig(cfg);
      expect(valid).toBe(false);
      expect(errors.some((e) => e.includes('low'))).toBe(true);
    });

    test('missing high tier returns error naming high', () => {
      const { validateConfig } = getLoader();
      const cfg = {
        version: 1,
        tiers: { medium: 'claude-sonnet-4-6', low: 'claude-haiku-4-5-20251001' },
      };
      const { valid, errors } = validateConfig(cfg);
      expect(valid).toBe(false);
      expect(errors.some((e) => e.includes('high'))).toBe(true);
    });

    test('version 999 returns error mentioning version', () => {
      const { validateConfig } = getLoader();
      const cfg = {
        version: 999,
        tiers: { high: 'claude-opus-4-7', medium: 'claude-sonnet-4-6', low: 'claude-haiku-4-5-20251001' },
      };
      const { valid, errors } = validateConfig(cfg);
      expect(valid).toBe(false);
      expect(errors.some((e) => e.includes('version') || e.includes('999'))).toBe(true);
    });

    test('legacy opus key in tiers returns error mentioning migration', () => {
      const { validateConfig } = getLoader();
      const cfg = {
        version: 1,
        tiers: { opus: 'claude-opus-4-7', medium: 'claude-sonnet-4-6', low: 'claude-haiku-4-5-20251001' },
      };
      const { valid, errors } = validateConfig(cfg);
      expect(valid).toBe(false);
      expect(errors.some((e) => e.includes('opus'))).toBe(true);
      expect(errors.some((e) => e.includes('high') || e.includes('rename'))).toBe(true);
    });

    test('legacy sonnet key in tiers returns error', () => {
      const { validateConfig } = getLoader();
      const cfg = {
        version: 1,
        tiers: { high: 'claude-opus-4-7', sonnet: 'claude-sonnet-4-6', low: 'claude-haiku-4-5-20251001' },
      };
      const { valid, errors } = validateConfig(cfg);
      expect(valid).toBe(false);
      expect(errors.some((e) => e.includes('sonnet'))).toBe(true);
    });

    test('legacy haiku key in tiers returns error', () => {
      const { validateConfig } = getLoader();
      const cfg = {
        version: 1,
        tiers: { high: 'claude-opus-4-7', medium: 'claude-sonnet-4-6', haiku: 'claude-haiku-4-5-20251001' },
      };
      const { valid, errors } = validateConfig(cfg);
      expect(valid).toBe(false);
      expect(errors.some((e) => e.includes('haiku'))).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // loadConfig
  // ---------------------------------------------------------------------------
  describe('loadConfig', () => {
    function makeProjectDir(withGit = true) {
      const projectDir = path.join(tmpDir, 'project');
      fs.mkdirSync(projectDir);
      if (withGit) fs.mkdirSync(path.join(projectDir, '.git'));
      return projectDir;
    }

    function writeConfig(projectDir, content) {
      const claudeDir = path.join(projectDir, '.claude');
      fs.mkdirSync(claudeDir, { recursive: true });
      fs.writeFileSync(path.join(claudeDir, 'ensemble-model-config.json'), content, 'utf-8');
    }

    test('no config file → returns defaults silently (no stderr error)', () => {
      // Suppress XDG_CONFIG_HOME to avoid hitting real legacy file
      process.env.XDG_CONFIG_HOME = path.join(tmpDir, 'xdg');
      const projectDir = makeProjectDir();

      const { loadConfig, getDefaultConfig } = getLoader();
      const cfg = loadConfig(projectDir);
      const defaults = getDefaultConfig();

      expect(cfg.version).toBe(defaults.version);
      expect(cfg.tiers.high).toBe(defaults.tiers.high);
    });

    test('invalid JSON → stderr warning + returns defaults', () => {
      process.env.XDG_CONFIG_HOME = path.join(tmpDir, 'xdg');
      const projectDir = makeProjectDir();
      writeConfig(projectDir, '{ bad json !!');

      const { loadConfig } = getLoader();
      const cfg = loadConfig(projectDir);

      expect(cfg.tiers.high).toBe('claude-opus-4-7');
      expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('Warning'));
    });

    test('valid config → returned as-is', () => {
      process.env.XDG_CONFIG_HOME = path.join(tmpDir, 'xdg');
      const projectDir = makeProjectDir();
      const content = JSON.stringify({
        version: 1,
        tiers: {
          high: 'claude-opus-4-7',
          medium: 'claude-sonnet-4-6',
          low: 'claude-haiku-4-5-20251001',
        },
      });
      writeConfig(projectDir, content);

      const { loadConfig } = getLoader();
      const cfg = loadConfig(projectDir);

      expect(cfg.tiers.high).toBe('claude-opus-4-7');
      expect(cfg.tiers.medium).toBe('claude-sonnet-4-6');
      expect(cfg.tiers.low).toBe('claude-haiku-4-5-20251001');
    });

    test('missing tier in config → stderr warning + returns defaults', () => {
      process.env.XDG_CONFIG_HOME = path.join(tmpDir, 'xdg');
      const projectDir = makeProjectDir();
      const content = JSON.stringify({
        version: 1,
        tiers: {
          high: 'claude-opus-4-7',
          medium: 'claude-sonnet-4-6',
          // low missing
        },
      });
      writeConfig(projectDir, content);

      const { loadConfig } = getLoader();
      const cfg = loadConfig(projectDir);

      expect(cfg.tiers.low).toBe('claude-haiku-4-5-20251001'); // default
      expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('Warning'));
    });

    test('returned config has modelAliases pointing to same tiers object', () => {
      process.env.XDG_CONFIG_HOME = path.join(tmpDir, 'xdg');
      const projectDir = makeProjectDir();
      const content = JSON.stringify({
        version: 1,
        tiers: {
          high: 'claude-opus-4-7',
          medium: 'claude-sonnet-4-6',
          low: 'claude-haiku-4-5-20251001',
        },
      });
      writeConfig(projectDir, content);

      const { loadConfig } = getLoader();
      const cfg = loadConfig(projectDir);
      expect(cfg.modelAliases).toBe(cfg.tiers);
    });
  });

  // ---------------------------------------------------------------------------
  // checkLegacyXdgFile
  // ---------------------------------------------------------------------------
  describe('checkLegacyXdgFile', () => {
    test('emits warning when legacy model-selection.json exists', () => {
      const xdgDir = path.join(tmpDir, 'xdg');
      const ensembleDir = path.join(xdgDir, 'ensemble');
      fs.mkdirSync(ensembleDir, { recursive: true });
      fs.writeFileSync(
        path.join(ensembleDir, 'model-selection.json'),
        JSON.stringify({ version: '1.0.0' }),
        'utf-8'
      );
      process.env.XDG_CONFIG_HOME = xdgDir;

      const { checkLegacyXdgFile } = getLoader();
      checkLegacyXdgFile();

      expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('legacy model config'));
    });

    test('does not repeat warning on second call (seen-warnings.json)', () => {
      const xdgDir = path.join(tmpDir, 'xdg');
      const ensembleDir = path.join(xdgDir, 'ensemble');
      fs.mkdirSync(ensembleDir, { recursive: true });
      fs.writeFileSync(
        path.join(ensembleDir, 'model-selection.json'),
        JSON.stringify({ version: '1.0.0' }),
        'utf-8'
      );
      process.env.XDG_CONFIG_HOME = xdgDir;

      const { checkLegacyXdgFile } = getLoader();
      checkLegacyXdgFile(); // first call — warns
      stderrSpy.mockClear();
      checkLegacyXdgFile(); // second call — should be silent

      expect(stderrSpy).not.toHaveBeenCalled();
    });

    test('does not emit warning when no legacy file exists', () => {
      process.env.XDG_CONFIG_HOME = path.join(tmpDir, 'empty-xdg');

      const { checkLegacyXdgFile } = getLoader();
      checkLegacyXdgFile();

      expect(stderrSpy).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // emitFirstRunHint (TRD-006)
  // ---------------------------------------------------------------------------
  describe('emitFirstRunHint', () => {
    function makeProjectRoot(withConfig = false) {
      const projectDir = path.join(tmpDir, 'project-hint');
      fs.mkdirSync(projectDir);
      fs.mkdirSync(path.join(projectDir, '.git'));
      if (withConfig) {
        const claudeDir = path.join(projectDir, '.claude');
        fs.mkdirSync(claudeDir);
        fs.writeFileSync(
          path.join(claudeDir, 'ensemble-model-config.json'),
          JSON.stringify({
            version: 1,
            tiers: { high: 'claude-opus-4-7', medium: 'claude-sonnet-4-6', low: 'claude-haiku-4-5-20251001' },
          }),
          'utf-8'
        );
      }
      return projectDir;
    }

    test('first run (no seen-hints.json, no project config): hint emitted to stderr', () => {
      process.env.XDG_CONFIG_HOME = path.join(tmpDir, 'xdg-hints');
      const projectDir = makeProjectRoot(false);

      const { emitFirstRunHint } = getLoader();
      emitFirstRunHint(projectDir);

      expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('map-model'));
    });

    test('second run (seen-hints.json has project root): hint NOT emitted', () => {
      const xdgDir = path.join(tmpDir, 'xdg-hints2');
      process.env.XDG_CONFIG_HOME = xdgDir;
      const projectDir = makeProjectRoot(false);

      const { emitFirstRunHint } = getLoader();
      emitFirstRunHint(projectDir); // first call — emits
      stderrSpy.mockClear();
      emitFirstRunHint(projectDir); // second call — silent

      expect(stderrSpy).not.toHaveBeenCalled();
    });

    test('does not emit hint when project config already exists', () => {
      process.env.XDG_CONFIG_HOME = path.join(tmpDir, 'xdg-hints3');
      const projectDir = makeProjectRoot(true); // has config

      const { emitFirstRunHint } = getLoader();
      emitFirstRunHint(projectDir);

      expect(stderrSpy).not.toHaveBeenCalled();
    });

    test('corrupted seen-hints.json: hint emitted (treat as unseen), write best-effort', () => {
      const xdgDir = path.join(tmpDir, 'xdg-hints4');
      const ensembleDir = path.join(xdgDir, 'ensemble');
      fs.mkdirSync(ensembleDir, { recursive: true });
      fs.writeFileSync(path.join(ensembleDir, 'seen-hints.json'), 'CORRUPTED JSON!!!', 'utf-8');
      process.env.XDG_CONFIG_HOME = xdgDir;
      const projectDir = makeProjectRoot(false);

      const { emitFirstRunHint } = getLoader();
      expect(() => emitFirstRunHint(projectDir)).not.toThrow();
      expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('map-model'));
    });

    test('write failure (read-only hints path): hint emits, no exception thrown', () => {
      // Point XDG to a file (not a directory) to cause mkdir failure
      const xdgDir = path.join(tmpDir, 'xdg-readonly');
      // Create a file at the ensemble path to block directory creation
      fs.mkdirSync(xdgDir, { recursive: true });
      fs.writeFileSync(path.join(xdgDir, 'ensemble'), 'this-is-a-file-not-a-dir', 'utf-8');
      process.env.XDG_CONFIG_HOME = xdgDir;
      const projectDir = makeProjectRoot(false);

      const { emitFirstRunHint } = getLoader();
      expect(() => emitFirstRunHint(projectDir)).not.toThrow();
      // The hint should still fire (treat write failure as unseen)
      expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('map-model'));
    });
  });

  // ---------------------------------------------------------------------------
  // loadConfig integrates emitFirstRunHint (TRD-006 via loadConfig)
  // ---------------------------------------------------------------------------
  describe('loadConfig first-run hint integration', () => {
    test('hint is emitted when project has no config file', () => {
      process.env.XDG_CONFIG_HOME = path.join(tmpDir, 'xdg-lc-hint');
      const projectDir = path.join(tmpDir, 'lc-project');
      fs.mkdirSync(projectDir);
      fs.mkdirSync(path.join(projectDir, '.git'));

      const { loadConfig } = getLoader();
      loadConfig(projectDir);

      expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('map-model'));
    });

    test('hint is NOT emitted when project has a valid config file', () => {
      process.env.XDG_CONFIG_HOME = path.join(tmpDir, 'xdg-lc-nohint');
      const projectDir = path.join(tmpDir, 'lc-project2');
      fs.mkdirSync(projectDir);
      fs.mkdirSync(path.join(projectDir, '.git'));
      const claudeDir = path.join(projectDir, '.claude');
      fs.mkdirSync(claudeDir);
      fs.writeFileSync(
        path.join(claudeDir, 'ensemble-model-config.json'),
        JSON.stringify({
          version: 1,
          tiers: { high: 'claude-opus-4-7', medium: 'claude-sonnet-4-6', low: 'claude-haiku-4-5-20251001' },
        }),
        'utf-8'
      );

      const { loadConfig } = getLoader();
      loadConfig(projectDir);

      expect(stderrSpy).not.toHaveBeenCalled();
    });
  });
});
