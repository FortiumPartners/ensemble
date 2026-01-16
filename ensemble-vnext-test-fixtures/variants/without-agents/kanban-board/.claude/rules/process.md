# Kanban Task Board Development Process

Workflow expectations and process documentation for AI-augmented development.

---

## Workflow Overview

```
/init-project          --> Initialize project structure (once per project)
/create-prd            --> Product Requirements Document
/refine-prd            --> (optional) Iterate on PRD with feedback
/create-trd            --> Technical Requirements Document
/refine-trd            --> (optional) Iterate on TRD with feedback
/implement-trd         --> Execute implementation tasks
/fold-prompt           --> Optimize context for continued work
```

---

## Command Reference

### /create-prd

**Purpose**: Generate a Product Requirements Document from a story or feature idea.

**Usage**:
```
/create-prd <story description or issue reference>
```

**Output**: `docs/PRD/<issue-id>.md`

**Process**:
1. Analyzes the story or feature request
2. Delegates to `product-manager` subagent with ultrathink
3. Generates comprehensive PRD with user stories, acceptance criteria
4. Updates `.trd-state/current.json` with new PRD path

### /refine-prd

**Purpose**: Iterate on an existing PRD with user feedback.

**Usage**:
```
/refine-prd <path-to-prd> <feedback>
```
or
```
/refine-prd <feedback>  # Uses current.prd from .trd-state/current.json
```

**Process**:
1. Loads existing PRD
2. Incorporates user feedback
3. Updates PRD preserving structure
4. Tracks revision in artifact header

### /create-trd

**Purpose**: Generate a Technical Requirements Document with integrated execution plan.

**Usage**:
```
/create-trd <path-to-prd>
```
or
```
/create-trd  # Uses current.prd from .trd-state/current.json
```

**Output**: `docs/TRD/<issue-id>.md`

**Process**:
1. Analyzes PRD requirements
2. Delegates to `technical-architect` subagent with ultrathink
3. Generates TRD with:
   - Technical specifications
   - Master task list (TRD-XXX format)
   - Execution plan with phases and work sessions
   - Quality requirements
4. Updates `.trd-state/current.json` with new TRD path

### /refine-trd

**Purpose**: Iterate on an existing TRD with technical feedback.

**Usage**:
```
/refine-trd <path-to-trd> <feedback>
```
or
```
/refine-trd <feedback>  # Uses current.trd from .trd-state/current.json
```

### /implement-trd

**Purpose**: Execute the staged implementation loop.

**Usage**:
```
/implement-trd [path-to-trd] [options]
```

**Options**:
| Option | Description |
|--------|-------------|
| `--phase N` | Execute only phase N |
| `--session <name>` | Execute only named work session |
| `--wiggum` | Enable autonomous mode |
| `--resume` | Resume from last checkpoint |
| `--continue` | Alias for `--resume` |

**Staged Execution Loop**:
```
IMPLEMENT --> VERIFY --> [DEBUG if fail] --> SIMPLIFY --> VERIFY --> REVIEW --> UPDATE --> COMPLETE
```

**Process**:
1. Parses TRD for tasks and phases
2. For each task:
   - Delegates to appropriate implementer (frontend/backend/mobile)
   - Runs `verify-app` for testing
   - On failure: `app-debugger` investigates (max 3 retries)
   - `code-simplifier` for post-verification refactoring
   - `code-reviewer` for security/quality review
3. Updates `.trd-state/<feature>/implement.json`
4. Commits at checkpoints

### /update-project

**Purpose**: Manual learning capture with Constitution updates.

**Usage**:
```
/update-project
```

**Process**:
1. Analyzes current session for learnings
2. Auto-updates CLAUDE.md
3. Proposes Constitution changes (requires confirmation)
4. Proposes stack.md updates (requires confirmation)
5. Regenerates router-rules if stack changes

### /cleanup-project

**Purpose**: Review and prune CLAUDE.md and project artifacts.

**Usage**:
```
/cleanup-project [--dry-run] [--auto]
```

---

## Artifact Flow

```
Story/Idea
    |
    v
/create-prd --> docs/PRD/<feature>.md
    |
    v (optional: /refine-prd)
    |
    v
/create-trd --> docs/TRD/<feature>.md
    |
    v (optional: /refine-trd)
    |
    v
/implement-trd --> Implementation + .trd-state/<feature>/implement.json
    |
    v
Completion (tests pass, review approved)
    |
    v
docs/TRD/completed/<feature>.md (archived)
```

---

## State Management

### Current Feature Pointer

File: `.trd-state/current.json`

```json
{
  "prd": "docs/PRD/<feature>.md",
  "trd": "docs/TRD/<feature>.md",
  "status": ".trd-state/<feature>/implement.json",
  "branch": "<issue-id>-<session>"
}
```

This enables commands to work without explicit path arguments.

### Implementation Status

File: `.trd-state/<feature>/implement.json`

Tracks:
- Task status (pending, in_progress, success, failed)
- Cycle position (implement, verify, simplify, review, complete)
- Checkpoints
- Coverage metrics
- Recovery information

---

## Branch Naming

| Scenario | Pattern | Example |
|----------|---------|---------|
| With issue ID | `<issue-id>-<session>` | `VFM-1234-phase1` |
| Without issue ID | `feature/<trd-name>/<session>` | `feature/user-auth/api` |
| Hotfix | `hotfix/<issue-id>` | `hotfix/VFM-1235` |

---

## Quality Gates

Before completing any implementation task:

- [ ] Tests pass (unit >= 80%, integration >= 70%)
- [ ] No secrets in code
- [ ] Input validation present
- [ ] Documentation updated

---

## Subagent Delegation

Commands delegate to these 12 streamlined subagents:

| Category | Agent | When Used |
|----------|-------|-----------|
| Artifact | `product-manager` | /create-prd, /refine-prd |
| Artifact | `technical-architect` | /create-trd, /refine-trd |
| Planning | `spec-planner` | Execution planning |
| Implement | `frontend-implementer` | UI/component tasks |
| Implement | `backend-implementer` | API/service tasks |
| Implement | `mobile-implementer` | Mobile app tasks |
| Quality | `verify-app` | Test execution |
| Quality | `code-simplifier` | Post-verify refactoring |
| Quality | `code-reviewer` | Security/quality review |
| Quality | `app-debugger` | Debug failures |
| DevOps | `devops-engineer` | Infrastructure |
| DevOps | `cicd-specialist` | CI/CD pipelines |

---

## Best Practices

1. **Always check for existing PRD/TRD** before creating new ones
2. **Use current.json** - avoid specifying paths when current feature is set
3. **Review before approve** - examine proposed Constitution/stack changes
4. **Commit at checkpoints** - don't lose progress
5. **Use --wiggum carefully** - autonomous mode is powerful but resource-intensive

---

*This process document is maintained by the user.*
*Generated by /init-project on 2026-01-15*
