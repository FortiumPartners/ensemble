# Migrating to jj + Git-Town for Stacked PR Workflows

> Get started with jj (local) + git-town (remote) on your existing Git repo in 15 minutes
>
> **Tool chain**: `jj (local changes) → git-town (remote workflow) → git (transport)`

## Prerequisites

Before starting, ensure you have:
- Git installed (`git --version` >= 2.30)
- git-town installed (`git-town --version` >= 14.0.0)
- Command line access (Terminal, PowerShell, Git Bash)
- Existing git repository
- GitHub CLI authenticated (`gh auth status`)
- Basic git knowledge (commit, push, pull, branch)

---

## Installation

### macOS (Homebrew)
```bash
brew install jj
```

### Linux (Cargo)
```bash
cargo install --locked --bin jj jj-cli
```

### Linux (Binary)
```bash
curl -L https://github.com/jj-vcs/jj/releases/latest/download/jj-x86_64-unknown-linux-musl.tar.gz | tar xz
sudo mv jj /usr/local/bin/
```

### Windows (Cargo)
```bash
cargo install --locked --bin jj jj-cli
```

### Verify Installation
```bash
jj --version
# Expected: jj 0.25.0 or higher
```

---

## Initialize jj on Your Git Repo

### Step 1: Navigate to Your Repository
```bash
cd /path/to/your/project
git status  # Verify you're in a git repository
```

### Step 2: Initialize jj in Colocated Mode
```bash
jj git init --colocate
```

This creates a `.jj/` directory alongside your existing `.git/`. Both systems work together:
- jj manages your working copy and change history
- git-town manages remote workflow (propose, ship, sync)
- Git remains the transport layer (push, pull, CI)
- Your team can continue using git; they won't notice jj

### Step 3: Configure git-town
```bash
git town config set-main-branch main
```

### Step 4: Verify
```bash
jj log --limit 5          # Should show git history
git town config            # Should show main branch
```

---

## Key Differences from Git

### Working Copy Is a Commit

In git, you stage changes and commit. In jj, your working copy IS a commit:

| Git | jj |
|-----|-----|
| Edit files | Edit files |
| `git add .` | (automatic) |
| `git commit -m "msg"` | `jj describe -m "msg"` |
| Changes can be "unstaged" | All changes are always tracked |

### Change IDs Are Stable

In git, commit hashes change when you rebase. In jj, change IDs are stable:

```
Git:  abc1234 -> rebase -> def5678 (different hash!)
jj:   kpqxywon -> rebase -> kpqxywon (same change ID!)
```

This means you can always refer to a change by its ID, even after rebasing.

### No Staging Area

There is no `git add` equivalent. Every file modification is part of the current change:

```bash
# In jj, just edit files. They're automatically part of the current change.
echo "new code" >> src/main.rs
jj status  # Shows the change immediately
```

### Conflicts Don't Block

In git, a rebase stops when it hits a conflict. In jj, conflicts are recorded and you can resolve them later:

```bash
jj rebase -b @ -d main
# Even with conflicts, this completes!
# Conflicts are recorded in the change tree
jj log  # Shows which changes have conflicts
jj resolve  # Fix them when ready
```

---

## Your First Stack

### Step 1: Create the First Change

```bash
# Start from main
jj new main -m "refactor: extract auth service"
```

This creates a new change (like a commit) as a child of `main`.

### Step 2: Make Edits

```bash
# Edit your files normally
# All changes are automatically tracked
```

### Step 3: Stack More Changes

```bash
# Create the next change in the stack
jj new -m "feat: add OAuth support"
# Edit more files...

jj new -m "test: add auth tests"
# Edit more files...
```

### Step 4: View Your Stack

```bash
jj log -r "trunk()..@"
# Shows all changes between main and your working copy
```

### Step 5: Assign Bookmarks

Bookmarks are how jj maps changes to git branches:

```bash
# Get change IDs from the log
jj log -r "trunk()..@" -T 'change_id.short() ++ " " ++ description.first_line() ++ "\n"' --no-graph

# Create bookmarks (replace with your actual change IDs)
jj bookmark create stack-1-auth-refactor -r <change-id-1>
jj bookmark create stack-2-oauth-support -r <change-id-2>
jj bookmark create stack-3-auth-tests -r <change-id-3>
```

### Step 6: Push, Configure git-town, and Create PRs

```bash
# Push all stack bookmarks to remote
jj git push -b "glob:stack-*" --allow-new

# Configure git-town parent relationships
git town config set-parent stack-1-auth-refactor main
git town config set-parent stack-2-oauth-support stack-1-auth-refactor
git town config set-parent stack-3-auth-tests stack-2-oauth-support

# Create PRs using git-town (auto-targets correct parent branch)
git checkout stack-1-auth-refactor
git-town propose --title "refactor: Extract auth service"

git checkout stack-2-oauth-support
git-town propose --title "feat: Add OAuth support"

git checkout stack-3-auth-tests
git-town propose --title "test: Add auth tests"

# Return to jj working state
jj new
```

---

## Common Operations

### Edit a Mid-Stack Change

This is jj's killer feature. Edit any change in the stack and descendants rebase automatically:

```bash
# Edit the second change
jj edit <change-id-2>

# Make your fixes...
# All changes below (change-3, etc.) automatically rebase

# Return to top of stack
jj new  # Or: jj edit <top-change-id>
```

