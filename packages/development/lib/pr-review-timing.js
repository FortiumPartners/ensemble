'use strict';

/**
 * Review timing: stage names, critical path and orchestrator-only time, computed from a run
 * trace (kata gkt9, epic ptqb, docs/plans/pr-review-speedup-plan.md sections 1 and 5).
 *
 * This module defines no timing primitive. Spans are recorded by `./run-trace.js` (kata acvv,
 * `toolchain-cli trace start|end`, `trace-<runId>.jsonl`); this module only NAMES the review
 * stages a recorder emits and READS a materialized trace (`readTrace`) back into the figures
 * the plan measured by hand with an out-of-repo script over omp session files. Nothing here
 * reads a session file.
 *
 * STAGE CONTRACT (span `name`, recommended `kind`; the names are the contract):
 *   review                  phase  the orchestrator's whole window. Exactly one per trace.
 *                                  Optional attrs `turns` and `tool_calls` (non-negative integers).
 *   review.head-read        io     reading the PR head and base
 *   review.gate             gate   one run of the merge gate (Step 10 of the pr-review-cycle skill)
 *   review.classifier       agent  one dispatched agent per role ...
 *   review.second-assessor  agent
 *   review.security-lane    agent
 *   review.reviewer         agent
 *   review.verifier         agent
 *   review.verdict          phase  the CLI computing REVIEW_COMPLETE / REVIEW_PENDING / REVIEW_BLOCKED
 * Any span MAY carry an integer attr `round` (1 = the first review, 2.. = delta re-reviews): the
 * critical path is then computed per round and summed. `trace start --attr k=v` records strings, so
 * a decimal string counts as the integer it spells (`turns`, `tool_calls` and `round`). Agent spans carry `agent` (a name)
 * for the report. `review.gate` is not the `review-gate` span of /ensemble-pr-merge's own trace (skills/pr-merge-trace):
 * that one wraps the merge command's whole review step, a different and broader span this module never reads, so the
 * two can share one trace file without either being taken for the other.
 *
 * AN AGENT ENDS AT ITS LAST `message`, NEVER AT `session_exit` (plan section 1, correction C01:
 * the idle linger after the final yield, observed as exactly 7 minutes, inflated every agent
 * figure by 7 minutes). Close an agent span when its result arrives. A recorder that can only
 * close the span later (at the session's exit) records the real end as the span attr
 * `last_message_ts` (ISO-8601); the interval then ends there and the linger is ignored. A
 * `last_message_ts` outside the span's own [start, end] is a recorder error: that agent's
 * interval is UNUSABLE, never silently trusted and never replaced by the span end.
 *
 * CLOCKS. The recorder stamps every span with two clocks: wall-clock ISO strings (`start_ts`, `end_ts`) and a
 * monotonic reading that `readTrace` folds into `duration_ms` (monotonic first, so a system sleep or a wall-clock
 * step is not counted; `attrs.clock_anomaly` marks a span whose clocks disagreed beyond repair). A span's LENGTH
 * is therefore its `duration_ms`, never `end_ts - start_ts`, and a span flagged `clock_anomaly` has no usable
 * length: it is UNUSABLE, with that reason. A span with no `duration_ms` at all (one `readTrace` did not produce)
 * is measured by its timestamps. The one exception is a span with `last_message_ts`: the last message is known
 * only as a wall-clock time, so the span ends there and its length is a wall-clock difference, trusted only while
 * the span's two clocks agree (below); past that the span is UNUSABLE ('cannot be placed'), and for the window
 * `wall` is then MISSING. Timestamps still PLACE spans against each other (who overlapped whom), but only while
 * they agree with the recorder: when a review span's wall-clock length differs from its `duration_ms` by more than
 * CLOCK_SKEW_TOLERANCE_MS, the wall clock stepped inside the window (a system sleep, a clock change), and every
 * figure that needs positions (agents active, orchestrator-only, before first dispatch, the critical path) is
 * MISSING with that reason while the lengths (window, per stage) are still reported. HONEST LIMIT: a step is seen
 * only through a span that was open across it. `readTrace` keeps no monotonic start, so a step undone before the
 * window ends, with no span open at either moment (a forward and a backward step in the gaps), leaves every span's
 * two lengths in agreement and is not detected. Timestamps are ISO-8601 with a zone, as the recorder writes them;
 * anything else is unparseable.
 *
 * FAIL CLOSED (pattern: local-ci-timing.js). A figure this module cannot compute from what was
 * recorded is `{ ms: null, missing: true, reason }`, never 0 and never a guess: a stage nobody
 * recorded, an unfinished span, a trace without an orchestrator window. A figure that is
 * computable only as a bound says so (`bound: 'upper'` / `lowerBound: true`).
 *
 * Orchestrator-only time = orchestrator wall time minus the union of the intervals (clipped to the
 * orchestrator window) in which at least one dispatched agent was active or a verdict was being computed. The
 * critical path counts the verdict, so orchestrator time leaves it out: no minute is in both, and critical path
 * plus orchestrator-only never exceeds the window.
 * Critical path (per round) = slowest reviewer -> slowest verifier -> verdict, each an interval length cut to the
 * orchestrator window (a cut is flagged on the step: `clippedMs`, `lowerBound`), summed over the rounds. It needs a
 * usable orchestrator window. The total is missing when ANY step is missing, when a round has more than one verdict
 * span (which one ends the chain is not known), and when the steps overlap or run out of order (the reviewer must end
 * before the verifier starts, the verifier before the verdict, each round before the next): overlapping steps would
 * count the same minutes twice, so they are never summed.
 *
 * `computeReviewTiming` is pure. `loadReviewTiming` reads one trace file through injectable
 * `deps` (as local-ci-runner.js and pr-review-results.js do); `pr-review-cli.js` stays free of
 * file reads.
 */

