'use strict';

/**
 * CLI-level tests for `toolchain-cli trace start|end|summarize` (kata acvv). They spawn the
 * real `node lib/toolchain-cli.js` against a temp project directory.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const CLI = path.join(__dirname, '..', 'lib', 'toolchain-cli.js');
const { main } = require('../lib/toolchain-cli');
const { tracePath, readTrace } = require('../lib/run-trace');

let root;
beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tc-trace-')));
});
afterEach(() => {
  try {
    fs.chmodSync(path.join(root, '.ensemble', 'state', 'toolchain'), 0o755);
  } catch (_) {
    /* may not exist */
  }
  fs.rmSync(root, { recursive: true, force: true });
});

function cli(args) {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd: root, encoding: 'utf8' });
  return { code: r.status, out: r.stdout, err: r.stderr };
}
const ID = /^[0-9a-f]{12}$/;
const stderrLines = (r) => r.err.split('\n').filter(Boolean);

describe('trace start / end', () => {
  test('start prints a span id; end closes it; trace file holds both records', () => {
    const start = cli(['trace', 'start', '--run-id', 'r1', '--name', 'round', '--attr', 'round=1', '--attr', 'x=a=b']);
    expect(start.code).toBe(0);
    expect(start.err).toBe('');
    const id = start.out.trim();
    expect(id).toMatch(ID);
    const end = cli(['trace', 'end', '--run-id', 'r1', '--span-id', id, '--status', 'skipped', '--attr', 'cache=hit']);
    expect(end).toMatchObject({ code: 0, out: '', err: '' });
    const [s] = readTrace(tracePath(root, 'r1')).spans;
    expect(s).toMatchObject({ span_id: id, name: 'round', kind: 'phase', status: 'skipped', parent_id: null });
    expect(s.attrs).toEqual({ round: '1', x: 'a=b', cache: 'hit' });
    expect(s.duration_ms).toBeGreaterThanOrEqual(0);
  });

  test('--json envelopes, --kind and --parent nesting across separate processes', () => {
    const parent = JSON.parse(cli(['trace', 'start', '--run-id', 'r1', '--name', 'round', '--json']).out);
    expect(parent.ok).toBe(true);
    const child = JSON.parse(
      cli(['trace', 'start', '--run-id', 'r1', '--name', 'subagent', '--kind', 'agent', '--parent', parent.span_id, '--json']).out
    );
    expect(cli(['trace', 'end', '--run-id', 'r1', '--span-id', child.span_id, '--json']).out.trim()).toBe('{"ok":true}');
    const spans = readTrace(tracePath(root, 'r1')).spans;
    const sub = spans.find((s) => s.name === 'subagent');
    expect(sub.parent_id).toBe(parent.span_id);
    expect(sub.kind).toBe('agent');
    expect(spans.find((s) => s.name === 'round').status).toBe('unfinished');
  });

  test('named flag values may not look like flags (explicit, but degraded for start/end)', () => {
    const r = cli(['trace', 'start', '--run-id', 'r1', '--name', '--json']);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/\S/);
    expect(stderrLines(r)).toHaveLength(1);
    expect(r.err).toMatch(/^trace: unavailable \(--name requires a value/);
  });

  test.each([
    ['missing run id', ['trace', 'start', '--name', 'a'], /--run-id is required/],
    ['invalid run id', ['trace', 'start', '--run-id', '../x', '--name', 'a'], /invalid/],
    ['missing name', ['trace', 'start', '--run-id', 'r1'], /--name is required/],
    ['unknown kind', ['trace', 'start', '--run-id', 'r1', '--name', 'a', '--kind', 'bogus'], /unknown span kind/],
    ['malformed attr', ['trace', 'start', '--run-id', 'r1', '--name', 'a', '--attr', 'oops'], /--attr value/]
  ])('start degrades on %s: exit 0, one stderr line, still prints an id', (_label, args, reason) => {
    const r = cli(args);
    expect(r.code).toBe(0);
    expect(r.out.trim()).toMatch(ID);
    expect(stderrLines(r)).toHaveLength(1);
    expect(r.err).toMatch(/^trace: unavailable \(/);
    expect(r.err).toMatch(reason);
    expect(fs.existsSync(path.join(root, '.ensemble', 'state', 'toolchain', 'trace-r1.jsonl'))).toBe(false);
  });

  test('start --json on failure still reports ok:true with a span id', () => {
    const r = cli(['trace', 'start', '--run-id', '../x', '--name', 'a', '--json']);
    const parsed = JSON.parse(r.out);
    expect(r.code).toBe(0);
    expect(parsed).toMatchObject({ ok: true, trace: 'unavailable' });
    expect(parsed.span_id).toMatch(ID);
    expect(stderrLines(r)).toHaveLength(1);
  });

  test('end for an unknown span degrades: exit 0, one stderr line, file untouched', () => {
    const id = cli(['trace', 'start', '--run-id', 'r1', '--name', 'a']).out.trim();
    const before = fs.readFileSync(tracePath(root, 'r1'), 'utf8');
    const r = cli(['trace', 'end', '--run-id', 'r1', '--span-id', 'ffffffffffff']);
    expect(r.code).toBe(0);
    expect(stderrLines(r)).toEqual(['trace: unavailable (unknown span ffffffffffff)']);
    expect(fs.readFileSync(tracePath(root, 'r1'), 'utf8')).toBe(before);
    // ending the span twice degrades the second time
    expect(cli(['trace', 'end', '--run-id', 'r1', '--span-id', id]).err).toBe('');
    expect(cli(['trace', 'end', '--run-id', 'r1', '--span-id', id]).err).toMatch(/already ended/);
  });

  test('end with no trace file at all degrades', () => {
    const r = cli(['trace', 'end', '--run-id', 'r1', '--span-id', 'abcdefabcdef']);
    expect(r.code).toBe(0);
    expect(stderrLines(r)).toHaveLength(1);
    expect(r.err).toMatch(/^trace: unavailable \(cannot read trace/);
  });

  test('end without --span-id degrades; end --json carries the reason', () => {
    const r = cli(['trace', 'end', '--run-id', 'r1']);
    expect(r.code).toBe(0);
    expect(r.err).toMatch(/--span-id is required/);
    const j = JSON.parse(cli(['trace', 'end', '--run-id', 'r1', '--span-id', 'abcdefabcdef', '--json']).out);
    expect(j).toMatchObject({ ok: true, trace: 'unavailable' });
  });

  const asRoot = typeof process.getuid === 'function' && process.getuid() === 0;
  (asRoot ? test.skip : test)('unwritable state dir: start/end exit 0, one stderr line each, start still prints an id', () => {
    const dir = path.join(root, '.ensemble', 'state', 'toolchain');
    fs.mkdirSync(dir, { recursive: true });
    fs.chmodSync(dir, 0o555);
    const start = cli(['trace', 'start', '--run-id', 'r1', '--name', 'a']);
    expect(start.code).toBe(0);
    expect(start.out.trim()).toMatch(ID);
    expect(stderrLines(start)).toHaveLength(1);
    expect(start.err).toMatch(/^trace: unavailable \(EACCES/);
    const end = cli(['trace', 'end', '--run-id', 'r1', '--span-id', start.out.trim()]);
    expect(end.code).toBe(0);
    expect(stderrLines(end)).toHaveLength(1);
    expect(end.err).toMatch(/^trace: unavailable \(/);
    const sum = cli(['trace', 'summarize', '--run-id', 'r1', '--brief']);
    expect(sum.code).toBe(0);
    expect(JSON.parse(sum.out)).toMatchObject({ trace: 'unavailable' });
  });

  test('in-process main() works with an injected projectRoot and returns exit code 0', () => {
    const writes = [];
    const spy = jest.spyOn(process.stdout, 'write').mockImplementation((s) => {
      writes.push(String(s));
      return true;
    });
    let code;
    try {
      code = main(['trace', 'start', '--run-id', 'r1', '--name', 'a'], { projectRoot: root, env: {} });
    } finally {
      spy.mockRestore();
    }
    expect(code).toBe(0);
    expect(writes.join('').trim()).toMatch(ID);
    expect(readTrace(tracePath(root, 'r1')).spans).toHaveLength(1);
  });
});

describe('trace summarize', () => {
  function seed() {
    const file = tracePath(root, 'r1');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const T0 = Date.parse('2026-11-06T10:00:00.000Z');
    const iso = (ms) => new Date(T0 + ms).toISOString();
    const recs = [];
    const add = (id, name, start, end, extra = {}) => {
      recs.push({ type: 'span_start', run_id: 'r1', span_id: id, parent_id: extra.parent || null, name, kind: extra.kind || 'phase', start_ts: iso(start), mono_ms: 5000 + start, attrs: extra.attrs || {}, pid: 1 });
      if (end !== null) recs.push({ type: 'span_end', run_id: 'r1', span_id: id, end_ts: iso(end), mono_ms: 5000 + end, status: 'ok', attrs: {} });
    };
    add('p', 'preflight', 0, 1000);
    add('r', 'round', 1500, 9500, { attrs: { round: '1' } });
    add('s1', 'subagent', 2000, 8000, { parent: 'r', kind: 'agent', attrs: { finding_id: 'F1', agent: 'fixer' } });
    add('h', 'human-wait.merge-confirm', 9000, 9500, { parent: 'r', kind: 'human-wait' });
    add('m', 'merge', 9500, null);
    fs.writeFileSync(file, recs.map((r) => JSON.stringify(r)).join('\n') + '\n');
    return file;
  }

  test('--brief prints the contract object', () => {
    const file = seed();
    const r = cli(['trace', 'summarize', '--run-id', 'r1', '--brief']);
    expect(r.code).toBe(0);
    const b = JSON.parse(r.out);
    expect(b).toEqual({
      path: file,
      wall_ms: 9500,
      phases: { preflight: 1000, round: 8000, merge: 0 },
      unaccounted_ms: 500,
      human_wait_ms: 500,
      machine_ms: 9000,
      unfinished: 1
    });
    expect(Object.values(b.phases).reduce((a, c) => a + c, 0) + b.unaccounted_ms).toBe(b.wall_ms);
  });

  test('--json prints the full summary', () => {
    seed();
    const j = JSON.parse(cli(['trace', 'summarize', '--run-id', 'r1', '--json']).out);
    expect(j.slowest_subagent_per_round).toEqual([
      expect.objectContaining({ round: '1', finding_id: 'F1', agent: 'fixer', duration_ms: 6000 })
    ]);
    expect(j.top_spans[0].name).toBe('round');
    expect(j.critical_path.map((c) => c.name)).toEqual(['preflight', 'round', 'merge']);
    expect(j.inclusive.length).toBeGreaterThan(0);
  });

  test('text output has the phase table, unaccounted row, critical path, top 5', () => {
    seed();
    const r = cli(['trace', 'summarize', '--run-id', 'r1']);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/phase\s+total\s+% wall\s+count\s+max/);
    expect(r.out).toMatch(/\(unaccounted\)/);
    expect(r.out).toMatch(/Critical path/);
    expect(r.out).toMatch(/Top 5 longest spans/);
    expect(r.out).toMatch(/Slowest subagent per round/);
    expect(r.out).toMatch(/lower bound/);
  });

  test('missing trace: unavailable with reason; exit 1 (json/text), 0 for --brief', () => {
    const j = cli(['trace', 'summarize', '--run-id', 'nope', '--json']);
    expect(j.code).toBe(1);
    expect(JSON.parse(j.out)).toMatchObject({ trace: 'unavailable' });
    expect(JSON.parse(j.out).reason).toMatch(/ENOENT/);
    const b = cli(['trace', 'summarize', '--run-id', 'nope', '--brief']);
    expect(b.code).toBe(0);
    expect(JSON.parse(b.out).trace).toBe('unavailable');
    const t = cli(['trace', 'summarize', '--run-id', 'nope']);
    expect(t.code).toBe(1);
    expect(t.err).toMatch(/^trace: unavailable \(cannot read .*ENOENT/);
    expect(t.out).toBe('');
  });

  test('unreadable (a directory in place of the file), empty, and invalid run id are all unavailable', () => {
    const dir = path.join(root, '.ensemble', 'state', 'toolchain');
    fs.mkdirSync(path.join(dir, 'trace-dirrun.jsonl'), { recursive: true });
    expect(JSON.parse(cli(['trace', 'summarize', '--run-id', 'dirrun', '--json']).out).trace).toBe('unavailable');
    fs.writeFileSync(path.join(dir, 'trace-empty.jsonl'), '');
    const e = JSON.parse(cli(['trace', 'summarize', '--run-id', 'empty', '--json']).out);
    expect(e.reason).toMatch(/no spans/);
    const bad = cli(['trace', 'summarize', '--run-id', '../x', '--json']);
    expect(bad.code).toBe(1);
    expect(JSON.parse(bad.out).reason).toMatch(/invalid/);
  });

  const itUnlessRoot = process.getuid && process.getuid() === 0 ? test.skip : test;
  itUnlessRoot('unwritable trace dir: start/end exit 0 and summarize --brief names the unwritable dir as the reason', () => {
    const dir = path.join(root, '.ensemble', 'state', 'toolchain');
    fs.mkdirSync(dir, { recursive: true });
    fs.chmodSync(dir, 0o555);
    const s = cli(['trace', 'start', '--run-id', 'ro', '--name', 'preflight']);
    expect(s.code).toBe(0);
    expect(s.out.trim()).toMatch(ID);
    expect(stderrLines(s)).toHaveLength(1);
    const b = cli(['trace', 'summarize', '--run-id', 'ro', '--brief']);
    expect(b.code).toBe(0);
    const parsed = JSON.parse(b.out);
    expect(parsed.trace).toBe('unavailable');
    expect(parsed.reason).toMatch(/not writable \(EACCES\)/);
  });

  test('a killed run (started, never ended) still summarizes, flagged unfinished', () => {
    cli(['trace', 'start', '--run-id', 'r1', '--name', 'preflight']);
    const r = JSON.parse(cli(['trace', 'summarize', '--run-id', 'r1', '--brief']).out);
    expect(r.unfinished).toBe(1);
  });
});

describe('trace verb errors and unchanged CLI surface', () => {
  test('unknown trace verb exits 2', () => {
    const r = cli(['trace', 'bogus']);
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/Unknown trace verb/);
  });

  test('unknown top-level subcommand usage now names trace', () => {
    const r = cli(['nonsense']);
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/trace/);
  });
});
