/**
 * CommandTranslator - Converts YAML commands to OpenCode Markdown format
 *
 * Responsibilities:
 *   - Parse Ensemble command YAML schema (OC-S1-CMD-001)
 *   - Translate metadata to Markdown headers (OC-S1-CMD-002)
 *   - Convert $ARGUMENTS to $PLACEHOLDER_NAME syntax (OC-S1-CMD-003)
 *   - Render workflow phases/steps as numbered Markdown sections (OC-S1-CMD-004)
 *   - Render constraints section (OC-S1-CMD-005)
 *   - Render expectedOutput section (OC-S1-CMD-006)
 *   - Add delegation step annotations (OC-S1-CMD-007)
 *   - Generate JSON command config entries for opencode.json (OC-S1-CMD-008)
 *   - Map model hints to OpenCode providerID/modelID format (OC-S1-CMD-009)
 *   - Write translated commands to output directory (OC-S1-CMD-010)
 *
 * Task IDs: OC-S1-CMD-001 through OC-S1-CMD-010
 */

'use strict';

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const glob = require('glob');

// ---------------------------------------------------------------------------
// Model hint mapping table (OC-S1-CMD-009)
// ---------------------------------------------------------------------------
const MODEL_MAP = {
  'opus-4-6': 'anthropic/claude-opus-4-6',
  opus: 'anthropic/claude-opus-4-6',
  'sonnet-4': 'anthropic/claude-sonnet-4-20250514',
  sonnet: 'anthropic/claude-sonnet-4-20250514',
  haiku: 'anthropic/claude-haiku-4-5-20251001',
};

// ---------------------------------------------------------------------------
// Known argument placeholder mappings per command name.
// Derived from TRD section 4.2 argument mapping table.
// ---------------------------------------------------------------------------
const ARGUMENT_PLACEHOLDERS = {
  'ensemble:create-prd': '$PRODUCT_DESCRIPTION',
  'ensemble:create-trd': '$PRD_PATH',
  'ensemble:fix-issue': '$ISSUE_DESCRIPTION',
  'ensemble:implement-trd': '$TRD_PATH',
  'ensemble:release': '$VERSION',
  'ensemble:refine-prd': '$PRD_PATH',
  'ensemble:refine-trd': '$TRD_PATH',
  'ensemble:analyze-product': '$PRODUCT_DESCRIPTION',
};

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

/**
 * Convert a hyphenated command slug to Title Case.
 * "fold-prompt" -> "Fold Prompt"
 */
// Known acronyms that should remain uppercase in titles
const ACRONYMS = new Set([
  'trd', 'prd', 'api', 'pr', 'ci', 'cd', 'e2e', 'ui', 'ux',
  'url', 'cli', 'sdk', 'mcp', 'lsp', 'aws', 'gcp', 'k8s',
]);

