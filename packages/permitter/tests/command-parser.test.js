/**
 * Unit tests for command-parser.js
 *
 * Tests PERM-P2-PARSE-017: Unit tests for tokenizer
 * Tests PERM-P2-PARSE-018: Unit tests for command extraction
 */

'use strict';

const {
  parseCommand,
  tokenize,
  splitByOperators,
  normalizeSegment,
  checkUnsafe,
  WRAPPER_COMMANDS,
  SKIP_COMMANDS,
  OPERATORS,
  State
} = require('../lib/command-parser');

// =============================================================================
// PERM-P2-PARSE-001: Tokenizer State Machine Design Tests
// =============================================================================
describe('Tokenizer State Machine', () => {
  describe('State constants', () => {
    test('should have all required states', () => {
      expect(State.NORMAL).toBe('NORMAL');
      expect(State.SINGLE_QUOTE).toBe('SINGLE_QUOTE');
      expect(State.DOUBLE_QUOTE).toBe('DOUBLE_QUOTE');
      expect(State.ESCAPE).toBe('ESCAPE');
    });
  });
});

// =============================================================================
// PERM-P2-PARSE-002: Shell Tokenizer Tests
// =============================================================================
describe('tokenize()', () => {
  test('should handle empty input', () => {
    expect(tokenize('')).toEqual([]);
    expect(tokenize(null)).toEqual([]);
    expect(tokenize(undefined)).toEqual([]);
  });

  test('should tokenize simple command', () => {
    expect(tokenize('npm test')).toEqual(['npm', 'test']);
  });

  test('should tokenize command with multiple spaces', () => {
    expect(tokenize('npm   test')).toEqual(['npm', 'test']);
  });

  test('should tokenize command with leading/trailing spaces', () => {
    expect(tokenize('  npm test  ')).toEqual(['npm', 'test']);
  });

  test('should tokenize command with tabs', () => {
    expect(tokenize('npm\ttest')).toEqual(['npm', 'test']);
  });

  test('should handle complex command with flags', () => {
    expect(tokenize('npm test --coverage --verbose')).toEqual([
      'npm', 'test', '--coverage', '--verbose'
    ]);
  });
});

// =============================================================================
// PERM-P2-PARSE-003: Single-Quoted Strings Tests
// =============================================================================
describe('tokenize() - Single Quotes', () => {
  test('should preserve spaces inside single quotes', () => {
    expect(tokenize("echo 'hello world'")).toEqual(['echo', 'hello world']);
  });

  test('should preserve special characters inside single quotes', () => {
    expect(tokenize("echo 'hello; world'")).toEqual(['echo', 'hello; world']);
  });

  test('should NOT escape inside single quotes', () => {
    expect(tokenize("echo 'hello\\nworld'")).toEqual(['echo', 'hello\\nworld']);
  });

  test('should handle empty single quotes', () => {
    expect(tokenize("echo ''")).toEqual(['echo', '']);
  });

  test('should handle multiple single-quoted strings', () => {
    expect(tokenize("echo 'foo' 'bar'")).toEqual(['echo', 'foo', 'bar']);
  });

  test('should preserve && inside single quotes', () => {
    expect(tokenize("echo 'a && b'")).toEqual(['echo', 'a && b']);
  });
});

// =============================================================================
// PERM-P2-PARSE-004: Double-Quoted Strings with Escapes Tests
// =============================================================================
describe('tokenize() - Double Quotes', () => {
  test('should preserve spaces inside double quotes', () => {
    expect(tokenize('echo "hello world"')).toEqual(['echo', 'hello world']);
  });

  test('should preserve special characters inside double quotes', () => {
    expect(tokenize('echo "hello; world"')).toEqual(['echo', 'hello; world']);
  });

  test('should handle escaped quote inside double quotes', () => {
    expect(tokenize('echo "hello\\"world"')).toEqual(['echo', 'hello"world']);
  });

  test('should handle escaped backslash inside double quotes', () => {
    expect(tokenize('echo "hello\\\\world"')).toEqual(['echo', 'hello\\world']);
  });

  test('should handle empty double quotes', () => {
    expect(tokenize('echo ""')).toEqual(['echo', '']);
  });

  test('should handle multiple double-quoted strings', () => {
    expect(tokenize('echo "foo" "bar"')).toEqual(['echo', 'foo', 'bar']);
  });

  test('should preserve && inside double quotes', () => {
    expect(tokenize('echo "a && b"')).toEqual(['echo', 'a && b']);
  });

  test('should handle mixed quotes', () => {
    expect(tokenize('echo "hello" \'world\'')).toEqual(['echo', 'hello', 'world']);
  });
});

