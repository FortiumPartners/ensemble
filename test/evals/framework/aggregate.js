#!/usr/bin/env node
/**
 * aggregate.js - Score aggregation and report generation
 * TRD Task: TRD-TEST-071
 *
 * Compiles scores from multiple sessions, calculates statistics,
 * and generates comparison reports.
 *
 * Usage: node aggregate.js [options] <eval-results-dir>
 *
 * Arguments:
 *   eval-results-dir   Directory containing eval results (from run-eval.js)
 *
 * Options:
 *   --output FILE      Output report file (default: <eval-results-dir>/report.md)
 *   --format FORMAT    Output format: markdown, json, both (default: markdown)
 *   --significance N   p-value threshold for highlighting (default: 0.05)
 *   --quiet            Suppress progress output
 *   --help             Show this help
 */

const fs = require('fs');
const path = require('path');

/**
 * Log warning message to stderr
 * @param {string} message - Warning message
 */
function logWarning(message) {
  console.error(`[aggregate] WARNING: ${message}`);
}

// Constants
const DEFAULT_FORMAT = 'markdown';
const DEFAULT_SIGNIFICANCE = 0.05;

/**
 * Parse command line arguments
 * @param {string[]} args - Command line arguments
 * @returns {object} Parsed arguments object
 */
function parseArgs(args) {
  const result = {
    resultsDir: null,
    output: null,
    format: DEFAULT_FORMAT,
    significance: DEFAULT_SIGNIFICANCE,
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

      case '--output':
        result.output = args[++i];
        break;

      case '--format':
        result.format = args[++i];
        break;

      case '--significance':
        result.significance = parseFloat(args[++i]);
        break;

      case '--quiet':
        result.quiet = true;
        break;

      default:
        // First positional argument is the results directory
        if (!arg.startsWith('-') && !result.resultsDir) {
          result.resultsDir = arg;
        }
        break;
    }
  }

  return result;
}

/**
 * Calculate statistics for an array of scores
 * @param {number[]} scores - Array of numeric scores
 * @returns {object} Statistics object with mean, median, stddev, min, max
 */
function calculateStatistics(scores) {
  if (!scores || scores.length === 0) {
    return { mean: 0, median: 0, stddev: 0, min: 0, max: 0 };
  }

  const n = scores.length;
  const sorted = [...scores].sort((a, b) => a - b);

  // Mean
  const sum = scores.reduce((acc, val) => acc + val, 0);
  const mean = sum / n;

  // Median
  let median;
  if (n % 2 === 0) {
    median = (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  } else {
    median = sorted[Math.floor(n / 2)];
  }

  // Sample standard deviation
  let stddev = 0;
  if (n > 1) {
    const squaredDiffs = scores.map((val) => Math.pow(val - mean, 2));
    const variance = squaredDiffs.reduce((acc, val) => acc + val, 0) / (n - 1);
    stddev = Math.sqrt(variance);
  }

  return {
    mean: parseFloat(mean.toFixed(2)),
    median: parseFloat(median.toFixed(2)),
    stddev: parseFloat(stddev.toFixed(2)),
    min: Math.min(...scores),
    max: Math.max(...scores)
  };
}

/**
 * Perform two-sample t-test
 * @param {number[]} sample1 - First sample array
 * @param {number[]} sample2 - Second sample array
 * @returns {object} Object with t-statistic and p-value
 */
function tTest(sample1, sample2) {
  const n1 = sample1.length;
  const n2 = sample2.length;

  if (n1 < 2 || n2 < 2) {
    return { t: 0, p: 1 };
  }

  const mean1 = sample1.reduce((a, b) => a + b, 0) / n1;
  const mean2 = sample2.reduce((a, b) => a + b, 0) / n2;

  const var1 = sample1.reduce((acc, val) => acc + Math.pow(val - mean1, 2), 0) / (n1 - 1);
  const var2 = sample2.reduce((acc, val) => acc + Math.pow(val - mean2, 2), 0) / (n2 - 1);

  // Welch's t-test (does not assume equal variances)
  const se = Math.sqrt(var1 / n1 + var2 / n2);

  if (se === 0) {
    return { t: 0, p: 1 };
  }

  const t = (mean1 - mean2) / se;

  // Degrees of freedom (Welch-Satterthwaite)
  const df =
    Math.pow(var1 / n1 + var2 / n2, 2) /
    (Math.pow(var1 / n1, 2) / (n1 - 1) + Math.pow(var2 / n2, 2) / (n2 - 1));

  // Approximate p-value using t-distribution
  // Using a simple approximation for two-tailed test
  const p = approximatePValue(Math.abs(t), df);

  return { t: parseFloat(t.toFixed(4)), p: parseFloat(p.toFixed(4)) };
}

/**
 * Approximate p-value from t-statistic and degrees of freedom
 * Uses a simple approximation suitable for most practical purposes
 * @param {number} t - Absolute t-statistic
 * @param {number} df - Degrees of freedom
 * @returns {number} Two-tailed p-value
 */
function approximatePValue(t, df) {
  // Simple approximation using the normal distribution for large df
  // For smaller df, this is less accurate but sufficient for our purposes
  if (df > 100) {
    // Use normal approximation
    const z = t;
    return 2 * (1 - normalCDF(z));
  }

  // Use approximation based on Student's t
  // This is a rough approximation
  const x = df / (df + t * t);
  const a = df / 2;
  const b = 0.5;

  // Incomplete beta function approximation
  const p = incompleteBeta(x, a, b);
  return Math.min(1, Math.max(0, p));
}

/**
 * Standard normal CDF approximation
 * @param {number} x - Value
 * @returns {number} CDF value
 */
function normalCDF(x) {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x) / Math.sqrt(2);

  const t = 1.0 / (1.0 + p * x);
  const y = 1.0 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

  return 0.5 * (1.0 + sign * y);
}

/**
 * Simple incomplete beta function approximation
 * @param {number} x - Value between 0 and 1
 * @param {number} a - Alpha parameter
 * @param {number} b - Beta parameter
 * @returns {number} Incomplete beta value
 */
function incompleteBeta(x, a, b) {
  // Very simple approximation - good enough for significance testing
  if (x <= 0) return 0;
  if (x >= 1) return 1;

  // Use continued fraction approximation
  const maxIterations = 100;
  const epsilon = 1e-10;

  let sum = 0;
  let term = 1;

  for (let n = 0; n < maxIterations; n++) {
    term *= x * (a + n) / (a + b + n);
    sum += term / (a + n + 1);
    if (Math.abs(term) < epsilon) break;
  }

  return (Math.pow(x, a) * Math.pow(1 - x, b) * sum) / beta(a, b);
}

/**
 * Beta function approximation using log-gamma
 * @param {number} a - Alpha
 * @param {number} b - Beta
 * @returns {number} Beta function value
 */
function beta(a, b) {
  return Math.exp(logGamma(a) + logGamma(b) - logGamma(a + b));
}

/**
 * Log-gamma function approximation (Stirling)
 * @param {number} x - Value
 * @returns {number} Log-gamma value
 */
function logGamma(x) {
  // Stirling's approximation
  if (x < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  }

  x = x - 1;
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
    1.5056327351493116e-7
  ];

  let sum = c[0];
  for (let i = 1; i < g + 2; i++) {
    sum += c[i] / (x + i);
  }

  const t = x + g + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(sum);
}

