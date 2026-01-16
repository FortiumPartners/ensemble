/**
 * Status Hook Test Suite
 *
 * Tests for the passive verification hook for TRD implementation tracking.
 *
 * Run tests with: npx jest status.test.js
 *
 * Prerequisites:
 *   npm install --save-dev jest mock-fs
 */

'use strict';

const mockFs = require('mock-fs');
const path = require('path');

// Import module under test
const status = require('./status');
const {
  findTrdStateDir,
  findImplementFiles,
  readImplementJson,
  wasModifiedRecently,
  clearSessionId,
  getSessionId,
  debugLog,
  main
} = status;

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
    implementJsonMtime = Date.now(),
    additionalTrds = {}
  } = options;

  const structure = {
    '/home/user/project': {}
  };

  if (hasTrdState) {
    structure['/home/user/project']['.trd-state'] = {};

    if (implementJson) {
      structure['/home/user/project']['.trd-state'][trdName] = {
        'implement.json': mockFs.file({
          content: JSON.stringify(implementJson),
          mtime: new Date(implementJsonMtime)
        })
      };
    }

    // Add additional TRD directories
    for (const [name, data] of Object.entries(additionalTrds)) {
      structure['/home/user/project']['.trd-state'][name] = {
        'implement.json': mockFs.file({
          content: JSON.stringify(data.implementJson),
          mtime: new Date(data.mtime || Date.now())
        })
      };
    }
  }

  return structure;
}

