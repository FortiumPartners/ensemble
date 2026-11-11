### Phase 6: Rollback (On Failure)

#### Step 6.1: Trigger Rollback

Initiate automated rollback workflow

- Detect failure condition (smoke test, error rate, health check)
- Alert on-call engineer
- Capture rollback trigger context

#### Step 6.2: Revert Traffic

Route traffic to previous version

- Route all traffic to previous version
- Verify previous version health checks
- Capture traffic reversion metrics

**Delegation:** @deployment-orchestrator
Rollback operation, previous version

#### Step 6.3: Post-Rollback Smoke Tests

Verify rollback success with smoke tests (use the smoke-test-runner skill)

- Execute full 5-category smoke test suite
- Verify error rate normalized
- Confirm system stability
- Escalate on smoke test failure

#### Step 6.4: Health Validation

Monitor system health post-rollback

- Monitor error rate (<1% target)
- Verify all health checks passing
- Confirm no degradation
- Escalate on health check failure

#### Step 6.5: Create Git Revert

Create revert commit in git

- Create revert commit
- Tag rollback version (vX.Y.Z-rollback)
- Update changelog with rollback entry

**Delegation:** @git-workflow
Rollback operation, release version

#### Step 6.6: Update Tickets

Document rollback in tickets

- Update ticket status to rolled-back
- Add rollback reason
- Link to rollback artifacts
- Schedule post-mortem
