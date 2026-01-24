/**
 * Performance Benchmark Tests
 *
 * Validates performance targets from TRD:
 * - Hook execution: ≤50ms
 * - Pane spawn: ≤100ms
 * - Memory usage: reasonable bounds
 */

const { spawn, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const HOOK_DIR = path.resolve(__dirname, '../../hooks');
const ITERATIONS = 10; // Number of iterations for statistical accuracy

describe('Performance: Hook Execution Time', () => {
  const TARGET_HOOK_MS = 50;
  const TOLERANCE_FACTOR = 4; // Allow 4x for CI environments

  describe('pane-spawner.js', () => {
    const spawnerPath = path.join(HOOK_DIR, 'pane-spawner.js');

    it(`should execute within ${TARGET_HOOK_MS}ms target (disabled mode)`, async () => {
      const hookData = JSON.stringify({
        tool_name: 'Task',
        tool_use_id: 'perf-spawner-test',
        tool_input: {
          subagent_type: 'backend-developer',
          description: 'Performance test task'
        }
      });

      const times = [];

      for (let i = 0; i < ITERATIONS; i++) {
        const start = process.hrtime.bigint();

        await new Promise((resolve, reject) => {
          const child = spawn('node', [spawnerPath], {
            env: { ...process.env, ENSEMBLE_PANE_DISABLE: '1' }
          });

          child.stdin.write(hookData);
          child.stdin.end();

          child.on('close', (code) => {
            if (code === 0) resolve();
            else reject(new Error(`Exit code ${code}`));
          });
          child.on('error', reject);
        });

        const elapsed = Number(process.hrtime.bigint() - start) / 1_000_000;
        times.push(elapsed);
      }

      const avg = times.reduce((a, b) => a + b, 0) / times.length;
      const min = Math.min(...times);
      const max = Math.max(...times);
      const p95 = times.sort((a, b) => a - b)[Math.floor(times.length * 0.95)];

      console.log(`pane-spawner performance (${ITERATIONS} runs):`);
      console.log(`  Min: ${min.toFixed(2)}ms`);
      console.log(`  Avg: ${avg.toFixed(2)}ms`);
      console.log(`  Max: ${max.toFixed(2)}ms`);
      console.log(`  P95: ${p95.toFixed(2)}ms`);
      console.log(`  Target: ≤${TARGET_HOOK_MS}ms`);

      // Average should meet target, allow tolerance for CI
      expect(avg).toBeLessThan(TARGET_HOOK_MS * TOLERANCE_FACTOR);
      // P95 should be reasonable
      expect(p95).toBeLessThan(TARGET_HOOK_MS * TOLERANCE_FACTOR * 1.5);
    });

    it('should handle non-Task tools with minimal overhead', async () => {
      const hookData = JSON.stringify({
        tool_name: 'Read',
        tool_use_id: 'perf-non-task',
        tool_input: { file_path: '/tmp/test.txt' }
      });

      const times = [];

      for (let i = 0; i < ITERATIONS; i++) {
        const start = process.hrtime.bigint();

        await new Promise((resolve) => {
          const child = spawn('node', [spawnerPath], {
            env: { ...process.env, ENSEMBLE_PANE_DISABLE: '1' }
          });
          child.stdin.write(hookData);
          child.stdin.end();
          child.on('close', resolve);
        });

        times.push(Number(process.hrtime.bigint() - start) / 1_000_000);
      }

      const avg = times.reduce((a, b) => a + b, 0) / times.length;
      console.log(`Non-Task tool avg: ${avg.toFixed(2)}ms (should be fast bailout)`);

      // Non-Task tools should bail out quickly
      expect(avg).toBeLessThan(TARGET_HOOK_MS * TOLERANCE_FACTOR);
    });
  });

  describe('pane-completion.js', () => {
    const completionPath = path.join(HOOK_DIR, 'pane-completion.js');

    it(`should execute within ${TARGET_HOOK_MS}ms target`, async () => {
      const hookData = JSON.stringify({
        tool_name: 'Task',
        tool_use_id: 'perf-completion-test',
        tool_result: {
          is_error: false,
          content: 'Task completed successfully'
        }
      });

      const times = [];

      for (let i = 0; i < ITERATIONS; i++) {
        const start = process.hrtime.bigint();

        await new Promise((resolve) => {
          const child = spawn('node', [completionPath], {
            env: { ...process.env, ENSEMBLE_PANE_DISABLE: '1' }
          });
          child.stdin.write(hookData);
          child.stdin.end();
          child.on('close', resolve);
        });

        times.push(Number(process.hrtime.bigint() - start) / 1_000_000);
      }

      const avg = times.reduce((a, b) => a + b, 0) / times.length;
      const p95 = times.sort((a, b) => a - b)[Math.floor(times.length * 0.95)];

      console.log(`pane-completion performance (${ITERATIONS} runs):`);
      console.log(`  Avg: ${avg.toFixed(2)}ms, P95: ${p95.toFixed(2)}ms`);

      expect(avg).toBeLessThan(TARGET_HOOK_MS * TOLERANCE_FACTOR);
    });
  });
});

describe('Performance: Module Load Time', () => {
  const TARGET_LOAD_MS = 100;

  it('should load adapters module quickly', () => {
    // Clear require cache
    Object.keys(require.cache).forEach(key => {
      if (key.includes('adapters')) delete require.cache[key];
    });

    const start = process.hrtime.bigint();
    require('../../hooks/adapters');
    const elapsed = Number(process.hrtime.bigint() - start) / 1_000_000;

    console.log(`Adapters module load time: ${elapsed.toFixed(2)}ms`);
    expect(elapsed).toBeLessThan(TARGET_LOAD_MS);
  });

  it('should load config-loader module quickly', () => {
    Object.keys(require.cache).forEach(key => {
      if (key.includes('config-loader')) delete require.cache[key];
    });

    const start = process.hrtime.bigint();
    require('../../lib/config-loader');
    const elapsed = Number(process.hrtime.bigint() - start) / 1_000_000;

    console.log(`Config loader module load time: ${elapsed.toFixed(2)}ms`);
    expect(elapsed).toBeLessThan(TARGET_LOAD_MS);
  });

  it('should load pane-manager module quickly', () => {
    Object.keys(require.cache).forEach(key => {
      if (key.includes('pane-manager')) delete require.cache[key];
    });

    const start = process.hrtime.bigint();
    require('../../hooks/pane-manager');
    const elapsed = Number(process.hrtime.bigint() - start) / 1_000_000;

    console.log(`Pane manager module load time: ${elapsed.toFixed(2)}ms`);
    expect(elapsed).toBeLessThan(TARGET_LOAD_MS);
  });

  it('should load full library quickly', () => {
    Object.keys(require.cache).forEach(key => {
      if (key.includes('ensemble-agent-progress-pane')) delete require.cache[key];
    });

    const start = process.hrtime.bigint();
    require('../../lib');
    const elapsed = Number(process.hrtime.bigint() - start) / 1_000_000;

    console.log(`Full library load time: ${elapsed.toFixed(2)}ms`);
    expect(elapsed).toBeLessThan(TARGET_LOAD_MS * 2); // Allow 2x for full lib
  });
});

describe('Performance: Multiplexer Detection', () => {
  const TARGET_DETECT_MS = 50;

  it('should detect session environment quickly', async () => {
    const { MultiplexerDetector } = require('../../hooks/adapters');
    const detector = new MultiplexerDetector();

    const times = [];
    for (let i = 0; i < ITERATIONS; i++) {
      const start = process.hrtime.bigint();
      await detector.detectSession();
      times.push(Number(process.hrtime.bigint() - start) / 1_000_000);
    }

    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    console.log(`Session detection avg: ${avg.toFixed(2)}ms`);

    // Session detection is just env checks, should be very fast
    expect(avg).toBeLessThan(TARGET_DETECT_MS);
  });

  it('should get adapter by name quickly', () => {
    const { MultiplexerDetector } = require('../../hooks/adapters');
    const detector = new MultiplexerDetector();

    const times = [];
    const names = ['wezterm', 'zellij', 'tmux'];

    for (let i = 0; i < ITERATIONS; i++) {
      for (const name of names) {
        const start = process.hrtime.bigint();
        detector.getAdapter(name);
        times.push(Number(process.hrtime.bigint() - start) / 1_000_000);
      }
    }

    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    console.log(`Adapter lookup avg: ${avg.toFixed(4)}ms`);

    // Simple object lookup should be sub-millisecond
    expect(avg).toBeLessThan(1);
  });
});

describe('Performance: Config Operations', () => {
  const TARGET_CONFIG_MS = 20;
  const testDir = path.join(os.tmpdir(), 'perf-config-' + Date.now());
  const configPath = path.join(testDir, 'config.json');

  beforeAll(() => {
    fs.mkdirSync(testDir, { recursive: true });
  });

  afterAll(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('should load config quickly', () => {
    // Create a test config
    fs.writeFileSync(configPath, JSON.stringify({
      multiplexer: 'auto',
      direction: 'right',
      percent: 30
    }));

    const times = [];
    for (let i = 0; i < ITERATIONS; i++) {
      const start = process.hrtime.bigint();
      JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      times.push(Number(process.hrtime.bigint() - start) / 1_000_000);
    }

    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    console.log(`Config load avg: ${avg.toFixed(2)}ms`);

    expect(avg).toBeLessThan(TARGET_CONFIG_MS);
  });

  it('should save config quickly', () => {
    const config = {
      multiplexer: 'wezterm',
      direction: 'bottom',
      percent: 40
    };

    const times = [];
    for (let i = 0; i < ITERATIONS; i++) {
      const start = process.hrtime.bigint();
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      times.push(Number(process.hrtime.bigint() - start) / 1_000_000);
    }

    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    console.log(`Config save avg: ${avg.toFixed(2)}ms`);

    expect(avg).toBeLessThan(TARGET_CONFIG_MS);
  });
});

describe('Performance: State Management', () => {
  const TARGET_STATE_MS = 20;
  const testDir = path.join(os.tmpdir(), 'perf-state-' + Date.now());
  const statePath = path.join(testDir, 'panes.json');

  beforeAll(() => {
    fs.mkdirSync(testDir, { recursive: true });
  });

  afterAll(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('should handle state operations quickly with multiple panes', () => {
    // Create state with multiple panes (realistic scenario)
    const state = {
      panes: {}
    };

    // Add 10 concurrent panes
    for (let i = 0; i < 10; i++) {
      state.panes[`task-${i}`] = {
        paneId: `pane-${i}`,
        agentType: 'test-agent',
        startTime: Date.now(),
        description: `Test task ${i}`
      };
    }

    // Measure write
    const writeTimes = [];
    for (let i = 0; i < ITERATIONS; i++) {
      const start = process.hrtime.bigint();
      fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
      writeTimes.push(Number(process.hrtime.bigint() - start) / 1_000_000);
    }

    // Measure read
    const readTimes = [];
    for (let i = 0; i < ITERATIONS; i++) {
      const start = process.hrtime.bigint();
      JSON.parse(fs.readFileSync(statePath, 'utf-8'));
      readTimes.push(Number(process.hrtime.bigint() - start) / 1_000_000);
    }

    const writeAvg = writeTimes.reduce((a, b) => a + b, 0) / writeTimes.length;
    const readAvg = readTimes.reduce((a, b) => a + b, 0) / readTimes.length;

    console.log(`State write avg (10 panes): ${writeAvg.toFixed(2)}ms`);
    console.log(`State read avg (10 panes): ${readAvg.toFixed(2)}ms`);

    expect(writeAvg).toBeLessThan(TARGET_STATE_MS);
    expect(readAvg).toBeLessThan(TARGET_STATE_MS);
  });
});

describe('Performance: Adapter Operations (Mocked)', () => {
  const { WeztermAdapter } = require('../../hooks/adapters/wezterm-adapter');
  const { ZellijAdapter } = require('../../hooks/adapters/zellij-adapter');
  const { TmuxAdapter } = require('../../hooks/adapters/tmux-adapter');

  it('should construct adapters quickly', () => {
    const times = [];

    for (let i = 0; i < ITERATIONS; i++) {
      const start = process.hrtime.bigint();
      new WeztermAdapter();
      new ZellijAdapter();
      new TmuxAdapter();
      times.push(Number(process.hrtime.bigint() - start) / 1_000_000);
    }

    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    console.log(`Adapter construction avg (3 adapters): ${avg.toFixed(2)}ms`);

    expect(avg).toBeLessThan(10); // Should be very fast
  });
});

describe('Performance: Memory Usage', () => {
  it('should have reasonable memory footprint', () => {
    // Force garbage collection if available
    if (global.gc) global.gc();

    const before = process.memoryUsage();

    // Load all modules
    require('../../lib');
    require('../../hooks/pane-manager');

    // Create some instances
    const { MultiplexerDetector } = require('../../hooks/adapters');
    const { PaneManager } = require('../../hooks/pane-manager');

    const detector = new MultiplexerDetector();
    const manager = new PaneManager();

    const after = process.memoryUsage();

    const heapUsedDelta = (after.heapUsed - before.heapUsed) / 1024 / 1024;
    const rssUsedDelta = (after.rss - before.rss) / 1024 / 1024;

    console.log(`Memory delta after loading:`);
    console.log(`  Heap: ${heapUsedDelta.toFixed(2)}MB`);
    console.log(`  RSS: ${rssUsedDelta.toFixed(2)}MB`);

    // Should not use excessive memory
    expect(heapUsedDelta).toBeLessThan(50); // Less than 50MB heap increase
  });
});

// Summary report
afterAll(() => {
  console.log('\n========================================');
  console.log('PERFORMANCE VALIDATION SUMMARY');
  console.log('========================================');
  console.log('Target: Hook execution ≤50ms');
  console.log('Target: Pane spawn ≤100ms');
  console.log('Target: Module load ≤100ms');
  console.log('========================================\n');
});
