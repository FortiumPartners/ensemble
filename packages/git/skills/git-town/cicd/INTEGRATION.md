# CI/CD Integration Guide

> Integrate git-town workflows with continuous integration and deployment pipelines

**Applies to**: GitHub Actions, GitLab CI, CircleCI, Jenkins, Azure Pipelines, Bitbucket Pipelines

---

## Table of Contents

1. [CI/CD Fundamentals](#cicd-fundamentals)
2. [Pipeline Architecture](#pipeline-architecture)
3. [PR Validation Stage](#pr-validation-stage)
4. [Trunk Deployment Stage](#trunk-deployment-stage)
5. [Status Checks & Branch Protection](#status-checks--branch-protection)
6. [Automated Merge Strategies](#automated-merge-strategies)
7. [Deployment Triggers](#deployment-triggers)
8. [Platform-Specific Examples](#platform-specific-examples)

---

## CI/CD Fundamentals

### Git-Town Compatible Pipeline Model

Git-town works with standard CI/CD pipeline patterns:

```
┌─────────────────────────────────────────────────────┐
│ Git-Town CI/CD Pipeline                            │
└─────────────────────────────────────────────────────┘

Feature Branch (PR)
│
├─ Validation Pipeline
│  ├─ Lint
│  ├─ Test
│  ├─ Build
│  └─ Security Scan
│
└─ PR Merged to Main
   │
   └─ Deployment Pipeline
      ├─ Build Artifacts
      ├─ Deploy to Staging
      ├─ Integration Tests
      └─ Deploy to Production
```

**Key Insight**: Git-town doesn't require custom CI/CD configuration. It uses standard git primitives (branches, PRs, merges) that all CI/CD platforms understand.

### Workflow Integration Points

Git-town commands interact with CI/CD at specific points:

| Git-Town Command | CI/CD Trigger | Pipeline Type |
|-----------------|---------------|---------------|
| `git town hack` | Branch created | (Optional) Preview environment |
| `git town sync` | Branch updated | PR validation (re-run) |
| `git town propose` | PR opened | PR validation (initial run) |
| `git town ship` | Merged to main | Trunk deployment |

---

## Pipeline Architecture

### Two-Stage Pipeline Pattern

Most git-town workflows use a two-stage pipeline:

**Stage 1: PR Validation** (runs on feature branches)
```yaml
on:
  pull_request:
    branches: [main]

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - Checkout code
      - Install dependencies
      - Run linters
      - Run tests
      - Build application
      - Security scanning
```

**Stage 2: Trunk Deployment** (runs on main branch)
```yaml
on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - Checkout code
      - Build production artifacts
      - Deploy to staging
      - Run smoke tests
      - Deploy to production
```

### Parallel Pipeline Pattern

For faster feedback, run jobs in parallel:

```yaml
on:
  pull_request:
    branches: [main]

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - Lint code (2 min)

  test-unit:
    runs-on: ubuntu-latest
    steps:
      - Run unit tests (3 min)

  test-integration:
    runs-on: ubuntu-latest
    steps:
      - Run integration tests (5 min)

  test-e2e:
    runs-on: ubuntu-latest
    steps:
      - Run E2E tests (8 min)

  security:
    runs-on: ubuntu-latest
    steps:
      - Security scan (4 min)

# All jobs run in parallel
# Total time: 8 min (vs 22 min sequential)
```

### Matrix Strategy Pattern

Test across multiple environments:

```yaml
on:
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ${{ matrix.os }}
    strategy:
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]
        node: [18, 20, 22]
    steps:
      - Setup Node ${{ matrix.node }}
      - Run tests

# 9 parallel jobs (3 OS × 3 Node versions)
```

---

## PR Validation Stage

### Purpose

Validate feature branches **before** merging to main:
- ✅ Code quality (linting)
- ✅ Test coverage
- ✅ Build success
- ✅ Security vulnerabilities
- ✅ Breaking changes

### Basic PR Validation

```yaml
# .github/workflows/pr-validation.yml
name: PR Validation

on:
  pull_request:
    branches: [main]

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@v3
        with:
          fetch-depth: 0  # Full history for git-town

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Lint code
        run: npm run lint

      - name: Run tests
        run: npm test -- --coverage

      - name: Build application
        run: npm run build

      - name: Upload coverage
        uses: codecov/codecov-action@v3
        with:
          files: ./coverage/coverage-final.json
```

### Advanced PR Validation

```yaml
# .github/workflows/pr-validation.yml
name: PR Validation

on:
  pull_request:
    branches: [main]

jobs:
  # Job 1: Code Quality
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '20'
      - run: npm ci
      - run: npm run lint
      - run: npm run format:check

  # Job 2: Type Checking
  typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm ci
      - run: npm run typecheck

  # Job 3: Unit Tests
  test-unit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm ci
      - run: npm run test:unit
      - uses: codecov/codecov-action@v3

  # Job 4: Integration Tests
  test-integration:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_PASSWORD: postgres
        ports:
          - 5432:5432
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm ci
      - run: npm run test:integration

  # Job 5: E2E Tests
  test-e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm ci
      - run: npm run build
      - run: npm run test:e2e
      - uses: actions/upload-artifact@v3
        if: failure()
        with:
          name: playwright-report
          path: playwright-report/

  # Job 6: Security Scan
  security:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - run: npm audit --audit-level=moderate
      - uses: snyk/actions/node@master
        env:
          SNYK_TOKEN: ${{ secrets.SNYK_TOKEN }}

  # Job 7: Build
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm ci
      - run: npm run build
      - uses: actions/upload-artifact@v3
        with:
          name: build-artifacts
          path: dist/

  # Required Checks Gate
  required-checks:
    needs: [lint, typecheck, test-unit, test-integration, test-e2e, security, build]
    runs-on: ubuntu-latest
    steps:
      - run: echo "All required checks passed ✅"
```

### PR Size Limits

Enforce small PRs for fast reviews:

```yaml
# .github/workflows/pr-size-check.yml
name: PR Size Check

on:
  pull_request:
    branches: [main]

jobs:
  check-size:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
        with:
          fetch-depth: 0

      - name: Check PR size
        run: |
          LINES_CHANGED=$(git diff --shortstat origin/main...HEAD | awk '{print $4+$6}')
          echo "Lines changed: $LINES_CHANGED"

          if [ $LINES_CHANGED -gt 500 ]; then
            echo "❌ PR too large: $LINES_CHANGED lines (max 500)"
            echo "Please break into smaller PRs for faster review"
            exit 1
          fi

          echo "✅ PR size acceptable: $LINES_CHANGED lines"
```

---

## Trunk Deployment Stage

### Purpose

Deploy main branch **after** PR merges:
- ✅ Build production artifacts
- ✅ Deploy to staging environment
- ✅ Run smoke tests
- ✅ Deploy to production
- ✅ Monitor health metrics

### Basic Trunk Deployment

```yaml
# .github/workflows/deploy.yml
name: Deploy to Production

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '20'

      - name: Install dependencies
        run: npm ci

      - name: Build production
        run: npm run build
        env:
          NODE_ENV: production

      - name: Deploy to production
        run: |
          # Example: Deploy to Vercel
          npx vercel --prod --token=${{ secrets.VERCEL_TOKEN }}

      - name: Notify deployment
        run: |
          curl -X POST ${{ secrets.SLACK_WEBHOOK }} \
            -d "{\"text\": \"✅ Deployed to production: ${{ github.sha }}\"}"
```

### Multi-Stage Deployment

Deploy to staging, test, then production:

```yaml
# .github/workflows/deploy.yml
name: Deploy

on:
  push:
    branches: [main]

jobs:
  # Stage 1: Build
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm ci
      - run: npm run build
      - uses: actions/upload-artifact@v3
        with:
          name: build
          path: dist/

  # Stage 2: Deploy to Staging
  deploy-staging:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: staging
      url: https://staging.example.com
    steps:
      - uses: actions/download-artifact@v3
        with:
          name: build
          path: dist/

      - name: Deploy to staging
        run: |
          # Example: AWS S3 + CloudFront
          aws s3 sync dist/ s3://staging-bucket/
          aws cloudfront create-invalidation --distribution-id $STAGING_DIST

  # Stage 3: Smoke Tests on Staging
  smoke-tests:
    needs: deploy-staging
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm ci
      - run: npm run test:smoke -- --url=https://staging.example.com

  # Stage 4: Deploy to Production
  deploy-production:
    needs: smoke-tests
    runs-on: ubuntu-latest
    environment:
      name: production
      url: https://example.com
    steps:
      - uses: actions/download-artifact@v3
        with:
          name: build
          path: dist/

      - name: Deploy to production
        run: |
          aws s3 sync dist/ s3://production-bucket/
          aws cloudfront create-invalidation --distribution-id $PRODUCTION_DIST

      - name: Verify deployment
        run: |
          curl -f https://example.com/health || exit 1

      - name: Notify success
        run: |
          curl -X POST ${{ secrets.SLACK_WEBHOOK }} \
            -d "{\"text\": \"✅ Deployed to production\"}"
```

---

## Status Checks & Branch Protection

### Branch Protection Rules

Configure branch protection to enforce CI/CD gates:

**GitHub Branch Protection Settings**:
```
Settings → Branches → Branch protection rules → Add rule

Rule name: main

✅ Require pull request reviews (1 reviewer)
✅ Require status checks to pass before merging
   - Required checks:
     ✓ lint
     ✓ typecheck
     ✓ test-unit
     ✓ test-integration
     ✓ test-e2e
     ✓ security
     ✓ build
✅ Require branches to be up to date
✅ Require conversation resolution before merging
✅ Do not allow bypassing the above settings
```

**Git-town integration**:
```bash
# Git-town respects branch protection
git town ship
# Error: PR has failing status checks
# Fix: Wait for CI to pass, or fix failures

# After CI passes:
git town ship
# Success: Merges to main (branch protection satisfied)
```

### Required Status Checks

Define required checks in CI configuration:

```yaml
# .github/workflows/required-checks.yml
name: Required Checks

on:
  pull_request:
    branches: [main]

jobs:
  # This job name must match branch protection settings
  required-checks:
    runs-on: ubuntu-latest
    needs: [lint, test-unit, test-integration, build]
    steps:
      - run: echo "All required checks passed ✅"
```

**Branch protection reference**:
```
Required status check: "required-checks"
```

### Auto-Merge with Status Checks

Enable auto-merge after checks pass:

```yaml
# .github/workflows/auto-merge.yml
name: Auto-Merge

on:
  pull_request:
    types: [opened, synchronize]

jobs:
  auto-merge:
    runs-on: ubuntu-latest
    if: github.actor == 'dependabot[bot]'
    steps:
      - name: Enable auto-merge
        run: gh pr merge --auto --squash "${{ github.event.pull_request.number }}"
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

**Git-town alternative**:
```bash
# Manual: Wait for checks, then ship
git town propose
# ... CI runs ...
# ... after checks pass ...
git town ship

# Automated: Enable auto-merge via GitHub API
git town propose
gh pr merge --auto --squash
# PR auto-merges when checks pass
```

---

## Automated Merge Strategies

### Strategy 1: Dependabot Auto-Merge

Automatically merge dependency updates:

```yaml
# .github/workflows/dependabot-auto-merge.yml
name: Dependabot Auto-Merge

on:
  pull_request:
    types: [opened, synchronize]

jobs:
  auto-merge:
    runs-on: ubuntu-latest
    if: github.actor == 'dependabot[bot]'
    steps:
      - name: Approve PR
        run: gh pr review "${{ github.event.pull_request.number }}" --approve
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}

      - name: Enable auto-merge
        run: gh pr merge --auto --squash "${{ github.event.pull_request.number }}"
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

**Requires**:
- Branch protection with required status checks
- Dependabot enabled
- Auto-merge enabled in repository settings

### Strategy 2: Auto-Ship on Green CI

Automatically ship PRs when CI passes (use with caution):

```yaml
# .github/workflows/auto-ship.yml
name: Auto-Ship on Green CI

on:
  check_suite:
    types: [completed]

jobs:
  auto-ship:
    runs-on: ubuntu-latest
    if: |
      github.event.check_suite.conclusion == 'success' &&
      contains(github.event.check_suite.pull_requests[0].labels.*.name, 'auto-ship')
    steps:
      - uses: actions/checkout@v3

      - name: Install git-town
        run: brew install git-town

      - name: Ship PR
        run: |
          PR_NUMBER=${{ github.event.check_suite.pull_requests[0].number }}
          gh pr merge $PR_NUMBER --squash
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

**Usage**:
```bash
# Create PR with auto-ship label
git town propose --title "..." --body "..."
gh pr edit --add-label "auto-ship"

# When CI passes, PR auto-ships
```

### Strategy 3: Bors-style Merge Queue

Use merge queue to batch merges:

```yaml
# .github/workflows/merge-queue.yml
name: Merge Queue

on:
  pull_request:
    types: [labeled]

jobs:
  queue:
    runs-on: ubuntu-latest
    if: contains(github.event.pull_request.labels.*.name, 'queue')
    steps:
      - name: Add to merge queue
        run: |
          # Add PR to queue
          gh pr comment "${{ github.event.pull_request.number }}" \
            --body "Added to merge queue. Will merge when CI passes."
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}

      - name: Wait for CI
        # Custom logic to wait for checks

      - name: Merge
        run: gh pr merge "${{ github.event.pull_request.number }}" --squash
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

---

## Deployment Triggers

### Trigger 1: Main Branch Push

Deploy on every main branch push (continuous deployment):

```yaml
on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - Deploy to production
```

**Git-town workflow**:
```bash
git town ship  # Merges to main
# Triggers deployment pipeline automatically
```

### Trigger 2: Semantic Versioning Tags

Deploy on version tags:

```yaml
on:
  push:
    tags:
      - 'v*.*.*'  # Matches v1.0.0, v2.1.3, etc.

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - Build release artifacts
      - Create GitHub release
      - Deploy to production
```

**Git-town workflow**:
```bash
# Ship feature
git town ship

# Tag release (manual or via semantic-release)
git checkout main
git pull
git tag -a v1.2.0 -m "Release 1.2.0"
git push --tags

# Triggers release pipeline
```

### Trigger 3: Manual Workflow Dispatch

Deploy on-demand via GitHub UI:

```yaml
on:
  workflow_dispatch:
    inputs:
      environment:
        description: 'Environment to deploy to'
        required: true
        type: choice
        options:
          - staging
          - production
      version:
        description: 'Version to deploy'
        required: true

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - Checkout ${{ github.event.inputs.version }}
      - Deploy to ${{ github.event.inputs.environment }}
```

**Git-town workflow**:
```bash
# Ship feature to main
git town ship

# Manual deployment trigger via GitHub UI:
# Actions → Deploy → Run workflow
# - Environment: production
# - Version: v1.2.0
```

### Trigger 4: Schedule-Based Deploys

Deploy on a schedule (e.g., daily releases):

```yaml
on:
  schedule:
    - cron: '0 10 * * *'  # 10 AM UTC daily

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - Checkout main
      - Tag with date (v2024.12.31)
      - Deploy to production
```

**Git-town workflow**:
```bash
# Developers ship features throughout the day
git town ship  # Feature 1
git town ship  # Feature 2
git town ship  # Feature 3

# Daily deployment pipeline runs at 10 AM
# - Tags main branch with date
# - Deploys all features from past 24 hours
```

---

## Platform-Specific Examples

### GitHub Actions

See `examples/github-actions.yml` for complete GitHub Actions configuration.

### GitLab CI

See `examples/gitlab-ci.yml` for complete GitLab CI configuration.

### CircleCI

```yaml
# .circleci/config.yml
version: 2.1

workflows:
  pr-validation:
    jobs:
      - lint
      - test-unit
      - test-integration
      - build

  deploy:
    jobs:
      - deploy-staging:
          filters:
            branches:
              only: main
      - smoke-tests:
          requires:
            - deploy-staging
      - deploy-production:
          requires:
            - smoke-tests

jobs:
  lint:
    docker:
      - image: node:20
    steps:
      - checkout
      - run: npm ci
      - run: npm run lint

  test-unit:
    docker:
      - image: node:20
    steps:
      - checkout
      - run: npm ci
      - run: npm test

  build:
    docker:
      - image: node:20
    steps:
      - checkout
      - run: npm ci
      - run: npm run build
      - persist_to_workspace:
          root: .
          paths:
            - dist

  deploy-production:
    docker:
      - image: node:20
    steps:
      - attach_workspace:
          at: .
      - run: npm run deploy:production
```

### Jenkins

```groovy
// Jenkinsfile
pipeline {
  agent any

  stages {
    stage('Checkout') {
      steps {
        checkout scm
      }
    }

    stage('Install') {
      steps {
        sh 'npm ci'
      }
    }

    stage('Validate') {
      parallel {
        stage('Lint') {
          steps {
            sh 'npm run lint'
          }
        }
        stage('Test') {
          steps {
            sh 'npm test'
          }
        }
        stage('Build') {
          steps {
            sh 'npm run build'
          }
        }
      }
    }

    stage('Deploy') {
      when {
        branch 'main'
      }
      steps {
        sh 'npm run deploy:production'
      }
    }
  }

  post {
    success {
      slackSend(
        color: 'good',
        message: "Deployed ${env.GIT_COMMIT} to production"
      )
    }
  }
}
```

---

## Best Practices

### 1. Fast Feedback Loops

Target CI times:
- PR validation: <10 minutes
- Trunk deployment: <15 minutes

**Strategies**:
- Parallel job execution
- Dependency caching
- Incremental builds
- Test sharding

### 2. Fail Fast

Order jobs by speed and failure likelihood:

```yaml
jobs:
  1-lint:        # 1 min, high failure rate
  2-typecheck:   # 2 min, medium failure rate
  3-test-unit:   # 3 min, medium failure rate
  4-test-integration:  # 5 min, low failure rate
  5-test-e2e:    # 10 min, low failure rate
```

### 3. Cache Dependencies

```yaml
- uses: actions/setup-node@v3
  with:
    cache: 'npm'  # Automatic caching

# Or manual caching
- uses: actions/cache@v3
  with:
    path: ~/.npm
    key: ${{ runner.os }}-node-${{ hashFiles('**/package-lock.json') }}
```

### 4. Matrix Testing

Test across environments:

```yaml
strategy:
  matrix:
    os: [ubuntu-latest, macos-latest]
    node: [18, 20, 22]
```

### 5. Deployment Gates

Require manual approval for production:

```yaml
deploy-production:
  environment:
    name: production
  # Requires GitHub environment protection rules:
  # - Required reviewers
  # - Wait timer
```

---

## Troubleshooting

### Issue: "CI runs twice on PR creation"

**Cause**: Both `pull_request` and `push` triggers fire

**Solution**: Use only `pull_request` for PRs

```yaml
# Bad: Runs twice
on: [push, pull_request]

# Good: Runs once
on:
  pull_request:
    branches: [main]
```

### Issue: "Deployment fails after git town ship"

**Cause**: CI configured for PR branches, not main

**Solution**: Add main branch trigger

```yaml
# Add deployment for main branch
on:
  push:
    branches: [main]
```

### Issue: "Branch protection blocks git town ship"

**Cause**: Required status checks haven't passed

**Solution**: Wait for CI to pass

```bash
# Check PR status
gh pr view

# Wait for checks
# Then ship
git town ship
```

---

## Additional Resources

- **GitHub Actions**: See `examples/github-actions.yml`
- **GitLab CI**: See `examples/gitlab-ci.yml`
- **Branch Protection**: GitHub docs on protected branches
- **Status Checks**: GitHub docs on required status checks

---

*Last updated: 2025-12-31*
*CI/CD integration patterns for git-town workflows*
