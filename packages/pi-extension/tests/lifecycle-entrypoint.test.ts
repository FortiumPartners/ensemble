import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { builtinModules } from "node:module";
import os from "node:os";
import { dirname, join, resolve } from "node:path";
import { setImmediate as nextTurn, setTimeout as delay } from "node:timers/promises";
import * as yaml from "js-yaml";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { HARNESS_CAPABILITIES, HOOKS_FILE_RELATIVE, defaultTrustStorePath, isRecord } from "@sunstone-partners/ensemble-agent-core";
import type { LifecycleEvent } from "@sunstone-partners/ensemble-agent-core";
import activate from "../src/extension";

/**
 * TRD-015: the entry-point proof (REQ-015, REQ-019; AC-015-1 .. AC-015-4, AC-019-3).
 *
 * Every assertion about behavior enters through `activate(fakePi)` from `src/extension.ts`, the function Pi calls
 * when it loads the extension, and then through what Pi would deliver afterwards: the user's input, the model's
 * tool call, the loop's settle and the session's end. This file imports no adapter, runtime or resolver, and builds
 * no trust record around the extension: trust is granted by running the registered `/ensemble-lifecycle-trust`
 * command against a UI that confirms, which writes the real store. The store is the temporary home's, because
 * `os.homedir()` is replaced where `activate()` reads it (assigning HOME would not reach it under jest).
 *
 * Everything but the host is real: a temporary repository with a real `.ensemble/hooks.yaml`, real executables as
 * handlers, real processes and real timeouts. Handlers append to one `trace.log` and the fake host appends the
 * model's side to the same file (`model-prompt`, `workflow ...`, `tool ...`, `model-output`), so "before", "after",
 * "once" and "never" are read from the sequence of lines, never from timestamps and never from a mock. The one
 * bounded wait (after the completion call) only looks for something that must not happen, so it can miss a
 * violation but never invent one. Where a handler must still be running at some moment it waits for a file the
 * test writes, so the test, not a guess at how long a process takes, decides the order. The hold is a directory,
 * not a file, because an argument that names an existing file is part of what the user trusts (the trust digest)
 * and creating it later would void the trust under test.
 *
 * The fake host copies what Pi 1.2.0 was measured to do (the header of src/lifecycle/adapter.ts lists it):
 *   - `getCommands()` throws until Pi has bound its runtime, which is after `activate()` returns, so a test fails
 *     if activation asks for the command list; the fake counts the calls.
 *   - `{ action: "handled" }` from an `input` handler stops the prompt: no model call, no `before_agent_start`. A
 *     handler that throws does not stop it: the input continues and the error is kept in `hostErrors`.
 *   - `input` does not fire for the text of a registered extension command. The dispatcher commands are extension
 *     commands when the repository holds their YAML; their handler forwards `/ensemble:<dispatcher> <args>` with
 *     `sendUserMessage(text, { expandPromptTemplates: true })`, and `input` fires once for that text with source
 *     `extension`.
 *   - A loop that completes fires `agent_before_settle` (outcome `completed`), then `agent_settled` with
 *     `aborted: false`; one that fails fires `agent_before_settle` with outcome `error`; an abort fires only
 *     `agent_settled` with `aborted: true`.
 *
 * The last block builds the extension bundle exactly as `scripts/install.mjs` does and loads it in a separate Node
 * process, because jest's own `require` would rewrite `@sunstone-partners/ensemble-agent-core` to this checkout and
 * hide a bundle that did not take agent-core in. It needs `bun` and is skipped, loudly, when `bun` is not on PATH.
 */

const PACKAGE_ROOT = resolve(__dirname, "..");
const REPO_ROOT = resolve(PACKAGE_ROOT, "../..");
const INSTALL_SCRIPT = join(PACKAGE_ROOT, "scripts", "install.mjs");
/** The dispatcher YAML whose presence makes `activate()` register `/ensemble-prd` as an extension command. */
const PRD_DISPATCHER_YAML = join("packages", "product", "commands", "prd.yaml");

const CREATE_PRD = "ensemble:create-prd";
const PRD_DISPATCHER = "ensemble:prd";

/** The prompt templates Pi reports with the Ensemble package installed: every command the hooks files below select exists. */
const PROMPT_TEMPLATES = ["ensemble-create-prd", "ensemble-refine-prd", "ensemble-prd"];

const TRUST_COMMAND = "ensemble-lifecycle-trust";
const COMPLETION_TOOL = "ensemble_command_complete";
const NOT_BOUND = "Extension runtime not initialized. Action methods cannot be called during extension loading.";

/**
 * record.sh <tag> <hold> <exit code>: notes that it began, keeps the event it was given, waits for
 * `<hold>/open` under the project root unless <hold> is `-`, notes that it ended, and exits.
 */
const RECORD_SCRIPT = String.raw`#!/bin/sh
tag="$1"; hold="$2"; code="$3"
printf '%s begin %s\n' "$tag" "$ENSEMBLE_RUN_ID" >> "$ENSEMBLE_PROJECT_ROOT/trace.log"
cat > "$ENSEMBLE_PROJECT_ROOT/events/$tag.$ENSEMBLE_RUN_ID.json"
if [ "$hold" != "-" ]; then
  until [ -e "$ENSEMBLE_PROJECT_ROOT/$hold/open" ]; do sleep 0.02; done
fi
printf '%s end\n' "$tag" >> "$ENSEMBLE_PROJECT_ROOT/trace.log"
exit "$code"
`;

