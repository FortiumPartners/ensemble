# Git-Town Onboarding Guide

> Get started with git-town for feature branch workflows in 15 minutes

## Prerequisites

Before starting, ensure you have:
- ✅ Git installed (`git --version` ≥ 2.30)
- ✅ Command line access (Terminal, PowerShell, Git Bash)
- ✅ Existing git repository or ability to create one
- ✅ Basic git knowledge (clone, commit, push, pull)

---

## Installation

### macOS (Homebrew)
```bash
brew install git-town
```

### Linux (apt)
```bash
# Ubuntu/Debian
sudo add-apt-repository ppa:git-town/git-town
sudo apt update
sudo apt install git-town
```

### Linux (yum/dnf)
```bash
# Fedora/RHEL/CentOS
sudo dnf install git-town
```

### Windows (Scoop)
```bash
scoop install git-town
```

### From Source
```bash
# Install latest release
curl -L https://github.com/git-town/git-town/releases/latest/download/git-town-linux-amd64.tar.gz | tar xz
sudo mv git-town /usr/local/bin/
```

### Verify Installation
```bash
git town --version
# Expected: Git Town 14.0.0 or higher
```

---

## Initial Configuration

### Step 1: Navigate to Your Repository
```bash
cd /path/to/your/project
git status  # Verify you're in a git repository
```

### Step 2: Configure Main Branch
```bash
# Set your main development branch
git town config git-town.main-branch main

# Or if you use 'master', 'develop', etc.
git town config git-town.main-branch master
```

### Step 3: Configure Perennial Branches (Optional)
```bash
# Add long-lived branches that shouldn't be deleted
git town config git-town.perennial-branches "develop staging production"

# Or if you only have main:
git town config git-town.perennial-branches ""
```

### Step 4: Verify Configuration
```bash
git town config
# Should show:
# Main branch: main
# Perennial branches: (your list or empty)
# Push new branches: true
```

---

## Your First Feature

### Workflow Overview
```
1. Create feature branch  → git town hack feature/my-feature
2. Make commits           → git add . && git commit -m "message"
3. Sync with main         → git town sync
4. Create pull request    → git town propose
5. Merge & cleanup        → git town ship
```

### Step-by-Step Walkthrough

#### 1. Create Feature Branch
```bash
# Start new feature from main
git town hack feature/add-user-login

# Result:
# - Creates 'feature/add-user-login' from main
# - Checks out new branch
# - Pushes to remote (if configured)

# Verify:
git branch
# * feature/add-user-login
#   main
```

#### 2. Make Changes
```bash
# Edit files
echo "// User login implementation" > src/login.js

# Commit changes
git add src/login.js
git commit -m "feat: add user login form"

# Make more commits as needed
git commit -m "feat: add login validation"
git commit -m "test: add login form tests"
```

#### 3. Sync with Main
```bash
# Sync feature branch with latest main
git town sync

# What it does:
# - Fetches latest from remote
# - Rebases/merges main into your feature branch
# - Pushes updated branch to remote
```

#### 4. Create Pull Request
```bash
# Create PR (requires GitHub CLI: gh)
git town propose

# Or with explicit title/body:
git town propose \
  --title "Add user login feature" \
  --body "Implements user authentication with validation"

# Result:
# - Creates pull request on GitHub
# - Opens PR URL in browser
```

#### 5. Ship the Feature
```bash
# After PR approval, merge and cleanup
git town ship

# What it does:
# - Squash-merges to main
# - Deletes feature branch locally
# - Deletes feature branch on remote
# - Checks out main branch
```

---

## Common Patterns

### Pattern 1: Fix Merge Conflicts
```bash
# During sync, conflicts may occur
git town sync
# Error: merge conflicts detected

# Resolve conflicts in your editor
# Then mark as resolved:
git add <resolved-files>

# Continue the sync:
git town continue

# Or abort if needed:
git town undo
```

### Pattern 2: Sync Before PR
```bash
# Always sync before creating PR
git town sync  # Update with latest main
git town propose  # Create PR
```

### Pattern 3: Work on Multiple Features
```bash
# Feature 1
git town hack feature/user-auth
# ... make commits ...
git push

# Switch to Feature 2
git town hack feature/payment-gateway
# ... make commits ...
git push

# Sync all features at once
git town sync --all
```

### Pattern 4: Prototype Branch
```bash
# Create throwaway prototype branch
git town hack proto/experiment

# Work on experiment
# ... make commits ...

# Delete without merging (prototypes are never shipped)
git checkout main
git branch -D proto/experiment
git push origin --delete proto/experiment
```

### Pattern 5: Stacked Features
```bash
# Create base feature
git town hack feature/refactor-api

# Make commits to base feature
git commit -m "refactor: extract API client"

# Create feature that depends on refactor
git town append feature/add-endpoints

# Now you have:
# main → feature/refactor-api → feature/add-endpoints

# Ship from bottom to top:
git checkout feature/refactor-api
git town ship  # Merges refactor to main

git checkout feature/add-endpoints
git town sync  # Updates parent reference to main
git town ship  # Merges endpoints to main
```

