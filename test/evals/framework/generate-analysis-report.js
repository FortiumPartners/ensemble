#!/usr/bin/env node
/**
 * generate-analysis-report.js - Reproducible Analysis Report Generator
 *
 * Builds a comprehensive prompt from eval results and runs Claude to generate
 * an analysis report. Saves both the prompt and the output for reproducibility.
 *
 * Usage: node generate-analysis-report.js <results-dir> [options]
 *
 * Options:
 *   --output-dir DIR    Output directory (default: <results-dir>)
 *   --prompt-only       Generate prompt file without running Claude
 *   --quiet             Suppress progress output
 *   --help              Show this help
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPT_DIR = __dirname;
const CLAUDE_MODEL = 'claude-opus-4-5-20251101';

/**
 * Parse command line arguments
 */
function parseArgs(args) {
  const result = {
    resultsDir: null,
    outputDir: null,
    promptOnly: false,
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
      case '--output-dir':
        result.outputDir = args[++i];
        break;
      case '--prompt-only':
        result.promptOnly = true;
        break;
      case '--quiet':
        result.quiet = true;
        break;
      default:
        if (!arg.startsWith('-') && !result.resultsDir) {
          result.resultsDir = arg;
        }
        break;
    }
  }

  return result;
}

/**
 * Load all detailed-scores.json files from results directory
 */
function loadAllDetailedScores(resultsDir) {
  const scores = [];

  function walkDir(dir, variant = null) {
    if (!fs.existsSync(dir)) return;

    const entries = fs.readdirSync(dir);
    for (const entry of entries) {
      const fullPath = path.join(dir, entry);
      const stat = fs.statSync(fullPath);

      if (stat.isDirectory()) {
        // Check if this is a variant directory or session directory
        const detailedScorePath = path.join(fullPath, 'detailed-scores.json');
        if (fs.existsSync(detailedScorePath)) {
          try {
            const data = JSON.parse(fs.readFileSync(detailedScorePath, 'utf8'));
            scores.push({
              variant: variant || path.basename(dir),
              session_id: entry,
              ...data
            });
          } catch (err) {
            // Skip invalid files
          }
        } else {
          // Recurse into subdirectory
          walkDir(fullPath, entry);
        }
      }
    }
  }

  walkDir(resultsDir);
  return scores;
}

/**
 * Load metadata from sessions
 */
function loadSessionMetadata(resultsDir) {
  const metadata = [];

  function walkDir(dir) {
    if (!fs.existsSync(dir)) return;

    const entries = fs.readdirSync(dir);
    for (const entry of entries) {
      const fullPath = path.join(dir, entry);
      const stat = fs.statSync(fullPath);

      if (stat.isDirectory()) {
        const metadataPath = path.join(fullPath, 'metadata.json');
        if (fs.existsSync(metadataPath)) {
          try {
            const data = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
            metadata.push({
              session_id: entry,
              ...data
            });
          } catch (err) {
            // Skip invalid files
          }
        } else {
          walkDir(fullPath);
        }
      }
    }
  }

  walkDir(resultsDir);
  return metadata;
}

/**
 * Aggregate scores by variant
 */
