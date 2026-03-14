/**
 * Ensemble Plugin for OpenCode (compiled output)
 *
 * Plugin entry point that registers Ensemble's agents, commands, skills,
 * and custom tools in the OpenCode runtime.
 *
 * Task IDs: OC-S3-DIST-001, OC-S3-DIST-002, OC-S3-DIST-003
 *
 * @module ensemble-opencode
 * @see {@link https://github.com/FortiumPartners/ensemble}
 *
 * Local installation (DIST-006):
 *   In opencode.json: "plugin": ["file:///path/to/packages/opencode"]
 */

"use strict";

Object.defineProperty(exports, "__esModule", { value: true });
exports.EnsemblePlugin = void 0;

const path = require("path");
const { createHookBridge, discoverHooksFiles, parseHooksJson } = require("./hooks/bridge");

/** Ensemble ecosystem metadata */
const ENSEMBLE_META = {
  name: "ensemble-opencode",
  version: "5.3.0",
  ecosystem: "ensemble",
  runtime: "opencode",
  agents: 28,
  commands: 15,
  skills: 10,
  capabilities: ["agents", "commands", "skills"],
  description:
    "Ensemble agent mesh for OpenCode - 28 agents, 15 commands, 10 framework skills",
};

/**
 * Creates the ensemble-info tool that exposes version and capability
 * information to the OpenCode AI agent.
 */
function createEnsembleInfoTool() {
  return {
    description:
      "Returns Ensemble plugin version, available agents, commands, skills, and capabilities. " +
      "Use this tool to discover what the Ensemble ecosystem provides.",
    args: {},
    execute: async (_args, _context) => {
      const info = {
        name: ENSEMBLE_META.name,
        version: ENSEMBLE_META.version,
        ecosystem: ENSEMBLE_META.ecosystem,
        runtime: ENSEMBLE_META.runtime,
        agents: ENSEMBLE_META.agents,
        commands: ENSEMBLE_META.commands,
        skills: ENSEMBLE_META.skills,
        capabilities: [...ENSEMBLE_META.capabilities],
        description: ENSEMBLE_META.description,
      };
      return JSON.stringify(info, null, 2);
    },
  };
}

/**
 * Loads and initializes the hook bridge from discovered hooks.json files.
 *
 * Scans the Ensemble monorepo for hooks.json files and creates OpenCode-compatible
 * hook registrations that bridge PreToolUse/PostToolUse to tool.execute.before/after.
 *
 * @param {string} rootDir - Root directory of the Ensemble monorepo
 * @returns {{ "tool.execute.before": function, "tool.execute.after": function }}
 */
function loadHookBridge(rootDir) {
  const allHooks = [];

  try {
    const hooksFiles = discoverHooksFiles(rootDir);

    for (const { filePath, packageDir } of hooksFiles) {
      try {
        const fs = require("fs");
        const content = fs.readFileSync(filePath, "utf-8");
        const hooksJson = JSON.parse(content);
        const parsed = parseHooksJson(hooksJson, packageDir);
        allHooks.push(...parsed);
      } catch (_err) {
        // Skip files that cannot be parsed
      }
    }
  } catch (_err) {
    // If discovery fails, return empty hooks
  }

  return createHookBridge({
    config: { hooks: allHooks },
    pluginDir: rootDir,
    verbose: false,
  });
}

/**
 * Ensemble Plugin for OpenCode.
 *
 * Registers Ensemble-specific custom tools and hook bridges that adapt
 * Ensemble's PreToolUse/PostToolUse hooks to OpenCode's typed hook API.
 *
 * @param {object} _ctx - Plugin context provided by OpenCode runtime
 * @returns {Promise<object>} Hook and tool registrations
 */
const EnsemblePlugin = async (_ctx) => {
  // Determine the monorepo root from the plugin directory
  // packages/opencode/src/index.js -> 3 levels up to root
  const pluginSrcDir = __dirname;
  const rootDir = path.resolve(pluginSrcDir, "..", "..", "..");

  // Load hook bridge (DIST-003: wire up hook bridge from OC-S2-HK-*)
  const hookBridge = loadHookBridge(rootDir);

  return {
    // Custom tools available to the AI (DIST-002)
    tool: {
      "ensemble-info": createEnsembleInfoTool(),
    },

    // Hook bridge registrations (DIST-003)
    // Maps Ensemble PreToolUse -> tool.execute.before
    // Maps Ensemble PostToolUse -> tool.execute.after
    "tool.execute.before": hookBridge["tool.execute.before"],
    "tool.execute.after": hookBridge["tool.execute.after"],
  };
};

exports.EnsemblePlugin = EnsemblePlugin;
exports.default = EnsemblePlugin;
