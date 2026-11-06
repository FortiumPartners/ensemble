'use strict';

/**
 * run-trace.js — per-run span recorder and summarizer (kata acvv).
 *
 * Records timing spans for one run (for example one `/ensemble-pr-merge` invocation) to an
 * append-only `trace-<runId>.jsonl` next to the toolchain ledger:
 * `<projectRoot>/.ensemble/state/toolchain/trace-<runId>.jsonl`. The run id is validated with
 * the shared `./toolchain/run-id.js#isValidRunId`, the same charset every other per-run file
 * uses. Reusable by any runner (pr-merge today, a deterministic review-run runner later).
 *
 * File format (one JSON object per line, written with `appendFileSync` so a SIGKILL leaves
 * every already-started span on disk):
 *   {"type":"span_start","run_id","span_id","parent_id"|null,"name","kind","start_ts"(ISO),
 *    "mono_ms"(process.hrtime-based, system-wide monotonic),"attrs":{},"pid"}
 *   {"type":"span_end","run_id","span_id","end_ts","mono_ms","status","attrs":{}}
 * End attrs merge over start attrs when a trace is read.
 *
 * Materialized span (`readTrace`): `{run_id, span_id, parent_id, name, kind, start_ts, end_ts,
 * duration_ms, status, attrs}`. A span_start with no span_end is `status:'unfinished'`,
 * `end_ts:null`, `duration_ms:null`; an end is NEVER invented for it.
 * Duration comes from the monotonic delta when both readings exist, the delta is non-negative
 * and it does not exceed the wall delta by more than `MONO_WALL_SLACK_MS` (a monotonic clock
 * cannot legitimately run ahead of wall time; it can lag it across system sleep); otherwise the
 * wall delta is used. A negative wall delta is clamped to 0. Whenever a clock disagreement is
 * detected `attrs.clock_anomaly` is `true`.
 *
 * Tracing must never break the traced flow: `createTracer` methods never throw. On any failure
 * (invalid run id, unwritable dir, bad clock, unknown span) the tracer calls
 * `onUnavailable(reason)` exactly once per tracer (the single notice) and carries on;
 * `startSpan` still returns a fresh, valid span id.
 *
 * `summarize` math (all integer milliseconds, all derived from wall timestamps so the
 * partition is exact):
 *  - wall = [min start_ts, max observed ts] where observed ts is any end_ts or, for unfinished
 *    spans, the last timestamp seen anywhere in the file (`lastTs`).
 *  - Top-level phases are spans whose parent is null or unknown to the file (unknown parents
 *    are counted as `orphan_spans`). Phase totals come from a sweep line: every instant is
 *    attributed to at most one covering top-level span (the earliest-started), so overlapping
 *    top-level spans never double count. `sum(phase totals) + unaccounted_ms === wall_ms`
 *    exactly; `unaccounted_ms` is wall time covered by no top-level span (largest gaps listed).
 *  - The inclusive per-name table spans ALL spans; nested spans overlap their parents, so its
 *    totals are NOT summable.
 *  - Unfinished spans count as [start, lastTs] and are flagged lower-bound.
 *  - `human_wait_ms` = union of intervals of `kind:'human-wait'` spans; `machine_ms = wall_ms -
 *    human_wait_ms`.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { isValidRunId, invalidRunIdMessage } = require('./toolchain/run-id');

const KINDS = ['phase', 'io', 'agent', 'gate', 'human-wait'];
const MONO_WALL_SLACK_MS = 5000;

const defaultClock = {
  now: () => Date.now(),
  mono: () => Number(process.hrtime.bigint() / 1000n) / 1000
};

/** @returns {string} `<projectRoot>/.ensemble/state/toolchain` (same dir as the ledger). */
function stateDir(projectRoot) {
  return path.join(projectRoot, '.ensemble', 'state', 'toolchain');
}

/** @returns {string} absolute path of `trace-<runId>.jsonl`; throws on an invalid run id. */
function tracePath(projectRoot, runId) {
  if (!isValidRunId(runId)) throw new Error(`trace: ${invalidRunIdMessage(runId)}`);
  return path.join(stateDir(projectRoot), `trace-${runId}.jsonl`);
}

function newSpanId() {
  return crypto.randomBytes(6).toString('hex');
}

function errReason(error) {
  return (error && error.message) || String(error);
}

