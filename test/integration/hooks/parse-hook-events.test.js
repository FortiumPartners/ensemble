/**
 * Parse Hook Events Test Suite
 *
 * Tests for the session log parser that extracts hook execution events
 * from JSONL session logs.
 *
 * Run tests with: npx jest parse-hook-events.test.js
 *
 * Task: TRD-TEST-094
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

// Import module under test
const {
  parseSessionLog,
  parseSessionLogFromStdin,
  extractHookEvents,
  summarizeHooks,
  validateFilePath
} = require('./parse-hook-events');

// =============================================================================
// Test Fixtures
// =============================================================================

/**
 * Creates a temporary JSONL file with the given content lines.
 * @param {string[]} lines - Array of JSON strings (one per line)
 * @returns {string} Path to the temporary file
 */
function createTempJsonlFile(lines) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-test-'));
  const tempFile = path.join(tempDir, 'session.jsonl');
  fs.writeFileSync(tempFile, lines.join('\n') + '\n');
  return tempFile;
}

/**
 * Cleans up a temporary file and its directory.
 * @param {string} filePath - Path to the temporary file
 */
function cleanupTempFile(filePath) {
  try {
    fs.unlinkSync(filePath);
    fs.rmdirSync(path.dirname(filePath));
  } catch (e) {
    // Ignore cleanup errors
  }
}

// Sample hook event types found in Claude session logs
const SAMPLE_HOOK_START = JSON.stringify({
  type: 'hook_start',
  hook: 'wiggum',
  event: 'UserPromptSubmit',
  timestamp: '2026-01-13T10:00:00.000Z'
});

const SAMPLE_HOOK_OUTPUT = JSON.stringify({
  type: 'hook_output',
  hook: 'wiggum',
  output: { routing: { recommended_agent: 'backend-developer' } },
  timestamp: '2026-01-13T10:00:01.000Z'
});

const SAMPLE_HOOK_END = JSON.stringify({
  type: 'hook_end',
  hook: 'wiggum',
  event: 'UserPromptSubmit',
  success: true,
  timestamp: '2026-01-13T10:00:02.000Z'
});

const SAMPLE_FORMATTER_HOOK = JSON.stringify({
  type: 'hook_start',
  hook: 'formatter',
  event: 'PostToolUse',
  timestamp: '2026-01-13T10:01:00.000Z'
});

const SAMPLE_FORMATTER_OUTPUT = JSON.stringify({
  type: 'hook_output',
  hook: 'formatter',
  output: { file_formatted: 'src/app.js', formatter: 'prettier' },
  timestamp: '2026-01-13T10:01:01.000Z'
});

const SAMPLE_LEARNING_HOOK = JSON.stringify({
  type: 'hook_start',
  hook: 'learning',
  event: 'Stop',
  timestamp: '2026-01-13T10:02:00.000Z'
});

const SAMPLE_STATUS_HOOK = JSON.stringify({
  type: 'hook_start',
  hook: 'status',
  event: 'Notification',
  timestamp: '2026-01-13T10:03:00.000Z'
});

const SAMPLE_PERMITTER_HOOK = JSON.stringify({
  type: 'hook_start',
  hook: 'permitter',
  event: 'PreToolUse',
  timestamp: '2026-01-13T10:04:00.000Z'
});

// Non-hook events (should be ignored)
const SAMPLE_TOOL_USE = JSON.stringify({
  type: 'tool_use',
  name: 'Bash',
  id: 'tool_123',
  input: { command: 'ls -la' }
});

const SAMPLE_ASSISTANT = JSON.stringify({
  type: 'assistant',
  content: [{ type: 'text', text: 'Here is the result...' }]
});

const SAMPLE_USER = JSON.stringify({
  type: 'user',
  content: 'Build a calculator app'
});

// =============================================================================
// extractHookEvents Tests
// =============================================================================

