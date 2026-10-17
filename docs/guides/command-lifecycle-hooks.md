# Command lifecycle hooks

Command lifecycle hooks run your own code when an Ensemble command starts and when it ends. A project opts in with one file, `.ensemble/hooks.yaml`; a project without that file sees no change.

**Pi is the only supported harness.** Nothing runs in Claude Code, Codex or OpenCode: there is no adapter for them (see [Per-harness capabilities](#per-harness-capabilities)). The first release was proven in Pi 1.2.0, and every Pi behavior stated below was measured there.

## Table of Contents

1. [What you get](#what-you-get)
2. [Quick start](#quick-start)
3. [The two events and their payload](#the-two-events-and-their-payload)
4. [The hooks file](#the-hooks-file)
5. [Shell handlers](#shell-handlers)
6. [Prompt handlers](#prompt-handlers)
7. [Exit and error semantics](#exit-and-error-semantics)
8. [Redaction](#redaction)
9. [Timeouts and output bound](#timeouts-and-output-bound)
10. [Trust](#trust)
11. [When a command ends, and what you see](#when-a-command-ends-and-what-you-see)
12. [Per-harness capabilities](#per-harness-capabilities)
13. [The status check](#the-status-check)
14. [How this differs from pi-yaml-hooks](#how-this-differs-from-pi-yaml-hooks)
15. [Known limits](#known-limits)

---

## What you get

- Two events, `command.start` and `command.end`, for the Ensemble commands you list by name.
- Two handler types: a `shell` handler (an executable you wrote) and a `prompt` handler (a prompt file evaluated by a model).
- A start handler can **block** the command before its prompt reaches the model.
- Every handler receives the same redacted JSON payload.
- Nothing runs until the file validates and you have trusted it (see [Trust](#trust)).

What it is not: a general hook system for tools, files or sessions. It sees command boundaries only.

---

## Quick start

1. Write `.ensemble/hooks.yaml` at the project root (the nearest ancestor directory of Pi's working directory that holds a `.git`, or that directory itself when there is none). It must exist **when Pi starts**: the adapter registers itself only if the file is there, so after adding it, restart Pi.
2. Write the executable or prompt file it names. Executable files must be executable (`chmod +x`).
3. In an interactive Pi session, run `/ensemble-lifecycle-trust`, read what it lists, and confirm.
4. Run the command. After each event, Pi shows what the handlers did.

A minimal file, one shell handler on one command:

```yaml
version: 1
hooks:
  audit-log:
    type: shell
    command: ./scripts/lifecycle/audit-log.sh
    on_error: continue
commands:
  ensemble:create-prd:
    start: [audit-log]
```

---

## The two events and their payload

| Event | Fires | Can block |
| --- | --- | --- |
| `command.start` | When the command's slash input is seen, before its prompt reaches the model. It comes from the runtime, so it never depends on the model. | Yes, with `on_error: block` |
| `command.end` | When the command ends: succeeded, failed or cancelled (see [When a command ends](#when-a-command-ends-and-what-you-see)). | No |

Every handler, shell or prompt, receives the same JSON text, built once and redacted before any handler sees it. A shell handler reads it on standard input; a prompt handler gets the same string appended to its prompt. Keys always appear in the order below, and a key without a value is left out.

| Field | Event | Meaning |
| --- | --- | --- |
| `event` | both | `command.start` or `command.end` |
| `run_id` | both | Identifies this run; the start and end of one run share it |
| `command` | both | The command, named as the hooks file names it, for example `ensemble:create-prd` |
| `arguments` | both | The text the user typed after the command (redacted) |
| `cwd` | both | The session's working directory |
| `session_id` | both | The host session's id |
| `timestamp` | both | ISO 8601 time of the event |
| `outcome` | end | `succeeded`, `failed` or `cancelled` |
| `duration_ms` | end | Milliseconds from start to end |
| `reason` | end | Why it failed or was cancelled, when there is a reason (redacted) |
| `artifacts` | end | Paths the command said it produced (each redacted) |
| `summary` | end | The command's own short summary (redacted) |

A start event:

```json
{"event":"command.start","run_id":"3f0c1c1e-7a52-4b53-9d0e-5f6a4c1d2b10","command":"ensemble:create-prd","arguments":"checkout redesign password=[REDACTED]","cwd":"/work/shop","session_id":"a1b2c3","timestamp":"2026-10-15T20:41:49.000Z"}
```

An end event:

```json
{"event":"command.end","run_id":"3f0c1c1e-7a52-4b53-9d0e-5f6a4c1d2b10","command":"ensemble:create-prd","arguments":"checkout redesign password=[REDACTED]","cwd":"/work/shop","session_id":"a1b2c3","timestamp":"2026-10-15T20:43:10.000Z","outcome":"succeeded","duration_ms":81000,"artifacts":["docs/PRD/checkout.md"],"summary":"Drafted the PRD."}
```

The payload never includes a transcript, and it copies only the fields above. No field is cut to a maximum length by the payload builder; only a shell handler's output is bounded (see [Timeouts and output bound](#timeouts-and-output-bound)). `command`, `cwd` and `session_id` are not redacted; the free-text fields `arguments`, `reason`, `summary` and each `artifacts` entry are.

`reason`, `summary` and `artifacts` on a `command.end` come from the model, which supplies them when it signals completion. A command that was cancelled carries a `reason` saying what happened, for example that it never signalled completion.

---

## The hooks file

`.ensemble/hooks.yaml` has three top-level keys, and no others: `version` (must be `1`), `hooks` and `commands`.

- `hooks` maps a handler name to a handler. Handler fields:
  - `type`: `shell` or `prompt`. Required.
  - `on_error`: `continue` or `block`. **Required on every handler; there is no default.**
  - `timeout_ms`: a positive integer. Optional; see [Timeouts and output bound](#timeouts-and-output-bound).
  - Shell only: `command` (required) and `args` (optional list of strings).
  - Prompt only: `prompt` (required), a path to a prompt file.
- `commands` maps a command name to its `start` and/or `end` list of handler names, run in the order listed. A command that selects neither list is rejected.

Rules the validator enforces, with the file validated in full before any handler can run:

- Command names are explicit, written `ensemble:<name>`. Wildcards and groups are not supported. Where Pi supplies its command list, the name must be a command Pi reports.
- Name the command the user runs, not a dispatcher: `/ensemble-prd create foo` and `/ensemble:prd create foo` both start a run for the target, `ensemble:create-prd`.
- `command` is one executable, never a shell line. Put arguments in `args`; `args` is an array, so no argument is ever interpreted by a shell.
- A `command` that contains a slash must name an existing file, resolved against the project root. A bare name (such as `node`) is looked up on `PATH`.
- A `prompt` path must name an existing file, resolved against the project root.
- A handler selected under `end` may not have `on_error: block`. Block is valid for start handlers only.
- Unknown fields, unknown handler names and a missing `on_error` are errors. Every error names the offending entry, for example `hooks.audit-log.on_error`.

If the file is invalid, no hook runs, and Pi tells you each error.

A command's selection on its own, as a fragment of a hooks file (the handler names refer to handlers defined under `hooks`):

```yaml
# fragment: not a whole hooks file, so the test for this guide does not validate it
commands:
  ensemble:create-prd:
    start: [require-clean-tree, audit-log]   # run one at a time, in this order
    end: [review-summary]
```

---

## Shell handlers

A shell handler is an executable you own. Worked example: block a command when the working tree is dirty, and log every start.

```yaml
version: 1
hooks:
  require-clean-tree:
    type: shell
    command: ./scripts/lifecycle/require-clean-tree.sh
    timeout_ms: 3000
    on_error: block
  audit-log:
    type: shell
    command: ./scripts/lifecycle/audit-log.sh
    args: ["--label", "ensemble"]
    on_error: continue
commands:
  ensemble:implement-trd:
    start: [require-clean-tree, audit-log]
    end: [audit-log]
```

`./scripts/lifecycle/require-clean-tree.sh`:

```sh
#!/bin/sh
cat > /dev/null                         # the event is on stdin; this one does not need it
if [ -n "$(git status --porcelain)" ]; then
  echo "the working tree has uncommitted changes" >&2
  exit 1
fi
```

What a shell handler gets:

- **No shell.** The executable starts with an argument array. Nothing in the file or in the event is ever interpreted.
- **The event on stdin**, exactly as given, then stdin closes. A handler that never reads it cannot stall the run.
- **Its working directory is the project root.**
- **A fixed environment**, not the parent's: `PATH`, `HOME`, `USER`, `LANG`, `TMPDIR` and `TERM` when set, plus four set by the runner: `ENSEMBLE_EVENT`, `ENSEMBLE_RUN_ID`, `ENSEMBLE_COMMAND` and `ENSEMBLE_PROJECT_ROOT`. The command's own arguments reach the handler only inside the event on stdin, never on its command line or in its environment.
- **Its own process group.** On POSIX it has no controlling terminal and does not receive the host's terminal signals.

The handler's own output (stdout and stderr, combined) is kept up to the bound and shown to you only when the handler did not succeed. It is not redacted: do not print secrets.

---

## Prompt handlers

A prompt handler is a prompt file that a model evaluates against the event. Use one when the check needs judgment, for example "does this PRD mention a rollback plan?".

```yaml
version: 1
hooks:
  review-summary:
    type: prompt
    prompt: ./prompts/review-summary.md
    timeout_ms: 45000
    on_error: continue
commands:
  ensemble:create-prd:
    end: [review-summary]
```

`./prompts/review-summary.md`:

```markdown
You review how an Ensemble command ended.

If `outcome` is not "succeeded", set "continue" to true and say in one line what
went wrong, using `reason`.

If it succeeded, look at the paths in `artifacts`. Report a finding with severity
"warning" for each path that is not under docs/. Set "continue" to true unless
a path is outside the project.
```

How a prompt handler runs: the adapter starts an isolated child Pi (`pi -p --no-session -ne -nt -np`: print mode, no session, no extensions, no tools, no prompt templates). The child gets your prompt text, a fixed instruction describing the response format, and the event JSON. Because it has no tools and no extensions, it can neither edit anything nor fire a lifecycle event of its own. The child makes a model call, so the redacted event is sent to your model provider. The prompt and event are passed to the child as its message, which means local users who can list processes can see them.

The child Pi inherits Pi's own environment; the allowlist described under [Shell handlers](#shell-handlers) applies to shell handlers only.

The handler must answer with one JSON object and nothing else:

```json
{"continue": true, "message": "Drafted without a rollback section.", "findings": [{"message": "No rollback plan", "severity": "warning", "path": "docs/PRD/checkout.md"}]}
```

- `continue` (boolean) is required. `false` means "ask that the command be blocked", and is a failure of the handler: its `on_error` decides what happens (see below).
- `message` (string) is optional and is always shown to you.
- `findings` is an optional list. Each finding has a `message` (string) and optionally a `severity` (`info`, `warning` or `error`) and a `path` (string). The first five are shown to you.
- No other top-level field is accepted.

Tips for writing a prompt handler:

- Ask for the JSON object explicitly and keep the task small. A prompt that makes the model add prose around the object is the usual cause of a failed handler.
- Say which event fields the decision uses. The model sees the whole event.
- Decide `on_error` deliberately. A prompt that cannot answer (malformed output, timeout, an unreadable prompt file) is a failure, and with `on_error: block` on a start handler it stops the command.
- Evaluate at most what the model can answer from the event. The child has no tools, so it cannot read your repository; if a check needs files, use a shell handler.

---

## Exit and error semantics

Every way a handler can go wrong is an outcome, never an exception, and a handler runs at most once: nothing retries it.

| What happened | Handler status | Notes |
| --- | --- | --- |
| Shell handler exits 0 | `succeeded` | |
| Shell handler exits non-zero | `failed` | `exit_code` is recorded. No exit code has a special meaning |
| Shell handler killed by a signal | `failed` | |
| Shell handler cannot start (missing file, not executable) | `failed` | The message says why |
| Handler runs past `timeout_ms` | `timed_out` | The process group is sent SIGTERM, then SIGKILL |
| Prompt handler answers `{"continue": true}` | `succeeded` | |
| Prompt handler answers `{"continue": false}` | `failed` | |
| Prompt answer is malformed, has extra fields or is empty | `failed` | The message gives the reason |
| Prompt file cannot be read, or the child Pi fails | `failed` | |

What `on_error` does with a handler that did not succeed (`failed` or `timed_out`):

| `on_error` | In a `start` list | In an `end` list |
| --- | --- | --- |
| `continue` | The failure is recorded and shown; the next handler runs; the command runs | The failure is recorded and shown; the next handler runs |
| `block` | The handler is recorded as `blocked`, no later start handler runs, the command does not run, and the run ends `failed` naming the handler | Not allowed; the validator rejects it |

A handler failure is never a command failure. The report says so: a failed handler beside a command that succeeded still reads "the handler failed; the command's own outcome is unchanged". When a start handler blocks, the command's prompt never reaches the model; the block is enforced by the runtime, not by a model. A blocked run still ends as `failed`, and its end handlers still run.

---

## Redaction

Redaction replaces a value, not the surrounding sentence, with the fixed marker `[REDACTED]`. It is applied to the free-text fields only: `arguments`, `reason`, `summary` and each `artifacts` entry. It runs before any handler sees the event, in this order: `NAME=value` assignments whose name is sensitive, `$NAME` references to a sensitive name, then each pattern below.

Examples (the test for this guide runs each row through the real redactor):

| Text in the command | Text in the payload |
| --- | --- |
| `deploy with password=hunter2 now` | `deploy with password=[REDACTED] now` |
| `run --api-key abc123xyz --verbose` | `run --api-key [REDACTED] --verbose` |
| `use $GITHUB_TOKEN here` | `use [REDACTED] here` |
| `clone https://user:s3cret@example.com/repo.git` | `clone https://user:[REDACTED]@example.com/repo.git` |
| `Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456` | `Authorization: Bearer [REDACTED]` |
| `password reset flow` | `password reset flow` |
| `max_tokens: 5` | `max_tokens: 5` |
| `commit 0123456789abcdef0123456789abcdef01234567 ok` | `commit 0123456789abcdef0123456789abcdef01234567 ok` |

### Secret patterns

Applied in this order. A pattern that only describes a value keeps the name or prefix before it.

| Pattern | Matches |
| --- | --- |
| `private-key-block` | A `-----BEGIN ... PRIVATE KEY-----` block, to its END line or the end of the text |
| `bearer-token` | The token after `Bearer`, 20 or more token characters |
| `secret-key-value` | The value after `=` when the name ends in or is `api_key`, `apikey`, `token`, `secret`, `password` or `passwd` |
| `secret-flag-value` | The value after a flag such as `--api-key` or `--db-password` |
| `url-credentials` | The password in `scheme://user:password@host` |
| `jwt` | A JSON Web Token (`eyJ...` in three dot-separated parts) |
| `aws-access-key-id` | An AWS access key id (`AKIA`, `ASIA` and related prefixes) |
| `github-token` | A GitHub token (`ghp_`, `gho_`, `ghu_`, `ghs_`, `ghr_`, `github_pat_`) |
| `slack-token` | A Slack token (`xox...`) |
| `npm-token` | An npm token (`npm_` and 36 characters) |
| `google-api-key` | A Google API key (`AIza...`) |
| `api-secret-key` | A key that starts `sk-` followed by 20 or more characters |
| `long-hex` | A run of 32 or more hex digits, **except exactly 40**, the length of a git commit id |
| `long-base64` | An unbroken run of 40 or more base64 characters containing a digit, an upper-case and a lower-case letter, not part of a path, word or hyphenated name |

### Sensitive variable names

A `NAME=value` (also `--NAME=value`) has its value replaced, and a `$NAME` or `${NAME}` reference is replaced whole, when the name matches one of these. Matching ignores case and reads `-` as `_`. `*` stands for any run of letters, digits and underscores.

- `TOKEN`
- `SECRET`
- `PASSWORD`
- `PASSWD`
- `API_KEY`
- `APIKEY`
- `CREDENTIALS`
- `*_TOKEN`
- `*_SECRET`
- `*_PASSWORD`
- `*_PASSWD`
- `*_API_KEY`
- `*_APIKEY`
- `*_ACCESS_KEY`
- `*_SECRET_KEY`
- `*_PRIVATE_KEY`
- `*_CREDENTIALS`
- `AWS_SECRET_ACCESS_KEY`
- `AWS_SESSION_TOKEN`

### What redaction does not promise

Redaction is pattern-based. It is a safety net, not a guarantee that no secret leaves the machine:

- A bare 40-hex secret with no `NAME=` in front is not redacted, because 40 hex digits is also a git commit id.
- A long path can be redacted by mistake: an unbroken run of 40 or more letters, digits and slashes with mixed case and a digit, and no `.`, `-` or `_`, looks like a base64 secret.
- A secret in a shape no pattern describes passes through.
- A shell handler's own output is not redacted.

---

## Timeouts and output bound

| Setting | Value |
| --- | --- |
| Default shell handler timeout | 5000 ms |
| Default prompt handler timeout | 30000 ms |
| Output kept from one shell handler run (stdout and stderr combined) | 64 KiB (65536 bytes) |

- Set `timeout_ms` on a handler to override its default.
- Past the output bound the handler's output is still read, so it never blocks on a full pipe, but the rest is discarded and the report says "output truncated".
- On a timeout a shell handler's process group gets SIGTERM, then SIGKILL after 500 ms. A prompt handler's child Pi gets SIGTERM, then SIGKILL after 2 seconds.
- A handler that leaves a background process holding its output pipes open is not finished until its timeout. Redirect a background process's output (`cmd >/dev/null 2>&1 &`) if it must outlive the handler.

---

## Trust

A hooks file runs code with your permissions, so two conditions must both hold before any handler runs:

1. **The host trusts the project.** Pi reports `true` for this by default in every mode, so on its own this blocks almost nothing. If you have told Pi not to trust a project, hooks do not run there.
2. **You have trusted these hooks.** Run `/ensemble-lifecycle-trust` in an interactive Pi session. It validates the file, lists every handler's exact executable and arguments or prompt file, and records your trust only after you confirm. In a session with no UI to show a confirmation (for example print mode) it refuses and records nothing; no argument skips the confirmation.

Where trust is kept, and what it is bound to:

- The record is a plain JSON file under your home directory, `~/.ensemble/trusted-hooks.json`, written atomically with owner-only permissions (file `0600`, directory `0700`). It is never kept inside the repository, and its location never comes from the project.
- Each record holds the project's real path and a SHA-256 digest of everything the hooks would run: the hooks file; every `command` that contains a slash; every prompt file; and every entry of a shell handler's `args` that resolves to a regular file (so `command: node` with `args: ["./hooks/audit.js"]` covers the script). Files outside the project count too.
- Any change to a covered file makes the record stale, and a stale record is no record: the hooks stop running until you trust them again, and Pi says why.
- A handler that writes a file named in its own `args` voids its own trust each time it runs.

What trust does not cover, and what it does not promise:

- **A model with general file tools can grant trust.** The record is a file under your home directory with a digest computed the same way every time. The extension's own registered tools can never grant trust (the only tool the model can call, `ensemble_command_complete`, names no handler or executable), but a model that has bash or write access could write a valid record itself. The promise that a model's tool call never grants trust holds against the extension's own tools only. It is not a sandbox.
- **A project that contains the store can never be trusted.** A project rooted at your home directory, or any project that contains `~/.ensemble`, is refused: the store path may not be inside the project.
- **Upgrading an interpreter voids trust.** Files outside the project are hashed, so if a handler's `command` is an absolute interpreter such as `/opt/homebrew/bin/node` and that interpreter is upgraded, the digest changes and you must trust again.
- **A bare command name is not hashed.** `command: node` is a `PATH` lookup; only the name, as written in the hooks file, is covered. Files that a covered file calls or reads are not covered either, and neither is a path inside an argument that is not the whole argument (`--config=./x.json`).
- **Files can change between the check and the run.** The digest is checked before the handler starts.

---

## When a command ends, and what you see

`command.start` fires from the runtime. A command's end is different: Pi has no single "command finished" signal, so the adapter ends a command at the first of these:

| Signal | Outcome |
| --- | --- |
| The model calls the `ensemble_command_complete` tool (the adapter adds one instruction per turn telling it to, while a run is in flight) | As the model said: `succeeded` or `failed`, with its `reason`, `summary` and `artifacts`. The end handlers run when the loop settles, after the command's final output |
| The agent loop ends in an error | `failed` |
| The user aborts the loop | `cancelled`, read from the settle event's `aborted` flag |
| The next Ensemble command that selects hooks begins | `cancelled`, naming the missing completion signal |
| The session shuts down | `cancelled`, the same way |

A run ends once, whichever signal arrives first, and its end handlers run once, one after another, only if the hooks file still selects them (a command can edit the file mid-run).

A loop that settles normally with no completion signal ends nothing: the command may be waiting for your reply. A run that never signals completion is never reported as `succeeded`.

What you see: after each event, Pi shows one report per command listing each handler with its status and duration, why it failed if it did, a prompt handler's message and first five findings, and whether output was truncated. A start handler that blocked is reported as an error naming the handler. A command no hooks file selects shows nothing. In print and JSON mode, where Pi has no UI, the report goes to stderr.

Shutdown is bounded. Pi awaited shutdown handlers for at least 100 seconds on every normal exit measured, and the adapter allows end handlers the sum of their timeouts, capped at 60000 ms. A handler that does not fit is skipped, and Pi tells you which and why.

---

## Per-harness capabilities

This table is the capability data in `packages/agent-core/src/lifecycle-hooks/capabilities.ts`, and the test for this guide fails if the two differ. A capability a harness cannot reliably observe is `false`; it is never approximated with a session or turn event.

| harness | adapter | command_start | command_end | command_end_on_cancel |
| --- | --- | --- | --- | --- |
| pi | yes | true | true | true |
| claude-code | no | false | false | false |
| codex | no | false | false | false |
| opencode | no | false | false | false |

Lifecycle hooks are not active in claude-code, codex, opencode: there is no adapter, so no code of this project runs there and nothing is shown when a command runs. A hooks file in such a project is simply ignored.

### The best-effort path

A team in a harness with no adapter can still write instructions into a command's own text that ask the model to do something at the start or end. That is a **best-effort** path. It depends entirely on the model choosing to follow the instruction: it may be skipped, it has no payload, no redaction, no timeout, no trust check and no block, and it is not lifecycle hook execution. This feature does not generate such instructions for any harness; the one instruction the Pi adapter adds is the per-turn completion reminder, and it applies only to Pi runs that have hooks.

---

## The status check

`packages/pi-extension/scripts/hooks-status.mjs` is a script, not a slash command. Run it from the repository checkout:

```sh
node packages/pi-extension/scripts/hooks-status.mjs [projectRoot]
```

It prints the capability table above, Pi's definition of a command's end, and whether the project's hooks file is absent, invalid (each error listed), valid but not trusted by you, or valid and trusted by you. It runs no handler. It cannot know Pi's own project trust, so it does not report it, and it does not check command names against Pi's command list. Its exit code is 0 when the file is absent or valid, 1 when invalid and 2 when the built `agent-core` cannot be loaded (build it with `tsc -p packages/agent-core`). Set `ENSEMBLE_HOOKS_TRUST_STORE` to read a different trust store file.

No `/hooks-*` slash command is registered by this feature, so it cannot collide with the commands of `pi-yaml-hooks`.

---

## How this differs from pi-yaml-hooks

`pi-yaml-hooks` is a separate, third-party hook runner for Pi and OMP (checked here at version 2026.9.26, from its installed README). Ensemble lifecycle hooks and `pi-yaml-hooks` are different systems, and **both can be installed together**: they register independently and do not depend on each other.

| | Ensemble lifecycle hooks | `pi-yaml-hooks` |
| --- | --- | --- |
| Scope | Ensemble command start and end | Sessions, prompts, tools and files (`user.prompt.submit`, `tool.before.*`, `tool.after.*`, `file.changed`, `session.*`). It has no command start or end event |
| File location | `.ensemble/hooks.yaml` in the project | `~/.pi/agent/hook/hooks.yaml` globally and `<project>/.pi/hook/hooks.yaml` in a project, for Pi |
| Trust | The host's project trust, plus your own digest-bound `/ensemble-lifecycle-trust` | Its own `/hooks-trust` and its own trust store |
| Blocking | A start handler of either type with `on_error: block` stops the command before its prompt reaches the model, enforced by the runtime | A `tool.before.*` action can block a tool call (a `bash` action exiting 2). Its `user.prompt.submit` hook is fail-open and cannot block or rewrite the prompt |
| Handlers | `shell` and `prompt` | Its own action types; its `bash` actions get JSON on standard input |

The two share nothing: a project can use either, both or neither, and one does not see the other's file.

---

## Known limits

- **Only Pi.** Nothing runs in Claude Code, Codex or OpenCode, and this guide does not claim otherwise.
- **The end signal depends on the model.** A command ends as `succeeded` or `failed` only if the model calls `ensemble_command_complete`. A model that forgets leaves the run in flight until the next hook-selected command or session shutdown ends it `cancelled`. Hooks never treat a quiet settle as success.
- **An abort is read at the settle.** Pi 1.2.0 fires no pre-settle event for an abort, so a `cancelled` end arrives when the loop settles.
- **A process killed by SIGINT in RPC mode runs no handler at all**, so a command still running then gets no `command.end`.
- **A prompt that fails before any loop starts** (for example no API key for the model) fires no settle event, so its run stays in flight until the next command or shutdown ends it `cancelled`.
- **Overlapping commands.** A completion call about an earlier command, made after a newer command's prompt was delivered, cannot be told apart from the newer one's and ends the newer run.
- **Redaction is pattern-based.** See [What redaction does not promise](#what-redaction-does-not-promise).
- **A handler that starts its own session escapes the group kill** on a timeout; only processes that stayed in the handler's process group are ended. On Windows the tree is ended with `taskkill /T /F`, which is untested.
- **Trust is a file you own.** See [Trust](#trust): a model with general file tools could write a record itself.
- **Hooks need a hooks file at Pi startup**, and trust must be given from an interactive session.
- **Unrelated, already present in Pi 1.2.0:** the forwarded text of a dispatcher command (`/ensemble:prd create foo`) is not expanded into the command's template and reaches the model as raw text. Hooks neither cause nor fix this; they resolve the command from that text so the lifecycle fires once, for the target.