/** slow.sh <tag>: notes that it began and which process it is, then outlasts any timeout the tests give it. */
const SLOW_SCRIPT = String.raw`#!/bin/sh
printf '%s begin %s\n' "$1" "$ENSEMBLE_RUN_ID" >> "$ENSEMBLE_PROJECT_ROOT/trace.log"
printf '%s' "$$" > "$ENSEMBLE_PROJECT_ROOT/slow.pid"
sleep 30
printf '%s end\n' "$1" >> "$ENSEMBLE_PROJECT_ROOT/trace.log"
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
  tempHome = tempDir("lifecycle-entry-home-");
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

interface HooksSpec {
  hooks: Record<string, unknown>;
  commands: Record<string, Selection>;
}

interface ProjectSpec {
  /** The project's hooks file. Absent means the project has none. */
  hooks?: HooksSpec;
  /** The repository holds the dispatcher's own YAML, as the Ensemble repository does. */
  dispatcherYaml?: boolean;
}

interface Project {
  root: string;
  trace: string;
}

/** A repository anchored by `.git`, with its handler scripts and, when asked, a real YAML hooks file. */
function makeProject(spec: ProjectSpec = {}): Project {
  const root = tempDir("lifecycle-entry-project-");
  for (const dir of [".git", ".ensemble", "scripts", "events", "holds", "sub"]) mkdirSync(join(root, dir));
  for (const [file, body] of [
    ["record.sh", RECORD_SCRIPT],
    ["slow.sh", SLOW_SCRIPT],
  ]) {
    writeFileSync(join(root, "scripts", file), body);
    chmodSync(join(root, "scripts", file), 0o755);
  }
  if (spec.hooks) writeFileSync(join(root, HOOKS_FILE_RELATIVE), yaml.dump({ version: 1, ...spec.hooks }, { lineWidth: -1 }));
  if (spec.dispatcherYaml) {
    mkdirSync(join(root, dirname(PRD_DISPATCHER_YAML)), { recursive: true });
    copyFileSync(join(REPO_ROOT, PRD_DISPATCHER_YAML), join(root, PRD_DISPATCHER_YAML));
  }
  return { root, trace: join(root, "trace.log") };
}

/** A project whose command `ensemble:create-prd` starts with `audit` and ends with `finish`. */
function auditAndFinish(): Project {
  return makeProject({
    hooks: {
      hooks: { audit: recorder("audit"), finish: recorder("finish") },
      commands: { [CREATE_PRD]: { start: ["audit"], end: ["finish"] } },
    },
  });
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

/** The lines the host wrote: the model's side of the trace. Every other line is a handler's. */
const HOST_LINE = /^(model-prompt|workflow|tool|model-output)( |$)/;
const handlerLines = (project: Project): string[] => traceOf(project).filter((line) => !HOST_LINE.test(line));

/** The events the handler tagged `tag` was given, one per run. */
function eventsOf(project: Project, tag: string): LifecycleEvent[] {
  return readdirSync(join(project.root, "events"))
    .filter((file) => file.startsWith(`${tag}.`))
    .map((file) => JSON.parse(readFileSync(join(project.root, "events", file), "utf8")) as LifecycleEvent);
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

// ---- The fake Pi ----------------------------------------------------------

type Handler = (event: Record<string, unknown>, ctx: ExtensionContext) => unknown;
type Verdict = "handled" | "continue";
type Settle = "completed" | "error" | "aborted";

interface RegisteredCommand {
  handler: (args: string, ctx: ExtensionContext) => Promise<void> | void;
}

interface RegisteredTool {
  name: string;
  execute: (
    toolCallId: string,
    params: Record<string, unknown>,
    signal: undefined,
    onUpdate: undefined,
    ctx: ExtensionContext,
  ) => Promise<{ content: { type: string; text: string }[]; details: { recorded: boolean } }>;
}

/**
 * The host Pi would be, as far as the extension can tell. It implements the five members of `ExtensionAPI` the
 * extension uses and nothing else, so an activation that reached for another one would throw.
 */
class FakePi {
  readonly pi: ExtensionAPI;
  readonly ctx: ExtensionContext;
  readonly commands = new Map<string, RegisteredCommand>();
  readonly tools = new Map<string, RegisteredTool>();
  readonly handlers = new Map<string, Handler[]>();
  /** What `input` handlers were asked about, in order. */
  readonly inputs: { text: string; source: string }[] = [];
  /** The prompts that reached the model. */
  readonly toModel: string[] = [];
  /** The system prompt each model call was made with. */
  readonly systemPrompts: string[] = [];
  /** What a throwing handler left for Pi to print. */
  readonly hostErrors: string[] = [];
  /** Everything the user was shown through the UI. */
  readonly notices: { message: string; level: string }[] = [];
  /** Every confirmation the user was asked. */
  readonly confirms: { title: string; message: string }[] = [];
  /** How often the extension asked for the host's command list, before and after Pi bound its runtime. */
  getCommandsCalls = 0;
  /** What `isProjectTrusted()` answers. Pi answers true by default. */
  hostTrusted = true;
  /** What the user answers when asked to confirm. */
  confirmAnswer = true;
  private bound = false;
  private readonly forwarded: Promise<Verdict>[] = [];

  constructor(private readonly project: Project) {
    this.ctx = {
      cwd: join(project.root, "sub"),
      hasUI: true,
      ui: {
        notify: (message: string, level?: string) => {
          this.notices.push({ message, level: level ?? "info" });
        },
        confirm: async (title: string, message: string) => {
          this.confirms.push({ title, message });
          return this.confirmAnswer;
        },
      },
      isProjectTrusted: () => this.hostTrusted,
      sessionManager: { getSessionId: () => "host-session-1" },
      hasPendingMessages: () => false,
    } as unknown as ExtensionContext;

    this.pi = {
      on: (event: string, handler: Handler) => {
        this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]);
        return () => undefined;
      },
      registerTool: (tool: RegisteredTool) => {
        this.tools.set(tool.name, tool);
      },
      registerCommand: (name: string, command: RegisteredCommand) => {
        this.commands.set(name, command);
      },
      getCommands: () => {
        this.getCommandsCalls++;
        if (!this.bound) throw new Error(NOT_BOUND);
        return [
          ...PROMPT_TEMPLATES.map((name) => ({ name, source: "prompt" })),
          ...[...this.commands.keys()].map((name) => ({ name, source: "extension" })),
        ];
      },
      sendUserMessage: (text: string, options?: { expandPromptTemplates?: boolean }) => {
        this.forwarded.push(this.prompt(text, "extension", options?.expandPromptTemplates === true));
      },
    } as unknown as ExtensionAPI;
  }

  /** Pi binds its runtime once every extension has loaded. */
  bind(): void {
    this.bound = true;
  }

  /** What `activate()` registered with the host. */
  get registered() {
    return { commands: [...this.commands.keys()].sort(), tools: [...this.tools.keys()].sort(), events: [...this.handlers.keys()].sort() };
  }

  /** Every message the user was shown. */
  texts(): string[] {
    return this.notices.map((notice) => notice.message);
  }

  /** Runs every handler for `type`, in order, each awaited. A handler that throws does not stop the rest, as in Pi. */
  private async emit(type: string, event: Record<string, unknown>): Promise<unknown[]> {
    const results: unknown[] = [];
    for (const handler of this.handlers.get(type) ?? []) {
      try {
        results.push(await handler({ type, ...event }, this.ctx));
      } catch (error) {
        this.hostErrors.push(String(error));
      }
    }
    return results;
  }

  /** `AgentSession.prompt`: an extension command runs and fires no `input`; otherwise `input` handlers decide. */
  private async prompt(text: string, source: "interactive" | "extension", expandPromptTemplates: boolean): Promise<Verdict> {
    if (expandPromptTemplates && text.startsWith("/")) {
      const space = text.indexOf(" ");
      const command = this.commands.get(space === -1 ? text.slice(1) : text.slice(1, space));
      if (command) {
        await command.handler(space === -1 ? "" : text.slice(space + 1), this.ctx);
        return "handled";
      }
    }
    this.inputs.push({ text, source });
    const results = await this.emit("input", { text, source });
    if (results.some((result) => isRecord(result) && result.action === "handled")) return "handled";

    appendFileSync(this.project.trace, `model-prompt ${text}\n`);
    this.toModel.push(text);
    const base = "base system prompt";
    const started = await this.emit("before_agent_start", { prompt: text, systemPrompt: base, systemPromptOptions: {} });
    const changed = started.find((result): result is { systemPrompt: string } => isRecord(result) && typeof result.systemPrompt === "string");
    this.systemPrompts.push(changed?.systemPrompt ?? base);
    return "continue";
  }

  /**
   * The user submits `text`. The verdict is the one for the prompt that reached `input`: for a slash command that
   * Pi runs itself (the trust command) it is `handled`, and for a dispatcher it is the verdict for the text the
   * dispatcher forwarded.
   */
  async submit(text: string): Promise<Verdict> {
    const verdict = await this.prompt(text, "interactive", true);
    const forwarded = await Promise.all(this.forwarded.splice(0));
    return forwarded.at(-1) ?? verdict;
  }

  /** The model works through the command's steps. */
  workflow(...steps: string[]): void {
    for (const step of steps) appendFileSync(this.project.trace, `workflow ${step}\n`);
  }

  /** The model calls the completion tool, as Pi does for it; the acknowledgement it gets back. */
  async complete(params: Record<string, unknown>): Promise<{ text: string; recorded: boolean }> {
    const tool = this.tools.get(COMPLETION_TOOL);
    if (!tool) throw new Error("the completion tool is not registered");
    appendFileSync(this.project.trace, `tool ${COMPLETION_TOOL}\n`);
    const result = await tool.execute("call-1", params, undefined, undefined, this.ctx);
    return { text: result.content[0].text, recorded: result.details.recorded };
  }

  /** The loop settles the way Pi 1.2.0 was measured to. The command's final output comes first. */
  async settle(how: Settle): Promise<void> {
    appendFileSync(this.project.trace, "model-output\n");
    if (how !== "aborted") await this.emit("agent_before_settle", { outcome: how, entries: [], continue: false });
    await this.emit("agent_settled", { aborted: how === "aborted" });
  }

  async shutdown(reason = "quit"): Promise<void> {
    await this.emit("session_shutdown", { reason });
  }
}

/**
 * Pi loads the extension: it calls `activate(pi)` in a session whose working directory is a subdirectory of the
 * repository, and only then binds its runtime. Activation must not have asked for the command list by then.
 */
function loadExtension(project: Project): FakePi {
  process.chdir(join(project.root, "sub"));
  const host = new FakePi(project);
  activate(host.pi);
  expect(host.getCommandsCalls).toBe(0);
  host.bind();
  return host;
}

/** The user runs `/ensemble-lifecycle-trust` and confirms: the registered command, the real store of the temporary home. */
async function trustHooks(host: FakePi): Promise<void> {
  host.confirmAnswer = true;
  expect(await host.submit(`/${TRUST_COMMAND}`)).toBe("handled");
  expect(existsSync(defaultTrustStorePath())).toBe(true);
}

/** The model does the command's work and completes it, and the loop settles. */
async function finishWork(host: FakePi): Promise<void> {
  host.workflow("do the work");
  await host.complete({ outcome: "succeeded" });
  await host.settle("completed");
}

/** Nothing the host would have printed as an error or the extension written to stderr. */
function expectQuiet(host: FakePi): void {
  expect(host.hostErrors).toEqual([]);
  expect(stderrText).toEqual([]);
}

// ---- Registration: what activate() does with and without a hooks file -----

describe("what activate() registers (AC-008-1, REQ-008)", () => {
  it("registers nothing, asks the host for nothing and writes nothing when the project has no hooks file", () => {
    const project = makeProject();
    const before = [readdirSync(project.root).sort(), readdirSync(join(project.root, ".ensemble"))];

    const host = loadExtension(project);

    expect(host.registered).toEqual({ commands: [], tools: [], events: [] });
    expect([readdirSync(project.root).sort(), readdirSync(join(project.root, ".ensemble"))]).toEqual(before);
    expect(existsSync(join(tempHome, ".ensemble"))).toBe(false); // not even the trust store's directory
    expectQuiet(host);
  });

  it("registers only the dispatcher when the repository holds its YAML but there is no hooks file", () => {
    const host = loadExtension(makeProject({ dispatcherYaml: true }));

    expect(host.registered).toEqual({ commands: ["ensemble-prd"], tools: [], events: [] });
    expectQuiet(host);
  });

  it("registers the trust command, the completion tool and a handler for each event of the lifecycle when a hooks file exists", () => {
    const host = loadExtension(auditAndFinish());

    expect(host.registered).toEqual({
      commands: [TRUST_COMMAND],
      tools: [COMPLETION_TOOL],
      events: ["agent_before_settle", "agent_settled", "before_agent_start", "input", "session_shutdown"],
    });
    expectQuiet(host);
  });

  it("finds the hooks file from a subdirectory of the repository and runs nothing at load", () => {
    const project = auditAndFinish();

    const host = loadExtension(project); // the session's working directory is `sub/`

    expect(process.cwd()).toBe(realpathSync(join(project.root, "sub")));
    expect(host.registered.commands).toEqual([TRUST_COMMAND]);
    expect(traceOf(project)).toEqual([]);
    expect(host.texts()).toEqual([]);
  });
});

// ---- The two-condition trust gate (REQ-022), entered through activate() ----

describe("untrusted hooks run nothing (REQ-022)", () => {
  interface Untrusted {
    name: string;
    /** Brings the project to the state under test. */
    arrange: (host: FakePi, project: Project) => Promise<void>;
    /** What the user is told. */
    told: RegExp;
    /** Gives the project what it lacked. */
    repair: (host: FakePi) => Promise<void>;
  }

  const cases: Untrusted[] = [
    {
      name: "the user has never trusted them",
      arrange: async () => undefined,
      told: /you have not trusted them, or .*changed since you did.*\/ensemble-lifecycle-trust/s,
      repair: trustHooks,
    },
    {
      name: "the user declined at the confirmation",
      arrange: async (host) => {
        host.confirmAnswer = false;
        expect(await host.submit(`/${TRUST_COMMAND}`)).toBe("handled");
        expect(existsSync(defaultTrustStorePath())).toBe(false);
      },
      told: /you have not trusted them/,
      repair: trustHooks,
    },
    {
      name: "the hooks file changed after the user trusted it",
      arrange: async (host, project) => {
        await trustHooks(host);
        editHooksFile(project);
      },
      told: /changed since you did/,
      repair: trustHooks,
    },
    {
      name: "Pi does not trust the project, though the user trusted the hooks",
      arrange: async (host) => {
        await trustHooks(host);
        host.hostTrusted = false;
      },
      told: /Pi does not trust this project/,
      repair: async (host) => {
        host.hostTrusted = true;
      },
    },
  ];

  it.each(cases)("$name: no start handler and no end handler runs, the user is told why, and the same command runs once it is repaired", async (c) => {
    const project = auditAndFinish();
    const host = loadExtension(project);
    await c.arrange(host, project);
    host.notices.length = 0;

    // Refused: the command itself is not stopped, only the hooks are.
    expect(await host.submit("/ensemble-create-prd foo")).toBe("continue");
    expect(host.toModel).toEqual(["/ensemble-create-prd foo"]);
    host.workflow("do the work");
    expect(await host.complete({ outcome: "succeeded" })).toMatchObject({ recorded: false }); // no run began, so there is nothing to complete
    await host.settle("completed");
    await host.shutdown();
    expect(handlerLines(project)).toEqual([]);
    expect(eventsOf(project, "audit")).toEqual([]);
    expect(host.texts().filter((text) => c.told.test(text))).toHaveLength(1);
    expect(host.texts().some((text) => text.includes("(command."))).toBe(false); // no handler report either

    // The same project and the same input in a new session, with what was missing granted: the hooks run. The
    // refusal above was the gate's. (The first session is over: its shutdown closed its runtime.)
    await c.repair(host);
    const second = loadExtension(project);
    second.hostTrusted = host.hostTrusted;
    expect(await second.submit("/ensemble-create-prd foo")).toBe("continue");
    await finishWork(second);
    const runId = eventsOf(project, "audit")[0]?.run_id;
    expect(handlerLines(project)).toEqual([`audit begin ${runId}`, "audit end", `finish begin ${runId}`, "finish end"]);
    expectQuiet(host);
    expectQuiet(second);
  });

  it("records trust only after showing the user every handler, in the user's store outside the project", async () => {
    const project = auditAndFinish();
    const host = loadExtension(project);

    expect(await host.submit(`/${TRUST_COMMAND}`)).toBe("handled");

    expect(host.confirms).toHaveLength(1);
    expect(host.confirms[0].message).toContain("./scripts/record.sh");
    expect(host.confirms[0].message).toContain("audit");
    expect(host.confirms[0].message).toContain("finish");
    const store = defaultTrustStorePath();
    expect(store.startsWith(tempHome)).toBe(true);
    expect(store.startsWith(project.root)).toBe(false);
    expect(readFileSync(store, "utf8")).toContain(realpathSync(project.root));
    expect(host.texts().some((text) => text.startsWith("Trusted the lifecycle hooks"))).toBe(true);
    expectQuiet(host);
  });
});

// ---- AC-015-1, AC-015-2: start before the workflow, one end after it -------

describe("the lifecycle of a command (AC-015-1, AC-015-2)", () => {
  it("runs the start handlers to completion before the workflow's first step, and one set of end handlers after its final output", async () => {
    const project = makeProject({
      hooks: {
        hooks: {
          audit: recorder("audit", { hold: "holds/audit" }),
          gate: recorder("gate"),
          summarize: recorder("summarize"),
          archive: recorder("archive"),
        },
        commands: { [CREATE_PRD]: { start: ["audit", "gate"], end: ["summarize", "archive"] } },
      },
    });
    const host = loadExtension(project);
    await trustHooks(host);

    // The first start handler is held open by the test. While it runs the input is not let through to the model.
    let verdict: Verdict | undefined;
    const submitted = host.submit("/ensemble-create-prd foo").then((v) => {
      verdict = v;
      return v;
    });
    await until(() => traceOf(project).some((line) => line.startsWith("audit begin")), "the first start handler to begin");
    await nextTurn(); // an adapter that had not waited for the handler would have let the input through by now
    expect(verdict).toBeUndefined();
    expect(host.toModel).toEqual([]);
    expect(traceOf(project).some((line) => line.startsWith("gate"))).toBe(false); // handlers run one at a time

    open(project, "holds/audit");
    expect(await submitted).toBe("continue");
    host.workflow("read the arguments", "write the PRD");
    expect(await host.complete({ outcome: "succeeded", summary: "wrote the PRD", artifacts: ["docs/PRD/foo.md"] })).toMatchObject({
      text: expect.stringMatching(/recorded/i),
      recorded: true,
    });
    // The model keeps writing its final output after it calls the tool. An end delivered at the completion call
    // would have started by now: process start-up takes milliseconds, and this waits far longer than that.
    await delay(150);
    expect(traceOf(project).some((line) => line.startsWith("summarize"))).toBe(false);
    await host.settle("completed");

    const runId = eventsOf(project, "audit")[0].run_id;
    expect(traceOf(project)).toEqual([
      `audit begin ${runId}`,
      "audit end",
      `gate begin ${runId}`,
      "gate end",
      "model-prompt /ensemble-create-prd foo", // the prompt reached the model only after both start handlers had ended
      "workflow read the arguments",
      "workflow write the PRD",
      `tool ${COMPLETION_TOOL}`,
      "model-output", // an end delivered at the completion call would have appeared above this line
      `summarize begin ${runId}`,
      "summarize end",
      `archive begin ${runId}`,
      "archive end",
    ]);

    for (const tag of ["audit", "gate"]) {
      expect(eventsOf(project, tag)).toEqual([
        expect.objectContaining({ event: "command.start", run_id: runId, command: CREATE_PRD, arguments: "foo", cwd: host.ctx.cwd, session_id: "host-session-1" }),
      ]);
      expect(eventsOf(project, tag)[0].outcome).toBeUndefined();
    }
    for (const tag of ["summarize", "archive"]) {
      expect(eventsOf(project, tag)).toEqual([
        expect.objectContaining({
          event: "command.end",
          run_id: runId,
          command: CREATE_PRD,
          arguments: "foo",
          outcome: "succeeded",
          summary: "wrote the PRD",
          artifacts: ["docs/PRD/foo.md"],
          duration_ms: expect.any(Number),
        }),
      ]);
    }
    expect(host.systemPrompts).toHaveLength(1);
    expect(host.systemPrompts[0]).toContain(COMPLETION_TOOL); // the model is told how to end the command
    expect(host.texts().some((text) => text.includes(`${CREATE_PRD} (command.start)`))).toBe(true);
    expect(host.texts().some((text) => text.includes(`${CREATE_PRD} (command.end, command succeeded)`))).toBe(true);

    // Exactly one end set: nothing that follows starts a second one.
    const finished = traceOf(project);
    expect(await host.complete({ outcome: "failed", reason: "again" })).toMatchObject({ recorded: false });
    await host.settle("completed");
    await host.settle("aborted");
    await host.shutdown();
    expect(traceOf(project).filter((line) => line.startsWith("model-output"))).toHaveLength(3);
    expect(handlerLines(project)).toEqual(finished.filter((line) => !HOST_LINE.test(line)));
    expectQuiet(host);
  });

  it("states what Pi supports: start, end and end on cancel, which the cases below then deliver", () => {
    expect(HARNESS_CAPABILITIES.pi).toEqual({ adapter: true, command_start: true, command_end: true, command_end_on_cancel: true });
  });

  interface OutcomeCase {
    name: string;
    /** What the model, the loop or the user does once the command is under way. */
    drive: (host: FakePi) => Promise<void>;
    outcome: "succeeded" | "failed" | "cancelled";
    reason?: RegExp;
    summary?: string;
  }

  const outcomeCases: OutcomeCase[] = [
    {
      name: "the model completes the command",
      drive: async (host) => {
        await host.complete({ outcome: "succeeded", summary: "wrote the PRD" });
        await host.settle("completed");
      },
      outcome: "succeeded",
      summary: "wrote the PRD",
    },
    {
      name: "the model reports that it failed",
      drive: async (host) => {
        await host.complete({ outcome: "failed", reason: "the arguments name no ticket" });
        await host.settle("completed");
      },
      outcome: "failed",
      reason: /the arguments name no ticket/,
    },
    {
      name: "the loop ends in an error",
      drive: (host) => host.settle("error"),
      outcome: "failed",
      reason: /error/i,
    },
    {
      name: "the user aborts the loop",
      drive: (host) => host.settle("aborted"),
      outcome: "cancelled",
      reason: /aborted/i,
    },
    {
      name: "the session ends with no completion signal",
      drive: (host) => host.shutdown(),
      outcome: "cancelled",
      reason: /session ended/i,
    },
  ];

  it.each(outcomeCases)("$name: one end set runs, for outcome $outcome", async (c) => {
    const project = auditAndFinish();
    const host = loadExtension(project);
    await trustHooks(host);
    await host.submit("/ensemble-create-prd foo");
    host.workflow("do the work");

    await c.drive(host);

    const runId = eventsOf(project, "audit")[0].run_id;
    expect(eventsOf(project, "finish")).toEqual([
      expect.objectContaining({
        event: "command.end",
        run_id: runId,
        command: CREATE_PRD,
        outcome: c.outcome,
        ...(c.summary === undefined ? {} : { summary: c.summary }),
        ...(c.reason === undefined ? {} : { reason: expect.stringMatching(c.reason) }),
      }),
    ]);
    expect(host.texts().some((text) => text.includes(`(command.end, command ${c.outcome})`))).toBe(true);

    // However much more the host signals, the end handlers do not run again.
    await host.settle("completed");
    await host.settle("aborted");
    await host.shutdown();
    expect(handlerLines(project)).toEqual([`audit begin ${runId}`, "audit end", `finish begin ${runId}`, "finish end"]);
    expectQuiet(host);
  });

  it("ends nothing when the loop settles with no completion signal, so a command waiting for the user's reply stays open", async () => {
    const project = auditAndFinish();
    const host = loadExtension(project);
    await trustHooks(host);
    await host.submit("/ensemble-create-prd foo");

    await host.settle("completed"); // the command asked a question in plain text
    expect(await host.submit("yes, that one")).toBe("continue"); // the answer is not a command
    await host.settle("completed");

    expect(eventsOf(project, "finish")).toEqual([]);
    await finishWork(host); // the command completes in the end
    expect(eventsOf(project, "finish")).toHaveLength(1);
    expectQuiet(host);
  });
});

// ---- AC-015-3: a dispatcher fires the lifecycle once, for the target ------

describe("a dispatcher fires the lifecycle once, for the target (AC-015-3, REQ-003)", () => {
  /** The hooks file selects both the dispatcher and its target, so a lifecycle fired for either would leave a mark. */
  function dispatcherProject(dispatcherYaml: boolean): Project {
    return makeProject({
      dispatcherYaml,
      hooks: {
        hooks: {
          "dispatcher-start": recorder("dispatcher-start"),
          "dispatcher-end": recorder("dispatcher-end"),
          "target-start": recorder("target-start"),
          "target-end": recorder("target-end"),
        },
        commands: {
          [PRD_DISPATCHER]: { start: ["dispatcher-start"], end: ["dispatcher-end"] },
          [CREATE_PRD]: { start: ["target-start"], end: ["target-end"] },
        },
      },
    });
  }

  /** The lifecycle of one invocation ran once, for `ensemble:create-prd` with the arguments `foo`, and never for the dispatcher. */
  function expectOnceForTheTarget(project: Project): void {
    const starts = eventsOf(project, "target-start");
    const ends = eventsOf(project, "target-end");
    expect(starts).toEqual([expect.objectContaining({ event: "command.start", command: CREATE_PRD, arguments: "foo" })]);
    expect(ends).toEqual([expect.objectContaining({ event: "command.end", command: CREATE_PRD, arguments: "foo", outcome: "succeeded" })]);
    expect(ends[0].run_id).toBe(starts[0].run_id);
    expect(handlerLines(project)).toEqual([
      `target-start begin ${starts[0].run_id}`,
      "target-start end",
      `target-end begin ${starts[0].run_id}`,
      "target-end end",
    ]);
    expect(eventsOf(project, "dispatcher-start")).toEqual([]);
    expect(eventsOf(project, "dispatcher-end")).toEqual([]);
  }

  it("typed form: /ensemble-prd create foo reaches input as typed, and starts the target's run only", async () => {
    const project = dispatcherProject(false); // no dispatcher YAML, so no extension command intercepts the text
    const host = loadExtension(project);
    expect(host.commands.has("ensemble-prd")).toBe(false);
    await trustHooks(host);

    expect(await host.submit("/ensemble-prd create foo")).toBe("continue");
    expect(host.inputs).toEqual([{ text: "/ensemble-prd create foo", source: "interactive" }]);
    await finishWork(host);
    await host.shutdown();

    expectOnceForTheTarget(project);
    expectQuiet(host);
  });

  it("forwarded form: the registered dispatcher forwards /ensemble:prd create foo as an extension message, and the target's run starts once", async () => {
    const project = dispatcherProject(true); // the repository holds prd.yaml, so activate() registered the dispatcher command
    const host = loadExtension(project);
    expect(host.commands.has("ensemble-prd")).toBe(true);
    await trustHooks(host);

    expect(await host.submit("/ensemble-prd create foo")).toBe("continue");
    // Pi runs the extension command without firing `input` for what was typed; `input` sees only the forwarded text.
    expect(host.inputs).toEqual([{ text: "/ensemble:prd create foo", source: "extension" }]);
    await finishWork(host);
    await host.shutdown();

    expectOnceForTheTarget(project);
    expectQuiet(host);
  });

  it("a dispatcher with no keyword, or an unknown one, starts no lifecycle: not for the dispatcher and not for any target", async () => {
    for (const dispatcherYaml of [false, true]) {
      const project = dispatcherProject(dispatcherYaml);
      const host = loadExtension(project);
      await trustHooks(host);

      for (const text of ["/ensemble-prd", "/ensemble-prd nonsense foo", "/ensemble:prd", "/ensemble:prd nonsense foo"]) {
        await host.submit(text);
      }
      await host.settle("completed");
      await host.shutdown();

      expect(handlerLines(project)).toEqual([]);
      expectQuiet(host);
    }
  });
});

// ---- AC-015-4: a handler that times out, and a start handler that blocks --

describe("a handler that times out and a start handler that blocks (AC-015-4)", () => {
  it("on_error continue: a start handler that exceeds its timeout is killed and reported as timed out, and the command goes on", async () => {
    const project = makeProject({
      hooks: {
        hooks: {
          slow: { type: "shell", command: "./scripts/slow.sh", args: ["slow"], on_error: "continue", timeout_ms: 300 },
          after: recorder("after"),
          finish: recorder("finish"),
        },
        commands: { [CREATE_PRD]: { start: ["slow", "after"], end: ["finish"] } },
      },
    });
    const host = loadExtension(project);
    await trustHooks(host);

    expect(await host.submit("/ensemble-create-prd foo")).toBe("continue"); // the timeout did not stop the command
    await finishWork(host);

    const runId = eventsOf(project, "after")[0].run_id;
    expect(traceOf(project)).toEqual([
      `slow begin ${runId}`, // never followed by `slow end`: it was stopped, not waited for
      `after begin ${runId}`, // the next handler still ran
      "after end",
      "model-prompt /ensemble-create-prd foo",
      "workflow do the work",
      `tool ${COMPLETION_TOOL}`,
      "model-output",
      `finish begin ${runId}`,
      "finish end",
    ]);
    const report = host.texts().find((text) => text.includes(`${CREATE_PRD} (command.start)`)) ?? "";
    expect(report).toMatch(/slow: timed out in \d+ ms/);
    expect(report).toContain("(the handler failed; the command did not)");
    expect(report).toMatch(/after: succeeded/);
    expect(eventsOf(project, "finish")[0]).toMatchObject({ outcome: "succeeded" }); // the handler's timeout did not become the command's outcome

    // Killed, not only reported: nothing of the handler's process group is left.
    const pid = Number(readFileSync(join(project.root, "slow.pid"), "utf8"));
    expect(pid).toBeGreaterThan(1);
    expect(() => process.kill(-pid, 0)).toThrow(/ESRCH/);
    expectQuiet(host);
  });

  it("on_error block: a failing start handler makes the input handled, runs no later handler, and the end for the blocked run is failed", async () => {
    const project = makeProject({
      hooks: {
        hooks: { guard: recorder("guard", { code: 1, on_error: "block" }), later: recorder("later"), finish: recorder("finish") },
        commands: { [CREATE_PRD]: { start: ["guard", "later"], end: ["finish"] } },
      },
    });
    const host = loadExtension(project);
    await trustHooks(host);

    expect(await host.submit("/ensemble-create-prd foo")).toBe("handled");

    const runId = eventsOf(project, "guard")[0].run_id;
    expect(host.toModel).toEqual([]); // the workflow never began
    expect(host.systemPrompts).toEqual([]);
    expect(traceOf(project)).toEqual([`guard begin ${runId}`, "guard end", `finish begin ${runId}`, "finish end"]); // `later` never ran
    expect(eventsOf(project, "later")).toEqual([]);
    expect(eventsOf(project, "guard")[0]).toMatchObject({ event: "command.start", run_id: runId, command: CREATE_PRD });
    expect(eventsOf(project, "finish")).toEqual([
      expect.objectContaining({ event: "command.end", run_id: runId, command: CREATE_PRD, outcome: "failed", reason: 'Blocked by start handler "guard".' }),
    ]);
    const blocked = host.notices.find((notice) => notice.message.includes(`${CREATE_PRD} did not run: start handler "guard" blocked it.`));
    expect(blocked?.level).toBe("error");
    expect(host.texts().some((text) => text.includes(`${CREATE_PRD} (command.end, command failed)`))).toBe(true);

    // The blocked run is over: nothing the host signals afterwards ends it a second time.
    expect(await host.complete({ outcome: "succeeded" })).toMatchObject({ recorded: false });
    await host.settle("completed");
    await host.shutdown();
    expect(handlerLines(project)).toEqual([`guard begin ${runId}`, "guard end", `finish begin ${runId}`, "finish end"]);
    expectQuiet(host);
  });
});

// ---- The bundled build (REQ-015, TRD risk: agent-core import does not bundle) --

const BUN_AVAILABLE = spawnSync("bun", ["--version"], { encoding: "utf8" }).status === 0;
if (!BUN_AVAILABLE) {
  console.warn(
    "lifecycle-entrypoint: the bundled-build tests are SKIPPED, not passed: `bun` is not on PATH, so the extension bundle was neither built nor loaded.",
  );
}
const bundledBuild = BUN_AVAILABLE ? describe : describe.skip;

/** Whether `dir`, or any directory above it, holds a `node_modules`, which a module resolver would search. */
function hasNodeModulesAbove(dir: string): boolean {
  for (let current = realpathSync(dir); ; current = dirname(current)) {
    if (existsSync(join(current, "node_modules"))) return true;
    if (dirname(current) === current) return false;
  }
}

/** A temporary directory with no `node_modules` above it: the system's, or the first other one that qualifies. */
function isolatedTempRoot(): string {
  const candidates = [os.tmpdir(), "/var/tmp", "/usr/tmp"].filter((dir) => existsSync(dir));
  const found = candidates.find((dir) => !hasNodeModulesAbove(dir));
  if (!found) throw new Error(`every temporary directory (${candidates.join(", ")}) has a node_modules above it, so loading a bundle there would prove nothing`);
  return found;
}

function isolatedTempDir(prefix: string): string {
  const dir = mkdtempSync(join(isolatedTempRoot(), prefix));
  dirs.push(dir);
  return dir;
}

/**
 * The arguments `scripts/install.mjs` gives `bun`, read from that script so that this test builds exactly what the
 * installer builds, with `outfile` in place of its BUNDLE path. It fails, saying so, if the script's call changes shape.
 */
function bunBuildArguments(outfile: string): string[] {
  const call = /execFileSync\(\s*"bun",\s*\[([^\]]*)\]/.exec(readFileSync(INSTALL_SCRIPT, "utf8"));
  if (!call) throw new Error('scripts/install.mjs no longer calls execFileSync("bun", [ ... ]) in the shape this test reads: update bunBuildArguments()');
  return call[1]
    .split(",")
    .map((raw) => raw.trim())
    .filter((raw) => raw !== "")
    .map((raw) => {
      const quoted = /^(["`])([\s\S]*)\1$/.exec(raw);
      if (!quoted) throw new Error(`cannot read the bun argument ${raw} from scripts/install.mjs`);
      const value = quoted[2].replace("${BUNDLE}", outfile);
      if (value.includes("${")) throw new Error(`the bun argument ${raw} in scripts/install.mjs interpolates something besides BUNDLE`);
      return value;
    });
}

