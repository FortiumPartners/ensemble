'use strict';

/**
 * The host-load sampler (kata nj2d, plan v2 section 5 child V2-1): a 30-second sampler that appends the machine's load average to a file
 * beside the run's trace, so a review's wall time can be read against the load it ran under (the plan's R2 measurement saw 19.1 on 18 cores
 * while the local-CI gate and the review agents ran together; R3 took no samples).
 *
 * It is optional and runs apart from the review: nothing in a review waits for it, and a review without samples reports its host load as
 * MISSING with the reason. It never writes a figure it does not have: a platform without load averages (win32 reports 0 for all three,
 * which is no measurement) is refused, a sample line that does not hold a time and three finite non-negative loads is skipped when read.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const { DEFAULT_INTERVAL_MS, loadPath, takeSample, parseLoadSamples, readLoadSamples, runSampler, main } = require('../lib/pr-review-load');

const SCRATCH = path.join(os.homedir(), '.omp', 'pr-review-speedup', 'prs-agent-stats', 'scratch-load');
const LIB = path.join(__dirname, '..', 'lib', 'pr-review-load.js');
const roots = [];
afterAll(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});
function project() {
  fs.mkdirSync(SCRATCH, { recursive: true });
  const root = fs.mkdtempSync(path.join(SCRATCH, 'l-'));
  roots.push(root);
  return root;
}

const T0 = Date.parse('2026-11-11T10:00:00.000Z');
const fakeDeps = (over = {}) => {
  let tick = T0;
  const slept = [];
  return {
    slept,
    platform: 'linux',
    now: () => tick,
    cpus: () => 8,
    loadavg: () => [1.234, 2.5, 3],
    sleep: async (ms) => {
      slept.push(ms);
      tick += ms;
    },
    ...over,
  };
};
const lines = (file) => fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);

describe('where the samples go', () => {
  test('beside the run trace, under the same run id rules', () => {
    expect(loadPath('/repo', 'run-1')).toBe(path.join('/repo', '.ensemble', 'state', 'toolchain', 'load-run-1.jsonl'));
    for (const bad of ['', '../x', 'a/b', '.', 'x'.repeat(200)]) expect(() => loadPath('/repo', bad)).toThrow(/run id|runId|invalid/i);
  });

  test('the default interval is 30 seconds', () => {
    expect(DEFAULT_INTERVAL_MS).toBe(30000);
  });
});

describe('one sample', () => {
  test('is the time, the three load averages rounded to two places, and the cpu count', () => {
    expect(takeSample(fakeDeps())).toEqual({ ts: '2026-11-11T10:00:00.000Z', load1: 1.23, load5: 2.5, load15: 3, cpus: 8 });
  });

  test.each([
    ['NaN', [NaN, 1, 1]],
    ['a negative', [-1, 1, 1]],
    ['too few', [1, 1]],
    ['a string', ['1', 1, 1]],
  ])('a load reading that is %s is no sample (never written as 0)', (_label, reading) => {
    expect(takeSample(fakeDeps({ loadavg: () => reading }))).toBeNull();
  });
});

describe('reading a samples file', () => {
  const good = (sec, load1) => JSON.stringify({ ts: new Date(T0 + sec * 1000).toISOString(), load1, load5: load1, load15: load1, cpus: 8 });

  test('valid lines become samples in file order; blank lines are nothing', () => {
    const { samples, warnings } = parseLoadSamples(`${good(0, 1)}\n\n${good(30, 2.5)}\n`);
    expect(warnings).toEqual([]);
    expect(samples).toEqual([
      { ts: '2026-11-11T10:00:00.000Z', tsMs: T0, load1: 1, load5: 1, load15: 1, cpus: 8 },
      { ts: '2026-11-11T10:00:30.000Z', tsMs: T0 + 30000, load1: 2.5, load5: 2.5, load15: 2.5, cpus: 8 },
    ]);
  });

  test.each([
    ['text that is not JSON', 'not json'],
    ['JSON that is not an object', '[1,2]'],
    ['a line with no time', JSON.stringify({ load1: 1, load5: 1, load15: 1 })],
    ['a time that is not ISO-8601 with a zone', JSON.stringify({ ts: '2026-11-11 10:00:00', load1: 1, load5: 1, load15: 1 })],
    ['a negative load', JSON.stringify({ ts: '2026-11-11T10:00:00.000Z', load1: -1, load5: 1, load15: 1, cpus: 8 })],
    ['a load that is a string', JSON.stringify({ ts: '2026-11-11T10:00:00.000Z', load1: '1', load5: 1, load15: 1, cpus: 8 })],
    ['a load that is null (what JSON makes of NaN)', JSON.stringify({ ts: '2026-11-11T10:00:00.000Z', load1: 1, load5: null, load15: 1, cpus: 8 })],
    ['a missing load', JSON.stringify({ ts: '2026-11-11T10:00:00.000Z', load1: 1, load5: 1, cpus: 8 })],
    ['a cpu count that is 0', JSON.stringify({ ts: '2026-11-11T10:00:00.000Z', load1: 1, load5: 1, load15: 1, cpus: 0 })],
    ['a line with no cpus key', JSON.stringify({ ts: '2026-11-11T10:00:00.000Z', load1: 1, load5: 1, load15: 1 })],
  ])('%s is skipped and named, never read as a sample of 0', (_label, line) => {
    const { samples, warnings } = parseLoadSamples(`${good(0, 1)}\n${line}\n${good(30, 2)}\n`);
    expect(samples.map((s) => s.load1)).toEqual([1, 2]);
    expect(warnings).toEqual([expect.stringMatching(/^line 2: .*skipped$/)]);
  });

  test('a line with `cpus: null` is a sample with no cpu count', () => {
    const { samples } = parseLoadSamples(JSON.stringify({ ts: '2026-11-11T10:00:00.000Z', load1: 1, load5: 1, load15: 1, cpus: null }));
    expect(samples).toHaveLength(1);
    expect(samples[0].cpus).toBeNull();
  });

  test('a file that is not there is a reason, not an empty set of samples', () => {
    const root = project();
    const answer = readLoadSamples(root, 'r1');
    expect(answer.ok).toBe(false);
    expect(answer.reason).toContain(loadPath(root, 'r1'));
    expect(answer.reason).toMatch(/the sampler was not run/);
  });

  test('a file with no usable line is a reason too (an empty file is not a quiet machine)', () => {
    const root = project();
    fs.mkdirSync(path.dirname(loadPath(root, 'r2')), { recursive: true });
    fs.writeFileSync(loadPath(root, 'r2'), 'garbage\n');
    const answer = readLoadSamples(root, 'r2');
    expect(answer).toMatchObject({ ok: false });
    expect(answer.reason).toMatch(/no usable sample/);
  });

  test('a readable file answers its samples, its warnings and its path', () => {
    const root = project();
    fs.mkdirSync(path.dirname(loadPath(root, 'r3')), { recursive: true });
    fs.writeFileSync(loadPath(root, 'r3'), `${good(0, 1)}\nnope\n${good(30, 2)}\n`);
    const answer = readLoadSamples(root, 'r3');
    expect(answer).toMatchObject({ ok: true, path: loadPath(root, 'r3'), warnings: [expect.stringMatching(/^line 2:/)] });
    expect(answer.samples).toHaveLength(2);
  });

  test('an invalid run id is a reason, not a throw or a read outside the state directory', () => {
    expect(readLoadSamples(project(), '../../etc/passwd')).toMatchObject({ ok: false });
  });
});

describe('the sampler', () => {
  test('appends one JSON line per interval, the first at once, and stops at the sample limit', async () => {
    const root = project();
    const deps = fakeDeps();
    const answer = await runSampler({ projectRoot: root, runId: 'r1', intervalMs: 30000, maxSamples: 3 }, deps);
    expect(answer).toEqual({ ok: true, file: loadPath(root, 'r1'), samples: 3 });
    expect(lines(loadPath(root, 'r1')).map((line) => JSON.parse(line).ts)).toEqual(['2026-11-11T10:00:00.000Z', '2026-11-11T10:00:30.000Z', '2026-11-11T10:01:00.000Z']);
    // sleeps between samples only: no sleep after the last one
    expect(deps.slept).toEqual([30000, 30000]);
  });

  test('stops when its time is up, whatever the sample limit', async () => {
    const root = project();
    const deps = fakeDeps();
    const answer = await runSampler({ projectRoot: root, runId: 'r2', intervalMs: 30000, maxMs: 90000 }, deps);
    expect(answer.samples).toBe(4); // 0, 30, 60 and 90 seconds
    expect(deps.slept).toHaveLength(3);
  });

  test('stops when asked to (`shouldStop`), and the samples already written stay', async () => {
    const root = project();
    let calls = 0;
    const answer = await runSampler({ projectRoot: root, runId: 'r3', intervalMs: 30000, maxSamples: 99 }, fakeDeps({ shouldStop: () => (calls += 1) > 2 }));
    expect(answer.samples).toBe(2);
    expect(lines(loadPath(root, 'r3'))).toHaveLength(2);
  });

  test('a sampler started again on the same run adds to the file, it never truncates it', async () => {
    const root = project();
    await runSampler({ projectRoot: root, runId: 'r4', intervalMs: 1000, maxSamples: 2 }, fakeDeps());
    await runSampler({ projectRoot: root, runId: 'r4', intervalMs: 1000, maxSamples: 1 }, fakeDeps());
    expect(lines(loadPath(root, 'r4'))).toHaveLength(3);
  });

  test('a reading that is no sample is skipped, never written as 0, and the sampler goes on', async () => {
    const root = project();
    let n = 0;
    const loadavg = () => (n++ === 1 ? [NaN, 1, 1] : [2, 2, 2]);
    const answer = await runSampler({ projectRoot: root, runId: 'r5', intervalMs: 1000, maxSamples: 3 }, fakeDeps({ loadavg }));
    expect(answer.samples).toBe(2);
    expect(lines(loadPath(root, 'r5')).map((line) => JSON.parse(line).load1)).toEqual([2, 2]);
  });

  test('a platform without load averages is refused before anything is written (win32 reports 0 for all three)', async () => {
    const root = project();
    const answer = await runSampler({ projectRoot: root, runId: 'r6', intervalMs: 1000, maxSamples: 1 }, fakeDeps({ platform: 'win32' }));
    expect(answer).toMatchObject({ ok: false, reason: expect.stringMatching(/win32/) });
    expect(fs.existsSync(loadPath(root, 'r6'))).toBe(false);
  });

  test('a directory it cannot write to is a reason, not a hang or a throw', async () => {
    const root = project();
    fs.writeFileSync(path.join(root, '.ensemble'), 'a file where the directory should be');
    const answer = await runSampler({ projectRoot: root, runId: 'r7', intervalMs: 1000, maxSamples: 1 }, fakeDeps());
    expect(answer).toMatchObject({ ok: false, reason: expect.stringContaining('cannot write') });
  });
});

describe('the command line', () => {
  const run = async (argv, deps) => {
    const out = [];
    const code = await main(argv, { out: (text) => out.push(text), deps: deps || fakeDeps() });
    return { code, out: out.join('') };
  };

  test('`sample` writes the file and says where, how often and how to stop it', async () => {
    const root = project();
    const { code, out } = await run(['sample', '--run-id', 'c1', '--cwd', root, '--interval-sec', '30', '--max-samples', '2']);
    expect(code).toBe(0);
    expect(out).toContain(loadPath(root, 'c1'));
    expect(out).toMatch(/every 30 s/);
    expect(out).toMatch(/2 samples/);
    expect(lines(loadPath(root, 'c1'))).toHaveLength(2);
  });

  test.each([
    ['no subcommand', []],
    ['an unknown subcommand', ['watch']],
    ['no run id', ['sample', '--cwd', '/x']],
    ['an invalid run id', ['sample', '--run-id', '../x']],
    ['an interval of 0', ['sample', '--run-id', 'a', '--interval-sec', '0']],
    ['an interval that is not a number', ['sample', '--run-id', 'a', '--interval-sec', 'soon']],
    ['an interval over an hour', ['sample', '--run-id', 'a', '--interval-sec', '3601']],
    ['a sample limit of 0', ['sample', '--run-id', 'a', '--max-samples', '0']],
    ['a time limit that is negative', ['sample', '--run-id', 'a', '--max-minutes', '-1']],
    ['an unknown option', ['sample', '--run-id', 'a', '--loud']],
    ['an option without its value', ['sample', '--run-id']],
  ])('%s is a usage error: exit 2 and nothing written', async (_label, argv) => {
    const { code, out } = await run(argv);
    expect(code).toBe(2);
    expect(out).toMatch(/Usage: node pr-review-load.js sample/);
  });

  test('a platform without load averages exits 3 with the reason', async () => {
    const { code, out } = await run(['sample', '--run-id', 'w1', '--cwd', project(), '--max-samples', '1'], fakeDeps({ platform: 'win32' }));
    expect(code).toBe(3);
    expect(out).toMatch(/win32/);
  });
});

describe('as a process of its own (the way a dispatcher starts it)', () => {
  test('writes real samples and stops on its own at the limit, with exit 0', () => {
    const root = project();
    const r = spawnSync(process.execPath, [LIB, 'sample', '--run-id', 'p1', '--cwd', root, '--interval-sec', '1', '--max-samples', '2'], { encoding: 'utf8', timeout: 30000 });
    expect(r.status).toBe(0);
    const samples = lines(loadPath(root, 'p1')).map((line) => JSON.parse(line));
    expect(samples).toHaveLength(2);
    for (const s of samples) expect(s).toMatchObject({ load1: expect.any(Number), load5: expect.any(Number), load15: expect.any(Number), cpus: os.cpus().length });
    expect(Date.parse(samples[1].ts) - Date.parse(samples[0].ts)).toBeGreaterThanOrEqual(900);
  });

  test('a SIGTERM stops it at once and leaves the samples it took (a dispatcher kills it when the run is over)', async () => {
    const root = project();
    const child = spawn(process.execPath, [LIB, 'sample', '--run-id', 'p2', '--cwd', root, '--interval-sec', '1'], { stdio: 'ignore' });
    const exited = new Promise((resolve) => child.on('exit', (code, signal) => resolve({ code, signal })));
    await new Promise((resolve) => setTimeout(resolve, 1500));
    child.kill('SIGTERM');
    const { code } = await exited;
    expect(code).toBe(0);
    expect(lines(loadPath(root, 'p2')).length).toBeGreaterThanOrEqual(1);
  });
});
