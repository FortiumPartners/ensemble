#!/usr/bin/env node
/**
 * judge.js - Claude Opus Code Evaluation Judge
 * TRD Task: TRD-TEST-070
 *
 * Judging component that uses Claude Opus to score collected code against rubrics.
 * Supports single-session evaluation, comparative A/B evaluation, and baseline-relative
 * evaluation for measuring framework improvement.
 *
 * Usage:
 *   Single session: node judge.js [options] <session-dir> <rubric>
 *   Comparative:    node judge.js --compare <session-dir-a> <session-dir-b> <rubric>
 *   Baseline:       node judge.js --compare <baseline> <framework> <rubric> --baseline <baseline>
 *
 * Arguments:
 *     session-dir        Session results directory from collect-results.sh
 *     rubric             Rubric name (e.g., "code-quality") or path to .md file
 *
 * Options:
 *     --compare          Enable comparative evaluation mode (A/B comparison)
 *     --baseline DIR     Treat session A as baseline for framework improvement analysis
 *     --rubrics-dir DIR  Directory containing rubrics (default: ../rubrics)
 *     --output-dir DIR   Output directory for scores (default: <session-dir>/scores)
 *     --all              Judge with all available rubrics
 *     --context FILE     Additional context file (e.g., source code for test judging)
 *     --retries N        Max retry attempts (default: 3)
 *     --quiet            Suppress progress output
 *     --dry-run          Show prompt without invoking Claude
 *     --help             Show this help
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

// Constants
const DEFAULT_RETRIES = 3;
const DEFAULT_RUBRICS_DIR = path.join(__dirname, '..', 'rubrics');

/**
 * Judge runs locally (sync) using Claude Opus 4.5 for code evaluation.
 *
 * This is intentionally different from eval session execution (run-session.sh)
 * which uses --remote for async cloud execution. The judge:
 * - Evaluates already-collected local artifacts (no tool use needed)
 * - Needs scores immediately for aggregation
 * - Uses a self-contained prompt (rubric + code → score)
 */
const CLAUDE_MODEL = 'claude-opus-4-5-20251101';

/**
 * Parse command line arguments
 * @param {string[]} args - Command line arguments
 * @returns {object} Parsed arguments object
 */
function parseArgs(args) {
  const result = {
    sessionDir: null,
    sessionDirA: null,  // For comparative mode
    sessionDirB: null,  // For comparative mode
    rubric: null,
    rubricsDir: DEFAULT_RUBRICS_DIR,
    outputDir: null,
    all: false,
    compare: false,     // Comparative evaluation mode
    baseline: null,     // Baseline session for baseline-relative comparison
    context: null,
    retries: DEFAULT_RETRIES,
    quiet: false,
    dryRun: false,
    help: false
  };

  const positionalArgs = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case '--help':
      case '-h':
        result.help = true;
        break;

      case '--compare':
        result.compare = true;
        break;

      case '--baseline':
        result.baseline = args[++i];
        break;

      case '--rubrics-dir':
        result.rubricsDir = args[++i];
        break;

      case '--output-dir':
        result.outputDir = args[++i];
        break;

      case '--all':
        result.all = true;
        break;

      case '--context':
        result.context = args[++i];
        break;

      case '--retries':
        result.retries = parseInt(args[++i], 10);
        break;

      case '--quiet':
        result.quiet = true;
        break;

      case '--dry-run':
        result.dryRun = true;
        break;

      default:
        // Collect positional arguments
        if (!arg.startsWith('-')) {
          positionalArgs.push(arg);
        }
        break;
    }
  }

  // Assign positional arguments based on mode
  if (result.compare) {
    // Comparative mode: <session-dir-a> <session-dir-b> <rubric>
    result.sessionDirA = positionalArgs[0] || null;
    result.sessionDirB = positionalArgs[1] || null;
    result.rubric = positionalArgs[2] || null;
  } else {
    // Single session mode: <session-dir> <rubric>
    result.sessionDir = positionalArgs[0] || null;
    result.rubric = positionalArgs[1] || null;
  }

  return result;
}

/**
 * Load rubric markdown content
 * @param {string} rubricNameOrPath - Rubric name or file path
 * @param {string} [rubricsDir] - Directory containing rubrics
 * @returns {string} Rubric markdown content
 */
function loadRubric(rubricNameOrPath, rubricsDir = DEFAULT_RUBRICS_DIR) {
  const absoluteRubricsDir = path.resolve(rubricsDir);
  let rubricPath;

  if (rubricNameOrPath.endsWith('.md') && fs.existsSync(rubricNameOrPath)) {
    rubricPath = path.resolve(rubricNameOrPath);
  } else {
    // Sanitize: remove path separators and .. sequences
    const sanitizedName = path.basename(rubricNameOrPath.replace(/\.\./g, ''));
    rubricPath = path.resolve(absoluteRubricsDir, `${sanitizedName}.md`);
  }

  const normalizedPath = path.normalize(rubricPath);

  // SECURITY: When using rubric name, validate path stays within rubricsDir
  if (!rubricNameOrPath.endsWith('.md')) {
    if (!normalizedPath.startsWith(absoluteRubricsDir + path.sep) &&
        normalizedPath !== absoluteRubricsDir) {
      throw new Error(`Security error: Rubric path escapes rubrics directory: ${rubricNameOrPath}`);
    }
  }

  if (!fs.existsSync(normalizedPath)) {
    throw new Error(`Rubric not found: ${normalizedPath}`);
  }

  return fs.readFileSync(normalizedPath, 'utf8');
}

/**
 * Load files from session directory
 * Supports two structures:
 * 1. collect-results.sh output: code/ and tests/ directories
 * 2. Direct workspace: workspace/ with src/ and test/ (or other project structures)
 *
 * @param {string} sessionDir - Session results directory
 * @returns {object} Object with code and test file arrays
 */
