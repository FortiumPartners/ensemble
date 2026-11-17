'use strict';

/**
 * PR 2 behavior: environment allowlist and redaction (TRD-005), workspace isolation (TRD-006),
 * cost cap, timeout and incomplete status (TRD-007). A stub `claude` stands in for the model; no model calls.
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const envlib = require('../lib/env');
const { loadLimits, reservationFor, runSuite, runProcess } = require('../lib/exec');
const { resolveWorkdir } = require('../lib/sandbox');
const { runScenario } = require('../run');

const RUN = path.join(__dirname, '../run.js');
const REPO_ROOT = path.resolve(__dirname, '../..');
const SCRATCH = path.join(os.homedir(), '.omp', 'trd-skills-eval', 'jest');

let root;
let extraPids;
beforeEach(() => {
  fs.mkdirSync(SCRATCH, { recursive: true });
  root = fs.mkdtempSync(path.join(SCRATCH, 't-'));
  extraPids = [];
});
afterEach(() => {
  for (const pid of extraPids) { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } }
  fs.rmSync(root, { recursive: true, force: true });
});

const sub = (...p) => path.join(root, ...p);
const COST_LINE = (usd) => `echo '{"type":"result","num_turns":1,"total_cost_usd":${usd}}'`;
const HAS_SEED = [{ type: 'fileExists', path: 'seed.txt' }];

/** Write `n` agent scenarios s1..sn (fixture: seed.txt). `graders` may be a function of the index. */
function scenarios(n, graders = HAS_SEED) {
  const dir = sub('scenarios');
  for (let i = 1; i <= n; i++) {
    const d = path.join(dir, `s${i}`);
    fs.mkdirSync(path.join(d, 'fixture'), { recursive: true });
    fs.writeFileSync(path.join(d, 'fixture', 'seed.txt'), 'seed\n');
    const g = typeof graders === 'function' ? graders(i) : graders;
    fs.writeFileSync(path.join(d, 'scenario.json'), JSON.stringify({ type: 'agent', prompt: 'do it', plugins: [], timeoutSec: 60, graders: g }));
  }
  return dir;
}

/** Run run.js with a stub claude whose body is `body`. Returns { status, stdout, stderr, report, workdir }. */
function run(args, { body, n = 1, graders, env = {} }) {
  const bin = sub('bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, 'claude'), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  const workdir = sub('work');
  fs.mkdirSync(sub('skills'), { recursive: true });
  const base = {
    ...process.env, CI: 'false', GITHUB_ACTIONS: 'false', ANTHROPIC_API_KEY: undefined,
    PATH: `${bin}:${process.env.PATH}`, EVALS_WORKDIR: workdir, EVALS_RESULTS_DIR: sub('results'),
    EVALS_SCENARIOS_DIR: scenarios(n, graders), EVALS_SKILLS_DIR: sub('skills'), ...env,
  };
  for (const k of Object.keys(base)) if (base[k] === undefined) delete base[k];
  const r = spawnSync('node', [RUN, ...args], { encoding: 'utf8', env: base });
  let report = null;
  if (fs.existsSync(sub('results'))) {
    const f = fs.readdirSync(sub('results'))[0];
    if (f) report = JSON.parse(fs.readFileSync(sub('results', f), 'utf8'));
  }
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, report, workdir };
}

const outcomes = (rep) => rep.results.map((x) => x.outcome);
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function waitDead(pid, ms = 4000) {
  const end = Date.now() + ms;
  while (alive(pid) && Date.now() < end) await new Promise((r) => setTimeout(r, 50));
  return !alive(pid);
}

