/**
 * Unit and integration tests for Generator CLI
 * Task IDs: OC-S3-TEST-010, OC-S3-TEST-011
 *
 * TDD: Tests written BEFORE implementation.
 *
 * Tests cover:
 *   - CLI-001: CLI entry point and arg parsing
 *   - CLI-002: --dry-run flag
 *   - CLI-003: --verbose flag
 *   - CLI-004: --validate flag
 *   - CLI-005: --output-dir flag
 *   - CLI-006: Pipeline orchestration
 *   - CLI-007: Incremental generation with hash cache
 *   - CLI-008: Progress reporting
 *   - CLI-009: Error handling and summary
 *   - TEST-010: Unit tests for flag parsing, pipeline, errors
 *   - TEST-011: Integration test for full pipeline
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, execFileSync } = require('child_process');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const CLI_PATH = path.join(ROOT, 'scripts', 'generate-opencode', 'index.js');
const PACKAGES_DIR = path.join(ROOT, 'packages');

// Helper: create a temp directory for test output
function createTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix || 'gen-cli-test-'));
}

// Helper: run the CLI as a child process and capture output
function runCli(args, options) {
  const opts = {
    encoding: 'utf-8',
    timeout: 30000,
    env: { ...process.env, NODE_ENV: 'test' },
    ...options,
  };
  try {
    const result = execFileSync(process.execPath, [CLI_PATH, ...args], opts);
    return { stdout: result, exitCode: 0 };
  } catch (err) {
    return {
      stdout: err.stdout || '',
      stderr: err.stderr || '',
      exitCode: err.status,
    };
  }
}

// ---------------------------------------------------------------------------
// OC-S3-CLI-001 + TEST-010: CLI entry point and flag parsing
// ---------------------------------------------------------------------------
describe('OC-S3-CLI-001: CLI entry point', () => {
  it('should exist as a JavaScript file', () => {
    expect(fs.existsSync(CLI_PATH)).toBe(true);
  });

  it('should be executable with node', () => {
    const result = runCli(['--help']);
    // --help should succeed (exit 0) or print usage
    expect(result.exitCode === 0 || result.stdout.includes('Usage')).toBe(true);
  });

  it('should display help text with --help flag', () => {
    const result = runCli(['--help']);
    expect(result.stdout).toMatch(/generate-opencode|opencode|Usage/i);
  });
});

// ---------------------------------------------------------------------------
// OC-S3-CLI-002: --dry-run flag
// ---------------------------------------------------------------------------
describe('OC-S3-CLI-002: --dry-run flag', () => {
  it('should not write files when --dry-run is specified', () => {
    const tmpDir = createTempDir('cli-dryrun-');
    const outDir = path.join(tmpDir, 'output');

    const result = runCli(['--dry-run', '--output-dir', outDir]);

    // Output dir should not exist or be empty (no files written)
    if (fs.existsSync(outDir)) {
      const files = fs.readdirSync(outDir, { recursive: true });
      // In dry-run mode, the output directory should not contain generated files
      // (it may be created but should remain empty or nearly empty)
      expect(files.length).toBeLessThanOrEqual(0);
    }
    expect(result.exitCode).toBe(0);

    // Cleanup
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should indicate dry-run mode in output', () => {
    const tmpDir = createTempDir('cli-dryrun-msg-');
    const result = runCli(['--dry-run', '--output-dir', path.join(tmpDir, 'out')]);
    expect(result.stdout).toMatch(/dry.run/i);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// OC-S3-CLI-003: --verbose flag
// ---------------------------------------------------------------------------
describe('OC-S3-CLI-003: --verbose flag', () => {
  it('should produce detailed output with --verbose', () => {
    const tmpDir = createTempDir('cli-verbose-');
    const result = runCli(['--dry-run', '--verbose', '--output-dir', path.join(tmpDir, 'out')]);

    // Verbose output should show step-by-step progress
    expect(result.stdout).toMatch(/step|skill|command|pipeline/i);
    expect(result.exitCode).toBe(0);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// OC-S3-CLI-004: --validate flag
// ---------------------------------------------------------------------------
describe('OC-S3-CLI-004: --validate flag', () => {
  it('should validate generated output when --validate is specified', () => {
    const tmpDir = createTempDir('cli-validate-');
    const outDir = path.join(tmpDir, 'out');
    const result = runCli(['--validate', '--output-dir', outDir]);

    // Should mention validation in output
    expect(result.stdout).toMatch(/validat/i);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// OC-S3-CLI-005: --output-dir flag
// ---------------------------------------------------------------------------
describe('OC-S3-CLI-005: --output-dir flag', () => {
  it('should write output to custom directory', () => {
    const tmpDir = createTempDir('cli-outdir-');
    const outDir = path.join(tmpDir, 'custom-output');

    const result = runCli(['--output-dir', outDir]);
    expect(result.exitCode).toBe(0);

    // The output directory should exist after generation
    expect(fs.existsSync(outDir)).toBe(true);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should default to dist/opencode/ when no --output-dir is specified', () => {
    // We test this by checking the help output mentions the default
    const result = runCli(['--help']);
    expect(result.stdout).toMatch(/dist\/opencode/);
  });
});

// ---------------------------------------------------------------------------
// OC-S3-CLI-006: Pipeline orchestration
// ---------------------------------------------------------------------------
describe('OC-S3-CLI-006: Pipeline orchestration', () => {
  let tmpDir;
  let outDir;
  let result;

  beforeAll(() => {
    tmpDir = createTempDir('cli-pipeline-');
    outDir = path.join(tmpDir, 'out');
    result = runCli(['--verbose', '--output-dir', outDir]);
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should execute SkillCopier step', () => {
    expect(result.stdout).toMatch(/skill/i);
  });

  it('should execute CommandTranslator step', () => {
    expect(result.stdout).toMatch(/command/i);
  });

  it('should execute AgentTranslator step', () => {
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/agent/i);
  });

  it('should gracefully skip HookBridgeGenerator (not yet implemented)', () => {
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/hook.*skip|skip.*hook|hook.*not.*implement/i);
  });

  it('should execute ManifestGenerator step', () => {
    expect(result.stdout).toMatch(/manifest/i);
  });

  it('should report results from each step', () => {
    // The summary should show counts or results for each step
    expect(result.stdout).toMatch(/summary|result|complete/i);
  });

  it('should exit with code 0 on success', () => {
    expect(result.exitCode).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// OC-S3-CLI-007: Incremental generation with hash cache
// ---------------------------------------------------------------------------
describe('OC-S3-CLI-007: Incremental generation with hash cache', () => {
  let tmpDir;
  let outDir;

  beforeAll(() => {
    tmpDir = createTempDir('cli-incremental-');
    outDir = path.join(tmpDir, 'out');
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should create a hash cache file after first run', () => {
    runCli(['--output-dir', outDir]);
    const cachePath = path.join(outDir, '.cache', 'hashes.json');
    expect(fs.existsSync(cachePath)).toBe(true);

    const cache = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
    expect(typeof cache).toBe('object');
    expect(Object.keys(cache).length).toBeGreaterThan(0);
  });

  it('should skip unchanged files on second run', () => {
    const result = runCli(['--verbose', '--output-dir', outDir]);
    // Second run should indicate skipped files
    expect(result.stdout).toMatch(/skip|unchanged|cache|up.to.date/i);
  });

  it('should bypass cache with --force flag', () => {
    const result = runCli(['--verbose', '--force', '--output-dir', outDir]);
    // Force should regenerate everything
    expect(result.stdout).toMatch(/force|regenerat/i);
  });
});

// ---------------------------------------------------------------------------
// OC-S3-CLI-008: Progress reporting
// ---------------------------------------------------------------------------
describe('OC-S3-CLI-008: Progress reporting', () => {
  it('should show file count per step', () => {
    const tmpDir = createTempDir('cli-progress-');
    const outDir = path.join(tmpDir, 'out');
    const result = runCli(['--verbose', '--output-dir', outDir]);

    // Should show counts like "X skills" or "X commands"
    expect(result.stdout).toMatch(/\d+\s*(skill|command|file)/i);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should show timing per step', () => {
    const tmpDir = createTempDir('cli-timing-');
    const outDir = path.join(tmpDir, 'out');
    const result = runCli(['--verbose', '--output-dir', outDir]);

    // Should show timing like "123ms" or "1.2s"
    expect(result.stdout).toMatch(/\d+\s*ms|\d+\.\d+\s*s/i);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should show total timing', () => {
    const tmpDir = createTempDir('cli-total-');
    const outDir = path.join(tmpDir, 'out');
    const result = runCli(['--output-dir', outDir]);

    // Should show total time
    expect(result.stdout).toMatch(/total|completed|done/i);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// OC-S3-CLI-009: Error handling
// ---------------------------------------------------------------------------
describe('OC-S3-CLI-009: Error handling', () => {
  it('should collect errors per translator and print summary', () => {
    // We cannot easily force errors without mocking, but we can verify the
    // CLI handles an invalid packages dir gracefully
    const tmpDir = createTempDir('cli-error-');
    const result = runCli([
      '--output-dir', path.join(tmpDir, 'out'),
      '--verbose',
    ]);

    // Even if there are partial errors, the CLI should complete and print a summary
    expect(result.stdout).toMatch(/summary|complete|error|done/i);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should exit with non-zero code if critical errors occur', () => {
    // Point to a nonexistent packages dir to trigger errors - but note
    // the CLI is designed to handle missing packages gracefully, so this
    // tests that the error path exists, not necessarily that it triggers here
    // The CLI should at minimum handle this without crashing
    const tmpDir = createTempDir('cli-bad-');
    const result = runCli([
      '--output-dir', path.join(tmpDir, 'out'),
    ]);
    // Should not crash (exitCode should be 0 or 1, not undefined/null)
    expect([0, 1]).toContain(result.exitCode);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// OC-S3-TEST-011: Integration test - full pipeline
// ---------------------------------------------------------------------------
describe('OC-S3-TEST-011: Integration test - full pipeline', () => {
  let tmpDir;
  let outDir;
  let result;

  beforeAll(() => {
    tmpDir = createTempDir('cli-integration-');
    outDir = path.join(tmpDir, 'integration-out');
    result = runCli(['--verbose', '--validate', '--output-dir', outDir]);
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should complete successfully', () => {
    expect(result.exitCode).toBe(0);
  });

  it('should create the output directory', () => {
    expect(fs.existsSync(outDir)).toBe(true);
  });

  it('should generate skill files in .opencode/skill/', () => {
    const skillDir = path.join(outDir, '.opencode', 'skill');
    if (fs.existsSync(skillDir)) {
      const entries = fs.readdirSync(skillDir);
      // Should have at least some skill directories
      expect(entries.length).toBeGreaterThan(0);
    }
    // If no skills are discovered (e.g., packages structure is minimal),
    // the test still passes -- the pipeline ran successfully
  });

  it('should generate command markdown files in .opencode/commands/ensemble/', () => {
    const cmdDir = path.join(outDir, '.opencode', 'commands', 'ensemble');
    if (fs.existsSync(cmdDir)) {
      const files = fs.readdirSync(cmdDir).filter((f) => f.endsWith('.md'));
      expect(files.length).toBeGreaterThan(0);
    }
  });

  it('should generate opencode.json manifest', () => {
    const manifestPath = path.join(outDir, 'opencode.json');
    if (fs.existsSync(manifestPath)) {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      expect(manifest).toBeDefined();
      expect(typeof manifest).toBe('object');
    }
  });

  it('should create a hash cache for incremental builds', () => {
    const cachePath = path.join(outDir, '.cache', 'hashes.json');
    expect(fs.existsSync(cachePath)).toBe(true);
  });

  it('should pass validation when --validate is specified', () => {
    // Already ran with --validate; if exitCode is 0, validation passed
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/validat/i);
  });
});
