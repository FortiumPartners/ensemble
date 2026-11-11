/**
 * Unit tests for SkillCopier - OC-S1-SK-001 through OC-S1-SK-006 + OC-S1-TEST-001
 *
 * TDD: These tests are written BEFORE the implementation.
 *
 * Tests cover:
 *   - SK-001: Discovery of SKILL.md files across packages
 *   - SK-002: Frontmatter injection for files missing it
 *   - SK-003: REFERENCE.md to SKILL.md conversion
 *   - SK-004: Copy validated skills to output directory
 *   - SK-005: Generate skills.paths configuration entries
 *   - SK-006: Verify source SKILL.md files are not modified
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// The SkillCopier is a TypeScript file in scripts/generate-opencode/src/.
// For testing, we require the compiled JS or use a test-friendly wrapper.
// Since this is a Node.js project, we'll create a CJS-compatible wrapper.

// Helper: create a temporary directory structure mirroring packages/*/skills/<pkg>/ (a
// package's framework skill is the skill named after the package)
function createTempPackages(tmpDir, packages) {
  const packagesDir = path.join(tmpDir, 'packages');
  fs.mkdirSync(packagesDir, { recursive: true });

  for (const [pkgName, files] of Object.entries(packages)) {
    const skillDir = path.join(packagesDir, pkgName, 'skills', pkgName);
    fs.mkdirSync(skillDir, { recursive: true });

    for (const [fileName, content] of Object.entries(files)) {
      fs.writeFileSync(path.join(skillDir, fileName), content, 'utf-8');
    }
  }

  return packagesDir;
}

// We need to load the SkillCopier. Since it's TypeScript, we'll use
// a JS wrapper that the implementation should export.
let SkillCopier;
let parseFrontmatter;

beforeAll(() => {
  // Try loading from the lib/ compiled output first, then from src/ via a loader
  const libPath = path.resolve(
    __dirname,
    '..',
    'lib',
    'skill-copier.js'
  );
  const srcPath = path.resolve(
    __dirname,
    '..',
    '..',
    '..',
    'scripts',
    'generate-opencode',
    'src',
    'skill-copier.js'
  );

  if (fs.existsSync(libPath)) {
    ({ SkillCopier, parseFrontmatter } = require(libPath));
  } else if (fs.existsSync(srcPath)) {
    ({ SkillCopier, parseFrontmatter } = require(srcPath));
  } else {
    throw new Error(
      'SkillCopier not found. Ensure either packages/opencode/lib/skill-copier.js ' +
      'or scripts/generate-opencode/src/skill-copier.js exists.'
    );
  }
});

describe('OC-S1-SK-001: SkillCopier discovery', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-copier-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should discover all SKILL.md files across packages', async () => {
    const packagesDir = createTempPackages(tmpDir, {
      react: {
        'SKILL.md': '# React Skill\n\nReact development patterns.',
      },
      nestjs: {
        'SKILL.md':
          '---\nname: NestJS Framework\ndescription: NestJS backend\n---\n\n# NestJS Skill',
      },
      phoenix: {
        'SKILL.md': '# Phoenix Skill\n\nPhoenix framework patterns.',
      },
    });

    const outputDir = path.join(tmpDir, 'dist', 'opencode', '.opencode', 'skill');
    fs.mkdirSync(outputDir, { recursive: true });

    const copier = new SkillCopier({
      packagesDir,
      outputDir,
      injectFrontmatter: true,
      dryRun: true,
      verbose: false,
    });

    const result = await copier.execute();

    // Should discover 3 SKILL.md files
    expect(result.skillsCopied).toBe(3);
    expect(result.errors).toHaveLength(0);
  });

  it('should return metadata with package name for each discovered skill', async () => {
    const packagesDir = createTempPackages(tmpDir, {
      react: {
        'SKILL.md': '# React Skill\n\nReact development patterns.',
      },
      nestjs: {
        'SKILL.md': '# NestJS Skill\n\nNestJS patterns.',
      },
    });

    const outputDir = path.join(tmpDir, 'dist', 'opencode', '.opencode', 'skill');
    fs.mkdirSync(outputDir, { recursive: true });

    const copier = new SkillCopier({
      packagesDir,
      outputDir,
      injectFrontmatter: true,
      dryRun: true,
      verbose: false,
    });

    const result = await copier.execute();
    expect(result.skillsCopied).toBe(2);
    // paths should contain entries for each framework
    expect(result.paths).toEqual(
      expect.arrayContaining([
        expect.stringContaining('skill'),
      ])
    );
  });

  it('should handle packages with no skills directory gracefully', async () => {
    const packagesDir = path.join(tmpDir, 'packages');
    fs.mkdirSync(packagesDir, { recursive: true });
    // Create a package with no skills/ directory
    fs.mkdirSync(path.join(packagesDir, 'core'), { recursive: true });
    // Create a package WITH a skills directory
    const skillDir = path.join(packagesDir, 'react', 'skills', 'react');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      '# React Skill',
      'utf-8'
    );

    const outputDir = path.join(tmpDir, 'dist', 'opencode', '.opencode', 'skill');
    fs.mkdirSync(outputDir, { recursive: true });

    const copier = new SkillCopier({
      packagesDir,
      outputDir,
      injectFrontmatter: true,
      dryRun: true,
      verbose: false,
    });

    const result = await copier.execute();
    expect(result.skillsCopied).toBe(1);
    expect(result.errors).toHaveLength(0);
  });

  it('should not discover a flat skills/SKILL.md: a skill lives in skills/<name>/, named after its package', async () => {
    const flatSkillsDir = path.join(tmpDir, 'packages', 'react', 'skills');
    fs.mkdirSync(flatSkillsDir, { recursive: true });
    fs.writeFileSync(path.join(flatSkillsDir, 'SKILL.md'), '# React Skill', 'utf-8');
    fs.writeFileSync(path.join(flatSkillsDir, 'REFERENCE.md'), '# React Reference', 'utf-8');

    const outputDir = path.join(tmpDir, 'dist', 'opencode', '.opencode', 'skill');
    fs.mkdirSync(outputDir, { recursive: true });

    const copier = new SkillCopier({
      packagesDir: path.join(tmpDir, 'packages'),
      outputDir,
      injectFrontmatter: true,
      dryRun: true,
      verbose: false,
    });

    const result = await copier.execute();
    expect(result.skillsCopied).toBe(0);
    expect(result.referencesConverted).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it('should discover zero skills in an empty packages directory', async () => {
    const packagesDir = path.join(tmpDir, 'packages');
    fs.mkdirSync(packagesDir, { recursive: true });

    const outputDir = path.join(tmpDir, 'dist', 'opencode', '.opencode', 'skill');
    fs.mkdirSync(outputDir, { recursive: true });

    const copier = new SkillCopier({
      packagesDir,
      outputDir,
      injectFrontmatter: true,
      dryRun: true,
      verbose: false,
    });

    const result = await copier.execute();
    expect(result.skillsCopied).toBe(0);
    expect(result.referencesConverted).toBe(0);
    expect(result.errors).toHaveLength(0);
  });
});