function loadSessionFiles(sessionDir) {
  const codeDir = path.join(sessionDir, 'code');
  const testsDir = path.join(sessionDir, 'tests');
  const workspaceDir = path.join(sessionDir, 'workspace');

  const result = {
    code: [],
    tests: []
  };

  // Check if collect-results.sh structure exists (code/ and tests/ directories)
  const hasCollectedStructure = fs.existsSync(codeDir) || fs.existsSync(testsDir);

  if (hasCollectedStructure) {
    // Load from collected structure
    if (fs.existsSync(codeDir)) {
      const codeFiles = collectFilesRecursively(codeDir);
      result.code = codeFiles.map((filepath) => ({
        filename: path.relative(codeDir, filepath),
        content: fs.readFileSync(filepath, 'utf8')
      }));
    }

    if (fs.existsSync(testsDir)) {
      const testFiles = collectFilesRecursively(testsDir);
      result.tests = testFiles.map((filepath) => ({
        filename: path.relative(testsDir, filepath),
        content: fs.readFileSync(filepath, 'utf8')
      }));
    }
  } else if (fs.existsSync(workspaceDir)) {
    // Load from workspace directory - extract code and tests from project structure
    const allFiles = collectFilesRecursively(workspaceDir);

    // Filter out node_modules, __pycache__, .git, etc.
    const excludePatterns = [
      'node_modules',
      '__pycache__',
      '.git',
      '.pytest_cache',
      'coverage',
      'dist',
      'build',
      '.venv',
      'venv'
    ];

    const filteredFiles = allFiles.filter((filepath) => {
      const relativePath = path.relative(workspaceDir, filepath);
      return !excludePatterns.some(
        (pattern) =>
          relativePath.includes(pattern + path.sep) ||
          relativePath.startsWith(pattern + path.sep)
      );
    });

    // Categorize files as code or tests
    for (const filepath of filteredFiles) {
      const relativePath = path.relative(workspaceDir, filepath);
      const filename = path.basename(filepath);
      const dirname = path.dirname(relativePath);

      // Skip non-code files
      if (!isCodeFile(filepath)) {
        continue;
      }

      // Read file content
      let content;
      try {
        content = fs.readFileSync(filepath, 'utf8');
      } catch (err) {
        continue; // Skip unreadable files
      }

      const fileObj = { filename: relativePath, content };

      // Determine if it's a test file based on common conventions
      const isTest =
        filename.startsWith('test_') ||
        filename.endsWith('_test.py') ||
        filename.endsWith('.test.js') ||
        filename.endsWith('.test.ts') ||
        filename.endsWith('.test.tsx') ||
        filename.endsWith('.spec.js') ||
        filename.endsWith('.spec.ts') ||
        filename.endsWith('_spec.rb') ||
        dirname.includes('test') ||
        dirname.includes('spec') ||
        dirname.includes('__tests__');

      if (isTest) {
        result.tests.push(fileObj);
      } else {
        result.code.push(fileObj);
      }
    }
  }

  return result;
}

/**
 * Check if a file is a code file based on extension
 * @param {string} filepath - File path to check
 * @returns {boolean} True if file is a code file
 */
function isCodeFile(filepath) {
  const codeExtensions = [
    '.py',
    '.js',
    '.ts',
    '.tsx',
    '.jsx',
    '.dart',
    '.rb',
    '.go',
    '.rs',
    '.java',
    '.kt',
    '.swift',
    '.c',
    '.cpp',
    '.h',
    '.hpp',
    '.cs',
    '.php',
    '.ex',
    '.exs'
  ];

  const ext = path.extname(filepath).toLowerCase();
  return codeExtensions.includes(ext);
}

/**
 * Recursively collect files from directory
 * @param {string} dir - Directory to scan
 * @returns {string[]} Array of file paths
 */
function collectFilesRecursively(dir) {
  const files = [];

  if (!fs.existsSync(dir)) {
    return files;
  }

  const entries = fs.readdirSync(dir);

  for (const entry of entries) {
    const fullPath = path.join(dir, entry);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory()) {
      files.push(...collectFilesRecursively(fullPath));
    } else if (stat.isFile()) {
      files.push(fullPath);
    }
  }

  return files;
}

/**
 * Build evaluation prompt from rubric and code files
 * @param {string} rubric - Rubric markdown content
 * @param {object[]} files - Array of file objects with filename and content
 * @param {object} [options] - Additional options
 * @param {string} [options.context] - Additional context content
 * @returns {string} Constructed prompt
 */
function buildPrompt(rubric, files, options = {}) {
  const codeBlocks = files
    .map(
      (file) =>
        `### File: ${file.filename}\n\n\`\`\`\n${file.content}\n\`\`\``
    )
    .join('\n\n');

  let prompt = `You are an expert code reviewer evaluating the quality of AI-generated code.

## Task
Evaluate the following code against the provided rubric.

## Code to Evaluate

${codeBlocks}

`;

  if (options.context) {
    prompt += `## Context (Source Code Being Tested)

\`\`\`
${options.context}
\`\`\`

`;
  }

  prompt += `## Rubric

${rubric}

## Instructions

1. Analyze the code carefully against each dimension in the rubric.
2. Think through your evaluation step by step.
3. Provide specific examples from the code to justify your assessment.
4. For each score, use the TWO-STEP SCORING METHOD below.
5. Estimate code metrics (lines of code, comment ratio, complexity, nesting depth).

## TWO-STEP SCORING METHOD

For EACH score (overall and per-dimension):

**Step 1: Pin the Base Score (1-5)**
Read the rubric definitions carefully. Determine which level (1-5) best describes the code.
The base score MUST match one of the rubric level definitions.

**Step 2: Apply Band Modifier**
Within that level, assess whether the code is:
- "weak": Barely meets this level, close to dropping down → subtract 0.25
- "solid": Clearly meets this level, typical example → no change
- "strong": Exceeds expectations for this level, close to next level up → add 0.25

**Final Score = Base Score + Modifier**
Examples: 3.75 (base 4, weak), 4.0 (base 4, solid), 4.25 (base 4, strong)

## Output Format

Respond in JSON format:
{
  "base_score": <1-5 integer from rubric>,
  "modifier": "<weak|solid|strong>",
  "score": <final score with modifier applied>,
  "justification": "<2-3 sentence summary of overall quality>",
  "dimension_scores": {
    "<dimension_name>": {
      "base": <1-5 integer>,
      "modifier": "<weak|solid|strong>",
      "score": <final score>
    },
    ...
  },
  "metrics": {
    "estimated_loc": <total lines of code>,
    "comment_ratio": <0.0-1.0 ratio of comment lines to total>,
    "complexity_estimate": "<low|moderate|high|very_high>",
    "max_nesting_depth": <maximum observed nesting depth>
  },
  "strengths": ["<specific strength with code example>", "..."],
  "weaknesses": ["<specific weakness with code example>", "..."],
  "reasoning": "<detailed step-by-step analysis>"
}

IMPORTANT: Respond with ONLY valid JSON, no additional text.`;

  return prompt;
}

/**
 * Build comparative evaluation prompt for A/B testing
 * @param {string} rubric - Rubric markdown content
 * @param {object[]} filesA - Array of file objects for session A
 * @param {object[]} filesB - Array of file objects for session B
 * @param {object} [options] - Additional options
 * @param {string} [options.context] - Additional context content
 * @returns {string} Constructed prompt
 */
