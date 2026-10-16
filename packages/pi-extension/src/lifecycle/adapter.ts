/**
 * Pi adapter for command lifecycle hooks: the gate that decides whether this
 * project's hooks may run at all, the user's way of trusting them, the start
 * path, and the entry point `activate()` calls.
 *
 * Inert by default: with no `.ensemble/hooks.yaml`, `registerLifecycleHooks`
 * registers nothing and writes nothing, so a project that does not use hooks
 * sees no change (REQ-008).
 *
 * Two conditions must both hold before any handler runs (REQ-022), and
 * `evaluateHooksGate` is the only place either is checked:
 *   1. The host reports the project as trusted (`ctx.isProjectTrusted()`). Pi
 *      reports `true` by default in every mode (measured, TRD Probe results 3),
 *      so on its own this blocks almost nothing.
 *   2. The user has trusted this project's hooks: a record kept outside the
 *      repository, bound to a digest of the hooks file and of every handler file
 *      it names (agent-core's trust store). A change to any of them voids it.
 * Handlers are started in one place, `runHandlers` in `createLifecycleRuntime`.
 * Only the start path and `endRun` call it, each with the config of a gate
 * verdict that said `active`. No tool the model can call is registered here.
 * Trust is granted only by `/ensemble-lifecycle-trust`, after the user confirms
 * in the host's UI.
 *
 * Start path (TRD-010). One `input` handler. An input that is not an Ensemble
 * command, or that the gate does not clear, is answered `continue` and touches
 * nothing: a plain-text reply never begins or supersedes a run. A selected,
 * trusted command begins a run (a run still in flight ends first as
 * `cancelled`, and its end handlers run), its start handlers run to completion,
 * and only then is `continue` returned, so they finish before the command's
 * prompt reaches the model. A start handler that blocks makes the input
 * `handled`, so the workflow never begins, and the run ends as `failed` naming
 * the block.
 *
 * What Pi 1.2.0 does, measured with a throwaway extension in `pi -p` and in RPC
 * mode, and what the start path takes from it:
 *   - `{ action: "handled" }` stops the prompt: no `before_agent_start`, no model
 *     call, nothing printed in print mode. `undefined` means `continue`. A
 *     handler that throws does not stop it: Pi prints "Extension error" and the
 *     input continues. A block is therefore enforced only by returning
 *     `handled`, so nothing between the decision and the return may throw
 *     (`tell`, `runHandlers` and `endRun` never do).
 *   - `input` does not fire for the text of a registered extension command. The
 *     dispatcher commands of dispatcher-commands.ts are extension commands when
 *     the repository holds their YAML: `/ensemble-prd create foo` runs the
 *     command, which forwards `/ensemble:prd create foo`, and `input` fires once
 *     for that forwarded text with `source: "extension"`. Without those commands
 *     `input` fires once for the typed `/ensemble-prd create foo`.
 *     `resolveCommand` maps both to the target, so one dispatcher invocation
 *     starts one run, for the target.
 *   - Two RPC `prompt` commands sent 100 ms apart ran their `input` handlers at
 *     the same time, and a selected command can arrive while another command's
 *     loop is streaming (`streamingBehavior: "steer"`). `CommandRunTracker` ends
 *     "the run in flight" without checking which run, so the start path ends a
 *     run only while it is still the run in flight.
 *   - After `session_shutdown` with reason `new`, Pi runs the extension factory
 *     again and the session has a new id, so one runtime is one session.
 *   - `ctx.sessionManager.getSessionId()` returns an id even with `--no-session`.
 *
 * What the completion tool (TRD-011) and the end path (TRD-012) share with the
 * start path is the `LifecycleRuntime` that `createLifecycleRuntime` builds and
 * `registerLifecycleHooks` returns:
 *   - `trackerFor(ctx)` is the one `CommandRunTracker`. It cannot exist when
 *     `registerLifecycleHooks` runs, because its `session_id` is the host
 *     session's id and that is readable only from an event context. The first
 *     call creates it; every later call returns it. Call it from handlers
 *     (`before_agent_start`, tool `execute`, settle, shutdown), never at
 *     registration.
 *   - `endRun(ctx, end)` delivers `command.end` for a run the tracker has ended,
 *     however it ended (completion, error, abort, shutdown, a newer command,
 *     a block): it checks the gate again for `end.command`, builds the redacted
 *     end event, runs the end handlers serially and shows each result. It never
 *     throws. The start path uses it for the run a newer command supersedes and
 *     for a run that a start handler blocks.
 *   - `gate` is the gate the start path uses.
 * The members use closures, not `this`, so they can be passed on as functions.
 *
 * Known commands. A hooks file may select only commands that exist, so
 * validating it needs the host's command list. `pi.getCommands()` throws until
 * Pi has bound its runtime, which is after `activate()` returns (Pi 1.2.0:
 * "Extension runtime not initialized. Action methods cannot be called during
 * extension loading."), so activation cannot read it. The list is read when it
 * is first needed instead: on every gate evaluation and every run of the trust
 * command, both of which run from host events after binding.
 *
 * Telling the user. Pi's `ui.notify` does nothing in print and JSON mode, where
 * `ctx.hasUI` is false (measured, Pi 1.2.0), so there a message goes to stderr,
 * and so does a message whose UI call fails.
 */
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CommandRunTracker,
  HOOKS_FILE_RELATIVE,
  SHELL_OUTPUT_BOUND_BYTES,
  buildEndEvent,
  buildStartEvent,
  computeHooksDigest,
  describeHooksForTrust,
  dispatchHandlers,
  isRecord,
  isTrusted,
  loadHooksConfig,
  recordTrust,
  runPromptHandler,
  runShellHandler,
  serializeEvent,
} from "@sunstone-partners/ensemble-agent-core";
import type {
  ConfigError,
  DispatchResult,
  EndResult,
  HandlerOutcome,
  HandlerRunners,
  HandlerStatus,
  HooksConfig,
  LifecycleEvent,
  PromptEvaluator,
  RecordTrustOptions,
  TrustCheckOptions,
} from "@sunstone-partners/ensemble-agent-core";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  InputEvent,
  InputEventResult,
} from "@earendil-works/pi-coding-agent";
import { createHeadlessPromptEvaluator } from "./prompt-evaluator";
import { resolveCommand } from "./resolve-command";