const AGENT_ROLES = Object.freeze(['classifier', 'second-assessor', 'security-lane', 'reviewer', 'verifier']);

const STAGES = Object.freeze({
  root: 'review',
  headRead: 'review.head-read',
  gate: 'review.gate',
  verdict: 'review.verdict',
  ...Object.fromEntries(AGENT_ROLES.map((role) => [role, `review.${role}`])),
});

/** Recommended run-trace `kind` per stage name (run-trace.js KINDS). */
const STAGE_KINDS = Object.freeze({
  [STAGES.root]: 'phase',
  [STAGES.headRead]: 'io',
  [STAGES.gate]: 'gate',
  [STAGES.verdict]: 'phase',
  ...Object.fromEntries(AGENT_ROLES.map((role) => [STAGES[role], 'agent'])),
});

const AGENT_NAMES = new Set(AGENT_ROLES.map((role) => STAGES[role]));
const STAGE_NAMES = Object.freeze(Object.values(STAGES).filter((name) => name !== STAGES.root));

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isText = (value) => typeof value === 'string' && value.trim() !== '';

/** How far a span's wall-clock length may differ from the recorder's duration before the wall clock is taken to have stepped (run-trace.js allows the same 5 s between its two clocks). */
const CLOCK_SKEW_TOLERANCE_MS = 5000;
const CLOCK_ANOMALY_REASON = 'the recorder flagged a clock anomaly: its wall-clock and monotonic readings disagree over this span';
/** The latest time a Date can hold: a span that would end after it has no usable length. */
const MAX_TIME_MS = 8.64e15;

/** ISO-8601 with a zone, what the recorder writes: `Date.parse` alone also reads local-time and free-form text. */
const ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function parseMs(ts) {
  return typeof ts === 'string' && ISO_8601.test(ts) ? Date.parse(ts) : NaN;
}

function missing(reason) {
  return { ms: null, missing: true, reason };
}

function known(ms, extra) {
  return { ms, missing: false, ...extra };
}

/**
 * The usable interval of a materialized span, or why there is none.
 * It starts at `start_ts` and is as long as the recorder's `duration_ms` (see CLOCKS in the header), or, for a span
 * that carries none, as long as its timestamps say. A span flagged `clock_anomaly`, whose `end_ts` precedes its
 * `start_ts`, or whose length would end it after the latest time a Date can hold, is unusable. End =
 * `attrs.last_message_ts` when the recorder supplied one (see the header), else the start plus that length.
 *
 * @returns {{ok: true, start: number, end: number, lingerMs: number}|{ok: false, reason: string}}
 */