function buildComparativePrompt(rubric, filesA, filesB, options = {}) {
  const codeBlocksA = filesA
    .map(
      (file) =>
        `### File: ${file.filename}\n\n\`\`\`\n${file.content}\n\`\`\``
    )
    .join('\n\n');

  const codeBlocksB = filesB
    .map(
      (file) =>
        `### File: ${file.filename}\n\n\`\`\`\n${file.content}\n\`\`\``
    )
    .join('\n\n');

  let prompt = `You are an expert code reviewer comparing two AI-generated code implementations side-by-side.

## Task
Compare the following two code implementations (A and B) against the provided rubric.
Determine if they are equivalent in quality, or if one is notably better than the other.

## Implementation A

${codeBlocksA}

## Implementation B

${codeBlocksB}

`;

  if (options.context) {
    prompt += `## Context (Original Requirements)

\`\`\`
${options.context}
\`\`\`

`;
  }

  prompt += `## Rubric

${rubric}

## Instructions

1. Analyze both implementations carefully against each dimension in the rubric.
2. Compare them directly - which handles each aspect better?
3. Focus on RELATIVE quality differences, not just absolute scores.
4. Consider: Are these effectively equivalent, or is one notably better?
5. Estimate code metrics for both implementations.

## Comparison Criteria

- **Architecture**: How well organized is the code? Separation of concerns?
- **Readability**: Which is easier to understand and maintain?
- **Correctness**: Which handles edge cases better? More robust?
- **Best Practices**: Which better follows language idioms and patterns?
- **Anti-patterns**: Does either contain god objects, circular deps, magic numbers?

## Output Format

Respond in JSON format:
{
  "verdict": "<equivalent|a_better|b_better>",
  "margin": "<slight|moderate|significant>",
  "score_a": <1-5>,
  "score_b": <1-5>,
  "metrics_a": {
    "estimated_loc": <total lines of code>,
    "comment_ratio": <0.0-1.0>,
    "complexity_estimate": "<low|moderate|high|very_high>",
    "max_nesting_depth": <number>
  },
  "metrics_b": {
    "estimated_loc": <total lines of code>,
    "comment_ratio": <0.0-1.0>,
    "complexity_estimate": "<low|moderate|high|very_high>",
    "max_nesting_depth": <number>
  },
  "dimension_comparison": {
    "<dimension_name>": {
      "winner": "<a|b|tie>",
      "reason": "<brief explanation>"
    },
    ...
  },
  "strengths_a": ["<specific strength with example>", "..."],
  "weaknesses_a": ["<specific weakness with example>", "..."],
  "strengths_b": ["<specific strength with example>", "..."],
  "weaknesses_b": ["<specific weakness with example>", "..."],
  "reasoning": "<detailed comparative analysis explaining the verdict>"
}

IMPORTANT:
- Focus on meaningful differences, not nitpicks
- "equivalent" means no practical difference in quality
- "slight" margin means minor differences that wouldn't matter much in practice
- "significant" margin means clear winner with meaningful quality gap
- Respond with ONLY valid JSON, no additional text.`;

  return prompt;
}

/**
 * Build baseline-relative comparison prompt
 * Session A is treated as the baseline (vanilla Claude with no assistance)
 * Session B is the framework-assisted output to evaluate
 *
 * @param {string} rubric - Rubric markdown content
 * @param {object[]} filesBaseline - Array of file objects for baseline session
 * @param {object[]} filesFramework - Array of file objects for framework session
 * @param {object} [options] - Additional options
 * @param {string} [options.context] - Additional context content
 * @returns {string} Constructed prompt
 */
function buildBaselineComparisonPrompt(rubric, filesBaseline, filesFramework, options = {}) {
  const codeBlocksBaseline = filesBaseline
    .map(
      (file) =>
        `### File: ${file.filename}\n\n\`\`\`\n${file.content}\n\`\`\``
    )
    .join('\n\n');

  const codeBlocksFramework = filesFramework
    .map(
      (file) =>
        `### File: ${file.filename}\n\n\`\`\`\n${file.content}\n\`\`\``
    )
    .join('\n\n');

  let prompt = `You are an expert code reviewer performing a BASELINE COMPARISON evaluation.

## Context

Session A represents BASELINE output from vanilla Claude with NO framework assistance.
Session B represents output with Ensemble framework assistance.

Your task is to evaluate whether the framework provides meaningful improvements over the baseline.

## BASELINE Implementation (Vanilla Claude - No Framework)

${codeBlocksBaseline}

## FRAMEWORK Implementation (With Ensemble Assistance)

${codeBlocksFramework}

`;

  if (options.context) {
    prompt += `## Original Requirements

\`\`\`
${options.context}
\`\`\`

`;
  }

  prompt += `## Rubric

${rubric}

## Instructions

1. Analyze both implementations against the rubric.
2. Determine if the FRAMEWORK output (B) provides improvements over the BASELINE (A).
3. Focus on VALUE ADDED by the framework:
   - Does it produce better code structure?
   - Does it include more comprehensive tests?
   - Does it have fewer bugs or edge case issues?
   - Does it follow best practices more consistently?
   - Would it save developer time/effort?
4. Be objective: if the framework doesn't help, say so.

## Evaluation Criteria

- **code_structure**: Organization, separation of concerns, modularity
- **test_coverage**: Presence and quality of tests
- **error_handling**: Edge cases, validation, error messages
- **documentation**: Comments, docstrings, README
- **best_practices**: Language idioms, patterns, anti-pattern avoidance

## Output Format

Respond in JSON format:
{
  "mode": "baseline_comparison",
  "baseline_session": "<session_a_identifier>",
  "framework_session": "<session_b_identifier>",
  "verdict": "<framework_better|equivalent|baseline_better>",
  "improvement": {
    "quality_delta": <0.0 to 3.0 scale, 0=same, positive=framework better>,
    "categories": {
      "code_structure": "<significantly_improved|improved|equivalent|degraded>",
      "test_coverage": "<significantly_improved|improved|equivalent|degraded>",
      "error_handling": "<significantly_improved|improved|equivalent|degraded>",
      "documentation": "<significantly_improved|improved|equivalent|degraded>",
      "best_practices": "<significantly_improved|improved|equivalent|degraded>"
    },
    "time_saved_estimate": "<none|minimal|moderate|significant>"
  },
  "score_baseline": <1-5>,
  "score_framework": <1-5>,
  "metrics_baseline": {
    "estimated_loc": <total lines of code>,
    "comment_ratio": <0.0-1.0>,
    "complexity_estimate": "<low|moderate|high|very_high>",
    "max_nesting_depth": <number>
  },
  "metrics_framework": {
    "estimated_loc": <total lines of code>,
    "comment_ratio": <0.0-1.0>,
    "complexity_estimate": "<low|moderate|high|very_high>",
    "max_nesting_depth": <number>
  },
  "specific_improvements": [
    "<concrete improvement with code example>",
    "..."
  ],
  "specific_regressions": [
    "<any areas where framework was worse>",
    "..."
  ],
  "reasoning": "<detailed analysis explaining why the framework did or did not help>"
}

IMPORTANT:
- quality_delta: 0 = equivalent, 0.5 = slight improvement, 1.0 = noticeable, 2.0 = significant, 3.0 = transformative
- Be critical: only credit genuine improvements, not superficial differences
- If baseline is better, explain what the framework got wrong
- Respond with ONLY valid JSON, no additional text.`;

  return prompt;
}

/**
 * Invoke Claude CLI for evaluation
 * @param {string} prompt - Evaluation prompt
 * @param {object} [options] - Invocation options
 * @param {number} [options.retries] - Max retry attempts
 * @returns {object} Parsed JSON response
 */
