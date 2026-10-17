/**
 * Tests for the hooks status script (TRD-014-TEST).
 * (docs/TRD/TRD-2026-f08a2a09-command-lifecycle-hooks.md#trd-014-test)
 *
 * PRD ACs: AC-014-4, AC-015-5, AC-017-2. The script runs as a real child
 * process against temporary projects; the user's trust store is a temporary
 * file named by ENSEMBLE_HOOKS_TRUST_STORE and HOME is a temporary directory,
 * so nothing here touches the real home directory.
 */

import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { computeHooksDigest, loadHooksConfig, recordTrust } from "@sunstone-partners/ensemble-agent-core";

const SCRIPT = join(__dirname, "..", "scripts", "hooks-status.mjs");
const CORE_CAPABILITIES = join(__dirname, "..", "..", "agent-core", "dist", "lifecycle-hooks", "capabilities.js");

const VALID_HOOKS = [
  "version: 1",
  "hooks:",
  "  audit:",
  "    type: shell",
  "    command: ./scripts/audit.sh",
  "    on_error: continue",
  "commands:",
  "  ensemble:create-prd:",
  "    start: [audit]",
  "    end: [audit]",
  "",
].join("\n");

let workdir: string;
let project: string;
let home: string;
let store: string;
let marker: string;

beforeAll(() => {
  if (!existsSync(CORE_CAPABILITIES)) {
    throw new Error(`agent-core is not built (missing ${CORE_CAPABILITIES}); run: tsc -p ../agent-core`);
  }
});

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), "hooks-status-"));
  project = join(workdir, "project");
  home = join(workdir, "home");
  store = join(workdir, "store", "trusted-hooks.json");
  marker = join(workdir, "handler-ran");
  mkdirSync(project, { recursive: true });
  mkdirSync(home, { recursive: true });
});

afterEach(() => {
  rmSync(workdir, { recursive: true, force: true });
});

/** A project with a valid hooks file whose handler would write `marker` if anything ran it. */
function writeValidProject(): void {
  mkdirSync(join(project, ".ensemble"), { recursive: true });
  mkdirSync(join(project, "scripts"), { recursive: true });
  writeFileSync(join(project, ".ensemble", "hooks.yaml"), VALID_HOOKS);
  writeFileSync(join(project, "scripts", "audit.sh"), `#!/bin/sh\necho ran > "${marker}"\n`);
  chmodSync(join(project, "scripts", "audit.sh"), 0o755);
}

function trustProject(): void {
  const loaded = loadHooksConfig(project);
  if (loaded.status !== "valid") throw new Error(`fixture project is ${loaded.status}`);
  recordTrust(project, computeHooksDigest(project, loaded.config), { storePath: store });
}

interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
}

