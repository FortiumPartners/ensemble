/**
 * HookBridgeGenerator - Generates OpenCode hook bridge code from Ensemble hooks.json files
 *
 * This is the build-time component that discovers all hooks.json files across
 * the Ensemble monorepo, parses them, and produces a summary of hook bridge
 * configurations for the runtime bridge module.
 *
 * The runtime bridge is at packages/opencode/src/hooks/bridge.js and uses
 * the parsed configurations to adapt Ensemble hooks to OpenCode's typed hook API.
 *
 * Responsibilities:
 *   - Discover all packages/*/hooks/hooks.json files (OC-S2-HK-002)
 *   - Parse PreToolUse and PostToolUse entries (OC-S2-HK-002)
 *   - Map PreToolUse -> tool.execute.before (OC-S2-HK-003)
 *   - Map PostToolUse -> tool.execute.after (OC-S2-HK-004)
 *   - Document environment variable bridging (OC-S2-HK-005)
 *   - Document hook blocking behavior (OC-S2-HK-006)
 *   - Document unmapped OpenCode hooks (OC-S2-HK-007)
 *
 * Task IDs: OC-S2-HK-001 through OC-S2-HK-007
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Hook points that can be bridged from Ensemble to OpenCode */
const BRIDGEABLE_HOOK_POINTS = ['PreToolUse', 'PostToolUse'];

/** Ensemble hook points that are NOT bridged (out of scope for v1.0) */
const UNBRIDGED_ENSEMBLE_HOOKS = ['UserPromptSubmit', 'PermissionRequest'];

/**
 * OpenCode hook points that have no Ensemble equivalent yet.
 * Documented here for future expansion (OC-S2-HK-007).
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

/**
 * Mapping between Ensemble hook points and OpenCode hook names
 */
const HOOK_POINT_MAP = {
  PreToolUse: 'tool.execute.before',
  PostToolUse: 'tool.execute.after',
};

// ---------------------------------------------------------------------------
// HookBridgeGenerator class
// ---------------------------------------------------------------------------

class HookBridgeGenerator {
  /**
   * @param {object} options
   * @param {string} options.rootDir - Root directory of the Ensemble monorepo
   * @param {boolean} [options.verbose=false] - Enable verbose logging
   */
  constructor(options = {}) {
    this.rootDir = options.rootDir || process.cwd();
    this.verbose = options.verbose || false;
    this._discoveredHooks = [];
    this._summary = null;
  }

  /**
   * Discovers all hooks.json files in the packages directory.
   *
   * @returns {Array<{filePath: string, packageName: string, packageDir: string}>}
   */
  discoverHooksFiles() {
    const packagesDir = path.join(this.rootDir, 'packages');
    const results = [];

    if (!fs.existsSync(packagesDir)) {
      if (this.verbose) {
        console.log('[HookBridgeGenerator] No packages/ directory found');
      }
      return results;
    }

    const packages = fs.readdirSync(packagesDir, { withFileTypes: true });
    for (const pkg of packages) {
      if (!pkg.isDirectory()) continue;
      const hooksPath = path.join(packagesDir, pkg.name, 'hooks', 'hooks.json');
      if (fs.existsSync(hooksPath)) {
        results.push({
          filePath: hooksPath,
          packageName: pkg.name,
          packageDir: path.join(packagesDir, pkg.name),
        });
        if (this.verbose) {
          console.log(`[HookBridgeGenerator] Found: ${hooksPath}`);
        }
      }
    }

    return results;
  }

  /**
   * Parses a single hooks.json and extracts bridgeable hook entries.
   *
   * @param {object} hooksJson - Parsed hooks.json content
   * @param {string} packageName - Name of the package
   * @param {string} packageDir - Package directory path
   * @returns {Array<{point: string, openCodeHook: string, matcher: string, command: string, packageName: string, packageDir: string}>}
   */
  parseHooksJson(hooksJson, packageName, packageDir) {
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

          results.push({
            point,
            openCodeHook: HOOK_POINT_MAP[point],
            matcher,
            command: hookDef.command || '',
            packageName,
            packageDir,
            timeout: hookDef.timeout,
          });
        }
      }
    }

    // Also log unbridged hooks for documentation
    for (const point of UNBRIDGED_ENSEMBLE_HOOKS) {
      const entries = hooksJson.hooks[point];
      if (Array.isArray(entries) && entries.length > 0 && this.verbose) {
        console.log(
          `[HookBridgeGenerator] Skipping ${point} hooks from ${packageName} (not bridgeable)`
        );
      }
    }

    return results;
  }

  /**
   * Runs the full discovery and parsing pipeline.
   *
   * @returns {object} Summary of discovered hooks
   */
  generate() {
    const hooksFiles = this.discoverHooksFiles();
    const allHooks = [];

    for (const { filePath, packageName, packageDir } of hooksFiles) {
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const hooksJson = JSON.parse(content);
        const parsed = this.parseHooksJson(hooksJson, packageName, packageDir);
        allHooks.push(...parsed);
      } catch (err) {
        if (this.verbose) {
          console.error(
            `[HookBridgeGenerator] Error parsing ${filePath}: ${err.message}`
          );
        }
      }
    }

    this._discoveredHooks = allHooks;

    const preToolHooks = allHooks.filter(h => h.point === 'PreToolUse');
    const postToolHooks = allHooks.filter(h => h.point === 'PostToolUse');

    this._summary = {
      totalDiscovered: allHooks.length,
      preToolUse: preToolHooks.length,
      postToolUse: postToolHooks.length,
      packages: [...new Set(allHooks.map(h => h.packageName))],
      hooks: allHooks,
      unmappedOpenCodeHooks: UNMAPPED_OPENCODE_HOOKS,
      hookPointMap: HOOK_POINT_MAP,
    };

    if (this.verbose) {
      console.log(
        `[HookBridgeGenerator] Discovered ${allHooks.length} bridgeable hooks ` +
        `(${preToolHooks.length} PreToolUse, ${postToolHooks.length} PostToolUse) ` +
        `from ${hooksFiles.length} packages`
      );
    }

    return this._summary;
  }

  /**
   * Returns the summary from the last generate() call.
   * @returns {object|null}
   */
  getSummary() {
    return this._summary;
  }

  /**
   * Returns the discovered hooks from the last generate() call.
   * @returns {Array}
   */
  getDiscoveredHooks() {
    return this._discoveredHooks;
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  HookBridgeGenerator,
  BRIDGEABLE_HOOK_POINTS,
  UNBRIDGED_ENSEMBLE_HOOKS,
  UNMAPPED_OPENCODE_HOOKS,
  HOOK_POINT_MAP,
};
