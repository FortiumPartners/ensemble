#!/usr/bin/env node
'use strict';

/**
 * Agent Skills spec gate (https://agentskills.io/specification).
 *
 * Runs the reference validator (`skills-ref`) over every skill directory ensemble ships:
 *
 *   source     packages/<pkg>/skills/**   (every directory that holds a SKILL.md)
 *   generated  packages/pi/skills/**      and  packages/codex/.codex/skills/**
 *
 * `packages/full/skills/*` is a symlink farm onto the source skills and is skipped, as are
 * test fixtures (`fixtures/`), `node_modules/` and `__tests__/`.
 *
 * The one deliberate exemption: host extension frontmatter keys (`user-invocable`,
 * `disable-model-invocation`, `argument-hint`, `model`, `capabilities`) are tolerated on
 * skills whose directory name starts with `ensemble-`. Those are the command-wrapper skills
 * the pi and codex generators emit from command prompts, and for source `ensemble-assess`
 * Claude Code reads the file straight from the plugin's `skills/` directory, so its keys must
 * stay top-level for it to hide the skill from the slash menu. Any other violation, including
 * those keys on any other skill, fails the gate.
 *
 * `skills-ref` is ESM-only, hence the dynamic import from this CommonJS script.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PACKAGES_DIR = path.join(ROOT, 'packages');

/** Packages that are mirrors of other skills, not sources. */
const EXCLUDED_SOURCE_PACKAGES = new Set(['full']);
const SKIPPED_DIR_NAMES = new Set(['fixtures', 'node_modules', '__tests__']);
const EXTENSION_KEYS = new Set([
  'user-invocable',
  'disable-model-invocation',
  'argument-hint',
  'model',
  'capabilities',
]);
const EXTENSION_KEY_SKILL_PREFIX = 'ensemble-';
const UNEXPECTED_FIELDS = /^Unexpected fields in frontmatter: (.+?)\. Only allowed-tools/;

/**
 * Every directory under `root` that directly contains a SKILL.md. Does not descend into a
 * skill directory (its subdirectories are assets) and does not follow symlinks.
 */
function findSkillDirs(root) {
  const found = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    if (entries.some((e) => e.name === 'SKILL.md' && e.isFile())) {
      found.push(dir);
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory() || SKIPPED_DIR_NAMES.has(e.name)) continue;
      walk(path.join(dir, e.name));
    }
  };
  walk(root);
  return found;
}

/** Source skill directories plus the generated pi and codex output directories. */
function collectSkillDirs(packagesDir = PACKAGES_DIR) {
  const dirs = [];
  if (!fs.existsSync(packagesDir)) return dirs;
  for (const pkg of fs.readdirSync(packagesDir, { withFileTypes: true })) {
    if (!pkg.isDirectory() || EXCLUDED_SOURCE_PACKAGES.has(pkg.name)) continue;
    dirs.push(...findSkillDirs(path.join(packagesDir, pkg.name, 'skills')));
  }
  dirs.push(...findSkillDirs(path.join(packagesDir, 'codex', '.codex', 'skills')));
  return [...new Set(dirs)].sort();
}

/**
 * Drops the "Unexpected fields" error when every unexpected key is a Claude Code extension
 * key on an `ensemble-*` skill; leaves every other error untouched.
 */
function filterTolerated(skillDir, errors) {
  const tolerated = path.basename(skillDir).startsWith(EXTENSION_KEY_SKILL_PREFIX);
  return errors.filter((message) => {
    const match = UNEXPECTED_FIELDS.exec(message);
    if (!match || !tolerated) return true;
    return !match[1].split(',').map((k) => k.trim()).every((k) => EXTENSION_KEYS.has(k));
  });
}

/** Spec errors for one skill directory ([] when valid). */
async function validateSkillDir(skillDir) {
  const { validate } = await import('skills-ref');
  return filterTolerated(skillDir, await validate(skillDir));
}

async function run(packagesDir = PACKAGES_DIR) {
  const dirs = collectSkillDirs(packagesDir);
  const failures = [];
  for (const dir of dirs) {
    const errors = await validateSkillDir(dir);
    if (errors.length > 0) failures.push({ dir: path.relative(ROOT, dir), errors });
  }
  return { checked: dirs.length, failures };
}

if (require.main === module) {
  run().then(({ checked, failures }) => {
    for (const { dir, errors } of failures) {
      console.error(`✗ ${dir}`);
      for (const message of errors) console.error(`    - ${message}`);
    }
    if (failures.length > 0) {
      console.error(`\n${failures.length} of ${checked} skill(s) violate the Agent Skills spec.`);
      process.exit(1);
    }
    console.log(`✓ ${checked} skill(s) conform to the Agent Skills spec`);
  }).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = { collectSkillDirs, findSkillDirs, filterTolerated, validateSkillDir, run };
