# Constitution - cli-calculator

> Generated: 2026-01-14

## Project Identity

**Name:** cli-calculator
**Description:** A Python CLI calculator using argparse that supports addition, subtraction, multiplication, and division with helpful error messages and pytest tests.

## Development Methodology

**Approach:** Test-Driven Development (TDD)

All new functionality MUST follow the TDD cycle:
1. **RED** - Write a failing test first
2. **GREEN** - Write minimal code to pass the test
3. **REFACTOR** - Improve code while keeping tests green

## Quality Gates

### Test Coverage Requirements

| Type | Minimum Coverage |
|------|------------------|
| Unit Tests | 60% |
| Integration Tests | 50% |

### Code Quality

- All code must pass linting (ruff recommended)
- All tests must pass before merge
- No hardcoded secrets or credentials

## Approval Requirements

The following changes require explicit human approval:

- [ ] Architecture changes
- [ ] New dependencies
- [ ] Database schema changes
- [ ] Breaking API changes
- [ ] Production deployments
- [ ] Security-sensitive code

## Coding Standards

### Python Standards

- Follow PEP 8 style guidelines
- Use type hints for function signatures
- Write docstrings for public functions
- Keep functions focused and small

### Testing Standards

- Each operation must have unit tests
- CLI parsing must have integration tests
- Error cases must be tested
- Use pytest fixtures for reusable test data

## Error Handling

- Provide helpful error messages for invalid input
- Handle division by zero gracefully
- Validate numeric arguments before operations
