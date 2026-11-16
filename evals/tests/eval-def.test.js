'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { validateEvalDef, loadEvalDefs, evalToScenario, EvalDefinitionError } = require('../lib/eval-def');
const { summarizeRun } = require('../lib/results');
const { runGraders } = require('../lib/graders');
const { scaffold } = require('../new');

const RUN = path.join(__dirname, '../run.js');

let tmp; let repo; let skillsDir;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'evals-def-'));
  // A fake repository with one shipped skill, so tests never depend on real skills.
  repo = path.join(tmp, 'repo');
  fs.mkdirSync(path.join(repo, 'packages/demo/skills/demo-skill'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'packages/demo/skills/demo-skill/SKILL.md'), '---\nname: demo-skill\n---\n');
  skillsDir = path.join(tmp, 'skills');
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

const valid = () => ({
  skill: 'demo-skill',
  prompt: 'Write a summary of the repo',
  checks: [{ type: 'fileExists', path: 'SUMMARY.md' }],
});

/** Write evals/skills/<name>/eval.json (+ fixture/) under skillsDir. */
function writeEval(name, def, { fixture = true, rubric } = {}) {
  const dir = path.join(skillsDir, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'eval.json'), JSON.stringify(def));
  if (fixture) fs.mkdirSync(path.join(dir, 'fixture'), { recursive: true });
  if (rubric) fs.writeFileSync(path.join(dir, 'rubric.md'), rubric);
  return dir;
}

const load = () => loadEvalDefs({ skillsDir, repoRoot: repo });
const rejection = (id) => load().rejected.find((r) => r.id === id);

function runDry(args, env) {
  return spawnSync('node', [RUN, '--dry-run', ...args], {
    encoding: 'utf8',
    env: { ...process.env, EVALS_CLAUDE_BIN: path.join(tmp, 'nope'), EVALS_SKILLS_DIR: skillsDir, ...env },
  });
}

describe('review fixes', () => {
  test('a prompt like "TODO list app" is accepted; a scaffold "TODO:" marker is not', () => {
    writeEval('demo-skill', { ...valid(), prompt: 'TODO list app: build it' });
    expect(load().evals).toHaveLength(1);
    writeEval('demo-skill', { ...valid(), prompt: 'TODO: the task' });
    expect(rejection('demo-skill').error.part).toBe('placeholder');
  });

  test('accepted-but-unused fields produce one warning line and no exit-code change', () => {
    writeEval('demo-skill', { ...valid(), skill: 'ensemble-create-prd', repeats: 3, bar: 2, runtimes: ['claude'] });
    const r = runDry([]);
    const lines = r.stderr.split('\n').filter((l) => /^WARNING eval "demo-skill"/.test(l));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/`runtimes`, `repeats`, `bar`.*not yet acted on/);
    expect(r.stderr).not.toMatch(/expectInvoked/);
    expect(r.status).toBe(0);
  });

  test('a skill eval whose id collides with a legacy scenario id is rejected by name', () => {
    writeEval('demo-skill', { ...valid(), skill: 'ensemble-create-prd', id: 'fix-issue' });
    const r = runDry([]);
    expect(r.stderr).toMatch(/REJECTED eval "fix-issue": id collides with a legacy scenario id/);
    expect(r.status).toBe(2);
  });
});

