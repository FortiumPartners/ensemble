# Development Process - cli-calculator

> Generated: 2026-01-14

## Workflow

### Feature Development

1. **Requirements** - Create or reference PRD
2. **Design** - Create TRD with implementation tasks
3. **Implement** - Follow TDD cycle per task
4. **Review** - Code review before merge
5. **Deploy** - Follow deployment checklist

### TDD Cycle

```
┌─────────────────────────────────────┐
│           TDD Cycle                 │
│                                     │
│   ┌───────┐                         │
│   │  RED  │ Write failing test      │
│   └───┬───┘                         │
│       │                             │
│       ▼                             │
│   ┌───────┐                         │
│   │ GREEN │ Write minimal code      │
│   └───┬───┘                         │
│       │                             │
│       ▼                             │
│   ┌──────────┐                      │
│   │ REFACTOR │ Improve code         │
│   └──────────┘                      │
│                                     │
└─────────────────────────────────────┘
```

## Coverage Requirements

| Type | Target | Enforcement |
|------|--------|-------------|
| Unit | 60% | CI gate |
| Integration | 50% | CI gate |

## Code Review Checklist

- [ ] Tests pass locally
- [ ] Coverage targets met
- [ ] No linting errors
- [ ] Error handling complete
- [ ] Documentation updated if needed

## Commands Reference

| Command | Purpose |
|---------|---------|
| `pytest` | Run all tests |
| `pytest --cov` | Run tests with coverage |
| `ruff check .` | Check linting |
| `ruff format .` | Auto-format code |
| `python -m calculator` | Run calculator |
