import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import activate from "../src/extension";
import { dispatcherSkill } from "./helpers/dispatcher-skill";

/**
 * TRD-018 / TRD-018-TEST: `ensemble-issue` native completion dropdown
 * reflects TRD-017's new `resume`/`status`/`abandon` keywords with zero
 * new registration code.
 *
 * `extension.ts`'s `ensemble-issue` call site (TRD-016/pre-existing) already
 * sources its `getArgumentCompletions` dropdown from
 * the `## Subcommands` bullets of `packages/development/skills/ensemble-issue/SKILL.md` via
 * the generic `registerDispatcherCommand`/`loadDispatchSubcommands`
 * mechanism (proved generically by dispatcher-commands.test.ts, and at this
 * package's `ensemble-feature` call site by
 * feature-command-registration.test.ts). This file is TRD-018's own
 * dedicated proof for the `ensemble-issue` call site: that adding keywords
 * to the skill (TRD-017) is reflected automatically, with no extension.ts
 * change of its own beyond the already-shipped registration.
 */

const ISSUE_SKILL_REL = "packages/development/skills/ensemble-issue/SKILL.md";

const ISSUE_SUBCOMMANDS = [
  { keyword: "fix", ref: "fix-issue", description: "Fix a bug or small issue end to end (analysis, planning, delegated implementation, PR)" },
  { keyword: "list", ref: "list-issue", description: "List open Beads issues via br/bv for triage" },
  { keyword: "resume", ref: "fix-issue", description: "Resume the project's active/paused issue run from its last recorded checkpoint" },
  { keyword: "status", ref: "fix-issue", description: "Show the active/most-recent issue run's stage, outcome, and references without advancing it (read-only)" },
  { keyword: "abandon", ref: "fix-issue", description: "Abandon the project's active/paused issue run after explicit confirmation" },
];
const ISSUE_SKILL = dispatcherSkill("issue", ISSUE_SUBCOMMANDS);

const dirs: string[] = [];
const originalCwd = process.cwd();
afterAll(() => {
  process.chdir(originalCwd);
  dirs.forEach((d) => rmSync(d, { recursive: true, force: true }));
});

function fixtureRepo(skillContent: string | null): string {
  const root = mkdtempSync(join(tmpdir(), "issue-cmd-completion-"));
  dirs.push(root);
  if (skillContent !== null) {
    mkdirSync(join(root, ...ISSUE_SKILL_REL.split("/").slice(0, -1)), { recursive: true });
    writeFileSync(join(root, ISSUE_SKILL_REL), skillContent);
  }
  return root;
}

function fakePi() {
  const commands = new Map<
    string,
    { description?: string; getArgumentCompletions?: (p: string) => { value: string; label: string; description?: string }[] }
  >();
  const pi = {
    on: () => () => undefined,
    registerTool: () => undefined,
    registerCommand: (name: string, o: unknown) => commands.set(name, o as never),
    registerFlag: () => undefined,
    getFlag: () => false,
    sendUserMessage: () => undefined,
    sendMessage: () => undefined,
  } as unknown as ExtensionAPI;
  return { pi, commands };
}

function activateIn(root: string) {
  process.chdir(root);
  const { pi, commands } = fakePi();
  activate(pi);
  return commands;
}

describe("ensemble-issue completion dropdown (TRD-018 / TRD-018-TEST)", () => {
  it("lists all five actions (fix/list/resume/status/abandon) with their descriptions, sourced from the skill", async () => {
    const root = fixtureRepo(ISSUE_SKILL);
    const commands = await activateIn(root);
    const getArgumentCompletions = commands.get("ensemble-issue")!.getArgumentCompletions!;

    expect(getArgumentCompletions("")).toEqual([
      { value: "fix", label: "fix", description: "Fix a bug or small issue end to end (analysis, planning, delegated implementation, PR)" },
      { value: "list", label: "list", description: "List open Beads issues via br/bv for triage" },
      { value: "resume", label: "resume", description: "Resume the project's active/paused issue run from its last recorded checkpoint" },
      { value: "status", label: "status", description: "Show the active/most-recent issue run's stage, outcome, and references without advancing it (read-only)" },
      { value: "abandon", label: "abandon", description: "Abandon the project's active/paused issue run after explicit confirmation" },
    ]);
  });

  it("filters to resume/status/abandon on a partial prefix with no new registration code (generic filter, unchanged)", async () => {
    const root = fixtureRepo(ISSUE_SKILL);
    const commands = await activateIn(root);
    const getArgumentCompletions = commands.get("ensemble-issue")!.getArgumentCompletions!;

    expect(getArgumentCompletions("s")).toEqual([
      { value: "status", label: "status", description: "Show the active/most-recent issue run's stage, outcome, and references without advancing it (read-only)" },
    ]);
  });

  it("reflects the real repo's packages/development/skills/ensemble-issue/SKILL.md directly -- proving the dropdown against production content, not only a synthetic fixture", async () => {
    const realRepoRoot = resolve(__dirname, "..", "..", "..");
    const root = fixtureRepo(null);
    // Copy by reference: activate() reads skillRelPath relative to repoRoot,
    // so point repoRoot at the real monorepo root instead of a fixture.
    process.chdir(realRepoRoot);
    const { pi, commands } = fakePi();
    activate(pi);
    const getArgumentCompletions = commands.get("ensemble-issue")!.getArgumentCompletions!;

    const keywords = getArgumentCompletions("").map((c) => c.value);
    expect(keywords).toEqual(["fix", "list", "resume", "status", "abandon"]);
    rmSync(root, { recursive: true, force: true });
  });
});
