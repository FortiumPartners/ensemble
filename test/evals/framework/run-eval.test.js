/**
 * run-eval.js - Unit Tests
 * TRD Task: TRD-TEST-067
 *
 * Tests for the evaluation orchestrator main entry point.
 * Following TDD methodology - write tests first.
 */

const path = require('path');

describe('run-eval.js', () => {
  // Store original process.argv
  const originalArgv = process.argv;
  let runEval;
  let mockFs;
  let mockSpawn;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    // Reset process.argv
    process.argv = ['node', 'run-eval.js'];

    // Setup mocks before requiring module
    mockFs = {
      existsSync: jest.fn().mockReturnValue(true),
      readFileSync: jest.fn(),
      mkdirSync: jest.fn(),
      writeFileSync: jest.fn()
    };

    mockSpawn = jest.fn();

    jest.doMock('fs', () => mockFs);
    jest.doMock('child_process', () => ({ spawn: mockSpawn }));

    // Require fresh module with mocks
    runEval = require('./run-eval');
  });

  afterEach(() => {
    process.argv = originalArgv;
    jest.resetModules();
  });

  describe('parseArgs', () => {
    it('should parse spec file path as first positional argument', () => {
      const args = runEval.parseArgs(['specs/test.yaml']);

      expect(args.specPath).toBe('specs/test.yaml');
    });

    it('should parse --parallel flag with numeric value', () => {
      const args = runEval.parseArgs(['spec.yaml', '--parallel', '5']);

      expect(args.parallel).toBe(5);
    });

    it('should parse --sequential flag and set parallel to 1', () => {
      const args = runEval.parseArgs(['spec.yaml', '--sequential']);

      expect(args.sequential).toBe(true);
      expect(args.parallel).toBe(1);
    });

    it('should parse --output flag with directory path', () => {
      const args = runEval.parseArgs(['spec.yaml', '--output', 'custom/dir']);

      expect(args.outputDir).toBe('custom/dir');
    });

    it('should parse --timeout flag with seconds value', () => {
      const args = runEval.parseArgs(['spec.yaml', '--timeout', '600']);

      expect(args.timeout).toBe(600);
    });

    it('should parse --quiet flag', () => {
      const args = runEval.parseArgs(['spec.yaml', '--quiet']);

      expect(args.quiet).toBe(true);
    });

    it('should parse --dry-run flag', () => {
      const args = runEval.parseArgs(['spec.yaml', '--dry-run']);

      expect(args.dryRun).toBe(true);
    });

    it('should parse --help flag', () => {
      const args = runEval.parseArgs(['--help']);

      expect(args.help).toBe(true);
    });

    it('should use default values when flags not provided', () => {
      const args = runEval.parseArgs(['spec.yaml']);

      expect(args.parallel).toBe(2); // default
      expect(args.timeout).toBe(300); // default
      expect(args.quiet).toBe(false);
      expect(args.dryRun).toBe(false);
    });
  });

  describe('loadSpec', () => {
    it('should load and parse valid YAML spec file', () => {
      const validSpec = `
name: test-eval
version: 1.0
variants:
  - id: without_skill
    prompt_suffix: ""
  - id: with_skill
    prompt_suffix: "Use the skill"
checks:
  - name: file_exists
    check: "test -f output.txt"
metrics:
  - name: code_quality
    rubric: code-quality.md
`;

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(validSpec);

      const spec = runEval.loadSpec('/path/to/spec.yaml');

      expect(spec.name).toBe('test-eval');
      expect(spec.version).toBe(1.0);
      expect(spec.variants).toHaveLength(2);
    });

    it('should throw error for non-existent spec file', () => {
      mockFs.existsSync.mockReturnValue(false);

      expect(() => {
        runEval.loadSpec('/nonexistent/spec.yaml');
      }).toThrow(/not found|does not exist/i);
    });

    it('should throw error for invalid YAML syntax', () => {
      const invalidYaml = `
name: test-eval
  bad-indent: true
    nested: wrong
`;
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(invalidYaml);

      expect(() => {
        runEval.loadSpec('/path/to/invalid.yaml');
      }).toThrow(/yaml|parse|failed/i);
    });
  });

  describe('validateSpec', () => {
    it('should pass validation for spec with all required fields', () => {
      const validSpec = {
        name: 'test-eval',
        variants: [{ id: 'a' }, { id: 'b' }],
        checks: [{ name: 'check1' }],
        metrics: [{ name: 'metric1' }]
      };

      expect(() => {
        runEval.validateSpec(validSpec);
      }).not.toThrow();
    });

    it('should throw error when name is missing', () => {
      const invalidSpec = {
        variants: [{ id: 'a' }],
        checks: [],
        metrics: []
      };

      expect(() => {
        runEval.validateSpec(invalidSpec);
      }).toThrow(/name/i);
    });

    it('should throw error when variants is missing', () => {
      const invalidSpec = {
        name: 'test',
        checks: [],
        metrics: []
      };

      expect(() => {
        runEval.validateSpec(invalidSpec);
      }).toThrow(/variants/i);
    });

    it('should throw error when variants is empty', () => {
      const invalidSpec = {
        name: 'test',
        variants: [],
        checks: [],
        metrics: []
      };

      expect(() => {
        runEval.validateSpec(invalidSpec);
      }).toThrow(/variants/i);
    });

    it('should throw error when checks is missing', () => {
      const invalidSpec = {
        name: 'test',
        variants: [{ id: 'a' }],
        metrics: []
      };

      expect(() => {
        runEval.validateSpec(invalidSpec);
      }).toThrow(/checks/i);
    });

    it('should throw error when metrics is missing', () => {
      const invalidSpec = {
        name: 'test',
        variants: [{ id: 'a' }],
        checks: []
      };

      expect(() => {
        runEval.validateSpec(invalidSpec);
      }).toThrow(/metrics/i);
    });

    it('should validate variant has required id field', () => {
      const invalidSpec = {
        name: 'test',
        variants: [{ prompt_suffix: 'no id' }],
        checks: [],
        metrics: []
      };

      expect(() => {
        runEval.validateSpec(invalidSpec);
      }).toThrow(/variant.*id/i);
    });
  });

  describe('createResultsDir', () => {
    it('should create results directory with eval name and timestamp', () => {
      const dir = runEval.createResultsDir('test-eval', '../results');

      expect(dir).toMatch(/test-eval_\d{4}-\d{2}-\d{2}/);
      expect(mockFs.mkdirSync).toHaveBeenCalled();
    });

    it('should use custom output directory when provided', () => {
      const dir = runEval.createResultsDir('test-eval', '../results', '/custom/output');

      expect(dir).toBe('/custom/output');
    });

    it('should create directory with recursive option', () => {
      runEval.createResultsDir('test-eval', '../results');

      expect(mockFs.mkdirSync).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ recursive: true })
      );
    });
  });

  describe('launchSessions', () => {
    function createMockProcess(sessionId = '', exitCode = 0) {
      const listeners = {};
      return {
        stdout: {
          on: jest.fn((event, cb) => {
            listeners[`stdout_${event}`] = cb;
            if (event === 'data' && sessionId) {
              setTimeout(() => cb(Buffer.from(sessionId)), 5);
            }
          })
        },
        stderr: {
          on: jest.fn((event, cb) => {
            listeners[`stderr_${event}`] = cb;
          })
        },
        on: jest.fn((event, cb) => {
          listeners[event] = cb;
          if (event === 'close') {
            setTimeout(() => cb(exitCode), 20);
          }
        }),
        _listeners: listeners
      };
    }

    it('should spawn run-session.sh for each variant', async () => {
      mockSpawn.mockImplementation(() => createMockProcess());

      const spec = {
        name: 'test',
        variants: [
          { id: 'variant_a', prompt_suffix: '' },
          { id: 'variant_b', prompt_suffix: 'with skill' }
        ]
      };

      await runEval.launchSessions(spec, '/output', { parallel: 2 });

      expect(mockSpawn).toHaveBeenCalledTimes(2);
    });

    it('should limit parallel execution based on parallel option', async () => {
      let concurrentCalls = 0;
      let maxConcurrent = 0;

      mockSpawn.mockImplementation(() => {
        concurrentCalls++;
        maxConcurrent = Math.max(maxConcurrent, concurrentCalls);

        const listeners = {};
        return {
          stdout: { on: jest.fn() },
          stderr: { on: jest.fn() },
          on: jest.fn((event, cb) => {
            if (event === 'close') {
              setTimeout(() => {
                concurrentCalls--;
                cb(0);
              }, 50);
            }
          })
        };
      });

      const spec = {
        name: 'test',
        variants: [
          { id: 'v1' },
          { id: 'v2' },
          { id: 'v3' },
          { id: 'v4' }
        ]
      };

      await runEval.launchSessions(spec, '/output', { parallel: 2 });

      expect(maxConcurrent).toBeLessThanOrEqual(2);
    });

    it('should run sequentially when parallel is 1', async () => {
      const callOrder = [];
      let callCount = 0;

      mockSpawn.mockImplementation(() => {
        const currentCall = ++callCount;
        callOrder.push({ started: currentCall });

        return {
          stdout: { on: jest.fn() },
          stderr: { on: jest.fn() },
          on: jest.fn((event, cb) => {
            if (event === 'close') {
              setTimeout(() => {
                callOrder.push({ ended: currentCall });
                cb(0);
              }, 10);
            }
          })
        };
      });

      const spec = {
        name: 'test',
        variants: [{ id: 'v1' }, { id: 'v2' }]
      };

      await runEval.launchSessions(spec, '/output', { parallel: 1 });

      // Sequential means v1 ends before v2 starts
      const v1EndIndex = callOrder.findIndex(e => e.ended === 1);
      const v2StartIndex = callOrder.findIndex(e => e.started === 2);
      expect(v1EndIndex).toBeLessThan(v2StartIndex);
    });

    it('should track session IDs for each variant', async () => {
      let sessionCounter = 0;
      mockSpawn.mockImplementation(() => {
        sessionCounter++;
        const sessionId = `session_${sessionCounter}`;
        return createMockProcess(sessionId, 0);
      });

      const spec = {
        name: 'test',
        variants: [{ id: 'v1' }, { id: 'v2' }]
      };

      const results = await runEval.launchSessions(spec, '/output', { parallel: 2 });

      expect(results).toHaveLength(2);
      expect(results[0]).toHaveProperty('session_id');
      expect(results[1]).toHaveProperty('session_id');
    });
  });

  describe('launchSession error handling', () => {
    it('should handle missing run-session.sh script', async () => {
      // Mock fs.existsSync to return false for the script
      mockFs.existsSync.mockReturnValue(false);

      const result = await runEval.launchSession({ id: 'test' }, '/output', 300);

      expect(result.exit_code).toBe(1);
      expect(result.error).toMatch(/not found|script/i);
    });

    it('should handle spawn ENOENT error', async () => {
      mockFs.existsSync.mockReturnValue(true);

      // Mock spawn to emit error
      const mockProc = {
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn((event, cb) => {
          if (event === 'error') {
            setTimeout(() => {
              const err = new Error('spawn ENOENT');
              err.code = 'ENOENT';
              cb(err);
            }, 5);
          }
        })
      };
      mockSpawn.mockReturnValue(mockProc);

      const result = await runEval.launchSession({ id: 'test' }, '/output', 300);

      expect(result.exit_code).toBe(1);
      expect(result.error).toMatch(/spawn|ENOENT/i);
    });
  });

  describe('reportProgress', () => {
    let consoleErrorSpy;

    beforeEach(() => {
      consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
      consoleErrorSpy.mockRestore();
    });

    it('should print progress to stderr', () => {
      runEval.reportProgress('test-eval', 'Running variant 1/2');

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('test-eval')
      );
    });

    it('should not print when quiet mode is enabled', () => {
      runEval.reportProgress('test-eval', 'Running', { quiet: true });

      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });

    it('should include variant progress info', () => {
      runEval.reportProgress('test-eval', 'Completed', {
        current: 2,
        total: 5
      });

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringMatching(/2.*5|2\/5/)
      );
    });
  });

  describe('handleErrors', () => {
    it('should gracefully handle missing spec file', async () => {
      mockFs.existsSync.mockReturnValue(false);

      const result = await runEval.run(['nonexistent.yaml']);

      expect(result.exit_code).not.toBe(0);
      expect(result.error).toMatch(/not found|does not exist/i);
    });

    it('should report validation errors with specific field names', async () => {
      const invalidSpec = `
version: 1.0
variants: []
`;
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(invalidSpec);

      const result = await runEval.run(['spec.yaml']);

      expect(result.exit_code).not.toBe(0);
      expect(result.error).toMatch(/name|variants/i);
    });

    it('should log session launch failures but not fail entire eval', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      const validSpec = `
name: test-eval
variants:
  - id: variant_a
  - id: variant_b
checks: []
metrics: []
`;
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(validSpec);

      let callCount = 0;
      mockSpawn.mockImplementation(() => {
        callCount++;
        const exitCode = callCount === 1 ? 1 : 0; // First fails

        return {
          stdout: { on: jest.fn() },
          stderr: {
            on: jest.fn((event, cb) => {
              if (event === 'data' && callCount === 1) {
                setTimeout(() => cb(Buffer.from('Session failed')), 5);
              }
            })
          },
          on: jest.fn((event, cb) => {
            if (event === 'close') setTimeout(() => cb(exitCode), 20);
          })
        };
      });

      const result = await runEval.run(['spec.yaml']);

      // Should not fail entirely - main eval continues
      expect(result.exit_code).toBe(0);
      consoleErrorSpy.mockRestore();
    });
  });

  describe('dryRun', () => {
    it('should validate spec without running sessions', async () => {
      const validSpec = `
name: test-eval
variants:
  - id: variant_a
  - id: variant_b
checks:
  - name: file_check
metrics:
  - name: quality
`;
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(validSpec);

      const result = await runEval.run(['spec.yaml', '--dry-run']);

      expect(mockSpawn).not.toHaveBeenCalled();
      expect(result.exit_code).toBe(0);
    });

    it('should print what would be executed', async () => {
      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

      const validSpec = `
name: test-eval
variants:
  - id: variant_a
  - id: variant_b
checks:
  - name: file_check
metrics:
  - name: quality
`;
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(validSpec);

      await runEval.run(['spec.yaml', '--dry-run']);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringMatching(/variant_a|variant_b/i)
      );

      consoleLogSpy.mockRestore();
    });
  });

  describe('CLI interface', () => {
    it('should show help when --help flag provided', async () => {
      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

      const result = await runEval.run(['--help']);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringMatching(/usage|options|arguments/i)
      );
      expect(result.exit_code).toBe(0);

      consoleLogSpy.mockRestore();
    });

    it('should exit with error when no spec file provided', async () => {
      const result = await runEval.run([]);

      expect(result.exit_code).not.toBe(0);
      expect(result.error).toMatch(/spec|argument|required/i);
    });

    it('should return exit code 0 on success', async () => {
      const validSpec = `
name: test-eval
variants:
  - id: variant_a
checks:
  - name: check1
metrics:
  - name: metric1
`;
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(validSpec);

      mockSpawn.mockImplementation(() => ({
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn((event, cb) => {
          if (event === 'close') setTimeout(() => cb(0), 10);
        })
      }));

      const result = await runEval.run(['spec.yaml']);

      expect(result.exit_code).toBe(0);
    });

    it('should return non-zero exit code on failure', async () => {
      mockFs.existsSync.mockReturnValue(false);

      const result = await runEval.run(['nonexistent.yaml']);

      expect(result.exit_code).not.toBe(0);
    });
  });

  describe('output directory', () => {
    it('should create results/<eval-name>_<timestamp>/ by default', async () => {
      const validSpec = `
name: my-eval-test
variants:
  - id: variant_a
checks: []
metrics: []
`;
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(validSpec);

      mockSpawn.mockImplementation(() => ({
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn((event, cb) => {
          if (event === 'close') setTimeout(() => cb(0), 10);
        })
      }));

      await runEval.run(['spec.yaml']);

      expect(mockFs.mkdirSync).toHaveBeenCalledWith(
        expect.stringMatching(/results.*my-eval-test_\d{4}-\d{2}-\d{2}/),
        expect.any(Object)
      );
    });

    it('should save session outputs and metadata', async () => {
      const validSpec = `
name: test-eval
variants:
  - id: variant_a
checks: []
metrics: []
`;
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(validSpec);

      mockSpawn.mockImplementation(() => ({
        stdout: {
          on: jest.fn((event, cb) => {
            if (event === 'data') setTimeout(() => cb(Buffer.from('session_123')), 5);
          })
        },
        stderr: { on: jest.fn() },
        on: jest.fn((event, cb) => {
          if (event === 'close') setTimeout(() => cb(0), 20);
        })
      }));

      await runEval.run(['spec.yaml']);

      // Should write metadata file
      expect(mockFs.writeFileSync).toHaveBeenCalledWith(
        expect.stringMatching(/sessions\.json/),
        expect.any(String)
      );
    });
  });
});
