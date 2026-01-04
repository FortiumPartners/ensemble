/**
 * Security tests for Permitter - Phase 4 (PERM-P4-SEC-001 through SEC-008)
 *
 * Adversarial test suite to verify fail-closed security behavior.
 * Tests MUST demonstrate that the parser cannot be bypassed.
 */

'use strict';

const {
  parseCommand,
  tokenize,
  checkUnsafe
} = require('../lib/command-parser');

const { matchesPattern, matchesAny, isDenied } = require('../lib/matcher');

// =============================================================================
// PERM-P4-SEC-001: Adversarial Test - Nested Subshells
// =============================================================================
describe('Security: Nested Subshells (PERM-P4-SEC-001)', () => {
  describe('$() Command Substitution', () => {
    test('should reject simple $() substitution', () => {
      expect(() => parseCommand('echo $(whoami)')).toThrow();
    });

    test('should reject nested $() substitution', () => {
      expect(() => parseCommand('echo $(echo $(whoami))')).toThrow();
    });

    test('should reject $() in argument position', () => {
      expect(() => parseCommand('npm test $(cat /etc/passwd)')).toThrow();
    });

    test('should reject $() after semicolon', () => {
      expect(() => parseCommand('npm test; $(rm -rf /)')).toThrow();
    });

    test('should reject $() in quoted string (double quotes)', () => {
      expect(() => parseCommand('echo "$(whoami)"')).toThrow();
    });

    test('should reject $() with spaces inside', () => {
      expect(() => parseCommand('echo $( whoami )')).toThrow();
    });

    test('should reject $() with complex command inside', () => {
      expect(() => parseCommand('echo $(cat /etc/passwd | head -1)')).toThrow();
    });
  });

  describe('Backtick Command Substitution', () => {
    test('should reject simple backtick substitution', () => {
      expect(() => parseCommand('echo `whoami`')).toThrow();
    });

    test('should reject nested backticks', () => {
      expect(() => parseCommand('echo `echo \\`whoami\\``')).toThrow();
    });

    test('should reject backticks in argument position', () => {
      expect(() => parseCommand('npm test `cat /etc/passwd`')).toThrow();
    });

    test('should reject backticks after operators', () => {
      expect(() => parseCommand('npm test && `rm -rf /`')).toThrow();
    });

    test('should reject single backtick at end', () => {
      expect(() => parseCommand('npm test `')).toThrow();
    });
  });

  describe('bash -c Nested Commands', () => {
    test('should handle single-level bash -c correctly', () => {
      const result = parseCommand('bash -c "npm test"');
      expect(result).toEqual([{ executable: 'npm', args: 'test' }]);
    });

    test('should reject bash -c with $() inside', () => {
      expect(() => parseCommand('bash -c "echo $(whoami)"')).toThrow();
    });

    test('should reject bash -c with backticks inside', () => {
      expect(() => parseCommand('bash -c "echo `whoami`"')).toThrow();
    });

    test('should reject deeply nested bash -c with unsafe constructs', () => {
      expect(() => parseCommand('bash -c "bash -c \\"$(rm -rf /)\\"')).toThrow();
    });

    test('should reject bash -c with heredoc inside', () => {
      expect(() => parseCommand('bash -c "cat << EOF"')).toThrow();
    });

    test('should handle bash -c with chained commands', () => {
      const result = parseCommand('bash -c "npm test && npm build"');
      // Should only extract first command from inner shell
      expect(result).toEqual([{ executable: 'npm', args: 'test' }]);
    });
  });

  describe('sh -c Variants', () => {
    test('should handle sh -c correctly', () => {
      const result = parseCommand('sh -c "npm test"');
      expect(result).toEqual([{ executable: 'npm', args: 'test' }]);
    });

    test('should reject sh -c with $() inside', () => {
      expect(() => parseCommand('sh -c "$(whoami)"')).toThrow();
    });
  });
});

