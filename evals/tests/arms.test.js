'use strict';

/**
 * PR 3 behavior: runner interface and Claude adapter (TRD-008), arms and leak check (TRD-009), repeats and
 * reliability (TRD-010), invocation detection and evaluated copy (TRD-011). A stub `claude` stands in for the model.
 * The stub records its argv, cwd and a content checksum of its workspace per call, then prints a stream-json
 * transcript whose shape each test chooses.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const claude = require('../lib/runners/claude');
const { getRunner } = require('../lib/runners');
const arms = require('../lib/arms');
const exec = require('../lib/exec');
const { evaluatedCopy, describeCopy } = require('../lib/results');
const { loadEvalDefs, findSkillPackages } = require('../lib/eval-def');
const { buildClaudeArgs } = require('../lib/sandbox');
const { loadScenarios } = require('../run');

const RUN = path.join(__dirname, '../run.js');
const REPO_ROOT = path.resolve(__dirname, '../..');
const SCRATCH = path.join(os.homedir(), '.omp', 'trd-skills-eval', 'jest');
const SKILL = 'ensemble-create-prd';
const PKG = findSkillPackages(SKILL)[0];
const PKG_DIR = path.join(REPO_ROOT, 'packages', PKG);
const PLUGIN_NAME = 'ensemble-product';
const QUALIFIED = `${PLUGIN_NAME}:${SKILL}`;

let root;
beforeEach(() => {
  fs.mkdirSync(SCRATCH, { recursive: true });
  root = fs.mkdtempSync(path.join(SCRATCH, 'a-'));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
const sub = (...p) => path.join(root, ...p);

const initLine = (skills, plugins) => JSON.stringify({ type: 'system', subtype: 'init', ...(skills && { skills }), plugins: plugins || [] });
const invokeLine = (name) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Skill', input: { skill: name } }] } });
const resultLine = (usd = 0.01) => JSON.stringify({ type: 'result', num_turns: 1, total_cost_usd: usd });

/**
 * Write a stub claude. Per call it records argv (one per line), the checksum of its workspace files and the
 * SKILL.md files found in its cwd under REC/call-*; arm is "with" when argv has --plugin-dir. Then it
 * prints `with`/`base` lines (arrays of stream lines) and, when `passes(arm, n)` is a shell condition on $N (the
 * 1-based call number within that arm; use --concurrency 1 for ordered counts), writes SUMMARY.md.
 */
function stub({ withLines, baseLines, passWith = 'true', passBase = 'false', baseTail = '' }) {
  const rec = sub('rec');
  fs.mkdirSync(rec, { recursive: true });
  const bin = sub('bin');
  fs.mkdirSync(bin, { recursive: true });
  const emit = (lines) => lines.map((l) => `echo '${l.replace(/'/g, "'\\''")}'`).join('\n');
  fs.writeFileSync(path.join(bin, 'claude'), `#!/bin/sh
R=$(mktemp -d "${rec}/call-XXXXXX")
printf '%s\\n' "$@" > "$R/argv"
case "$*" in *--plugin-dir*) ARM=with;; *) ARM=base;; esac
echo $ARM > "$R/arm"
find . -type f -not -path './.git/*' | sort | xargs cat 2>/dev/null | cksum > "$R/ws"
find . -type f -not -path './.git/*' | sort > "$R/files"
find . -name SKILL.md -not -path './.git/*' > "$R/skillmd"
N=$(grep -l "^$ARM\\$" ${rec}/call-*/arm | wc -l)
if [ $ARM = with ]; then
  if ${passWith}; then echo ok > SUMMARY.md; fi
${emit(withLines)}
else
  if ${passBase}; then echo ok > SUMMARY.md; fi
${emit(baseLines)}
${baseTail}
fi
`, { mode: 0o755 });
  return { bin, rec };
}

/** The calls the stub recorded, parsed. */
function calls(rec) {
  return fs.readdirSync(rec).filter((d) => d.startsWith('call-')).sort().map((d) => {
    const r = (f) => fs.readFileSync(path.join(rec, d, f), 'utf8');
    const argv = r('argv').split('\n').slice(0, -1);
    return { argv, arm: r('arm').trim(), ws: r('ws'), files: r('files').split('\n').filter(Boolean), skillmd: r('skillmd').trim(), prompt: argv[argv.indexOf('-p') + 1] };
  });
}

