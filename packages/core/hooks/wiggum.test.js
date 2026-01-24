/**
 * Wiggum Hook Test Suite
 *
 * Tests for the autonomous execution mode hook for /implement-trd.
 *
 * Run tests with: npx jest wiggum.test.js
 *
 * Prerequisites:
 *   npm install --save-dev jest mock-fs
 */

'use strict';

const mockFs = require('mock-fs');
const path = require('path');

// Import module under test
const wiggum = require('./wiggum');
const {
  findProjectRoot,
  readWiggumState,
  writeWiggumState,
  readCurrentJson,
  readImplementJson,
  checkTaskCompletion,
  checkCompletionPromise,
  buildReinjectionPrompt,
  debugLog,
  COMPLETION_PROMISE_TAG,
  DEFAULT_MAX_ITERATIONS,
  main
} = wiggum;

// Store original environment variables
const originalEnv = { ...process.env };

/**
 * Helper to create mock project structure.
 * @param {Object} options Configuration options
 * @returns {Object} Mock file system structure
 */
function createMockProject(options = {}) {
  const {
    hasTrdState = true,
    trdName = 'test-trd',
    implementJson = null,
    wiggumState = null,
    currentJson = null,
    transcriptContent = null,
    transcriptPath = '/tmp/transcript.jsonl'
  } = options;

  const structure = {
    '/home/user/project': {}
  };

  if (hasTrdState) {
    structure['/home/user/project']['.trd-state'] = {};

    if (currentJson) {
      structure['/home/user/project']['.trd-state']['current.json'] = JSON.stringify(currentJson);
    }

    if (implementJson) {
      structure['/home/user/project']['.trd-state'][trdName] = {
        'implement.json': JSON.stringify(implementJson)
      };

      // Also set up currentJson to point to this implement.json if not already set
      if (!currentJson) {
        structure['/home/user/project']['.trd-state']['current.json'] = JSON.stringify({
          trd: `docs/TRD/${trdName}.md`,
          status: `.trd-state/${trdName}/implement.json`
        });
      }
    }

    if (wiggumState) {
      structure['/home/user/project']['.trd-state']['wiggum-state.json'] = JSON.stringify(wiggumState);
    }
  }

  if (transcriptContent) {
    // Add transcript file to root
    const parsedPath = path.parse(transcriptPath);
    if (!structure[parsedPath.dir]) {
      structure[parsedPath.dir] = {};
    }
    structure[parsedPath.dir][parsedPath.base] = transcriptContent;
  }

  return structure;
}

// Setup and teardown
beforeEach(() => {
  // Reset environment variables
  delete process.env.WIGGUM_ACTIVE;
  delete process.env.WIGGUM_MAX_ITERATIONS;
  delete process.env.WIGGUM_DEBUG;
});

afterEach(() => {
  // Restore filesystem
  mockFs.restore();
  // Restore environment
  Object.keys(process.env).forEach(key => {
    if (!originalEnv.hasOwnProperty(key)) {
      delete process.env[key];
    }
  });
  Object.assign(process.env, originalEnv);
});

// =============================================================================
// findProjectRoot Tests
// =============================================================================

describe('findProjectRoot', () => {
  it('should find project root with .trd-state directory', () => {
    mockFs(createMockProject({ hasTrdState: true }));

    const result = findProjectRoot('/home/user/project');
    expect(result).toBe('/home/user/project');
  });

  it('should return null when no .trd-state directory exists', () => {
    mockFs(createMockProject({ hasTrdState: false }));

    const result = findProjectRoot('/home/user/project');
    expect(result).toBeNull();
  });

  it('should find root when starting from nested directory', () => {
    const structure = createMockProject({ hasTrdState: true });
    // Add nested directories
    structure['/home/user/project']['src'] = {
      'components': {
        'utils': {}
      }
    };
    mockFs(structure);

    const result = findProjectRoot('/home/user/project/src/components/utils');
    expect(result).toBe('/home/user/project');
  });

  it('should handle filesystem root boundary', () => {
    mockFs({
      '/': {},
      '/tmp': {}
    });

    const result = findProjectRoot('/tmp');
    expect(result).toBeNull();
  });

  it('should not match .trd-state that is a file instead of directory', () => {
    mockFs({
      '/home/user/project': {
        '.trd-state': 'not a directory'  // File, not directory
      }
    });

    const result = findProjectRoot('/home/user/project');
    expect(result).toBeNull();
  });
});