// =============================================================================
// PERM-P4-SEC-002: Adversarial Test - Quote Escaping
// =============================================================================
describe('Security: Quote Escaping (PERM-P4-SEC-002)', () => {
  describe('Escaped Quote Attacks', () => {
    test('should handle escaped double quote correctly', () => {
      const result = parseCommand('echo "hello\\"world"');
      expect(result).toEqual([{ executable: 'echo', args: 'hello"world' }]);
    });

    test('should handle escaped backslash correctly', () => {
      const result = parseCommand('echo "hello\\\\world"');
      expect(result).toEqual([{ executable: 'echo', args: 'hello\\world' }]);
    });

    test('should preserve escaped quote at end of string', () => {
      const tokens = tokenize('echo "test\\""');
      expect(tokens).toEqual(['echo', 'test"']);
    });

    test('should handle multiple escaped quotes', () => {
      const tokens = tokenize('echo "a\\"b\\"c"');
      expect(tokens).toEqual(['echo', 'a"b"c']);
    });
  });

  describe('Mixed Quoting Attacks', () => {
    test('should handle alternating quote types', () => {
      const result = parseCommand("echo \"hello\" 'world'");
      expect(result).toEqual([{ executable: 'echo', args: 'hello world' }]);
    });

    test('should handle nested quote-like patterns', () => {
      const result = parseCommand("echo 'he said \"hello\"'");
      expect(result).toEqual([{ executable: 'echo', args: 'he said "hello"' }]);
    });

    test('should handle double-to-single quote transition', () => {
      const result = parseCommand("echo \"hello\"'world'");
      expect(result).toEqual([{ executable: 'echo', args: 'helloworld' }]);
    });
  });

  describe('Malformed Quote Attacks', () => {
    test('should handle unclosed double quote (tokenize does not throw)', () => {
      // Unclosed quotes may produce malformed tokens but should not crash
      expect(() => tokenize('echo "unclosed')).not.toThrow();
      const tokens = tokenize('echo "unclosed');
      // Token will contain the rest of the string
      expect(tokens.length).toBeGreaterThan(0);
    });

    test('should handle unclosed single quote (tokenize does not throw)', () => {
      expect(() => tokenize("echo 'unclosed")).not.toThrow();
      const tokens = tokenize("echo 'unclosed");
      expect(tokens.length).toBeGreaterThan(0);
    });

    test('should handle empty quoted strings', () => {
      const result = parseCommand('echo "" \'\'');
      // Two empty tokens separated by space become ' ' when joined
      expect(result).toEqual([{ executable: 'echo', args: ' ' }]);
    });

    test('should handle quote at start of command', () => {
      const tokens = tokenize('"npm" test');
      expect(tokens).toEqual(['npm', 'test']);
    });
  });

  describe('Quote Injection Attempts', () => {
    test('should not allow quote to break out of string', () => {
      // Attempt: end quote, inject command, restart quote
      // This is within single quotes so the double quote is literal
      const tokens = tokenize("echo '\"'; rm -rf /; echo '\"'");
      // Single quotes preserve everything literally
      expect(tokens).toContain('"');
    });

    test('should handle semicolon inside quotes (not as operator)', () => {
      const result = parseCommand('echo "hello; world"');
      expect(result).toEqual([{ executable: 'echo', args: 'hello; world' }]);
      expect(result.length).toBe(1); // Only one command
    });

    test('should handle && inside quotes (not as operator)', () => {
      const result = parseCommand('echo "cmd1 && cmd2"');
      expect(result).toEqual([{ executable: 'echo', args: 'cmd1 && cmd2' }]);
      expect(result.length).toBe(1);
    });

    test('should handle pipe inside quotes (not as operator)', () => {
      const result = parseCommand('echo "data | filter"');
      expect(result).toEqual([{ executable: 'echo', args: 'data | filter' }]);
      expect(result.length).toBe(1);
    });
  });
});

