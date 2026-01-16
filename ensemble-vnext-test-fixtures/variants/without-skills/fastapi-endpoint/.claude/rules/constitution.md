# Project Constitution - todo-list-api

> Generated: 2026-01-14

## Project Identity

**Name:** todo-list-api
**Description:** A REST API for managing todo items with full CRUD operations using FastAPI and Pydantic validation.

## Development Philosophy

### Methodology: Test-Driven Development (TDD)

This project follows strict TDD practices:

1. **RED** - Write a failing test first
2. **GREEN** - Write minimal code to make the test pass
3. **REFACTOR** - Improve code while keeping tests green

**No production code may be written without a corresponding failing test.**

### Quality Gates

| Metric | Target |
|--------|--------|
| Unit Test Coverage | 80% minimum |
| Integration Test Coverage | 70% minimum |
| Type Coverage | 100% (Pydantic enforced) |

### Code Quality Standards

- All code must pass `ruff check` with no errors
- All code must be formatted with `ruff format`
- Type hints required for all function signatures
- Docstrings required for all public functions

## Approval Requirements

The following changes require explicit approval before implementation:

- [ ] Architecture changes
- [ ] New dependencies
- [ ] Breaking API changes

## Boundaries

### In Scope
- Todo item CRUD operations
- Request/response validation
- Error handling
- Unit and integration tests

### Out of Scope (without explicit approval)
- Authentication/authorization
- Database persistence (in-memory by default)
- Frontend implementation
- Deployment configuration

## Definition of Done

A feature is complete when:

1. All acceptance criteria from PRD are met
2. Unit tests pass with 80%+ coverage
3. Integration tests pass with 70%+ coverage
4. Code passes all quality gates
5. API documentation is current (OpenAPI)
6. Code review completed
