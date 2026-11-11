'use strict';

/**
 * Review timing reports what the dispatcher supplied per agent (kata nj2d, plan v2 section 5 child V2-1, owner decision D8): tool calls,
 * turns, effort, model, retries and 429s, by role and per agent, and the host load samples that were taken while the agents ran.
 *
 * The reader never invents a figure: a figure the dispatcher did not supply, or that is not what it should be, is `null` in the agent's row
 * and explained (every agent without one, grouped by the reason) in the `without` of its role, never 0 (a tool-call count of 0 is a real
 * figure and stays 0), and a total over agents some of which have no figure is a lower bound that says so. Nothing the stats say moves a wall
 * time, a critical path or an orchestrator-only figure.
 */

const { computeReviewTiming, formatReviewTiming, loadReviewTiming, STAGES, STAGE_KINDS } = require('../lib/pr-review-timing');
const { runTiming } = require('../lib/pr-review-cli');

const T0 = Date.parse('2026-11-11T10:00:00.000Z');
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
const root = (start, end) => span(STAGES.root, start, end, {});
const agent = (role, start, end, attrs) => span(STAGES[role], start, end, attrs);
const verdict = (start, end) => span(STAGES.verdict, start, end, { round: 1 });
const sample = (sec, load1, cpus = 8) => ({ ts: at(sec), tsMs: T0 + sec * 1000, load1, load5: load1, load15: load1, cpus });

const FULL = { tool_calls: 31, turns: 33, effort: 'hi', model: 'claude-opus-4-5', retries: 0, rate_limits: 2 };

/** One round: two reviewers (the second has no figures but its effort), the lane (named by nobody), two verifiers, the verdict. */
function trace() {
  return [
    root(0, 600),
    agent('reviewer', 10, 310, { agent: 'reviewer-s1-a', round: 1, wave: 1, ...FULL }),
    agent('reviewer', 10, 250, { agent: 'reviewer-s1-b', round: 1, wave: 1, tool_calls: null, tool_calls_reason: 'the harness job result reports no tool-call count', effort: 'default' }),
    agent('security-lane', 10, 280, { agent: 'security-lane', round: 1, wave: 1 }),
    agent('verifier', 320, 400, { agent: 'verifier-1', round: 1, wave: 1, tool_calls: 0, turns: 1 }),
    agent('verifier', 320, 470, { agent: 'verifier-2', round: 1, wave: 1, tool_calls: '12', turns: '14', retries: '1' }),
    verdict(480, 490),
  ];
}
const rows = (timing) => Object.fromEntries(timing.agentStats.agents.map((row) => [row.name, row]));
/** The `without` group of a role for one figure. */
const without = (timing, role, figure) => timing.agentStats.byRole[role].without.filter((group) => group.figure === figure);
const STAT_ATTRS = /^(tool_calls|turns|effort|model|retries|rate_limits)(_reason)?$/;