function aggregateByVariant(scores) {
  const byVariant = {};

  for (const score of scores) {
    const variant = score.variant;
    if (!byVariant[variant]) {
      byVariant[variant] = {
        sessions: [],
        rubric_scores: {},
        dimension_scores: {},
        strengths: [],
        weaknesses: []
      };
    }

    byVariant[variant].sessions.push(score);

    // Aggregate rubric scores
    if (score.by_rubric) {
      for (const [rubric, rubricData] of Object.entries(score.by_rubric)) {
        if (!byVariant[variant].rubric_scores[rubric]) {
          byVariant[variant].rubric_scores[rubric] = [];
        }
        if (rubricData.score !== null) {
          byVariant[variant].rubric_scores[rubric].push(rubricData.score);
        }

        // Aggregate dimension scores
        if (rubricData.dimensions) {
          for (const [dim, dimData] of Object.entries(rubricData.dimensions)) {
            const dimKey = `${rubric}:${dim}`;
            if (!byVariant[variant].dimension_scores[dimKey]) {
              byVariant[variant].dimension_scores[dimKey] = [];
            }
            const dimScore = typeof dimData === 'object' ? dimData.score : dimData;
            if (typeof dimScore === 'number') {
              byVariant[variant].dimension_scores[dimKey].push(dimScore);
            }
          }
        }

        // Collect strengths and weaknesses
        if (rubricData.strengths) {
          byVariant[variant].strengths.push(...rubricData.strengths.map(s => ({ rubric, text: s })));
        }
        if (rubricData.weaknesses) {
          byVariant[variant].weaknesses.push(...rubricData.weaknesses.map(w => ({ rubric, text: w })));
        }
      }
    }
  }

  // Calculate statistics
  for (const variant of Object.keys(byVariant)) {
    const data = byVariant[variant];

    // Rubric statistics
    data.rubric_stats = {};
    for (const [rubric, scores] of Object.entries(data.rubric_scores)) {
      if (scores.length > 0) {
        const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
        const sum = scores.reduce((a, b) => a + b, 0);
        data.rubric_stats[rubric] = {
          mean: parseFloat(mean.toFixed(2)),
          sum: parseFloat(sum.toFixed(2)),
          count: scores.length,
          min: Math.min(...scores),
          max: Math.max(...scores)
        };
      }
    }

    // Dimension statistics
    data.dimension_stats = {};
    for (const [dim, scores] of Object.entries(data.dimension_scores)) {
      if (scores.length > 0) {
        const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
        data.dimension_stats[dim] = {
          mean: parseFloat(mean.toFixed(2)),
          count: scores.length
        };
      }
    }

    // Overall statistics
    const allRubricMeans = Object.values(data.rubric_stats).map(s => s.mean);
    if (allRubricMeans.length > 0) {
      data.overall = {
        mean: parseFloat((allRubricMeans.reduce((a, b) => a + b, 0) / allRubricMeans.length).toFixed(2)),
        sum: parseFloat(allRubricMeans.reduce((a, b) => a + b, 0).toFixed(2)),
        rubric_count: allRubricMeans.length
      };
    }
  }

  return byVariant;
}

/**
 * Build the analysis prompt
 */
