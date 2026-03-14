/**
 * OpenCode Generator CLI Entry Point (TypeScript wrapper)
 *
 * The actual implementation lives in index.js (plain Node.js, no ts-node required).
 * This file exists for backward compatibility if anyone invokes via ts-node.
 *
 * Usage:
 *   node scripts/generate-opencode/index.js [options]
 *
 * Options:
 *   --dry-run     Preview output without writing files
 *   --verbose     Detailed logging of translation steps
 *   --validate    Validate generated configs against OpenCode schema
 *   --output-dir  Custom output directory (default: dist/opencode/)
 *   --force       Bypass incremental cache
 */

// Re-export from the JS implementation
const cli = require('./index.js');

export const main = cli.runPipeline;
export const createProgram = cli.createProgram;

if (require.main === module) {
  // Delegate to the JS entry point
  require('./index.js');
}
