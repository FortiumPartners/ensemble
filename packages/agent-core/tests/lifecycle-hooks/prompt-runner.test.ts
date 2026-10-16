/**
 * Tests for the prompt handler runner (TRD-005-TEST).
 * (docs/TRD/TRD-2026-f08a2a09-command-lifecycle-hooks.md#trd-005-test)
 *
 * PRD ACs: AC-011-1..5.
 */

import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  parsePromptResponse,
  PromptEvaluator,
  runPromptHandler,
  validateHooksConfig,
} from "../../src/lifecycle-hooks";
import type { HandlerOutcome, PromptHandler } from "../../src/lifecycle-hooks";

const PROMPT_FILE = "review.md";
const PROMPT_TEXT = "Review the PRD.\n\nReply as JSON: {\"continue\": true}\n  trailing spaces  \n";
const EVENT_JSON = '{"event":"end","run_id":"run-1","command":"ensemble:create-prd","outcome":"success"}';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "prompt-runner-"));
  writeFileSync(join(root, PROMPT_FILE), PROMPT_TEXT);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function handler(overrides: Partial<PromptHandler> = {}): PromptHandler {
  return { type: "prompt", prompt: `./${PROMPT_FILE}`, timeout_ms: 30000, on_error: "continue", ...overrides };
}

function run(evaluator: PromptEvaluator, h: PromptHandler = handler()): Promise<HandlerOutcome> {
  return runPromptHandler("review", h, EVENT_JSON, evaluator, { projectRoot: root });
}

const respond = (text: string): PromptEvaluator => async () => text;

describe("evaluator input (AC-011-1)", () => {
  it("receives the exact prompt file text, the exact event JSON, the handler timeout and an AbortSignal", async () => {
    const seen: Parameters<PromptEvaluator>[0][] = [];
    const outcome = await run(
      async (input) => {
        seen.push(input);
        return '{"continue":true}';
      },
      handler({ timeout_ms: 1234 }),
    );

    expect(seen).toHaveLength(1);
    expect(seen[0].prompt).toBe(PROMPT_TEXT);
    expect(seen[0].eventJson).toBe(EVENT_JSON);
    expect(seen[0].timeoutMs).toBe(1234);
    expect(seen[0].signal).toBeInstanceOf(AbortSignal);
    expect(seen[0].signal.aborted).toBe(false);
    expect(outcome.status).toBe("succeeded");
  });

  it("resolves the prompt path against the project root, not the working directory", async () => {
    const seen: string[] = [];
    await runPromptHandler(
      "review",
      handler(),
      EVENT_JSON,
      async (input) => {
        seen.push(input.prompt);
        return '{"continue":true}';
      },
      { projectRoot: root },
    );
    expect(seen).toEqual([PROMPT_TEXT]);
    expect(process.cwd()).not.toBe(root);
  });

  it("names the handler and records a duration on the outcome", async () => {
    const outcome = await run(respond('{"continue":true}'));
    expect(outcome.handler).toBe("review");
    expect(typeof outcome.duration_ms).toBe("number");
    expect(outcome.duration_ms).toBeGreaterThanOrEqual(0);
  });
});

describe("a conforming response (AC-011-2)", () => {
  it("continue:true is succeeded", async () => {
    const outcome = await run(respond('{"continue":true}'));
    expect(outcome.status).toBe("succeeded");
    expect(outcome.message).toBeUndefined();
    expect(outcome.findings).toBeUndefined();
  });

  it("continue:false is failed, so the handler's on_error applies", async () => {
    const outcome = await run(respond('{"continue":false}'));
    expect(outcome.status).toBe("failed");
    expect(outcome.message).toEqual(expect.any(String));
  });

  it("returns the user message on the outcome", async () => {
    const outcome = await run(respond('{"continue":false,"message":"The TRD is missing a task list."}'));
    expect(outcome.status).toBe("failed");
    expect(outcome.message).toBe("The TRD is missing a task list.");
  });

  it("returns findings (message, severity, path) on a succeeded outcome", async () => {
    const findings = [
      { message: "AC-003 has no test", severity: "warning", path: "docs/PRD/x.md" },
      { message: "Heading is inconsistent" },
    ];
    const outcome = await run(respond(JSON.stringify({ continue: true, message: "Two issues.", findings })));
    expect(outcome.status).toBe("succeeded");
    expect(outcome.message).toBe("Two issues.");
    expect(outcome.findings).toEqual(findings);
  });

  it("returns findings on a failed outcome too", async () => {
    const findings = [{ message: "Deliverable missing", severity: "error" }];
    const outcome = await run(respond(JSON.stringify({ continue: false, findings })));
    expect(outcome.status).toBe("failed");
    expect(outcome.findings).toEqual(findings);
  });

  it("accepts exactly one fenced json block surrounded by prose", async () => {
    const text = 'Here is my verdict.\n\n```json\n{"continue":true,"message":"looks good"}\n```\n\nThanks!';
    const outcome = await run(respond(text));
    expect(outcome.status).toBe("succeeded");
    expect(outcome.message).toBe("looks good");
  });

  it("accepts bare JSON with surrounding whitespace", async () => {
    const outcome = await run(respond('\n  {"continue":true}  \n'));
    expect(outcome.status).toBe("succeeded");
  });

  it("does not mistake braces inside a string value for structure", async () => {
    const outcome = await run(respond('Result: {"continue":true,"message":"use } and { freely"}'));
    expect(outcome.status).toBe("succeeded");
    expect(outcome.message).toBe("use } and { freely");
  });
});

