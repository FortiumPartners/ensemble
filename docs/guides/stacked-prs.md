# Stacked PRs with implement-trd-beads

`implement-trd-beads` turns `### PR N:` sections in the TRD Master Task List into a git-town stacked PR chain. Each PR section becomes its own feature branch; branches are stacked so each PR targets the previous one, and git-town automatically retargets child PRs as the stack merges bottom-up into main. This guide walks through TRD structure, the full workflow, branch naming, merge order, cross-session resume, and common mistakes with fixes.

**Stacked PRs are opt-in.** Set `ENSEMBLE_USE_STACKED_PRS=true` in your environment to enable the per-PR stacked workflow described in this guide. Without it (the default), `implement-trd-beads` implements all PR sections on a single branch and opens ONE pull request for the whole TRD. Phase ordering is preserved either way.

## Table of Contents

1. [How to structure your TRD](#1-how-to-structure-your-trd)
2. [Step-by-step workflow](#2-step-by-step-workflow)
3. [Branch naming and git-town commands](#3-branch-naming-and-git-town-commands)
4. [PR creation](#4-pr-creation)
5. [Merging the stack](#5-merging-the-stack)
6. [Cross-session resume](#6-cross-session-resume)
7. [Checking progress](#7-checking-progress)
8. [Common mistakes and fixes](#8-common-mistakes-and-fixes)
9. [Syncing your local branches with remote](#9-syncing-your-local-branches-with-remote)
10. [Legacy format (Phase/Sprint headings)](#10-legacy-format-phasesprint-headings)

---

## 1. How to structure your TRD

`### PR N: <title>` headings belong in the `## Master Task List` section only — not in Sprint Planning or any other section. The detector scopes to the Master Task List section on every invocation; headings elsewhere are ignored.

Each `### PR N:` heading must be immediately followed by a `**Shippable State:**` line. The shippable state must describe a user-observable capability, not an infrastructure milestone.

```markdown
## Master Task List

### PR 1: Authentication API
**Shippable State:** Users can register and log in via the REST API.

- [ ] **TRD-001**: Implement login endpoint (2h) [satisfies REQ-001]
- [ ] **TRD-002**: Add JWT token generation (1h) [satisfies REQ-002]

### PR 2: User Profile
**Shippable State:** Users can view and update their profile.

- [ ] **TRD-003**: Implement profile endpoint (2h) [satisfies REQ-003]
```

Rules for the Shippable State line:

- Must describe what a user can do after the PR merges, e.g., "Users can log in with email and password"
- Must NOT be an infrastructure-only statement, e.g., "scaffolding complete" or "schema migrated"
- One sentence, written in present tense from the user's perspective

---

## 2. Step-by-step workflow

### Step 1 — Plan (scaffold beads and create first branch)

```bash
/ensemble:implement-trd-beads docs/TRD/my-trd.md --plan
```

- Creates the full beads hierarchy (epic → stories → tasks)
- Creates `feature/<trd-slug>-pr-1` via `git town hack`
- Prints execution instructions and exits — no implementation yet

### Step 2 — Execute (implement tasks and create PRs)

```bash
/ensemble:implement-trd-beads docs/TRD/my-trd.md --execute
```

- Drives implementation via `bv --robot-next` / `br ready`
- When all tasks in PR 1 are done: runs test gate → creates PR 1 → stacks PR 2 branch
- When all tasks in PR 2 are done: runs test gate → creates PR 2 → stacks PR 3 branch
- Continues until all phases complete
- Prints a `=== STACKED PR SUMMARY ===` at the end

### Or run both in one command

```bash
/ensemble:implement-trd-beads docs/TRD/my-trd.md
```

Scaffolds and executes in sequence. On cross-session resume it auto-detects the existing scaffold and skips directly to execute.

---

## 3. Branch naming and git-town commands

| Phase | Branch name | Git-town command |
|-------|-------------|-----------------|
| PR 1 | `feature/<slug>-pr-1` | `git town hack feature/<slug>-pr-1` (from main) |
| PR 2 | `feature/<slug>-pr-2` | `git town append feature/<slug>-pr-2` (stacked on PR 1) |
| PR 3 | `feature/<slug>-pr-3` | `git town append feature/<slug>-pr-3` (stacked on PR 2) |

Key distinction: `git town hack` creates a branch from main; `git town append` creates a branch stacked on the current branch. The `append` command is what establishes the stack — each subsequent branch is parented on the one before it, enabling git-town's automatic retargeting behavior.

---

## 4. PR creation

Each PR is created automatically when the quality gate passes for that phase:

1. Runs `npm run test --workspaces --if-present` — PR creation is blocked if tests fail
2. Runs `git town propose` with:
   - Title: `feat(<trd-slug>): PR N — <phase-title>`
   - Body includes the Shippable State, strategy, task IDs, coverage percentage, and bead ID

Targeting:

- PR 1 targets `main`
- PR 2 targets `feature/<slug>-pr-1`
- PR 3 targets `feature/<slug>-pr-2`

---

## 5. Merging the stack

Merge in order — never skip a PR in the stack:

1. **Review and merge PR 1** (it targets `main`)
2. After PR 1 merges, **git-town automatically retargets PR 2** from `feature/<slug>-pr-1` to `main`
3. **Review and merge PR 2** (now targets `main`)
4. Repeat for all remaining PRs

The retargeting is handled by git-town's parent-tracking system. No manual action is needed between merges.

After all PRs merge, archive the TRD and flush the bead state:

```bash
mv docs/TRD/my-trd.md docs/TRD/completed/
br sync --flush-only && git add .beads/ && git commit -m 'chore: final beads sync'
```

---

## 6. Cross-session resume

The bead hierarchy persists across sessions. On any subsequent invocation:

- Resume is detected via `br list --json` (finds the root epic bead)
- The scaffold phase is skipped automatically
- The staleness gate is also skipped on resume (it only runs on first invocation)
- Execution picks up from where it left off

To check status at any time:

```bash
/ensemble:implement-trd-beads docs/TRD/my-trd.md --status
# or
br list --status=in_progress
```

---

## 7. Checking progress

```bash
# TRD-scoped progress
/ensemble:implement-trd-beads docs/TRD/my-trd.md --status

# Raw bead state
br list --status=open
br list --status=in_progress

# BV graph analysis (if bv installed)
bv --robot-triage --format toon
```

---

## 8. Common mistakes and fixes

### Mistake 1 — `### PR` headings in the wrong section

```
Wrong: ### PR headings appear in ## Sprint Planning
Right: ### PR headings are only in ## Master Task List
```

The detector scopes to the Master Task List section only. Headings elsewhere are silently ignored, meaning those phases will never be picked up for branch or PR creation.

### Mistake 2 — Missing Shippable State

```
Wrong:
  ### PR 1: Build scaffolding
  - [ ] **TRD-001**: ...

Right:
  ### PR 1: Build scaffolding
  **Shippable State:** Users can create and manage projects.
  - [ ] **TRD-001**: ...
```

A missing or infrastructure-only Shippable State will be flagged by `/ensemble:refine-trd`. Fix it in the TRD before running `implement-trd-beads`.

### Mistake 3 — Merging out of order

```
Wrong: Merge PR 2 before PR 1 merges
Right: Always merge bottom-up: PR 1 → PR 2 → PR 3
```

Merging out of order causes unexpected merge conflicts and breaks the retargeting chain. git-town's parent tracking assumes each branch is merged into its parent before the child is merged.

### Mistake 4 — Running without git-town

When git-town is unavailable, `implement-trd-beads` falls back to `git switch -c` for branch creation. This creates branches but does not establish git-town's parent tracking, so:

- PRs will not retarget automatically after merges
- You will need to manually update each PR's base branch after the parent merges

Install git-town to get the full stacked PR experience: https://www.git-town.com

### Mistake 5 — Tests failing at PR creation time

```
ERROR: Local tests failed — PR creation blocked.
Fix failing tests and re-run the quality gate to retry.
```

The pre-PR test gate runs `npm run test --workspaces --if-present` before every `git town propose`. Fix the failing tests, then re-run:

```bash
/ensemble:implement-trd-beads docs/TRD/my-trd.md --execute
```

The bead state is preserved — execution resumes from the failed quality gate.

### Mistake 6 — TRD staleness blocks first invocation

```
STALENESS GATE: TRD is 36h old (threshold: 24h). Running /ensemble:refine-trd...
```

The staleness gate fires on first invocation only, before the feature branch is created. Either wait for `/ensemble:refine-trd` to complete, or run it manually first:

```bash
/ensemble:refine-trd docs/TRD/my-trd.md
/ensemble:implement-trd-beads docs/TRD/my-trd.md
```

---

## 9. Syncing your local branches with remote

If you need to sync the local stack with remote after changes:

```bash
git town sync
```

This updates all branches in the stack from their parents. Run this before resuming implementation if you have merged PRs or pushed changes directly to main since the last session.

---

## 10. Legacy format (Phase/Sprint headings)

TRDs using `### Phase N:` or `### Sprint N:` headings instead of `### PR N:` still work — they produce a single feature branch per phase instead of a stacked PR chain.

To upgrade a legacy TRD to PR-stack mode:

```bash
/ensemble:refine-trd docs/TRD/my-trd.md
```

The refine workflow will offer to convert Phase/Sprint headings to PR headings with Shippable State annotations. No migration is required if you prefer to keep the legacy format — it continues to work without modification.
