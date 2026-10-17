/**
 * Load and validate `.ensemble/hooks.yaml` (REQ-006, REQ-007, REQ-010).
 *
 * Boundary validation: the file is validated in full before any handler can
 * run, and every failure names the offending entry. A project with no hooks
 * file is not an error (`absent`, REQ-008). Nothing here executes anything.
 *
 * The file shape:
 *
 *   version: 1
 *   hooks:
 *     audit: { type: shell, command: ./scripts/audit.sh, args: [], on_error: continue }
 *     review: { type: prompt, prompt: ./prompts/review.md, on_error: continue }
 *   commands:
 *     ensemble:create-prd: { start: [audit], end: [review, audit] }
 *
 * The event selection is the `start` / `end` lists on a command, so a
 * command entry that selects neither is rejected as having no event
 * selection (AC-007-1).
 */

import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";
import {
  DEFAULT_PROMPT_TIMEOUT_MS,
  DEFAULT_SHELL_TIMEOUT_MS,
  CommandSelection,
  ConfigError,
  ErrorPolicy,
  Handler,
  HooksConfig,
  LoadHooksResult,
  SelectionKey,
} from "./types";
import { isRecord } from "../type-guards";

/** Location of the hooks file, relative to the project root. */
export const HOOKS_FILE_RELATIVE = ".ensemble/hooks.yaml";

/** Commands are named explicitly; wildcards and groups never match (AC-006-4). */
const COMMAND_NAME_RE = /^ensemble:[a-z0-9][a-z0-9-]*$/;

const SELECTION_KEYS: readonly SelectionKey[] = ["start", "end"];
const ERROR_POLICIES: readonly ErrorPolicy[] = ["continue", "block"];

export interface ValidateOptions {
  /** Used to resolve relative handler files. */
  projectRoot: string;
  /** When given, a command name must also be a member of this set. */
  knownCommands?: ReadonlySet<string>;
  /** Overridable for tests; defaults to a real regular-file check. */
  fileExists?: (absolutePath: string) => boolean;
}

export type ValidateResult =
  | { ok: true; config: HooksConfig }
  | { ok: false; errors: ConfigError[] };

function defaultFileExists(absolutePath: string): boolean {
  try {
    return fs.statSync(absolutePath).isFile();
  } catch {
    return false;
  }
}

function checkUnknownFields(
  obj: Record<string, unknown>,
  allowed: readonly string[],
  at: string,
  errors: ConfigError[],
): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) {
      errors.push({ path: `${at}.${key}`, message: `unknown field "${key}"` });
    }
  }
}