describe('every agent has a row with the figures the dispatcher supplied', () => {
  const timing = computeReviewTiming(trace());

  test('the figures are the ones stamped, with the agent, its role, round, wave and length', () => {
    expect(timing.ok).toBe(true);
    expect(rows(timing)['reviewer-s1-a']).toEqual({
      role: 'reviewer',
      name: 'reviewer-s1-a',
      round: 1,
      wave: 1,
      durationMs: 300000,
      toolCalls: 31,
      turns: 33,
      effort: 'hi',
      model: 'claude-opus-4-5',
      retries: 0,
      rateLimits: 2,
      hostLoad: null,
    });
    expect(timing.agentStats.agents.map((row) => row.name)).toEqual(['reviewer-s1-a', 'reviewer-s1-b', 'security-lane', 'verifier-1', 'verifier-2']);
  });

  test('a zero is a figure and stays zero; a decimal string (`trace end --attr tool_calls=12` records strings) counts as the integer it spells', () => {
    expect(rows(timing)['verifier-1'].toolCalls).toBe(0);
    expect(rows(timing)['verifier-2']).toMatchObject({ toolCalls: 12, turns: 14, retries: 1 });
  });

  test('a null the dispatcher supplied carries its own reason; an absent figure says nobody supplied it; neither is 0', () => {
    const r = rows(timing);
    expect(r['reviewer-s1-b'].toolCalls).toBeNull();
    expect(r['security-lane'].toolCalls).toBeNull();
    expect(r['security-lane'].rateLimits).toBeNull();
    expect(r['reviewer-s1-b'].effort).toBe('default');
    expect(without(timing, 'reviewer', 'toolCalls')).toEqual([{ figure: 'toolCalls', reason: 'the harness job result reports no tool-call count', agents: ['reviewer-s1-b'] }]);
    expect(without(timing, 'security-lane', 'toolCalls')).toEqual([{ figure: 'toolCalls', reason: 'the dispatcher supplied no tool_calls for this agent at collect', agents: ['security-lane'] }]);
    expect(without(timing, 'security-lane', 'rateLimits')).toEqual([{ figure: 'rateLimits', reason: 'the dispatcher supplied no rate_limits for this agent at collect', agents: ['security-lane'] }]);
    expect(without(timing, 'reviewer', 'effort')).toEqual([]); // both reviewers have an effort
  });

  test('every figure that is null in a row is named, with a reason, in the `without` of its role, and nothing else is', () => {
    const named = new Set();
    for (const role of Object.keys(timing.agentStats.byRole)) {
      for (const group of timing.agentStats.byRole[role].without) {
        expect(group.reason).toEqual(expect.any(String));
        expect(group.reason).not.toBe('');
        for (const name of group.agents) named.add(`${name}/${group.figure}`);
      }
    }
    const nulls = [];
    for (const row of timing.agentStats.agents) for (const key of ['toolCalls', 'turns', 'effort', 'model', 'retries', 'rateLimits']) if (row[key] === null) nulls.push(`${row.name}/${key}`);
    expect(nulls.sort()).toEqual([...named].filter((entry) => !entry.endsWith('/hostLoad')).sort());
  });

  test.each([
    ['a negative count', -1],
    ['a fraction', 1.5],
    ['a word', 'many'],
    ['a boolean', true],
    ['an object', { n: 3 }],
    ['a fraction as a string', '1.5'],
    ['a signed string', '-3'],
  ])('%s is no count: the figure is null and the reason names what the span holds', (_label, value) => {
    const t = computeReviewTiming([root(0, 100), agent('reviewer', 0, 50, { agent: 'r1', tool_calls: value })]);
    expect(t.agentStats.agents[0].toolCalls).toBeNull();
    expect(without(t, 'reviewer', 'toolCalls')).toEqual([{ figure: 'toolCalls', reason: expect.stringContaining('not a non-negative integer'), agents: ['r1'] }]);
    expect(without(t, 'reviewer', 'toolCalls')[0].reason).toContain('tool_calls');
  });

  test.each([
    ['a number', 5],
    ['an empty string', ''],
    ['a blank string', '   '],
    ['an object', {}],
  ])('effort and model that are %s are null, never printed as a name', (_label, value) => {
    const t = computeReviewTiming([root(0, 100), agent('reviewer', 0, 50, { agent: 'r1', effort: value, model: value })]);
    expect(t.agentStats.agents[0]).toMatchObject({ effort: null, model: null });
    expect(without(t, 'reviewer', 'effort')[0].reason).toContain('not a name');
    expect(without(t, 'reviewer', 'model')[0].reason).toContain('not a name');
  });

  test('an agent whose span is still open has no figures yet, and the reason says why', () => {
    const t = computeReviewTiming([root(0, 100), agent('verifier', 20, null, { agent: 'v1' })]);
    expect(t.agentStats.agents[0]).toMatchObject({ toolCalls: null, durationMs: null });
    expect(without(t, 'verifier', 'toolCalls')[0].reason).toContain('unfinished');
  });

  test('a trace with no agent has no rows, and every role says there was nothing to count', () => {
    const t = computeReviewTiming([root(0, 100)]);
    expect(t.agentStats.agents).toEqual([]);
    for (const role of Object.keys(t.agentStats.byRole)) {
      expect(t.agentStats.byRole[role]).toMatchObject({ count: 0, toolCalls: { known: 0, missing: 0, total: null, reason: 'no agent of this role was recorded' }, without: [] });
    }
  });

  test('the answer stays compact: a figure nobody supplied costs a null in a row and a name in a list, not a sentence per agent per figure', () => {
    const many = [root(0, 100), ...Array.from({ length: 61 }, (_, i) => agent('verifier', 0, 50, { agent: `verifier-${i + 1}`, round: 1, wave: 1 }))];
    const size = JSON.stringify(computeReviewTiming(many).agentStats).length;
    expect(size).toBeLessThan(61 * 450); // about 0.4 KB per agent: the 61-agent trace of the first measurement is 24 KB, not 70
  });
});

