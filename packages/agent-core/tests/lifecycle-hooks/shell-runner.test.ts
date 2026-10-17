/**
 * Tests for the shell handler runner (TRD-004-TEST).
 * (docs/TRD/TRD-2026-f08a2a09-command-lifecycle-hooks.md#trd-004-test)
 *
 * PRD ACs: AC-009-1..6.
 *
 * Nothing is mocked: every case starts a real process, either a /bin/sh script
 * written to a temp directory and made executable, or /usr/bin/env itself.
 * Fixtures that must outlive the run record their pids under `pids/`, so a test
 * can prove the processes are gone and `afterEach` can SIGKILL whatever a
 * failing run left behind.
 *
 * The clocks are real on purpose. What is under test is a timeout and a kill
 * enforced by the operating system on real processes, and fake timers cannot
 * drive a child process; the handler timeouts, the `sleep` fixtures and the
 * polling for a process to disappear are all bounded.
 */

import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { runShellHandler, SHELL_ENV_ALLOWLIST, SHELL_OUTPUT_BOUND_BYTES } from "../../src/lifecycle-hooks/shell-runner";
import type { ShellRunOptions } from "../../src/lifecycle-hooks/shell-runner";
import type { HandlerOutcome, ShellHandler } from "../../src/lifecycle-hooks/types";

// The fixtures are /bin/sh scripts; there is nothing to run on Windows.
const describePosix = process.platform === "win32" ? describe.skip : describe;

// A process tree that ignores SIGTERM costs the runner's SIGKILL grace period on top of the handler timeout.
jest.setTimeout(20_000);

/** The documented output bound (AC-009-4): 64 KiB of stdout and stderr combined. */
const BOUND = 64 * 1024;

const EVENT = {
  event: "command.start",
  run_id: "run-42",
  command: "ensemble:create-prd",
  arguments: 'naïve – 日本語 🚀 "quoted" back\\slash\nsecond line',
  cwd: "/work/project",
  session_id: "session-1",
  timestamp: "2026-10-15T12:00:00.000Z",
};
/** Pretty-printed, so it holds raw newlines and indentation as well as multi-byte text, and ends without a newline. */
const EVENT_JSON = JSON.stringify(EVENT, null, 2);
/** Far larger than a pipe buffer, and different at every position. */
const BIG_EVENT_JSON = JSON.stringify({
  ...EVENT,
  summary: Array.from({ length: 60_000 }, (_, i) => `line-${i}`).join("|"),
});

let root: string; // the project root: the handler's working directory
let bin: string; // fixture executables
let out: string; // files the fixtures write
let pids: string; // one file per process a fixture started, holding its pid
let markers: string; // where an injected `touch` would leave its mark

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "shell-runner-test-"));
  [bin, out, pids, markers] = ["bin", "out", "pids", "markers"].map((name) => {
    const dir = join(root, name);
    mkdirSync(dir);
    return dir;
  });
});

afterEach(() => {
  for (const pid of recordedPids()) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Already gone, which is what a passing run leaves.
    }
  }
  rmSync(root, { recursive: true, force: true });
});

