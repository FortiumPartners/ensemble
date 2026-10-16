/**
 * Completion tool and per-turn instruction for command lifecycle hooks
 * (TRD-011; PRD REQ-021, AC-021-1, AC-021-2, AC-021-6, AC-021-7).
 *
 * A command ends when the model says so. This file gives the model the one
 * way to say it, `ensemble_command_complete`, and tells it about the tool at
 * run time, because no generated command definition carries a completion step
 * (AC-021-1).
 *
 * Contract (see `CompletionDeps`). The caller, `registerLifecycleHooks` in
 * adapter.ts, owns the `CommandRunTracker` and calls `registerCompletion`
 * only when a hooks file exists; this module imports nothing from adapter.ts.
 * The tracker needs the host session id, which only an event context carries,
 * so the caller supplies `trackerFor(ctx)` (lazy, the same tracker every time)
 * rather than a tracker. This module reads that tracker for the run in flight
 * and calls `tracker.complete`,
 * and it hands the resulting `EndResult` to `deps.onEnd`. It never builds an
 * event and never runs a handler: the end handlers run later, at
 * `agent_settled`, from the adapter, which gates each one first. Redaction of
 * `reason`, `summary` and `artifacts` happens where the event is built
 * (`buildEndEvent` in agent-core), not here; payload.ts exposes no size bound,
 * so none is applied, and the acknowledgement never repeats what the model
 * wrote.
 *
 * The tool takes exactly `outcome`, `reason`, `summary` and `artifacts`. The
 * schema forbids any other field, so a call cannot name a handler or an
 * executable, and nothing in `execute` could act on one. Trust is granted only
 * by the user (the trust command); this tool has no part in it.
 *
 * Which run a call is about. The tracker has no run id guard on `complete`,
 * and the instruction is the same text for every command, so a call carries no
 * run id and is never matched to a run by name. The adapter supplies
 * `mayComplete` instead: it refuses a call while the run in flight has not had
 * its prompt delivered to the model (its start handlers are still running, or
 * the host still holds its prompt in the queue behind a loop that was already
 * streaming), because a call made then comes from an earlier command's loop,
 * and ending the newer run with it would record a success that run never
 * reached. Known limit: once the newer prompt has been delivered, a call that
 * is really about the earlier command, made later in the same loop, cannot be
 * told apart and ends the newer run.
 */
import type { CommandRunTracker, CompletionInput, EndResult } from "@sunstone-partners/ensemble-agent-core";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

/** The tool's name; part of the model-facing instruction. */
export const COMPLETION_TOOL_NAME = "ensemble_command_complete";

/**
 * The one instruction appended to a turn's system prompt while a command run
 * is in flight. The same text for every command (AC-021-1). It tells the model
 * to signal completion and nothing more: it names no handler and offers no way
 * to start one.
 */
export const COMPLETION_INSTRUCTION = [
  "Ensemble command completion:",
  `When the Ensemble command you are running has finished its work, or has failed (for example it hit a hard stop or rejected its arguments), call the ${COMPLETION_TOOL_NAME} tool exactly once.`,
  'Use outcome "succeeded" when the work is done. Use outcome "failed" with a short reason when it is not. A summary and the paths of the artifacts you produced are optional.',
  "The tool only records how the command ended. It never names, selects or starts anything else, and you must not try to name or start any hook handler yourself.",
].join("\n");

/** Acknowledgement when the call ended a run. Fixed text: it never repeats the model's words. */
export const COMPLETION_ACKNOWLEDGEMENT = "Command completion recorded.";

/** Acknowledgement when no run was in flight (a repeated call, or none ever began). Harmless, not an error. */
export const COMPLETION_NOT_IN_FLIGHT = "No command run is in flight; nothing was recorded.";

/**
 * Acknowledgement when `mayComplete` refused the call: the run in flight has not
 * begun its work, so the call belongs to an earlier command. It tells the model
 * to call again once the current command's own work is done.
 */