describe('OC-S1-SK-002: Frontmatter injection', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-copier-fm-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should add frontmatter to SKILL.md files that lack it', async () => {
    const packagesDir = createTempPackages(tmpDir, {
      react: {
        'SKILL.md': '# React Framework - Quick Reference\n\nReact development patterns and best practices.',
      },
    });

    const outputDir = path.join(tmpDir, 'dist', 'opencode', '.opencode', 'skill');
    fs.mkdirSync(outputDir, { recursive: true });

    const copier = new SkillCopier({
      packagesDir,
      outputDir,
      injectFrontmatter: true,
      dryRun: false,
      verbose: false,
    });

    await copier.execute();

    const outputFile = path.join(outputDir, 'react', 'SKILL.md');
    expect(fs.existsSync(outputFile)).toBe(true);

    const content = fs.readFileSync(outputFile, 'utf-8');
    // Should start with frontmatter
    expect(content).toMatch(/^---\n/);
    // Should contain name field
    expect(content).toMatch(/name:\s*react/);
    // Should contain description field
    expect(content).toMatch(/description:/);
    // Should still contain original content
    expect(content).toContain('# React Framework - Quick Reference');
  });

  it('should preserve existing frontmatter and ensure name/description fields', async () => {
    const packagesDir = createTempPackages(tmpDir, {
      nestjs: {
        'SKILL.md':
          '---\nname: NestJS Framework\nversion: 1.0.0\n---\n\n# NestJS Skill\n\nNestJS patterns.',
      },
    });

    const outputDir = path.join(tmpDir, 'dist', 'opencode', '.opencode', 'skill');
    fs.mkdirSync(outputDir, { recursive: true });

    const copier = new SkillCopier({
      packagesDir,
      outputDir,
      injectFrontmatter: true,
      dryRun: false,
      verbose: false,
    });

    await copier.execute();

    const outputFile = path.join(outputDir, 'nestjs', 'SKILL.md');
    const content = fs.readFileSync(outputFile, 'utf-8');

    // Should have frontmatter
    expect(content).toMatch(/^---\n/);
    // Should preserve existing name
    expect(content).toMatch(/name:\s*NestJS Framework/);
    // Should preserve version
    expect(content).toMatch(/version:\s*1\.0\.0/);
    // Should contain description (auto-generated from content if missing)
    expect(content).toMatch(/description:/);
    // Should contain original body
    expect(content).toContain('# NestJS Skill');
  });

  it('should not alter frontmatter when it already has name and description', async () => {
    const originalFrontmatter =
      '---\nname: Jest Test Framework\ndescription: Execute and generate Jest tests\nversion: 1.0.0\n---\n\n# Jest Skill';

    const packagesDir = createTempPackages(tmpDir, {
      jest: {
        'SKILL.md': originalFrontmatter,
      },
    });

    const outputDir = path.join(tmpDir, 'dist', 'opencode', '.opencode', 'skill');
    fs.mkdirSync(outputDir, { recursive: true });

    const copier = new SkillCopier({
      packagesDir,
      outputDir,
      injectFrontmatter: true,
      dryRun: false,
      verbose: false,
    });

    await copier.execute();

    const outputFile = path.join(outputDir, 'jest', 'SKILL.md');
    const content = fs.readFileSync(outputFile, 'utf-8');

    expect(content).toMatch(/name:\s*Jest Test Framework/);
    expect(content).toMatch(/description:\s*Execute and generate Jest tests/);
    expect(content).toContain('# Jest Skill');
  });

  it('should skip frontmatter injection when injectFrontmatter is false', async () => {
    const packagesDir = createTempPackages(tmpDir, {
      react: {
        'SKILL.md': '# React Skill\n\nReact patterns.',
      },
    });

    const outputDir = path.join(tmpDir, 'dist', 'opencode', '.opencode', 'skill');
    fs.mkdirSync(outputDir, { recursive: true });

    const copier = new SkillCopier({
      packagesDir,
      outputDir,
      injectFrontmatter: false,
      dryRun: false,
      verbose: false,
    });

    await copier.execute();

    const outputFile = path.join(outputDir, 'react', 'SKILL.md');
    const content = fs.readFileSync(outputFile, 'utf-8');

    // Should NOT start with frontmatter
    expect(content).not.toMatch(/^---\n/);
    // Should contain original content as-is
    expect(content).toBe('# React Skill\n\nReact patterns.');
  });
});

