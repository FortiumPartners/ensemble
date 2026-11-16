'use strict';

/**
 * Skill-keyed eval definitions: `evals/skills/<skill>/eval.json` plus `fixture/` and optional `rubric.md`.
 * Plain files, discovered by scanning the directory: no build step, no registry.
 *
 * A definition must state its task (`prompt`), starting workspace (`fixture/`), skill under test
 * (`skill`) and `checks`. Anything else is rejected with an EvalDefinitionError naming the eval and the part.
 */

const fs = require('fs');
const path = require('path');
const { GRADERS } = require('./graders');
const { scanFixture } = require('./fixture');

const MAX_DEF_BYTES = 1024 * 1024;

/**
 * Text of a definition file (eval.json, rubric.md, exemptions.json): opened without following a symlink and without
 * blocking on a FIFO, a regular file under 1 MiB only. Throws an Error whose message names `what` and never quotes content.
 */
function readDefinitionFile(file, what) {
  let fd;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  } catch (e) {
    throw new Error(e.code === 'ELOOP' ? `${what} is a symlink; symlinks are never followed` : `cannot read ${what} (${e.code || e.message})`);
  }
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile()) throw new Error(`${what} is not a regular file`);
    if (st.size > MAX_DEF_BYTES) throw new Error(`${what} is larger than ${MAX_DEF_BYTES} bytes`);
    return fs.readFileSync(fd, 'utf8');
  } finally { fs.closeSync(fd); }
}


const REPO_ROOT = path.resolve(__dirname, '../..');
const SKILLS_DIR = path.join(__dirname, '../skills');
// Generated or aggregate packages hold copies or symlinks of skills; the source package is the one evaluated.
const NON_SOURCE_PACKAGES = new Set(['full', 'pi', 'codex', 'opencode']);
// Validated and documented, but not yet acted on by the runner (none now: `runtimes` acts since PR 4).
const UNACTED_FIELDS = [];
// `explicit-both`: the command prefixes the prompt in BOTH arms (the command lives in a package both arms load, see `sharedPackages`).
const INVOCATIONS = ['plain', 'explicit', 'explicit-both'];
const KNOWN_KEYS = new Set([
  'id', 'skill', 'description', 'runtimes', 'prompt', 'invocation', 'command', 'allowedTools',
  'maxTurns', 'timeoutSec', 'repeats', 'bar', 'expectInvoked', 'checks',
  'sharedPackages', 'sandboxPath', 'remote', 'branch',
]);

/** A rejected definition. `part` names what is wrong (task, workspace, skill, checks, or a field). */
/**
 * The one validation of `sandboxPath` (fixture directories put first on the agent's PATH), shared by skill evals and legacy scenarios:
 * a non-empty array of relative directories that exist inside `fixtureDir` (no absolute path, `..`, backslash, colon or control
 * character, no link). Returns the normalized entries; throws an Error with the message to show.
 */
function checkSandboxPath(sp, fixtureDir) {
  if (!(Array.isArray(sp) && sp.length > 0 && sp.every(isNonEmptyString))) throw new Error('`sandboxPath` must be a non-empty array of fixture directories');
  for (const d of sp) {
    const norm = path.posix.normalize(d);
    // eslint-disable-next-line no-control-regex
    if (path.isAbsolute(d) || d.includes('\\') || /[:\x00-\x1f]/.test(d) || norm.startsWith('..') || norm === '.') throw new Error(`\`sandboxPath\` entry ${JSON.stringify(d)} must be a relative directory inside the fixture`);
    const st = fs.lstatSync(path.join(fixtureDir, norm), { throwIfNoEntry: false });
    if (!st || !st.isDirectory()) throw new Error(`\`sandboxPath\` entry ${JSON.stringify(d)} is not a directory in the fixture`);
  }
  return sp.map((d) => path.posix.normalize(d));
}

class EvalDefinitionError extends Error {
  constructor(evalId, part, message) {
    super(`eval "${evalId}": ${message}`);
    this.name = 'EvalDefinitionError';
    this.evalId = evalId;
    this.part = part;
  }
}

const SKILL_NAME = /^[A-Za-z0-9._-]+$/;
const isSkillName = (v) => typeof v === 'string' && SKILL_NAME.test(v) && v !== '.' && v !== '..';
const isNonEmptyString = (v) => typeof v === 'string' && v.trim() !== '';
const isPositiveInt = (v) => Number.isInteger(v) && v > 0;

