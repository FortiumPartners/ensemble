#!/usr/bin/env node
/**
 * granular-report.js - Generate Detailed Comparison Reports
 *
 * Takes detailed-score.js outputs and generates a comprehensive comparison
 * showing all dimensions, variants, and metrics in a readable format.
 *
 * Usage: node granular-report.js <eval-results-dir> [options]
 *
 * Options:
 *   --format FORMAT    Output format: markdown, json, both (default: markdown)
 *   --output FILE      Output file (default: <eval-results-dir>/granular-report.md)
 *   --baseline ID      Baseline variant ID for comparison (default: 'baseline')
 *   --quiet            Suppress progress output
 *   --help             Show this help
 */

const fs = require('fs');
const path = require('path');

/**
 * Parse command line arguments
 */
function parseArgs(args) {
  const result = {
    evalDir: null,
    format: 'markdown',
    output: null,
    baseline: 'baseline',
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
      case '--format':
        result.format = args[++i];
        break;
      case '--output':
        result.output = args[++i];
        break;
      case '--baseline':
        result.baseline = args[++i];
        break;
      case '--quiet':
        result.quiet = true;
        break;
      default:
        if (!arg.startsWith('-') && !result.evalDir) {
          result.evalDir = arg;
        }
        break;
    }
  }

  return result;
}

/**
 * Load sessions.json to map session IDs to variant IDs
 * @param {string} evalDir - Eval results directory
 * @returns {Map} Session ID to variant info mapping
 */
function loadSessionMapping(evalDir) {
  const sessionsPath = path.join(evalDir, 'sessions.json');
  const mapping = new Map();

  if (!fs.existsSync(sessionsPath)) {
    return mapping;
  }

  try {
    const sessions = JSON.parse(fs.readFileSync(sessionsPath, 'utf8'));

    for (const variant of sessions.variants || []) {
      mapping.set(variant.session_id, {
        variant_id: variant.variant_id,
        run_index: variant.run_index || 0,
        status: variant.status,
        binary_checks: variant.binary_checks || []
      });
    }
  } catch (err) {
    // Return empty mapping on error
  }

  return mapping;
}

/**
 * Load detailed scores for all sessions in eval directory
 * @param {string} evalDir - Eval results directory
 * @returns {object} Scores by variant
 */
function loadDetailedScores(evalDir) {
  const sessionMapping = loadSessionMapping(evalDir);
  const scores = {};

  // Find all session directories
  const entries = fs.readdirSync(evalDir);

  for (const entry of entries) {
    const entryPath = path.join(evalDir, entry);
    const stat = fs.statSync(entryPath);

    if (!stat.isDirectory()) continue;

    // Check for detailed-scores.json
    const scoresPath = path.join(entryPath, 'detailed-scores.json');
    if (!fs.existsSync(scoresPath)) continue;

    try {
      const scoreData = JSON.parse(fs.readFileSync(scoresPath, 'utf8'));
      const sessionId = entry;

      // Get variant info from mapping
      const variantInfo = sessionMapping.get(sessionId);
      const variantId = variantInfo?.variant_id || sessionId;

      // Store by variant ID
      if (!scores[variantId]) {
        scores[variantId] = [];
      }

      scores[variantId].push({
        session_id: sessionId,
        run_index: variantInfo?.run_index || 0,
        binary_checks: variantInfo?.binary_checks || [],
        ...scoreData
      });
    } catch (err) {
      // Skip invalid score files
    }
  }

  return scores;
}

/**
 * Calculate aggregate statistics for a variant
 * @param {object[]} variantScores - Array of score objects for a variant
 * @returns {object} Aggregated stats
 */