describe('parseFrontmatter — CRLF line endings', () => {
  // Before the fix, parseFrontmatter's delimiter checks required a literal
  // '\n' next to '---', so a CRLF-sourced SKILL.md (the norm on Windows
  // checkouts with core.autocrlf=true) silently read as hasFrontmatter:
  // false, discarding real frontmatter as if it were part of the file body.
  const CRLF_CONTENT =
    '---\r\nname: nestjs\r\ndescription: NestJS backend\r\n---\r\n\r\n# NestJS Skill\r\n';

  it('detects frontmatter despite \\r\\n around the delimiters', () => {
    const result = parseFrontmatter(CRLF_CONTENT);
    expect(result.hasFrontmatter).toBe(true);
    expect(result.data).toEqual({ name: 'nestjs', description: 'NestJS backend' });
  });

  it('extracts the body content with the frontmatter block removed', () => {
    const result = parseFrontmatter(CRLF_CONTENT);
    expect(result.content.trim()).toBe('# NestJS Skill');
  });

  it('still reports no frontmatter for CRLF content with none', () => {
    const result = parseFrontmatter('# React Skill\r\n\r\nReact patterns.\r\n');
    expect(result.hasFrontmatter).toBe(false);
  });
});

describe('OC-S1-SK-003: REFERENCE.md to SKILL.md conversion', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-copier-ref-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should discover and convert REFERENCE.md files to SKILL.md', async () => {
    const packagesDir = createTempPackages(tmpDir, {
      react: {
        'SKILL.md': '# React Skill\n\nQuick reference.',
        'REFERENCE.md': '# React Framework - Comprehensive Guide\n\nDetailed reference.',
      },
    });

    const outputDir = path.join(tmpDir, 'dist', 'opencode', '.opencode', 'skill');
    fs.mkdirSync(outputDir, { recursive: true });

    const copier = new SkillCopier({
      packagesDir,
      outputDir,
      injectFrontmatter: true,
      dryRun: false,
      verbose: false,
    });

    const result = await copier.execute();

    expect(result.referencesConverted).toBe(1);

    // REFERENCE.md should be output as skill/<framework>/reference/SKILL.md
    const refOutputFile = path.join(outputDir, 'react', 'reference', 'SKILL.md');
    expect(fs.existsSync(refOutputFile)).toBe(true);

    const content = fs.readFileSync(refOutputFile, 'utf-8');
    // Should have frontmatter with name: react-reference
    expect(content).toMatch(/name:\s*react-reference/);
    expect(content).toMatch(/description:/);
    // Should contain original REFERENCE.md content
    expect(content).toContain('# React Framework - Comprehensive Guide');
  });

  it('should convert REFERENCE.md even when no SKILL.md exists', async () => {
    const packagesDir = createTempPackages(tmpDir, {
      blazor: {
        'REFERENCE.md': '# Blazor Comprehensive Guide\n\nDetailed Blazor reference.',
      },
    });

    // Also add a SKILL.md so it has something to discover as a skill
    // (REFERENCE.md alone should still be converted)
    const outputDir = path.join(tmpDir, 'dist', 'opencode', '.opencode', 'skill');
    fs.mkdirSync(outputDir, { recursive: true });

    const copier = new SkillCopier({
      packagesDir,
      outputDir,
      injectFrontmatter: true,
      dryRun: false,
      verbose: false,
    });

    const result = await copier.execute();

    expect(result.referencesConverted).toBe(1);

    const refOutputFile = path.join(outputDir, 'blazor', 'reference', 'SKILL.md');
    expect(fs.existsSync(refOutputFile)).toBe(true);
  });

  it('should add frontmatter with <framework>-reference name', async () => {
    const packagesDir = createTempPackages(tmpDir, {
      nestjs: {
        'REFERENCE.md': '# NestJS Comprehensive Guide\n\nEnterprise patterns for NestJS.',
      },
    });

    const outputDir = path.join(tmpDir, 'dist', 'opencode', '.opencode', 'skill');
    fs.mkdirSync(outputDir, { recursive: true });

    const copier = new SkillCopier({
      packagesDir,
      outputDir,
      injectFrontmatter: true,
      dryRun: false,
      verbose: false,
    });

    await copier.execute();

    const refOutputFile = path.join(outputDir, 'nestjs', 'reference', 'SKILL.md');
    const content = fs.readFileSync(refOutputFile, 'utf-8');
    expect(content).toMatch(/name:\s*nestjs-reference/);
  });
});

