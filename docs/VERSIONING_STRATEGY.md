# AI-Mesh Plugins Versioning Strategy

**Version**: 1.0.0
**Date**: 2025-12-10
**Status**: Active
**Owner**: Fortium Partners Engineering Team

## Table of Contents

1. [Versioning Philosophy](#versioning-philosophy)
2. [Version Numbering](#version-numbering)
3. [Dependency Management](#dependency-management)
4. [Auto-Update Mechanism](#auto-update-mechanism)
5. [Release Process](#release-process)
6. [Compatibility Guarantees](#compatibility-guarantees)
7. [Migration Support](#migration-support)
8. [Plugin Tier-Specific Guidelines](#plugin-tier-specific-guidelines)
9. [Emergency Response](#emergency-response)
10. [Version Lifecycle](#version-lifecycle)

---

## 1. Versioning Philosophy

### 1.1 Core Principles

The AI-Mesh plugins monorepo follows **independent versioning** with intelligent auto-update policies to balance stability with innovation:

- **Semantic Versioning (SemVer)**: All plugins strictly follow `MAJOR.MINOR.PATCH` format
- **Independent Versioning**: Each plugin versions independently based on its own changes
- **Auto-Update by Default**: Patch and minor updates auto-apply; major updates require explicit opt-in
- **Backward Compatibility First**: Breaking changes require strong justification and migration support
- **Pre-release Testing**: All breaking changes go through beta/rc cycles before stable release

### 1.2 Design Goals

1. **Developer Experience**: Minimize manual update work while maintaining control
2. **Stability**: Production users never receive breaking changes without consent
3. **Security**: Critical security patches auto-apply within 24 hours
4. **Transparency**: All changes documented with clear upgrade paths
5. **Flexibility**: Plugin independence allows specialized release cadences

### 1.3 Version Independence Rationale

Unlike lockstep versioning (where all packages share one version), independent versioning provides:

- **Faster iteration**: Framework plugins (React, NestJS) can update without affecting core
- **Clearer intent**: Version bump reflects actual change magnitude per plugin
- **Reduced noise**: Users only update plugins they use
- **Better testing**: Isolated changes reduce regression risk

---

## 2. Version Numbering

### 2.1 Semantic Versioning Format

```
MAJOR.MINOR.PATCH[-PRERELEASE][+BUILD]

Example: 4.2.1-beta.3+20251210
```

**Components:**
- **MAJOR**: Breaking changes (backward incompatible)
- **MINOR**: New features (backward compatible)
- **PATCH**: Bug fixes and patches (backward compatible)
- **PRERELEASE**: alpha, beta, rc (optional)
- **BUILD**: Build metadata (optional)

### 2.2 Version Bump Guidelines

#### MAJOR Version (X.0.0) - Breaking Changes

Increment MAJOR when introducing changes that require user action:

**API Changes:**
- Removing or renaming exported functions/classes
- Changing function signatures (parameters, return types)
- Removing configuration options
- Changing default behavior in incompatible ways

**Plugin-Specific Examples:**

```javascript
// @fortium/ensemble-core: MAJOR bump
// Before (v3.x.x):
orchestrator.delegate(agentName, task)

// After (v4.0.0):
orchestrator.delegate({ agent: agentName, task, priority: 'normal' })
```

```yaml
# @fortium/ensemble-pane-viewer: MAJOR bump
# Before (v0.x.x):
hooks:
  pre_tool_use: true

# After (v1.0.0):
hooks:
  pre_tool_use:
    enabled: true
    multiplexer: "auto"
```

**Dependencies:**
- Dropping support for Node.js LTS versions
- Requiring new peer dependencies
- Upgrading to major versions of critical dependencies

**Workflow Changes:**
- Changing command invocation patterns
- Altering file output locations or formats
- Modifying configuration file schemas

#### MINOR Version (x.Y.0) - New Features

Increment MINOR when adding backward-compatible functionality:

**Feature Additions:**
- New agent capabilities or subcommands
- Additional configuration options (with safe defaults)
- New utility functions or exports
- Enhanced detection algorithms

**Plugin-Specific Examples:**

```javascript
// @fortium/ensemble-infrastructure: MINOR bump (v2.2.0)
// Added: Fly.io detection without breaking existing AWS/K8s detection
skills.detect.flyio()  // NEW
skills.detect.aws()    // UNCHANGED
```

```yaml
# @fortium/ensemble-nestjs: MINOR bump (v1.5.0)
# Added: GraphQL federation support
features:
  rest_api: true        # EXISTING
  graphql: true         # EXISTING
  graphql_federation: true  # NEW
```

**Deprecations:**
- Marking features as deprecated (still functional)
- Adding deprecation warnings to console output

**Performance:**
- Significant performance improvements (>20%)
- Optimization of existing features

#### PATCH Version (x.y.Z) - Bug Fixes

Increment PATCH for backward-compatible fixes:

**Bug Fixes:**
- Fixing incorrect behavior that doesn't match documentation
- Correcting edge cases or error handling
- Typo fixes in output messages
- Documentation corrections

**Security Fixes:**
- Non-breaking security patches
- Dependency updates for security vulnerabilities

**Plugin-Specific Examples:**

```javascript
// @fortium/ensemble-jest: PATCH bump (v1.2.3)
// Fixed: Test file detection now handles .test.ts files
// Impact: No API changes, just correct behavior
```

```yaml
# @fortium/ensemble-react: PATCH bump (v2.1.4)
# Fixed: Hook dependency detection for React 18.3+
# Impact: Silent fix, no user action required
```

### 2.3 Pre-release Versions

Pre-release versions follow this progression:

```
4.0.0-alpha.1  →  4.0.0-alpha.2  →  ... →
4.0.0-beta.1   →  4.0.0-beta.2   →  ... →
4.0.0-rc.1     →  4.0.0-rc.2     →  ... →
4.0.0
```

**Pre-release Types:**

- **alpha**: Internal testing, API unstable, may have significant bugs
- **beta**: External testing, API mostly stable, feature-complete
- **rc (release candidate)**: Production-ready, final validation before stable

**Usage:**
```bash
# Install latest stable
npm install @fortium/ensemble-core

# Opt-in to beta testing
npm install @fortium/ensemble-core@beta

# Install specific pre-release
npm install @fortium/ensemble-core@4.0.0-rc.1
```

### 2.4 Special Cases

#### Zero Major Version (0.y.z)

Per SemVer, `0.y.z` indicates initial development where anything may change:

- **0.y.z**: APIs unstable, breaking changes allowed in MINOR versions
- **Applies to**: New experimental plugins (e.g., `@fortium/ensemble-pane-viewer@0.1.0`)
- **Graduation**: Once stable, bump to 1.0.0 with compatibility guarantees

#### Pre-1.0 Version Strategy

For plugins starting at v0.x.x:

```
0.1.0  → Initial release (alpha quality)
0.2.0  → Breaking changes allowed
0.5.0  → Feature-complete, entering beta
0.9.0  → Release candidate quality
1.0.0  → First stable release with compatibility guarantees
```

---

## 3. Dependency Management

### 3.1 Peer Dependencies

Plugins declare peer dependencies for cross-plugin compatibility:

```json
{
  "name": "@fortium/ensemble-react",
  "version": "2.3.0",
  "peerDependencies": {
    "@fortium/ensemble-core": "^4.0.0",
    "@fortium/ensemble-development": "^3.0.0"
  },
  "peerDependenciesMeta": {
    "@fortium/ensemble-development": {
      "optional": true
    }
  }
}
```

### 3.2 Dependency Range Strategies

**Caret Ranges (^) - Default for Peer Dependencies:**

```json
"@fortium/ensemble-core": "^4.0.0"
```

**Accepts**: 4.0.0, 4.1.0, 4.9.9
**Rejects**: 3.x.x, 5.x.x
**Use Case**: Standard peer dependency (auto-update MINOR/PATCH)

**Tilde Ranges (~) - Conservative Updates:**

```json
"@fortium/ensemble-metrics": "~2.3.0"
```

**Accepts**: 2.3.0, 2.3.1, 2.3.9
**Rejects**: 2.4.0, 3.x.x
**Use Case**: Critical infrastructure plugins needing stability

**Exact Versions - Maximum Stability:**

```json
"@fortium/ensemble-orchestrator": "3.2.1"
```

**Accepts**: 3.2.1 only
**Use Case**: Rare, used only for known incompatibilities

**Wildcard Ranges (*) - Maximum Flexibility:**

```json
"@fortium/ensemble-exunit": "*"
```

**Accepts**: Any version
**Use Case**: Optional feature plugins with loose coupling

### 3.3 Cross-Plugin Compatibility Matrix

The monorepo maintains a compatibility matrix in `COMPATIBILITY.md`:

```markdown
| Core Version | Compatible Infrastructure | Compatible Frameworks | Compatible Testing |
|--------------|--------------------------|----------------------|-------------------|
| 4.0.x        | 2.2.x - 2.4.x            | 2.x.x - 3.x.x        | 1.5.x+           |
| 3.5.x        | 2.0.x - 2.3.x            | 2.x.x                | 1.3.x - 1.6.x    |
| 3.0.x        | 1.8.x - 2.1.x            | 1.x.x - 2.x.x        | 1.0.x - 1.4.x    |
```

**Compatibility Rules:**

1. **Core Plugin**: All other plugins declare `@fortium/ensemble-core` as peer dependency
2. **Orchestrators**: Must be compatible with current core version
3. **Specialists**: Can lag one MAJOR version behind core
4. **Framework Plugins**: Independent versioning, declare core peer dependency
5. **Testing Plugins**: Must support framework plugins from last 2 MAJOR versions

### 3.4 Breaking Change Propagation

When a plugin introduces breaking changes, downstream impact follows this protocol:

**Scenario**: `@fortium/ensemble-core` releases v5.0.0 with breaking API changes

**Immediate Impact (Within 1 week):**
- `@fortium/ensemble-orchestrator` → v4.0.0 (adapts to new core API)
- `@fortium/ensemble-development` → v4.0.0 (adapts to new core API)

**Short-term Impact (Within 1 month):**
- `@fortium/ensemble-quality` → v3.0.0 (adapts to new orchestrator API)
- All specialist plugins → MINOR version bumps (transparent adaptation)

**Long-term Impact (Within 3 months):**
- Framework plugins → MAJOR or MINOR bumps as needed
- Testing plugins → Compatibility validation and updates

**Communication:**
```bash
# Users receive clear upgrade guidance:
npm WARN @fortium/ensemble-core@5.0.0 requires @fortium/ensemble-orchestrator@^4.0.0
npm WARN Current: @fortium/ensemble-orchestrator@3.5.2
npm WARN Run: npm update @fortium/ensemble-orchestrator
```

---

## 4. Auto-Update Mechanism

### 4.1 Update Policy Overview

AI-Mesh plugins implement intelligent auto-update with user safety:

| Update Type | Auto-Install | User Notification | Rollback Available |
|-------------|--------------|-------------------|-------------------|
| PATCH       | Yes          | Silent changelog  | Automatic         |
| MINOR       | Yes          | Feature summary   | Automatic         |
| MAJOR       | No           | Breaking changes alert | Manual only   |
| Security    | Yes (urgent) | Security bulletin | Automatic         |

### 4.2 Update Check Frequency

**Default Schedule:**
```javascript
{
  "updateCheck": {
    "stable": "daily",           // Check for stable releases
    "prerelease": "disabled",    // Opt-in only
    "security": "hourly",        // Urgent security patches
    "cache": "6 hours"           // Local cache duration
  }
}
```

**User Configuration** (`~/.ensemble/config.json`):
```json
{
  "autoUpdate": {
    "enabled": true,
    "types": ["patch", "minor"],
    "exclude": [],
    "schedule": "startup",
    "notifications": "summary"
  }
}
```

### 4.3 Update Decision Logic

```javascript
// Pseudo-code for update manager
async function shouldAutoUpdate(plugin, currentVersion, latestVersion) {
  const semverDiff = getSemverDiff(currentVersion, latestVersion);
  const userConfig = loadUserConfig();

  // Security patches override all settings
  if (latestVersion.security && isUrgent(latestVersion.security)) {
    return { action: 'install', reason: 'security' };
  }

  // Check user preferences
  if (!userConfig.autoUpdate.enabled) {
    return { action: 'notify', reason: 'disabled' };
  }

  // Apply update policy
  switch (semverDiff) {
    case 'patch':
      return userConfig.autoUpdate.types.includes('patch')
        ? { action: 'install', reason: 'patch-auto' }
        : { action: 'notify', reason: 'patch-manual' };

    case 'minor':
      return userConfig.autoUpdate.types.includes('minor')
        ? { action: 'install', reason: 'minor-auto' }
        : { action: 'notify', reason: 'minor-manual' };

    case 'major':
      return { action: 'notify', reason: 'breaking-changes' };

    default:
      return { action: 'skip', reason: 'unknown' };
  }
}
```

### 4.4 Update Execution Flow

**Step 1: Detection**
```bash
# On Claude Code startup or scheduled check
[ensemble] Checking for updates...
[ensemble] Found 3 available updates:
  - @fortium/ensemble-core: 4.2.0 → 4.2.1 (patch, security)
  - @fortium/ensemble-react: 2.5.0 → 2.6.0 (minor, features)
  - @fortium/ensemble-nestjs: 3.0.0 → 4.0.0 (major, breaking)
```

**Step 2: Analysis**
```bash
[ensemble] Auto-update policy applied:
  ✓ @fortium/ensemble-core: Installing 4.2.1 (security patch)
  ✓ @fortium/ensemble-react: Installing 2.6.0 (new features)
  ! @fortium/ensemble-nestjs: Manual upgrade required (breaking changes)
```

**Step 3: Installation**
```bash
[ensemble] Installing updates...
  ✓ @fortium/ensemble-core@4.2.1 (completed in 1.2s)
  ✓ @fortium/ensemble-react@2.6.0 (completed in 0.8s)

[ensemble] ✓ 2 plugins updated successfully
[ensemble] ! 1 plugin requires manual upgrade (see upgrade guide)
```

**Step 4: Verification**
```bash
[ensemble] Running post-update health checks...
  ✓ Plugin compatibility verified
  ✓ Configuration schema validated
  ✓ Integration tests passed

[ensemble] System ready. Run `/help` to see new features.
```

### 4.5 Rollback Mechanism

**Automatic Rollback Triggers:**
- Plugin fails to load after update
- Configuration validation errors
- Integration test failures
- User-reported critical bugs within 24 hours

**Rollback Process:**
```bash
[ensemble] ERROR: @fortium/ensemble-core@4.2.1 failed health check
[ensemble] Initiating automatic rollback...
  ✓ Restored @fortium/ensemble-core@4.2.0
  ✓ Configuration reverted
  ✓ System stable

[ensemble] Rollback successful. Issue reported to maintainers.
[ensemble] You can opt-out of this update: ensemble config block-version 4.2.1
```

**Manual Rollback:**
```bash
# User-initiated rollback
ensemble rollback @fortium/ensemble-core

# Rollback to specific version
ensemble install @fortium/ensemble-core@4.1.5

# Rollback all updates from today
ensemble rollback --since today
```

### 4.6 Update Caching

**Cache Strategy:**
```javascript
// ~/.ensemble/cache/update-registry.json
{
  "lastCheck": "2025-12-10T14:30:00Z",
  "cache": {
    "@fortium/ensemble-core": {
      "current": "4.2.0",
      "latest": "4.2.1",
      "latestMajor": "4.2.1",
      "latestMinor": "4.2.1",
      "security": true,
      "fetchedAt": "2025-12-10T14:30:00Z",
      "expiresAt": "2025-12-10T20:30:00Z"
    }
  }
}
```

**Benefits:**
- Reduces npm registry queries (respects rate limits)
- Enables offline update notifications
- Improves startup performance
- Supports air-gapped environments (with manual cache seeding)

---

## 5. Release Process

### 5.1 Branch Strategy

```
main (protected)
├── release/v4.x (LTS support)
├── release/v3.x (security-only)
└── feature/* (development branches)
    ├── feature/core-delegation-v5
    ├── feature/react-hooks-suspense
    └── feature/flyio-multi-region
```

**Branch Policies:**
- **main**: Always stable, receives merged PRs from feature branches
- **release/vX.x**: Long-term support branches for MAJOR versions
- **feature/***: Development work, requires PR review before merge
- **hotfix/***: Emergency patches, fast-tracked to main and release branches

### 5.2 Conventional Commits

All commits follow [Conventional Commits](https://www.conventionalcommits.org/) for automated changelog generation:

```bash
# Format: <type>(<scope>): <subject>

# Examples:
feat(core): add multi-agent parallel execution
fix(react): resolve useState hook dependency tracking
perf(infrastructure): optimize Helm chart detection (95ms → 8ms)
docs(versioning): clarify pre-release upgrade paths
chore(deps): bump jest from 29.5.0 to 29.7.0
refactor(orchestrator): extract delegation logic into separate module

# Breaking changes:
feat(core)!: change delegate() API to accept options object

BREAKING CHANGE: delegate(agent, task) is now delegate({ agent, task, priority })
Migration: Update all delegate() calls to use options object
```

**Commit Types:**
- `feat`: New feature (triggers MINOR bump)
- `fix`: Bug fix (triggers PATCH bump)
- `perf`: Performance improvement (PATCH or MINOR depending on impact)
- `docs`: Documentation only (no version bump)
- `style`: Code style changes (no version bump)
- `refactor`: Code refactoring (no version bump)
- `test`: Test additions/changes (no version bump)
- `chore`: Maintenance tasks (no version bump)

**Breaking Change Indicator:**
```bash
# Option 1: Exclamation mark
feat(core)!: redesign plugin loading mechanism

# Option 2: Footer
feat(core): redesign plugin loading mechanism

BREAKING CHANGE: Plugins must now export `activate()` function instead of default export
```

### 5.3 Release Workflow

#### Automated Release Process

```yaml
# .github/workflows/release.yml (conceptual)
name: Release Pipeline

on:
  push:
    branches: [main]

jobs:
  analyze:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          fetch-depth: 0  # Full history for changelog

      - name: Analyze commits
        id: analyze
        run: |
          # Determine which packages changed
          # Calculate version bumps per package
          # Detect breaking changes
          node scripts/analyze-changes.js

      - name: Generate changelogs
        run: |
          # Per-package CHANGELOG.md updates
          npx lerna-changelog

      - name: Version bump
        run: |
          # Update package.json versions
          npm version patch --workspaces --if-present

      - name: Create release commit
        run: |
          git config user.name "GitHub Actions"
          git config user.email "actions@github.com"
          git commit -am "chore(release): publish packages"
          git push

  test:
    needs: analyze
    runs-on: ubuntu-latest
    steps:
      - name: Run tests
        run: npm test --workspaces

      - name: Integration tests
        run: npm run test:integration

      - name: E2E tests
        run: npm run test:e2e

  publish:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - name: Publish to npm
        run: |
          npm config set //registry.npmjs.org/:_authToken=${{ secrets.NPM_TOKEN }}
          npm publish --workspaces --access public

      - name: Create GitHub Release
        uses: actions/create-release@v1
        with:
          tag_name: ${{ steps.analyze.outputs.version }}
          release_name: Release ${{ steps.analyze.outputs.version }}
          body: ${{ steps.analyze.outputs.changelog }}
```

#### Manual Release Process

For plugins requiring manual release (e.g., experimental features):

```bash
# Step 1: Ensure all changes are committed
git status

# Step 2: Run tests
npm test --workspace=@fortium/ensemble-core

# Step 3: Version bump
cd packages/core
npm version minor  # or major/patch

# Step 4: Update CHANGELOG.md
# (Edit manually or use conventional-changelog)

# Step 5: Commit and tag
git add .
git commit -m "chore(core): release v4.3.0"
git tag @fortium/ensemble-core@4.3.0

# Step 6: Publish
npm publish --access public

# Step 7: Push to GitHub
git push --follow-tags

# Step 8: Create GitHub Release
gh release create @fortium/ensemble-core@4.3.0 \
  --title "Core v4.3.0: Advanced Delegation" \
  --notes-file packages/core/CHANGELOG.md
```

### 5.4 Changelog Generation

**Automated Changelog Format:**

```markdown
# @fortium/ensemble-core

## [4.3.0] - 2025-12-10

### Features
- **orchestrator**: Add parallel agent execution for non-conflicting tasks (#142)
- **delegation**: Implement priority queue for task scheduling (#145)
- **config**: Support environment-based plugin loading (#148)

### Bug Fixes
- **loader**: Fix race condition in plugin initialization (#143)
- **metrics**: Correct session duration calculation (#146)

### Performance
- **core**: Reduce plugin load time by 40% (85ms → 50ms) (#147)

### Documentation
- **api**: Add comprehensive delegation examples (#144)
- **migration**: Document v3 → v4 upgrade path (#149)

### BREAKING CHANGES
- **delegation**: `delegate()` now requires options object instead of positional arguments
  ```javascript
  // Before (v3.x)
  orchestrator.delegate('backend-developer', task)

  // After (v4.x)
  orchestrator.delegate({ agent: 'backend-developer', task, priority: 'normal' })
  ```
  **Migration**: Run codemod: `npx @fortium/ensemble-codemod v3-to-v4-delegate`

[4.3.0]: https://github.com/FortiumPartners/ensemble/compare/@fortium/ensemble-core@4.2.0...@fortium/ensemble-core@4.3.0
```

### 5.5 GitHub Release Automation

**Release Asset Structure:**
```
Release @fortium/ensemble-core@4.3.0
├── ensemble-core-4.3.0.tgz          # npm package tarball
├── CHANGELOG.md                    # Full changelog
├── MIGRATION-v3-to-v4.md          # Migration guide
├── checksums.txt                   # SHA256 checksums
└── codemods/
    └── v3-to-v4-delegate.js       # Automated migration script
```

---

## 6. Compatibility Guarantees

### 6.1 Support Windows

Each MAJOR version receives support for a defined period:

```
Version 5.x.x: Active Development (Current)
Version 4.x.x: LTS (Long-Term Support) until 2026-12-01
Version 3.x.x: Security-Only until 2025-12-01
Version 2.x.x: End-of-Life (no support)
```

**Support Levels:**

| Status | Features | Bug Fixes | Security | Duration |
|--------|----------|-----------|----------|----------|
| Active | ✅ Yes   | ✅ Yes    | ✅ Yes   | 12 months |
| LTS    | ❌ No    | ✅ Yes    | ✅ Yes   | 18 months |
| Security | ❌ No  | ❌ No     | ✅ Yes   | 12 months |
| EOL    | ❌ No    | ❌ No     | ❌ No    | N/A      |

### 6.2 Claude Code Version Compatibility

AI-Mesh plugins target Claude Code stable releases:

```json
{
  "engines": {
    "claude-code": ">=1.5.0 <3.0.0"
  }
}
```

**Compatibility Matrix:**

| Plugin Version | Claude Code | Node.js | Status |
|----------------|-------------|---------|--------|
| 4.x.x          | 1.5.x - 2.x.x | 18.x - 22.x | Active |
| 3.x.x          | 1.5.x - 1.9.x | 18.x - 20.x | LTS    |
| 2.x.x          | 1.0.x - 1.4.x | 16.x - 18.x | EOL    |

### 6.3 Node.js Version Requirements

Plugins support **Active LTS and Current** Node.js releases:

```json
{
  "engines": {
    "node": ">=18.0.0"
  }
}
```

**Node.js Support Policy:**
- **18.x (LTS)**: Supported until 2025-04-30
- **20.x (LTS)**: Supported until 2026-04-30
- **22.x (Current)**: Supported (becomes LTS 2025-10-01)

**Upgrade Timeline:**
- Drop Node 18 support: 2025-06-01 (in ensemble v5.0.0)
- Add Node 24 support: 2025-11-01 (in ensemble v5.x.x)

### 6.4 Cross-Plugin Compatibility Windows

Plugins maintain compatibility across version ranges:

**Tier 1: Core Plugins** (strict compatibility)
```
@fortium/ensemble-core@4.0.0 requires:
  - @fortium/ensemble-orchestrator@^3.0.0
  - @fortium/ensemble-development@^3.0.0
  - @fortium/ensemble-quality@^2.0.0
```

**Tier 2: Workflow Plugins** (flexible compatibility)
```
@fortium/ensemble-product@2.0.0 requires:
  - @fortium/ensemble-core@^3.5.0 || ^4.0.0
```

**Tier 3: Framework Plugins** (loose compatibility)
```
@fortium/ensemble-react@2.5.0 requires:
  - @fortium/ensemble-core@^4.0.0
  - @fortium/ensemble-development@* (optional)
```

**Tier 4: Testing Plugins** (maximum compatibility)
```
@fortium/ensemble-jest@1.4.0 requires:
  - @fortium/ensemble-core@^3.0.0 || ^4.0.0
  - jest@^27.0.0 || ^28.0.0 || ^29.0.0
```

---

## 7. Migration Support

### 7.1 Deprecation Warnings

Plugins provide advance notice before removing features:

**Timeline:**
1. **Version N**: Feature marked as deprecated with warning
2. **Version N+1**: Warning becomes more prominent
3. **Version N+2 (MAJOR)**: Feature removed

**Example:**
```javascript
// v4.0.0: Deprecation introduced
function delegate(agent, task) {
  console.warn(
    'DEPRECATED: delegate(agent, task) will be removed in v5.0.0. ' +
    'Use delegate({ agent, task }) instead. ' +
    'See migration guide: https://docs.ensemble.dev/migrations/v4-to-v5'
  );
  return delegateNew({ agent, task });
}

// v4.5.0: Stronger warning
function delegate(agent, task) {
  console.error(
    'DEPRECATED (Removal in v5.0.0): delegate(agent, task) is deprecated. ' +
    'Auto-migrate with: npx @fortium/ensemble-codemod v4-to-v5-delegate'
  );
  return delegateNew({ agent, task });
}

// v5.0.0: Feature removed
// Function no longer exists; TypeScript/JSDoc will show compile-time error
```

### 7.2 Codemods for Breaking Changes

Automated migration scripts transform code for breaking changes:

**Example Codemod Structure:**
```javascript
// codemods/v4-to-v5-delegate.js
module.exports = function transformer(file, api) {
  const j = api.jscodeshift;
  const root = j(file.source);

  // Find all delegate() calls with 2 arguments
  root
    .find(j.CallExpression, {
      callee: {
        type: 'MemberExpression',
        property: { name: 'delegate' }
      }
    })
    .filter(path => path.value.arguments.length === 2)
    .forEach(path => {
      const [agent, task] = path.value.arguments;

      // Transform to options object
      path.value.arguments = [
        j.objectExpression([
          j.property('init', j.identifier('agent'), agent),
          j.property('init', j.identifier('task'), task),
          j.property('init', j.identifier('priority'), j.literal('normal'))
        ])
      ];
    });

  return root.toSource();
};
```

**Usage:**
```bash
# Dry run (preview changes)
npx @fortium/ensemble-codemod v4-to-v5-delegate --dry

# Apply migration
npx @fortium/ensemble-codemod v4-to-v5-delegate

# Apply to specific directory
npx @fortium/ensemble-codemod v4-to-v5-delegate --path ./src
```

### 7.3 Migration Guides

Each MAJOR version includes comprehensive migration documentation:

**Structure:**
```markdown
# Migration Guide: v4 → v5

## Overview
Version 5.0.0 introduces breaking changes to improve performance and developer experience.

## Breaking Changes

### 1. Delegate API (All Users)
**Impact**: High
**Effort**: Low (automated codemod available)

**Before:**
```javascript
orchestrator.delegate('backend-developer', task);
```

**After:**
```javascript
orchestrator.delegate({ agent: 'backend-developer', task, priority: 'normal' });
```

**Migration:**
```bash
npx @fortium/ensemble-codemod v4-to-v5-delegate
```

### 2. Configuration Schema (Power Users)
**Impact**: Medium
**Effort**: Medium (manual review required)

**Before:**
```json
{
  "agents": {
    "autoLoad": true
  }
}
```

**After:**
```json
{
  "agents": {
    "loading": {
      "mode": "auto",
      "priority": ["orchestrators", "specialists"]
    }
  }
}
```

**Migration:**
Run validation script to identify incompatible configurations:
```bash
ensemble validate-config --migration-mode v4-to-v5
```

## Step-by-Step Migration

### Step 1: Update Dependencies
```bash
npm install @fortium/ensemble-core@^5.0.0
npm install @fortium/ensemble-orchestrator@^4.0.0
```

### Step 2: Run Codemods
```bash
npx @fortium/ensemble-codemod v4-to-v5 --all
```

### Step 3: Update Configuration
```bash
ensemble migrate-config v4-to-v5
```

### Step 4: Test
```bash
npm test
ensemble health-check
```

### Step 5: Rollback (if needed)
```bash
ensemble rollback --to v4
```

## Compatibility Layer
For gradual migration, install compatibility layer:
```bash
npm install @fortium/ensemble-compat-v4
```

## Support
- Migration issues: https://github.com/FortiumPartners/ensemble/discussions
- Documentation: https://docs.ensemble.dev/migrations/v4-to-v5
- Support: support@fortiumpartners.com
```

### 7.4 Sunset Timeline

Features marked for removal follow a predictable timeline:

```
Today (v4.0.0)
  ↓ Deprecation warning added
+3 months (v4.3.0)
  ↓ Warning escalated, codemod provided
+6 months (v4.6.0)
  ↓ Final warning, migration guide published
+12 months (v5.0.0)
  ↓ Feature removed
```

**Minimum Support: 3 MAJOR Versions**

Example: A feature deprecated in v4.0.0 must remain functional (with warnings) through:
- v4.x.x (12 months)
- v5.x.x (optional compatibility layer)
- v6.x.x (removed, no compatibility layer)

---

## 8. Plugin Tier-Specific Guidelines

### 8.1 Tier 1: Core Plugins

**Plugins**: `@fortium/ensemble-core`, `@fortium/ensemble-orchestrator`, `@fortium/ensemble-development`, `@fortium/ensemble-quality`

**Versioning Policy:**
- **Stability First**: Breaking changes require RFC (Request for Comments) process
- **Coordinated Releases**: Core plugins release together for MAJOR versions
- **LTS Support**: 18 months of bug fixes and security patches
- **Deprecation Window**: 12 months minimum before removal

**Example:**
```json
{
  "name": "@fortium/ensemble-core",
  "version": "4.5.2",
  "releasePolicy": {
    "stabilityIndex": "stable",
    "deprecationWindow": "12 months",
    "ltsSupport": "18 months",
    "breakingChangeProcess": "RFC required"
  }
}
```

### 8.2 Tier 2: Workflow Plugins

**Plugins**: `@fortium/ensemble-product`, `@fortium/ensemble-git`, `@fortium/ensemble-infrastructure`

**Versioning Policy:**
- **Iterative Development**: Faster release cycle (monthly)
- **Independent Versioning**: Not tied to core release schedule
- **Standard Support**: 12 months of bug fixes
- **Deprecation Window**: 6 months minimum

**Example:**
```json
{
  "name": "@fortium/ensemble-product",
  "version": "2.8.0",
  "releasePolicy": {
    "stabilityIndex": "stable",
    "releaseFrequency": "monthly",
    "deprecationWindow": "6 months"
  }
}
```

### 8.3 Tier 3: Framework Plugins

**Plugins**: `@fortium/ensemble-react`, `@fortium/ensemble-nestjs`, `@fortium/ensemble-phoenix`, etc.

**Versioning Policy:**
- **Framework-Aligned**: Versions track supported framework versions
- **Rapid Iteration**: Weekly/bi-weekly releases for new framework features
- **Minimum Support**: 6 months for MAJOR versions
- **Deprecation Window**: 3 months minimum

**Example:**
```json
{
  "name": "@fortium/ensemble-react",
  "version": "2.5.3",
  "releasePolicy": {
    "stabilityIndex": "stable",
    "frameworkVersions": ["18.x", "19.x"],
    "releaseFrequency": "bi-weekly",
    "deprecationWindow": "3 months"
  }
}
```

### 8.4 Tier 4: Testing Plugins

**Plugins**: `@fortium/ensemble-jest`, `@fortium/ensemble-playwright`, `@fortium/ensemble-e2e-testing`

**Versioning Policy:**
- **Test Framework Compatibility**: Support multiple framework versions
- **Conservative Updates**: Only MAJOR bumps when dropping framework support
- **Extended Support**: 24 months for popular test frameworks
- **No Deprecation**: Features rarely removed

**Example:**
```json
{
  "name": "@fortium/ensemble-jest",
  "version": "1.6.0",
  "releasePolicy": {
    "stabilityIndex": "stable",
    "supportedFrameworks": ["jest@27", "jest@28", "jest@29"],
    "deprecationPolicy": "features rarely deprecated"
  }
}
```

---

## 9. Emergency Response

### 9.1 Security Patch Protocol

**Severity Levels:**

| Level | Description | Response Time | Auto-Update |
|-------|-------------|---------------|-------------|
| Critical | Actively exploited, data loss risk | 4 hours | Yes (forced) |
| High | Exploitable, privilege escalation | 24 hours | Yes (forced) |
| Medium | Requires user interaction | 7 days | Yes (optional) |
| Low | Theoretical risk, edge case | 30 days | No (manual) |

**Critical Security Patch Process:**

```bash
# Hour 0: Vulnerability disclosed
[SECURITY] CVE-2025-XXXX: Critical RCE in @fortium/ensemble-core@4.5.0-4.5.2

# Hour 1: Fix developed and tested
git checkout -b hotfix/CVE-2025-XXXX
# ... fix implementation ...
npm test && npm run test:security

# Hour 2: Emergency release
npm version patch  # 4.5.2 → 4.5.3
npm publish --tag security
git tag -a v4.5.3-security -m "Security patch for CVE-2025-XXXX"
git push --tags

# Hour 3: User notification
# All users receive immediate notification on next Claude Code startup
[SECURITY ALERT] Critical update available for @fortium/ensemble-core
[SECURITY ALERT] Installing @fortium/ensemble-core@4.5.3 (fixes CVE-2025-XXXX)
[SECURITY ALERT] Update completed. System secure.

# Hour 4: Post-mortem and disclosure
# Publish security advisory on GitHub
gh security-advisory create --severity critical \
  --cve CVE-2025-XXXX \
  --description "..." \
  --affected-versions "4.5.0-4.5.2" \
  --patched-versions "4.5.3"
```

### 9.2 Hotfix Release Process

**Criteria for Hotfix:**
- Security vulnerabilities (any severity)
- Data loss bugs
- Critical functionality broken for all users
- Regression introduced in recent release

**Hotfix Workflow:**
```bash
# Create hotfix branch from affected release tag
git checkout -b hotfix/v4.5.3 v4.5.2

# Apply minimal fix
git cherry-pick <commit-hash>
# OR implement fix directly

# Version bump (PATCH only)
npm version patch  # 4.5.2 → 4.5.3

# Fast-track testing
npm run test:critical  # Critical path tests only

# Publish
npm publish --tag latest

# Backport to LTS branches
git checkout release/v3.x
git cherry-pick hotfix/v4.5.3
npm version patch  # 3.8.5 → 3.8.6
npm publish --tag latest-v3

# Notify users
gh release create v4.5.3 --title "Hotfix: Critical Bug Fix" --notes "..."
```

### 9.3 Breaking Hotfix Exception

In rare cases, a hotfix may include breaking changes (e.g., disabling insecure feature):

**Process:**
1. **Justification**: Document why breaking change is necessary
2. **Communication**: Notify all users via email, GitHub, and in-app alert
3. **Compatibility Layer**: Provide opt-in to restore old behavior (if safe)
4. **Accelerated Migration**: Provide codemod within 24 hours

**Example:**
```javascript
// @fortium/ensemble-core@4.5.3 (hotfix with breaking change)

// BREAKING: Insecure delegateUnsafe() method removed due to CVE-2025-XXXX
// Migration: Use delegate() with proper authentication
// Temporary workaround (UNSAFE, remove before production):
//   config.security.allowLegacyDelegation = true  // Expires 2025-12-31
```

---

## 10. Version Lifecycle

### 10.1 Version Lifecycle Stages

```
Development → Alpha → Beta → RC → Stable → LTS → Security-Only → EOL
```

**Stage Definitions:**

| Stage | Stability | API Changes | User Base | Support |
|-------|-----------|-------------|-----------|---------|
| Development | Unstable | Frequent | Maintainers only | None |
| Alpha | Experimental | Allowed | Early testers | Best-effort |
| Beta | Mostly stable | Rare | Public beta testers | Community |
| RC | Stable | None | Brave production users | Full |
| Stable | Production | Deprecated only | All users | Full |
| LTS | Production | None | Conservative users | Bug fixes + security |
| Security | Production | None | Unmigrated users | Security only |
| EOL | Unsupported | N/A | None | None |

### 10.2 Version Promotion Criteria

**Alpha → Beta:**
- [ ] All planned features implemented
- [ ] Unit test coverage ≥80%
- [ ] Integration tests passing
- [ ] No known critical bugs
- [ ] Documentation 70% complete

**Beta → RC:**
- [ ] No known high/critical bugs
- [ ] Test coverage ≥90%
- [ ] Performance benchmarks met
- [ ] Documentation 100% complete
- [ ] Migration guide published (if MAJOR)

**RC → Stable:**
- [ ] Zero critical/high bugs
- [ ] 2 weeks of RC testing with no regressions
- [ ] Community feedback incorporated
- [ ] Production validation (2+ companies)

**Stable → LTS:**
- [ ] 12 months since stable release
- [ ] Next MAJOR version released
- [ ] API frozen (no new features)
- [ ] Maintenance team assigned

**LTS → Security-Only:**
- [ ] 18 months of LTS support completed
- [ ] Successor MAJOR version in LTS phase
- [ ] Migration path well-documented
- [ ] <5% of users still on this version

**Security-Only → EOL:**
- [ ] 12 months of security-only support
- [ ] Two successor MAJOR versions available
- [ ] <1% of users on this version
- [ ] 90-day EOL warning issued

### 10.3 Version Support Timeline Example

```
Timeline for @fortium/ensemble-core:

2024-01-01: v3.0.0 released (Stable)
2024-07-01: v4.0.0 released (Stable) → v3.x.x enters LTS
2025-01-01: v4.x.x enters LTS
2025-07-01: v5.0.0 released (Stable) → v3.x.x enters Security-Only
2026-01-01: v5.x.x enters LTS → v4.x.x enters Security-Only
2026-07-01: v3.x.x reaches EOL (30 months total support)
2027-01-01: v4.x.x reaches EOL
```

**Graphical Representation:**
```
v3.x.x: [====Stable====][======LTS======][Security][EOL]
         2024-01 to      2024-07 to      2025-07 to 2026-07
         2024-07         2025-07         2026-07

v4.x.x:         [====Stable====][======LTS======][Security][EOL]
                 2024-07 to      2025-01 to      2026-01 to 2027-01
                 2025-01         2026-01         2027-01

v5.x.x:                         [====Stable====][======LTS======][Security]
                                 2025-07 to      2026-01 to      TBD
                                 2026-01         TBD
```

---

## Appendix A: Configuration Reference

### User Configuration File

Location: `~/.ensemble/config.json`

```json
{
  "autoUpdate": {
    "enabled": true,
    "types": ["patch", "minor"],
    "exclude": [],
    "schedule": "startup",
    "notifications": "summary"
  },
  "updateCheck": {
    "stable": "daily",
    "prerelease": "disabled",
    "security": "hourly",
    "cache": "6 hours"
  },
  "compatibility": {
    "nodeMinVersion": "18.0.0",
    "claudeCodeMinVersion": "1.5.0"
  },
  "experimental": {
    "alphaFeatures": false,
    "betaFeatures": false
  }
}
```

---

## Appendix B: Version Decision Tree

```
Is this a breaking change?
├─ Yes → MAJOR version bump
│   ├─ Create migration guide
│   ├─ Provide codemod (if possible)
│   ├─ Deprecation warnings in previous version
│   └─ 12-month support for old API
│
└─ No → Is this a new feature?
    ├─ Yes → MINOR version bump
    │   ├─ Ensure backward compatibility
    │   ├─ Add feature flag (if experimental)
    │   └─ Document in changelog
    │
    └─ No → PATCH version bump
        ├─ Bug fix, security patch, or docs
        ├─ No API changes
        └─ Safe for auto-update
```

---

## Appendix C: Glossary

- **SemVer**: Semantic Versioning (MAJOR.MINOR.PATCH)
- **Breaking Change**: Modification requiring user code changes
- **Deprecation**: Marking a feature for future removal
- **Codemod**: Automated code transformation script
- **LTS**: Long-Term Support (extended maintenance)
- **EOL**: End-of-Life (no support provided)
- **Pre-release**: Alpha, beta, or RC version
- **Peer Dependency**: Package required by plugin but not bundled
- **Conventional Commits**: Commit message format for automation
- **Monorepo**: Single repository containing multiple packages

---

**Document Version**: 1.0.0
**Last Updated**: 2025-12-10
**Next Review**: 2025-03-10 (Quarterly)
**Maintained By**: Fortium Partners Engineering Team
**Feedback**: https://github.com/FortiumPartners/ensemble/discussions