describe('by role', () => {
  const timing = computeReviewTiming(trace());
  const byRole = (role) => timing.agentStats.byRole[role];

  test('the total, the lowest and the highest are over the agents that have a figure, and are a lower bound while some agent has none', () => {
    expect(byRole('reviewer').count).toBe(2);
    expect(byRole('reviewer').toolCalls).toEqual({ known: 1, missing: 1, total: 31, min: 31, max: 31, lowerBound: true });
    expect(byRole('verifier').toolCalls).toEqual({ known: 2, missing: 0, total: 12, min: 0, max: 12 });
  });

  test('a role none of whose agents has a figure has no total, no lowest and no highest: null with the reason, never 0', () => {
    expect(byRole('security-lane').toolCalls).toEqual({ known: 0, missing: 1, total: null, min: null, max: null, reason: 'none of the 1 security-lane agent(s) has a tool_calls figure' });
    expect(byRole('classifier').toolCalls.total).toBeNull();
  });

  test('effort and model are counted by value, with the agents that have none beside them', () => {
    expect(byRole('reviewer').effort).toEqual({ values: { hi: 1, default: 1 }, missing: 0 });
    expect(byRole('reviewer').model).toEqual({ values: { 'claude-opus-4-5': 1 }, missing: 1 });
    expect(byRole('verifier').effort).toEqual({ values: {}, missing: 2 });
  });

  test('turns, retries and 429s are totalled the same way', () => {
    expect(byRole('reviewer').turns).toEqual({ known: 1, missing: 1, total: 33, min: 33, max: 33, lowerBound: true });
    expect(byRole('reviewer').retries).toMatchObject({ known: 1, total: 0 });
    expect(byRole('reviewer').rateLimits).toMatchObject({ known: 1, total: 2, max: 2 });
  });

  test('without lists every agent that has no figure, grouped by figure and reason, in the order of the figures', () => {
    expect(byRole('verifier').without.map((group) => group.figure)).toEqual(['effort', 'model', 'retries', 'rateLimits']);
    expect(byRole('verifier').without.find((group) => group.figure === 'retries').agents).toEqual(['verifier-1']);
    expect(byRole('verifier').without.find((group) => group.figure === 'model').agents).toEqual(['verifier-1', 'verifier-2']);
    // one figure, two reasons: two groups
    const two = computeReviewTiming([root(0, 100), agent('reviewer', 0, 50, { agent: 'a', tool_calls: null, tool_calls_reason: 'reason one' }), agent('reviewer', 0, 50, { agent: 'b', tool_calls: null, tool_calls_reason: 'reason two' }), agent('reviewer', 0, 50, { agent: 'c', tool_calls: null, tool_calls_reason: 'reason one' })]);
    expect(without(two, 'reviewer', 'toolCalls')).toEqual([
      { figure: 'toolCalls', reason: 'reason one', agents: ['a', 'c'] },
      { figure: 'toolCalls', reason: 'reason two', agents: ['b'] },
    ]);
  });
});

