---
document_id: TRD-2026-24fac9e9
label: trd-skills-eval
kind: trd
prd_reference: docs/PRD/PRD-2026-24fac9e9-skills-eval-harness.md
version: 1.0.2
status: Draft
date: 2026-11-13
design_readiness_score: 4.3
test_approach: standard
Constitution compliance: passed
ensemble_implement_trd_beads:
  branch_name: feature/trd-2026-24fac9e9-skills-eval-harness-pr-1
  use_proposed: true
  stacked_prs: true
---

# TRD-2026-24fac9e9: Skills Evaluation Harness

Based on PRD: docs/PRD/PRD-2026-24fac9e9-skills-eval-harness.md (v1.0.1, Locked)

## Architecture Decision

**Chosen: Option C, extend `evals/` and put runtimes behind adapters.**

The repository already has a headless behavioral eval harness (`evals/run.js`, `evals/lib/sandbox.js`, `evals/lib/graders.js`, `.github/workflows/evals.yml`, five task-keyed scenarios, unit tests with a stub `claude`). It already provides a throwaway git sandbox, deterministic graders, a total spend cap (`--max-usd`), results files and an on-demand workflow. It lacks what the PRD is mostly about:

| PRD need | State today |
|---|---|
| Evals keyed by skill, editable as files | Scenarios are keyed by task, one `scenario.json` each |
| With-skill and no-skill arms | One arm only |
| Repeats and a reliability bar | One run per scenario |
| Scrubbed environment | `spawnSync` inherits the whole environment |
| Model, skill version, eval version, runtime in results | Only a model tag |
| Coverage per skill, result cache, replay, regression compare | None |
| Pi | None |

| Option | Summary | Verdict |
|---|---|---|
| A. Extend in place | Add the above to `run.js`; Pi logic added inline | Simplest, but Claude Code and Pi logic would tangle in one file |
| B. Adopt an external eval tool | Replace the runner with a third-party tool and port graders | Needs a spike and a new-dependency approval (constitution, Approval Requirements); rework of five tested scenarios; unknown support for a no-skill arm and Pi |
| **C. Extend with runner adapters** | Keep the tested runner, sandbox and graders. Add skill-keyed eval files, arms, repeats, an env allowlist, a results schema, coverage, cache and compare, behind a small runner interface with Claude Code and Pi adapters | **Chosen.** No new dependency (Node built-ins only), builds on tested code, and the eval format stays tool-neutral so an external runner could consume it later |

The PRD's Entry criterion (tool spike, fallback to a minimal in-repo runner) resolves to the fallback: this TRD is that runner, built on the existing harness. No new dependency is introduced, so no dependency approval is needed. If the owner later wants an external tool, the eval files in `evals/skills/` are the stable input.

Decisions fixed by the PRD and carried here: deterministic checks decide verdicts; judged checks only supplement and use a different model; 5 runs per arm with 4 of 5 required; $50 per suite and 900 s per run by default; results committed as per-skill baseline summaries with full logs as CI artifacts; Claude Code and Pi; on-demand CI only; advisory regression check.

## Domain Analysis

- **Brownfield.** New code lives under `evals/` and extends its existing modules. `evals/scenarios/` stays as legacy single-arm scenarios, run through the same sandbox, env and budget code, and is excluded from skill coverage.
- **Technical domains:** eval definition and validation (REQ-001 to REQ-005); safe execution (REQ-008 to REQ-010, REQ-020); arms, repeats and runtime adapters (REQ-006, REQ-007, REQ-012); results, reports, cache and compare (REQ-011, REQ-013 to REQ-016, REQ-021); CI and gate proof (REQ-017, REQ-018); pilot (REQ-019, REQ-022).
- **Companion artifacts:** none. Results are flat JSON files described under Data Shapes below, not a database or migration, and the one comparative decision (external tool or not) is settled above.
- **Threat model:** not generated as a separate section. The harness adds no externally exposed surface, authentication or PII. Its credential and untrusted-eval risks are handled by TRD-005, TRD-023 and the Risk Register.

## Reused Capabilities

None from other TRDs: the capability registry is empty. Reuse of existing `evals/` code (sandbox, graders, runner, tests) is an in-place extension, not a foundational-TRD dependency.

## System Architecture

### Components (all under `evals/`)

| Component | File | Role |
|---|---|---|
| CLI | `run.js` (extended), `new.js`, `coverage.js`, `compare.js` | Entry points. `npm run evals` and `node evals/run.js` stay the entry; `run.js` gains `--skill`, `--runtime`, `--repeats`, `--concurrency`, `--refresh`, `--keep-workspace`, `--timeout`, `--max-usd` |
| Eval definitions | `skills/<skill>/eval.json` plus `fixture/` and optional `rubric.md` | Editable data, no build step (Constitution rule 8) |
| Loader and validator | `lib/eval-def.js` | Parses and rejects bad definitions with named errors (rule 2) |
| Runner interface | `lib/runners/index.js`, `claude.js`, `pi.js` | `run(job) -> { transcript, exitCode, timedOut, costUsd, loadedSkills, runtime }` |
| Arms | `lib/arms.js` | Builds the with-skill and baseline job from one definition; leak check |
| Execution | `lib/exec.js` | Repeats, concurrency, budget reservation, timeout, incomplete status |
| Environment | `lib/env.js` | Allowlist environment builder and secret redaction |
| Workspace | `lib/sandbox.js` (extended) | Fresh copy under `EVALS_WORKDIR` outside the repository |
| Graders | `lib/graders.js` (extended) | Deterministic graders; new `judge` grader with model separation |
| Results | `lib/results.js`, `lib/hash.js` | Result schema, version hashing, baseline summaries |
| Cache | `lib/cache.js` | Reuse by content key |
| Reports | `lib/report.js`, `lib/coverage.js`, `lib/compare.js` | Per-skill report, coverage, like-for-like regression |
| Exemptions | `exemptions.json` | Editable skill-to-reason map for coverage |
| Baselines | `baselines/<runtime>/<skill>.json` | Committed per-skill summaries |

### Data flow

1. `run.js` loads skill-keyed evals and legacy scenarios, validates them, and resolves the target set (`--skill`, `--runtime`).
2. For each eval, runtime and arm, `exec.js` computes the cache key and reuses a stored result when allowed; otherwise it reserves budget and starts up to `--concurrency` jobs.
3. Each job gets a fresh workspace copy outside the repository, an allowlisted environment, and a runner adapter call. The with-skill arm loads the skill as shipped (the package directory, never a copy); the baseline arm loads nothing and the leak check inspects the runtime's reported loaded skills.
4. Graders run on the workspace and transcript. Deterministic checks set the verdict; judged checks add a separate score.
5. Results are redacted, written under `evals/results/` (logs, gitignored, uploaded as CI artifacts) and summarized into `evals/baselines/` for committing.
6. `report.js` prints reliability and uplift per skill; `coverage.js` prints statuses; `compare.js` compares against committed baselines like-for-like.

### Runner interface

A job is `{ evalId, skill, arm, runtime, model, prompt, workspace, env, timeoutMs, maxUsd, pluginDirs[] | skillPaths[] }`. `pluginDirs` is a list: a skill's with-skill arm may need more than one package, and the baseline arm may still need a package for the command or tooling the task uses (see TRD-027). The baseline never includes the package that ships the skill under test, except where the command it needs lives in that same package (stated in the eval definition). The Claude adapter builds `claude -p --output-format stream-json --verbose --no-session-persistence --max-budget-usd`, adds `--plugin-dir` for the with-skill arm, and adds `--setting-sources project` for both arms so user-level and synced plugins cannot leak into either arm. The Pi adapter uses `--print --mode json`, `--skill <path>` for the with-skill arm and `--no-skills` for the baseline. Both report loaded skills from the runtime's own startup or transcript events. Pi's exact flags, cost reporting and event shape are confirmed by TRD-012 before TRD-013.

**Design decision: uplift granularity.** The Claude with-skill arm loads a whole package through `--plugin-dir`, so every skill, command and agent in that package is present, not only the skill under test. Claude uplift is therefore measured at package level (skills share a package), not single-skill level. The Pi arm loads one skill through `--skill`, so Pi uplift is skill-level. Reports (TRD-015, TRD-016) must label Claude uplift "package-level (skills share a package)" and Pi uplift "skill-level", and the two are not to be compared as like quantities. The PRD is unchanged; this is a stated limit of the Claude Code mechanism.

