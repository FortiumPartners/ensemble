import cp = require("node:child_process");
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { CommandRunTracker } from "@sunstone-partners/ensemble-agent-core";
import type { EndResult } from "@sunstone-partners/ensemble-agent-core";
import {
  COMPLETION_ACKNOWLEDGEMENT,
  COMPLETION_INSTRUCTION,
  COMPLETION_NOT_IN_FLIGHT,
  COMPLETION_TOOL_NAME,
  registerCompletion,
} from "../src/lifecycle/completion";
import type { CompletionHost } from "../src/lifecycle/completion";

/**
 * Completion tool and per-turn instruction (TRD-011-TEST; PRD AC-021-1,
 * AC-021-2, AC-021-6, AC-021-7).
 *
 * A fake host records what `registerCompletion` registers; the tracker is the
 * real one from agent-core. Tests drive the registered tool and the registered
 * `before_agent_start` handler exactly as Pi would.
 */

interface CapturedTool {
  name: string;
  parameters: {
    type: string;
    properties: Record<string, unknown>;
    required: string[];
    additionalProperties: boolean;
  };
  execute: (
    toolCallId: string,
    params: Record<string, unknown>,
    signal: undefined,
    onUpdate: undefined,
    ctx: unknown,
  ) => Promise<{ content: { type: string; text: string }[]; details: unknown }>;
}

type PromptHandler = (event: Record<string, unknown>, ctx: unknown) => { systemPrompt?: string } | undefined;

const BASE_PROMPT = "You are a coding agent.\nBe brief.";

function setup() {
  const tools: CapturedTool[] = [];
  const handlers: { event: string; handler: PromptHandler }[] = [];
  const host = {
    registerTool: jest.fn((tool: CapturedTool) => {
      tools.push(tool);
    }),
    on: jest.fn((event: string, handler: PromptHandler) => {
      handlers.push({ event, handler });
      return () => undefined;
    }),
  };
  let ids = 0;
  const tracker = new CommandRunTracker({ sessionId: "s-1", now: () => 1000, newId: () => `run-${++ids}` });
  const ends: EndResult[] = [];
  const ctx = { sessionManager: { getSessionId: () => "s-1" } };
  const trackerCtxs: unknown[] = [];
  const endCtxs: unknown[] = [];
  registerCompletion(host as unknown as CompletionHost, {
    trackerFor: (c) => {
      trackerCtxs.push(c);
      return tracker;
    },
    onEnd: async (c, end) => {
      endCtxs.push(c);
      ends.push(end);
    },
  });

  const tool = tools[0];
  const beforeAgentStart = handlers.find((h) => h.event === "before_agent_start")?.handler;
  if (!tool || !beforeAgentStart) throw new Error("registerCompletion did not register the tool and the handler");

  const begin = (command: string, args = "") => tracker.begin({ command, arguments: args, cwd: "/work" });
  const call = (params: Record<string, unknown>) => tool.execute("call-1", params, undefined, undefined, ctx);
  const turn = (systemPrompt = BASE_PROMPT) =>
    beforeAgentStart({ type: "before_agent_start", prompt: "go", systemPrompt, systemPromptOptions: {} }, ctx);
  return { host, tools, handlers, tracker, ends, ctx, trackerCtxs, endCtxs, tool, begin, call, turn };
}

const PROCESS_FUNCTIONS = ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"] as const;

function watchProcesses() {
  const spies = PROCESS_FUNCTIONS.map((name) => jest.spyOn(cp, name).mockImplementation(() => {
    throw new Error(`child_process.${name} must not be called by the completion module`);
  }));
  return {
    started: () => spies.reduce((n, spy) => n + spy.mock.calls.length, 0),
    restore: () => spies.forEach((spy) => spy.mockRestore()),
  };
}