// =============================================================================
// readWiggumState Tests
// =============================================================================

describe('readWiggumState', () => {
  it('should return default state when file does not exist', () => {
    mockFs(createMockProject({ hasTrdState: true, wiggumState: null }));

    const state = readWiggumState('/home/user/project');
    expect(state).toEqual({
      iteration_count: 0,
      stop_hook_active: false,
      last_prompt: null,
      started_at: null
    });
  });

  it('should parse valid JSON state file', () => {
    const expectedState = {
      iteration_count: 5,
      stop_hook_active: true,
      last_prompt: 'test prompt',
      started_at: '2024-01-01T00:00:00.000Z'
    };

    mockFs(createMockProject({
      hasTrdState: true,
      wiggumState: expectedState
    }));

    const state = readWiggumState('/home/user/project');
    expect(state).toEqual(expectedState);
  });

  it('should return default state on corrupt JSON', () => {
    const structure = createMockProject({ hasTrdState: true });
    structure['/home/user/project']['.trd-state']['wiggum-state.json'] = '{invalid json';
    mockFs(structure);

    const state = readWiggumState('/home/user/project');
    expect(state).toEqual({
      iteration_count: 0,
      stop_hook_active: false,
      last_prompt: null,
      started_at: null
    });
  });

  it('should handle empty file gracefully', () => {
    const structure = createMockProject({ hasTrdState: true });
    structure['/home/user/project']['.trd-state']['wiggum-state.json'] = '';
    mockFs(structure);

    const state = readWiggumState('/home/user/project');
    expect(state).toEqual({
      iteration_count: 0,
      stop_hook_active: false,
      last_prompt: null,
      started_at: null
    });
  });

  it('should handle file with only whitespace', () => {
    const structure = createMockProject({ hasTrdState: true });
    structure['/home/user/project']['.trd-state']['wiggum-state.json'] = '   \n\t  ';
    mockFs(structure);

    const state = readWiggumState('/home/user/project');
    expect(state).toEqual({
      iteration_count: 0,
      stop_hook_active: false,
      last_prompt: null,
      started_at: null
    });
  });
});

// =============================================================================
// writeWiggumState Tests
// =============================================================================

describe('writeWiggumState', () => {
  it('should write state file correctly', () => {
    mockFs(createMockProject({ hasTrdState: true }));

    const stateToWrite = {
      iteration_count: 3,
      stop_hook_active: true,
      last_prompt: 'test',
      started_at: '2024-01-01T00:00:00.000Z'
    };

    writeWiggumState('/home/user/project', stateToWrite);

    // Read it back
    const readBack = readWiggumState('/home/user/project');
    expect(readBack).toEqual(stateToWrite);
  });

  it('should create .trd-state directory if it does not exist', () => {
    mockFs({
      '/home/user/project': {}
    });

    const state = { iteration_count: 1 };
    writeWiggumState('/home/user/project', state);

    // Verify the directory was created
    const fs = require('fs');
    expect(fs.existsSync('/home/user/project/.trd-state')).toBe(true);
  });
});

// =============================================================================
// checkTaskCompletion Tests
// =============================================================================

