import { appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  HOOKS_FILE_RELATIVE,
  computeHooksDigest,
  isTrusted,
  loadHooksConfig,
  recordTrust,
  runShellHandler,
} from "@sunstone-partners/ensemble-agent-core";
// agent-core's one canonical guard; its barrel does not re-export it, so it is imported from its module.
import { isRecord } from "../../agent-core/src/type-guards";
import activate from "../src/extension";
import {
  TRUST_COMMAND_NAME,
  createHooksGate,
  evaluateHooksGate,
  knownCommandsFromHost,
  registerLifecycleHooks,
} from "../src/lifecycle/adapter";
import type { GateDecision } from "../src/lifecycle/adapter";

/**
 * TRD-009-TEST: the adapter's inertness, its two-condition trust gate and the
 * trust command (AC-006-1, AC-007-4, AC-008-1, AC-008-2, AC-009-7,
 * AC-022-1 .. AC-022-8).
 *
 * Everything is real except the host: temporary project directories, real
 * files, a real trust store in a temporary home, and a real shell handler that
 * writes a marker file when it runs. "Nothing ran" is proved by the marker's
 * absence, never by a mock. The handlers of the start and end paths do not
 * exist yet, so `runStartHandlers` below stands in for them: it runs the
 * selected shell handlers only when the gate says `active`, which is the one
 * thing those paths are allowed to do.
 */

const CREATE_PRD = "ensemble:create-prd";
const REFINE_PRD = "ensemble:refine-prd";
const HOOKS_YAML = `version: 1
hooks:
  mark:
    type: shell
    command: ./scripts/mark.sh
    args: ["--audit", "two words"]
    on_error: continue
  review:
    type: prompt
    prompt: ./prompts/review.md
    on_error: continue
commands:
  ${CREATE_PRD}:
    start: [mark]
    end: [review]
`;
const MARK_SCRIPT = `#!/bin/sh
printf ran >> "$ENSEMBLE_PROJECT_ROOT/ran.marker"
`;

/** What Pi reports for `getCommands()` in these tests: both commands exist. */
const HOST_COMMANDS = [{ name: "ensemble-create-prd" }, { name: "ensemble-refine-prd" }];

const dirs: string[] = [];
const originalCwd = process.cwd();
const originalHome = process.env.HOME;

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

// ---- Output capture -------------------------------------------------------

let printed: string[] = [];
const restores: Array<() => void> = [];

beforeEach(() => {
  printed = [];
  const record = (chunk: unknown): boolean => {
    printed.push(String(chunk));
    return true;
  };
  const stderr = jest.spyOn(process.stderr, "write").mockImplementation(record);
  const stdout = jest.spyOn(process.stdout, "write").mockImplementation(record);
  restores.push(() => stderr.mockRestore(), () => stdout.mockRestore());
  for (const method of ["log", "info", "warn", "error", "debug"] as const) {
    const spy = jest.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      printed.push(args.map(String).join(" "));
    });
    restores.push(() => spy.mockRestore());
  }
  // Activation resolves its default trust store from the home directory: keep it away from the real one.
  process.env.HOME = tempDir("lifecycle-adapter-home-");
});

afterEach(() => {
  while (restores.length > 0) restores.pop()?.();
  process.env.HOME = originalHome;
  process.chdir(originalCwd);
});

afterAll(() => {
  dirs.forEach((d) => rmSync(d, { recursive: true, force: true }));
});

// ---- Fixtures -------------------------------------------------------------

interface Registered {
  description?: string;
  handler: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
}

function fakePi(options: { getCommands?: () => { name: string }[] } = {}) {
  const commands = new Map<string, Registered>();
  const tools: string[] = [];
  const toolDefinitions: Array<{ name: string; parameters: { properties: Record<string, unknown>; additionalProperties: boolean } }> = [];
  const events: string[] = [];
  const getCommands = jest.fn(options.getCommands ?? (() => HOST_COMMANDS));
  const pi = {
    on: (event: string) => {
      events.push(event);
    },
    registerTool: (tool: { name: string; parameters: { properties: Record<string, unknown>; additionalProperties: boolean } }) => {
      tools.push(tool.name);
      toolDefinitions.push(tool);
    },
    registerCommand: (name: string, o: unknown) => {
      commands.set(name, o as Registered);
    },
    registerFlag: () => undefined,
    getFlag: () => false,
    sendUserMessage: () => undefined,
    sendMessage: () => undefined,
    getCommands,
  } as unknown as ExtensionAPI;
  return { pi, commands, tools, toolDefinitions, events, getCommands };
}

const NO_DECISION = Symbol("host gives no project-trust decision");