describe("registration", () => {
  it("registers exactly one tool and one before_agent_start handler, with no other effect", () => {
    const watch = watchProcesses();
    try {
      const { host, tools, handlers, tracker, ends } = setup();
      expect(host.registerTool).toHaveBeenCalledTimes(1);
      expect(host.on).toHaveBeenCalledTimes(1);
      expect(tools[0].name).toBe("ensemble_command_complete");
      expect(tools[0].name).toBe(COMPLETION_TOOL_NAME);
      expect(handlers.map((h) => h.event)).toEqual(["before_agent_start"]);
      expect(tracker.current()).toBeUndefined();
      expect(ends).toEqual([]);
      expect(watch.started()).toBe(0);
    } finally {
      watch.restore();
    }
  });
});

describe("tool parameters (model cannot start handlers)", () => {
  it("takes exactly outcome, reason, summary and artifacts, and outcome is required", () => {
    const { tool } = setup();
    expect(tool.parameters.type).toBe("object");
    expect(Object.keys(tool.parameters.properties).sort()).toEqual(["artifacts", "outcome", "reason", "summary"]);
    expect(tool.parameters.required).toEqual(["outcome"]);
  });

  it("limits outcome to succeeded and failed, never cancelled", () => {
    const { tool } = setup();
    const outcome = tool.parameters.properties.outcome as { enum: string[] };
    expect(outcome.enum).toEqual(["succeeded", "failed"]);
  });

  it("types reason and summary as strings and artifacts as an array of strings", () => {
    const { tool } = setup();
    const props = tool.parameters.properties as Record<string, { type: string; items?: { type: string } }>;
    expect(props.reason.type).toBe("string");
    expect(props.summary.type).toBe("string");
    expect(props.artifacts.type).toBe("array");
    expect(props.artifacts.items).toEqual({ type: "string" });
  });

  it("forbids every other field, so a call cannot name a handler or an executable", () => {
    const { tool } = setup();
    expect(tool.parameters.additionalProperties).toBe(false);
    for (const name of Object.keys(tool.parameters.properties)) {
      expect(name).not.toMatch(/handler|exec|command|script|shell|run|program|binary|hook/i);
    }
  });

  it("ignores a handler field smuggled into a call: nothing starts and the end carries no such field", async () => {
    const watch = watchProcesses();
    try {
      const { begin, call, ends } = setup();
      begin("ensemble:create-prd");
      await call({ outcome: "succeeded", handler: "/bin/evil", executable: "/bin/evil", command: "rm -rf /" });
      expect(watch.started()).toBe(0);
      expect(ends).toHaveLength(1);
      expect(JSON.stringify(ends[0])).not.toContain("evil");
      expect(Object.keys(ends[0]).sort()).toEqual(
        ["arguments", "command", "cwd", "duration_ms", "outcome", "run_id", "session_id"].sort(),
      );
    } finally {
      watch.restore();
    }
  });
});

