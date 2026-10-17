/**
 * Tests for the capability table and the unsupported-hook warning (TRD-014-TEST).
 * (docs/TRD/TRD-2026-f08a2a09-command-lifecycle-hooks.md#trd-014-test)
 *
 * PRD ACs: AC-014-1, AC-014-2, AC-014-3, AC-014-4, AC-015-5, AC-017-1, AC-017-2.
 */

import {
  CAPABILITY_NAMES,
  HARNESS_CAPABILITIES,
  HARNESS_NAMES,
  HarnessCapabilities,
  HarnessName,
  PI_END_DEFINITION,
  renderCapabilityTable,
  unsupportedHookWarnings,
} from "../../src/lifecycle-hooks/capabilities";
import { validateHooksConfig } from "../../src/lifecycle-hooks/config";
import type { HooksConfig } from "../../src/lifecycle-hooks/types";

const ADAPTERLESS: HarnessName[] = ["claude-code", "codex", "opencode"];

/** A validated config with a start hook, an end hook, a hook used for both, and one no command selects. */
function config(): HooksConfig {
  const result = validateHooksConfig(
    {
      version: 1,
      hooks: {
        audit: { type: "shell", command: "./scripts/audit.sh", args: [], on_error: "continue" },
        review: { type: "prompt", prompt: "./prompts/review.md", on_error: "continue" },
        both: { type: "shell", command: "./scripts/both.sh", args: [], on_error: "continue" },
        idle: { type: "shell", command: "./scripts/idle.sh", args: [], on_error: "continue" },
      },
      commands: {
        "ensemble:create-prd": { start: ["audit", "both"], end: ["review", "both"] },
      },
    },
    { projectRoot: "/virtual/project", fileExists: () => true },
  );
  if (!result.ok) throw new Error(`fixture config rejected: ${JSON.stringify(result.errors)}`);
  return result.config;
}

/** The real table with `harness` replaced by `capabilities`. */
function tableWith(harness: HarnessName, capabilities: HarnessCapabilities): Record<HarnessName, HarnessCapabilities> {
  return { ...HARNESS_CAPABILITIES, [harness]: capabilities };
}

describe("capability table (AC-014-1, AC-014-2, AC-015-5)", () => {
  it("table complete: every harness states all three capabilities as booleans", () => {
    expect([...HARNESS_NAMES].sort()).toEqual(["claude-code", "codex", "opencode", "pi"]);
    expect([...CAPABILITY_NAMES]).toEqual(["command_start", "command_end", "command_end_on_cancel"]);
    for (const harness of HARNESS_NAMES) {
      for (const capability of CAPABILITY_NAMES) {
        expect(typeof HARNESS_CAPABILITIES[harness][capability]).toBe("boolean");
      }
    }
  });

  it("Pi supports all three, detecting cancellation through agent_settled.aborted", () => {
    expect(HARNESS_CAPABILITIES.pi).toEqual({
      adapter: true,
      command_start: true,
      command_end: true,
      command_end_on_cancel: true,
    });
  });

  it.each(ADAPTERLESS)("%s has no adapter and every capability is false, none approximated", (harness) => {
    expect(HARNESS_CAPABILITIES[harness]).toEqual({
      adapter: false,
      command_start: false,
      command_end: false,
      command_end_on_cancel: false,
    });
  });

  it("states Pi's end definition: completion signal, error outcome, abort signal, next command, shutdown", () => {
    expect(PI_END_DEFINITION).toMatch(/completion signal/);
    expect(PI_END_DEFINITION).toMatch(/error outcome/);
    expect(PI_END_DEFINITION).toMatch(/abort signal/);
    expect(PI_END_DEFINITION).toMatch(/agent_settled with aborted true/);
    expect(PI_END_DEFINITION).toMatch(/next selected command/);
    expect(PI_END_DEFINITION).toMatch(/session shutdown/);
    expect(PI_END_DEFINITION).toMatch(/never ends a command/);
  });

  it("the table is frozen, so a caller cannot change what a harness supports", () => {
    expect(Object.isFrozen(HARNESS_CAPABILITIES)).toBe(true);
    for (const harness of HARNESS_NAMES) expect(Object.isFrozen(HARNESS_CAPABILITIES[harness])).toBe(true);
  });
});

