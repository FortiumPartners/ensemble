import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import * as yaml from "js-yaml";
import { DISPATCHER_TARGETS, resolveCommand } from "../src/lifecycle/resolve-command";

/**
 * Command resolution for the lifecycle adapter (TRD-008, AC-003-1, AC-003-2).
 * Inputs are the two raw forms Pi delivers in its `input` event (TRD-001
 * probe): `/<template> <args>` and `/skill:<skill> <args>`.
 */

const REPO_ROOT = resolve(__dirname, "../../..");

const DISPATCHER_YAMLS: Record<string, string> = {
  "ensemble-prd": "packages/product/commands/prd.yaml",
  "ensemble-trd": "packages/development/commands/trd.yaml",
  "ensemble-issue": "packages/development/commands/issue.yaml",
  "ensemble-feature": "packages/development/commands/feature.yaml",
};

describe("resolveCommand", () => {
  describe("direct commands", () => {
    it("resolves a prompt-template input to its command and arguments", () => {
      expect(resolveCommand("/ensemble-refine-prd x")).toEqual({
        command: "ensemble:refine-prd",
        arguments: "x",
      });
      expect(resolveCommand("/ensemble-create-prd foo")).toEqual({
        command: "ensemble:create-prd",
        arguments: "foo",
      });
    });

    it("resolves an input with no arguments to empty arguments", () => {
      expect(resolveCommand("/ensemble-create-prd")).toEqual({
        command: "ensemble:create-prd",
        arguments: "",
      });
      expect(resolveCommand("/ensemble-create-prd   ")).toEqual({
        command: "ensemble:create-prd",
        arguments: "",
      });
    });

    it("trims the arguments but keeps their internal whitespace and newlines", () => {
      expect(resolveCommand("/ensemble-create-prd   a  b\n\nc  ")).toEqual({
        command: "ensemble:create-prd",
        arguments: "a  b\n\nc",
      });
    });

    it("resolves every Ensemble prompt template to ensemble:<name>, in both input forms", () => {
      const promptDir = join(REPO_ROOT, "packages/pi/prompts");
      const names = readdirSync(promptDir)
        .filter((f) => f.endsWith(".md"))
        .map((f) => f.slice(0, -".md".length))
        .filter((n) => n.startsWith("ensemble-") && !Object.hasOwn(DISPATCHER_TARGETS, n));
      expect(names.length).toBeGreaterThan(40);
      for (const name of names) {
        const expected = { command: `ensemble:${name.slice("ensemble-".length)}`, arguments: "a b" };
        expect(resolveCommand(`/${name} a b`)).toEqual(expected);
        expect(resolveCommand(`/skill:${name} a b`)).toEqual(expected);
      }
    });
  });

  describe("skill form", () => {
    it("returns the same command and arguments as the template form", () => {
      const template = resolveCommand("/ensemble-create-prd foo bar");
      const skill = resolveCommand("/skill:ensemble-create-prd foo bar");
      expect(template).toEqual({ command: "ensemble:create-prd", arguments: "foo bar" });
      expect(skill).toEqual(template);
    });

    it("resolves a dispatcher in skill form through its keyword map", () => {
      expect(resolveCommand("/skill:ensemble-prd create x")).toEqual(resolveCommand("/ensemble-prd create x"));
      expect(resolveCommand("/skill:ensemble-prd create x")).toEqual({
        command: "ensemble:create-prd",
        arguments: "x",
      });
    });
  });

  describe("dispatchers", () => {
    it("returns the target, never the dispatcher (AC-003-1)", () => {
      expect(resolveCommand("/ensemble-prd create x")).toEqual({
        command: "ensemble:create-prd",
        arguments: "x",
      });
      expect(resolveCommand("/ensemble-trd refine docs/TRD/a.md")).toEqual({
        command: "ensemble:refine-trd",
        arguments: "docs/TRD/a.md",
      });
      expect(resolveCommand("/ensemble-issue fix #12")).toEqual({
        command: "ensemble:fix-issue",
        arguments: "#12",
      });
      expect(resolveCommand("/ensemble-feature new an idea  here")).toEqual({
        command: "ensemble:new-feature",
        arguments: "an idea  here",
      });
    });

    it("never resolves to a dispatcher name for any keyword", () => {
      const dispatcherCommands = Object.keys(DISPATCHER_TARGETS).map((n) => `ensemble:${n.slice("ensemble-".length)}`);
      for (const [dispatcher, keywords] of Object.entries(DISPATCHER_TARGETS)) {
        for (const keyword of Object.keys(keywords)) {
          const resolved = resolveCommand(`/${dispatcher} ${keyword} x`);
          expect(resolved).toBeDefined();
          expect(dispatcherCommands).not.toContain(resolved?.command);
        }
      }
    });

    it("gives a keyword-only input empty arguments", () => {
      expect(resolveCommand("/ensemble-prd create")).toEqual({ command: "ensemble:create-prd", arguments: "" });
    });

    it("tolerates extra whitespace around the keyword", () => {
      expect(resolveCommand("/ensemble-prd   create   x  y ")).toEqual({
        command: "ensemble:create-prd",
        arguments: "x  y",
      });
    });

    it("returns undefined for a dispatcher with no keyword", () => {
      expect(resolveCommand("/ensemble-prd")).toBeUndefined();
      expect(resolveCommand("/ensemble-prd   ")).toBeUndefined();
      expect(resolveCommand("/skill:ensemble-trd")).toBeUndefined();
    });

    it("returns undefined for a dispatcher with an unknown keyword", () => {
      expect(resolveCommand("/ensemble-prd nonsense x")).toBeUndefined();
      expect(resolveCommand("/ensemble-prd CREATE x")).toBeUndefined();
      expect(resolveCommand("/ensemble-prd create-prd x")).toBeUndefined();
    });

    it("does not treat inherited object keys as keywords", () => {
      for (const keyword of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
        expect(resolveCommand(`/ensemble-prd ${keyword} x`)).toBeUndefined();
      }
    });

    it("does not apply a dispatcher's keyword map to another dispatcher", () => {
      expect(resolveCommand("/ensemble-prd fix x")).toBeUndefined();
      expect(resolveCommand("/ensemble-issue create x")).toBeUndefined();
    });

    it("selects no handler for a hook configured only on the dispatcher (AC-003-2)", () => {
      const hookCommands = ["ensemble:prd"];
      const resolved = resolveCommand("/ensemble-prd create x");
      expect(resolved?.command).toBe("ensemble:create-prd");
      expect(hookCommands.filter((c) => c === resolved?.command)).toEqual([]);
      // ...while a hook on the target does match.
      expect(["ensemble:create-prd"].filter((c) => c === resolved?.command)).toEqual(["ensemble:create-prd"]);
    });
  });

  describe("inputs that are not Ensemble commands", () => {
    it.each([
      ["empty input", ""],
      ["plain text", "create a prd for foo"],
      ["plain text mentioning a command", "please run /ensemble-create-prd foo"],
      ["leading whitespace before the slash", " /ensemble-create-prd foo"],
      ["another slash command", "/help"],
      ["another command with an ensemble-like arg", "/compact ensemble-create-prd"],
      ["a skill that is not an Ensemble skill", "/skill:other-skill foo"],
      ["a bare slash", "/"],
      ["a bare skill prefix", "/skill:"],
      ["ensemble- with nothing after", "/ensemble-"],
      ["ensemble- with nothing after, with args", "/ensemble- foo"],
      ["the colon form of a command", "/ensemble:create-prd foo"],
      ["no ensemble- prefix", "/create-prd foo"],
      ["an empty name segment", "/ensemble--create foo"],
      ["a trailing hyphen", "/ensemble-create- foo"],
      ["a name glued to extra characters", "/ensemble-create-prd/x foo"],
      ["a skill prefix with no slash", "skill:ensemble-create-prd foo"],
    ])("returns undefined for %s", (_label, input) => {
      expect(resolveCommand(input)).toBeUndefined();
    });
  });

  describe("embedded dispatcher map matches the dispatcher YAML (drift guard)", () => {
    it("covers exactly the four dispatchers", () => {
      expect(Object.keys(DISPATCHER_TARGETS).sort()).toEqual(Object.keys(DISPATCHER_YAMLS).sort());
    });

    it.each(Object.entries(DISPATCHER_YAMLS))("%s equals the keyword -> ref list in %s", (dispatcher, yamlPath) => {
      const doc = yaml.load(readFileSync(join(REPO_ROOT, yamlPath), "utf8")) as {
        dispatch?: { subcommands?: { keyword: string; ref: string }[] };
      };
      const subcommands = doc.dispatch?.subcommands;
      expect(Array.isArray(subcommands)).toBe(true);
      const fromYaml = Object.fromEntries((subcommands ?? []).map((s) => [s.keyword, s.ref]));
      expect(Object.keys(fromYaml)).toHaveLength((subcommands ?? []).length); // no duplicate keywords
      expect(DISPATCHER_TARGETS[dispatcher]).toEqual(fromYaml);
    });

    it("every embedded target is itself a real Ensemble prompt template", () => {
      const promptDir = join(REPO_ROOT, "packages/pi/prompts");
      const templates = new Set(readdirSync(promptDir).map((f) => f.replace(/\.md$/, "")));
      for (const keywords of Object.values(DISPATCHER_TARGETS)) {
        for (const ref of Object.values(keywords)) {
          expect(templates.has(`ensemble-${ref}`)).toBe(true);
        }
      }
    });
  });
});
