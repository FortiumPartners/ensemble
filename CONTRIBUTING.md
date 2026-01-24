# Contributing to Ensemble Plugins

Thank you for considering contributing to the Ensemble Plugins ecosystem! This document provides guidelines and instructions for contributing.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Plugin Development](#plugin-development)
- [Testing](#testing)
- [Documentation](#documentation)
- [Submitting Changes](#submitting-changes)
- [Release Process](#release-process)

## Code of Conduct

This project adheres to a code of conduct that promotes a welcoming and inclusive environment. By participating, you agree to:

- Use welcoming and inclusive language
- Be respectful of differing viewpoints and experiences
- Accept constructive criticism gracefully
- Focus on what is best for the community
- Show empathy towards other community members

## Getting Started

### Prerequisites

- **Node.js**: 18.x or higher
- **npm**: 9.x or higher
- **Git**: Latest stable version
- **Claude Code**: For testing plugin integration

### Fork and Clone

1. Fork the repository on GitHub
2. Clone your fork locally:
   ```bash
   git clone https://github.com/YOUR_USERNAME/ensemble.git
   cd ensemble
   ```

3. Add upstream remote:
   ```bash
   git remote add upstream https://github.com/FortiumPartners/ensemble.git
   ```

4. Install dependencies:
   ```bash
   npm install
   ```

### Verify Setup

Run validation and tests to ensure everything works:

```bash
npm run validate
npm test
```

## Development Workflow

### Branch Strategy

- **main**: Stable releases only
- **develop**: Integration branch for features
- **feature/**: Individual feature branches (e.g., `feature/add-vue-plugin`)
- **fix/**: Bug fix branches (e.g., `fix/core-orchestration-bug`)

### Creating a Branch

```bash
git checkout -b feature/your-feature-name
```

### Keeping Up to Date

Regularly sync with upstream:

```bash
git fetch upstream
git rebase upstream/main
```

## Plugin Development

### Creating a New Plugin

1. **Create directory structure**:
   ```bash
   mkdir -p packages/my-plugin/{.claude-plugin,agents,commands,skills,lib,tests}
   ```

2. **Create plugin.json** (`packages/my-plugin/.claude-plugin/plugin.json`):
   ```json
   {
     "name": "ensemble-my-plugin",
     "version": "1.0.0",
     "description": "Description of your plugin",
     "author": {
       "name": "Your Name",
       "email": "you@example.com",
       "url": "https://github.com/yourname"
     },
     "repository": "https://github.com/FortiumPartners/ensemble",
     "license": "MIT",
     "keywords": ["my-plugin", "ensemble"],
     "agents": "./agents",
     "commands": "./commands",
     "skills": "./skills"
   }
   ```

3. **Create package.json** (`packages/my-plugin/package.json`):
   ```json
   {
     "name": "@fortium/ensemble-my-plugin",
     "version": "1.0.0",
     "description": "Description of your plugin",
     "main": "lib/index.js",
     "scripts": {
       "test": "jest",
       "test:coverage": "jest --coverage",
       "lint": "eslint ."
     },
     "keywords": ["my-plugin", "ensemble"],
     "author": "Your Name",
     "license": "MIT",
     "repository": {
       "type": "git",
       "url": "https://github.com/FortiumPartners/ensemble.git",
       "directory": "packages/my-plugin"
     },
     "devDependencies": {
       "jest": "^29.7.0"
     }
   }
   ```

4. **Create README.md and CHANGELOG.md**
5. **Add .gitkeep files** to empty directories
6. **Validate**:
   ```bash
   npm run validate
   ```

### Plugin Structure

Each plugin should follow this structure:

```
my-plugin/
├── .claude-plugin/
│   └── plugin.json          # Plugin manifest
├── agents/                  # Agent YAML definitions
│   └── my-agent.yaml
├── commands/                # Command implementations
│   ├── my-command.yaml
│   ├── my-command.md
│   └── my-command.txt
├── skills/                  # Skill documentation
│   ├── SKILL.md
│   └── REFERENCE.md
├── lib/                     # Shared utilities
│   └── index.js
├── tests/                   # Unit tests
│   └── my-plugin.test.js
├── package.json
├── README.md
└── CHANGELOG.md
```

### Agent Development

Agents are defined in YAML format:

```yaml
---
name: my-agent
description: Clear mission statement
tools: [Read, Edit, Bash]
---

## Mission
Specific expertise and responsibility

## Behavior
- Key behavior 1
- Key behavior 2
- Handoff protocols
```

### Command Development

Commands have three files:

1. **YAML definition** (`my-command.yaml`):
   ```yaml
   name: my-command
   description: Command description
   agent: my-agent
   ```

2. **Markdown documentation** (`my-command.md`)
3. **Plain text variant** (`my-command.txt`)

### Skill Development

Skills provide context-specific knowledge:

1. **SKILL.md**: Quick reference (target: <25KB)
2. **REFERENCE.md**: Comprehensive guide

## Testing

### Running Tests

```bash
# All tests
npm test

# Specific plugin
npm test --workspace=packages/my-plugin

# Coverage
npm run test:coverage
```

### Writing Tests

Create tests in `packages/my-plugin/tests/`:

```javascript
describe('MyPlugin', () => {
  it('should validate plugin.json', () => {
    const pluginJson = require('../.claude-plugin/plugin.json');
    expect(pluginJson.name).toBe('ensemble-my-plugin');
  });

  it('should have required directories', () => {
    const fs = require('fs');
    expect(fs.existsSync('agents')).toBe(true);
    expect(fs.existsSync('commands')).toBe(true);
  });
});
```

### Validation

All plugins must pass validation:

```bash
npm run validate
```

This checks:
- plugin.json schema compliance
- package.json consistency
- YAML syntax in agents
- Dependency declarations

## Documentation

### README.md Requirements

Each plugin README should include:

- **Description**: Clear explanation of purpose
- **Installation**: How to install the plugin
- **Features**: Key capabilities
- **Usage**: Examples of using agents/commands
- **License**: MIT license statement

### CHANGELOG.md Requirements

Follow [Keep a Changelog](https://keepachangelog.com/) format:

```markdown
## [1.0.0] - 2025-12-09

### Added
- Initial plugin creation
- Core agent implementation

### Changed
- N/A

### Fixed
- N/A
```

### Inline Documentation

- **Agent YAML**: Clear mission and behavior sections
- **Skills**: Comprehensive examples and patterns
- **Commands**: Usage examples in markdown

## Submitting Changes

### Pull Request Process

1. **Update your branch**:
   ```bash
   git fetch upstream
   git rebase upstream/main
   ```

2. **Run validation**:
   ```bash
   npm run validate
   npm test
   ```

3. **Commit with conventional commits**:
   ```bash
   git commit -m "feat(my-plugin): add new feature"
   ```

   Types: `feat`, `fix`, `docs`, `test`, `chore`, `refactor`

4. **Push to your fork**:
   ```bash
   git push origin feature/your-feature-name
   ```

5. **Create Pull Request** on GitHub

### PR Requirements

- [ ] All tests pass
- [ ] Validation succeeds
- [ ] Documentation updated
- [ ] CHANGELOG.md updated
- [ ] Conventional commit messages
- [ ] No merge conflicts

### Review Process

- PRs require at least one approval from maintainers
- CI must pass (validation + tests)
- Documentation must be complete
- Changes must be backward compatible (or clearly marked as breaking)

## Release Process

### Version Bumping

Follow semantic versioning:

- **Major** (x.0.0): Breaking changes
- **Minor** (x.y.0): New features, backward compatible
- **Patch** (x.y.z): Bug fixes

### Creating a Release

Maintainers only:

1. Update version in `package.json` and `plugin.json`
2. Update `CHANGELOG.md`
3. Commit: `chore(release): bump version to x.y.z`
4. Create tag: `git tag vx.y.z`
5. Push: `git push --tags`
6. GitHub Actions will create release

## Questions?

- **Documentation**: Check the [README.md](README.md)
- **Issues**: Search [GitHub Issues](https://github.com/FortiumPartners/ensemble/issues)
- **Discussions**: Ask in [GitHub Discussions](https://github.com/FortiumPartners/ensemble/discussions)
- **Email**: support@fortiumpartners.com

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
