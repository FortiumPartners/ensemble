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
 * critical path is then computed per round and summed. An agent span MAY carry an integer attr `wave` (1.., numbered per
 * round, within the review agents and, apart, within the verifiers): a round's agents are dispatched in waves of at most
 * `maxConcurrentAgents`, all the agents of a wave together and a wave only once the one before it was collected, so the
 * waves run one after another (see the critical path). `trace start --attr k=v` records strings, so
 * a decimal string counts as the integer it spells (`turns`, `tool_calls`, `round` and `wave`). Agent spans carry `agent` (a name)
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
 * orchestrator window (a cut is flagged on the step: `clippedMs`, `lowerBound`; an overshoot of one millisecond or less is
 * the rounding of the stamps, not a cut: `start_ts` is whole milliseconds and `readTrace` rounds each duration to one, so
 * the verdict, which ends an instant before the root does, can seem to end after it), summed over the rounds. A stage dispatched
 * in several waves (spans that name different `wave`s) is one step PER WAVE, that wave's slowest span, because the waves ran
 * one after another: review waves of 40 s and 20 s are 60 s of the chain, never the 40 s of the one slowest reviewer. The
 * step then carries its `wave`; a stage in one wave, or in spans that name none, is one step as ever, and spans that name
 * none beside spans that do are one extra wave, with a warning. A recorder that dispatches in waves must name them: spans
 * that name none cannot be told apart, so agents that ran in several waves under such a recorder are measured as one (a
 * shorter chain than the real one, with nothing here to say so). It must also dispatch the agents of a wave together: spans
 * that carry ONE wave number but start further apart than CLOCK_SKEW_TOLERANCE_MS are the spans of more than one wave
 * under a mis-stamped number, and that step is MISSING and names the wave (one slowest span of them would pass a shorter
 * chain off as the whole). VERIFY REFILLS (kata 630v): `review-run` may dispatch verifiers into slots a wave freed while the wave
 * still runs; those spans carry the attrs `refill` (true), `cap` and `running` (the agents of earlier waves it left running), and the
 * review span carries `max_concurrent_agents`. When no wave number is stamped on spans dispatched apart, the numbering agrees with the
 * times, every wave that overlaps an earlier one is marked on every span and its facts bear out (`cap` equal to the review span's,
 * `running` plus its own agents within `cap`, no more earlier spans running at its start than `running`, never more spans at once than
 * the cap), the verifier stage is ONE step, `rolling: true`, the time at least one verifier ran (the union, so a gap between
 * dispatches is not counted), with `waves` counting the waves. Otherwise the marks explain nothing: a warning says why and the waves
 * are read one after another as above. Only the verifier stage rolls. HONEST LIMIT: the steps are reviewers, verifiers and the verdict, as the contract says, so the
 * security lane (or the classifier, or the second assessor) is never a step. The chain is then a lower bound whenever such an
 * agent may have lengthened it, and the round says which: `outlasted` lists each one that ended after the slowest reviewer
 * of its wave (an agent naming no wave, or a wave no reviewer step has, is compared with the last reviewer step), with the
 * excess `byMs`, or the reason its length is unknown (`unusable`); `uncountedWaves` lists the numbered waves in which no
 * reviewer ran (the lane alone in a wave, which a small cap makes), which no step counts at all. Either sets `lowerBound`,
 * so a shorter chain is not passed off as the whole. The critical path
 * needs a usable orchestrator window. The total is missing when ANY step is missing (a wave whose every span is unusable
 * is a missing step that names the wave), when a round has more than one verdict span (which one ends the chain is not
 * known), and when the steps overlap or run out of order (each wave must end before the next starts, the last reviewer wave
 * before the first verifier wave, the last verifier wave before the verdict, each round before the next): overlapping
 * steps would count the same minutes twice, so they are never summed. A `review.verdict` span that ends with status `error`
 * is a verdict that was not recorded (a recorder whose attempt failed, then retried, ends the failed one that way): it is no
 * verdict, so it is neither the verdict step nor a second verdict, and a round whose every verdict span ended in error has
 * no verdict (MISSING).
 *
 * AGENT STATS AND HOST LOAD (kata nj2d, plan v2 section 5 child V2-1). The answer's `agentStats` reports, per agent span and by role, what the
 * dispatcher supplied at `collect` (`review-run`'s `agentStats` payload, which `recordWave` stamps on the agent span's END attrs): `tool_calls`,
 * `turns`, `effort`, `model`, `retries` and `rate_limits`, each with an optional `<attr>_reason` when the dispatcher could not supply it. A figure
 * that was not stamped is `{ missing, reason }` (the dispatcher's reason, else that none was supplied, that the span is unfinished, or what the attr
 * holds instead), NEVER 0, and the by-role aggregates are `lowerBound` while any agent has none. The rows are compact (`null` plus `without`, the
 * agents lacking a figure grouped by reason) because the answer leaves through `process.exit` and a pipe holds only 64 KiB on macOS. `hostLoad` is the
 * 1-minute load average from the samples `lib/pr-review-load.js` appends beside the trace (`io.readLoad`), over the orchestrator window and, per
 * agent, while it ran; no sample is `{ missing: true, reason }`. Nothing read here is a session file, and none of it enters the window, the critical
 * path or a verdict: the existing keys, and their order, are unchanged, and `hostLoad` and `agentStats` come last, in that order.
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
/** The resolution of the stamps: `start_ts` is whole milliseconds and `readTrace` rounds each `duration_ms` to one, so a span's end, placed from them, is a millisecond off at most, either way. */
const WALL_CLOCK_RESOLUTION_MS = 1;
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

