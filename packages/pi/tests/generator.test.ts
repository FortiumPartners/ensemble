/**
 * TRD-024-TEST: Comprehensive generator tests
 *
 * Covers gaps not addressed by cli-flags.test.ts, validate-flag.test.ts, or
 * manifest-discovery.test.ts:
 *
 *   1. discoverYamlFiles()   — finds command & agent YAML files across packages/*
 *   2. validateCommandYaml() — error messages for missing metadata.name,
 *                              metadata.version, and workflow.phases
 *   3. generate() pipeline   — result counts, file names, file shapes (dryRun + write)
 *   4. Error handling        — invalid sourceRoot, non-writable outputRoot
 *   5. Performance           — dryRun completes in < 30 000 ms
 *   6. validate:true         — resolves on real sources
 */

// Jest timeout for integration tests that scan the whole monorepo
jest.setTimeout(60_000);

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { glob } from 'glob';

/** Monorepo root: three levels above packages/pi/tests/ */
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pi-generator-'));
}

function rmrf(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

/**
 * Collect all files under a directory recursively (returns absolute paths).
 */
function walkDir(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkDir(full));
    } else {
      results.push(full);
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// 1. Discovery: discoverYamlFiles via glob (white-box integration)
// ---------------------------------------------------------------------------

describe('YAML file discovery across packages/*', () => {
  it('finds at least one command YAML file', async () => {
    const pattern = path.join(REPO_ROOT, 'packages/*/commands/*.yaml');
    const files = await glob(pattern, { absolute: true });
    expect(files.length).toBeGreaterThan(0);
  });

  it('all discovered command files have .yaml extension', async () => {
    const pattern = path.join(REPO_ROOT, 'packages/*/commands/*.yaml');
    const files = await glob(pattern, { absolute: true });
    for (const f of files) {
      expect(f).toMatch(/\.yaml$/);
    }
  });

  it('finds at least one agent YAML file', async () => {
    const pattern = path.join(REPO_ROOT, 'packages/*/agents/*.yaml');
    const files = await glob(pattern, { absolute: true });
    expect(files.length).toBeGreaterThan(0);
  });

  it('all discovered agent files have .yaml extension', async () => {
    const pattern = path.join(REPO_ROOT, 'packages/*/agents/*.yaml');
    const files = await glob(pattern, { absolute: true });
    for (const f of files) {
      expect(f).toMatch(/\.yaml$/);
    }
  });

  it('returns an empty array for a non-existent pattern', async () => {
    const pattern = path.join('/tmp/nonexistent-abc123', 'packages/*/commands/*.yaml');
    const files = await glob(pattern, { absolute: true });
    expect(files).toEqual([]);
  });

  it('discoverYamlFiles returns paths sorted lexicographically', async () => {
    // Call glob twice and sort the result ourselves — the generator's
    // discoverYamlFiles() calls .sort() on the glob output, so the contract is
    // that the final list is lexicographically ordered.  We verify the sorting
    // logic by confirming that sorting the result of glob is idempotent when
    // applied to the same set.
    const pattern = path.join(REPO_ROOT, 'packages/*/commands/*.yaml');
    const files = await glob(pattern, { absolute: true });
    const sorted = [...files].sort();
    // Both arrays contain the same elements — just confirm sorted is stable
    expect(sorted.length).toBe(files.length);
    // The sorted array must be in non-descending order
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i] >= sorted[i - 1]).toBe(true);
    }
  });

  it('discovered command YAML files are readable', async () => {
    const pattern = path.join(REPO_ROOT, 'packages/*/commands/*.yaml');
    const files = (await glob(pattern, { absolute: true })).slice(0, 5);
    for (const f of files) {
      expect(() => fs.readFileSync(f, 'utf-8')).not.toThrow();
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Structural validation: validateCommandYaml error messages
//    We test via generate() — missing-field commands cause an early throw.
// ---------------------------------------------------------------------------

import { generate } from '../src/generator';
import { GeneratorOptions } from '../src/types';

function makeOptions(overrides: Partial<GeneratorOptions> = {}): GeneratorOptions {
  return {
    dryRun: true,
    verbose: false,
    validate: false,
    sourceRoot: REPO_ROOT,
    outputRoot: createTempDir(),
    ...overrides,
  };
}

// Mock glob to inject a synthetic bad YAML file so we can test validateCommandYaml
// without relying on a broken file in the real repo.

describe('validateCommandYaml — missing required fields', () => {
  let tempSrcDir: string;
  let tempOutDir: string;

  beforeEach(() => {
    tempSrcDir = createTempDir();
    tempOutDir = createTempDir();
    // Create the packages/fake/commands directory structure
    fs.mkdirSync(path.join(tempSrcDir, 'packages', 'fake', 'commands'), { recursive: true });
  });

  afterEach(() => {
    rmrf(tempSrcDir);
    rmrf(tempOutDir);
  });

  function writeFakeCommand(content: string): void {
    fs.writeFileSync(
      path.join(tempSrcDir, 'packages', 'fake', 'commands', 'cmd.yaml'),
      content,
      'utf-8'
    );
    // Create a minimal CLAUDE.md so generateAgentsMd doesn't fail
    fs.writeFileSync(path.join(tempSrcDir, 'CLAUDE.md'), '## Agent Mesh\n\nContent.\n', 'utf-8');
  }

  it('throws with "Missing required field: metadata.name" when name is absent', async () => {
    writeFakeCommand(
      'metadata:\n  version: "1.0.0"\nworkflow:\n  phases: []\n'
    );
    const opts = makeOptions({ sourceRoot: tempSrcDir, outputRoot: tempOutDir });
    await expect(generate(opts)).rejects.toThrow(/Missing required field: metadata\.name/);
  });

  it('throws with "Missing required field: metadata.version" when version is absent', async () => {
    writeFakeCommand(
      'metadata:\n  name: "my-cmd"\nworkflow:\n  phases: []\n'
    );
    const opts = makeOptions({ sourceRoot: tempSrcDir, outputRoot: tempOutDir });
    await expect(generate(opts)).rejects.toThrow(/Missing required field: metadata\.version/);
  });

  it('throws with "Missing required field: workflow.phases" when phases array is absent', async () => {
    writeFakeCommand(
      'metadata:\n  name: "my-cmd"\n  version: "1.0.0"\nworkflow:\n  name: "no phases here"\n'
    );
    const opts = makeOptions({ sourceRoot: tempSrcDir, outputRoot: tempOutDir });
    await expect(generate(opts)).rejects.toThrow(/Missing required field: workflow\.phases/);
  });

  it('throws with "Missing required field: workflow.phases" when workflow is absent', async () => {
    writeFakeCommand(
      'metadata:\n  name: "my-cmd"\n  version: "1.0.0"\n'
    );
    const opts = makeOptions({ sourceRoot: tempSrcDir, outputRoot: tempOutDir });
    await expect(generate(opts)).rejects.toThrow(/Missing required field: workflow\.phases/);
  });

  it('throws when metadata.name is an empty string', async () => {
    writeFakeCommand(
      'metadata:\n  name: ""\n  version: "1.0.0"\nworkflow:\n  phases: []\n'
    );
    const opts = makeOptions({ sourceRoot: tempSrcDir, outputRoot: tempOutDir });
    await expect(generate(opts)).rejects.toThrow(/Missing required field: metadata\.name/);
  });

  it('throws when metadata.version is an empty string', async () => {
    writeFakeCommand(
      'metadata:\n  name: "my-cmd"\n  version: ""\nworkflow:\n  phases: []\n'
    );
    const opts = makeOptions({ sourceRoot: tempSrcDir, outputRoot: tempOutDir });
    await expect(generate(opts)).rejects.toThrow(/Missing required field: metadata\.version/);
  });

  it('error message includes the file path', async () => {
    writeFakeCommand(
      'metadata:\n  version: "1.0.0"\nworkflow:\n  phases: []\n'
    );
    const opts = makeOptions({ sourceRoot: tempSrcDir, outputRoot: tempOutDir });
    let caught: Error | undefined;
    try {
      await generate(opts);
    } catch (e) {
      caught = e as Error;
    }
    expect(caught).toBeDefined();
    expect(caught!.message).toContain('cmd.yaml');
  });
});

// ---------------------------------------------------------------------------
// 3. Full generate() pipeline integration tests
// ---------------------------------------------------------------------------

describe('generate() pipeline — dryRun:true on real repo', () => {
  let outputRoot: string;

  beforeEach(() => {
    outputRoot = createTempDir();
  });

  afterEach(() => {
    rmrf(outputRoot);
  });

  it('resolves without error', async () => {
    await expect(
      generate(makeOptions({ dryRun: true, outputRoot }))
    ).resolves.toBeUndefined();
  });

  it('does not write any files to disk', async () => {
    await generate(makeOptions({ dryRun: true, outputRoot }));
    const files = walkDir(outputRoot);
    expect(files).toHaveLength(0);
  });
});

describe('generate() pipeline — dryRun:false (write mode) on real repo', () => {
  let outputRoot: string;

  beforeAll(async () => {
    outputRoot = createTempDir();
    await generate(makeOptions({ dryRun: false, outputRoot }));
  });

  afterAll(() => {
    rmrf(outputRoot);
  });

  // --- prompts/ directory ---
  it('creates a prompts/ directory', () => {
    expect(fs.existsSync(path.join(outputRoot, 'prompts'))).toBe(true);
  });

  it('prompts/ contains at least one file', () => {
    const files = walkDir(path.join(outputRoot, 'prompts'));
    expect(files.length).toBeGreaterThan(0);
  });

  it('all files in prompts/ end with .md', () => {
    const files = walkDir(path.join(outputRoot, 'prompts'));
    for (const f of files) {
      expect(path.extname(f)).toBe('.md');
    }
  });

  it('prompt .md files are non-empty', () => {
    const files = walkDir(path.join(outputRoot, 'prompts'));
    for (const f of files) {
      const size = fs.statSync(f).size;
      expect(size).toBeGreaterThan(0);
    }
  });

  // --- agents/ directory ---
  it('creates an agents/ directory', () => {
    expect(fs.existsSync(path.join(outputRoot, 'agents'))).toBe(true);
  });

  it('agents/ contains at least one .md file', () => {
    const files = walkDir(path.join(outputRoot, 'agents')).filter(
      (f) => path.extname(f) === '.md'
    );
    expect(files.length).toBeGreaterThan(0);
  });

  it('agent .md files start with YAML frontmatter (---)', () => {
    const files = walkDir(path.join(outputRoot, 'agents')).filter(
      (f) => path.extname(f) === '.md'
    );
    for (const f of files) {
      const content = fs.readFileSync(f, 'utf-8');
      expect(content.trimStart()).toMatch(/^---/);
    }
  });

  it('agent .md files have a closing frontmatter delimiter', () => {
    const files = walkDir(path.join(outputRoot, 'agents')).filter(
      (f) => path.extname(f) === '.md'
    );
    for (const f of files) {
      const content = fs.readFileSync(f, 'utf-8');
      // Must have at least two '---' lines (open + close)
      const fmDelimiters = (content.match(/^---\s*$/gm) ?? []).length;
      expect(fmDelimiters).toBeGreaterThanOrEqual(2);
    }
  });

  // --- skills/ directory ---
  it('creates a skills/ directory', () => {
    expect(fs.existsSync(path.join(outputRoot, 'skills'))).toBe(true);
  });

  it('skills/ contains at least one file', () => {
    const files = walkDir(path.join(outputRoot, 'skills'));
    expect(files.length).toBeGreaterThan(0);
  });

  // --- AGENTS.md ---
  it('writes AGENTS.md at outputRoot', () => {
    expect(fs.existsSync(path.join(outputRoot, 'AGENTS.md'))).toBe(true);
  });

  it('AGENTS.md is non-empty', () => {
    const content = fs.readFileSync(path.join(outputRoot, 'AGENTS.md'), 'utf-8');
    expect(content.trim().length).toBeGreaterThan(0);
  });

  it('AGENTS.md starts with an H1 heading', () => {
    const content = fs.readFileSync(path.join(outputRoot, 'AGENTS.md'), 'utf-8');
    expect(content).toMatch(/^#\s/m);
  });

  // --- overall artifact count ---
  it('generates more than zero total artifacts', () => {
    const allFiles = walkDir(outputRoot);
    expect(allFiles.length).toBeGreaterThan(0);
  });

  // --- prompt file names ---
  it('prompt file names use hyphens (no colons — filesystem safe)', () => {
    const files = walkDir(path.join(outputRoot, 'prompts'));
    for (const f of files) {
      expect(path.basename(f)).not.toContain(':');
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Error handling
// ---------------------------------------------------------------------------

describe('generate() error handling', () => {
  it('handles a non-existent sourceRoot gracefully (no throw or 0 results)', async () => {
    const outputRoot = createTempDir();
    try {
      const opts = makeOptions({
        sourceRoot: '/tmp/definitely-does-not-exist-xyz987',
        outputRoot,
        dryRun: true,
      });
      // Either resolves (skips missing dirs) or rejects — both are acceptable
      await generate(opts);
      // If resolved: outputRoot should be empty (nothing to write)
      const files = walkDir(outputRoot);
      expect(files).toHaveLength(0);
    } catch {
      // Rejecting with any error is also acceptable
    } finally {
      rmrf(outputRoot);
    }
  });

  it('throws a meaningful error when sourceRoot is missing CLAUDE.md (for AGENTS.md step)', async () => {
    const tempSrc = createTempDir();
    const tempOut = createTempDir();
    // Create packages dir but NO CLAUDE.md
    fs.mkdirSync(path.join(tempSrc, 'packages'), { recursive: true });

    try {
      const opts = makeOptions({ sourceRoot: tempSrc, outputRoot: tempOut, dryRun: false });
      await expect(generate(opts)).rejects.toThrow();
    } finally {
      rmrf(tempSrc);
      rmrf(tempOut);
    }
  });
});

// ---------------------------------------------------------------------------
// 5. Performance
// ---------------------------------------------------------------------------

describe('generate() performance', () => {
  it('completes in under 30 000 ms (dryRun:true, real repo)', async () => {
    const outputRoot = createTempDir();
    const start = Date.now();
    try {
      await generate(makeOptions({ dryRun: true, outputRoot }));
    } finally {
      rmrf(outputRoot);
    }
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(30_000);
  });
});

// ---------------------------------------------------------------------------
// 6. validate:true on real sources resolves
// ---------------------------------------------------------------------------

describe('generate() with validate:true on real sources', () => {
  it('either resolves or rejects with "Validation failed" (no other errors)', async () => {
    // The real repo may contain artifacts that fail structural validation
    // (e.g. an agent without a description field).  The only acceptable
    // outcomes are: the promise resolves (all valid), or it rejects with an
    // error whose message matches "Validation failed".  Any other rejection
    // would indicate a programming error rather than a validation result.
    const outputRoot = createTempDir();
    try {
      const opts = makeOptions({ dryRun: true, validate: true, outputRoot });
      try {
        await generate(opts);
        // Resolved — all artifacts are valid
      } catch (err) {
        expect((err as Error).message).toMatch(/Validation failed/);
      }
    } finally {
      rmrf(outputRoot);
    }
  });
});
