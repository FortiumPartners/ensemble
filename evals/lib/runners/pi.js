'use strict';

/**
 * Pi runner adapter (headless `pi --print --mode json --no-session`): same interface as the Claude adapter,
 * `run(job) -> { transcript, exitCode, timedOut, costUsd, loadedSkills, runtime, ... }`. Findings behind every
 * choice here are in docs/guides/skills-eval.md ("Pi runtime").
 *
 * Arms: Pi has no package-level loading, the unit is one skill directory.
 *   with-skill: `--no-skills --skill <skillDir>`  (`--skill` alone leaves every user-level skill loaded)
 *   baseline:   `--no-skills`
 * Both arms also get `--no-context-files --no-extensions --no-mcp --no-approve --no-prompt-templates --no-themes
 * --no-session --offline`, so no AGENTS.md/CLAUDE.md, extension, MCP server, project-local config or session state
 * reaches either arm. The prompt is a positional argument.
 *
 * Loaded skills come from the system prompt the stream carries (message events and `agent_end`): the `<name>`
 * entries of its `<available_skills>` block. A system prompt that was seen but has no such block lists no skills
 * (that is what `--no-skills` produces); a stream that never showed a system prompt tells nothing (`loadedSource`
 * stays `transcript-scan`, so the baseline leak check fails closed). Cost is the sum of `usage.cost.total` over
 * the assistant messages; unknown (absent, zero, timed out) is `null` and the harness charges the run reservation.
 */

const fs = require('fs');
const path = require('path');
const { runProcess } = require('../exec');
const envlib = require('../env');

const RUNTIME = 'pi';
const BIN_NAME = 'pi';
const BIN_ENV = 'EVALS_PI_BIN';

/** Resolve the pi binary: EVALS_PI_BIN override, else search PATH. Returns path or null. */
function findPi(env = process.env) {
  if (env[BIN_ENV]) return fs.existsSync(env[BIN_ENV]) ? env[BIN_ENV] : null;
  for (const d of (env.PATH || '').split(path.delimiter)) {
    const p = path.join(d, 'pi');
    try { fs.accessSync(p, fs.constants.X_OK); return p; } catch { /* next */ }
  }
  return null;
}

/** Flags on every Pi run, both arms. `--no-skills` is here: the with-skill arm re-adds exactly one skill. */
const BASE_FLAGS = ['--print', '--mode', 'json', '--no-session', '--no-context-files', '--no-extensions', '--no-mcp',
  '--no-approve', '--no-prompt-templates', '--no-themes', '--offline', '--no-skills'];

/**
 * pi argv for a job: { prompt, model, skillPaths }. With-skill jobs (non-empty `skillPaths`) get `--skill <dir>`
 * per entry, right after `--no-skills`. Throws for a prompt that would parse as an option or a skill path that is not
 * an absolute directory holding SKILL.md (Pi silently loads nothing for a bad path, which would pass as a
 * with-skill arm that has no skill).
 */
function buildArgs(job) {
  const prompt = String(job.prompt === undefined ? '' : job.prompt);
  if (prompt.startsWith('-')) throw new Error('pi runner: the prompt must not start with "-" (it would be parsed as an option)');
  if (/^\s*@/.test(prompt)) throw new Error('pi runner: the prompt must not start with "@" (Pi may read it as a file include)');
  const args = [...BASE_FLAGS];
  for (const p of job.skillPaths || []) {
    if (typeof p !== 'string' || !path.isAbsolute(p) || !fs.existsSync(path.join(p, 'SKILL.md'))) {
      throw new Error(`pi runner: skill path ${JSON.stringify(p)} is not an absolute directory containing SKILL.md`);
    }
    args.push('--skill', p);
  }
  if (job.model) {
    if (String(job.model).startsWith('-')) throw new Error('pi runner: the model must not start with "-"');
    args.push('--model', String(job.model));
  }
  args.push(prompt);
  return args;
}

