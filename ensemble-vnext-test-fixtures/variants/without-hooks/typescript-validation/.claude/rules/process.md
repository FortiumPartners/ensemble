# Development Process

> Generated: 2026-01-14
> Project: validation-module

## Workflow Commands

| Command | Purpose |
|---------|---------|
| `/create-prd` | Create Product Requirements Document |
| `/refine-prd` | Iterate on existing PRD |
| `/create-trd` | Create Technical Requirements Document from PRD |
| `/refine-trd` | Iterate on existing TRD |
| `/implement-trd` | Execute implementation with staged approach |
| `/update-project` | Capture learnings, update governance |
| `/cleanup-project` | Prune CLAUDE.md and artifacts |
| `/fold-prompt` | Optimize context for continued work |

## Implementation Flow

```
Story/Idea → PRD → TRD → Implementation → Review → Complete
```

### Phase 1: Requirements (PRD)
- Define user needs and acceptance criteria
- Identify constraints and dependencies
- Get stakeholder approval

### Phase 2: Technical Design (TRD)
- Break down into implementable tasks
- Define architecture and approach
- Identify risks and mitigations

### Phase 3: Implementation
- Follow TDD methodology
- Work through tasks in dependency order
- Run tests after each change

### Phase 4: Review
- Code review with security focus
- Verify coverage targets met
- Check documentation completeness

## Quality Gates

### Before Merge

- [ ] All tests passing
- [ ] Coverage targets met (60% unit, 50% integration)
- [ ] No TypeScript errors
- [ ] Code formatted
- [ ] Documentation updated

### Coverage Targets

| Metric | Target |
|--------|--------|
| Unit Test Coverage | 60% |
| Integration Test Coverage | 50% |

## Git Workflow

- Feature branches from main
- Descriptive commit messages
- Squash merge to main
- Delete branch after merge

---

## Notes

- Always check for existing PRD/TRD before creating new ones
- Use `/fold-prompt` when context gets large
- Capture learnings with `/update-project` at session end
