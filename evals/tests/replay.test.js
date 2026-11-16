'use strict';

/** TRD-020-TEST: the replay handle. The printed command is parsed and executed through `sh -c` with the same stub. */

const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');
const results = require('../lib/results');
const { createSuite, REPO_ROOT, SKILL } = require('./stub-suite');

const ARGS = ['--repeats', '2', '--concurrency', '1', '--model', 'claude-stub-1'];
const SECRET = 'sk-ant-replaytestsecret0123456789';

let t;
beforeEach(() => { t = createSuite(); });
afterEach(() => t.cleanup());

/** The `replay:` command lines printed under "failing runs", with the label line above each. */
const printed = (stdout) => {
  const lines = stdout.split('\n');
  const out = [];
  lines.forEach((l, i) => { const m = /^ {4}replay: (.*)$/.exec(l); if (m) out.push({ label: lines[i - 1].trim(), command: m[1] }); });
  return out;
};

describe('every failing run prints a command that reruns exactly that run (AC-021-1)', () => {
  test('a failing stub run: the printed command, parsed and executed with the same stub, runs the same eval, arm, runtime, model and repeat index', () => {
    const first = t.run(ARGS, { pass: false });
    expect(first.status).toBe(1);
    const cmds = printed(first.stdout);
    expect(cmds).toHaveLength(2); // with-skill runs 1 and 2 failed; a failing baseline arm is a measurement, not a failure
    expect(cmds.map((c) => c.label)).toEqual([
      `${SKILL} [with-skill run 1/2]: fail`, `${SKILL} [with-skill run 2/2]: fail`,
    ]);
    const second = cmds.find((c) => /run 2\/2/.test(c.label));
    expect(second.command).toBe(`node evals/run.js --scenario '${SKILL}' --runtime 'claude' --model 'claude-stub-1' --arm 'with-skill' --run-index '2' --repeats '2' --timeout '900' --run-usd '5' --refresh`);

    // The same command, as text, through the shell, with the same stub: exactly one run, the same one.
    t.resetCalls();
    const replayed = t.exec(second.command, { });
    expect(t.calls()).toEqual(['with-skill']); // one model call, the with-skill arm only
    expect(replayed.status).toBe(1); // it fails again: the stub still fails
    const doc = replayed.doc();
    expect(doc.records).toHaveLength(1);
    expect(doc.records[0]).toMatchObject({ evalId: SKILL, skill: SKILL, arm: 'with-skill', run: 2, runtime: 'claude', model: 'claude-stub-1', outcome: 'fail' });
    expect(doc.replay).toEqual({ scenario: SKILL, arm: 'with-skill', runIndex: 2 });
    // The replayed run's own record carries the same replay command (a replay of a replay is the same run).
    expect(doc.records[0].replay.command).toBe(second.command);
    expect(replayed.stdout).toMatch(/replay ensemble-create-prd \[with-skill 2\]: FAIL/);
  });

  test('a replay of a run that now passes exits 0; the check can fail (a failing stub exits 1)', () => {
    const first = t.run(ARGS, { pass: false });
    const cmd = printed(first.stdout)[0].command;
    t.resetCalls();
    const ok = t.exec(cmd);
    expect(ok.status).toBe(1);
    // Same command, a stub that now passes: only the with-skill arm of run 1 executes and the exit is 0.
    t.run(['--dry-run'], { pass: true }); // rewrites the stub (and nothing else)
    t.resetCalls();
    const fixed = t.exec(cmd);
    expect(fixed.status).toBe(0);
    expect(t.calls()).toEqual(['with-skill']);
    expect(fixed.doc().records[0]).toMatchObject({ arm: 'with-skill', run: 1, outcome: 'pass' });
  });

  test('a timed-out baseline run prints a replay that reruns that baseline arm and run', () => {
    const first = t.run(['--repeats', '1', '--concurrency', '1', '--model', 'claude-stub-1', '--timeout', '1'], { hang: true });
    expect(first.status).toBe(1);
    const cmds = printed(first.stdout);
    const base = cmds.find((c) => /\[baseline run 1\/1\]/.test(c.label));
    expect(base).toBeDefined();
    expect(base.command).toContain("--arm 'baseline' --run-index '1'");
    t.resetCalls();
    const replayed = t.exec(base.command);
    expect(t.calls()).toEqual(['baseline']);
    expect(replayed.doc().records).toHaveLength(1);
    expect(replayed.doc().records[0]).toMatchObject({ arm: 'baseline', run: 1, evalId: SKILL });
    // A baseline run that timed out is unverifiable (isolation cannot be confirmed), so the replay is incomplete: exit 4, never a pass.
    expect(replayed.status).toBe(4);
    expect(first.stdout).toMatch(/\[baseline run 1\/1\]: unverifiable/);
  });

  test('a replay is always fresh: it ignores the cache, writes no cache entry and no baseline, and does not run a regression check', () => {
    expect(t.run(ARGS).status).toBe(0);
    const entries = t.entries().map((e) => fs.readFileSync(e.file, 'utf8'));
    const baseline = fs.readFileSync(t.sub('baselines', 'claude', `${SKILL}.json`), 'utf8');
    t.resetCalls();
    const r = t.run([...ARGS, '--scenario', SKILL, '--arm', 'baseline', '--run-index', '2'], { die: true });
    expect(t.calls()).toEqual(['baseline']); // the stored result was NOT reused
    expect(t.entries().map((e) => fs.readFileSync(e.file, 'utf8'))).toEqual(entries);
    expect(fs.readFileSync(t.sub('baselines', 'claude', `${SKILL}.json`), 'utf8')).toBe(baseline);
    expect(r.stdout).not.toMatch(/regression check|baseline summary|reusing stored/);
    // With no committed baseline a replay must not create one (it would be a one-run summary).
    fs.rmSync(t.sub('baselines'), { recursive: true, force: true });
    t.run([...ARGS, '--scenario', SKILL, '--arm', 'with-skill', '--run-index', '1']);
    expect(fs.existsSync(t.sub('baselines'))).toBe(false);
  });

  test('a failing legacy scenario prints a replay that is just the scenario', () => {
    t.write(t.sub('scenarios', 'bad', 'scenario.json'), JSON.stringify({ description: 'x', type: 'cli', graders: [{ type: 'fileExists', path: 'nope.txt' }] }));
    t.write(t.sub('scenarios', 'bad', 'fixture', 'seed.txt'), 'seed\n');
    const r = t.run(['--scenario', 'bad', '--model', 'claude-stub-1'], { scenario: false });
    expect(r.status).toBe(1);
    const [c] = printed(r.stdout);
    expect(c.label).toBe('bad: fail');
    expect(c.command).toBe("node evals/run.js --scenario 'bad' --runtime 'claude' --model 'claude-stub-1' --timeout '900' --run-usd '5' --refresh");
    const again = t.exec(c.command);
    expect(again.status).toBe(1);
    expect(again.stdout).toMatch(/running bad/);
  });
});