function invokeClaude(prompt, options = {}) {
  const maxRetries = options.retries || DEFAULT_RETRIES;
  let lastError;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const args = ['-p', prompt, '--model', CLAUDE_MODEL, '--output-format', 'json'];

      const result = spawnSync('claude', args, {
        encoding: 'utf8',
        maxBuffer: 50 * 1024 * 1024,
        timeout: 300000
      });

      if (result.error) throw result.error;
      if (result.status !== 0) {
        throw new Error(`Claude CLI exited with code ${result.status}: ${result.stderr}`);
      }

      // Parse the Claude CLI wrapper response
      const cliResponse = JSON.parse(result.stdout.trim());

      // Extract the actual model response from the 'result' field
      let modelText = cliResponse.result;

      // Handle empty response
      if (!modelText || modelText === '') {
        throw new Error(`Claude returned empty result. num_turns=${cliResponse.num_turns}, cost=$${cliResponse.total_cost_usd?.toFixed(4)}`);
      }

      // If modelText is a string, it may contain markdown code fences
      if (typeof modelText === 'string') {
        // Strip markdown code fences if present (```json ... ```)
        modelText = modelText.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');
        return JSON.parse(modelText.trim());
      }

      // If modelText is already an object, return it directly
      return modelText;
    } catch (error) {
      lastError = error;
      if (attempt < maxRetries) {
        console.error(`[judge] Attempt ${attempt} failed, retrying...`);
      }
    }
  }
  throw new Error(`Claude invocation failed after ${maxRetries} retries: ${lastError.message}`);
}

/**
 * Extract and validate score from Claude response
 * Supports both legacy format (score: N) and new format (base_score + modifier)
 * @param {object} response - Claude response object
 * @returns {object} Extracted score data
 */
function extractScore(response) {
  let score = response.score;
  let baseScore = response.base_score;
  let modifier = response.modifier;

  // Handle new format with base_score + modifier
  if (typeof baseScore === 'number') {
    // Validate base score is integer 1-5
    if (!Number.isInteger(baseScore) || baseScore < 1 || baseScore > 5) {
      throw new Error(`Invalid base_score value: ${baseScore}. Must be integer 1-5.`);
    }

    // Validate modifier
    const validModifiers = ['weak', 'solid', 'strong'];
    if (modifier && !validModifiers.includes(modifier)) {
      throw new Error(`Invalid modifier: ${modifier}. Must be one of: ${validModifiers.join(', ')}`);
    }

    // Calculate expected score if not provided or verify it matches
    const modifierValue = modifier === 'weak' ? -0.25 : modifier === 'strong' ? 0.25 : 0;
    const expectedScore = baseScore + modifierValue;

    if (typeof score !== 'number') {
      score = expectedScore;
    }
  }

  // Validate final score range (0.75 to 5.25 with modifier)
  if (typeof score !== 'number' || score < 0.75 || score > 5.25) {
    throw new Error(`Invalid score value: ${score}. Score must be between 0.75 and 5.25.`);
  }

  // Process dimension scores - handle both old and new format
  const dimensions = {};
  const rawDimensions = response.dimension_scores || {};

  for (const [dimName, dimValue] of Object.entries(rawDimensions)) {
    if (typeof dimValue === 'object' && dimValue !== null) {
      // New format: {base: N, modifier: "...", score: N.NN}
      dimensions[dimName] = {
        base: dimValue.base,
        modifier: dimValue.modifier,
        score: dimValue.score
      };
    } else if (typeof dimValue === 'number') {
      // Legacy format: just a number
      dimensions[dimName] = {
        base: Math.round(dimValue),
        modifier: 'solid',
        score: dimValue
      };
    }
  }

  // Calculate rubric_total as sum of dimension scores
  const dimensionScores = Object.values(dimensions).map(d => d.score);
  const rubricTotal = dimensionScores.length > 0
    ? parseFloat(dimensionScores.reduce((a, b) => a + b, 0).toFixed(2))
    : score;  // Fallback to overall score if no dimensions
  const dimensionCount = dimensionScores.length || 4;  // Default to 4 dimensions
  const rubricMax = parseFloat((dimensionCount * 5.25).toFixed(2));

  return {
    overall: score,  // Keep for backward compatibility
    base_score: baseScore || Math.round(score),
    modifier: modifier || 'solid',
    dimensions: dimensions,
    // New additive scoring fields
    rubric_total: rubricTotal,
    rubric_max: rubricMax,
    rubric_weight: 1.0,  // Equal weighting for now
    metrics: response.metrics || null
  };
}

/**
 * Extract and validate comparative result from Claude response
 * @param {object} response - Claude response object
 * @returns {object} Extracted comparison data
 */
function extractComparison(response) {
  const validVerdicts = ['equivalent', 'a_better', 'b_better'];
  const validMargins = ['slight', 'moderate', 'significant'];

  // Validate verdict
  if (!validVerdicts.includes(response.verdict)) {
    throw new Error(`Invalid verdict: ${response.verdict}. Must be one of: ${validVerdicts.join(', ')}`);
  }

  // Validate margin
  if (!validMargins.includes(response.margin)) {
    throw new Error(`Invalid margin: ${response.margin}. Must be one of: ${validMargins.join(', ')}`);
  }

  // Validate scores
  const scoreA = response.score_a;
  const scoreB = response.score_b;

  if (typeof scoreA !== 'number' || scoreA < 1 || scoreA > 5) {
    throw new Error(`Invalid score_a value: ${scoreA}. Score must be between 1 and 5.`);
  }

  if (typeof scoreB !== 'number' || scoreB < 1 || scoreB > 5) {
    throw new Error(`Invalid score_b value: ${scoreB}. Score must be between 1 and 5.`);
  }

  return {
    verdict: response.verdict,
    margin: response.margin,
    score_a: scoreA,
    score_b: scoreB,
    metrics_a: response.metrics_a || null,
    metrics_b: response.metrics_b || null,
    dimension_comparison: response.dimension_comparison || {},
    strengths_a: response.strengths_a || [],
    weaknesses_a: response.weaknesses_a || [],
    strengths_b: response.strengths_b || [],
    weaknesses_b: response.weaknesses_b || [],
    reasoning: response.reasoning || ''
  };
}

/**
 * Extract and validate baseline comparison result from Claude response
 * @param {object} response - Claude response object
 * @returns {object} Extracted baseline comparison data
 */
