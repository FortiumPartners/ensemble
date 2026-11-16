'use strict';

/**
 * Claude Code runner adapter: `run(job) -> { transcript, exitCode, timedOut, costUsd, loadedSkills, runtime }`.
 *
 * Arguments: `claude -p <prompt> --output-format stream-json --verbose --no-session-persistence
 * --setting-sources project ...`. Both arms get `--setting-sources project`, so user-level and synced plugins
 * cannot leak into either arm. A job gets one `--plugin-dir <dir>` per entry of `job.pluginDirs`: the shipped package directory
 * itself, never a copy. For the with-skill arm that is the skill's package (after any `sharedPackages` of the eval); the baseline
 * gets only the `sharedPackages`, and none when the eval names none.
 *
 * Loaded skills come from the stream's own events (see docs/guides/skills-eval.md, "Claude Code startup events"):
 * the `system`/`init` event lists every available skill (`skills`, namespaced `<plugin>:<skill>`) and plugin
 * (`plugins`, with paths); when it carries no skill list, the skill-invocation events (`Skill` tool_use blocks)
 * are used instead. Both are collected as the stream arrives, so a capped transcript cannot lose them.
 */

const fs = require('fs');
const path = require('path');
const { runProcess } = require('../exec');
const envlib = require('../env');
const { isProviderErrorText } = require('./provider-error');

const RUNTIME = 'claude';
const BIN_NAME = 'claude';
const BIN_ENV = 'EVALS_CLAUDE_BIN';

/** Resolve the claude binary: EVALS_CLAUDE_BIN override, else search PATH. Returns path or null. */
function findClaude(env = process.env) {
  if (env.EVALS_CLAUDE_BIN) return fs.existsSync(env.EVALS_CLAUDE_BIN) ? env.EVALS_CLAUDE_BIN : null;
  for (const d of (env.PATH || '').split(path.delimiter)) {
    const p = path.join(d, 'claude');
    try { fs.accessSync(p, fs.constants.X_OK); return p; } catch { /* next */ }
  }
  return null;
}

/**
 * claude argv for a job: { prompt, model, maxUsd, maxTurns, allowedTools, permissionMode, pluginDirs }.
 * `--setting-sources project` is always present (any arm).
 */
function buildArgs(job) {
  const args = ['-p', job.prompt, '--output-format', 'stream-json', '--verbose', '--no-session-persistence',
    '--setting-sources', 'project',
    '--permission-mode', job.permissionMode || 'acceptEdits',
    '--max-turns', String(job.maxTurns || 25)];
  if (job.maxUsd) args.push('--max-budget-usd', String(job.maxUsd));
  if (job.model) args.push('--model', job.model);
  if (job.allowedTools && job.allowedTools.length) args.push('--allowedTools', job.allowedTools.join(','));
  for (const dir of job.pluginDirs || []) args.push('--plugin-dir', dir);
  return args;
}

/** Pull turns / cost from the final `result` line of a stream-json transcript. */
function summarizeTranscript(transcript) {
  let summary = { turns: null, costUsd: null, isError: null, resultText: null };
  for (const line of String(transcript).split('\n')) {
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    if (o && o.type === 'result') {
      summary = {
        turns: o.num_turns ?? null,
        costUsd: o.total_cost_usd ?? o.cost_usd ?? null,
        isError: o.is_error ?? null,
        resultText: typeof o.result === 'string' ? o.result.slice(0, 500) : null,
      };
    }
  }
  return summary;
}

// A result that stopped the agent on purpose (turn or budget limit, or the run crashing mid-work) is an agent outcome, never a provider error.
const AGENT_STOP_SUBTYPE_RE = /max_turns|max_budget|during_execution/;

/**
 * Infrastructure-error rule for a Claude stream: the final `result` line says the run failed (is_error true, or an error
 * subtype) with the API/auth error text, and it is not a deliberate stop. Returns the raw error text, or null.
 */
function providerErrorOf(transcript, secrets = []) {
  let last = null;
  for (const line of String(transcript).split('\n')) {
    if (!line.startsWith('{') || !line.includes('"result"')) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    if (o && o.type === 'result') last = o;
  }
  if (!last || typeof last.result !== 'string') return null;
  const failed = last.is_error === true || (typeof last.subtype === 'string' && last.subtype.startsWith('error'));
  if (!failed || AGENT_STOP_SUBTYPE_RE.test(String(last.subtype || ''))) return null;
  if (!isProviderErrorText(last.result)) return null;
  return envlib.shortReason(last.result, secrets) || 'API error';
}

/**
 * Whether a run got as far as paid work: a final `num_turns` above 1, or an assistant tool call. A first call that failed
 * (a 401) made none, so its zero cost is right; a failure after several turns with no reported figure is unknown spend.
 */