/**
 * Load sessions.json from results directory
 * @param {string} resultsDir - Path to results directory
 * @returns {object|null} Sessions data or null if not found
 */
function loadSessionsJson(resultsDir) {
  const sessionsPath = path.join(resultsDir, 'sessions.json');
  if (!fs.existsSync(sessionsPath)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(sessionsPath, 'utf8'));
  } catch (err) {
    logWarning(`Failed to parse sessions.json: ${err.message}`);
    return null;
  }
}

/**
 * Load metadata.json from a session directory
 * @param {string} sessionDir - Path to session directory
 * @returns {object|null} Metadata or null if not found
 */
function loadSessionMetadata(sessionDir) {
  const metadataPath = path.join(sessionDir, 'metadata.json');
  if (!fs.existsSync(metadataPath)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
  } catch (err) {
    logWarning(`Failed to parse metadata.json in ${sessionDir}: ${err.message}`);
    return null;
  }
}

/**
 * Calculate session duration from metadata
 * @param {object} metadata - Session metadata object
 * @returns {number|null} Duration in seconds or null if unavailable
 */
function calculateDuration(metadata) {
  if (!metadata || !metadata.start_time || !metadata.end_time) {
    return null;
  }
  try {
    const start = new Date(metadata.start_time);
    const end = new Date(metadata.end_time);
    return Math.round((end - start) / 1000);
  } catch (err) {
    return null;
  }
}

/**
 * Aggregate binary check results from sessions data
 * @param {object} sessionsData - Data from sessions.json
 * @returns {object} Binary check summary by variant and check name
 */
function aggregateBinaryChecks(sessionsData) {
  if (!sessionsData || !sessionsData.variants) {
    return {};
  }

  const summary = {};
  const checkNames = (sessionsData.binary_checks || []).map((c) => c.name);

  for (const session of sessionsData.variants) {
    const variantId = session.variant_id;

    if (!summary[variantId]) {
      summary[variantId] = {
        total: 0,
        checks: {}
      };
      for (const checkName of checkNames) {
        summary[variantId].checks[checkName] = { passed: 0, total: 0 };
      }
    }

    summary[variantId].total++;

    for (const check of session.binary_checks || []) {
      if (!summary[variantId].checks[check.name]) {
        summary[variantId].checks[check.name] = { passed: 0, total: 0 };
      }
      summary[variantId].checks[check.name].total++;
      if (check.passed) {
        summary[variantId].checks[check.name].passed++;
      }
    }
  }

  return summary;
}

/**
 * Collect timing data from all session metadata files
 * @param {string} resultsDir - Path to results directory
 * @param {object} sessionsData - Data from sessions.json
 * @returns {object} Timing data by variant
 */
function collectTimingData(resultsDir, sessionsData) {
  if (!sessionsData || !sessionsData.variants) {
    return {};
  }

  const timingByVariant = {};

  for (const session of sessionsData.variants) {
    const variantId = session.variant_id;
    const sessionId = session.session_id;

    if (!sessionId) continue;

    const sessionDir = path.join(resultsDir, sessionId);
    const metadata = loadSessionMetadata(sessionDir);
    const duration = calculateDuration(metadata);

    if (!timingByVariant[variantId]) {
      timingByVariant[variantId] = [];
    }

    if (duration !== null) {
      timingByVariant[variantId].push(duration);
    }
  }

  // Calculate statistics for each variant
  const result = {};
  for (const [variantId, durations] of Object.entries(timingByVariant)) {
    if (durations.length === 0) {
      result[variantId] = { mean: null, min: null, max: null, samples: 0 };
    } else {
      const sum = durations.reduce((a, b) => a + b, 0);
      result[variantId] = {
        mean: Math.round(sum / durations.length),
        min: Math.min(...durations),
        max: Math.max(...durations),
        samples: durations.length
      };
    }
  }

  return result;
}

/**
 * Build session details with binary checks and timing
 * @param {string} resultsDir - Path to results directory
 * @param {object} sessionsData - Data from sessions.json
 * @returns {object[]} Array of session detail objects
 */
function buildSessionDetails(resultsDir, sessionsData) {
  if (!sessionsData || !sessionsData.variants) {
    return [];
  }

  const details = [];

  for (const session of sessionsData.variants) {
    const sessionId = session.session_id;
    const sessionDir = sessionId ? path.join(resultsDir, sessionId) : null;
    const metadata = sessionDir ? loadSessionMetadata(sessionDir) : null;
    const duration = calculateDuration(metadata);

    const checksPassedCount = (session.binary_checks || []).filter((c) => c.passed).length;
    const checksTotalCount = (session.binary_checks || []).length;

    details.push({
      variant_id: session.variant_id,
      run_index: session.run_index || 0,
      session_id: sessionId || 'N/A',
      status: session.status || 'unknown',
      duration_seconds: duration,
      binary_checks_passed: checksPassedCount,
      binary_checks_total: checksTotalCount,
      workspace_dir: sessionDir ? path.join(sessionDir, 'workspace') : null
    });
  }

  return details;
}

/**
 * Collect scores from eval results directory
 * Supports two formats:
 * 1. Legacy: session_dir/score.json with {scores: [{rubric: "x", score: N}, ...]}
 * 2. Judge.js: session_dir/scores/<rubric>.json with {rubric: "x", scores: {overall: N, ...}}
 *
 * @param {string} resultsDir - Path to results directory
 * @returns {object} Collected scores grouped by variant
 */