describe('OC-S1-SK-004: Copy to output directory', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-copier-copy-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should write SKILL.md files to dist/opencode/.opencode/skill/<framework>/', async () => {
    const packagesDir = createTempPackages(tmpDir, {
      react: {
        'SKILL.md': '# React Skill\n\nQuick reference.',
      },
      nestjs: {
        'SKILL.md': '# NestJS Skill\n\nNestJS patterns.',
      },
      phoenix: {
        'SKILL.md': '# Phoenix Skill\n\nPhoenix patterns.',
      },
    });

    const outputDir = path.join(tmpDir, 'dist', 'opencode', '.opencode', 'skill');
    fs.mkdirSync(outputDir, { recursive: true });

    const copier = new SkillCopier({
      packagesDir,
      outputDir,
      injectFrontmatter: true,
      dryRun: false,
      verbose: false,
    });

    const result = await copier.execute();

    expect(result.skillsCopied).toBe(3);

    // Check each framework directory exists with SKILL.md
    for (const framework of ['react', 'nestjs', 'phoenix']) {
      const outputFile = path.join(outputDir, framework, 'SKILL.md');
      expect(fs.existsSync(outputFile)).toBe(true);
    }
  });

  it('should create framework subdirectories automatically', async () => {
    const packagesDir = createTempPackages(tmpDir, {
      rails: {
        'SKILL.md': '# Rails Skill',
      },
    });

    const outputDir = path.join(tmpDir, 'dist', 'opencode', '.opencode', 'skill');
    // Don't pre-create the framework subdir
    fs.mkdirSync(outputDir, { recursive: true });

    const copier = new SkillCopier({
      packagesDir,
      outputDir,
      injectFrontmatter: true,
      dryRun: false,
      verbose: false,
    });

    await copier.execute();

    expect(fs.existsSync(path.join(outputDir, 'rails'))).toBe(true);
    expect(fs.existsSync(path.join(outputDir, 'rails', 'SKILL.md'))).toBe(true);
  });

  it('should not write any files when dryRun is true', async () => {
    const packagesDir = createTempPackages(tmpDir, {
      react: {
        'SKILL.md': '# React Skill\n\nQuick reference.',
      },
    });

    const outputDir = path.join(tmpDir, 'dist', 'opencode', '.opencode', 'skill');
    fs.mkdirSync(outputDir, { recursive: true });

    const copier = new SkillCopier({
      packagesDir,
      outputDir,
      injectFrontmatter: true,
      dryRun: true,
      verbose: false,
    });

    const result = await copier.execute();

    expect(result.skillsCopied).toBeGreaterThan(0);
    // Output directory should NOT have framework subdirectories
    expect(fs.existsSync(path.join(outputDir, 'react', 'SKILL.md'))).toBe(false);
  });
});

