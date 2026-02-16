/**
 * Unit tests for model-resolver.js
 */

const {
  selectModel,
  extractModelPreference,
  getModelAlias
} = require('../lib/model-resolver');
const { getDefaultConfig } = require('../lib/config-loader');

describe('Model Resolver', () => {
  let config;

  beforeEach(() => {
    config = getDefaultConfig();
    delete process.env.ENSEMBLE_MODEL_OVERRIDE;
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('selectModel', () => {
    test('uses environment variable override', () => {
      process.env.ENSEMBLE_MODEL_OVERRIDE = 'opus-4-6';

      const command = {
        metadata: { name: 'test', model: 'haiku' }
      };

      const modelId = selectModel(command, config);

      expect(modelId).toBe('claude-opus-4-6-20251101');
      delete process.env.ENSEMBLE_MODEL_OVERRIDE;
    });

    test('uses command-line flag override', () => {
      const command = {
        metadata: { name: 'test', model: 'haiku' }
      };

      const modelId = selectModel(command, config, { modelFlag: 'opus' });

      expect(modelId).toBe('claude-opus-4-6-20251101');
    });

    test('uses command YAML metadata', () => {
      const command = {
        metadata: { name: 'test', model: 'opus-4-6' }
      };

      const modelId = selectModel(command, config);

      expect(modelId).toBe('claude-opus-4-6-20251101');
    });

    test('uses config commandOverrides', () => {
      const command = {
        metadata: { name: 'ensemble:create-prd' }
      };

      const modelId = selectModel(command, config);

      expect(modelId).toBe('claude-opus-4-6-20251101');
    });

    test('uses config defaults.command', () => {
      const command = {
        metadata: { name: 'test' }
      };

      const modelId = selectModel(command, config);

      expect(modelId).toBe('claude-sonnet-4-20250514');
    });

    test('falls back to hardcoded default', () => {
      const command = {
        metadata: { name: 'test' }
      };

      const customConfig = {
        ...config,
        defaults: {},
        commandOverrides: {}
      };

      const modelId = selectModel(command, customConfig);

      expect(modelId).toBe('claude-sonnet-4-20250514');
    });

    test('priority order: env > flag > yaml', () => {
      process.env.ENSEMBLE_MODEL_OVERRIDE = 'haiku';

      const command = {
        metadata: { name: 'test', model: 'sonnet' }
      };

      const modelId = selectModel(command, config, { modelFlag: 'opus' });

      expect(modelId).toBe('claude-3-5-haiku-20241022');
      delete process.env.ENSEMBLE_MODEL_OVERRIDE;
    });

    test('handles command without metadata', () => {
      const command = {};

      const modelId = selectModel(command, config);

      expect(modelId).toBe('claude-sonnet-4-20250514');
    });
  });

  describe('extractModelPreference', () => {
    test('extracts model from metadata', () => {
      const command = {
        metadata: { name: 'test', model: 'opus-4-6' }
      };

      const model = extractModelPreference(command);

      expect(model).toBe('opus-4-6');
    });

    test('returns null when no model specified', () => {
      const command = {
        metadata: { name: 'test' }
      };

      const model = extractModelPreference(command);

      expect(model).toBeNull();
    });

    test('returns null when no metadata', () => {
      const command = {};

      const model = extractModelPreference(command);

      expect(model).toBeNull();
    });
  });

  describe('getModelAlias', () => {
    test('finds alias for opus model ID', () => {
      const alias = getModelAlias('claude-opus-4-6-20251101', config);

      expect(alias).toBe('opus-4-6');
    });

    test('finds alias for sonnet model ID', () => {
      const alias = getModelAlias('claude-sonnet-4-20250514', config);

      expect(alias).toBe('sonnet-4');
    });

    test('finds alias for haiku model ID', () => {
      const alias = getModelAlias('claude-3-5-haiku-20241022', config);

      expect(alias).toBe('haiku');
    });

    test('returns model ID when no alias found', () => {
      const alias = getModelAlias('claude-unknown-model', config);

      expect(alias).toBe('claude-unknown-model');
    });
  });
});