function intervalOf(span) {
  const start = parseMs(span.start_ts);
  if (!Number.isFinite(start)) return { ok: false, reason: 'unparseable start_ts' };
  if (span.status === 'unfinished') return { ok: false, reason: 'unfinished' };
  const wallEnd = parseMs(span.end_ts);
  if (!Number.isFinite(wallEnd)) return { ok: false, reason: 'unparseable end_ts' };
  const attrs = isObject(span.attrs) ? span.attrs : {};
  if (attrs.clock_anomaly) return { ok: false, reason: CLOCK_ANOMALY_REASON };
  if (wallEnd < start) return { ok: false, reason: 'ends before it starts' };
  const recorded = span.duration_ms;
  const hasDuration = recorded !== undefined && recorded !== null;
  if (hasDuration && !(Number.isFinite(recorded) && recorded >= 0)) {
    return { ok: false, reason: 'duration_ms is not a non-negative number' };
  }
  const ms = hasDuration ? recorded : wallEnd - start;
  if (start + ms > MAX_TIME_MS) return { ok: false, reason: 'duration_ms puts the end of the span out of range' };
  if (attrs.last_message_ts === undefined || attrs.last_message_ts === null) {
    return { ok: true, start, end: start + ms, lingerMs: 0 };
  }
  const lastMessage = parseMs(attrs.last_message_ts);
  if (!Number.isFinite(lastMessage) || lastMessage < start || lastMessage > wallEnd) {
    return { ok: false, reason: 'last_message_ts is not a time within the span' };
  }
  // A wall-clock time can only be placed on a span whose two clocks agree.
  if (Math.abs(wallEnd - start - ms) > CLOCK_SKEW_TOLERANCE_MS) {
    return { ok: false, reason: 'last_message_ts cannot be placed: the span\'s wall-clock length and its recorded duration disagree' };
  }
  return { ok: true, start, end: lastMessage, lingerMs: wallEnd - lastMessage };
}

/**
 * Whether the wall-clock timestamps of the review's own spans still agree with the recorder's durations, so spans can
 * be placed against each other. `{ok: false, reason}` names the first span whose wall-clock length differs from its
 * `duration_ms` by more than CLOCK_SKEW_TOLERANCE_MS.
 */
function timelineOf(spans) {
  for (const span of spans) {
    if (span.name !== STAGES.root && !STAGE_NAMES.includes(span.name)) continue;
    const start = parseMs(span.start_ts);
    const wallMs = parseMs(span.end_ts) - start;
    const recorded = span.duration_ms;
    // A span with no usable recorded duration is reported unusable by intervalOf; it is not blamed on the clock.
    if (!Number.isFinite(wallMs) || !Number.isFinite(recorded) || recorded < 0 || start + recorded > MAX_TIME_MS) continue;
    if (Math.abs(wallMs - recorded) > CLOCK_SKEW_TOLERANCE_MS) {
      const who = AGENT_NAMES.has(span.name) ? `${span.name} ${agentLabel(span)}` : span.name;
      return {
        ok: false,
        reason: `the wall clock stepped against the recorder's monotonic clock: ${who} lasted ${fmtMs(wallMs)} on the wall clock but ${fmtMs(span.duration_ms)} by the recorder, so timestamps cannot place spans against each other`,
      };
    }
  }
  return { ok: true };
}

/**
 * A non-negative integer attr. `toolchain-cli trace start --attr k=v` can only record STRINGS, so a decimal-digit
 * string counts as the integer it spells; anything else (a float, a negative, prose) is not a count.
 */
function asCount(value) {
  if (Number.isInteger(value) && value >= 0) return value;
  if (typeof value === "string" && /^\d{1,15}$/.test(value)) return Number(value);
  return null;
}

function countFigure(value, what) {
  const n = asCount(value);
  return n === null ? missing(`the review span does not record ${what}`) : known(n);
}