describe("a malformed response is failed and never succeeded (AC-011-3)", () => {
  const malformed: [string, string][] = [
    ["prose only", "Looks fine to me, carry on."],
    ["an empty response", ""],
    ["two JSON objects", '{"continue":true} {"continue":true}'],
    ["two fenced JSON objects", '```json\n{"continue":false}\n```\nor\n```json\n{"continue":true}\n```'],
    ["an extra top-level field", '{"continue":true,"approved":true}'],
    ["a missing continue", '{"message":"hello"}'],
    ["a string continue", '{"continue":"true"}'],
    ["a numeric continue", '{"continue":1}'],
    ["a null continue", '{"continue":null}'],
    ["a non-string message", '{"continue":true,"message":42}'],
    ["a non-array findings", '{"continue":true,"findings":"none"}'],
    ["a finding without a message", '{"continue":true,"findings":[{"severity":"info"}]}'],
    ["a finding with an unknown severity", '{"continue":true,"findings":[{"message":"x","severity":"fatal"}]}'],
    ["a finding that is not an object", '{"continue":true,"findings":["oops"]}'],
    ["an unterminated brace", '{"continue":true'],
    ["a JSON array", "[true]"],
    ["a JSON scalar", "true"],
  ];

  it.each(malformed)("%s", async (_label, text) => {
    const outcome = await run(respond(text));
    expect(outcome.status).toBe("failed");
    expect(outcome.status).not.toBe("succeeded");
    expect(outcome.message).toContain("malformed prompt response");
  });

  it("a non-string evaluator result is failed, not thrown", async () => {
    const outcome = await run((async () => ({ continue: true })) as unknown as PromptEvaluator);
    expect(outcome.status).toBe("failed");
  });

  it("parsePromptResponse reports a reason and no response for malformed text", () => {
    const parsed = parsePromptResponse('{"continue":true,"extra":1}');
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.reason).toContain("extra");
  });

  it("parsePromptResponse returns the typed response for conforming text", () => {
    const parsed = parsePromptResponse('{"continue":true,"message":"ok","findings":[{"message":"m","severity":"info"}]}');
    expect(parsed).toEqual({
      ok: true,
      response: { continue: true, message: "ok", findings: [{ message: "m", severity: "info" }] },
    });
  });
});

describe("failures never throw (AC-011-3)", () => {
  it("a missing prompt file is failed and the evaluator is never called", async () => {
    let called = false;
    const outcome = await run(
      async () => {
        called = true;
        return '{"continue":true}';
      },
      handler({ prompt: "./does-not-exist.md" }),
    );
    expect(outcome.status).toBe("failed");
    expect(outcome.message).toContain("does-not-exist.md");
    expect(called).toBe(false);
  });

  it("a rejected evaluator is failed with its message", async () => {
    const outcome = await run(async () => {
      throw new Error("model unavailable");
    });
    expect(outcome.status).toBe("failed");
    expect(outcome.message).toContain("model unavailable");
  });

  it("a synchronously throwing evaluator is failed, not thrown", async () => {
    const evaluator: PromptEvaluator = () => {
      throw new Error("sync boom");
    };
    const outcome = await run(evaluator);
    expect(outcome.status).toBe("failed");
    expect(outcome.message).toContain("sync boom");
  });

  it("a non-Error rejection is failed", async () => {
    const outcome = await run(() => Promise.reject("plain string"));
    expect(outcome.status).toBe("failed");
    expect(outcome.message).toContain("plain string");
  });
});

