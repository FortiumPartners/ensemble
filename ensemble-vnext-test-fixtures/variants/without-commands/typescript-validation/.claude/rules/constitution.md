# Project Constitution

> Generated: 2026-01-14
> Project: validation-module

## Project Identity

**validation-module** - A validation module with functions for email validation, password strength checking, and phone number formatting. Exports TypeScript types for validation results.

## Development Methodology

**TDD (Test-Driven Development)**

All new functionality follows the RED-GREEN-REFACTOR cycle:
1. **RED**: Write a failing test first
2. **GREEN**: Write minimal code to pass the test
3. **REFACTOR**: Clean up while keeping tests green

## Quality Gates

### Coverage Targets

| Type | Target |
|------|--------|
| Unit Tests | 60% |
| Integration Tests | 50% |

### Required Checks

- All tests must pass before merge
- No TypeScript compilation errors
- ESLint rules must pass
- Code must be formatted with Prettier

## Approval Requirements

The following changes require explicit user approval:
- Architecture changes
- New dependencies
- Breaking API changes
- Security-sensitive code

## Code Standards

### TypeScript

- Use strict mode
- Explicit return types on exported functions
- Prefer interfaces over type aliases for object shapes
- Use const assertions where appropriate

### Validation Functions

- Return structured results with success/failure status
- Include descriptive error messages
- Support both synchronous and async patterns where appropriate

## Documentation

- JSDoc comments on all exported functions
- Type definitions for all public APIs
- README with usage examples

---

## Amendments

*This constitution can be amended via `/update-project` command.*