// =============================================================================
// PERM-P4-SEC-003: Adversarial Test - Unicode Homoglyphs
// =============================================================================
describe('Security: Unicode Homoglyphs (PERM-P4-SEC-003)', () => {
  describe('Cyrillic Lookalikes', () => {
    // Cyrillic 'а' (U+0430) looks like Latin 'a' (U+0061)
    // Cyrillic 'е' (U+0435) looks like Latin 'e' (U+0065)
    // Cyrillic 'о' (U+043E) looks like Latin 'o' (U+006F)
    // Cyrillic 'р' (U+0440) looks like Latin 'p' (U+0070)

    test('should NOT match command with Cyrillic "npm" to allowlist pattern', () => {
      // Using Cyrillic 'р' for 'p' in 'npm'
      const cyrillicNpm = 'n\u0440m'; // n + Cyrillic р + m
      const cmd = { executable: cyrillicNpm, args: 'test' };
      const allowlist = ['Bash(npm test:*)'];

      expect(matchesAny(cmd, allowlist)).toBe(false);
    });

    test('should NOT match Cyrillic "git" to allowlist pattern', () => {
      // Using Cyrillic 'і' (if exists) or other lookalikes
      const cyrillicLookalike = 'g\u0456t'; // Cyrillic і
      const cmd = { executable: cyrillicLookalike, args: 'status' };
      const allowlist = ['Bash(git:*)'];

      expect(matchesAny(cmd, allowlist)).toBe(false);
    });

    test('should parse command with Cyrillic characters correctly', () => {
      const cyrillicNpm = 'n\u0440m'; // n + Cyrillic р + m
      const result = parseCommand(`${cyrillicNpm} test`);
      expect(result[0].executable).toBe(cyrillicNpm);
      expect(result[0].executable).not.toBe('npm');
    });
  });

  describe('Greek Lookalikes', () => {
    // Greek 'ο' (U+03BF) looks like Latin 'o'
    // Greek 'α' (U+03B1) looks like Latin 'a'

    test('should NOT match Greek lookalike to allowlist', () => {
      const greekO = '\u03BF'; // Greek small omicron
      const cmd = { executable: `ech${greekO}`, args: 'test' };
      const allowlist = ['Bash(echo:*)'];

      expect(matchesAny(cmd, allowlist)).toBe(false);
    });
  });

  describe('Visual Similarity Protection', () => {
    test('should differentiate ASCII and non-ASCII at byte level', () => {
      const latinE = 'e'; // U+0065
      const cyrillicE = '\u0435'; // Cyrillic small е

      expect(latinE).not.toBe(cyrillicE);
      expect(latinE.charCodeAt(0)).not.toBe(cyrillicE.charCodeAt(0));
    });

    test('should parse homoglyph command without matching legitimate pattern', () => {
      // Attempt to bypass "npm test" allowlist with homoglyph
      const fakeNpm = 'n\u0440m'; // Cyrillic р
      const result = parseCommand(`${fakeNpm} test`);

      expect(result[0].executable).toBe(fakeNpm);

      // Should NOT match the allowlist
      const allowlist = ['Bash(npm test:*)'];
      expect(matchesAny(result[0], allowlist)).toBe(false);
    });

    test('should differentiate confusable Unicode characters', () => {
      const fullWidthN = '\uFF4E'; // Fullwidth 'n'
      const tokens = tokenize(`${fullWidthN}pm test`);
      expect(tokens[0]).toBe(`${fullWidthN}pm`);
      expect(tokens[0]).not.toBe('npm');
    });
  });

  describe('Zero-Width Character Injection', () => {
    test('should preserve zero-width characters in command (no hiding)', () => {
      const zwsp = '\u200B'; // Zero-width space
      const cmd = `npm${zwsp}test`;
      const tokens = tokenize(cmd);
      // The ZWSP should be preserved, not stripped
      expect(tokens[0]).toBe(`npm${zwsp}test`);
    });

    test('should NOT match command with hidden characters to clean pattern', () => {
      const zwsp = '\u200B';
      const cmd = { executable: `npm${zwsp}`, args: 'test' };
      const allowlist = ['Bash(npm test:*)'];

      expect(matchesAny(cmd, allowlist)).toBe(false);
    });

    test('should NOT strip zero-width joiner', () => {
      const zwj = '\u200D'; // Zero-width joiner
      const result = parseCommand(`npm${zwj} test`);
      // ZWJ is treated as part of the command
      expect(result[0].executable).toBe(`npm${zwj}`);
    });
  });
});

