/**
 * Performance tests for OpenCode Generator
 * Task ID: OC-S4-TEST-019
 *
 * Tests:
 *   - Full generation completes in < 10 seconds
 *   - Incremental (cached) generation completes in < 2 seconds
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const CLI_PATH = path.join(ROOT, 'scripts', 'generate-opencode', 'index.js');

// Helper: create a temp directory for test output
function createTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix || 'perf-test-'));
}

// Helper: run the CLI and measure wall-clock time
function runCliTimed(args) {
  const start = Date.now();
  try {
    const stdout = execFileSync(process.execPath, [CLI_PATH, ...args], {
      encoding: 'utf-8',
      timeout: 30000,
      env: { ...process.env, NODE_ENV: 'test' },
    });
    const elapsed = Date.now() - start;
    return { stdout, exitCode: 0, elapsed };
  } catch (err) {
    const elapsed = Date.now() - start;
    return {
      stdout: err.stdout || '',
      stderr: err.stderr || '',
      exitCode: err.status,
      elapsed,
    };
  }
}

describe('OC-S4-TEST-019: Generation performance', () => {
  let tmpDir;
  let outDir;

  beforeAll(() => {
    tmpDir = createTempDir('perf-gen-');
    outDir = path.join(tmpDir, 'out');
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should complete full generation in under 10 seconds', () => {
    const result = runCliTimed(['--force', '--output-dir', outDir]);

    expect(result.exitCode).toBe(0);
    expect(result.elapsed).toBeLessThan(10000);
  });

  it('should complete incremental (cached) generation in under 2 seconds', () => {
    // The first run above populated the cache. Run again without --force.
    const result = runCliTimed(['--output-dir', outDir]);

    expect(result.exitCode).toBe(0);
    expect(result.elapsed).toBeLessThan(2000);
  });
});
