'use strict';

/**
 * PR 5 behavior: version hashes and the result schema (TRD-014-TEST), committed baseline summaries (TRD-015-TEST).
 * A stub `claude` stands in for the model; baselines and logs go to scratch directories, never into the repository.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const hash = require('../lib/hash');
const results = require('../lib/results');
const arms = require('../lib/arms');
const { findSkillPackages } = require('../lib/eval-def');

const RUN = path.join(__dirname, '../run.js');
const REPO_ROOT = path.resolve(__dirname, '../..');
const SCRATCH = path.join(os.homedir(), '.omp', 'trd-skills-eval', 'jest');
const SKILL = 'ensemble-create-prd';
const PKG_DIR = path.join(REPO_ROOT, 'packages', findSkillPackages(SKILL)[0]);
const QUALIFIED = `ensemble-product:${SKILL}`;

let root;
beforeEach(() => {
  fs.mkdirSync(SCRATCH, { recursive: true });
  root = fs.mkdtempSync(path.join(SCRATCH, 'r-'));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
const sub = (...p) => path.join(root, ...p);
const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };

// ---- stub suite ------------------------------------------------------------------------------------------------

const initLine = (skills, plugins, model = 'claude-stub-1') => JSON.stringify({ type: 'system', subtype: 'init', skills, plugins: plugins || [], ...(model && { model }) });
const invokeLine = (name) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Skill', input: { skill: name } }] } });
const resultLine = () => JSON.stringify({ type: 'result', num_turns: 1, total_cost_usd: 0.01 });
const WITH = [initLine([QUALIFIED], [{ name: 'ensemble-product', path: PKG_DIR }]), invokeLine(QUALIFIED), resultLine()];
const BASE = [initLine(['verify']), resultLine()];

/** Run run.js against a stub claude: the with-skill arm writes SUMMARY.md (so it passes), the baseline does not. */
function runSuite(args = ['--repeats', '2', '--concurrency', '1'], env = {}, { base = BASE } = {}) {
  fs.mkdirSync(sub('bin'), { recursive: true });
  const emit = (lines) => lines.map((l) => `echo '${l.replace(/'/g, "'\\''")}'`).join('\n');
  write(sub('bin/claude'), `#!/bin/sh
case "$*" in *--plugin-dir*) echo ok > SUMMARY.md
${emit(WITH)};;
*) ${emit(base)};;
esac
`);
  fs.chmodSync(sub('bin/claude'), 0o755);
  write(sub('skills', SKILL, 'fixture', 'seed.txt'), 'seed\n');
  write(sub('skills', SKILL, 'eval.json'), JSON.stringify({ skill: SKILL, prompt: 'Write a summary of the repo', checks: [{ type: 'fileExists', path: 'SUMMARY.md' }] }));
  fs.mkdirSync(sub('scenarios'), { recursive: true });
  const r = spawnSync('node', [RUN, '--skill', SKILL, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env, CI: 'false', GITHUB_ACTIONS: 'false', PATH: `${sub('bin')}:${process.env.PATH}`, EVALS_WORKDIR: sub('work'),
      EVALS_RESULTS_DIR: sub('results'), EVALS_BASELINES_DIR: sub('baselines'), EVALS_SCENARIOS_DIR: sub('scenarios'), EVALS_SKILLS_DIR: sub('skills'), ...env,
    },
  });
  const logs = fs.existsSync(sub('results')) ? fs.readdirSync(sub('results')) : [];
  return { ...r, logs, log: logs[0] ? path.join(sub('results'), logs[0]) : null };
}

/** An eval-level result as arms.summarizeEval builds it, from per-arm outcome lists. */
function evalResult(runtime, withOutcomes, baseOutcomes, { repeats = withOutcomes.length, bar = 2, id = SKILL } = {}) {
  const mk = (arm, outcomes) => outcomes.map((outcome, i) => ({ evalId: id, arm, run: i + 1, runtime, model: 'm', invocationMode: 'plain', outcome, invoked: false, costUsd: 0.01, durationMs: 5, graders: [] }));
  return arms.summarizeEval({ id, skill: SKILL, invocation: 'plain' }, { repeats, bar, repeatsSource: 'test', barSource: 'test' },
    { 'with-skill': mk('with-skill', withOutcomes), baseline: mk('baseline', baseOutcomes) }, { runtime });
}
const CTX = { skillHash: 'a'.repeat(64), packageHash: 'd'.repeat(64), skillVersion: '1.2.3', evalVersion: 'b'.repeat(64), model: 'm', recordedAt: '2026-11-13T00:00:00.000Z' };

