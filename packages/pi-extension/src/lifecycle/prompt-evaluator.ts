/**
 * Headless prompt-handler evaluator for command lifecycle hooks.
 *
 * Evaluates a `prompt` handler by running a child `pi` with no session, no
 * extensions, no tools and no prompt templates, so the child can neither edit
 * an artifact nor fire a lifecycle event of its own (no recursion).
 *
 * The prompt runner owns the timeout. When it fires it aborts `signal`; this
 * module then kills the child's whole process group so no grandchild survives.
 * There is deliberately no timer here that could race the runner's.
 */
import { spawn } from "node:child_process";
import type { PromptEvaluator } from "@sunstone-partners/ensemble-agent-core";

export interface HeadlessPromptEvaluatorOptions {
  /** Pi executable, resolved through PATH when not absolute. Defaults to `pi`. */
  piBinary?: string;
  /** Working directory of the child. Defaults to the current working directory. */
  cwd?: string;
}

/** Arguments before the message: print mode, no session, no extensions, no tools, no prompt templates. */
const PI_ARGS = ["-p", "--no-session", "-ne", "-nt", "-np"];

/** How long a SIGTERMed process group has before it is SIGKILLed. */
const KILL_GRACE_MS = 2000;

/** How much of the child's stderr is kept for the failure message. */
const STDERR_TAIL_CHARS = 2000;

const PROTOCOL_SUFFIX = [
  "Respond with a single JSON object and nothing else (no prose, no code fence), of this shape:",
  '{"continue": boolean, "message"?: string, "findings"?: [{"message": string, "severity"?: "info"|"warning"|"error", "path"?: string}]}',
  'Set "continue" to false only to ask that the command be blocked.',
  "The lifecycle event you are evaluating follows.",
].join("\n");

function buildMessage(prompt: string, eventJson: string): string {
  return `${prompt}\n\n${PROTOCOL_SUFFIX}\n\n\`\`\`json\n${eventJson}\n\`\`\``;
}

/**
 * Signals a child's process group. The child is its own group leader because
 * it is spawned detached, so `-pid` reaches it and every descendant that stayed
 * in the group. ESRCH (group already empty) is expected and ignored.
 */
function signalGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch {
    // Group already gone.
  }
}

export function createHeadlessPromptEvaluator(options: HeadlessPromptEvaluatorOptions = {}): PromptEvaluator {
  const piBinary = options.piBinary ?? "pi";

  return ({ prompt, eventJson, signal }) =>
    new Promise<string>((resolve, reject) => {
      if (signal.aborted) {
        reject(new Error("prompt evaluation aborted before start"));
        return;
      }

      const child = spawn(piBinary, [...PI_ARGS, buildMessage(prompt, eventJson)], {
        cwd: options.cwd,
        shell: false,
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderrTail = "";
      let settled = false;
      let killTimer: NodeJS.Timeout | undefined;

      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk: string) => {
        stderrTail = (stderrTail + chunk).slice(-STDERR_TAIL_CHARS);
      });

      const onAbort = (): void => {
        if (child.pid === undefined) return;
        signalGroup(child.pid, "SIGTERM");
        // Escalate to SIGKILL after the grace period; the timer is cleared on
        // close, and unref'd so it never holds the process open.
        killTimer = setTimeout(() => signalGroup(child.pid as number, "SIGKILL"), KILL_GRACE_MS);
        killTimer.unref();
        finish(() => reject(new Error("prompt evaluation aborted")));
      };

      const finish = (settle: () => void): void => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", onAbort);
        settle();
      };

      signal.addEventListener("abort", onAbort, { once: true });

      child.on("error", (error) => {
        clearTimeout(killTimer);
        finish(() => reject(error));
      });

      child.on("close", (code, termination) => {
        clearTimeout(killTimer);
        // A direct child that exits on SIGTERM can leave grandchildren in the
        // group; sweep the group once the child is gone so none outlives it.
        if (child.pid !== undefined) signalGroup(child.pid, "SIGKILL");
        finish(() => {
          if (code === 0) {
            resolve(stdout);
            return;
          }
          const how = termination ? `signal ${termination}` : `code ${code}`;
          const detail = stderrTail.trim();
          reject(new Error(`pi exited with ${how}${detail ? `: ${detail}` : ""}`));
        });
      });
    });
}
