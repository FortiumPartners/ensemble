# Ensemble Plugins - Claude Code Configuration

> Modular plugin ecosystem for Claude Code (v5.0.0) | 24 packages | 28 agents | 4-tier architecture

## Quick Reference

### Essential Commands
```bash
npm test                    # Run all tests
npm run validate            # Validate marketplace + plugins
npm run test:coverage       # Coverage reports
```

### Key Paths
- **Plugins**: `packages/*/` (24 packages)
- **Agents**: `packages/*/agents/*.yaml` (28 agents)
- **Commands**: `packages/*/commands/`
- **Skills**: `packages/*/skills/`
- **Schemas**: `schemas/{plugin,marketplace}-schema.json`

## Architecture Overview

```
Tier 1: Core Foundation
└── ensemble-core (orchestration, framework detection, XDG config)

Tier 2: Workflow Plugins (7)
├── product (PRD/TRD creation)
├── development (frontend/backend orchestration)
├── quality (code review, testing, DoD)
├── infrastructure (AWS, K8s, Docker, Helm, Fly.io)
├── git (workflow, conventional commits)
├── e2e-testing (Playwright)
└── metrics (productivity analytics)

Tier 3: Framework Skills (5)
├── react, nestjs, rails, phoenix, blazor

Tier 4: Testing Frameworks (5)
├── jest, pytest, rspec, xunit, exunit

Utilities: agent-progress-pane, task-progress-pane
Shared: multiplexer-adapters (WezTerm, Zellij, tmux)
Meta: ensemble-full (complete bundle)
```

## Development Patterns

### Plugin Structure
```
packages/<name>/
├── .claude-plugin/plugin.json  # Plugin manifest (required)
├── package.json                # NPM config (required)
├── agents/*.yaml               # Agent definitions
├── commands/*.{yaml,md}        # Slash commands
├── skills/{SKILL,REFERENCE}.md # Skill documentation
├── hooks/hooks.json            # Tool hooks (optional)
├── lib/                        # Shared utilities
└── tests/                      # Jest or Vitest tests
```

### Plugin Manifest (plugin.json)
```json
{
  "name": "ensemble-<name>",
  "version": "5.0.0",
  "description": "...",
  "author": { "name": "Fortium Partners", "email": "support@fortiumpartners.com" },
  "commands": "./commands",
  "skills": "./skills",
  "hooks": "./hooks/hooks.json"
}
```

### Agent YAML Format
```yaml
---
name: agent-name
description: Clear mission statement
tools: [Read, Write, Edit, Bash, Grep, Glob, Task]
---
## Mission
Specific expertise area

## Behavior
- Key behaviors and protocols
- Handoff procedures
```

## Agent Mesh (28 Specialized Agents)

### Orchestrators
- `ensemble-orchestrator` - Chief orchestrator, task decomposition
- `tech-lead-orchestrator` - Technical leadership, architecture
- `product-management-orchestrator` - Product lifecycle coordination
- `qa-orchestrator` - Quality assurance orchestration
- `infrastructure-orchestrator` - Infrastructure coordination

### Developers
- `frontend-developer` - React, Vue, Angular, Svelte
- `backend-developer` - Server-side across languages
- `infrastructure-developer` - Cloud-agnostic automation

### Quality & Testing
- `code-reviewer` - Security-enhanced code review
- `test-runner` - Test execution and triage
- `deep-debugger` - Systematic bug analysis
- `playwright-tester` - E2E testing

### Specialists
- `git-workflow` - Conventional commits, semantic versioning
- `github-specialist` - PR, branch management
- `documentation-specialist` - Technical documentation
- `api-documentation-specialist` - OpenAPI/Swagger
- `postgresql-specialist` - Database administration
- `helm-chart-specialist` - Kubernetes Helm charts

### Utilities
- `general-purpose` - Research and analysis
- `file-creator` - Template-based scaffolding
- `context-fetcher` - Documentation retrieval
- `directory-monitor` - File system surveillance
- `agent-meta-engineer` - Agent ecosystem management
- `release-agent` - Automated release orchestration

## Testing

### Frameworks
- **Jest** (most packages): `npm test`
- **Vitest** (multiplexer-adapters): `npm test`

### Running Tests
```bash
# All packages
npm test

# Single package
npm test --workspace=packages/<name>

# With coverage
npm run test:coverage --workspace=packages/<name>
```

## Hooks System

### Available Hook Points
- `PreToolUse` - Before tool execution
- `PostToolUse` - After tool execution

### Hook Configuration (hooks/hooks.json)
```json
{
  "hooks": {
    "PreToolUse": [{
      "matcher": "TodoWrite",
      "hooks": [{
        "type": "command",
        "command": "node ${CLAUDE_PLUGIN_ROOT}/hooks/handler.js"
      }]
    }]
  }
}
```

## Configuration

### XDG-Compliant Paths
Priority order:
1. `$XDG_CONFIG_HOME/ensemble/`
2. `~/.config/ensemble/`
3. `~/.ensemble/`

### Claude Code Permissions (.claude/settings.local.json)
Pre-approved commands:
- `git push`, `git add`, `git commit`
- `gh run list`
- `claude plugin install`, `claude plugin marketplace update`
- `grep`, `node hooks/task-spawner.js`

## Validation & CI

### Local Validation
```bash
npm run validate  # Validates:
                  # - marketplace.json schema
                  # - plugin.json files
                  # - YAML syntax in agents/
                  # - package.json naming
```

### GitHub Actions
- `validate.yml` - Schema and structure validation
- `test.yml` - Node 20/22 matrix testing
- `release.yml` - Automated releases on tags

## Commit Conventions

Use conventional commits:
- `feat(<scope>)`: New feature
- `fix(<scope>)`: Bug fix
- `docs(<scope>)`: Documentation
- `test(<scope>)`: Tests
- `chore(<scope>)`: Maintenance
- `refactor(<scope>)`: Code restructure

Example: `fix(agent-progress-pane): inline multiplexer-adapters for standalone use`

## Common Tasks

### Create New Plugin
```bash
mkdir -p packages/<name>/{.claude-plugin,agents,commands,skills,lib,tests}
# Create plugin.json, package.json, README.md, CHANGELOG.md
npm run validate
```

### Update Marketplace
```bash
# Edit marketplace.json
npm run validate
git commit -m "feat(marketplace): add <plugin-name>"
```

### Publish Plugin
```bash
npm run publish:changed
```

## Troubleshooting

### Plugin Not Loading
1. Check `plugin.json` syntax: `npm run validate`
2. Verify hooks path matches actual file location
3. Check for missing dependencies in cached installation

### Module Not Found in Cached Plugin
- Inline dependencies instead of using npm packages
- Example: agent-progress-pane inlines multiplexer-adapters

### Tests Failing
- Jest/Vitest mock CommonJS `require()` differently
- Use `vi.mock()` for ESM, `jest.mock()` for CJS
- Real config files can interfere with test expectations

## Links

- **Repository**: https://github.com/FortiumPartners/ensemble
- **Issues**: https://github.com/FortiumPartners/ensemble/issues
- **Email**: support@fortiumpartners.com
