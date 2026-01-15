#!/usr/bin/env node
/**
 * component-report.js - Additive Component-Level Scoring Report
 *
 * Shows all scoring components with additive totals (not averaged).
 * Also extracts agent/skill triggering evidence from session logs.
 *
 * Usage: node component-report.js <eval-results-dir> [options]
 *
 * Output format:
 * - Each rubric dimension scored 1-5 (shown individually)
 * - Total additive score per rubric (sum of dimensions)
 * - Grand total across all rubrics
 * - Agent/skill triggering confirmation from session logs
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
 * Extract agent and skill usage from session output
 * @param {string} sessionDir - Session directory
 * @returns {object} Agent/skill usage evidence
 */
function extractAgentSkillUsage(sessionDir) {
  const sessionLogPath = path.join(sessionDir, 'session.jsonl');
  const workspaceDir = path.join(sessionDir, 'workspace');

  const result = {
    agents_detected: [],
    skills_detected: [],
    has_claude_dir: false,
    has_agents_dir: false,
    has_skills_dir: false,
    has_commands_dir: false,
    setting_sources: 'unknown',
    evidence: []
  };

  // Check workspace structure
  if (fs.existsSync(workspaceDir)) {
    const claudeDir = path.join(workspaceDir, '.claude');
    result.has_claude_dir = fs.existsSync(claudeDir);

    if (result.has_claude_dir) {
      result.has_agents_dir = fs.existsSync(path.join(claudeDir, 'agents'));
      result.has_skills_dir = fs.existsSync(path.join(claudeDir, 'skills'));
      result.has_commands_dir = fs.existsSync(path.join(claudeDir, 'commands'));

      // Count agents/skills available
      if (result.has_agents_dir) {
        try {
          const agents = fs.readdirSync(path.join(claudeDir, 'agents'))
            .filter(f => f.endsWith('.md'));
          result.agents_available = agents.map(a => a.replace('.md', ''));
        } catch (e) {
          result.agents_available = [];
        }
      }

      if (result.has_skills_dir) {
        try {
          const skills = fs.readdirSync(path.join(claudeDir, 'skills'))
            .filter(f => fs.statSync(path.join(claudeDir, 'skills', f)).isDirectory());
          result.skills_available = skills;
        } catch (e) {
          result.skills_available = [];
        }
      }
    }
  }

  // Check metadata for execution settings
  const metadataPath = path.join(sessionDir, 'metadata.json');
  if (fs.existsSync(metadataPath)) {
    try {
      const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
      result.variant = metadata.variant;
      result.fixture = metadata.fixture;
      result.execution_mode = metadata.execution_mode;
    } catch (e) {
      // Ignore
    }
  }

  // Parse session log for agent/skill invocations
  if (fs.existsSync(sessionLogPath)) {
    try {
      const content = fs.readFileSync(sessionLogPath, 'utf8');

      // Known agent patterns
      const agentPatterns = [
        /(?:delegat(?:e|ed|ing) to|spawn(?:ed|ing)?|using agent|@)(verify-app|code-simplifier|code-reviewer|backend-developer|frontend-developer|app-debugger|devops-engineer)/gi,
        /Task tool.*subagent_type[=:]?\s*["']?(\w+-?\w+)["']?/gi,
        /agent[:\s]+["']?(\w+-?\w+)["']?/gi
      ];

      // Known skill patterns
      const skillPatterns = [
        /Skill tool.*skill[=:]?\s*["']?([a-z-]+)["']?/gi,
        /invoke(?:d|ing)?\s+(?:skill\s+)?["']?([a-z-]+)["']?\s+skill/gi,
        /using\s+(?:the\s+)?["']?([a-z-]+)["']?\s+skill/gi,
        /developing-with-(\w+)/gi,
        /pytest|jest|rspec|exunit|xunit/gi
      ];

      for (const pattern of agentPatterns) {
        let match;
        while ((match = pattern.exec(content)) !== null) {
          const agent = match[1].toLowerCase();
          if (!result.agents_detected.includes(agent)) {
            result.agents_detected.push(agent);
            result.evidence.push(`Agent: ${agent}`);
          }
        }
      }

      for (const pattern of skillPatterns) {
        let match;
        while ((match = pattern.exec(content)) !== null) {
          const skill = match[1] ? match[1].toLowerCase() : match[0].toLowerCase();
          if (!result.skills_detected.includes(skill)) {
            result.skills_detected.push(skill);
            result.evidence.push(`Skill: ${skill}`);
          }
        }
      }
    } catch (e) {
      // Ignore parse errors
    }
  }

  return result;
}

/**
 * Load sessions.json mapping
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
 * Load detailed scores with agent/skill analysis
 */
function loadDetailedScoresWithAnalysis(evalDir) {
  const sessionMapping = loadSessionMapping(evalDir);
  const scores = {};

  const entries = fs.readdirSync(evalDir);

  for (const entry of entries) {
    const entryPath = path.join(evalDir, entry);
    const stat = fs.statSync(entryPath);

    if (!stat.isDirectory()) continue;

    const scoresPath = path.join(entryPath, 'detailed-scores.json');
    if (!fs.existsSync(scoresPath)) continue;

    try {
      const scoreData = JSON.parse(fs.readFileSync(scoresPath, 'utf8'));
      const sessionId = entry;

      // Get variant info
      const variantInfo = sessionMapping.get(sessionId);
      const variantId = variantInfo?.variant_id || sessionId;

      // Get agent/skill analysis
      const agentSkillAnalysis = extractAgentSkillUsage(entryPath);

      if (!scores[variantId]) {
        scores[variantId] = [];
      }

      scores[variantId].push({
        session_id: sessionId,
        run_index: variantInfo?.run_index || 0,
        binary_checks: variantInfo?.binary_checks || [],
        agent_skill_analysis: agentSkillAnalysis,
        ...scoreData
      });
    } catch (err) {
      // Skip invalid
    }
  }

  return scores;
}

/**
 * Calculate component totals (additive, not averaged)
 * @param {object[]} variantScores - Array of score objects
 * @returns {object} Component totals
 */
function calculateComponentTotals(variantScores) {
  if (!variantScores || variantScores.length === 0) {
    return null;
  }

  const n = variantScores.length;
  const rubrics = ['code-quality', 'test-quality', 'architecture', 'error-handling'];

  // Define dimension weights/multipliers (all equal for now)
  const dimensionConfig = {
    'code-quality': {
      dimensions: ['readability', 'maintainability', 'correctness', 'best_practices'],
      maxPerDimension: 5
    },
    'test-quality': {
      dimensions: ['coverage', 'structure', 'assertions', 'best_practices'],
      maxPerDimension: 5
    },
    'architecture': {
      dimensions: ['separation_of_concerns', 'dependency_direction', 'pattern_usage', 'anti_patterns'],
      maxPerDimension: 5
    },
    'error-handling': {
      dimensions: ['input_validation', 'exception_handling', 'graceful_degradation', 'error_communication', 'resource_management'],
      maxPerDimension: 5
    }
  };

  const result = {
    n,
    runs: [],
    rubrics: {},
    grand_total: { sum: 0, max: 0, percent: 0 },
    agent_skill_summary: {
      agents_triggered: new Set(),
      skills_triggered: new Set(),
      has_framework_structure: 0,
      runs_analyzed: 0
    }
  };

  // Process each run
  for (const score of variantScores) {
    const runData = {
      session_id: score.session_id,
      run_index: score.run_index,
      rubrics: {},
      total: { sum: 0, max: 0 },
      agent_skill: score.agent_skill_analysis
    };

    // Track agent/skill usage
    if (score.agent_skill_analysis) {
      result.agent_skill_summary.runs_analyzed++;
      if (score.agent_skill_analysis.has_claude_dir) {
        result.agent_skill_summary.has_framework_structure++;
      }
      for (const agent of score.agent_skill_analysis.agents_detected || []) {
        result.agent_skill_summary.agents_triggered.add(agent);
      }
      for (const skill of score.agent_skill_analysis.skills_detected || []) {
        result.agent_skill_summary.skills_triggered.add(skill);
      }
    }

    // Process each rubric
    for (const rubric of rubrics) {
      const config = dimensionConfig[rubric];
      const rubricData = score.by_rubric?.[rubric] || {};
      const dimensions = rubricData.dimensions || {};

      const rubricResult = {
        dimensions: {},
        sum: 0,
        max: config.dimensions.length * config.maxPerDimension,
        missing: []
      };

      for (const dim of config.dimensions) {
        const value = dimensions[dim];
        if (typeof value === 'number') {
          rubricResult.dimensions[dim] = value;
          rubricResult.sum += value;
        } else {
          rubricResult.dimensions[dim] = null;
          rubricResult.missing.push(dim);
        }
      }

      runData.rubrics[rubric] = rubricResult;
      runData.total.sum += rubricResult.sum;
      runData.total.max += rubricResult.max;
    }

    result.runs.push(runData);
  }

  // Aggregate across runs
  for (const rubric of rubrics) {
    const config = dimensionConfig[rubric];
    const rubricAgg = {
      dimensions: {},
      sum: { values: [], mean: 0, min: 0, max: 0 },
      max_possible: config.dimensions.length * config.maxPerDimension
    };

    for (const dim of config.dimensions) {
      rubricAgg.dimensions[dim] = { values: [], mean: 0, min: 0, max: 0 };
    }

    for (const run of result.runs) {
      const runRubric = run.rubrics[rubric];
      rubricAgg.sum.values.push(runRubric.sum);

      for (const dim of config.dimensions) {
        const val = runRubric.dimensions[dim];
        if (val !== null) {
          rubricAgg.dimensions[dim].values.push(val);
        }
      }
    }

    // Calculate stats
    if (rubricAgg.sum.values.length > 0) {
      rubricAgg.sum.mean = rubricAgg.sum.values.reduce((a, b) => a + b, 0) / rubricAgg.sum.values.length;
      rubricAgg.sum.min = Math.min(...rubricAgg.sum.values);
      rubricAgg.sum.max = Math.max(...rubricAgg.sum.values);
    }

    for (const dim of config.dimensions) {
      const vals = rubricAgg.dimensions[dim].values;
      if (vals.length > 0) {
        rubricAgg.dimensions[dim].mean = vals.reduce((a, b) => a + b, 0) / vals.length;
        rubricAgg.dimensions[dim].min = Math.min(...vals);
        rubricAgg.dimensions[dim].max = Math.max(...vals);
      }
    }

    result.rubrics[rubric] = rubricAgg;
    result.grand_total.sum += rubricAgg.sum.mean;
    result.grand_total.max += rubricAgg.max_possible;
  }

  result.grand_total.percent = result.grand_total.max > 0
    ? Math.round((result.grand_total.sum / result.grand_total.max) * 100)
    : 0;

  // Convert Sets to arrays for serialization
  result.agent_skill_summary.agents_triggered = Array.from(result.agent_skill_summary.agents_triggered);
  result.agent_skill_summary.skills_triggered = Array.from(result.agent_skill_summary.skills_triggered);

  return result;
}

/**
 * Generate markdown report with component breakdown
 */
function generateMarkdown(data, baselineId) {
  const lines = [];

  lines.push(`# Component-Level Eval Report: ${data.eval_name}`);
  lines.push('');
  lines.push(`Generated: ${data.generated_at}`);
  lines.push(`Runs per variant: ${data.runs_per_variant || 'varies'}`);
  lines.push('');

  // Grand totals summary
  lines.push('## Grand Total Summary');
  lines.push('');
  lines.push('| Variant | Total Score | Max Possible | % | Agent/Skill Triggering |');
  lines.push('|---------|-------------|--------------|---|------------------------|');

  const baseline = data.variants[baselineId];

  for (const [variantId, stats] of Object.entries(data.variants)) {
    const total = stats.grand_total.sum.toFixed(1);
    const max = stats.grand_total.max;
    const pct = stats.grand_total.percent;

    let delta = '';
    if (baseline && variantId !== baselineId) {
      const d = stats.grand_total.sum - baseline.grand_total.sum;
      delta = d >= 0 ? ` (+${d.toFixed(1)})` : ` (${d.toFixed(1)})`;
    }

    const agentSkill = stats.agent_skill_summary;
    let triggering = '';
    if (agentSkill.agents_triggered.length > 0) {
      triggering += `Agents: ${agentSkill.agents_triggered.join(', ')}`;
    }
    if (agentSkill.skills_triggered.length > 0) {
      if (triggering) triggering += '; ';
      triggering += `Skills: ${agentSkill.skills_triggered.join(', ')}`;
    }
    if (!triggering) {
      triggering = agentSkill.has_framework_structure > 0 ? 'Framework available, none triggered' : 'No framework (baseline)';
    }

    lines.push(`| ${variantId} | ${total}${delta} | ${max} | ${pct}% | ${triggering} |`);
  }

  lines.push('');

  // Component breakdown by rubric
  const rubrics = ['code-quality', 'test-quality', 'architecture', 'error-handling'];

  for (const rubric of rubrics) {
    const rubricTitle = rubric.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    lines.push(`## ${rubricTitle} Components`);
    lines.push('');

    // Get all dimensions for this rubric
    const allDimensions = new Set();
    for (const stats of Object.values(data.variants)) {
      const dims = stats.rubrics[rubric]?.dimensions || {};
      Object.keys(dims).forEach(d => allDimensions.add(d));
    }

    if (allDimensions.size === 0) {
      lines.push('*No data available*');
      lines.push('');
      continue;
    }

    const dimArray = Array.from(allDimensions);
    const header = '| Variant | ' + dimArray.map(d => d.replace(/_/g, ' ').substring(0, 12)).join(' | ') + ' | **Total** | Max |';
    const separator = '|---------|' + dimArray.map(() => '---').join('|') + '|---|---|';

    lines.push(header);
    lines.push(separator);

    for (const [variantId, stats] of Object.entries(data.variants)) {
      const rubricData = stats.rubrics[rubric] || {};
      const dims = rubricData.dimensions || {};
      const sum = rubricData.sum?.mean?.toFixed(1) || 'N/A';
      const maxPossible = rubricData.max_possible || 0;

      const dimValues = dimArray.map(d => {
        const dimData = dims[d];
        if (dimData && typeof dimData.mean === 'number') {
          return dimData.mean.toFixed(1);
        }
        return 'N/A';
      });

      lines.push(`| ${variantId} | ${dimValues.join(' | ')} | **${sum}** | ${maxPossible} |`);
    }

    lines.push('');

    // Show baseline comparison for this rubric
    if (baseline && baseline.rubrics[rubric]) {
      lines.push(`**Comparison to baseline:**`);
      for (const [variantId, stats] of Object.entries(data.variants)) {
        if (variantId === baselineId) continue;

        const rubricData = stats.rubrics[rubric] || {};
        const baselineRubric = baseline.rubrics[rubric] || {};

        const delta = (rubricData.sum?.mean || 0) - (baselineRubric.sum?.mean || 0);
        const sign = delta >= 0 ? '+' : '';
        const emoji = delta > 0 ? '📈' : delta < 0 ? '📉' : '➡️';

        // Find dimension changes
        const dimChanges = [];
        for (const dim of dimArray) {
          const v = rubricData.dimensions?.[dim]?.mean;
          const b = baselineRubric.dimensions?.[dim]?.mean;
          if (typeof v === 'number' && typeof b === 'number') {
            const d = v - b;
            if (Math.abs(d) >= 0.5) {
              const ds = d >= 0 ? `+${d.toFixed(1)}` : d.toFixed(1);
              dimChanges.push(`${dim.replace(/_/g, ' ')}: ${ds}`);
            }
          }
        }

        const changes = dimChanges.length > 0 ? ` (${dimChanges.join(', ')})` : '';
        lines.push(`- ${emoji} **${variantId}**: ${sign}${delta.toFixed(1)} total${changes}`);
      }
      lines.push('');
    }
  }

  // Framework structure verification
  lines.push('## Framework Structure Verification');
  lines.push('');
  lines.push('| Variant | .claude/ | agents/ | skills/ | commands/ | Agents Triggered | Skills Triggered |');
  lines.push('|---------|----------|---------|---------|-----------|------------------|------------------|');

  for (const [variantId, stats] of Object.entries(data.variants)) {
    const summary = stats.agent_skill_summary;
    const hasClaudeDir = summary.has_framework_structure > 0 ? '✅' : '❌';

    // Check first run for structure details
    const firstRun = stats.runs?.[0]?.agent_skill || {};
    const hasAgents = firstRun.has_agents_dir ? '✅' : '❌';
    const hasSkills = firstRun.has_skills_dir ? '✅' : '❌';
    const hasCommands = firstRun.has_commands_dir ? '✅' : '❌';

    const agentsTriggered = summary.agents_triggered.length > 0
      ? summary.agents_triggered.join(', ')
      : '(none)';
    const skillsTriggered = summary.skills_triggered.length > 0
      ? summary.skills_triggered.join(', ')
      : '(none)';

    lines.push(`| ${variantId} | ${hasClaudeDir} | ${hasAgents} | ${hasSkills} | ${hasCommands} | ${agentsTriggered} | ${skillsTriggered} |`);
  }

  lines.push('');
  lines.push('---');
  lines.push('*Generated by component-report.js*');

  return lines.join('\n');
}

/**
 * Show help
 */
function showHelp() {
  console.log(`Usage: node component-report.js <eval-results-dir> [options]

Generate component-level additive scoring reports.

Options:
  --format FORMAT    Output format: markdown, json, both (default: markdown)
  --output FILE      Output file (default: <eval-results-dir>/component-report.md)
  --baseline ID      Baseline variant ID for comparison (default: 'baseline')
  --quiet            Suppress progress output
  --help             Show this help

Output includes:
  - Individual component scores (not averaged)
  - Additive totals per rubric and grand total
  - Agent/skill triggering confirmation
  - Framework structure verification

Examples:
  node component-report.js ./results/dev-loop-typescript_2026-01-15/
  node component-report.js ./results/my-eval/ --format both`);
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

  // Load eval name
  const sessionsPath = path.join(parsedArgs.evalDir, 'sessions.json');
  let evalName = path.basename(parsedArgs.evalDir);
  let runsPerVariant = 1;
  if (fs.existsSync(sessionsPath)) {
    try {
      const sessions = JSON.parse(fs.readFileSync(sessionsPath, 'utf8'));
      evalName = sessions.eval_name || evalName;
      runsPerVariant = sessions.runs_per_variant || 1;
    } catch (err) {
      // Use defaults
    }
  }

  if (!parsedArgs.quiet) {
    console.error(`[component-report] Processing: ${parsedArgs.evalDir}`);
  }

  // Load scores with agent/skill analysis
  const scores = loadDetailedScoresWithAnalysis(parsedArgs.evalDir);

  if (Object.keys(scores).length === 0) {
    return {
      exitCode: 1,
      error: 'Error: No detailed-scores.json files found. Run detailed-score.js on sessions first.'
    };
  }

  if (!parsedArgs.quiet) {
    console.error(`[component-report] Found ${Object.keys(scores).length} variants`);
  }

  // Calculate component totals for each variant
  const aggregated = {};
  for (const [variantId, variantScores] of Object.entries(scores)) {
    aggregated[variantId] = calculateComponentTotals(variantScores);
  }

  // Build report data
  const reportData = {
    eval_name: evalName,
    generated_at: new Date().toISOString(),
    runs_per_variant: runsPerVariant,
    baseline_variant: parsedArgs.baseline,
    variants: aggregated
  };

  // Generate outputs
  const format = parsedArgs.format.toLowerCase();
  const basePath = parsedArgs.output || path.join(parsedArgs.evalDir, 'component-report');

  if (format === 'json' || format === 'both') {
    const jsonPath = parsedArgs.output?.endsWith('.json') ? parsedArgs.output : `${basePath}.json`;
    fs.writeFileSync(jsonPath, JSON.stringify(reportData, null, 2));
    if (!parsedArgs.quiet) {
      console.error(`[component-report] JSON saved: ${jsonPath}`);
    }
  }

  if (format === 'markdown' || format === 'both') {
    const mdContent = generateMarkdown(reportData, parsedArgs.baseline);
    const mdPath = parsedArgs.output?.endsWith('.md') ? parsedArgs.output : `${basePath}.md`;
    fs.writeFileSync(mdPath, mdContent);
    if (!parsedArgs.quiet) {
      console.error(`[component-report] Markdown saved: ${mdPath}`);
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
  extractAgentSkillUsage,
  loadDetailedScoresWithAnalysis,
  calculateComponentTotals,
  generateMarkdown,
  main
};
