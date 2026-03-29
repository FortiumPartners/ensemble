/**
 * TRD-002-TEST: Pi install and manifest discovery
 *
 * Validates that the pi package has correct manifest structure:
 *   - package.json has a `pi` field pointing to ./extensions, ./skills,
 *     ./prompts, and ./agents
 *   - .claude-plugin/plugin.json exists with name "ensemble-pi"
 *   - Version is consistent between package.json and plugin.json
 *   - Required directories (skills/, prompts/, agents/) exist and are populated
 */

import * as fs from 'fs';
import * as path from 'path';

// Resolve package root relative to this test file (tests/ → ../)
const PI_ROOT = path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Load manifests once for all tests
// ---------------------------------------------------------------------------

let packageJson: Record<string, unknown>;
let pluginJson: Record<string, unknown>;

beforeAll(() => {
  const pkgPath = path.join(PI_ROOT, 'package.json');
  const pluginPath = path.join(PI_ROOT, '.claude-plugin', 'plugin.json');

  packageJson = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  pluginJson = JSON.parse(fs.readFileSync(pluginPath, 'utf-8'));
});

// ============================================================================
// package.json `pi` field
// ============================================================================

describe('package.json pi field', () => {
  test('package.json has a pi field', () => {
    expect(packageJson).toHaveProperty('pi');
    expect(typeof packageJson['pi']).toBe('object');
  });

  test('pi.extensions includes "./extensions"', () => {
    const pi = packageJson['pi'] as Record<string, unknown>;
    expect(Array.isArray(pi['extensions'])).toBe(true);
    expect(pi['extensions']).toContain('./extensions');
  });

  test('pi.skills includes "./skills"', () => {
    const pi = packageJson['pi'] as Record<string, unknown>;
    expect(Array.isArray(pi['skills'])).toBe(true);
    expect(pi['skills']).toContain('./skills');
  });

  test('pi.prompts includes "./prompts"', () => {
    const pi = packageJson['pi'] as Record<string, unknown>;
    expect(Array.isArray(pi['prompts'])).toBe(true);
    expect(pi['prompts']).toContain('./prompts');
  });

  test('pi.agents includes "./agents"', () => {
    const pi = packageJson['pi'] as Record<string, unknown>;
    expect(Array.isArray(pi['agents'])).toBe(true);
    expect(pi['agents']).toContain('./agents');
  });
});

// ============================================================================
// plugin.json
// ============================================================================

describe('plugin.json', () => {
  test('plugin.json exists and has correct name "ensemble-pi"', () => {
    expect(pluginJson).toHaveProperty('name', 'ensemble-pi');
  });

  test('version in package.json matches version in plugin.json', () => {
    const pkgVersion = packageJson['version'] as string;
    const pluginVersion = pluginJson['version'] as string;

    expect(typeof pkgVersion).toBe('string');
    expect(typeof pluginVersion).toBe('string');
    expect(pkgVersion).toBe(pluginVersion);
  });
});

// ============================================================================
// Directory existence and content
// ============================================================================

describe('skills/ directory', () => {
  test('skills/ directory exists', () => {
    const skillsDir = path.join(PI_ROOT, 'skills');
    expect(fs.existsSync(skillsDir)).toBe(true);
  });

  test('skills/ directory contains at least one subdirectory', () => {
    const skillsDir = path.join(PI_ROOT, 'skills');
    const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
    const subdirs = entries.filter((e) => e.isDirectory());
    expect(subdirs.length).toBeGreaterThan(0);
  });
});

describe('prompts/ directory', () => {
  test('prompts/ directory exists', () => {
    const promptsDir = path.join(PI_ROOT, 'prompts');
    expect(fs.existsSync(promptsDir)).toBe(true);
  });

  test('prompts/ directory contains at least one .md file', () => {
    const promptsDir = path.join(PI_ROOT, 'prompts');
    const entries = fs.readdirSync(promptsDir, { withFileTypes: true });
    const mdFiles = entries.filter((e) => e.isFile() && e.name.endsWith('.md'));
    expect(mdFiles.length).toBeGreaterThan(0);
  });
});

describe('agents/ directory', () => {
  test('agents/ directory exists', () => {
    const agentsDir = path.join(PI_ROOT, 'agents');
    expect(fs.existsSync(agentsDir)).toBe(true);
  });

  test('agents/ directory contains at least one .md file', () => {
    const agentsDir = path.join(PI_ROOT, 'agents');
    const entries = fs.readdirSync(agentsDir, { withFileTypes: true });
    const mdFiles = entries.filter((e) => e.isFile() && e.name.endsWith('.md'));
    expect(mdFiles.length).toBeGreaterThan(0);
  });
});
