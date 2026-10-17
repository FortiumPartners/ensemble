/**
 * Build and redact lifecycle event payloads (REQ-005).
 *
 * Every handler, shell or prompt, receives the same event, built here and
 * redacted before any handler sees it (AC-005-3). The event type has no
 * transcript field and the builders copy only the named fields, so extra
 * properties on an input never reach a handler.
 *
 * Redaction replaces a value, not the surrounding sentence: free text such as
 * "password reset flow" is left alone, while `password=hunter2` becomes
 * `password=[REDACTED]`. Redaction is applied to the free-text fields only:
 * `arguments`, `reason`, `summary` and each `artifacts` entry.
 *
 * The two lists below, SECRET_PATTERNS and SENSITIVE_VARIABLE_NAMES, are the
 * documented lists the guide cites (REQ-018).
 */

import type { CommandOutcome, LifecycleEvent } from "./types";

/** The fixed replacement for a redacted value (AC-005-3). */
export const REDACTION_MARKER = "[REDACTED]";

/** One named secret shape. The whole match is replaced by REDACTION_MARKER. */
export interface SecretPattern {
  name: string;
  /** Global regex; used only with String.prototype.replace, never `.test`. */
  pattern: RegExp;
}

/** A quoted or bare value following `=` (an unterminated quote runs to the end). */
const VALUE = String.raw`"[^"]*(?:"|$)|'[^']*(?:'|$)|\S+`;

/** Words that mark a name as holding a secret when it is followed by `=`. */
const SECRET_WORDS = String.raw`api[_-]?key|apikey|token|secret|password|passwd`;

/**
 * Secret shapes, applied in order. Patterns that only describe a value use a
 * lookbehind so the name or prefix that precedes it is kept.
 *
 * Deliberate choices, to keep ordinary text intact:
 * - `key=value` needs a literal `=`; prose such as "password reset flow" or
 *   "max_tokens: 5" does not match.
 * - `Bearer <token>` needs 20 or more token characters.
 * - Hex runs of 32 or more are redacted except exactly 40, which is the
 *   length of a git commit id that people legitimately pass as an argument.
 * - Base64-looking runs need 40 or more characters and a digit, an uppercase
 *   and a lowercase letter, and may not be preceded or followed by a path,
 *   word or hyphen character, so file paths and kebab-case names pass. The
 *   known cost: an unbroken run of 40+ letters, digits and slashes with mixed
 *   case and a digit (for example a long relative path with no `.`, `-` or
 *   `_`) is redacted; `/` is allowed because AWS secret keys contain it.
 */
export const SECRET_PATTERNS: readonly SecretPattern[] = Object.freeze([
  {
    name: "private-key-block",
    pattern:
      /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  },
  {
    name: "bearer-token",
    pattern: /(?<=\bBearer\s+)[A-Za-z0-9._~+/-]{20,}=*/gi,
  },
  {
    name: "secret-key-value",
    pattern: new RegExp(String.raw`(?<=(?:${SECRET_WORDS})["']?\s*=\s*)(?:${VALUE})`, "gi"),
  },
  {
    name: "secret-flag-value",
    pattern: new RegExp(
      String.raw`(?<=--[\w-]*(?:${SECRET_WORDS})\s+)(?!-)(?:${VALUE})`,
      "gi",
    ),
  },
  {
    name: "url-credentials",
    pattern: /(?<=\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:)[^\s/@]+(?=@)/gi,
  },
  { name: "jwt", pattern: /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g },
  {
    name: "aws-access-key-id",
    pattern: /\b(?:AKIA|ASIA|AGPA|AIDA|AROA|ANPA|ANVA|AIPA)[A-Z0-9]{16}\b/g,
  },
  {
    name: "github-token",
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})\b/g,
  },
  { name: "slack-token", pattern: /\bxox[abeoprs]-[A-Za-z0-9-]{10,}/g },
  { name: "npm-token", pattern: /\bnpm_[A-Za-z0-9]{36}\b/g },
  { name: "google-api-key", pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { name: "api-secret-key", pattern: /\bsk-[A-Za-z0-9_-]{20,}/g },
  {
    name: "long-hex",
    pattern: /(?<![0-9A-Za-z])(?:[0-9a-fA-F]{32,39}|[0-9a-fA-F]{41,})(?![0-9A-Za-z])/g,
  },
  {
    name: "long-base64",
    pattern:
      /(?<![A-Za-z0-9+/_.-])(?=[A-Za-z0-9+/]*\d)(?=[A-Za-z0-9+/]*[a-z])(?=[A-Za-z0-9+/]*[A-Z])[A-Za-z0-9+/]{40,}={0,2}(?![A-Za-z0-9+/_-])/g,
  },
]);

