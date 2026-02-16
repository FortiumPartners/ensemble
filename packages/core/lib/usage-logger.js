/**
 * Usage logger for model selection.
 *
 * Writes JSONL (line-delimited JSON) to XDG-compliant log directory.
 * Implements log rotation at 10MB file size.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// Pricing per million tokens (as of 2026-02-16)
const MODEL_PRICING = {
  'claude-opus-4-6-20251101': { input: 15.00, output: 75.00 },
  'claude-sonnet-4-20250514': { input: 3.00, output: 15.00 },
  'claude-3-5-haiku-20241022': { input: 0.80, output: 4.00 }
};

const MAX_LOG_SIZE = 10 * 1024 * 1024; // 10MB

/**
 * Get log file path from config.
 * @param {Object} config - Config object
 * @returns {string} Absolute log file path
 */
function getLogPath(config) {
  let logPath = config.costTracking?.logPath ||
                '~/.config/ensemble/logs/model-usage.jsonl';

  // Expand tilde
  if (logPath.startsWith('~/')) {
    logPath = path.join(os.homedir(), logPath.slice(2));
  }

  return logPath;
}

/**
 * Ensure log directory exists.
 * @param {string} logPath - Log file path
 */
function ensureLogDirectory(logPath) {
  const dir = path.dirname(logPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Rotate log file if it exceeds size limit.
 * @param {string} logPath - Log file path
 */
function rotateLogIfNeeded(logPath) {
  try {
    const stats = fs.statSync(logPath);
    if (stats.size >= MAX_LOG_SIZE) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const rotatedPath = `${logPath}.${timestamp}`;
      fs.renameSync(logPath, rotatedPath);
      console.error(`[MODEL-SELECTION] Rotated log to ${rotatedPath}`);
    }
  } catch (error) {
    // File doesn't exist yet, that's fine
  }
}

/**
 * Calculate cost for token usage.
 * @param {string} modelId - Full Claude model ID
 * @param {number} inputTokens - Input token count
 * @param {number} outputTokens - Output token count
 * @returns {number} Cost in USD
 */
function calculateCost(modelId, inputTokens, outputTokens) {
  const pricing = MODEL_PRICING[modelId];
  if (!pricing) {
    console.warn(`[MODEL-SELECTION] No pricing data for model: ${modelId}`);
    return 0;
  }

  const inputCost = (inputTokens / 1_000_000) * pricing.input;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;
  return inputCost + outputCost;
}

/**
 * Log model usage.
 * @param {Object} params - Usage parameters
 * @param {string} params.command - Command name
 * @param {string} params.model - Full model ID
 * @param {string} params.modelAlias - Short model name
 * @param {number} params.inputTokens - Input tokens
 * @param {number} params.outputTokens - Output tokens
 * @param {number} params.durationMs - Execution duration
 * @param {boolean} params.success - Success flag
 * @param {string} [params.error] - Error message if failed
 * @param {Object} config - Config object
 */
function logUsage(params, config) {
  if (!config.costTracking?.enabled) {
    return; // Logging disabled
  }

  const logPath = getLogPath(config);
  ensureLogDirectory(logPath);
  rotateLogIfNeeded(logPath);

  const cost = calculateCost(
    params.model,
    params.inputTokens || 0,
    params.outputTokens || 0
  );

  const logEntry = {
    timestamp: new Date().toISOString(),
    command: params.command,
    model: params.model,
    model_alias: params.modelAlias,
    input_tokens: params.inputTokens || 0,
    output_tokens: params.outputTokens || 0,
    cost_usd: parseFloat(cost.toFixed(4)),
    duration_ms: params.durationMs || 0,
    success: params.success !== false,
    error: params.error || null
  };

  const logLine = JSON.stringify(logEntry) + '\n';

  try {
    fs.appendFileSync(logPath, logLine, 'utf-8');
  } catch (error) {
    console.error(`[MODEL-SELECTION] Failed to write log: ${error.message}`);
  }
}

/**
 * Parse log file and generate summary.
 * @param {string} logPath - Log file path
 * @returns {Object} Summary statistics
 */
function generateSummary(logPath) {
  const summary = {
    totalCost: 0,
    totalInvocations: 0,
    byCommand: {},
    byModel: {},
    errors: 0
  };

  try {
    if (!fs.existsSync(logPath)) {
      return summary;
    }

    const content = fs.readFileSync(logPath, 'utf-8');
    const lines = content.trim().split('\n');

    for (const line of lines) {
      if (!line) continue;

      try {
        const entry = JSON.parse(line);
        summary.totalCost += entry.cost_usd || 0;
        summary.totalInvocations++;

        // By command
        if (!summary.byCommand[entry.command]) {
          summary.byCommand[entry.command] = { cost: 0, count: 0 };
        }
        summary.byCommand[entry.command].cost += entry.cost_usd || 0;
        summary.byCommand[entry.command].count++;

        // By model
        const modelAlias = entry.model_alias || 'unknown';
        if (!summary.byModel[modelAlias]) {
          summary.byModel[modelAlias] = { cost: 0, count: 0 };
        }
        summary.byModel[modelAlias].cost += entry.cost_usd || 0;
        summary.byModel[modelAlias].count++;

        if (!entry.success) {
          summary.errors++;
        }
      } catch (parseError) {
        console.warn(`[MODEL-SELECTION] Failed to parse log line: ${parseError.message}`);
      }
    }
  } catch (error) {
    console.error(`[MODEL-SELECTION] Failed to read log: ${error.message}`);
  }

  return summary;
}

module.exports = {
  logUsage,
  generateSummary,
  getLogPath,
  calculateCost,
  MODEL_PRICING
};