function collectScores(resultsDir) {
  const scores = {};

  // Get list of variant directories
  const entries = fs.readdirSync(resultsDir);

  for (const entry of entries) {
    const variantPath = path.join(resultsDir, entry);

    // Skip non-directories and special files
    if (!fs.statSync(variantPath).isDirectory()) {
      continue;
    }

    // Skip metadata files
    if (entry === 'sessions.json' || entry.startsWith('.')) {
      continue;
    }

    scores[entry] = {
      sessions: []
    };

    // Get session directories within variant
    let sessionDirs;
    try {
      sessionDirs = fs.readdirSync(variantPath);
    } catch (err) {
      continue;
    }

    for (const sessionDir of sessionDirs) {
      const sessionPath = path.join(variantPath, sessionDir);

      if (!fs.statSync(sessionPath).isDirectory()) {
        continue;
      }

      const sessionScores = {};

      // Method 1: Check for scores/ subdirectory (judge.js output)
      const scoresDir = path.join(sessionPath, 'scores');
      if (fs.existsSync(scoresDir) && fs.statSync(scoresDir).isDirectory()) {
        try {
          const scoreFiles = fs.readdirSync(scoresDir).filter((f) => f.endsWith('.json'));

          for (const scoreFile of scoreFiles) {
            const scorePath = path.join(scoresDir, scoreFile);
            try {
              const scoreData = JSON.parse(fs.readFileSync(scorePath, 'utf8'));

              // Extract rubric name from file or content
              const rubric = scoreData.rubric || scoreFile.replace('.json', '');

              // Handle judge.js format: {scores: {overall: N, dimensions: {...}}}
              if (scoreData.scores && typeof scoreData.scores.overall === 'number') {
                sessionScores[rubric] = scoreData.scores.overall;
              } else if (typeof scoreData.score === 'number') {
                // Alternative format: {score: N}
                sessionScores[rubric] = scoreData.score;
              } else {
                logWarning(`No valid score found in ${scorePath}`);
              }
            } catch (err) {
              logWarning(`Failed to parse score file ${scorePath}: ${err.message}`);
            }
          }
        } catch (err) {
          logWarning(`Failed to read scores directory: ${err.message}`);
        }
      }

      // Method 2: Check for legacy score.json (fallback)
      const legacyScorePath = path.join(sessionPath, 'score.json');
      if (fs.existsSync(legacyScorePath) && Object.keys(sessionScores).length === 0) {
        try {
          const scoreData = JSON.parse(fs.readFileSync(legacyScorePath, 'utf8'));

          // Validate required structure
          if (!scoreData || typeof scoreData !== 'object') {
            logWarning(`Malformed score file (not an object): ${legacyScorePath}`);
          } else if (Array.isArray(scoreData.scores)) {
            // Array format: {scores: [{rubric: "x", score: N}, ...]}
            for (const scoreEntry of scoreData.scores) {
              if (
                scoreEntry &&
                typeof scoreEntry === 'object' &&
                typeof scoreEntry.rubric === 'string' &&
                typeof scoreEntry.score === 'number'
              ) {
                if (scoreEntry.score < 1 || scoreEntry.score > 5) {
                  logWarning(
                    `Score out of range (${scoreEntry.score}) for "${scoreEntry.rubric}" in ${legacyScorePath}`
                  );
                }
                sessionScores[scoreEntry.rubric] = scoreEntry.score;
              }
            }
          } else if (scoreData.scores && typeof scoreData.scores === 'object') {
            // Object format: {scores: {overall: N, ...}}
            if (typeof scoreData.scores.overall === 'number') {
              sessionScores['overall'] = scoreData.scores.overall;
            }
          }
        } catch (err) {
          logWarning(`Failed to parse legacy score file ${legacyScorePath}: ${err.message}`);
        }
      }

      if (Object.keys(sessionScores).length === 0) {
        continue; // No scores found for this session
      }

      scores[entry].sessions.push({
        sessionId: sessionDir,
        scores: sessionScores,
        raw: sessionScores
      });
    }
  }

  return scores;
}

/**
 * Collect comparative results from eval results directory
 * Looks for comparison-<rubric>.json files in comparisons/ subdirectory
 *
 * @param {string} resultsDir - Path to results directory
 * @returns {object} Collected comparisons grouped by rubric
 */
function collectComparisons(resultsDir) {
  const comparisons = {
    byRubric: {},
    all: []
  };

  // Check for comparisons directory
  const comparisonsDir = path.join(resultsDir, 'comparisons');
  if (!fs.existsSync(comparisonsDir) || !fs.statSync(comparisonsDir).isDirectory()) {
    return comparisons;
  }

  try {
    const comparisonFiles = fs.readdirSync(comparisonsDir)
      .filter((f) => f.startsWith('comparison-') && f.endsWith('.json'));

    for (const file of comparisonFiles) {
      const filePath = path.join(comparisonsDir, file);
      try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        const rubric = data.rubric || file.replace('comparison-', '').replace('.json', '');

        // Validate comparison data
        if (!data.verdict || !data.margin || typeof data.score_a !== 'number' || typeof data.score_b !== 'number') {
          logWarning(`Invalid comparison data in ${filePath}`);
          continue;
        }

        const comparison = {
          rubric,
          session_a: data.session_a,
          session_b: data.session_b,
          verdict: data.verdict,
          margin: data.margin,
          score_a: data.score_a,
          score_b: data.score_b,
          metrics_a: data.metrics_a || null,
          metrics_b: data.metrics_b || null,
          judged_at: data.judged_at
        };

        if (!comparisons.byRubric[rubric]) {
          comparisons.byRubric[rubric] = [];
        }
        comparisons.byRubric[rubric].push(comparison);
        comparisons.all.push(comparison);

      } catch (err) {
        logWarning(`Failed to parse comparison file ${filePath}: ${err.message}`);
      }
    }
  } catch (err) {
    logWarning(`Failed to read comparisons directory: ${err.message}`);
  }

  return comparisons;
}

/**
 * Collect baseline comparison results from eval results directory
 * Looks for baseline-comparison-<rubric>.json files in comparisons/ subdirectory
 *
 * @param {string} resultsDir - Path to results directory
 * @returns {object} Collected baseline comparisons grouped by rubric
 */
function collectBaselineComparisons(resultsDir) {
  const comparisons = {
    byRubric: {},
    all: []
  };

  // Check for comparisons directory
  const comparisonsDir = path.join(resultsDir, 'comparisons');
  if (!fs.existsSync(comparisonsDir) || !fs.statSync(comparisonsDir).isDirectory()) {
    return comparisons;
  }

  try {
    const comparisonFiles = fs.readdirSync(comparisonsDir)
      .filter((f) => f.startsWith('baseline-comparison-') && f.endsWith('.json'));

    for (const file of comparisonFiles) {
      const filePath = path.join(comparisonsDir, file);
      try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        const rubric = data.rubric || file.replace('baseline-comparison-', '').replace('.json', '');

        // Validate baseline comparison data
        if (!data.verdict || typeof data.score_baseline !== 'number' || typeof data.score_framework !== 'number') {
          logWarning(`Invalid baseline comparison data in ${filePath}`);
          continue;
        }

        const comparison = {
          mode: 'baseline_comparison',
          rubric,
          baseline_session: data.baseline_session,
          framework_session: data.framework_session,
          verdict: data.verdict,
          improvement: data.improvement || { quality_delta: 0, categories: {}, time_saved_estimate: 'none' },
          score_baseline: data.score_baseline,
          score_framework: data.score_framework,
          metrics_baseline: data.metrics_baseline || null,
          metrics_framework: data.metrics_framework || null,
          specific_improvements: data.specific_improvements || [],
          specific_regressions: data.specific_regressions || [],
          judged_at: data.judged_at
        };

        if (!comparisons.byRubric[rubric]) {
          comparisons.byRubric[rubric] = [];
        }
        comparisons.byRubric[rubric].push(comparison);
        comparisons.all.push(comparison);

      } catch (err) {
        logWarning(`Failed to parse baseline comparison file ${filePath}: ${err.message}`);
      }
    }
  } catch (err) {
    logWarning(`Failed to read comparisons directory: ${err.message}`);
  }

  return comparisons;
}

/**
 * Aggregate baseline comparison results to show framework improvement metrics
 * @param {object} comparisons - Collected baseline comparisons from collectBaselineComparisons
 * @returns {object} Aggregated baseline comparison statistics
 */