function extractBaselineComparison(response) {
  const validVerdicts = ['framework_better', 'equivalent', 'baseline_better'];
  const validCategoryValues = ['significantly_improved', 'improved', 'equivalent', 'degraded'];
  const validTimeSaved = ['none', 'minimal', 'moderate', 'significant'];

  // Validate verdict
  if (!validVerdicts.includes(response.verdict)) {
    throw new Error(`Invalid verdict: ${response.verdict}. Must be one of: ${validVerdicts.join(', ')}`);
  }

  // Validate scores
  const scoreBaseline = response.score_baseline;
  const scoreFramework = response.score_framework;

  if (typeof scoreBaseline !== 'number' || scoreBaseline < 1 || scoreBaseline > 5) {
    throw new Error(`Invalid score_baseline value: ${scoreBaseline}. Score must be between 1 and 5.`);
  }

  if (typeof scoreFramework !== 'number' || scoreFramework < 1 || scoreFramework > 5) {
    throw new Error(`Invalid score_framework value: ${scoreFramework}. Score must be between 1 and 5.`);
  }

  // Validate improvement object
  const improvement = response.improvement || {};
  const qualityDelta = typeof improvement.quality_delta === 'number' ? improvement.quality_delta : 0;

  // Validate categories if present
  const categories = improvement.categories || {};
  for (const [category, value] of Object.entries(categories)) {
    if (!validCategoryValues.includes(value)) {
      throw new Error(`Invalid category value for ${category}: ${value}. Must be one of: ${validCategoryValues.join(', ')}`);
    }
  }

  // Validate time_saved_estimate if present
  if (improvement.time_saved_estimate && !validTimeSaved.includes(improvement.time_saved_estimate)) {
    throw new Error(`Invalid time_saved_estimate: ${improvement.time_saved_estimate}. Must be one of: ${validTimeSaved.join(', ')}`);
  }

  return {
    mode: 'baseline_comparison',
    baseline_session: response.baseline_session || null,
    framework_session: response.framework_session || null,
    verdict: response.verdict,
    improvement: {
      quality_delta: qualityDelta,
      categories: categories,
      time_saved_estimate: improvement.time_saved_estimate || 'none'
    },
    score_baseline: scoreBaseline,
    score_framework: scoreFramework,
    metrics_baseline: response.metrics_baseline || null,
    metrics_framework: response.metrics_framework || null,
    specific_improvements: response.specific_improvements || [],
    specific_regressions: response.specific_regressions || [],
    reasoning: response.reasoning || ''
  };
}

/**
 * Save score to JSON file
 * @param {string} sessionDir - Session directory path
 * @param {string} rubricName - Name of the rubric
 * @param {object} scoreData - Score data to save
 * @param {string} [outputDir] - Custom output directory
 */
function saveScore(sessionDir, rubricName, scoreData, outputDir = null) {
  const scoresDir = outputDir || path.join(sessionDir, 'scores');

  // Create scores directory if needed
  if (!fs.existsSync(scoresDir)) {
    fs.mkdirSync(scoresDir, { recursive: true });
  }

  // Extract session ID from directory name
  const sessionId = path.basename(sessionDir);

  // Build complete score object
  const scoreOutput = {
    rubric: rubricName,
    session_id: sessionId,
    judged_at: new Date().toISOString(),
    model: CLAUDE_MODEL,
    files_judged: scoreData.files_judged || [],
    scores: scoreData.scores || { overall: 0, dimensions: {} },
    metrics: scoreData.metrics || null,
    justification: scoreData.justification || '',
    strengths: scoreData.strengths || [],
    weaknesses: scoreData.weaknesses || [],
    raw_response: scoreData.raw_response || {}
  };

  const outputPath = path.join(scoresDir, `${rubricName}.json`);
  fs.writeFileSync(outputPath, JSON.stringify(scoreOutput, null, 2));

  return outputPath;
}

/**
 * Save comparative result to JSON file
 * @param {string} sessionDirA - Session A directory path
 * @param {string} sessionDirB - Session B directory path
 * @param {string} rubricName - Name of the rubric
 * @param {object} comparisonData - Comparison data to save
 * @param {string} [outputDir] - Custom output directory
 * @returns {string} Path to saved comparison file
 */
function saveComparison(sessionDirA, sessionDirB, rubricName, comparisonData, outputDir = null) {
  // Determine output directory - use outputDir if specified, else use parent of sessionDirA
  const defaultOutputDir = path.dirname(sessionDirA);
  const scoresDir = outputDir || path.join(defaultOutputDir, 'comparisons');

  // Create comparisons directory if needed
  if (!fs.existsSync(scoresDir)) {
    fs.mkdirSync(scoresDir, { recursive: true });
  }

  // Extract session IDs from directory names
  const sessionIdA = path.basename(sessionDirA);
  const sessionIdB = path.basename(sessionDirB);

  // Build complete comparison object
  const comparisonOutput = {
    rubric: rubricName,
    session_a: sessionIdA,
    session_b: sessionIdB,
    judged_at: new Date().toISOString(),
    model: CLAUDE_MODEL,
    files_judged_a: comparisonData.files_judged_a || [],
    files_judged_b: comparisonData.files_judged_b || [],
    verdict: comparisonData.verdict,
    margin: comparisonData.margin,
    score_a: comparisonData.score_a,
    score_b: comparisonData.score_b,
    metrics_a: comparisonData.metrics_a || null,
    metrics_b: comparisonData.metrics_b || null,
    dimension_comparison: comparisonData.dimension_comparison || {},
    strengths_a: comparisonData.strengths_a || [],
    weaknesses_a: comparisonData.weaknesses_a || [],
    strengths_b: comparisonData.strengths_b || [],
    weaknesses_b: comparisonData.weaknesses_b || [],
    reasoning: comparisonData.reasoning || '',
    raw_response: comparisonData.raw_response || {}
  };

  const outputPath = path.join(scoresDir, `comparison-${rubricName}.json`);
  fs.writeFileSync(outputPath, JSON.stringify(comparisonOutput, null, 2));

  return outputPath;
}

/**
 * Save baseline comparison result to JSON file
 * @param {string} baselineDir - Baseline session directory path
 * @param {string} frameworkDir - Framework session directory path
 * @param {string} rubricName - Name of the rubric
 * @param {object} comparisonData - Baseline comparison data to save
 * @param {string} [outputDir] - Custom output directory
 * @returns {string} Path to saved comparison file
 */
function saveBaselineComparison(baselineDir, frameworkDir, rubricName, comparisonData, outputDir = null) {
  // Determine output directory - use outputDir if specified, else use parent of baselineDir
  const defaultOutputDir = path.dirname(baselineDir);
  const scoresDir = outputDir || path.join(defaultOutputDir, 'comparisons');

  // Create comparisons directory if needed
  if (!fs.existsSync(scoresDir)) {
    fs.mkdirSync(scoresDir, { recursive: true });
  }

  // Extract session IDs from directory names
  const baselineSessionId = path.basename(baselineDir);
  const frameworkSessionId = path.basename(frameworkDir);

  // Build complete baseline comparison object
  const comparisonOutput = {
    mode: 'baseline_comparison',
    rubric: rubricName,
    baseline_session: baselineSessionId,
    framework_session: frameworkSessionId,
    judged_at: new Date().toISOString(),
    model: CLAUDE_MODEL,
    files_judged_baseline: comparisonData.files_judged_baseline || [],
    files_judged_framework: comparisonData.files_judged_framework || [],
    verdict: comparisonData.verdict,
    improvement: comparisonData.improvement || {
      quality_delta: 0,
      categories: {},
      time_saved_estimate: 'none'
    },
    score_baseline: comparisonData.score_baseline,
    score_framework: comparisonData.score_framework,
    metrics_baseline: comparisonData.metrics_baseline || null,
    metrics_framework: comparisonData.metrics_framework || null,
    specific_improvements: comparisonData.specific_improvements || [],
    specific_regressions: comparisonData.specific_regressions || [],
    reasoning: comparisonData.reasoning || '',
    raw_response: comparisonData.raw_response || {}
  };

  const outputPath = path.join(scoresDir, `baseline-comparison-${rubricName}.json`);
  fs.writeFileSync(outputPath, JSON.stringify(comparisonOutput, null, 2));

  return outputPath;
}