/** Union length of [start, end] intervals, each first clipped to [lo, hi]. */
function unionLength(intervals, lo, hi) {
  const clipped = intervals
    .map((i) => [Math.max(i.start, lo), Math.min(i.end, hi)])
    .filter(([s, e]) => e > s)
    .sort((a, b) => a[0] - b[0]);
  let total = 0;
  let curStart = null;
  let curEnd = null;
  for (const [s, e] of clipped) {
    if (curEnd === null || s > curEnd) {
      if (curEnd !== null) total += curEnd - curStart;
      curStart = s;
      curEnd = e;
    } else if (e > curEnd) {
      curEnd = e;
    }
  }
  if (curEnd !== null) total += curEnd - curStart;
  return total;
}

function agentLabel(span) {
  const agent = isObject(span.attrs) ? span.attrs.agent : undefined;
  return isText(agent) ? agent : span.span_id;
}

function roundOf(span) {
  const round = isObject(span.attrs) ? asCount(span.attrs.round) : null;
  return round !== null && round >= 1 ? round : null;
}

/** `interval` cut to `window` ({start, end}); null when nothing of it lies inside (a zero-length span inside the window stays one). */
function clipTo(interval, window) {
  if (window === null) return interval;
  const start = Math.max(interval.start, window.start);
  const end = Math.min(interval.end, window.end);
  if (end > start) return { start, end };
  return interval.start === interval.end && end === start ? { start, end } : null;
}

/**
 * Slowest usable span of `spans` as a step figure, with the interval it occupies (cut to `window` when one is given);
 * a missing step when none was recorded or none is usable. A span that is unusable (unfinished, inconsistent) makes the
 * step a lower bound; so does a cut (`clippedMs`: how much of the winning span lay outside the window). A span wholly
 * outside the window is left out: it cannot change a figure measured inside it.
 */
function slowestStep(stage, spans, window = null) {
  if (spans.length === 0) return { step: { stage, ...missing(`no ${stage} span recorded`) }, interval: null };
  let best = null;
  let unusable = 0;
  for (const span of spans) {
    const found = intervalOf(span);
    if (!found.ok) {
      unusable += 1;
      continue;
    }
    const interval = clipTo(found, window);
    if (interval === null) continue;
    const ms = interval.end - interval.start;
    if (best === null || ms > best.ms) best = { ms, span, interval, cutMs: found.end - found.start - ms };
  }
  if (best === null) {
    const reason = `every ${stage} span is unusable (unfinished, inconsistent or outside the window)`;
    return { step: { stage, ...missing(reason) }, interval: null };
  }
  const extra = {
    ...(best.span.name !== STAGES.verdict ? { name: agentLabel(best.span) } : {}),
    ...(unusable > 0 ? { unusable } : {}),
    ...(unusable > 0 || best.cutMs > 0 ? { lowerBound: true } : {}),
    ...(best.cutMs > 0 ? { clippedMs: best.cutMs } : {}),
  };
  return { step: { stage, ...known(best.ms, extra) }, interval: best.interval };
}

const CHAIN = Object.freeze(['reviewer', 'verifier', 'verdict']);

/** The first adjacent pair of `chain` ([{label, interval}], in the order the steps must run) that overlaps or runs backwards. */
function firstOverlap(chain) {
  for (let i = 1; i < chain.length; i += 1) {
    if (chain[i].interval.start < chain[i - 1].interval.end) return [chain[i - 1], chain[i]];
  }
  return null;
}

function overlapReason([previous, next]) {
  const by = fmtMs(previous.interval.end - next.interval.start);
  return `${next.label} starts ${by} before ${previous.label} ends: the steps overlap or run out of order, so their lengths cannot be summed`;
}

/** Why a round has no total: each missing step with its own reason, and what a missing verifier usually means. */
function gapReason(gaps) {
  return gaps
    .map((s) => `${s.stage}: ${s.reason}${s.stage === 'verifier' && s.reason.startsWith('no ') ? ' (a Quick review dispatches none)' : ''}`)
    .join('; ');
}

