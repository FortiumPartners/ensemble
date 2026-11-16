'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { resolveJudge, parseScore } = require('../lib/runners/judge');
const { judge } = require('../lib/graders');

const RUN = path.join(__dirname, '../run.js');

let tmp; let skillsDir; let bin;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'evals-judge-'));
  skillsDir = path.join(tmp, 'skills');
  bin = path.join(tmp, 'bin');
  fs.mkdirSync(bin);
  // Stub claude: answers the judge prompt with a score, and acts as the agent otherwise (writes SUMMARY.md).
  fs.writeFileSync(path.join(bin, 'claude'), `#!/bin/sh
echo "$@" >> "${tmp}/calls.txt"
case "$*" in
  *"You are grading"*)
    cat <<'JSON'
{"type":"result","result":"{\\"score\\": 0.8, \\"reason\\": \\"clear\\"}","total_cost_usd":0.01}
JSON
    ;;
  *)
    echo done > SUMMARY.md
    echo '{"type":"result","num_turns":1,"total_cost_usd":0.02,"is_error":false}'
    ;;
esac
`, { mode: 0o755 });
  const dir = path.join(skillsDir, 'ensemble-create-prd');
  fs.mkdirSync(path.join(dir, 'fixture'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'eval.json'), JSON.stringify({
    skill: 'ensemble-create-prd',
    prompt: 'Write a summary of the repo',
    checks: [{ type: 'fileExists', path: 'SUMMARY.md' }, { type: 'judge', rubric: 'Is the summary clear?' }],
  }));
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

function runEvals(args, env = {}) {
  const r = spawnSync('node', [RUN, '--skill', 'ensemble-create-prd', ...args], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, EVALS_SKILLS_DIR: skillsDir, EVALS_RESULTS_DIR: path.join(tmp, 'results'), EVALS_JUDGE_MODEL: '', ...env },
  });
  const dir = path.join(tmp, 'results');
  const rep = fs.existsSync(dir) ? JSON.parse(fs.readFileSync(path.join(dir, fs.readdirSync(dir)[0]), 'utf8')) : null;
  return { ...r, rep };
}

describe('resolveJudge', () => {
  test('allows a different model, from the flag or the environment', () => {
    expect(resolveJudge({ judgeModel: 'opus', model: 'sonnet', env: {} })).toEqual({ model: 'opus', refusal: null });
    expect(resolveJudge({ model: 'sonnet', env: { EVALS_JUDGE_MODEL: 'opus' } }).refusal).toBeNull();
    expect(resolveJudge({ judgeModel: 'a', env: { EVALS_JUDGE_MODEL: 'b' } }).model).toBe('a');
  });
  test('refuses the model under test (ignoring case) and a missing judge, naming the conflict', () => {
    expect(resolveJudge({ judgeModel: 'Sonnet', model: 'sonnet', env: {} }).refusal).toMatch(/"Sonnet" is the model under test/);
    expect(resolveJudge({ model: 'sonnet', env: {} }).refusal).toMatch(/no judge model configured/);
  });
  test('refuses when no model under test is given, and for alias spellings of it; allows a different family', () => {
    expect(resolveJudge({ judgeModel: 'opus', env: {} }).refusal).toMatch(/pass --model so the judge can be compared/);
    expect(resolveJudge({ judgeModel: 'sonnet', model: 'claude-sonnet-5-5', env: {} }).refusal).toMatch(/is the model under test/);
    expect(resolveJudge({ judgeModel: 'claude-sonnet-4-20250514', model: 'sonnet', env: {} }).refusal).toMatch(/is the model under test/);
    expect(resolveJudge({ judgeModel: 'claude-opus-4-1', model: 'claude-sonnet-5-5', env: {} }).refusal).toBeNull();
    expect(resolveJudge({ judgeModel: 'opus', model: 'claude-opus-4-1[1m]', env: {} }).refusal).toMatch(/is the model under test/);
  });
  test('parseScore handles braces in the reason and picks a later valid object', () => {
    expect(parseScore('{"score": 0.7, "reason": "uses {x} and }"}')).toEqual({ score: 0.7, reason: 'uses {x} and }' });
    expect(parseScore('prefix {not json} {"score": 0.1, "reason": "a {b}"}')).toEqual({ score: 0.1, reason: 'a {b}' });
  });
  test('parseScore takes the first valid score and ignores out-of-range ones', () => {
    expect(parseScore('noise {"score": 2} then {"score": 0.4, "reason": "r"}')).toEqual({ score: 0.4, reason: 'r' });
    expect(parseScore('no json')).toBeNull();
  });
});

