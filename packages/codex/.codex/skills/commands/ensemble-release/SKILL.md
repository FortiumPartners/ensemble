---
name: ensemble-release
description: "Automated release workflow orchestration with quality gates, smoke test integration,\nand deployment coordination. Supports standard, hotfix, and rollback release types.\n"
disable-model-invocation: true
metadata:
  version: "1.0.0"
  category: deployment
---

This command orchestrates the complete release workflow from quality gates through deployment
and verification. It orchestrates the workflow directly, coordinating with
specialized agents (code-reviewer, test-runner, playwright-tester, deployment-orchestrator)
to ensure safe, reliable releases with comprehensive smoke test coverage and automated rollback.

## Workflow

Work through the phases in numbered order. Each phase's full instructions are in its own file under `references/`, in this skill's directory: open the file with your file-reading tool (not a shell command) when you reach that phase and follow it exactly. Resolve the paths below relative to this SKILL.md.

| Phase | Instructions | Steps |
|---|---|---|
| Phase 1: Release Initialization | `references/phase-1-release-initialization.md` | Version Validation; Release Type Validation; Release Branch Creation; Changelog Generation |
| Phase 2: Quality Gates | `references/phase-2-quality-gates.md` | Security Scan; Definition of Done Validation; Unit Test Execution; Integration Test Execution; Pre-Release Smoke Tests; E2E Test Execution |
| Phase 3: Staging Deployment | `references/phase-3-staging-deployment.md` | Deploy to Staging; Post-Staging Smoke Tests |
| Phase 4: Production Deployment | `references/phase-4-production-deployment.md` | Deploy to Production (Canary); Post-Production Smoke Tests |
| Phase 5: Release Completion | `references/phase-5-release-completion.md` | Create Pull Request; Create GitHub Release; Generate Release Report; Append Audit Log; Update Tickets |
| Phase 6: Rollback (On Failure) | `references/phase-6-rollback.md` | Trigger Rollback; Revert Traffic; Post-Rollback Smoke Tests; Health Validation; Create Git Revert; Update Tickets |

## Expected Output

**Format:** Release workflow results

**Structure:**

- **Quality Gate Results**: Security scan, DoD validation, test results (unit, integration, smoke, E2E)
- **Deployment Results**: Staging deployment, production deployment (canary progression), smoke test results
- **Release Artifacts**: Pull request URL, GitHub release URL, release report, audit log
- **Rollback Results**: (If triggered) Traffic reversion, post-rollback smoke tests, health validation

## Arguments

```yaml
required:
  - name: '--version'
    type: string
    format: X.Y.Z
    description: Semantic version for the release (e.g., 2.1.0)
    validation:
      - Matches semantic versioning format (X.Y.Z)
      - No conflicts with existing tags/branches
    example: '--version 2.1.0'
optional:
  - name: '--type'
    type: enum
    values:
      - standard
      - hotfix
      - rollback
    default: standard
    description: Release type (standard, hotfix, rollback)
    example: '--type hotfix'
  - name: '--from'
    type: string
    description: Base branch for release (overrides default)
    default: main (standard), production (hotfix)
    example: '--from develop'
  - name: '--to'
    type: string
    description: Target branch for release (overrides default)
    default: release/vX.Y.Z (standard), hotfix/vX.Y.Z (hotfix)
    example: '--to release/v2.1.0'
  - name: '--base'
    type: string
    description: Alias for --from (base branch)
    example: '--base main'
  - name: '--target'
    type: string
    description: Alias for --to (target branch)
    example: '--target release/v2.1.0'
  - name: '--rollback'
    type: boolean
    description: Trigger manual rollback (equivalent to --type rollback)
    example: '--rollback'
  - name: '--draft'
    type: boolean
    description: Create GitHub release as draft
    example: '--draft'
  - name: '--dry-run'
    type: boolean
    description: Simulate release workflow without mutations (future enhancement)
    example: '--dry-run'
```

## Expected Input

- **format**: Command arguments
- **required**:
  - Release version (semantic versioning X.Y.Z)
- **optional**:
  - Release type (standard, hotfix, rollback)
  - Base branch (main, develop, production)
  - Target branch (release/vX.Y.Z, hotfix/vX.Y.Z)
  - Draft mode flag
  - Dry-run flag (future)

## Usage Examples

- **name**: Standard Release
  - **command**: /release --version 2.1.0
  - **description**: Execute standard release workflow with full quality gates and staging deployment
- **name**: Hotfix Release
  - **command**: /release --version 2.1.1 --type hotfix
  - **description**: Execute fast-track hotfix workflow with canary deployment (skips staging)
- **name**: Manual Rollback
  - **command**: /release --version 2.1.0 --rollback
  - **description**: Manually trigger rollback to previous version
- **name**: Custom Branches
  - **command**: /release --version 2.1.0 --from develop --to release/v2.1.0
  - **description**: Release from custom base branch to custom target branch
- **name**: Draft Release
  - **command**: /release --version 2.1.0 --draft
  - **description**: Create release as draft for review before publishing

## Timing Budget

- **standardRelease**:
  - **qualityGates**: 20 minutes excluding smoke run
  - **stagingDeployment**: 5 minutes
  - **productionDeployment**: 5 minutes
  - **total**: 30 minutes excluding smoke runs (each smoke run is up to 15 minutes)
- **hotfixRelease**:
  - **fastTrackGates**: 10 minutes
  - **canaryDeployment**: 10 minutes
  - **total**: 20 minutes
- **rollback**:
  - **trafficReversion**: 2 minutes
  - **smokeTestVerification**: up to 15 minutes
  - **healthMonitoring**: 5 minutes
  - **total**: 10 minutes

## Quality Gates

```yaml
required:
  - name: Security Scan
    target: Zero critical/high severity issues
    timeout: 10 minutes
  - name: DoD Validation
    target: All 8 categories pass
    timeout: 10 minutes
  - name: Unit Tests
    target: ≥80% coverage, 0 failures
    timeout: 15 minutes
  - name: Integration Tests
    target: ≥70% coverage, 0 failures
    timeout: 15 minutes
  - name: Smoke Tests
    target: 'Runner verdict is passed: every required category executed and passed (a NOT CONFIGURED required category blocks the release)'
    timeout: 15 minutes
  - name: E2E Tests
    target: All critical journeys pass
    timeout: 10 minutes
deployment:
  - name: Staging Deployment
    target: ≤5 minutes excluding smoke run (2min deploy)
    timeout: 15 minutes
  - name: Production Deployment
    target: ≤5 minutes excluding smoke runs (canary progression)
    timeout: 15 minutes
  - name: Rollback
    target: ≤7 minutes excluding smoke run (2min revert + 5min health)
    timeout: 15 minutes
```

## Success Criteria

- All quality gates pass
- Staging deployment successful with smoke tests passing
- Production deployment successful with canary progression
- Post-production smoke tests passing
- Error rate <1% for 5 minutes post-deployment
- Release artifacts created (PR, GitHub release, report, audit log)
- Tickets updated with release information

## Failure Criteria

- Any quality gate fails
- Staging deployment or smoke tests fail
- Production smoke test failure
- Error rate >5% for 2 minutes
- Health check failure (3 consecutive)
- Rollback triggered

## Rollback Triggers

- **automatic**:
  - Production smoke test failure (any category)
  - Error rate >5% for 2 minutes
  - Health check failure (3 consecutive checks)
- **manual**:
  - On-call engineer initiated rollback (--rollback flag)
  - Critical production issue detected
