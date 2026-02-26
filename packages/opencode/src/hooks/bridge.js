/**
 * Hook Bridge - Adapts Ensemble PreToolUse/PostToolUse hooks to OpenCode's
 * typed hook API (tool.execute.before / tool.execute.after).
 *
 * This module is the runtime component that executes at plugin load time in
 * OpenCode. It parses Ensemble hooks.json structures, matches tool names,
 * bridges environment variables, and handles hook blocking behavior.
 *
 * Task IDs: OC-S2-HK-001 through OC-S2-HK-007
 *
 * @module ensemble-opencode/hooks/bridge
 * @see {@link https://github.com/FortiumPartners/ensemble}
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ---------------------------------------------------------------------------
// OC-S2-HK-007: Unmapped OpenCode hooks for future expansion
// ---------------------------------------------------------------------------
/**
 * OpenCode hook points that could be mapped in the future but are currently
 * out of scope. These hooks have no direct Ensemble equivalent.
 *
 * Potential future mappings:
 * - chat.params: Could map to model hint overrides from agent YAML
 * - shell.env: Could inject Ensemble-specific env vars into shell tools
 * - permission.ask: Could bridge Ensemble's PermissionRequest hooks
 * - command.execute.before: Could bridge Ensemble's UserPromptSubmit hooks
 * - tool.definition: Could modify tool descriptions based on Ensemble config
 * - chat.message: Could bridge message event logging
 * - experimental.chat.system.transform: Could inject Ensemble agent prompts
 */
const UNMAPPED_OPENCODE_HOOKS = [
  'chat.params',
  'chat.headers',
  'chat.message',
  'shell.env',
  'permission.ask',
  'command.execute.before',
  'tool.definition',
  'auth',
  'config',
  'event',
  'experimental.chat.messages.transform',
  'experimental.chat.system.transform',
  'experimental.session.compacting',
  'experimental.text.complete',
];

// ---------------------------------------------------------------------------
// Hook points that can be bridged from Ensemble to OpenCode
// ---------------------------------------------------------------------------
const BRIDGEABLE_HOOK_POINTS = ['PreToolUse', 'PostToolUse'];

// ---------------------------------------------------------------------------
// OC-S2-HK-003/004: Tool name matcher
// ---------------------------------------------------------------------------

/**
 * Tests whether a tool name matches a hook matcher pattern.
 *
 * Matcher patterns follow Ensemble conventions:
 * - Exact string match: "Task" matches only "Task"
 * - Wildcard: "*" matches any tool name
 * - Regex with pipe: "Bash|mcp__.*" matches "Bash" or any mcp__ prefixed tool
 * - undefined/null treated as wildcard (matches everything)
 *
 * @param {string|undefined|null} matcher - The pattern from hooks.json
 * @param {string} toolName - The actual tool name from OpenCode
 * @returns {boolean} True if the tool name matches the pattern
 */
function matchToolName(matcher, toolName) {
  // Null/undefined matcher = wildcard
  if (matcher == null) return true;
  if (matcher === '*') return true;

  // Check for regex-style pattern (contains pipe or regex chars)
  if (matcher.includes('|') || matcher.includes('.*') || matcher.includes('[')) {
    try {
      const regex = new RegExp('^(?:' + matcher + ')$');
      return regex.test(toolName);
    } catch (_e) {
      // If regex is invalid, fall back to exact match
      return matcher === toolName;
    }
  }

  // Exact match
  return matcher === toolName;
}

// ---------------------------------------------------------------------------
// OC-S2-HK-005: Environment variable bridging
// ---------------------------------------------------------------------------

