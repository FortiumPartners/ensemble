# Ensemble vNext Technology Stack

Technology stack definition for the Ensemble vNext plugin development project.

---

## Primary Platform

**Claude Code Plugin SDK**

- Distribution: Claude Code marketplace
- Runtime: Vendored `.claude/` directory
- Execution contexts: Local CLI, Claude Code Web

---

## Core Technologies

### Prompt Engineering

| Component | Format | Location |
|-----------|--------|----------|
| Skills | Markdown with frontmatter | `.claude/skills/<name>/SKILL.md` |
| Agents | Markdown with YAML frontmatter | `.claude/agents/*.md` |
| Commands | Markdown with YAML frontmatter | `.claude/commands/*.md` |
| Rules | Plain Markdown | `.claude/rules/*.md` |

### Hook Development

| Technology | Purpose | Notes |
|------------|---------|-------|
| Node.js | Hook executables | Primary hook runtime |
| Shell (Bash) | Simple scripts, scaffolding | Deterministic operations |
| Python | Router hook (legacy) | Future refactor to Node.js planned |

### Configuration

| Format | Use Case |
|--------|----------|
| JSON | `settings.json`, status files, `.mcp.json` |
| YAML | Frontmatter in Markdown files |
| Markdown | Documentation, prompts |

---

## Development Tools

### Version Control

- **Git** - Source control and state coordination
- Branch naming: `<issue-id>-<session-name>`

### Testing

| Type | Approach |
|------|----------|
| Manual verification | Primary testing method |
| Session log review | Verify agent/skill invocation |
| Unit tests | Hooks and utility scripts only |
| CLI automation | `claude --prompt "..." --dangerously-skip-permissions` |

### Code Quality

| Tool | Purpose |
|------|---------|
| Prettier | Markdown, JSON, YAML formatting |
| ESLint | JavaScript/Node.js linting |
| ShellCheck | Shell script linting |

---

## Runtime Dependencies

### Required

- Claude Code CLI (latest)
- Node.js 18+ (for hooks)
- Git 2.x+ (for version control)

### Optional

- Python 3.x (for legacy router hook)
- OpenTelemetry (for execution tracing)

---

## MCP Integrations

| Server | Purpose |
|--------|---------|
| Context7 | Documentation retrieval |
| Playwright MCP | E2E testing (exclusive) |

Additional MCP servers are project-configurable via `.mcp.json`.

---

## Skill Categories

Skills are compiled from the plugin library based on this stack definition.

### Core Skills (Always Included)

- Prompt engineering patterns
- Claude Code plugin development
- Testing strategies for non-deterministic systems

### Optional Skills (Project-Dependent)

Selected based on target project's technology stack during `/init-project`.

---

## File Structure Reference

```
.claude/
  agents/       # 12 streamlined subagents
  commands/     # Workflow commands
  hooks/        # Hook executables
  skills/       # Compiled skills
  rules/        # constitution.md, stack.md, process.md
  settings.json # Committed configuration

docs/
  PRD/          # Product Requirements Documents
  TRD/          # Technical Requirements Documents
  standards/    # Symlinked governance docs
  templates/    # Document templates

.trd-state/     # Implementation tracking (git-tracked)
```

---

*This stack definition is maintained by the user and drives skill selection during project initialization.*
