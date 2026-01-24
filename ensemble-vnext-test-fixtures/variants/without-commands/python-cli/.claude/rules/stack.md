# Technology Stack - cli-calculator

> Generated: 2026-01-14

## Primary Platform

Python CLI Application

## Languages

| Language | Purpose |
|----------|---------|
| Python 3.x | Core application logic, CLI interface |

## Frameworks & Libraries

| Framework/Library | Version | Purpose |
|-------------------|---------|---------|
| argparse | stdlib | Command-line argument parsing |
| pytest | latest | Unit and integration testing |

## Testing

| Type | Framework | Coverage Target |
|------|-----------|-----------------|
| Unit | pytest | 60% |
| Integration | pytest | 50% |

## Development Tools

| Tool | Purpose |
|------|---------|
| pytest | Test runner |
| ruff | Linting and formatting (recommended) |

## Project Structure

```
cli-calculator/
├── calculator/          # Main application package
│   ├── __init__.py
│   ├── main.py          # CLI entry point with argparse
│   └── operations.py    # Calculator operations
├── tests/               # Test directory
│   ├── __init__.py
│   ├── test_operations.py
│   └── test_cli.py
├── pyproject.toml       # Project configuration
└── README.md
```

## Key Patterns

- **CLI Pattern**: argparse-based command-line interface
- **Module Structure**: Separate operations from CLI handling
- **Testing**: pytest with fixtures for operation testing
