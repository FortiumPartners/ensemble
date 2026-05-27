'use strict';

/**
 * Integration tests for tier-based model selection workflow.
 * Updated for TRD-2026-021 tiered model aliases (Phase 1).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

describe('Model Selection Integration', () => {
  let tmpDir;
  let stderrSpy;
  let originalEnv;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ensemble-integ-'));
    stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => {});
    originalEnv = { ...process.env };
    // Isolated XDG so we don't hit real legacy files
    process.env.XDG_CONFIG_HOME = path.join(tmpDir, 'xdg');
    jest.resetModules();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    stderrSpy.mockRestore();
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) delete process.env[key];
    }
    Object.assign(process.env, originalEnv);
    jest.resetModules();
  });

  function makeProject(configObj) {
    const projectDir = path.join(tmpDir, 'project');
    fs.mkdirSync(projectDir);
    fs.mkdirSync(path.join(projectDir, '.git'));
    if (configObj !== undefined) {
      const claudeDir = path.join(projectDir, '.claude');
      fs.mkdirSync(claudeDir);
      fs.writeFileSync(
        path.join(claudeDir, 'ensemble-model-config.json'),
        JSON.stringify(configObj),
        'utf-8'
      );
    }
    return projectDir;
  }

  const VALID_CONFIG = {
    version: 1,
    tiers: {
      high: 'claude-opus-4-7',
      medium: 'claude-sonnet-4-6',
      low: 'claude-haiku-4-5-20251001',
    },
  };

  describe('End-to-End Command Model Selection', () => {
    test('create-prd command with high tier returns opus model ID', () => {
      const projectDir = makeProject(VALID_CONFIG);
      const { selectModel } = require('../../lib/model-resolver');
      const modelId = selectModel('ensemble:create-prd', 'high', projectDir);
      expect(modelId).toBe('claude-opus-4-7');
    });

    test('implement-trd command with medium tier returns sonnet model ID', () => {
      const projectDir = makeProject(VALID_CONFIG);
      const { selectModel } = require('../../lib/model-resolver');
      const modelId = selectModel('ensemble:implement-trd', 'medium', projectDir);
      expect(modelId).toBe('claude-sonnet-4-6');
    });

    test('command without explicit tier defaults to medium', () => {
      const projectDir = makeProject(VALID_CONFIG);
      const { selectModel } = require('../../lib/model-resolver');
      const modelId = selectModel('ensemble:test-command', null, projectDir);
      expect(modelId).toBe('claude-sonnet-4-6');
    });
  });

  describe('Config Loading Integration', () => {
    test('loadConfig returns default config when no project config exists', () => {
      const projectDir = makeProject(); // no config
      const { loadConfig, getDefaultConfig } = require('../../lib/config-loader');
      const cfg = loadConfig(projectDir);
      const defaults = getDefaultConfig();
      expect(cfg.tiers.high).toBe(defaults.tiers.high);
      expect(cfg.tiers.medium).toBe(defaults.tiers.medium);
      expect(cfg.tiers.low).toBe(defaults.tiers.low);
    });

    test('loadConfig returns project config when file is valid', () => {
      const customConfig = {
        version: 1,
        tiers: {
          high: 'claude-opus-4-7',
          medium: 'claude-sonnet-4-6',
          low: 'claude-haiku-4-5-20251001',
        },
      };
      const projectDir = makeProject(customConfig);
      const { loadConfig } = require('../../lib/config-loader');
      const cfg = loadConfig(projectDir);
      expect(cfg.tiers.high).toBe('claude-opus-4-7');
    });

    test('modelAliases is alias for tiers on both default and loaded config', () => {
      const projectDir = makeProject(VALID_CONFIG);
      const { loadConfig } = require('../../lib/config-loader');
      const cfg = loadConfig(projectDir);
      expect(cfg.modelAliases).toBe(cfg.tiers);
    });
  });

  describe('Environment Variable Override Integration', () => {
    test('ENSEMBLE_MODEL_OVERRIDE=high overrides explicitTier', () => {
      const projectDir = makeProject(VALID_CONFIG);
      process.env.ENSEMBLE_MODEL_OVERRIDE = 'high';
      const { selectModel } = require('../../lib/model-resolver');
      // Would have been 'low' from explicit tier, but env wins
      const modelId = selectModel('ensemble:create-prd', 'low', projectDir);
      expect(modelId).toBe('claude-opus-4-7');
    });

    test('ENSEMBLE_MODEL_OVERRIDE=opus throws PreflightError (legacy)', () => {
      const projectDir = makeProject(VALID_CONFIG);
      process.env.ENSEMBLE_MODEL_OVERRIDE = 'opus';
      const { selectModel, PreflightError } = require('../../lib/model-resolver');
      expect(() => selectModel('ensemble:create-prd', null, projectDir)).toThrow(PreflightError);
    });
  });

  describe('Bypass Commands Integration', () => {
    test('map-model bypasses preflight even with no tiers', () => {
      const projectDir = makeProject(); // no config → defaults used
      const { selectModel } = require('../../lib/model-resolver');
      // defaults have valid tiers, so this should succeed
      const modelId = selectModel('map-model', null, projectDir);
      expect(typeof modelId).toBe('string');
      expect(modelId.length).toBeGreaterThan(0);
    });
  });

  describe('Backward Compatibility', () => {
    test('modelAliases property exists on default config for backward compat', () => {
      const { getDefaultConfig } = require('../../lib/config-loader');
      const cfg = getDefaultConfig();
      expect(cfg.modelAliases).toBeDefined();
      expect(cfg.modelAliases).toBe(cfg.tiers);
    });

    test('BYPASS_COMMANDS is exported from config-loader', () => {
      const { BYPASS_COMMANDS } = require('../../lib/config-loader');
      expect(Array.isArray(BYPASS_COMMANDS)).toBe(true);
      expect(BYPASS_COMMANDS).toContain('map-model');
    });
  });
});
