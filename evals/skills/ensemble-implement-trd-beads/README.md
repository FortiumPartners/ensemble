# ensemble-implement-trd-beads eval (plan scope)

Eval id `ensemble-implement-trd-beads-plan`. This file is documentation for maintainers; it is not part of `fixture/` and is never copied into a sandbox. It states no measured result: no real run has been made.

## Scope

Covered: Phase 1 (preflight) and Phase 2 (scaffold) of `/ensemble-development:ensemble:implement-trd-beads`, run with `--plan --foreman`.

Not covered: Phase 3 (beads-build execution), Phase 4 (quality gates, PR creation), Phase 5 (completion, epic closure). They need a separate eval; the design memo (`~/.omp/trd-skills-eval/itb-design.md`) lists the harness and fixture needs.

## How the run stops after Phase 2

The skill has its own switch: `--plan` sets `PLAN_ONLY` (Step 1.1), and Step 2.2 ends with "Plan complete. Bead hierarchy created ..." and EXIT. `--foreman` makes the run non-interactive. The prompt also says in words: plan only, no product code, no tests, no push, no pull request. The checks tolerate a run that stops earlier by failing the matching check (a skill HALT before the scaffold leaves no beads), and every Phase 3+ side effect (push, `pr create`, a bead leaving `open`, a second branch, product code) is a failure.

## Fixture

A 2-PR, 6-task slugify TRD (`docs/TRD/TRD-2026-b1c2d3e4-slugify.md`) whose frontmatter requests stacked PRs and a proposed first branch, so branch intent resolves without a question. `trd-cli validate` reports no error and no warning. `.ensemble/toolchain.yaml` pins host `github`, workflow `plain-git`, tracker `beads`, test-runner `default`, package-runner `npm` (a local bare origin matches no host, and other trackers are co-installed). `.gitignore` covers `.ensemble/state/` and `.beads/` so the tree stays clean for the clean-tree gate. The br workspace is created by `setup: [["br","init","--prefix","itb"]]` (allowlisted). `bin/gh` is a stub (`sandboxPath: ["bin"]`): it answers `--version`, `auth status`, `repo view`, `pr list`, logs every call to `../gh-calls.log` and fails closed (exit 2) on anything else, including `pr create`.

## Checks (`evals/checks/ensemble-implement-trd-beads.js`)

Labels are deliberately not checked: step 2.1 creates beads without labels and Phase 3 backfills them (`beads-label`), outside this scope. The one check that touches labels is `foreman-tags` (`foreman-exec`, task beads only).

The script reads the workspace with `fs` and `path` only. It also calls the repo's `trd-cli` in-process (repo code) on the pristine fixture TRD, from the fixture directory with PATH emptied so trd-cli's one `git rev-parse` cannot run; git is never run in the workspace.

Expectations are computed from the pristine fixture TRD with the repo's `trd-cli` (`scaffold-plan`, `pr-plan --stacked`), not hard-coded. Beads are read from the exported `.beads/issues.jsonl` (br auto-flushes it; the skill also runs `br sync --flush-only`), because a check may not run programs and the check environment has a throwaway `HOME`. The header of the script marks each check robust or flaky.

## What a real trial must settle

1. Whether step 1.3 can resolve `validate-git-town.sh`. It lives in `packages/git`, not loaded here, and tier 3 of tool-path-resolution looks under `${CLAUDE_PLUGIN_ROOT}/skills/git/...` of the command's own plugin (`packages/development` has no `skills/git`), so a HALT is likely unless the model finds the sibling package. `"sharedPackages": ["git"]` loads that plugin but may not make the path resolve: unproven, settle it with the trial.
2. Whether `${CLAUDE_PLUGIN_ROOT}`, `toolchain-cli` and `trd-cli` resolve in the sandbox, and whether `--plan --foreman` reaches the EXIT line without a prompt.
3. Whether `.beads/issues.jsonl` is current at the end (auto-flush plus the skill's `tracker.sync`), and the exact bead titles, types and edge direction the adapter produces versus the plan.
4. Whether `--foreman` tagging (`foreman-exec`) runs at plan scope (the `foreman-tags` check tolerates none, but not a partial set), and whether work-graph findings HALT before the stop.
5. Staleness gate (STALE would invoke refine-trd), step 1.7's agent alias map, and any gh call the preflight makes beyond the stub's reads.
6. Cost and time: sized `timeoutSec` 900, `runUsd` 5, `maxTurns` 150 from design estimates only. Run with `--repeats 1` first.

## Baseline arm

The baseline gets no plugin and no command, so it cannot scaffold; its result is meaningless by construction (as for the pilots). Read only the with-skill absolute pass rate; uplift here is the plugin's.

## Kit note

`kit.armsFor(id)` passes the eval id to `run.js --skill`, which selects by skill name, so it fails when the id differs from the skill (this eval's id has the `-plan` suffix). The test therefore runs the same arms check locally. A follow-up PR to the kit could pass the skill name.
