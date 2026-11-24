/**
 * Command parser module for Permitter.
 *
 * Handles:
 * - Shell tokenization with quote handling
 * - Operator detection (&&, ||, ;, |)
 * - Environment variable stripping
 * - Wrapper command stripping (timeout, env, etc.)
 * - Subshell extraction (bash -c "...")
 *
 * @module command-parser
 */

'use strict';

// Commands that are wrappers and should be stripped
const WRAPPER_COMMANDS = new Set(['timeout', 'time', 'nice', 'nohup', 'env']);

// Commands that run another command with privileges or in another shell
// context. A shell -c behind one of them hides the command line it runs from
// the allowlist, so it is refused instead of being judged by the prefix.
const COMMAND_PREFIX_COMMANDS = new Set(['sudo', 'doas', 'command']);

// Shells that take a command line as the argument after -c. That command line
// is a command line in its own right, so it is parsed and judged like the
// outer one instead of hiding behind the shell.
const SHELL_EXECUTABLES = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh', 'ash', 'mksh']);

// Directories whose executables are the system shells. A shell called by a
// path outside them is not trusted to be a shell: ./tools/bash is a program
// that happens to be called bash, and expanding it would judge the inner
// command of a program that is not the shell.
const TRUSTED_SHELL_DIRECTORIES = new Set(['/bin', '/usr/bin', '/sbin', '/usr/sbin']);

// Long shell options that name a file the shell reads before it runs the
// command. The path is chosen by whoever wrote the command, so the file is
// not judged: the invocation is refused instead.
const SHELL_STARTUP_FILE_OPTIONS = new Set(['--rcfile', '--init-file']);

// Short shell options that take no value. A letter outside this set cannot
// be read with certainty, so the invocation that carries it is refused.
const SHELL_SHORT_FLAGS = new Set([
  'a', 'B', 'e', 'h', 'H', 'i', 'I', 'l', 'm', 'n', 'p', 'r', 's', 't', 'u', 'v', 'V', 'x'
]);

// Long shell options that take no value.
const SHELL_LONG_FLAGS = new Set([
  '--debugger', '--hashall', '--help', '--histexpand', '--ignore-env', '--noediting',
  '--nolog', '--noprofile', '--norc', '--null-command', '--onecmd', '--posix',
  '--privileged', '--rbash', '--restricted', '--verbose', '--version'
]);

// Commands that are skipped entirely
const SKIP_COMMANDS = new Set(['export', 'set', 'unset', 'local', 'declare', 'typeset']);

// Skipped commands whose arguments name variables (see assertSafeSkipCommand)
const VARIABLE_COMMANDS = new Set(['export', 'unset', 'local', 'declare', 'typeset']);

// `set` options that only make the shell stricter or louder, and the names
// `-o` may take (see assertSafeSetCommand)
const SAFE_SET_FLAGS_RE = /^[-+][euxvfC]*o?$/;
const SAFE_SET_OPTION_NAMES = new Set(['errexit', 'nounset', 'xtrace', 'verbose', 'noglob', 'noclobber', 'pipefail']);

// Environment variables that change how a command is resolved or parsed.
// PATH controls executable lookup, LD_* / DYLD_* inject code into the
// process, IFS changes how words are split, BASH_ENV / ENV make a shell
// source a file before it runs anything. A command that assigns one of them
// is refused instead of having the assignment silently stripped.
const DANGEROUS_ASSIGNMENT_VARS = new Set(['PATH', 'IFS', 'BASH_ENV', 'ENV', 'ZDOTDIR']);

// An assignment word as bash reads it: NAME, optional array subscripts, `=` or
// the append form `+=`, then the value. Captures: name, subscripts, value.
const ASSIGNMENT_WORD_RE = /^([A-Za-z_][A-Za-z0-9_]*)((?:\[[^\]]*\])*)\+?=([\s\S]*)$/;

// fd duplication/close (2>&1, >&2, <&0, 2>&-). It only is one when a word
// boundary follows: for bash `>&1x` redirects to the file `1x`.
const FD_DUPLICATION_RE = /^(>>?|<)&(\d+|-)(?=$|[ \t\n;&|<>()])/;

// Operators that split commands
// '&' (background) and '|&' (pipe stdout+stderr) also start a new command.
const OPERATORS = new Set(['&&', '||', ';', '|', '&', '|&']);

// Redirection operators whose target is a file path. Only /dev/null targets are
// considered safe (see checkRedirections).
const REDIRECT_OPERATORS = new Set(['>', '>>', '<', '&>', '&>>']);

// Tokenizer states
const State = {
  NORMAL: 'NORMAL',
  SINGLE_QUOTE: 'SINGLE_QUOTE',
  DOUBLE_QUOTE: 'DOUBLE_QUOTE',
  ESCAPE: 'ESCAPE'
};