describe('checkTaskCompletion', () => {
  it('should return done=true when all tasks have success status', () => {
    const implementData = {
      tasks: {
        'T001': { status: 'success' },
        'T002': { status: 'success' },
        'T003': { status: 'success' }
      }
    };

    const result = checkTaskCompletion(implementData);
    expect(result.done).toBe(true);
    expect(result.completed).toBe(3);
    expect(result.total).toBe(3);
  });

  it('should return done=true when all tasks have complete status', () => {
    const implementData = {
      tasks: {
        'T001': { status: 'complete' },
        'T002': { status: 'complete' }
      }
    };

    const result = checkTaskCompletion(implementData);
    expect(result.done).toBe(true);
    expect(result.completed).toBe(2);
    expect(result.total).toBe(2);
  });

  it('should return done=false when some tasks are pending', () => {
    const implementData = {
      tasks: {
        'T001': { status: 'success' },
        'T002': { status: 'pending' },
        'T003': { status: 'in_progress' }
      }
    };

    const result = checkTaskCompletion(implementData);
    expect(result.done).toBe(false);
    expect(result.completed).toBe(1);
    expect(result.total).toBe(3);
  });

  it('should return done=true for empty tasks object', () => {
    const implementData = {
      tasks: {}
    };

    const result = checkTaskCompletion(implementData);
    expect(result.done).toBe(true);
    expect(result.completed).toBe(0);
    expect(result.total).toBe(0);
  });

  it('should handle null implementData', () => {
    const result = checkTaskCompletion(null);
    expect(result.done).toBe(false);
    expect(result.completed).toBe(0);
    expect(result.total).toBe(0);
  });

  it('should handle undefined implementData', () => {
    const result = checkTaskCompletion(undefined);
    expect(result.done).toBe(false);
    expect(result.completed).toBe(0);
    expect(result.total).toBe(0);
  });

  it('should handle implementData without tasks property', () => {
    const implementData = {
      phase_cursor: 1,
      trd_path: 'docs/TRD/test.md'
    };

    const result = checkTaskCompletion(implementData);
    expect(result.done).toBe(false);
    expect(result.completed).toBe(0);
    expect(result.total).toBe(0);
  });

  it('should count mixed success and complete statuses correctly', () => {
    const implementData = {
      tasks: {
        'T001': { status: 'success' },
        'T002': { status: 'complete' },
        'T003': { status: 'success' },
        'T004': { status: 'complete' },
        'T005': { status: 'pending' }
      }
    };

    const result = checkTaskCompletion(implementData);
    expect(result.done).toBe(false);
    expect(result.completed).toBe(4);
    expect(result.total).toBe(5);
  });

  it('should not count failed status as complete', () => {
    const implementData = {
      tasks: {
        'T001': { status: 'success' },
        'T002': { status: 'failed' },
        'T003': { status: 'error' }
      }
    };

    const result = checkTaskCompletion(implementData);
    expect(result.done).toBe(false);
    expect(result.completed).toBe(1);
    expect(result.total).toBe(3);
  });
});

// =============================================================================
// checkCompletionPromise Tests
// =============================================================================

describe('checkCompletionPromise', () => {
  it('should detect promise tag in transcript_path file', () => {
    const transcriptContent = `
{"type":"message","content":"Working on task..."}
{"type":"message","content":"All done! ${COMPLETION_PROMISE_TAG}"}
`;

    mockFs(createMockProject({
      hasTrdState: true,
      transcriptContent,
      transcriptPath: '/tmp/transcript.jsonl'
    }));

    const hookData = {
      transcript_path: '/tmp/transcript.jsonl'
    };

    expect(checkCompletionPromise(hookData)).toBe(true);
  });

  it('should detect promise tag in session_output', () => {
    mockFs(createMockProject({ hasTrdState: true }));

    const hookData = {
      session_output: `Implementation complete! ${COMPLETION_PROMISE_TAG}`
    };

    expect(checkCompletionPromise(hookData)).toBe(true);
  });

  it('should detect promise tag in messages array', () => {
    mockFs(createMockProject({ hasTrdState: true }));

    const hookData = {
      messages: [
        { role: 'user', content: 'Start implementation' },
        { role: 'assistant', content: 'Working on it...' },
        { role: 'assistant', content: `Done! ${COMPLETION_PROMISE_TAG}` }
      ]
    };

    expect(checkCompletionPromise(hookData)).toBe(true);
  });

  it('should return false when no promise tag exists', () => {
    mockFs(createMockProject({
      hasTrdState: true,
      transcriptContent: '{"type":"message","content":"Still working..."}',
      transcriptPath: '/tmp/transcript.jsonl'
    }));

    const hookData = {
      transcript_path: '/tmp/transcript.jsonl',
      session_output: 'No completion here',
      messages: [
        { role: 'assistant', content: 'Working on tasks' }
      ]
    };

    expect(checkCompletionPromise(hookData)).toBe(false);
  });

  it('should handle missing transcript file gracefully', () => {
    mockFs(createMockProject({ hasTrdState: true }));

    const hookData = {
      transcript_path: '/nonexistent/transcript.jsonl'
    };

    expect(checkCompletionPromise(hookData)).toBe(false);
  });

  it('should handle empty hookData gracefully', () => {
    mockFs(createMockProject({ hasTrdState: true }));
    expect(checkCompletionPromise({})).toBe(false);
  });

  it('should handle messages with non-string content', () => {
    mockFs(createMockProject({ hasTrdState: true }));

    const hookData = {
      messages: [
        { role: 'user', content: { type: 'object', data: 'not a string' } },
        { role: 'assistant', content: null },
        { role: 'assistant', content: 123 }
      ]
    };

    expect(checkCompletionPromise(hookData)).toBe(false);
  });

  it('should handle messages without content property', () => {
    mockFs(createMockProject({ hasTrdState: true }));

    const hookData = {
      messages: [
        { role: 'user' },
        { role: 'assistant' }
      ]
    };

    expect(checkCompletionPromise(hookData)).toBe(false);
  });
});

