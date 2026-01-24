#!/usr/bin/env node

/**
 * Install pre-commit hook for version management
 * This script creates a git pre-commit hook that runs version-bump preview
 */

const fs = require('fs');
const path = require('path');

// Find git root directory
function findGitRoot() {
  let currentDir = __dirname;
  while (currentDir !== '/') {
    if (fs.existsSync(path.join(currentDir, '.git'))) {
      return currentDir;
    }
    currentDir = path.dirname(currentDir);
  }
  throw new Error('Could not find .git directory');
}

// Hook content
const hookContent = `#!/bin/sh

# Version Bump Pre-Commit Hook
# Runs version-bump preview to show what version changes will be made

echo "🔍 Checking version bump..."

# Run version-bump CLI
cd "$(git rev-parse --show-toplevel)/tools/version-manager" || exit 1

if [ ! -d "dist" ]; then
  echo "⚠️  Version manager not built. Run 'npm run build' in tools/version-manager"
  exit 0
fi

node dist/cli.js

# Store exit code
EXIT_CODE=$?

# Always allow commit to proceed (preview only in Sprint 1.4)
# Future sprints will add actual version bumping here
exit 0
`;

try {
  const gitRoot = findGitRoot();
  const hooksDir = path.join(gitRoot, '.git', 'hooks');
  const hookPath = path.join(hooksDir, 'pre-commit');

  // Ensure hooks directory exists
  if (!fs.existsSync(hooksDir)) {
    fs.mkdirSync(hooksDir, { recursive: true });
  }

  // Check if hook already exists
  if (fs.existsSync(hookPath)) {
    console.log('⚠️  Pre-commit hook already exists at:', hookPath);
    console.log('Please review and merge manually if needed.');
    process.exit(0);
  }

  // Write hook file
  fs.writeFileSync(hookPath, hookContent, { mode: 0o755 });

  console.log('✅ Pre-commit hook installed successfully at:', hookPath);
  console.log('');
  console.log('The hook will now show version bump previews before each commit.');
  console.log('To disable, remove:', hookPath);
} catch (error) {
  console.error('❌ Failed to install pre-commit hook:', error.message);
  process.exit(1);
}
