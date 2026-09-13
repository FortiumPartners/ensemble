# Ensemble — how it works on this machine

Written for the other Claude sessions. If you are about to run an `ensemble:` command and you
are not sure what it will do to your checkout, read the [Before you run anything](#before-you-run-anything)
section first — that is the part that has actually cost people time.

Ensemble is a set of Claude Code plugins that turn a piece of work into a planned, reviewed
change: product requirements, technical requirements, a task graph, then implementation by
specialist subagents. **v6.9.3 — 48 commands, 38 agents, 27 plugins.**

Upstream is `Sunstone-Partners/ensemble`, maintained by Leo D'Angelo. `FortiumPartners/ensemble`
is ours: ops tooling and issue tracking. The `FS-Ensemble` session owns keeping the two in step —
ask it rather than syncing anything yourself.

## Before you run anything

**Several commands take over your branch and your working tree.** They run `git checkout -b`,
edit files, and open a PR. Two of them in one checkout will collide:

| Command | Takes a branch | Opens a PR |
|---|---|---|
| `fix-issue` | yes | yes |
| `implement-bead` | yes | yes |
| `implement-trd` | yes | yes |
| `implement-trd-beads` | yes | yes |
| `beads-build` | yes | yes |
| `release` | yes | yes |

`fix-issue` is three ordered phases — Analysis and Planning, then Execution, then Validation and
Delivery. **One at a time.** Firing several in parallel to work through a list of issues puts two
branch checkouts and two sets of edits in the same tree, and they overwrite each other.

To genuinely work on several at once, give each its own checkout:

```bash
git worktree add ~/projects/.worktrees/<repo>-issue-42 -b fix/issue-42
```

See `~/projects/docs/GIT_WORKTREES.md`. Everything else here is read-only or writes only
documents, and is safe to run whenever.

## Pick the workflow by the size of the work

Running the full pipeline on a bug costs hours and produces a PRD nobody reads. Running
`fix-issue` on a platform migration ships something nobody planned.

| Size | Use | What you get |
|---|---|---|
| A bug, a typo, one file | `fix-issue` | analysis straight to a PR, no PRD, no TRD |
| A contained feature | `create-prd` → `create-trd`, then stop | documents to review before anyone writes code |
| Large or cross-cutting | `create-prd` → `refine-prd` → `create-trd` → `refine-trd` → `implement-trd-beads` | the full pipeline with refinement gates |
| One task in an existing TRD | `implement-trd-task --task <id>` | a single task through implement, review, close |

**`analyze-complexity` will choose for you.** It scores scope, dependencies, risk and team size,
then routes: 1–3 to `fix-issue`, 4–6 to PRD and TRD, 7–10 to the full pipeline. It prints the
score and its reasoning before it dispatches, and when a description carries no signal at all it
stops and asks rather than guessing.

It under-routed badly until 2026-09-06 — a multi-service billing feature scored 3 out of 10 and
was sent to `fix-issue`. That is fixed upstream and live here. If you saw a warning in
`~/projects/CLAUDE.md` telling you to always pass `--route` by hand, that warning is stale.
`--route simple|medium|complex` still works when you already know the size.

## `implement-trd` or `implement-trd-beads`

**Use `implement-trd-beads`.** The two are separate implementations, not a flag on one command.
`implement-trd` contains no beads calls at all — zero `bv`, zero `br`. The three times the word
"beads" appears in it are comments pointing at the other file. It runs git-town, one branch, one
PR, and it re-reads the TRD to decide what to do next.

`implement-trd-beads` parses the TRD into an epic/story/task hierarchy in beads first, then lets
`bv --robot-plan` schedule the work. What that buys:

- **It survives the session ending.** State lives in the bead graph, so a run that stops halfway
  picks up where it stopped. `implement-trd` holds its position in the conversation, so a context
  compaction or a crash costs you the run.
- **It ships in slices.** A TRD written with `### PR N:` headings becomes one branch and one PR
  per section, each with its Shippable State line in the body. `implement-trd` produces a single
  PR for the whole TRD.
- **It runs tracks in parallel** up to `max_parallel`, because the scheduler can see which beads
  are unblocked.

Cost: `br` and `bv` have to be installed, and the bead graph is real state you can end up having
to repair. `implement-trd` needs only git-town.

Take `implement-trd` when the TRD is small enough to land as one PR in one sitting and you do not
want a bead hierarchy for it. Anything larger, use the beads variant.

## Finding the commands

The prefix depends on which plugins your config root has enabled, and it is not the same in
every session. **Type `/ensemble` and let completion show you what you have.** Do not copy a
prefix out of a document, including this one.

You will see either `ensemble-full:<command>` or `<plugin>:ensemble:<command>` — for example
`ensemble-development:ensemble:fix-issue`. Both resolve to the same command.

## What needs to exist first

Already installed here, listed so you can tell a missing prerequisite from a broken command:

- **`gh`**, authenticated. Anything that opens a PR needs it. GitHub only, no GitLab or Bitbucket.
- **`br` / `bv`** (Beads). Needed by `implement-trd-beads`, `beads-plan`, `beads-build`,
  `implement-bead`, `create-trd`, and the requirement-tracing commands.
- **`git-town`**, used by `implement-trd` for branch management.
- **Node 20+**.

`fix-issue` stops if tests fail, retries a fix at most twice, and caps its interview at five
questions. `--skip-tests` overrides the first of those.

## Where it comes from

Not from a remote marketplace. Every config root resolves the `ensemble` marketplace to a
directory:

```
~/projects/.worktrees/ensemble-live      branch `live`, tracks sunstone/main
```

That worktree decides what all sessions load. Nothing lands in it without the FS-Ensemble
session running a sync, so the version you have is deliberate.

Two consequences worth knowing. A plugin update is **version-gated**, so when content changes
without a version bump `claude plugin update` reports success and copies nothing — only
uninstall plus install actually re-copies. And a running session keeps whatever it loaded at
startup, so a sync reaches you when you next restart, not before.

A `SessionStart` hook tells you when the worktree has fallen behind upstream, and when the
watcher behind it has itself gone stale. Silence from it means current.

## If the ensemble commands are missing

Ask the FS-Ensemble session to run `scripts/provision-ensemble.sh`, then restart yours.

Burke runs four accounts (`ccrgm`, `ccram`, `ccrfs`, `ccrfp`), each with its own config root.
Ensemble used to be installed by hand in whichever root was in front of whoever did it, so new
accounts arrived without it — and twice a root ended up with the plugin registered and enabled
while its install directory did not exist. A session in that state has no ensemble commands and
nothing says why. The script brings every root to the same install and repairs that case;
`--check` reports without changing anything.

## Known rough edges

Read these before filing something already known. Full list:
`gh issue list --repo FortiumPartners/ensemble`.

- **#88** — `implement-trd-beads` preflight hard-codes a Claude Code variable and breaks under
  Oh My Pi. Fine here; only matters if you are running OMP.
- **#83** — `packages/router` tests gate on `CI=true` rather than on pytest working.
- **#86** — `scripts/tests/` is not wired into CI, so `lint-model-ids.test.js` has never run.
- **#92** — 21 `SKILL.md` files are missing frontmatter.
- **#96** — the opencode dist suite is written to skip in CI, so the generator's output is never
  checked.
- **#99, #100** — two guard defects in `validate-peer-deps.js`, both filed with reproductions.

If a command misbehaves, say what you ran and what happened. A vague report costs a session more
than it saves.

## Deeper reading

- `CLAUDE.md` in this repo — architecture, plugin structure, agent mesh, hooks, conventions.
- `~/projects/CLAUDE.md` — the workspace-level summary every session already loads.
- `~/projects/.worktrees/ensemble-live/docs/` — upstream guides, including the stacked-PR
  walkthrough for `implement-trd-beads`.
- Upstream product README: `~/projects/.worktrees/ensemble-live/README.md`.
