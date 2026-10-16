import { appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  HARNESS_CAPABILITIES,
  HOOKS_FILE_RELATIVE,
  computeHooksDigest,
  defaultTrustStorePath,
  isRecord,
  loadHooksConfig,
  recordTrust,
} from "@sunstone-partners/ensemble-agent-core";
import type { LifecycleEvent } from "@sunstone-partners/ensemble-agent-core";
import activate from "../src/extension";
import { SHUTDOWN_BOUND_CAP_MS, SIGINT_SHUTDOWN_NOTE, knownCommandsFromHost, registerLifecycleHooks } from "../src/lifecycle/adapter";
import type { LifecycleOptions, LifecycleRuntime } from "../src/lifecycle/adapter";
import {
  COMPLETION_ACKNOWLEDGEMENT,
  COMPLETION_NOT_IN_FLIGHT,
  COMPLETION_NOT_STARTED,
  COMPLETION_TOOL_NAME,
} from "../src/lifecycle/completion";

/**
 * TRD-012-TEST: the end path and its wiring (AC-004-1 .. AC-004-4, AC-013-1,
 * AC-013-2, AC-021-3 .. AC-021-5, AC-009-4), driven through the real entry
 * points, `registerLifecycleHooks` and `activate()`.
 *
 * Everything is real except the host. Handlers are real executables that
 * append to `trace.log` and keep the event JSON they were given, in temporary
 * projects with the user's trust recorded in a temporary store. "Ran after",
 * "never ran" and "ran once" are read from those files, never from mocks. A
 * handler that must still be running at some moment waits for a file the test
 * writes (`open`, in a directory the handler is given), so the order is decided
 * by the test, not by a guess at how long a process takes. The directory, not
 * a file, is the handler's argument: an argument that names an existing file is
 * part of what the user trusts (the trust digest), and creating the release
 * file must not void the trust under test.
 *
 * The fake host replays what Pi 1.2.0 was measured to emit: a loop that
 * completes fires `agent_before_settle` (outcome `completed`) then
 * `agent_settled` (`aborted: false`); one that fails fires `agent_before_settle`
 * with outcome `error`; an abort fires only `agent_settled` with
 * `aborted: true`. The completion tool is called through the `execute` the
 * adapter registered, as Pi does for the model. A handler that throws does not
 * stop the host: the error is kept in `hostErrors`, and the tests assert it is
 * empty wherever the adapter promises never to throw.
 */

const CREATE_PRD = "ensemble:create-prd";
const REFINE_PRD = "ensemble:refine-prd";

/** What Pi reports for `getCommands()`: every command the hooks files below select exists. */
const HOST_COMMANDS = [{ name: "ensemble-create-prd" }, { name: "ensemble-refine-prd" }];

/**
 * record.sh <tag> <hold> <exit code>: notes that it began, keeps the event it was
 * given, waits for `<hold>/open` under the project root unless <hold> is `-`, notes
 * that it ended, and exits.
 */
const RECORD_SCRIPT = `#!/bin/sh
tag="$1"; hold="$2"; code="$3"
printf '%s begin %s\\n' "$tag" "$ENSEMBLE_RUN_ID" >> "$ENSEMBLE_PROJECT_ROOT/trace.log"
cat > "$ENSEMBLE_PROJECT_ROOT/events/$tag.$ENSEMBLE_RUN_ID.json"
if [ "$hold" != "-" ]; then
  until [ -e "$ENSEMBLE_PROJECT_ROOT/$hold/open" ]; do sleep 0.02; done
fi
printf '%s end\\n' "$tag" >> "$ENSEMBLE_PROJECT_ROOT/trace.log"
exit "$code"
`;
/** Prints more than the 64 KiB a handler's output is bounded to. */
const NOISY_SCRIPT = `#!/bin/sh
head -c 70000 /dev/zero | tr '\\0' x
`;

const dirs: string[] = [];
const originalCwd = process.cwd();
const restores: Array<() => void> = [];
let stderrText: string[] = [];
/** The home directory every test sees: `os.homedir()` returns it, so the default trust store is never the real one. */
let tempHome = "";
/** The real user's `~/.ensemble`, read before any test replaces `os.homedir()`: nothing here may create or change it. */
const REAL_ENSEMBLE_DIR = join(os.homedir(), ".ensemble");
const realEnsembleDirExisted = existsSync(REAL_ENSEMBLE_DIR);

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(os.tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

beforeEach(() => {
  stderrText = [];
  const stderr = jest.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
    stderrText.push(String(chunk));
    return true;
  });
  restores.push(() => stderr.mockRestore());
  // `activate()` resolves its default trust store from `os.homedir()`. Jest gives each test file its own
  // `process.env`, so assigning HOME never reaches it; the home is replaced where it is read.
  tempHome = tempDir("lifecycle-end-home-");
  const homedir = jest.spyOn(os, "homedir").mockReturnValue(tempHome);
  restores.push(() => homedir.mockRestore());
});

afterEach(() => {
  while (restores.length > 0) restores.pop()?.();
  tempHome = "";
  process.chdir(originalCwd);
});

afterAll(() => {
  dirs.forEach((d) => rmSync(d, { recursive: true, force: true }));
  expect(existsSync(REAL_ENSEMBLE_DIR)).toBe(realEnsembleDirExisted); // no test touched the real user's trust store
});

// ---- Fixtures -------------------------------------------------------------

type ErrorPolicy = "continue" | "block";

/** A shell handler that runs `scripts/record.sh`. `tag` names its files; `hold` is a directory under the project it waits in. */
function recorder(tag: string, options: { hold?: string; code?: number; on_error?: ErrorPolicy; timeout_ms?: number } = {}) {
  return {
    type: "shell",
    command: "./scripts/record.sh",
    args: [tag, options.hold ?? "-", String(options.code ?? 0)],
    on_error: options.on_error ?? "continue",
    ...(options.timeout_ms === undefined ? {} : { timeout_ms: options.timeout_ms }),
  };
}

interface Selection {
  start?: string[];
  end?: string[];
}

/** A hooks file. JSON is YAML, so the loader reads it as the user's file. */
function hooksFile(hooks: Record<string, unknown>, commands: Record<string, Selection>): string {
  return `${JSON.stringify({ version: 1, hooks, commands }, null, 2)}\n`;
}

interface Project {
  root: string;
  storePath: string;
  trace: string;
}

/** A project anchored by `.git`, with its hooks file and handler scripts. */
function makeProject(hooks: string): Project {
  const root = tempDir("lifecycle-end-project-");
  for (const dir of [".git", ".ensemble", "scripts", "events", "holds", "sub"]) mkdirSync(join(root, dir));
  writeFileSync(join(root, HOOKS_FILE_RELATIVE), hooks);
  for (const [file, body] of [
    ["record.sh", RECORD_SCRIPT],
    ["noisy.sh", NOISY_SCRIPT],
  ]) {
    writeFileSync(join(root, "scripts", file), body);
    chmodSync(join(root, "scripts", file), 0o755);
  }
  return { root, storePath: join(tempDir("lifecycle-end-store-"), ".ensemble", "trusted-hooks.json"), trace: join(root, "trace.log") };
}

/** A project whose commands `ensemble:create-prd` and `ensemble:refine-prd` both start with `audit` and end with `finish`. */
function auditAndFinish(): Project {
  const both: Selection = { start: ["audit"], end: ["finish"] };
  return makeProject(hooksFile({ audit: recorder("audit"), finish: recorder("finish") }, { [CREATE_PRD]: both, [REFINE_PRD]: both }));
}

/** The user's trust in the project's hooks exactly as they are now, recorded the way the trust command records it. */
function trust(project: Project, storePath: string = project.storePath): void {
  const loaded = loadHooksConfig(project.root, { knownCommands: knownCommandsFromHost(HOST_COMMANDS) });
  if (loaded.status !== "valid") throw new Error(`fixture hooks file is ${loaded.status}`);
  recordTrust(project.root, computeHooksDigest(project.root, loaded.config), { storePath });
}

/** Changes the hooks file by a byte, which voids the user's trust in it. */
function editHooksFile(project: Project): void {
  const file = join(project.root, HOOKS_FILE_RELATIVE);
  writeFileSync(file, `${readFileSync(file, "utf8")}\n`);
}