/**
 * Builds the environment variables that Ensemble hook scripts expect.
 *
 * Maps OpenCode hook context to Ensemble's shell environment:
 * - input.tool -> TOOL_NAME
 * - JSON.stringify(input.args) -> TOOL_INPUT
 * - pluginRoot -> CLAUDE_PLUGIN_ROOT
 * - input.output -> TOOL_OUTPUT (PostToolUse only)
 *
 * @param {object} input - The OpenCode hook input context
 * @param {string} input.tool - Tool name
 * @param {object} [input.args] - Tool arguments
 * @param {string} [input.output] - Tool output (PostToolUse only)
 * @param {string} pluginRoot - Path to the Ensemble plugin directory
 * @returns {object} Environment variables for the hook subprocess
 */
function buildHookEnv(input, pluginRoot) {
  const env = {
    TOOL_NAME: input.tool || '',
    TOOL_INPUT: JSON.stringify(input.args || {}),
    CLAUDE_PLUGIN_ROOT: pluginRoot,
  };

  if (input.output !== undefined && input.output !== null) {
    env.TOOL_OUTPUT = String(input.output);
  }

  return env;
}

// ---------------------------------------------------------------------------
// OC-S2-HK-002: hooks.json parsing
// ---------------------------------------------------------------------------

/**
 * Discovers all hooks.json files in the packages directory.
 *
 * @param {string} rootDir - Root directory of the Ensemble monorepo
 * @returns {Array<{filePath: string, packageDir: string}>} Discovered hook files
 */
function discoverHooksFiles(rootDir) {
  const packagesDir = path.join(rootDir, 'packages');
  const results = [];

  if (!fs.existsSync(packagesDir)) return results;

  const packages = fs.readdirSync(packagesDir, { withFileTypes: true });
  for (const pkg of packages) {
    if (!pkg.isDirectory()) continue;
    const hooksPath = path.join(packagesDir, pkg.name, 'hooks', 'hooks.json');
    if (fs.existsSync(hooksPath)) {
      results.push({
        filePath: hooksPath,
        packageDir: path.join(packagesDir, pkg.name),
      });
    }
  }

  return results;
}

/**
 * Parses a hooks.json object and extracts bridgeable hook entries.
 *
 * Only PreToolUse and PostToolUse hooks are bridged. Other Ensemble hook
 * points (UserPromptSubmit, PermissionRequest) are not mapped.
 *
 * @param {object} hooksJson - Parsed hooks.json content
 * @param {string} pluginRoot - Plugin root directory for resolving command paths
 * @returns {Array<{point: string, matcher: string, command: string, pluginRoot: string}>}
 */
