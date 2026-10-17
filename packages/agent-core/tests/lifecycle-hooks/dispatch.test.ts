/**
 * Tests for the serial dispatcher and its error policy (TRD-006-TEST).
 * (docs/TRD/TRD-2026-f08a2a09-command-lifecycle-hooks.md#trd-006-test)
 *
 * PRD ACs: AC-010-1,2, AC-012-1..3, AC-013-1,2, AC-020-1,2.
 *
 * The runners are fakes that log every call, so order, overlap and "ran at
 * most once" are asserted from the call log rather than from the outcomes.
 */

import { dispatchHandlers } from "../../src/lifecycle-hooks";
import type {
  DispatchResult,
  Handler,
  HandlerOutcome,
  HandlerRunners,
  HandlerStatus,
  HooksConfig,
  PromptHandler,
  ShellHandler,
} from "../../src/lifecycle-hooks";

const COMMAND = "ensemble:create-prd";
const EVENT_JSON = '{"event":"start","run_id":"run-1","command":"ensemble:create-prd"}';

interface Behaviour {
  /** Fields merged over the default `succeeded` outcome the fake runner returns. */
  outcome?: Partial<HandlerOutcome>;
  /** Pause before settling, so an overlapping dispatcher would be caught. */
  delayMs?: number;
  /** When the key is present the runner rejects with this value (even `undefined`). */
  throws?: unknown;
}

interface Call {
  name: string;
  runner: "shell" | "prompt";
  handler: Handler;
  eventJson: string;
  startedAt: number;
  endedAt: number;
}

interface FakeRunners {
  runners: HandlerRunners;
  calls: Call[];
  state: { active: number; maxActive: number };
}

function fakeRunners(script: Record<string, Behaviour> = {}): FakeRunners {
  const calls: Call[] = [];
  const state = { active: 0, maxActive: 0 };

  async function run(
    runner: Call["runner"],
    name: string,
    handler: Handler,
    eventJson: string,
  ): Promise<HandlerOutcome> {
    const behaviour = script[name] ?? {};
    const call: Call = { name, runner, handler, eventJson, startedAt: performance.now(), endedAt: 0 };
    calls.push(call);
    state.active += 1;
    state.maxActive = Math.max(state.maxActive, state.active);
    try {
      // A real (<= 15 ms) delay is deliberate: fake timers cannot show two runners overlapping.
      if (behaviour.delayMs !== undefined) {
        await new Promise((resolve) => setTimeout(resolve, behaviour.delayMs));
      }
      if ("throws" in behaviour) {
        throw behaviour.throws;
      }
      return { handler: name, status: "succeeded", duration_ms: 1, ...behaviour.outcome };
    } finally {
      state.active -= 1;
      call.endedAt = performance.now();
    }
  }

  return {
    calls,
    state,
    runners: {
      shell: (name, handler, eventJson) => run("shell", name, handler, eventJson),
      prompt: (name, handler, eventJson) => run("prompt", name, handler, eventJson),
    },
  };
}

function shell(overrides: Partial<ShellHandler> = {}): ShellHandler {
  return { type: "shell", command: "audit", args: [], timeout_ms: 5000, on_error: "continue", ...overrides };
}

function prompt(overrides: Partial<PromptHandler> = {}): PromptHandler {
  return { type: "prompt", prompt: "./review.md", timeout_ms: 30000, on_error: "continue", ...overrides };
}

function configOf(hooks: Record<string, Handler>, start: string[], end: string[] = []): HooksConfig {
  return { version: 1, hooks, commands: { [COMMAND]: { start, end } } };
}

function dispatch(
  config: HooksConfig,
  fake: FakeRunners,
  event: "start" | "end" = "start",
  command: string = COMMAND,
): Promise<DispatchResult> {
  return dispatchHandlers({ config, command, event, eventJson: EVENT_JSON, runners: fake.runners });
}

const names = (calls: Call[]): string[] => calls.map((c) => c.name);

