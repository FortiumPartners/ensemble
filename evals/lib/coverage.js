'use strict';

/**
 * Skill coverage: every shipped skill appears exactly once as `evaluated`, `exempt` or `missing`; only `missing` counts
 * against coverage.
 *   shipped skills  source skills `packages/<pkg>/skills/<skill>/SKILL.md` (the generated/aggregate packages `full`, `pi`,
 *                   `codex`, `opencode` are skipped: they hold copies or symlinks). A skill directory that is a symlink,
 *                   an invalid name, or a name shipped by two source packages is an error, not a silent pick.
 *   evaluated       a VALID loaded `evals/skills/<skill>/eval.json` names it. A rejected definition leaves the skill
 *                   missing (with the rejection shown). Legacy `evals/scenarios/*` are never read: they are not skills.
 *   exempt          `evals/exemptions.json` maps the skill to a non-empty reason. An empty/blank reason is `missing`.
 * Errors (the report must not be trusted until fixed): an unreadable or malformed exemptions file, a duplicate key, an
 * exemption for a skill that does not exist (stale) or that already has an eval, an invalid skill name.
 */

const fs = require('fs');
const path = require('path');
const { loadEvalDefs, readDefinitionFile, NON_SOURCE_PACKAGES } = require('./eval-def');
const { isSkillName } = require('./results');

const REPO_ROOT = path.resolve(__dirname, '../..');
// Placeholders git or the OS leave in skills/ that are not skills.
const SKILLS_DIR_JUNK = new Set(['.gitkeep', '.DS_Store']);
const EXEMPTIONS_FILE = path.join(__dirname, '..', 'exemptions.json');

class CoverageError extends Error {
  constructor(message) { super(message); this.name = 'CoverageError'; }
}

/**
 * Parse the exemptions file text: a flat JSON object `{ "<skill>": "<reason>" }`. JSON.parse keeps the last of two equal
 * keys, so the top-level keys are scanned separately and a repeat is reported. Returns `{ map, duplicates }`.
 */
function parseExemptions(text, name = 'exemptions.json') {
  let doc;
  try { doc = JSON.parse(text); } catch (e) { throw new CoverageError(`${name}: not valid JSON (${e.message})`); }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new CoverageError(`${name}: must be a JSON object mapping skill name to reason`);
  // Key scan (the text is already known to be valid JSON, so the structure is well formed).
  const keys = [];
  let depth = 0;
  let expectKey = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      while (text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      if (depth === 1 && expectKey) keys.push(JSON.parse(text.slice(i, j + 1)));
      expectKey = false;
      i = j;
    } else if (c === '{' || c === '[') { depth++; expectKey = c === '{' && depth === 1; } else if (c === '}' || c === ']') depth--;
    else if (c === ',' && depth === 1) expectKey = true;
  }
  const seen = new Set();
  const duplicates = [...new Set(keys.filter((k) => (seen.has(k) ? true : (seen.add(k), false))))];
  return { map: doc, duplicates };
}

/** The exemptions file at `file`; a missing file is an empty map, an unreadable or malformed one throws. */
function loadExemptions(file = EXEMPTIONS_FILE) {
  try { fs.lstatSync(file); } catch (e) { if (e.code === 'ENOENT') return { map: {}, duplicates: [] }; }
  let text;
  try { text = readDefinitionFile(file, path.basename(file)); } catch (e) { throw new CoverageError(`${path.basename(file)}: ${e.message}`); }
  return parseExemptions(text, path.basename(file));
}

/**
 * Shipped skills: `{ skills: Map(name -> [package, ...]), errors }`. Packages without a `skills/` directory are skipped.
 */
function listShippedSkills(repoRoot = REPO_ROOT) {
  const packagesDir = path.join(repoRoot, 'packages');
  if (!fs.existsSync(packagesDir)) throw new CoverageError('packages/ directory not found: nothing to cover');
  const skills = new Map();
  const errors = [];
  for (const entry of fs.readdirSync(packagesDir, { withFileTypes: true }).sort((x, y) => (x.name < y.name ? -1 : 1))) {
    const pkg = entry.name;
    if (NON_SOURCE_PACKAGES.has(pkg)) continue;
    if (entry.isSymbolicLink()) { errors.push(`packages/${pkg} is a symlink: a source package must be a real directory`); continue; }
    if (!entry.isDirectory()) continue;
    const skillsRoot = path.join(packagesDir, pkg, 'skills');
    let rootStat = null;
    try { rootStat = fs.lstatSync(skillsRoot); } catch (e) { if (e.code !== 'ENOENT') errors.push(`packages/${pkg}/skills cannot be inspected (${e.code || e.message})`); }
    if (!rootStat) continue;
    if (rootStat.isSymbolicLink()) { errors.push(`packages/${pkg}/skills is a symlink: a source package must hold a real skills directory`); continue; }
    if (!rootStat.isDirectory()) { errors.push(`packages/${pkg}/skills is not a directory`); continue; }
    for (const name of fs.readdirSync(skillsRoot).sort()) {
      if (SKILLS_DIR_JUNK.has(name)) continue;
      const dir = path.join(skillsRoot, name);
      const st = fs.lstatSync(dir);
      if (st.isSymbolicLink()) { errors.push(`packages/${pkg}/skills/${name} is a symlink: a source package must hold real skill directories`); continue; }
      if (!st.isDirectory()) { errors.push(`packages/${pkg}/skills/${name} is a stray non-directory entry: skills/ holds skill directories only`); continue; }
      if (!isSkillName(name)) { errors.push(`packages/${pkg}/skills/${name}: invalid skill name (letters, digits, ".", "_" and "-" only)`); continue; }
      if (!fs.existsSync(path.join(dir, 'SKILL.md'))) { errors.push(`packages/${pkg}/skills/${name} has no SKILL.md`); continue; }
      skills.set(name, [...(skills.get(name) || []), pkg]);
    }
  }
  for (const [name, pkgs] of skills) {
    if (pkgs.length > 1) errors.push(`skill "${name}" is shipped by more than one source package (${pkgs.join(', ')}): a skill must appear once`);
  }
  return { skills, errors };
}

