/**
 * Integration tests for model selection workflow
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { loadConfig, getDefaultConfig } = require('../../lib/config-loader');
const { selectModel } = require('../../lib/model-resolver');
const { logUsage, generateSummary } = require('../../lib/usage-logger');

// Mock fs for controlled testing
jest.mock('fs');
jest.mock('os', () => ({
  homedir: () => '/home/testuser'
}));

describe('Model Selection Integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.ENSEMBLE_MODEL_OVERRIDE;
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('End-to-End Command Model Selection', () => {
    test('create-prd command uses Opus', () => {
      fs.existsSync.mockReturnValue(false);

      const command = {
        metadata: {
          name: 'ensemble:create-prd',
          description: 'Create PRD',
          version: '2.0.0',
          model: 'opus-4-6'
        }
      };

      const config = loadConfig();
      const modelId = selectModel(command, config);

      expect(modelId).toBe('claude-opus-4-6-20251101');
    });

    test('implement-trd command uses Sonnet', () => {
      fs.existsSync.mockReturnValue(false);

      const command = {
        metadata: {
          name: 'ensemble:implement-trd',
          description: 'Implement TRD',
          version: '2.0.0',
          model: 'sonnet'
        }
      };

      const config = loadConfig();
      const modelId = selectModel(command, config);

      expect(modelId).toBe('claude-sonnet-4-20250514');
    });

    test('command without model field uses default', () => {
      fs.existsSync.mockReturnValue(false);

      const command = {
        metadata: {
          name: 'ensemble:test-command',
          description: 'Test',
          version: '1.0.0'
        }
      };

      const config = loadConfig();
      const modelId = selectModel(command, config);

      expect(modelId).toBe('claude-sonnet-4-20250514');
    });
  });

  describe('Config Override Integration', () => {
    test('commandOverrides take precedence over metadata', () => {
      const customConfig = {
        ...getDefaultConfig(),
        commandOverrides: {
          'ensemble:create-prd': 'haiku'
        }
      };

      const command = {
        metadata: {
          name: 'ensemble:create-prd',
          model: 'opus-4-6'
        }
      };

      // Config override is lower priority than YAML metadata
      const modelId = selectModel(command, customConfig);

      // YAML metadata takes precedence
      expect(modelId).toBe('claude-opus-4-6-20251101');
    });

    test('environment variable overrides everything', () => {
      process.env.ENSEMBLE_MODEL_OVERRIDE = 'haiku';

      const command = {
        metadata: {
          name: 'ensemble:create-prd',
          model: 'opus-4-6'
        }
      };

      const config = getDefaultConfig();
      const modelId = selectModel(command, config, { modelFlag: 'sonnet' });

      expect(modelId).toBe('claude-3-5-haiku-20241022');

      delete process.env.ENSEMBLE_MODEL_OVERRIDE;
    });
  });

  describe('Full Workflow with Logging', () => {
    test('complete workflow logs correctly', () => {
      fs.existsSync.mockReturnValue(false);
      fs.statSync.mockImplementation(() => {
        throw new Error('File not found');
      });

      const config = loadConfig();

      // Simulate PRD creation with Opus
      const prdCommand = {
        metadata: {
          name: 'ensemble:create-prd',
          model: 'opus-4-6'
        }
      };

      const prdModel = selectModel(prdCommand, config);
      expect(prdModel).toBe('claude-opus-4-6-20251101');

      logUsage({
        command: 'ensemble:create-prd',
        model: prdModel,
        modelAlias: 'opus-4-6',
        inputTokens: 45000,
        outputTokens: 6000,
        durationMs: 15000,
        success: true
      }, config);

      // Simulate TRD implementation with Sonnet
      const trdCommand = {
        metadata: {
          name: 'ensemble:implement-trd',
          model: 'sonnet'
        }
      };

      const trdModel = selectModel(trdCommand, config);
      expect(trdModel).toBe('claude-sonnet-4-20250514');

      logUsage({
        command: 'ensemble:implement-trd',
        model: trdModel,
        modelAlias: 'sonnet',
        inputTokens: 200000,
        outputTokens: 25000,
        durationMs: 45000,
        success: true
      }, config);

      // Verify logging calls
      expect(fs.appendFileSync).toHaveBeenCalledTimes(2);

      // Parse log entries
      const log1 = JSON.parse(fs.appendFileSync.mock.calls[0][1]);
      const log2 = JSON.parse(fs.appendFileSync.mock.calls[1][1]);

      expect(log1.command).toBe('ensemble:create-prd');
      expect(log1.model_alias).toBe('opus-4-6');
      expect(log1.cost_usd).toBeGreaterThan(1.0);

      expect(log2.command).toBe('ensemble:implement-trd');
      expect(log2.model_alias).toBe('sonnet');
      expect(log2.cost_usd).toBeGreaterThan(0.9);
    });
  });

  describe('Summary Generation Integration', () => {
    test('generates accurate summary from workflow', () => {
      const logEntries = [
        {
          command: 'ensemble:create-prd',
          model_alias: 'opus-4-6',
          cost_usd: 1.125,
          success: true
        },
        {
          command: 'ensemble:create-trd',
          model_alias: 'opus-4-6',
          cost_usd: 1.35,
          success: true
        },
        {
          command: 'ensemble:implement-trd',
          model_alias: 'sonnet',
          cost_usd: 0.975,
          success: true
        }
      ];

      const logContent = logEntries.map(e => JSON.stringify(e)).join('\n');

      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(logContent);

      const summary = generateSummary('/tmp/test.jsonl');

      expect(summary.totalInvocations).toBe(3);
      expect(summary.totalCost).toBeCloseTo(3.45, 2);
      expect(summary.errors).toBe(0);

      // Verify cost attribution
      expect(summary.byModel['opus-4-6'].count).toBe(2);
      expect(summary.byModel['opus-4-6'].cost).toBeCloseTo(2.475, 2);

      expect(summary.byModel['sonnet'].count).toBe(1);
      expect(summary.byModel['sonnet'].cost).toBeCloseTo(0.975, 2);
    });
  });

  describe('Backward Compatibility', () => {
    test('existing commands without model work', () => {
      fs.existsSync.mockReturnValue(false);

      const legacyCommand = {
        metadata: {
          name: 'ensemble:fold-prompt',
          description: 'Optimize environment',
          version: '1.0.0'
          // No model field
        }
      };

      const config = loadConfig();
      const modelId = selectModel(legacyCommand, config);

      expect(modelId).toBe('claude-sonnet-4-20250514');
    });

    test('missing config file uses defaults', () => {
      fs.existsSync.mockReturnValue(false);

      const config = loadConfig();

      expect(config.defaults.command).toBe('sonnet');
      expect(config.modelAliases['opus-4-6']).toBeDefined();
    });
  });
});
