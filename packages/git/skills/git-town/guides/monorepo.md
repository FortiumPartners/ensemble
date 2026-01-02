# Git-Town for Monorepos

> Feature branch workflows in multi-package repositories

**Applies to**: npm workspaces, Yarn workspaces, pnpm workspaces, Nx, Turborepo, Lerna

---

## Table of Contents

1. [Monorepo Fundamentals](#monorepo-fundamentals)
2. [Git-Town in Monorepos](#git-town-in-monorepos)
3. [Feature Branch Strategies](#feature-branch-strategies)
4. [Shared Configuration](#shared-configuration)
5. [Independent Versioning](#independent-versioning)
6. [Workspace Integration](#workspace-integration)
7. [CI/CD Patterns](#cicd-patterns)
8. [Common Scenarios](#common-scenarios)

---

## Monorepo Fundamentals

### What is a Monorepo?

A monorepo is a single git repository containing multiple related packages or applications:

```
monorepo/
├── packages/
│   ├── core/           # Shared library
│   ├── web-app/        # Frontend application
│   ├── api/            # Backend API
│   ├── mobile/         # Mobile app
│   └── admin/          # Admin panel
├── package.json        # Root workspace config
└── pnpm-workspace.yaml
```

**Benefits**:
- ✅ Shared tooling and configuration
- ✅ Atomic commits across packages
- ✅ Simplified dependency management
- ✅ Easier code sharing

**Challenges**:
- ⚠️ Larger repository size
- ⚠️ Slower CI/CD (without optimization)
- ⚠️ Complex release workflows
- ⚠️ Per-package vs whole-repo changes

### Monorepo Tools

| Tool | Package Manager | Best For |
|------|----------------|----------|
| npm workspaces | npm | Simple monorepos, native solution |
| Yarn workspaces | Yarn | Medium complexity, fast installs |
| pnpm workspaces | pnpm | Large monorepos, disk efficiency |
| Nx | Any | Enterprise monorepos, build orchestration |
| Turborepo | Any | Fast builds, remote caching |
| Lerna | Any | Independent versioning, legacy |

---

## Git-Town in Monorepos

### Single Main Branch

Git-town uses **one main branch** for the entire monorepo:

```
main
├── packages/core@1.2.0
├── packages/web-app@2.3.1
├── packages/api@1.5.0
└── packages/mobile@0.8.2
```

**Key principle**: All packages share the same git history.

### Configuration

Set up git-town **once** at repository root:

```bash
# At monorepo root
cd /path/to/monorepo

# Configure main branch (applies to all packages)
git town config set-main-branch main

# Verify configuration
git town config
# Main branch: main
# Perennial branches: (none)
```

**No per-package git-town configuration needed**.

### Basic Workflow

Git-town workflows apply to **entire repository**, not individual packages:

```bash
# Create feature branch (entire repo)
git town hack feature/update-api

# Make changes to specific packages
cd packages/api
# Edit files
git add .
git commit -m "feat(api): add new endpoint"

cd ../web-app
# Edit files
git add .
git commit -m "feat(web-app): consume new API endpoint"

# Ship entire feature branch
git town ship
```

---

## Feature Branch Strategies

### Strategy 1: Package-Scoped Branches

**Use when**: Changes affect single package

```bash
# Feature for one package
git town hack feature/api-authentication

# Changes only in packages/api/
cd packages/api
# ... make changes ...
git commit -m "feat(api): add JWT authentication"

# PR description makes scope clear
git town propose \
  --title "feat(api): JWT authentication" \
  --body "Adds JWT authentication to API package only"
```

**Branch naming convention**:
```
feature/<package>-<description>
fix/<package>-<description>

Examples:
feature/api-jwt-auth
fix/web-app-login-bug
refactor/core-utils
```

### Strategy 2: Cross-Package Branches

**Use when**: Changes affect multiple packages (most common in monorepos)

```bash
# Feature spanning multiple packages
git town hack feature/user-authentication

# Changes in core library
cd packages/core
git commit -m "feat(core): add auth utilities"

# Changes in API
cd ../api
git commit -m "feat(api): add auth endpoints"

# Changes in web-app
cd ../web-app
git commit -m "feat(web-app): add login UI"

# Single PR for entire feature
git town propose \
  --title "feat: User authentication" \
  --body "Adds user authentication across core, api, and web-app packages"
```

**Branch naming convention**:
```
feature/<feature-name>
fix/<issue-description>

Examples:
feature/user-authentication
fix/memory-leak
refactor/typescript-migration
```

### Strategy 3: Stacked Package Changes

**Use when**: Packages have dependencies on each other

```bash
# Step 1: Update core library
git town hack feature/core-api-changes
cd packages/core
git commit -m "feat(core): add new data structures"
git town ship

# Step 2: Update API (depends on core changes)
git town hack feature/api-use-new-structures
cd packages/api
git commit -m "feat(api): use new data structures from core"
git town ship

# Step 3: Update web-app (depends on API changes)
git town hack feature/web-app-consume-api
cd packages/web-app
git commit -m "feat(web-app): consume updated API"
git town ship
```

**Advantage**: Each package can be tested independently before dependent changes.

### Branch Naming Best Practices

**Recommended format**:
```
<type>/<scope>-<description>

Types: feature, fix, refactor, docs, test, chore
Scope: Package name or "multi" for cross-package
Description: kebab-case summary
```

**Examples**:
```
feature/api-graphql-support
fix/web-app-responsive-layout
refactor/multi-typescript-upgrade
docs/core-api-reference
test/api-integration-tests
chore/multi-dependency-updates
```

**Benefits**:
- Clear scope (which packages affected)
- Easy filtering (`git branch --list 'feature/api-*'`)
- Consistent with conventional commits

---

## Shared Configuration

### Git-Town Configuration

Git-town configuration is **shared** across all packages:

```bash
# Configure at root (applies to all packages)
git town config set-main-branch main

# Configuration stored in .git/config (not committed)
cat .git/config
# [git-town]
#   main-branch = main
```

**No per-package configuration needed**.

### Shared Team Configuration

**Option 1: Commit configuration file** (recommended for teams)

```toml
# .git-town.toml (committed to repository)
[git-town]
main-branch = "main"
perennial-branches = []
push-new-branches = true
ship-delete-remote-branch = true
sync-strategy = "rebase"
```

**Team members import after clone**:
```bash
git clone <monorepo-url>
cd monorepo
git town config --import .git-town.toml
```

**Option 2: Setup script**

```bash
#!/usr/bin/env bash
# scripts/setup-git-town.sh

# Install git-town
if ! command -v git-town &> /dev/null; then
    echo "Installing git-town..."
    brew install git-town
fi

# Configure git-town
git town config set-main-branch main
git town config set-perennial-branches ""
git town config push-new-branches true

echo "✅ Git-town configured for monorepo"
```

**Usage**:
```bash
# After cloning
git clone <monorepo-url>
cd monorepo
bash scripts/setup-git-town.sh
```

---

## Independent Versioning

### Versioning Strategies

**Strategy 1: Fixed Versioning** (all packages same version)

```json
// packages/*/package.json
{
  "name": "@monorepo/core",
  "version": "1.5.0"  // All packages: 1.5.0
}
```

**Strategy 2: Independent Versioning** (packages have different versions)

```json
// packages/core/package.json
{
  "name": "@monorepo/core",
  "version": "2.3.1"
}

// packages/api/package.json
{
  "name": "@monorepo/api",
  "version": "1.8.0"
}
```

### Git-Town with Semantic Release

**Automated versioning** based on conventional commits:

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
        with:
          fetch-depth: 0

      - name: Setup Node
        uses: actions/setup-node@v2

      - name: Install dependencies
        run: pnpm install

      - name: Release
        run: |
          # Semantic release for each package
          npx lerna exec --concurrency 1 -- semantic-release -e semantic-release-monorepo
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          NPM_TOKEN: ${{ secrets.NPM_TOKEN }}
```

**Conventional commits drive versioning**:
```bash
# Create feature branch
git town hack feature/api-endpoint

# Commit with conventional format
git commit -m "feat(api): add user search endpoint"
# Result on main: api@1.8.0 → api@1.9.0 (minor bump)

git commit -m "fix(web-app): resolve login redirect"
# Result on main: web-app@2.3.0 → web-app@2.3.1 (patch bump)

git commit -m "feat(core)!: breaking API change"
# Result on main: core@2.3.1 → core@3.0.0 (major bump)
```

### Changesets Integration

**Alternative to semantic-release** for monorepos:

```bash
# Install changesets
pnpm add -DW @changesets/cli
pnpm changeset init

# Create feature branch
git town hack feature/api-enhancement

# Make changes to API package
cd packages/api
# ... edit files ...

# Add changeset (describes change + version bump)
pnpm changeset
# ┌───────────────────────────────────────────────────┐
# │ What packages should be included?                 │
# │ ◉ @monorepo/api                                   │
# │ ◯ @monorepo/core                                  │
# └───────────────────────────────────────────────────┘
#
# What kind of change? (minor - new feature)
# Summary: Add user search endpoint

# Commit changeset
git add .changeset/
git commit -m "feat(api): add user search endpoint"

# Ship feature
git town ship

# On main, CI publishes releases
# Changesets automatically:
# - Bumps version (api@1.8.0 → api@1.9.0)
# - Updates CHANGELOG.md
# - Creates GitHub release
# - Publishes to npm
```

---

## Workspace Integration

### NPM Workspaces

```json
// package.json (root)
{
  "name": "monorepo",
  "workspaces": [
    "packages/*"
  ]
}
```

**Git-town workflow**:
```bash
# Create feature branch
git town hack feature/update-dependencies

# Update dependency in workspace
cd packages/web-app
npm install lodash@latest

# Affects root package-lock.json
git add package.json package-lock.json ../../package-lock.json
git commit -m "chore(web-app): update lodash"

# Ship
git town ship
```

### Pnpm Workspaces

```yaml
# pnpm-workspace.yaml
packages:
  - 'packages/*'
  - 'apps/*'
```

**Git-town workflow**:
```bash
# Create feature branch
git town hack feature/shared-component

# Add shared component to core
cd packages/core
# ... create component ...
git commit -m "feat(core): add Button component"

# Use component in web-app
cd ../../apps/web-app
pnpm add @monorepo/core@workspace:*
git commit -m "feat(web-app): use shared Button component"

# Ship entire feature
git town ship
```

### Nx Monorepo

```json
// nx.json
{
  "affected": {
    "defaultBase": "main"
  }
}
```

**Git-town with Nx affected**:
```bash
# Create feature branch
git town hack feature/api-enhancement

# Make changes to API
cd apps/api
# ... edit files ...
git commit -m "feat(api): add caching"

# Test only affected projects
npx nx affected:test --base=main
npx nx affected:build --base=main

# Ship
git town ship

# CI runs nx affected on main
# Only builds/tests changed packages
```

### Turborepo

```json
// turbo.json
{
  "pipeline": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    }
  }
}
```

**Git-town with Turborepo**:
```bash
# Create feature branch
git town hack feature/performance-optimization

# Make changes across packages
git commit -m "perf(core): optimize data structures"
git commit -m "perf(api): use optimized core"

# Build with caching
npx turbo run build --filter=...main

# Ship
git town ship

# CI benefits from remote caching
```

---

## CI/CD Patterns

### Pattern 1: Affected Packages Only

Run tests/builds only for changed packages:

```yaml
# .github/workflows/ci.yml
name: CI
on:
  pull_request:
    branches: [main]

jobs:
  detect-changes:
    runs-on: ubuntu-latest
    outputs:
      packages: ${{ steps.changed.outputs.packages }}
    steps:
      - uses: actions/checkout@v2
        with:
          fetch-depth: 0

      - name: Detect changed packages
        id: changed
        run: |
          # Use git diff to find changed packages
          CHANGED_PACKAGES=$(git diff --name-only origin/main...HEAD | grep '^packages/' | cut -d'/' -f2 | sort -u | jq -R -s -c 'split("\n")[:-1]')
          echo "packages=$CHANGED_PACKAGES" >> $GITHUB_OUTPUT

  test:
    needs: detect-changes
    runs-on: ubuntu-latest
    strategy:
      matrix:
        package: ${{ fromJSON(needs.detect-changes.outputs.packages) }}
    steps:
      - uses: actions/checkout@v2
      - name: Test ${{ matrix.package }}
        run: |
          cd packages/${{ matrix.package }}
          npm test
```

### Pattern 2: Nx Affected

```yaml
# .github/workflows/ci.yml
name: CI
on:
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
        with:
          fetch-depth: 0

      - name: Derive appropriate SHAs for base and head
        uses: nrwl/nx-set-shas@v2

      - name: Test affected projects
        run: npx nx affected:test --parallel=3

      - name: Build affected projects
        run: npx nx affected:build --parallel=3
```

### Pattern 3: Turborepo Remote Caching

```yaml
# .github/workflows/ci.yml
name: CI
on:
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2

      - name: Setup pnpm
        uses: pnpm/action-setup@v2

      - name: Install dependencies
        run: pnpm install

      - name: Run tests (with remote caching)
        run: pnpm turbo run test --cache-dir=.turbo
        env:
          TURBO_TOKEN: ${{ secrets.TURBO_TOKEN }}
          TURBO_TEAM: ${{ secrets.TURBO_TEAM }}

      - name: Upload cache
        if: always()
        uses: actions/cache@v2
        with:
          path: .turbo
          key: turbo-${{ github.sha }}
```

---

## Common Scenarios

### Scenario 1: Update Shared Dependency

**Goal**: Update a dependency used across all packages

```bash
# Create feature branch
git town hack chore/update-typescript

# Update TypeScript in all packages
pnpm add -DW typescript@latest

# Update package.json in each package
cd packages/core
pnpm add -D typescript@latest

cd ../api
pnpm add -D typescript@latest

# Fix any breaking changes
# ... edit files ...

# Commit all changes
git add .
git commit -m "chore: update TypeScript to 5.0.0"

# Ship
git town ship
```

### Scenario 2: Add New Package

**Goal**: Add new package to monorepo

```bash
# Create feature branch
git town hack feature/add-mobile-package

# Create package directory
mkdir -p packages/mobile
cd packages/mobile

# Initialize package
pnpm init
# Edit package.json

# Add dependencies
pnpm add react react-native

# Configure build
# ... create src/, tsconfig.json, etc ...

# Update root workspace config
cd ../..
# Edit pnpm-workspace.yaml or package.json workspaces

# Commit new package
git add packages/mobile
git commit -m "feat: add mobile package"

# Ship
git town ship
```

### Scenario 3: Breaking Change in Core Package

**Goal**: Make breaking change to core, update dependents

```bash
# Create feature branch
git town hack refactor/core-api-v2

# Make breaking change to core
cd packages/core
# ... edit files ...
git commit -m "feat(core)!: breaking API change to data structures"

# Update API (depends on core)
cd ../api
# ... update imports ...
git commit -m "refactor(api): use new core API"

# Update web-app (depends on core)
cd ../web-app
# ... update imports ...
git commit -m "refactor(web-app): use new core API"

# Ship entire refactor as one PR
git town ship

# Semantic release automatically:
# - Bumps core to 3.0.0 (breaking change)
# - Bumps api to 2.0.0 (breaking dependency)
# - Bumps web-app to 2.0.0 (breaking dependency)
```

### Scenario 4: Hotfix in Production

**Goal**: Fix critical bug in one package

```bash
# Create hotfix branch
git town hack fix/api-security-vulnerability

# Fix vulnerability in API package only
cd packages/api
# ... patch security issue ...
git commit -m "fix(api): patch security vulnerability CVE-2023-1234"

# Fast-track PR review
git town propose \
  --title "URGENT: Security fix for API" \
  --body "Patches CVE-2023-1234 in API package"

# Ship after approval
git town ship

# CI automatically:
# - Runs tests for API package only (affected)
# - Bumps api@1.8.0 → api@1.8.1 (patch)
# - Deploys API to production
# - Other packages unaffected
```

### Scenario 5: Experimental Feature Behind Flag

**Goal**: Add experimental feature, deploy incrementally

```bash
# Create feature branch
git town hack feature/experimental-search

# Add feature flag to core
cd packages/core
cat >> src/flags.ts <<EOF
export const FLAGS = {
  EXPERIMENTAL_SEARCH: process.env.FEATURE_SEARCH === 'true'
};
EOF
git commit -m "feat(core): add EXPERIMENTAL_SEARCH flag"

# Implement search in API (behind flag)
cd ../api
cat >> src/search.ts <<EOF
import { FLAGS } from '@monorepo/core';

export function search(query: string) {
  if (!FLAGS.EXPERIMENTAL_SEARCH) {
    throw new Error('Search not enabled');
  }
  // ... search implementation ...
}
EOF
git commit -m "feat(api): add search API (behind flag)"

# Add search UI in web-app (behind flag)
cd ../web-app
# ... implement search UI ...
git commit -m "feat(web-app): add search UI (behind flag)"

# Ship to production (flag OFF)
git town ship

# Incrementally enable:
# Day 1: Internal users (FEATURE_SEARCH=true in staging)
# Day 3: Beta users (10% rollout in production)
# Day 7: All users (100% rollout)
```

---

## Migration Guide

### Migrating to Git-Town

**Step 1: Install git-town**
```bash
brew install git-town
```

**Step 2: Configure at root**
```bash
cd /path/to/monorepo
git town config set-main-branch main
```

**Step 3: Test on existing branch**
```bash
# Convert existing feature branch
git checkout feature/existing-work
git town config set-parent feature/existing-work main

# Test workflow
git town sync
git town propose --title "..." --body "..."
git town ship
```

**Step 4: Update team documentation**
```markdown
# CONTRIBUTING.md

## Monorepo Workflow

We use git-town for feature branch management.

### Creating a Feature

```bash
git town hack feature/<scope>-<description>
```

Scope: Package name or "multi" for cross-package changes

### Daily Sync

```bash
git town sync
```

### Creating PR

```bash
git town propose --title "..." --body "..."
```

### Shipping

```bash
git town ship
```

See git-town documentation for more commands.
```

---

## Best Practices

### 1. Clear Branch Scoping

Use branch names that indicate scope:
```
feature/api-authentication  # Single package
feature/multi-auth-system   # Multiple packages
fix/web-app-layout          # Single package
refactor/multi-typescript   # All packages
```

### 2. Atomic Commits Across Packages

When changing multiple packages, use atomic commits:
```bash
# Bad: Separate commits per package
git commit -m "feat(core): add util"
git commit -m "feat(api): use util"
git commit -m "feat(web-app): use util"

# Good: Single atomic commit
git add packages/*/
git commit -m "feat: add shared utility across packages"
```

### 3. Test Affected Packages

Use affected testing to speed up CI:
```bash
# Nx
npx nx affected:test --base=main

# Turborepo
npx turbo run test --filter=...[HEAD^1]

# Manual (bash)
CHANGED_PACKAGES=$(git diff --name-only main...HEAD | grep '^packages/' | cut -d'/' -f2 | sort -u)
for pkg in $CHANGED_PACKAGES; do
  cd packages/$pkg && npm test
done
```

### 4. Conventional Commits with Scope

Always include package scope in commits:
```bash
# Format: <type>(<scope>): <description>
git commit -m "feat(api): add GraphQL support"
git commit -m "fix(web-app): resolve memory leak"
git commit -m "refactor(core): extract utilities"
```

**Benefits**:
- Clear changelog per package
- Automated versioning works correctly
- Easy filtering of changes

---

## Troubleshooting

### Issue: "Changes to package X break package Y"

**Solution**: Test dependent packages before shipping

```bash
# After changing core package
cd packages/core
npm test  # Test core

# Test dependent packages
cd ../api
npm test  # Depends on core

cd ../web-app
npm test  # Depends on core and api

# Or use affected testing
npx nx affected:test --base=main
```

### Issue: "CI runs all tests even for single package change"

**Solution**: Use affected testing (see CI/CD Patterns above)

### Issue: "Merge conflicts across packages"

**Solution**: Sync frequently with main

```bash
# Daily sync (or more often)
git town sync

# Before creating PR
git town sync
git town propose
```

---

## Additional Resources

- **npm workspaces**: https://docs.npmjs.com/cli/v8/using-npm/workspaces
- **pnpm workspaces**: https://pnpm.io/workspaces
- **Nx monorepo**: https://nx.dev/
- **Turborepo**: https://turbo.build/
- **Changesets**: https://github.com/changesets/changesets
- **Git-town docs**: https://www.git-town.com/

---

*Last updated: 2025-12-31*
*Git-town workflow guide for monorepo environments*
