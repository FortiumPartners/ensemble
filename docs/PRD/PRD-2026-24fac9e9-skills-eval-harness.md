---
document_id: PRD-2026-24fac9e9
label: prd-skills-eval
version: 1.0.1
status: Locked
date: 2026-11-12
scale_depth: STANDARD
total_requirements: 22
readiness_score: 4.1
---

# PRD-2026-24fac9e9: Skills Evaluation Harness

## PRD Health Summary

- **Risk flags:** REQ-007, REQ-010, REQ-012, REQ-018
- **Dependencies:** 24 cross-requirement dependencies (see Dependency Map)
- **Constitution compliance:** passed (`docs/standards/constitution.md`, Non-Negotiable Rules 1-9)

## Product Summary

**Problem:** Ensemble ships about 80 skills. The only evidence that a skill helps, or that it behaves the same way twice, is manual spot-checking by maintainers. That is not repeatable and cannot catch a regression when a skill, an eval or the underlying model changes.

**Who feels it:** Ensemble maintainers, who need to know whether a skill is worth keeping and whether a change made it worse, and skill contributors, who need a way to show a new skill works.

**Solution:** An evaluation harness for the skills Ensemble ships. For each skill, maintainers define evals: a task, a starting workspace and checks. The harness runs each eval repeatedly, once with the skill available and once without it, in an isolated workspace under a capped budget. It reports per-skill reliability and uplift over the no-skill baseline, reports which skills have no eval, and fails a CI check when a like-for-like score regresses.

**Value proposition:** Evidence replaces opinion. A skill's value and reliability become measured numbers that can be compared over time.

**Target users:** Ensemble maintainers and skill contributors.

**Source:** The maintainer's request for a skills test framework that verifies skills add value and work reliably. Two existing open-source skill/agent evaluation tools were named as models for the design. This PRD treats them as references. Choosing or adopting any of them is a decision for the TRD and requires explicit approval, because the project constitution requires approval for new dependencies.

**Decisions already made by the maintainer:**

- The first version is a **pilot on about five skills**, then expanded.
- The harness should most resemble the skill-focused style of evaluation (evals that target a skill), differing by running with the real shipped skill loaded.
- Verdicts come from **deterministic checks first**; model-judged checks are a supplement.
- Uplift is **reported only** in the pilot. No pass/fail uplift threshold is set until real numbers exist.
- Reliability defaults to **5 runs per eval, with 4 of 5 required to pass**.
- Coverage lists **every skill with an explicit status**: evaluated, exempt (with a reason) or missing.
- When the cost cap is hit, finished evals keep their results and unfinished ones are reported **incomplete**, never as pass or fail.
- Every result records **model, skill version and eval version**; comparisons count only like-for-like runs.
- Safeguards required: a throwaway workspace per run, a hard budget and timeout, a scrubbed environment and cached results.
- It must run locally and in the hosted CI, within a capped cost per run.
- Hosted CI runs are **on demand only**; there are no automatic per-change or scheduled runs in this release.
- The first release evaluates skills in **Claude Code and Pi**.
- The pilot covers **four named skills**: `ensemble-create-prd`, `ensemble-refine-prd`, `ensemble-create-trd` and `pr-merge-trace` (the skill behind the PR merge command; there is no skill called `ensemble-merge-pr`). [NEEDS CLARIFICATION: is a fifth pilot skill wanted, or is the pilot these four?]
- Default limits: **$50 per suite run** and **15 minutes per single run**.
- Stored results are a **committed per-skill baseline** in the repository; full run logs are CI artifacts.
- A judged check uses a **different model** from the model under test.
- The repository owner alone approves; no second reviewer is required.

## User Analysis

**Roles:**

- **Maintainer:** decides which skills are kept, runs evals before merging skill changes and sets the thresholds.
- **Skill contributor:** adds or changes a skill and needs to add or update its eval.
- **CI gate (automated):** runs evals on a change and blocks it on a regression.

**Pain points:** no repeatable evidence a skill helps; no way to tell if a skill is reliable; no regression signal when a skill or the model changes; unknown which skills have no check at all.

