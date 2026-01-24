# Agent Skill Integration Guide - Git-Town Skill

## Introduction

This guide demonstrates how agents within the Ensemble ecosystem can integrate and leverage the git-town skill. The git-town skill provides comprehensive Git workflow automation using Git Town's convention-over-configuration approach. Agent developers will learn how to reference skill documentation, query specific sections, and incorporate git-town capabilities into their agent definitions. This guide covers both automatic skill loading via YAML frontmatter and explicit documentation references in mission statements, with practical examples for common integration patterns.

Target audience: Agent developers building orchestrators, workflow agents, and specialized tools that require Git branch management, release workflows, or conventional commit patterns.

## Agent Skill Reference Patterns

### Pattern 1: YAML Frontmatter Automatic Loading

The YAML frontmatter in agent definitions supports automatic skill loading through the `skills` field. This pattern loads the complete skill documentation into the agent's context at initialization:

```yaml
---
name: git-workflow
description: Git workflow orchestration with conventional commits and semantic versioning
tools: [Read, Write, Edit, Bash, Grep, Glob, Task]
skills:
  - git-town
---
## Mission
Orchestrate Git workflows using Git Town conventions for branch management,
feature development, and release processes.

## Behavior
Execute Git Town commands with confidence. The git-town skill provides
complete reference documentation for all commands, configuration, and
error handling patterns.
```

**When to use**:
- Agent's primary responsibility involves Git workflow management
- Agent needs access to multiple git-town commands across different workflows
- Agent requires comprehensive error handling knowledge
- Full skill context justifies memory footprint (typically 50-100KB)

**Advantages**:
- Single declaration loads all skill documentation
- Agent has complete reference for all git-town capabilities
- Automatic updates when skill documentation changes
- No need for explicit documentation queries

**Disadvantages**:
- Larger initial context window consumption
- May include unused documentation sections
- Less granular control over loaded content

### Pattern 2: Mission Statement Documentation Reference

For agents requiring specific git-town capabilities, explicitly reference skill sections in the mission statement. This pattern uses natural language to guide the agent toward specific documentation queries:

```yaml
---
name: feature-branch-agent
description: Manage feature branch lifecycle
tools: [Read, Write, Edit, Bash, Task]
---
## Mission
Manage feature branch creation, syncing, and merging using Git Town.

Reference the git-town skill for:
- Branch creation commands (git-town:SKILL:branch-management)
- Sync and update workflows (git-town:SKILL:sync-workflows)
- Error recovery procedures (git-town:ERROR_HANDLING:branch-conflicts)

Query skill documentation as needed for specific operations.
```

**When to use**:
- Agent has focused, narrow Git workflow responsibilities
- Specific git-town features needed (e.g., only branch creation)
- Memory efficiency is priority
- Agent already has complex mission requiring context optimization

**Advantages**:
- Minimal initial context consumption
- Explicit documentation of which skill sections are relevant
- Agent queries only needed sections during execution
- Better for specialized agents with narrow scope

**Disadvantages**:
- Requires agent to query skill documentation during execution
- Additional tool calls for documentation retrieval
- Potential latency for documentation queries

### Choosing the Right Pattern

| Criterion | Frontmatter Loading | Mission Reference |
|-----------|---------------------|-------------------|
| Agent scope | Broad Git workflow responsibilities | Focused, specific Git tasks |
| Memory budget | Large context window available | Tight context constraints |
| Execution pattern | Frequent diverse Git operations | Occasional targeted operations |
| Skill coverage | Multiple workflows, error handling | Specific commands or sections |

## Skill Query Syntax

### Query Format

The git-town skill uses a three-part query syntax for precise documentation retrieval:

```
<skill-name>:<file-type>:<section-name>
```

Components:
- **skill-name**: `git-town` (fixed)
- **file-type**: `SKILL`, `REFERENCE`, `ERROR_HANDLING`, or `TEMPLATES`
- **section-name**: Target section within the file (optional for full file load)

### SKILL File Queries

The `SKILL.md` file contains primary Git Town workflow documentation:

```
# Load entire skill file (all workflows and patterns)
git-town:SKILL

# Load specific workflow sections
git-town:SKILL:branch-management
git-town:SKILL:feature-development
git-town:SKILL:release-workflows
git-town:SKILL:sync-workflows
git-town:SKILL:configuration
```

**Example usage in agent code**:
```yaml
When creating feature branches, query git-town:SKILL:branch-management
for complete branch creation workflows including naming conventions,
parent branch selection, and initial commit patterns.
```

### REFERENCE File Queries

The `REFERENCE.md` file provides command-line reference documentation:

```
# Load entire reference (all commands, flags, examples)
git-town:REFERENCE

# Load specific command sections
git-town:REFERENCE:git-town-hack
git-town:REFERENCE:git-town-sync
git-town:REFERENCE:git-town-ship
git-town:REFERENCE:git-town-propose
git-town:REFERENCE:configuration-commands
```