function aggregateVariant(variantScores) {
  if (!variantScores || variantScores.length === 0) {
    return null;
  }

  const n = variantScores.length;

  // Aggregate overall scores
  const overallScores = variantScores
    .filter(s => s.overall_score !== null)
    .map(s => s.overall_score);

  // Aggregate by rubric
  const byRubric = {};
  const rubricNames = new Set();

  for (const score of variantScores) {
    for (const [rubric, data] of Object.entries(score.by_rubric || {})) {
      rubricNames.add(rubric);
      if (!byRubric[rubric]) {
        byRubric[rubric] = {
          scores: [],
          dimensions: {}
        };
      }
      if (data.score !== null) {
        byRubric[rubric].scores.push(data.score);
      }

      // Aggregate dimensions
      for (const [dim, value] of Object.entries(data.dimensions || {})) {
        if (!byRubric[rubric].dimensions[dim]) {
          byRubric[rubric].dimensions[dim] = [];
        }
        if (typeof value === 'number') {
          byRubric[rubric].dimensions[dim].push(value);
        }
      }
    }
  }

  // Calculate means
  const rubricAggregates = {};
  for (const [rubric, data] of Object.entries(byRubric)) {
    const dimMeans = {};
    for (const [dim, values] of Object.entries(data.dimensions)) {
      if (values.length > 0) {
        dimMeans[dim] = values.reduce((a, b) => a + b, 0) / values.length;
      }
    }

    rubricAggregates[rubric] = {
      mean: data.scores.length > 0 ? data.scores.reduce((a, b) => a + b, 0) / data.scores.length : null,
      n: data.scores.length,
      dimensions: dimMeans
    };
  }

  // Aggregate tokens and timing
  const totalTokensIn = variantScores.reduce((sum, s) => sum + (s.token_usage?.input_tokens || 0), 0);
  const totalTokensOut = variantScores.reduce((sum, s) => sum + (s.token_usage?.output_tokens || 0), 0);
  const totalDuration = variantScores.reduce((sum, s) => sum + (s.timing?.duration_seconds || 0), 0);

  // Aggregate binary checks
  const binaryChecks = {};
  for (const score of variantScores) {
    for (const check of score.binary_checks || []) {
      if (!binaryChecks[check.name]) {
        binaryChecks[check.name] = { passed: 0, total: 0 };
      }
      binaryChecks[check.name].total++;
      if (check.passed) {
        binaryChecks[check.name].passed++;
      }
    }
  }

  return {
    n,
    overall: {
      mean: overallScores.length > 0 ? overallScores.reduce((a, b) => a + b, 0) / overallScores.length : null,
      min: overallScores.length > 0 ? Math.min(...overallScores) : null,
      max: overallScores.length > 0 ? Math.max(...overallScores) : null
    },
    by_rubric: rubricAggregates,
    tokens: {
      mean_input: Math.round(totalTokensIn / n),
      mean_output: Math.round(totalTokensOut / n),
      mean_total: Math.round((totalTokensIn + totalTokensOut) / n)
    },
    timing: {
      mean_seconds: Math.round(totalDuration / n)
    },
    binary_checks: binaryChecks
  };
}

/**
 * Generate markdown report
 * @param {object} data - Report data
 * @param {string} baselineId - Baseline variant ID
 * @returns {string} Markdown content
 */
