/**
 * CommandTranslator - Converts YAML commands to OpenCode Markdown format
 *
 * Responsibilities:
 *   - Parse Ensemble command YAML schema
 *   - Translate metadata to Markdown headers
 *   - Convert $ARGUMENTS to $PLACEHOLDER_NAME syntax
 *   - Render workflow phases/steps as numbered Markdown sections
 *   - Generate JSON command config entries for opencode.json
 *   - Map model hints to OpenCode providerID/modelID format
 *
 * Task IDs: OC-S1-CMD-001 through OC-S1-CMD-010
 *
 * NOTE: The canonical implementation is in command-translator.js (CommonJS).
 * This TypeScript wrapper re-exports from the JS module for ts-node compatibility.
 * Both files must be kept in sync.
 */

// Re-export from the CommonJS implementation
// eslint-disable-next-line @typescript-eslint/no-var-requires
const impl = require('./command-translator.js');

export const CommandTranslator = impl.CommandTranslator;
