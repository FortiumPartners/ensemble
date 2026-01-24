---
name: ensemble:release
description: Automated release workflow orchestration with quality gates, smoke test integration,
and deployment coordination. Supports standard, hotfix, and rollback release types.

---
<!-- DO NOT EDIT - Generated from release.yaml -->
<!-- To modify this file, edit the YAML source and run: npm run generate -->


This command orchestrates the complete release workflow from quality gates through deployment
and verification. It delegates to release-agent for workflow orchestration, coordinating with
specialized agents (code-reviewer, test-runner, playwright-tester, deployment-orchestrator)
to ensure safe, reliable releases with comprehensive smoke test coverage and automated rollback.

## Workflow

### Phase 1: Release Initialization

**1. Version Validation**
   Validate semantic version format (X.Y.Z)

   - Parse --version argument
   - Validate semantic versioning format
   - Check for version conflicts (tag/branch exists)

**2. Release Type Validation**
   Validate release type and workflow selection

   - Parse --type argument (standard, hotfix, rollback)
   - Determine base branch (main, develop, production)
   - Determine target branch (release/vX.Y.Z, hotfix/vX.Y.Z)
   - Validate branch arguments if provided

**3. Release Branch Creation**
   Create release branch via git-workflow

   - Create release branch from base
   - Push to remote
   - Verify branch created successfully

   **Delegation:** @git-workflow
   Base and target branches, release version

**4. Changelog Generation**
   Generate changelog from git history

   - Parse commits since last release
   - Categorize changes (breaking, new, enhancement, bugfix)
   - Generate markdown formatted changelog
   - Add changelog to release branch

### Phase 2: Quality Gates

**1. Security Scan**
   Execute security vulnerability scan via code-reviewer

   - Scan for OWASP Top 10 vulnerabilities
   - Check for critical and high-severity issues
   - Generate security report
   - Block on critical/high issues

   **Delegation:** @code-reviewer
   Release branch, security scan operation

**2. Definition of Done Validation**
   Validate all DoD categories via code-reviewer

   - Validate all 8 DoD categories
   - Check test coverage targets (unit ≥80%, integration ≥70%)
   - Verify documentation updated
   - Block on any category failure

   **Delegation:** @code-reviewer
   Release branch, DoD validation operation

**3. Unit Test Execution**
   Execute unit test suite via test-runner

   - Run unit test suite with coverage
   - Require ≥80% coverage
   - Provide intelligent failure triage
   - Block on failures or coverage below threshold

   **Delegation:** @test-runner
   Release branch, unit tests operation

**4. Integration Test Execution**
   Execute integration test suite via test-runner

   - Run integration test suite with coverage
   - Require ≥70% coverage
   - Provide intelligent failure triage
   - Block on failures or coverage below threshold

   **Delegation:** @test-runner
   Release branch, integration tests operation

**5. Pre-Release Smoke Tests**
   Execute smoke test suite before deployment

   - Execute 5-category smoke test suite - API Health - Database connectivity - External services - Authentication - Critical paths
   - Use pre-release environment configuration
   - Block on any smoke test failure

**6. E2E Test Execution**
   Execute critical user journeys via playwright-tester

   - Execute critical user journey tests
   - Capture trace artifacts for all journeys
   - Capture screenshots on failures
   - Block on any journey failure

   **Delegation:** @playwright-tester
   Release branch, staging environment

### Phase 3: Staging Deployment

**1. Deploy to Staging**
   Deploy release to staging environment

   - Execute blue-green or rolling deployment
   - Verify health checks
   - Route traffic to new version

   **Delegation:** @deployment-orchestrator
   Release version, staging environment, deployment strategy

**2. Post-Staging Smoke Tests**
   Verify staging deployment with smoke tests

   - Execute full 5-category smoke test suite
   - Use staging-specific configuration
   - Verify all smoke tests pass
   - Block on any smoke test failure

