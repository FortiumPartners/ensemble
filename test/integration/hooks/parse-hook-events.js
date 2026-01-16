#!/usr/bin/env node

/**
 * Parse Hook Events
 *
 * Parses JSONL session logs for hook execution events, extracting
 * hook names, trigger events, and outputs.
 *
 * Usage:
 *   node parse-hook-events.js <session-file.jsonl> [--hook <name>] [--event <type>]
 *   cat session.jsonl | node parse-hook-events.js --stdin
 *
 * Options:
 *   --hook <name>    Filter by hook name (wiggum, formatter, learning, status, permitter)
 *   --event <type>   Filter by event type (PreToolUse, PostToolUse, UserPromptSubmit, Notification, Stop, SubagentStop)
 *   --stdin          Read from stdin instead of file
 *   --help           Show this help message
 *
 * Output:
 *   JSON object with hooks_found array and summary statistics
 *
 * Task: TRD-TEST-094
 */

'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');

// =============================================================================
// Constants
// =============================================================================

/**
 * Known hook types in Ensemble vNext
 */
const KNOWN_HOOKS = ['wiggum', 'formatter', 'learning', 'status', 'permitter'];

/**
 * Known hook event types
 */
const KNOWN_EVENTS = [
  'PreToolUse',
  'PostToolUse',
  'UserPromptSubmit',
  'Notification',
  'Stop',
  'SubagentStop'
];

/**
 * Hook event types to extract (prefixed with 'hook_')
 */
const HOOK_EVENT_TYPES = ['hook_start', 'hook_output', 'hook_end', 'hook_result'];

// =============================================================================
// Core Functions
// =============================================================================

/**
 * Extracts hook events from an array of JSONL lines.
 *
 * @param {string[]|null|undefined} lines - Array of JSON strings (one per line)
 * @param {Object} [options] - Filter options
 * @param {string} [options.hookName] - Filter by hook name
 * @param {string} [options.eventType] - Filter by event type
 * @returns {Object[]} Array of hook event objects
 */
function extractHookEvents(lines, options = {}) {
  if (!lines || !Array.isArray(lines)) {
    return [];
  }

  const { hookName, eventType } = options;
  const events = [];

  for (const line of lines) {
    // Skip empty lines
    if (!line || typeof line !== 'string' || line.trim() === '') {
      continue;
    }

    try {
      const parsed = JSON.parse(line);

      // Check if this is a hook event
      if (!parsed.type || !HOOK_EVENT_TYPES.includes(parsed.type)) {
        continue;
      }

      // Apply hook name filter
      if (hookName && parsed.hook !== hookName) {
        continue;
      }

      // Apply event type filter
      if (eventType && parsed.event !== eventType) {
        continue;
      }

      events.push(parsed);
    } catch (e) {
      // Skip malformed JSON lines silently
      continue;
    }
  }

  return events;
}

/**
 * Generates summary statistics from hook events.
 *
 * @param {Object[]|null|undefined} events - Array of hook event objects
 * @returns {Object} Summary statistics
 */
function summarizeHooks(events) {
  if (!events || !Array.isArray(events)) {
    return {
      total_hooks_triggered: 0,
      hooks_by_type: {},
      hooks_by_event: {},
      successful_hooks: 0,
      failed_hooks: 0,
      unique_hooks: []
    };
  }

  const hooksByType = {};
  const hooksByEvent = {};
  const uniqueHooks = new Set();
  let successfulHooks = 0;
  let failedHooks = 0;
  let totalTriggered = 0;

  for (const event of events) {
    // Count hook_start events as "triggered"
    if (event.type === 'hook_start') {
      totalTriggered++;

      // Count by hook type
      const hook = event.hook || 'unknown';
      hooksByType[hook] = (hooksByType[hook] || 0) + 1;
      uniqueHooks.add(hook);

      // Count by event type
      if (event.event) {
        hooksByEvent[event.event] = (hooksByEvent[event.event] || 0) + 1;
      }
    }

    // Track success/failure from hook_end events
    if (event.type === 'hook_end' || event.type === 'hook_result') {
      if (event.success === true) {
        successfulHooks++;
      } else if (event.success === false) {
        failedHooks++;
      }
    }
  }

  return {
    total_hooks_triggered: totalTriggered,
    hooks_by_type: hooksByType,
    hooks_by_event: hooksByEvent,
    successful_hooks: successfulHooks,
    failed_hooks: failedHooks,
    unique_hooks: Array.from(uniqueHooks)
  };
}