/**
 * @param {{runId: string, projectRoot: string, clock?: {now: () => number, mono: () => number},
 *   onUnavailable?: (reason: string) => void}} options
 */
function createTracer({ runId, projectRoot, clock = defaultClock, onUnavailable } = {}) {
  let file = null;
  let notified = false;
  let dirReady = false;
  const open = new Set();
  const ended = new Set();

  const unavailable = (reason) => {
    if (notified) return;
    notified = true;
    if (typeof onUnavailable === 'function') {
      try {
        onUnavailable(reason);
      } catch (_) {
        /* a failing notifier must not break the traced flow */
      }
    }
  };

  try {
    file = tracePath(projectRoot, runId);
  } catch (error) {
    unavailable(error.message.replace(/^trace: /, ''));
  }

  function stamps() {
    const nowMs = clock.now();
    const mono = clock.mono();
    if (!Number.isFinite(nowMs)) throw new Error('bad clock: now() is not finite');
    if (!Number.isFinite(mono)) throw new Error('bad clock: mono() is not finite');
    return { ts: new Date(nowMs).toISOString(), mono_ms: mono };
  }

  function append(record) {
    if (!file) return false;
    try {
      if (!dirReady) {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        dirReady = true;
      }
      fs.appendFileSync(file, JSON.stringify(record) + '\n');
      return true;
    } catch (error) {
      unavailable(errReason(error));
      return false;
    }
  }

  function cleanAttrs(attrs) {
    return attrs && typeof attrs === 'object' && !Array.isArray(attrs) ? attrs : {};
  }

  function startSpan(name, { kind = 'phase', parentId = null, attrs } = {}) {
    const spanId = newSpanId();
    try {
      if (typeof name !== 'string' || name === '') throw new Error('span name is required');
      if (!KINDS.includes(kind)) throw new Error(`unknown span kind ${JSON.stringify(kind)}`);
      const { ts, mono_ms } = stamps();
      const ok = append({
        type: 'span_start',
        run_id: runId,
        span_id: spanId,
        parent_id: parentId || null,
        name,
        kind,
        start_ts: ts,
        mono_ms,
        attrs: cleanAttrs(attrs),
        pid: process.pid
      });
      if (ok) open.add(spanId);
    } catch (error) {
      unavailable(errReason(error));
    }
    return spanId;
  }

  function endSpan(spanId, { status = 'ok', attrs } = {}) {
    try {
      if (!file) return false;
      if (ended.has(spanId)) throw new Error(`span ${spanId} already ended`);
      if (!open.has(spanId)) {
        // Started by another process (each CLI call is its own process): consult the file.
        let state = null;
        try {
          state = scanSpanState(file, spanId);
        } catch (error) {
          throw new Error(`cannot read trace (${errReason(error)})`);
        }
        if (!state.started) throw new Error(`unknown span ${spanId}`);
        if (state.ended) throw new Error(`span ${spanId} already ended`);
      }
      const { ts, mono_ms } = stamps();
      const ok = append({
        type: 'span_end',
        run_id: runId,
        span_id: spanId,
        end_ts: ts,
        mono_ms,
        status: typeof status === 'string' && status ? status : 'ok',
        attrs: cleanAttrs(attrs)
      });
      if (ok) {
        open.delete(spanId);
        ended.add(spanId);
      }
      return ok;
    } catch (error) {
      unavailable(errReason(error));
      return false;
    }
  }

  function withSpan(name, opts, fn) {
    const spanId = startSpan(name, opts || {});
    const finish = (status, attrs) => endSpan(spanId, { status, attrs });
    let result;
    try {
      result = fn(spanId);
    } catch (error) {
      finish('error', { error: String(error && error.message ? error.message : error) });
      throw error;
    }
    if (result && typeof result.then === 'function') {
      return result.then(
        (value) => {
          finish('ok');
          return value;
        },
        (error) => {
          finish('error', { error: String(error && error.message ? error.message : error) });
          throw error;
        }
      );
    }
    finish('ok');
    return result;
  }

  return { startSpan, endSpan, withSpan, path: file };
}

