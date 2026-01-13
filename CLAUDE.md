# CLAUDE.md - Ensemble vNext Development

## Project Overview

Ensemble vNext is a workflow framework for Claude Code that encodes power-user patterns into a repeatable, accessible system. This project is the plugin development for Ensemble vNext.

**Key Documents:**
- PRD: `docs/PRD/ensemble-vnext.md`
- TRD: `docs/TRD/ensemble-vnext.md`
- Constitution: `.claude/rules/constitution.md`
- Stack: `.claude/rules/stack.md`

---

## Core Principles

1. **Commands orchestrate, subagents execute** - Commands define workflow, agents do specialized work
2. **Skills and agents are PROMPTS only** - Markdown files interpreted by LLM, not executable code
3. **Commands are prompts with optional shell scripts** - Deterministic parts use scripts, LLM handles the rest
4. **Non-deterministic system** - Most testing is manual; use session logs to verify behavior

---

## Development Workflow

```
/create-prd    --> docs/PRD/<feature>.md
/create-trd    --> docs/TRD/<feature>.md
/implement-trd --> Implementation with .trd-state/ tracking
```

---

## Baseline Reference

**Read-only source**: `~/dev/ensemble`

Copy extensively from existing ensemble. Under NO circumstances modify that folder.

Key sources:
- `packages/permitter/` - Permission hook (copy exactly)
- `packages/router/` - Routing hook (copy exactly)
- `packages/*/agents/` - Agent templates (adapt for 12 streamlined agents)
- `packages/*/skills/` - Skill library (copy relevant skills)
- `packages/*/commands/` - Command templates (adapt for vendored runtime)

---

## 12 Streamlined Subagents

| Agent | Based On | Purpose |
|-------|----------|---------|
| product-manager | product-management-orchestrator | PRD creation |
| technical-architect | tech-lead-orchestrator | TRD creation |
| spec-planner | (new) | Execution planning |
| frontend-implementer | frontend-developer | UI/client work |
| backend-implementer | backend-developer | API/server work |
| mobile-implementer | mobile-developer | Mobile apps |
| verify-app | (new) | Test execution |
| code-simplifier | (new) | Post-verify refactoring |
| code-reviewer | code-reviewer | Security/quality review |
| app-debugger | deep-debugger | Debug failures |
| devops-engineer | infrastructure-developer | Infrastructure |
| cicd-specialist | deployment-orchestrator | CI/CD pipelines |

---

## Testing Approach

Given non-deterministic LLM output:

1. **Manual verification** is primary
2. **Session log review** confirms correct behavior
3. **Deterministic scripts** (hooks) get unit tests
4. Test mechanism: `claude --prompt "..." --session-id xxx --dangerously-skip-permissions`

---

## Approval Requirements

**Requires Approval:**
- Any modification to `~/dev/ensemble`
- Schema/architectural changes
- Changes to constitution.md or stack.md

**No Approval Needed:**
- Reading files anywhere
- Creating files in `.claude/` and `docs/`
- Running tests
- Git operations (status, diff, log, add, commit)

---

## Current Status

Project initialized. Ready for `/implement-trd` to begin Phase 1 implementation.
