'use strict';

/**
 * Unit tests for model-resolver.js (tier-based model selection)
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

describe('model-resolver', () => {
  let tmpDir;
  let stderrSpy;
  let originalEnv;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ensemble-resolver-test-'));
    stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => {});
    originalEnv = { ...process.env };
    // Use isolated XDG to avoid touching real config
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

  function getResolver() {
    return require('../lib/model-resolver');
  }

  /**
   * Create a minimal valid project with a .git dir and
   * an optional ensemble-model-config.json.
   */
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

  const VALID_CONFIG_OBJ = {
    version: 1,
    tiers: {
      high: 'claude-opus-4-7',
      medium: 'claude-sonnet-4-6',
      low: 'claude-haiku-4-5-20251001',
    },
  };

  // ---------------------------------------------------------------------------
  // preflightValidate
  // ---------------------------------------------------------------------------
  describe('preflightValidate', () => {
    test('bypass for map-model command — no error even with empty config', () => {
      const { preflightValidate } = getResolver();
      const emptyConfig = { tiers: {}, extraKnownModelIds: [] };
      expect(() => preflightValidate(emptyConfig, 'map-model')).not.toThrow();
    });

    test('bypass for migrate-model-config command', () => {
      const { preflightValidate } = getResolver();
      const emptyConfig = { tiers: {}, extraKnownModelIds: [] };
      expect(() => preflightValidate(emptyConfig, 'migrate-model-config')).not.toThrow();
    });

    test('passes with valid KNOWN_MODEL_IDS in all tiers', () => {
      const { preflightValidate } = getResolver();
      const config = {
        tiers: {
          high: 'claude-opus-4-7',
          medium: 'claude-sonnet-4-6',
          low: 'claude-haiku-4-5-20251001',
        },
        extraKnownModelIds: [],
      };
      expect(() => preflightValidate(config, 'ensemble:create-prd')).not.toThrow();
    });

    test('throws PreflightError for invalid model ID in high tier', () => {
      const { preflightValidate, PreflightError } = getResolver();
      const config = {
        tiers: {
          high: 'claude-unknown-model',
          medium: 'claude-sonnet-4-6',
          low: 'claude-haiku-4-5-20251001',
        },
        extraKnownModelIds: [],
      };
      expect(() => preflightValidate(config, 'ensemble:create-prd'))
        .toThrow(PreflightError);
    });

    test('throws PreflightError for missing tier', () => {
      const { preflightValidate, PreflightError } = getResolver();
      const config = {
        tiers: {
          high: 'claude-opus-4-7',
          medium: 'claude-sonnet-4-6',
          // low missing
        },
        extraKnownModelIds: [],
      };
      expect(() => preflightValidate(config, 'ensemble:create-prd'))
        .toThrow(PreflightError);
    });

    test('passes when model ID is in extraKnownModelIds', () => {
      const { preflightValidate } = getResolver();
      const config = {
        tiers: {
          high: 'claude-opus-5-preview',
          medium: 'claude-sonnet-4-6',
          low: 'claude-haiku-4-5-20251001',
        },
        extraKnownModelIds: ['claude-opus-5-preview'],
      };
      expect(() => preflightValidate(config, 'ensemble:create-prd')).not.toThrow();
    });

    test('PreflightError message mentions /ensemble:map-model', () => {
      const { preflightValidate, PreflightError } = getResolver();
      const config = {
        tiers: {
          high: 'claude-bad-model',
          medium: 'claude-sonnet-4-6',
          low: 'claude-haiku-4-5-20251001',
        },
        extraKnownModelIds: [],
      };
      let err;
      try {
        preflightValidate(config, 'any-command');
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(PreflightError);
      expect(err.message).toContain('map-model');
    });
  });

  // ---------------------------------------------------------------------------
  // resolveModel
  // ---------------------------------------------------------------------------
  describe('resolveModel', () => {
    test('returns model ID for valid tier', () => {
      const { resolveModel } = getResolver();
      const config = {
        tiers: {
          high: 'claude-opus-4-7',
          medium: 'claude-sonnet-4-6',
          low: 'claude-haiku-4-5-20251001',
        },
      };
      expect(resolveModel('high', config)).toBe('claude-opus-4-7');
      expect(resolveModel('medium', config)).toBe('claude-sonnet-4-6');
      expect(resolveModel('low', config)).toBe('claude-haiku-4-5-20251001');
    });

    test('throws TypeError for unknown tier', () => {
      const { resolveModel } = getResolver();
      const config = { tiers: { high: 'x', medium: 'y', low: 'z' } };
      expect(() => resolveModel('opus', config)).toThrow(TypeError);
      expect(() => resolveModel('unknown', config)).toThrow(TypeError);
    });
  });

  // ---------------------------------------------------------------------------
  // selectModel
  // ---------------------------------------------------------------------------
  describe('selectModel', () => {
    test('ENSEMBLE_MODEL_OVERRIDE=high uses high tier', () => {
      const projectDir = makeProject(VALID_CONFIG_OBJ);
      process.env.ENSEMBLE_MODEL_OVERRIDE = 'high';
      const { selectModel } = getResolver();
      const result = selectModel('ensemble:create-prd', null, projectDir);
      expect(result).toBe('claude-opus-4-7');
    });

    test('ENSEMBLE_MODEL_OVERRIDE=medium uses medium tier', () => {
      const projectDir = makeProject(VALID_CONFIG_OBJ);
      process.env.ENSEMBLE_MODEL_OVERRIDE = 'medium';
      const { selectModel } = getResolver();
      const result = selectModel('ensemble:create-prd', null, projectDir);
      expect(result).toBe('claude-sonnet-4-6');
    });

    test('ENSEMBLE_MODEL_OVERRIDE=low uses low tier', () => {
      const projectDir = makeProject(VALID_CONFIG_OBJ);
      process.env.ENSEMBLE_MODEL_OVERRIDE = 'low';
      const { selectModel } = getResolver();
      const result = selectModel('ensemble:create-prd', null, projectDir);
      expect(result).toBe('claude-haiku-4-5-20251001');
    });

    test('ENSEMBLE_MODEL_OVERRIDE=opus throws PreflightError (legacy alias)', () => {
      const projectDir = makeProject(VALID_CONFIG_OBJ);
      process.env.ENSEMBLE_MODEL_OVERRIDE = 'opus';
      const { selectModel, PreflightError } = getResolver();
      expect(() => selectModel('ensemble:create-prd', null, projectDir)).toThrow(PreflightError);
    });

    test('ENSEMBLE_MODEL_OVERRIDE=sonnet throws PreflightError (legacy alias)', () => {
      const projectDir = makeProject(VALID_CONFIG_OBJ);
      process.env.ENSEMBLE_MODEL_OVERRIDE = 'sonnet';
      const { selectModel, PreflightError } = getResolver();
      expect(() => selectModel('ensemble:create-prd', null, projectDir)).toThrow(PreflightError);
    });

    test('ENSEMBLE_MODEL_OVERRIDE=haiku throws PreflightError (legacy alias)', () => {
      const projectDir = makeProject(VALID_CONFIG_OBJ);
      process.env.ENSEMBLE_MODEL_OVERRIDE = 'haiku';
      const { selectModel, PreflightError } = getResolver();
      expect(() => selectModel('ensemble:create-prd', null, projectDir)).toThrow(PreflightError);
    });

    test('ENSEMBLE_MODEL_OVERRIDE=claude-opus-4-7 (raw model ID) throws PreflightError', () => {
      const projectDir = makeProject(VALID_CONFIG_OBJ);
      process.env.ENSEMBLE_MODEL_OVERRIDE = 'claude-opus-4-7';
      const { selectModel, PreflightError } = getResolver();
      expect(() => selectModel('ensemble:create-prd', null, projectDir)).toThrow(PreflightError);
    });

    test('no override uses explicitTier', () => {
      const projectDir = makeProject(VALID_CONFIG_OBJ);
      delete process.env.ENSEMBLE_MODEL_OVERRIDE;
      const { selectModel } = getResolver();
      const result = selectModel('ensemble:create-prd', 'low', projectDir);
      expect(result).toBe('claude-haiku-4-5-20251001');
    });

    test('no override no explicitTier defaults to medium', () => {
      const projectDir = makeProject(VALID_CONFIG_OBJ);
      delete process.env.ENSEMBLE_MODEL_OVERRIDE;
      const { selectModel } = getResolver();
      const result = selectModel('ensemble:create-prd', null, projectDir);
      expect(result).toBe('claude-sonnet-4-6');
    });

    test('PreflightError for legacy env override has helpful message', () => {
      const projectDir = makeProject(VALID_CONFIG_OBJ);
      process.env.ENSEMBLE_MODEL_OVERRIDE = 'opus';
      const { selectModel, PreflightError } = getResolver();
      let err;
      try {
        selectModel('ensemble:create-prd', null, projectDir);
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(PreflightError);
      expect(err.message).toContain('opus');
      expect(err.message).toMatch(/high|medium|low/);
    });
  });

  // ---------------------------------------------------------------------------
  // TIER_ALIASES and LEGACY_ALIASES exports
  // ---------------------------------------------------------------------------
  describe('exports', () => {
    test('TIER_ALIASES contains high, medium, low', () => {
      const { TIER_ALIASES } = getResolver();
      expect(TIER_ALIASES).toEqual(expect.arrayContaining(['high', 'medium', 'low']));
    });

    test('LEGACY_ALIASES contains opus, sonnet, haiku', () => {
      const { LEGACY_ALIASES } = getResolver();
      expect(LEGACY_ALIASES).toEqual(expect.arrayContaining(['opus', 'sonnet', 'haiku']));
    });
  });
});