/**
 * The critical path: per round the slowest reviewer, then the slowest verifier, then the verdict, summed over the rounds.
 * It needs a usable orchestrator window, and each step is cut to it (a cut is flagged on the step). The steps must follow
 * one another: a step that starts before the one before it ends, a round with two verdict spans (which one ends the
 * chain is not known) or a timeline the wall clock stepped through has no total, because summing overlapping steps
 * would count the same minutes twice and could exceed the window. The verdict is counted here once (orchestrator-only
 * time leaves it out).
 */
function criticalPath(spans, warnings, { window, windowReason, timeline }) {
  const byStage = Object.fromEntries(CHAIN.map((stage) => [stage, spans.filter((s) => s.name === STAGES[stage])]));
  const all = CHAIN.flatMap((stage) => byStage[stage]);
  if (all.length === 0) {
    return { ...missing('no reviewer, verifier or verdict span recorded'), rounds: [] };
  }
  const numbered = all.filter((s) => roundOf(s) !== null).length;
  if (numbered > 0 && numbered < all.length) {
    warnings.push('some reviewer/verifier/verdict spans carry a round and some do not; the unnumbered ones are one extra group');
  }
  const keys = [...new Set(all.map(roundOf))].sort((a, b) => (a === null ? 1 : b === null ? -1 : a - b));
  const labelOf = (round) => (round === null ? '(unnumbered)' : round);
  const chains = [];
  // Cutting a step to the window presumes timestamps that agree with the recorder; on a stepped timeline the steps are only measured.
  const cutTo = timeline.ok ? window : null;
  const rounds = keys.map((round) => {
    const picks = CHAIN.map((stage) => slowestStep(stage, byStage[stage].filter((s) => roundOf(s) === round), cutTo));
    const steps = picks.map((p) => p.step);
    const gaps = steps.filter((s) => s.missing);
    if (gaps.length > 0) return { round, steps, ...missing(gapReason(gaps)) };
    const verdicts = byStage.verdict
      .filter((s) => roundOf(s) === round)
      .map(intervalOf)
      .filter((found) => found.ok && clipTo(found, cutTo) !== null).length;
    if (verdicts > 1) {
      return { round, steps, ...missing(`${verdicts} verdict spans recorded in the round; which one ends the chain is not known`) };
    }
    if (window === null) return { round, steps, ...missing(windowReason) };
    if (!timeline.ok) return { round, steps, ...missing(timeline.reason) };
    const chain = picks.map((p, i) => ({ label: CHAIN[i], interval: p.interval }));
    const overlap = firstOverlap(chain);
    if (overlap) return { round, steps, ...missing(overlapReason(overlap)) };
    chains.push(chain.map((step) => ({ ...step, label: `round ${labelOf(round)} ${step.label}` })));
    const lowerBound = steps.some((s) => s.lowerBound);
    return { round, steps, ...known(steps.reduce((n, s) => n + s.ms, 0), lowerBound ? { lowerBound: true } : {}) };
  });
  const gaps = rounds.filter((r) => r.missing);
  if (gaps.length > 0) {
    return { ...missing(`round ${gaps.map((r) => labelOf(r.round)).join(', ')}: ${gaps[0].reason}`), rounds };
  }
  // A head change restarts the whole chain, so no round may overlap another. Rounds are taken in time order, not by
  // their `round` number: spans without one are one extra group whose place in the sequence is not known.
  const overlap = firstOverlap(chains.sort((a, b) => a[0].interval.start - b[0].interval.start).flat());
  if (overlap) return { ...missing(overlapReason(overlap)), rounds };
  const lowerBound = rounds.some((r) => r.lowerBound);
  return { ...known(rounds.reduce((n, r) => n + r.ms, 0), lowerBound ? { lowerBound: true } : {}), rounds };
}

function stageTable(spans) {
  const table = {};
  for (const name of STAGE_NAMES) {
    const own = spans.filter((s) => s.name === name);
    const usable = own.map(intervalOf).filter((i) => i.ok).map((i) => i.end - i.start);
    if (own.length === 0) {
      table[name] = { count: 0, ...missing('no span recorded') };
    } else if (usable.length === 0) {
      table[name] = { count: own.length, ...missing('every span is unusable (unfinished or inconsistent)') };
    } else {
      const unusable = own.length - usable.length;
      table[name] = {
        count: own.length,
        ...known(Math.max(...usable), unusable > 0 ? { lowerBound: true, unusable } : {}),
      };
    }
  }
  return table;
}