**Example usage in agent code**:
```yaml
Before executing git town hack, query git-town:REFERENCE:git-town-hack
for complete command syntax, flag options, and usage examples.
```

### ERROR_HANDLING File Queries

The `ERROR_HANDLING.md` file contains troubleshooting and recovery procedures:

```
# Load entire error handling guide
git-town:ERROR_HANDLING

# Load specific error scenarios
git-town:ERROR_HANDLING:merge-conflicts
git-town:ERROR_HANDLING:branch-conflicts
git-town:ERROR_HANDLING:configuration-errors
git-town:ERROR_HANDLING:sync-failures
git-town:ERROR_HANDLING:recovery-procedures
```

**Example usage in agent code**:
```yaml
When git town sync fails with conflicts, query
git-town:ERROR_HANDLING:merge-conflicts for step-by-step
resolution procedures and abort/continue patterns.
```

### Template Loading

Templates provide scaffolding for common workflows:

```
# Load specific workflow templates
git-town:TEMPLATES:feature-workflow
git-town:TEMPLATES:release-workflow
git-town:TEMPLATES:hotfix-workflow
```

**Example usage in agent code**:
```yaml
To generate a complete feature development checklist, query
git-town:TEMPLATES:feature-workflow for the step-by-step template.
```

## Complete Agent Examples

### Example 1: Git-Workflow Agent Using Full Skill Loading

This comprehensive agent manages all Git workflow aspects and benefits from full skill loading:

```yaml
---
name: git-workflow
description: |
  Git workflow orchestration with conventional commits, semantic versioning,
  and Git Town branch management. Handles feature development, releases,
  hotfixes, and repository maintenance.
tools: [Read, Write, Edit, Bash, Grep, Glob, Task]
skills:
  - git-town
---
## Mission

Orchestrate Git workflows using Git Town conventions for branch management,
feature development, and release processes. Execute conventional commits,
maintain semantic versioning, and coordinate multi-branch workflows.

Core responsibilities:
- Feature branch lifecycle (hack, sync, ship)
- Release workflows (version bumping, tagging, changelog generation)
- Hotfix workflows (expedited fixes from main)
- Branch synchronization and conflict resolution
- Repository configuration and maintenance

The git-town skill provides complete reference documentation for all
workflows, commands, configuration, and error handling patterns.

## Behavior

### Branch Management

Create feature branches:
```bash
git town hack feature-name
# Creates branch, pushes to origin, sets tracking
```

Sync with parent branches:
```bash
git town sync
# Pulls main, merges into feature, resolves conflicts
```

Ship completed features:
```bash
git town ship
# Squash-merges to main, deletes branch, updates tracking
```

### Release Workflows

Execute semantic versioning:
```bash
# Determine version bump (major.minor.patch)
git town ship --version=minor
# Updates package.json, creates tag, generates changelog
```

### Error Recovery

When conflicts occur during sync:
1. Query git-town:ERROR_HANDLING:merge-conflicts for resolution steps
2. Resolve conflicts in affected files
3. Continue sync: `git town continue`
4. If unrecoverable, abort: `git town abort`

### Configuration

Initialize Git Town on new repositories:
```bash
git town config setup
# Interactive wizard for main branch, perennial branches, etc.
```

### Delegation

Delegate specialized tasks:
- Conventional commit formatting: Task(subagent_type="git-workflow", prompt="Format commit message...")
- Code review before ship: Task(subagent_type="code-reviewer", prompt="Review changes before shipping...")
- Release notes generation: Task(subagent_type="documentation-specialist", prompt="Generate changelog...")

## Integration

### Receives Work From
- **ensemble-orchestrator**: High-level workflow coordination
- **tech-lead-orchestrator**: Architecture-driven branching strategies
- **release-agent**: Automated release orchestration

### Hands Off To
- **code-reviewer**: Pre-merge code quality checks
- **test-runner**: Validation before shipping branches
- **documentation-specialist**: Changelog and release note generation
```

**Key features**:
- Full skill loaded via `skills: [git-town]` frontmatter
- Mission statement references skill availability
- Behavior section demonstrates workflow patterns from skill
- Error recovery references skill documentation
- Integration protocols define delegation boundaries

### Example 2: Implement-TRD Agent Using Specific Sections

This focused agent implements TRD specifications and only needs targeted git-town capabilities:

```yaml
---
name: implement-trd
description: |
  Implement Technical Requirements Documents using git-town branch
  workflows and conventional commits.
tools: [Read, Write, Edit, Bash, Task]
---
## Mission

Implement TRD specifications by creating feature branches, implementing
code changes, and shipping completed work using Git Town workflows.

Reference the git-town skill for:
- Branch creation: git-town:SKILL:branch-management
- Feature workflow: git-town:TEMPLATES:feature-workflow
- Shipping features: git-town:REFERENCE:git-town-ship
- Sync conflicts: git-town:ERROR_HANDLING:merge-conflicts

Query skill documentation as needed during implementation phases.

## Behavior

### Phase 1: Branch Creation

Before starting implementation, query git-town:SKILL:branch-management:

```bash
# Example from skill query result
git town hack implement-trd-auth-api
```

### Phase 2: Implementation

Implement TRD specifications:
1. Read TRD from docs/TRD/<trd-name>.md
2. Create implementation plan (files, tests, documentation)
3. Delegate to specialized developers:
   - Task(subagent_type="backend-developer", prompt="Implement API endpoints...")
   - Task(subagent_type="frontend-developer", prompt="Create UI components...")
4. Sync branch periodically: `git town sync`

### Phase 3: Quality Gates

Before shipping, validate:
- Tests pass (delegate to test-runner)
- Code review complete (delegate to code-reviewer)
- Documentation updated (delegate to documentation-specialist)

### Phase 4: Shipping

Query git-town:REFERENCE:git-town-ship for shipping options:

```bash
# Ship with squash merge
git town ship

# Ship with explicit message
git town ship -m "feat(auth): implement JWT authentication API"
```

### Error Handling

If sync fails during implementation:
1. Query git-town:ERROR_HANDLING:merge-conflicts
2. Identify conflicted files: `git status`
3. Resolve conflicts or escalate to tech-lead-orchestrator
4. Continue or abort based on resolution success

## Integration

### Receives Work From
- **tech-lead-orchestrator**: TRD implementation assignments
- **product-management-orchestrator**: Feature implementation requests

### Hands Off To
- **backend-developer**: Server-side implementation
- **frontend-developer**: Client-side implementation
- **code-reviewer**: Pre-ship quality validation
- **test-runner**: Test execution and validation
```

**Key features**:
- No frontmatter skill loading (conserves context)
- Mission explicitly documents which sections to query
- Behavior shows query patterns for each phase
- Targeted skill queries match specific workflow steps
- Lean context footprint for focused mission

### Example 3: Error Recovery Agent Querying ERROR_HANDLING

This specialized agent focuses exclusively on Git workflow error recovery:

```yaml
---
name: git-error-recovery
description: |
  Diagnose and resolve Git Town workflow errors, conflicts, and
  configuration issues.
tools: [Read, Bash, Task]
---
## Mission

Diagnose and resolve Git Town errors including merge conflicts, sync
failures, configuration errors, and branch conflicts.

Reference the git-town skill for:
- Merge conflicts: git-town:ERROR_HANDLING:merge-conflicts
- Sync failures: git-town:ERROR_HANDLING:sync-failures
- Branch conflicts: git-town:ERROR_HANDLING:branch-conflicts
- Configuration errors: git-town:ERROR_HANDLING:configuration-errors
- Recovery procedures: git-town:ERROR_HANDLING:recovery-procedures

Query error-specific sections based on failure symptoms.

## Behavior

### Error Diagnosis

When receiving error reports:
1. Identify error category (merge, sync, config, branch)
2. Query relevant ERROR_HANDLING section
3. Follow diagnostic procedures from skill documentation

### Common Error Patterns

**Merge Conflicts During Sync**:
```bash
# Query: git-town:ERROR_HANDLING:merge-conflicts
git status                    # Identify conflicted files
# Resolve conflicts manually or with merge tools
git add <resolved-files>
git town continue            # Resume sync workflow
```

**Sync Failures**:
```bash
# Query: git-town:ERROR_HANDLING:sync-failures
git town sync --verbose      # Detailed sync output
# If unrecoverable:
git town abort              # Rollback to pre-sync state
```

**Configuration Errors**:
```bash
# Query: git-town:ERROR_HANDLING:configuration-errors
git town config             # View current configuration
git town config setup       # Re-run configuration wizard
```

**Branch Conflicts**:
```bash
# Query: git-town:ERROR_HANDLING:branch-conflicts
git branch -vv              # View branch tracking
git town config main-branch # Verify main branch configuration
```

### Recovery Procedures

Follow skill-documented recovery patterns:
1. Query git-town:ERROR_HANDLING:recovery-procedures
2. Attempt automated recovery (continue/abort commands)
3. If manual intervention required, escalate to git-workflow agent
4. Document resolution for future reference

### Escalation Criteria

Escalate to git-workflow or tech-lead-orchestrator when:
- Conflicts span multiple interdependent branches
- Configuration changes affect team workflows
- Recovery requires repository structure changes
- Error indicates deeper architectural issues

## Integration

### Receives Work From
- **git-workflow**: Delegated error recovery
- **implement-trd**: Sync/merge conflict resolution
- **release-agent**: Release workflow error recovery

### Hands Off To
- **tech-lead-orchestrator**: Architectural conflict resolution
- **git-workflow**: Workflow reconfiguration
```

