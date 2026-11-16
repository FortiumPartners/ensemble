'use strict';

/**
 * Execution: process launching with a hard timeout that kills the whole process tree, plus the suite scheduler
 * that enforces the cost cap with per-run reservations under concurrency.
 * Limits (cap, timeout, per-run and judge reservations, concurrency) are read from evals/limits.json.
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { redactText } = require('./env');

const LIMITS_FILE = path.join(__dirname, '..', 'limits.json');
const FALLBACK_LIMITS = { maxUsdPerSuite: 50, timeoutSec: 900, runReserveUsd: 5, judgeReserveUsd: 0.5, concurrency: 4, repeats: 5, bar: 4 };
const EPS = 1e-9;

/** Defaults from limits.json (fallback constants when the file is absent). */
function loadLimits(file = LIMITS_FILE) {
  if (!fs.existsSync(file)) return { ...FALLBACK_LIMITS };
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { throw new Error(`limits file ${file} is not valid JSON: ${e.message}`); }
  const limits = { ...FALLBACK_LIMITS, ...parsed };
  for (const k of Object.keys(FALLBACK_LIMITS)) {
    if (typeof limits[k] !== 'number' || !(limits[k] >= 0)) throw new Error(`limits file ${file}: "${k}" must be a non-negative number`);
  }
  if (!(limits.maxUsdPerSuite > 0) || !(limits.timeoutSec > 0) || !(limits.concurrency >= 1)) {
    throw new Error(`limits file ${file}: maxUsdPerSuite, timeoutSec and concurrency must be positive`);
  }
  for (const k of ['repeats', 'bar']) {
    if (!Number.isInteger(limits[k]) || limits[k] < 1) throw new Error(`limits file ${file}: "${k}" must be a positive integer`);
  }
  if (limits.bar > limits.repeats) throw new Error(`limits file ${file}: "bar" cannot exceed "repeats"`);
  return limits;
}

function killTree(child) {
  try { process.kill(-child.pid, 'SIGKILL'); } catch { /* group already gone */ }
  try { child.kill('SIGKILL'); } catch { /* already gone */ }
}

const OUTPUT_KEEP = 1024 * 1024; // bytes of stdout kept in memory (tail); the last `result` line is always kept
const MAX_COMMANDS = 5000; // Bash commands kept from tool_use lines, independent of the stdout cap

const SHELL_TOOLS = new Set(['bash', 'shell', 'sh', 'exec', 'terminal', 'run_command']);
const TOOLCALL_KEY = /"toolcall"/i; // any key order, any leading whitespace, any case
// Pi events that repeat what the per-message `message_end` events already carry; an unparseable one loses nothing.
const PI_REPEAT_TYPES = new Set(['agent_end', 'message_update', 'message_start', 'turn_end', 'turn_start', 'agent_start']);
const PI_REPEAT_EVENT = new RegExp(`^\\s*\\{\\s*"type"\\s*:\\s*"(${[...PI_REPEAT_TYPES].join('|')})"`);

/** Commands in one Pi tool-call block: [commands, incomplete]. A shell-like tool without a string command is incomplete. */
function piBlockCommands(b) {
  if (!b || typeof b !== 'object' || String(b.type).toLowerCase() !== 'toolcall') return [[], false];
  if (typeof b.name !== 'string') return [[], true]; // cannot tell whether it ran a shell
  const shellLike = SHELL_TOOLS.has(b.name.trim().toLowerCase());
  let args = b.arguments;
  if (typeof args === 'string') { try { args = JSON.parse(args); } catch { return [[], shellLike]; } }
  // Any tool whose arguments carry a string `command` is collected, whatever its name (execute_bash, powershell, an
  // extension tool): the name list only decides when a MISSING command means the list is incomplete.
  if (args && typeof args.command === 'string') return [[args.command], false];
  if (!shellLike && args && typeof args === 'object' && ['cmd', 'script', 'commands'].some((k) => k in args)) return [[], true];
  return [[], shellLike];
}

/**
 * Commands in one stream-json line: { commands, incomplete }. Claude `tool_use` blocks, and Pi `toolCall` blocks of a
 * shell-like tool in an assistant `message_end`. `incomplete` (fail closed) when a line mentioning `toolCall` cannot be
 * parsed (unless it is an event that only repeats message_end content), or a shell-like tool call has no string command.
 */
function scanLine(line) {
  const pi = TOOLCALL_KEY.test(line);
  const claude = line.includes('"tool_use"');
  if (!pi && !claude) return { commands: [], incomplete: false };
  let obj;
  try { obj = JSON.parse(line); } catch { return { commands: [], incomplete: pi && !PI_REPEAT_EVENT.test(line) }; }
  const commands = [];
  let incomplete = false;
  const m = obj && obj.message;
  const content = m && Array.isArray(m.content) ? m.content : [];
  if (claude) {
    for (const b of content) if (b && b.type === 'tool_use' && b.input && typeof b.input.command === 'string') commands.push(b.input.command);
  }
  if (pi && !(obj && PI_REPEAT_TYPES.has(obj.type))) {
    if (m && m.role === 'assistant') {
      if (!Array.isArray(m.content)) incomplete = true; // a toolCall mention in an assistant message we cannot walk
      for (const b of content) {
        const [c, inc] = piBlockCommands(b);
        commands.push(...c);
        if (inc) incomplete = true;
      }
    }
  }
  return { commands, incomplete };
}