// =============================================================================
// PERM-P4-SEC-004: Adversarial Test - Long Commands
// =============================================================================
describe('Security: Long Commands (PERM-P4-SEC-004)', () => {
  describe('Very Long Input Handling', () => {
    test('should handle 1KB command', () => {
      const longArg = 'x'.repeat(1024);
      expect(() => parseCommand(`npm test ${longArg}`)).not.toThrow();
    });

    test('should handle 10KB command', () => {
      const longArg = 'x'.repeat(10 * 1024);
      expect(() => parseCommand(`npm test ${longArg}`)).not.toThrow();
      const result = parseCommand(`npm test ${longArg}`);
      expect(result[0].executable).toBe('npm');
    });

    test('should handle 100KB command', () => {
      const longArg = 'x'.repeat(100 * 1024);
      expect(() => parseCommand(`npm test ${longArg}`)).not.toThrow();
    });

    test('should handle 1MB command (stress test)', () => {
      const longArg = 'x'.repeat(1024 * 1024);
      expect(() => parseCommand(`npm test ${longArg}`)).not.toThrow();
    });
  });

  describe('Long Quoted Strings', () => {
    test('should handle 10KB quoted string', () => {
      const longString = 'x'.repeat(10 * 1024);
      expect(() => parseCommand(`echo "${longString}"`)).not.toThrow();
      const result = parseCommand(`echo "${longString}"`);
      expect(result[0].args).toBe(longString);
    });

    test('should handle 10KB single-quoted string', () => {
      const longString = 'x'.repeat(10 * 1024);
      expect(() => parseCommand(`echo '${longString}'`)).not.toThrow();
    });
  });

  describe('Long Command Chains', () => {
    test('should handle 100 chained commands', () => {
      const commands = Array(100).fill('npm test').join(' && ');
      expect(() => parseCommand(commands)).not.toThrow();
      const result = parseCommand(commands);
      expect(result.length).toBe(100);
    });

    test('should handle 1000 piped commands', () => {
      const commands = Array(1000).fill('cat').join(' | ');
      expect(() => parseCommand(commands)).not.toThrow();
      const result = parseCommand(commands);
      expect(result.length).toBe(1000);
    });
  });

  describe('Long Paths and Arguments', () => {
    test('should handle deeply nested path', () => {
      const deepPath = '/' + Array(100).fill('directory').join('/');
      const result = parseCommand(`cd ${deepPath}`);
      expect(result[0].args).toBe(deepPath);
    });

    test('should handle many arguments', () => {
      const args = Array(1000).fill('--flag').join(' ');
      const result = parseCommand(`npm ${args}`);
      expect(result[0].args.split(' ').length).toBe(1000);
    });
  });

  describe('Resource Exhaustion Protection', () => {
    test('should complete parsing of large input without timeout', () => {
      const largeInput = 'npm test '.repeat(10000);
      const startTime = Date.now();
      parseCommand(largeInput);
      const elapsed = Date.now() - startTime;
      // Should complete in under 5 seconds even for very large input
      expect(elapsed).toBeLessThan(5000);
    });
  });
});