/** What the handlers and the host appended to the trace, in order. */
function traceOf(project: Project): string[] {
  return existsSync(project.trace) ? readFileSync(project.trace, "utf8").split("\n").filter((line) => line !== "") : [];
}

/** The events the handler tagged `tag` was given, one per run. */
function eventsOf(project: Project, tag: string): LifecycleEvent[] {
  return readdirSync(join(project.root, "events"))
    .filter((file) => file.startsWith(`${tag}.`))
    .map((file) => JSON.parse(readFileSync(join(project.root, "events", file), "utf8")) as LifecycleEvent);
}

/** The event the handler tagged `tag` was given for run `runId`. */
function eventFor(project: Project, tag: string, runId: string | undefined): LifecycleEvent | undefined {
  return eventsOf(project, tag).find((event) => event.run_id === runId);
}

/** The run id the start handler `audit` was given for the invocation with these arguments. */
function runOf(project: Project, args: string): string {
  const start = eventsOf(project, "audit").find((event) => event.arguments === args);
  if (!start) throw new Error(`no start event for arguments "${args}"`);
  return start.run_id;
}

/** Lets the handlers waiting in `hold` (a directory under the project) go. */
function open(project: Project, hold: string): void {
  mkdirSync(join(project.root, hold), { recursive: true });
  writeFileSync(join(project.root, hold, "open"), "");
}

/** Waits until `condition` holds. Handlers are real processes, so the only way to see one has begun is to poll for it. */
async function until(condition: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + 5000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await delay(10);
  }
}

const began = (project: Project, tag: string) => traceOf(project).some((line) => line.startsWith(`${tag} begin`));

interface CtxOptions {
  hasUI?: boolean;
  /** What the host's `hasPendingMessages()` answers: true while it holds a queued prompt. */
  pending?: () => boolean;
  /** What the host's `isProjectTrusted()` answers. Defaults to true, as Pi does. */
  hostTrusted?: boolean;
}

/** A host context for an event. `texts()` is every message the user was shown through the UI, `levels()` how each was marked. */
function fakeCtx(project: Project, options: CtxOptions = {}) {
  const notify = jest.fn((_message: string, _level?: string) => undefined);
  const ctx = {
    cwd: join(project.root, "sub"),
    hasUI: options.hasUI ?? true,
    ui: { notify },
    isProjectTrusted: () => options.hostTrusted ?? true,
    sessionManager: { getSessionId: () => "host-session-1" },
    hasPendingMessages: () => options.pending?.() ?? false,
  } as unknown as ExtensionContext;
  return {
    ctx,
    notify,
    texts: () => notify.mock.calls.map(([message]) => message),
    levels: () => notify.mock.calls.map(([, level]) => level),
  };
}

type Handler = (event: Record<string, unknown>, ctx: ExtensionContext) => unknown;

interface Tool {
  name: string;
  parameters: { properties: Record<string, unknown>; additionalProperties: boolean };
  execute: (
    toolCallId: string,
    params: Record<string, unknown>,
    signal: undefined,
    onUpdate: undefined,
    ctx: ExtensionContext,
  ) => Promise<{ content: { type: string; text: string }[]; details: { recorded: boolean } }>;
}

type Verdict = "handled" | "continue";
type Settle = "completed" | "error" | "aborted";

interface Host {
  pi: ExtensionAPI;
  /** What `registerLifecycleHooks` registered. */
  registered: { events: string[]; tools: string[]; commands: string[] };
  /** The events the host emitted, in order. */
  emitted: string[];
  /** What a throwing handler left for Pi to print. */
  hostErrors: string[];
  /** The user submits `text`; `behavior` is set when the agent is already streaming. A prompt that continues reaches the model. */
  submit(text: string, ctx: ExtensionContext, behavior?: "steer" | "followUp"): Promise<Verdict>;
  /** The loop settles the way Pi 1.2.0 was measured to. The command's final output comes first. */
  settle(ctx: ExtensionContext, how: Settle): Promise<void>;
  /** The model calls the completion tool; the acknowledgement it gets back. */
  complete(params: Record<string, unknown>, ctx: ExtensionContext): Promise<{ text: string; recorded: boolean }>;
  shutdown(ctx: ExtensionContext, reason?: string): Promise<void>;
}

/** A host that behaves as Pi 1.2.0 was measured to behave, with the adapter not yet registered. */
function fakeHost(project: Project, options: { getCommands?: () => { name: string }[] } = {}): Host {
  const handlers = new Map<string, Handler[]>();
  const tools = new Map<string, Tool>();
  const commands: string[] = [];
  const emitted: string[] = [];
  const hostErrors: string[] = [];

  const pi = {
    on: (event: string, handler: Handler) => {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
      return () => undefined;
    },
    registerTool: (tool: Tool) => {
      tools.set(tool.name, tool);
    },
    registerCommand: (name: string) => {
      commands.push(name);
    },
    getCommands: () => (options.getCommands?.() ?? HOST_COMMANDS).map((command) => ({ ...command, source: "prompt" })),
  } as unknown as ExtensionAPI;

  /** Runs every handler for `type`, in order, each awaited; a handler that throws does not stop the rest, as in Pi. */
  async function emit(type: string, event: Record<string, unknown>, ctx: ExtensionContext): Promise<unknown[]> {
    emitted.push(type);
    const results: unknown[] = [];
    for (const handler of handlers.get(type) ?? []) {
      try {
        results.push(await handler({ type, ...event }, ctx));
      } catch (error) {
        hostErrors.push(String(error));
      }
    }
    return results;
  }

  return {
    pi,
    get registered() {
      return { events: [...handlers.keys()].sort(), tools: [...tools.keys()], commands };
    },
    emitted,
    hostErrors,
    async submit(text, ctx, behavior) {
      const results = await emit("input", { text, source: "rpc", streamingBehavior: behavior }, ctx);
      if (results.some((result) => isRecord(result) && result.action === "handled")) return "handled";
      appendFileSync(project.trace, `model-prompt ${text}\n`);
      // `before_agent_start` fires for a prompt that starts a loop, not for one queued behind a loop already running.
      if (behavior === undefined) await emit("before_agent_start", { prompt: text, systemPrompt: "base prompt", systemPromptOptions: {} }, ctx);
      return "continue";
    },
    async settle(ctx, how) {
      appendFileSync(project.trace, "model-output\n");
      if (how !== "aborted") await emit("agent_before_settle", { outcome: how, entries: [], continue: false }, ctx);
      await emit("agent_settled", { aborted: how === "aborted" }, ctx);
    },
    async complete(params, ctx) {
      const tool = tools.get(COMPLETION_TOOL_NAME);
      if (!tool) throw new Error("the completion tool is not registered");
      const result = await tool.execute("call-1", params, undefined, undefined, ctx);
      return { text: result.content[0].text, recorded: result.details.recorded };
    },
    async shutdown(ctx, reason = "quit") {
      await emit("session_shutdown", { reason }, ctx);
    },
  };
}

interface RegisteredHost extends Host {
  runtime: LifecycleRuntime;
}

/** A host with the adapter registered through its real entry point. */
function hostFor(project: Project, options: LifecycleOptions = {}, hostOptions: { getCommands?: () => { name: string }[] } = {}): RegisteredHost {
  const host = fakeHost(project, hostOptions);
  const runtime = registerLifecycleHooks(host.pi, project.root, { storePath: project.storePath, ...options });
  if (!runtime) throw new Error("the fixture has a hooks file, so the adapter must register");
  return Object.assign(host, { runtime });
}

// ---- TRD-012-TEST: error and abort (AC-004-2, AC-004-3, AC-021-3) ---------

