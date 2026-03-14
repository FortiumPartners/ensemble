/**
 * Unit tests for ManifestGenerator (OC-S3-MF-001 through OC-S3-MF-008)
 * and OC-S3-TEST-009
 *
 * TDD: These tests are written BEFORE the implementation.
 * Strategy: Test each config section independently, then integration
 * of all sections into the final opencode.json.
 */

'use strict';

const path = require('path');
const fs = require('fs');

const {
  ManifestGenerator,
} = require('../../../scripts/generate-opencode/src/manifest-generator.js');

const FIXTURES_DIR = path.resolve(__dirname, '__fixtures__');
const ROOT = path.resolve(__dirname, '..', '..', '..');
const PACKAGES_DIR = path.join(ROOT, 'packages');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a temporary directory structure with mock plugin.json files.
 * Returns the path to the temp packages dir.
 */
function createMockPackages(tmpDir, packages) {
  for (const pkg of packages) {
    const pluginDir = path.join(tmpDir, pkg.name, '.claude-plugin');
    fs.mkdirSync(pluginDir, { recursive: true });
    fs.writeFileSync(
      path.join(pluginDir, 'plugin.json'),
      JSON.stringify(pkg.manifest, null, 2),
      'utf-8'
    );
    // Create package.json if provided
    if (pkg.packageJson) {
      fs.writeFileSync(
        path.join(tmpDir, pkg.name, 'package.json'),
        JSON.stringify(pkg.packageJson, null, 2),
        'utf-8'
      );
    }
  }
  return tmpDir;
}

/**
 * Create a basic ManifestGenerator with defaults and optional overrides.
 */