/** Write skills/<SKILL>/eval.json (+ fixture) and run run.js with the stub first on PATH. */
function runEvals(def, stubbed, args = [], env = {}) {
  const skillsDir = sub('skills');
  const dir = path.join(skillsDir, SKILL);
  fs.mkdirSync(path.join(dir, 'fixture'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'fixture', 'seed.txt'), 'seed\n');
  fs.writeFileSync(path.join(dir, 'eval.json'), JSON.stringify({
    skill: SKILL, prompt: 'Write a summary of the repo', checks: [{ type: 'fileExists', path: 'SUMMARY.md' }], ...def,
  }));
  fs.mkdirSync(sub('scenarios'), { recursive: true });
  const base = {
    ...process.env, CI: 'false', GITHUB_ACTIONS: 'false', PATH: `${stubbed.bin}:${process.env.PATH}`, EVALS_WORKDIR: sub('work'),
    EVALS_RESULTS_DIR: sub('results'), EVALS_SCENARIOS_DIR: sub('scenarios'), EVALS_SKILLS_DIR: skillsDir, ...env,
  };
  const r = spawnSync('node', [RUN, '--skill', SKILL, ...args], { encoding: 'utf8', env: base });
  const rf = fs.existsSync(sub('results')) ? fs.readdirSync(sub('results'))[0] : null;
  const report = rf ? JSON.parse(fs.readFileSync(sub('results', rf), 'utf8')) : null;
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, report, ev: report && report.results[0], calls: calls(stubbed.rec) };
}

const WITH_OK = [initLine([QUALIFIED, 'verify'], [{ name: PLUGIN_NAME, path: PKG_DIR }]), invokeLine(QUALIFIED), resultLine()];
const BASE_OK = [initLine(['verify']), resultLine()];

describe('TRD-008 runner interface and Claude adapter', () => {
  test('skill loaded as shipped: --plugin-dir is the package directory, no copy in the workspace', () => {
    const s = stub({ withLines: WITH_OK, baseLines: BASE_OK });
    const r = runEvals({}, s, ['--repeats', '1', '--concurrency', '1']);
    const w = r.calls.find((c) => c.arm === 'with');
    expect(w.argv[w.argv.indexOf('--plugin-dir') + 1]).toBe(PKG_DIR);
    expect(w.argv.filter((a) => a === '--plugin-dir')).toHaveLength(1);
    expect(fs.existsSync(path.join(PKG_DIR, 'skills', SKILL, 'SKILL.md'))).toBe(true);
    expect(w.skillmd).toBe(''); // no SKILL.md anywhere in the workspace
    expect(w.files).toEqual(['./seed.txt']);
  });

  test('--setting-sources project on both arms', () => {
    const s = stub({ withLines: WITH_OK, baseLines: BASE_OK });
    const r = runEvals({}, s, ['--repeats', '1', '--concurrency', '1']);
    expect(r.calls.map((c) => c.arm).sort()).toEqual(['base', 'with']);
    for (const c of r.calls) expect(c.argv.slice(c.argv.indexOf('--setting-sources'), c.argv.indexOf('--setting-sources') + 2)).toEqual(['--setting-sources', 'project']);
  });

  test('startup event without a skill list: loadedSkills comes from the invocation events, and the leak check uses it', () => {
    const noList = [JSON.stringify({ type: 'system', subtype: 'init', plugins: [] }), invokeLine(QUALIFIED), resultLine()];
    const scanned = claude.analyzeTranscript(noList.join('\n'));
    expect(scanned).toMatchObject({ loadedSkills: [QUALIFIED], invokedSkills: [QUALIFIED], loadedSource: 'transcript-scan' });
    // contrast: a startup list is used when present
    expect(claude.analyzeTranscript(WITH_OK.join('\n'))).toMatchObject({ loadedSource: 'startup-event', loadedSkills: ['verify', QUALIFIED].sort() });
    // end to end: a baseline whose stream has no startup list but invokes the skill is a leak
    const s = stub({ withLines: noList, baseLines: noList });
    const r = runEvals({}, s, ['--repeats', '1', '--concurrency', '1']);
    expect(r.stderr).toMatch(new RegExp(`ABORTED eval "${SKILL}": baseline arm leaked the skill under test "${SKILL}": invoked in the transcript`));
    expect(r.status).toBe(1);
  });

  test('run(job) returns the interface shape, reads cost, and keeps startup events when the transcript is capped', async () => {
    const filler = `{"type":"user","pad":"${'x'.repeat(1000)}"}`;
    const body = `#!/bin/sh
echo '${initLine([QUALIFIED])}'
i=0; while [ $i -lt 2600 ]; do echo '${filler}'; i=$((i+1)); done
echo '${invokeLine(QUALIFIED)}'
i=0; while [ $i -lt 2600 ]; do echo '${filler}'; i=$((i+1)); done
echo '${resultLine(0.07)}'
`;
    fs.mkdirSync(sub('bin'), { recursive: true });
    fs.writeFileSync(sub('bin/claude'), body, { mode: 0o755 });
    fs.mkdirSync(sub('ws'));
    const r = await getRunner('claude').run({
      evalId: 'e', skill: SKILL, arm: 'with-skill', runtime: 'claude', prompt: 'p', workspace: sub('ws'), env: { PATH: process.env.PATH }, timeoutMs: 30000, pluginDirs: [PKG_DIR],
    }, { bin: sub('bin/claude') });
    expect(Object.keys(r)).toEqual(expect.arrayContaining(['transcript', 'exitCode', 'timedOut', 'costUsd', 'loadedSkills', 'runtime']));
    expect(r).toMatchObject({ exitCode: 0, timedOut: false, costUsd: 0.07, runtime: 'claude', loadedSource: 'startup-event' });
    expect(r.transcriptTruncated).toBe(true);
    expect(r.transcript).not.toContain('"subtype":"init"'); // dropped from the capped transcript...
    expect(r.loadedSkills).toEqual([QUALIFIED]); // ...but kept by the live scanner
    expect(r.invokedSkills).toEqual([QUALIFIED]);
    expect(() => getRunner('nope')).toThrow(/unsupported runtime "nope"/);
  });

  test('existing scenarios unchanged: same argv as the pre-refactor builder apart from --setting-sources project; outcome and cost reading are covered by runner.test.js (fix-issue)', () => {
    // Reference copy of the pre-PR-3 builder (evals/lib/sandbox.js at the end of PR 2).
    const before = (scenario, { repoRoot, model, maxUsd }) => {
      const prompt = scenario.prompt.split('{{repo}}').join(repoRoot);
      const args = ['-p', prompt, '--output-format', 'stream-json', '--verbose', '--no-session-persistence',
        '--permission-mode', scenario.permissionMode || 'acceptEdits', '--max-turns', String(scenario.maxTurns || 25)];
      if (maxUsd) args.push('--max-budget-usd', String(maxUsd));
      if (model) args.push('--model', model);
      if (scenario.allowedTools && scenario.allowedTools.length) args.push('--allowedTools', scenario.allowedTools.join(','));
      for (const pkg of scenario.plugins || []) args.push('--plugin-dir', path.join(repoRoot, 'packages', pkg));
      return args;
    };
    const agents = loadScenarios().filter((x) => x.type === 'agent');
    expect(agents.length).toBeGreaterThanOrEqual(3);
    for (const sc of agents) {
      const now = buildClaudeArgs(sc, { repoRoot: REPO_ROOT, model: 'sonnet', maxUsd: 0.5 });
      const i = now.indexOf('--setting-sources');
      expect(now.slice(i, i + 2)).toEqual(['--setting-sources', 'project']);
      expect([...now.slice(0, i), ...now.slice(i + 2)]).toEqual(before(sc, { repoRoot: REPO_ROOT, model: 'sonnet', maxUsd: 0.5 }));
    }
  });
});