/**
 * A host context. `hostTrust` is what `isProjectTrusted()` returns; `NO_DECISION` removes the method.
 * `hostTrustProperty` sets `isProjectTrusted` itself to a value that is not a function.
 */
function fakeCtx(options: { hasUI?: boolean; hostTrust?: unknown; hostTrustProperty?: unknown; confirm?: () => unknown } = {}) {
  const notify = jest.fn<void, [string, string?]>();
  const confirm = jest.fn(async (..._args: [string, string]) => options.confirm?.());
  const ctx: Record<string, unknown> = { hasUI: options.hasUI ?? true, ui: { notify, confirm } };
  const hostTrust = "hostTrust" in options ? options.hostTrust : true;
  if ("hostTrustProperty" in options) ctx.isProjectTrusted = options.hostTrustProperty;
  else if (hostTrust !== NO_DECISION) ctx.isProjectTrusted = () => hostTrust;
  return { ctx: ctx as unknown as ExtensionContext & ExtensionCommandContext, notify, confirm };
}

interface Project {
  root: string;
  storePath: string;
  marker: string;
}

/** A project directory (anchored by `.git`) with the hooks file, the handler script and the prompt file. */
function makeProject(hooksYaml: string | null = HOOKS_YAML): Project {
  const root = tempDir("lifecycle-adapter-project-");
  mkdirSync(join(root, ".git"));
  mkdirSync(join(root, ".ensemble"));
  mkdirSync(join(root, "scripts"));
  mkdirSync(join(root, "prompts"));
  if (hooksYaml !== null) writeFileSync(join(root, HOOKS_FILE_RELATIVE), hooksYaml);
  writeFileSync(join(root, "scripts/mark.sh"), MARK_SCRIPT);
  chmodSync(join(root, "scripts/mark.sh"), 0o755);
  writeFileSync(join(root, "prompts/review.md"), "Review the result.\n");
  return { root, storePath: join(tempDir("lifecycle-adapter-store-"), ".ensemble", "trusted-hooks.json"), marker: join(root, "ran.marker") };
}

/** The user's trust in the project's hooks exactly as they are now, recorded the way the trust command records it. */
function trustProject(project: Project): void {
  const loaded = loadHooksConfig(project.root, { knownCommands: knownCommandsFromHost(HOST_COMMANDS) });
  if (loaded.status !== "valid") throw new Error(`fixture hooks file is ${loaded.status}`);
  recordTrust(project.root, computeHooksDigest(project.root, loaded.config), { storePath: project.storePath });
}

/** What the start path may do with a verdict: run the selected shell handlers, and only when it is `active`. */
async function runStartHandlers(decision: GateDecision, project: Project, command: string): Promise<string[]> {
  if (!decision.active) return [];
  const statuses: string[] = [];
  for (const name of decision.config.commands[command].start) {
    const handler = decision.config.hooks[name];
    if (handler.type === "shell") {
      const outcome = await runShellHandler(name, handler, "{}", { projectRoot: project.root });
      statuses.push(`${name}:${outcome.status}`);
    }
  }
  return statuses;
}

const ran = (project: Project): string => (existsSync(project.marker) ? readFileSync(project.marker, "utf8") : "");

function gateFor(project: Project, pi: ExtensionAPI) {
  return createHooksGate(pi, project.root, { storePath: project.storePath });
}

// ---- Inert without a hooks file (AC-008-1) --------------------------------

describe("inert without a hooks file", () => {
  it("registers nothing, asks the host for nothing and prints nothing", () => {
    const project = makeProject(null);
    const { pi, commands, tools, events, getCommands } = fakePi();

    registerLifecycleHooks(pi, project.root, { storePath: project.storePath });

    expect([...commands.keys()]).toEqual([]);
    expect(tools).toEqual([]);
    expect(events).toEqual([]);
    expect(getCommands).not.toHaveBeenCalled();
    expect(printed).toEqual([]);
    expect(existsSync(project.storePath)).toBe(false);
  });

  it("registers no handler and no tool when activate(fakePi) runs in such a project", () => {
    const project = makeProject(null);
    process.chdir(project.root);
    const { pi, commands, tools, events } = fakePi();

    activate(pi);

    expect([...commands.keys()]).toEqual([]);
    expect(tools).toEqual([]);
    expect(events).toEqual([]);
    expect(printed).toEqual([]);
  });

  it("is still inert when .ensemble exists but holds no hooks file", () => {
    const project = makeProject(null);
    writeFileSync(join(project.root, ".ensemble", "unrelated.yaml"), "version: 1\n");
    process.chdir(project.root);
    const { pi, commands, tools, events } = fakePi();

    activate(pi);

    expect([...commands.keys()]).toEqual([]);
    expect(tools).toEqual([]);
    expect(events).toEqual([]);
    expect(printed).toEqual([]);
  });

  it("gates every command as no-hooks-file, silently", async () => {
    const project = makeProject(null);
    const { pi } = fakePi();
    const { ctx, notify } = fakeCtx();

    const decision = gateFor(project, pi)(ctx, CREATE_PRD);

    expect(decision).toEqual({ active: false, reason: "no-hooks-file" });
    expect(await runStartHandlers(decision, project, CREATE_PRD)).toEqual([]);
    expect(notify).not.toHaveBeenCalled();
    expect(printed).toEqual([]);
  });

  it("never calls getCommands while activating, because Pi throws there until its runtime is bound", () => {
    const project = makeProject();
    process.chdir(project.root);
    const { pi, commands, getCommands } = fakePi({
      getCommands: () => {
        throw new Error("Extension runtime not initialized. Action methods cannot be called during extension loading.");
      },
    });

    expect(() => activate(pi)).not.toThrow();

    expect(getCommands).not.toHaveBeenCalled();
    expect([...commands.keys()]).toEqual([TRUST_COMMAND_NAME]);
  });
});

