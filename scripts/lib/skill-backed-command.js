/**
 * Skill-backed commands ("commands invoke skills").
 *
 * A command YAML with a top-level `skill: <skill-directory-name>` key is a MANIFEST. Its
 * prompt lives in `packages/<same package>/skills/<skill>/SKILL.md` and, when the skill is
 * split to keep SKILL.md short, in the `references/*.md` files beside it. That skill is the
 * single source of truth, so the YAML shrinks to `metadata` + `skill` and every runtime emits
 * a thin entry point that points at the skill instead of rendering a prompt of its own
 * (Claude Code: the stub command built by command-transformer.js).
 *
 * Everything here that has to answer "is this command skill-backed, where is its skill, and
 * which files make it up?" lives in one module so the generators, the schema validator, the
 * lints and the prompt budget cannot disagree about it.
 */

'use strict';

const fs = require('fs');
const path = require('path');

/** Agent Skills spec name: lowercase letters and digits, single hyphens between them. */
const SKILL_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SKILL_NAME_MAX_LENGTH = 64;

/** Directory beside a SKILL.md that holds the skill's reference files (Agent Skills spec). */
const REFERENCES_DIR = 'references';

/**
 * True when the parsed command YAML carries a `skill` key. Presence, not validity, decides:
 * `skill:` with a null or malformed value is still an attempt at a manifest, and the schema
 * validator is the place that says what is wrong with it.
 * @param {object} commandData - Parsed command YAML
 * @returns {boolean}
 */
function isSkillBacked(commandData) {
  return (
    commandData !== null &&
    typeof commandData === 'object' &&
    Object.prototype.hasOwnProperty.call(commandData, 'skill')
  );
}

/**
 * True for a string usable as a skill directory name. Doubles as the path-traversal guard:
 * the name is joined into a filesystem path, and this pattern admits no separator or dot.
 * @param {unknown} name
 * @returns {boolean}
 */
function isValidSkillName(name) {
  return typeof name === 'string' && name.length <= SKILL_NAME_MAX_LENGTH && SKILL_NAME_RE.test(name);
}

/**
 * Absolute path of the SKILL.md a skill-backed command points at. The skill must live in
 * the command's own package: `<pkg>/commands/<name>.yaml` -> `<pkg>/skills/<skill>/SKILL.md`.
 * @param {string} sourceYamlPath - Path to the command's YAML
 * @param {string} skill - The manifest's `skill` value
 * @returns {string} Absolute path to an existing SKILL.md
 * @throws {Error} If the name is not a valid skill name or the SKILL.md does not exist
 */
function resolveSkillFile(sourceYamlPath, skill) {
  if (!isValidSkillName(skill)) {
    throw new Error(
      `skill ${JSON.stringify(skill)} is not a valid skill directory name ` +
      `(lowercase letters, digits and single hyphens, at most ${SKILL_NAME_MAX_LENGTH} characters)`
    );
  }

  const packageDir = path.resolve(path.dirname(sourceYamlPath), '..');
  const skillFile = path.join(packageDir, 'skills', skill, 'SKILL.md');

  let isFile = false;
  try {
    isFile = fs.statSync(skillFile).isFile();
  } catch {
    // fall through: reported below with the path that was looked at
  }
  if (!isFile) {
    throw new Error(
      `skill-backed command points at skill '${skill}', but ${skillFile} does not exist. ` +
      'A skill-backed command\'s skill must live in the same package as its YAML ' +
      '(packages/<pkg>/skills/<skill>/SKILL.md next to packages/<pkg>/commands/<name>.yaml).'
    );
  }
  return skillFile;
}

/**
 * The reference files of a skill: the `.md` files directly inside the `references/`
 * directory beside its SKILL.md, as absolute paths sorted by name. They are one level deep,
 * as the Agent Skills spec has it, so a subdirectory, a file of another type and a symlink
 * are not references. The order is plain code-unit order, independent of the locale, so every
 * consumer reads the files in the same order; name them so that order is the reading order
 * (`phase-1-...md`, `phase-2-...md`). A skill without a `references/` directory has none.
 * @param {string} skillFile - Absolute path to the skill's SKILL.md
 * @returns {string[]}
 * @throws {Error} If `references/` exists but cannot be listed
 */
function listSkillReferences(skillFile) {
  const dir = path.join(path.dirname(skillFile), REFERENCES_DIR);
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => entry.name)
    .sort()
    .map((name) => path.join(dir, name));
}

/**
 * The whole prompt of a skill: its SKILL.md followed by each of its reference files (see
 * listSkillReferences), a line break between files. Splitting a long SKILL.md into
 * references moves text between files and removes none from the skill, so a check that reads
 * "the skill" has to read all of them; reading the SKILL.md alone would quietly stop
 * checking whatever moved.
 * @param {string} skillFile - Absolute path to the skill's SKILL.md
 * @returns {string}
 * @throws {Error} If the SKILL.md or any reference cannot be read: a partial read must not
 *   pass for a complete one
 */
function readSkillProse(skillFile) {
  return [skillFile, ...listSkillReferences(skillFile)]
    .map((file) => fs.readFileSync(file, 'utf8'))
    .join('\n');
}

/**
 * The prose a command's body checks should scan. A plain command's prose is its own YAML
 * text. A skill-backed command's manifest holds none, so the text is the manifest plus its
 * skill's prose (SKILL.md, then its `references/*.md`); scanning the manifest alone, or the
 * SKILL.md alone, would quietly stop checking the command.
 * @param {string} sourceYamlPath - Path to the command's YAML
 * @param {object} commandData - Parsed command YAML
 * @param {string} rawText - The YAML file's raw text
 * @returns {string}
 * @throws {Error} If a skill-backed command's skill cannot be resolved or read
 */
function readCommandProse(sourceYamlPath, commandData, rawText) {
  if (!isSkillBacked(commandData)) {
    return rawText;
  }
  return `${rawText}\n${readSkillProse(resolveSkillFile(sourceYamlPath, commandData.skill))}`;
}

module.exports = {
  isSkillBacked,
  isValidSkillName,
  resolveSkillFile,
  listSkillReferences,
  readSkillProse,
  readCommandProse
};
