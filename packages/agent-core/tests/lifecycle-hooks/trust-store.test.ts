/**
 * Tests for the lifecycle hooks trust store (TRD-019-TEST).
 * (docs/TRD/TRD-2026-f08a2a09-command-lifecycle-hooks.md#trd-019-test)
 *
 * PRD ACs: AC-022-5..8.
 *
 * Every test uses real temporary directories and the real `loadHooksConfig`.
 * The store always lives at an explicit path in a separate temporary "home",
 * so the user's real `~/.ensemble` is never read or written.
 */

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { loadHooksConfig } from "../../src/lifecycle-hooks/config";
import {
  computeHooksDigest,
  defaultTrustStorePath,
  describeHooksForTrust,
  isTrusted,
  recordTrust,
} from "../../src/lifecycle-hooks/trust-store";
import type { HooksConfig } from "../../src/lifecycle-hooks/types";

const posixIt = process.platform === "win32" ? it.skip : it;

const created: string[] = [];

afterEach(() => {
  for (const dir of created.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function tempDir(label: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `trust-store-${label}-`));
  created.push(dir);
  return dir;
}

function writeFile(root: string, relative: string, content: string, mode?: number): string {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  if (mode !== undefined) fs.chmodSync(file, mode);
  return file;
}

/** A hooks document (JSON is valid YAML, so hostile strings need no quoting care). */
function defaultDocument(): Record<string, unknown> {
  return {
    version: 1,
    hooks: {
      audit: { type: "shell", command: "./scripts/audit.sh", args: ["--verbose"], timeout_ms: 5000, on_error: "continue" },
      check: {
        type: "shell",
        command: "node",
        args: ["./hooks/check.js", "--strict", "lib", "./missing.json"],
        timeout_ms: 7000,
        on_error: "block",
      },
      review: { type: "prompt", prompt: "./prompts/review.md", timeout_ms: 30000, on_error: "continue" },
    },
    commands: {
      "ensemble:create-prd": { start: ["audit", "check"], end: ["review", "audit"] },
    },
  };
}

/** A project with its hook files, a directory, an unrelated file and `.ensemble/hooks.yaml`. */
function makeProject(document: Record<string, unknown> = defaultDocument()): string {
  const root = tempDir("project");
  writeFile(root, "scripts/audit.sh", "#!/bin/sh\necho audit\n", 0o755);
  writeFile(root, "hooks/check.js", "console.log('check');\n");
  writeFile(root, "prompts/review.md", "Review the work.\n");
  writeFile(root, "lib/helper.js", "module.exports = 1;\n");
  writeFile(root, "README.md", "unrelated\n");
  writeFile(root, ".ensemble/hooks.yaml", JSON.stringify(document, null, 2));
  return root;
}

function load(root: string): HooksConfig {
  const loaded = loadHooksConfig(root);
  if (loaded.status !== "valid") throw new Error(`fixture hooks file is not valid: ${JSON.stringify(loaded)}`);
  return loaded.config;
}

function digestOf(root: string): string {
  return computeHooksDigest(root, load(root));
}

/** The user's home for one test, and the store inside it (the `.ensemble` directory does not exist yet). */
function makeStore(): string {
  return defaultTrustStorePath(tempDir("home"));
}

/** Is the project, as it is on disk now, trusted? */
function trustedNow(root: string, storePath: string): boolean {
  return isTrusted(root, digestOf(root), { storePath });
}

function trustedProject(): { root: string; storePath: string } {
  const root = makeProject();
  const storePath = makeStore();
  recordTrust(root, digestOf(root), { storePath });
  expect(trustedNow(root, storePath)).toBe(true);
  return { root, storePath };
}

/** A store file as the TRD describes it, keyed by `key`. */
function storeJson(key: string, entry: unknown, version: unknown = 1): string {
  return JSON.stringify({ version, projects: { [key]: entry } });
}

function writeStore(storePath: string, content: string): void {
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  fs.writeFileSync(storePath, content);
}

describe("trust store (TRD-019-TEST)", () => {
  describe("digest sensitivity (AC-022-6)", () => {
    it.each([
      ["the hooks file", ".ensemble/hooks.yaml"],
      ["a shell command file containing a slash", "scripts/audit.sh"],
      ["a prompt file", "prompts/review.md"],
      ["a shell argument that resolves to a regular file", "hooks/check.js"],
    ])("editing %s changes the digest and voids trust, and reverting restores both", (_what, relative) => {
      const { root, storePath } = trustedProject();
      const before = digestOf(root);
      const file = path.join(root, relative);
      const original = fs.readFileSync(file);

      fs.appendFileSync(file, "\n# edited\n");
      expect(digestOf(root)).not.toBe(before);
      expect(trustedNow(root, storePath)).toBe(false);

      fs.writeFileSync(file, original);
      expect(digestOf(root)).toBe(before);
      expect(trustedNow(root, storePath)).toBe(true);
    });

    it("changing a handler's arguments in the hooks file changes the digest", () => {
      const root = makeProject();
      const before = digestOf(root);
      const document = defaultDocument();
      (document.hooks as Record<string, { args: string[] }>).audit.args = ["--quiet"];
      writeFile(root, ".ensemble/hooks.yaml", JSON.stringify(document, null, 2));
      expect(digestOf(root)).not.toBe(before);
    });

    it("a named file outside the project counts too", () => {
      const outside = tempDir("outside");
      const tool = writeFile(outside, "tool.sh", "#!/bin/sh\necho tool\n", 0o755);
      const document = defaultDocument();
      (document.hooks as Record<string, { command: string }>).audit.command = tool;
      const root = makeProject(document);
      const storePath = makeStore();
      recordTrust(root, digestOf(root), { storePath });
      expect(trustedNow(root, storePath)).toBe(true);

      fs.appendFileSync(tool, "\n# edited\n");
      expect(trustedNow(root, storePath)).toBe(false);
    });

    it("an argument file that appears at a named path, or disappears, changes the digest", () => {
      const root = makeProject();
      const before = digestOf(root);

      writeFile(root, "missing.json", "{}");
      const withFile = digestOf(root);
      expect(withFile).not.toBe(before);

      fs.rmSync(path.join(root, "missing.json"));
      expect(digestOf(root)).toBe(before);
    });

    it("has the sha256:<hex> form and is stable across calls and across project locations", () => {
      const root = makeProject();
      const digest = digestOf(root);
      expect(digest).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(digestOf(root)).toBe(digest);

      const copy = path.join(tempDir("copy"), "elsewhere");
      fs.cpSync(root, copy, { recursive: true });
      expect(digestOf(copy)).toBe(digest);
    });
  });

  describe("digest ignores the unrelated (AC-022-6)", () => {
    it("an unrelated file, or a file inside a directory argument, can change", () => {
      const { root, storePath } = trustedProject();
      const before = digestOf(root);

      fs.appendFileSync(path.join(root, "README.md"), "more\n");
      writeFile(root, "src/new-file.ts", "export {};\n");
      fs.appendFileSync(path.join(root, "lib/helper.js"), "// edited\n");

      expect(digestOf(root)).toBe(before);
      expect(trustedNow(root, storePath)).toBe(true);
    });

    it("handler order in the configuration does not matter", () => {
      const root = makeProject();
      const config = load(root);
      const reordered: HooksConfig = { ...config, hooks: Object.fromEntries(Object.entries(config.hooks).reverse()) };
      expect(Object.keys(reordered.hooks)).not.toEqual(Object.keys(config.hooks));
      expect(computeHooksDigest(root, reordered)).toBe(computeHooksDigest(root, config));
    });

    it("flag, directory, missing-path and part-of-an-argument entries add nothing", () => {
      const root = makeProject();
      const config = load(root);
      const check = config.hooks.check;
      if (check.type !== "shell") throw new Error("fixture: check is a shell handler");
      const widened: HooksConfig = {
        ...config,
        hooks: {
          ...config.hooks,
          check: { ...check, args: [...check.args, "--other", "-v", "hooks", "./no/such/file", "--config=./hooks/check.js", ""] },
        },
      };
      // `--config=./hooks/check.js` names an existing file only as part of an argument, so it adds nothing.
      expect(computeHooksDigest(root, widened)).toBe(computeHooksDigest(root, config));
    });

    it("a missing, a directory and a pipe named as a command or prompt are unreadable, never an error", () => {
      const root = makeProject();
      const config: HooksConfig = {
        version: 1,
        hooks: {
          missing: { type: "shell", command: "./nowhere/run.sh", args: [], timeout_ms: 1000, on_error: "continue" },
          dir: { type: "shell", command: "./lib", args: ["./lib"], timeout_ms: 1000, on_error: "continue" },
          prompt: { type: "prompt", prompt: "./lib", timeout_ms: 1000, on_error: "continue" },
        },
        commands: {},
      };
      expect(computeHooksDigest(root, config)).toMatch(/^sha256:[0-9a-f]{64}$/);

      if (process.platform !== "win32") {
        execFileSync("mkfifo", [path.join(root, "pipe")]);
        const withPipe: HooksConfig = {
          ...config,
          hooks: {
            ...config.hooks,
            pipe: { type: "shell", command: "./pipe", args: ["./pipe"], timeout_ms: 1000, on_error: "continue" },
          },
        };
        expect(computeHooksDigest(root, withPipe)).toMatch(/^sha256:[0-9a-f]{64}$/);
      }
    });
  });

  describe("record round trip and the store file (AC-022-7)", () => {
    it("trust recorded is trust found; a different digest or another project is not trusted", () => {
      const root = makeProject();
      const other = makeProject();
      const storePath = makeStore();
      const digest = digestOf(root);

      expect(isTrusted(root, digest, { storePath })).toBe(false);
      recordTrust(root, digest, { storePath });

      expect(isTrusted(root, digest, { storePath })).toBe(true);
      expect(isTrusted(root, `${digest}0`, { storePath })).toBe(false);
      expect(isTrusted(other, digest, { storePath })).toBe(false);
    });

    it("writes the documented shape, keyed by the project's real path, with the injected time", () => {
      const root = makeProject();
      const storePath = makeStore();
      const digest = digestOf(root);
      recordTrust(root, digest, { storePath, now: () => new Date("2026-01-02T03:04:05.000Z") });

      expect(path.relative(root, storePath).startsWith("..")).toBe(true);
      expect(JSON.parse(fs.readFileSync(storePath, "utf8"))).toEqual({
        version: 1,
        projects: { [fs.realpathSync(root)]: { digest, trusted_at: "2026-01-02T03:04:05.000Z" } },
      });
    });

    it("re-recording replaces the project's record and keeps the others", () => {
      const first = makeProject();
      const second = makeProject();
      const storePath = makeStore();
      recordTrust(first, "sha256:old", { storePath });
      recordTrust(second, "sha256:second", { storePath });
      recordTrust(first, "sha256:new", { storePath });

      expect(isTrusted(first, "sha256:old", { storePath })).toBe(false);
      expect(isTrusted(first, "sha256:new", { storePath })).toBe(true);
      expect(isTrusted(second, "sha256:second", { storePath })).toBe(true);
    });

    it("defaults to <home>/.ensemble/trusted-hooks.json", () => {
      expect(defaultTrustStorePath("/some/home")).toBe(path.join("/some/home", ".ensemble", "trusted-hooks.json"));
    });

    posixIt("creates the store file owner-only (0600) and a new directory 0700, and keeps 0600 on rewrite", () => {
      const root = makeProject();
      const storePath = makeStore();
      expect(fs.existsSync(path.dirname(storePath))).toBe(false);

      recordTrust(root, "sha256:one", { storePath });
      expect(fs.statSync(storePath).mode & 0o777).toBe(0o600);
      expect(fs.statSync(path.dirname(storePath)).mode & 0o777).toBe(0o700);

      recordTrust(root, "sha256:two", { storePath });
      expect(fs.statSync(storePath).mode & 0o777).toBe(0o600);
    });

    posixIt("replaces a store that was group- and world-readable with an owner-only one", () => {
      const root = makeProject();
      const storePath = makeStore();
      writeStore(storePath, "garbage");
      fs.chmodSync(storePath, 0o644);

      recordTrust(root, "sha256:one", { storePath });
      expect(fs.statSync(storePath).mode & 0o777).toBe(0o600);
    });

    it("leaves no temporary file behind after recording", () => {
      const root = makeProject();
      const storePath = makeStore();
      recordTrust(root, "sha256:one", { storePath });
      recordTrust(root, "sha256:two", { storePath });
      expect(fs.readdirSync(path.dirname(storePath))).toEqual([path.basename(storePath)]);
    });

    it("a failed write throws and leaves no temporary file behind", () => {
      const root = makeProject();
      const home = tempDir("home");
      const storePath = path.join(home, "store-is-a-directory");
      fs.mkdirSync(storePath);

      expect(() => recordTrust(root, "sha256:one", { storePath })).toThrow();
      expect(fs.readdirSync(home)).toEqual(["store-is-a-directory"]);
    });
  });

  describe("real path key (AC-022-7)", () => {
    posixIt("a symlink to the project finds the real path's record, and the other way round", () => {
      const root = makeProject();
      const link = path.join(tempDir("links"), "project-link");
      fs.symlinkSync(root, link);
      const storePath = makeStore();
      const digest = digestOf(root);

      recordTrust(root, digest, { storePath });
      expect(isTrusted(link, digest, { storePath })).toBe(true);

      const otherStore = makeStore();
      recordTrust(link, digest, { storePath: otherStore });
      expect(isTrusted(root, digest, { storePath: otherStore })).toBe(true);
      expect(Object.keys(JSON.parse(fs.readFileSync(otherStore, "utf8")).projects)).toEqual([fs.realpathSync(root)]);
    });
  });

  describe("the repository cannot grant trust (AC-022-7)", () => {
    it("a store inside the project is refused by recordTrust and never trusted", () => {
      const root = makeProject();
      const digest = digestOf(root);
      const inside = path.join(root, ".ensemble", "trusted-hooks.json");

      expect(() => recordTrust(root, digest, { storePath: inside })).toThrow(/outside the repository/);
      expect(fs.existsSync(inside)).toBe(false);
      expect(isTrusted(root, digest, { storePath: inside })).toBe(false);

      const notYetThere = path.join(root, "new", "dir", "store.json");
      expect(() => recordTrust(root, digest, { storePath: notYetThere })).toThrow(/outside the repository/);
      expect(fs.existsSync(path.join(root, "new"))).toBe(false);
    });

    it("a store inside the project that holds a matching record is not read", () => {
      const root = makeProject();
      const digest = digestOf(root);
      const inside = path.join(root, ".ensemble", "trusted-hooks.json");
      writeStore(inside, storeJson(fs.realpathSync(root), { digest, trusted_at: "2026-01-01T00:00:00.000Z" }));

      expect(isTrusted(root, digest, { storePath: inside })).toBe(false);
    });

    posixIt("a store reached through a symlink that points into the project is inside the project", () => {
      const root = makeProject();
      const digest = digestOf(root);
      const link = path.join(tempDir("links"), "into-project");
      fs.symlinkSync(path.join(root, ".ensemble"), link);
      const storePath = path.join(link, "trusted.json");

      expect(() => recordTrust(root, digest, { storePath })).toThrow(/outside the repository/);
      expect(isTrusted(root, digest, { storePath })).toBe(false);
    });

    it("a project that contains the home directory, and so the default store, can never be trusted", () => {
      const home = tempDir("home");
      const storePath = defaultTrustStorePath(home);
      writeFile(home, ".ensemble/hooks.yaml", JSON.stringify({ version: 1, hooks: {}, commands: {} }));
      const digest = digestOf(home);

      expect(() => recordTrust(home, digest, { storePath })).toThrow(/outside the repository/);
      expect(isTrusted(home, digest, { storePath })).toBe(false);
    });

    it("a record shipped in the repository is ignored", () => {
      const root = makeProject();
      const digest = digestOf(root);
      const key = fs.realpathSync(root);
      const record = storeJson(key, { digest, trusted_at: "2026-01-01T00:00:00.000Z" });
      writeFile(root, "trusted-hooks.json", record);
      writeFile(root, ".ensemble/trusted-hooks.json", record);
      writeFile(root, ".ensemble/home/.ensemble/trusted-hooks.json", record);
      writeFile(root, "home/.ensemble/trusted-hooks.json", record);

      const storePath = makeStore();
      expect(isTrusted(root, digest, { storePath })).toBe(false);

      // Another project's record in the real store does not vouch for this one either.
      recordTrust(makeProject(), digest, { storePath });
      expect(isTrusted(root, digest, { storePath })).toBe(false);
    });
  });

  describe("a bad store gives false and never throws (AC-022-7)", () => {
    const wrongStores: Array<[string, (key: string, digest: string) => string]> = [
      ["an empty file", () => ""],
      ["text that is not JSON", () => "not json {"],
      ["a JSON array", () => "[]"],
      ["JSON null", () => "null"],
      ["a store without projects", () => JSON.stringify({ version: 1 })],
      ["projects that is an array", () => JSON.stringify({ version: 1, projects: [] })],
      ["another version", (key, digest) => storeJson(key, { digest, trusted_at: "t" }, 2)],
      ["no version", (key, digest) => JSON.stringify({ projects: { [key]: { digest, trusted_at: "t" } } })],
      ["an entry without trusted_at", (key, digest) => storeJson(key, { digest })],
      ["an entry whose digest is not a string", (key) => storeJson(key, { digest: 5, trusted_at: "t" })],
      ["an entry that is null", (key) => storeJson(key, null)],
      ["an entry that is a string", (key, digest) => storeJson(key, digest)],
    ];

    it.each(wrongStores)("%s", (_what, content) => {
      const root = makeProject();
      const digest = digestOf(root);
      const storePath = makeStore();
      writeStore(storePath, content(fs.realpathSync(root), digest));

      expect(() => isTrusted(root, digest, { storePath })).not.toThrow();
      expect(isTrusted(root, digest, { storePath })).toBe(false);

      // Recording treats the unusable store as empty and rewrites it.
      recordTrust(root, digest, { storePath });
      expect(isTrusted(root, digest, { storePath })).toBe(true);
    });

    it("a missing store, a store that is a directory, and a project that does not exist are all false", () => {
      const root = makeProject();
      const digest = digestOf(root);
      const storePath = makeStore();
      expect(isTrusted(root, digest, { storePath })).toBe(false);

      fs.mkdirSync(storePath, { recursive: true });
      expect(isTrusted(root, digest, { storePath })).toBe(false);

      const real = makeStore();
      recordTrust(root, digest, { storePath: real });
      expect(isTrusted(path.join(tempDir("none"), "gone"), digest, { storePath: real })).toBe(false);
    });

    it("an entry of the wrong shape is left out and does not spoil the valid entries beside it", () => {
      const root = makeProject();
      const other = makeProject();
      const digest = digestOf(root);
      const storePath = makeStore();
      writeStore(
        storePath,
        JSON.stringify({
          version: 1,
          projects: {
            [fs.realpathSync(other)]: { digest: 7 },
            [fs.realpathSync(root)]: { digest, trusted_at: "2026-01-01T00:00:00.000Z" },
          },
        }),
      );

      expect(isTrusted(root, digest, { storePath })).toBe(true);
      expect(isTrusted(other, digest, { storePath })).toBe(false);
    });

    it("an undefined digest is never trusted, whether or not a record exists", () => {
      const root = makeProject();
      const key = fs.realpathSync(root);
      const undef = undefined as unknown as string;
      const storePath = makeStore();

      // No store at all: `record?.digest === digest` would read `undefined === undefined`.
      expect(isTrusted(root, undef, { storePath })).toBe(false);

      // A store with only other projects' records.
      recordTrust(makeProject(), "sha256:other", { storePath });
      expect(isTrusted(root, undef, { storePath })).toBe(false);

      // A record for this project that has no digest field.
      writeStore(storePath, storeJson(key, { trusted_at: "t" }));
      expect(isTrusted(root, undef, { storePath })).toBe(false);

      // A valid record for this project.
      recordTrust(root, "sha256:valid", { storePath });
      expect(isTrusted(root, undef, { storePath })).toBe(false);
      expect(isTrusted(root, "", { storePath })).toBe(false);
    });

    it("recordTrust for a project that does not exist throws and writes nothing", () => {
      const storePath = makeStore();
      const gone = path.join(tempDir("none"), "gone");

      expect(() => recordTrust(gone, "sha256:one", { storePath })).toThrow();
      expect(fs.existsSync(storePath)).toBe(false);
    });
  });

  describe("confirmation text (AC-022-8)", () => {
    it("names each handler's exact command and arguments or prompt file, in configured order, one line each", () => {
      const root = makeProject();
      expect(describeHooksForTrust(load(root))).toEqual([
        "shell audit: ./scripts/audit.sh --verbose (timeout 5000ms, on_error continue)",
        "shell check: node ./hooks/check.js --strict lib ./missing.json (timeout 7000ms, on_error block)",
        "prompt review: ./prompts/review.md (timeout 30000ms, on_error continue)",
        "command ensemble:create-prd: start [audit, check], end [review, audit]",
      ]);
    });

    it("shows an argument with spaces as one quoted token", () => {
      const document = defaultDocument();
      (document.hooks as Record<string, { args: string[] }>).audit.args = ["arg1", "two words"];
      const lines = describeHooksForTrust(load(makeProject(document)));
      expect(lines[0]).toBe('shell audit: ./scripts/audit.sh arg1 "two words" (timeout 5000ms, on_error continue)');
    });

    it("a hostile argument or handler name cannot make a fake line, move the cursor or hide text", () => {
      const nasty = "nasty\nprompt fake: ./evil.md";
      const document = {
        version: 1,
        hooks: {
          audit: {
            type: "shell",
            command: "./scripts/audit.sh",
            args: [
              "ok",
              "two words",
              'say "hi"',
              "line1\nshell fake: ./evil (timeout 1ms, on_error continue)",
              "\u001b[2J\u001b[31mred",
              "a\u202eb",
              "a\u2028b\rc",
              "",
              "back\\slash",
              "a,b",
            ],
            timeout_ms: 5000,
            on_error: "continue",
          },
          [nasty]: { type: "prompt", prompt: "./prompts/review.md", timeout_ms: 30000, on_error: "continue" },
        },
        commands: { "ensemble:create-prd": { start: ["audit"], end: [nasty] } },
      };
      const lines = describeHooksForTrust(load(makeProject(document)));

      expect(lines).toEqual([
        String.raw`shell audit: ./scripts/audit.sh ok "two words" "say \"hi\"" "line1\nshell fake: ./evil (timeout 1ms, on_error continue)" "\u001b[2J\u001b[31mred" "a\u{202e}b" "a\u{2028}b\rc" "" "back\\slash" "a,b" (timeout 5000ms, on_error continue)`,
        String.raw`prompt "nasty\nprompt fake: ./evil.md": ./prompts/review.md (timeout 30000ms, on_error continue)`,
        String.raw`command ensemble:create-prd: start [audit], end ["nasty\nprompt fake: ./evil.md"]`,
      ]);
      for (const line of lines) {
        expect(line).not.toMatch(/[\p{C}\p{Zl}\p{Zp}]/u);
      }
      expect(lines.filter((line) => line.startsWith("shell ")).length).toBe(1);
      expect(lines.filter((line) => line.startsWith("prompt ")).length).toBe(1);
    });
  });
});
