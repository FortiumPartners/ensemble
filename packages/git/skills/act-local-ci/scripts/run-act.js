#!/usr/bin/env node

/**
 * Act Local CI Runner
 *
 * Wrapper script for nektos/act with enhanced output and error handling.
 *
 * @module run-act
 * @version 1.0.0
 */

const { execSync, spawn } = require('child_process');
const { existsSync, readFileSync } = require('fs');
const { join } = require('path');

/**
 * ActRunner - Execute GitHub Actions locally using act
 */
class ActRunner {
  constructor(options = {}) {
    this.options = {
      workflowsDir: options.workflowsDir || '.github/workflows',
      secretsFile: options.secretsFile || '.secrets',
      envFile: options.envFile || '.env',
      platform: options.platform || 'ubuntu-latest=catthehacker/ubuntu:act-latest',
      verbose: options.verbose || false,
      dryRun: options.dryRun || false,
      reuse: options.reuse || false,
      ...options
    };
  }

  /**
   * Check if act is installed
   *
   * @returns {boolean} True if act is available
   */
  isActInstalled() {
    try {
      execSync('act --version', { stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if Docker is running
   *
   * @returns {boolean} True if Docker is available
   */
  isDockerRunning() {
    try {
      execSync('docker ps', { stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get act version
   *
   * @returns {string} Act version string
   */
  getVersion() {
    try {
      return execSync('act --version', { encoding: 'utf-8' }).trim();
    } catch {
      return 'unknown';
    }
  }

  /**
   * List available workflows and jobs
   *
   * @returns {Array<Object>} List of workflows with their jobs
   */
  listWorkflows() {
    try {
      const output = execSync('act -l', { encoding: 'utf-8' });
      const lines = output.trim().split('\n').slice(1); // Skip header

      return lines.map(line => {
        const parts = line.trim().split(/\s+/);
        return {
          stage: parts[0],
          jobId: parts[1],
          jobName: parts[2],
          workflowName: parts[3],
          workflowFile: parts[4],
          events: parts.slice(5).join(' ')
        };
      });
    } catch (error) {
      console.error('Failed to list workflows:', error.message);
      return [];
    }
  }

  /**
   * Build act command arguments
   *
   * @param {Object} runOptions - Run options
   * @returns {Array<string>} Command arguments
   */
  buildArgs(runOptions = {}) {
    const args = [];

    // Event type
    if (runOptions.event) {
      args.push(runOptions.event);
    }

    // Specific workflow file
    if (runOptions.workflow) {
      args.push('-W', runOptions.workflow);
    }

    // Specific job
    if (runOptions.job) {
      args.push('-j', runOptions.job);
    }

    // Platform/runner image
    if (this.options.platform) {
      args.push('-P', this.options.platform);
    }

    // Secrets file
    if (existsSync(this.options.secretsFile)) {
      args.push('--secret-file', this.options.secretsFile);
    }

    // Environment file
    if (existsSync(this.options.envFile)) {
      args.push('--env-file', this.options.envFile);
    }

    // Inline secrets
    if (runOptions.secrets) {
      for (const [key, value] of Object.entries(runOptions.secrets)) {
        args.push('-s', `${key}=${value}`);
      }
    }

    // Event payload
    if (runOptions.eventPath) {
      args.push('--eventpath', runOptions.eventPath);
    }

    // Matrix filter
    if (runOptions.matrix) {
      for (const [key, value] of Object.entries(runOptions.matrix)) {
        args.push('--matrix', `${key}:${value}`);
      }
    }

    // Dry run
    if (this.options.dryRun || runOptions.dryRun) {
      args.push('--dryrun');
    }

    // Verbose
    if (this.options.verbose || runOptions.verbose) {
      args.push('-v');
    }

    // Reuse containers
    if (this.options.reuse || runOptions.reuse) {
      args.push('--reuse');
    }

    // Container options
    if (runOptions.containerOptions) {
      args.push('--container-options', runOptions.containerOptions);
    }

    // Bind mount
    if (runOptions.bind) {
      args.push('--bind');
    }

    return args;
  }

  /**
   * Run act with specified options
   *
   * @param {Object} runOptions - Run options
   * @returns {Promise<Object>} Execution result
   */
  async run(runOptions = {}) {
    // Preflight checks
    if (!this.isActInstalled()) {
      return {
        success: false,
        error: 'act is not installed. Install with: brew install act',
        code: 1
      };
    }

    if (!this.isDockerRunning()) {
      return {
        success: false,
        error: 'Docker is not running. Please start Docker.',
        code: 1
      };
    }

    const args = this.buildArgs(runOptions);
    const startTime = Date.now();

    console.log(`Running: act ${args.join(' ')}`);
    console.log('---');

    return new Promise((resolve) => {
      const proc = spawn('act', args, {
        stdio: 'inherit',
        cwd: process.cwd()
      });

      proc.on('close', (code) => {
        const duration = Math.round((Date.now() - startTime) / 1000);

        resolve({
          success: code === 0,
          code,
          duration,
          args
        });
      });

      proc.on('error', (error) => {
        resolve({
          success: false,
          error: error.message,
          code: 1,
          args
        });
      });
    });
  }

  /**
   * Run a quick validation (dry run + syntax check)
   *
   * @returns {Promise<Object>} Validation result
   */
  async validate() {
    console.log('Validating workflows...');

    // Check for workflow files
    const workflowsPath = join(process.cwd(), this.options.workflowsDir);
    if (!existsSync(workflowsPath)) {
      return {
        success: false,
        error: `Workflows directory not found: ${this.options.workflowsDir}`,
        workflows: []
      };
    }

    // List workflows
    const workflows = this.listWorkflows();

    if (workflows.length === 0) {
      return {
        success: false,
        error: 'No workflows found',
        workflows: []
      };
    }

    console.log(`Found ${workflows.length} job(s):`);
    workflows.forEach(w => {
      console.log(`  - ${w.jobId} (${w.workflowFile})`);
    });

    // Dry run
    const result = await this.run({ dryRun: true });

    return {
      success: result.success,
      workflows,
      dryRunResult: result
    };
  }

  /**
   * Run all test jobs
   *
   * @returns {Promise<Object>} Test results
   */
  async runTests() {
    const workflows = this.listWorkflows();
    const testJobs = workflows.filter(w =>
      w.jobId.includes('test') ||
      w.jobName.toLowerCase().includes('test')
    );

    if (testJobs.length === 0) {
      console.log('No test jobs found. Looking for jobs with "test" in name.');
      return { success: true, skipped: true };
    }

    console.log(`Running ${testJobs.length} test job(s)...`);

    const results = [];
    for (const job of testJobs) {
      console.log(`\nRunning job: ${job.jobId}`);
      const result = await this.run({ job: job.jobId });
      results.push({ job: job.jobId, ...result });

      if (!result.success) {
        return {
          success: false,
          results,
          failedJob: job.jobId
        };
      }
    }

    return { success: true, results };
  }

  /**
   * Run all build jobs
   *
   * @returns {Promise<Object>} Build results
   */
  async runBuild() {
    const workflows = this.listWorkflows();
    const buildJobs = workflows.filter(w =>
      w.jobId.includes('build') ||
      w.jobName.toLowerCase().includes('build')
    );

    if (buildJobs.length === 0) {
      console.log('No build jobs found.');
      return { success: true, skipped: true };
    }

    console.log(`Running ${buildJobs.length} build job(s)...`);

    const results = [];
    for (const job of buildJobs) {
      console.log(`\nRunning job: ${job.jobId}`);
      const result = await this.run({ job: job.jobId });
      results.push({ job: job.jobId, ...result });

      if (!result.success) {
        return {
          success: false,
          results,
          failedJob: job.jobId
        };
      }
    }

    return { success: true, results };
  }
}

/**
 * CLI Entry Point
 */
async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'run';

  const runner = new ActRunner({
    verbose: args.includes('-v') || args.includes('--verbose'),
    dryRun: args.includes('-n') || args.includes('--dryrun'),
    reuse: args.includes('--reuse')
  });

  console.log(`Act Local CI Runner v1.0.0`);
  console.log(`Using: ${runner.getVersion()}`);
  console.log('');

  let result;

  switch (command) {
    case 'list':
    case '-l':
      const workflows = runner.listWorkflows();
      console.log('Available workflows:');
      console.log('Stage\tJob ID\t\tJob Name\tWorkflow\t\tEvents');
      console.log('-'.repeat(80));
      workflows.forEach(w => {
        console.log(`${w.stage}\t${w.jobId}\t\t${w.jobName}\t${w.workflowFile}\t${w.events}`);
      });
      break;

    case 'validate':
      result = await runner.validate();
      console.log('');
      console.log(result.success ? 'Validation passed!' : `Validation failed: ${result.error}`);
      process.exit(result.success ? 0 : 1);
      break;

    case 'test':
      result = await runner.runTests();
      console.log('');
      console.log(result.success ? 'All tests passed!' : `Tests failed at: ${result.failedJob}`);
      process.exit(result.success ? 0 : 1);
      break;

    case 'build':
      result = await runner.runBuild();
      console.log('');
      console.log(result.success ? 'Build completed!' : `Build failed at: ${result.failedJob}`);
      process.exit(result.success ? 0 : 1);
      break;

    case 'run':
    default:
      // Parse remaining args for job/workflow selection
      const jobIndex = args.indexOf('-j');
      const workflowIndex = args.indexOf('-W');

      const runOptions = {};
      if (jobIndex !== -1 && args[jobIndex + 1]) {
        runOptions.job = args[jobIndex + 1];
      }
      if (workflowIndex !== -1 && args[workflowIndex + 1]) {
        runOptions.workflow = args[workflowIndex + 1];
      }

      // Check for event type
      const events = ['push', 'pull_request', 'workflow_dispatch', 'schedule'];
      const eventArg = args.find(a => events.includes(a));
      if (eventArg) {
        runOptions.event = eventArg;
      }

      result = await runner.run(runOptions);
      console.log('');
      console.log(`Completed in ${result.duration}s with exit code ${result.code}`);
      process.exit(result.code);
  }
}

// Export for programmatic use
module.exports = { ActRunner };

// Run CLI if executed directly
if (require.main === module) {
  main().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
  });
}