describe('extractHookEvents', () => {
  it('should extract hook_start events from JSONL lines', () => {
    const lines = [
      SAMPLE_USER,
      SAMPLE_HOOK_START,
      SAMPLE_ASSISTANT
    ];

    const events = extractHookEvents(lines);
    expect(events.length).toBe(1);
    expect(events[0].type).toBe('hook_start');
    expect(events[0].hook).toBe('wiggum');
    expect(events[0].event).toBe('UserPromptSubmit');
  });

  it('should extract hook_output events', () => {
    const lines = [
      SAMPLE_HOOK_START,
      SAMPLE_HOOK_OUTPUT,
      SAMPLE_HOOK_END
    ];

    const events = extractHookEvents(lines);
    expect(events.length).toBe(3);
    expect(events[1].type).toBe('hook_output');
    expect(events[1].hook).toBe('wiggum');
    expect(events[1].output).toBeDefined();
  });

  it('should extract hook_end events', () => {
    const lines = [
      SAMPLE_HOOK_START,
      SAMPLE_HOOK_END
    ];

    const events = extractHookEvents(lines);
    expect(events.length).toBe(2);
    expect(events[1].type).toBe('hook_end');
    expect(events[1].success).toBe(true);
  });

  it('should return empty array when no hook events exist', () => {
    const lines = [
      SAMPLE_USER,
      SAMPLE_TOOL_USE,
      SAMPLE_ASSISTANT
    ];

    const events = extractHookEvents(lines);
    expect(events).toEqual([]);
  });

  it('should handle empty input', () => {
    const events = extractHookEvents([]);
    expect(events).toEqual([]);
  });

  it('should handle null/undefined input', () => {
    expect(extractHookEvents(null)).toEqual([]);
    expect(extractHookEvents(undefined)).toEqual([]);
  });

  it('should skip malformed JSON lines gracefully', () => {
    const lines = [
      SAMPLE_HOOK_START,
      '{invalid json',
      'not json at all',
      SAMPLE_HOOK_OUTPUT
    ];

    const events = extractHookEvents(lines);
    expect(events.length).toBe(2);
  });

  it('should skip empty lines', () => {
    const lines = [
      SAMPLE_HOOK_START,
      '',
      '   ',
      SAMPLE_HOOK_OUTPUT
    ];

    const events = extractHookEvents(lines);
    expect(events.length).toBe(2);
  });

  it('should extract events from all supported hook types', () => {
    const lines = [
      SAMPLE_HOOK_START,           // wiggum
      SAMPLE_FORMATTER_HOOK,       // formatter
      SAMPLE_LEARNING_HOOK,        // learning
      SAMPLE_STATUS_HOOK,          // status
      SAMPLE_PERMITTER_HOOK        // permitter
    ];

    const events = extractHookEvents(lines);
    expect(events.length).toBe(5);

    const hookNames = events.map(e => e.hook);
    expect(hookNames).toContain('wiggum');
    expect(hookNames).toContain('formatter');
    expect(hookNames).toContain('learning');
    expect(hookNames).toContain('status');
    expect(hookNames).toContain('permitter');
  });

  it('should extract all trigger event types', () => {
    const lines = [
      SAMPLE_HOOK_START,           // UserPromptSubmit
      SAMPLE_FORMATTER_HOOK,       // PostToolUse
      SAMPLE_LEARNING_HOOK,        // Stop
      SAMPLE_STATUS_HOOK,          // Notification
      SAMPLE_PERMITTER_HOOK        // PreToolUse
    ];

    const events = extractHookEvents(lines);
    const triggerEvents = events.map(e => e.event);

    expect(triggerEvents).toContain('UserPromptSubmit');
    expect(triggerEvents).toContain('PostToolUse');
    expect(triggerEvents).toContain('Stop');
    expect(triggerEvents).toContain('Notification');
    expect(triggerEvents).toContain('PreToolUse');
  });

  it('should filter by hook name when specified', () => {
    const lines = [
      SAMPLE_HOOK_START,           // wiggum
      SAMPLE_FORMATTER_HOOK,       // formatter
      SAMPLE_HOOK_OUTPUT           // wiggum
    ];

    const events = extractHookEvents(lines, { hookName: 'wiggum' });
    expect(events.length).toBe(2);
    expect(events.every(e => e.hook === 'wiggum')).toBe(true);
  });

  it('should filter by event type when specified', () => {
    const lines = [
      SAMPLE_HOOK_START,           // UserPromptSubmit
      SAMPLE_FORMATTER_HOOK,       // PostToolUse
      SAMPLE_LEARNING_HOOK         // Stop
    ];

    const events = extractHookEvents(lines, { eventType: 'Stop' });
    expect(events.length).toBe(1);
    expect(events[0].event).toBe('Stop');
  });

  it('should filter by both hook name and event type', () => {
    const wiggumStop = JSON.stringify({
      type: 'hook_start',
      hook: 'wiggum',
      event: 'Stop',
      timestamp: '2026-01-13T10:05:00.000Z'
    });

    const lines = [
      SAMPLE_HOOK_START,           // wiggum, UserPromptSubmit
      SAMPLE_LEARNING_HOOK,        // learning, Stop
      wiggumStop                   // wiggum, Stop
    ];

    const events = extractHookEvents(lines, { hookName: 'wiggum', eventType: 'Stop' });
    expect(events.length).toBe(1);
    expect(events[0].hook).toBe('wiggum');
    expect(events[0].event).toBe('Stop');
  });
});

