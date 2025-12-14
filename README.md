# Ensemble Plugins

Modular plugin ecosystem for Claude Code, enabling flexible, pay-what-you-need AI-augmented development workflows.

## Overview

Ensemble Plugins is the v4.0.0 evolution of the ensemble toolkit, transitioning from a monolithic architecture to a modular plugin system. This allows developers to install only the capabilities they need, from core orchestration to framework-specific skills.

## Architecture

The plugin ecosystem is organized into 4 tiers:

### Tier 1: Core Foundation
- **ensemble-core** (4.0.0) - Essential orchestration, agents, and utilities

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
- **ensemble-pane-viewer** (0.1.0) - Real-time subagent monitoring in terminal panes

### Meta-Package
- **ensemble-full** - Complete ecosystem (all plugins bundled)

## Installation

### Quick Start (Full Ecosystem)

```bash
claude plugin install @fortium/ensemble-full
```

### Modular Installation

Install only what you need:

```bash
# Core foundation (required)
claude plugin install @fortium/ensemble-core

# Add workflow capabilities
claude plugin install @fortium/ensemble-product
claude plugin install @fortium/ensemble-development
claude plugin install @fortium/ensemble-quality

# Add framework skills (optional)
claude plugin install @fortium/ensemble-react
claude plugin install @fortium/ensemble-nestjs

# Add testing support (optional)
claude plugin install @fortium/ensemble-jest
```

### Installation via NPM

```bash
npm install -g @fortium/ensemble-core
```

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

Plugins provide specialized agents:

- **Orchestrators**: ensemble-orchestrator, tech-lead-orchestrator, product-management-orchestrator
- **Developers**: frontend-developer, backend-developer, infrastructure-developer
- **Quality**: code-reviewer, test-runner, playwright-tester
- **Utilities**: git-workflow, documentation-specialist, file-creator

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

## Migration from ensemble v3.x

If you're migrating from the monolithic ensemble v3.x:

1. **Identify current usage**: Review which agents/commands you actively use
2. **Install equivalent plugins**: Map your usage to the new modular plugins
3. **Update references**: Plugin names have changed (e.g., `infrastructure-management-subagent` → `ensemble-infrastructure`)
4. **Test workflows**: Verify your development workflows still function

### Migration Guide

| v3.x Component | v4.0 Plugin |
|----------------|-------------|
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
| ensemble-pane-viewer | ensemble-pane-viewer (no change) |

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

- **Documentation**: [https://github.com/FortiumPartners/ensemble](https://github.com/FortiumPartners/ensemble)
- **Issues**: [GitHub Issues](https://github.com/FortiumPartners/ensemble/issues)
- **Discussions**: [GitHub Discussions](https://github.com/FortiumPartners/ensemble/discussions)
- **Email**: support@fortiumpartners.com

## Acknowledgments

Built on the foundation of ensemble v3.x, which achieved:
- 35-40% productivity improvements
- 87-99% performance optimization
- 26 specialized agents
- Production validation across multiple teams

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for version history and release notes.

---

**Maintained by Fortium Partners** | [Website](https://fortiumpartners.com) | [GitHub](https://github.com/FortiumPartners)
