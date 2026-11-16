'use strict';

/**
 * Run outcome from grader results. Deterministic checks alone decide the verdict; judged checks
 * (`judged: true`) are reported separately as a score and never change it.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const os = require('os');
const crypto = require('crypto');
const envlib = require('./env');
const hash = require('./hash');
const { supportedRuntimes } = require('./runners');

/** `{ pass, verdict, judgedScore, judgeModel }` for a list of grader results. */
function summarizeRun(graders) {
  const deterministic = graders.filter((g) => !g.judged);
  const judged = graders.filter((g) => g.judged);
  const scores = judged.filter((g) => typeof g.score === 'number').map((g) => g.score);
  const pass = deterministic.length > 0 && deterministic.every((g) => g.pass);
  const judgeModel = (judged.find((g) => g.judgeModel) || {}).judgeModel || null;
  return {
    pass,
    verdict: pass ? 'pass' : 'fail',
    judgedScore: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null,
    judgeModel,
  };
}

/**
 * Which copy was evaluated: the package directory loaded as the plugin (never a copy), the skill's content hash,
 * and whether the working tree differs from the committed copy (`git status --porcelain` on the package and on every shared package: the
 * whole package is loaded, so an edit anywhere in it counts). `workingTreeDiffers` is null when the repository
 * is not a git checkout. The installed (marketplace) copy is not inspected.
 */
function evaluatedCopy({ repoRoot, packageName, skill, sharedPackages = [] }) {
  const packagePath = path.join(repoRoot, 'packages', packageName);
  const skillDir = path.join(packagePath, 'skills', skill);
  const git = (args) => spawnSync('git', [...envlib.GIT_HARDEN, '-C', repoRoot, ...args], { encoding: 'utf8', env: envlib.gitEnv() });
  let workingTreeDiffers = null;
  let changedFiles = [];
  const inside = git(['rev-parse', '--is-inside-work-tree']);
  if (inside.status === 0 && inside.stdout.trim() === 'true') {
    // Every package whose content is evaluated (the skill's own and each shared one): packageHash folds them all, so the status must too.
    const names = [packageName, ...sharedPackages];
    const lines = [];
    let ok = true;
    for (const n of names) {
      const rel = path.relative(repoRoot, path.join(repoRoot, 'packages', n));
      const st = git(['status', '--porcelain', '--untracked-files=all', '--', rel]);
      if (st.status !== 0) { ok = false; break; }
      for (const l of st.stdout.split('\n').filter(Boolean)) lines.push(l.slice(3)); // repo-relative, so it names the package (packages/<n>/...)
    }
    if (ok) {
      changedFiles = lines;
      workingTreeDiffers = changedFiles.length > 0;
    }
  }
  return {
    packagePath: path.relative(repoRoot, packagePath),
    // The whole package (Claude loads all of it). With `sharedPackages` it is one hash over the package and every shared package (name and
    // content hash, in order), so a change to a shared package invalidates cached and committed results like a change to the skill's own.
    packageHash: sharedPackages.length === 0 ? hash.packageHash(packagePath)
      : crypto.createHash('sha256').update([packageName, ...sharedPackages].map((n) => `${n}:${hash.packageHash(path.join(repoRoot, 'packages', n))}\n`).join('')).digest('hex'),
    skillHash: hash.skillHash(skillDir), // throws HashError naming the problem (missing skill directory, escaping symlink)
    skillVersion: hash.skillVersion(skillDir),
    workingTreeDiffers,
    changedFiles: changedFiles.slice(0, 20),
  };
}

/** One line stating the evaluated copy. */
function describeCopy(c) {
  const tree = c.workingTreeDiffers === null ? 'working tree vs committed: unknown (not a git checkout)'
    : c.workingTreeDiffers ? `working tree DIFFERS from the committed copy (${c.changedFiles.length} changed file(s))` : 'working tree matches the committed copy';
  return `${c.packagePath} (loaded as shipped) skillHash=${c.skillHash ? c.skillHash.slice(0, 12) : 'n/a'}${c.skillVersion ? ` version=${c.skillVersion}` : ''}; ${tree}`;
}

// ---------------------------------------------------------------------------------------------------------------
// Result schema (TRD-014)
// ---------------------------------------------------------------------------------------------------------------

const SKILL_NAME = /^[A-Za-z0-9._-]+$/;
const isSkillName = (v) => typeof v === 'string' && SKILL_NAME.test(v) && v !== '.' && v !== '..';
const OUTCOMES = ['pass', 'fail', 'timed_out', 'incomplete'];
const ARM_NAMES = ['with-skill', 'baseline'];
const INVOCATION_MODES = ['plain', 'explicit', 'explicit-both'];