function aggregateBaselineComparisons(comparisons) {
  const aggregated = {
    total: comparisons.all.length,
    framework_improvement_rate: 0,
    average_quality_delta: 0,
    verdicts: {
      framework_better: 0,
      equivalent: 0,
      baseline_better: 0
    },
    scores: {
      mean_baseline: 0,
      mean_framework: 0,
      mean_difference: 0
    },
    categories: {
      code_structure: { significantly_improved: 0, improved: 0, equivalent: 0, degraded: 0 },
      test_coverage: { significantly_improved: 0, improved: 0, equivalent: 0, degraded: 0 },
      error_handling: { significantly_improved: 0, improved: 0, equivalent: 0, degraded: 0 },
      documentation: { significantly_improved: 0, improved: 0, equivalent: 0, degraded: 0 },
      best_practices: { significantly_improved: 0, improved: 0, equivalent: 0, degraded: 0 }
    },
    time_saved: {
      none: 0,
      minimal: 0,
      moderate: 0,
      significant: 0
    },
    byRubric: {}
  };

  if (comparisons.all.length === 0) {
    return aggregated;
  }

  let totalQualityDelta = 0;
  let totalScoreBaseline = 0;
  let totalScoreFramework = 0;

  for (const comp of comparisons.all) {
    // Count verdicts
    if (comp.verdict in aggregated.verdicts) {
      aggregated.verdicts[comp.verdict]++;
    }

    // Accumulate scores
    totalScoreBaseline += comp.score_baseline;
    totalScoreFramework += comp.score_framework;

    // Accumulate quality delta
    const qualityDelta = comp.improvement?.quality_delta ?? 0;
    totalQualityDelta += qualityDelta;

    // Count category improvements
    const categories = comp.improvement?.categories || {};
    for (const [category, value] of Object.entries(categories)) {
      if (aggregated.categories[category] && aggregated.categories[category][value] !== undefined) {
        aggregated.categories[category][value]++;
      }
    }

    // Count time saved estimates
    const timeSaved = comp.improvement?.time_saved_estimate || 'none';
    if (aggregated.time_saved[timeSaved] !== undefined) {
      aggregated.time_saved[timeSaved]++;
    }

    // Track by rubric
    if (!aggregated.byRubric[comp.rubric]) {
      aggregated.byRubric[comp.rubric] = {
        framework_better: 0,
        equivalent: 0,
        baseline_better: 0,
        avg_quality_delta: 0,
        quality_deltas: [],
        comparisons: []
      };
    }

    const rubricStats = aggregated.byRubric[comp.rubric];
    if (comp.verdict === 'framework_better') {
      rubricStats.framework_better++;
    } else if (comp.verdict === 'equivalent') {
      rubricStats.equivalent++;
    } else {
      rubricStats.baseline_better++;
    }
    rubricStats.quality_deltas.push(qualityDelta);
    rubricStats.comparisons.push(comp);
  }

  // Calculate aggregated metrics
  const total = comparisons.all.length;
  aggregated.framework_improvement_rate = parseFloat(
    ((aggregated.verdicts.framework_better / total) * 100).toFixed(1)
  );
  aggregated.average_quality_delta = parseFloat((totalQualityDelta / total).toFixed(2));
  aggregated.scores.mean_baseline = parseFloat((totalScoreBaseline / total).toFixed(2));
  aggregated.scores.mean_framework = parseFloat((totalScoreFramework / total).toFixed(2));
  aggregated.scores.mean_difference = parseFloat(
    (aggregated.scores.mean_framework - aggregated.scores.mean_baseline).toFixed(2)
  );

  // Calculate per-rubric averages
  for (const [rubric, stats] of Object.entries(aggregated.byRubric)) {
    if (stats.quality_deltas.length > 0) {
      const sum = stats.quality_deltas.reduce((a, b) => a + b, 0);
      stats.avg_quality_delta = parseFloat((sum / stats.quality_deltas.length).toFixed(2));
    }
  }

  return aggregated;
}

/**
 * Aggregate comparative results to show verdict distribution
 * @param {object} comparisons - Collected comparisons from collectComparisons
 * @returns {object} Aggregated comparison statistics
 */
function aggregateComparisons(comparisons) {
  const aggregated = {
    total: comparisons.all.length,
    overall: {
      a_wins: 0,
      b_wins: 0,
      equivalent: 0,
      a_wins_significant: 0,
      b_wins_significant: 0
    },
    byRubric: {},
    byMargin: {
      slight: 0,
      moderate: 0,
      significant: 0
    },
    score_difference: {
      mean_a: 0,
      mean_b: 0,
      mean_difference: 0
    }
  };

  if (comparisons.all.length === 0) {
    return aggregated;
  }

  let totalScoreA = 0;
  let totalScoreB = 0;

  for (const comp of comparisons.all) {
    // Count overall verdicts
    if (comp.verdict === 'a_better') {
      aggregated.overall.a_wins++;
      if (comp.margin === 'significant') {
        aggregated.overall.a_wins_significant++;
      }
    } else if (comp.verdict === 'b_better') {
      aggregated.overall.b_wins++;
      if (comp.margin === 'significant') {
        aggregated.overall.b_wins_significant++;
      }
    } else {
      aggregated.overall.equivalent++;
    }

    // Count by margin
    if (comp.margin in aggregated.byMargin) {
      aggregated.byMargin[comp.margin]++;
    }

    // Accumulate scores
    totalScoreA += comp.score_a;
    totalScoreB += comp.score_b;

    // Track by rubric
    if (!aggregated.byRubric[comp.rubric]) {
      aggregated.byRubric[comp.rubric] = {
        a_wins: 0,
        b_wins: 0,
        equivalent: 0,
        comparisons: []
      };
    }

    const rubricStats = aggregated.byRubric[comp.rubric];
    if (comp.verdict === 'a_better') {
      rubricStats.a_wins++;
    } else if (comp.verdict === 'b_better') {
      rubricStats.b_wins++;
    } else {
      rubricStats.equivalent++;
    }
    rubricStats.comparisons.push(comp);
  }

  // Calculate mean scores
  aggregated.score_difference.mean_a = parseFloat((totalScoreA / comparisons.all.length).toFixed(2));
  aggregated.score_difference.mean_b = parseFloat((totalScoreB / comparisons.all.length).toFixed(2));
  aggregated.score_difference.mean_difference = parseFloat(
    (aggregated.score_difference.mean_a - aggregated.score_difference.mean_b).toFixed(2)
  );

  return aggregated;
}

/**
 * Aggregate metrics from score files
 * @param {object} collectedScores - Collected scores from collectScores
 * @param {string} resultsDir - Path to results directory
 * @returns {object} Aggregated metrics by variant
 */
function aggregateMetrics(collectedScores, resultsDir) {
  const metrics = {};

  for (const [variant, data] of Object.entries(collectedScores)) {
    metrics[variant] = {
      sessions: [],
      averages: null
    };

    let totalLoc = 0;
    let totalCommentRatio = 0;
    let totalNestingDepth = 0;
    let countWithMetrics = 0;
    const complexityDistribution = { low: 0, moderate: 0, high: 0, very_high: 0 };

    for (const session of data.sessions) {
      // Try to find metrics in the scores directory
      const sessionPath = path.join(resultsDir, variant, session.sessionId, 'scores');
      if (!fs.existsSync(sessionPath)) continue;

      try {
        const scoreFiles = fs.readdirSync(sessionPath).filter((f) => f.endsWith('.json'));
        for (const file of scoreFiles) {
          const scoreData = JSON.parse(fs.readFileSync(path.join(sessionPath, file), 'utf8'));
          if (scoreData.metrics) {
            const m = scoreData.metrics;
            metrics[variant].sessions.push({
              sessionId: session.sessionId,
              rubric: scoreData.rubric,
              metrics: m
            });

            if (typeof m.estimated_loc === 'number') {
              totalLoc += m.estimated_loc;
              countWithMetrics++;
            }
            if (typeof m.comment_ratio === 'number') {
              totalCommentRatio += m.comment_ratio;
            }
            if (typeof m.max_nesting_depth === 'number') {
              totalNestingDepth += m.max_nesting_depth;
            }
            if (m.complexity_estimate && complexityDistribution[m.complexity_estimate] !== undefined) {
              complexityDistribution[m.complexity_estimate]++;
            }
          }
        }
      } catch (err) {
        // Silently skip sessions without metrics
      }
    }

    // Calculate averages if we have data
    if (countWithMetrics > 0) {
      metrics[variant].averages = {
        avg_loc: Math.round(totalLoc / countWithMetrics),
        avg_comment_ratio: parseFloat((totalCommentRatio / countWithMetrics).toFixed(2)),
        avg_nesting_depth: parseFloat((totalNestingDepth / countWithMetrics).toFixed(1)),
        complexity_distribution: complexityDistribution
      };
    }
  }

  return metrics;
}

