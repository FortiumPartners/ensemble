# Product Requirements Document: Automated Plugin Version Management

## Document Information

- **Product**: Automated Version Management System for Ensemble Plugin Ecosystem
- **Version**: 1.1.0
- **Status**: Draft
- **Created**: 2026-01-09
- **Last Updated**: 2026-01-09
- **Owner**: Product Management Team
- **Stakeholders**: Plugin maintainers, DevOps team, end users consuming plugins

---

## 1. Product Summary

### Problem Statement

The Ensemble plugin ecosystem consists of 25 interconnected packages in a monorepo structure. Currently, version management is manual and error-prone:

- **Manual version bumping** requires developers to update version numbers in multiple files (`plugin.json`, `package.json`, `marketplace.json`)
- **Inconsistent versioning** occurs when one file is updated but others are forgotten
- **Cascade failures** happen when constituent plugin updates don't propagate to `ensemble-full`
- **Marketplace staleness** results from plugins not being marked as updated, breaking auto-update functionality
- **Developer cognitive load** increases with the need to remember conventional commit semantics and their version bump implications

These issues prevent reliable marketplace auto-updates and create friction in the development workflow.

### Solution Overview

An automated version management system that:

1. **Detects change significance** from conventional commit messages (`feat`, `fix`, `BREAKING CHANGE`)
2. **Automatically bumps versions** following semantic versioning (semver) rules
3. **Synchronizes version numbers** across `plugin.json`, `package.json`, and `marketplace.json`
4. **Cascades updates** to `ensemble-full` when any constituent plugin changes
5. **Integrates with CI/CD** to ensure consistency before release
6. **Provides manual overrides** for edge cases requiring human judgment

### Value Proposition

**For Plugin Maintainers:**
- Eliminate manual version management overhead (save ~5 minutes per commit)
- Reduce version synchronization errors to zero
- Focus on feature development rather than versioning bookkeeping

**For DevOps Team:**
- Ensure consistent, reliable releases through automation
- Reduce release preparation time by 70%
- Enable confident automated deployments

**For Plugin Consumers:**
- Reliable marketplace auto-updates
- Clear semantic versioning signals for upgrade decisions
- Faster access to bug fixes and new features

**Business Impact:**
- Reduce version-related bugs by 95%
- Increase release velocity by 50%
- Improve developer satisfaction and productivity

---

## 2. User Analysis

### Target Users

#### Primary: Plugin Maintainers (Developers)
- **Role**: Developers contributing to any of the 25 Ensemble plugins
- **Goals**: Ship features quickly without versioning errors
- **Pain Points**:
  - Forgetting to bump versions before release
  - Updating one version file but not others
  - Uncertainty about whether a change is "minor" or "major"
  - Fear of breaking downstream consumers with incorrect versioning
- **Technical Proficiency**: High (familiar with git, npm, conventional commits)
- **Usage Frequency**: Daily (multiple commits per day)

#### Secondary: DevOps/Release Engineers
- **Role**: Manage CI/CD pipelines and release orchestration
- **Goals**: Reliable, repeatable release processes
- **Pain Points**:
  - Manual version checks in release checklists
  - Release failures due to version mismatches
  - Time-consuming manual marketplace.json updates
- **Technical Proficiency**: Very high (infrastructure and automation experts)
- **Usage Frequency**: Multiple releases per week

#### Tertiary: Plugin Consumers (End Users)
- **Role**: Claude Code users installing Ensemble plugins
- **Goals**: Stay up-to-date with latest plugin versions automatically
- **Pain Points**:
  - Stale plugins due to marketplace update failures
  - Breaking changes without clear semver signals
  - Uncertainty about what changed between versions
- **Technical Proficiency**: Medium to high
- **Usage Frequency**: Install/update monthly

### User Personas

**Persona 1: Alex - Full-Stack Developer**
- Contributes to ensemble-development and ensemble-quality plugins
- Makes 10-15 commits per week across multiple plugins
- Frustrated by version management interrupting flow state
- Values automation that "just works" without configuration
- Needs manual override for occasional breaking changes

**Persona 2: Jordan - DevOps Engineer**
- Maintains CI/CD pipeline and release automation
- Releases 5-10 plugin updates per week
- Requires high reliability and predictability
- Values detailed logging and auditability
- Needs rollback capabilities for mistakes

**Persona 3: Sam - Plugin Consumer**
- Uses ensemble-full bundle in daily development
- Updates plugins monthly via marketplace
- Annoyed when updates fail or marketplace is stale
- Values clear upgrade paths and change documentation
- Needs to trust semantic versioning for upgrade decisions