/**
 * The user-trust command. Its name starts with `ensemble-`, never `hooks-`:
 * the third-party `pi-yaml-hooks` owns that prefix.
 */
export const TRUST_COMMAND_NAME = "ensemble-lifecycle-trust";

/**
 * The gate's verdict for one command. `no-hooks-file` and `not-selected` mean
 * the project's hooks do not concern this command, so the user is told nothing
 * (AC-008-1, AC-008-2). Every other refusal carries what to tell the user.
 */
export type GateDecision =
  | { active: true; config: HooksConfig }
  | { active: false; reason: "no-hooks-file" | "not-selected" }
  | {
      active: false;
      reason: "invalid-config" | "host-untrusted" | "host-trust-unavailable" | "user-untrusted";
      userMessage: string;
    };

export interface HooksGateInput {
  projectRoot: string;
  /** The command that is running, named as a hooks file names it: `ensemble:create-prd`. */
  command: string;
  /** The Ensemble commands the host reports (see `knownCommandsFromHost`). */
  knownCommands: ReadonlySet<string>;
  /** The host's context for the event. Only its trust decision is read, and it may be absent. */
  host: { isProjectTrusted?: () => boolean };
  /** Where the user's trust record lives. Defaults to the home directory's store; tests inject a temporary one. */
  trust?: TrustCheckOptions;
}

/**
 * The Ensemble commands the host reports, named as a hooks file names them.
 * Pi reports a prompt template as `ensemble-<name>` and a skill as
 * `skill:ensemble-<name>`; both are the command `ensemble:<name>`. Dispatchers
 * such as `ensemble-prd` are commands too.
 */
export function knownCommandsFromHost(commands: readonly { name: string }[]): ReadonlySet<string> {
  const known = new Set<string>();
  for (const { name } of commands) {
    const bare = name.startsWith("skill:") ? name.slice("skill:".length) : name;
    if (bare.startsWith("ensemble-")) known.add(`ensemble:${bare.slice("ensemble-".length)}`);
  }
  return known;
}

/**
 * `text` with every control, format and separator character (the plain space
 * aside) shown as a `\u{...}` escape. Text from a hooks file or a handler is
 * untrusted and reaches the user through messages; escaped, it cannot move the
 * cursor or hide anything.
 */
function escapeInvisible(text: string): string {
  return text.replace(/[\p{C}\p{Z}]/gu, (ch) => (ch === " " ? ch : `\\u{${ch.codePointAt(0)?.toString(16)}}`));
}