// =============================================================================
// PERM-P2-PARSE-005: Operator Detection Tests
// =============================================================================
describe('tokenize() - Operators', () => {
  test('should detect && operator', () => {
    expect(tokenize('cmd1 && cmd2')).toEqual(['cmd1', '&&', 'cmd2']);
  });

  test('should detect || operator', () => {
    expect(tokenize('cmd1 || cmd2')).toEqual(['cmd1', '||', 'cmd2']);
  });

  test('should detect ; operator', () => {
    expect(tokenize('cmd1; cmd2')).toEqual(['cmd1', ';', 'cmd2']);
  });

  test('should detect | operator', () => {
    expect(tokenize('cmd1 | cmd2')).toEqual(['cmd1', '|', 'cmd2']);
  });

  test('should detect & background operator', () => {
    expect(tokenize('cmd1 &')).toEqual(['cmd1', '&']);
  });

  test('should detect multiple operators', () => {
    expect(tokenize('cmd1 && cmd2 || cmd3')).toEqual([
      'cmd1', '&&', 'cmd2', '||', 'cmd3'
    ]);
  });

  test('should handle operators without spaces', () => {
    expect(tokenize('cmd1&&cmd2')).toEqual(['cmd1', '&&', 'cmd2']);
  });

  test('should detect redirection operators', () => {
    expect(tokenize('cmd > file')).toEqual(['cmd', '>', 'file']);
    expect(tokenize('cmd >> file')).toEqual(['cmd', '>>', 'file']);
    expect(tokenize('cmd < file')).toEqual(['cmd', '<', 'file']);
  });
});

// =============================================================================
// PERM-P2-PARSE-006: Split by Operators Tests
// =============================================================================
describe('splitByOperators()', () => {
  test('should return empty for empty input', () => {
    expect(splitByOperators([])).toEqual([]);
    expect(splitByOperators(null)).toEqual([]);
  });

  test('should return single segment for no operators', () => {
    expect(splitByOperators(['npm', 'test'])).toEqual([['npm', 'test']]);
  });

  test('should split on && operator', () => {
    expect(splitByOperators(['cmd1', '&&', 'cmd2'])).toEqual([
      ['cmd1'],
      ['cmd2']
    ]);
  });

  test('should split on || operator', () => {
    expect(splitByOperators(['cmd1', '||', 'cmd2'])).toEqual([
      ['cmd1'],
      ['cmd2']
    ]);
  });

  test('should split on ; operator', () => {
    expect(splitByOperators(['cmd1', ';', 'cmd2'])).toEqual([
      ['cmd1'],
      ['cmd2']
    ]);
  });

  test('should split on | operator', () => {
    expect(splitByOperators(['cmd1', '|', 'cmd2'])).toEqual([
      ['cmd1'],
      ['cmd2']
    ]);
  });

  test('should split on multiple operators', () => {
    expect(splitByOperators(['cmd1', '&&', 'cmd2', '||', 'cmd3'])).toEqual([
      ['cmd1'],
      ['cmd2'],
      ['cmd3']
    ]);
  });

  test('should handle operator at start (skip empty)', () => {
    expect(splitByOperators(['&&', 'cmd'])).toEqual([['cmd']]);
  });

  test('should handle operator at end (skip empty)', () => {
    expect(splitByOperators(['cmd', '&&'])).toEqual([['cmd']]);
  });
});

// =============================================================================
// PERM-P2-PARSE-007: Environment Variable Prefix Stripping Tests
// =============================================================================
describe('normalizeSegment() - Environment Variables', () => {
  test('should strip single env var prefix', () => {
    const result = normalizeSegment(['API_KEY=secret', 'npm', 'test']);
    expect(result).toEqual({ executable: 'npm', args: 'test' });
  });

  test('should strip multiple env var prefixes', () => {
    const result = normalizeSegment(['FOO=bar', 'BAZ=qux', 'npm', 'test']);
    expect(result).toEqual({ executable: 'npm', args: 'test' });
  });

  test('should handle env var with empty value', () => {
    const result = normalizeSegment(['FOO=', 'npm', 'test']);
    expect(result).toEqual({ executable: 'npm', args: 'test' });
  });

  test('should handle env var with complex value', () => {
    const result = normalizeSegment(['NODE_ENV=production', 'npm', 'run', 'build']);
    expect(result).toEqual({ executable: 'npm', args: 'run build' });
  });

  test('should not strip args that look like env vars', () => {
    const result = normalizeSegment(['echo', 'FOO=bar']);
    expect(result).toEqual({ executable: 'echo', args: 'FOO=bar' });
  });

  test('should return null if only env vars', () => {
    const result = normalizeSegment(['FOO=bar', 'BAZ=qux']);
    expect(result).toBeNull();
  });
});