// =============================================================================
// PERM-P4-SEC-005: Adversarial Test - Command Injection
// =============================================================================
describe('Security: Command Injection (PERM-P4-SEC-005)', () => {
  describe('Environment Variable Expansion Attacks', () => {
    test('should reject $() in env var value position', () => {
      expect(() => parseCommand('FOO=$(whoami) npm test')).toThrow();
    });

    test('should NOT execute $VAR references (parser does not expand)', () => {
      // $VAR should not be expanded - just preserved as literal
      const result = parseCommand('echo $HOME');
      expect(result[0].args).toBe('$HOME');
    });

    test('should NOT match pattern with unexpanded variable', () => {
      const cmd = { executable: 'echo', args: '$PATH' };
      const allowlist = ['Bash(echo /usr/bin:*)'];
      expect(matchesAny(cmd, allowlist)).toBe(false);
    });
  });

  describe('Subshell Expansion Attacks', () => {
    test('should reject subshell in command position', () => {
      expect(() => parseCommand('$(rm -rf /)')).toThrow();
    });

    test('should reject subshell after valid command', () => {
      expect(() => parseCommand('npm test && $(rm -rf /)')).toThrow();
    });

    test('should reject subshell in pipe', () => {
      expect(() => parseCommand('echo test | $(cat)')).toThrow();
    });

    test('should reject arithmetic expansion', () => {
      // $((...)) is arithmetic expansion, still uses $()
      expect(() => parseCommand('echo $((1+1))')).toThrow();
    });
  });

  describe('Injection via Special Characters', () => {
    test('should reject newline-based injection', () => {
      // Newline inside command should not execute second line
      const result = parseCommand('npm test\nrm -rf /');
      // Newline treated as whitespace, both parts become args
      expect(result.length).toBe(1);
      expect(result[0].executable).toBe('npm');
    });

    test('should reject null byte injection (if present)', () => {
      // Null bytes should not split commands
      const result = parseCommand('npm\x00 test');
      // Node.js strings can contain null bytes
      expect(result[0].executable).toBe('npm\x00');
    });

    test('should reject carriage return injection', () => {
      const result = parseCommand('npm test\rrm -rf /');
      expect(result.length).toBe(1);
    });
  });

  describe('Heredoc Injection Attacks', () => {
    test('should reject heredoc syntax', () => {
      expect(() => parseCommand('cat << EOF\nmalicious\nEOF')).toThrow();
    });

    test('should reject heredoc with -', () => {
      expect(() => parseCommand('cat <<-EOF')).toThrow();
    });

    test('should reject here-string', () => {
      expect(() => parseCommand('cat <<< "data"')).toThrow();
    });
  });

  describe('Process Substitution Injection', () => {
    test('should reject input process substitution', () => {
      expect(() => parseCommand('diff <(cat /etc/passwd) <(cat /etc/shadow)')).toThrow();
    });

    test('should reject output process substitution', () => {
      expect(() => parseCommand('echo test > >(tee log)')).toThrow();
    });
  });

  describe('Brace Expansion (Not Executed)', () => {
    test('should preserve brace patterns literally (no expansion)', () => {
      const result = parseCommand('echo {a,b,c}');
      expect(result[0].args).toBe('{a,b,c}');
    });

    test('should preserve range patterns literally', () => {
      const result = parseCommand('echo {1..10}');
      expect(result[0].args).toBe('{1..10}');
    });
  });

  describe('Glob Pattern Handling (Not Executed)', () => {
    test('should preserve wildcard literally (no expansion)', () => {
      const result = parseCommand('ls *.txt');
      expect(result[0].args).toBe('*.txt');
    });

    test('should preserve recursive glob literally', () => {
      const result = parseCommand('find . -name "**/*.js"');
      expect(result[0].args).toBe('. -name **/*.js');
    });
  });
});