describe("unsupported-hook warning (AC-014-3, AC-017-1)", () => {
  it("warning not silent: an adapter-less harness warns for each selected hook, naming hook, command and capability", () => {
    const warnings = unsupportedHookWarnings(config(), "codex");
    // start: audit, both -> command_start; end: review, both -> command_end and command_end_on_cancel.
    expect(warnings.map((w) => [w.hook, w.selection, w.capability])).toEqual([
      ["audit", "start", "command_start"],
      ["both", "start", "command_start"],
      ["review", "end", "command_end"],
      ["review", "end", "command_end_on_cancel"],
      ["both", "end", "command_end"],
      ["both", "end", "command_end_on_cancel"],
    ]);
    const first = warnings[0];
    expect(first.harness).toBe("codex");
    expect(first.command).toBe("ensemble:create-prd");
    expect(first.handler).toBe("./scripts/audit.sh");
    expect(first.message).toContain('"audit"');
    expect(first.message).toContain("./scripts/audit.sh");
    expect(first.message).toContain("ensemble:create-prd");
    expect(first.message).toContain("command_start");
    expect(first.message).toContain("codex");
    expect(warnings[2].handler).toBe("./prompts/review.md");
  });

  it("Pi supports everything, so a config for Pi yields no warning", () => {
    expect(unsupportedHookWarnings(config(), "pi")).toEqual([]);
  });

  it("a hook that no command selects does not run and is not reported", () => {
    const names = new Set(unsupportedHookWarnings(config(), "opencode").map((w) => w.hook));
    expect(names.has("idle")).toBe(false);
    expect(names).toEqual(new Set(["audit", "both", "review"]));
  });

  it("a harness that can start but not end warns only for the end hooks", () => {
    const table = tableWith("claude-code", {
      adapter: true,
      command_start: true,
      command_end: false,
      command_end_on_cancel: false,
    });
    const warnings = unsupportedHookWarnings(config(), "claude-code", table);
    expect(warnings.every((w) => w.selection === "end")).toBe(true);
    expect(warnings.map((w) => w.capability)).toEqual([
      "command_end",
      "command_end_on_cancel",
      "command_end",
      "command_end_on_cancel",
    ]);
  });

  it("an end hook on a harness that ends commands but not on cancel reports command_end_on_cancel (AC-017-1)", () => {
    const table = tableWith("codex", { adapter: true, command_start: true, command_end: true, command_end_on_cancel: false });
    const warnings = unsupportedHookWarnings(config(), "codex", table);
    expect(warnings.map((w) => [w.hook, w.capability])).toEqual([
      ["review", "command_end_on_cancel"],
      ["both", "command_end_on_cancel"],
    ]);
    expect(warnings[0].message).toContain("command_end_on_cancel");
  });

  it("does not change the configuration it is given", () => {
    const original = config();
    const before = JSON.stringify(original);
    unsupportedHookWarnings(original, "codex");
    expect(JSON.stringify(original)).toBe(before);
  });
});

describe("rendered table (AC-014-4, AC-015-5, AC-017-2)", () => {
  /** The row of `harness` in the rendered table: its cells after the name. */
  function row(text: string, harness: string): string[] {
    const line = text.split("\n").find((l) => l.startsWith(harness + " "));
    if (line === undefined) throw new Error(`no row for ${harness} in:\n${text}`);
    return line.trim().split(/\s+/).slice(1);
  }

  it("lists every harness with its adapter flag and the three capabilities, as the table states them", () => {
    const text = renderCapabilityTable();
    expect(text.split("\n")[0].trim().split(/\s+/)).toEqual([
      "harness",
      "adapter",
      "command_start",
      "command_end",
      "command_end_on_cancel",
    ]);
    expect(row(text, "pi")).toEqual(["yes", "true", "true", "true"]);
    for (const harness of ADAPTERLESS) expect(row(text, harness)).toEqual(["no", "false", "false", "false"]);
  });

  it("renders the table it is given, not a fixed text", () => {
    const text = renderCapabilityTable(
      tableWith("codex", { adapter: true, command_start: true, command_end: false, command_end_on_cancel: false }),
    );
    expect(row(text, "codex")).toEqual(["yes", "true", "false", "false"]);
    expect(text).not.toMatch(/not active in [^\n]*codex/);
  });

  it("states Pi's end definition and that adapter-less harnesses are inactive with nothing shown at command time", () => {
    const text = renderCapabilityTable();
    expect(text).toContain(PI_END_DEFINITION);
    expect(text).toContain("not active in claude-code, codex, opencode");
    expect(text).toContain("nothing is shown when a command runs");
  });
});