/** One bullet per validation error. The hooks file is untrusted input, and its names reach the user through these messages. */
function errorLines(errors: readonly ConfigError[]): string[] {
  return errors.map((e) => `  - ${escapeInvisible(e.path ? `${e.path}: ${e.message}` : e.message)}`);
}

/**
 * Whether this project's hooks may run for `command` right now. Every
 * condition is checked on every call, nothing is cached, and a handler may run
 * only when the answer is `active: true`.
 *
 * The file is validated first, even when the host does not trust the project;
 * nothing it names is executed (AC-022-4). A command the file does not select
 * is `not-selected` whatever the trust state, so an unrelated command produces
 * no output (AC-008-2).
 */
export function evaluateHooksGate(input: HooksGateInput): GateDecision {
  const { projectRoot, command, knownCommands, host, trust } = input;

  const loaded = loadHooksConfig(projectRoot, { knownCommands });
  if (loaded.status === "absent") return { active: false, reason: "no-hooks-file" };
  if (loaded.status === "invalid") {
    const userMessage = [
      `Ensemble lifecycle hooks did not run: ${HOOKS_FILE_RELATIVE} is invalid.`,
      ...errorLines(loaded.errors),
      "Hooks run again once the file is valid and trusted.",
    ].join("\n");
    return { active: false, reason: "invalid-config", userMessage };
  }
  const { config } = loaded;
  if (!Object.hasOwn(config.commands, command)) return { active: false, reason: "not-selected" };

  // Condition 1: the host trusts the project. Anything but a boolean is no decision.
  const hostTrusted: unknown = typeof host.isProjectTrusted === "function" ? host.isProjectTrusted() : undefined;
  if (typeof hostTrusted !== "boolean") {
    const userMessage =
      `Ensemble lifecycle hooks in ${HOOKS_FILE_RELATIVE} did not run for ${command}: ` +
      "Pi gave this session no project-trust decision (ctx.isProjectTrusted is not available), " +
      "and hooks run only in a project the host reports as trusted.";
    return { active: false, reason: "host-trust-unavailable", userMessage };
  }
  if (!hostTrusted) {
    const userMessage =
      `Ensemble lifecycle hooks in ${HOOKS_FILE_RELATIVE} did not run for ${command}: Pi does not trust this project. ` +
      "Trust it in Pi (run /trust to save the decision, or start Pi with --approve) and run the command again.";
    return { active: false, reason: "host-untrusted", userMessage };
  }

  // Condition 2: the user trusts these hooks, as they are now.
  if (!isTrusted(projectRoot, computeHooksDigest(projectRoot, config), trust)) {
    const userMessage =
      `Ensemble lifecycle hooks in ${HOOKS_FILE_RELATIVE} did not run for ${command}: you have not trusted them, ` +
      `or ${HOOKS_FILE_RELATIVE} or a handler file it names has changed since you did. ` +
      `Review them and run /${TRUST_COMMAND_NAME} to trust them.`;
    return { active: false, reason: "user-untrusted", userMessage };
  }

  return { active: true, config };
}

/**
 * Shows `message` through the host's UI, or on stderr when the host has none or
 * its UI call fails. It never throws: Pi lets an input through when its handler
 * throws (measured, Pi 1.2.0), so a message that cannot be shown must not
 * change what the caller decides.
 */
function tell(ctx: Pick<ExtensionContext, "hasUI" | "ui">, message: string, level: "info" | "warning" | "error"): void {
  try {
    if (ctx.hasUI) {
      ctx.ui.notify(message, level);
      return;
    }
  } catch {
    // The host's UI failed; the message still reaches the user, on stderr.
  }
  process.stderr.write(`${message}\n`);
}

/** The message of a caught value. An `Error` made in another realm is not an `instanceof Error`, so the field is read. */
function errorText(error: unknown): string {
  return isRecord(error) && typeof error.message === "string" ? error.message : String(error);
}

/** Evaluates the gate for a command, tells the user why when it refuses, and returns the verdict. */
export type HooksGate = (ctx: ExtensionContext, command: string) => GateDecision;

/** A fingerprint of the hooks file's current bytes, or an empty string when it cannot be read. */
function hooksFileFingerprint(projectRoot: string): string {
  try {
    return createHash("sha256").update(readFileSync(join(projectRoot, HOOKS_FILE_RELATIVE))).digest("hex");
  } catch {
    return "";
  }
}