// =============================================================================
// stop_hook_active Safety Tests
// =============================================================================

describe('stop_hook_active safety', () => {
  it('should allow exit when stop_hook_active is true (prevents infinite loop)', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});

    mockFs(createMockProject({
      hasTrdState: true,
      wiggumState: {
        iteration_count: 1,
        stop_hook_active: true,  // Safety flag is set
        last_prompt: null,
        started_at: '2024-01-01T00:00:00.000Z'
      },
      implementJson: {
        tasks: { 'T001': { status: 'pending' } }  // Task not complete
      }
    }));

    process.env.WIGGUM_ACTIVE = '1';

    await main({ cwd: '/home/user/project' });

    // Should allow exit (not block)
    const output = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(output.decision).toBeUndefined();
    expect(output.continue).toBe(true);

    consoleSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('should set stop_hook_active to true when blocking exit', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});

    mockFs(createMockProject({
      hasTrdState: true,
      wiggumState: {
        iteration_count: 0,
        stop_hook_active: false,
        last_prompt: null,
        started_at: null
      },
      implementJson: {
        tasks: { 'T001': { status: 'pending' } }
      }
    }));

    process.env.WIGGUM_ACTIVE = '1';

    await main({ cwd: '/home/user/project' });

    // Verify state was updated
    const updatedState = readWiggumState('/home/user/project');
    expect(updatedState.stop_hook_active).toBe(true);

    consoleSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('should clear stop_hook_active when allowing exit', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});

    mockFs(createMockProject({
      hasTrdState: true,
      wiggumState: {
        iteration_count: 5,
        stop_hook_active: true,
        last_prompt: null,
        started_at: '2024-01-01T00:00:00.000Z'
      },
      implementJson: {
        tasks: { 'T001': { status: 'pending' } }
      }
    }));

    process.env.WIGGUM_ACTIVE = '1';

    await main({ cwd: '/home/user/project' });

    // Should clear the flag
    const updatedState = readWiggumState('/home/user/project');
    expect(updatedState.stop_hook_active).toBe(false);

    consoleSpy.mockRestore();
    exitSpy.mockRestore();
  });
});

// =============================================================================
// Iteration Bounds Tests
// =============================================================================

