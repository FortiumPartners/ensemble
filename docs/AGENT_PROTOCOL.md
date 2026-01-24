# Agent Communication Protocol

> Comprehensive guide to agent mesh coordination, delegation patterns, and handoff procedures

## Overview

The Ensemble agent mesh consists of 28 specialized agents organized in a hierarchical structure. This document defines the protocols for agent communication, task delegation, and result handling.

## Agent Hierarchy

```
                    ensemble-orchestrator
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
   tech-lead         product-mgmt      infrastructure
   orchestrator      orchestrator       orchestrator
        │                  │                  │
   ┌────┴────┐            │            ┌─────┴─────┐
   │         │            │            │           │
developers  quality    analysts    deployment  build
```

## Delegation Protocol

### 1. Task Initiation

When an orchestrator receives a task, it follows this decision tree:

```
1. Can I handle this directly?
   ├── YES → Execute and return results
   └── NO → Identify appropriate specialist
            ├── Single specialist → Delegate directly
            └── Multiple specialists → Coordinate parallel work
```

### 2. Delegation Syntax

Agents delegate using the Task tool with explicit parameters:

```javascript
Task({
  subagent_type: "backend-developer",
  prompt: `
    ## Context
    [Relevant background information]

    ## Task
    [Specific work to be done]

    ## Files
    - src/api/endpoints.ts
    - src/models/user.ts

    ## Constraints
    - Use existing patterns
    - Maintain test coverage

    ## Expected Output
    [What to return]
  `
})
```

### 3. Context Requirements

Every delegation MUST include:

| Element | Required | Description |
|---------|----------|-------------|
| Context | Yes | Why this task exists |
| Task | Yes | Specific work to perform |
| Files | Recommended | Relevant file paths |
| Constraints | Recommended | Limitations or requirements |
| Expected Output | Yes | What to return |

## Agent Responsibilities

### Orchestrators (Decision Makers)

| Agent | Primary Responsibility | Delegates To |
|-------|----------------------|--------------|
| ensemble-orchestrator | Task decomposition, routing | All orchestrators |
| tech-lead-orchestrator | Architecture, code quality | Developers, reviewers |
| product-management-orchestrator | Requirements, prioritization | Analysts |
| qa-orchestrator | Quality gates, test strategy | Testers, reviewers |
| infrastructure-orchestrator | Deployment, infrastructure | DevOps agents |

### Developers (Implementers)

| Agent | Expertise | Frameworks |
|-------|-----------|------------|
| backend-developer | Server-side logic | NestJS, Rails, Phoenix, .NET |
| frontend-developer | UI components | React, Vue, Angular, Svelte, Blazor |
| infrastructure-developer | Cloud automation | AWS, GCP, Azure, K8s |

### Quality Agents (Validators)

| Agent | Focus Area | Triggers |
|-------|------------|----------|
| code-reviewer | Security, patterns | PR reviews, code changes |
| test-runner | Test execution | Test failures, new tests |
| deep-debugger | Root cause analysis | Complex bugs |
| playwright-tester | E2E testing | UI changes, flows |

### Specialists (Domain Experts)

| Agent | Domain | Use When |
|-------|--------|----------|
| postgresql-specialist | Database | Schema, queries, optimization |
| git-workflow | Version control | Commits, branches, releases |
| github-specialist | GitHub | PRs, issues, actions |
| helm-chart-specialist | Kubernetes | Helm charts, deployments |
| documentation-specialist | Docs | README, guides, API docs |
| api-documentation-specialist | OpenAPI | Swagger, API specs |

## Handoff Patterns

### Pattern 1: Simple Delegation

```
Orchestrator → Specialist → Orchestrator
     │              │            │
  Delegate      Execute       Return
```

Example:
```javascript
// tech-lead-orchestrator delegates to backend-developer
Task({
  subagent_type: "backend-developer",
  prompt: "Implement GET /api/users endpoint following REST conventions"
})
// backend-developer returns implementation
// tech-lead-orchestrator continues with next step
```

### Pattern 2: Parallel Execution

```
Orchestrator ──┬── Specialist A ──┐
               │                  │
               └── Specialist B ──┴── Orchestrator
```