/**
 * Aggregate scores by variant
 * Calculates both mean (legacy) and additive (sum) scoring presentations
 * @param {object} collectedScores - Collected scores from collectScores
 * @returns {object} Aggregated statistics per variant
 */
function aggregateByVariant(collectedScores) {
  const aggregated = {};

  for (const [variant, data] of Object.entries(collectedScores)) {
    const sessions = data.sessions;
    const allScores = [];
    const allSums = [];  // Sum of all rubrics per session
    const byRubric = {};
    const rawScores = [];

    for (const session of sessions) {
      const sessionScores = Object.values(session.scores);
      const sessionMean = sessionScores.reduce((a, b) => a + b, 0) / sessionScores.length;
      const sessionSum = sessionScores.reduce((a, b) => a + b, 0);
      const rubricCount = sessionScores.length;

      allScores.push(sessionMean);
      allSums.push(sessionSum);
      rawScores.push(sessionMean);

      // Collect per-rubric scores
      for (const [rubric, score] of Object.entries(session.scores)) {
        if (!byRubric[rubric]) {
          byRubric[rubric] = [];
        }
        byRubric[rubric].push(score);
      }
    }

    // Calculate overall statistics (mean-based, legacy)
    const overall = calculateStatistics(allScores);

    // Calculate additive statistics (sum-based)
    const rubricCount = Object.keys(byRubric).length || 4;  // Default to 4 rubrics
    const maxPossible = rubricCount * 5.25;  // Max with +0.25 modifiers
    const additive = {
      ...calculateStatistics(allSums),
      max_possible: parseFloat(maxPossible.toFixed(2)),
      rubric_count: rubricCount,
      // Normalized to 100-point scale
      normalized_mean: allSums.length > 0
        ? parseFloat(((allSums.reduce((a, b) => a + b, 0) / allSums.length / maxPossible) * 100).toFixed(1))
        : 0
    };

    // Calculate per-rubric statistics
    const rubricStats = {};
    for (const [rubric, scores] of Object.entries(byRubric)) {
      const stats = calculateStatistics(scores);
      // Add sum presentation: each rubric contributes to /5 (or /5.25 max)
      stats.sum_contribution = parseFloat((stats.mean * 4).toFixed(2));  // Contribution to /20
      rubricStats[rubric] = stats;
    }

    aggregated[variant] = {
      sessions: sessions.length,
      overall,           // Mean-based (legacy): /5 scale
      additive,          // Sum-based: raw sum and /100 normalized
      by_rubric: rubricStats,
      raw_scores: rawScores,
      raw_sums: allSums,
      raw_sessions: sessions
    };
  }

  return aggregated;
}

/**
 * Compare two variants statistically
 * @param {object} aggregated - Aggregated statistics
 * @param {number} [significanceLevel=0.05] - p-value threshold
 * @returns {object|null} Comparison results or null if only one variant
 */
function compareVariants(aggregated, significanceLevel = 0.05) {
  const variants = Object.keys(aggregated);

  if (variants.length < 2) {
    return null;
  }

  // Assume comparison between first two variants (with-skill vs without-skill)
  // Convention: with-skill is the treatment, without-skill is the control
  const treatment = variants.find((v) => v.includes('with')) || variants[0];
  const control = variants.find((v) => v.includes('without')) || variants[1];

  const treatmentData = aggregated[treatment];
  const controlData = aggregated[control];

  const difference = treatmentData.overall.mean - controlData.overall.mean;
  const percentImprovement =
    controlData.overall.mean > 0 ? (difference / controlData.overall.mean) * 100 : 0;

  // Perform t-test if we have raw scores
  let pValue = 1;
  let significant = false;

  if (treatmentData.raw_scores && controlData.raw_scores) {
    const testResult = tTest(treatmentData.raw_scores, controlData.raw_scores);
    pValue = testResult.p;
    significant = pValue < significanceLevel;
  }

  return {
    treatment,
    control,
    difference: parseFloat(difference.toFixed(2)),
    percent_improvement: parseFloat(percentImprovement.toFixed(1)),
    p_value: pValue,
    significant
  };
}

/**
 * Generate markdown report from aggregated data
 * @param {object} data - Report data
 * @returns {string} Markdown report content
 */