describe('TRD-005 environment allowlist', () => {
  const SHELL_ADDED = new Set(['PWD', 'OLDPWD', 'SHLVL', '_']);
  const body = (extra = '') => `env > "${root}/env.txt"\n${extra}\n${COST_LINE(0.01)}`;
  const names = () => fs.readFileSync(sub('env.txt'), 'utf8').split('\n').filter(Boolean).map((l) => l.split('=')[0]).filter((n) => !SHELL_ADDED.has(n));

  test('only allowlisted variables visible; non-allowlisted credential hidden', () => {
    const r = run(['--max-usd', '1'], { body: body(`echo "[$SECRET_X]" > "${root}/secret.txt"`), env: { SECRET_X: 'hunter2-secret', STRAY_VAR: 'stray', ANTHROPIC_API_KEY: 'sk-allowed' } });
    expect(r.status).toBe(0);
    expect(fs.existsSync(sub('env.txt'))).toBe(true); // the stub ran
    const allowed = new Set([...envlib.BASE_NAMES, 'HOME', 'ANTHROPIC_API_KEY']);
    const seen = names();
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.filter((n) => !allowed.has(n))).toEqual([]);
    expect(seen).not.toContain('SECRET_X');
    expect(seen).not.toContain('STRAY_VAR');
    expect(fs.readFileSync(sub('secret.txt'), 'utf8').trim()).toBe('[]');
  });

  test('judge call also gets only the allowlisted environment', () => {
    const judgeBody = `case "$*" in
*stream-json*) ${COST_LINE(1)} ;;
*) env > "${root}/judge-env.txt"; echo '{"result":"{\\"score\\":1,\\"reason\\":\\"ok\\"}","total_cost_usd":0.5}' ;;
esac`;
    const r = run(['--max-usd', '10', '--model', 'sonnet', '--judge-model', 'opus'], {
      body: judgeBody, graders: [...HAS_SEED, { type: 'judge', rubric: 'good' }], env: { SECRET_X: 'hunter2-secret' },
    });
    expect(r.status).toBe(0);
    const txt = fs.readFileSync(sub('judge-env.txt'), 'utf8');
    expect(txt).toMatch(/^PATH=/m);
    expect(txt).not.toMatch(/SECRET_X|hunter2/);
  });

  test('HOME passes through locally', () => {
    const r = run(['--max-usd', '1'], { body: body(`echo "$HOME" > "${root}/home.txt"`), env: { HOME: '/home/maint' } });
    expect(r.status).toBe(0);
    expect(fs.readFileSync(sub('home.txt'), 'utf8').trim()).toBe('/home/maint');
    expect(r.report.env.homeMode).toBe('passthrough');
  });

  test('credential-free checks get a throwaway empty HOME locally, removed afterwards', () => {
    const r = run(['--max-usd', '1'], {
      body: COST_LINE(0.01), env: { HOME: '/home/maint' },
      graders: () => [{ type: 'testsPass', command: `echo "$HOME" > "${root}/check-home.txt"; ls -A "$HOME" | wc -l > "${root}/check-home-count.txt"` }],
    });
    expect(r.status).toBe(0);
    const home = fs.readFileSync(sub('check-home.txt'), 'utf8').trim();
    expect(home).not.toBe('/home/maint');
    expect(home.startsWith(`${r.workdir}${path.sep}`)).toBe(true);
    expect(fs.readFileSync(sub('check-home-count.txt'), 'utf8').trim()).toBe('0');
    expect(fs.existsSync(home)).toBe(false);
  });

  test.each([['CI'], ['GITHUB_ACTIONS']])('%s=true gives a fresh per-run HOME outside the repo, removed afterwards', (flag) => {
    const r = run(['--max-usd', '1'], {
      body: body(`echo "$HOME" > "${root}/home.txt"; [ -d "$HOME" ] && echo yes > "${root}/home-existed.txt"`),
      env: { HOME: '/home/maint', [flag]: 'true' },
    });
    expect(r.status).toBe(0);
    const home = fs.readFileSync(sub('home.txt'), 'utf8').trim();
    expect(home).not.toBe('/home/maint');
    expect(home.startsWith(`${r.workdir}${path.sep}`)).toBe(true);
    expect(path.relative(REPO_ROOT, home).startsWith('..')).toBe(true);
    expect(home.startsWith('/tmp')).toBe(false);
    expect(fs.existsSync(sub('home-existed.txt'))).toBe(true); // it existed during the run
    expect(fs.existsSync(home)).toBe(false); // removed afterwards
    expect(r.report.env.homeMode).toBe('ci-temp');
  });

  test('allowlisted credential is delivered (default and overridden names)', () => {
    let r = run(['--max-usd', '1'], { body: body(`echo "$ANTHROPIC_API_KEY|$OTHER_TOKEN" > "${root}/cred.txt"`), env: { ANTHROPIC_API_KEY: 'sk-allowed', OTHER_TOKEN: 'tok-other' } });
    expect(r.status).toBe(0);
    expect(fs.readFileSync(sub('cred.txt'), 'utf8').trim()).toBe('sk-allowed|'); // OTHER_TOKEN not on the allowlist
    run(['--max-usd', '1', '--allow-env', 'OTHER_TOKEN'], { body: body(`echo "$ANTHROPIC_API_KEY|$OTHER_TOKEN" > "${root}/cred.txt"`), env: { ANTHROPIC_API_KEY: 'sk-allowed', OTHER_TOKEN: 'tok-other' } });
    expect(fs.readFileSync(sub('cred.txt'), 'utf8').trim()).toBe('sk-allowed|tok-other');
  });

  test('credential names are editable in a file, replacing the default', () => {
    const file = sub('allow.json');
    fs.writeFileSync(file, JSON.stringify({ credentials: ['FILE_TOKEN'] }));
    run(['--max-usd', '1', '--env-allowlist', file], { body: body(`echo "$ANTHROPIC_API_KEY|$FILE_TOKEN" > "${root}/cred.txt"`), env: { ANTHROPIC_API_KEY: 'sk-allowed', FILE_TOKEN: 'tok-file' } });
    expect(fs.readFileSync(sub('cred.txt'), 'utf8').trim()).toBe('|tok-file');
  });

  test('allowlisted credential value never reaches stored results or logs', () => {
    const key = 'sk-ant-SUPER"SECRET-0123';
    const r = run(['--max-usd', '1'], {
      body: `echo "leak: $ANTHROPIC_API_KEY" >&2\necho '{"type":"result","num_turns":1,"total_cost_usd":0.01,"result":"my key is '"$ANTHROPIC_API_KEY"'"}' | sed 's/SUPER"SECRET/SUPER\\\\"SECRET/'\necho "raw $ANTHROPIC_API_KEY"`,
      env: { ANTHROPIC_API_KEY: key },
    });
    const files = fs.readdirSync(sub('results')).map((f) => fs.readFileSync(sub('results', f), 'utf8')).join('');
    expect(files).toContain('[REDACTED]'); // the stub did print the secret, so the check could fail
    for (const text of [files, r.stdout, r.stderr]) {
      expect(text).not.toContain(key);
      expect(text).not.toContain('SUPER"SECRET');
      expect(text).not.toContain('SUPER\\"SECRET');
      expect(text).not.toContain('0123');
    }
  });

  test('stored result carries no environment values beyond allowlisted names', () => {
    const r = run(['--max-usd', '1'], { body: body(), env: { SECRET_X: 'hunter2-secret', STRAY_VAR: 'stray-value-77', ANTHROPIC_API_KEY: 'sk-allowed', HOME: '/home/maint' } });
    const text = JSON.stringify(r.report);
    for (const v of ['hunter2-secret', 'stray-value-77', 'sk-allowed', '/home/maint']) expect(text).not.toContain(v);
    expect(r.report.env.allowlisted.sort()).toEqual(['ANTHROPIC_API_KEY', 'HOME', 'LANG', 'PATH', 'TERM', 'TMPDIR']);
    expect(Object.keys(r.report.env).sort()).toEqual(['allowlisted', 'homeMode']);
  });

  describe('env.js units', () => {
    test('buildEnv keeps only the allowlist and omits unset names', () => {
      const e = envlib.buildEnv({ parent: { PATH: '/bin', HOME: '/h', FOO: 'x', API: 'k', TERM: 'xterm' }, credentials: ['API', 'MISSING'] });
      expect(e).toEqual({ PATH: '/bin', TERM: 'xterm', API: 'k', HOME: '/h' });
      expect(envlib.buildEnv({ parent: { HOME: '/h' }, home: '/fresh' }).HOME).toBe('/fresh');
    });
    test('redaction covers raw and JSON-escaped values, nested and in keys, longest secret first', () => {
      const secrets = envlib.secretValues({ A: 'abc"def', B: 'abc"defGHI', C: '' }, ['A', 'B', 'C']);
      expect(secrets).toEqual(['abc"defGHI', 'abc"def']);
      const out = envlib.redactDeep({ x: ['k abc"defGHI'], 'abc"def': 1 }, secrets);
      expect(JSON.stringify(out)).toBe('{"x":["k [REDACTED]"],"[REDACTED]":1}');
      expect(envlib.redactText(JSON.stringify({ v: 'abc"def' }), secrets)).toBe('{"v":"[REDACTED]"}');
    });
    test('isCI and allowlist file validation', () => {
      expect(envlib.isCI({ CI: 'true' })).toBe(true);
      expect(envlib.isCI({ GITHUB_ACTIONS: 'true' })).toBe(true);
      expect(envlib.isCI({ CI: 'false' })).toBe(false);
      expect(() => envlib.loadCredentialNames({ file: sub('missing.json') })).toThrow(/does not exist/); // an explicit file must exist
      expect(() => envlib.loadCredentialNames({ extra: ['bad name'] })).toThrow(/invalid environment variable name/);
      expect(envlib.loadCredentialNames()).toContain('ANTHROPIC_API_KEY'); // shipped evals/env-allowlist.json
    });
  });
});