// ---- Registration with a hooks file: no collision, no tool (AC-009-7) -----

describe("what the adapter registers when the project has a hooks file", () => {
  it("registers only the trust command, named ensemble-lifecycle-trust, and nothing starting with hooks-", () => {
    const project = makeProject();
    process.chdir(project.root);
    const { pi, commands } = fakePi();

    activate(pi);

    const names = [...commands.keys()];
    expect(TRUST_COMMAND_NAME).toBe("ensemble-lifecycle-trust");
    expect(names).toEqual(["ensemble-lifecycle-trust"]);
    expect(names.filter((n) => n.startsWith("hooks-"))).toEqual([]);
    expect(printed).toEqual([]);
  });

  it("registers one tool, the completion tool, and nothing the model could call names a handler or an executable", () => {
    const project = makeProject();
    const { pi, tools, toolDefinitions } = fakePi();

    registerLifecycleHooks(pi, project.root, { storePath: project.storePath });

    expect(tools).toEqual(["ensemble_command_complete"]);
    expect(Object.keys(toolDefinitions[0].parameters.properties).sort()).toEqual(["artifacts", "outcome", "reason", "summary"]);
    expect(toolDefinitions[0].parameters.additionalProperties).toBe(false);
  });

  it("does not let the trust command's arguments skip the confirmation", async () => {
    const project = makeProject();
    const { pi, commands } = fakePi();
    registerLifecycleHooks(pi, project.root, { storePath: project.storePath });
    const { ctx, confirm } = fakeCtx({ confirm: () => false });

    for (const args of ["yes", "--yes", "-y", "--trust", "confirm=true", CREATE_PRD]) {
      await commands.get(TRUST_COMMAND_NAME)?.handler(args, ctx);
    }

    expect(confirm).toHaveBeenCalledTimes(6);
    expect(existsSync(project.storePath)).toBe(false);
  });
});

// ---- Selected only (AC-008-2) ---------------------------------------------

describe("selected commands only", () => {
  it("is silent and runs nothing for a command the hooks file does not select, whatever the trust state", async () => {
    const project = makeProject();
    const { pi } = fakePi();

    for (const [hostTrust, userTrusted] of [
      [true, false],
      [false, false],
      [NO_DECISION, false],
      [true, true],
    ] as const) {
      if (userTrusted) trustProject(project);
      const { ctx, notify } = fakeCtx({ hostTrust });
      const decision = gateFor(project, pi)(ctx, REFINE_PRD);

      expect(decision).toEqual({ active: false, reason: "not-selected" });
      expect(await runStartHandlers(decision, project, REFINE_PRD)).toEqual([]);
      expect(notify).not.toHaveBeenCalled();
    }
    expect(printed).toEqual([]);
    expect(ran(project)).toBe("");
  });

  it("is silent for a command that is not an own property of the selections", () => {
    const project = makeProject();
    const { pi } = fakePi();
    const { ctx, notify } = fakeCtx();

    for (const command of ["constructor", "__proto__", "toString", "", "ensemble:create-prd "]) {
      expect(gateFor(project, pi)(ctx, command)).toEqual({ active: false, reason: "not-selected" });
    }
    expect(notify).not.toHaveBeenCalled();
    expect(printed).toEqual([]);
  });
});

// ---- Invalid file (AC-007-4, AC-022-4) ------------------------------------

