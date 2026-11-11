import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as yaml from "js-yaml";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import activate from "../src/extension";

/**
 * TRD-012 / TRD-012-TEST: Whole-surface delivery smoke (REQ-012, REQ-017).
 *
 * TRD-012 is a verification task -- it re-implements nothing, it only
 * confirms what TRD-002/TRD-003 (ensemble-feature), TRD-016/TRD-017/TRD-018
 * (resumable ensemble-issue), and the untouched ensemble-prd/ensemble-trd
 * specialist entries already shipped are *actually* present and wired
 * together in a real installed product, per PRD ACs AC-012-1, AC-012-2,
 * AC-017-1, AC-017-2.
 *
 * Per AC-012-2 ("the assertion runs through the shipped command surface,
 * not around it via internal APIs"), this file drives every assertion
 * through `activate()` + the registered command's own handler/completion
 * API, and through the real on-disk dispatch YAML chain -- never by calling
 * RunIndexStore/IssueRunIndexStore or any other internal module directly.
 */

const REPO_ROOT = resolve(__dirname, "..", "..", "..");

interface RegisteredCommand {
  description?: string;
  getArgumentCompletions?: (p: string) => { value: string; label: string; description?: string }[];
  handler: (args: string, ctx: unknown) => Promise<void>;
}

interface SentMessage {
  content: string;
  options?: unknown;
}

interface FakePiHarness {
  pi: ExtensionAPI;
  commands: Map<string, RegisteredCommand>;
  sent: SentMessage[];
}

interface DispatchSubcommand {
  keyword: string;
  ref: string;
}

interface DispatcherYamlDoc {
  dispatch?: { subcommands?: DispatchSubcommand[] };
  workflow?: { phases?: { name: string }[] };
}

function fakePi(): FakePiHarness {
  const commands = new Map<string, RegisteredCommand>();
  const sent: SentMessage[] = [];
  const pi = {
    on: () => () => undefined,
    registerTool: () => undefined,
    registerCommand: (name: string, o: unknown) => commands.set(name, o as RegisteredCommand),
    registerFlag: () => undefined,
    getFlag: () => false,
    sendUserMessage: (content: string, options?: unknown) => {
      sent.push({ content, options });
    },
    sendMessage: () => undefined,
  } as unknown as ExtensionAPI;
  return { pi, commands, sent };
}

function loadYaml(relPath: string): DispatcherYamlDoc {
  return yaml.load(readFileSync(resolve(REPO_ROOT, relPath), "utf-8")) as DispatcherYamlDoc;
}

function dispatchKeywords(doc: DispatcherYamlDoc): DispatchSubcommand[] {
  return doc.dispatch?.subcommands ?? [];
}

const NATIVE_COMMANDS = [
  { name: "ensemble-feature", yamlRelPath: "packages/development/commands/feature.yaml" },
  { name: "ensemble-issue", yamlRelPath: "packages/development/commands/issue.yaml" },
  { name: "ensemble-prd", yamlRelPath: "packages/product/commands/prd.yaml" },
  { name: "ensemble-trd", yamlRelPath: "packages/development/commands/trd.yaml" },
];

// Where the product ships each native command's colon-named markdown
// command, across every runtime this repo generates for. Presence here --
// not merely a passing unit test -- is AC-017-2's exit condition.
const INSTALLED_SURFACES = [
  { label: "pi prompts", relPath: (kw: string) => `packages/pi/prompts/ensemble-${kw}.md` },
  { label: "pi skills", relPath: (kw: string) => `packages/pi/skills/ensemble-${kw}/SKILL.md` },
  { label: "codex skills", relPath: (kw: string) => `packages/codex/.codex/skills/commands/ensemble-${kw}/SKILL.md` },
];

