# Kanban Task Board Constitution

Project absolutes and architecture invariants for a full-stack Kanban task management application.

---

## Core Principles

### 1. Commands Orchestrate, Subagents Execute

- **Commands** define and control workflow logic
- **Subagents** perform specialized work delegated by commands
- This separation provides visibility, debuggability, and determinism

### 2. Skills and Agents are PROMPTS Only

- Skills are `.md` files interpreted by the LLM at runtime
- Agents are `.md` files with YAML frontmatter
- No executable code in skill or agent definitions
- Prompt engineering is the implementation medium

### 3. Commands are Prompts with Optional Shell Scripts

- Commands fundamentally are prompts (Markdown files with YAML frontmatter)
- Deterministic operations (scaffolding, validation) use shell scripts
- LLM handles non-deterministic operations (content generation, analysis)

### 4. Non-Deterministic System

- LLM outputs are inherently variable
- Most testing must be manual due to non-deterministic nature
- Test mechanism: `claude --prompt "..." --session-id xxx --dangerously-skip-permissions`
- Review session logs to verify agents, skills, and hooks used
- Unit testing applies only to hooks and utility scripts

---

## Architecture Invariants

### Vendored Runtime

- All runtime components live in `.claude/` directory
- Runtime is committed to git for reproducibility
- Identical behavior in local CLI and Claude Code Web sessions
- Local settings (`.local.json`) are gitignored

### Two-Layer Architecture

```
Plugin (Generator Layer)     Vendored Runtime (Execution Layer)
------------------------     ---------------------------------
Generator Commands     -->   Project Subagents
Skills Library         -->   Compiled Skills (based on stack)
Hook Templates         -->   Installed Hooks
Review CLI             -->   Workflow Commands
```

### Artifact Flow

```
Story/Idea --> PRD --> TRD (with Execution Plan) --> Implementation
```

### Governance Split

| Layer | Artifact | Change Frequency | Owner |
|-------|----------|------------------|-------|
| Slow | `constitution.md` | Rare, requires confirmation | User |
| Slow | `stack.md` | Occasional, requires confirmation | User |
| Fast | `CLAUDE.md` | Frequent, automatic | SessionEnd hook |

---

## Technology Stack

See `stack.md` for complete technology stack definition.

### Primary Context

Full-stack JavaScript/TypeScript application with React frontend and Node.js Express backend.

### Languages

| Purpose | Language |
|---------|----------|
| Frontend | JavaScript (React 18) |
| Backend | JavaScript (Node.js/Express) |
| Database | SQL (PostgreSQL) |

### Runtime Dependencies

- Node.js (backend + frontend tooling)
- PostgreSQL (data persistence)
- Docker (containerized development)

---

## 12 Streamlined Subagents

| Category | Agent | Responsibility |
|----------|-------|----------------|
| Artifact | `product-manager` | PRD creation and refinement |
| Artifact | `technical-architect` | TRD creation and refinement |
| Planning | `spec-planner` | Execution planning and parallelization |
| Implement | `frontend-implementer` | UI, components, client logic |
| Implement | `backend-implementer` | APIs, services, data layer |
| Implement | `mobile-implementer` | Mobile apps (when applicable) |
| Quality | `verify-app` | Test execution and verification |
| Quality | `code-simplifier` | Post-verification refactoring |
| Quality | `code-reviewer` | Security and quality review |
| Quality | `app-debugger` | Debug verification failures and bugs |
| DevOps | `devops-engineer` | Infrastructure and deployment |
| DevOps | `cicd-specialist` | Pipeline configuration |

---

## Quality Gates

Before completing any implementation:

- [ ] Tests pass (unit >= 80%, integration >= 70% when applicable)
- [ ] No secrets in code
- [ ] Input validation present
- [ ] Documentation updated

---

## Approval Requirements

### Requires User Approval

- Architecture changes
- New dependencies
- Database schema changes
- Breaking API changes
- Production deployments
- Security-sensitive code

### No Approval Needed

- Bug fixes within existing patterns
- Test additions
- Documentation updates
- Refactoring without API changes
- Style/formatting changes

---

## Prohibited Patterns

1. **No tool restrictions by default** - Subagents have all tools enabled (omit `tools:` line)
2. **No executable code in skills/agents** - Prompts only
3. **No implicit knowledge** - Workflows must be explicit in commands
4. **No blocking hooks** - Hooks never block unless explicitly required
5. **No auto-commit in SessionEnd** - Stage only, let user/system handle commits
6. **No direct database access without parameterized queries** - Prevent SQL injection

---

## Testing Philosophy

Given the non-deterministic nature of LLM-based systems:

1. **Manual verification** is primary testing method
2. **Session log review** confirms correct agent/skill invocation
3. **Deterministic scripts** (hooks, utilities) get unit tests
4. **Integration testing** uses controlled prompts and session inspection
5. **OpenTelemetry** traces for execution verification (when feasible)

---

## Changelog

### Version 1.0.0 (2026-01-15)

- Initial constitution generated by /init-project

---

*This constitution is maintained by the user and requires explicit confirmation for changes.*
*Generated by /init-project on 2026-01-15*
