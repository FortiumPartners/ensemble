#!/usr/bin/env node
/**
 * Opt-in live smoke for command lifecycle hooks: a real Pi, a real model and the BUNDLED extension (TRD-015;
 * PRD AC-015-1, AC-015-2, AC-019-3).
 *
 *   ENSEMBLE_LIVE_SMOKE=1 node scripts/smoke-lifecycle.mjs
 *   ENSEMBLE_LIVE_SMOKE=1 npm run test:smoke:lifecycle
 *
 * What it does. It builds agent-core and the extension bundle the way scripts/install.mjs does (the bun arguments
 * are read from that script), into a throwaway directory, and writes a shim that loads the bundle the way the
 * installed shim does. It then runs `pi -p --no-session -e <shim> -ne` in a throwaway project whose
 * `.ensemble/hooks.yaml` selects one real Ensemble command, `ensemble:sprint-status` (its prompt, from
 * packages/pi/prompts, is given to Pi with --prompt-template), with a shell start handler and a shell end handler.
 * Each handler appends one line to a log. The script prints the log, and the run passes only if the model produced
 * output and the log shows `command.start` and then `command.end`, once each, for one run.
 *
 * What a pass shows and what it does not. It shows that, in a real Pi with the extension loaded from its bundle
 * and a real model, a real command's start handler ran and its end handler ran after it, once each, for one run.
 * It does not time the model against the start handler: that the prompt waits for a running start handler is
 * shown where the test can hold the handler open, in tests/lifecycle-entrypoint.test.ts. The end comes from the
 * first signal Pi gives the extension: the model calling `ensemble_command_complete`, an error, an abort or the
 * end of the session. Whether the model calls the completion tool is the model's choice, so the script says which
 * signal ended this run; when the model does not call it, the end arrives at shutdown with outcome `cancelled`,
 * which is the design (a command that never says it is done is never reported as succeeded).
 *
 * Skipped, with exit code 0 and a line starting `SKIPPED:`, when:
 *   - ENSEMBLE_LIVE_SMOKE is unset (or 0, false, no): nothing is built, started or written;
 *   - `pi` or `bun` cannot be run;
 *   - there is no usable model: the model's provider is not defined in models.json, or a one-word preflight
 *     question to the model, asked with no extension loaded, gets no answer.
 * It never reports a pass without a model run. A failure after the model has answered the preflight exits 1.
 *
 * Isolation. HOME and PI_CODING_AGENT_DIR are fresh directories under the system temp directory, so Pi's state,
 * the trust record and everything the run writes stay there; the directory is removed at the end. Pi runs with
 * -ne -ns -nc: no discovered extensions, skills or context files. The only things read from the user's own setup
 * are the provider definition of the chosen model in models.json (read-only, copied to the throwaway agent
 * directory with mode 0600, because a custom provider is defined there) and the repository's own sources. The
 * model has Pi's read-only tools and the completion tool, in the throwaway project, and nothing that writes.
 * Trust is recorded to the throwaway HOME's store with agent-core's own `recordTrust`, the call the trust command
 * makes: `/ensemble-lifecycle-trust` needs an interactive UI and `pi -p` has none. The script checks that the
 * real `~/.ensemble` is as it found it.
 *
 * Environment:
 *   ENSEMBLE_LIVE_SMOKE         set to run (required)
 *   ENSEMBLE_SMOKE_PI           the pi executable (default: pi)
 *   ENSEMBLE_SMOKE_MODEL        provider/model (default: litellm/qwen)
 *   ENSEMBLE_SMOKE_MODELS_JSON  the models.json to take the provider from
 *                               (default: $PI_CODING_AGENT_DIR/models.json, else ~/.pi/agent/models.json)
 *   ENSEMBLE_SMOKE_TIMEOUT_MS   how long the lifecycle run may take (default: 900000)
 *   ENSEMBLE_SMOKE_TOOLS        the tools the model may use (default: read,grep,find,ls,ensemble_command_complete);
 *                               leave ensemble_command_complete out to watch the end arrive at shutdown as cancelled
 *   ENSEMBLE_SMOKE_KEEP         set to keep the throwaway directory (it holds the copied provider definition)
 */
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const AGENT_CORE = resolve(PKG, "..", "agent-core");
const INSTALL_SCRIPT = join(PKG, "scripts", "install.mjs");
const PROMPT_FILE = resolve(PKG, "..", "pi", "prompts", "ensemble-sprint-status.md");