// =============================================================================
// summarizeHooks Tests
// =============================================================================

describe('summarizeHooks', () => {
  it('should count total hooks triggered', () => {
    const events = [
      { type: 'hook_start', hook: 'wiggum', event: 'UserPromptSubmit' },
      { type: 'hook_output', hook: 'wiggum', output: {} },
      { type: 'hook_start', hook: 'formatter', event: 'PostToolUse' }
    ];

    const summary = summarizeHooks(events);
    expect(summary.total_hooks_triggered).toBe(2);
  });

  it('should count hooks by type', () => {
    const events = [
      { type: 'hook_start', hook: 'wiggum', event: 'UserPromptSubmit' },
      { type: 'hook_start', hook: 'wiggum', event: 'Stop' },
      { type: 'hook_start', hook: 'formatter', event: 'PostToolUse' },
      { type: 'hook_start', hook: 'learning', event: 'Stop' }
    ];

    const summary = summarizeHooks(events);
    expect(summary.hooks_by_type).toEqual({
      wiggum: 2,
      formatter: 1,
      learning: 1
    });
  });

  it('should count hooks by event', () => {
    const events = [
      { type: 'hook_start', hook: 'wiggum', event: 'UserPromptSubmit' },
      { type: 'hook_start', hook: 'permitter', event: 'UserPromptSubmit' },
      { type: 'hook_start', hook: 'formatter', event: 'PostToolUse' },
      { type: 'hook_start', hook: 'learning', event: 'Stop' }
    ];

    const summary = summarizeHooks(events);
    expect(summary.hooks_by_event).toEqual({
      UserPromptSubmit: 2,
      PostToolUse: 1,
      Stop: 1
    });
  });

  it('should return zero counts for empty input', () => {
    const summary = summarizeHooks([]);
    expect(summary.total_hooks_triggered).toBe(0);
    expect(summary.hooks_by_type).toEqual({});
    expect(summary.hooks_by_event).toEqual({});
  });

  it('should handle null/undefined input', () => {
    expect(summarizeHooks(null).total_hooks_triggered).toBe(0);
    expect(summarizeHooks(undefined).total_hooks_triggered).toBe(0);
  });

  it('should only count hook_start events for totals', () => {
    const events = [
      { type: 'hook_start', hook: 'wiggum', event: 'UserPromptSubmit' },
      { type: 'hook_output', hook: 'wiggum', output: {} },
      { type: 'hook_end', hook: 'wiggum', event: 'UserPromptSubmit', success: true }
    ];

    const summary = summarizeHooks(events);
    expect(summary.total_hooks_triggered).toBe(1);
  });

  it('should track successful vs failed hooks', () => {
    const events = [
      { type: 'hook_start', hook: 'wiggum', event: 'UserPromptSubmit' },
      { type: 'hook_end', hook: 'wiggum', success: true },
      { type: 'hook_start', hook: 'formatter', event: 'PostToolUse' },
      { type: 'hook_end', hook: 'formatter', success: false }
    ];

    const summary = summarizeHooks(events);
    expect(summary.successful_hooks).toBe(1);
    expect(summary.failed_hooks).toBe(1);
  });

  it('should list unique hooks found', () => {
    const events = [
      { type: 'hook_start', hook: 'wiggum', event: 'UserPromptSubmit' },
      { type: 'hook_start', hook: 'wiggum', event: 'Stop' },
      { type: 'hook_start', hook: 'formatter', event: 'PostToolUse' }
    ];

    const summary = summarizeHooks(events);
    expect(summary.unique_hooks).toEqual(['wiggum', 'formatter']);
  });
});

// =============================================================================
// parseSessionLog Tests (File-based)
// =============================================================================

