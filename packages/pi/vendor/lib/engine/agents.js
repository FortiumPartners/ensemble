'use strict';

/**
 * TRD-009 (TRD-2026-d571763f): which agents exist, and what each unqualified name resolves to.
 *
 * Step 1.7 of implement-trd-tasks builds AGENT_ALIAS_MAP from the agent definitions in the
 * repository plus the agents a runtime actually installed
 * (`skills/ensemble-implement-trd-tasks/references/phase-1-preflight.md:65`). Both tiers are read
 * here, because a name that only exists in one of them still has to resolve: a roster naming an
 * agent no runtime registered is the case the skill halts on, and the engine can only report that
 * honestly if it looked in both places.
 *
 * Nothing here invents an agent. An unreadable or nameless definition is skipped rather than
 * guessed at: an id derived from a filename that does not match the agent's declared name would
 * be passed to Task() and fail at the only moment it mattered.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

// js-yaml is absent from the marketplace-cache install, the same reason team-defaults.js guards
// its require. Without it the source tier can still read `metadata.name` from the two lines that
// hold it, which is all this module wants from an agent file.
let yaml;
try {
  yaml = require('js-yaml');
} catch {
  yaml = null;
}

const { normalizeLineEndings, scanFrontmatter } = require('../trd-parser');

/**
 * The packages that only mirror other packages' agents (`scripts/lib/mirror-packages.js:21`).
 * Reading them would offer a second id for an agent that already has one, and the mirror's id is
 * never the one the agent is registered under.
 */
const MIRROR_PACKAGES = Object.freeze(['full', 'pi']);

/** Where a runtime installs plugins, relative to the home directory. */
const RUNTIME_PLUGIN_DIR = Object.freeze(['.omp', 'plugins', 'node_modules']);

/** Tier order used when two tiers offer an id for the same name: later wins. */
const TIER_RANK = Object.freeze({ runtime: 2, source: 1 });

function readDir(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

/**
 * The plugin name a package publishes under, which is the namespace of every agent it ships.
 * @param {string} packageDir absolute path of the package
 * @returns {string} the declared name, or `ensemble-<dir>` when the manifest says nothing
 */
function pluginNameOf(packageDir) {
  const fallback = `ensemble-${path.basename(packageDir)}`;
  const text = readText(path.join(packageDir, '.claude-plugin', 'plugin.json'));
  if (text === null) return fallback;
  let manifest;
  try {
    manifest = JSON.parse(text);
  } catch {
    return fallback;
  }
  if (!manifest || typeof manifest.name !== 'string' || manifest.name === '') return fallback;
  return manifest.name;
}

/**
 * The `metadata.name` an agent definition declares.
 * @param {string} file absolute path of a `*.yaml` agent definition
 * @returns {string|null} the name, or null when the file declares none
 */
function agentNameFromYaml(file) {
  const text = readText(file);
  if (text === null) return null;
  if (yaml !== null) {
    let parsed;
    try {
      parsed = yaml.load(text);
    } catch {
      return null;
    }
    const name = parsed && parsed.metadata ? parsed.metadata.name : null;
    return typeof name === 'string' && name !== '' ? name : null;
  }
  // A quoted name is the same name: `name: "backend-developer"` declares `backend-developer`.
  // A trailing comment is not part of the name: `name: backend-developer # default` declares
  // `backend-developer`.
  const block = metadataBlock(text);
  if (block === null) return null;
  const indent = directChildIndent(block);
  if (indent === null) return null;
  const match = new RegExp(
    `^${indent}name:[ \\t]*(?:['"]([\\w.-]+)['"]|([\\w.-]+))[ \\t]*(?:[ \\t]+#.*)?$`,
    'm'
  ).exec(block);
  if (!match) return null;
  return match[1] || match[2] || null;
}

/**
 * The indentation of the metadata block's own children, which is the indentation of its first
 * non-blank line. A `name:` line at any other indentation belongs to a nested key, not to
 * `metadata.name`.
 * @param {string} block the metadata block's text
 * @returns {string|null} the children's indentation, or null when the block holds no line
 */
function directChildIndent(block) {
  for (const line of block.split('\n')) {
    if (line.trim() === '') continue;
    return /^[ \t]*/.exec(line)[0];
  }
  return null;
}

/**
 * The `metadata:` block of an agent definition: its own line and the indented lines that follow
 * it. A `name:` line outside that block belongs to another key and is not the agent's name.
 * @param {string} text the definition's whole text
 * @returns {string|null} the block's text, or null when the file declares no `metadata:` key
 */
function metadataBlock(text) {
  const lines = normalizeLineEndings(text).split('\n');
  const start = lines.findIndex(line => /^metadata:\s*$/.test(line));
  if (start === -1) return null;
  const block = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() === '') {
      block.push(line);
      continue;
    }
    if (!/^[ \t]+\S/.test(line)) break;
    block.push(line);
  }
  return block.join('\n');
}