function parseHooksJson(hooksJson, pluginRoot) {
  const results = [];

  if (!hooksJson || !hooksJson.hooks) return results;

  for (const point of BRIDGEABLE_HOOK_POINTS) {
    const entries = hooksJson.hooks[point];
    if (!Array.isArray(entries)) continue;

    for (const entry of entries) {
      const matcher = entry.matcher || '*';
      const hookDefs = entry.hooks;
      if (!Array.isArray(hookDefs)) continue;

      for (const hookDef of hookDefs) {
        if (hookDef.type !== 'command') continue;

        // Resolve ${CLAUDE_PLUGIN_ROOT} in the command string
        const command = (hookDef.command || '').replace(
          /\$\{CLAUDE_PLUGIN_ROOT\}/g,
          pluginRoot
        );

        results.push({
          point,
          matcher,
          command,
          pluginRoot,
        });
      }
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Default command executor (uses child_process)
// ---------------------------------------------------------------------------

/**
 * Default executor that runs a shell command with the given environment.
 *
 * @param {string} command - Shell command to execute
 * @param {object} env - Environment variables to set
 * @returns {Promise<{exitCode: number, stdout: string, stderr: string}>}
 */
async function defaultExecutor(command, env) {
  try {
    const mergedEnv = { ...process.env, ...env };
    const stdout = execSync(command, {
      env: mergedEnv,
      encoding: 'utf-8',
      timeout: 30000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { exitCode: 0, stdout: stdout || '', stderr: '' };
  } catch (err) {
    return {
      exitCode: err.status || 1,
      stdout: err.stdout || '',
      stderr: err.stderr || err.message || '',
    };
  }
}

// ---------------------------------------------------------------------------
// OC-S2-HK-003/004/006: Hook bridge creation
// ---------------------------------------------------------------------------

/**
 * Creates OpenCode hook registrations from a parsed hook bridge configuration.
 *
 * Returns an object with `tool.execute.before` and `tool.execute.after` async
 * functions that can be spread into the OpenCode plugin return object.
 *
 * For PreToolUse hooks (tool.execute.before):
 * - If a hook command exits with non-zero, sets output.cancel = true to block
 *   tool execution (OC-S2-HK-006)
 * - Stops executing further hooks after a blocking hook
 *
 * For PostToolUse hooks (tool.execute.after):
 * - Exit code is logged but does not affect tool execution
 *
 * @param {object} options
 * @param {object} options.config - Hook bridge config with hooks array
 * @param {string} options.pluginDir - Plugin directory for env var resolution
 * @param {boolean} [options.verbose=false] - Enable verbose logging
 * @param {function} [options.executor] - Custom command executor (for testing)
 * @returns {{ "tool.execute.before": function, "tool.execute.after": function }}
 */
function createHookBridge(options) {
  const { config, pluginDir, verbose = false, executor = defaultExecutor } = options;
  const hooks = config.hooks || [];

  const preHooks = hooks.filter(h => h.point === 'PreToolUse');
  const postHooks = hooks.filter(h => h.point === 'PostToolUse');

  return {
    /**
     * tool.execute.before - Maps to Ensemble's PreToolUse hooks.
     *
     * For each registered PreToolUse hook whose matcher matches the current
     * tool name, executes the hook command with bridged environment variables.
     * If any hook exits non-zero, sets output.cancel = true and stops.
     */
    'tool.execute.before': async (input, output) => {
      for (const hook of preHooks) {
        if (!matchToolName(hook.matcher, input.tool)) continue;

        const env = buildHookEnv(input, hook.pluginRoot || pluginDir);

        if (verbose) {
          console.log(
            `[ensemble-opencode] PreToolUse hook: ${hook.command} (tool=${input.tool}, matcher=${hook.matcher})`
          );
        }

        try {
          const result = await executor(hook.command, env);

          if (result.exitCode !== 0) {
            if (verbose) {
              console.log(
                `[ensemble-opencode] PreToolUse hook blocked execution: ${hook.command} (exit=${result.exitCode})`
              );
            }
            output.cancel = true;
            return; // Stop processing further hooks
          }
        } catch (err) {
          if (verbose) {
            console.error(
              `[ensemble-opencode] PreToolUse hook error: ${hook.command}`,
              err.message
            );
          }
          // Errors are logged but do not block execution
        }
      }
    },

    /**
     * tool.execute.after - Maps to Ensemble's PostToolUse hooks.
     *
     * For each registered PostToolUse hook whose matcher matches the current
     * tool name, executes the hook command with bridged environment variables.
     * Exit codes are logged but do not affect the result.
     */
    'tool.execute.after': async (input, output) => {
      for (const hook of postHooks) {
        if (!matchToolName(hook.matcher, input.tool)) continue;

        const env = buildHookEnv(input, hook.pluginRoot || pluginDir);

        if (verbose) {
          console.log(
            `[ensemble-opencode] PostToolUse hook: ${hook.command} (tool=${input.tool}, matcher=${hook.matcher})`
          );
        }

        try {
          await executor(hook.command, env);
        } catch (err) {
          if (verbose) {
            console.error(
              `[ensemble-opencode] PostToolUse hook error: ${hook.command}`,
              err.message
            );
          }
        }
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  // Core functions
  createHookBridge,
  parseHooksJson,
  discoverHooksFiles,
  matchToolName,
  buildHookEnv,

  // Constants
  UNMAPPED_OPENCODE_HOOKS,
  BRIDGEABLE_HOOK_POINTS,

  // Utilities (exported for testing)
  defaultExecutor,
};
