#!/usr/bin/env node

/**
 * OpenCode Generator CLI Entry Point
 *
 * Orchestrates the translation of Ensemble plugin artifacts into
 * OpenCode-compatible formats. This is the main entry point for
 * `npm run generate:opencode`.
 *
 * Pipeline:
 *   1. SkillCopier      - Copy/validate SKILL.md files
 *   2. CommandTranslator - YAML commands -> OpenCode Markdown
 *   3. AgentTranslator   - YAML agents -> OpenCode JSON config + Markdown
 *   4. HookBridge        - Hook bridge config generation
 *   5. ManifestGenerator - Produce unified opencode.json
 *
 * Task IDs: OC-S3-CLI-001 through OC-S3-CLI-009
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { vendorToolchainLibrary } = require('../lib/toolchain-vendor');

// ---------------------------------------------------------------------------
// CLI-001: Argument parsing (using commander, available in devDependencies)
// ---------------------------------------------------------------------------

const { Command } = require('commander');

const ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_OUTPUT_DIR = path.join(ROOT, 'dist', 'opencode');
const PACKAGES_DIR = path.join(ROOT, 'packages');
// Packages that MIRROR every other package's skills/adapter-* directories (packages/pi's own
// generator output, packages/full's curated symlink tree -- see
// packages/pi/src/transformers/skill-copier.ts's own EXCLUDED_PACKAGES for the same rule on
// the Pi side) must never be treated as a SECOND, independent adapter source: TRD-024 is the
// first real adapter this monorepo ships, and it exposed a latent gap here -- `packages/pi`'s
// generated `packages/pi/skills/adapter-tracker-beads/` otherwise collides with the real
// source at `packages/development/skills/adapter-tracker-beads/` in `SkillCopier`'s own
// collision check (`packages/opencode/lib/skill-copier.js#execute`).
const ADAPTER_SOURCE_EXCLUDED_PACKAGES = new Set(['pi', 'full']);

function createProgram() {
  const program = new Command();
  program
    .name('generate-opencode')
    .description('Generate OpenCode-compatible artifacts from Ensemble plugins')
    .option('--dry-run', 'Preview output without writing files', false)
    .option('--verbose', 'Detailed logging of each translation step', false)
    .option('--validate', 'Validate generated opencode.json after generation', false)
    .option('--output-dir <dir>', `Output directory (default: dist/opencode/)`, DEFAULT_OUTPUT_DIR)
    .option('--packages-dir <dir>', `Source packages directory (default: packages/)`, PACKAGES_DIR)
    .option('--force', 'Bypass incremental cache, regenerate everything', false)
    .helpOption('-h, --help', 'Display help for command');

  return program;
}

// ---------------------------------------------------------------------------
// CLI-007: Hash-based incremental generation
// ---------------------------------------------------------------------------

function getCachePath(outputDir) {
  return path.join(outputDir, '.cache', 'hashes.json');
}

function loadHashCache(outputDir) {
  const cachePath = getCachePath(outputDir);
  if (fs.existsSync(cachePath)) {
    try {
      return JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
    } catch {
      return {};
    }
  }
  return {};
}

function saveHashCache(outputDir, cache) {
  const cachePath = getCachePath(outputDir);
  const cacheDir = path.dirname(cachePath);
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2), 'utf-8');
}

function hashFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const content = fs.readFileSync(filePath, 'utf-8');
  return crypto.createHash('sha256').update(content).digest('hex');
}

function hashFiles(filePaths) {
  const hashes = {};
  for (const fp of filePaths) {
    const h = hashFile(fp);
    if (h) {
      hashes[fp] = h;
    }
  }
  return hashes;
}

function hasChanges(oldCache, newHashes) {
  for (const [fp, hash] of Object.entries(newHashes)) {
    if (oldCache[fp] !== hash) return true;
  }
  // Check if any old files were removed
  for (const fp of Object.keys(oldCache)) {
    if (!(fp in newHashes)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// CLI-008: Progress / timing helpers
// ---------------------------------------------------------------------------

function formatDuration(ms) {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

class StepTimer {
  constructor(name, verbose) {
    this.name = name;
    this.verbose = verbose;
    this.start = Date.now();
  }

  end(details) {
    const elapsed = Date.now() - this.start;
    const msg = `  [${this.name}] ${details || 'done'} (${formatDuration(elapsed)})`;
    if (this.verbose) {
      console.log(msg);
    }
    return { name: this.name, elapsed, details };
  }
}

// ---------------------------------------------------------------------------
// CLI-006: Pipeline orchestration
// ---------------------------------------------------------------------------

/**
 * Discover source files for a given category to compute hashes. Includes every
 * `skills/adapter-NAME/{SKILL.md,adapter.yaml}` pair (TRD-020, PRD REQ-021) alongside each
 * package's framework skill (`skills/<pkg>/SKILL.md` and `skills/<pkg>/REFERENCE.md`), so an
 * adapter.yaml-only edit still invalidates the incremental hash cache instead of being silently
 * skipped as "unchanged".
 */