describe("tool execute", () => {
  it("marks the run in flight as ended with the stated outcome, summary and artifacts (AC-021-2)", async () => {
    const { begin, call, ends, tracker } = setup();
    const { run } = begin("ensemble:create-prd", "checkout");
    const result = await call({ outcome: "succeeded", summary: "Wrote the PRD.", artifacts: ["docs/PRD/x.md"] });

    expect(ends).toHaveLength(1);
    expect(ends[0]).toMatchObject({
      run_id: run.run_id,
      command: "ensemble:create-prd",
      arguments: "checkout",
      outcome: "succeeded",
      summary: "Wrote the PRD.",
      artifacts: ["docs/PRD/x.md"],
    });
    expect(tracker.current()).toBeUndefined();
    expect(result.content).toEqual([{ type: "text", text: COMPLETION_ACKNOWLEDGEMENT }]);
  });

  it("carries both the failed outcome and its reason (AC-021-2, AC-021-7)", async () => {
    const { begin, call, ends } = setup();
    begin("ensemble:implement-trd", "TRD-1");
    await call({ outcome: "failed", reason: "Hard stop: the TRD has no tasks." });
    expect(ends).toHaveLength(1);
    expect(ends[0].outcome).toBe("failed");
    expect(ends[0].reason).toBe("Hard stop: the TRD has no tasks.");
  });

  it("acknowledges briefly and does not repeat what the model wrote", async () => {
    const { begin, call } = setup();
    begin("ensemble:create-prd");
    const result = await call({ outcome: "failed", reason: "password=hunter2 leaked", summary: "secret-summary" });
    const text = result.content.map((c) => c.text).join("");
    expect(text).toBe(COMPLETION_ACKNOWLEDGEMENT);
    expect(text).not.toContain("hunter2");
    expect(text).not.toContain("secret-summary");
  });

  it("produces exactly one end when called twice (AC-021-6)", async () => {
    const { begin, call, ends } = setup();
    begin("ensemble:create-prd");
    const first = await call({ outcome: "succeeded" });
    const second = await call({ outcome: "failed", reason: "late second call" });

    expect(ends).toHaveLength(1);
    expect(ends[0].outcome).toBe("succeeded");
    expect(first.content[0].text).toBe(COMPLETION_ACKNOWLEDGEMENT);
    expect(second.content[0].text).toBe(COMPLETION_NOT_IN_FLIGHT);
  });

  it("acknowledges harmlessly when no run is in flight", async () => {
    const { call, ends } = setup();
    const result = await call({ outcome: "succeeded" });
    expect(ends).toEqual([]);
    expect(result.content).toEqual([{ type: "text", text: COMPLETION_NOT_IN_FLIGHT }]);
  });

  it("ends only the run in flight: a new run after a completed one ends separately", async () => {
    const { begin, call, ends } = setup();
    begin("ensemble:create-prd");
    await call({ outcome: "succeeded" });
    begin("ensemble:create-trd");
    await call({ outcome: "failed", reason: "no PRD" });
    expect(ends.map((e) => [e.command, e.outcome])).toEqual([
      ["ensemble:create-prd", "succeeded"],
      ["ensemble:create-trd", "failed"],
    ]);
  });

  it("never starts a process: executing the tool runs no handler", async () => {
    const watch = watchProcesses();
    try {
      const { begin, call, turn } = setup();
      begin("ensemble:create-prd");
      turn();
      await call({ outcome: "succeeded", summary: "done" });
      await call({ outcome: "failed", reason: "again" });
      expect(watch.started()).toBe(0);
    } finally {
      watch.restore();
    }
  });
});

describe("host context", () => {
  it("resolves the tracker from the tool call's context and hands the same context to onEnd", async () => {
    const { begin, call, ctx, trackerCtxs, endCtxs } = setup();
    begin("ensemble:create-prd");
    await call({ outcome: "succeeded" });
    expect(trackerCtxs).toEqual([ctx]);
    expect(trackerCtxs[0]).toBe(ctx);
    expect(endCtxs).toHaveLength(1);
    expect(endCtxs[0]).toBe(ctx);
  });

  it("resolves the tracker from the before_agent_start context", () => {
    const { begin, turn, ctx, trackerCtxs } = setup();
    begin("ensemble:create-prd");
    turn();
    expect(trackerCtxs).toHaveLength(1);
    expect(trackerCtxs[0]).toBe(ctx);
  });

  it("does not ask for a tracker at registration, when no session id is readable yet", () => {
    const { trackerCtxs } = setup();
    expect(trackerCtxs).toEqual([]);
  });

  it("does not call onEnd when no run ended", async () => {
    const { call, endCtxs } = setup();
    await call({ outcome: "succeeded" });
    expect(endCtxs).toEqual([]);
  });
});

