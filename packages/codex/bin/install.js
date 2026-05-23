#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const PACKAGE_ROOT = path.resolve(__dirname, '..');
const SOURCE_AGENTS = path.join(PACKAGE_ROOT, 'AGENTS.md');
const SOURCE_CODEX_DIR = path.join(PACKAGE_ROOT, '.codex');

function usage() {
  console.log('Usage: ensemble-codex-install <target-dir> [--link] [--force]');
}

function rmIfExists(targetPath) {
  fs.rmSync(targetPath, { recursive: true, force: true });
}

function copyRecursive(source, target) {
  const stat = fs.statSync(source);
  if (stat.isDirectory()) {
    fs.mkdirSync(target, { recursive: true });
    for (const entry of fs.readdirSync(source)) {
      copyRecursive(path.join(source, entry), path.join(target, entry));
    }
    return;
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

function symlinkPath(source, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.symlinkSync(source, target);
}

function main(argv) {
  const args = argv.slice(2);
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    usage();
    process.exit(args.length === 0 ? 1 : 0);
  }

  const targetDir = path.resolve(args[0]);
  const link = args.includes('--link');
  const force = args.includes('--force');
  const targetAgents = path.join(targetDir, 'AGENTS.md');
  const targetCodex = path.join(targetDir, '.codex');

  if (!fs.existsSync(SOURCE_AGENTS) || !fs.existsSync(SOURCE_CODEX_DIR)) {
    console.error('ensemble-codex artifacts not found next to installer.');
    process.exit(1);
  }

  if (fs.existsSync(targetAgents) || fs.existsSync(targetCodex)) {
    if (!force) {
      console.error('Target already contains AGENTS.md or .codex. Re-run with --force to replace.');
      process.exit(1);
    }
    rmIfExists(targetAgents);
    rmIfExists(targetCodex);
  }

  fs.mkdirSync(targetDir, { recursive: true });

  if (link) {
    symlinkPath(SOURCE_AGENTS, targetAgents);
    symlinkPath(SOURCE_CODEX_DIR, targetCodex);
    console.log(`Symlinked ensemble-codex into ${targetDir}`);
  } else {
    copyRecursive(SOURCE_AGENTS, targetAgents);
    copyRecursive(SOURCE_CODEX_DIR, targetCodex);
    console.log(`Installed ensemble-codex into ${targetDir}`);
  }
}

if (require.main === module) {
  main(process.argv);
}