Example:
```javascript
// Launch both in parallel
Task({
  subagent_type: "backend-developer",
  prompt: "Implement API endpoint",
  run_in_background: true
})
Task({
  subagent_type: "frontend-developer",
  prompt: "Implement UI component",
  run_in_background: true
})
// Collect results and proceed
```

### Pattern 3: Sequential Pipeline

```
Orchestrator → Dev → Reviewer → Tester → Orchestrator
```

Example:
```javascript
// Step 1: Implement
const impl = await Task({ subagent_type: "backend-developer", ... })

// Step 2: Review
const review = await Task({ subagent_type: "code-reviewer", ... })

// Step 3: Test
const test = await Task({ subagent_type: "test-runner", ... })
```

### Pattern 4: Escalation

When a specialist cannot complete a task:

```
Specialist → Orchestrator → Higher Orchestrator
    │             │               │
  Failed       Escalate        Resolve
```

## Error Handling

### Recovery Strategies

| Error Type | Handler | Action |
|------------|---------|--------|
| Missing file | Specialist | Request file path from orchestrator |
| Test failure | test-runner | Triage and report to deep-debugger |
| Build failure | build-orchestrator | Analyze logs, suggest fixes |
| Unclear requirements | Any agent | Escalate to orchestrator |

### Escalation Protocol

1. **Attempt Resolution**: Try 2-3 approaches before escalating
2. **Document Attempts**: Include what was tried
3. **Provide Context**: Full error messages and logs
4. **Suggest Next Steps**: Recommend potential solutions

## Communication Standards

### Result Format

Agents should return structured results:

```markdown
## Summary
[1-2 sentence overview]

## Changes Made
- [List of modifications]

## Files Modified
- `path/to/file.ts` - [description]

## Testing
- [Test results or recommendations]

## Notes
- [Any caveats or follow-up items]
```

### Status Indicators

| Status | Meaning | Action Required |
|--------|---------|-----------------|
| Complete | Task finished successfully | None |
| Partial | Some work done, blockers exist | Review blockers |
| Failed | Could not complete | Investigate cause |
| Escalated | Needs higher authority | Orchestrator review |

## Best Practices

### For Orchestrators

1. **Be Specific**: Provide clear, actionable prompts
2. **Include Context**: Share relevant background
3. **Set Expectations**: Define success criteria
4. **Handle Failures**: Have fallback plans

### For Specialists

1. **Stay Focused**: Complete assigned task only
2. **Ask Early**: Clarify ambiguity before proceeding
3. **Document Changes**: Explain what was done
4. **Report Blockers**: Don't silently fail

### For All Agents

1. **Use Appropriate Tools**: Match tool to task
2. **Preserve Context**: Pass relevant info forward
3. **Follow Conventions**: Use project patterns
4. **Validate Work**: Check before returning

## Examples

### Example 1: Feature Implementation

```
User: "Add user authentication"

ensemble-orchestrator:
  ├── Delegates to tech-lead-orchestrator
  │
tech-lead-orchestrator:
  ├── Analyzes requirements
  ├── Delegates to backend-developer (API)
  ├── Delegates to frontend-developer (UI)
  ├── Waits for completion
  ├── Delegates to code-reviewer
  ├── Delegates to test-runner
  └── Returns to ensemble-orchestrator
```

### Example 2: Bug Fix

```
User: "Fix login timeout issue"

ensemble-orchestrator:
  ├── Delegates to deep-debugger
  │
deep-debugger:
  ├── Investigates root cause
  ├── Identifies fix
  ├── Delegates to backend-developer
  │
backend-developer:
  ├── Implements fix
  └── Returns to deep-debugger
  │
deep-debugger:
  ├── Verifies fix
  └── Returns to ensemble-orchestrator
```

## Related Documentation

- [CLAUDE.md](../CLAUDE.md) - Quick reference and configuration
- [CONTRIBUTING.md](../CONTRIBUTING.md) - Development guidelines
- [docs/COMPONENT_INVENTORY.md](COMPONENT_INVENTORY.md) - Full agent catalog
