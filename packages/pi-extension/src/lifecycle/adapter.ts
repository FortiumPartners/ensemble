/**
 * Pi adapter for command lifecycle hooks: the gate that decides whether this
 * project's hooks may run at all, the user's way of trusting them, and the entry
 * point `activate()` calls.
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
 * Nothing in this file starts a handler, and no tool the model can call is
 * registered here. Trust is granted only by `/ensemble-lifecycle-trust`, after
 * the user confirms in the host's UI.
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
 * `ctx.hasUI` is false (measured, Pi 1.2.0), so there a message goes to stderr.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  HOOKS_FILE_RELATIVE,
  computeHooksDigest,
  describeHooksForTrust,
  isTrusted,
  loadHooksConfig,
  recordTrust,
} from "@sunstone-partners/ensemble-agent-core";
import type {
  ConfigError,
  HooksConfig,
  RecordTrustOptions,
  TrustCheckOptions,
} from "@sunstone-partners/ensemble-agent-core";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";

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
 * One bullet per validation error. The hooks file is untrusted input, and its
 * names reach the user through these messages, so every control, format and
 * separator character (the plain space aside) is shown as a `\u{...}` escape:
 * a file cannot move the cursor or hide text.
 */
function errorLines(errors: readonly ConfigError[]): string[] {
  return errors.map((e) => {
    const text = e.path ? `${e.path}: ${e.message}` : e.message;
    const safe = text.replace(/[\p{C}\p{Z}]/gu, (ch) => (ch === " " ? ch : `\\u{${ch.codePointAt(0)?.toString(16)}}`));
    return `  - ${safe}`;
  });
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

/** Shows `message` through the host's UI, or on stderr when the host has none. */
function tell(ctx: Pick<ExtensionContext, "hasUI" | "ui">, message: string, level: "info" | "warning" | "error"): void {
  if (ctx.hasUI) ctx.ui.notify(message, level);
  else process.stderr.write(`${message}\n`);
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
    tell(ctx, `Could not record trust: ${error instanceof Error ? error.message : String(error)}`, "error");
    return;
  }
  tell(
    ctx,
    `Trusted the lifecycle hooks in ${HOOKS_FILE_RELATIVE}. They run for the commands it selects until it, or a handler file it names, changes.`,
    "info",
  );
}

/**
 * Registers the lifecycle adapter for the project at `projectRoot`. With no
 * `.ensemble/hooks.yaml` it registers nothing and prints nothing. `options`
 * names the trust store and the clock; tests inject both so they never touch
 * the real home directory.
 */
export function registerLifecycleHooks(pi: ExtensionAPI, projectRoot: string, options: RecordTrustOptions = {}): void {
  if (!existsSync(join(projectRoot, HOOKS_FILE_RELATIVE))) return;

  pi.registerCommand(TRUST_COMMAND_NAME, {
    description: `Review and trust this project's command lifecycle hooks (${HOOKS_FILE_RELATIVE})`,
    handler: (_args, ctx) => runTrustCommand(pi, projectRoot, options, ctx),
  });
}
