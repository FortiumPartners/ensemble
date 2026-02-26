/**
 * Ensemble Plugin for OpenCode (compiled output)
 *
 * Plugin entry point that registers Ensemble's agents, commands, skills,
 * and custom tools in the OpenCode runtime.
 *
 * Task IDs: OC-S3-DIST-001, OC-S3-DIST-002
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
 * Ensemble Plugin for OpenCode.
 *
 * Registers Ensemble-specific custom tools and (in the future) hook bridges
 * that adapt Ensemble's PreToolUse/PostToolUse hooks to OpenCode's typed
 * hook API.
 *
 * @param {object} _ctx - Plugin context provided by OpenCode runtime
 * @returns {Promise<object>} Hook and tool registrations
 */
const EnsemblePlugin = async (_ctx) => {
  return {
    // Custom tools available to the AI (DIST-002)
    tool: {
      "ensemble-info": createEnsembleInfoTool(),
    },

    // Hook bridge registrations will be added in DIST-003 (deferred)
    // Depends on Sprint 2 HookBridge completion (OC-S2-HK-*)
  };
};

exports.EnsemblePlugin = EnsemblePlugin;
exports.default = EnsemblePlugin;