/**
 * Compute the review timing from a materialized trace.
 *
 * @param {object[]|{spans: object[], runId?: string, warnings?: string[]}} input
 *   a `readTrace()` result, or just its `spans`.
 * @returns {object} `{ ok: false, reason }` for input that is not a span list, else
 *   `{ ok: true, runId, wall, turns, toolCalls, agents, activeMs, orchestratorOnly,
 *      beforeFirstDispatch, criticalPath, stages, warnings }`. Every figure is
 *   `{ms, missing: false}` or `{ms: null, missing: true, reason}`.
 */
function computeReviewTiming(input) {
  const spans = Array.isArray(input) ? input : isObject(input) ? input.spans : undefined;
  if (!Array.isArray(spans)) return { ok: false, reason: 'spans must be an array of run-trace spans' };
  const bad = spans.findIndex((s) => !isObject(s) || !isText(s.name) || !isText(s.start_ts));
  if (bad !== -1) return { ok: false, reason: `spans[${bad}] is not a run-trace span (name and start_ts are required)` };

  const warnings = isObject(input) && Array.isArray(input.warnings) ? [...input.warnings] : [];
  const runId = (isObject(input) && input.runId) || (spans[0] && spans[0].run_id) || null;

  // --- the orchestrator window ---
  const roots = spans.filter((s) => s.name === STAGES.root);
  let wall;
  let window = null;
  let rootSpan = null;
  if (roots.length === 0) {
    wall = missing(`no '${STAGES.root}' span recorded (the orchestrator window)`);
  } else if (roots.length > 1) {
    wall = missing(`${roots.length} '${STAGES.root}' spans recorded; one orchestrator window per trace is required`);
  } else {
    rootSpan = roots[0];
    const interval = intervalOf(rootSpan);
    if (!interval.ok) {
      wall = missing(`the '${STAGES.root}' span is unusable: ${interval.reason}`);
    } else {
      window = interval;
      wall = known(interval.end - interval.start, {
        start: new Date(interval.start).toISOString(),
        end: new Date(interval.end).toISOString(),
      });
    }
  }
  const rootAttrs = rootSpan && isObject(rootSpan.attrs) ? rootSpan.attrs : {};
  const turns = rootSpan ? countFigure(rootAttrs.turns, 'turns') : missing('no review span recorded');
  const toolCalls = rootSpan ? countFigure(rootAttrs.tool_calls, 'tool_calls') : missing('no review span recorded');

  // --- dispatched agents ---
  const agentSpans = spans.filter((s) => AGENT_NAMES.has(s.name));
  const usable = [];
  const unusable = [];
  for (const span of agentSpans) {
    const interval = intervalOf(span);
    if (interval.ok) usable.push({ span, ...interval });
    else unusable.push({ span, reason: interval.reason });
  }
  const byRole = {};
  for (const role of AGENT_ROLES) {
    const own = agentSpans.filter((s) => s.name === STAGES[role]);
    byRole[role] = { count: own.length, slowest: slowestStep(role, own).step };
  }
  const agents = {
    count: agentSpans.length,
    // The idle time after each usable agent's last message that no figure counts (correction C01).
    lingerMs: usable.reduce((n, u) => n + u.lingerMs, 0),
    unusable: unusable.map((u) => ({ stage: u.span.name, name: agentLabel(u.span), reason: u.reason })),
    byRole,
  };

  // --- orchestrator-only time ---
  let activeMs;
  let orchestratorOnly;
  let beforeFirstDispatch;
  const timeline = timelineOf(spans);
  if (agentSpans.length === 0) {
    activeMs = missing('no dispatched-agent span recorded');
    orchestratorOnly = missing('no dispatched-agent span recorded');
    beforeFirstDispatch = missing('no dispatched-agent span recorded');
  } else if (window === null) {
    activeMs = missing(wall.reason);
    orchestratorOnly = missing(wall.reason);
    beforeFirstDispatch = missing(wall.reason);
  } else if (!timeline.ok) {
    activeMs = missing(timeline.reason);
    orchestratorOnly = missing(timeline.reason);
    beforeFirstDispatch = missing(timeline.reason);
  } else {
    const active = unionLength(usable, window.start, window.end);
    // The verdict is a step of the critical path, which counts it: orchestrator time leaves it out so that no minute is
    // counted in both (critical path + orchestrator-only never exceeds the window).
    const verdicts = spans.filter((s) => s.name === STAGES.verdict).map(intervalOf);
    const unusableVerdicts = verdicts.filter((v) => !v.ok).length;
    const covered = unionLength([...usable, ...verdicts.filter((v) => v.ok)], window.start, window.end);
    // An agent or verdict whose end is unknown can only have made the real covered time larger.
    const bound =
      unusable.length > 0 || unusableVerdicts > 0
        ? {
            bound: 'upper',
            ...(unusable.length > 0 ? { unusableAgents: unusable.length } : {}),
            ...(unusableVerdicts > 0 ? { unusableVerdicts } : {}),
          }
        : {};
    activeMs = known(active, unusable.length > 0 ? { bound: 'lower', unusableAgents: unusable.length } : {});
    const only = wall.ms - covered;
    orchestratorOnly = known(only, {
      pct: wall.ms > 0 ? Math.round((only / wall.ms) * 100) : null,
      ...bound,
    });
    const firstStart = Math.min(...agentSpans.map((s) => parseMs(s.start_ts)).filter(Number.isFinite));
    if (!Number.isFinite(firstStart)) {
      beforeFirstDispatch = missing('no dispatched-agent span has a readable start_ts');
    } else if (firstStart > window.end) {
      beforeFirstDispatch = missing('the first dispatch starts after the end of the orchestrator window');
    } else {
      beforeFirstDispatch = known(Math.max(0, firstStart - window.start));
    }
  }

  return {
    ok: true,
    runId,
    wall,
    turns,
    toolCalls,
    agents,
    activeMs,
    orchestratorOnly,
    beforeFirstDispatch,
    criticalPath: criticalPath(spans, warnings, { window, windowReason: wall.reason, timeline }),
    stages: stageTable(spans),
    warnings,
  };
}

