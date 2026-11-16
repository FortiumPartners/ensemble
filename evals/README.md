# Behavioral evals

Headless harness that checks what models *do* with Ensemble instructions. Deterministic checks decide every verdict; an optional model-judged check adds a separate score and never changes it.

## Run

```bash
npm run evals -- --dry-run                      # list scenarios
node evals/run.js --scenario fix-issue --model sonnet --max-usd 1
node evals/run.js --max-usd 5                   # all scenarios
node evals/run.js --concurrency 2 --timeout 600 --keep-workspace
node evals/run.js --skill <skill> --runtime claude --repeats 3   # with-skill and baseline arms, repeated
```

Agent scenarios shell out to `claude -p` through the Claude adapter (`lib/runners/claude.js`: stream-json, `--setting-sources project`, `--plugin-dir packages/<pkg>`, `--max-turns`, `--allowedTools`, `--permission-mode`) inside a throwaway git repo built from the scenario fixture under `EVALS_WORKDIR`. `cli` scenarios run no model.

Without the `claude` CLI (override path with `EVALS_CLAUDE_BIN`): `--dry-run` prints a skip message and exits 0 (2 if a skill eval definition was rejected); a real run exits 3. Test hooks: `EVALS_SCENARIOS_DIR`, `EVALS_SKILLS_DIR`, `EVALS_RESULTS_DIR`.

## Safe execution

Each run works in its own throwaway directory, is budgeted, and its stored output is stripped of credential values. This is a directory sandbox, not an OS jail: the agent runs as you and can reach anything your user can, including files under the real `HOME` when it is passed through (see Environment).

