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

## Project: validation-module

A TypeScript validation module providing functions for email validation, password strength checking, and phone number formatting. Exports strongly-typed validation result interfaces.

## Tech Stack

- **Language**: TypeScript 5.x with strict mode
- **Runtime**: Node.js
- **Testing**: Jest with ts-jest
- **Build**: tsc (TypeScript compiler)
- **Code Quality**: ESLint, Prettier

## Key Files

- `story.md` - Project requirements and user story
- `.claude/rules/constitution.md` - Development standards and quality gates
- `.claude/rules/stack.md` - Technology stack documentation
- `.claude/rules/process.md` - Development workflow

---

## Learnings

*Learnings will be captured here by the SessionEnd hook.*
