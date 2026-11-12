import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import activate from "../src/extension";
import { dispatcherSkill } from "./helpers/dispatcher-skill";

/**
 * TRD-003 / TRD-003-TEST: native `ensemble-feature` command registration.
 *
 * `registerDispatcherCommand`'s own generic contract (parse/complete/forward)
 * is already proved by dispatcher-commands.test.ts against a synthetic
 * `issue` skill fixture. This file instead proves the *call site* added to
 * extension.ts's real `activate()` for the fourth dispatcher command,
 * `ensemble-feature` -- that it actually registers natively when the real
 * `packages/development/skills/ensemble-feature/SKILL.md` is present, stays a no-op
 * when it is absent (this extension loads in every repo the host opens),
 * and that its action list is sourced from that skill rather than a
 * hardcoded TypeScript list -- so wording is editable with no rebuild.
 */

const FEATURE_SKILL_REL = "packages/development/skills/ensemble-feature/SKILL.md";

const FEATURE_SKILL = dispatcherSkill("feature", [
  { keyword: "new", ref: "new-feature", description: "Start a new feature run from an idea" },
  { keyword: "resume", ref: "new-feature", description: "Resume the project's active/paused run from its last recorded checkpoint" },
  { keyword: "status", ref: "new-feature", description: "Show the active/most-recent run's stage, outcome, and references without advancing it (read-only)" },
  { keyword: "abandon", ref: "new-feature", description: "Abandon the project's active/paused run after explicit confirmation" },
]);

const dirs: string[] = [];
const originalCwd = process.cwd();
afterAll(() => {
  process.chdir(originalCwd);
  dirs.forEach((d) => rmSync(d, { recursive: true, force: true }));
});

function fixtureRepo(skillContent: string | null): string {
  const root = mkdtempSync(join(tmpdir(), "feature-cmd-registration-"));
  dirs.push(root);
  if (skillContent !== null) {
    mkdirSync(join(root, ...FEATURE_SKILL_REL.split("/").slice(0, -1)), { recursive: true });
    writeFileSync(join(root, FEATURE_SKILL_REL), skillContent);
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

describe("ensemble-feature native command registration (TRD-003 / TRD-003-TEST)", () => {
  it("registers natively via activate() when the feature skill is present", async () => {
    const root = fixtureRepo(FEATURE_SKILL);
    const commands = await activateIn(root);
    expect(commands.has("ensemble-feature")).toBe(true);
  });

  it("is a no-op -- never registered -- when the feature skill does not exist in this repo (REQ-006)", async () => {
    const root = fixtureRepo(null);
    const commands = await activateIn(root);
    expect(commands.has("ensemble-feature")).toBe(false);
  });

  it("lists all four lifecycle keywords (new/resume/status/abandon) with no side effect, sourced from the skill, not a hardcoded TS list", async () => {
    const root = fixtureRepo(FEATURE_SKILL);
    const commands = await activateIn(root);
    const getArgumentCompletions = commands.get("ensemble-feature")!.getArgumentCompletions!;

    expect(getArgumentCompletions("")).toEqual([
      { value: "new", label: "new", description: "Start a new feature run from an idea" },
      { value: "resume", label: "resume", description: "Resume the project's active/paused run from its last recorded checkpoint" },
      { value: "status", label: "status", description: "Show the active/most-recent run's stage, outcome, and references without advancing it (read-only)" },
      { value: "abandon", label: "abandon", description: "Abandon the project's active/paused run after explicit confirmation" },
    ]);
  });

  it("action wording is editable in the skill with no rebuild -- a changed description shows up without touching extension.ts", async () => {
    const edited = FEATURE_SKILL.replace(
      "Start a new feature run from an idea",
      "Kick off a brand-new feature run from a plain-language idea",
    );
    const root = fixtureRepo(edited);
    const commands = await activateIn(root);
    const getArgumentCompletions = commands.get("ensemble-feature")!.getArgumentCompletions!;

    const newEntry = getArgumentCompletions("new").find((c) => c.value === "new");
    expect(newEntry?.description).toBe("Kick off a brand-new feature run from a plain-language idea");
  });
});
