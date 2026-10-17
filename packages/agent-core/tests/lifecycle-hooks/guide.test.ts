/**
 * Keeps docs/guides/command-lifecycle-hooks.md true (TRD-016-TEST).
 * (docs/TRD/TRD-2026-f08a2a09-command-lifecycle-hooks.md#trd-016-test)
 *
 * PRD ACs: AC-005-3, AC-016-1, AC-016-2, AC-018-1, AC-018-2.
 *
 * The guide is read from the repository root, relative to this file. What it
 * states is compared to the code constants it quotes, so editing either side
 * alone fails a test here.
 *
 * Convention for YAML examples: every ```yaml block is validated as a whole
 * hooks file through the real validator, except a block whose first line is a
 * comment starting `# fragment`. That marker says "this block is a piece of a
 * file, not a file" and is the only way a block is skipped.
 *
 * The checkers are plain functions so the "sanity" tests can run them on
 * deliberately broken copies of the guide and see them fail.
 */

import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";
import {
  CAPABILITY_NAMES,
  HARNESS_CAPABILITIES,
  HARNESS_NAMES,
  HarnessCapabilities,
  HarnessName,
} from "../../src/lifecycle-hooks/capabilities";
import { HOOKS_FILE_RELATIVE, validateHooksConfig } from "../../src/lifecycle-hooks/config";
import {
  SECRET_PATTERNS,
  SENSITIVE_VARIABLE_NAMES,
  buildEndEvent,
  buildStartEvent,
  redactText,
  serializeEvent,
} from "../../src/lifecycle-hooks/payload";
import { parsePromptResponse } from "../../src/lifecycle-hooks/prompt-runner";
import { SHELL_ENV_ALLOWLIST, SHELL_OUTPUT_BOUND_BYTES } from "../../src/lifecycle-hooks/shell-runner";
import { DEFAULT_PROMPT_TIMEOUT_MS, DEFAULT_SHELL_TIMEOUT_MS } from "../../src/lifecycle-hooks/types";

/** tests/lifecycle-hooks -> agent-core/tests -> agent-core -> packages -> repository root. */
const GUIDE_PATH = path.resolve(__dirname, "../../../../docs/guides/command-lifecycle-hooks.md");

const guide = fs.readFileSync(GUIDE_PATH, "utf8");

// ---------------------------------------------------------------------------
// Helpers (pure; the sanity tests feed them broken copies of the guide)
// ---------------------------------------------------------------------------

interface CodeBlock {
  text: string;
  /** 1-based line of the opening fence. */
  line: number;
}

/** Every fenced block whose info string is exactly `lang`. */
function fencedBlocks(markdown: string, lang: string): CodeBlock[] {
  const blocks: CodeBlock[] = [];
  const lines = markdown.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() !== "```" + lang) continue;
    const body: string[] = [];
    let j = i + 1;
    while (j < lines.length && lines[j].trim() !== "```") body.push(lines[j++]);
    blocks.push({ text: body.join("\n"), line: i + 1 });
    i = j;
  }
  return blocks;
}

const FRAGMENT_MARKER = /^\s*#\s*fragment\b/;

/** Errors the real validator reports for one example, or [] when it validates. */
function exampleErrors(text: string): string[] {
  let parsed: unknown;
  try {
    parsed = yaml.load(text);
  } catch (error) {
    return [`does not parse: ${(error as Error).message}`];
  }
  // The example files do not exist on disk; the file-existence check is the only part replaced.
  const result = validateHooksConfig(parsed, { projectRoot: "/virtual/project", fileExists: () => true });
  return result.ok ? [] : result.errors.map((e) => `${e.path}: ${e.message}`);
}

/** The body of the section whose heading line is exactly `heading`, up to the next heading of the same or a higher level. */
function section(markdown: string, heading: string): string {
  const lines = markdown.split("\n");
  const start = lines.findIndex((l) => l.trim() === heading);
  if (start === -1) return "";
  const level = heading.match(/^#+/)?.[0].length ?? 1;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const m = lines[i].match(/^(#+)\s/);
    if (m && m[1].length <= level) {
      end = i;
      break;
    }
  }
  return lines.slice(start + 1, end).join("\n");
}

function tableCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

/** Differences between the guide's capability table and the capability constants; [] when they agree. */
function capabilityTableDiffs(
  markdown: string,
  table: Readonly<Record<HarnessName, Readonly<HarnessCapabilities>>> = HARNESS_CAPABILITIES,
): string[] {
  const lines = markdown.split("\n");
  const header = lines.findIndex((l) => /^\|\s*harness\s*\|\s*adapter\s*\|/.test(l));
  if (header === -1) return ["no capability table (a table whose header starts `harness | adapter`) in the guide"];

  const diffs: string[] = [];
  const expectedHeader = ["harness", "adapter", ...CAPABILITY_NAMES];
  const actualHeader = tableCells(lines[header]);
  if (actualHeader.join(",") !== expectedHeader.join(",")) {
    diffs.push(`columns are [${actualHeader}], the code has [${expectedHeader}]`);
  }

  const rows = new Map<string, string[]>();
  for (let i = header + 2; i < lines.length && lines[i].trim().startsWith("|"); i++) {
    const cells = tableCells(lines[i]);
    rows.set(cells[0], cells.slice(1));
  }
  for (const name of HARNESS_NAMES) {
    const row = rows.get(name);
    if (!row) {
      diffs.push(`harness ${name} has no row`);
      continue;
    }
    const expected = [
      table[name].adapter ? "yes" : "no",
      ...CAPABILITY_NAMES.map((capability) => (table[name][capability] ? "true" : "false")),
    ];
    expected.forEach((value, column) => {
      if (row[column] !== value) diffs.push(`${name} ${expectedHeader[column + 1]}: guide says ${row[column]}, code says ${value}`);
    });
  }
  for (const name of rows.keys()) {
    if (!HARNESS_NAMES.includes(name as HarnessName)) diffs.push(`the guide lists harness ${name}, the code does not`);
  }
  return diffs;
}

/** How far on either side of "best-effort" the word "deterministic" is forbidden. */
const OVERCLAIM_WINDOW_CHARS = 300;

/** Places where a best-effort path is written within reach of the word deterministic. */
function overclaims(markdown: string): string[] {
  const found: string[] = [];
  for (const match of markdown.matchAll(/best[\s-]?effort/gi)) {
    const at = match.index ?? 0;
    const window = markdown.slice(Math.max(0, at - OVERCLAIM_WINDOW_CHARS), at + match[0].length + OVERCLAIM_WINDOW_CHARS);
    if (/deterministic/i.test(window)) found.push(`"deterministic" within ${OVERCLAIM_WINDOW_CHARS} characters of best-effort at offset ${at}`);
  }
  return found;
}

const DIFFERENCE_AXES = ["Scope", "File location", "Trust", "Blocking"] as const;

/** What the guide must say about pi-yaml-hooks; [] when it says it. */
function relationshipGaps(markdown: string): string[] {
  const gaps: string[] = [];
  if (!markdown.includes("`pi-yaml-hooks`")) gaps.push("does not name `pi-yaml-hooks`");
  const body = section(markdown, "## How this differs from pi-yaml-hooks");
  if (body === "") gaps.push("has no section on how it differs from pi-yaml-hooks");
  for (const axis of DIFFERENCE_AXES) {
    if (!new RegExp(`^\\|\\s*${axis}\\s*\\|`, "m").test(body)) gaps.push(`does not compare ${axis}`);
  }
  if (!/both can be installed together/i.test(body)) gaps.push("does not say both can be installed together");
  return gaps;
}