describe("dispatchHandlers ordering (AC-010-1, AC-010-2)", () => {
  it("runs handlers in configured order and never overlaps them", async () => {
    const hooks = { a: shell(), b: prompt(), c: shell(), d: shell() };
    // Earlier handlers are slower, so a parallel dispatcher would finish out of order.
    const fake = fakeRunners({
      a: { delayMs: 15 },
      b: { delayMs: 10 },
      c: { delayMs: 5 },
      d: { delayMs: 1 },
    });

    const result = await dispatch(configOf(hooks, ["a", "b", "c", "d"]), fake);

    expect(names(fake.calls)).toEqual(["a", "b", "c", "d"]);
    expect(fake.state.maxActive).toBe(1);
    for (let i = 1; i < fake.calls.length; i += 1) {
      expect(fake.calls[i].startedAt).toBeGreaterThanOrEqual(fake.calls[i - 1].endedAt);
    }
    expect(result.outcomes.map((o) => o.handler)).toEqual(["a", "b", "c", "d"]);
    expect(result.outcomes.every((o) => o.status === "succeeded")).toBe(true);
    expect(result.blocked).toBe(false);
  });

  it("honours a configured order that differs from definition order", async () => {
    const fake = fakeRunners();
    await dispatch(configOf({ a: shell(), b: shell(), c: shell() }, ["c", "a", "b"]), fake);
    expect(names(fake.calls)).toEqual(["c", "a", "b"]);
  });

  it("gives every handler the same event JSON", async () => {
    const fake = fakeRunners();
    await dispatch(configOf({ a: shell(), b: prompt(), c: shell() }, ["a", "b", "c"]), fake);
    expect(fake.calls.map((c) => c.eventJson)).toEqual([EVENT_JSON, EVENT_JSON, EVENT_JSON]);
  });

  it("routes shell handlers to the shell runner and prompt handlers to the prompt runner", async () => {
    const hooks = { sh: shell(), pr: prompt() };
    const fake = fakeRunners();

    await dispatch(configOf(hooks, ["sh", "pr", "sh"]), fake);

    expect(fake.calls.map((c) => c.runner)).toEqual(["shell", "prompt", "shell"]);
    expect(fake.calls[0].handler).toBe(hooks.sh);
    expect(fake.calls[1].handler).toBe(hooks.pr);
  });

  it("selects the handler list for the dispatched event only", async () => {
    const config = configOf({ s: shell(), e: shell() }, ["s"], ["e"]);

    const start = fakeRunners();
    await dispatch(config, start, "start");
    const end = fakeRunners();
    await dispatch(config, end, "end");

    expect(names(start.calls)).toEqual(["s"]);
    expect(names(end.calls)).toEqual(["e"]);
  });

  it("returns each runner outcome unchanged when it succeeds", async () => {
    const outcome: Partial<HandlerOutcome> = {
      status: "succeeded",
      duration_ms: 37,
      exit_code: 0,
      truncated: true,
      message: "all good",
      findings: [{ severity: "info", message: "fine" }],
    };
    const fake = fakeRunners({ a: { outcome } });

    const result = await dispatch(configOf({ a: shell() }, ["a"]), fake);

    expect(result.outcomes).toEqual([{ handler: "a", ...outcome }]);
  });
});

describe("error policy: continue (AC-012-1, AC-013-1)", () => {
  it.each<HandlerStatus>(["failed", "timed_out"])(
    "a %s continue handler does not stop later handlers and does not block",
    async (status) => {
      const hooks = { a: shell({ on_error: "continue" }), b: prompt(), c: shell() };
      const fake = fakeRunners({
        a: { outcome: { status, duration_ms: 42, message: "runner said no", exit_code: 3 } },
      });

      const result = await dispatch(configOf(hooks, ["a", "b", "c"]), fake);

      expect(names(fake.calls)).toEqual(["a", "b", "c"]);
      expect(result.blocked).toBe(false);
      expect(result).not.toHaveProperty("blockedBy");
      expect(result.outcomes).toHaveLength(3);
      expect(result.outcomes[0]).toEqual({
        handler: "a",
        status,
        duration_ms: 42,
        message: "runner said no",
        exit_code: 3,
      });
      expect(result.outcomes[1].status).toBe("succeeded");
      expect(result.outcomes[2].status).toBe("succeeded");
    },
  );

  it("a failed block handler that comes after a failed continue handler still blocks", async () => {
    const hooks = { a: shell({ on_error: "continue" }), b: shell({ on_error: "block" }), c: shell() };
    const fake = fakeRunners({ a: { outcome: { status: "failed" } }, b: { outcome: { status: "failed" } } });

    const result = await dispatch(configOf(hooks, ["a", "b", "c"]), fake);

    expect(names(fake.calls)).toEqual(["a", "b"]);
    expect(result.blocked).toBe(true);
    expect(result.blockedBy).toBe("b");
    expect(result.outcomes.map((o) => o.status)).toEqual(["failed", "blocked"]);
  });
});

