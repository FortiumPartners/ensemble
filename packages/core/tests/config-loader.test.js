/**
 * Unit tests for config-loader.js
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  loadConfig,
  getConfigPaths,
  getDefaultConfig,
  validateConfig,
  resolveModelAlias
} = require('../lib/config-loader');

// Mock fs and os modules
jest.mock('fs');
jest.mock('os');

describe('Config Loader', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('getConfigPaths', () => {
    test('returns XDG_CONFIG_HOME path first', () => {
      process.env.XDG_CONFIG_HOME = '/custom/config';
      os.homedir.mockReturnValue('/home/user');

      const paths = getConfigPaths();

      expect(paths[0]).toBe('/custom/config/ensemble/model-selection.json');
      expect(paths[1]).toBe('/home/user/.ensemble/model-selection.json');

      delete process.env.XDG_CONFIG_HOME;
    });

    test('uses ~/.config when XDG_CONFIG_HOME not set', () => {
      delete process.env.XDG_CONFIG_HOME;
      os.homedir.mockReturnValue('/home/user');

      const paths = getConfigPaths();

      expect(paths[0]).toBe('/home/user/.config/ensemble/model-selection.json');
      expect(paths[1]).toBe('/home/user/.ensemble/model-selection.json');
    });
  });

  describe('getDefaultConfig', () => {
    test('returns valid default configuration', () => {
      const config = getDefaultConfig();

      expect(config.version).toBe('1.0.0');
      expect(config.defaults.command).toBe('sonnet');
      expect(config.modelAliases['opus-4-6']).toBe('claude-opus-4-6-20251101');
      expect(config.modelAliases['sonnet']).toBe('claude-sonnet-4-20250514');
      expect(config.modelAliases['haiku']).toBe('claude-3-5-haiku-20241022');
      expect(config.costTracking.enabled).toBe(true);
    });

    test('includes command overrides', () => {
      const config = getDefaultConfig();

      expect(config.commandOverrides['ensemble:create-prd']).toBe('opus-4-6');
      expect(config.commandOverrides['ensemble:create-trd']).toBe('opus-4-6');
    });
  });

  describe('validateConfig', () => {
    test('validates correct config', () => {
      const config = getDefaultConfig();
      expect(() => validateConfig(config)).not.toThrow();
    });

    test('throws on missing version', () => {
      const config = { defaults: {}, modelAliases: {} };
      expect(() => validateConfig(config)).toThrow('missing version field');
    });

    test('throws on missing defaults', () => {
      const config = { version: '1.0.0', modelAliases: {} };
      expect(() => validateConfig(config)).toThrow('missing defaults field');
    });

    test('throws on missing modelAliases', () => {
      const config = { version: '1.0.0', defaults: {} };
      expect(() => validateConfig(config)).toThrow('missing modelAliases field');
    });

    test('throws on missing defaults.command', () => {
      const config = {
        version: '1.0.0',
        defaults: {},
        modelAliases: { sonnet: 'claude-sonnet-4-20250514' }
      };
      expect(() => validateConfig(config)).toThrow('missing defaults.command field');
    });
  });

  describe('loadConfig', () => {
    test('loads config from XDG_CONFIG_HOME', () => {
      process.env.XDG_CONFIG_HOME = '/custom/config';
      os.homedir.mockReturnValue('/home/user');

      const mockConfig = {
        version: '1.0.0',
        defaults: { command: 'opus' },
        modelAliases: { opus: 'claude-opus-4-6-20251101' }
      };

      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(JSON.stringify(mockConfig));

      const config = loadConfig();

      expect(config.defaults.command).toBe('opus');
      expect(fs.readFileSync).toHaveBeenCalledWith(
        '/custom/config/ensemble/model-selection.json',
        'utf-8'
      );

      delete process.env.XDG_CONFIG_HOME;
    });

    test('falls back to default config when no file found', () => {
      os.homedir.mockReturnValue('/home/user');
      fs.existsSync.mockReturnValue(false);

      const config = loadConfig();

      expect(config.defaults.command).toBe('sonnet');
      expect(config.version).toBe('1.0.0');
    });

    test('falls back to default on JSON parse error', () => {
      os.homedir.mockReturnValue('/home/user');
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue('invalid json');

      const config = loadConfig();

      expect(config.defaults.command).toBe('sonnet');
      expect(console.error).toHaveBeenCalled();
    });

    test('falls back to default on validation error', () => {
      os.homedir.mockReturnValue('/home/user');
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(JSON.stringify({ version: '1.0.0' }));

      const config = loadConfig();

      expect(config.defaults.command).toBe('sonnet');
      expect(console.error).toHaveBeenCalled();
    });
  });

  describe('resolveModelAlias', () => {
    test('resolves opus-4-6 alias', () => {
      const config = getDefaultConfig();
      const modelId = resolveModelAlias('opus-4-6', config);

      expect(modelId).toBe('claude-opus-4-6-20251101');
    });

    test('resolves sonnet alias', () => {
      const config = getDefaultConfig();
      const modelId = resolveModelAlias('sonnet', config);

      expect(modelId).toBe('claude-sonnet-4-20250514');
    });

    test('resolves haiku alias', () => {
      const config = getDefaultConfig();
      const modelId = resolveModelAlias('haiku', config);

      expect(modelId).toBe('claude-3-5-haiku-20241022');
    });

    test('falls back to sonnet on unknown alias', () => {
      const config = getDefaultConfig();
      const modelId = resolveModelAlias('unknown', config);

      expect(modelId).toBe('claude-sonnet-4-20250514');
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('Unknown model alias')
      );
    });

    test('warns with list of valid aliases', () => {
      const config = getDefaultConfig();
      resolveModelAlias('invalid', config);

      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('Valid aliases: opus-4-6, opus, sonnet-4, sonnet, haiku')
      );
    });
  });
});
