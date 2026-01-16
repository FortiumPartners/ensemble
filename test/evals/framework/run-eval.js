#!/usr/bin/env node
/**
 * run-eval.js - Evaluation orchestrator
 * TRD Task: TRD-TEST-067
 *
 * Main entry point for running evaluations. Orchestrates:
 * - YAML spec parsing and validation
 * - Session launching via run-session.sh
 * - Progress reporting and error handling
 *
 * Usage: node run-eval.js <spec.yaml> [options]
 *
 * Arguments:
 *   spec.yaml          Path to evaluation specification file
 *
 * Options:
 *   --parallel N       Run N sessions in parallel (default: 2)
 *   --sequential       Run variants sequentially
 *   --remote           Use remote execution (requires git repo pushed to GitHub)
 *   --output DIR       Output directory for results (default: ../results)
 *   --timeout SECONDS  Timeout per session (default: 600, overridden by spec values)
 *   --runs N           Override runs_per_variant from spec
 *   --quiet            Suppress progress output
 *   --dry-run          Validate spec without running sessions
 *   --help             Show this help
 */

const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const yaml = require('js-yaml');

// Constants
const DEFAULT_PARALLEL = 2;
const DEFAULT_TIMEOUT = 600; // 10 minutes default
const RESULTS_BASE = path.join(__dirname, '..', 'results');

/**
 * Parse command line arguments
 * @param {string[]} args - Command line arguments (without node and script name)
 * @returns {object} Parsed arguments object
 */
function parseArgs(args) {
  const result = {
    specPath: null,
    parallel: DEFAULT_PARALLEL,
    sequential: false,
    remote: false, // Use remote execution instead of local
    outputDir: null,
    timeout: null, // null = use spec.execution.timeout or DEFAULT_TIMEOUT
    runs: null, // Override for runs_per_variant
    quiet: false,
    dryRun: false,
    help: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case '--help':
      case '-h':
        result.help = true;
        break;

      case '--parallel':
        result.parallel = parseInt(args[++i], 10);
        break;

      case '--sequential':
        result.sequential = true;
        result.parallel = 1;
        break;

      case '--remote':
        result.remote = true;
        break;

      case '--output':
        result.outputDir = args[++i];
        break;

      case '--timeout':
        result.timeout = parseInt(args[++i], 10);
        break;

      case '--runs':
        result.runs = parseInt(args[++i], 10);
        break;

      case '--quiet':
        result.quiet = true;
        break;

      case '--dry-run':
        result.dryRun = true;
        break;

      default:
        // First positional argument is the spec path
        if (!arg.startsWith('-') && !result.specPath) {
          result.specPath = arg;
        }
        break;
    }
  }

  return result;
}

/**
 * Load and parse YAML specification file
 * @param {string} specPath - Path to the YAML spec file
 * @returns {object} Parsed specification object
 * @throws {Error} If file not found or invalid YAML
 */
function loadSpec(specPath) {
  if (!fs.existsSync(specPath)) {
    throw new Error(`Spec file not found: ${specPath}`);
  }

  const content = fs.readFileSync(specPath, 'utf8');

  try {
    return yaml.load(content);
  } catch (err) {
    throw new Error(`Failed to parse YAML: ${err.message}`);
  }
}

/**
 * Validate specification has all required fields
 * @param {object} spec - Parsed specification object
 * @throws {Error} If required fields are missing
 */
function validateSpec(spec) {
  if (!spec.name) {
    throw new Error('Missing required field: name');
  }

  if (!spec.variants || !Array.isArray(spec.variants)) {
    throw new Error('Missing required field: variants');
  }

  if (spec.variants.length === 0) {
    throw new Error('variants array cannot be empty');
  }

  for (let i = 0; i < spec.variants.length; i++) {
    const variant = spec.variants[i];
    // Accept either 'id' or 'name' for variant identification
    if (!variant.id && !variant.name) {
      throw new Error(`Variant at index ${i} missing required field: id (or name)`);
    }
    // Normalize: use name as id if id not present
    if (!variant.id && variant.name) {
      variant.id = variant.name;
    }
  }

  if (!spec.binary_checks || !Array.isArray(spec.binary_checks)) {
    throw new Error('Missing required field: binary_checks');
  }

  if (!spec.metrics || !Array.isArray(spec.metrics)) {
    throw new Error('Missing required field: metrics');
  }
}

