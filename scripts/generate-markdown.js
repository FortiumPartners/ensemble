#!/usr/bin/env node

/**
 * YAML-to-Markdown Generator CLI
 * Generates Claude Code compatible Markdown files from structured YAML definitions
 */

'use strict';

const { Command } = require('commander');
const path = require('path');
const chokidar = require('chokidar');

const { discoverYamlFiles, getOutputPath } = require('./lib/file-discovery');
const { parseYamlFile } = require('./lib/yaml-parser');
const { validateCommandSchema, validateAgentSchema, buildAgentNameSet } = require('./lib/schema-validator');
const { generateMarkdown } = require('./lib/markdown-generator');
const { writeFileAtomic } = require('./lib/file-utils');
const { cleanupOrphans } = require('./lib/orphan-cleanup');
const { ErrorCollector, ValidationError, GenerationError } = require('./lib/error-handler');

const VERSION = '1.0.0';
const PACKAGES_DIR = path.join(__dirname, '../packages');

// Debounce timers for watch mode
const debounceTimers = new Map();
const DEBOUNCE_MS = 500;

const program = new Command();

program
  .name('generate-markdown')
  .description('Generate Claude Code compatible Markdown from YAML definitions')
  .version(VERSION)
  .option('-t, --type <type>', 'Process only commands or agents', 'all')
  .option('-f, --file <path>', 'Process a single YAML file')
  .option('--validate', 'Validate YAML files without generating')
  .option('--dry-run', 'Show what would be generated without writing files')
  .option('--no-cleanup', 'Skip orphan cleanup')
  .option('--fail-fast', 'Exit immediately on first error')
  .option('-v, --verbose', 'Show detailed output')
  .option('-w, --watch', 'Watch for changes and regenerate')
  .action(main);