/** @returns {{started: boolean, ended: boolean}} scan for one span id; throws if unreadable. */
function scanSpanState(file, spanId) {
  const state = { started: false, ended: false };
  const text = fs.readFileSync(file, 'utf8');
  for (const line of text.split('\n')) {
    if (!line.includes(spanId)) continue;
    let rec;
    try {
      rec = JSON.parse(line);
    } catch (_) {
      continue;
    }
    if (!rec || rec.span_id !== spanId) continue;
    if (rec.type === 'span_start') state.started = true;
    else if (rec.type === 'span_end') state.ended = true;
  }
  return state;
}

function parseTs(ts) {
  if (typeof ts !== 'string') return NaN;
  return Date.parse(ts);
}

/**
 * Read and materialize a trace file. Throws if the file cannot be read. Malformed lines
 * (for example a partial last line after SIGKILL) are skipped with a warning, never fatal.
 *
 * @returns {{spans: object[], lastTs: string|null, warnings: string[]}}
 */
function readTrace(file) {
  const text = fs.readFileSync(file, 'utf8');
  const warnings = [];
  const byId = new Map();
  const order = [];
  let lastMs = -Infinity;
  const observe = (ts) => {
    const ms = parseTs(ts);
    if (Number.isFinite(ms) && ms > lastMs) lastMs = ms;
  };

  const lines = text.split('\n');
  lines.forEach((line, idx) => {
    if (line.trim() === '') return;
    let rec;
    try {
      rec = JSON.parse(line);
    } catch (_) {
      warnings.push(`line ${idx + 1}: not valid JSON, skipped`);
      return;
    }
    if (!rec || typeof rec !== 'object' || typeof rec.span_id !== 'string') {
      warnings.push(`line ${idx + 1}: not a span record, skipped`);
      return;
    }
    if (rec.type === 'span_start') {
      if (!Number.isFinite(parseTs(rec.start_ts))) {
        warnings.push(`line ${idx + 1}: span ${rec.span_id} has an unparseable start_ts, skipped`);
        return;
      }
      if (byId.has(rec.span_id)) {
        warnings.push(`line ${idx + 1}: duplicate span_start for ${rec.span_id}, skipped`);
        return;
      }
      observe(rec.start_ts);
      byId.set(rec.span_id, { start: rec, end: null });
      order.push(rec.span_id);
    } else if (rec.type === 'span_end') {
      const entry = byId.get(rec.span_id);
      if (!entry) {
        warnings.push(`line ${idx + 1}: span_end for unknown span ${rec.span_id}, skipped`);
        return;
      }
      if (entry.end) {
        warnings.push(`line ${idx + 1}: duplicate span_end for ${rec.span_id}, skipped`);
        return;
      }
      if (!Number.isFinite(parseTs(rec.end_ts))) {
        warnings.push(`line ${idx + 1}: span ${rec.span_id} has an unparseable end_ts, treated as unfinished`);
        return;
      }
      observe(rec.end_ts);
      entry.end = rec;
    } else {
      warnings.push(`line ${idx + 1}: unknown record type, skipped`);
    }
  });

  const spans = order.map((id) => {
    const { start, end } = byId.get(id);
    const attrs = { ...(start.attrs && typeof start.attrs === 'object' ? start.attrs : {}) };
    const span = {
      run_id: start.run_id,
      span_id: id,
      parent_id: start.parent_id || null,
      name: start.name,
      kind: start.kind || 'phase',
      start_ts: start.start_ts,
      end_ts: null,
      duration_ms: null,
      status: 'unfinished',
      attrs
    };
    if (!end) return span;
    Object.assign(attrs, end.attrs && typeof end.attrs === 'object' ? end.attrs : {});
    span.end_ts = end.end_ts;
    span.status = typeof end.status === 'string' && end.status ? end.status : 'ok';
    const wall = parseTs(end.end_ts) - parseTs(start.start_ts);
    const mono = Number.isFinite(start.mono_ms) && Number.isFinite(end.mono_ms) ? end.mono_ms - start.mono_ms : NaN;
    let duration;
    if (Number.isFinite(mono) && mono >= 0 && mono <= wall + MONO_WALL_SLACK_MS) {
      duration = mono;
      if (wall < 0) attrs.clock_anomaly = true;
    } else {
      duration = wall;
      if (Number.isFinite(mono) || wall < 0) attrs.clock_anomaly = true;
    }
    if (duration < 0) {
      duration = 0;
      attrs.clock_anomaly = true;
    }
    span.duration_ms = Math.round(duration);
    return span;
  });

  return {
    spans,
    lastTs: Number.isFinite(lastMs) ? new Date(lastMs).toISOString() : null,
    warnings
  };
}

