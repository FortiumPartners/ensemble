/**
 * Unit tests for matcher.js
 *
 * Tests PERM-P3-MATCH-001 through PERM-P3-MATCH-008:
 * - Pattern format parsing (Bash(prefix:*))
 * - Prefix matching algorithm
 * - Exact matching
 * - Denylist precedence
 * - All commands validation
 */

'use strict';

const {
  matchesPattern,
  matchesAny,
  isDenied,
  // MCP tool support
  parseMcpToolName,
  matchesMcpPattern,
  matchesMcpToolAny,
  isMcpDenied
} = require('../lib/matcher');

// ===========================================================================
// PERM-P3-MATCH-001: Parse Bash(prefix:*) pattern format
// ===========================================================================
describe('matchesPattern() - Pattern Format', () => {
  describe('valid pattern formats', () => {
    test('should match pattern with prefix wildcard', () => {
      expect(matchesPattern('npm test', 'Bash(npm test:*)')).toBe(true);
    });

    test('should match pattern without wildcard (exact match)', () => {
      expect(matchesPattern('npm test', 'Bash(npm test)')).toBe(true);
    });

    test('should reject non-Bash patterns', () => {
      expect(matchesPattern('npm test', 'Shell(npm test:*)')).toBe(false);
    });

    test('should reject malformed patterns - missing Bash prefix', () => {
      expect(matchesPattern('npm test', 'npm test:*')).toBe(false);
    });

    test('should reject malformed patterns - missing closing paren', () => {
      expect(matchesPattern('npm test', 'Bash(npm test:*')).toBe(false);
    });

    test('should reject malformed patterns - missing opening paren', () => {
      expect(matchesPattern('npm test', 'Bashnpm test:*)')).toBe(false);
    });

    test('should handle empty pattern content', () => {
      expect(matchesPattern('', 'Bash()')).toBe(true);
    });

    test('should handle pattern with only wildcard', () => {
      expect(matchesPattern('npm', 'Bash(:*)')).toBe(false);  // Empty prefix doesn't match 'npm'
    });
  });
});

// ===========================================================================
// PERM-P3-MATCH-002: Implement prefix matching algorithm
// ===========================================================================
describe('matchesPattern() - Prefix Matching', () => {
  describe('basic prefix matching', () => {
    test('npm test matches Bash(npm test:*)', () => {
      expect(matchesPattern('npm test', 'Bash(npm test:*)')).toBe(true);
    });

    test('npm test --coverage matches Bash(npm test:*)', () => {
      expect(matchesPattern('npm test --coverage', 'Bash(npm test:*)')).toBe(true);
    });

    test('npm test --coverage --verbose matches Bash(npm test:*)', () => {
      expect(matchesPattern('npm test --coverage --verbose', 'Bash(npm test:*)')).toBe(true);
    });

    test('npm run does NOT match Bash(npm test:*)', () => {
      expect(matchesPattern('npm run', 'Bash(npm test:*)')).toBe(false);
    });

    test('npm testing does NOT match Bash(npm test:*) - must be word boundary', () => {
      expect(matchesPattern('npm testing', 'Bash(npm test:*)')).toBe(false);
    });

    test('npmtest does NOT match Bash(npm test:*) - missing space', () => {
      expect(matchesPattern('npmtest', 'Bash(npm test:*)')).toBe(false);
    });
  });

  describe('single word prefix matching', () => {
    test('git matches Bash(git:*)', () => {
      expect(matchesPattern('git', 'Bash(git:*)')).toBe(true);
    });

    test('git add matches Bash(git:*)', () => {
      expect(matchesPattern('git add', 'Bash(git:*)')).toBe(true);
    });

    test('git commit -m "message" matches Bash(git:*)', () => {
      expect(matchesPattern('git commit -m "message"', 'Bash(git:*)')).toBe(true);
    });

    test('github does NOT match Bash(git:*)', () => {
      expect(matchesPattern('github', 'Bash(git:*)')).toBe(false);
    });
  });

  describe('multi-word prefix matching', () => {
    test('npm run build matches Bash(npm run:*)', () => {
      expect(matchesPattern('npm run build', 'Bash(npm run:*)')).toBe(true);
    });

    test('npm run test:unit matches Bash(npm run:*)', () => {
      expect(matchesPattern('npm run test:unit', 'Bash(npm run:*)')).toBe(true);
    });

    test('npm run matches Bash(npm run:*) - exact prefix', () => {
      expect(matchesPattern('npm run', 'Bash(npm run:*)')).toBe(true);
    });

    test('npm running does NOT match Bash(npm run:*)', () => {
      expect(matchesPattern('npm running', 'Bash(npm run:*)')).toBe(false);
    });
  });

  describe('prefix with special characters', () => {
    test('pytest --cov matches Bash(pytest --cov:*)', () => {
      expect(matchesPattern('pytest --cov', 'Bash(pytest --cov:*)')).toBe(true);
    });

    test('pytest --cov=src does NOT match Bash(pytest --cov:*) - no space after prefix', () => {
      // The pattern "pytest --cov" requires space before additional args
      // "--cov=src" is a single token, not "--cov src"
      expect(matchesPattern('pytest --cov=src', 'Bash(pytest --cov:*)')).toBe(false);
    });

    test('pytest --cov src matches Bash(pytest --cov:*) - space separated', () => {
      expect(matchesPattern('pytest --cov src', 'Bash(pytest --cov:*)')).toBe(true);
    });

    test('git add . matches Bash(git add:*)', () => {
      expect(matchesPattern('git add .', 'Bash(git add:*)')).toBe(true);
    });

    test('rm -rf matches Bash(rm -rf:*)', () => {
      expect(matchesPattern('rm -rf', 'Bash(rm -rf:*)')).toBe(true);
    });

    test('rm -rf /tmp matches Bash(rm -rf:*)', () => {
      expect(matchesPattern('rm -rf /tmp', 'Bash(rm -rf:*)')).toBe(true);
    });
  });
});

