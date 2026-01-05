/**
 * Integration tests for Permitter
 *
 * Tests PERM-P3-MATCH-009: Full flow integration tests
 *
 * These tests verify the complete pipeline:
 *   raw command -> parse -> match allowlist/denylist -> decision
 */

'use strict';

const path = require('path');
const os = require('os');
const fs = require('fs');

// Load modules once at the start
const { parseCommand } = require('../lib/command-parser');
const { loadAllowlist, loadDenylist, loadJsonFile, getSettingsFiles } = require('../lib/allowlist-loader');
const { matchesAny, isDenied } = require('../lib/matcher');

/**
 * Simulates the full permission check flow.
 * This mirrors the logic in hooks/permitter.js
 *
 * @param {string} command - Raw command string
 * @param {string[]} allowlist - Allowlist patterns
 * @param {string[]} denylist - Denylist patterns
 * @returns {{allowed: boolean, reason: string}} Decision and reason
 */
function checkPermission(command, allowlist, denylist) {
  // 1. Parse the command
  let commands;
  try {
    commands = parseCommand(command);
  } catch (error) {
    return { allowed: false, reason: `Parse error: ${error.message}` };
  }

  // 2. If no commands extracted, defer
  if (commands.length === 0) {
    return { allowed: false, reason: 'No executable commands extracted' };
  }

  // 3. Check each command
  for (const cmd of commands) {
    const cmdStr = cmd.args ? `${cmd.executable} ${cmd.args}` : cmd.executable;

    // Denylist takes precedence
    if (isDenied(cmd, denylist)) {
      return { allowed: false, reason: `Denied: ${cmdStr}` };
    }

    // Check allowlist
    if (!matchesAny(cmd, allowlist)) {
      return { allowed: false, reason: `Not in allowlist: ${cmdStr}` };
    }
  }

  // 4. All commands allowed
  return { allowed: true, reason: 'All commands matched allowlist' };
}