function validateHandler(
  name: string,
  raw: unknown,
  opts: ValidateOptions,
  fileExists: (p: string) => boolean,
  errors: ConfigError[],
): Handler | undefined {
  const at = `hooks.${name}`;
  if (!isRecord(raw)) {
    errors.push({ path: at, message: `handler "${name}" must be a mapping` });
    return undefined;
  }
  const before = errors.length;

  const type = raw.type;
  if (type === undefined) {
    errors.push({ path: `${at}.type`, message: `handler "${name}" is missing required field "type" (shell or prompt)` });
  } else if (type !== "shell" && type !== "prompt") {
    errors.push({ path: `${at}.type`, message: `handler "${name}" has invalid type ${JSON.stringify(type)} (expected shell or prompt)` });
  }

  const common = ["type", "timeout_ms", "on_error"];
  if (type === "shell") checkUnknownFields(raw, [...common, "command", "args"], at, errors);
  else if (type === "prompt") checkUnknownFields(raw, [...common, "prompt"], at, errors);
  else checkUnknownFields(raw, [...common, "command", "args", "prompt"], at, errors);

  let onError: ErrorPolicy | undefined;
  if (raw.on_error === undefined) {
    errors.push({ path: `${at}.on_error`, message: `handler "${name}" is missing required field "on_error" (continue or block); no default is applied` });
  } else if (!ERROR_POLICIES.includes(raw.on_error as ErrorPolicy)) {
    errors.push({ path: `${at}.on_error`, message: `handler "${name}" has invalid on_error ${JSON.stringify(raw.on_error)} (expected continue or block)` });
  } else {
    onError = raw.on_error as ErrorPolicy;
  }

  let timeout: number | undefined;
  if (raw.timeout_ms !== undefined) {
    if (typeof raw.timeout_ms !== "number" || !Number.isInteger(raw.timeout_ms) || raw.timeout_ms <= 0) {
      errors.push({ path: `${at}.timeout_ms`, message: `handler "${name}" has invalid timeout_ms ${JSON.stringify(raw.timeout_ms)} (expected a positive integer number of milliseconds)` });
    } else {
      timeout = raw.timeout_ms;
    }
  }

  if (type === "shell") {
    const command = raw.command;
    let args: string[] = [];
    if (typeof command !== "string" || command.trim() === "") {
      errors.push({ path: `${at}.command`, message: `shell handler "${name}" is missing required field "command" (an executable path or name, never a shell line)` });
    } else if (command.includes("/") && !fileExists(path.resolve(opts.projectRoot, command))) {
      errors.push({ path: `${at}.command`, message: `shell handler "${name}" names a missing executable file: ${command}` });
    }
    if (raw.args !== undefined) {
      if (!Array.isArray(raw.args) || !raw.args.every((a) => typeof a === "string")) {
        errors.push({ path: `${at}.args`, message: `shell handler "${name}" has invalid args (expected an array of strings)` });
      } else {
        args = raw.args as string[];
      }
    }
    if (errors.length > before || onError === undefined || typeof command !== "string") return undefined;
    return { type: "shell", command, args, timeout_ms: timeout ?? DEFAULT_SHELL_TIMEOUT_MS, on_error: onError };
  }

  if (type === "prompt") {
    const promptFile = raw.prompt;
    if (typeof promptFile !== "string" || promptFile.trim() === "") {
      errors.push({ path: `${at}.prompt`, message: `prompt handler "${name}" is missing required field "prompt" (a path to a prompt file)` });
    } else if (!fileExists(path.resolve(opts.projectRoot, promptFile))) {
      errors.push({ path: `${at}.prompt`, message: `prompt handler "${name}" names a missing prompt file: ${promptFile}` });
    }
    if (errors.length > before || onError === undefined || typeof promptFile !== "string") return undefined;
    return { type: "prompt", prompt: promptFile, timeout_ms: timeout ?? DEFAULT_PROMPT_TIMEOUT_MS, on_error: onError };
  }

  return undefined;
}

function validateSelection(
  command: string,
  raw: unknown,
  handlers: Record<string, Handler | undefined>,
  opts: ValidateOptions,
  errors: ConfigError[],
): CommandSelection | undefined {
  const at = `commands.${command}`;
  if (!COMMAND_NAME_RE.test(command)) {
    errors.push({
      path: at,
      message: `unknown command "${command}": commands are named explicitly as "ensemble:<name>"; wildcards and groups are not supported`,
    });
    return undefined;
  }
  if (opts.knownCommands && !opts.knownCommands.has(command)) {
    errors.push({ path: at, message: `unknown command "${command}": no such Ensemble command` });
    return undefined;
  }
  if (!isRecord(raw)) {
    errors.push({ path: at, message: `command "${command}" must be a mapping with start and/or end lists` });
    return undefined;
  }
  const before = errors.length;

  for (const key of Object.keys(raw)) {
    if (!SELECTION_KEYS.includes(key as SelectionKey)) {
      errors.push({ path: `${at}.${key}`, message: `command "${command}" has unknown event name "${key}" (expected "start" or "end")` });
    }
  }

  const selection: CommandSelection = { start: [], end: [] };
  for (const key of SELECTION_KEYS) {
    const list = raw[key];
    if (list === undefined) continue;
    if (!Array.isArray(list) || !list.every((n) => typeof n === "string")) {
      errors.push({ path: `${at}.${key}`, message: `command "${command}" ${key} must be a list of handler names` });
      continue;
    }
    list.forEach((handlerName: string, i: number) => {
      const entry = `${at}.${key}[${i}]`;
      if (!Object.prototype.hasOwnProperty.call(handlers, handlerName)) {
        errors.push({ path: entry, message: `command "${command}" ${key} references unknown handler "${handlerName}"` });
        return;
      }
      const handler = handlers[handlerName];
      if (key === "end" && handler && handler.on_error === "block") {
        errors.push({
          path: entry,
          message: `command "${command}" end selects handler "${handlerName}" which has on_error "block"; block is only valid for start handlers`,
        });
      }
      selection[key].push(handlerName);
    });
  }

  if (errors.length === before && selection.start.length === 0 && selection.end.length === 0) {
    errors.push({ path: at, message: `command "${command}" has no event selection (give it a non-empty start and/or end list)` });
  }
  return errors.length > before ? undefined : selection;
}