function discoverSkillSourceFiles(packagesDir = PACKAGES_DIR) {
  const files = [];
  if (!fs.existsSync(packagesDir)) return files;
  const entries = fs.readdirSync(packagesDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillsPath = path.join(packagesDir, entry.name, 'skills');
    if (fs.existsSync(skillsPath)) {
      const frameworkPath = path.join(skillsPath, entry.name);
      const skillFile = path.join(frameworkPath, 'SKILL.md');
      const refFile = path.join(frameworkPath, 'REFERENCE.md');
      if (fs.existsSync(skillFile)) files.push(skillFile);
      if (fs.existsSync(refFile)) files.push(refFile);

      if (!ADAPTER_SOURCE_EXCLUDED_PACKAGES.has(entry.name)) {
        for (const sub of fs.readdirSync(skillsPath, { withFileTypes: true })) {
          if (!sub.isDirectory() || !sub.name.startsWith('adapter-')) continue;
          const adapterPath = path.join(skillsPath, sub.name);
          const adapterSkillFile = path.join(adapterPath, 'SKILL.md');
          const adapterYamlFile = path.join(adapterPath, 'adapter.yaml');
          if (fs.existsSync(adapterSkillFile)) files.push(adapterSkillFile);
          if (fs.existsSync(adapterYamlFile)) files.push(adapterYamlFile);
        }
      }
    }
  }
  return files;
}

function discoverCommandSourceFiles(packagesDir = PACKAGES_DIR) {
  const files = [];
  if (!fs.existsSync(packagesDir)) return files;
  try {
    const glob = require('glob');
    const pattern = path.join(packagesDir, '*/commands/*.yaml');
    return glob.sync(pattern).sort();
  } catch {
    // Fallback if glob not available
    const entries = fs.readdirSync(packagesDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const cmdDir = path.join(packagesDir, entry.name, 'commands');
      if (fs.existsSync(cmdDir)) {
        const yamls = fs.readdirSync(cmdDir).filter((f) => f.endsWith('.yaml'));
        for (const y of yamls) {
          files.push(path.join(cmdDir, y));
        }
      }
    }
    return files.sort();
  }
}