describe('TRD-009 arms and leak check', () => {
  const ev = (over = {}) => ({ id: 'e', skill: SKILL, package: PKG, prompt: 'Write a summary of the repo', invocation: 'plain', command: undefined, allowedTools: ['Bash'], maxTurns: 7, ...over });
  const ctx = { repoRoot: REPO_ROOT, model: 'sonnet', workspace: '/w', env: { A: '1' }, timeoutMs: 1000, maxUsd: 1 };
  const strip = (job) => { const { arm, pluginDirs, skillPaths, prompt, ...rest } = job; return rest; }; // eslint-disable-line no-unused-vars

  test('arms identical except the skill: same prompt, settings and workspace; explicit prefixes the with-skill arm only', () => {
    for (const e of [ev(), ev({ invocation: 'explicit', command: '/ensemble:create-prd' })]) {
      const w = arms.buildJob(e, 'with-skill', ctx);
      const b = arms.buildJob(e, 'baseline', ctx);
      expect(strip(w)).toEqual(strip(b));
      expect(w.pluginDirs).toEqual([PKG_DIR]);
      if (e.invocation === 'explicit') {
        expect(w.prompt).toBe(`/ensemble:create-prd ${e.prompt}`);
        expect(b.prompt).toBe(e.prompt);
      } else {
        expect(w.prompt).toBe(b.prompt);
      }
    }
  });

  test('end to end: both arms get identical workspace content and argv apart from the plugin; invocation mode recorded', () => {
    const s = stub({ withLines: WITH_OK, baseLines: BASE_OK });
    const r = runEvals({ invocation: 'explicit', command: '/ensemble:create-prd' }, s, ['--repeats', '1', '--concurrency', '1']);
    const w = r.calls.find((c) => c.arm === 'with');
    const b = r.calls.find((c) => c.arm === 'base');
    expect(w.ws).toBe(b.ws); // workspace checksum taken before the stub wrote anything
    expect(w.prompt).toBe('/ensemble:create-prd Write a summary of the repo');
    expect(b.prompt).toBe('Write a summary of the repo');
    const drop = (argv) => argv.filter((a, i) => a !== '--plugin-dir' && argv[i - 1] !== '--plugin-dir' && argv[i - 1] !== '-p' && a !== '-p');
    expect(drop(w.argv)).toEqual(drop(b.argv));
    expect(r.ev.runs.every((x) => x.invocationMode === 'explicit')).toBe(true);
  });

  test('baseline job carries no plugin directory or skill path; the baseline argv has no --plugin-dir', () => {
    const b = arms.buildJob(ev(), 'baseline', ctx);
    expect(b.pluginDirs).toEqual([]);
    expect(b.skillPaths).toEqual([]);
    expect(claude.buildArgs(b)).not.toContain('--plugin-dir');
    expect(arms.buildJob(ev(), 'with-skill', ctx).skillPaths).toEqual([path.join(PKG_DIR, 'skills', SKILL)]);
  });

  test('a leaking baseline aborts the eval, naming the leak, with no baseline score and the rest of the eval skipped', () => {
    const s = stub({ withLines: WITH_OK, baseLines: [initLine([QUALIFIED]), resultLine()] });
    const r = runEvals({}, s, ['--concurrency', '1']);
    expect(r.stderr).toMatch(new RegExp(`ABORTED eval "${SKILL}": baseline arm leaked the skill under test "${SKILL}": reported loaded by the runtime \\(${QUALIFIED}\\)`));
    expect(r.ev).toMatchObject({ baseline: null, uplift: null, outcome: 'fail' });
    expect(r.ev.abort).toMatch(/leaked/);
    expect(r.status).toBe(1);
    expect(r.calls).toHaveLength(1); // the first baseline run; nothing after the abort started
  });

  test('detectLeak: clean baseline is null; a loaded package, an invocation and a startup listing are each a leak', () => {
    const e = ev();
    const opts = { repoRoot: REPO_ROOT };
    expect(arms.detectLeak(e, { loadedSkills: ['verify', 'other:x'], invokedSkills: [], loadedPlugins: [], loadedSource: 'startup-event' }, opts)).toBeNull();
    expect(arms.detectLeak(e, { loadedSkills: [], invokedSkills: [], loadedPlugins: [{ name: 'p', path: PKG_DIR }] }, opts)).toMatch(/its package product was loaded/);
    expect(arms.detectLeak(e, { loadedSkills: [QUALIFIED], invokedSkills: [QUALIFIED] }, opts)).toMatch(/invoked in the transcript/);
    expect(arms.detectLeak(e, { loadedSkills: [SKILL] }, opts)).toMatch(/reported loaded/);
    expect(arms.detectLeak(e, { loadedSkills: [`x:${SKILL}-other`], loadedSource: 'startup-event' }, opts)).toBeNull(); // a different skill with a similar name
  });

  test('near-zero uplift is a valid result: equal pass rates give uplift 0 and exit 0', () => {
    const s = stub({ withLines: WITH_OK, baseLines: BASE_OK, passBase: 'true' });
    const r = runEvals({}, s, ['--repeats', '2', '--concurrency', '1']);
    expect(r.ev).toMatchObject({ uplift: 0, outcome: 'pass', upliftLabel: 'package-level (skills share a package)' });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/uplift \+0\.00 package-level \(skills share a package\)/);
    expect(arms.uplift({ passes: 3, runs: 5 }, { passes: 3, runs: 5 })).toBe(0);
    expect(arms.uplift({ passes: 4, runs: 5 }, { passes: 1, runs: 5 })).toBeCloseTo(0.6);
  });
});