/** Validate an already-parsed hooks document. Returns every error, not just the first. */
export function validateHooksConfig(raw: unknown, opts: ValidateOptions): ValidateResult {
  const errors: ConfigError[] = [];
  const fileExists = opts.fileExists ?? defaultFileExists;

  if (!isRecord(raw)) {
    return { ok: false, errors: [{ path: "", message: "the hooks file must be a mapping with version, hooks and commands" }] };
  }
  checkUnknownFields(raw, ["version", "hooks", "commands"], "", errors);
  // A top-level unknown field is reported as ".foo"; trim the leading dot.
  for (const e of errors) e.path = e.path.replace(/^\./, "");

  if (raw.version !== 1) {
    errors.push({ path: "version", message: `version must be 1, got ${JSON.stringify(raw.version)}` });
  }

  const handlers: Record<string, Handler | undefined> = {};
  if (!isRecord(raw.hooks)) {
    errors.push({ path: "hooks", message: `"hooks" must be a mapping of handler name to handler` });
  } else {
    for (const [name, h] of Object.entries(raw.hooks)) {
      handlers[name] = validateHandler(name, h, opts, fileExists, errors);
    }
  }

  const commands: Record<string, CommandSelection> = {};
  if (!isRecord(raw.commands)) {
    errors.push({ path: "commands", message: `"commands" must be a mapping of command name to its start/end selection` });
  } else {
    for (const [command, sel] of Object.entries(raw.commands)) {
      // A handler that failed its own validation is already reported; treat
      // it as defined so a reference to it does not add a second error.
      const result = validateSelection(command, sel, handlers, opts, errors);
      if (result) commands[command] = result;
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  const defined: Record<string, Handler> = {};
  for (const [name, h] of Object.entries(handlers)) if (h) defined[name] = h;
  return { ok: true, config: { version: 1, hooks: defined, commands } };
}

/**
 * Read `.ensemble/hooks.yaml` from a project. Absent is not an error; a file
 * that does not parse or does not validate is `invalid` with every error.
 */
export function loadHooksConfig(projectRoot: string, opts?: Omit<ValidateOptions, "projectRoot">): LoadHooksResult {
  const file = path.join(projectRoot, HOOKS_FILE_RELATIVE);
  if (!(opts?.fileExists ?? defaultFileExists)(file)) return { status: "absent" };

  let parsed: unknown;
  try {
    parsed = yaml.load(fs.readFileSync(file, "utf8"));
  } catch (e) {
    return { status: "invalid", errors: [{ path: HOOKS_FILE_RELATIVE, message: `could not parse the hooks file: ${(e as Error).message}` }] };
  }
  const result = validateHooksConfig(parsed, { ...opts, projectRoot });
  return result.ok ? { status: "valid", config: result.config } : { status: "invalid", errors: result.errors };
}
