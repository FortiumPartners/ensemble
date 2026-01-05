/**
 * Test for docker-compose command handling
 *
 * Tests the specific command:
 * cd /home/james/dev/sgl/vfm-workspace/vfm-app-modernized && docker-compose exec -T mysql mysql -u root -p1 vfm_app -e "DESCRIBE vfm_activity;" 2>/dev/null | head -50
 *
 * This command has:
 * - cd command (chained with &&)
 * - docker-compose with subcommand and many args
 * - Output redirection (2>/dev/null)
 * - Pipeline to head
 */

'use strict';

const { parseCommand, tokenize, splitByOperators, normalizeSegment } = require('../lib/command-parser');
const { matchesPattern, matchesAny, isDenied } = require('../lib/matcher');

// The actual command to test
const DOCKER_COMPOSE_COMMAND = 'cd /home/james/dev/sgl/vfm-workspace/vfm-app-modernized && docker-compose exec -T mysql mysql -u root -p1 vfm_app -e "DESCRIBE vfm_activity;" 2>/dev/null | head -50';

// ===========================================================================
// Part 1: Unit Tests for Command Parser
// ===========================================================================
describe('Docker-Compose Command: Parser Tests', () => {
  describe('tokenize()', () => {
    test('should tokenize the full command correctly', () => {
      const tokens = tokenize(DOCKER_COMPOSE_COMMAND);

      // Verify key tokens are present
      expect(tokens).toContain('cd');
      expect(tokens).toContain('&&');
      expect(tokens).toContain('docker-compose');
      expect(tokens).toContain('exec');
      expect(tokens).toContain('-T');
      expect(tokens).toContain('mysql');
      expect(tokens).toContain('-u');
      expect(tokens).toContain('root');
      expect(tokens).toContain('-p1');
      expect(tokens).toContain('vfm_app');
      expect(tokens).toContain('-e');
      expect(tokens).toContain('DESCRIBE vfm_activity;'); // Quoted content
      // Note: 2>/dev/null gets tokenized as separate parts: '2', '>', '/dev/null'
      // The normalizeSegment function handles stripping redirections
      expect(tokens).toContain('>');
      expect(tokens).toContain('|');
      expect(tokens).toContain('head');
      expect(tokens).toContain('-50');
    });

    test('should tokenize cd part correctly', () => {
      const tokens = tokenize('cd /home/james/dev/sgl/vfm-workspace/vfm-app-modernized');
      expect(tokens).toEqual(['cd', '/home/james/dev/sgl/vfm-workspace/vfm-app-modernized']);
    });

    test('should tokenize docker-compose exec part correctly', () => {
      const tokens = tokenize('docker-compose exec -T mysql mysql -u root -p1 vfm_app -e "DESCRIBE vfm_activity;"');
      expect(tokens).toEqual([
        'docker-compose', 'exec', '-T', 'mysql', 'mysql',
        '-u', 'root', '-p1', 'vfm_app', '-e', 'DESCRIBE vfm_activity;'
      ]);
    });

    test('should preserve quoted SQL statement', () => {
      const tokens = tokenize('mysql -e "DESCRIBE vfm_activity;"');
      expect(tokens).toContain('DESCRIBE vfm_activity;');
    });
  });

  describe('splitByOperators()', () => {
    test('should split command into segments by && and |', () => {
      const tokens = tokenize(DOCKER_COMPOSE_COMMAND);
      const segments = splitByOperators(tokens);

      // Should have 3 segments: cd, docker-compose, head
      expect(segments.length).toBe(3);

      // First segment is cd
      expect(segments[0][0]).toBe('cd');

      // Second segment starts with docker-compose
      expect(segments[1][0]).toBe('docker-compose');

      // Third segment is head
      expect(segments[2][0]).toBe('head');
    });
  });

  describe('normalizeSegment()', () => {
    test('should normalize cd segment', () => {
      const tokens = ['cd', '/home/james/dev/sgl/vfm-workspace/vfm-app-modernized'];
      const result = normalizeSegment(tokens);
      expect(result).toEqual({
        executable: 'cd',
        args: '/home/james/dev/sgl/vfm-workspace/vfm-app-modernized'
      });
    });

    test('should normalize docker-compose segment (strip redirect)', () => {
      const tokens = [
        'docker-compose', 'exec', '-T', 'mysql', 'mysql',
        '-u', 'root', '-p1', 'vfm_app', '-e', 'DESCRIBE vfm_activity;',
        '2>/dev/null'
      ];
      const result = normalizeSegment(tokens);
      expect(result).toEqual({
        executable: 'docker-compose',
        args: 'exec -T mysql mysql -u root -p1 vfm_app -e DESCRIBE vfm_activity;'
      });
    });

    test('should normalize head segment', () => {
      const tokens = ['head', '-50'];
      const result = normalizeSegment(tokens);
      expect(result).toEqual({
        executable: 'head',
        args: '-50'
      });
    });
  });

  describe('parseCommand()', () => {
    test('should parse full command into component commands', () => {
      const commands = parseCommand(DOCKER_COMPOSE_COMMAND);

      // Should extract 3 commands: cd, docker-compose, head
      expect(commands.length).toBe(3);

      // Verify each command
      expect(commands[0]).toMatchObject({
        executable: 'cd'
      });
      expect(commands[0].args).toContain('vfm-app-modernized');

      expect(commands[1]).toMatchObject({
        executable: 'docker-compose'
      });
      expect(commands[1].args).toContain('exec');
      expect(commands[1].args).toContain('DESCRIBE vfm_activity');

      expect(commands[2]).toMatchObject({
        executable: 'head',
        args: '-50'
      });
    });
  });
});