/**
 * The `name` a runtime agent's frontmatter declares.
 * @param {string} file absolute path of a `*.md` agent definition
 * @returns {string|null} the declared name, or null when there is none
 */
function agentNameFromMarkdown(file) {
  const text = readText(file);
  if (text === null) return null;
  const { frontmatter } = scanFrontmatter(normalizeLineEndings(text));
  const name = frontmatter ? frontmatter.name : null;
  return typeof name === 'string' && name !== '' ? name : null;
}

/**
 * The agents defined in this repository's own packages.
 * @param {string} projectRoot absolute path of the project root
 * @returns {Array<{id: string, name: string, tier: string}>}
 */
function discoverSourceAgents(projectRoot) {
  const entries = [];
  const packagesDir = path.join(projectRoot, 'packages');
  for (const pkg of readDir(packagesDir)) {
    if (!pkg.isDirectory() || MIRROR_PACKAGES.includes(pkg.name)) continue;
    const packageDir = path.join(packagesDir, pkg.name);
    const agentsDir = path.join(packageDir, 'agents');
    const files = readDir(agentsDir).filter(f => f.isFile() && f.name.endsWith('.yaml'));
    if (files.length === 0) continue;
    const plugin = pluginNameOf(packageDir);
    for (const file of files) {
      const name = agentNameFromYaml(path.join(agentsDir, file.name));
      if (name === null) continue;
      entries.push({ id: `${plugin}:${name}`, name, tier: 'source' });
    }
  }
  return entries;
}

/**
 * The agents a runtime installed, under both the scoped and the unscoped package layouts
 * (`phase-1-preflight.md:65`).
 * @param {string} home absolute path of the home directory to read
 * @returns {Array<{id: string, name: string, tier: string}>}
 */
function discoverRuntimeAgents(home) {
  const entries = [];
  const modulesDir = path.join(home, ...RUNTIME_PLUGIN_DIR);
  const packageDirs = [];
  for (const entry of readDir(modulesDir)) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('@')) {
      for (const scoped of readDir(path.join(modulesDir, entry.name))) {
        if (scoped.isDirectory()) packageDirs.push(path.join(modulesDir, entry.name, scoped.name));
      }
      continue;
    }
    packageDirs.push(path.join(modulesDir, entry.name));
  }
  for (const packageDir of packageDirs) {
    const agentsDir = path.join(packageDir, 'agents');
    const plugin = path.basename(packageDir);
    for (const file of readDir(agentsDir)) {
      if (!file.isFile() || !file.name.endsWith('.md')) continue;
      const declared = agentNameFromMarkdown(path.join(agentsDir, file.name));
      const name = declared === null ? file.name.replace(/\.md$/, '') : declared;
      entries.push({ id: `${plugin}:${name}`, name, tier: 'runtime' });
    }
  }
  return entries;
}

/**
 * Every agent this session could delegate to.
 * @param {{projectRoot: string, env?: object}} input
 * @returns {Array<{id: string, name: string, tier: string}>} sorted by id, then tier
 */
function discoverAgents({ env, projectRoot }) {
  const environment = env || {};
  const home = environment.HOME || environment.USERPROFILE || os.homedir();
  const entries = [...discoverSourceAgents(projectRoot), ...discoverRuntimeAgents(home)];
  entries.sort((a, b) => (a.id === b.id ? a.tier.localeCompare(b.tier) : a.id < b.id ? -1 : 1));
  return entries;
}

/**
 * The unqualified name to runtime id map. An exact unqualified entry wins over an alias
 * (`phase-1-preflight.md:65`); otherwise what a runtime installed wins over what the repository
 * defines, and a tie inside one tier is broken on the smallest id so two runs agree.
 * @param {Array<{id: string, name: string, tier: string}>} entries
 * @returns {object} name to id, in sorted key order
 */
function buildAliasMap(entries) {
  const best = new Map();
  for (const entry of entries) {
    const current = best.get(entry.name);
    if (current === undefined || preferred(entry, current)) best.set(entry.name, entry);
  }
  const map = Object.create(null);
  for (const name of [...best.keys()].sort()) map[name] = best.get(name).id;
  return map;
}

function preferred(candidate, current) {
  const candidateExact = candidate.id === candidate.name;
  const currentExact = current.id === current.name;
  if (candidateExact !== currentExact) return candidateExact;
  const rank = (TIER_RANK[candidate.tier] || 0) - (TIER_RANK[current.tier] || 0);
  if (rank !== 0) return rank > 0;
  return candidate.id < current.id;
}

module.exports = {
  MIRROR_PACKAGES,
  buildAliasMap,
  discoverAgents,
};