### Data shapes

- `eval.json`: `{ id, skill, description, runtimes[], prompt, invocation?: "plain"|"explicit", command?, allowedTools[], maxTurns, timeoutSec?, repeats?, bar?, expectInvoked?, checks[] }`. `prompt` is plain language and is the same text in both arms; `invocation` defaults to `plain`. With `explicit`, only the with-skill arm gets `command` (for example `/ensemble:create-prd`) prefixed to the prompt. A check is `{ type, ... , judged?: true, rubric? }`. At least one check must be deterministic.
- Result (per run): `{ evalId, skill, skillVersion, skillHash, evalVersion, runtime, model, arm, invocationMode, run, outcome: pass|fail|timed_out|incomplete, invoked, costUsd, durationMs, graders[], replay }`.
- Baseline summary (`evals/baselines/<runtime>/<skill>.json`): `{ skill, skillVersion, evalVersion, model, runtime, repeats, bar, withSkill:{passes,runs}, baseline:{passes,runs}, reliable, uplift, recordedAt }`.
- Versions: `evalVersion` is a content hash of `eval.json`, `rubric.md` and `fixture/`. `skillHash` is a content hash of the skill directory; `skillVersion` is its `metadata.version` when present.

### Exit codes

`0` all pass, `1` an eval failed or a regression was found, `2` usage error, `3` runtime CLI missing (unchanged), `4` suite finished with incomplete evals (new). Precedence when several apply: `1` (an eval failed or a regression was found) wins over `4` (incomplete); `4` wins over `0`. Usage (`2`) and missing-CLI (`3`) errors end the run before results exist.

### Error and recovery paths

A rejected definition runs nothing for that eval and names the eval and the field. A runner crash or timeout is recorded as `timed_out` or `fail`, never `pass`. A budget stop marks the remainder `incomplete`. A leaked baseline aborts that eval with the leak named. A missing judge model or a judge equal to the model under test refuses the judged check rather than skipping it. Judge-call cost counts in the run's `costUsd` and in the suite cap reservation (the reservation per run includes a judge-call allowance when the eval has an active judged check).

## Master Task List

### PR 1: Skill-keyed eval definitions

**Shippable State:** A maintainer can scaffold an eval for any skill as plain files, run `node evals/run.js --dry-run` and see it accepted or rejected with a message naming the eval and the problem; the five existing scenarios still run unchanged.

- [ ] **TRD-001** Skill-keyed eval format, discovery and validation (`evals/lib/eval-def.js`, `evals/skills/`, `run.js` loading) [satisfies REQ-001] [satisfies REQ-002] (4h)
  - Validates PRD ACs: AC-001-1, AC-001-2, AC-002-1, AC-002-2, AC-002-3
  - Implementation AC:
    - [ ] Given an eval directory `evals/skills/<skill>/eval.json`, when `run.js` starts, then it is discovered and loaded with no build step and no registration elsewhere
    - [ ] Given a definition, when it is loaded, then it must state the task, the starting workspace, the skill under test and its checks
    - [ ] Given a definition missing any of those, when loaded, then it is rejected with a message naming the eval and the missing part, and nothing runs for it
    - [ ] Given a definition naming a skill with no `SKILL.md` under `packages/*/skills`, when loaded, then it is rejected naming the skill
    - [ ] Given a definition, when loaded, then `prompt` is plain language, `invocation` is `plain` unless set to `explicit`, and `explicit` requires a `command`
    - [ ] Given legacy `evals/scenarios/*`, when loaded, then they still load and run as single-arm evals excluded from skill coverage

- [ ] **TRD-001-TEST** Eval definition loading and validation [verifies TRD-001] [satisfies REQ-001] [satisfies REQ-002] [depends: TRD-001] (3h)
  - Validates PRD ACs: AC-001-1, AC-001-2, AC-002-1, AC-002-2, AC-002-3
  - Test AC:
    - [ ] Scenario: edit takes effect -- Given an eval whose prompt is edited on disk, When the loader runs again with no build, Then the loaded prompt is the edited one
    - [ ] Scenario: discovery without registration -- Given a new `evals/skills/<skill>/eval.json`, When `--dry-run` runs, Then the eval is listed
    - [ ] Scenario: complete definition loads -- Given a definition with task, workspace, skill and checks, When loaded, Then all four are present on the loaded object
    - [ ] Scenario: missing part rejected -- Given definitions each missing one required part, When loaded, Then each is rejected with the eval id and the part named and no run starts
    - [ ] Scenario: unknown skill rejected -- Given a definition naming a skill that does not exist, When loaded, Then it is rejected naming that skill

- [ ] **TRD-002** Deterministic-first check rules (`evals/lib/eval-def.js`, `evals/lib/graders.js`, `evals/lib/results.js`) [satisfies REQ-003] [satisfies REQ-004] [depends: TRD-001] (3h)
  - Validates PRD ACs: AC-003-1, AC-003-2, AC-004-1, AC-004-2
  - Implementation AC:
    - [ ] Given an eval with deterministic checks, when a run finishes, then the verdict is computed from deterministic checks only
    - [ ] Given an eval whose checks are all judged, when loaded, then it is rejected with a message saying a deterministic check is required
    - [ ] Given a judged check, when loaded, then it must carry a written rubric and its result is marked `judged`
    - [ ] Given a finished run, when reported, then the deterministic verdict and the judged score are shown in separate fields

- [ ] **TRD-002-TEST** Check classification behavior [verifies TRD-002] [satisfies REQ-003] [satisfies REQ-004] [depends: TRD-002] (3h)
  - Validates PRD ACs: AC-003-1, AC-003-2, AC-004-1, AC-004-2
  - Test AC:
    - [ ] Scenario: verdict from deterministic checks -- Given a run with passing deterministic checks and a failing judged check, When the verdict is computed, Then it is pass
    - [ ] Scenario: judged-only rejected -- Given an eval with only judged checks, When loaded, Then it is rejected naming the deterministic-check rule
    - [ ] Scenario: rubric required and marked -- Given a judged check without a rubric and one with a rubric, When loaded, Then the first is rejected and the second's result is marked judged
    - [ ] Scenario: separate reporting -- Given a finished run with a judged check, When the report is built, Then the verdict and the judged score are separate fields

- [ ] **TRD-003** Judge grader with model separation (`evals/lib/graders.js`, standalone `evals/lib/runners/judge.js`, created here in PR 1 with no dependency on the Claude adapter, which TRD-008 adds beside it) [satisfies REQ-004] [depends: TRD-002] (3h)
  - Validates PRD ACs: AC-004-3, AC-004-4
  - Implementation AC:
    - [ ] Given a judged check, when it runs, then the judging model (`--judge-model` or `EVALS_JUDGE_MODEL`) differs from the model under test and is recorded in the result
    - [ ] Given a judge model equal to the model under test, or none configured, when the harness starts, then it refuses to run the judged check and names the conflict
    - [ ] Given the judge refusal, when other checks exist, then the eval still runs on its deterministic checks and reports the judged check as refused
    - [ ] Given a judge call that reports cost, when the result is built, then that cost is added to the run's `costUsd` so that TRD-007's suite cap and reservation count it (the judge module is standalone and created in this PR; it does not use `lib/runners`)

- [ ] **TRD-003-TEST** Judge model separation [verifies TRD-003] [satisfies REQ-004] [depends: TRD-003] (2h)
  - Validates PRD ACs: AC-004-3, AC-004-4
  - Test AC:
    - [ ] Scenario: different judge recorded -- Given a stub judge model different from the run model, When a judged check runs, Then the result records the judge model
    - [ ] Scenario: same model refused -- Given a judge equal to the run model, When the harness starts, Then the judged check is refused with the conflict named and deterministic checks still run
    - [ ] Scenario: judge cost counted -- Given a stub judge reporting $0.50 and a run reporting $1.00, When the result is built, Then `costUsd` is 1.50

