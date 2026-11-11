// SkillCopier - Discovers and copies SKILL.md files to OpenCode paths
//
// Responsibilities:
//   - Discover each package's framework skill (packages/[pkg]/skills/[pkg]/) and its adapters
//   - Inject frontmatter (name, description) for OpenCode discovery
//   - Convert REFERENCE.md to SKILL.md format where needed
//   - Copy validated skills to dist/opencode/.opencode/skill/[framework]/
//   - Generate skills.paths config entries for opencode.json
//
// Task IDs: OC-S1-SK-001 through OC-S1-SK-006

'use strict';

const fs = require('fs');
const path = require('path');

// Packages that MIRROR every other package's skills/adapter-* directories (packages/pi's own
// generator output, packages/full's curated symlink tree -- see
// packages/pi/src/transformers/skill-copier.ts's own EXCLUDED_PACKAGES for the same rule on
// the Pi side) must never be treated as a SECOND, independent adapter source: TRD-024 is the
// first real adapter this monorepo ships, and it exposed a latent gap here -- `packages/pi`'s
// generated `packages/pi/skills/adapter-tracker-beads/` otherwise collides with the real
// source at `packages/development/skills/adapter-tracker-beads/`, a false positive the
// SkillCopier's own collision check (`execute()` above) would wrongly treat as two different
// packages shipping the same adapter name.
const ADAPTER_SOURCE_EXCLUDED_PACKAGES = new Set(['pi', 'full']);
/** Normalize CRLF/CR to LF so frontmatter delimiter checks can assume '\n'. */
function normalizeLineEndings(text) {
  return String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/**
 * Parse YAML frontmatter from a markdown string.
 * Returns { data: {}, content: string, hasFrontmatter: boolean }
 *
 * This is a lightweight replacement for gray-matter that handles
 * the simple YAML frontmatter format used in SKILL.md files.
 */
function parseFrontmatter(input) {
  // CRLF safety: the delimiter checks below require a literal '\n' next to
  // '---', so a CRLF-sourced file (the norm on Windows checkouts with
  // core.autocrlf=true) would silently read as having no frontmatter at all.
  const trimmed = normalizeLineEndings(input);
  if (!trimmed.startsWith('---\n')) {
    return { data: {}, content: trimmed, hasFrontmatter: false };
  }

  const endIndex = trimmed.indexOf('\n---\n', 4);
  if (endIndex === -1) {
    // Check if frontmatter closes at end of file: ---\n...\n---
    if (trimmed.endsWith('\n---')) {
      const yamlStr = trimmed.slice(4, trimmed.length - 3);
      const data = parseSimpleYaml(yamlStr);
      return { data, content: '', hasFrontmatter: true };
    }
    return { data: {}, content: trimmed, hasFrontmatter: false };
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

    // Step 1b: Detect adapter directory-name collisions (TRD-020 P2 fix). Output for an
    // adapter is keyed purely by the adapter directory's own basename (not the owning
    // package), so two different packages shipping e.g. `skills/adapter-cc/` would otherwise
    // silently last-writer-wins into the same `<outputDir>/adapter-cc/` with no warning --
    // directly contradicting the PRD's "fail explicitly rather than falling back/silently
    // losing data" posture. Fail loudly instead, naming every colliding source path, and
    // skip writing any of the colliding adapters (rather than picking one arbitrarily).
    const adapterSourcesByName = new Map();
    for (const entry of packageDirs) {
      if (!entry.isAdapter) continue;
      const sources = adapterSourcesByName.get(entry.packageName) || [];
      sources.push(entry.skillPath);
      adapterSourcesByName.set(entry.packageName, sources);
    }
    const collidingAdapterNames = new Set();
    for (const [adapterName, sources] of adapterSourcesByName) {
      if (sources.length <= 1) continue;
      collidingAdapterNames.add(adapterName);
      errors.push({
        file: adapterName,
        error:
          `Adapter directory name collision: "${adapterName}" is shipped by multiple packages ` +
          `(${sources.join(', ')}); each adapter directory name must be unique across the ` +
          'monorepo because OpenCode output is keyed by the adapter directory\'s own name.',
      });
    }
    const processablePackageDirs = packageDirs.filter(
      (entry) => !(entry.isAdapter && collidingAdapterNames.has(entry.packageName))
    );

    // Step 2: Process SKILL.md files
    for (const { packageName, skillPath, isAdapter } of processablePackageDirs) {
      const skillFile = path.join(skillPath, 'SKILL.md');
      if (fs.existsSync(skillFile)) {
        try {
          this._processSkillFile(packageName, skillFile);
          skillsCopied++;
          if (isAdapter) {
            this._copyAdapterManifest(packageName, skillPath);
          }
        } catch (err) {
          errors.push({
            file: skillFile,
            error: err.message,
          });
        }
      }
    }

    // Step 2b: Prune stale adapter-* output directories (TRD-020 P2 fix). SkillCopier has no
    // "wipe everything first" step (unlike the Codex generator's resetOutput()), so without
    // this an adapter whose source directory is removed or renamed leaves its last-generated
    // output fully resolver-visible forever, undermining REQ-021 (identical, correct
    // resolution across runtimes). Scoped to `adapter-*` output directories only -- this
    // bead's own new surface -- not the general, pre-existing staleness gap affecting
    // ordinary package skill output (confirmed separately: that gap pre-dates this feature
    // and is out of scope for this fix). Colliding adapter names are left untouched rather
    // than pruned, since Step 1b already refused to write them this run.
    const prunedAdapters = [];
    if (!this.dryRun && fs.existsSync(this.outputDir)) {
      const validAdapterNames = new Set(
        processablePackageDirs.filter((entry) => entry.isAdapter).map((entry) => entry.packageName)
      );
      for (const entry of fs.readdirSync(this.outputDir, { withFileTypes: true })) {
        if (!entry.isDirectory() || !entry.name.startsWith('adapter-')) continue;
        if (validAdapterNames.has(entry.name) || collidingAdapterNames.has(entry.name)) continue;
        fs.rmSync(path.join(this.outputDir, entry.name), { recursive: true, force: true });
        prunedAdapters.push(entry.name);
        if (this.verbose) {
          console.log(`  [ADAPTER] removed stale ${entry.name}/ (source no longer present)`);
        }
      }
    }

    // Step 3: Process REFERENCE.md files
    for (const { packageName, skillPath } of processablePackageDirs) {
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
      prunedAdapters,
    };
  }

  /**
   * Discover every skill to copy: each package's framework skill, the skill named after the
   * package at `skills/<pkg>/` (react, jest, reqnroll, ...), plus every
   * `skills/adapter-NAME` subdirectory (TRD-020, PRD REQ-021): an adapter directory ships a
   * SKILL.md describing it plus an adapter.yaml manifest the toolchain resolver reads, and is
   * keyed by its OWN directory name (not the owning package name) so two adapters shipped
   * from the same package never collide. Two DIFFERENT packages shipping an adapter directory
   * with the same basename is detected and reported as a hard error by execute() (see the
   * adapter-name collision check there), not a silent last-writer-wins overwrite.
   * @returns {Array<{packageName: string, skillPath: string, isAdapter?: boolean}>}
   */
  _discoverPackages() {
    const results = [];

    if (!fs.existsSync(this.packagesDir)) {
      return results;
    }

    const entries = fs.readdirSync(this.packagesDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const skillsPath = path.join(this.packagesDir, entry.name, 'skills');
      if (!fs.existsSync(skillsPath) || !fs.statSync(skillsPath).isDirectory()) continue;

      // Framework skill: packages/<pkg>/skills/<pkg>/ holding a SKILL.md or REFERENCE.md
      const frameworkPath = path.join(skillsPath, entry.name);
      if (
        fs.existsSync(path.join(frameworkPath, 'SKILL.md')) ||
        fs.existsSync(path.join(frameworkPath, 'REFERENCE.md'))
      ) {
        results.push({
          packageName: entry.name,
          skillPath: frameworkPath,
        });
      }

      if (!ADAPTER_SOURCE_EXCLUDED_PACKAGES.has(entry.name)) {
        for (const sub of fs.readdirSync(skillsPath, { withFileTypes: true })) {
          if (!sub.isDirectory() || !sub.name.startsWith('adapter-')) continue;
          const adapterPath = path.join(skillsPath, sub.name);
          if (fs.existsSync(path.join(adapterPath, 'SKILL.md'))) {
            results.push({
              packageName: sub.name,
              skillPath: adapterPath,
              isAdapter: true,
            });
          }
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
   * Copy an adapter directory's adapter.yaml manifest (TRD-020, PRD REQ-021) byte-for-byte
   * alongside its already-copied SKILL.md. NEVER rewritten: adapter.yaml is the toolchain
   * resolver's own manifest format, not a skill frontmatter document.
   */
  _copyAdapterManifest(packageName, skillPath) {
    const adapterYamlSource = path.join(skillPath, 'adapter.yaml');
    if (!fs.existsSync(adapterYamlSource)) return;

    if (!this.dryRun) {
      const outDir = path.join(this.outputDir, packageName);
      fs.mkdirSync(outDir, { recursive: true });
      fs.copyFileSync(adapterYamlSource, path.join(outDir, 'adapter.yaml'));
    }

    if (this.verbose) {
      console.log(`  [ADAPTER] ${packageName}/adapter.yaml -> ${packageName}/adapter.yaml`);
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

module.exports = { SkillCopier, parseFrontmatter, stringifyFrontmatter, normalizeLineEndings };