/** Hash of the repository working tree state: index, tracked diff and untracked files. */
function treeHash(dir) {
  const g = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8', maxBuffer: 1 << 28 }).stdout;
  const h = crypto.createHash('sha1');
  h.update(g('ls-files', '-s'));
  h.update(g('diff', 'HEAD'));
  for (const f of g('ls-files', '-o', '--exclude-standard').split('\n').filter(Boolean).sort()) {
    h.update(f);
    try { h.update(fs.readFileSync(path.join(dir, f))); } catch { /* unreadable */ }
  }
  return h.digest('hex');
}

describe('TRD-006 workspace isolation', () => {
  test('treeHash detects a change (control)', () => {
    const d = sub('ctl');
    fs.mkdirSync(d);
    const git = (...a) => spawnSync('git', a, { cwd: d });
    git('init', '-q'); fs.writeFileSync(path.join(d, 'a'), '1'); git('add', '.');
    git('-c', 'user.name=x', '-c', 'user.email=x@x', 'commit', '-qm', 'i');
    const before = treeHash(d);
    expect(treeHash(d)).toBe(before);
    fs.writeFileSync(path.join(d, 'a'), '2');
    expect(treeHash(d)).not.toBe(before);
    fs.writeFileSync(path.join(d, 'a'), '1'); fs.writeFileSync(path.join(d, 'new'), 'x');
    expect(treeHash(d)).not.toBe(before);
  });

  test('each run starts in a fresh fixture copy outside the repository', () => {
    const log = sub('log.txt');
    const r = run(['--max-usd', '5', '--run-usd', '1', '--concurrency', '1'], {
      n: 2,
      body: `pwd >> "${log}"; ls -A | tr '\\n' ' ' >> "${log}"; echo >> "${log}"; cat seed.txt >> "${log}"\ntouch leftover.txt\n${COST_LINE(0.01)}`,
    });
    expect(r.status).toBe(0);
    const lines = fs.readFileSync(log, 'utf8').split('\n').filter(Boolean);
    expect(lines).toHaveLength(6);
    const cwds = [lines[0], lines[3]];
    for (const c of cwds) {
      expect(fs.realpathSync(r.workdir) === c.slice(0, fs.realpathSync(r.workdir).length)).toBe(true);
      expect(path.relative(fs.realpathSync(REPO_ROOT), c).startsWith('..')).toBe(true);
      expect(c.startsWith('/tmp') || c.startsWith('/private/tmp')).toBe(false);
    }
    expect(cwds[0]).not.toBe(cwds[1]);
    for (const listing of [lines[1], lines[4]]) {
      expect(listing).toMatch(/seed\.txt/);
      expect(listing).toMatch(/\.git/);
      expect(listing).not.toMatch(/leftover/); // the second run never sees the first one's file
    }
    expect([lines[2], lines[5]]).toEqual(['seed', 'seed']);
  });

  test('repository unchanged, workspace removed; kept with --keep-workspace', () => {
    const before = treeHash(REPO_ROOT);
    const destroy = `rm -rf ./* ./.git; echo junk > scratch.txt; echo junk > ../outside.txt\n${COST_LINE(0.01)}`;
    let r = run(['--max-usd', '1'], { body: destroy });
    expect(treeHash(REPO_ROOT)).toBe(before);
    expect(fs.readdirSync(r.workdir)).toEqual([]);
    expect(r.stdout).not.toMatch(/workspace kept/);

    fs.rmSync(sub('results'), { recursive: true, force: true });
    r = run(['--max-usd', '1', '--keep-workspace'], { body: destroy });
    expect(treeHash(REPO_ROOT)).toBe(before);
    const kept = r.stdout.match(/workspace kept: (.+)/);
    expect(kept).not.toBeNull();
    expect(fs.existsSync(path.join(kept[1], 'scratch.txt'))).toBe(true);
    expect(kept[1].startsWith(r.workdir)).toBe(true);
  });

  test('EVALS_WORKDIR under /tmp or inside the repository is refused; default is ~/.omp/evals-work', () => {
    expect(() => resolveWorkdir({ EVALS_WORKDIR: '/tmp/x' })).toThrow(/\/tmp/);
    expect(() => resolveWorkdir({ EVALS_WORKDIR: '/private/tmp/x' })).toThrow(/\/tmp/);
    expect(() => resolveWorkdir({ EVALS_WORKDIR: path.join(REPO_ROOT, 'evals', 'work') })).toThrow(/outside the repository/);
    expect(resolveWorkdir({})).toBe(path.join(os.homedir(), '.omp', 'evals-work'));
  });
});