describe("Whole-surface delivery smoke (TRD-012 / TRD-012-TEST)", () => {
  describe("Scenario: all four commands reach the shipped surface with no separate manual registration step (AC-012-1)", () => {
    it("registering natively via a single activate() call in a fresh session with this product installed is all four's only registration step", () => {
      const originalCwd = process.cwd();
      process.chdir(REPO_ROOT);
      try {
        const { pi, commands } = fakePi();
        activate(pi);
        for (const { name } of NATIVE_COMMANDS) {
          expect(commands.has(name)).toBe(true);
        }
      } finally {
        process.chdir(originalCwd);
      }
    });
  });

  describe("Scenario: feature front door reachable end-to-end (AC-012-1, AC-012-2)", () => {
    it("`ensemble-feature new <idea>` forwards through the shipped command surface into /ensemble:feature, whose own dispatch.subcommands[] resolves `new` to new-feature's real multi-phase stage machine", async () => {
      const originalCwd = process.cwd();
      process.chdir(REPO_ROOT);
      let harness: FakePiHarness;
      try {
        harness = fakePi();
        activate(harness.pi);
      } finally {
        process.chdir(originalCwd);
      }

      // Assertion runs through the command surface (handler invocation,
      // not an internal RunIndexStore call) -- AC-012-2.
      await harness.commands.get("ensemble-feature")!.handler("new Build a widget", {});
      expect(harness.sent).toEqual([
        { content: "/ensemble:feature new Build a widget", options: { expandPromptTemplates: true } },
      ]);

      const featureYaml = loadYaml("packages/development/commands/feature.yaml");
      const newKeyword = dispatchKeywords(featureYaml).find((s) => s.keyword === "new");
      expect(newKeyword?.ref).toBe("new-feature");

      // Prove `new-feature` is a real, resumable, multi-phase stage
      // machine -- not a stub -- so "reaches the stage machine" is a
      // structural fact about the shipped artifact, not an assumption.
      // new-feature is skill-backed: its manifest names the skill and the stage machine's phases
      // are the `### Phase N: <name>` headings of that skill's SKILL.md plus references/*.md.
      const newFeatureYaml = loadYaml("packages/development/commands/new-feature.yaml") as { skill?: string };
      expect(newFeatureYaml.skill).toBe("ensemble-new-feature");
      const skillDir = resolve(REPO_ROOT, "packages/development/skills", newFeatureYaml.skill as string);
      const skillText = [
        readFileSync(resolve(skillDir, "SKILL.md"), "utf8"),
        ...readdirSync(resolve(skillDir, "references"))
          .filter((f) => f.endsWith(".md"))
          .sort()
          .map((f) => readFileSync(resolve(skillDir, "references", f), "utf8")),
      ].join("\n");
      const phases = [...skillText.matchAll(/^### Phase \d+: (.+)$/gm)].map((m) => m[1].trim());
      expect(phases).toEqual(expect.arrayContaining(["Entry Point Resolution", "Stage Resolution", "Execute Stage"]));
      expect(phases.length).toBeGreaterThan(1);
    });
  });

  describe("Scenario: all four commands match the PRD together (AC-017-1)", () => {
    it.each(NATIVE_COMMANDS)("$name's backing YAML exists and declares dispatch.subcommands[] forwarding to real sibling commands", ({ yamlRelPath }) => {
      expect(existsSync(resolve(REPO_ROOT, yamlRelPath))).toBe(true);
      const doc = loadYaml(yamlRelPath);
      const subcommands = dispatchKeywords(doc);
      expect(subcommands.length).toBeGreaterThan(0);
      for (const sub of subcommands) {
        expect(typeof sub.ref).toBe("string");
        expect(sub.ref.length).toBeGreaterThan(0);
      }
    });

    it("ensemble-issue's dispatch.subcommands[] is the resumable set shipped by REQ-019 (fix/list/resume/status/abandon)", () => {
      const issueYaml = loadYaml("packages/development/commands/issue.yaml");
      expect(dispatchKeywords(issueYaml).map((s) => s.keyword)).toEqual(["fix", "list", "resume", "status", "abandon"]);
    });

    it("ensemble-prd/ensemble-trd retain their specialist dispatch tables unchanged (not folded into either lifecycle command)", () => {
      const prdYaml = loadYaml("packages/product/commands/prd.yaml");
      const trdYaml = loadYaml("packages/development/commands/trd.yaml");
      const prdKeywords = dispatchKeywords(prdYaml).map((s) => s.keyword);
      expect(prdKeywords).toEqual(expect.arrayContaining(["create", "refine"]));
      // The meeting-sourced variants are `--from-meeting` flags on create-prd/refine-prd, not dispatcher keywords.
      expect(prdKeywords).not.toContain("create-meeting");
      expect(prdKeywords).not.toContain("refine-meeting");
      expect(dispatchKeywords(trdYaml).map((s) => s.keyword)).toEqual(
        expect.arrayContaining(["create", "refine", "implement", "analyze"]),
      );
    });
  });

  describe("Scenario: exit condition is product presence, not isolated tests (AC-017-2)", () => {
    it.each(NATIVE_COMMANDS)("$name appears in the installed product across every generated runtime surface", ({ name }) => {
      const keyword = name.replace(/^ensemble-/, "");
      for (const surface of INSTALLED_SURFACES) {
        const surfacePath = resolve(REPO_ROOT, surface.relPath(keyword));
        expect(existsSync(surfacePath)).toBe(true);
      }
    });
  });
});
