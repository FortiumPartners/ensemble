'use strict';

/**
 * Review timing (kata gkt9): stage names, critical path and orchestrator-only time computed from a
 * run trace. The headline scenario replays a RECORDED review (#234, 2026-11-05) converted to a
 * run-trace file (see fixtures/pr-review-timing/README.md) and must reproduce the figures the plan
 * measured by hand: 92 turns, 19.7 min, 70% orchestrator-only.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { createTracer, readTrace, KINDS } = require('../lib/run-trace');
const {
  AGENT_ROLES,
  STAGES,
  STAGE_KINDS,
  intervalOf,
  computeReviewTiming,
  loadReviewTiming,
  formatReviewTiming,
  main,
} = require('../lib/pr-review-timing');

const CLI = path.join(__dirname, '..', 'lib', 'pr-review-cli.js');
const FIXTURE = path.join(__dirname, 'fixtures', 'pr-review-timing', 'trace-review-pr234.jsonl');
const MIN = 60000;

const T0 = Date.parse('2026-11-05T10:00:00.000Z');
const at = (sec) => new Date(T0 + sec * 1000).toISOString();
let seq = 0;

/** A materialized run-trace span, times in seconds from T0. `end: null` is an unfinished span. */
function span(name, start, end, attrs = {}) {
  seq += 1;
  return {
    run_id: 'r',
    span_id: `s${seq}`,
    parent_id: null,
    name,
    kind: STAGE_KINDS[name] || 'phase',
    start_ts: at(start),
    end_ts: end === null ? null : at(end),
    duration_ms: end === null ? null : (end - start) * 1000,
    status: end === null ? 'unfinished' : 'ok',
    attrs,
  };
}

const root = (start, end, attrs = { turns: 10, tool_calls: 12 }) => span(STAGES.root, start, end, attrs);
const agent = (role, start, end, attrs) => span(STAGES[role], start, end, attrs);

const minutes = (ms) => Math.round((ms / MIN) * 10) / 10;

describe('the recorded #234 review (AC1, AC2, AC3)', () => {
  const trace = readTrace(FIXTURE);
  const timing = computeReviewTiming({ spans: trace.spans, warnings: trace.warnings });

  test('the fixture is a well-formed run trace', () => {
    expect(trace.warnings).toEqual([]);
    expect(trace.spans.length).toBeGreaterThan(60);
    expect(timing.ok).toBe(true);
  });

  test('AC1: reproduces the plan figures: 92 turns, 19.7 min wall, 70% orchestrator-only (13.8 min)', () => {
    expect(timing.turns).toEqual({ ms: 92, missing: false });
    expect(timing.toolCalls).toEqual({ ms: 102, missing: false });
    expect(minutes(timing.wall.ms)).toBe(19.7);
    expect(timing.agents.count).toBe(61);
    expect(minutes(timing.activeMs.ms)).toBe(5.9);
    expect(minutes(timing.orchestratorOnly.ms)).toBe(13.8);
    expect(timing.orchestratorOnly.pct).toBe(70);
    expect(timing.orchestratorOnly.bound).toBeUndefined();
    expect(minutes(timing.beforeFirstDispatch.ms)).toBe(3.0);
  });

  test('the slowest reviewer and verifier match the agent figures the plan reports (2.1 min and 79 s)', () => {
    expect(Math.round(timing.agents.byRole.reviewer.slowest.ms / 1000)).toBe(129); // 2 min 9 s: the plan reports the same reviewer as 2.1 min
    expect(Math.round(timing.agents.byRole.verifier.slowest.ms / 1000)).toBe(79);
    expect(timing.agents.byRole.classifier.slowest.ms).toBeLessThan(5000);
  });

  test('the per-stage table reports the slowest span of each stage over all its spans (51 verifiers, 6 reviewers)', () => {
    expect(timing.stages[STAGES.verifier]).toEqual({ count: 51, ms: 79441, missing: false });
    expect(timing.stages[STAGES.reviewer]).toEqual({ count: 6, ms: 128928, missing: false });
  });

  test('AC2: every agent in the fixture was closed at session_exit, 7 minutes after its last message, and is measured to the last message', () => {
    const lingers = trace.spans
      .filter((s) => s.name.startsWith('review.') && s.kind === 'agent')
      .map((s) => Date.parse(s.end_ts) - Date.parse(s.attrs.last_message_ts));
    expect(lingers).toHaveLength(61);
    for (const linger of lingers) expect(Math.abs(linger - 7 * MIN)).toBeLessThan(100);

    // Mutation: measuring to the span end (the session_exit) instead of the last message.
    const lingering = computeReviewTiming(
      trace.spans.map((s) => {
        const attrs = { ...s.attrs };
        if (s.kind === 'agent') delete attrs.last_message_ts;
        return { ...s, attrs };
      })
    );
    expect(minutes(lingering.orchestratorOnly.ms)).toBeLessThan(4);
    expect(minutes(timing.orchestratorOnly.ms)).toBeGreaterThan(13);
  });

  test('AC2: the idle linger that no figure counts is reported (61 agents, 7 minutes each) and is zero when no span was cut short', () => {
    expect(Math.round(timing.agents.lingerMs / MIN)).toBe(427);
    expect(formatReviewTiming(timing)).toContain("idle linger after the agents' last messages, not counted: 427m00s");
    const closedAtLastMessage = computeReviewTiming([root(0, 100), agent('reviewer', 0, 50)]);
    expect(closedAtLastMessage.agents.lingerMs).toBe(0);
    expect(formatReviewTiming(closedAtLastMessage)).not.toContain('idle linger');
  });

  test('AC3: stages the old session never recorded are MISSING, never zero', () => {
    for (const name of [STAGES.headRead, STAGES.gate, STAGES.verdict]) {
      expect(timing.stages[name]).toMatchObject({ count: 0, ms: null, missing: true });
    }
    expect(timing.criticalPath.missing).toBe(true);
    expect(timing.criticalPath.ms).toBeNull();
    // ...while the steps that ARE recorded are still reported.
    const [round] = timing.criticalPath.rounds;
    expect(round.steps.map((s) => [s.stage, s.missing])).toEqual([
      ['reviewer', false],
      ['verifier', false],
      ['verdict', true],
    ]);
    expect(formatReviewTiming(timing)).toContain('MISSING');
  });
});

describe('an agent interval ends at its last message, never at session_exit (AC2)', () => {
  test('last_message_ts replaces the later span end', () => {
    const interval = intervalOf(agent('reviewer', 60, 540, { last_message_ts: at(120) }));
    expect(interval).toEqual({ ok: true, start: T0 + 60000, end: T0 + 120000, lingerMs: 420000 });
  });

  test('without last_message_ts the span end is the end', () => {
    expect(intervalOf(agent('reviewer', 60, 120))).toMatchObject({ ok: true, end: T0 + 120000, lingerMs: 0 });
  });

  test('orchestrator-only time excludes the idle linger', () => {
    const t = computeReviewTiming([root(0, 600), agent('reviewer', 60, 540, { last_message_ts: at(120) })]);
    expect(t.activeMs.ms).toBe(60000);
    expect(t.orchestratorOnly.ms).toBe(540000);
    expect(t.orchestratorOnly.pct).toBe(90);
  });

  test.each([
    ['before the span starts', at(30)],
    ['after the span ends', at(541)],
    ['not a time', 'yesterday'],
  ])('a last_message_ts %s makes the interval UNUSABLE: not trusted, not replaced by the span end', (_, value) => {
    const bad = agent('reviewer', 60, 540, { last_message_ts: value });
    expect(intervalOf(bad)).toMatchObject({ ok: false });
    const t = computeReviewTiming([root(0, 600), bad]);
    expect(t.agents.unusable).toHaveLength(1);
    expect(t.activeMs).toMatchObject({ ms: 0, bound: 'lower', unusableAgents: 1 });
    expect(t.orchestratorOnly).toMatchObject({ ms: 600000, bound: 'upper' });
  });

  test('the orchestrator window itself ends at its last message', () => {
    const t = computeReviewTiming([root(0, 1000, { last_message_ts: at(600), turns: 1, tool_calls: 1 })]);
    expect(t.wall.ms).toBe(600000);
  });
});

