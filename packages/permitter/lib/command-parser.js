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

// Commands that are skipped entirely
const SKIP_COMMANDS = new Set(['export', 'set', 'unset', 'local', 'declare', 'typeset']);

// Operators that split commands
const OPERATORS = new Set(['&&', '||', ';', '|']);

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
 *
 * @param {string} command - Raw command string
 * @returns {string[]} Array of tokens
 */
function tokenize(command) {
  if (!command || typeof command !== 'string') {
    return [];
  }

  const tokens = [];
  let current = '';
  let state = State.NORMAL;
  let prevState = State.NORMAL;
  let inQuotedSection = false; // Track if we've been in a quoted section for this token

  for (let i = 0; i < command.length; i++) {
    const char = command[i];
    const nextChar = command[i + 1];

    switch (state) {
      case State.NORMAL:
        if (char === "'") {
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
        } else if (/\s/.test(char)) {
          // Whitespace ends current token
          if (current || inQuotedSection) {
            tokens.push(current);
            current = '';
            inQuotedSection = false;
          }
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
 * Normalize a command segment by stripping environment variables,
 * wrappers, skip commands, background operator, and redirections.
 *
 * @param {string[]} tokens - Token array for one command (will be mutated)
 * @returns {{executable: string, args: string}|null} Normalized command or null if skipped
 */
function normalizeSegment(tokens) {
  if (!tokens || tokens.length === 0) {
    return null;
  }

  // Clone to avoid mutating original
  tokens = [...tokens];

  // Strip leading environment variable assignments (KEY=value)
  while (tokens.length > 0 && isEnvAssignment(tokens[0])) {
    tokens.shift();
  }

  if (tokens.length === 0) {
    return null;
  }

  // Check if command should be skipped (export, set, etc.)
  if (SKIP_COMMANDS.has(tokens[0])) {
    return null;
  }

  // Strip wrapper commands (timeout, time, nice, nohup, env)
  while (tokens.length > 0 && WRAPPER_COMMANDS.has(tokens[0])) {
    const wrapper = tokens.shift();

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
      // env can have VAR=value pairs before the command
      while (tokens.length > 0 && isEnvAssignment(tokens[0])) {
        tokens.shift();
      }
      // env can also have flags like -i, -u
      while (tokens.length > 0 && tokens[0].startsWith('-')) {
        const flag = tokens.shift();
        if (flag === '-u' && tokens.length > 0) {
          tokens.shift(); // unset var name
        }
      }
    }
    // time and nohup don't have additional arguments to strip
  }

  if (tokens.length === 0) {
    return null;
  }

  // Handle bash -c "command" - extract the inner command
  if (tokens[0] === 'bash' || tokens[0] === 'sh') {
    // Look for -c flag
    const cIndex = tokens.indexOf('-c');
    if (cIndex !== -1 && cIndex + 1 < tokens.length) {
      // The argument after -c is the command to parse
      const innerCommand = tokens[cIndex + 1];

      // Handle empty inner command
      if (!innerCommand || innerCommand.trim() === '') {
        return null;
      }

      // Recursively tokenize and normalize the inner command
      const innerTokens = tokenize(innerCommand);
      const innerSegments = splitByOperators(innerTokens);

      // If there are multiple commands in the inner shell, we need to return the first
      // and the caller should handle the rest
      if (innerSegments.length > 0) {
        return normalizeSegment(innerSegments[0]);
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

    if (isRedirection(token)) {
      // Skip the redirection operator
      // Also skip the next token if it's a filename (not a command or flag)
      if (i + 1 < tokens.length && !isRedirection(tokens[i + 1])) {
        i++; // Skip the target
      }
      continue;
    }

    // Handle combined redirections like 2>&1
    if (token === '2>&1' || /^\d+>&\d+$/.test(token)) {
      continue;
    }

    cleaned.push(token);
  }

  if (cleaned.length === 0) {
    return null;
  }

  return {
    executable: cleaned[0],
    args: cleaned.slice(1).join(' ')
  };
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

  const trimmed = command.trim();
  if (!trimmed) {
    return [];
  }

  // Check for unsafe constructs first
  checkUnsafe(trimmed);

  // Tokenize the command
  const tokens = tokenize(trimmed);
  if (tokens.length === 0) {
    return [];
  }

  // Split by operators into segments
  const segments = splitByOperators(tokens);

  // Normalize each segment
  const commands = [];
  for (const segment of segments) {
    const normalized = normalizeSegment(segment);
    if (normalized) {
      commands.push(normalized);
    }
  }

  return commands;
}

module.exports = {
  parseCommand,
  tokenize,
  splitByOperators,
  normalizeSegment,
  checkUnsafe,
  // Export constants for testing
  WRAPPER_COMMANDS,
  SKIP_COMMANDS,
  OPERATORS,
  State
};