/** Builds the bundle as the installer does, into a directory of its own, and returns its path. */
function buildBundle(): string {
  const outfile = join(isolatedTempDir("lifecycle-entry-bundle-"), "extension.bundle.cjs");
  const args = bunBuildArguments(outfile);
  const built = spawnSync("bun", args, { cwd: PACKAGE_ROOT, encoding: "utf8" });
  if (built.status !== 0 || !existsSync(outfile)) throw new Error(`bun ${args.join(" ")} failed (${built.status}):\n${built.stderr}${built.stdout}`);
  return outfile;
}

/**
 * Plays Pi around a bundle, in a Node process of its own: loads it the way the installed shim does, hands it a fake
 * Pi, and in `run` mode plays one command's lifecycle through it. It reports what happened as JSON on stdout.
 *
 * Before the bundle loads, module resolution is changed so that a bare specifier is an error: the host resolves the
 * extension file and nothing it requires, so a bundle may require node builtins and nothing else. That holds
 * wherever the file sits, so the check does not depend on what directories lie above it.
 */
const BUNDLE_HOST = String.raw`"use strict";
const Module = require("node:module");
const fs = require("node:fs");
const path = require("node:path");

const resolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request) {
  if (!Module.isBuiltin(request) && !request.startsWith(".") && !path.isAbsolute(request)) {
    throw new Error("the bundle requires " + JSON.stringify(request) + ", which the host would have to resolve through node_modules");
  }
  return resolveFilename.apply(this, arguments);
};

const [bundle, mode, trace] = process.argv.slice(2);
let inner = Module.createRequire(bundle)(bundle);
inner = inner && inner.default ? inner.default : inner;
if (typeof inner !== "function") throw new Error("the bundle exports no activate function");

const handlers = new Map();
const tools = new Map();
const commands = new Map();
const notices = [];
let bound = false;
const pi = {
  on(event, handler) { handlers.set(event, (handlers.get(event) || []).concat([handler])); },
  registerTool(tool) { tools.set(tool.name, tool); },
  registerCommand(name, command) { commands.set(name, command); },
  getCommands() {
    if (!bound) throw new Error("Extension runtime not initialized.");
    return [{ name: "ensemble-create-prd", source: "prompt" }];
  },
};
const ctx = {
  cwd: process.cwd(),
  hasUI: true,
  ui: { notify(message, level) { notices.push({ message: message, level: level }); }, async confirm() { return true; } },
  isProjectTrusted() { return true; },
  sessionManager: { getSessionId() { return "bundle-session"; } },
  hasPendingMessages() { return false; },
};
async function emit(type, event) {
  const results = [];
  for (const handler of handlers.get(type) || []) results.push(await handler(Object.assign({ type: type }, event), ctx));
  return results;
}

async function main() {
  inner(pi);
  bound = true;
  const report = { registered: { commands: [...commands.keys()].sort(), tools: [...tools.keys()].sort(), events: [...handlers.keys()].sort() } };
  if (mode === "run") {
    const mark = (line) => fs.appendFileSync(trace, line + "\n");
    await commands.get("ensemble-lifecycle-trust").handler("", ctx);
    const text = "/ensemble-create-prd foo";
    report.input = (await emit("input", { text: text, source: "interactive" }))[0];
    mark("model-prompt " + text);
    await emit("before_agent_start", { prompt: text, systemPrompt: "base", systemPromptOptions: {} });
    mark("workflow do the work");
    const completion = await tools.get("ensemble_command_complete").execute("call-1", { outcome: "succeeded", summary: "done" }, undefined, undefined, ctx);
    report.completion = completion.content[0].text;
    mark("model-output");
    await emit("agent_before_settle", { outcome: "completed", entries: [], continue: false });
    await emit("agent_settled", { aborted: false });
    await emit("session_shutdown", { reason: "quit" });
  }
  report.notices = notices;
  process.stdout.write(JSON.stringify(report));
}
main().catch((error) => {
  process.stderr.write(String((error && error.stack) || error) + "\n");
  process.exit(1);
});
`;