const MAX_NAMES = 1000;
const MAX_INVOKED = 500;
const NAME_RE = /<name>([^<]{1,200})<\/name>/g;
const SYSTEM = '"role":"system"';
// Lines worth looking at: the events that carry messages. `agent_end` repeats them and is not always valid JSON.
const MESSAGE_LINE = /^\{"type":"(message_start|message_end|agent_end)"/;

/** Names listed in the `<available_skills>` blocks of raw text (regex, tolerant of unparseable JSON). */
function namesFromText(text) {
  const names = [];
  for (let at = text.indexOf('<available_skills>'); at !== -1; at = text.indexOf('<available_skills>', at + 1)) {
    const end = text.indexOf('</available_skills>', at);
    const block = end === -1 ? text.slice(at) : text.slice(at, end);
    for (const m of block.matchAll(NAME_RE)) names.push(m[1].trim());
  }
  return names;
}

/**
 * The skills listing of the SYSTEM message in one event line, never text from any other message:
 * { seen, names }. `seen` is false when no system message could be located (unverifiable).
 * Parseable line: the role=system message(s) among `message` / `messages`, text of `sections.skills`.
 * Unparseable line (the real `agent_end` is cut): the system object itself, found by brace depth with string and
 * escape state, so nested arrays of objects inside `sections` cannot end it early.
 */
/** Index just past the object that starts at `from` (brace depth, string and escape aware); the line end when it never closes. */
function objectEnd(line, from) {
  let depth = 0, inStr = false;
  for (let i = from; i < line.length; i++) {
    const c = line[i];
    if (inStr) { if (c === '\\') i++; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i + 1;
  }
  return line.length;
}

function systemSkills(line) {
  let o = null;
  try { o = JSON.parse(line); } catch { /* sliced below */ }
  if (o && typeof o === 'object') {
    const msgs = [...(o.message ? [o.message] : []), ...(Array.isArray(o.messages) ? o.messages : [])];
    const sys = msgs.filter((m) => m && typeof m === 'object' && m.role === 'system' && m.sections && typeof m.sections === 'object');
    if (!sys.length) return { seen: false, names: [] };
    return { seen: true, names: sys.flatMap((m) => (typeof m.sections.skills === 'string' ? namesFromText(m.sections.skills) : [])) };
  }
  const at = line.indexOf(SYSTEM);
  if (at === -1) return { seen: false, names: [] };
  const from = Math.max(0, line.lastIndexOf('{', at));
  const after = at + SYSTEM.length;
  const slice = line.slice(from, objectEnd(line, from));
  return { seen: slice.includes('"sections"'), names: namesFromText(slice) };
}

/** Skill directory name from a path that ends in `<name>/SKILL.md`, else null. */
function skillFromPath(p) {
  const m = typeof p === 'string' ? /([^/\\]+)[/\\]SKILL\.md$/.exec(p) : null;
  return m ? m[1] : null;
}

/**
 * Incremental scanner for Pi's JSON event lines. Collects: the skills listed in the system prompt
 * (`loadedSkills`, with `loadedSource` 'system-prompt' once a system prompt was seen, else 'transcript-scan'),
 * the skills used (`invokedSkills`: a `/skill:<name>` expansion in a user message, or a `read` of `<name>/SKILL.md`),
 * the summed assistant cost and the turn count. Everything is collected as lines arrive, so a capped transcript
 * cannot lose it.
 */
function createStreamScanner() {
  let systemSeen = false;
  const names = new Set();
  const invoked = [];
  let turns = 0;
  let cost = 0;
  let assistantMessages = 0;
  let model = null; // `provider/model` (or the model alone) of the first assistant message that names one
  const addInvoked = (n) => { if (typeof n === 'string' && n && invoked.length < MAX_INVOKED) invoked.push(n); };
  return {
    feed(line) {
      if (line.startsWith('{"type":"turn_end"')) { turns += 1; return; }
      const type = MESSAGE_LINE.exec(line);
      if (!type) return;
      if (line.includes(SYSTEM) && line.includes('"sections"')) {
        const sys = systemSkills(line);
        if (sys.seen) systemSeen = true;
        for (const n of sys.names) if (names.size < MAX_NAMES) names.add(n);
      }
      if (type[1] !== 'message_end') return;
      let o;
      try { o = JSON.parse(line); } catch { return; }
      const m = o && o.message;
      if (!m || typeof m !== 'object') return;
      const content = Array.isArray(m.content) ? m.content : [];
      if (m.role === 'assistant') {
        assistantMessages += 1;
        if (model === null && typeof m.model === 'string' && m.model.trim() && m.model.length <= 200) {
          model = typeof m.provider === 'string' && m.provider.trim() && !m.model.includes('/') ? `${m.provider.trim()}/${m.model.trim()}` : m.model.trim();
        }
        const total = m.usage && m.usage.cost && m.usage.cost.total;
        if (typeof total === 'number' && Number.isFinite(total) && total > 0) cost += total;
        for (const b of content) {
          if (b && b.type === 'toolCall' && String(b.name).toLowerCase() === 'read' && b.arguments) {
            addInvoked(skillFromPath(b.arguments.path || b.arguments.file_path || b.arguments.filePath));
          }
        }
      } else if (m.role === 'user') {
        for (const b of content) {
          const t = b && b.type === 'text' && typeof b.text === 'string' ? /^<skill name="([^"]{1,200})" location=/.exec(b.text) : null;
          if (t) addInvoked(t[1]);
        }
      }
    },
    result() {
      const invokedSkills = [...new Set(invoked)].sort();
      return {
        loadedSkills: [...names].sort(),
        invokedSkills,
        loadedPlugins: [],
        loadedSource: systemSeen ? 'system-prompt' : 'transcript-scan',
        turns,
        model,
        // 0 means unpriced (Pi reports total 0 for a model without prices), which is unknown, not free.
        reportedCostUsd: assistantMessages > 0 && cost > 0 ? cost : null,
      };
    },
  };
}

