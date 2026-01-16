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

## Project: todo-list-api

A REST API for managing todo items with full CRUD operations (GET, POST, PUT, DELETE) using FastAPI and Pydantic validation.

## Tech Stack

- **Language:** Python 3.11+
- **Framework:** FastAPI
- **Validation:** Pydantic models for request/response
- **Testing:** pytest
- **Linting:** ruff

## Key Files

- `story.md` - Original feature story/requirements
- `.claude/rules/constitution.md` - Project governance and quality gates
- `.claude/rules/stack.md` - Technology stack details
- `.claude/rules/process.md` - Development workflow

---

## Learnings

*Learnings will be captured here by the SessionEnd hook.*