/**
 * @param {object[]|{spans: object[], lastTs?: string|null}} input
 * @param {{path?: string}} [opts]
 * @returns {object|null} summary, or null when there are no spans
 */
function summarize(input, opts = {}) {
  const spans = Array.isArray(input) ? input : (input && input.spans) || [];
  if (spans.length === 0) return null;
  const given = Array.isArray(input) ? null : input.lastTs;

  const rows = spans.map((span, index) => {
    const s = parseTs(span.start_ts);
    const e = span.end_ts ? parseTs(span.end_ts) : NaN;
    return { span, index, s, e, unfinished: !Number.isFinite(e) };
  });
  let maxObserved = Math.max(...rows.map((r) => (Number.isFinite(r.e) ? r.e : r.s)), ...rows.map((r) => r.s));
  const givenMs = given ? parseTs(given) : NaN;
  if (Number.isFinite(givenMs) && givenMs > maxObserved) maxObserved = givenMs;
  const wallStart = Math.min(...rows.map((r) => r.s));
  const wallEnd = maxObserved;
  const wallMs = wallEnd - wallStart;
  for (const r of rows) {
    r.end = r.unfinished ? wallEnd : Math.max(r.s, r.e);
    r.dur = r.unfinished ? Math.max(0, wallEnd - r.s) : r.span.duration_ms != null ? r.span.duration_ms : r.end - r.s;
  }

  const byId = new Map(rows.map((r) => [r.span.span_id, r]));
  const parentOf = (r) => {
    const pid = r.span.parent_id;
    return pid && pid !== r.span.span_id && byId.has(pid) ? byId.get(pid) : null;
  };
  const children = new Map();
  let orphanSpans = 0;
  const top = [];
  for (const r of rows) {
    const parent = parentOf(r);
    if (parent) {
      if (!children.has(parent)) children.set(parent, []);
      children.get(parent).push(r);
    } else {
      top.push(r);
      if (r.span.parent_id) orphanSpans += 1;
    }
  }
  const byStart = (a, b) => a.s - b.s || a.index - b.index;
  top.sort(byStart);

  // Sweep line over top-level intervals.
  const bounds = [...new Set([wallStart, wallEnd, ...top.flatMap((r) => [r.s, r.end])])].sort((a, b) => a - b);
  const attributed = new Map();
  const gaps = [];
  let covered = 0;
  for (let i = 0; i + 1 < bounds.length; i += 1) {
    const lo = bounds[i];
    const hi = bounds[i + 1];
    const owner = top.find((r) => r.s <= lo && r.end >= hi); // top is start-ordered => earliest-started
    if (owner) {
      covered += hi - lo;
      attributed.set(owner.span.name, (attributed.get(owner.span.name) || 0) + (hi - lo));
    } else {
      const last = gaps[gaps.length - 1];
      if (last && last.end === lo) last.end = hi;
      else gaps.push({ start: lo, end: hi });
    }
  }
  const unaccounted = wallMs - covered;

  const pct = (ms) => (wallMs > 0 ? Math.round((ms / wallMs) * 1000) / 10 : 0);
  const phaseMap = new Map();
  for (const r of top) {
    if (!phaseMap.has(r.span.name)) phaseMap.set(r.span.name, { name: r.span.name, count: 0, max_ms: 0, lower_bound: false });
    const row = phaseMap.get(r.span.name);
    row.count += 1;
    row.max_ms = Math.max(row.max_ms, r.dur);
    if (r.unfinished) row.lower_bound = true;
  }
  const phases = [...phaseMap.values()].map((row) => ({
    name: row.name,
    total_ms: attributed.get(row.name) || 0,
    pct_of_wall: pct(attributed.get(row.name) || 0),
    count: row.count,
    max_ms: row.max_ms,
    lower_bound: row.lower_bound
  }));

  // Inclusive per-name table over ALL spans (nested; not summable).
  const inclMap = new Map();
  for (const r of rows) {
    if (!inclMap.has(r.span.name)) inclMap.set(r.span.name, { name: r.span.name, total_ms: 0, count: 0, max_ms: 0, lower_bound: false });
    const row = inclMap.get(r.span.name);
    row.total_ms += r.dur;
    row.count += 1;
    row.max_ms = Math.max(row.max_ms, r.dur);
    if (r.unfinished) row.lower_bound = true;
  }
  const inclusive = [...inclMap.values()].sort((a, b) => b.total_ms - a.total_ms || a.name.localeCompare(b.name));

  // Human wait: union of human-wait intervals.
  const waits = rows
    .filter((r) => r.span.kind === 'human-wait')
    .map((r) => [r.s, r.end])
    .sort((a, b) => a[0] - b[0]);
  let humanWait = 0;
  let curLo = null;
  let curHi = null;
  for (const [lo, hi] of waits) {
    if (curHi === null || lo > curHi) {
      if (curHi !== null) humanWait += curHi - curLo;
      curLo = lo;
      curHi = hi;
    } else if (hi > curHi) {
      curHi = hi;
    }
  }
  if (curHi !== null) humanWait += curHi - curLo;

  // Critical path: top-level spans in order, each with its heaviest-descendant chain.
  const chainOf = (r, seen = new Set()) => {
    const out = [];
    let cur = r;
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      const kids = children.get(cur) || [];
      let best = null;
      for (const k of kids) if (!best || k.dur > best.dur || (k.dur === best.dur && byStart(k, best) < 0)) best = k;
      if (!best) break;
      out.push({ name: best.span.name, span_id: best.span.span_id, duration_ms: best.dur, lower_bound: best.unfinished });
      cur = best;
    }
    return out;
  };
  const criticalPath = top.map((r) => ({
    name: r.span.name,
    span_id: r.span.span_id,
    start_ts: r.span.start_ts,
    duration_ms: r.dur,
    lower_bound: r.unfinished,
    status: r.span.status,
    chain: chainOf(r)
  }));

  const topSpans = [...rows]
    .sort((a, b) => b.dur - a.dur || byStart(a, b))
    .slice(0, 5)
    .map((r) => ({
      name: r.span.name,
      span_id: r.span.span_id,
      kind: r.span.kind,
      duration_ms: r.dur,
      lower_bound: r.unfinished,
      status: r.span.status
    }));

  // Slowest subagent per round (nearest `round` ancestor).
  const perRound = new Map();
  for (const r of rows) {
    if (r.span.name !== 'subagent') continue;
    let anc = parentOf(r);
    const seen = new Set();
    while (anc && anc.span.name !== 'round' && !seen.has(anc)) {
      seen.add(anc);
      anc = parentOf(anc);
    }
    if (!anc || anc.span.name !== 'round') continue;
    const cur = perRound.get(anc);
    if (!cur || r.dur > cur.dur) perRound.set(anc, r);
  }
  const slowest = [...perRound.entries()]
    .sort((a, b) => byStart(a[0], b[0]))
    .map(([round, r]) => ({
      round_span_id: round.span.span_id,
      round: round.span.attrs ? round.span.attrs.round : undefined,
      span_id: r.span.span_id,
      finding_id: r.span.attrs ? r.span.attrs.finding_id : undefined,
      agent: r.span.attrs ? r.span.attrs.agent : undefined,
      duration_ms: r.dur,
      lower_bound: r.unfinished
    }));

  const iso = (ms) => new Date(ms).toISOString();
  return {
    run_id: spans[0].run_id,
    path: opts.path,
    wall_start: iso(wallStart),
    wall_end: iso(wallEnd),
    wall_ms: wallMs,
    phases,
    unaccounted_ms: unaccounted,
    unaccounted_pct: pct(unaccounted),
    largest_gaps: gaps
      .map((g) => ({ start: iso(g.start), end: iso(g.end), ms: g.end - g.start }))
      .sort((a, b) => b.ms - a.ms)
      .slice(0, 5),
    human_wait_ms: humanWait,
    machine_ms: wallMs - humanWait,
    span_count: rows.length,
    unfinished: rows.filter((r) => r.unfinished).length,
    orphan_spans: orphanSpans,
    clock_anomalies: rows.filter((r) => r.span.attrs && r.span.attrs.clock_anomaly).length,
    inclusive,
    critical_path: criticalPath,
    top_spans: topSpans,
    slowest_subagent_per_round: slowest
  };
}

