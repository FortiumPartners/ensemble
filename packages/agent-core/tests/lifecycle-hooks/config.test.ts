/**
 * Tests for the hooks configuration validator (TRD-002-TEST).
 * (docs/TRD/TRD-2026-f08a2a09-command-lifecycle-hooks.md#trd-002-test)
 *
 * PRD ACs: AC-006-1..4, AC-007-1,2,3,5, AC-009-5, AC-010-3,4, AC-011-5.
 */

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { loadHooksConfig, validateHooksConfig, ValidateResult } from "../../src/lifecycle-hooks/config";
import { DEFAULT_PROMPT_TIMEOUT_MS, DEFAULT_SHELL_TIMEOUT_MS } from "../../src/lifecycle-hooks/types";

const PROJECT = "/virtual/project";
const EXISTING_FILES: Record<string, true> = {
  [resolve(PROJECT, "./scripts/audit.sh")]: true,
  [resolve(PROJECT, "./prompts/review.md")]: true,
};
const fileExists = (p: string): boolean => EXISTING_FILES[p] === true;

/** A document that validates; each invalid case below changes exactly one thing. */
function validDoc(): Record<string, any> {
  return {
    version: 1,
    hooks: {
      audit: { type: "shell", command: "./scripts/audit.sh", args: ["--quick"], on_error: "block" },
      review: { type: "prompt", prompt: "./prompts/review.md", on_error: "continue" },
    },
    commands: {
      "ensemble:create-prd": { start: ["audit"], end: ["review"] },
    },
  };
}

function validate(doc: unknown, extra: { knownCommands?: ReadonlySet<string> } = {}): ValidateResult {
  return validateHooksConfig(doc, { projectRoot: PROJECT, fileExists, ...extra });
}

function errorsOf(result: ValidateResult): { path: string; message: string }[] {
  if (result.ok) throw new Error("expected the document to be rejected, but it validated");
  return result.errors;
}

describe("a valid file (AC-006-1, AC-007-5)", () => {
  it("returns the configuration and nothing else", () => {
    const result = validate(validDoc());
    expect(result.ok).toBe(true);
    // Only a success value: no warnings, messages or errors ride along.
    expect(Object.keys(result).sort()).toEqual(["config", "ok"]);
    if (!result.ok) return;
    expect(Object.keys(result.config).sort()).toEqual(["commands", "hooks", "version"]);
    expect(result.config).toEqual({
      version: 1,
      hooks: {
        audit: { type: "shell", command: "./scripts/audit.sh", args: ["--quick"], timeout_ms: 5000, on_error: "block" },
        review: { type: "prompt", prompt: "./prompts/review.md", timeout_ms: 30000, on_error: "continue" },
      },
      commands: { "ensemble:create-prd": { start: ["audit"], end: ["review"] } },
    });
  });

  it("accepts a command that selects only one of start and end", () => {
    const doc = validDoc();
    doc.commands["ensemble:create-prd"] = { end: ["review"] };
    const result = validate(doc);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.config.commands["ensemble:create-prd"]).toEqual({ start: [], end: ["review"] });
  });

  it("accepts a command that is a member of knownCommands", () => {
    expect(validate(validDoc(), { knownCommands: new Set(["ensemble:create-prd"]) }).ok).toBe(true);
  });

  it("keeps a bare-name shell command with no file check", () => {
    const doc = validDoc();
    doc.hooks.audit = { type: "shell", command: "echo", on_error: "continue" };
    const result = validate(doc);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.config.hooks.audit).toMatchObject({ command: "echo", args: [] });
  });
});

