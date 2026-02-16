---
name: jj-vcs
description: This skill should be used when the user asks to "create a stacked PR", "stack changes", "create a change stack", "submit stacked PRs", "use jj", "use jujutsu", "init jj on git repo", "colocate jj", "rebase my stack", "edit a mid-stack change", "squash into parent", "split a change", "push my bookmarks", "sync with remote using jj", "handle jj conflicts", "view jj log", "create a bookmark", "move a bookmark", "abandon a change", "propose with git-town", "ship with git-town", or mentions jj commands (jj new, jj edit, jj rebase, jj bookmark, jj git push, jj git fetch, jj describe, jj squash, jj split, jj log, jj status, jj diff, jj abandon, jj resolve, jj undo) or git-town commands in jj context (git-town propose, git-town ship, git-town sync, git-town hack).
version: 1.0.0
---

# Jujutsu (jj) + Git-Town Stacked PR Workflow Skill

**Skill Type**: Technical Workflow
**Estimated Learning Time**: 30 minutes
**Proficiency Levels**: Beginner, Intermediate, Advanced

---

## Mission

Provide comprehensive Jujutsu (jj) + Git-Town stacked PR workflow integration for Claude Code agents. This skill combines jj's superior local change management (automatic descendant rebasing, stable change IDs, first-class conflicts) with git-town's proven remote workflow automation (propose, ship, sync, parent tracking). The tool chain is:

```
jj (local changes) → git-town (remote workflow) → git (transport)
```

- **jj** handles: creating changes, editing mid-stack, rebasing, squashing, splitting, conflict recording
- **git-town** handles: PR creation (propose), merge & cleanup (ship), remote sync, branch parent tracking
- **git** is the underlying transport: jj bookmarks map to git branches, which git-town manages

Target audience includes orchestrator agents and developer agents performing stacked feature development. Key capabilities include automatic descendant rebasing when mid-stack changes are edited, stable change IDs that survive rebasing, git-town's non-interactive propose/ship/sync commands, and optional jj-stack (jst) integration for fully automated PR graph management.

---

## Skill Loading Mechanism

### Discovery Paths

jj-vcs skill files are located using XDG Base Directory Specification with the following search priority:

1. **Primary**: `$XDG_CONFIG_HOME/ensemble/skills/jj-vcs/` (user-specific configuration)
2. **Fallback**: `~/.config/ensemble/skills/jj-vcs/` (default XDG location)
3. **Legacy**: `~/.ensemble/skills/jj-vcs/` (backward compatibility)
4. **Plugin**: `<plugin-root>/packages/git/skills/jj-vcs/` (bundled with ensemble-git plugin)

### Loading Performance

- **Target**: <100ms for full skill load (SKILL.md + REFERENCE.md + ERROR_HANDLING.md combined)
- **Caching**: Skill content is cached in agent context memory after first load, with cache invalidation triggered by file modification timestamps
- **Lazy loading**: Templates and guides are loaded on-demand only when agents query specific sections

### Integration Patterns

```yaml
---
name: git-workflow
skills:
  - jj-vcs:SKILL
  - jj-vcs:REFERENCE
  - jj-vcs:ERROR_HANDLING
  - git-town:SKILL          # Companion skill for git-town details
---
```

---

## Quick Start

### Prerequisites

Before using the jj + git-town workflow, ensure the following:

- **jj**: Version 0.25.0 or higher installed and in PATH
- **git-town**: Version 14.0.0 or higher installed and configured
- **gh CLI**: GitHub CLI installed and authenticated (used by git-town propose)
- **Colocated repo**: Repository initialized with `jj git init --colocate`

### Validation

```bash
bash ./scripts/validate-jj-vcs.sh
```

**Exit codes:**
- `0`: All checks passed
- `1`: jj not installed
- `2`: Not a jj repository (run `jj git init --colocate`)
- `3`: jj version < 0.25.0
- `4`: Not in a git repository
- `5`: gh CLI not installed or not authenticated
- `6`: git-town not installed or not configured

### Tool Chain Overview

```
┌─────────────────────────────────────────────────────────┐
│                    LOCAL (jj)                            │
│  jj new → jj edit → jj rebase → jj squash → jj split   │
│  Change management, stack building, mid-stack edits     │
│  Bookmarks ↔ git branches (colocated)                   │
└───────────────────────┬─────────────────────────────────┘
                        │ jj git push / jj bookmark
                        ▼
┌─────────────────────────────────────────────────────────┐
│                 REMOTE WORKFLOW (git-town)               │
│  propose → ship → sync                                  │
│  PR creation, merge & cleanup, remote synchronization   │
│  Parent tracking (branch hierarchy)                     │
└───────────────────────┬─────────────────────────────────┘
                        │ git push / git fetch
                        ▼
┌─────────────────────────────────────────────────────────┐
│                  TRANSPORT (git)                         │
│  Underlying VCS, CI/CD integration, GitHub hosting      │
└─────────────────────────────────────────────────────────┘
```