describe('span lengths come from the recorder, never from a stepped wall clock (review round 1)', () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-review-timing-clock-'));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  /** A real tracer whose wall clock and monotonic clock are moved independently, and a reader of what it wrote. */
  function recorder(runId) {
    let wall = T0;
    let mono = 5000000;
    const tracer = createTracer({ runId, projectRoot: dir, clock: { now: () => wall, mono: () => mono } });
    return {
      tracer,
      advance: (wallSec, monoSec = wallSec) => {
        wall += wallSec * 1000;
        mono += monoSec * 1000;
      },
      read: () => readTrace(path.join(dir, '.ensemble', 'state', 'toolchain', `trace-${runId}.jsonl`)),
    };
  }

  /** One review of one reviewer; the clocks move `wallSec` and `monoSec` while the reviewer runs. */
  function reviewerSpanningAStep(runId, wallSec, monoSec) {
    const { tracer, advance, read } = recorder(runId);
    const rootId = tracer.startSpan(STAGES.root);
    advance(1);
    const reviewer = tracer.startSpan(STAGES.reviewer, { kind: 'agent', parentId: rootId, attrs: { agent: 'RevA' } });
    advance(wallSec, monoSec);
    tracer.endSpan(reviewer);
    advance(1);
    tracer.endSpan(rootId);
    return read();
  }

  test('a forward wall-clock step (a system sleep) is not counted: the recorder says 60 s, so the reviewer took 60 s', () => {
    const trace = reviewerSpanningAStep('sleep', 540, 60);
    // What the recorder itself reports: monotonic-first durations and no anomaly. This is what must be honoured.
    expect(trace.spans.map((s) => [s.name, s.duration_ms, s.attrs.clock_anomaly])).toEqual([
      [STAGES.root, 62000, undefined],
      [STAGES.reviewer, 60000, undefined],
    ]);
    const t = computeReviewTiming(trace);
    expect(t.wall.ms).toBe(62000);
    expect(t.agents.byRole.reviewer.slowest.ms).toBe(60000);
    expect(t.stages[STAGES.reviewer]).toMatchObject({ ms: 60000, missing: false });
  });

  test('...and every figure that needs positions is MISSING and says the wall clock stepped, not a number built on it', () => {
    const t = computeReviewTiming(reviewerSpanningAStep('sleep', 540, 60));
    for (const figure of [t.activeMs, t.orchestratorOnly, t.beforeFirstDispatch]) {
      expect(figure).toMatchObject({ ms: null, missing: true });
      expect(figure.reason).toContain('wall clock stepped');
      expect(figure.reason).toContain('review lasted 9m02s on the wall clock but 1m02s by the recorder');
    }
  });

  test.each([
    ['a wall clock 5 s ahead of the recorder', 95000, 'computed'],
    ['a wall clock 5.001 s ahead of the recorder', 94999, 'MISSING'],
    ['a wall clock 5 s behind the recorder', 105000, 'computed'],
    ['a wall clock 5.001 s behind the recorder', 105001, 'MISSING'],
  ])('%s: orchestrator-only time is %s', (_, durationMs, outcome) => {
    // The review's wall-clock window is 100 s; the recorder says `durationMs`.
    const t = computeReviewTiming([{ ...root(0, 100), duration_ms: durationMs }, agent('reviewer', 10, 60)]);
    expect(t.orchestratorOnly.missing).toBe(outcome === 'MISSING');
    expect(t.wall.ms).toBe(durationMs); // the length is the recorder's either way
  });

  test('a verdict the recorded stamps place a millisecond past the end of the root is rounding, not a cut (the numbers of a real run)', () => {
    // The root's whole-millisecond stamp is truncated late in its millisecond and the verdict's early in its own, and each duration is rounded:
    // the verdict really ended 0.14 ms before the root, and the stamps put its end 1 ms after the root's (a real review-run printed
    // 'verdict 12ms [lower bound] [cut to the window by 1ms]' for it and made the whole critical path a lower bound).
    let wall = T0;
    let mono = 5000000;
    const tracer = createTracer({ runId: 'rounding', projectRoot: dir, clock: { now: () => wall, mono: () => mono } });
    const moveTo = (wallMs, monoMs) => {
      wall = T0 + wallMs;
      mono = 5000000 + monoMs;
    };
    const rootId = tracer.startSpan(STAGES.root);
    moveTo(100, 100);
    const reviewer = tracer.startSpan(STAGES.reviewer, { kind: 'agent', parentId: rootId, attrs: { agent: 'RevA' } });
    moveTo(5100, 5100);
    tracer.endSpan(reviewer);
    const verifier = tracer.startSpan(STAGES.verifier, { kind: 'agent', parentId: rootId, attrs: { agent: 'Ver1' } });
    moveTo(8100, 8100);
    tracer.endSpan(verifier);
    moveTo(10706, 10705.027);
    const verdictSpan = tracer.startSpan(STAGES.verdict, { parentId: rootId });
    moveTo(10718, 10717.959);
    tracer.endSpan(verdictSpan);
    moveTo(10718, 10718.099);
    tracer.endSpan(rootId);
    const trace = readTrace(path.join(dir, '.ensemble', 'state', 'toolchain', 'trace-rounding.jsonl'));
    expect(trace.spans.map((s) => [s.name, s.duration_ms])).toEqual([
      [STAGES.root, 10718],
      [STAGES.reviewer, 5000],
      [STAGES.verifier, 3000],
      [STAGES.verdict, 13], // 12.932 rounded: placed from its start it ends at 10719, the root at 10718
    ]);
    const t = computeReviewTiming(trace);
    expect(t.criticalPath.rounds[0].steps[2]).toEqual({ stage: 'verdict', ms: 12, missing: false });
    expect(t.criticalPath).toMatchObject({ ms: 8012, missing: false });
    expect(t.criticalPath.lowerBound).toBeUndefined();
  });

  test('a backward wall-clock step is a clock anomaly the recorder flags: the spans are UNUSABLE and the reason names it', () => {
    const trace = reviewerSpanningAStep('anomaly', -540, 60);
    expect(trace.spans.map((s) => s.attrs.clock_anomaly)).toEqual([true, true]); // the recorder's own flag
    const t = computeReviewTiming(trace);
    expect(t.wall).toMatchObject({ ms: null, missing: true });
    expect(t.wall.reason).toContain('clock anomaly');
    expect(t.agents.unusable).toEqual([
      { stage: STAGES.reviewer, name: expect.any(String), reason: expect.stringContaining('clock anomaly') },
    ]);
  });

  test('a span the recorder flagged clock_anomaly is not measured even when its timestamps look fine', () => {
    const flagged = { ...agent('reviewer', 10, 40), attrs: { clock_anomaly: true } };
    expect(intervalOf(flagged)).toEqual({ ok: false, reason: expect.stringContaining('clock anomaly') });
    const t = computeReviewTiming([root(0, 100), flagged]);
    expect(t.agents.unusable).toHaveLength(1);
    expect(t.agents.byRole.reviewer.slowest).toMatchObject({ ms: null, missing: true });
    expect(t.orchestratorOnly).toMatchObject({ ms: 100000, bound: 'upper', unusableAgents: 1 });
  });

  test('the length is the recorded duration_ms, which wins over the timestamps within the tolerance', () => {
    expect(intervalOf({ ...agent('reviewer', 0, 100), duration_ms: 98000 })).toEqual({
      ok: true,
      start: T0,
      end: T0 + 98000,
      lingerMs: 0,
    });
  });

  test.each([['undefined', undefined], ['null', null]])('a span whose duration_ms is %s (not produced by readTrace) is measured by its timestamps', (_, value) => {
    expect(intervalOf({ ...agent('reviewer', 0, 100), duration_ms: value })).toMatchObject({ ok: true, start: T0, end: T0 + 100000 });
  });

  test.each([['negative', -1], ['NaN', NaN], ['infinite', Infinity], ['a string', '60000']])('a duration_ms that is %s is not a duration: the span is UNUSABLE', (_, value) => {
    expect(intervalOf({ ...agent('reviewer', 0, 100), duration_ms: value })).toEqual({
      ok: false,
      reason: 'duration_ms is not a non-negative number',
    });
  });

  test('last_message_ts cannot be placed on a span whose clocks disagree: UNUSABLE, not trusted', () => {
    // 500 s on the wall clock, 60 s by the recorder, the last message somewhere inside the span.
    const stepped = { ...agent('reviewer', 0, 500, { last_message_ts: at(100) }), duration_ms: 60000 };
    expect(intervalOf(stepped)).toEqual({ ok: false, reason: expect.stringContaining('cannot be placed') });
  });

  test.each([
    ['a space instead of T', '2026-11-05 10:00:00'],
    ['no zone (it would read as local time)', '2026-11-05T10:00:00'],
    ['prose', 'Nov 5 2026 10:00'],
  ])('a start_ts with %s is unparseable, not read leniently', (_, ts) => {
    expect(intervalOf({ ...agent('reviewer', 0, 10), start_ts: ts })).toEqual({ ok: false, reason: 'unparseable start_ts' });
  });

  test('an ISO-8601 offset is the same instant as its Z form', () => {
    expect(intervalOf({ ...agent('reviewer', 0, 10), start_ts: '2026-11-05T11:00:00.000+01:00' })).toMatchObject({ ok: true, start: T0 });
  });

  test('the critical path of a review the wall clock stepped through is MISSING, its steps still measured', () => {
    const { tracer, advance, read } = recorder('sleep-chain');
    const rootId = tracer.startSpan(STAGES.root);
    advance(1);
    const reviewer = tracer.startSpan(STAGES.reviewer, { kind: 'agent', parentId: rootId });
    advance(540, 60); // a system sleep inside the reviewer
    tracer.endSpan(reviewer);
    const verifier = tracer.startSpan(STAGES.verifier, { kind: 'agent', parentId: rootId });
    advance(20);
    tracer.endSpan(verifier);
    const verdict = tracer.startSpan(STAGES.verdict, { parentId: rootId });
    advance(1);
    tracer.endSpan(verdict);
    tracer.endSpan(rootId);
    const { criticalPath } = computeReviewTiming(read());
    expect(criticalPath).toMatchObject({ ms: null, missing: true });
    expect(criticalPath.reason).toContain('wall clock stepped');
    expect(criticalPath.rounds[0].steps.map((s) => s.ms)).toEqual([60000, 20000, 1000]);
  });

  test('a step undone before the window ends is still seen through the span it crossed (the window alone shows nothing)', () => {
    const { tracer, advance, read } = recorder('compensated');
    const rootId = tracer.startSpan(STAGES.root);
    advance(5);
    const reviewer = tracer.startSpan(STAGES.reviewer, { kind: 'agent', parentId: rootId, attrs: { agent: 'RevA' } });
    advance(90, 30); // +60 s on the wall clock only, inside the reviewer
    tracer.endSpan(reviewer);
    advance(-60, 0); // ...undone in a gap, so the window's own two lengths agree again
    advance(5);
    const verifier = tracer.startSpan(STAGES.verifier, { kind: 'agent', parentId: rootId, attrs: { agent: 'VerA' } });
    advance(20);
    tracer.endSpan(verifier);
    const verdict = tracer.startSpan(STAGES.verdict, { parentId: rootId });
    advance(1);
    tracer.endSpan(verdict);
    tracer.endSpan(rootId);
    const trace = read();
    const [window] = trace.spans;
    expect(window.duration_ms).toBe(61000);
    expect(Date.parse(window.end_ts) - Date.parse(window.start_ts)).toBe(61000); // the root alone shows no step
    const t = computeReviewTiming(trace);
    expect(t.wall.ms).toBe(61000);
    for (const figure of [t.activeMs, t.orchestratorOnly, t.beforeFirstDispatch, t.criticalPath]) {
      expect(figure).toMatchObject({ ms: null, missing: true });
      expect(figure.reason).toContain('review.reviewer RevA lasted 1m30s on the wall clock but 30.0s by the recorder');
    }
  });

  test('a window that ends at last_message_ts on a stepped clock has no length: wall is MISSING, the one exception to lengths still being reported', () => {
    const stepped = { ...root(0, 700, { last_message_ts: at(650) }), duration_ms: 100000 };
    const t = computeReviewTiming([stepped, agent('reviewer', 10, 40)]);
    expect(t.wall).toMatchObject({ ms: null, missing: true });
    expect(t.wall.reason).toContain('cannot be placed');
    // The same root without last_message_ts keeps the recorder's length.
    const plain = computeReviewTiming([{ ...root(0, 700), duration_ms: 100000 }, agent('reviewer', 10, 40)]);
    expect(plain.wall.ms).toBe(100000);
  });
});