/**
 * List available rubrics in directory
 * @param {string} rubricsDir - Directory containing rubrics
 * @returns {string[]} Array of rubric names
 */
function listRubrics(rubricsDir) {
  if (!fs.existsSync(rubricsDir)) {
    return [];
  }

  const files = fs.readdirSync(rubricsDir);

  return files
    .filter((file) => file.endsWith('.md'))
    .map((file) => file.replace(/\.md$/, ''));
}

/**
 * Log progress message
 * @param {string} message - Message to log
 * @param {object} options - Options including quiet mode
 */
function logProgress(message, options = {}) {
  if (!options.quiet) {
    console.error(`[judge] ${message}`);
  }
}

/**
 * Show help message
 */
function showHelp() {
  console.log(`Usage:
  Single session: node judge.js [options] <session-dir> <rubric>
  Comparative:    node judge.js --compare <session-dir-a> <session-dir-b> <rubric>
  Baseline:       node judge.js --compare <baseline-session> <framework-session> <rubric> --baseline <baseline-session>

Arguments:
    session-dir        Session results directory from collect-results.sh
    session-dir-a      First session directory (for comparative mode)
    session-dir-b      Second session directory (for comparative mode)
    baseline-session   Baseline session (vanilla Claude, no framework)
    framework-session  Framework-assisted session
    rubric             Rubric name (e.g., "code-quality") or path to .md file

Options:
    --compare          Enable comparative evaluation mode (A/B comparison)
    --baseline DIR     Treat session A as baseline for framework improvement analysis
    --rubrics-dir DIR  Directory containing rubrics (default: ../rubrics)
    --output-dir DIR   Output directory for scores (default: <session-dir>/scores)
    --all              Judge with all available rubrics
    --context FILE     Additional context file (e.g., source code for test judging)
    --retries N        Max retry attempts (default: ${DEFAULT_RETRIES})
    --quiet            Suppress progress output
    --dry-run          Show prompt without invoking Claude
    --help             Show this help

Baseline Mode:
    When --baseline is specified, the comparison evaluates how much better the
    framework-assisted output (B) is compared to the vanilla Claude baseline (A).
    Output includes:
    - Framework improvement rate
    - Quality delta (0-3 scale)
    - Category-by-category breakdown
    - Time/effort savings estimate

Examples:
    # Single session evaluation
    node judge.js ./results/session-123 code-quality
    node judge.js ./results/session-123 --all
    node judge.js ./results/session-123 test-quality --context ./source.py
    node judge.js ./results/session-123 code-quality --dry-run

    # Comparative evaluation (A/B testing)
    node judge.js --compare ./results/with-skill/session-1 ./results/without-skill/session-1 code-quality
    node judge.js --compare ./variant-a ./variant-b architecture --output-dir ./comparisons

    # Baseline-relative evaluation (framework improvement analysis)
    node judge.js --compare ./vanilla/session-1 ./ensemble/session-1 code-quality --baseline ./vanilla/session-1
    node judge.js --compare ./baseline ./framework code-quality --baseline ./baseline --all`);
}

/**
 * Compare two sessions against a single rubric
 * Supports both standard A/B comparison and baseline-relative comparison.
 *
 * @param {string} sessionDirA - Session A directory path
 * @param {string} sessionDirB - Session B directory path
 * @param {string} rubricName - Name of the rubric
 * @param {object} sessionFilesA - Loaded session A files
 * @param {object} sessionFilesB - Loaded session B files
 * @param {object} options - Comparison options
 * @param {string} [options.baseline] - Baseline session identifier (enables baseline mode)
 * @returns {object} Comparison result
 */
async function compareRubric(sessionDirA, sessionDirB, rubricName, sessionFilesA, sessionFilesB, options = {}) {
  // Determine if this is a baseline comparison
  const isBaselineMode = Boolean(options.baseline);

  if (isBaselineMode) {
    logProgress(`Baseline comparison with rubric: ${rubricName}`, options);
  } else {
    logProgress(`Comparing with rubric: ${rubricName}`, options);
  }

  // Load rubric
  const rubricContent = loadRubric(rubricName, options.rubricsDir);

  // Determine which files to compare based on rubric
  let filesToCompareA;
  let filesToCompareB;

  if (rubricName.includes('test')) {
    filesToCompareA = sessionFilesA.tests.length > 0 ? sessionFilesA.tests : sessionFilesA.code;
    filesToCompareB = sessionFilesB.tests.length > 0 ? sessionFilesB.tests : sessionFilesB.code;
  } else {
    filesToCompareA = sessionFilesA.code;
    filesToCompareB = sessionFilesB.code;
  }

  if (filesToCompareA.length === 0) {
    throw new Error('No files to compare in session A directory');
  }

  if (filesToCompareB.length === 0) {
    throw new Error('No files to compare in session B directory');
  }

  // Load context if provided
  let contextContent = null;
  if (options.context && fs.existsSync(options.context)) {
    contextContent = fs.readFileSync(options.context, 'utf8');
  }

  // Build prompt based on mode
  let prompt;
  if (isBaselineMode) {
    // In baseline mode, A is the baseline and B is the framework
    prompt = buildBaselineComparisonPrompt(rubricContent, filesToCompareA, filesToCompareB, {
      context: contextContent
    });
  } else {
    prompt = buildComparativePrompt(rubricContent, filesToCompareA, filesToCompareB, {
      context: contextContent
    });
  }

  // Handle dry-run mode
  if (options.dryRun) {
    const modeLabel = isBaselineMode ? 'Baseline Comparison' : 'Comparative';
    console.log(`=== DRY RUN - ${modeLabel} Prompt Preview ===\n`);
    console.log(prompt);
    console.log('\n=== END DRY RUN ===');
    return { dryRun: true, mode: isBaselineMode ? 'baseline_comparison' : 'comparative' };
  }

  // Invoke Claude
  const modeLabel = isBaselineMode ? 'baseline comparison' : 'comparative evaluation';
  logProgress(`Invoking Claude Opus for ${modeLabel}...`, options);
  const response = invokeClaude(prompt, { retries: options.retries });

  if (isBaselineMode) {
    // Extract and validate baseline comparison
    const comparison = extractBaselineComparison(response);

    // Prepare baseline comparison data
    const comparisonData = {
      files_judged_baseline: filesToCompareA.map((f) => f.filename),
      files_judged_framework: filesToCompareB.map((f) => f.filename),
      verdict: comparison.verdict,
      improvement: comparison.improvement,
      score_baseline: comparison.score_baseline,
      score_framework: comparison.score_framework,
      metrics_baseline: comparison.metrics_baseline,
      metrics_framework: comparison.metrics_framework,
      specific_improvements: comparison.specific_improvements,
      specific_regressions: comparison.specific_regressions,
      reasoning: comparison.reasoning,
      raw_response: response
    };

    // Save baseline comparison
    const outputPath = saveBaselineComparison(
      sessionDirA,
      sessionDirB,
      rubricName,
      comparisonData,
      options.outputDir
    );

    logProgress(`Baseline comparison saved to: ${outputPath}`, options);

    return {
      mode: 'baseline_comparison',
      rubric: rubricName,
      verdict: comparison.verdict,
      improvement: comparison.improvement,
      score_baseline: comparison.score_baseline,
      score_framework: comparison.score_framework,
      outputPath
    };
  } else {
    // Extract and validate standard comparison
    const comparison = extractComparison(response);

    // Prepare comparison data
    const comparisonData = {
      files_judged_a: filesToCompareA.map((f) => f.filename),
      files_judged_b: filesToCompareB.map((f) => f.filename),
      verdict: comparison.verdict,
      margin: comparison.margin,
      score_a: comparison.score_a,
      score_b: comparison.score_b,
      metrics_a: comparison.metrics_a,
      metrics_b: comparison.metrics_b,
      dimension_comparison: comparison.dimension_comparison,
      strengths_a: comparison.strengths_a,
      weaknesses_a: comparison.weaknesses_a,
      strengths_b: comparison.strengths_b,
      weaknesses_b: comparison.weaknesses_b,
      reasoning: comparison.reasoning,
      raw_response: response
    };

    // Save comparison
    const outputPath = saveComparison(
      sessionDirA,
      sessionDirB,
      rubricName,
      comparisonData,
      options.outputDir
    );

    logProgress(`Comparison saved to: ${outputPath}`, options);

    return {
      mode: 'comparative',
      rubric: rubricName,
      verdict: comparison.verdict,
      margin: comparison.margin,
      score_a: comparison.score_a,
      score_b: comparison.score_b,
      outputPath
    };
  }
}