describe('TRD-007 cost cap, timeout, incomplete', () => {
  /** Stub that logs start/end lines (appends are ordered) and sleeps `sleep` seconds. */
  const slow = (usd, sleep = 1) => `echo start >> "${root}/events.txt"\nsleep ${sleep}\necho end >> "${root}/events.txt"\n${COST_LINE(usd)}`;
  const maxConcurrent = () => {
    let cur = 0; let max = 0;
    for (const l of fs.readFileSync(sub('events.txt'), 'utf8').split('\n').filter(Boolean)) { cur += l === 'start' ? 1 : -1; max = Math.max(max, cur); }
    return max;
  };
  const starts = () => fs.readFileSync(sub('events.txt'), 'utf8').split('\n').filter((l) => l === 'start').length;

  test('defaults: $50 cap, 900 s timeout, concurrency 4', () => {
    expect(loadLimits()).toMatchObject({ maxUsdPerSuite: 50, timeoutSec: 900, concurrency: 4 });
    const r = run([], { body: `echo "$@" > "${root}/argv.txt"\n${COST_LINE(0.01)}` });
    expect(r.report).toMatchObject({ maxUsd: 50, timeoutSec: 900, concurrency: 4 });
    expect(fs.readFileSync(sub('argv.txt'), 'utf8')).toMatch(/--max-budget-usd 5\b/);
  });

  test('cap stops new runs; finished runs keep results; incomplete is neither pass nor fail; exit 4', () => {
    const r = run(['--max-usd', '5', '--run-usd', '2', '--concurrency', '1'], { n: 5, body: slow(2, 0) });
    expect(starts()).toBe(2); // nothing started past the cap
    expect(outcomes(r.report)).toEqual(['pass', 'pass', 'incomplete', 'incomplete', 'incomplete']);
    expect(r.report).toMatchObject({ passed: 2, failed: 0, incomplete: 3, total: 5, totalCostUsd: 4 });
    expect(r.report.results[0]).toMatchObject({ pass: true, costUsd: 2 });
    expect(r.report.results[2].pass).toBeNull();
    expect(r.status).toBe(4);
  });

  test('reservation under concurrency: spend plus in-flight reservations never exceed the cap', () => {
    const r = run(['--max-usd', '5', '--run-usd', '2', '--concurrency', '4'], { n: 6, body: slow(2, 1) });
    expect(maxConcurrent()).toBe(2); // 3 x $2 reserved would be $6 > $5, although 4 slots are free
    expect(starts()).toBe(2);
    expect(r.report.peakCommittedUsd).toBeLessThanOrEqual(5);
    expect(r.report.peakCommittedUsd).toBe(4);
    expect(outcomes(r.report).filter((o) => o === 'incomplete')).toHaveLength(4);
    expect(r.report.totalCostUsd).toBe(4);
    expect(r.status).toBe(4);
  });

  test('failure outranks incomplete', () => {
    const r = run(['--max-usd', '2.5', '--run-usd', '2', '--concurrency', '1'], {
      n: 2, body: slow(2, 0), graders: (i) => (i === 1 ? [{ type: 'fileExists', path: 'nope.txt' }] : HAS_SEED),
    });
    expect(outcomes(r.report)).toEqual(['fail', 'incomplete']);
    expect(r.status).toBe(1);
  });

  test('timeout is recorded timed_out, never pass, exit 1', () => {
    const t0 = Date.now();
    const r = run(['--max-usd', '5', '--timeout', '1'], { body: `sleep 30\n${COST_LINE(0.01)}` });
    expect(Date.now() - t0).toBeLessThan(15000);
    expect(r.report.results[0]).toMatchObject({ outcome: 'timed_out', pass: false, timedOut: true });
    expect(r.report).toMatchObject({ passed: 0, failed: 1, incomplete: 0 });
    expect(r.status).toBe(1);
  });

  test('timeout kills the stub and its grandchild (checked by pid)', async () => {
    const t0 = Date.now();
    const r = run(['--max-usd', '5', '--timeout', '1'], { body: `echo $$ > "${root}/stub.pid"\nsleep 30 &\necho $! > "${root}/grandchild.pid"\nsleep 30` });
    const stub = Number(fs.readFileSync(sub('stub.pid'), 'utf8'));
    const grandchild = Number(fs.readFileSync(sub('grandchild.pid'), 'utf8'));
    extraPids.push(stub, grandchild);
    expect(Date.now() - t0).toBeLessThan(15000); // a surviving grandchild holds the pipes open until its own 30 s sleep ends
    expect(stub).toBeGreaterThan(1);
    expect(grandchild).toBeGreaterThan(1);
    expect(grandchild).not.toBe(stub);
    expect(r.report.results[0].outcome).toBe('timed_out');
    expect(await waitDead(stub)).toBe(true);
    expect(await waitDead(grandchild)).toBe(true);
  });

  test('judge cost counts in costUsd and the suite spend', () => {
    const judgeBody = `case "$*" in
*stream-json*) ${COST_LINE(1.0)} ;;
*) echo '{"result":"{\\"score\\":0.9,\\"reason\\":\\"ok\\"}","total_cost_usd":0.5}' ;;
esac`;
    const r = run(['--max-usd', '5', '--model', 'sonnet', '--judge-model', 'opus'], { body: judgeBody, graders: [...HAS_SEED, { type: 'judge', rubric: 'good' }] });
    expect(r.report.results[0]).toMatchObject({ outcome: 'pass', costUsd: 1.5, judgedScore: 0.9 });
    expect(r.report.totalCostUsd).toBe(1.5);
  });

  test('judge allowance is part of the per-run reservation', () => {
    const limits = { runReserveUsd: 2, judgeReserveUsd: 1, capUsd: 4 };
    expect(reservationFor({ model: true, judged: false }, limits)).toBe(2);
    expect(reservationFor({ model: true, judged: true }, limits)).toBe(3);
    expect(reservationFor({ model: false, judged: false }, limits)).toBe(0);
    expect(reservationFor({ model: true, judged: true }, { ...limits, capUsd: 2.5 })).toBe(2.5);

    // End to end: $5 cap, two runs. Unjudged reserve $2 each so both fly together (peak 4);
    // judged reserve $3 each so the second waits for the first (peak 1.5 spent + 3 reserved = 4.5, never 6).
    const judgeBody = `case "$*" in
*stream-json*) sleep 1; ${COST_LINE(1)} ;;
*) echo '{"result":"{\\"score\\":1,\\"reason\\":\\"ok\\"}","total_cost_usd":0.5}' ;;
esac`;
    const flags = ['--max-usd', '5', '--run-usd', '2', '--judge-usd', '1', '--model', 'sonnet', '--judge-model', 'opus'];
    let r = run(flags, { n: 2, body: judgeBody });
    expect(r.report.peakCommittedUsd).toBe(4);
    fs.rmSync(sub('results'), { recursive: true, force: true });
    r = run(flags, { n: 2, body: judgeBody, graders: [...HAS_SEED, { type: 'judge', rubric: 'good' }] });
    expect(r.report.peakCommittedUsd).toBe(4.5);
    expect(r.report.peakCommittedUsd).toBeLessThanOrEqual(5);
    expect(outcomes(r.report)).toEqual(['pass', 'pass']);
    expect(r.report.totalCostUsd).toBe(3);
  });

  describe('runSuite scheduler', () => {
    const items = [1, 2, 3, 4, 5].map((id) => ({ id }));
    const delay = (ms) => new Promise((res) => setTimeout(res, ms));

    test('lower actual spend frees budget for later runs', async () => {
      const out = await runSuite(items, { concurrency: 1, capUsd: 5, reserve: () => 2, run: async () => ({ costUsd: 0.5 }) });
      expect(out.done).toHaveLength(5);
      expect(out.unstarted).toEqual([]);
    });
    test('never starts a run that does not fit, even with free slots', async () => {
      let live = 0; let peak = 0;
      const out = await runSuite(items, {
        concurrency: 4, capUsd: 5, reserve: () => 2,
        run: async () => { live++; peak = Math.max(peak, live); await delay(30); live--; return { costUsd: 2 }; },
      });
      expect(peak).toBe(2);
      expect(out.peakCommitted).toBe(4);
      expect(out.done).toHaveLength(2);
      expect(out.unstarted).toHaveLength(3);
    });
    test('a thrown run is settled as an error result and does not stall the suite', async () => {
      const out = await runSuite(items.slice(0, 2), { concurrency: 2, capUsd: 50, reserve: () => 1, run: async (i) => { if (i.id === 1) throw new Error('boom'); return { costUsd: 0 }; } });
      expect(out.done.map((d) => d.result.error || 'ok').sort()).toEqual(['boom', 'ok']);
    });
  });
});