---

## Team Configuration

### Shared Team Setup

Create `.git-town.toml` in repository root (committed):
```toml
[git-town]
main-branch = "main"
perennial-branches = ["develop", "staging"]
push-new-branches = true
ship-delete-remote-branch = true
```

Team members run once after clone:
```bash
git clone <repository-url>
cd <repository>
git town config --import .git-town.toml
```

### CI/CD Integration

**GitHub Actions Example:**
```yaml
name: Feature Branch CI
on:
  push:
    branches-ignore:
      - main
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - name: Run tests
        run: npm test
      - name: Auto-sync on main changes
        run: |
          git town sync
```

---

## Common Mistakes

### ❌ Mistake 1: Forgetting to Sync
```bash
# BAD: Create PR without syncing
git town hack feature/my-feature
# ... make commits ...
git town propose  # May have conflicts later
```

**✅ Fix: Always sync before PR**
```bash
git town hack feature/my-feature
# ... make commits ...
git town sync  # Update with latest main
git town propose  # Create PR
```

### ❌ Mistake 2: Manual Merge Instead of Ship
```bash
# BAD: Manual merge doesn't clean up branches
git checkout main
git merge feature/my-feature
git push
# Branch still exists locally and remotely
```

**✅ Fix: Use git town ship**
```bash
git checkout feature/my-feature
git town ship  # Merges + deletes branch
```

### ❌ Mistake 3: Not Configuring Main Branch
```bash
# BAD: Git-town doesn't know your main branch
git town hack feature/test
# Error: main branch not configured
```

**✅ Fix: Configure before first use**
```bash
git town config git-town.main-branch main
git town hack feature/test  # Works correctly
```

### ❌ Mistake 4: Using Interactive Mode
```bash
# BAD: Interactive prompts block automation
git town hack  # Prompts for branch name
git town propose  # Prompts for PR details
```

**✅ Fix: Use explicit CLI flags**
```bash
git town hack feature/my-branch
git town propose --title "My Feature" --body "Description"
```

---

## Troubleshooting

### Issue: "git-town: command not found"
```bash
# Check if git-town is installed
which git-town

# If not found, install:
brew install git-town  # macOS
sudo apt install git-town  # Linux
scoop install git-town  # Windows
```

### Issue: "main branch not configured"
```bash
# Configure main branch
git town config git-town.main-branch main

# Verify
git town config
```

### Issue: "merge conflicts during sync"
```bash
# Resolve conflicts in files
# Then:
git add <resolved-files>
git town continue

# Or undo the sync:
git town undo
```

### Issue: "cannot ship - PR not merged"
```bash
# Ship requires PR to be merged first
# Merge PR on GitHub, then:
git town ship
```

### Issue: "uncommitted changes"
```bash
# Stash changes
git stash push -m "WIP"

# Run git-town command
git town hack feature/new-branch

# Restore changes
git stash pop
```

---

## Next Steps

### Learn Advanced Features
- **Stacked branches**: `git town append`, `git town prepend`
- **Branch reorganization**: `git town detach`, `git town swap`
- **Offline mode**: `git town offline`
- **Error recovery**: `git town undo`, `git town status`

### Explore Configuration
```bash
# See all configuration options
git town config

# Customize behavior
git town config git-town.push-new-branches false
git town config git-town.ship-delete-remote-branch true
```

### Integration with Tools
- **GitHub CLI**: For `git town propose` to work
- **Context7 MCP**: For up-to-date documentation
- **CI/CD**: Auto-sync on main branch updates

### Get Help
```bash
# Command-specific help
git town hack --help
git town sync --help

# Official documentation
# https://www.git-town.com/

# Context7 documentation (if available)
# Use ensemble-core Context7 integration
```

---

## Onboarding Checklist

Use this checklist to verify your setup:

- [ ] Git-town installed (`git town --version` ≥ 14.0.0)
- [ ] Main branch configured (`git town config git-town.main-branch`)
- [ ] Perennial branches configured (if needed)
- [ ] Completed first feature workflow (hack → sync → propose → ship)
- [ ] Know how to resolve merge conflicts (`git town continue`)
- [ ] Know how to undo mistakes (`git town undo`)
- [ ] GitHub CLI installed (for `git town propose`)
- [ ] Team configuration shared (`.git-town.toml`)
- [ ] CI/CD integration configured (optional)

---

## Quick Reference Card

| Task | Command |
|------|---------|
| Create feature | `git town hack feature/name` |
| Update branch | `git town sync` |
| Create PR | `git town propose` |
| Merge & cleanup | `git town ship` |
| Fix conflicts | `git add files && git town continue` |
| Undo mistake | `git town undo` |
| Check status | `git town status` |
| View config | `git town config` |

**Remember**: Always sync before proposing PRs!

---

*Last updated: 2025-12-31*
*For latest documentation, use Context7 MCP (see SKILL.md)*