describe("error policy: block on start (AC-012-2, AC-012-3, AC-013-2)", () => {
  it.each<HandlerStatus>(["failed", "timed_out"])(
    "a %s block handler is recorded as blocked, names itself and stops later handlers",
    async (status) => {
      const hooks = { first: shell(), gate: shell({ on_error: "block" }), later: prompt(), last: shell() };
      const fake = fakeRunners({
        gate: { outcome: { status, duration_ms: 77, message: "gate refused", exit_code: 9 } },
      });

      const result = await dispatch(configOf(hooks, ["first", "gate", "later", "last"]), fake);

      expect(names(fake.calls)).toEqual(["first", "gate"]);
      expect(result.blocked).toBe(true);
      expect(result.blockedBy).toBe("gate");
      expect(result.outcomes).toEqual([
        { handler: "first", status: "succeeded", duration_ms: 1 },
        { handler: "gate", status: "blocked", duration_ms: 77, message: "gate refused", exit_code: 9 },
      ]);
    },
  );

  it("a block handler that succeeds does not block", async () => {
    const hooks = { gate: shell({ on_error: "block" }), later: shell() };
    const fake = fakeRunners();

    const result = await dispatch(configOf(hooks, ["gate", "later"]), fake);

    expect(names(fake.calls)).toEqual(["gate", "later"]);
    expect(result.blocked).toBe(false);
    expect(result).not.toHaveProperty("blockedBy");
    expect(result.outcomes.map((o) => o.status)).toEqual(["succeeded", "succeeded"]);
  });

  it("a prompt block handler blocks the same way", async () => {
    const hooks = { gate: prompt({ on_error: "block" }), later: shell() };
    const fake = fakeRunners({ gate: { outcome: { status: "failed" } } });

    const result = await dispatch(configOf(hooks, ["gate", "later"]), fake);

    expect(names(fake.calls)).toEqual(["gate"]);
    expect(result.blocked).toBe(true);
    expect(result.blockedBy).toBe("gate");
  });

  it("a runner that throws on a block handler blocks too", async () => {
    const hooks = { gate: shell({ on_error: "block" }), later: shell() };
    const fake = fakeRunners({ gate: { throws: new Error("spawn exploded") } });

    const result = await dispatch(configOf(hooks, ["gate", "later"]), fake);

    expect(names(fake.calls)).toEqual(["gate"]);
    expect(result.blocked).toBe(true);
    expect(result.blockedBy).toBe("gate");
    expect(result.outcomes).toHaveLength(1);
    expect(result.outcomes[0]).toMatchObject({ handler: "gate", status: "blocked" });
    expect(result.outcomes[0].message).toContain("spawn exploded");
  });
});

describe("error policy: end never blocks (AC-012-3)", () => {
  it.each<HandlerStatus>(["failed", "timed_out"])(
    "a %s end handler with on_error block does not block and later handlers still run",
    async (status) => {
      const hooks = { gate: shell({ on_error: "block" }), later: prompt(), last: shell() };
      const fake = fakeRunners({ gate: { outcome: { status, message: "end gate failed" } } });

      const result = await dispatch(configOf(hooks, [], ["gate", "later", "last"]), fake, "end");

      expect(names(fake.calls)).toEqual(["gate", "later", "last"]);
      expect(result.blocked).toBe(false);
      expect(result).not.toHaveProperty("blockedBy");
      expect(result.outcomes.map((o) => [o.handler, o.status])).toEqual([
        ["gate", status],
        ["later", "succeeded"],
        ["last", "succeeded"],
      ]);
      expect(result.outcomes[0].message).toBe("end gate failed");
    },
  );
});

