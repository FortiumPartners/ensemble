/**
 * Claude Code adapter for Ensemble command lifecycle hooks.
 *
 * Built into bundle/lifecycle.cjs (scripts/build.mjs); the plugin runs only that
 * file. All hook semantics (config, trust, payload, redaction, shell runner,
 * serial dispatch) come from agent-core; this file maps Claude Code events onto
 * them. Every path out of `main` exits 0 unless a start handler blocks, which is
 * answered with a JSON decision, so a bug here never breaks a session.
 */
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";
import {
  HOOKS_FILE_RELATIVE,
  buildEndEvent,
  buildStartEvent,
  computeHooksDigest,
  describeHooksForTrust,
  dispatchHandlers,
  loadHooksConfig,
  recordTrust,
  runShellHandler,
  serializeEvent,
} from "@sunstone-partners/ensemble-agent-core";
import type {
  CommandOutcome,
  HandlerOutcome,
  HandlerRunners,
  HooksConfig,
} from "@sunstone-partners/ensemble-agent-core";
import { evaluateHooksGate } from "../../pi-extension/src/lifecycle/adapter";
import { DISPATCHER_TARGETS, resolveCommand } from "../../pi-extension/src/lifecycle/resolve-command";

export interface PendingRun {
  run_id: string;
  command: string;
  arguments: string;
  cwd: string;
  session_id: string;
  started_at: number;
}

interface HookInput {
  hook_event_name?: unknown;
  session_id?: unknown;
  cwd?: unknown;
  prompt?: unknown;
}

// `/ensemble:<name>`, plus the plugin-namespaced forms Claude Code produces: `/ensemble-full:ensemble-<name>`
// (the bundle ships skills only) and `/ensemble-<plugin>:ensemble:<name>` (a standalone plugin's command).
const COLON_FORM =
  /^\s*\/(?:ensemble:|ensemble-[a-z0-9]+(?:-[a-z0-9]+)*:ensemble[:-])([a-z0-9][a-z0-9-]*)(?:\s+([\s\S]*))?$/;
const PROMPT_UNSUPPORTED = "prompt handlers need a model call, which a Claude Code hook cannot make; they run only in Pi";

/** `/ensemble:<name> args` (or a plugin-namespaced form of it) -> the command a hooks file names; dispatchers resolve to their target. */
export function resolveClaudeCommand(prompt: string): { command: string; arguments: string } | undefined {
  const match = COLON_FORM.exec(prompt);
  if (!match) return undefined;
  if (Object.hasOwn(DISPATCHER_TARGETS, `ensemble-${match[1]}`)) {
    return resolveCommand(`/ensemble:${match[1]}${match[2] === undefined ? "" : ` ${match[2]}`}`);
  }
  return { command: `ensemble:${match[1]}`, arguments: (match[2] ?? "").trim() };
}

function stateFile(projectRoot: string, sessionId: string): string {
  const safe = sessionId.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 128) || "session";
  return path.join(projectRoot, ".ensemble", "lifecycle-state", `${safe}.json`);
}

function readPending(file: string): PendingRun | undefined {
  try {
    const run = JSON.parse(fs.readFileSync(file, "utf8")) as PendingRun;
    return typeof run.run_id === "string" && typeof run.command === "string" ? run : undefined;
  } catch {
    return undefined;
  }
}

function writePending(file: string, run: PendingRun): void {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  // The state is local to this machine; keep it out of the repository.
  fs.writeFileSync(path.join(dir, ".gitignore"), "*\n");
  fs.writeFileSync(file, JSON.stringify(run));
}

function runners(projectRoot: string): HandlerRunners {
  return {
    shell: (name, handler, eventJson) => runShellHandler(name, handler, eventJson, { projectRoot }),
    prompt: async (name): Promise<HandlerOutcome> => ({
      handler: name,
      status: "failed",
      duration_ms: 0,
      message: PROMPT_UNSUPPORTED,
    }),
  };
}

/** One line per handler that did not succeed; empty when everything went well. */
function problems(event: string, command: string, outcomes: readonly HandlerOutcome[]): string[] {
  return outcomes
    .filter((o) => o.status !== "succeeded")
    .map((o) => `Ensemble lifecycle hook "${o.handler}" ${o.status} at ${event} of ${command}${o.message ? `: ${o.message}` : ""}`);
}

/** What the user is told when hooks did not run. The Pi gate's own wording names Pi's trust command. */
function refusalNote(reason: string, command: string): string | undefined {
  if (reason === "no-hooks-file" || reason === "not-selected") return undefined;
  if (reason === "invalid-config") return `Ensemble lifecycle hooks did not run for ${command}: ${HOOKS_FILE_RELATIVE} is invalid. Run \`node <plugin>/bundle/lifecycle.cjs trust\` in a terminal to see the errors.`;
  return `Ensemble lifecycle hooks in ${HOOKS_FILE_RELATIVE} did not run for ${command}: you have not trusted them, or a file they name has changed since you did. Review them and run \`node <plugin>/bundle/lifecycle.cjs trust\` in a terminal in this project.`;
}

function gate(projectRoot: string, command: string) {
  // Claude Code gives no per-project trust API; plugin hooks run only after it has
  // trusted the workspace, so the host condition holds. The user's digest-bound
  // trust (condition 2) is checked exactly as in Pi.
  return evaluateHooksGate({ projectRoot, command, host: { isProjectTrusted: () => true } });
}