/** Bash commands in one stream-json line (Claude `tool_use`, or Pi `toolCall`); [] for anything else. */
function commandsFromLine(line) {
  return scanLine(line).commands;
}

const KILL_GRACE_MS = 1000; // after a timeout kill, wait this long for 'close' before resolving anyway

/**
 * Run a command in its own process group. On timeout the whole group (the process and its children) is killed,
 * the pipes are destroyed, and the promise resolves after a short grace even if 'close' never arrives (a
 * descendant that left the group, e.g. via setsid, can hold the pipes open for as long as it likes).
 * `input` (string) is written to stdin. Memory is bounded: stdout keeps its tail plus the last stream-json
 * `result` line; stderr keeps its last 2000 characters.
 * Every complete stdout line is also scanned for tool_use Bash commands, kept (up to MAX_COMMANDS) apart from the
 * capped transcript, so early commands survive truncation.
 * `secrets` (optional): credential values removed from stdout lines and stderr as they arrive, before any tail cut, so
 * a secret that would straddle the cap boundary is already gone and no fragment of it survives.
 * `onLine(line)` (optional) sees every complete stdout line, even when the capped transcript later drops it.
 * Resolves { transcript, stderr, exitCode, timedOut, transcriptTruncated, commands, commandsIncomplete }; never rejects.
 */
function runProcess(bin, args, { cwd, env, timeoutMs, input, onLine, secrets = [] }) {
  const scrub = (text) => (secrets.length ? redactText(text, secrets) : text);
  const tap = (line) => { if (onLine) { try { onLine(line); } catch { /* a faulty observer must not break the run */ } } };
  return new Promise((resolve) => {
    let out = '';
    let pending = ''; // incomplete trailing line of stdout
    let lastResult = null;
    let transcriptTruncated = false;
    let commandsIncomplete = false; // command list overflowed, or a line too long to scan was cut
    const commands = [];
    let err = '';
    let timedOut = false;
    let settled = false;
    let graceTimer = null;
    const collect = (l) => {
      const r = scanLine(l);
      if (r.incomplete) commandsIncomplete = true;
      for (const c of r.commands) {
        if (commands.length < MAX_COMMANDS) commands.push(c); else commandsIncomplete = true;
      }
    };
    const child = spawn(bin, args, { cwd, env, stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'], detached: true });
    const finish = (exitCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(graceTimer);
      killTree(child); // reap stragglers still in the group
      if (pending && !timedOut) tap(pending);
      if (pending) collect(pending); // an unterminated last line is still a line
      const tail = out + scrub(pending);
      const transcript = lastResult && !tail.includes(lastResult) ? `${tail}\n${lastResult}` : tail;
      resolve({ transcript, stderr: scrub(err).slice(-2000), exitCode, timedOut, transcriptTruncated, commands, commandsIncomplete });
    };
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
      child.stdout.destroy();
      child.stderr.destroy();
      graceTimer = setTimeout(() => finish(null), KILL_GRACE_MS);
    }, timeoutMs);
    child.stdout.setEncoding('utf8').on('data', (d) => {
      const lines = (pending + d).split('\n');
      pending = lines.pop();
      if (pending.length > OUTPUT_KEEP) { pending = scrub(pending).slice(-OUTPUT_KEEP); transcriptTruncated = true; commandsIncomplete = true; }
      const kept = [];
      for (const l of lines) {
        tap(l);
        const clean = scrub(l); // before the tail cut below
        if (clean.startsWith('{"type":"result"')) lastResult = clean;
        collect(l);
        kept.push(clean);
      }
      out += kept.length ? `${kept.join('\n')}\n` : '';
      if (out.length > 2 * OUTPUT_KEEP) { out = out.slice(-OUTPUT_KEEP); transcriptTruncated = true; }
    });
    child.stderr.setEncoding('utf8').on('data', (d) => { err = scrub(err + d).slice(-4000); });
    child.stdout.on('error', () => {});
    child.stderr.on('error', () => {});
    if (input !== undefined) {
      child.stdin.on('error', () => {});
      child.stdin.end(input);
    }
    child.on('error', (e) => { err += e.message; finish(null); });
    child.on('close', (code) => finish(code));
  });
}

/**
 * USD reserved while a run is in flight: the per-run budget, plus the judge allowance when the eval has an
 * active judged check. `agent` runs only; runs that call no model reserve nothing. Never above the cap.
 */
function reservationFor({ model = true, judged = false }, { runReserveUsd, judgeReserveUsd, capUsd }) {
  if (!model && !judged) return 0;
  return Math.min((model ? runReserveUsd : 0) + (judged ? judgeReserveUsd : 0), capUsd);
}

