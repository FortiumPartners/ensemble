#!/usr/bin/env node
'use strict';

/**
 * Scaffold a skill-keyed eval.
 * Usage: node evals/new.js <skill>
 * Writes evals/skills/<skill>/eval.json (from templates/eval.json) and fixture/. Every `TODO:` placeholder must be
 * replaced before the eval loads; fixture/ files are the starting workspace the agent sees.
 */

const fs = require('fs');
const path = require('path');
const { findSkillPackages, SKILLS_DIR } = require('./lib/eval-def');

const REPO_ROOT = path.resolve(__dirname, '..');
const TEMPLATE = path.join(__dirname, 'templates', 'eval.json');

/** Write the skeleton; returns the eval directory. Throws if the skill is unknown or the eval exists. */
function scaffold(skill, { skillsDir = SKILLS_DIR, repoRoot = REPO_ROOT } = {}) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(skill || '')) throw new Error(`invalid skill name: ${skill}`);
  if (findSkillPackages(skill, repoRoot).length === 0) {
    throw new Error(`unknown skill "${skill}": no SKILL.md at packages/*/skills/${skill}`);
  }
  const dir = path.join(skillsDir, skill);
  if (fs.existsSync(dir)) throw new Error(`eval already exists: ${path.relative(process.cwd(), dir)}`);
  fs.mkdirSync(path.join(dir, 'fixture'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'fixture', '.gitkeep'), '');
  fs.writeFileSync(path.join(dir, 'eval.json'), fs.readFileSync(TEMPLATE, 'utf8').split('{{skill}}').join(skill));
  return dir;
}

if (require.main === module) {
  try {
    const skill = process.argv[2];
    if (!skill) throw new Error('usage: node evals/new.js <skill>');
    const dir = scaffold(skill);
    console.log(`created ${path.relative(process.cwd(), dir)}/eval.json and fixture/`);
    console.log('replace every `TODO:` placeholder, then check it with: node evals/run.js --dry-run --skill ' + skill);
  } catch (e) {
    console.error(e.message);
    process.exitCode = 2;
  }
}

module.exports = { scaffold };