async function main(options) {
  const errorCollector = new ErrorCollector({ failFast: options.failFast });

  try {
    if (options.watch) {
      await runWatchMode(options);
    } else {
      const exitCode = await runGeneration(options, errorCollector);
      process.exit(exitCode);
    }
  } catch (error) {
    if (options.failFast && (error instanceof ValidationError || error instanceof GenerationError)) {
      console.error(`\n\x1b[31m✖ ${error.message}\x1b[0m\n`);
      process.exit(1);
    }
    console.error(`\n\x1b[31mFatal error: ${error.message}\x1b[0m\n`);
    if (options.verbose) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

/**
 * Run the main generation process
 */
async function runGeneration(options, errorCollector) {
  const startTime = Date.now();
  const generatedFiles = new Set();
  let processedCount = 0;
  let skippedCount = 0;

  console.log('\n\x1b[36mYAML-to-Markdown Generator\x1b[0m');
  console.log('─'.repeat(40));

  // Determine types to process
  const types = options.type === 'all'
    ? ['commands', 'agents']
    : [options.type];

  // Single file mode
  if (options.file) {
    const result = await processSingleFile(options.file, errorCollector, options);
    if (result.success) {
      generatedFiles.add(result.outputPath);
      processedCount++;
    }
  } else {
    // Discover YAML files
    console.log('\nDiscovering YAML files...');
    const discovered = await discoverYamlFiles(PACKAGES_DIR, { types });

    const commandCount = discovered.commands.length;
    const agentCount = discovered.agents.length;
    console.log(`  Found ${commandCount} command(s) and ${agentCount} agent(s)`);

    if (commandCount + agentCount === 0) {
      console.log('\n\x1b[33mNo YAML files found to process.\x1b[0m\n');
      return 0;
    }

    // Build agent name set for delegation validation
    const agentNames = await buildAgentNameSet(discovered.agents);
    if (options.verbose) {
      console.log(`  Built agent name set with ${agentNames.size} agents`);
    }

    // Process commands
    if (types.includes('commands') && discovered.commands.length > 0) {
      console.log('\nProcessing commands...');
      for (const yamlPath of discovered.commands) {
        const result = await processYamlFile(yamlPath, 'command', agentNames, errorCollector, options);
        if (result.success) {
          generatedFiles.add(result.outputPath);
          processedCount++;
        } else if (result.skipped) {
          skippedCount++;
        }
      }
    }

    // Process agents
    if (types.includes('agents') && discovered.agents.length > 0) {
      console.log('\nProcessing agents...');
      for (const yamlPath of discovered.agents) {
        const result = await processYamlFile(yamlPath, 'agent', agentNames, errorCollector, options);
        if (result.success) {
          generatedFiles.add(result.outputPath);
          processedCount++;
        } else if (result.skipped) {
          skippedCount++;
        }
      }
    }
  }

  // Orphan cleanup
  if (options.cleanup !== false && !options.validate && !options.file) {
    console.log('\nChecking for orphaned files...');
    const cleanupResult = await cleanupOrphans(PACKAGES_DIR, generatedFiles, {
      dryRun: options.dryRun,
      verbose: options.verbose
    });

    if (cleanupResult.deleted.length > 0) {
      const action = options.dryRun ? 'Would delete' : 'Deleted';
      console.log(`  ${action} ${cleanupResult.deleted.length} orphan(s)`);
    }
    if (cleanupResult.skipped.length > 0 && options.verbose) {
      console.log(`  Skipped ${cleanupResult.skipped.length} file(s) without DO NOT EDIT header`);
    }
    cleanupResult.errors.forEach(err => errorCollector.addError(err));
  }

  // Report results
  const duration = Date.now() - startTime;
  console.log('\n' + '─'.repeat(40));

  if (errorCollector.hasErrors()) {
    errorCollector.report();
    console.log(`\x1b[31m✖ Generation completed with errors\x1b[0m`);
  } else if (options.validate) {
    console.log(`\x1b[32m✓ Validation passed (${processedCount} files)\x1b[0m`);
  } else if (options.dryRun) {
    console.log(`\x1b[32m✓ Dry run completed (${processedCount} files would be generated)\x1b[0m`);
  } else {
    console.log(`\x1b[32m✓ Generated ${processedCount} file(s) in ${duration}ms\x1b[0m`);
  }

  if (skippedCount > 0) {
    console.log(`  Skipped ${skippedCount} file(s) due to errors`);
  }

  console.log('');
  return errorCollector.getExitCode();
}

/**
 * Process a single YAML file
 */
async function processSingleFile(filePath, errorCollector, options) {
  const absolutePath = path.resolve(filePath);

  try {
    // Parse YAML
    const { type, data } = await parseYamlFile(absolutePath);

    // Build agent names if processing a command
    let agentNames = new Set();
    if (type === 'command') {
      const discovered = await discoverYamlFiles(PACKAGES_DIR, { types: ['agents'] });
      agentNames = await buildAgentNameSet(discovered.agents);
    }

    return processYamlFile(absolutePath, type, agentNames, errorCollector, options);
  } catch (error) {
    errorCollector.addError(error);
    return { success: false, skipped: false };
  }
}

/**
 * Process a single YAML file through the pipeline
 */
async function processYamlFile(yamlPath, type, agentNames, errorCollector, options) {
  const relativePath = path.relative(PACKAGES_DIR, yamlPath);

  if (options.verbose) {
    console.log(`  Processing: ${relativePath}`);
  }

  try {
    // 1. Parse YAML
    const { data } = await parseYamlFile(yamlPath);

    // 2. Validate schema
    if (type === 'command') {
      validateCommandSchema(data, yamlPath, agentNames);
    } else {
      validateAgentSchema(data, yamlPath);
    }

    // Validation-only mode stops here
    if (options.validate) {
      if (options.verbose) {
        console.log(`    ✓ Valid`);
      }
      return { success: true, outputPath: getOutputPath(yamlPath, data.metadata) };
    }

    // 3. Generate Markdown
    const markdown = generateMarkdown(data, type, yamlPath);

    // 4. Write file
    const outputPath = getOutputPath(yamlPath, data.metadata);

    if (options.dryRun) {
      if (options.verbose) {
        console.log(`    Would write: ${path.relative(PACKAGES_DIR, outputPath)}`);
      }
    } else {
      await writeFileAtomic(outputPath, markdown);
      if (options.verbose) {
        console.log(`    ✓ Generated: ${path.relative(PACKAGES_DIR, outputPath)}`);
      }
    }

    return { success: true, outputPath };
  } catch (error) {
    if (Array.isArray(error)) {
      // Multiple validation errors
      error.forEach(err => errorCollector.addError(err));
    } else {
      errorCollector.addError(error);
    }
    return { success: false, skipped: true };
  }
}

/**
 * Watch mode - monitor YAML files and regenerate on changes
 */
async function runWatchMode(options) {
  console.log('\n\x1b[36mWatching for YAML changes...\x1b[0m');
  console.log('Press Ctrl+C to stop\n');

  // Discover initial files to build agent names
  const discovered = await discoverYamlFiles(PACKAGES_DIR);
  let agentNames = await buildAgentNameSet(discovered.agents);

  // Watch patterns
  const watchPatterns = [
    path.join(PACKAGES_DIR, '*/commands/*.yaml'),
    path.join(PACKAGES_DIR, '*/agents/*.yaml')
  ];

  const watcher = chokidar.watch(watchPatterns, {
    persistent: true,
    ignoreInitial: true
  });

  watcher.on('change', (filePath) => {
    // Debounce
    clearTimeout(debounceTimers.get(filePath));
    debounceTimers.set(filePath, setTimeout(async () => {
      debounceTimers.delete(filePath);

      console.log(`\n\x1b[33mChanged:\x1b[0m ${path.relative(PACKAGES_DIR, filePath)}`);

      const errorCollector = new ErrorCollector({ failFast: options.failFast });

      // Rebuild agent names if an agent file changed
      if (filePath.includes('/agents/')) {
        agentNames = await buildAgentNameSet(discovered.agents);
      }

      // Determine type
      const type = filePath.includes('/agents/') ? 'agent' : 'command';

      const result = await processYamlFile(filePath, type, agentNames, errorCollector, {
        ...options,
        verbose: true
      });

      if (errorCollector.hasErrors()) {
        errorCollector.report();
      } else if (result.success) {
        console.log(`\x1b[32m✓ Regenerated successfully\x1b[0m`);
      }
    }, DEBOUNCE_MS));
  });

  watcher.on('add', (filePath) => {
    console.log(`\n\x1b[32mAdded:\x1b[0m ${path.relative(PACKAGES_DIR, filePath)}`);
    // Trigger change handler
    watcher.emit('change', filePath);
  });

  watcher.on('unlink', (filePath) => {
    console.log(`\n\x1b[31mDeleted:\x1b[0m ${path.relative(PACKAGES_DIR, filePath)}`);
    console.log('  Run without --watch to clean up orphaned Markdown files');
  });

  // Keep process alive
  await new Promise(() => {});
}

program.parse();