- **Workspace.** Each run works in a fresh copy of the fixture under `EVALS_WORKDIR` (default `~/.omp/evals-work/`; `/tmp`, `$TMPDIR`, `/var/folders` and anything inside the repository are refused, after resolving symlinks). The repository is never touched. The workspace is removed afterwards; `--keep-workspace` keeps it and prints `workspace kept: <path>`.
- **Environment.** The agent and the judge call see only `PATH`, `LANG`, `TERM`, `TMPDIR`, `HOME` and the named credentials; nothing else is inherited. The checks that execute agent-written code or commands (`testsPass`, `commandOutputMatches`, `trdParses`) get the same environment with **no credentials**; only the agent and the judge get those. `HOME` passes through to the agent on a maintainer's machine so the CLI's own login works, which means the agent can read and write files under your real home directory; with `CI=true` or `GITHUB_ACTIONS=true` it is a fresh per-run directory under `EVALS_WORKDIR`, removed afterwards. The credential-free checks never get your real `HOME`: they always run with a throwaway empty `HOME` under `EVALS_WORKDIR` (in CI, the same per-run directory). Under `--runtime pi` the judge (a `claude` process) never receives the Pi provider keys named under `runtimes.pi`, and Pi runs use a throwaway empty `HOME` like the checks. Credential names live in `evals/env-allowlist.json` (`{"credentials": ["ANTHROPIC_API_KEY"], "runtimes": {"pi": [...]}}`; names under `runtimes.<name>` reach only that runtime's runs); add names per run with `--allow-env NAME` (repeatable) or use another file with `--env-allowlist FILE` (the file must exist). A credential reaches the agent from the local environment, or from CI secrets exported by the workflow. The harness's own `git` calls in the workspace use a sanitized environment (no `GIT_*`, no system or global config) with `core.fsmonitor`, `core.hooksPath`, `core.pager`, `core.gitProxy` and `protocol.ext.allow` neutralised (and `core.sshCommand` overridden by `GIT_SSH_COMMAND`). Those are the only keys covered; in particular `remote.<name>.uploadpack` and `receivepack` cannot be overridden from the command line, so the harness never runs `ls-remote`, `fetch` or `push` against a workspace remote name. The remote-branch check never contacts a remote by name: it reads the harness-created bare repository at the path recorded when the sandbox was created. Bash commands are also collected while the agent's output streams (up to 5000), so the forbidden-command check still sees early commands when the in-memory transcript is truncated; if the list itself is incomplete the check fails rather than passes.
- **Redaction.** Every allowlisted credential value present in the environment is replaced by `[REDACTED]` (raw, JSON-escaped, URL-encoded and base64 forms) in the agent transcript before it reaches the checks or the judge prompt, and in the stored report and every console line, including errors. Other encodings (hex, split or transformed values) are not detected. The report lists allowlisted variable names only, never environment values.
- **Cost cap.** `--max-usd N` per suite, default $50 (`evals/limits.json`). Each in-flight run reserves `--run-usd` (default $5, also passed to `claude --max-budget-usd`) plus `--judge-usd` (default $0.50) when the eval has an active judged check. A run starts only when spend plus all in-flight reservations plus its own reservation fit under the cap, so under `--concurrency N` (default 4) the total never exceeds it. Judge-call cost counts in the eval's `costUsd` and in spend. A run whose cost is unknown (timeout, crash, failed judge call: no reported figure) is charged its full reservation and marked `costEstimated: true`, so failing runs still consume the cap. Evals that never start are `incomplete` (`pass: null`, neither pass nor fail).
- **Timeout.** `--timeout SEC` per run, default 900 (a scenario's `timeoutSec` can only lower it; `--timeout` above the `limits.json` value is an error). The run is started in its own process group; on timeout the group (the agent and its child processes) is killed and the run is recorded `timed_out`, which counts as a failure. A descendant that deliberately leaves the process group (for example with `setsid`) is not killed, but cannot delay the result by more than about a second. Check commands and the judge call run under the same group kill and timeout, without blocking other runs.

`outcome` per eval is `pass`, `fail`, `timed_out` or `incomplete`. The report carries `passed`, `failed` (fail plus timed_out), `incomplete`, `totalCostUsd` and `peakCommittedUsd` (highest spend plus reservations seen).

Limits and defaults are plain data in `evals/limits.json`; flags override them.

## Results

`evals/results/<model>-<timestamp>.json` (gitignored): per eval: `pass`, `verdict` (from deterministic checks only), `judgedScore` and `judgeModel` (judged checks only, `null` when none ran), `skill`, per-grader results (judged graders carry `judged: true`, and `refused: true` when the judge was refused), turns, cost. See exit codes below.

## Skill evals

One eval per skill, as plain files (no build step, no registration; the loader scans `evals/skills/`):

```text
evals/skills/<skill>/eval.json   task, skill, checks
evals/skills/<skill>/fixture/    starting workspace, committed on `main` in the sandbox
evals/skills/<skill>/rubric.md   optional rubric for judged checks
```

```bash
node evals/new.js <skill>                     # scaffold eval.json + fixture/ (skill must exist under packages/*/skills)
node evals/run.js --dry-run [--skill <skill>] # list evals; rejected ones are named with the problem (exit 2)
node evals/run.js --skill <skill> --model sonnet --judge-model opus --max-usd 1
```

`eval.json` fields: `skill`, `prompt` (plain language, the task as a user would ask it), `checks` (required); `id` (defaults to the directory name), `description`, `runtimes` (default `["claude"]`; the eval runs only under a listed runtime), `invocation` (`plain` default, or `explicit` with a `command` such as `/ensemble:create-prd`, prefixed to the prompt), `allowedTools`, `maxTurns`, `timeoutSec`, `repeats`, `bar`, `expectInvoked`. Unknown fields and unfilled `TODO:` placeholders are rejected. `repeats`, `bar` and `expectInvoked` act since PR 3 (see Arms and repeats). `runtimes` acts since PR 4: under `--runtime pi` an eval that does not list `pi` is skipped with a `SKIP` line, and legacy agent scenarios are Claude-only. No field is accepted-but-ignored any more.

A definition is rejected, and nothing runs for it, when it lacks a task, a `fixture/` directory, a skill or checks; names a skill with no `SKILL.md` under `packages/*/skills`; has only judged checks; or has a judged check with no rubric. Other evals still run.

Checks are the graders below. A `{ "type": "judge", "rubric": "..." }` check is judged: it needs a rubric (inline or `rubric.md`), is marked `judged` in results, and is reported as `judgedScore` apart from `verdict`. The judge model comes from `--judge-model` or `EVALS_JUDGE_MODEL` and must differ from `--model` (names are compared after normalising, so `sonnet` and `claude-sonnet-5-5` are the same model); without `--model` there is nothing to compare against, so the judged check is refused as well. A refused judged check names the conflict and the deterministic checks still decide the eval.

`evals/scenarios/` stays as legacy single-arm scenarios, not counted as skills. A skill eval whose id matches a legacy scenario id is rejected. Exit codes: 0 all pass, 1 an eval failed or timed out, 2 usage error or rejected definition (also under `--dry-run`), 3 `claude` missing, 4 the suite finished with incomplete evals. When several apply, 2 comes first (a rejected definition), then 1 over 4, and 4 over 0.

## Arms and repeats

A skill eval runs two arms on identical fresh workspaces: **with-skill** (`--plugin-dir packages/<pkg>`, the package as shipped, never a copy) and **baseline** (no plugin for the skill under test). Both get `--setting-sources project`. The prompt is the same plain text in both; `invocation: explicit` prefixes `command` on the with-skill arm only. Each arm runs 5 times by default (`repeats` and `bar` in `limits.json`: 4 of 5 must pass for the with-skill arm to be reliable). Details, the startup-event findings and the Claude/Pi uplift distinction: `docs/guides/skills-eval.md`.

- `--repeats N` overrides the eval's `repeats`; `bar` in `eval.json` overrides the default bar, otherwise the default bar scales with `--repeats`. A bar above the repeats is a usage error (exit 2). The report states repeats, bar and where each came from.
- `--runtime claude|pi` (`claude` is the default). Any other runtime prints `unsupported --runtime "X": not supported in this release`, runs nothing and exits 2. Every result and the report record the runtime. Pi runs through `pi --print --mode json` (binary on `PATH` or `EVALS_PI_BIN`); its with-skill arm is `--no-skills --skill <skillDir>`, its baseline `--no-skills`, its uplift is labelled **skill-level**, and its cost is the reported `usage.cost.total` (else the per-run ceiling, flagged `costEstimated`). Details and the spike findings: the "Pi runtime" section of `docs/guides/skills-eval.md`.
- Uplift is labelled **package-level (skills share a package)** for Claude: the whole package is loaded, not only the skill.
- A baseline that has the skill loaded or invoked aborts that eval, naming the leak (exit 1, no baseline score; runs not yet started are skipped). A baseline that completed with no skill list (Claude: startup event; Pi: system prompt) aborts the same way as `baseline isolation unverifiable: no startup skill list`; a baseline that crashed or timed out before any init event is not counted toward the baseline score.
- A fixture containing `.claude/`, `.mcp.json`, `.git`, `.gitmodules`-style config or a symlink pointing outside it is rejected (the sandbox copy also skips them). Judged checks run on the with-skill arm only.
- Each result records `invoked` (from the transcript's `Skill` events) and the evaluated copy (package path, skill hash, whether the working tree differs from the committed copy). `expectInvoked` is report-only.
- Results: a skill eval is one entry in `results` with `withSkill`/`baseline` counts, `reliable`, `uplift` and the per-run results under `runs` (graders and cost per run). Budget reservation is per in-flight run, so at most `--concurrency` runs are reserved at once.

## Add a scenario (legacy)

1. `evals/scenarios/<id>/scenario.json`: `type` (`agent`|`cli`), `prompt`, `plugins`, `allowedTools`, `permissionMode`, `maxTurns`, `timeoutSec`, optional `remote: true` (bare `origin`), and `graders`. `{{repo}}` expands to the repo root.
2. `evals/scenarios/<id>/fixture/`: files copied into the sandbox and committed on `main`.
3. Graders live in `evals/lib/graders.js` (`trdParses`, `fileExists`, `fileMatches`, `testsPass`, `commandOutputMatches`, `noProtectedBranchCommit`, `remoteBranchUnchanged`, `noForbiddenCommand`, `judge`). Add new ones as plain functions with a test (all are deterministic except `judge`, which calls a model).

Tests: `npx jest evals` (uses a stub `claude`; no model calls).
