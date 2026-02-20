'use strict';

jest.mock('fs');
jest.mock('child_process');
jest.mock('os');

const fs = require('fs');
const { execSync } = require('child_process');
const os = require('os');

// Default os.platform to linux for all tests
os.platform.mockReturnValue('linux');

// Import after mocks are set up
const {
  detectOpenCode,
  CONFIDENCE_THRESHOLD,
  isBinaryInPath,
  directoryExists,
  fileExists,
  hasPackageDependency,
  computeConfidenceScore,
  PRIMARY_SIGNALS,
  SECONDARY_SIGNALS,
} = require('../lib/opencode-detector');

beforeEach(() => {
  jest.resetAllMocks();
  os.platform.mockReturnValue('linux');
  delete process.env.OPENCODE_API_KEY;

  // Default: all fs checks return false (nothing present)
  fs.existsSync.mockReturnValue(false);
  fs.statSync.mockReturnValue({ isDirectory: () => false, isFile: () => false });
  fs.readFileSync.mockImplementation(() => {
    throw new Error('file not found');
  });

  // Default: execSync throws (binary not found)
  execSync.mockImplementation(() => {
    throw new Error('not found');
  });
});

// ---------------------------------------------------------------------------
// CONFIDENCE_THRESHOLD
// ---------------------------------------------------------------------------
describe('CONFIDENCE_THRESHOLD', () => {
  test('equals 0.8', () => {
    expect(CONFIDENCE_THRESHOLD).toBe(0.8);
  });
});

// ---------------------------------------------------------------------------
// isBinaryInPath
// ---------------------------------------------------------------------------
describe('isBinaryInPath', () => {
  test('returns true when binary is found via which', () => {
    execSync.mockReturnValue('');
    expect(isBinaryInPath('opencode')).toBe(true);
  });

  test('returns false when binary is not found', () => {
    execSync.mockImplementation(() => { throw new Error('not found'); });
    expect(isBinaryInPath('opencode')).toBe(false);
  });

  test('uses "where" on Windows', () => {
    os.platform.mockReturnValue('win32');
    execSync.mockReturnValue('');
    isBinaryInPath('opencode');
    expect(execSync).toHaveBeenCalledWith('where opencode', { stdio: 'ignore' });
  });

  test('uses "which" on non-Windows', () => {
    os.platform.mockReturnValue('linux');
    execSync.mockReturnValue('');
    isBinaryInPath('opencode');
    expect(execSync).toHaveBeenCalledWith('which opencode', { stdio: 'ignore' });
  });
});

