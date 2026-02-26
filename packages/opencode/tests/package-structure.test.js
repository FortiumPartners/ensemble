/**
 * Unit tests for OC-S1-PKG-001 through OC-S1-PKG-006
 * Validates the ensemble-opencode package scaffolding structure.
 *
 * TDD: These tests were written BEFORE the package files were created.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const PKG_DIR = path.resolve(__dirname, '..');
const SCRIPTS_DIR = path.join(ROOT, 'scripts', 'generate-opencode');
const DIST_DIR = path.join(ROOT, 'dist', 'opencode');

describe('OC-S1-PKG-001: packages/opencode/ directory structure', () => {
  it('should have a package.json with correct name and version', () => {
    const pkgPath = path.join(PKG_DIR, 'package.json');
    expect(fs.existsSync(pkgPath)).toBe(true);

    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    expect(pkg.name).toBe('@fortium/ensemble-opencode');
    expect(pkg.version).toBe('5.3.0');
    // Author can be string or object with name field (TRD specifies object form)
    if (typeof pkg.author === 'string') {
      expect(pkg.author).toBe('Fortium Partners');
    } else {
      expect(pkg.author).toHaveProperty('name', 'Fortium Partners');
    }
    expect(pkg.license).toBe('MIT');
  });

  it('should have a plugin.json manifest', () => {
    const pluginPath = path.join(PKG_DIR, '.claude-plugin', 'plugin.json');
    expect(fs.existsSync(pluginPath)).toBe(true);

    const plugin = JSON.parse(fs.readFileSync(pluginPath, 'utf-8'));
    expect(plugin.name).toBe('ensemble-opencode');
    expect(plugin.version).toBe('5.3.0');
    expect(plugin.author).toHaveProperty('name', 'Fortium Partners');
    expect(plugin.author).toHaveProperty('email', 'support@fortiumpartners.com');
  });

  it('should have a tsconfig.json', () => {
    const tsconfigPath = path.join(PKG_DIR, 'tsconfig.json');
    expect(fs.existsSync(tsconfigPath)).toBe(true);

    const tsconfig = JSON.parse(fs.readFileSync(tsconfigPath, 'utf-8'));
    expect(tsconfig.compilerOptions).toBeDefined();
    expect(tsconfig.compilerOptions.outDir).toBeDefined();
    expect(tsconfig.compilerOptions.strict).toBe(true);
  });

  it('should have standard directories: src/, tests/, lib/', () => {
    expect(fs.existsSync(path.join(PKG_DIR, 'src'))).toBe(true);
    expect(fs.existsSync(path.join(PKG_DIR, 'tests'))).toBe(true);
    expect(fs.existsSync(path.join(PKG_DIR, 'lib'))).toBe(true);
  });
});

describe('OC-S1-PKG-002: workspace registration', () => {
  it('should be included in root package.json workspaces via glob pattern', () => {
    const rootPkg = JSON.parse(
      fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8')
    );
    // The workspace glob "packages/*" automatically includes packages/opencode
    expect(rootPkg.workspaces).toContain('packages/*');
  });
});

describe('OC-S1-PKG-003: scripts/generate-opencode/ structure', () => {
  it('should have an index.ts entry point', () => {
    expect(fs.existsSync(path.join(SCRIPTS_DIR, 'index.ts'))).toBe(true);
  });

  it('should have src/ directory with translator modules', () => {
    const srcDir = path.join(SCRIPTS_DIR, 'src');
    expect(fs.existsSync(srcDir)).toBe(true);

    const expectedModules = [
      'skill-copier',
      'command-translator',
      'agent-translator',
      'hook-bridge',
      'manifest-generator',
    ];

    for (const mod of expectedModules) {
      // Each module should exist as .ts, .js, or .d.ts
      const hasTs = fs.existsSync(path.join(srcDir, mod + '.ts'));
      const hasJs = fs.existsSync(path.join(srcDir, mod + '.js'));
      const hasDts = fs.existsSync(path.join(srcDir, mod + '.d.ts'));
      expect(hasTs || hasJs || hasDts).toBe(true);
    }
  });
});

describe('OC-S1-PKG-004: dependencies', () => {
  it('should have @opencode-ai/plugin as devDependency', () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(PKG_DIR, 'package.json'), 'utf-8')
    );
    expect(pkg.devDependencies).toHaveProperty('@opencode-ai/plugin');
  });

  it('should have js-yaml as dependency', () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(PKG_DIR, 'package.json'), 'utf-8')
    );
    expect(pkg.dependencies).toHaveProperty('js-yaml');
  });

  it('should have gray-matter as dependency', () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(PKG_DIR, 'package.json'), 'utf-8')
    );
    expect(pkg.dependencies).toHaveProperty('gray-matter');
  });
});

describe('OC-S1-PKG-005: generate:opencode script', () => {
  it('should have generate:opencode script in root package.json', () => {
    const rootPkg = JSON.parse(
      fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8')
    );
    expect(rootPkg.scripts).toHaveProperty('generate:opencode');
    expect(rootPkg.scripts['generate:opencode']).toContain('generate-opencode');
  });
});

describe('OC-S1-PKG-006: dist/opencode/ output directory structure', () => {
  it('should have .opencode/commands/ensemble/ directory', () => {
    expect(
      fs.existsSync(path.join(DIST_DIR, '.opencode', 'commands', 'ensemble'))
    ).toBe(true);
  });

  it('should have .opencode/agents/ directory', () => {
    expect(
      fs.existsSync(path.join(DIST_DIR, '.opencode', 'agents'))
    ).toBe(true);
  });

  it('should have .opencode/skill/ directory', () => {
    expect(
      fs.existsSync(path.join(DIST_DIR, '.opencode', 'skill'))
    ).toBe(true);
  });

  it('should have a .gitkeep in each output directory', () => {
    expect(
      fs.existsSync(
        path.join(DIST_DIR, '.opencode', 'commands', 'ensemble', '.gitkeep')
      )
    ).toBe(true);
    expect(
      fs.existsSync(path.join(DIST_DIR, '.opencode', 'agents', '.gitkeep'))
    ).toBe(true);
    expect(
      fs.existsSync(path.join(DIST_DIR, '.opencode', 'skill', '.gitkeep'))
    ).toBe(true);
  });
});