describe('iteration bounds', () => {
  it('should allow exit when iteration exceeds maxIterations', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});

    mockFs(createMockProject({
      hasTrdState: true,
      wiggumState: {
        iteration_count: 50,  // At max
        stop_hook_active: false,
        last_prompt: null,
        started_at: '2024-01-01T00:00:00.000Z'
      },
      implementJson: {
        tasks: { 'T001': { status: 'pending' } }  // Task not complete
      }
    }));

    process.env.WIGGUM_ACTIVE = '1';
    process.env.WIGGUM_MAX_ITERATIONS = '50';

    await main({ cwd: '/home/user/project' });

    // After incrementing, iteration becomes 51 which > 50, so should allow exit
    const output = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(output.decision).toBeUndefined();  // Not blocking

    consoleSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('should block exit when iteration equals maxIterations', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});

    mockFs(createMockProject({
      hasTrdState: true,
      wiggumState: {
        iteration_count: 49,  // Will become 50 after increment
        stop_hook_active: false,
        last_prompt: null,
        started_at: null
      },
      implementJson: {
        tasks: { 'T001': { status: 'pending' } }
      }
    }));

    process.env.WIGGUM_ACTIVE = '1';
    process.env.WIGGUM_MAX_ITERATIONS = '50';

    await main({ cwd: '/home/user/project' });

    // iteration 50 <= 50, so should block
    const output = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(output.decision).toBe('block');

    consoleSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('should increment iteration count on each invocation', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});

    mockFs(createMockProject({
      hasTrdState: true,
      wiggumState: {
        iteration_count: 5,
        stop_hook_active: false,
        last_prompt: null,
        started_at: null
      },
      implementJson: {
        tasks: { 'T001': { status: 'pending' } }
      }
    }));

    process.env.WIGGUM_ACTIVE = '1';

    await main({ cwd: '/home/user/project' });

    const updatedState = readWiggumState('/home/user/project');
    expect(updatedState.iteration_count).toBe(6);

    consoleSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('should reset iteration count when allowing exit due to completion', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});

    mockFs(createMockProject({
      hasTrdState: true,
      wiggumState: {
        iteration_count: 25,
        stop_hook_active: false,
        last_prompt: null,
        started_at: '2024-01-01T00:00:00.000Z'
      },
      implementJson: {
        tasks: {
          'T001': { status: 'success' },
          'T002': { status: 'complete' }
        }
      }
    }));

    process.env.WIGGUM_ACTIVE = '1';

    await main({ cwd: '/home/user/project' });

    // Should reset iteration count
    const updatedState = readWiggumState('/home/user/project');
    expect(updatedState.iteration_count).toBe(0);

    consoleSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('should use default max iterations when env var not set', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});

    mockFs(createMockProject({
      hasTrdState: true,
      wiggumState: {
        iteration_count: DEFAULT_MAX_ITERATIONS,  // At default max
        stop_hook_active: false,
        last_prompt: null,
        started_at: null
      },
      implementJson: {
        tasks: { 'T001': { status: 'pending' } }
      }
    }));

    process.env.WIGGUM_ACTIVE = '1';
    // Don't set WIGGUM_MAX_ITERATIONS

    await main({ cwd: '/home/user/project' });

    // After increment, iteration > DEFAULT_MAX_ITERATIONS, should allow exit
    const output = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(output.decision).toBeUndefined();

    consoleSpy.mockRestore();
    exitSpy.mockRestore();
  });
});

// =============================================================================
// validateMaxIterations Tests (testing via environment variable parsing)
// =============================================================================

describe('max iterations parsing', () => {
  it('should return default when env var not set', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});

    mockFs(createMockProject({
      hasTrdState: true,
      wiggumState: { iteration_count: 48, stop_hook_active: false },
      implementJson: { tasks: { 'T001': { status: 'pending' } } }
    }));

    process.env.WIGGUM_ACTIVE = '1';
    delete process.env.WIGGUM_MAX_ITERATIONS;

    await main({ cwd: '/home/user/project' });

    // Should use default of 50, iteration 49 <= 50, so block
    const output = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(output.decision).toBe('block');

    consoleSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('should parse valid integer', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});

    mockFs(createMockProject({
      hasTrdState: true,
      wiggumState: { iteration_count: 99, stop_hook_active: false },
      implementJson: { tasks: { 'T001': { status: 'pending' } } }
    }));

    process.env.WIGGUM_ACTIVE = '1';
    process.env.WIGGUM_MAX_ITERATIONS = '100';

    await main({ cwd: '/home/user/project' });

    // iteration 100 <= 100, should block
    const output = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(output.decision).toBe('block');

    consoleSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('should handle non-numeric value by using NaN parsing', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});

    mockFs(createMockProject({
      hasTrdState: true,
      wiggumState: { iteration_count: 0, stop_hook_active: false },
      implementJson: { tasks: { 'T001': { status: 'pending' } } }
    }));

    process.env.WIGGUM_ACTIVE = '1';
    process.env.WIGGUM_MAX_ITERATIONS = 'invalid';  // Will result in NaN

    await main({ cwd: '/home/user/project' });

    // parseInt('invalid', 10) returns NaN
    // Comparison with NaN: iteration > NaN is always false
    // So it won't exit due to max iterations - will check completion
    // Task is pending, so should block
    const output = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(output.decision).toBe('block');

    consoleSpy.mockRestore();
    exitSpy.mockRestore();
  });
});

