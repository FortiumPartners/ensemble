'use strict';

/** Review fixes after PR 5: baseline overwrite policy, recorded model, symlink safety, baseline consistency, sanitize, coverage, hashes. */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const hash = require('../lib/hash');
const results = require('../lib/results');
const arms = require('../lib/arms');
const report = require('../lib/report');
const coverage = require('../lib/coverage');
const claude = require('../lib/runners/claude');
const pi = require('../lib/runners/pi');
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
  root = fs.mkdtempSync(path.join(SCRATCH, 'f-'));
});
afterEach(() => { jest.restoreAllMocks(); fs.rmSync(root, { recursive: true, force: true }); });
const sub = (...p) => path.join(root, ...p);
const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
const BASELINE_FILE = () => sub('baselines', 'claude', `${SKILL}.json`);

// ---- stub suite ------------------------------------------------------------------------------------------------

const initLine = (skills, plugins, model) => JSON.stringify({ type: 'system', subtype: 'init', skills, plugins: plugins || [], ...(model && { model }) });
const invokeLine = (name) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Skill', input: { skill: name } }] } });
const resultLine = () => JSON.stringify({ type: 'result', num_turns: 1, total_cost_usd: 0.01 });

/** Run run.js against a stub claude. { model: id the stub reports (null = none), pass: with-skill arm succeeds, stderr } */
function runSuite(args = ['--repeats', '2', '--concurrency', '1'], { model = 'claude-stub-1', pass = true, stderr = '', env = {} } = {}) {
  fs.mkdirSync(sub('bin'), { recursive: true });
  const emit = (lines) => lines.map((l) => `echo '${l.replace(/'/g, "'\\''")}'`).join('\n');
  const withLines = [initLine([QUALIFIED], [{ name: 'ensemble-product', path: PKG_DIR }], model), invokeLine(QUALIFIED), resultLine()];
  const baseLines = [initLine(['verify'], [], model), resultLine()];
  write(sub('bin/claude'), `#!/bin/sh
${stderr ? `echo '${stderr}' >&2` : ''}
case "$*" in *--plugin-dir*) ${pass ? 'echo ok > SUMMARY.md' : ':'}
${emit(withLines)};;
*) ${emit(baseLines)};;
esac
`);
  fs.chmodSync(sub('bin/claude'), 0o755);
  if (!fs.existsSync(sub('skills', SKILL, 'eval.json'))) {
    write(sub('skills', SKILL, 'fixture', 'seed.txt'), 'seed\n');
    write(sub('skills', SKILL, 'eval.json'), JSON.stringify({ skill: SKILL, prompt: 'Write a summary of the repo', checks: [{ type: 'fileExists', path: 'SUMMARY.md' }] }));
  }
  fs.mkdirSync(sub('scenarios'), { recursive: true });
  fs.rmSync(sub('results'), { recursive: true, force: true });
  const r = spawnSync('node', [RUN, '--skill', SKILL, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env, CI: 'false', GITHUB_ACTIONS: 'false', PATH: `${sub('bin')}:${process.env.PATH}`, EVALS_WORKDIR: sub('work'),
      EVALS_RESULTS_DIR: sub('results'), EVALS_BASELINES_DIR: sub('baselines'), EVALS_SCENARIOS_DIR: sub('scenarios'), EVALS_SKILLS_DIR: sub('skills'), ...env,
    },
  });
  const logs = fs.existsSync(sub('results')) ? fs.readdirSync(sub('results')) : [];
  return { ...r, log: logs[0] ? path.join(sub('results'), logs[0]) : null };
}