### Phase 4: Production Deployment

**1. Deploy to Production (Canary)**
   Deploy to production using canary strategy

   - Deploy to canary infrastructure
   - Route 5% traffic to canary
   - Execute canary smoke tests (smoke-test-runner skill)
   - Monitor error rate for 2 minutes
   - If pass: Route 25% traffic, execute smoke tests
   - If pass: Route 100% traffic, execute final smoke tests
   - If fail at any stage: Trigger automated rollback

   **Delegation:** @deployment-orchestrator
   Release version, production environment, canary strategy

**2. Post-Production Smoke Tests**
   Final verification of production deployment

   - Execute full 5-category smoke test suite
   - Use production-specific configuration
   - Monitor error rate for 5 minutes
   - Trigger rollback on smoke test failure or error rate >5%

### Phase 5: Release Completion

**1. Create Pull Request**
   Create release PR via github-specialist

   - Create PR with changelog in description
   - Add labels (release, version)
   - Request reviews from tech-lead
   - Link to release artifacts

   **Delegation:** @github-specialist
   Release branch, main branch, changelog

**2. Create GitHub Release**
   Publish GitHub release with notes

   - Create GitHub release with tag
   - Attach release notes
   - Mark as draft if --draft flag provided

   **Delegation:** @github-specialist
   Release version, changelog, release notes

**3. Generate Release Report**
   Create comprehensive release report

   - Compile test execution history
   - Include smoke test results
   - Add deployment timeline
   - Summarize quality gate metrics

**4. Append Audit Log**
   Record release in audit log

   - Append audit log entry with test tracking
   - Include approval history
   - Record deployment events
   - Add release artifacts links

**5. Update Tickets**
   Update Linear/Jira tickets with release info

   - Update ticket status to deployed
   - Attach release report
   - Link to PR and GitHub release
   - Add deployment timestamp

**6. Send Release Metrics**
   Report metrics to manager-dashboard-agent

   - Send cycle time metric
   - Send success/failure status
   - Send test execution metrics
   - Send deployment duration

   **Delegation:** @manager-dashboard-agent
   Release metrics, cycle time, success rate

### Phase 6: Rollback (On Failure)

**1. Trigger Rollback**
   Initiate automated rollback workflow

   - Detect failure condition (smoke test, error rate, health check)
   - Alert on-call engineer
   - Capture rollback trigger context

**2. Revert Traffic**
   Route traffic to previous version

   - Route all traffic to previous version
   - Verify previous version health checks
   - Capture traffic reversion metrics

   **Delegation:** @deployment-orchestrator
   Rollback operation, previous version

**3. Post-Rollback Smoke Tests**
   Verify rollback success with smoke tests

   - Execute full 5-category smoke test suite
   - Verify error rate normalized
   - Confirm system stability
   - Escalate on smoke test failure

**4. Health Validation**
   Monitor system health post-rollback

   - Monitor error rate (<1% target)
   - Verify all health checks passing
   - Confirm no degradation
   - Escalate on health check failure

**5. Create Git Revert**
   Create revert commit in git

   - Create revert commit
   - Tag rollback version (vX.Y.Z-rollback)
   - Update changelog with rollback entry

   **Delegation:** @git-workflow
   Rollback operation, release version

**6. Update Tickets**
   Document rollback in tickets

   - Update ticket status to rolled-back
   - Add rollback reason
   - Link to rollback artifacts
   - Schedule post-mortem

## Expected Output

**Format:** Release workflow results

**Structure:**
- **Quality Gate Results**: Security scan, DoD validation, test results (unit, integration, smoke, E2E)
- **Deployment Results**: Staging deployment, production deployment (canary progression), smoke test results
- **Release Artifacts**: Pull request URL, GitHub release URL, release report, audit log
- **Rollback Results**: (If triggered) Traffic reversion, post-rollback smoke tests, health validation

## Usage

```
/ensemble:release
```