function buildAnalysisPrompt(resultsDir, aggregatedData, metadata) {
  const evalName = path.basename(resultsDir);
  const variants = Object.keys(aggregatedData);

  let prompt = `# Ensemble Framework Evaluation Analysis

You are analyzing the results of an A/B evaluation comparing different development approaches:
- **baseline**: Vanilla Claude Code with no framework assistance
- **framework**: Claude Code with Ensemble framework (agents, skills, dev-loop)
- **full-workflow**: Complete PRD → TRD → implement-trd workflow

## Evaluation: ${evalName}

## Task
Analyze the evaluation results and provide:
1. **Executive Summary**: Key findings in 2-3 sentences
2. **Framework Effectiveness**: How much does the framework improve output quality?
3. **Component Analysis**: Which aspects (code quality, testing, architecture, error handling) benefit most?
4. **Dimension Breakdown**: Granular analysis of specific quality dimensions
5. **Strengths & Weaknesses**: Common patterns from the evaluations
6. **Recommendations**: Where should we focus framework improvements?

## Scoring System
- Scores use a base (1-5) + modifier (weak -0.25, solid 0, strong +0.25) system
- Each rubric (code-quality, test-quality, architecture, error-handling) contributes up to 5.25 points
- Total possible per session: ~21 points (4 rubrics × 5.25)
- Normalized score: (actual / max_possible) × 100

---

## Aggregated Results by Variant

`;

  // Add variant summaries
  for (const [variant, data] of Object.entries(aggregatedData)) {
    prompt += `### Variant: ${variant}\n\n`;
    prompt += `**Sessions**: ${data.sessions.length}\n`;

    if (data.overall) {
      prompt += `**Overall**: Mean ${data.overall.mean}/5, Sum ${data.overall.sum}/${data.rubric_count * 5.25} (${data.rubric_count} rubrics)\n\n`;
    }

    // Rubric breakdown
    prompt += `#### Rubric Scores\n\n`;
    prompt += `| Rubric | Mean | Sum | Min | Max | Sessions |\n`;
    prompt += `|--------|------|-----|-----|-----|----------|\n`;

    for (const [rubric, stats] of Object.entries(data.rubric_stats)) {
      prompt += `| ${rubric} | ${stats.mean} | ${stats.sum} | ${stats.min} | ${stats.max} | ${stats.count} |\n`;
    }
    prompt += `\n`;

    // Dimension breakdown (top dimensions)
    const dimEntries = Object.entries(data.dimension_stats)
      .sort((a, b) => b[1].mean - a[1].mean);

    if (dimEntries.length > 0) {
      prompt += `#### Dimension Scores (Sample)\n\n`;
      prompt += `| Dimension | Mean Score |\n`;
      prompt += `|-----------|------------|\n`;

      // Show top 10 and bottom 5
      const topDims = dimEntries.slice(0, 10);
      const bottomDims = dimEntries.slice(-5);

      for (const [dim, stats] of topDims) {
        prompt += `| ${dim} | ${stats.mean} |\n`;
      }
      if (dimEntries.length > 15) {
        prompt += `| ... | ... |\n`;
      }
      for (const [dim, stats] of bottomDims) {
        if (!topDims.find(d => d[0] === dim)) {
          prompt += `| ${dim} | ${stats.mean} |\n`;
        }
      }
      prompt += `\n`;
    }

    // Sample strengths/weaknesses
    if (data.strengths.length > 0) {
      prompt += `#### Common Strengths (Sample)\n\n`;
      const sampleStrengths = data.strengths.slice(0, 5);
      for (const s of sampleStrengths) {
        prompt += `- [${s.rubric}] ${s.text.substring(0, 200)}${s.text.length > 200 ? '...' : ''}\n`;
      }
      prompt += `\n`;
    }

    if (data.weaknesses.length > 0) {
      prompt += `#### Common Weaknesses (Sample)\n\n`;
      const sampleWeaknesses = data.weaknesses.slice(0, 5);
      for (const w of sampleWeaknesses) {
        prompt += `- [${w.rubric}] ${w.text.substring(0, 200)}${w.text.length > 200 ? '...' : ''}\n`;
      }
      prompt += `\n`;
    }

    prompt += `---\n\n`;
  }

  // Comparative analysis section
  if (variants.includes('baseline') && (variants.includes('framework') || variants.includes('full-workflow'))) {
    prompt += `## Comparative Analysis Request\n\n`;
    prompt += `Compare the variants and calculate:\n`;
    prompt += `1. **Quality Delta**: How much better is framework vs baseline? (points and percentage)\n`;
    prompt += `2. **Per-Rubric Improvement**: Which rubrics show the most improvement?\n`;
    prompt += `3. **Per-Dimension Improvement**: Which specific dimensions improved most?\n`;
    prompt += `4. **Statistical Significance**: With these sample sizes, how confident can we be?\n\n`;
  }

  prompt += `## Output Format

Provide your analysis in markdown format with:

1. **Executive Summary** (2-3 sentences)
2. **Framework Effectiveness Score** (percentage improvement over baseline)
3. **Rubric-by-Rubric Analysis** (table showing baseline vs framework scores)
4. **Top Improving Dimensions** (which specific quality aspects improved most)
5. **Top Areas for Framework Improvement** (where framework didn't help or hurt)
6. **Specific Recommendations** (actionable items for framework development)

Be specific and quantitative. Reference actual score differences.
`;

  return prompt;
}

