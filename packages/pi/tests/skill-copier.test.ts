/**
 * Tests for skill-copier transformer (TRD-008-TEST)
 *
 * Covers:
 * 1. Copy SKILL.md and REFERENCE.md from discovered packages
 * 2. Self-referential skip: packages/pi is excluded from scan
 * 3. Deduplication: same real file skipped if seen twice
 * 4. Dry-run mode: returns results but writes no files
 * 5. Result shape: type === 'skill', sourcePath, outputPath, content
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { copySkills } from '../src/transformers/skill-copier';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pi-skill-copier-'));
}

function rmrf(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

/**
 * Build a minimal fake monorepo under `root`:
 *
 *   root/
 *     packages/
 *       alpha/
 *         skills/
 *           SKILL.md          ← top-level layout
 *           REFERENCE.md
 *       beta/
 *         skills/
 *           my-skill/
 *             SKILL.md        ← subdirectory layout
 *       pi/
 *         skills/
 *           SKILL.md          ← should be skipped (self-referential)
 */
function buildFakeMonorepo(root: string): void {
  // alpha — top-level skill files
  const alphaSkills = path.join(root, 'packages', 'alpha', 'skills');
  fs.mkdirSync(alphaSkills, { recursive: true });
  fs.writeFileSync(path.join(alphaSkills, 'SKILL.md'), '# Alpha Skill\nContent here.\n', 'utf-8');
  fs.writeFileSync(
    path.join(alphaSkills, 'REFERENCE.md'),
    '# Alpha Reference\nRef content.\n',
    'utf-8'
  );

  // beta — subdirectory skill layout
  const betaSubSkill = path.join(root, 'packages', 'beta', 'skills', 'my-skill');
  fs.mkdirSync(betaSubSkill, { recursive: true });
  fs.writeFileSync(
    path.join(betaSubSkill, 'SKILL.md'),
    '# Beta My-Skill\nBeta content.\n',
    'utf-8'
  );

  // pi — should be excluded
  const piSkills = path.join(root, 'packages', 'pi', 'skills');
  fs.mkdirSync(piSkills, { recursive: true });
  fs.writeFileSync(path.join(piSkills, 'SKILL.md'), '# Pi Skill — should be skipped\n', 'utf-8');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('copySkills', () => {
  let sourceRoot: string;
  let outputRoot: string;

  beforeEach(() => {
    sourceRoot = createTempDir();
    outputRoot = createTempDir();
    buildFakeMonorepo(sourceRoot);
  });

  afterEach(() => {
    rmrf(sourceRoot);
    rmrf(outputRoot);
  });

  // -------------------------------------------------------------------------
  // 1. Copies SKILL.md and REFERENCE.md from discovered packages
  // -------------------------------------------------------------------------
  it('copies SKILL.md files from discovered packages', async () => {
    const results = await copySkills(sourceRoot, outputRoot, {});

    const skillFiles = results.filter((r) => r.outputPath.endsWith('SKILL.md'));
    // alpha (top-level) + beta/my-skill (subdirectory)
    expect(skillFiles.length).toBeGreaterThanOrEqual(2);
  });

  it('copies REFERENCE.md files from discovered packages', async () => {
    const results = await copySkills(sourceRoot, outputRoot, {});

    const refFiles = results.filter((r) => r.outputPath.endsWith('REFERENCE.md'));
    // alpha has a REFERENCE.md
    expect(refFiles.length).toBeGreaterThanOrEqual(1);
  });

  it('writes files to outputRoot/skills/<skill-name>/<filename>', async () => {
    const results = await copySkills(sourceRoot, outputRoot, {});

    for (const result of results) {
      // Every output path must sit under outputRoot/skills/
      expect(result.outputPath.startsWith(path.join(outputRoot, 'skills'))).toBe(true);
      // Written file must actually exist on disk
      expect(fs.existsSync(result.outputPath)).toBe(true);
    }
  });

  it('preserves file content byte-for-byte', async () => {
    const results = await copySkills(sourceRoot, outputRoot, {});

    for (const result of results) {
      const written = fs.readFileSync(result.outputPath, 'utf-8');
      expect(written).toBe(result.content);
    }
  });

  // -------------------------------------------------------------------------
  // 2. Self-referential skip: packages/pi is excluded
  // -------------------------------------------------------------------------
  it('excludes the pi package from scan', async () => {
    const results = await copySkills(sourceRoot, outputRoot, {});

    // No result should have sourced from the pi package
    for (const result of results) {
      expect(result.sourcePath).not.toContain(
        path.join(sourceRoot, 'packages', 'pi')
      );
    }
  });

  it('does not write pi skill files to output', async () => {
    await copySkills(sourceRoot, outputRoot, {});

    // If pi were included it would appear under outputRoot/skills/pi/
    const piOutputDir = path.join(outputRoot, 'skills', 'pi');
    expect(fs.existsSync(piOutputDir)).toBe(false);
  });

  // -------------------------------------------------------------------------
  // 3. Deduplication: same real file copied only once
  // -------------------------------------------------------------------------
  it('deduplicates when two paths resolve to the same real file', async () => {
    // Create a second package that symlinks to alpha's skills directory
    const gammaSkills = path.join(sourceRoot, 'packages', 'gamma', 'skills');
    fs.mkdirSync(path.dirname(gammaSkills), { recursive: true });
    const alphaSkillFile = path.join(sourceRoot, 'packages', 'alpha', 'skills', 'SKILL.md');
    // Symlink the gamma skills directory to alpha's skills directory
    fs.symlinkSync(path.join(sourceRoot, 'packages', 'alpha', 'skills'), gammaSkills);

    const results = await copySkills(sourceRoot, outputRoot, {});

    // Count unique outputPaths — there should be no duplicates
    const outputPaths = results.map((r) => r.outputPath);
    const uniqueOutputPaths = new Set(outputPaths);
    expect(outputPaths.length).toBe(uniqueOutputPaths.size);

    // Count results that come from the alpha SKILL.md real path
    const alphaSkillResults = results.filter((r) =>
      fs.existsSync(r.sourcePath) &&
      (r.sourcePath === alphaSkillFile ||
        (fs.existsSync(r.sourcePath) &&
          fs.realpathSync(r.sourcePath) === fs.realpathSync(alphaSkillFile)))
    );
    // Should appear only once even though two packages reference the same file
    expect(alphaSkillResults.length).toBeLessThanOrEqual(1);
  });

  // -------------------------------------------------------------------------
  // 4. Dry-run mode
  // -------------------------------------------------------------------------
  it('returns results without writing files when dryRun is true', async () => {
    const results = await copySkills(sourceRoot, outputRoot, { dryRun: true });

    // Results must be non-empty (there are skills to copy)
    expect(results.length).toBeGreaterThan(0);

    // No files should exist in outputRoot/skills/
    const skillsOutputDir = path.join(outputRoot, 'skills');
    expect(fs.existsSync(skillsOutputDir)).toBe(false);
  });

  it('resolves without error in dry-run mode', async () => {
    await expect(copySkills(sourceRoot, outputRoot, { dryRun: true })).resolves.toBeDefined();
  });

  // -------------------------------------------------------------------------
  // 5. Result shape
  // -------------------------------------------------------------------------
  it('each result has type === "skill"', async () => {
    const results = await copySkills(sourceRoot, outputRoot, {});

    for (const result of results) {
      expect(result.type).toBe('skill');
    }
  });

  it('each result has sourcePath, outputPath, and content fields', async () => {
    const results = await copySkills(sourceRoot, outputRoot, {});

    for (const result of results) {
      expect(typeof result.sourcePath).toBe('string');
      expect(result.sourcePath.length).toBeGreaterThan(0);
      expect(typeof result.outputPath).toBe('string');
      expect(result.outputPath.length).toBeGreaterThan(0);
      expect(typeof result.content).toBe('string');
      expect(result.content.length).toBeGreaterThan(0);
    }
  });

  // -------------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------------
  it('returns empty array when packages directory does not exist', async () => {
    const emptyRoot = createTempDir();
    try {
      const results = await copySkills(emptyRoot, outputRoot, {});
      expect(results).toEqual([]);
    } finally {
      rmrf(emptyRoot);
    }
  });

  it('handles packages without a skills directory gracefully', async () => {
    // Add a package with no skills dir
    const noSkillPkg = path.join(sourceRoot, 'packages', 'noskills');
    fs.mkdirSync(noSkillPkg, { recursive: true });
    fs.writeFileSync(path.join(noSkillPkg, 'package.json'), '{}', 'utf-8');

    await expect(copySkills(sourceRoot, outputRoot, {})).resolves.toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Integration: real packages directory
// ---------------------------------------------------------------------------
describe('copySkills against real packages directory', () => {
  let outputRoot: string;
  // Monorepo root is two levels up from packages/pi/
  const repoRoot = path.resolve(__dirname, '..', '..', '..');

  beforeEach(() => {
    outputRoot = createTempDir();
  });

  afterEach(() => {
    rmrf(outputRoot);
  });

  it('discovers at least one skill file from the real monorepo', async () => {
    const results = await copySkills(repoRoot, outputRoot, { dryRun: true });
    expect(results.length).toBeGreaterThan(0);
  });

  it('does not include any source from packages/pi', async () => {
    const results = await copySkills(repoRoot, outputRoot, { dryRun: true });
    const piPkgPath = path.join(repoRoot, 'packages', 'pi');
    for (const result of results) {
      expect(result.sourcePath.startsWith(piPkgPath)).toBe(false);
    }
  });

  it('all results have type === "skill"', async () => {
    const results = await copySkills(repoRoot, outputRoot, { dryRun: true });
    for (const result of results) {
      expect(result.type).toBe('skill');
    }
  });
});