/**
 * Tokenize a Bash command string.
 *
 * Uses a state machine to properly handle:
 * - Single-quoted strings (no escaping)
 * - Double-quoted strings (backslash escaping)
 * - Unquoted whitespace as token separator
 * - Multi-character operators (&&, ||)
 * - Line continuations: backslash-newline is deleted, as the shell does
 * - Comments: a '#' that begins a word runs to the end of its line only
 *
 * ANSI-C quoting ($'...') is not implemented and is refused.
 *
 * @param {string} command - Raw command string
 * @param {{strict?: boolean}} [options] - strict: refuse a command that
 *   leaves a quote open (an open quote swallows the rest of the command, so
 *   its words cannot be classified). Lenient by default.
 * @returns {string[]} Array of tokens
 * @throws {Error} If the command uses a construct the tokenizer cannot read
 */
function tokenize(command, options = {}) {
  if (!command || typeof command !== 'string') {
    return [];
  }

  const tokens = [];
  let current = '';
  let state = State.NORMAL;
  let prevState = State.NORMAL;
  let inQuotedSection = false; // Track if we've been in a quoted section for this token
  let prevChar = ''; // Previous character the shell reads; a line continuation is not one

  for (let i = 0; i < command.length; i++) {
    const char = command[i];
    const nextChar = command[i + 1];

    switch (state) {
      case State.NORMAL:
        if (char === '\\' && nextChar === '\n') {
          // Line continuation: the shell deletes the backslash and the
          // newline before it splits words or looks for a comment, so it is
          // neither an escaped character nor a word boundary.
          i++;
          continue;
        } else if (char === '$' && nextChar === "'") {
          // ANSI-C quoting lets an escaped quote sit inside the string, so
          // this tokenizer would close the quote in the wrong place and hide
          // the rest of the command: refuse it instead of guessing.
          throw new Error("ANSI-C quoting $'...' not supported");
        } else if (char === "'") {
          // Enter single-quote mode
          state = State.SINGLE_QUOTE;
          inQuotedSection = true;
        } else if (char === '"') {
          // Enter double-quote mode
          state = State.DOUBLE_QUOTE;
          inQuotedSection = true;
        } else if (char === '\\') {
          // Escape next character
          prevState = state;
          state = State.ESCAPE;
        } else if (char === '\n' || char === '\r') {
          // Newline is a command separator, exactly like ';'
          if (current || inQuotedSection) {
            tokens.push(current);
            current = '';
            inQuotedSection = false;
          }
          tokens.push(';');
        } else if (char === '(' || char === ')') {
          // Subshell, grouping, arithmetic, function definitions
          throw new Error('Subshell/grouping not supported');
        } else if (/\s/.test(char)) {
          // Whitespace ends current token
          if (current || inQuotedSection) {
            tokens.push(current);
            current = '';
            inQuotedSection = false;
          }
        } else if (char === '#' && current === '' && (prevChar === '' || /[ \t\n;|&]/.test(prevChar))) {
          // A '#' that begins a word starts a comment that runs to the end of
          // its line. The newline is left in place so it still separates
          // commands: a later line is never swallowed by a comment, and a
          // quote character inside the comment is never read as a quote.
          // Only space, tab and newline separate words in the shell, so a '#'
          // after any other character (non-breaking space, vertical tab,
          // form feed, carriage return) is an ordinary argument and the rest
          // of the line stays a separate command.
          while (i < command.length && command[i] !== '\n') {
            i++;
          }
          i--; // the loop increment lands back on the newline (or the end)
          continue;
        } else if ((char === '>' || char === '<') && FD_DUPLICATION_RE.test(command.slice(i))) {
          // fd duplication/close such as 2>&1, >&2, <&0, 2>&-: no file involved
          const m = FD_DUPLICATION_RE.exec(command.slice(i));
          if (m[2] !== '-' && !/^[012]$/.test(m[2])) {
            // fd N>2 may be an inherited open file; its target is not analyzable
            throw new Error('Redirection to an arbitrary file descriptor not supported');
          }
          const prefix = /^\d+$/.test(current) ? current : '';
          if (current && !prefix) {
            tokens.push(current);
          }
          current = '';
          tokens.push(prefix + m[0]);
          i += m[0].length - 1;
        } else if (char === '&' && nextChar === '>') {
          // &> and &>> redirect stdout+stderr to a file
          if (current) {
            tokens.push(current);
            current = '';
          }
          if (command[i + 2] === '>') {
            tokens.push('&>>');
            i += 2;
          } else {
            tokens.push('&>');
            i++;
          }
        } else if (char === '|' && nextChar === '&') {
          if (current) {
            tokens.push(current);
            current = '';
          }
          tokens.push('|&');
          i++;
        } else if (char === '&' && nextChar === '&') {
          // && operator
          if (current) {
            tokens.push(current);
            current = '';
          }
          tokens.push('&&');
          i++; // Skip next char
        } else if (char === '|' && nextChar === '|') {
          // || operator
          if (current) {
            tokens.push(current);
            current = '';
          }
          tokens.push('||');
          i++; // Skip next char
        } else if (char === ';') {
          // ; operator
          if (current) {
            tokens.push(current);
            current = '';
          }
          tokens.push(';');
        } else if (char === '|') {
          // | operator (single pipe)
          if (current) {
            tokens.push(current);
            current = '';
          }
          tokens.push('|');
        } else if (char === '>' && nextChar === '>') {
          // >> redirection
          if (current) {
            tokens.push(current);
            current = '';
          }
          tokens.push('>>');
          i++; // Skip next char
        } else if (char === '>' || char === '<') {
          // Single redirection
          if (current) {
            tokens.push(current);
            current = '';
          }
          tokens.push(char);
        } else if (char === '&' && !/\d/.test(current) && current !== '') {
          // Background operator at end of token
          tokens.push(current);
          current = '';
          tokens.push('&');
        } else if (char === '&') {
          // Standalone & or part of fd redirect like 2>&1
          if (current) {
            tokens.push(current);
            current = '';
          }
          tokens.push('&');
        } else {
          current += char;
        }
        break;

      case State.SINGLE_QUOTE:
        if (char === "'") {
          // Exit single-quote mode (no escaping inside single quotes)
          state = State.NORMAL;
        } else {
          current += char;
        }
        break;

      case State.DOUBLE_QUOTE:
        if (char === '"') {
          // Exit double-quote mode
          state = State.NORMAL;
        } else if (char === '\\' && nextChar === '\n') {
          i++; // line continuation: the shell deletes it inside double quotes too
          continue;
        } else if (char === '\\') {
          // Escape handling inside double quotes
          prevState = state;
          state = State.ESCAPE;
        } else {
          current += char;
        }
        break;

      case State.ESCAPE:
        // Add escaped character and return to previous state
        current += char;
        state = prevState;
        break;
    }

    prevChar = command[i];
  }

  // An open quote swallows the rest of the command: a strict caller refuses it.
  if (options.strict && (state === State.ESCAPE ? prevState : state) !== State.NORMAL) {
    throw new Error('Unbalanced quote not supported');
  }

  // Handle remaining token
  if (current || inQuotedSection) {
    tokens.push(current);
  }

  return tokens;
}

