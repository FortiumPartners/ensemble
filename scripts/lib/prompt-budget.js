'use strict';
/**
 * Prompt word-budget lint.
 *
 * Metric: whole-file word count (equivalent to `wc -w`: whitespace-separated
 * tokens) of each SOURCE instruction file:
 *   - packages/<pkg>/commands/*.yaml   ceiling 2500
 *   - packages/<pkg>/agents/*.yaml     ceiling 1200
 *   - packages/<pkg>/**\/SKILL.md      ceiling 1500
 * A skill that backs a command manifest (a `skill:` key, see skill-backed-command.js) is that
 * command's whole prompt, so it is measured as one: its SKILL.md plus every `references/*.md`
 * file beside it. Splitting a prompt into references moves its words between files; it must
 * not take them out of the ratchet. Every other skill is measured by its SKILL.md alone.
 * Generated output (packages/pi, codex, opencode), node_modules and symlinks
 * (packages/full mirrors) are skipped so each source is counted once.
 *
 * Ratchet: scripts/prompt-budget-baseline.json maps path -> maxWords for files
 * already over their ceiling. A baselined file fails if it grows past its
 * baseline; an unbaselined file fails if over the ceiling; a baselined file
 * that shrank only yields an advisory. Regenerate with:
 *   node scripts/validate-all.js --update-prompt-baseline
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const { isSkillBacked, resolveSkillFile, listSkillReferences } = require('./skill-backed-command');

const CEILINGS = { command: 2500, agent: 1200, skill: 1500 };
const EXCLUDED_PACKAGES = new Set(['pi', 'codex', 'opencode']);
const BASELINE_PATH = path.join(__dirname, '..', 'prompt-budget-baseline.json');

function countWords(text) {
  const m = text.match(/\S+/g);
  return m ? m.length : 0;
}

function classify(relPath) {
  const parts = relPath.split('/');
  const name = parts[parts.length - 1];
  if (name === 'SKILL.md') return 'skill';
  if (parts.length === 4 && parts[2] === 'commands' && name.endsWith('.yaml')) return 'command';
  if (parts.length === 4 && parts[2] === 'agents' && name.endsWith('.yaml')) return 'agent';
  return null;
}

/**
 * A skill that backs a command manifest is that command's prompt, references included, so its
 * measured size is its SKILL.md plus its `references/*.md` (see the module doc). Adds those
 * words to the SKILL.md entry of `sizes`, once per skill however many manifests name it, and
 * records how many reference files they came from. A manifest that is not valid YAML or names
 * no skill that exists contributes nothing here: the YAML and schema validators report it.
 * @param {Object<string, {kind: string, words: number}>} sizes - Sizes by repo-relative path; mutated
 * @param {Array<{file: string, text: string}>} manifests - Every command YAML: absolute path and text
 * @param {(file: string) => string} toRel - Absolute path -> repo-relative posix path
 */
function addSkillReferenceWords(sizes, manifests, toRel) {
  const counted = new Set();
  for (const { file, text } of manifests) {
    let manifest;
    try {
      manifest = yaml.load(text);
    } catch {
      continue;
    }
    if (!isSkillBacked(manifest)) continue;

    let skillFile;
    try {
      skillFile = resolveSkillFile(file, manifest.skill);
    } catch {
      continue;
    }
    const skillRel = toRel(skillFile);
    if (!sizes[skillRel] || counted.has(skillRel)) continue;
    counted.add(skillRel);

    const references = listSkillReferences(skillFile);
    for (const reference of references) {
      sizes[skillRel].words += countWords(fs.readFileSync(reference, 'utf8'));
    }
    if (references.length > 0) sizes[skillRel].references = references.length;
  }
}

/**
 * @returns {Object<string, {kind: string, words: number, references?: number}>} keyed by
 *   repo-relative posix path. `references` appears only on a skill that backs a command
 *   manifest and has `references/*.md` files: how many, their words being part of `words`.
 */
function collectSizes(packagesDir) {
  const root = path.dirname(packagesDir);
  const toRel = (full) => path.relative(root, full).split(path.sep).join('/');
  const sizes = {};
  const manifests = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (dir === packagesDir && EXCLUDED_PACKAGES.has(entry.name)) continue;
        walk(full);
      } else if (entry.isFile()) {
        const rel = toRel(full);
        const kind = classify(rel);
        if (!kind) continue;
        const text = fs.readFileSync(full, 'utf8');
        sizes[rel] = { kind, words: countWords(text) };
        if (kind === 'command') manifests.push({ file: full, text });
      }
    }
  };
  walk(packagesDir);
  addSkillReferenceWords(sizes, manifests, toRel);
  return sizes;
}

/** Pure check. @returns {{failures: string[], advisories: string[]}} */
function checkBudgets(sizes, baseline, ceilings = CEILINGS) {
  const failures = [];
  const advisories = [];
  for (const [file, { kind, words, references }] of Object.entries(sizes)) {
    const ceiling = ceilings[kind];
    const base = baseline[file];
    // A skill measured with its references says so, since `wc -w` of its SKILL.md is smaller.
    const size = references
      ? `${words} words (SKILL.md plus ${references} reference file${references === 1 ? '' : 's'})`
      : `${words} words`;
    if (base === undefined) {
      if (words > ceiling) {
        failures.push(`${file}: ${size} exceeds ${kind} ceiling of ${ceiling} (not baselined)`);
      }
    } else if (words > base) {
      failures.push(`${file}: ${size} exceeds its baseline of ${base} (${kind} ceiling ${ceiling}); trim it, do not raise the baseline`);
    } else if (words < base) {
      advisories.push(`${file}: ${size} is below its baseline of ${base}; lower the baseline (node scripts/validate-all.js --update-prompt-baseline)`);
    }
  }
  return { failures, advisories };
}

/** Baseline = every file currently over its ceiling, at its current size. */
function buildBaseline(sizes, ceilings = CEILINGS) {
  const out = {};
  for (const file of Object.keys(sizes).sort()) {
    if (sizes[file].words > ceilings[sizes[file].kind]) out[file] = sizes[file].words;
  }
  return out;
}

function loadBaseline(file = BASELINE_PATH) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
}

function writeBaseline(baseline, file = BASELINE_PATH) {
  fs.writeFileSync(file, JSON.stringify(baseline, null, 2) + '\n');
}

module.exports = { CEILINGS, BASELINE_PATH, countWords, classify, collectSizes, checkBudgets, buildBaseline, loadBaseline, writeBaseline };