describe('a span that ends before it starts is unusable, never a negative length (review round 1)', () => {
  const verdict = (start, end) => span(STAGES.verdict, start, end);

  test.each([
    ['a duration_ms the helper computes from the timestamps (negative)', {}],
    ['no recorded duration (a hand-written span list)', { duration_ms: undefined }],
    ['a recorded duration that looks fine', { duration_ms: 30000 }],
  ])('intervalOf refuses a span with %s, naming the reason', (_, patch) => {
    expect(intervalOf({ ...agent('reviewer', 50, 20), ...patch })).toEqual({ ok: false, reason: 'ends before it starts' });
  });

  test.each([
    ['a missing end_ts on a span whose status is ok', { end_ts: null, status: 'ok' }],
    ['an end_ts that is not a time', { end_ts: 'later', status: 'ok' }],
  ])('%s is an unparseable end_ts, not an unfinished span', (_, patch) => {
    expect(intervalOf({ ...agent('reviewer', 0, 10), ...patch })).toEqual({ ok: false, reason: 'unparseable end_ts' });
    expect(intervalOf({ ...agent('reviewer', 0, null) })).toEqual({ ok: false, reason: 'unfinished' });
  });

  test('an agent that ends before it starts is reported unusable: no negative step, an upper bound for orchestrator-only time', () => {
    const t = computeReviewTiming([root(0, 200), agent('reviewer', 50, 20), agent('verifier', 100, 130), verdict(130, 131)]);
    expect(t.agents.unusable).toEqual([{ stage: STAGES.reviewer, name: expect.any(String), reason: 'ends before it starts' }]);
    expect(t.agents.byRole.reviewer.slowest).toMatchObject({ ms: null, missing: true });
    expect(t.stages[STAGES.reviewer]).toMatchObject({ count: 1, ms: null, missing: true });
    expect(t.orchestratorOnly).toMatchObject({ bound: 'upper', unusableAgents: 1 });
    expect(t.orchestratorOnly.ms).toBe(200000 - 31000); // the verifier and the verdict only
    expect(t.criticalPath).toMatchObject({ ms: null, missing: true });
    expect(t.criticalPath.reason).toContain('reviewer');
  });

  test('a review window that ends before it starts is MISSING with that reason, and so is everything measured against it', () => {
    const t = computeReviewTiming([root(50, 20), agent('reviewer', 0, 10)]);
    expect(t.wall).toEqual({ ms: null, missing: true, reason: "the 'review' span is unusable: ends before it starts" });
    expect(t.orchestratorOnly).toMatchObject({ ms: null, missing: true });
    expect(t.activeMs).toMatchObject({ ms: null, missing: true });
  });

  test.each([
    ['reviewer', [root(0, 200), agent('reviewer', 50, 20), agent('verifier', 100, 130), verdict(130, 131)]],
    ['verifier', [root(0, 200), agent('reviewer', 0, 40), agent('verifier', 130, 100), verdict(130, 131)]],
    ['verdict', [root(0, 200), agent('reviewer', 0, 40), agent('verifier', 50, 90), verdict(131, 130)]],
  ])('a %s that ends before it starts: the critical path is MISSING and no figure is negative', (stage, spans) => {
    const t = computeReviewTiming(spans);
    expect(t.criticalPath).toMatchObject({ ms: null, missing: true });
    expect(t.criticalPath.reason).toContain(stage);
    for (const step of t.criticalPath.rounds[0].steps) expect(step.ms === null || step.ms >= 0).toBe(true);
    expect(t.orchestratorOnly.ms).toBeGreaterThanOrEqual(0);
  });
});

describe('orchestrator-only time', () => {
  test('overlapping agents are one interval, and an agent outside the window is clipped to it', () => {
    const t = computeReviewTiming([
      root(100, 400),
      agent('reviewer', 50, 200), // clipped to 100..200
      agent('reviewer', 150, 250), // overlaps the first: union 100..250
      agent('verifier', 300, 900), // clipped to 300..400
    ]);
    expect(t.wall.ms).toBe(300000);
    expect(t.activeMs.ms).toBe(250000);
    expect(t.orchestratorOnly.ms).toBe(50000);
    expect(t.orchestratorOnly.pct).toBe(17);
    expect(t.beforeFirstDispatch.ms).toBe(0); // the first agent started before the window
  });

  test('every agent role counts as a dispatched agent', () => {
    const t = computeReviewTiming([root(0, 500), ...AGENT_ROLES.map((role, i) => agent(role, i * 100, i * 100 + 50))]);
    expect(t.agents.count).toBe(AGENT_ROLES.length);
    expect(t.activeMs.ms).toBe(250000);
  });

  test('an unfinished agent makes the figure an upper bound, not an exact one', () => {
    const t = computeReviewTiming([root(0, 600), agent('reviewer', 10, 110), agent('verifier', 200, null)]);
    expect(t.agents.unusable).toEqual([{ stage: STAGES.verifier, name: expect.any(String), reason: 'unfinished' }]);
    expect(t.orchestratorOnly).toMatchObject({ ms: 500000, bound: 'upper', unusableAgents: 1 });
    expect(formatReviewTiming(t)).toContain('upper bound');
  });

  test('no dispatched-agent span: orchestrator-only is MISSING, not 100% and not 0', () => {
    const t = computeReviewTiming([root(0, 600)]);
    expect(t.orchestratorOnly).toMatchObject({ ms: null, missing: true });
    expect(t.activeMs).toMatchObject({ ms: null, missing: true });
    expect(t.beforeFirstDispatch).toMatchObject({ ms: null, missing: true });
    expect(t.wall.ms).toBe(600000);
  });

  test('before first dispatch: an unfinished agent that was dispatched first still counts as the first dispatch', () => {
    const t = computeReviewTiming([root(0, 100), agent('verifier', 10, null), agent('reviewer', 40, 60)]);
    expect(t.beforeFirstDispatch).toEqual({ ms: 10000, missing: false });
  });

  test('before first dispatch: a dispatch after the end of the window is MISSING, not a figure larger than the window', () => {
    const t = computeReviewTiming([root(0, 100), agent('reviewer', 150, 160)]);
    expect(t.beforeFirstDispatch).toMatchObject({ ms: null, missing: true });
    expect(t.beforeFirstDispatch.reason).toContain('after the end of the orchestrator window');
    // A dispatch exactly at the end of the window is still inside it.
    expect(computeReviewTiming([root(0, 100), agent('reviewer', 100, 110)]).beforeFirstDispatch).toEqual({ ms: 100000, missing: false });
  });

  test.each([
    ['negative', -1],
    ['beyond the latest Date', 1e16],
  ])('a reviewer whose duration_ms is %s is unusable for that reason, not blamed on the wall clock', (_, value) => {
    const t = computeReviewTiming([root(0, 100), { ...agent('reviewer', 10, 40), duration_ms: value }]);
    expect(t.agents.unusable).toEqual([{ stage: STAGES.reviewer, name: expect.any(String), reason: expect.stringContaining('duration_ms') }]);
    expect(t.orchestratorOnly).toMatchObject({ missing: false, bound: 'upper', unusableAgents: 1 });
  });

  test('a window whose duration_ms would end it after the latest Date is MISSING and nothing throws', () => {
    const spans = [{ ...root(0, 1), duration_ms: 1e16 }, agent('reviewer', 0, 0.5)];
    const t = computeReviewTiming(spans);
    expect(t.wall).toEqual({ ms: null, missing: true, reason: "the 'review' span is unusable: duration_ms puts the end of the span out of range" });
    expect(t.orchestratorOnly).toMatchObject({ ms: null, missing: true });
    expect(() => formatReviewTiming(t)).not.toThrow();
  });

  test('the per-stage table reports the slowest span of a stage, with its count and any unusable span as a bound', () => {
    const t = computeReviewTiming([root(0, 500), agent('reviewer', 0, 100), agent('reviewer', 0, 130), agent('reviewer', 10, null)]);
    expect(t.stages[STAGES.reviewer]).toEqual({ count: 3, ms: 130000, missing: false, lowerBound: true, unusable: 1 });
    const two = computeReviewTiming([root(0, 500), agent('verifier', 0, 20), agent('verifier', 0, 60)]);
    expect(two.stages[STAGES.verifier]).toEqual({ count: 2, ms: 60000, missing: false });
  });
});

describe('the orchestrator window and its counts', () => {
  test.each([
    ['none', [agent('reviewer', 0, 10)]],
    ['two', [root(0, 100), root(0, 200), agent('reviewer', 0, 10)]],
    ['an unfinished one', [root(0, null), agent('reviewer', 0, 10)]],
  ])('%s review span: wall and orchestrator-only are MISSING, and the agents are still reported', (_, spans) => {
    const t = computeReviewTiming(spans);
    expect(t.wall).toMatchObject({ ms: null, missing: true });
    expect(t.orchestratorOnly).toMatchObject({ ms: null, missing: true });
    expect(t.agents.count).toBe(1);
    expect(t.agents.byRole.reviewer.slowest.ms).toBe(10000);
  });

  test('turns and tool calls absent are MISSING, never 0; digit strings (what `trace --attr` records) count', () => {
    expect(computeReviewTiming([root(0, 10, {})]).turns).toMatchObject({ ms: null, missing: true });
    expect(computeReviewTiming([root(0, 10, { turns: '92', tool_calls: '102' })])).toMatchObject({
      turns: { ms: 92, missing: false },
      toolCalls: { ms: 102, missing: false },
    });
    for (const bad of ['9.5', '-1', 'many', 1.5, -1, null]) {
      expect(computeReviewTiming([root(0, 10, { turns: bad })]).turns.missing).toBe(true);
    }
  });
});

