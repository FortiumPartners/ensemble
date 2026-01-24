# Project Constitution - Counter Widget

**Generated:** 2026-01-14

## Project Identity

**Name:** Counter Widget
**Description:** A Flutter counter widget with increment and decrement buttons that displays the current value and changes color based on whether it's positive, negative, or zero.

## Development Principles

### 1. Test-Driven Development (TDD)

All new features follow RED-GREEN-REFACTOR:
1. Write a failing test first
2. Write minimal code to pass the test
3. Refactor while keeping tests green

### 2. Quality Gates

| Metric | Target |
|--------|--------|
| Unit Test Coverage | 80% |
| Widget Test Coverage | 70% |
| Integration Test Coverage | As needed |

### 3. Code Standards

- Follow Dart style guide and Flutter best practices
- All public APIs must be documented
- Use `flutter analyze` with zero warnings
- Format code with `dart format`

### 4. Approval Requirements

The following changes require explicit approval:
- Architecture changes
- New dependencies
- Breaking API changes
- Production deployments
- Security-sensitive code

### 5. Widget Design Principles

- Widgets should be composable and reusable
- Prefer stateless widgets where possible
- Keep widget trees shallow and readable
- Use const constructors for performance

## Governance

This constitution guides AI-assisted development. Update via `/update-project` when project needs evolve.