describe("runners that throw or reject (AC-013-1)", () => {
  it.each<[string, unknown, string]>([
    ["an Error", new Error("kaboom"), "kaboom"],
    ["a string", "plain string", "plain string"],
    ["a number", 42, "42"],
    ["null", null, "null"],
    ["undefined", undefined, "undefined"],
    ["a plain object", { code: 1 }, "[object Object]"],
  ])("a runner rejecting with %s becomes a failed outcome, not an exception", async (_label, thrown, text) => {
    const hooks = { a: shell(), b: shell() };
    const fake = fakeRunners({ a: { delayMs: 15, throws: thrown } });

    const result = await dispatch(configOf(hooks, ["a", "b"]), fake);

    expect(names(fake.calls)).toEqual(["a", "b"]);
    expect(result.blocked).toBe(false);
    expect(result.outcomes[0].handler).toBe("a");
    expect(result.outcomes[0].status).toBe("failed");
    expect(result.outcomes[0].message).toContain(text);
    expect(result.outcomes[0].duration_ms).toBeGreaterThanOrEqual(10);
    expect(result.outcomes[1]).toMatchObject({ handler: "b", status: "succeeded" });
  });

  it("a runner that throws synchronously, before returning a promise, is also contained", async () => {
    const fake = fakeRunners();
    const throwing: HandlerRunners = {
      ...fake.runners,
      shell: () => {
        throw new Error("sync boom");
      },
    };

    const result = await dispatchHandlers({
      config: configOf({ a: shell(), b: prompt() }, ["a", "b"]),
      command: COMMAND,
      event: "start",
      eventJson: EVENT_JSON,
      runners: throwing,
    });

    expect(result.outcomes[0]).toMatchObject({ handler: "a", status: "failed" });
    expect(result.outcomes[0].message).toContain("sync boom");
    expect(names(fake.calls)).toEqual(["b"]);
  });

  it("a prompt runner that returns a rejected promise is contained", async () => {
    const fake = fakeRunners();
    const rejecting: HandlerRunners = { ...fake.runners, prompt: () => Promise.reject(new Error("model down")) };

    const result = await dispatchHandlers({
      config: configOf({ p: prompt() }, ["p"]),
      command: COMMAND,
      event: "start",
      eventJson: EVENT_JSON,
      runners: rejecting,
    });

    expect(result.blocked).toBe(false);
    expect(result.outcomes).toHaveLength(1);
    expect(result.outcomes[0]).toMatchObject({ handler: "p", status: "failed" });
    expect(result.outcomes[0].message).toContain("model down");
  });
});

describe("handlers selected but not defined (AC-013-1)", () => {
  it("is a failed outcome with duration 0 and no runner call, and later handlers still run", async () => {
    const fake = fakeRunners();

    const result = await dispatch(configOf({ real: shell() }, ["ghost", "real"]), fake);

    expect(names(fake.calls)).toEqual(["real"]);
    expect(result.blocked).toBe(false);
    expect(result.outcomes).toHaveLength(2);
    expect(result.outcomes[0]).toMatchObject({ handler: "ghost", status: "failed", duration_ms: 0 });
    expect(result.outcomes[0].message).toContain("ghost");
    expect(result.outcomes[1]).toMatchObject({ handler: "real", status: "succeeded" });
  });

  it("is not satisfied by names inherited from Object.prototype or a prototype chain", async () => {
    const inherited = Object.create({ audit: shell() }) as Record<string, Handler>;
    const fake = fakeRunners();

    const result = await dispatch(configOf(inherited, ["constructor", "toString", "audit"]), fake);

    expect(fake.calls).toEqual([]);
    expect(result.outcomes.map((o) => [o.handler, o.status, o.duration_ms])).toEqual([
      ["constructor", "failed", 0],
      ["toString", "failed", 0],
      ["audit", "failed", 0],
    ]);
  });
});