describe('loading (TRD-001)', () => {
  test('a prompt edited on disk is the one loaded next time, with no build step', () => {
    writeEval('demo-skill', valid());
    expect(load().evals[0].prompt).toBe('Write a summary of the repo');
    writeEval('demo-skill', { ...valid(), prompt: 'Summarize the repo in one file' });
    expect(load().evals[0].prompt).toBe('Summarize the repo in one file');
  });

  test('a new eval directory is discovered by --dry-run with no registration', () => {
    const before = runDry([]);
    expect(before.stdout).toMatch(/^5 eval\(s\)/m); // the legacy scenarios only
    expect(before.stdout).not.toContain('[skill:');
    writeEval('ensemble-create-prd', { ...valid(), skill: 'ensemble-create-prd' });
    const r = runDry([]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/ensemble-create-prd \[skill: ensemble-create-prd\] graders: fileExists/);
    expect(r.stdout).toMatch(/^6 eval\(s\)/m);
  });

  test('a complete definition carries task, workspace, skill and checks', () => {
    const dir = writeEval('demo-skill', valid());
    const { evals, rejected } = load();
    expect(rejected).toEqual([]);
    expect(evals[0]).toMatchObject({
      id: 'demo-skill', skill: 'demo-skill', package: 'demo', prompt: 'Write a summary of the repo',
      fixtureDir: path.join(dir, 'fixture'), invocation: 'plain',
    });
    expect(evals[0].checks).toHaveLength(1);
  });

  test.each([
    ['task', { ...valid(), prompt: undefined }, {}],
    ['workspace', valid(), { fixture: false }],
    ['skill', { ...valid(), skill: undefined }, {}],
    ['checks', { ...valid(), checks: [] }, {}],
  ])('a definition missing its %s is rejected naming the eval and the part, and does not load', (part, def, opts) => {
    writeEval('broken-eval', def, opts);
    const { evals, rejected } = load();
    expect(evals).toEqual([]);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].error).toBeInstanceOf(EvalDefinitionError);
    expect(rejected[0].error.part).toBe(part);
    expect(rejected[0].error.message).toContain('broken-eval');
    expect(rejected[0].error.message).toContain(`missing ${part}`);
  });

  test('a rejected eval does not stop valid ones loading, and run.js reports it and runs nothing for it', () => {
    writeEval('demo-skill', valid());
    writeEval('broken-eval', { ...valid(), prompt: '' });
    expect(load().evals.map((e) => e.id)).toEqual(['demo-skill']);
    const r = runDry([]);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/REJECTED eval "broken-eval": missing task/);
    expect(r.stdout).not.toMatch(/^\s+broken-eval /m);
  });

  test('an unknown skill is rejected naming the skill', () => {
    writeEval('ghost-eval', { ...valid(), skill: 'no-such-skill' });
    expect(rejection('ghost-eval').error.message).toMatch(/no-such-skill/);
    expect(rejection('ghost-eval').error.part).toBe('skill');
  });

  test('invalid JSON, unknown fields and bad values are rejected with the field named', () => {
    fs.mkdirSync(path.join(skillsDir, 'bad-json'), { recursive: true });
    fs.writeFileSync(path.join(skillsDir, 'bad-json/eval.json'), '{ nope');
    writeEval('typo', { ...valid(), promt: 'x' });
    writeEval('bad-repeats', { ...valid(), repeats: 0 });
    writeEval('bar-high', { ...valid(), repeats: 3, bar: 4 });
    writeEval('bad-check', { ...valid(), checks: [{ type: 'madeUp' }] });
    expect(rejection('bad-json').error.message).toMatch(/not valid JSON/);
    expect(rejection('typo').error.part).toBe('promt');
    expect(rejection('bad-repeats').error.part).toBe('repeats');
    expect(rejection('bar-high').error.part).toBe('bar');
    expect(rejection('bad-check').error.message).toMatch(/unknown check type "madeUp"/);
  });

  test('invocation defaults to plain, plain forbids a slash command, explicit requires a command', () => {
    const dir = path.join(tmp, 'e');
    fs.mkdirSync(path.join(dir, 'fixture'), { recursive: true });
    const opts = { repoRoot: repo };
    expect(validateEvalDef(valid(), dir, opts).invocation).toBe('plain');
    expect(() => validateEvalDef({ ...valid(), prompt: '/ensemble:create-prd x' }, dir, opts)).toThrow(/plain language/);
    expect(() => validateEvalDef({ ...valid(), invocation: 'explicit' }, dir, opts)).toThrow(/requires `command`/);
    expect(() => validateEvalDef({ ...valid(), invocation: 'sometimes' }, dir, opts)).toThrow(/invocation must be/);
    const ex = validateEvalDef({ ...valid(), invocation: 'explicit', command: '/ensemble:demo' }, dir, opts);
    expect(evalToScenario(ex).prompt).toBe('/ensemble:demo Write a summary of the repo');
    expect(evalToScenario(validateEvalDef(valid(), dir, opts)).prompt).toBe('Write a summary of the repo');
  });

  test('skills only present in aggregate or generated packages do not count as shipped', () => {
    fs.mkdirSync(path.join(repo, 'packages/full/skills/only-in-full'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'packages/full/skills/only-in-full/SKILL.md'), 'x');
    writeEval('copy-eval', { ...valid(), skill: 'only-in-full' });
    expect(rejection('copy-eval').error.part).toBe('skill');
  });

  test('legacy scenarios still load and are not skill evals', () => {
    const { loadScenarios } = require('../run');
    const legacy = loadScenarios();
    expect(legacy.length).toBeGreaterThanOrEqual(5);
    expect(legacy.every((s) => s.skill === undefined)).toBe(true);
    const r = runDry(['--skill', 'fix-issue']);
    expect(r.status).toBe(2); // legacy ids are not skills
    expect(r.stderr).toMatch(/no eval for skill: fix-issue/);
  });
});

