/**
 * Unit tests for usage-logger.js
 *
 * Updated for Phase 4 (TRD-2026-021):
 * - MODEL_PRICING uses current model IDs (claude-opus-4-7, claude-sonnet-4-6, claude-haiku-4-5-20251001)
 * - getLogPath() is hardcoded — no config param
 * - logUsage() always logs (no costTracking.enabled guard)
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  logUsage,
  generateSummary,
  getLogPath,
  calculateCost,
  MODEL_PRICING
} = require('../lib/usage-logger');

// Mock fs and os modules
jest.mock('fs');
jest.mock('os');

describe('Usage Logger', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('MODEL_PRICING', () => {
    test('contains current model IDs', () => {
      expect(MODEL_PRICING).toHaveProperty('claude-opus-4-7');
      expect(MODEL_PRICING).toHaveProperty('claude-sonnet-4-6');
      expect(MODEL_PRICING).toHaveProperty('claude-haiku-4-5-20251001');
    });

    test('does not contain retired model IDs', () => {
      expect(MODEL_PRICING).not.toHaveProperty('claude-opus-4-6-20251101');
      expect(MODEL_PRICING).not.toHaveProperty('claude-sonnet-4-20250514');
      expect(MODEL_PRICING).not.toHaveProperty('claude-3-5-haiku-20241022');
    });

    test('opus pricing is $15 input / $75 output per million tokens', () => {
      expect(MODEL_PRICING['claude-opus-4-7'].input).toBe(15.00);
      expect(MODEL_PRICING['claude-opus-4-7'].output).toBe(75.00);
    });

    test('sonnet pricing is $3 input / $15 output per million tokens', () => {
      expect(MODEL_PRICING['claude-sonnet-4-6'].input).toBe(3.00);
      expect(MODEL_PRICING['claude-sonnet-4-6'].output).toBe(15.00);
    });

    test('haiku pricing is $0.80 input / $4 output per million tokens', () => {
      expect(MODEL_PRICING['claude-haiku-4-5-20251001'].input).toBe(0.80);
      expect(MODEL_PRICING['claude-haiku-4-5-20251001'].output).toBe(4.00);
    });
  });

  describe('getLogPath', () => {
    test('uses XDG_CONFIG_HOME when set', () => {
      const originalEnv = process.env.XDG_CONFIG_HOME;
      process.env.XDG_CONFIG_HOME = '/custom/xdg';

      const logPath = getLogPath();

      expect(logPath).toBe('/custom/xdg/ensemble/logs/model-usage.jsonl');

      if (originalEnv === undefined) {
        delete process.env.XDG_CONFIG_HOME;
      } else {
        process.env.XDG_CONFIG_HOME = originalEnv;
      }
    });

    test('falls back to ~/.config when XDG_CONFIG_HOME is not set', () => {
      const originalEnv = process.env.XDG_CONFIG_HOME;
      delete process.env.XDG_CONFIG_HOME;
      os.homedir.mockReturnValue('/home/user');

      const logPath = getLogPath();

      expect(logPath).toBe('/home/user/.config/ensemble/logs/model-usage.jsonl');

      if (originalEnv !== undefined) {
        process.env.XDG_CONFIG_HOME = originalEnv;
      }
    });

    test('accepts no arguments (hardcoded path)', () => {
      os.homedir.mockReturnValue('/home/user');
      // Should not throw when called with no args
      expect(() => getLogPath()).not.toThrow();
    });
  });

  describe('calculateCost', () => {
    test('calculates cost for Opus (claude-opus-4-7)', () => {
      const cost = calculateCost('claude-opus-4-7', 1_000_000, 1_000_000);

      expect(cost).toBe(90.0); // $15 input + $75 output
    });

    test('calculates cost for Sonnet (claude-sonnet-4-6)', () => {
      const cost = calculateCost('claude-sonnet-4-6', 1_000_000, 1_000_000);

      expect(cost).toBe(18.0); // $3 input + $15 output
    });

    test('calculates cost for Haiku (claude-haiku-4-5-20251001)', () => {
      const cost = calculateCost('claude-haiku-4-5-20251001', 1_000_000, 1_000_000);

      expect(cost).toBe(4.8); // $0.80 input + $4 output
    });

    test('calculates fractional token costs', () => {
      const cost = calculateCost('claude-sonnet-4-6', 45000, 6000);

      expect(cost).toBeCloseTo(0.225, 3); // (45k / 1M) * 3 + (6k / 1M) * 15
    });

    test('returns 0 for unknown model', () => {
      const cost = calculateCost('unknown-model', 1_000_000, 1_000_000);

      expect(cost).toBe(0);
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('No pricing data')
      );
    });
  });

  describe('logUsage', () => {
    test('always writes log entry (no enabled guard)', () => {
      os.homedir.mockReturnValue('/home/user');
      fs.existsSync.mockReturnValue(false);
      fs.statSync.mockImplementation(() => {
        throw new Error('File not found');
      });

      const params = {
        command: 'ensemble:create-prd',
        model: 'claude-opus-4-7',
        modelAlias: 'high',
        inputTokens: 45000,
        outputTokens: 6000,
        durationMs: 12000,
        success: true
      };

      logUsage(params);

      expect(fs.appendFileSync).toHaveBeenCalled();
      const logLine = fs.appendFileSync.mock.calls[0][1];
      const entry = JSON.parse(logLine);

      expect(entry.command).toBe('ensemble:create-prd');
      expect(entry.model).toBe('claude-opus-4-7');
      expect(entry.model_alias).toBe('high');
      expect(entry.input_tokens).toBe(45000);
      expect(entry.output_tokens).toBe(6000);
      expect(entry.cost_usd).toBeCloseTo(1.125, 3);
      expect(entry.duration_ms).toBe(12000);
      expect(entry.success).toBe(true);
    });

    test('logs even when called without config argument', () => {
      os.homedir.mockReturnValue('/home/user');
      fs.statSync.mockImplementation(() => {
        throw new Error('File not found');
      });

      const params = {
        command: 'test',
        model: 'claude-sonnet-4-6',
        modelAlias: 'medium',
        inputTokens: 1000,
        outputTokens: 500
      };

      // Call with no config — should still log
      logUsage(params);

      expect(fs.appendFileSync).toHaveBeenCalled();
    });

    test('logs even when called with legacy config object (backward compat)', () => {
      os.homedir.mockReturnValue('/home/user');
      fs.statSync.mockImplementation(() => {
        throw new Error('File not found');
      });

      const params = {
        command: 'test',
        model: 'claude-sonnet-4-6',
        modelAlias: 'medium',
        inputTokens: 1000,
        outputTokens: 500
      };

      // Pass legacy config — should be ignored but not throw
      logUsage(params, { costTracking: { enabled: false } });

      expect(fs.appendFileSync).toHaveBeenCalled();
    });

    test('handles missing token counts', () => {
      os.homedir.mockReturnValue('/home/user');
      fs.statSync.mockImplementation(() => {
        throw new Error('File not found');
      });

      const params = {
        command: 'test',
        model: 'claude-sonnet-4-6',
        modelAlias: 'medium'
      };

      logUsage(params);

      const logLine = fs.appendFileSync.mock.calls[0][1];
      const entry = JSON.parse(logLine);

      expect(entry.input_tokens).toBe(0);
      expect(entry.output_tokens).toBe(0);
      expect(entry.cost_usd).toBe(0);
    });

    test('logs error messages', () => {
      os.homedir.mockReturnValue('/home/user');
      fs.statSync.mockImplementation(() => {
        throw new Error('File not found');
      });

      const params = {
        command: 'test',
        model: 'claude-sonnet-4-6',
        modelAlias: 'medium',
        inputTokens: 1000,
        outputTokens: 500,
        success: false,
        error: 'Test error'
      };

      logUsage(params);

      const logLine = fs.appendFileSync.mock.calls[0][1];
      const entry = JSON.parse(logLine);

      expect(entry.success).toBe(false);
      expect(entry.error).toBe('Test error');
    });

    test('handles write failure gracefully', () => {
      os.homedir.mockReturnValue('/home/user');
      fs.statSync.mockImplementation(() => {
        throw new Error('File not found');
      });
      fs.appendFileSync.mockImplementation(() => {
        throw new Error('Disk full');
      });

      const params = {
        command: 'test',
        model: 'claude-sonnet-4-6',
        modelAlias: 'medium',
        inputTokens: 1000,
        outputTokens: 500
      };

      expect(() => logUsage(params)).not.toThrow();
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to write log')
      );
    });
  });

  describe('generateSummary', () => {
    test('generates summary from log file', () => {
      const logContent = [
        JSON.stringify({
          command: 'ensemble:create-prd',
          model_alias: 'high',
          cost_usd: 1.5,
          success: true
        }),
        JSON.stringify({
          command: 'ensemble:implement-trd',
          model_alias: 'medium',
          cost_usd: 0.8,
          success: true
        }),
        JSON.stringify({
          command: 'ensemble:create-prd',
          model_alias: 'high',
          cost_usd: 1.2,
          success: false
        })
      ].join('\n');

      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(logContent);

      const summary = generateSummary('/tmp/test.jsonl');

      expect(summary.totalCost).toBeCloseTo(3.5, 1);
      expect(summary.totalInvocations).toBe(3);
      expect(summary.errors).toBe(1);

      expect(summary.byCommand['ensemble:create-prd'].count).toBe(2);
      expect(summary.byCommand['ensemble:create-prd'].cost).toBeCloseTo(2.7, 1);

      expect(summary.byCommand['ensemble:implement-trd'].count).toBe(1);
      expect(summary.byCommand['ensemble:implement-trd'].cost).toBeCloseTo(0.8, 1);

      expect(summary.byModel['high'].count).toBe(2);
      expect(summary.byModel['medium'].count).toBe(1);
    });

    test('returns empty summary when file does not exist', () => {
      fs.existsSync.mockReturnValue(false);

      const summary = generateSummary('/tmp/nonexistent.jsonl');

      expect(summary.totalCost).toBe(0);
      expect(summary.totalInvocations).toBe(0);
      expect(summary.errors).toBe(0);
      expect(Object.keys(summary.byCommand)).toHaveLength(0);
      expect(Object.keys(summary.byModel)).toHaveLength(0);
    });

    test('skips invalid log lines', () => {
      const logContent = [
        JSON.stringify({ command: 'test', model_alias: 'medium', cost_usd: 1.0, success: true }),
        'invalid json line',
        JSON.stringify({ command: 'test2', model_alias: 'low', cost_usd: 0.5, success: true })
      ].join('\n');

      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(logContent);

      const summary = generateSummary('/tmp/test.jsonl');

      expect(summary.totalInvocations).toBe(2);
      expect(console.warn).toHaveBeenCalled();
    });
  });
});