describe('judge grader', () => {
  test('a stub judge different from the run model scores and records the judge model', async () => {
    const r = await judge({ dir: tmp, transcript: 't', judge: { bin: path.join(bin, 'claude'), model: 'opus', refusal: null } }, { rubric: 'Is it clear?' });
    expect(r).toMatchObject({ judged: true, score: 0.8, judgeModel: 'opus', pass: true, costUsd: 0.01 });
    const call = fs.readFileSync(path.join(tmp, 'calls.txt'), 'utf8');
    expect(call).toMatch(/--model opus/);
    expect(call).toContain('Is it clear?');
  });
  test('a refusal makes no model call', async () => {
    const r = await judge({ dir: tmp, transcript: '', judge: { bin: path.join(bin, 'claude'), model: 'x', refusal: 'conflict' } }, { rubric: 'r' });
    expect(r).toMatchObject({ judged: true, refused: true, score: null, pass: false });
    expect(r.detail).toMatch(/refused: conflict/);
    expect(fs.existsSync(path.join(tmp, 'calls.txt'))).toBe(false);
  });
});

describe('run with a judged check', () => {
  test('different judge: verdict from deterministic check, judged score and judge model reported apart', () => {
    const r = runEvals(['--model', 'sonnet', '--judge-model', 'opus']);
    expect(r.status).toBe(0);
    expect(r.rep.results[0]).toMatchObject({ verdict: 'pass', pass: true, judgedScore: 0.8, judgeModel: 'opus' });
    expect(r.rep.results[0].graders.find((g) => g.type === 'judge')).toMatchObject({ judged: true, judgeModel: 'opus', score: 0.8 });
    expect(r.rep.results[0].costUsd).toBeCloseTo(0.03);
    expect(r.stderr).not.toMatch(/REFUSED/);
  });

  test('judge equal to the model under test is refused at start, naming the conflict; deterministic checks still run', () => {
    const r = runEvals(['--model', 'sonnet', '--judge-model', 'sonnet']);
    expect(r.stderr).toMatch(/REFUSED judged checks \(ensemble-create-prd\): judge model "sonnet" is the model under test/);
    expect(r.status).toBe(0); // the deterministic check passed, so the eval passes
    const res = r.rep.results[0];
    expect(res).toMatchObject({ verdict: 'pass', judgedScore: null });
    expect(res.graders.find((g) => g.type === 'fileExists').pass).toBe(true);
    expect(res.graders.find((g) => g.type === 'judge')).toMatchObject({ judged: true, refused: true, score: null });
    // the judge model was never called
    expect(fs.readFileSync(path.join(tmp, 'calls.txt'), 'utf8')).not.toContain('You are grading');
  });

  test('without --model the judged check is refused and deterministic checks still run', () => {
    const r = runEvals(['--judge-model', 'opus']);
    expect(r.stderr).toMatch(/REFUSED judged checks .*pass --model so the judge can be compared/);
    expect(r.status).toBe(0);
    expect(r.rep.results[0].graders.find((g) => g.type === 'judge')).toMatchObject({ refused: true });
  });

  test('no judge configured is refused too; EVALS_JUDGE_MODEL is honoured', () => {
    expect(runEvals(['--model', 'sonnet']).stderr).toMatch(/no judge model configured/);
    fs.rmSync(path.join(tmp, 'results'), { recursive: true });
    const ok = runEvals(['--model', 'sonnet'], { EVALS_JUDGE_MODEL: 'opus' });
    expect(ok.rep.results[0].judgeModel).toBe('opus');
  });

  test('a failing deterministic check fails the eval even when the judge scores it high', () => {
    fs.writeFileSync(path.join(skillsDir, 'ensemble-create-prd/eval.json'), JSON.stringify({
      skill: 'ensemble-create-prd', prompt: 'x',
      checks: [{ type: 'fileExists', path: 'MISSING.md' }, { type: 'judge', rubric: 'r' }],
    }));
    const r = runEvals(['--model', 'sonnet', '--judge-model', 'opus']);
    expect(r.status).toBe(1);
    expect(r.rep.results[0]).toMatchObject({ verdict: 'fail', judgedScore: 0.8 });
  });
});
