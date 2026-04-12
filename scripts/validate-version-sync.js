#!/usr/bin/env node
/**
 * Validates that release-critical version fields are in sync.
 *
 * Checks: root package.json, packages/full/package.json,
 * packages/full/.claude-plugin/plugin.json, and
 * marketplace.json (top-level + ensemble-full entry) all share
 * the same version string.
 *
 * Exit 0 = in sync, Exit 1 = mismatch (prints details).
 */

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
}

const rootPkg = readJson('package.json');
const fullPkg = readJson('packages/full/package.json');
const pluginJson = readJson('packages/full/.claude-plugin/plugin.json');
const marketplace = readJson('marketplace.json');
const fullPlugin = marketplace.plugins.find(p => p.name === 'ensemble-full');

const versions = {
  'package.json': rootPkg.version,
  'packages/full/package.json': fullPkg.version,
  'packages/full/.claude-plugin/plugin.json': pluginJson.version,
  'marketplace.json (top-level)': marketplace.version,
  'marketplace.json (ensemble-full)': fullPlugin?.version ?? 'MISSING',
};

const unique = new Set(Object.values(versions));

if (unique.size === 1) {
  console.log(`✓ All release versions in sync: ${rootPkg.version}`);
  process.exit(0);
} else {
  console.error('✗ Version mismatch detected:');
  for (const [source, ver] of Object.entries(versions)) {
    console.error(`  ${source}: ${ver}`);
  }
  console.error('\nAll five must match before tagging a release.');
  process.exit(1);
}