describe('critical path: slowest reviewer -> slowest verifier -> verdict', () => {
  const full = [
    root(0, 1000),
    agent('reviewer', 0, 100, { agent: 'RevA' }),
    agent('reviewer', 0, 130, { agent: 'RevB' }),
    agent('verifier', 140, 160, { agent: 'VerA' }),
    agent('verifier', 140, 200, { agent: 'VerB' }),
    span(STAGES.verdict, 210, 215),
  ];

  test('takes the slowest of each stage, not the sum, and sums the steps', () => {
    const { criticalPath } = computeReviewTiming(full);
    expect(criticalPath.rounds).toHaveLength(1);
    expect(criticalPath.rounds[0].steps).toEqual([
      { stage: 'reviewer', ms: 130000, missing: false, name: 'RevB' },
      { stage: 'verifier', ms: 60000, missing: false, name: 'VerB' },
      { stage: 'verdict', ms: 5000, missing: false },
    ]);
    expect(criticalPath).toMatchObject({ ms: 195000, missing: false });
  });

  test('rounds (attr round, also as the string `trace --attr` records) are computed separately and summed', () => {
    const { criticalPath } = computeReviewTiming([
      root(0, 1000),
      agent('reviewer', 0, 100, { round: 1 }),
      agent('verifier', 100, 150, { round: '1' }),
      span(STAGES.verdict, 150, 160, { round: 1 }),
      agent('reviewer', 300, 330, { round: 2 }),
      agent('verifier', 330, 400, { round: 2 }),
      span(STAGES.verdict, 400, 410, { round: 2 }),
    ]);
    expect(criticalPath.rounds.map((r) => [r.round, r.ms])).toEqual([
      [1, 160000],
      [2, 110000],
    ]);
    expect(criticalPath.ms).toBe(270000);
  });

  test.each([
    ['verdict', full.filter((s) => s.name !== STAGES.verdict)],
    ['verifier', full.filter((s) => s.name !== STAGES.verifier)],
    ['reviewer', full.filter((s) => s.name !== STAGES.reviewer)],
  ])('no %s span: the total is MISSING and names the gap, never a shorter number', (stage, spans) => {
    const { criticalPath } = computeReviewTiming(spans);
    expect(criticalPath).toMatchObject({ ms: null, missing: true });
    expect(criticalPath.reason).toContain(stage);
  });

  test('one round complete and another without a verdict: the total is MISSING', () => {
    const { criticalPath } = computeReviewTiming([
      ...full.map((s) => ({ ...s, attrs: { ...s.attrs, round: 1 } })),
      agent('reviewer', 300, 330, { round: 2 }),
      agent('verifier', 330, 400, { round: 2 }),
    ]);
    expect(criticalPath.rounds[0].missing).toBe(false);
    expect(criticalPath.rounds[1].missing).toBe(true);
    expect(criticalPath).toMatchObject({ ms: null, missing: true });
  });

  test('an unfinished slowest verifier makes the step a lower bound from the finished ones', () => {
    const { criticalPath } = computeReviewTiming([...full, agent('verifier', 140, null, { agent: 'VerC' })]);
    const verifier = criticalPath.rounds[0].steps[1];
    expect(verifier).toMatchObject({ ms: 60000, lowerBound: true, unusable: 1 });
    expect(criticalPath.lowerBound).toBe(true);
  });

  test('nothing recorded for any critical-path stage: MISSING', () => {
    expect(computeReviewTiming([root(0, 10)]).criticalPath).toMatchObject({ ms: null, missing: true, rounds: [] });
  });
});

