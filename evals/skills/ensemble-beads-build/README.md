# ensemble-beads-build eval

Scope: **plan mode only.** `/ensemble-development:ensemble:beads-build billing-export --plan` (Phase 5 of the skill) run against a seeded epic in a sandbox where `br` and `bv` are stubs (`fixture/bin/`) answering from canned JSON (`fixture/bin/canned/`). Plan mode prints a scope summary and the next wave plan and stops; the skill only prints, so the prompt asks the run to save what it printed to `report.md`. The wave loop, the builder / code-review / close pipeline, the quality gates, completion and the TRD mode (`--trd`) are **not** evaluated.

Not covered: the negative paths of epic discovery (zero slug matches, multiple slug matches: `ERROR` and HALT). They need other canned data (an issue list with no match, one with two matching open epics) and a different prompt; this fixture has exactly one match. A bad-output-only test would not show the skill's behaviour, so none is included.

## The fixture

| Bead | What |
|---|---|
| `bb-e1` | open epic, title `billing-export` (the slug the prompt passes) |
| `bb-t01..04` | closed tasks `billing-export: ...` |
| `bb-t05`, `bb-t06` | in-progress tasks |
| `bb-t07..10` | open tasks; `bb-t10` (wire export endpoint) is blocked by `bb-t07` and `bb-t08` |
| `bb-e2`, `bb-p01..06` | the scoping trap: epic `payments-gateway` with 3 closed, 1 in progress, 2 open tasks |

The epic's own counts: **Open 4, In-progress 2, Closed 4**, or Open 5 if the epic bead (open, title equal to its slug) is counted in the filtered set; the skill's wording ("count from that filtered set") allows both, so the check accepts both. Whole-repo counts (Open 9, In-progress 3, Closed 7 with both epics) fail.