interface BundleReport {
  registered: { commands: string[]; tools: string[]; events: string[] };
  input?: { action?: string };
  completion?: string;
  notices: { message: string; level: string }[];
}

/**
 * Loads `bundle` in a fresh Node process, started in the project's `sub/` directory with a home of its own, as Pi
 * would start the extension, and returns what the process reported. The bundle is copied to a directory with no
 * `node_modules` above it first, so a require that only the repository's own node_modules could answer fails.
 */
function runBundle(bundle: string, project: Project, mode: "register" | "run"): BundleReport {
  const loose = isolatedTempDir("lifecycle-entry-loose-");
  const bundleFile = join(loose, "extension.bundle.cjs");
  const driver = join(loose, "bundle-host.cjs");
  copyFileSync(bundle, bundleFile);
  writeFileSync(driver, BUNDLE_HOST);
  const home = tempDir("lifecycle-entry-bundle-home-");
  const run = spawnSync(process.execPath, [driver, bundleFile, mode, project.trace], {
    cwd: join(project.root, "sub"),
    env: { PATH: process.env.PATH ?? "", HOME: home },
    encoding: "utf8",
    timeout: 30_000,
  });
  if (run.status !== 0) throw new Error(`the bundle host exited with ${run.status}:\n${run.stderr}${run.stdout}`);
  return JSON.parse(run.stdout) as BundleReport;
}