describe('the critical path never exceeds the window and counts the verdict once (review round 1)', () => {
  const verdict = (start, end, attrs) => span(STAGES.verdict, start, end, attrs);

  // Traces in which the steps follow one another inside the window.
  const sequential = [
    ['one round with a gap between the steps', [root(0, 160), agent('reviewer', 0, 100), agent('verifier', 110, 150), verdict(150, 160)]],
    [
      'the slowest of several agents per stage',
      [root(0, 1000), agent('reviewer', 0, 100), agent('reviewer', 0, 130), agent('verifier', 140, 160), agent('verifier', 140, 200), verdict(210, 215)],
    ],
    [
      'two rounds back to back',
      [
        root(0, 1000),
        agent('reviewer', 0, 100, { round: 1 }),
        agent('verifier', 100, 150, { round: 1 }),
        verdict(150, 160, { round: 1 }),
        agent('reviewer', 300, 330, { round: 2 }),
        agent('verifier', 330, 400, { round: 2 }),
        verdict(400, 410, { round: 2 }),
      ],
    ],
    ['a first step that begins before the window', [root(100, 400), agent('reviewer', 50, 200), agent('verifier', 200, 300), verdict(300, 310)]],
    ['a verdict that takes no time', [root(0, 100), agent('reviewer', 0, 40), agent('verifier', 40, 90), verdict(90, 90)]],
    ['a verdict that ends the window', [root(0, 100), agent('reviewer', 0, 40), agent('verifier', 40, 90), verdict(90, 100)]],
  ];

  test.each(sequential)('%s: critical path plus orchestrator-only time is at most the window', (_, spans) => {
    const t = computeReviewTiming(spans);
    expect(t.criticalPath.missing).toBe(false);
    expect(t.orchestratorOnly.missing).toBe(false);
    expect(t.criticalPath.ms).toBeLessThanOrEqual(t.wall.ms);
    expect(t.criticalPath.ms + t.orchestratorOnly.ms).toBeLessThanOrEqual(t.wall.ms);
  });

  test('the verdict is in the chain, not in orchestrator time (160 s window: 100 + 40 + 10 s of chain, 10 s of gap)', () => {
    const t = computeReviewTiming(sequential[0][1]);
    expect(t.wall.ms).toBe(160000);
    expect(t.criticalPath.ms).toBe(150000);
    expect(t.orchestratorOnly.ms).toBe(10000);
    expect(t.activeMs.ms).toBe(140000); // agents only: the verdict is not an agent
  });

  test('orchestrator-only time leaves out a usable verdict; an unfinished one makes it an upper bound, as an unfinished agent does', () => {
    const done = computeReviewTiming([root(0, 100), agent('reviewer', 0, 50), verdict(50, 60)]);
    expect(done.activeMs.ms).toBe(50000);
    expect(done.orchestratorOnly.ms).toBe(40000);
    const open = computeReviewTiming([root(0, 100), agent('reviewer', 0, 50), verdict(60, null)]);
    expect(open.orchestratorOnly).toMatchObject({ ms: 50000, bound: 'upper', unusableVerdicts: 1 });
    expect(open.orchestratorOnly.unusableAgents).toBeUndefined();
    expect(open.activeMs.bound).toBeUndefined();
  });

  test.each([
    [
      'the verifier starts before the reviewer ends',
      [root(0, 160), agent('reviewer', 0, 100), agent('verifier', 50, 150), verdict(150, 160)],
      'verifier starts 50.0s before reviewer ends',
    ],
    [
      'the verdict starts before the verifier ends',
      [root(0, 160), agent('reviewer', 0, 100), agent('verifier', 100, 150), verdict(140, 160)],
      'verdict starts 10.0s before verifier ends',
    ],
    [
      'the verifier ran entirely before the reviewer',
      [root(0, 160), agent('reviewer', 100, 130), agent('verifier', 0, 50), verdict(140, 150)],
      'verifier starts 2m10s before reviewer ends',
    ],
  ])('%s: the critical path is MISSING with that reason, never a sum of overlapping steps', (_, spans, reason) => {
    const { criticalPath } = computeReviewTiming(spans);
    expect(criticalPath).toMatchObject({ ms: null, missing: true });
    expect(criticalPath.reason).toContain(reason);
    expect(criticalPath.rounds[0]).toMatchObject({ ms: null, missing: true });
    expect(criticalPath.rounds[0].steps.every((s) => !s.missing)).toBe(true); // each step is still reported
  });

  test('steps that touch (one ends exactly when the next starts) are a chain, not an overlap', () => {
    const { criticalPath } = computeReviewTiming([root(0, 160), agent('reviewer', 0, 100), agent('verifier', 100, 150), verdict(150, 160)]);
    expect(criticalPath).toMatchObject({ ms: 160000, missing: false });
  });

  test('rounds follow one another: an overlapping round leaves the total MISSING, each round keeps its own figure', () => {
    const { criticalPath } = computeReviewTiming([
      root(0, 400),
      agent('reviewer', 0, 100, { round: 1 }),
      agent('verifier', 100, 150, { round: 1 }),
      verdict(150, 160, { round: 1 }),
      agent('reviewer', 155, 200, { round: 2 }),
      agent('verifier', 200, 250, { round: 2 }),
      verdict(250, 260, { round: 2 }),
    ]);
    expect(criticalPath).toMatchObject({ ms: null, missing: true });
    expect(criticalPath.reason).toContain('round 2 reviewer starts 5.0s before round 1 verdict ends');
    expect(criticalPath.rounds.map((r) => [r.round, r.ms])).toEqual([
      [1, 160000],
      [2, 105000],
    ]);
  });

  test('an untagged first review followed by tagged rounds is still a chain: rounds are taken in time order', () => {
    const t = computeReviewTiming([
      root(0, 1000),
      agent('reviewer', 0, 100), // no round attr: the extra group, here the first review
      agent('verifier', 100, 150),
      verdict(150, 160),
      agent('reviewer', 300, 330, { round: 2 }),
      agent('verifier', 330, 400, { round: 2 }),
      verdict(400, 410, { round: 2 }),
    ]);
    expect(t.warnings.join(' ')).toContain('carry a round and some do not');
    expect(t.criticalPath).toMatchObject({ ms: 270000, missing: false });
  });

  test('a step that overruns the window is cut to it and says so: the critical path cannot exceed the window', () => {
    const t = computeReviewTiming([root(0, 400), agent('reviewer', 0, 300), agent('verifier', 300, 390), verdict(390, 500)]);
    expect(t.criticalPath.rounds[0].steps[2]).toEqual({ stage: 'verdict', ms: 10000, missing: false, lowerBound: true, clippedMs: 100000 });
    expect(t.criticalPath).toMatchObject({ ms: 400000, lowerBound: true });
    expect(t.criticalPath.ms).toBeLessThanOrEqual(t.wall.ms);
    expect(formatReviewTiming(t)).toContain('verdict 10.0s [lower bound] [cut to the window by 1m40s]');
  });

  test('a step that begins before the window is cut to it and says so', () => {
    const { criticalPath } = computeReviewTiming([root(100, 400), agent('reviewer', 50, 200), agent('verifier', 200, 300), verdict(300, 310)]);
    expect(criticalPath.rounds[0].steps[0]).toMatchObject({ stage: 'reviewer', ms: 100000, clippedMs: 50000, lowerBound: true }); // 100..200, not 50..200
    expect(criticalPath).toMatchObject({ ms: 210000, lowerBound: true });
  });

  // What the recorder writes: `start_ts` in whole milliseconds, and `readTrace` rounds each `duration_ms` to a millisecond. The runner closes
  // the root an instant after the verdict, so the verdict ends within a fraction of a millisecond of the window's end, and placed from the
  // rounded numbers it can seem to end after it (see the real-recorder case in the clock tests above).
  const placed = (name, startMs, durationMs, attrs = {}) => ({
    ...span(name, 0, 1, attrs),
    start_ts: new Date(T0 + startMs).toISOString(),
    end_ts: new Date(T0 + Math.floor(startMs + durationMs)).toISOString(),
    duration_ms: durationMs,
  });
  const verdictOvershooting = (overshootMs) =>
    computeReviewTiming([
      placed(STAGES.root, 0, 400000, { turns: 10, tool_calls: 12 }), // the window ends at 400000 ms
      agent('reviewer', 0, 300),
      agent('verifier', 300, 390),
      placed(STAGES.verdict, 399990, 10 + overshootMs), // starts 10 ms before the window ends
    ]);

  test.each([[0.5], [1]])('a verdict that overshoots the window by %p ms, no more than the stamps resolve, is rounding and not a cut', (over) => {
    const t = verdictOvershooting(over);
    expect(t.criticalPath.rounds[0].steps[2]).toEqual({ stage: 'verdict', ms: 10, missing: false });
    expect(t.criticalPath).toMatchObject({ ms: 390010, missing: false }); // 300 s + 90 s + 10 ms
    expect(t.criticalPath.lowerBound).toBeUndefined();
    expect(formatReviewTiming(t)).not.toContain('cut to the window');
  });

  test.each([[1.5], [2]])('an overshoot of %p ms, more than the stamps resolve, is still a cut and says so', (over) => {
    const t = verdictOvershooting(over);
    expect(t.criticalPath.rounds[0].steps[2]).toEqual({ stage: 'verdict', ms: 10, missing: false, lowerBound: true, clippedMs: over });
    expect(t.criticalPath).toMatchObject({ ms: 390010, lowerBound: true });
    expect(formatReviewTiming(t)).toContain('[cut to the window by');
  });

  test('a span wholly outside the window changes nothing: an exact step stays exact', () => {
    const { criticalPath } = computeReviewTiming([...sequential[0][1], agent('reviewer', 300, 400)]);
    expect(criticalPath).toMatchObject({ ms: 150000, missing: false });
    expect(criticalPath.lowerBound).toBeUndefined();
    expect(criticalPath.rounds[0].steps[0].lowerBound).toBeUndefined();
    expect(criticalPath.rounds[0].steps[0].unusable).toBeUndefined();
  });

  test('an unfinished span still makes the step a lower bound, even though a span outside the window does not', () => {
    const { criticalPath } = computeReviewTiming([...sequential[0][1], agent('reviewer', 20, null)]);
    expect(criticalPath.rounds[0].steps[0]).toMatchObject({ ms: 100000, lowerBound: true, unusable: 1 });
  });

  test('a step wholly outside the window is unusable: the step and the total are MISSING', () => {
    const { criticalPath } = computeReviewTiming([root(0, 400), agent('reviewer', 0, 100), agent('verifier', 100, 150), verdict(450, 460)]);
    expect(criticalPath).toMatchObject({ ms: null, missing: true });
    expect(criticalPath.rounds[0].steps[2]).toMatchObject({ stage: 'verdict', missing: true });
    expect(criticalPath.reason).toContain('outside the window');
  });

  test('a verdict that takes no time is a 0 ms step inside the window and unusable outside it', () => {
    const inside = computeReviewTiming([root(0, 100), agent('reviewer', 0, 40), agent('verifier', 40, 90), verdict(90, 90)]);
    expect(inside.criticalPath.rounds[0].steps[2]).toEqual({ stage: 'verdict', ms: 0, missing: false });
    const outside = computeReviewTiming([root(0, 100), agent('reviewer', 0, 40), agent('verifier', 40, 90), verdict(150, 150)]);
    expect(outside.criticalPath.rounds[0].steps[2]).toMatchObject({ stage: 'verdict', missing: true });
  });

  test.each([
    ['no review span', [agent('reviewer', 0, 100), agent('verifier', 100, 150), verdict(150, 160)], "no 'review' span recorded"],
    ['an unfinished review span', [root(0, null), agent('reviewer', 0, 100), agent('verifier', 100, 150), verdict(150, 160)], "the 'review' span is unusable: unfinished"],
    ['two review spans', [root(0, 200), root(0, 300), agent('reviewer', 0, 100), agent('verifier', 100, 150), verdict(150, 160)], "2 'review' spans recorded"],
  ])('%s: the critical path is MISSING with the window\'s reason, its steps still measured', (_, spans, reason) => {
    const t = computeReviewTiming(spans);
    expect(t.wall.missing).toBe(true);
    expect(t.criticalPath).toMatchObject({ ms: null, missing: true });
    expect(t.criticalPath.reason).toContain(reason);
    expect(t.criticalPath.rounds[0].steps.map((s) => s.ms)).toEqual([100000, 50000, 10000]);
  });

  test.each([
    [
      'one overlapping the verifier',
      [root(0, 200), agent('reviewer', 0, 100), agent('verifier', 100, 150), verdict(120, 125), verdict(150, 160)],
    ],
    [
      'two overlapping each other',
      [root(0, 200), agent('reviewer', 0, 50), agent('verifier', 50, 80), verdict(80, 90), verdict(85, 95)],
    ],
  ])('a round with two verdict spans, %s: the critical path is MISSING (which one ends the chain is not known)', (_, spans) => {
    const { criticalPath } = computeReviewTiming(spans);
    expect(criticalPath).toMatchObject({ ms: null, missing: true });
    expect(criticalPath.reason).toContain('2 verdict spans recorded in the round');
  });

  test('a second verdict that is unfinished, or wholly outside the window, is not a second verdict', () => {
    const base = [root(0, 200), agent('reviewer', 0, 100), agent('verifier', 100, 150), verdict(150, 160)];
    const unfinished = computeReviewTiming([...base, verdict(170, null)]).criticalPath;
    expect(unfinished).toMatchObject({ ms: 160000, missing: false, lowerBound: true });
    const outside = computeReviewTiming([...base, verdict(300, 310)]).criticalPath;
    expect(outside).toMatchObject({ ms: 160000, missing: false });
    expect(outside.lowerBound).toBeUndefined();
  });

  test('a review with no verifier span says so and names the Quick tier; an unusable verifier is not blamed on it', () => {
    const none = computeReviewTiming([root(0, 100), agent('reviewer', 0, 50), verdict(50, 51)]).criticalPath;
    expect(none.missing).toBe(true);
    expect(none.reason).toContain('verifier: no verifier span recorded (a Quick review dispatches none)');
    const unfinished = computeReviewTiming([root(0, 100), agent('reviewer', 0, 50), agent('verifier', 50, null), verdict(60, 61)]).criticalPath;
    expect(unfinished.reason).toContain('every verifier span is unusable');
    expect(unfinished.reason).not.toContain('Quick');
  });

  test('the text report says why a round whose steps were all measured has no total', () => {
    const text = formatReviewTiming(computeReviewTiming([root(0, 160), agent('reviewer', 0, 100), agent('verifier', 50, 150), verdict(150, 160)]));
    expect(text).toContain('MISSING (round (unnumbered): verifier starts 50.0s before reviewer ends');
    expect(text).toContain('[MISSING: verifier starts 50.0s before reviewer ends');
  });
});