function generateMarkdownReport(data) {
  const lines = [];

  lines.push(`# Evaluation Report: ${data.eval_name}`);
  lines.push('');

  // Summary section
  lines.push('## Summary');
  lines.push('');

  // Check if we have additive data
  const hasAdditive = Object.values(data.variants).some(v => v.additive);

  if (hasAdditive) {
    // New additive scoring presentation
    lines.push('### Additive Scoring (Recommended)');
    lines.push('');
    lines.push('| Variant | Sessions | Total Score | Normalized (/100) | Std Dev |');
    lines.push('|---------|----------|-------------|-------------------|---------|');

    for (const [variant, stats] of Object.entries(data.variants)) {
      const additive = stats.additive || {};
      const mean = additive.mean ?? 'N/A';
      const normalized = additive.normalized_mean ?? 'N/A';
      const maxPossible = additive.max_possible ?? 21;
      const stddev = additive.stddev ?? 'N/A';
      lines.push(`| ${variant} | ${stats.sessions} | ${mean}/${maxPossible} | ${normalized} | ${stddev} |`);
    }
    lines.push('');

    lines.push('### Mean Scoring (Legacy /5 Scale)');
    lines.push('');
  }

  lines.push('| Variant | Sessions | Mean Score | Std Dev |');
  lines.push('|---------|----------|------------|---------|');

  for (const [variant, stats] of Object.entries(data.variants)) {
    const mean = stats.overall?.mean ?? 'N/A';
    const stddev = stats.overall?.stddev ?? 'N/A';
    lines.push(`| ${variant} | ${stats.sessions} | ${mean}/5 | ${stddev} |`);
  }
  lines.push('');

  // Comparison section
  if (data.comparison) {
    const c = data.comparison;
    const direction = c.difference >= 0 ? '+' : '';
    const significanceText = c.significant
      ? `Statistically significant (p < ${c.p_value?.toFixed(3) || '0.05'})`
      : `Not statistically significant (p = ${c.p_value?.toFixed(3) || 'N/A'})`;

    lines.push(
      `**Difference**: ${direction}${c.difference} points (${c.percent_improvement}% improvement) - ${significanceText}`
    );
    lines.push('');
  }

  // Comparative Results section (A/B testing results)
  if (data.comparative_results && data.comparative_results.total > 0) {
    const cr = data.comparative_results;
    lines.push('## Comparative Evaluation Results');
    lines.push('');
    lines.push(`**Total Comparisons**: ${cr.total}`);
    lines.push('');

    // Verdict distribution
    lines.push('### Verdict Distribution');
    lines.push('');
    lines.push('| Outcome | Count | Percentage |');
    lines.push('|---------|-------|------------|');
    lines.push(`| A Wins | ${cr.overall.a_wins} | ${Math.round((cr.overall.a_wins / cr.total) * 100)}% |`);
    lines.push(`| B Wins | ${cr.overall.b_wins} | ${Math.round((cr.overall.b_wins / cr.total) * 100)}% |`);
    lines.push(`| Equivalent | ${cr.overall.equivalent} | ${Math.round((cr.overall.equivalent / cr.total) * 100)}% |`);
    lines.push('');

    // Significant wins
    if (cr.overall.a_wins_significant > 0 || cr.overall.b_wins_significant > 0) {
      lines.push(`**Significant Wins**: A: ${cr.overall.a_wins_significant}, B: ${cr.overall.b_wins_significant}`);
      lines.push('');
    }

    // Margin distribution
    lines.push('### Margin Distribution');
    lines.push('');
    lines.push('| Margin | Count |');
    lines.push('|--------|-------|');
    lines.push(`| Slight | ${cr.byMargin.slight} |`);
    lines.push(`| Moderate | ${cr.byMargin.moderate} |`);
    lines.push(`| Significant | ${cr.byMargin.significant} |`);
    lines.push('');

    // Score difference
    lines.push('### Score Summary');
    lines.push('');
    lines.push(`- **Mean Score A**: ${cr.score_difference.mean_a}`);
    lines.push(`- **Mean Score B**: ${cr.score_difference.mean_b}`);
    lines.push(`- **Mean Difference (A - B)**: ${cr.score_difference.mean_difference >= 0 ? '+' : ''}${cr.score_difference.mean_difference}`);
    lines.push('');

    // Results by rubric
    if (Object.keys(cr.byRubric).length > 0) {
      lines.push('### Results by Rubric');
      lines.push('');
      lines.push('| Rubric | A Wins | B Wins | Equivalent |');
      lines.push('|--------|--------|--------|------------|');

      for (const [rubric, stats] of Object.entries(cr.byRubric)) {
        lines.push(`| ${rubric} | ${stats.a_wins} | ${stats.b_wins} | ${stats.equivalent} |`);
      }
      lines.push('');
    }
  }

  // Baseline Comparison Results section (framework vs vanilla Claude)
  if (data.baseline_results && data.baseline_results.total > 0) {
    const br = data.baseline_results;
    lines.push('## Framework Improvement Analysis');
    lines.push('');
    lines.push(`**Total Baseline Comparisons**: ${br.total}`);
    lines.push('');

    // Framework improvement rate
    lines.push('### Framework Impact Summary');
    lines.push('');
    lines.push(`- **Framework Improvement Rate**: ${br.framework_improvement_rate}%`);
    lines.push(`- **Average Quality Delta**: ${br.average_quality_delta} (0-3 scale)`);
    lines.push(`- **Mean Score Improvement**: ${br.scores.mean_difference >= 0 ? '+' : ''}${br.scores.mean_difference} (${br.scores.mean_baseline} -> ${br.scores.mean_framework})`);
    lines.push('');

    // Verdict distribution
    lines.push('### Verdict Distribution');
    lines.push('');
    lines.push('| Outcome | Count | Percentage |');
    lines.push('|---------|-------|------------|');
    lines.push(`| Framework Better | ${br.verdicts.framework_better} | ${Math.round((br.verdicts.framework_better / br.total) * 100)}% |`);
    lines.push(`| Equivalent | ${br.verdicts.equivalent} | ${Math.round((br.verdicts.equivalent / br.total) * 100)}% |`);
    lines.push(`| Baseline Better | ${br.verdicts.baseline_better} | ${Math.round((br.verdicts.baseline_better / br.total) * 100)}% |`);
    lines.push('');

    // Category breakdown
    lines.push('### Category Improvement Breakdown');
    lines.push('');
    lines.push('| Category | Significantly Improved | Improved | Equivalent | Degraded |');
    lines.push('|----------|----------------------|----------|------------|----------|');

    const categoryOrder = ['code_structure', 'test_coverage', 'error_handling', 'documentation', 'best_practices'];
    for (const category of categoryOrder) {
      const cat = br.categories[category];
      if (cat) {
        const label = category.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
        lines.push(`| ${label} | ${cat.significantly_improved} | ${cat.improved} | ${cat.equivalent} | ${cat.degraded} |`);
      }
    }
    lines.push('');

    // Time saved distribution
    lines.push('### Estimated Time Saved');
    lines.push('');
    lines.push('| Level | Count | Percentage |');
    lines.push('|-------|-------|------------|');
    const timeLevels = ['significant', 'moderate', 'minimal', 'none'];
    for (const level of timeLevels) {
      const count = br.time_saved[level] || 0;
      const pct = Math.round((count / br.total) * 100);
      const label = level.charAt(0).toUpperCase() + level.slice(1);
      lines.push(`| ${label} | ${count} | ${pct}% |`);
    }
    lines.push('');

    // Results by rubric
    if (Object.keys(br.byRubric).length > 0) {
      lines.push('### Framework Results by Rubric');
      lines.push('');
      lines.push('| Rubric | Framework Better | Equivalent | Baseline Better | Avg Quality Delta |');
      lines.push('|--------|-----------------|------------|-----------------|-------------------|');

      for (const [rubric, stats] of Object.entries(br.byRubric)) {
        lines.push(`| ${rubric} | ${stats.framework_better} | ${stats.equivalent} | ${stats.baseline_better} | ${stats.avg_quality_delta} |`);
      }
      lines.push('');
    }
  }

  // Code Metrics section
  if (data.metrics_summary && Object.keys(data.metrics_summary).length > 0) {
    const hasMetrics = Object.values(data.metrics_summary).some((m) => m.averages !== null);
    if (hasMetrics) {
      lines.push('## Code Metrics');
      lines.push('');
      lines.push('| Variant | Avg LOC | Comment Ratio | Avg Nesting | Complexity |');
      lines.push('|---------|---------|---------------|-------------|------------|');

      for (const [variant, metrics] of Object.entries(data.metrics_summary)) {
        if (metrics.averages) {
          const avg = metrics.averages;
          const complexity = Object.entries(avg.complexity_distribution)
            .filter(([, count]) => count > 0)
            .map(([level, count]) => `${level}: ${count}`)
            .join(', ') || 'N/A';
          lines.push(`| ${variant} | ${avg.avg_loc} | ${avg.avg_comment_ratio} | ${avg.avg_nesting_depth} | ${complexity} |`);
        } else {
          lines.push(`| ${variant} | N/A | N/A | N/A | N/A |`);
        }
      }
      lines.push('');
    }
  }

  // Binary Check Results section
  if (data.binary_check_summary && Object.keys(data.binary_check_summary).length > 0) {
    lines.push('## Binary Check Results');
    lines.push('');

    // Collect all check names
    const checkNames = new Set();
    for (const variantData of Object.values(data.binary_check_summary)) {
      Object.keys(variantData.checks || {}).forEach((name) => checkNames.add(name));
    }

    if (checkNames.size > 0) {
      const variantNames = Object.keys(data.binary_check_summary);
      const headers = ['Check', ...variantNames];
      lines.push('| ' + headers.join(' | ') + ' |');
      lines.push('| ' + headers.map(() => '---').join(' | ') + ' |');

      for (const checkName of checkNames) {
        const row = [checkName];
        for (const variantId of variantNames) {
          const checkData = data.binary_check_summary[variantId]?.checks?.[checkName];
          if (checkData && checkData.total > 0) {
            const pct = Math.round((checkData.passed / checkData.total) * 100);
            row.push(`${checkData.passed}/${checkData.total} (${pct}%)`);
          } else {
            row.push('N/A');
          }
        }
        lines.push('| ' + row.join(' | ') + ' |');
      }
      lines.push('');
    }
  }

  // Execution Time section
  if (data.timing_summary && Object.keys(data.timing_summary).length > 0) {
    lines.push('## Execution Time');
    lines.push('');
    lines.push('| Variant | Mean | Min | Max |');
    lines.push('|---------|------|-----|-----|');

    for (const [variantId, timing] of Object.entries(data.timing_summary)) {
      if (timing.samples > 0) {
        lines.push(`| ${variantId} | ${timing.mean}s | ${timing.min}s | ${timing.max}s |`);
      } else {
        lines.push(`| ${variantId} | N/A | N/A | N/A |`);
      }
    }
    lines.push('');
  }

  // Session Details section
  if (data.session_details && data.session_details.length > 0) {
    lines.push('## Session Details');
    lines.push('');
    lines.push('| Variant | Run | Session ID | Status | Duration | Checks Passed | Workspace |');
    lines.push('|---------|-----|------------|--------|----------|---------------|-----------|');

    for (const session of data.session_details) {
      const duration = session.duration_seconds !== null ? `${session.duration_seconds}s` : 'N/A';
      const checks =
        session.binary_checks_total > 0
          ? `${session.binary_checks_passed}/${session.binary_checks_total}`
          : 'N/A';
      const workspace = session.workspace_dir ? `\`${session.workspace_dir}\`` : 'N/A';
      lines.push(
        `| ${session.variant_id} | ${session.run_index} | ${session.session_id} | ${session.status} | ${duration} | ${checks} | ${workspace} |`
      );
    }
    lines.push('');
  }

  // Per-rubric analysis
  const rubrics = new Set();
  for (const stats of Object.values(data.variants)) {
    if (stats.by_rubric) {
      Object.keys(stats.by_rubric).forEach((r) => rubrics.add(r));
    }
  }

  if (rubrics.size > 0) {
    lines.push('## Per-Rubric Analysis');
    lines.push('');

    for (const rubric of rubrics) {
      lines.push(`### ${rubric}`);
      lines.push('');
      lines.push('| Variant | Mean | Median | Min | Max |');
      lines.push('|---------|------|--------|-----|-----|');

      for (const [variant, stats] of Object.entries(data.variants)) {
        const rubricStats = stats.by_rubric?.[rubric];
        if (rubricStats) {
          lines.push(
            `| ${variant} | ${rubricStats.mean} | ${rubricStats.median} | ${rubricStats.min} | ${rubricStats.max} |`
          );
        }
      }
      lines.push('');
    }
  }

  // Raw scores section
  lines.push('## Raw Scores');
  lines.push('');

  for (const [variant, stats] of Object.entries(data.variants)) {
    lines.push(`### ${variant}`);
    lines.push('');

    if (stats.raw_sessions && stats.raw_sessions.length > 0) {
      // Build header with all rubric columns
      const rubricColumns = new Set();
      for (const session of stats.raw_sessions) {
        Object.keys(session.scores).forEach((r) => rubricColumns.add(r));
      }

      const headers = ['Session', ...rubricColumns];
      lines.push('| ' + headers.join(' | ') + ' |');
      lines.push('| ' + headers.map(() => '---').join(' | ') + ' |');

      for (const session of stats.raw_sessions) {
        const row = [session.sessionId];
        for (const rubric of rubricColumns) {
          row.push(session.scores[rubric] ?? '-');
        }
        lines.push('| ' + row.join(' | ') + ' |');
      }
    } else {
      lines.push('No session data available.');
    }
    lines.push('');
  }

  // Methodology section
  lines.push('## Methodology');
  lines.push('');

  if (data.methodology) {
    if (data.methodology.model) {
      lines.push(`- Model: ${data.methodology.model}`);
    }
    if (data.methodology.rubrics) {
      lines.push(`- Rubrics: ${data.methodology.rubrics.join(', ')}`);
    }
  }

  const sessionsPerVariant = Object.values(data.variants)[0]?.sessions || 'N/A';
  lines.push(`- Sessions per variant: ${sessionsPerVariant}`);

  if (data.generated_at) {
    lines.push(`- Generated: ${data.generated_at}`);
  }

  lines.push('');

  return lines.join('\n');
}