### User Journey

#### Current State (Manual Process)
1. Developer makes code changes
2. Developer writes conventional commit message
3. **[Manual]** Developer determines version bump needed (major/minor/patch)
4. **[Manual]** Developer updates `plugin.json` version
5. **[Manual]** Developer updates `package.json` version
6. **[Manual]** Developer updates `marketplace.json` entry
7. **[Manual]** Developer checks if ensemble-full needs update
8. **[Manual]** Developer updates ensemble-full versions if needed
9. Developer commits version changes
10. CI/CD validates and releases
11. **[Failure Point]** Any forgotten step breaks marketplace updates

**Pain Points**: Steps 3-8 are error-prone, time-consuming, and frequently forgotten.

#### Desired State (Automated Process)
1. Developer makes code changes
2. Developer writes conventional commit message
3. **[Automated]** Pre-commit hook suggests version bump based on commit
4. Developer commits (version files auto-updated)
5. **[Automated]** CI/CD validates version consistency
6. **[Automated]** On merge to main, versions are bumped
7. **[Automated]** marketplace.json is updated
8. **[Automated]** ensemble-full cascade check runs
9. **[Automated]** ensemble-full versions updated if needed
10. CI/CD releases with correct versions
11. Marketplace auto-updates work reliably

**Benefits**: Developer focuses on code; automation ensures correctness.

---

## 3. Goals & Non-Goals

### Goals

**Primary Goals (Must Have):**
1. **Automatic version bumping** - Determine and apply correct version bump (major/minor/patch) from conventional commit messages
2. **Version synchronization** - Keep `plugin.json`, `package.json`, and `marketplace.json` versions consistent
3. **Cascade to ensemble-full** - Automatically bump ensemble-full when constituent plugins change
4. **CI/CD integration** - Validate versions in PR checks; bump versions in release workflow
5. **Zero manual intervention** - 95% of commits require no manual version management
6. **Changelog generation** - Auto-generate root-level CHANGELOG.md from conventional commits

**Secondary Goals (Should Have):**
1. **Version bump preview** - Show proposed version changes before commit
2. **Breaking change detection** - Flag commits with `BREAKING CHANGE` for major version bumps
3. **Audit trail** - Log all version changes with rationale for debugging

**Tertiary Goals (Nice to Have):**
1. **Interactive bump selection** - Prompt developer to choose version bump if commit is ambiguous
2. **Dependency-aware bumping** - Bump dependent plugins when dependencies change
3. **Version freeze support** - Allow freezing versions for LTS releases
4. **Metrics dashboard** - Track version bump frequency, errors, and manual overrides

**Future Phase Goals (Post-Phase 1):**
1. **Manual override capability** - Allow developers to force specific version bumps when automation is incorrect (moved to Phase 4)

### Non-Goals

**Explicitly Out of Scope:**
1. **Publishing to npm** - System bumps versions but doesn't publish (use existing `npm run publish:changed`)
2. **Git tagging strategy** - Use existing tag-based release workflow
3. **Breaking change migration** - Don't generate migration guides (separate tool)
4. **Version number bikeshedding** - Strict semver 2.0.0 compliance, no custom schemes
5. **Multi-repository support** - Scoped to single monorepo (Ensemble ecosystem only)
6. **Historical version rewriting** - Only prospective version management
7. **Pre-release versions** - Alpha/beta/rc versions (e.g., 5.2.0-alpha.1) are handled manually, not automated

### Success Metrics

**Quantitative:**
- **Version consistency**: 100% of plugins have matching versions in plugin.json and package.json
- **Cascade success rate**: 100% of ensemble-full updates when constituents change
- **Manual intervention rate**: <5% of commits require manual version override
- **Release preparation time**: Reduce from 30 minutes to <5 minutes (85% reduction)
- **Version-related bugs**: Reduce from 2-3 per month to <1 per quarter (95% reduction)

**Qualitative:**
- Developer satisfaction: "Version management is invisible"
- DevOps confidence: "Releases are predictable and reliable"
- User trust: "Marketplace updates work consistently"

---

## 4. Functional Requirements

### FR-1: Conventional Commit Detection

**Description**: Parse conventional commit messages to determine version bump type.

