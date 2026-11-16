'use strict';

/**
 * Skill eval kit: the test helper every `evals/tests/skills/<skill>.test.js` uses. Not a test file (jest does not match its name).
 * It runs the REAL pieces and fakes only the model: the real eval.json (loadEvalDefs), a real sandbox built from its fixture the way
 * the harness builds one (createSandbox, including `remote` and `branch`), the real deterministic checks through the real grader code
 * (runGraders) with the harness's check environment (no credentials, a throwaway HOME, no `sandboxPath`). The "agent" is a function
 * the test passes: it writes the files a good or a bad run would leave. No model, no network, no real tool is ever called.
 *
 *   const kit = require('../skill-eval-kit');
 *   kit.loadsClean(id)                              -> ev        eval loads, fixture holds no agent/git configuration
 *   await kit.runEval(id, agent)                    -> { checkId: { pass, detail } }
 *   kit.expectAllPass(result)                       every check passed (reports the failing ids and their details)
 *   kit.expectFails(result, which, detailMatch?)    `which` (id or ids) failed; optional RegExp on the detail; `{ only: true }` as 4th arg: nothing else failed
 *   await kit.armsFor(id)                           -> { baseline, withSkill }   argv of both arms through run.js and a stub `claude`
 *
 * `agent(ws)` gets { id, ev, dir, root, write(rel, text), read(rel), exists(rel), remove(rel), sb } and may be async; `dir` is the
 * workspace (the agent's cwd), `root` its parent (where a stub that logs outside the project writes, as pr-merge-trace's gh stub does).
 * It may return { transcript, commands } to give the checks a transcript and the Bash commands the run is said to have made.
 * Scratch lives under ~/.omp/trd-skills-eval/jest (never /tmp) and is removed in a `finally`.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { loadEvalDefs, evalToScenario, isJudged } = require('../lib/eval-def');
const { createSandbox } = require('../lib/sandbox');
const { runGraders } = require('../lib/graders');
const { scanFixture } = require('../lib/fixture');
const envlib = require('../lib/env');

const REPO_ROOT = path.resolve(__dirname, '../..');
const SCRATCH = path.join(os.homedir(), '.omp', 'trd-skills-eval', 'jest');
const RUN = path.join(__dirname, '../run.js');

const ctl = (s) => String(s).replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, '?').slice(0, 300); // eslint-disable-line no-control-regex

let loaded = null;
const defs = () => { if (!loaded) loaded = loadEvalDefs(); return loaded; };

/** The loaded eval `id`; throws (naming the eval) when it was rejected or does not exist. */
function getEval(id) {
  const { evals, rejected } = defs();
  const bad = rejected.find((r) => r.id === id || path.basename(r.dir) === id);
  if (bad) throw new Error(`eval "${ctl(id)}" was rejected: ${ctl(bad.error.message)}`);
  const ev = evals.find((e) => e.id === id);
  if (!ev) throw new Error(`no eval "${ctl(id)}" under evals/skills/`);
  return ev;
}

/**
 * The eval loads with no rejection and its fixture holds no agent or git configuration (`.claude`, `.mcp.json`, `.git*`, or a symlink
 * pointing outside the fixture). Also asserts there is at least one deterministic check. Returns the loaded eval.
 */
function loadsClean(id) {
  const ev = getEval(id); // throws on a rejection
  expect(ev.skill).toBeTruthy();
  expect(scanFixture(ev.fixtureDir)).toEqual([]);
  expect(ev.checks.filter((c) => !isJudged(c)).length).toBeGreaterThan(0);
  return ev;
}

/** Stable id of each deterministic check: the check script's argument (`.../prd.js prd-saved --x y` -> `prd-saved`), else `<type>`; repeats get `#2`, `#3`. */
function checkIds(checks) {
  const seen = new Map();
  return checks.map((c) => {
    const m = c.type === 'commandOutputMatches' || c.type === 'testsPass' ? /checks\/[\w.-]+\.js'?\s+([\w.-]+)/.exec(c.command || '') : null;
    const base = m ? m[1] : c.type;
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base}#${n}`;
  });
}

