# Ensemble Plugins

Modular plugin ecosystem for Claude Code, enabling flexible, pay-what-you-need AI-augmented development workflows.

## Overview

Ensemble Plugins v5.0.0 provides a modular plugin system for Claude Code, allowing developers to install only the capabilities they need—from core orchestration to framework-specific skills.

## Architecture

The plugin ecosystem is organized into 4 tiers across 24 packages:

### Tier 1: Core Foundation
- **ensemble-core** (5.0.0) - Essential orchestration, agents, and utilities

### Tier 2: Workflow Plugins
- **ensemble-product** - Product management (PRD creation, analysis)
- **ensemble-development** - Frontend/backend implementation agents
- **ensemble-quality** - Code review, testing, DoD enforcement
- **ensemble-infrastructure** - AWS, Kubernetes, Docker, Helm, Fly.io automation
- **ensemble-git** - Git workflow and conventional commits
- **ensemble-e2e-testing** - Playwright integration for E2E testing
- **ensemble-metrics** - Productivity analytics and dashboard

### Tier 3: Framework Skills
- **ensemble-react** - React component development
- **ensemble-nestjs** - NestJS backend patterns
- **ensemble-rails** - Ruby on Rails MVC
- **ensemble-phoenix** - Phoenix LiveView patterns
- **ensemble-blazor** - Blazor .NET components

### Tier 4: Testing Framework Integration
- **ensemble-jest** - Jest testing patterns
- **ensemble-pytest** - Pytest testing patterns
- **ensemble-rspec** - RSpec testing patterns
- **ensemble-xunit** - xUnit testing patterns
- **ensemble-exunit** - ExUnit testing patterns

### Utilities
- **ensemble-agent-progress-pane** (5.1.0) - Real-time subagent monitoring in terminal panes
- **ensemble-task-progress-pane** (5.0.0) - TodoWrite progress visualization
- **ensemble-multiplexer-adapters** - Terminal multiplexer abstraction layer

### Runtime Translation
- **ensemble-opencode** (5.3.0) - OpenCode runtime support (translates Ensemble artifacts to OpenCode-compatible formats)

### Meta-Package
- **ensemble-full** - Complete ecosystem (all plugins bundled)

## Installation

Plugins are installed using Claude Code's interactive `/plugin` command.

### Quick Start (Full Ecosystem)

In Claude Code, run:

```
# Add the Ensemble marketplace
/plugin marketplace add FortiumPartners/ensemble

# Install the full bundle (all plugins)
/plugin install ensemble-full@ensemble
```

Or use the interactive UI: type `/plugin` → **Discover** tab → select **ensemble-full** → choose your scope.

### Modular Installation

Install only what you need from the marketplace:

```
# Core foundation (required)
/plugin install ensemble-core@ensemble

# Workflow plugins
/plugin install ensemble-product@ensemble
/plugin install ensemble-development@ensemble
/plugin install ensemble-quality@ensemble
/plugin install ensemble-infrastructure@ensemble
/plugin install ensemble-git@ensemble
/plugin install ensemble-e2e-testing@ensemble

# Framework skills (optional)
/plugin install ensemble-react@ensemble
/plugin install ensemble-nestjs@ensemble

# Testing support (optional)
/plugin install ensemble-jest@ensemble
/plugin install ensemble-pytest@ensemble
```

### Local Installation (Development)

For local development or testing, use the `--plugin-dir` flag:

```bash
# Clone the repository
git clone https://github.com/FortiumPartners/ensemble.git

# Run Claude Code with a local plugin
claude --plugin-dir ./ensemble/packages/core
```

### Installation Scopes

When installing plugins, you can choose a scope:

- **User** (default) — available across all your projects
- **Project** — shared with collaborators via `.claude/settings.json`
- **Local** — personal, per-repository (not shared)

## Usage

After installation, plugins automatically register their agents, commands, and skills with Claude Code.

### Available Commands

Commands are provided by specific plugins:

- `/create-prd` - Product requirements (ensemble-product)
- `/create-trd` - Technical requirements (ensemble-core)
- `/implement-trd` - TRD implementation (ensemble-development)
- `/fold-prompt` - Project optimization (ensemble-core)
- `/dashboard` - Metrics dashboard (ensemble-metrics)

### Agent Mesh

Plugins provide 28 specialized agents across domains:

- **Orchestrators**: ai-mesh-orchestrator, tech-lead-orchestrator, product-management-orchestrator, qa-orchestrator, build-orchestrator, deployment-orchestrator, infrastructure-orchestrator
- **Developers**: frontend-developer, backend-developer, infrastructure-developer
- **Quality**: code-reviewer, test-runner, playwright-tester, deep-debugger
- **Specialists**: documentation-specialist, api-documentation-specialist, postgresql-specialist, github-specialist, helm-chart-specialist
- **Utilities**: git-workflow, file-creator, context-fetcher, directory-monitor, release-agent, agent-meta-engineer

## OpenCode Support

Ensemble plugins can be used with the [OpenCode](https://opencode.ai) runtime via the `ensemble-opencode` translation layer. This generates OpenCode-compatible agents, commands, skills, and configuration from the existing Ensemble YAML/JSON/Markdown artifacts.

### Generating OpenCode Artifacts

```bash
# Generate all OpenCode artifacts to dist/opencode/
npm run generate:opencode

# Preview without writing files
npm run generate:opencode -- --dry-run

# Validate generated config against OpenCode schema
npm run generate:opencode -- --validate

# Custom output directory
npm run generate:opencode -- --output-dir ./my-output
```

The generator produces:
- **Skills**: Copies and validates SKILL.md files to `.opencode/skill/`
- **Commands**: Translates YAML commands to OpenCode Markdown format in `.opencode/commands/ensemble/`
- **Agents**: Converts 28 agent YAML definitions to OpenCode JSON config + Markdown agent files
- **Hooks**: Bridges Ensemble PreToolUse/PostToolUse hooks to OpenCode's typed hook API via `@opencode-ai/plugin` SDK
- **Manifest**: Generates `opencode.json` with agent, command, skill, plugin, and permission configuration

### Installing in OpenCode

```jsonc
// In your opencode.json, add the plugin:
{
  "plugin": ["ensemble-opencode"]
}
```

For local development:
```jsonc
{
  "plugin": ["file:///absolute/path/to/packages/opencode"]
}
```

### Output Structure

```
dist/opencode/
├── .opencode/
│   ├── agents/          # Agent markdown files
│   ├── commands/
│   │   └── ensemble/    # Translated command files
│   └── skill/           # Framework skill files
└── opencode.json        # OpenCode configuration manifest
```

## Plugin Dependencies

Plugins declare dependencies to ensure compatibility:

```
ensemble-react
  └─ ensemble-development
      └─ ensemble-core
```

Claude Code automatically installs required dependencies when you install a plugin.

## Development

### Repository Structure

```
ensemble/
├── packages/               # Individual plugins
│   ├── core/              # Core plugin
│   ├── product/           # Product plugin
│   └── ...                # Additional plugins
├── schemas/               # Validation schemas
├── scripts/               # Build and validation scripts
└── marketplace.json       # Plugin registry
```

### Building from Source

```bash
# Clone repository
git clone https://github.com/FortiumPartners/ensemble.git
cd ensemble

# Install dependencies
npm install

# Validate all plugins
npm run validate

# Run tests
npm test
```

### Creating a New Plugin

1. Create package structure:
```bash
mkdir -p packages/my-plugin/{.claude-plugin,agents,commands,skills,lib,tests}
```

2. Create `packages/my-plugin/.claude-plugin/plugin.json`:
```json
{
  "name": "ensemble-my-plugin",
  "version": "1.0.0",
  "description": "My custom plugin",
  "author": {
    "name": "Your Name",
    "email": "you@example.com"
  },
  "license": "MIT",
  "keywords": ["my-plugin", "ensemble"],
  "agents": "./agents",
  "commands": "./commands",
  "skills": "./skills"
}
```

3. Create `packages/my-plugin/package.json`
4. Add agents, commands, and skills
5. Validate: `npm run validate`
6. Test: `npm test`

## Migration from ensemble v3.x/v4.x

If you're migrating from previous ensemble versions:

1. **Identify current usage**: Review which agents/commands you actively use
2. **Install equivalent plugins**: Map your usage to the new modular plugins
3. **Update references**: Plugin names have changed (e.g., `infrastructure-management-subagent` → `ensemble-infrastructure`)
4. **Test workflows**: Verify your development workflows still function

### Migration Guide

| v3.x/v4.x Component | v5.0 Plugin |
|---------------------|-------------|
| ensemble-orchestrator | ensemble-core |
| product-management-orchestrator | ensemble-product |
| frontend-developer | ensemble-development |
| backend-developer | ensemble-development |
| infrastructure-management-subagent | ensemble-infrastructure |
| code-reviewer | ensemble-quality |
| test-runner | ensemble-quality |
| git-workflow | ensemble-git |
| playwright-tester | ensemble-e2e-testing |
| manager-dashboard-agent | ensemble-metrics |
| ensemble-pane-viewer | ensemble-agent-progress-pane (now 5.1.0) |
| task-progress-pane | ensemble-task-progress-pane (new) |

## Configuration

Ensemble uses XDG-compliant configuration paths:

### Config Directory Location

The config directory is determined in this order:
1. `$XDG_CONFIG_HOME/ensemble/` (if XDG_CONFIG_HOME is set)
2. `~/.config/ensemble/` (if ~/.config exists)
3. `~/.ensemble/` (fallback)

### Directory Structure

```
~/.config/ensemble/           # or ~/.ensemble/
├── plugins/
│   ├── task-progress-pane/   # Task progress plugin config
│   └── agent-progress-pane/  # Agent progress pane plugin config
├── logs/                     # Log files
├── cache/                    # Cache data
└── sessions/                 # Session data
```

### Migrating from ai-mesh

If you have existing ai-mesh configuration directories, use the migration script:

```bash
# Preview what will be migrated
node scripts/migrate-config.js --dry-run

# Perform migration
node scripts/migrate-config.js

# Force overwrite existing files
node scripts/migrate-config.js --force
```

The script migrates:
- `~/.ai-mesh-task-progress/` → `~/.config/ensemble/plugins/task-progress-pane/`
- `~/.ai-mesh-pane-viewer/` → `~/.config/ensemble/plugins/agent-progress-pane/`

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

### Development Workflow

1. Fork the repository
2. Create a feature branch
3. Make changes in the relevant package(s)
4. Add/update tests
5. Run validation: `npm run validate`
6. Run tests: `npm test`
7. Submit a pull request

## Versioning

All plugins follow [Semantic Versioning](https://semver.org/):

- **Major**: Breaking changes (e.g., 4.x → 5.0)
- **Minor**: New features, backward compatible (e.g., 5.0 → 5.1)
- **Patch**: Bug fixes, backward compatible (e.g., 5.0.0 → 5.0.1)

Core plugins (Tier 1-2) maintain version synchronization. Framework and testing plugins (Tier 3-4) may have independent versions.

## License

MIT - See [LICENSE](LICENSE) for details.

## Support

- **Documentation**: [https://github.com/FortiumPartners/ensemble](https://github.com/FortiumPartners/ensemble)
- **Issues**: [GitHub Issues](https://github.com/FortiumPartners/ensemble/issues)
- **Discussions**: [GitHub Discussions](https://github.com/FortiumPartners/ensemble/discussions)
- **Email**: support@fortiumpartners.com

## Acknowledgments

Built on the foundation of previous ensemble versions, which achieved:
- 35-40% productivity improvements
- 87-99% performance optimization
- 28 specialized agents (v5.0)
- Production validation across multiple teams

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for version history and release notes.

---

**Maintained by Fortium Partners** | [Website](https://fortiumpartners.com) | [GitHub](https://github.com/FortiumPartners)