describe("defaults (AC-009-5, AC-011-5)", () => {
  it("gives a shell handler 5000 and a prompt handler 30000 when none is stated", () => {
    const doc = validDoc();
    delete doc.hooks.audit.timeout_ms;
    delete doc.hooks.review.timeout_ms;
    const result = validate(doc);
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    expect(result.config.hooks.audit.timeout_ms).toBe(5000);
    expect(result.config.hooks.review.timeout_ms).toBe(30000);
    expect(DEFAULT_SHELL_TIMEOUT_MS).toBe(5000);
    expect(DEFAULT_PROMPT_TIMEOUT_MS).toBe(30000);
  });

  it("keeps a stated timeout instead of the default", () => {
    const doc = validDoc();
    doc.hooks.audit.timeout_ms = 1234;
    doc.hooks.review.timeout_ms = 4321;
    const result = validate(doc);
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    expect(result.config.hooks.audit.timeout_ms).toBe(1234);
    expect(result.config.hooks.review.timeout_ms).toBe(4321);
  });
});

describe("one definition, many commands (AC-006-2)", () => {
  it("uses a single handler definition for every command that names it", () => {
    const doc = validDoc();
    doc.commands["ensemble:create-trd"] = { start: ["audit"], end: ["review"] };
    const result = validate(doc);
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    expect(Object.keys(result.config.hooks).sort()).toEqual(["audit", "review"]);
    expect(result.config.commands["ensemble:create-prd"].start).toEqual(["audit"]);
    expect(result.config.commands["ensemble:create-trd"].start).toEqual(["audit"]);
    // Commands hold handler names only; the definition lives once under `hooks`.
    expect(JSON.stringify(result.config.commands)).not.toContain("scripts/audit.sh");
    expect(JSON.stringify(result.config).split("scripts/audit.sh").length - 1).toBe(1);
  });
});

