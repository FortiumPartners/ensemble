# Development Process - todo-list-api

> Generated: 2026-01-14

## Workflow Overview

```
Story/Idea → PRD → TRD → Implementation → Verification → Review → Complete
```

## Phase 1: Requirements (PRD)

**Owner:** Product Manager Agent

1. Capture user needs and acceptance criteria
2. Define scope boundaries clearly
3. Identify dependencies and assumptions
4. Get stakeholder approval

**Artifacts:** `docs/PRD/<feature-name>.md`

## Phase 2: Technical Design (TRD)

**Owner:** Technical Architect Agent

1. Translate PRD to technical tasks
2. Define API contracts and models
3. Create task breakdown with dependencies
4. Estimate complexity (S/M/L/XL)

**Artifacts:** `docs/TRD/<feature-name>.md`

## Phase 3: Implementation

**Owner:** Backend Implementer Agent

### TDD Cycle (Required)

```
1. Write failing test
2. Run test (confirm RED)
3. Write minimal implementation
4. Run test (confirm GREEN)
5. Refactor if needed
6. Run tests (confirm still GREEN)
7. Commit
```

### Implementation Order

1. Pydantic models (request/response)
2. API endpoint skeleton
3. Business logic
4. Error handling
5. Integration tests

## Phase 4: Verification

**Owner:** Verify App Agent

1. Run full test suite: `pytest`
2. Check coverage: `pytest --cov`
3. Verify type hints: `mypy src/`
4. Lint code: `ruff check .`
5. Format code: `ruff format .`

### Coverage Requirements

| Type | Target | Command |
|------|--------|---------|
| Unit | 80% | `pytest tests/unit/ --cov` |
| Integration | 70% | `pytest tests/integration/ --cov` |

## Phase 5: Review

**Owner:** Code Reviewer Agent

1. Security review (OWASP considerations)
2. Code quality assessment
3. Test coverage verification
4. Documentation check

## Phase 6: Completion

1. Update `.trd-state/current.json`
2. Move TRD to `docs/TRD/completed/`
3. Update CLAUDE.md learnings if applicable

## Quick Reference

| Command | Purpose |
|---------|---------|
| `pytest` | Run all tests |
| `pytest --cov` | Run with coverage |
| `ruff check .` | Lint code |
| `ruff format .` | Format code |
| `uvicorn main:app --reload` | Run dev server |

## Git Workflow

1. Create feature branch from main
2. Commit frequently with descriptive messages
3. Ensure tests pass before pushing
4. Create PR for review