describe('OC-S1-SK-005: Generate skills.paths configuration', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-copier-cfg-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should return paths array for opencode.json skills config', async () => {
    const packagesDir = createTempPackages(tmpDir, {
      react: {
        'SKILL.md': '# React Skill',
      },
    });

    const outputDir = path.join(tmpDir, 'dist', 'opencode', '.opencode', 'skill');
    fs.mkdirSync(outputDir, { recursive: true });

    const copier = new SkillCopier({
      packagesDir,
      outputDir,
      injectFrontmatter: true,
      dryRun: false,
      verbose: false,
    });

    const result = await copier.execute();

    // Should return the base skill path for opencode.json
    expect(result.paths).toBeDefined();
    expect(Array.isArray(result.paths)).toBe(true);
    expect(result.paths.length).toBeGreaterThan(0);
  });

  it('should generate a single base path pointing to the skill directory', async () => {
    const packagesDir = createTempPackages(tmpDir, {
      react: { 'SKILL.md': '# React' },
      nestjs: { 'SKILL.md': '# NestJS' },
    });

    const outputDir = path.join(tmpDir, 'dist', 'opencode', '.opencode', 'skill');
    fs.mkdirSync(outputDir, { recursive: true });

    const copier = new SkillCopier({
      packagesDir,
      outputDir,
      injectFrontmatter: true,
      dryRun: false,
      verbose: false,
    });

    const result = await copier.execute();

    // The paths config should point to the skill output base directory
    // OpenCode discovers skills recursively from the base path
    expect(result.paths).toContainEqual(
      expect.stringContaining('skill')
    );
  });

  it('should return getConfig() method with proper structure', async () => {
    const packagesDir = createTempPackages(tmpDir, {
      react: { 'SKILL.md': '# React' },
    });

    const outputDir = path.join(tmpDir, 'dist', 'opencode', '.opencode', 'skill');
    fs.mkdirSync(outputDir, { recursive: true });

    const copier = new SkillCopier({
      packagesDir,
      outputDir,
      injectFrontmatter: true,
      dryRun: false,
      verbose: false,
    });

    const result = await copier.execute();

    // The result should have paths suitable for inclusion in opencode.json
    expect(result.paths).toEqual(
      expect.arrayContaining([expect.any(String)])
    );
  });
});

describe('OC-S1-SK-006: Source files not modified (regression safety)', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-copier-safe-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should NOT modify the original SKILL.md source files', async () => {
    const originalContent = '# React Framework - Quick Reference\n\nReact development patterns.';
    const packagesDir = createTempPackages(tmpDir, {
      react: {
        'SKILL.md': originalContent,
      },
    });

    const outputDir = path.join(tmpDir, 'dist', 'opencode', '.opencode', 'skill');
    fs.mkdirSync(outputDir, { recursive: true });

    const copier = new SkillCopier({
      packagesDir,
      outputDir,
      injectFrontmatter: true,
      dryRun: false,
      verbose: false,
    });

    await copier.execute();

    // The source file MUST be unchanged
    const sourceFile = path.join(packagesDir, 'react', 'skills', 'react', 'SKILL.md');
    const afterContent = fs.readFileSync(sourceFile, 'utf-8');
    expect(afterContent).toBe(originalContent);
  });

  it('should NOT modify the original REFERENCE.md source files', async () => {
    const originalContent = '# React Framework - Comprehensive Guide\n\nDetailed reference.';
    const packagesDir = createTempPackages(tmpDir, {
      react: {
        'REFERENCE.md': originalContent,
      },
    });

    const outputDir = path.join(tmpDir, 'dist', 'opencode', '.opencode', 'skill');
    fs.mkdirSync(outputDir, { recursive: true });

    const copier = new SkillCopier({
      packagesDir,
      outputDir,
      injectFrontmatter: true,
      dryRun: false,
      verbose: false,
    });

    await copier.execute();

    const sourceFile = path.join(packagesDir, 'react', 'skills', 'react', 'REFERENCE.md');
    const afterContent = fs.readFileSync(sourceFile, 'utf-8');
    expect(afterContent).toBe(originalContent);
  });

  it('should NOT modify source files with existing frontmatter', async () => {
    const originalContent =
      '---\nname: Jest Test Framework\ndescription: Jest tests\nversion: 1.0.0\n---\n\n# Jest Skill';
    const packagesDir = createTempPackages(tmpDir, {
      jest: {
        'SKILL.md': originalContent,
      },
    });

    const outputDir = path.join(tmpDir, 'dist', 'opencode', '.opencode', 'skill');
    fs.mkdirSync(outputDir, { recursive: true });

    const copier = new SkillCopier({
      packagesDir,
      outputDir,
      injectFrontmatter: true,
      dryRun: false,
      verbose: false,
    });

    await copier.execute();

    const sourceFile = path.join(packagesDir, 'jest', 'skills', 'jest', 'SKILL.md');
    const afterContent = fs.readFileSync(sourceFile, 'utf-8');
    expect(afterContent).toBe(originalContent);
  });
});