describe('the stats move nothing else', () => {
  test('every figure of the timing answer other than agentStats and hostLoad is the same with the stats as without them', () => {
    const withStats = trace();
    const plain = withStats.map((s) => ({ ...s, attrs: Object.fromEntries(Object.entries(s.attrs).filter(([key]) => !STAT_ATTRS.test(key))) }));
    const strip = ({ agentStats, hostLoad, ...rest }) => rest;
    expect(JSON.stringify(strip(computeReviewTiming(withStats)))).toBe(JSON.stringify(strip(computeReviewTiming(plain))));
  });

  test('the answer of a trace without stats keeps every key it had, in the order it had them, with the new ones last', () => {
    expect(Object.keys(computeReviewTiming([root(0, 100)]))).toEqual(['ok', 'runId', 'wall', 'turns', 'toolCalls', 'agents', 'activeMs', 'orchestratorOnly', 'beforeFirstDispatch', 'criticalPath', 'stages', 'warnings', 'hostLoad', 'agentStats']);
  });
});

describe('the text report names every agent with its tool calls, or says it has none and why', () => {
  const text = formatReviewTiming(computeReviewTiming(trace()));

  test('one line per agent, grouped by role, each with its tool calls or MISSING', () => {
    expect(text).toMatch(/reviewer-s1-a[^\n]*tool calls 31\b/);
    expect(text).toMatch(/reviewer-s1-b[^\n]*tool calls MISSING/);
    expect(text).toMatch(/security-lane[^\n]*tool calls MISSING/);
    expect(text).toMatch(/verifier-1[^\n]*tool calls 0\b/);
    expect(text).toMatch(/verifier-2[^\n]*tool calls 12\b/);
  });

  test('the reasons are printed (once per role and figure), and a missing figure is never printed as 0', () => {
    expect(text).toContain('the harness job result reports no tool-call count');
    expect(text).toContain('the dispatcher supplied no tool_calls for this agent at collect');
    expect(text).not.toMatch(/reviewer-s1-b[^\n]*tool calls 0\b/);
    expect(text).not.toMatch(/security-lane[^\n]*tool calls 0\b/);
  });

  test('a role total that leaves an agent out says it is a lower bound', () => {
    expect(text).toMatch(/totals: tool calls 31 or more \(1 of 2 have one\)/);
  });

  test('a trace with no agent adds nothing to the report', () => {
    expect(formatReviewTiming(computeReviewTiming([root(0, 100)]))).not.toContain('agent figures from the collect payload');
  });
});

