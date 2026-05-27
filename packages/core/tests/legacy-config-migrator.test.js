'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

let stdoutSpy;
let stderrSpy;

beforeEach(() => {
  stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
  stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ensemble-migrator-test-'));
}

/**
 * Create a fake project dir with a .git directory so findProjectRoot works.
 * Optionally write an existing project config.
 */
function makeProjectDir(existingProjectConfig) {
  const tmpDir = makeTmpDir();
  fs.mkdirSync(path.join(tmpDir, '.git'), { recursive: true });
  if (existingProjectConfig !== undefined) {
    fs.mkdirSync(path.join(tmpDir, '.claude'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, '.claude', 'ensemble-model-config.json'),
      JSON.stringify(existingProjectConfig, null, 2),
      'utf8'
    );
  }
  return tmpDir;
}

/**
 * Create a legacy config file at a given path.
 */
function writeLegacyConfig(legacyPath, content) {
  fs.mkdirSync(path.dirname(legacyPath), { recursive: true });
  fs.writeFileSync(legacyPath, JSON.stringify(content, null, 2), 'utf8');
}

// ---------------------------------------------------------------------------
// findLegacyConfig
// ---------------------------------------------------------------------------

describe('findLegacyConfig', () => {
  it('returns null when no legacy files exist', () => {
    jest.resetModules();
    // Override XDG env to a nonexistent tmp dir
    const tmpDir = makeTmpDir();
    process.env.XDG_CONFIG_HOME = path.join(tmpDir, 'nonexistent-xdg');

    try {
      const { findLegacyConfig } = require('../lib/legacy-config-migrator');
      expect(findLegacyConfig()).toBeNull();
    } finally {
      delete process.env.XDG_CONFIG_HOME;
    }
  });

  it('returns the first existing legacy path', () => {
    jest.resetModules();
    const tmpDir = makeTmpDir();
    process.env.XDG_CONFIG_HOME = tmpDir;

    const legacyPath = path.join(tmpDir, 'ensemble', 'model-selection.json');
    writeLegacyConfig(legacyPath, { modelAliases: { opus: 'claude-opus-4-7' } });

    try {
      const { findLegacyConfig } = require('../lib/legacy-config-migrator');
      expect(findLegacyConfig()).toBe(legacyPath);
    } finally {
      delete process.env.XDG_CONFIG_HOME;
    }
  });
});

// ---------------------------------------------------------------------------
// migrateLegacyConfig
// ---------------------------------------------------------------------------

describe('migrateLegacyConfig', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('maps opus/sonnet/haiku to high/medium/low', () => {
    const { migrateLegacyConfig } = require('../lib/legacy-config-migrator');

    const tmpDir = makeTmpDir();
    const legacyPath = path.join(tmpDir, 'model-selection.json');
    writeLegacyConfig(legacyPath, {
      modelAliases: {
        opus: 'claude-opus-4-7',
        sonnet: 'claude-sonnet-4-6',
        haiku: 'claude-haiku-4-5-20251001',
      },
    });

    const projectDir = makeProjectDir();

    migrateLegacyConfig(legacyPath, projectDir);

    const written = JSON.parse(
      fs.readFileSync(path.join(projectDir, '.claude', 'ensemble-model-config.json'), 'utf8')
    );
    expect(written.tiers.high).toBe('claude-opus-4-7');
    expect(written.tiers.medium).toBe('claude-sonnet-4-6');
    expect(written.tiers.low).toBe('claude-haiku-4-5-20251001');
    expect(written.version).toBe(1);
  });

  it('does NOT delete the legacy file after migration', () => {
    const { migrateLegacyConfig } = require('../lib/legacy-config-migrator');

    const tmpDir = makeTmpDir();
    const legacyPath = path.join(tmpDir, 'model-selection.json');
    writeLegacyConfig(legacyPath, {
      modelAliases: {
        opus: 'claude-opus-4-7',
        sonnet: 'claude-sonnet-4-6',
        haiku: 'claude-haiku-4-5-20251001',
      },
    });

    const projectDir = makeProjectDir();
    migrateLegacyConfig(legacyPath, projectDir);

    expect(fs.existsSync(legacyPath)).toBe(true);
  });

  it('prints a stderr warning when commandOverrides is present', () => {
    const { migrateLegacyConfig } = require('../lib/legacy-config-migrator');

    const tmpDir = makeTmpDir();
    const legacyPath = path.join(tmpDir, 'model-selection.json');
    writeLegacyConfig(legacyPath, {
      modelAliases: { opus: 'claude-opus-4-7', sonnet: 'claude-sonnet-4-6', haiku: 'claude-haiku-4-5-20251001' },
      commandOverrides: {
        'create-prd': 'opus',
        'code-review': 'haiku',
      },
    });

    const projectDir = makeProjectDir();
    migrateLegacyConfig(legacyPath, projectDir);

    const errOutput = stderrSpy.mock.calls.map((c) => c[0]).join('');
    expect(errOutput).toContain('per-command model overrides are no longer supported');
    expect(errOutput).toContain('create-prd');
  });

  it('prints a stderr notice when costTracking.logPath is present', () => {
    const { migrateLegacyConfig } = require('../lib/legacy-config-migrator');

    const tmpDir = makeTmpDir();
    const legacyPath = path.join(tmpDir, 'model-selection.json');
    writeLegacyConfig(legacyPath, {
      modelAliases: { opus: 'claude-opus-4-7', sonnet: 'claude-sonnet-4-6', haiku: 'claude-haiku-4-5-20251001' },
      costTracking: { logPath: '/custom/path/usage.jsonl' },
    });

    const projectDir = makeProjectDir();
    migrateLegacyConfig(legacyPath, projectDir);

    const errOutput = stderrSpy.mock.calls.map((c) => c[0]).join('');
    expect(errOutput).toContain('/custom/path/usage.jsonl');
    expect(errOutput).toContain('was not migrated');
  });

  it('throws Error when project config exists and overwrite is false', () => {
    const { migrateLegacyConfig } = require('../lib/legacy-config-migrator');

    const tmpDir = makeTmpDir();
    const legacyPath = path.join(tmpDir, 'model-selection.json');
    writeLegacyConfig(legacyPath, {
      modelAliases: { opus: 'claude-opus-4-7', sonnet: 'claude-sonnet-4-6', haiku: 'claude-haiku-4-5-20251001' },
    });

    const existingConfig = {
      version: 1,
      tiers: { high: 'claude-opus-4-7', medium: 'claude-sonnet-4-6', low: 'claude-haiku-4-5-20251001' },
      extraKnownModelIds: [],
    };
    const projectDir = makeProjectDir(existingConfig);

    expect(() => migrateLegacyConfig(legacyPath, projectDir, { overwrite: false })).toThrow(
      /Project config already exists/
    );
  });

  it('overwrites existing project config when overwrite is true', () => {
    const { migrateLegacyConfig } = require('../lib/legacy-config-migrator');

    const tmpDir = makeTmpDir();
    const legacyPath = path.join(tmpDir, 'model-selection.json');
    writeLegacyConfig(legacyPath, {
      modelAliases: {
        opus: 'claude-opus-4-7',
        sonnet: 'claude-sonnet-4-6',
        haiku: 'claude-haiku-4-5-20251001',
      },
    });

    const existingConfig = {
      version: 1,
      tiers: { high: 'old-model', medium: 'old-model', low: 'old-model' },
      extraKnownModelIds: [],
    };
    const projectDir = makeProjectDir(existingConfig);

    migrateLegacyConfig(legacyPath, projectDir, { overwrite: true });

    const written = JSON.parse(
      fs.readFileSync(path.join(projectDir, '.claude', 'ensemble-model-config.json'), 'utf8')
    );
    expect(written.tiers.high).toBe('claude-opus-4-7');
    expect(written.tiers.medium).toBe('claude-sonnet-4-6');
  });

  it('throws SyntaxError when legacy file has invalid JSON', () => {
    const { migrateLegacyConfig } = require('../lib/legacy-config-migrator');

    const tmpDir = makeTmpDir();
    const legacyPath = path.join(tmpDir, 'model-selection.json');
    fs.mkdirSync(path.dirname(legacyPath), { recursive: true });
    fs.writeFileSync(legacyPath, 'not valid json!!!', 'utf8');

    const projectDir = makeProjectDir();

    expect(() => migrateLegacyConfig(legacyPath, projectDir)).toThrow(SyntaxError);
  });

  it('prints stdout confirmation after successful migration', () => {
    const { migrateLegacyConfig } = require('../lib/legacy-config-migrator');

    const tmpDir = makeTmpDir();
    const legacyPath = path.join(tmpDir, 'model-selection.json');
    writeLegacyConfig(legacyPath, {
      modelAliases: { opus: 'claude-opus-4-7', sonnet: 'claude-sonnet-4-6', haiku: 'claude-haiku-4-5-20251001' },
    });

    const projectDir = makeProjectDir();
    migrateLegacyConfig(legacyPath, projectDir);

    const output = stdoutSpy.mock.calls.map((c) => c[0]).join('');
    expect(output).toContain('Migrated legacy config to');
  });

  it('handles already-valid tier keys (high/medium/low) in legacy config', () => {
    const { migrateLegacyConfig } = require('../lib/legacy-config-migrator');

    const tmpDir = makeTmpDir();
    const legacyPath = path.join(tmpDir, 'model-selection.json');
    writeLegacyConfig(legacyPath, {
      tiers: {
        high: 'claude-opus-4-7',
        medium: 'claude-sonnet-4-6',
        low: 'claude-haiku-4-5-20251001',
      },
    });

    const projectDir = makeProjectDir();
    migrateLegacyConfig(legacyPath, projectDir);

    const written = JSON.parse(
      fs.readFileSync(path.join(projectDir, '.claude', 'ensemble-model-config.json'), 'utf8')
    );
    expect(written.tiers.high).toBe('claude-opus-4-7');
    expect(written.tiers.medium).toBe('claude-sonnet-4-6');
    expect(written.tiers.low).toBe('claude-haiku-4-5-20251001');
  });
});