describe('the critical path across waves: agents run in waves, one wave after another (review of PR 270, round 1)', () => {
  const verdict = (start, end, attrs = { round: 1 }) => span(STAGES.verdict, start, end, attrs);
  const w = (wave, extra = {}) => ({ round: 1, wave, ...extra });

  // maxConcurrentAgents splits a round's agents into waves and a wave is dispatched only after the one before it was
  // collected, so two waves are two steps of the chain, not one: 40 s, then 20 s, then a 10 s verifier, then the verdict.
  const twoReviewWaves = [
    root(0, 200),
    agent('reviewer', 0, 40, { agent: 'RevA', ...w(1) }),
    agent('reviewer', 0, 25, { agent: 'RevB', ...w(1) }),
    agent('reviewer', 41, 61, { agent: 'RevC', ...w(2) }),
    agent('verifier', 62, 72, { agent: 'VerA', ...w(1) }),
    verdict(72, 73),
  ];

  test('two review waves: the slowest reviewer of EACH wave is a step and they are summed (40 s + 20 s, not the one slowest 40 s)', () => {
    const { criticalPath } = computeReviewTiming(twoReviewWaves);
    expect(criticalPath.rounds[0].steps).toEqual([
      { stage: 'reviewer', wave: 1, ms: 40000, missing: false, name: 'RevA' },
      { stage: 'reviewer', wave: 2, ms: 20000, missing: false, name: 'RevC' },
      { stage: 'verifier', ms: 10000, missing: false, name: 'VerA' },
      { stage: 'verdict', ms: 1000, missing: false },
    ]);
    expect(criticalPath).toMatchObject({ ms: 71000, missing: false });
    expect(criticalPath.lowerBound).toBeUndefined();
  });

  test('verify waves are summed the same way (20 s + 8 s); a stage in a single wave stays one step with no wave named', () => {
    const { criticalPath } = computeReviewTiming([
      root(0, 300),
      agent('reviewer', 0, 30, { agent: 'RevA', ...w(1) }),
      agent('verifier', 31, 51, { agent: 'VerA', ...w(1) }),
      agent('verifier', 31, 41, { agent: 'VerB', ...w(1) }),
      agent('verifier', 52, 60, { agent: 'VerC', ...w(2) }),
      verdict(60, 61),
    ]);
    expect(criticalPath.rounds[0].steps.map((s) => [s.stage, s.wave, s.ms, s.name])).toEqual([
      ['reviewer', undefined, 30000, 'RevA'],
      ['verifier', 1, 20000, 'VerA'],
      ['verifier', 2, 8000, 'VerC'],
      ['verdict', undefined, 1000, undefined],
    ]);
    expect(criticalPath).toMatchObject({ ms: 59000, missing: false });
  });

  test('waves are numbered per round: every round has its own wave 1, and the rounds are summed', () => {
    const second = (wave) => ({ round: 2, wave });
    const { criticalPath } = computeReviewTiming([
      root(0, 400),
      ...twoReviewWaves.slice(1),
      agent('reviewer', 100, 110, { agent: 'RevD', ...second(1) }),
      agent('reviewer', 111, 131, { agent: 'RevE', ...second(2) }),
      agent('verifier', 132, 142, { agent: 'VerB', ...second(1) }),
      verdict(142, 143, { round: 2 }),
    ]);
    expect(criticalPath.rounds.map((r) => [r.round, r.ms])).toEqual([
      [1, 71000],
      [2, 41000],
    ]);
    expect(criticalPath).toMatchObject({ ms: 112000, missing: false });
  });

  test('a wave named by a decimal string (what `trace start --attr wave=2` records) counts, as round does', () => {
    const asStrings = twoReviewWaves.map((s) => (s.attrs.wave === undefined ? s : { ...s, attrs: { ...s.attrs, round: String(s.attrs.round), wave: String(s.attrs.wave) } }));
    expect(computeReviewTiming(asStrings).criticalPath).toMatchObject({ ms: 71000, missing: false });
  });

  test('spans that name no wave are one wave: the slowest of them, as before (a trace that predates the attr, the narrated flow)', () => {
    const { criticalPath } = computeReviewTiming([
      root(0, 200),
      agent('reviewer', 0, 40, { agent: 'RevA' }),
      agent('reviewer', 0, 20, { agent: 'RevB' }),
      agent('verifier', 41, 51),
      verdict(51, 52, {}),
    ]);
    expect(criticalPath.rounds[0].steps.map((s) => [s.stage, s.wave, s.ms])).toEqual([
      ['reviewer', undefined, 40000],
      ['verifier', undefined, 10000],
      ['verdict', undefined, 1000],
    ]);
    expect(criticalPath.ms).toBe(51000);
  });

  test('a wave that holds no reviewer (only the security lane ran in it) is no step of the chain: the total is a lower bound that names the wave', () => {
    // a cap of 2 on two reviewers and the lane: wave 1 is both reviewers, wave 2 is the lane alone
    const spans = [
      root(0, 200),
      agent('reviewer', 0, 40, { agent: 'RevA', ...w(1) }),
      agent('reviewer', 0, 30, { agent: 'RevB', ...w(1) }),
      agent('security-lane', 41, 71, { agent: 'security-lane', ...w(2) }),
      agent('verifier', 72, 82, { agent: 'VerA', ...w(1) }),
      verdict(82, 83),
    ];
    const t = computeReviewTiming(spans);
    expect(t.criticalPath).toMatchObject({ ms: 51000, missing: false, lowerBound: true });
    expect(t.criticalPath.rounds[0]).toMatchObject({ round: 1, lowerBound: true, uncountedWaves: [2] });
    expect(formatReviewTiming(t)).toContain('[lower bound: no reviewer in review wave 2, so no step counts it]');
    // the lane in the SAME wave as the reviewers leaves no wave uncounted, but it ends 31 s after the slowest of them and the
    // verifier waited for it: the excess is named and the total a lower bound (this case was pinned as exact before review
    // round 2, which found that silent understatement: the lane that outlasts its wave's reviewers is the common case)
    const together = computeReviewTiming(spans.map((s) => (s.name === STAGES['security-lane'] ? { ...s, attrs: { ...s.attrs, wave: 1 } } : s)));
    expect(together.criticalPath.rounds[0].uncountedWaves).toBeUndefined();
    expect(together.criticalPath.rounds[0].outlasted).toEqual([{ stage: 'security-lane', name: 'security-lane', wave: 1, byMs: 31000 }]);
    expect(together.criticalPath.lowerBound).toBe(true);
    // a lane inside the reviewers' wave that ends with them leaves nothing: the total is exact
    const inside = computeReviewTiming(spans.map((s) => (s.name === STAGES['security-lane'] ? { ...s, start_ts: at(0), end_ts: at(30), duration_ms: 30000, attrs: { ...s.attrs, wave: 1 } } : s)));
    expect(inside.criticalPath.rounds[0].uncountedWaves).toBeUndefined();
    expect(inside.criticalPath.lowerBound).toBeUndefined();
  });

  test('waves that overlap in time are never summed: the total is MISSING and names the pair, each step still measured', () => {
    const { criticalPath } = computeReviewTiming([root(0, 200), agent('reviewer', 0, 40, w(1)), agent('reviewer', 30, 60, w(2)), agent('verifier', 60, 70, w(1)), verdict(70, 71)]);
    expect(criticalPath).toMatchObject({ ms: null, missing: true });
    expect(criticalPath.reason).toContain('reviewer wave 2 starts 10.0s before reviewer wave 1 ends');
    expect(criticalPath.rounds[0].steps.every((s) => !s.missing)).toBe(true);
  });

  test('a wave whose every span is unusable is a missing step that names the wave; one unusable span among usable ones makes the step a lower bound', () => {
    const base = [root(0, 200), agent('reviewer', 0, 40, w(1)), agent('verifier', 62, 72, w(1)), verdict(72, 73)];
    const none = computeReviewTiming([...base, agent('reviewer', 41, null, w(2))]).criticalPath;
    expect(none).toMatchObject({ ms: null, missing: true });
    expect(none.reason).toContain('reviewer wave 2: every reviewer span is unusable');
    const some = computeReviewTiming([...base, agent('reviewer', 41, 61, w(2)), agent('reviewer', 41, null, w(2))]).criticalPath;
    expect(some).toMatchObject({ ms: 71000, missing: false, lowerBound: true });
    expect(some.rounds[0].steps[1]).toMatchObject({ stage: 'reviewer', wave: 2, ms: 20000, lowerBound: true, unusable: 1 });
  });

  test('spans of a stage that name a wave beside spans that do not: a warning, and the unnumbered ones are one extra wave', () => {
    const t = computeReviewTiming([root(0, 200), agent('reviewer', 0, 40, w(1)), agent('reviewer', 41, 61, { round: 1 }), agent('verifier', 62, 72, w(1)), verdict(72, 73)]);
    expect(t.warnings.join(' ')).toContain('round 1: some reviewer spans carry a wave and some do not');
    expect(t.criticalPath.rounds[0].steps.map((s) => [s.stage, s.wave, s.ms])).toEqual([
      ['reviewer', 1, 40000],
      ['reviewer', null, 20000],
      ['verifier', undefined, 10000],
      ['verdict', undefined, 1000],
    ]);
    expect(t.criticalPath.ms).toBe(71000);
    expect(formatReviewTiming(t)).toContain('reviewer (unnumbered wave) 20.0s');
  });

  test('the text report names each wave', () => {
    const text = formatReviewTiming(computeReviewTiming(twoReviewWaves));
    expect(text).toContain('round 1: reviewer wave 1 40.0s (RevA) -> reviewer wave 2 20.0s (RevC) -> verifier 10.0s (VerA) -> verdict 1.0s');
    expect(text).toMatch(/critical path:\s+1m11s\n/);
  });
});