- [ ] **TRD-004** Eval scaffold command (`evals/new.js`, template under `evals/templates/`) [satisfies REQ-005] [depends: TRD-001] (2h)
  - Validates PRD ACs: AC-005-1
  - Implementation AC:
    - [ ] Given `node evals/new.js <skill>`, when run, then a skeleton `evals/skills/<skill>/eval.json` and `fixture/` are written with every required field present as a placeholder
    - [ ] Given the skeleton with its placeholders filled in, when loaded, then it passes the loading checks

- [ ] **TRD-004-TEST** Scaffold behavior [verifies TRD-004] [satisfies REQ-005] [depends: TRD-004] (2h)
  - Validates PRD ACs: AC-005-1
  - Test AC:
    - [ ] Scenario: scaffold loads once filled -- Given a scaffolded eval with placeholders replaced, When loaded, Then it passes validation

### PR 2: Safe execution

**Shippable State:** Existing scenarios and new evals run in an isolated workspace outside the repository with an allowlisted environment and credential-free stored output; a suite stops at the cost cap, reports unfinished evals as incomplete and exits non-zero, and defaults to $50 per suite and 900 s per run.

- [ ] **TRD-005** Environment allowlist and redaction (`evals/lib/env.js`, `evals/lib/sandbox.js`) [satisfies REQ-009] [satisfies REQ-020] (4h)
  - Validates PRD ACs: AC-009-1, AC-009-2, AC-009-3, AC-020-1, AC-020-2
  - Implementation AC:
    - [ ] Given a run, when the agent process starts, then its environment is built from an allowlist (`PATH`, `LANG`, `TERM`, `TMPDIR`, `HOME` as set by the next criterion, and the credential names listed in the allowlist) and nothing else is inherited
    - [ ] Given a run on a maintainer's machine, when the agent process starts, then `HOME` passes through unchanged so the CLI's own login session works; given hosted CI (`CI=true` or `GITHUB_ACTIONS=true`), when it starts, then `HOME` is a fresh temporary directory created per run outside the repository (under `EVALS_WORKDIR`, never `/tmp`) and removed afterward
    - [ ] Given a credential in the maintainer's environment that is not on the allowlist, when a run executes, then the agent cannot read it
    - [ ] Given a credential the run needs, when it is named on the allowlist, then it reaches the agent from the local environment on a maintainer's machine and from CI secrets in hosted CI
    - [ ] Given any stored result, log or report, when it is written, then every value of an allowlisted credential is replaced by `[REDACTED]`
    - [ ] Given a stored result, when inspected, then it holds only non-secret allowlisted values

- [ ] **TRD-005-TEST** Environment and redaction behavior [verifies TRD-005] [satisfies REQ-009] [satisfies REQ-020] [depends: TRD-005] (4h)
  - Validates PRD ACs: AC-009-1, AC-009-2, AC-009-3, AC-020-1, AC-020-2
  - Test AC:
    - [ ] Scenario: only allowlisted variables visible -- Given a stub runner that prints its environment, When a run starts, Then only allowlisted names appear
    - [ ] Scenario: non-allowlisted credential hidden -- Given `SECRET_X` set in the parent environment, When a run executes, Then the stub cannot read it
    - [ ] Scenario: HOME local passthrough and CI sandbox -- Given a stub that prints `HOME` and a parent `HOME=/home/maint`, When it runs without `CI`, Then it sees `/home/maint`; When it runs with `CI=true`, Then it sees a fresh directory that differs from the parent `HOME`, is outside the repository, and is removed after the run
    - [ ] Scenario: allowlisted credential delivered -- Given `ANTHROPIC_API_KEY` on the allowlist, When a run starts, Then the stub receives it
    - [ ] Scenario: secret never stored -- Given a stub that prints the allowlisted credential, When results and logs are written, Then the value is absent from them
    - [ ] Scenario: stored result carries no secret env -- Given a stored result, When its keys and values are scanned, Then it holds no environment values beyond allowlisted non-secret ones

- [ ] **TRD-006** Workspace isolation outside the repository (`evals/lib/sandbox.js`) [satisfies REQ-008] (3h)
  - Validates PRD ACs: AC-008-1, AC-008-2
  - Implementation AC:
    - [ ] Given a run, when it starts, then it works in a fresh copy of the eval fixture under `EVALS_WORKDIR` (default `~/.omp/evals-work/`, never `/tmp`), not inside the repository
    - [ ] Given a run that modifies or deletes files, when it finishes, then a before-and-after check shows the real repository unchanged
    - [ ] Given a finished run, when `--keep-workspace` is absent, then the workspace is removed; when present, it is kept and its path printed

- [ ] **TRD-006-TEST** Workspace isolation behavior [verifies TRD-006] [satisfies REQ-008] [depends: TRD-006] (3h)
  - Validates PRD ACs: AC-008-1, AC-008-2
  - Test AC:
    - [ ] Scenario: fresh isolated copy -- Given a stub run, When it starts, Then its working directory is outside the repository and holds a fresh fixture copy
    - [ ] Scenario: repository untouched and workspace removed -- Given a stub that deletes files and writes to the workspace, When the run finishes, Then the repository tree hash is unchanged and the workspace is gone unless `--keep-workspace` was passed

- [ ] **TRD-007** Cost cap, timeout and incomplete status (`evals/lib/exec.js`, `evals/run.js`) [satisfies REQ-010] [depends: TRD-006] (4h)
  - Validates PRD ACs: AC-010-1, AC-010-2, AC-010-3, AC-010-4
  - Implementation AC:
    - [ ] Given a suite cost cap, when spend plus in-flight reservations would exceed it, then no new run starts, finished evals keep their results and unfinished ones are marked `incomplete`
    - [ ] Given incomplete evals, when the suite ends, then they are never counted as pass or fail and the process exits `4`
    - [ ] Given a single run that exceeds its timeout, when the limit is reached, then the run and its child processes are killed and recorded `timed_out`, not pass
    - [ ] Given no override, when a suite runs, then the cap is $50 per suite and the timeout is 900 s per run
    - [ ] Given judge-call cost, when the cap and reservations are computed, then judge cost counts toward both (see TRD-003)
    - [ ] Given both a failed eval and incomplete evals in one suite, when the suite ends, then the exit status is `1`, not `4`

- [ ] **TRD-007-TEST** Budget and timeout behavior [verifies TRD-007] [satisfies REQ-010] [depends: TRD-007] (4h)
  - Validates PRD ACs: AC-010-1, AC-010-2, AC-010-3, AC-010-4
  - Test AC:
    - [ ] Scenario: cap stops new runs -- Given a stub reporting $2 per run and a $5 cap, When a suite of 5 runs executes, Then no run starts past the cap and finished runs keep their results
    - [ ] Scenario: incomplete never pass or fail, exit 4 -- Given a suite stopped by the cap, When it ends, Then unfinished evals are `incomplete`, counted in neither pass nor fail, and the exit status is 4
    - [ ] Scenario: timeout is not a pass -- Given a stub that sleeps past a 1 s timeout, When the run executes, Then it is killed and recorded `timed_out`
    - [ ] Scenario: child processes killed on timeout -- Given a stub that spawns a grandchild process and then sleeps past a 1 s timeout, When the run times out, Then both the stub and the grandchild are dead (checked by pid) and the run is recorded `timed_out`
    - [ ] Scenario: reservation under concurrency -- Given `--concurrency 4`, a slow stub reporting $2 per run and a $5 cap, When a suite of at least 5 runs executes, Then at no moment does spend plus in-flight reservations exceed $5, no run starts once the reservations would exceed the cap, and unstarted evals are `incomplete`
    - [ ] Scenario: failure outranks incomplete -- Given a suite with one failing eval and one cap-stopped eval, When it ends, Then the exit status is 1
    - [ ] Scenario: defaults -- Given no flags, When limits are read, Then the cap is 50 and the run timeout is 900 s
    - [ ] Scenario: judge cost counts toward cap and reservation -- Given a stub run costing $1.00 and a judge call costing $0.50 with a $5 cap, When the suite totals spend, Then the eval's cost is 1.50 and the reservation for the next run includes the judge allowance

### PR 3: With-skill and baseline arms, repeats, Claude Code adapter

**Shippable State:** `node evals/run.js --skill <skill> --runtime claude` runs the skill's eval with the skill and without it, repeated, and prints each run's outcome and the eval's reliability and whether the skill was actually invoked.