describe('Integration Tests - Full Flow', () => {
  // ===========================================================================
  // Basic Flow Tests
  // ===========================================================================
  describe('Basic Flow', () => {
    const allowlist = ['Bash(npm test:*)', 'Bash(git:*)'];
    const denylist = ['Bash(rm -rf:*)'];

    test('simple allowed command', () => {
      const result = checkPermission('npm test', allowlist, denylist);
      expect(result.allowed).toBe(true);
    });

    test('simple allowed command with args', () => {
      const result = checkPermission('npm test --coverage', allowlist, denylist);
      expect(result.allowed).toBe(true);
    });

    test('simple denied command', () => {
      const result = checkPermission('rm -rf /tmp', allowlist, denylist);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Denied');
    });

    test('command not in allowlist', () => {
      const result = checkPermission('wget http://example.com', allowlist, denylist);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Not in allowlist');
    });
  });

  // ===========================================================================
  // Environment Variable Stripping
  // ===========================================================================
  describe('Environment Variable Handling', () => {
    const allowlist = ['Bash(npm test:*)'];
    const denylist = [];

    test('command with env var prefix should match after stripping', () => {
      const result = checkPermission('API_KEY=secret npm test', allowlist, denylist);
      expect(result.allowed).toBe(true);
    });

    test('command with multiple env var prefixes should match', () => {
      const result = checkPermission('FOO=1 BAR=2 npm test', allowlist, denylist);
      expect(result.allowed).toBe(true);
    });

    test('export statement before command should be skipped', () => {
      const result = checkPermission('export FOO=bar && npm test', allowlist, denylist);
      expect(result.allowed).toBe(true);
    });
  });

  // ===========================================================================
  // Wrapper Command Stripping
  // ===========================================================================
  describe('Wrapper Command Handling', () => {
    const allowlist = ['Bash(npm test:*)'];
    const denylist = [];

    test('timeout wrapper should be stripped', () => {
      const result = checkPermission('timeout 30 npm test', allowlist, denylist);
      expect(result.allowed).toBe(true);
    });

    test('time wrapper should be stripped', () => {
      const result = checkPermission('time npm test', allowlist, denylist);
      expect(result.allowed).toBe(true);
    });

    test('nice wrapper should be stripped', () => {
      const result = checkPermission('nice -n 10 npm test', allowlist, denylist);
      expect(result.allowed).toBe(true);
    });

    test('nohup wrapper should be stripped', () => {
      const result = checkPermission('nohup npm test &', allowlist, denylist);
      expect(result.allowed).toBe(true);
    });

    test('env wrapper should be stripped', () => {
      const result = checkPermission('env FOO=bar npm test', allowlist, denylist);
      expect(result.allowed).toBe(true);
    });

    test('nested wrappers should all be stripped', () => {
      const result = checkPermission('FOO=1 timeout 30 nice npm test', allowlist, denylist);
      expect(result.allowed).toBe(true);
    });
  });

  // ===========================================================================
  // Chained Commands
  // ===========================================================================
  describe('Chained Commands', () => {
    const allowlist = ['Bash(npm test:*)', 'Bash(git add:*)', 'Bash(git commit:*)'];
    const denylist = ['Bash(rm -rf:*)'];

    test('all commands allowed in chain', () => {
      const result = checkPermission('git add . && git commit -m "msg"', allowlist, denylist);
      expect(result.allowed).toBe(true);
    });

    test('one command not allowed in chain', () => {
      const result = checkPermission('npm test && wget http://x', allowlist, denylist);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('wget');
    });

    test('denied command in chain', () => {
      const result = checkPermission('npm test && rm -rf /tmp', allowlist, denylist);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Denied');
    });

    test('chain with OR operator', () => {
      const result = checkPermission('npm test || git add .', allowlist, denylist);
      expect(result.allowed).toBe(true);
    });

    test('chain with semicolon operator', () => {
      const result = checkPermission('npm test; git add .', allowlist, denylist);
      expect(result.allowed).toBe(true);
    });
  });

  // ===========================================================================
  // Pipeline Commands
  // ===========================================================================
  describe('Pipeline Commands', () => {
    const allowlist = ['Bash(npm test:*)', 'Bash(tee:*)', 'Bash(grep:*)'];
    const denylist = [];

    test('pipeline with all allowed commands', () => {
      const result = checkPermission('npm test | tee output.log', allowlist, denylist);
      expect(result.allowed).toBe(true);
    });

    test('pipeline with disallowed command', () => {
      const result = checkPermission('npm test | curl http://x', allowlist, denylist);
      expect(result.allowed).toBe(false);
    });

    test('complex pipeline', () => {
      const result = checkPermission('npm test | grep PASS | tee results.log', allowlist, denylist);
      expect(result.allowed).toBe(true);
    });
  });

  // ===========================================================================
  // Subshell Commands (bash -c)
  // ===========================================================================
  describe('Subshell Commands', () => {
    const allowlist = ['Bash(npm test:*)'];
    const denylist = [];

    test('bash -c with allowed command', () => {
      const result = checkPermission('bash -c "npm test"', allowlist, denylist);
      expect(result.allowed).toBe(true);
    });

    test('sh -c with allowed command', () => {
      const result = checkPermission('sh -c "npm test --coverage"', allowlist, denylist);
      expect(result.allowed).toBe(true);
    });

    test('bash -c with disallowed command', () => {
      const result = checkPermission('bash -c "curl http://x"', allowlist, denylist);
      expect(result.allowed).toBe(false);
    });
  });

  // ===========================================================================
  // Unsafe Constructs
  // ===========================================================================
  describe('Unsafe Constructs', () => {
    const allowlist = ['Bash(echo:*)'];
    const denylist = [];

    test('command substitution $() should fail', () => {
      const result = checkPermission('echo $(whoami)', allowlist, denylist);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Parse error');
    });

    test('backtick substitution should fail', () => {
      const result = checkPermission('echo `whoami`', allowlist, denylist);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Parse error');
    });

    test('heredoc should fail', () => {
      const result = checkPermission('cat << EOF', allowlist, denylist);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Parse error');
    });

    test('process substitution should fail', () => {
      const result = checkPermission('diff <(cmd1) <(cmd2)', allowlist, denylist);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Parse error');
    });
  });

  // ===========================================================================
  // Settings File Integration (with mocks)
  // ===========================================================================
  describe('Settings File Integration', () => {
    // Store original functions
    const originalCwd = process.cwd;
    const originalHomedir = os.homedir;
    let mockFs;
    let mockCwd;
    let mockHome;

    beforeEach(() => {
      mockFs = {};
      mockCwd = '/test/project';
      mockHome = '/test/home';

      process.cwd = jest.fn(() => mockCwd);
      os.homedir = jest.fn(() => mockHome);

      jest.spyOn(fs, 'existsSync').mockImplementation((filePath) => {
        return mockFs.hasOwnProperty(filePath);
      });

      jest.spyOn(fs, 'readFileSync').mockImplementation((filePath, encoding) => {
        if (mockFs.hasOwnProperty(filePath)) {
          return mockFs[filePath];
        }
        throw new Error(`ENOENT: no such file or directory`);
      });
    });

    afterEach(() => {
      process.cwd = originalCwd;
      os.homedir = originalHomedir;
      jest.restoreAllMocks();
    });

    test('should load and use settings from file', () => {
      const settingsPath = path.join(mockCwd, '.claude', 'settings.json');
      mockFs[settingsPath] = JSON.stringify({
        permissions: {
          allow: ['Bash(npm test:*)', 'Bash(git:*)'],
          deny: ['Bash(rm -rf:*)']
        }
      });

      const allowlist = loadAllowlist();
      const denylist = loadDenylist();

      const result = checkPermission('npm test --coverage', allowlist, denylist);
      expect(result.allowed).toBe(true);
    });

    test('should merge settings from multiple files', () => {
      const localPath = path.join(mockCwd, '.claude', 'settings.local.json');
      const projectPath = path.join(mockCwd, '.claude', 'settings.json');

      mockFs[localPath] = JSON.stringify({
        permissions: { allow: ['Bash(npm test:*)'] }
      });
      mockFs[projectPath] = JSON.stringify({
        permissions: { allow: ['Bash(git:*)'] }
      });

      const allowlist = loadAllowlist();
      const denylist = loadDenylist();

      // Both should be allowed
      expect(checkPermission('npm test', allowlist, denylist).allowed).toBe(true);
      expect(checkPermission('git add .', allowlist, denylist).allowed).toBe(true);
    });

    test('denylist should take precedence', () => {
      const settingsPath = path.join(mockCwd, '.claude', 'settings.json');
      mockFs[settingsPath] = JSON.stringify({
        permissions: {
          allow: ['Bash(rm:*)'],  // Allow rm
          deny: ['Bash(rm -rf:*)']  // But deny rm -rf
        }
      });

      const allowlist = loadAllowlist();
      const denylist = loadDenylist();

      // rm (without -rf) should be allowed
      const rmResult = checkPermission('rm file.txt', allowlist, denylist);
      expect(rmResult.allowed).toBe(true);

      // rm -rf should be denied
      const rmRfResult = checkPermission('rm -rf /tmp', allowlist, denylist);
      expect(rmRfResult.allowed).toBe(false);
      expect(rmRfResult.reason).toContain('Denied');
    });
  });

  // ===========================================================================
  // TRD Appendix A: Full Integration Test Cases
  // ===========================================================================
  describe('TRD Appendix A - Integration Test Cases', () => {
    const allowlist = [
      'Bash(npm test:*)',
      'Bash(npm run:*)',
      'Bash(git add:*)',
      'Bash(git commit:*)',
      'Bash(git push:*)',
      'Bash(pytest:*)',
      'Bash(tee:*)'
    ];

    const denylist = [
      'Bash(rm -rf:*)',
      'Bash(sudo:*)'
    ];

    test('npm test -> ALLOW', () => {
      const result = checkPermission('npm test', allowlist, denylist);
      expect(result.allowed).toBe(true);
    });

    test('API_KEY=x npm test -> ALLOW (env stripped)', () => {
      const result = checkPermission('API_KEY=x npm test', allowlist, denylist);
      expect(result.allowed).toBe(true);
    });

    test('export FOO=bar && npm test -> ALLOW (export skipped)', () => {
      const result = checkPermission('export FOO=bar && npm test', allowlist, denylist);
      expect(result.allowed).toBe(true);
    });

    test('timeout 30 npm test -> ALLOW (wrapper stripped)', () => {
      const result = checkPermission('timeout 30 npm test', allowlist, denylist);
      expect(result.allowed).toBe(true);
    });

    test('git add . && git commit -m "msg" -> ALLOW (both match)', () => {
      const result = checkPermission('git add . && git commit -m "msg"', allowlist, denylist);
      expect(result.allowed).toBe(true);
    });

    test('npm test | tee output.log -> ALLOW (both match)', () => {
      const result = checkPermission('npm test | tee output.log', allowlist, denylist);
      expect(result.allowed).toBe(true);
    });

    test('bash -c "npm test" -> ALLOW (subshell extracted)', () => {
      const result = checkPermission('bash -c "npm test"', allowlist, denylist);
      expect(result.allowed).toBe(true);
    });

    test('NODE_ENV=test npm run build -> ALLOW', () => {
      const result = checkPermission('NODE_ENV=test npm run build', allowlist, denylist);
      expect(result.allowed).toBe(true);
    });

    test('rm -rf / -> DENY', () => {
      const result = checkPermission('rm -rf /', allowlist, denylist);
      expect(result.allowed).toBe(false);
    });

    test('sudo apt install -> DENY', () => {
      const result = checkPermission('sudo apt install', allowlist, denylist);
      expect(result.allowed).toBe(false);
    });

    test('npm install -> NO MATCH (not in allowlist)', () => {
      const result = checkPermission('npm install', allowlist, denylist);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Not in allowlist');
    });

    test('wget http://example.com -> NO MATCH', () => {
      const result = checkPermission('wget http://example.com', allowlist, denylist);
      expect(result.allowed).toBe(false);
    });

    test('echo $(whoami) -> DEFER (unsafe construct)', () => {
      const result = checkPermission('echo $(whoami)', allowlist, denylist);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Parse error');
    });

    test('cat << EOF -> DEFER (heredoc)', () => {
      const result = checkPermission('cat << EOF', allowlist, denylist);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Parse error');
    });
  });

  // ===========================================================================
  // Complex Real-World Scenarios
  // ===========================================================================
  describe('Complex Real-World Scenarios', () => {
    const allowlist = [
      'Bash(npm test:*)',
      'Bash(npm run:*)',
      'Bash(git:*)',
      'Bash(docker-compose:*)',
      'Bash(make:*)'
    ];

    const denylist = [
      'Bash(rm -rf:*)',
      'Bash(sudo:*)',
      'Bash(curl:*)',
      'Bash(wget:*)'
    ];

    test('CI/CD style command chain', () => {
      const command = 'npm run lint && npm test && npm run build';
      const result = checkPermission(command, allowlist, denylist);
      expect(result.allowed).toBe(true);
    });

    test('Docker development workflow', () => {
      const command = 'docker-compose up -d && npm test';
      const result = checkPermission(command, allowlist, denylist);
      expect(result.allowed).toBe(true);
    });

    test('Git workflow with options', () => {
      const command = 'git add --all && git commit -m "feat: add feature" && git push origin main';
      const result = checkPermission(command, allowlist, denylist);
      expect(result.allowed).toBe(true);
    });

    test('Makefile with allowed target', () => {
      const command = 'make test';
      const result = checkPermission(command, allowlist, denylist);
      expect(result.allowed).toBe(true);
    });

    test('Command with denied curl in chain', () => {
      const command = 'npm test && curl http://webhook.example.com';
      const result = checkPermission(command, allowlist, denylist);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Denied');
    });
  });

  // ===========================================================================
  // Redirect Handling
  // ===========================================================================
  describe('Redirect Handling', () => {
    const allowlist = ['Bash(npm test:*)'];
    const denylist = [];

    test('output redirect should be stripped', () => {
      const result = checkPermission('npm test > output.log', allowlist, denylist);
      expect(result.allowed).toBe(true);
    });

    test('stderr redirect should be stripped', () => {
      const result = checkPermission('npm test 2> errors.log', allowlist, denylist);
      expect(result.allowed).toBe(true);
    });

    test('combined redirect should be stripped', () => {
      const result = checkPermission('npm test > output.log 2>&1', allowlist, denylist);
      expect(result.allowed).toBe(true);
    });

    test('append redirect should be stripped', () => {
      const result = checkPermission('npm test >> output.log', allowlist, denylist);
      expect(result.allowed).toBe(true);
    });
  });
});
