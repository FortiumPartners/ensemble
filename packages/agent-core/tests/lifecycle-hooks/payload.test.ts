/**
 * Tests for lifecycle event payloads and redaction (TRD-003-TEST).
 * (docs/TRD/TRD-2026-f08a2a09-command-lifecycle-hooks.md#trd-003-test)
 *
 * PRD ACs: AC-005-1 (required fields), AC-005-2 (end fields), AC-005-3
 * (redaction, no transcript), AC-005-4 (identical delivery).
 */

import {
  buildEndEvent,
  buildStartEvent,
  EndEventInput,
  REDACTION_MARKER,
  redactText,
  SECRET_PATTERNS,
  SENSITIVE_VARIABLE_NAMES,
  serializeEvent,
  StartEventInput,
} from "../../src/lifecycle-hooks/payload";

const TIMESTAMP = "2026-10-15T12:00:00.000Z";

function startInput(overrides: Partial<StartEventInput> = {}): StartEventInput {
  return {
    run_id: "run-0001",
    command: "ensemble:create-trd",
    arguments: "docs/PRD/prd.md --fast",
    cwd: "/work/project",
    session_id: "session-7",
    timestamp: TIMESTAMP,
    ...overrides,
  };
}

function endInput(overrides: Partial<EndEventInput> = {}): EndEventInput {
  return { ...startInput(), outcome: "succeeded", duration_ms: 1234, ...overrides };
}

const REQUIRED_STRING_FIELDS = [
  "event",
  "run_id",
  "command",
  "arguments",
  "cwd",
  "session_id",
  "timestamp",
] as const;

// Fake secrets, built to match each documented shape.
const GITHUB_TOKEN = `ghp_${"a1B2c3D4e5".repeat(4)}`; // ghp_ + 40
const NPM_TOKEN = `npm_${"Ab1Cd2Ef3G".repeat(4).slice(0, 36)}`;
const GOOGLE_KEY = `AIza${"Sy0-_abcDE".repeat(4).slice(0, 35)}`;
const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTYifQ.c2lnbmF0dXJl";
const HEX_32 = "0123456789abcdef0123456789abcdef";
const HEX_64 = "0123456789abcdef".repeat(4);
const BASE64_BLOB = "dGhpc0lzQVNlY3JldFZhbHVlVGhhdE5vYm9keVNob3VsZFNlZTEyMzQ1";
const PRIVATE_KEY_BLOCK =
  "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA1234\nabcdEFGH5678\n-----END RSA PRIVATE KEY-----";

