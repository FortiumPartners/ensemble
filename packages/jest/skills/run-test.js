#!/usr/bin/env node

/**
 * Jest Test Runner
 * Executes Jest tests and returns structured results
 */

const { execSync } = require('child_process');
const path = require('path');

class JestTestRunner {
  constructor(options) {
    this.options = options;
  }

  async run() {
    const { file, config, coverage } = this.options;

    if (!file) {
      throw new Error('Test file path is required (--file)');
    }

    // Build Jest command
    const jestArgs = [
      file,
      '--json',
      '--testLocationInResults',
      '--no-colors'
    ];

    if (config) {
      jestArgs.push('--config', config);
    }

    if (coverage) {
      jestArgs.push('--coverage');
    }

    const command = `npx jest ${jestArgs.join(' ')}`;

    try {
      // Execute Jest
      const output = execSync(command, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: process.cwd()
      });

      // Parse Jest JSON output
      const result = JSON.parse(output);
      return this.formatResults(result, true);
    } catch (error) {
      // Jest exits with code 1 if tests fail
      if (error.stdout) {
        try {
          const result = JSON.parse(error.stdout);
          return this.formatResults(result, false);
        } catch {
          throw new Error(`Failed to parse Jest output: ${error.message}`);
        }
      }
      throw new Error(`Jest execution failed: ${error.message}`);
    }
  }

  formatResults(jestResult, success) {
    const { numPassedTests, numFailedTests, numTotalTests, testResults } = jestResult;

    const failures = [];

    if (testResults && testResults.length > 0) {
      for (const testFile of testResults) {
        if (testFile.assertionResults) {
          for (const test of testFile.assertionResults) {
            if (test.status === 'failed') {
              failures.push({
                test: test.title,
                error: test.failureMessages ? test.failureMessages.join('\n') : 'Unknown error',
                file: testFile.name,
                line: test.location ? test.location.line : null
              });
            }
          }
        }
      }
    }

    return {
      success: success && numFailedTests === 0,
      passed: numPassedTests || 0,
      failed: numFailedTests || 0,
      total: numTotalTests || 0,
      duration: jestResult.startTime && jestResult.endTime ?
        (jestResult.endTime - jestResult.startTime) / 1000 : null,
      failures
    };
  }
}

// CLI interface
async function main() {
  const args = process.argv.slice(2);
  const options = {};

  // Parse arguments
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.replace(/^--/, '');
      if (args[i + 1] && !args[i + 1].startsWith('--')) {
        options[key] = args[i + 1];
        i++;
      } else {
        options[key] = true;
      }
    }
  }

  try {
    const runner = new JestTestRunner(options);
    const result = await runner.run();

    console.log(JSON.stringify(result, null, 2));
    process.exit(result.success ? 0 : 1);
  } catch (error) {
    console.error(JSON.stringify({
      success: false,
      error: error.message
    }, null, 2));
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { JestTestRunner };