// =============================================================================
// Main Function Integration Tests
// =============================================================================

describe('main function', () => {
  it('should allow exit when WIGGUM_ACTIVE is not set', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});

    mockFs(createMockProject({
      hasTrdState: true,
      implementJson: { tasks: { 'T001': { status: 'pending' } } }
    }));

    // Don't set WIGGUM_ACTIVE
    await main({ cwd: '/home/user/project' });

    const output = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(output.decision).toBeUndefined();
    expect(output.continue).toBe(true);

    consoleSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('should allow exit when WIGGUM_ACTIVE is 0', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});

    mockFs(createMockProject({
      hasTrdState: true,
      implementJson: { tasks: { 'T001': { status: 'pending' } } }
    }));

    process.env.WIGGUM_ACTIVE = '0';

    await main({ cwd: '/home/user/project' });

    const output = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(output.decision).toBeUndefined();

    consoleSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('should block exit when tasks are incomplete', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});

    mockFs(createMockProject({
      hasTrdState: true,
      wiggumState: { iteration_count: 0, stop_hook_active: false },
      implementJson: {
        tasks: {
          'T001': { status: 'success' },
          'T002': { status: 'pending' }
        }
      }
    }));

    process.env.WIGGUM_ACTIVE = '1';

    await main({ cwd: '/home/user/project' });

    const output = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(output.decision).toBe('block');
    expect(output.reason).toContain('WIGGUM AUTONOMOUS MODE');

    consoleSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('should allow exit when all tasks complete', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});

    mockFs(createMockProject({
      hasTrdState: true,
      wiggumState: { iteration_count: 5, stop_hook_active: false },
      implementJson: {
        tasks: {
          'T001': { status: 'success' },
          'T002': { status: 'complete' }
        }
      }
    }));

    process.env.WIGGUM_ACTIVE = '1';

    await main({ cwd: '/home/user/project' });

    const output = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(output.decision).toBeUndefined();
    expect(output.continue).toBe(true);

    consoleSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('should allow exit when completion promise found', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});

    mockFs(createMockProject({
      hasTrdState: true,
      wiggumState: { iteration_count: 5, stop_hook_active: false },
      implementJson: {
        tasks: { 'T001': { status: 'pending' } }  // Task not complete
      }
    }));

    process.env.WIGGUM_ACTIVE = '1';

    // Pass completion promise in session_output
    await main({
      cwd: '/home/user/project',
      session_output: `All done! ${COMPLETION_PROMISE_TAG}`
    });

    const output = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(output.decision).toBeUndefined();

    consoleSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('should allow exit when no project root found', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});

    mockFs({
      '/home/user/project': {}  // No .trd-state
    });

    process.env.WIGGUM_ACTIVE = '1';

    await main({ cwd: '/home/user/project' });

    const output = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(output.decision).toBeUndefined();

    consoleSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('should use process.cwd() when cwd not provided in hookData', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});

    // Mock process.cwd() by setting up the actual cwd
    mockFs(createMockProject({ hasTrdState: true }));

    process.env.WIGGUM_ACTIVE = '1';

    // This will use process.cwd() which won't match our mock
    await main({});

    // Should allow exit because project root won't be found
    const output = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(output.continue).toBe(true);

    consoleSpy.mockRestore();
    exitSpy.mockRestore();
  });
});

// =============================================================================
// buildReinjectionPrompt Tests
// =============================================================================