describe("an invalid hooks file", () => {
  const INVALID_YAML = `version: 1
hooks:
  mark:
    type: shell
    command: ./scripts/mark.sh
commands:
  ${CREATE_PRD}:
    start: [mark]
`;

  it("shows the validation errors, runs nothing, even when the host and the user trust the project", async () => {
    const project = makeProject();
    trustProject(project);
    writeFileSync(join(project.root, HOOKS_FILE_RELATIVE), INVALID_YAML);
    const { pi } = fakePi();
    const { ctx, notify } = fakeCtx({ hostTrust: true });

    const decision = gateFor(project, pi)(ctx, CREATE_PRD);

    expect(decision.active).toBe(false);
    expect(decision).toMatchObject({ reason: "invalid-config" });
    expect(await runStartHandlers(decision, project, CREATE_PRD)).toEqual([]);
    expect(ran(project)).toBe("");
    expect(notify).toHaveBeenCalledTimes(1);
    const [message, level] = notify.mock.calls[0];
    expect(level).toBe("error");
    expect(message).toContain(HOOKS_FILE_RELATIVE);
    expect(message).toContain("hooks.mark.on_error");
  });

  it("validates, and executes nothing, when the host does not trust the project (AC-022-4)", async () => {
    const project = makeProject(INVALID_YAML);
    const { pi } = fakePi();
    const { ctx, notify } = fakeCtx({ hostTrust: false });

    const decision = gateFor(project, pi)(ctx, CREATE_PRD);

    expect(decision).toMatchObject({ active: false, reason: "invalid-config" });
    expect(await runStartHandlers(decision, project, CREATE_PRD)).toEqual([]);
    expect(ran(project)).toBe("");
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("rejects a hook for a command the host does not know (nonexistent command)", async () => {
    const project = makeProject(HOOKS_YAML.replace(CREATE_PRD, "ensemble:no-such-command"));
    const { pi } = fakePi();
    const { ctx, notify } = fakeCtx();

    const decision = gateFor(project, pi)(ctx, "ensemble:no-such-command");

    expect(decision).toMatchObject({ active: false, reason: "invalid-config" });
    expect(await runStartHandlers(decision, project, "ensemble:no-such-command")).toEqual([]);
    expect(notify.mock.calls[0][0]).toContain("ensemble:no-such-command");
  });

  it("accepts the same hook once the host reports the command, as a skill too", () => {
    const project = makeProject();
    const known = (names: string[]) =>
      evaluateHooksGate({
        projectRoot: project.root,
        command: CREATE_PRD,
        knownCommands: knownCommandsFromHost(names.map((name) => ({ name }))),
        host: { isProjectTrusted: () => true },
        trust: { storePath: project.storePath },
      });

    expect(known(["ensemble-create-prd"])).toMatchObject({ reason: "user-untrusted" });
    expect(known(["skill:ensemble-create-prd"])).toMatchObject({ reason: "user-untrusted" });
    expect(known(["ensemble-refine-prd"])).toMatchObject({ reason: "invalid-config" });
    expect(known([])).toMatchObject({ reason: "invalid-config" });
  });

  it("reports once per change to the file, not once per command", () => {
    const project = makeProject(INVALID_YAML);
    const { pi } = fakePi();
    const gate = gateFor(project, pi);
    const { ctx, notify } = fakeCtx();
    const errors = () => notify.mock.calls.filter(([, level]) => level === "error").length;

    gate(ctx, CREATE_PRD);
    gate(ctx, CREATE_PRD);
    gate(ctx, REFINE_PRD);
    expect(errors()).toBe(1);

    // The file changes while still invalid (same errors, different bytes): reported again, once.
    appendFileSync(join(project.root, HOOKS_FILE_RELATIVE), "# edited\n");
    gate(ctx, CREATE_PRD);
    gate(ctx, REFINE_PRD);
    expect(errors()).toBe(2);

    // Its errors change: reported again, once.
    writeFileSync(join(project.root, HOOKS_FILE_RELATIVE), INVALID_YAML.replace("version: 1", "version: 2"));
    gate(ctx, CREATE_PRD);
    gate(ctx, CREATE_PRD);
    expect(errors()).toBe(3);
  });

  it.each([
    ["refused as untrusted", false],
    ["active", true],
  ])("reports again when the file breaks after having been valid and %s in between", (_label, trusted) => {
    const project = makeProject(INVALID_YAML);
    const { pi } = fakePi();
    const gate = gateFor(project, pi);
    const { ctx, notify } = fakeCtx();
    const errors = () => notify.mock.calls.filter(([, level]) => level === "error").length;

    gate(ctx, CREATE_PRD);
    expect(errors()).toBe(1);

    writeFileSync(join(project.root, HOOKS_FILE_RELATIVE), HOOKS_YAML);
    if (trusted) trustProject(project);
    expect(gate(ctx, CREATE_PRD)).toMatchObject(trusted ? { active: true } : { reason: "user-untrusted" });
    expect(errors()).toBe(1);

    // The very same bytes as the first time: only the valid verdict in between makes this a new report.
    writeFileSync(join(project.root, HOOKS_FILE_RELATIVE), INVALID_YAML);
    gate(ctx, CREATE_PRD);
    expect(errors()).toBe(2);
  });

  it("writes the report to stderr once when the host has no UI", () => {
    const project = makeProject(INVALID_YAML);
    const { pi } = fakePi();
    const gate = gateFor(project, pi);
    const { ctx, notify } = fakeCtx({ hasUI: false });

    gate(ctx, CREATE_PRD);
    gate(ctx, CREATE_PRD);
    gate(ctx, REFINE_PRD);

    expect(notify).not.toHaveBeenCalled();
    expect(printed).toHaveLength(1);
    expect(printed[0]).toContain("hooks.mark.on_error");
  });

  it("shows control characters from the untrusted file as escapes, never raw", () => {
    const project = makeProject(`version: 1\nhooks:\n  "x\\e[2Jy":\n    on_error: continue\ncommands: {}\n`);
    const { pi } = fakePi();
    const { ctx, notify } = fakeCtx();

    gateFor(project, pi)(ctx, CREATE_PRD);

    const message = notify.mock.calls[0][0];
    expect(message).toContain("\\u{1b}");
    expect(message).not.toContain("\u001b");
  });
});

// ---- The two trust conditions (AC-022-1, -2, -3, -5) ----------------------

describe("the two-condition trust gate", () => {
  it("refuses when the host does not trust the project, even with the user's record, and says how to trust it (AC-022-1)", async () => {
    const project = makeProject();
    trustProject(project);
    const { pi } = fakePi();
    const { ctx, notify } = fakeCtx({ hostTrust: false });

    const decision = gateFor(project, pi)(ctx, CREATE_PRD);

    expect(decision).toMatchObject({ active: false, reason: "host-untrusted" });
    expect(await runStartHandlers(decision, project, CREATE_PRD)).toEqual([]);
    expect(ran(project)).toBe("");
    expect(notify).toHaveBeenCalledTimes(1);
    const [message, level] = notify.mock.calls[0];
    expect(level).toBe("warning");
    expect(message).toContain(HOOKS_FILE_RELATIVE);
    expect(message).toContain("/trust");
    expect(message).toContain("--approve");
  });

  it("refuses when the host offers no project-trust decision, even with the user's record (AC-022-3)", async () => {
    const project = makeProject();
    trustProject(project);
    const { pi } = fakePi();
    const { ctx, notify } = fakeCtx({ hostTrust: NO_DECISION });

    const decision = gateFor(project, pi)(ctx, CREATE_PRD);

    expect(decision).toMatchObject({ active: false, reason: "host-trust-unavailable" });
    expect(await runStartHandlers(decision, project, CREATE_PRD)).toEqual([]);
    expect(ran(project)).toBe("");
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0]).toContain("isProjectTrusted");
    expect(notify.mock.calls[0][0]).toContain(HOOKS_FILE_RELATIVE);
  });

  it.each([
    ["the string 'true'", "true"],
    ["the number 1", 1],
    ["undefined", undefined],
    ["null", null],
    ["a truthy object", { trusted: true }],
  ])("treats %s from isProjectTrusted() as no decision, not as trust (AC-022-3)", async (_label, hostTrust) => {
    const project = makeProject();
    trustProject(project);
    const { pi } = fakePi();
    const { ctx } = fakeCtx({ hostTrust });

    const decision = gateFor(project, pi)(ctx, CREATE_PRD);

    expect(decision).toMatchObject({ active: false, reason: "host-trust-unavailable" });
    expect(await runStartHandlers(decision, project, CREATE_PRD)).toEqual([]);
    expect(ran(project)).toBe("");
  });

  it("treats a non-function isProjectTrusted as no decision", () => {
    const project = makeProject();
    trustProject(project);
    const { pi } = fakePi();
    const { ctx } = fakeCtx({ hostTrustProperty: true });

    expect(gateFor(project, pi)(ctx, CREATE_PRD)).toMatchObject({ reason: "host-trust-unavailable" });
  });

  it("refuses when the host trusts the project but the user has not, and names /ensemble-lifecycle-trust and the hooks file (AC-022-5)", async () => {
    const project = makeProject();
    const { pi } = fakePi();
    const { ctx, notify } = fakeCtx({ hostTrust: true });

    const decision = gateFor(project, pi)(ctx, CREATE_PRD);

    expect(decision).toMatchObject({ active: false, reason: "user-untrusted" });
    expect(await runStartHandlers(decision, project, CREATE_PRD)).toEqual([]);
    expect(ran(project)).toBe("");
    expect(notify).toHaveBeenCalledTimes(1);
    const [message, level] = notify.mock.calls[0];
    expect(level).toBe("warning");
    expect(message).toContain(`/${TRUST_COMMAND_NAME}`);
    expect(message).toContain(HOOKS_FILE_RELATIVE);
  });

  it("warns on every refusal of a selected command, because each is a command that did not run", () => {
    const project = makeProject();
    const { pi } = fakePi();
    const gate = gateFor(project, pi);
    const { ctx, notify } = fakeCtx({ hostTrust: true });

    gate(ctx, CREATE_PRD);
    gate(ctx, CREATE_PRD);
    gate(ctx, CREATE_PRD);

    expect(notify).toHaveBeenCalledTimes(3);
  });

  it("is active, and the start handler runs, when the host and the user both trust the project (AC-006-1, AC-022-2)", async () => {
    const project = makeProject();
    trustProject(project);
    const { pi } = fakePi();
    const { ctx, notify } = fakeCtx({ hostTrust: true });

    const decision = gateFor(project, pi)(ctx, CREATE_PRD);

    expect(decision.active).toBe(true);
    expect(await runStartHandlers(decision, project, CREATE_PRD)).toEqual(["mark:succeeded"]);
    expect(ran(project)).toBe("ran");
    expect(notify).not.toHaveBeenCalled();
    expect(printed).toEqual([]);
  });

  it("evaluates every condition on every call: trust given and then voided changes the next verdict", () => {
    const project = makeProject();
    const { pi } = fakePi();
    const gate = gateFor(project, pi);
    const { ctx } = fakeCtx();

    expect(gate(ctx, CREATE_PRD)).toMatchObject({ reason: "user-untrusted" });
    trustProject(project);
    expect(gate(ctx, CREATE_PRD).active).toBe(true);
    appendFileSync(join(project.root, HOOKS_FILE_RELATIVE), "# edited\n");
    expect(gate(ctx, CREATE_PRD)).toMatchObject({ reason: "user-untrusted" });
  });

  it.each([
    [HOOKS_FILE_RELATIVE, "# edited\n"],
    ["scripts/mark.sh", "# edited\n"],
    ["prompts/review.md", "Also do something else.\n"],
  ])("edit voids trust: editing %s means the next command runs no handler (AC-022-6)", async (file, addition) => {
    const project = makeProject();
    trustProject(project);
    const { pi } = fakePi();
    const gate = gateFor(project, pi);
    const { ctx, notify } = fakeCtx({ hostTrust: true });

    // Trusted as it stands: the handler runs.
    expect(await runStartHandlers(gate(ctx, CREATE_PRD), project, CREATE_PRD)).toEqual(["mark:succeeded"]);
    rmSync(project.marker);

    appendFileSync(join(project.root, file), addition);
    const decision = gate(ctx, CREATE_PRD);

    expect(decision).toMatchObject({ active: false, reason: "user-untrusted" });
    expect(await runStartHandlers(decision, project, CREATE_PRD)).toEqual([]);
    expect(ran(project)).toBe("");
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0]).toContain(`/${TRUST_COMMAND_NAME}`);
  });

  it("voids trust when a file named only as a shell argument is edited", () => {
    const project = makeProject(HOOKS_YAML.replace('["--audit", "two words"]', '["./scripts/data.json"]'));
    writeFileSync(join(project.root, "scripts/data.json"), "{}\n");
    trustProject(project);
    const { pi } = fakePi();
    const gate = gateFor(project, pi);
    const { ctx } = fakeCtx();
    expect(gate(ctx, CREATE_PRD).active).toBe(true);

    writeFileSync(join(project.root, "scripts/data.json"), '{"changed":true}\n');
    expect(gate(ctx, CREATE_PRD)).toMatchObject({ reason: "user-untrusted" });
  });

  it("is not trusted by a record for another project or by a record inside the repository (AC-022-7)", async () => {
    const project = makeProject();
    const other = makeProject();
    trustProject(other);
    const { pi } = fakePi();

    // The other project's record (same store) does not trust this one.
    const sharedStore = createHooksGate(pi, project.root, { storePath: other.storePath });
    expect(sharedStore(fakeCtx().ctx, CREATE_PRD)).toMatchObject({ reason: "user-untrusted" });

    // A repository that ships its own trust data: a store file inside it that holds a valid record.
    const shipped = join(project.root, ".ensemble", "trusted-hooks.json");
    const loaded = loadHooksConfig(project.root, { knownCommands: knownCommandsFromHost(HOST_COMMANDS) });
    if (loaded.status !== "valid") throw new Error("fixture hooks file is not valid");
    const digest = computeHooksDigest(project.root, loaded.config);
    writeFileSync(
      shipped,
      JSON.stringify({ version: 1, projects: { [realpathSync(project.root)]: { digest, trusted_at: new Date().toISOString() } } }),
    );

    // Named as the store, the shipped file is refused outright ...
    const insideGate = createHooksGate(pi, project.root, { storePath: shipped });
    const inside = insideGate(fakeCtx().ctx, CREATE_PRD);
    expect(inside).toMatchObject({ active: false, reason: "user-untrusted" });
    expect(isTrusted(project.root, digest, { storePath: shipped })).toBe(false);
    expect(await runStartHandlers(inside, project, CREATE_PRD)).toEqual([]);

    // ... and with the user's own (empty) home it is simply never read.
    const homeGate = createHooksGate(pi, project.root);
    const viaHome = homeGate(fakeCtx().ctx, CREATE_PRD);
    expect(viaHome).toMatchObject({ active: false, reason: "user-untrusted" });
    expect(await runStartHandlers(viaHome, project, CREATE_PRD)).toEqual([]);
    expect(ran(project)).toBe("");
  });
});

