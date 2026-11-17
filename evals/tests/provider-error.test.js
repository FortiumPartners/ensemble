'use strict';

/**
 * A run whose model call never happened (login missing, bad key, no credits, overload) is `incomplete` with a short
 * `provider error: ...` reason, never a skill failure: not counted toward reliability, exit 4, never cached or baselined.
 * Stub `claude` and `pi` binaries stand in for the runtimes; no model is ever called.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const claude = require('../lib/runners/claude');
const pi = require('../lib/runners/pi');
const envlib = require('../lib/env');

/* eslint-disable no-control-regex -- the tests assert that control characters are absent */
const RUN = path.join(__dirname, '../run.js');
const SCRATCH = path.join(os.homedir(), '.omp', 'trd-skills-eval', 'jest');
const SKILL = 'ensemble-create-prd';

let root;
beforeEach(() => {
  fs.mkdirSync(SCRATCH, { recursive: true });
  root = fs.mkdtempSync(path.join(SCRATCH, 'pe-'));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
const sub = (...p) => path.join(root, ...p);

const shq = (l) => `'${l.replace(/'/g, "'\\''")}'`;
const printLines = (lines) => `printf '%s\\n' ${lines.map(shq).join(' ')}`;

// ---- Claude stream lines --------------------------------------------------------------------------------------
const init = (skills) => JSON.stringify({ type: 'system', subtype: 'init', skills, plugins: [], model: 'claude-stub-1' });
const result = (o) => JSON.stringify({ type: 'result', subtype: 'success', is_error: false, num_turns: 1, total_cost_usd: 0.01, result: 'done', ...o });
const AUTH = { is_error: true, num_turns: 1, total_cost_usd: 0, result: 'Failed to authenticate. API Error: 401 {"error":{"message":"Missing Anthropic API Key"}}' };
// ---- Pi stream lines ------------------------------------------------------------------------------------------
const systemEvent = (names) => JSON.stringify({ type: 'message_end', message: { role: 'system', content: '', sections: { preamble: 'p', ...(names.length && { skills: `<available_skills>\n${names.map((n) => `<skill><name>${n}</name></skill>`).join('')}\n</available_skills>` }) } } });
const assistant = (extra = {}) => JSON.stringify({ type: 'message_end', message: { role: 'assistant', model: 'stub-model', provider: 'stub', content: [{ type: 'text', text: 'ok' }], stopReason: 'stop', usage: { cost: { total: 0.01 } }, ...extra } });
const PI402 = { content: [], stopReason: 'error', errorMessage: '402: {"message":"Insufficient credits. Add more using https://openrouter.ai/settings/credits"}', usage: { cost: { total: 0 } } };
const turnEnd = '{"type":"turn_end","message":{"role":"assistant"}}';

/**
 * Install both stubs. `withLines` / `baseLines`: what each arm prints; `write`: the with-skill arm writes SUMMARY.md.
 * `withSeq`: when given, per-call line sets for the with-skill arm (call n uses withSeq[n-1]).
 */
function install({ claudeWith = [init([`ensemble-product:${SKILL}`]), result({})], claudeBase, piWith, piBase, write = true, claudeWithSeq = null, sleep = false }) {
  fs.mkdirSync(sub('bin'), { recursive: true });
  const seq = claudeWithSeq
    ? `n=$(cat '${sub('n')}' 2>/dev/null || echo 0); n=$((n+1)); echo $n > '${sub('n')}'\ncase $n in ${claudeWithSeq.map((l, i) => `${i + 1}) ${l.write ? 'echo ok > SUMMARY.md; ' : ''}${printLines(l.lines)};;`).join(' ')} esac`
    : `${write ? 'echo ok > SUMMARY.md' : ':'}\n${printLines(claudeWith)}${sleep ? '\nsleep 30' : ''}`;
  fs.writeFileSync(sub('bin/claude'), `#!/bin/sh
case "$*" in *--plugin-dir*)
${seq}
;; *)
${printLines(claudeBase || [init(['verify']), result({})])}
;; esac
`, { mode: 0o755 });
  fs.writeFileSync(sub('bin/pi'), `#!/bin/sh
case "$*" in *--skill*) ${write ? 'echo ok > SUMMARY.md;' : ''} ${printLines(piWith || [systemEvent([SKILL]), assistant(), turnEnd])};;
*) ${printLines(piBase || [systemEvent([]), assistant(), turnEnd])};; esac
`, { mode: 0o755 });
}

function runEvals(args) {
  fs.mkdirSync(sub('skills', SKILL), { recursive: true });
  fs.cpSync(path.join(__dirname, '../skills', SKILL), sub('skills', SKILL), { recursive: true });
  fs.writeFileSync(sub('skills', SKILL, 'eval.json'), JSON.stringify({
    skill: SKILL, prompt: 'Write a summary of the repo', runtimes: ['claude', 'pi'], checks: [{ type: 'fileExists', path: 'SUMMARY.md' }],
  }));
  fs.mkdirSync(sub('scenarios'), { recursive: true });
  const env = {
    ...process.env, CI: 'false', GITHUB_ACTIONS: 'false', PATH: `${sub('bin')}:${process.env.PATH}`, EVALS_WORKDIR: sub('work'),
    EVALS_RESULTS_DIR: sub('results'), EVALS_SCENARIOS_DIR: sub('scenarios'), EVALS_SKILLS_DIR: sub('skills'),
    EVALS_PI_BIN: sub('bin/pi'), EVALS_CLAUDE_BIN: sub('bin/claude'),
  };
  const r = spawnSync('node', [RUN, '--skill', SKILL, '--concurrency', '1', '--model', 'stub-model', ...args], { encoding: 'utf8', env });
  const rf = fs.existsSync(sub('results')) ? fs.readdirSync(sub('results'))[0] : null;
  const report = rf ? JSON.parse(fs.readFileSync(sub('results', rf), 'utf8')) : null;
  const dirFiles = (d) => (fs.existsSync(sub(d)) ? fs.readdirSync(sub(d), { recursive: true }).filter((f) => !fs.statSync(sub(d, f)).isDirectory()) : []);
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, report, ev: report && report.results[0], cached: dirFiles('cache'), baselines: dirFiles('baselines') };
}
const withRuns = (r) => r.ev.runs.filter((x) => x.arm === 'with-skill');
const records = (r, arm) => r.report.records.filter((x) => x.arm === arm);