describe('TRD-010 repeats and reliability', () => {
  const armCounts = (cs) => ({ with: cs.filter((c) => c.arm === 'with').length, base: cs.filter((c) => c.arm === 'base').length });

  test('five runs per arm by default', () => {
    const s = stub({ withLines: WITH_OK, baseLines: BASE_OK });
    const r = runEvals({}, s, []);
    expect(armCounts(r.calls)).toEqual({ with: 5, base: 5 });
    expect(r.ev).toMatchObject({ repeats: 5, bar: 4, repeatsSource: 'default', barSource: 'default', withSkill: { runs: 5, passes: 5 } });
    expect(r.report.peakCommittedUsd).toBeLessThanOrEqual(r.report.maxUsd);
  });

  test('bar boundary: 4 of 5 is reliable, 3 of 5 is not (unit and end to end)', () => {
    expect(exec.reliability({ passes: 4, runs: 5 }, 4, 5)).toBe(true);
    expect(exec.reliability({ passes: 3, runs: 5 }, 4, 5)).toBe(false);
    expect(exec.reliability({ passes: 2, runs: 3 }, 4, 5)).toBeNull(); // two runs not yet started could still reach the bar
    const four = runEvals({}, stub({ withLines: WITH_OK, baseLines: BASE_OK, passWith: '[ $N -le 4 ]' }), ['--concurrency', '1']);
    expect(four.ev).toMatchObject({ reliable: true, outcome: 'pass', withSkill: { passes: 4, runs: 5 } });
    expect(four.status).toBe(0);
    fs.rmSync(root, { recursive: true, force: true });
    fs.mkdirSync(root);
    const three = runEvals({}, stub({ withLines: WITH_OK, baseLines: BASE_OK, passWith: '[ $N -le 3 ]' }), ['--concurrency', '1']);
    expect(three.ev).toMatchObject({ reliable: false, outcome: 'fail', withSkill: { passes: 3, runs: 5 } });
    expect(three.status).toBe(1);
  });

  test('per-eval repeats and bar are used and reported', () => {
    const s = stub({ withLines: WITH_OK, baseLines: BASE_OK });
    const r = runEvals({ repeats: 3, bar: 3 }, s, []);
    expect(armCounts(r.calls)).toEqual({ with: 3, base: 3 });
    expect(r.ev).toMatchObject({ repeats: 3, bar: 3, repeatsSource: 'eval', barSource: 'eval' });
    expect(r.stdout).toMatch(/repeats 3 \(eval\), bar 3 \(eval override\)/);
    expect(r.stderr).not.toMatch(/`repeats`|`bar`/); // no longer "accepted but not acted on"
  });

  test('--repeats overrides the eval; the default bar scales; a bar above the repeats is a usage error', () => {
    const s = stub({ withLines: WITH_OK, baseLines: BASE_OK });
    const r = runEvals({}, s, ['--repeats', '2']);
    expect(armCounts(r.calls)).toEqual({ with: 2, base: 2 });
    expect(r.ev).toMatchObject({ repeats: 2, bar: 2, repeatsSource: 'flag', barSource: 'scaled' });
    expect(exec.resolveRepeats({ id: 'x' }, { flagRepeats: 10, limits: { repeats: 5, bar: 4 } })).toMatchObject({ repeats: 10, bar: 8 });
    expect(() => exec.resolveRepeats({ id: 'x', bar: 4 }, { flagRepeats: 2, limits: { repeats: 5, bar: 4 } })).toThrow(/eval "x": bar 4 \(eval\) exceeds repeats 2 \(flag\)/);
    fs.rmSync(sub('rec'), { recursive: true, force: true });
    const bad = runEvals({ bar: 4 }, stub({ withLines: WITH_OK, baseLines: BASE_OK }), ['--repeats', '2']);
    expect(bad.status).toBe(2);
    expect(bad.stderr).toMatch(/exceeds repeats 2/);
  });

  test('the default repeats and bar are data in limits.json; a runtime other than claude or pi is a usage error', () => {
    const limits = exec.loadLimits();
    expect(limits).toMatchObject({ repeats: 5, bar: 4 });
    const s = stub({ withLines: WITH_OK, baseLines: BASE_OK });
    const r = runEvals({}, s, ['--runtime', 'codex']);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/unsupported --runtime "codex": not supported in this release/);
    expect(r.calls).toHaveLength(0);
  });
});