/**
 * Build the eval's sandbox, run `agent(ws)` in it, run every deterministic check of the eval through runGraders, clean up, and return
 * { checkId: { pass, detail } } (insertion order = the order in eval.json). Judged (model-graded) checks are not run.
 */
async function runEval(id, agent = () => {}) {
  const ev = getEval(id);
  fs.mkdirSync(SCRATCH, { recursive: true });
  const base = fs.mkdtempSync(path.join(SCRATCH, 'kit-'));
  try {
    const workdir = path.join(base, 'work');
    const sb = createSandbox(ev.dir, evalToScenario(ev), { workdir });
    const abs = (rel) => {
      const f = path.resolve(sb.dir, rel);
      if (f !== sb.dir && !f.startsWith(sb.dir + path.sep) && f !== sb.root && !f.startsWith(sb.root + path.sep)) throw new Error(`path escapes the sandbox: ${ctl(rel)}`);
      return f;
    };
    const ws = {
      id, ev, sb, dir: sb.dir, root: sb.root,
      write: (rel, text) => { const f = abs(rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); },
      read: (rel) => fs.readFileSync(abs(rel), 'utf8'),
      exists: (rel) => fs.existsSync(abs(rel)),
      remove: (rel) => fs.rmSync(abs(rel), { recursive: true, force: true }),
    };
    const out = (await agent(ws)) || {};
    const home = envlib.makeCiHome(workdir);
    const env = envlib.buildEnv({ parent: process.env, credentials: [], home });
    const ctx = {
      dir: sb.dir, repoRoot: REPO_ROOT, baseline: sb.baseline, transcript: out.transcript || '', env,
      ...(out.commands && { commands: out.commands, commandsIncomplete: false }),
    };
    const specs = evalToScenario(ev).graders.filter((g) => !isJudged(g));
    const graded = await runGraders(specs, ctx);
    const ids = checkIds(specs);
    const result = {};
    ids.forEach((k, i) => { result[k] = { pass: graded[i].pass, detail: String(graded[i].detail || '') }; });
    return result;
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
}

const failingOf = (result) => Object.entries(result).filter(([, r]) => !r.pass).map(([k, r]) => `${k}: ${r.detail}`);

/** Every check passed; on a failure the message lists each failing check id with its detail. */
function expectAllPass(result) {
  expect(Object.keys(result).length).toBeGreaterThan(0);
  expect(failingOf(result)).toEqual([]);
}

/**
 * The named check(s) failed. `which`: a check id or an array of them (an unknown id is an error, so a typo cannot pass). `detailMatch`:
 * optional RegExp the failing detail must match (the reason, not just "failed"). `opts.only`: no other check failed either.
 */
function expectFails(result, which, detailMatch, opts = {}) {
  const names = Array.isArray(which) ? which : [which];
  expect(names.length).toBeGreaterThan(0);
  for (const name of names) {
    if (!Object.prototype.hasOwnProperty.call(result, name)) throw new Error(`no check "${ctl(name)}" in this eval (checks: ${Object.keys(result).join(', ')})`);
    expect({ check: name, pass: result[name].pass }).toEqual({ check: name, pass: false });
    if (detailMatch) expect(result[name].detail).toMatch(detailMatch);
  }
  if (opts.only) expect(Object.keys(result).filter((k) => !result[k].pass).sort()).toEqual([...names].sort());
}

// ---- arms ------------------------------------------------------------------------------------------------------------------

/** A stub `claude`: records its argv, cwd and plugin dirs to calls.jsonl, writes nothing, and reports a startup event (with-skill lists the skill, baseline does not). */
const stubClaude = (pkgDir, skill) => `#!/usr/bin/env node
'use strict';
const fs = require('fs'); const path = require('path');
const argv = process.argv.slice(2);
const plugins = []; argv.forEach((a, i) => { if (argv[i - 1] === '--plugin-dir') plugins.push(a); });
const withSkill = plugins.some((p) => path.resolve(p) === ${JSON.stringify(pkgDir)});
fs.appendFileSync(path.join(__dirname, 'calls.jsonl'), JSON.stringify({ argv, plugins, withSkill, cwd: process.cwd() }) + '\\n');
const pluginObjs = plugins.map((p) => ({ name: 'ensemble-' + path.basename(p), path: p }));
const skills = withSkill ? ['ensemble-' + path.basename(${JSON.stringify(pkgDir)}) + ':' + ${JSON.stringify(skill)}] : ['verify'];
console.log(JSON.stringify({ type: 'system', subtype: 'init', skills, plugins: pluginObjs, model: 'claude-stub-1' }));
if (withSkill) console.log(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Skill', input: { skill: skills[0] } }] } }));
console.log(JSON.stringify({ type: 'result', num_turns: 1, total_cost_usd: 0.01 }));
`;

/**
 * Run the eval through evals/run.js (one repeat, both arms) against a stub `claude` and assert how the arms are loaded:
 *   baseline:   --plugin-dir only for the eval's `sharedPackages` (none for a plain eval); prompt is the task text, prefixed by the
 *               command only for `explicit-both`
 *   with-skill: the shared packages, then packages/<package> (the one that ships the skill); the command prefixes the prompt for
 *               `explicit` and `explicit-both`
 *   both:       the same task text (`{{repo}}` expanded), workspace under the scratch work directory, no leak or rejection reported
 * Returns { baseline, withSkill } each { argv, plugins, prompt, cwd } for further assertions (for example `sandboxPath` on PATH).
 */
async function armsFor(id) {
  const ev = getEval(id);
  fs.mkdirSync(SCRATCH, { recursive: true });
  const t = fs.mkdtempSync(path.join(SCRATCH, 'arms-'));
  try {
    const bin = path.join(t, 'bin');
    fs.mkdirSync(bin, { recursive: true });
    const pkgDir = path.join(REPO_ROOT, 'packages', ev.package);
    fs.writeFileSync(path.join(bin, 'claude'), stubClaude(pkgDir, ev.skill), { mode: 0o755 });
    const r = spawnSync('node', [RUN, '--skill', id, '--repeats', '1', '--concurrency', '1', '--model', 'claude-stub-1', '--refresh'], {
      encoding: 'utf8', cwd: REPO_ROOT,
      env: {
        ...process.env, CI: 'false', GITHUB_ACTIONS: 'false', PATH: `${bin}${path.delimiter}${process.env.PATH}`, EVALS_WORKDIR: path.join(t, 'work'),
        EVALS_RESULTS_DIR: path.join(t, 'results'), EVALS_BASELINES_DIR: path.join(t, 'baselines'), EVALS_CACHE_DIR: path.join(t, 'cache'),
      },
    });
    expect(r.stderr).not.toMatch(/REJECTED|leaked|isolation unverifiable/);
    const logFile = path.join(bin, 'calls.jsonl');
    const calls = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
    const promptOf = (c) => c.argv[c.argv.indexOf('-p') + 1];
    const named = calls.map((c) => ({ argv: c.argv, plugins: c.plugins, prompt: promptOf(c), cwd: c.cwd, withSkill: c.withSkill }));
    expect(named.map((c) => c.withSkill).sort()).toEqual([false, true]);
    const baseline = named.find((c) => !c.withSkill);
    const withSkill = named.find((c) => c.withSkill);
    const shared = (ev.sharedPackages || []).map((p) => path.join(REPO_ROOT, 'packages', p));
    expect(baseline.plugins).toEqual(shared);
    expect(withSkill.plugins).toEqual([...shared, pkgDir]);
    const task = ev.prompt.split('{{repo}}').join(REPO_ROOT);
    const prefixed = `${ev.command} ${task}`;
    expect(baseline.prompt).toBe(ev.invocation === 'explicit-both' ? prefixed : task);
    expect(withSkill.prompt).toBe(ev.invocation === 'plain' ? task : prefixed);
    for (const c of named) expect(c.cwd.startsWith(path.join(t, 'work'))).toBe(true);
    return { baseline, withSkill };
  } finally {
    fs.rmSync(t, { recursive: true, force: true });
  }
}

module.exports = { loadsClean, runEval, expectAllPass, expectFails, armsFor, getEval, checkIds, REPO_ROOT, SCRATCH };
