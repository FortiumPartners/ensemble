---
name: ensemble:release
description: Automated release workflow with quality gates and deployment coordination
---

Automated release workflow orchestration with quality gates, smoke test integration, and deployment coordination.

## Mission

Orchestrate the complete release workflow:
- Quality gates (security, tests, DoD validation)
- Staging deployment with smoke tests
- Production canary deployment
- Automated rollback on failure

## Workflow

1. **Release Initialization**
   - Validate semantic version (X.Y.Z)
   - Create release branch
   - Generate changelog

2. **Quality Gates**
   - Security scan
   - DoD validation
   - Unit tests (≥80% coverage)
   - Integration tests (≥70% coverage)
   - Smoke tests (5 categories)
   - E2E tests

3. **Staging Deployment**
   - Deploy to staging
   - Post-staging smoke tests

4. **Production Deployment**
   - Canary deployment (5% → 25% → 100%)
   - Post-production smoke tests
   - Monitor error rate

5. **Release Completion**
   - Create PR and GitHub release
   - Generate release report
   - Update tickets

## Usage

```
/ensemble:release --version 2.1.0                    # Standard release
/ensemble:release --version 2.1.1 --type hotfix      # Hotfix release
/ensemble:release --version 2.1.0 --rollback         # Manual rollback
/ensemble:release --version 2.1.0 --draft            # Draft release
```

## Arguments

- `--version X.Y.Z` (required): Semantic version
- `--type` (optional): standard, hotfix, rollback (default: standard)
- `--from` (optional): Base branch
- `--to` (optional): Target branch
- `--draft` (optional): Create as draft
- `--rollback` (optional): Trigger rollback

Delegates to `release-agent` for orchestration.
