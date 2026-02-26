/**
 * Ensemble Plugin for OpenCode
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

import * as path from "path";

// Use conditional import for @opencode-ai/plugin types.
// The plugin SDK requires Bun and may not be available in all environments.
// We define the types inline to avoid hard dependency.

/** Plugin context provided by OpenCode runtime */
interface PluginInput {
  client?: unknown;
  project?: { name?: string };
  directory?: string;
  worktree?: string;
  serverUrl?: string;
  $?: unknown;
}

/** Tool execution context */
interface ToolContext {
  sessionID?: string;
  agent?: string;
  directory?: string;
}

/** Tool definition */
interface ToolDefinition {
  description: string;
  args?: Record<string, unknown>;
  execute: (args: Record<string, unknown>, context: ToolContext) => Promise<string>;
}

/** Hook input context from OpenCode */
interface HookInput {
  tool: string;
  args: Record<string, unknown>;
  output?: string;
}

/** Hook output context from OpenCode */
interface HookOutput {
  cancel?: boolean;
}

/** Plugin return type - hooks and tool registrations */
interface PluginHooks {
  tool: Record<string, ToolDefinition>;
  "tool.execute.before": (input: HookInput, output: HookOutput) => Promise<void>;
  "tool.execute.after": (input: HookInput, output: HookOutput) => Promise<void>;
}

/** Plugin function type compatible with @opencode-ai/plugin Plugin */
type Plugin = (ctx: PluginInput) => Promise<PluginHooks>;

// Import the hook bridge module
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createHookBridge, discoverHooksFiles, parseHooksJson } = require("./hooks/bridge");

/** Ensemble ecosystem metadata */
const ENSEMBLE_META = {
  name: "ensemble-opencode" as const,
  version: "5.3.0" as const,
  ecosystem: "ensemble" as const,
  runtime: "opencode" as const,
  agents: 28,
  commands: 15,
  skills: 10,
  capabilities: ["agents", "commands", "skills"] as const,
  description:
    "Ensemble agent mesh for OpenCode - 28 agents, 15 commands, 10 framework skills",
};

/**
 * Creates the ensemble-info tool that exposes version and capability
 * information to the OpenCode AI agent.
 */
function createEnsembleInfoTool(): ToolDefinition {
  return {
    description:
      "Returns Ensemble plugin version, available agents, commands, skills, and capabilities. " +
      "Use this tool to discover what the Ensemble ecosystem provides.",
    args: {},
    execute: async (
      _args: Record<string, unknown>,
      _context: ToolContext
    ): Promise<string> => {
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
 */
function loadHookBridge(rootDir: string): {
  "tool.execute.before": (input: HookInput, output: HookOutput) => Promise<void>;
  "tool.execute.after": (input: HookInput, output: HookOutput) => Promise<void>;
} {
  interface HooksFileEntry {
    filePath: string;
    packageDir: string;
  }

  const allHooks: Array<Record<string, unknown>> = [];

  try {
    const hooksFiles: HooksFileEntry[] = discoverHooksFiles(rootDir);

    for (const { filePath, packageDir } of hooksFiles) {
      try {
        const fs = require("fs");
        const content: string = fs.readFileSync(filePath, "utf-8");
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
 * @param _ctx - Plugin context provided by OpenCode runtime
 * @returns Hook and tool registrations
 */
export const EnsemblePlugin: Plugin = async (
  _ctx: PluginInput
): Promise<PluginHooks> => {
  // Determine the monorepo root from the plugin directory
  // packages/opencode/src/index.ts -> 3 levels up to root
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

export default EnsemblePlugin;