describe("each invalid case is rejected and names the offender", () => {
  it("handler missing type (AC-007-1)", () => {
    const doc = validDoc();
    delete doc.hooks.audit.type;
    const errors = errorsOf(validate(doc));
    expect(errors.some((e) => e.message.includes("audit") && e.message.includes("type") && e.path === "hooks.audit.type")).toBe(true);
  });

  it("handler with a type other than shell or prompt (AC-007-1)", () => {
    const doc = validDoc();
    doc.hooks.audit.type = "python";
    const errors = errorsOf(validate(doc));
    expect(errors.some((e) => e.message.includes("audit") && e.message.includes("type"))).toBe(true);
  });

  it("handler missing on_error, start (AC-007-1, AC-010-4)", () => {
    const doc = validDoc();
    delete doc.hooks.audit.on_error;
    const errors = errorsOf(validate(doc));
    expect(errors.some((e) => e.message.includes("audit") && e.message.includes("on_error") && e.path === "hooks.audit.on_error")).toBe(true);
  });

  it("handler missing on_error, selected only by an end event (AC-010-4)", () => {
    const doc = validDoc();
    delete doc.hooks.review.on_error;
    const errors = errorsOf(validate(doc));
    expect(errors.some((e) => e.message.includes("review") && e.message.includes("on_error") && e.path === "hooks.review.on_error")).toBe(true);
  });

  it("handler with an on_error that is neither continue nor block (AC-010-4)", () => {
    const doc = validDoc();
    doc.hooks.audit.on_error = "retry";
    const errors = errorsOf(validate(doc));
    expect(errors.some((e) => e.message.includes("audit") && e.message.includes("on_error"))).toBe(true);
  });

  it("no on_error default is silently applied: a file that omits on_error never validates (AC-010-4)", () => {
    const doc = validDoc();
    delete doc.hooks.audit.on_error;
    delete doc.hooks.review.on_error;
    const result = validate(doc);
    expect(result.ok).toBe(false);
    const errors = errorsOf(result);
    expect(errors.filter((e) => e.path.endsWith(".on_error")).map((e) => e.path).sort()).toEqual([
      "hooks.audit.on_error",
      "hooks.review.on_error",
    ]);
  });

  it("command with no event selection (AC-007-1)", () => {
    const doc = validDoc();
    doc.commands["ensemble:create-prd"] = {};
    const errors = errorsOf(validate(doc));
    expect(errors.some((e) => e.message.includes("ensemble:create-prd") && e.message.includes("no event selection"))).toBe(true);
  });

  it("command whose start and end lists are both empty (AC-007-1)", () => {
    const doc = validDoc();
    doc.commands["ensemble:create-prd"] = { start: [], end: [] };
    const errors = errorsOf(validate(doc));
    expect(errors.some((e) => e.message.includes("ensemble:create-prd") && e.message.includes("no event selection"))).toBe(true);
  });

  it("selection referencing an undefined handler names the command and the handler (AC-007-2)", () => {
    const doc = validDoc();
    doc.commands["ensemble:create-prd"] = { start: ["audit", "ghost"] };
    const errors = errorsOf(validate(doc));
    expect(errors.some((e) => e.message.includes("ensemble:create-prd") && e.message.includes("ghost"))).toBe(true);
  });

  it("selection referencing a handler that is an Object.prototype member is unknown (AC-007-2)", () => {
    const doc = validDoc();
    doc.commands["ensemble:create-prd"] = { end: ["toString"] };
    const errors = errorsOf(validate(doc));
    expect(errors.some((e) => e.message.includes("ensemble:create-prd") && e.message.includes("toString"))).toBe(true);
  });

  it("unknown command against the known command set (AC-007-3)", () => {
    const doc = validDoc();
    doc.commands["ensemble:no-such-command"] = { start: ["audit"] };
    const known = new Set(["ensemble:create-prd"]);
    const errors = errorsOf(validate(doc, { knownCommands: known }));
    expect(errors.some((e) => e.message.includes("ensemble:no-such-command") && e.message.includes("unknown command"))).toBe(true);
    expect(errors.some((e) => e.message.includes("ensemble:create-prd"))).toBe(false);
  });

  it.each([
    ["a wildcard", "ensemble:*"],
    ["a partial wildcard", "ensemble:create-*"],
    ["a bare wildcard", "*"],
    ["a group", "ensemble:create-prd,ensemble:create-trd"],
    ["a missing namespace", "create-prd"],
    ["a path-like group", "ensemble/**"],
  ])("%s command entry is rejected as an unknown command (AC-006-4)", (_label, name) => {
    const doc = validDoc();
    doc.commands[name] = { start: ["audit"] };
    const errors = errorsOf(validate(doc));
    expect(errors.some((e) => e.message.includes(name) && e.message.includes("unknown command"))).toBe(true);
  });

  it("wildcard entries are rejected even when knownCommands is not supplied (AC-006-4)", () => {
    const doc = validDoc();
    doc.commands = { "ensemble:*": { start: ["audit"] } };
    expect(validateHooksConfig(doc, { projectRoot: PROJECT, fileExists }).ok).toBe(false);
  });

  it("event name other than start or end (AC-007-3)", () => {
    const doc = validDoc();
    doc.commands["ensemble:create-prd"] = { start: ["audit"], middle: ["review"] };
    const errors = errorsOf(validate(doc));
    expect(errors.some((e) => e.message.includes("ensemble:create-prd") && e.message.includes("middle"))).toBe(true);
  });

  it("the lifecycle event spelling command.start is not an event name (AC-007-3)", () => {
    const doc = validDoc();
    doc.commands["ensemble:create-prd"] = { "command.start": ["audit"] };
    const errors = errorsOf(validate(doc));
    expect(errors.some((e) => e.message.includes("ensemble:create-prd") && e.message.includes("command.start"))).toBe(true);
  });

  it.each([
    ["zero", 0],
    ["negative", -5],
    ["a string", "soon"],
    ["fractional", 1.5],
    ["null", null],
  ])("timeout_ms that is %s is rejected (AC-007-3)", (_label, value) => {
    const doc = validDoc();
    doc.hooks.audit.timeout_ms = value;
    const errors = errorsOf(validate(doc));
    expect(errors.some((e) => e.message.includes("audit") && e.message.includes("timeout_ms") && e.path === "hooks.audit.timeout_ms")).toBe(true);
  });

  it("non-positive timeout on a prompt handler is rejected (AC-007-3)", () => {
    const doc = validDoc();
    doc.hooks.review.timeout_ms = 0;
    const errors = errorsOf(validate(doc));
    expect(errors.some((e) => e.message.includes("review") && e.message.includes("timeout_ms"))).toBe(true);
  });

  it("missing shell handler executable file (AC-007-3)", () => {
    const doc = validDoc();
    doc.hooks.audit.command = "./scripts/absent.sh";
    const errors = errorsOf(validate(doc));
    expect(errors.some((e) => e.message.includes("audit") && e.message.includes("./scripts/absent.sh"))).toBe(true);
  });

  it("missing prompt handler file (AC-007-3)", () => {
    const doc = validDoc();
    doc.hooks.review.prompt = "./prompts/absent.md";
    const errors = errorsOf(validate(doc));
    expect(errors.some((e) => e.message.includes("review") && e.message.includes("./prompts/absent.md"))).toBe(true);
  });

  it("handler files are resolved against the project root (AC-007-3)", () => {
    const seen: string[] = [];
    validateHooksConfig(validDoc(), {
      projectRoot: PROJECT,
      fileExists: (p) => {
        seen.push(p);
        return true;
      },
    });
    expect(seen.sort()).toEqual([resolve(PROJECT, "./prompts/review.md"), resolve(PROJECT, "./scripts/audit.sh")].sort());
  });

  it("shell handler missing its command (AC-007-1)", () => {
    const doc = validDoc();
    delete doc.hooks.audit.command;
    const errors = errorsOf(validate(doc));
    expect(errors.some((e) => e.message.includes("audit") && e.message.includes("command"))).toBe(true);
  });

  it("prompt handler missing its prompt file path (AC-007-1)", () => {
    const doc = validDoc();
    delete doc.hooks.review.prompt;
    const errors = errorsOf(validate(doc));
    expect(errors.some((e) => e.message.includes("review") && e.message.includes("prompt"))).toBe(true);
  });

  it("unknown field on a handler (AC-007-3)", () => {
    const doc = validDoc();
    doc.hooks.audit.retries = 3;
    const errors = errorsOf(validate(doc));
    expect(errors.some((e) => e.message.includes("retries") && e.path === "hooks.audit.retries")).toBe(true);
  });

  it("a field valid for the other handler type is unknown (AC-007-3)", () => {
    const doc = validDoc();
    doc.hooks.review.args = ["x"];
    const errors = errorsOf(validate(doc));
    expect(errors.some((e) => e.path === "hooks.review.args" && e.message.includes("args"))).toBe(true);
  });

  it("unknown top-level field (AC-007-3)", () => {
    const doc = validDoc();
    doc.extras = {};
    const errors = errorsOf(validate(doc));
    expect(errors.some((e) => e.message.includes("extras") && e.path === "extras")).toBe(true);
  });

  it("end handler with on_error block is rejected, naming the command and handler (AC-010-3)", () => {
    const doc = validDoc();
    doc.hooks.review.on_error = "block";
    const errors = errorsOf(validate(doc));
    expect(errors.some((e) => e.message.includes("ensemble:create-prd") && e.message.includes("review") && e.message.includes("block"))).toBe(true);
  });

  it("a block handler selected for both start and end is rejected for the end selection (AC-010-3)", () => {
    const doc = validDoc();
    doc.commands["ensemble:create-prd"] = { start: ["audit"], end: ["audit"] };
    const errors = errorsOf(validate(doc));
    expect(errors.map((e) => e.path)).toEqual(["commands.ensemble:create-prd.end[0]"]);
  });

  it("a block handler selected only for start is accepted (AC-010-3)", () => {
    const doc = validDoc();
    doc.commands["ensemble:create-prd"] = { start: ["audit"] };
    expect(validate(doc).ok).toBe(true);
  });

  it("a document that is not a mapping, or lacks version, hooks or commands", () => {
    expect(validate(null).ok).toBe(false);
    expect(validate("hooks").ok).toBe(false);
    expect(errorsOf(validate({ ...validDoc(), version: 2 })).some((e) => e.path === "version")).toBe(true);
    const noHooks = validDoc();
    delete noHooks.hooks;
    expect(errorsOf(validate(noHooks)).some((e) => e.path === "hooks")).toBe(true);
    const noCommands = validDoc();
    delete noCommands.commands;
    expect(errorsOf(validate(noCommands)).some((e) => e.path === "commands")).toBe(true);
  });

  it("reports every error in a file, not just the first", () => {
    const doc = validDoc();
    delete doc.hooks.audit.type;
    doc.hooks.review.timeout_ms = -1;
    doc.commands["ensemble:*"] = { start: ["audit"] };
    const errors = errorsOf(validate(doc));
    expect(errors.some((e) => e.message.includes("audit"))).toBe(true);
    expect(errors.some((e) => e.message.includes("review"))).toBe(true);
    expect(errors.some((e) => e.message.includes("ensemble:*"))).toBe(true);
  });

  it("a handler that failed its own validation does not add a second error when a command selects it", () => {
    const doc = validDoc();
    delete doc.hooks.audit.on_error;
    const errors = errorsOf(validate(doc));
    expect(errors).toHaveLength(1);
    expect(errors[0].path).toBe("hooks.audit.on_error");
  });
});