describe("per-turn instruction", () => {
  it("appends the instruction to the system prompt while a run is in flight (AC-021-1)", () => {
    const { begin, turn } = setup();
    begin("ensemble:create-prd");
    expect(turn()).toEqual({ systemPrompt: `${BASE_PROMPT}\n\n${COMPLETION_INSTRUCTION}` });
  });

  it("appends the same instruction for two different commands", () => {
    const { begin, turn } = setup();
    begin("ensemble:create-prd", "feature one");
    const first = turn()?.systemPrompt;
    begin("ensemble:implement-trd", "TRD-9 --execute");
    const second = turn()?.systemPrompt;

    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(first).toBe(second);
    expect(first).toBe(`${BASE_PROMPT}\n\n${COMPLETION_INSTRUCTION}`);
    expect(COMPLETION_INSTRUCTION).not.toContain("create-prd");
    expect(COMPLETION_INSTRUCTION).not.toContain("implement-trd");
  });

  it("injects nothing when no run is in flight: the system prompt is left unchanged", () => {
    const { turn } = setup();
    expect(turn()).toBeUndefined();
  });

  it("stops injecting once the run has ended", async () => {
    const { begin, call, turn } = setup();
    begin("ensemble:create-prd");
    expect(turn()).toBeDefined();
    await call({ outcome: "succeeded" });
    expect(turn()).toBeUndefined();
  });

  it("injects on every turn of a run still in flight, one instruction per turn", () => {
    const { begin, turn } = setup();
    begin("ensemble:create-prd");
    for (let i = 0; i < 3; i++) {
      const prompt = turn()?.systemPrompt ?? "";
      expect(prompt.split(COMPLETION_INSTRUCTION)).toHaveLength(2);
    }
  });

  it("does not append a second copy to a prompt that already carries it", () => {
    const { begin, turn } = setup();
    begin("ensemble:create-prd");
    expect(turn(`${BASE_PROMPT}\n\n${COMPLETION_INSTRUCTION}`)).toBeUndefined();
  });

  it("starts nothing when it injects", () => {
    const watch = watchProcesses();
    try {
      const { begin, turn } = setup();
      begin("ensemble:create-prd");
      turn();
      expect(watch.started()).toBe(0);
    } finally {
      watch.restore();
    }
  });

  it("tells the model to call the tool once, with a reason on failure, and never to name or start handlers", () => {
    expect(COMPLETION_INSTRUCTION).toContain(COMPLETION_TOOL_NAME);
    expect(COMPLETION_INSTRUCTION).toMatch(/exactly once/);
    expect(COMPLETION_INSTRUCTION).toMatch(/finished its work/);
    expect(COMPLETION_INSTRUCTION).toMatch(/failed/);
    expect(COMPLETION_INSTRUCTION).toMatch(/reason/);
    expect(COMPLETION_INSTRUCTION).toMatch(/never names, selects or starts anything else/);
    expect(COMPLETION_INSTRUCTION).toMatch(/must not try to name or start any hook handler/);
  });
});

describe("generated prompts untouched (AC-021-1)", () => {
  const promptsDir = join(__dirname, "..", "..", "pi", "prompts");

  function markdownFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((entry) => {
      const full = join(dir, entry);
      return statSync(full).isDirectory() ? markdownFiles(full) : full.endsWith(".md") ? [full] : [];
    });
  }

  it("has generated prompts to search", () => {
    expect(existsSync(promptsDir)).toBe(true);
    expect(markdownFiles(promptsDir).length).toBeGreaterThan(10);
  });

  it("contains no completion step, hooks file reference or lifecycle event name", () => {
    const forbidden = [
      COMPLETION_TOOL_NAME,
      COMPLETION_INSTRUCTION,
      COMPLETION_INSTRUCTION.split("\n")[0],
      ".ensemble/hooks.yaml",
      "command.start",
      "command.end",
      "lifecycle hook",
    ];
    for (const file of markdownFiles(promptsDir)) {
      const text = readFileSync(file, "utf8");
      for (const needle of forbidden) {
        expect({ file, needle, found: text.includes(needle) }).toEqual({ file, needle, found: false });
      }
    }
  });
});