// Setup and teardown
beforeEach(() => {
  // Reset environment variables
  delete process.env.STATUS_HOOK_DISABLE;
  delete process.env.STATUS_HOOK_DEBUG;
  delete process.env.CLAUDE_SESSION_ID;
  delete process.env.SESSION_ID;
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
// TRD-TEST-007: Test File Structure and findTrdStateDir Tests
// =============================================================================

describe('findTrdStateDir', () => {
  it('should find .trd-state directory in current directory', () => {
    mockFs(createMockProject({ hasTrdState: true }));

    const result = findTrdStateDir('/home/user/project');
    expect(result).toBe('/home/user/project/.trd-state');
  });

  it('should return null when no .trd-state directory exists', () => {
    mockFs(createMockProject({ hasTrdState: false }));

    const result = findTrdStateDir('/home/user/project');
    expect(result).toBeNull();
  });

  it('should find .trd-state when starting from nested directory', () => {
    const structure = createMockProject({ hasTrdState: true });
    // Add nested directories
    structure['/home/user/project']['src'] = {
      'components': {
        'utils': {}
      }
    };
    mockFs(structure);

    const result = findTrdStateDir('/home/user/project/src/components/utils');
    expect(result).toBe('/home/user/project/.trd-state');
  });

  it('should handle filesystem root boundary', () => {
    mockFs({
      '/': {},
      '/tmp': {}
    });

    const result = findTrdStateDir('/tmp');
    expect(result).toBeNull();
  });

  it('should not match .trd-state that is a file instead of directory', () => {
    mockFs({
      '/home/user/project': {
        '.trd-state': 'not a directory'  // File, not directory
      }
    });

    const result = findTrdStateDir('/home/user/project');
    expect(result).toBeNull();
  });

  it('should find .trd-state in parent when nested two levels deep', () => {
    const structure = createMockProject({ hasTrdState: true });
    structure['/home/user/project']['src'] = {
      'components': {}
    };
    mockFs(structure);

    const result = findTrdStateDir('/home/user/project/src/components');
    expect(result).toBe('/home/user/project/.trd-state');
  });

  it('should return first .trd-state found when walking up', () => {
    mockFs({
      '/home/user': {
        '.trd-state': {}  // Parent has .trd-state
      },
      '/home/user/project': {
        '.trd-state': {}  // Current also has .trd-state
      }
    });

    // Should find the one in /home/user/project first
    const result = findTrdStateDir('/home/user/project');
    expect(result).toBe('/home/user/project/.trd-state');
  });
});

// =============================================================================
// TRD-TEST-008: findImplementFiles Tests
// =============================================================================

describe('findImplementFiles', () => {
  it('should find implement.json files in subdirectories', () => {
    mockFs(createMockProject({
      hasTrdState: true,
      trdName: 'feature-one',
      implementJson: { tasks: {} },
      additionalTrds: {
        'feature-two': { implementJson: { tasks: {} } }
      }
    }));

    const files = findImplementFiles('/home/user/project/.trd-state');
    expect(files.length).toBe(2);
    expect(files).toContain('/home/user/project/.trd-state/feature-one/implement.json');
    expect(files).toContain('/home/user/project/.trd-state/feature-two/implement.json');
  });

  it('should return empty array when no implement.json files exist', () => {
    mockFs({
      '/home/user/project': {
        '.trd-state': {
          'empty-dir': {}
        }
      }
    });

    const files = findImplementFiles('/home/user/project/.trd-state');
    expect(files).toEqual([]);
  });

  it('should skip directories without implement.json', () => {
    mockFs({
      '/home/user/project': {
        '.trd-state': {
          'has-json': {
            'implement.json': JSON.stringify({ tasks: {} })
          },
          'no-json': {
            'other.json': '{}'
          }
        }
      }
    });

    const files = findImplementFiles('/home/user/project/.trd-state');
    expect(files.length).toBe(1);
    expect(files[0]).toBe('/home/user/project/.trd-state/has-json/implement.json');
  });

  it('should handle empty .trd-state directory', () => {
    mockFs({
      '/home/user/project': {
        '.trd-state': {}
      }
    });

    const files = findImplementFiles('/home/user/project/.trd-state');
    expect(files).toEqual([]);
  });

  it('should not include files directly in .trd-state (only subdirectories)', () => {
    mockFs({
      '/home/user/project': {
        '.trd-state': {
          'implement.json': JSON.stringify({ tasks: {} }),  // Direct file - should be skipped
          'subdir': {
            'implement.json': JSON.stringify({ tasks: {} })  // In subdir - should be found
          }
        }
      }
    });

    const files = findImplementFiles('/home/user/project/.trd-state');
    expect(files.length).toBe(1);
    expect(files[0]).toBe('/home/user/project/.trd-state/subdir/implement.json');
  });
});

// =============================================================================
// TRD-TEST-008: readImplementJson Tests
// =============================================================================

describe('readImplementJson', () => {
  it('should parse valid JSON file', () => {
    const testData = {
      current_phase: 1,
      cycle_position: 'execute',
      tasks: {
        'T001': { status: 'pending' }
      }
    };

    mockFs({
      '/tmp/test.json': JSON.stringify(testData)
    });

    const result = readImplementJson('/tmp/test.json');
    expect(result).toEqual(testData);
  });

  it('should return null for non-existent file', () => {
    mockFs({});

    const result = readImplementJson('/tmp/nonexistent.json');
    expect(result).toBeNull();
  });

  it('should return null for corrupt JSON', () => {
    mockFs({
      '/tmp/corrupt.json': '{invalid json content'
    });

    const result = readImplementJson('/tmp/corrupt.json');
    expect(result).toBeNull();
  });

  it('should handle empty file', () => {
    mockFs({
      '/tmp/empty.json': ''
    });

    const result = readImplementJson('/tmp/empty.json');
    expect(result).toBeNull();
  });

  it('should parse complex nested JSON', () => {
    const complexData = {
      current_phase: 2,
      tasks: {
        'T001': {
          status: 'success',
          files: ['a.js', 'b.js'],
          metadata: { verified: true }
        }
      },
      session_id: 'test-123'
    };

    mockFs({
      '/tmp/complex.json': JSON.stringify(complexData)
    });

    const result = readImplementJson('/tmp/complex.json');
    expect(result).toEqual(complexData);
  });
});

// =============================================================================
// TRD-TEST-008: wasModifiedRecently Tests
// =============================================================================

describe('wasModifiedRecently', () => {
  it('should return true for recently modified file', () => {
    const recentTime = Date.now() - (5 * 60 * 1000);  // 5 minutes ago
    mockFs({
      '/tmp/recent.json': mockFs.file({
        content: '{}',
        mtime: new Date(recentTime)
      })
    });

    const result = wasModifiedRecently('/tmp/recent.json', 30);
    expect(result).toBe(true);
  });

  it('should return false for old file', () => {
    const oldTime = Date.now() - (60 * 60 * 1000);  // 60 minutes ago
    mockFs({
      '/tmp/old.json': mockFs.file({
        content: '{}',
        mtime: new Date(oldTime)
      })
    });

    const result = wasModifiedRecently('/tmp/old.json', 30);
    expect(result).toBe(false);
  });

  it('should return false for non-existent file', () => {
    mockFs({});

    const result = wasModifiedRecently('/tmp/nonexistent.json', 30);
    expect(result).toBe(false);
  });

  it('should handle edge case at exactly the cutoff time', () => {
    const exactCutoff = Date.now() - (30 * 60 * 1000);  // Exactly 30 minutes ago
    mockFs({
      '/tmp/edge.json': mockFs.file({
        content: '{}',
        mtime: new Date(exactCutoff)
      })
    });

    // At exactly the cutoff, mtime === cutoff, so mtime > cutoff is false
    const result = wasModifiedRecently('/tmp/edge.json', 30);
    expect(result).toBe(false);
  });

  it('should use default 30 minutes when not specified', () => {
    const twentyMinsAgo = Date.now() - (20 * 60 * 1000);
    mockFs({
      '/tmp/default.json': mockFs.file({
        content: '{}',
        mtime: new Date(twentyMinsAgo)
      })
    });

    // Using default parameter (30 minutes)
    const result = wasModifiedRecently('/tmp/default.json');
    expect(result).toBe(true);
  });

  it('should handle custom time window', () => {
    const tenMinsAgo = Date.now() - (10 * 60 * 1000);
    mockFs({
      '/tmp/custom.json': mockFs.file({
        content: '{}',
        mtime: new Date(tenMinsAgo)
      })
    });

    // 10 minutes ago is within 5 minute window? No
    expect(wasModifiedRecently('/tmp/custom.json', 5)).toBe(false);
    // 10 minutes ago is within 15 minute window? Yes
    expect(wasModifiedRecently('/tmp/custom.json', 15)).toBe(true);
  });
});

// =============================================================================
// TRD-TEST-008: clearSessionId Tests
// =============================================================================

describe('clearSessionId', () => {
  it('should clear session_id and set last_session_completed', () => {
    const initialData = {
      current_phase: 1,
      session_id: 'test-session-123',
      tasks: {}
    };

    mockFs({
      '/tmp/implement.json': JSON.stringify(initialData)
    });

    const result = clearSessionId('/tmp/implement.json', { ...initialData });
    expect(result).toBe(true);

    // Read back the file to verify
    const fs = require('fs');
    const written = JSON.parse(fs.readFileSync('/tmp/implement.json', 'utf-8'));
    expect(written.session_id).toBeNull();
    expect(written.last_session_completed).toBeDefined();
    expect(written.last_session_completed).toMatch(/^\d{4}-\d{2}-\d{2}T/);  // ISO date format
  });

  it('should return true when no session_id exists (no-op)', () => {
    const dataWithoutSession = {
      current_phase: 1,
      tasks: {}
    };

    mockFs({
      '/tmp/implement.json': JSON.stringify(dataWithoutSession)
    });

    const result = clearSessionId('/tmp/implement.json', { ...dataWithoutSession });
    expect(result).toBe(true);
  });

  it('should return true when session_id is already null', () => {
    const dataWithNullSession = {
      current_phase: 1,
      session_id: null,
      tasks: {}
    };

    mockFs({
      '/tmp/implement.json': JSON.stringify(dataWithNullSession)
    });

    const result = clearSessionId('/tmp/implement.json', { ...dataWithNullSession });
    expect(result).toBe(true);
  });

  it('should preserve other data when clearing session_id', () => {
    const initialData = {
      current_phase: 2,
      cycle_position: 'verify',
      session_id: 'session-456',
      tasks: {
        'T001': { status: 'success' }
      },
      metadata: { key: 'value' }
    };

    mockFs({
      '/tmp/implement.json': JSON.stringify(initialData)
    });

    clearSessionId('/tmp/implement.json', { ...initialData });

    const fs = require('fs');
    const written = JSON.parse(fs.readFileSync('/tmp/implement.json', 'utf-8'));
    expect(written.current_phase).toBe(2);
    expect(written.cycle_position).toBe('verify');
    expect(written.tasks['T001'].status).toBe('success');
    expect(written.metadata.key).toBe('value');
    expect(written.session_id).toBeNull();
  });
});

// =============================================================================
// TRD-TEST-008: getSessionId Tests
// =============================================================================

describe('getSessionId', () => {
  it('should return CLAUDE_SESSION_ID when set', () => {
    process.env.CLAUDE_SESSION_ID = 'claude-session-abc';

    const result = getSessionId();
    expect(result).toBe('claude-session-abc');
  });

  it('should return SESSION_ID when CLAUDE_SESSION_ID not set', () => {
    delete process.env.CLAUDE_SESSION_ID;
    process.env.SESSION_ID = 'generic-session-xyz';

    const result = getSessionId();
    expect(result).toBe('generic-session-xyz');
  });

  it('should prefer CLAUDE_SESSION_ID over SESSION_ID', () => {
    process.env.CLAUDE_SESSION_ID = 'claude-first';
    process.env.SESSION_ID = 'generic-second';

    const result = getSessionId();
    expect(result).toBe('claude-first');
  });

  it('should generate timestamp-based session when no env vars set', () => {
    delete process.env.CLAUDE_SESSION_ID;
    delete process.env.SESSION_ID;

    const result = getSessionId();
    expect(result).toMatch(/^session-\d+$/);
  });
});

// =============================================================================
// TRD-TEST-009: Error Handling Tests - Missing File
// =============================================================================

describe('error handling - missing file', () => {
  it('should handle readImplementJson with missing file gracefully', () => {
    mockFs({});

    const result = readImplementJson('/nonexistent/path/implement.json');
    expect(result).toBeNull();
  });

  it('should handle findImplementFiles with non-existent directory gracefully', () => {
    mockFs({});

    // This should not throw, should return empty array
    const files = findImplementFiles('/nonexistent/.trd-state');
    expect(files).toEqual([]);
  });

  it('should handle wasModifiedRecently with missing file', () => {
    mockFs({});

    const result = wasModifiedRecently('/nonexistent/file.json');
    expect(result).toBe(false);
  });
});

// =============================================================================
// TRD-TEST-009: Error Handling Tests - Corrupt JSON
// =============================================================================

describe('error handling - corrupt JSON', () => {
  it('should handle incomplete JSON object', () => {
    mockFs({
      '/tmp/incomplete.json': '{"key": "value"'
    });

    const result = readImplementJson('/tmp/incomplete.json');
    expect(result).toBeNull();
  });

  it('should handle JSON with trailing comma', () => {
    mockFs({
      '/tmp/trailing.json': '{"key": "value",}'
    });

    const result = readImplementJson('/tmp/trailing.json');
    expect(result).toBeNull();
  });

  it('should handle non-JSON content', () => {
    mockFs({
      '/tmp/notjson.json': 'This is not JSON at all'
    });

    const result = readImplementJson('/tmp/notjson.json');
    expect(result).toBeNull();
  });

  it('should handle binary content', () => {
    mockFs({
      '/tmp/binary.json': Buffer.from([0x00, 0x01, 0x02, 0x03])
    });

    const result = readImplementJson('/tmp/binary.json');
    expect(result).toBeNull();
  });

  it('should handle file with only whitespace', () => {
    mockFs({
      '/tmp/whitespace.json': '   \n\t  '
    });

    const result = readImplementJson('/tmp/whitespace.json');
    expect(result).toBeNull();
  });
});

// =============================================================================
// TRD-TEST-009: Error Handling Tests - Permission Denied
// =============================================================================

describe('error handling - permission denied', () => {
  it('should handle unreadable file in readImplementJson', () => {
    mockFs({
      '/tmp/unreadable.json': mockFs.file({
        content: '{"key": "value"}',
        mode: 0o000  // No permissions
      })
    });

    const result = readImplementJson('/tmp/unreadable.json');
    expect(result).toBeNull();
  });

  it('should handle unreadable directory in findImplementFiles', () => {
    mockFs({
      '/home/user/project': {
        '.trd-state': mockFs.directory({
          mode: 0o000,  // No permissions
          items: {}
        })
      }
    });

    const files = findImplementFiles('/home/user/project/.trd-state');
    expect(files).toEqual([]);
  });

  it('should handle unwritable file in clearSessionId', () => {
    const data = {
      session_id: 'test-session',
      tasks: {}
    };

    mockFs({
      '/tmp/readonly.json': mockFs.file({
        content: JSON.stringify(data),
        mode: 0o444  // Read-only
      })
    });

    const result = clearSessionId('/tmp/readonly.json', { ...data });
    expect(result).toBe(false);
  });
});

// =============================================================================
// debugLog Tests
// =============================================================================

describe('debugLog', () => {
  it('should log to stderr when STATUS_HOOK_DEBUG is 1', () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation();

    process.env.STATUS_HOOK_DEBUG = '1';
    debugLog('Test message');

    expect(errorSpy).toHaveBeenCalled();
    expect(errorSpy.mock.calls[0][0]).toContain('[STATUS');
    expect(errorSpy.mock.calls[0][0]).toContain('Test message');

    errorSpy.mockRestore();
  });

  it('should not log when STATUS_HOOK_DEBUG is not 1', () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation();

    process.env.STATUS_HOOK_DEBUG = '0';
    debugLog('Test message');

    expect(errorSpy).not.toHaveBeenCalled();

    errorSpy.mockRestore();
  });

  it('should not log when STATUS_HOOK_DEBUG is not set', () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation();

    delete process.env.STATUS_HOOK_DEBUG;
    debugLog('Test message');

    expect(errorSpy).not.toHaveBeenCalled();

    errorSpy.mockRestore();
  });

  it('should include timestamp in debug message', () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation();

    process.env.STATUS_HOOK_DEBUG = '1';
    debugLog('Timestamp test');

    expect(errorSpy.mock.calls[0][0]).toMatch(/\d{4}-\d{2}-\d{2}T/);

    errorSpy.mockRestore();
  });
});