const evalResult = (runtime, withOutcomes, baseOutcomes, { repeats = withOutcomes.length, bar = 2, model = 'm' } = {}) => {
  const mk = (arm, outcomes) => outcomes.map((outcome, i) => ({ evalId: SKILL, arm, run: i + 1, runtime, model, invocationMode: 'plain', outcome, invoked: false, costUsd: 0.01, durationMs: 5, graders: [] }));
  return arms.summarizeEval({ id: SKILL, skill: SKILL, invocation: 'plain' }, { repeats, bar, repeatsSource: 'test', barSource: 'test' },
    { 'with-skill': mk('with-skill', withOutcomes), baseline: mk('baseline', baseOutcomes) }, { runtime });
};
const CTX = { skillHash: 'a'.repeat(64), packageHash: 'd'.repeat(64), skillVersion: null, evalVersion: 'b'.repeat(64), model: 'm', recordedAt: '2026-11-13T00:00:00.000Z' };
const goodSummary = (over = {}) => ({ ...results.toBaselineSummary(evalResult('claude', ['pass', 'pass', 'fail'], ['fail', 'fail', 'pass'], { bar: 2 }), CTX), ...over });

// ---- S1 / S2: when a baseline may be written; the recorded model -----------------------------------------------

describe('S1 baseline overwrite policy and exit codes', () => {
  test('no committed baseline and a known model: written, exit 0', () => {
    const r = runSuite();
    expect(r.status).toBe(0);
    expect(results.readBaseline(BASELINE_FILE())).toMatchObject({ model: 'claude-stub-1', reliable: true });
    expect(r.stdout).toMatch(/regression check vs committed summary: no-baseline/);
  });

  test('ok: a comparable, still reliable result replaces the committed file', () => {
    expect(runSuite().status).toBe(0);
    const first = results.readBaseline(BASELINE_FILE());
    const stamp = '2001-01-01T00:00:00.000Z';
    write(BASELINE_FILE(), JSON.stringify({ ...first, recordedAt: stamp }));
    const r = runSuite();
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/regression check vs committed summary: ok/);
    expect(results.readBaseline(BASELINE_FILE()).recordedAt).not.toBe(stamp);
  });

  test('regression: exit 1, printed prominently, the committed file is not overwritten', () => {
    expect(runSuite().status).toBe(0);
    const before = fs.readFileSync(BASELINE_FILE(), 'utf8');
    const r = runSuite(undefined, { pass: false });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/REGRESSION ensemble-create-prd \[claude\]/);
    expect(r.stdout).toMatch(/baseline summary NOT written \(a regression/);
    expect(fs.readFileSync(BASELINE_FILE(), 'utf8')).toBe(before);
  });

  test('regression with --update-baselines: the file is replaced and the regression still exits 1', () => {
    expect(runSuite().status).toBe(0);
    const r = runSuite(['--repeats', '2', '--concurrency', '1', '--update-baselines'], { pass: false });
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/replaced by --update-baselines/);
    expect(results.readBaseline(BASELINE_FILE())).toMatchObject({ reliable: false });
  });

  test('not-comparable (a different model): reason printed, file unchanged, exit unchanged (0)', () => {
    expect(runSuite().status).toBe(0);
    const before = fs.readFileSync(BASELINE_FILE(), 'utf8');
    const r = runSuite(undefined, { model: 'claude-other-2' });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/not-comparable \(model differs \(committed claude-stub-1, now claude-other-2\)/);
    expect(r.stdout).toMatch(/NOT written \(the result is not-comparable\)/);
    expect(fs.readFileSync(BASELINE_FILE(), 'utf8')).toBe(before);
  });

  test('not-comparable with --update-baselines replaces the file', () => {
    expect(runSuite().status).toBe(0);
    const r = runSuite(['--repeats', '2', '--concurrency', '1', '--update-baselines'], { model: 'claude-other-2' });
    expect(r.status).toBe(0);
    expect(results.readBaseline(BASELINE_FILE()).model).toBe('claude-other-2');
  });

  test('a store error outranks a failing eval: exit 2, both reported', () => {
    fs.mkdirSync(sub('elsewhere'), { recursive: true });
    fs.symlinkSync(sub('elsewhere'), sub('baselines'));
    const r = runSuite(undefined, { pass: false });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/RESULT NOT STORED[^\n]*baselines root is a symlink/);
    expect(r.stderr).toMatch(/exit 2 outranks exit 1/);
    expect(fs.readdirSync(sub('elsewhere'))).toEqual([]);
  });

  test('a failing eval alone (no store problem) still exits 1', () => {
    expect(runSuite(undefined, { pass: false }).status).toBe(1);
  });

  test('an eval whose copy cannot be hashed is skipped like a rejected definition: exit 2, no crash', () => {
    write(sub('skills', SKILL, 'fixture', 'seed.txt'), 'seed\n');
    write(sub('real-eval.json'), JSON.stringify({ skill: SKILL, prompt: 'Write a summary of the repo', checks: [{ type: 'fileExists', path: 'SUMMARY.md' }] }));
    fs.mkdirSync(sub('skills', SKILL), { recursive: true });
    fs.symlinkSync(sub('real-eval.json'), sub('skills', SKILL, 'eval.json'));
    const r = runSuite();
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/REJECTED eval "ensemble-create-prd": .*eval\.json is a symlink/);
    expect(fs.existsSync(sub('baselines'))).toBe(false);
  });
});

