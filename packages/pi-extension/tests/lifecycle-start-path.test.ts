import {
  appendFileSync,
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import { join, resolve } from "node:path";
import { setImmediate as nextTurn, setTimeout as delay } from "node:timers/promises";
import type { ExtensionAPI, ExtensionContext, InputEvent, InputEventResult } from "@earendil-works/pi-coding-agent";
import {
  HOOKS_FILE_RELATIVE,
  computeHooksDigest,
  defaultTrustStorePath,
  loadHooksConfig,
  recordTrust,
} from "@sunstone-partners/ensemble-agent-core";
import type { CompletionInput, EndResult, LifecycleEvent, PromptEvaluator } from "@sunstone-partners/ensemble-agent-core";
import activate from "../src/extension";
import { knownCommandsFromHost, registerLifecycleHooks } from "../src/lifecycle/adapter";
import type { LifecycleOptions, LifecycleRuntime } from "../src/lifecycle/adapter";

/**
 * TRD-010-TEST: the start path (AC-001-1, AC-002-1, AC-002-2, AC-002-3,
 * AC-004-5), driven through the real entry points, `registerLifecycleHooks`
 * and `activate()`.
 *
 * Everything is real except the host. Handlers are real executables that
 * append to `trace.log` and keep the event JSON they were given, in temporary
 * projects with the user's trust recorded in a temporary store. "Ran before",
 * "never ran" and "ran once" are read from those files, never from mocks. A
 * handler that must still be running at some moment waits for a file the test
 * writes (`release`), so the order is decided by the test, not by a guess at
 * how long a process takes.
 *
 * The fake host copies what Pi 1.2.0 was measured to do (the adapter's header
 * lists it): `{ action: "handled" }` stops the prompt, a handler that throws
 * does not, the text of a registered extension command never reaches `input`,
 * and `sendUserMessage` with `expandPromptTemplates` runs extension commands
 * and then `input`. When a prompt would reach the model it appends
 * `model-prompt` to the same trace, so the order is visible in one place.
 *
 * Until the completion tool and the end path exist, `complete` below stands in
 * for them: it ends the run in flight the way the tool will (`tracker.complete`)
 * and delivers the end through `runtime.endRun`, the seam they will use.
 */

const REPO_ROOT = resolve(__dirname, "../../..");

const CREATE_PRD = "ensemble:create-prd";
const REFINE_PRD = "ensemble:refine-prd";
const PRD_DISPATCHER = "ensemble:prd";

/** What Pi reports for `getCommands()`: every command the hooks files below select exists. */
const HOST_COMMANDS = [{ name: "ensemble-create-prd" }, { name: "ensemble-refine-prd" }, { name: "ensemble-prd" }];

/** `-` as the second argument means "do not wait"; any other value is a file under the project root to wait for. */
const RECORD_SCRIPT = `#!/bin/sh
# record.sh <tag> <wait-for> <exit code>: notes that it began, keeps the event it was given,
# waits for the file <wait-for> under the project root to exist, notes that it ended, and exits.
tag="$1"; wait_for="$2"; code="$3"
printf '%s begin %s\\n' "$tag" "$ENSEMBLE_RUN_ID" >> "$ENSEMBLE_PROJECT_ROOT/trace.log"
cat > "$ENSEMBLE_PROJECT_ROOT/events/$tag.$ENSEMBLE_RUN_ID.json"
if [ "$wait_for" != "-" ]; then
  until [ -e "$ENSEMBLE_PROJECT_ROOT/$wait_for" ]; do sleep 0.02; done
fi
printf '%s end\\n' "$tag" >> "$ENSEMBLE_PROJECT_ROOT/trace.log"
exit "$code"
`;
/** Prints more than the 64 KiB a handler's output is bounded to. */
const NOISY_SCRIPT = `#!/bin/sh
head -c 70000 /dev/zero | tr '\\0' x
`;
/** Prints a terminal escape sequence and fails. */
const ESCAPE_SCRIPT = `#!/bin/sh
printf '\\033[2Jevil\\n'
exit 1
`;

const dirs: string[] = [];
const originalCwd = process.cwd();
const restores: Array<() => void> = [];
let stderrText: string[] = [];
/** The home directory every test sees: `os.homedir()` returns it, so the default trust store is never the real one. */
let tempHome = "";

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
  tempHome = tempDir("lifecycle-start-home-");
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
});

// ---- Fixtures -------------------------------------------------------------

type ErrorPolicy = "continue" | "block";

/** A shell handler that runs `scripts/record.sh`. `tag` names its files; `waitFor` is a file it waits for. */
function recorder(tag: string, options: { waitFor?: string; code?: number; on_error?: ErrorPolicy; timeout_ms?: number } = {}) {
  return {
    type: "shell",
    command: "./scripts/record.sh",
    args: [tag, options.waitFor ?? "-", String(options.code ?? 0)],
    on_error: options.on_error ?? "continue",
    ...(options.timeout_ms === undefined ? {} : { timeout_ms: options.timeout_ms }),
  };
}