describe("buildStartEvent (AC-005-1)", () => {
  it("carries every required field, typed, with event command.start", () => {
    const event = buildStartEvent(startInput());

    expect(event).toEqual({
      event: "command.start",
      run_id: "run-0001",
      command: "ensemble:create-trd",
      arguments: "docs/PRD/prd.md --fast",
      cwd: "/work/project",
      session_id: "session-7",
      timestamp: TIMESTAMP,
    });
    for (const field of REQUIRED_STRING_FIELDS) {
      expect(typeof event[field]).toBe("string");
      expect(event[field]).not.toBe("");
    }
  });

  it("carries no end-only field", () => {
    const event = buildStartEvent(startInput());
    for (const field of ["outcome", "duration_ms", "reason", "artifacts", "summary"]) {
      expect(Object.keys(event)).not.toContain(field);
    }
  });

  it("defaults the timestamp to the current time as ISO 8601 when none is given", () => {
    const before = Date.now();
    const event = buildStartEvent(startInput({ timestamp: undefined }));
    const after = Date.now();

    expect(event.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    const parsed = Date.parse(event.timestamp);
    expect(parsed).toBeGreaterThanOrEqual(before);
    expect(parsed).toBeLessThanOrEqual(after);
  });

  it("keeps an explicit timestamp unchanged", () => {
    expect(buildStartEvent(startInput({ timestamp: "2020-01-02T03:04:05.000Z" })).timestamp).toBe(
      "2020-01-02T03:04:05.000Z",
    );
  });

  it("keeps an empty arguments string as an empty string", () => {
    expect(buildStartEvent(startInput({ arguments: "" })).arguments).toBe("");
  });
});

describe("buildEndEvent (AC-005-2)", () => {
  it("carries every required field plus outcome and duration_ms, typed", () => {
    const event = buildEndEvent(endInput());

    expect(event).toEqual({
      event: "command.end",
      run_id: "run-0001",
      command: "ensemble:create-trd",
      arguments: "docs/PRD/prd.md --fast",
      cwd: "/work/project",
      session_id: "session-7",
      timestamp: TIMESTAMP,
      outcome: "succeeded",
      duration_ms: 1234,
    });
    for (const field of REQUIRED_STRING_FIELDS) {
      expect(typeof event[field]).toBe("string");
    }
    expect(typeof event.outcome).toBe("string");
    expect(typeof event.duration_ms).toBe("number");
  });

  it.each(["succeeded", "failed", "cancelled"] as const)("passes outcome %s through", (outcome) => {
    expect(buildEndEvent(endInput({ outcome })).outcome).toBe(outcome);
  });

  it("keeps a zero duration_ms (0 is a value, not absence)", () => {
    const event = buildEndEvent(endInput({ duration_ms: 0 }));
    expect(event.duration_ms).toBe(0);
    expect(Object.keys(event)).toContain("duration_ms");
  });

  it("includes reason, artifacts and summary when given", () => {
    const event = buildEndEvent(
      endInput({
        outcome: "failed",
        reason: "tests failed",
        artifacts: ["docs/TRD/a.md", "docs/PRD/b.md"],
        summary: "Wrote 2 documents.",
      }),
    );

    expect(event.reason).toBe("tests failed");
    expect(event.artifacts).toEqual(["docs/TRD/a.md", "docs/PRD/b.md"]);
    expect(event.summary).toBe("Wrote 2 documents.");
  });

  it("omits reason, artifacts and summary entirely when not given", () => {
    const keys = Object.keys(buildEndEvent(endInput()));
    for (const field of ["reason", "artifacts", "summary"]) {
      expect(keys).not.toContain(field);
    }
  });

  it("keeps an empty artifacts list as an empty list", () => {
    expect(buildEndEvent(endInput({ artifacts: [] })).artifacts).toEqual([]);
  });

  it("does not alias the caller's artifacts array", () => {
    const artifacts = ["a.md"];
    const event = buildEndEvent(endInput({ artifacts }));
    artifacts.push("b.md");
    expect(event.artifacts).toEqual(["a.md"]);
  });
});

describe("redaction of documented secret patterns (AC-005-3)", () => {
  it("uses the documented fixed marker [REDACTED]", () => {
    expect(REDACTION_MARKER).toBe("[REDACTED]");
  });

  const SECRET_CASES: Array<[string, string, string]> = [
    // [label, input, expected]
    ["private key block", `deploy ${PRIVATE_KEY_BLOCK} now`, `deploy ${REDACTION_MARKER} now`],
    [
      "unterminated private key block",
      "x -----BEGIN PRIVATE KEY-----\nMIIabc",
      `x ${REDACTION_MARKER}`,
    ],
    [
      "bearer token",
      "curl -H 'Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123456789'",
      `curl -H 'Authorization: Bearer ${REDACTION_MARKER}'`,
    ],
    ["jwt", `use ${JWT} here`, `use ${REDACTION_MARKER} here`],
    ["aws access key id", "id AKIAIOSFODNN7EXAMPLE end", `id ${REDACTION_MARKER} end`],
    ["github token (ghp_)", `gh ${GITHUB_TOKEN}`, `gh ${REDACTION_MARKER}`],
    [
      "github fine-grained token",
      `gh github_pat_${"A1b2C3d4E5".repeat(3)}`,
      `gh ${REDACTION_MARKER}`,
    ],
    ["slack token", "slack xoxb-123456789012-abcdefghij", `slack ${REDACTION_MARKER}`],
    ["npm token", `npm ${NPM_TOKEN}`, `npm ${REDACTION_MARKER}`],
    ["google api key", `key ${GOOGLE_KEY}`, `key ${REDACTION_MARKER}`],
    ["sk- api secret key", "key sk-abcdefghijklmnopqrstuvwx", `key ${REDACTION_MARKER}`],
    ["32-character hex", `hash ${HEX_32}`, `hash ${REDACTION_MARKER}`],
    ["64-character hex", `hash ${HEX_64}`, `hash ${REDACTION_MARKER}`],
    ["long base64 blob", `blob ${BASE64_BLOB}`, `blob ${REDACTION_MARKER}`],
    [
      "url credentials keep user, host and scheme",
      "git clone https://alice:s3cr3t@example.com/repo.git",
      `git clone https://alice:${REDACTION_MARKER}@example.com/repo.git`,
    ],
  ];

  it.each(SECRET_CASES)("%s", (_label, input, expected) => {
    expect(redactText(input)).toBe(expected);
  });

  it("every pattern in SECRET_PATTERNS matches its own sample, and no pattern lacks one", () => {
    const SAMPLE_BY_PATTERN: Record<string, string> = {
      "private-key-block": PRIVATE_KEY_BLOCK,
      "bearer-token": "Bearer abcdefghijklmnopqrstuvwxyz0123456789",
      "secret-key-value": "password=hunter2",
      "secret-flag-value": "--token abc123",
      "url-credentials": "https://alice:s3cr3t@example.com/",
      jwt: JWT,
      "aws-access-key-id": "AKIAIOSFODNN7EXAMPLE",
      "github-token": GITHUB_TOKEN,
      "slack-token": "xoxb-123456789012-abcdefghij",
      "npm-token": NPM_TOKEN,
      "google-api-key": GOOGLE_KEY,
      "api-secret-key": "sk-abcdefghijklmnopqrstuvwx",
      "long-hex": HEX_64,
      "long-base64": BASE64_BLOB,
    };
    expect(SECRET_PATTERNS.map((p) => p.name).sort()).toEqual(Object.keys(SAMPLE_BY_PATTERN).sort());
    for (const { name, pattern } of SECRET_PATTERNS) {
      const sample = SAMPLE_BY_PATTERN[name];
      expect(sample.replace(pattern, REDACTION_MARKER)).toContain(REDACTION_MARKER);
    }
  });

  it("redacts the same pattern repeatedly in one text (global match)", () => {
    expect(redactText(`${HEX_32} and ${HEX_64}`)).toBe(`${REDACTION_MARKER} and ${REDACTION_MARKER}`);
  });
});

describe("redaction of NAME=value, --flag value and $NAME forms (AC-005-3)", () => {
  const FORM_CASES: Array<[string, string, string]> = [
    ["password=value", "login password=hunter2 now", `login password=${REDACTION_MARKER} now`],
    ["TOKEN=value", "TOKEN=abc123", `TOKEN=${REDACTION_MARKER}`],
    ["API_KEY=value (case-insensitive name)", "run api_key=k1", `run api_key=${REDACTION_MARKER}`],
    ["*_TOKEN glob name", "GITHUB_TOKEN=xyz run", `GITHUB_TOKEN=${REDACTION_MARKER} run`],
    ["*_PASSWORD glob name", "DB_PASSWORD=pw run", `DB_PASSWORD=${REDACTION_MARKER} run`],
    ["*_SECRET_KEY glob name", "STRIPE_SECRET_KEY=sk run", `STRIPE_SECRET_KEY=${REDACTION_MARKER} run`],
    [
      "AWS_SECRET_ACCESS_KEY",
      "AWS_SECRET_ACCESS_KEY=abc/def run",
      `AWS_SECRET_ACCESS_KEY=${REDACTION_MARKER} run`,
    ],
    [
      "AWS_SESSION_TOKEN",
      "AWS_SESSION_TOKEN=tok run",
      `AWS_SESSION_TOKEN=${REDACTION_MARKER} run`,
    ],
    ["CREDENTIALS=value", "CREDENTIALS=a:b go", `CREDENTIALS=${REDACTION_MARKER} go`],
    ["double-quoted value with spaces", 'SECRET="two words" go', `SECRET=${REDACTION_MARKER} go`],
    ["single-quoted value with spaces", "password='two words' go", `password=${REDACTION_MARKER} go`],
    ["--flag=value", "--api-key=abc123 --verbose", `--api-key=${REDACTION_MARKER} --verbose`],
    [
      "--flag=value with a sensitive suffix name",
      "--client-secret=abc go",
      `--client-secret=${REDACTION_MARKER} go`,
    ],
    ["--flag value (space separated)", "run --token abc123 --verbose", `run --token ${REDACTION_MARKER} --verbose`],
    [
      "--flag value with a prefixed name",
      "run --access-token abc123",
      `run --access-token ${REDACTION_MARKER}`,
    ],
    ["--password value", "--password hunter2", `--password ${REDACTION_MARKER}`],
    ["$NAME reference", "curl -u $GITHUB_TOKEN", `curl -u ${REDACTION_MARKER}`],
    ["${NAME} reference", "echo ${AWS_SESSION_TOKEN} done", `echo ${REDACTION_MARKER} done`],
    ["$PASSWORD reference", "login $PASSWORD", `login ${REDACTION_MARKER}`],
  ];

  it.each(FORM_CASES)("%s", (_label, input, expected) => {
    expect(redactText(input)).toBe(expected);
  });

  it("keeps non-sensitive assignments and variable references intact", () => {
    for (const text of ["FOO=bar", "--mode=fast", "PATH=/usr/bin:/bin", "echo $HOME", "cd ${PWD}", "$USER"]) {
      expect(redactText(text)).toBe(text);
    }
  });

  it("every documented sensitive variable name is redacted as NAME=value and as $NAME", () => {
    for (const glob of SENSITIVE_VARIABLE_NAMES) {
      const name = glob.replace("*", "MY");
      expect(redactText(`${name}=v1`)).toBe(`${name}=${REDACTION_MARKER}`);
      expect(redactText(`$${name}`)).toBe(REDACTION_MARKER);
    }
  });
});

describe("redaction is applied to arguments, reason, summary and artifacts (AC-005-3)", () => {
  it("redacts a secret in the start event's arguments, leaving other fields untouched", () => {
    const event = buildStartEvent(startInput({ arguments: "deploy --token abc123 password=pw" }));

    expect(event.arguments).toBe(`deploy --token ${REDACTION_MARKER} password=${REDACTION_MARKER}`);
    expect(event.command).toBe("ensemble:create-trd");
    expect(event.cwd).toBe("/work/project");
    expect(event.session_id).toBe("session-7");
    expect(event.run_id).toBe("run-0001");
  });

  it("redacts the end event's arguments, reason, summary and every artifact", () => {
    const event = buildEndEvent(
      endInput({
        arguments: "TOKEN=aaa",
        outcome: "failed",
        reason: `auth failed with Bearer abcdefghijklmnopqrstuvwxyz0123456789`,
        summary: `used ${GITHUB_TOKEN} to push`,
        artifacts: ["out/report.md", "dump password=hunter2"],
      }),
    );

    expect(event.arguments).toBe(`TOKEN=${REDACTION_MARKER}`);
    expect(event.reason).toBe(`auth failed with Bearer ${REDACTION_MARKER}`);
    expect(event.summary).toBe(`used ${REDACTION_MARKER} to push`);
    expect(event.artifacts).toEqual([
      "out/report.md",
      `dump password=${REDACTION_MARKER}`,
    ]);
  });

  it("redacts a standalone hex secret given as an artifact entry", () => {
    expect(buildEndEvent(endInput({ artifacts: [HEX_64] })).artifacts).toEqual([REDACTION_MARKER]);
  });

  it("never lets a secret value survive anywhere in the serialized event", () => {
    const secrets = ["hunter2", GITHUB_TOKEN, "abc123secret", HEX_64];
    const event = buildEndEvent(
      endInput({
        arguments: "password=hunter2",
        reason: GITHUB_TOKEN,
        summary: "API_KEY=abc123secret",
        artifacts: [HEX_64],
      }),
    );
    const json = serializeEvent(event);
    for (const secret of secrets) expect(json).not.toContain(secret);
  });

  it("does not redact identifier fields (run_id, command, cwd, session_id)", () => {
    const event = buildStartEvent(
      startInput({ run_id: "TOKEN=abc", command: "x", cwd: "/tmp/password=1", session_id: "s" }),
    );
    expect(event.run_id).toBe("TOKEN=abc");
    expect(event.cwd).toBe("/tmp/password=1");
  });
});

describe("ordinary strings are not altered (AC-005-3)", () => {
  const ORDINARY = [
    "password reset flow",
    "max_tokens: 5",
    "the token budget is large",
    "rotate the secret in the vault",
    "1b2c3d4e5f60718293a4b5c6d7e8f90123456789", // 40-hex git commit id
    "feature/trd-2026-f08a2a09-command-lifecycle-hooks",
    "docs/TRD/TRD-2026-f08a2a09-command-lifecycle-hooks.md",
    "packages/agent-core/src/lifecycle-hooks/payload.ts",
    "$HOME",
    "$PATH and ${HOME}/bin",
    "--max-tokens 100",
    "--token-limit 5",
    "--dry-run --verbose",
    "NODE_ENV=production",
    "https://example.com/path?q=1",
    "https://user@example.com/repo.git",
    "1234567890",
    "deadbeef",
    "Authorization: Bearer short",
    "ensemble:create-trd docs/PRD/prd.md",
    "",
  ];

  it.each(ORDINARY)("leaves %j unchanged", (text) => {
    expect(redactText(text)).toBe(text);
  });

  it("leaves ordinary strings unchanged inside a built event, in every redacted field", () => {
    const event = buildEndEvent(
      endInput({
        arguments: "password reset flow max_tokens: 5 1b2c3d4e5f60718293a4b5c6d7e8f90123456789",
        reason: "feature/trd-2026-f08a2a09-command-lifecycle-hooks",
        summary: "uses $HOME",
        artifacts: ["docs/TRD/TRD-2026-f08a2a09-command-lifecycle-hooks.md"],
      }),
    );
    expect(event.arguments).toBe(
      "password reset flow max_tokens: 5 1b2c3d4e5f60718293a4b5c6d7e8f90123456789",
    );
    expect(event.reason).toBe("feature/trd-2026-f08a2a09-command-lifecycle-hooks");
    expect(event.summary).toBe("uses $HOME");
    expect(event.artifacts).toEqual(["docs/TRD/TRD-2026-f08a2a09-command-lifecycle-hooks.md"]);
  });

  it("keeps the text around a redacted value", () => {
    expect(redactText("a password reset flow, then password=pw then max_tokens: 5")).toBe(
      `a password reset flow, then password=${REDACTION_MARKER} then max_tokens: 5`,
    );
  });
});

describe("redaction is idempotent (AC-005-3)", () => {
  const INPUTS = [
    "password=hunter2 --token abc $GITHUB_TOKEN ${AWS_SESSION_TOKEN}",
    `Bearer abcdefghijklmnopqrstuvwxyz0123456789 ${JWT} ${GITHUB_TOKEN}`,
    `${HEX_32} ${HEX_64} ${BASE64_BLOB}`,
    PRIVATE_KEY_BLOCK,
    "git clone https://alice:s3cr3t@example.com/r.git",
    'SECRET="two words" API_KEY=k',
    "password reset flow max_tokens: 5 $HOME",
    `already ${REDACTION_MARKER} and token=${REDACTION_MARKER}`,
  ];

  it.each(INPUTS)("redactText(redactText(x)) === redactText(x) for %j", (text) => {
    const once = redactText(text);
    expect(redactText(once)).toBe(once);
  });

  it("rebuilding an end event from its own redacted output yields the same event", () => {
    const input = endInput({
      arguments: "password=hunter2 --token abc",
      reason: GITHUB_TOKEN,
      summary: "API_KEY=k",
      artifacts: [HEX_64, "ok.md"],
    });
    const first = buildEndEvent(input);
    const second = buildEndEvent({
      ...input,
      arguments: first.arguments,
      reason: first.reason,
      summary: first.summary,
      artifacts: first.artifacts,
    });
    expect(second).toEqual(first);
  });
});

describe("no transcript, no extra properties (AC-005-3)", () => {
  const START_KEYS = ["event", "run_id", "command", "arguments", "cwd", "session_id", "timestamp"];
  const END_KEYS = [...START_KEYS, "outcome", "duration_ms", "reason", "artifacts", "summary"];

  it("a start event's keys are exactly the documented set, none a transcript", () => {
    const keys = Object.keys(buildStartEvent(startInput()));
    expect(keys.sort()).toEqual([...START_KEYS].sort());
    expect(keys.filter((k) => /transcript|messages|history|conversation/i.test(k))).toEqual([]);
  });

  it("an end event's keys are a subset of the documented set, none a transcript", () => {
    const keys = Object.keys(
      buildEndEvent(endInput({ reason: "r", artifacts: ["a"], summary: "s" })),
    );
    expect(keys.sort()).toEqual([...END_KEYS].sort());
    expect(keys.filter((k) => /transcript|messages|history|conversation/i.test(k))).toEqual([]);
  });

  it("extra properties on the start input never reach the event or its serialization", () => {
    const polluted = {
      ...startInput(),
      transcript: "USER: hi\nASSISTANT: SENTINEL-TRANSCRIPT",
      messages: ["SENTINEL-MESSAGE"],
      env: { SECRET: "SENTINEL-ENV" },
    } as StartEventInput;

    const event = buildStartEvent(polluted);

    expect(Object.keys(event).sort()).toEqual([...START_KEYS].sort());
    expect(serializeEvent(event)).not.toMatch(/SENTINEL/);
  });

  it("extra properties on the end input never reach the event or its serialization", () => {
    const polluted = {
      ...endInput({ reason: "r", artifacts: ["a"], summary: "s" }),
      transcript: "SENTINEL-TRANSCRIPT",
      messages: ["SENTINEL-MESSAGE"],
      stack: "SENTINEL-STACK",
    } as EndEventInput;

    const event = buildEndEvent(polluted);

    expect(Object.keys(event).sort()).toEqual([...END_KEYS].sort());
    expect(serializeEvent(event)).not.toMatch(/SENTINEL/);
  });
});

describe("serializeEvent (AC-005-4)", () => {
  it("is identical when called twice on the same event", () => {
    const event = buildEndEvent(endInput({ reason: "r", artifacts: ["a"], summary: "s" }));
    expect(serializeEvent(event)).toBe(serializeEvent(event));
  });

  it("is identical for two events built from the same input", () => {
    expect(serializeEvent(buildStartEvent(startInput()))).toBe(
      serializeEvent(buildStartEvent(startInput())),
    );
  });

  it("does not depend on the key insertion order of the event object", () => {
    const event = buildStartEvent(startInput());
    const shuffled = Object.fromEntries(Object.entries(event).reverse()) as typeof event;
    expect(serializeEvent(shuffled)).toBe(serializeEvent(event));
  });

  it("emits a start event with the fixed key order and no whitespace", () => {
    expect(serializeEvent(buildStartEvent(startInput()))).toBe(
      '{"event":"command.start","run_id":"run-0001","command":"ensemble:create-trd",' +
        '"arguments":"docs/PRD/prd.md --fast","cwd":"/work/project","session_id":"session-7",' +
        `"timestamp":"${TIMESTAMP}"}`,
    );
  });

  it("emits an end event with the fixed key order, end fields after the common ones", () => {
    const json = serializeEvent(
      buildEndEvent(
        endInput({ outcome: "failed", reason: "r", artifacts: ["a.md"], summary: "s" }),
      ),
    );
    expect(json).toBe(
      '{"event":"command.end","run_id":"run-0001","command":"ensemble:create-trd",' +
        '"arguments":"docs/PRD/prd.md --fast","cwd":"/work/project","session_id":"session-7",' +
        `"timestamp":"${TIMESTAMP}","outcome":"failed","duration_ms":1234,` +
        '"reason":"r","artifacts":["a.md"],"summary":"s"}',
    );
    expect(Object.keys(JSON.parse(json))).toEqual([
      "event",
      "run_id",
      "command",
      "arguments",
      "cwd",
      "session_id",
      "timestamp",
      "outcome",
      "duration_ms",
      "reason",
      "artifacts",
      "summary",
    ]);
  });

  it("omits absent optional fields rather than writing null", () => {
    const json = serializeEvent(buildEndEvent(endInput()));
    expect(json).not.toMatch(/reason|artifacts|summary|null/);
    expect(JSON.parse(json).duration_ms).toBe(1234);
  });

  it("round-trips through JSON.parse to the event it was built from", () => {
    const event = buildEndEvent(
      endInput({ reason: 'quote " and \\ and\nnewline', artifacts: ["é.md"], summary: "s" }),
    );
    expect(JSON.parse(serializeEvent(event))).toEqual(event);
  });

  it("serializes the redacted values, never the originals", () => {
    const json = serializeEvent(buildStartEvent(startInput({ arguments: "--token abc123" })));
    expect(JSON.parse(json).arguments).toBe(`--token ${REDACTION_MARKER}`);
    expect(json).not.toContain("abc123");
  });
});
