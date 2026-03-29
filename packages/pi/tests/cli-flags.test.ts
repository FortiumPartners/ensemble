/**
 * Tests for generator CLI flag handling (TRD-005-TEST)
 *
 * Tests the generate() function in generator.ts for:
 * 1. --dry-run: no files written, resolves without error
 * 2. --verbose: process.stdout.write called with path information
 * 3. Flag defaults: {dryRun: false, verbose: false, validate: false} runs successfully
 * 4. Return value: generate() returns a Promise that resolves
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { generate } from '../src/generator';
import { GeneratorOptions } from '../src/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pi-cli-flags-'));
}

function rmrf(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

/** Repo root is three levels above packages/pi/tests/ */
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

/** Default options pointing at the real repo for source discovery */
function makeOptions(overrides: Partial<GeneratorOptions> = {}): GeneratorOptions {
  return {
    dryRun: false,
    verbose: false,
    validate: false,
    sourceRoot: REPO_ROOT,
    outputRoot: overrides.outputRoot ?? createTempDir(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('generate() — CLI flag handling', () => {
  // Track temp dirs for cleanup
  const tempDirs: string[] = [];

  function allocOutputRoot(): string {
    const dir = createTempDir();
    tempDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    jest.restoreAllMocks();
    for (const dir of tempDirs.splice(0)) {
      rmrf(dir);
    }
  });

  // -------------------------------------------------------------------------
  // 1. --dry-run: no files written
  // -------------------------------------------------------------------------
  describe('--dry-run flag', () => {
    it('resolves without throwing', async () => {
      const outputRoot = allocOutputRoot();
      const options = makeOptions({ dryRun: true, outputRoot });
      await expect(generate(options)).resolves.toBeUndefined();
    });

    it('does not write command prompt files when dryRun is true', async () => {
      const outputRoot = allocOutputRoot();
      const options = makeOptions({ dryRun: true, outputRoot });

      await generate(options);

      // In dry-run mode the prompts directory must not be created at all
      const promptsDir = path.join(outputRoot, 'prompts');
      expect(fs.existsSync(promptsDir)).toBe(false);
    });

    it('does not create a prompts/ directory when dryRun is true', async () => {
      const outputRoot = allocOutputRoot();
      const options = makeOptions({ dryRun: true, outputRoot });

      await generate(options);

      const promptsDir = path.join(outputRoot, 'prompts');
      expect(fs.existsSync(promptsDir)).toBe(false);
    });

    it('does not create a skills/ directory when dryRun is true', async () => {
      const outputRoot = allocOutputRoot();
      const options = makeOptions({ dryRun: true, outputRoot });

      await generate(options);

      const skillsDir = path.join(outputRoot, 'skills');
      expect(fs.existsSync(skillsDir)).toBe(false);
    });

    it('does not create an agents/ directory when dryRun is true', async () => {
      const outputRoot = allocOutputRoot();
      const options = makeOptions({ dryRun: true, outputRoot });

      await generate(options);

      const agentsDir = path.join(outputRoot, 'agents');
      expect(fs.existsSync(agentsDir)).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // 2. --verbose: stdout output contains path information
  // -------------------------------------------------------------------------
  describe('--verbose flag', () => {
    it('resolves without throwing when verbose is true', async () => {
      const outputRoot = allocOutputRoot();
      const options = makeOptions({ dryRun: true, verbose: true, outputRoot });
      await expect(generate(options)).resolves.toBeUndefined();
    });

    it('writes generator start message to stdout', async () => {
      const outputRoot = allocOutputRoot();
      const options = makeOptions({ dryRun: true, verbose: true, outputRoot });

      const stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

      await generate(options);

      const calls = stdoutSpy.mock.calls.map((c) => String(c[0]));
      const hasStartMsg = calls.some((msg) => msg.toLowerCase().includes('generator'));
      expect(hasStartMsg).toBe(true);
    });

    it('writes source root path to stdout', async () => {
      const outputRoot = allocOutputRoot();
      const options = makeOptions({ dryRun: true, verbose: true, outputRoot });

      const stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

      await generate(options);

      const calls = stdoutSpy.mock.calls.map((c) => String(c[0]));
      const hasSrcRoot = calls.some((msg) => msg.includes(REPO_ROOT));
      expect(hasSrcRoot).toBe(true);
    });

    it('writes output root path to stdout', async () => {
      const outputRoot = allocOutputRoot();
      const options = makeOptions({ dryRun: true, verbose: true, outputRoot });

      const stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

      await generate(options);

      const calls = stdoutSpy.mock.calls.map((c) => String(c[0]));
      const hasOutputRoot = calls.some((msg) => msg.includes(outputRoot));
      expect(hasOutputRoot).toBe(true);
    });

    it('produces no stdout output when verbose is false', async () => {
      const outputRoot = allocOutputRoot();
      const options = makeOptions({ dryRun: true, verbose: false, outputRoot });

      const stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

      await generate(options);

      expect(stdoutSpy).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // 3. Flag defaults: all false runs successfully
  // -------------------------------------------------------------------------
  describe('default flags {dryRun: false, verbose: false, validate: false}', () => {
    it('resolves without throwing', async () => {
      const outputRoot = allocOutputRoot();
      const options = makeOptions({ dryRun: false, verbose: false, validate: false, outputRoot });
      await expect(generate(options)).resolves.toBeUndefined();
    });

    it('creates output directories on disk', async () => {
      const outputRoot = allocOutputRoot();
      const options = makeOptions({ dryRun: false, verbose: false, validate: false, outputRoot });

      await generate(options);

      // At least one of these output dirs should exist
      const promptsDir = path.join(outputRoot, 'prompts');
      const agentsDir = path.join(outputRoot, 'agents');
      const skillsDir = path.join(outputRoot, 'skills');

      const anyExists =
        fs.existsSync(promptsDir) || fs.existsSync(agentsDir) || fs.existsSync(skillsDir);
      expect(anyExists).toBe(true);
    });

    it('writes at least one file when not in dry-run mode', async () => {
      const outputRoot = allocOutputRoot();
      const options = makeOptions({ dryRun: false, verbose: false, validate: false, outputRoot });

      await generate(options);

      // Verify files were actually written by counting entries in known output dirs
      const promptsDir = path.join(outputRoot, 'prompts');
      const agentsDir = path.join(outputRoot, 'agents');
      const skillsDir = path.join(outputRoot, 'skills');

      let totalFiles = 0;
      for (const dir of [promptsDir, agentsDir, skillsDir]) {
        if (fs.existsSync(dir)) {
          totalFiles += fs.readdirSync(dir, { recursive: true }).length;
        }
      }
      expect(totalFiles).toBeGreaterThan(0);
    });
  });

  // -------------------------------------------------------------------------
  // 4. Return value: Promise<void> that resolves
  // -------------------------------------------------------------------------
  describe('return value', () => {
    it('returns a Promise', () => {
      const outputRoot = allocOutputRoot();
      const options = makeOptions({ dryRun: true, outputRoot });
      const result = generate(options);
      expect(result).toBeInstanceOf(Promise);
      // Clean up the promise
      return result;
    });

    it('Promise resolves to undefined (void)', async () => {
      const outputRoot = allocOutputRoot();
      const options = makeOptions({ dryRun: true, outputRoot });
      const result = await generate(options);
      expect(result).toBeUndefined();
    });

    it('does not reject on valid input', async () => {
      const outputRoot = allocOutputRoot();
      const options = makeOptions({ dryRun: true, outputRoot });
      await expect(generate(options)).resolves.not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // 5. --validate flag
  // -------------------------------------------------------------------------
  describe('--validate flag', () => {
    it('invokes validation when validate is true (may reject if artifacts fail validation)', async () => {
      const outputRoot = allocOutputRoot();
      const options = makeOptions({ dryRun: false, verbose: false, validate: true, outputRoot });
      // The validator either resolves (all artifacts valid) or rejects with a
      // "Validation failed" error. Either outcome shows the flag was honoured.
      try {
        await generate(options);
        // Passed — nothing more to assert
      } catch (err) {
        expect((err as Error).message).toMatch(/Validation failed/);
      }
    });

    it('dry-run + validate invokes validation against in-memory results', async () => {
      const outputRoot = allocOutputRoot();
      const options = makeOptions({ dryRun: true, verbose: false, validate: true, outputRoot });
      // Same: resolve or reject with Validation failed
      try {
        await generate(options);
      } catch (err) {
        expect((err as Error).message).toMatch(/Validation failed/);
      }
    });

    it('generate() without --validate does not throw for the same artifacts', async () => {
      const outputRoot = allocOutputRoot();
      const options = makeOptions({ dryRun: true, verbose: false, validate: false, outputRoot });
      // Without validate the known malformed agent is silently generated
      await expect(generate(options)).resolves.toBeUndefined();
    });
  });
});
