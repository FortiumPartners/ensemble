/**
 * Serial dispatcher with the error policy (TRD-006). No I/O of its own: the
 * runners are injected, so this module only decides order and what a failure
 * means.
 *
 * Handlers for one event run one at a time, in configured order, each awaited
 * before the next starts. A handler that does not succeed is handled by its
 * own `on_error`: `continue` records it and moves on; `block` (start only)
 * records it as `blocked`, stops the run of handlers and names it. A handler
 * runs at most once: nothing here retries, schedules or recovers a failure.
 * The dispatcher never touches the command's own outcome.
 */

import type { Handler, HandlerOutcome, HooksConfig, PromptHandler, ShellHandler } from "./types";

/** The two runners the dispatcher calls; both settle with an outcome and should never throw. */
export interface HandlerRunners {
  shell: (name: string, handler: ShellHandler, eventJson: string) => Promise<HandlerOutcome>;
  prompt: (name: string, handler: PromptHandler, eventJson: string) => Promise<HandlerOutcome>;
}

export interface DispatchInput {
  config: HooksConfig;
  command: string;
  event: "start" | "end";
  /** The serialized event every handler receives. */
  eventJson: string;
  runners: HandlerRunners;
}

export interface DispatchResult {
  /** True when a start handler's `block` policy stopped the event. */
  blocked: boolean;
  /** Name of the handler that blocked; set only when `blocked`. */
  blockedBy?: string;
  /** One outcome per handler that ran, in run order. */
  outcomes: HandlerOutcome[];
}

/** Run one handler through its runner, turning a throw or rejection into a `failed` outcome. */
async function runOne(
  name: string,
  config: HooksConfig,
  eventJson: string,
  runners: HandlerRunners,
): Promise<{ handler?: Handler; outcome: HandlerOutcome }> {
  if (!Object.hasOwn(config.hooks, name)) {
    const message = `handler "${name}" is selected but not defined in hooks`;
    return { outcome: { handler: name, status: "failed", duration_ms: 0, message } };
  }
  const handler = config.hooks[name];
  const started = performance.now();
  try {
    const outcome =
      handler.type === "shell"
        ? await runners.shell(name, handler, eventJson)
        : await runners.prompt(name, handler, eventJson);
    return { handler, outcome };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return {
      handler,
      outcome: {
        handler: name,
        status: "failed",
        duration_ms: Math.round(performance.now() - started),
        message: `handler runner threw: ${reason}`,
      },
    };
  }
}

export async function dispatchHandlers(input: DispatchInput): Promise<DispatchResult> {
  const { config, command, event, eventJson, runners } = input;
  const selection = Object.hasOwn(config.commands, command) ? config.commands[command] : undefined;
  const names = selection?.[event] ?? [];
  const outcomes: HandlerOutcome[] = [];

  for (const name of names) {
    const { handler, outcome } = await runOne(name, config, eventJson, runners);
    // An end handler can never block (the validator rejects it); treat it as `continue`.
    if (outcome.status !== "succeeded" && event === "start" && handler?.on_error === "block") {
      outcomes.push({ ...outcome, status: "blocked" });
      return { blocked: true, blockedBy: name, outcomes };
    }
    outcomes.push(outcome);
  }
  return { blocked: false, outcomes };
}
