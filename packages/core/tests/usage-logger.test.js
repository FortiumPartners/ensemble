/**
 * Unit tests for usage-logger.js
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
const { getDefaultConfig } = require('../lib/config-loader');

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

  describe('getLogPath', () => {
    test('uses config logPath', () => {
      const config = {
        costTracking: {
          enabled: true,
          logPath: '/custom/path/logs.jsonl'
        }
      };

      const logPath = getLogPath(config);

      expect(logPath).toBe('/custom/path/logs.jsonl');
    });

    test('expands tilde in logPath', () => {
      os.homedir.mockReturnValue('/home/user');

      const config = {
        costTracking: {
          enabled: true,
          logPath: '~/logs/model-usage.jsonl'
        }
      };

      const logPath = getLogPath(config);

      expect(logPath).toBe('/home/user/logs/model-usage.jsonl');
    });

    test('uses default path when not specified', () => {
      os.homedir.mockReturnValue('/home/user');

      const config = {
        costTracking: { enabled: true }
      };

      const logPath = getLogPath(config);

      expect(logPath).toBe('/home/user/.config/ensemble/logs/model-usage.jsonl');
    });
  });

  describe('calculateCost', () => {
    test('calculates cost for Opus', () => {
      const cost = calculateCost('claude-opus-4-6-20251101', 1_000_000, 1_000_000);

      expect(cost).toBe(90.0); // $15 input + $75 output
    });

    test('calculates cost for Sonnet', () => {
      const cost = calculateCost('claude-sonnet-4-20250514', 1_000_000, 1_000_000);

      expect(cost).toBe(18.0); // $3 input + $15 output
    });

    test('calculates cost for Haiku', () => {
      const cost = calculateCost('claude-3-5-haiku-20241022', 1_000_000, 1_000_000);

      expect(cost).toBe(4.8); // $0.80 input + $4 output
    });

    test('calculates fractional token costs', () => {
      const cost = calculateCost('claude-sonnet-4-20250514', 45000, 6000);

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
    test('writes log entry when enabled', () => {
      os.homedir.mockReturnValue('/home/user');
      fs.existsSync.mockReturnValue(false);
      fs.statSync.mockImplementation(() => {
        throw new Error('File not found');
      });

      const config = getDefaultConfig();
      const params = {
        command: 'ensemble:create-prd',
        model: 'claude-opus-4-6-20251101',
        modelAlias: 'opus-4-6',
        inputTokens: 45000,
        outputTokens: 6000,
        durationMs: 12000,
        success: true
      };

      logUsage(params, config);

      expect(fs.appendFileSync).toHaveBeenCalled();
      const logLine = fs.appendFileSync.mock.calls[0][1];
      const entry = JSON.parse(logLine);

      expect(entry.command).toBe('ensemble:create-prd');
      expect(entry.model).toBe('claude-opus-4-6-20251101');
      expect(entry.model_alias).toBe('opus-4-6');
      expect(entry.input_tokens).toBe(45000);
      expect(entry.output_tokens).toBe(6000);
      expect(entry.cost_usd).toBeCloseTo(1.125, 3);
      expect(entry.duration_ms).toBe(12000);
      expect(entry.success).toBe(true);
    });

    test('does not log when disabled', () => {
      const config = {
        costTracking: { enabled: false }
      };

      const params = {
        command: 'test',
        model: 'claude-sonnet-4-20250514',
        modelAlias: 'sonnet',
        inputTokens: 1000,
        outputTokens: 500
      };

      logUsage(params, config);

      expect(fs.appendFileSync).not.toHaveBeenCalled();
    });

    test('handles missing token counts', () => {
      os.homedir.mockReturnValue('/home/user');
      fs.statSync.mockImplementation(() => {
        throw new Error('File not found');
      });

      const config = getDefaultConfig();
      const params = {
        command: 'test',
        model: 'claude-sonnet-4-20250514',
        modelAlias: 'sonnet'
      };

      logUsage(params, config);

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

      const config = getDefaultConfig();
      const params = {
        command: 'test',
        model: 'claude-sonnet-4-20250514',
        modelAlias: 'sonnet',
        inputTokens: 1000,
        outputTokens: 500,
        success: false,
        error: 'Test error'
      };

      logUsage(params, config);

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

      const config = getDefaultConfig();
      const params = {
        command: 'test',
        model: 'claude-sonnet-4-20250514',
        modelAlias: 'sonnet',
        inputTokens: 1000,
        outputTokens: 500
      };

      expect(() => logUsage(params, config)).not.toThrow();
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
          model_alias: 'opus-4-6',
          cost_usd: 1.5,
          success: true
        }),
        JSON.stringify({
          command: 'ensemble:implement-trd',
          model_alias: 'sonnet',
          cost_usd: 0.8,
          success: true
        }),
        JSON.stringify({
          command: 'ensemble:create-prd',
          model_alias: 'opus-4-6',
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

      expect(summary.byModel['opus-4-6'].count).toBe(2);
      expect(summary.byModel['sonnet'].count).toBe(1);
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
        JSON.stringify({ command: 'test', model_alias: 'sonnet', cost_usd: 1.0, success: true }),
        'invalid json line',
        JSON.stringify({ command: 'test2', model_alias: 'haiku', cost_usd: 0.5, success: true })
      ].join('\n');

      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(logContent);

      const summary = generateSummary('/tmp/test.jsonl');

      expect(summary.totalInvocations).toBe(2);
      expect(console.warn).toHaveBeenCalled();
    });
  });
});
