'use strict';

/**
 * Shared test helper (NOT a test file itself): a throwaway package tree for the skill-backed
 * command tests. A skill-backed command's skill is found by path (`<pkg>/commands/<name>.yaml`
 * -> `<pkg>/skills/<skill>/SKILL.md`), so these tests need real files on disk. The tree lives
 * entirely under `os.tmpdir()`, never inside the repository's own packages/ directory:
 *
 * ```
 * <root>/packages/demo/commands/<name>.yaml
 * <root>/packages/demo/skills/<skill>/SKILL.md
 * ```
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

/** A minimal, valid SKILL.md for a skill named `name`. */
function skillFile(name, body = 'Do the demo work for $ARGUMENTS.') {
  return [
    '---',
    `name: ${name}`,
    'description: Demo skill backing a command in the skill-backed command tests.',
    '---',
    '',
    body,
    '',
  ].join('\n');
}

/**
 * Writes `files` under a fresh `<root>/packages/demo/`.
 * @param {Object<string, string>} files - Package-relative path -> file content
 * @returns {{root: string, dir: string, yamlPath: (name: string) => string, cleanup: () => void}}
 */
function createPackage(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-backed-'));
  const dir = path.join(root, 'packages', 'demo');
  for (const [relPath, content] of Object.entries(files)) {
    const full = path.join(dir, relPath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return {
    root,
    dir,
    yamlPath: (name) => path.join(dir, 'commands', `${name}.yaml`),
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

module.exports = { createPackage, skillFile };
