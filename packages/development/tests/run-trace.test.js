'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const {
  tracePath,
  createTracer,
  readTrace,
  summarize,
  briefSummary,
  formatSummary
} = require('../lib/run-trace');

const T0 = Date.parse('2026-11-06T10:00:00.000Z');
const iso = (offsetMs) => new Date(T0 + offsetMs).toISOString();

function fakeClock(start = 0) {
  const state = { wall: T0 + start, mono: 1000 + start };
  return {
    state,
    now: () => state.wall,
    mono: () => state.mono,
    advance(ms) {
      state.wall += ms;
      state.mono += ms;
    }
  };
}

let root;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'run-trace-'));
});
afterEach(() => {
  try {
    fs.chmodSync(path.join(root, '.ensemble', 'state', 'toolchain'), 0o755);
  } catch (_) {
    /* may not exist */
  }
  fs.rmSync(root, { recursive: true, force: true });
});

/** Build a materialized-span object directly (for pure summarize tests). */
function span(id, name, startMs, endMs, extra = {}) {
  return {
    run_id: 'r1',
    span_id: id,
    parent_id: null,
    name,
    kind: 'phase',
    start_ts: iso(startMs),
    end_ts: endMs === null ? null : iso(endMs),
    duration_ms: endMs === null ? null : endMs - startMs,
    status: endMs === null ? 'unfinished' : 'ok',
    attrs: {},
    ...extra
  };
}

function phaseSum(s) {
  return s.phases.reduce((n, p) => n + p.total_ms, 0);
}

describe('tracePath', () => {
  test('sits next to the ledger and validates the run id', () => {
    expect(tracePath('/p', 'run-1')).toBe(path.join('/p', '.ensemble', 'state', 'toolchain', 'trace-run-1.jsonl'));
    expect(() => tracePath('/p', '../evil')).toThrow(/invalid/);
    expect(() => tracePath('/p', 'a.b')).toThrow(/invalid/);
  });
});