// ---- TRD-014-TEST ----------------------------------------------------------------------------------------------

describe('TRD-014 hashes', () => {
  const tree = (dir, files) => { for (const [f, t] of Object.entries(files)) write(path.join(dir, f), t); return dir; };

  test('same content, different location and mtime, same hash; any content change moves it', () => {
    const a = tree(sub('a'), { 'SKILL.md': 'x\n', 'refs/one.md': '1\n' });
    const b = tree(sub('b'), { 'refs/one.md': '1\n', 'SKILL.md': 'x\n' });
    fs.utimesSync(path.join(b, 'SKILL.md'), new Date(2001, 1, 1), new Date(2001, 1, 1));
    expect(hash.hashTree(a)).toBe(hash.hashTree(b));
    write(path.join(b, 'refs/one.md'), '2\n');
    expect(hash.hashTree(a)).not.toBe(hash.hashTree(b));
    expect(hash.hashTree(tree(sub('c'), { 'SKILL.md': 'x\n', 'refs/one.md': '1\n', 'extra.md': '' }))).not.toBe(hash.hashTree(a));
  });

  test('CRLF and LF checkouts hash the same; a binary file is hashed as bytes', () => {
    const lf = tree(sub('lf'), { 'SKILL.md': 'a\nb\n' });
    const crlf = tree(sub('crlf'), { 'SKILL.md': 'a\r\nb\r\n' });
    expect(hash.hashTree(lf)).toBe(hash.hashTree(crlf));
    const bin1 = sub('bin1'); fs.mkdirSync(bin1); fs.writeFileSync(path.join(bin1, 'x.bin'), Buffer.from([0, 13, 10, 1]));
    const bin2 = sub('bin2'); fs.mkdirSync(bin2); fs.writeFileSync(path.join(bin2, 'x.bin'), Buffer.from([0, 10, 1]));
    expect(hash.hashTree(bin1)).not.toBe(hash.hashTree(bin2));
  });

  test('only OS junk is ignored: .DS_Store does not change the hash, a dotfile does', () => {
    const a = tree(sub('a'), { 'SKILL.md': 'x\n' });
    const before = hash.hashTree(a);
    write(path.join(a, '.DS_Store'), 'junk');
    expect(hash.hashTree(a)).toBe(before);
    write(path.join(a, '.hidden'), 'm');
    expect(hash.hashTree(a)).not.toBe(before);
  });

  test('a symlink is never followed: one leaving the tree is a named error; one inside hashes as its relative target', () => {
    const a = tree(sub('a'), { 'SKILL.md': 'x\n' });
    write(sub('outside.txt'), 'secret');
    fs.symlinkSync(sub('outside.txt'), path.join(a, 'escape'));
    expect(() => hash.hashTree(a)).toThrow(/symlink escape points outside the hashed tree/);
    fs.rmSync(path.join(a, 'escape'));
    fs.symlinkSync('SKILL.md', path.join(a, 'alias'));
    const h1 = hash.hashTree(a);
    const b = tree(sub('b'), { 'SKILL.md': 'x\n' });
    fs.symlinkSync('SKILL.md', path.join(b, 'alias'));
    expect(hash.hashTree(b)).toBe(h1); // the absolute location of the tree does not enter the hash
  });

  test('a missing directory is a named error, not an empty hash', () => {
    expect(() => hash.hashTree(sub('nope'))).toThrow(hash.HashError);
    expect(() => hash.evalHash(sub('nope'))).toThrow(/eval directory not found: nope/);
    expect(() => results.evaluatedCopy({ repoRoot: REPO_ROOT, packageName: 'product', skill: 'does-not-exist' })).toThrow(/skill directory not found: does-not-exist/);
  });

  test('evalHash covers eval.json, rubric.md (absent differs from empty) and the fixture', () => {
    const dir = sub('e');
    write(path.join(dir, 'eval.json'), '{"a":1}\n');
    write(path.join(dir, 'fixture/seed.txt'), 's\n');
    const base = hash.evalHash(dir);
    write(path.join(dir, 'rubric.md'), '');
    const withEmpty = hash.evalHash(dir);
    expect(withEmpty).not.toBe(base);
    write(path.join(dir, 'rubric.md'), 'r\n');
    expect(hash.evalHash(dir)).not.toBe(withEmpty);
    write(path.join(dir, 'fixture/seed.txt'), 't\n');
    const afterFixture = hash.evalHash(dir);
    expect(afterFixture).not.toBe(hash.hashTree(dir));
    write(path.join(dir, 'eval.json'), '{"a":2}\n');
    expect(hash.evalHash(dir)).not.toBe(afterFixture);
  });
});