### Update PRs After Changes

```bash
# After editing any change in the stack
jj git push -b "glob:stack-*"
# PRs on GitHub automatically show updated diffs
```

### Handle a Merged PR

When the bottom PR gets merged, use git-town ship + jj rebase:

```bash
# Ship the bottom branch with git-town
git checkout stack-1-auth-refactor
git-town ship

# Rebase remaining stack with jj
jj git fetch
jj rebase -b <second-change-id> -d main

# Update git-town parent for next branch
git town config set-parent stack-2-oauth-support main

# Push updated state
jj git push -b "glob:stack-*"

# Clean up shipped bookmark
jj bookmark delete stack-1-auth-refactor
```

### Sync with Remote

```bash
# Fetch latest changes
jj git fetch

# Rebase stack onto main
jj rebase -b <stack-root-id> -d main

# Push updates
jj git push -b "glob:stack-*"
```

### Undo Any Operation

```bash
# Undo the last jj operation (any operation!)
jj undo

# View operation history
jj op log
```

---

## Migrating from Git-Town Only

If you're currently using git-town alone, here's what changes with jj + git-town:

| git-town only | jj + git-town |
|---------------|---------------|
| `git-town hack feature` | `jj new main -m "feat: feature"` (jj) |
| `git add && git commit` | Files auto-tracked; `jj describe -m "..."` (jj) |
| `git-town sync` | `jj git fetch && jj rebase -b @ -d main` (jj) |
| `git-town propose` | `jj git push` → `git-town propose` (both) |
| `git-town ship` | `git-town ship` → `jj git fetch` → `jj rebase` (both) |
| `git-town continue` | Conflicts don't block in jj |
| `git-town undo` | `jj undo` for local, `git-town undo` for remote |
| Interactive rebase to edit history | `jj edit <change-id>` — descendants auto-rebase |

### Key Improvements with jj + git-town

1. **Automatic descendant rebasing**: Edit any change with `jj edit`; descendants update automatically
2. **Stable change IDs**: No hash invalidation after rebase
3. **Non-blocking conflicts**: jj records conflicts without blocking operations
4. **No staging area**: All changes are always tracked by jj
5. **Operation history**: Full undo/redo for every jj operation
6. **git-town still handles remote**: `propose`, `ship`, and parent tracking work as before

---

## Migrating from Plain Git

If you're using plain git branches for stacked PRs:

| git | jj + git-town |
|-----|---------------|
| `git checkout -b feature main` | `jj new main -m "feat: feature"` (jj) |
| `git add . && git commit` | Files tracked automatically; `jj describe -m "..."` (jj) |
| `git rebase main` | `jj rebase -b @ -d main` (jj) |
| `git push -u origin feature` | `jj bookmark create name && jj git push -b name` (jj) |
| `gh pr create --base parent` | `git town config set-parent` → `git-town propose` (git-town) |
| Manually merge + delete branch | `git-town ship` (git-town) |
| `git rebase -i` (reorder/squash) | `jj rebase -r`, `jj squash`, `jj split` (jj) |
| Manual conflict resolution during rebase | Conflicts recorded; resolve at convenience (jj) |
| Commit hashes change on rebase | Change IDs stable forever (jj) |

---

## Tips and Best Practices

### 1. Always Use Change IDs, Not Commit Hashes

```bash
# Good: stable reference
jj edit kpqxywon

# Bad: changes after rebase
jj edit abc1234def
```

### 2. Use the `stack-N-description` Bookmark Convention

This enables batch operations:
```bash
jj git push -b "glob:stack-*"  # Push all at once
jj bookmark list "glob:stack-*"  # List all at once
```

### 3. Check Stack Health Before Pushing

```bash
# Check for conflicts
jj log -r "trunk()..@ & conflicts()"

# Check for empty changes
jj log -r "trunk()..@ & empty()"
```

### 4. Fetch Before Rebase

```bash
jj git fetch
jj rebase -b <stack-root> -d main
```

### 5. Use jj undo Liberally

Every jj operation can be undone. Don't be afraid to experiment:
```bash
jj undo  # Takes you back to before the last operation
jj op log  # See what operations you can undo
```

---

## Validation

Run the validation script to verify your setup:

```bash
bash packages/git/skills/jj-vcs/scripts/validate-jj-vcs.sh
```

Expected output:
```
ℹ Platform detected: macos

✓ jj is installed
✓ jj version 0.25.0 meets minimum requirements
✓ Current directory is a git repository
✓ Current directory is a jj repository (colocated)
✓ GitHub CLI (gh) is installed and authenticated
✓ git-town version 17.0.0 meets minimum requirements
✓ git-town is configured (main branch: main)

ℹ jj-stack (jst) is not installed (optional)

✓ All validation checks passed!
ℹ Tool chain: jj -> git-town -> git
```

---

## Next Steps

1. Read [SKILL.md](../SKILL.md) for common workflow patterns
2. Read [REFERENCE.md](../REFERENCE.md) for command reference and revsets
3. Read [ERROR_HANDLING.md](../ERROR_HANDLING.md) for error recovery patterns
4. Try creating a small stack on a test branch
5. Consider installing [jj-stack (jst)](https://github.com/nicholasphair/jj-stack) for automated PR management

---

*Last updated: 2026-02-06*
*jj-vcs onboarding guide v1.0.0*