describe("error and abort", () => {
  it("ends the run failed at an error outcome, and cancelled at an abort that fires only agent_settled", async () => {
    const project = auditAndFinish();
    trust(project);
    const host = hostFor(project);
    const { ctx, texts } = fakeCtx(project);

    await host.submit("/ensemble-create-prd one", ctx);
    await host.settle(ctx, "error");
    await host.submit("/ensemble-refine-prd two", ctx);
    host.emitted.length = 0;
    await host.settle(ctx, "aborted");

    expect(host.emitted).toEqual(["agent_settled"]); // an abort fires no agent_before_settle
    const failed = eventFor(project, "finish", runOf(project, "one"));
    const cancelled = eventFor(project, "finish", runOf(project, "two"));
    expect(failed).toMatchObject({ event: "command.end", command: CREATE_PRD, outcome: "failed" });
    expect(failed?.reason).toMatch(/error/i);
    expect(cancelled).toMatchObject({ event: "command.end", command: REFINE_PRD, outcome: "cancelled" });
    expect(cancelled?.reason).toMatch(/aborted/i);
    expect(eventsOf(project, "finish")).toHaveLength(2); // one end per run: the settle after the error ended nothing twice
    expect(host.runtime.trackerFor(ctx).current()).toBeUndefined();
    expect(texts().some((t) => t.includes("(command.end, command failed)"))).toBe(true);
    expect(texts().some((t) => t.includes("(command.end, command cancelled)"))).toBe(true);
    expect(host.hostErrors).toEqual([]);
  });

  it("keeps the outcome the command stated when an abort or error follows its completion call", async () => {
    const project = auditAndFinish();
    trust(project);
    const host = hostFor(project);
    const { ctx } = fakeCtx(project);

    await host.submit("/ensemble-create-prd one", ctx);
    await host.complete({ outcome: "succeeded", summary: "done" }, ctx);
    await host.settle(ctx, "aborted");

    const ends = eventsOf(project, "finish");
    expect(ends).toHaveLength(1);
    expect(ends[0]).toMatchObject({ outcome: "succeeded", summary: "done" });
  });

  it("ends the run failed with the reason the command gave, under the run id that started", async () => {
    const project = auditAndFinish();
    trust(project);
    const host = hostFor(project);
    const { ctx } = fakeCtx(project);

    await host.submit("/ensemble-create-prd one", ctx);
    await host.complete({ outcome: "failed", reason: "the arguments name no ticket" }, ctx);
    await host.settle(ctx, "completed");

    const end = eventFor(project, "finish", runOf(project, "one"));
    expect(end).toMatchObject({ outcome: "failed", reason: "the arguments name no ticket" });
  });
});

// ---- TRD-012-TEST: completed without signal (AC-021-4) --------------------

describe("a loop that settles completed with no completion signal", () => {
  it("ends nothing: no end handler runs, and the run stays in flight through the user's reply", async () => {
    const project = auditAndFinish();
    trust(project);
    const host = hostFor(project);
    const { ctx, texts } = fakeCtx(project);
    await host.submit("/ensemble-create-prd one", ctx);
    const runId = runOf(project, "one");
    const shown = texts().length;

    await host.settle(ctx, "completed"); // the command asked a question in plain text
    expect(eventsOf(project, "finish")).toEqual([]);
    expect(host.runtime.trackerFor(ctx).current()?.run_id).toBe(runId);

    expect(await host.submit("yes, that one", ctx)).toBe("continue"); // the user's answer is not a command
    await host.settle(ctx, "completed");
    expect(eventsOf(project, "finish")).toEqual([]);
    expect(host.runtime.trackerFor(ctx).current()?.run_id).toBe(runId);
    expect(texts()).toHaveLength(shown); // and nothing about an end was shown

    await host.complete({ outcome: "succeeded" }, ctx);
    await host.settle(ctx, "completed");
    expect(eventFor(project, "finish", runId)).toMatchObject({ outcome: "succeeded" });
    expect(eventsOf(project, "finish")).toHaveLength(1);
  });

  it("produces no cancelled outcome for any number of aborted: false settles", async () => {
    const project = auditAndFinish();
    trust(project);
    const host = hostFor(project);
    const { ctx } = fakeCtx(project);
    await host.submit("/ensemble-create-prd one", ctx);

    for (let loop = 0; loop < 3; loop++) await host.settle(ctx, "completed");

    expect(eventsOf(project, "finish")).toEqual([]);
    expect(host.runtime.trackerFor(ctx).current()).toBeDefined();
  });
});

// ---- TRD-012-TEST: end after output (AC-021-2, AC-021-6) ------------------

describe("the end after the command's output", () => {
  it("holds the end at the completion call and runs the end handlers once, at agent_settled, after the final output", async () => {
    const project = auditAndFinish();
    trust(project);
    const host = hostFor(project);
    const { ctx } = fakeCtx(project);
    await host.submit("/ensemble-create-prd one", ctx);
    const runId = runOf(project, "one");

    expect(await host.complete({ outcome: "succeeded", summary: "wrote the PRD", artifacts: ["docs/PRD/x.md"] }, ctx)).toEqual({
      text: COMPLETION_ACKNOWLEDGEMENT,
      recorded: true,
    });
    await delay(100); // an end handler started at the completion call would have begun by now
    expect(traceOf(project)).toEqual([`audit begin ${runId}`, "audit end", "model-prompt /ensemble-create-prd one"]);
    expect(eventsOf(project, "finish")).toEqual([]);

    await host.settle(ctx, "completed");
    expect(traceOf(project)).toEqual([
      `audit begin ${runId}`,
      "audit end",
      "model-prompt /ensemble-create-prd one",
      "model-output",
      `finish begin ${runId}`,
      "finish end",
    ]);
    expect(eventFor(project, "finish", runId)).toMatchObject({
      event: "command.end",
      outcome: "succeeded",
      summary: "wrote the PRD",
      artifacts: ["docs/PRD/x.md"],
      session_id: "host-session-1",
    });
  });

  it("runs them once however often the loop settles or the model repeats the call (AC-021-6)", async () => {
    const project = auditAndFinish();
    trust(project);
    const host = hostFor(project);
    const { ctx } = fakeCtx(project);
    await host.submit("/ensemble-create-prd one", ctx);

    await host.complete({ outcome: "succeeded" }, ctx);
    await host.settle(ctx, "completed");
    expect(await host.complete({ outcome: "failed", reason: "again" }, ctx)).toEqual({ text: COMPLETION_NOT_IN_FLIGHT, recorded: false });
    await host.settle(ctx, "completed");
    await host.settle(ctx, "aborted");
    await host.shutdown(ctx);

    expect(eventsOf(project, "finish")).toHaveLength(1);
    expect(traceOf(project).filter((line) => line.startsWith("finish begin"))).toHaveLength(1);
  });

  it("runs the end handlers one after another, in the order the file gives", async () => {
    const project = makeProject(
      hooksFile(
        { first: recorder("first", { hold: "holds/first" }), second: recorder("second") },
        { [CREATE_PRD]: { end: ["first", "second"] } },
      ),
    );
    trust(project);
    const host = hostFor(project);
    const { ctx } = fakeCtx(project);
    await host.submit("/ensemble-create-prd one", ctx);
    await host.complete({ outcome: "succeeded" }, ctx);

    const settling = host.settle(ctx, "completed");
    await until(() => began(project, "first"), "the first end handler to begin");
    await delay(150); // the second would have begun by now, had it been started beside the first
    expect(began(project, "second")).toBe(false);

    open(project, "holds/first");
    await settling;
    const [runId] = eventsOf(project, "first").map((e) => e.run_id);
    expect(traceOf(project).slice(-4)).toEqual([`first begin ${runId}`, "first end", `second begin ${runId}`, "second end"]);
  });

  it("delivers an end that is waiting for its loop to settle before the next command's start handlers run", async () => {
    const project = auditAndFinish();
    trust(project);
    const host = hostFor(project);
    const { ctx } = fakeCtx(project);
    await host.submit("/ensemble-create-prd one", ctx);
    await host.complete({ outcome: "succeeded" }, ctx);

    await host.submit("/ensemble-refine-prd two", ctx, "steer"); // sent into the loop that is still running

    const first = runOf(project, "one");
    const second = runOf(project, "two");
    const trace = traceOf(project);
    expect(trace.indexOf(`finish begin ${first}`)).toBeGreaterThan(-1);
    expect(trace.indexOf(`finish begin ${first}`)).toBeLessThan(trace.indexOf(`audit begin ${second}`));
    expect(eventFor(project, "finish", first)).toMatchObject({ outcome: "succeeded" }); // the model's word, not a supersede
    await host.settle(ctx, "completed");
    expect(eventsOf(project, "finish").map((e) => e.run_id)).toEqual([first]); // the second run is still in flight
    expect(host.runtime.trackerFor(ctx).current()?.run_id).toBe(second);
  });
});

