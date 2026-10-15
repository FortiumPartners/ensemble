/**
 * Prompt handler runner (REQ-011).
 *
 * Reads the handler's prompt file, hands its text and the exact event JSON to
 * an injected evaluator, and parses the evaluator's raw output against the
 * typed response contract `{ continue, message?, findings? }`.
 *
 * Failure must never look like success: a malformed, non-conforming or missing
 * response, a failed read, a thrown evaluator and a timeout all produce a
 * `failed` / `timed_out` outcome, never `succeeded`, and `run` never throws.
 * The runner only reads the prompt file; it has no way to write a file.
 */

import { promises as fsPromises } from "node:fs";
import * as path from "node:path";
import { isRecord } from "../type-guards";
import type { Finding, HandlerOutcome, PromptHandler, PromptResponse } from "./types";

/**
 * Runs a prompt against the event in a model and returns the model's raw stdout.
 * `signal` aborts when the runner's timeout fires; an evaluator that started a
 * process must stop it then, because the runner has already moved on.
 */
export type PromptEvaluator = (input: {
  prompt: string;
  eventJson: string;
  timeoutMs: number;
  signal: AbortSignal;
}) => Promise<string>;

export interface PromptRunnerOptions {
  /** Directory the handler's `prompt` path is relative to. Defaults to the current working directory. */
  projectRoot?: string;
  /** Reads a prompt file as UTF-8 text. Defaults to the filesystem. */
  readFile?: (absolutePath: string) => Promise<string>;
}

export type ParsePromptResponseResult =
  | { ok: true; response: PromptResponse }
  | { ok: false; reason: string };

const RESPONSE_KEYS: readonly string[] = ["continue", "message", "findings"];
const SEVERITIES: readonly string[] = ["info", "warning", "error"];

/**
 * Returns the source text of every top-level brace-balanced `{...}` span in
 * `text` (string-literal aware), or a reason if a `{` never closes.
 */
function topLevelObjectSpans(text: string): { spans: string[] } | { error: string } {
  const spans: string[] = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] !== "{") {
      i++;
      continue;
    }
    let depth = 0;
    let inString = false;
    let end = -1;
    for (let j = i; j < text.length; j++) {
      const ch = text[j];
      if (inString) {
        if (ch === "\\") j++;
        else if (ch === '"') inString = false;
      } else if (ch === '"') {
        inString = true;
      } else if (ch === "{") {
        depth++;
      } else if (ch === "}") {
        depth--;
        if (depth === 0) {
          end = j;
          break;
        }
      }
    }
    if (end === -1) return { error: "response contains an unterminated JSON object" };
    spans.push(text.slice(i, end + 1));
    i = end + 1;
  }
  return { spans };
}

/** Extracts the single JSON object in `text`, tolerating a fence or surrounding prose. */
function extractJsonObject(text: string): { value: unknown } | { error: string } {
  const trimmed = text.trim();
  if (trimmed === "") return { error: "response is empty" };

  try {
    return { value: JSON.parse(trimmed) };
  } catch {
    // Not bare JSON; look for exactly one object inside a fence or prose.
  }

  const found = topLevelObjectSpans(trimmed);
  if ("error" in found) return found;

  const parsed: unknown[] = [];
  for (const span of found.spans) {
    try {
      const value: unknown = JSON.parse(span);
      if (isRecord(value)) parsed.push(value);
    } catch {
      // Prose braces that are not JSON.
    }
  }
  if (parsed.length === 0) return { error: "response contains no JSON object" };
  if (parsed.length > 1) return { error: "response contains more than one JSON object" };
  return { value: parsed[0] };
}

function validateFinding(raw: unknown, index: number): { finding: Finding } | { error: string } {
  const at = `findings[${index}]`;
  if (!isRecord(raw)) return { error: `${at} must be an object` };
  if (typeof raw.message !== "string") return { error: `${at}.message must be a string` };
  const finding: Finding = { message: raw.message };
  if (raw.severity !== undefined) {
    if (typeof raw.severity !== "string" || !SEVERITIES.includes(raw.severity)) {
      return { error: `${at}.severity must be one of info, warning, error` };
    }
    finding.severity = raw.severity as Finding["severity"];
  }
  if (raw.path !== undefined) {
    if (typeof raw.path !== "string") return { error: `${at}.path must be a string` };
    finding.path = raw.path;
  }
  return { finding };
}