describe('TRD-011 invocation detection and evaluated copy', () => {
  test('invoked recorded: true with a skill invocation event, false without', () => {
    const yes = claude.analyzeTranscript([initLine([QUALIFIED]), invokeLine(QUALIFIED), resultLine()].join('\n'));
    const no = claude.analyzeTranscript([initLine([QUALIFIED]), resultLine()].join('\n')); // listed as available, never invoked
    expect(arms.wasInvoked(SKILL, yes)).toBe(true);
    expect(arms.wasInvoked(SKILL, no)).toBe(false);
    expect(arms.wasInvoked(SKILL, { transcript: [invokeLine('other:thing')].join('\n') })).toBe(false); // transcript fallback
    expect(arms.wasInvoked(SKILL, { transcript: [invokeLine(SKILL)].join('\n') })).toBe(true);
  });

  test('end to end: each result records invoked; expectInvoked reports a mismatch without changing the verdict', () => {
    const s = stub({ withLines: [initLine([QUALIFIED]), resultLine()], baseLines: BASE_OK });
    const r = runEvals({ expectInvoked: true }, s, ['--repeats', '2', '--concurrency', '1']);
    expect(r.ev.runs.filter((x) => x.arm === 'with-skill').map((x) => x.invoked)).toEqual([false, false]);
    expect(r.ev).toMatchObject({ invokedRuns: 0, expectInvoked: true, invokedAsExpected: false, outcome: 'pass' });
    expect(r.stdout).toMatch(/skill invoked in 0\/2 with-skill run\(s\) \(expectInvoked true: NOT as expected\)/);
    fs.rmSync(root, { recursive: true, force: true });
    fs.mkdirSync(root);
    const ok = runEvals({ expectInvoked: true }, stub({ withLines: WITH_OK, baseLines: BASE_OK }), ['--repeats', '2', '--concurrency', '1']);
    expect(ok.ev.runs.filter((x) => x.arm === 'with-skill').map((x) => x.invoked)).toEqual([true, true]);
    expect(ok.ev.runs.filter((x) => x.arm === 'baseline').map((x) => x.invoked)).toEqual([false, false]);
    expect(ok.ev).toMatchObject({ invokedAsExpected: true });
  });

  describe('evaluated copy', () => {
    const git = (cwd, ...a) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...a], { cwd, encoding: 'utf8' });
    function repo() {
      const dir = path.join(root, 'repo');
      fs.mkdirSync(path.join(dir, 'packages/x/skills/y'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'packages/x/skills/y/SKILL.md'), '---\nname: y\nmetadata:\n  version: "1.2.3"\n---\nbody\n');
      git(dir, 'init', '-q', '-b', 'main');
      git(dir, 'add', '-A');
      git(dir, 'commit', '-qm', 'init');
      return dir;
    }

    test('a skill edited after its last commit is reported with path, hash and that the working tree differs', () => {
      const dir = repo();
      const clean = evaluatedCopy({ repoRoot: dir, packageName: 'x', skill: 'y' });
      expect(clean).toMatchObject({ packagePath: path.join('packages', 'x'), workingTreeDiffers: false, skillVersion: '1.2.3' });
      expect(clean.skillHash).toMatch(/^[0-9a-f]{64}$/);
      fs.appendFileSync(path.join(dir, 'packages/x/skills/y/SKILL.md'), 'edited\n');
      const dirty = evaluatedCopy({ repoRoot: dir, packageName: 'x', skill: 'y' });
      expect(dirty).toMatchObject({ packagePath: path.join('packages', 'x'), workingTreeDiffers: true });
      expect(dirty.changedFiles).toEqual([path.join('packages', 'x', 'skills', 'y', 'SKILL.md')]);
      expect(dirty.skillHash).not.toBe(clean.skillHash);
      const line = describeCopy(dirty);
      expect(line).toContain('packages/x');
      expect(line).toContain(dirty.skillHash.slice(0, 12));
      expect(line).toMatch(/working tree DIFFERS from the committed copy/);
      expect(describeCopy(clean)).toMatch(/matches the committed copy/);
    });

    test('an untracked new file in the package counts; outside a git checkout the answer is unknown, not "same"', () => {
      const dir = repo();
      fs.writeFileSync(path.join(dir, 'packages/x/new.txt'), 'n');
      expect(evaluatedCopy({ repoRoot: dir, packageName: 'x', skill: 'y' }).workingTreeDiffers).toBe(true);
      const plain = path.join(root, 'plain');
      fs.mkdirSync(path.join(plain, 'packages/x/skills/y'), { recursive: true });
      fs.writeFileSync(path.join(plain, 'packages/x/skills/y/SKILL.md'), 'x');
      const c = evaluatedCopy({ repoRoot: plain, packageName: 'x', skill: 'y' });
      expect(c.workingTreeDiffers).toBeNull();
      expect(describeCopy(c)).toMatch(/unknown/);
    });

    test('an uncommitted edit to a shared package is reported (packageHash folds it, so the status must too); the file names its package', () => {
      const dir = repo();
      fs.mkdirSync(path.join(dir, 'packages/sh/commands'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'packages/sh/commands/cmd.yaml'), 'a: 1\n');
      git(dir, 'add', '-A');
      git(dir, 'commit', '-qm', 'shared');
      const copy = () => evaluatedCopy({ repoRoot: dir, packageName: 'x', skill: 'y', sharedPackages: ['sh'] });
      expect(copy()).toMatchObject({ workingTreeDiffers: false, changedFiles: [] });
      expect(describeCopy(copy())).toMatch(/matches the committed copy/);
      fs.appendFileSync(path.join(dir, 'packages/sh/commands/cmd.yaml'), 'b: 2\n');
      fs.writeFileSync(path.join(dir, 'packages/sh/new.txt'), 'n');
      const dirty = copy();
      expect(dirty.workingTreeDiffers).toBe(true);
      expect(dirty.changedFiles.sort()).toEqual([path.join('packages', 'sh', 'commands', 'cmd.yaml'), path.join('packages', 'sh', 'new.txt')]);
      expect(describeCopy(dirty)).toMatch(/DIFFERS/);
      // without naming the shared package the shared edit is (correctly) outside the evaluated set
      expect(evaluatedCopy({ repoRoot: dir, packageName: 'x', skill: 'y' }).workingTreeDiffers).toBe(false);
      // the own package still counts alongside it
      fs.appendFileSync(path.join(dir, 'packages/x/skills/y/SKILL.md'), 'e\n');
      expect(copy().changedFiles).toHaveLength(3);
    });

    test('every eval result and the console state the evaluated copy', () => {
      const s = stub({ withLines: WITH_OK, baseLines: BASE_OK });
      const r = runEvals({}, s, ['--repeats', '1', '--concurrency', '1']);
      expect(r.ev.evaluatedCopy).toMatchObject({ packagePath: path.join('packages', PKG) });
      expect(typeof r.ev.evaluatedCopy.skillHash).toBe('string');
      expect(r.stdout).toMatch(new RegExp(`evaluated copy: packages/${PKG} \\(loaded as shipped\\) skillHash=[0-9a-f]{12}`));
    });
  });
});