/**
 * Generate JSON output from aggregated data
 * @param {object} data - Report data
 * @returns {string} JSON string
 */
function generateJsonOutput(data) {
  const output = {
    eval_name: data.eval_name,
    generated_at: data.generated_at || new Date().toISOString(),
    variants: {},
    comparison: data.comparison || null
  };

  for (const [variant, stats] of Object.entries(data.variants)) {
    output.variants[variant] = {
      sessions: stats.sessions,
      overall: stats.overall,
      by_rubric: stats.by_rubric
    };
  }

  // Include raw scores
  const rawScores = {};
  for (const [variant, stats] of Object.entries(data.variants)) {
    if (stats.raw_sessions) {
      rawScores[variant] = stats.raw_sessions.map((s) => ({
        session: s.sessionId,
        scores: s.scores
      }));
    }
  }
  if (Object.keys(rawScores).length > 0) {
    output.raw_scores = rawScores;
  }

  // Include binary check summary
  if (data.binary_check_summary && Object.keys(data.binary_check_summary).length > 0) {
    output.binary_check_summary = data.binary_check_summary;
  }

  // Include timing summary
  if (data.timing_summary && Object.keys(data.timing_summary).length > 0) {
    output.timing_summary = data.timing_summary;
  }

  // Include session details
  if (data.session_details && data.session_details.length > 0) {
    output.session_details = data.session_details;
  }

  // Include comparative results (A/B testing)
  if (data.comparative_results && data.comparative_results.total > 0) {
    output.comparative_results = {
      total: data.comparative_results.total,
      overall: data.comparative_results.overall,
      byMargin: data.comparative_results.byMargin,
      score_difference: data.comparative_results.score_difference,
      byRubric: {}
    };

    // Simplify byRubric for JSON output (exclude full comparison objects)
    for (const [rubric, stats] of Object.entries(data.comparative_results.byRubric)) {
      output.comparative_results.byRubric[rubric] = {
        a_wins: stats.a_wins,
        b_wins: stats.b_wins,
        equivalent: stats.equivalent
      };
    }
  }

  // Include metrics summary
  if (data.metrics_summary && Object.keys(data.metrics_summary).length > 0) {
    const hasMetrics = Object.values(data.metrics_summary).some((m) => m.averages !== null);
    if (hasMetrics) {
      output.metrics_summary = {};
      for (const [variant, metrics] of Object.entries(data.metrics_summary)) {
        if (metrics.averages) {
          output.metrics_summary[variant] = metrics.averages;
        }
      }
    }
  }

  // Include baseline comparison results (framework vs vanilla Claude)
  if (data.baseline_results && data.baseline_results.total > 0) {
    output.baseline_results = {
      total: data.baseline_results.total,
      framework_improvement_rate: data.baseline_results.framework_improvement_rate,
      average_quality_delta: data.baseline_results.average_quality_delta,
      verdicts: data.baseline_results.verdicts,
      scores: data.baseline_results.scores,
      categories: data.baseline_results.categories,
      time_saved: data.baseline_results.time_saved,
      byRubric: {}
    };

    // Simplify byRubric for JSON output (exclude full comparison objects)
    for (const [rubric, stats] of Object.entries(data.baseline_results.byRubric)) {
      output.baseline_results.byRubric[rubric] = {
        framework_better: stats.framework_better,
        equivalent: stats.equivalent,
        baseline_better: stats.baseline_better,
        avg_quality_delta: stats.avg_quality_delta
      };
    }
  }

  return JSON.stringify(output, null, 2);
}