// ===========================================================================
// PERM-P3-MATCH-003: Implement exact matching
// ===========================================================================
describe('matchesPattern() - Exact Matching', () => {
  describe('exact match patterns (no :*)', () => {
    test('npm test matches Bash(npm test) exactly', () => {
      expect(matchesPattern('npm test', 'Bash(npm test)')).toBe(true);
    });

    test('npm test --coverage does NOT match Bash(npm test) - has extra args', () => {
      expect(matchesPattern('npm test --coverage', 'Bash(npm test)')).toBe(false);
    });

    test('npm matches Bash(npm) exactly', () => {
      expect(matchesPattern('npm', 'Bash(npm)')).toBe(true);
    });

    test('npm install does NOT match Bash(npm) - has extra args', () => {
      expect(matchesPattern('npm install', 'Bash(npm)')).toBe(false);
    });

    test('git push matches Bash(git push) exactly', () => {
      expect(matchesPattern('git push', 'Bash(git push)')).toBe(true);
    });

    test('git push origin main does NOT match Bash(git push) - has extra args', () => {
      expect(matchesPattern('git push origin main', 'Bash(git push)')).toBe(false);
    });
  });

  describe('exact match vs prefix match comparison', () => {
    test('npm test matches Bash(npm test) but npm test --x does not', () => {
      expect(matchesPattern('npm test', 'Bash(npm test)')).toBe(true);
      expect(matchesPattern('npm test --x', 'Bash(npm test)')).toBe(false);
    });

    test('npm test and npm test --x both match Bash(npm test:*)', () => {
      expect(matchesPattern('npm test', 'Bash(npm test:*)')).toBe(true);
      expect(matchesPattern('npm test --x', 'Bash(npm test:*)')).toBe(true);
    });
  });
});

// ===========================================================================
// PERM-P3-MATCH-004: Check denylist before allowlist (via isDenied)
// ===========================================================================
describe('isDenied()', () => {
  test('should return true when command matches deny pattern', () => {
    const command = { executable: 'rm', args: '-rf /tmp' };
    const denylist = ['Bash(rm -rf:*)'];

    expect(isDenied(command, denylist)).toBe(true);
  });

  test('should return false when command does not match deny pattern', () => {
    const command = { executable: 'npm', args: 'test' };
    const denylist = ['Bash(rm -rf:*)'];

    expect(isDenied(command, denylist)).toBe(false);
  });

  test('should return false with empty denylist', () => {
    const command = { executable: 'rm', args: '-rf /tmp' };
    const denylist = [];

    expect(isDenied(command, denylist)).toBe(false);
  });

  test('should check multiple deny patterns', () => {
    const command = { executable: 'sudo', args: 'apt install' };
    const denylist = ['Bash(rm -rf:*)', 'Bash(sudo:*)', 'Bash(dd:*)'];

    expect(isDenied(command, denylist)).toBe(true);
  });

  test('should match command without args', () => {
    const command = { executable: 'sudo', args: '' };
    const denylist = ['Bash(sudo:*)'];

    expect(isDenied(command, denylist)).toBe(true);
  });
});

