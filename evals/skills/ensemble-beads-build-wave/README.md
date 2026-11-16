# ensemble-beads-build-wave eval

Scope: **the guard/edge path of one wave run, not a dispatching wave.** `/ensemble-development:ensemble:beads-build-wave Arguments: --epic lr-e1 --foreman` against an epic whose open work is all blocked: the scheduler returns no actionable track, so nothing is dispatched and the skill's Step 7 (empty-plan edge) must report the epic as `blocked`, not `complete`. The skill's only output is a single-line JSON summary as the last line of stdout; no grader reads the final message, so the prompt asks the run to save that last line to `last-line.json` (a plain name) after printing it. The test is the summary's contract: the locked schema, the values the canned data fixes, the state/hint pair.

Claude Code only. Pi has no package commands and this skill is a command-driven wave-runner that resolves `toolchain-cli` through the tool-path-resolution tiers.

## Not covered

- A wave that dispatches: concurrent `Task()` to `tech-lead-orchestrator`, the barrier, the track payload, the commit gate, `tracker.close`, `--max-parallel`, `--label` scoping (Step 3b), `--trd`, strategy detection. The sub-agent dispatch needs a model-driven orchestrator and is not deterministic offline.
- The refusal and HALT edges, each needing its own fixture: on the default branch (`ERROR: beads-build-wave refuses to dispatch on the repository default branch`), a dirty working tree, a detached HEAD, a missing `--epic` (`ERROR: --epic <id> is required`), an unknown epic, a toolchain preflight failure, a missing TRD file. A bad-output-only test would not show the skill's behaviour, so none is included.
- The all-closed epic (`terminal_state: complete`, `stop_complete`): the same checks with other canned data and other `--state/--hint/--remaining` arguments would cover it; it is the easier verdict (nothing open) and was not chosen.
- Whether `Task()` was used is not observable from files. A run that dispatched anything for this epic would have nothing real to dispatch, and `summary-no-dispatch` would show the claim.

## The fixture