function generateMarkdown(data, baselineId) {
  const lines = [];

  lines.push(`# Granular Eval Report: ${data.eval_name}`);
  lines.push('');
  lines.push(`Generated: ${data.generated_at}`);
  lines.push('');

  // Summary table
  lines.push('## Summary');
  lines.push('');
  lines.push('| Variant | Overall | Code Quality | Test Quality | Architecture | Error Handling | Tokens | Duration |');
  lines.push('|---------|---------|--------------|--------------|--------------|----------------|--------|----------|');

  const baseline = data.variants[baselineId];

  for (const [variantId, stats] of Object.entries(data.variants)) {
    const overall = stats.overall?.mean?.toFixed(2) || 'N/A';
    const codeQuality = stats.by_rubric?.['code-quality']?.mean?.toFixed(2) || 'N/A';
    const testQuality = stats.by_rubric?.['test-quality']?.mean?.toFixed(2) || 'N/A';
    const architecture = stats.by_rubric?.['architecture']?.mean?.toFixed(2) || 'N/A';
    const errorHandling = stats.by_rubric?.['error-handling']?.mean?.toFixed(2) || 'N/A';
    const tokens = stats.tokens?.mean_total || 'N/A';
    const duration = stats.timing?.mean_seconds ? `${stats.timing.mean_seconds}s` : 'N/A';

    // Add delta from baseline
    let overallDelta = '';
    if (baseline && variantId !== baselineId && stats.overall?.mean && baseline.overall?.mean) {
      const delta = stats.overall.mean - baseline.overall.mean;
      overallDelta = delta >= 0 ? ` (+${delta.toFixed(2)})` : ` (${delta.toFixed(2)})`;
    }

    lines.push(`| ${variantId} | ${overall}${overallDelta} | ${codeQuality} | ${testQuality} | ${architecture} | ${errorHandling} | ${tokens} | ${duration} |`);
  }

  lines.push('');

  // Detailed dimension breakdown
  lines.push('## Dimension Breakdown');
  lines.push('');

  const rubrics = ['code-quality', 'test-quality', 'architecture', 'error-handling'];

  for (const rubric of rubrics) {
    const rubricTitle = rubric.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    lines.push(`### ${rubricTitle}`);
    lines.push('');

    // Get all dimensions for this rubric
    const allDimensions = new Set();
    for (const stats of Object.values(data.variants)) {
      const dims = stats.by_rubric?.[rubric]?.dimensions || {};
      Object.keys(dims).forEach(d => allDimensions.add(d));
    }

    if (allDimensions.size === 0) {
      lines.push('*No data available*');
      lines.push('');
      continue;
    }

    // Build dimension header
    const dimArray = Array.from(allDimensions);
    const header = '| Variant | Score | ' + dimArray.map(d => d.replace(/_/g, ' ')).join(' | ') + ' |';
    const separator = '|---------|-------|' + dimArray.map(() => '---').join('|') + '|';

    lines.push(header);
    lines.push(separator);

    for (const [variantId, stats] of Object.entries(data.variants)) {
      const rubricData = stats.by_rubric?.[rubric] || {};
      const score = rubricData.mean?.toFixed(2) || 'N/A';
      const dims = rubricData.dimensions || {};

      const dimValues = dimArray.map(d => {
        const val = dims[d];
        return val !== undefined ? val.toFixed(1) : 'N/A';
      });

      lines.push(`| ${variantId} | ${score} | ${dimValues.join(' | ')} |`);
    }

    lines.push('');
  }

  // Binary checks
  lines.push('## Binary Checks (Pass Rate)');
  lines.push('');

  const allChecks = new Set();
  for (const stats of Object.values(data.variants)) {
    Object.keys(stats.binary_checks || {}).forEach(c => allChecks.add(c));
  }

  if (allChecks.size > 0) {
    const checksArray = Array.from(allChecks);
    const header = '| Variant | ' + checksArray.map(c => c.replace(/_/g, ' ')).join(' | ') + ' |';
    const separator = '|---------|' + checksArray.map(() => '---').join('|') + '|';

    lines.push(header);
    lines.push(separator);

    for (const [variantId, stats] of Object.entries(data.variants)) {
      const checks = stats.binary_checks || {};
      const values = checksArray.map(c => {
        const check = checks[c];
        if (!check) return 'N/A';
        return `${check.passed}/${check.total}`;
      });

      lines.push(`| ${variantId} | ${values.join(' | ')} |`);
    }
  } else {
    lines.push('*No binary check data available*');
  }

  lines.push('');

  // Resource usage (not included in quality score)
  lines.push('## Resource Usage (Not Scored)');
  lines.push('');
  lines.push('| Variant | Input Tokens | Output Tokens | Total Tokens | Duration |');
  lines.push('|---------|--------------|---------------|--------------|----------|');

  for (const [variantId, stats] of Object.entries(data.variants)) {
    const tokensIn = stats.tokens?.mean_input || 'N/A';
    const tokensOut = stats.tokens?.mean_output || 'N/A';
    const tokensTotal = stats.tokens?.mean_total || 'N/A';
    const duration = stats.timing?.mean_seconds ? `${stats.timing.mean_seconds}s` : 'N/A';

    lines.push(`| ${variantId} | ${tokensIn} | ${tokensOut} | ${tokensTotal} | ${duration} |`);
  }

  lines.push('');

  // Improvement summary
  if (baseline) {
    lines.push('## Improvement Analysis');
    lines.push('');
    lines.push(`Baseline variant: **${baselineId}** (score: ${baseline.overall?.mean?.toFixed(2) || 'N/A'})`);
    lines.push('');

    const improvements = [];
    for (const [variantId, stats] of Object.entries(data.variants)) {
      if (variantId === baselineId) continue;
      if (!stats.overall?.mean || !baseline.overall?.mean) continue;

      const delta = stats.overall.mean - baseline.overall.mean;
      const percent = (delta / baseline.overall.mean * 100).toFixed(1);

      improvements.push({
        variant: variantId,
        delta,
        percent,
        score: stats.overall.mean
      });
    }

    improvements.sort((a, b) => b.delta - a.delta);

    for (const imp of improvements) {
      const sign = imp.delta >= 0 ? '+' : '';
      const emoji = imp.delta > 0 ? '📈' : imp.delta < 0 ? '📉' : '➡️';
      lines.push(`- ${emoji} **${imp.variant}**: ${imp.score.toFixed(2)} (${sign}${imp.delta.toFixed(2)}, ${sign}${imp.percent}%)`);
    }

    if (improvements.length === 0) {
      lines.push('*No other variants to compare*');
    }
  }

  lines.push('');
  lines.push('---');
  lines.push('*Generated by granular-report.js*');

  return lines.join('\n');
}