/**
 * Create results directory for eval output
 * @param {string} evalName - Name of the evaluation
 * @param {string} baseDir - Base results directory
 * @param {string} [customDir] - Optional custom output directory
 * @returns {string} Path to created directory
 */
function createResultsDir(evalName, baseDir, customDir = null) {
  if (customDir) {
    fs.mkdirSync(customDir, { recursive: true });
    return customDir;
  }

  const timestamp = new Date().toISOString().split('T')[0];
  const timeComponent = new Date().toISOString().split('T')[1].replace(/[:.]/g, '-').slice(0, 8);
  const dirName = `${evalName}_${timestamp}_${timeComponent}`;
  const fullPath = path.join(baseDir, dirName);

  fs.mkdirSync(fullPath, { recursive: true });

  return fullPath;
}

/**
 * Report progress to stderr
 * @param {string} evalName - Name of the evaluation
 * @param {string} message - Progress message
 * @param {object} options - Options including quiet mode and progress info
 */
function reportProgress(evalName, message, options = {}) {
  if (options.quiet) {
    return;
  }

  let output = `[${evalName}] ${message}`;

  if (options.current !== undefined && options.total !== undefined) {
    output = `[${evalName}] ${message} (${options.current}/${options.total})`;
  }

  console.error(output);
}

/**
 * Launch a single session
 * @param {object} variant - Variant configuration
 * @param {string} basePrompt - Base prompt from spec
 * @param {string} outputDir - Output directory path
 * @param {number} timeout - Session timeout in seconds
 * @param {object} options - Additional options (fixture, useLocal)
 * @returns {Promise<object>} Session result with session_id and exit status
 */
function launchSession(variant, basePrompt, outputDir, timeout, options = {}) {
  return new Promise((resolve) => {
    // Include runIndex in directory name when there are multiple runs
    const runIndex = options.runIndex || 0;
    const variantDir = runIndex > 0 ? `${variant.id}_run${runIndex}` : variant.id;
    const sessionDir = path.join(outputDir, variantDir);
    fs.mkdirSync(sessionDir, { recursive: true });

    const runSessionPath = path.join(__dirname, 'run-session.sh');

    // SECURITY: Verify script exists before attempting spawn
    if (!fs.existsSync(runSessionPath)) {
      return resolve({
        variant_id: variant.id,
        session_id: null,
        exit_code: 1,
        error: `Script not found: ${runSessionPath}`
      });
    }

    // Construct full prompt with variant suffix
    // Support both 'suffix' and 'prompt_suffix' field names
    let fullPrompt = basePrompt;
    const suffix = variant.suffix || variant.prompt_suffix;
    if (suffix) {
      fullPrompt = `${basePrompt}\n\n${suffix}`;
    }

    // Build arguments for run-session.sh
    const args = [
      '--keep', // Keep workspace for inspection/judging
      '--output-dir',
      outputDir,
      '--variant',
      variant.id,
      '--timeout',
      String(timeout)
    ];

    // Use local execution by default, unless --remote is specified
    // Remote mode requirements:
    // - Must run from git repo pushed to GitHub
    // - Requires TTY (uses script command)
    // - Does NOT support --dangerously-skip-permissions
    // - Session logs are NOT committed
    if (!options.useRemote) {
      args.unshift('--local');
    }

    // Add fixture if specified
    if (options.fixture) {
      args.push('--fixture', options.fixture);
    }

    // Add the prompt as the final positional argument
    args.push(fullPrompt);

    const proc = spawn(runSessionPath, args, {
      timeout: timeout * 1000
    });

    let sessionId = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      sessionId += data.toString().trim();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      // run-session.sh creates its output at $OUTPUT_DIR/$SESSION_ID
      // so the actual session directory is based on the returned sessionId
      const actualSessionDir = sessionId ? path.join(outputDir, sessionId) : sessionDir;
      resolve({
        variant_id: variant.id,
        run_index: runIndex,
        session_id: sessionId || null,
        session_dir: actualSessionDir,
        exit_code: code,
        error: code !== 0 ? stderr : null
      });
    });

    proc.on('error', (err) => {
      // Handle spawn errors (ENOENT, EACCES, etc.)
      resolve({
        variant_id: variant.id,
        run_index: runIndex,
        session_id: null,
        session_dir: sessionDir,
        exit_code: 1,
        error: `Spawn error: ${err.message} (code: ${err.code || 'unknown'})`
      });
    });
  });
}