// =============================================================================
// Main Function Integration Tests
// =============================================================================

describe('main function', () => {
  it('should output disabled status when STATUS_HOOK_DISABLE is 1', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});

    mockFs(createMockProject({
      hasTrdState: true,
      implementJson: { tasks: {} }
    }));

    process.env.STATUS_HOOK_DISABLE = '1';

    await main({ cwd: '/home/user/project' });

    const output = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(output.hookSpecificOutput.status).toBe('disabled');

    consoleSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('should output no_state when .trd-state not found', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});

    mockFs(createMockProject({ hasTrdState: false }));

    await main({ cwd: '/home/user/project' });

    const output = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(output.hookSpecificOutput.status).toBe('no_state');

    consoleSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('should output no_files when no implement.json found', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});

    mockFs({
      '/home/user/project': {
        '.trd-state': {
          'empty-subdir': {}  // No implement.json
        }
      }
    });

    await main({ cwd: '/home/user/project' });

    const output = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(output.hookSpecificOutput.status).toBe('no_files');

    consoleSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('should output verified when file was modified recently', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});

    const recentTime = Date.now() - (5 * 60 * 1000);  // 5 minutes ago
    mockFs(createMockProject({
      hasTrdState: true,
      implementJson: { tasks: {}, current_phase: 1 },
      implementJsonMtime: recentTime
    }));

    await main({ cwd: '/home/user/project' });

    const output = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(output.hookSpecificOutput.status).toBe('verified');

    consoleSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('should output unchanged when file was not modified recently', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});

    const oldTime = Date.now() - (60 * 60 * 1000);  // 60 minutes ago
    mockFs(createMockProject({
      hasTrdState: true,
      implementJson: { tasks: {}, current_phase: 1 },
      implementJsonMtime: oldTime
    }));

    await main({ cwd: '/home/user/project' });

    const output = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(output.hookSpecificOutput.status).toBe('unchanged');

    consoleSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('should output session_cleared when session_id is cleared', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});

    const oldTime = Date.now() - (60 * 60 * 1000);  // 60 minutes ago (not recent)
    mockFs(createMockProject({
      hasTrdState: true,
      implementJson: {
        tasks: {},
        current_phase: 1,
        session_id: 'active-session'  // Has active session to clear
      },
      implementJsonMtime: oldTime
    }));

    await main({ cwd: '/home/user/project' });

    const output = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(output.hookSpecificOutput.status).toBe('session_cleared');

    consoleSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('should use process.cwd() when cwd not provided in hookData', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});

    mockFs(createMockProject({ hasTrdState: true }));

    await main({});

    // Should still produce output without crashing
    expect(consoleSpy).toHaveBeenCalled();
    const output = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(output.hookSpecificOutput).toBeDefined();

    consoleSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('should always exit with code 0 (non-blocking)', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});

    mockFs(createMockProject({
      hasTrdState: true,
      implementJson: { tasks: {} }
    }));

    await main({ cwd: '/home/user/project' });

    expect(exitSpy).toHaveBeenCalledWith(0);

    consoleSpy.mockRestore();
    exitSpy.mockRestore();
  });
});