describe('createTracer + readTrace', () => {
  test('records nested spans with parent links, attrs merge, and monotonic duration', () => {
    const clock = fakeClock();
    const t = createTracer({ runId: 'r1', projectRoot: root, clock });
    const round = t.startSpan('round', { attrs: { round: '1' } });
    clock.advance(100);
    const remediation = t.startSpan('remediation', { parentId: round });
    const sub = t.startSpan('subagent', { kind: 'agent', parentId: remediation, attrs: { finding_id: 'F1' } });
    clock.advance(400);
    t.endSpan(sub, { status: 'ok', attrs: { outcome: 'fixed', pushed: 'yes' } });
    t.endSpan(remediation);
    clock.advance(50);
    t.endSpan(round, { status: 'error' });

    const { spans, warnings, lastTs } = readTrace(tracePath(root, 'r1'));
    expect(warnings).toEqual([]);
    expect(lastTs).toBe(iso(550));
    const byName = Object.fromEntries(spans.map((s) => [s.name, s]));
    expect(byName.round.parent_id).toBeNull();
    expect(byName.remediation.parent_id).toBe(round);
    expect(byName.subagent.parent_id).toBe(remediation);
    expect(byName.subagent.kind).toBe('agent');
    expect(byName.subagent.attrs).toEqual({ finding_id: 'F1', outcome: 'fixed', pushed: 'yes' });
    expect(byName.subagent.duration_ms).toBe(400);
    expect(byName.round.duration_ms).toBe(550);
    expect(byName.round.status).toBe('error');
    expect(byName.round.attrs.round).toBe('1');
    expect(spans.every((s) => s.run_id === 'r1')).toBe(true);
  });

  test('every record is one complete JSON line with the contract fields', () => {
    const clock = fakeClock();
    const t = createTracer({ runId: 'r1', projectRoot: root, clock });
    const id = t.startSpan('preflight');
    t.endSpan(id);
    const lines = fs.readFileSync(tracePath(root, 'r1'), 'utf8').trimEnd().split('\n').map(JSON.parse);
    expect(lines).toHaveLength(2);
    expect(Object.keys(lines[0]).sort()).toEqual(
      ['attrs', 'kind', 'mono_ms', 'name', 'parent_id', 'pid', 'run_id', 'span_id', 'start_ts', 'type'].sort()
    );
    expect(lines[0]).toMatchObject({ type: 'span_start', parent_id: null, kind: 'phase', pid: process.pid });
    expect(Object.keys(lines[1]).sort()).toEqual(['attrs', 'end_ts', 'mono_ms', 'run_id', 'span_id', 'status', 'type']);
  });

  test('simulated kill: span_start with no span_end is unfinished, parseable, no invented end', () => {
    const clock = fakeClock();
    const t = createTracer({ runId: 'r1', projectRoot: root, clock });
    const done = t.startSpan('preflight');
    clock.advance(10);
    t.endSpan(done);
    clock.advance(5);
    t.startSpan('round', { attrs: { round: '1' } });
    // process "dies" here; also leave a torn half line like a kill mid-write
    fs.appendFileSync(tracePath(root, 'r1'), '{"type":"span_start","run_id":"r1","span_id":"zz');
    const { spans, warnings, lastTs } = readTrace(tracePath(root, 'r1'));
    const round = spans.find((s) => s.name === 'round');
    expect(round).toMatchObject({ status: 'unfinished', end_ts: null, duration_ms: null });
    expect(warnings).toHaveLength(1);
    expect(lastTs).toBe(iso(15));
    expect(spans.find((s) => s.name === 'preflight').status).toBe('ok');
  });

  test('real SIGKILL of a process holding an open span leaves it unfinished', async () => {
    const libPath = path.join(__dirname, '..', 'lib', 'run-trace.js');
    const script = `
      const { createTracer } = require(${JSON.stringify(libPath)});
      const t = createTracer({ runId: 'killme', projectRoot: ${JSON.stringify(root)} });
      const a = t.startSpan('round', { attrs: { round: '1' } });
      t.startSpan('subagent', { kind: 'agent', parentId: a, attrs: { finding_id: 'F9' } });
      console.log('ready');
      setInterval(() => {}, 1000);
    `;
    const child = spawn(process.execPath, ['-e', script], { stdio: ['ignore', 'pipe', 'inherit'] });
    await new Promise((resolve, reject) => {
      child.stdout.on('data', (d) => String(d).includes('ready') && resolve());
      child.on('error', reject);
      child.on('exit', () => reject(new Error('child exited early')));
    });
    const exited = new Promise((resolve) => child.on('exit', (code, signal) => resolve(signal)));
    child.kill('SIGKILL');
    expect(await exited).toBe('SIGKILL');

    const { spans } = readTrace(tracePath(root, 'killme'));
    expect(spans.map((s) => [s.name, s.status, s.end_ts, s.duration_ms])).toEqual([
      ['round', 'unfinished', null, null],
      ['subagent', 'unfinished', null, null]
    ]);
    expect(spans[1].parent_id).toBe(spans[0].span_id);
    const s = summarize({ spans, lastTs: null });
    expect(s.unfinished).toBe(2);
    expect(phaseSum(s) + s.unaccounted_ms).toBe(s.wall_ms);
  });

  test('withSpan ends ok, ends error and rethrows, and handles promises', async () => {
    const clock = fakeClock();
    const t = createTracer({ runId: 'r1', projectRoot: root, clock });
    expect(t.withSpan('a', {}, () => 7)).toBe(7);
    expect(() =>
      t.withSpan('b', {}, () => {
        throw new Error('boom');
      })
    ).toThrow('boom');
    await expect(t.withSpan('c', {}, async () => 'v')).resolves.toBe('v');
    await expect(
      t.withSpan('d', {}, async () => {
        throw new Error('async boom');
      })
    ).rejects.toThrow('async boom');
    const { spans } = readTrace(tracePath(root, 'r1'));
    expect(spans.map((s) => [s.name, s.status])).toEqual([
      ['a', 'ok'],
      ['b', 'error'],
      ['c', 'ok'],
      ['d', 'error']
    ]);
    expect(spans[1].attrs.error).toBe('boom');
  });

  test('withSpan passes the span id so children can nest', () => {
    const t = createTracer({ runId: 'r1', projectRoot: root, clock: fakeClock() });
    t.withSpan('outer', {}, (outerId) => t.withSpan('inner', { parentId: outerId }, () => {}));
    const { spans } = readTrace(tracePath(root, 'r1'));
    expect(spans.find((s) => s.name === 'inner').parent_id).toBe(spans.find((s) => s.name === 'outer').span_id);
  });

  test('clock going backwards: duration clamped to >= 0 with clock_anomaly', () => {
    const clock = fakeClock();
    const t = createTracer({ runId: 'r1', projectRoot: root, clock });
    const id = t.startSpan('x');
    clock.state.wall -= 5000; // wall clock stepped back
    clock.state.mono -= 5000; // and mono too (e.g. reboot between processes)
    t.endSpan(id);
    const [s] = readTrace(tracePath(root, 'r1')).spans;
    expect(s.duration_ms).toBe(0);
    expect(s.attrs.clock_anomaly).toBe(true);
  });

  test('wall stepped back but monotonic fine: monotonic duration kept, flagged', () => {
    const clock = fakeClock();
    const t = createTracer({ runId: 'r1', projectRoot: root, clock });
    const id = t.startSpan('x');
    clock.state.mono += 200;
    clock.state.wall -= 1000;
    t.endSpan(id);
    const [s] = readTrace(tracePath(root, 'r1')).spans;
    expect(s.duration_ms).toBe(200);
    expect(s.attrs.clock_anomaly).toBe(true);
  });

  test('monotonic running far ahead of wall is distrusted: wall delta used and flagged', () => {
    const clock = fakeClock();
    const t = createTracer({ runId: 'r1', projectRoot: root, clock });
    const id = t.startSpan('x');
    clock.state.wall += 100;
    clock.state.mono += 3_600_000; // different boot / host
    t.endSpan(id);
    const [s] = readTrace(tracePath(root, 'r1')).spans;
    expect(s.duration_ms).toBe(100);
    expect(s.attrs.clock_anomaly).toBe(true);
  });

  test('monotonic lagging wall (system sleep) is trusted and not an anomaly', () => {
    const clock = fakeClock();
    const t = createTracer({ runId: 'r1', projectRoot: root, clock });
    const id = t.startSpan('x');
    clock.state.wall += 60_000;
    clock.state.mono += 1_000;
    t.endSpan(id);
    const [s] = readTrace(tracePath(root, 'r1')).spans;
    expect(s.duration_ms).toBe(1000);
    expect(s.attrs.clock_anomaly).toBeUndefined();
  });

  test('missing mono readings fall back to wall delta', () => {
    const file = tracePath(root, 'r1');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      JSON.stringify({ type: 'span_start', run_id: 'r1', span_id: 'a', parent_id: null, name: 'x', kind: 'phase', start_ts: iso(0), attrs: {} }) +
        '\n' +
        JSON.stringify({ type: 'span_end', run_id: 'r1', span_id: 'a', end_ts: iso(750), status: 'ok', attrs: {} }) +
        '\n'
    );
    expect(readTrace(file).spans[0].duration_ms).toBe(750);
  });

  test('bad clock: one notice, startSpan still returns an id, nothing written', () => {
    const notices = [];
    const t = createTracer({
      runId: 'r1',
      projectRoot: root,
      clock: { now: () => NaN, mono: () => 0 },
      onUnavailable: (r) => notices.push(r)
    });
    const a = t.startSpan('a');
    const b = t.startSpan('b');
    expect(a).toMatch(/^[0-9a-f]{12}$/);
    expect(b).not.toBe(a);
    expect(t.endSpan(a)).toBe(false);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatch(/bad clock/);
    expect(fs.existsSync(tracePath(root, 'r1'))).toBe(false);
  });

  test('invalid run id: one notice at creation, spans still get ids, nothing written', () => {
    const notices = [];
    const t = createTracer({ runId: '../x', projectRoot: root, onUnavailable: (r) => notices.push(r) });
    expect(t.startSpan('a')).toMatch(/^[0-9a-f]{12}$/);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatch(/invalid/);
    expect(fs.existsSync(path.join(root, '.ensemble'))).toBe(false);
  });

  test('unknown kind and empty name degrade, never throw', () => {
    const notices = [];
    const t = createTracer({ runId: 'r1', projectRoot: root, clock: fakeClock(), onUnavailable: (r) => notices.push(r) });
    expect(() => t.startSpan('', {})).not.toThrow();
    expect(notices).toHaveLength(1);
  });

  test('endSpan for an unknown span degrades and writes nothing; double end degrades', () => {
    const notices = [];
    const t = createTracer({ runId: 'r1', projectRoot: root, clock: fakeClock(), onUnavailable: (r) => notices.push(r) });
    const real = t.startSpan('a');
    expect(t.endSpan('deadbeef0000')).toBe(false);
    expect(notices[0]).toMatch(/unknown span deadbeef0000/);
    expect(t.endSpan(real)).toBe(true);
    const t2 = createTracer({ runId: 'r1', projectRoot: root, clock: fakeClock(), onUnavailable: (r) => notices.push(r) });
    expect(t2.endSpan(real)).toBe(false); // already ended, seen via the file
    expect(notices[1]).toMatch(/already ended/);
    expect(readTrace(tracePath(root, 'r1')).spans).toHaveLength(1);
  });

  test('a second tracer instance (another process) can end a span started earlier', () => {
    const clock = fakeClock();
    const id = createTracer({ runId: 'r1', projectRoot: root, clock }).startSpan('a');
    clock.advance(30);
    expect(createTracer({ runId: 'r1', projectRoot: root, clock }).endSpan(id, { status: 'skipped' })).toBe(true);
    const [s] = readTrace(tracePath(root, 'r1')).spans;
    expect(s).toMatchObject({ status: 'skipped', duration_ms: 30 });
  });

  const asRoot = typeof process.getuid === 'function' && process.getuid() === 0;
  (asRoot ? test.skip : test)('unwritable state dir: single notice, id still returned, no throw', () => {
    const dir = path.join(root, '.ensemble', 'state', 'toolchain');
    fs.mkdirSync(dir, { recursive: true });
    fs.chmodSync(dir, 0o555);
    const notices = [];
    const t = createTracer({ runId: 'r1', projectRoot: root, clock: fakeClock(), onUnavailable: (r) => notices.push(r) });
    const id = t.startSpan('a');
    expect(id).toMatch(/^[0-9a-f]{12}$/);
    t.endSpan(id);
    t.startSpan('b');
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatch(/EACCES/);
  });

  test('readTrace on a missing file throws; readTrace tolerates duplicate/unknown records', () => {
    expect(() => readTrace(path.join(root, 'nope.jsonl'))).toThrow(/ENOENT/);
    const file = tracePath(root, 'r1');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const start = { type: 'span_start', run_id: 'r1', span_id: 'a', parent_id: null, name: 'x', kind: 'phase', start_ts: iso(0), mono_ms: 1, attrs: {} };
    fs.writeFileSync(
      file,
      [
        start,
        start,
        { type: 'span_end', run_id: 'r1', span_id: 'ghost', end_ts: iso(1), mono_ms: 2, status: 'ok', attrs: {} },
        { type: 'span_end', run_id: 'r1', span_id: 'a', end_ts: iso(10), mono_ms: 11, status: 'ok', attrs: {} },
        { type: 'span_end', run_id: 'r1', span_id: 'a', end_ts: iso(99), mono_ms: 99, status: 'error', attrs: {} }
      ]
        .map((r) => JSON.stringify(r))
        .join('\n') + '\n'
    );
    const { spans, warnings } = readTrace(file);
    expect(spans).toHaveLength(1);
    expect(spans[0]).toMatchObject({ status: 'ok', duration_ms: 10 });
    expect(warnings).toHaveLength(3);
  });
});