/** The wave an agent span was dispatched in (attr `wave`, 1..), or null when it names none. */
function waveOf(span) {
  const wave = isObject(span.attrs) ? asCount(span.attrs.wave) : null;
  return wave !== null && wave >= 1 ? wave : null;
}

/** Orders numbers ascending and the unnumbered (null) last. */
const nullLast = (a, b) => (a === null ? 1 : b === null ? -1 : a - b);

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
 * step a lower bound; so does a cut (`clippedMs`: how much of the winning span lay outside the window; up to
 * WALL_CLOCK_RESOLUTION_MS it is rounding and not a cut). A span wholly outside the window is left out: it cannot change a
 * figure measured inside it.
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
    if (best === null || ms > best.ms) {
      const cutMs = found.end - found.start - ms;
      best = { ms, span, interval, cutMs: cutMs <= WALL_CLOCK_RESOLUTION_MS ? 0 : cutMs };
    }
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

/** A step's name in a report: its stage, and its wave when its stage was dispatched in several. */
function stepLabel(step) {
  if (step.wave === undefined) return step.stage;
  return step.wave === null ? `${step.stage} (unnumbered wave)` : `${step.stage} wave ${step.wave}`;
}

/** How far apart the first and the last start of `spans` lie (0 when fewer than two have a readable `start_ts`). */
function startSpread(spans) {
  const starts = spans.map((s) => parseMs(s.start_ts)).filter(Number.isFinite);
  return starts.length < 2 ? 0 : Math.max(...starts) - Math.min(...starts);
}

/** A verifier span of a refill wave (`review-run` dispatched it while agents of an earlier wave were still running). */
const isRefill = (span) => isObject(span.attrs) && (span.attrs.refill === true || span.attrs.refill === 'true');

/**
 * The verifier stage of a round that was dispatched in overlapping waves (kata 630v): a refill wave starts while the wave before
 * it is still running, so the waves do not run one after another and the stage is ONE step: the time at least one verifier was
 * running (the UNION of their intervals, so an idle gap between two dispatches is not counted as verification, as it is not in the
 * per-wave reading), with every wave's spans counted. Its interval, for the chain's order check, is the envelope from the first
 * start to the last end. Nothing is summed per wave, which would count the overlap twice. An unusable span makes the step a lower
 * bound, as it does elsewhere; none usable is a missing step.
 */
function rollingStep(stage, spans, window) {
  const intervals = [];
  let unusable = 0;
  let cut = false;
  for (const span of spans) {
    const found = intervalOf(span);
    if (!found.ok) {
      unusable += 1;
      continue;
    }
    const interval = clipTo(found, window);
    if (interval === null) continue;
    if (found.end - found.start - (interval.end - interval.start) > WALL_CLOCK_RESOLUTION_MS) cut = true;
    intervals.push(interval);
  }
  if (intervals.length === 0) {
    return { label: stage, wave: null, step: { stage, ...missing(`every ${stage} span is unusable (unfinished, inconsistent or outside the window)`) }, interval: null };
  }
  const start = Math.min(...intervals.map((i) => i.start));
  const end = Math.max(...intervals.map((i) => i.end));
  const waves = new Set(spans.map(waveOf)).size;
  const extra = { rolling: true, waves, ...(unusable > 0 ? { unusable } : {}), ...(unusable > 0 || cut ? { lowerBound: true } : {}) };
  return { label: stage, wave: null, step: { stage, ...known(unionLength(intervals, start, end), extra) }, interval: { start, end } };
}

/**
 * Why the verifier waves of a round are NOT the refill the runner makes, or null when the rolling reading is sound (kata 630v,
 * review rounds 1 and 2). The same guards as the per-wave reading come first, because the rolling reading must not be a way
 * round them: a wave number stamped on spans dispatched apart (more than the clock tolerance) is not one wave, and the numbering
 * must agree with the times (a wave never starts before a lower-numbered one). Then every marked wave must carry the facts the
 * runner records on a refill (`refill`, `cap`, `running`: the agents of earlier waves it left running) on EVERY span, with the
 * same `cap` as the review span's `max_concurrent_agents` (the reader cannot trust a cap the marks declare themselves), `running`
 * plus its own agents within `cap`, and no more earlier-wave spans still running at its start than `running` says. A wave that
 * starts before an earlier one ended must be marked, whatever else it carries; one marked span among unmarked overlapping waves
 * therefore explains nothing. Past that, at no moment may more verifier spans run than the cap. A span that ended `expired` is
 * left out of the counts: the dispatcher stops an agent at its deadline, and the span only ends when its wave is collected.
 */