- [ ] **TRD-008** Runner interface and Claude Code adapter (`evals/lib/runners/index.js`, `claude.js`; refactor of `sandbox.js` claude helpers; creates `docs/guides/skills-eval.md`) [satisfies REQ-012] [depends: TRD-005] [depends: TRD-006] (5h)
  - Validates PRD ACs: AC-012-1
  - Implementation AC:
    - [ ] Given the interface `run(job)`, when the Claude adapter runs, then it returns `{ transcript, exitCode, timedOut, costUsd, loadedSkills, runtime }` and existing scenarios behave as before
    - [ ] Given a skill shipped in a package, when its with-skill arm runs, then the adapter loads each package in the job's `pluginDirs` (for one skill, its own package: `--plugin-dir packages/<pkg>`) as the plugin, never a private copy
    - [ ] Given any arm, when the adapter builds arguments, then `--setting-sources project` is passed so user-level and synced plugins are not loaded
    - [ ] Given one short real Claude run with a plugin loaded and one without, when the stream-json startup events are inspected, then whether they list loaded skills is recorded in `docs/guides/skills-eval.md` with the event shape
    - [ ] Given the startup events do not list loaded skills, when `loadedSkills` is built, then it is derived from the transcript's skill-invocation events and the leak check uses that scan instead

- [ ] **TRD-008-TEST** Runner interface and as-shipped loading [verifies TRD-008] [satisfies REQ-012] [depends: TRD-008] (3h)
  - Validates PRD ACs: AC-012-1
  - Test AC:
    - [ ] Scenario: skill loaded as shipped -- Given a stub `claude` that records its arguments, When a with-skill arm runs, Then `--plugin-dir` points at the shipped package directory and no copy of the skill exists in the workspace
    - [ ] Scenario: setting sources on both arms -- Given a stub `claude` that records its argv, When a with-skill arm and a baseline arm run, Then both recorded argvs contain `--setting-sources project`
    - [ ] Scenario: loaded skills from the transcript scan -- Given a stub stream with no startup skill list and a skill-invocation event later in the stream, When the adapter returns, Then `loadedSkills` is derived from the invocation events and the leak check uses it
    - [ ] Scenario: existing scenarios unchanged -- Given the existing scenarios and the stub `claude`, When they run through the adapter, Then they behave as before (same args shape, outcome and cost reading)

- [ ] **TRD-009** With-skill and baseline arms with leak check (`evals/lib/arms.js`) [satisfies REQ-006] [depends: TRD-008] [depends: TRD-001] (5h)
  - Validates PRD ACs: AC-006-1, AC-006-2, AC-006-3, AC-006-4
  - Implementation AC:
    - [ ] Given an eval, when it runs, then a with-skill arm and a baseline arm run on identical fresh workspaces with the same task and settings
    - [ ] Given the baseline arm, when it starts, then the skill under test is not loaded and its prompt is the plain task
    - [ ] Given an eval with `invocation: explicit`, when it runs, then only the with-skill arm's prompt is prefixed with the command and the result records the invocation mode
    - [ ] Given a baseline arm whose runtime reports the skill under test as loaded, or whose transcript invokes it, when detected, then that eval aborts with a message naming the leak and the arm is not scored
    - [ ] Given a skill the agent may already know, when its baseline runs, then the baseline is the same agent with the skill unavailable and a near-zero uplift is reported as a valid result

- [ ] **TRD-009-TEST** Arm construction and leak detection [verifies TRD-009] [satisfies REQ-006] [depends: TRD-009] (4h)
  - Validates PRD ACs: AC-006-1, AC-006-2, AC-006-3, AC-006-4
  - Test AC:
    - [ ] Scenario: arms identical except the skill -- Given a stub runner recording jobs, When a plain eval and an explicit eval run, Then both arms receive the same workspace content, prompt text and settings and differ only in the plugin/skill set loaded, and in explicit mode only by the command prefix on the with-skill arm
    - [ ] Scenario: baseline has no skill -- Given the baseline job, When inspected, Then it carries no plugin directory or skill path for the skill under test
    - [ ] Scenario: leak aborts the eval -- Given a stub whose baseline reports the skill as loaded, When the eval runs, Then it aborts naming the leak and records no baseline score
    - [ ] Scenario: near-zero uplift is valid -- Given stub arms with equal pass rates, When results are computed, Then uplift is 0 and the eval is not an error

- [ ] **TRD-010** Repeats, concurrency and reliability (`evals/lib/exec.js`) [satisfies REQ-007] [depends: TRD-009] [depends: TRD-007] (3h)
  - Validates PRD ACs: AC-007-1, AC-007-2, AC-007-3
  - Implementation AC:
    - [ ] Given default settings, when an eval runs, then each arm executes 5 times, up to `--concurrency` (default 4) at once, with budget reserved per in-flight run
    - [ ] Given an arm where 4 of 5 runs pass, when results are computed, then the eval is reliable; given 3 of 5, it is not reliable
    - [ ] Given `repeats` or `bar` set in an eval, when it runs, then those values are used and the report states them

- [ ] **TRD-010-TEST** Repeats and reliability behavior [verifies TRD-010] [satisfies REQ-007] [depends: TRD-010] (3h)
  - Validates PRD ACs: AC-007-1, AC-007-2, AC-007-3
  - Test AC:
    - [ ] Scenario: five runs per arm -- Given a counting stub and default settings, When an eval runs, Then each arm is executed 5 times
    - [ ] Scenario: bar boundary -- Given stubs passing 4 of 5 and 3 of 5, When reliability is computed, Then the first is reliable and the second is not
    - [ ] Scenario: per-eval override reported -- Given `repeats: 3` and `bar: 3` in an eval, When it runs and is reported, Then 3 runs execute and the report states 3 and 3

- [ ] **TRD-011** Skill-invoked detection and evaluated-copy report (`evals/lib/runners/claude.js`, `evals/lib/results.js`) [satisfies REQ-012] [depends: TRD-008] (4h)
  - Validates PRD ACs: AC-012-2, AC-012-3
  - Implementation AC:
    - [ ] Given an eval with `expectInvoked`, when the with-skill arm runs, then the result records whether the skill was actually invoked, read from the transcript's skill invocation events
    - [ ] Given any run, when it is reported, then it states which copy was evaluated (package path, skill hash, and whether the working tree differs from the installed or committed copy)

- [ ] **TRD-011-TEST** Invocation detection and evaluated-copy report [verifies TRD-011] [satisfies REQ-012] [depends: TRD-011] (3h)
  - Validates PRD ACs: AC-012-2, AC-012-3
  - Test AC:
    - [ ] Scenario: invoked recorded -- Given stub transcripts with and without a skill invocation, When results are built, Then `invoked` is true and false respectively
    - [ ] Scenario: evaluated copy reported -- Given a skill directory edited after its last commit, When a run is reported, Then the report names the path, hash and that the working tree differs

### PR 4: Pi adapter

**Shippable State:** `--runtime pi` runs the same evals through Pi, results record the runtime, and an unsupported runtime is rejected with a clear message.

- [ ] **TRD-012** Spike: Pi headless skill loading, cost reporting and baseline switching (findings appended to `docs/guides/skills-eval.md`, created in TRD-008; throwaway scripts outside the repository) [satisfies REQ-012] [depends: TRD-008] (3h)
  - Implementation AC:
    - [ ] Given Pi run headless (`--print --mode json`), when a skill is passed with `--skill` and when `--no-skills` is passed, then the recorded behavior shows how loaded skills can be read from output in each case
    - [ ] Given a headless Pi run, when it finishes, then whether it reports token usage or cost is recorded, with the field names
    - [ ] Given the findings, when TRD-013 is started, then its cost accounting uses reported cost if present, otherwise a documented per-run ceiling counted against the suite cap

- [ ] **TRD-013** Pi adapter (`evals/lib/runners/pi.js`) [satisfies REQ-012] [depends: TRD-012] [depends: TRD-008] [depends: TRD-005] (5h)
  - Validates PRD ACs: AC-012-4, AC-012-5
  - Implementation AC:
    - [ ] Given a pilot skill and `--runtime pi`, when it runs, then the with-skill arm passes the skill via `--skill`, the baseline passes `--no-skills`, and each result records the runtime
    - [ ] Given a runtime other than `claude` or `pi`, when requested, then the harness reports it is not supported in this release and runs nothing
    - [ ] Given Pi, when a run completes, then cost is taken from reported usage or from the documented ceiling, and counts against the suite cap