describe('parseSessionLog', () => {
  let tempFile;

  afterEach(() => {
    if (tempFile) {
      cleanupTempFile(tempFile);
      tempFile = null;
    }
  });

  it('should parse JSONL file and return structured result', () => {
    tempFile = createTempJsonlFile([
      SAMPLE_USER,
      SAMPLE_HOOK_START,
      SAMPLE_HOOK_OUTPUT,
      SAMPLE_HOOK_END,
      SAMPLE_ASSISTANT
    ]);

    const result = parseSessionLog(tempFile);

    expect(result.session_file).toBe(tempFile);
    expect(result.hooks_found).toHaveLength(3);
    expect(result.summary).toBeDefined();
    expect(result.summary.total_hooks_triggered).toBe(1);
  });

  it('should return structured hook events with all properties', () => {
    tempFile = createTempJsonlFile([
      SAMPLE_HOOK_START,
      SAMPLE_HOOK_OUTPUT
    ]);

    const result = parseSessionLog(tempFile);

    expect(result.hooks_found[0]).toEqual({
      hook: 'wiggum',
      event: 'UserPromptSubmit',
      type: 'hook_start',
      triggered: true,
      timestamp: '2026-01-13T10:00:00.000Z'
    });

    expect(result.hooks_found[1].output).toBeDefined();
  });

  it('should handle file with no hooks', () => {
    tempFile = createTempJsonlFile([
      SAMPLE_USER,
      SAMPLE_TOOL_USE,
      SAMPLE_ASSISTANT
    ]);

    const result = parseSessionLog(tempFile);

    expect(result.hooks_found).toEqual([]);
    expect(result.summary.total_hooks_triggered).toBe(0);
  });

  it('should handle empty file', () => {
    tempFile = createTempJsonlFile([]);

    const result = parseSessionLog(tempFile);

    expect(result.hooks_found).toEqual([]);
    expect(result.summary.total_hooks_triggered).toBe(0);
  });

  it('should throw error for non-existent file', () => {
    expect(() => {
      parseSessionLog('/nonexistent/path/file.jsonl');
    }).toThrow();
  });

  it('should accept filter options', () => {
    tempFile = createTempJsonlFile([
      SAMPLE_HOOK_START,
      SAMPLE_FORMATTER_HOOK,
      SAMPLE_LEARNING_HOOK
    ]);

    const result = parseSessionLog(tempFile, { hookName: 'wiggum' });

    expect(result.hooks_found).toHaveLength(1);
    expect(result.hooks_found[0].hook).toBe('wiggum');
  });

  it('should handle file with mixed valid and invalid lines', () => {
    tempFile = createTempJsonlFile([
      SAMPLE_HOOK_START,
      'invalid json line',
      SAMPLE_HOOK_OUTPUT,
      '{incomplete json'
    ]);

    const result = parseSessionLog(tempFile);

    expect(result.hooks_found).toHaveLength(2);
    expect(result.parse_errors).toBe(2);
  });

  it('should include parse timestamp in result', () => {
    tempFile = createTempJsonlFile([SAMPLE_HOOK_START]);

    const result = parseSessionLog(tempFile);

    expect(result.parsed_at).toBeDefined();
    expect(result.parsed_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

// =============================================================================
// Integration Tests - Full Session Parsing
// =============================================================================

describe('integration - full session parsing', () => {
  let tempFile;

  afterEach(() => {
    if (tempFile) {
      cleanupTempFile(tempFile);
      tempFile = null;
    }
  });

  it('should parse a realistic session with multiple hook invocations', () => {
    const sessionLines = [
      // User starts a task
      JSON.stringify({ type: 'user', content: 'Build a Python API' }),

      // Wiggum hook fires on UserPromptSubmit
      JSON.stringify({
        type: 'hook_start',
        hook: 'wiggum',
        event: 'UserPromptSubmit',
        timestamp: '2026-01-13T10:00:00.000Z'
      }),
      JSON.stringify({
        type: 'hook_output',
        hook: 'wiggum',
        output: { routing: { recommended_agent: 'backend-developer' } },
        timestamp: '2026-01-13T10:00:01.000Z'
      }),
      JSON.stringify({
        type: 'hook_end',
        hook: 'wiggum',
        event: 'UserPromptSubmit',
        success: true,
        timestamp: '2026-01-13T10:00:02.000Z'
      }),

      // Assistant starts working
      JSON.stringify({ type: 'assistant', content: [{ type: 'text', text: 'Creating API...' }] }),

      // Tool use triggers formatter hook
      JSON.stringify({ type: 'tool_use', name: 'Write', id: 'tool_1', input: { file_path: '/app.py' } }),
      JSON.stringify({
        type: 'hook_start',
        hook: 'formatter',
        event: 'PostToolUse',
        timestamp: '2026-01-13T10:01:00.000Z'
      }),
      JSON.stringify({
        type: 'hook_output',
        hook: 'formatter',
        output: { file_formatted: '/app.py', formatter: 'black' },
        timestamp: '2026-01-13T10:01:01.000Z'
      }),
      JSON.stringify({
        type: 'hook_end',
        hook: 'formatter',
        event: 'PostToolUse',
        success: true,
        timestamp: '2026-01-13T10:01:02.000Z'
      }),

      // Session ends, learning hook fires
      JSON.stringify({
        type: 'hook_start',
        hook: 'learning',
        event: 'Stop',
        timestamp: '2026-01-13T10:05:00.000Z'
      }),
      JSON.stringify({
        type: 'hook_end',
        hook: 'learning',
        event: 'Stop',
        success: true,
        timestamp: '2026-01-13T10:05:01.000Z'
      })
    ];

    tempFile = createTempJsonlFile(sessionLines);

    const result = parseSessionLog(tempFile);

    // Check summary
    expect(result.summary.total_hooks_triggered).toBe(3);
    expect(result.summary.hooks_by_type).toEqual({
      wiggum: 1,
      formatter: 1,
      learning: 1
    });
    expect(result.summary.hooks_by_event).toEqual({
      UserPromptSubmit: 1,
      PostToolUse: 1,
      Stop: 1
    });
    expect(result.summary.successful_hooks).toBe(3);
    expect(result.summary.failed_hooks).toBe(0);
  });

  it('should properly format output for downstream tests', () => {
    tempFile = createTempJsonlFile([
      SAMPLE_HOOK_START,
      SAMPLE_FORMATTER_OUTPUT
    ]);

    const result = parseSessionLog(tempFile);

    // Verify JSON-serializable output
    const serialized = JSON.stringify(result);
    expect(() => JSON.parse(serialized)).not.toThrow();

    // Verify expected structure for TRD-TEST-095 through 099
    expect(result).toHaveProperty('session_file');
    expect(result).toHaveProperty('hooks_found');
    expect(result).toHaveProperty('summary');
    expect(result.summary).toHaveProperty('total_hooks_triggered');
    expect(result.summary).toHaveProperty('hooks_by_type');
  });
});

// =============================================================================
// Edge Cases
// =============================================================================

describe('edge cases', () => {
  let tempFile;

  afterEach(() => {
    if (tempFile) {
      cleanupTempFile(tempFile);
      tempFile = null;
    }
  });

  it('should handle hook events with missing optional fields', () => {
    const minimalHookEvent = JSON.stringify({
      type: 'hook_start',
      hook: 'wiggum'
      // Missing event and timestamp
    });

    tempFile = createTempJsonlFile([minimalHookEvent]);

    const result = parseSessionLog(tempFile);

    expect(result.hooks_found.length).toBe(1);
    expect(result.hooks_found[0].hook).toBe('wiggum');
    expect(result.hooks_found[0].event).toBeUndefined();
  });

  it('should handle very large session files', () => {
    // Create a file with 1000 hook events
    const lines = [];
    for (let i = 0; i < 1000; i++) {
      lines.push(JSON.stringify({
        type: 'hook_start',
        hook: i % 2 === 0 ? 'wiggum' : 'formatter',
        event: 'UserPromptSubmit',
        timestamp: new Date(Date.now() + i * 1000).toISOString()
      }));
    }

    tempFile = createTempJsonlFile(lines);

    const result = parseSessionLog(tempFile);

    expect(result.summary.total_hooks_triggered).toBe(1000);
    expect(result.summary.hooks_by_type.wiggum).toBe(500);
    expect(result.summary.hooks_by_type.formatter).toBe(500);
  });

  it('should handle Unicode content in hook output', () => {
    const unicodeHook = JSON.stringify({
      type: 'hook_output',
      hook: 'formatter',
      output: { message: '日本語テスト', emoji: '🎉' }
    });

    tempFile = createTempJsonlFile([unicodeHook]);

    const result = parseSessionLog(tempFile);

    expect(result.hooks_found[0].output.message).toBe('日本語テスト');
    expect(result.hooks_found[0].output.emoji).toBe('🎉');
  });

  it('should handle deeply nested hook output', () => {
    const nestedHook = JSON.stringify({
      type: 'hook_output',
      hook: 'wiggum',
      output: {
        routing: {
          recommended_agent: 'backend-developer',
          skills: ['developing-with-python'],
          context: {
            detected_frameworks: ['fastapi'],
            project_type: 'api'
          }
        }
      }
    });

    tempFile = createTempJsonlFile([nestedHook]);

    const result = parseSessionLog(tempFile);

    expect(result.hooks_found[0].output.routing.context.detected_frameworks).toContain('fastapi');
  });

  it('should handle SubagentStop event type', () => {
    const subagentStopHook = JSON.stringify({
      type: 'hook_start',
      hook: 'status',
      event: 'SubagentStop',
      timestamp: '2026-01-13T10:00:00.000Z'
    });

    tempFile = createTempJsonlFile([subagentStopHook]);

    const result = parseSessionLog(tempFile);

    expect(result.hooks_found[0].event).toBe('SubagentStop');
    expect(result.summary.hooks_by_event.SubagentStop).toBe(1);
  });
});

// =============================================================================
// CLI Output Format Tests
// =============================================================================

describe('CLI output format', () => {
  let tempFile;

  afterEach(() => {
    if (tempFile) {
      cleanupTempFile(tempFile);
      tempFile = null;
    }
  });

  it('should produce valid JSON output matching expected format', () => {
    tempFile = createTempJsonlFile([
      SAMPLE_HOOK_START,
      SAMPLE_HOOK_OUTPUT,
      SAMPLE_FORMATTER_HOOK,
      SAMPLE_FORMATTER_OUTPUT
    ]);

    const result = parseSessionLog(tempFile);

    // Expected output format from TRD
    expect(result).toMatchObject({
      session_file: expect.any(String),
      hooks_found: expect.any(Array),
      summary: {
        total_hooks_triggered: expect.any(Number),
        hooks_by_type: expect.any(Object)
      }
    });
  });
});

// =============================================================================
// Security Tests - Path Traversal Prevention
// =============================================================================

describe('validateFilePath - security', () => {
  it('should allow paths within current working directory', () => {
    const testPath = path.join(process.cwd(), 'test-file.jsonl');
    expect(() => validateFilePath(testPath)).not.toThrow();
  });

  it('should allow paths within /tmp/ directory', () => {
    const testPath = '/tmp/test-session.jsonl';
    expect(() => validateFilePath(testPath)).not.toThrow();
  });

  it('should allow nested paths within /tmp/', () => {
    const testPath = '/tmp/hook-tests/sessions/test.jsonl';
    expect(() => validateFilePath(testPath)).not.toThrow();
  });

  it('should reject paths outside allowed directories', () => {
    expect(() => validateFilePath('/etc/passwd')).toThrow('Path traversal detected');
    expect(() => validateFilePath('/var/log/syslog')).toThrow('Path traversal detected');
  });

  it('should reject path traversal attempts with ../', () => {
    const maliciousPath = path.join(process.cwd(), '..', '..', 'etc', 'passwd');
    expect(() => validateFilePath(maliciousPath)).toThrow('Path traversal detected');
  });

  it('should reject absolute paths outside cwd and /tmp/', () => {
    expect(() => validateFilePath('/home/other-user/secrets.txt')).toThrow('Path traversal detected');
  });

  it('should return absolute path when validation passes', () => {
    const relativePath = 'test-file.jsonl';
    const result = validateFilePath(relativePath);
    expect(path.isAbsolute(result)).toBe(true);
    expect(result).toBe(path.resolve(process.cwd(), relativePath));
  });
});

describe('parseSessionLog - path traversal prevention', () => {
  it('should reject attempts to read files outside allowed directories', () => {
    expect(() => parseSessionLog('/etc/passwd')).toThrow('Path traversal detected');
  });

  it('should reject relative path traversal attacks', () => {
    const maliciousPath = '../../../etc/passwd';
    expect(() => parseSessionLog(maliciousPath)).toThrow('Path traversal detected');
  });
});
