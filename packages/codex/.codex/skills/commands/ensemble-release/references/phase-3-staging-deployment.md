### Phase 3: Staging Deployment

#### Step 3.1: Deploy to Staging

Deploy release to staging environment

- Execute blue-green or rolling deployment
- Verify health checks
- Route traffic to new version

**Delegation:** @deployment-orchestrator
Release version, staging environment, deployment strategy

#### Step 3.2: Post-Staging Smoke Tests

Verify staging deployment with smoke tests (use the smoke-test-runner skill)

- Execute full 5-category smoke test suite
- Use staging-specific configuration
- Proceed only when the runner verdict is passed (every required category executed and passed)
- Block on a failed or incomplete verdict (a required category NOT CONFIGURED is a block, not a pass)
