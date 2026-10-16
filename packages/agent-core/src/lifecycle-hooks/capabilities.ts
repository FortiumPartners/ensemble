/**
 * Per-harness lifecycle capabilities, the warning for a hook that needs a
 * capability the harness lacks, and the text rendering of the table
 * (REQ-014, REQ-017, AC-015-5).
 *
 * The table is plain data, so it can be read without running a command
 * (AC-014-4). A capability a harness cannot reliably observe is `false` and is
 * never approximated with a session or turn event (AC-014-2).
 */

import type { HooksConfig, SelectionKey } from "./types";

export type HarnessName = "pi" | "claude-code" | "codex" | "opencode";

export type CapabilityName = "command_start" | "command_end" | "command_end_on_cancel";

export interface HarnessCapabilities {
  /** True only where code of this project runs in the harness to deliver lifecycle events. */
  adapter: boolean;
  command_start: boolean;
  command_end: boolean;
  command_end_on_cancel: boolean;
}

export const HARNESS_NAMES: readonly HarnessName[] = Object.freeze(["pi", "claude-code", "codex", "opencode"]);

export const CAPABILITY_NAMES: readonly CapabilityName[] = Object.freeze([
  "command_start",
  "command_end",
  "command_end_on_cancel",
]);

/**
 * Pi: all three, measured in Pi 1.2.0 (TRD probe results). Cancellation is
 * detected from `agent_settled.aborted === true`, observed in 10 of 10 aborts;
 * an abort emits no `agent_before_settle`. The other three harnesses have no
 * adapter, so all three capabilities are `false` there.
 */
export const HARNESS_CAPABILITIES: Readonly<Record<HarnessName, Readonly<HarnessCapabilities>>> = Object.freeze({
  pi: Object.freeze({ adapter: true, command_start: true, command_end: true, command_end_on_cancel: true }),
  "claude-code": Object.freeze({
    adapter: false,
    command_start: false,
    command_end: false,
    command_end_on_cancel: false,
  }),
  codex: Object.freeze({ adapter: false, command_start: false, command_end: false, command_end_on_cancel: false }),
  opencode: Object.freeze({
    adapter: false,
    command_start: false,
    command_end: false,
    command_end_on_cancel: false,
  }),
});

/**
 * What ends a command in Pi (AC-015-5). A settled loop alone never ends one.
 * Each clause names the host signal it is detected from.
 */
export const PI_END_DEFINITION =
  "In Pi a command ends at the completion signal (the ensemble_command_complete tool call, handled after the " +
  "command's final output at agent_settled), an error outcome (agent_before_settle with outcome error), an abort " +
  "signal (agent_settled with aborted true; an abort emits no agent_before_settle), the next selected command's " +
  "input, or session shutdown. A settle that is none of these never ends a command.";

/** The capabilities a hook needs, by the selection key that names it. An end hook also runs for a cancelled command. */
const NEEDED_BY_SELECTION: Readonly<Record<SelectionKey, readonly CapabilityName[]>> = {
  start: ["command_start"],
  end: ["command_end", "command_end_on_cancel"],
};

/** One configured hook, selected by a command, that needs a capability the harness lacks. */
export interface UnsupportedHookWarning {
  harness: HarnessName;
  /** The hook's name in `hooks`. */
  hook: string;
  /** The hook's executable (shell) or prompt file (prompt). */
  handler: string;
  /** The command whose selection names the hook. */
  command: string;
  selection: SelectionKey;
  capability: CapabilityName;
  message: string;
}

/**
 * One warning per (selected hook, missing capability), in the order the
 * commands and their selections are configured. A hook that no command
 * selects never runs, so it is not reported. A hook selected for `end` needs
 * `command_end` and also `command_end_on_cancel`, because an end handler runs
 * whatever the outcome, cancelled included. Pure: the table is a parameter so
 * tests can state a harness the real table does not have.
 */
export function unsupportedHookWarnings(
  config: HooksConfig,
  harness: HarnessName,
  table: Readonly<Record<HarnessName, Readonly<HarnessCapabilities>>> = HARNESS_CAPABILITIES,
): UnsupportedHookWarning[] {
  const supported = table[harness];
  const warnings: UnsupportedHookWarning[] = [];
  for (const [command, selection] of Object.entries(config.commands)) {
    for (const key of ["start", "end"] as const) {
      for (const hook of selection[key]) {
        const handler = config.hooks[hook];
        if (handler === undefined) continue;
        const target = handler.type === "shell" ? handler.command : handler.prompt;
        for (const capability of NEEDED_BY_SELECTION[key]) {
          if (supported[capability]) continue;
          warnings.push({
            harness,
            hook,
            handler: target,
            command,
            selection: key,
            capability,
            message:
              `Hook "${hook}" (${handler.type} ${target}), selected by ${command} for ${key}, ` +
              `needs ${capability}, which ${harness} does not support; it will not run.`,
          });
        }
      }
    }
  }
  return warnings;
}

/**
 * The table as text, readable without running a command (AC-014-4), followed
 * by Pi's end definition and, when any harness has no adapter, a line naming
 * each such harness as inactive (AC-017-2).
 */
export function renderCapabilityTable(
  table: Readonly<Record<HarnessName, Readonly<HarnessCapabilities>>> = HARNESS_CAPABILITIES,
): string {
  const rows = [
    ["harness", "adapter", ...CAPABILITY_NAMES],
    ...HARNESS_NAMES.map((name) => [
      name,
      table[name].adapter ? "yes" : "no",
      ...CAPABILITY_NAMES.map((capability) => (table[name][capability] ? "true" : "false")),
    ]),
  ];
  const widths = rows[0].map((_, column) => Math.max(...rows.map((row) => row[column].length)));
  const lines = rows.map((row) => row.map((cell, column) => cell.padEnd(widths[column])).join("  ").trimEnd());

  lines.push("", "Pi command end: " + PI_END_DEFINITION);
  const adapterless = HARNESS_NAMES.filter((name) => !table[name].adapter);
  if (adapterless.length > 0) {
    lines.push(
      "",
      `Lifecycle hooks are not active in ${adapterless.join(", ")}: there is no adapter, so no code runs there ` +
        "and nothing is shown when a command runs.",
    );
  }
  return lines.join("\n");
}