describe('loadEvalDefs still accepts repeats, bar and expectInvoked', () => {
  test('fields load as before', () => {
    const skillsDir = sub('s');
    fs.mkdirSync(path.join(skillsDir, SKILL, 'fixture'), { recursive: true });
    fs.writeFileSync(path.join(skillsDir, SKILL, 'eval.json'), JSON.stringify({ skill: SKILL, prompt: 'x', repeats: 3, bar: 2, expectInvoked: true, checks: [{ type: 'fileExists', path: 'a' }] }));
    const [e] = loadEvalDefs({ skillsDir, repoRoot: REPO_ROOT }).evals;
    expect(e).toMatchObject({ repeats: 3, bar: 2, expectInvoked: true, unactedFields: [] });
  });
});

describe('review fixes: baseline isolation must be verified, not assumed', () => {
  const ev = { id: 'e', skill: SKILL, package: PKG };
  const opts = { repoRoot: REPO_ROOT };

  test('a baseline stream with no init event aborts as unverifiable, not scored, exit 1', () => {
    const s = stub({ withLines: WITH_OK, baseLines: [resultLine()] });
    const r = runEvals({}, s, ['--concurrency', '1']);
    expect(r.stderr).toMatch(/ABORTED eval "ensemble-create-prd": baseline isolation unverifiable: no startup skill list/);
    expect(r.ev).toMatchObject({ baseline: null, uplift: null, outcome: 'fail' });
    expect(r.ev.abort).toMatch(/baseline isolation unverifiable: no startup skill list/);
    expect(r.status).toBe(1);
    expect(r.calls).toHaveLength(1); // nothing after the aborting run started
  });

  test('detectLeak: no startup list is unverifiable when the run completed normally; a leak still outranks it', () => {
    const done = { loadedSkills: [], invokedSkills: [], loadedPlugins: [], loadedSource: 'transcript-scan', timedOut: false, exitCode: 0 };
    expect(arms.detectLeak(ev, done, opts)).toMatch(/baseline isolation unverifiable: no startup skill list/);
    expect(arms.detectLeak(ev, { ...done, loadedSource: 'startup-event' }, opts)).toBeNull();
    expect(arms.detectLeak(ev, { ...done, invokedSkills: [SKILL], loadedSkills: [SKILL] }, opts)).toMatch(/leaked the skill/);
    expect(arms.checkBaseline(ev, { ...done, exitCode: undefined, claudeExitCode: 0 }, opts).kind).toBe('unverifiable-abort');
  });

  test('a crashed or timed-out baseline before any init event is unverifiable and not scored; one that crashed after init is scored', () => {
    const crashed = stub({ withLines: WITH_OK, baseLines: [], baseTail: 'exit 1', passBase: 'true' });
    const r = runEvals({}, crashed, ['--repeats', '2', '--concurrency', '1']);
    expect(r.status).toBe(0);
    expect(r.ev.baseline).toMatchObject({ passes: 0, runs: 0, unverifiable: 2, notRun: 2 });
    expect(r.ev.uplift).toBeNull();
    expect(r.ev.runs.filter((x) => x.arm === 'baseline').map((x) => x.outcome)).toEqual(['unverifiable', 'unverifiable']);
    expect(r.stdout).toMatch(/2 run\(s\) not counted: isolation unverifiable/);
    expect(arms.checkBaseline(ev, { loadedSkills: [], loadedSource: 'transcript-scan', timedOut: true, exitCode: null }, opts).kind).toBe('unverifiable-run');
    expect(arms.checkBaseline(ev, { loadedSkills: [], loadedSource: 'transcript-scan', timedOut: false, exitCode: 1 }, opts).kind).toBe('unverifiable-run');
    expect(arms.detectLeak(ev, { loadedSkills: [], loadedSource: 'transcript-scan', timedOut: true }, opts)).toBeNull(); // no abort for a crash
    // contrast: the same crash after a startup event leaves the run verified and counted
    fs.rmSync(root, { recursive: true, force: true });
    fs.mkdirSync(root);
    const late = stub({ withLines: WITH_OK, baseLines: BASE_OK, baseTail: 'exit 1', passBase: 'true' });
    const c = runEvals({}, late, ['--repeats', '2', '--concurrency', '1']);
    expect(c.ev.baseline).toMatchObject({ runs: 2, unverifiable: 0 });
  });

  test('a symlinked plugin path to the shipped package is caught; a missing path falls back to resolve', () => {
    const link = sub('plugin-link');
    fs.symlinkSync(PKG_DIR, link);
    const base = { loadedSkills: [], invokedSkills: [], loadedSource: 'startup-event' };
    expect(arms.detectLeak(ev, { ...base, loadedPlugins: [{ name: 'p', path: link }] }, opts)).toMatch(/its package product was loaded as plugin p/);
    // symlinked repo root as well
    const rootLink = sub('repo-link');
    fs.symlinkSync(REPO_ROOT, rootLink);
    expect(arms.detectLeak(ev, { ...base, loadedPlugins: [{ name: 'p', path: PKG_DIR }] }, { repoRoot: rootLink })).toMatch(/its package product was loaded/);
    expect(arms.detectLeak(ev, { ...base, loadedPlugins: [{ name: 'p', path: sub('does-not-exist') }] }, opts)).toBeNull();
  });

  test('a second init event unions into skills and plugins and cannot hide an earlier match', () => {
    const lines = [initLine([QUALIFIED], [{ name: PLUGIN_NAME, path: PKG_DIR }]), initLine(['verify'], [{ name: 'other', path: sub('x') }]), resultLine()];
    const scanned = claude.analyzeTranscript(lines.join('\n'));
    expect(scanned.loadedSkills).toEqual(['verify', QUALIFIED].sort());
    expect(scanned.loadedPlugins.map((p) => p.name)).toEqual([PLUGIN_NAME, 'other']);
    expect(scanned.loadedSource).toBe('startup-event');
    expect(arms.detectLeak(ev, { ...scanned, timedOut: false, exitCode: 0 }, opts)).toMatch(/reported loaded by the runtime/);
    // an init without a skills array after one with a list keeps the list
    const keep = claude.analyzeTranscript([initLine([QUALIFIED]), JSON.stringify({ type: 'system', subtype: 'init' })].join('\n'));
    expect(keep.loadedSkills).toEqual([QUALIFIED]);
  });
});