/**
 * The gate the start and end paths call. It wraps `evaluateHooksGate` with the
 * host's command list, the injected trust store, and the user-visible report.
 *
 * Validation errors say nothing about any one command, and repeating them on
 * every command would drown the output, so they are reported once per change to
 * the file or to its errors, not once per command. They are reported again when
 * the file breaks after having been valid in between. Trust warnings are
 * reported on every refusal, because each is about a command that was selected
 * and did not run.
 */
export function createHooksGate(pi: ExtensionAPI, projectRoot: string, options: TrustCheckOptions = {}): HooksGate {
  let reportedInvalid: string | undefined;
  return (ctx, command) => {
    const decision = evaluateHooksGate({
      projectRoot,
      command,
      knownCommands: knownCommandsFromHost(pi.getCommands()),
      host: ctx,
      trust: options,
    });

    if (decision.active) {
      reportedInvalid = undefined;
    } else if (decision.reason === "invalid-config") {
      const report = `${hooksFileFingerprint(projectRoot)}\n${decision.userMessage}`;
      if (report !== reportedInvalid) tell(ctx, decision.userMessage, "error");
      reportedInvalid = report;
    } else {
      reportedInvalid = undefined;
      if ("userMessage" in decision) tell(ctx, decision.userMessage, "warning");
    }
    return decision;
  };
}

/**
 * `/ensemble-lifecycle-trust`: validates the hooks file, shows every handler's
 * exact executable and arguments or prompt file, and records trust only after
 * the user confirms in the host's UI. A confirmation is the only way trust is
 * granted: no argument skips it, and with no UI the command refuses.
 */
async function runTrustCommand(
  pi: ExtensionAPI,
  projectRoot: string,
  options: RecordTrustOptions,
  ctx: ExtensionCommandContext,
): Promise<void> {
  if (!ctx.hasUI) {
    tell(
      ctx,
      `/${TRUST_COMMAND_NAME} needs an interactive Pi session that can show a confirmation, so it recorded nothing.`,
      "error",
    );
    return;
  }

  const loaded = loadHooksConfig(projectRoot, { knownCommands: knownCommandsFromHost(pi.getCommands()) });
  if (loaded.status === "absent") {
    tell(ctx, `${HOOKS_FILE_RELATIVE} does not exist in this project, so there is nothing to trust.`, "info");
    return;
  }
  if (loaded.status === "invalid") {
    tell(ctx, [`Nothing was trusted: ${HOOKS_FILE_RELATIVE} is invalid.`, ...errorLines(loaded.errors)].join("\n"), "error");
    return;
  }

  // The digest the user is shown the handlers for is the digest that is recorded,
  // so a file that changes while the question is open is simply untrusted afterwards.
  const digest = computeHooksDigest(projectRoot, loaded.config);
  const message = [
    `${HOOKS_FILE_RELATIVE} names handlers that Ensemble will run at command boundaries, with your permissions, without asking again:`,
    "",
    ...describeHooksForTrust(loaded.config),
    "",
    `Trust is recorded outside the repository and ends when ${HOOKS_FILE_RELATIVE} or a handler file it names changes.`,
  ].join("\n");
  const confirmed = await ctx.ui.confirm("Trust this project's lifecycle hooks?", message);
  if (confirmed !== true) {
    tell(ctx, `Nothing was trusted: the lifecycle hooks in ${HOOKS_FILE_RELATIVE} stay disabled.`, "info");
    return;
  }

  try {
    recordTrust(projectRoot, digest, options);
  } catch (error) {
    tell(ctx, `Could not record trust: ${errorText(error)}`, "error");
    return;
  }
  tell(
    ctx,
    `Trusted the lifecycle hooks in ${HOOKS_FILE_RELATIVE}. They run for the commands it selects until it, or a handler file it names, changes.`,
    "info",
  );
}

/** Longest text shown from one handler's output or a prompt handler's message. */
const SHOWN_TEXT_CHARS = 300;
/** Longest handler name shown. */
const SHOWN_NAME_CHARS = 80;
/** Findings listed per handler before the rest are only counted. */
const SHOWN_FINDINGS = 5;

/** What a handler printed, as one line of bounded length with its invisible characters escaped. */
function oneLine(text: string, max: number = SHOWN_TEXT_CHARS): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return escapeInvisible(flat.length > max ? `${flat.slice(0, max)}…` : flat);
}

const STATUS_WORDS: Record<HandlerStatus, string> = {
  succeeded: "succeeded",
  failed: "failed",
  timed_out: "timed out",
  blocked: "blocked",
};