- [ ] **TRD-013-TEST** Pi adapter and runtime selection [verifies TRD-013] [satisfies REQ-012] [depends: TRD-013] (3h)
  - Validates PRD ACs: AC-012-4, AC-012-5
  - Test AC:
    - [ ] Scenario: both runtimes evaluated, runtime recorded -- Given stub `claude` and `pi` binaries, When a pilot eval runs for both runtimes, Then each result records its runtime and the Pi jobs use `--skill` and `--no-skills` for the two arms
    - [ ] Scenario: unsupported runtime rejected -- Given `--runtime codex`, When the harness starts, Then it prints that the runtime is not supported and runs nothing

### PR 5: Results, reports and coverage

**Shippable State:** After a run, a maintainer sees each skill's with-skill and baseline pass rates, uplift and reliability, and a coverage report listing every skill as evaluated, exempt (with reason) or missing; a per-skill baseline summary is written for committing.

- [ ] **TRD-014** Result schema and version recording (`evals/lib/results.js`, `evals/lib/hash.js`) [satisfies REQ-013] [depends: TRD-010] (4h)
  - Validates PRD ACs: AC-013-1, AC-013-2
  - Implementation AC:
    - [ ] Given a completed run, when its result is stored, then it records model id, skill version, skill hash, eval version, arm, runtime, run outcome, cost and the judge model when used
    - [ ] Given a stored result, when read later, then every field a comparison needs is present, and a result missing one is rejected on read with the field named

- [ ] **TRD-014-TEST** Result schema behavior [verifies TRD-014] [satisfies REQ-013] [depends: TRD-014] (3h)
  - Validates PRD ACs: AC-013-1, AC-013-2
  - Test AC:
    - [ ] Scenario: result records what it ran against -- Given a stub run, When its result is stored, Then model, skill version, eval version, arm, runtime, outcome and cost are present
    - [ ] Scenario: incomplete stored result rejected -- Given a stored result with the eval version removed, When read, Then it is rejected naming the missing field

- [ ] **TRD-015** Committed baseline summaries and CI log artifacts (`evals/lib/results.js`, `evals/baselines/`, `.github/workflows/evals.yml`) [satisfies REQ-013] [depends: TRD-014] (3h)
  - Validates PRD ACs: AC-013-3, AC-013-4
  - Implementation AC:
    - [ ] Given a finished suite, when results are stored, then a small summary is written to `evals/baselines/<runtime>/<skill>.json` for committing and full run logs stay in `evals/results/` (gitignored) and are uploaded as a CI artifact
    - [ ] Given a committed baseline summary, when a regression check runs locally or in CI, then it compares against that committed summary
    - [ ] Given a baseline summary, when written, then it records the uplift granularity (`package` for the Claude runtime, `skill` for Pi)

- [ ] **TRD-015-TEST** Baseline summary storage [verifies TRD-015] [satisfies REQ-013] [depends: TRD-015] (3h)
  - Validates PRD ACs: AC-013-3, AC-013-4
  - Test AC:
    - [ ] Scenario: summary written, logs kept out of the repo -- Given a finished stub suite, When results are stored, Then a baseline summary exists under `evals/baselines/` and full logs exist only under the gitignored `evals/results/`
    - [ ] Scenario: check reads the committed summary -- Given a committed summary and a new result, When the regression check runs, Then it compares against the committed file
    - [ ] Scenario: granularity recorded -- Given stub Claude and Pi results, When baseline summaries are written, Then the Claude summary records `granularity: package` and the Pi summary `granularity: skill`

- [ ] **TRD-016** Per-skill report (`evals/lib/report.js`) [satisfies REQ-014] [depends: TRD-014] (4h)
  - Validates PRD ACs: AC-014-1, AC-014-2, AC-014-3
  - Implementation AC:
    - [ ] Given a finished suite, when the report is produced, then each evaluated skill shows with-skill pass rate, baseline pass rate, their difference and its reliability verdict
    - [ ] Given the pilot, when reported, then uplift is a number with no pass or fail applied
    - [ ] Given a skill with incomplete evals, when reported, then it is marked incomplete and given no score
    - [ ] Given a Claude Code uplift figure, when reported, then it is labelled "package-level (skills share a package)", and a Pi uplift figure is labelled "skill-level"

- [ ] **TRD-016-TEST** Per-skill report behavior [verifies TRD-016] [satisfies REQ-014] [depends: TRD-016] (3h)
  - Validates PRD ACs: AC-014-1, AC-014-2, AC-014-3
  - Test AC:
    - [ ] Scenario: report shows rates, difference and verdict -- Given stub results, When the report is built, Then each skill row has both pass rates, the difference and the reliability verdict
    - [ ] Scenario: uplift reported, not judged -- Given a skill with negative uplift, When reported, Then the number is shown and no pass or fail is attached to it
    - [ ] Scenario: incomplete skill unscored -- Given a skill with an incomplete eval, When reported, Then it is marked incomplete with no score
    - [ ] Scenario: uplift granularity labelled -- Given stub Claude and Pi results, When the report is built, Then the Claude row says "package-level (skills share a package)" and the Pi row says "skill-level"

- [ ] **TRD-017** Coverage report and exemptions (`evals/coverage.js`, `evals/lib/coverage.js`, `evals/exemptions.json`) [satisfies REQ-015] [depends: TRD-001] (4h)
  - Validates PRD ACs: AC-015-1, AC-015-2, AC-015-3
  - Implementation AC:
    - [ ] Given the shipped skills (source skills under `packages/*/skills`, excluding the `packages/full` symlink farm), when the coverage report runs, then every skill appears exactly once as evaluated, exempt or missing
    - [ ] Given a skill in `exemptions.json`, when reported, then its reason is shown; an exemption with no reason is reported as missing
    - [ ] Given a new skill with no eval and no exemption, when reported, then it is listed missing
    - [ ] Given the initial `exemptions.json`, when committed, then it lists the adapter-loaded skills with their reason

- [ ] **TRD-017-TEST** Coverage report behavior [verifies TRD-017] [satisfies REQ-015] [depends: TRD-017] (3h)
  - Validates PRD ACs: AC-015-1, AC-015-2, AC-015-3
  - Test AC:
    - [ ] Scenario: every skill once, one status -- Given a fixture tree of skills with evals and exemptions, When coverage runs, Then each skill appears exactly once with one of the three statuses
    - [ ] Scenario: exemption needs a reason -- Given an exemption with no reason, When coverage runs, Then that skill is missing
    - [ ] Scenario: new skill missing -- Given a new skill with no eval and no exemption, When coverage runs, Then it is listed missing

### PR 6: Cache, comparison and replay

**Shippable State:** Unchanged skill, eval, model and runtime combinations reuse stored results with no new model spend; a previously reliable eval that now falls below the bar is reported as a regression against the committed baseline; every failing run prints a command that replays it.

- [ ] **TRD-018** Result cache (`evals/lib/cache.js`) [satisfies REQ-011] [depends: TRD-014] (4h)
  - Validates PRD ACs: AC-011-1, AC-011-2, AC-011-3
  - Implementation AC:
    - [ ] Given a skill hash, eval version, model, runtime and arm that match a stored result, when the suite runs, then the stored result is reused and no model call is made
    - [ ] Given any of those changed, when the suite runs, then the affected eval runs again
    - [ ] Given a stored result of any age with matching inputs, when the suite runs, then it is reused, and `--refresh` forces a fresh run

- [ ] **TRD-018-TEST** Cache behavior [verifies TRD-018] [satisfies REQ-011] [depends: TRD-018] (3h)
  - Validates PRD ACs: AC-011-1, AC-011-2, AC-011-3
  - Test AC:
    - [ ] Scenario: unchanged inputs reuse the result -- Given a stored result and a stub that fails if called, When the suite runs, Then the stub is never called
    - [ ] Scenario: changed input reruns -- Given an edited skill file, When the suite runs, Then the affected eval runs again
    - [ ] Scenario: no age limit, refresh forces -- Given a stored result dated a year old, When the suite runs, Then it is reused, and with `--refresh` it runs fresh