describe("loadHooksConfig against a real directory (AC-006-1, AC-007-3, AC-007-5)", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "hooks-config-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function writeHooks(text: string): void {
    mkdirSync(join(root, ".ensemble"), { recursive: true });
    writeFileSync(join(root, ".ensemble", "hooks.yaml"), text);
  }

  it("returns absent when there is no hooks file", () => {
    expect(loadHooksConfig(root)).toEqual({ status: "absent" });
  });

  it("returns absent when .ensemble exists but hooks.yaml does not", () => {
    mkdirSync(join(root, ".ensemble"));
    expect(loadHooksConfig(root)).toEqual({ status: "absent" });
  });

  it("returns invalid for YAML that does not parse", () => {
    writeHooks("version: 1\nhooks: [unterminated\n");
    const result = loadHooksConfig(root);
    expect(result.status).toBe("invalid");
    if (result.status !== "invalid") return;
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].path).toBe(".ensemble/hooks.yaml");
    expect(result.errors[0].message).toContain("could not parse");
  });

  it("returns invalid for an empty file", () => {
    writeHooks("");
    expect(loadHooksConfig(root).status).toBe("invalid");
  });

  it("returns invalid, naming the handler, for a handler whose files are really missing", () => {
    writeHooks(
      [
        "version: 1",
        "hooks:",
        "  review:",
        "    type: prompt",
        "    prompt: ./prompts/missing.md",
        "    on_error: continue",
        "commands:",
        "  ensemble:create-prd:",
        "    end: [review]",
        "",
      ].join("\n"),
    );
    const result = loadHooksConfig(root);
    expect(result.status).toBe("invalid");
    if (result.status !== "invalid") return;
    expect(result.errors.some((e) => e.message.includes("review") && e.message.includes("./prompts/missing.md"))).toBe(true);
  });

  it("returns valid with defaults applied for a real file and real handler files", () => {
    mkdirSync(join(root, "prompts"));
    writeFileSync(join(root, "prompts", "review.md"), "Check the deliverable.\n");
    mkdirSync(join(root, "scripts"));
    writeFileSync(join(root, "scripts", "audit.sh"), "#!/bin/sh\ncat >/dev/null\n");
    writeHooks(
      [
        "version: 1",
        "hooks:",
        "  audit:",
        "    type: shell",
        "    command: ./scripts/audit.sh",
        "    on_error: block",
        "  review:",
        "    type: prompt",
        "    prompt: ./prompts/review.md",
        "    on_error: continue",
        "commands:",
        "  ensemble:create-prd:",
        "    start: [audit]",
        "    end: [review]",
        "  ensemble:create-trd:",
        "    start: [audit]",
        "",
      ].join("\n"),
    );
    const result = loadHooksConfig(root);
    expect(result).toEqual({
      status: "valid",
      config: {
        version: 1,
        hooks: {
          audit: { type: "shell", command: "./scripts/audit.sh", args: [], timeout_ms: 5000, on_error: "block" },
          review: { type: "prompt", prompt: "./prompts/review.md", timeout_ms: 30000, on_error: "continue" },
        },
        commands: {
          "ensemble:create-prd": { start: ["audit"], end: ["review"] },
          "ensemble:create-trd": { start: ["audit"], end: [] },
        },
      },
    });
  });

  it("passes knownCommands through, rejecting an unknown command", () => {
    writeHooks(
      [
        "version: 1",
        "hooks:",
        "  audit: { type: shell, command: echo, on_error: continue }",
        "commands:",
        "  ensemble:no-such-command: { start: [audit] }",
        "",
      ].join("\n"),
    );
    const result = loadHooksConfig(root, { knownCommands: new Set(["ensemble:create-prd"]) });
    expect(result.status).toBe("invalid");
    if (result.status !== "invalid") return;
    expect(result.errors.some((e) => e.message.includes("ensemble:no-such-command"))).toBe(true);
  });
});