### Basic Workflow

1. **Initialize jj on existing git repo**:
   ```bash
   jj git init --colocate
   git town config set-main-branch main
   ```

2. **Create a stack of changes** (jj):
   ```bash
   jj new main -m "feat: first change in stack"
   # ... make edits ...
   jj new -m "feat: second change in stack"
   # ... make edits ...
   ```

3. **Assign bookmarks and configure git-town parents**:
   ```bash
   jj bookmark create stack-1-auth-refactor -r <change-id-1>
   jj bookmark create stack-2-auth-frontend -r <change-id-2>
   jj git push -b "glob:stack-*" --allow-new

   # Tell git-town about the branch hierarchy
   git town config set-parent stack-1-auth-refactor main
   git town config set-parent stack-2-auth-frontend stack-1-auth-refactor
   ```

4. **Create stacked PRs** (git-town):
   ```bash
   git checkout stack-1-auth-refactor
   git-town propose --title "refactor: Extract auth service" --body "First in stack."

   git checkout stack-2-auth-frontend
   git-town propose --title "feat: Auth frontend" --body "Second in stack."
   ```

5. **Ship after approval** (git-town):
   ```bash
   git checkout stack-1-auth-refactor
   git-town ship
   # git-town merges to main, deletes branch, updates children
   ```

### Core Concepts

- **Working copy as a commit**: In jj, your working copy IS a commit. No staging area.
- **Change IDs vs Commit IDs**: Change IDs (e.g., `kpqxywon`) are stable across rebases. Always use these.
- **Bookmarks → git branches**: jj bookmarks map to git branches in colocated repos. git-town manages these branches.
- **git-town parent tracking**: git-town tracks parent-child relationships between branches, enabling correct PR base targeting and bottom-up shipping.
- **Revsets**: jj's query language for selecting revisions (e.g., `trunk()..@`).

---

## Common Workflows

### Workflow 1: Initialize jj + git-town on Existing Repo

```bash
# Navigate to existing git repo
cd /path/to/your/repo

# Initialize jj in colocated mode
jj git init --colocate

# Configure git-town
git town config set-main-branch main

# Verify both tools
jj log --limit 3
git town config
```

### Workflow 2: Create a Stack of Changes (jj)

```bash
# Start from main
jj new main -m "refactor: extract auth service"
# ... make changes ...

jj new -m "feat: add OAuth provider support"
# ... implement OAuth ...

jj new -m "test: add auth integration tests"
# ... write tests ...

# View the stack
jj log -r "trunk()..@"
```

### Workflow 3: Bridge to git-town (Bookmarks + Parent Config)

After creating your stack with jj, bridge to git-town:

```bash
# Get change IDs
jj log -r "trunk()..@" -T 'change_id.short() ++ " " ++ description.first_line() ++ "\n"' --no-graph

# Create bookmarks (naming convention: stack-N-description)
jj bookmark create stack-1-auth-refactor -r <change-id-1>
jj bookmark create stack-2-auth-oauth -r <change-id-2>
jj bookmark create stack-3-auth-tests -r <change-id-3>

# Push bookmarks as git branches
jj git push -b "glob:stack-*" --allow-new

# Configure git-town parent relationships
git town config set-parent stack-1-auth-refactor main
git town config set-parent stack-2-auth-oauth stack-1-auth-refactor
git town config set-parent stack-3-auth-tests stack-2-auth-oauth
```

### Workflow 4: Create Stacked PRs (git-town propose)

```bash
# PR 1: targets main (git-town knows the parent)
git checkout stack-1-auth-refactor
git-town propose --title "refactor: Extract auth service" --body "Part 1 of 3."

# PR 2: targets stack-1 (git-town knows the parent)
git checkout stack-2-auth-oauth
git-town propose --title "feat: Add OAuth support" --body "Part 2 of 3."

# PR 3: targets stack-2
git checkout stack-3-auth-tests
git-town propose --title "test: Add auth tests" --body "Part 3 of 3."

# Return to jj working state
jj new
```

**Why git-town propose?** git-town automatically targets the correct parent branch, handles the gh CLI invocation, and tracks the PR relationship.

### Workflow 5: Edit a Mid-Stack Change (jj)

```bash
# Edit the second change in the stack
jj edit <change-id-2>

# Make your fixes (descendants auto-rebase!)
# ... edit files ...

# Push updated branches
jj git push -b "glob:stack-*"

# PRs on GitHub automatically show updated diffs
```

**Why jj for editing?** jj automatically rebases ALL descendants when you modify a mid-stack change. No manual rebase needed.

### Workflow 6: Ship a Merged PR (git-town ship)