// =============================================================================
// PERM-P2-PARSE-008: Export Statement Stripping Tests
// =============================================================================
describe('normalizeSegment() - Skip Commands', () => {
  test('should skip export command', () => {
    const result = normalizeSegment(['export', 'FOO=bar']);
    expect(result).toBeNull();
  });

  test('should skip set command', () => {
    const result = normalizeSegment(['set', '-e']);
    expect(result).toBeNull();
  });

  test('should skip unset command', () => {
    const result = normalizeSegment(['unset', 'FOO']);
    expect(result).toBeNull();
  });

  test('should skip local command', () => {
    const result = normalizeSegment(['local', 'foo=bar']);
    expect(result).toBeNull();
  });

  test('should skip declare command', () => {
    const result = normalizeSegment(['declare', '-a', 'arr']);
    expect(result).toBeNull();
  });

  test('should skip typeset command', () => {
    const result = normalizeSegment(['typeset', '-i', 'num']);
    expect(result).toBeNull();
  });
});

// =============================================================================
// PERM-P2-PARSE-009: Wrapper Command Stripping Tests
// =============================================================================
describe('normalizeSegment() - Wrapper Commands', () => {
  test('should strip timeout wrapper', () => {
    const result = normalizeSegment(['timeout', '30', 'npm', 'test']);
    expect(result).toEqual({ executable: 'npm', args: 'test' });
  });

  test('should strip timeout with duration suffix', () => {
    const result = normalizeSegment(['timeout', '30s', 'npm', 'test']);
    expect(result).toEqual({ executable: 'npm', args: 'test' });
  });

  test('should strip time wrapper', () => {
    const result = normalizeSegment(['time', 'npm', 'test']);
    expect(result).toEqual({ executable: 'npm', args: 'test' });
  });

  test('should strip nice wrapper', () => {
    const result = normalizeSegment(['nice', 'npm', 'test']);
    expect(result).toEqual({ executable: 'npm', args: 'test' });
  });

  test('should strip nice with -n priority', () => {
    const result = normalizeSegment(['nice', '-n', '10', 'npm', 'test']);
    expect(result).toEqual({ executable: 'npm', args: 'test' });
  });

  test('should strip nice with numeric priority', () => {
    const result = normalizeSegment(['nice', '-10', 'npm', 'test']);
    expect(result).toEqual({ executable: 'npm', args: 'test' });
  });

  test('should strip nohup wrapper', () => {
    const result = normalizeSegment(['nohup', 'npm', 'test']);
    expect(result).toEqual({ executable: 'npm', args: 'test' });
  });

  test('should strip env wrapper', () => {
    const result = normalizeSegment(['env', 'npm', 'test']);
    expect(result).toEqual({ executable: 'npm', args: 'test' });
  });

  test('should strip env with VAR=value', () => {
    const result = normalizeSegment(['env', 'FOO=bar', 'npm', 'test']);
    expect(result).toEqual({ executable: 'npm', args: 'test' });
  });

  test('should strip multiple nested wrappers', () => {
    const result = normalizeSegment(['timeout', '30', 'nice', 'npm', 'test']);
    expect(result).toEqual({ executable: 'npm', args: 'test' });
  });
});

// =============================================================================
// PERM-P2-PARSE-010: Background Operator Stripping Tests
// =============================================================================
describe('normalizeSegment() - Background Operator', () => {
  test('should strip trailing & operator', () => {
    const result = normalizeSegment(['npm', 'test', '&']);
    expect(result).toEqual({ executable: 'npm', args: 'test' });
  });

  test('should strip multiple trailing & operators', () => {
    const result = normalizeSegment(['npm', 'test', '&', '&']);
    expect(result).toEqual({ executable: 'npm', args: 'test' });
  });
});