// ---- The trust command (AC-022-8) -----------------------------------------

describe(`/${TRUST_COMMAND_NAME}`, () => {
  function setup(hooksYaml: string | null = HOOKS_YAML) {
    const project = makeProject(hooksYaml);
    const { pi, commands } = fakePi();
    registerLifecycleHooks(pi, project.root, { storePath: project.storePath, now: () => new Date("2026-10-15T12:00:00Z") });
    const command = commands.get(TRUST_COMMAND_NAME);
    if (!command) throw new Error("trust command not registered");
    const gate = gateFor(project, pi);
    return { project, pi, run: command.handler, gate };
  }

  it("records nothing when the user declines, and the next command still runs nothing", async () => {
    const { project, run, gate } = setup();
    const { ctx, notify, confirm } = fakeCtx({ confirm: () => false });

    await run("", ctx);

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(existsSync(project.storePath)).toBe(false);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0]).toContain("Nothing was trusted");
    const decision = gate(fakeCtx().ctx, CREATE_PRD);
    expect(decision).toMatchObject({ active: false, reason: "user-untrusted" });
    expect(await runStartHandlers(decision, project, CREATE_PRD)).toEqual([]);
    expect(ran(project)).toBe("");
  });

  it("records trust when the user confirms, and the next command then runs its handler", async () => {
    const { project, run, gate } = setup();
    const { ctx, notify, confirm } = fakeCtx({ confirm: () => true });

    await run("", ctx);

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(existsSync(project.storePath)).toBe(true);
    expect(JSON.parse(readFileSync(project.storePath, "utf8")).projects).toBeDefined();
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0]).toContain("Trusted the lifecycle hooks");
    const decision = gate(fakeCtx().ctx, CREATE_PRD);
    expect(decision.active).toBe(true);
    expect(await runStartHandlers(decision, project, CREATE_PRD)).toEqual(["mark:succeeded"]);
    expect(ran(project)).toBe("ran");
  });

  it("records trust only after the question has been answered, and for the digest it showed", async () => {
    const { project, run, gate } = setup();
    let storeExistedWhileAsking: boolean | undefined;
    const { ctx } = fakeCtx({
      confirm: () => {
        storeExistedWhileAsking = existsSync(project.storePath);
        // The file changes while the question is open: what was shown is what is recorded, so the new bytes are untrusted.
        appendFileSync(join(project.root, HOOKS_FILE_RELATIVE), "# edited while the question was open\n");
        return true;
      },
    });

    await run("", ctx);

    expect(storeExistedWhileAsking).toBe(false);
    expect(gate(fakeCtx().ctx, CREATE_PRD)).toMatchObject({ active: false, reason: "user-untrusted" });
  });

  it.each([
    ["the string 'true'", "true"],
    ["the string 'yes'", "yes"],
    ["the number 1", 1],
    ["undefined", undefined],
    ["null", null],
    ["a truthy object", { ok: true }],
  ])("records nothing when the confirmation resolves to %s: only exactly true confirms", async (_label, answer) => {
    const { project, run, gate } = setup();
    const { ctx } = fakeCtx({ confirm: () => answer });

    await run("", ctx);

    expect(existsSync(project.storePath)).toBe(false);
    expect(gate(fakeCtx().ctx, CREATE_PRD)).toMatchObject({ reason: "user-untrusted" });
  });

  it("lists every handler with its exact executable and arguments or prompt file in the question (AC-022-8)", async () => {
    const { run } = setup();
    const { ctx, confirm } = fakeCtx({ confirm: () => false });

    await run("", ctx);

    const [title, message] = confirm.mock.calls[0];
    expect(title).toContain("Trust");
    expect(message).toContain('shell mark: ./scripts/mark.sh --audit "two words"');
    expect(message).toContain("prompt review: ./prompts/review.md");
    expect(message).toContain(`command ${CREATE_PRD}: start [mark], end [review]`);
    expect(message).toContain(HOOKS_FILE_RELATIVE);
  });

  it("refuses without a UI, records nothing and never asks", async () => {
    const { project, run } = setup();
    const { ctx, notify, confirm } = fakeCtx({ hasUI: false, confirm: () => true });

    await run("", ctx);

    expect(confirm).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
    expect(existsSync(project.storePath)).toBe(false);
    expect(printed.join("")).toContain(`/${TRUST_COMMAND_NAME}`);
    expect(printed.join("")).toContain("recorded nothing");
  });

  it("shows the failure and does not claim trust when recording fails", async () => {
    const project = makeProject();
    const insideRepository = join(project.root, ".ensemble", "trusted-hooks.json");
    const { pi, commands } = fakePi();
    registerLifecycleHooks(pi, project.root, { storePath: insideRepository });
    const { ctx, notify } = fakeCtx({ confirm: () => true });
    let reason = "";
    try {
      recordTrust(project.root, "sha256:x", { storePath: insideRepository });
    } catch (error) {
      reason = isRecord(error) && typeof error.message === "string" ? error.message : String(error);
    }
    expect(reason).toContain("outside the repository");

    await commands.get(TRUST_COMMAND_NAME)?.handler("", ctx);

    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(`Could not record trust: ${reason}`, "error");
    expect(existsSync(insideRepository)).toBe(false);
    expect(gateFor({ ...project, storePath: insideRepository }, pi)(fakeCtx().ctx, CREATE_PRD)).toMatchObject({
      reason: "user-untrusted",
    });
  });

  it("says there is nothing to trust, and asks nothing, when the hooks file has gone", async () => {
    const { project, run } = setup();
    rmSync(join(project.root, HOOKS_FILE_RELATIVE));
    const { ctx, notify, confirm } = fakeCtx({ confirm: () => true });

    await run("", ctx);

    expect(confirm).not.toHaveBeenCalled();
    expect(existsSync(project.storePath)).toBe(false);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0]).toContain(HOOKS_FILE_RELATIVE);
    expect(notify.mock.calls[0][0]).toContain("nothing to trust");
  });

  it("trusts nothing, and asks nothing, when the hooks file is invalid", async () => {
    const { project, run } = setup();
    writeFileSync(join(project.root, HOOKS_FILE_RELATIVE), HOOKS_YAML.replace("on_error: continue", "on_error: maybe"));
    const { ctx, notify, confirm } = fakeCtx({ confirm: () => true });

    await run("", ctx);

    expect(confirm).not.toHaveBeenCalled();
    expect(existsSync(project.storePath)).toBe(false);
    expect(notify).toHaveBeenCalledTimes(1);
    const [message, level] = notify.mock.calls[0];
    expect(level).toBe("error");
    expect(message).toContain("Nothing was trusted");
    expect(message).toContain("on_error");
  });

  it("trusts nothing when the file selects a command the host does not report", async () => {
    const { project, run } = setup(HOOKS_YAML.replace(CREATE_PRD, "ensemble:no-such-command"));
    const { ctx, notify, confirm } = fakeCtx({ confirm: () => true });

    await run("", ctx);

    expect(confirm).not.toHaveBeenCalled();
    expect(existsSync(project.storePath)).toBe(false);
    expect(notify.mock.calls[0][0]).toContain("ensemble:no-such-command");
  });

  it("never starts a handler itself, trusted or not", async () => {
    const { project, run } = setup();

    await run("", fakeCtx({ confirm: () => true }).ctx);
    await run("", fakeCtx({ confirm: () => false }).ctx);

    expect(ran(project)).toBe("");
  });
});

// ---- knownCommandsFromHost --------------------------------------------------

describe("knownCommandsFromHost", () => {
  it("names prompt templates, skills and dispatchers as hooks files name commands, and ignores the rest", () => {
    const known = knownCommandsFromHost([
      { name: "ensemble-create-prd" },
      { name: "skill:ensemble-refine-prd" },
      { name: "ensemble-prd" },
      { name: "hooks-reload" },
      { name: "skill:other" },
      { name: "model" },
    ]);

    expect([...known].sort()).toEqual(["ensemble:create-prd", "ensemble:prd", "ensemble:refine-prd"]);
  });
});
