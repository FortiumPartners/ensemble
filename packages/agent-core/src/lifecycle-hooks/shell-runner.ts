/**
 * Shell handler runner (REQ-009, TRD-004).
 *
 * Runs one configured executable at a lifecycle boundary and reports what
 * happened as a `HandlerOutcome`. Every way a run can go wrong, including a
 * failure to start the process at all, is an outcome: this never throws and
 * the returned promise never rejects for a handler problem.
 *
 * What it guarantees:
 *
 * - No shell (AC-009-2). The executable is started with an argument array and
 *   `shell: false`, so no argument is ever interpreted. A `command` that
 *   contains a slash resolves against the project root (the rule the
 *   configuration validator checks); a bare name is looked up on the
 *   allowlisted PATH. The command's own arguments reach the handler only
 *   inside the event JSON on stdin, never on its command line or environment.
 * - The event on stdin (AC-009-1). The event JSON is written exactly as given,
 *   then stdin is closed. A handler that never reads it cannot stall the run.
 * - An environment allowlist (AC-009-3). The handler sees only the variables
 *   in `SHELL_ENV_ALLOWLIST`, never the parent environment.
 * - Bounded output (AC-009-4). At most `SHELL_OUTPUT_BOUND_BYTES` of stdout and
 *   stderr combined are kept. The rest is still read, so the handler is never
 *   blocked on a full pipe, but it is discarded and the outcome says
 *   `truncated`.
 * - A timeout that ends the whole tree (AC-009-5). When `timeout_ms` elapses
 *   the handler's process group is sent SIGTERM, then SIGKILL after
 *   `KILL_GRACE_MS`, so everything it started dies with it, and the outcome is
 *   `timed_out`. The outcome is returned once the group is gone; if it still
 *   shows processes a second after SIGKILL, the message says so.
 * - Exit status (AC-009-6). Exit 0 is `succeeded`; anything else is `failed`,
 *   with `exit_code` when the process exited on its own.
 * - A short `message`. For a handler that did not succeed it gives the reason
 *   (exit code, signal, timeout, or why it could not start) followed by the
 *   last `MESSAGE_OUTPUT_CHARS` characters of the output that was kept; a
 *   handler that succeeded gets just that output, and a silent one gets none.
 *
 * Limits worth knowing:
 *
 * - The handler is done when its stdout and stderr close, not only when its
 *   own process exits. A handler that leaves a background process holding
 *   those pipes open is still running, so it runs into its timeout and the
 *   background process is killed with it. Redirect a background process's
 *   output (`cmd >/dev/null 2>&1 &`) to keep it alive past the handler.
 * - A process that starts its own session or process group escapes the group
 *   kill. On Windows there are no process groups; the tree is ended with
 *   `taskkill /T /F` (untested on Windows).
 * - On POSIX the handler runs in its own session: it has no controlling
 *   terminal, does not receive the host's terminal signals, and is not
 *   stopped if the host process itself is killed mid-run.
 * - A group counts as gone once its dead members are reaped. In a container
 *   whose PID 1 never reaps orphans (Node itself as PID 1, without an init),
 *   killed grandchildren stay zombies, which still answer `kill(pid, 0)`. The
 *   run then waits out both grace periods and the message says it could not
 *   confirm that everything exited, though the processes are dead.
 * - The handler's own output in `message` is not redacted here.
 */

