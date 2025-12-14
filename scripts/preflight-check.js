#!/usr/bin/env node
/**
 * Ensemble Rename Pre-flight Checklist
 *
 * Validates all prerequisites before starting the rename process:
 * - Node.js version >= 22 (for built-in glob)
 * - Clean git working directory
 * - Correct branch (feature/ensemble-rename or main)
 * - NPM login status
 * - Package name availability
 * - Backup existence
 *
 * Usage: node scripts/preflight-check.js
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');

// All packages that will be renamed to @fortium/ensemble-*
const PACKAGES = [
  'ensemble-core',
  'ensemble-product',
  'ensemble-development',
  'ensemble-quality',
  'ensemble-infrastructure',
  'ensemble-git',
  'ensemble-e2e-testing',
  'ensemble-metrics',
  'ensemble-react',
  'ensemble-nestjs',
  'ensemble-rails',
  'ensemble-phoenix',
  'ensemble-blazor',
  'ensemble-jest',
  'ensemble-pytest',
  'ensemble-rspec',
  'ensemble-xunit',
  'ensemble-exunit',
  'ensemble-pane-viewer',
  'ensemble-task-progress-pane',
  'ensemble-multiplexer-adapters',
  'ensemble-full',
];

let passed = 0;
let failed = 0;

function log(status, message) {
  const icon = status === 'pass' ? '\x1b[32m✓\x1b[0m' : status === 'fail' ? '\x1b[31m✗\x1b[0m' : '\x1b[33m⋯\x1b[0m';
  console.log(`${icon} ${message}`);
  if (status === 'pass') passed++;
  if (status === 'fail') failed++;
}

function checkNodeVersion() {
  const version = process.version;
  const major = parseInt(version.slice(1).split('.')[0], 10);
  if (major >= 22) {
    log('pass', `Node.js version ${version} (>=22 required for built-in glob)`);
    return true;
  } else {
    log('fail', `Node.js version ${version} is too old (>=22 required)`);
    return false;
  }
}

function checkDirectoryName() {
  const currentDir = path.basename(process.cwd());
  if (currentDir === 'ai-mesh-plugins') {
    log('pass', `Current directory is 'ai-mesh-plugins' - ready for rename`);
    return true;
  } else if (currentDir === 'ensemble') {
    log('pass', `Directory already renamed to 'ensemble'`);
    return true;
  } else {
    log('fail', `Unexpected directory name: ${currentDir}`);
    return false;
  }
}

function checkGitStatus() {
  try {
    const status = execSync('git status --porcelain', { encoding: 'utf8' });
    if (status.trim() === '') {
      log('pass', 'Git working directory is clean');
      return true;
    } else {
      log('fail', 'Git working directory has uncommitted changes');
      console.log('       Uncommitted files:');
      status.split('\n').filter(Boolean).forEach(line => {
        console.log(`         ${line}`);
      });
      return false;
    }
  } catch (err) {
    log('fail', 'Not a git repository or git not available');
    return false;
  }
}

function checkCurrentBranch() {
  try {
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();
    if (branch === 'main' || branch === 'master' || branch === 'feature/ensemble-rename') {
      log('pass', `On branch '${branch}'`);
      return true;
    } else {
      log('fail', `On branch '${branch}' - expected main, master, or feature/ensemble-rename`);
      return false;
    }
  } catch (err) {
    log('fail', 'Could not determine current git branch');
    return false;
  }
}

function checkNpmLogin() {
  try {
    const whoami = execSync('npm whoami', { encoding: 'utf8' }).trim();
    log('pass', `Logged into NPM as '${whoami}'`);
    return true;
  } catch (err) {
    log('fail', 'Not logged into NPM - run `npm login` first');
    return false;
  }
}

async function checkPackageAvailability(packageName) {
  return new Promise((resolve) => {
    const url = `https://registry.npmjs.org/@fortium/${packageName}`;
    https.get(url, (res) => {
      if (res.statusCode === 404) {
        resolve({ name: packageName, available: true });
      } else {
        resolve({ name: packageName, available: false });
      }
    }).on('error', () => {
      resolve({ name: packageName, available: 'error' });
    });
  });
}

async function checkAllPackagesAvailable() {
  console.log('\nChecking NPM package availability...');

  const results = await Promise.all(PACKAGES.map(checkPackageAvailability));
  const unavailable = results.filter(r => r.available === false);
  const errors = results.filter(r => r.available === 'error');

  if (unavailable.length === 0 && errors.length === 0) {
    log('pass', `All ${PACKAGES.length} @fortium/ensemble-* package names are available`);
    return true;
  } else {
    if (unavailable.length > 0) {
      log('fail', `${unavailable.length} package names are already taken:`);
      unavailable.forEach(r => console.log(`         @fortium/${r.name}`));
    }
    if (errors.length > 0) {
      log('fail', `${errors.length} packages could not be checked (network error)`);
    }
    return false;
  }
}

function checkBackupExists() {
  const backupDir = path.join(process.cwd(), '..');
  try {
    const files = fs.readdirSync(backupDir);
    const backups = files.filter(f => f.startsWith('backup-ensemble-') && f.endsWith('.tar.gz'));

    if (backups.length > 0) {
      log('pass', `Backup found: ${backups[backups.length - 1]}`);
      return true;
    } else {
      log('fail', 'No backup archive found - create one before proceeding');
      console.log('       Run: tar -czf ../backup-ensemble-$(date +%Y%m%d).tar.gz .');
      return false;
    }
  } catch (err) {
    log('fail', 'Could not check for backup files');
    return false;
  }
}

async function runAllChecks() {
  console.log('Ensemble Rename Pre-flight Checklist');
  console.log('====================================\n');

  console.log('Environment Checks:');
  checkNodeVersion();
  checkDirectoryName();

  console.log('\nGit Checks:');
  checkGitStatus();
  checkCurrentBranch();

  console.log('\nNPM Checks:');
  checkNpmLogin();
  await checkAllPackagesAvailable();

  console.log('\nBackup Checks:');
  checkBackupExists();

  console.log('\n====================================');
  console.log(`Results: ${passed} passed, ${failed} failed`);

  if (failed === 0) {
    console.log('\n\x1b[32mAll pre-flight checks passed! Ready to proceed.\x1b[0m');
    process.exit(0);
  } else {
    console.log('\n\x1b[31mSome checks failed. Please resolve before proceeding.\x1b[0m');
    process.exit(1);
  }
}

runAllChecks();