function createGenerator(overrides = {}) {
  return new ManifestGenerator({
    packagesDir: PACKAGES_DIR,
    outputDir: '/tmp/manifest-generator-test-output',
    skillPaths: ['.opencode/skill'],
    commandConfig: {},
    agentConfig: {},
    pluginPackageName: 'ensemble-opencode',
    pluginVersion: '5.3.0',
    dryRun: true,
    verbose: false,
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// OC-S3-MF-001: Discover and read plugin.json manifests
// ---------------------------------------------------------------------------
describe('OC-S3-MF-001: ManifestGenerator class construction and manifest discovery', () => {
  it('should instantiate with required options', () => {
    const gen = createGenerator();
    expect(gen).toBeDefined();
  });

  it('should discover plugin.json files across packages/', () => {
    const gen = createGenerator();
    const manifests = gen.discoverManifests();
    // The real packages directory has 26 plugin.json files
    expect(manifests.length).toBeGreaterThanOrEqual(20);
  });

  it('should parse plugin.json and extract name, version, description', () => {
    const gen = createGenerator();
    const manifests = gen.discoverManifests();
    // Find the core package
    const core = manifests.find((m) => m.name === 'ensemble-core');
    expect(core).toBeDefined();
    expect(core.name).toBe('ensemble-core');
    expect(core.version).toBeDefined();
    expect(core.description).toBeDefined();
  });

  it('should build a registry of all discovered plugins', () => {
    const gen = createGenerator();
    const manifests = gen.discoverManifests();
    const registry = gen.buildRegistry(manifests);
    expect(registry).toBeDefined();
    expect(typeof registry).toBe('object');
    expect(registry['ensemble-core']).toBeDefined();
    expect(registry['ensemble-development']).toBeDefined();
  });

  it('should handle missing packages directory gracefully', () => {
    const gen = createGenerator({ packagesDir: '/nonexistent/path' });
    const manifests = gen.discoverManifests();
    expect(manifests).toEqual([]);
  });

  it('should skip packages without plugin.json', () => {
    const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'mf-test-'));
    // Create a directory without plugin.json
    fs.mkdirSync(path.join(tmpDir, 'no-plugin'), { recursive: true });
    // Create one with plugin.json
    createMockPackages(tmpDir, [
      {
        name: 'has-plugin',
        manifest: {
          name: 'ensemble-has-plugin',
          version: '1.0.0',
          description: 'test',
        },
      },
    ]);

    const gen = createGenerator({ packagesDir: tmpDir });
    const manifests = gen.discoverManifests();
    expect(manifests).toHaveLength(1);
    expect(manifests[0].name).toBe('ensemble-has-plugin');

    // Cleanup
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should handle malformed plugin.json gracefully', () => {
    const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'mf-test-'));
    const pluginDir = path.join(tmpDir, 'bad-pkg', '.claude-plugin');
    fs.mkdirSync(pluginDir, { recursive: true });
    fs.writeFileSync(path.join(pluginDir, 'plugin.json'), 'not valid json', 'utf-8');

    const gen = createGenerator({ packagesDir: tmpDir });
    const manifests = gen.discoverManifests();
    // Should skip malformed files, not throw
    expect(manifests).toEqual([]);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// OC-S3-MF-003: Generate command block from CommandTranslator output
// ---------------------------------------------------------------------------
describe('OC-S3-MF-003: Generate command block', () => {
  it('should accept command config entries and produce command section', () => {
    const commandConfig = {
      'ensemble:create-prd': {
        description: 'Create comprehensive PRD',
        subtask: false,
      },
      'ensemble:fix-issue': {
        description: 'Lightweight bug fix workflow',
        subtask: false,
        agent: 'build',
        model: 'anthropic/claude-opus-4-6',
      },
    };

    const gen = createGenerator({ commandConfig });
    const section = gen.generateCommandSection();
    expect(section).toEqual(commandConfig);
  });

  it('should return empty object when no commands provided', () => {
    const gen = createGenerator({ commandConfig: {} });
    const section = gen.generateCommandSection();
    expect(section).toEqual({});
  });

  it('should preserve all command entry fields', () => {
    const commandConfig = {
      'ensemble:release': {
        description: 'Orchestrate release workflow',
        subtask: false,
        agent: 'build',
        model: 'anthropic/claude-sonnet-4-20250514',
      },
    };

    const gen = createGenerator({ commandConfig });
    const section = gen.generateCommandSection();
    expect(section['ensemble:release'].agent).toBe('build');
    expect(section['ensemble:release'].model).toBe(
      'anthropic/claude-sonnet-4-20250514'
    );
  });
});

// ---------------------------------------------------------------------------
// OC-S3-MF-004: Generate skills.paths from SkillCopier output
// ---------------------------------------------------------------------------
describe('OC-S3-MF-004: Generate skills section', () => {
  it('should produce skills section with paths array', () => {
    const gen = createGenerator({ skillPaths: ['.opencode/skill'] });
    const section = gen.generateSkillsSection();
    expect(section).toEqual({
      paths: ['.opencode/skill'],
    });
  });

  it('should accept multiple skill paths', () => {
    const gen = createGenerator({
      skillPaths: ['.opencode/skill', './custom-skills'],
    });
    const section = gen.generateSkillsSection();
    expect(section.paths).toHaveLength(2);
    expect(section.paths).toContain('.opencode/skill');
    expect(section.paths).toContain('./custom-skills');
  });

  it('should return empty paths array when no paths provided', () => {
    const gen = createGenerator({ skillPaths: [] });
    const section = gen.generateSkillsSection();
    expect(section).toEqual({ paths: [] });
  });
});

// ---------------------------------------------------------------------------
// OC-S3-MF-005: Generate plugin array
// ---------------------------------------------------------------------------
describe('OC-S3-MF-005: Generate plugin array', () => {
  it('should reference ensemble-opencode with version', () => {
    const gen = createGenerator({
      pluginPackageName: 'ensemble-opencode',
      pluginVersion: '5.3.0',
    });
    const section = gen.generatePluginSection();
    expect(section).toEqual(['ensemble-opencode@5.3.0']);
  });

  it('should use provided package name and version', () => {
    const gen = createGenerator({
      pluginPackageName: 'my-custom-plugin',
      pluginVersion: '1.0.0',
    });
    const section = gen.generatePluginSection();
    expect(section).toEqual(['my-custom-plugin@1.0.0']);
  });
});

// ---------------------------------------------------------------------------
// OC-S3-MF-006: Generate instructions array
// ---------------------------------------------------------------------------
describe('OC-S3-MF-006: Generate instructions array', () => {
  it('should include AGENTS.md by default', () => {
    const gen = createGenerator();
    const section = gen.generateInstructionsSection();
    expect(section).toContain('AGENTS.md');
  });

  it('should detect and include CLAUDE.md if it exists in the project root', () => {
    // The real project has CLAUDE.md at root
    const gen = createGenerator();
    const section = gen.generateInstructionsSection(ROOT);
    // CLAUDE.md exists in this project
    expect(section).toContain('CLAUDE.md');
  });

  it('should not include CLAUDE.md if it does not exist', () => {
    const gen = createGenerator();
    const section = gen.generateInstructionsSection('/nonexistent/path');
    expect(section).not.toContain('CLAUDE.md');
    // But AGENTS.md should still be present as a default reference
    expect(section).toContain('AGENTS.md');
  });
});

// ---------------------------------------------------------------------------
// OC-S3-MF-007: Generate permission block
// ---------------------------------------------------------------------------
describe('OC-S3-MF-007: Generate permission block', () => {
  it('should produce conservative default permissions', () => {
    const gen = createGenerator();
    const section = gen.generatePermissionSection();
    expect(section).toEqual({
      bash: 'ask',
      edit: 'allow',
      read: 'allow',
    });
  });

  it('should allow custom permission overrides', () => {
    const gen = createGenerator({
      permissionOverrides: {
        bash: 'allow',
        read: { '*': 'allow', '*.env': 'ask' },
      },
    });
    const section = gen.generatePermissionSection();
    expect(section.bash).toBe('allow');
    expect(section.read).toEqual({ '*': 'allow', '*.env': 'ask' });
    // edit should still be the default
    expect(section.edit).toBe('allow');
  });
});

// ---------------------------------------------------------------------------
// OC-S3-MF-008: Config merging and output
// ---------------------------------------------------------------------------
describe('OC-S3-MF-008: Config merging and file output', () => {
  it('should merge all sections into a complete opencode.json structure', () => {
    const gen = createGenerator({
      commandConfig: {
        'ensemble:create-prd': {
          description: 'Create PRD',
          subtask: false,
        },
      },
      skillPaths: ['.opencode/skill'],
      pluginPackageName: 'ensemble-opencode',
      pluginVersion: '5.3.0',
    });

    const config = gen.buildConfig(ROOT);
    expect(config.$schema).toBe('https://opencode.ai/config.json');
    expect(config.model).toBe('anthropic/claude-sonnet-4-20250514');
    expect(config.command).toBeDefined();
    expect(config.command['ensemble:create-prd']).toBeDefined();
    expect(config.skills).toBeDefined();
    expect(config.skills.paths).toContain('.opencode/skill');
    expect(config.plugin).toEqual(['ensemble-opencode@5.3.0']);
    expect(config.instructions).toBeDefined();
    expect(config.permission).toBeDefined();
    expect(config.permission.bash).toBe('ask');
  });

  it('should include $schema reference', () => {
    const gen = createGenerator();
    const config = gen.buildConfig();
    expect(config.$schema).toBe('https://opencode.ai/config.json');
  });

  it('should include default model', () => {
    const gen = createGenerator();
    const config = gen.buildConfig();
    expect(config.model).toBe('anthropic/claude-sonnet-4-20250514');
  });

  it('should support dryRun mode (no file written)', () => {
    const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'mf-out-'));
    const gen = createGenerator({
      outputDir: tmpDir,
      dryRun: true,
    });
    const result = gen.executeSync();
    // Should not create the file
    const configPath = path.join(tmpDir, 'opencode.json');
    expect(fs.existsSync(configPath)).toBe(false);
    expect(result.configContent).toBeDefined();

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should write opencode.json to outputDir when not in dryRun', () => {
    const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'mf-out-'));
    const gen = createGenerator({
      outputDir: tmpDir,
      dryRun: false,
    });
    const result = gen.executeSync();
    const configPath = path.join(tmpDir, 'opencode.json');
    expect(fs.existsSync(configPath)).toBe(true);

    // Verify content is valid JSON
    const written = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    expect(written.$schema).toBe('https://opencode.ai/config.json');
    expect(result.configPath).toBe(configPath);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should create output directory if it does not exist', () => {
    const tmpDir = path.join(
      require('os').tmpdir(),
      'mf-nested-' + Date.now(),
      'deep',
      'output'
    );
    const gen = createGenerator({
      outputDir: tmpDir,
      dryRun: false,
    });
    const result = gen.executeSync();
    expect(fs.existsSync(path.join(tmpDir, 'opencode.json'))).toBe(true);
    expect(result.errors).toEqual([]);

    fs.rmSync(path.join(require('os').tmpdir(), 'mf-nested-' + Date.now()), {
      recursive: true,
      force: true,
    });
  });

  it('should return manifestsRead count', () => {
    const gen = createGenerator();
    const result = gen.executeSync();
    expect(result.manifestsRead).toBeGreaterThanOrEqual(20);
  });

  it('should return the config content object', () => {
    const gen = createGenerator();
    const result = gen.executeSync();
    expect(result.configContent).toBeDefined();
    expect(result.configContent.$schema).toBe('https://opencode.ai/config.json');
    expect(result.configContent.permission).toBeDefined();
  });

  it('should return errors array (empty on success)', () => {
    const gen = createGenerator();
    const result = gen.executeSync();
    expect(Array.isArray(result.errors)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Integration: Full pipeline with real packages/
// ---------------------------------------------------------------------------
describe('Integration: ManifestGenerator with real package directory', () => {
  it('should produce a valid opencode.json from real packages', () => {
    const gen = createGenerator({
      commandConfig: {
        'ensemble:fold-prompt': {
          description: 'Optimize Claude environment',
          subtask: false,
        },
      },
      skillPaths: ['.opencode/skill'],
      agentConfig: {},
      pluginPackageName: 'ensemble-opencode',
      pluginVersion: '5.3.0',
    });

    const result = gen.executeSync(ROOT);
    expect(result.errors).toEqual([]);
    expect(result.manifestsRead).toBeGreaterThanOrEqual(20);

    const config = result.configContent;
    expect(config.$schema).toBe('https://opencode.ai/config.json');
    expect(config.model).toBe('anthropic/claude-sonnet-4-20250514');
    expect(config.command['ensemble:fold-prompt']).toBeDefined();
    expect(config.skills.paths).toContain('.opencode/skill');
    expect(config.plugin).toEqual(['ensemble-opencode@5.3.0']);
    expect(config.permission.bash).toBe('ask');
    expect(config.permission.edit).toBe('allow');
    expect(config.permission.read).toBe('allow');
    expect(config.instructions).toContain('AGENTS.md');
  });

  it('should include agent config when provided (skipping MF-002 agent generation)', () => {
    const agentConfig = {
      'backend-developer': {
        name: 'backend-developer',
        description: 'Server-side development specialist',
        mode: 'subagent',
      },
    };

    const gen = createGenerator({ agentConfig });
    const result = gen.executeSync(ROOT);
    const config = result.configContent;

    // Agent config should be merged into the agent block
    expect(config.agent).toBeDefined();
    expect(config.agent['backend-developer']).toBeDefined();
    expect(config.agent['backend-developer'].mode).toBe('subagent');
  });

  it('should omit agent block when agentConfig is empty', () => {
    const gen = createGenerator({ agentConfig: {} });
    const result = gen.executeSync(ROOT);
    const config = result.configContent;

    // When no agents are configured, the agent key should be absent or empty
    if (config.agent) {
      expect(Object.keys(config.agent)).toHaveLength(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------
describe('Edge cases', () => {
  it('should handle empty packages directory', () => {
    const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'mf-empty-'));
    const gen = createGenerator({ packagesDir: tmpDir });
    const result = gen.executeSync();
    expect(result.manifestsRead).toBe(0);
    expect(result.errors).toEqual([]);
    // Config should still be valid with all sections
    expect(result.configContent.$schema).toBe('https://opencode.ai/config.json');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should generate valid JSON output (no trailing commas, valid structure)', () => {
    const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'mf-json-'));
    const gen = createGenerator({ outputDir: tmpDir, dryRun: false });
    gen.executeSync();

    const content = fs.readFileSync(path.join(tmpDir, 'opencode.json'), 'utf-8');
    // Should parse without error
    expect(() => JSON.parse(content)).not.toThrow();
    // Should be pretty-printed (indented)
    expect(content).toContain('\n');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should produce consistent output across multiple runs', () => {
    const gen = createGenerator();
    const result1 = gen.executeSync();
    const result2 = gen.executeSync();

    expect(JSON.stringify(result1.configContent)).toBe(
      JSON.stringify(result2.configContent)
    );
  });
});