function runStatus(args: string[], cwd: string = workdir): Run {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd,
    encoding: "utf8",
    env: { PATH: process.env.PATH, HOME: home, ENSEMBLE_HOOKS_TRUST_STORE: store },
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe("hooks status script", () => {
  it("status without a command: prints the table and Pi's end definition (AC-014-4, AC-015-5)", () => {
    const run = runStatus([project]);
    expect(run.status).toBe(0);
    expect(run.stderr).toBe("");
    const lines = run.stdout.split("\n");
    expect(lines[0].trim().split(/\s+/)).toEqual([
      "harness",
      "adapter",
      "command_start",
      "command_end",
      "command_end_on_cancel",
    ]);
    const cells = (harness: string): string[] =>
      (lines.find((l) => l.startsWith(harness + " ")) ?? "").trim().split(/\s+/).slice(1);
    expect(cells("pi")).toEqual(["yes", "true", "true", "true"]);
    for (const harness of ["claude-code", "codex", "opencode"]) {
      expect(cells(harness)).toEqual(["no", "false", "false", "false"]);
    }
    expect(run.stdout).toMatch(/Pi command end: .*completion signal.*error outcome.*abort signal.*session shutdown/);
  });

  it("says hooks are inactive in harnesses with no adapter (AC-017-2)", () => {
    const run = runStatus([project]);
    expect(run.stdout).toContain("not active in claude-code, codex, opencode");
    expect(run.stdout).toContain("nothing is shown when a command runs");
    expect(run.stdout).toMatch(/Harnesses with no adapter .*inactive there/);
  });

  it("absent file: says so and exits 0", () => {
    const run = runStatus([project]);
    expect(run.status).toBe(0);
    expect(run.stdout).toContain(`Project: ${project}`);
    expect(run.stdout).toMatch(/\.ensemble\/hooks\.yaml is absent\. No hooks are configured/);
  });

  it("uses the working directory when no project root is given", () => {
    writeValidProject();
    const run = runStatus([], project);
    expect(run.stdout).toContain("is valid (1 hook(s), 1 command selection(s))");
  });

  it("invalid file: prints each error, says no hooks run, and exits 1", () => {
    mkdirSync(join(project, ".ensemble"));
    writeFileSync(
      join(project, ".ensemble", "hooks.yaml"),
      "version: 1\nhooks:\n  audit:\n    type: shell\n    command: ./missing.sh\n    on_error: maybe\ncommands: {}\n",
    );
    const run = runStatus([project]);
    expect(run.status).toBe(1);
    expect(run.stdout).toMatch(/is invalid, so no hooks run until it is fixed\. \d+ error\(s\):/);
    expect(run.stdout).toContain("hooks.audit.on_error");
    expect(run.stdout).toContain("hooks.audit.command");
  });

  it("valid file the user has not trusted: reports not trusted and how to trust it", () => {
    writeValidProject();
    const run = runStatus([project]);
    expect(run.status).toBe(0);
    expect(run.stdout).toContain("is valid (1 hook(s), 1 command selection(s))");
    expect(run.stdout).toContain("User trust: NOT trusted");
    expect(run.stdout).toContain("/ensemble-lifecycle-trust");
    expect(run.stdout).toContain("cannot be known outside Pi");
  });

  it("valid file the user has trusted: reports trusted, and that host trust is not known outside Pi", () => {
    writeValidProject();
    trustProject();
    const run = runStatus([project]);
    expect(run.status).toBe(0);
    expect(run.stdout).toContain("User trust: trusted,");
    expect(run.stdout).not.toContain("NOT trusted");
    expect(run.stdout).toContain("cannot be known outside Pi");
    expect(run.stdout).toContain("Capability warnings for Pi: none.");
  });

  it("a handler file changed after the user trusted the project is reported as not trusted", () => {
    writeValidProject();
    trustProject();
    writeFileSync(join(project, "scripts", "audit.sh"), `#!/bin/sh\necho changed > "${marker}"\n`);
    const run = runStatus([project]);
    expect(run.stdout).toContain("User trust: NOT trusted");
  });

  it("runs no handler, whatever the trust state", () => {
    writeValidProject();
    runStatus([project]);
    trustProject();
    runStatus([project]);
    expect(existsSync(marker)).toBe(false);
  });

  it("reads the trust store named by ENSEMBLE_HOOKS_TRUST_STORE and writes nothing to the home directory", () => {
    writeValidProject();
    trustProject();
    expect(runStatus([project]).stdout).toContain("User trust: trusted,");
    // Same project, a store that holds no record: not trusted.
    const other = spawnSync(process.execPath, [SCRIPT, project], {
      cwd: workdir,
      encoding: "utf8",
      env: { PATH: process.env.PATH, HOME: home, ENSEMBLE_HOOKS_TRUST_STORE: join(workdir, "empty", "store.json") },
    });
    expect(other.stdout).toContain("User trust: NOT trusted");
    expect(existsSync(join(home, ".ensemble"))).toBe(false);
  });

  it("is a script only: it registers no slash command, so no /hooks-* name can collide with pi-yaml-hooks", () => {
    const source = readFileSync(SCRIPT, "utf8");
    expect(source).not.toMatch(/\bregister(Command|Tool)\b/);
    expect(source).not.toMatch(/@earendil-works\/pi-coding-agent/);
  });
});