/**
 * Run `items` in order, at most `concurrency` at a time. A run starts only when spend + in-flight reservations
 * + its own reservation fit under `capUsd`; the first item that does not fit stops all starts (later items are
 * not reordered around it). When nothing is in flight and the next still does not fit, the rest are unstarted.
 *
 * `reserve(item)` -> USD, `run(item)` -> Promise of a result with `costUsd`. A null/missing `costUsd` (or `costEstimated: true`) is charged
 * at the item's full reservation, so timed-out and crashed runs consume the cap.
 * Returns { done: [{ item, result }], unstarted: [item], spent, peakCommitted }.
 */
async function runSuite(items, { concurrency, capUsd, reserve, run, onSettle }) {
  const done = [];
  const queue = [...items];
  const active = new Map(); // item -> reservation
  const inflight = new Set();
  let spent = 0;
  let reserved = 0;
  let peakCommitted = 0;

  const startNext = () => {
    const item = queue[0];
    const r = Math.min(reserve(item), capUsd);
    if (spent + reserved + r > capUsd + EPS) return false;
    queue.shift();
    active.set(item, r);
    reserved += r;
    peakCommitted = Math.max(peakCommitted, spent + reserved);
    const settle = (result) => {
      active.delete(item);
      reserved -= r;
      // Unknown cost (no reported figure: timeout, crash, error) is charged at the full reservation, never $0.
      // An estimated result is never charged below what it reported.
      const reported = (result && result.costUsd) || 0;
      const unknown = !result || result.costUsd === null || result.costUsd === undefined || result.costEstimated;
      const charge = unknown && r > 0 ? Math.max(reported, r) : reported;
      if (unknown && r > 0) result = { ...result, costUsd: charge, costEstimated: true };
      spent += charge;
      done.push({ item, result });
      if (onSettle) onSettle(item, result, spent);
    };
    const p = Promise.resolve().then(() => run(item)).then(settle, (e) => settle({ error: e && e.message ? e.message : String(e), costUsd: null }));
    const tracked = p.then(() => inflight.delete(tracked));
    inflight.add(tracked);
    return true;
  };

  while (queue.length) {
    while (queue.length && active.size < concurrency && startNext()) { /* fill free slots */ }
    if (!queue.length) break;
    if (active.size === 0) break; // next item can never fit
    await Promise.race(inflight);
  }
  await Promise.all(inflight);
  return { done, unstarted: queue, spent, peakCommitted };
}

/**
 * Repeats and bar for an eval: `--repeats` (flag) over the eval's `repeats` over the limits.json default; `bar`
 * from the eval, else the default bar (limits.json) scaled to the repeat count when that differs from the default
 * (4 of 5 becomes 3 of 3, 8 of 10). Sources are reported: 'flag' | 'eval' | 'default' | 'scaled'.
 * Throws a message naming the eval when the bar cannot be met.
 */
function resolveRepeats(ev, { flagRepeats, limits }) {
  const repeats = flagRepeats || ev.repeats || limits.repeats;
  const repeatsSource = flagRepeats ? 'flag' : ev.repeats ? 'eval' : 'default';
  let bar = ev.bar;
  let barSource = 'eval';
  if (bar === undefined) {
    bar = repeats === limits.repeats ? limits.bar : Math.ceil((limits.bar / limits.repeats) * repeats);
    barSource = repeats === limits.repeats ? 'default' : 'scaled';
  }
  if (bar > repeats) throw new Error(`eval "${ev.id}": bar ${bar} (${barSource}) exceeds repeats ${repeats} (${repeatsSource})`);
  return { repeats, bar, repeatsSource, barSource };
}

/**
 * Run items for one eval: `repeats` runs per arm, baseline first in each pair so a leaked baseline is found before
 * most of the budget is spent. An item is { ev, arm, run } with run counting from 1.
 */
function expandRuns(ev, repeats) {
  const items = [];
  for (let run = 1; run <= repeats; run++) for (const arm of ['baseline', 'with-skill']) items.push({ ev, arm, run });
  return items;
}

/** Counts for one arm. `planned` is the repeat count; runs that never started are `notRun`. */
function armStats(runs, planned) {
  const executed = runs.filter((r) => r.outcome !== 'incomplete' && r.outcome !== 'aborted' && r.outcome !== 'unverifiable');
  return {
    passes: executed.filter((r) => r.outcome === 'pass').length,
    runs: executed.length,
    timedOut: executed.filter((r) => r.outcome === 'timed_out').length,
    unverifiable: runs.filter((r) => r.outcome === 'unverifiable').length,
    providerErrors: runs.filter((r) => r.outcome === 'incomplete' && typeof r.incompleteReason === 'string' && r.incompleteReason.startsWith('provider error')).length,
    notRun: Math.max(0, planned - executed.length),
  };
}

/** Reliable when passes reach the bar; false when the bar can no longer be reached; null while undetermined. */
function reliability(stats, bar, planned) {
  if (stats.passes >= bar) return true;
  if (stats.passes + Math.max(0, planned - stats.runs) < bar) return false;
  return null;
}

module.exports = { resolveRepeats, expandRuns, armStats, reliability, loadLimits, runProcess, commandsFromLine, scanLine, MAX_COMMANDS, reservationFor, runSuite, killTree, LIMITS_FILE };