async function runPipeline(opts) {
  const {
    dryRun,
    verbose,
    validate,
    outputDir,
    force,
    packagesDir = PACKAGES_DIR,
  } = opts;

  const totalStart = Date.now();
  const errors = [];
  const stepResults = [];
  let oldCache = {};

  if (!force && !dryRun) {
    oldCache = loadHashCache(outputDir);
  }

  if (verbose && force) {
    console.log('  [cache] Force mode: regenerating all artifacts');
  }

  const newCache = {};

  if (dryRun) {
    console.log('[dry-run] No files will be written.');
  }

  // --- Step 1: SkillCopier ---
  let skillResult = { skillsCopied: 0, referencesConverted: 0, errors: [] };
  {
    const timer = new StepTimer('SkillCopier', verbose);
    try {
      const { SkillCopier } = require('../../packages/opencode/lib/skill-copier.js');
      const skillOutputDir = path.join(outputDir, '.opencode', 'skill');

      // Hash check for skills
      const skillSourceFiles = discoverSkillSourceFiles(packagesDir);
      const skillHashes = hashFiles(skillSourceFiles);

      // Build a combined category key
      const skillCacheKey = 'skills';
      const skillHashStr = JSON.stringify(skillHashes);
      const skillHash = crypto.createHash('sha256').update(skillHashStr).digest('hex');
      Object.assign(newCache, skillHashes);

      const skillsCached = !force && oldCache._skillHash === skillHash;

      if (skillsCached && !dryRun) {
        const info = timer.end(`${skillSourceFiles.length} files unchanged, skipped`);
        stepResults.push(info);
        if (verbose) {
          console.log('  [SkillCopier] Up to date (cached)');
        }
      } else {
        const copier = new SkillCopier({
          packagesDir,
          outputDir: skillOutputDir,
          injectFrontmatter: true,
          dryRun,
          verbose,
        });

        skillResult = await copier.execute();
        newCache._skillHash = skillHash;

        if (skillResult.errors.length > 0) {
          for (const e of skillResult.errors) {
            errors.push({ step: 'SkillCopier', file: e.file, message: e.error });
          }
        }

        const info = timer.end(
          `${skillResult.skillsCopied} skills copied, ${skillResult.referencesConverted} references converted`
        );
        stepResults.push(info);
      }
    } catch (err) {
      errors.push({ step: 'SkillCopier', message: err.message });
      const info = timer.end(`ERROR: ${err.message}`);
      stepResults.push(info);
    }
  }

  // --- Step 1b: ToolchainVendor (TRD-020, PRD REQ-021) ---
  // Vendors toolchain-cli.js + its toolchain/*.js submodules + the toolchain/ data
  // directory under the skill output dir, so a standalone copy of this OpenCode bundle (no
  // monorepo checkout) can run its own `toolchain-cli.js resolve --json` after `npm install`.
  // Unconditional (no hash-cache gate): the vendored tree is small and bounded, and only
  // changes alongside packages/development/lib/toolchain, which already isn't on the
  // skill-copier staleness watch list.
  {
    const timer = new StepTimer('ToolchainVendor', verbose);
    try {
      const vendorRoot = path.join(outputDir, '.opencode', 'skill', 'vendor');
      const toolchainVendorResult = vendorToolchainLibrary({
        sourceRoot: ROOT,
        vendorRoot,
        packageName: '@sunstone-partners/ensemble-opencode-toolchain-vendor',
        dryRun,
        verbose,
      });
      const info = timer.end(`${toolchainVendorResult.files.length} file(s) vendored`);
      stepResults.push(info);
    } catch (err) {
      errors.push({ step: 'ToolchainVendor', message: err.message });
      const info = timer.end(`ERROR: ${err.message}`);
      stepResults.push(info);
    }
  }

  // --- Step 2: CommandTranslator ---
  let cmdResult = { commands: [], configBlock: {}, errors: [] };
  {
    const timer = new StepTimer('CommandTranslator', verbose);
    try {
      const { CommandTranslator } = require('./src/command-translator.js');
      const cmdOutputDir = path.join(outputDir, '.opencode', 'commands', 'ensemble');

      // Hash check for commands
      const cmdSourceFiles = discoverCommandSourceFiles(packagesDir);
      const cmdHashes = hashFiles(cmdSourceFiles);
      const cmdHashStr = JSON.stringify(cmdHashes);
      const cmdHash = crypto.createHash('sha256').update(cmdHashStr).digest('hex');
      Object.assign(newCache, cmdHashes);

      const cmdsCached = !force && oldCache._cmdHash === cmdHash;

      if (cmdsCached && !dryRun) {
        const info = timer.end(`${cmdSourceFiles.length} files unchanged, skipped`);
        stepResults.push(info);
        if (verbose) {
          console.log('  [CommandTranslator] Up to date (cached)');
        }
      } else {
        const translator = new CommandTranslator({
          packagesDir,
          outputDir: cmdOutputDir,
          dryRun,
          verbose,
        });

        cmdResult = translator.executeSync();
        newCache._cmdHash = cmdHash;

        if (cmdResult.errors.length > 0) {
          for (const e of cmdResult.errors) {
            errors.push({ step: 'CommandTranslator', file: e.filePath, message: e.message });
          }
        }

        const info = timer.end(
          `${cmdResult.commands.length} commands translated`
        );
        stepResults.push(info);
      }
    } catch (err) {
      errors.push({ step: 'CommandTranslator', message: err.message });
      const info = timer.end(`ERROR: ${err.message}`);
      stepResults.push(info);
    }
  }

  // --- Step 3: AgentTranslator ---
  let agentResult = { configBlock: {}, routingPrompt: '', agents: [], errors: [] };
  {
    const timer = new StepTimer('AgentTranslator', verbose);
    try {
      const { AgentTranslator } = require('./src/agent-translator');
      const translator = new AgentTranslator({
        packagesDir,
        outputDir: path.join(outputDir, '.opencode', 'agents'),
        dryRun,
        verbose,
      });
      agentResult = translator.executeSync();
      const agentCount = agentResult.agents.length;
      const errCount = agentResult.errors.length;
      const info = timer.end(`${agentCount} agents translated${errCount > 0 ? `, ${errCount} errors` : ''}`);
      stepResults.push(info);
      if (errCount > 0) {
        for (const e of agentResult.errors) {
          errors.push({ step: 'AgentTranslator', message: e.message });
        }
      }
    } catch (err) {
      errors.push({ step: 'AgentTranslator', message: err.message });
      const info = timer.end(`ERROR: ${err.message}`);
      stepResults.push(info);
    }
  }

  // --- Step 4: HookBridgeGenerator (deferred - Sprint 2) ---
  {
    const timer = new StepTimer('HookBridge', verbose);
    if (verbose) {
      console.log('  [HookBridge] Skipped - not yet implemented (Sprint 2)');
    }
    const info = timer.end('skipped (not yet implemented)');
    stepResults.push(info);
  }

  // --- Step 5: ManifestGenerator ---
  {
    const timer = new StepTimer('ManifestGenerator', verbose);
    try {
      // ManifestGenerator is being implemented concurrently.
      // Try to load it; if it's still a stub, generate a basic manifest ourselves.
      const manifestPath = path.join(outputDir, 'opencode.json');

      // Build a basic manifest from the data we have
      const manifest = {
        $schema: 'https://opencode.ai/schema/opencode.json',
        command: cmdResult.configBlock || {},
        skills: {
          paths: (skillResult.paths || [path.join(outputDir, '.opencode', 'skill')]).concat([
            path.join(outputDir, '.opencode', 'skill', 'vendor'),
          ]),
        },
        agent: agentResult.configBlock || {},
        plugin: [],
        instructions: [],
        permission: {
          bash: 'ask',
          edit: 'allow',
          read: 'allow',
        },
      };

      if (!dryRun) {
        fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
        fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');

        // OC-S1-PKG-006: ensure each output directory persists in git
        const gitkeepDirs = [
          path.join(outputDir, '.opencode', 'commands', 'ensemble'),
          path.join(outputDir, '.opencode', 'agents'),
          path.join(outputDir, '.opencode', 'skill'),
        ];
        for (const dir of gitkeepDirs) {
          fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(path.join(dir, '.gitkeep'), '');
        }
      }

      const info = timer.end('opencode.json generated');
      stepResults.push(info);
    } catch (err) {
      errors.push({ step: 'ManifestGenerator', message: err.message });
      const info = timer.end(`ERROR: ${err.message}`);
      stepResults.push(info);
    }
  }

  // --- Save hash cache ---
  if (!dryRun) {
    try {
      saveHashCache(outputDir, newCache);
    } catch (err) {
      if (verbose) {
        console.log(`  [cache] Warning: could not save hash cache: ${err.message}`);
      }
    }
  }

  // --- CLI-004: Validation ---
  if (validate) {
    const timer = new StepTimer('Validation', verbose);
    try {
      const manifestPath = path.join(outputDir, 'opencode.json');
      if (fs.existsSync(manifestPath)) {
        const content = fs.readFileSync(manifestPath, 'utf-8');
        const parsed = JSON.parse(content);

        // Basic structural validation
        const issues = [];
        if (typeof parsed !== 'object' || parsed === null) {
          issues.push('opencode.json is not a valid JSON object');
        }
        if (parsed && typeof parsed.command !== 'object') {
          issues.push('Missing or invalid "command" section');
        }
        if (parsed && typeof parsed.skills !== 'object') {
          issues.push('Missing or invalid "skills" section');
        }

        if (issues.length > 0) {
          for (const issue of issues) {
            errors.push({ step: 'Validation', message: issue });
          }
          const info = timer.end(`${issues.length} validation issue(s) found`);
          stepResults.push(info);
        } else {
          const info = timer.end('opencode.json validation passed');
          stepResults.push(info);
        }
      } else if (dryRun) {
        const info = timer.end('validation skipped (dry-run, no files written)');
        stepResults.push(info);
      } else {
        errors.push({ step: 'Validation', message: 'opencode.json not found' });
        const info = timer.end('ERROR: opencode.json not found');
        stepResults.push(info);
      }
    } catch (err) {
      errors.push({ step: 'Validation', message: err.message });
      const info = timer.end(`ERROR: ${err.message}`);
      stepResults.push(info);
    }
  }

  // --- CLI-008 + CLI-009: Summary report ---
  const totalElapsed = Date.now() - totalStart;

  console.log('');
  console.log('=== Pipeline Summary ===');
  console.log('');
  for (const step of stepResults) {
    const status = step.details && step.details.startsWith('ERROR') ? 'FAIL' : 'OK';
    console.log(`  [${status}] ${step.name}: ${step.details} (${formatDuration(step.elapsed)})`);
  }
  console.log('');

  if (errors.length > 0) {
    console.log(`Errors (${errors.length}):`);
    for (const err of errors) {
      const loc = err.file ? ` (${err.file})` : '';
      console.log(`  - [${err.step}]${loc}: ${err.message}`);
    }
    console.log('');
  }

  const fileCount = (skillResult.skillsCopied || 0) + (skillResult.referencesConverted || 0) + (cmdResult.commands ? cmdResult.commands.length : 0);
  console.log(`Total: ${fileCount} files processed, ${errors.length} error(s), completed in ${formatDuration(totalElapsed)}`);
  console.log(`Done.`);

  return { errors, stepResults, totalElapsed };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const program = createProgram();
  program.parse(process.argv);
  const opts = program.opts();

  console.log('generate-opencode: Starting pipeline...');
  if (opts.verbose) {
    console.log(`  Output directory: ${opts.outputDir}`);
    console.log(`  Packages directory: ${opts.packagesDir}`);
    console.log(`  Flags: dry-run=${opts.dryRun}, verbose=${opts.verbose}, validate=${opts.validate}, force=${opts.force}`);
  }

  const { errors } = await runPipeline(opts);

  if (errors.length > 0) {
    process.exit(1);
  }
}

// Export for testing
module.exports = { createProgram, runPipeline, loadHashCache, saveHashCache, hashFile, formatDuration, discoverSkillSourceFiles };

if (require.main === module) {
  main().catch((err) => {
    console.error('Generator failed:', err.message || err);
    process.exit(1);
  });
}