// ---- TRD-012-TEST: shutdown and supersede (AC-021-5, AC-004-3) ------------

describe("shutdown and a newer command", () => {
  it("ends a run in flight at shutdown as cancelled, naming the missing completion signal, and runs its end handlers", async () => {
    const project = auditAndFinish();
    trust(project);
    const host = hostFor(project);
    const { ctx, texts } = fakeCtx(project);
    await host.submit("/ensemble-create-prd one", ctx);
    const runId = runOf(project, "one");

    await host.shutdown(ctx, "quit");

    const end = eventFor(project, "finish", runId);
    expect(end).toMatchObject({ event: "command.end", outcome: "cancelled" });
    expect(end?.reason).toMatch(/no completion signal/i);
    expect(end?.reason).toMatch(/session ended/i);
    expect(host.runtime.trackerFor(ctx).current()).toBeUndefined();
    expect(texts().at(-1)).toContain("(command.end, command cancelled)");
    expect(host.hostErrors).toEqual([]);
  });

  it("ends the run in flight as cancelled when another selected command arrives, naming the missing signal and the newcomer", async () => {
    const project = auditAndFinish();
    trust(project);
    const host = hostFor(project);
    const { ctx } = fakeCtx(project);
    await host.submit("/ensemble-create-prd one", ctx);

    await host.submit("/ensemble-refine-prd two", ctx);

    const end = eventFor(project, "finish", runOf(project, "one"));
    expect(end).toMatchObject({ outcome: "cancelled", command: CREATE_PRD });
    expect(end?.reason).toMatch(/no completion signal/i);
    expect(end?.reason).toContain(REFINE_PRD);
    expect(eventFor(project, "finish", runOf(project, "two"))).toBeUndefined();
  });

  it("delivers an end the model's completion call left queued, as the model stated it, when the session ends first", async () => {
    const project = auditAndFinish();
    trust(project);
    const host = hostFor(project);
    const { ctx } = fakeCtx(project);
    await host.submit("/ensemble-create-prd one", ctx);
    await host.complete({ outcome: "succeeded", summary: "done" }, ctx);

    await host.shutdown(ctx);

    const ends = eventsOf(project, "finish");
    expect(ends).toHaveLength(1);
    expect(ends[0]).toMatchObject({ outcome: "succeeded", summary: "done" });
  });

  it("is silent, and runs nothing, when the session ends with no run in flight", async () => {
    const project = auditAndFinish();
    trust(project);
    const host = hostFor(project);
    const { ctx, texts } = fakeCtx(project);

    await host.shutdown(ctx);

    expect(texts()).toEqual([]);
    expect(eventsOf(project, "finish")).toEqual([]);
    expect(host.hostErrors).toEqual([]);
  });

  it("adds nothing at shutdown for a run that already ended and had its end handlers run", async () => {
    const project = auditAndFinish();
    trust(project);
    const host = hostFor(project);
    const { ctx, texts } = fakeCtx(project);
    await host.submit("/ensemble-create-prd one", ctx);
    await host.complete({ outcome: "succeeded" }, ctx);
    await host.settle(ctx, "completed");
    const shown = texts().length;

    await host.shutdown(ctx);

    expect(texts()).toHaveLength(shown);
    expect(eventsOf(project, "finish")).toHaveLength(1);
  });

  it("waits for the start handlers of a run still starting, so its end never overlaps them", async () => {
    const project = makeProject(
      hooksFile({ slow: recorder("slow", { hold: "holds/slow" }), finish: recorder("finish") }, { [CREATE_PRD]: { start: ["slow"], end: ["finish"] } }),
    );
    trust(project);
    const host = hostFor(project);
    const { ctx } = fakeCtx(project);
    const starting = host.submit("/ensemble-create-prd one", ctx);
    await until(() => began(project, "slow"), "the start handler to begin");

    let shutDown = false;
    const shutting = host.shutdown(ctx).then(() => {
      shutDown = true;
    });
    await delay(150);
    expect(shutDown).toBe(false);
    expect(began(project, "finish")).toBe(false);

    open(project, "holds/slow");
    await shutting;
    await starting;
    const [runId] = eventsOf(project, "slow").map((e) => e.run_id);
    expect(traceOf(project).filter((line) => !line.startsWith("model-"))).toEqual([`slow begin ${runId}`, "slow end", `finish begin ${runId}`, "finish end"]);
    expect(eventFor(project, "finish", runId)).toMatchObject({ outcome: "cancelled" });
  });

  it("handles the reason `new`: the old runtime ends its run and closes, and a new one starts clean", async () => {
    const project = auditAndFinish();
    trust(project);
    const first = hostFor(project);
    const { ctx } = fakeCtx(project);
    await first.submit("/ensemble-create-prd one", ctx);
    const oldRun = runOf(project, "one");

    await first.shutdown(ctx, "new");
    // Pi runs the extension factory again for the new session.
    const second = hostFor(project);
    await second.submit("/ensemble-create-prd two", ctx);
    // Nothing reaches the old runtime any more, but if something did it starts nothing.
    expect(await first.submit("/ensemble-create-prd late", ctx)).toBe("continue");
    await first.settle(ctx, "aborted");
    const untrusting = fakeCtx(project, { hostTrusted: false });
    expect(await first.submit("/ensemble-create-prd late", untrusting.ctx)).toBe("continue");
    expect(untrusting.texts()).toEqual([]); // a closed runtime does not even consult the gate

    expect(eventFor(project, "finish", oldRun)).toMatchObject({ outcome: "cancelled" });
    expect(eventsOf(project, "audit").map((e) => e.arguments).sort()).toEqual(["one", "two"]);
    const newRun = second.runtime.trackerFor(ctx).current();
    expect(newRun).toMatchObject({ command: CREATE_PRD, arguments: "two" });
    expect(newRun?.run_id).not.toBe(oldRun);
    expect(eventsOf(project, "finish")).toHaveLength(1); // the new run is still in flight
  });

  it("starts no run for a command that was waiting behind a delivery when the session ended", async () => {
    const project = makeProject(
      hooksFile(
        { audit: recorder("audit"), finish: recorder("finish", { hold: "holds/finish" }) },
        { [CREATE_PRD]: { start: ["audit"], end: ["finish"] }, [REFINE_PRD]: { start: ["audit"] } },
      ),
    );
    trust(project);
    const host = hostFor(project);
    const { ctx } = fakeCtx(project);
    await host.submit("/ensemble-create-prd one", ctx);
    await host.complete({ outcome: "succeeded" }, ctx); // its end waits for the loop to settle

    const second = host.submit("/ensemble-refine-prd two", ctx, "steer"); // delivers that end first
    await until(() => began(project, "finish"), "the waiting end handler to begin");
    const shutting = host.shutdown(ctx); // and the session ends while it runs
    open(project, "holds/finish");

    expect(await second).toBe("continue");
    await shutting;
    expect(eventsOf(project, "audit").map((e) => e.arguments)).toEqual(["one"]);
    expect(host.runtime.trackerFor(ctx).current()).toBeUndefined();
  });
});

// ---- TRD-012-TEST: start failure does not suppress end (AC-004-1) ---------