describe('agents that are no step of the chain: the security lane that outlasts the reviewers of its wave (review of PR 270, round 2)', () => {
  const verdict = (start, end) => span(STAGES.verdict, start, end, { round: 1 });
  const rev = (start, end, attrs) => agent('reviewer', start, end, { agent: 'RevA', round: 1, wave: 1, ...attrs });
  const lane = (start, end, attrs) => agent('security-lane', start, end, { agent: 'security-lane', round: 1, wave: 1, ...attrs });
  const ver = (start, end, attrs) => agent('verifier', start, end, { agent: 'VerA', round: 1, wave: 1, ...attrs });

  test('a lane in the reviewers\' wave that ends after them is named and makes the total a lower bound: the verifier waited for it (the default cap puts the lane in that wave)', () => {
    const t = computeReviewTiming([root(0, 200), rev(0, 10), lane(0, 60), ver(61, 71), verdict(71, 72)]);
    expect(t.criticalPath).toMatchObject({ ms: 21000, missing: false, lowerBound: true }); // the chain is 71 s long: 10 + 50 for the lane + 10 + 1
    expect(t.criticalPath.rounds[0].outlasted).toEqual([{ stage: 'security-lane', name: 'security-lane', wave: 1, byMs: 50000 }]);
    expect(t.criticalPath.rounds[0].uncountedWaves).toBeUndefined();
    expect(formatReviewTiming(t)).toContain('[lower bound: security-lane ran 50.0s past the slowest reviewer of its wave 1, which no step counts]');
  });

  test.each([
    ['ends before the slowest reviewer', lane(0, 5)],
    ['ends exactly when it ends', lane(0, 10)],
  ])('a lane that %s leaves the total exact: nothing is hidden', (_, other) => {
    const t = computeReviewTiming([root(0, 200), rev(0, 10), other, ver(11, 21), verdict(21, 22)]);
    expect(t.criticalPath).toMatchObject({ ms: 21000, missing: false });
    expect(t.criticalPath.lowerBound).toBeUndefined();
    expect(t.criticalPath.rounds[0].outlasted).toBeUndefined();
  });

  test('the lane is compared with the reviewer of ITS wave: in a round of two waves, a lane that outlasts only the second wave\'s reviewer is named with that wave', () => {
    const t = computeReviewTiming([
      root(0, 300),
      rev(0, 40, { agent: 'RevA' }),
      lane(0, 30, { agent: 'lane-a' }), // inside wave 1: no excess
      rev(41, 61, { agent: 'RevB', wave: 2 }),
      lane(41, 100, { agent: 'lane-b', wave: 2 }), // 39 s past RevB
      ver(101, 111),
      verdict(111, 112),
    ]);
    expect(t.criticalPath).toMatchObject({ ms: 40000 + 20000 + 10000 + 1000, missing: false, lowerBound: true });
    expect(t.criticalPath.rounds[0].outlasted).toEqual([{ stage: 'security-lane', name: 'lane-b', wave: 2, byMs: 39000 }]);
  });

  test('a trace that names no wave at all is one wave: a lane that ends after the slowest reviewer is named, with no wave', () => {
    const t = computeReviewTiming([root(0, 200), rev(0, 40, { wave: undefined }), lane(0, 70, { wave: undefined }), ver(71, 81, { wave: undefined }), verdict(81, 82)]);
    expect(t.criticalPath).toMatchObject({ ms: 51000, missing: false, lowerBound: true });
    expect(t.criticalPath.rounds[0].outlasted).toEqual([{ stage: 'security-lane', name: 'security-lane', byMs: 30000 }]);
  });

  test('an agent that names no wave beside reviewers that do cannot be placed: it is compared with the last reviewer step, so a classifier that ended before them is no excess and a lane after them is', () => {
    const t = computeReviewTiming([
      root(0, 300),
      rev(0, 40),
      rev(41, 61, { agent: 'RevB', wave: 2 }),
      agent('classifier', 0, 5, { agent: 'classifier', round: 1 }),
      agent('security-lane', 41, 90, { agent: 'security-lane', round: 1 }),
      ver(91, 101),
      verdict(101, 102),
    ]);
    expect(t.criticalPath).toMatchObject({ ms: 40000 + 20000 + 10000 + 1000, missing: false, lowerBound: true });
    expect(t.criticalPath.rounds[0].outlasted).toEqual([{ stage: 'security-lane', name: 'security-lane', byMs: 29000 }]);
  });

  test('a numbered lane wave beside reviewers that name none is still flagged: no reviewer is known to have run in it (review of PR 270, round 2, nit)', () => {
    const t = computeReviewTiming([root(0, 200), rev(0, 40, { wave: undefined }), lane(41, 90, { wave: 2 }), ver(91, 101, { wave: undefined }), verdict(101, 102)]);
    expect(t.criticalPath).toMatchObject({ ms: 51000, missing: false, lowerBound: true });
    expect(t.criticalPath.rounds[0].uncountedWaves).toEqual([2]);
  });

  test('a lane whose length is unknown may have outlasted the reviewers: it is listed with the reason and the total is a lower bound', () => {
    const t = computeReviewTiming([root(0, 200), rev(0, 10), lane(0, null), ver(61, 71), verdict(71, 72)]);
    expect(t.criticalPath).toMatchObject({ ms: 21000, missing: false, lowerBound: true });
    expect(t.criticalPath.rounds[0].outlasted).toEqual([{ stage: 'security-lane', name: 'security-lane', wave: 1, unusable: 'unfinished' }]);
    expect(formatReviewTiming(t)).toContain('security-lane has no usable length (unfinished), so it may have outlasted the reviewers, which no step counts');
  });

  test('another round\'s lane is not this round\'s excess', () => {
    const t = computeReviewTiming([
      root(0, 500),
      rev(0, 10, { round: 1 }),
      ver(11, 21, { round: 1 }),
      span(STAGES.verdict, 21, 22, { round: 1 }),
      rev(100, 110, { round: 2 }),
      lane(100, 160, { round: 2 }),
      ver(161, 171, { round: 2 }),
      span(STAGES.verdict, 171, 172, { round: 2 }),
    ]);
    expect(t.criticalPath.rounds.map((r) => [r.round, r.lowerBound === true])).toEqual([
      [1, false],
      [2, true],
    ]);
  });
});

describe('spans that carry one wave number were dispatched together (review of PR 270, round 2)', () => {
  const w = (wave, extra) => ({ round: 1, wave, ...extra });
  const verdict = (start, end) => span(STAGES.verdict, start, end, { round: 1 });

  test('two real waves stamped with the same number are not one wave: the step is MISSING and names it, a shorter chain is not passed off as the whole (true chain 71 s, one slowest span would say 51 s)', () => {
    const t = computeReviewTiming([
      root(0, 200),
      agent('reviewer', 0, 40, w(1, { agent: 'RevA' })),
      agent('reviewer', 0, 25, w(1, { agent: 'RevB' })),
      agent('reviewer', 41, 61, w(1, { agent: 'RevC' })),
      agent('verifier', 62, 72, w(1)),
      verdict(72, 73),
    ]);
    expect(t.criticalPath).toMatchObject({ ms: null, missing: true });
    expect(t.criticalPath.reason).toContain('reviewer wave 1: its spans start 41.0s apart, more than the 5.0s within which the agents of one wave are dispatched');
    expect(t.criticalPath.rounds[0].steps[0]).toMatchObject({ stage: 'reviewer', wave: 1, missing: true });
    expect(t.criticalPath.rounds[0].steps.slice(1).every((s) => !s.missing)).toBe(true); // the others are still measured
  });

  test('agents of one wave that start a moment apart (the dispatch loop takes a moment) are one wave', () => {
    const t = computeReviewTiming([root(0, 200), agent('reviewer', 0, 40, w(1)), agent('reviewer', 2, 25, w(1)), agent('reviewer', 5, 30, w(1)), agent('verifier', 41, 51, w(1)), verdict(51, 52)]);
    expect(t.criticalPath).toMatchObject({ ms: 40000 + 10000 + 1000, missing: false }); // 5.0 s apart is the tolerance itself
    const apart = computeReviewTiming([root(0, 200), agent('reviewer', 0, 40, w(1)), agent('reviewer', 5.001, 25, w(1)), agent('verifier', 41, 51, w(1)), verdict(51, 52)]);
    expect(apart.criticalPath).toMatchObject({ ms: null, missing: true });
  });

  test('a merged wave among several leaves that wave MISSING and the other waves measured', () => {
    const t = computeReviewTiming([
      root(0, 300),
      agent('reviewer', 0, 40, w(1)),
      agent('reviewer', 41, 61, w(2)),
      agent('reviewer', 100, 110, w(2)), // a third wave stamped 2
      agent('verifier', 111, 121, w(1)),
      verdict(121, 122),
    ]);
    expect(t.criticalPath.reason).toContain('reviewer wave 2: its spans start 59.0s apart');
    expect(t.criticalPath.rounds[0].steps.map((s) => [s.stage, s.wave, s.missing])).toEqual([
      ['reviewer', 1, false],
      ['reviewer', 2, true],
      ['verifier', undefined, false],
      ['verdict', undefined, false],
    ]);
  });

  test('verify waves follow the same rule', () => {
    const t = computeReviewTiming([root(0, 300), agent('reviewer', 0, 10, w(1)), agent('verifier', 11, 21, w(1)), agent('verifier', 60, 70, w(1)), verdict(70, 71)]);
    expect(t.criticalPath).toMatchObject({ ms: null, missing: true });
    expect(t.criticalPath.reason).toContain('verifier wave 1: its spans start 49.0s apart');
  });

  test('spans that name no wave are never checked: a narrated dispatch staggers its agents, and one slowest span is the figure as before', () => {
    const t = computeReviewTiming([root(0, 300), agent('reviewer', 0, 40, { round: 1 }), agent('reviewer', 30, 50, { round: 1 }), agent('verifier', 51, 61, { round: 1 }), verdict(61, 62)]);
    expect(t.criticalPath).toMatchObject({ ms: 40000 + 10000 + 1000, missing: false });
  });
});

describe('a verdict span that ended in error is a verdict that was not recorded (review of PR 270, round 2)', () => {
  const verdict = (start, end, status = 'ok') => ({ ...span(STAGES.verdict, start, end, { round: 1 }), status });
  const chain = [root(0, 300), agent('reviewer', 0, 40, { round: 1 }), agent('verifier', 41, 51, { round: 1 })];

  test('the failed attempt and the retry that recorded the verdict are ONE verdict: the retry\'s is the step, the total is computed, not MISSING for two verdicts', () => {
    const t = computeReviewTiming([...chain, verdict(51, 52, 'error'), verdict(53, 54)]);
    expect(t.criticalPath).toMatchObject({ ms: 40000 + 10000 + 1000, missing: false });
    expect(t.criticalPath.rounds[0].steps[2]).toEqual({ stage: 'verdict', ms: 1000, missing: false });
    expect(t.stages[STAGES.verdict].count).toBe(2); // both attempts are in the trace and in the per-stage table
  });

  test('an error verdict that is the longer one is not taken for the step: the slowest rule does not choose a verdict that was never recorded', () => {
    const t = computeReviewTiming([...chain, verdict(51, 80, 'error'), verdict(81, 82)]);
    expect(t.criticalPath).toMatchObject({ ms: 40000 + 10000 + 1000, missing: false });
  });

  test('a round whose only verdict span ended in error has no verdict: MISSING, with that reason, the other steps still measured', () => {
    const t = computeReviewTiming([...chain, verdict(51, 52, 'error')]);
    expect(t.criticalPath).toMatchObject({ ms: null, missing: true });
    expect(t.criticalPath.reason).toContain('verdict: every verdict span ended in error: no verdict was recorded');
    expect(t.criticalPath.rounds[0].steps.slice(0, 2).every((s) => !s.missing)).toBe(true);
  });

  test('only the status `error` is excluded: a verdict that ended in another status still counts, and two of them are still two', () => {
    expect(computeReviewTiming([...chain, verdict(51, 52, 'blocked')]).criticalPath).toMatchObject({ ms: 51000, missing: false });
    const two = computeReviewTiming([...chain, verdict(51, 52, 'blocked'), verdict(53, 54)]).criticalPath;
    expect(two).toMatchObject({ ms: null, missing: true });
    expect(two.reason).toContain('2 verdict spans recorded in the round');
  });
});

describe('input checking', () => {
  test.each([[undefined], [null], ['spans'], [{ spans: 'x' }], [{}]])('%j is refused, not read as an empty trace', (input) => {
    expect(computeReviewTiming(input)).toMatchObject({ ok: false });
  });

  test('a span without a name or a start time is refused naming its index', () => {
    expect(computeReviewTiming([root(0, 1), { name: 'x' }])).toEqual({
      ok: false,
      reason: 'spans[1] is not a run-trace span (name and start_ts are required)',
    });
  });

  test('an empty span list is a timing with every figure missing', () => {
    const t = computeReviewTiming([]);
    expect(t.ok).toBe(true);
    expect(t.wall.missing && t.orchestratorOnly.missing && t.criticalPath.missing).toBe(true);
  });
});