/** Uplift granularity per runtime (TRD design decision: Claude loads a whole package, Pi a single skill). */
const GRANULARITY = { claude: 'package', pi: 'skill' };
const UPLIFT_LABELS = { claude: 'package-level (skills share a package)', pi: 'skill-level' };
const GRANULARITY_LABELS = { package: UPLIFT_LABELS.claude, skill: UPLIFT_LABELS.pi };

/**
 * Uplift label for a runtime. When the with-skill arm adds more than the skill's own package contents relative to the baseline
 * (an eval with `sharedPackages`: both arms load the shared packages, the with-skill arm adds the skill's whole package, which may
 * hold the toolchain the run needs), the label names what is added, so the number is not read as the skill's own effect.
 */
function upliftLabelFor(runtime, withSkillAdds) {
  const base = UPLIFT_LABELS[runtime] || 'unknown granularity';
  return runtime === 'claude' && Array.isArray(withSkillAdds) && withSkillAdds.length > 0 ? `package-level (with-skill adds ${withSkillAdds.join(', ')})` : base;
}

class ResultError extends Error {
  constructor(message) { super(message); this.name = 'ResultError'; }
}

/** Runtime name checked against the registered runners; an unknown one is a named error. */
function assertRuntime(runtime, what = 'runtime') {
  if (typeof runtime !== 'string' || !supportedRuntimes().includes(runtime)) {
    throw new ResultError(`unknown ${what} "${String(runtime).slice(0, 60)}" (supported: ${supportedRuntimes().join(', ')})`);
  }
  return runtime;
}

/** `package` for Claude, `skill` for Pi; throws for any other runtime (never a default). */
function granularityFor(runtime) {
  assertRuntime(runtime);
  if (!GRANULARITY[runtime]) throw new ResultError(`no uplift granularity is defined for runtime "${runtime}"`);
  return GRANULARITY[runtime];
}

const escapeRe = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const IDENTIFIER = /^[A-Za-z0-9._:-]+$/;

/**
 * Remove what must not be stored: credential values (redactDeep) and the author's machine identity. The repository root
 * (as given and as its realpath) becomes `<repo>`, a home directory (as given and realpath) `~`; `/Users/<name>`,
 * `/home/<name>`, `/root` and Windows `C:\Users\<name>` paths become `~`; the OS user name and the host name (and its short
 * form) become `<user>` and `<host>` when they appear as a path component or a word and are at least 4 characters long.
 */