// ===========================================================================
// Part 2: Matcher Tests with Allowlist
// ===========================================================================
describe('Docker-Compose Command: Matcher Tests', () => {
  // Test allowlist that includes docker-compose and common patterns
  const allowlist = [
    'Bash(cd:*)',
    'Bash(docker-compose:*)',
    'Bash(head:*)',
    'Bash(npm test:*)',
    'Bash(git:*)'
  ];

  const denylist = [
    'Bash(rm -rf:*)',
    'Bash(sudo:*)'
  ];

  describe('matchesPattern() - docker-compose patterns', () => {
    test('docker-compose matches Bash(docker-compose:*)', () => {
      expect(matchesPattern('docker-compose', 'Bash(docker-compose:*)')).toBe(true);
    });

    test('docker-compose up matches Bash(docker-compose:*)', () => {
      expect(matchesPattern('docker-compose up', 'Bash(docker-compose:*)')).toBe(true);
    });

    test('docker-compose exec -T mysql matches Bash(docker-compose:*)', () => {
      expect(matchesPattern('docker-compose exec -T mysql', 'Bash(docker-compose:*)')).toBe(true);
    });

    test('full docker-compose exec command matches Bash(docker-compose:*)', () => {
      const cmdString = 'docker-compose exec -T mysql mysql -u root -p1 vfm_app -e DESCRIBE vfm_activity;';
      expect(matchesPattern(cmdString, 'Bash(docker-compose:*)')).toBe(true);
    });

    test('docker does NOT match Bash(docker-compose:*) - different command', () => {
      expect(matchesPattern('docker run', 'Bash(docker-compose:*)')).toBe(false);
    });

    test('docker-composex does NOT match Bash(docker-compose:*) - word boundary', () => {
      expect(matchesPattern('docker-composex', 'Bash(docker-compose:*)')).toBe(false);
    });
  });

  describe('matchesPattern() - cd pattern', () => {
    test('cd /path matches Bash(cd:*)', () => {
      expect(matchesPattern('cd /home/james/dev/sgl/vfm-workspace/vfm-app-modernized', 'Bash(cd:*)')).toBe(true);
    });

    test('cd alone matches Bash(cd:*)', () => {
      expect(matchesPattern('cd', 'Bash(cd:*)')).toBe(true);
    });
  });

  describe('matchesPattern() - head pattern', () => {
    test('head -50 matches Bash(head:*)', () => {
      expect(matchesPattern('head -50', 'Bash(head:*)')).toBe(true);
    });

    test('head -n 100 matches Bash(head:*)', () => {
      expect(matchesPattern('head -n 100', 'Bash(head:*)')).toBe(true);
    });
  });

  describe('matchesAny() - command matching', () => {
    test('cd command matches allowlist', () => {
      const command = { executable: 'cd', args: '/home/james/dev/sgl/vfm-workspace/vfm-app-modernized' };
      expect(matchesAny(command, allowlist)).toBe(true);
    });

    test('docker-compose command matches allowlist', () => {
      const command = {
        executable: 'docker-compose',
        args: 'exec -T mysql mysql -u root -p1 vfm_app -e DESCRIBE vfm_activity;'
      };
      expect(matchesAny(command, allowlist)).toBe(true);
    });

    test('head command matches allowlist', () => {
      const command = { executable: 'head', args: '-50' };
      expect(matchesAny(command, allowlist)).toBe(true);
    });

    test('curl command does NOT match allowlist', () => {
      const command = { executable: 'curl', args: 'http://example.com' };
      expect(matchesAny(command, allowlist)).toBe(false);
    });
  });

  describe('isDenied() - command denial', () => {
    test('docker-compose is NOT denied', () => {
      const command = {
        executable: 'docker-compose',
        args: 'exec -T mysql mysql -u root -p1 vfm_app -e DESCRIBE vfm_activity;'
      };
      expect(isDenied(command, denylist)).toBe(false);
    });

    test('rm -rf IS denied', () => {
      const command = { executable: 'rm', args: '-rf /tmp' };
      expect(isDenied(command, denylist)).toBe(true);
    });
  });
});