/** Packages (source only) that ship a skill named `skill`, i.e. have packages/<pkg>/skills/<skill>/SKILL.md. */
function findSkillPackages(skill, repoRoot = REPO_ROOT) {
  if (!isSkillName(skill)) return [];
  const packagesDir = path.join(repoRoot, 'packages');
  if (!fs.existsSync(packagesDir)) return [];
  return fs.readdirSync(packagesDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !NON_SOURCE_PACKAGES.has(e.name))
    .map((e) => e.name)
    .filter((pkg) => {
      const skillsRoot = path.resolve(packagesDir, pkg, 'skills');
      const dir = path.resolve(skillsRoot, skill);
      return dir.startsWith(skillsRoot + path.sep) && fs.existsSync(path.join(dir, 'SKILL.md'));
    })
    .sort();
}

/** String values anywhere in a parsed JSON value, for placeholder detection. */
function stringValues(v) {
  if (typeof v === 'string') return [v];
  if (Array.isArray(v)) return v.flatMap(stringValues);
  if (v && typeof v === 'object') return Object.values(v).flatMap(stringValues);
  return [];
}

function isJudged(check) {
  return Boolean(check) && (check.type === 'judge' || check.judged === true);
}

/**
 * Validate a parsed eval.json that lives in `dir`. Returns the loaded eval; throws EvalDefinitionError.
 * Loaded: { id, skill, package, description, runtimes, prompt, invocation, command, allowedTools, maxTurns,
 *           timeoutSec, repeats, bar, expectInvoked, checks, unactedFields, dir, fixtureDir }
 */
function readRubric(file, fail) {
  try { return readDefinitionFile(file, 'rubric.md'); } catch (e) { return fail('rubric', e.message); }
}

