/**
 * Pi adapter for command lifecycle hooks: the gate that decides whether this
 * project's hooks may run at all, the user's way of trusting them, the start
 * path, the end path, and the entry point `activate()` calls.
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
 * Only the start path and the end path call it, each with the config of a gate
 * verdict that said `active`. The one tool the model can call,
 * `ensemble_command_complete` (completion.ts), names no handler or executable.
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
 *     loop is streaming (`streamingBehavior: "steer"`). The runtime serializes
 *     its operations for the first (see Serialized operations). `CommandRunTracker`
 *     ends "the run in flight" without checking which run, so a blocked run is
 *     ended only while it is still the run in flight.
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
 *   - `endRun(ctx, end)` delivers `command.end` now for a run the tracker has
 *     ended, however it ended: it checks the gate again for `end.command`,
 *     builds the redacted end event, runs the end handlers serially and shows
 *     each result. It never throws. The completion tool uses `queueEnd`
 *     instead, which holds the end until the loop settles.
 *   - `gate` is the gate the start path uses.
 * The members use closures, not `this`, so they can be passed on as functions.
 *
 * End path (TRD-012). A run ends once, whichever signal reaches the tracker
 * first, and its end handlers then run once, serially, and only if the gate
 * still clears them (the model can edit the hooks file mid-run):
 *   - The model calls `ensemble_command_complete`: the run ends as the model
 *     said and the end is queued. The end handlers run when the loop settles
 *     (`agent_settled`), after the command's final output; Pi awaits them before
 *     it reports the settle (measured over RPC with a 3 s end handler). The next
 *     selected command's input or shutdown delivers a queued end sooner, never later.
 *   - `agent_before_settle` with outcome `error` ends the run `failed`.
 *     `agent_settled` with `aborted: true` ends it `cancelled`: Pi 1.2.0 fires
 *     no `agent_before_settle` for an abort (measured, 10 of 10), so the abort
 *     is read at the settle. A loop that settles `completed`, or with
 *     `aborted: false`, and has no completion signal ends nothing: the command
 *     may be waiting for the user's reply (AC-021-4).
 *   - A newer selected command's `input` ends the run in flight `cancelled`,
 *     naming the missing completion signal, before the newer start handlers
 *     run (the start path). It does so even when the host queues the newer
 *     prompt behind the earlier loop, as the TRD states.
 *   - `session_shutdown` ends it the same way. The event also fires with reason
 *     `new` (and `resume`, `fork`, `reload`): Pi then runs the extension
 *     factory again, which builds a new runtime with a new tracker, while the
 *     old runtime closes and starts nothing more.
 *
 * Shutdown bound. Pi awaited `session_shutdown` handlers for at least
 * 100 000 ms on every normal exit measured (print, RPC stdin close and SIGTERM,
 * TUI quit). End handlers at shutdown may take at most `SHUTDOWN_BOUND_CAP_MS`
 * (60 000 ms) less what shutdown already spent waiting, which is the sum of
 * their timeouts whenever that is less. A handler whose own timeout does not
 * fit in what is left is skipped, and the user is told which and why; shutdown
 * ends on time whatever a handler does. RPC `SIGINT` kills Pi and runs no
 * handler at all (measured); the notice for skipped handlers says so
 * (`SIGINT_SHUTDOWN_NOTE`).
 *
 * Serialized operations. The start path, a delivery of end handlers, a settle
 * and shutdown never overlap: each waits for the one queued before it. Without
 * that, two prompts sent close together (measured: their `input` handlers ran at
 * the same time) would run a superseded run's end handlers beside its own start
 * handlers. Shutdown waits like the rest, but never longer than the bound.
 *
 * Which run a signal is about. The tracker ends "the run in flight" and a loop's
 * signals name no run, so a signal is applied only to a run whose prompt has
 * reached the model (`promptReachedModel`): not while its start handlers run, and
 * not while the host still holds its prompt in the queue behind a loop that was
 * already streaming (measured, Pi 1.2.0, in a tool's own context too: a steered
 * or follow-up prompt stayed in `ctx.hasPendingMessages()` through the running
 * tool call and the next `turn_start`, and left it at the `message_start` that
 * delivered it). A completion call, an error outcome or an abort seen before then
 * belongs to the earlier command's loop. Limits that remain: a call about the
 * earlier command, made after the newer prompt was delivered, cannot be told
 * apart; and a prompt that fails before any loop starts (measured, Pi 1.2.0: no
 * API key for the model) fires no settle event, so its run stays in flight until
 * the next command or shutdown ends it `cancelled`.
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
  unsupportedHookWarnings,
} from "@sunstone-partners/ensemble-agent-core";
import type {
  ActiveRun,
  ConfigError,
  DispatchResult,
  EndResult,
  HandlerOutcome,
  HandlerRunners,
  HandlerStatus,
  HarnessCapabilities,
  HarnessName,
  HooksConfig,
  LifecycleEvent,
  PromptEvaluator,
  RecordTrustOptions,
  TrustCheckOptions,
} from "@sunstone-partners/ensemble-agent-core";
import type {
  AgentBeforeSettleEvent,
  AgentSettledEvent,
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  InputEvent,
  InputEventResult,
  SessionShutdownEvent,
} from "@earendil-works/pi-coding-agent";
import { registerCompletion } from "./completion";
import { createHeadlessPromptEvaluator } from "./prompt-evaluator";
import { resolveCommand } from "./resolve-command";
import type { ResolvedCommand } from "./resolve-command";

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

/** A capability table of the shape agent-core's `HARNESS_CAPABILITIES` has. */
type CapabilityTable = Readonly<Record<HarnessName, Readonly<HarnessCapabilities>>>;