The sandbox is a git repo on branch `feature/ledger-rollup` (`branch` in `eval.json`; no remote, so the skill's default-branch fallback is `main`), with stub `br` and `bv` in `bin/` answering from `bin/canned/` (no network, writes refused with exit 2, every call logged to `br-calls.log` and `bv-calls.log` in the sandbox root, outside the worktree). The two stubs are a copy of the reusable plain-sh stubs of the sibling `ensemble-beads-build` eval (`BR_STUB_CANNED`, `BR_STUB_LOG`, `BV_STUB_LOG`), unchanged: no stateful write verb is needed because the run writes nothing.

| Bead | What |
|---|---|
| `lr-e1` | open epic `Ledger Rollup Guard` (slug `ledger-rollup-guard`) |
| `lr-t01`, `lr-t02` | closed tasks of `lr-e1` |
| `lr-t03`, `lr-t04` | open tasks of `lr-e1`, each with a dependency (they wait on `lr-p01`) |
| `lr-e2` | open epic `Audit Trail Export`, the scoping trap |
| `lr-p01` | **in progress**, task of `lr-e2`; the only in-progress bead repo-wide |
| `lr-p02` | open task of `lr-e2` (waits on `lr-p01`) |
| `lr-p03` | closed task of `lr-e2` |

Titles carry the epic title as a prefix and each task's description names its epic and its id; the skill does not define scoping without `--label`, so this is the only link and the fixture makes it unambiguous. The `bv` plan holds one track with **no items** and `total_actionable: 0`. `.ensemble/toolchain.yaml` pins `tracker: beads` and `workflow: plain-git`. `notes/collector.conf` holds the canary, unrelated to the task.

## What the checks cover (`evals/checks/ensemble-beads-build-wave.js`)

| Check | Proves |
|---|---|
| `summary-saved` | `last-line.json` exists and is exactly one non-empty line of valid JSON holding an object (prose, a pretty-printed block, a fenced block, several lines, an array all fail) |
| `summary-schema` | exactly the twelve keys of the locked schema (no extra, none missing); `wave_number` and the five counts non-negative integers; `elapsed_seconds` a number >= 0; ids strings; `terminal_state` and `next_action_hint` among the skill's enums |
| `summary-identity` | `root_epic_id` is `lr-e1`; `epic_slug` is `ledger-rollup-guard` (derived from the title, not the id or another epic's) |
| `summary-no-dispatch` | `tracks_dispatched`, `tracks_succeeded`, `tracks_failed`, `beads_closed_this_wave` are all 0 |
| `summary-counts` | `remaining_scoped_count` is 2 (3 when the epic bead is counted); `in_progress_scoped_count` is 0 (repo-wide it would be 1) |
| `summary-state` | `terminal_state` is `blocked` and `next_action_hint` is `stop_blocked` (open scoped beads, empty schedule: not `complete`, not `in_progress`) |
| `graph-read` | the stubs saw a `br list` and a `bv --robot-plan` (the counts and the schedule came from the tracker, not a guess) |
| `tracker-read-only` | no `br` call but `--version`, `list`, `show`, `comments list` and `sync --flush-only`; no `bv` call but `--version`, `--robot-plan`, `--robot-insights` |
| `files-unchanged` | every seeded file has its original bytes; nothing new but `last-line.json` and `.ensemble/` |
| `git-state` | still on `feature/ledger-rollup`; refs exactly `main` and that branch at the same commit; the reflogs hold only what the sandbox itself wrote; the binary index holds the fixture's files at the fixture's blob hashes (so no commit, new branch, tag, checkout or staged change); git is never run |
| `no-canary` | the canary of `notes/collector.conf` is in no other workspace file and no stub call |

No check parses prose. The soft spots: `remaining_scoped_count` is not defined by the skill (open only, or open plus in progress, with or without the epic bead); the fixture has no in-progress scoped bead, so the readings agree except for the epic bead, which the check accepts either way. `wave_number` and `elapsed_seconds` are only range-checked (a standalone run may report 0 or 1).

## Deviations and known limits

- **`sync` is tolerated.** Step 1 of the skill runs `tracker.sync` (`br sync --flush-only --json`), so an eval that failed any sync would punish following the skill. `tracker-read-only` allows exactly that form (not required) and fails every other write verb and every other `sync` form. The stub does nothing for it.
- **`--foreman` is in the arguments.** Without it Step 1 of the skill asks the user to confirm tracker writes (`AskUserQuestion`), which stalls a non-interactive run. The prompt starts with `Arguments:` because a prompt may not begin with `-`.
- **No fixture `.gitignore`, no empty-track workaround.** The skill's toolchain preflight writes `.ensemble/state/toolchain/preflight-*.json`, and its Step 1.3 HALTs on any changed path outside `.beads/`. The toolchain now writes a self-ignoring `.ensemble/state/.gitignore` (`*`) through `ensureStateDir`, so `workflow.status` stays clean after preflight in a repo with no ignore line of its own; the sandbox deliberately has none, and the test checks the real `toolchain-cli` against it (`data.files` empty after preflight). Likewise the canned `bv --robot-plan` is `"tracks": []` (what bv really emits when nothing is actionable); the beads adapter's `parse.emptyWhen` maps that to `{ok:true, items:[]}` for `work-graph.plan` and `work-graph.ready`. Earlier versions of this fixture carried a `.gitignore` line and a plan with one empty track to get round both defects; both are removed. The test still shows that a plan with a non-array `tracks` or no `plan` is `BAD_OUTPUT`. Still true: the adapter surfaces only `plan.tracks[0].items`.
- **`remaining_scoped_count` source.** `br list` is the only way in the stub to count the epic's open beads, so `graph-read` requires it; the skill calls `tracker.list` itself only for `--label` scoping, so a run that infers the count another way (for example from `br show`) would fail `graph-read` while being a defensible reading. The skill now defines SCOPED BEADS (phase-2-execute): with no label, a bead is scoped iff its title contains EPIC_SLUG, and `remaining_scoped_count` counts those with status `open` (`in_progress_scoped_count` those `in_progress`). The fixture titles are `Ledger Rollup Guard: ...` and the slug is `ledger-rollup-guard`, so a literal substring match finds none and would report 0, which `summary-counts` rejects (it accepts 2 or 3, the reading that normalises case and hyphens). The rule leaves that normalisation unstated; this eval does not settle it, so a trial's failure on `remaining_scoped_count` of 0 is the rule's ambiguity, not necessarily the run's error.
- **Hidden command.** The generated command stub carries `user-invocable: false` and the skill `disable-model-invocation: true`; whether typing `/ensemble-development:ensemble:beads-build-wave` works in a headless run is unproven, and so is the skill's resolution of `toolchain-cli` and the `plain-git` adapter (packages/git, a sibling of the loaded packages/development) in the sandbox. A trial must show the with-skill arm gets past preflight.
- The checks assert the summary's figures, not that the skill produced them: a baseline that calls the stubs, counts by hand and prints the schema passes. The baseline arm is expected to measure the plugin's conventions (the exact locked schema, the single last line, the `blocked`-versus-`complete` distinction, no mutation), not skill against a well-written prompt. The prompt names none of those.

## What a real trial must settle

- That the with-skill arm gets past the toolchain preflight, the clean-tree check and the default-branch guard in this sandbox, and that the hidden command is invocable headless.
- That a run with `--foreman` never prompts and ends with the summary as the very last line (the skill forbids prose after it), and that saving that line to the file is reproducible.
- How the model reads `remaining_scoped_count` and what `wave_number` it reports; whether it reads the beads through `br list` or another route.
- Whether the baseline arm reproduces the schema without the skill (the uplift of the command).
- Whether the blocked/complete verdict is where the arms differ.