// ---------------------------------------------------------------------------
// directoryExists
// ---------------------------------------------------------------------------
describe('directoryExists', () => {
  test('returns true when path exists and is a directory', () => {
    fs.existsSync.mockReturnValue(true);
    fs.statSync.mockReturnValue({ isDirectory: () => true, isFile: () => false });
    expect(directoryExists('/some/path')).toBe(true);
  });

  test('returns false when path does not exist', () => {
    fs.existsSync.mockReturnValue(false);
    expect(directoryExists('/some/path')).toBe(false);
  });

  test('returns false when path exists but is a file', () => {
    fs.existsSync.mockReturnValue(true);
    fs.statSync.mockReturnValue({ isDirectory: () => false, isFile: () => true });
    expect(directoryExists('/some/path')).toBe(false);
  });

  test('returns false when statSync throws', () => {
    fs.existsSync.mockReturnValue(true);
    fs.statSync.mockImplementation(() => { throw new Error('permission denied'); });
    expect(directoryExists('/some/path')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// fileExists
// ---------------------------------------------------------------------------
describe('fileExists', () => {
  test('returns true when path exists and is a file', () => {
    fs.existsSync.mockReturnValue(true);
    fs.statSync.mockReturnValue({ isDirectory: () => false, isFile: () => true });
    expect(fileExists('/some/file.json')).toBe(true);
  });

  test('returns false when path does not exist', () => {
    fs.existsSync.mockReturnValue(false);
    expect(fileExists('/some/file.json')).toBe(false);
  });

  test('returns false when path exists but is a directory', () => {
    fs.existsSync.mockReturnValue(true);
    fs.statSync.mockReturnValue({ isDirectory: () => true, isFile: () => false });
    expect(fileExists('/some/file.json')).toBe(false);
  });

  test('returns false when statSync throws', () => {
    fs.existsSync.mockReturnValue(true);
    fs.statSync.mockImplementation(() => { throw new Error('permission denied'); });
    expect(fileExists('/some/file.json')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// hasPackageDependency
// ---------------------------------------------------------------------------
describe('hasPackageDependency', () => {
  test('returns true when name is in dependencies', () => {
    fs.readFileSync.mockReturnValue(JSON.stringify({ dependencies: { opencode: '^1.0.0' } }));
    expect(hasPackageDependency('opencode')).toBe(true);
  });

  test('returns true when name is in devDependencies', () => {
    fs.readFileSync.mockReturnValue(JSON.stringify({ devDependencies: { opencode: '^1.0.0' } }));
    expect(hasPackageDependency('opencode')).toBe(true);
  });

  test('returns false when name is absent from both dependency objects', () => {
    fs.readFileSync.mockReturnValue(JSON.stringify({ dependencies: {}, devDependencies: {} }));
    expect(hasPackageDependency('opencode')).toBe(false);
  });

  test('returns false when package.json cannot be read', () => {
    fs.readFileSync.mockImplementation(() => { throw new Error('no file'); });
    expect(hasPackageDependency('opencode')).toBe(false);
  });

  test('returns false when package.json is invalid JSON', () => {
    fs.readFileSync.mockReturnValue('not json {');
    expect(hasPackageDependency('opencode')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// computeConfidenceScore
// ---------------------------------------------------------------------------
describe('computeConfidenceScore', () => {
  test('returns 0 when no signals fire', () => {
    const primary = [{ check: () => false, weight: 0.5 }];
    const secondary = [{ check: () => false, weight: 0.3 }];
    expect(computeConfidenceScore(primary, secondary)).toBe(0);
  });

  test('sums weights from primary signals', () => {
    const primary = [
      { check: () => true, weight: 0.5 },
      { check: () => true, weight: 0.4 },
    ];
    const secondary = [];
    expect(computeConfidenceScore(primary, secondary)).toBeCloseTo(0.9);
  });

  test('sums weights from both primary and secondary signals', () => {
    const primary = [{ check: () => true, weight: 0.5 }];
    const secondary = [{ check: () => true, weight: 0.3 }];
    expect(computeConfidenceScore(primary, secondary)).toBeCloseTo(0.8);
  });

  test('caps result at 1.0', () => {
    const primary = [
      { check: () => true, weight: 0.5 },
      { check: () => true, weight: 0.5 },
      { check: () => true, weight: 0.4 },
    ];
    const secondary = [];
    expect(computeConfidenceScore(primary, secondary)).toBe(1.0);
  });
});

// ---------------------------------------------------------------------------
// detectOpenCode — individual signal weights
// ---------------------------------------------------------------------------
describe('detectOpenCode — individual signals', () => {
  test('binary present → confidence 0.5, detected false', () => {
    execSync.mockReturnValue(''); // which opencode succeeds
    const result = detectOpenCode();
    expect(result.confidence).toBeCloseTo(0.5);
    expect(result.detected).toBe(false);
    expect(result.signals).toContain('opencode binary in PATH');
  });

  test('binary absent → no weight contributed', () => {
    execSync.mockImplementation(() => { throw new Error('not found'); });
    const result = detectOpenCode();
    expect(result.signals).not.toContain('opencode binary in PATH');
  });

  test('.opencode/ directory present → confidence 0.5, detected false', () => {
    fs.existsSync.mockImplementation((p) => p.endsWith('.opencode'));
    fs.statSync.mockImplementation((p) => ({
      isDirectory: () => p.endsWith('.opencode'),
      isFile: () => false,
    }));
    const result = detectOpenCode();
    expect(result.confidence).toBeCloseTo(0.5);
    expect(result.detected).toBe(false);
    expect(result.signals).toContain('.opencode/ directory present');
  });

  test('opencode.json present → confidence 0.4, detected false', () => {
    fs.existsSync.mockImplementation((p) => p.endsWith('opencode.json'));
    fs.statSync.mockImplementation((p) => ({
      isDirectory: () => false,
      isFile: () => p.endsWith('opencode.json'),
    }));
    const result = detectOpenCode();
    expect(result.confidence).toBeCloseTo(0.4);
    expect(result.detected).toBe(false);
    expect(result.signals).toContain('opencode config file present (opencode.json or opencode.toml)');
  });

  test('opencode.toml present → confidence 0.4, detected false', () => {
    fs.existsSync.mockImplementation((p) => p.endsWith('opencode.toml'));
    fs.statSync.mockImplementation((p) => ({
      isDirectory: () => false,
      isFile: () => p.endsWith('opencode.toml'),
    }));
    const result = detectOpenCode();
    expect(result.confidence).toBeCloseTo(0.4);
    expect(result.detected).toBe(false);
  });

  test('OPENCODE_API_KEY env var present → confidence 0.3, detected false', () => {
    process.env.OPENCODE_API_KEY = 'sk-test-key';
    const result = detectOpenCode();
    expect(result.confidence).toBeCloseTo(0.3);
    expect(result.detected).toBe(false);
    expect(result.signals).toContain('OPENCODE_API_KEY environment variable set');
  });

  test('opencode in package.json devDependencies → confidence 0.2, detected false', () => {
    fs.readFileSync.mockReturnValue(JSON.stringify({ devDependencies: { opencode: '^1.0.0' } }));
    const result = detectOpenCode();
    expect(result.confidence).toBeCloseTo(0.2);
    expect(result.detected).toBe(false);
    expect(result.signals).toContain('opencode in package.json dependencies');
  });
});

// ---------------------------------------------------------------------------
// detectOpenCode — combined signals (threshold logic)
// ---------------------------------------------------------------------------
describe('detectOpenCode — combined signals', () => {
  test('binary + .opencode/ directory → confidence 1.0 (capped), detected true', () => {
    execSync.mockReturnValue('');
    fs.existsSync.mockImplementation((p) => p.endsWith('.opencode'));
    fs.statSync.mockImplementation((p) => ({
      isDirectory: () => p.endsWith('.opencode'),
      isFile: () => false,
    }));
    const result = detectOpenCode();
    expect(result.confidence).toBe(1.0);
    expect(result.detected).toBe(true);
  });

  test('binary + config file → confidence 0.9, detected true', () => {
    execSync.mockReturnValue('');
    fs.existsSync.mockImplementation((p) => p.endsWith('opencode.json'));
    fs.statSync.mockImplementation((p) => ({
      isDirectory: () => false,
      isFile: () => p.endsWith('opencode.json'),
    }));
    const result = detectOpenCode();
    expect(result.confidence).toBeCloseTo(0.9);
    expect(result.detected).toBe(true);
  });

  test('both secondary signals only → confidence 0.5, detected false', () => {
    process.env.OPENCODE_API_KEY = 'sk-test-key';
    fs.readFileSync.mockReturnValue(JSON.stringify({ devDependencies: { opencode: '^1.0.0' } }));
    const result = detectOpenCode();
    expect(result.confidence).toBeCloseTo(0.5);
    expect(result.detected).toBe(false);
  });

  test('no signals → confidence 0, detected false', () => {
    const result = detectOpenCode();
    expect(result.confidence).toBe(0);
    expect(result.detected).toBe(false);
    expect(result.signals).toHaveLength(0);
  });

  test('single weak signal (env var only) → detected false', () => {
    process.env.OPENCODE_API_KEY = 'sk-test-key';
    const result = detectOpenCode();
    expect(result.detected).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// detectOpenCode — return shape
// ---------------------------------------------------------------------------
describe('detectOpenCode — return shape', () => {
  test('always returns an object with detected, confidence, and signals keys', () => {
    const result = detectOpenCode();
    expect(result).toHaveProperty('detected');
    expect(result).toHaveProperty('confidence');
    expect(result).toHaveProperty('signals');
    expect(typeof result.detected).toBe('boolean');
    expect(typeof result.confidence).toBe('number');
    expect(Array.isArray(result.signals)).toBe(true);
  });
});
