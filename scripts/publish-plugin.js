#!/usr/bin/env node
/**
 * Publish changed plugins to NPM
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PACKAGES_DIR = path.join(__dirname, '..', 'packages');

function getChangedPackages() {
  try {
    const output = execSync('git diff --name-only HEAD~1 HEAD', {
      cwd: path.join(__dirname, '..'),
      encoding: 'utf8'
    });

    const changedFiles = output.split('\n').filter(Boolean);
    const changedPackages = new Set();

    changedFiles.forEach(file => {
      if (file.startsWith('packages/')) {
        const parts = file.split('/');
        if (parts.length >= 2) {
          changedPackages.add(parts[1]);
        }
      }
    });

    return Array.from(changedPackages);
  } catch (error) {
    console.error('Error detecting changed packages:', error.message);
    return [];
  }
}

function publishPackage(packageName) {
  const packageDir = path.join(PACKAGES_DIR, packageName);
  const packageJsonPath = path.join(packageDir, 'package.json');

  if (!fs.existsSync(packageJsonPath)) {
    console.log(`Skipping ${packageName}: no package.json found`);
    return;
  }

  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

  console.log(`\nPublishing ${packageJson.name}@${packageJson.version}...`);

  try {
    execSync('npm publish --access public', {
      cwd: packageDir,
      stdio: 'inherit'
    });
    console.log(`✓ Published ${packageJson.name}@${packageJson.version}`);
  } catch (error) {
    console.error(`✗ Failed to publish ${packageJson.name}: ${error.message}`);
    process.exit(1);
  }
}

function main() {
  console.log('Ensemble Plugin Publisher');
  console.log('========================\n');

  const changedPackages = getChangedPackages();

  if (changedPackages.length === 0) {
    console.log('No packages changed, skipping publish');
    return;
  }

  console.log(`Changed packages: ${changedPackages.join(', ')}\n`);

  changedPackages.forEach(publishPackage);

  console.log('\n✓ Publishing complete');
}

main();
