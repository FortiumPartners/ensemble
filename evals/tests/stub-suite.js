'use strict';

/**
 * Shared harness for the cache, comparison and replay tests: runs evals/run.js against a stub `claude` in a scratch directory
 * under ~/.omp/trd-skills-eval/jest (never /tmp). Not a test file. No real model is ever called.
 * The stub appends one line per invocation (`with-skill` or `baseline`) to `calls.log`, so a test can assert it was, or was never, called.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { findSkillPackages } = require('../lib/eval-def');

const RUN = path.join(__dirname, '../run.js');
const COMPARE = path.join(__dirname, '../compare.js');
const REPO_ROOT = path.resolve(__dirname, '../..');
const SCRATCH = path.join(os.homedir(), '.omp', 'trd-skills-eval', 'jest');
const SKILL = 'ensemble-create-prd';
const PKG_DIR = path.join(REPO_ROOT, 'packages', findSkillPackages(SKILL)[0]);
const QUALIFIED = `ensemble-product:${SKILL}`;

const initLine = (skills, plugins, model) => JSON.stringify({ type: 'system', subtype: 'init', skills, plugins: plugins || [], ...(model && { model }) });
const invokeLine = (name) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Skill', input: { skill: name } }] } });
const resultLine = () => JSON.stringify({ type: 'result', num_turns: 1, total_cost_usd: 0.01 });

function createSuite() {
  fs.mkdirSync(SCRATCH, { recursive: true });
  const root = fs.mkdtempSync(path.join(SCRATCH, 'c-'));
  const sub = (...p) => path.join(root, ...p);
  const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
  const calls = () => (fs.existsSync(sub('calls.log')) ? fs.readFileSync(sub('calls.log'), 'utf8').split('\n').filter(Boolean) : []);
  const resetCalls = () => fs.rmSync(sub('calls.log'), { force: true });
  const evalJsonPath = sub('skills', SKILL, 'eval.json');
  // Scratch copy of the skill package (EVALS_REPO_ROOT): a test can edit it and never touches packages/ in the real checkout.
  let scratchRoot = null;
  const pkgDirNow = () => (scratchRoot ? path.join(scratchRoot, 'packages', path.basename(PKG_DIR)) : PKG_DIR);
  function useScratchRepo() {
    scratchRoot = sub('repo');
    fs.cpSync(PKG_DIR, pkgDirNow(), { recursive: true });
    return pkgDirNow();
  }

  /**
   * One run.js invocation. opts: { model (id the stub reports; null = none), pass (with-skill arm writes SUMMARY.md), leak (the baseline arm lists the
   * skill), die (every call exits 1 after being logged: "fails if called"), requireInSkill (a content-sensitive with-skill arm: SUMMARY.md is written only when
   * the SKILL.md under the --plugin-dir it was given contains this text), env }.
   */
  function run(args = ['--repeats', '2', '--concurrency', '1', '--model', 'claude-stub-1'], { model = 'claude-stub-1', pass = true, leak = false, die = false, hang = false, passSeq = null, requireInSkill = null, env = {}, scenario = true } = {}) {
    fs.mkdirSync(sub('bin'), { recursive: true });
    fs.rmSync(sub('seq.count'), { force: true });
    const emit = (lines) => lines.map((l) => `echo '${l.replace(/'/g, "'\\''")}'`).join('\n');
    const withLines = [initLine([QUALIFIED], [{ name: 'ensemble-product', path: pkgDirNow() }], model), invokeLine(QUALIFIED), resultLine()];
    const baseLines = [initLine(leak ? [QUALIFIED] : ['verify'], [], model), resultLine()];
    write(sub('bin/claude'), `#!/bin/sh
case "$*" in *--plugin-dir*) echo with-skill >> '${sub('calls.log')}';; *) echo baseline >> '${sub('calls.log')}';; esac
${die ? 'exit 1' : ''}
${hang ? 'sleep 30' : ''}
case "$*" in *--plugin-dir*) ${requireInSkill ? `d=''; prev=''; for a in "$@"; do if [ "$prev" = --plugin-dir ]; then d="$a"; fi; prev="$a"; done
if grep -q -F -e '${requireInSkill.replace(/'/g, "'\\''")}' "$d/skills/${SKILL}/SKILL.md" 2>/dev/null; then echo ok > SUMMARY.md; fi` : passSeq ? `n=$(cat '${sub('seq.count')}' 2>/dev/null || echo 0); n=$((n+1)); echo $n > '${sub('seq.count')}'
case "$n" in ${passSeq.map((ok, i) => (ok ? i + 1 : null)).filter(Boolean).join('|') || 'none'}) echo ok > SUMMARY.md;; esac` : pass ? 'echo ok > SUMMARY.md' : ':'}
${emit(withLines)};;
*) ${emit(baseLines)};;
esac
`);
    fs.chmodSync(sub('bin/claude'), 0o755);
    if (!fs.existsSync(evalJsonPath)) {
      write(sub('skills', SKILL, 'fixture', 'seed.txt'), 'seed\n');
      write(evalJsonPath, JSON.stringify({ skill: SKILL, prompt: 'Write a summary of the repo', checks: [{ type: 'fileExists', path: 'SUMMARY.md' }] }));
    }
    fs.mkdirSync(sub('scenarios'), { recursive: true });
    fs.rmSync(sub('results'), { recursive: true, force: true });
    const r = spawnSync('node', [RUN, ...(scenario ? ['--skill', SKILL] : []), ...args], { encoding: 'utf8', cwd: REPO_ROOT, env: envFor(env) });
    return finish(r);
  }

  const envFor = (env = {}) => ({
    ...process.env, CI: 'false', GITHUB_ACTIONS: 'false', PATH: `${sub('bin')}:${process.env.PATH}`, EVALS_WORKDIR: sub('work'),
    EVALS_RESULTS_DIR: sub('results'), EVALS_BASELINES_DIR: sub('baselines'), EVALS_SCENARIOS_DIR: sub('scenarios'), EVALS_SKILLS_DIR: sub('skills'), ...(scratchRoot && { EVALS_REPO_ROOT: scratchRoot }), ...env,
  });

  /** evals/compare.js with the same scratch directories. */
  function compare(args = [], env = {}) {
    return spawnSync('node', [COMPARE, ...args], { encoding: 'utf8', cwd: REPO_ROOT, env: envFor(env) });
  }

  /** Run a printed command line through `sh -c` from the repository root with the same stub environment (results of the previous run are replaced). */
  function exec(command, env = {}) {
    fs.rmSync(sub('results'), { recursive: true, force: true });
    return finish(spawnSync('sh', ['-c', command], { encoding: 'utf8', cwd: REPO_ROOT, env: envFor(env) }));
  }

  function finish(r) {
    const logs = fs.existsSync(sub('results')) ? fs.readdirSync(sub('results')) : [];
    const logFile = logs[0] ? path.join(sub('results'), logs[0]) : null;
    return { ...r, log: logFile, doc: () => JSON.parse(fs.readFileSync(logFile, 'utf8')) };
  }

  /** The stored entries of the claude runtime cache: [{ file, entry }]. */
  const entries = () => {
    const dir = sub('cache', 'claude');
    return fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => n.endsWith('.json')).sort().map((n) => ({ file: path.join(dir, n), entry: JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8')) })) : [];
  };
  const cleanup = () => fs.rmSync(root, { recursive: true, force: true });
  return { root, sub, useScratchRepo, write, run, exec, compare, calls, resetCalls, entries, cleanup, evalJsonPath };
}

module.exports = { createSuite, REPO_ROOT, RUN, SKILL, PKG_DIR, QUALIFIED, SCRATCH };