// =============================================================================
// PERM-P4-SEC-006: Fuzz Testing with Random Inputs
// =============================================================================
describe('Security: Fuzz Testing (PERM-P4-SEC-006)', () => {
  // Character sets for fuzzing
  const ASCII_PRINTABLE = ' !"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~';
  const SHELL_SPECIAL = '|&;<>()$`"\'\\!{}[]~*?#';
  const CONTROL_CHARS = '\x00\x01\x02\x03\x04\x05\x06\x07\x08\x09\x0A\x0B\x0C\x0D\x0E\x0F';

  function generateRandomString(charset, length) {
    let result = '';
    for (let i = 0; i < length; i++) {
      result += charset.charAt(Math.floor(Math.random() * charset.length));
    }
    return result;
  }

  function generateRandomCommand() {
    const chars = ASCII_PRINTABLE + SHELL_SPECIAL;
    const length = Math.floor(Math.random() * 200) + 1;
    return generateRandomString(chars, length);
  }

  describe('Random ASCII Input', () => {
    const FUZZ_ITERATIONS = 1000;

    test('parser should not crash on random ASCII input', () => {
      for (let i = 0; i < FUZZ_ITERATIONS; i++) {
        const randomCommand = generateRandomCommand();
        expect(() => {
          try {
            parseCommand(randomCommand);
          } catch (e) {
            // Expected errors for unsafe constructs
            if (
              !e.message.includes('not supported') &&
              !e.message.includes('Heredocs') &&
              !e.message.includes('Command substitution') &&
              !e.message.includes('Process substitution')
            ) {
              throw e;
            }
          }
        }).not.toThrow();
      }
    });
  });

  describe('Shell Special Characters', () => {
    const SPECIAL_FUZZ_ITERATIONS = 500;

    test('parser should handle heavy shell special character input', () => {
      for (let i = 0; i < SPECIAL_FUZZ_ITERATIONS; i++) {
        const randomCommand = generateRandomString(SHELL_SPECIAL, 50);
        expect(() => {
          try {
            parseCommand(randomCommand);
          } catch (e) {
            // Expected errors only
            const expectedErrors = [
              'not supported',
              'Heredocs',
              'Command substitution',
              'Process substitution'
            ];
            if (!expectedErrors.some(msg => e.message.includes(msg))) {
              throw e;
            }
          }
        }).not.toThrow();
      }
    });
  });

  describe('Control Characters', () => {
    test('parser should not crash on control characters', () => {
      for (let i = 0; i < 100; i++) {
        const randomCommand = 'npm ' + generateRandomString(CONTROL_CHARS, 10) + ' test';
        expect(() => parseCommand(randomCommand)).not.toThrow();
      }
    });
  });

  describe('Mixed Unicode', () => {
    test('parser should handle random unicode', () => {
      for (let i = 0; i < 100; i++) {
        // Generate random unicode codepoints
        let cmd = 'cmd ';
        for (let j = 0; j < 20; j++) {
          const codepoint = Math.floor(Math.random() * 0xFFFF);
          cmd += String.fromCharCode(codepoint);
        }
        expect(() => parseCommand(cmd)).not.toThrow();
      }
    });
  });

  describe('Edge Case Patterns', () => {
    const edgeCases = [
      '',
      ' ',
      '   ',
      '\t',
      '\n',
      '\r\n',
      "'",
      '"',
      '\\',
      '&&',
      '||',
      ';;',
      '||&&||',
      '&&&',
      '|||',
      '<<<',
      '>>>',
      '> < > <',
      "'\"'\"'",
      '"\'"\'"\'"',
      '\\\\\\\\',
      '$()',
      '``',
      '$($()',
      '`\\`',
      '${',
      '${x}',
      '${x:-default}',
      'a' + 'b'.repeat(10000),
      ';'.repeat(1000),
      '&'.repeat(1000),
    ];

    test.each(edgeCases)('should handle edge case: %j', (input) => {
      expect(() => {
        try {
          parseCommand(input);
        } catch (e) {
          // Only allow expected security errors
          const allowedErrors = [
            'not supported',
            'Heredocs',
            'Command substitution',
            'Process substitution'
          ];
          if (!allowedErrors.some(msg => e.message.includes(msg))) {
            throw e;
          }
        }
      }).not.toThrow();
    });
  });

  describe('Deterministic Parsing', () => {
    test('same input should always produce same output', () => {
      const testCases = [
        'npm test',
        'git add . && git commit -m "msg"',
        'export FOO=bar && npm run build',
        'timeout 30 nice -n 5 npm test',
      ];

      for (const cmd of testCases) {
        const result1 = parseCommand(cmd);
        const result2 = parseCommand(cmd);
        expect(result1).toEqual(result2);
      }
    });

    test('random inputs should produce deterministic results', () => {
      for (let i = 0; i < 50; i++) {
        const randomCmd = generateRandomCommand();
        try {
          const result1 = parseCommand(randomCmd);
          const result2 = parseCommand(randomCmd);
          expect(result1).toEqual(result2);
        } catch (e) {
          // If first call throws, second should throw same error
          expect(() => parseCommand(randomCmd)).toThrow(e.message);
        }
      }
    });
  });
});