/**
 * Formats raw hook events into structured output for downstream tests.
 *
 * @param {Object[]} events - Array of raw hook event objects
 * @returns {Object[]} Array of formatted hook event objects
 */
function formatHookEvents(events) {
  return events.map(event => {
    const formatted = {
      hook: event.hook,
      event: event.event,
      type: event.type
    };

    // Add triggered flag for hook_start events
    if (event.type === 'hook_start') {
      formatted.triggered = true;
    }

    // Add timestamp if present
    if (event.timestamp) {
      formatted.timestamp = event.timestamp;
    }

    // Add output if present
    if (event.output !== undefined) {
      formatted.output = event.output;
    }

    // Add success flag if present
    if (event.success !== undefined) {
      formatted.success = event.success;
    }

    return formatted;
  });
}

/**
 * Validates that a file path is within allowed directories.
 * Prevents path traversal attacks by ensuring paths stay within:
 * - Current working directory
 * - /tmp/ directory (for test fixtures)
 *
 * @param {string} filePath - Path to validate
 * @returns {string} Resolved absolute path
 * @throws {Error} If path is outside allowed directories
 */
function validateFilePath(filePath) {
  const absolutePath = path.resolve(filePath);
  const cwd = process.cwd();

  const isWithinCwd = absolutePath.startsWith(path.resolve(cwd) + path.sep) || absolutePath === path.resolve(cwd);
  const isWithinTmp = absolutePath.startsWith('/tmp/');

  if (!isWithinCwd && !isWithinTmp) {
    throw new Error(`Path traversal detected: ${filePath} is outside allowed directories`);
  }

  return absolutePath;
}

/**
 * Parses a JSONL session log file and returns structured hook event data.
 *
 * @param {string} filePath - Path to the JSONL session log file
 * @param {Object} [options] - Filter options
 * @param {string} [options.hookName] - Filter by hook name
 * @param {string} [options.eventType] - Filter by event type
 * @returns {Object} Structured result with hooks_found, summary, etc.
 * @throws {Error} If file cannot be read or path is outside allowed directories
 */
function parseSessionLog(filePath, options = {}) {
  // Validate path stays within expected directories
  const absolutePath = validateFilePath(filePath);

  // Read file contents
  const content = fs.readFileSync(absolutePath, 'utf-8');
  const lines = content.split('\n').filter(line => line.trim() !== '');

  // Count parse errors
  let parseErrors = 0;
  const validLines = [];

  for (const line of lines) {
    try {
      JSON.parse(line);
      validLines.push(line);
    } catch (e) {
      parseErrors++;
      // Still include the line for hook extraction (it will be skipped there too)
      validLines.push(line);
    }
  }

  // Extract hook events
  const rawEvents = extractHookEvents(lines, options);

  // Format events for output
  const formattedEvents = formatHookEvents(rawEvents);

  // Generate summary
  const summary = summarizeHooks(rawEvents);

  return {
    session_file: filePath,
    parsed_at: new Date().toISOString(),
    hooks_found: formattedEvents,
    summary,
    parse_errors: parseErrors > 0 ? parseErrors : undefined
  };
}

/**
 * Parses JSONL session data from stdin.
 *
 * @param {Object} [options] - Filter options
 * @param {string} [options.hookName] - Filter by hook name
 * @param {string} [options.eventType] - Filter by event type
 * @returns {Promise<Object>} Structured result with hooks_found, summary, etc.
 */