**Acceptance Criteria:**
- **FR-1.1**: Detect `feat:` prefix → minor version bump (e.g., 5.0.0 → 5.1.0)
- **FR-1.2**: Detect `fix:` prefix → patch version bump (e.g., 5.1.0 → 5.1.1)
- **FR-1.3**: Detect `BREAKING CHANGE:` in commit body → major version bump (e.g., 5.1.0 → 6.0.0)
- **FR-1.4**: Detect `feat!:` or `fix!:` suffix → major version bump
- **FR-1.5**: Ignore non-versioning commits (`docs:`, `test:`, `chore:`) → no version bump
- **FR-1.6**: Handle multi-line commit messages correctly
- **FR-1.7**: Support conventional commit scopes (e.g., `feat(core):`)

**Test Scenarios:**
```
Commit: "feat(core): add framework detection"
Expected: Minor bump (5.0.0 → 5.1.0)

Commit: "fix(router): resolve delegation loop"
Expected: Patch bump (5.1.0 → 5.1.1)

Commit: "feat!: rewrite plugin loading\n\nBREAKING CHANGE: plugin.json schema updated"
Expected: Major bump (5.1.1 → 6.0.0)

Commit: "docs: update README"
Expected: No bump (version unchanged)
```

### FR-2: Version File Synchronization

**Description**: Update all version-containing files atomically.

**Acceptance Criteria:**
- **FR-2.1**: Update `packages/*/plugin.json` version field
- **FR-2.2**: Update `packages/*/package.json` version field
- **FR-2.3**: Update `marketplace.json` plugin entry version
- **FR-2.4**: Ensure all three files have identical version numbers
- **FR-2.5**: Perform updates atomically (all or nothing)
- **FR-2.6**: Preserve JSON formatting and field order
- **FR-2.7**: Validate JSON syntax after update

**Test Scenarios:**
```
Scenario: Bump ensemble-core from 5.1.0 to 5.2.0
Files Updated:
  - packages/core/.claude-plugin/plugin.json: "version": "5.2.0"
  - packages/core/package.json: "version": "5.2.0"
  - marketplace.json: plugins[0].version: "5.2.0"

Validation:
  - All three files must have "5.2.0"
  - JSON must be valid
  - Formatting unchanged (2-space indent preserved)
```

### FR-3: Ensemble-Full Cascade Logic

**Description**: Automatically update ensemble-full when constituent plugins change.

