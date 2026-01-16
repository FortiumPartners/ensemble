# Trunk-Based Development to Git-Town Migration Guide

> Add PR-based code review to trunk-based development without sacrificing velocity

**Migration Time**: 1-2 weeks | **Complexity**: Low (workflows already similar)

---

## Table of Contents

1. [Understanding the Relationship](#understanding-the-relationship)
2. [Workflow Comparison](#workflow-comparison)
3. [Feature Flags Integration](#feature-flags-integration)
4. [CI/CD Integration](#cicd-integration)
5. [Short-Lived Branch Strategies](#short-lived-branch-strategies)
6. [Migration Path](#migration-path)
7. [Team Adoption](#team-adoption)
8. [Common Concerns](#common-concerns)

---

## Understanding the Relationship

### Trunk-Based Development (TBD) Philosophy

Core principles:
- ✅ All developers commit to trunk (main) daily
- ✅ Branches live <24 hours (ideally <4 hours)
- ✅ Feature flags for incomplete work
- ✅ Continuous integration (trunk always builds)
- ✅ Fast feedback loops

**Key insight**: TBD optimizes for integration speed over code review depth.

### Git-Town: TBD with PR-Based Review

Git-town **implements** TBD principles with added code review:

```
Trunk-Based Development + Pull Requests = Git-Town
```

**What git-town adds**:
- ✅ Structured code review via PRs
- ✅ Automated branch lifecycle (create → sync → ship)
- ✅ Short-lived branch enforcement (<1 day target)
- ✅ Merge conflict prevention
- ✅ Consistent workflow automation

**What git-town preserves from TBD**:
- ✅ Commits to main multiple times per day
- ✅ Feature flags for work-in-progress
- ✅ Continuous integration on main
- ✅ Fast merge cycles

---

## Workflow Comparison

### Pure Trunk-Based Development

```
┌─────────────────────────────────────────────────────┐
│ TBD: Direct Commits to Trunk                       │
└─────────────────────────────────────────────────────┘

trunk (main)  ●───●───●───●───●───●───●───●───●─────
              │   │   │   │   │   │   │   │   │
              └───┴───┴───┴───┴───┴───┴───┴───┘
             Developer commits (no branches, no PRs)

Feature Flag: Incomplete features hidden behind flags
```

**Workflow**:
```bash
# Direct commit to trunk (no branches)
git checkout main
git pull --rebase
# Make changes
git add .
git commit -m "feat: add user auth (behind FEATURE_AUTH flag)"
git push origin main

# Repeat 5-10 times per day
```

**Pros**:
- ⚡ Fastest possible integration (no review delay)
- ⚡ No merge conflicts (always rebasing on latest)
- ⚡ Simplest workflow (no branch management)

**Cons**:
- ⚠️ No formal code review
- ⚠️ Quality depends on individual developer discipline
- ⚠️ No checkpoint before production merge
- ⚠️ Hard to track "what's ready" vs "work in progress"

### Trunk-Based Development with Git-Town

```
┌─────────────────────────────────────────────────────┐
│ TBD + Git-Town: Short-Lived PRs                    │
└─────────────────────────────────────────────────────┘

main          ●─────────●─────────●─────────●─────────
              │         │         │         │
feature/1   ──●─────────┘ (4h)
feature/2             ●───────────┘ (6h)
feature/3                       ●─────────┘ (3h)

Average branch lifetime: 4-6 hours
```

**Workflow**:
```bash
# Create short-lived feature branch
git town hack feature/add-auth-endpoint

# Make changes (1-2 hours)
git add .
git commit -m "feat: add auth endpoint (behind FEATURE_AUTH flag)"

# Sync with main (ensure up-to-date)
git town sync

# Create PR (2 hours for review)
git town propose --title "feat: Auth endpoint" --body "..."

# Ship after approval (total: 4 hours)
git town ship
```

**Pros**:
- ✅ Fast integration (4-6 hour cycle vs 1-3 day traditional PR)
- ✅ Code review included (quality gate)
- ✅ Feature flags still used (incomplete work)
- ✅ Trunk always builds (CI on every merge)

**Cons**:
- ⏱️ Slightly slower than pure TBD (review adds 1-2 hours)
- 📋 Requires team buy-in on fast PR reviews

---

## Feature Flags Integration

### Feature Flags in TBD

Feature flags enable incomplete work to be merged to trunk:

```javascript
// Incomplete feature merged to main
if (featureFlags.isEnabled('USER_AUTH')) {
  return <AuthenticatedApp />;
} else {
  return <UnauthenticatedApp />;
}
```

**Benefits**:
- ✅ Deploy incomplete features (hidden from users)
- ✅ Test in production (internal users only)
- ✅ Decouple deployment from release
- ✅ Enable A/B testing

### Feature Flags in Git-Town

Git-town **fully supports** feature flags:

```bash
# Day 1: Create feature branch
git town hack feature/user-auth

# Commit 1: Backend (behind flag)
echo "if (flags.USER_AUTH) { /* auth logic */ }" > auth.js
git commit -m "feat: add auth backend (behind USER_AUTH flag)"

# Commit 2: Frontend (behind same flag)
echo "if (flags.USER_AUTH) { /* auth UI */ }" > auth-ui.js
git commit -m "feat: add auth UI (behind USER_AUTH flag)"

# Ship to production (feature disabled)
git town propose --title "User auth (flagged)"
git town ship

# Day 2-5: Enable incrementally
# Update flag config to enable for:
# - Internal users (day 2)
# - Beta users (day 3)
# - 10% of users (day 4)
# - 100% of users (day 5)
```

**Workflow with feature flags**:

```
Day 1: Merge to main (flag OFF) - Zero user impact
Day 2: Enable for internal testing - Catch critical bugs
Day 3: Enable for beta users - Gather feedback
Day 4: Enable for 10% of users - Monitor metrics
Day 5: Enable for 100% of users - Full rollout
```

**Git-town advantage**: Code review ensures flag logic is correct before production merge.

### Feature Flag Patterns

**Pattern 1: Simple Boolean Flag**
```javascript
// Feature completely off or on
const showNewFeature = featureFlags.isEnabled('NEW_FEATURE');

if (showNewFeature) {
  return <NewFeatureComponent />;
}
return <OldFeatureComponent />;
```

**Pattern 2: Percentage Rollout**
```javascript
// Gradual rollout to percentage of users
const rolloutPercentage = featureFlags.getPercentage('NEW_FEATURE');

if (userHash % 100 < rolloutPercentage) {
  return <NewFeatureComponent />;
}
return <OldFeatureComponent />;
```

**Pattern 3: User Cohort Targeting**
```javascript
// Enable for specific user groups
const enabledCohorts = featureFlags.getCohorts('NEW_FEATURE');

if (enabledCohorts.includes(user.cohort)) {
  return <NewFeatureComponent />;
}
return <OldFeatureComponent />;
```

### Feature Flag Management Tools

**LaunchDarkly**:
```bash
# Ship feature to main (flag OFF)
git town ship

# Enable via LaunchDarkly UI
# - Target: Internal users
# - Rollout: 0% → 10% → 50% → 100%
# - Metrics: Track conversion, errors, performance
```

**Split.io**:
```bash
# Ship feature to main (flag OFF)
git town ship

# Enable via Split.io
# - Treatment: control vs treatment
# - Metrics: Statistical significance
# - Rollback: Instant via UI
```

**Flagsmith** (Open Source):
```bash
# Ship feature to main (flag OFF)
git town ship

# Enable via Flagsmith API or UI
# - Environments: dev, staging, production
# - Targeting: User traits, segments
# - Audit log: Track flag changes
```

---

## CI/CD Integration

### Trunk-Based CI/CD

TBD requires robust CI/CD to maintain trunk quality:

```yaml
# .github/workflows/trunk-ci.yml
name: Trunk CI
on:
  push:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - run: npm test
      - run: npm run lint
      - run: npm run build

  deploy:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - run: ./deploy.sh production
```

**Key requirements**:
- ✅ Fast test suite (<5 minutes)
- ✅ High test coverage (>80%)
- ✅ Automated deployment
- ✅ Rollback capability

### Git-Town CI/CD (Enhanced)

Git-town adds PR validation before trunk merge:

```yaml
# .github/workflows/pr-ci.yml
name: PR CI
on:
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - run: npm test
      - run: npm run lint
      - run: npm run build
      - run: npm run test:integration
      - run: npm run test:e2e

  # Block merge if tests fail
  required-checks:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - run: echo "All checks passed"
```

**Trunk CI (unchanged)**:
```yaml
# .github/workflows/trunk-ci.yml
name: Trunk CI
on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - run: npm test  # Final verification
      - run: ./deploy.sh production
```

**Benefit**: Catch failures in PR (not on trunk), maintaining trunk stability.

### Fast Feedback Loops

TBD requires fast CI to avoid blocking trunk:

**Target CI times**:
- Unit tests: <2 minutes
- Linting: <30 seconds
- Build: <3 minutes
- Integration tests: <5 minutes
- E2E tests: <10 minutes (run in parallel)

**Total PR CI**: <10 minutes (acceptable for TBD velocity)

**Optimization strategies**:
```yaml
# Parallel test execution
jobs:
  unit-tests:
    runs-on: ubuntu-latest
    steps:
      - run: npm run test:unit  # 2 min

  integration-tests:
    runs-on: ubuntu-latest
    steps:
      - run: npm run test:integration  # 5 min

  e2e-tests:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        shard: [1, 2, 3, 4]
    steps:
      - run: npm run test:e2e -- --shard ${{ matrix.shard }}  # 2.5 min per shard
```

**Result**: All tests complete in 5 minutes (parallelization).

---

## Short-Lived Branch Strategies

### TBD Branch Lifetime Targets

```
Ideal: <4 hours (same day merge)
Acceptable: <24 hours (next day merge)
Warning: >24 hours (violates TBD principle)
Violation: >3 days (long-lived branch)
```

### Git-Town Enforcement Patterns

**Pattern 1: Automated Branch Age Warnings**

```yaml
# .github/workflows/branch-age-check.yml
name: Branch Age Check
on:
  schedule:
    - cron: '0 */4 * * *'  # Every 4 hours

jobs:
  check-branch-age:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - name: Find old branches
        run: |
          OLD_BRANCHES=$(git branch -r --format='%(refname:short) %(committerdate:relative)' | grep -v main | grep 'day\|week\|month')
          if [ -n "$OLD_BRANCHES" ]; then
            echo "⚠️ Old branches detected (>24 hours):"
            echo "$OLD_BRANCHES"
            # Send Slack notification
            curl -X POST $SLACK_WEBHOOK -d "{\"text\": \"Old branches: $OLD_BRANCHES\"}"
          fi
```

**Pattern 2: Daily Standup Branch Report**

```bash
#!/usr/bin/env bash
# daily-branch-report.sh

echo "📊 Daily Branch Report"
echo "====================="

# Branches by age
echo "Branches <4 hours old:"
git branch -r --format='%(refname:short)' | while read branch; do
  AGE=$(git log -1 --format='%cr' $branch)
  if [[ $AGE == *"hour"* ]]; then
    echo "  ✅ $branch ($AGE)"
  fi
done

echo ""
echo "Branches >24 hours old (ACTION REQUIRED):"
git branch -r --format='%(refname:short)' | while read branch; do
  AGE=$(git log -1 --format='%cr' $branch)
  if [[ $AGE == *"day"* ]] || [[ $AGE == *"week"* ]]; then
    echo "  ⚠️ $branch ($AGE)"
  fi
done
```

**Pattern 3: Small Commit Strategy**

Break features into 2-4 hour increments:

```bash
# Bad: Large feature (2 days)
git town hack feature/complete-auth-system
# 8 hours of work
git commit -m "feat: complete auth system"
# Result: 8-hour branch lifetime ❌

# Good: Incremental features (4x 2-hour chunks)
git town hack feature/auth-backend
# 2 hours of work
git commit -m "feat: auth backend (behind flag)"
git town ship  # Ship after 4 hours total

git town hack feature/auth-ui
# 2 hours of work
git commit -m "feat: auth UI (behind flag)"
git town ship  # Ship after 4 hours total

git town hack feature/auth-integration
# 2 hours of work
git commit -m "feat: integrate auth (behind flag)"
git town ship  # Ship after 4 hours total

git town hack feature/auth-tests
# 2 hours of work
git commit -m "test: auth end-to-end tests"
git town ship  # Ship after 4 hours total

# Result: 4 branches, each <4 hours ✅
```

---

## Migration Path

### Phase 1: Assessment (Week 1)

**Evaluate current TBD practices**:

```bash
# Measure current trunk commit frequency
git log --since="1 week ago" --oneline main | wc -l
# Target: >50 commits/week (team of 5)

# Measure current branch count
git branch -r | grep -v main | wc -l
# TBD target: 0-2 active branches
# Git-town allows: 5-10 active branches (short-lived PRs)

# Measure average branch lifetime
git for-each-ref --format='%(refname:short) %(committerdate:relative)' refs/remotes/origin | grep -v main
# Target: Most branches <1 day old
```

**Questions to answer**:
- Do we have feature flags infrastructure?
- Can our CI run in <10 minutes?
- Are our PRs typically small (<200 lines)?
- Do we deploy to production multiple times per day?

### Phase 2: Install Git-Town (Week 1)

```bash
# Install git-town
brew install git-town

# Configure main branch
git town config set-main-branch main

# Test on example branch
git town hack feature/test-git-town
git commit -m "test: git-town workflow"
git town sync
git town propose --title "Test" --body "..."
git town ship
```

### Phase 3: Hybrid Workflow (Week 2)

**Allow both TBD and git-town workflows**:

```bash
# Option 1: Direct commit to main (pure TBD)
git checkout main
git commit -m "fix: typo in docs"
git push

# Option 2: Feature branch + PR (git-town)
git town hack feature/auth-endpoint
git commit -m "feat: auth endpoint (behind flag)"
git town ship  # After 4-hour review
```

**Decision criteria**:

| Change Type | Workflow | Reasoning |
|-------------|----------|-----------|
| Docs, typos, formatting | Direct to main | No risk, no review needed |
| Small bug fixes (<10 lines) | Direct to main | Low risk, fast fix |
| New features (behind flags) | Git-town PR | Code review for quality |
| Refactoring | Git-town PR | Review for correctness |
| Config changes | Git-town PR | Production impact |

### Phase 4: Team Training (Week 2)

**30-Minute Training Session**:

```markdown
# Git-Town for TBD Teams

## Why Git-Town?

We keep our TBD velocity (4-6 hour merge cycles) while adding code review.

## Workflow

1. Create branch: `git town hack feature/name`
2. Commit (1-2 hours): `git commit -m "..."`
3. Create PR: `git town propose --title "..." --body "..."`
4. Fast review (1-2 hours): Teammate reviews
5. Ship: `git town ship`

Total time: 4-6 hours (vs 1-3 days for traditional PR)

## Rules

- All branches <24 hours old
- All PRs <200 lines changed
- All features behind feature flags
- Fast PR reviews (respond in <2 hours)

## Try It

```bash
git town hack feature/test
echo "test" > test.txt
git add test.txt && git commit -m "test: git-town"
git town propose --title "Test PR" --body "Testing"
# Get approval
git town ship
```
```

### Phase 5: Full Adoption (Week 3-4)

**Update team guidelines**:

```markdown
# CONTRIBUTING.md

## Workflow

We use Trunk-Based Development with git-town for code review.

### Creating a Feature

```bash
git town hack feature/name
```

### Committing Changes

```bash
git commit -m "feat: description (behind FLAG_NAME flag)"
```

### Creating Pull Request

```bash
git town propose --title "feat: Description" --body "..."
```

**PR Rules**:
- Max 200 lines changed
- Behind feature flag (if incomplete)
- Respond to reviews in <2 hours
- Ship within 24 hours of creation

### Shipping

After PR approval:

```bash
git town ship
```

### Feature Flag Rollout

After shipping to production:

1. Enable for internal users (day 1)
2. Enable for beta users (day 2)
3. Enable for 10% of users (day 3)
4. Enable for 100% of users (day 5)
```

---

## Team Adoption

### Fast PR Review Culture

TBD with git-town requires **fast PR reviews**:

**Target**: Respond to PR in <2 hours, approve/request-changes in <4 hours

**Strategies**:

1. **PR Size Limits**:
```yaml
# .github/workflows/pr-size-check.yml
name: PR Size Check
on: pull_request

jobs:
  check-size:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - name: Check PR size
        run: |
          LINES_CHANGED=$(git diff --shortstat origin/main | awk '{print $4+$6}')
          if [ $LINES_CHANGED -gt 200 ]; then
            echo "❌ PR too large: $LINES_CHANGED lines (max 200)"
            echo "Break into smaller PRs"
            exit 1
          fi
```

2. **Slack Notifications**:
```yaml
# .github/workflows/pr-notify.yml
name: PR Notifications
on:
  pull_request:
    types: [opened]

jobs:
  notify:
    runs-on: ubuntu-latest
    steps:
      - name: Notify team
        run: |
          curl -X POST $SLACK_WEBHOOK -d '{
            "text": "🔔 New PR: ${{ github.event.pull_request.title }}",
            "blocks": [{
              "type": "section",
              "text": {
                "type": "mrkdwn",
                "text": "Review needed: <${{ github.event.pull_request.html_url }}|${{ github.event.pull_request.title }}>\nAuthor: @${{ github.event.pull_request.user.login }}"
              }
            }]
          }'
```

3. **Review Rotation**:
```markdown
# .github/CODEOWNERS

# Rotate reviewers daily
* @team-member-1  # Monday
* @team-member-2  # Tuesday
* @team-member-3  # Wednesday
* @team-member-4  # Thursday
* @team-member-5  # Friday
```

### Metrics to Track

| Metric | TBD Target | Git-Town Target | Measurement |
|--------|-----------|----------------|-------------|
| Commits to main/week | 50+ | 50+ | `git log --since="1 week ago"` |
| Branch lifetime | 0 (no branches) | <24 hours | Branch age analysis |
| PR review time | N/A | <4 hours | GitHub API |
| Deploy frequency | 10+/day | 5-10/day | CI/CD logs |
| Feature flag usage | 100% | 100% | Code analysis |

---

## Common Concerns

### Concern 1: "PRs slow down TBD velocity"

**Response**: Not with fast PR reviews and small PRs.

**Data**:
- Pure TBD: Commit → trunk in 5 minutes (no review)
- Git-town TBD: Commit → PR → review → trunk in 4 hours (with review)

**Trade-off**: 4 hours vs 5 minutes is acceptable for code quality gate.

**Mitigation**: Automate reviews where possible:
```yaml
# .github/workflows/auto-review.yml
name: Auto Review
on: pull_request

jobs:
  auto-approve-safe-changes:
    runs-on: ubuntu-latest
    steps:
      - name: Auto-approve docs/tests
        if: contains(github.event.pull_request.changed_files, 'docs/') || contains(github.event.pull_request.changed_files, 'test/')
        run: |
          gh pr review ${{ github.event.pull_request.number }} --approve -b "Auto-approved: docs/test changes"
```

### Concern 2: "Feature flags add complexity"

**Response**: Feature flags are **required** for both TBD and git-town TBD.

**Without feature flags**:
```bash
# Can't merge incomplete work
git commit -m "feat: half-finished auth system"
# ❌ Breaks production if merged
```

**With feature flags**:
```bash
# Can merge incomplete work safely
git commit -m "feat: auth backend (behind AUTH_FLAG)"
# ✅ Production unaffected, flag OFF
```

**Feature flags are not unique to git-town** - they're a TBD requirement.

### Concern 3: "Branches violate TBD principle"

**Response**: Short-lived branches (<24 hours) **are** trunk-based development.

**TBD definition (from Martin Fowler)**:
> "Developers merge their changes into trunk **at least once a day**."

**Git-town compliance**:
- Branch created: 9am
- PR created: 11am (2 hours)
- PR approved: 1pm (4 hours)
- Merged to trunk: 1pm (4 hours total)

**Result**: Merged to trunk **same day** ✅

### Concern 4: "What about hotfixes?"

**Response**: Hotfixes work the same as features (short-lived PR).

**TBD hotfix**:
```bash
# Direct commit to trunk (risky)
git checkout main
git commit -m "fix: critical security issue"
git push  # No review
```

**Git-town hotfix**:
```bash
# Fast-track PR (safer)
git town hack fix/critical-security
git commit -m "fix: critical security issue"
git town propose --title "URGENT: Security fix" --body "..."
# Fast review (30 minutes)
git town ship
# Total time: 1 hour (vs 5 minutes direct)
```

**Trade-off**: 1 hour vs 5 minutes is acceptable for critical fixes to get review.

---

## Migration Checklist

### Pre-Migration
- [ ] Verify feature flags infrastructure exists
- [ ] Ensure CI runs in <10 minutes
- [ ] Confirm team commits to trunk >10x/day
- [ ] Install git-town on all developer machines

### Week 1: Assessment & Setup
- [ ] Measure current trunk commit frequency
- [ ] Measure current branch lifetime (should be ~0)
- [ ] Configure git-town (`git town config set-main-branch main`)
- [ ] Test git-town on sample feature

### Week 2: Hybrid Workflow
- [ ] Allow direct commits for low-risk changes (docs, typos)
- [ ] Require PRs for features and refactoring
- [ ] Enforce <200 line PR limit
- [ ] Track PR review times (target <4 hours)

### Week 3-4: Full Adoption
- [ ] Update CONTRIBUTING.md with git-town workflow
- [ ] Add PR size limits to CI
- [ ] Add branch age warnings to CI
- [ ] Celebrate maintained TBD velocity with added code review

---

## Additional Resources

- **Trunk-Based Development**: https://trunkbaseddevelopment.com/
- **Feature Flags**: https://martinfowler.com/articles/feature-toggles.html
- **Git-town Documentation**: https://www.git-town.com/
- **LaunchDarkly**: https://launchdarkly.com/
- **Onboarding Guide**: See `onboarding.md` in this directory

---

*Last updated: 2025-12-31*
*Migration guide for adding PR-based review to trunk-based development*