const SKIPPED_NOTE = BUN_AVAILABLE ? "" : " -- SKIPPED: bun is not on PATH, so no bundle was built or loaded";

bundledBuild(`the bundled extension, built as scripts/install.mjs builds it${SKIPPED_NOTE}`, () => {
  let bundle = "";
  beforeAll(() => {
    bundle = buildBundle();
  }, 60_000);

  it("takes agent-core into the bundle and leaves nothing to resolve but node builtins", () => {
    const source = readFileSync(bundle, "utf8");

    expect(source).toContain("ensemble-lifecycle-hooks-trust/v1"); // agent-core's trust digest domain: agent-core's code is in the file
    const required = new Set<string>();
    for (const match of source.matchAll(/\brequire\(\s*["'`]([^"'`]+)["'`]\s*\)/g)) required.add(match[1]);
    const builtins = new Set(builtinModules);
    expect([...required].filter((specifier) => !specifier.startsWith("node:") && !builtins.has(specifier))).toEqual([]);
  });

  it("loads from a directory with no node_modules, and activate registers nothing when the project has no hooks file", () => {
    const report = runBundle(bundle, makeProject(), "register");

    expect(report.registered).toEqual({ commands: [], tools: [], events: [] });
  });

  it("given a hooks file, activate registers the trust command, the completion tool and an input handler", () => {
    const report = runBundle(bundle, auditAndFinish(), "register");

    expect(report.registered.commands).toEqual([TRUST_COMMAND]);
    expect(report.registered.tools).toEqual([COMPLETION_TOOL]);
    expect(report.registered.events).toEqual(["agent_before_settle", "agent_settled", "before_agent_start", "input", "session_shutdown"]);
  });

  it("runs a command's start and end handlers through the bundled agent-core: trust, start, completion, end", () => {
    const project = auditAndFinish();

    const report = runBundle(bundle, project, "run");

    const runId = eventsOf(project, "audit")[0].run_id;
    expect(report.input).toEqual({ action: "continue" });
    expect(report.completion).toMatch(/recorded/i);
    expect(traceOf(project)).toEqual([
      `audit begin ${runId}`,
      "audit end",
      "model-prompt /ensemble-create-prd foo",
      "workflow do the work",
      "model-output",
      `finish begin ${runId}`,
      "finish end",
    ]);
    expect(eventsOf(project, "finish")).toEqual([expect.objectContaining({ event: "command.end", run_id: runId, outcome: "succeeded" })]);
    expect(report.notices.map((notice) => notice.level)).not.toContain("error");
  });

  /**
   * A checkout nobody has built: the sources of agent-core and of this package, no `dist` anywhere, the dependencies
   * linked in from this checkout, and agent-core itself the copy's own. Run from its package directory with a home of
   * its own, `node scripts/install.mjs` is what a person types; it does not go through npm's `preinstall:extension`.
   */
  function uninstalledCheckout() {
    const root = isolatedTempDir("lifecycle-entry-checkout-");
    const pkg = join(root, "packages", "pi-extension");
    const agentCore = join(root, "packages", "agent-core");
    mkdirSync(join(pkg, "scripts"), { recursive: true });
    mkdirSync(agentCore, { recursive: true });
    mkdirSync(join(root, "home"));
    cpSync(join(PACKAGE_ROOT, "src"), join(pkg, "src"), { recursive: true });
    for (const file of ["package.json", "tsconfig.json"]) copyFileSync(join(PACKAGE_ROOT, file), join(pkg, file));
    copyFileSync(INSTALL_SCRIPT, join(pkg, "scripts", "install.mjs"));
    const coreSource = join(REPO_ROOT, "packages", "agent-core");
    cpSync(join(coreSource, "src"), join(agentCore, "src"), { recursive: true });
    for (const file of ["package.json", "tsconfig.json"]) copyFileSync(join(coreSource, file), join(agentCore, file));

    const modules = join(root, "node_modules");
    mkdirSync(join(modules, "@types"), { recursive: true });
    mkdirSync(join(modules, "@sunstone-partners"));
    for (const dependency of ["typescript", "js-yaml", "@types/node", "@types/js-yaml"]) {
      symlinkSync(dirname(require.resolve(`${dependency}/package.json`)), join(modules, dependency), "dir");
    }
    symlinkSync(agentCore, join(modules, "@sunstone-partners", "ensemble-agent-core"), "dir");
    return { pkg, agentCore, home: join(root, "home"), bundle: join(pkg, "dist", "extension.bundle.cjs") };
  }

  it("node scripts/install.mjs builds agent-core's dist before the bundle, so a checkout nobody has built installs and loads", () => {
    const checkout = uninstalledCheckout();
    expect(existsSync(join(checkout.agentCore, "dist"))).toBe(false); // the premise: there is no agent-core build to bundle

    const install = spawnSync(process.execPath, [join(checkout.pkg, "scripts", "install.mjs")], {
      cwd: checkout.pkg,
      env: { PATH: process.env.PATH ?? "", HOME: checkout.home },
      encoding: "utf8",
      timeout: 90_000,
    });

    expect({ status: install.status, output: `${install.stdout}${install.stderr}` }).toEqual({ status: 0, output: expect.any(String) });
    expect(install.stdout.indexOf("building agent-core...")).toBeGreaterThanOrEqual(0);
    expect(install.stdout.indexOf("building bundle...")).toBeGreaterThan(install.stdout.indexOf("building agent-core..."));
    expect(existsSync(join(checkout.agentCore, "dist", "index.js"))).toBe(true);
    expect(existsSync(checkout.bundle)).toBe(true);
    const shim = join(checkout.home, ".omp", "agent", "extensions", "ensemble-pi-extension.ts");
    expect(readFileSync(shim, "utf8")).toContain(realpathSync(checkout.bundle)); // the shim loads the bundle the installer built

    // The bundle that install produced loads and runs a command's lifecycle, with the copy's agent-core inside it.
    const project = auditAndFinish();
    const report = runBundle(checkout.bundle, project, "run");
    const runId = eventsOf(project, "audit")[0].run_id;
    expect(report.input).toEqual({ action: "continue" });
    expect(handlerLines(project)).toEqual([`audit begin ${runId}`, "audit end", `finish begin ${runId}`, "finish end"]);
  }, 90_000);
});
