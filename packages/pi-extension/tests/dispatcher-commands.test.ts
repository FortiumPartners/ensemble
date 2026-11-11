import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadDispatchSubcommands, parseSubcommandsSection, registerDispatcherCommand } from "../src/dispatcher-commands";
import { dispatcherSkill, subcommandBullet } from "./helpers/dispatcher-skill";

/**
 * /ensemble-prd, /ensemble-trd, /ensemble-issue's native completion layer.
 *
 * This extension loads in every repo the host opens (it is installed
 * globally, not scoped to this monorepo), so the no-op-when-absent behavior
 * is exercised as deliberately as the present-and-working path -- an
 * unrelated repo must never see these commands just because the extension
 * loaded there.
 */

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

function fixtureRepo(skillRelPath: string, skillContent: string | null): string {
  const root = mkdtempSync(join(tmpdir(), "dispatcher-cmd-"));
  dirs.push(root);
  if (skillContent !== null) {
    mkdirSync(join(root, ...skillRelPath.split("/").slice(0, -1)), { recursive: true });
    writeFileSync(join(root, skillRelPath), skillContent);
  }
  return root;
}

const ISSUE_SKILL = dispatcherSkill("issue", [
  { keyword: "fix", ref: "fix-issue", description: "Fix a bug or small issue end to end" },
  { keyword: "list", ref: "list-issue", description: "List open Beads issues via br/bv" },
]);

describe("parseSubcommandsSection", () => {
  it("reads one entry per bullet, in file order, keeping keyword, ref and description", () => {
    expect(parseSubcommandsSection(ISSUE_SKILL)).toEqual([
      { keyword: "fix", ref: "fix-issue", description: "Fix a bug or small issue end to end" },
      { keyword: "list", ref: "list-issue", description: "List open Beads issues via br/bv" },
    ]);
  });

  it("ignores bullets outside the Subcommands section, even ones shaped like subcommand bullets", () => {
    const text = [
      "- **`early`** - before the section. Invoke `/ensemble:early` directly.",
      "## Subcommands",
      subcommandBullet({ keyword: "fix", ref: "fix-issue", description: "Fix it" }),
      "## Workflow",
      subcommandBullet({ keyword: "late", ref: "late-issue", description: "After the section" }),
    ].join("\n");
    expect(parseSubcommandsSection(text).map((s) => s.keyword)).toEqual(["fix"]);
  });

  it("keeps a description that itself contains periods, dashes and backticks", () => {
    const text = [
      "## Subcommands",
      subcommandBullet({
        keyword: "create",
        ref: "create-trd",
        description: "Create a TRD (add --parser-tables for a `Foreman-native` v1.2 table. No adversarial phase)",
      }),
    ].join("\n");
    expect(parseSubcommandsSection(text)).toEqual([
      {
        keyword: "create",
        ref: "create-trd",
        description: "Create a TRD (add --parser-tables for a `Foreman-native` v1.2 table. No adversarial phase)",
      },
    ]);
  });

  it("skips lines in the section that are not subcommand bullets, and reads CRLF files", () => {
    const text = ["## Subcommands", "", "Some prose.", "- plain bullet", subcommandBullet({ keyword: "fix", ref: "fix-issue", description: "Fix it" })].join("\r\n");
    expect(parseSubcommandsSection(text)).toEqual([{ keyword: "fix", ref: "fix-issue", description: "Fix it" }]);
  });

  it("returns an empty array when there is no Subcommands section", () => {
    expect(parseSubcommandsSection("# ensemble:fix-issue\n\n## Workflow\n- step\n")).toEqual([]);
  });
});

describe("loadDispatchSubcommands", () => {
  const SKILL_PATH = "packages/development/skills/ensemble-issue/SKILL.md";

  it("parses the Subcommands bullets from a real skill file", () => {
    const root = fixtureRepo(SKILL_PATH, ISSUE_SKILL);
    expect(loadDispatchSubcommands(root, SKILL_PATH)).toEqual([
      { keyword: "fix", ref: "fix-issue", description: "Fix a bug or small issue end to end" },
      { keyword: "list", ref: "list-issue", description: "List open Beads issues via br/bv" },
    ]);
  });

  it("returns an empty array when the file doesn't exist", () => {
    const root = fixtureRepo(SKILL_PATH, null);
    expect(loadDispatchSubcommands(root, SKILL_PATH)).toEqual([]);
  });

  it("returns an empty array when the skill has no Subcommands section", () => {
    const root = fixtureRepo(SKILL_PATH, "---\nname: ensemble-fix-issue\n---\n\n# ensemble:fix-issue\n");
    expect(loadDispatchSubcommands(root, SKILL_PATH)).toEqual([]);
  });

  it("returns an empty array, not a throw, when the path is a directory rather than a file", () => {
    const root = fixtureRepo(SKILL_PATH, null);
    mkdirSync(join(root, SKILL_PATH), { recursive: true });
    expect(loadDispatchSubcommands(root, SKILL_PATH)).toEqual([]);
  });
});