/**
 * Show help
 */
function showHelp() {
  console.log(`Usage: node granular-report.js <eval-results-dir> [options]

Generate detailed comparison reports from detailed-score.js outputs.

Options:
  --format FORMAT    Output format: markdown, json, both (default: markdown)
  --output FILE      Output file (default: <eval-results-dir>/granular-report.md)
  --baseline ID      Baseline variant ID for comparison (default: 'baseline')
  --quiet            Suppress progress output
  --help             Show this help

Prerequisites:
  Run detailed-score.js on each session first to generate detailed-scores.json files.

Examples:
  node granular-report.js ./results/dev-loop-typescript_2026-01-15/
  node granular-report.js ./results/my-eval/ --baseline without-skills --format both`);
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

  if (!parsedArgs.evalDir) {
    return {
      exitCode: 1,
      error: 'Error: eval-results-dir argument is required\n\nRun with --help for usage information.'
    };
  }

  if (!fs.existsSync(parsedArgs.evalDir)) {
    return {
      exitCode: 1,
      error: `Error: Eval directory not found: ${parsedArgs.evalDir}`
    };
  }

  // Load sessions.json for eval name
  const sessionsPath = path.join(parsedArgs.evalDir, 'sessions.json');
  let evalName = path.basename(parsedArgs.evalDir);
  if (fs.existsSync(sessionsPath)) {
    try {
      const sessions = JSON.parse(fs.readFileSync(sessionsPath, 'utf8'));
      evalName = sessions.eval_name || evalName;
    } catch (err) {
      // Use directory name
    }
  }

  if (!parsedArgs.quiet) {
    console.error(`[granular-report] Processing: ${parsedArgs.evalDir}`);
  }

  // Load all detailed scores
  const scores = loadDetailedScores(parsedArgs.evalDir);

  if (Object.keys(scores).length === 0) {
    return {
      exitCode: 1,
      error: 'Error: No detailed-scores.json files found. Run detailed-score.js on sessions first.'
    };
  }

  if (!parsedArgs.quiet) {
    console.error(`[granular-report] Found ${Object.keys(scores).length} variants`);
  }

  // Aggregate each variant
  const aggregated = {};
  for (const [variantId, variantScores] of Object.entries(scores)) {
    aggregated[variantId] = aggregateVariant(variantScores);
  }

  // Build report data
  const reportData = {
    eval_name: evalName,
    generated_at: new Date().toISOString(),
    baseline_variant: parsedArgs.baseline,
    variants: aggregated
  };

  // Generate outputs
  const format = parsedArgs.format.toLowerCase();
  const basePath = parsedArgs.output || path.join(parsedArgs.evalDir, 'granular-report');

  if (format === 'json' || format === 'both') {
    const jsonPath = parsedArgs.output?.endsWith('.json') ? parsedArgs.output : `${basePath}.json`;
    fs.writeFileSync(jsonPath, JSON.stringify(reportData, null, 2));
    if (!parsedArgs.quiet) {
      console.error(`[granular-report] JSON saved: ${jsonPath}`);
    }
  }

  if (format === 'markdown' || format === 'both') {
    const mdContent = generateMarkdown(reportData, parsedArgs.baseline);
    const mdPath = parsedArgs.output?.endsWith('.md') ? parsedArgs.output : `${basePath}.md`;
    fs.writeFileSync(mdPath, mdContent);
    if (!parsedArgs.quiet) {
      console.error(`[granular-report] Markdown saved: ${mdPath}`);
    }
  }

  return { exitCode: 0, data: reportData };
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
  loadSessionMapping,
  loadDetailedScores,
  aggregateVariant,
  generateMarkdown,
  main
};