describe("timeout (AC-011-5)", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("with a tiny real timeout, a never-settling evaluator is timed_out and its signal is aborted", async () => {
    // Real clock on purpose: proves the runner arms a genuine timer; a 25ms budget keeps it cheap.
    let signal: AbortSignal | undefined;
    const evaluator: PromptEvaluator = (input) => {
      signal = input.signal;
      return new Promise<string>(() => undefined);
    };
    const outcome = await run(evaluator, handler({ timeout_ms: 25 }));

    expect(outcome.status).toBe("timed_out");
    expect(outcome.message).toContain("25ms");
    expect(signal).toBeDefined();
    expect(signal!.aborted).toBe(true);
  });

  it("does not time out or abort before the handler timeout, and does at exactly it", async () => {
    jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
    const started = Promise.withResolvers<AbortSignal>();
    const pending = run((input) => {
      started.resolve(input.signal);
      return new Promise<string>(() => undefined);
    }, handler({ timeout_ms: 1000 }));
    const signal = await started.promise;

    jest.advanceTimersByTime(999);
    expect(signal.aborted).toBe(false);
    jest.advanceTimersByTime(1);
    expect(signal.aborted).toBe(true);

    const outcome = await pending;
    expect(outcome.status).toBe("timed_out");
    expect(outcome.duration_ms).toBe(1000);
  });

  it("an evaluator that settles in time is succeeded, its signal stays unaborted and no timer is left armed", async () => {
    jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
    let signal: AbortSignal | undefined;
    const outcome = await run(
      async (input) => {
        signal = input.signal;
        return '{"continue":true}';
      },
      handler({ timeout_ms: 5000 }),
    );
    expect(outcome.status).toBe("succeeded");
    expect(jest.getTimerCount()).toBe(0);
    expect(signal!.aborted).toBe(false);
  });

  it("clears the timer when the evaluator rejects", async () => {
    jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
    const outcome = await run(async () => {
      throw new Error("model unavailable");
    }, handler({ timeout_ms: 5000 }));
    expect(outcome.status).toBe("failed");
    expect(jest.getTimerCount()).toBe(0);
  });

  it("a rejection that arrives after the timeout does not become an unhandled rejection", async () => {
    jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);
    try {
      const started = Promise.withResolvers<void>();
      const evaluator: PromptEvaluator = (input) =>
        new Promise<string>((_resolve, reject) => {
          input.signal.addEventListener("abort", () => reject(new Error("aborted late")));
          started.resolve();
        });
      const pending = run(evaluator, handler({ timeout_ms: 20 }));
      await started.promise;
      jest.advanceTimersByTime(20);
      const outcome = await pending;
      expect(outcome.status).toBe("timed_out");
      // Let the runtime report any unhandled rejection (setImmediate is not faked).
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("a prompt handler without a timeout gets 30000 from the validator and the evaluator receives it", async () => {
    const result = validateHooksConfig(
      {
        version: 1,
        hooks: { review: { type: "prompt", prompt: `./${PROMPT_FILE}`, on_error: "continue" } },
        commands: { "ensemble:create-prd": { end: ["review"] } },
      },
      { projectRoot: root, fileExists: () => true },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const configured = result.config.hooks.review;
    expect(configured.type).toBe("prompt");
    if (configured.type !== "prompt") return;
    expect(configured.timeout_ms).toBe(30000);

    let timeoutMs: number | undefined;
    await run(async (input) => {
      timeoutMs = input.timeoutMs;
      return '{"continue":true}';
    }, configured);
    expect(timeoutMs).toBe(30000);
  });
});

describe("the runner only reads (AC-011-4)", () => {
  it("leaves the prompt file unchanged and creates no files across success, failure and timeout", async () => {
    const before = readdirSync(root).sort();
    const promptPath = join(root, PROMPT_FILE);

    await run(respond('{"continue":false,"findings":[{"message":"Deliverable missing","severity":"error"}]}'));
    await run(respond("not json"));
    await run(async () => {
      throw new Error("boom");
    });
    await run(() => new Promise<string>(() => undefined), handler({ timeout_ms: 10 }));

    expect(readFileSync(promptPath, "utf8")).toBe(PROMPT_TEXT);
    expect(readdirSync(root).sort()).toEqual(before);
  });

  it("does not echo findings into any file: a missing-deliverable finding is only returned", async () => {
    const outcome = await run(
      respond('{"continue":false,"message":"deliverable missing","findings":[{"message":"no TRD","path":"docs/TRD/x.md"}]}'),
    );
    expect(outcome.status).toBe("failed");
    expect(outcome.findings).toEqual([{ message: "no TRD", path: "docs/TRD/x.md" }]);
    expect(readdirSync(root)).toEqual([PROMPT_FILE]);
  });
});
