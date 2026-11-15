# Agent Instructions

## Wiki

The ensemble repo has a GitHub wiki at `https://github.com/Sunstone-Partners/ensemble.wiki.git` (separate repo, branch `master`). Verify with `gh repo view Sunstone-Partners/ensemble --json hasWikiEnabled` before assuming the wiki does or does not exist — do not infer from the absence of a wiki remote on the main repo.

- **Drafts** are staged at `.wiki-staging/` at the repo root (gitignored via `.git/info/exclude`; local-only).
- **Publish** via `scripts/wiki-publish.sh`. Handles add/update/sidebar cases with diff gates, idempotent, replays as no-op when wiki is already in the desired state. Run with `--yes` for non-interactive. See header comments in the script for the full contract.

## Worktrees and scratch files: never under `/tmp`

`/tmp` is wiped on reboot, so unpushed work left there is lost.

- **Never** create a git worktree, clone or branch checkout under `/tmp` (including `/private/tmp`, `$TMPDIR` and `mktemp -d`).
- Create worktrees as **siblings of the main checkout**, named `<repo>.<purpose>` (for example `~/Development/Sunstone/ensemble.<purpose>`): `git worktree add -b <branch> <that path> origin/<base>`.
- Put non-worktree scratch (patches, findings, PR bodies, logs, snapshots) under `~/.omp/<task-dir>/`, never `/tmp`.
- When delegating to a subagent, give it the persistent path explicitly; do not let it choose a temp directory.
- Remove a worktree only after its work is merged or saved, and say so when you do.

## Generated Artifact Policy

- Edit source files, not generated artifacts.
- When a file says `DO NOT EDIT - Generated from ...`, treat the referenced source file as authoritative and make the change there.
- For command/agent/skill markdown generated from YAML or other sources, update the source file first, then run the repo's documented generation step so derived artifacts stay in sync.
- Only touch generated artifacts directly when the user explicitly asks for that generated file itself to be edited or when no source file exists.

## Agent Instructions

- When you need to get feedback and/or ask me a question *always* use the 'ask' tool.

## Beads Workflow Integration

This project uses [beads_rust](https://github.com/Dicklesworthstone/beads_rust) (`br`) for issue tracking and [beads_viewer](https://github.com/Dicklesworthstone/beads_viewer) (`bv`) for graph-aware triage. Issues are stored in `.beads/` and tracked in git. Current `br` workspaces normally export `.beads/issues.jsonl`; older `bd`/legacy workspaces may use `.beads/beads.jsonl`. `bv` auto-discovers the supported JSONL files, so agents should use `br`/`bv` commands instead of hard-coding a single filename.

### Using bv as an AI sidecar

bv is a graph-aware triage engine for Beads projects. Instead of parsing .beads/issues.jsonl / .beads/beads.jsonl directly or hallucinating graph traversal, use robot flags for deterministic, dependency-aware outputs with precomputed metrics (PageRank, betweenness, critical path, cycles, HITS, eigenvector, k-core).

**Scope boundary:** bv handles *what to work on* (triage, priority, planning). `br` handles creating, modifying, and closing beads.

**CRITICAL: Use ONLY --robot-* flags. Bare bv launches an interactive TUI that blocks your session.**

#### The Workflow: Start With Triage

**`bv --robot-triage` is the single entry point.** It returns `quick_ref` (counts + top 3 picks), ranked `recommendations`, `quick_wins`, `blockers_to_clear`, `project_health`, and copy-paste `commands`.

```bash
bv --robot-triage        # THE MEGA-COMMAND: start here
bv --robot-next          # Minimal: just the single top pick + claim command
```

Before claiming, verify current state with `br show <id> --json` or `br ready --json`. `recommendations` can include graph-important blocked or assigned work; only `quick_ref.top_picks` and non-empty `claim_command` fields represent claimable work.

#### Other bv Commands

| Command | Returns |
|---------|---------|
| `--robot-plan` | Parallel execution tracks with unblocks lists |
| `--robot-priority` | Priority misalignment detection with confidence |
| `--robot-insights` | Graph metrics (PageRank, critical path, cycles, ...) |
| `--robot-alerts` | Stale issues, blocking cascades |
| `--robot-suggest` | Hygiene: duplicates, missing deps, cycle breaks |
| `--robot-diff --diff-since <ref>` | Changes since ref: new/closed/modified issues |
| `--robot-graph [--graph-format=json\|dot\|mermaid]` | Dependency graph export |

#### Scoping & Filtering

```bash
bv --robot-plan --label backend              # Scope to label's subgraph
bv --robot-insights --as-of HEAD~30          # Historical point-in-time
bv --recipe actionable --robot-plan          # Pre-filter: ready to work (no blockers)
bv --recipe high-impact --robot-triage       # Pre-filter: top PageRank scores
```

### br Commands for Issue Management

```bash
br ready --json                       # Show issues ready to work (no blockers)
br list --status=open --json          # All open issues
br show <id> --json                   # Full issue details with dependencies
br create --title="..." --type=task --priority=2 --json
br update <id> --status=in_progress --json
br close <id> --reason="Completed" --json
br sync --flush-only                  # Export DB to JSONL after Beads mutations
```

### Workflow Pattern

1. **Triage**: Run `bv --robot-triage` to find the highest-impact actionable work
2. **Claim**: Use `br update <id> --status=in_progress --json`
3. **Work**: Implement the task
4. **Complete**: Use `br close <id> --reason="Completed" --json`
5. **Sync**: Run `br sync --flush-only` after Beads mutations so the JSONL export is current

### Key Concepts

- **Dependencies**: Issues can block other issues. `br ready --json` shows only unblocked work.
- **Priority**: P0=critical, P1=high, P2=medium, P3=low, P4=backlog (use numbers 0-4, not words)
- **Types**: task, bug, feature, epic, chore, docs, question
- **Blocking**: `br dep add <issue> <depends-on>` to add dependencies

### Git Policy

`br` never commits or pushes. Beads mutations require `br sync --flush-only` so the JSONL export is current. Commit and push only when the user asks; this overrides any generic "commit/push at session end" advice.

<!-- end-bv-agent-instructions -->