import { ChildProcessByStdio, spawn, spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { performance } from "perf_hooks";
import { Readable, Writable } from "stream";
import { setTimeout as delay } from "timers/promises";
import { HandlerOutcome, HandlerStatus, ShellHandler } from "./types";
import { isRecord } from "../type-guards";

/**
 * Every environment variable a shell handler can see (AC-009-3); nothing else
 * is passed. The first six are copied from the parent environment when set.
 * The `ENSEMBLE_*` four are set by the runner and never inherited from the
 * parent: ENSEMBLE_EVENT, ENSEMBLE_RUN_ID and ENSEMBLE_COMMAND carry the event
 * JSON's `event`, `run_id` and `command` (unset when the JSON lacks them), and
 * ENSEMBLE_PROJECT_ROOT is the absolute project root.
 */
export const SHELL_ENV_ALLOWLIST: readonly string[] = Object.freeze([
  "PATH",
  "HOME",
  "USER",
  "LANG",
  "TMPDIR",
  "TERM",
  "ENSEMBLE_EVENT",
  "ENSEMBLE_RUN_ID",
  "ENSEMBLE_COMMAND",
  "ENSEMBLE_PROJECT_ROOT",
]);

/**
 * The most output kept from one run, stdout and stderr combined (AC-009-4):
 * 64 KiB. Beyond it the output is discarded and the outcome is `truncated`.
 */
export const SHELL_OUTPUT_BOUND_BYTES = 64 * 1024;

export interface ShellRunOptions {
  /**
   * The handler's working directory, and the base for a relative `command`
   * that contains a slash. Defaults to the current working directory.
   */
  projectRoot?: string;
}

/** Longest delay a Node timer accepts; a longer one silently fires after 1 ms. */
const MAX_TIMER_MS = 2 ** 31 - 1;
/** After SIGTERM, how long the process group gets to exit before SIGKILL. */
const KILL_GRACE_MS = 500;
/** After SIGKILL, how long to wait for the group to be gone before giving up. */
const KILL_CONFIRM_MS = 1000;
const GROUP_POLL_MS = 10;
/** Characters of the handler's output kept in `message`. */
const MESSAGE_OUTPUT_CHARS = 500;

/** The allowlisted environment for one run. See `SHELL_ENV_ALLOWLIST`. */
function buildEnv(projectRoot: string, eventJson: string): NodeJS.ProcessEnv {
  let event: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(eventJson);
    if (isRecord(parsed)) event = parsed;
  } catch {
    // Not JSON: the handler still runs, just without the per-event variables.
  }
  const setByRunner: Record<string, unknown> = {
    ENSEMBLE_EVENT: event.event,
    ENSEMBLE_RUN_ID: event.run_id,
    ENSEMBLE_COMMAND: event.command,
    ENSEMBLE_PROJECT_ROOT: projectRoot,
  };
  const env: NodeJS.ProcessEnv = {};
  for (const name of SHELL_ENV_ALLOWLIST) {
    const value = name.startsWith("ENSEMBLE_") ? setByRunner[name] : process.env[name];
    if (typeof value === "string") env[name] = value;
  }
  return env;
}

/** Why the process could not be started, in terms of what the user wrote. */
function startFailureMessage(handler: ShellHandler, executable: string, projectRoot: string, error: unknown): string {
  const code = isRecord(error) ? error.code : undefined;
  const prefix = `could not start "${handler.command}"`;
  if (code === "ENOENT") {
    // Node reports a missing working directory exactly like a missing executable.
    if (!fs.existsSync(projectRoot)) return `${prefix}: the project root does not exist: ${projectRoot}`;
    if (handler.command.includes("/")) {
      return fs.existsSync(executable)
        ? `${prefix}: the file exists but could not be executed (is its #! interpreter installed?)`
        : `${prefix}: no such file: ${executable}`;
    }
    const hint = /\s/.test(handler.command) ? " (`command` is one executable, not a shell line; put arguments in `args`)" : "";
    return `${prefix}: no executable named "${handler.command}" on PATH${hint}`;
  }
  if (code === "EACCES") return `${prefix}: permission denied (is the file executable?)`;
  return `${prefix}: ${isRecord(error) && typeof error.message === "string" ? error.message : String(error)}`;
}

/** The last part of the captured output, trimmed, for `message`. */
function outputTail(chunks: Buffer[]): string {
  const text = Buffer.concat(chunks).toString("utf8").trim();
  return text.length > MESSAGE_OUTPUT_CHARS ? `…${text.slice(-MESSAGE_OUTPUT_CHARS)}` : text;
}

function signalGroup(pgid: number, signal: "SIGTERM" | "SIGKILL"): void {
  try {
    process.kill(-pgid, signal);
  } catch {
    // ESRCH: every process in the group has already exited.
  }
}

function groupAlive(pgid: number): boolean {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function groupGone(pgid: number, withinMs: number): Promise<boolean> {
  const deadline = performance.now() + withinMs;
  while (groupAlive(pgid)) {
    if (performance.now() >= deadline) return false;
    await delay(GROUP_POLL_MS);
  }
  return true;
}

/**
 * End the handler and everything it started: SIGTERM to its process group,
 * SIGKILL after the grace period if anything is left. Resolves `true` once the
 * group is gone, `false` if it still shows processes after SIGKILL.
 */
async function terminateTree(pid: number): Promise<boolean> {
  if (process.platform === "win32") {
    return spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true }).status === 0;
  }
  signalGroup(pid, "SIGTERM");
  if (await groupGone(pid, KILL_GRACE_MS)) return true;
  signalGroup(pid, "SIGKILL");
  return groupGone(pid, KILL_CONFIRM_MS);
}