/** The real command the hooks select, and what the user types for it. */
const COMMAND = "ensemble:sprint-status";
const SLASH_COMMAND = "/ensemble-sprint-status";

const PI = process.env.ENSEMBLE_SMOKE_PI || "pi";
const MODEL = process.env.ENSEMBLE_SMOKE_MODEL || "litellm/qwen";
const RUN_TIMEOUT_MS = Number(process.env.ENSEMBLE_SMOKE_TIMEOUT_MS) || 15 * 60_000;
const PREFLIGHT_TIMEOUT_MS = 2 * 60_000;
const KILL_GRACE_MS = 5000;
const HEARTBEAT_MS = 30_000;

/** The environment variables Pi gets from this process besides the ones that isolate it. */
const PASS_THROUGH = [
  "LANG",
  "LC_ALL",
  "TMPDIR",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "ALL_PROXY",
  "http_proxy",
  "https_proxy",
  "no_proxy",
  "all_proxy",
  "NODE_EXTRA_CA_CERTS",
  "SSL_CERT_FILE",
];

/** The tools the model may use: read-only ones, and the tool the extension registers to end a command. */
const TOOLS = process.env.ENSEMBLE_SMOKE_TOOLS || "read,grep,find,ls,ensemble_command_complete";

/** A reason to exit 0 without having run the smoke. */
class Skip extends Error {}
/** A reason to exit 1. */
class Failure extends Error {}