/**
 * Judge a single rubric against session files
 * @param {string} sessionDir - Session directory path
 * @param {string} rubricName - Name of the rubric
 * @param {object} sessionFiles - Loaded session files
 * @param {object} options - Judging options
 * @returns {object} Score result
 */
async function judgeRubric(sessionDir, rubricName, sessionFiles, options = {}) {
  logProgress(`Judging with rubric: ${rubricName}`, options);

  // Load rubric
  const rubricContent = loadRubric(rubricName, options.rubricsDir);

  // Determine which files to judge based on rubric
  let filesToJudge;
  if (rubricName.includes('test')) {
    filesToJudge = sessionFiles.tests.length > 0 ? sessionFiles.tests : sessionFiles.code;
  } else {
    filesToJudge = sessionFiles.code;
  }

  if (filesToJudge.length === 0) {
    throw new Error('No files to judge in session directory');
  }

  // Load context if provided
  let contextContent = null;
  if (options.context && fs.existsSync(options.context)) {
    contextContent = fs.readFileSync(options.context, 'utf8');
  }

  // Build prompt
  const prompt = buildPrompt(rubricContent, filesToJudge, {
    context: contextContent
  });

  // Handle dry-run mode
  if (options.dryRun) {
    console.log('=== DRY RUN - Prompt Preview ===\n');
    console.log(prompt);
    console.log('\n=== END DRY RUN ===');
    return { dryRun: true };
  }

  // Invoke Claude
  logProgress('Invoking Claude Opus...', options);
  const response = invokeClaude(prompt, { retries: options.retries });

  // Extract and validate score
  const scores = extractScore(response);

  // Prepare score data
  const scoreData = {
    files_judged: filesToJudge.map((f) => f.filename),
    scores,
    metrics: scores.metrics || null,
    justification: response.justification || '',
    strengths: response.strengths || [],
    weaknesses: response.weaknesses || [],
    raw_response: response
  };

  // Save score
  const outputPath = saveScore(
    sessionDir,
    rubricName,
    scoreData,
    options.outputDir
  );

  logProgress(`Score saved to: ${outputPath}`, options);

  return {
    rubric: rubricName,
    score: scores.overall,
    outputPath
  };
}

/**
 * Main run function
 * @param {string[]} args - Command line arguments
 * @returns {Promise<object>} Result object with exitCode
 */
async function run(args) {
  const parsedArgs = parseArgs(args);

  // Handle help
  if (parsedArgs.help) {
    showHelp();
    return { exitCode: 0 };
  }

  // Route to comparative or single session mode
  if (parsedArgs.compare) {
    return runComparative(parsedArgs);
  } else {
    return runSingleSession(parsedArgs);
  }
}

/**
 * Run single session evaluation
 * @param {object} parsedArgs - Parsed command line arguments
 * @returns {Promise<object>} Result object with exitCode
 */
async function runSingleSession(parsedArgs) {
  // Validate required arguments
  if (!parsedArgs.sessionDir) {
    return {
      exitCode: 1,
      error: 'Error: session-dir argument is required\n\nRun with --help for usage information.'
    };
  }

  // Validate session directory exists
  if (!fs.existsSync(parsedArgs.sessionDir)) {
    return {
      exitCode: 1,
      error: `Error: Session directory not found: ${parsedArgs.sessionDir}`
    };
  }

  // Validate rubric argument (unless --all)
  if (!parsedArgs.rubric && !parsedArgs.all) {
    return {
      exitCode: 1,
      error: 'Error: rubric argument is required (or use --all for all rubrics)\n\nRun with --help for usage information.'
    };
  }

  // Load session files
  logProgress(`Loading session files from: ${parsedArgs.sessionDir}`, parsedArgs);
  const sessionFiles = loadSessionFiles(parsedArgs.sessionDir);

  const totalFiles = sessionFiles.code.length + sessionFiles.tests.length;
  if (totalFiles === 0) {
    return {
      exitCode: 1,
      error: 'Error: No files found in session directory'
    };
  }

  logProgress(`Found ${sessionFiles.code.length} code files, ${sessionFiles.tests.length} test files`, parsedArgs);

  // Determine rubrics to use
  let rubrics;
  if (parsedArgs.all) {
    rubrics = listRubrics(parsedArgs.rubricsDir);
    if (rubrics.length === 0) {
      return {
        exitCode: 1,
        error: `Error: No rubrics found in: ${parsedArgs.rubricsDir}`
      };
    }
    logProgress(`Found ${rubrics.length} rubrics to evaluate`, parsedArgs);
  } else {
    rubrics = [parsedArgs.rubric];
  }

  // Validate rubrics exist before judging
  for (const rubric of rubrics) {
    try {
      loadRubric(rubric, parsedArgs.rubricsDir);
    } catch (err) {
      return {
        exitCode: 1,
        error: `Error: Rubric not found: ${rubric}`
      };
    }
  }

  // Judge each rubric
  const results = [];
  for (const rubric of rubrics) {
    try {
      const result = await judgeRubric(
        parsedArgs.sessionDir,
        rubric,
        sessionFiles,
        parsedArgs
      );
      results.push(result);
    } catch (err) {
      if (err.message.includes('JSON') || err.message.includes('parse')) {
        return {
          exitCode: 1,
          error: `Error: Failed to parse JSON response from Claude: ${err.message}`
        };
      }
      return {
        exitCode: 1,
        error: `Error judging ${rubric}: ${err.message}`
      };
    }
  }

  // Report summary
  if (!parsedArgs.dryRun && !parsedArgs.quiet) {
    console.error('\n[judge] Summary:');
    for (const result of results) {
      if (!result.dryRun) {
        console.error(`  ${result.rubric}: ${result.score}/5`);
      }
    }
  }

  return { exitCode: 0 };
}