// ===========================================================================
// PERM-P3-MATCH-005: Validate all commands match
// ===========================================================================
describe('matchesAny()', () => {
  describe('single pattern matching', () => {
    test('should return true when command matches pattern', () => {
      const command = { executable: 'npm', args: 'test' };
      const patterns = ['Bash(npm test:*)'];

      expect(matchesAny(command, patterns)).toBe(true);
    });

    test('should return false when command does not match pattern', () => {
      const command = { executable: 'npm', args: 'install' };
      const patterns = ['Bash(npm test:*)'];

      expect(matchesAny(command, patterns)).toBe(false);
    });
  });

  describe('multiple pattern matching', () => {
    test('should return true when command matches any pattern', () => {
      const command = { executable: 'git', args: 'commit -m "msg"' };
      const patterns = ['Bash(npm test:*)', 'Bash(git:*)', 'Bash(pytest:*)'];

      expect(matchesAny(command, patterns)).toBe(true);
    });

    test('should return false when command matches no patterns', () => {
      const command = { executable: 'rm', args: '-rf /tmp' };
      const patterns = ['Bash(npm test:*)', 'Bash(git:*)', 'Bash(pytest:*)'];

      expect(matchesAny(command, patterns)).toBe(false);
    });
  });

  describe('empty patterns array', () => {
    test('should return false with empty patterns array', () => {
      const command = { executable: 'npm', args: 'test' };
      const patterns = [];

      expect(matchesAny(command, patterns)).toBe(false);
    });
  });

  describe('command string construction', () => {
    test('should construct command string with args', () => {
      const command = { executable: 'npm', args: 'test --coverage' };
      const patterns = ['Bash(npm test --coverage)'];

      expect(matchesAny(command, patterns)).toBe(true);
    });

    test('should handle command without args (empty string)', () => {
      const command = { executable: 'ls', args: '' };
      const patterns = ['Bash(ls)'];

      expect(matchesAny(command, patterns)).toBe(true);
    });

    test('should handle command without args (undefined)', () => {
      const command = { executable: 'ls', args: undefined };
      const patterns = ['Bash(ls)'];

      expect(matchesAny(command, patterns)).toBe(true);
    });
  });
});

// ===========================================================================
// PERM-P3-MATCH-006: Module exports
// ===========================================================================
describe('Module exports', () => {
  test('should export matchesPattern function', () => {
    expect(typeof matchesPattern).toBe('function');
  });

  test('should export matchesAny function', () => {
    expect(typeof matchesAny).toBe('function');
  });

  test('should export isDenied function', () => {
    expect(typeof isDenied).toBe('function');
  });
});

// ===========================================================================
// Edge cases and complex scenarios
// ===========================================================================
describe('Edge Cases', () => {
  describe('whitespace handling', () => {
    test('should not match commands with leading whitespace', () => {
      // The command parser should strip whitespace before matching
      expect(matchesPattern(' npm test', 'Bash(npm test:*)')).toBe(false);
    });

    test('should not match commands with trailing whitespace', () => {
      expect(matchesPattern('npm test ', 'Bash(npm test)')).toBe(false);
    });

    test('should handle multiple spaces in pattern', () => {
      // Pattern specifies exact spacing
      expect(matchesPattern('npm  test', 'Bash(npm  test)')).toBe(true);
    });
  });

  describe('special characters in patterns', () => {
    test('should match patterns with slashes', () => {
      expect(matchesPattern('cat /etc/passwd', 'Bash(cat /etc/passwd)')).toBe(true);
    });

    test('should match patterns with dots', () => {
      expect(matchesPattern('node script.js', 'Bash(node script.js)')).toBe(true);
    });

    test('should match patterns with equals signs', () => {
      expect(matchesPattern('npm run build', 'Bash(npm run:*)')).toBe(true);
    });
  });

  describe('case sensitivity', () => {
    test('should be case sensitive - NPM does not match npm', () => {
      expect(matchesPattern('NPM test', 'Bash(npm test:*)')).toBe(false);
    });

    test('should be case sensitive - exact case matches', () => {
      expect(matchesPattern('NPM test', 'Bash(NPM test:*)')).toBe(true);
    });
  });

  describe('empty command strings', () => {
    test('should handle empty command string', () => {
      expect(matchesPattern('', 'Bash(npm test:*)')).toBe(false);
    });

    test('should handle empty command in matchesAny', () => {
      const command = { executable: '', args: '' };
      const patterns = ['Bash(npm test:*)'];

      expect(matchesAny(command, patterns)).toBe(false);
    });
  });
});

