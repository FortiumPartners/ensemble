# Ensemble Plugins - Claude Code Configuration

> Modular plugin ecosystem for Claude Code (v5.0.0) | 24 packages | 28 agents | 4-tier architecture

## Quick Reference

### Slash Commands
All ensemble commands use the `/ensemble:` namespace:
```
/ensemble:fold-prompt          # Optimize Claude environment
/ensemble:create-prd           # Create Product Requirements Document
/ensemble:create-trd           # Create Technical Requirements Document
/ensemble:implement-trd        # Implement TRD with git-town workflow
/ensemble:release              # Orchestrate release workflow
/ensemble:playwright-test      # Run E2E tests with Playwright
/ensemble:manager-dashboard    # Generate productivity metrics
/ensemble:sprint-status        # Current sprint status report
```

### Essential Commands
```bash
npm test                    # Run all tests
npm run validate            # Validate marketplace + plugins
npm run generate            # Regenerate markdown from YAML
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

## Agent Delegation Protocol

### Handoff Pattern
Agents delegate work using the Task tool with explicit agent types:
```
Task(subagent_type="backend-developer", prompt="Implement API endpoint...")
Task(subagent_type="code-reviewer", prompt="Review changes in src/...")
```

### Delegation Hierarchy
```
ensemble-orchestrator (chief)
├── tech-lead-orchestrator (architecture decisions)
│   ├── backend-developer, frontend-developer
│   └── infrastructure-developer
├── product-management-orchestrator (requirements)
├── qa-orchestrator (quality gates)
│   ├── code-reviewer, test-runner
│   └── playwright-tester
└── infrastructure-orchestrator (deployment)
    └── deployment-orchestrator, build-orchestrator
```

### Handoff Best Practices
1. **Clear Context**: Include relevant file paths and requirements
2. **Scoped Tasks**: One responsibility per delegation
3. **Return Path**: Agents report results back to orchestrator
4. **Error Escalation**: Unresolved issues escalate up the hierarchy

### Agent Selection Guide
| Task Type | Primary Agent | Backup |
|-----------|---------------|--------|
| API implementation | backend-developer | tech-lead-orchestrator |
| UI components | frontend-developer | tech-lead-orchestrator |
| Code quality | code-reviewer | qa-orchestrator |
| Test failures | test-runner | deep-debugger |
| Database changes | postgresql-specialist | backend-developer |
| CI/CD issues | build-orchestrator | infrastructure-developer |
| Release process | release-agent | git-workflow |

## Project History

For understanding past architectural decisions and project evolution, read:
- [.claude/ENSEMBLE-HISTORY.md](.claude/ENSEMBLE-HISTORY.md) - Chronological change log (auto-generated, read at startup)
- [docs/PRD/](docs/PRD/) - Detailed product requirements
- [docs/TRD/](docs/TRD/) - Technical implementation details

The history file is automatically regenerated when running `/ensemble:fold-prompt`.

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
- `PreToolUse` - Before tool execution (can modify or block)
- `PostToolUse` - After tool execution (can process results)

### Hook Configuration (hooks/hooks.json)
```json
{
  "hooks": {
    "PreToolUse": [{
      "matcher": "Task",
      "hooks": [{
        "type": "command",
        "command": "${CLAUDE_PLUGIN_ROOT}/hooks/pane-spawner.js"
      }]
    }],
    "PostToolUse": [{
      "matcher": "Task",
      "hooks": [{
        "type": "command",
        "command": "${CLAUDE_PLUGIN_ROOT}/hooks/pane-completion.js"
      }]
    }]
  }
}
```

### Implemented Hooks

| Plugin | Hook | Trigger | Purpose |
|--------|------|---------|---------|
| agent-progress-pane | PreToolUse | Task | Spawn progress pane |
| agent-progress-pane | PostToolUse | Task | Update completion status |
| task-progress-pane | PreToolUse | TodoWrite | Display task progress |

### Hook Environment Variables
- `CLAUDE_PLUGIN_ROOT` - Plugin installation directory
- `TOOL_NAME` - Name of the tool being invoked
- `TOOL_INPUT` - JSON-encoded tool parameters

### Creating Custom Hooks
```javascript
#!/usr/bin/env node
// hooks/my-hook.js
const input = JSON.parse(process.env.TOOL_INPUT || '{}');
console.log(`Tool ${process.env.TOOL_NAME} called with:`, input);
// Return non-zero to block tool execution (PreToolUse only)
process.exit(0);
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
4. Reinstall: `claude plugin uninstall ensemble-full && claude plugin install ensemble-full --scope local`

### Module Not Found in Cached Plugin
- Inline dependencies instead of using npm packages
- Example: agent-progress-pane inlines multiplexer-adapters
- Check `node_modules` exists in plugin directory

### Tests Failing
- Jest/Vitest mock CommonJS `require()` differently
- Use `vi.mock()` for ESM, `jest.mock()` for CJS
- Real config files can interfere with test expectations

### YAML Generation Errors
```bash
npm run generate -- --verbose  # See detailed errors
npm run generate -- --dry-run  # Preview without writing
```
Common issues:
- Schema validation: Check pattern requirements in `schemas/command-yaml-schema.json`
- Missing required fields: `metadata.name`, `metadata.description`, `metadata.version`
- Phase/step numbering gaps: Must be sequential starting from 1

### Agent Not Found
- Verify agent YAML exists in `packages/*/agents/`
- Run `npm run generate` to regenerate markdown
- Check agent name matches exactly (case-sensitive)

### Hooks Not Executing
1. Verify `hooks.json` path in `plugin.json`
2. Check hook script is executable: `chmod +x hooks/*.js`
3. Test hook manually: `TOOL_NAME=Task node hooks/my-hook.js`
4. Check Claude Code logs for hook errors

### Command Namespace Issues
- Commands should use `name: ensemble:command-name` format
- Schema pattern: `^[a-z][a-z0-9-]*(:[a-z][a-z0-9-]*)?$`
- After changes, run `npm run generate` and reinstall plugin

## Links

- **Repository**: https://github.com/FortiumPartners/ensemble
- **Issues**: https://github.com/FortiumPartners/ensemble/issues
- **Email**: support@fortiumpartners.com
