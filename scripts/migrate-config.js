#!/usr/bin/env node
/**
 * Ensemble Config Migration Script
 *
 * Migrates existing ai-mesh configuration directories to the new
 * XDG-compliant ensemble structure, and handles plugin renames.
 *
 * Migrations:
 *   ~/.ai-mesh-task-progress/ → plugins/task-progress-pane/
 *   ~/.ai-mesh-pane-viewer/   → plugins/agent-progress-pane/
 *   plugins/pane-viewer/      → plugins/agent-progress-pane/ (rename)
 *
 * New location:
 *   $XDG_CONFIG_HOME/ensemble/  (or ~/.config/ensemble/ or ~/.ensemble/)
 *     └── plugins/
 *         ├── task-progress-pane/
 *         └── agent-progress-pane/
 *
 * Usage: node scripts/migrate-config.js [--dry-run] [--force]
 *
 * Options:
 *   --dry-run  Show what would be migrated without making changes
 *   --force    Overwrite existing files in destination
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const DRY_RUN = process.argv.includes('--dry-run');
const FORCE = process.argv.includes('--force');

// Legacy directory mappings
const LEGACY_MAPPINGS = [
  {
    oldPath: '.ai-mesh-task-progress',
    newPlugin: 'task-progress-pane',
    description: 'Task Progress Pane configuration'
  },
  {
    oldPath: '.ai-mesh-pane-viewer',
    newPlugin: 'agent-progress-pane',
    description: 'Agent Progress Pane configuration (from ai-mesh)'
  },
  {
    oldPath: '.ensemble/plugins/pane-viewer',
    newPlugin: 'agent-progress-pane',
    description: 'Agent Progress Pane configuration (rename from pane-viewer)',
    isInternalMigration: true  // Flag to handle differently
  }
];

/**
 * Get the new ensemble config root (XDG-compliant)
 */
function getEnsembleConfigRoot() {
  if (process.env.XDG_CONFIG_HOME) {
    return path.join(process.env.XDG_CONFIG_HOME, 'ensemble');
  }

  const homeDir = os.homedir();
  const configDir = path.join(homeDir, '.config');

  if (fs.existsSync(configDir)) {
    return path.join(configDir, 'ensemble');
  }

  return path.join(homeDir, '.ensemble');
}

/**
 * Recursively copy a directory
 */
function copyDir(src, dest) {
  if (DRY_RUN) {
    console.log(`  [DRY-RUN] Would copy ${src} → ${dest}`);
    return;
  }

  fs.mkdirSync(dest, { recursive: true, mode: 0o700 });

  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
      console.log(`  Copied: ${entry.name}`);
    }
  }
}

/**
 * List files in a directory recursively
 */
function listFiles(dir, prefix = '') {
  const files = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const displayPath = prefix ? `${prefix}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      files.push(...listFiles(fullPath, displayPath));
    } else {
      files.push(displayPath);
    }
  }

  return files;
}

/**
 * Migrate a single legacy directory
 */
function migrateLegacyDir(mapping) {
  const homeDir = os.homedir();
  const oldFullPath = path.join(homeDir, mapping.oldPath);
  const configRoot = getEnsembleConfigRoot();
  const newFullPath = path.join(configRoot, 'plugins', mapping.newPlugin);

  console.log(`\n${mapping.description}:`);
  console.log(`  From: ${oldFullPath}`);
  console.log(`  To:   ${newFullPath}`);

  // Check if old directory exists
  if (!fs.existsSync(oldFullPath)) {
    console.log('  Status: No legacy config found (skipping)');
    return { status: 'skipped', reason: 'not_found' };
  }

  // Check if new directory already exists
  if (fs.existsSync(newFullPath) && !FORCE) {
    console.log('  Status: Destination already exists (use --force to overwrite)');
    return { status: 'skipped', reason: 'exists' };
  }

  // List files to migrate
  const files = listFiles(oldFullPath);
  console.log(`  Files: ${files.length} file(s) to migrate`);

  if (files.length > 0 && files.length <= 10) {
    files.forEach(f => console.log(`    - ${f}`));
  } else if (files.length > 10) {
    files.slice(0, 5).forEach(f => console.log(`    - ${f}`));
    console.log(`    ... and ${files.length - 5} more`);
  }

  // Perform migration
  if (DRY_RUN) {
    console.log('  Status: Would migrate (dry-run)');
    return { status: 'dry-run', files: files.length };
  }

  try {
    // Create parent directories
    fs.mkdirSync(path.dirname(newFullPath), { recursive: true, mode: 0o700 });

    // Copy files
    copyDir(oldFullPath, newFullPath);

    console.log('  Status: ✓ Migrated successfully');
    return { status: 'migrated', files: files.length };
  } catch (err) {
    console.log(`  Status: ✗ Error: ${err.message}`);
    return { status: 'error', error: err.message };
  }
}

/**
 * Main migration function
 */
function main() {
  console.log('Ensemble Config Migration');
  console.log('=========================');
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}${FORCE ? ' (force)' : ''}`);
  console.log(`Target: ${getEnsembleConfigRoot()}`);

  const results = {
    migrated: 0,
    skipped: 0,
    errors: 0
  };

  for (const mapping of LEGACY_MAPPINGS) {
    const result = migrateLegacyDir(mapping);

    switch (result.status) {
      case 'migrated':
        results.migrated++;
        break;
      case 'skipped':
      case 'dry-run':
        results.skipped++;
        break;
      case 'error':
        results.errors++;
        break;
    }
  }

  console.log('\n=========================');
  console.log('Summary:');
  console.log(`  Migrated: ${results.migrated}`);
  console.log(`  Skipped:  ${results.skipped}`);
  console.log(`  Errors:   ${results.errors}`);

  if (DRY_RUN) {
    console.log('\nThis was a dry run. No files were changed.');
    console.log('Run without --dry-run to perform migration.');
  } else if (results.migrated > 0) {
    console.log('\nMigration complete!');
    console.log('\nNote: Original directories were NOT deleted.');
    console.log('After verifying the migration, you can remove them with:');
    for (const mapping of LEGACY_MAPPINGS) {
      const oldFullPath = path.join(os.homedir(), mapping.oldPath);
      if (fs.existsSync(oldFullPath)) {
        console.log(`  rm -rf "${oldFullPath}"`);
      }
    }
  }

  process.exit(results.errors > 0 ? 1 : 0);
}

main();
