# Ensemble Agent Mesh

> Extracted from CLAUDE.md — relevant sections for Pi agent runtime.

## Architecture Overview

```
Tier 1: Core Foundation
└── ensemble-core (orchestration, framework detection, XDG config)

Tier 2: Workflow Plugins (7)
├── product (PRD/TRD creation)
├── development (frontend/backend orchestration)
├── quality (code review, testing, DoD)
├── infrastructure (AWS, K8s, Docker, Helm, Fly.io)
├── git (workflow, conventional commits)
├── e2e-testing (Playwright)
└── metrics (productivity analytics)

Tier 3: Framework Skills (5)
├── react, nestjs, rails, phoenix, blazor

Tier 4: Testing Frameworks (5)
├── jest, pytest, rspec, xunit, exunit

New Capabilities (v5.1.0):
├── ai (AI services integration)
├── router (agent routing and delegation)
└── permitter (permission management with allowlists)

Shared: multiplexer-adapters (WezTerm, Zellij, tmux)
Runtime: opencode (OpenCode translation layer, v5.3.0)
Meta: ensemble-full (complete bundle)
```

## Agent Mesh (28 Specialized Agents)

### Orchestrators
- `ensemble-orchestrator` - Chief orchestrator, task decomposition
- `tech-lead-orchestrator` - Technical leadership, architecture
- `product-management-orchestrator` - Product lifecycle coordination
- `qa-orchestrator` - Quality assurance orchestration
- `infrastructure-orchestrator` - Infrastructure coordination

### Developers
- `frontend-developer` - React, Vue, Angular, Svelte
- `backend-developer` - Server-side across languages
- `infrastructure-developer` - Cloud-agnostic automation

### Quality & Testing
- `code-reviewer` - Security-enhanced code review
- `test-runner` - Test execution and triage
- `deep-debugger` - Systematic bug analysis
- `playwright-tester` - E2E testing

### Specialists
- `git-workflow` - Conventional commits, semantic versioning
- `github-specialist` - PR, branch management
- `documentation-specialist` - Technical documentation
- `api-documentation-specialist` - OpenAPI/Swagger
- `postgresql-specialist` - Database administration
- `helm-chart-specialist` - Kubernetes Helm charts

### Utilities
- `general-purpose` - Research and analysis
- `file-creator` - Template-based scaffolding
- `context-fetcher` - Documentation retrieval
- `directory-monitor` - File system surveillance
- `agent-meta-engineer` - Agent ecosystem management
- `release-agent` - Automated release orchestration

## Agent Delegation Protocol

### Handoff Pattern
Agents delegate work using the Task tool with explicit agent types:
```
Task(subagent_type="backend-developer", prompt="Implement API endpoint...")
Task(subagent_type="code-reviewer", prompt="Review changes in src/...")
```

### Delegation Hierarchy
```
ensemble-orchestrator (chief)
├── tech-lead-orchestrator (architecture decisions)
│   ├── backend-developer, frontend-developer
│   └── infrastructure-developer
├── product-management-orchestrator (requirements)
├── qa-orchestrator (quality gates)
│   ├── code-reviewer, test-runner
│   └── playwright-tester
└── infrastructure-orchestrator (deployment)
    └── deployment-orchestrator, build-orchestrator
```

### Handoff Best Practices
1. **Clear Context**: Include relevant file paths and requirements
2. **Scoped Tasks**: One responsibility per delegation
3. **Return Path**: Agents report results back to orchestrator
4. **Error Escalation**: Unresolved issues escalate up the hierarchy

### Agent Selection Guide
| Task Type | Primary Agent | Backup |
|-----------|---------------|--------|
| API implementation | backend-developer | tech-lead-orchestrator |
| UI components | frontend-developer | tech-lead-orchestrator |
| Code quality | code-reviewer | qa-orchestrator |
| Test failures | test-runner | deep-debugger |
| Database changes | postgresql-specialist | backend-developer |
| CI/CD issues | build-orchestrator | infrastructure-developer |
| Release process | release-agent | git-workflow |
