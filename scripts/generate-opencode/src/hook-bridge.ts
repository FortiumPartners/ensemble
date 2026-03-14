/**
 * HookBridge - Adapts Ensemble hooks to OpenCode's typed hook API
 *
 * Build-time component that discovers and parses hooks.json files from
 * packages/*/hooks/ and produces a summary for the runtime bridge module.
 *
 * Responsibilities:
 *   - Parse hooks.json files from packages/*/hooks/
 *   - Map PreToolUse -> tool.execute.before
 *   - Map PostToolUse -> tool.execute.after
 *   - Bridge environment variables (TOOL_NAME, TOOL_INPUT)
 *   - Handle hook blocking behavior
 *   - Document unmapped OpenCode hooks for future expansion
 *
 * Task IDs: OC-S2-HK-001 through OC-S2-HK-007
 *
 * Compiled output: hook-bridge.js (CommonJS)
 */

// Compiled implementation is in hook-bridge.js
// This TypeScript source serves as the type definition.

export interface HookEntry {
  point: 'PreToolUse' | 'PostToolUse';
  openCodeHook: 'tool.execute.before' | 'tool.execute.after';
  matcher: string;
  command: string;
  packageName: string;
  packageDir: string;
  timeout?: number;
}

export interface HookBridgeSummary {
  totalDiscovered: number;
  preToolUse: number;
  postToolUse: number;
  packages: string[];
  hooks: HookEntry[];
  unmappedOpenCodeHooks: string[];
  hookPointMap: Record<string, string>;
}

export class HookBridgeGenerator {
  constructor(options?: { rootDir?: string; verbose?: boolean });
  discoverHooksFiles(): Array<{ filePath: string; packageName: string; packageDir: string }>;
  parseHooksJson(hooksJson: unknown, packageName: string, packageDir: string): HookEntry[];
  generate(): HookBridgeSummary;
  getSummary(): HookBridgeSummary | null;
  getDiscoveredHooks(): HookEntry[];
}

export const BRIDGEABLE_HOOK_POINTS: string[];
export const UNBRIDGED_ENSEMBLE_HOOKS: string[];
export const UNMAPPED_OPENCODE_HOOKS: string[];
export const HOOK_POINT_MAP: Record<string, string>;
