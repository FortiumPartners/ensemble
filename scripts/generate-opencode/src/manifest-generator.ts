/**
 * ManifestGenerator - Produces opencode.json from Ensemble plugin manifests
 *
 * Responsibilities:
 *   - Read all packages/*/.claude-plugin/plugin.json manifests
 *   - Generate agent block from AgentTranslator output
 *   - Generate command block from CommandTranslator output
 *   - Generate skills.paths from SkillCopier output
 *   - Generate plugin array referencing ensemble-opencode
 *   - Generate instructions array
 *   - Generate permission block with conservative defaults
 *   - Merge all sections into unified opencode.json
 *
 * Task IDs: OC-S3-MF-001 through OC-S3-MF-008
 *
 * NOTE: The canonical implementation is in manifest-generator.js (CommonJS).
 * This TypeScript wrapper re-exports from the JS module for ts-node compatibility.
 * Both files must be kept in sync.
 */

// Re-export from the CommonJS implementation
// eslint-disable-next-line @typescript-eslint/no-var-requires
const impl = require('./manifest-generator.js');

export const ManifestGenerator = impl.ManifestGenerator;
