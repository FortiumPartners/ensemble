# GitHub Flow to Git-Town Migration Guide

> Enhance GitHub Flow with git-town automation for streamlined feature workflows

**Migration Time**: 1-2 weeks for team adoption | **Complexity**: Low

---

## Table of Contents

1. [Why Add Git-Town to GitHub Flow?](#why-add-git-town-to-github-flow)
2. [Workflow Comparison](#workflow-comparison)
3. [Naming Conventions](#naming-conventions)
4. [PR-Centric Workflow Enhancement](#pr-centric-workflow-enhancement)
5. [CI/CD Alignment](#cicd-alignment)
6. [Migration Path](#migration-path)
7. [Team Adoption](#team-adoption)
8. [Common Questions](#common-questions)

---

## Why Add Git-Town to GitHub Flow?

### GitHub Flow: Already Simple

GitHub Flow is a lightweight branching model:

- ✅ Single main branch (production-ready)
- ✅ Feature branches for all changes
- ✅ Pull requests for code review
- ✅ Deploy from main after merge

**GitHub Flow is already close to git-town's philosophy!**

### What Git-Town Adds

Git-town **enhances** GitHub Flow with automation:

| Task | GitHub Flow (Manual) | Git-Town (Automated) |
|------|---------------------|---------------------|
| Create feature branch | `git checkout -b feature && git push` | `git town hack feature` |
| Sync with main | `git checkout main && git pull && git checkout feature && git merge main && git push` | `git town sync` |
| Create PR | Manual via GitHub UI or gh CLI | `git town propose` |
| Cleanup after merge | `git checkout main && git pull && git branch -d feature && git push origin --delete feature` | `git town ship` |
| Handle merge conflicts | Manual resolution + commands | `git town continue` |

**Key benefit**: Reduce 5-10 manual commands to 1 automated command.

### When Git-Town Makes Sense

Add git-town to GitHub Flow if:

- ✅ You want faster feature branch workflows
- ✅ Your team repeats the same git commands daily
- ✅ You need consistent branch cleanup
- ✅ You want to reduce training time for new developers
- ✅ You have 5+ active feature branches at a time

Stick with plain GitHub Flow if:

- ⚠️ Your team is <3 developers (overhead may not be worth it)
- ⚠️ You rarely use feature branches (direct commits to main)
- ⚠️ Your deployment process is fully manual

---

## Workflow Comparison

### GitHub Flow (Manual)

```
┌─────────────────────────────────────────────────────┐
│ GitHub Flow: Manual Branch Management              │
└─────────────────────────────────────────────────────┘

main         ────●───────────●───────────●─────────────
                ╱           ╱           ╱
feature/A   ───●───────────             (manual cleanup)
                ╲
feature/B       ●───────────●──────────
                            ╱ (manual merge)
```

**Typical Commands (15 steps)**:
```bash
# Create feature branch
git checkout main
git pull origin main
git checkout -b feature/user-auth
git push -u origin feature/user-auth

# Sync with main (daily)
git checkout main
git pull origin main
git checkout feature/user-auth
git merge main
git push

# Create PR (via GitHub UI or gh CLI)
gh pr create --title "Add user authentication" --body "..."

# After PR merged, cleanup
git checkout main
git pull origin main
git branch -d feature/user-auth
git push origin --delete feature/user-auth
```

### GitHub Flow + Git-Town (Automated)

```
┌─────────────────────────────────────────────────────┐
│ GitHub Flow + Git-Town: Automated Workflow         │
└─────────────────────────────────────────────────────┘

main         ────●───────────●───────────●─────────────
                ╱           ╱           ╱
feature/A   ───●───────────             (auto cleanup)
                ╲
feature/B       ●───────────●──────────
                            ╱ (auto merge + cleanup)
```

**Git-Town Commands (4 steps)**:
```bash
# Create feature branch
git town hack feature/user-auth

# Sync with main (daily)
git town sync

# Create PR
git town propose --title "Add user authentication" --body "..."

# After PR merged, cleanup
git town ship
```

**Result**: 73% fewer commands (15 → 4)

---

## Naming Conventions

### GitHub Flow Branch Naming

GitHub Flow has flexible naming conventions. Common patterns:

```
# Descriptive names (most common)
feature/user-authentication
bugfix/login-error
hotfix/critical-security-patch

# Issue-based names
123-add-user-auth
fix-456-login-bug

# User-prefixed names
john/add-payment-gateway
sarah/refactor-api
```

### Git-Town Recommendations

Git-town works with **any naming convention**, but recommends:

```
# Hierarchical naming (recommended)
feature/user-authentication
feature/payment-gateway
fix/login-error
fix/security-patch
refactor/api-endpoints

# Benefits:
# - Clear categorization (feature/, fix/, refactor/)
# - Easy filtering (git branch --list 'feature/*')
# - Consistent with conventional commits
```

### Migration Strategy

**Option 1: Keep existing convention** (zero changes)
```bash
# Your team uses: username/feature-name
git town hack john/add-payment-gateway

# Git-town works perfectly with this
```

**Option 2: Gradual standardization** (recommended)
```bash
# Old branches: Keep as-is
john/add-payment-gateway  # Existing branch

# New branches: Use hierarchical naming
git town hack feature/payment-gateway
```

**Option 3: Team-wide convention change** (optional)
```bash
# Update CONTRIBUTING.md
## Branch Naming Convention

Use hierarchical naming for all new branches:

- `feature/<description>` - New features
- `fix/<description>` - Bug fixes
- `refactor/<description>` - Code refactoring
- `docs/<description>` - Documentation changes

Example: `git town hack feature/user-authentication`
```

---

## PR-Centric Workflow Enhancement

### GitHub Flow PR Workflow

GitHub Flow is inherently PR-centric:

1. Create branch
2. Make commits
3. Open PR (via GitHub UI)
4. Code review
5. Merge PR (via GitHub UI)
6. Delete branch (manual or auto-delete)

**Pain points**:
- ❌ Manual PR creation (context switching to browser)
- ❌ Forgetting to sync with main before PR
- ❌ Manual branch deletion after merge
- ❌ No automated conflict detection before PR

### Git-Town PR Workflow

Git-town **automates** PR workflow without changing the process:

```bash
# 1. Create branch (same as GitHub Flow)
git town hack feature/user-auth

# 2. Make commits (same as GitHub Flow)
git commit -m "feat: add user authentication"

# 3. Sync with main (automated conflict detection)
git town sync
# Result: Rebases on main, catches conflicts early

# 4. Open PR (automated via gh CLI)
git town propose \
  --title "feat: Add user authentication" \
  --body "Implements OAuth 2.0 with JWT tokens"
# Result: PR created, URL opened in browser

# 5. Code review (same as GitHub Flow - via GitHub UI)

# 6. Merge PR (via GitHub UI or git-town)
git town ship
# Result: Squash-merge + branch cleanup
```

**Benefits**:
- ✅ No browser context switching for PR creation
- ✅ Conflicts detected before PR (not during review)
- ✅ Automatic branch cleanup
- ✅ Consistent PR format (via templates)

### GitHub CLI Integration

Git-town's `propose` command requires GitHub CLI (`gh`):

```bash
# Install GitHub CLI
brew install gh

# Authenticate
gh auth login

# Git-town propose delegates to gh
git town propose --title "..." --body "..."
# Equivalent to:
gh pr create --title "..." --body "..."
```

**Configuration**:
```bash
# Set default PR template
cat > .github/pull_request_template.md <<EOF
## Summary
<!-- Brief description of changes -->

## Type of Change
- [ ] Feature
- [ ] Bug fix
- [ ] Refactor
- [ ] Documentation

## Testing
<!-- How was this tested? -->

## Checklist
- [ ] Tests added/updated
- [ ] Documentation updated
- [ ] CI passing
EOF
```

**Now git-town propose uses this template**:
```bash
git town propose --title "feat: User auth"
# Opens editor with template pre-filled
```

---

## CI/CD Alignment

### GitHub Flow CI/CD Pattern

Typical GitHub Flow CI/CD setup:

```yaml
# .github/workflows/ci.yml
name: CI
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - run: npm test

  deploy:
    needs: test
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - run: npm run deploy
```

**Key points**:
- ✅ Tests run on all PRs
- ✅ Deploys only from main branch
- ✅ No branch-specific logic needed

### Git-Town CI/CD (Identical)

Git-town **does not change CI/CD configuration**:

```yaml
# .github/workflows/ci.yml
# NO CHANGES REQUIRED - same file works with git-town
name: CI
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - run: npm test

  deploy:
    needs: test
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - run: npm run deploy
```

**Why no changes?**
- Git-town creates feature branches (just like GitHub Flow)
- Git-town creates PRs targeting main (just like GitHub Flow)
- Git-town merges to main (just like GitHub Flow)
- CI/CD sees identical branch/PR patterns

### Enhanced CI/CD with Git-Town

**Optional enhancement**: Auto-sync feature branches on main changes

```yaml
# .github/workflows/auto-sync.yml
name: Auto-Sync Feature Branches
on:
  push:
    branches: [main]

jobs:
  sync-features:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
        with:
          fetch-depth: 0  # Full history for rebasing

      - name: Install git-town
        run: brew install git-town

      - name: Sync all feature branches
        run: |
          git town sync --all
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

**Benefit**: Feature branches stay up-to-date automatically, reducing merge conflicts.

### Deployment Strategies

Both GitHub Flow and git-town support identical deployment patterns:

**Continuous Deployment (CD)**:
```yaml
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - run: ./deploy.sh production
```

**Tag-Based Releases**:
```yaml
on:
  push:
    tags: ['v*']
jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - run: ./release.sh ${{ github.ref_name }}
```

**Manual Deployments**:
```yaml
on:
  workflow_dispatch:
    inputs:
      environment:
        type: choice
        options: [staging, production]
```

---

## Migration Path

### Phase 1: Install Git-Town (Week 1)

**Goal**: Developers have git-town installed, no workflow changes yet.

**Steps**:

1. **Install git-town**:
```bash
# macOS
brew install git-town

# Linux
curl -L https://github.com/git-town/git-town/releases/latest/download/git-town-linux-amd64.tar.gz | tar xz
sudo mv git-town /usr/local/bin/

# Windows
scoop install git-town

# Verify installation
git town --version
# Expected: Git Town 14.0.0 or higher
```

2. **Configure repository**:
```bash
# Set main branch
git town config set-main-branch main

# Verify configuration
git town config
# Expected:
# Main branch: main
# Perennial branches: (none)
# Push new branches: true
```

3. **Test on existing branch**:
```bash
# On your current feature branch
git town config set-parent $(git branch --show-current) main

# Test sync command
git town sync
# Should rebase on main and push
```

### Phase 2: Gradual Adoption (Week 2-3)

**Goal**: Developers start using git-town commands alongside existing GitHub Flow workflow.

**Parallel Workflows**:
```bash
# Option 1: Use git-town for new branches
git town hack feature/new-feature  # Git-town
# vs.
git checkout -b feature/old-style  # GitHub Flow

# Option 2: Use git-town sync on existing branches
git checkout feature/existing
git town sync  # Git-town
# vs.
git merge main && git push  # GitHub Flow

# Both workflows coexist peacefully
```

**Team adoption tracking**:
```bash
# Count git-town vs manual branches (daily check)
echo "Git-town branches:"
git branch --list 'feature/*' | wc -l

echo "Manual cleanup needed:"
git branch --merged main | grep -v main | wc -l
```

### Phase 3: Full Adoption (Week 4)

**Goal**: All new work uses git-town, existing branches converted.

**Checklist**:
- [ ] All developers using `git town hack` for new branches
- [ ] All developers using `git town sync` daily
- [ ] All developers using `git town propose` for PRs
- [ ] All developers using `git town ship` after merge
- [ ] Update CONTRIBUTING.md with git-town commands
- [ ] Add git-town to team onboarding documentation

**CONTRIBUTING.md update**:
```markdown
## Development Workflow

We use GitHub Flow enhanced with git-town for automation.

### Creating a Feature Branch

```bash
git town hack feature/my-feature
```

### Daily Sync with Main

```bash
git town sync
```

### Creating a Pull Request

```bash
git town propose \
  --title "feat: My feature" \
  --body "Description of changes"
```

### Completing a Feature

After PR is approved and merged:

```bash
git town ship
```

See [git-town documentation](https://www.git-town.com/) for more commands.
```

---

## Team Adoption

### Training Materials

**15-Minute Quick Start (for team meeting)**:

```markdown
# Git-Town Quick Start

Git-town automates our GitHub Flow workflow.

## 4 Commands You Need

1. **Create branch**: `git town hack feature/name`
2. **Sync with main**: `git town sync`
3. **Create PR**: `git town propose --title "..." --body "..."`
4. **Cleanup after merge**: `git town ship`

## Try It Now

```bash
# Install
brew install git-town

# Create test branch
git town hack feature/test-git-town

# Make a commit
echo "test" > test.txt
git add test.txt
git commit -m "test: git-town"

# Sync with main
git town sync

# Create PR (requires gh auth)
git town propose --title "Test PR" --body "Testing git-town"

# Delete test branch
git checkout main
git branch -D feature/test-git-town
```

## Questions?

See our internal wiki or ask in #engineering-help
```

### Adoption Metrics

Track adoption with these metrics:

| Metric | Target | Measurement |
|--------|--------|-------------|
| % developers with git-town installed | 100% | Survey or `which git-town` check |
| % new branches created via `git town hack` | 80%+ | Git log analysis |
| % PRs created via `git town propose` | 60%+ | GitHub API (gh CLI usage) |
| Average branch cleanup time | <5 minutes | Time from merge to branch deletion |
| Merge conflicts per week | -30% | Git log conflict markers |

**Tracking script**:
```bash
#!/usr/bin/env bash
# adoption-metrics.sh

echo "Git-Town Adoption Metrics"
echo "========================="

# New branches this week
NEW_BRANCHES=$(git log --since="1 week ago" --all --oneline | grep -c "hack")
echo "Branches via git-town: $NEW_BRANCHES"

# Merged branches still existing
MERGED_NOT_DELETED=$(git branch --merged main | grep -v main | wc -l)
echo "Branches needing cleanup: $MERGED_NOT_DELETED"

# Active feature branches
ACTIVE_FEATURES=$(git branch --list 'feature/*' | wc -l)
echo "Active feature branches: $ACTIVE_FEATURES"
```

### Common Adoption Challenges

**Challenge 1**: Developers forget git-town commands, revert to manual workflow

**Solution**: Add git aliases as reminders
```bash
# Add to .gitconfig
[alias]
  sync = "!echo 'Use: git town sync' && git town sync"
  cleanup = "!echo 'Use: git town ship' && git town ship"
```

**Challenge 2**: Muscle memory for `git checkout -b`

**Solution**: Create git alias that suggests git-town
```bash
# Add to .gitconfig
[alias]
  new = "!f() { echo 'Consider using: git town hack $1'; git checkout -b $1; }; f"

# Now:
git new feature/test
# Prints: "Consider using: git town hack feature/test"
# Then creates branch normally
```

**Challenge 3**: Not all team members see value

**Solution**: Show time savings with metrics
```bash
# Before git-town (5 commands)
git checkout main                     # 2s
git pull origin main                  # 3s
git checkout -b feature/test          # 1s
git push -u origin feature/test       # 3s
git merge main && git push            # 5s
# Total: 14 seconds

# With git-town (1 command)
git town hack feature/test            # 5s
# Total: 5 seconds

# Time saved per branch: 9 seconds
# Daily branches created: 20
# Daily time saved: 3 minutes
# Annual time saved (team of 10): 180 hours
```

---

## Common Questions

### Q: Do I need to change my existing GitHub Flow process?

**A**: No! Git-town **enhances** GitHub Flow, it doesn't replace it.

- ✅ You still create feature branches
- ✅ You still create pull requests
- ✅ You still merge to main
- ✅ Git-town just automates the manual commands

### Q: What if I prefer GitHub CLI (gh) for PRs?

**A**: Git-town uses `gh` under the hood!

```bash
# Git-town propose
git town propose --title "..." --body "..."

# Is equivalent to:
gh pr create --title "..." --body "..."
```

You can use either command. Git-town adds:
- Automatic sync before PR creation
- Consistent PR workflow
- Integration with git-town ship for cleanup

### Q: Can I still use GitHub's web UI for PRs?

**A**: Absolutely! Git-town doesn't force CLI usage.

**Hybrid workflow**:
```bash
# Create branch with git-town
git town hack feature/my-feature

# Sync with git-town
git town sync

# Create PR via GitHub UI (your preference)
# Visit: https://github.com/user/repo/pull/new/feature/my-feature

# Cleanup with git-town (after web merge)
git town ship
```

### Q: What happens to existing feature branches?

**A**: They continue to work normally.

```bash
# Existing branch (created without git-town)
git checkout feature/existing-branch

# Tell git-town about it
git town config set-parent feature/existing-branch main

# Now use git-town commands
git town sync
git town propose
```

### Q: Do I need to change CI/CD pipelines?

**A**: No changes required.

Git-town creates the same branch patterns GitHub Flow uses:
- Feature branches targeting main
- PRs created via GitHub API
- Merges to main branch

Your CI/CD sees identical workflow patterns.

### Q: What if git-town stops being maintained?

**A**: You can uninstall git-town anytime and revert to manual GitHub Flow.

```bash
# Uninstall git-town
brew uninstall git-town

# Your repository is unchanged
# All git-town did was automate these commands:
git checkout -b feature/...
git merge main
git push
gh pr create
git branch -d feature/...

# Just use manual commands again
```

### Q: Can I use git-town offline?

**A**: Yes, with offline mode.

```bash
# Enable offline mode (disables push operations)
git town offline

# Work locally
git town hack feature/offline-work
git commit -m "feat: add offline feature"
git town sync  # Only local sync, no push

# Disable offline mode when network returns
git town offline --off

# Now sync pushes to remote
git town sync
```

---

## Migration Checklist

### Pre-Migration
- [ ] Review GitHub Flow documentation with team
- [ ] Install git-town on all developer machines
- [ ] Configure main branch in repositories
- [ ] Test git-town on non-critical branch

### Week 1: Install & Configure
- [ ] All developers have git-town installed
- [ ] All repositories configured (`git town config set-main-branch main`)
- [ ] Existing branches have parents set (`git town config set-parent`)
- [ ] GitHub CLI authenticated (`gh auth status`)

### Week 2-3: Gradual Adoption
- [ ] New branches created with `git town hack`
- [ ] Daily syncs use `git town sync`
- [ ] PRs created with `git town propose` (optional)
- [ ] Branch cleanup uses `git town ship`

### Week 4: Full Adoption
- [ ] Update CONTRIBUTING.md with git-town commands
- [ ] Track adoption metrics (script provided above)
- [ ] Celebrate time savings (calculate hours saved)
- [ ] Share success stories in team meeting

---

## Additional Resources

- **Git-town documentation**: https://www.git-town.com/
- **GitHub Flow guide**: https://guides.github.com/introduction/flow/
- **GitHub CLI**: https://cli.github.com/
- **Onboarding guide**: See `onboarding.md` in this directory
- **Error handling**: See `../ERROR_HANDLING.md` for troubleshooting

---

*Last updated: 2025-12-31*
*Migration guide for enhancing GitHub Flow with git-town automation*