/**
 * Launch sessions for all variants with parallel execution control
 * @param {object} spec - Evaluation specification
 * @param {string} outputDir - Output directory path
 * @param {object} options - Options including parallel count
 * @returns {Promise<object[]>} Array of session results
 */
async function launchSessions(spec, outputDir, options = {}) {
  const parallel = options.parallel || DEFAULT_PARALLEL;
  // Global timeout from CLI (options.timeout) or spec.execution.timeout or default
  const globalTimeout = options.timeout || spec.execution?.timeout || DEFAULT_TIMEOUT;
  const runsPerVariant = spec.runs_per_variant || 1;
  const results = [];

  // Get base prompt from spec
  // Support both 'prompt' and 'test_case.base_prompt' field names
  const basePrompt = spec.prompt || spec.test_case?.base_prompt || '';

  // Get global fixture path (fallback if variant doesn't specify fixture_path)
  const globalFixture = spec.fixture?.path || null;
  // Get fixture repo name for constructing full paths
  const fixtureRepo = spec.fixture?.repo || null;

  // Create queue of variants to process, with multiple runs per variant
  const queue = [];
  for (const variant of spec.variants) {
    for (let runIndex = 0; runIndex < runsPerVariant; runIndex++) {
      queue.push({ variant, runIndex });
    }
  }

  // Process in batches based on parallel limit
  while (queue.length > 0) {
    const batch = queue.splice(0, parallel);

    const batchResults = await Promise.all(
      batch.map(({ variant, runIndex }) => {
        // Per-variant timeout takes precedence over global timeout
        const variantTimeout = variant.timeout_seconds || globalTimeout;

        // Per-variant fixture_path takes precedence over global fixture path
        // fixture_path should be used directly - it's already relative to the prepared fixtures base
        // e.g., "variants/full/python-cli" maps to "/tmp/ensemble-test-fixtures/variants/full/python-cli"
        // Note: fixtureRepo is only used for GitHub cloning fallback, not for path construction
        let fixture = globalFixture;
        if (variant.fixture_path) {
          fixture = variant.fixture_path;
        }

        return launchSession(variant, basePrompt, outputDir, variantTimeout, { fixture, runIndex, useRemote: options.useRemote });
      })
    );

    results.push(...batchResults);
  }

  return results;
}

/**
 * Run binary checks on a session workspace
 * @param {string} workspacePath - Path to session workspace
 * @param {object[]} checks - Array of binary check definitions
 * @returns {object[]} Array of check results
 */
function runBinaryChecks(workspacePath, checks) {
  if (!checks || checks.length === 0) {
    return [];
  }

  const results = [];

  for (const check of checks) {
    const checkResult = {
      name: check.name,
      description: check.description || '',
      weight: check.weight || 0,
      passed: false,
      error: null
    };

    try {
      // Substitute {workspace} placeholder in check command
      let checkCommand = check.check;
      if (typeof checkCommand === 'string') {
        checkCommand = checkCommand.replace(/\{workspace\}/g, workspacePath);
      }

      // Execute the check as a shell command
      const result = spawnSync('bash', ['-c', checkCommand], {
        encoding: 'utf8',
        timeout: 30000, // 30 second timeout per check
        cwd: workspacePath
      });

      // Check passes if exit code is 0
      checkResult.passed = result.status === 0;
      if (result.status !== 0 && result.stderr) {
        checkResult.error = result.stderr.trim();
      }
    } catch (err) {
      checkResult.passed = false;
      checkResult.error = err.message;
    }

    results.push(checkResult);
  }

  return results;
}

/**
 * Show help message
 */