describe("unselected commands and events (AC-020-1, AC-020-2)", () => {
  const config = configOf({ a: shell() }, ["a"]);

  it.each(["ensemble:unknown", "", "constructor", "__proto__", "toString", "hasOwnProperty"])(
    "command %j with no selection returns no outcomes and runs nothing",
    async (command) => {
      const fake = fakeRunners();

      const result = await dispatch(config, fake, "start", command);

      expect(result).toEqual({ blocked: false, outcomes: [] });
      expect(fake.calls).toEqual([]);
    },
  );

  it("does not read a command selection inherited through the prototype chain", async () => {
    const inherited = Object.create({ "ensemble:inherited": { start: ["a"], end: ["a"] } }) as HooksConfig["commands"];
    const fake = fakeRunners();

    const result = await dispatch({ ...config, commands: inherited }, fake, "start", "ensemble:inherited");

    expect(result).toEqual({ blocked: false, outcomes: [] });
    expect(fake.calls).toEqual([]);
  });

  it.each<"start" | "end">(["start", "end"])("an empty %s selection returns no outcomes", async (event) => {
    const fake = fakeRunners();
    const onlyOther = configOf({ a: shell() }, event === "start" ? [] : ["a"], event === "end" ? [] : ["a"]);

    const result = await dispatch(onlyOther, fake, event);

    expect(result).toEqual({ blocked: false, outcomes: [] });
    expect(fake.calls).toEqual([]);
  });

  it("a command whose selection omits the event key returns no outcomes", async () => {
    const partial = {
      version: 1,
      hooks: { a: shell() },
      commands: { [COMMAND]: { start: ["a"] } },
    } as unknown as HooksConfig;
    const fake = fakeRunners();

    const result = await dispatch(partial, fake, "end");

    expect(result).toEqual({ blocked: false, outcomes: [] });
    expect(fake.calls).toEqual([]);
  });
});

describe("no retry and no side effects (AC-013-1)", () => {
  it.each<[string, Behaviour]>([
    ["failed", { outcome: { status: "failed" } }],
    ["timed_out", { outcome: { status: "timed_out" } }],
    ["a throw", { throws: new Error("boom") }],
    ["a rejection with a non-Error", { throws: "boom" }],
  ])("a handler that ends in %s appears in the call log exactly once", async (_label, behaviour) => {
    const hooks = { flaky: shell({ on_error: "continue" }), after: shell() };
    const fake = fakeRunners({ flaky: behaviour });

    await dispatch(configOf(hooks, ["flaky", "after"]), fake);

    expect(names(fake.calls)).toEqual(["flaky", "after"]);
  });

  it("a blocking failure is not retried either", async () => {
    const fake = fakeRunners({ gate: { outcome: { status: "failed" } } });

    await dispatch(configOf({ gate: shell({ on_error: "block" }) }, ["gate"]), fake);

    expect(names(fake.calls)).toEqual(["gate"]);
  });

  it("a handler listed twice runs twice, once per listing", async () => {
    const fake = fakeRunners();

    const result = await dispatch(configOf({ a: shell() }, ["a", "a"]), fake);

    expect(names(fake.calls)).toEqual(["a", "a"]);
    expect(result.outcomes).toHaveLength(2);
  });

  it("returns only blocked, blockedBy and outcomes: the command outcome is never touched", async () => {
    const config = configOf({ ok: shell(), gate: shell({ on_error: "block" }) }, ["ok", "gate"], ["ok"]);
    const before = structuredClone(config);

    const passed = await dispatch(configOf({ ok: shell() }, ["ok"]), fakeRunners());
    const blocked = await dispatch(config, fakeRunners({ gate: { outcome: { status: "failed" } } }));
    const ended = await dispatch(config, fakeRunners(), "end");

    expect(Object.keys(passed).sort()).toEqual(["blocked", "outcomes"]);
    expect(Object.keys(blocked).sort()).toEqual(["blocked", "blockedBy", "outcomes"]);
    expect(Object.keys(ended).sort()).toEqual(["blocked", "outcomes"]);
    for (const result of [passed, blocked, ended]) {
      expect(result).not.toHaveProperty("outcome");
    }
    expect(config).toEqual(before);
  });
});