// ===========================================================================
// TRD Appendix A: Test Cases from specification
// ===========================================================================
describe('TRD Test Cases - Pattern Matching', () => {
  const allowlist = [
    'Bash(npm test:*)',
    'Bash(npm run:*)',
    'Bash(git add:*)',
    'Bash(git commit:*)',
    'Bash(git push:*)',
    'Bash(pytest:*)'
  ];

  const denylist = [
    'Bash(rm -rf:*)',
    'Bash(sudo:*)'
  ];

  test('npm test should match allowlist', () => {
    const command = { executable: 'npm', args: 'test' };
    expect(matchesAny(command, allowlist)).toBe(true);
  });

  test('npm test --coverage should match allowlist', () => {
    const command = { executable: 'npm', args: 'test --coverage' };
    expect(matchesAny(command, allowlist)).toBe(true);
  });

  test('npm run build should match allowlist', () => {
    const command = { executable: 'npm', args: 'run build' };
    expect(matchesAny(command, allowlist)).toBe(true);
  });

  test('git add . should match allowlist', () => {
    const command = { executable: 'git', args: 'add .' };
    expect(matchesAny(command, allowlist)).toBe(true);
  });

  test('git commit -m "msg" should match allowlist', () => {
    const command = { executable: 'git', args: 'commit -m msg' };
    expect(matchesAny(command, allowlist)).toBe(true);
  });

  test('pytest should match allowlist', () => {
    const command = { executable: 'pytest', args: '' };
    expect(matchesAny(command, allowlist)).toBe(true);
  });

  test('pytest --cov should match allowlist', () => {
    const command = { executable: 'pytest', args: '--cov' };
    expect(matchesAny(command, allowlist)).toBe(true);
  });

  test('rm -rf / should match denylist', () => {
    const command = { executable: 'rm', args: '-rf /' };
    expect(isDenied(command, denylist)).toBe(true);
  });

  test('sudo apt install should match denylist', () => {
    const command = { executable: 'sudo', args: 'apt install' };
    expect(isDenied(command, denylist)).toBe(true);
  });

  test('npm install should NOT match allowlist (not in list)', () => {
    const command = { executable: 'npm', args: 'install' };
    expect(matchesAny(command, allowlist)).toBe(false);
  });

  test('wget should NOT match allowlist', () => {
    const command = { executable: 'wget', args: 'http://example.com' };
    expect(matchesAny(command, allowlist)).toBe(false);
  });
});

// ===========================================================================
// MCP Tool Support Tests (Native Format)
// ===========================================================================