function showHelp() {
  console.log(`Usage: node run-eval.js <spec.yaml> [options]

Arguments:
  spec.yaml          Path to evaluation specification file

Options:
  --parallel N       Run N sessions in parallel (default: ${DEFAULT_PARALLEL})
  --sequential       Run variants sequentially (same as --parallel 1)
  --remote           Use remote execution instead of local (see requirements below)
  --output DIR       Output directory for results (default: ../results/<name>_<timestamp>)
  --timeout SECONDS  Default timeout per session in seconds (default: ${DEFAULT_TIMEOUT})
                     Timeout precedence: variant.timeout_seconds > spec.execution.timeout > --timeout > default
  --runs N           Override runs_per_variant from spec (useful for quick tests)
  --quiet            Suppress progress output
  --dry-run          Validate spec without running sessions
  --help             Show this help

Remote Mode Requirements (--remote):
  - Must run from a git repository that is pushed to GitHub
  - Prompt is passed as argument to --remote (not piped)
  - Requires TTY - uses 'script' command to capture output
  - Does NOT support --dangerously-skip-permissions
  - Session logs are NOT committed (only code artifacts)
  - Use 'claude --teleport <session_id>' to retrieve sessions

Examples:
  node run-eval.js specs/skills/python.yaml
  node run-eval.js spec.yaml --parallel 4 --output ./my-results
  node run-eval.js spec.yaml --runs 1              # Quick single run per variant
  node run-eval.js spec.yaml --remote              # Use remote execution
  node run-eval.js spec.yaml --dry-run --quiet`);
}

/**
 * Print dry run report
 * @param {object} spec - Evaluation specification
 * @param {string} outputDir - Output directory path
 * @param {object} options - Parsed options
 */
function printDryRunReport(spec, outputDir, options) {
  const runsPerVariant = spec.runs_per_variant || 1;
  const totalSessions = spec.variants.length * runsPerVariant;
  // Calculate effective global timeout (CLI -> spec.execution -> default)
  const globalTimeout = options.timeout || spec.execution?.timeout || DEFAULT_TIMEOUT;

  console.log('\n=== DRY RUN ===\n');
  console.log(`Eval Name: ${spec.name}`);
  console.log(`Output Dir: ${outputDir}`);
  console.log(`Parallel: ${options.parallel}`);
  console.log(`Global Timeout: ${globalTimeout}s`);
  console.log(`Runs per variant: ${runsPerVariant}`);
  console.log(`Total sessions: ${totalSessions}\n`);

  console.log('Variants to run:');
  spec.variants.forEach((variant) => {
    const hasSuffix = variant.suffix || variant.prompt_suffix;
    const effectiveTimeout = variant.timeout_seconds || globalTimeout;
    const timeoutInfo = variant.timeout_seconds ? ` (timeout: ${effectiveTimeout}s)` : '';
    console.log(`  - ${variant.id}${hasSuffix ? ' (with suffix)' : ''}${timeoutInfo}`);
  });

  console.log(`\nBinary checks: ${spec.binary_checks.length}`);
  spec.binary_checks.forEach((check) => {
    console.log(`  - ${check.name}${check.weight ? ` (weight: ${check.weight})` : ''}`);
  });

  console.log(`\nJudged metrics: ${spec.metrics.length}`);
  spec.metrics.forEach((metric) => {
    console.log(`  - ${metric.name}${metric.rubric ? ` (rubric: ${metric.rubric})` : ''}`);
  });

  console.log('\n=== END DRY RUN ===');
}

/**
 * Main run function - orchestrates the evaluation
 * @param {string[]} args - Command line arguments
 * @returns {Promise<object>} Result object with exit_code and optional error
 */