describe("a start handler that failed under continue", () => {
  it("is shown as a handler failure, and the end handlers still run when the command completes", async () => {
    const project = makeProject(
      hooksFile({ gate: recorder("gate", { code: 1 }), finish: recorder("finish") }, { [CREATE_PRD]: { start: ["gate"], end: ["finish"] } }),
    );
    trust(project);
    const host = hostFor(project);
    const { ctx, texts } = fakeCtx(project);

    expect(await host.submit("/ensemble-create-prd one", ctx)).toBe("continue");
    expect(texts()[0]).toMatch(/gate: failed in \d+ ms: exited with code 1/);
    expect(texts()[0]).toContain("the handler failed; the command did not");
    await host.complete({ outcome: "succeeded" }, ctx);
    await host.settle(ctx, "completed");

    const [start] = eventsOf(project, "gate");
    expect(eventFor(project, "finish", start.run_id)).toMatchObject({ outcome: "succeeded" });
    expect(texts().at(-1)).toMatch(/finish: succeeded in \d+ ms/);
  });

  it("still has its end delivered as failed when the command then errors", async () => {
    const project = makeProject(
      hooksFile({ gate: recorder("gate", { code: 1 }), finish: recorder("finish") }, { [CREATE_PRD]: { start: ["gate"], end: ["finish"] } }),
    );
    trust(project);
    const host = hostFor(project);
    const { ctx } = fakeCtx(project);

    await host.submit("/ensemble-create-prd one", ctx);
    await host.settle(ctx, "error");

    const [start] = eventsOf(project, "gate");
    expect(eventFor(project, "finish", start.run_id)).toMatchObject({ outcome: "failed" });
  });
});

// ---- TRD-012-TEST: the shutdown bound -------------------------------------

describe("the shutdown bound", () => {
  const withEnd = (hooks: Record<string, unknown>, end: string[]) => makeProject(hooksFile({ audit: recorder("audit"), ...hooks }, { [CREATE_PRD]: { start: ["audit"], end } }));

  it("skips end handlers whose timeouts do not fit in the budget, tells the user which and why, and says SIGINT runs none", async () => {
    const project = withEnd({ finish: recorder("finish") }, ["finish"]); // finish keeps the default 5000 ms timeout
    trust(project);
    const host = hostFor(project, { shutdownBudgetMs: 300 });
    const { ctx, texts, levels } = fakeCtx(project);
    await host.submit("/ensemble-create-prd one", ctx);
    const shown = texts().length;

    const started = Date.now();
    await host.shutdown(ctx);

    expect(Date.now() - started).toBeLessThan(2000); // nothing waited for a handler that was never started
    expect(eventsOf(project, "finish")).toEqual([]);
    expect(began(project, "finish")).toBe(false);
    const notice = texts().slice(shown).join("\n");
    expect(notice).toContain(`end handlers for ${CREATE_PRD} (command.end) were skipped`);
    expect(notice).toContain("finish (up to 5000 ms)");
    expect(notice).toContain("300 ms");
    expect(notice).toContain(SIGINT_SHUTDOWN_NOTE);
    expect(notice).toMatch(/SIGINT in RPC mode runs no shutdown handler/);
    expect(levels().at(-1)).toBe("warning");
    expect(host.hostErrors).toEqual([]);
  });

  it("runs the end handlers that fit and skips only those that do not, naming exactly them", async () => {
    const project = withEnd(
      { quick: recorder("quick", { timeout_ms: 1500 }), slow: recorder("slow"), brief: recorder("brief", { timeout_ms: 1000 }) },
      ["quick", "slow", "brief"],
    );
    trust(project);
    const host = hostFor(project, { shutdownBudgetMs: 4000 });
    const { ctx, texts } = fakeCtx(project);
    await host.submit("/ensemble-create-prd one", ctx);
    const runId = runOf(project, "one");

    await host.shutdown(ctx);

    expect(eventFor(project, "quick", runId)).toMatchObject({ outcome: "cancelled" });
    expect(eventFor(project, "brief", runId)).toMatchObject({ outcome: "cancelled" });
    expect(eventsOf(project, "slow")).toEqual([]);
    const notice = texts().filter((t) => t.includes("were skipped")).join("\n");
    expect(notice).toContain("slow (up to 5000 ms)");
    expect(notice).not.toContain("quick (up to");
    expect(notice).not.toContain("brief (up to");
  });

  it("runs every end handler when the sum of their timeouts fits the budget", async () => {
    const project = withEnd({ one: recorder("one", { timeout_ms: 1000 }), two: recorder("two", { timeout_ms: 2000 }) }, ["one", "two"]);
    trust(project);
    const host = hostFor(project, { shutdownBudgetMs: 5000 });
    const { ctx, texts } = fakeCtx(project);
    await host.submit("/ensemble-create-prd one", ctx);

    await host.shutdown(ctx);

    expect(eventsOf(project, "one")).toHaveLength(1);
    expect(eventsOf(project, "two")).toHaveLength(1);
    expect(texts().some((t) => t.includes("were skipped"))).toBe(false);
  });

  it(`never lets the budget exceed ${SHUTDOWN_BOUND_CAP_MS} ms: a handler that could run longer is skipped`, async () => {
    const project = withEnd({ long: recorder("long", { timeout_ms: SHUTDOWN_BOUND_CAP_MS + 30_000 }) }, ["long"]);
    trust(project);
    const host = hostFor(project, { shutdownBudgetMs: 10 * SHUTDOWN_BOUND_CAP_MS });
    const { ctx, texts } = fakeCtx(project);
    await host.submit("/ensemble-create-prd one", ctx);

    await host.shutdown(ctx);

    expect(eventsOf(project, "long")).toEqual([]);
    const notice = texts().filter((t) => t.includes("were skipped")).join("\n");
    expect(notice).toContain(`long (up to ${SHUTDOWN_BOUND_CAP_MS + 30_000} ms)`);
    expect(notice).toContain(`${SHUTDOWN_BOUND_CAP_MS} ms allowed for shutdown`);
  });

  it("returns on time, and says so, when a handler started earlier is still running at the bound", async () => {
    const project = makeProject(
      hooksFile(
        { hung: recorder("hung", { hold: "holds/hung", timeout_ms: 30_000 }), finish: recorder("finish", { timeout_ms: 100 }) },
        { [CREATE_PRD]: { start: ["hung"], end: ["finish"] } },
      ),
    );
    trust(project);
    const host = hostFor(project, { shutdownBudgetMs: 400 });
    const { ctx, texts } = fakeCtx(project);
    const starting = host.submit("/ensemble-create-prd one", ctx);
    await until(() => began(project, "hung"), "the start handler to begin");

    const started = Date.now();
    await host.shutdown(ctx);
    const took = Date.now() - started;

    expect(took).toBeGreaterThanOrEqual(350); // it waited for the handler, up to the bound
    expect(took).toBeLessThan(3000); // and not a moment longer
    expect(began(project, "finish")).toBe(false);
    const notice = texts().filter((t) => t.includes("were skipped")).join("\n");
    expect(notice).toContain(CREATE_PRD);
    expect(notice).toMatch(/still running when the 400 ms allowed for shutdown ran out/);
    expect(notice).toContain(SIGINT_SHUTDOWN_NOTE);

    open(project, "holds/hung"); // let the handler go, so nothing outlives the test
    await starting;
    await delay(100);
    expect(began(project, "finish")).toBe(false); // the end told as skipped never runs afterwards
  });

  it("writes the notice to stderr when the host has no UI, as it does in print mode", async () => {
    const project = withEnd({ finish: recorder("finish") }, ["finish"]);
    trust(project);
    const host = hostFor(project, { shutdownBudgetMs: 100 });
    const { ctx, notify } = fakeCtx(project, { hasUI: false });
    await host.submit("/ensemble-create-prd one", ctx);

    await host.shutdown(ctx);

    expect(notify).not.toHaveBeenCalled();
    expect(stderrText.join("")).toMatch(/end handlers for ensemble:create-prd \(command\.end\) were skipped/);
    expect(stderrText.join("")).toContain("SIGINT");
  });

  it("leaves no timer running when shutdown finishes within the bound, so the process can exit at once", async () => {
    const project = withEnd({ finish: recorder("finish") }, ["finish"]);
    trust(project);
    const host = hostFor(project, { shutdownBudgetMs: 7777 }); // a delay nothing else in the process uses
    const { ctx } = fakeCtx(project);
    await host.submit("/ensemble-create-prd one", ctx);
    const created: unknown[] = [];
    const cleared: unknown[] = [];
    const realSet = global.setTimeout;
    const realClear = global.clearTimeout;
    const set = jest.spyOn(global, "setTimeout").mockImplementation(((handler: () => void, ms?: number) => {
      const timer = realSet(handler, ms);
      if (ms === 7777) created.push(timer);
      return timer;
    }) as unknown as typeof setTimeout);
    const clear = jest.spyOn(global, "clearTimeout").mockImplementation(((timer: NodeJS.Timeout) => {
      cleared.push(timer);
      return realClear(timer);
    }) as unknown as typeof clearTimeout);
    restores.push(() => set.mockRestore(), () => clear.mockRestore());

    await host.shutdown(ctx);

    expect(eventsOf(project, "finish")).toHaveLength(1); // the end handlers ran, within the bound
    expect(created).toHaveLength(1);
    expect(cleared).toContain(created[0]);
  });
});