/**
 * Run Claude to generate report
 */
function runClaude(prompt, options = {}) {
  if (!options.quiet) {
    console.error('[generate-analysis-report] Invoking Claude Opus 4.5...');
  }

  const result = spawnSync('claude', ['-p', prompt, '--model', CLAUDE_MODEL], {
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024,
    timeout: 600000
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`Claude CLI exited with code ${result.status}: ${result.stderr}`);
  }

  // Parse the response
  try {
    const response = JSON.parse(result.stdout.trim());
    return response.result || result.stdout;
  } catch (err) {
    return result.stdout;
  }
}

/**
 * Show help
 */
function showHelp() {
  console.log(`Usage: node generate-analysis-report.js <results-dir> [options]

Generate a comprehensive analysis report from eval results.
Saves both the prompt and output for reproducibility.

Options:
  --output-dir DIR    Output directory (default: <results-dir>)
  --prompt-only       Generate prompt file without running Claude
  --quiet             Suppress progress output
  --help              Show this help

Output Files:
  analysis-prompt.md    The exact prompt used (for reproducibility)
  ANALYSIS_REPORT.md    The generated analysis report

Examples:
  node generate-analysis-report.js test/evals/results/overnight-20260115/
  node generate-analysis-report.js ./results --prompt-only`);
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

  if (!parsedArgs.resultsDir) {
    return {
      exitCode: 1,
      error: 'Error: results-dir argument is required\n\nRun with --help for usage information.'
    };
  }

  if (!fs.existsSync(parsedArgs.resultsDir)) {
    return {
      exitCode: 1,
      error: `Error: Results directory not found: ${parsedArgs.resultsDir}`
    };
  }

  const outputDir = parsedArgs.outputDir || parsedArgs.resultsDir;

  if (!parsedArgs.quiet) {
    console.error(`[generate-analysis-report] Loading scores from: ${parsedArgs.resultsDir}`);
  }

  // Load all detailed scores
  const detailedScores = loadAllDetailedScores(parsedArgs.resultsDir);

  if (detailedScores.length === 0) {
    return {
      exitCode: 1,
      error: 'Error: No detailed-scores.json files found. Run detailed-score.js first.'
    };
  }

  if (!parsedArgs.quiet) {
    console.error(`[generate-analysis-report] Found ${detailedScores.length} scored sessions`);
  }

  // Load metadata
  const metadata = loadSessionMetadata(parsedArgs.resultsDir);

  // Aggregate by variant
  const aggregatedData = aggregateByVariant(detailedScores);

  if (!parsedArgs.quiet) {
    console.error(`[generate-analysis-report] Aggregated ${Object.keys(aggregatedData).length} variants`);
  }

  // Build prompt
  const prompt = buildAnalysisPrompt(parsedArgs.resultsDir, aggregatedData, metadata);

  // Save prompt for reproducibility
  const promptPath = path.join(outputDir, 'analysis-prompt.md');
  fs.writeFileSync(promptPath, prompt);

  if (!parsedArgs.quiet) {
    console.error(`[generate-analysis-report] Prompt saved to: ${promptPath}`);
  }

  if (parsedArgs.promptOnly) {
    console.log(promptPath);
    return { exitCode: 0 };
  }

  // Run Claude
  try {
    const report = runClaude(prompt, parsedArgs);

    // Save report
    const reportPath = path.join(outputDir, 'ANALYSIS_REPORT.md');
    fs.writeFileSync(reportPath, report);

    if (!parsedArgs.quiet) {
      console.error(`[generate-analysis-report] Report saved to: ${reportPath}`);
    }

    return { exitCode: 0 };
  } catch (err) {
    return {
      exitCode: 1,
      error: `Error generating report: ${err.message}`
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
  loadAllDetailedScores,
  loadSessionMetadata,
  aggregateByVariant,
  buildAnalysisPrompt,
  runClaude,
  main
};
