#!/usr/bin/env node

/**
 * Sync hooks and dependencies from progress pane packages into ensemble-full
 *
 * This script maintains a single source of truth by copying files from:
 * - packages/agent-progress-pane/hooks/* -> packages/full/hooks/*
 * - packages/task-progress-pane/hooks/* -> packages/full/hooks/*
 * - packages/task-progress-pane/lib/* -> packages/full/lib/*
 * - packages/agent-progress-pane/lib/multiplexer/* -> packages/full/lib/multiplexer/*
 *
 * Run this script:
 * - Before committing changes to progress pane packages
 * - Before publishing ensemble-full
 * - Automatically via npm prepare hook
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');

// File mappings: source -> destination
const FILE_MAPPINGS = [
  // Agent progress pane hooks
  {
    source: 'agent-progress-pane/hooks/pane-spawner.js',
    dest: 'full/hooks/pane-spawner.js'
  },
  {
    source: 'agent-progress-pane/hooks/pane-completion.js',
    dest: 'full/hooks/pane-completion.js'
  },
  {
    source: 'agent-progress-pane/hooks/pane-manager.js',
    dest: 'full/hooks/pane-manager.js'
  },

  // Task progress pane hooks and monitor scripts
  {
    source: 'task-progress-pane/hooks/task-spawner.js',
    dest: 'full/hooks/task-spawner.js'
  },
  {
    source: 'task-progress-pane/hooks/task-progress-monitor-v2.sh',
    dest: 'full/hooks/task-progress-monitor-v2.sh'
  },
  {
    source: 'task-progress-pane/hooks/task-progress-monitor.sh',
    dest: 'full/hooks/task-progress-monitor.sh'
  },

  // Task progress pane lib files
  {
    source: 'task-progress-pane/lib/config-loader.js',
    dest: 'full/lib/config-loader.js'
  },
  {
    source: 'task-progress-pane/lib/task-parser.js',
    dest: 'full/lib/task-parser.js'
  },
  {
    source: 'task-progress-pane/lib/task-pane-manager.js',
    dest: 'full/lib/task-pane-manager.js'
  },
  {
    source: 'task-progress-pane/lib/time-tracker.js',
    dest: 'full/lib/time-tracker.js'
  },
  {
    source: 'task-progress-pane/lib/session-manager.js',
    dest: 'full/lib/session-manager.js'
  },

  // Multiplexer adapters (from multiplexer-adapters package)
  {
    source: 'multiplexer-adapters/lib/index.js',
    dest: 'full/lib/multiplexer/index.js'
  },
  {
    source: 'multiplexer-adapters/lib/base-adapter.js',
    dest: 'full/lib/multiplexer/base-adapter.js'
  },
  {
    source: 'multiplexer-adapters/lib/multiplexer-detector.js',
    dest: 'full/lib/multiplexer/multiplexer-detector.js'
  },
  {
    source: 'multiplexer-adapters/lib/wezterm-adapter.js',
    dest: 'full/lib/multiplexer/wezterm-adapter.js'
  },
  {
    source: 'multiplexer-adapters/lib/zellij-adapter.js',
    dest: 'full/lib/multiplexer/zellij-adapter.js'
  },
  {
    source: 'multiplexer-adapters/lib/tmux-adapter.js',
    dest: 'full/lib/multiplexer/tmux-adapter.js'
  },

  // Agent progress pane monitor script
  {
    source: 'agent-progress-pane/hooks/agent-monitor.sh',
    dest: 'full/hooks/agent-monitor.sh'
  },

  // Agent progress pane adapters (separate from task-progress-pane)
  {
    source: 'agent-progress-pane/hooks/adapters/index.js',
    dest: 'full/hooks/adapters/index.js'
  },
  {
    source: 'agent-progress-pane/hooks/adapters/base-adapter.js',
    dest: 'full/hooks/adapters/base-adapter.js'
  },
  {
    source: 'agent-progress-pane/hooks/adapters/multiplexer-detector.js',
    dest: 'full/hooks/adapters/multiplexer-detector.js'
  },
  {
    source: 'agent-progress-pane/hooks/adapters/wezterm-adapter.js',
    dest: 'full/hooks/adapters/wezterm-adapter.js'
  },
  {
    source: 'agent-progress-pane/hooks/adapters/zellij-adapter.js',
    dest: 'full/hooks/adapters/zellij-adapter.js'
  },
  {
    source: 'agent-progress-pane/hooks/adapters/tmux-adapter.js',
    dest: 'full/hooks/adapters/tmux-adapter.js'
  }
];

function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function copyFile(source, dest) {
  const sourcePath = path.join(ROOT, source);
  const destPath = path.join(ROOT, dest);

  if (!fs.existsSync(sourcePath)) {
    console.error(`❌ Source file not found: ${source}`);
    return false;
  }

  ensureDir(destPath);

  try {
    fs.copyFileSync(sourcePath, destPath);
    console.log(`✓ Copied: ${source} → ${dest}`);
    return true;
  } catch (error) {
    console.error(`❌ Failed to copy ${source}: ${error.message}`);
    return false;
  }
}

function main() {
  console.log('========================================');
  console.log('Syncing hooks and dependencies to ensemble-full');
  console.log('========================================\n');

  let success = 0;
  let failed = 0;

  for (const mapping of FILE_MAPPINGS) {
    if (copyFile(mapping.source, mapping.dest)) {
      success++;
    } else {
      failed++;
    }
  }

  console.log('\n========================================');
  console.log('Sync Results');
  console.log('========================================');
  console.log(`✓ Success: ${success} files`);
  if (failed > 0) {
    console.log(`❌ Failed:  ${failed} files`);
    process.exit(1);
  } else {
    console.log('\n✓ All files synced successfully!');
  }
}

main();