```bash
# Switch to the bottom branch
git checkout stack-1-auth-refactor

# Ship it (merges to main, cleans up branch)
git-town ship

# Fetch and rebase remaining stack with jj
jj git fetch
jj rebase -b <change-id-2> -d main

# Update git-town parent for next branch
git town config set-parent stack-2-auth-oauth main

# Update bookmark positions after rebase
jj bookmark set stack-2-auth-oauth -r <change-id-2>
jj bookmark set stack-3-auth-tests -r <change-id-3>

# Push updated state
jj git push -b "glob:stack-*"

# Clean up shipped bookmark
jj bookmark delete stack-1-auth-refactor
```

### Workflow 7: Sync with Remote (git-town + jj)

```bash
# Option A: git-town sync (for the current branch)
git checkout stack-2-auth-oauth
git-town sync

# Option B: jj-first approach (for the entire stack)
jj git fetch
jj rebase -b <stack-root-change-id> -d main
jj git push -b "glob:stack-*"
```

**When to use which:**
- `git-town sync`: When working on a single branch and want git-town to handle remote sync
- `jj git fetch` + `jj rebase`: When updating the entire stack at once (recommended for stacked workflows)

---

## jj-stack (jst) Integration

### Overview

[jj-stack (jst)](https://github.com/nicholasphair/jj-stack) is an optional companion that automates the bridge between jj and PR management. When available, it replaces manual bookmark assignment and git-town propose steps.

### When to Use What

| Scenario | Tool |
|----------|------|
| Local change management | jj (always) |
| Simple 1-2 change stack | git-town propose |
| Large stack (3+), frequent updates | jst submit |
| Merge and cleanup | git-town ship |
| Remote sync | git-town sync or jj git fetch + rebase |

### Workflow with jst

```bash
# Create stack with jj (same as always)
jj new main -m "feat: first change"
jj new -m "feat: second change"

# jst handles bookmarks + push + PRs automatically
jst submit

# After review, edit mid-stack (jj)
jj edit <change-id>
# ... fixes ...
jst submit  # Updates PRs

# Ship with git-town
git checkout <bottom-branch>
git-town ship
```

### Graceful Fallback

```bash
if command -v jst &> /dev/null; then
    jst submit
else
    # Manual: bookmarks + push + git-town propose
    jj bookmark create stack-1-name -r <change-id>
    jj git push -b stack-1-name --allow-new
    git town config set-parent stack-1-name main
    git checkout stack-1-name
    git-town propose --title "..."
fi
```

---

## Context7 Integration (Recommended)

**For up-to-date documentation**, use Context7 MCP for both jj and git-town.

### Query Patterns

```javascript
const { createLibraryHelper } = require('@fortium/ensemble-core');

// jj documentation
const jj = createLibraryHelper('jujutsu');
await jj.fetchDocs('jj new command', 3000);
await jj.fetchDocs('revsets', 3000);

// git-town documentation
const gitTown = createLibraryHelper('git-town');
await gitTown.fetchDocs('propose command', 3000);
await gitTown.fetchDocs('ship command', 3000);
```

---

## Troubleshooting

### jj and git-town Working Copy Conflicts

**Symptom**: After `git checkout` for git-town, jj shows unexpected state.

**Resolution**: In colocated repos, `git checkout` and jj's working copy are synchronized. After git-town operations, return to jj context:
```bash
# After git-town propose/ship
jj new  # or jj edit <change-id>
```

### git-town Doesn't Know Branch Parents

**Symptom**: `git-town propose` targets wrong base branch.

**Resolution**: Configure parents explicitly:
```bash
git town config set-parent stack-2-name stack-1-name
# Verify
git town config get-parent  # while on stack-2-name
```

### Bookmarks Out of Sync After jj Rebase

**Symptom**: After `jj rebase`, bookmarks still point to old commits.

**Resolution**: Bookmarks track changes, not commits. After rebase, push to update remote:
```bash
jj git push -b "glob:stack-*"
```

### git-town sync Conflicts with jj

**Symptom**: `git-town sync` produces unexpected state in jj.

**Resolution**: For stacked workflows, prefer jj-first sync:
```bash
jj git fetch
jj rebase -b <stack-root> -d main
jj git push -b "glob:stack-*"
```

Use `git-town sync` only for single-branch operations.

---

## References

- **Full command documentation**: [REFERENCE.md](./REFERENCE.md) - jj + git-town command reference
- **Error handling workflows**: [ERROR_HANDLING.md](./ERROR_HANDLING.md) - Error recovery procedures
- **Interview templates**: [templates/](./templates/) - Question-answer workflows for agent interviews
- **Migration guide**: [guides/onboarding.md](./guides/onboarding.md) - Migration from git/git-town-only to jj+git-town
- **jj documentation**: https://jj-vcs.github.io/jj/latest/
- **git-town documentation**: https://www.git-town.com/
- **jj-stack (jst)**: https://github.com/nicholasphair/jj-stack