describe('loadReviewTiming reads one trace through injectable deps', () => {
  test('uses the injected reader and passes the trace warnings through', () => {
    const calls = [];
    const deps = {
      tracePath: (projectRoot, runId) => {
        calls.push(['path', projectRoot, runId]);
        return '/virtual/trace.jsonl';
      },
      readTrace: (file) => {
        calls.push(['read', file]);
        return { spans: [root(0, 100), agent('reviewer', 0, 50)], warnings: ['line 3: not valid JSON, skipped'] };
      },
    };
    const t = loadReviewTiming({ runId: 'abc', projectRoot: '/p' }, deps);
    expect(calls).toEqual([['path', '/p', 'abc'], ['read', '/virtual/trace.jsonl']]);
    expect(t).toMatchObject({ ok: true, runId: 'abc', tracePath: '/virtual/trace.jsonl', warnings: ['line 3: not valid JSON, skipped'] });
    expect(t.orchestratorOnly.ms).toBe(50000);
  });

  test('an unreadable trace is ok:false with the reason, never an empty timing and never a throw', () => {
    const deps = { tracePath: () => '/x', readTrace: () => { throw new Error('ENOENT'); } };
    expect(loadReviewTiming({ runId: 'abc', projectRoot: '/p' }, deps)).toEqual({ ok: false, reason: 'cannot read the run trace: ENOENT' });
  });

  test('an invalid run id is refused by the real run-trace path check', () => {
    const t = loadReviewTiming({ runId: '../escape', projectRoot: os.tmpdir() });
    expect(t.ok).toBe(false);
  });

  test.each([[{ runId: 'a' }], [{ projectRoot: '/p' }], [null]])('%j is refused', (request) => {
    expect(loadReviewTiming(request)).toMatchObject({ ok: false });
  });
});

describe('the stage contract is emitted through run-trace and read back', () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-review-timing-'));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  test('every stage name has a kind run-trace accepts', () => {
    for (const kind of Object.values(STAGE_KINDS)) expect(KINDS).toContain(kind);
    expect(Object.keys(STAGE_KINDS).sort()).toEqual(Object.values(STAGES).sort());
  });

  test('spans recorded by the real tracer under the contract names produce the timing', () => {
    let now = T0;
    const unavailable = [];
    const tracer = createTracer({
      runId: 'review-1',
      projectRoot: dir,
      clock: { now: () => now, mono: () => now },
      onUnavailable: (reason) => unavailable.push(reason),
    });
    const step = (sec) => {
      now = T0 + sec * 1000;
    };
    step(0);
    const rootId = tracer.startSpan(STAGES.root, { kind: STAGE_KINDS[STAGES.root], attrs: { turns: '5', tool_calls: '6' } });
    step(2);
    const head = tracer.startSpan(STAGES.headRead, { kind: STAGE_KINDS[STAGES.headRead], parentId: rootId });
    step(3);
    tracer.endSpan(head);
    step(10);
    const reviewer = tracer.startSpan(STAGES.reviewer, { kind: 'agent', parentId: rootId, attrs: { agent: 'RevA', round: '1' } });
    step(70);
    tracer.endSpan(reviewer, { attrs: { last_message_ts: at(65) } });
    step(75);
    const verifier = tracer.startSpan(STAGES.verifier, { kind: 'agent', parentId: rootId, attrs: { agent: 'VerA', round: '1' } });
    step(95);
    tracer.endSpan(verifier);
    const verdict = tracer.startSpan(STAGES.verdict, { kind: STAGE_KINDS[STAGES.verdict], parentId: rootId, attrs: { round: '1' } });
    step(96);
    tracer.endSpan(verdict);
    step(100);
    tracer.endSpan(rootId);
    expect(unavailable).toEqual([]);

    const t = loadReviewTiming({ runId: 'review-1', projectRoot: dir });
    expect(t).toMatchObject({ ok: true, runId: 'review-1' });
    expect(t.wall.ms).toBe(100000);
    expect(t.turns.ms).toBe(5);
    expect(t.stages[STAGES.headRead]).toMatchObject({ count: 1, ms: 1000, missing: false });
    expect(t.activeMs.ms).toBe(55000 + 20000); // reviewer to its last message (10..65), verifier 75..95
    // The 1 s verdict is a step of the critical path, so it is not counted again as orchestrator time (76 + 25 would be 101 s of a 100 s window).
    expect(t.orchestratorOnly.ms).toBe(24000);
    expect(t.criticalPath.ms + t.orchestratorOnly.ms).toBeLessThanOrEqual(t.wall.ms);
    expect(t.criticalPath).toMatchObject({ ms: 55000 + 20000 + 1000, missing: false });
    expect(t.criticalPath.rounds[0].round).toBe(1);
  });

  test('a whole review recorded with the real `toolchain-cli trace start|end` verbs (one process per call, string attrs, real clocks) is read back by `pr-review-cli timing`', () => {
    const toolchainCli = path.join(__dirname, '..', 'lib', 'toolchain-cli.js');
    const tc = (...args) => {
      const res = spawnSync(process.execPath, [toolchainCli, ...args], { cwd: dir, encoding: 'utf8' });
      expect({ status: res.status, stderr: res.stderr }).toEqual({ status: 0, stderr: '' });
      return res.stdout.trim();
    };
    const start = (name, parent, ...attrs) =>
      tc('trace', 'start', '--run-id', 'real', '--name', name, '--kind', STAGE_KINDS[name], ...(parent ? ['--parent', parent] : []), ...attrs.flatMap((a) => ['--attr', a]));
    const end = (spanId, ...attrs) => tc('trace', 'end', '--run-id', 'real', '--span-id', spanId, ...attrs.flatMap((a) => ['--attr', a]));

    const rootId = start(STAGES.root, null);
    const head = start(STAGES.headRead, rootId);
    end(head);
    const reviewer = start(STAGES.reviewer, rootId, 'agent=RevA', 'round=1');
    end(reviewer);
    const verifier = start(STAGES.verifier, rootId, 'agent=VerA', 'round=1');
    end(verifier);
    const verdict = start(STAGES.verdict, rootId, 'round=1');
    end(verdict);
    end(rootId, 'turns=7', 'tool_calls=9');

    const res = spawnSync(process.execPath, [CLI, 'timing'], { input: JSON.stringify({ runId: 'real', cwd: dir }), encoding: 'utf8' });
    expect(res.status).toBe(0);
    const t = JSON.parse(res.stdout);
    expect(t).toMatchObject({ ok: true, turns: { ms: 7, missing: false }, toolCalls: { ms: 9, missing: false }, warnings: [] });
    expect(t.stages[STAGES.headRead]).toMatchObject({ count: 1, missing: false });
    expect(t.agents.count).toBe(2);
    // Real clocks agree with each other, so nothing is flagged and every figure is a number.
    expect(t.orchestratorOnly.missing).toBe(false);
    expect(t.criticalPath).toMatchObject({ missing: false });
    expect(t.criticalPath.rounds[0].round).toBe(1);
    expect(t.criticalPath.ms).toBeLessThanOrEqual(t.wall.ms);
    expect(t.criticalPath.ms + t.orchestratorOnly.ms).toBeLessThanOrEqual(t.wall.ms);
  }, 30000);
});

describe('the entry points', () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-review-timing-cli-'));
    const target = path.join(dir, '.ensemble', 'state', 'toolchain');
    fs.mkdirSync(target, { recursive: true });
    fs.copyFileSync(FIXTURE, path.join(target, 'trace-pr234.jsonl'));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const cli = (payload) => {
    const res = spawnSync('node', [CLI, 'timing'], { input: JSON.stringify(payload), encoding: 'utf8' });
    return { status: res.status, out: JSON.parse(res.stdout) };
  };

  test('pr-review-cli timing { runId, cwd } answers the #234 figures from the trace on disk', () => {
    const { status, out } = cli({ runId: 'pr234', cwd: dir });
    expect(status).toBe(0);
    expect(out.turns.ms).toBe(92);
    expect(minutes(out.wall.ms)).toBe(19.7);
    expect(out.orchestratorOnly.pct).toBe(70);
    expect(out.criticalPath.missing).toBe(true);
  });

  test('pr-review-cli timing { spans } answers from spans handed in', () => {
    const { status, out } = cli({ spans: [root(0, 100), agent('reviewer', 0, 40)] });
    expect(status).toBe(0);
    expect(out.orchestratorOnly.ms).toBe(60000);
  });

  test('a trace that does not exist is an in-band ok:false (exit 0), not zeros', () => {
    const { status, out } = cli({ runId: 'nothere', cwd: dir });
    expect(status).toBe(0);
    expect(out.ok).toBe(false);
    expect(out.wall).toBeUndefined();
  });

  test.each([
    ['neither runId nor spans', {}],
    ['both runId and spans', { runId: 'pr234', spans: [] }],
    ['a misspelt key', { runid: 'pr234' }],
    ['a non-string runId', { runId: 234 }],
    ['spans that are not a list', { spans: {} }],
    ['a non-string cwd', { runId: 'pr234', cwd: 5 }],
  ])('%s is an error (exit 1)', (_, payload) => {
    const { status, out } = cli(payload);
    expect(status).toBe(1);
    expect(out.error).toContain('timing');
  });

  test('the script entry prints the text report and exits 0; a missing trace exits 1', () => {
    const lines = [];
    expect(main(['pr234', '--cwd', dir], { out: (t) => lines.push(t) })).toBe(0);
    expect(lines.join('')).toContain('orchestrator-only:           13m47s (70%)');
    const bad = [];
    expect(main(['nothere', '--cwd', dir], { out: (t) => bad.push(t) })).toBe(1);
    expect(bad.join('')).toContain('Review timing unavailable');
    expect(main([], { out: () => {} })).toBe(1);
    expect(main(['pr234', '--bogus'], { out: () => {} })).toBe(1);
  });

  test('the script entry as a real process', () => {
    const res = spawnSync('node', [path.join(__dirname, '..', 'lib', 'pr-review-timing.js'), 'pr234', '--cwd', dir, '--json'], { encoding: 'utf8' });
    expect(res.status).toBe(0);
    expect(JSON.parse(res.stdout).orchestratorOnly.pct).toBe(70);
  });
});
