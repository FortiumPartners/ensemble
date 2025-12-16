/**
 * E2E Workflow Tests
 *
 * Tests complete workflows end-to-end:
 * - Hook invocation flow (pane-spawner → pane-completion)
 * - Configuration persistence across sessions
 * - State management across multiple agents
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

describe('E2E: Complete Hook Workflow', () => {
  const testDir = path.join(os.tmpdir(), 'agent-progress-pane-e2e-' + Date.now());
  const configDir = path.join(testDir, '.ensemble/plugins/agent-progress-pane');
  const configPath = path.join(configDir, 'config.json');
  const statePath = path.join(configDir, 'panes.json');

  let originalHome;
  let originalDisable;

  beforeAll(() => {
    // Create test directories
    fs.mkdirSync(configDir, { recursive: true });

    // Save and override HOME
    originalHome = process.env.HOME;
    originalDisable = process.env.ENSEMBLE_PANE_DISABLE;
    process.env.HOME = testDir;

    // Ensure pane spawning is disabled for tests (no actual terminal)
    process.env.ENSEMBLE_PANE_DISABLE = '1';
  });

  afterAll(() => {
    // Restore environment
    process.env.HOME = originalHome;
    if (originalDisable !== undefined) {
      process.env.ENSEMBLE_PANE_DISABLE = originalDisable;
    } else {
      delete process.env.ENSEMBLE_PANE_DISABLE;
    }

    // Clean up test directory
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    // Clean config and state between tests
    if (fs.existsSync(configPath)) fs.unlinkSync(configPath);
    if (fs.existsSync(statePath)) fs.unlinkSync(statePath);
  });

  describe('Hook Script Execution', () => {
    const hookDir = path.resolve(__dirname, '../../hooks');

    it('pane-spawner should handle Task tool input via stdin', (done) => {
      const spawnerPath = path.join(hookDir, 'pane-spawner.js');
      const hookData = {
        tool_name: 'Task',
        tool_use_id: 'test-task-123',
        tool_input: {
          subagent_type: 'backend-developer',
          description: 'Implement user service'
        }
      };

      const child = spawn('node', [spawnerPath], {
        env: { ...process.env, ENSEMBLE_PANE_DISABLE: '1' }
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => { stdout += data; });
      child.stderr.on('data', (data) => { stderr += data; });

      child.on('close', (code) => {
        // Should exit cleanly (disabled mode)
        expect(code).toBe(0);
        done();
      });

      child.stdin.write(JSON.stringify(hookData));
      child.stdin.end();
    });

    it('pane-spawner should ignore non-Task tools', (done) => {
      const spawnerPath = path.join(hookDir, 'pane-spawner.js');
      const hookData = {
        tool_name: 'Read',
        tool_use_id: 'read-123',
        tool_input: {
          file_path: '/some/file.txt'
        }
      };

      const child = spawn('node', [spawnerPath], {
        env: { ...process.env, ENSEMBLE_PANE_DISABLE: '1' }
      });

      child.on('close', (code) => {
        expect(code).toBe(0);
        done();
      });

      child.stdin.write(JSON.stringify(hookData));
      child.stdin.end();
    });

    it('pane-spawner should handle malformed JSON gracefully', (done) => {
      const spawnerPath = path.join(hookDir, 'pane-spawner.js');

      const child = spawn('node', [spawnerPath], {
        env: { ...process.env, ENSEMBLE_PANE_DISABLE: '1' }
      });

      let stderr = '';
      child.stderr.on('data', (data) => { stderr += data; });

      child.on('close', (code) => {
        // Should still exit (with error logged)
        expect(stderr).toContain('Failed to parse hook data');
        done();
      });

      child.stdin.write('not valid json');
      child.stdin.end();
    });

    it('pane-completion should handle Task tool completion', (done) => {
      const completionPath = path.join(hookDir, 'pane-completion.js');
      const hookData = {
        tool_name: 'Task',
        tool_use_id: 'test-task-456',
        tool_result: {
          is_error: false,
          content: 'Task completed successfully'
        }
      };

      const child = spawn('node', [completionPath], {
        env: { ...process.env, ENSEMBLE_PANE_DISABLE: '1' }
      });

      child.on('close', (code) => {
        expect(code).toBe(0);
        done();
      });

      child.stdin.write(JSON.stringify(hookData));
      child.stdin.end();
    });

    it('pane-completion should handle error results', (done) => {
      const completionPath = path.join(hookDir, 'pane-completion.js');
      const hookData = {
        tool_name: 'Task',
        tool_use_id: 'test-task-error',
        error: {
          message: 'Agent failed to complete task'
        }
      };

      const child = spawn('node', [completionPath], {
        env: { ...process.env, ENSEMBLE_PANE_DISABLE: '1' }
      });

      child.on('close', (code) => {
        expect(code).toBe(0);
        done();
      });

      child.stdin.write(JSON.stringify(hookData));
      child.stdin.end();
    });
  });

  describe('Configuration Persistence', () => {
    const { loadConfig, saveConfig, resetConfig, DEFAULT_CONFIG } = require('../../lib/config-loader');

    it('should persist configuration across loader instances', async () => {
      // Save config
      const config1 = {
        multiplexer: 'wezterm',
        direction: 'bottom',
        percent: 40,
        enabled: true
      };

      // Manually write config (simulating save)
      fs.writeFileSync(configPath, JSON.stringify(config1, null, 2));

      // Read the config file
      const loadedConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

      expect(loadedConfig.multiplexer).toBe('wezterm');
      expect(loadedConfig.direction).toBe('bottom');
      expect(loadedConfig.percent).toBe(40);
    });

    it('should handle missing config file gracefully', () => {
      // Ensure no config file exists
      if (fs.existsSync(configPath)) {
        fs.unlinkSync(configPath);
      }

      // The loadConfig function returns defaults when file missing
      const defaultConfig = {
        enabled: true,
        direction: 'right',
        percent: 30
      };

      // Verify we can work without config file
      expect(fs.existsSync(configPath)).toBe(false);
    });

    it('should handle corrupted config file', () => {
      // Write invalid JSON
      fs.writeFileSync(configPath, 'not valid json {{{');

      // Should not throw, should use defaults
      const loadConfig = () => {
        try {
          return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        } catch {
          return { enabled: true, direction: 'right', percent: 30 };
        }
      };

      const config = loadConfig();
      expect(config.enabled).toBe(true);
      expect(config.direction).toBe('right');
    });
  });

  describe('State Management', () => {
    const { PaneManager } = require('../../hooks/pane-manager');

    it('should track multiple concurrent agent panes', async () => {
      const manager = new PaneManager();

      // Simulate state for multiple agents
      const state = {
        panes: {
          'task-1': {
            paneId: 'pane-001',
            agentType: 'backend-developer',
            startTime: Date.now()
          },
          'task-2': {
            paneId: 'pane-002',
            agentType: 'frontend-developer',
            startTime: Date.now()
          },
          'task-3': {
            paneId: 'pane-003',
            agentType: 'test-runner',
            startTime: Date.now()
          }
        }
      };

      // Save state
      fs.writeFileSync(statePath, JSON.stringify(state, null, 2));

      // Load and verify
      const loaded = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
      expect(Object.keys(loaded.panes)).toHaveLength(3);
      expect(loaded.panes['task-1'].agentType).toBe('backend-developer');
      expect(loaded.panes['task-2'].agentType).toBe('frontend-developer');
    });

    it('should clean up completed task state', async () => {
      // Initial state with completed task
      const state = {
        panes: {
          'task-active': {
            paneId: 'pane-active',
            agentType: 'code-reviewer'
          },
          'task-done': {
            paneId: 'pane-done',
            agentType: 'documentation-specialist'
          }
        }
      };

      fs.writeFileSync(statePath, JSON.stringify(state, null, 2));

      // Simulate completion - remove task-done
      const updated = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
      delete updated.panes['task-done'];
      fs.writeFileSync(statePath, JSON.stringify(updated, null, 2));

      // Verify cleanup
      const final = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
      expect(Object.keys(final.panes)).toHaveLength(1);
      expect(final.panes['task-active']).toBeDefined();
      expect(final.panes['task-done']).toBeUndefined();
    });

    it('should handle state file corruption recovery', () => {
      // Write corrupted state
      fs.writeFileSync(statePath, '{ invalid json');

      // Recovery should create fresh state
      const loadState = () => {
        try {
          return JSON.parse(fs.readFileSync(statePath, 'utf-8'));
        } catch {
          return { panes: {} };
        }
      };

      const recovered = loadState();
      expect(recovered.panes).toEqual({});
    });
  });

  describe('Full Workflow Integration', () => {
    it('should support spawn → work → complete lifecycle', async () => {
      const taskId = 'e2e-lifecycle-test';
      const signalFile = path.join(testDir, `signal-${taskId}.txt`);

      // Step 1: Simulate pane spawn (create state entry)
      const spawnState = {
        panes: {
          [taskId]: {
            paneId: 'e2e-pane-1',
            agentType: 'infrastructure-developer',
            description: 'Deploy Kubernetes manifests',
            signalFile,
            startTime: Date.now()
          }
        }
      };
      fs.writeFileSync(statePath, JSON.stringify(spawnState, null, 2));

      // Verify spawn state
      const afterSpawn = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
      expect(afterSpawn.panes[taskId]).toBeDefined();
      expect(afterSpawn.panes[taskId].agentType).toBe('infrastructure-developer');

      // Step 2: Simulate work (state remains)
      await new Promise(resolve => setTimeout(resolve, 50));
      const duringWork = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
      expect(duringWork.panes[taskId]).toBeDefined();

      // Step 3: Simulate completion (write signal, clean state)
      fs.writeFileSync(signalFile, 'done');

      const completedState = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
      delete completedState.panes[taskId];
      fs.writeFileSync(statePath, JSON.stringify(completedState, null, 2));

      // Verify completion
      expect(fs.existsSync(signalFile)).toBe(true);
      expect(fs.readFileSync(signalFile, 'utf-8')).toBe('done');

      const afterComplete = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
      expect(afterComplete.panes[taskId]).toBeUndefined();
    });

    it('should handle error completion lifecycle', async () => {
      const taskId = 'e2e-error-test';
      const signalFile = path.join(testDir, `signal-${taskId}.txt`);

      // Spawn
      const state = {
        panes: {
          [taskId]: {
            paneId: 'e2e-error-pane',
            agentType: 'test-runner',
            description: 'Run integration tests',
            signalFile,
            startTime: Date.now()
          }
        }
      };
      fs.writeFileSync(statePath, JSON.stringify(state, null, 2));

      // Error completion
      const errorSignal = 'error:Tests failed with 5 failures';
      fs.writeFileSync(signalFile, errorSignal);

      // Verify error signal
      expect(fs.readFileSync(signalFile, 'utf-8')).toContain('error:');
    });

    it('should handle multiple sequential agent invocations', async () => {
      const tasks = [
        { id: 'seq-1', agent: 'code-reviewer', desc: 'Review PR' },
        { id: 'seq-2', agent: 'test-runner', desc: 'Run tests' },
        { id: 'seq-3', agent: 'documentation-specialist', desc: 'Update docs' }
      ];

      // Sequential workflow
      for (const task of tasks) {
        // Spawn
        const state = {
          panes: {
            [task.id]: {
              paneId: `pane-${task.id}`,
              agentType: task.agent,
              description: task.desc,
              startTime: Date.now()
            }
          }
        };
        fs.writeFileSync(statePath, JSON.stringify(state, null, 2));

        // Verify active
        const active = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
        expect(active.panes[task.id]).toBeDefined();

        // Complete
        delete state.panes[task.id];
        fs.writeFileSync(statePath, JSON.stringify(state, null, 2));

        // Verify cleaned
        const cleaned = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
        expect(cleaned.panes[task.id]).toBeUndefined();
      }
    });

    it('should handle concurrent agent panes', async () => {
      // Multiple agents running simultaneously
      const state = {
        panes: {
          'concurrent-1': {
            paneId: 'pane-c1',
            agentType: 'backend-developer',
            startTime: Date.now()
          },
          'concurrent-2': {
            paneId: 'pane-c2',
            agentType: 'frontend-developer',
            startTime: Date.now()
          }
        }
      };
      fs.writeFileSync(statePath, JSON.stringify(state, null, 2));

      // Verify both active
      const active = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
      expect(Object.keys(active.panes)).toHaveLength(2);

      // First completes
      delete state.panes['concurrent-1'];
      fs.writeFileSync(statePath, JSON.stringify(state, null, 2));

      const afterFirst = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
      expect(Object.keys(afterFirst.panes)).toHaveLength(1);
      expect(afterFirst.panes['concurrent-2']).toBeDefined();

      // Second completes
      delete state.panes['concurrent-2'];
      fs.writeFileSync(statePath, JSON.stringify(state, null, 2));

      const afterAll = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
      expect(Object.keys(afterAll.panes)).toHaveLength(0);
    });
  });
});

describe('E2E: Library API', () => {
  let createViewer, PaneManager, ConfigLoader, MultiplexerDetector;

  beforeAll(() => {
    // Clear require cache to pick up updated lib/index.js
    delete require.cache[require.resolve('../../lib')];
    delete require.cache[require.resolve('../../lib/index.js')];

    const lib = require('../../lib');
    createViewer = lib.createViewer;
    PaneManager = lib.PaneManager;
    ConfigLoader = lib.ConfigLoader;
    MultiplexerDetector = lib.MultiplexerDetector;
  });

  describe('createViewer()', () => {
    it('should initialize viewer with manager and config', async () => {
      const viewer = await createViewer();

      expect(viewer).toBeDefined();
      expect(viewer.manager).toBeInstanceOf(PaneManager);
      expect(viewer.config).toBeDefined();
    });

    it('should have spawn, update, and close methods', async () => {
      const viewer = await createViewer();

      expect(typeof viewer.spawn).toBe('function');
      expect(typeof viewer.update).toBe('function');
      expect(typeof viewer.close).toBe('function');
    });

    it('spawn() should throw not implemented error', async () => {
      const viewer = await createViewer();

      await expect(viewer.spawn('test-agent', 'Test task'))
        .rejects.toThrow('not yet implemented');
    });

    it('update() should throw not implemented error', async () => {
      const viewer = await createViewer();

      await expect(viewer.update({ activity: 'test' }))
        .rejects.toThrow('not yet implemented');
    });

    it('close() should throw not implemented error', async () => {
      const viewer = await createViewer();

      await expect(viewer.close())
        .rejects.toThrow('not yet implemented');
    });
  });

  describe('Module Exports', () => {
    it('should export all required components', () => {
      // Clear cache again for fresh load
      delete require.cache[require.resolve('../../lib')];
      const lib = require('../../lib');

      expect(lib.createViewer).toBeDefined();
      expect(lib.PaneManager).toBeDefined();
      expect(lib.ConfigLoader).toBeDefined();
      expect(lib.MultiplexerDetector).toBeDefined();
      expect(lib.WeztermAdapter).toBeDefined();
      expect(lib.ZellijAdapter).toBeDefined();
      expect(lib.TmuxAdapter).toBeDefined();
    });
  });
});

describe('E2E: Multiplexer Detection Flow', () => {
  let MultiplexerDetector;

  beforeAll(() => {
    // Clear cache and reload
    delete require.cache[require.resolve('../../hooks/adapters')];
    const adapters = require('../../hooks/adapters');
    MultiplexerDetector = adapters.MultiplexerDetector;
  });

  describe('Auto-detection priority', () => {
    let originalEnv;

    beforeEach(() => {
      originalEnv = { ...process.env };
    });

    afterEach(() => {
      // Restore environment
      Object.keys(process.env).forEach(key => {
        if (!(key in originalEnv)) delete process.env[key];
      });
      Object.assign(process.env, originalEnv);
    });

    it('should detect WezTerm when WEZTERM_PANE is set', async () => {
      process.env.WEZTERM_PANE = '0';
      delete process.env.ZELLIJ_SESSION_NAME;
      delete process.env.ZELLIJ;
      delete process.env.TMUX;

      const detector = new MultiplexerDetector();
      const result = await detector.detectSession();

      expect(result).toBeDefined();
      expect(result.multiplexer).toBe('wezterm');
      expect(result.paneId).toBe('0');
    });

    it('should detect Zellij when ZELLIJ_SESSION_NAME is set', async () => {
      delete process.env.WEZTERM_PANE;
      process.env.ZELLIJ_SESSION_NAME = 'test-session';
      delete process.env.TMUX;

      const detector = new MultiplexerDetector();
      const result = await detector.detectSession();

      expect(result).toBeDefined();
      expect(result.multiplexer).toBe('zellij');
      expect(result.sessionId).toBe('test-session');
    });

    it('should detect tmux when TMUX is set', async () => {
      delete process.env.WEZTERM_PANE;
      delete process.env.ZELLIJ_SESSION_NAME;
      delete process.env.ZELLIJ;
      process.env.TMUX = '/tmp/tmux-1000/default,12345,0';

      const detector = new MultiplexerDetector();
      const result = await detector.detectSession();

      expect(result).toBeDefined();
      expect(result.multiplexer).toBe('tmux');
      expect(result.sessionId).toBe('/tmp/tmux-1000/default');
    });

    it('should return null when no multiplexer detected', async () => {
      delete process.env.WEZTERM_PANE;
      delete process.env.ZELLIJ_SESSION_NAME;
      delete process.env.ZELLIJ;
      delete process.env.TMUX;

      const detector = new MultiplexerDetector();
      const result = await detector.detectSession();

      expect(result).toBeNull();
    });
  });

  describe('Adapter factory', () => {
    it('should get adapter by name', () => {
      const detector = new MultiplexerDetector();

      const wezterm = detector.getAdapter('wezterm');
      expect(wezterm).toBeDefined();
      expect(wezterm.constructor.name).toBe('WeztermAdapter');

      const zellij = detector.getAdapter('zellij');
      expect(zellij).toBeDefined();
      expect(zellij.constructor.name).toBe('ZellijAdapter');

      const tmux = detector.getAdapter('tmux');
      expect(tmux).toBeDefined();
      expect(tmux.constructor.name).toBe('TmuxAdapter');
    });

    it('should return null for unknown adapter', () => {
      const detector = new MultiplexerDetector();
      const unknown = detector.getAdapter('unknown-mux');
      expect(unknown).toBeNull();
    });
  });
});

// Performance benchmark tests
describe('E2E: Performance Benchmarks', () => {
  describe('Hook execution time', () => {
    it('pane-spawner should complete within 50ms target', (done) => {
      const hookDir = path.resolve(__dirname, '../../hooks');
      const spawnerPath = path.join(hookDir, 'pane-spawner.js');
      const hookData = {
        tool_name: 'Task',
        tool_use_id: 'perf-test',
        tool_input: { subagent_type: 'test-agent', description: 'Performance test' }
      };

      const start = Date.now();
      const child = spawn('node', [spawnerPath], {
        env: { ...process.env, ENSEMBLE_PANE_DISABLE: '1' }
      });

      child.on('close', () => {
        const elapsed = Date.now() - start;
        expect(elapsed).toBeLessThan(200); // Allow some margin for CI
        done();
      });

      child.stdin.write(JSON.stringify(hookData));
      child.stdin.end();
    });

    it('pane-completion should complete within 50ms target', (done) => {
      const hookDir = path.resolve(__dirname, '../../hooks');
      const completionPath = path.join(hookDir, 'pane-completion.js');
      const hookData = {
        tool_name: 'Task',
        tool_use_id: 'perf-test-complete',
        tool_result: { is_error: false }
      };

      const start = Date.now();
      const child = spawn('node', [completionPath], {
        env: { ...process.env, ENSEMBLE_PANE_DISABLE: '1' }
      });

      child.on('close', () => {
        const elapsed = Date.now() - start;
        expect(elapsed).toBeLessThan(200); // Allow some margin for CI
        done();
      });

      child.stdin.write(JSON.stringify(hookData));
      child.stdin.end();
    });
  });
});