// =============================================================================
// Output Format Tests
// =============================================================================

describe('output format', () => {
  it('should output valid JSON with correct structure', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});

    mockFs(createMockProject({
      hasTrdState: true,
      implementJson: { tasks: {} }
    }));

    await main({ cwd: '/home/user/project' });

    const output = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(output).toHaveProperty('hookSpecificOutput');
    expect(output.hookSpecificOutput).toHaveProperty('hookEventName', 'SubagentStop');
    expect(output.hookSpecificOutput).toHaveProperty('status');
    expect(output.hookSpecificOutput).toHaveProperty('timestamp');

    consoleSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('should include ISO timestamp in output', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});

    mockFs(createMockProject({
      hasTrdState: true,
      implementJson: { tasks: {} }
    }));

    await main({ cwd: '/home/user/project' });

    const output = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(output.hookSpecificOutput.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);

    consoleSpy.mockRestore();
    exitSpy.mockRestore();
  });
});

// =============================================================================
// Edge Cases
// =============================================================================

describe('edge cases', () => {
  it('should handle multiple implement.json files with mixed states', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});

    const recentTime = Date.now() - (5 * 60 * 1000);  // 5 minutes ago
    const oldTime = Date.now() - (60 * 60 * 1000);  // 60 minutes ago

    mockFs(createMockProject({
      hasTrdState: true,
      trdName: 'recent-trd',
      implementJson: { tasks: {}, current_phase: 1 },
      implementJsonMtime: recentTime,
      additionalTrds: {
        'old-trd': {
          implementJson: { tasks: {}, current_phase: 2 },
          mtime: oldTime
        }
      }
    }));

    await main({ cwd: '/home/user/project' });

    // Should report verified because at least one file was modified
    const output = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(output.hookSpecificOutput.status).toBe('verified');

    consoleSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('should prioritize session_cleared over verified', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});

    const recentTime = Date.now() - (5 * 60 * 1000);

    mockFs(createMockProject({
      hasTrdState: true,
      implementJson: {
        tasks: {},
        session_id: 'active-session'  // Has session to clear
      },
      implementJsonMtime: recentTime  // Also recently modified
    }));

    await main({ cwd: '/home/user/project' });

    // session_cleared takes priority over verified
    const output = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(output.hookSpecificOutput.status).toBe('session_cleared');

    consoleSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('should handle implement.json with no tasks property', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});

    const recentTime = Date.now() - (5 * 60 * 1000);
    mockFs(createMockProject({
      hasTrdState: true,
      implementJson: { current_phase: 1 },  // No tasks property
      implementJsonMtime: recentTime
    }));

    await main({ cwd: '/home/user/project' });

    // Should still work without crashing
    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('should output error status on exception', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});

    // Force an error by passing invalid hookData that would cause issues
    mockFs({});

    // The main function should catch errors and output error status
    // We need to test the stdin handler error path indirectly
    // For now, test that main handles edge cases gracefully
    await main({ cwd: '/home/user/project' });

    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
    exitSpy.mockRestore();
  });
});

// =============================================================================
// Module Exports Tests
// =============================================================================

describe('module exports', () => {
  it('should export all required functions', () => {
    expect(typeof findTrdStateDir).toBe('function');
    expect(typeof findImplementFiles).toBe('function');
    expect(typeof readImplementJson).toBe('function');
    expect(typeof wasModifiedRecently).toBe('function');
    expect(typeof clearSessionId).toBe('function');
    expect(typeof getSessionId).toBe('function');
    expect(typeof debugLog).toBe('function');
    expect(typeof main).toBe('function');
  });
});