/**
 * Variable names whose value is a secret. Matched case-insensitively against
 * the whole name, with `-` read as `_` (so `--api-key=x` and `API_KEY=x`
 * agree); `*` matches any run of letters, digits and underscores.
 *
 * A `NAME=value` in text has its value replaced. A `$NAME` or `${NAME}`
 * reference is replaced whole: the text never carries the value itself, but a
 * handler that expands it would, so the reference is not passed on.
 */
export const SENSITIVE_VARIABLE_NAMES: readonly string[] = Object.freeze([
  "TOKEN",
  "SECRET",
  "PASSWORD",
  "PASSWD",
  "API_KEY",
  "APIKEY",
  "CREDENTIALS",
  "*_TOKEN",
  "*_SECRET",
  "*_PASSWORD",
  "*_PASSWD",
  "*_API_KEY",
  "*_APIKEY",
  "*_ACCESS_KEY",
  "*_SECRET_KEY",
  "*_PRIVATE_KEY",
  "*_CREDENTIALS",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
]);

const SENSITIVE_NAME_REGEXES: readonly RegExp[] = SENSITIVE_VARIABLE_NAMES.map(
  (glob) =>
    new RegExp(`^${glob.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[A-Z0-9_]*")}$`),
);

function isSensitiveName(name: string): boolean {
  const normalized = name.toUpperCase().replace(/-/g, "_");
  return SENSITIVE_NAME_REGEXES.some((re) => re.test(normalized));
}

/** `NAME=value` (optionally `--NAME=value`): group 1 prefix, 2 name, 3 `=`, 4 value. */
const ASSIGNMENT = new RegExp(String.raw`(?<![\w-])((?:--)?)([A-Za-z_][\w-]*)(=)(${VALUE})`, "g");

/** `$NAME` or `${NAME}`. */
const VARIABLE_REFERENCE = /\$(?:\{([A-Za-z_]\w*)\}|([A-Za-z_]\w*))/g;

/** Replace every secret value in `text` with REDACTION_MARKER. Idempotent. */
export function redactText(text: string): string {
  let out = text.replace(
    ASSIGNMENT,
    (match, prefix: string, name: string, eq: string) =>
      isSensitiveName(name) ? `${prefix}${name}${eq}${REDACTION_MARKER}` : match,
  );
  out = out.replace(VARIABLE_REFERENCE, (match, braced?: string, bare?: string) =>
    isSensitiveName((braced ?? bare) as string) ? REDACTION_MARKER : match,
  );
  for (const { pattern } of SECRET_PATTERNS) {
    out = out.replace(pattern, REDACTION_MARKER);
  }
  return out;
}

/** What identifies a command run; shared by start and end. */
export interface StartEventInput {
  run_id: string;
  command: string;
  arguments: string;
  cwd: string;
  session_id: string;
  /** ISO 8601; defaults to now. */
  timestamp?: string;
}

export interface EndEventInput extends StartEventInput {
  outcome: CommandOutcome;
  duration_ms: number;
  reason?: string;
  artifacts?: string[];
  summary?: string;
}

function baseFields(input: StartEventInput) {
  return {
    run_id: input.run_id,
    command: input.command,
    arguments: redactText(input.arguments),
    cwd: input.cwd,
    session_id: input.session_id,
    timestamp: input.timestamp ?? new Date().toISOString(),
  };
}

/** Build the redacted `command.start` event (AC-005-1, AC-005-3). */
export function buildStartEvent(input: StartEventInput): LifecycleEvent {
  const { run_id, command, arguments: args, cwd, session_id, timestamp } = baseFields(input);
  return { event: "command.start", run_id, command, arguments: args, cwd, session_id, timestamp };
}

/** Build the redacted `command.end` event (AC-005-2, AC-005-3). */
export function buildEndEvent(input: EndEventInput): LifecycleEvent {
  const { run_id, command, arguments: args, cwd, session_id, timestamp } = baseFields(input);
  const event: LifecycleEvent = {
    event: "command.end",
    run_id,
    command,
    arguments: args,
    cwd,
    session_id,
    timestamp,
    outcome: input.outcome,
    duration_ms: input.duration_ms,
  };
  if (input.reason !== undefined) event.reason = redactText(input.reason);
  if (input.artifacts !== undefined) event.artifacts = input.artifacts.map(redactText);
  if (input.summary !== undefined) event.summary = redactText(input.summary);
  return event;
}

/**
 * The one serialization every handler receives (AC-005-4): JSON with a fixed
 * key order and no insignificant whitespace. A shell handler gets it on stdin
 * and a prompt handler gets the same string, so the two cannot drift.
 */
export function serializeEvent(event: LifecycleEvent): string {
  return JSON.stringify({
    event: event.event,
    run_id: event.run_id,
    command: event.command,
    arguments: event.arguments,
    cwd: event.cwd,
    session_id: event.session_id,
    timestamp: event.timestamp,
    outcome: event.outcome,
    duration_ms: event.duration_ms,
    reason: event.reason,
    artifacts: event.artifacts,
    summary: event.summary,
  });
}