**Success metrics:**

- Every pilot skill shows a measured with-skill versus baseline comparison over repeated runs.
- Every shipped skill has a recorded coverage status.
- A deliberate regression in a pilot skill fails the CI check.
- A full pilot run stays inside the configured cost cap.

## Goals and Non-Goals

**Goals:**

- Show, per skill, whether it adds value over no skill and whether it works reliably.
- Make evals editable by maintainers and contributors without a rebuild or a release.
- Catch regressions in an on-demand CI run.

**Non-Goals (Won't, this release):**

- Automatic runs on every change or on a schedule; hosted CI runs are on demand only.
- A required pull-request check; the regression check is advisory.
- Evaluating in runtimes other than Claude Code and Pi.

- Scheduling or recurring orchestration of eval runs (Constitution rule 4: Foreman owns durable scheduling).
- Evaluating every shipped skill in the pilot.
- A pass/fail uplift threshold.
- A hosted dashboard or service.
- Automatically rewriting or fixing a skill that scores poorly.

## Approvals and Decision Ownership

- **Approver:** The Ensemble repository owner (maintainer).
- **Acceptance criteria the approver judges against:** the pilot shows a measured with-skill versus baseline result for the named pilot skills, in Claude Code and Pi; each pilot eval has a reliability result over repeated runs; a full pilot run stays within the cost cap; and a deliberate regression is caught by the CI check.
- **Dependency approval:** adopting any external evaluation tool or library is a new dependency and needs explicit approval before implementation (constitution, Approval Requirements). No second reviewer is required.

## Entry and Exit Criteria

**Entry:**

- The evaluation approach is decided: a spike confirms that a skill-focused approach can run unattended, support a no-skill baseline arm, and be used under the project's licensing. The repository owner runs the spike. If neither named tool fits, the fallback is a minimal purpose-built runner in the repository, which is itself subject to the dependency-approval rule.
- The pilot skills are chosen (see Decisions) and each has a behaviour that can be checked; the exact checked behaviour for each is a TRD detail.

**Exit:**

- Each pilot skill has an eval with a with-skill and baseline result over repeated runs, within the cost cap.
- The CI check runs on a change and fails on a deliberately introduced regression.
- Every shipped skill has a coverage status.
- Tests cover every acceptance criterion, and the gating checks are shown capable of failing by breaking what they guard (Constitution rule 7).
- `npm run validate` and `npm run generate:validate` pass.

## Requirements

### Eval Authoring

### REQ-001: Evals are editable files, not compiled code (Must)

A maintainer or contributor can add or change an eval without a toolchain build or a release (Constitution rule 8).

- AC-001-1: Given a maintainer edits an eval's task or checks, when they run the harness, then the change takes effect with no build step.
- AC-001-2: Given a contributor adds an eval for a skill, when they run the harness, then the eval is discovered and run without registering it anywhere else.

### REQ-002: An eval declares its task, workspace, skill and checks (Must)

- AC-002-1: Given an eval definition, when it is loaded, then it states the task given to the agent, the starting workspace, the skill under test and its checks.
- AC-002-2: Given an eval definition missing any of those, when it is loaded, then the harness rejects it with a message naming the eval and the missing part, and runs nothing for it.
- AC-002-3: Given an eval that names a skill that does not exist, when it is loaded, then it is rejected with a message naming the skill.

### REQ-003: Deterministic checks decide the verdict (Must)

Checks on files, command results and output text decide pass or fail. Model-judged checks never decide a verdict alone.

- AC-003-1: Given an eval with deterministic checks, when a run finishes, then its verdict is computed from those checks only.
- AC-003-2: Given an eval whose only checks are model-judged, when it is loaded, then it is rejected with a message saying a deterministic check is required.

### REQ-004: Judged checks are explicit and bounded (Should)

- AC-004-1: Given an eval uses a judged check, when it is loaded, then it carries a written rubric, and results mark the check as judged.
- AC-004-2: Given a judged check, when the run is reported, then the verdict from deterministic checks and the judged score are shown separately.
- AC-004-3: Given a judged check, when it runs, then the judging model differs from the model under test, and the judging model is recorded in the result.
- AC-004-4: Given a configuration in which the judging model is the model under test, when the harness starts, then it refuses to run the judged check and names the conflict.

### REQ-005: A contributor can start a new eval from a template (Should)

- AC-005-1: Given a contributor wants an eval for a new skill, when they use the provided template, then they get a runnable skeleton that passes loading checks once its fields are filled in.

### Execution

### REQ-006: Every eval runs with the skill and without it (Must)

The with-skill arm and the baseline arm are identical except for whether the skill is available.

- AC-006-1: Given an eval, when it runs, then both a with-skill arm and a baseline arm run against identical workspaces and the same task.
- AC-006-2: Given the baseline arm, when it runs, then the skill under test is not available to the agent.
- AC-006-3: Given a baseline arm where the skill under test is still reachable by any means, when the run starts, then the harness aborts that eval with a message naming the leak.
- AC-006-4: Given a skill whose subject the agent may already know well, when its baseline arm runs, then the baseline is the same agent with the skill unavailable, and a near-zero uplift is reported as a valid result, not an error.

### REQ-007: Each arm repeats, and reliability is defined (Must) [RISK: flaky or costly runs distort the result]

Each arm runs a configured number of times, 5 by default, and an eval is reliable when at least 4 of 5 runs pass.

- AC-007-1: Given an eval with default settings, when it runs, then each arm executes 5 times.
- AC-007-2: Given an arm where 4 of 5 runs pass, when results are computed, then the eval counts as reliable; where 3 of 5 pass, it counts as not reliable.
- AC-007-3: Given a maintainer sets a different count or bar on one eval, when it runs, then that eval uses those values and the report states them. The 5-run and 4-of-5 defaults are confirmed for the pilot and are to be revisited with the pilot numbers.

### REQ-008: Each run uses a throwaway workspace (Must)

- AC-008-1: Given a run, when it starts, then it works in a fresh isolated copy of the starting workspace outside the real repository.
- AC-008-2: Given a run that modifies or deletes files, when it finishes, then the real repository is byte-for-byte unchanged and the workspace is removed or retained only if the maintainer asked to keep it.

### REQ-009: Runs see only an allowed set of environment values (Must)

- AC-009-1: Given a run, when the agent starts, then only environment values on an allowlist are visible to it.
- AC-009-2: Given a credential present in the maintainer's environment but not on the allowlist, when a run executes, then the agent cannot read it.
- AC-009-3: Given a credential a run legitimately needs, when the run starts, then it reaches the agent only by being named on the allowlist, from the local environment on a maintainer's machine and from CI secrets in hosted CI.
- AC-009-4: Given an eval change from a contributor, when it is proposed, then it is reviewed like code before it runs with any credential, and a hosted CI run triggered from an untrusted source receives no secrets.

### REQ-010: A hard cost cap and timeout bound every run (Must) [RISK: the cap may be too low to finish the pilot]

- AC-010-1: Given a configured cost cap, when a suite's spend would exceed it, then the harness stops starting new runs, finished evals keep their results and unfinished evals are reported incomplete.
- AC-010-2: Given incomplete evals, when the suite ends, then they are never counted as pass or fail and the run exits with a non-zero status.
- AC-010-3: Given a single run that exceeds its timeout, when the limit is reached, then that run is stopped and recorded as timed out, not as a pass.
- AC-010-4: Given no override, when a suite runs, then the cost cap is $50 per suite run and the timeout is 15 minutes per single run.

### REQ-011: Unchanged results are reused (Should)

- AC-011-1: Given a skill, an eval and a model that have not changed since a stored result, when the suite runs, then the stored result is reused and no new model spend occurs.
- AC-011-2: Given any of the three has changed, when the suite runs, then the affected eval runs again.
- AC-011-3: Given a stored result whose skill, eval and model are unchanged, when the suite runs at any later date, then the result is reused with no age limit, and a maintainer can force a fresh run.

### REQ-012: The skill is exercised the way a user gets it (Must) [RISK: the evaluated skill may differ from the shipped one]

The with-skill arm uses the skill as shipped and as a user would invoke it, so a pass means the real entry point works (Constitution rule 6).

- AC-012-1: Given a skill shipped in the Ensemble bundle, when its with-skill arm runs, then the agent receives that skill as installed, not a private copy.
- AC-012-2: Given an eval that expects the skill to be chosen for a described situation, when the arm runs, then the result records whether the skill was actually invoked.
- AC-012-3: Given a skill whose files were edited after the last installed copy, when the harness runs, then it reports which copy was evaluated.
- AC-012-4: Given the first release, when the pilot runs, then each pilot skill is evaluated in both Claude Code and Pi, and each result records the runtime.
- AC-012-5: Given a runtime other than Claude Code or Pi, when it is requested, then the harness reports it is not supported in this release. [NEEDS CLARIFICATION: does the $50 cost cap cover both runtimes together, and does it need to be raised now that every pilot eval runs twice?]

### Results and Reporting

### REQ-013: Every result records what it was run against (Must)

- AC-013-1: Given a completed run, when its result is stored, then it records the model identifier, the skill version, the eval version, the arm, each run's outcome and the cost.
- AC-013-2: Given a stored result, when it is read later, then nothing in it is missing that a comparison would need.
- AC-013-3: Given a finished suite, when results are stored, then a small per-skill baseline summary is written for committing to the repository and the full run logs are kept as CI artifacts.
- AC-013-4: Given a baseline summary in the repository, when a regression check runs locally or in CI, then it compares against that committed summary.

### REQ-014: A per-skill report shows reliability and uplift (Must)

- AC-014-1: Given a finished suite, when the report is produced, then each evaluated skill shows its with-skill pass rate, baseline pass rate, the difference between them and its reliability verdict.
- AC-014-2: Given the pilot, when the report is produced, then uplift is reported as a number with no pass or fail applied to it. Setting a threshold is deferred until the pilot numbers exist.
- AC-014-3: Given a skill with incomplete evals, when the report is produced, then it is marked incomplete rather than given a score.

### REQ-015: A coverage report gives every skill a status (Must)

Each shipped skill is listed as evaluated, exempt (with a stated reason) or missing. Only missing counts against coverage.

- AC-015-1: Given the shipped skills, when the coverage report is produced, then every skill appears exactly once with one of the three statuses.
- AC-015-2: Given a skill marked exempt, when the report is produced, then its reason is shown, and an exempt skill with no reason is reported as missing.
- AC-015-3: Given a newly added skill with no eval and no exemption, when the report is produced, then it is listed as missing.

### REQ-016: Current results are compared with stored ones like-for-like (Should)

- AC-016-1: Given a stored result with the same model, skill version and eval version, when a new result is produced, then the report shows the change in score.
- AC-016-2: Given no stored result with matching model and eval version, when a new result is produced, then no regression is claimed and the report says there is nothing comparable.

### CI and Rollout

### REQ-017: The same evals run locally and in hosted CI (Must)

- AC-017-1: Given a maintainer's machine, when they run the harness with a command, then they get the same reports as the hosted CI would.
- AC-017-2: Given the hosted CI, when a maintainer triggers a run on demand, then the harness runs the selected skills, or the full suite if none are selected.
- AC-017-3: Given a change that touches a skill or an eval, when no maintainer has triggered a run, then the hosted CI does not run the evals automatically.

### REQ-018: A regression fails the CI check, and the check can fail (Must) [RISK: a gate that cannot fail gives false confidence]

- AC-018-1: Given a stored like-for-like result in which an eval met the reliability bar, when a new result for it falls below the bar, then the check fails and names the skill and eval.
- AC-018-4: Given the regression check, when it fails, then it is advisory and does not block merging; it is not a required pull-request check.
- AC-018-2: Given a skill in which a known defect has been deliberately introduced, when the harness runs, then the check fails; this proves the gate can fail (Constitution rule 7).
- AC-018-3: Given incomplete or not-comparable results, when the check runs, then it does not pass silently.
### REQ-019: The pilot covers the named skills (Must)

- AC-019-1: Given the pilot, when it completes, then each of `ensemble-create-prd`, `ensemble-refine-prd`, `ensemble-create-trd` and `pr-merge-trace` has a runnable eval with a with-skill versus baseline result and a reliability result.
- AC-019-2: Given the pilot results, when they are presented, then they include enough to decide whether to expand to the remaining skills.

### Non-Functional

### REQ-020: Stored results and logs never contain credentials (Must)

- AC-020-1: Given a run in which the agent prints an allowed secret value, when results and logs are stored, then the value is not present in them.
- AC-020-2: Given a stored result, when it is inspected, then it contains no environment values beyond the allowlisted, non-secret ones.

### REQ-021: A failing run can be replayed (Should)

- AC-021-1: Given a failing run, when the report is produced, then it includes what is needed to rerun that run with the same inputs and settings.

### REQ-022: A pilot run finishes in a time a maintainer will wait for (Could)

- AC-022-1: Given the pilot suite, when it runs, then it finishes within 60 minutes of wall-clock time, locally and in hosted CI.

## Dependency Map

- REQ-002 depends on REQ-001
- REQ-003 depends on REQ-002
- REQ-004 depends on REQ-003
- REQ-005 depends on REQ-002
- REQ-006 depends on REQ-002
- REQ-007 depends on REQ-006
- REQ-008 depends on REQ-006
- REQ-009 depends on REQ-008
- REQ-010 depends on REQ-007
- REQ-011 depends on REQ-013
- REQ-012 depends on REQ-006
- REQ-013 depends on REQ-007
- REQ-014 depends on REQ-013
- REQ-015 depends on REQ-002
- REQ-016 depends on REQ-013
- REQ-017 depends on REQ-014
- REQ-018 depends on REQ-016
- REQ-018 depends on REQ-017
- REQ-019 depends on REQ-012
- REQ-019 depends on REQ-014
- REQ-020 depends on REQ-009
- REQ-020 depends on REQ-013
- REQ-021 depends on REQ-013
- REQ-022 depends on REQ-019

**Clusters to implement together:**

- Authoring: REQ-001 to REQ-005.
- Safe execution: REQ-006 to REQ-010, REQ-020.
- Results and gate: REQ-013 to REQ-018.

No circular dependencies were found.

## Readiness Scorecard

| Dimension | Score | Note |
|---|---|---|
| Completeness | 4 | Authoring, execution, reporting and CI gate are all covered |
| Testability | 4 | Every Must requirement has at least two ACs |
| Clarity | 4.5 | One open item remains: whether the cost cap fits two runtimes, and whether a fifth skill is wanted |
| Feasibility | 4 | Fits the stated cost and runtime constraints |
| **Overall** | **4.1 (PASS)** | Previous score 3.9 (CONCERNS); improved |

## Notes

- Unresolved clarification markers: 2 (REQ-012 cost cap across two runtimes; Decisions: whether a fifth pilot skill is wanted).

## Changelog

- **1.0.1 (2026-11-12):** Refinement pass. Resolved 13 of 15 clarification markers; two of those were confirmed or deferred from earlier choices (REQ-007 defaults, REQ-014 threshold). Added Pi as a second runtime (REQ-012); set on-demand CI, an advisory regression check and the regression rule (REQ-017, REQ-018); set the default cost cap and timeout (REQ-010); fixed where results live (REQ-013); required a judging model that differs from the model under test (REQ-004); defined the no-skill baseline for knowledge skills (REQ-006); defined credential handling (REQ-009); removed the cache age limit (REQ-011); named four pilot skills (REQ-019); set a 60-minute pilot time (REQ-022). Added 2 new markers from the changes. Readiness 3.9 to 4.1.
- **1.0.0 (2026-11-12):** Initial draft from `create-prd`.
