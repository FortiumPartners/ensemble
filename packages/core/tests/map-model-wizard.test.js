'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

// We'll spy on process.stdout.write for output assertions
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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ensemble-wizard-test-'));
}

function makeFakeProjectDir(tmpDir, configContent) {
  // Create a .git directory to make findProjectRoot happy
  fs.mkdirSync(path.join(tmpDir, '.git'), { recursive: true });
  if (configContent !== undefined) {
    fs.mkdirSync(path.join(tmpDir, '.claude'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, '.claude', 'ensemble-model-config.json'),
      JSON.stringify(configContent, null, 2),
      'utf8'
    );
  }
  return tmpDir;
}

// ---------------------------------------------------------------------------
// writeConfigAtomic
// ---------------------------------------------------------------------------

describe('writeConfigAtomic', () => {
  const { writeConfigAtomic } = require('../lib/map-model-wizard');

  it('creates directory if missing', () => {
    const tmpDir = makeTmpDir();
    const configPath = path.join(tmpDir, 'deep', 'nested', 'config.json');
    const config = { version: 1, tiers: { high: 'x', medium: 'y', low: 'z' }, extraKnownModelIds: [] };

    writeConfigAtomic(configPath, config);

    expect(fs.existsSync(configPath)).toBe(true);
  });

  it('writes valid JSON to the target file', () => {
    const tmpDir = makeTmpDir();
    const configPath = path.join(tmpDir, 'config.json');
    const config = { version: 1, tiers: { high: 'a', medium: 'b', low: 'c' }, extraKnownModelIds: [] };

    writeConfigAtomic(configPath, config);

    const content = fs.readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(content);
    expect(parsed).toEqual(config);
  });

  it('replaces an existing file atomically', () => {
    const tmpDir = makeTmpDir();
    const configPath = path.join(tmpDir, 'config.json');

    const original = { version: 1, tiers: { high: 'orig', medium: 'orig', low: 'orig' }, extraKnownModelIds: [] };
    fs.writeFileSync(configPath, JSON.stringify(original), 'utf8');

    const updated = { version: 1, tiers: { high: 'new', medium: 'new', low: 'new' }, extraKnownModelIds: [] };
    writeConfigAtomic(configPath, updated);

    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    expect(parsed.tiers.high).toBe('new');
    // Ensure no leftover .tmp file
    expect(fs.existsSync(configPath + '.tmp')).toBe(false);
  });

  it('ends the file content with a newline', () => {
    const tmpDir = makeTmpDir();
    const configPath = path.join(tmpDir, 'config.json');
    const config = { version: 1, tiers: { high: 'a', medium: 'b', low: 'c' }, extraKnownModelIds: [] };

    writeConfigAtomic(configPath, config);

    const raw = fs.readFileSync(configPath, 'utf8');
    expect(raw.endsWith('\n')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// runOneShotUpdate
// ---------------------------------------------------------------------------

describe('runOneShotUpdate', () => {
  // Each test gets a fresh require to avoid module caching issues with mocked fs
  let runOneShotUpdate;

  beforeEach(() => {
    jest.resetModules();
    runOneShotUpdate = require('../lib/map-model-wizard').runOneShotUpdate;
  });

  function setupProject(configContent) {
    const tmpDir = makeTmpDir();
    return makeFakeProjectDir(tmpDir, configContent);
  }

  it('throws TypeError for invalid tier', () => {
    const tmpDir = setupProject();
    expect(() => runOneShotUpdate('ultra', 'claude-opus-4-7', tmpDir)).toThrow(TypeError);
    expect(() => runOneShotUpdate('ultra', 'claude-opus-4-7', tmpDir)).toThrow(/Invalid tier/);
  });

  it('throws Error when model ID is not in allow-list', () => {
    const tmpDir = setupProject();
    expect(() => runOneShotUpdate('high', 'totally-fake-model-99', tmpDir)).toThrow(/not in the allow-list/);
  });

  it('updates the config file for a valid tier and known model ID', () => {
    const initial = {
      version: 1,
      tiers: { high: 'claude-opus-4-7', medium: 'claude-sonnet-4-6', low: 'claude-haiku-4-5-20251001' },
      extraKnownModelIds: [],
    };
    const tmpDir = setupProject(initial);

    runOneShotUpdate('medium', 'claude-opus-4-7', tmpDir);

    const written = JSON.parse(
      fs.readFileSync(path.join(tmpDir, '.claude', 'ensemble-model-config.json'), 'utf8')
    );
    expect(written.tiers.medium).toBe('claude-opus-4-7');
    // Other tiers should be unchanged
    expect(written.tiers.high).toBe('claude-opus-4-7');
    expect(written.tiers.low).toBe('claude-haiku-4-5-20251001');
  });

  it('accepts a model ID in extraKnownModelIds', () => {
    const initial = {
      version: 1,
      tiers: { high: 'claude-opus-4-7', medium: 'claude-sonnet-4-6', low: 'claude-haiku-4-5-20251001' },
      extraKnownModelIds: ['claude-custom-model-9'],
    };
    const tmpDir = setupProject(initial);

    // Should not throw
    runOneShotUpdate('low', 'claude-custom-model-9', tmpDir);

    const written = JSON.parse(
      fs.readFileSync(path.join(tmpDir, '.claude', 'ensemble-model-config.json'), 'utf8')
    );
    expect(written.tiers.low).toBe('claude-custom-model-9');
  });

  it('writes valid JSON after update', () => {
    const initial = {
      version: 1,
      tiers: { high: 'claude-opus-4-7', medium: 'claude-sonnet-4-6', low: 'claude-haiku-4-5-20251001' },
      extraKnownModelIds: [],
    };
    const tmpDir = setupProject(initial);

    runOneShotUpdate('low', 'claude-haiku-4-5-20251001', tmpDir);

    const raw = fs.readFileSync(path.join(tmpDir, '.claude', 'ensemble-model-config.json'), 'utf8');
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it('prints confirmation message', () => {
    const initial = {
      version: 1,
      tiers: { high: 'claude-opus-4-7', medium: 'claude-sonnet-4-6', low: 'claude-haiku-4-5-20251001' },
      extraKnownModelIds: [],
    };
    const tmpDir = setupProject(initial);

    runOneShotUpdate('high', 'claude-sonnet-4-6', tmpDir);

    const output = stdoutSpy.mock.calls.map((c) => c[0]).join('');
    expect(output).toContain('Updated high: claude-sonnet-4-6');
  });
});

// ---------------------------------------------------------------------------
// runWizard — TTY detection
// ---------------------------------------------------------------------------

describe('runWizard TTY detection', () => {
  let runWizard;

  beforeEach(() => {
    jest.resetModules();
    runWizard = require('../lib/map-model-wizard').runWizard;
  });

  it('throws Error when stdin is not a TTY', async () => {
    const originalIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });

    try {
      await expect(runWizard()).rejects.toThrow(/requires a TTY/);
    } finally {
      Object.defineProperty(process.stdin, 'isTTY', {
        value: originalIsTTY,
        configurable: true,
      });
    }
  });
});