describe('summarize', () => {
  test('returns null for no spans', () => {
    expect(summarize([])).toBeNull();
    expect(summarize({ spans: [], lastTs: null })).toBeNull();
  });

  test('phase math: totals, percent, count, max, and unaccounted gap sum to wall exactly', () => {
    const spans = [
      span('a', 'preflight', 0, 1000),
      // 1000..1500 gap
      span('b', 'round', 1500, 5500),
      span('c', 'round', 5500, 6500),
      span('d', 'merge', 6500, 8000),
      // 8000..10000 gap, final span ends at 10000
      span('e', 'pr-comment', 10000, 10000)
    ];
    const s = summarize(spans);
    expect(s.wall_ms).toBe(10000);
    const row = (n) => s.phases.find((p) => p.name === n);
    expect(row('preflight')).toMatchObject({ total_ms: 1000, pct_of_wall: 10, count: 1, max_ms: 1000 });
    expect(row('round')).toMatchObject({ total_ms: 5000, pct_of_wall: 50, count: 2, max_ms: 4000 });
    expect(row('merge')).toMatchObject({ total_ms: 1500, pct_of_wall: 15, count: 1 });
    expect(row('pr-comment')).toMatchObject({ total_ms: 0, count: 1 });
    expect(s.unaccounted_ms).toBe(2500);
    expect(s.unaccounted_pct).toBe(25);
    expect(phaseSum(s) + s.unaccounted_ms).toBe(s.wall_ms);
    expect(s.largest_gaps.map((g) => g.ms)).toEqual([2000, 500]);
    expect(s.largest_gaps[0]).toEqual({ start: iso(8000), end: iso(10000), ms: 2000 });
  });

  test('overlapping top-level spans never double count; overlap goes to earliest-started', () => {
    const spans = [span('a', 'pr-discovery', 0, 4000), span('b', 'round', 3000, 9000), span('c', 'merge', 8000, 12000)];
    const s = summarize(spans);
    const total = (n) => s.phases.find((p) => p.name === n).total_ms;
    expect(total('pr-discovery')).toBe(4000);
    expect(total('round')).toBe(5000); // 4000..9000
    expect(total('merge')).toBe(3000); // 9000..12000
    expect(s.unaccounted_ms).toBe(0);
    expect(phaseSum(s)).toBe(s.wall_ms);
    // max still reports the span's own full duration
    expect(s.phases.find((p) => p.name === 'round').max_ms).toBe(6000);
  });

  test('a span fully nested inside an earlier top-level span gets zero attributed time', () => {
    const s = summarize([span('a', 'round', 0, 10000), span('b', 'merge', 2000, 3000)]);
    expect(s.phases.find((p) => p.name === 'merge').total_ms).toBe(0);
    expect(s.phases.find((p) => p.name === 'round').total_ms).toBe(10000);
    expect(phaseSum(s) + s.unaccounted_ms).toBe(s.wall_ms);
  });

  test('unfinished spans count to the last observed ts, flagged lower-bound, still sums exactly', () => {
    const spans = [span('a', 'preflight', 0, 1000), span('b', 'round', 2000, null), span('c', 'subagent', 2500, 4000, { parent_id: 'b' })];
    const s = summarize({ spans, lastTs: iso(7000) });
    expect(s.wall_ms).toBe(7000);
    const round = s.phases.find((p) => p.name === 'round');
    expect(round).toMatchObject({ total_ms: 5000, lower_bound: true, max_ms: 5000 });
    expect(s.unfinished).toBe(1);
    expect(s.unaccounted_ms).toBe(1000);
    expect(phaseSum(s) + s.unaccounted_ms).toBe(s.wall_ms);
    expect(s.top_spans[0]).toMatchObject({ name: 'round', lower_bound: true, duration_ms: 5000 });
    expect(s.inclusive.find((r) => r.name === 'round').lower_bound).toBe(true);
    expect(briefSummary(s, { path: 'p' }).unfinished).toBe(1);
  });

  test('without lastTs, unfinished span ends at the latest timestamp in the spans', () => {
    const s = summarize([span('a', 'preflight', 0, 1000), span('b', 'round', 500, null)]);
    expect(s.wall_ms).toBe(1000);
    expect(phaseSum(s) + s.unaccounted_ms).toBe(1000);
  });

  test('exactness holds over many random overlapping/unfinished layouts', () => {
    let seed = 12345;
    const rnd = (n) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    for (let iter = 0; iter < 200; iter += 1) {
      const spans = [];
      for (let i = 0; i < 1 + rnd(8); i += 1) {
        const st = rnd(10000);
        const unfinished = rnd(5) === 0;
        spans.push(span(`s${i}`, ['a', 'b', 'c'][rnd(3)], st, unfinished ? null : st + rnd(5000)));
      }
      const s = summarize({ spans, lastTs: iso(rnd(20000)) });
      expect(phaseSum(s) + s.unaccounted_ms).toBe(s.wall_ms);
      expect(s.unaccounted_ms).toBeGreaterThanOrEqual(0);
    }
  });

  test('human wait is the union of human-wait intervals and reported apart from machine time', () => {
    const spans = [
      span('r', 'round', 0, 10000),
      span('h1', 'human-wait.merge-confirm', 2000, 5000, { kind: 'human-wait', parent_id: 'r' }),
      span('h2', 'human-wait.other', 4000, 6000, { kind: 'human-wait', parent_id: 'r' }), // overlaps h1
      span('h3', 'human-wait.late', 8000, 9000, { kind: 'human-wait', parent_id: 'r' }),
      span('x', 'subagent', 0, 9500, { kind: 'agent', parent_id: 'r' }) // not a human wait
    ];
    const s = summarize(spans);
    expect(s.human_wait_ms).toBe(5000); // 2000..6000 + 8000..9000
    expect(s.machine_ms).toBe(5000);
    expect(s.human_wait_ms + s.machine_ms).toBe(s.wall_ms);
    expect(briefSummary(s, { path: 'p' })).toMatchObject({ human_wait_ms: 5000, machine_ms: 5000 });
  });

  test('nesting: parent chain, orphan spans counted as top-level, parent-unknown does not drop time', () => {
    const spans = [
      span('r', 'round', 0, 5000),
      span('m', 'manifest', 0, 3000, { parent_id: 'r' }),
      span('g', 'local-ci-gate', 0, 2500, { parent_id: 'm' }),
      span('o', 'subagent', 6000, 7000, { parent_id: 'gone' }),
      span('self', 'merge', 7000, 8000, { parent_id: 'self' })
    ];
    const s = summarize(spans);
    expect(s.orphan_spans).toBe(2);
    expect(s.phases.map((p) => p.name).sort()).toEqual(['merge', 'round', 'subagent']);
    expect(phaseSum(s) + s.unaccounted_ms).toBe(s.wall_ms);
    expect(s.unaccounted_ms).toBe(1000);
  });

  test('critical path lists top-level spans in order with heaviest-descendant chains', () => {
    const spans = [
      span('p', 'preflight', 0, 500),
      span('r', 'round', 500, 9500, { attrs: { round: '1' } }),
      span('man', 'manifest', 500, 1500, { parent_id: 'r' }),
      span('rem', 'remediation', 1500, 9000, { parent_id: 'r' }),
      span('sa1', 'subagent', 1500, 3000, { parent_id: 'rem', kind: 'agent' }),
      span('sa2', 'subagent', 1500, 8500, { parent_id: 'rem', kind: 'agent' }),
      span('bw', 'barrier-wait', 1500, 8600, { parent_id: 'rem', kind: 'io' }),
      span('mg', 'merge', 9500, 10000)
    ];
    const s = summarize(spans);
    expect(s.critical_path.map((c) => c.name)).toEqual(['preflight', 'round', 'merge']);
    const round = s.critical_path[1];
    expect(round.chain.map((c) => [c.name, c.duration_ms])).toEqual([
      ['remediation', 7500],
      ['barrier-wait', 7100]
    ]);
    expect(s.critical_path[0].chain).toEqual([]);
  });

  test('top 5 longest spans, descending, over all spans', () => {
    const spans = [];
    for (let i = 1; i <= 8; i += 1) spans.push(span(`s${i}`, `n${i}`, 0, i * 100, { parent_id: i === 1 ? null : 's1' }));
    const s = summarize(spans);
    expect(s.top_spans.map((t) => t.duration_ms)).toEqual([800, 700, 600, 500, 400]);
    expect(s.top_spans).toHaveLength(5);
  });

  test('slowest subagent per round, resolved through intermediate spans, rounds kept separate', () => {
    const spans = [
      span('r1', 'round', 0, 10000, { attrs: { round: '1' } }),
      span('rem1', 'remediation', 0, 9000, { parent_id: 'r1' }),
      span('a1', 'subagent', 0, 2000, { parent_id: 'rem1', kind: 'agent', attrs: { finding_id: 'F1', agent: 'x' } }),
      span('a2', 'subagent', 0, 8000, { parent_id: 'rem1', kind: 'agent', attrs: { finding_id: 'F2', agent: 'y' } }),
      span('r2', 'round', 10000, 14000, { attrs: { round: '2' } }),
      span('a3', 'subagent', 10000, 11000, { parent_id: 'r2', kind: 'agent', attrs: { finding_id: 'F3', agent: 'z' } }),
      span('stray', 'subagent', 0, 99999, { kind: 'agent', attrs: { finding_id: 'FX' } }) // no round ancestor
    ];
    const s = summarize(spans);
    expect(s.slowest_subagent_per_round.map((r) => [r.round, r.finding_id, r.agent, r.duration_ms])).toEqual([
      ['1', 'F2', 'y', 8000],
      ['2', 'F3', 'z', 1000]
    ]);
  });

  test('inclusive table covers all spans and is flagged non-summable in the text report', () => {
    const spans = [span('r', 'round', 0, 1000), span('m', 'manifest', 0, 800, { parent_id: 'r' })];
    const s = summarize(spans);
    expect(s.inclusive.map((r) => [r.name, r.total_ms])).toEqual([
      ['round', 1000],
      ['manifest', 800]
    ]);
    const text = formatSummary(s);
    expect(text).toMatch(/NOT summable/);
    expect(text).toMatch(/\(unaccounted\)/);
    expect(text).toMatch(/Critical path/);
    expect(text).toMatch(/Top 5 longest spans/);
  });

  test('briefSummary has exactly the contract keys and phase totals', () => {
    const s = summarize([span('a', 'preflight', 0, 1000), span('b', 'merge', 2000, 3000)]);
    const b = briefSummary(s, { path: '/x/trace-r1.jsonl' });
    expect(Object.keys(b).sort()).toEqual(['human_wait_ms', 'machine_ms', 'path', 'phases', 'unaccounted_ms', 'unfinished', 'wall_ms']);
    expect(b).toMatchObject({ path: '/x/trace-r1.jsonl', wall_ms: 3000, phases: { preflight: 1000, merge: 1000 }, unaccounted_ms: 1000, human_wait_ms: 0, machine_ms: 3000, unfinished: 0 });
  });

  test('end-to-end: tracer output summarized within exact accounting', () => {
    const clock = fakeClock();
    const t = createTracer({ runId: 'r1', projectRoot: root, clock });
    t.withSpan('preflight', {}, () => clock.advance(1000));
    clock.advance(250);
    const round = t.startSpan('round', { attrs: { round: '1' } });
    const sa = t.startSpan('subagent', { kind: 'agent', parentId: round, attrs: { finding_id: 'F1', agent: 'a' } });
    clock.advance(3000);
    t.endSpan(sa);
    t.endSpan(round);
    t.startSpan('merge'); // never ended
    clock.advance(500);
    const s = summarize(readTrace(tracePath(root, 'r1')));
    // the unfinished merge span starts at the last timestamp ever written (4250): nothing invented after it
    expect(s.wall_ms).toBe(4250);
    expect(s.unaccounted_ms).toBe(250);
    expect(s.phases.find((p) => p.name === 'merge')).toMatchObject({ total_ms: 0, lower_bound: true });
    expect(phaseSum(s) + s.unaccounted_ms).toBe(s.wall_ms);
  });
});
