/**
 * Unit tests for OC-S3-DIST-001, DIST-002, DIST-004, DIST-005, DIST-006, DIST-007, TEST-012
 * Tests for the ensemble-opencode plugin entry point and distribution configuration.
 *
 * TDD: These tests are written BEFORE the implementation.
 * Strategy: Validate plugin entry point, tool registration, and package configuration.
 *
 * Skills used: jest (test patterns, mocking)
 */

'use strict';

const fs = require('fs');
const path = require('path');

const PKG_DIR = path.resolve(__dirname, '..');
const ROOT = path.resolve(__dirname, '..', '..', '..');

// ---------------------------------------------------------------------------
// OC-S3-DIST-001: Plugin entry point
// ---------------------------------------------------------------------------
describe('OC-S3-DIST-001: Plugin entry point (src/index.ts and src/index.js)', () => {
  it('should have src/index.ts TypeScript source', () => {
    const tsPath = path.join(PKG_DIR, 'src', 'index.ts');
    expect(fs.existsSync(tsPath)).toBe(true);
  });

  it('should have src/index.js compiled output', () => {
    const jsPath = path.join(PKG_DIR, 'src', 'index.js');
    expect(fs.existsSync(jsPath)).toBe(true);
  });

  it('should export EnsemblePlugin as a named export', () => {
    const mod = require('../src/index.js');
    expect(mod.EnsemblePlugin).toBeDefined();
    expect(typeof mod.EnsemblePlugin).toBe('function');
  });

  it('should export EnsemblePlugin as default export', () => {
    const mod = require('../src/index.js');
    expect(mod.default).toBeDefined();
    expect(mod.default).toBe(mod.EnsemblePlugin);
  });

  it('EnsemblePlugin should be an async function (returns a Promise)', async () => {
    const { EnsemblePlugin } = require('../src/index.js');
    // Create a minimal mock context
    const mockCtx = {
      directory: PKG_DIR,
      worktree: ROOT,
      project: { name: 'test-project' },
      serverUrl: 'http://localhost:3000',
    };
    const result = EnsemblePlugin(mockCtx);
    expect(result).toBeInstanceOf(Promise);
    await result; // Should not throw
  });

  it('EnsemblePlugin should return an object with tool registrations', async () => {
    const { EnsemblePlugin } = require('../src/index.js');
    const mockCtx = {
      directory: PKG_DIR,
      worktree: ROOT,
      project: { name: 'test-project' },
      serverUrl: 'http://localhost:3000',
    };
    const hooks = await EnsemblePlugin(mockCtx);
    expect(hooks).toBeDefined();
    expect(typeof hooks).toBe('object');
    expect(hooks.tool).toBeDefined();
    expect(typeof hooks.tool).toBe('object');
  });
});

// ---------------------------------------------------------------------------
// OC-S3-DIST-002: Custom tool registration (ensemble-info)
// ---------------------------------------------------------------------------
describe('OC-S3-DIST-002: ensemble-info tool registration', () => {
  let hooks;
  const mockCtx = {
    directory: path.resolve(__dirname, '..'),
    worktree: path.resolve(__dirname, '..', '..', '..'),
    project: { name: 'test-project' },
    serverUrl: 'http://localhost:3000',
  };

  beforeAll(async () => {
    const { EnsemblePlugin } = require('../src/index.js');
    hooks = await EnsemblePlugin(mockCtx);
  });

  it('should register an ensemble-info tool', () => {
    expect(hooks.tool).toHaveProperty('ensemble-info');
  });

  it('ensemble-info tool should have a description', () => {
    const infoTool = hooks.tool['ensemble-info'];
    expect(infoTool.description).toBeDefined();
    expect(typeof infoTool.description).toBe('string');
    expect(infoTool.description.length).toBeGreaterThan(0);
  });

  it('ensemble-info tool should have an execute function', () => {
    const infoTool = hooks.tool['ensemble-info'];
    expect(infoTool.execute).toBeDefined();
    expect(typeof infoTool.execute).toBe('function');
  });

  it('ensemble-info tool execute should return version info', async () => {
    const infoTool = hooks.tool['ensemble-info'];
    const mockToolCtx = {
      sessionID: 'test-session',
      agent: 'test-agent',
      directory: PKG_DIR,
    };
    const result = await infoTool.execute({}, mockToolCtx);
    expect(typeof result).toBe('string');

    // Result should be parseable JSON
    const parsed = JSON.parse(result);
    expect(parsed.name).toBe('ensemble-opencode');
    expect(parsed.version).toBe('5.3.0');
  });

  it('ensemble-info should include agent count', async () => {
    const infoTool = hooks.tool['ensemble-info'];
    const result = await infoTool.execute({}, { sessionID: 's', agent: 'a', directory: PKG_DIR });
    const parsed = JSON.parse(result);
    expect(parsed.agents).toBeDefined();
    expect(typeof parsed.agents).toBe('number');
    expect(parsed.agents).toBe(28);
  });

  it('ensemble-info should include available capabilities', async () => {
    const infoTool = hooks.tool['ensemble-info'];
    const result = await infoTool.execute({}, { sessionID: 's', agent: 'a', directory: PKG_DIR });
    const parsed = JSON.parse(result);
    expect(parsed.capabilities).toBeDefined();
    expect(Array.isArray(parsed.capabilities)).toBe(true);
    expect(parsed.capabilities).toContain('agents');
    expect(parsed.capabilities).toContain('commands');
    expect(parsed.capabilities).toContain('skills');
  });

  it('ensemble-info should include runtime info', async () => {
    const infoTool = hooks.tool['ensemble-info'];
    const result = await infoTool.execute({}, { sessionID: 's', agent: 'a', directory: PKG_DIR });
    const parsed = JSON.parse(result);
    expect(parsed.runtime).toBe('opencode');
    expect(parsed.ecosystem).toBe('ensemble');
  });
});