function refillOverlapProblem(spans, rootCap) {
  const waves = new Map();
  for (const span of spans) {
    const wave = waveOf(span);
    if (wave === null) return 'some verifier spans name no wave';
    waves.set(wave, [...(waves.get(wave) || []), span]);
  }
  const usable = (list) => list.map((span) => ({ span, found: intervalOf(span) })).filter((entry) => entry.found.ok);
  const ordered = [...waves.keys()].sort((a, b) => a - b).map((wave) => ({ wave, entries: usable(waves.get(wave)), all: waves.get(wave) }));
  const live = (entry) => entry.span.status !== 'expired';
  for (const w of ordered) {
    const spread = startSpread(w.all);
    if (spread > CLOCK_SKEW_TOLERANCE_MS) return `verifier wave ${w.wave}: its spans start ${fmtMs(spread)} apart, more than the ${fmtMs(CLOCK_SKEW_TOLERANCE_MS)} within which the agents of one wave are dispatched, so the wave number is stamped on spans of more than one wave`;
  }
  let before = null;
  for (const w of ordered) {
    if (w.entries.length === 0) continue;
    const first = Math.min(...w.entries.map((e) => e.found.start));
    if (before !== null && first < before.start) return `verifier wave ${w.wave} starts before verifier wave ${before.wave}: the wave numbers disagree with the times`;
    before = { wave: w.wave, start: first };
  }
  if (rootCap === null) return 'the review span records no max_concurrent_agents to check the refill marks against';
  for (let i = 0; i < ordered.length; i += 1) {
    const own = ordered[i];
    const marked = own.all.filter(isRefill).length;
    const earlier = ordered.slice(0, i).flatMap((w) => w.entries);
    const start = own.entries.length === 0 ? null : Math.min(...own.entries.map((e) => e.found.start));
    const overlaps = i > 0 && start !== null && earlier.length > 0 && start < Math.max(...earlier.map((e) => e.found.end));
    const label = `verifier wave ${own.wave}`;
    if (marked < own.all.length && (overlaps || marked > 0)) {
      return overlaps ? `${label} overlaps an earlier wave and not every one of its spans is marked as a refill` : `${label} is marked as a refill on some of its spans only`;
    }
    if (marked === 0) continue;
    const casts = own.all.map((s) => ({ cap: asCount(s.attrs.cap), running: asCount(s.attrs.running) }));
    const { cap, running } = casts[0];
    if (cap === null || cap < 1 || running === null || casts.some((c) => c.cap !== cap || c.running !== running)) return `${label} is a refill without a readable, single cap and running count`;
    if (running + own.all.length > cap) return `${label} left ${running} agents running and dispatched ${own.all.length}: more than its cap of ${cap}`;
    if (cap !== rootCap) return `${label} declares a cap of ${cap} but the review span records ${rootCap}`;
    if (start !== null) {
      const active = earlier.filter((e) => live(e) && e.found.start <= start && e.found.end > start).length;
      if (active > running) return `${label} left ${running} agents running but ${active} earlier verifier spans were still running when it started`;
    }
  }
  const events = ordered.flatMap((w) => w.entries).filter(live).flatMap((e) => [[e.found.start, 1], [e.found.end, -1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let now = 0;
  for (const [, delta] of events) {
    now += delta;
    if (now > rootCap) return `${now} verifier spans ran at once, more than the cap of ${rootCap}`;
  }
  return null;
}

/**
 * The steps one stage contributes to a round's chain, each `{label, wave, step, interval}`. A stage dispatched in several
 * waves is one step per wave (that wave's slowest span), in wave order, because the waves ran one after another; a stage in
 * one wave, or in spans that name none, is one step as ever. Spans that name no wave beside spans that do are one extra
 * wave, last, with a warning. The agents of a wave are dispatched together, so spans that carry one wave number but start
 * further apart than the clock tolerance are not one wave: the number was stamped on spans of several, one slowest span of
 * them would pass a shorter chain off as the whole, and the step is MISSING and names the wave. Spans that name no wave
 * are not checked (a narrated dispatch staggers its agents). `rootCap` is the review span's `max_concurrent_agents` (null when it
 * records none): the verifier stage is read as rolling only when its refill marks are sound against it (refillOverlapProblem).
 */
function stagePicks(stage, spans, window, warnings, roundLabel, rootCap = null) {
  if (stage === 'verifier' && spans.some(isRefill)) {
    const problem = refillOverlapProblem(spans, rootCap);
    if (problem === null) return [rollingStep(stage, spans, window)];
    warnings.push(`round ${roundLabel}: the verifier refill marks do not explain the overlap (${problem}); the waves are read as one after another`);
  }
  const waves = [...new Set(spans.map(waveOf))].sort(nullLast);
  if (waves.length > 1 && waves.includes(null)) warnings.push(`round ${roundLabel}: some ${stage} spans carry a wave and some do not; the unnumbered ones are one extra wave`);
  if (waves.length === 0) return [{ label: stage, wave: null, ...slowestStep(stage, spans, window) }];
  return waves.map((wave) => {
    const own = spans.filter((s) => waveOf(s) === wave);
    const several = waves.length > 1;
    const spread = wave === null ? 0 : startSpread(own);
    if (spread > CLOCK_SKEW_TOLERANCE_MS) {
      const reason = `its spans start ${fmtMs(spread)} apart, more than the ${fmtMs(CLOCK_SKEW_TOLERANCE_MS)} within which the agents of one wave are dispatched, so the wave number is stamped on spans of more than one wave`;
      const step = { stage, wave, ...missing(reason) };
      return { label: stepLabel(step), wave, step, interval: null };
    }
    const picked = slowestStep(stage, own, window);
    const step = several ? { ...picked.step, wave } : picked.step;
    return { label: several ? stepLabel(step) : stage, wave, step, interval: picked.interval };
  });
}

/** The role of a dispatched-agent span (`review.security-lane` -> `security-lane`). */
const roleOf = (span) => AGENT_ROLES.find((role) => STAGES[role] === span.name);

/**
 * The agents of a round that are no step of its chain (the security lane, the classifier, the second assessor) and that the
 * chain may therefore understate, from the round's reviewer steps (`picks`, every one with an interval):
 *   uncountedWaves  numbered waves in which no reviewer ran, so no step counts them (a cap of 2 on two reviewers and the lane
 *                   leaves the lane alone in wave 2);
 *   outlasted       agents that ended after the slowest reviewer of their wave, `{stage, name, wave?, byMs}`: the next step
 *                   waited for them, and no step counts the excess. An agent that names no wave, or whose wave has no
 *                   reviewer step, is compared with the end of the last reviewer step; one whose length is unknown is
 *                   listed with its `unusable` reason, since it may have outlasted them.
 * The chain stays the contract's (slowest reviewer, slowest verifier, verdict); this says when it is a lower bound.
 */
function unsteppedAgents(spans, round, picks, window) {
  const lastEnd = Math.max(...picks.map((p) => p.interval.end));
  const waves = new Set();
  const outlasted = [];
  for (const span of spans) {
    const role = roleOf(span);
    if (role === undefined || role === 'reviewer' || role === 'verifier' || roundOf(span) !== round) continue;
    const wave = waveOf(span);
    const own = picks.find((p) => p.wave === wave);
    if (own === undefined && wave !== null) {
      waves.add(wave);
      continue;
    }
    const who = { stage: role, name: agentLabel(span), ...(wave === null ? {} : { wave }) };
    const found = intervalOf(span);
    if (!found.ok) {
      outlasted.push({ ...who, unusable: found.reason });
      continue;
    }
    const inside = clipTo(found, window);
    const reference = own === undefined ? lastEnd : own.interval.end;
    if (inside !== null && inside.end > reference) outlasted.push({ ...who, byMs: inside.end - reference });
  }
  return { uncountedWaves: [...waves].sort((a, b) => a - b), outlasted };
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
    .map((s) => `${stepLabel(s)}: ${s.reason}${s.stage === 'verifier' && s.reason.startsWith('no ') ? ' (a Quick review dispatches none); nor does a round where no candidate needed verification (none raised, or every one kept a carried verdict)' : ''}`)
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
  // the concurrency cap the runner recorded on the review span (prepare/collect), against which refill marks are checked
  const rootSpan = spans.find((s) => s.name === STAGES.root);
  const rootCapValue = rootSpan !== undefined && isObject(rootSpan.attrs) ? asCount(rootSpan.attrs.max_concurrent_agents) : null;
  const rootCap = rootCapValue !== null && rootCapValue >= 1 ? rootCapValue : null;
  const all = CHAIN.flatMap((stage) => byStage[stage]);
  if (all.length === 0) {
    return { ...missing('no reviewer, verifier or verdict span recorded'), rounds: [] };
  }
  const numbered = all.filter((s) => roundOf(s) !== null).length;
  if (numbered > 0 && numbered < all.length) {
    warnings.push('some reviewer/verifier/verdict spans carry a round and some do not; the unnumbered ones are one extra group');
  }
  const keys = [...new Set(all.map(roundOf))].sort(nullLast);
  const labelOf = (round) => (round === null ? '(unnumbered)' : round);
  const chains = [];
  // Cutting a step to the window presumes timestamps that agree with the recorder; on a stepped timeline the steps are only measured.
  const cutTo = timeline.ok ? window : null;
  const rounds = keys.map((round) => {
    const inRound = (stage) => byStage[stage].filter((s) => roundOf(s) === round);
    // A verdict span that ended in error is a verdict that was not recorded (a collect retried after a failed write): no verdict.
    const verdictSpans = inRound('verdict');
    const produced = verdictSpans.filter((s) => s.status !== 'error');
    const verdictPick = produced.length === 0 && verdictSpans.length > 0
      ? { step: { stage: 'verdict', ...missing('every verdict span ended in error: no verdict was recorded') }, interval: null }
      : slowestStep('verdict', produced, cutTo);
    // reviewer waves, then verifier waves, then the verdict: the order the steps must run in
    const reviewerPicks = stagePicks('reviewer', inRound('reviewer'), cutTo, warnings, labelOf(round));
    const picks = [
      ...reviewerPicks,
      ...stagePicks('verifier', inRound('verifier'), cutTo, warnings, labelOf(round), rootCap),
      { label: 'verdict', wave: null, ...verdictPick },
    ];
    const steps = picks.map((p) => p.step);
    const gaps = steps.filter((s) => s.missing);
    if (gaps.length > 0) return { round, steps, ...missing(gapReason(gaps)) };
    const verdicts = produced
      .map(intervalOf)
      .filter((found) => found.ok && clipTo(found, cutTo) !== null).length;
    if (verdicts > 1) {
      return { round, steps, ...missing(`${verdicts} verdict spans recorded in the round; which one ends the chain is not known`) };
    }
    if (window === null) return { round, steps, ...missing(windowReason) };
    if (!timeline.ok) return { round, steps, ...missing(timeline.reason) };
    const chain = picks.map((p) => ({ label: p.label, interval: p.interval }));
    const overlap = firstOverlap(chain);
    if (overlap) return { round, steps, ...missing(overlapReason(overlap)) };
    chains.push(chain.map((step) => ({ ...step, label: `round ${labelOf(round)} ${step.label}` })));
    const { uncountedWaves, outlasted } = unsteppedAgents(spans, round, reviewerPicks, cutTo);
    const lowerBound = uncountedWaves.length > 0 || outlasted.length > 0 || steps.some((s) => s.lowerBound);
    const bounds = { ...(lowerBound ? { lowerBound: true } : {}), ...(uncountedWaves.length > 0 ? { uncountedWaves } : {}), ...(outlasted.length > 0 ? { outlasted } : {}) };
    return { round, steps, ...known(steps.reduce((n, s) => n + s.ms, 0), bounds) };
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

// ---------------------------------------------------------------------------
// What the dispatcher supplied for each agent (kata nj2d), and the host load while the agents ran
// ---------------------------------------------------------------------------

/**
 * The figures a dispatcher may supply for an agent (the span attr, the key of the report, the label of the text report, whether it is a count):
 * `asCount` reads a count (`trace end --attr k=v` records strings), a name is short text.
 */
const AGENT_STATS = Object.freeze([
  { attr: 'tool_calls', key: 'toolCalls', label: 'tool calls', count: true },
  { attr: 'turns', key: 'turns', label: 'turns', count: true },
  { attr: 'effort', key: 'effort', label: 'effort', count: false },
  { attr: 'model', key: 'model', label: 'model', count: false },
  { attr: 'retries', key: 'retries', label: 'retries', count: true },
  { attr: 'rate_limits', key: 'rateLimits', label: '429s', count: true },
]);
/** The longest name figure the report keeps. */
const STAT_TEXT_MAX = 200;
const NO_LOAD_SAMPLES = 'no load samples were read for this trace';

const round2 = (value) => Math.round(value * 100) / 100;
const stat = (value) => ({ value, missing: false });
const noStat = (reason) => ({ value: null, missing: true, reason });

/** A span attr as an error message shows it: bounded. */
function shownAttr(value) {
  const text = JSON.stringify(value);
  if (text === undefined) return String(value);
  return text.length > 40 ? `${text.slice(0, 40)}...` : text;
}

/**
 * One figure of one agent span, from the attr the collect that ended the span stamped. A figure that is not there is `{ value: null, missing:
 * true, reason }`: the dispatcher's own reason when it stamped `<attr>_reason` (it said it could not supply it), else that nobody supplied it;
 * an attr that holds something else than a count (or a name) says what it holds. Never 0: a count of 0 is a figure the dispatcher stamped.
 */
function statOf(span, attr, isCount) {
  const attrs = isObject(span.attrs) ? span.attrs : {};
  const raw = attrs[attr];
  if (raw !== undefined && raw !== null) {
    if (isCount) {
      const n = asCount(raw);
      if (n !== null) return stat(n);
    } else if (isText(raw)) {
      return stat(raw.trim().replace(/\s+/g, ' ').slice(0, STAT_TEXT_MAX));
    }
    return noStat(`the span records ${attr} as ${shownAttr(raw)}, which is not ${isCount ? 'a non-negative integer' : 'a name'}`);
  }
  const why = attrs[`${attr}_reason`];
  if (isText(why)) return noStat(why.trim());
  if (span.end_ts === null || span.status === 'unfinished') return noStat("the agent's span is unfinished: its figures are stamped when its result is collected");
  return noStat(`the dispatcher supplied no ${attr} for this agent at collect`);
}

/** The middle gap between consecutive samples (ms), or null with fewer than two. */
function medianGap(samples) {
  const gaps = samples.slice(1).map((s, i) => s.tsMs - samples[i].tsMs).sort((a, b) => a - b);
  if (gaps.length === 0) return null;
  const mid = Math.floor(gaps.length / 2);
  return Math.round(gaps.length % 2 === 1 ? gaps[mid] : (gaps[mid - 1] + gaps[mid]) / 2);
}

/**
 * The load samples `computeReviewTiming` was given, ready to read: `{ samples (usable, by time), reason }` where `reason` is why there are none.
 * A sample without a finite time or a non-negative number load is left out and counted in `warnings`, never read as a load of 0.
 */
function loadInfoOf(load, warnings) {
  if (!isObject(load)) return { samples: [], reason: NO_LOAD_SAMPLES };
  if (load.ok !== true) return { samples: [], reason: isText(load.reason) ? load.reason : 'the load samples could not be read' };
  const given = Array.isArray(load.samples) ? load.samples : [];
  const samples = given.filter((s) => isObject(s) && Number.isFinite(s.tsMs) && typeof s.load1 === 'number' && Number.isFinite(s.load1) && s.load1 >= 0).sort((a, b) => a.tsMs - b.tsMs);
  if (samples.length < given.length) warnings.push(`${given.length - samples.length} load sample(s) without a usable time or load were left out`);
  if (Array.isArray(load.warnings)) for (const warning of load.warnings) warnings.push(`load: ${warning}`);
  return { samples, reason: samples.length === 0 ? 'the load samples hold no usable sample' : undefined };
}

/**
 * The lowest, the highest and the sum of a list of numbers, by a loop: a sampler that ran for hours leaves a very long list, and a spread of one into
 * Math.min or Math.max is a RangeError (about 125,000 arguments), which would end `timing` instead of reporting the figure.
 */
function extremes(values) {
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  for (const value of values) {
    if (value < min) min = value;
    if (value > max) max = value;
    sum += value;
  }
  return { min, max, sum };
}

/** The host load over the orchestrator window (or over every sample when the window is unknown): the 1-minute average's lowest, mean and highest. */
function hostLoadFigure(info, window) {
  if (info.reason !== undefined) return { missing: true, reason: info.reason };
  const scoped = window === null ? info.samples : info.samples.filter((s) => s.tsMs >= window.start && s.tsMs <= window.end);
  if (scoped.length === 0) return { missing: true, reason: 'no load sample lies inside the orchestrator window' };
  const { min, max, sum } = extremes(scoped.map((s) => s.load1));
  const cpus = [...scoped].reverse().map((s) => s.cpus).find((n) => Number.isInteger(n) && n > 0);
  return {
    missing: false,
    scope: window === null ? 'every sample (the orchestrator window is unknown)' : 'orchestrator window',
    samples: scoped.length,
    load1: { min: round2(min), mean: round2(sum / scoped.length), max: round2(max) },
    cpus: cpus === undefined ? null : cpus,
    intervalMs: medianGap(scoped),
  };
}

/** The highest 1-minute load among the samples taken while one agent ran, or why there is none. */
function agentHostLoad(interval, info) {
  if (info.reason !== undefined) return { missing: true, reason: info.reason };
  if (!interval.ok) return { missing: true, reason: `the agent has no usable interval (${interval.reason})` };
  const inside = info.samples.filter((s) => s.tsMs >= interval.start && s.tsMs <= interval.end);
  if (inside.length === 0) {
    const gap = medianGap(info.samples);
    return { missing: true, reason: `no load sample was taken while this agent ran${gap === null ? '' : ` (the samples are about ${Math.round(gap / 1000)} s apart)`}` };
  }
  let highest = -Infinity;
  for (const s of inside) if (s.load1 > highest) highest = s.load1;
  return { missing: false, samples: inside.length, load1Max: round2(highest) };
}

/** A role's count figures over its agents: how many have one, the total, the lowest and the highest of those, and a lower bound while some agent has none. */
function countAggregate(figures, attr, role) {
  const known = figures.filter((figure) => !figure.missing).map((figure) => figure.value);
  const absent = figures.length - known.length;
  if (known.length === 0) {
    return { known: 0, missing: absent, total: null, min: null, max: null, reason: figures.length === 0 ? 'no agent of this role was recorded' : `none of the ${figures.length} ${role} agent(s) has a ${attr} figure` };
  }
  return { known: known.length, missing: absent, total: known.reduce((sum, n) => sum + n, 0), min: Math.min(...known), max: Math.max(...known), ...(absent > 0 ? { lowerBound: true } : {}) };
}

/** The names a role's agents carry (effort, model), counted by value, with the agents that carry none beside them. */
function nameAggregate(figures) {
  const values = new Map();
  let absent = 0;
  for (const figure of figures) {
    if (figure.missing) absent += 1;
    else values.set(figure.value, (values.get(figure.value) || 0) + 1);
  }
  return { values: Object.fromEntries(values), missing: absent };
}

/** The agents of a role that have no figure of one kind, grouped by the reason: `[{ figure, reason, agents }]`. */
function withoutFigure(key, entries, figureOf) {
  const groups = new Map();
  for (const entry of entries) {
    const figure = figureOf(entry);
    if (figure.missing) groups.set(figure.reason, [...(groups.get(figure.reason) || []), agentLabel(entry.span)]);
  }
  return [...groups].map(([reason, agents]) => ({ figure: key, reason, agents }));
}

/**
 * What the dispatcher supplied for each agent, compactly: one row per agent span (its role, round, wave, length, each figure as its value or null, and the
 * highest load while it ran) and, by role, what the figures add up to and `without`: every agent that has no figure, with the reason, by figure. A null in
 * a row is explained there, or (the load, when no sample was read at all) by the run's `hostLoad`. Pure reading: nothing here moves a wall time, a critical
 * path or an orchestrator-only figure.
 */
function agentStatsOf(agentSpans, info) {
  const entries = agentSpans.map((span) => {
    const interval = intervalOf(span);
    return { span, interval, figures: Object.fromEntries(AGENT_STATS.map(({ attr, key, count }) => [key, statOf(span, attr, count)])), load: agentHostLoad(interval, info) };
  });
  const agents = entries.map(({ span, interval, figures, load }) => ({
    role: roleOf(span),
    name: agentLabel(span),
    round: roundOf(span),
    wave: waveOf(span),
    durationMs: interval.ok ? interval.end - interval.start : null,
    ...Object.fromEntries(AGENT_STATS.map(({ key }) => [key, figures[key].value])),
    hostLoad: load.missing ? null : { samples: load.samples, load1Max: load.load1Max },
  }));
  const byRole = {};
  for (const role of AGENT_ROLES) {
    const own = entries.filter(({ span }) => roleOf(span) === role);
    const aggregate = { count: own.length };
    const without = [];
    for (const { attr, key, count } of AGENT_STATS) {
      const figures = own.map((entry) => entry.figures[key]);
      aggregate[key] = count ? countAggregate(figures, attr, role) : nameAggregate(figures);
      without.push(...withoutFigure(key, own, (entry) => entry.figures[key]));
    }
    // an agent with no load is explained here only when there are samples at all: with none, the run's `hostLoad` says why
    if (info.reason === undefined) without.push(...withoutFigure('hostLoad', own, (entry) => entry.load));
    byRole[role] = { ...aggregate, without };
  }
  return { byRole, agents };
}

/**
 * Compute the review timing from a materialized trace.
 *
 * @param {object[]|{spans: object[], runId?: string, warnings?: string[], load?: {ok: boolean, samples?: object[], warnings?: string[], reason?: string}}} input
 *   a `readTrace()` result, or just its `spans`; `load` is what `pr-review-load.js#readLoadSamples` answers (the host-load samples of the run).
 * @returns {object} `{ ok: false, reason }` for input that is not a span list, else
 *   `{ ok: true, runId, wall, turns, toolCalls, agents, activeMs, orchestratorOnly,
 *      beforeFirstDispatch, criticalPath, stages, warnings, hostLoad, agentStats }`. Every figure is
 *   `{ms, missing: false}` or `{ms: null, missing: true, reason}`; the figures of `agentStats` (what the dispatcher supplied per agent) are
 *   `{value, missing: false}` or `{value: null, missing: true, reason}`, and `hostLoad` is `{missing: false, ...}` or `{missing: true, reason}`.
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

  const result = {
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
  // What the dispatcher supplied per agent and the host load come last: everything above is exactly what it was without them.
  const loadInfo = loadInfoOf(isObject(input) ? input.load : undefined, warnings);
  result.hostLoad = hostLoadFigure(loadInfo, window);
  result.agentStats = agentStatsOf(agentSpans, loadInfo);
  return result;
}

function defaultDeps() {
  const runTrace = require('./run-trace');
  const load = require('./pr-review-load');
  return { readTrace: runTrace.readTrace, tracePath: runTrace.tracePath, readLoad: load.readLoadSamples };
}

/**
 * Read `trace-<runId>.jsonl` under `<projectRoot>/.ensemble/state/toolchain/` and compute its
 * review timing. An unreadable or absent trace is `{ ok: false, reason }`, never an empty timing. The host-load samples beside it
 * (`load-<runId>.jsonl`, written by `pr-review-load.js`) are optional: without them `hostLoad` is missing with the reason.
 *
 * @param {{runId: string, projectRoot: string}} request
 * @param {{readTrace: Function, tracePath: Function, readLoad?: Function}} [deps] real run-trace and load reader by default
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
  let load;
  if (typeof io.readLoad === 'function') {
    try {
      load = io.readLoad(request.projectRoot, request.runId);
    } catch (error) {
      load = { ok: false, reason: `the load samples cannot be read: ${error && error.message ? error.message : String(error)}` };
    }
  }
  const result = computeReviewTiming({ spans: trace.spans, runId: request.runId, warnings: trace.warnings, load });
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

const fmtStat = (value) => (value === null ? 'MISSING' : String(value));

/** The run's host load: the 1-minute average's highest, mean and lowest, or why there is none. */
function fmtHostLoad(load) {
  if (load.missing) return `MISSING (${load.reason})`;
  const apart = load.intervalMs === null ? '' : ` ${Math.round(load.intervalMs / 1000)}s apart`;
  return `max ${load.load1.max.toFixed(2)}, mean ${load.load1.mean.toFixed(2)}, min ${load.load1.min.toFixed(2)} over ${load.samples} sample(s)${apart}${load.cpus === null ? '' : `, ${load.cpus} cpus`}`;
}

/**
 * The agents' figures by role: one line per agent (every figure, or MISSING), what the role adds up to, and why each figure is missing (the
 * `without` of the role). A figure nobody supplied is never printed as 0.
 */
function formatAgentStats(timing) {
  const stats = timing.agentStats;
  if (!isObject(stats) || !Array.isArray(stats.agents) || stats.agents.length === 0) return [];
  const withLoad = isObject(timing.hostLoad) && timing.hostLoad.missing === false;
  const lines = ['  agent figures from the collect payload (a figure nobody supplied is MISSING, never 0):'];
  for (const role of AGENT_ROLES) {
    const rows = stats.agents.filter((row) => row.role === role);
    if (rows.length === 0) continue;
    lines.push(`    ${role} (${rows.length} agent${rows.length === 1 ? '' : 's'})`);
    for (const row of rows) {
      const where = [row.round === null ? null : `round ${row.round}`, row.wave === null ? null : `wave ${row.wave}`].filter(Boolean).join(' ');
      const figures = AGENT_STATS.map(({ key, label }) => `${label} ${fmtStat(row[key])}`).join('  ');
      const load = withLoad ? `  load ${row.hostLoad === null ? 'MISSING' : `max ${row.hostLoad.load1Max.toFixed(2)}`}` : '';
      lines.push(`      ${row.name}  ${where === '' ? '' : `${where}  `}${row.durationMs === null ? 'MISSING' : fmtMs(row.durationMs)}  ${figures}${load}`);
    }
    const aggregate = stats.byRole[role];
    const totals = AGENT_STATS.filter(({ key, count }) => count && aggregate[key].known > 0).map(({ key, label }) => `${label} ${aggregate[key].total}${aggregate[key].lowerBound ? ' or more' : ''} (${aggregate[key].known} of ${aggregate.count} have one)`);
    lines.push(`      totals: ${totals.length > 0 ? totals.join(', ') : 'no count was supplied'}`);
    const groupsOf = (key) => aggregate.without.filter((group) => group.figure === key).length;
    const why = aggregate.without.map((group) => {
      const label = group.figure === 'hostLoad' ? 'load' : AGENT_STATS.find(({ key }) => key === group.figure).label;
      return `${label}: ${group.reason}${group.figure === 'hostLoad' || groupsOf(group.figure) > 1 ? ` (${group.agents.join(', ')})` : ''}`;
    });
    if (why.length > 0) lines.push(`      MISSING: ${why.join('; ')}`);
  }
  return lines;
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
  if (isObject(timing.hostLoad)) out.push(`  host load (1-minute average): ${fmtHostLoad(timing.hostLoad)}`);
  out.push(`  critical path:               ${fmtFigure(timing.criticalPath)}`);
  for (const round of timing.criticalPath.rounds) {
    const steps = round.steps
      .map((s) => `${stepLabel(s)} ${s.missing ? 'MISSING' : `${fmtMs(s.ms)}${s.name ? ` (${s.name})` : ''}${s.lowerBound ? ' [lower bound]' : ''}${s.clippedMs ? ` [cut to the window by ${fmtMs(s.clippedMs)}]` : ''}`}`)
      .join(' -> ');
    const why = round.missing && round.steps.every((s) => !s.missing) ? `  [MISSING: ${round.reason}]` : '';
    const unstepped = [
      ...(Array.isArray(round.uncountedWaves) ? [`no reviewer in review wave ${round.uncountedWaves.join(', ')}, so no step counts it`] : []),
      ...(Array.isArray(round.outlasted)
        ? round.outlasted.map((o) => (o.unusable ? `${o.name} has no usable length (${o.unusable}), so it may have outlasted the reviewers, which no step counts` : `${o.name} ran ${fmtMs(o.byMs)} past the slowest reviewer${o.wave === undefined ? '' : ` of its wave ${o.wave}`}, which no step counts`))
        : []),
    ];
    const lowerBound = unstepped.length > 0 ? `  [lower bound: ${unstepped.join('; ')}]` : '';
    out.push(`    round ${round.round === null ? '(unnumbered)' : round.round}: ${steps}${why}${lowerBound}`);
  }
  out.push(`  dispatched agents: ${timing.agents.count} (${timing.agents.unusable.length} unusable)`);
  if (timing.agents.lingerMs > 0) out.push(`  idle linger after the agents' last messages, not counted: ${fmtMs(timing.agents.lingerMs)}`);
  out.push(...formatAgentStats(timing));
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