describe('OC-S1-SK integration: full pipeline', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-copier-full-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should handle a realistic multi-package scenario', async () => {
    const packagesDir = createTempPackages(tmpDir, {
      react: {
        'SKILL.md': '# React Framework - Quick Reference\n\n**Version**: 1.0.0\n**Framework**: React 18+',
        'REFERENCE.md': '# React Framework - Comprehensive Guide\n\nDetailed patterns.',
      },
      nestjs: {
        'SKILL.md':
          '---\nname: NestJS Framework\nversion: 1.0.0\ndescription: Node.js/TypeScript backend framework\n---\n\n# NestJS Framework Skill',
        'REFERENCE.md': '# NestJS Comprehensive Guide\n\nEnterprise patterns.',
      },
      jest: {
        'SKILL.md':
          '---\nname: Jest Test Framework\ndescription: Execute and generate Jest tests\nversion: 1.0.0\n---\n\n# Jest Test Framework',
        'REFERENCE.md': '# Jest Deep Reference\n\nAdvanced Jest patterns.',
      },
      phoenix: {
        'SKILL.md': '# Phoenix Framework Skill\n\nPhoenix/Elixir patterns.',
      },
    });

    const outputDir = path.join(tmpDir, 'dist', 'opencode', '.opencode', 'skill');
    fs.mkdirSync(outputDir, { recursive: true });

    const copier = new SkillCopier({
      packagesDir,
      outputDir,
      injectFrontmatter: true,
      dryRun: false,
      verbose: false,
    });

    const result = await copier.execute();

    // 4 SKILL.md files
    expect(result.skillsCopied).toBe(4);
    // 3 REFERENCE.md files
    expect(result.referencesConverted).toBe(3);
    expect(result.errors).toHaveLength(0);

    // Verify output structure
    expect(fs.existsSync(path.join(outputDir, 'react', 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(outputDir, 'nestjs', 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(outputDir, 'jest', 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(outputDir, 'phoenix', 'SKILL.md'))).toBe(true);

    // Verify reference conversions
    expect(fs.existsSync(path.join(outputDir, 'react', 'reference', 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(outputDir, 'nestjs', 'reference', 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(outputDir, 'jest', 'reference', 'SKILL.md'))).toBe(true);

    // Verify paths config
    expect(result.paths.length).toBeGreaterThan(0);
  });

  it('should produce valid frontmatter in all output files', async () => {
    const packagesDir = createTempPackages(tmpDir, {
      react: {
        'SKILL.md': '# React Skill\n\nReact development patterns.',
      },
    });

    const outputDir = path.join(tmpDir, 'dist', 'opencode', '.opencode', 'skill');
    fs.mkdirSync(outputDir, { recursive: true });

    const copier = new SkillCopier({
      packagesDir,
      outputDir,
      injectFrontmatter: true,
      dryRun: false,
      verbose: false,
    });

    await copier.execute();

    const outputFile = path.join(outputDir, 'react', 'SKILL.md');
    const content = fs.readFileSync(outputFile, 'utf-8');

    // Validate frontmatter structure: starts with ---, ends with ---
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n/);
    expect(fmMatch).not.toBeNull();

    // Parse the YAML between the delimiters
    const yamlContent = fmMatch[1];
    expect(yamlContent).toMatch(/name:/);
    expect(yamlContent).toMatch(/description:/);
  });

  it('should report errors for unreadable files without crashing', async () => {
    const packagesDir = createTempPackages(tmpDir, {
      react: {
        'SKILL.md': '# React Skill',
      },
    });

    // Make the file unreadable (if possible)
    const skillFile = path.join(packagesDir, 'react', 'skills', 'react', 'SKILL.md');
    try {
      fs.chmodSync(skillFile, 0o000);
    } catch {
      // On some systems this may not work; skip the test
      return;
    }

    const outputDir = path.join(tmpDir, 'dist', 'opencode', '.opencode', 'skill');
    fs.mkdirSync(outputDir, { recursive: true });

    const copier = new SkillCopier({
      packagesDir,
      outputDir,
      injectFrontmatter: true,
      dryRun: false,
      verbose: false,
    });

    const result = await copier.execute();

    // Should have an error but not throw
    expect(result.errors.length).toBeGreaterThan(0);

    // Restore permissions for cleanup
    fs.chmodSync(skillFile, 0o644);
  });
});

describe('OC-S1-SK: real packages integration', () => {
  const ROOT = path.resolve(__dirname, '..', '..', '..');
  const REAL_PACKAGES = path.join(ROOT, 'packages');

  // Only run if real packages exist
  const hasRealPackages = fs.existsSync(REAL_PACKAGES);

  (hasRealPackages ? it : it.skip)(
    'should discover actual SKILL.md files from the ensemble repo',
    async () => {
      let tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-copier-real-'));
      const outputDir = path.join(tmpDir, 'dist', 'opencode', '.opencode', 'skill');
      fs.mkdirSync(outputDir, { recursive: true });

      const copier = new SkillCopier({
        packagesDir: REAL_PACKAGES,
        outputDir,
        injectFrontmatter: true,
        dryRun: true,
        verbose: false,
      });

      const result = await copier.execute();

      // Real packages still ship many SKILL.md files; lean framework skills no longer carry REFERENCE.md
      expect(result.skillsCopied).toBeGreaterThanOrEqual(10);
      expect(result.referencesConverted).toBeGreaterThanOrEqual(1);
      expect(result.errors).toHaveLength(0);

      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  );
});

describe('OC-S1-SK adapter directories (TRD-020, PRD REQ-021)', () => {
  let tmpDir;

  // Build a `packages/<pkg>/skills/adapter-<name>/{SKILL.md,adapter.yaml}` layout: an adapter
  // directory sits beside the package's framework skill `skills/<pkg>/` that createTempPackages builds.
  function createAdapterPackage(root, pkgName, adapterDirName, files) {
    const adapterDir = path.join(root, 'packages', pkgName, 'skills', adapterDirName);
    fs.mkdirSync(adapterDir, { recursive: true });
    for (const [fileName, content] of Object.entries(files)) {
      fs.writeFileSync(path.join(adapterDir, fileName), content, 'utf-8');
    }
    return adapterDir;
  }

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-copier-adapter-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('discovers an adapter-*/SKILL.md directory and copies adapter.yaml alongside it, keyed by the adapter directory name', async () => {
    const packagesDir = path.join(tmpDir, 'packages');
    createAdapterPackage(tmpDir, 'fixturepkg', 'adapter-fixture-tracker', {
      'SKILL.md': '# Fixture Tracker Adapter\n\nFixture adapter for tests.',
      'adapter.yaml': 'adapter: fixture-tracker\nversion: "1.0.0"\ncategories:\n  - tracker\n',
    });

    const outputDir = path.join(tmpDir, 'out');
    fs.mkdirSync(outputDir, { recursive: true });

    const copier = new SkillCopier({
      packagesDir,
      outputDir,
      injectFrontmatter: true,
      dryRun: false,
      verbose: false,
    });

    const result = await copier.execute();
    expect(result.errors).toHaveLength(0);
    expect(result.skillsCopied).toBe(1);

    const adapterOutDir = path.join(outputDir, 'adapter-fixture-tracker');
    expect(fs.existsSync(path.join(adapterOutDir, 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(adapterOutDir, 'adapter.yaml'))).toBe(true);

    // adapter.yaml is copied byte-for-byte, never rewritten through the frontmatter path.
    const sourceYaml = fs.readFileSync(
      path.join(packagesDir, 'fixturepkg', 'skills', 'adapter-fixture-tracker', 'adapter.yaml')
    );
    const destYaml = fs.readFileSync(path.join(adapterOutDir, 'adapter.yaml'));
    expect(destYaml.equals(sourceYaml)).toBe(true);
  });

  it('keys two adapters sharing one owning package by their own directory names, not the package name', async () => {
    const packagesDir = path.join(tmpDir, 'packages');
    createAdapterPackage(tmpDir, 'multipkg', 'adapter-jira', {
      'SKILL.md': '# Jira adapter',
      'adapter.yaml': 'adapter: jira\n',
    });
    createAdapterPackage(tmpDir, 'multipkg', 'adapter-linear', {
      'SKILL.md': '# Linear adapter',
      'adapter.yaml': 'adapter: linear\n',
    });

    const outputDir = path.join(tmpDir, 'out');
    fs.mkdirSync(outputDir, { recursive: true });

    const copier = new SkillCopier({
      packagesDir,
      outputDir,
      injectFrontmatter: true,
      dryRun: false,
      verbose: false,
    });

    const result = await copier.execute();
    expect(result.errors).toHaveLength(0);
    expect(result.skillsCopied).toBe(2);
    expect(fs.existsSync(path.join(outputDir, 'adapter-jira', 'adapter.yaml'))).toBe(true);
    expect(fs.existsSync(path.join(outputDir, 'adapter-linear', 'adapter.yaml'))).toBe(true);
  });

  it('a plain framework skill (skills/<pkg>/SKILL.md) with no adapter.yaml is byte-identical before and after this feature (no adapter.yaml spuriously appears)', async () => {
    const packagesDir = createTempPackages(tmpDir, {
      plainpkg: { 'SKILL.md': '# Plain skill\n\nNo adapters here.' },
    });

    const outputDir = path.join(tmpDir, 'out');
    fs.mkdirSync(outputDir, { recursive: true });

    const copier = new SkillCopier({
      packagesDir,
      outputDir,
      injectFrontmatter: true,
      dryRun: false,
      verbose: false,
    });

    const result = await copier.execute();
    expect(result.skillsCopied).toBe(1);
    expect(fs.existsSync(path.join(outputDir, 'plainpkg', 'adapter.yaml'))).toBe(false);
  });

  it('mutation proof: an adapter directory whose SKILL.md is missing is skipped (adapter.yaml is never copied without a SKILL.md)', async () => {
    const packagesDir = path.join(tmpDir, 'packages');
    const adapterDir = path.join(packagesDir, 'fixturepkg', 'skills', 'adapter-incomplete');
    fs.mkdirSync(adapterDir, { recursive: true });
    fs.writeFileSync(path.join(adapterDir, 'adapter.yaml'), 'adapter: incomplete\n');
    // No SKILL.md written for this adapter directory.

    const outputDir = path.join(tmpDir, 'out');
    fs.mkdirSync(outputDir, { recursive: true });

    const copier = new SkillCopier({
      packagesDir,
      outputDir,
      injectFrontmatter: true,
      dryRun: false,
      verbose: false,
    });

    const result = await copier.execute();
    expect(result.skillsCopied).toBe(0);
    expect(fs.existsSync(path.join(outputDir, 'adapter-incomplete'))).toBe(false);
  });

  it('two different packages shipping an adapter dir with the same basename is a hard failure reported via result.errors, naming both colliding source paths, and writes nothing for that name', async () => {
    const packagesDir = path.join(tmpDir, 'packages');
    const adapterDirA = createAdapterPackage(tmpDir, 'collisionpkg-a', 'adapter-collision', {
      'SKILL.md': '# Package A Collision Adapter',
      'adapter.yaml': 'adapter: collision-a\n',
    });
    const adapterDirB = createAdapterPackage(tmpDir, 'collisionpkg-b', 'adapter-collision', {
      'SKILL.md': '# Package B Collision Adapter',
      'adapter.yaml': 'adapter: collision-b\n',
    });

    const outputDir = path.join(tmpDir, 'out');
    fs.mkdirSync(outputDir, { recursive: true });

    const copier = new SkillCopier({
      packagesDir,
      outputDir,
      injectFrontmatter: true,
      dryRun: false,
      verbose: false,
    });

    // Mutation-proof target: with the pre-fix behavior (no collision check), this would
    // silently succeed with result.errors empty and last-writer-wins one of the two
    // adapter.yaml files into outputDir/adapter-collision/.
    const result = await copier.execute();

    expect(result.errors.length).toBeGreaterThanOrEqual(1);
    const collisionError = result.errors.find((e) => e.file === 'adapter-collision');
    expect(collisionError).toBeDefined();
    expect(collisionError.error).toContain(adapterDirA);
    expect(collisionError.error).toContain(adapterDirB);

    // Fails before writing anything for the colliding name -- no last-writer-wins partial
    // output silently left behind.
    expect(fs.existsSync(path.join(outputDir, 'adapter-collision'))).toBe(false);
  });

  it('a stale adapter-* output directory whose source was removed is pruned on the next run (TRD-020 P2 fix: no resetOutput() equivalent, so output is otherwise additive-only)', async () => {
    const packagesDir = path.join(tmpDir, 'packages');
    createAdapterPackage(tmpDir, 'staletestpkg', 'adapter-will-be-removed', {
      'SKILL.md': '# Will be removed',
      'adapter.yaml': 'adapter: will-be-removed\n',
    });

    const outputDir = path.join(tmpDir, 'out');
    fs.mkdirSync(outputDir, { recursive: true });

    const copier = new SkillCopier({
      packagesDir,
      outputDir,
      injectFrontmatter: true,
      dryRun: false,
      verbose: false,
    });

    const firstRun = await copier.execute();
    expect(firstRun.skillsCopied).toBe(1);
    expect(fs.existsSync(path.join(outputDir, 'adapter-will-be-removed', 'SKILL.md'))).toBe(true);

    // Remove the SOURCE adapter directory entirely (not just its content) and regenerate.
    fs.rmSync(path.join(packagesDir, 'staletestpkg'), { recursive: true, force: true });

    const secondRun = await copier.execute();
    expect(secondRun.skillsCopied).toBe(0);
    expect(secondRun.prunedAdapters).toContain('adapter-will-be-removed');
    // Mutation-proof target: pre-fix, this directory remains fully resolver-visible forever
    // even though its source no longer exists.
    expect(fs.existsSync(path.join(outputDir, 'adapter-will-be-removed'))).toBe(false);
  });
});