/** The `Before | After` rows of the redaction examples table. */
function redactionRows(markdown: string): Array<[string, string]> {
  const rows: Array<[string, string]> = [];
  for (const line of section(markdown, "## Redaction").split("\n")) {
    const m = line.match(/^\| `(.+)` \| `(.+)` \|$/);
    if (m) rows.push([m[1], m[2]]);
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("command lifecycle hooks guide", () => {
  describe("examples validate (AC-018-2)", () => {
    const blocks = fencedBlocks(guide, "yaml");
    const fragments = blocks.filter((b) => FRAGMENT_MARKER.test(b.text.split("\n", 1)[0]));
    const whole = blocks.filter((b) => !fragments.includes(b));

    it("has full hooks-file examples, and a fragment that is marked as one", () => {
      expect(whole.length).toBeGreaterThanOrEqual(3);
      expect(fragments.length).toBeGreaterThanOrEqual(1);
    });

    it.each(whole.map((b) => [`line ${b.line}`, b] as const))("the YAML example at %s is accepted by the validator", (_label, block) => {
      expect(exampleErrors(block.text)).toEqual([]);
    });

    it("shows both handler types and a blocking start handler across its examples", () => {
      const configs = whole.map((b) => yaml.load(b.text) as { hooks: Record<string, { type: string; on_error: string }> });
      const handlers = configs.flatMap((c) => Object.values(c.hooks));
      expect(handlers.some((h) => h.type === "shell")).toBe(true);
      expect(handlers.some((h) => h.type === "prompt")).toBe(true);
      expect(handlers.some((h) => h.on_error === "block")).toBe(true);
    });

    it("names the hooks file the validator loads", () => {
      expect(guide).toContain("`" + HOOKS_FILE_RELATIVE + "`");
    });

    it("sanity: the validator check fails on a broken example", () => {
      const valid = whole[0].text;
      expect(exampleErrors(valid)).toEqual([]);
      expect(exampleErrors(valid.replace(/^\s*on_error:.*\n/m, "")).join("\n")).toContain("on_error");
      expect(exampleErrors(valid.replace("version: 1", "version: 2")).join("\n")).toContain("version");
      expect(exampleErrors(valid.replace("type: shell", "type: powershell")).join("\n")).toContain("type");
      expect(exampleErrors(valid.replace(/^commands:[\s\S]*$/m, "")).join("\n")).toContain("commands");
    });
  });

  describe("payload (AC-005-3, AC-018-1)", () => {
    const sample = {
      run_id: "run-1",
      command: "ensemble:create-prd",
      arguments: "x",
      cwd: "/p",
      session_id: "s",
      timestamp: "2026-10-15T00:00:00.000Z",
    };
    const startKeys = Object.keys(JSON.parse(serializeEvent(buildStartEvent(sample))));
    const endKeys = Object.keys(
      JSON.parse(
        serializeEvent(
          buildEndEvent({ ...sample, outcome: "succeeded", duration_ms: 1, reason: "r", artifacts: ["a"], summary: "s" }),
        ),
      ),
    );
    const requiredEndKeys = Object.keys(JSON.parse(serializeEvent(buildEndEvent({ ...sample, outcome: "failed", duration_ms: 1 }))));

    /** `keys` appear in `full`'s order and include everything in `required`. */
    function keysFit(keys: string[], full: string[], required: string[]): boolean {
      const positions = keys.map((k) => full.indexOf(k));
      return positions.every((p) => p >= 0) && positions.every((p, i) => i === 0 || p > positions[i - 1]) && required.every((k) => keys.includes(k));
    }

    const events = fencedBlocks(guide, "json")
      .map((b) => ({ block: b, value: JSON.parse(b.text) as Record<string, unknown> }))
      .filter(({ value }) => "event" in value);

    it("documents both events, each with an example payload that has the keys and order the code serializes", () => {
      expect(guide).toContain("`command.start`");
      expect(guide).toContain("`command.end`");
      const start = events.filter(({ value }) => value.event === "command.start");
      const end = events.filter(({ value }) => value.event === "command.end");
      expect(start.length).toBeGreaterThanOrEqual(1);
      expect(end.length).toBeGreaterThanOrEqual(1);
      for (const { block, value } of start) {
        expect({ line: block.line, ok: keysFit(Object.keys(value), startKeys, startKeys) }).toEqual({ line: block.line, ok: true });
      }
      for (const { block, value } of end) {
        expect({ line: block.line, ok: keysFit(Object.keys(value), endKeys, requiredEndKeys) }).toEqual({ line: block.line, ok: true });
      }
    });

    it("lists every payload field in its field table", () => {
      const fields = section(guide, "## The two events and their payload");
      for (const key of endKeys) expect(fields).toMatch(new RegExp("^\\| `" + key + "` \\|", "m"));
    });

    it("shows no secret in an example: every free-text value is unchanged by the redactor", () => {
      for (const { value } of events) {
        for (const key of ["arguments", "reason", "summary"]) {
          if (typeof value[key] === "string") expect(redactText(value[key] as string)).toBe(value[key]);
        }
        if (Array.isArray(value.artifacts)) for (const a of value.artifacts) expect(redactText(String(a))).toBe(a);
      }
    });

    it("states which fields are redacted: the free-text ones, and not command, cwd or session_id", () => {
      const fields = section(guide, "## The two events and their payload");
      expect(fields).toContain("`command`, `cwd` and `session_id` are not redacted");
      expect(fields).toContain("`arguments`, `reason`, `summary` and each `artifacts` entry");
      // The code agrees: only those four are touched.
      const marked = buildEndEvent({
        run_id: "password=a",
        command: "ensemble:password=a",
        arguments: "password=a",
        cwd: "/password=a",
        session_id: "password=a",
        timestamp: "t",
        outcome: "failed",
        duration_ms: 1,
        reason: "password=a",
        artifacts: ["password=a"],
        summary: "password=a",
      });
      expect([marked.arguments, marked.reason, marked.summary, marked.artifacts?.[0]]).toEqual(Array(4).fill("password=[REDACTED]"));
      expect([marked.command, marked.cwd, marked.session_id]).toEqual(["ensemble:password=a", "/password=a", "password=a"]);
    });
  });

  describe("redaction (AC-005-3)", () => {
    const body = section(guide, "## Redaction");

    it("every example row is what the real redactor produces", () => {
      const rows = redactionRows(guide);
      expect(rows.length).toBeGreaterThanOrEqual(6);
      for (const [before, after] of rows) expect({ before, got: redactText(before) }).toEqual({ before, got: after });
    });

    it("includes rows that show text left alone as well as text replaced", () => {
      const rows = redactionRows(guide);
      expect(rows.some(([before, after]) => before === after)).toBe(true);
      expect(rows.some(([before, after]) => before !== after)).toBe(true);
    });

    it("names every secret pattern, in the order the code applies them", () => {
      const patterns = section(guide, "### Secret patterns");
      let from = 0;
      for (const { name } of SECRET_PATTERNS) {
        const at = patterns.indexOf("| `" + name + "` |", from);
        expect({ name, found: at >= 0 }).toEqual({ name, found: true });
        from = at + 1;
      }
      const documented = [...patterns.matchAll(/^\| `([a-z0-9-]+)` \|/gm)].map((m) => m[1]);
      expect(documented).toEqual(SECRET_PATTERNS.map((p) => p.name));
    });

    it("lists exactly the sensitive variable names the code uses, in order", () => {
      const names = [...section(guide, "### Sensitive variable names").matchAll(/^- `([^`]+)`$/gm)].map((m) => m[1]);
      expect(names).toEqual([...SENSITIVE_VARIABLE_NAMES]);
    });

    it("states the limits of redaction plainly", () => {
      const limits = section(guide, "### What redaction does not promise");
      expect(limits).toMatch(/pattern-based/);
      expect(limits).toMatch(/bare 40-hex secret/);
      expect(limits).toMatch(/long path can be redacted by mistake/);
      expect(body).toContain("[REDACTED]");
    });
  });

  describe("handlers: defaults, bounds and the response contract (AC-018-1)", () => {
    it("states the default timeouts and output bound the code uses", () => {
      const limits = section(guide, "## Timeouts and output bound");
      expect(limits).toContain(`| Default shell handler timeout | ${DEFAULT_SHELL_TIMEOUT_MS} ms |`);
      expect(limits).toContain(`| Default prompt handler timeout | ${DEFAULT_PROMPT_TIMEOUT_MS} ms |`);
      expect(limits).toContain(`${SHELL_OUTPUT_BOUND_BYTES / 1024} KiB (${SHELL_OUTPUT_BOUND_BYTES} bytes)`);
    });

    it("names every environment variable a shell handler can see", () => {
      const shell = section(guide, "## Shell handlers");
      for (const name of SHELL_ENV_ALLOWLIST) expect(shell).toContain("`" + name + "`");
    });

    it("shows a prompt response the real parser accepts", () => {
      const responses = fencedBlocks(guide, "json").filter((b) => "continue" in (JSON.parse(b.text) as Record<string, unknown>));
      expect(responses.length).toBeGreaterThanOrEqual(1);
      for (const block of responses) expect(parsePromptResponse(block.text)).toMatchObject({ ok: true });
    });

    it("documents the exit and error semantics", () => {
      const semantics = section(guide, "## Exit and error semantics");
      for (const status of ["succeeded", "failed", "timed_out", "blocked"]) expect(semantics).toContain("`" + status + "`");
      expect(semantics).toContain("`on_error`");
      expect(semantics).toMatch(/Not allowed; the validator rejects it/);
      expect(semantics).toMatch(/nothing retries it/);
    });

    it("describes how to write a prompt handler", () => {
      const prompt = section(guide, "## Prompt handlers");
      expect(prompt).toMatch(/Tips for writing a prompt handler/);
      expect(prompt).toContain("`continue`");
      expect(prompt).toContain("`findings`");
    });
  });

  describe("trust (REQ-022, AC-018-1)", () => {
    const trust = section(guide, "## Trust");

    it("states the two conditions, the command, and where the record lives", () => {
      expect(trust).toContain("`/ensemble-lifecycle-trust`");
      expect(trust).toContain("`~/.ensemble/trusted-hooks.json`");
      expect(trust).toMatch(/host trusts the project/);
      expect(trust).toMatch(/SHA-256 digest/);
    });

    it("states the honesty points: a model with file tools could write a record, a project containing the store, an upgraded interpreter, args files", () => {
      expect(trust).toMatch(/model with general file tools can grant trust/);
      expect(trust).toMatch(/holds against the extension's own tools only/);
      expect(trust).toMatch(/project that contains the store can never be trusted/);
      expect(trust).toMatch(/rooted at your home directory/);
      expect(trust).toMatch(/Upgrading an interpreter voids trust/);
      expect(trust).toContain("/opt/homebrew/bin/node");
      expect(trust).toMatch(/resolves to a regular file/);
      expect(trust).toMatch(/voids its own trust/);
    });

    it("says the status check is a script and not a slash command", () => {
      const status = section(guide, "## The status check");
      expect(status).toContain("hooks-status.mjs");
      expect(status).toMatch(/is a script, not a slash command/);
    });
  });

  describe("table matches code (AC-018-1)", () => {
    it("the guide's capability table agrees with the capability constants for every harness and capability", () => {
      expect(capabilityTableDiffs(guide)).toEqual([]);
    });

    it("says hooks are inactive in every harness without an adapter, and that Pi is the only supported one", () => {
      const adapterless = HARNESS_NAMES.filter((name) => !HARNESS_CAPABILITIES[name].adapter);
      expect(adapterless.length).toBeGreaterThan(0);
      expect(guide).toContain(`Lifecycle hooks are not active in ${adapterless.join(", ")}`);
      expect(guide).toContain("**Pi is the only supported harness.**");
      expect(HARNESS_NAMES.filter((name) => HARNESS_CAPABILITIES[name].adapter)).toEqual(["pi"]);
    });

    it("sanity: editing any cell of the table, or its rows, is detected", () => {
      const lines = guide.split("\n");
      const header = lines.findIndex((l) => /^\|\s*harness\s*\|\s*adapter\s*\|/.test(l));
      expect(capabilityTableDiffs(guide)).toEqual([]);

      let mutants = 0;
      HARNESS_NAMES.forEach((name, rowIndex) => {
        const row = header + 2 + rowIndex;
        const cells = tableCells(lines[row]);
        expect(cells[0]).toBe(name);
        for (let column = 1; column < cells.length; column++) {
          const flipped = [...cells];
          flipped[column] = ["yes", "true"].includes(cells[column]) ? (column === 1 ? "no" : "false") : column === 1 ? "yes" : "true";
          const mutant = [...lines];
          mutant[row] = `| ${flipped.join(" | ")} |`;
          expect({ name, column, detected: capabilityTableDiffs(mutant.join("\n")).length > 0 }).toEqual({ name, column, detected: true });
          mutants++;
        }
      });
      expect(mutants).toBe(HARNESS_NAMES.length * (CAPABILITY_NAMES.length + 1));

      const withoutRow = lines.filter((_, i) => i !== header + 2 + HARNESS_NAMES.indexOf("codex"));
      expect(capabilityTableDiffs(withoutRow.join("\n"))).toContain("harness codex has no row");
      expect(capabilityTableDiffs(guide.replace("| opencode |", "| opencode2 |"))).not.toEqual([]);
      expect(capabilityTableDiffs("no table here")).not.toEqual([]);
    });

    it("sanity: the comparison is against the table it is given, so a changed code table is detected too", () => {
      const changed = { ...HARNESS_CAPABILITIES, codex: { ...HARNESS_CAPABILITIES.codex, command_start: true } };
      expect(capabilityTableDiffs(guide, changed)).toContain("codex command_start: guide says false, code says true");
    });
  });

  describe("no overclaim (AC-016-1, AC-016-2)", () => {
    it("labels the best-effort path as best-effort, and never writes it near the word deterministic", () => {
      expect(guide).toMatch(/\*\*best-effort\*\* path/);
      expect(overclaims(guide)).toEqual([]);
    });

    it("states that a best-effort path is not lifecycle hook execution", () => {
      expect(section(guide, "### The best-effort path")).toMatch(/not lifecycle hook execution/);
    });

    it("sanity: the check fires when the word is put next to a best-effort path, in either order and in different casing", () => {
      const prefixed = guide.replace("That is a **best-effort** path", "That is a deterministic, best-effort path");
      expect(prefixed).not.toBe(guide);
      expect(overclaims(prefixed).length).toBeGreaterThan(0);
      expect(overclaims("The best effort path is Deterministic.").length).toBeGreaterThan(0);
      expect(overclaims("It is deterministic. " + "x ".repeat(200) + "The Best-Effort path.")).toEqual([]);
      const inserted = guide.replace("It depends entirely on the model", "It is a deterministic shell hook. It depends entirely on the model");
      expect(inserted).not.toBe(guide);
      expect(overclaims(inserted).length).toBeGreaterThan(0);
    });
  });

  describe("relationship to pi-yaml-hooks stated (TRD v1.0.2)", () => {
    it("names pi-yaml-hooks, compares scope, file location, trust and blocking, and says both can be installed together", () => {
      expect(relationshipGaps(guide)).toEqual([]);
    });

    it("sanity: the check fires when the section, a row, or the sentence is removed", () => {
      const heading = "## How this differs from pi-yaml-hooks";
      const start = guide.indexOf(heading);
      const end = guide.indexOf("\n## ", start + heading.length);
      expect(start).toBeGreaterThan(0);
      const withoutSection = guide.slice(0, start) + guide.slice(end + 1);
      expect(relationshipGaps(withoutSection)).toContain("has no section on how it differs from pi-yaml-hooks");
      expect(relationshipGaps(guide.replace(/^\| Trust \|.*$/m, ""))).toContain("does not compare Trust");
      expect(relationshipGaps(guide.replace("both can be installed together", "they conflict"))).toContain(
        "does not say both can be installed together",
      );
      expect(relationshipGaps(guide.replaceAll("`pi-yaml-hooks`", "the other hook runner"))).toContain("does not name `pi-yaml-hooks`");
    });
  });

  describe("known limits are stated plainly (AC-018-1)", () => {
    const limits = section(guide, "## Known limits");

    it.each([
      ["the completion signal depends on the model", /end signal depends on the model/],
      ["SIGINT in RPC mode runs no handler", /SIGINT in RPC mode runs no handler/],
      ["a handler that starts its own session escapes the group kill", /starts its own session escapes the group kill/],
      ["nothing runs in Claude Code, Codex or OpenCode", /Nothing runs in Claude Code, Codex or OpenCode/],
      ["redaction is pattern-based", /Redaction is pattern-based/],
      ["trust is a file the user owns", /Trust is a file you own/],
    ])("says: %s", (_what, pattern) => {
      expect(limits).toMatch(pattern);
    });
  });
});