describe("commands carry no hook wiring (AC-006-3)", () => {
  const FORBIDDEN = ["hooks.yaml", "command.start"];
  const repoRoot = resolve(__dirname, "../../../..");

  /** Every `packages/<pkg>/commands/*.yaml` under `packagesDir`, read-only. */
  function commandYamlFiles(packagesDir: string): string[] {
    const files: string[] = [];
    for (const pkg of readdirSync(packagesDir, { withFileTypes: true })) {
      if (!pkg.isDirectory()) continue;
      const commandsDir = join(packagesDir, pkg.name, "commands");
      let entries: string[];
      try {
        entries = readdirSync(commandsDir);
      } catch {
        continue;
      }
      for (const entry of entries) if (entry.endsWith(".yaml")) files.push(join(commandsDir, entry));
    }
    return files;
  }

  function filesMentioning(files: string[]): string[] {
    return files.filter((f) => {
      const text = readFileSync(f, "utf8");
      return FORBIDDEN.some((needle) => text.includes(needle));
    });
  }

  it("no command YAML source mentions hooks.yaml or command.start", () => {
    const files = commandYamlFiles(join(repoRoot, "packages"));
    // Guard against a vacuous pass: the sources must actually have been found.
    expect(files.length).toBeGreaterThan(10);
    expect(files.some((f) => f.endsWith(join("commands", "create-prd.yaml")))).toBe(true);
    expect(filesMentioning(files)).toEqual([]);
  });

  it("the scan does detect hook wiring when a command source carries it", () => {
    const tmp = mkdtempSync(join(tmpdir(), "hooks-scan-"));
    try {
      mkdirSync(join(tmp, "pkg", "commands"), { recursive: true });
      writeFileSync(join(tmp, "pkg", "commands", "clean.yaml"), "name: clean\n");
      writeFileSync(join(tmp, "pkg", "commands", "wired.yaml"), "name: wired\nnotes: reads .ensemble/hooks.yaml\n");
      writeFileSync(join(tmp, "pkg", "commands", "event.yaml"), "name: event\nfires: command.start\n");
      const found = filesMentioning(commandYamlFiles(tmp)).map((f) => f.slice(tmp.length + 1)).sort();
      expect(found).toEqual([join("pkg", "commands", "event.yaml"), join("pkg", "commands", "wired.yaml")]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