describe('TRD-014 result schema', () => {
  test('Scenario: result records what it ran against (stub run stored)', () => {
    const r = runSuite();
    expect(r.status).toBe(0);
    const records = results.readRecords(r.log);
    expect(records).toHaveLength(4); // 2 arms x 2 repeats
    const w = records.find((x) => x.arm === 'with-skill');
    expect(w).toMatchObject({
      evalId: SKILL, skill: SKILL, runtime: 'claude', model: 'claude-stub-1', arm: 'with-skill', invocationMode: 'plain', run: 1, outcome: 'pass', invoked: true, judgeModel: null,
    });
    expect(w.costUsd).toBe(0.01);
    expect(w.skillHash).toBe(hash.skillHash(path.join(PKG_DIR, 'skills', SKILL)));
    expect(w.evalVersion).toBe(hash.evalHash(sub('skills', SKILL)));
    expect(w).toHaveProperty('skillVersion'); // may be null, the key is always there
    expect(w.replay).toMatchObject({ evalId: SKILL, arm: 'with-skill', run: 1 });
    expect(records.find((x) => x.arm === 'baseline').outcome).toBe('fail');
  });

  test('stored records and committed summaries hold no absolute home path and no credential value', () => {
    const secret = 'sk-test-SECRETVALUE-123456';
    const r = runSuite(undefined, { ANTHROPIC_API_KEY: secret });
    const texts = [JSON.stringify(JSON.parse(fs.readFileSync(r.log, 'utf8')).records), ...fs.readdirSync(sub('baselines', 'claude')).map((f) => fs.readFileSync(sub('baselines', 'claude', f), 'utf8'))];
    for (const t of texts) {
      expect(t).not.toContain(os.homedir());
      expect(t).not.toContain(secret);
    }
    expect(fs.readFileSync(r.log, 'utf8')).not.toContain(secret); // the full log is redacted too
  });

  test('sanitize strips another author\'s home path, the repo root and credential values from every string and key', () => {
    const out = results.sanitize({ 'k /Users/bob/x': ['/home/alice/p/q', `${REPO_ROOT}/evals`, 'tok-SECRET-1'] }, { secrets: ['tok-SECRET-1'], repoRoot: REPO_ROOT });
    const text = JSON.stringify(out);
    expect(text).not.toMatch(/bob|alice|SECRET/);
    expect(text).toContain('<repo>/evals');
    expect(text).toContain('~/p/q');
  });

  test('Scenario: incomplete stored result rejected, naming the missing field and the file', () => {
    const r = runSuite();
    const records = results.readRecords(r.log);
    const file = sub('one.json');
    write(file, JSON.stringify(records[0]));
    expect(results.readResult(file)).toMatchObject({ evalId: SKILL });
    const { evalVersion, ...without } = records[0];
    write(file, JSON.stringify(without));
    expect(() => results.readResult(file)).toThrow(/one\.json: missing field "evalVersion"/);
    expect(evalVersion).toMatch(/^[0-9a-f]{64}$/);
    for (const f of ['skillHash', 'skillVersion', 'model', 'arm', 'runtime', 'outcome', 'costUsd', 'judgeModel', 'run']) {
      const { [f]: _gone, ...rest } = records[0];
      write(file, JSON.stringify(rest));
      expect(() => results.readResult(file)).toThrow(new RegExp(`missing field "${f}"`));
    }
  });

  test('invalid values, unknown runtime and corrupt files are rejected by name', () => {
    const r = runSuite();
    const rec = results.readRecords(r.log)[0];
    const file = sub('x.json');
    write(file, JSON.stringify({ ...rec, outcome: 'pass-ish' }));
    expect(() => results.readResult(file)).toThrow(/invalid field "outcome"/);
    write(file, JSON.stringify({ ...rec, runtime: 'cursor' }));
    expect(() => results.readResult(file)).toThrow(/unknown value in field "runtime"/);
    write(file, '{not json');
    expect(() => results.readResult(file)).toThrow(/x\.json: not valid JSON/);
  });

  test('unverifiable and aborted runs are stored as incomplete, never pass or fail; unknown outcomes are errors', () => {
    const ctx = { skill: SKILL, skillVersion: null, skillHash: 'h', evalVersion: 'e' };
    const run = { evalId: SKILL, arm: 'baseline', run: 1, runtime: 'claude', model: 'm', invocationMode: 'plain', invoked: false, costUsd: 0, durationMs: 1, graders: [] };
    for (const outcome of ['unverifiable', 'aborted']) {
      expect(results.buildResult({ ...run, outcome }, ctx)).toMatchObject({ outcome: 'incomplete', incompleteReason: outcome });
    }
    expect(() => results.buildResult({ ...run, outcome: 'maybe' }, ctx)).toThrow(/unknown outcome "maybe"/);
  });
});

