// SkillCopier - Discovers and copies SKILL.md files to OpenCode paths
//
// Responsibilities:
//   - Discover all SKILL.md files across packages/[pkg]/skills/
//   - Inject frontmatter (name, description) for OpenCode discovery
//   - Convert REFERENCE.md to SKILL.md format where needed
//   - Copy validated skills to dist/opencode/.opencode/skill/[framework]/
//   - Generate skills.paths config entries for opencode.json
//
// Task IDs: OC-S1-SK-001 through OC-S1-SK-006

'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Parse YAML frontmatter from a markdown string.
 * Returns { data: {}, content: string, hasFrontmatter: boolean }
 *
 * This is a lightweight replacement for gray-matter that handles
 * the simple YAML frontmatter format used in SKILL.md files.
 */
function parseFrontmatter(input) {
  const trimmed = input;
  if (!trimmed.startsWith('---\n')) {
    return { data: {}, content: input, hasFrontmatter: false };
  }

  const endIndex = trimmed.indexOf('\n---\n', 4);
  if (endIndex === -1) {
    // Check if frontmatter closes at end of file: ---\n...\n---
    if (trimmed.endsWith('\n---')) {
      const yamlStr = trimmed.slice(4, trimmed.length - 3);
      const data = parseSimpleYaml(yamlStr);
      return { data, content: '', hasFrontmatter: true };
    }
    return { data: {}, content: input, hasFrontmatter: false };
  }

  const yamlStr = trimmed.slice(4, endIndex);
  const content = trimmed.slice(endIndex + 5); // skip \n---\n
  const data = parseSimpleYaml(yamlStr);

  return { data, content, hasFrontmatter: true };
}

/**
 * Parse simple YAML key-value pairs (single level only).
 * Handles strings, numbers, and simple lists. Enough for frontmatter.
 */
function parseSimpleYaml(yamlStr) {
  const data = {};
  const lines = yamlStr.split('\n');

  let currentKey = null;

  for (const line of lines) {
    // Skip empty lines and comments
    if (line.trim() === '' || line.trim().startsWith('#')) continue;

    // Check for list item (indented with -)
    if (/^\s+-\s+/.test(line) && currentKey) {
      const value = line.replace(/^\s+-\s+/, '').trim();
      if (!Array.isArray(data[currentKey])) {
        data[currentKey] = [];
      }
      data[currentKey].push(value);
      continue;
    }

    // Key-value pair
    const match = line.match(/^([a-zA-Z_][a-zA-Z0-9_-]*):\s*(.*)/);
    if (match) {
      const key = match[1];
      let value = match[2].trim();

      // Remove surrounding quotes
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      currentKey = key;
      if (value === '') {
        // Could be start of a list or multi-line value
        data[key] = '';
      } else {
        data[key] = value;
      }
    }
  }

  return data;
}

/**
 * Stringify a simple object to YAML frontmatter format.
 */
function stringifyFrontmatter(data) {
  const lines = [];
  for (const [key, value] of Object.entries(data)) {
    if (Array.isArray(value)) {
      lines.push(`${key}:`);
      for (const item of value) {
        lines.push(`  - ${item}`);
      }
    } else {
      // Quote values that contain special characters
      const strValue = String(value);
      if (
        strValue.includes(':') ||
        strValue.includes('#') ||
        strValue.includes('{') ||
        strValue.includes('}')
      ) {
        lines.push(`${key}: "${strValue}"`);
      } else {
        lines.push(`${key}: ${strValue}`);
      }
    }
  }
  return lines.join('\n');
}

/**
 * Extract the first meaningful line of content from markdown.
 * Used to generate a description from the file body.
 */
function extractDescription(content) {
  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    // Skip empty lines, headings, and horizontal rules
    if (
      trimmed === '' ||
      trimmed.startsWith('#') ||
      trimmed === '---' ||
      trimmed.startsWith('**Version') ||
      trimmed.startsWith('**Use Case')
    ) {
      continue;
    }
    // Strip bold markers for cleaner description
    const cleaned = trimmed.replace(/\*\*/g, '').trim();
    if (cleaned.length > 0) {
      // Truncate to reasonable length
      return cleaned.length > 120 ? cleaned.slice(0, 117) + '...' : cleaned;
    }
  }
  return 'Ensemble skill documentation';
}

class SkillCopier {
  /**
   * @param {object} options
   * @param {string} options.packagesDir - Path to packages/ directory
   * @param {string} options.outputDir - Path to dist/opencode/.opencode/skill/
   * @param {boolean} [options.injectFrontmatter=true] - Whether to add frontmatter
   * @param {boolean} [options.dryRun=false] - If true, don't write files
   * @param {boolean} [options.verbose=false] - If true, log progress
   */
  constructor(options) {
    this.packagesDir = options.packagesDir;
    this.outputDir = options.outputDir;
    this.injectFrontmatter =
      options.injectFrontmatter !== undefined ? options.injectFrontmatter : true;
    this.dryRun = options.dryRun || false;
    this.verbose = options.verbose || false;
  }