/**
 * Run a shell handler once. `eventJson` is the serialized lifecycle event; it
 * is delivered on the handler's stdin exactly as given.
 */
export function runShellHandler(
  name: string,
  handler: ShellHandler,
  eventJson: string,
  options: ShellRunOptions = {},
): Promise<HandlerOutcome> {
  const startedAt = performance.now();
  const projectRoot = path.resolve(options.projectRoot ?? process.cwd());
  const executable = handler.command.includes("/") ? path.resolve(projectRoot, handler.command) : handler.command;

  return new Promise<HandlerOutcome>((resolve) => {
    const chunks: Buffer[] = [];
    let captured = 0;
    let truncated = false;
    let finished = false;
    let timedOut = false;
    // `finish` can run before the timer below is created (a spawn that fails at once), so the binding must exist first.
    // eslint-disable-next-line prefer-const
    let timer: NodeJS.Timeout | undefined;

    const finish = (result: { status: HandlerStatus; exit_code?: number; reason?: string }): void => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      const output = outputTail(chunks);
      const message = result.reason && output ? `${result.reason}: ${output}` : result.reason || output;
      const outcome: HandlerOutcome = {
        handler: name,
        status: result.status,
        duration_ms: Math.round(performance.now() - startedAt),
      };
      if (result.exit_code !== undefined) outcome.exit_code = result.exit_code;
      if (truncated) outcome.truncated = true;
      if (message) outcome.message = message;
      resolve(outcome);
    };

    const capture = (chunk: Buffer): void => {
      const room = SHELL_OUTPUT_BOUND_BYTES - captured;
      if (chunk.length > room) truncated = true;
      if (room > 0) {
        const kept = chunk.subarray(0, room);
        chunks.push(kept);
        captured += kept.length;
      }
    };

    let child: ChildProcessByStdio<Writable, Readable, Readable>;
    try {
      child = spawn(executable, handler.args, {
        cwd: projectRoot,
        env: buildEnv(projectRoot, eventJson),
        shell: false,
        detached: process.platform !== "win32",
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (error) {
      // spawn throws for arguments it cannot pass on, e.g. a NUL byte.
      finish({ status: "failed", reason: startFailureMessage(handler, executable, projectRoot, error) });
      return;
    }

    child.on("error", (error) =>
      finish({ status: "failed", reason: startFailureMessage(handler, executable, projectRoot, error) }),
    );
    const pid = child.pid;
    // No pid means the process never started; the 'error' event reports why.
    if (pid === undefined) return;

    // A broken pipe on any stdio stream (EPIPE when the handler exits without
    // reading its input) must not escape as an unhandled 'error' event; the
    // exit status is the result.
    for (const stream of [child.stdin, child.stdout, child.stderr]) stream.on("error", () => undefined);
    child.stdout.on("data", capture);
    child.stderr.on("data", capture);
    // Not awaited: a handler that ignores stdin must not hold up the run.
    child.stdin.end(eventJson);

    child.on("close", (code, signal) => {
      if (timedOut) return; // the timeout path reports this run
      if (code === 0) finish({ status: "succeeded", exit_code: 0 });
      else if (code !== null) finish({ status: "failed", exit_code: code, reason: `exited with code ${code}` });
      else finish({ status: "failed", reason: `terminated by signal ${signal}` });
    });

    timer = setTimeout(() => {
      timedOut = true;
      void terminateTree(pid).then((gone) => {
        // Destroying our read ends frees the pipes even if a process that left
        // the group still holds the other ends.
        child.stdout.destroy();
        child.stderr.destroy();
        const ending = gone ? "and was terminated" : "and was killed, but could not confirm that all of its processes exited";
        finish({ status: "timed_out", reason: `timed out after ${handler.timeout_ms} ms ${ending}` });
      });
    }, Math.min(handler.timeout_ms, MAX_TIMER_MS));
  });
}