- [ ] **TRD-019** Like-for-like comparison and regression detection (`evals/compare.js`, `evals/lib/compare.js`) [satisfies REQ-016] [satisfies REQ-018] [depends: TRD-015] [depends: TRD-016] (4h)
  - Validates PRD ACs: AC-016-1, AC-016-2, AC-018-1, AC-018-3
  - Implementation AC:
    - [ ] Given a stored baseline with the same model, runtime and eval version, when a new result is produced, then the report shows the change in score
    - [ ] Given no baseline with matching model and eval version, when a result is produced, then no regression is claimed and the report says nothing comparable exists
    - [ ] Given a baseline in which an eval was reliable, when the new result is not reliable, then the check fails and names the skill and eval
    - [ ] Given incomplete or not-comparable results, when the check runs, then it does not pass silently: it exits `4` for incomplete and prints a not-comparable notice

- [ ] **TRD-019-TEST** Comparison and regression behavior [verifies TRD-019] [satisfies REQ-016] [satisfies REQ-018] [depends: TRD-019] (4h)
  - Validates PRD ACs: AC-016-1, AC-016-2, AC-018-1, AC-018-3
  - Test AC:
    - [ ] Scenario: score change shown -- Given a baseline and a new result with matching model, runtime and eval version, When compared, Then the change in score is reported
    - [ ] Scenario: nothing comparable, no regression -- Given a baseline with a different eval version, When compared, Then no regression is claimed and the report says nothing is comparable
    - [ ] Scenario: reliable to unreliable fails -- Given a reliable baseline and a 3-of-5 result, When the check runs, Then it fails naming the skill and eval
    - [ ] Scenario: incomplete and not-comparable do not pass silently -- Given an incomplete result and a not-comparable result, When the check runs, Then the first exits 4 and the second prints a not-comparable notice

- [ ] **TRD-020** Replay handle for failing runs (`evals/lib/results.js`, `evals/run.js`) [satisfies REQ-021] [depends: TRD-014] (2h)
  - Validates PRD ACs: AC-021-1
  - Implementation AC:
    - [ ] Given a failing run, when the report is produced, then it prints a command that reruns that run with the same eval, arm, runtime, model, repeat index and settings

- [ ] **TRD-020-TEST** Replay handle [verifies TRD-020] [satisfies REQ-021] [depends: TRD-020] (2h)
  - Validates PRD ACs: AC-021-1
  - Test AC:
    - [ ] Scenario: replay command reproduces the run -- Given a failing stub run, When its replay command is parsed and executed with the same stub, Then it runs the same eval, arm, runtime, model and repeat index

### PR 7: CI, credential guard and proof the gate can fail

**Shippable State:** A maintainer triggers the evals from the Actions tab choosing skill and runtime, gets the per-skill report and an advisory regression result, and a test proves the regression check fails when a defect is introduced; nothing runs automatically on a change.

- [ ] **TRD-021** Local and CI parity, on-demand workflow, advisory check (`.github/workflows/evals.yml`, `package.json` scripts, `evals/README.md`, `docs/guides/skills-eval.md`) [satisfies REQ-017] [satisfies REQ-018] [depends: TRD-016] [depends: TRD-019] (3h)
  - Validates PRD ACs: AC-017-1, AC-017-2, AC-017-3, AC-018-4
  - Implementation AC:
    - [ ] Given the new flags, scripts and eval format, when documented, then `evals/README.md` and `docs/guides/skills-eval.md` describe them
    - [ ] Given `npm run evals`, `npm run evals:coverage` and `npm run evals:compare`, when run on a maintainer's machine, then they produce the same reports the workflow produces
    - [ ] Given the workflow, when a maintainer triggers it (`workflow_dispatch` with `skill`, `runtime`, `model`, `max_usd`), then it runs the selected skills, or the full suite when none are selected
    - [ ] Given a change touching a skill or an eval, when no maintainer triggered a run, then the workflow does not run (no `push` or `pull_request` trigger)
    - [ ] Given a failed regression check, when the workflow ends, then the step reports failure, the workflow is not a required status check on any protected branch, and `docs/guides/skills-eval.md` says so

- [ ] **TRD-021-TEST** CI parity and trigger rules [verifies TRD-021] [satisfies REQ-017] [satisfies REQ-018] [depends: TRD-021] (3h)
  - Validates PRD ACs: AC-017-1, AC-017-2, AC-017-3, AC-018-4
  - Test AC:
    - [ ] Scenario: same reports locally and in CI -- Given the workflow's run steps, When compared with the npm scripts, Then they invoke the same entry points with the same arguments
    - [ ] Scenario: on-demand selection -- Given the workflow file, When parsed, Then it has a `workflow_dispatch` trigger with `skill`, `runtime`, `model` and `max_usd` inputs
    - [ ] Scenario: no automatic trigger -- Given the workflow file, When parsed, Then it has no `push`, `pull_request` or `schedule` trigger
    - [ ] Scenario: advisory, not required -- Given `docs/guides/skills-eval.md`, When read, Then it states the regression check is advisory and the evals workflow is not a required status check

- [ ] **TRD-022** Proof that the regression check can fail (`evals/tests/regression-gate.test.js`) [satisfies REQ-018] [depends: TRD-019] (3h)
  - Validates PRD ACs: AC-018-2
  - Implementation AC:
    - [ ] Given a copy of a pilot skill with a known defect introduced and a stub runner that behaves per the skill's content, when the harness runs against a reliable committed baseline, then the regression check fails
    - [ ] Given the same copy with the defect removed, when it runs, then the check passes

- [ ] **TRD-022-TEST** Mutation proof [verifies TRD-022] [satisfies REQ-018] [depends: TRD-022] (2h)
  - Validates PRD ACs: AC-018-2
  - Test AC:
    - [ ] Scenario: introduced defect makes the check fail -- Given a pilot skill copy with a deliberately broken instruction and a content-sensitive stub, When the regression check runs, Then it fails, and with the defect removed it passes