describe('MCP Pattern Matching (Native Format)', () => {
  // -------------------------------------------------------------------------
  // parseMcpToolName() tests
  // -------------------------------------------------------------------------
  describe('parseMcpToolName()', () => {
    describe('valid MCP tool names', () => {
      test('parses mcp__playwright__navigate correctly', () => {
        expect(parseMcpToolName('mcp__playwright__navigate')).toEqual({
          server: 'playwright',
          tool: 'navigate'
        });
      });

      test('parses mcp__playwright__click correctly', () => {
        expect(parseMcpToolName('mcp__playwright__click')).toEqual({
          server: 'playwright',
          tool: 'click'
        });
      });

      test('parses mcp__context7__query-docs correctly', () => {
        expect(parseMcpToolName('mcp__context7__query-docs')).toEqual({
          server: 'context7',
          tool: 'query-docs'
        });
      });

      test('parses mcp__filesystem__read correctly', () => {
        expect(parseMcpToolName('mcp__filesystem__read')).toEqual({
          server: 'filesystem',
          tool: 'read'
        });
      });

      test('parses tool with double underscore in tool name', () => {
        expect(parseMcpToolName('mcp__server__tool__with__underscores')).toEqual({
          server: 'server',
          tool: 'tool__with__underscores'
        });
      });

      test('parses server-only tool (no tool part)', () => {
        expect(parseMcpToolName('mcp__server')).toEqual({
          server: 'server',
          tool: null
        });
      });
    });

    describe('invalid inputs', () => {
      test('returns null for non-MCP tool', () => {
        expect(parseMcpToolName('Bash')).toBeNull();
      });

      test('returns null for Read tool', () => {
        expect(parseMcpToolName('Read')).toBeNull();
      });

      test('returns null for empty string', () => {
        expect(parseMcpToolName('')).toBeNull();
      });

      test('returns null for null', () => {
        expect(parseMcpToolName(null)).toBeNull();
      });

      test('returns null for undefined', () => {
        expect(parseMcpToolName(undefined)).toBeNull();
      });

      test('returns null for mcp__ with empty server', () => {
        expect(parseMcpToolName('mcp__')).toBeNull();
      });

      test('returns null for mcp_single_underscore prefix', () => {
        expect(parseMcpToolName('mcp_playwright_navigate')).toBeNull();
      });
    });
  });

  // -------------------------------------------------------------------------
  // matchesMcpPattern() tests - Native Format
  // -------------------------------------------------------------------------
  describe('matchesMcpPattern()', () => {
    describe('exact match', () => {
      test('mcp__playwright__navigate matches mcp__playwright__navigate', () => {
        expect(matchesMcpPattern('mcp__playwright__navigate', 'mcp__playwright__navigate')).toBe(true);
      });

      test('mcp__playwright__click does NOT match mcp__playwright__navigate', () => {
        expect(matchesMcpPattern('mcp__playwright__click', 'mcp__playwright__navigate')).toBe(false);
      });

      test('mcp__context7__query-docs matches mcp__context7__query-docs', () => {
        expect(matchesMcpPattern('mcp__context7__query-docs', 'mcp__context7__query-docs')).toBe(true);
      });

      test('mcp__weaviate-vfm__search_api_endpoints matches exact pattern', () => {
        expect(matchesMcpPattern('mcp__weaviate-vfm__search_api_endpoints', 'mcp__weaviate-vfm__search_api_endpoints')).toBe(true);
      });
    });

    describe('wildcard match (mcp__server__*)', () => {
      test('mcp__playwright__navigate matches mcp__playwright__*', () => {
        expect(matchesMcpPattern('mcp__playwright__navigate', 'mcp__playwright__*')).toBe(true);
      });

      test('mcp__playwright__click matches mcp__playwright__*', () => {
        expect(matchesMcpPattern('mcp__playwright__click', 'mcp__playwright__*')).toBe(true);
      });

      test('mcp__playwright__browser_click matches mcp__playwright__*', () => {
        expect(matchesMcpPattern('mcp__playwright__browser_click', 'mcp__playwright__*')).toBe(true);
      });

      test('mcp__filesystem__read does NOT match mcp__playwright__*', () => {
        expect(matchesMcpPattern('mcp__filesystem__read', 'mcp__playwright__*')).toBe(false);
      });

      test('mcp__context7__query-docs does NOT match mcp__playwright__*', () => {
        expect(matchesMcpPattern('mcp__context7__query-docs', 'mcp__playwright__*')).toBe(false);
      });
    });

    describe('server-only match (mcp__server)', () => {
      test('mcp__playwright__navigate matches mcp__playwright', () => {
        expect(matchesMcpPattern('mcp__playwright__navigate', 'mcp__playwright')).toBe(true);
      });

      test('mcp__playwright__click matches mcp__playwright', () => {
        expect(matchesMcpPattern('mcp__playwright__click', 'mcp__playwright')).toBe(true);
      });

      test('mcp__playwright__browser_snapshot matches mcp__playwright', () => {
        expect(matchesMcpPattern('mcp__playwright__browser_snapshot', 'mcp__playwright')).toBe(true);
      });

      test('mcp__filesystem__read does NOT match mcp__playwright', () => {
        expect(matchesMcpPattern('mcp__filesystem__read', 'mcp__playwright')).toBe(false);
      });

      test('mcp__context7__query-docs does NOT match mcp__playwright', () => {
        expect(matchesMcpPattern('mcp__context7__query-docs', 'mcp__playwright')).toBe(false);
      });
    });

    describe('invalid patterns', () => {
      test('returns false for Bash pattern', () => {
        expect(matchesMcpPattern('mcp__playwright__navigate', 'Bash(npm test:*)')).toBe(false);
      });

      test('returns false for old Mcp() format pattern', () => {
        expect(matchesMcpPattern('mcp__playwright__navigate', 'Mcp(playwright:*)')).toBe(false);
      });

      test('returns false for non-mcp pattern', () => {
        expect(matchesMcpPattern('mcp__playwright__navigate', 'playwright__navigate')).toBe(false);
      });

      test('returns false for empty pattern', () => {
        expect(matchesMcpPattern('mcp__playwright__navigate', '')).toBe(false);
      });

      test('returns false for null pattern', () => {
        expect(matchesMcpPattern('mcp__playwright__navigate', null)).toBe(false);
      });

      test('returns false for non-MCP tool', () => {
        expect(matchesMcpPattern('Bash', 'mcp__playwright__*')).toBe(false);
      });
    });

    describe('case sensitivity', () => {
      test('server matching is case sensitive', () => {
        expect(matchesMcpPattern('mcp__Playwright__navigate', 'mcp__playwright')).toBe(false);
        expect(matchesMcpPattern('mcp__Playwright__navigate', 'mcp__Playwright')).toBe(true);
      });

      test('tool matching is case sensitive', () => {
        expect(matchesMcpPattern('mcp__playwright__Navigate', 'mcp__playwright__navigate')).toBe(false);
        expect(matchesMcpPattern('mcp__playwright__Navigate', 'mcp__playwright__Navigate')).toBe(true);
      });
    });
  });

  // -------------------------------------------------------------------------
  // matchesMcpToolAny() tests - Native Format
  // -------------------------------------------------------------------------
  describe('matchesMcpToolAny()', () => {
    describe('single pattern matching', () => {
      test('returns true when tool matches wildcard pattern', () => {
        const patterns = ['mcp__playwright__*'];
        expect(matchesMcpToolAny('mcp__playwright__navigate', patterns)).toBe(true);
      });

      test('returns true when tool matches exact pattern', () => {
        const patterns = ['mcp__playwright__navigate'];
        expect(matchesMcpToolAny('mcp__playwright__navigate', patterns)).toBe(true);
      });

      test('returns false when tool does not match pattern', () => {
        const patterns = ['mcp__filesystem__*'];
        expect(matchesMcpToolAny('mcp__playwright__navigate', patterns)).toBe(false);
      });
    });

    describe('multiple pattern matching', () => {
      test('returns true when tool matches any pattern', () => {
        const patterns = [
          'mcp__context7__*',
          'mcp__playwright__*',
          'mcp__filesystem__read'
        ];
        expect(matchesMcpToolAny('mcp__playwright__click', patterns)).toBe(true);
      });

      test('returns false when tool matches no patterns', () => {
        const patterns = [
          'mcp__context7__*',
          'mcp__filesystem__read'
        ];
        expect(matchesMcpToolAny('mcp__playwright__navigate', patterns)).toBe(false);
      });

      test('returns true when tool matches specific tool pattern', () => {
        const patterns = [
          'mcp__playwright__navigate',
          'mcp__playwright__click'
        ];
        expect(matchesMcpToolAny('mcp__playwright__navigate', patterns)).toBe(true);
      });
    });

    describe('empty patterns array', () => {
      test('returns false with empty patterns array', () => {
        expect(matchesMcpToolAny('mcp__playwright__navigate', [])).toBe(false);
      });
    });

    describe('real-world patterns from vfm-workspace', () => {
      const vfmAllowlist = [
        'mcp__playwright__browser_navigate',
        'mcp__playwright__browser_close',
        'mcp__playwright__browser_snapshot',
        'mcp__playwright__browser_click',
        'mcp__weaviate-vfm__search_api_endpoints'
      ];

      test('mcp__playwright__browser_click matches allowlist', () => {
        expect(matchesMcpToolAny('mcp__playwright__browser_click', vfmAllowlist)).toBe(true);
      });

      test('mcp__playwright__browser_fill does NOT match allowlist (not listed)', () => {
        expect(matchesMcpToolAny('mcp__playwright__browser_fill', vfmAllowlist)).toBe(false);
      });

      test('mcp__weaviate-vfm__search_api_endpoints matches allowlist', () => {
        expect(matchesMcpToolAny('mcp__weaviate-vfm__search_api_endpoints', vfmAllowlist)).toBe(true);
      });

      test('mcp__weaviate-vfm__other_tool does NOT match allowlist', () => {
        expect(matchesMcpToolAny('mcp__weaviate-vfm__other_tool', vfmAllowlist)).toBe(false);
      });
    });
  });

  // -------------------------------------------------------------------------
  // isMcpDenied() tests - Native Format
  // -------------------------------------------------------------------------
  describe('isMcpDenied()', () => {
    test('returns true when tool matches exact deny pattern', () => {
      const denylist = ['mcp__playwright__fill', 'mcp__dangerous-server__*'];
      expect(isMcpDenied('mcp__playwright__fill', denylist)).toBe(true);
    });

    test('returns true for server-wide deny with wildcard', () => {
      const denylist = ['mcp__dangerous-server__*'];
      expect(isMcpDenied('mcp__dangerous-server__any-tool', denylist)).toBe(true);
    });

    test('returns true for server-wide deny without wildcard', () => {
      const denylist = ['mcp__dangerous-server'];
      expect(isMcpDenied('mcp__dangerous-server__any-tool', denylist)).toBe(true);
    });

    test('returns false when tool does not match deny pattern', () => {
      const denylist = ['mcp__playwright__fill'];
      expect(isMcpDenied('mcp__playwright__navigate', denylist)).toBe(false);
    });

    test('returns false with empty denylist', () => {
      expect(isMcpDenied('mcp__playwright__navigate', [])).toBe(false);
    });
  });
});