/**
 * Run comparative evaluation (A/B testing)
 * @param {object} parsedArgs - Parsed command line arguments
 * @returns {Promise<object>} Result object with exitCode
 */
async function runComparative(parsedArgs) {
  // Validate required arguments for comparative mode
  if (!parsedArgs.sessionDirA || !parsedArgs.sessionDirB) {
    return {
      exitCode: 1,
      error: 'Error: Both session-dir-a and session-dir-b are required for comparative mode\n\nRun with --help for usage information.'
    };
  }

  // Validate session directories exist
  if (!fs.existsSync(parsedArgs.sessionDirA)) {
    return {
      exitCode: 1,
      error: `Error: Session A directory not found: ${parsedArgs.sessionDirA}`
    };
  }

  if (!fs.existsSync(parsedArgs.sessionDirB)) {
    return {
      exitCode: 1,
      error: `Error: Session B directory not found: ${parsedArgs.sessionDirB}`
    };
  }

  // Validate rubric argument (unless --all)
  if (!parsedArgs.rubric && !parsedArgs.all) {
    return {
      exitCode: 1,
      error: 'Error: rubric argument is required (or use --all for all rubrics)\n\nRun with --help for usage information.'
    };
  }

  // Load session files for both sessions
  logProgress(`Loading session A files from: ${parsedArgs.sessionDirA}`, parsedArgs);
  const sessionFilesA = loadSessionFiles(parsedArgs.sessionDirA);

  logProgress(`Loading session B files from: ${parsedArgs.sessionDirB}`, parsedArgs);
  const sessionFilesB = loadSessionFiles(parsedArgs.sessionDirB);

  const totalFilesA = sessionFilesA.code.length + sessionFilesA.tests.length;
  const totalFilesB = sessionFilesB.code.length + sessionFilesB.tests.length;

  if (totalFilesA === 0) {
    return {
      exitCode: 1,
      error: 'Error: No files found in session A directory'
    };
  }

  if (totalFilesB === 0) {
    return {
      exitCode: 1,
      error: 'Error: No files found in session B directory'
    };
  }

  logProgress(`Session A: ${sessionFilesA.code.length} code files, ${sessionFilesA.tests.length} test files`, parsedArgs);
  logProgress(`Session B: ${sessionFilesB.code.length} code files, ${sessionFilesB.tests.length} test files`, parsedArgs);

  // Determine rubrics to use
  let rubrics;
  if (parsedArgs.all) {
    rubrics = listRubrics(parsedArgs.rubricsDir);
    if (rubrics.length === 0) {
      return {
        exitCode: 1,
        error: `Error: No rubrics found in: ${parsedArgs.rubricsDir}`
      };
    }
    logProgress(`Found ${rubrics.length} rubrics to compare`, parsedArgs);
  } else {
    rubrics = [parsedArgs.rubric];
  }

  // Validate rubrics exist before comparing
  for (const rubric of rubrics) {
    try {
      loadRubric(rubric, parsedArgs.rubricsDir);
    } catch (err) {
      return {
        exitCode: 1,
        error: `Error: Rubric not found: ${rubric}`
      };
    }
  }

  // Compare each rubric
  const results = [];
  for (const rubric of rubrics) {
    try {
      const result = await compareRubric(
        parsedArgs.sessionDirA,
        parsedArgs.sessionDirB,
        rubric,
        sessionFilesA,
        sessionFilesB,
        parsedArgs
      );
      results.push(result);
    } catch (err) {
      if (err.message.includes('JSON') || err.message.includes('parse')) {
        return {
          exitCode: 1,
          error: `Error: Failed to parse JSON response from Claude: ${err.message}`
        };
      }
      return {
        exitCode: 1,
        error: `Error comparing ${rubric}: ${err.message}`
      };
    }
  }

  // Determine if we're in baseline mode (any result has baseline mode)
  const isBaselineMode = results.some((r) => r.mode === 'baseline_comparison');

  // Report summary
  if (!parsedArgs.dryRun && !parsedArgs.quiet) {
    if (isBaselineMode) {
      console.error('\n[judge] Baseline Comparison Summary:');
      for (const result of results) {
        if (!result.dryRun) {
          const verdictLabel = result.verdict === 'framework_better' ? 'Framework wins'
            : result.verdict === 'equivalent' ? 'Equivalent'
            : 'Baseline better';
          const delta = result.improvement?.quality_delta ?? 0;
          const deltaStr = delta > 0 ? `+${delta.toFixed(1)}` : delta.toFixed(1);
          console.error(`  ${result.rubric}: ${verdictLabel} (delta: ${deltaStr}) - Baseline: ${result.score_baseline}/5, Framework: ${result.score_framework}/5`);
        }
      }

      // Calculate overall improvement rate
      const frameworkWins = results.filter((r) => r.verdict === 'framework_better').length;
      const total = results.filter((r) => !r.dryRun).length;
      if (total > 0) {
        const improvementRate = ((frameworkWins / total) * 100).toFixed(0);
        const avgDelta = results.reduce((sum, r) => sum + (r.improvement?.quality_delta ?? 0), 0) / total;
        console.error(`\n  Framework Improvement Rate: ${improvementRate}% (${frameworkWins}/${total})`);
        console.error(`  Average Quality Delta: ${avgDelta >= 0 ? '+' : ''}${avgDelta.toFixed(2)}`);
      }
    } else {
      console.error('\n[judge] Comparison Summary:');
      for (const result of results) {
        if (!result.dryRun) {
          const verdictLabel = result.verdict === 'equivalent' ? 'equivalent'
            : result.verdict === 'a_better' ? 'A wins'
            : 'B wins';
          console.error(`  ${result.rubric}: ${verdictLabel} (${result.margin}) - A: ${result.score_a}/5, B: ${result.score_b}/5`);
        }
      }
    }
  }

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
  loadRubric,
  loadSessionFiles,
  collectFilesRecursively,
  isCodeFile,
  buildPrompt,
  buildComparativePrompt,
  buildBaselineComparisonPrompt,
  invokeClaude,
  extractScore,
  extractComparison,
  extractBaselineComparison,
  saveScore,
  saveComparison,
  saveBaselineComparison,
  listRubrics,
  judgeRubric,
  compareRubric,
  runSingleSession,
  runComparative,
  run
};