describe('buildReinjectionPrompt', () => {
  it('should include iteration information', () => {
    const prompt = buildReinjectionPrompt(5, 50, { completed: 3, total: 10 }, null);
    expect(prompt).toContain('Iteration 5/50');
  });

  it('should include task completion status', () => {
    const prompt = buildReinjectionPrompt(1, 50, { completed: 3, total: 10 }, null);
    expect(prompt).toContain('3/10 tasks complete');
    expect(prompt).toContain('7 remaining');
  });

  it('should include current phase from implementData', () => {
    const implementData = { phase_cursor: 3 };
    const prompt = buildReinjectionPrompt(1, 50, { completed: 0, total: 5 }, implementData);
    expect(prompt).toContain('Current Phase: 3');
  });

  it('should default to phase 1 when not specified', () => {
    const prompt = buildReinjectionPrompt(1, 50, { completed: 0, total: 5 }, null);
    expect(prompt).toContain('Current Phase: 1');
  });

  it('should identify next incomplete task', () => {
    const implementData = {
      tasks: {
        'T001': { status: 'success' },
        'T002': { status: 'pending' },
        'T003': { status: 'pending' }
      }
    };
    const prompt = buildReinjectionPrompt(1, 50, { completed: 1, total: 3 }, implementData);
    expect(prompt).toContain('Next Task: T002');
  });

  it('should include the completion promise instruction', () => {
    const prompt = buildReinjectionPrompt(1, 50, { completed: 0, total: 5 }, null);
    expect(prompt).toContain('<promise>COMPLETE</promise>');
  });

  it('should include resume instruction', () => {
    const prompt = buildReinjectionPrompt(1, 50, { completed: 0, total: 5 }, null);
    expect(prompt).toContain('Resume /implement-trd execution');
  });
});

// =============================================================================
// readCurrentJson Tests
// =============================================================================

describe('readCurrentJson', () => {
  it('should return null when current.json does not exist', () => {
    mockFs(createMockProject({ hasTrdState: true }));
    const result = readCurrentJson('/home/user/project');
    expect(result).toBeNull();
  });

  it('should parse valid current.json', () => {
    const currentData = {
      trd: 'docs/TRD/feature.md',
      status: '.trd-state/feature/implement.json'
    };

    mockFs(createMockProject({
      hasTrdState: true,
      currentJson: currentData
    }));

    const result = readCurrentJson('/home/user/project');
    expect(result).toEqual(currentData);
  });

  it('should return null on corrupt JSON', () => {
    const structure = createMockProject({ hasTrdState: true });
    structure['/home/user/project']['.trd-state']['current.json'] = 'not valid json';
    mockFs(structure);

    const result = readCurrentJson('/home/user/project');
    expect(result).toBeNull();
  });
});

// =============================================================================
// readImplementJson Tests
// =============================================================================

describe('readImplementJson', () => {
  it('should return null when implement.json does not exist', () => {
    mockFs(createMockProject({ hasTrdState: true }));
    const result = readImplementJson('/home/user/project');
    expect(result).toBeNull();
  });

  it('should read implement.json via current.json status path', () => {
    const implementData = {
      tasks: { 'T001': { status: 'pending' } }
    };

    mockFs(createMockProject({
      hasTrdState: true,
      implementJson: implementData
    }));

    const result = readImplementJson('/home/user/project');
    expect(result).toEqual(implementData);
  });

  it('should find implement.json in subdirectories as fallback', () => {
    const implementData = {
      tasks: { 'T001': { status: 'success' } }
    };

    const structure = createMockProject({ hasTrdState: true });
    // Add implement.json without current.json reference
    structure['/home/user/project']['.trd-state']['my-feature'] = {
      'implement.json': JSON.stringify(implementData)
    };
    // Remove current.json
    delete structure['/home/user/project']['.trd-state']['current.json'];
    mockFs(structure);

    const result = readImplementJson('/home/user/project');
    expect(result).toEqual(implementData);
  });
});

// =============================================================================
// debugLog Tests
// =============================================================================

describe('debugLog', () => {
  it('should log to stderr when WIGGUM_DEBUG is 1', () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation();

    process.env.WIGGUM_DEBUG = '1';
    debugLog('Test message');

    expect(errorSpy).toHaveBeenCalled();
    expect(errorSpy.mock.calls[0][0]).toContain('[WIGGUM');
    expect(errorSpy.mock.calls[0][0]).toContain('Test message');

    errorSpy.mockRestore();
  });

  it('should not log when WIGGUM_DEBUG is not 1', () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation();

    process.env.WIGGUM_DEBUG = '0';
    debugLog('Test message');

    expect(errorSpy).not.toHaveBeenCalled();

    errorSpy.mockRestore();
  });

  it('should not log when WIGGUM_DEBUG is not set', () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation();

    delete process.env.WIGGUM_DEBUG;
    debugLog('Test message');

    expect(errorSpy).not.toHaveBeenCalled();

    errorSpy.mockRestore();
  });
});