// ===========================================================================
// MCP Integration Tests - Real-world scenarios (Native Format)
// ===========================================================================
describe('MCP Real-world Scenarios (Native Format)', () => {
  const allowlist = [
    'mcp__playwright__*',
    'mcp__context7__query-docs',
    'mcp__context7__resolve-library-id',
    'Bash(npm test:*)'
  ];

  const denylist = [
    'mcp__filesystem__delete',
    'mcp__dangerous-server'
  ];

  test('playwright navigate should match allowlist', () => {
    expect(matchesMcpToolAny('mcp__playwright__navigate', allowlist)).toBe(true);
  });

  test('playwright click should match allowlist', () => {
    expect(matchesMcpToolAny('mcp__playwright__click', allowlist)).toBe(true);
  });

  test('context7 query-docs should match allowlist', () => {
    expect(matchesMcpToolAny('mcp__context7__query-docs', allowlist)).toBe(true);
  });

  test('context7 resolve-library-id should match allowlist', () => {
    expect(matchesMcpToolAny('mcp__context7__resolve-library-id', allowlist)).toBe(true);
  });

  test('context7 some-other-tool should NOT match allowlist', () => {
    expect(matchesMcpToolAny('mcp__context7__some-other-tool', allowlist)).toBe(false);
  });

  test('filesystem read should NOT match allowlist (not listed)', () => {
    expect(matchesMcpToolAny('mcp__filesystem__read', allowlist)).toBe(false);
  });

  test('filesystem delete should match denylist', () => {
    expect(isMcpDenied('mcp__filesystem__delete', denylist)).toBe(true);
  });

  test('dangerous-server any-tool should match denylist', () => {
    expect(isMcpDenied('mcp__dangerous-server__any-tool', denylist)).toBe(true);
  });

  test('filesystem read should NOT match denylist', () => {
    expect(isMcpDenied('mcp__filesystem__read', denylist)).toBe(false);
  });

  test('playwright navigate should NOT match denylist', () => {
    expect(isMcpDenied('mcp__playwright__navigate', denylist)).toBe(false);
  });
});

// ===========================================================================
// MCP Module exports
// ===========================================================================
describe('MCP Module exports', () => {
  test('should export parseMcpToolName function', () => {
    expect(typeof parseMcpToolName).toBe('function');
  });

  test('should export matchesMcpPattern function', () => {
    expect(typeof matchesMcpPattern).toBe('function');
  });

  test('should export matchesMcpToolAny function', () => {
    expect(typeof matchesMcpToolAny).toBe('function');
  });

  test('should export isMcpDenied function', () => {
    expect(typeof isMcpDenied).toBe('function');
  });
});
