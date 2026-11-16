# Behavioral evals

Headless harness that checks what models *do* with Ensemble instructions. Deterministic checks decide every verdict; an optional model-judged check adds a separate score and never changes it.

## Run

```bash
npm run evals -- --dry-run                      # list scenarios
node evals/run.js --scenario fix-issue --model sonnet --max-usd 1
node evals/run.js --max-usd 5                   # all scenarios
```

Agent scenarios shell out to `claude -p` (stream-json, `--plugin-dir packages/<pkg>`, `--max-turns`, `--allowedTools`, `--permission-mode`) inside a throwaway git repo built from the scenario fixture. `cli` scenarios run no model.

Without the `claude` CLI (override path with `EVALS_CLAUDE_BIN`): `--dry-run` prints a skip message and exits 0 (2 if a skill eval definition was rejected); a real run exits 3.

## Cost cap

`--max-usd N` is the total budget. Each scenario gets the remainder as `--max-budget-usd`; once spent, later agent scenarios are skipped as `budget exhausted`. Always set it.

## Results

`evals/results/<model>-<timestamp>.json` (gitignored): per eval: `pass`, `verdict` (from deterministic checks only), `judgedScore` and `judgeModel` (judged checks only, `null` when none ran), `skill`, per-grader results (judged graders carry `judged: true`, and `refused: true` when the judge was refused), turns, cost. Exit code is 1 if any scenario fails.

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

`eval.json` fields: `skill`, `prompt` (plain language, the task as a user would ask it), `checks` (required); `id` (defaults to the directory name), `description`, `runtimes` (default `["claude"]`), `invocation` (`plain` default, or `explicit` with a `command` such as `/ensemble:create-prd`, prefixed to the prompt), `allowedTools`, `maxTurns`, `timeoutSec`, `repeats`, `bar`, `expectInvoked`. Unknown fields and unfilled `TODO:` placeholders are rejected. `runtimes`, `repeats`, `bar` and `expectInvoked` are validated but not yet acted on (they land in later PRs): each run and dry-run prints a warning line naming them, with no change to the exit code.

A definition is rejected, and nothing runs for it, when it lacks a task, a `fixture/` directory, a skill or checks; names a skill with no `SKILL.md` under `packages/*/skills`; has only judged checks; or has a judged check with no rubric. Other evals still run.

Checks are the graders below. A `{ "type": "judge", "rubric": "..." }` check is judged: it needs a rubric (inline or `rubric.md`), is marked `judged` in results, and is reported as `judgedScore` apart from `verdict`. The judge model comes from `--judge-model` or `EVALS_JUDGE_MODEL` and must differ from `--model` (names are compared after normalising, so `sonnet` and `claude-sonnet-5-5` are the same model); without `--model` there is nothing to compare against, so the judged check is refused as well. A refused judged check names the conflict and the deterministic checks still decide the eval.

Currently a skill eval runs one arm (with the skill loaded from its package). `evals/scenarios/` stays as legacy single-arm scenarios, not counted as skills. A skill eval whose id matches a legacy scenario id is rejected. Exit codes: 0 all pass, 1 an eval failed, 2 usage error or rejected definition (also under `--dry-run`), 3 `claude` missing.

## Add a scenario (legacy)

1. `evals/scenarios/<id>/scenario.json`: `type` (`agent`|`cli`), `prompt`, `plugins`, `allowedTools`, `permissionMode`, `maxTurns`, `timeoutSec`, optional `remote: true` (bare `origin`), and `graders`. `{{repo}}` expands to the repo root.
2. `evals/scenarios/<id>/fixture/`: files copied into the sandbox and committed on `main`.
3. Graders live in `evals/lib/graders.js` (`trdParses`, `fileExists`, `fileMatches`, `testsPass`, `commandOutputMatches`, `noProtectedBranchCommit`, `remoteBranchUnchanged`, `noForbiddenCommand`, `judge`). Add new ones as plain functions with a test (all are deterministic except `judge`, which calls a model).

Tests: `npx jest evals` (uses a stub `claude`; no model calls).
