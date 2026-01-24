# CLAUDE.md - AI-Augmented Development

## Core Workflow

```
/init-project          --> Initialize project structure (once per project)
/create-prd            --> Product Requirements Document
/refine-prd            --> (optional) Iterate on PRD with feedback
/create-trd            --> Technical Requirements Document
/refine-trd            --> (optional) Iterate on TRD with feedback
/implement-trd         --> Execute implementation tasks
/fold-prompt           --> Optimize context for continued work
```

Always check for existing PRD/TRD before creating new ones.

---

## Project: cli-calculator

A Python CLI calculator using argparse that supports addition, subtraction, multiplication, and division. Features helpful error messages and comprehensive pytest tests.

## Tech Stack

- **Language:** Python 3.x
- **CLI Framework:** argparse (stdlib)
- **Testing:** pytest
- **Linting:** ruff (recommended)

## Key Entry Points

- `calculator/main.py` - CLI entry point with argparse
- `calculator/operations.py` - Core arithmetic operations
- `tests/` - pytest test suite

---

## Learnings

*Learnings will be captured here by the SessionEnd hook.*