// ===========================================================================
// Part 3: Integration Test - Full Flow
// ===========================================================================
describe('Docker-Compose Command: Integration Test', () => {
  /**
   * Simulates the full permission check flow.
   * This mirrors the logic in hooks/permitter.js
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
    const results = [];
    for (const cmd of commands) {
      const cmdStr = cmd.args ? `${cmd.executable} ${cmd.args}` : cmd.executable;

      // Denylist takes precedence
      if (isDenied(cmd, denylist)) {
        return {
          allowed: false,
          reason: `Denied: ${cmdStr}`,
          matchResults: results
        };
      }

      // Check allowlist
      const matches = matchesAny(cmd, allowlist);
      results.push({
        executable: cmd.executable,
        args: cmd.args,
        fullCommand: cmdStr,
        matchedAllowlist: matches,
        matchedPattern: matches ? findMatchingPattern(cmd, allowlist) : null
      });

      if (!matches) {
        return {
          allowed: false,
          reason: `Not in allowlist: ${cmdStr}`,
          matchResults: results
        };
      }
    }

    // 4. All commands allowed
    return {
      allowed: true,
      reason: 'All commands matched allowlist',
      matchResults: results
    };
  }

  /**
   * Find which pattern matched a command (for debugging)
   */
  function findMatchingPattern(command, patterns) {
    const cmdString = command.args
      ? `${command.executable} ${command.args}`
      : command.executable;

    for (const pattern of patterns) {
      if (matchesPattern(cmdString, pattern)) {
        return pattern;
      }
    }
    return null;
  }

  // The allowlist that should include docker-compose
  const allowlist = [
    'Bash(cd:*)',
    'Bash(docker-compose:*)',
    'Bash(head:*)',
    'Bash(npm test:*)',
    'Bash(git:*)'
  ];

  const denylist = [
    'Bash(rm -rf:*)',
    'Bash(sudo:*)'
  ];

  test('full docker-compose command should be ALLOWED', () => {
    const result = checkPermission(DOCKER_COMPOSE_COMMAND, allowlist, denylist);

    expect(result.allowed).toBe(true);
    expect(result.matchResults).toHaveLength(3);

    // Verify each component matched
    expect(result.matchResults[0].executable).toBe('cd');
    expect(result.matchResults[0].matchedAllowlist).toBe(true);
    expect(result.matchResults[0].matchedPattern).toBe('Bash(cd:*)');

    expect(result.matchResults[1].executable).toBe('docker-compose');
    expect(result.matchResults[1].matchedAllowlist).toBe(true);
    expect(result.matchResults[1].matchedPattern).toBe('Bash(docker-compose:*)');

    expect(result.matchResults[2].executable).toBe('head');
    expect(result.matchResults[2].matchedAllowlist).toBe(true);
    expect(result.matchResults[2].matchedPattern).toBe('Bash(head:*)');
  });

  test('should DENY if docker-compose is not in allowlist', () => {
    const limitedAllowlist = [
      'Bash(cd:*)',
      'Bash(head:*)'
      // Note: docker-compose is NOT in this list
    ];

    const result = checkPermission(DOCKER_COMPOSE_COMMAND, limitedAllowlist, denylist);

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Not in allowlist');
    expect(result.reason).toContain('docker-compose');
  });

  test('should DENY if cd is not in allowlist', () => {
    const limitedAllowlist = [
      'Bash(docker-compose:*)',
      'Bash(head:*)'
      // Note: cd is NOT in this list
    ];

    const result = checkPermission(DOCKER_COMPOSE_COMMAND, limitedAllowlist, denylist);

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Not in allowlist');
    expect(result.reason).toContain('cd');
  });

  test('should DENY if head is not in allowlist', () => {
    const limitedAllowlist = [
      'Bash(cd:*)',
      'Bash(docker-compose:*)'
      // Note: head is NOT in this list
    ];

    const result = checkPermission(DOCKER_COMPOSE_COMMAND, limitedAllowlist, denylist);

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Not in allowlist');
    expect(result.reason).toContain('head');
  });
});