/**
 * Check for unsafe constructs that should cause deferral.
 *
 * Detects:
 * - Command substitution: $() and ``
 * - Parameter expansion: ${...}
 * - ANSI-C quoting: $'...'
 * - IFS assignments (IFS=...) that can remove word separators
 * - Heredocs: <<
 * - Process substitution: <() and >()
 *
 * @param {string} command - Raw command string
 * @throws {Error} If unsafe construct detected
 */
function checkUnsafe(command) {
  if (!command || typeof command !== 'string') {
    return;
  }

  // Command substitution: $()
  if (/\$\(/.test(command)) {
    throw new Error('Command substitution $() not supported');
  }

  // Command substitution: backticks
  if (/`/.test(command)) {
    throw new Error('Command substitution `` not supported');
  }

  // Parameter expansion: ${...}
  if (/\$\{/.test(command)) {
    throw new Error('Parameter expansion ${...} not supported');
  }

  // ANSI-C quoting: $'...' can hide separators and command words
  if (/\$'/.test(command)) {
    throw new Error("ANSI-C quoting $'...' not supported");
  }

  // Arithmetic expansion: $[...] is the old form of $((...)) and assigns too
  // ($[PATH=0] changes PATH for every later command)
  if (/\$\[/.test(command)) {
    throw new Error('Arithmetic expansion $[...] not supported');
  }

  // IFS assignment removes word separators (e.g. rm$IFS-rf), so any command
  // assigning IFS is not auto-allowed
  if (/^IFS=/.test(command) || /[;&|\n\s(\[]IFS=/.test(command)) {
    throw new Error('IFS assignment not supported');
  }

  // Heredocs: <<
  if (/<</.test(command)) {
    throw new Error('Heredocs not supported');
  }

  // Process substitution: <() and >()
  if (/<\(/.test(command) || />\(/.test(command)) {
    throw new Error('Process substitution not supported');
  }
}

/**
 * Reject redirections the parser cannot analyze safely.
 *
 * Redirection targets are stripped from segments during normalization, so an
 * allowlisted command could otherwise write to / read from arbitrary paths.
 * Allowed: fd duplication (2>&1, >&2, 2>&-) and targets of exactly /dev/null.
 * Anything else (including a redirection with no literal target) throws, which
 * makes the hook fall through to the normal permission dialog.
 *
 * @param {string[]} tokens - Tokens from tokenize()
 * @throws {Error} If an unsafe redirection is present
 */
function checkRedirections(tokens) {
  for (let i = 0; i < tokens.length; i++) {
    if (!REDIRECT_OPERATORS.has(tokens[i])) {
      continue;
    }
    const target = tokens[i + 1];
    if (target !== '/dev/null') {
      throw new Error('Redirection to a path not supported');
    }
  }
}

/**
 * Split tokens by operator tokens.
 *
 * @param {string[]} tokens - Array of tokens
 * @returns {string[][]} Array of token segments (each segment is a command)
 */
function splitByOperators(tokens) {
  if (!tokens || tokens.length === 0) {
    return [];
  }

  const segments = [];
  let current = [];

  for (const token of tokens) {
    if (OPERATORS.has(token)) {
      if (current.length > 0) {
        segments.push(current);
        current = [];
      }
      // Operators are not included in segments
    } else {
      current.push(token);
    }
  }

  // Add final segment
  if (current.length > 0) {
    segments.push(current);
  }

  return segments;
}

/**
 * Check if a token is an environment variable assignment.
 *
 * @param {string} token - Token to check
 * @returns {boolean} True if token is VAR=value format
 */
function isEnvAssignment(token) {
  // Must start with letter or underscore, contain =, and have valid var name
  return /^[A-Za-z_][A-Za-z0-9_]*=/.test(token);
}

/**
 * Check if a variable must not be assigned by a command.
 *
 * @param {string} name - Variable name without '='
 * @returns {boolean} True if assigning the variable is unsafe
 */
function isDangerousAssignmentVar(name) {
  return DANGEROUS_ASSIGNMENT_VARS.has(name) ||
    name.startsWith('LD_') ||
    name.startsWith('DYLD_');
}

/**
 * Refuse an assignment to a variable that changes command behaviour.
 *
 * @param {string} name - Variable name without '='
 * @throws {Error} If the variable must not be assigned
 */
function assertSafeAssignmentVar(name) {
  if (isDangerousAssignmentVar(name)) {
    throw new Error(`Dangerous variable assignment not supported: ${name}`);
  }
}

/**
 * Refuse a VAR=value token that changes command behaviour.
 *
 * @param {string} token - VAR=value token
 * @throws {Error} If the assignment targets a dangerous variable
 */
function assertSafeAssignment(token) {
  assertSafeAssignmentVar(token.slice(0, token.indexOf('=')));
}

/**
 * Refuse an assignment value that bash could evaluate as an assignment.
 *
 * The value assigned to a variable with the integer attribute (`declare -i`)
 * or to a dynamic variable such as RANDOM is an arithmetic expression, so
 * `RANDOM=1,PATH=0` assigns PATH. That only matters where the assignment runs
 * in the current shell (a command that is nothing but assignments, or an
 * assignment given to a skipped declaration). An expression assigns through
 * `=` (every compound operator ends in it), `++` or `--`, and an expansion can
 * supply any of them (`set -- PATH=0; RANDOM=$1`), so a `$` is refused too.
 * A temporary assignment in front of a command
 * (`NODE_OPTIONS=--max-old-space-size=4096 npm test`) is not evaluated.
 *
 * @param {string} token - NAME=value or NAME+=value token
 * @param {string} value - Value part of the token
 * @throws {Error} If the value could assign a variable when evaluated
 */
function assertInertValue(token, value) {
  if (/[$=]|\+\+|--/.test(value)) {
    throw new Error(`Assignment value not supported: ${token}`);
  }
}

/**
 * Refuse leading assignments that run in the current shell if a value could
 * assign a variable when evaluated.
 *
 * @param {string[]} assignments - Leading NAME=value tokens of a segment
 * @throws {Error} If a value could assign a variable when evaluated
 */
function assertInertValues(assignments) {
  for (const token of assignments) {
    assertInertValue(token, token.slice(token.indexOf('=') + 1));
  }
}

/**
 * Refuse a `set` that changes how the rest of the line is read.
 *
 * Only options that make the shell stricter or louder pass (`set -e`,
 * `set -euo pipefail`, `set +x`). `-k` (`-o keyword`) reads an assignment among
 * a command's arguments as an environment assignment (`set -k; git status
 * LD_PRELOAD=/x.so`), `-a` and `-o posix` change how later assignments
 * behave and `-n` / `-r` make the rest of the line unreadable. A positional
 * parameter that is expanded could be any of those (`set -- -k; set $1`), so
 * it is refused.
 *
 * @param {string[]} tokens - Tokens of the segment, first token is `set`
 * @throws {Error} If the command changes how the shell reads later commands
 */
function assertSafeSetCommand(tokens) {
  let i = 1;

  // Options run up to `--` or the first positional parameter
  for (; i < tokens.length && tokens[i] !== '--' && /^[-+]./.test(tokens[i]); i++) {
    if (!SAFE_SET_FLAGS_RE.test(tokens[i])) {
      throw new Error(`set option not supported: ${tokens[i]}`);
    }
    if (tokens[i].endsWith('o') && i + 1 < tokens.length) {
      i++;
      if (!SAFE_SET_OPTION_NAMES.has(tokens[i])) {
        throw new Error(`set option not supported: ${tokens[i - 1]} ${tokens[i]}`);
      }
    }
  }

  for (const token of tokens.slice(tokens[i] === '--' ? i + 1 : i)) {
    if (/[$`{}*?[\]~]/.test(token)) {
      throw new Error(`set argument not supported: ${token}`);
    }
  }
}

