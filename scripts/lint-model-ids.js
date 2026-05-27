#!/usr/bin/env node
'use strict';
/**
 * Lint script: scans all command and agent YAML files for model: fields
 * and validates them against KNOWN_MODEL_IDS.
 * Exit 0 = all clean; Exit 1 = unknown model IDs found.
 */
const path = require('path');
const fs = require('fs');
const { KNOWN_MODEL_IDS } = require('../packages/core/lib/known-model-ids');

const ROOT = path.resolve(__dirname, '..');

function findYamlFiles() {
  const results = [];

  const packagesDir = path.join(ROOT, 'packages');
  if (!fs.existsSync(packagesDir)) {
    return results;
  }

  const packages = fs.readdirSync(packagesDir).filter(name => {
    const stat = fs.statSync(path.join(packagesDir, name));
    return stat.isDirectory();
  });

  for (const pkg of packages) {
    const pkgDir = path.join(packagesDir, pkg);

    // packages/*/agents/*.yaml
    const agentsDir = path.join(pkgDir, 'agents');
    if (fs.existsSync(agentsDir)) {
      const agentFiles = fs.readdirSync(agentsDir).filter(f => f.endsWith('.yaml'));
      for (const f of agentFiles) {
        results.push(path.join(agentsDir, f));
      }
    }

    // packages/*/commands/**/*.yaml (recursive)
    const commandsDir = path.join(pkgDir, 'commands');
    if (fs.existsSync(commandsDir)) {
      collectYamlFiles(commandsDir, results);
    }
  }

  return results;
}

function collectYamlFiles(dir, results) {
  const entries = fs.readdirSync(dir);
  for (const entry of entries) {
    const fullPath = path.join(dir, entry);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      collectYamlFiles(fullPath, results);
    } else if (entry.endsWith('.yaml')) {
      results.push(fullPath);
    }
  }
}

function extractModelValue(yamlContent) {
  // Simple regex: match "  model: value" or "model: value" at start of line
  // Return the value string or null if not found
  // Do NOT parse full YAML — just extract the metadata model field
  const match = yamlContent.match(/^  model:\s+(\S+)\s*$/m) || yamlContent.match(/^model:\s+(\S+)\s*$/m);
  return match ? match[1] : null;
}

function main() {
  const yamlFiles = findYamlFiles();
  const errors = [];
  const VALID_TIERS = ['high', 'medium', 'low'];
  // Also accept full model IDs that are in KNOWN_MODEL_IDS
  const VALID_VALUES = new Set([...VALID_TIERS, ...KNOWN_MODEL_IDS]);

  for (const filePath of yamlFiles) {
    const content = fs.readFileSync(filePath, 'utf8');
    const modelValue = extractModelValue(content);
    if (!modelValue) continue; // No model field — not an error
    if (!VALID_VALUES.has(modelValue)) {
      const relPath = path.relative(ROOT, filePath);
      errors.push(`${relPath}: model: ${modelValue} (not in KNOWN_MODEL_IDS or valid tier)`);
    }
  }

  if (errors.length > 0) {
    console.error('Model ID lint FAILED — unknown model values:');
    errors.forEach(e => console.error('  ' + e));
    process.exit(1);
  } else {
    console.log(`Model ID lint passed — ${yamlFiles.length} files scanned, all model: values are valid.`);
    process.exit(0);
  }
}

main();