/** The version line of `command --version`, or undefined when it cannot be run. */
function versionOf(command) {
  const result = spawnSync(command, ["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (result.error !== undefined || result.status !== 0) return undefined;
  return (result.stdout.trim() || result.stderr.trim()).split("\n")[0];
}

/** Runs a command to completion; anything but success is a failure that shows what it printed. */
function runChecked(what, command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  if (result.error !== undefined || result.status !== 0) {
    const why = result.error !== undefined ? result.error.message : `exit ${result.status}`;
    throw new Failure(`${what} failed (${why}):\n${result.stderr ?? ""}${result.stdout ?? ""}`.trimEnd());
  }
  return result;
}

/** `text` as one POSIX shell word. */
function shellQuote(text) {
  return `'${text.replaceAll("'", `'\\''`)}'`;
}

/** The first `max` characters of `text`, flattened to one line. */
function excerpt(text, max = 300) {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}...` : flat;
}

/**
 * The arguments scripts/install.mjs gives bun, with `outfile` in place of its BUNDLE path, so the bundle built
 * here is the one the installer builds. Fails, saying so, if that call changes shape.
 */
function bunBuildArguments(outfile) {
  const call = /execFileSync\(\s*"bun",\s*\[([^\]]*)\]/.exec(readFileSync(INSTALL_SCRIPT, "utf8"));
  if (!call) throw new Failure('scripts/install.mjs no longer calls execFileSync("bun", [ ... ]) in the shape this script reads: update bunBuildArguments()');
  return call[1]
    .split(",")
    .map((raw) => raw.trim())
    .filter((raw) => raw !== "")
    .map((raw) => {
      const quoted = /^(["`])([\s\S]*)\1$/.exec(raw);
      if (!quoted) throw new Failure(`cannot read the bun argument ${raw} from scripts/install.mjs`);
      const value = quoted[2].replace("${BUNDLE}", outfile);
      if (value.includes("${")) throw new Failure(`the bun argument ${raw} in scripts/install.mjs interpolates something besides BUNDLE`);
      return value;
    });
}

/**
 * The provider definition of MODEL from the user's models.json, which is the only thing taken from the user's own
 * Pi setup. A model with no definition there is not available to the isolated Pi.
 */
function modelProvider() {
  const slash = MODEL.indexOf("/");
  const provider = slash === -1 ? "" : MODEL.slice(0, slash);
  const modelId = MODEL.slice(slash + 1);
  if (provider === "" || modelId === "") throw new Skip(`no usable model: ENSEMBLE_SMOKE_MODEL is "${MODEL}", and it must be provider/model`);

  const source =
    process.env.ENSEMBLE_SMOKE_MODELS_JSON || join(process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent"), "models.json");
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(source, "utf8"));
  } catch (error) {
    throw new Skip(`no usable model: cannot read ${source} (${error instanceof Error ? error.message : String(error)})`);
  }
  const providers = parsed !== null && typeof parsed === "object" ? parsed.providers : undefined;
  const definition = providers !== null && typeof providers === "object" && Object.hasOwn(providers, provider) ? providers[provider] : undefined;
  if (definition === undefined || definition === null || typeof definition !== "object") {
    throw new Skip(`no usable model: ${source} defines no provider "${provider}"`);
  }
  if (Array.isArray(definition.models) && !definition.models.some((model) => model !== null && typeof model === "object" && model.id === modelId)) {
    throw new Skip(`no usable model: provider "${provider}" in ${source} lists no model "${modelId}"`);
  }
  return { provider, definition, source };
}

/** The environment Pi runs in: isolated, with only what it needs to reach the model passed through. */
function piEnvironment(home, agentDir) {
  const env = {
    PATH: process.env.PATH ?? "",
    HOME: home,
    PI_CODING_AGENT_DIR: agentDir,
    PI_OFFLINE: "1",
    PI_SKIP_VERSION_CHECK: "1",
    PI_TELEMETRY: "0",
    TERM: "dumb",
  };
  for (const name of PASS_THROUGH) if (process.env[name] !== undefined) env[name] = process.env[name];
  return env;
}

/**
 * Runs `pi` with `args` in `cwd`, collects what it prints, and ends it (its whole process group) if it outlives
 * `timeoutMs`. Resolves with the exit status, or `timedOut`. Prints a line on stderr every HEARTBEAT_MS while it
 * runs. An interrupt of this script ends pi's group too and rejects, so the caller still removes the sandbox.
 */
function runPi(args, options) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(PI, args, { cwd: options.cwd, env: options.env, stdio: ["ignore", "pipe", "pipe"], detached: true });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const started = Date.now();
    const endGroup = (signal) => {
      try {
        process.kill(-child.pid, signal);
      } catch {
        // The group is already gone.
      }
    };
    const heartbeat = setInterval(() => {
      process.stderr.write(`  ... ${options.label} still running (${Math.round((Date.now() - started) / 1000)} s)\n`);
    }, HEARTBEAT_MS);
    const deadline = setTimeout(() => {
      timedOut = true;
      endGroup("SIGTERM");
      setTimeout(() => endGroup("SIGKILL"), KILL_GRACE_MS).unref();
    }, options.timeoutMs);
    const settle = (finish) => {
      clearInterval(heartbeat);
      clearTimeout(deadline);
      process.off("SIGINT", onInterrupt);
      process.off("SIGTERM", onInterrupt);
      finish();
    };
    const onInterrupt = (signal) => {
      endGroup(signal);
      settle(() => rejectRun(new Failure(`interrupted by ${signal}`)));
    };
    process.once("SIGINT", onInterrupt);
    process.once("SIGTERM", onInterrupt);

    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", (error) => settle(() => rejectRun(error)));
    child.on("close", (status, signal) => settle(() => resolveRun({ status, signal, timedOut, stdout, stderr, seconds: (Date.now() - started) / 1000 })));
  });
}

