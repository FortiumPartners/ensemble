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

const REPO_ROOT = path.resolve(__dirname, '../..');
const SKILLS_DIR = path.join(__dirname, '../skills');
// Generated or aggregate packages hold copies or symlinks of skills; the source package is the one evaluated.
const NON_SOURCE_PACKAGES = new Set(['full', 'pi', 'codex', 'opencode']);
// Validated and documented, but not yet acted on by the runner (later PRs).
const UNACTED_FIELDS = ['runtimes', 'repeats', 'bar', 'expectInvoked'];
const INVOCATIONS = ['plain', 'explicit'];
const KNOWN_KEYS = new Set([
  'id', 'skill', 'description', 'runtimes', 'prompt', 'invocation', 'command', 'allowedTools',
  'maxTurns', 'timeoutSec', 'repeats', 'bar', 'expectInvoked', 'checks',
]);

/** A rejected definition. `part` names what is wrong (task, workspace, skill, checks, or a field). */
class EvalDefinitionError extends Error {
  constructor(evalId, part, message) {
    super(`eval "${evalId}": ${message}`);
    this.name = 'EvalDefinitionError';
    this.evalId = evalId;
    this.part = part;
  }
}

const isNonEmptyString = (v) => typeof v === 'string' && v.trim() !== '';
const isPositiveInt = (v) => Number.isInteger(v) && v > 0;

/** Packages (source only) that ship a skill named `skill`, i.e. have packages/<pkg>/skills/<skill>/SKILL.md. */
function findSkillPackages(skill, repoRoot = REPO_ROOT) {
  const packagesDir = path.join(repoRoot, 'packages');
  if (!fs.existsSync(packagesDir)) return [];
  return fs.readdirSync(packagesDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !NON_SOURCE_PACKAGES.has(e.name))
    .map((e) => e.name)
    .filter((pkg) => fs.existsSync(path.join(packagesDir, pkg, 'skills', skill, 'SKILL.md')))
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

  const packages = findSkillPackages(raw.skill, repoRoot);
  if (packages.length === 0) fail('skill', `unknown skill "${raw.skill}": no SKILL.md at packages/*/skills/${raw.skill}`);

  const invocation = raw.invocation === undefined ? 'plain' : raw.invocation;
  if (!INVOCATIONS.includes(invocation)) fail('invocation', `invocation must be one of ${INVOCATIONS.join(', ')}`);
  if (invocation === 'plain' && raw.prompt.trim().startsWith('/')) {
    fail('prompt', 'prompt must be plain language, not a slash command; use `invocation: "explicit"` with `command`');
  }
  if (invocation === 'explicit' && !isNonEmptyString(raw.command)) {
    fail('command', 'invocation "explicit" requires `command` (for example "/ensemble:create-prd")');
  }
  if (raw.command !== undefined && !isNonEmptyString(raw.command)) fail('command', '`command` must be a non-empty string');

  if (raw.runtimes !== undefined && !(Array.isArray(raw.runtimes) && raw.runtimes.length > 0 && raw.runtimes.every(isNonEmptyString))) {
    fail('runtimes', '`runtimes` must be a non-empty array of runtime names');
  }
  if (raw.allowedTools !== undefined && !(Array.isArray(raw.allowedTools) && raw.allowedTools.every(isNonEmptyString))) {
    fail('allowedTools', '`allowedTools` must be an array of tool names');
  }
  for (const key of ['maxTurns', 'timeoutSec', 'repeats', 'bar']) {
    if (raw[key] !== undefined && !isPositiveInt(raw[key])) fail(key, `\`${key}\` must be a positive integer`);
  }
  if (raw.bar !== undefined && raw.bar > (raw.repeats || 5)) fail('bar', '`bar` cannot exceed `repeats`');
  if (raw.expectInvoked !== undefined && typeof raw.expectInvoked !== 'boolean') fail('expectInvoked', '`expectInvoked` must be true or false');

  const rubricFile = path.join(dir, 'rubric.md');
  const checks = raw.checks.map((check, i) => {
    const where = `checks[${i}]`;
    if (!check || typeof check !== 'object' || !isNonEmptyString(check.type)) fail('checks', `${where} must be an object with a \`type\``);
    if (isJudged(check)) {
      if (check.type !== 'judge') fail('checks', `${where} is judged: its type must be "judge", not "${check.type}"`);
      const rubric = isNonEmptyString(check.rubric) ? check.rubric
        : (fs.existsSync(rubricFile) ? fs.readFileSync(rubricFile, 'utf8') : '');
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
        raw = JSON.parse(fs.readFileSync(path.join(dir, 'eval.json'), 'utf8'));
      } catch (err) {
        throw new EvalDefinitionError(e.name, 'eval.json', `eval.json is not valid JSON: ${err.message}`);
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
    prompt: ev.invocation === 'explicit' ? `${ev.command} ${ev.prompt}` : ev.prompt,
    plugins: [ev.package],
    allowedTools: ev.allowedTools,
    maxTurns: ev.maxTurns,
    timeoutSec: ev.timeoutSec,
    graders: ev.checks,
    scenarioDir: ev.dir,
  };
}

module.exports = {
  EvalDefinitionError, validateEvalDef, loadEvalDefs, findSkillPackages, evalToScenario, isJudged, SKILLS_DIR,
};
