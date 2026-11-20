# FIX_REPORT: Foreman dispatch detected from `FOREMAN_TASK_TITLE` (finish of run-7e9ef36b4eaa85971c93bc4a819306dd)

Branch `foreman/ensemble-skills-detect-foreman-env-v3/run-7e9ef36b4eaa85971c93bc4a819306dd`, based on `origin/dev` (`fe5aea4f`).

## Root cause

The first attempt (commits `8990e206`, `d2da6e3b`) stated the whole rule, about 90 words, in each of eight skills and rewrote every `--foreman` branch to "In Foreman mode (FOREMAN == true)" across 23 source files. It regenerated nothing. Measured on that HEAD:

- `npm run validate` exited 1 with six prompt word-budget errors. A skill-backed command is measured as `SKILL.md` plus its `references/*.md`, and each of the six skills sat exactly at its baseline on `origin/dev` (zero slack), so every word added was a word over: `new-feature` 3415 vs 3193, `fix-issue` 2877 vs 2709, `create-trd` 4470 vs 4330, `refine-trd` 2625 vs 2485, `implement-trd-tasks` 3772 vs 3649, `pr-merge` 2530 vs 2429.
- Six tests in four `packages/development` suites failed (443 of 449 passed in the 14 suites I ran), because those suites pin the original sentences: `create-trd-command` (`'--parser-tables' and does NOT contain '--foreman': skip the ask`), `refine-trd-command` (`If --foreman is set, skip the question, record GO`), `implement-trd-tasks-parity` (2 tests: the golden capture of every step action, including the Preflight INTERACTIVE line and the Scaffold `--foreman` tagging action), `pr-merge-disposition` (the Step 5.2 action must start with `--foreman` and the SKILL.md must stay within the command ceiling).
- The Pi and Codex copies of the skills were not regenerated, so `generated-drift.yml` would have failed.

The rule had been restated everywhere instead of defined once, in prose whose wording is contract-pinned.

## Change

Approach: state the rule once per skill and leave the pinned `--foreman` sentences alone. Each skill now says that `--foreman` below means "Foreman mode" (flag or non-empty `FOREMAN_TASK_TITLE`), so every existing branch fires on the env path too. The eight skill directories were reset to `origin/dev` and the minimal edits re-applied.

Skill sources (12 files differ from `origin/dev`):

- `packages/development/skills/ensemble-new-feature/references/phase-1-entry-point-resolution.md`: the one full statement (FOREMAN from the flag or a non-empty env `FOREMAN_TASK_TITLE`, `FOREMAN_SOURCE` = flag|env|none with flag winning, same grants as the flag, `CI`/`ENSEMBLE_NON_INTERACTIVE` never imply it); the abandon branch now reads "in Foreman mode" so it makes sense without the flag. The untrusted-event-payload no-auto-approve rule is untouched.
- `.../ensemble-new-feature/references/phase-3-execute-stage.md`: the implementation and PR grants record `granted by --foreman policy (no human present)` for the flag and `granted by Foreman dispatch (FOREMAN_TASK_TITLE set; no human present)` when `FOREMAN_SOURCE` is `env`; removed duplicate "(no question, no prompt)" / "nothing is asked:" / the retry-state restatement to pay for it.
- `.../ensemble-new-feature/references/phase-2-stage-resolution.md`: the re-grant line says "recorded Foreman-mode path"; dropped three clauses the same step already states (`only input is the run index`, `nothing left to run`, `approval is still current`).
- `.../ensemble-new-feature/SKILL.md`: the `foreman` argument points at step 1.1; dropped the intro sentence that restated the run index and "never reordered at runtime".
- `packages/development/skills/ensemble-fix-issue/SKILL.md`: the second full statement (replaces the interview constraint, which Step 2.3 and the `foreman` argument already state); the `foreman` argument's artifact sentence is shorter.
- `.../ensemble-fix-issue/references/phase-4-validation-and-delivery.md`: both pr-review-cycle calls pass `FOREMAN=<true in Foreman mode>` instead of `<--foreman flag>`, so the shared reviewer sees Foreman mode on the env path (it takes `FOREMAN` as a boolean input).
- `.../ensemble-fix-issue/references/phase-1-entry-point-resolution.md`: shorter phase description to stay in budget.
- `packages/development/skills/ensemble-create-trd/SKILL.md`: 20-word reference opens the Foreman subject-contract paragraph; dropped "Never implements; the command stops after producing the TRD." (Constraint 1 says it) and shortened the artifact sentence.
- `packages/development/skills/ensemble-refine-trd/SKILL.md`: 20-word reference in Constraints; the `foreman` argument no longer restates the two HALTs that the Constraints already carry.
- `packages/development/skills/ensemble-implement-trd-tasks/SKILL.md`: 20-word reference inside the `foreman` argument. The workflow references are untouched because the parity suite pins every step action byte for byte.
- `packages/git/skills/ensemble-pr-merge/SKILL.md`: 20-word reference in Constraints; dropped three restated sentences (round-cap arithmetic, the duplicate "never call pr-review-cli.js", "carries it too"). The gate constraint now says "Never call pr-review-cli.js directly" because `pr-review-pr4-packaging` greps for that phrase.
- `packages/development/skills/ensemble-analyze-complexity/SKILL.md`: 20-word reference, and the analyzer invocation adds `--foreman` in Foreman mode (the analyzer library only reads the env subject under `--foreman`).