describe('host load: the samples taken while the agents ran', () => {
  const samples = [sample(-30, 1), sample(0, 2), sample(30, 4), sample(60, 6), sample(90, 3), sample(120, 5), sample(630, 9)];
  const timing = computeReviewTiming({ spans: trace(), load: { ok: true, samples } });

  test('the run is summarized over the orchestrator window only: samples outside it are left out', () => {
    expect(timing.hostLoad).toEqual({ missing: false, scope: 'orchestrator window', samples: 5, load1: { min: 2, mean: 4, max: 6 }, cpus: 8, intervalMs: 30000 });
  });

  test('each agent carries the highest load of the samples taken while it ran, or is null and named when no sample was taken then', () => {
    const r = rows(timing);
    expect(r['reviewer-s1-a'].hostLoad).toEqual({ samples: 4, load1Max: 6 }); // 10..310 s: the samples at 30, 60, 90 and 120 s
    expect(r['reviewer-s1-b'].hostLoad).toEqual({ samples: 4, load1Max: 6 }); // 10..250 s: the same four
    expect(r['verifier-1'].hostLoad).toBeNull();
    expect(without(timing, 'verifier', 'hostLoad')).toEqual([{ figure: 'hostLoad', reason: 'no load sample was taken while this agent ran (the samples are about 30 s apart)', agents: ['verifier-1', 'verifier-2'] }]);
  });

  test('without samples, or without a usable file, the figure is MISSING with the reason it was not read', () => {
    const none = computeReviewTiming(trace());
    expect(none.hostLoad).toEqual({ missing: true, reason: 'no load samples were read for this trace' });
    expect(computeReviewTiming({ spans: trace(), load: { ok: false, reason: 'no load samples file at /x/load-r.jsonl: the sampler was not run for this review' } }).hostLoad).toEqual({
      missing: true,
      reason: 'no load samples file at /x/load-r.jsonl: the sampler was not run for this review',
    });
    expect(computeReviewTiming({ spans: trace(), load: { ok: true, samples: [sample(900, 3)] } }).hostLoad).toEqual({ missing: true, reason: 'no load sample lies inside the orchestrator window' });
    // the run's reason explains every agent's null load: the agents are not listed again for it
    expect(rows(none)['reviewer-s1-a'].hostLoad).toBeNull();
    expect(without(none, 'reviewer', 'hostLoad')).toEqual([]);
  });

  test('a sample with no usable time or load is left out and the answer says so; nothing is read as 0', () => {
    const t = computeReviewTiming({ spans: trace(), load: { ok: true, samples: [sample(30, 4), { ts: 'nope', tsMs: NaN, load1: 3 }, { ts: at(40), tsMs: T0 + 40000, load1: -1 }, { ts: at(50), tsMs: T0 + 50000, load1: '7' }] } });
    expect(t.hostLoad).toMatchObject({ missing: false, samples: 1, load1: { min: 4, max: 4 } });
    expect(t.warnings.join('\n')).toMatch(/3 load sample\(s\) without a usable time or load were left out/);
  });

  test('the text report prints the run figure, each agent\'s load and the reading it could not make', () => {
    const text = formatReviewTiming(timing);
    expect(text).toMatch(/host load \(1-minute average\):\s+max 6\.00, mean 4\.00, min 2\.00 over 5 sample\(s\) 30s apart, 8 cpus/);
    expect(text).toMatch(/reviewer-s1-a[^\n]*load max 6\.00/);
    expect(text).toMatch(/verifier-1[^\n]*load MISSING/);
    expect(text).toContain('load: no load sample was taken while this agent ran (the samples are about 30 s apart) (verifier-1, verifier-2)');
    expect(formatReviewTiming(computeReviewTiming(trace()))).toMatch(/host load \(1-minute average\):\s+MISSING \(no load samples were read for this trace\)/);
    // with no samples at all the agent lines carry no load column: the run's line says why
    expect(formatReviewTiming(computeReviewTiming(trace()))).not.toMatch(/reviewer-s1-a[^\n]*load /);
  });

  test('a load average above the number of cpus is reported as it is', () => {
    const t = computeReviewTiming({ spans: trace(), load: { ok: true, samples: [sample(30, 19.1, 18), sample(60, 12.4, 18)] } });
    expect(t.hostLoad).toMatchObject({ load1: { max: 19.1 }, cpus: 18 });
  });
});

describe('loadReviewTiming and the timing subcommand carry the same answer', () => {
  const spans = trace();
  const readTrace = () => ({ spans, warnings: [] });
  const tracePath = (root, runId) => `${root}/trace-${runId}.jsonl`;

  test('the load samples are read through the injected deps, and a read that fails is a reason, not a crash', () => {
    const ok = loadReviewTiming({ runId: 'r', projectRoot: '/p' }, { readTrace, tracePath, readLoad: () => ({ ok: true, samples: [sample(30, 4)], warnings: ['line 2: not a load sample, skipped'] }) });
    expect(ok.hostLoad).toMatchObject({ missing: false, samples: 1 });
    expect(ok.warnings).toContain('load: line 2: not a load sample, skipped');
    const failed = loadReviewTiming({ runId: 'r', projectRoot: '/p' }, { readTrace, tracePath, readLoad: () => ({ ok: false, reason: 'no load samples file' }) });
    expect(failed.hostLoad).toEqual({ missing: true, reason: 'no load samples file' });
    const threw = loadReviewTiming({ runId: 'r', projectRoot: '/p' }, { readTrace, tracePath, readLoad: () => { throw new Error('disk gone'); } });
    expect(threw.hostLoad).toEqual({ missing: true, reason: 'the load samples cannot be read: disk gone' });
    // deps without a load reader (the older shape) read no samples
    expect(loadReviewTiming({ runId: 'r', projectRoot: '/p' }, { readTrace, tracePath }).hostLoad).toEqual({ missing: true, reason: 'no load samples were read for this trace' });
  });

  test('`pr-review-cli timing` with spans answers the same per-agent figures', () => {
    const answer = runTiming({ spans });
    expect(answer.ok).toBe(true);
    expect(answer.agentStats.agents.map((row) => [row.name, row.toolCalls])).toEqual([['reviewer-s1-a', 31], ['reviewer-s1-b', null], ['security-lane', null], ['verifier-1', 0], ['verifier-2', 12]]);
    expect(answer.hostLoad).toEqual({ missing: true, reason: 'no load samples were read for this trace' });
  });
});