/** What the gate takes besides the host and the project. */
export interface GateOptions extends TrustCheckOptions {
  /**
   * The capability table the unsupported-hook warning reads. Defaults to
   * agent-core's; tests state a harness the real table does not have, because
   * Pi supports every capability.
   */
  capabilities?: CapabilityTable;
}

/**
 * The gate the start and end paths call. It wraps `evaluateHooksGate` with the
 * host's command list, the injected trust store, and the user-visible report.
 *
 * Validation errors say nothing about any one command, and repeating them on
 * every command would drown the output, so they are reported once per change to
 * the file or to its errors, not once per command. They are reported again when
 * the file breaks after having been valid in between. The unsupported-hook
 * warning (AC-014-3) is about the configuration too, so it is shown once per
 * change to the file, the first time a command runs with its hooks active.
 * Trust warnings are reported on every refusal, because each is about a command
 * that was selected and did not run.
 */
export function createHooksGate(pi: ExtensionAPI, projectRoot: string, options: GateOptions = {}): HooksGate {
  let reportedInvalid: string | undefined;
  let reportedUnsupported: string | undefined;
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
      const warnings = unsupportedHookWarnings(decision.config, "pi", options.capabilities);
      const report =
        warnings.length === 0 ? undefined : `${hooksFileFingerprint(projectRoot)}\n${warnings.map((w) => w.message).join("\n")}`;
      if (report !== undefined && report !== reportedUnsupported) {
        const lines = warnings.map((w) => `  - ${escapeInvisible(w.message)}`);
        tell(ctx, [`Ensemble lifecycle hooks in ${HOOKS_FILE_RELATIVE} need what Pi does not support; the commands still run:`, ...lines].join("\n"), "warning");
      }
      reportedUnsupported = report;
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
function outcomeLines(outcome: HandlerOutcome, config: HooksConfig, event: LifecycleEvent): string[] {
  const handler = Object.hasOwn(config.hooks, outcome.handler) ? config.hooks[outcome.handler] : undefined;
  let line = `  ${oneLine(outcome.handler, SHOWN_NAME_CHARS)}: ${STATUS_WORDS[outcome.status]} in ${outcome.duration_ms} ms`;
  if (outcome.truncated) line += `, output truncated at ${SHELL_OUTPUT_BOUND_BYTES / 1024} KiB`;
  const detail = outcome.status !== "succeeded" || handler?.type === "prompt" ? outcome.message : undefined;
  if (detail) line += `: ${oneLine(detail)}`;
  // A handler that failed under `on_error: continue` is a handler failure, never a command failure (AC-013-2).
  // At the end the command has an outcome of its own, which the report states and no handler changes.
  if (outcome.status === "failed" || outcome.status === "timed_out") {
    line +=
      event.event === "command.start"
        ? " (the handler failed; the command did not)"
        : " (the handler failed; the command's own outcome is unchanged)";
  }

  const lines = [line];
  const findings = outcome.findings ?? [];
  for (const finding of findings.slice(0, SHOWN_FINDINGS)) {
    const where = finding.path ? ` (${oneLine(finding.path, SHOWN_NAME_CHARS)})` : "";
    lines.push(`    - ${finding.severity ?? "info"}: ${oneLine(finding.message)}${where}`);
  }
  if (findings.length > SHOWN_FINDINGS) lines.push(`    - ${findings.length - SHOWN_FINDINGS} more findings not shown`);
  return lines;
}

/**
 * Shows what the handlers of one event did. Silent when none was selected
 * (AC-008-2). An end report states how the command ended and why, so a handler
 * failure beside it cannot be read as the command's.
 */
function reportHandlers(ctx: ExtensionContext, config: HooksConfig, event: LifecycleEvent, result: DispatchResult): void {
  if (result.outcomes.length === 0) return;
  const what = event.outcome === undefined ? event.event : `${event.event}, command ${event.outcome}`;
  const lines = [
    `Ensemble lifecycle handlers for ${event.command} (${what}):`,
    ...(event.reason ? [`  reason: ${oneLine(event.reason)}`] : []),
    ...result.outcomes.flatMap((outcome) => outcomeLines(outcome, config, event)),
  ];
  if (result.blocked) {
    lines.push(`${event.command} did not run: start handler "${oneLine(result.blockedBy ?? "", SHOWN_NAME_CHARS)}" blocked it.`);
  }
  const notable = result.outcomes.some((outcome) => outcome.status !== "succeeded" || outcome.truncated);
  tell(ctx, lines.join("\n"), result.blocked ? "error" : notable ? "warning" : "info");
}

/**
 * The most time the adapter lets end handlers take when a session shuts down.
 * Pi awaited `session_shutdown` handlers for at least 100 000 ms on every normal
 * exit it was measured on (TRD, Probe results 2); the cap stays well inside that.
 */
export const SHUTDOWN_BOUND_CAP_MS = 60_000;

/**
 * Part of every notice about end handlers skipped at shutdown. A process killed
 * by SIGINT in RPC mode runs no handler, so nothing could say this then; the
 * notice of a shutdown that did run is where the user can learn it.
 */
export const SIGINT_SHUTDOWN_NOTE =
  "Note: a Pi process killed by SIGINT in RPC mode runs no shutdown handler (measured in Pi 1.2.0), so a command still running then gets no command.end at all.";

/**
 * `agent_settled` as Pi 1.2.0 sends it. `aborted` is real (measured, 10 of 10
 * aborts) but the Pi typings this package builds against (0.87.1) do not
 * declare it, so it is added here, optional so that either typing assigns.
 */
export type SettledEvent = AgentSettledEvent & { aborted?: boolean };

/** What `registerLifecycleHooks` takes besides the host and the project. */
export interface LifecycleOptions extends RecordTrustOptions, GateOptions {
  /** Runs prompt handlers. Defaults to a headless child `pi` (prompt-evaluator.ts); tests inject one. */
  promptEvaluator?: PromptEvaluator;
  /**
   * How long end handlers may take when the session shuts down. Defaults to,
   * and is capped at, `SHUTDOWN_BOUND_CAP_MS`. End handlers whose timeouts do
   * not fit in it are skipped and the user is told; tests inject a short one.
   */
  shutdownBudgetMs?: number;
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
   * Delivers `command.end` now for a run the tracker has ended. Checks the gate
   * for `end.command` again, so a hooks file edited since the run began runs
   * nothing until it is trusted again. Waits for the operations queued before
   * it. Never throws; a failure is shown to the user.
   */
  endRun(ctx: ExtensionContext, end: EndResult): Promise<void>;
  /**
   * The completion tool's `onEnd`: holds the end of a run the tool ended until
   * its end handlers can run, at `agent_settled`, the next selected command's
   * input, or shutdown.
   */
  queueEnd(ctx: ExtensionContext, end: EndResult): void;
  /**
   * The completion tool's `mayComplete`: false while the run in flight has not
   * had its prompt delivered to the model, so a call from an earlier command's
   * loop cannot end it.
   */
  mayComplete(ctx: ExtensionContext): boolean;
  /** `agent_before_settle`: outcome `error` ends the run in flight as `failed`. Nothing else ends it here. */
  handleBeforeSettle(event: AgentBeforeSettleEvent, ctx: ExtensionContext): void;
  /**
   * `agent_settled`: `aborted: true` ends the run in flight as `cancelled`; then
   * the end handlers of every ended run run, once, in the order the runs ended.
   * A settle that is not an abort ends nothing.
   */
  handleSettled(event: SettledEvent, ctx: ExtensionContext): Promise<void>;
  /**
   * `session_shutdown`, whatever its reason: ends the run in flight as
   * `cancelled` and runs the end handlers of every ended run within the
   * shutdown bound, skipping and reporting those that cannot finish in it.
   * Starts nothing afterwards. Resolves within the bound whatever a handler does.
   */
  handleShutdown(event: SessionShutdownEvent, ctx: ExtensionContext): Promise<void>;
}

/** The `session_id` of a session whose host reports none, generated once per process. */
const PROCESS_SESSION_ID = randomUUID();

/** The host session's id, or this process's generated id when the host has none. */
function sessionIdOf(ctx: ExtensionContext): string {
  const id: unknown = ctx.sessionManager?.getSessionId?.();
  return typeof id === "string" && id !== "" ? id : PROCESS_SESSION_ID;
}

/** An end handler that was left out, with the most time it could have taken. */
interface SkippedHandler {
  name: string;
  timeout_ms: number;
}

/**
 * `config` with the end handlers of `command` that cannot finish within `boundMs`
 * taken out, and which they were. Handlers run one after another and each is
 * stopped at its own timeout, so a handler fits when its timeout fits in what the
 * ones before it left.
 */
function endHandlersWithin(config: HooksConfig, command: string, boundMs: number): { config: HooksConfig; skipped: SkippedHandler[] } {
  const selection = config.commands[command];
  const kept: string[] = [];
  const skipped: SkippedHandler[] = [];
  let left = boundMs;
  for (const name of selection.end) {
    // A name the file does not define fails at once, so it takes no time.
    const timeout_ms = Object.hasOwn(config.hooks, name) ? config.hooks[name].timeout_ms : 0;
    if (timeout_ms <= left) {
      kept.push(name);
      left -= timeout_ms;
    } else {
      skipped.push({ name, timeout_ms });
    }
  }
  return { config: { ...config, commands: { ...config.commands, [command]: { ...selection, end: kept } } }, skipped };
}

/** What the user is told when end handlers were skipped at shutdown. `why` finishes the sentence "the session is ending and ...". */
function skippedAtShutdown(command: string, why: string): string {
  return [`Ensemble lifecycle end handlers for ${command} (command.end) were skipped: the session is ending and ${why}`, SIGINT_SHUTDOWN_NOTE].join("\n");
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
  const shutdownBudgetMs = Math.max(0, Math.min(options.shutdownBudgetMs ?? SHUTDOWN_BOUND_CAP_MS, SHUTDOWN_BOUND_CAP_MS));
  let sessionTracker: CommandRunTracker | undefined;
  /** Runs the tracker has ended whose end handlers have not run yet, oldest first. */
  const pendingEnds: EndResult[] = [];
  /** The last operation queued by `serialized`. */
  let tail: Promise<void> = Promise.resolve();
  /** Set when the session shuts down: nothing begins after it. */
  let closing = false;
  /** The run in flight whose prompt has not reached the model yet, and why. See `promptReachedModel`. */
  let notStarted: { runId: string; phase: "starting" | "queued" } | undefined;

  function trackerFor(ctx: ExtensionContext): CommandRunTracker {
    sessionTracker ??= new CommandRunTracker({ sessionId: sessionIdOf(ctx) });
    return sessionTracker;
  }

  /**
   * Runs `operation` after every operation queued before it has settled, so two
   * lifecycle operations never overlap. An operation must not wait for another
   * `serialized` one, which would be waiting for itself: the operations below
   * call the unqueued functions. A rejection reaches only the caller of the
   * operation that failed.
   */
  function serialized<T>(operation: () => Promise<T>): Promise<T> {
    const result = tail.then(operation);
    tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  /**
   * Whether anything the model or its loop does now can be about `run`, which is
   * so once its prompt has reached the model. It has not while its start handlers
   * run, nor while the host still holds the prompt in its queue behind a loop that
   * was already streaming when the command arrived: Pi removes a prompt from
   * `hasPendingMessages` as it delivers it. A completion call, an error outcome
   * or an abort seen before then comes from the earlier command's loop.
   */
  function promptReachedModel(run: ActiveRun, ctx: ExtensionContext): boolean {
    if (notStarted?.runId !== run.run_id) return true;
    if (notStarted.phase === "starting") return false;
    const queued: unknown = typeof ctx.hasPendingMessages === "function" ? ctx.hasPendingMessages() : false;
    return queued !== true;
  }

  /**
   * Ends the run in flight through `end` and holds the end for delivery, unless
   * its prompt has not reached the model, when the signal is not about it.
   */
  function endRunInFlight(ctx: ExtensionContext, end: (tracker: CommandRunTracker) => EndResult | undefined): void {
    const run = sessionTracker?.current();
    if (!sessionTracker || !run || !promptReachedModel(run, ctx)) return;
    const ended = end(sessionTracker);
    if (ended) pendingEnds.push(ended);
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

  /**
   * Delivers `command.end` for a run the tracker has ended. Checks the gate
   * again, tells the user when the file no longer selects the command, and never
   * throws. At shutdown `deadline` (a `Date.now()` reading) is the last moment the
   * handlers may still be running: those whose timeouts do not fit before it are
   * skipped, and the user is told.
   */
  async function deliverEnd(ctx: ExtensionContext, end: EndResult, deadline?: number): Promise<void> {
    try {
      const decision = gate(ctx, end.command);
      if (!decision.active) {
        // The gate has told the user about every refusal but these two: the hooks file stopped selecting the command mid-run.
        if (!("userMessage" in decision)) {
          tell(
            ctx,
            `Ensemble lifecycle end handlers for ${end.command} (command.end) did not run: ${HOOKS_FILE_RELATIVE} no longer selects them (it changed or was removed while the command ran).`,
            "warning",
          );
        }
        return;
      }
      if (deadline === undefined) {
        await runHandlers(ctx, decision.config, buildEndEvent(end));
        return;
      }
      const left = Math.max(0, deadline - Date.now());
      const { config, skipped } = endHandlersWithin(decision.config, end.command, left);
      await runHandlers(ctx, config, buildEndEvent(end));
      if (skipped.length > 0) {
        const names = skipped.map((s) => `${oneLine(s.name, SHOWN_NAME_CHARS)} (up to ${s.timeout_ms} ms)`).join(", ");
        tell(ctx, skippedAtShutdown(end.command, `${names} cannot finish within the ${left} ms left of the ${shutdownBudgetMs} ms allowed for shutdown.`), "warning");
      }
    } catch (error) {
      tell(ctx, `Ensemble lifecycle handlers for ${end.command} (command.end) did not run: ${oneLine(errorText(error))}`, "error");
    }
  }

  /** Delivers the end of every run the tracker ended and no end handler has run for yet, oldest first. Never throws. */
  async function deliverPending(ctx: ExtensionContext, deadline?: number): Promise<void> {
    for (let end = pendingEnds.shift(); end !== undefined; end = pendingEnds.shift()) {
      await deliverEnd(ctx, end, deadline);
    }
  }

  async function startRun(event: InputEvent, resolved: ResolvedCommand, ctx: ExtensionContext): Promise<InputEventResult> {
    if (closing) return { action: "continue" };
    let decision = gate(ctx, resolved.command);
    if (!decision.active) return { action: "continue" };

    // A run that already ended, and waits for its loop to settle before its end handlers run, has its end
    // delivered before this command starts. The hooks file may have changed while they ran.
    if (pendingEnds.length > 0) {
      await deliverPending(ctx);
      decision = gate(ctx, resolved.command);
      if (!decision.active) return { action: "continue" };
    }
    if (closing) return { action: "continue" };

    const tracker = trackerFor(ctx);
    const { run, superseded } = tracker.begin({
      command: resolved.command,
      arguments: resolved.arguments,
      cwd: ctx.cwd,
    });
    notStarted = { runId: run.run_id, phase: "starting" };
    if (superseded) await deliverEnd(ctx, superseded);

    const result = await runHandlers(ctx, decision.config, buildStartEvent(run));
    if (!result.blocked) {
      // The prompt reaches the model now, unless the host queues it behind a loop that is still streaming.
      notStarted = event.streamingBehavior === undefined ? undefined : { runId: run.run_id, phase: "queued" };
      return { action: "continue" };
    }

    // The block stands whatever else happened. The run ends as failed, naming the block, only if it is still the
    // run in flight: while the start handlers ran, the end of the session or a completion call may have ended it
    // already, and the tracker would otherwise end whichever run replaced it.
    if (tracker.current()?.run_id === run.run_id) {
      const end = tracker.blockedAtStart(result.blockedBy ?? "unknown handler");
      if (end) await deliverEnd(ctx, end);
    }
    return { action: "handled" };
  }

  function handleInput(event: InputEvent, ctx: ExtensionContext): Promise<InputEventResult> {
    const resolved = resolveCommand(event.text);
    if (!resolved) return Promise.resolve({ action: "continue" });
    return serialized(() => startRun(event, resolved, ctx));
  }

  function handleBeforeSettle(event: AgentBeforeSettleEvent, ctx: ExtensionContext): void {
    if (event.outcome !== "error") return;
    endRunInFlight(ctx, (tracker) => tracker.fail("The agent loop ended in an error before the command signalled completion."));
  }

  function handleSettled(event: SettledEvent, ctx: ExtensionContext): Promise<void> {
    if (event.aborted === true) {
      endRunInFlight(ctx, (tracker) => tracker.cancel("The agent loop was aborted before the command signalled completion."));
    }
    if (pendingEnds.length === 0) return Promise.resolve();
    return serialized(() => deliverPending(ctx));
  }

  async function handleShutdown(_event: SessionShutdownEvent, ctx: ExtensionContext): Promise<void> {
    closing = true;
    const end = sessionTracker?.shutdown();
    if (end) pendingEnds.push(end);

    // Wait for the operations queued before this, but never past the bound: a handler that does not
    // return must not hold the shutdown up.
    const deadline = Date.now() + shutdownBudgetMs;
    let timer: NodeJS.Timeout | undefined;
    const timeUp = new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), shutdownBudgetMs);
    });
    const delivered = serialized(() => deliverPending(ctx, deadline)).then(() => true as const);
    const inTime = await Promise.race([delivered, timeUp]);
    clearTimeout(timer);
    if (inTime) return;

    // Whatever was still queued when time ran out never runs: the delivery above finds the queue empty.
    for (const stranded of pendingEnds.splice(0)) {
      tell(
        ctx,
        skippedAtShutdown(stranded.command, `lifecycle handlers started earlier were still running when the ${shutdownBudgetMs} ms allowed for shutdown ran out.`),
        "warning",
      );
    }
  }

  return {
    gate,
    trackerFor,
    handleInput,
    endRun: (ctx, end) => serialized(() => deliverEnd(ctx, end)),
    queueEnd: (_ctx, end) => {
      pendingEnds.push(end);
    },
    mayComplete: (ctx) => {
      const run = sessionTracker?.current();
      return run === undefined || promptReachedModel(run, ctx);
    },
    handleBeforeSettle,
    handleSettled,
    handleShutdown,
  };
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
  registerCompletion(pi, { trackerFor: runtime.trackerFor, onEnd: runtime.queueEnd, mayComplete: runtime.mayComplete });
  pi.on("input", runtime.handleInput);
  pi.on("agent_before_settle", runtime.handleBeforeSettle);
  pi.on("agent_settled", runtime.handleSettled);
  pi.on("session_shutdown", runtime.handleShutdown);
  return runtime;
}
