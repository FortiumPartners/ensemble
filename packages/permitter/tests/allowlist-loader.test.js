/**
 * Unit tests for allowlist-loader.js
 *
 * Tests PERM-P3-ALLOW-001 through PERM-P3-ALLOW-007:
 * - Settings file locator
 * - JSON parsing for each settings file
 * - Allowlist and denylist merging with precedence
 */

'use strict';

const path = require('path');
const os = require('os');
const fs = require('fs');

// Load the module once
const allowlistLoader = require('../lib/allowlist-loader');

describe('allowlist-loader', () => {
  // Store original functions
  const originalCwd = process.cwd;
  const originalHomedir = os.homedir;

  let mockFs;
  let mockCwd;
  let mockHome;

  beforeEach(() => {
    // Setup mock filesystem
    mockFs = {};
    mockCwd = '/test/project';
    mockHome = '/test/home';

    // Mock process.cwd
    process.cwd = jest.fn(() => mockCwd);

    // Mock os.homedir
    os.homedir = jest.fn(() => mockHome);

    // Mock fs.existsSync and fs.readFileSync
    jest.spyOn(fs, 'existsSync').mockImplementation((filePath) => {
      return mockFs.hasOwnProperty(filePath);
    });

    jest.spyOn(fs, 'readFileSync').mockImplementation((filePath, encoding) => {
      if (mockFs.hasOwnProperty(filePath)) {
        return mockFs[filePath];
      }
      throw new Error(`ENOENT: no such file or directory, open '${filePath}'`);
    });
  });

  afterEach(() => {
    // Restore original functions
    process.cwd = originalCwd;
    os.homedir = originalHomedir;
    jest.restoreAllMocks();
  });

  // ===========================================================================
  // PERM-P3-ALLOW-001: Settings file locator
  // ===========================================================================
  describe('getSettingsFiles()', () => {
    test('should return files in correct priority order', () => {
      const files = allowlistLoader.getSettingsFiles();

      expect(files).toHaveLength(3);
      expect(files[0]).toBe(path.join(mockCwd, '.claude', 'settings.local.json'));
      expect(files[1]).toBe(path.join(mockCwd, '.claude', 'settings.json'));
      expect(files[2]).toBe(path.join(mockHome, '.claude', 'settings.json'));
    });

    test('should use current working directory for project files', () => {
      mockCwd = '/different/project';

      const files = allowlistLoader.getSettingsFiles();

      expect(files[0]).toContain('/different/project');
      expect(files[1]).toContain('/different/project');
    });

    test('should use home directory for global file', () => {
      mockHome = '/different/home';

      const files = allowlistLoader.getSettingsFiles();

      expect(files[2]).toContain('/different/home');
    });
  });

  // ===========================================================================
  // PERM-P3-ALLOW-002: Parse .claude/settings.local.json
  // ===========================================================================
  describe('loadJsonFile() - settings.local.json', () => {
    test('should parse valid settings.local.json', () => {
      const settingsPath = path.join(mockCwd, '.claude', 'settings.local.json');
      mockFs[settingsPath] = JSON.stringify({
        permissions: {
          allow: ['Bash(npm test:*)'],
          deny: ['Bash(rm -rf:*)']
        }
      });

      const result = allowlistLoader.loadJsonFile(settingsPath);

      expect(result).toEqual({
        permissions: {
          allow: ['Bash(npm test:*)'],
          deny: ['Bash(rm -rf:*)']
        }
      });
    });

    test('should return null for non-existent settings.local.json', () => {
      const settingsPath = path.join(mockCwd, '.claude', 'settings.local.json');

      const result = allowlistLoader.loadJsonFile(settingsPath);

      expect(result).toBeNull();
    });
  });

  // ===========================================================================
  // PERM-P3-ALLOW-003: Parse .claude/settings.json
  // ===========================================================================
  describe('loadJsonFile() - settings.json', () => {
    test('should parse valid settings.json', () => {
      const settingsPath = path.join(mockCwd, '.claude', 'settings.json');
      mockFs[settingsPath] = JSON.stringify({
        permissions: {
          allow: ['Bash(git:*)']
        }
      });

      const result = allowlistLoader.loadJsonFile(settingsPath);

      expect(result).toEqual({
        permissions: {
          allow: ['Bash(git:*)']
        }
      });
    });
  });

  // ===========================================================================
  // PERM-P3-ALLOW-004: Parse ~/.claude/settings.json
  // ===========================================================================
  describe('loadJsonFile() - global settings.json', () => {
    test('should parse valid global settings.json', () => {
      const settingsPath = path.join(mockHome, '.claude', 'settings.json');
      mockFs[settingsPath] = JSON.stringify({
        permissions: {
          allow: ['Bash(ls:*)'],
          deny: ['Bash(sudo:*)']
        }
      });

      const result = allowlistLoader.loadJsonFile(settingsPath);

      expect(result).toEqual({
        permissions: {
          allow: ['Bash(ls:*)'],
          deny: ['Bash(sudo:*)']
        }
      });
    });
  });

  // ===========================================================================
  // Error handling for malformed JSON
  // ===========================================================================
  describe('loadJsonFile() - error handling', () => {
    test('should return null for malformed JSON', () => {
      const settingsPath = path.join(mockCwd, '.claude', 'settings.json');
      mockFs[settingsPath] = '{ invalid json }';

      const result = allowlistLoader.loadJsonFile(settingsPath);

      expect(result).toBeNull();
    });

    test('should return null for empty file', () => {
      const settingsPath = path.join(mockCwd, '.claude', 'settings.json');
      mockFs[settingsPath] = '';

      const result = allowlistLoader.loadJsonFile(settingsPath);

      expect(result).toBeNull();
    });
  });

  // ===========================================================================
  // PERM-P3-ALLOW-005: Merge allowlists with precedence (union)
  // ===========================================================================
  describe('loadAllowlist()', () => {
    test('should return empty array when no settings files exist', () => {
      const result = allowlistLoader.loadAllowlist();

      expect(result).toEqual([]);
    });

    test('should load allowlist from single file', () => {
      const settingsPath = path.join(mockCwd, '.claude', 'settings.json');
      mockFs[settingsPath] = JSON.stringify({
        permissions: {
          allow: ['Bash(npm test:*)', 'Bash(npm run:*)']
        }
      });

      const result = allowlistLoader.loadAllowlist();

      expect(result).toEqual(['Bash(npm test:*)', 'Bash(npm run:*)']);
    });

    test('should merge allowlists from multiple files (union)', () => {
      const localPath = path.join(mockCwd, '.claude', 'settings.local.json');
      const projectPath = path.join(mockCwd, '.claude', 'settings.json');
      const globalPath = path.join(mockHome, '.claude', 'settings.json');

      mockFs[localPath] = JSON.stringify({
        permissions: { allow: ['Bash(npm test:*)'] }
      });
      mockFs[projectPath] = JSON.stringify({
        permissions: { allow: ['Bash(git add:*)'] }
      });
      mockFs[globalPath] = JSON.stringify({
        permissions: { allow: ['Bash(ls:*)'] }
      });

      const result = allowlistLoader.loadAllowlist();

      expect(result).toContain('Bash(npm test:*)');
      expect(result).toContain('Bash(git add:*)');
      expect(result).toContain('Bash(ls:*)');
      expect(result).toHaveLength(3);
    });

    test('should handle files without permissions property', () => {
      const settingsPath = path.join(mockCwd, '.claude', 'settings.json');
      mockFs[settingsPath] = JSON.stringify({
        someOtherConfig: true
      });

      const result = allowlistLoader.loadAllowlist();

      expect(result).toEqual([]);
    });

    test('should handle files without allow property', () => {
      const settingsPath = path.join(mockCwd, '.claude', 'settings.json');
      mockFs[settingsPath] = JSON.stringify({
        permissions: {
          deny: ['Bash(rm:*)']
        }
      });

      const result = allowlistLoader.loadAllowlist();

      expect(result).toEqual([]);
    });

    test('should preserve duplicates from multiple files', () => {
      const localPath = path.join(mockCwd, '.claude', 'settings.local.json');
      const projectPath = path.join(mockCwd, '.claude', 'settings.json');

      mockFs[localPath] = JSON.stringify({
        permissions: { allow: ['Bash(npm test:*)'] }
      });
      mockFs[projectPath] = JSON.stringify({
        permissions: { allow: ['Bash(npm test:*)'] }  // Same pattern
      });

      const result = allowlistLoader.loadAllowlist();

      // Duplicates are preserved (union, not unique)
      expect(result).toEqual(['Bash(npm test:*)', 'Bash(npm test:*)']);
    });

    test('should skip malformed files and continue', () => {
      const localPath = path.join(mockCwd, '.claude', 'settings.local.json');
      const projectPath = path.join(mockCwd, '.claude', 'settings.json');

      mockFs[localPath] = '{ invalid json }';  // Malformed
      mockFs[projectPath] = JSON.stringify({
        permissions: { allow: ['Bash(npm test:*)'] }
      });

      const result = allowlistLoader.loadAllowlist();

      expect(result).toEqual(['Bash(npm test:*)']);
    });
  });

  // ===========================================================================
  // PERM-P3-ALLOW-006: Merge denylists with precedence (union)
  // ===========================================================================
  describe('loadDenylist()', () => {
    test('should return empty array when no settings files exist', () => {
      const result = allowlistLoader.loadDenylist();

      expect(result).toEqual([]);
    });

    test('should load denylist from single file', () => {
      const settingsPath = path.join(mockCwd, '.claude', 'settings.json');
      mockFs[settingsPath] = JSON.stringify({
        permissions: {
          deny: ['Bash(rm -rf:*)', 'Bash(sudo:*)']
        }
      });

      const result = allowlistLoader.loadDenylist();

      expect(result).toEqual(['Bash(rm -rf:*)', 'Bash(sudo:*)']);
    });

    test('should merge denylists from multiple files (union)', () => {
      const localPath = path.join(mockCwd, '.claude', 'settings.local.json');
      const projectPath = path.join(mockCwd, '.claude', 'settings.json');
      const globalPath = path.join(mockHome, '.claude', 'settings.json');

      mockFs[localPath] = JSON.stringify({
        permissions: { deny: ['Bash(rm -rf:*)'] }
      });
      mockFs[projectPath] = JSON.stringify({
        permissions: { deny: ['Bash(sudo:*)'] }
      });
      mockFs[globalPath] = JSON.stringify({
        permissions: { deny: ['Bash(dd:*)'] }
      });

      const result = allowlistLoader.loadDenylist();

      expect(result).toContain('Bash(rm -rf:*)');
      expect(result).toContain('Bash(sudo:*)');
      expect(result).toContain('Bash(dd:*)');
      expect(result).toHaveLength(3);
    });

    test('should handle files without deny property', () => {
      const settingsPath = path.join(mockCwd, '.claude', 'settings.json');
      mockFs[settingsPath] = JSON.stringify({
        permissions: {
          allow: ['Bash(npm test:*)']
        }
      });

      const result = allowlistLoader.loadDenylist();

      expect(result).toEqual([]);
    });

    test('should skip malformed files and continue', () => {
      const localPath = path.join(mockCwd, '.claude', 'settings.local.json');
      const projectPath = path.join(mockCwd, '.claude', 'settings.json');

      mockFs[localPath] = '{ invalid json }';  // Malformed
      mockFs[projectPath] = JSON.stringify({
        permissions: { deny: ['Bash(sudo:*)'] }
      });

      const result = allowlistLoader.loadDenylist();

      expect(result).toEqual(['Bash(sudo:*)']);
    });
  });

  // ===========================================================================
  // PERM-P3-ALLOW-007: Module exports
  // ===========================================================================
  describe('Module exports', () => {
    test('should export loadAllowlist function', () => {
      expect(typeof allowlistLoader.loadAllowlist).toBe('function');
    });

    test('should export loadDenylist function', () => {
      expect(typeof allowlistLoader.loadDenylist).toBe('function');
    });

    test('should export getSettingsFiles function', () => {
      expect(typeof allowlistLoader.getSettingsFiles).toBe('function');
    });

    test('should export loadJsonFile function', () => {
      expect(typeof allowlistLoader.loadJsonFile).toBe('function');
    });
  });

  // ===========================================================================
  // Edge cases and integration scenarios
  // ===========================================================================
  describe('Edge cases', () => {
    test('should handle null permissions value gracefully', () => {
      const settingsPath = path.join(mockCwd, '.claude', 'settings.json');
      mockFs[settingsPath] = JSON.stringify({
        permissions: null
      });

      const allowResult = allowlistLoader.loadAllowlist();
      const denyResult = allowlistLoader.loadDenylist();

      expect(allowResult).toEqual([]);
      expect(denyResult).toEqual([]);
    });

    test('should handle empty arrays in allow/deny', () => {
      const settingsPath = path.join(mockCwd, '.claude', 'settings.json');
      mockFs[settingsPath] = JSON.stringify({
        permissions: {
          allow: [],
          deny: []
        }
      });

      const allowResult = allowlistLoader.loadAllowlist();
      const denyResult = allowlistLoader.loadDenylist();

      expect(allowResult).toEqual([]);
      expect(denyResult).toEqual([]);
    });

    test('should handle non-array allow/deny values gracefully', () => {
      const settingsPath = path.join(mockCwd, '.claude', 'settings.json');
      mockFs[settingsPath] = JSON.stringify({
        permissions: {
          allow: 'Bash(npm test:*)',  // String instead of array
          deny: { pattern: 'Bash(rm:*)' }  // Object instead of array
        }
      });

      // Non-array values should be ignored (not cause errors)
      // This tests that the code doesn't crash on unexpected types
      expect(() => allowlistLoader.loadAllowlist()).not.toThrow();
      expect(() => allowlistLoader.loadDenylist()).not.toThrow();

      // Should return empty arrays since non-array values are skipped
      expect(allowlistLoader.loadAllowlist()).toEqual([]);
      expect(allowlistLoader.loadDenylist()).toEqual([]);
    });

    test('should work with realistic Claude Code settings format', () => {
      const settingsPath = path.join(mockCwd, '.claude', 'settings.local.json');
      mockFs[settingsPath] = JSON.stringify({
        "permissions": {
          "allow": [
            "Bash(npm test:*)",
            "Bash(npm run:*)",
            "Bash(git add:*)",
            "Bash(git commit:*)",
            "Bash(git push:*)",
            "Bash(pytest:*)"
          ],
          "deny": [
            "Bash(rm -rf:*)",
            "Bash(sudo:*)"
          ]
        }
      });

      const allowResult = allowlistLoader.loadAllowlist();
      const denyResult = allowlistLoader.loadDenylist();

      expect(allowResult).toHaveLength(6);
      expect(denyResult).toHaveLength(2);
      expect(allowResult).toContain('Bash(npm test:*)');
      expect(denyResult).toContain('Bash(sudo:*)');
    });
  });
});
