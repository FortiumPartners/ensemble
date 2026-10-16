/**
 * Types for command lifecycle hooks. See
 * docs/TRD/TRD-2026-f08a2a09-command-lifecycle-hooks.md (Interface contract)
 * and docs/PRD/PRD-2026-f08a2a09-command-lifecycle-hooks.md.
 *
 * These types are harness-neutral: nothing here names a harness event. An
 * adapter (packages/pi-extension/src/lifecycle) connects them to a host.
 */

/** The two lifecycle events (REQ-001). */
export type LifecycleEventName = "command.start" | "command.end";

/** The keys a command selection may use to pick handlers for an event. */
export type SelectionKey = "start" | "end";

/** How a command ended (REQ-001, REQ-021). */
export type CommandOutcome = "succeeded" | "failed" | "cancelled";

/** What happens when a handler fails (REQ-010). `block` is valid for start only. */
export type ErrorPolicy = "continue" | "block";

export type HandlerType = "shell" | "prompt";

/** Default timeouts, applied when a handler states none (AC-009-5, AC-011-5). */
export const DEFAULT_SHELL_TIMEOUT_MS = 5000;
export const DEFAULT_PROMPT_TIMEOUT_MS = 30000;

/**
 * A shell handler. `command` is an executable path or a bare name looked up
 * on PATH, never a shell line; `args` is an array so no argument is ever
 * interpreted by a shell (AC-009-2).
 */
export interface ShellHandler {
  type: "shell";
  command: string;
  args: string[];
  timeout_ms: number;
  on_error: ErrorPolicy;
}

/** A prompt handler: `prompt` is a path to a prompt file, relative to the project root. */
export interface PromptHandler {
  type: "prompt";
  prompt: string;
  timeout_ms: number;
  on_error: ErrorPolicy;
}

export type Handler = ShellHandler | PromptHandler;

/** The handlers a command selects for each event, by name, in run order. */
export interface CommandSelection {
  start: string[];
  end: string[];
}

/** A validated `.ensemble/hooks.yaml`, with defaults applied. */
export interface HooksConfig {
  version: 1;
  hooks: Record<string, Handler>;
  commands: Record<string, CommandSelection>;
}

/** One validation failure. `path` names the offending entry, e.g. `hooks.audit.on_error`. */
export interface ConfigError {
  path: string;
  message: string;
}

/** Result of loading `.ensemble/hooks.yaml`. `absent` is not an error (REQ-008). */
export type LoadHooksResult =
  | { status: "absent" }
  | { status: "valid"; config: HooksConfig }
  | { status: "invalid"; errors: ConfigError[] };

/** A finding reported by a prompt handler (REQ-011). */
export interface Finding {
  message: string;
  severity?: "info" | "warning" | "error";
  path?: string;
}

/** The typed response a prompt handler must produce (REQ-011). */
export interface PromptResponse {
  continue: boolean;
  message?: string;
  findings?: Finding[];
}

/** The event delivered to every handler (REQ-005). End-only fields are optional. */
export interface LifecycleEvent {
  event: LifecycleEventName;
  run_id: string;
  command: string;
  arguments: string;
  cwd: string;
  session_id: string;
  timestamp: string;
  outcome?: CommandOutcome;
  duration_ms?: number;
  reason?: string;
  artifacts?: string[];
  summary?: string;
}

export type HandlerStatus = "succeeded" | "failed" | "timed_out" | "blocked";

/** What one handler did (REQ-013). */
export interface HandlerOutcome {
  handler: string;
  status: HandlerStatus;
  duration_ms: number;
  exit_code?: number;
  truncated?: boolean;
  message?: string;
  findings?: Finding[];
}