function defaultDeps() {
  const runTrace = require('./run-trace');
  return { readTrace: runTrace.readTrace, tracePath: runTrace.tracePath };
}

/**
 * Read `trace-<runId>.jsonl` under `<projectRoot>/.ensemble/state/toolchain/` and compute its
 * review timing. An unreadable or absent trace is `{ ok: false, reason }`, never an empty timing.
 *
 * @param {{runId: string, projectRoot: string}} request
 * @param {{readTrace: Function, tracePath: Function}} [deps] real run-trace by default
 */
function loadReviewTiming(request, deps) {
  if (!isObject(request) || !isText(request.runId) || !isText(request.projectRoot)) {
    return { ok: false, reason: 'runId and projectRoot are required (non-empty strings)' };
  }
  const io = deps === undefined ? defaultDeps() : deps;
  let file;
  let trace;
  try {
    file = io.tracePath(request.projectRoot, request.runId);
    trace = io.readTrace(file);
  } catch (error) {
    return { ok: false, reason: `cannot read the run trace: ${error && error.message ? error.message : String(error)}` };
  }
  const result = computeReviewTiming({ spans: trace.spans, runId: request.runId, warnings: trace.warnings });
  return result.ok ? { ...result, tracePath: file } : result;
}

function fmtMs(ms) {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  return `${m}m${String(Math.round(s - m * 60)).padStart(2, '0')}s`;
}

function fmtFigure(figure) {
  if (figure.missing) return `MISSING (${figure.reason})`;
  const tags = [];
  if (figure.lowerBound || figure.bound === 'lower') tags.push('lower bound');
  if (figure.bound === 'upper') tags.push('upper bound');
  return `${fmtMs(figure.ms)}${figure.pct !== undefined && figure.pct !== null ? ` (${figure.pct}%)` : ''}${tags.length ? ` [${tags.join(', ')}]` : ''}`;
}