// =============================================================================
// PERM-P2-PARSE-011: Redirection Handling Tests
// =============================================================================
describe('normalizeSegment() - Redirections', () => {
  test('should strip output redirection', () => {
    const result = normalizeSegment(['npm', 'test', '>', 'output.log']);
    expect(result).toEqual({ executable: 'npm', args: 'test' });
  });

  test('should strip append redirection', () => {
    const result = normalizeSegment(['npm', 'test', '>>', 'output.log']);
    expect(result).toEqual({ executable: 'npm', args: 'test' });
  });

  test('should strip input redirection', () => {
    const result = normalizeSegment(['cat', '<', 'input.txt']);
    expect(result).toEqual({ executable: 'cat', args: '' });
  });

  test('should strip stderr redirection', () => {
    const result = normalizeSegment(['npm', 'test', '2>', 'errors.log']);
    expect(result).toEqual({ executable: 'npm', args: 'test' });
  });

  test('should strip combined stderr/stdout redirection', () => {
    const result = normalizeSegment(['npm', 'test', '2>&1']);
    expect(result).toEqual({ executable: 'npm', args: 'test' });
  });

  test('should strip multiple redirections', () => {
    const result = normalizeSegment(['npm', 'test', '>', 'out.log', '2>', 'err.log']);
    expect(result).toEqual({ executable: 'npm', args: 'test' });
  });
});

// =============================================================================
// PERM-P2-PARSE-012: Subshell Commands (bash -c) Tests
// =============================================================================
describe('normalizeSegment() - Subshell', () => {
  test('should extract command from bash -c', () => {
    const result = normalizeSegment(['bash', '-c', 'npm test']);
    expect(result).toEqual({ executable: 'npm', args: 'test' });
  });

  test('should extract command from sh -c', () => {
    const result = normalizeSegment(['sh', '-c', 'npm test']);
    expect(result).toEqual({ executable: 'npm', args: 'test' });
  });

  test('should handle bash -c with env vars in inner command', () => {
    const result = normalizeSegment(['bash', '-c', 'FOO=bar npm test']);
    expect(result).toEqual({ executable: 'npm', args: 'test' });
  });

  test('should return null for empty bash -c', () => {
    const result = normalizeSegment(['bash', '-c', '']);
    expect(result).toBeNull();
  });

  test('should handle bash without -c flag normally', () => {
    const result = normalizeSegment(['bash', 'script.sh']);
    expect(result).toEqual({ executable: 'bash', args: 'script.sh' });
  });
});

// =============================================================================
// PERM-P2-PARSE-013: Unsafe Construct Detection ($(), ``) Tests
// =============================================================================
describe('checkUnsafe()', () => {
  test('should throw for $() command substitution', () => {
    expect(() => checkUnsafe('echo $(whoami)')).toThrow('Command substitution $() not supported');
  });

  test('should throw for backtick command substitution', () => {
    expect(() => checkUnsafe('echo `whoami`')).toThrow('Command substitution `` not supported');
  });

  test('should not throw for normal commands', () => {
    expect(() => checkUnsafe('npm test')).not.toThrow();
  });

  test('should not throw for $ in env var', () => {
    expect(() => checkUnsafe('echo $HOME')).not.toThrow();
  });

  test('should handle null/empty input', () => {
    expect(() => checkUnsafe(null)).not.toThrow();
    expect(() => checkUnsafe('')).not.toThrow();
  });
});

// =============================================================================
// PERM-P2-PARSE-014: Heredoc Detection Tests
// =============================================================================
describe('checkUnsafe() - Heredocs', () => {
  test('should throw for heredocs', () => {
    expect(() => checkUnsafe('cat << EOF')).toThrow('Heredocs not supported');
  });

  test('should throw for heredocs with delimiter', () => {
    expect(() => checkUnsafe('cat <<EOF\nhello\nEOF')).toThrow('Heredocs not supported');
  });

  test('should throw for heredocs with -', () => {
    expect(() => checkUnsafe('cat <<-EOF')).toThrow('Heredocs not supported');
  });
});

describe('checkUnsafe() - Process Substitution', () => {
  test('should throw for <() process substitution', () => {
    expect(() => checkUnsafe('diff <(cmd1) <(cmd2)')).toThrow('Process substitution not supported');
  });

  test('should throw for >() process substitution', () => {
    expect(() => checkUnsafe('tee >(cmd1)')).toThrow('Process substitution not supported');
  });
});