/**
 * Refuse a skipped command that changes a variable the parser cannot trust.
 *
 * Skipped commands are never classified, yet they change the environment of
 * every command that follows them on the same line. `export PATH=/evil`,
 * `declare IFS=$x`, `export PATH+=:/evil` and `unset PATH` are therefore
 * refused instead of being skipped. So is naming a dangerous variable at all
 * (`declare -a PATH` turns it into an array, after which the shell finds
 * commands in the current directory) and every way to reach one without
 * naming it: a nameref (`declare -n p=PATH; p=/evil`), the integer attribute
 * (`declare -i n; n=PATH=0`), a subscript (`declare PATH[0]=/evil`,
 * `declare a[PATH=0]=x`), a value that is an assignment
 * (`export RANDOM=1,PATH=0`) and a name built by expansion (`export $v`,
 * `export {PATH,X}=/evil`). `set` is held to assertSafeSetCommand.
 *
 * @param {string[]} tokens - Tokens of the segment, first token is the command
 * @throws {Error} If the command changes a dangerous variable
 */
function assertSafeSkipCommand(tokens) {
  const command = tokens[0];

  if (command === 'set') {
    assertSafeSetCommand(tokens);
  }

  for (const token of tokens.slice(1)) {
    const assignment = ASSIGNMENT_WORD_RE.exec(token);

    if (assignment) {
      assertSafeAssignmentVar(assignment[1]);
      if (VARIABLE_COMMANDS.has(command)) {
        if (assignment[2]) {
          throw new Error(`Subscripted assignment not supported: ${token}`);
        }
        assertInertValue(token, assignment[3]);
      }
    } else if (VARIABLE_COMMANDS.has(command)) {
      if (/^[-+][A-Za-z]+$/.test(token)) {
        if (/[ni]/.test(token)) {
          throw new Error(`${command} option not supported: ${token}`);
        }
      } else if (/[$`{}*?[\]~]/.test(token)) {
        throw new Error(`${command} argument not supported: ${token}`);
      } else if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(token)) {
        assertSafeAssignmentVar(token);
      }
    }
  }
}

/**
 * Check if a token is a redirection operator.
 *
 * @param {string} token - Token to check
 * @returns {boolean} True if token is a redirection
 */
function isRedirection(token) {
  // Matches: >, <, >>, 2>, 2>&1, etc.
  return /^[<>]/.test(token) || /^\d+[<>]/.test(token) || token === '>>' || token === '2>&1';
}

/**
 * Whether a token names a shell that takes a command line after -c.
 *
 * A bare name is looked up in PATH like any other command. A path is only
 * trusted when it points into a system directory: /bin/bash is bash,
 * ./tools/bash is whatever the working directory holds.
 *
 * @param {string} token - Token to check
 * @returns {boolean} True when the token names a shell
 */
function isShellExecutable(token) {
  if (!token) {
    return false;
  }
  const text = String(token);
  const name = text.split('/').pop();
  if (!SHELL_EXECUTABLES.has(name)) {
    return false;
  }
  if (!text.includes('/')) {
    return true;
  }
  if (!text.startsWith('/')) {
    return false;
  }
  const directory = text.slice(0, text.lastIndexOf('/'));
  return TRUSTED_SHELL_DIRECTORIES.has(directory);
}

/**
 * How a shell invocation reads.
 *
 * - 'command': the shell runs the word that follows its -c option.
 * - 'script': the shell runs a script; there is no command string.
 * - 'uncertain': the options cannot be read with certainty, so the
 *   invocation is refused instead of guessed at.
 *
 * @param {string[]} tokens - Tokens of the command segment
 * @param {number} shellIndex - Index of the shell token
 * @returns {{kind: string, commandIndex: number}} How the invocation reads
 */
function readShellInvocation(tokens, shellIndex) {
  for (let i = shellIndex + 1; i < tokens.length; i++) {
    const token = tokens[i];

    if (token === '--') {
      // The words after -- are operands: the shell runs the first as a script.
      return { kind: 'script', commandIndex: -1 };
    }

    if (!token.startsWith('-') && !token.startsWith('+')) {
      // The first word that is not an option is the script the shell runs.
      return { kind: 'script', commandIndex: -1 };
    }

    if (token.startsWith('--')) {
      if (SHELL_STARTUP_FILE_OPTIONS.has(token)) {
        return { kind: 'uncertain', commandIndex: -1 };
      }
      if (!SHELL_LONG_FLAGS.has(token)) {
        return { kind: 'uncertain', commandIndex: -1 };
      }
      continue;
    }

    // A short option cluster (-e, -x, -lc): every letter is a flag but 'c',
    // which names the command string that follows the cluster.
    const letters = token.slice(1);
    if (letters.includes('c')) {
      return { kind: 'command', commandIndex: i };
    }
    if (letters.includes('o') || letters.includes('O')) {
      // -o and -O name the option to set: on their own the value is the
      // next word, inside a cluster its place is not clear.
      if (token.length === 2) {
        i++;
        continue;
      }
      return { kind: 'uncertain', commandIndex: -1 };
    }
    for (const letter of letters) {
      if (!SHELL_SHORT_FLAGS.has(letter)) {
        return { kind: 'uncertain', commandIndex: -1 };
      }
    }
  }
  // No -c option: the shell reads the command from its input.
  return { kind: 'script', commandIndex: -1 };
}

/**
 * Normalize a command segment by stripping environment variables,
 * wrappers, skip commands, background operator, and redirections.
 *
 * @param {string[]} tokens - Token array for one command (will be mutated)
 * @param {{expandWrappers?: boolean}} [options] - expandWrappers:false leaves a
 *   bash/sh -c wrapper unexpanded (parseCommand() classifies every inner segment itself)
 * @returns {{executable: string, args: string}|null} Normalized command or null if skipped
 */
function normalizeSegment(tokens, options = {}) {
  if (!tokens || tokens.length === 0) {
    return null;
  }

  // Clone to avoid mutating original
  tokens = [...tokens];

  // Strip leading environment variable assignments (KEY=value). An assignment
  // that changes how the command is resolved is refused, not stripped.
  const assignments = [];
  while (tokens.length > 0 && isEnvAssignment(tokens[0])) {
    assertSafeAssignment(tokens[0]);
    assignments.push(tokens.shift());
  }

  // An assignment word the loop above did not strip (NAME+=value, NAME[i]=value)
  // is a form it cannot judge: refuse it instead of reading it as a command name.
  if (tokens.length > 0 && ASSIGNMENT_WORD_RE.test(tokens[0])) {
    throw new Error(`Assignment form not supported: ${tokens[0]}`);
  }

  // Nothing but assignments: they run in the current shell, so a value that
  // could assign a variable when evaluated is refused.
  if (tokens.length === 0) {
    assertInertValues(assignments);
    return null;
  }

  // Check if command should be skipped (export, set, etc.). A skipped
  // command still changes the environment of every command that follows it
  // on the same line, so an assignment to a variable the parser cannot trust
  // is refused instead of being skipped.
  if (SKIP_COMMANDS.has(tokens[0])) {
    assertInertValues(assignments);
    assertSafeSkipCommand(tokens);
    return null;
  }

  // Strip wrapper commands (timeout, time, nice, nohup, env)
  let strippedWrapper = false;
  while (tokens.length > 0 && WRAPPER_COMMANDS.has(tokens[0])) {
    const wrapper = tokens.shift();
    strippedWrapper = true;

    // Handle wrapper-specific arguments
    if (wrapper === 'timeout') {
      // timeout takes a duration argument (might be number or string like "30s")
      if (tokens.length > 0 && /^\d/.test(tokens[0])) {
        tokens.shift();
      }
      // timeout also has optional flags like --signal, -k, etc.
      while (tokens.length > 0 && tokens[0].startsWith('-')) {
        tokens.shift();
        // Some flags take arguments
        if (tokens.length > 0 && !tokens[0].startsWith('-') && !/^[a-z]/i.test(tokens[0])) {
          tokens.shift();
        }
      }
      // Check for duration again after flags
      if (tokens.length > 0 && /^\d/.test(tokens[0])) {
        tokens.shift();
      }
    } else if (wrapper === 'nice') {
      // nice takes optional -n value
      if (tokens.length > 0 && tokens[0] === '-n') {
        tokens.shift();
        if (tokens.length > 0) {
          tokens.shift(); // the numeric priority
        }
      } else if (tokens.length > 0 && /^-\d+$/.test(tokens[0])) {
        tokens.shift(); // nice -10 format
      }
    } else if (wrapper === 'env') {
      // env takes options and VAR=value pairs before the command it runs.
      // Only the forms whose effect is understood are stripped: -i (ignore
      // the environment) and -u NAME (unset a variable). Every other option
      // (-C/--chdir, -S/--split-string, -0, -v, --, ...) can change what is
      // actually executed, so the segment is refused instead.
      while (tokens.length > 0) {
        const token = tokens[0];

        if (isEnvAssignment(token)) {
          assertSafeAssignment(token);
          tokens.shift();
          continue;
        }

        if (!token.startsWith('-')) {
          break; // the command env should run
        }

        if (token === '-i') {
          tokens.shift();
          continue;
        }

        if (token === '-u') {
          tokens.shift();
          const name = tokens.length > 0 ? tokens.shift() : '';
          if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
            throw new Error('env option not supported: -u requires a variable name');
          }
          assertSafeAssignmentVar(name);
          continue;
        }

        throw new Error(`env option not supported: ${token}`);
      }
    }
    // time and nohup don't have additional arguments to strip
  }

  if (tokens.length === 0) {
    return null;
  }

  // A shell -c behind a wrapper or a privilege prefix hides the command line
  // it runs from the allowlist: the prefix decides what the shell does, so
  // the segments inside it cannot be judged. Refuse it instead of leaving it
  // to be approved as a whole.
  if (strippedWrapper && isShellExecutable(tokens[0])) {
    const invocation = readShellInvocation(tokens, 0);
    if (invocation.kind === 'uncertain') {
      throw new Error('shell invocation not supported');
    }
    if (invocation.kind === 'command' && invocation.commandIndex + 1 < tokens.length) {
      throw new Error('shell -c behind a wrapper not supported');
    }
  }

  if (COMMAND_PREFIX_COMMANDS.has(tokens[0])) {
    for (let i = 1; i < tokens.length; i++) {
      if (!isShellExecutable(tokens[i])) {
        continue;
      }
      const invocation = readShellInvocation(tokens, i);
      if (invocation.kind === 'uncertain') {
        throw new Error('shell invocation not supported');
      }
      if (invocation.kind === 'command' && invocation.commandIndex + 1 < tokens.length) {
        throw new Error('shell -c behind a wrapper not supported');
      }
    }
  }

  // Handle a shell -c "command" - extract the inner command. This is the
  // documented single-segment contract for direct callers. parseCommand()
  // opts out ({ expandWrappers: false }) and classifies every inner segment
  // through classifySegment() instead, so every inner segment is judged.
  if (options.expandWrappers !== false && isShellExecutable(tokens[0])) {
    const invocation = readShellInvocation(tokens, 0);
    if (invocation.kind === 'uncertain') {
      throw new Error('shell invocation not supported');
    }
    if (invocation.kind === 'command' && invocation.commandIndex + 1 < tokens.length) {
      const innerCommand = tokens[invocation.commandIndex + 1];

      // Handle empty inner command
      if (!innerCommand || innerCommand.trim() === '') {
        return null;
      }

      // Strict: an unterminated quote in the inner command hides words just
      // the same as one in the outer command.
      const innerTokens = tokenize(innerCommand, { strict: true });

      // A redirect inside the wrapper is a redirect in the command line the
      // wrapper runs, so it is judged like one outside it.
      checkRedirections(innerTokens);

      const innerSegments = splitByOperators(innerTokens);

      // A function that returns one command cannot return more than one
      // inner command: dropping the rest would judge the wrapper by its
      // first inner command only.
      if (innerSegments.length > 1) {
        throw new Error('shell -c with more than one inner command is not supported');
      }

      if (innerSegments.length > 0) {
        return normalizeSegment(innerSegments[0], options);
      }
      return null;
    }
  }

  // Strip trailing & (background operator)
  while (tokens.length > 0 && tokens[tokens.length - 1] === '&') {
    tokens.pop();
  }

  if (tokens.length === 0) {
    return null;
  }

  // Strip redirections and their targets
  const cleaned = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    // fd duplication/close (2>&1, >&2, <&0, 2>&-) has no target token, so it
    // must not swallow the token after it: that token is part of the command
    if (/^\d*(>>?|<)&(\d+|-)$/.test(token)) {
      continue;
    }

    if (isRedirection(token)) {
      // Skip the redirection operator
      // Also skip the next token if it's a filename (not a command or flag)
      if (i + 1 < tokens.length && !isRedirection(tokens[i + 1])) {
        i++; // Skip the target
      }
      continue;
    }

    cleaned.push(token);
  }

  // Only redirections follow the assignments: they run in the current shell
  if (cleaned.length === 0) {
    assertInertValues(assignments);
    return null;
  }

  return {
    executable: cleaned[0],
    args: cleaned.slice(1).join(' ')
  };
}

/**
 * Classify one command segment, expanding `bash -c`/`sh -c` wrappers into the
 * full list of inner segments so no hidden segment escapes matching.
 *
 * normalizeSegment() keeps its documented single-segment contract; this helper
 * is what parseCommand() uses so every inner segment is checked.
 *
 * @param {string[]} tokens - Token array for one command segment
 * @returns {{executable: string, args: string}[]} Normalized commands (0..n)
 */
function classifySegment(tokens) {
  // Handle a shell -c "command": every inner segment counts
  if (tokens.length > 0 && isShellExecutable(tokens[0])) {
    const invocation = readShellInvocation(tokens, 0);
    if (invocation.kind === 'uncertain') {
      throw new Error('shell invocation not supported');
    }
    if (invocation.kind === 'command' && invocation.commandIndex + 1 < tokens.length) {
      const innerCommand = tokens[invocation.commandIndex + 1];

      // Empty inner command: wrapper alone is not auto-allowed
      if (!innerCommand || innerCommand.trim() === '') {
        return [];
      }

      // Strict: an unterminated quote in the inner command hides words just
      // the same as one in the outer command.
      const innerTokens = tokenize(innerCommand, { strict: true });

      // A redirect inside the wrapper is a redirect in the command line the
      // wrapper runs, so it is judged like one outside it.
      checkRedirections(innerTokens);

      const innerSegments = splitByOperators(innerTokens);

      const results = [];
      for (const innerSegment of innerSegments) {
        const classified = classifySegment(innerSegment);

        // A segment the parser skips (unset, set, export, local, declare, a
        // bare assignment, a lone redirection) is not "nothing to run" inside
        // a wrapper. Dropping it would judge the wrapper by the segments that
        // are left, so `bash -c "unset FOO; npm test"` would pass on `npm test`
        // alone, where the parser used to ask. Refuse the whole wrapper.
        if (classified.length === 0) {
          throw new Error('bash -c with a command the parser skips is not supported');
        }
        results.push(...classified);
      }
      return results;
    }
  }

  const normalized = normalizeSegment(tokens, { expandWrappers: false });
  return normalized ? [normalized] : [];
}

/**
 * Strip the blanks bash treats as word separators from both ends.
 *
 * String.trim() also strips characters bash keeps inside a word (no-break
 * space, vertical tab, form feed, carriage return, byte order mark, ...).
 * Trimming those would move a following '#' to the start of the command, where
 * the tokenizer reads the rest of the line as a comment although bash runs it.
 *
 * @param {string} command - Raw command string
 * @returns {string} Command without leading or trailing space, tab and newline
 */
function trimShellBlanks(command) {
  return command.replace(/^[ \t\n]+/, '').replace(/[ \t\n]+$/, '');
}

/**
 * Parse a Bash command and extract normalized core commands.
 *
 * This is the main entry point for the parser. It:
 * 1. Checks for unsafe constructs
 * 2. Tokenizes the command
 * 3. Splits by operators
 * 4. Normalizes each segment
 *
 * @param {string} command - Raw Bash command string
 * @returns {{executable: string, args: string}[]} Array of normalized commands
 * @throws {Error} If command contains unsupported constructs
 */
function parseCommand(command) {
  if (!command || typeof command !== 'string') {
    return [];
  }

  const trimmed = trimShellBlanks(command);
  if (!trimmed) {
    return [];
  }

  // Check for unsafe constructs first
  checkUnsafe(trimmed);

  // Strict: an unterminated quote makes the word boundaries unknowable, so
  // the command is refused rather than classified from a guess.
  const tokens = tokenize(trimmed, { strict: true });
  if (tokens.length === 0) {
    return [];
  }

  checkRedirections(tokens);

  // Split by operators into segments
  const segments = splitByOperators(tokens);

  // Normalize each segment
  const commands = [];
  for (const segment of segments) {
    commands.push(...classifySegment(segment));
  }

  return commands;
}

module.exports = {
  parseCommand,
  tokenize,
  splitByOperators,
  normalizeSegment,
  checkUnsafe,
  checkRedirections,
  // Export constants for testing
  WRAPPER_COMMANDS,
  COMMAND_PREFIX_COMMANDS,
  SHELL_EXECUTABLES,
  SKIP_COMMANDS,
  OPERATORS,
  DANGEROUS_ASSIGNMENT_VARS,
  State
};