  /**
   * Execute the skill copy pipeline.
   * @returns {Promise<{skillsCopied: number, referencesConverted: number, paths: string[], errors: Array}>}
   */
  async execute() {
    const errors = [];
    let skillsCopied = 0;
    let referencesConverted = 0;

    // Step 1: Discover packages
    const packageDirs = this._discoverPackages();

    if (this.verbose) {
      console.log(`Discovered ${packageDirs.length} packages with skills`);
    }

    // Step 2: Process SKILL.md files
    for (const { packageName, skillPath } of packageDirs) {
      const skillFile = path.join(skillPath, 'SKILL.md');
      if (fs.existsSync(skillFile)) {
        try {
          this._processSkillFile(packageName, skillFile);
          skillsCopied++;
        } catch (err) {
          errors.push({
            file: skillFile,
            error: err.message,
          });
        }
      }
    }

    // Step 3: Process REFERENCE.md files
    for (const { packageName, skillPath } of packageDirs) {
      const refFile = path.join(skillPath, 'REFERENCE.md');
      if (fs.existsSync(refFile)) {
        try {
          this._processReferenceFile(packageName, refFile);
          referencesConverted++;
        } catch (err) {
          errors.push({
            file: refFile,
            error: err.message,
          });
        }
      }
    }

    // Step 4: Generate paths config
    const paths = this._generatePaths();

    return {
      skillsCopied,
      referencesConverted,
      paths,
      errors,
    };
  }

  /**
   * Discover all packages that have a skills/ directory.
   * @returns {Array<{packageName: string, skillPath: string}>}
   */
  _discoverPackages() {
    const results = [];

    if (!fs.existsSync(this.packagesDir)) {
      return results;
    }

    const entries = fs.readdirSync(this.packagesDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const skillPath = path.join(this.packagesDir, entry.name, 'skills');
      if (fs.existsSync(skillPath) && fs.statSync(skillPath).isDirectory()) {
        // Check if there's a SKILL.md or REFERENCE.md
        const hasSkill = fs.existsSync(path.join(skillPath, 'SKILL.md'));
        const hasRef = fs.existsSync(path.join(skillPath, 'REFERENCE.md'));

        if (hasSkill || hasRef) {
          results.push({
            packageName: entry.name,
            skillPath,
          });
        }
      }
    }

    return results;
  }

  /**
   * Process a SKILL.md file: read, inject frontmatter if needed, write to output.
   * NEVER modifies the source file.
   */
  _processSkillFile(packageName, sourcePath) {
    const rawContent = fs.readFileSync(sourcePath, 'utf-8');
    let outputContent;

    if (this.injectFrontmatter) {
      outputContent = this._ensureFrontmatter(rawContent, packageName);
    } else {
      outputContent = rawContent;
    }

    if (!this.dryRun) {
      const outDir = path.join(this.outputDir, packageName);
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(path.join(outDir, 'SKILL.md'), outputContent, 'utf-8');
    }

    if (this.verbose) {
      console.log(`  [SKILL] ${packageName}/SKILL.md -> ${packageName}/SKILL.md`);
    }
  }

  /**
   * Process a REFERENCE.md file: read, convert to SKILL.md format with frontmatter,
   * write to output as <framework>/reference/SKILL.md.
   * NEVER modifies the source file.
   */
  _processReferenceFile(packageName, sourcePath) {
    const rawContent = fs.readFileSync(sourcePath, 'utf-8');
    let outputContent;

    if (this.injectFrontmatter) {
      outputContent = this._createReferenceFrontmatter(rawContent, packageName);
    } else {
      outputContent = rawContent;
    }

    if (!this.dryRun) {
      const outDir = path.join(this.outputDir, packageName, 'reference');
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(path.join(outDir, 'SKILL.md'), outputContent, 'utf-8');
    }

    if (this.verbose) {
      console.log(
        `  [REF]   ${packageName}/REFERENCE.md -> ${packageName}/reference/SKILL.md`
      );
    }
  }

  /**
   * Ensure a SKILL.md file has valid frontmatter with name and description.
   * If frontmatter exists, adds missing fields. If not, creates new frontmatter.
   * Returns the new content string - never modifies the input.
   */
  _ensureFrontmatter(rawContent, packageName) {
    const parsed = parseFrontmatter(rawContent);

    if (parsed.hasFrontmatter) {
      // Frontmatter exists - ensure name and description are present
      const data = { ...parsed.data };
      let modified = false;

      if (!data.name) {
        data.name = packageName;
        modified = true;
      }

      if (!data.description) {
        data.description = extractDescription(parsed.content);
        modified = true;
      }

      if (modified) {
        // Rebuild with updated frontmatter
        const yamlStr = stringifyFrontmatter(data);
        return `---\n${yamlStr}\n---\n${parsed.content}`;
      }

      // Frontmatter already complete - return as-is
      return rawContent;
    }

    // No frontmatter - create new
    const description = extractDescription(rawContent);
    const data = {
      name: packageName,
      description,
    };
    const yamlStr = stringifyFrontmatter(data);
    return `---\n${yamlStr}\n---\n${rawContent}`;
  }

  /**
   * Create frontmatter for a REFERENCE.md file being converted to SKILL.md.
   * Uses <framework>-reference as the name.
   */
  _createReferenceFrontmatter(rawContent, packageName) {
    const parsed = parseFrontmatter(rawContent);
    const body = parsed.hasFrontmatter ? parsed.content : rawContent;
    const description = extractDescription(body);

    const data = {
      name: `${packageName}-reference`,
      description,
    };

    const yamlStr = stringifyFrontmatter(data);
    return `---\n${yamlStr}\n---\n${body}`;
  }

  /**
   * Generate the paths configuration for opencode.json.
   * Returns an array of paths pointing to the skill output directory.
   */
  _generatePaths() {
    // OpenCode discovers skills recursively from base paths.
    // We provide the single base skill directory.
    return [this.outputDir];
  }
}

module.exports = { SkillCopier, parseFrontmatter, stringifyFrontmatter };