function validateEvalDef(raw, dir, { repoRoot = REPO_ROOT } = {}) {
  const dirName = path.basename(dir);
  const id = raw && isNonEmptyString(raw.id) ? raw.id : dirName;
  const fail = (part, message) => { throw new EvalDefinitionError(id, part, message); };

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('eval.json', 'eval.json must be a JSON object');
  for (const key of Object.keys(raw)) {
    if (!KNOWN_KEYS.has(key)) fail(key, `unknown field \`${key}\``);
  }
  const placeholder = stringValues(raw).find((s) => /^\s*TODO:/.test(s));
  if (placeholder) fail('placeholder', `placeholder not filled in: "${placeholder.slice(0, 60)}"`);

  // The four required parts: task, workspace, skill, checks.
  if (!isNonEmptyString(raw.prompt)) fail('task', 'missing task: `prompt` is required');
  const fixtureDir = path.join(dir, 'fixture');
  if (!fs.existsSync(fixtureDir) || !fs.statSync(fixtureDir).isDirectory()) {
    fail('workspace', 'missing workspace: a `fixture/` directory is required next to eval.json');
  }
  if (!isNonEmptyString(raw.skill)) fail('skill', 'missing skill: `skill` is required');
  if (!Array.isArray(raw.checks) || raw.checks.length === 0) fail('checks', 'missing checks: `checks` must be a non-empty array');
  if (!isSkillName(raw.skill)) fail('skill', `invalid skill "${raw.skill}": a skill name may only contain letters, digits, ".", "_" and "-"`);
  if (fs.lstatSync(fixtureDir).isSymbolicLink()) fail('workspace', 'unsafe fixture: `fixture` must be a directory, not a symlink');
  const unsafe = scanFixture(fixtureDir);
  if (unsafe.length) {
    fail('workspace', `unsafe fixture: ${unsafe.map((u) => `${path.join('fixture', u.file)} (${u.reason})`).join('; ')}`);
  }

  const packages = findSkillPackages(raw.skill, repoRoot);
  if (packages.length === 0) fail('skill', `unknown skill "${raw.skill}": no SKILL.md at packages/*/skills/${raw.skill}`);

  const invocation = raw.invocation === undefined ? 'plain' : raw.invocation;
  if (!INVOCATIONS.includes(invocation)) fail('invocation', `invocation must be one of ${INVOCATIONS.join(', ')}`);
  if (/^\s*-/.test(raw.prompt)) fail('prompt', 'prompt must not begin with "-": it would be read as a command-line option');
  if (/^\s*@/.test(raw.prompt)) fail('prompt', 'prompt must not begin with "@": Pi may read it as a file include');
  if (invocation === 'plain' && raw.prompt.trim().startsWith('/')) {
    fail('prompt', 'prompt must be plain language, not a slash command; use `invocation: "explicit"` with `command`');
  }
  if (invocation !== 'plain' && !isNonEmptyString(raw.command)) {
    fail('command', `invocation "${invocation}" requires \`command\` (the name Claude Code registers for a --plugin-dir command, /<plugin>:ensemble:<command>, for example "/ensemble-product:ensemble:create-prd")`);
  }
  if (raw.command !== undefined && !isNonEmptyString(raw.command)) fail('command', '`command` must be a non-empty string');
  if (isNonEmptyString(raw.command) && /^\s*-/.test(raw.command)) fail('command', '`command` must not begin with "-"');

  if (raw.runtimes !== undefined && !(Array.isArray(raw.runtimes) && raw.runtimes.length > 0 && raw.runtimes.every(isNonEmptyString))) {
    fail('runtimes', '`runtimes` must be a non-empty array of runtime names');
  }
  if (raw.allowedTools !== undefined && !(Array.isArray(raw.allowedTools) && raw.allowedTools.every(isNonEmptyString))) {
    fail('allowedTools', '`allowedTools` must be an array of tool names');
  }
  // Entries are joined with commas into one argv element (no shell), so only a comma, a control character or edge whitespace is ambiguous; scoped patterns like `Bash(git status:*)` are valid.
  const badTool = (raw.allowedTools || []).find((t) => /[,\x00-\x1f]/.test(t) || t !== t.trim());
  if (badTool !== undefined) fail('allowedTools', `\`allowedTools\` entry ${JSON.stringify(badTool)} contains a comma, a control character or leading/trailing whitespace (entries are joined with commas on the command line)`);
  for (const key of ['maxTurns', 'timeoutSec', 'repeats', 'bar']) {
    if (raw[key] !== undefined && !isPositiveInt(raw[key])) fail(key, `\`${key}\` must be a positive integer`);
  }
  // Only when both are set here: with `repeats` unset the count comes from --repeats or limits.json at run time,
  // where resolveRepeats rejects a bar that cannot be met.
  if (raw.bar !== undefined && raw.repeats !== undefined && raw.bar > raw.repeats) fail('bar', '`bar` cannot exceed `repeats`');
  if (raw.expectInvoked !== undefined && typeof raw.expectInvoked !== 'boolean') fail('expectInvoked', '`expectInvoked` must be true or false');

  // Packages loaded in BOTH arms (a command the eval drives lives there), by name. The with-skill arm loads them plus the
  // skill's own package; the baseline arm loads only them. Claude-only: Pi loads a single skill and has no package commands.
  let sharedPackages = [];
  if (raw.sharedPackages !== undefined) {
    const sp = raw.sharedPackages;
    if (!(Array.isArray(sp) && sp.length > 0 && sp.every(isSkillName))) fail('sharedPackages', '`sharedPackages` must be a non-empty array of package names');
    const bad = sp.find((n) => NON_SOURCE_PACKAGES.has(n) || !fs.existsSync(path.join(repoRoot, 'packages', n, 'package.json')));
    if (bad !== undefined) fail('sharedPackages', `\`sharedPackages\` entry "${bad}" is not a source package under packages/`);
    if (new Set(sp).size !== sp.length) fail('sharedPackages', '`sharedPackages` must not repeat a package');
    if (sp.includes(packages[0])) fail('sharedPackages', `\`sharedPackages\` must not include "${packages[0]}", the package that ships the skill under test: it would load the skill in the baseline arm`);
    if (!(Array.isArray(raw.runtimes) && raw.runtimes.length === 1 && raw.runtimes[0] === 'claude')) fail('sharedPackages', '`sharedPackages` requires `"runtimes": ["claude"]` (Pi loads one skill and has no package commands)');
    sharedPackages = sp;
  }
  if (invocation === 'explicit-both' && !(Array.isArray(raw.runtimes) && raw.runtimes.length === 1 && raw.runtimes[0] === 'claude')) {
    fail('invocation', 'invocation "explicit-both" requires `"runtimes": ["claude"]` (Pi has no package commands)');
  }
  // Directories of the fixture put first on the AGENT's PATH (a stub binary the scenario needs). Never on the checks' PATH.
  let sandboxPath = [];
  if (raw.sandboxPath !== undefined) {
    try { sandboxPath = checkSandboxPath(raw.sandboxPath, fixtureDir); } catch (e) { fail('sandboxPath', e.message); }
  }
  if (raw.remote !== undefined && typeof raw.remote !== 'boolean') fail('remote', '`remote` must be true or false');
  if (raw.branch !== undefined && !(typeof raw.branch === 'string' && /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(raw.branch) && !raw.branch.includes('..') && raw.branch !== 'main')) {
    fail('branch', '`branch` must be a branch name other than main (letters, digits, ".", "_", "-" and "/")');
  }

  const rubricFile = path.join(dir, 'rubric.md');
  const checks = raw.checks.map((check, i) => {
    const where = `checks[${i}]`;
    if (!check || typeof check !== 'object' || !isNonEmptyString(check.type)) fail('checks', `${where} must be an object with a \`type\``);
    if (isJudged(check)) {
      if (check.type !== 'judge') fail('checks', `${where} is judged: its type must be "judge", not "${check.type}"`);
      const rubric = isNonEmptyString(check.rubric) ? check.rubric
        : (fs.existsSync(rubricFile) ? readRubric(rubricFile, fail) : '');
      if (!isNonEmptyString(rubric)) fail('rubric', `${where} is judged and needs a written rubric (\`rubric\` or rubric.md)`);
      return { ...check, judged: true, rubric };
    }
    if (!GRADERS[check.type]) fail('checks', `${where} has unknown check type "${check.type}"`);
    return { ...check };
  });
  if (!checks.some((c) => !c.judged)) {
    fail('checks', 'a deterministic check is required: judged checks alone cannot decide the verdict');
  }

  return {
    id,
    skill: raw.skill,
    package: packages[0],
    sharedPackages,
    sandboxPath,
    remote: raw.remote === true,
    branch: raw.branch,
    description: raw.description || '',
    runtimes: raw.runtimes || ['claude'],
    prompt: raw.prompt,
    invocation,
    command: raw.command,
    allowedTools: raw.allowedTools || [],
    maxTurns: raw.maxTurns,
    timeoutSec: raw.timeoutSec,
    repeats: raw.repeats,
    bar: raw.bar,
    expectInvoked: raw.expectInvoked,
    checks,
    unactedFields: UNACTED_FIELDS.filter((k) => raw[k] !== undefined),
    dir,
    fixtureDir,
  };
}

