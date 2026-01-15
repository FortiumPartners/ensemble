#!/usr/bin/env node
/**
 * detailed-score.js - Granular Multi-Rubric Scorer
 *
 * Runs all rubrics against a session and extracts detailed metrics including:
 * - Per-rubric scores with dimension breakdowns
 * - Token usage from session logs
 * - Timing metrics
 * - Binary check results
 *
 * Usage: node detailed-score.js <session-dir> [options]
 *
 * Options:
 *   --rubrics-dir DIR   Directory containing rubrics (default: ../rubrics)
 *   --output FILE       Output JSON file (default: <session-dir>/detailed-scores.json)
 *   --quiet             Suppress progress output
 *   --help              Show this help
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

// Import judge functions
const judgeModule = require('./judge.js');
const { loadSessionFiles, loadRubric, listRubrics, buildPrompt, invokeClaude, extractScore } = judgeModule;

const SCRIPT_DIR = __dirname;
const DEFAULT_RUBRICS_DIR = path.join(SCRIPT_DIR, '..', 'rubrics');

/**
 * Parse command line arguments
 */
function parseArgs(args) {
  const result = {
    sessionDir: null,
    rubricsDir: DEFAULT_RUBRICS_DIR,
    output: null,
    quiet: false,
    help: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--help':
      case '-h':
        result.help = true;
        break;
      case '--rubrics-dir':
        result.rubricsDir = args[++i];
        break;
      case '--output':
        result.output = args[++i];
        break;
      case '--quiet':
        result.quiet = true;
        break;
      default:
        if (!arg.startsWith('-') && !result.sessionDir) {
          result.sessionDir = arg;
        }
        break;
    }
  }

  return result;
}

/**
 * Extract token usage from session.jsonl
 * @param {string} sessionDir - Session directory
 * @returns {object} Token usage stats
 */
function extractTokenUsage(sessionDir) {
  const sessionLogPath = path.join(sessionDir, 'session.jsonl');

  const result = {
    input_tokens: 0,
    output_tokens: 0,
    total_tokens: 0,
    api_calls: 0,
    cache_read_tokens: 0,
    cache_write_tokens: 0
  };

  if (!fs.existsSync(sessionLogPath)) {
    return result;
  }

  try {
    const content = fs.readFileSync(sessionLogPath, 'utf8');
    const lines = content.trim().split('\n');

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const entry = JSON.parse(line);

        // Look for usage data in various formats
        if (entry.usage) {
          result.input_tokens += entry.usage.input_tokens || 0;
          result.output_tokens += entry.usage.output_tokens || 0;
          result.cache_read_tokens += entry.usage.cache_read_input_tokens || 0;
          result.cache_write_tokens += entry.usage.cache_creation_input_tokens || 0;
          result.api_calls++;
        }

        // Alternative format from Claude CLI
        if (entry.costUSD !== undefined && entry.inputTokens) {
          result.input_tokens += entry.inputTokens || 0;
          result.output_tokens += entry.outputTokens || 0;
          result.api_calls++;
        }

        // Look for message-level token counts
        if (entry.type === 'message' && entry.message?.usage) {
          const usage = entry.message.usage;
          result.input_tokens += usage.input_tokens || 0;
          result.output_tokens += usage.output_tokens || 0;
          result.api_calls++;
        }
      } catch (parseErr) {
        // Skip malformed lines
      }
    }

    result.total_tokens = result.input_tokens + result.output_tokens;
  } catch (err) {
    // Return empty stats on error
  }

  return result;
}

/**
 * Extract timing from metadata
 * @param {string} sessionDir - Session directory
 * @returns {object} Timing stats
 */
function extractTiming(sessionDir) {
  const metadataPath = path.join(sessionDir, 'metadata.json');

  const result = {
    start_time: null,
    end_time: null,
    duration_seconds: 0
  };

  if (!fs.existsSync(metadataPath)) {
    return result;
  }

  try {
    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));

    result.start_time = metadata.start_time || metadata.startTime || null;
    result.end_time = metadata.end_time || metadata.endTime || null;

    if (result.start_time && result.end_time) {
      const start = new Date(result.start_time);
      const end = new Date(result.end_time);
      result.duration_seconds = Math.round((end - start) / 1000);
    }
  } catch (err) {
    // Return empty stats on error
  }

  return result;
}

/**
 * Score a session against a single rubric
 * @param {string} sessionDir - Session directory
 * @param {string} rubricName - Rubric name
 * @param {object} sessionFiles - Pre-loaded session files
 * @param {object} options - Options
 * @returns {object} Score result with dimensions
 */
async function scoreRubric(sessionDir, rubricName, sessionFiles, options = {}) {
  const rubricsDir = options.rubricsDir || DEFAULT_RUBRICS_DIR;

  try {
    // Load rubric
    const rubricContent = loadRubric(rubricName, rubricsDir);

    // Determine which files to judge based on rubric
    let filesToJudge;
    if (rubricName.includes('test')) {
      filesToJudge = sessionFiles.tests.length > 0 ? sessionFiles.tests : sessionFiles.code;
    } else {
      filesToJudge = sessionFiles.code;
    }

    if (filesToJudge.length === 0) {
      return {
        rubric: rubricName,
        error: 'No files to judge',
        score: null,
        dimensions: {}
      };
    }

    // Build and execute prompt
    const prompt = buildPrompt(rubricContent, filesToJudge, {});

    if (!options.quiet) {
      console.error(`  [${rubricName}] Invoking Claude...`);
    }

    const response = invokeClaude(prompt, { retries: 3 });
    const scores = extractScore(response);

    return {
      rubric: rubricName,
      score: scores.overall,
      dimensions: response.dimension_scores || {},
      metrics: response.metrics || null,
      strengths: response.strengths || [],
      weaknesses: response.weaknesses || [],
      files_judged: filesToJudge.map(f => f.filename)
    };
  } catch (err) {
    return {
      rubric: rubricName,
      error: err.message,
      score: null,
      dimensions: {}
    };
  }
}