The `bv` plan: `track-A` = `bb-t07`, `bb-t08` (both unblock `bb-t10`), `track-B` = `bb-t09`, `track-C` = `bb-p05` (the other epic). `bb-t10` and `bb-p06` are blocked and in no track. `.ensemble/toolchain.yaml` pins `tracker: beads` and `workflow: plain-git` (the sandbox has no origin remote; the skill's plan mode still preflights the `workflow.*` capabilities).

## What the checks cover (`evals/checks/ensemble-beads-build.js`)

| Check | Proves |
|---|---|
| `report-saved` | `report.md` exists, is not trivially short, and names the epic id `bb-e1` |
| `scope-counts` | open / in-progress / closed counts are the epic's (first count printed per label; label-first or number-first; Open 4 or 5) |
| `ready-items` | the track-A ready beads are named on a line that is not about blocking; blocked, in-progress and closed beads are not offered as ready |
| `track-breakdown` | `bb-t07` and `bb-t08` sit in one track-labelled section, apart from `bb-t09` |
| `final-hint` | a line runs `beads-build bb-e1`, `implement-trd-tasks` is mentioned, and the hint is among the last lines |
| `graph-read` | the stubs saw a `br list` and a `bv --robot-plan` (the figures came from the tracker, not a guess) |
| `tracker-read-only` | no `br` call but `--version`, `list`, `show`, `comments list` and `sync --flush-only`; no `bv` call but `--version`, `--robot-plan`, `--robot-insights` |
| `files-unchanged` | every seeded file has its original bytes; nothing new but `report.md` and `.ensemble/` |
| `git-state` | no commit, branch, tag, checkout or stash, nothing staged: read from `.git/` (HEAD, refs, the single reflog entry, the binary index compared with the fixture's blob hashes); git is never run |

`scope-counts`, `ready-items`, `track-breakdown` and `final-hint` parse free-form text and are the flaky ones (marked in the script). The others do not depend on the report's layout.

## Deviations and known limits

- **`sync` is tolerated.** The skill's own plan mode runs `tracker.sync` (`br sync --flush-only --json`) before listing, so an eval that failed any `sync` would punish following the skill. `tracker-read-only` allows exactly that form (not required) and fails every other write verb and every other `sync` form. In a real workspace that call exports the database to `.beads/issues.jsonl`; the stub does nothing.
- **Only track-A is guaranteed to be visible.** Through toolchain-cli the beads adapter surfaces `plan.tracks[0].items` for `work-graph.ready` and `work-graph.plan`, so a run that follows the skill reports track-A only. Other tracks are optional here, and `track-breakdown` shows grouping, not completeness. A run that reads `bv` directly may print all three.
- **The scope filter of the skill is loose** (`EPIC_SLUG` prefix over titles that, for a real TRD epic, look like `[trd:slug:task:...]`). The fixture uses a plain epic whose title equals the slug and tasks titled `<slug>: ...`, which match under every reading. A real TRD-scaffolded hierarchy is not exercised.
- The checks assert the report's figures, not that the skill produced them: a baseline that calls the tracker and counts by hand passes. The baseline arm is expected to measure the plugin's conventions (the printed scope line, the plan line, the closing hint, no mutation), not skill against a well-written prompt. The baseline cannot know the hint text, so `final-hint` is expected to fail there.
- The stub `br list` answers every bead regardless of filters, and `show` only for ids with a canned file (the two epics); real `br` shape differences (the bare array of older versions) are not exercised.
- `git-state` reads index version 2 (git's default; 3 and 4 appear only with intent-to-add, skip-worktree or manyFiles); any other version fails the check by name. It also counts reflog entries, so a harmless `git checkout main` while already on `main` (one extra HEAD reflog line) fails it although nothing changed; the skill's plan mode runs no such command.
- `tracker.sync` is side-effecting for the toolchain's confirmation gate: without `--non-interactive` (or `ENSEMBLE_NON_INTERACTIVE=1`, `CI=true`) `toolchain-cli run tracker.sync` answers `CONFIRMATION_REQUIRED` for the project-pinned `beads` adapter (reads like `tracker.list` are unaffected). The skill treats sync as optional (skips on `{ok:false}`), so a run on the interactive branch loses nothing but the flush; the eval sets no environment (the kit base has no `env` field), so the prompt's "ask no questions" is what steers a run to `--non-interactive`.
- Claude only. Pi has no package commands, and the skill resolves `toolchain-cli` and the workflow adapters by path (`tool-path-resolution`, sibling packages).
- No model was run. No measured result is stated here.

## What a real trial must settle

- Whether the with-skill arm resolves `toolchain-cli` (the `tool-path-resolution` tiers, `${CLAUDE_PLUGIN_ROOT}`) and passes the preflight with only `packages/development` loaded: the `workflow: plain-git` adapter lives in `packages/git`, found only as a sibling package of the loaded plugin directory. The tests prove the real `toolchain-cli` preflights and reads the stubs when run from the checkout, not that the plugin install reaches them. If it halts there, the eval measures nothing; `sharedPackages: ["git"]` is a candidate fix.
- Whether the run saves `report.md` as the prompt asks and in a layout the four flaky checks read.
- Whether a real run counts the epic bead (Open 5) or not (Open 4), and whether the report prints the skill's `=== EPIC SCOPE ... ===` line.
- Whether the Task tool or the `Skill` tool is needed (plan mode needs neither; both are allowed).
- Whether the baseline arm gets anywhere near the figures without the skill, and so what the uplift means.

## Reusing the stubs (for `ensemble-beads-build-wave`)

`fixture/bin/br` and `fixture/bin/bv` are plain POSIX `sh`, mode 755, put first on the agent's PATH by `sandboxPath: ["bin"]`. Copy `bin/` into the other eval's fixture (an eval fixture cannot reference this one) and change only `bin/canned/`.

| Setting | Meaning |
|---|---|
| `BR_STUB_CANNED` | directory of canned files (default `canned/` beside the script; also used by `bv`) |
| `BR_STUB_LOG` | file `br` appends every call to (default `br-calls.log`, two levels above the script: the sandbox root, outside the git worktree) |
| `BV_STUB_LOG` | the same for `bv` (default `bv-calls.log`) |

`br` answers: `--version`; `list ...` (`canned/issues.json`, `{"issues":[...]}`, filters ignored); `show <id>` (`canned/show-<id>.json`, a one-element array, else `ISSUE_NOT_FOUND` on stderr and exit 3, which is how the skill's slug mode starts); `comments list <id>` (`canned/comments-<id>.json`, else `[]`); `sync --flush-only` (`{"status":"ok"}`, a no-op). Everything else (`create`, `update`, `close`, `comments add`, `dep`, `label`, any other `sync`, `init`) prints `br stub: unsupported call` on stderr, exits 2 and is still logged. `bv` answers `--version`, `--robot-plan` (`canned/bv-plan.json`) and `--robot-insights` (only when `canned/bv-insights.json` exists). Each call is one log line holding its full argv (a newline or carriage return in an argument is folded to a space, so an argument cannot fake a second call).

The wave eval must execute writes (`update`, `close`, `comments add`); the stub deliberately has none, because this eval needs a refusal. Add them to the copy as stateful verbs, for example by rewriting `canned/issues.json` with a `sed` or by appending to a state file next to the log, and keep the refusal for the rest. `evals/tests/skills/ensemble-beads-build.test.js` shows how the stubs are tested directly (exit codes, log lines, `BR_STUB_CANNED`) and through the real `toolchain-cli` (`preflight`, `tracker.show`, `tracker.list`, `tracker.sync`, `work-graph.ready`, `work-graph.plan`).