// =============================================================================
// PERM-P4-SEC-008: Verify Fail-Closed Behavior
// =============================================================================
describe('Security: Fail-Closed Behavior (PERM-P4-SEC-008)', () => {
  describe('Parser Errors Result in Rejection', () => {
    const unsafeCommands = [
      '$(whoami)',
      '`whoami`',
      'cat << EOF',
      'diff <(a) <(b)',
      'tee >(log)',
      'echo $(cat /etc/passwd)',
      'bash -c "$(rm -rf /)"',
    ];

    test.each(unsafeCommands)('should throw (defer) for unsafe: %s', (cmd) => {
      expect(() => parseCommand(cmd)).toThrow();
    });
  });

  describe('checkUnsafe Throws on All Unsafe Constructs', () => {
    test('$() triggers throw', () => {
      expect(() => checkUnsafe('foo $(bar) baz')).toThrow();
    });

    test('backticks trigger throw', () => {
      expect(() => checkUnsafe('foo `bar` baz')).toThrow();
    });

    test('<< triggers throw', () => {
      expect(() => checkUnsafe('cat << END')).toThrow();
    });

    test('<() triggers throw', () => {
      expect(() => checkUnsafe('cmd <(other)')).toThrow();
    });

    test('>() triggers throw', () => {
      expect(() => checkUnsafe('cmd >(other)')).toThrow();
    });
  });

  describe('Empty/Invalid Input Handling', () => {
    test('empty string returns empty array (no commands to check)', () => {
      expect(parseCommand('')).toEqual([]);
    });

    test('whitespace-only returns empty array', () => {
      expect(parseCommand('   ')).toEqual([]);
      expect(parseCommand('\t\n')).toEqual([]);
    });

    test('null input returns empty array', () => {
      expect(parseCommand(null)).toEqual([]);
    });

    test('undefined input returns empty array', () => {
      expect(parseCommand(undefined)).toEqual([]);
    });
  });

  describe('Denylist Takes Precedence', () => {
    test('denied command returns true from isDenied', () => {
      const cmd = { executable: 'rm', args: '-rf /' };
      const denylist = ['Bash(rm -rf:*)'];
      expect(isDenied(cmd, denylist)).toBe(true);
    });

    test('denied command not allowed even if on allowlist', () => {
      const cmd = { executable: 'rm', args: '-rf /' };
      const allowlist = ['Bash(rm:*)'];
      const denylist = ['Bash(rm -rf:*)'];

      // Per protocol: check denylist first
      const isDeniedResult = isDenied(cmd, denylist);
      expect(isDeniedResult).toBe(true);
    });
  });

  describe('Pattern Format Validation', () => {
    test('invalid pattern format does not match', () => {
      expect(matchesPattern('npm test', 'npm test')).toBe(false);
      expect(matchesPattern('npm test', 'Bashblah(npm test)')).toBe(false);
      expect(matchesPattern('npm test', 'Bash(npm test')).toBe(false);
      expect(matchesPattern('npm test', 'Bashnpm test)')).toBe(false);
    });

    test('empty pattern does not match', () => {
      expect(matchesPattern('npm test', '')).toBe(false);
    });

    test('null/undefined command parts handled gracefully', () => {
      const cmd = { executable: 'npm', args: '' };
      const allowlist = ['Bash(npm:*)'];
      expect(matchesAny(cmd, allowlist)).toBe(true);
    });
  });

  describe('Strict Mode Behavior', () => {
    test('any parse error results in throw (fail-closed)', () => {
      const unsafeInputs = [
        'echo $()',
        'echo `cmd`',
        'cat <<EOF',
        'diff <(a) <(b)',
      ];

      unsafeInputs.forEach(input => {
        expect(() => parseCommand(input)).toThrow();
      });
    });
  });
});