async function run(args) {
  const parsedArgs = parseArgs(args);

  // Handle help
  if (parsedArgs.help) {
    showHelp();
    return { exit_code: 0 };
  }

  // Validate spec path provided
  if (!parsedArgs.specPath) {
    return {
      exit_code: 1,
      error: 'Error: spec file argument is required\n\nRun with --help for usage information.'
    };
  }

  // Load and validate spec
  let spec;
  try {
    spec = loadSpec(parsedArgs.specPath);
    validateSpec(spec);
  } catch (err) {
    return {
      exit_code: 1,
      error: `Error: ${err.message}`
    };
  }

  // Override runs_per_variant if --runs specified
  if (parsedArgs.runs !== null && parsedArgs.runs > 0) {
    spec.runs_per_variant = parsedArgs.runs;
  }

  // Create output directory
  let outputDir;
  try {
    outputDir = createResultsDir(spec.name, RESULTS_BASE, parsedArgs.outputDir);
    // Convert to absolute path to ensure binary checks work correctly
    // Binary check commands use cd {workspace} which requires absolute paths
    outputDir = path.resolve(outputDir);
  } catch (err) {
    return {
      exit_code: 1,
      error: `Error creating output directory: ${err.message}`
    };
  }

  // Handle dry run (spec already has --runs override applied)
  if (parsedArgs.dryRun) {
    printDryRunReport(spec, outputDir, parsedArgs);
    return { exit_code: 0 };
  }

  // Report start
  reportProgress(spec.name, 'Starting evaluation', parsedArgs);
  reportProgress(spec.name, `Output: ${outputDir}`, parsedArgs);

  // Launch sessions
  const runsPerVariant = spec.runs_per_variant || 1;
  const totalSessions = spec.variants.length * runsPerVariant;
  reportProgress(
    spec.name,
    `Launching ${totalSessions} sessions (${spec.variants.length} variants × ${runsPerVariant} runs)`,
    parsedArgs
  );

  const sessions = await launchSessions(spec, outputDir, {
    parallel: parsedArgs.parallel,
    timeout: parsedArgs.timeout,
    useRemote: parsedArgs.remote
  });

  // Report results and log failures
  let hasFailures = false;
  sessions.forEach((session) => {
    if (session.exit_code !== 0) {
      hasFailures = true;
      const runSuffix = session.run_index > 0 ? ` (run ${session.run_index})` : '';
      reportProgress(
        spec.name,
        `Warning: ${session.variant_id}${runSuffix} failed: ${session.error}`,
        parsedArgs
      );
    } else {
      const runSuffix = session.run_index > 0 ? ` (run ${session.run_index})` : '';
      reportProgress(spec.name, `Completed: ${session.variant_id}${runSuffix}`, parsedArgs);
    }
  });

  // Run binary checks on completed sessions
  const binaryChecks = spec.binary_checks || [];
  if (binaryChecks.length > 0) {
    reportProgress(spec.name, `Running ${binaryChecks.length} binary checks on each session`, parsedArgs);
  }

  // Process each session with binary checks
  const sessionResults = sessions.map((session) => {
    const result = {
      variant_id: session.variant_id,
      run_index: session.run_index || 0,
      session_id: session.session_id,
      status: session.exit_code === 0 ? 'completed' : 'failed',
      binary_checks: []
    };

    // Run binary checks on successful sessions with workspaces
    if (session.exit_code === 0 && session.session_dir) {
      const workspacePath = path.join(session.session_dir, 'workspace');
      if (fs.existsSync(workspacePath)) {
        result.binary_checks = runBinaryChecks(workspacePath, binaryChecks);

        // Report check results
        const passed = result.binary_checks.filter((c) => c.passed).length;
        const total = result.binary_checks.length;
        const runSuffix = session.run_index > 0 ? ` (run ${session.run_index})` : '';
        reportProgress(
          spec.name,
          `  ${session.variant_id}${runSuffix}: ${passed}/${total} checks passed`,
          parsedArgs
        );
      }
    }

    return result;
  });

  // Save session metadata with binary check results
  const metadataPath = path.join(outputDir, 'sessions.json');
  const metadata = {
    eval_name: spec.name,
    timestamp: new Date().toISOString(),
    runs_per_variant: spec.runs_per_variant || 1,
    binary_checks: binaryChecks.map((c) => ({ name: c.name, weight: c.weight || 0 })),
    variants: sessionResults
  };

  fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));

  reportProgress(spec.name, 'Evaluation complete', parsedArgs);

  return { exit_code: 0 };
}

// Main entry point when run directly
if (require.main === module) {
  run(process.argv.slice(2))
    .then((result) => {
      if (result.error) {
        console.error(result.error);
      }
      process.exit(result.exit_code);
    })
    .catch((err) => {
      console.error(`Unexpected error: ${err.message}`);
      process.exit(1);
    });
}

// Export for testing
module.exports = {
  parseArgs,
  loadSpec,
  validateSpec,
  createResultsDir,
  launchSession,
  launchSessions,
  runBinaryChecks,
  reportProgress,
  run
};