/**
 * Main function to score a session with all rubrics
 * @param {string} sessionDir - Session directory
 * @param {object} options - Options
 * @returns {object} Complete detailed scores
 */
async function scoreSession(sessionDir, options = {}) {
  const rubricsDir = options.rubricsDir || DEFAULT_RUBRICS_DIR;

  // Load session files
  if (!options.quiet) {
    console.error(`[detailed-score] Loading files from: ${sessionDir}`);
  }

  const sessionFiles = loadSessionFiles(sessionDir);
  const totalFiles = sessionFiles.code.length + sessionFiles.tests.length;

  if (totalFiles === 0) {
    throw new Error('No files found in session directory');
  }

  if (!options.quiet) {
    console.error(`[detailed-score] Found ${sessionFiles.code.length} code files, ${sessionFiles.tests.length} test files`);
  }

  // Get all rubrics
  const rubrics = listRubrics(rubricsDir);

  // Filter to relevant rubrics (code and test focused)
  const relevantRubrics = rubrics.filter(r =>
    ['code-quality', 'test-quality', 'architecture', 'error-handling'].includes(r)
  );

  if (!options.quiet) {
    console.error(`[detailed-score] Scoring against ${relevantRubrics.length} rubrics: ${relevantRubrics.join(', ')}`);
  }

  // Score against each rubric
  const rubricScores = {};
  for (const rubric of relevantRubrics) {
    const result = await scoreRubric(sessionDir, rubric, sessionFiles, options);
    rubricScores[rubric] = result;
  }

  // Extract token usage
  const tokenUsage = extractTokenUsage(sessionDir);

  // Extract timing
  const timing = extractTiming(sessionDir);

  // Calculate overall weighted score
  const validScores = Object.values(rubricScores)
    .filter(r => r.score !== null)
    .map(r => r.score);

  const overallScore = validScores.length > 0
    ? validScores.reduce((a, b) => a + b, 0) / validScores.length
    : null;

  // Build result
  const result = {
    session_dir: sessionDir,
    session_id: path.basename(sessionDir),
    scored_at: new Date().toISOString(),
    files: {
      code: sessionFiles.code.map(f => f.filename),
      tests: sessionFiles.tests.map(f => f.filename)
    },
    overall_score: overallScore ? Math.round(overallScore * 100) / 100 : null,
    by_rubric: rubricScores,
    token_usage: tokenUsage,
    timing: timing
  };

  return result;
}

/**
 * Show help
 */
function showHelp() {
  console.log(`Usage: node detailed-score.js <session-dir> [options]

Score a session against all rubrics with detailed dimension breakdowns.

Options:
  --rubrics-dir DIR   Directory containing rubrics (default: ../rubrics)
  --output FILE       Output JSON file (default: <session-dir>/detailed-scores.json)
  --quiet             Suppress progress output
  --help              Show this help

Output includes:
  - Per-rubric scores (code-quality, test-quality, architecture, error-handling)
  - Dimension breakdowns within each rubric
  - Token usage (input, output, cache)
  - Timing metrics
  - Strengths and weaknesses

Examples:
  node detailed-score.js ./results/session-abc123/
  node detailed-score.js ./results/session-abc123/ --output scores.json`);
}

/**
 * Main entry point
 */
async function main(args) {
  const parsedArgs = parseArgs(args);

  if (parsedArgs.help) {
    showHelp();
    return { exitCode: 0 };
  }

  if (!parsedArgs.sessionDir) {
    return {
      exitCode: 1,
      error: 'Error: session-dir argument is required\n\nRun with --help for usage information.'
    };
  }

  if (!fs.existsSync(parsedArgs.sessionDir)) {
    return {
      exitCode: 1,
      error: `Error: Session directory not found: ${parsedArgs.sessionDir}`
    };
  }

  try {
    const result = await scoreSession(parsedArgs.sessionDir, parsedArgs);

    // Determine output path
    const outputPath = parsedArgs.output || path.join(parsedArgs.sessionDir, 'detailed-scores.json');

    // Write results
    fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));

    if (!parsedArgs.quiet) {
      console.error(`\n[detailed-score] Results saved to: ${outputPath}`);
      console.error(`[detailed-score] Overall score: ${result.overall_score}/5`);
      console.error(`[detailed-score] Token usage: ${result.token_usage.total_tokens} total (${result.token_usage.input_tokens} in, ${result.token_usage.output_tokens} out)`);
      console.error(`[detailed-score] Duration: ${result.timing.duration_seconds}s`);
    }

    return { exitCode: 0, result };
  } catch (err) {
    return {
      exitCode: 1,
      error: `Error: ${err.message}`
    };
  }
}

// CLI entry point
if (require.main === module) {
  main(process.argv.slice(2))
    .then((result) => {
      if (result.error) {
        console.error(result.error);
      }
      process.exit(result.exitCode);
    })
    .catch((err) => {
      console.error(`Unexpected error: ${err.message}`);
      process.exit(1);
    });
}

module.exports = {
  parseArgs,
  extractTokenUsage,
  extractTiming,
  scoreRubric,
  scoreSession,
  main
};