export const COMPLETION_NOT_STARTED =
  "Nothing was recorded: the command now in flight has not begun its work, so this call belongs to an earlier command. Call this tool again when the current command's own work is done.";

/** What the adapter supplies. */
export interface CompletionDeps {
  /**
   * The session's tracker, shared with the rest of the adapter. Called with the
   * context of the event or tool call at hand; it must return the same tracker
   * on every call.
   */
  trackerFor: (ctx: ExtensionContext) => CommandRunTracker;
  /**
   * Called once for every call that ended a run, with the end the tracker
   * produced. The adapter queues it for the end handlers at `agent_settled`.
   * Awaited before the tool result is returned; a throw reaches the model as
   * a failed tool call.
   */
  onEnd: (ctx: ExtensionContext, end: EndResult) => void | Promise<void>;
  /**
   * Whether a call made now may end the run in flight. When it answers false the
   * run stays in flight and the call is acknowledged with `COMPLETION_NOT_STARTED`.
   * Defaults to always. It is not asked when no run is in flight.
   */
  mayComplete?: (ctx: ExtensionContext) => boolean;
}

/** The host surface this module uses. */
export type CompletionHost = Pick<ExtensionAPI, "registerTool" | "on">;

/**
 * The tool's parameters, as plain JSON Schema (a TypeBox schema is one). The
 * extension bundle cannot resolve `typebox` and Pi's argument validation
 * accepts this form. `additionalProperties: false` keeps any other field,
 * such as a handler name, out of a call.
 */
export const COMPLETION_PARAMETERS = {
  type: "object",
  properties: {
    outcome: {
      type: "string",
      enum: ["succeeded", "failed"],
      description: "succeeded when the command's work is done; failed when it could not be done.",
    },
    reason: { type: "string", description: "Why the command failed. Give one whenever the outcome is failed." },
    summary: { type: "string", description: "One or two sentences on what the command did." },
    artifacts: {
      type: "array",
      items: { type: "string" },
      description: "Paths of the files the command produced.",
    },
  },
  required: ["outcome"],
  additionalProperties: false,
} as const;

/**
 * Register the completion tool and the per-turn instruction. Registration is
 * the only effect; nothing runs until the host fires an event or the model
 * calls the tool.
 */
export function registerCompletion(pi: CompletionHost, deps: CompletionDeps): void {
  const { trackerFor, onEnd, mayComplete } = deps;

  pi.registerTool({
    name: COMPLETION_TOOL_NAME,
    label: "Command complete",
    description:
      "Record that the Ensemble command you are running has finished (succeeded) or failed. Call it once, when the command's work is over.",
    parameters: COMPLETION_PARAMETERS,
    // Pi 1.2.0 passes an ExtensionToolContext, which extends ExtensionContext.
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const input: CompletionInput = { outcome: params.outcome };
      if (params.reason !== undefined) input.reason = params.reason;
      if (params.summary !== undefined) input.summary = params.summary;
      if (params.artifacts !== undefined) input.artifacts = [...params.artifacts];

      const tracker = trackerFor(ctx);
      const refused = tracker.current() !== undefined && mayComplete?.(ctx) === false;
      const end = refused ? undefined : tracker.complete(input);
      if (end) await onEnd(ctx, end);
      return {
        content: [{ type: "text", text: end ? COMPLETION_ACKNOWLEDGEMENT : refused ? COMPLETION_NOT_STARTED : COMPLETION_NOT_IN_FLIGHT }],
        details: { recorded: end !== undefined },
      };
    },
  });

  pi.on("before_agent_start", (event, ctx) => {
    if (!trackerFor(ctx).current()) return undefined;
    // Pi 1.2.0 replaces the whole system prompt with `systemPrompt`, so append.
    if (event.systemPrompt.includes(COMPLETION_INSTRUCTION)) return undefined;
    return { systemPrompt: `${event.systemPrompt}\n\n${COMPLETION_INSTRUCTION}` };
  });
}