function providerProgressOf(transcript) {
  for (const line of String(transcript).split('\n')) {
    if (!line.startsWith('{')) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    if (!o) continue;
    if (o.type === 'result' && typeof o.num_turns === 'number' && o.num_turns > 1) return true;
    if (o.type === 'assistant' && o.message && Array.isArray(o.message.content) && o.message.content.some((b) => b && b.type === 'tool_use')) return true;
  }
  return false;
}

const MAX_INVOKED = 500;

/**
 * Incremental scanner for stream-json lines. Collects from the startup (`system`/`init`) event the skill list
 * (`startupSkills`, null when the event has none) and the plugins that have a path; and from assistant messages
 * the names passed to the `Skill` tool (`invokedSkills`).
 */
function createStreamScanner() {
  let startupSkills = null; // union over every init event; null until one carries a skills array
  const loadedPlugins = [];
  const invoked = [];
  let model = null; // the model id the startup event reported
  return {
    feed(line) {
      if (!line.includes('"init"') && !line.includes('"Skill"')) return;
      let o;
      try { o = JSON.parse(line); } catch { return; }
      if (!o || typeof o !== 'object') return;
      if (o.type === 'system' && o.subtype === 'init') {
        if (model === null && typeof o.model === 'string' && o.model.trim() && o.model.length <= 200) model = o.model.trim();
        // A later init event adds to what earlier ones reported; it can never hide an earlier match.
        if (Array.isArray(o.skills)) startupSkills = [...new Set([...(startupSkills || []), ...o.skills.filter((s) => typeof s === 'string')])];
        if (Array.isArray(o.plugins)) {
          for (const p of o.plugins) if (p && typeof p.path === 'string' && p.path !== 'builtin') loadedPlugins.push({ name: p.name, path: p.path });
        }
        return;
      }
      const content = o.message && Array.isArray(o.message.content) ? o.message.content : [];
      for (const b of content) {
        if (b && b.type === 'tool_use' && b.name === 'Skill' && b.input) {
          const name = b.input.skill || b.input.name;
          if (typeof name === 'string' && name && invoked.length < MAX_INVOKED) invoked.push(name);
        }
      }
    },
    result() {
      const invokedSkills = [...new Set(invoked)].sort();
      // Reported skills first; the invocation events cover runtimes/streams whose startup event lists none.
      const loadedSkills = [...new Set([...(startupSkills || []), ...invokedSkills])].sort();
      return {
        loadedSkills,
        invokedSkills,
        loadedPlugins,
        loadedSource: startupSkills ? 'startup-event' : 'transcript-scan',
        model,
      };
    },
  };
}

/** Scan a whole stream-json transcript (the fallback when no live scanner ran). */
function analyzeTranscript(transcript) {
  const s = createStreamScanner();
  for (const line of String(transcript).split('\n')) s.feed(line);
  return s.result();
}

/**
 * Run one job. `opts.bin` overrides the binary lookup; `opts.secrets` are credential values removed from the
 * transcript, commands and stderr before they are returned.
 * Resolves { transcript, exitCode, timedOut, costUsd, loadedSkills, runtime, ... } with extras the harness uses:
 * invokedSkills, loadedPlugins, loadedSource, stderr, transcriptTruncated, commands, commandsIncomplete.
 * `costUsd` is null when the stream reported none (timeout, crash): the scheduler then charges the reservation.
 */
async function run(job, opts = {}) {
  // Fail closed: a missing env would inherit the parent's, a missing workspace would run in the caller's cwd.
  if (!job || !job.env || typeof job.env !== 'object') throw new Error('claude runner: job.env is required (the allowlisted environment); refusing to run with the parent environment');
  if (!job.workspace) throw new Error('claude runner: job.workspace is required; refusing to run in the current directory');
  const bin = opts.bin || findClaude();
  if (!bin) throw new Error('claude CLI not found on PATH (set EVALS_CLAUDE_BIN to override)');
  const secrets = opts.secrets || [];
  const scanner = createStreamScanner();
  const proc = await runProcess(bin, buildArgs(job), { cwd: job.workspace, env: job.env, timeoutMs: job.timeoutMs, secrets, onLine: (l) => scanner.feed(l) });
  const transcript = envlib.redactText(proc.transcript, secrets);
  return {
    transcript,
    exitCode: proc.exitCode,
    timedOut: proc.timedOut,
    costUsd: summarizeTranscript(transcript).costUsd,
    providerError: proc.timedOut ? null : providerErrorOf(transcript, secrets),
    providerProgress: providerProgressOf(transcript),
    ...scanner.result(),
    runtime: RUNTIME,
    stderr: envlib.redactText(proc.stderr, secrets),
    transcriptTruncated: proc.transcriptTruncated,
    commands: proc.commands.map((c) => envlib.redactText(c, secrets)),
    commandsIncomplete: proc.commandsIncomplete,
  };
}

module.exports = { RUNTIME, BIN_NAME, BIN_ENV, find: findClaude, findClaude, buildArgs, summarizeTranscript, providerErrorOf, providerProgressOf, createStreamScanner, analyzeTranscript, run };