**Key features**:
- Focused exclusively on ERROR_HANDLING sections
- Mission maps error types to skill queries
- Behavior demonstrates query-driven diagnostics
- Escalation criteria prevent scope creep
- Minimal context usage (only error documentation)

## Performance Considerations

### Full Load vs Section Queries

**Full Skill Loading** (frontmatter `skills: [git-town]`):
- **Size**: Approximately 50-100KB (all SKILL, REFERENCE, ERROR_HANDLING files)
- **Load time**: Single initialization, no runtime queries
- **Memory footprint**: Persists in agent context throughout session
- **Best for**: Orchestrators, workflow agents with broad Git responsibilities

**Section Queries** (runtime documentation retrieval):
- **Size**: 5-20KB per section query
- **Load time**: Additional tool calls during execution (~100-500ms per query)
- **Memory footprint**: Temporary, released after query completion
- **Best for**: Specialized agents with narrow, focused Git operations

### Caching Strategies

Claude Code implements skill documentation caching:
- First query loads and caches skill file
- Subsequent queries to same file hit cache
- Cache invalidated on skill version updates
- Section queries only transfer relevant subsections

**Optimization tip**: Group related operations to maximize cache hits:
```yaml
# Efficient: Single session, multiple queries to same file
1. Query git-town:SKILL:branch-management
2. Execute branch creation
3. Query git-town:SKILL:sync-workflows (cache hit)
4. Execute sync workflow

# Less efficient: Scattered queries across sessions
Session 1: Query git-town:SKILL:branch-management
Session 2: Query git-town:SKILL:branch-management (cache miss, reload)
```

### Memory Footprint Comparison

| Pattern | Initial Load | Runtime Queries | Total Memory |
|---------|--------------|-----------------|--------------|
| Full skill load | 80KB | 0KB | 80KB |
| 3 section queries | 0KB | 45KB (15KB × 3) | 45KB |
| 6+ section queries | 0KB | 90KB+ | 90KB+ |

**Rule of thumb**: Use full skill loading if agent will query 5+ sections during typical execution. Below that threshold, section queries are more memory-efficient.

## Best Practices

### When to Load Full Skill vs Sections

**Load full skill when**:
- Agent orchestrates complete Git workflows (feature lifecycle, releases)
- Agent requires error handling across multiple scenarios
- Agent serves as primary Git workflow authority
- Development patterns involve frequent Git operations
- Example agents: git-workflow, release-agent, ensemble-orchestrator

**Query specific sections when**:
- Agent has focused Git responsibilities (only branch creation, only shipping)
- Git operations are occasional, not core responsibility
- Agent already has large context requirements
- Memory optimization is critical
- Example agents: implement-trd, feature-branch-agent, hotfix-agent

### Error Handling Integration

Always include error recovery references:

```yaml
# Good: Explicit error handling reference
---
name: my-agent
skills:
  - git-town
---
When git town commands fail, query git-town:ERROR_HANDLING for recovery
procedures. Follow documented patterns for continue/abort decisions.

# Better: Specific error scenario mapping
When sync fails:    Query git-town:ERROR_HANDLING:merge-conflicts
When ship fails:    Query git-town:ERROR_HANDLING:sync-failures
When config fails:  Query git-town:ERROR_HANDLING:configuration-errors
```

### Testing Skill References

Validate skill integration in agent tests:

```javascript
// Test skill query syntax in mission statement
describe('git-workflow agent', () => {
  it('references git-town skill in mission', () => {
    const mission = readAgentMission('git-workflow');
    expect(mission).toContain('git-town');
  });

  it('documents specific skill sections', () => {
    const mission = readAgentMission('git-workflow');
    expect(mission).toMatch(/git-town:(SKILL|REFERENCE|ERROR_HANDLING)/);
  });
});

// Test skill loading in frontmatter
describe('implement-trd agent', () => {
  it('includes git-town in skills array or mission', () => {
    const agent = parseAgentYAML('implement-trd');
    const hasSkillLoad = agent.frontmatter.skills?.includes('git-town');
    const hasSkillReference = agent.mission.includes('git-town:');
    expect(hasSkillLoad || hasSkillReference).toBe(true);
  });
});
```

### Documentation Maintenance

Keep skill references synchronized:
- Update agent missions when skill section names change
- Regenerate agent markdown after skill updates: `npm run generate`
- Validate skill queries against current skill structure
- Document skill version requirements in agent metadata

---

**Last Updated**: 2025-12-30
**Skill Version**: 5.0.0
**Target Claude Code Version**: 5.0.0+
