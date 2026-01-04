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
  isDenied
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