function toTitleCase(slug) {
  return slug
    .split('-')
    .map((w) => {
      if (ACRONYMS.has(w.toLowerCase())) {
        return w.toUpperCase();
      }
      return w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join(' ');
}

/**
 * Strip the "ensemble:" namespace prefix from a command name.
 */
function stripNamespace(name) {
  if (name.includes(':')) {
    return name.split(':').slice(1).join(':');
  }
  return name;
}

/**
 * Determine whether a parsed command uses $ARGUMENTS anywhere in its text fields.
 */
function usesArguments(parsed) {
  const text = JSON.stringify(parsed);
  return text.includes('$ARGUMENTS');
}

/**
 * Get the placeholder string for a command. Returns empty string if none.
 */
function getPlaceholder(parsed) {
  const name = parsed.metadata.name;

  // 1. Check explicit placeholder mapping
  if (ARGUMENT_PLACEHOLDERS[name]) {
    return ARGUMENT_PLACEHOLDERS[name];
  }

  // 2. If the command has a parameters section, derive from first required or first param
  if (parsed.parameters && Array.isArray(parsed.parameters) && parsed.parameters.length > 0) {
    const first =
      parsed.parameters.find((p) => p.required) || parsed.parameters[0];
    return '$' + first.name.toUpperCase().replace(/-/g, '_');
  }

  // 3. If the command uses $ARGUMENTS but has no mapping, derive from command name
  if (usesArguments(parsed)) {
    const slug = stripNamespace(name);
    return '$' + slug.toUpperCase().replace(/-/g, '_') + '_INPUT';
  }

  return '';
}

/**
 * Replace all occurrences of $ARGUMENTS in a string with the appropriate placeholder.
 */
function replaceArguments(text, placeholder) {
  if (!text || !placeholder) return text;
  return text.replace(/\$ARGUMENTS/g, placeholder);
}

// ---------------------------------------------------------------------------
// CommandTranslator class
// ---------------------------------------------------------------------------
class CommandTranslator {
  /**
   * @param {object} options
   * @param {string} options.packagesDir  - Path to packages/ directory
   * @param {string} options.outputDir    - Path to output directory for .md files
   * @param {boolean} options.dryRun      - If true, don't write files
   * @param {boolean} options.verbose     - If true, log extra info
   */
  constructor(options) {
    this.packagesDir = options.packagesDir;
    this.outputDir = options.outputDir;
    this.dryRun = options.dryRun || false;
    this.verbose = options.verbose || false;
  }

  // -------------------------------------------------------------------------
  // OC-S1-CMD-001: Parse Ensemble command YAML
  // -------------------------------------------------------------------------

  /**
   * Parse a YAML command file and return the parsed object.
   * @param {string} filePath - Absolute path to the YAML file
   * @returns {object} Parsed YAML object
   */
  parseCommandYaml(filePath) {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Command YAML file not found: ${filePath}`);
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    const parsed = yaml.load(content);
    if (!parsed || !parsed.metadata || !parsed.workflow) {
      throw new Error(
        `Invalid command YAML (missing metadata or workflow): ${filePath}`
      );
    }
    return parsed;
  }

  // -------------------------------------------------------------------------
  // OC-S1-CMD-002 + 003 + 004 + 005 + 006 + 007: Translate to Markdown
  // -------------------------------------------------------------------------

  /**
   * Translate a parsed command YAML object to OpenCode Markdown format.
   * @param {object} parsed - Parsed YAML object from parseCommandYaml
   * @returns {string} Generated Markdown content
   */
  translateToMarkdown(parsed) {
    const lines = [];
    const placeholder = getPlaceholder(parsed);

    // --- Title (CMD-002) ---
    const slug = stripNamespace(parsed.metadata.name);
    const title = toTitleCase(slug);
    if (placeholder) {
      lines.push(`# ${title} ${placeholder}`);
    } else {
      lines.push(`# ${title}`);
    }
    lines.push('');

    // --- Description ---
    if (parsed.metadata.description) {
      let desc = parsed.metadata.description.trim();
      desc = replaceArguments(desc, placeholder);
      lines.push(desc);
      lines.push('');
    }

    // --- Mission summary ---
    if (parsed.mission && parsed.mission.summary) {
      let summary = parsed.mission.summary.trim();
      summary = replaceArguments(summary, placeholder);
      lines.push(summary);
      lines.push('');
    }

    // --- Constraints (CMD-005) ---
    if (parsed.constraints && Array.isArray(parsed.constraints) && parsed.constraints.length > 0) {
      lines.push('## Constraints');
      lines.push('');
      for (const constraint of parsed.constraints) {
        lines.push(`- ${constraint}`);
      }
      lines.push('');
    }

    // --- Workflow phases and steps (CMD-004 + CMD-007) ---
    if (parsed.workflow && parsed.workflow.phases) {
      const sortedPhases = [...parsed.workflow.phases].sort(
        (a, b) => a.order - b.order
      );
      for (const phase of sortedPhases) {
        lines.push(`## Phase ${phase.order}: ${phase.name}`);
        lines.push('');

        if (phase.description) {
          lines.push(phase.description.trim());
          lines.push('');
        }

        if (phase.steps && Array.isArray(phase.steps)) {
          const sortedSteps = [...phase.steps].sort(
            (a, b) => a.order - b.order
          );
          for (const step of sortedSteps) {
            const stepTitle = step.title || `Step ${step.order}`;
            lines.push(
              `### Step ${phase.order}.${step.order}: ${stepTitle}`
            );
            lines.push('');

            if (step.description) {
              let desc = step.description.trim();
              desc = replaceArguments(desc, placeholder);
              lines.push(desc);
              lines.push('');
            }

            // Delegation annotation (CMD-007)
            if (step.delegation) {
              lines.push(`**Agent:** @${step.delegation.agent}`);
              if (step.delegation.context) {
                lines.push('');
                lines.push(`> ${step.delegation.context}`);
              }
              lines.push('');
            }

            // Actions as bullet points
            if (step.actions && Array.isArray(step.actions)) {
              for (const action of step.actions) {
                let actionText = typeof action === 'string' ? action : String(action);
                actionText = replaceArguments(actionText, placeholder);
                lines.push(`- ${actionText}`);
              }
              lines.push('');
            }
          }
        }
      }
    }

    // --- Expected Output (CMD-006) ---
    if (parsed.expectedOutput) {
      lines.push('## Expected Output');
      lines.push('');

      if (parsed.expectedOutput.format) {
        lines.push(`**Format:** ${parsed.expectedOutput.format}`);
        lines.push('');
      }

      if (
        parsed.expectedOutput.structure &&
        Array.isArray(parsed.expectedOutput.structure)
      ) {
        for (const item of parsed.expectedOutput.structure) {
          lines.push(`- **${item.name}**: ${item.description}`);
        }
        lines.push('');
      }
    }

    // Join and trim trailing whitespace per line
    return lines
      .map((line) => line.trimEnd())
      .join('\n')
      .trimEnd()
      .concat('\n');
  }

  // -------------------------------------------------------------------------
  // OC-S1-CMD-008: Generate JSON command config entry
  // -------------------------------------------------------------------------

  /**
   * Generate a JSON config entry for the opencode.json command block.
   * @param {object} parsed - Parsed YAML object
   * @returns {object} Config entry keyed by command name
   */
  generateConfigEntry(parsed) {
    const name = parsed.metadata.name;
    const entry = {
      description: parsed.metadata.description.trim(),
      subtask: false,
    };

    // Map model hint to agent field (CMD-009)
    if (parsed.metadata.model) {
      const model = this.mapModelHint(parsed.metadata.model);
      if (model) {
        entry.agent = 'build';
        entry.model = model;
      }
    }

    return { [name]: entry };
  }

  // -------------------------------------------------------------------------
  // OC-S1-CMD-009: Model hint mapping
  // -------------------------------------------------------------------------

  /**
   * Map an Ensemble model hint to OpenCode providerID/modelID format.
   * @param {string|undefined} hint - Model hint from metadata
   * @returns {string|undefined} OpenCode model string or undefined
   */
  mapModelHint(hint) {
    if (!hint) return undefined;
    return MODEL_MAP[hint];
  }

  // -------------------------------------------------------------------------
  // OC-S1-CMD-010: Discovery and file output
  // -------------------------------------------------------------------------

  /**
   * Discover all command YAML files across packages/ directories.
   * @returns {string[]} Array of absolute paths to YAML files
   */
  discoverCommandFiles() {
    const pattern = path.join(this.packagesDir, '*/commands/*.yaml');
    const files = glob.sync(pattern);
    return files.sort();
  }

  /**
   * Get the output file path for a parsed command.
   * @param {object} parsed - Parsed YAML object
   * @returns {string} Output .md file path
   */
  getOutputPath(parsed) {
    const slug = stripNamespace(parsed.metadata.name);
    return path.join(this.outputDir, `${slug}.md`);
  }

  /**
   * Write a command Markdown file to disk.
   * @param {string} filePath - Output file path
   * @param {string} content - Markdown content
   */
  writeCommandFile(filePath, content) {
    if (this.dryRun) {
      if (this.verbose) {
        console.log(`[dry-run] Would write: ${filePath}`);
      }
      return;
    }
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, content, 'utf-8');
    if (this.verbose) {
      console.log(`Written: ${filePath}`);
    }
  }

  /**
   * Execute the full translation pipeline synchronously.
   * @returns {object} CommandTranslatorResult
   */
  executeSync() {
    const errors = [];
    const commands = [];
    const configBlock = {};

    const files = this.discoverCommandFiles();

    for (const filePath of files) {
      try {
        const parsed = this.parseCommandYaml(filePath);
        const markdownContent = this.translateToMarkdown(parsed);
        const outputPath = this.getOutputPath(parsed);
        const configEntry = this.generateConfigEntry(parsed);

        // Merge config entry into block
        Object.assign(configBlock, configEntry);

        commands.push({
          markdownPath: outputPath,
          markdownContent,
          configEntry,
          sourcePath: filePath,
        });

        // Write file unless dry-run
        this.writeCommandFile(outputPath, markdownContent);
      } catch (err) {
        errors.push({
          filePath,
          message: err.message,
          error: err,
        });
        if (this.verbose) {
          console.error(`Error translating ${filePath}: ${err.message}`);
        }
      }
    }

    return { commands, configBlock, errors };
  }
}

module.exports = { CommandTranslator };