/**
 * The lines that show one handler's outcome: its status and how long it took
 * (AC-013-1), that its output was cut at the bound (AC-009-4), and why it did
 * not succeed. A shell handler's `message` is its own output, so it is shown
 * only to explain a failure; a prompt handler's message and findings are what
 * it says to the user (REQ-011), so they are always shown.
 */
function outcomeLines(outcome: HandlerOutcome, config: HooksConfig): string[] {
  const handler = Object.hasOwn(config.hooks, outcome.handler) ? config.hooks[outcome.handler] : undefined;
  let line = `  ${oneLine(outcome.handler, SHOWN_NAME_CHARS)}: ${STATUS_WORDS[outcome.status]} in ${outcome.duration_ms} ms`;
  if (outcome.truncated) line += `, output truncated at ${SHELL_OUTPUT_BOUND_BYTES / 1024} KiB`;
  const detail = outcome.status !== "succeeded" || handler?.type === "prompt" ? outcome.message : undefined;
  if (detail) line += `: ${oneLine(detail)}`;
  // A handler that failed under `on_error: continue` is a handler failure, never a command failure (AC-013-2).
  if (outcome.status === "failed" || outcome.status === "timed_out") line += " (the handler failed; the command did not)";

  const lines = [line];
  const findings = outcome.findings ?? [];
  for (const finding of findings.slice(0, SHOWN_FINDINGS)) {
    const where = finding.path ? ` (${oneLine(finding.path, SHOWN_NAME_CHARS)})` : "";
    lines.push(`    - ${finding.severity ?? "info"}: ${oneLine(finding.message)}${where}`);
  }
  if (findings.length > SHOWN_FINDINGS) lines.push(`    - ${findings.length - SHOWN_FINDINGS} more findings not shown`);
  return lines;
}

/** Shows what the handlers of one event did. Silent when none was selected (AC-008-2). */
function reportHandlers(ctx: ExtensionContext, config: HooksConfig, event: LifecycleEvent, result: DispatchResult): void {
  if (result.outcomes.length === 0) return;
  const lines = [
    `Ensemble lifecycle handlers for ${event.command} (${event.event}):`,
    ...result.outcomes.flatMap((outcome) => outcomeLines(outcome, config)),
  ];
  if (result.blocked) {
    lines.push(`${event.command} did not run: start handler "${oneLine(result.blockedBy ?? "", SHOWN_NAME_CHARS)}" blocked it.`);
  }
  const notable = result.outcomes.some((outcome) => outcome.status !== "succeeded" || outcome.truncated);
  tell(ctx, lines.join("\n"), result.blocked ? "error" : notable ? "warning" : "info");
}

/** What `registerLifecycleHooks` takes besides the host and the project. */
export interface LifecycleOptions extends RecordTrustOptions {
  /** Runs prompt handlers. Defaults to a headless child `pi` (prompt-evaluator.ts); tests inject one. */
  promptEvaluator?: PromptEvaluator;
}

/** What the start path, the completion tool and the end path share. See the file header for the contract. */
export interface LifecycleRuntime {
  /** The one gate: both trust conditions, checked on every call. A handler runs only when it says `active`. */
  readonly gate: HooksGate;
  /**
   * The session's run tracker. The first call creates it, with `session_id` set
   * to the host session's id, or to an id generated once per process when the
   * host gives none (an ephemeral session); every later call returns the same
   * tracker. Call it from handlers, never at registration.
   */
  trackerFor(ctx: ExtensionContext): CommandRunTracker;
  /**
   * The start path: what the `input` handler answers. Anything it throws is
   * thrown before a handler has started (for example the host's trust or
   * command-list call failing inside the gate), and Pi then lets the input
   * continue.
   */
  handleInput(event: InputEvent, ctx: ExtensionContext): Promise<InputEventResult>;
  /**
   * Delivers `command.end` for a run the tracker has ended. Checks the gate for
   * `end.command` again, so a hooks file edited since the run began runs nothing
   * until it is trusted again. Never throws; a failure is shown to the user.
   */
  endRun(ctx: ExtensionContext, end: EndResult): Promise<void>;
}

/** The `session_id` of a session whose host reports none, generated once per process. */
const PROCESS_SESSION_ID = randomUUID();

/** The host session's id, or this process's generated id when the host has none. */
function sessionIdOf(ctx: ExtensionContext): string {
  const id: unknown = ctx.sessionManager?.getSessionId?.();
  return typeof id === "string" && id !== "" ? id : PROCESS_SESSION_ID;
}