describe('review fixes: runner fails closed and redacts', () => {
  const baseJob = () => ({ evalId: 'e', skill: SKILL, arm: 'baseline', runtime: 'claude', prompt: 'p', workspace: sub('ws'), env: { PATH: process.env.PATH }, timeoutMs: 20000, pluginDirs: [] });

  test('run() throws when job.env or job.workspace is missing, before any process starts', async () => {
    const marker = sub('ran');
    fs.mkdirSync(sub('bin'), { recursive: true });
    fs.writeFileSync(sub('bin/claude'), `#!/bin/sh\ntouch "${marker}"\n`, { mode: 0o755 });
    const run = (job) => getRunner('claude').run(job, { bin: sub('bin/claude') });
    const { env, ...noEnv } = baseJob(); // eslint-disable-line no-unused-vars
    const { workspace, ...noWs } = baseJob(); // eslint-disable-line no-unused-vars
    await expect(run(noEnv)).rejects.toThrow(/job\.env is required/);
    await expect(run(noWs)).rejects.toThrow(/job\.workspace is required/);
    expect(fs.existsSync(marker)).toBe(false);
  });

  test('run() redacts secrets from stderr as well as the transcript', async () => {
    const secret = 'sk-live-ABCDEF0123456789';
    fs.mkdirSync(sub('bin'), { recursive: true });
    fs.mkdirSync(sub('ws'));
    fs.writeFileSync(sub('bin/claude'), `#!/bin/sh\necho "boom ${secret}" >&2\necho '{"type":"result","result":"${secret}"}'\n`, { mode: 0o755 });
    const r = await getRunner('claude').run(baseJob(), { bin: sub('bin/claude'), secrets: [secret] });
    expect(r.stderr).toContain('[REDACTED]');
    expect(r.stderr).not.toContain(secret);
    expect(r.transcript).not.toContain(secret);
  });

  test('a secret straddling the stdout tail cut or the stderr cap leaves no fragment', async () => {
    const secret = 'sk-live-ABCDEF0123456789';
    fs.mkdirSync(sub('ws'));
    // stdout: ~90k short lines, each one secret; the 1 MB tail cut lands inside a line.
    // stderr: a secret placed so the 4000-character tail starts inside it.
    const script = sub('emit.js');
    fs.writeFileSync(script, `
const line = '${secret}z\\n';
let chunk = ''; for (let i = 0; i < 2000; i++) chunk += line;
for (let i = 0; i < 100; i++) process.stdout.write(chunk);
process.stderr.write('a'.repeat(3995) + '${secret}' + 'b'.repeat(2));
`);
    const r = await require('../lib/exec').runProcess(process.execPath, [script], { cwd: sub('ws'), env: { PATH: process.env.PATH }, timeoutMs: 60000, secrets: [secret] });
    expect(r.transcriptTruncated).toBe(true);
    const lines = r.transcript.split('\n').filter(Boolean);
    for (const l of lines) expect('[REDACTED]z').toContain(l); // every line, including the one cut by the cap, is a piece of the redacted line
    expect(r.stderr.length).toBeLessThanOrEqual(2000);
    expect(r.stderr).not.toMatch(/sk-|live|ABCDEF|0123456789|DEF0123/);
    // stderr cut: only the redaction survives where the secret was (a 2000-char tail would start inside it without the fix)
    const r2 = await require('../lib/exec').runProcess(process.execPath, ['-e', `process.stderr.write('a'.repeat(1975) + '${secret}' + 'b'.repeat(1999))`], { cwd: sub('ws'), env: { PATH: process.env.PATH }, timeoutMs: 20000, secrets: [secret] });
    expect(r2.stderr).not.toMatch(/ABCDEF|0123456789|-live-/);
    expect(r2.stderr.length).toBe(2000);
  });

  test('a secret inside a single over-long line (no newline) straddling the 1 MB pending cut leaves no fragment', async () => {
    const secret = 'sk-live-ABCDEF0123456789';
    fs.mkdirSync(sub('ws'));
    const script = sub('long.js');
    fs.writeFileSync(script, `
const unit = '${secret}z';
let chunk = ''; for (let i = 0; i < 4000; i++) chunk += unit;
for (let i = 0; i < 20; i++) process.stdout.write(chunk); // ~2 MB, never a newline
process.stdout.write('q'.repeat(Number(process.argv[2]))); // moves where the 1 MB cut lands inside the units
`);
    for (const pad of [1, 4, 7, 10, 13, 16, 19, 22]) {
      const r = await require('../lib/exec').runProcess(process.execPath, [script, String(pad)], { cwd: sub('ws'), env: { PATH: process.env.PATH }, timeoutMs: 60000, secrets: [secret] });
      expect(r.transcriptTruncated).toBe(true);
      const rest = r.transcript.replace(/\[REDACTED\]z/g, '').replace(/q/g, '');
      expect('[REDACTED]z').toContain(rest); // at most the cut piece of one redacted unit; no piece of the secret
    }
  });
});
