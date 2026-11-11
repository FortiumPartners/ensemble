# Ensemble 8.1.0 User Guide

Ensemble is a marketplace of plugins that add commands, skills and agents to AI coding runtimes (Claude Code, Pi/Oh My Pi, Codex, OpenCode). Its core workflow takes a product idea through a PRD, a TRD, a Beads task hierarchy and a merged pull request, with a gate at every hand-off.

This guide is task oriented. Sections 1 to 3 get you installed and through one full cycle. Section 4 is a set of recipes. Sections 5 to 7 are reference tables. Sections 8 to 10 cover configuration, troubleshooting and upgrading from 6.x. Section 11 is the code review process: the policy you edit, the gates that are enforced for you, and the honest limits of both.

## Table of contents

1. [Concepts](#1-concepts)
2. [Installation and verification](#2-installation-and-verification)
3. [Quick start: idea to merged PR](#3-quick-start-idea-to-merged-pr)
4. [Recipes](#4-recipes)
5. [Command reference](#5-command-reference)
6. [Skills reference](#6-skills-reference)
7. [Agents reference](#7-agents-reference)
8. [Configuration and environment](#8-configuration-and-environment)
9. [Troubleshooting](#9-troubleshooting)
10. [Upgrading from 6.x](#10-upgrading-from-6x)
11. [Code review process](#11-code-review-process)

## 1. Concepts

### Plugins and packages

The repository is an npm monorepo under `packages/`. Each package is both an npm package (`@sunstone-partners/ensemble-<name>`) and a Claude Code marketplace plugin (`ensemble-<name>`, listed in `marketplace.json`). Plugins are grouped by purpose:

| Plugin | Version | Contents |
| --- | --- | --- |
| `ensemble-core` | 6.1.1 | `detect-stack` skill, `/ensemble:standards`, `/ensemble:fold-prompt`, `/ensemble:sessionlog`, `/ensemble:reinstall-plugins`, `ensemble-orchestrator` agent |
| `ensemble-product` | 7.0.1 | PRD commands (`create-prd`, `refine-prd`, `prd`), `reqnroll` dispatcher |
| `ensemble-development` | 7.0.2 | TRD, beads, feature and issue workflows, language skills, orchestrator agents |
| `ensemble-quality` | 6.0.2 | `pr-review-remediation` and `flake-reproduction` skills, `code-reviewer`, `deep-debugger`, `test-runner` agents |
| `ensemble-infrastructure` | 6.1.1 | Cloud and vendor skills (`aws`, `kubernetes`, `jira`, ...), infrastructure agents |
| `ensemble-git` | 6.1.1 | `/ensemble:pr-merge`, `/ensemble:release`, git skills, `git-workflow` agent |
| `ensemble-e2e-testing` | 6.1.1 | `/ensemble:author-playwright-tests`, `smoke-test-runner`, `writing-playwright-tests`, `playwright-tester` agent |
| `ensemble-assessment` | 2.0.0 | `/ensemble:assess` and 22 assessment skills |
| `ensemble-ai` | 7.0.1 | `anthropic`, `openai`, `perplexity`, `weaviate`, `langgraph` skills |
| `ensemble-react`, `ensemble-nestjs`, `ensemble-rails`, `ensemble-phoenix`, `ensemble-blazor`, `ensemble-dotnet` | 7.0.1, 6.0.1, 6.0.1, 6.0.1, 7.0.1, 2.0.1 | One framework skill each (`react`, `nestjs`, `rails`, `phoenix`, `blazor`, `dotnet`) |
| `ensemble-jest`, `ensemble-pytest`, `ensemble-rspec`, `ensemble-xunit`, `ensemble-exunit`, `ensemble-reqnroll` | 5.1.3, 5.2.1, 5.2.1, 5.2.1, 5.1.2, 1.0.2 | One test-framework skill each; `ensemble-reqnroll` also ships the `reqnroll-binding-specialist` agent |
| `ensemble-full` | 8.1.0 | Bundle that depends on the plugins above |
| `ensemble-pi`, `ensemble-codex`, `ensemble-opencode` | 1.6.20, 6.0.2, 5.4.1 | Runtime adapters that translate the Ensemble sources for Pi/OMP, Codex and OpenCode |

`ensemble-permitter` and the other support packages ship hooks and plumbing rather than workflow content. Versions come from `marketplace.json`; each package is versioned independently, so `ensemble-pi` is at 1.6.20 while the bundle is at 8.1.0.

### Skills, commands and agents

| Kind | What it is | How it runs |
| --- | --- | --- |
| Skill | A `SKILL.md` that teaches the model a technology or a procedure (`jira`, `detect-stack`, `assess-security`) | Loaded by name, automatically by agents or when you ask for it |
| Command | A workflow defined in YAML under `packages/<pkg>/commands/*.yaml`, with phases, gates and expected outputs | You type `/ensemble:<name>` (Claude Code) or the runtime-specific form in section 2 |
| Agent | A role definition (`backend-developer`, `code-reviewer`, ...) that commands and orchestrators delegate to | Dispatched by commands; you rarely invoke one directly |

Since 7.0.0 skill names equal the technology name (`jira`, not `managing-jira-issues`). The 68 source skills and 35 agents are listed in sections 6 and 7.

### Dispatchers and hidden commands

A dispatcher is a thin command whose first argument is a keyword that selects a subcommand. The remaining text is passed through unchanged. With no argument, or an unknown keyword, a dispatcher prints its keyword table and stops without side effects.

| Dispatcher | Keywords |
| --- | --- |
| `/ensemble:prd` | `create`, `refine` |
| `/ensemble:trd` | `create`, `refine`, `implement`, `analyze`, `complexity`, `validate`, `verify`, `status`, `graph` |
| `/ensemble:feature` | `new`, `resume`, `status`, `abandon` |
| `/ensemble:issue` | `fix`, `list`, `resume`, `status`, `abandon` |
| `/ensemble:reqnroll` | `features`, `feature-drift`, `bindings`, `binding-drift`, `tdd` |
| `/ensemble:standards` | `discover`, `inject`, `fold` |
| `/ensemble:assess` | `repo`, `team`, `config`, `report` (and `repo --only <dimension>`) |

Eight commands are hidden (`metadata.visibility: hidden` in the YAML). A hidden command is not offered as a typable command; it is reached only through its dispatcher or, for `beads-build-wave`, through the `beads-build` loop. The full list is in section 5.2.

Hidden commands are implemented per runtime as follows:

- Claude Code: the generated command carries `user-invocable: false`, so it is absent from the slash menu while the model can still read it.
- Pi: the prompt is written to `packages/pi/prompts/_hidden/` with no command-wrapper skill. `package.json` registers `./prompts/*.md` non-recursively, so the hidden directory is not registered.
- Codex: the wrapper skill carries `user-invocable: false`.

### Runtimes

| Runtime | Adapter | How commands appear |
| --- | --- | --- |
| Claude Code | Marketplace plugins | `/ensemble:<name>` |
| Pi | `@sunstone-partners/ensemble-pi` | Prompt templates `/ensemble-<name>`, plus generated wrapper skills `ensemble-<name>` |
| Oh My Pi (OMP) | Same Pi package | Wrapper skills, for example `/skill:ensemble-create-trd <prd-path>` |
| Codex | `@sunstone-partners/ensemble-codex` | Command skills such as `/ensemble-create-prd` |
| OpenCode | `ensemble-opencode` | `/ensemble:create-prd` and the plain alias `/create-prd` |

This guide writes commands in the Claude Code form (`/ensemble:name`). Substitute the form from the table for your runtime.

## 2. Installation and verification

### Claude Code

Add the marketplace and install either the bundle or individual plugins:

```text
/plugin marketplace add Sunstone-Partners/ensemble
/plugin install ensemble-full@ensemble
```

Modular install:

```text
/plugin install ensemble-core@ensemble
/plugin install ensemble-product@ensemble
/plugin install ensemble-development@ensemble
/plugin install ensemble-quality@ensemble
/plugin install ensemble-git@ensemble
/plugin install ensemble-assessment@ensemble
```

`ensemble-infrastructure` and `ensemble-quality` declare `"dependencies": ["ensemble-core"]`, because their agents call `detect-stack`. Claude Code pulls `ensemble-core` in automatically from the same marketplace.

For local development, point Claude Code at a package directory:

```bash
git clone https://github.com/Sunstone-Partners/ensemble.git
claude --plugin-dir ./ensemble/packages/core
```

Verify:

1. Run `claude plugin list` and confirm the `ensemble-*` plugins are listed and enabled.
2. Run `/ensemble:standards` with no argument. It prints its keyword table (discover, inject, fold) and stops. If the table appears, the plugin and the dispatcher mechanism loaded.

### Pi and Oh My Pi (OMP)

```bash
pi install @sunstone-partners/ensemble-pi
pi install @sunstone-partners/ensemble-assessment
```

`ensemble-assessment` is its own Pi package: it is excluded from `ensemble-pi` and the two have no dependency on each other, so install both if you want the workflow commands and `/ensemble-assess`. Pi and Codex have no plugin dependency mechanism, so also make sure the skills `ensemble-pi` bundles from `ensemble-core` (such as `detect-stack`) are present; they ship inside the Pi package.

For a local checkout use `pi install ./packages/pi`.

Invocation:

- Pi loads prompt templates, so commands are `/ensemble-<name>` (for example `/ensemble-create-prd`).
- OMP does not read a package's `pi.prompts`; use the generated wrapper skills instead, for example `/skill:ensemble-create-trd <prd-path>` and `/skill:ensemble-assess`.

Verify: invoke `/ensemble-standards` (Pi) or `/skill:ensemble-standards` (OMP) with no argument; the keyword table should print.

### Codex

From npm, in the project that should get Ensemble:

```bash
npm install -D @sunstone-partners/ensemble-codex
npx ensemble-codex-install . --force
```

From a monorepo checkout:

```bash
npm run generate:codex
npm run install:codex -- /path/to/project
```

The installer writes `AGENTS.md`, `.codex/config.toml`, `.codex/agents/*.toml`, `.codex/skills/<package>/` and `.codex/skills/commands/ensemble-*/SKILL.md`. Invoke commands as `/ensemble-<name>`, for example `/ensemble-create-prd`.

Verify: check that `.codex/skills/commands/ensemble-standards/SKILL.md` exists in the project, then invoke `/ensemble-standards` with no argument.

### Tools the workflows expect

`implement-trd-beads`, `beads-build` and related commands drive the Beads CLIs `br` (beads_rust) and `bv` (beads_viewer); `bv` is a hard requirement with no fallback. PR-producing commands use the GitHub CLI `gh`. `git-town` is used when installed and configured, otherwise plain git (see `ENSEMBLE_BRANCHING_STRATEGY` in section 8).

## 3. Quick start: idea to merged PR

This walkthrough follows the default path. Every command stops at a gate and tells you the next command to run.

### Step 1: write the PRD

```text
/ensemble:create-prd "Self-service password reset for the customer portal"
```

The command interviews you (scale detection, clarifying questions), researches context, defines requirements with acceptance criteria, then runs an Implementation Readiness Gate and a Constitution Gate before it saves. The PRD is written to `docs/PRD/PRD-YYYY-<micro_uuid>-<slug>.md` with a readiness score. The only next step it prints is `/ensemble:refine-prd <that path>`; a fresh PRD is never sent straight to `create-trd`.

The Constitution Gate needs a constitution file: `docs/standards/constitution.md`, or `.specify/memory/constitution.md` as a fallback. With neither, the command halts with `CONSTITUTION_CONFIG_ERROR` and saves nothing. In a new project, run `/ensemble:init-project` first; it scaffolds `docs/standards/constitution.md`, `docs/PRD/` and `docs/TRD/`.

### Step 2: refine and lock the PRD

```text
/ensemble:refine-prd docs/PRD/PRD-2026-1a2b3c4d-password-reset.md
```

Refinement reviews the PRD against stakeholder feedback, re-scores readiness and bumps the patch version. It ends with a lock question (lock, refine again, or leave unlocked); locking sets `status: Locked` and prints `/ensemble:create-trd <prd path>`. Variants: `--collab` runs a browser-based review (see [refinement-review-collab](refinement-review-collab.md)) and `--foreman` is non-interactive.

### Step 3: write the TRD

```text
/ensemble:create-trd docs/PRD/PRD-2026-1a2b3c4d-password-reset.md
```

The TRD gets architecture alternatives, a Master Task List with traceability to each acceptance criterion, an adversarial review and a Design Readiness Gate, then the Constitution Gate. It is saved to `docs/TRD/TRD-YYYY-<micro_uuid>-<slug>.md` (the micro UUID is inherited from the PRD) and the next step is `/ensemble:refine-trd <trd path>`. Use `/ensemble:create-trd --list` to pick a PRD interactively.

### Step 4: refine the TRD

```text
/ensemble:refine-trd docs/TRD/TRD-2026-1a2b3c4d-password-reset.md
```

The close-out asks for a go decision, warns if the source PRD is not locked, and on GO prints `/ensemble:implement-trd-beads <trd path>`.

### Step 5: implement with Beads

```text
/ensemble:implement-trd-beads docs/TRD/TRD-2026-1a2b3c4d-password-reset.md
```

Phases, in order:

1. Preflight: tool checks, git-town and working directory checks, TRD selection, Design Readiness Gate verification (score 4.0 or higher passes, 3.0 to 4.0 asks, below 3.0 halts), resume detection, staleness gate, branch creation, traceability validation gate.
2. Scaffold: an epic, stories and tasks are created as beads, with dependencies encoded; `bv --robot-plan` provides the schedule.
3. Execute: delegates to `/ensemble:beads-build`, which runs waves of concurrent builder, code-review and close pipelines.
4. Quality Gate: tests run at phase completion and results are recorded as bead comments.
5. Completion: completion verification, PR review completion check, epic closure, TRD checkbox sync and a completion report.

Useful flags:

| Flag | Effect |
| --- | --- |
| `--plan` | Scaffold only, print wheel instructions, skip execution. Mutually exclusive with `--execute` |
| `--execute` | Skip scaffolding and run against an existing scaffold; errors if none exists |
| `--status` | Report progress without changing anything |
| `--reset-task TRD-XXX` | Reset one task |
| `--list` | List available TRDs |
| `--branch=<name>` / `--use-current-branch` | Choose the branch (mutually exclusive) |
| `max parallel N` | Cap concurrent tracks |
| `--foreman` | Force non-interactive mode; safety halts are unchanged |

### Step 6: get the PR merged

```text
/ensemble:pr-merge
```

With no argument the command targets the current branch's open PR (`[pr-number-or-url]` is optional). It reads CI and review state, dispatches one subagent per failing check or unresolved review thread, re-verifies against live state each round and merges only when every required check is green and no changes are requested. See the [pr-merge recipe](#pr-to-merged-ensemblepr-merge).

Rather than running steps 1 to 5 by hand you can use `/ensemble:feature new "<idea>"`, which chains them with checkpoints (see the [feature lifecycle recipe](#feature-lifecycle-ensemblefeature)).

## 4. Recipes

### Meeting notes to PRD

Use `--from-meeting` when a meeting happened and nobody is available to interview.

```text
/ensemble:create-prd --from-meeting docs/meetings/2026-10-14-reset-kickoff.md
/ensemble:refine-prd docs/PRD/PRD-2026-1a2b3c4d-password-reset.md
```

The argument is a normalized meeting summary, inline or a path; raw audio or a transcript is not the input. Expected behavior, from the command YAML:

- Every interview question is skipped; scale is inferred from the summary.
- The PRD does not invent anything the summary lacks. Each gap is marked `[NEEDS CLARIFICATION: ...]`.
- The Implementation Readiness Gate never blocks the save: a CONCERNS or FAIL score still saves the PRD as `Status: Draft`.
- The Constitution Gate still runs and still halts (see [section 9](#constitution-gate-halts-with-constitution_config_error)).
- The PRD carries a Source line naming the meeting and a count of open markers, and the next step is always `refine-prd`.
- `--from-meeting` cannot be combined with `--foreman`.

To fold a later meeting into an existing PRD:

```text
/ensemble:refine-prd docs/PRD/PRD-2026-1a2b3c4d-password-reset.md --from-meeting docs/meetings/2026-10-21-followup.md
```

Findings that the summary resolves are applied; the rest stay open and are reported in a Remaining Findings Report. A meeting-sourced pass never locks the PRD, so run a normal `refine-prd` afterwards to close the open items.

### Foreman-parseable TRD

Foreman's `parseTrd()` reads sprint/story markdown tables. To produce that format:

```text
/ensemble:create-trd docs/PRD/PRD-2026-1a2b3c4d-password-reset.md --parser-tables
```

Expected behavior:

- The Master Task List is parser-compatible sprint and story tables; every Status cell is `[ ]`.
- The adversarial review phases and the Design Readiness Gate are omitted.
- Nothing is asked of the user (except the optional `--list` picker); the architecture option is chosen automatically.
- The Constitution Gate still applies and is non-bypassable.
- One TRD file is written at `docs/TRD/TRD-YYYY-<micro_uuid>-<slug>.md`, with no companion research or data-model files, and the only next step printed is `foreman sling prd <original-prd-path>`.

`--parser-tables` is not `--foreman`. `--foreman` keeps the standard checkbox TRD and review phases and only removes prompts and adds Foreman's artifact contract. The flags combine: `--foreman --parser-tables`.

### Multi-TRD workstream

When several TRDs should be built as one body of work, merge them into a single normalized workstream TRD:

```text
/ensemble:implement-trd-beads docs/TRD/TRD-2026-aaaa1111-auth.md docs/TRD/TRD-2026-bbbb2222-billing.md --workstream --generate-only
```

Expected behavior:

- It generates `docs/TRD/workstreams/TRD-YYYY-<micro_uuid>-workstream-<slug>.md` containing a Source TRD Manifest, a normalized Master Task List, source provenance, the source task markdown verbatim, and AC-level implementation, test and validation tasks.
- It prints the path, workstream slug, source TRD count and the next step `/ensemble:implement-trd-beads <generated-path>`, then exits. No beads, branches, commits or PRs are created.
- Source TRDs stay canonical.

Then implement the generated file:

```text
/ensemble:implement-trd-beads docs/TRD/workstreams/TRD-2026-aaaa1111-workstream-auth-billing.md
```

Or generate and implement in one step by omitting `--generate-only`:

```text
/ensemble:implement-trd-beads docs/TRD/TRD-2026-aaaa1111-auth.md docs/TRD/TRD-2026-bbbb2222-billing.md --workstream
```

Options that apply with `--generate-only`:

| Option | Effect |
| --- | --- |
| `--out <path>` | Write the workstream TRD to this path instead of the default under `docs/TRD/workstreams/` |
| `--allow-invalid` | Write the file even if source-TRD validation fails. Without it every validation error is printed and no file is written |

`--allow-invalid` only takes effect together with `--generate-only`: the preflight passes it to `create-workstream-trd` only when `--generate-only` is present. Plain `--workstream` (generate and implement) always requires valid source TRDs and does not accept `--allow-invalid`. `--generate-only` cannot be combined with `--plan`, `--execute`, `--status`, `--reset-task`, `--list`, `--branch` or `--use-current-branch`.

Passing two or more TRD paths without `--workstream` halts with a pointer to this recipe. `--legacy-multi` still exists but is deprecated.

To find overlapping work across TRDs before merging them, run `/ensemble:trd-dependency-graph docs/TRD --overlap`. Check status of a combined run with `--status`; `--workstream <slug>` selects one workstream's report in the deprecated `--legacy-multi` combined mode.

### Bug fix

```text
/ensemble:issue fix "Login button does nothing on Safari"
/ensemble:fix-issue --issue 34
```

`/ensemble:issue fix <text>` forwards its text to `/ensemble:fix-issue`, so both forms are equivalent. `/ensemble:fix-issue` runs four phases: Entry Point Resolution, Analysis and Planning (codebase analysis plus a virtual product-manager, tech-lead, architect and QA team), Execution, and Validation and Delivery. Expected outcome: a branch named `fix/issue-<num>-<slug>`, the fix, a test run with up to two auto-fix attempts, a local review and one batched fix pass, then a PR created with `gh`, followed by evaluation of the remote review before success is reported.

| Flag | Effect |
| --- | --- |
| `--issue <n>` | Take the issue from GitHub issue number n |
| `--branch <name>` | Custom branch name |
| `--skip-tests` | Skip test validation (not recommended) |
| `--draft-pr` | Create a draft PR |
| `--interactive` | Enable detailed interviews (at most five questions) |
| `--foreman` | Non-interactive; always commit and open the PR |
| `--status` | Report the active run's stage and outcome |
| `--abandon` | Abandon the active run after confirmation |

The run is checkpointed. `/ensemble:issue resume`, `/ensemble:issue status` and `/ensemble:issue abandon [reason]` map to a bare `/ensemble:fix-issue`, `--status` and `--abandon`. `/ensemble:issue list` runs `/ensemble:list-issue` (`--ranked` or `--robot-triage` for ordering). GitHub only; `gh` must be installed and authenticated.

### Feature lifecycle: `/ensemble:feature`

`/ensemble:feature` runs the whole idea-to-implementation chain as one resumable run:

```text
/ensemble:feature new "Self-service password reset"
/ensemble:feature status
/ensemble:feature resume
/ensemble:feature abandon "scope moved to Q3"
```

The dispatcher forwards to `/ensemble:new-feature` (`--idea`, `--status`, `--abandon`, or no flags to resume). The stage order is fixed: `prd_create`, `prd_refine`, `trd_create`, `trd_refine`, `beads_plan`, `implementation_approval`, `implementation`, `pr_approval`, `pr_create`, `done`. A checkpoint store, not file presence, decides which stage runs next. Implementation and PR creation each wait for an explicit approval; a PR is optional and finishing without one is a valid end state. Only one run can be active per project. `new-feature` also accepts a `path` argument naming an indexed or readable PRD to resume from, and `--foreman` for non-interactive operation.

### Acceptance tests from a PRD: `/ensemble:reqnroll`

For .NET projects, turn PRD acceptance criteria into Reqnroll + xUnit tests. Subcommands:

| Command | Does | Default output |
| --- | --- | --- |
| `/ensemble:reqnroll features [prd-path] [--out <dir>] [--dry-run]` | Gherkin `.feature` files, one per requirement, plus a `.prd-trace.json` manifest | `features/<prd-stem>/` |
| `/ensemble:reqnroll feature-drift [prd-path] [--out <dir>]` | Compares the PRD with the manifest. Exit status: in sync, drift detected, or no manifest yet | none (report) |
| `/ensemble:reqnroll bindings [prd-path] [--out <dir>] [--sut <csproj>] [--dry-run] [--force]` | Reqnroll + xUnit project: features, step stubs, project files, `.reqnroll-trace.json` | `tests/` |
| `/ensemble:reqnroll binding-drift [prd-path] [--out <dir>]` | Reports UNBOUND (PRD step without binding) and ORPHANED (binding without PRD step) entries | none (report) |
| `/ensemble:reqnroll tdd [prd-path] [--sut <csproj>] [--out <dir>]` | Outside-in loop, one scenario or PR slice at a time | `tests/` |

Typical sequence:

```text
/ensemble:reqnroll features docs/PRD/PRD-2026-1a2b3c4d-password-reset.md
/ensemble:reqnroll bindings docs/PRD/PRD-2026-1a2b3c4d-password-reset.md --sut src/Portal/Portal.csproj
/ensemble:reqnroll tdd docs/PRD/PRD-2026-1a2b3c4d-password-reset.md --sut src/Portal/Portal.csproj
```

Notes:

- Run the drift checks after editing a PRD. If no manifest exists the checks tell you to run `features` or `bindings` first. Re-running `bindings` adds stubs for new steps; filled bodies are preserved.
- `tdd` is test-first by construction: each new scenario must be observed failing before any production code is written, and a scenario that is green or empty immediately is rejected as vacuous. Step bodies are filled by `reqnroll-binding-specialist`, which never edits the generated step-matching attributes; install `ensemble-reqnroll` for that agent and the `reqnroll` skill.
- Scaffolding is deterministic and done by a CLI helper, never hand-authored.

### Coding standards: `/ensemble:standards`

```text
/ensemble:standards discover src/
/ensemble:standards inject "add pagination to the orders endpoint"
/ensemble:standards fold
```

- `discover [path]` scans the codebase and writes conventions to `standards/` with a machine-readable `index.yml`. It merges with existing content rather than overwriting.
- `inject <task-description>` reads `standards/index.yml`, scores each rule against the task and prints the five to eight most relevant to stdout. It never modifies the index.
- `fold` runs `/ensemble:fold-prompt`, which optimizes `CLAUDE.md` for token efficiency, standards discovery and progressive context loading. `/ensemble:fold-prompt` is also typable directly.

### Repository and team assessment: `/ensemble:assess`

Requires the `ensemble-assessment` plugin (or package). Examples:

```text
/ensemble:assess config
/ensemble:assess repo
/ensemble:assess repo --only security
/ensemble:assess team
/ensemble:assess report
```

| Keyword | Skill loaded | Result |
| --- | --- | --- |
| `repo` | `assess-repo` | Purpose first, then architecture, code quality, testing, security, AI readiness and CI/CD in parallel, synthesized into one report under `docs/assessment/` |
| `team` | `assess-team` | Commit volume and messages, code quality, test coverage, AI adoption, documentation, incidents and code review by developer |
| `config` | `assess-config` | Portfolio-local configuration: code roots, repository and issue-tracker hosts, secret-safe credential wiring, output paths |
| `report` | `assessment-report-suite` | Executive package: `assess-repo` and `assess-team`, the AI Readiness Diagnostic workbook, a markdown summary and a PowerPoint brief |

`--only` applies to `repo` only and runs one leaf skill stand-alone, without the combined report. Valid dimensions:

| `--only` value | Leaf skill |
| --- | --- |
| `purpose` | `assess-purpose` |
| `architecture` (alias `architect`) | `assess-architect` |
| `code-quality` | `assess-code-quality` |
| `testing` | `assess-testing` |
| `security` | `assess-security` |
| `ai-readiness` | `assess-ai-readiness` |
| `cicd` | `assess-cicd` |

An unknown dimension prints the dimension table; `--only` with any other keyword is rejected. The leaf skills remain loadable by name.

### PR to merged: `/ensemble:pr-merge`

```text
/ensemble:pr-merge 482
/ensemble:pr-merge https://github.com/acme/portal/pull/482 --max-rounds=3
/ensemble:pr-merge --dry-run
```

Expected behavior:

- Each failing or pending CI check and each unresolved change request becomes a finding, classified by root cause and dispatched concurrently, one subagent per finding, through the orchestrator that owns that domain (`tech-lead-orchestrator`, `test-runner`, `build-orchestrator`, `infrastructure-orchestrator`, `git-workflow`).
- After every round the command re-reads live CI and review state; a finding counts as resolved only after the fix is pushed and independently re-verified.
- Rounds are bounded by the repository's shared round cap, read from the `ensemble-review-policy` block in the base branch's `REVIEW.md` (1 to 5, default 3). `--max-rounds=N` may only lower it for one run; a larger value is ignored. Reaching the cap halts with a report of every open finding and asks the author to step back and reconsider the approach.
- It never deletes, skips or weakens a test to get green, never force-pushes over others' commits, and never bypasses branch protection. It merges only when every required check passes and no review requests changes.
- `--dry-run` stops after reporting merge readiness.
- Just before the merge and just after it (before the source branch is deleted), the sweep records every unresolved bot finding and failed hosted-CI run that no bead represents yet as a bead in the repository's own tracker (label `merge-sweep`), once: a second sweep of the same facts writes nothing. A refusal, an unavailable tracker or a failed create is reported, never silent, and the sweep never blocks or authorizes the merge; `--dry-run` plans it and writes no bead (`packages/development/skills/local-ci-gate/SWEEP.md`).
- After a real remediation, resolved findings may be distilled into guardrails and proposed to an existing constitution through a separate housekeeping PR. This is best-effort, never creates a constitution file, and never touches the PR being merged.

For the review-gate workflow used by fix-issue and implementation, see [pr-review-cycle-time-pilot](pr-review-cycle-time-pilot.md); for stacked PRs see [stacked-prs](stacked-prs.md).

### Release: `/ensemble:release`

```text
/ensemble:release --version 2.1.0
/ensemble:release --version 2.1.1 --type hotfix
/ensemble:release --version 2.1.0 --draft
/ensemble:release --version 2.1.0 --rollback
```

`--version X.Y.Z` is required. Optional arguments from the YAML:

| Argument | Meaning |
| --- | --- |
| `--type standard\|hotfix\|rollback` | Release type, default `standard` |
| `--from <branch>` (alias `--base`) | Base branch; defaults to `main` for standard and `production` for hotfix |
| `--to <branch>` (alias `--target`) | Target branch; defaults to `release/vX.Y.Z` or `hotfix/vX.Y.Z` |
| `--rollback` | Same as `--type rollback` |
| `--draft` | Create the GitHub release as a draft |
| `--dry-run` | Documented as a simulation, but marked in the YAML as a future enhancement |

Phases: Release Initialization, Quality Gates (security scan, DoD validation, unit, integration, smoke and end-to-end tests), Staging Deployment, Production Deployment, Release Completion, and Rollback on failure.

### Stack detection: `detect-stack`

`detect-stack` (in `ensemble-core`) replaces the four 6.x detector skills. It is a skill with a CLI. The paths below are relative to the root of the `ensemble-core` package: `packages/core/` in a repository clone, or the installed plugin directory on Claude Code. The Pi package ships only the skill's `SKILL.md` and `REFERENCE.md`, not the script, so on Pi run the script from a clone of this repository.

```bash
node skills/detect-stack/detect-stack.js . --axis=framework
node skills/detect-stack/detect-stack.js /path/to/project --axis=test
node skills/detect-stack/detect-stack.js --axis=tooling --tools=helm,kubernetes .
node skills/detect-stack/detect-stack.js --axis=cloud --provider=aws .
node skills/detect-stack/detect-stack.js .
```

| `--axis` | Detects | Detector names |
| --- | --- | --- |
| `framework` | Application framework | `nestjs`, `react`, `phoenix`, `rails`, `dotnet`, `blazor` |
| `test` | Test runner | `jest`, `pytest`, `rspec`, `xunit`, `exunit` |
| `tooling` | Infrastructure tooling | `helm`, `kubernetes`, `kustomize`, `argocd`, `flyio` |
| `cloud` | Cloud provider | `aws`, `gcp`, `azure` |
| `all` (default) | Every axis | all of the above |

Other options: `--framework=<name>` and `--provider=<name>` override detection; `--tools=<a,b>` restricts the tooling axis; `--min-confidence=<n>` sets the threshold for tooling and cloud (default 0.7). Output is one JSON envelope (`axis`, `detected`, `primary`, `confidence`, `threshold`, `results`, `all_results`). Exit codes: 0 something detected, 1 nothing detected (JSON still printed), 2 usage or runtime error. Detector names are skill names, so load `skills/<name>/SKILL.md` for the detected name (`kustomize` is covered by `kubernetes`; `argocd`, `gcp` and `azure` have no dedicated skill).

### Smoke tests: `smoke-test-runner`

`smoke-test-runner` (in `ensemble-e2e-testing`) orchestrates the API, Database, External Services, Auth and Critical Paths smoke-test categories in order with early exit on failure, and contains the per-category guides that were separate skills in 6.x. `/ensemble:release` calls it during its Quality Gates. Ask for it by name, for example "run the smoke-test-runner against staging", before a release or deployment.

## 5. Command reference

### 5.1 Typable commands

The Package column names the marketplace plugin that ships the command. Argument syntax is from each command's `argument_hint` or declared parameters; `\|` separates alternatives.

| Command | Arguments | Purpose | Package |
| --- | --- | --- | --- |
| `/ensemble:prd` | `<create\|refine> [args...]` | Dispatcher: PRD authoring and refinement | `ensemble-product` |
| `/ensemble:create-prd` | `[product-description] [--foreman]` or `--from-meeting <meeting-summary-or-path>` | Create a PRD with elicitation, readiness gate and constitution gate | `ensemble-product` |
| `/ensemble:refine-prd` | `<prd-path> [--from-meeting <summary-or-path> \| --foreman \| --collab [--tunnel=quick] [--reviewers N] [--no-open] \| --long-lived [--ttl <duration>]]` | Refine a PRD with feedback, re-score and lock it | `ensemble-product` |
| `/ensemble:reqnroll` | `<features\|feature-drift\|bindings\|binding-drift\|tdd> [args...]` | Dispatcher: PRD to Reqnroll acceptance tests | `ensemble-product` |
| `/ensemble:trd` | `<create\|refine\|implement\|analyze\|complexity\|validate\|verify\|status\|graph> [args...]` | Dispatcher: TRD authoring, analysis and implementation | `ensemble-development` |
| `/ensemble:create-trd` | `[prd-path] [--team] [--foundational] [--list] [--foreman] [--parser-tables]` | Create a TRD from a PRD | `ensemble-development` |
| `/ensemble:refine-trd` | none declared (takes a TRD path) | Refine a TRD with feedback and detail | `ensemble-development` |
| `/ensemble:configure-team` | `[trd-path] [--team] [--no-team]` | Derive team roles, agent assignments and plugins from TRD complexity | `ensemble-development` |
| `/ensemble:analyze-complexity` | `[work-description] [--bead <id>] [--route simple\|medium\|complex] [--no-adaptive-planning] [--foreman]` | Score work complexity and choose a planning route | `ensemble-development` |
| `/ensemble:analyze-requirements` | `[prd-path] [trd-path]` | Pre-implementation PRD, TRD and beads consistency sweep | `ensemble-development` |
| `/ensemble:validate-requirements` | `[prd-path] [trd-path]` | Pre-implementation REQ coverage and TEST task pairing gate | `ensemble-development` |
| `/ensemble:verify-requirements` | `--trd <trd-path> [--prd <prd-path>] [--mode auto\|beads\|checkbox\|both] [--report-path <path>] [--no-write-report] [--run-tests]` | Post-implementation REQ to AC to code traceability proof report | `ensemble-development` |
| `/ensemble:requirement-status` | `[trd-path-or-slug]` | On-demand requirement satisfaction report from bead comments | `ensemble-development` |
| `/ensemble:trd-dependency-graph` | `[trd-dir\|paths...] [--format json\|mermaid\|dot] [--overlap]` | Dependency graph across TRDs and likely-duplicate work | `ensemble-development` |
| `/ensemble:implement-trd-beads` | `[trd-path] [--plan] [--execute] [--branch=<name>] [--use-current-branch] [--status] [--reset-task TRD-XXX] [--list] [max parallel N] [--foreman] [<trd-path> <trd-path>... --workstream [--generate-only [--out <path>] [--allow-invalid]]]` | Implement a TRD through a persistent bead hierarchy | `ensemble-development` |
| `/ensemble:implement-bead` | `<bead-id>` | Implement one bead through analysis, implementation and PR | `ensemble-development` |
| `/ensemble:beads-build` | `[epic-id\|slug-pattern] [--trd trd-path] [--strategy tdd\|characterization\|bug-fix\|refactor\|test-after\|flexible] [--label <label>] [max parallel N]` | Drive an existing bead hierarchy to completion | `ensemble-development` |
| `/ensemble:refine-beads` | `[epic-id\|release-train-id\|slug] [--scope project]` | Approval-gated bead graph refinement before execution | `ensemble-development` |
| `/ensemble:feature` | `<new\|resume\|status\|abandon> [args...]` | Dispatcher: feature lifecycle | `ensemble-development` |
| `/ensemble:new-feature` | `[--idea "<text>"] [path] [--status] [--abandon [reason]] [--foreman]` | Resumable idea to PRD to TRD to beads to implementation to PR run | `ensemble-development` |
| `/ensemble:issue` | `<fix\|list\|resume\|status\|abandon> [args...]` | Dispatcher: issue workflows | `ensemble-development` |
| `/ensemble:fix-issue` | `[description] [--issue <n>] [--branch <name>] [--skip-tests] [--draft-pr] [--interactive] [--foreman] [--status] [--abandon]` | Lightweight bug-fix workflow ending in a PR | `ensemble-development` |
| `/ensemble:list-issue` | `[--ranked \| --robot-triage]` | List open Beads issues for triage | `ensemble-development` |
| `/ensemble:standards` | `<discover\|inject\|fold> [args...]` | Dispatcher: coding standards | `ensemble-core` |
| `/ensemble:fold-prompt` | none | Optimize `CLAUDE.md` for token efficiency and progressive loading | `ensemble-core` |
| `/ensemble:init-project` | `minimal`, `force` | Scaffold `docs/standards/constitution.md`, `docs/PRD/`, `docs/TRD/` and `.gitignore` entries, plus the review files every pull-request review reads — `.github/pull_request_template.md`, the root `REVIEW.md` (fenced `ensemble-review-policy` block, read only from the base branch) and `.github/CODEOWNERS` — never overwriting one a maintainer already edited; hand-authored Markdown with no YAML source, so it is not counted among the 43 generated commands | `ensemble-core` |
| `/ensemble:sessionlog` | none | Save a structured session transcript with decisions and commands to `SessionLogs` | `ensemble-core` |
| `/ensemble:reinstall-plugins` | `[--all \| <filter>]` | Uninstall and reinstall plugins to pick up marketplace content that version-gated updates miss (Claude Code CLI) | `ensemble-core` |
| `/ensemble:assess` | `<repo\|team\|config\|report> [--only <dimension>] [args...]` | Dispatcher: repository, team and configuration assessment | `ensemble-assessment` |
| `/ensemble:pr-merge` | `[pr-number-or-url] [--max-rounds=N] [--dry-run]` | Drive an open PR to green and merged | `ensemble-git` |
| `/ensemble:release` | `--version X.Y.Z [--type standard\|hotfix\|rollback] [--from <b>] [--to <b>] [--rollback] [--draft] [--dry-run]` | Release workflow with quality gates and rollback | `ensemble-git` |
| `/ensemble:author-playwright-tests` | `[story-or-pr-reference]` | Interactive Playwright test authoring grounded in shipped code and PRD acceptance criteria | `ensemble-e2e-testing` |

That is 35 typable commands.

### 5.2 Hidden commands

Hidden commands are not typable. Each is reached through one dispatcher keyword (or, for the wave runner, through `beads-build`).

| Hidden command | Reached through | Purpose | Package |
| --- | --- | --- | --- |
| `generate-feature-tests` | `/ensemble:reqnroll features` | Gherkin features and traceability manifest from a PRD | `ensemble-product` |
| `check-feature-drift` | `/ensemble:reqnroll feature-drift` | PRD versus generated feature files | `ensemble-product` |
| `generate-reqnroll-bindings` | `/ensemble:reqnroll bindings` | Reqnroll + xUnit test project scaffold | `ensemble-product` |
| `check-binding-drift` | `/ensemble:reqnroll binding-drift` | PRD steps versus bindings on disk | `ensemble-product` |
| `reqnroll-tdd` | `/ensemble:reqnroll tdd` | Red-gated outside-in loop | `ensemble-product` |
| `discover-standards` | `/ensemble:standards discover` | Extract conventions into `standards/` | `ensemble-core` |
| `inject-standards` | `/ensemble:standards inject` | Inject task-relevant standards into context | `ensemble-core` |
| `beads-build-wave` | `/ensemble:beads-build` (dispatched per wave to the `beads-build-wave` agent) | Run one `bv --robot-plan` wave and emit a JSON summary | `ensemble-development` |

`/ensemble:fold-prompt` stays typable; `/ensemble:standards fold` reaches it as well.

Together the 35 typable and 8 hidden commands make the 43 generated commands.

## 6. Skills reference

There are 68 source skills. Skills are loaded by name; the "When to use" column says when to ask for or expect each one.

### `ensemble-core`

| Skill | When to use |
| --- | --- |
| `detect-stack` | At task start to learn the framework, test runner, infrastructure tooling and cloud provider, with confidence scores |

### `ensemble-development`

| Skill | When to use |
| --- | --- |
| `completion-verification` | Independently re-checking a TRD before declaring it done |
| `staleness-gate` | Checking a TRD is not stale before implementation; invokes `/ensemble:refine-trd` if it is |
| `pr-review-cycle` | Local review, batched fixes and a head-bound remote review gate for a PR |
| `tool-path-resolution` | Resolving internal CLI script paths identically across monorepo, plugin and Pi/OMP installs |

### `ensemble-infrastructure`

| Skill | When to use |
| --- | --- |
| `aws` | AWS resources, including ECS |
| `kubernetes`, `helm` | Cluster deployments and Helm charts |
| `flyio`, `railway`, `vercel`, `supabase` | Deploying to or managing that platform |
| `jira`, `linear` | Creating, viewing, updating and searching issues in that tracker with its CLI |

### `ensemble-ai`

| Skill | When to use |
| --- | --- |
| `anthropic`, `openai`, `perplexity` | Integrating that provider's SDK or API |
| `weaviate` | Vector search and RAG with Weaviate |
| `langgraph` | Stateful multi-agent workflows |

### Framework and test skills

| Skill | Package | When to use |
| --- | --- | --- |
| `react` | `ensemble-react` | React 18+ components, hooks, state, Next.js or Vite |
| `nestjs` | `ensemble-nestjs` | NestJS backends |
| `rails` | `ensemble-rails` | Rails 7+ MVC, Active Record, jobs |
| `phoenix` | `ensemble-phoenix` | Phoenix and Elixir, LiveView, Ecto |
| `blazor` | `ensemble-blazor` | Blazor Server and WebAssembly |
| `dotnet` | `ensemble-dotnet` | ASP.NET Core Web API and Minimal API, Wolverine CQRS |
| `jest` | `ensemble-jest` | Running and generating Jest tests |
| `pytest` | `ensemble-pytest` | Running and generating pytest tests |
| `rspec` | `ensemble-rspec` | Running and generating RSpec tests (`generate-test.rb`, `run-test.rb`) |
| `xunit` | `ensemble-xunit` | Running and generating xUnit tests with FluentAssertions and Moq; helper scripts `generate-test.cs` and `run-test.sh` in the skill directory |
| `exunit` | `ensemble-exunit` | Running and generating ExUnit tests |
| `reqnroll` | `ensemble-reqnroll` | Filling Reqnroll + xUnit step bindings test-first |

The test-skill helpers print a JSON result with `success`, `passed`, `failed`, `skipped`, `total` and `failures`.

### `ensemble-git`

| Skill | When to use |
| --- | --- |
| `git-town` | Feature branches, syncing, stacked changes and shipping |
| `changelog-generator` | Generating a changelog from conventional commits (replaces the removed `claude-changelog` command) |
| `act-local-ci` | Running GitHub Actions workflows locally with `act` |

### `ensemble-quality`

| Skill | When to use |
| --- | --- |
| `pr-review-remediation` | Verifying and fixing findings from CodeRabbit or another review agent |
| `flake-reproduction` | A test fails intermittently, in one CI partition or only after another test: reproduce with the logged replay handle, capture the failing output, root-cause it and keep a red-run record. Edit the recipe in `packages/quality/skills/flake-reproduction/` (defaults table in `SKILL.md`, stack commands in `recipes/`); it never retries, quarantines, skips or loosens a test |

### `ensemble-e2e-testing`

| Skill | When to use |
| --- | --- |
| `smoke-test-runner` | Pre-release or post-deploy smoke tests across API, database, external services, auth and critical paths |
| `writing-playwright-tests` | Maintainable Playwright E2E scripts: selectors, page objects, waits |

### `ensemble-assessment`

| Skill | When to use |
| --- | --- |
| `assess-repo` | Full repository assessment (orchestrates the leaves below) |
| `assess-purpose`, `assess-architect`, `assess-code-quality`, `assess-testing`, `assess-security`, `assess-ai-readiness`, `assess-cicd` | One repository dimension |
| `assess-team` | Full team assessment (orchestrates the team leaves below) |
| `assess-team-dimension` | One team dimension (commit messages, code quality, test coverage, AI adoption, documentation, code review); team-level by default |
| `assess-config` | Creating assessment configuration (code roots, hosts, credentials) |
| `assessment-report-suite` | Running both assessments and producing the executive package |
| `ai-readiness-diagnostic-report` | Generating the AI Readiness Diagnostic Excel workbook from assessment outputs |
| `architecture-overview-report` | Portfolio-level architecture overview with Mermaid diagrams across per-repo analyses |
| `assessment-scoring-conflation-audit` | Detecting conflated dimensions and miscalibrated scores before finalizing |

On Pi and OMP, `ensemble-assessment` also generates a wrapper skill named `ensemble-assess` that backs `/ensemble:assess`; it is not one of the 68 source skills.

## 7. Agents reference

There are 35 agents. Orchestrators and commands dispatch them; the table lists where each lives.

| Package | Agent | Role |
| --- | --- | --- |
| `ensemble-core` | `ensemble-orchestrator` | Agent mesh coordination, delegation and conflict resolution |
| `ensemble-development` | `tech-lead-orchestrator` | Plan, architect, break down, build, review and test loop |
| `ensemble-development` | `architect` | Design the technical approach before the builder starts |
| `ensemble-development` | `advisor` | Monitor implementation for shortcuts and silent requirement bypasses |
| `ensemble-development` | `backend-developer` | Server-side implementation |
| `ensemble-development` | `frontend-developer` | Front-end implementation with accessibility and performance focus |
| `ensemble-development` | `documentation-specialist` | Technical documentation and guides |
| `ensemble-development` | `beads-scaffold-specialist` | Design, audit and repair Beads hierarchies from PRD/TRD artifacts |
| `ensemble-development` | `beads-build-wave` | Run exactly one beads-build wave and emit a JSON summary |
| `ensemble-product` | `product-management-orchestrator` | Requirements, prioritization and roadmap coordination |
| `ensemble-quality` | `code-reviewer` | Security-aware code review and Definition of Done enforcement |
| `ensemble-quality` | `deep-debugger` | Bug reproduction, root cause analysis and test-driven fixes |
| `ensemble-quality` | `test-runner` | Run unit and integration tests and triage failures |
| `ensemble-infrastructure` | `infrastructure-developer` | Cloud-agnostic infrastructure automation |
| `ensemble-infrastructure` | `infrastructure-orchestrator` | Environment provisioning and cloud resource planning |
| `ensemble-infrastructure` | `infrastructure-specialist` | Terraform, CloudFormation, Kubernetes and Docker provisioning |
| `ensemble-infrastructure` | `build-orchestrator` | CI/CD and build pipeline optimization |
| `ensemble-infrastructure` | `deployment-orchestrator` | Release automation, promotion and rollback |
| `ensemble-infrastructure` | `postgresql-specialist` | PostgreSQL administration and SQL optimization |
| `ensemble-infrastructure` | `helm-chart-specialist` | Deprecated; delegates to `infrastructure-developer` |
| `ensemble-git` | `git-workflow` | Conventional commits and git-town workflows |
| `ensemble-e2e-testing` | `playwright-tester` | Playwright E2E tests with traces and screenshots |
| `ensemble-dotnet` | `dotnet-backend-expert` | ASP.NET Core, Wolverine CQRS, MartenDB and C# |
| `ensemble-reqnroll` | `reqnroll-binding-specialist` | Fill generated Reqnroll step bodies test-first |

`/ensemble:pr-merge` dispatches the orchestrators in the table, `/ensemble:release` uses `deployment-orchestrator` and `git-workflow`, and `/ensemble:author-playwright-tests` pairs with `playwright-tester`. The `release-agent` and `test-reader-agent` agents were removed in 7.0.0.

## 8. Configuration and environment

Ensemble reads user-level configuration from `$XDG_CONFIG_HOME/ensemble/` (default `~/.config/ensemble/`). Behavior of the workflows is otherwise driven by environment variables and by files in your repository.

### Environment variables

[environment-variables.md](environment-variables.md) is the full reference. The ones that most affect the workflows in this guide:

| Variable | Effect |
| --- | --- |
| `ENSEMBLE_USE_STACKED_PRS` | When `true`, `implement-trd-beads` creates one stacked PR per `### PR N:` section; otherwise one PR for the whole TRD. See [stacked-prs](stacked-prs.md) |
| `ENSEMBLE_BRANCHING_STRATEGY` | Force `git-town` or `plain-git` instead of auto-detection |
| `ENSEMBLE_PR_BACKEND` | `gh` (default), `ado` or `manual` |
| `CLOUDFLARED_PATH` | Location of `cloudflared`, used by `refine-prd --collab --tunnel=quick` |
| `ENSEMBLE_PERMITTER_DISABLE`, `PERMITTER_DEBUG`, `ENSEMBLE_PANE_DISABLE` | Disable or debug the permission-expansion and pane-spawner hooks |
| `METRICS_API_URL`, `METRICS_API_TOKEN`, `PROJECT_ID` | Metrics plugin endpoint, credentials and project tag |
| `FOREMAN_ARTIFACT_PATH` | Read by commands run with `--foreman`; when set, the phase report is also written to that exact path |

### Repository files the workflows read or write

| Path | Used by |
| --- | --- |
| `docs/standards/constitution.md` (fallback `.specify/memory/constitution.md`) | Constitution Gate in `create-prd`, `create-trd`; `pr-merge` guardrail capture |
| `docs/PRD/`, `docs/TRD/`, `docs/TRD/workstreams/` | Generated PRDs, TRDs and workstream TRDs |
| `standards/` with `index.yml` | `/ensemble:standards` |
| `docs/assessment/` | `/ensemble:assess repo` reports |
| `features/`, `tests/` | `/ensemble:reqnroll` outputs |
| `.ensemble/hooks.yaml` | Command lifecycle hooks (Pi only) |
| `.ensemble/new-feature/` | `/ensemble:new-feature` run checkpoints |

For tracking beads state in git see [beads-tracked-export](beads-tracked-export.md).

### Command lifecycle hooks

[command-lifecycle-hooks.md](command-lifecycle-hooks.md) describes `command.start` and `command.end` hooks that run your own shell or prompt handlers around Ensemble commands. A project opts in with `.ensemble/hooks.yaml`, and the file must be trusted before anything runs. Pi is the only supported harness: nothing runs in Claude Code, Codex or OpenCode. Commands are named in the hooks file by their canonical name, for example `ensemble:create-prd`.

## 9. Troubleshooting

### Command not found after install or upgrade

- Claude Code: run `claude plugin list` and confirm the plugin that ships the command is installed and enabled (section 5 gives the package). Plugin updates are gated on the declared version; if marketplace content changed without a version change, run `/ensemble:reinstall-plugins` (or `/ensemble:reinstall-plugins <filter>`), which uninstalls and reinstalls at the recorded scope. Restart the session afterwards.
- After the 7.0.0 upgrade, names that no longer exist stay missing: see section 10 for the replacement of each removed or renamed command.
- Pi and OMP: use the right form for the runtime (`/ensemble-<name>` for Pi, `/skill:ensemble-<name>` for OMP). `/ensemble:assess` needs `ensemble-assessment` installed as its own Pi package.
- Codex: re-run `npx ensemble-codex-install . --force` after upgrading the package so `.codex/skills/commands/` is refreshed.

### A hidden command does nothing when typed directly

Commands such as `reqnroll-tdd`, `generate-feature-tests`, `discover-standards`, `inject-standards`, `check-feature-drift`, `check-binding-drift`, `generate-reqnroll-bindings` and `beads-build-wave` are intentionally not typable. The runtime does not register or advertise them, so typing the old name produces no useful response. Use the dispatcher keyword instead, for example `/ensemble:reqnroll tdd` or `/ensemble:standards inject <task>`. Section 5.2 maps each hidden command to its entry point.

### Pi versus Claude Code differences

- Name form: `/ensemble:<name>` in Claude Code, `/ensemble-<name>` prompt templates in Pi, `/skill:ensemble-<name>` in OMP.
- Dependencies: Claude Code installs `ensemble-core` automatically alongside `ensemble-infrastructure` and `ensemble-quality`. Pi and Codex have no such mechanism.
- Assessment: a separate Pi package; it is not bundled into `ensemble-pi`.
- Hooks: the lifecycle hooks of section 8 work only on Pi.
- `/ensemble:reinstall-plugins` drives the `claude plugin` CLI and is meaningful only in Claude Code.

### Constitution gate halts with `CONSTITUTION_CONFIG_ERROR`

`create-prd` (including `--from-meeting`) and `create-trd` (including `--parser-tables`) run a Constitution Gate before saving. If neither `docs/standards/constitution.md` nor `.specify/memory/constitution.md` exists, the command halts with `CONSTITUTION_CONFIG_ERROR`, writes nothing under `docs/PRD/` or `docs/TRD/`, and prints no next step. A check with no source article id is also a halt for the same reason. Run `/ensemble:init-project` to scaffold `docs/standards/constitution.md` (or create a constitution file at one of those paths yourself) and re-run. No flag bypasses the gate, including `--foreman`.

Before 7.0.0 the separate meeting command skipped this gate; `create-prd --from-meeting` does not, so repositories without a constitution that used the old command will now see the halt. When both constitution files exist and differ, the command warns and uses `docs/standards/constitution.md`.

### `detect-stack` fails with a missing `glob` module

`detect-stack.js` requires the `glob` npm package, and `packages/core/package.json` does not declare it. `glob` is declared only in the repository root `package.json` (a development dependency), so the script loads in a repository clone after `npm install` at the root and may fail to load anywhere else, such as an installed plugin directory, unless the host project provides `glob`. Install it where the script can resolve it, for example in the project that runs it:

```bash
npm install glob
```

Exit code 2 with a message on stderr indicates a usage or runtime error; exit code 1 means nothing was detected.

### `--allow-invalid` seems to be ignored

It is honored only with `--workstream --generate-only`. See the workstream recipe.

### `implement-trd-beads` halts early

Common causes: `bv` or `br` missing (no fallback exists); a Design Readiness score below 3.0 (run `/ensemble:refine-trd`); two or more TRD paths without `--workstream`; `--plan` together with `--execute`; `--execute` with no existing scaffold (run with `--plan` first); an unresolved branch or PR backend in non-interactive mode (set `--branch=<name>` or `--use-current-branch`, and `ENSEMBLE_PR_BACKEND`).

## 10. Upgrading from 6.x

7.0.0 is a major release because commands, skills and agents were renamed or removed. Plugin majors bumped for `ensemble-development` (7.0.0), `ensemble-full` (7.0.0) and most other packages (6.0.0), so existing installs receive the new content. If a plugin still shows old content, run `/ensemble:reinstall-plugins`. On Pi and Codex, reinstall the package; their dependencies are not resolved for you, so install `ensemble-core` alongside the packages that call `detect-stack`.

### Commands

| 6.x | 7.0.0 |
| --- | --- |
| `create-prd-meeting` | `/ensemble:create-prd --from-meeting <summary-or-path>` (now runs the Constitution Gate; mutually exclusive with `--foreman`) |
| `refine-prd-meeting` | `/ensemble:refine-prd <prd-path> --from-meeting <summary-or-path>` |
| `create-trd-foreman` | `/ensemble:create-trd --parser-tables` |
| `create-workstream-trd` | `/ensemble:implement-trd-beads <trd> <trd>... --workstream --generate-only` |
| `generate-feature-tests` | `/ensemble:reqnroll features` |
| `check-feature-drift` | `/ensemble:reqnroll feature-drift` |
| `generate-reqnroll-bindings` | `/ensemble:reqnroll bindings` |
| `check-binding-drift` | `/ensemble:reqnroll binding-drift` |
| `reqnroll-tdd` | `/ensemble:reqnroll tdd` |
| `discover-standards` | `/ensemble:standards discover` |
| `inject-standards` | `/ensemble:standards inject` |
| `claude-changelog` | Removed; use the `changelog-generator` skill |
| `sprint-status` | Removed |
| `web-metrics-dashboard` | Removed |
| `playwright-test` | Removed; use `/ensemble:author-playwright-tests` or the `playwright-tester` agent |
| none | New: `/ensemble:assess`, `/ensemble:reqnroll`, `/ensemble:standards` |

The hidden commands keep working as dispatcher targets, but their old typable names are gone.

### Skills

| 6.x | 7.0.0 |
| --- | --- |
| `developing-with-typescript`, `developing-with-python`, `developing-with-php`, `developing-with-laravel`, `developing-with-flutter`, `styling-with-tailwind`, `using-prisma`, `using-celery` | Removed (generic tutorial skills) |
| `managing-jira-issues`, `managing-linear-issues` | `jira`, `linear` |
| `managing-railway`, `managing-vercel`, `managing-supabase` | `railway`, `vercel`, `supabase` |
| `aws-cloud` | `aws` |
| `using-weaviate` | `weaviate` |
| `using-anthropic-platform`, `using-openai-platform`, `using-perplexity-platform` | `anthropic`, `openai`, `perplexity` |
| `building-langgraph-agents` | `langgraph` |
| `developing-with-react` | Folded into `react` (now also in `ensemble-full`) |
| `dotnet-framework` | `dotnet`, moved from `ensemble-blazor` to `ensemble-dotnet` |
| `framework-detector`, `test-detector`, `tooling-detector`, `cloud-provider-detector` | `detect-stack` with `--axis=framework`, `test`, `tooling` or `cloud` (`--tool x` is now `--tools=x`; one output envelope for every axis) |
| `smoke-test-api`, `smoke-test-auth`, `smoke-test-critical-paths`, `smoke-test-database`, `smoke-test-external-services` | Sections of `smoke-test-runner` |

Anything that loaded a skill by its old name, including custom agents and the `ensemble-blazor` library API (`loadSkill`, `getTemplate`, `getExample`, which no longer take a `skillName` and now serve only `blazor`), must be updated. `assess-repo` and `assess-team` are now thin dispatchers over their leaf skills.

### Agents

The `release-agent` and `test-reader-agent` agents were removed. Use `/ensemble:release`, which delegates to `git-workflow` and `deployment-orchestrator`.

### Other behavior changes

- Hidden commands (section 1) are no longer in the slash menu on Claude Code and no longer registered as Pi prompts.
- `ensemble-assessment` is no longer bundled into `ensemble-pi`; install `@sunstone-partners/ensemble-assessment` on Pi.
- The `xunit` and `rspec` skills are now full skills with working helper scripts that print real JSON results.
- `ensemble-infrastructure` and `ensemble-quality` depend on `ensemble-core`.

## 11. Code review process

Ensemble reviews a pull request in one place: the `pr-review-cycle` skill. `/ensemble:fix-issue`, `/ensemble:implement-trd-beads` and `/ensemble:pr-merge` all reach the review through that skill, so the behaviour described here is the behaviour you get from any of them.

The split to keep in mind: **what a review values is yours to edit in Markdown; what a review is allowed to conclude is graded by code.** Prose a model can misread cannot be a guarantee, so the vote threshold, the risk tier, the approval count and the merge gate are deterministic modules, reached as subcommands of `pr-review-cli.js`.

### 11.1 `REVIEW.md` and the policy block

Review guidance lives in `REVIEW.md` files you write. A root `REVIEW.md` carries repository-wide guidance; a `REVIEW.md` in any directory adds guidance for that area, and when two areas conflict the more restrictive instruction wins.

Policy *keys* are read from the **root** file only, from a fenced ` ```ensemble-review-policy ` JSON block:

| Key | Meaning | Default when absent |
| --- | --- | --- |
| `roundCap` | Review rounds before the cycle stops and asks you to reconsider the approach (1-5) | `3` |
| `maintainerLogins` | People who may resolve findings as maintainers | none |
| `botLogins` | Logins whose approvals never count toward the human requirement | none |
| `sensitivePaths` | Globs that floor the risk tier at High | a strict built-in set |
| `highPaths` | Globs that floor the risk tier at Medium or above | none |
| `lowWaiverEnabled` | Whether a Low tier may actually mean Low | `false` |
| `soloMaintainer` | With exactly one maintainer login: a High PR that touches no sensitive path and was directed by that maintainer needs one human instead of two. A maintainer who is not the PR's author must have approved the current head on the host; a maintainer who is the author (an agent PR committed under their own login, which the host will not let them approve) is credited on their own word as author-as-director, and the result carries the warning `solo-maintainer-self-credit` (a `Directed by:` line alone never lowers the requirement for anyone else). The security lane still blocks High; a PR touching a sensitive path or the policy itself keeps two humans | `false` |
| `sliceThreshold` | Changed lines above which `planSlices` splits a PR area by area. The review runner passes no areas and cuts every PR by size, at every size, with the three keys below, so for it this only names the one slice (`whole-pr` under it, `(repository root)` over it) | `1500` |
| `sliceMaxFiles` | Most paths the review runner gives one reviewer in a slice (a slice is closed once it holds that many). The default is derived from the one real full-mode run and the headroom of 2 (`deadlineHeadroom`, a judgement): the largest slice the slowest observed reader finishes in half the 15-minute reviewer deadline (`lib/pr-review-sizing.js`). The runner never plans more slices than let the review round and the security lane run in one wave, so raise `maxConcurrentAgents` with it and read the `sizing.warnings` of the manifest | `8` |
| `sliceTargetLines` | Changed lines to aim for in a slice (a path is never cut, so one longer file is its own slice); derived the same way | `612` |
| `deadlineHeadroom` | How many times the modelled time to read what a reviewer or the security lane was given (`max(paths x 0.934, changed lines / 100 x 1.224)` minutes, from the same run) its deadline allows (1-10). The default is a judgement and not a measurement: the run holds no spread of one agent's time on identical work, so 2 is set above the ratios it does show (1.18 and 1.70) and below 2.26 (the guide's Slices and deadlines). The deadline is never less than `deadlineMinutes` and never more than 60 minutes | `2` |
| `deadlineMinutes` | Per-agent time budget in minutes, as an object with any of `reviewer`, `verifier`, `security` (each 1-60). Used to compute the `deadlineAt` that `pr-review-cli.js results deadlines` answers; the policy and the CLI only compute it. Stopping an agent at that time is the dispatcher's job, and no skill or command calls the subcommand yet. For a reviewer and the security lane it is the **base** of the review runner's deadline: raised to the modelled time to read what the agent was given (at most 60 minutes), never lowered, and never below the fixed-cost floor of 22 minutes (a value the policy sets below it, 15 included, is overridden and named in the run's sizing warnings, `deadline-floor-over-policy`, and recorded in `sizing.model.policyDeadlineMinutes`; an unset value is raised without a warning and the agent is marked `deadlineFloored`); a value you set cannot be told from the default, so it is a floor and not a pin. The subcommand does that sizing only when its payload carries `work` (`{files, lines}`); without it the answer is the base. A verifier is never sized and is never given less than its own fixed-cost floor of 8 minutes (kata `dx53`: 9 of 60 measured verifiers were stopped at the old flat 5, and their time does not follow their claims), with or without `work`; a value the policy sets below 8 (5 included) is overridden and named the same way | `{"reviewer": 15, "verifier": 5, "security": 15}` |
| `reviewerToolCalls` | Most tool calls one reviewer (a slice reviewer or the whole-range reader) may spend, stated in its brief as `Tool calls` (10-200). More buys deeper reading and probes and costs wall time and tokens for every reviewer; raise `deadlineMinutes.reviewer` with it, or a reviewer that uses its budget is reported not reviewed, and since the coverage gate an incomplete coverage (a path no reviewer listed in `pathsReviewed`) stops the gate (it is not merged on a reviewer that ran out of calls). Snippets count toward this cap, so `reviewerSnippets` must be below it. Advisory: the runner sizes deadlines from paths and changed lines only and neither checks nor warns about this number. | `40` |
| `reviewerSnippets` | Most throwaway read-only snippets one reviewer may run to settle a claim about what code does (whether a call throws, what a pattern matches), stated in its brief as `Throwaway snippets` (1-10). The first measured Medium run allowed one and its reviewers spent it on a nit (kata `yg7k`). A judgement, not a measurement. | `3` |
| `quorumFirstVerification` | Boolean, `true` to turn on (anything else, `"yes"` and `1` included, leaves it off): the review runner asks only the first strict majority of each candidate's verifiers (2 of 3, 3 of 5) and the rest only for a candidate whose first votes are not all `real`. The electorate and the vote rule do not change, so the outcome is the full electorate's; a candidate its first votes settle is recorded `quorum-settled`, is never carried into a re-review (a delta verifies it again), and its tally reads 0 not-real because the verifiers not asked never voted. A missing first vote costs a second dispatch. Kata `3ezq`; see `docs/guides/pr-review-run.md` ("Quorum-first verification") for what it loses and costs | `false` |
| `maxConcurrentAgents` | Most review agents the dispatcher should run at once (1-32), to stay below the account's rate limit. The review runner reads it to split a round into waves and to hold the number of slices to what lets the review round and the security lane run in one wave (`floor((cap - lane) / lenses per slice)`, `lane` being 1 for a run with a security lane), and, for a light run cut into several slices, to decide whether a whole-range reader fits beside them (`slices x lenses + lane + 1 <= cap`; when it does not the plan has none and says so); it is **not enforced yet**: the runner only records the cap, and no code stops a dispatcher from running more agents at once | `8` |

Two deliberate properties:

- The policy is read **from the target branch**, never from the PR head. A PR cannot weaken the rules it is judged by.
- A repository with no `REVIEW.md` gets strict defaults rather than no policy: Low is treated as Medium, the cap is 3, and the built-in sensitive set applies. `/ensemble:init-project` scaffolds a starter `REVIEW.md` for you.

### 11.2 Depth and verification

The risk tier selects a depth, and the depth fixes how many reviewers and verifiers run: **Quick** one reviewer, no verifiers; **Standard** at least two reviewers and 3 verifiers; **Deep** at least two reviewers and 5 verifiers.

| Effective tier | Depth |
| --- | --- |
| Medium | Standard |
| High | Deep |
| Low | Standard, until `lowWaiverEnabled` is in force; then Quick |
| A tier the CLI cannot read | Deep |

A review you ask for ("review PR #123", your local changes) resolves its tier from the changed paths alone, because no classifier runs there: **Medium** for an ordinary change, **High** where a sensitive or High path is touched, never Low. So an ordinary change is reviewed at Standard and a change to a sensitive path at Deep; a Medium change is never reviewed at Deep and an unreadable tier is never reviewed below it. Before the first reviewer starts you see the plan (tier, depth, reviewer and verifier counts, the time bound); a Deep review asks before it starts.

Reviewers read the diff and a frozen snapshot of the commit and report. They run no test suite and no mutation experiment, make a few throwaway read-only checks (`reviewerSnippets`), and stop at a tool-call cap (`reviewerToolCalls`) with the findings they have so far and the paths they did not reach. Whether a finding actually holds is the verifiers' job: each runs the narrowest check on that one finding (one test, or one mutation in its own throwaway copy). A verifier that returns nothing is recorded as incomplete and the cycle moves on; its findings are presented as unverified, never counted as agreement.

**More reviewers, on request.** A review runs the depth's minimum number of reviewers (two at Standard and Deep) unless you ask for more: say "review PR #123 thoroughly", "use more reviewers" or "use 4 reviewers", and the plan you see before anything starts shows 3 (or the number you named, 2 to 4) reviewers instead. The depth, the verifier count and every bound stay as the tier set them, so Quick still has its one reviewer, and asking for more reviewers redoes the review rather than returning a recorded one. Reviewers and verifiers must be agents that follow the output format their brief asks for, can read files and run read-only commands, and do not impose a findings format or a depth of their own; a runtime with no such agent uses its general-purpose agent, and the report says in plain words that the review has reduced assurance.

Every candidate finding — from every reviewer, every local tool and every review bot, CodeRabbit included — enters one ledger and is voted on by fresh-context verifiers that did not raise it. A finding is presented only on a **strict majority of the verifiers the depth expects** (2 of 3, 3 of 5). The denominator is the expected count, never the number of votes that happened to arrive, so a missing verifier is never read as agreement. A finding the verifiers split on is `disputed` and goes to a person rather than being dropped.

With the policy key `quorumFirstVerification` on (it is off by default), "3 verifiers" and "5 verifiers" mean the electorate that decides, not the number dispatched: the runner dispatches the first strict majority of each candidate's electorate (2 of 3, 3 of 5) and the rest only when one of those votes is not `real` or did not arrive. The strict-majority rule, the denominator and the independence of the verifiers are the same; what is lost is the not-real count of a candidate the first votes settle.

Findings that different reviewers very probably wrote up as one defect (the same file, overlapping or neighbouring lines, a matching description) are merged into one entry before verification, and the entry lists where each came from. Anything not clearly the same defect stays separate: two defects on one line are two findings, and one reviewer's own findings are never merged with each other. A defect two reviewers word very differently is simply verified twice; a wrong merge would drop a finding, so the rule errs on the side of keeping them apart.

### 11.3 Risk tiers

The tier comes from the change, never from who wrote it. Sensitive and High paths floor it. The assignment is **raise-only**: anyone may propose a higher tier, but a proposal that lowers one is ignored and recorded as `lowering-needs-code-owner` unless a code owner of the affected path makes it.

| Tier | Human approvals required |
| --- | --- |
| High | 2 |
| Medium | 1 |
| Low | 1 — **Low is treated as Medium** unless `lowWaiverEnabled` is on and the waiver's evidence is present |

Even a code owner lowering a PR to Low does not escape the human requirement while the waiver is disabled: the effective tier stays Medium.

### 11.4 Approvals and the merge gate

An approval counts only when it is **bound to the commit (or tree) under review**, so a later push invalidates it. A bot approval never counts. An author never fills a required slot as an approver. On an agent-authored PR, the person named on the `Directed by:` line counts as one of the required reviewers, as if they had written the code themselves. That line is text the PR's author writes, so on its own it never lowers a requirement: the `soloMaintainer` discount in the table above needs that person's own approval of the current head unless they are the PR's author, and then it rests on their own credit as author-as-director and says so with a `solo-maintainer-self-credit` warning.

`/ensemble:pr-merge` requires `mergeable: true` from the gate, computed from freshly read GitHub state. The gate refuses — and names the blocker and a `nextAction` — on an open Important finding, an unanswered security finding, an incomplete description, approvals short of the tier, or review data it could not read. It never passes on missing data.

> **Honest limit.** These gates run where ensemble runs. Server-side enforcement needs a branch-protection rule in your repository; `pr-merge` reports when one is absent and recommends it, but cannot enforce it.

**A review never fixes.** A review of a PR (local, remote or the merge gate) edits no tracked file, commits nothing and pushes nothing, and writes only its gitignored state report. **Only the merge gate records beads, and only in full mode:** `MODE=gate` (the call `/ensemble:pr-merge` makes) records each presented finding as a bead in the tracker of the repository under review (`lib/pr-review-beads-cli.js`: one bead per finding, labelled `pr-review`, keyed by repository, file and the claim's normalized wording, so a reworded claim makes a second bead that a person closes; a later head rewrites the bead and adds one note, and the same head again writes nothing). A review that stops short of the gate (`MODE=local`, `MODE=remote`) records none, and neither does a light-mode review (below). A bead is closed with the fixing commit only when `lib/pr-review-clear-cli.js` derived from git that a later head changed the finding's cited line and no reviewer raised it again, and the recorder confirmed that commit is on the PR; a finding that is merely missing from the next review leaves its bead open, a bead you closed yourself stays closed and is shown as closed, and a bead is closed only by the pull request that last recorded it (another pull request's fix of the same claim leaves it open and says so). The recorder asks GitHub about the pull request first and records nothing for a fork, an unknown head repository, an unreadable PR, a head that is not the PR's current head or a base commit that is not on its base branch, takes the tracker choice from the base branch's `.ensemble/toolchain.yaml` (never from the code under review), and says so when it records nothing; a repository with no tracker skips the beads, says so and still shows the list. The gate returns a numbered decision list: blocking Important and security findings first, then Nits, then Pre-existing, each with its bead. For each you choose **Fix on this PR** (one fix agent, one push, then a delta re-review and a fresh gate; the head moves and approvals reset), **Fix in a follow-on PR** (Nits and Pre-existing only; the bead is labelled `follow-on`) or **Accept without fixing** (a reason you type; never pre-selected for a security finding). Your follow-on and accept answers are recorded with your login, the head and a time; a Fix on this PR answer is never recorded that way, because the gate would read the finding as closed with no fix. An agent never answers for you, and `--foreman` only logs: beads are recorded, no fix agent runs, no blocking finding is waived, and an open blocking finding keeps the gate at `mergeable: false` until a person decides. Your own unpublished changes ("review local changes") are the exception: no PR exists, so the review there still fixes your working tree.

> **Light-mode reviews are not recorded as beads yet.** When the risk tier selects light mode, `lib/review-run-cli.js` builds the gate and the decision list itself and does not call the bead recorder, so findings reviewed that way get no bead and the list shows none.

**The recorder writes only into the pull request's own repository.** Before the host or the tracker is asked anything, `lib/pr-review-beads-cli.js` checks that the repository's primary checkout (`repoRoot` may be a linked worktree of it) has an `origin` whose every fetch and push URL names the PR's `owner/name` (any case; https, ssh or scp-like). A checkout of a fork or of another repository is refused `repository-mismatch`, a checkout whose `origin` is missing, names no `owner/name` or cannot be listed is refused `repository-unknown`, and one with no primary checkout `no-primary-worktree`: no bead is recorded and the list is still shown. The merge sweep makes the same check.

**Honest limit of the close.** The recorder checks that the commit a `cleared` mark names is on the PR, not that the mark was derived: a mark written by hand that names a commit on the PR still closes the bead, and a person who pastes a close reason in the recorder's own `Fixed: ...` shape gets the bead reopened by the next live finding. The procedure writes the mark only through `lib/pr-review-clear-cli.js` (`carry reconcile` writes none); the control against a hand-written one is that rule, not code. Run `lib/pr-review-clear-cli.js` at every head, in order, and always with `incoming` (every finding the head's review presented, whatever its verdict, `[]` when none): without it the verb fails and clears nothing, and a finding left out of it can be read as fixed. A round it was not run at is not read as a fix: the next run moves each line through that round's edits first. A `lastReviewedSha` that is not on the PR (a force-push replaced it) clears nothing. A finding the verb cannot place is kept for a person to decide, never closed on a guess: one whose file git sees as renamed (the defect went with the file, and a review that raises it under the new path adds a finding of its own, so the old one stays), one raised at a head that a force-push replaced, and one whose line an in-between edit touched (a skipped round's edit included); a review that raises it again re-anchors it.

> **`/ensemble:pr-merge` follows this.** After the gate, and before it asks whether to merge, `pr-merge` prints the decision list and asks you about it: one multi-select question per group (a finding you select is Fix on this PR: one fix run, a delta re-review of the new head and a fresh gate, then the list again for what is still open), then your reason for each finding you accept (a non-blocking finding can also go to a follow-on PR; a blocking one cannot), then the merge question, which says what the merge accepts (open beads, accepted blocking findings and why). It never sends a review finding to a fix agent by itself; only failing checks and unresolved human review threads are still fixed automatically. With `--dry-run` it prints the list and stops. Under `--foreman` it only logs the list and the gate keeps refusing a blocking finding.

### 11.5 Metrics and the reviewer eval set

Review metrics are computed per cohort (open-to-merge time, first-review latency, rounds, review wait) so a change to the process can be compared against a recorded baseline instead of an impression. A guardrail watches reverts and incidents: a cohort that merged faster while reverting more is not reported as an improvement.

The **eval set** is how review quality stays measurable. When a bug escapes review — an incident or a revert — add it with the `pr-review-eval` skill as a code-owner-confirmed case. Scoring replays the set and reports what the current reviewer would have caught.

### 11.6 Sweeps and explainers

- **Sweeps** (`pr-review-sweep`) review code that is *already merged*, on demand, sensitive areas first, with the same bounds and the same strict-majority verification a PR gets. Findings are tagged `Pre-existing`, so they can never block somebody else's merge. A sweep reports: no edit, no commit, no push, no PR. Recurrence is your repository's or Foreman's — the skill holds no timer, and ensemble's own workflows carry no `schedule:` trigger. `/ensemble:init-project` scaffolds a weekly sweep workflow only if you opt in.
- **Explainers** (`pr-review-explainer`) describe a module from the code as it is now, naming every file read. A High-tier PR's report *offers* an explainer for each touched sensitive module; one is generated only when you ask.

### 11.7 Runtime coverage

The review is equivalent on **Claude Code** and **Pi**: both carry the same procedures and the same CLI subcommands, and are tested by running the same payloads through each runtime's own shipped CLI and comparing the output.

On **Codex** and **OpenCode** the capability is **reduced**: both generate the command entry points, but neither bundles the `pr-review-*` procedure skills or a vendored CLI, so the graded steps do not run there. This is stated rather than papered over — see `docs/reports/pr-review-cross-runtime-reachability.md`.

No part of the in-agent review requires a new CI secret, and nothing on the review path makes a network call. A credential that appears in a diff is redacted at the CLI's output boundary, so it is not reproduced in a finding, a PR comment or a ledger entry.

### 11.8 Asking for a review

You do not need a command to start a review. The `pr-review-request` skill routes three plain requests to `pr-review-cycle` (Claude Code and Pi):

| Say | What happens |
| --- | --- |
| "review PR #123" (or a PR URL) | Reviews that PR's current head as a **review-only** run: the independent review, verification and report of the process above, but no batch fix and no re-review, because it is someone else's PR. Reads and reports only: nothing is pushed, commented, approved or resolved on the PR. The result is `REVIEW_PENDING` by design, never `REVIEW_COMPLETE`. Asking again for an unchanged head returns the recorded result instead of redoing the review; say "review it again" to redo it. |
| "review open PRs" | Lists the open PRs and asks which to review when there are more than three. Before anything starts it shows each chosen PR's tier, depth, reviewer and verifier counts and a time bound, and asks only when a PR needs a Deep review. The PRs are then reviewed together: their reviewers and verifiers run at the same time, while test runs go one at a time. |
| "review local changes" | Reviews your working tree (including untracked files) against the default branch. These are your own changes, so the batch fix is applied to the working tree and the tests run locally; nothing is committed. |

**More reviewers.** Add "thoroughly", "use more reviewers" or a number (2 to 4) to any of these requests and the review runs with that many reviewers instead of the default; the plan shows the count before anything starts, and asking this way redoes the review rather than returning a recorded result.

**Tests on someone else's PR.** The host has usually run them already, so a green CI result for that exact commit stands in for a local run: the skill reads the commit's check runs (read-only, once, never waiting for CI) and the review CLI decides whether they count. A check run counts only when it is for exactly that commit and concluded `success`. A run for another commit is ignored; a failed, unfinished or unreadable run, an empty list, or a list shorter than the total the host reported counts for nothing. In any of those cases the tests run locally, once, in a throwaway worktree, and the report says why. Nothing here is typed by an agent: a "CI passed" the CLI did not derive from check runs is refused. The limit, stated: the CLI sees only what the host lists, so a workflow that has not started has no check run yet, and the report names the check runs that counted rather than saying "CI passed".

The request cannot tell who wrote a PR, so the description check reads it as agent-authored (only an explicit `AGENT_AUTHORED=false` says a person wrote it): a body with no `Directed by:` line is reported with `directed-by` missing, and the report shows the grade exactly as the cycle returned it.

To merge rather than review, use `/ensemble:pr-merge`, which runs the review as part of its merge gate.