function harness() {
  const commands = new Map<
    string,
    { description?: string; getArgumentCompletions?: (p: string) => unknown; handler: (a: string, c: unknown) => Promise<void> }
  >();
  const sent: { content: string; options?: unknown }[] = [];
  const pi = {
    registerCommand: (name: string, o: unknown) => commands.set(name, o as never),
    sendUserMessage: (content: unknown, options?: unknown) => {
      sent.push({ content: String(content), options });
    },
  } as unknown as ExtensionAPI;
  return { pi, commands, sent };
}

describe("registerDispatcherCommand", () => {
  const SKILL_PATH = "packages/development/skills/ensemble-issue/SKILL.md";

  it("does not register when the backing skill doesn't exist in this repo", () => {
    const root = fixtureRepo(SKILL_PATH, null);
    const { pi, commands } = harness();
    registerDispatcherCommand(pi, root, {
      name: "ensemble-issue",
      skillRelPath: SKILL_PATH,
      forwardTo: "ensemble:issue",
      description: "d",
    });
    expect(commands.size).toBe(0);
  });

  it("registers with the given name and description when the backing skill exists", () => {
    const root = fixtureRepo(SKILL_PATH, ISSUE_SKILL);
    const { pi, commands } = harness();
    registerDispatcherCommand(pi, root, {
      name: "ensemble-issue",
      skillRelPath: SKILL_PATH,
      forwardTo: "ensemble:issue",
      description: "Dispatch to an issue-management subcommand",
    });
    expect(commands.get("ensemble-issue")?.description).toBe("Dispatch to an issue-management subcommand");
  });

  it("getArgumentCompletions returns every subcommand for an empty prefix, filtered for a partial one", () => {
    const root = fixtureRepo(SKILL_PATH, ISSUE_SKILL);
    const { pi, commands } = harness();
    registerDispatcherCommand(pi, root, {
      name: "ensemble-issue",
      skillRelPath: SKILL_PATH,
      forwardTo: "ensemble:issue",
      description: "d",
    });
    const getArgumentCompletions = commands.get("ensemble-issue")?.getArgumentCompletions as (p: string) => {
      value: string;
      label: string;
      description?: string;
    }[];

    expect(getArgumentCompletions("")).toEqual([
      { value: "fix", label: "fix", description: "Fix a bug or small issue end to end" },
      { value: "list", label: "list", description: "List open Beads issues via br/bv" },
    ]);
    expect(getArgumentCompletions("li")).toEqual([
      { value: "list", label: "list", description: "List open Beads issues via br/bv" },
    ]);
    expect(getArgumentCompletions("zz")).toEqual([]);
  });

  it("handler forwards the typed text verbatim into the colon-named markdown command, with prompt-template expansion on", async () => {
    const root = fixtureRepo(SKILL_PATH, ISSUE_SKILL);
    const { pi, commands, sent } = harness();
    registerDispatcherCommand(pi, root, {
      name: "ensemble-issue",
      skillRelPath: SKILL_PATH,
      forwardTo: "ensemble:issue",
      description: "d",
    });
    const handler = commands.get("ensemble-issue")!.handler;

    await handler("list", {});
    expect(sent).toEqual([{ content: "/ensemble:issue list", options: { expandPromptTemplates: true } }]);
  });

  it("handler forwards with no trailing text when invoked with empty args", async () => {
    const root = fixtureRepo(SKILL_PATH, ISSUE_SKILL);
    const { pi, commands, sent } = harness();
    registerDispatcherCommand(pi, root, {
      name: "ensemble-issue",
      skillRelPath: SKILL_PATH,
      forwardTo: "ensemble:issue",
      description: "d",
    });
    const handler = commands.get("ensemble-issue")!.handler;

    await handler("   ", {});
    expect(sent).toEqual([{ content: "/ensemble:issue", options: { expandPromptTemplates: true } }]);
  });

});