/**
 * Builds the state the start path, the completion tool and the end path share.
 * Nothing is registered with the host and nothing runs until an event arrives;
 * in particular `pi.getCommands()` is not called here, because Pi throws there
 * until its runtime is bound.
 */
export function createLifecycleRuntime(pi: ExtensionAPI, projectRoot: string, options: LifecycleOptions = {}): LifecycleRuntime {
  const gate = createHooksGate(pi, projectRoot, options);
  const evaluator = options.promptEvaluator ?? createHeadlessPromptEvaluator({ cwd: projectRoot });
  const runners: HandlerRunners = {
    shell: (name, handler, eventJson) => runShellHandler(name, handler, eventJson, { projectRoot }),
    prompt: (name, handler, eventJson) => runPromptHandler(name, handler, eventJson, evaluator, { projectRoot }),
  };
  let sessionTracker: CommandRunTracker | undefined;

  function trackerFor(ctx: ExtensionContext): CommandRunTracker {
    sessionTracker ??= new CommandRunTracker({ sessionId: sessionIdOf(ctx) });
    return sessionTracker;
  }

  /**
   * Runs the handlers `event` selects, serially, and shows each result. The
   * only place a handler is started. `config` is the config of a gate verdict
   * that said `active`. Never throws: the dispatcher turns a runner's failure
   * into an outcome and `tell` cannot throw.
   */
  async function runHandlers(ctx: ExtensionContext, config: HooksConfig, event: LifecycleEvent): Promise<DispatchResult> {
    const result = await dispatchHandlers({
      config,
      command: event.command,
      event: event.event === "command.start" ? "start" : "end",
      eventJson: serializeEvent(event),
      runners,
    });
    reportHandlers(ctx, config, event, result);
    return result;
  }

  async function endRun(ctx: ExtensionContext, end: EndResult): Promise<void> {
    try {
      const decision = gate(ctx, end.command);
      if (decision.active) await runHandlers(ctx, decision.config, buildEndEvent(end));
    } catch (error) {
      tell(ctx, `Ensemble lifecycle handlers for ${end.command} (command.end) did not run: ${oneLine(errorText(error))}`, "error");
    }
  }

  async function handleInput(event: InputEvent, ctx: ExtensionContext): Promise<InputEventResult> {
    const resolved = resolveCommand(event.text);
    if (!resolved) return { action: "continue" };
    const decision = gate(ctx, resolved.command);
    if (!decision.active) return { action: "continue" };

    const tracker = trackerFor(ctx);
    const { run, superseded } = tracker.begin({
      command: resolved.command,
      arguments: resolved.arguments,
      cwd: ctx.cwd,
    });
    if (superseded) await endRun(ctx, superseded);

    const result = await runHandlers(ctx, decision.config, buildStartEvent(run));
    if (!result.blocked) return { action: "continue" };

    // The block stands whatever else happened. The run ends as failed, naming the
    // block, only if it is still the run in flight: while the start handlers ran, a
    // newer command, the end of the session or a completion call may have ended it
    // already, and the tracker would otherwise end the run that replaced it.
    if (tracker.current()?.run_id === run.run_id) {
      const end = tracker.blockedAtStart(result.blockedBy ?? "unknown handler");
      if (end) await endRun(ctx, end);
    }
    return { action: "handled" };
  }

  return { gate, trackerFor, handleInput, endRun };
}

/**
 * Registers the lifecycle adapter for the project at `projectRoot` and returns
 * the runtime its handlers share. With no `.ensemble/hooks.yaml` it registers
 * nothing, prints nothing and returns `undefined`. `options` names the trust
 * store and the clock, and the prompt evaluator; tests inject them so they
 * never touch the real home directory or start a model.
 */
export function registerLifecycleHooks(pi: ExtensionAPI, projectRoot: string, options: LifecycleOptions = {}): LifecycleRuntime | undefined {
  if (!existsSync(join(projectRoot, HOOKS_FILE_RELATIVE))) return undefined;

  pi.registerCommand(TRUST_COMMAND_NAME, {
    description: `Review and trust this project's command lifecycle hooks (${HOOKS_FILE_RELATIVE})`,
    handler: (_args, ctx) => runTrustCommand(pi, projectRoot, options, ctx),
  });

  const runtime = createLifecycleRuntime(pi, projectRoot, options);
  pi.on("input", runtime.handleInput);
  return runtime;
}