// ---- TRD-012-TEST: the gate at the end (AC-022, REQ-021) ------------------

describe("the gate when a run ends", () => {
  it("runs no end handler once the hooks file was edited mid-run, and says how to trust it", async () => {
    const project = auditAndFinish();
    trust(project);
    const host = hostFor(project);
    const { ctx, texts } = fakeCtx(project);
    await host.submit("/ensemble-create-prd one", ctx);
    await host.complete({ outcome: "succeeded" }, ctx);

    editHooksFile(project); // the model edited the hooks file while the command ran
    await host.settle(ctx, "completed");

    expect(eventsOf(project, "finish")).toEqual([]);
    expect(began(project, "finish")).toBe(false);
    expect(texts().at(-1)).toContain("/ensemble-lifecycle-trust");
    expect(host.hostErrors).toEqual([]);
  });

  it.each(["an abort", "shutdown"])("runs no end handler at %s once the hooks file changed", async (how) => {
    const project = auditAndFinish();
    trust(project);
    const host = hostFor(project);
    const { ctx, texts } = fakeCtx(project);
    await host.submit("/ensemble-create-prd one", ctx);

    editHooksFile(project);
    if (how === "shutdown") await host.shutdown(ctx);
    else await host.settle(ctx, "aborted");

    expect(eventsOf(project, "finish")).toEqual([]);
    expect(texts().at(-1)).toContain("/ensemble-lifecycle-trust");
  });

  it("tells the user when the hooks file no longer selects the command, since its start handlers did run", async () => {
    const project = makeProject(
      hooksFile(
        { audit: recorder("audit"), finish: recorder("finish") },
        { [CREATE_PRD]: { start: ["audit"], end: ["finish"] }, [REFINE_PRD]: { start: ["audit"] } },
      ),
    );
    trust(project);
    const host = hostFor(project);
    const { ctx, texts } = fakeCtx(project);
    await host.submit("/ensemble-create-prd one", ctx);
    await host.complete({ outcome: "succeeded" }, ctx);

    writeFileSync(join(project.root, HOOKS_FILE_RELATIVE), hooksFile({ audit: recorder("audit") }, { [REFINE_PRD]: { start: ["audit"] } }));
    trust(project); // the user trusts the file as it is now: it simply no longer selects the command
    await host.settle(ctx, "completed");

    expect(eventsOf(project, "finish")).toEqual([]);
    expect(texts().at(-1)).toContain(`end handlers for ${CREATE_PRD} (command.end) did not run`);
    expect(texts().at(-1)).toContain(`${HOOKS_FILE_RELATIVE} no longer selects them`);
  });

  it("never throws: a host call that fails is shown to the user, at a settle and at shutdown", async () => {
    const project = auditAndFinish();
    trust(project);
    let broken = false;
    const host = hostFor(project, {}, {
      getCommands: () => {
        if (broken) throw new Error("the runtime is gone");
        return HOST_COMMANDS;
      },
    });
    const { ctx, texts } = fakeCtx(project);
    await host.submit("/ensemble-create-prd one", ctx);
    await host.complete({ outcome: "succeeded" }, ctx);
    broken = true;

    await host.settle(ctx, "completed");
    await host.shutdown(ctx);

    expect(host.hostErrors).toEqual([]);
    expect(texts().some((t) => t.includes("ensemble:create-prd (command.end) did not run: the runtime is gone"))).toBe(true);
    expect(eventsOf(project, "finish")).toEqual([]);
  });

  it("checks the gate again after delivering a waiting end, because the file may change while those handlers run", async () => {
    const project = makeProject(
      hooksFile(
        { audit: recorder("audit"), finish: recorder("finish", { hold: "holds/finish" }) },
        { [CREATE_PRD]: { start: ["audit"], end: ["finish"] }, [REFINE_PRD]: { start: ["audit"] } },
      ),
    );
    trust(project);
    const host = hostFor(project);
    const { ctx, texts } = fakeCtx(project);
    await host.submit("/ensemble-create-prd one", ctx);
    await host.complete({ outcome: "succeeded" }, ctx); // its end waits for the loop to settle

    const second = host.submit("/ensemble-refine-prd two", ctx, "steer"); // delivers that end first
    await until(() => began(project, "finish"), "the waiting end handler to begin");
    editHooksFile(project); // the model edits the hooks file while that end handler runs
    open(project, "holds/finish");

    expect(await second).toBe("continue");
    expect(eventsOf(project, "audit").map((e) => e.arguments)).toEqual(["one"]); // the second command's start handlers never ran
    expect(host.runtime.trackerFor(ctx).current()).toBeUndefined(); // and no run began
    expect(texts().at(-1)).toContain("/ensemble-lifecycle-trust");
  });
});

// ---- What the user is shown (AC-013-1, AC-013-2, AC-009-4) ----------------