- [ ] **TRD-023** Credential guard for CI and eval review rule (`.github/workflows/evals.yml`, `.github/CODEOWNERS`) [satisfies REQ-009] [depends: TRD-005] [depends: TRD-021] (2h)
  - Validates PRD ACs: AC-009-4
  - Implementation AC:
    - [ ] Given an eval or fixture change from a contributor, when it is proposed, then `.github/CODEOWNERS` names an explicit `/evals/` owner entry beside the other sensitive paths (the `*` default already covers it) so it is reviewed like code before it runs with any credential
    - [ ] Given a workflow run, when its ref is not a branch of this repository, then the job does not receive secrets (dispatch is restricted to the repository's own refs and the workflow refuses a fork ref)

- [ ] **TRD-023-TEST** Credential guard [verifies TRD-023] [satisfies REQ-009] [depends: TRD-023] (2h)
  - Validates PRD ACs: AC-009-4
  - Test AC:
    - [ ] Scenario: evals reviewed and secrets withheld from untrusted refs -- Given CODEOWNERS and the workflow file, When parsed, Then `/evals/` has an explicit owner entry and the secrets step is guarded by a same-repository ref condition

### PR 8: Pilot evals and baselines

**Shippable State:** The four pilot skills have evals, and their with-skill versus baseline results and reliability, measured in Claude Code and Pi within the cost cap and time target, are committed as baselines with a per-skill report.

- [ ] **TRD-024** Pilot eval: `ensemble-create-prd` (`evals/skills/ensemble-create-prd/`) [satisfies REQ-019] [depends: TRD-009] [depends: TRD-002] [depends: TRD-004] (5h)
  - Validates PRD ACs: AC-019-1
  - Implementation AC:
    - [ ] Given a seeded product description and `--foreman`-style non-interactive instructions, when the with-skill arm runs, then deterministic checks assert a PRD file exists under `docs/PRD/`, has `REQ-NNN` headings, Given/When/Then ACs, `Constitution compliance: passed` and no implementation files
    - [ ] Given the eval fixture, when the sandbox is built, then it includes a minimal `docs/standards/constitution.md`, because the Constitution Gate halts with `CONSTITUTION_CONFIG_ERROR` without one

- [ ] **TRD-024-TEST** Pilot eval `ensemble-create-prd` can fail [verifies TRD-024] [satisfies REQ-019] [depends: TRD-024] (2h)
  - Validates PRD ACs: AC-019-1
  - Test AC:
    - [ ] Scenario: eval passes on good output and fails on bad -- Given a stub producing a conforming PRD and a stub producing a PRD without ACs, When the eval's checks run, Then the first passes and the second fails, and the fixture contains a constitution file

- [ ] **TRD-025** Pilot eval: `ensemble-refine-prd` (`evals/skills/ensemble-refine-prd/`) [satisfies REQ-019] [depends: TRD-009] [depends: TRD-002] [depends: TRD-004] (4h)
  - Validates PRD ACs: AC-019-1
  - Implementation AC:
    - [ ] Given a seeded PRD with open clarification markers, when the with-skill arm runs non-interactively, then deterministic checks assert the version is bumped by a patch, the Document ID and Label are unchanged, a changelog entry exists and no requirement was removed
    - [ ] Given the eval fixture, when the sandbox is built, then it includes a minimal `docs/standards/constitution.md` where the skill reads one

- [ ] **TRD-025-TEST** Pilot eval `ensemble-refine-prd` can fail [verifies TRD-025] [satisfies REQ-019] [depends: TRD-025] (2h)
  - Validates PRD ACs: AC-019-1
  - Test AC:
    - [ ] Scenario: eval passes on good output and fails on bad -- Given a stub refining correctly and a stub that changes the Document ID, When the checks run, Then the first passes and the second fails

- [ ] **TRD-026** Pilot eval: `ensemble-create-trd` (`evals/skills/ensemble-create-trd/`, extends the existing `create-trd` scenario) [satisfies REQ-019] [depends: TRD-009] [depends: TRD-002] [depends: TRD-004] (4h)
  - Validates PRD ACs: AC-019-1
  - Implementation AC:
    - [ ] Given the seeded PRD fixture, when the with-skill arm runs non-interactively, then deterministic checks assert the TRD parses with at least one task (existing `trdParses` grader), every REQ has a task, and `main` was not committed to
    - [ ] Given the fixture, when the sandbox is built, then it includes a minimal `docs/standards/constitution.md`, and the existing `evals/scenarios/create-trd` fixture gets the same file, since without one its Constitution Gate halts

- [ ] **TRD-026-TEST** Pilot eval `ensemble-create-trd` can fail [verifies TRD-026] [satisfies REQ-019] [depends: TRD-026] (2h)
  - Validates PRD ACs: AC-019-1
  - Test AC:
    - [ ] Scenario: eval passes on good output and fails on bad -- Given a stub writing a parseable TRD and a stub writing none, When the checks run, Then the first passes and the second fails, and both the new and the existing create-trd fixtures contain a constitution file

- [ ] **TRD-027** Pilot eval: `pr-merge-trace` (`evals/skills/pr-merge-trace/`, `fixture/bin/gh`) [satisfies REQ-019] [depends: TRD-009] [depends: TRD-002] [depends: TRD-004] (5h)
  - Validates PRD ACs: AC-019-1
  - Implementation AC:
    - [ ] Given that the skill lives in `packages/development` but the command it records (`/ensemble:pr-merge`) lives in `packages/git`, when the eval's jobs are built, then each job carries `pluginDirs` (plural): the baseline arm loads `packages/git` only (the command is available, the skill is not) and the with-skill arm loads `packages/git` plus `packages/development`; the `toolchain-cli` the skill uses comes from `packages/development`, so the baseline lacks it by design and the eval's definition states this
    - [ ] Given a fixture `bin/gh` that answers the `gh` calls the merge command makes from canned JSON, when the sandbox PATH includes it (and no real `gh` or network is used), then the merge scenario runs without GitHub
    - [ ] Given a seeded merge scenario in a local sandbox with a bare origin and the stub `gh`, when the with-skill arm runs, then deterministic checks assert a trace file with a span per step and an embedded `trace_summary` exists and the merge decision is unchanged by the trace

- [ ] **TRD-027-TEST** Pilot eval `pr-merge-trace` can fail [verifies TRD-027] [satisfies REQ-019] [depends: TRD-027] (2h)
  - Validates PRD ACs: AC-019-1
  - Test AC:
    - [ ] Scenario: eval passes on good output and fails on bad -- Given a stub writing a trace with `trace_summary` and a stub writing none, When the checks run, Then the first passes and the second fails, and the sandbox PATH resolves `gh` to the fixture stub
    - [ ] Scenario: pilot loads multiple packages -- Given a stub `claude` recording argv, When the pr-merge-trace arms run, Then the baseline argv has `--plugin-dir` for `packages/git` only and the with-skill argv has `--plugin-dir` for both `packages/git` and `packages/development`

- [ ] **TRD-028** Pilot run, baselines and timing record (`evals/baselines/`, `docs/guides/skills-eval.md`) [satisfies REQ-019] [satisfies REQ-022] [depends: TRD-013] [depends: TRD-021] [depends: TRD-024] [depends: TRD-025] [depends: TRD-026] [depends: TRD-027] (3h)
  - Validates PRD ACs: AC-019-2, AC-022-1
  - Implementation AC:
    - [ ] Given the four pilot evals, when the pilot is run for Claude Code and Pi, then the baselines are written and committed with uplift and reliability per skill, and the report contains enough to decide whether to expand
    - [ ] Given the pilot run, when it finishes, then total wall-clock time and cost are recorded in the guide, and the run finished within 60 minutes and the cost cap
    - [ ] Given the pilot exceeds 60 minutes or the cap, when recorded, then the guide states the overrun and the concurrency or cap change proposed

- [ ] **TRD-028-TEST** Pilot results record [verifies TRD-028] [satisfies REQ-019] [satisfies REQ-022] [depends: TRD-028] (2h)
  - Validates PRD ACs: AC-019-2, AC-022-1
  - Test AC:
    - [ ] Scenario: pilot report supports an expand decision -- Given the committed baselines, When the report is built, Then it shows uplift and reliability for each of the four skills in both runtimes
    - [ ] Scenario: timing recorded against the target -- Given the guide's pilot record, When read, Then it states wall-clock time and cost, each compared to 60 minutes and the cap

## Quality Requirements

- **Security:** no secrets in code, results or logs (Constitution rule 1; TRD-005, TRD-023). Input validation of eval definitions at load (rule 2; TRD-001). Allowlisted environment only. Residual risk: a local run keeps the maintainer's `HOME` (passed through the allowlist, TRD-005), so an agent with a shell can read user-level files; this is documented in the guide and accepted for local runs, while hosted CI runs use a fresh temporary `HOME` and secrets by name only.
- **Performance:** concurrency default 4 with budget reserved per in-flight run; the pilot target is under 60 minutes (TRD-028).
- **Testing:** Jest in `evals/tests/` using stub `claude` and `pi` binaries, so no test calls a model (the existing pattern). Tests assert the order the code under test owns and never pin the order of writes from a spawned process (rule 9). Every gate that can fail has a test that breaks what it guards (rule 7: TRD-022, and the `can fail` tests in TRD-024 to TRD-027).
- **Reachability:** every new capability is reached through `node evals/run.js`, `evals/coverage.js` or `evals/compare.js`, and the workflow calls the same entry points (rule 6; TRD-021).
- **Editable behavior:** eval prompts, checks, rubrics and exemptions are files a maintainer edits without a rebuild (rule 8). Code holds only enforcement: environment allowlist, budget, redaction, and the verdict computation.
- **Dependencies:** none added. Node built-ins and the existing Jest only (constitution, Approval Requirements).
- **Documentation:** `docs/guides/skills-eval.md` and `evals/README.md` updated.

## Acceptance Criteria Traceability

| REQ-NNN | Description | Implementation Tasks | Test Tasks |
|---|---|---|---|
| REQ-001 | Evals are editable files | TRD-001 | TRD-001-TEST |
| REQ-002 | Eval declares task, workspace, skill, checks | TRD-001 | TRD-001-TEST |
| REQ-003 | Deterministic checks decide the verdict | TRD-002 | TRD-002-TEST |
| REQ-004 | Judged checks explicit and bounded | TRD-002, TRD-003 | TRD-002-TEST, TRD-003-TEST |
| REQ-005 | Scaffold from a template | TRD-004 | TRD-004-TEST |
| REQ-006 | With-skill and baseline arms | TRD-009 | TRD-009-TEST |
| REQ-007 | Repeats and reliability | TRD-010 | TRD-010-TEST |
| REQ-008 | Throwaway workspace | TRD-006 | TRD-006-TEST |
| REQ-009 | Allowlisted environment | TRD-005, TRD-023 | TRD-005-TEST, TRD-023-TEST |
| REQ-010 | Cost cap and timeout | TRD-007 | TRD-007-TEST |
| REQ-011 | Reuse unchanged results | TRD-018 | TRD-018-TEST |
| REQ-012 | Skill exercised as a user gets it | TRD-008, TRD-011, TRD-012, TRD-013 | TRD-008-TEST, TRD-011-TEST, TRD-013-TEST |
| REQ-013 | Results record what they ran against | TRD-014, TRD-015 | TRD-014-TEST, TRD-015-TEST |
| REQ-014 | Per-skill reliability and uplift report | TRD-016 | TRD-016-TEST |
| REQ-015 | Coverage report | TRD-017 | TRD-017-TEST |
| REQ-016 | Like-for-like comparison | TRD-019 | TRD-019-TEST |
| REQ-017 | Same evals local and CI | TRD-021 | TRD-021-TEST |
| REQ-018 | Regression fails, and can fail | TRD-019, TRD-021, TRD-022 | TRD-019-TEST, TRD-021-TEST, TRD-022-TEST |
| REQ-019 | Pilot covers named skills | TRD-024, TRD-025, TRD-026, TRD-027, TRD-028 | TRD-024-TEST, TRD-025-TEST, TRD-026-TEST, TRD-027-TEST, TRD-028-TEST |
| REQ-020 | No credentials in stored output | TRD-005 | TRD-005-TEST |
| REQ-021 | Failing run can be replayed | TRD-020 | TRD-020-TEST |
| REQ-022 | Pilot finishes in a time a maintainer will wait for | TRD-028 | TRD-028-TEST |

## Risk Register

| Risk | Where | Mitigation |
|---|---|---|
| Claude startup events may not list loaded skills | TRD-008 | Probe first; fall back to a transcript scan of skill-invocation events |
| Pi headless may not report cost or loaded skills | TRD-012, TRD-013 | Spike first; documented per-run cost ceiling counted against the cap; leak check falls back to transcript scan |
| Baseline leak through user-level or synced plugins | TRD-008, TRD-009 | `--setting-sources project` on both arms; loaded-skills check aborts the eval |
| Local runs share the maintainer's `HOME` | TRD-005 | `HOME` passes through locally (documented residual risk); hosted CI uses a fresh temp `HOME` |
| Claude uplift is package-level, not single-skill (the with-skill arm loads a whole package) | TRD-008, TRD-016 | Stated design decision; reports label Claude uplift "package-level (skills share a package)" and Pi "skill-level"; do not compare them as like quantities |
| Judge-call cost escapes the cap | TRD-003, TRD-007 | Judge cost is added to `costUsd` and included in the reservation |
| Budget overshoot under concurrency | TRD-007, TRD-010 | Reserve budget per in-flight run; no new run starts past the cap |
| 80 pilot runs may not fit $50 or 60 minutes | TRD-028 | Concurrency; record overrun and propose change |
| Reliability defaults untuned, 5-run samples are noisy | TRD-010 | Reported, advisory check; revisit with pilot numbers |

## Open Questions

- The PRD's two open items stay open: whether the $50 cap covers both runtimes together (the pilot is up to 80 runs: 4 skills x 2 arms x 5 repeats x 2 runtimes, about $0.63 per run on average), and whether a fifth pilot skill is wanted. TRD-028 records the real cost; the owner decides afterward.

## Adversarial Review and Design Gate

Issues found in the first draft and how each was resolved:

1. **Baseline leak through installed plugins (gap).** A maintainer's user-level or synced plugins, including the installed `ensemble-full`, could load the skill into the baseline arm. Resolved: both arms pass `--setting-sources project`, the baseline arm checks the runtime's reported loaded skills, and a leak aborts the eval (TRD-008, TRD-009).
2. **Budget overshoot under concurrency (contradiction with REQ-010).** Concurrent runs each see the same remaining budget. Resolved: budget is reserved per in-flight run and no run starts past the cap (TRD-007, TRD-010).
3. **Scrubbed environment versus local OAuth sessions (ambiguity).** A strict allowlist breaks local runs that authenticate through the CLI's own session. Resolved: the allowlist passes only named values; local runs keep the maintainer's `HOME` (explicitly passed by the allowlist) and this residual risk is documented, while hosted CI uses a fresh temporary `HOME` and secrets by name (TRD-005, Risk Register).
4. **Pi cost reporting unknown (feasibility).** The cap cannot be enforced on a runtime that reports no cost. Resolved: spike TRD-012 first, with a documented per-run ceiling counted against the cap as the fallback (TRD-012, TRD-013).
5. **Judge model unset (gap).** A judged check with no configured judge would silently skip. Resolved: it is refused and reported, never skipped (TRD-003).
6. **Untestable scenario (testability).** The "advisory, not required" scenario depended on repository settings outside the code. Resolved: it now checks the guide's stated rule (TRD-021-TEST).

Dependency and estimate review: the longest chain (TRD-001, -008, -009, -010, -014, -015, -019, -021, -022, -028) is deeper than 3. It is inherent to the build order and is mitigated by eight independently shippable PRs. The two least certain estimates are TRD-013 (Pi adapter, depends on the spike) and TRD-028 (pilot timing). No task is 8 hours or more.

Testability: every Implementation AC states a pass or fail condition, and every `Test AC:` has one `Scenario:` per AC in its Validates line (27 test tasks, 62 ACs, verified by script).

## Design Readiness Scorecard

| Dimension | Score | Note |
|---|---|---|
| Architecture completeness | 4.5 | Components, data flow, runner interface, data shapes, exit codes and error paths defined; arm phrasing and fixtures settled; Pi details wait on TRD-012 |
| Task coverage | 5 | All 22 requirements and all 62 ACs map to an implementation and a test task |
| Dependency clarity | 4 | Acyclic; the longest chain is deeper than 3, mitigated by PR boundaries |
| Estimate confidence | 3.5 | Pi adapter and pilot timing are uncertain |
| **Overall** | **4.3 (PASS)** | Previous score 4.1; improved |

## Constitution Gate

Constitution compliance: passed (`docs/standards/constitution.md`, Non-Negotiable Rules 1-9).

## Changelog

- **1.0.0 (2026-11-12):** Initial TRD from PRD-2026-24fac9e9 v1.0.1.
- **1.0.1 (2026-11-12):** Refinement pass, 7 findings applied. Pilot fixtures now carry a constitution file, including the existing `create-trd` scenario fixture (TRD-024 to TRD-026). Both arms use the same plain-language task, with an optional explicit-invocation mode on the with-skill arm only (TRD-001, TRD-009). Added a Claude startup-event probe with a transcript-scan fallback for the leak check (TRD-008). The guide is created in TRD-008, extended in TRD-012 and TRD-021, and `evals/README.md` is updated in TRD-021. The pr-merge-trace eval uses a stub `gh` (TRD-027). TRD-023 adds an explicit `/evals/` CODEOWNERS entry. TRD-022 no longer depends on TRD-021. Hours 174 to 177. Design Readiness 4.1 to 4.3.
- **1.0.2 (2026-11-13):** Review fixes. Added concurrency-reservation and child-process-kill scenarios (TRD-007-TEST). Added `--setting-sources project` on both arms, transcript-scan and unchanged-scenario scenarios (TRD-008-TEST). Jobs carry `pluginDirs` (plural); pr-merge-trace loads `packages/git` for the baseline and `packages/git` plus `packages/development` for the with-skill arm (TRD-027). Stated that Claude uplift is package-level and Pi's is skill-level, with report labels and a Risk Register row (TRD-016); arm wording is now "differ only in the plugin/skill set loaded" (TRD-009-TEST). `HOME` passes through locally and is a fresh temp dir in hosted CI (TRD-005). Exit code `1` outranks `4`. Judge cost counts in `costUsd` and the cap reservation; TRD-003 uses a standalone judge module, so no dependency on TRD-008 is added.