async function endRun(
  projectRoot: string,
  run: PendingRun,
  outcome: CommandOutcome,
  reason?: string,
): Promise<string[]> {
  const decision = gate(projectRoot, run.command);
  if (!decision.active) return [];
  const event = buildEndEvent({
    run_id: run.run_id,
    command: run.command,
    arguments: run.arguments,
    cwd: run.cwd,
    session_id: run.session_id,
    outcome,
    duration_ms: Math.max(0, Date.now() - run.started_at),
    ...(reason === undefined ? {} : { reason }),
  });
  const result = await dispatchHandlers({
    config: decision.config,
    command: run.command,
    event: "end",
    eventJson: serializeEvent(event),
    runners: runners(projectRoot),
  });
  return problems("end", run.command, result.outcomes);
}

function reply(messages: string[], extra: Record<string, unknown> = {}): void {
  if (messages.length === 0 && Object.keys(extra).length === 0) return;
  const out: Record<string, unknown> = { ...extra };
  if (messages.length > 0) out.systemMessage = messages.join("\n");
  process.stdout.write(JSON.stringify(out));
}

/** Handle one hook event. Returns what to print; throws are caught by the caller. */
export async function handleEvent(input: HookInput, projectRoot: string): Promise<void> {
  const eventName = input.hook_event_name;
  const sessionId = typeof input.session_id === "string" ? input.session_id : "";
  if (!sessionId || typeof eventName !== "string") return;
  const file = stateFile(projectRoot, sessionId);
  const messages: string[] = [];

  if (eventName === "UserPromptSubmit") {
    const resolved = typeof input.prompt === "string" ? resolveClaudeCommand(input.prompt) : undefined;
    if (!resolved) return;
    // A new Ensemble command while one is in flight: the earlier run is abandoned.
    const previous = readPending(file);
    if (previous) {
      fs.rmSync(file, { force: true });
      messages.push(
        ...(await endRun(projectRoot, previous, "cancelled", `No completion signal was received before the next command (${resolved.command}) began.`)),
      );
    }
    const decision = gate(projectRoot, resolved.command);
    if (!decision.active) {
      const note = refusalNote(decision.reason, resolved.command);
      if (note) messages.push(note);
      return reply(messages);
    }
    const run: PendingRun = {
      run_id: randomUUID(),
      command: resolved.command,
      arguments: resolved.arguments,
      cwd: typeof input.cwd === "string" ? input.cwd : projectRoot,
      session_id: sessionId,
      started_at: Date.now(),
    };
    const event = buildStartEvent(run);
    const result = await dispatchHandlers({
      config: decision.config,
      command: run.command,
      event: "start",
      eventJson: serializeEvent(event),
      runners: runners(projectRoot),
    });
    messages.push(...problems("start", run.command, result.outcomes));
    if (result.blocked) {
      const by = result.blockedBy ?? "a start handler";
      messages.push(...(await endRun(projectRoot, run, "failed", `Blocked by start handler "${by}".`)));
      return reply([], {
        decision: "block",
        reason: `Ensemble lifecycle hook "${by}" blocked ${run.command}.\n${messages.join("\n")}`,
      });
    }
    writePending(file, run);
    return reply(messages);
  }

  const outcomeByEvent: Record<string, [CommandOutcome, string | undefined]> = {
    Stop: ["succeeded", undefined],
    StopFailure: ["failed", "The turn ended with an API error."],
    SessionEnd: ["cancelled", "No completion signal was received before the session ended."],
  };
  const mapped = outcomeByEvent[eventName];
  if (!mapped) return;
  const run = readPending(file);
  if (!run) return;
  fs.rmSync(file, { force: true }); // one end per start, even if a handler below is slow
  messages.push(...(await endRun(projectRoot, run, mapped[0], mapped[1])));
  reply(messages);
}

/** `trust [projectRoot]`: show what the hooks would run and record trust after a terminal confirmation. */
export async function trustCommand(projectRoot: string): Promise<number> {
  const loaded = loadHooksConfig(projectRoot);
  if (loaded.status === "absent") {
    console.error(`${HOOKS_FILE_RELATIVE} does not exist in ${projectRoot}; nothing to trust.`);
    return 1;
  }
  if (loaded.status === "invalid") {
    console.error([`${HOOKS_FILE_RELATIVE} is invalid:`, ...loaded.errors.map((e) => `  - ${e.path ? `${e.path}: ` : ""}${e.message}`)].join("\n"));
    return 1;
  }
  if (!process.stdin.isTTY) {
    console.error("Trust needs an interactive terminal to confirm; nothing was recorded.");
    return 1;
  }
  const digest = computeHooksDigest(projectRoot, loaded.config as HooksConfig);
  console.log(["Trust this project's lifecycle hooks?", ...describeHooksForTrust(loaded.config as HooksConfig)].join("\n"));
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer: string = await new Promise((resolve) => rl.question("Type yes to trust: ", resolve));
  rl.close();
  if (answer.trim().toLowerCase() !== "yes") {
    console.log("Nothing was trusted.");
    return 1;
  }
  recordTrust(projectRoot, digest);
  console.log(`Trusted. The hooks run until ${HOOKS_FILE_RELATIVE} or a file it names changes.`);
  return 0;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args[0] === "trust") {
    process.exitCode = await trustCommand(path.resolve(args[1] ?? process.cwd()));
    return;
  }
  let payload: HookInput;
  try {
    payload = JSON.parse(fs.readFileSync(0, "utf8")) as HookInput;
  } catch {
    return;
  }
  const dir = process.env.CLAUDE_PROJECT_DIR || (typeof payload.cwd === "string" ? payload.cwd : process.cwd());
  try {
    await handleEvent(payload, path.resolve(dir));
  } catch (error) {
    process.stderr.write(`ensemble-lifecycle: ${error instanceof Error ? error.message : String(error)}\n`);
  }
}

if (require.main === module) void main();