/**
 * The compact object embedded in pr-merge's final report as `trace_summary` and printed by
 * `trace summarize --brief`.
 */
function briefSummary(summary, { path: p } = {}) {
  const phases = {};
  for (const row of summary.phases) phases[row.name] = row.total_ms;
  return {
    path: p !== undefined ? p : summary.path,
    wall_ms: summary.wall_ms,
    phases,
    unaccounted_ms: summary.unaccounted_ms,
    human_wait_ms: summary.human_wait_ms,
    machine_ms: summary.machine_ms,
    unfinished: summary.unfinished
  };
}

function fmtMs(ms) {
  if (ms === null || ms === undefined) return '-';
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  return `${m}m${String(Math.round(s - m * 60)).padStart(2, '0')}s`;
}

function table(header, body) {
  const all = [header, ...body];
  const widths = header.map((_, i) => Math.max(...all.map((row) => String(row[i]).length)));
  return all.map((row) => row.map((c, i) => (i === 0 ? String(c).padEnd(widths[i]) : String(c).padStart(widths[i]))).join('  ')).join('\n');
}

/** Human-readable text report for a `summarize()` result. */
function formatSummary(s) {
  const lb = (flag) => (flag ? ' (lower bound)' : '');
  const out = [];
  out.push(`Trace ${s.run_id}${s.path ? ` (${s.path})` : ''}`);
  out.push(`Wall: ${fmtMs(s.wall_ms)} (${s.wall_start} .. ${s.wall_end}); spans=${s.span_count} unfinished=${s.unfinished} orphans=${s.orphan_spans} clock_anomalies=${s.clock_anomalies}`);
  out.push(`Human wait: ${fmtMs(s.human_wait_ms)}  Machine: ${fmtMs(s.machine_ms)}`);
  out.push('');
  out.push('Phases (top-level spans; sweep-line partition, sums to wall with unaccounted):');
  const body = s.phases.map((p) => [p.name + (p.lower_bound ? '*' : ''), fmtMs(p.total_ms), `${p.pct_of_wall}%`, p.count, fmtMs(p.max_ms)]);
  body.push(['(unaccounted)', fmtMs(s.unaccounted_ms), `${s.unaccounted_pct}%`, '', '']);
  out.push(table(['phase', 'total', '% wall', 'count', 'max'], body));
  if (s.phases.some((p) => p.lower_bound)) out.push('* contains an unfinished span: lower bound');
  if (s.largest_gaps.length) {
    out.push('');
    out.push('Largest gaps (no top-level span running):');
    for (const g of s.largest_gaps) out.push(`  ${fmtMs(g.ms)}  ${g.start} .. ${g.end}`);
  }
  out.push('');
  out.push('Critical path:');
  for (const c of s.critical_path) {
    const chain = c.chain.map((k) => `${k.name}(${fmtMs(k.duration_ms)}${lb(k.lower_bound)})`).join(' > ');
    out.push(`  ${c.name} ${fmtMs(c.duration_ms)}${lb(c.lower_bound)}${chain ? '  >  ' + chain : ''}`);
  }
  out.push('');
  out.push('Top 5 longest spans:');
  for (const t of s.top_spans) out.push(`  ${fmtMs(t.duration_ms).padStart(8)}  ${t.name} [${t.kind}] ${t.status}${lb(t.lower_bound)}`);
  if (s.slowest_subagent_per_round.length) {
    out.push('');
    out.push('Slowest subagent per round:');
    for (const r of s.slowest_subagent_per_round) {
      out.push(`  round ${r.round === undefined ? r.round_span_id : r.round}: ${r.finding_id || r.span_id} (${r.agent || 'unknown agent'}) ${fmtMs(r.duration_ms)}${lb(r.lower_bound)}`);
    }
  }
  out.push('');
  out.push('Inclusive per-name totals (ALL spans; nested spans overlap, NOT summable):');
  out.push(
    table(
      ['name', 'total', 'count', 'max'],
      s.inclusive.map((r) => [r.name + (r.lower_bound ? '*' : ''), fmtMs(r.total_ms), r.count, fmtMs(r.max_ms)])
    )
  );
  return out.join('\n');
}

module.exports = {
  KINDS,
  stateDir,
  tracePath,
  createTracer,
  readTrace,
  summarize,
  briefSummary,
  formatSummary
};