// ---------------------------------------------------------------------------
// OC-S3-DIST-004: package.json publishing configuration
// ---------------------------------------------------------------------------
describe('OC-S3-DIST-004: package.json publishing configuration', () => {
  let pkg;

  beforeAll(() => {
    pkg = JSON.parse(
      fs.readFileSync(path.join(PKG_DIR, 'package.json'), 'utf-8')
    );
  });

  it('should have main pointing to src/index.js for Bun compatibility', () => {
    expect(pkg.main).toBe('src/index.js');
  });

  it('should have types pointing to src/index.ts', () => {
    expect(pkg.types).toBe('src/index.ts');
  });

  it('should have files array for npm publishing', () => {
    expect(Array.isArray(pkg.files)).toBe(true);
    expect(pkg.files).toContain('src/');
    expect(pkg.files).toContain('lib/');
  });

  it('should have opencode-specific keywords', () => {
    expect(pkg.keywords).toContain('opencode');
    expect(pkg.keywords).toContain('opencode-plugin');
    expect(pkg.keywords).toContain('ensemble');
    expect(pkg.keywords).toContain('ai-agents');
  });

  it('should have repository info', () => {
    expect(pkg.repository).toBeDefined();
    expect(pkg.repository.type).toBe('git');
    expect(pkg.repository.url).toContain('FortiumPartners/ensemble');
  });

  it('should have homepage', () => {
    expect(pkg.homepage).toBeDefined();
    expect(pkg.homepage).toContain('FortiumPartners/ensemble');
  });

  it('should have bugs URL', () => {
    expect(pkg.bugs).toBeDefined();
    expect(pkg.bugs.url).toContain('FortiumPartners/ensemble');
  });

  it('should have @opencode-ai/plugin as optional peer dependency', () => {
    expect(pkg.peerDependencies).toHaveProperty('@opencode-ai/plugin');
    // Check peerDependenciesMeta marks it as optional
    expect(pkg.peerDependenciesMeta).toBeDefined();
    expect(pkg.peerDependenciesMeta['@opencode-ai/plugin']).toBeDefined();
    expect(pkg.peerDependenciesMeta['@opencode-ai/plugin'].optional).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// OC-S3-DIST-005: Build step
// ---------------------------------------------------------------------------
describe('OC-S3-DIST-005: Build step configuration', () => {
  let pkg;

  beforeAll(() => {
    pkg = JSON.parse(
      fs.readFileSync(path.join(PKG_DIR, 'package.json'), 'utf-8')
    );
  });

  it('should have a build script', () => {
    expect(pkg.scripts).toHaveProperty('build');
  });

  it('should have a prepublishOnly script', () => {
    expect(pkg.scripts).toHaveProperty('prepublishOnly');
    // prepublishOnly should run build and tests
    expect(pkg.scripts.prepublishOnly).toContain('build');
    expect(pkg.scripts.prepublishOnly).toContain('test');
  });
});

// ---------------------------------------------------------------------------
// OC-S3-DIST-006: file:/// local path installation support
// ---------------------------------------------------------------------------
describe('OC-S3-DIST-006: Local file:// installation support', () => {
  it('should have a valid package structure for file:// references', () => {
    // When installed via file:///path/to/packages/opencode,
    // the main entry point must exist
    const mainPath = path.join(PKG_DIR, 'src', 'index.js');
    expect(fs.existsSync(mainPath)).toBe(true);
  });

  it('src/index.js should be requireable without build step', () => {
    // For file:// install, the JS file must work directly
    expect(() => {
      require('../src/index.js');
    }).not.toThrow();
  });

  it('should document local installation in package.json', () => {
    // The package.json should have a comment-like field documenting file:// usage
    const pkg = JSON.parse(
      fs.readFileSync(path.join(PKG_DIR, 'package.json'), 'utf-8')
    );
    // We use an opencode config field to document this
    expect(pkg.opencode).toBeDefined();
    expect(pkg.opencode.localInstall).toBeDefined();
    expect(typeof pkg.opencode.localInstall).toBe('string');
    expect(pkg.opencode.localInstall).toContain('file:///');
  });
});

// ---------------------------------------------------------------------------
// OC-S3-DIST-007: Version sync
// ---------------------------------------------------------------------------
describe('OC-S3-DIST-007: Version sync with ecosystem', () => {
  it('should match ensemble ecosystem version (5.3.0)', () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(PKG_DIR, 'package.json'), 'utf-8')
    );
    expect(pkg.version).toBe('5.3.0');
  });

  it('should match plugin.json version', () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(PKG_DIR, 'package.json'), 'utf-8')
    );
    const pluginJson = JSON.parse(
      fs.readFileSync(
        path.join(PKG_DIR, '.claude-plugin', 'plugin.json'),
        'utf-8'
      )
    );
    expect(pkg.version).toBe(pluginJson.version);
  });

  it('should have a validate:version script or be covered by validate pipeline', () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(PKG_DIR, 'package.json'), 'utf-8')
    );
    // Either has its own validate:version script or the root validate covers it
    const hasVersionScript = pkg.scripts && pkg.scripts['validate:version'];
    const rootPkg = JSON.parse(
      fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8')
    );
    const rootHasValidate = rootPkg.scripts && rootPkg.scripts.validate;
    expect(hasVersionScript || rootHasValidate).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// OC-S3-TEST-012: Plugin entry point integration