/** An exemption reason as printed: ANSI escape sequences and every other control character removed (line breaks and tabs become a space). */
function cleanReason(text) {
  return String(text)
    .replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)?/g, '')
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/[\r\n\t]/g, ' ')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
    .trim();
}

/**
 * Coverage of the skills under `repoRoot`. Options: skillsDir (evals), exemptionsFile.
 * Returns { rows: [{ skill, packages, status, reason?, evalId?, runtimes?, note? }], errors, counts }.
 */
function computeCoverage({ repoRoot = REPO_ROOT, skillsDir = path.join(__dirname, '..', 'skills'), exemptionsFile = EXEMPTIONS_FILE } = {}) {
  const { skills, errors: skillErrors } = listShippedSkills(repoRoot);
  const errors = [...skillErrors];
  const defs = loadEvalDefs({ skillsDir, repoRoot });
  const evalsBySkill = new Map();
  for (const ev of defs.evals) evalsBySkill.set(ev.skill, [...(evalsBySkill.get(ev.skill) || []), ev]);
  const rejectedBySkill = new Map(defs.rejected.map((r) => [path.basename(r.dir), r.error.message]));
  const { map: exemptions, duplicates } = loadExemptions(exemptionsFile);
  // An eval that names a skill nobody ships is an error, not silently ignored (a rejected one is judged by its directory name).
  for (const ev of defs.evals) if (!skills.has(ev.skill)) errors.push(`eval "${ev.id}" names skill "${ev.skill}", which no source package ships`);
  for (const r of defs.rejected) if (!skills.has(path.basename(r.dir))) errors.push(`evals/skills/${path.basename(r.dir)} was rejected and names no shipped skill: ${r.error.message}`);

  for (const d of duplicates) errors.push(`exemptions.json: duplicate exemption for "${d}"`);
  for (const [name, reason] of Object.entries(exemptions)) {
    if (!isSkillName(name)) errors.push(`exemptions.json: invalid skill name "${name.slice(0, 60)}"`);
    else if (!skills.has(name)) errors.push(`exemptions.json: stale exemption "${name}": no such shipped skill`);
    else if (evalsBySkill.has(name)) errors.push(`exemptions.json: stale exemption "${name}": the skill has an eval, so it cannot also be exempt`);
    if (reason !== null && typeof reason !== 'string') errors.push(`exemptions.json: the reason for "${name}" must be a string`);
  }

  const rows = [...skills.keys()].sort().map((skill) => {
    const packages = skills.get(skill);
    const evs = evalsBySkill.get(skill);
    if (evs) return { skill, packages, status: 'evaluated', evalId: evs.map((e) => e.id).join(', '), runtimes: [...new Set(evs.flatMap((e) => e.runtimes))].sort() };
    const reason = Object.prototype.hasOwnProperty.call(exemptions, skill) ? exemptions[skill] : undefined;
    if (typeof reason === 'string' && cleanReason(reason) !== '') {
      return { skill, packages, status: 'exempt', reason: cleanReason(reason), ...(rejectedBySkill.has(skill) && { rejection: rejectedBySkill.get(skill) }) };
    }
    const note = rejectedBySkill.has(skill) ? `its eval was rejected: ${rejectedBySkill.get(skill)}`
      : Object.prototype.hasOwnProperty.call(exemptions, skill) ? 'exempt but no reason is given' : 'no eval and no exemption';
    return { skill, packages, status: 'missing', note };
  });
  const counts = { evaluated: 0, exempt: 0, missing: 0, total: rows.length };
  for (const r of rows) counts[r.status]++;
  return { rows, errors, counts };
}

/** Plain-text report. `missing` is also called out as uncovered; the counts line says how many count against coverage. */
function formatCoverage(c) {
  const out = [];
  for (const status of ['evaluated', 'exempt', 'missing']) {
    const rows = c.rows.filter((r) => r.status === status);
    out.push(`${status.toUpperCase()}${status === 'missing' ? ' (uncovered)' : ''}: ${rows.length}`);
    for (const r of rows) {
      const detail = status === 'evaluated' ? `eval ${r.evalId} [${r.runtimes.join(', ')}]` : status === 'exempt' ? `reason: ${r.reason}` : r.note;
      out.push(`  ${r.skill} (${r.packages.join(', ')}): ${detail}`);
      if (r.rejection) out.push(`    REJECTED eval (the exemption does not hide it): ${r.rejection}`);
    }
  }
  out.push(`total ${c.counts.total}: ${c.counts.evaluated} evaluated, ${c.counts.exempt} exempt, ${c.counts.missing} missing`);
  for (const e of c.errors) out.push(`ERROR ${e}`);
  return out.join('\n');
}

module.exports = { cleanReason, computeCoverage, formatCoverage, listShippedSkills, loadExemptions, parseExemptions, CoverageError, EXEMPTIONS_FILE };
