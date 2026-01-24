#!/usr/bin/env node
/**
 * Automated rename script for ensemble → ensemble migration
 * Uses Node.js 22+ built-in glob (no external dependencies)
 *
 * Usage: node scripts/rename-to-ensemble.js [--dry-run]
 */

const fs = require('fs');
const path = require('path');

const DRY_RUN = process.argv.includes('--dry-run');
const NEW_VERSION = '5.0.0';

const REPLACEMENTS = [
  // Package names (order matters - most specific first)
  { from: '@fortium/ensemble-', to: '@fortium/ensemble-' },
  { from: '@fortium/ensemble-', to: '@fortium/ensemble-' },

  // Plugin names in JSON/strings
  { from: '"ensemble-', to: '"ensemble-' },
  { from: "'ensemble-", to: "'ensemble-" },

  // Repository URLs
  { from: 'FortiumPartners/ensemble', to: 'FortiumPartners/ensemble' },

  // Config paths (old → new consolidated structure)
  { from: '.ensemble/plugins/task-progress-pane', to: '.ensemble/plugins/task-progress-pane' },
  { from: '.ensemble/plugins/pane-viewer', to: '.ensemble/plugins/pane-viewer' },

  // Command prefixes
  { from: '/ensemble:', to: '/ensemble:' },
  { from: '@ensemble-command', to: '@ensemble-command' },

  // Keywords in package.json
  { from: '"ensemble"', to: '"ensemble"' },

  // Schema patterns
  { from: '^ensemble-[a-z0-9-]+$', to: '^ensemble-[a-z0-9-]+$' },

  // Generic references
  { from: 'ensemble-plugins', to: 'ensemble' },
  { from: 'ensemble', to: 'ensemble' },
];

const FILE_PATTERNS = [
  '**/*.json',
  '**/*.js',
  '**/*.md',
  '**/*.yml',
  '**/*.yaml',
  '**/*.sh',
];

const IGNORE_DIRS = ['node_modules', '.git', 'coverage', 'dist', 'build'];

// Manual recursive file finder (fallback for environments without fs.glob)
function findFilesManual(baseDir, patterns) {
  const files = [];
  const extensions = patterns.map(p => p.replace('**/*', ''));

  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      return; // Skip directories we can't read
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (!IGNORE_DIRS.includes(entry.name)) {
          walk(fullPath);
        }
      } else if (entry.isFile()) {
        for (const ext of extensions) {
          if (entry.name.endsWith(ext)) {
            files.push(fullPath);
            break;
          }
        }
      }
    }
  }

  walk(baseDir);
  return files;
}

function replaceInFile(filePath) {
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    console.log(`[SKIP] Could not read: ${filePath}`);
    return false;
  }

  let modified = false;
  let originalContent = content;

  for (const { from, to } of REPLACEMENTS) {
    if (content.includes(from)) {
      content = content.split(from).join(to);
      modified = true;
    }
  }

  // Update version in package.json files
  if (filePath.endsWith('package.json') && modified) {
    try {
      const pkg = JSON.parse(content);
      if (pkg.version && pkg.version !== NEW_VERSION) {
        content = content.replace(
          `"version": "${pkg.version}"`,
          `"version": "${NEW_VERSION}"`
        );
      }
    } catch (err) {
      // Not valid JSON, skip version update
    }
  }

  if (modified) {
    if (DRY_RUN) {
      console.log(`[DRY-RUN] Would update: ${filePath}`);
      // Show what would change
      const changes = [];
      for (const { from, to } of REPLACEMENTS) {
        if (originalContent.includes(from)) {
          changes.push(`  ${from} → ${to}`);
        }
      }
      if (changes.length > 0) {
        console.log(changes.join('\n'));
      }
    } else {
      fs.writeFileSync(filePath, content);
      console.log(`[UPDATED] ${filePath}`);
    }
  }

  return modified;
}

function renamePackageDirectories() {
  const packagesDir = path.join(process.cwd(), 'packages');
  if (!fs.existsSync(packagesDir)) {
    console.log('[WARN] packages/ directory not found');
    return [];
  }

  const renames = [];
  const entries = fs.readdirSync(packagesDir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory() && entry.name.startsWith('ensemble-')) {
      const oldPath = path.join(packagesDir, entry.name);
      const newName = entry.name.replace('ensemble-', 'ensemble-');
      const newPath = path.join(packagesDir, newName);

      if (DRY_RUN) {
        console.log(`[DRY-RUN] Would rename directory: ${entry.name} → ${newName}`);
      } else {
        fs.renameSync(oldPath, newPath);
        console.log(`[RENAMED] ${entry.name} → ${newName}`);
      }
      renames.push({ from: entry.name, to: newName });
    }
  }

  return renames;
}

async function main() {
  console.log('Ensemble Rename Script');
  console.log('======================');
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
  console.log(`Target version: ${NEW_VERSION}\n`);

  // Step 1: Rename package directories
  console.log('Step 1: Renaming package directories...\n');
  const renames = renamePackageDirectories();
  console.log(`\n${renames.length} directories ${DRY_RUN ? 'would be' : ''} renamed\n`);

  // Step 2: Update file contents
  console.log('Step 2: Updating file contents...\n');

  const files = findFilesManual(process.cwd(), FILE_PATTERNS);
  let totalFiles = 0;
  let modifiedFiles = 0;

  for (const file of files) {
    totalFiles++;
    if (replaceInFile(file)) {
      modifiedFiles++;
    }
  }

  console.log(`\n${'='.repeat(40)}`);
  console.log(`Summary: ${modifiedFiles}/${totalFiles} files modified`);

  if (DRY_RUN) {
    console.log('\nThis was a dry run. No files were changed.');
    console.log('Run without --dry-run to apply changes.');
  } else {
    console.log('\nRename complete!');
    console.log('\nNext steps:');
    console.log('1. Review changes with: git diff');
    console.log('2. Run tests to verify nothing broke');
    console.log('3. Commit the changes');
  }
}

main().catch(console.error);