describe('check classification (TRD-002)', () => {
  test('verdict comes from deterministic checks; a failing judged check does not change it', () => {
    const graders = [{ type: 'fileExists', pass: true }, { type: 'judge', judged: true, pass: false, score: 0.1, judgeModel: 'j' }];
    expect(summarizeRun(graders)).toMatchObject({ pass: true, verdict: 'pass', judgedScore: 0.1, judgeModel: 'j' });
    // and the reverse: a failing deterministic check fails the run however well the judge scored it
    const failing = [{ type: 'fileExists', pass: false }, { type: 'judge', judged: true, pass: true, score: 1, judgeModel: 'j' }];
    expect(summarizeRun(failing)).toMatchObject({ pass: false, verdict: 'fail', judgedScore: 1 });
    // judged results alone never produce a pass
    expect(summarizeRun([{ type: 'judge', judged: true, pass: true, score: 1 }]).pass).toBe(false);
  });

  test('an eval with only judged checks is rejected with the deterministic-check rule', () => {
    writeEval('judged-only', { ...valid(), checks: [{ type: 'judge', rubric: 'Is it good?' }] });
    expect(rejection('judged-only').error.message).toMatch(/a deterministic check is required/);
  });

  test('a judged check needs a rubric; with one it loads and is marked judged', () => {
    writeEval('no-rubric', { ...valid(), checks: [...valid().checks, { type: 'judge' }] });
    expect(rejection('no-rubric').error.part).toBe('rubric');
    writeEval('with-rubric', { ...valid(), checks: [...valid().checks, { type: 'judge', rubric: 'Is it concise?' }] });
    writeEval('rubric-file', { ...valid(), checks: [...valid().checks, { type: 'judge' }] }, { rubric: 'Is it accurate?' });
    const { evals } = load();
    const loaded = evals.find((e) => e.id === 'with-rubric');
    expect(loaded.checks[1]).toMatchObject({ type: 'judge', judged: true, rubric: 'Is it concise?' });
    expect(evals.find((e) => e.id === 'rubric-file').checks[1].rubric).toBe('Is it accurate?');
    // a non-judge type cannot be flagged judged
    writeEval('mislabelled', { ...valid(), checks: [...valid().checks, { type: 'fileExists', path: 'x', judged: true, rubric: 'r' }] });
    expect(rejection('mislabelled').error.message).toMatch(/type must be "judge"/);
  });

  test('a judged result is marked judged by runGraders and reported apart from the verdict', async () => {
    const ctx = { dir: tmp, repoRoot: repo, baseline: {}, transcript: '', judge: { bin: 'x', model: 'j', refusal: 'conflict' } };
    const results = await runGraders([{ type: 'fileExists', path: 'repo' }, { type: 'judge', rubric: 'r' }], ctx);
    expect(results[0].judged).toBeUndefined();
    expect(results[1].judged).toBe(true);
    const run = summarizeRun(results);
    expect(run.verdict).toBe('pass');
    expect(run.judgedScore).toBeNull();
  });
});

describe('scaffold (TRD-004)', () => {
  test('writes eval.json and fixture/, rejected until placeholders are filled, then loads', () => {
    const dir = scaffold('demo-skill', { skillsDir, repoRoot: repo });
    expect(fs.existsSync(path.join(dir, 'fixture'))).toBe(true);
    const def = JSON.parse(fs.readFileSync(path.join(dir, 'eval.json'), 'utf8'));
    for (const field of ['id', 'skill', 'prompt', 'checks']) expect(def[field]).toBeDefined();
    expect(def.skill).toBe('demo-skill');

    // unfilled placeholders are rejected, so an untouched skeleton cannot run
    expect(rejection('demo-skill').error.part).toBe('placeholder');

    def.description = 'Checks the demo skill writes a summary';
    def.prompt = 'Write a summary of the repo';
    def.checks[0].path = 'SUMMARY.md';
    fs.writeFileSync(path.join(dir, 'eval.json'), JSON.stringify(def));
    const { evals, rejected } = load();
    expect(rejected).toEqual([]);
    expect(evals[0]).toMatchObject({ id: 'demo-skill', skill: 'demo-skill', prompt: 'Write a summary of the repo' });
  });

  test('refuses an unknown skill, a bad name, and an existing eval', () => {
    expect(() => scaffold('ghost', { skillsDir, repoRoot: repo })).toThrow(/unknown skill "ghost"/);
    expect(() => scaffold('../escape', { skillsDir, repoRoot: repo })).toThrow(/invalid skill name/);
    scaffold('demo-skill', { skillsDir, repoRoot: repo });
    expect(() => scaffold('demo-skill', { skillsDir, repoRoot: repo })).toThrow(/already exists/);
  });

  test('node evals/new.js exits 2 for an unknown skill', () => {
    const out = spawnSync('node', [path.join(__dirname, '../new.js'), 'ghost'], { encoding: 'utf8' });
    expect(out.status).toBe(2);
    expect(out.stderr).toMatch(/unknown skill "ghost"/);
  });
});