function sanitize(value, { secrets = [], repoRoot } = {}) {
  const real = (p) => { try { return fs.realpathSync(p); } catch { return null; } };
  const home = os.homedir();
  const roots = [];
  const addRoot = (r, label) => { if (typeof r === 'string' && r.length > 1) roots.push([r, label]); };
  addRoot(repoRoot, '<repo>'); addRoot(repoRoot && real(repoRoot), '<repo>');
  addRoot(home, '~'); addRoot(home && real(home), '~');
  roots.sort((x, y) => y[0].length - x[0].length);
  const words = [];
  try { const u = os.userInfo().username; if (typeof u === 'string' && u.length >= 4) words.push([u, '<user>']); } catch { /* no user entry */ }
  try {
    const h = os.hostname();
    for (const n of new Set([h, String(h).split('.')[0]])) if (typeof n === 'string' && n.length >= 4) words.push([n, '<host>']);
  } catch { /* no host name */ }
  const wordRes = words.map(([w, label]) => [new RegExp(`(?<![\\w.-])${escapeRe(w)}(?![\\w.-])`, 'g'), label]);
  const scrub = (str) => {
    let t = str;
    for (const [r, label] of roots) t = t.split(r).join(label);
    t = t.replace(/[A-Za-z]:[\\/]+Users[\\/]+[^\\/\s"']+/gi, '~')
      .replace(/\/(?:Users|home)\/[^/\s"'\\]+/g, '~')
      .replace(/(?<![\w.-])\/root(?=[/\s"'\\]|$)/g, '~');
    // An identifier (skill, eval id, model, hash) is never reworded: a user or host name that equals a token of it
    // (`runner` in `test-runner`) would corrupt a name the store must read back.
    if (!IDENTIFIER.test(t)) for (const [re, label] of wordRes) t = t.replace(re, label);
    return t;
  };
  const walk = (v) => {
    if (typeof v === 'string') return scrub(v);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [scrub(k), walk(x)]));
    return v;
  };
  return walk(envlib.redactDeep(value, secrets));
}

// ---------------------------------------------------------------------------------------------------------------
// Replay handle (TRD-020)
// ---------------------------------------------------------------------------------------------------------------

const REPLAY_PREFIX = 'node evals/run.js';
// What may appear in a replay value: ids, model names (`provider/id`, `id[1m]`, `id:thinking`) and numbers. Quoted anyway.
const REPLAY_VALUE = /^[A-Za-z0-9._:/@+=[\]-]{1,200}$/;

/** POSIX single-quote quoting: the value is one literal word whatever it contains. */
function shellQuote(v) {
  return `'${String(v).replace(/'/g, `'\\''`)}'`;
}

/**
 * The command that reruns exactly one run: same eval, runtime, model (as requested), arm, repeat index and settings
 * (repeats, timeout, per-run budget, judge). Every value is validated against REPLAY_VALUE and single-quoted; a value
 * that does not validate gives `null` (no command rather than an unsafe one). Relative to the repository root, no environment
 * variables, no machine paths, no credentials. `--run-index` makes run.js run only that run, fresh, without cache reuse or
 * a baseline write; `--refresh` is printed too so the intent is visible.
 * spec: { evalId, runtime, model?, arm?, run?, repeats?, timeoutSec?, runUsd?, judgeModel?, judgeUsd? }
 */
function replayCommand(spec) {
  const flags = [['--scenario', spec.evalId], ['--runtime', spec.runtime]];
  if (spec.model) flags.push(['--model', spec.model]);
  if (spec.arm) flags.push(['--arm', spec.arm], ['--run-index', spec.run], ['--repeats', spec.repeats]);
  if (spec.timeoutSec !== undefined && spec.timeoutSec !== null) flags.push(['--timeout', spec.timeoutSec]);
  if (spec.runUsd !== undefined && spec.runUsd !== null) flags.push(['--run-usd', spec.runUsd]);
  if (spec.judgeModel) flags.push(['--judge-model', spec.judgeModel]);
  if (spec.judgeUsd !== undefined && spec.judgeUsd !== null) flags.push(['--judge-usd', spec.judgeUsd]);
  for (const [, v] of flags) if (v === undefined || v === null || !REPLAY_VALUE.test(String(v))) return null;
  return `${REPLAY_PREFIX} ${flags.map(([f, v]) => `${f} ${shellQuote(v)}`).join(' ')} --refresh`;
}

const present = (o, k) => Object.prototype.hasOwnProperty.call(o, k) && o[k] !== undefined;
const nonEmpty = (v) => typeof v === 'string' && v.trim() !== '';
// Terminal control characters (C0 except tab/newline, DEL, C1): an escape sequence in a stored value would be printed to a console.
const CONTROL_ANY_RE = /[\u0000-\u001f\u007f-\u009f]/;
const stripControl = (t) => String(t).replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, '');
/** A non-empty string with no control character at all (identifiers printed on a console: model, eval version, eval id, judge model). */
const cleanId = (v) => nonEmpty(v) && !CONTROL_ANY_RE.test(v);
/** ISO-8601 UTC timestamp as `Date#toISOString` writes it; anything else (including text Date.parse tolerates) is refused. */
const ISO_UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const isIsoTimestamp = (v) => typeof v === 'string' && ISO_UTC_RE.test(v) && !Number.isNaN(Date.parse(v));

/**
 * Validate a stored per-run record. Throws ResultError naming `source` and the first missing or malformed field.
 * `skillVersion` and `judgeModel` may be null (no metadata.version, no judge) but the key must be present.
 */
function validateResult(r, source = 'result') {
  const bad = (field, why) => { throw new ResultError(`${source}: ${why} field "${field}"`); };
  if (!r || typeof r !== 'object' || Array.isArray(r)) throw new ResultError(`${source}: a result must be a JSON object`);
  for (const k of ['evalId', 'skill', 'skillVersion', 'skillHash', 'evalVersion', 'runtime', 'model', 'arm', 'invocationMode', 'run', 'outcome', 'invoked', 'costUsd', 'durationMs', 'graders', 'replay', 'judgeModel']) {
    if (!present(r, k)) bad(k, 'missing');
  }
  if (!cleanId(r.evalId)) bad('evalId', 'invalid');
  if (!isSkillName(r.skill)) bad('skill', 'invalid');
  if (r.skillVersion !== null && !nonEmpty(r.skillVersion)) bad('skillVersion', 'invalid');
  if (!nonEmpty(r.skillHash)) bad('skillHash', 'invalid');
  if (!cleanId(r.evalVersion)) bad('evalVersion', 'invalid');
  if (!supportedRuntimes().includes(r.runtime)) bad('runtime', 'unknown value in');
  if (!cleanId(r.model)) bad('model', 'invalid');
  if (!ARM_NAMES.includes(r.arm)) bad('arm', 'invalid');
  if (!INVOCATION_MODES.includes(r.invocationMode)) bad('invocationMode', 'invalid');
  if (!Number.isInteger(r.run) || r.run < 1) bad('run', 'invalid');
  if (!OUTCOMES.includes(r.outcome)) bad('outcome', 'invalid');
  if (r.invoked !== null && typeof r.invoked !== 'boolean') bad('invoked', 'invalid');
  if (r.costUsd !== null && !(typeof r.costUsd === 'number' && Number.isFinite(r.costUsd) && r.costUsd >= 0)) bad('costUsd', 'invalid');
  if (r.durationMs !== null && !(typeof r.durationMs === 'number' && Number.isFinite(r.durationMs) && r.durationMs >= 0)) bad('durationMs', 'invalid');
  if (!Array.isArray(r.graders)) bad('graders', 'invalid');
  if (r.replay !== null && (typeof r.replay !== 'object' || Array.isArray(r.replay))) bad('replay', 'invalid');
  if (r.replay && present(r.replay, 'command') && !(typeof r.replay.command === 'string' && r.replay.command.length <= 2000 && r.replay.command.startsWith(`${REPLAY_PREFIX} `))) bad('replay.command', 'invalid');
  if (present(r, 'cached') && typeof r.cached !== 'boolean') bad('cached', 'invalid');
  if (r.judgeModel !== null && !cleanId(r.judgeModel)) bad('judgeModel', 'invalid');
  return r;
}

/**
 * The stored record for one executed run. `run` is the per-run result run.js produced (evalId, arm, run, runtime, model,
 * invocationMode, outcome, invoked, costUsd, durationMs, graders, judgeModel); `ctx` = { skill, skillVersion, skillHash, evalVersion }.
 * The pipeline's `unverifiable` and `aborted` outcomes are stored as `incomplete` with `incompleteReason`: neither is a
 * pass or a fail, and neither counts toward reliability. Any other outcome value is an error.
 */
function buildResult(run, ctx) {
  const stored = { pass: 'pass', fail: 'fail', timed_out: 'timed_out', incomplete: 'incomplete', unverifiable: 'incomplete', aborted: 'incomplete' };
  const outcome = stored[run.outcome];
  if (!outcome) throw new ResultError(`run ${run.evalId || '?'}: unknown outcome "${String(run.outcome).slice(0, 40)}"`);
  const rec = {
    evalId: run.evalId,
    skill: ctx.skill,
    skillVersion: ctx.skillVersion === undefined ? null : ctx.skillVersion,
    skillHash: ctx.skillHash,
    evalVersion: ctx.evalVersion,
    runtime: run.runtime,
    model: run.model,
    arm: run.arm,
    invocationMode: run.invocationMode,
    run: run.run,
    outcome,
    ...(outcome === 'incomplete' && { incompleteReason: run.outcome === 'incomplete' ? (run.incompleteReason || run.skipped || 'not run') : run.outcome }),
    invoked: typeof run.invoked === 'boolean' ? run.invoked : null,
    costUsd: typeof run.costUsd === 'number' ? run.costUsd : null,
    ...(run.costEstimated && { costEstimated: true }),
    durationMs: typeof run.durationMs === 'number' ? run.durationMs : null,
    graders: (run.graders || []).map((g) => ({ type: g.type, pass: g.pass, ...(g.judged && { judged: true }), ...(g.score !== undefined && { score: g.score }), detail: g.detail })),
    judgeModel: run.judgeModel || null,
    // `ctx.replay` = the run-independent part of the replay spec (requested model, settings); the command is built per run.
    replay: (() => {
      const handle = { evalId: run.evalId, skill: ctx.skill, runtime: run.runtime, model: run.model, arm: run.arm, run: run.run };
      if (!ctx.replay) return handle;
      const command = replayCommand({ ...ctx.replay, evalId: run.evalId, runtime: run.runtime, arm: run.arm, run: run.run });
      return { ...handle, requestedModel: ctx.replay.model || null, settings: ctx.replay.settings || null, ...(command && { command }) };
    })(),
    ...(run.cached && { cached: true }),
  };
  return validateResult(rec, `run ${run.evalId} ${run.arm} #${run.run}`);
}

/** Parse a JSON file; the error names the file. */
function readJson(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { throw new ResultError(`${path.basename(file)}: cannot read (${e.code || e.message})`); }
  try { return JSON.parse(text); } catch (e) { throw new ResultError(`${path.basename(file)}: not valid JSON (${e.message})`); }
}

/** Read one stored per-run result file; rejected naming the file and the field when anything a comparison needs is missing. */
function readResult(file) {
  return validateResult(readJson(file), path.basename(file));
}

/** Read every record of a stored suite log (`records` in evals/results/*.json), validating each. */
function readRecords(file) {
  const doc = readJson(file);
  if (!doc || !Array.isArray(doc.records)) throw new ResultError(`${path.basename(file)}: no "records" array`);
  return doc.records.map((r, i) => validateResult(r, `${path.basename(file)} records[${i}]`));
}

// ---------------------------------------------------------------------------------------------------------------
// Baseline summaries (TRD-015)
// ---------------------------------------------------------------------------------------------------------------

const BASELINES_DIR = path.join(__dirname, '..', 'baselines');

class BaselineError extends Error {
  constructor(message) { super(message); this.name = 'BaselineError'; }
}

/** `<baselinesDir>/<runtime>/<skill>.json`, with the runtime and skill validated and the path kept inside `baselinesDir`. */
function baselinePath(baselinesDir, runtime, skill) {
  assertRuntime(runtime);
  if (!isSkillName(skill)) throw new BaselineError(`invalid skill name "${String(skill).slice(0, 60)}": only letters, digits, ".", "_" and "-"`);
  const root = path.resolve(baselinesDir);
  const file = path.resolve(root, runtime, `${skill}.json`);
  if (!file.startsWith(root + path.sep)) throw new BaselineError(`baseline path for "${skill}" escapes the baselines directory`);
  return file;
}

const arm = (v) => v && Number.isInteger(v.passes) && Number.isInteger(v.runs) && v.passes >= 0 && v.runs >= 1 && v.runs >= v.passes;

/** The model recorded when no run reported one; it is comparable to nothing, itself included. */
const UNKNOWN_MODEL = 'unknown';

/** Validate a baseline summary object (from disk or about to be written). Throws BaselineError naming `source` and the field. */
function validateBaseline(b, source = 'baseline') {
  const bad = (field, why = 'invalid') => { throw new BaselineError(`${source}: ${why} field "${field}"`); };
  if (!b || typeof b !== 'object' || Array.isArray(b)) throw new BaselineError(`${source}: a baseline summary must be a JSON object`);
  for (const k of ['skill', 'skillVersion', 'skillHash', 'evalVersion', 'model', 'runtime', 'granularity', 'repeats', 'bar', 'withSkill', 'baseline', 'reliable', 'uplift', 'recordedAt']) {
    if (!present(b, k)) bad(k, 'missing');
  }
  if (!isSkillName(b.skill)) bad('skill');
  if (b.skillVersion !== null && !nonEmpty(b.skillVersion)) bad('skillVersion');
  if (!nonEmpty(b.skillHash)) bad('skillHash');
  if (!cleanId(b.evalVersion)) bad('evalVersion');
  if (!cleanId(b.model)) bad('model');
  if (!supportedRuntimes().includes(b.runtime)) bad('runtime', 'unknown value in');
  if (b.granularity !== GRANULARITY[b.runtime]) bad('granularity', `granularity "${String(b.granularity)}" does not match runtime ${b.runtime} (expected ${GRANULARITY[b.runtime]}) in`);
  // packageHash: the whole package Claude loads. Required for package granularity; informational (may be absent) for skill granularity.
  if (b.granularity === 'package' && !present(b, 'packageHash')) bad('packageHash', 'missing');
  if (present(b, 'packageHash') && !nonEmpty(b.packageHash) && !(b.granularity === 'skill' && b.packageHash === null)) bad('packageHash');
  if (present(b, 'withSkillAdds') && !(Array.isArray(b.withSkillAdds) && b.withSkillAdds.length > 0 && b.withSkillAdds.every(isSkillName))) bad('withSkillAdds');
  if (!Number.isInteger(b.repeats) || b.repeats < 1) bad('repeats');
  if (!Number.isInteger(b.bar) || b.bar < 1 || b.bar > b.repeats) bad('bar', 'bar exceeds repeats or is not a positive integer in');
  if (!arm(b.withSkill)) bad('withSkill');
  if (!arm(b.baseline)) bad('baseline');
  if (b.withSkill.runs !== b.repeats) bad('withSkill.runs', `runs differ from repeats (${b.repeats}) in`);
  if (b.baseline.runs !== b.repeats) bad('baseline.runs', `runs differ from repeats (${b.repeats}) in`);
  if (typeof b.reliable !== 'boolean') bad('reliable');
  if (b.reliable !== (b.withSkill.passes >= b.bar)) bad('reliable', `value contradicts withSkill.passes (${b.withSkill.passes}) against bar (${b.bar}) in`);
  if (!(typeof b.uplift === 'number' && Number.isFinite(b.uplift))) bad('uplift');
  const expected = b.withSkill.passes / b.withSkill.runs - b.baseline.passes / b.baseline.runs;
  if (Math.abs(b.uplift - expected) > 1e-9) bad('uplift', `value ${b.uplift} contradicts the arm counts (expected ${expected}) in`);
  if (!isIsoTimestamp(b.recordedAt)) bad('recordedAt');
  return b;
}

/**
 * The single model id the runs of an eval reported, else `unknown` (none reported, or runs reported different models).
 * `runs` are per-run results carrying `model`.
 */
function evalModel(runs) {
  const seen = new Set((runs || []).map((r) => r && r.model).filter((m) => nonEmpty(m) && m !== UNKNOWN_MODEL));
  return seen.size === 1 ? [...seen][0] : UNKNOWN_MODEL;
}

/**
 * The baseline summary for a finished eval (`evalResult` from arms.summarizeEval), or a BaselineError saying why there
 * is nothing to commit: an incomplete, aborted or partly unverifiable eval is never stored as a baseline (it would
 * overwrite a committed one with a number it cannot stand behind).
 * ctx: { skillHash, packageHash, skillVersion, evalVersion, model, recordedAt? }.
 */
function toBaselineSummary(evalResult, ctx) {
  const e = evalResult;
  const why = (m) => { throw new BaselineError(`eval "${e.id}": no baseline summary: ${m}`); };
  if (e.abort) why('its baseline arm aborted');
  if (!e.withSkill || !e.baseline) why('an arm has no result');
  if (e.outcome === 'incomplete' || e.reliable === null) why('the eval is incomplete');
  if (e.providerErrors > 0) why(`${e.providerErrors} run(s) hit a provider error, so the arms did not both run ${e.repeats} times`);
  if (e.withSkill.notRun > 0 || e.baseline.notRun > 0) why('not every planned run executed');
  if (e.baseline.unverifiable > 0 || e.withSkill.unverifiable > 0) why('a run was unverifiable and is not counted');
  if (typeof e.uplift !== 'number') why('uplift could not be computed');
  const pick = (a) => ({ passes: a.passes, runs: a.runs });
  return validateBaseline({
    skill: e.skill,
    skillVersion: ctx.skillVersion === undefined ? null : ctx.skillVersion,
    skillHash: ctx.skillHash,
    ...(ctx.packageHash !== undefined && { packageHash: ctx.packageHash }),
    ...(Array.isArray(e.withSkillAdds) && e.withSkillAdds.length > 0 && { withSkillAdds: e.withSkillAdds }),
    evalVersion: ctx.evalVersion,
    model: ctx.model,
    runtime: e.runtime,
    granularity: granularityFor(e.runtime),
    repeats: e.repeats,
    bar: e.bar,
    withSkill: pick(e.withSkill),
    baseline: pick(e.baseline),
    reliable: e.reliable,
    uplift: e.uplift,
    recordedAt: ctx.recordedAt || new Date().toISOString(),
  }, `eval "${e.id}" baseline`);
}

/**
 * What the regression check compares when a provider error means no baseline summary can exist: only a with-skill arm that is
 * already decidedly unreliable (a determined fail) has something to compare, and it is never written. The uplift is undetermined (null).
 */
function toRegressionProbe(e, ctx) {
  const why = (m) => { throw new BaselineError(`eval "${e.id}": no regression check: ${m}`); };
  if (e.abort || !e.withSkill) why('its baseline arm aborted or an arm has no result');
  if (e.reliable !== false) why(`${e.providerErrors} run(s) hit a provider error and the with-skill verdict is not a determined fail`);
  if (!(e.withSkill.runs > 0)) why('no with-skill run executed');
  return {
    skill: e.skill, skillVersion: ctx.skillVersion === undefined ? null : ctx.skillVersion, skillHash: ctx.skillHash,
    ...(ctx.packageHash !== undefined && { packageHash: ctx.packageHash }),
    evalVersion: ctx.evalVersion, model: ctx.model, runtime: e.runtime, granularity: granularityFor(e.runtime),
    repeats: e.repeats, bar: e.bar, withSkill: { passes: e.withSkill.passes, runs: e.withSkill.runs }, reliable: false, uplift: null,
  };
}

const MAX_BASELINE_BYTES = 1024 * 1024;

/**
 * lstat a baselines directory (the root or a runtime directory). Returns false when it does not exist; a symlink or a
 * non-directory is a named BaselineError (a symlinked directory could redirect a write outside the baselines tree).
 */
function checkDir(dir, what, Err = BaselineError) {
  let st;
  try { st = fs.lstatSync(dir); } catch (e) {
    if (e.code === 'ENOENT') return false;
    throw new Err(`${what}: cannot inspect (${e.code || e.message})`);
  }
  if (st.isSymbolicLink()) throw new Err(`${what} is a symlink: refusing to follow it`);
  if (!st.isDirectory()) throw new Err(`${what} is not a directory`);
  return true;
}

/** lstat a baseline file: false when absent; a symlink or non-regular file (FIFO, device, directory) or one over the size cap is a named error. */
function checkFile(file, Err = BaselineError, maxBytes = MAX_BASELINE_BYTES) {
  let st;
  try { st = fs.lstatSync(file); } catch (e) {
    if (e.code === 'ENOENT') return false;
    throw new Err(`${path.basename(file)}: cannot inspect (${e.code || e.message})`);
  }
  if (st.isSymbolicLink()) throw new Err(`${path.basename(file)} is a symlink: refusing to follow it`);
  if (!st.isFile()) throw new Err(`${path.basename(file)} is not a regular file`);
  if (st.size > maxBytes) throw new Err(`${path.basename(file)} is larger than ${maxBytes} bytes: refusing to read it`);
  return true;
}

/**
 * Text of a regular file within the size cap, opened without following a link and without blocking on a FIFO
 * (O_NOFOLLOW | O_NONBLOCK, then fstat on the descriptor). Every failure is an `Err` naming the file.
 */
function readStoreText(file, Err = BaselineError, maxBytes = MAX_BASELINE_BYTES) {
  try {
    const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0));
    try {
      const st = fs.fstatSync(fd);
      if (!st.isFile() || st.size > maxBytes) throw new Err(`${path.basename(file)} is not a regular file within the size cap`);
      return fs.readFileSync(fd, 'utf8');
    } finally { fs.closeSync(fd); }
  } catch (e) {
    if (e instanceof Err) throw e;
    throw new Err(`${path.basename(file)}: cannot read (${e.code || e.message})`);
  }
}

/** Write `text` to `file` through an exclusive-create temp file in the same (already verified) directory, then an atomic rename. */
function atomicWrite(file, text, tmpTag) {
  const tmp = path.join(path.dirname(file), `.${tmpTag}.${process.pid}.${Date.now()}.tmp`);
  try {
    const fd = fs.openSync(tmp, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o644);
    try { fs.writeFileSync(fd, text); } finally { fs.closeSync(fd); }
    fs.renameSync(tmp, file);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch { /* already gone */ }
    throw e;
  }
}

/** Write the summary to `<baselinesDir>/<runtime>/<skill>.json` (sanitized first); returns the file path. */
function writeBaseline(baselinesDir, summary, { secrets = [], repoRoot } = {}) {
  validateBaseline(summary, `baseline for ${summary && summary.skill}`);
  const file = baselinePath(baselinesDir, summary.runtime, summary.skill);
  const clean = sanitize(summary, { secrets, repoRoot });
  const text = `${JSON.stringify(validateBaseline(clean, 'sanitized baseline'), null, 2)}\n`;
  const root = path.resolve(baselinesDir);
  const dir = path.dirname(file);
  if (!checkDir(root, 'baselines root')) fs.mkdirSync(root, { recursive: true });
  checkDir(root, 'baselines root');
  if (!checkDir(dir, `baselines ${summary.runtime} directory`)) fs.mkdirSync(dir);
  checkDir(dir, `baselines ${summary.runtime} directory`);
  checkFile(file);
  atomicWrite(file, text, summary.skill);
  return file;
}

/** Read and validate one baseline summary file (never through a symlink; regular files up to a size cap); a mismatch with its path is an error. */
function readBaseline(file) {
  if (!checkFile(file)) throw new BaselineError(`${path.basename(file)}: cannot read (ENOENT)`);
  const text = readStoreText(file);
  let doc;
  try { doc = JSON.parse(text); } catch (e) { throw new BaselineError(`${path.basename(file)}: not valid JSON (${e.message})`); }
  const b = validateBaseline(doc, path.basename(file));
  if (path.basename(file) !== `${b.skill}.json` || path.basename(path.dirname(file)) !== b.runtime) {
    throw new BaselineError(`${path.basename(file)}: summary is for ${b.runtime}/${b.skill} but is stored at a different path`);
  }
  return b;
}

/** The committed summary for runtime/skill, or null when no file exists; any file that exists must be valid (else it throws). A symlink anywhere on the path is an error. */
function loadBaseline(baselinesDir, runtime, skill) {
  const file = baselinePath(baselinesDir, runtime, skill);
  if (!checkDir(path.resolve(baselinesDir), 'baselines root')) return null;
  if (!checkDir(path.dirname(file), `baselines ${runtime} directory`)) return null;
  if (!checkFile(file)) return null;
  return readBaseline(file);
}

/** Every baseline summary under `baselinesDir` (runtime directories of valid names only); a symlink, a special file or one corrupt file throws. */
function loadAllBaselines(baselinesDir) {
  const root = path.resolve(baselinesDir);
  if (!checkDir(root, 'baselines root')) return [];
  const out = [];
  for (const e of fs.readdirSync(root, { withFileTypes: true }).sort((x, y) => (x.name < y.name ? -1 : 1))) {
    if (e.isSymbolicLink()) throw new BaselineError(`baselines/${e.name} is a symlink: refusing to follow it`);
    if (!e.isDirectory()) continue;
    assertRuntime(e.name, 'runtime directory');
    const dir = path.join(root, e.name);
    checkDir(dir, `baselines ${e.name} directory`);
    for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.json')).sort()) out.push(readBaseline(path.join(dir, f)));
  }
  return out;
}

/**
 * Compare a fresh summary with the committed one. status: `not-comparable` (runtime, model, eval version or repeats differ, or either
 * model is `unknown`: said, never passed), `regression` (the committed summary was reliable and the new one is not), else `ok`.
 * Like-for-like is TRD-019's key: same runtime, model and eval version (and repeats, which the bar depends on). A changed skill
 * or package content is NOT a reason to refuse the comparison: the skill changing is exactly what a regression check is for
 * (a deliberately broken skill must be able to fail the gate, AC-018-2). The change is reported in `notes` instead.
 * Comparable results (`ok`, `regression`) carry `delta`: the with-skill rate and the uplift, committed and now.
 */
function compareSummaries(committed, current) {
  const reasons = [];
  for (const k of ['runtime', 'model', 'evalVersion', 'repeats']) {
    if (committed[k] !== current[k]) reasons.push(`${k} differs (committed ${committed[k]}, now ${current[k]})`);
  }
  if (committed.model === UNKNOWN_MODEL || current.model === UNKNOWN_MODEL) reasons.push('model is unknown: an unknown model is not comparable to anything, itself included');
  if (reasons.length) return { status: 'not-comparable', reasons };
  const notes = [];
  if (committed.skillHash !== current.skillHash) notes.push('skill content changed since the committed summary');
  if (committed.granularity === 'package' && current.granularity === 'package' && committed.packageHash !== current.packageHash) notes.push('package content changed since the committed summary');
  if (committed.skillVersion !== current.skillVersion) notes.push(`skill version differs (committed ${committed.skillVersion}, now ${current.skillVersion})`);
  const wr = (b) => b.withSkill.passes / b.withSkill.runs;
  const delta = {
    withSkillRate: { committed: wr(committed), current: wr(current), change: wr(current) - wr(committed) },
    uplift: { committed: committed.uplift, current: current.uplift, change: typeof current.uplift === 'number' ? current.uplift - committed.uplift : null },
  };
  if (committed.reliable && !current.reliable) {
    return { status: 'regression', reasons: [`was reliable (${committed.withSkill.passes}/${committed.withSkill.runs}, bar ${committed.bar}), now ${current.withSkill.passes}/${current.withSkill.runs}`], notes, delta };
  }
  return { status: 'ok', reasons: [], notes, delta };
}

/**
 * Regression check of a finished eval against the committed file under `baselinesDir`. status: `no-baseline`, `incomplete`
 * (the new result cannot be summarized: never a pass), or the compareSummaries verdict. A corrupt committed file throws.
 */
function checkAgainstBaseline(baselinesDir, evalResult, ctx) {
  const committed = loadBaseline(baselinesDir, evalResult.runtime, evalResult.skill);
  if (!committed) return { status: 'no-baseline', reasons: ['no committed summary'] };
  let current;
  try { current = evalResult.providerErrors > 0 ? toRegressionProbe(evalResult, ctx) : toBaselineSummary(evalResult, ctx); } catch (e) {
    if (!(e instanceof BaselineError)) throw e;
    return { status: 'incomplete', reasons: [e.message] };
  }
  return { ...compareSummaries(committed, current), committed };
}

module.exports = {
  summarizeRun, evaluatedCopy, describeCopy,
  hashDir: hash.hashTree, skillVersion: hash.skillVersion,
  GRANULARITY, UPLIFT_LABELS, GRANULARITY_LABELS, upliftLabelFor, OUTCOMES, ARM_NAMES, BASELINES_DIR, SKILL_NAME, isSkillName,
  ResultError, BaselineError, UNKNOWN_MODEL, evalModel, MAX_BASELINE_BYTES, assertRuntime, granularityFor, sanitize,
  validateResult, buildResult, readResult, readRecords,
  baselinePath, validateBaseline, toBaselineSummary, writeBaseline, readBaseline, loadBaseline, loadAllBaselines, compareSummaries, checkAgainstBaseline,
  stripControl, cleanId, isIsoTimestamp, checkDir, checkFile, readStoreText, atomicWrite, replayCommand, shellQuote,
};

