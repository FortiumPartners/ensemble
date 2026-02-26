/**
 * Unit tests for Hook Bridge - OC-S2-HK-001 through OC-S2-HK-007, TEST-007, TEST-008
 *
 * TDD: These tests are written BEFORE the implementation.
 * Strategy: Validate hook parsing, matcher logic, env bridging, blocking behavior,
 * and integration with mock tool execution.
 *
 * Skills used: jest (test patterns, mocking, child_process mocking)
 */

'use strict';

const path = require('path');
const fs = require('fs');

const PKG_DIR = path.resolve(__dirname, '..');
const ROOT = path.resolve(__dirname, '..', '..', '..');

// ---------------------------------------------------------------------------
// OC-S2-HK-001: Hook bridge module exists
// ---------------------------------------------------------------------------
describe('OC-S2-HK-001: Hook bridge module structure', () => {
  it('should have src/hooks/ directory', () => {
    const hooksDir = path.join(PKG_DIR, 'src', 'hooks');
    expect(fs.existsSync(hooksDir)).toBe(true);
  });

  it('should have src/hooks/bridge.js module', () => {
    const bridgePath = path.join(PKG_DIR, 'src', 'hooks', 'bridge.js');
    expect(fs.existsSync(bridgePath)).toBe(true);
  });

  it('should export createHookBridge function', () => {
    const bridge = require('../src/hooks/bridge.js');
    expect(bridge.createHookBridge).toBeDefined();
    expect(typeof bridge.createHookBridge).toBe('function');
  });

  it('should export parseHooksJson function', () => {
    const bridge = require('../src/hooks/bridge.js');
    expect(bridge.parseHooksJson).toBeDefined();
    expect(typeof bridge.parseHooksJson).toBe('function');
  });

  it('should export matchToolName function', () => {
    const bridge = require('../src/hooks/bridge.js');
    expect(bridge.matchToolName).toBeDefined();
    expect(typeof bridge.matchToolName).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// OC-S2-HK-002: Hook parsing from hooks.json files
// ---------------------------------------------------------------------------
describe('OC-S2-HK-002: HookBridgeGenerator - hooks.json parsing', () => {
  const { parseHooksJson, discoverHooksFiles } = require('../src/hooks/bridge.js');

  it('should parse a minimal hooks.json with PreToolUse', () => {
    const hooksJson = {
      hooks: {
        PreToolUse: [{
          matcher: 'Task',
          hooks: [{
            type: 'command',
            command: '${CLAUDE_PLUGIN_ROOT}/hooks/pane-spawner.js',
          }],
        }],
      },
    };
    const result = parseHooksJson(hooksJson, '/fake/plugin/root');
    expect(result).toHaveLength(1);
    expect(result[0].point).toBe('PreToolUse');
    expect(result[0].matcher).toBe('Task');
    expect(result[0].command).toContain('pane-spawner.js');
    expect(result[0].pluginRoot).toBe('/fake/plugin/root');
  });

  it('should parse hooks.json with both PreToolUse and PostToolUse', () => {
    const hooksJson = {
      hooks: {
        PreToolUse: [{
          matcher: 'Task',
          hooks: [{ type: 'command', command: '${CLAUDE_PLUGIN_ROOT}/hooks/pre.js' }],
        }],
        PostToolUse: [{
          matcher: 'Task',
          hooks: [{ type: 'command', command: '${CLAUDE_PLUGIN_ROOT}/hooks/post.js' }],
        }],
      },
    };
    const result = parseHooksJson(hooksJson, '/fake/root');
    const preHooks = result.filter(h => h.point === 'PreToolUse');
    const postHooks = result.filter(h => h.point === 'PostToolUse');
    expect(preHooks).toHaveLength(1);
    expect(postHooks).toHaveLength(1);
  });

  it('should handle multiple hooks for the same point', () => {
    const hooksJson = {
      hooks: {
        PreToolUse: [
          {
            matcher: 'Task',
            hooks: [{ type: 'command', command: '${CLAUDE_PLUGIN_ROOT}/hooks/a.js' }],
          },
          {
            matcher: 'TodoWrite',
            hooks: [{ type: 'command', command: 'node ${CLAUDE_PLUGIN_ROOT}/hooks/b.js' }],
          },
        ],
      },
    };
    const result = parseHooksJson(hooksJson, '/fake/root');
    expect(result).toHaveLength(2);
    expect(result[0].matcher).toBe('Task');
    expect(result[1].matcher).toBe('TodoWrite');
  });

  it('should resolve ${CLAUDE_PLUGIN_ROOT} in command paths', () => {
    const hooksJson = {
      hooks: {
        PreToolUse: [{
          matcher: 'Task',
          hooks: [{ type: 'command', command: '${CLAUDE_PLUGIN_ROOT}/hooks/script.js' }],
        }],
      },
    };
    const result = parseHooksJson(hooksJson, '/my/plugin');
    expect(result[0].command).toBe('/my/plugin/hooks/script.js');
  });

  it('should handle "node" prefix in commands', () => {
    const hooksJson = {
      hooks: {
        PreToolUse: [{
          matcher: 'TodoWrite',
          hooks: [{ type: 'command', command: 'node ${CLAUDE_PLUGIN_ROOT}/hooks/task-spawner.js' }],
        }],
      },
    };
    const result = parseHooksJson(hooksJson, '/my/plugin');
    expect(result[0].command).toBe('node /my/plugin/hooks/task-spawner.js');
  });

  it('should skip non-PreToolUse/PostToolUse hook points', () => {
    const hooksJson = {
      hooks: {
        UserPromptSubmit: [{
          hooks: [{ type: 'command', command: 'router.py' }],
        }],
        PermissionRequest: [{
          matcher: 'Bash',
          hooks: [{ type: 'command', command: 'permitter.js' }],
        }],
        PreToolUse: [{
          matcher: 'Task',
          hooks: [{ type: 'command', command: '${CLAUDE_PLUGIN_ROOT}/hooks/pre.js' }],
        }],
      },
    };
    const result = parseHooksJson(hooksJson, '/fake/root');
    // Only PreToolUse and PostToolUse are bridgeable
    expect(result).toHaveLength(1);
    expect(result[0].point).toBe('PreToolUse');
  });

  it('should return empty array for hooks.json with no bridgeable hooks', () => {
    const hooksJson = {
      hooks: {
        UserPromptSubmit: [{
          hooks: [{ type: 'command', command: 'router.py' }],
        }],
      },
    };
    const result = parseHooksJson(hooksJson, '/fake/root');
    expect(result).toEqual([]);
  });

  it('should handle empty hooks object', () => {
    const result = parseHooksJson({ hooks: {} }, '/fake/root');
    expect(result).toEqual([]);
  });

  it('should handle missing hooks property', () => {
    const result = parseHooksJson({}, '/fake/root');
    expect(result).toEqual([]);
  });

  it('should handle hooks entry with no matcher (wildcard)', () => {
    const hooksJson = {
      hooks: {
        PreToolUse: [{
          hooks: [{ type: 'command', command: '${CLAUDE_PLUGIN_ROOT}/hooks/all.js' }],
        }],
      },
    };
    const result = parseHooksJson(hooksJson, '/fake/root');
    expect(result).toHaveLength(1);
    expect(result[0].matcher).toBe('*');
  });
});

// ---------------------------------------------------------------------------
// OC-S2-HK-002 continued: discoverHooksFiles
// ---------------------------------------------------------------------------
describe('OC-S2-HK-002: discoverHooksFiles', () => {
  const { discoverHooksFiles } = require('../src/hooks/bridge.js');

  it('should discover hooks.json files from packages directory', () => {
    const results = discoverHooksFiles(ROOT);
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);
  });

  it('should return objects with filePath and packageDir', () => {
    const results = discoverHooksFiles(ROOT);
    for (const entry of results) {
      expect(entry.filePath).toBeDefined();
      expect(entry.packageDir).toBeDefined();
      expect(fs.existsSync(entry.filePath)).toBe(true);
    }
  });

  it('should find agent-progress-pane hooks.json', () => {
    const results = discoverHooksFiles(ROOT);
    const agentPane = results.find(r =>
      r.filePath.includes('agent-progress-pane')
    );
    expect(agentPane).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// OC-S2-HK-003: Matcher logic
// ---------------------------------------------------------------------------
describe('OC-S2-HK-003 / HK-004: Tool name matcher logic', () => {
  const { matchToolName } = require('../src/hooks/bridge.js');

  it('should match exact tool name', () => {
    expect(matchToolName('Task', 'Task')).toBe(true);
  });

  it('should not match different tool name', () => {
    expect(matchToolName('Task', 'Bash')).toBe(false);
  });

  it('should match wildcard "*"', () => {
    expect(matchToolName('*', 'Task')).toBe(true);
    expect(matchToolName('*', 'Bash')).toBe(true);
    expect(matchToolName('*', 'anything')).toBe(true);
  });

  it('should match regex-style patterns with pipe', () => {
    expect(matchToolName('Bash|mcp__.*', 'Bash')).toBe(true);
    expect(matchToolName('Bash|mcp__.*', 'mcp__my_tool')).toBe(true);
    expect(matchToolName('Bash|mcp__.*', 'Task')).toBe(false);
  });

  it('should be case-sensitive', () => {
    expect(matchToolName('Task', 'task')).toBe(false);
    expect(matchToolName('task', 'Task')).toBe(false);
  });

  it('should handle undefined matcher as wildcard', () => {
    expect(matchToolName(undefined, 'Task')).toBe(true);
    expect(matchToolName(null, 'Bash')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// OC-S2-HK-005: Environment variable bridging
// ---------------------------------------------------------------------------
describe('OC-S2-HK-005: Environment variable bridging', () => {
  const { buildHookEnv } = require('../src/hooks/bridge.js');

  it('should set TOOL_NAME from input.tool', () => {
    const env = buildHookEnv(
      { tool: 'Task', args: { prompt: 'hello' } },
      '/my/plugin',
    );
    expect(env.TOOL_NAME).toBe('Task');
  });

  it('should set TOOL_INPUT as JSON string from input.args', () => {
    const args = { prompt: 'hello', subagent_type: 'backend-developer' };
    const env = buildHookEnv({ tool: 'Task', args }, '/my/plugin');
    expect(env.TOOL_INPUT).toBe(JSON.stringify(args));
  });

  it('should set CLAUDE_PLUGIN_ROOT to the plugin directory', () => {
    const env = buildHookEnv(
      { tool: 'Task', args: {} },
      '/my/plugin',
    );
    expect(env.CLAUDE_PLUGIN_ROOT).toBe('/my/plugin');
  });

  it('should include TOOL_OUTPUT for PostToolUse context', () => {
    const env = buildHookEnv(
      { tool: 'Task', args: {}, output: 'some result' },
      '/my/plugin',
    );
    expect(env.TOOL_OUTPUT).toBe('some result');
  });

  it('should handle missing args gracefully', () => {
    const env = buildHookEnv({ tool: 'Bash' }, '/my/plugin');
    expect(env.TOOL_NAME).toBe('Bash');
    expect(env.TOOL_INPUT).toBe('{}');
  });

  it('should handle missing output gracefully', () => {
    const env = buildHookEnv({ tool: 'Bash', args: {} }, '/my/plugin');
    expect(env.TOOL_OUTPUT).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// OC-S2-HK-003/004: createHookBridge generates before/after hooks
// ---------------------------------------------------------------------------
describe('OC-S2-HK-003/004: createHookBridge hook registration', () => {
  const { createHookBridge } = require('../src/hooks/bridge.js');

  it('should return object with tool.execute.before and tool.execute.after', () => {
    const result = createHookBridge({
      config: { hooks: [] },
      pluginDir: '/fake/plugin',
      verbose: false,
    });
    expect(result['tool.execute.before']).toBeDefined();
    expect(typeof result['tool.execute.before']).toBe('function');
    expect(result['tool.execute.after']).toBeDefined();
    expect(typeof result['tool.execute.after']).toBe('function');
  });

  it('should return async functions', () => {
    const result = createHookBridge({
      config: { hooks: [] },
      pluginDir: '/fake/plugin',
      verbose: false,
    });
    // Invoking should return a promise
    const p = result['tool.execute.before']({ tool: 'Task', args: {} }, {});
    expect(p).toBeInstanceOf(Promise);
    return p;
  });

  it('should handle empty hooks config without errors', async () => {
    const result = createHookBridge({
      config: { hooks: [] },
      pluginDir: '/fake/plugin',
      verbose: false,
    });
    // Should not throw
    await result['tool.execute.before']({ tool: 'Task', args: {} }, {});
    await result['tool.execute.after']({ tool: 'Task', args: {} }, {});
  });
});

// ---------------------------------------------------------------------------
// OC-S2-HK-006: Hook blocking behavior
// ---------------------------------------------------------------------------
describe('OC-S2-HK-006: Hook blocking behavior', () => {
  const { createHookBridge } = require('../src/hooks/bridge.js');

  it('should set output.cancel when PreToolUse hook exits non-zero', async () => {
    const hooks = createHookBridge({
      config: {
        hooks: [{
          point: 'PreToolUse',
          matcher: 'Task',
          // Use a command that exits with code 1
          command: 'exit 1',
          pluginRoot: '/fake',
        }],
      },
      pluginDir: '/fake/plugin',
      verbose: false,
      // Use a mock executor for testing
      executor: async (_cmd, _env) => ({ exitCode: 1, stdout: '', stderr: 'blocked' }),
    });

    const output = {};
    await hooks['tool.execute.before']({ tool: 'Task', args: {} }, output);
    expect(output.cancel).toBe(true);
  });

  it('should not set output.cancel when PreToolUse hook exits zero', async () => {
    const hooks = createHookBridge({
      config: {
        hooks: [{
          point: 'PreToolUse',
          matcher: 'Task',
          command: 'echo ok',
          pluginRoot: '/fake',
        }],
      },
      pluginDir: '/fake/plugin',
      verbose: false,
      executor: async (_cmd, _env) => ({ exitCode: 0, stdout: 'ok', stderr: '' }),
    });

    const output = {};
    await hooks['tool.execute.before']({ tool: 'Task', args: {} }, output);
    expect(output.cancel).toBeUndefined();
  });

  it('should not cancel when matcher does not match tool', async () => {
    const hooks = createHookBridge({
      config: {
        hooks: [{
          point: 'PreToolUse',
          matcher: 'Bash',
          command: 'exit 1',
          pluginRoot: '/fake',
        }],
      },
      pluginDir: '/fake/plugin',
      verbose: false,
      executor: async () => ({ exitCode: 1, stdout: '', stderr: '' }),
    });

    const output = {};
    await hooks['tool.execute.before']({ tool: 'Task', args: {} }, output);
    expect(output.cancel).toBeUndefined();
  });

  it('PostToolUse hooks should not set cancel even on non-zero exit', async () => {
    const hooks = createHookBridge({
      config: {
        hooks: [{
          point: 'PostToolUse',
          matcher: 'Task',
          command: 'exit 1',
          pluginRoot: '/fake',
        }],
      },
      pluginDir: '/fake/plugin',
      verbose: false,
      executor: async () => ({ exitCode: 1, stdout: '', stderr: '' }),
    });

    const output = {};
    await hooks['tool.execute.after']({ tool: 'Task', args: {} }, output);
    expect(output.cancel).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// OC-S2-HK-007: Unmapped hooks documentation
// ---------------------------------------------------------------------------
describe('OC-S2-HK-007: Unmapped hooks documentation', () => {
  const { UNMAPPED_OPENCODE_HOOKS } = require('../src/hooks/bridge.js');

  it('should export a list of unmapped OpenCode hooks', () => {
    expect(UNMAPPED_OPENCODE_HOOKS).toBeDefined();
    expect(Array.isArray(UNMAPPED_OPENCODE_HOOKS)).toBe(true);
    expect(UNMAPPED_OPENCODE_HOOKS.length).toBeGreaterThan(0);
  });

  it('should include chat.params in unmapped hooks', () => {
    expect(UNMAPPED_OPENCODE_HOOKS).toContain('chat.params');
  });

  it('should include shell.env in unmapped hooks', () => {
    expect(UNMAPPED_OPENCODE_HOOKS).toContain('shell.env');
  });

  it('should include permission.ask in unmapped hooks', () => {
    expect(UNMAPPED_OPENCODE_HOOKS).toContain('permission.ask');
  });

  it('should include command.execute.before in unmapped hooks', () => {
    expect(UNMAPPED_OPENCODE_HOOKS).toContain('command.execute.before');
  });

  it('should not include tool.execute.before (mapped)', () => {
    expect(UNMAPPED_OPENCODE_HOOKS).not.toContain('tool.execute.before');
  });

  it('should not include tool.execute.after (mapped)', () => {
    expect(UNMAPPED_OPENCODE_HOOKS).not.toContain('tool.execute.after');
  });
});

// ---------------------------------------------------------------------------
// OC-S2-TEST-007: Comprehensive unit tests for hook parsing + env bridging
// ---------------------------------------------------------------------------
describe('OC-S2-TEST-007: Comprehensive hook parsing and environment bridging', () => {
  const {
    parseHooksJson,
    buildHookEnv,
    matchToolName,
    createHookBridge,
  } = require('../src/hooks/bridge.js');

  describe('parsing real-world hooks.json structures', () => {
    it('should parse agent-progress-pane style hooks', () => {
      const hooksJson = JSON.parse(
        fs.readFileSync(
          path.join(ROOT, 'packages/agent-progress-pane/hooks/hooks.json'),
          'utf-8'
        )
      );
      const result = parseHooksJson(
        hooksJson,
        path.join(ROOT, 'packages/agent-progress-pane')
      );
      expect(result.length).toBeGreaterThan(0);
      const preHooks = result.filter(h => h.point === 'PreToolUse');
      expect(preHooks.length).toBeGreaterThan(0);
      expect(preHooks[0].matcher).toBe('Task');
    });

    it('should parse full package hooks (aggregated)', () => {
      const hooksJson = JSON.parse(
        fs.readFileSync(
          path.join(ROOT, 'packages/full/hooks/hooks.json'),
          'utf-8'
        )
      );
      const result = parseHooksJson(
        hooksJson,
        path.join(ROOT, 'packages/full')
      );
      // full has PreToolUse for Task and TodoWrite, plus PostToolUse for Task
      const preHooks = result.filter(h => h.point === 'PreToolUse');
      const postHooks = result.filter(h => h.point === 'PostToolUse');
      expect(preHooks.length).toBeGreaterThanOrEqual(2);
      expect(postHooks.length).toBeGreaterThanOrEqual(1);
    });

    it('should not extract hooks from router package (UserPromptSubmit only)', () => {
      const hooksJson = JSON.parse(
        fs.readFileSync(
          path.join(ROOT, 'packages/router/hooks/hooks.json'),
          'utf-8'
        )
      );
      const result = parseHooksJson(
        hooksJson,
        path.join(ROOT, 'packages/router')
      );
      // router only has UserPromptSubmit, which is not bridgeable
      expect(result).toEqual([]);
    });
  });

  describe('environment bridging edge cases', () => {
    it('should handle deeply nested args', () => {
      const args = { nested: { deep: { value: 42 } } };
      const env = buildHookEnv({ tool: 'Task', args }, '/p');
      expect(JSON.parse(env.TOOL_INPUT)).toEqual(args);
    });

    it('should handle args with special characters', () => {
      const args = { prompt: 'say "hello" & goodbye' };
      const env = buildHookEnv({ tool: 'Bash', args }, '/p');
      expect(JSON.parse(env.TOOL_INPUT)).toEqual(args);
    });

    it('should handle empty string tool name', () => {
      const env = buildHookEnv({ tool: '', args: {} }, '/p');
      expect(env.TOOL_NAME).toBe('');
    });
  });

  describe('matcher edge cases', () => {
    it('should match full regex patterns from permitter', () => {
      expect(matchToolName('Bash|mcp__.*', 'Bash')).toBe(true);
      expect(matchToolName('Bash|mcp__.*', 'mcp__fetch')).toBe(true);
      expect(matchToolName('Bash|mcp__.*', 'Read')).toBe(false);
    });

    it('should handle regex special chars safely', () => {
      // Should not throw on weird matchers
      expect(() => matchToolName('Task[', 'Task')).not.toThrow();
    });
  });
});

// ---------------------------------------------------------------------------
// OC-S2-TEST-008: Integration test with mock tool execution
// ---------------------------------------------------------------------------
describe('OC-S2-TEST-008: Integration test with mock tool execution', () => {
  const { createHookBridge, parseHooksJson } = require('../src/hooks/bridge.js');

  it('should execute before hooks with correct env vars for matching tool', async () => {
    const capturedEnvs = [];
    const executor = async (cmd, env) => {
      capturedEnvs.push({ cmd, env: { ...env } });
      return { exitCode: 0, stdout: '', stderr: '' };
    };

    const hooks = createHookBridge({
      config: {
        hooks: [{
          point: 'PreToolUse',
          matcher: 'Task',
          command: '/plugin/hooks/pre.js',
          pluginRoot: '/plugin',
        }],
      },
      pluginDir: '/plugin',
      verbose: false,
      executor,
    });

    await hooks['tool.execute.before'](
      { tool: 'Task', args: { prompt: 'do work', subagent_type: 'backend-developer' } },
      {}
    );

    expect(capturedEnvs).toHaveLength(1);
    expect(capturedEnvs[0].env.TOOL_NAME).toBe('Task');
    expect(JSON.parse(capturedEnvs[0].env.TOOL_INPUT)).toEqual({
      prompt: 'do work',
      subagent_type: 'backend-developer',
    });
    expect(capturedEnvs[0].env.CLAUDE_PLUGIN_ROOT).toBe('/plugin');
  });

  it('should execute after hooks with TOOL_OUTPUT for PostToolUse', async () => {
    const capturedEnvs = [];
    const executor = async (cmd, env) => {
      capturedEnvs.push({ cmd, env: { ...env } });
      return { exitCode: 0, stdout: '', stderr: '' };
    };

    const hooks = createHookBridge({
      config: {
        hooks: [{
          point: 'PostToolUse',
          matcher: 'Task',
          command: '/plugin/hooks/post.js',
          pluginRoot: '/plugin',
        }],
      },
      pluginDir: '/plugin',
      verbose: false,
      executor,
    });

    await hooks['tool.execute.after'](
      { tool: 'Task', args: { prompt: 'do work' }, output: 'task completed' },
      {}
    );

    expect(capturedEnvs).toHaveLength(1);
    expect(capturedEnvs[0].env.TOOL_OUTPUT).toBe('task completed');
  });

  it('should not execute hooks for non-matching tools', async () => {
    const capturedCalls = [];
    const executor = async (cmd, env) => {
      capturedCalls.push(cmd);
      return { exitCode: 0, stdout: '', stderr: '' };
    };

    const hooks = createHookBridge({
      config: {
        hooks: [{
          point: 'PreToolUse',
          matcher: 'Task',
          command: '/plugin/hooks/pre.js',
          pluginRoot: '/plugin',
        }],
      },
      pluginDir: '/plugin',
      verbose: false,
      executor,
    });

    await hooks['tool.execute.before']({ tool: 'Bash', args: {} }, {});
    expect(capturedCalls).toHaveLength(0);
  });

  it('should execute multiple matching hooks in order', async () => {
    const callOrder = [];
    const executor = async (cmd, _env) => {
      callOrder.push(cmd);
      return { exitCode: 0, stdout: '', stderr: '' };
    };

    const hooks = createHookBridge({
      config: {
        hooks: [
          {
            point: 'PreToolUse',
            matcher: 'Task',
            command: '/plugin/hooks/first.js',
            pluginRoot: '/plugin',
          },
          {
            point: 'PreToolUse',
            matcher: '*',
            command: '/plugin/hooks/second.js',
            pluginRoot: '/plugin',
          },
        ],
      },
      pluginDir: '/plugin',
      verbose: false,
      executor,
    });

    await hooks['tool.execute.before']({ tool: 'Task', args: {} }, {});
    expect(callOrder).toEqual(['/plugin/hooks/first.js', '/plugin/hooks/second.js']);
  });

  it('should stop PreToolUse hooks after first blocking hook', async () => {
    const callOrder = [];
    const executor = async (cmd, _env) => {
      callOrder.push(cmd);
      if (cmd.includes('blocker')) return { exitCode: 1, stdout: '', stderr: '' };
      return { exitCode: 0, stdout: '', stderr: '' };
    };

    const hooks = createHookBridge({
      config: {
        hooks: [
          {
            point: 'PreToolUse',
            matcher: '*',
            command: '/plugin/hooks/blocker.js',
            pluginRoot: '/plugin',
          },
          {
            point: 'PreToolUse',
            matcher: '*',
            command: '/plugin/hooks/second.js',
            pluginRoot: '/plugin',
          },
        ],
      },
      pluginDir: '/plugin',
      verbose: false,
      executor,
    });

    const output = {};
    await hooks['tool.execute.before']({ tool: 'Task', args: {} }, output);
    expect(output.cancel).toBe(true);
    // Should have stopped after blocker
    expect(callOrder).toEqual(['/plugin/hooks/blocker.js']);
  });

  it('should handle executor errors gracefully', async () => {
    const executor = async () => {
      throw new Error('Execution failed');
    };

    const hooks = createHookBridge({
      config: {
        hooks: [{
          point: 'PreToolUse',
          matcher: '*',
          command: '/plugin/hooks/broken.js',
          pluginRoot: '/plugin',
        }],
      },
      pluginDir: '/plugin',
      verbose: false,
      executor,
    });

    // Should not throw, should just log the error
    const output = {};
    await expect(
      hooks['tool.execute.before']({ tool: 'Task', args: {} }, output)
    ).resolves.toBeUndefined();
  });

  it('full integration: parse hooks.json then create bridge', async () => {
    const hooksJson = {
      hooks: {
        PreToolUse: [{
          matcher: 'Task',
          hooks: [{ type: 'command', command: '${CLAUDE_PLUGIN_ROOT}/hooks/my-hook.js' }],
        }],
        PostToolUse: [{
          matcher: 'Task',
          hooks: [{ type: 'command', command: '${CLAUDE_PLUGIN_ROOT}/hooks/my-post.js' }],
        }],
      },
    };

    const parsed = parseHooksJson(hooksJson, '/my/plugin');
    const capturedCmds = [];
    const executor = async (cmd) => {
      capturedCmds.push(cmd);
      return { exitCode: 0, stdout: '', stderr: '' };
    };

    const bridge = createHookBridge({
      config: { hooks: parsed },
      pluginDir: '/my/plugin',
      verbose: false,
      executor,
    });

    await bridge['tool.execute.before']({ tool: 'Task', args: { p: 1 } }, {});
    await bridge['tool.execute.after']({ tool: 'Task', args: { p: 1 }, output: 'done' }, {});

    expect(capturedCmds).toEqual([
      '/my/plugin/hooks/my-hook.js',
      '/my/plugin/hooks/my-post.js',
    ]);
  });
});

// ---------------------------------------------------------------------------
// OC-S3-DIST-003: Plugin entry point hook wiring
// ---------------------------------------------------------------------------
describe('OC-S3-DIST-003: Plugin hook wiring in entry point', () => {
  it('should export tool.execute.before hook from EnsemblePlugin', async () => {
    const { EnsemblePlugin } = require('../src/index.js');
    const mockCtx = {
      directory: PKG_DIR,
      worktree: ROOT,
      project: { name: 'test-project' },
      serverUrl: 'http://localhost:3000',
    };
    const result = await EnsemblePlugin(mockCtx);
    expect(result['tool.execute.before']).toBeDefined();
    expect(typeof result['tool.execute.before']).toBe('function');
  });

  it('should export tool.execute.after hook from EnsemblePlugin', async () => {
    const { EnsemblePlugin } = require('../src/index.js');
    const mockCtx = {
      directory: PKG_DIR,
      worktree: ROOT,
      project: { name: 'test-project' },
      serverUrl: 'http://localhost:3000',
    };
    const result = await EnsemblePlugin(mockCtx);
    expect(result['tool.execute.after']).toBeDefined();
    expect(typeof result['tool.execute.after']).toBe('function');
  });

  it('hook functions should be callable without errors', async () => {
    const { EnsemblePlugin } = require('../src/index.js');
    const mockCtx = {
      directory: PKG_DIR,
      worktree: ROOT,
    };
    const result = await EnsemblePlugin(mockCtx);
    // Should not throw when called with mock input
    await result['tool.execute.before']({ tool: 'Task', args: {} }, {});
    await result['tool.execute.after']({ tool: 'Task', args: {} }, {});
  });
});