// =============================================================================
// PERM-P2-PARSE-015: Core Command Extraction Tests
// =============================================================================
describe('normalizeSegment() - Core Extraction', () => {
  test('should return null for empty input', () => {
    expect(normalizeSegment([])).toBeNull();
    expect(normalizeSegment(null)).toBeNull();
  });

  test('should extract simple command', () => {
    const result = normalizeSegment(['npm', 'test']);
    expect(result).toEqual({ executable: 'npm', args: 'test' });
  });

  test('should extract command with no args', () => {
    const result = normalizeSegment(['ls']);
    expect(result).toEqual({ executable: 'ls', args: '' });
  });

  test('should extract command with multiple args', () => {
    const result = normalizeSegment(['git', 'commit', '-m', 'message']);
    expect(result).toEqual({ executable: 'git', args: 'commit -m message' });
  });

  test('should handle complex normalization', () => {
    const result = normalizeSegment(['FOO=bar', 'timeout', '30', 'npm', 'test', '>', 'log', '&']);
    expect(result).toEqual({ executable: 'npm', args: 'test' });
  });
});

// =============================================================================
// PERM-P2-PARSE-016: parseCommand() Module Tests
// =============================================================================
describe('parseCommand()', () => {
  test('should return empty array for empty input', () => {
    expect(parseCommand('')).toEqual([]);
    expect(parseCommand(null)).toEqual([]);
    expect(parseCommand(undefined)).toEqual([]);
    expect(parseCommand('   ')).toEqual([]);
  });

  test('should parse simple command', () => {
    const result = parseCommand('npm test');
    expect(result).toEqual([{ executable: 'npm', args: 'test' }]);
  });

  test('should parse chained commands', () => {
    const result = parseCommand('git add . && git commit -m "msg"');
    expect(result).toEqual([
      { executable: 'git', args: 'add .' },
      { executable: 'git', args: 'commit -m msg' }
    ]);
  });

  test('should parse piped commands', () => {
    const result = parseCommand('npm test | tee output.log');
    expect(result).toEqual([
      { executable: 'npm', args: 'test' },
      { executable: 'tee', args: 'output.log' }
    ]);
  });

  test('should skip export statements in chain', () => {
    const result = parseCommand('export FOO=bar && npm test');
    expect(result).toEqual([{ executable: 'npm', args: 'test' }]);
  });

  test('should strip env vars from command', () => {
    const result = parseCommand('API_KEY=x npm test');
    expect(result).toEqual([{ executable: 'npm', args: 'test' }]);
  });

  test('should strip timeout wrapper', () => {
    const result = parseCommand('timeout 30 npm test');
    expect(result).toEqual([{ executable: 'npm', args: 'test' }]);
  });

  test('should extract from bash -c', () => {
    const result = parseCommand('bash -c "npm test"');
    expect(result).toEqual([{ executable: 'npm', args: 'test' }]);
  });

  test('should throw for command substitution', () => {
    expect(() => parseCommand('echo $(whoami)')).toThrow();
  });

  test('should throw for backticks', () => {
    expect(() => parseCommand('echo `whoami`')).toThrow();
  });

  test('should throw for heredocs', () => {
    expect(() => parseCommand('cat << EOF')).toThrow();
  });
});

// =============================================================================
// PERM-P2-PARSE-017 & 018: Integration Tests from TRD Appendix A
// =============================================================================
describe('parseCommand() - TRD Test Cases (Appendix A)', () => {
  test('npm test', () => {
    const result = parseCommand('npm test');
    expect(result).toEqual([{ executable: 'npm', args: 'test' }]);
  });

  test('API_KEY=x npm test', () => {
    const result = parseCommand('API_KEY=x npm test');
    expect(result).toEqual([{ executable: 'npm', args: 'test' }]);
  });

  test('export FOO=bar && npm test', () => {
    const result = parseCommand('export FOO=bar && npm test');
    expect(result).toEqual([{ executable: 'npm', args: 'test' }]);
  });

  test('timeout 30 npm test', () => {
    const result = parseCommand('timeout 30 npm test');
    expect(result).toEqual([{ executable: 'npm', args: 'test' }]);
  });

  test('git add . && git commit -m "msg"', () => {
    const result = parseCommand('git add . && git commit -m "msg"');
    expect(result).toEqual([
      { executable: 'git', args: 'add .' },
      { executable: 'git', args: 'commit -m msg' }
    ]);
  });

  test('npm test | tee output.log', () => {
    const result = parseCommand('npm test | tee output.log');
    expect(result).toEqual([
      { executable: 'npm', args: 'test' },
      { executable: 'tee', args: 'output.log' }
    ]);
  });

  test('bash -c "npm test"', () => {
    const result = parseCommand('bash -c "npm test"');
    expect(result).toEqual([{ executable: 'npm', args: 'test' }]);
  });

  test('NODE_ENV=test npm run build', () => {
    const result = parseCommand('NODE_ENV=test npm run build');
    expect(result).toEqual([{ executable: 'npm', args: 'run build' }]);
  });
});

