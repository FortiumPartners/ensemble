import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHeadlessPromptEvaluator } from "../src/lifecycle/prompt-evaluator";

/**
 * Headless prompt evaluator (TRD-013-TEST; PRD AC-011-1, AC-011-4).
 *
 * Every case runs a real child process: a fake `pi` executable written to a
 * temp dir and passed by absolute path. The fake is a Node script whose
 * behavior is chosen by a config.json written beside it; it records its argv,
 * cwd and pid to record.json so the tests can observe how it was started. No
 * real pi and no model are involved. Config goes through files because Jest's
 * sandboxed `process.env` is not what spawned children inherit.
 *
 * Real timers are used deliberately: the cases observe real child processes
 * dying (polled, bounded) and prove that nothing settles on its own while a real
 * child sleeps, which fake timers cannot express.
 */

const FAKE_PI_SOURCE = `#!${process.execPath}
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const dir = __dirname;
const config = JSON.parse(fs.readFileSync(path.join(dir, "config.json"), "utf8"));
const mode = config.mode;
fs.writeFileSync(
  path.join(dir, "record.json"),
  JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd(), pid: process.pid }),
);

if (mode === "print") {
  process.stdout.write(config.stdout);
} else if (mode === "fail") {
  process.stderr.write(config.stderr);
  process.exit(config.exit);
} else if (mode === "stdin") {
  let bytes = 0;
  process.stdin.on("data", (chunk) => { bytes += chunk.length; });
  process.stdin.on("end", () => process.stdout.write("stdin-bytes:" + bytes));
} else if (mode === "sleep") {
  const grandchild = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  fs.writeFileSync(
    path.join(dir, "pids.json"),
    JSON.stringify({ child: process.pid, grandchild: grandchild.pid }),
  );
  setInterval(() => {}, 1000);
}
`;

const PROMPT = "Review the PRD for missing acceptance criteria.";
const EVENT_JSON = JSON.stringify(
  { event: "command_end", command: "ensemble:create-prd", note: "back`tick \"quoted\" é\nline2" },
  null,
  2,
);

interface Recorded {
  argv: string[];
  cwd: string;
  pid: number;
}

let fakeDir: string;
let fakePi: string;
let recordDir: string;
const spawnedPids: number[] = [];

function recorded(): Recorded {
  return JSON.parse(readFileSync(join(recordDir, "record.json"), "utf8")) as Recorded;
}

function useFake(mode: string, extra: { [name: string]: string | number } = {}): void {
  writeFileSync(fakePi, FAKE_PI_SOURCE, { mode: 0o755 });
  writeFileSync(join(recordDir, "config.json"), JSON.stringify({ mode, ...extra }));
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw error;
  }
}

async function waitFor(condition: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return true;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return condition();
}

function readPids(): { child: number; grandchild: number } {
  const pids = JSON.parse(readFileSync(join(recordDir, "pids.json"), "utf8")) as { child: number; grandchild: number };
  spawnedPids.push(pids.child, pids.grandchild);
  return pids;
}

beforeAll(() => {
  fakeDir = realpathSync(mkdtempSync(join(tmpdir(), "fake-pi-")));
});

afterAll(() => {
  rmSync(fakeDir, { recursive: true, force: true });
});

beforeEach(() => {
  recordDir = mkdtempSync(join(fakeDir, "run-"));
  fakePi = join(recordDir, "pi");
});

afterEach(() => {
  // Never leave a sleeping fake behind, whatever the test did.
  for (const pid of spawnedPids.splice(0)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Already gone.
    }
  }
});