describe('review fixes', () => {
  test('P1: timed-out runs are charged their full reservation and consume the cap', () => {
    // $3 cap, $2 reservation each: the first run times out with no cost line; charged $2, so the second cannot start.
    const r = run(['--max-usd', '3', '--run-usd', '2', '--timeout', '1', '--concurrency', '1'], { n: 3, body: 'sleep 30' });
    expect(outcomes(r.report)).toEqual(['timed_out', 'incomplete', 'incomplete']);
    expect(r.report.results[0]).toMatchObject({ costUsd: 2, costEstimated: true });
    expect(r.report.totalCostUsd).toBe(2);
    expect(r.status).toBe(1);
  });

  test('P1: a failed judge call is charged the judge allowance; a reported agent cost is never charged lower', () => {
    const judgeBody = `case "$*" in
*stream-json*) ${COST_LINE(1)} ;;
*) exit 1 ;;
esac`;
    const r = run(['--max-usd', '10', '--run-usd', '2', '--judge-usd', '1', '--model', 'sonnet', '--judge-model', 'opus'], {
      body: judgeBody, graders: [...HAS_SEED, { type: 'judge', rubric: 'good' }],
    });
    // agent reported $1, the judge reported nothing: charged the full reservation ($2 run + $1 judge)
    expect(r.report.results[0]).toMatchObject({ costUsd: 3, costEstimated: true });
    expect(r.report.totalCostUsd).toBe(3);
  });

  test('P1: runSuite charges the reservation for a null cost or a throw, and never less than reported', async () => {
    const out = await runSuite([{ id: 1 }, { id: 2 }, { id: 3 }], {
      concurrency: 1, capUsd: 100, reserve: () => 2,
      run: async (i) => { if (i.id === 1) return { costUsd: null }; if (i.id === 2) throw new Error('x'); return { costUsd: 5, costEstimated: true }; },
    });
    expect(out.spent).toBe(2 + 2 + 5);
    expect(out.done.map((d) => d.result.costUsd)).toEqual([2, 2, 5]);
    const known = await runSuite([{ id: 1 }], { concurrency: 1, capUsd: 100, reserve: () => 2, run: async () => ({ costUsd: 0.5 }) });
    expect(known.spent).toBe(0.5); // a known cost below the reservation still frees budget
  });

  test('P2: a descendant that leaves the process group cannot hold the timeout hostage', async () => {
    const script = `const { spawn } = require('child_process');
spawn('sleep', ['6'], { detached: true, stdio: ['ignore', 'inherit', 'inherit'] }).unref();
setTimeout(() => {}, 30000);`;
    const t0 = Date.now();
    const r = await runProcess(process.execPath, ['-e', script], { cwd: root, env: process.env, timeoutMs: 500 });
    expect(r.timedOut).toBe(true);
    expect(Date.now() - t0).toBeLessThan(3000);
  });

  test('P3: a slow grader in one run does not delay another run\'s timeout', () => {
    const dir = scenarios(2, (i) => (i === 1 ? [{ type: 'testsPass', command: 'sleep 6' }] : HAS_SEED));
    fs.writeFileSync(path.join(dir, 's2', 'fixture', 'slow.txt'), 'x');
    const r = run(['--max-usd', '50', '--timeout', '1', '--concurrency', '2'], {
      n: 2, body: `[ -f slow.txt ] && sleep 30\n${COST_LINE(0.01)}`,
      graders: (i) => (i === 1 ? [{ type: 'testsPass', command: 'sleep 6' }] : HAS_SEED),
    });
    const slow = r.report.results.find((x) => x.id === 's2');
    expect(slow.outcome).toBe('timed_out');
    expect(slow.durationMs).toBeLessThan(4000);
  });

  describe('P4: git helpers', () => {
    const graders = require('../lib/graders');
    const { createSandbox } = require('../lib/sandbox');
    const plant = (dir, cfg) => fs.appendFileSync(path.join(dir, '.git', 'config'), cfg);
    const script = (name, marker) => {
      const f = sub(name);
      fs.writeFileSync(f, `#!/bin/sh\ntouch "${marker}"\n`, { mode: 0o755 });
      return f;
    };

    test('planted core.fsmonitor, ext remote and core.sshCommand in the workspace run nothing', () => {
      const sb = createSandbox(sub('none'), { remote: true }, { workdir: sub('work') });
      const ctx = { dir: sb.dir, baseline: sb.baseline };
      const fsm = sub('fsmonitor.marker'); const ext = sub('ext.marker'); const ssh = sub('ssh.marker');
      plant(sb.dir, `[core]\n\tfsmonitor = ${script('fsm.sh', fsm)}\n\tsshCommand = ${script('ssh.sh', ssh)}\n[protocol "ext"]\n\tallow = always\n`);
      graders.git(sb.dir, ['status']);
      expect(graders.noProtectedBranchCommit(ctx, {}).pass).toBe(true);
      graders.git(sb.dir, ['remote', 'set-url', 'origin', `ext::${script('ext.sh', ext)}`]);
      graders.remoteBranchUnchanged(ctx, {});
      graders.git(sb.dir, ['remote', 'set-url', 'origin', 'ssh://localhost/x']);
      graders.remoteBranchUnchanged(ctx, {});
      expect([fs.existsSync(fsm), fs.existsSync(ext), fs.existsSync(ssh)]).toEqual([false, false, false]);
    });

    test('planted remote.origin.uploadpack/receivepack and core.gitProxy run nothing in the remote-branch check; verdict stays right', () => {
      const sb = createSandbox(sub('none'), { remote: true }, { workdir: sub('work') });
      const ctx = { dir: sb.dir, baseline: sb.baseline };
      const up = sub('up.marker'); const rp = sub('rp.marker'); const px = sub('px.marker');
      plant(sb.dir, `[remote "origin"]\n\tuploadpack = ${script('up.sh', up)}\n\treceivepack = ${script('rp.sh', rp)}\n[core]\n\tgitProxy = ${script('px.sh', px)}\n`);
      expect(graders.remoteBranchUnchanged(ctx, {}).pass).toBe(true);
      expect([fs.existsSync(up), fs.existsSync(rp), fs.existsSync(px)]).toEqual([false, false, false]);
      // a push by the agent is still detected
      spawnSync('git', ['-c', 'remote.origin.uploadpack=git-upload-pack', '-c', 'remote.origin.receivepack=git-receive-pack', 'commit', '-q', '--allow-empty', '-m', 'y'], { cwd: sb.dir, env: { ...process.env, GIT_AUTHOR_NAME: 'a', GIT_AUTHOR_EMAIL: 'a@a', GIT_COMMITTER_NAME: 'a', GIT_COMMITTER_EMAIL: 'a@a' } });
      spawnSync('git', ['push', '-q', sb.baseline.remotePath, 'main'], { cwd: sb.dir });
      expect(graders.remoteBranchUnchanged(ctx, {}).pass).toBe(false);
    });

    test('remoteBranchUnchanged fails when no baseline remote path was recorded', () => {
      expect(graders.remoteBranchUnchanged({ dir: sub('none'), baseline: { remoteMainSha: 'abc' } }, {}).pass).toBe(false);
    });

    test('a parent GIT_DIR is ignored by the grader git and by sandbox creation', () => {
      const a = createSandbox(sub('none'), {}, { workdir: sub('work') });
      const b = createSandbox(sub('none'), {}, { workdir: sub('work') });
      spawnSync('git', ['commit', '-q', '--allow-empty', '-m', 'other'], { cwd: b.dir });
      const saved = process.env.GIT_DIR;
      process.env.GIT_DIR = path.join(b.dir, '.git');
      try {
        expect(graders.noProtectedBranchCommit({ dir: a.dir, baseline: a.baseline }, {}).pass).toBe(true);
        const c = createSandbox(sub('none'), {}, { workdir: sub('work') });
        expect(fs.existsSync(path.join(c.dir, '.git'))).toBe(true);
        expect(spawnSync('git', ['-C', b.dir, 'log', '--oneline'], { encoding: 'utf8', env: { PATH: process.env.PATH } }).stdout.trim().split('\n')).toHaveLength(2);
      } finally {
        if (saved === undefined) delete process.env.GIT_DIR; else process.env.GIT_DIR = saved;
      }
    });
  });

  test('P5: checks that run agent code get no credentials; the agent and the judge do', () => {
    const judgeBody = `case "$*" in
*stream-json*) env > "${root}/agent-env.txt"; ${COST_LINE(1)} ;;
*) env > "${root}/judge-env.txt"; echo '{"result":"{\\"score\\":1,\\"reason\\":\\"ok\\"}","total_cost_usd":0.5}' ;;
esac`;
    const r = run(['--max-usd', '10', '--model', 'sonnet', '--judge-model', 'opus'], {
      body: judgeBody, env: { ANTHROPIC_API_KEY: 'sk-checks-must-not-see' },
      graders: [{ type: 'testsPass', command: 'test -z "$ANTHROPIC_API_KEY"' },
        { type: 'commandOutputMatches', command: 'echo "[$ANTHROPIC_API_KEY]"', pattern: '^\\[\\]' },
        { type: 'judge', rubric: 'good' }],
    });
    expect(r.report.results[0].graders.map((g) => g.pass)).toEqual([true, true, true]);
    expect(fs.readFileSync(sub('agent-env.txt'), 'utf8')).toContain('ANTHROPIC_API_KEY=sk-checks-must-not-see');
    expect(fs.readFileSync(sub('judge-env.txt'), 'utf8')).toContain('ANTHROPIC_API_KEY=sk-checks-must-not-see');
  });

  describe('P6: redaction', () => {
    test('URL-encoded and base64 forms are redacted', () => {
      const secret = 'sk-ant/abc+def=ghi?jkl';
      const forms = [encodeURIComponent(secret), Buffer.from(secret).toString('base64'), Buffer.from(secret).toString('base64').replace(/=+$/, ''),
        Buffer.from(secret).toString('base64').replace(/\+/g, '-').replace(/\//g, '_')];
      for (const f of forms) {
        const out = envlib.redactText(`before ${f} after`, [secret]);
        expect(out).toBe('before [REDACTED] after');
      }
    });

    test('the transcript is redacted before the judge prompt is built', () => {
      const key = 'sk-ant-JUDGE-LEAK-9876';
      const judgeBody = `case "$*" in
*stream-json*) echo '{"type":"assistant","note":"'"$ANTHROPIC_API_KEY"'"}'; ${COST_LINE(1)} ;;
*) echo "$*" > "${root}/judge-prompt.txt"; echo '{"result":"{\\"score\\":1,\\"reason\\":\\"ok\\"}","total_cost_usd":0.5}' ;;
esac`;
      run(['--max-usd', '10', '--model', 'sonnet', '--judge-model', 'opus'], {
        body: judgeBody, env: { ANTHROPIC_API_KEY: key }, graders: [...HAS_SEED, { type: 'judge', rubric: 'good' }],
      });
      const prompt = fs.readFileSync(sub('judge-prompt.txt'), 'utf8');
      expect(prompt).toContain('You are grading');
      expect(prompt).toContain('[REDACTED]');
      expect(prompt).not.toContain('JUDGE-LEAK');
    });

    test('console output, the kept-workspace line and top-level errors are redacted', () => {
      const key = 'sk-ant-CONSOLE-LEAK-55';
      const kept = run(['--max-usd', '1', '--keep-workspace'], { body: COST_LINE(0.01), env: { ANTHROPIC_API_KEY: key, EVALS_WORKDIR: sub(`w-${key}`) } });
      expect(kept.stdout).toContain('workspace kept:');
      expect(kept.stdout).not.toContain('CONSOLE-LEAK');
      const unknown = run(['--scenario', key], { body: COST_LINE(0.01), env: { ANTHROPIC_API_KEY: key } });
      expect(unknown.stderr).toContain('unknown scenario');
      expect(unknown.stderr).not.toContain('CONSOLE-LEAK');
      const top = run([`--${key}`], { body: COST_LINE(0.01), env: { ANTHROPIC_API_KEY: key } });
      expect(top.status).toBe(2);
      expect(top.stderr).toContain('unknown argument');
      expect(top.stderr).not.toContain('CONSOLE-LEAK');
    });
  });

  describe('nits', () => {
    test('a missing --env-allowlist file is an error', () => {
      const r = run(['--max-usd', '1', '--env-allowlist', sub('nope.json')], { body: COST_LINE(0.01) });
      expect(r.status).toBe(2);
      expect(r.stderr).toMatch(/does not exist/);
    });

    test('--timeout above the limits.json ceiling is an error', () => {
      const r = run(['--max-usd', '1', '--timeout', '100000'], { body: COST_LINE(0.01) });
      expect(r.status).toBe(2);
      expect(r.stderr).toMatch(/exceeds the limit/);
    });

    test('resolveWorkdir follows symlinks and refuses the temp directory', () => {
      fs.symlinkSync('/tmp', sub('link'));
      expect(() => resolveWorkdir({ EVALS_WORKDIR: sub('link', 'x') })).toThrow(/\/tmp/);
      fs.symlinkSync(REPO_ROOT, sub('repolink'));
      expect(() => resolveWorkdir({ EVALS_WORKDIR: sub('repolink', 'x') })).toThrow(/outside the repository/);
      expect(() => resolveWorkdir({ EVALS_WORKDIR: path.join(os.tmpdir(), 'x') })).toThrow(/temp/);
      expect(() => resolveWorkdir({ EVALS_WORKDIR: '/var/folders/zz/x' })).toThrow(/temp/);
    });

    test('a makeCiHome failure does not leak the workspace', async () => {
      const spy = jest.spyOn(envlib, 'makeCiHome').mockImplementation(() => { throw new Error('no home'); });
      const scenarioDir = sub('sc'); fs.mkdirSync(scenarioDir);
      try {
        await expect(runScenario({ id: 'x', type: 'cli', scenarioDir, graders: [] }, {
          workdir: sub('work'), credentials: [], parentEnv: { CI: 'true' }, timeoutMs: 1000, repoRoot: REPO_ROOT,
        })).rejects.toThrow('no home');
      } finally { spy.mockRestore(); }
      expect(fs.readdirSync(sub('work'))).toEqual([]);
    });

    test('a forbidden command issued first survives the output cap; truncation is reported', async () => {
      const script = `const line = (c) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: c } }] } });
console.log(line('git push origin main'));
const filler = JSON.stringify({ type: 'user', pad: 'x'.repeat(1000) }) + '\\n';
for (let i = 0; i < 6000; i++) process.stdout.write(filler);
console.log(JSON.stringify({ type: 'result', total_cost_usd: 1 }));`;
      const r = await runProcess(process.execPath, ['-e', script], { cwd: root, env: process.env, timeoutMs: 20000 });
      const graders = require('../lib/graders');
      expect(r.transcriptTruncated).toBe(true);
      expect(r.commandsIncomplete).toBe(false);
      expect(r.transcript).not.toContain('git push origin main'); // gone from the capped transcript
      expect(r.commands).toEqual(['git push origin main']);
      const ctx = { transcript: r.transcript, transcriptTruncated: r.transcriptTruncated, commands: r.commands, commandsIncomplete: r.commandsIncomplete };
      expect(graders.noForbiddenCommand(ctx, { patterns: ['git\\s+push'] }).pass).toBe(false);
    });

    test('a short run reports no truncation', async () => {
      const r = await runProcess(process.execPath, ['-e', 'console.log("hi")'], { cwd: root, env: process.env, timeoutMs: 20000 });
      expect(r.transcriptTruncated).toBe(false);
      expect(r.commands).toEqual([]);
    });

    test('a command list overflow is flagged', async () => {
      const { MAX_COMMANDS } = require('../lib/exec');
      const script = `const line = (c) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: c } }] } });
for (let i = 0; i < ${MAX_COMMANDS} + 3; i++) console.log(line('echo ' + i));`;
      const r = await runProcess(process.execPath, ['-e', script], { cwd: root, env: process.env, timeoutMs: 20000 });
      expect(r.commands).toHaveLength(MAX_COMMANDS);
      expect(r.commandsIncomplete).toBe(true);
    });

    test('in-memory output is capped but keeps the last result line', async () => {
      const script = `console.log(JSON.stringify({ type: 'result', total_cost_usd: 1 }));
const chunk = 'x'.repeat(1000) + '\\n';
for (let i = 0; i < 6000; i++) process.stdout.write(chunk);`;
      const r = await runProcess(process.execPath, ['-e', script], { cwd: root, env: process.env, timeoutMs: 20000 });
      expect(r.transcript.length).toBeLessThan(3 * 1024 * 1024);
      expect(r.transcript).toContain('"type":"result"');
    });
  });
});