describe('the command is safe to paste', () => {
  test('every value is single-quoted; nothing but flags and quoted values; no secret, home or repository path', () => {
    const first = t.run(ARGS, { pass: false, env: { ANTHROPIC_API_KEY: SECRET } });
    const cmds = printed(first.stdout);
    expect(cmds.length).toBeGreaterThan(0);
    for (const { command } of cmds) {
      expect(command).toMatch(/^node evals\/run\.js( --[a-z-]+ '[^']*')+ --refresh$/);
      for (const bad of [SECRET, os.homedir(), REPO_ROOT, process.env.HOME]) expect(command).not.toContain(bad);
      expect(command).not.toMatch(/\$|`|;|&|\||\\|\n/);
    }
    const log = JSON.stringify(first.doc());
    expect(log).not.toContain(SECRET);
    expect(first.stdout + first.stderr).not.toContain(SECRET);
  });

  test('shellQuote yields one literal word whatever the value holds (checked by a real shell)', () => {
    for (const v of ["a'b", '$(touch /nonexistent/x)', '`id`', 'a b', '*', '; rm -rf x', '"q"', '\\', '-n', 'tab\there']) {
      const r = spawnSync('sh', ['-c', `printf '%s' ${results.shellQuote(v)}`], { encoding: 'utf8' });
      expect(r.stdout).toBe(v);
    }
  });

  test('a value that is not plain (spaces, quotes, $, backticks, newline, control characters, too long) gives no command rather than an unsafe one', () => {
    const ok = { evalId: 'e1', runtime: 'claude', model: 'claude-sonnet-4-5', arm: 'baseline', run: 1, repeats: 3, timeoutSec: 60, runUsd: 5 };
    expect(results.replayCommand(ok)).toBe("node evals/run.js --scenario 'e1' --runtime 'claude' --model 'claude-sonnet-4-5' --arm 'baseline' --run-index '1' --repeats '3' --timeout '60' --run-usd '5' --refresh");
    for (const model of ["m'; touch x; '", '$(id)', '`id`', 'a b', 'a\nb', 'a\u0000b', 'x'.repeat(201), '']) {
      const cmd = results.replayCommand({ ...ok, model });
      if (model === '') expect(cmd).not.toContain('--model'); // no requested model: no flag
      else expect({ model, cmd }).toEqual({ model, cmd: null });
    }
    expect(results.replayCommand({ ...ok, evalId: "e';x" })).toBeNull();
    expect(results.replayCommand({ ...ok, run: undefined })).toBeNull();
    // A provider/id model name and a bracketed variant are plain.
    expect(results.replayCommand({ ...ok, model: 'anthropic/claude-sonnet-4' })).toContain("--model 'anthropic/claude-sonnet-4'");
  });

  test('a model that cannot be quoted prints the reason instead of a command', () => {
    const first = t.run(['--repeats', '1', '--concurrency', '1', '--model', 'claude-stub-1 x'], { pass: false });
    expect(first.status).toBe(1);
    expect(first.stdout).toMatch(/replay: unavailable/);
    expect(first.stdout).not.toMatch(/replay: node/);
  });
});

describe('replay flags are validated (exit 2, nothing run)', () => {
  test.each([
    [['--scenario', SKILL, '--arm', 'baseline'], /--arm and --run-index go together/],
    [['--scenario', SKILL, '--run-index', '1'], /--arm and --run-index go together/],
    [['--scenario', SKILL, '--arm', 'both', '--run-index', '1'], /--arm must be one of/],
    [['--scenario', SKILL, '--arm', 'baseline', '--run-index', '0'], /--run-index must be a positive integer/],
  ])('%j', (extra, message) => {
    const r = t.run([...ARGS, ...extra]);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(message);
    expect(t.calls()).toEqual([]);
  });

  test('--run-index beyond the repeats, no --scenario, and a legacy scenario are refused', () => {
    expect(t.run([...ARGS, '--scenario', SKILL, '--arm', 'baseline', '--run-index', '3']).status).toBe(2);
    const noScenario = t.run([...ARGS, '--arm', 'baseline', '--run-index', '1']);
    expect(noScenario.status).toBe(2);
    expect(noScenario.stderr).toMatch(/need --scenario/);
    t.write(t.sub('scenarios', 'bad', 'scenario.json'), JSON.stringify({ description: 'x', type: 'cli', graders: [{ type: 'fileExists', path: 'nope.txt' }] }));
    t.write(t.sub('scenarios', 'bad', 'fixture', 'seed.txt'), 'seed\n');
    const legacy = t.run(['--scenario', 'bad', '--arm', 'baseline', '--run-index', '1'], { scenario: false });
    expect(legacy.status).toBe(2);
    expect(legacy.stderr).toMatch(/legacy scenario/);
  });
});
