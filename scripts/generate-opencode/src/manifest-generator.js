/**
 * ManifestGenerator - Produces opencode.json from Ensemble plugin manifests
 *
 * Responsibilities:
 *   - Read all plugin.json manifests from packages (OC-S3-MF-001)
 *   - Generate command block from CommandTranslator output (OC-S3-MF-003)
 *   - Generate skills.paths from SkillCopier output (OC-S3-MF-004)
 *   - Generate plugin array referencing ensemble-opencode (OC-S3-MF-005)
 *   - Generate instructions array (OC-S3-MF-006)
 *   - Generate permission block with conservative defaults (OC-S3-MF-007)
 *   - Merge all sections into unified opencode.json (OC-S3-MF-008)
 *
 * Task IDs: OC-S3-MF-001 through OC-S3-MF-008
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Default permission block (OC-S3-MF-007)
// Conservative: bash requires approval, edit and read are allowed
// ---------------------------------------------------------------------------
const DEFAULT_PERMISSIONS = {
  bash: 'ask',
  edit: 'allow',
  read: 'allow',
};

// ---------------------------------------------------------------------------
// ManifestGenerator class
// ---------------------------------------------------------------------------
class ManifestGenerator {
  /**
   * @param {object} options
   * @param {string} options.packagesDir         - Path to packages/ directory
   * @param {string} options.outputDir           - Path to output directory for opencode.json
   * @param {string[]} options.skillPaths        - Skill discovery paths from SkillCopier
   * @param {Record<string, object>} options.commandConfig - Command config from CommandTranslator
   * @param {Record<string, object>} options.agentConfig   - Agent config from AgentTranslator
   * @param {string} options.pluginPackageName   - Plugin package name (e.g. 'ensemble-opencode')
   * @param {string} options.pluginVersion       - Plugin version (e.g. '5.3.0')
   * @param {boolean} [options.dryRun=false]     - If true, don't write files
   * @param {boolean} [options.verbose=false]    - If true, log extra info
   * @param {object} [options.permissionOverrides] - Optional permission overrides
   */
  constructor(options) {
    this.packagesDir = options.packagesDir;
    this.outputDir = options.outputDir;
    this.skillPaths = options.skillPaths || [];
    this.commandConfig = options.commandConfig || {};
    this.agentConfig = options.agentConfig || {};
    this.pluginPackageName = options.pluginPackageName || 'ensemble-opencode';
    this.pluginVersion = options.pluginVersion || '5.3.0';
    this.dryRun = options.dryRun || false;
    this.verbose = options.verbose || false;
    this.permissionOverrides = options.permissionOverrides || null;
  }

  // -------------------------------------------------------------------------
  // OC-S3-MF-001: Discover and read plugin.json manifests
  // -------------------------------------------------------------------------

  // Discover all plugin.json files across packages/<name>/.claude-plugin/
  // Returns array of {name, version, description, dirName}
  //
  discoverManifests() {
    const results = [];

    if (!fs.existsSync(this.packagesDir)) {
      if (this.verbose) {
        console.log(`[manifest] Packages directory not found: ${this.packagesDir}`);
      }
      return results;
    }

    let entries;
    try {
      entries = fs.readdirSync(this.packagesDir, { withFileTypes: true });
    } catch (_err) {
      return results;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const pluginJsonPath = path.join(
        this.packagesDir,
        entry.name,
        '.claude-plugin',
        'plugin.json'
      );

      if (!fs.existsSync(pluginJsonPath)) continue;

      try {
        const raw = fs.readFileSync(pluginJsonPath, 'utf-8');
        const manifest = JSON.parse(raw);

        if (!manifest.name) {
          if (this.verbose) {
            console.log(`[manifest] Skipping ${pluginJsonPath}: missing "name" field`);
          }
          continue;
        }

        results.push({
          name: manifest.name,
          version: manifest.version || '0.0.0',
          description: manifest.description || '',
          dirName: entry.name,
        });

        if (this.verbose) {
          console.log(`[manifest] Discovered: ${manifest.name}@${manifest.version || '?'}`);
        }
      } catch (err) {
        if (this.verbose) {
          console.error(`[manifest] Error reading ${pluginJsonPath}: ${err.message}`);
        }
        // Skip malformed files
      }
    }

    return results;
  }

  /**
   * Build a registry (name -> manifest info) from discovered manifests.
   * @param {Array} manifests - Output of discoverManifests()
   * @returns {Record<string, {version: string, description: string, dirName: string}>}
   */
  buildRegistry(manifests) {
    const registry = {};
    for (const m of manifests) {
      registry[m.name] = {
        version: m.version,
        description: m.description,
        dirName: m.dirName,
      };
    }
    return registry;
  }

  // -------------------------------------------------------------------------
  // OC-S3-MF-003: Generate command block
  // -------------------------------------------------------------------------

  /**
   * Generate the command section of opencode.json from CommandTranslator output.
   * @returns {Record<string, object>}
   */
  generateCommandSection() {
    return { ...this.commandConfig };
  }

  // -------------------------------------------------------------------------
  // OC-S3-MF-004: Generate skills.paths
  // -------------------------------------------------------------------------

  /**
   * Generate the skills section of opencode.json from SkillCopier output.
   * @returns {{ paths: string[] }}
   */
  generateSkillsSection() {
    return {
      paths: [...this.skillPaths],
    };
  }

  // -------------------------------------------------------------------------
  // OC-S3-MF-005: Generate plugin array
  // -------------------------------------------------------------------------

  /**
   * Generate the plugin section of opencode.json.
   * @returns {string[]}
   */
  generatePluginSection() {
    return [`${this.pluginPackageName}@${this.pluginVersion}`];
  }

  // -------------------------------------------------------------------------
  // OC-S3-MF-006: Generate instructions array
  // -------------------------------------------------------------------------

  /**
   * Generate the instructions section of opencode.json.
   * Points to CLAUDE.md and/or AGENTS.md if they exist.
   * @param {string} [projectRoot] - Project root to check for files
   * @returns {string[]}
   */
  generateInstructionsSection(projectRoot) {
    const instructions = [];

    // Check for CLAUDE.md in the project root
    if (projectRoot && fs.existsSync(path.join(projectRoot, 'CLAUDE.md'))) {
      instructions.push('CLAUDE.md');
    }

    // AGENTS.md is always included as a reference (generated by the pipeline)
    instructions.push('AGENTS.md');

    return instructions;
  }

  // -------------------------------------------------------------------------
  // OC-S3-MF-007: Generate permission block
  // -------------------------------------------------------------------------

  /**
   * Generate the permission section of opencode.json.
   * Uses conservative defaults, merged with any overrides.
   * @returns {object}
   */
  generatePermissionSection() {
    if (!this.permissionOverrides) {
      return { ...DEFAULT_PERMISSIONS };
    }

    return {
      ...DEFAULT_PERMISSIONS,
      ...this.permissionOverrides,
    };
  }

  // -------------------------------------------------------------------------
  // OC-S3-MF-008: Build merged config and write
  // -------------------------------------------------------------------------

  /**
   * Build the complete opencode.json config object by merging all sections.
   * @param {string} [projectRoot] - Project root for instruction file detection
   * @returns {object} The merged config object
   */
  buildConfig(projectRoot) {
    const config = {
      $schema: 'https://opencode.ai/config.json',
      model: 'anthropic/claude-sonnet-4-20250514',
    };

    // Agent block (OC-S3-MF-002 - only include if provided)
    if (this.agentConfig && Object.keys(this.agentConfig).length > 0) {
      config.agent = { ...this.agentConfig };
    }

    // Command block (OC-S3-MF-003)
    const commandSection = this.generateCommandSection();
    if (Object.keys(commandSection).length > 0) {
      config.command = commandSection;
    }

    // Skills block (OC-S3-MF-004)
    config.skills = this.generateSkillsSection();

    // Plugin block (OC-S3-MF-005)
    config.plugin = this.generatePluginSection();

    // Instructions block (OC-S3-MF-006)
    config.instructions = this.generateInstructionsSection(projectRoot);

    // Permission block (OC-S3-MF-007)
    config.permission = this.generatePermissionSection();

    return config;
  }

  /**
   * Execute the full manifest generation pipeline synchronously.
   * @param {string} [projectRoot] - Project root for instruction file detection
   * @returns {ManifestGeneratorResult}
   */
  executeSync(projectRoot) {
    const errors = [];

    // Step 1: Discover and read manifests (MF-001)
    const manifests = this.discoverManifests();

    if (this.verbose) {
      console.log(`[manifest] Discovered ${manifests.length} plugin manifests`);
    }

    // Step 2: Build the merged config (MF-003 through MF-008)
    const configContent = this.buildConfig(projectRoot);

    // Step 3: Determine output path
    const configPath = path.join(this.outputDir, 'opencode.json');

    // Step 4: Write to disk unless dryRun
    if (!this.dryRun) {
      try {
        fs.mkdirSync(this.outputDir, { recursive: true });
        const jsonOutput = JSON.stringify(configContent, null, 2) + '\n';
        fs.writeFileSync(configPath, jsonOutput, 'utf-8');

        if (this.verbose) {
          console.log(`[manifest] Written: ${configPath}`);
        }
      } catch (err) {
        errors.push({
          filePath: configPath,
          message: err.message,
          error: err,
        });
      }
    } else {
      if (this.verbose) {
        console.log(`[manifest] [dry-run] Would write: ${configPath}`);
      }
    }

    return {
      configPath,
      configContent,
      manifestsRead: manifests.length,
      errors,
    };
  }
}

module.exports = { ManifestGenerator };