describe('host load: the figures are computed by loops, so a long sampler run does not crash the report (a spread of 125,000 or more numbers into Math.min or Math.max is a RangeError)', () => {
  // pr-review-load.js reads sample files of up to 8 MiB (about 140,000 lines); this is more than twice that, 1 ms apart, all inside the 600 s window
  const COUNT = 300000;
  const many = () => Array.from({ length: COUNT }, (_, i) => ({ tsMs: T0 + i, load1: (i % 1000) / 10, load5: 1, load15: 1, cpus: 8 }));

  test('the window figure and the highest load of each agent are right for 300,000 samples, and nothing throws', () => {
    let timing;
    expect(() => {
      timing = computeReviewTiming({ spans: trace(), load: { ok: true, samples: many() } });
    }).not.toThrow();
    expect(timing.hostLoad).toMatchObject({ missing: false, scope: 'orchestrator window', samples: COUNT, load1: { min: 0, max: 99.9 }, cpus: 8, intervalMs: 1 });
    expect(timing.hostLoad.load1.mean).toBeCloseTo(49.95, 2);
    // the reviewer ran 10 s..310 s: every sample from the 10,000th on is inside its window, and the highest of them is the cycle's top
    expect(rows(timing)['reviewer-s1-a'].hostLoad).toEqual({ samples: COUNT - 10000, load1Max: 99.9 });
    // an agent that ran after the last sample has no load, and says why
    expect(rows(timing)['verifier-1'].hostLoad).toBeNull();
  });

  test('`timing` through its injected readers, with that many samples, still answers the figure instead of throwing', () => {
    const spans = trace();
    const readTrace = () => ({ spans, warnings: [] });
    const tracePath = (projectRoot, runId) => `${projectRoot}/trace-${runId}.jsonl`;
    const answer = loadReviewTiming({ runId: 'r', projectRoot: '/p' }, { readTrace, tracePath, readLoad: () => ({ ok: true, samples: many() }) });
    expect(answer.ok).toBe(true);
    expect(answer.hostLoad).toMatchObject({ missing: false, samples: COUNT, load1: { max: 99.9 } });
  });
});

describe('host load: an agent window holds both of its ends and nothing outside them', () => {
  // times in milliseconds from T0, so that the ends are hit exactly: the reviewers ran 10 s..310 s and 10 s..250 s, the lane 10 s..280 s, the verifiers 320 s..
  const edge = (ms, load1) => ({ ts: new Date(T0 + ms).toISOString(), tsMs: T0 + ms, load1, load5: load1, load15: load1, cpus: 8 });

  test('a sample exactly at either end is inside, one a millisecond outside is not, and an agent with none inside has no load', () => {
    const samples = [edge(9999, 50), edge(10000, 2), edge(150000, 3), edge(250000, 5), edge(310000, 4), edge(310001, 60)];
    const timing = computeReviewTiming({ spans: trace(), load: { ok: true, samples } });
    const r = rows(timing);
    expect(r['reviewer-s1-a'].hostLoad).toEqual({ samples: 4, load1Max: 5 }); // 10000, 150000, 250000, 310000
    expect(r['reviewer-s1-b'].hostLoad).toEqual({ samples: 3, load1Max: 5 }); // 10000, 150000, 250000 (the end of its window)
    expect(r['security-lane'].hostLoad).toEqual({ samples: 3, load1Max: 5 }); // 10000, 150000, 250000
    expect(r['verifier-1'].hostLoad).toBeNull(); // 320 s..400 s: the last sample is at 310.001 s
    expect(r['verifier-2'].hostLoad).toBeNull();
    expect(without(timing, 'verifier', 'hostLoad')).toEqual([{ figure: 'hostLoad', reason: expect.stringMatching(/^no load sample was taken while this agent ran/), agents: ['verifier-1', 'verifier-2'] }]);
  });
});