describe("what the user is shown for each end handler", () => {
  it("shows each handler's status and duration, its truncation, and a failing one as the handler's failure and not the command's", async () => {
    const project = makeProject(
      hooksFile(
        { audit: recorder("audit"), ok: recorder("ok"), noisy: { type: "shell", command: "./scripts/noisy.sh", args: [], on_error: "continue" }, flaky: recorder("flaky", { code: 1 }) },
        { [CREATE_PRD]: { start: ["audit"], end: ["ok", "noisy", "flaky"] } },
      ),
    );
    trust(project);
    const host = hostFor(project);
    const { ctx, texts, levels } = fakeCtx(project);
    await host.submit("/ensemble-create-prd one", ctx);
    await host.complete({ outcome: "succeeded" }, ctx);

    await host.settle(ctx, "completed");

    const report = texts().at(-1) ?? "";
    expect(report).toContain("ensemble:create-prd (command.end, command succeeded)");
    expect(report).toMatch(/^ {2}ok: succeeded in \d+ ms$/m);
    expect(report).toMatch(/^ {2}noisy: succeeded in \d+ ms, output truncated at 64 KiB$/m);
    expect(report).toMatch(/^ {2}flaky: failed in \d+ ms: exited with code 1 \(the handler failed; the command's own outcome is unchanged\)$/m);
    expect(report).not.toContain("the command did not");
    expect(levels().at(-1)).toBe("warning");
  });

  it("shows a failing end handler beside a command that itself failed without reading as the command's failure", async () => {
    const project = makeProject(
      hooksFile({ audit: recorder("audit"), flaky: recorder("flaky", { code: 1 }) }, { [CREATE_PRD]: { start: ["audit"], end: ["flaky"] } }),
    );
    trust(project);
    const host = hostFor(project);
    const { ctx, texts } = fakeCtx(project);
    await host.submit("/ensemble-create-prd one", ctx);

    await host.settle(ctx, "error");

    const report = texts().at(-1) ?? "";
    expect(report).toContain("(command.end, command failed)");
    expect(report).toContain("reason: The agent loop ended in an error");
    expect(report).toContain("flaky: failed");
    expect(report).toContain("(the handler failed; the command's own outcome is unchanged)");
    expect(report).not.toContain("the command did not");
  });

  it("shows no reason line when the model gave an empty reason", async () => {
    const project = auditAndFinish();
    trust(project);
    const host = hostFor(project);
    const { ctx, texts } = fakeCtx(project);
    await host.submit("/ensemble-create-prd one", ctx);
    await host.complete({ outcome: "succeeded", reason: "" }, ctx);

    await host.settle(ctx, "completed");

    expect(texts().at(-1)).toContain("(command.end, command succeeded)");
    expect(texts().at(-1)).not.toContain("reason:");
  });

  it("shows nothing for the end of a command whose file selects no end handler", async () => {
    const project = makeProject(hooksFile({ audit: recorder("audit") }, { [CREATE_PRD]: { start: ["audit"] } }));
    trust(project);
    const host = hostFor(project);
    const { ctx, texts } = fakeCtx(project);
    await host.submit("/ensemble-create-prd one", ctx);
    const shown = texts().length;

    await host.complete({ outcome: "succeeded" }, ctx);
    await host.settle(ctx, "completed");
    await host.shutdown(ctx);

    expect(texts()).toHaveLength(shown);
  });
});

// ---- Operations never overlap ---------------------------------------------

describe("serialized operations", () => {
  it("holds a newer command until the run in flight has finished its start handlers, then ends that run before starting the newer one", async () => {
    const project = makeProject(
      hooksFile(
        {
          "a-start": recorder("a-start", { hold: "holds/a" }),
          "a-end": recorder("a-end"),
          "b-start": recorder("b-start"),
          "b-end": recorder("b-end"),
        },
        { [CREATE_PRD]: { start: ["a-start"], end: ["a-end"] }, [REFINE_PRD]: { start: ["b-start"], end: ["b-end"] } },
      ),
    );
    trust(project);
    const host = hostFor(project);
    const { ctx } = fakeCtx(project);

    const first = host.submit("/ensemble-create-prd one", ctx);
    await until(() => began(project, "a-start"), "the first start handler to begin");
    const second = host.submit("/ensemble-refine-prd two", ctx); // two prompts in a row: the host runs their handlers at the same time
    await delay(150); // long enough for a handler to have begun, had the runtime let it
    expect(began(project, "b-start")).toBe(false);
    expect(began(project, "a-end")).toBe(false);

    open(project, "holds/a");
    expect(await first).toBe("continue");
    expect(await second).toBe("continue");

    const [a] = eventsOf(project, "a-start");
    const [b] = eventsOf(project, "b-start");
    const trace = traceOf(project);
    // The runtime owns the order of the handlers: the first command's start handlers, then its end, then the newer command's start.
    expect(trace.filter((line) => !line.startsWith("model-prompt"))).toEqual([
      `a-start begin ${a.run_id}`,
      "a-start end",
      `a-end begin ${a.run_id}`,
      "a-end end",
      `b-start begin ${b.run_id}`,
      "b-start end",
    ]);
    // The host writes a prompt to the model once its input handlers return. That write races, on a loaded machine, with the next
    // queued operation (which spawns a real process a few microtasks earlier), so it is bounded by the runtime's order, not placed in it.
    const promptOne = trace.indexOf("model-prompt /ensemble-create-prd one");
    const promptTwo = trace.indexOf("model-prompt /ensemble-refine-prd two");
    expect(promptOne).toBeGreaterThan(trace.indexOf("a-start end"));
    expect(promptOne).toBeLessThan(trace.indexOf("b-start end"));
    expect(promptTwo).toBeGreaterThan(trace.indexOf("b-start end"));
    expect(trace).toHaveLength(8);
    expect(eventFor(project, "a-end", a.run_id)).toMatchObject({ outcome: "cancelled" });
    expect(host.runtime.trackerFor(ctx).current()?.run_id).toBe(b.run_id);
  });

  it("holds a newer command's input behind the end handlers a settle is running", async () => {
    const project = makeProject(
      hooksFile(
        { "a-end": recorder("a-end", { hold: "holds/end" }), "b-start": recorder("b-start") },
        { [CREATE_PRD]: { end: ["a-end"] }, [REFINE_PRD]: { start: ["b-start"] } },
      ),
    );
    trust(project);
    const host = hostFor(project);
    const { ctx } = fakeCtx(project);
    await host.submit("/ensemble-create-prd one", ctx);
    await host.complete({ outcome: "succeeded" }, ctx); // its end waits for the loop to settle

    const settling = host.settle(ctx, "completed");
    await until(() => began(project, "a-end"), "the first run's end handler to begin");
    const second = host.submit("/ensemble-refine-prd two", ctx); // arrives while the end handlers run
    await delay(150); // long enough for a handler to have begun, had the runtime let it
    expect(began(project, "b-start")).toBe(false);

    open(project, "holds/end");
    await Promise.all([settling, second]);

    const [a] = eventsOf(project, "a-end");
    const [b] = eventsOf(project, "b-start");
    expect(traceOf(project).filter((line) => !line.startsWith("model-"))).toEqual([
      `a-end begin ${a.run_id}`,
      "a-end end",
      `b-start begin ${b.run_id}`,
      "b-start end",
    ]);
    expect(host.runtime.trackerFor(ctx).current()?.run_id).toBe(b.run_id);
  });

  it("holds a direct endRun behind the operations queued before it", async () => {
    const project = makeProject(
      hooksFile({ slow: recorder("slow", { hold: "holds/slow" }), finish: recorder("finish") }, { [CREATE_PRD]: { start: ["slow"], end: ["finish"] } }),
    );
    trust(project);
    const host = hostFor(project);
    const { ctx } = fakeCtx(project);
    const starting = host.submit("/ensemble-create-prd one", ctx);
    await until(() => began(project, "slow"), "the start handler to begin");

    const ended = host.runtime.endRun(ctx, {
      run_id: "run-x",
      command: CREATE_PRD,
      arguments: "",
      cwd: ctx.cwd,
      session_id: "host-session-1",
      outcome: "cancelled",
      duration_ms: 1,
      reason: "ended by the test",
    });
    await delay(150); // long enough for a handler to have begun, had the runtime let it
    expect(began(project, "finish")).toBe(false);

    open(project, "holds/slow");
    await Promise.all([starting, ended]);
    const trace = traceOf(project);
    expect(trace.indexOf("slow end")).toBeGreaterThan(-1);
    expect(trace.indexOf("slow end")).toBeLessThan(trace.indexOf("finish begin run-x"));
    expect(eventFor(project, "finish", "run-x")).toMatchObject({ outcome: "cancelled", reason: "ended by the test" });
  });

  it("does not make a settle with nothing to deliver wait for the operations in front of it", async () => {
    const project = makeProject(hooksFile({ slow: recorder("slow", { hold: "holds/slow" }) }, { [CREATE_PRD]: { start: ["slow"] } }));
    trust(project);
    const host = hostFor(project);
    const { ctx } = fakeCtx(project);
    const starting = host.submit("/ensemble-create-prd one", ctx);
    await until(() => began(project, "slow"), "the start handler to begin");

    await host.settle(ctx, "completed"); // the loop of an earlier command settles while the start handler runs

    expect(traceOf(project).some((line) => line.startsWith("slow end"))).toBe(false); // it did not wait for that handler
    open(project, "holds/slow");
    await starting;
  });
});

// ---- Which run a signal is about ------------------------------------------

describe("signals from a loop that is not the run's", () => {
  it("does not let a completion call end a run whose start handlers are still running", async () => {
    const project = makeProject(
      hooksFile({ slow: recorder("slow", { hold: "holds/slow" }), finish: recorder("finish") }, { [CREATE_PRD]: { start: ["slow"], end: ["finish"] } }),
    );
    trust(project);
    const host = hostFor(project);
    const { ctx } = fakeCtx(project);
    const starting = host.submit("/ensemble-create-prd one", ctx);
    await until(() => began(project, "slow"), "the start handler to begin");
    const runId = host.runtime.trackerFor(ctx).current()?.run_id;

    expect(await host.complete({ outcome: "succeeded" }, ctx)).toEqual({ text: COMPLETION_NOT_STARTED, recorded: false });
    expect(host.runtime.trackerFor(ctx).current()?.run_id).toBe(runId);

    open(project, "holds/slow");
    await starting;
    expect(await host.complete({ outcome: "succeeded" }, ctx)).toEqual({ text: COMPLETION_ACKNOWLEDGEMENT, recorded: true });
    await host.settle(ctx, "completed");
    expect(eventsOf(project, "finish")).toHaveLength(1);
  });

  it("does not let an abort or an error outcome end a run whose start handlers are still running", async () => {
    const project = makeProject(
      hooksFile(
        { quick: recorder("quick"), slow: recorder("slow", { hold: "holds/slow" }), finish: recorder("finish") },
        { [CREATE_PRD]: { start: ["quick"] }, [REFINE_PRD]: { start: ["slow"], end: ["finish"] } },
      ),
    );
    trust(project);
    const host = hostFor(project);
    const { ctx } = fakeCtx(project);
    await host.submit("/ensemble-create-prd one", ctx); // a loop is running
    const starting = host.submit("/ensemble-refine-prd two", ctx, "steer"); // and a newer command arrives
    await until(() => began(project, "slow"), "the newer start handler to begin");
    const runId = host.runtime.trackerFor(ctx).current()?.run_id;

    await host.settle(ctx, "aborted"); // the running loop is aborted: not about the newer command
    await host.settle(ctx, "error");

    expect(host.runtime.trackerFor(ctx).current()?.run_id).toBe(runId);
    expect(eventsOf(project, "finish")).toEqual([]);
    open(project, "holds/slow");
    expect(await starting).toBe("continue");
  });

  it("does not let a completion call, an abort or an error end a run whose prompt the host still holds in its queue", async () => {
    const project = auditAndFinish();
    trust(project);
    const host = hostFor(project);
    let queued = false;
    const { ctx } = fakeCtx(project, { pending: () => queued });
    await host.submit("/ensemble-create-prd one", ctx); // a loop is running on the first command
    queued = true; // the host queues the second command's prompt behind it

    expect(await host.submit("/ensemble-refine-prd two", ctx, "steer")).toBe("continue");
    const second = runOf(project, "two");
    expect(eventFor(project, "finish", runOf(project, "one"))).toMatchObject({ outcome: "cancelled" }); // the first ended at the second's input

    expect(await host.complete({ outcome: "succeeded" }, ctx)).toEqual({ text: COMPLETION_NOT_STARTED, recorded: false }); // the first command's own call
    await host.settle(ctx, "aborted");
    await host.settle(ctx, "error");
    expect(host.runtime.trackerFor(ctx).current()?.run_id).toBe(second);
    expect(eventFor(project, "finish", second)).toBeUndefined();

    queued = false; // Pi delivered the prompt: the next call is the second command's
    expect(await host.complete({ outcome: "succeeded" }, ctx)).toEqual({ text: COMPLETION_ACKNOWLEDGEMENT, recorded: true });
    await host.settle(ctx, "completed");
    expect(eventFor(project, "finish", second)).toMatchObject({ outcome: "succeeded" });
    expect(eventsOf(project, "finish")).toHaveLength(2);
  });

  it("never holds back a prompt submitted while the agent was idle, whatever the host has queued", async () => {
    const project = auditAndFinish();
    trust(project);
    const host = hostFor(project);
    const { ctx } = fakeCtx(project, { pending: () => true });
    await host.submit("/ensemble-create-prd one", ctx);

    expect(await host.complete({ outcome: "succeeded" }, ctx)).toEqual({ text: COMPLETION_ACKNOWLEDGEMENT, recorded: true });
  });

  it("treats a host that cannot say what is queued as having nothing queued", async () => {
    const project = auditAndFinish();
    trust(project);
    const host = hostFor(project);
    const { ctx } = fakeCtx(project);
    Object.assign(ctx, { hasPendingMessages: undefined });
    await host.submit("/ensemble-create-prd one", ctx);
    await host.submit("/ensemble-refine-prd two", ctx, "steer");

    expect(await host.complete({ outcome: "succeeded" }, ctx)).toEqual({ text: COMPLETION_ACKNOWLEDGEMENT, recorded: true });
  });
});

// ---- The unsupported-hook warning (AC-014-3, AC-017-1) --------------------

describe("the unsupported-hook warning", () => {
  /** A harness that cannot end a command it did not see finish: an end hook needs command_end_on_cancel. */
  const NO_CANCEL = { ...HARNESS_CAPABILITIES, pi: { ...HARNESS_CAPABILITIES.pi, command_end_on_cancel: false } };

  it("names the hook, the command and the capability once per change to the file, and the command still runs", async () => {
    const project = auditAndFinish();
    trust(project);
    const host = hostFor(project, { capabilities: NO_CANCEL });
    const { ctx, texts, levels } = fakeCtx(project);

    await host.submit("/ensemble-create-prd one", ctx);
    await host.complete({ outcome: "succeeded" }, ctx);
    await host.settle(ctx, "completed");
    await host.submit("/ensemble-refine-prd two", ctx);
    await host.settle(ctx, "aborted");

    const warnings = texts().filter((t) => t.includes("need what Pi does not support"));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('Hook "finish"');
    expect(warnings[0]).toContain(CREATE_PRD);
    expect(warnings[0]).toContain("command_end_on_cancel");
    expect(levels()[texts().indexOf(warnings[0])]).toBe("warning");
    expect(eventsOf(project, "audit")).toHaveLength(2); // the commands still ran

    editHooksFile(project);
    trust(project);
    await host.submit("/ensemble-create-prd three", ctx);
    expect(texts().filter((t) => t.includes("need what Pi does not support"))).toHaveLength(2); // the file changed: said again
  });

  it("says nothing with the real table, because Pi supports every capability", async () => {
    const project = auditAndFinish();
    trust(project);
    const host = hostFor(project);
    const { ctx, texts } = fakeCtx(project);

    await host.submit("/ensemble-create-prd one", ctx);
    await host.complete({ outcome: "succeeded" }, ctx);
    await host.settle(ctx, "completed");

    expect(texts().filter((t) => t.includes("does not support"))).toEqual([]);
  });

  it("says nothing for a command the file does not select", async () => {
    const project = makeProject(hooksFile({ audit: recorder("audit"), finish: recorder("finish") }, { [CREATE_PRD]: { start: ["audit"], end: ["finish"] } }));
    trust(project);
    const host = hostFor(project, { capabilities: NO_CANCEL });
    const { ctx, texts } = fakeCtx(project);

    await host.submit("/ensemble-refine-prd one", ctx);

    expect(texts()).toEqual([]);
  });
});

// ---- Wiring: registerLifecycleHooks and activate() ------------------------

describe("what the adapter registers", () => {
  it("registers the completion tool and a handler for each event of the end path, and only when a hooks file exists", () => {
    const project = auditAndFinish();
    const host = fakeHost(project);

    registerLifecycleHooks(host.pi, project.root, { storePath: project.storePath });

    expect(host.registered.tools).toEqual([COMPLETION_TOOL_NAME]);
    expect(host.registered.commands).toEqual(["ensemble-lifecycle-trust"]);
    expect(host.registered.events).toEqual(["agent_before_settle", "agent_settled", "before_agent_start", "input", "session_shutdown"]);
  });

  it("registers nothing when the project has no hooks file", () => {
    const project = auditAndFinish();
    rmSync(join(project.root, HOOKS_FILE_RELATIVE));
    const host = fakeHost(project);

    expect(registerLifecycleHooks(host.pi, project.root, { storePath: project.storePath })).toBeUndefined();

    expect(host.registered).toEqual({ events: [], tools: [], commands: [] });
  });

  it("runs the whole lifecycle through activate(): start, the completion tool, the settle and the end", async () => {
    const project = auditAndFinish();
    const defaultStore = defaultTrustStorePath();
    expect(defaultStore.startsWith(tempHome)).toBe(true); // never trust a project in the real home
    trust(project, defaultStore);
    process.chdir(project.root);
    const host = fakeHost(project);
    const { ctx } = fakeCtx(project);

    activate(host.pi);
    await host.submit("/ensemble-create-prd one", ctx);
    await host.complete({ outcome: "succeeded", summary: "done" }, ctx);
    await host.settle(ctx, "completed");

    const runId = runOf(project, "one");
    expect(traceOf(project)).toEqual([
      `audit begin ${runId}`,
      "audit end",
      "model-prompt /ensemble-create-prd one",
      "model-output",
      `finish begin ${runId}`,
      "finish end",
    ]);
    expect(eventFor(project, "finish", runId)).toMatchObject({ outcome: "succeeded", summary: "done" });
    expect(host.hostErrors).toEqual([]);
  });
});