describe('S2 recorded model', () => {
  test('the model the runtime reported is recorded on every record, not the literal "default"', () => {
    const r = runSuite();
    const log = JSON.parse(fs.readFileSync(r.log, 'utf8'));
    expect(log.records.map((x) => x.model)).toEqual(Array(4).fill('claude-stub-1'));
    expect(log.requestedModel).toBeNull();
  });

  test('no reported model: recorded as "unknown", and no baseline is written', () => {
    const r = runSuite(undefined, { model: null });
    expect(r.status).toBe(0);
    expect(JSON.parse(fs.readFileSync(r.log, 'utf8')).records.every((x) => x.model === 'unknown')).toBe(true);
    expect(fs.existsSync(BASELINE_FILE())).toBe(false);
    expect(r.stdout).toMatch(/NOT written \(the runtime reported no \(or no single\) model id/);
  });

  test('an unknown model is written only with --update-baselines', () => {
    const r = runSuite(['--repeats', '2', '--concurrency', '1', '--update-baselines'], { model: null });
    expect(r.status).toBe(0);
    expect(results.readBaseline(BASELINE_FILE()).model).toBe('unknown');
  });

  test('unknown is not comparable to anything, itself included', () => {
    const a = goodSummary({ model: 'unknown' });
    expect(results.compareSummaries(a, a)).toMatchObject({ status: 'not-comparable', reasons: [expect.stringContaining('unknown')] });
    expect(results.compareSummaries(goodSummary(), a).status).toBe('not-comparable');
    expect(results.compareSummaries(a, goodSummary()).status).toBe('not-comparable');
    expect(results.compareSummaries(goodSummary(), goodSummary()).status).toBe('ok');
  });

  test('evalModel: one reported id wins; none or a mix is unknown', () => {
    expect(results.evalModel([{ model: 'a' }, { model: 'a' }, { model: 'unknown' }])).toBe('a');
    expect(results.evalModel([{ model: 'a' }, { model: 'b' }])).toBe('unknown');
    expect(results.evalModel([{ model: 'unknown' }])).toBe('unknown');
    expect(results.evalModel([])).toBe('unknown');
  });

  test('Claude reads the model from the init event; Pi from the assistant message (provider-qualified)', () => {
    const c = claude.createStreamScanner();
    c.feed(initLine(['x'], [], 'claude-opus-test'));
    expect(c.result().model).toBe('claude-opus-test');
    const none = claude.createStreamScanner();
    none.feed(initLine(['x']));
    expect(none.result().model).toBeNull();
    const p = pi.createStreamScanner();
    p.feed(JSON.stringify({ type: 'message_end', message: { role: 'assistant', content: [], provider: 'anthropic', model: 'sonnet-test', usage: {} } }));
    expect(p.result().model).toBe('anthropic/sonnet-test');
    const q = pi.createStreamScanner();
    q.feed(JSON.stringify({ type: 'message_end', message: { role: 'assistant', content: [], usage: {} } }));
    expect(q.result().model).toBeNull();
  });
});

describe('packageHash', () => {
  test('a changed packageHash is not-comparable for package granularity; informational for skill-level Pi', () => {
    const committed = goodSummary();
    expect(committed.packageHash).toBe('d'.repeat(64));
    const changed = { ...committed, packageHash: 'e'.repeat(64) };
    expect(results.compareSummaries(committed, changed)).toMatchObject({ status: 'not-comparable', reasons: [expect.stringContaining('packageHash differs')] });
    const piA = results.toBaselineSummary(evalResult('pi', ['pass', 'pass'], ['fail', 'fail']), CTX);
    expect(results.compareSummaries(piA, { ...piA, packageHash: 'e'.repeat(64) }).status).toBe('ok');
  });

  test('a package-level summary without packageHash is invalid; evaluatedCopy computes it over the whole package', () => {
    const { packageHash, ...rest } = goodSummary();
    expect(packageHash).toBeDefined();
    expect(() => results.validateBaseline(rest, 'f.json')).toThrow(/f\.json: missing field "packageHash"/);
    expect(results.evaluatedCopy({ repoRoot: REPO_ROOT, packageName: path.basename(PKG_DIR), skill: SKILL }).packageHash).toBe(hash.packageHash(PKG_DIR));
  });

  test('the end-to-end baseline records the package hash of the evaluated package', () => {
    expect(runSuite().status).toBe(0);
    expect(results.readBaseline(BASELINE_FILE()).packageHash).toBe(hash.packageHash(PKG_DIR));
  });
});

// ---- S3: symlinks and special files -----------------------------------------------------------------------------

describe('S3a baseline store is symlink safe', () => {
  const dir = () => sub('baselines');
  test('a symlinked baselines root is refused by write, load and loadAll', () => {
    fs.mkdirSync(sub('real'));
    fs.symlinkSync(sub('real'), dir());
    expect(() => results.writeBaseline(dir(), goodSummary())).toThrow(/baselines root is a symlink/);
    expect(() => results.loadBaseline(dir(), 'claude', SKILL)).toThrow(/baselines root is a symlink/);
    expect(() => results.loadAllBaselines(dir())).toThrow(/baselines root is a symlink/);
    expect(fs.readdirSync(sub('real'))).toEqual([]);
  });

  test('a symlinked runtime directory is refused (write, load and loadAll)', () => {
    fs.mkdirSync(dir()); fs.mkdirSync(sub('real'));
    fs.symlinkSync(sub('real'), path.join(dir(), 'claude'));
    expect(() => results.writeBaseline(dir(), goodSummary())).toThrow(/claude directory is a symlink/);
    expect(() => results.loadBaseline(dir(), 'claude', SKILL)).toThrow(/claude directory is a symlink/);
    expect(() => results.loadAllBaselines(dir())).toThrow(/claude is a symlink/);
    expect(fs.readdirSync(sub('real'))).toEqual([]);
  });

  test('a symlinked baseline file is refused and its target is not touched', () => {
    write(sub('target.json'), 'precious');
    fs.mkdirSync(path.join(dir(), 'claude'), { recursive: true });
    fs.symlinkSync(sub('target.json'), path.join(dir(), 'claude', `${SKILL}.json`));
    expect(() => results.writeBaseline(dir(), goodSummary())).toThrow(new RegExp(`${SKILL}\\.json is a symlink`));
    expect(fs.readFileSync(sub('target.json'), 'utf8')).toBe('precious');
    expect(() => results.loadBaseline(dir(), 'claude', SKILL)).toThrow(/is a symlink/);
    expect(() => results.readBaseline(path.join(dir(), 'claude', `${SKILL}.json`))).toThrow(/is a symlink/);
  });

  test('a dangling symlink in place of the file is an error, not "no baseline"', () => {
    fs.mkdirSync(path.join(dir(), 'claude'), { recursive: true });
    fs.symlinkSync(sub('missing.json'), path.join(dir(), 'claude', `${SKILL}.json`));
    expect(() => results.loadBaseline(dir(), 'claude', SKILL)).toThrow(/is a symlink/);
  });

  test('a FIFO is rejected without being opened (no hang); an oversize file is rejected before reading', () => {
    fs.mkdirSync(path.join(dir(), 'claude'), { recursive: true });
    const file = path.join(dir(), 'claude', `${SKILL}.json`);
    expect(spawnSync('mkfifo', [file]).status).toBe(0);
    expect(() => results.loadBaseline(dir(), 'claude', SKILL)).toThrow(/is not a regular file/);
    expect(() => results.writeBaseline(dir(), goodSummary())).toThrow(/is not a regular file/);
    fs.rmSync(file);
    fs.writeFileSync(file, Buffer.alloc(results.MAX_BASELINE_BYTES + 1, 32));
    expect(() => results.loadBaseline(dir(), 'claude', SKILL)).toThrow(/larger than/);
  });

  test('a write goes through a temp file and rename: nothing is left behind and a failed rename leaves no temp file', () => {
    const file = results.writeBaseline(dir(), goodSummary());
    expect(fs.readdirSync(path.dirname(file))).toEqual([`${SKILL}.json`]);
    const rename = jest.spyOn(fs, 'renameSync').mockImplementation(() => { throw new Error('boom'); });
    expect(() => results.writeBaseline(dir(), goodSummary())).toThrow(/boom/);
    expect(rename).toHaveBeenCalled();
    expect(fs.readdirSync(path.dirname(file))).toEqual([`${SKILL}.json`]);
  });
});

describe('S3b coverage refuses symlinks and strays', () => {
  const skill = (pkg, name) => write(sub('repo', 'packages', pkg, 'skills', name, 'SKILL.md'), `---\nname: ${name}\n---\n`);
  const run = () => coverage.computeCoverage({ repoRoot: sub('repo'), skillsDir: sub('evals', 'skills'), exemptionsFile: sub('exemptions.json') });

  test('a symlinked package directory is an error', () => {
    skill('core', 'alpha');
    fs.mkdirSync(sub('elsewhere', 'skills', 'sneaky'), { recursive: true });
    write(sub('elsewhere', 'skills', 'sneaky', 'SKILL.md'), 'x');
    fs.symlinkSync(sub('elsewhere'), sub('repo', 'packages', 'linked'));
    const c = run();
    expect(c.errors).toEqual([expect.stringContaining('packages/linked is a symlink')]);
    expect(c.rows.map((r) => r.skill)).toEqual(['alpha']);
  });

  test('a symlinked skills directory is an error', () => {
    skill('core', 'alpha');
    fs.mkdirSync(sub('elsewhere', 'sneaky'), { recursive: true });
    write(sub('elsewhere', 'sneaky', 'SKILL.md'), 'x');
    fs.mkdirSync(sub('repo', 'packages', 'dev'), { recursive: true });
    fs.symlinkSync(sub('elsewhere'), sub('repo', 'packages', 'dev', 'skills'));
    expect(run().errors).toEqual([expect.stringContaining('packages/dev/skills is a symlink')]);
  });

  test('a stray non-directory entry inside skills/ is an error; .gitkeep is not', () => {
    skill('core', 'alpha');
    write(sub('repo', 'packages', 'core', 'skills', 'NOTES.md'), 'x');
    write(sub('repo', 'packages', 'core', 'skills', '.gitkeep'), '');
    expect(run().errors).toEqual([expect.stringContaining('packages/core/skills/NOTES.md is a stray non-directory entry')]);
  });

  test('the CLI exits 2 for each', () => {
    skill('core', 'alpha');
    write(sub('repo', 'packages', 'core', 'skills', 'NOTES.md'), 'x');
    jest.spyOn(console, 'log').mockImplementation(() => {});
    expect(require('../coverage').main([], { repoRoot: sub('repo'), skillsDir: sub('evals', 'skills'), exemptionsFile: sub('exemptions.json') })).toBe(2);
  });
});

describe('S3c hash.js refuses symlinked eval files', () => {
  const evalDir = () => {
    write(sub('e', 'eval.json'), '{"a":1}\n');
    write(sub('e', 'fixture', 'seed.txt'), 's\n');
    return sub('e');
  };
  test('a symlinked eval.json is a named error', () => {
    const dir = evalDir();
    fs.renameSync(path.join(dir, 'eval.json'), sub('real.json'));
    fs.symlinkSync(sub('real.json'), path.join(dir, 'eval.json'));
    expect(() => hash.evalHash(dir)).toThrow(/eval\.json is a symlink; symlinks are never followed/);
  });
  test('a symlinked rubric.md is a named error', () => {
    const dir = evalDir();
    write(sub('real.md'), 'r');
    fs.symlinkSync(sub('real.md'), path.join(dir, 'rubric.md'));
    expect(() => hash.evalHash(dir)).toThrow(/rubric\.md is a symlink/);
  });
  test('a FIFO as eval.json or rubric.md is a named error', () => {
    const dir = evalDir();
    fs.rmSync(path.join(dir, 'eval.json'));
    expect(spawnSync('mkfifo', [path.join(dir, 'eval.json')]).status).toBe(0);
    expect(() => hash.evalHash(dir)).toThrow(/eval\.json is not a regular file/);
  });
  test('a plain eval still hashes, and a missing rubric.md is marked absent', () => {
    expect(hash.evalHash(evalDir())).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ---- S4: contradictions ---------------------------------------------------------------------------------------

describe('S4 validateBaseline rejects contradictory numbers', () => {
  const bad = (over, re) => expect(() => results.validateBaseline(goodSummary(over), 'f.json')).toThrow(re);
  test('the consistent summary is accepted', () => {
    expect(() => results.validateBaseline(goodSummary(), 'f.json')).not.toThrow();
  });
  test('an arm with runs < 1', () => {
    bad({ withSkill: { passes: 0, runs: 0 } }, /f\.json: invalid field "withSkill"/);
    bad({ baseline: { passes: 0, runs: 0 } }, /f\.json: invalid field "baseline"/);
  });
  test('arm runs differing from repeats', () => {
    bad({ withSkill: { passes: 2, runs: 2 }, uplift: 2 / 2 - 1 / 3 }, /f\.json: runs differ from repeats \(3\) in field "withSkill\.runs"/);
    bad({ baseline: { passes: 1, runs: 4 }, uplift: 2 / 3 - 1 / 4 }, /field "baseline\.runs"/);
  });
  test('reliable contradicting passes against the bar', () => {
    bad({ reliable: false }, /f\.json: value contradicts withSkill\.passes \(2\) against bar \(2\) in field "reliable"/);
    bad({ withSkill: { passes: 1, runs: 3 }, uplift: 1 / 3 - 1 / 3 }, /field "reliable"/);
  });
  test('bar greater than repeats', () => {
    bad({ bar: 4 }, /f\.json: bar exceeds repeats or is not a positive integer in field "bar"/);
  });
  test('uplift not equal to the arm difference', () => {
    bad({ uplift: 0.9 }, /f\.json: value 0\.9 contradicts the arm counts .* in field "uplift"/);
    expect(() => results.validateBaseline(goodSummary({ uplift: 2 / 3 - 1 / 3 + 1e-12 }), 'f.json')).not.toThrow();
  });
  test('a contradictory committed file is rejected on read, naming the file', () => {
    write(BASELINE_FILE(), JSON.stringify(goodSummary({ uplift: 0.9 })));
    expect(() => results.loadBaseline(sub('baselines'), 'claude', SKILL)).toThrow(new RegExp(`${SKILL}\\.json: .*field "uplift"`));
  });
  test('report: a zero-run arm raises a named error, never NaN', () => {
    const row = report.rowFromBaseline(goodSummary());
    expect(report.formatReport({ rows: [row], granularities: ['package'] })).not.toMatch(/NaN/);
    expect(() => report.rowFromBaseline({ ...goodSummary(), withSkill: { passes: 0, runs: 0 } })).toThrow(results.ResultError);
    expect(() => report.formatReport({ rows: [{ ...row, withSkill: { passes: 0, runs: 0 } }], granularities: ['package'] })).toThrow(/cannot compute a percentage/);
  });
  test('report: a baseline row does not use the skill name as an eval id', () => {
    expect(report.rowFromBaseline(goodSummary()).evalId).toBeNull();
  });
});

// ---- sanitize, hash, coverage nits -----------------------------------------------------------------------------

describe('sanitize scrubs machine identity', () => {
  const clean = (v) => results.sanitize(v, { repoRoot: REPO_ROOT });
  test('/root, Windows paths, and the realpath form of the repo root', () => {
    expect(clean('open /root/.config/x and /root')).toBe('open ~/.config/x and ~');
    expect(clean('/var/root/keep')).toBe('/var/root/keep');
    expect(clean('C:\\Users\\Alice\\proj\\f.txt')).toBe('~\\proj\\f.txt');
    expect(clean('c:/Users/Alice/proj')).toBe('~/proj');
    const link = sub('repolink');
    fs.mkdirSync(sub('realrepo'));
    fs.symlinkSync(sub('realrepo'), link);
    const out = results.sanitize(`${fs.realpathSync(link)}/x and ${link}/y`, { repoRoot: link });
    expect(out).toBe('<repo>/x and <repo>/y');
  });
  test('the user name and host name as path components or words of length >= 4', () => {
    jest.spyOn(os, 'userInfo').mockReturnValue({ username: 'zelda_q' });
    jest.spyOn(os, 'hostname').mockReturnValue('castle-box.local');
    expect(clean('/srv/zelda_q/work by zelda_q on castle-box.local and castle-box')).toBe('/srv/<user>/work by <user> on <host> and <host>');
    expect(clean('zelda_qux stays')).toBe('zelda_qux stays');
    jest.spyOn(os, 'userInfo').mockReturnValue({ username: 'bob' });
    expect(clean('bob and bobby')).toBe('bob and bobby'); // under 4 characters: not scrubbed
  });
  test('the whole suite log is scrubbed: stderr, claudeResult and keys', () => {
    const r = runSuite(undefined, { stderr: 'oops at /Users/zed_x/secret and /root/.ssh' });
    const text = fs.readFileSync(r.log, 'utf8');
    expect(text).not.toMatch(/zed_x|\/root\//);
    expect(text).not.toContain(os.homedir());
    expect(text).toContain('stderr'); // the field is kept, only the path is scrubbed
  });
});

describe('hash: directories hash only through their files', () => {
  test('an empty directory does not change the hash (a fresh clone has none)', () => {
    write(sub('a', 'SKILL.md'), 'x\n');
    const before = hash.hashTree(sub('a'));
    fs.mkdirSync(sub('a', 'empty', 'nested'), { recursive: true });
    expect(hash.hashTree(sub('a'))).toBe(before);
    write(sub('a', 'empty', 'nested', 'f.txt'), 'y');
    expect(hash.hashTree(sub('a'))).not.toBe(before);
  });
  test('packageHash covers the whole package, not only a skill', () => {
    write(sub('p', 'skills', 's', 'SKILL.md'), 'x\n');
    write(sub('p', 'agents', 'a.md'), 'a\n');
    const h = hash.packageHash(sub('p'));
    expect(h).not.toBe(hash.skillHash(sub('p', 'skills', 's')));
    write(sub('p', 'agents', 'a.md'), 'b\n');
    expect(hash.packageHash(sub('p'))).not.toBe(h);
    expect(() => hash.packageHash(sub('nope'))).toThrow(/package directory not found/);
  });
});

describe('coverage nits', () => {
  const skill = (name) => write(sub('repo', 'packages', 'core', 'skills', name, 'SKILL.md'), `---\nname: ${name}\n---\n`);
  const run = () => coverage.computeCoverage({ repoRoot: sub('repo'), skillsDir: sub('evals', 'skills'), exemptionsFile: sub('exemptions.json') });
  const badEval = (name) => {
    write(sub('evals', 'skills', name, 'eval.json'), JSON.stringify({ skill: name, prompt: '', checks: [] }));
    write(sub('evals', 'skills', name, 'fixture', 'seed.txt'), 's\n');
  };

  test('an exemption does not hide a rejected eval: the row and the report carry the rejection', () => {
    skill('alpha');
    badEval('alpha');
    write(sub('exemptions.json'), JSON.stringify({ alpha: 'reason' }));
    const c = run();
    const row = c.rows[0];
    expect(row).toMatchObject({ status: 'exempt', reason: 'reason' });
    expect(row.rejection).toMatch(/eval "alpha"/);
    expect(coverage.formatCoverage(c)).toMatch(/REJECTED eval \(the exemption does not hide it\)/);
  });

  test('an eval whose skill is not shipped is an error', () => {
    skill('alpha');
    write(sub('exemptions.json'), '{}');
    badEval('ghost');
    expect(run().errors).toEqual([expect.stringContaining('evals/skills/ghost was rejected and names no shipped skill')]);
    write(sub('evals', 'skills', 'ghost', 'eval.json'), JSON.stringify({ skill: 'ghost', prompt: 'p', checks: [{ type: 'fileExists', path: 'x' }] }));
    expect(run().errors.join('\n')).toMatch(/ghost/);
  });

  test('control characters and ANSI sequences are stripped from exemption reasons', () => {
    skill('alpha');
    write(sub('exemptions.json'), JSON.stringify({ alpha: 'bad\u001b[31m red\u001b[0m\nFORGED line\u0007\u001b]0;title\u0007' }));
    const c = run();
    expect(c.rows[0].reason).toBe('bad red FORGED line');
    const printed = coverage.formatCoverage(c);
    expect(printed.includes('\u001b') || printed.includes('\u0007')).toBe(false);
  });
});

describe('delta review: identifiers survive sanitize; definition files are never followed', () => {
  test('a user or host name equal to a token of a skill or model name leaves the identifier intact', () => {
    jest.spyOn(os, 'userInfo').mockReturnValue({ username: 'runner' });
    const out = results.sanitize({ skill: 'test-runner', model: 'claude-runner-1', note: 'ran as runner in /x' }, { repoRoot: '/x/y' });
    expect(out.skill).toBe('test-runner');
    expect(out.model).toBe('claude-runner-1');
    expect(out.note).toBe('ran as <user> in /x');
  });

  test('exemptions.json as a symlink or FIFO is an error that does not quote the target', () => {
    write(sub('outside.json'), '{"secret-key": "secret value"}');
    fs.symlinkSync(sub('outside.json'), sub('exemptions.json'));
    expect(() => coverage.loadExemptions(sub('exemptions.json'))).toThrow(/symlink/);
    try { coverage.loadExemptions(sub('exemptions.json')); } catch (e) { expect(e.message).not.toMatch(/secret/); }
  });

  test('a symlinked eval.json is rejected and a symlinked rubric.md fails its eval', () => {
    const { loadEvalDefs } = require('../lib/eval-def');
    write(sub('outside.json'), '{"prompt":"x"}');
    fs.mkdirSync(sub('skills', 'a'), { recursive: true });
    fs.symlinkSync(sub('outside.json'), sub('skills', 'a', 'eval.json'));
    const r = loadEvalDefs({ skillsDir: sub('skills'), repoRoot: REPO_ROOT });
    expect(r.evals).toEqual([]);
    expect(String(r.rejected[0].error)).toMatch(/eval\.json is a symlink/);
  });
});