/** Human-readable report for a `computeReviewTiming` result. */
function formatReviewTiming(timing) {
  if (!timing || timing.ok !== true) return `Review timing unavailable: ${timing && timing.reason ? timing.reason : 'no result'}`;
  const out = [];
  out.push(`Review timing${timing.runId ? ` for run ${timing.runId}` : ''}`);
  out.push(`  wall (orchestrator window):  ${fmtFigure(timing.wall)}`);
  out.push(`  orchestrator turns:          ${timing.turns.missing ? `MISSING (${timing.turns.reason})` : timing.turns.ms}`);
  out.push(`  orchestrator tool calls:     ${timing.toolCalls.missing ? `MISSING (${timing.toolCalls.reason})` : timing.toolCalls.ms}`);
  out.push(`  agents active (union):       ${fmtFigure(timing.activeMs)}`);
  out.push(`  orchestrator-only:           ${fmtFigure(timing.orchestratorOnly)}`);
  out.push(`  before first dispatch:       ${fmtFigure(timing.beforeFirstDispatch)}`);
  out.push(`  critical path:               ${fmtFigure(timing.criticalPath)}`);
  for (const round of timing.criticalPath.rounds) {
    const steps = round.steps
      .map((s) => `${s.stage} ${s.missing ? 'MISSING' : `${fmtMs(s.ms)}${s.name ? ` (${s.name})` : ''}${s.lowerBound ? ' [lower bound]' : ''}${s.clippedMs ? ` [cut to the window by ${fmtMs(s.clippedMs)}]` : ''}`}`)
      .join(' -> ');
    const why = round.missing && round.steps.every((s) => !s.missing) ? `  [MISSING: ${round.reason}]` : '';
    out.push(`    round ${round.round === null ? '(unnumbered)' : round.round}: ${steps}${why}`);
  }
  out.push(`  dispatched agents: ${timing.agents.count} (${timing.agents.unusable.length} unusable)`);
  if (timing.agents.lingerMs > 0) out.push(`  idle linger after the agents' last messages, not counted: ${fmtMs(timing.agents.lingerMs)}`);
  out.push('  slowest per stage:');
  for (const name of STAGE_NAMES) {
    const row = timing.stages[name];
    out.push(`    ${name.padEnd(22)} ${String(row.count).padStart(3)} span(s)  ${row.missing ? `MISSING (${row.reason})` : fmtFigure(row)}`);
  }
  for (const warning of timing.warnings) out.push(`  warning: ${warning}`);
  return out.join('\n');
}

/**
 * Script entry: `node pr-review-timing.js <runId> [--cwd <projectRoot>] [--json]` prints the report for one trace
 * (text by default). Exit 0 when a timing was computed (missing figures are reported, not errors), 1 when it could not be.
 *
 * @param {string[]} argv process.argv.slice(2)
 * @param {{out?: (text: string) => void, deps?: object}} [io]
 * @returns {number} exit code
 */
function main(argv, io = {}) {
  const out = io.out || ((text) => process.stdout.write(text));
  let runId;
  let cwd = process.cwd();
  let json = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') json = true;
    else if (arg === '--cwd' && i + 1 < argv.length) cwd = argv[(i += 1)];
    else if (!arg.startsWith('--') && runId === undefined) runId = arg;
    else {
      out(`Unexpected argument ${JSON.stringify(arg)}. Usage: node pr-review-timing.js <runId> [--cwd <projectRoot>] [--json]\n`);
      return 1;
    }
  }
  if (runId === undefined) {
    out('Usage: node pr-review-timing.js <runId> [--cwd <projectRoot>] [--json]\n');
    return 1;
  }
  const result = loadReviewTiming({ runId, projectRoot: cwd }, io.deps);
  out(json ? `${JSON.stringify(result)}\n` : `${formatReviewTiming(result)}\n`);
  return result.ok ? 0 : 1;
}

module.exports = {
  AGENT_ROLES,
  STAGES,
  STAGE_KINDS,
  intervalOf,
  computeReviewTiming,
  loadReviewTiming,
  formatReviewTiming,
  main,
};

if (require.main === module) process.exit(main(process.argv.slice(2)));