/** A shell handler that runs one of the other scripts, which take no arguments. */
function script(file: string) {
  return { type: "shell", command: `./scripts/${file}`, args: [], on_error: "continue" };
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

/** A project anchored by `.git`, with its hooks file, handler scripts and a prompt file. */
function makeProject(hooks: string): Project {
  const root = tempDir("lifecycle-start-project-");
  for (const dir of [".git", ".ensemble", "scripts", "prompts", "events", "sub"]) mkdirSync(join(root, dir));
  writeFileSync(join(root, HOOKS_FILE_RELATIVE), hooks);
  for (const [file, body] of [
    ["record.sh", RECORD_SCRIPT],
    ["noisy.sh", NOISY_SCRIPT],
    ["escape.sh", ESCAPE_SCRIPT],
  ]) {
    writeFileSync(join(root, "scripts", file), body);
    chmodSync(join(root, "scripts", file), 0o755);
  }
  writeFileSync(join(root, "prompts/review.md"), "Check that the arguments name a ticket.\n");
  return {
    root,
    storePath: join(tempDir("lifecycle-start-store-"), ".ensemble", "trusted-hooks.json"),
    trace: join(root, "trace.log"),
  };
}

/** Writes the file that handlers started with `waitFor: name` are waiting for. */
function release(project: Project, name = "release"): void {
  writeFileSync(join(project.root, name), "");
}

/** A project whose only hook is `audit`, a start handler on `ensemble:create-prd`. */
function auditOnCreate(): Project {
  return makeProject(hooksFile({ audit: recorder("audit") }, { [CREATE_PRD]: { start: ["audit"] } }));
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

/**
 * Waits until `condition` holds. Handlers are real processes on the platform
 * clock, so the only way to see that one has begun is to poll for it; this
 * waits for a condition, never for a guessed duration.
 */
async function until(condition: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + 5000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await delay(10);
  }
}

interface CtxOptions {
  cwd?: string;
  hasUI?: boolean;
  /** What `isProjectTrusted()` returns; "none" removes the method. */
  hostTrust?: boolean | "none";
  /** The host's session manager; `undefined` is a host with none. */
  sessionManager?: unknown;
  notify?: (message: string) => void;
}

/** A host context for one event. `texts()` is every message the user was shown through the UI. */
function fakeCtx(project: Project, options: CtxOptions = {}) {
  const notify = jest.fn((message: string, _level?: string) => options.notify?.(message));
  const ctx = {
    cwd: options.cwd ?? join(project.root, "sub"),
    hasUI: options.hasUI ?? true,
    ui: { notify },
    ...(options.hostTrust === "none" ? {} : { isProjectTrusted: () => options.hostTrust ?? true }),
    sessionManager: "sessionManager" in options ? options.sessionManager : { getSessionId: () => "host-session-1" },
  } as unknown as ExtensionContext;
  return { ctx, notify, texts: () => notify.mock.calls.map(([message]) => message) };
}

type Verdict = "handled" | "continue";
type InputHandler = (event: InputEvent, ctx: ExtensionContext) => InputEventResult | void | Promise<InputEventResult | void>;
interface ExtensionCommand {
  handler: (args: string, ctx: ExtensionContext) => Promise<void>;
}

interface FakeHost {
  pi: ExtensionAPI;
  /** The prompts that reached the model. */
  toModel: string[];
  /** The texts `input` handlers were asked about. */
  inputTexts: string[];
  /** What a throwing handler left for Pi to print. */
  hostErrors: string[];
  /** Events other than `input` that something registered for. */
  otherEvents: string[];
  inputHandlerCount(): number;
  /** The user submits `text`. */
  deliver(text: string, ctx: ExtensionContext, source?: InputEvent["source"]): Promise<Verdict>;
  /** Waits for the prompts that extension commands forwarded. */
  settle(): Promise<void>;
}

interface RegisteredHost extends FakeHost {
  runtime: LifecycleRuntime;
}

/** A host that behaves as Pi 1.2.0 was measured to behave. See the header. */
function fakeHost(project: Project, options: { getCommands?: () => { name: string }[] } = {}): FakeHost {
  const inputHandlers: InputHandler[] = [];
  const otherEvents: string[] = [];
  const extensionCommands = new Map<string, ExtensionCommand>();
  const toModel: string[] = [];
  const inputTexts: string[] = [];
  const hostErrors: string[] = [];
  const forwarded: Promise<unknown>[] = [];
  let lastCtx: ExtensionContext | undefined;

  /** `AgentSession.prompt`: an extension command runs and fires no `input`; otherwise `input` handlers decide. */
  async function prompt(text: string, ctx: ExtensionContext, source: InputEvent["source"], expandPromptTemplates: boolean): Promise<Verdict> {
    if (expandPromptTemplates && text.startsWith("/")) {
      const space = text.indexOf(" ");
      const command = extensionCommands.get(space === -1 ? text.slice(1) : text.slice(1, space));
      if (command) {
        await command.handler(space === -1 ? "" : text.slice(space + 1), ctx);
        return "handled";
      }
    }
    inputTexts.push(text);
    for (const handler of inputHandlers) {
      try {
        const result = (await handler({ type: "input", text, source }, ctx)) as InputEventResult | undefined;
        if (result?.action === "handled") return "handled";
      } catch (error) {
        hostErrors.push(String(error)); // Pi prints "Extension error" and lets the input continue.
      }
    }
    appendFileSync(project.trace, `model-prompt ${text}\n`);
    toModel.push(text);
    return "continue";
  }

  const pi = {
    on: (event: string, handler: InputHandler) => {
      if (event === "input") inputHandlers.push(handler);
      else otherEvents.push(event);
    },
    registerTool: () => undefined, // registerLifecycleHooks registers the completion tool
    registerCommand: (name: string, command: ExtensionCommand) => {
      extensionCommands.set(name, command);
    },
    getCommands: () => (options.getCommands?.() ?? HOST_COMMANDS).map((command) => ({ ...command, source: "prompt" })),
    sendUserMessage: (text: string, sendOptions?: { expandPromptTemplates?: boolean }) => {
      if (!lastCtx) throw new Error("no prompt has been delivered yet");
      forwarded.push(prompt(text, lastCtx, "extension", sendOptions?.expandPromptTemplates === true));
    },
  } as unknown as ExtensionAPI;

  return {
    pi,
    toModel,
    inputTexts,
    hostErrors,
    otherEvents,
    inputHandlerCount: () => inputHandlers.length,
    deliver(text, ctx, source = "interactive") {
      lastCtx = ctx;
      return prompt(text, ctx, source, true);
    },
    async settle() {
      await Promise.all(forwarded);
    },
  };
}

/** A host with the adapter registered through its real entry point. */
function hostFor(
  project: Project,
  options: LifecycleOptions = {},
  hostOptions: { getCommands?: () => { name: string }[] } = {},
): RegisteredHost {
  const host = fakeHost(project, hostOptions);
  const runtime = registerLifecycleHooks(host.pi, project.root, { storePath: project.storePath, ...options });
  if (!runtime) throw new Error("the fixture has a hooks file, so the adapter must register");
  return { ...host, runtime };
}

/** The model completes the run in flight, and its end is delivered. See the header. */
async function complete(runtime: LifecycleRuntime, ctx: ExtensionContext, input: CompletionInput): Promise<EndResult> {
  const end = runtime.trackerFor(ctx).complete(input);
  if (!end) throw new Error("no run was in flight to complete");
  await runtime.endRun(ctx, end);
  return end;
}

// ---- TRD-010-TEST: start before workflow (AC-001-1, AC-002-1) -------------

describe("start before the workflow", () => {
  it("runs the start handler to completion before the input is let through", async () => {
    const project = makeProject(hooksFile({ audit: recorder("audit", { waitFor: "release" }) }, { [CREATE_PRD]: { start: ["audit"] } }));
    trust(project);
    const host = hostFor(project);
    const { ctx } = fakeCtx(project);

    let settled = false;
    const pending = host.deliver("/ensemble-create-prd foo", ctx).then((verdict) => {
      settled = true;
      return verdict;
    });
    await until(() => traceOf(project).some((line) => line.startsWith("audit begin")), "the start handler to begin");
    await nextTurn(); // a handler that had already returned would have settled by now
    expect(settled).toBe(false);
    expect(host.toModel).toEqual([]);

    release(project);
    expect(await pending).toBe("continue");
    const [start] = eventsOf(project, "audit");
    expect(traceOf(project)).toEqual([`audit begin ${start.run_id}`, "audit end", "model-prompt /ensemble-create-prd foo"]);
    expect(host.hostErrors).toEqual([]);
  });

  it("gives the handler the command.start event: a fresh run id, the host's session id and working directory", async () => {
    const project = auditOnCreate();
    trust(project);
    const host = hostFor(project);
    const { ctx } = fakeCtx(project);

    await host.deliver("/ensemble-create-prd foo bar", ctx);
    await host.deliver("/ensemble-create-prd again", ctx);

    const starts = eventsOf(project, "audit");
    expect(starts).toHaveLength(2);
    for (const start of starts) {
      expect(start).toMatchObject({
        event: "command.start",
        command: CREATE_PRD,
        cwd: ctx.cwd,
        session_id: "host-session-1",
      });
      expect(start.run_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect(Number.isNaN(Date.parse(start.timestamp))).toBe(false);
      expect(start.outcome).toBeUndefined();
    }
    expect(starts.map((s) => s.arguments).sort()).toEqual(["again", "foo bar"]);
    expect(new Set(starts.map((s) => s.run_id)).size).toBe(2);
  });

  it("redacts the arguments before any handler sees them", async () => {
    const project = auditOnCreate();
    trust(project);
    const host = hostFor(project);
    const { ctx } = fakeCtx(project);

    await host.deliver("/ensemble-create-prd ship it token=hunter2", ctx);

    const [start] = eventsOf(project, "audit");
    expect(start.arguments).toBe("ship it token=[REDACTED]");
    expect(JSON.stringify(start)).not.toContain("hunter2");
  });

  it.each(["interactive", "rpc", "extension"] as const)("starts the same run for an input whose source is %s", async (source) => {
    const project = auditOnCreate();
    trust(project);
    const host = hostFor(project);
    const { ctx } = fakeCtx(project);

    expect(await host.deliver("/ensemble-create-prd foo", ctx, source)).toBe("continue");

    expect(eventsOf(project, "audit").map((e) => [e.command, e.arguments])).toEqual([[CREATE_PRD, "foo"]]);
  });

  it("resolves the skill form of a command to the same command", async () => {
    const project = auditOnCreate();
    trust(project);
    const host = hostFor(project);
    const { ctx } = fakeCtx(project);

    await host.deliver("/skill:ensemble-create-prd foo", ctx);

    expect(eventsOf(project, "audit").map((e) => [e.command, e.arguments])).toEqual([[CREATE_PRD, "foo"]]);
  });

  it("starts a run for a command that selects only end handlers, and shows nothing", async () => {
    const project = makeProject(hooksFile({ finish: recorder("finish") }, { [CREATE_PRD]: { end: ["finish"] } }));
    trust(project);
    const host = hostFor(project);
    const { ctx, notify } = fakeCtx(project);

    expect(await host.deliver("/ensemble-create-prd foo", ctx)).toBe("continue");

    expect(host.runtime.trackerFor(ctx).current()?.command).toBe(CREATE_PRD);
    expect(notify).not.toHaveBeenCalled();
    expect(traceOf(project)).toEqual(["model-prompt /ensemble-create-prd foo"]);
  });
});

// ---- TRD-010-TEST: block is enforced (AC-002-3, AC-004-5, AC-010-2) -------

describe("a start handler that blocks", () => {
  const blocking = () =>
    makeProject(
      hooksFile(
        {
          gate: recorder("gate", { code: 3, on_error: "block" }),
          later: recorder("later"),
          finish: recorder("finish"),
        },
        { [CREATE_PRD]: { start: ["gate", "later"], end: ["finish"] } },
      ),
    );

  it("makes the input handled, so the prompt never reaches the model", async () => {
    const project = blocking();
    trust(project);
    const host = hostFor(project);
    const { ctx } = fakeCtx(project);

    const verdict = await host.deliver("/ensemble-create-prd foo", ctx);

    expect(verdict).toBe("handled");
    expect(host.toModel).toEqual([]);
    expect(traceOf(project).filter((line) => line.startsWith("model-prompt"))).toEqual([]);
    expect(host.hostErrors).toEqual([]);
  });

  it("stops the start handlers after the one that blocked (AC-012-3)", async () => {
    const project = blocking();
    trust(project);
    const host = hostFor(project);
    const { ctx } = fakeCtx(project);

    await host.deliver("/ensemble-create-prd foo", ctx);

    expect(eventsOf(project, "gate")).toHaveLength(1);
    expect(eventsOf(project, "later")).toEqual([]);
  });

  it("tells the user which handler blocked and that the command did not run", async () => {
    const project = blocking();
    trust(project);
    const host = hostFor(project);
    const { ctx, notify } = fakeCtx(project);

    await host.deliver("/ensemble-create-prd foo", ctx);

    expect(notify).toHaveBeenCalledTimes(2); // the start report, then the end report of the failed run
    const [message, level] = notify.mock.calls[0];
    expect(level).toBe("error");
    expect(message).toMatch(/gate: blocked in \d+ ms/);
    expect(message).toContain('ensemble:create-prd did not run: start handler "gate" blocked it.');
  });

  it("ends the run as failed, naming the block, with the run's own id (AC-004-5)", async () => {
    const project = blocking();
    trust(project);
    const host = hostFor(project);
    const { ctx } = fakeCtx(project);

    await host.deliver("/ensemble-create-prd foo", ctx);

    const [start] = eventsOf(project, "gate");
    const ends = eventsOf(project, "finish");
    expect(ends).toHaveLength(1);
    expect(ends[0]).toMatchObject({ event: "command.end", run_id: start.run_id, command: CREATE_PRD, outcome: "failed" });
    expect(ends[0].reason).toContain('Blocked by start handler "gate"');
    expect(host.runtime.trackerFor(ctx).current()).toBeUndefined();
  });

  it("gives every blocked start exactly one end, never a cancelled one", async () => {
    const project = blocking();
    trust(project);
    const host = hostFor(project);
    const { ctx } = fakeCtx(project);

    await host.deliver("/ensemble-create-prd one", ctx);
    await host.deliver("/ensemble-create-prd two", ctx);

    const starts = eventsOf(project, "gate");
    const ends = eventsOf(project, "finish");
    expect(ends.map((e) => e.outcome)).toEqual(["failed", "failed"]);
    expect(new Set(ends.map((e) => e.run_id))).toEqual(new Set(starts.map((e) => e.run_id)));
  });

  it("lets the same handler fail without blocking when its on_error is continue", async () => {
    const project = makeProject(
      hooksFile({ gate: recorder("gate", { code: 3 }), later: recorder("later") }, { [CREATE_PRD]: { start: ["gate", "later"] } }),
    );
    trust(project);
    const host = hostFor(project);
    const { ctx } = fakeCtx(project);

    expect(await host.deliver("/ensemble-create-prd foo", ctx)).toBe("continue");

    expect(eventsOf(project, "later")).toHaveLength(1);
    expect(host.toModel).toEqual(["/ensemble-create-prd foo"]);
    expect(host.runtime.trackerFor(ctx).current()?.command).toBe(CREATE_PRD);
  });

  it("blocks through a prompt handler, which gets the prompt file and the same event JSON", async () => {
    const calls: Array<{ prompt: string; eventJson: string }> = [];
    const evaluator: PromptEvaluator = async ({ prompt, eventJson }) => {
      calls.push({ prompt, eventJson });
      return JSON.stringify({ continue: false, message: "needs a ticket", findings: [{ message: "no ticket id", severity: "warning" }] });
    };
    const project = makeProject(
      hooksFile(
        { review: { type: "prompt", prompt: "./prompts/review.md", on_error: "block" } },
        { [CREATE_PRD]: { start: ["review"] } },
      ),
    );
    trust(project);
    const host = hostFor(project, { promptEvaluator: evaluator });
    const { ctx, texts } = fakeCtx(project);

    expect(await host.deliver("/ensemble-create-prd foo", ctx)).toBe("handled");

    expect(calls).toHaveLength(1);
    expect(calls[0].prompt).toContain("name a ticket");
    expect(JSON.parse(calls[0].eventJson)).toMatchObject({ event: "command.start", command: CREATE_PRD, arguments: "foo" });
    expect(texts()[0]).toContain("review: blocked");
    expect(texts()[0]).toContain("needs a ticket");
    expect(texts()[0]).toContain("warning: no ticket id");
    expect(host.toModel).toEqual([]);
  });

  it("blocks even when the user cannot be told, because the UI call throws", async () => {
    const project = blocking();
    trust(project);
    const host = hostFor(project);
    const { ctx } = fakeCtx(project, {
      notify: () => {
        throw new Error("the UI is gone");
      },
    });

    const verdict = await host.deliver("/ensemble-create-prd foo", ctx);

    expect(verdict).toBe("handled");
    expect(host.hostErrors).toEqual([]);
    expect(host.toModel).toEqual([]);
    expect(stderrText.join("")).toContain('start handler "gate" blocked it');
  });
});

// ---- TRD-010-TEST: rejected arguments (AC-002-2, AC-021-7) ----------------

describe("a started run that the command then fails", () => {
  it("ends as failed with the reason the command gave, under the run id that started", async () => {
    const project = makeProject(
      hooksFile({ audit: recorder("audit"), finish: recorder("finish") }, { [CREATE_PRD]: { start: ["audit"], end: ["finish"] } }),
    );
    trust(project);
    const host = hostFor(project);
    const { ctx } = fakeCtx(project);
    await host.deliver("/ensemble-create-prd", ctx);
    expect(eventsOf(project, "finish")).toEqual([]);

    await complete(host.runtime, ctx, { outcome: "failed", reason: "arguments rejected: no description given" });

    const [start] = eventsOf(project, "audit");
    const ends = eventsOf(project, "finish");
    expect(ends).toHaveLength(1);
    expect(ends[0]).toMatchObject({
      event: "command.end",
      run_id: start.run_id,
      command: CREATE_PRD,
      session_id: "host-session-1",
      outcome: "failed",
      reason: "arguments rejected: no description given",
    });
    expect(ends[0].duration_ms).toBeGreaterThanOrEqual(0);
  });
});

// ---- TRD-010-TEST: plain-text reply (AC-021-5) ----------------------------

describe("an input that is not a selected command", () => {
  const selecting = () =>
    makeProject(
      hooksFile(
        { audit: recorder("audit"), finish: recorder("finish") },
        { [CREATE_PRD]: { start: ["audit"], end: ["finish"] } },
      ),
    );

  it("neither begins nor supersedes a run, whatever it is", async () => {
    const project = selecting();
    trust(project);
    const host = hostFor(project);
    const { ctx, notify } = fakeCtx(project);
    await host.deliver("/ensemble-create-prd foo", ctx);
    const before = host.runtime.trackerFor(ctx).current();
    expect(before?.command).toBe(CREATE_PRD);
    const shown = notify.mock.calls.length;

    const inputs = [
      "yes, use the second option",
      "",
      "   ",
      "/help",
      "/compact keep the decisions",
      "please run /ensemble-create-prd foo",
      " /ensemble-create-prd foo",
      "/ensemble:create-prd foo",
      "/ensemble-refine-prd x", // an Ensemble command the hooks file does not select
      "/ensemble-prd nonsense x", // a dispatcher with no such keyword
    ];
    for (const text of inputs) expect(await host.deliver(text, ctx)).toBe("continue");

    expect(host.runtime.trackerFor(ctx).current()).toEqual(before);
    expect(eventsOf(project, "audit")).toHaveLength(1);
    expect(eventsOf(project, "finish")).toEqual([]);
    expect(notify).toHaveBeenCalledTimes(shown);
    expect(host.toModel).toHaveLength(1 + inputs.length);
  });

  it("registers no handler at all when the project has no hooks file", async () => {
    const project = selecting();
    rmSync(join(project.root, HOOKS_FILE_RELATIVE));
    const host = fakeHost(project);

    expect(registerLifecycleHooks(host.pi, project.root, { storePath: project.storePath })).toBeUndefined();

    expect(host.inputHandlerCount()).toBe(0);
    expect(host.otherEvents).toEqual([]);
    const { ctx } = fakeCtx(project);
    expect(await host.deliver("/ensemble-create-prd foo", ctx)).toBe("continue");
    expect(stderrText).toEqual([]);
  });
});

// ---- A newer command supersedes the run in flight (AC-001-3, AC-021-5) ----

describe("a newer selected command", () => {
  const twoCommands = () =>
    makeProject(
      hooksFile(
        { "a-start": recorder("a-start"), "a-end": recorder("a-end"), "b-start": recorder("b-start"), "b-end": recorder("b-end") },
        { [CREATE_PRD]: { start: ["a-start"], end: ["a-end"] }, [REFINE_PRD]: { start: ["b-start"], end: ["b-end"] } },
      ),
    );

  it("ends the run in flight as cancelled, naming the missing completion signal, before its own start handlers run", async () => {
    const project = twoCommands();
    trust(project);
    const host = hostFor(project);
    const { ctx } = fakeCtx(project);
    await host.deliver("/ensemble-create-prd one", ctx);

    expect(await host.deliver("/ensemble-refine-prd two", ctx)).toBe("continue");

    const [a] = eventsOf(project, "a-start");
    const [b] = eventsOf(project, "b-start");
    const aEnds = eventsOf(project, "a-end");
    expect(aEnds).toHaveLength(1);
    expect(aEnds[0]).toMatchObject({ event: "command.end", run_id: a.run_id, outcome: "cancelled" });
    expect(aEnds[0].reason).toMatch(/no completion signal/i);
    expect(b.run_id).not.toBe(a.run_id);
    expect(traceOf(project)).toEqual([
      `a-start begin ${a.run_id}`,
      "a-start end",
      "model-prompt /ensemble-create-prd one",
      `a-end begin ${a.run_id}`,
      "a-end end",
      `b-start begin ${b.run_id}`,
      "b-start end",
      "model-prompt /ensemble-refine-prd two",
    ]);
    expect(eventsOf(project, "b-end")).toEqual([]);
  });

  it("gives two invocations of the same command their own run ids, each with one start and one end (AC-001-3)", async () => {
    const project = twoCommands();
    trust(project);
    const host = hostFor(project);
    const { ctx } = fakeCtx(project);
    await host.deliver("/ensemble-create-prd one", ctx);
    await host.deliver("/ensemble-create-prd two", ctx);
    await complete(host.runtime, ctx, { outcome: "succeeded", summary: "done" });

    const starts = eventsOf(project, "a-start");
    const ends = eventsOf(project, "a-end");
    expect(starts).toHaveLength(2);
    expect(ends).toHaveLength(2);
    const outcomeOf = (runId: string) => ends.filter((e) => e.run_id === runId).map((e) => e.outcome);
    const first = starts.find((s) => s.arguments === "one");
    const second = starts.find((s) => s.arguments === "two");
    expect(first?.run_id).not.toBe(second?.run_id);
    expect(outcomeOf(first?.run_id ?? "")).toEqual(["cancelled"]);
    expect(outcomeOf(second?.run_id ?? "")).toEqual(["succeeded"]);
  });

  it("holds a newer command until the run in flight has finished its start handlers, so a late block cannot end the newer run", async () => {
    const project = makeProject(
      hooksFile(
        {
          slowgate: recorder("slowgate", { waitFor: "release-a", code: 3, on_error: "block" }),
          "a-end": recorder("a-end"),
          "b-start": recorder("b-start"),
          "b-end": recorder("b-end"),
        },
        { [CREATE_PRD]: { start: ["slowgate"], end: ["a-end"] }, [REFINE_PRD]: { start: ["b-start"], end: ["b-end"] } },
      ),
    );
    trust(project);
    const host = hostFor(project);
    const { ctx } = fakeCtx(project);

    const first = host.deliver("/ensemble-create-prd one", ctx); // its start handler blocks, once released
    await until(() => traceOf(project).some((line) => line.startsWith("slowgate begin")), "the slow start handler to begin");
    const second = host.deliver("/ensemble-refine-prd two", ctx); // sent while the first is still starting
    await delay(150); // long enough for a handler to have begun, had the runtime let it
    expect(eventsOf(project, "b-start")).toEqual([]);
    expect(eventsOf(project, "a-end")).toEqual([]);

    release(project, "release-a");
    trust(project); // the release file is an argument of the handler, so it is now part of what the user trusts
    expect(await first).toBe("handled"); // the block is enforced
    expect(await second).toBe("continue");

    const [a] = eventsOf(project, "slowgate");
    const [b] = eventsOf(project, "b-start");
    expect(host.runtime.trackerFor(ctx).current()).toMatchObject({ run_id: b.run_id, command: REFINE_PRD });
    expect(eventsOf(project, "b-end")).toEqual([]);
    const aEnds = eventsOf(project, "a-end");
    expect(aEnds).toHaveLength(1);
    expect(aEnds[0]).toMatchObject({ run_id: a.run_id, outcome: "failed" }); // the block ended it; nothing superseded it
    expect(traceOf(project)).toEqual([
      `slowgate begin ${a.run_id}`,
      "slowgate end",
      `a-end begin ${a.run_id}`,
      "a-end end",
      `b-start begin ${b.run_id}`,
      "b-start end",
      "model-prompt /ensemble-refine-prd two",
    ]);
    expect(host.toModel).toEqual(["/ensemble-refine-prd two"]);
  });
});

// ---- Both trust conditions gate the start path (AC-022-1 .. AC-022-6) -----

describe("the trust gate", () => {
  /** What no handler running looks like: no event file, and only the host's own line in the trace. */
  function expectNothingRan(project: Project, host: FakeHost): void {
    expect(eventsOf(project, "audit")).toEqual([]);
    expect(traceOf(project).filter((line) => !line.startsWith("model-prompt"))).toEqual([]);
    expect(host.toModel).toEqual(["/ensemble-create-prd foo"]);
  }

  it("runs no handler when the host does not trust the project, and warns", async () => {
    const project = auditOnCreate();
    trust(project);
    const host = hostFor(project);
    const { ctx, texts } = fakeCtx(project, { hostTrust: false });

    expect(await host.deliver("/ensemble-create-prd foo", ctx)).toBe("continue");

    expectNothingRan(project, host);
    expect(texts()).toHaveLength(1);
    expect(texts()[0]).toContain(HOOKS_FILE_RELATIVE);
    expect(texts()[0]).toContain("does not trust this project");
  });

  it("runs no handler when the host gives no trust decision, and says why", async () => {
    const project = auditOnCreate();
    trust(project);
    const host = hostFor(project);
    const { ctx, texts } = fakeCtx(project, { hostTrust: "none" });

    await host.deliver("/ensemble-create-prd foo", ctx);

    expectNothingRan(project, host);
    expect(texts()[0]).toContain("no project-trust decision");
  });

  it("runs no handler until the user has trusted the hooks, and names the trust command", async () => {
    const project = auditOnCreate();
    const host = hostFor(project);
    const { ctx, texts } = fakeCtx(project);

    expect(await host.deliver("/ensemble-create-prd foo", ctx)).toBe("continue");

    expectNothingRan(project, host);
    expect(texts()).toHaveLength(1);
    expect(texts()[0]).toContain("/ensemble-lifecycle-trust");
  });

  it("runs no handler once the hooks file has been edited since the user trusted it", async () => {
    const project = auditOnCreate();
    trust(project);
    const host = hostFor(project);
    const { ctx, texts } = fakeCtx(project);
    await host.deliver("/ensemble-create-prd first", ctx);
    expect(eventsOf(project, "audit")).toHaveLength(1);

    editHooksFile(project);
    await host.deliver("/ensemble-create-prd second", ctx);

    expect(eventsOf(project, "audit")).toHaveLength(1);
    expect(texts().at(-1)).toContain("/ensemble-lifecycle-trust");
  });

  it("runs no handler once a handler file the hooks file names has changed", async () => {
    const project = auditOnCreate();
    trust(project);
    const host = hostFor(project);
    const { ctx } = fakeCtx(project);

    writeFileSync(join(project.root, "scripts/record.sh"), `${RECORD_SCRIPT}# edited\n`);
    await host.deliver("/ensemble-create-prd foo", ctx);

    expectNothingRan(project, host);
  });

  it("starts no run, and ends none, for a selected command the gate refuses", async () => {
    const project = makeProject(
      hooksFile(
        { audit: recorder("audit"), finish: recorder("finish") },
        { [CREATE_PRD]: { start: ["audit"], end: ["finish"] }, [REFINE_PRD]: { start: ["audit"] } },
      ),
    );
    trust(project);
    const host = hostFor(project);
    const { ctx } = fakeCtx(project);
    await host.deliver("/ensemble-create-prd one", ctx);
    const before = host.runtime.trackerFor(ctx).current();

    editHooksFile(project);
    expect(await host.deliver("/ensemble-refine-prd two", ctx)).toBe("continue");

    expect(host.runtime.trackerFor(ctx).current()).toEqual(before);
    expect(eventsOf(project, "finish")).toEqual([]);
    expect(eventsOf(project, "audit")).toHaveLength(1);
  });

  it("checks the gate again when a run ends, so a hooks file edited mid-run runs no end handler", async () => {
    const project = makeProject(
      hooksFile({ audit: recorder("audit"), finish: recorder("finish") }, { [CREATE_PRD]: { start: ["audit"], end: ["finish"] } }),
    );
    trust(project);
    const host = hostFor(project);
    const { ctx, texts } = fakeCtx(project);
    await host.deliver("/ensemble-create-prd foo", ctx);

    editHooksFile(project);
    await complete(host.runtime, ctx, { outcome: "succeeded" });

    expect(eventsOf(project, "finish")).toEqual([]);
    expect(texts().at(-1)).toContain("/ensemble-lifecycle-trust");
  });
});

// ---- Dispatchers: one lifecycle, for the target (AC-003-1, AC-003-2, AC-015-3) ----

describe("a dispatcher invocation", () => {
  it("starts one run for the target when the typed text reaches input (no dispatcher command registered)", async () => {
    const project = auditOnCreate();
    trust(project);
    const host = hostFor(project);
    const { ctx } = fakeCtx(project);

    await host.deliver("/ensemble-prd create foo", ctx);

    expect(eventsOf(project, "audit").map((e) => [e.command, e.arguments])).toEqual([[CREATE_PRD, "foo"]]);
  });

  it("selects no handler for a hook configured on the dispatcher only", async () => {
    const project = makeProject(hooksFile({ audit: recorder("audit") }, { [PRD_DISPATCHER]: { start: ["audit"] } }));
    trust(project);
    const host = hostFor(project);
    const { ctx, notify } = fakeCtx(project);

    expect(await host.deliver("/ensemble-prd create foo", ctx)).toBe("continue");

    expect(eventsOf(project, "audit")).toEqual([]);
    expect(notify).not.toHaveBeenCalled();
    expect(host.runtime.trackerFor(ctx).current()).toBeUndefined();
  });

  it("starts exactly one run, for the target, in this repository's layout, where the dispatcher is an extension command", async () => {
    const project = auditOnCreate();
    mkdirSync(join(project.root, "packages/product/commands"), { recursive: true });
    copyFileSync(join(REPO_ROOT, "packages/product/commands/prd.yaml"), join(project.root, "packages/product/commands/prd.yaml"));
    const defaultStore = defaultTrustStorePath();
    expect(defaultStore.startsWith(tempHome)).toBe(true); // never trust a project in the real home
    trust(project, defaultStore);
    process.chdir(project.root);
    const host = fakeHost(project);
    const { ctx } = fakeCtx(project);

    activate(host.pi);
    await host.deliver("/ensemble-prd create foo", ctx);
    await host.settle();

    // Pi runs the dispatcher command for the typed text and fires `input` only for the text it forwards.
    expect(host.inputTexts).toEqual(["/ensemble:prd create foo"]);
    const starts = eventsOf(project, "audit");
    expect(starts.map((e) => [e.command, e.arguments])).toEqual([[CREATE_PRD, "foo"]]);
    expect(traceOf(project).filter((line) => line.startsWith("audit begin"))).toHaveLength(1);
    expect(host.hostErrors).toEqual([]);
  });
});

// ---- session_id (TRD-010: the host's id, or one generated per process) ----

describe("the session id in the payload", () => {
  /** Two commands in a row, so the second run is begun by a runtime that has already made its tracker. */
  async function twoRuns(project: Project, ctx: ExtensionContext, host: RegisteredHost): Promise<LifecycleEvent[]> {
    await host.deliver("/ensemble-create-prd one", ctx);
    await host.deliver("/ensemble-create-prd two", ctx);
    return eventsOf(project, "audit");
  }

  it("is the host session's id, for every run of the session", async () => {
    const project = auditOnCreate();
    trust(project);
    const host = hostFor(project);
    const { ctx } = fakeCtx(project, { sessionManager: { getSessionId: () => "01a1-host-session" } });

    const starts = await twoRuns(project, ctx, host);

    expect(starts.map((s) => s.session_id)).toEqual(["01a1-host-session", "01a1-host-session"]);
  });

  it.each([
    ["has no session manager", undefined],
    ["reports an empty id", { getSessionId: () => "" }],
    ["reports an id that is not text", { getSessionId: () => 42 }],
  ])("is one generated id per process when the host %s", async (_label, sessionManager) => {
    const project = auditOnCreate();
    trust(project);
    const host = hostFor(project);
    const { ctx } = fakeCtx(project, { sessionManager });

    const starts = await twoRuns(project, ctx, host);

    const [first, second] = starts.map((s) => s.session_id);
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(second).toBe(first);
    expect(first).not.toBe("host-session-1");

    // A second session of the same process has the same generated id: it identifies the process.
    const otherProject = auditOnCreate();
    trust(otherProject);
    const otherHost = hostFor(otherProject);
    await otherHost.deliver("/ensemble-create-prd foo", fakeCtx(otherProject, { sessionManager }).ctx);
    expect(eventsOf(otherProject, "audit").map((s) => s.session_id)).toEqual([first]);
  });
});

// ---- What the user is shown (AC-009-4, AC-013-1, AC-013-2) ----------------

describe("what the user is shown for each handler", () => {
  it("shows a succeeded handler's status and duration", async () => {
    const project = auditOnCreate();
    trust(project);
    const host = hostFor(project);
    const { ctx, notify } = fakeCtx(project);

    await host.deliver("/ensemble-create-prd foo", ctx);

    expect(notify).toHaveBeenCalledTimes(1);
    const [message, level] = notify.mock.calls[0];
    expect(level).toBe("info");
    expect(message).toContain("ensemble:create-prd (command.start)");
    expect(message).toMatch(/audit: succeeded in \d+ ms$/m);
  });

  it("shows that a handler's output was truncated, as a warning", async () => {
    const project = makeProject(hooksFile({ noisy: script("noisy.sh") }, { [CREATE_PRD]: { start: ["noisy"] } }));
    trust(project);
    const host = hostFor(project);
    const { ctx, notify } = fakeCtx(project);

    expect(await host.deliver("/ensemble-create-prd foo", ctx)).toBe("continue");

    const [message, level] = notify.mock.calls[0];
    expect(message).toMatch(/noisy: succeeded in \d+ ms, output truncated at 64 KiB/);
    expect(level).toBe("warning");
  });

  it("shows a handler that failed under continue as a handler failure, not a command failure", async () => {
    const project = makeProject(hooksFile({ flaky: recorder("flaky", { code: 1 }) }, { [CREATE_PRD]: { start: ["flaky"] } }));
    trust(project);
    const host = hostFor(project);
    const { ctx, notify } = fakeCtx(project);

    expect(await host.deliver("/ensemble-create-prd foo", ctx)).toBe("continue");

    const [message, level] = notify.mock.calls[0];
    expect(message).toMatch(/flaky: failed in \d+ ms: exited with code 1/);
    expect(message).toContain("the handler failed; the command did not");
    expect(level).toBe("warning");
    expect(host.toModel).toEqual(["/ensemble-create-prd foo"]);
  });

  it("shows a handler that timed out, and goes on", async () => {
    // The handler waits for a file that is never written; its own 150 ms timeout is the clock under test.
    const project = makeProject(
      hooksFile({ slow: recorder("slow", { waitFor: "never", timeout_ms: 150 }) }, { [CREATE_PRD]: { start: ["slow"] } }),
    );
    trust(project);
    const host = hostFor(project);
    const { ctx, texts } = fakeCtx(project);

    expect(await host.deliver("/ensemble-create-prd foo", ctx)).toBe("continue");

    expect(texts()[0]).toMatch(/slow: timed out in \d+ ms/);
  });

  it("writes the report to stderr when the host has no UI", async () => {
    const project = auditOnCreate();
    trust(project);
    const host = hostFor(project);
    const { ctx, notify } = fakeCtx(project, { hasUI: false });

    await host.deliver("/ensemble-create-prd foo", ctx);

    expect(notify).not.toHaveBeenCalled();
    expect(stderrText.join("")).toMatch(/audit: succeeded in \d+ ms/);
  });

  it("shows what a failing handler printed with every escape sequence made harmless", async () => {
    const project = makeProject(hooksFile({ evil: script("escape.sh") }, { [CREATE_PRD]: { start: ["evil"] } }));
    trust(project);
    const host = hostFor(project);
    const { ctx, texts } = fakeCtx(project);

    await host.deliver("/ensemble-create-prd foo", ctx);

    expect(texts()[0]).not.toContain("\u001b");
    expect(texts()[0]).toContain("\\u{1b}[2Jevil");
  });
});

// ---- The seam the completion tool and the end path build on ---------------

describe("the runtime shared with the completion tool and the end path", () => {
  const withEnd = () =>
    makeProject(hooksFile({ audit: recorder("audit"), finish: recorder("finish") }, { [CREATE_PRD]: { start: ["audit"], end: ["finish"] } }));

  /** The commands the host reports, until `breakHost()` makes the call throw as Pi does before its runtime is bound. */
  function breakableCommands() {
    let broken = false;
    return {
      breakHost: () => {
        broken = true;
      },
      getCommands: () => {
        if (broken) throw new Error("the runtime is gone");
        return HOST_COMMANDS;
      },
    };
  }

  it("returns the same tracker on every call, and it holds the run the start path began", async () => {
    const project = withEnd();
    trust(project);
    const host = hostFor(project);
    const { ctx } = fakeCtx(project);

    await host.deliver("/ensemble-create-prd foo", ctx);

    const tracker = host.runtime.trackerFor(ctx);
    expect(host.runtime.trackerFor(ctx)).toBe(tracker);
    expect(host.runtime.trackerFor(fakeCtx(project).ctx)).toBe(tracker);
    const [start] = eventsOf(project, "audit");
    expect(tracker.current()?.run_id).toBe(start.run_id);
  });

  it("does not end a run twice: the next command leaves a completed run alone", async () => {
    const project = withEnd();
    trust(project);
    const host = hostFor(project);
    const { ctx } = fakeCtx(project);
    await host.deliver("/ensemble-create-prd one", ctx);
    await complete(host.runtime, ctx, { outcome: "succeeded" });

    await host.deliver("/ensemble-create-prd two", ctx);

    expect(eventsOf(project, "finish").map((e) => e.outcome)).toEqual(["succeeded"]);
    expect(eventsOf(project, "audit")).toHaveLength(2);
  });

  it("never throws from endRun: a host call that fails is shown to the user", async () => {
    const project = withEnd();
    trust(project);
    const commands = breakableCommands();
    const host = hostFor(project, {}, { getCommands: commands.getCommands });
    const { ctx, texts } = fakeCtx(project);
    await host.deliver("/ensemble-create-prd foo", ctx);
    commands.breakHost();
    const end = host.runtime.trackerFor(ctx).complete({ outcome: "succeeded" });
    if (!end) throw new Error("no run was in flight");

    await expect(host.runtime.endRun(ctx, end)).resolves.toBeUndefined();

    expect(texts().at(-1)).toContain("ensemble:create-prd (command.end) did not run: the runtime is gone");
    expect(eventsOf(project, "finish")).toEqual([]);
  });

  it("lets the input continue, with no handler started and no run begun, when the gate itself fails", async () => {
    const project = withEnd();
    trust(project);
    const commands = breakableCommands();
    const host = hostFor(project, {}, { getCommands: commands.getCommands });
    const { ctx } = fakeCtx(project);
    commands.breakHost();

    expect(await host.deliver("/ensemble-create-prd foo", ctx)).toBe("continue");

    expect(host.hostErrors).toEqual(["Error: the runtime is gone"]);
    expect(eventsOf(project, "audit")).toEqual([]);
    expect(host.runtime.trackerFor(ctx).current()).toBeUndefined();
  });
});
