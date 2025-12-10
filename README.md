# AI Mesh Plugins

Modular plugin ecosystem for Claude Code, enabling flexible, pay-what-you-need AI-augmented development workflows.

## Overview

AI Mesh Plugins is the v4.0.0 evolution of the ai-mesh toolkit, transitioning from a monolithic architecture to a modular plugin system. This allows developers to install only the capabilities they need, from core orchestration to framework-specific skills.

## Architecture

The plugin ecosystem is organized into 4 tiers:

### Tier 1: Core Foundation
- **ai-mesh-core** (4.0.0) - Essential orchestration, agents, and utilities

### Tier 2: Workflow Plugins
- **ai-mesh-product** - Product management (PRD creation, analysis)
- **ai-mesh-development** - Frontend/backend implementation agents
- **ai-mesh-quality** - Code review, testing, DoD enforcement
- **ai-mesh-infrastructure** - AWS, Kubernetes, Docker, Helm, Fly.io automation
- **ai-mesh-git** - Git workflow and conventional commits
- **ai-mesh-e2e-testing** - Playwright integration for E2E testing
- **ai-mesh-metrics** - Productivity analytics and dashboard

### Tier 3: Framework Skills
- **ai-mesh-react** - React component development
- **ai-mesh-nestjs** - NestJS backend patterns
- **ai-mesh-rails** - Ruby on Rails MVC
- **ai-mesh-phoenix** - Phoenix LiveView patterns
- **ai-mesh-blazor** - Blazor .NET components

### Tier 4: Testing Framework Integration
- **ai-mesh-jest** - Jest testing patterns
- **ai-mesh-pytest** - Pytest testing patterns
- **ai-mesh-rspec** - RSpec testing patterns
- **ai-mesh-xunit** - xUnit testing patterns
- **ai-mesh-exunit** - ExUnit testing patterns

### Utilities
- **ai-mesh-pane-viewer** (0.1.0) - Real-time subagent monitoring in terminal panes

### Meta-Package
- **ai-mesh-full** - Complete ecosystem (all plugins bundled)

## Installation

### Quick Start (Full Ecosystem)

```bash
claude plugin install @fortium/ai-mesh-full
```

### Modular Installation

Install only what you need:

```bash
# Core foundation (required)
claude plugin install @fortium/ai-mesh-core

# Add workflow capabilities
claude plugin install @fortium/ai-mesh-product
claude plugin install @fortium/ai-mesh-development
claude plugin install @fortium/ai-mesh-quality

# Add framework skills (optional)
claude plugin install @fortium/ai-mesh-react
claude plugin install @fortium/ai-mesh-nestjs

# Add testing support (optional)
claude plugin install @fortium/ai-mesh-jest
```

### Installation via NPM

```bash
npm install -g @fortium/ai-mesh-core
```

## Usage

After installation, plugins automatically register their agents, commands, and skills with Claude Code.

### Available Commands

Commands are provided by specific plugins:

- `/create-prd` - Product requirements (ai-mesh-product)
- `/create-trd` - Technical requirements (ai-mesh-core)
- `/implement-trd` - TRD implementation (ai-mesh-development)
- `/fold-prompt` - Project optimization (ai-mesh-core)
- `/dashboard` - Metrics dashboard (ai-mesh-metrics)

### Agent Mesh

Plugins provide specialized agents:

- **Orchestrators**: ai-mesh-orchestrator, tech-lead-orchestrator, product-management-orchestrator
- **Developers**: frontend-developer, backend-developer, infrastructure-developer
- **Quality**: code-reviewer, test-runner, playwright-tester
- **Utilities**: git-workflow, documentation-specialist, file-creator

## Plugin Dependencies

Plugins declare dependencies to ensure compatibility:

```
ai-mesh-react
  └─ ai-mesh-development
      └─ ai-mesh-core
```

Claude Code automatically installs required dependencies when you install a plugin.

## Development

### Repository Structure

```
ai-mesh-plugins/
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
git clone https://github.com/FortiumPartners/ai-mesh-plugins.git
cd ai-mesh-plugins

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
  "name": "ai-mesh-my-plugin",
  "version": "1.0.0",
  "description": "My custom plugin",
  "author": {
    "name": "Your Name",
    "email": "you@example.com"
  },
  "license": "MIT",
  "keywords": ["my-plugin", "ai-mesh"],
  "agents": "./agents",
  "commands": "./commands",
  "skills": "./skills"
}
```

3. Create `packages/my-plugin/package.json`
4. Add agents, commands, and skills
5. Validate: `npm run validate`
6. Test: `npm test`

## Migration from ai-mesh v3.x

If you're migrating from the monolithic ai-mesh v3.x:

1. **Identify current usage**: Review which agents/commands you actively use
2. **Install equivalent plugins**: Map your usage to the new modular plugins
3. **Update references**: Plugin names have changed (e.g., `infrastructure-management-subagent` → `ai-mesh-infrastructure`)
4. **Test workflows**: Verify your development workflows still function

### Migration Guide

| v3.x Component | v4.0 Plugin |
|----------------|-------------|
| ai-mesh-orchestrator | ai-mesh-core |
| product-management-orchestrator | ai-mesh-product |
| frontend-developer | ai-mesh-development |
| backend-developer | ai-mesh-development |
| infrastructure-management-subagent | ai-mesh-infrastructure |
| code-reviewer | ai-mesh-quality |
| test-runner | ai-mesh-quality |
| git-workflow | ai-mesh-git |
| playwright-tester | ai-mesh-e2e-testing |
| manager-dashboard-agent | ai-mesh-metrics |
| ai-mesh-pane-viewer | ai-mesh-pane-viewer (no change) |

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

- **Major**: Breaking changes (e.g., 3.x → 4.0)
- **Minor**: New features, backward compatible (e.g., 4.0 → 4.1)
- **Patch**: Bug fixes, backward compatible (e.g., 4.0.0 → 4.0.1)

Core plugins (Tier 1-2) maintain version synchronization. Framework and testing plugins (Tier 3-4) may have independent versions.

## License

MIT - See [LICENSE](LICENSE) for details.

## Support

- **Documentation**: [https://github.com/FortiumPartners/ai-mesh-plugins](https://github.com/FortiumPartners/ai-mesh-plugins)
- **Issues**: [GitHub Issues](https://github.com/FortiumPartners/ai-mesh-plugins/issues)
- **Discussions**: [GitHub Discussions](https://github.com/FortiumPartners/ai-mesh-plugins/discussions)
- **Email**: support@fortiumpartners.com

## Acknowledgments

Built on the foundation of ai-mesh v3.x, which achieved:
- 35-40% productivity improvements
- 87-99% performance optimization
- 26 specialized agents
- Production validation across multiple teams

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for version history and release notes.

---

**Maintained by Fortium Partners** | [Website](https://fortiumpartners.com) | [GitHub](https://github.com/FortiumPartners)