/** What ended the command, said in words, from the end event. */
function describeEnd(end) {
  const reason = typeof end.reason === "string" ? end.reason : "";
  if (end.outcome === "cancelled" && /session ended/i.test(reason)) {
    return "no completion signal reached the extension (the model did not call ensemble_command_complete), so the end arrived at session shutdown as cancelled";
  }
  if (end.outcome === "cancelled" && /aborted/i.test(reason)) return "the loop was aborted";
  if (end.outcome === "cancelled") return "the next command began before this one ended";
  if (end.outcome === "failed" && /ended in an error/i.test(reason)) return "the agent loop ended in an error";
  return `the model called ensemble_command_complete (outcome ${end.outcome}); the end handlers ran when the loop settled, after the final output`;
}

async function main() {
  const optedIn = !["", "0", "false", "no"].includes((process.env.ENSEMBLE_LIVE_SMOKE ?? "").trim().toLowerCase());
  if (!optedIn) {
    throw new Skip(
      "ENSEMBLE_LIVE_SMOKE is not set. This smoke starts a real Pi and calls a real model, so it only runs when asked: " +
        "ENSEMBLE_LIVE_SMOKE=1 node scripts/smoke-lifecycle.mjs. Nothing was built, started or written.",
    );
  }
  const piVersion = versionOf(PI);
  if (piVersion === undefined) throw new Skip(`cannot run "${PI} --version": no pi to drive (set ENSEMBLE_SMOKE_PI to the pi executable)`);
  const bunVersion = versionOf("bun");
  if (bunVersion === undefined) throw new Skip('cannot run "bun --version": bun builds the bundle, as scripts/install.mjs does');
  if (!existsSync(PROMPT_FILE)) throw new Failure(`the real command's prompt is missing: ${PROMPT_FILE}`);
  const { provider, definition, source } = modelProvider();

  const realEnsemble = join(homedir(), ".ensemble");
  const realEnsembleExisted = existsSync(realEnsemble);
  const root = mkdtempSync(join(realpathSync(tmpdir()), "ensemble-lifecycle-smoke-"));
  try {
    const home = join(root, "home");
    const agentDir = join(root, "agent");
    const project = join(root, "project");
    const out = join(root, "out");
    const bundleDir = join(root, "bundle");
    for (const dir of [home, agentDir, project, out, bundleDir]) mkdirSync(dir);
    const env = piEnvironment(home, agentDir);
    writeFileSync(join(agentDir, "models.json"), `${JSON.stringify({ providers: { [provider]: definition } }, null, 2)}\n`, { mode: 0o600 });

    console.log(`pi:      ${PI} ${piVersion}`);
    console.log(`bun:     ${bunVersion}`);
    console.log(`model:   ${MODEL} (provider "${provider}" read from ${source}, nothing else is read from your Pi setup)`);
    console.log(`sandbox: ${root}`);

    // A model that cannot answer one word is not available: skip, rather than blame the extension.
    console.log("preflight: asking the model for one word, with no extension loaded ...");
    const preflight = await runPi(
      ["-p", "--no-session", "-ne", "-nt", "-ns", "-nc", "--no-mcp", "--model", MODEL, "Reply with exactly the single word PONG and nothing else."],
      { cwd: root, env, timeoutMs: PREFLIGHT_TIMEOUT_MS, label: "preflight" },
    );
    if (preflight.status !== 0 || preflight.stdout.trim() === "") {
      const why = preflight.timedOut ? `no answer within ${PREFLIGHT_TIMEOUT_MS} ms` : `exit ${preflight.status ?? preflight.signal}`;
      throw new Skip(`no usable model: the preflight question to ${MODEL} failed (${why}): ${excerpt(preflight.stderr || preflight.stdout)}`);
    }
    console.log(`preflight: ${MODEL} answered in ${preflight.seconds.toFixed(1)} s`);

    console.log("building agent-core and the extension bundle (as scripts/install.mjs does) ...");
    runChecked("building agent-core", process.execPath, [createRequire(import.meta.url).resolve("typescript/bin/tsc"), "-p", AGENT_CORE], { cwd: PKG });
    const bundle = join(bundleDir, "extension.bundle.cjs");
    runChecked("building the extension bundle", "bun", bunBuildArguments(bundle), { cwd: PKG });
    // The shim is the installed one in effect: it loads the bundle with createRequire and calls what it exports.
    const shim = join(bundleDir, "ensemble-lifecycle-smoke-shim.ts");
    writeFileSync(
      shim,
      `import { createRequire } from "node:module";

let inner;
try {
  inner = createRequire(${JSON.stringify(bundle)})(${JSON.stringify(bundle)});
  inner = inner?.default ?? inner;
} catch (e) {
  console.error("[ensemble] extension failed to load:", e?.message ?? e);
}

export default function (pi) {
  if (typeof inner !== "function") return;
  try {
    inner(pi);
  } catch (e) {
    console.error("[ensemble] extension failed to activate:", e?.message ?? e);
  }
}
`,
    );

    // The project: an anchor for the repository root, the hooks file, the handler and a small TRD for the command to read.
    const log = join(out, "lifecycle.log");
    const eventsFile = join(out, "lifecycle-events.jsonl");
    mkdirSync(join(project, ".git"));
    mkdirSync(join(project, ".ensemble"));
    mkdirSync(join(project, "scripts"));
    mkdirSync(join(project, "docs", "TRD"), { recursive: true });
    writeFileSync(
      join(project, "scripts", "record.sh"),
      `#!/bin/sh
# One line per lifecycle event in the log, and the event as the handler was given it.
printf '%s %s %s\\n' "$ENSEMBLE_EVENT" "$ENSEMBLE_RUN_ID" "$ENSEMBLE_COMMAND" >> ${shellQuote(log)}
cat >> ${shellQuote(eventsFile)}
printf '\\n' >> ${shellQuote(eventsFile)}
`,
    );
    chmodSync(join(project, "scripts", "record.sh"), 0o755);
    writeFileSync(
      join(project, ".ensemble", "hooks.yaml"),
      `version: 1
hooks:
  smoke-start: { type: shell, command: ./scripts/record.sh, args: [], on_error: continue }
  smoke-end: { type: shell, command: ./scripts/record.sh, args: [], on_error: continue }
commands:
  ${COMMAND}: { start: [smoke-start], end: [smoke-end] }
`,
    );
    writeFileSync(join(project, "docs", "TRD", "TRD-smoke.md"), "# TRD: smoke fixture\n\n## Master Task List\n\n- [x] **TRD-001** First task\n- [ ] **TRD-002** Second task\n");

    // The user's trust in the hooks, recorded where the trust command records it, in the throwaway home.
    const core = createRequire(import.meta.url)(AGENT_CORE);
    const loaded = core.loadHooksConfig(project, { knownCommands: new Set([COMMAND]) });
    if (loaded.status !== "valid") throw new Failure(`the smoke's own hooks file is ${loaded.status}: ${JSON.stringify(loaded.errors ?? [])}`);
    const storePath = join(home, ".ensemble", "trusted-hooks.json");
    if (!storePath.startsWith(`${root}${sep}`)) throw new Failure(`refusing to record trust outside the sandbox: ${storePath}`);
    core.recordTrust(project, core.computeHooksDigest(project, loaded.config), { storePath });

    console.log(`running: pi -p --no-session -e <shim> -ne ${SLASH_COMMAND}   (the model may take minutes; timeout ${RUN_TIMEOUT_MS} ms)`);
    const run = await runPi(
      [
        "-p",
        "--no-session",
        "-e",
        shim,
        "-ne",
        "-ns",
        "-nc",
        "--no-mcp",
        "--tools",
        TOOLS,
        "--prompt-template",
        PROMPT_FILE,
        "--model",
        MODEL,
        SLASH_COMMAND,
      ],
      { cwd: project, env, timeoutMs: RUN_TIMEOUT_MS, label: "pi" },
    );

    const logLines = existsSync(log) ? readFileSync(log, "utf8").split("\n").filter((line) => line !== "") : [];
    const eventLines = existsSync(eventsFile) ? readFileSync(eventsFile, "utf8").split("\n").filter((line) => line !== "") : [];
    const events = eventLines.map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return { unreadable: line };
      }
    });
    console.log(`\npi exited with ${run.timedOut ? "a timeout" : (run.status ?? run.signal)} after ${run.seconds.toFixed(1)} s`);
    console.log(`\n== what the model printed (${Buffer.byteLength(run.stdout)} bytes) ==\n${excerpt(run.stdout, 600) || "(nothing)"}`);
    console.log(`\n== what the extension showed on stderr ==\n${run.stderr.trim() || "(nothing)"}`);
    console.log(`\n== lifecycle.log: what the shell hooks appended, in order ==`);
    console.log(logLines.length === 0 ? "(empty)" : logLines.map((line, index) => `${index + 1}  ${line}`).join("\n"));

    const problems = [];
    if (run.timedOut) problems.push(`pi did not finish within ${RUN_TIMEOUT_MS} ms and was ended`);
    else if (run.status !== 0) problems.push(`pi exited with ${run.status ?? run.signal}`);
    if (run.stdout.trim() === "") problems.push("the model printed nothing, so no model run is shown");
    if (/\[ensemble\] extension failed|Extension error/.test(run.stderr)) problems.push("Pi reported an extension error (see stderr above)");
    if (logLines.length !== 2) problems.push(`expected exactly 2 lines in lifecycle.log (start, then end), found ${logLines.length}`);
    const [start, end] = events;
    if (logLines.length === 2) {
      const [first, second] = logLines.map((line) => line.split(" "));
      if (first[0] !== "command.start" || second[0] !== "command.end") problems.push("the log is not command.start followed by command.end");
      else if (first[1] !== second[1]) problems.push("the start and the end carry different run ids");
      if (first[2] !== COMMAND || second[2] !== COMMAND) problems.push(`the log names a command other than ${COMMAND}`);
    }
    if (events.length !== 2 || start?.event !== "command.start" || end?.event !== "command.end") {
      problems.push("the events the handlers were given are not one command.start followed by one command.end");
    } else {
      if (start.run_id !== end.run_id) problems.push("the start and end events carry different run ids");
      if (typeof start.timestamp !== "string" || typeof end.timestamp !== "string" || end.timestamp < start.timestamp) {
        problems.push("the end event is not later than the start event");
      }
    }
    if (existsSync(realEnsemble) !== realEnsembleExisted) problems.push(`${realEnsemble} was ${realEnsembleExisted ? "removed" : "created"}`);

    if (problems.length > 0) throw new Failure(problems.map((problem) => `- ${problem}`).join("\n"));
    console.log(`\n== the end event ==\noutcome: ${end.outcome}${end.reason ? `\nreason:  ${excerpt(end.reason, 200)}` : ""}${end.summary ? `\nsummary: ${excerpt(end.summary, 200)}` : ""}`);
    console.log(`how it ended: ${describeEnd(end)}`);
    console.log(
      `\nPASSED: the model ran (pi exited 0 after ${run.seconds.toFixed(1)} s and printed ${Buffer.byteLength(run.stdout)} bytes), and the shell hooks recorded ` +
        `command.start and then command.end, once each, for one run of ${COMMAND}.`,
    );
  } finally {
    if (process.env.ENSEMBLE_SMOKE_KEEP) console.log(`\nkept: ${root} (it holds a copy of the provider definition from models.json)`);
    else rmSync(root, { recursive: true, force: true });
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    if (error instanceof Skip) {
      console.log(`SKIPPED: ${error.message}`);
      process.exit(0);
    }
    console.error(`\nFAILED: ${error instanceof Failure ? error.message : (error?.stack ?? String(error))}`);
    process.exit(1);
  },
);