// =============================================================================
// Edge Cases and Complex Scenarios
// =============================================================================
describe('parseCommand() - Edge Cases', () => {
  test('should handle command with only whitespace args', () => {
    const result = parseCommand('echo');
    expect(result).toEqual([{ executable: 'echo', args: '' }]);
  });

  test('should handle multiple semicolons', () => {
    const result = parseCommand('cmd1; cmd2; cmd3');
    expect(result).toEqual([
      { executable: 'cmd1', args: '' },
      { executable: 'cmd2', args: '' },
      { executable: 'cmd3', args: '' }
    ]);
  });

  test('should handle OR operator', () => {
    const result = parseCommand('false || true');
    expect(result).toEqual([
      { executable: 'false', args: '' },
      { executable: 'true', args: '' }
    ]);
  });

  test('should handle mix of && and ||', () => {
    const result = parseCommand('cmd1 && cmd2 || cmd3');
    expect(result).toEqual([
      { executable: 'cmd1', args: '' },
      { executable: 'cmd2', args: '' },
      { executable: 'cmd3', args: '' }
    ]);
  });

  test('should handle quoted path with spaces', () => {
    const result = parseCommand('cd "path with spaces"');
    expect(result).toEqual([{ executable: 'cd', args: 'path with spaces' }]);
  });

  test('should handle single-quoted argument', () => {
    const result = parseCommand("git commit -m 'my message'");
    expect(result).toEqual([{ executable: 'git', args: 'commit -m my message' }]);
  });

  test('should handle mixed wrappers and env vars', () => {
    const result = parseCommand('FOO=1 BAR=2 timeout 60 nice -n 5 npm test');
    expect(result).toEqual([{ executable: 'npm', args: 'test' }]);
  });

  test('should handle nohup with background', () => {
    const result = parseCommand('nohup npm start &');
    expect(result).toEqual([{ executable: 'npm', args: 'start' }]);
  });

  test('should handle complex pipeline', () => {
    const result = parseCommand('cat file.txt | grep pattern | wc -l');
    expect(result).toEqual([
      { executable: 'cat', args: 'file.txt' },
      { executable: 'grep', args: 'pattern' },
      { executable: 'wc', args: '-l' }
    ]);
  });
});

// =============================================================================
// Constants Export Tests
// =============================================================================
describe('Module Exports', () => {
  test('should export WRAPPER_COMMANDS set', () => {
    expect(WRAPPER_COMMANDS).toBeInstanceOf(Set);
    expect(WRAPPER_COMMANDS.has('timeout')).toBe(true);
    expect(WRAPPER_COMMANDS.has('time')).toBe(true);
    expect(WRAPPER_COMMANDS.has('nice')).toBe(true);
    expect(WRAPPER_COMMANDS.has('nohup')).toBe(true);
    expect(WRAPPER_COMMANDS.has('env')).toBe(true);
  });

  test('should export SKIP_COMMANDS set', () => {
    expect(SKIP_COMMANDS).toBeInstanceOf(Set);
    expect(SKIP_COMMANDS.has('export')).toBe(true);
    expect(SKIP_COMMANDS.has('set')).toBe(true);
    expect(SKIP_COMMANDS.has('unset')).toBe(true);
    expect(SKIP_COMMANDS.has('local')).toBe(true);
    expect(SKIP_COMMANDS.has('declare')).toBe(true);
    expect(SKIP_COMMANDS.has('typeset')).toBe(true);
  });

  test('should export OPERATORS set', () => {
    expect(OPERATORS).toBeInstanceOf(Set);
    expect(OPERATORS.has('&&')).toBe(true);
    expect(OPERATORS.has('||')).toBe(true);
    expect(OPERATORS.has(';')).toBe(true);
    expect(OPERATORS.has('|')).toBe(true);
  });
});