/** Scan a whole Pi transcript (the fallback when no live scanner ran). */
function analyzeTranscript(transcript) {
  const s = createStreamScanner();
  for (const line of String(transcript).split('\n')) s.feed(line);
  return s.result();
}

/**
 * Run one job. `opts.bin` overrides the binary lookup; `opts.secrets` are credential values removed from the
 * transcript, commands and stderr before they are returned.
 * Resolves { transcript, exitCode, timedOut, costUsd, loadedSkills, runtime, ... } with extras the harness uses:
 * invokedSkills, loadedPlugins ([]), loadedSource, turns, stderr, transcriptTruncated, commands, commandsIncomplete.
 * `costUsd` is null when no cost was reported or the run timed out: the scheduler then charges the reservation
 * (the per-run ceiling, `runReserveUsd` in limits.json), flagged costEstimated.
 */
async function run(job, opts = {}) {
  // Fail closed: a missing env would inherit the parent's, a missing workspace would run in the caller's cwd.
  if (!job || !job.env || typeof job.env !== 'object') throw new Error('pi runner: job.env is required (the allowlisted environment); refusing to run with the parent environment');
  if (!job.workspace) throw new Error('pi runner: job.workspace is required; refusing to run in the current directory');
  const bin = opts.bin || findPi();
  if (!bin) throw new Error(`pi CLI not found on PATH (set ${BIN_ENV} to override)`);
  const args = buildArgs(job);
  const secrets = opts.secrets || [];
  const scanner = createStreamScanner();
  const proc = await runProcess(bin, args, { cwd: job.workspace, env: job.env, timeoutMs: job.timeoutMs, secrets, onLine: (l) => scanner.feed(l) });
  const transcript = envlib.redactText(proc.transcript, secrets);
  const { reportedCostUsd, ...scanned } = scanner.result();
  return {
    transcript,
    exitCode: proc.exitCode,
    timedOut: proc.timedOut,
    costUsd: proc.timedOut ? null : reportedCostUsd,
    ...scanned,
    runtime: RUNTIME,
    stderr: envlib.redactText(proc.stderr, secrets),
    transcriptTruncated: proc.transcriptTruncated,
    commands: proc.commands.map((c) => envlib.redactText(c, secrets)),
    commandsIncomplete: proc.commandsIncomplete,
  };
}

module.exports = { RUNTIME, BIN_NAME, BIN_ENV, find: findPi, findPi, buildArgs, createStreamScanner, analyzeTranscript, namesFromText, systemSkills, run };