describe("createHeadlessPromptEvaluator", () => {
  it("starts the child with exactly -p --no-session -ne -nt -np and one message carrying prompt, protocol and event JSON", async () => {
    useFake("print", { stdout: "ok" });
    const evaluate = createHeadlessPromptEvaluator({ piBinary: fakePi });

    await evaluate({ prompt: PROMPT, eventJson: EVENT_JSON, timeoutMs: 1000, signal: new AbortController().signal });

    const { argv } = recorded();
    expect(argv.slice(0, 5)).toEqual(["-p", "--no-session", "-ne", "-nt", "-np"]);
    expect(argv).toHaveLength(6);
    const message = argv[5];
    expect(message).toContain(PROMPT);
    expect(message).toContain("Respond with a single JSON object and nothing else");
    expect(message).toContain('{"continue": boolean, "message"?: string');
    expect(message).toContain("The lifecycle event you are evaluating follows.");
    expect(message).toContain(EVENT_JSON);
    // Prompt first, then the protocol, then the event.
    expect(message.indexOf(PROMPT)).toBeLessThan(message.indexOf("Respond with a single JSON object"));
    expect(message.indexOf("The lifecycle event you are evaluating follows.")).toBeLessThan(message.indexOf(EVENT_JSON));
  });

  it("returns the child's stdout verbatim on exit 0", async () => {
    const stdout = '  {"continue": true, "message": "fine é"}\n\n';
    useFake("print", { stdout });
    const evaluate = createHeadlessPromptEvaluator({ piBinary: fakePi });

    await expect(
      evaluate({ prompt: PROMPT, eventJson: EVENT_JSON, timeoutMs: 1000, signal: new AbortController().signal }),
    ).resolves.toBe(stdout);
  });

  it("rejects on a nonzero exit with the exit code and the stderr tail", async () => {
    const stderr = `${"x".repeat(6000)}FINAL-STDERR-MARKER`;
    useFake("fail", { stderr, exit: 3 });
    const evaluate = createHeadlessPromptEvaluator({ piBinary: fakePi });

    const error = await evaluate({
      prompt: PROMPT,
      eventJson: EVENT_JSON,
      timeoutMs: 1000,
      signal: new AbortController().signal,
    }).then(
      () => undefined,
      (reason: unknown) => reason as Error,
    );

    expect(error).toBeInstanceOf(Error);
    expect(error?.message).toContain("code 3");
    expect(error?.message).toContain("FINAL-STDERR-MARKER");
    // Only a tail is kept, not all 6000+ characters.
    expect(error?.message.length).toBeLessThan(3000);
  });

  it("rejects without hanging when the binary does not exist", async () => {
    const evaluate = createHeadlessPromptEvaluator({ piBinary: join(fakeDir, "no-such-pi") });

    const error = await evaluate({
      prompt: PROMPT,
      eventJson: EVENT_JSON,
      timeoutMs: 1000,
      signal: new AbortController().signal,
    }).then(
      () => undefined,
      (reason: unknown) => reason as NodeJS.ErrnoException,
    );

    expect(error?.code).toBe("ENOENT");
  });

  it("rejects an already-aborted signal without spawning the child", async () => {
    useFake("print", { stdout: "should never run" });
    const evaluate = createHeadlessPromptEvaluator({ piBinary: fakePi });
    const controller = new AbortController();
    controller.abort();

    await expect(
      evaluate({ prompt: PROMPT, eventJson: EVENT_JSON, timeoutMs: 1000, signal: controller.signal }),
    ).rejects.toThrow(/abort/);

    // Give a wrongly spawned child ample time to record itself.
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(existsSync(join(recordDir, "record.json"))).toBe(false);
  });

  it("kills the child and its grandchild and rejects when the signal aborts", async () => {
    useFake("sleep");
    const evaluate = createHeadlessPromptEvaluator({ piBinary: fakePi });
    const controller = new AbortController();

    const outcome = evaluate({ prompt: PROMPT, eventJson: EVENT_JSON, timeoutMs: 60000, signal: controller.signal }).then(
      () => undefined,
      (reason: unknown) => reason as Error,
    );

    expect(await waitFor(() => existsSync(join(recordDir, "pids.json")), 5000)).toBe(true);
    const { child, grandchild } = readPids();
    expect(isAlive(child)).toBe(true);
    expect(isAlive(grandchild)).toBe(true);

    controller.abort();

    const error = await outcome;
    expect(error).toBeInstanceOf(Error);
    expect(error?.message).toMatch(/abort/);
    expect(await waitFor(() => !isAlive(child), 5000)).toBe(true);
    expect(await waitFor(() => !isAlive(grandchild), 5000)).toBe(true);
  });

  it("has no timer of its own: nothing settles until the signal aborts", async () => {
    useFake("sleep");
    const evaluate = createHeadlessPromptEvaluator({ piBinary: fakePi });
    const controller = new AbortController();
    let settled = false;

    const outcome = evaluate({ prompt: PROMPT, eventJson: EVENT_JSON, timeoutMs: 100, signal: controller.signal }).then(
      () => {
        settled = true;
        return undefined;
      },
      (reason: unknown) => {
        settled = true;
        return reason as Error;
      },
    );

    expect(await waitFor(() => existsSync(join(recordDir, "pids.json")), 5000)).toBe(true);
    const { child } = readPids();
    // timeoutMs is 100 here; the evaluator must ignore it and leave timing to the runner.
    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect(settled).toBe(false);
    expect(isAlive(child)).toBe(true);

    controller.abort();
    const error = await outcome;
    expect(error).toBeInstanceOf(Error);
    expect(await waitFor(() => !isAlive(child), 5000)).toBe(true);
  });

  it("does not use the child's stdin: a fake that reads stdin to the end finishes with nothing read", async () => {
    useFake("stdin");
    const evaluate = createHeadlessPromptEvaluator({ piBinary: fakePi });

    await expect(
      evaluate({ prompt: PROMPT, eventJson: EVENT_JSON, timeoutMs: 1000, signal: new AbortController().signal }),
    ).resolves.toBe("stdin-bytes:0");
  });

  it("runs the child in the cwd option", async () => {
    useFake("print", { stdout: "ok" });
    const workDir = join(fakeDir, "work dir");
    mkdirSync(workDir);
    const evaluate = createHeadlessPromptEvaluator({ piBinary: fakePi, cwd: workDir });

    await evaluate({ prompt: PROMPT, eventJson: EVENT_JSON, timeoutMs: 1000, signal: new AbortController().signal });

    expect(recorded().cwd).toBe(workDir);
  });
});