async function parseSessionLogFromStdin(options = {}) {
  return new Promise((resolve, reject) => {
    const lines = [];
    let parseErrors = 0;

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false
    });

    rl.on('line', (line) => {
      if (line.trim() === '') return;
      lines.push(line);
      try {
        JSON.parse(line);
      } catch (e) {
        parseErrors++;
      }
    });

    rl.on('close', () => {
      // Extract hook events
      const rawEvents = extractHookEvents(lines, options);

      // Format events for output
      const formattedEvents = formatHookEvents(rawEvents);

      // Generate summary
      const summary = summarizeHooks(rawEvents);

      resolve({
        session_file: '<stdin>',
        parsed_at: new Date().toISOString(),
        hooks_found: formattedEvents,
        summary,
        parse_errors: parseErrors > 0 ? parseErrors : undefined
      });
    });

    rl.on('error', (err) => {
      reject(err);
    });
  });
}

// =============================================================================
// CLI Interface
// =============================================================================

/**
 * Prints usage information.
 */
function printUsage() {
  console.log(`
Usage:
  node parse-hook-events.js <session-file.jsonl> [options]
  cat session.jsonl | node parse-hook-events.js --stdin [options]

Options:
  --hook <name>    Filter by hook name (${KNOWN_HOOKS.join(', ')})
  --event <type>   Filter by event type (${KNOWN_EVENTS.join(', ')})
  --stdin          Read from stdin instead of file
  --help           Show this help message

Output:
  JSON object with:
  - session_file: Path to the parsed file (or '<stdin>')
  - parsed_at: ISO timestamp of when parsing occurred
  - hooks_found: Array of hook events with hook name, event type, and output
  - summary: Statistics including total hooks, counts by type/event, success/failure

Examples:
  # Parse a session log file
  node parse-hook-events.js /path/to/session.jsonl

  # Filter for wiggum hooks only
  node parse-hook-events.js session.jsonl --hook wiggum

  # Filter for Stop events
  node parse-hook-events.js session.jsonl --event Stop

  # Parse from stdin
  cat session.jsonl | node parse-hook-events.js --stdin

  # Combine with jq for specific data
  node parse-hook-events.js session.jsonl | jq '.summary.hooks_by_type'
`);
}

/**
 * Parses command line arguments.
 *
 * @param {string[]} args - Command line arguments (process.argv.slice(2))
 * @returns {Object} Parsed options
 */
function parseArgs(args) {
  const options = {
    filePath: null,
    hookName: null,
    eventType: null,
    useStdin: false,
    showHelp: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--help' || arg === '-h') {
      options.showHelp = true;
    } else if (arg === '--stdin') {
      options.useStdin = true;
    } else if (arg === '--hook') {
      options.hookName = args[++i];
    } else if (arg === '--event') {
      options.eventType = args[++i];
    } else if (!arg.startsWith('-')) {
      options.filePath = arg;
    }
  }

  return options;
}

/**
 * Main CLI entry point.
 */
async function main() {
  const args = process.argv.slice(2);
  const options = parseArgs(args);

  if (options.showHelp) {
    printUsage();
    process.exit(0);
  }

  try {
    let result;

    if (options.useStdin) {
      result = await parseSessionLogFromStdin({
        hookName: options.hookName,
        eventType: options.eventType
      });
    } else if (options.filePath) {
      result = parseSessionLog(options.filePath, {
        hookName: options.hookName,
        eventType: options.eventType
      });
    } else {
      console.error('Error: No input file specified. Use --stdin for stdin or provide a file path.');
      console.error('Run with --help for usage information.');
      process.exit(1);
    }

    // Output JSON result
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

// =============================================================================
// Module Exports
// =============================================================================

module.exports = {
  parseSessionLog,
  parseSessionLogFromStdin,
  extractHookEvents,
  summarizeHooks,
  formatHookEvents,
  validateFilePath,
  KNOWN_HOOKS,
  KNOWN_EVENTS,
  HOOK_EVENT_TYPES
};

// Run CLI if executed directly
if (require.main === module) {
  main();
}
