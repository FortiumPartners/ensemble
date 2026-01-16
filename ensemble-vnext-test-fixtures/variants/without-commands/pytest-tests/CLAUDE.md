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

## Project: string-utils

Python string utility module with comprehensive pytest tests. Includes functions for capitalizing words, reversing strings, and counting vowels. Targets 90%+ test coverage using pytest fixtures and parametrize decorators.

## Tech Stack

- **Language**: Python 3.11+
- **Testing**: pytest with pytest-cov (90% coverage target)
- **Code Quality**: ruff (linting/formatting), mypy (type checking)
- **Methodology**: TDD (Test-Driven Development)

---

## Learnings

*Learnings will be captured here by the SessionEnd hook.*