// =============================================================================
// Constants Tests
// =============================================================================

describe('exported constants', () => {
  it('should export COMPLETION_PROMISE_TAG', () => {
    expect(COMPLETION_PROMISE_TAG).toBe('<promise>COMPLETE</promise>');
  });

  it('should export DEFAULT_MAX_ITERATIONS as 50', () => {
    expect(DEFAULT_MAX_ITERATIONS).toBe(50);
  });
});

// =============================================================================
// Output Format Tests
// =============================================================================

describe('output format', () => {
  it('should output valid JSON with correct structure for block', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});

    mockFs(createMockProject({
      hasTrdState: true,
      wiggumState: { iteration_count: 0, stop_hook_active: false },
      implementJson: { tasks: { 'T001': { status: 'pending' } } }
    }));

    process.env.WIGGUM_ACTIVE = '1';

    await main({ cwd: '/home/user/project' });

    const output = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(output).toHaveProperty('hookSpecificOutput');
    expect(output.hookSpecificOutput).toHaveProperty('hookEventName', 'Stop');
    expect(output).toHaveProperty('continue', true);
    expect(output).toHaveProperty('decision', 'block');
    expect(output).toHaveProperty('reason');
    expect(typeof output.reason).toBe('string');

    consoleSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('should output valid JSON with correct structure for allow', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});

    mockFs(createMockProject({
      hasTrdState: true,
      implementJson: {
        tasks: {
          'T001': { status: 'success' }
        }
      }
    }));

    process.env.WIGGUM_ACTIVE = '1';

    await main({ cwd: '/home/user/project' });

    const output = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(output).toHaveProperty('hookSpecificOutput');
    expect(output.hookSpecificOutput).toHaveProperty('hookEventName', 'Stop');
    expect(output).toHaveProperty('continue', true);
    expect(output.decision).toBeUndefined();
    expect(output.reason).toBeUndefined();

    consoleSpy.mockRestore();
    exitSpy.mockRestore();
  });
});

// =============================================================================
// Edge Cases
// =============================================================================

describe('edge cases', () => {
  it('should handle simultaneous completion promise and incomplete tasks', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});

    mockFs(createMockProject({
      hasTrdState: true,
      wiggumState: { iteration_count: 10, stop_hook_active: false },
      implementJson: { tasks: { 'T001': { status: 'pending' } } }
    }));

    process.env.WIGGUM_ACTIVE = '1';

    // Completion promise takes precedence
    await main({
      cwd: '/home/user/project',
      session_output: `Work done! ${COMPLETION_PROMISE_TAG}`
    });

    const output = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(output.decision).toBeUndefined();  // Should allow exit

    consoleSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('should handle missing implementJson gracefully', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});

    mockFs(createMockProject({
      hasTrdState: true,
      wiggumState: { iteration_count: 0, stop_hook_active: false }
      // No implementJson
    }));

    process.env.WIGGUM_ACTIVE = '1';

    await main({ cwd: '/home/user/project' });

    // With no implement.json, tasks = null, so checkTaskCompletion returns done=false
    // Should block because tasks are "not complete"
    const output = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(output.decision).toBe('block');

    consoleSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('should set started_at on first blocking invocation', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});

    mockFs(createMockProject({
      hasTrdState: true,
      wiggumState: {
        iteration_count: 0,
        stop_hook_active: false,
        last_prompt: null,
        started_at: null
      },
      implementJson: { tasks: { 'T001': { status: 'pending' } } }
    }));

    process.env.WIGGUM_ACTIVE = '1';

    await main({ cwd: '/home/user/project' });

    const updatedState = readWiggumState('/home/user/project');
    expect(updatedState.started_at).not.toBeNull();
    expect(updatedState.started_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);  // ISO date format

    consoleSpy.mockRestore();
    exitSpy.mockRestore();
  });
});