/**
 * Parses a prompt evaluator's raw output. Accepts only
 * `{ continue: boolean, message?: string, findings?: Finding[] }` with no
 * other top-level fields; anything else is `{ ok: false }`.
 */
export function parsePromptResponse(text: string): ParsePromptResponseResult {
  if (typeof text !== "string") return { ok: false, reason: "response is not text" };

  const extracted = extractJsonObject(text);
  if ("error" in extracted) return { ok: false, reason: extracted.error };

  const value = extracted.value;
  if (!isRecord(value)) return { ok: false, reason: "response is not a JSON object" };

  const extras = Object.keys(value).filter((key) => !RESPONSE_KEYS.includes(key));
  if (extras.length > 0) {
    return { ok: false, reason: `response has unexpected field(s): ${extras.join(", ")}` };
  }
  if (typeof value.continue !== "boolean") {
    return { ok: false, reason: 'response field "continue" must be a boolean' };
  }
  if (value.message !== undefined && typeof value.message !== "string") {
    return { ok: false, reason: 'response field "message" must be a string' };
  }

  const response: PromptResponse = { continue: value.continue };
  if (value.message !== undefined) response.message = value.message as string;

  if (value.findings !== undefined) {
    if (!Array.isArray(value.findings)) {
      return { ok: false, reason: 'response field "findings" must be an array' };
    }
    const findings: Finding[] = [];
    for (let i = 0; i < value.findings.length; i++) {
      const result = validateFinding(value.findings[i], i);
      if ("error" in result) return { ok: false, reason: result.error };
      findings.push(result.finding);
    }
    response.findings = findings;
  }
  return { ok: true, response };
}

/** Sentinel the timeout timer settles with, so it cannot be confused with an evaluator result. */
const TIMED_OUT = Symbol("prompt-evaluator-timed-out");

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Runs one prompt handler. Never throws: every failure is reported as a
 * `failed` or `timed_out` outcome. `continue: false` is a `failed` outcome so
 * the dispatcher applies the handler's `on_error`.
 */
export async function runPromptHandler(
  name: string,
  handler: PromptHandler,
  eventJson: string,
  evaluator: PromptEvaluator,
  options: PromptRunnerOptions = {},
): Promise<HandlerOutcome> {
  const started = Date.now();
  const outcome = (fields: Omit<HandlerOutcome, "handler" | "duration_ms">): HandlerOutcome => ({
    handler: name,
    duration_ms: Date.now() - started,
    ...fields,
  });

  const projectRoot = options.projectRoot ?? process.cwd();
  const readFile = options.readFile ?? ((file: string) => fsPromises.readFile(file, "utf8"));

  let prompt: string;
  try {
    prompt = await readFile(path.resolve(projectRoot, handler.prompt));
  } catch (error) {
    return outcome({ status: "failed", message: `could not read prompt file ${handler.prompt}: ${errorText(error)}` });
  }

  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(TIMED_OUT);
    }, handler.timeout_ms);
  });

  let raw: string | typeof TIMED_OUT;
  try {
    // Promise.resolve().then also turns a synchronous throw from the evaluator into a rejection.
    const evaluation = Promise.resolve().then(() =>
      evaluator({ prompt, eventJson, timeoutMs: handler.timeout_ms, signal: controller.signal }),
    );
    // The timeout may win the race; a later rejection must not become an unhandled one.
    evaluation.catch(() => undefined);
    raw = await Promise.race([evaluation, timeout]);
  } catch (error) {
    return outcome({ status: "failed", message: `prompt evaluation failed: ${errorText(error)}` });
  } finally {
    clearTimeout(timer);
  }

  if (raw === TIMED_OUT) {
    return outcome({ status: "timed_out", message: `prompt handler exceeded its ${handler.timeout_ms}ms timeout` });
  }

  const parsed = parsePromptResponse(raw);
  if (!parsed.ok) {
    return outcome({ status: "failed", message: `malformed prompt response: ${parsed.reason}` });
  }

  const { response } = parsed;
  const fields: Omit<HandlerOutcome, "handler" | "duration_ms"> = {
    status: response.continue ? "succeeded" : "failed",
  };
  if (response.message !== undefined) fields.message = response.message;
  else if (!response.continue) fields.message = "prompt handler responded continue: false";
  if (response.findings !== undefined) fields.findings = response.findings;
  return outcome(fields);
}