// ===========================================================================
// Part 4: Analysis Report
// ===========================================================================
describe('Docker-Compose Command: Analysis Report', () => {
  test('should report which parts match which patterns', () => {
    const commands = parseCommand(DOCKER_COMPOSE_COMMAND);

    const allowlist = [
      'Bash(cd:*)',
      'Bash(docker-compose:*)',
      'Bash(head:*)'
    ];

    const report = commands.map(cmd => {
      const cmdStr = cmd.args ? `${cmd.executable} ${cmd.args}` : cmd.executable;
      let matchedPattern = null;

      for (const pattern of allowlist) {
        if (matchesPattern(cmdStr, pattern)) {
          matchedPattern = pattern;
          break;
        }
      }

      return {
        command: cmdStr.substring(0, 80) + (cmdStr.length > 80 ? '...' : ''),
        executable: cmd.executable,
        matchedPattern: matchedPattern,
        status: matchedPattern ? 'ALLOWED' : 'ASK'
      };
    });

    console.log('\n=== Docker-Compose Command Analysis ===');
    console.log('Full command:', DOCKER_COMPOSE_COMMAND);
    console.log('\nParsed components:');
    report.forEach((item, idx) => {
      console.log(`  ${idx + 1}. ${item.executable}`);
      console.log(`     Command: ${item.command}`);
      console.log(`     Pattern: ${item.matchedPattern}`);
      console.log(`     Status: ${item.status}`);
    });
    console.log('\n=== End Analysis ===\n');

    // All should match
    expect(report.every(r => r.status === 'ALLOWED')).toBe(true);
    expect(report[0].matchedPattern).toBe('Bash(cd:*)');
    expect(report[1].matchedPattern).toBe('Bash(docker-compose:*)');
    expect(report[2].matchedPattern).toBe('Bash(head:*)');
  });
});