**Acceptance Criteria:**
- **FR-3.1**: Detect when any constituent plugin (packages/* except full) is bumped
- **FR-3.2**: Apply same bump type to ensemble-full (minor → minor, major → major)
- **FR-3.3**: Update ensemble-full dependencies using `workspace:*` format for development
- **FR-3.4**: Handle multiple constituent changes in single commit (apply highest precedence: breaking > minor > patch)
- **FR-3.5**: Update marketplace.json ensemble-full entry
- **FR-3.6**: Skip cascade if only ensemble-full itself changes
- **FR-3.7**: **Version-locked strategy**: All 25 packages maintain same version number for simplicity ("Ensemble 5.2.0")

**Test Scenarios:**
```
Scenario: ensemble-core bumped from 5.1.0 to 5.2.0 (minor)
Result: ensemble-full bumped from 5.1.0 to 5.2.0 (minor)

Scenario: ensemble-git bumped from 5.0.0 to 6.0.0 (major)
Result: ensemble-full bumped from 5.2.0 to 6.0.0 (major)

Scenario: ensemble-react (5.0.0→5.1.0) and ensemble-jest (5.0.0→5.0.1) in same commit
Result: ensemble-full bumped by minor (higher precedence)

Scenario: Only ensemble-full changes
Result: No cascade (avoid infinite loop)
```

### FR-4: Pre-Commit Hook Integration

**Description**: Validate and prepare version bumps before commit using a **pre-commit** hook that runs before the commit is finalized.

**Acceptance Criteria:**
- **FR-4.1**: Install **pre-commit** hook via Husky or equivalent (runs before commit is finalized)
- **FR-4.2**: Parse staged commit message to determine bump type
- **FR-4.3**: Display proposed version changes to developer
- **FR-4.4**: Update version files before commit completes
- **FR-4.5**: Stage updated version files automatically (everything in one clean commit)
- **FR-4.6**: Fail commit if version consistency check fails
- **FR-4.7**: Allow `--no-verify` to skip hook for emergencies

**Test Scenarios:**
```
Action: git commit -m "feat: add new agent"
Output:
  📦 Version bump preview:
  - ensemble-development: 5.0.0 → 5.1.0 (minor)
  - ensemble-full: 5.1.0 → 5.2.0 (minor)

  ✓ Updated 6 files
  ✓ All versions synchronized

Action: git commit -m "feat: add feature" (but versions already manually bumped incorrectly)
Output:
  ✗ Version mismatch detected:
    plugin.json: 5.2.0
    package.json: 5.1.0

  Run `npm run fix-versions` to synchronize

Commit: Failed
```

### FR-5: CI/CD Validation

**Description**: Validate version consistency in CI pipeline.

**Acceptance Criteria:**
- **FR-5.1**: Add version validation step to existing validate.yml workflow
- **FR-5.2**: Check all plugin.json versions match package.json versions
- **FR-5.3**: Check marketplace.json versions match plugin.json versions
- **FR-5.4**: Verify ensemble-full version >= max(constituent versions)
- **FR-5.5**: Fail PR checks if version inconsistency detected
- **FR-5.6**: Provide clear error message with fix instructions
- **FR-5.7**: Run validation on every pull request

**Test Scenarios:**
```
PR with inconsistent versions:
  ✗ Version validation failed

  Mismatches found:
  - ensemble-core/plugin.json: 5.2.0
  - ensemble-core/package.json: 5.1.0

  Fix: Run `npm run fix-versions` and commit changes

PR with correct versions:
  ✓ Version validation passed

  Verified:
  - 25 plugins: All versions consistent
  - ensemble-full: Correctly versioned (5.2.0)
  - marketplace.json: All entries match
```

### FR-6: Manual Override Support

**Description**: Allow developers to override automatic version bumps.

**Acceptance Criteria:**
- **FR-6.1**: Provide `--bump-major`, `--bump-minor`, `--bump-patch` flags
- **FR-6.2**: Provide `--no-bump` flag to skip version bump
- **FR-6.3**: Provide `--set-version X.Y.Z` to force specific version
- **FR-6.4**: Log override decisions for audit trail
- **FR-6.5**: Warn developer when override conflicts with conventional commit
- **FR-6.6**: Require confirmation for major version bumps

**Test Scenarios:**
```
Command: git commit -m "fix: typo" --bump-major
Output:
  ⚠️  Override detected: Conventional commit suggests patch, but major requested

  Proceed with major bump? (5.1.1 → 6.0.0) [y/N]: y

  ✓ Version bumped to 6.0.0 (manual override logged)

Command: git commit -m "feat: add feature" --no-bump
Output:
  ℹ️  Skipping version bump (manual override)

  Note: Conventional commit suggests minor bump, but --no-bump was specified
```

### FR-7: Changelog Generation

**Description**: Auto-generate root-level CHANGELOG.md from conventional commits (covering all packages).

**Acceptance Criteria:**
- **FR-7.1**: Update single root-level `CHANGELOG.md` on version bump (not per-plugin changelogs)
- **FR-7.2**: Group changes by type (Features, Bug Fixes, Breaking Changes)
- **FR-7.3**: Include commit scope if present (e.g., `feat(core):`) to indicate which package changed
- **FR-7.4**: Link to GitHub commit via short SHA
- **FR-7.5**: Maintain reverse chronological order (newest first)
- **FR-7.6**: Preserve existing changelog entries
- **FR-7.7**: Follow Keep a Changelog format

**Test Scenarios:**
```
Commits since last release:
  - feat(core): add framework detection (abc123)
  - fix(router): resolve delegation loop (def456)
  - feat!: rewrite plugin loading (ghi789)

Generated CHANGELOG.md:
---
## [6.0.0] - 2026-01-09

### ⚠️ Breaking Changes
- Rewrite plugin loading ([ghi789](https://github.com/FortiumPartners/ensemble/commit/ghi789))

### ✨ Features
- **core**: Add framework detection ([abc123](https://github.com/FortiumPartners/ensemble/commit/abc123))

### 🐛 Bug Fixes
- **router**: Resolve delegation loop ([def456](https://github.com/FortiumPartners/ensemble/commit/def456))

---
```

### FR-8: Error Recovery

**Description**: Handle edge cases and provide clear recovery paths.

**Acceptance Criteria:**
- **FR-8.1**: Detect partial version updates (only some files changed) → abort and rollback
- **FR-8.2**: Detect version conflicts (manual and auto bump) → prompt developer
- **FR-8.3**: Detect invalid semver versions → fail with clear error
- **FR-8.4**: Provide `npm run fix-versions` command to repair inconsistencies
- **FR-8.5**: Log detailed error messages with fix instructions
- **FR-8.6**: Support `--dry-run` flag to preview changes without applying
- **FR-8.7**: **Merge conflict handling**: Fail with conflict error if version file changes conflict during merge (require manual resolution to prevent accidental downgrades)
- **FR-8.8**: **Revert handling**: Versions never decrease per semver rules; reverting code doesn't revert version numbers (versions only increase)

**Test Scenarios:**
```
Error: Partial version update detected
State:
  - plugin.json: 5.2.0 (updated)
  - package.json: 5.1.0 (not updated)

Recovery:
  $ npm run fix-versions --package core

  Analyzing ensemble-core...
  ✓ Updated package.json: 5.1.0 → 5.2.0
  ✓ Updated marketplace.json: 5.1.0 → 5.2.0

  All versions now consistent at 5.2.0

Preview Mode:
  $ git commit -m "feat: add feature" --dry-run

  📦 Version bump preview (no changes applied):
  - ensemble-development: 5.0.0 → 5.1.0 (minor)
  - ensemble-full: 5.1.0 → 5.2.0 (minor)

  Files to be updated:
  ✓ packages/development/.claude-plugin/plugin.json
  ✓ packages/development/package.json
  ✓ packages/full/.claude-plugin/plugin.json
  ✓ packages/full/package.json
  ✓ marketplace.json
```

---

## 5. Non-Functional Requirements

### NFR-1: Performance

**Requirements:**
- **NFR-1.1**: Pre-commit hook must complete in <2 seconds
- **NFR-1.2**: CI validation must complete in <30 seconds
- **NFR-1.3**: Version file updates must be atomic (all or nothing)
- **NFR-1.4**: Support for 25+ plugins without performance degradation

**Rationale**: Developers will disable hooks if they add noticeable latency.

### NFR-2: Reliability

**Requirements:**
- **NFR-2.1**: 99.9% success rate for version bumps (no missed updates)
- **NFR-2.2**: Zero version consistency errors post-automation
- **NFR-2.3**: Graceful degradation if automation fails (manual fallback)
- **NFR-2.4**: Idempotent operations (running twice produces same result)

**Rationale**: Version errors break marketplace updates and user trust.

### NFR-3: Maintainability

**Requirements:**
- **NFR-3.1**: Configuration via JSON file (`.versionrc.json` or similar)
- **NFR-3.2**: Logging to file for debugging (`.version-bumps.log`)
- **NFR-3.3**: Clear error messages with actionable fix instructions
- **NFR-3.4**: Unit tests for all version bump scenarios (>90% coverage)
- **NFR-3.5**: Integration tests for cascade logic

**Rationale**: DevOps team must be able to diagnose and fix issues quickly.

### NFR-4: Usability

**Requirements:**
- **NFR-4.1**: Zero-configuration for standard workflows (works out of box)
- **NFR-4.2**: Clear, concise output (no verbose noise)
- **NFR-4.3**: Intuitive flags for manual overrides (`--bump-major` not `--major-version-increment`)
- **NFR-4.4**: Documentation with examples in CLAUDE.md

**Rationale**: Low friction adoption by development team.

### NFR-5: Compatibility

**Requirements:**
- **NFR-5.1**: Node.js 20+ (match existing requirement)
- **NFR-5.2**: Works with existing npm workspaces setup
- **NFR-5.3**: Compatible with GitHub Actions workflows
- **NFR-5.4**: Works with Husky or simple-git-hooks for pre-commit
- **NFR-5.5**: No breaking changes to existing commit workflow

**Rationale**: Must integrate seamlessly with current toolchain.

### NFR-6: Security

**Requirements:**
- **NFR-6.1**: No external API calls (all local computation)
- **NFR-6.2**: Read-only access to git history
- **NFR-6.3**: Write access only to version files (plugin.json, package.json, marketplace.json)
- **NFR-6.4**: No secrets or credentials required
- **NFR-6.5**: Audit log for manual overrides (who, when, why)

**Rationale**: Version management is critical infrastructure; minimize attack surface.

---

## 6. Technical Constraints

### Existing Infrastructure
- **Monorepo**: npm workspaces with 25 packages
- **Conventional Commits**: Already in use by team
- **CI/CD**: GitHub Actions (validate.yml, release.yml)
- **Package Manager**: npm (not yarn or pnpm)
- **Node Version**: 20+ required

### Integration Points
- **Pre-commit hooks**: Husky or simple-git-hooks
- **CI validation**: Extend existing validate.yml
- **Release workflow**: Integrate with release.yml
- **Marketplace**: Update marketplace.json atomically

### File Format Requirements
- **JSON formatting**: Preserve 2-space indentation
- **Field ordering**: Maintain existing key order in JSON files
- **Changelog format**: Keep a Changelog 1.0.0 spec

---

## 7. Acceptance Criteria

### AC-1: Zero-Config Happy Path

**Given**: Developer clones ensemble repository
**When**: Developer makes commit with conventional message
**Then**:
- Version files are automatically updated
- marketplace.json is updated
- ensemble-full is cascaded if needed
- Commit succeeds without manual intervention

**Test**:
```bash
# Fresh clone
git clone https://github.com/FortiumPartners/ensemble
cd ensemble
npm install

# Make change and commit
echo "// test" >> packages/core/lib/index.js
git add packages/core/lib/index.js
git commit -m "feat(core): add test utility"

# Verify
cat packages/core/.claude-plugin/plugin.json | grep version
# Expected: "version": "5.2.0"

cat packages/core/package.json | grep version
# Expected: "version": "5.2.0"

cat marketplace.json | grep -A2 ensemble-core | grep version
# Expected: "version": "5.2.0"
```

### AC-2: Cascade Validation

**Given**: ensemble-react is bumped from 5.0.0 to 5.1.0
**When**: Commit is made
**Then**:
- ensemble-full is bumped from 5.1.0 to 5.2.0
- ensemble-full dependencies reference react@5.1.0
- marketplace.json reflects both updates

**Test**:
```bash
# Change react
echo "// test" >> packages/react/skills/SKILL.md
git commit -m "feat(react): add pattern"

# Verify cascade
cat packages/full/.claude-plugin/plugin.json | grep version
# Expected: "version": "5.2.0"

cat packages/full/package.json | grep ensemble-react
# Expected: "@fortium/ensemble-react": "5.1.0"
```

### AC-3: Manual Override

**Given**: Developer needs to force major version bump
**When**: Developer uses `--bump-major` flag
**Then**:
- Version is bumped to next major (e.g., 5.1.0 → 6.0.0)
- Override is logged
- Warning is displayed if conventional commit suggests different bump

**Test**:
```bash
git commit -m "fix(core): typo" --bump-major

# Expected output:
# ⚠️  Override: Conventional commit suggests patch, but major requested
# Proceed with major bump? (5.2.0 → 6.0.0) [y/N]: y
# ✓ Version bumped to 6.0.0 (manual override logged)
```

### AC-4: CI Validation Failure

**Given**: Developer manually edits plugin.json but forgets package.json
**When**: PR is created
**Then**:
- CI validation fails
- Clear error message with fix instructions
- PR checks show red X

**Test**:
```bash
# Manually create inconsistency
sed -i '' 's/"version": "5.2.0"/"version": "5.3.0"/' packages/core/.claude-plugin/plugin.json
git commit -m "chore: update version" --no-verify
git push origin feature-branch

# GitHub Actions output:
# ✗ Version validation failed
#
# Mismatches:
# - packages/core/.claude-plugin/plugin.json: 5.3.0
# - packages/core/package.json: 5.2.0
#
# Fix: Run `npm run fix-versions --package core`
```

### AC-5: Breaking Change Detection

**Given**: Commit contains `BREAKING CHANGE:` in body
**When**: Commit is made
**Then**:
- Major version bump is applied (e.g., 5.2.0 → 6.0.0)
- Changelog marks it as breaking change
- ensemble-full is bumped to match major version

**Test**:
```bash
git commit -m "feat!: rewrite API

BREAKING CHANGE: plugin.json schema updated, requires migration"

# Verify
cat packages/core/.claude-plugin/plugin.json | grep version
# Expected: "version": "6.0.0"

cat CHANGELOG.md
# Expected: Contains "⚠️ Breaking Changes" section
```

### AC-6: Error Recovery

**Given**: Version files are out of sync
**When**: Developer runs `npm run fix-versions`
**Then**:
- Inconsistencies are detected
- Fix strategy is proposed
- All versions are synchronized

**Test**:
```bash
# Create inconsistency
echo '{"version": "5.5.0"}' > packages/core/.claude-plugin/plugin.json
# (but package.json still at 5.2.0)

npm run fix-versions --package core

# Expected output:
# Analyzing ensemble-core...
# Detected versions:
# - plugin.json: 5.5.0
# - package.json: 5.2.0
# - marketplace.json: 5.2.0
#
# Fix strategy: Use highest version (5.5.0)
#
# ✓ Updated package.json: 5.2.0 → 5.5.0
# ✓ Updated marketplace.json: 5.2.0 → 5.5.0
#
# All versions now consistent at 5.5.0
```

---

## 8. Dependencies & Assumptions

### Dependencies
- **conventional-commits-parser**: Parse conventional commit messages
- **semver**: Semantic version manipulation
- **Husky or simple-git-hooks**: Pre-commit hook management
- **standard-version or semantic-release**: Optional (for changelog generation)

### Assumptions
- Development team continues using conventional commits
- Git is the version control system
- Releases are tagged via `v*` pattern
- Marketplace updates are driven by version field changes

### Risks & Mitigations

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| Developers bypass hooks with `--no-verify` | High | Medium | Make CI validation strict; add team guidelines |
| Conventional commits written incorrectly | Medium | High | Add commit message linter (commitlint) |
| Breaking change not marked in commit | High | Low | Require PR template checklist for breaking changes |
| Cascade logic creates version explosion | Medium | Low | Cap ensemble-full bump to max(constituent bumps) |
| Performance degrades with 50+ plugins | Low | Low | Optimize file I/O; add performance tests |

---

## 9. Success Criteria & Metrics

### Launch Criteria (Definition of Done)
- [ ] Pre-commit hook installed and working
- [ ] CI validation passing on all PRs
- [ ] Cascade logic tested with 5+ constituent plugin changes
- [ ] Manual override flags functional
- [ ] Documentation updated (CLAUDE.md)
- [ ] Unit tests passing (>90% coverage)
- [ ] Integration tests passing
- [ ] Team training completed
- [ ] 2-week beta period with core team (no major issues)

### Post-Launch Metrics (3 Months)

**Primary KPIs:**
- **Version consistency**: 100% (zero mismatches in production)
- **Manual override rate**: <5% of commits
- **CI validation pass rate**: >98%
- **Release preparation time**: <5 minutes (from 30 minutes baseline)

**Secondary KPIs:**
- **Developer satisfaction**: Survey score >8/10
- **Version-related bugs**: <1 per quarter (from 2-3/month baseline)
- **Marketplace update reliability**: 100% (from ~85% baseline)
- **Time saved per developer**: ~2 hours/month

### Monitoring Plan
- **Weekly**: Review manual override log (identify patterns)
- **Bi-weekly**: Check CI validation failures (root cause analysis)
- **Monthly**: Developer feedback survey
- **Quarterly**: ROI analysis (time saved vs. maintenance cost)

---

## 10. Open Questions & Future Considerations

### Open Questions
1. **Should we backfill versions for historical commits?**
   - Leaning: No (prospective only to reduce complexity)

2. **How to handle version bumps for multi-package PRs?**
   - Leaning: Apply highest bump type across all changed packages

3. **Should changelogs be plugin-specific or monorepo-level?**
   - Leaning: Both (individual plugin CHANGELOGs + root-level summary)

4. **What to do when ensemble-full version is manually set higher?**
   - Leaning: Respect manual version, warn about drift

5. **Should we add version bump preview to PR descriptions?**
   - Leaning: Yes (via GitHub Action comment on PR)

### Future Enhancements (Post-V1)
1. **Interactive bump selection** - Prompt if conventional commit is ambiguous
2. **Dependency-aware bumping** - Bump dependents when dependencies change
3. **Slack notifications** - Notify channel on major version bumps
4. **Version metrics dashboard** - Grafana dashboard with bump trends
5. **LTS version tracking** - Mark and freeze LTS versions (e.g., 5.x branch)
6. **Multi-repository support** - Extend to other Fortium monorepos

---

## 11. Appendix

### A. Conventional Commit Reference

| Type | Version Bump | Example |
|------|-------------|---------|
| `feat:` | Minor | `feat(core): add framework detection` |
| `fix:` | Patch | `fix(router): resolve delegation loop` |
| `feat!:` or `BREAKING CHANGE:` | Major | `feat!: rewrite plugin API` |
| `docs:`, `test:`, `chore:` | None | `docs: update README` |

### B. Semver Bump Rules

```
Current: 5.1.3

feat:         → 5.2.0 (minor)
fix:          → 5.1.4 (patch)
BREAKING:     → 6.0.0 (major)

Multiple commits:
  feat: + fix: → 5.2.0 (minor wins)
  feat: + BREAKING: → 6.0.0 (major wins)
```

### C. File Structure

```
ensemble/
├── packages/
│   ├── core/
│   │   ├── .claude-plugin/plugin.json  [version: X.Y.Z]
│   │   ├── package.json                [version: X.Y.Z]
│   │   └── CHANGELOG.md
│   └── full/
│       ├── .claude-plugin/plugin.json  [version: X.Y.Z]
│       └── package.json                [version: X.Y.Z, dependencies]
├── marketplace.json                    [plugins[].version: X.Y.Z]
├── .versionrc.json                     [config]
└── scripts/
    ├── bump-versions.js
    └── fix-versions.js
```

### D. Implementation Phases

**Phase 1: Core Automation (Weeks 1-2)**
- Implement conventional commit parsing
- Add version file synchronization
- Create pre-commit hook
- Unit tests

**Phase 2: Cascade Logic (Week 3)**
- Implement ensemble-full cascade
- Handle multi-package changes
- Integration tests

**Phase 3: CI Integration (Week 4)**
- Add validation to GitHub Actions
- Create fix-versions command
- Error recovery logic

**Phase 4: Polish & Launch (Week 5)**
- Manual override flags
- Changelog generation
- Documentation
- Team training

---

## Document Approval

| Role | Name | Signature | Date |
|------|------|-----------|------|
| Product Owner | TBD | | |
| Tech Lead | TBD | | |
| DevOps Lead | TBD | | |
| Developer Representative | TBD | | |

---

## 12. Version History

### Version 1.1.0 - 2026-01-09 (Refinement)

**Changes Based on User Interview:**

**Q1 - Hook Type Decision:**
- **Decision**: Use **pre-commit** hook (not post-commit)
- **Rationale**: Parses commit message, updates version files, and stages them all in one clean commit before finalization
- **Impact**: Updated FR-4 to specify pre-commit hook behavior

**Q2 - Dependency Format Decision:**
- **Decision**: Use **`workspace:*`** format for monorepo dependencies
- **Rationale**: Maintains monorepo simplicity, auto-resolves to local packages during development, specific versions only applied during publish
- **Impact**: Updated FR-3.3 to specify workspace:* format

**Q3 - Multi-commit Strategy Decision:**
- **Decision**: Apply **highest precedence** bump (breaking > minor > patch)
- **Rationale**: One breaking change in a PR = major bump for entire PR
- **Impact**: Updated FR-3.4 to clarify precedence order

**Q4 - Versioning Strategy Decision:**
- **Decision**: **Version-locked** - all 25 packages maintain same version number
- **Rationale**: Simpler for users ("Ensemble 5.2.0"), reduces confusion
- **Impact**: Added FR-3.7 to document version-locked strategy

**Q5 - Merge Conflict Decision:**
- **Decision**: **Fail with conflict** (require manual resolution)
- **Rationale**: Prevents accidental downgrades, forces explicit decisions
- **Impact**: Added FR-8.7 for merge conflict handling

**Q6 - Pre-release Scope Decision:**
- **Decision**: **Out of scope** for Phase 1
- **Rationale**: Focus on stable releases only (5.x.x), pre-release versions handled manually
- **Impact**: Added to Non-Goals section (item 7)

**Q7 - Phase 1 Priority Decision:**
- **Decision**: Move **Changelog generation** to Phase 1 (Primary Goals)
- **Rationale**: Critical for user communication and release notes
- **Impact**: Moved FR-7 from Secondary Goals to Primary Goals (item 6)

**Q8 - Changelog Strategy Decision:**
- **Decision**: **Root-level only** (single CHANGELOG.md at repository root)
- **Rationale**: Covers all packages, simpler to maintain, single source of truth
- **Impact**: Updated FR-7.1 to specify root-level changelog only

**Q9 - Revert Behavior Decision:**
- **Decision**: **Versions never decrease** per semver rules
- **Rationale**: Reverting code doesn't revert version numbers; versions only increase
- **Impact**: Added FR-8.8 for revert handling

**Manual Override Moved to Phase 4:**
- **Decision**: Manual override capability (FR-6) moved from Secondary Goals to Future Phase Goals
- **Rationale**: Focus Phase 1 on core automation; manual overrides can be added later
- **Impact**: Updated Goals section to reflect Phase 4 priority

### Version 1.0.0 - 2026-01-09 (Initial Draft)

**Initial PRD created with:**
- Problem statement and solution overview
- User personas and journey mapping
- Functional requirements (FR-1 through FR-8)
- Non-functional requirements
- Technical constraints
- Acceptance criteria
- Implementation phases

---

**End of Document**