/**
 * Discover and validate every `<skillsDir>/<name>/eval.json`.
 * Returns { evals, rejected }; a rejected definition is { id, dir, error } and nothing runs for it.
 */
function loadEvalDefs({ skillsDir = SKILLS_DIR, repoRoot = REPO_ROOT } = {}) {
  const evals = [];
  const rejected = [];
  if (!fs.existsSync(skillsDir)) return { evals, rejected };
  const entries = fs.readdirSync(skillsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(skillsDir, e.name, 'eval.json')))
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const e of entries) {
    const dir = path.join(skillsDir, e.name);
    try {
      let raw;
      try {
        raw = JSON.parse(readDefinitionFile(path.join(dir, 'eval.json'), 'eval.json'));
      } catch (err) {
        throw new EvalDefinitionError(e.name, 'eval.json', /^(eval\.json) (is|cannot|is larger)/.test(err.message) ? err.message : `eval.json is not valid JSON: ${err.message}`);
      }
      evals.push(validateEvalDef(raw, dir, { repoRoot }));
    } catch (err) {
      if (!(err instanceof EvalDefinitionError)) throw err;
      rejected.push({ id: err.evalId, dir, error: err });
    }
  }
  const seen = new Set();
  return {
    evals: evals.filter((ev) => {
      if (!seen.has(ev.id)) { seen.add(ev.id); return true; }
      rejected.push({ id: ev.id, dir: ev.dir, error: new EvalDefinitionError(ev.id, 'id', 'duplicate eval id') });
      return false;
    }),
    rejected,
  };
}

/** Shape a loaded eval like a legacy scenario so the existing runner can execute it (single arm, with the skill). */
function evalToScenario(ev) {
  return {
    id: ev.id,
    type: 'agent',
    skill: ev.skill,
    description: ev.description,
    prompt: ev.invocation !== 'plain' ? `${ev.command} ${ev.prompt}` : ev.prompt,
    plugins: [...(ev.sharedPackages || []), ev.package],
    remote: ev.remote === true,
    branch: ev.branch,
    sandboxPath: ev.sandboxPath || [],
    allowedTools: ev.allowedTools,
    maxTurns: ev.maxTurns,
    timeoutSec: ev.timeoutSec,
    graders: ev.checks,
    scenarioDir: ev.dir,
  };
}

module.exports = {
  readDefinitionFile,
  EvalDefinitionError, validateEvalDef, checkSandboxPath, loadEvalDefs, findSkillPackages, evalToScenario, isJudged, SKILLS_DIR, NON_SOURCE_PACKAGES,
};