/** Quote text as one /bin/sh word. */
function sq(text: string): string {
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

/** Write an executable /bin/sh script into the fixture directory and return its path. */
function script(name: string, body: string): string {
  const file = join(bin, name);
  writeFileSync(file, `#!/bin/sh\n${body}\n`);
  chmodSync(file, 0o755);
  return file;
}

function shellHandler(command: string, args: string[] = [], overrides: Partial<ShellHandler> = {}): ShellHandler {
  return { type: "shell", command, args, timeout_ms: 5000, on_error: "continue", ...overrides };
}

function run(handler: ShellHandler, eventJson: string = EVENT_JSON): Promise<HandlerOutcome> {
  return runShellHandler("audit", handler, eventJson, { projectRoot: root });
}

/** Set (or, for `undefined`, remove) variables in the environment the runner reads, for the length of `fn`. */
async function withEnv<T>(vars: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const apply = (values: Record<string, string | undefined>): void => {
    for (const [name, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  };
  const saved = Object.fromEntries(Object.keys(vars).map((name) => [name, process.env[name]]));
  apply(vars);
  try {
    return await fn();
  } finally {
    apply(saved);
  }
}

/** Every pid a fixture recorded. Never 0 or 1: `kill(0)` would signal our own process group. */
function recordedPids(): number[] {
  return readdirSync(pids)
    .map((name) => Number(readFileSync(join(pids, name), "utf8")))
    .filter((pid) => Number.isInteger(pid) && pid > 1);
}

/** The pid a fixture recorded under `name`. Throws ENOENT if the fixture never got that far. */
function readPid(name: string): number {
  return Number(readFileSync(join(pids, name), "utf8"));
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * The pids still alive after waiting up to `withinMs` for them to go. A killed process answers signal 0 until it is
 * reaped, and nothing but probing tells us when an unrelated process has gone, so this waits on the real clock.
 */
async function survivors(candidates: number[], withinMs = 3000): Promise<number[]> {
  const deadline = Date.now() + withinMs;
  let alive = candidates.filter(isAlive);
  while (alive.length > 0 && Date.now() < deadline) {
    await sleep(20);
    alive = alive.filter(isAlive);
  }
  return alive;
}

describePosix("event delivery (AC-009-1)", () => {
  it("writes the event JSON to the handler's stdin byte for byte, then closes it", async () => {
    const captured = join(out, "stdin");

    const outcome = await run(shellHandler(script("capture", `cat > ${sq(captured)}`)));

    // `cat` returns only at end of input, so a runner that left stdin open would have timed out instead.
    expect(outcome).toMatchObject({ handler: "audit", status: "succeeded", exit_code: 0 });
    expect(readFileSync(captured)).toEqual(Buffer.from(EVENT_JSON, "utf8"));
  });

  it("delivers an event larger than a pipe buffer in full", async () => {
    const captured = join(out, "stdin");

    const outcome = await run(shellHandler(script("capture", `cat > ${sq(captured)}`)), BIG_EVENT_JSON);

    const expected = Buffer.from(BIG_EVENT_JSON, "utf8");
    const received = readFileSync(captured);
    expect(outcome.status).toBe("succeeded");
    expect(received.length).toBe(expected.length);
    expect(received.equals(expected)).toBe(true);
  });

  it("finds a bare command name on the PATH the handler is given", async () => {
    const ran = join(out, "ran");
    script("ensemble-fixture-hook", `echo ran > ${sq(ran)}`);

    const outcome = await withEnv({ PATH: `${bin}:/usr/bin:/bin` }, () => run(shellHandler("ensemble-fixture-hook")));

    expect(outcome.status).toBe("succeeded");
    expect(existsSync(ran)).toBe(true);
  });

  it.each([
    ["exits at once", "exit 0"],
    ["keeps running for a while", "sleep 0.3"],
  ])("does not stall on a handler that never reads its stdin (it %s)", async (_label, body) => {
    // The event cannot fit in the pipe, so the runner is left with unwritten input and a closed or ignored reader.
    const outcome = await run(shellHandler(script("ignores-stdin", body), [], { timeout_ms: 3000 }), BIG_EVENT_JSON);

    expect(outcome).toMatchObject({ status: "succeeded", exit_code: 0 });
    expect(outcome.duration_ms).toBeLessThan(3000);
  });
});

describePosix("no shell (AC-009-2)", () => {
  /** Every argument that would do something if a shell ever saw it, then a few that a shell would rewrite. */
  function injected(): string[] {
    const marker = (name: string): string => join(markers, name);
    return [
      `; touch ${marker("semicolon")}`,
      `$(touch ${marker("substitution")})`,
      `\`touch ${marker("backtick")}\``,
      `&& touch ${marker("and")}`,
      `|| touch ${marker("or")}`,
      `| touch ${marker("pipe")}`,
      `& touch ${marker("background")}`,
      `> ${marker("redirect")}`,
      `\ntouch ${marker("newline")}`,
      "*",
      "~",
      "$HOME",
      "${PATH}",
      "'single'",
      '"double"',
      "back\\slash",
      "two  spaces",
      "",
      "-n",
      "--",
    ];
  }

  it("hands every argument to the executable unchanged and runs none of them", async () => {
    const dump = join(out, "argv");
    const args = injected();

    const outcome = await run(shellHandler(script("argv", `printf '%s\\0' "$@" > ${sq(dump)}`), args));

    expect(outcome.status).toBe("succeeded");
    // NUL-separated, so an argument holding a newline survives and an empty one shows.
    expect(readFileSync(dump, "utf8").split("\0").slice(0, -1)).toEqual(args);
    expect(readdirSync(markers)).toEqual([]);
  });

  it("treats a command containing shell syntax as a path or a name, never as a command line", async () => {
    const commands = [`./bin/missing; touch ${join(markers, "command")}`, "true; touch marker-in-the-working-directory"];

    for (const command of commands) {
      expect((await run(shellHandler(command))).status).toBe("failed");
    }

    expect(readdirSync(markers)).toEqual([]);
    expect(readdirSync(root)).not.toContain("marker-in-the-working-directory");
  });
});

describePosix("environment allowlist (AC-009-3)", () => {
  /** Allowlisted variables, with values short enough that the whole listing fits the 500 characters an outcome message holds. */
  const ALLOWLISTED = {
    PATH: "/usr/bin:/bin",
    HOME: "/home/hook-user",
    USER: "hook-user",
    LANG: "en_US.UTF-8",
    TMPDIR: "/tmp/hooks",
    TERM: "xterm-256color",
  };
  /** Variables a handler must never see, whatever they are called. */
  const NOT_FOR_HANDLERS = {
    SHELL_RUNNER_TEST_SECRET: "hunter2",
    GITHUB_TOKEN: "ghp_not_for_handlers",
    AWS_SECRET_ACCESS_KEY: "aws-not-for-handlers",
    // Ordinary login variables, which a wider allowlist might add by mistake.
    SHELL: "/bin/zsh",
    LOGNAME: "hook-user",
    LC_ALL: "C",
    SSH_AUTH_SOCK: "/tmp/agent.sock",
    ENSEMBLE_OTHER: "an ENSEMBLE_ prefix is not an allowlist",
    // The runner sets these itself: whatever the parent holds is replaced, never inherited.
    ENSEMBLE_EVENT: "parent-event",
    ENSEMBLE_RUN_ID: "run-from-parent",
    ENSEMBLE_COMMAND: "parent-command",
    ENSEMBLE_PROJECT_ROOT: "/parent/root",
  };

  /**
   * Run /usr/bin/env itself as the handler, with no shell between (sh and bash add PWD, SHLVL and _), under a parent
   * environment of `ALLOWLISTED` plus `parent`, and parse the environment it printed.
   */
  async function seenEnvironment(
    parent: Record<string, string | undefined>,
    eventJson: string = EVENT_JSON,
    options: ShellRunOptions = { projectRoot: root },
  ): Promise<Record<string, string>> {
    const outcome = await withEnv({ ...ALLOWLISTED, ...parent }, () =>
      runShellHandler("audit", shellHandler("/usr/bin/env"), eventJson, options),
    );

    expect(outcome.status).toBe("succeeded");
    // An outcome keeps the last 500 characters of output; a longer listing would be cut at the front and misread.
    expect(outcome.message?.startsWith("…")).toBe(false);
    return Object.fromEntries(
      (outcome.message ?? "").split("\n").map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
    );
  }

  it("is the documented list, and cannot be widened at runtime", () => {
    expect([...SHELL_ENV_ALLOWLIST].sort()).toEqual([
      "ENSEMBLE_COMMAND",
      "ENSEMBLE_EVENT",
      "ENSEMBLE_PROJECT_ROOT",
      "ENSEMBLE_RUN_ID",
      "HOME",
      "LANG",
      "PATH",
      "TERM",
      "TMPDIR",
      "USER",
    ]);
    expect(() => (SHELL_ENV_ALLOWLIST as string[]).push("AWS_SECRET_ACCESS_KEY")).toThrow(TypeError);
  });

  it("gives the handler only the allowlisted variables and the ENSEMBLE_* ones the runner sets", async () => {
    const seen = await seenEnvironment(NOT_FOR_HANDLERS);

    expect(seen).toEqual({
      ...ALLOWLISTED,
      ENSEMBLE_EVENT: "command.start",
      ENSEMBLE_RUN_ID: "run-42",
      ENSEMBLE_COMMAND: "ensemble:create-prd",
      ENSEMBLE_PROJECT_ROOT: root,
    });
    expect(seen).not.toHaveProperty("SHELL_RUNNER_TEST_SECRET");
  });

  it("gives the handler the run id from the event JSON, not the one in the parent's environment", async () => {
    const seen = await seenEnvironment({ ENSEMBLE_RUN_ID: "run-from-parent" });

    expect(seen.ENSEMBLE_RUN_ID).toBe("run-42");
  });

  it("leaves a variable unset, not empty and not the parent's, when there is nothing to put in it", async () => {
    const eventWithoutIds = JSON.stringify({ event: "command.end" });

    const seen = await seenEnvironment({ ...NOT_FOR_HANDLERS, TERM: undefined, LANG: undefined }, eventWithoutIds);

    expect(seen).not.toHaveProperty("TERM");
    expect(seen).not.toHaveProperty("LANG");
    expect(seen).not.toHaveProperty("ENSEMBLE_RUN_ID");
    expect(seen).not.toHaveProperty("ENSEMBLE_COMMAND");
    expect(seen.ENSEMBLE_EVENT).toBe("command.end");
  });

  it("still runs a handler whose event is not JSON, without the per-event variables", async () => {
    const seen = await seenEnvironment(NOT_FOR_HANDLERS, "not json {");

    expect(seen).not.toHaveProperty("ENSEMBLE_EVENT");
    expect(seen).not.toHaveProperty("ENSEMBLE_RUN_ID");
    expect(seen).not.toHaveProperty("ENSEMBLE_COMMAND");
    expect(seen.ENSEMBLE_PROJECT_ROOT).toBe(root);
  });

  it("passes the project root as an absolute path even when given a relative one", async () => {
    const seen = await seenEnvironment({}, EVENT_JSON, { projectRoot: relative(process.cwd(), root) });

    expect(seen.ENSEMBLE_PROJECT_ROOT).toBe(root);
  });
});

describePosix("output bound (AC-009-4)", () => {
  /** A shell line that prints `count` bytes of `char` on stdout, or on stderr when `fd` is 2. */
  const printed = (count: number, char: string, fd: 1 | 2 = 1): string =>
    `head -c ${count} /dev/zero | tr '\\0' ${char}${fd === 2 ? " >&2" : ""}`;

  it("is 64 KiB", () => {
    expect(SHELL_OUTPUT_BOUND_BYTES).toBe(BOUND);
  });

  it("keeps exactly the bound and says so when the output is one byte over", async () => {
    // BOUND - 1 'a's, then X (the last byte that fits), then Y (the first byte that does not).
    const handler = shellHandler(script("one-over", `${printed(BOUND - 1, "a")}\nprintf X\nprintf Y`));

    const outcome = await run(handler);

    expect(outcome).toMatchObject({ status: "succeeded", exit_code: 0, truncated: true });
    expect(outcome.message).toMatch(/aX$/);
  });

  it("does not call output exactly at the bound truncated", async () => {
    const handler = shellHandler(script("exact", `${printed(BOUND - 1, "a")}\nprintf X`));

    const outcome = await run(handler);

    expect(outcome.status).toBe("succeeded");
    expect(outcome).not.toHaveProperty("truncated");
    expect(outcome.message).toMatch(/aX$/);
  });

  it("holds stdout and stderr together to one bound", async () => {
    const half = BOUND / 2;
    const exact = shellHandler(script("split-exact", `${printed(half, "a")}\n${printed(half, "b", 2)}`));
    const over = shellHandler(script("split-over", `${printed(half, "a")}\n${printed(half + 1, "b", 2)}`));

    const [atBound, overBound] = [await run(exact), await run(over)];

    expect(atBound.status).toBe("succeeded");
    expect(atBound).not.toHaveProperty("truncated");
    expect(overBound).toMatchObject({ status: "succeeded", truncated: true });
  });

  it("keeps reading a handler that writes far more than the bound, so it is never blocked on a full pipe", async () => {
    const handler = shellHandler(script("flood", printed(4 * 1024 * 1024, "a")), [], { timeout_ms: 3000 });

    const outcome = await run(handler);

    expect(outcome).toMatchObject({ status: "succeeded", exit_code: 0, truncated: true });
    expect(outcome.duration_ms).toBeLessThan(3000);
  });
});

describePosix("timeout (AC-009-5)", () => {
  /**
   * A handler that starts a background `sleep` that keeps the output pipes open, records both pids and waits for it.
   * With `ignoreSigterm`, neither process dies to SIGTERM (the sleep inherits the ignored signal). 4711 is an unusual
   * duration, so a leftover shows up in `pgrep -fl 'sleep 4711'`.
   */
  function processTree(ignoreSigterm: boolean): string {
    return script(
      "leader",
      [
        ...(ignoreSigterm ? ["trap '' TERM"] : []),
        `echo $$ > ${sq(join(pids, "leader"))}`,
        "sleep 4711 &",
        `echo $! > ${sq(join(pids, "background"))}`,
        "wait",
      ].join("\n"),
    );
  }

  it("returns timed_out, and neither the handler nor a process it started is alive afterwards", async () => {
    const outcome = await run(shellHandler(processTree(false), [], { timeout_ms: 1500 }));

    expect(outcome.status).toBe("timed_out");
    expect(outcome).not.toHaveProperty("exit_code");
    expect(outcome.message).toContain("timed out after 1500 ms");
    expect(outcome.duration_ms).toBeGreaterThanOrEqual(1400);
    expect(await survivors([readPid("leader"), readPid("background")])).toEqual([]);
  });

  it("still ends a handler and a background process that both ignore SIGTERM", async () => {
    const outcome = await run(shellHandler(processTree(true), [], { timeout_ms: 1500 }));

    expect(outcome.status).toBe("timed_out");
    expect(await survivors([readPid("leader"), readPid("background")])).toEqual([]);
  });

  it("does not time out early when timeout_ms is longer than a Node timer can wait", async () => {
    // setTimeout silently turns a delay above 2 ** 31 - 1 ms into 1 ms.
    const outcome = await run(shellHandler(script("slow", "sleep 0.3"), [], { timeout_ms: 2 ** 31 }));

    expect(outcome).toMatchObject({ status: "succeeded", exit_code: 0 });
  });
});

describePosix("exit status (AC-009-6)", () => {
  it("exit 0 is succeeded with exit code 0, and says nothing when the handler printed nothing", async () => {
    const outcome = await run(shellHandler(script("quiet", "exit 0")));

    expect(outcome).toEqual({ handler: "audit", status: "succeeded", exit_code: 0, duration_ms: expect.any(Number) });
  });

  it("keeps what a succeeding handler printed as the outcome's message", async () => {
    const outcome = await run(shellHandler(script("chatty", "echo 'all checks passed'")));

    expect(outcome).toMatchObject({ status: "succeeded", exit_code: 0, message: "all checks passed" });
  });

  it.each([1, 2, 3, 127, 255])("exit %i is failed and carries that exit code", async (code) => {
    const handler = shellHandler(script("fails", `echo 'stdout text'\necho 'stderr text' >&2\nexit ${code}`));

    const outcome = await run(handler);

    expect(outcome).toMatchObject({ handler: "audit", status: "failed", exit_code: code });
    expect(outcome.message).toContain(`code ${code}`);
    expect(outcome.message).toContain("stdout text");
    expect(outcome.message).toContain("stderr text");
  });

  it.each(["KILL", "TERM"])("a handler killed by SIG%s is failed, with a message naming the signal and no exit code", async (signal) => {
    const outcome = await run(shellHandler(script("dies", `kill -s ${signal} $$`)));

    expect(outcome.status).toBe("failed");
    expect(outcome).not.toHaveProperty("exit_code");
    expect(outcome.message).toContain(`SIG${signal}`);
  });
});

describePosix("a handler that cannot start", () => {
  // Each of these resolves with a failed outcome: awaiting `run` throws if the runner threw or rejected instead.

  it("fails with a message naming the command when a bare command is not on the PATH", async () => {
    const outcome = await withEnv({ PATH: "/usr/bin:/bin" }, () => run(shellHandler("ensemble-no-such-hook")));

    expect(outcome).toMatchObject({ handler: "audit", status: "failed" });
    expect(outcome).not.toHaveProperty("exit_code");
    expect(outcome.duration_ms).toBeGreaterThanOrEqual(0);
    expect(outcome.message).toContain('could not start "ensemble-no-such-hook"');
    expect(outcome.message).toContain('no executable named "ensemble-no-such-hook" on PATH');
  });

  it("points at the shell-line mistake when a bare command contains whitespace", async () => {
    const outcome = await run(shellHandler("echo hello"));

    expect(outcome.status).toBe("failed");
    expect(outcome.message).toContain("one executable");
    expect(outcome.message).toContain("`args`");
  });

  it("fails with the resolved path when a relative command does not exist", async () => {
    const outcome = await run(shellHandler("./bin/not-there"));

    expect(outcome.status).toBe("failed");
    expect(outcome).not.toHaveProperty("exit_code");
    expect(outcome.duration_ms).toBeGreaterThanOrEqual(0);
    expect(outcome.message).toContain('could not start "./bin/not-there"');
    expect(outcome.message).toContain(`no such file: ${join(root, "bin", "not-there")}`);
  });

  it("says permission was denied for a file that is not executable", async () => {
    writeFileSync(join(bin, "plain"), "#!/bin/sh\nexit 0\n", { mode: 0o644 });

    const outcome = await run(shellHandler("./bin/plain"));

    expect(outcome.status).toBe("failed");
    expect(outcome.message).toContain("permission denied");
  });

  it("explains a script whose #! interpreter is missing, which the OS reports as a missing file", async () => {
    const file = join(bin, "bad-interpreter");
    writeFileSync(file, "#!/no/such/interpreter\n");
    chmodSync(file, 0o755);

    const outcome = await run(shellHandler("./bin/bad-interpreter"));

    expect(outcome.status).toBe("failed");
    expect(outcome.message).toContain("#! interpreter");
  });

  it("names the project root when that is what does not exist", async () => {
    const missing = join(root, "no-such-dir");

    const outcome = await runShellHandler("audit", shellHandler("/usr/bin/env"), EVENT_JSON, { projectRoot: missing });

    expect(outcome.status).toBe("failed");
    expect(outcome.message).toContain("the project root does not exist");
    expect(outcome.message).toContain(missing);
  });

  it("fails rather than throws when an argument cannot be passed to a process", async () => {
    const outcome = await run(shellHandler("/usr/bin/env", ["null\0byte"]));

    expect(outcome.status).toBe("failed");
    expect(outcome).not.toHaveProperty("exit_code");
    expect(outcome.message).toContain('could not start "/usr/bin/env"');
  });
});

describePosix("project root and the outcome's fields", () => {
  it.each(["./bin/where", "bin/where"])(
    "resolves the relative command %s against the project root and runs the handler there",
    async (command) => {
      const reported = join(out, "cwd");
      script("where", `pwd -P > ${sq(reported)}`);

      const outcome = await run(shellHandler(command));

      // Neither the command nor the working directory may come from the process's own cwd.
      expect(process.cwd()).not.toBe(root);
      expect(outcome.status).toBe("succeeded");
      expect(readFileSync(reported, "utf8").trim()).toBe(realpathSync(root));
    },
  );

  it("defaults the project root to the current working directory", async () => {
    const reported = join(out, "cwd");
    const handler = shellHandler(script("where", `pwd -P > ${sq(reported)}`));

    const outcome = await runShellHandler("audit", handler, EVENT_JSON);

    expect(outcome.status).toBe("succeeded");
    expect(readFileSync(reported, "utf8").trim()).toBe(realpathSync(process.cwd()));
  });

  it("names the handler and reports the elapsed time in whole, non-negative milliseconds", async () => {
    const outcome = await run(shellHandler(script("quick", "exit 0")));

    expect(outcome.handler).toBe("audit");
    expect(Number.isInteger(outcome.duration_ms)).toBe(true);
    expect(outcome.duration_ms).toBeGreaterThanOrEqual(0);
  });
});
