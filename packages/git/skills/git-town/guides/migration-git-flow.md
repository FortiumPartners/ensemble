# Git-Flow to Git-Town Migration Guide

> Transition from git-flow to git-town for simplified feature branch workflows

**Migration Time**: 2-4 weeks for gradual adoption | **Team Size**: Any

---

## Table of Contents

1. [Why Migrate from Git-Flow?](#why-migrate-from-git-flow)
2. [Workflow Comparison](#workflow-comparison)
3. [Branch Conversion Mapping](#branch-conversion-mapping)
4. [Release Workflow Changes](#release-workflow-changes)
5. [Migration Strategies](#migration-strategies)
6. [Team Coordination](#team-coordination)
7. [Common Migration Challenges](#common-migration-challenges)
8. [Rollback Plan](#rollback-plan)

---

## Why Migrate from Git-Flow?

### Git-Flow Complexity

Git-flow introduces significant workflow overhead:

- **5 branch types**: main, develop, feature/, release/, hotfix/
- **Complex merge patterns**: Features → develop → release → main → hotfix → develop
- **Manual branch management**: No automated cleanup or sync
- **Release ceremony**: Separate release branches require coordination
- **Merge conflicts**: Multiple long-lived branches increase conflict frequency

### Git-Town Benefits

Git-town simplifies to essentials:

- **2 primary branch types**: main, feature/*
- **Automated workflows**: One command for sync, propose, ship
- **Fast iteration**: Ship features directly to main
- **Conflict reduction**: Fewer long-lived branches = fewer conflicts
- **CI/CD friendly**: Continuous deployment from main branch

### When NOT to Migrate

Git-flow may be better if you:

- ✅ Require strict release schedule (monthly/quarterly releases)
- ✅ Need to support multiple production versions simultaneously
- ✅ Have complex QA cycles requiring dedicated release branches
- ✅ Work in highly regulated industries (finance, healthcare)

Git-town works better for:

- ✅ Continuous deployment to production
- ✅ Fast feature iteration (daily/weekly releases)
- ✅ Small to medium teams (2-20 developers)
- ✅ Cloud-native applications with automated testing

---

## Workflow Comparison

### Git-Flow Workflow

```
┌─────────────────────────────────────────────────────┐
│ Git-Flow: Complex Multi-Branch Workflow            │
└─────────────────────────────────────────────────────┘

main         ─────────────────●──────────────────●─────
                             ╱ (release)         ╱
release/1.0      ──────────●─────────────────────
                          ╱
develop      ────●───────●───────●───────●───────●─────
                ╱         ╲     ╱         ╲     ╱
feature/A   ───●           ●───          (merge)
                            ╲
hotfix/bug                   ●───────●─────
                                     ╲
                                      ●─────→ main + develop
```

**Steps**: 7-10 commands per feature
**Branch lifetime**: 1-4 weeks
**Merge complexity**: High (double merges)

### Git-Town Workflow

```
┌─────────────────────────────────────────────────────┐
│ Git-Town: Simplified Feature Branch Workflow       │
└─────────────────────────────────────────────────────┘

main         ────●───────────●───────────●─────────────
                ╱           ╱           ╱
feature/A   ───●───────────             (ship)
                ╲
feature/B       ●───────────●──────────
                            ╱ (ship)
```

**Steps**: 3-5 commands per feature
**Branch lifetime**: 1-3 days
**Merge complexity**: Low (single merge to main)

### Side-by-Side Command Comparison

| Git-Flow | Git-Town | Notes |
|----------|----------|-------|
| `git flow feature start user-auth` | `git town hack feature/user-auth` | Feature creation |
| `git checkout develop && git pull` | `git town sync` | Update branch |
| Manual PR creation | `git town propose` | Create PR |
| `git flow feature finish user-auth` | `git town ship` | Complete feature |
| `git flow release start 1.0.0` | N/A (continuous deployment) | Release ceremony |
| `git flow release finish 1.0.0` | Tag on main branch | Release completion |
| `git flow hotfix start critical-bug` | `git town hack hotfix/critical-bug` | Emergency fix |

---

## Branch Conversion Mapping

### Git-Flow → Git-Town Branch Types

| Git-Flow Branch | Git-Town Equivalent | Migration Strategy |
|-----------------|---------------------|-------------------|
| `main` | `main` | Keep as-is (production branch) |
| `develop` | `main` | Merge develop into main, delete develop |
| `feature/*` | `feature/*` | Rename if needed, continue development |
| `release/*` | N/A | Complete in-flight releases, stop creating new ones |
| `hotfix/*` | `feature/hotfix-*` or `fix/*` | Use regular feature branches |
| `support/*` | Perennial branches | Configure as perennial if needed |

### Develop Branch Transition

**Option 1: Merge Develop into Main (Recommended)**

```bash
# Ensure develop is up-to-date
git checkout develop
git pull

# Merge develop into main
git checkout main
git pull
git merge develop --ff-only  # Fast-forward if possible

# Push updated main
git push origin main

# Delete develop (after team confirmation)
git branch -d develop
git push origin --delete develop
```

**Option 2: Rename Develop to Main (Risky)**

```bash
# Only if main is outdated or unused
git branch -m main main-old
git branch -m develop main
git push origin main
git push origin --delete develop
```

**Option 3: Gradual Transition (Safest)**

```bash
# Keep develop temporarily, sync to main regularly
git checkout main
git merge develop --no-ff
git push origin main

# Over 2-4 weeks, transition all features to target main
# Delete develop when no active features remain
```

### Feature Branch Conversion

```bash
# If on git-flow feature branch
git branch
# * feature/user-auth

# Git-town auto-detects, just configure parent
git town config set-parent feature/user-auth main

# Now use git-town commands
git town sync
git town propose
git town ship
```

### In-Flight Release Branches

**Complete active releases before migration:**

```bash
# Finish release/1.5.0 using git-flow
git flow release finish 1.5.0

# Then migrate to git-town
git town config set-main-branch main

# Future releases: tag main branch directly
git tag -a v1.6.0 -m "Release 1.6.0"
git push --tags
```

---

## Release Workflow Changes

### Git-Flow Release Process

```bash
# Create release branch from develop
git flow release start 1.0.0

# Bug fixes on release branch
git commit -m "fix: critical bug"

# Finish release (merges to main and develop)
git flow release finish 1.0.0

# Manual tag creation
git tag -a v1.0.0 -m "Version 1.0.0"
git push --tags
```

**Duration**: 1-2 weeks
**Branches**: 3 (develop, release/1.0.0, main)
**Merge count**: 2 (to main, back to develop)

### Git-Town Release Process

```bash
# Features ship directly to main
git checkout feature/last-feature
git town ship

# Create release tag on main
git checkout main
git pull
git tag -a v1.0.0 -m "Release 1.0.0"
git push --tags

# CI/CD deploys from tag
```

**Duration**: Continuous (no release branch)
**Branches**: 1 (main)
**Merge count**: 1 (feature to main)

### Version Management Comparison

| Aspect | Git-Flow | Git-Town |
|--------|----------|----------|
| Version source | Release branch name | Git tag on main |
| QA environment | Release branch deployment | Feature branch or staging |
| Hotfix target | main + develop | main only |
| Rollback strategy | Revert release merge | Revert commit or deploy previous tag |
| Semantic versioning | Manual in release branch | Automated via CI/CD |

### Continuous Deployment Pattern

**Git-Town + Semantic Release:**

```yaml
# .github/workflows/release.yml
name: Release
on:
  push:
    branches: [main]

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - name: Semantic Release
        run: |
          npx semantic-release
          # Auto-generates version from commit messages
          # Creates tag and GitHub release
          # Deploys to production
```

**Commit convention drives versioning:**
- `feat:` → Minor version bump (1.0.0 → 1.1.0)
- `fix:` → Patch version bump (1.0.0 → 1.0.1)
- `feat!:` or `BREAKING CHANGE:` → Major version bump (1.0.0 → 2.0.0)

---

## Migration Strategies

### Strategy 1: Big Bang Migration (1 Week)

**Best for**: Small teams (2-5 developers), low active feature count

**Timeline:**
```
Week 1:
Day 1-2: Team training on git-town
Day 3:   Complete all git-flow releases
Day 4:   Merge develop into main, delete develop
Day 5:   Convert feature branches, install git-town
```

**Pros**: Fast transition, clean break
**Cons**: High risk, requires coordination

**Steps**:
```bash
# Day 1-2: Training
# - Review git-town documentation
# - Practice on test repository
# - Discuss release process changes

# Day 3: Close git-flow releases
git flow release finish $(git branch | grep release/)

# Day 4: Merge develop
git checkout main
git merge develop --ff-only
git push origin main
git push origin --delete develop

# Day 5: Convert features
for branch in $(git branch | grep feature/); do
  git town config set-parent $branch main
done

# Install git-town
brew install git-town
git town config set-main-branch main
```

### Strategy 2: Gradual Migration (2-4 Weeks)

**Best for**: Medium teams (6-15 developers), moderate feature count

**Timeline:**
```
Week 1: Install git-town, configure main branch, keep develop
Week 2: New features target main, existing features continue on develop
Week 3: Complete develop-based features, sync develop to main
Week 4: Delete develop, full git-town workflow
```

**Pros**: Low risk, incremental learning
**Cons**: Temporary complexity (two workflows running)

**Steps**:

**Week 1: Parallel Setup**
```bash
# Install git-town
brew install git-town

# Configure main as primary
git town config set-main-branch main

# Keep develop as perennial temporarily
git town config set-perennial-branches develop

# New features target main
git town hack feature/new-feature  # Uses main as parent
```

**Week 2: Dual Workflows**
```bash
# New work: Git-town workflow
git town hack feature/payment-api
# ... development ...
git town ship  # Merges to main

# Existing work: Git-flow workflow (unchanged)
git checkout feature/old-feature
git flow feature finish old-feature  # Merges to develop
```

**Week 3: Consolidation**
```bash
# Sync develop to main daily
git checkout main
git merge develop --no-ff
git push origin main

# Complete all develop-based features
# No new features on develop
```

**Week 4: Cutover**
```bash
# Final develop → main sync
git checkout main
git merge develop --ff-only

# Remove develop
git push origin --delete develop

# Remove perennial config
git town config set-perennial-branches ""

# Announce: All teams use git-town workflow
```

### Strategy 3: Team-by-Team Migration (4-8 Weeks)

**Best for**: Large teams (15+ developers), multiple sub-teams

**Timeline:**
```
Week 1-2: Team A migrates (pilot team)
Week 3-4: Team B and C migrate
Week 5-6: Team D and E migrate
Week 7-8: Cleanup, delete develop
```

**Pros**: Lowest risk, team-specific training
**Cons**: Longest duration, coordination overhead

**Steps**:

**Team A (Pilot - Week 1-2)**
```bash
# Team A: Adopt git-town
git town config set-main-branch main
git town hack feature/team-a-feature

# Other teams: Continue git-flow
git flow feature start team-b-feature
```

**Team B/C (Week 3-4)**
```bash
# Teams A, B, C: Git-town
# Teams D, E: Git-flow

# Shared main branch - both workflows merge here
git checkout main
git pull  # Gets features from all teams
```

**Team D/E (Week 5-6)**
```bash
# All teams: Git-town

# Delete develop once all teams migrated
git push origin --delete develop
```

---

## Team Coordination

### Communication Plan

**Pre-Migration (1 Week Before)**

1. **Announcement Email**
```
Subject: Migration to Git-Town Workflow - Action Required

Team,

We're migrating from git-flow to git-town on [DATE].

Why: Simplified workflow, faster feature delivery, better CI/CD integration

What changes:
- develop branch will be deleted
- Features merge directly to main
- No more release branches (continuous deployment)

Action required:
1. Complete in-flight git-flow releases by [DATE]
2. Attend training session on [DATE/TIME]
3. Install git-town: brew install git-town

Questions: Slack #git-migration
```

2. **Training Sessions**
   - Live demo: 30 minutes
   - Hands-on practice: 30 minutes
   - Q&A: 15 minutes
   - Record for async viewing

3. **Documentation**
   - Share onboarding.md guide
   - Create team-specific cheat sheet
   - Update CONTRIBUTING.md

### Migration Day Checklist

**Team Lead Responsibilities:**

- [ ] Verify all git-flow releases completed
- [ ] Back up repository (git bundle create backup.bundle --all)
- [ ] Merge develop into main
- [ ] Delete develop branch
- [ ] Update CI/CD pipelines
- [ ] Configure git-town for all team members
- [ ] Monitor Slack for issues

**Developer Responsibilities:**

- [ ] Install git-town (brew install git-town)
- [ ] Pull latest main branch
- [ ] Convert active feature branches
- [ ] Test git-town workflow on test repo
- [ ] Update local aliases/scripts

### Rollback Triggers

Rollback to git-flow if:

- ❌ >50% of team blocked by git-town issues
- ❌ Critical production deployment fails
- ❌ Merge conflicts increase >200%
- ❌ Build pipeline breaks repeatedly

**Rollback procedure:**
```bash
# Restore develop branch
git checkout -b develop origin/main
git push origin develop

# Reinstall git-flow
brew install git-flow
git flow init

# Announce rollback
echo "Reverting to git-flow temporarily. Investigating issues."
```

### Success Metrics

Track these metrics before/after migration:

| Metric | Git-Flow Baseline | Git-Town Target | Measure |
|--------|------------------|-----------------|---------|
| Feature cycle time | 5-10 days | 1-3 days | JIRA ticket age |
| Merge conflicts/week | 10-15 | 3-5 | Git log analysis |
| Branches >7 days old | 15-20 | 2-5 | git branch --merged |
| Deploy frequency | Weekly | Daily | CI/CD logs |
| Time to production | 2 weeks | 2 days | JIRA → production |

---

## Common Migration Challenges

### Challenge 1: Release Branch Dependencies

**Problem**: Active release branches with ongoing bug fixes.

**Solution**: Complete releases before migration
```bash
# Finish all active releases
git flow release finish 1.5.0
git flow release finish 1.6.0

# Future: Tag main instead
git checkout main
git tag -a v1.7.0 -m "Release 1.7.0"
```

### Challenge 2: Multiple Active Feature Branches

**Problem**: Developers have 5-10 feature branches based on develop.

**Solution**: Stacked conversion
```bash
# Convert one branch at a time
git checkout feature/important-feature
git rebase main  # Rebase onto main
git town config set-parent feature/important-feature main

# Continue with git-town
git town sync
git town propose
```

### Challenge 3: CI/CD Pipelines Expect Develop

**Problem**: Build pipelines deploy from develop branch.

**Solution**: Update CI/CD configuration
```yaml
# Before (Git-Flow)
on:
  push:
    branches: [develop]

# After (Git-Town)
on:
  push:
    branches: [main]
```

### Challenge 4: Long-Lived Feature Branches

**Problem**: Features spanning 2-4 weeks conflict with git-town's fast iteration.

**Solution**: Break into smaller features
```bash
# Before: One large feature (3 weeks)
git flow feature start user-dashboard

# After: 5 small features (3 days each)
git town hack feature/dashboard-layout
git town hack feature/dashboard-widgets
git town hack feature/dashboard-data
git town hack feature/dashboard-settings
git town hack feature/dashboard-tests
```

### Challenge 5: Hotfix Process Confusion

**Problem**: Team unclear how to handle urgent production fixes.

**Solution**: Use regular feature workflow
```bash
# Git-flow hotfix
git flow hotfix start critical-bug

# Git-town equivalent
git town hack fix/critical-bug  # Same workflow, different name
git commit -m "fix: critical security issue"
git town sync
git town propose --title "URGENT: Security Fix" --body "Critical"
git town ship  # Merges to main, deploys immediately
```

---

## Rollback Plan

### Pre-Migration Backup

```bash
# Create complete repository backup
git bundle create /backups/repo-$(date +%Y%m%d).bundle --all

# Verify bundle integrity
git bundle verify /backups/repo-$(date +%Y%m%d).bundle

# Document current state
git branch -a > /backups/branches-before.txt
git log --oneline -20 > /backups/commits-before.txt
```

### Rollback Procedure (If Needed)

**Scenario**: Migration failed, need to restore git-flow

**Steps**:

1. **Restore develop branch** (if deleted prematurely)
```bash
# Find last develop commit in reflog
git reflog show origin/develop

# Recreate develop
git checkout -b develop <last-develop-commit-hash>
git push origin develop
```

2. **Reinstall git-flow**
```bash
brew install git-flow
git flow init -d  # Use defaults
```

3. **Migrate in-flight git-town features back to git-flow**
```bash
# Convert feature branches
git checkout feature/active-feature
git flow feature track active-feature
```

4. **Update CI/CD**
```yaml
# Restore develop-based deployments
on:
  push:
    branches: [develop]
```

5. **Team notification**
```
Subject: Temporary Rollback to Git-Flow

Team,

We've encountered issues with git-town migration and are rolling back to git-flow temporarily.

Actions:
1. Pull latest develop branch
2. Use git-flow commands
3. Standby for migration retry plan

Root cause analysis in progress.
```

### Rollback Success Criteria

Rollback complete when:

- ✅ Develop branch restored with latest commits
- ✅ All feature branches converted to git-flow format
- ✅ CI/CD pipelines deploy from develop
- ✅ Team can create git-flow features/releases
- ✅ No git-town references in CI/CD

---

## Post-Migration Validation

### Week 1 Checkpoints

**Day 1-2**: Monitor feature creation
```bash
# Verify new features use main as parent
git town config get-parent feature/new-feature
# Expected: main
```

**Day 3-5**: Validate merge patterns
```bash
# Check that features merge to main (not develop)
git log --graph --oneline main | grep -i "merge"
```

**Day 5-7**: Measure success metrics
```bash
# Count active branches
git branch -r | wc -l  # Should decrease

# Check deploy frequency
git log --since="1 week ago" --oneline main | wc -l
# Should increase
```

### Common Post-Migration Issues

| Issue | Symptom | Fix |
|-------|---------|-----|
| Develop still exists | git branch -a shows origin/develop | git push origin --delete develop |
| Features targeting develop | git-town complains about parent | git town config set-parent <branch> main |
| CI/CD deploys from develop | Deployments not triggering | Update GitHub Actions to watch main |
| Developers using git-flow | Merge conflicts increase | Reminder email + training |

---

## Migration Checklist

Use this checklist for your migration:

### Pre-Migration
- [ ] Document current git-flow usage (branches, releases)
- [ ] Schedule team training sessions
- [ ] Create repository backup (git bundle)
- [ ] Complete all in-flight git-flow releases
- [ ] Update CI/CD pipeline configurations
- [ ] Install git-town on all developer machines

### Migration Day
- [ ] Merge develop into main (final sync)
- [ ] Delete develop branch (after verification)
- [ ] Configure git-town (set main branch)
- [ ] Convert active feature branches
- [ ] Update team documentation (CONTRIBUTING.md)
- [ ] Send migration complete announcement

### Post-Migration (Week 1)
- [ ] Monitor feature branch creation patterns
- [ ] Validate merge workflows (features → main)
- [ ] Check CI/CD deployment frequency
- [ ] Collect team feedback on pain points
- [ ] Measure success metrics (cycle time, conflicts)
- [ ] Schedule retrospective meeting

### Post-Migration (Week 4)
- [ ] Compare git-flow vs git-town metrics
- [ ] Document lessons learned
- [ ] Update team onboarding materials
- [ ] Archive git-flow documentation
- [ ] Celebrate successful migration 🎉

---

## Additional Resources

- **Git-town documentation**: https://www.git-town.com/
- **Onboarding guide**: See `onboarding.md` in this directory
- **Error handling**: See `../ERROR_HANDLING.md` for troubleshooting
- **Git-flow reference**: https://nvie.com/posts/a-successful-git-branching-model/
- **Semantic versioning**: https://semver.org/
- **Conventional commits**: https://www.conventionalcommits.org/

---

*Last updated: 2025-12-31*
*Migration guide for transitioning from git-flow to git-town workflows*