/**
 * Report progress to stderr
 * @param {string} message - Progress message
 * @param {object} options - Options including quiet mode
 */
function reportProgress(message, options = {}) {
  if (options.quiet) {
    return;
  }
  console.error(`[aggregate] ${message}`);
}

/**
 * Show help message
 */
function showHelp() {
  console.log(`Usage: node aggregate.js [options] <eval-results-dir>

Arguments:
  eval-results-dir   Directory containing eval results (from run-eval.js)

Options:
  --output FILE      Output report file (default: <eval-results-dir>/report.md)
  --format FORMAT    Output format: markdown, json, both (default: markdown)
  --significance N   p-value threshold for highlighting (default: 0.05)
  --quiet            Suppress progress output
  --help             Show this help

Examples:
  node aggregate.js results/my-eval-2026-01-13/
  node aggregate.js results/python-skill/ --format json
  node aggregate.js results/test/ --output custom-report.md --format both`);
}

/**
 * Main run function
 * @param {string[]} args - Command line arguments
 * @returns {Promise<object>} Result object with exitCode and optional error
 */
async function run(args) {
  const parsedArgs = parseArgs(args);

  // Handle help
  if (parsedArgs.help) {
    showHelp();
    return { exitCode: 0 };
  }

  // Validate results directory provided
  if (!parsedArgs.resultsDir) {
    return {
      exitCode: 1,
      error: 'Error: eval results directory argument is required\n\nRun with --help for usage information.'
    };
  }

  // Check results directory exists
  if (!fs.existsSync(parsedArgs.resultsDir)) {
    return {
      exitCode: 1,
      error: `Error: Results directory not found: ${parsedArgs.resultsDir}`
    };
  }

  reportProgress(`Collecting scores from ${parsedArgs.resultsDir}`, parsedArgs);

  // Collect and aggregate scores
  const collectedScores = collectScores(parsedArgs.resultsDir);
  const aggregated = aggregateByVariant(collectedScores);

  reportProgress(`Found ${Object.keys(aggregated).length} variants`, parsedArgs);

  // Compare variants
  const comparison = compareVariants(aggregated, parsedArgs.significance);

  // Load sessions.json for additional data
  const sessionsData = loadSessionsJson(parsedArgs.resultsDir);

  // Try to get eval name from sessions.json
  let evalName = path.basename(parsedArgs.resultsDir);
  if (sessionsData && sessionsData.eval_name) {
    evalName = sessionsData.eval_name;
  }

  // Collect binary check summary
  const binaryCheckSummary = aggregateBinaryChecks(sessionsData);
  reportProgress(`Collected binary check data for ${Object.keys(binaryCheckSummary).length} variants`, parsedArgs);

  // Collect timing data
  const timingSummary = collectTimingData(parsedArgs.resultsDir, sessionsData);
  reportProgress(`Collected timing data for ${Object.keys(timingSummary).length} variants`, parsedArgs);

  // Build session details
  const sessionDetails = buildSessionDetails(parsedArgs.resultsDir, sessionsData);
  reportProgress(`Built details for ${sessionDetails.length} sessions`, parsedArgs);

  // Collect comparative results (from judge.js --compare mode)
  const comparisons = collectComparisons(parsedArgs.resultsDir);
  const comparativeResults = aggregateComparisons(comparisons);
  if (comparisons.all.length > 0) {
    reportProgress(`Collected ${comparisons.all.length} comparative evaluations`, parsedArgs);
  }

  // Collect baseline comparison results (from judge.js --compare --baseline mode)
  const baselineComparisons = collectBaselineComparisons(parsedArgs.resultsDir);
  const baselineResults = aggregateBaselineComparisons(baselineComparisons);
  if (baselineComparisons.all.length > 0) {
    reportProgress(`Collected ${baselineComparisons.all.length} baseline comparisons (framework improvement rate: ${baselineResults.framework_improvement_rate}%)`, parsedArgs);
  }

  // Collect metrics from score files
  const metricsSummary = aggregateMetrics(collectedScores, parsedArgs.resultsDir);
  const hasMetrics = Object.values(metricsSummary).some((m) => m.averages !== null);
  if (hasMetrics) {
    reportProgress(`Collected metrics for ${Object.keys(metricsSummary).length} variants`, parsedArgs);
  }

  // Get all rubrics for methodology
  const allRubrics = new Set();
  for (const stats of Object.values(aggregated)) {
    if (stats.by_rubric) {
      Object.keys(stats.by_rubric).forEach((r) => allRubrics.add(r));
    }
  }

  // Build report data
  const reportData = {
    eval_name: evalName,
    generated_at: new Date().toISOString(),
    variants: aggregated,
    comparison,
    comparative_results: comparativeResults,
    baseline_results: baselineResults,
    metrics_summary: metricsSummary,
    binary_check_summary: binaryCheckSummary,
    timing_summary: timingSummary,
    session_details: sessionDetails,
    methodology: {
      model: 'claude-opus-4-5-20251101',
      rubrics: Array.from(allRubrics)
    }
  };

  // Generate and write output
  const baseOutput = parsedArgs.output || path.join(parsedArgs.resultsDir, 'report');

  if (parsedArgs.format === 'markdown' || parsedArgs.format === 'both') {
    const mdPath = parsedArgs.output || `${baseOutput}.md`;
    const markdown = generateMarkdownReport(reportData);
    fs.writeFileSync(mdPath, markdown);
    reportProgress(`Wrote markdown report: ${mdPath}`, parsedArgs);
  }

  if (parsedArgs.format === 'json' || parsedArgs.format === 'both') {
    const jsonPath = parsedArgs.output
      ? parsedArgs.output.replace(/\.md$/, '.json')
      : `${baseOutput}.json`;
    const json = generateJsonOutput(reportData);
    fs.writeFileSync(jsonPath, json);
    reportProgress(`Wrote JSON report: ${jsonPath}`, parsedArgs);
  }

  reportProgress('Aggregation complete', parsedArgs);

  return { exitCode: 0 };
}

// Main entry point when run directly
if (require.main === module) {
  run(process.argv.slice(2))
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

// Export for testing
module.exports = {
  parseArgs,
  calculateStatistics,
  collectScores,
  collectComparisons,
  collectBaselineComparisons,
  aggregateByVariant,
  aggregateComparisons,
  aggregateBaselineComparisons,
  aggregateMetrics,
  compareVariants,
  generateMarkdownReport,
  generateJsonOutput,
  tTest,
  loadSessionsJson,
  loadSessionMetadata,
  calculateDuration,
  aggregateBinaryChecks,
  collectTimingData,
  buildSessionDetails,
  run
};