// ---- TRD-015-TEST ----------------------------------------------------------------------------------------------

describe('TRD-015 baseline summaries', () => {
  test('Scenario: summary written, logs kept out of the repo', () => {
    const r = runSuite();
    expect(r.status).toBe(0);
    const file = sub('baselines', 'claude', `${SKILL}.json`);
    expect(fs.existsSync(file)).toBe(true);
    const summary = results.readBaseline(file);
    expect(summary).toMatchObject({ skill: SKILL, runtime: 'claude', model: 'claude-stub-1', repeats: 2, withSkill: { passes: 2, runs: 2 }, baseline: { passes: 0, runs: 2 }, uplift: 1 });
    // the summary is small: no per-run logs
    expect(Object.keys(summary)).not.toEqual(expect.arrayContaining(['runs', 'records', 'graders', 'transcript']));
    // full logs exist only under results/, and results/ is gitignored
    expect(r.logs).toHaveLength(1);
    expect(fs.readdirSync(sub('baselines', 'claude'))).toEqual([`${SKILL}.json`]);
    expect(fs.readFileSync(path.join(REPO_ROOT, 'evals/.gitignore'), 'utf8')).toMatch(/^results\/$/m);
    expect(fs.existsSync(path.join(REPO_ROOT, 'evals/baselines', 'claude', `${SKILL}.json`))).toBe(false); // nothing leaked into the repo
  });

  test('a stub suite run with only EVALS_RESULTS_DIR set keeps its baselines beside the results, not in the repository', () => {
    const r = runSuite(undefined, { EVALS_BASELINES_DIR: '' });
    expect(r.status).toBe(0);
    expect(fs.existsSync(sub('baselines', 'claude', `${SKILL}.json`))).toBe(true);
  });

  test('Scenario: check reads the committed summary', () => {
    const dir = sub('baselines');
    const committed = results.toBaselineSummary(evalResult('claude', ['pass', 'pass', 'pass'], ['fail', 'fail', 'fail'], { bar: 2 }), CTX);
    results.writeBaseline(dir, committed);
    const good = evalResult('claude', ['pass', 'pass', 'fail'], ['fail', 'fail', 'fail'], { bar: 2 });
    expect(results.checkAgainstBaseline(dir, good, CTX).status).toBe('ok');
    const bad = evalResult('claude', ['fail', 'fail', 'pass'], ['fail', 'fail', 'fail'], { bar: 2 });
    const reg = results.checkAgainstBaseline(dir, bad, CTX);
    expect(reg.status).toBe('regression');
    // editing the committed file changes the answer: the comparison reads that file
    const file = sub('baselines/claude', `${SKILL}.json`);
    fs.writeFileSync(file, JSON.stringify({ ...committed, reliable: false, uplift: 0, withSkill: { passes: 0, runs: 3 } }));
    expect(results.checkAgainstBaseline(dir, bad, CTX).status).toBe('ok');
    fs.writeFileSync(file, JSON.stringify({ ...committed, evalVersion: 'c'.repeat(64) }));
    expect(results.checkAgainstBaseline(dir, good, CTX)).toMatchObject({ status: 'not-comparable', reasons: [expect.stringContaining('evalVersion')] });
    fs.rmSync(file);
    expect(results.checkAgainstBaseline(dir, good, CTX).status).toBe('no-baseline');
  });

  test('a corrupt or malformed committed summary is an error naming the file, not an empty baseline', () => {
    const dir = sub('baselines');
    const file = path.join(dir, 'claude', `${SKILL}.json`);
    write(file, '{oops');
    expect(() => results.loadBaseline(dir, 'claude', SKILL)).toThrow(new RegExp(`${SKILL}\\.json: not valid JSON`));
    write(file, JSON.stringify({ skill: SKILL }));
    expect(() => results.loadBaseline(dir, 'claude', SKILL)).toThrow(/missing field "skillVersion"|missing field "skillHash"/);
    expect(() => results.checkAgainstBaseline(dir, evalResult('claude', ['pass', 'pass'], ['fail', 'fail']), CTX)).toThrow(/missing field/);
    const good = results.toBaselineSummary(evalResult('claude', ['pass', 'pass'], ['fail', 'fail']), CTX);
    write(file, JSON.stringify({ ...good, runtime: 'pi', granularity: 'skill' })); // stored at the wrong path
    expect(() => results.loadBaseline(dir, 'claude', SKILL)).toThrow(/stored at a different path/);
  });

  test('Scenario: granularity recorded (Claude package, Pi skill)', () => {
    const dir = sub('baselines');
    for (const runtime of ['claude', 'pi']) {
      results.writeBaseline(dir, results.toBaselineSummary(evalResult(runtime, ['pass', 'pass'], ['fail', 'fail']), CTX));
    }
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'claude', `${SKILL}.json`), 'utf8'))).toMatchObject({ runtime: 'claude', granularity: 'package' });
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'pi', `${SKILL}.json`), 'utf8'))).toMatchObject({ runtime: 'pi', granularity: 'skill' });
    expect(runSuite().status).toBe(0);
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'claude', `${SKILL}.json`), 'utf8')).granularity).toBe('package');
    // a stored granularity that contradicts the runtime is corrupt
    const file = path.join(dir, 'pi', `${SKILL}.json`);
    fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(fs.readFileSync(file, 'utf8')), granularity: 'package' }));
    expect(() => results.readBaseline(file)).toThrow(/granularity "package" does not match runtime pi/);
    expect(() => results.granularityFor('opencode')).toThrow(/unknown runtime "opencode"/);
  });

  test('incomplete, aborted and unverifiable evals are never written as a baseline', () => {
    const cases = [
      evalResult('claude', ['pass', 'pass'], ['fail', 'incomplete']), // a baseline run never completed
      evalResult('claude', ['pass', 'pass'], ['fail', 'unverifiable']),
      evalResult('claude', ['pass'], ['fail'], { repeats: 2, bar: 2 }), // not every planned run executed
    ];
    for (const e of cases) expect(() => results.toBaselineSummary(e, CTX)).toThrow(results.BaselineError);
    const aborted = { ...evalResult('claude', ['pass', 'pass'], ['fail', 'fail']), abort: 'leak' };
    expect(() => results.toBaselineSummary(aborted, CTX)).toThrow(/baseline arm aborted/);
  });

  test('end to end: a suite whose baseline arm shows no skill list aborts and writes no summary and no passing record', () => {
    const r = runSuite(undefined, {}, { base: [resultLine()] });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/baseline isolation unverifiable/);
    expect(fs.existsSync(sub('baselines'))).toBe(false);
    const records = results.readRecords(r.log);
    expect(records.filter((x) => x.arm === 'baseline').map((x) => x.outcome)).toEqual(expect.not.arrayContaining(['pass', 'fail']));
    expect(r.stdout).toMatch(/baseline summary not written/);
  });

  test('paths stay inside the baselines tree and names are validated', () => {
    const dir = sub('baselines');
    for (const skill of ['../escape', 'a/b', '', '..', 'x y']) expect(() => results.baselinePath(dir, 'claude', skill)).toThrow(/invalid skill name/);
    expect(() => results.baselinePath(dir, '../claude', 'x')).toThrow(/unknown runtime/);
    expect(results.baselinePath(dir, 'pi', 'x.y_z-1')).toBe(path.join(dir, 'pi', 'x.y_z-1.json'));
  });
});
