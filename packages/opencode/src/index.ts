/**
 * Ensemble Plugin for OpenCode
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

/** Plugin return type - hooks and tool registrations */
interface PluginHooks {
  tool: Record<string, ToolDefinition>;
  // Hook bridge registrations will be added in DIST-003 (deferred to Sprint 2 completion)
  // "tool.execute.before"?: (input: unknown, output: unknown) => Promise<void>;
  // "tool.execute.after"?: (input: unknown, output: unknown) => Promise<void>;
}

/** Plugin function type compatible with @opencode-ai/plugin Plugin */
type Plugin = (ctx: PluginInput) => Promise<PluginHooks>;

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
 * Ensemble Plugin for OpenCode.
 *
 * Registers Ensemble-specific custom tools and (in the future) hook bridges
 * that adapt Ensemble's PreToolUse/PostToolUse hooks to OpenCode's typed
 * hook API.
 *
 * @param ctx - Plugin context provided by OpenCode runtime
 * @returns Hook and tool registrations
 */
export const EnsemblePlugin: Plugin = async (
  _ctx: PluginInput
): Promise<PluginHooks> => {
  return {
    // Custom tools available to the AI (DIST-002)
    tool: {
      "ensemble-info": createEnsembleInfoTool(),
    },

    // Hook bridge registrations will be added in DIST-003 (deferred)
    // Depends on Sprint 2 HookBridge completion (OC-S2-HK-*)
  };
};

export default EnsemblePlugin;