describe('Claude: a failed API call is incomplete, not a skill failure', () => {
  test('the 401 result line (Not logged in / Failed to authenticate) -> incomplete, exit 4, nothing cached or baselined, not counted', () => {
    install({ claudeWith: [init([`ensemble-product:${SKILL}`]), JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Not logged in · Please run /login' }] } }), result(AUTH)] });
    const r = runEvals(['--runtime', 'claude', '--repeats', '1']);
    expect(r.status).toBe(4);
    expect(r.ev.outcome).toBe('incomplete');
    expect(r.ev.withSkill).toMatchObject({ passes: 0, runs: 0, providerErrors: 1 });
    expect(r.stdout).toMatch(/\[with-skill 1\/1\] INCOMPLETE \(provider error: Failed to authenticate\. API Error: 401/);
    expect(r.stdout).not.toMatch(/\[with-skill 1\/1\] FAIL/);
    expect(r.stdout).toMatch(/1 run\(s\) hit a provider error/);
    expect(r.stdout).toMatch(/with-skill: 1 run\(s\) hit a provider error \(the model call failed\) and are not counted/); // per-skill report
    expect(r.stdout).not.toMatch(/cost cap/);
    expect(r.report.failed).toBe(0);
    expect(r.report.incomplete).toBe(1);
    const rec = records(r, 'with-skill')[0];
    expect(rec).toMatchObject({ outcome: 'incomplete', costUsd: 0 });
    expect(rec.incompleteReason).toMatch(/^provider error: Failed to authenticate/);
    expect(rec.costEstimated).toBeUndefined();
    expect(r.cached.filter((f) => /with/.test(f) || true).every((f) => !/incomplete/.test(f))).toBe(true);
    expect(r.baselines).toEqual([]);
    expect(r.stdout).not.toMatch(/^ {2}baseline summary: /m);
  });

  test('the incomplete run is not counted: 1 pass + 1 provider error under bar 2 of 2 is an undetermined (incomplete) eval, no baseline, the pass is not lost', () => {
    install({
      claudeWithSeq: [
        { write: true, lines: [init([`ensemble-product:${SKILL}`]), result({})] },
        { write: false, lines: [init([`ensemble-product:${SKILL}`]), result(AUTH)] },
      ],
    });
    const r = runEvals(['--runtime', 'claude', '--repeats', '2']);
    expect(r.status).toBe(4);
    expect(r.ev.outcome).toBe('incomplete');
    expect(r.ev.withSkill).toMatchObject({ passes: 1, runs: 1, providerErrors: 1 });
    expect(r.baselines).toEqual([]);
    expect(r.stdout).toMatch(/baseline summary not written/);
    expect(r.stdout).toMatch(/INCOMPLETE/);
  });

  test('a provider-failed baseline run is incomplete too (no startup event is demanded of a call that never happened)', () => {
    install({ claudeWith: [init([`ensemble-product:${SKILL}`]), result({})], claudeBase: [result(AUTH)] });
    const r = runEvals(['--runtime', 'claude', '--repeats', '1']);
    expect(r.status).toBe(4);
    expect(r.ev.outcome).toBe('pass'); // the with-skill verdict is decided; the baseline error only leaves the uplift undetermined
    expect(r.ev.baseline).toMatchObject({ runs: 0, providerErrors: 1, unverifiable: 0 });
    expect(r.ev.uplift).toBeNull();
    expect(records(r, 'baseline')[0].incompleteReason).toMatch(/^provider error:/);
    expect(r.baselines).toEqual([]);
  });

  test('a run that worked and failed its checks is still an ordinary fail (exit 1)', () => {
    install({ claudeWith: [init([`ensemble-product:${SKILL}`]), result({ num_turns: 4 })], write: false });
    const r = runEvals(['--runtime', 'claude', '--repeats', '1']);
    expect(r.status).toBe(1);
    expect(withRuns(r)[0].outcome).toBe('fail');
    expect(r.stdout).toMatch(/\[with-skill 1\/1\] FAIL/);
  });

  test('a max-turns stop stays the existing outcome even when its text mentions an API error', () => {
    install({ claudeWith: [init([`ensemble-product:${SKILL}`]), result({ subtype: 'error_max_turns', is_error: true, num_turns: 25, result: 'Reached max turns (25) after API Error 429 retries' })], write: false });
    const r = runEvals(['--runtime', 'claude', '--repeats', '1']);
    expect(r.status).toBe(1);
    expect(withRuns(r)[0].outcome).toBe('fail');
    expect(r.ev.withSkill.providerErrors).toBe(0);
  });

  test('a timeout stays timed_out even when an error result line was already printed', () => {
    install({ claudeWith: [init([`ensemble-product:${SKILL}`]), result(AUTH)], sleep: true, write: false });
    const r = runEvals(['--runtime', 'claude', '--repeats', '1', '--timeout', '2']);
    expect(withRuns(r)[0].outcome).toBe('timed_out');
    expect(r.ev.withSkill.providerErrors).toBe(0);
    expect(r.status).toBe(1);
  });

  test('a clean run whose answer merely mentions an error code is not a provider error', () => {
    install({ claudeWith: [init([`ensemble-product:${SKILL}`]), result({ result: 'Explained why the API returns 401 for a bad key' })] });
    const r = runEvals(['--runtime', 'claude', '--repeats', '1']);
    expect(withRuns(r)[0].outcome).toBe('pass');
  });

  test('the reason is short and free of control characters, and a key in the error text is redacted', () => {
    const long = `Failed to authenticate. API Error: 401 \u001b[31m\u0007${'x'.repeat(2000)} sk-ant-SECRETVALUE123`;
    install({ claudeWith: [init([`ensemble-product:${SKILL}`]), result({ ...AUTH, result: `key sk-ant-SECRETVALUE123 ${long}` })] });
    fs.mkdirSync(sub('skills'), { recursive: true });
    const env = { ANTHROPIC_API_KEY: 'sk-ant-SECRETVALUE123' };
    process.env.ANTHROPIC_API_KEY = env.ANTHROPIC_API_KEY;
    let r;
    try { r = runEvals(['--runtime', 'claude', '--repeats', '1']); } finally { delete process.env.ANTHROPIC_API_KEY; }
    const reason = records(r, 'with-skill')[0].incompleteReason;
    expect(reason.length).toBeLessThanOrEqual('provider error: '.length + envlib.MAX_REASON);
    expect(reason).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/);
    expect(JSON.stringify(r.report)).not.toContain('SECRETVALUE123');
    expect(r.stdout).not.toContain('SECRETVALUE123');
    expect(r.stdout).not.toMatch(/\u001b/);
  });
});

describe('Pi: an assistant message that ended in an error is incomplete', () => {
  test('stopReason error with the 402 text and no earlier success -> incomplete, exit 4, charged nothing (not the reservation)', () => {
    install({ piWith: [systemEvent([SKILL]), assistant(PI402), turnEnd] });
    const r = runEvals(['--runtime', 'pi', '--repeats', '1']);
    expect(r.status).toBe(4);
    expect(r.ev.outcome).toBe('incomplete');
    expect(r.stdout).toMatch(/\[with-skill 1\/1\] INCOMPLETE \(provider error: 402: \{"message":"Insufficient credits/);
    expect(r.stdout).not.toMatch(/\[with-skill 1\/1\] FAIL/);
    const rec = records(r, 'with-skill')[0];
    expect(rec).toMatchObject({ outcome: 'incomplete', costUsd: 0 });
    expect(rec.costEstimated).toBeUndefined();
    expect(rec.incompleteReason.length).toBeLessThanOrEqual('provider error: '.length + envlib.MAX_REASON);
    expect(r.baselines).toEqual([]);
    expect(r.cached.some((f) => /with-skill/.test(f))).toBe(false);
  });

  test('a run that worked (a successful message) and then failed its checks is still a fail', () => {
    install({ piWith: [systemEvent([SKILL]), assistant(), turnEnd], write: false });
    const r = runEvals(['--runtime', 'pi', '--repeats', '1']);
    expect(r.status).toBe(1);
    expect(withRuns(r)[0].outcome).toBe('fail');
  });
});

describe('stream rule units', () => {
  const feed = (lines) => { const s = pi.createStreamScanner(); lines.forEach((l) => s.feed(l)); return s.result().providerErrorText; };
  test('Pi: an error with no success is one; success then a final error is one; an error that a later success recovered from is not', () => {
    expect(feed([assistant(PI402)])).toMatch(/^402/);
    expect(feed([assistant(), assistant({ stopReason: 'error', errorMessage: 'overloaded' })])).toBe('overloaded');
    expect(feed([assistant(PI402), assistant()])).toBeNull();
    expect(feed([assistant()])).toBeNull();
    expect(feed([assistant({ stopReason: 'aborted' })])).toBeNull();
    expect(feed([assistant({ stopReason: 'error' })])).toBeNull(); // no status, no text: unplaceable, so a fail
  });

  test('Claude: error text needs a failed final result and is not a deliberate stop', () => {
    const t = (o) => claude.providerErrorOf(result(o));
    expect(t(AUTH)).toMatch(/^Failed to authenticate/);
    for (const text of ['Not logged in · Please run /login', 'API Error: 429 rate limited', 'API Error: 529 {"type":"overloaded_error"}', '403 Forbidden']) expect(t({ is_error: true, result: text })).not.toBeNull();
    expect(t({ is_error: false, result: 'API Error: 401 discussed' })).toBeNull();
    expect(t({ is_error: true, result: 'something else broke' })).toBeNull();
    expect(t({ is_error: true, subtype: 'error_max_budget_usd', result: 'API Error 500' })).toBeNull();
    expect(claude.providerErrorOf('')).toBeNull();
  });

  test('Claude runner: a timed-out run reports no provider error even with an error result line already in the stream', async () => {
    fs.mkdirSync(sub('bin'), { recursive: true });
    fs.writeFileSync(sub('bin/claude'), `#!/bin/sh\n${printLines([init(['x']), result(AUTH)])}\nsleep 30\n`, { mode: 0o755 });
    fs.mkdirSync(sub('ws'), { recursive: true });
    const r = await claude.run({ prompt: 'p', env: { PATH: process.env.PATH }, workspace: sub('ws'), timeoutMs: 1500 }, { bin: sub('bin/claude') });
    expect(r.timedOut).toBe(true);
    expect(r.providerError).toBeNull();
  });

  test('Pi runner: a timed-out run reports no provider error either', async () => {
    fs.mkdirSync(sub('bin'), { recursive: true });
    fs.writeFileSync(sub('bin/pi'), `#!/bin/sh\n${printLines([systemEvent([]), assistant(PI402)])}\nsleep 30\n`, { mode: 0o755 });
    fs.mkdirSync(sub('ws'), { recursive: true });
    const r = await pi.run({ prompt: 'p', env: { PATH: process.env.PATH }, workspace: sub('ws'), timeoutMs: 1500 }, { bin: sub('bin/pi') });
    expect(r.timedOut).toBe(true);
    expect(r.providerError).toBeNull();
  });

  test('shortReason strips control characters, redacts first and caps the length', () => {
    const s = envlib.shortReason(`a\u001b[0m\u0000b\n\tc sk-SECRET${'y'.repeat(500)}`, ['sk-SECRET']);
    expect(s).toBe(`a [0m b c [REDACTED]${'y'.repeat(500)}`.slice(0, envlib.MAX_REASON - 3) + '...');
    expect(envlib.shortReason('x'.repeat(1000)).length).toBe(envlib.MAX_REASON);
  });
});

// ---- F1: the verdict derives from the with-skill arm; only an undecided one is incomplete -----------------------
const E529 = { is_error: true, num_turns: 1, total_cost_usd: 0, result: 'API Error: 529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}' };
const okRun = { write: true, lines: [init([`ensemble-product:${SKILL}`]), result({})] };
const badRun = { write: false, lines: [init([`ensemble-product:${SKILL}`]), result({})] };
const errRun = { write: false, lines: [init([`ensemble-product:${SKILL}`]), result(E529)] };

describe('a provider error does not override a decided verdict', () => {
  const resetRun = () => { fs.rmSync(sub('results'), { recursive: true, force: true }); fs.rmSync(sub('n'), { force: true }); };

  test('bar 4 of 5, two real fails then a 529: already unreliable -> FAIL exit 1, regression still detected, nothing written or cached', () => {
    install({ claudeWithSeq: [okRun, okRun, okRun, okRun, okRun] });
    const first = runEvals(['--runtime', 'claude', '--repeats', '5']);
    expect(first.status).toBe(0);
    const committed = fs.readFileSync(sub('baselines/claude', `${SKILL}.json`), 'utf8');
    expect(JSON.parse(committed)).toMatchObject({ reliable: true, withSkill: { passes: 5, runs: 5 } });
    resetRun();
    install({ claudeWithSeq: [badRun, badRun, errRun, okRun, okRun] });
    const r = runEvals(['--runtime', 'claude', '--repeats', '5', '--refresh']);
    expect(r.ev.outcome).toBe('fail');
    expect(r.ev.withSkill).toMatchObject({ passes: 2, runs: 4, providerErrors: 1 });
    expect(r.ev.uplift).toBeNull();
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/eval .*: FAIL/);
    expect(r.stdout).toMatch(/INCOMPLETE .*1 run\(s\) hit a provider error.*verdict FAIL stands/);
    expect(r.stdout).toMatch(/regression check vs committed summary: regression/);
    expect(r.stderr).toMatch(/REGRESSION/);
    expect(r.stdout).toMatch(/baseline summary not written/);
    expect(fs.readFileSync(sub('baselines/claude', `${SKILL}.json`), 'utf8')).toBe(committed);
    expect(withRuns(r).filter((x) => x.outcome === 'incomplete')).toHaveLength(1);
    expect(r.report.failed).toBe(1);
    expect(r.report.incomplete).toBe(0);
  });

  test('a decided fail with an error and no committed baseline: exit 1, no baseline written', () => {
    install({ claudeWithSeq: [badRun, badRun, errRun, badRun, badRun] });
    const r = runEvals(['--runtime', 'claude', '--repeats', '5']);
    expect(r.status).toBe(1);
    expect(r.ev.outcome).toBe('fail');
    expect(r.baselines).toEqual([]);
    expect(r.stdout).toMatch(/regression check vs committed summary: no-baseline/);
  });

  test('with-skill reached the bar, one baseline run hit a provider error: PASS stands, uplift undetermined, no baseline, exit 4 with the note', () => {
    install({ claudeWithSeq: [okRun, okRun, okRun, okRun, okRun], claudeBase: [result(E529)] });
    const r = runEvals(['--runtime', 'claude', '--repeats', '5']);
    expect(r.ev.outcome).toBe('pass');
    expect(r.ev.withSkill).toMatchObject({ passes: 5, runs: 5, providerErrors: 0 });
    expect(r.ev.baseline.providerErrors).toBe(5);
    expect(r.ev.uplift).toBeNull();
    expect(r.stdout).toMatch(/eval .*: PASS/);
    expect(r.stdout).toMatch(/INCOMPLETE .*5 run\(s\) hit a provider error.*verdict PASS stands/);
    expect(r.stdout).toMatch(/uplift n\/a .*undetermined: provider error/);
    expect(r.baselines).toEqual([]);
    expect(r.stdout).not.toMatch(/^ {2}baseline summary: /m);
    expect(r.report).toMatchObject({ passed: 1, failed: 0, incomplete: 0, providerErrored: 1 });
    expect(r.status).toBe(4);
    expect(r.cached.every((f) => !/baseline/.test(f))).toBe(true);
  });

  test('a with-skill error that leaves the bar undecided is incomplete, exit 4, no baseline, and not cached', () => {
    install({ claudeWithSeq: [okRun, okRun, errRun, okRun, badRun] });
    const r = runEvals(['--runtime', 'claude', '--repeats', '5']);
    expect(r.ev.withSkill).toMatchObject({ passes: 3, runs: 4, providerErrors: 1 }); // 3 + 1 unrun = 4 = bar: undetermined
    expect(r.ev.outcome).toBe('incomplete');
    expect(r.status).toBe(4);
    expect(r.baselines).toEqual([]);
    expect(r.stdout).toMatch(/verdict undetermined/);
    expect(records(r, 'with-skill').find((x) => x.outcome === 'incomplete')).toBeTruthy();
  });
});

// ---- F2: only authentication, payment, rate-limit and server-side failures count ------------------------------
describe('classification: what is and is not a provider error', () => {
  const claudeErr = (text) => claude.providerErrorOf(result({ is_error: true, result: text }));
  const piErr = (text) => { const s = pi.createStreamScanner(); s.feed(assistant({ content: [], stopReason: 'error', errorMessage: text })); return s.result().providerErrorText; };
  const COUNT = [
    'Failed to authenticate. API Error: 401 {"error":{"type":"authentication_error"}}', 'API Error: 403 forbidden', 'Not logged in · Please run /login', 'invalid x-api-key',
    '402: {"message":"Insufficient credits"}', 'Insufficient credits', 'API Error: 429 {"error":{"type":"rate_limit_error"}}', 'rate_limit_error',
    'API Error: 500 internal', 'API Error: 502 bad gateway', '503 Service Unavailable', 'API Error: 504', 'API Error: 529 overloaded_error', 'overloaded_error', 'overloaded',
  ];
  const NOT = [
    'API Error: 400 {"error":{"type":"invalid_request_error","message":"prompt is too long: 250000 tokens > 200000 maximum"}}', 'API Error: 413 request too large', 'API Error: 422 unprocessable',
    'prompt is too long', 'context length exceeded', 'invalid_request_error: max_tokens must be positive', 'API Error: 400 {"message":"overloaded"}',
    'API Error: 404 not found', 'API Error: 501 not implemented', 'something else broke', 'API Error', 'invalid_request_error: server overloaded',
  ];
  test.each(COUNT)('counts on Claude and Pi: %s', (text) => {
    expect(claudeErr(text)).not.toBeNull();
    expect(piErr(text)).not.toBeNull();
  });
  test.each(NOT)('stays a fail on Claude and Pi: %s', (text) => {
    expect(claudeErr(text)).toBeNull();
    expect(piErr(text)).toBeNull();
  });

  test('end to end: a rejected request (400 prompt too long) is an ordinary fail on both runtimes, exit 1', () => {
    install({ claudeWith: [init([`ensemble-product:${SKILL}`]), result({ is_error: true, result: 'API Error: 400 {"type":"invalid_request_error","message":"prompt is too long"}' })], write: false });
    const c = runEvals(['--runtime', 'claude', '--repeats', '1']);
    expect(c.status).toBe(1);
    expect(withRuns(c)[0].outcome).toBe('fail');
    expect(c.ev.withSkill.providerErrors).toBe(0);
    fs.rmSync(sub('results'), { recursive: true, force: true });
    install({ piWith: [systemEvent([SKILL]), assistant({ content: [], stopReason: 'error', errorMessage: '400 prompt is too long' }), turnEnd], write: false });
    const p = runEvals(['--runtime', 'pi', '--repeats', '1']);
    expect(p.status).toBe(1);
    expect(withRuns(p)[0].outcome).toBe('fail');
  });
});

// ---- F3: cost of a provider-failed run ------------------------------------------------------------------------
describe('cost of a provider-failed run', () => {
  test('Claude: a 401 on the first call costs 0', () => {
    install({ claudeWith: [init([`ensemble-product:${SKILL}`]), result({ ...AUTH, total_cost_usd: undefined })] });
    const rec = records(runEvals(['--runtime', 'claude', '--repeats', '1']), 'with-skill')[0];
    expect(rec).toMatchObject({ outcome: 'incomplete', costUsd: 0 });
    expect(rec.costEstimated).toBeUndefined();
  });

  test('Claude: a failure after several turns with no reported cost is charged the reservation and flagged estimated', () => {
    install({ claudeWith: [init([`ensemble-product:${SKILL}`]), result({ ...E529, num_turns: 7, total_cost_usd: undefined })] });
    const r = runEvals(['--runtime', 'claude', '--repeats', '1']);
    const rec = records(r, 'with-skill')[0];
    expect(rec.outcome).toBe('incomplete');
    expect(rec.costUsd).toBeGreaterThan(0);
    expect(rec.costEstimated).toBe(true);
    expect(r.report.totalCostUsd).toBeGreaterThanOrEqual(rec.costUsd);
  });

  test('Claude: a reported cost is charged as reported even after several turns', () => {
    install({ claudeWith: [init([`ensemble-product:${SKILL}`]), result({ ...E529, num_turns: 7, total_cost_usd: 0.37 })] });
    const rec = records(runEvals(['--runtime', 'claude', '--repeats', '1']), 'with-skill')[0];
    expect(rec.costUsd).toBeCloseTo(0.37);
    expect(rec.costEstimated).toBeUndefined();
  });

  test('Pi: an unpriced model (cost 0) that did work before failing is charged the reservation; a failed first call costs 0', () => {
    const work = assistant({ content: [{ type: 'toolCall', name: 'bash', arguments: { command: 'ls' } }], usage: { cost: { total: 0 }, output: 40 } });
    const fail = assistant({ content: [], stopReason: 'error', errorMessage: '503 service unavailable', usage: { cost: { total: 0 } } });
    install({ piWith: [systemEvent([SKILL]), work, turnEnd, fail, turnEnd] });
    const rec = records(runEvals(['--runtime', 'pi', '--repeats', '1']), 'with-skill')[0];
    expect(rec.outcome).toBe('incomplete');
    expect(rec.costUsd).toBeGreaterThan(0);
    expect(rec.costEstimated).toBe(true);
    fs.rmSync(sub('results'), { recursive: true, force: true });
    install({ piWith: [systemEvent([SKILL]), fail, turnEnd] });
    const first = records(runEvals(['--runtime', 'pi', '--repeats', '1']), 'with-skill')[0];
    expect(first).toMatchObject({ outcome: 'incomplete', costUsd: 0 });
    expect(first.costEstimated).toBeUndefined();
  });
});