// ---------------------------------------------------------------------------
describe('OC-S3-TEST-012: Plugin entry point integration', () => {
  it('should handle missing ctx fields gracefully', async () => {
    const { EnsemblePlugin } = require('../src/index.js');
    // Minimal context - only required fields
    const minimalCtx = {};
    await expect(EnsemblePlugin(minimalCtx)).resolves.toBeDefined();
  });

  it('should not throw when ctx.directory is undefined', async () => {
    const { EnsemblePlugin } = require('../src/index.js');
    const result = await EnsemblePlugin({ directory: undefined });
    expect(result).toBeDefined();
    expect(result.tool).toBeDefined();
  });

  it('should return consistent structure across multiple calls', async () => {
    const { EnsemblePlugin } = require('../src/index.js');
    const ctx = { directory: PKG_DIR };
    const result1 = await EnsemblePlugin(ctx);
    const result2 = await EnsemblePlugin(ctx);
    expect(Object.keys(result1.tool)).toEqual(Object.keys(result2.tool));
  });

  it('plugin module should not have side effects on import', () => {
    // Re-requiring should not throw or produce side effects
    jest.resetModules();
    expect(() => {
      require('../src/index.js');
    }).not.toThrow();
  });

  it('ensemble-info tool should handle execution errors gracefully', async () => {
    const { EnsemblePlugin } = require('../src/index.js');
    const hooks = await EnsemblePlugin({ directory: '/nonexistent/path' });
    const infoTool = hooks.tool['ensemble-info'];
    // Should still return valid JSON even with a bad directory
    const result = await infoTool.execute({}, { sessionID: 's', agent: 'a', directory: '/nonexistent' });
    expect(typeof result).toBe('string');
    const parsed = JSON.parse(result);
    expect(parsed.name).toBe('ensemble-opencode');
  });
});