Reverted to `origin/dev` (the first attempt's edits dropped): `ensemble-feature/SKILL.md`, `ensemble-create-trd` phase-2 and phase-6, `ensemble-fix-issue` phase-2 and phase-3, `ensemble-implement-trd-tasks` phase-1, phase-2 and phase-4, `ensemble-refine-trd` phase-1, phase-2, phase-3 and phase-5. Each held only rewordings of pinned sentences.

Generated output (regenerated, never hand-edited): 12 files under `packages/pi/skills/` and 12 under `packages/codex/.codex/skills/commands/`. The Pi postgenerate hook made no version bump (`packages/pi` stays 1.6.29). `generate:opencode` changed no tracked file.

Tests and docs:

- `packages/development/tests/helpers/foreman-invariants.js`, `packages/development/tests/new-feature-foreman.test.js`: the `envEntry` invariant group and its mutation proofs (see Tests).
- `CHANGELOG.md`: one `### Fixed` entry under `[Unreleased]`.
- `docs/PRD/PRD-2026-1d3e0dd6-new-feature-foreman-flag.md`, `docs/TRD/TRD-2026-1d3e0dd6-new-feature-foreman-flag.md`: version 1.0.2 and a dated Changelog row each, following their existing changelog convention; the TRD sentence "nothing infers it from the environment" keeps its text and gains an amendment marker. No earlier row was changed.
- `scripts/prompt-budget-baseline.json` is untouched: no baseline was raised or lowered.

## Tests

One regression group added to the existing `new-feature --foreman` harness, because that harness already proves its checks can fail by running them on mutated clones:

- `envEntry` in `checkNewFeature` asserts: Entry Step 1 sets FOREMAN from a non-empty `FOREMAN_TASK_TITLE`, records `FOREMAN_SOURCE` as flag or env, and says `CI` and `ENSEMBLE_NON_INTERACTIVE` never imply it; the implementation grant and the PR grant each carry the env-entered detail string when `FOREMAN_SOURCE` is `env`. The two detail strings are the recorded run-record contract, not free wording.
- Three mutation tests: a definition without `FOREMAN_TASK_TITLE`, and an implementation grant and a PR grant that keep only the flag detail, each make `envEntry` fail.
- Evidence it fails on the old behaviour: with the four `ensemble-new-feature` files temporarily set to their `origin/dev` text, `new-feature-foreman.test.js` failed `envEntry` and the control test (2 failures); restored afterwards.
- No other test was added or edited. A grep-for-wording test per skill was not added: the per-skill rule is a one-line reference whose presence would only mirror my own wording, and the pinned existing suites already guard the branches it feeds.

## Local verification

Run from the worktree root unless stated.

- At the starting HEAD: `npm run validate` exit 1, 6 prompt-budget errors (numbers above). `npx jest` of 14 foreman-related suites in `packages/development`: 4 suites failed, 6 tests failed, 443 passed.
- After resetting the eight skill directories to `origin/dev`: the same 14 suites, 449 tests, all pass. Full `npx jest` in `packages/development` at that content: 310 of 311 suites pass, 13195 tests pass, 1 fails (see Assumptions).
- Final prompt word counts versus baseline, from `npm run validate` (and the repo's own `collectSizes`): `new-feature` 3192 / 3193, `fix-issue` 2706 / 2709, `create-trd` 4329 / 4330, `refine-trd` 2481 / 2485, `implement-trd-tasks` 3649 / 3649, `pr-merge` 2428 / 2429. `analyze-complexity` 977 and `feature` 1001, both under the 1500 ceiling with no baseline.
- `npm run generate`: exit 0, no tracked change. `npm run generate:pi`: exit 0, 12 Pi skill files, no version bump. `npm run generate:codex`: exit 0, 12 Codex skill files. `npm run generate:opencode`: exit 0, no tracked change. Re-run after the last skill edit: same result.
- `npm run validate; echo EXIT=$?`: EXIT=0, "186 prompt file(s) within word budgets" (the "below its baseline; lower the baseline" advisories are warnings and were left alone).
- `npm run generate:validate; echo EXIT=$?`: EXIT=0.
- Narrow suites in `packages/development` (22 suites, 714 tests, run before the new tests): new-feature-foreman, new-feature-command, feature-foreman-passthrough, fix-issue-command, fix-issue-generated-parity, create-trd-command, refine-trd-command, implement-trd-tasks-command, implement-trd-tasks-parity, implement-trd-tasks-generated-parity, pr-merge-disposition, local-ci-pr-merge-integration, pr-review-pr4-packaging, complexity-analyzer, specialist-command-regression, doc-maintenance, new-feature-retirement-convergence, bdd-optional-commands, configure-team-command, pr-review-gate-mode-skill, pr-review-never-fixes-skill, pr-review-final-prose. First run after regeneration: 711 passed, 3 failed (`pr-review-pr4-packaging` greps for "Never call pr-review-cli.js", a sentence my `pr-merge` trim had removed). After rewording the gate constraint and regenerating, that suite, `pr-merge-disposition` and `local-ci-pr-merge-integration` pass (123 tests); the rest had passed.
- Full `npx jest` in `packages/development` on the final tree: 310 of 311 suites pass, 13199 tests pass (4 more than the baseline: the new tests), 1 fails: `tests/trd-cli.test.js` "TRD-037 AC-2", the same failure as on `origin/dev`.
- `npx jest scripts/tests` (root): 92 of 94 suites pass, 1892 tests pass, 4 fail in `toolchain-config.test.js` and `toolchain-detect.test.js` (`Received: "user"` where `"default"` is expected); re-run alone, same 4 fail. Same cause as above.
- `npx jest evals`: one full run, made while other jobs were running, timed out 33 of 114 suites; four sampled ones (`refine-trd`, `changelog-generator`, `rspec`, `sessionlog`) pass when run alone. The eight suites that mention foreman (`pilot-evals`, `new-feature`, `pr-merge`, `refine-trd`, `implement-trd-tasks`, `pr-review-cycle`, `beads-build-wave`, `implement-bead`) all pass alone. A clean full re-run was stopped unfinished at the step budget, so the whole `evals/` directory has no clean-run evidence; this change touches nothing under `evals/`.
- `npx eslint` on the two edited test files: exit 0. `npx markdownlint` on the changed docs and skills: no finding in a file I changed (it reports blank-line and code-span findings in untouched `create-trd` phase-3 and `implement-trd-tasks` references).

## Follow-ups

Skills that name `--foreman` or `FOREMAN_TASK_TITLE` and were deliberately not changed:

- `ensemble-feature`: a pure dispatcher; `new-feature` now derives FOREMAN from the env itself, so a flagless dispatch gets the same mode downstream. It has no prompt or grant of its own. (The first attempt's edit was reverted.)
- `ensemble-beads-build`, `ensemble-beads-build-wave`, `ensemble-implement-bead`: the flag only adds `--non-interactive` to toolchain-cli calls, and `isNonInteractive` in `toolchain/confirm.js` already treats a non-empty `FOREMAN_TASK_TITLE` as non-interactive, so an env-only dispatch does not prompt there.
- `ensemble-list-issue`, `ensemble-onboard`, `ensemble-requirement-status`, `ensemble-retro`: already add `--non-interactive` when `FOREMAN_TASK_TITLE` is set; they have no `--foreman` flag.
- `ensemble-create-prd`, `ensemble-refine-prd` (`packages/product`): outside this skill set. `new-feature` forwards `--foreman` to both, so the pipeline is covered; a flagless standalone Foreman dispatch of either still asks its questions and needs the same one-line rule.
- `implement-trd-tasks-reference`: 1495 of 1500 words with no baseline, so it cannot take a rule line; its `--foreman` mentions (INTERACTIVE=false, the `foreman-exec` label) are read through `implement-trd-tasks`, whose rule now covers them.
- `pr-review-cycle`, `pr-review-request`, `pr-review-sweep`: take `FOREMAN` as a caller-supplied boolean and never parse the flag; `fix-issue` now passes it.
- `ensemble-trd`, `ensemble-configure-team`: "Foreman" only as the product name or a skill name; no mode.
- `docs/guides/user-guide.md` and the README command tables still describe `--foreman` as the only trigger; not updated.
- Deferred for budget: none. All six skills fit without reverting any file.

## Assumptions

- "Non-empty" follows `toolchain/confirm.js`, which trims: a whitespace-only `FOREMAN_TASK_TITLE` is not a dispatch.
- `FOREMAN_SOURCE` is recorded only where something reads it (`new-feature` grants) and in the `fix-issue` statement the brief asked for; the other skills carry the 20-word reference, which names no source.
- The existing suites are contracts and were left unmodified; the rule is therefore stated once per skill ("`--foreman` below means it") rather than by rewriting each pinned `--foreman` sentence.
- No package version was bumped by hand (`packages/development`, `packages/git`): release bumps are enforced on the dev to main release PR (`validate-release-bump.js`), and the Pi hook found nothing to bump.
- Environment failures: `~/.ensemble/toolchain.yaml` exists on this machine, so toolchain source resolution returns `"user"`. `trd-cli` "TRD-037 AC-2" fails the same way on `origin/dev` skill content (measured); the four root `toolchain-config` / `toolchain-detect` failures show the same `"user"` source (not run against `origin/dev`), and none of these read skill prose.
- The full `npx jest evals` run that timed out 33 of 114 suites shared the machine with other jobs; the suites I re-ran alone passed (see Local verification).
