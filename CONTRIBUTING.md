# Contributing to Ensemble Plugins

Thank you for considering contributing to the Ensemble Plugins ecosystem! This document provides guidelines and instructions for contributing.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Plugin Development](#plugin-development)
- [Testing](#testing)
- [Documentation](#documentation)
- [PR Flow](#pr-flow)
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
   git remote add upstream https://github.com/Sunstone-Partners/ensemble.git
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
     "repository": "https://github.com/Sunstone-Partners/ensemble",
     "license": "Apache-2.0",
     "keywords": ["my-plugin", "ensemble"],
     "agents": "./agents",
     "commands": "./commands",
     "skills": "./skills"
   }
   ```

3. **Create package.json** (`packages/my-plugin/package.json`):
   ```json
   {
     "name": "@sunstone-partners/ensemble-my-plugin",
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
     "license": "Apache-2.0",
     "repository": {
       "type": "git",
       "url": "https://github.com/Sunstone-Partners/ensemble.git",
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

The YAML file is the only file you edit:

1. **YAML definition** (`my-command.yaml`) — the source of truth:
   ```yaml
   name: my-command
   description: Command description
   agent: my-agent
   ```

2. **Markdown** (`my-command.md`) — **generated, never hand-edited.** Carries a
   `<!-- DO NOT EDIT -->` header; edits are overwritten on the next generate.

Agent markdown (`agents/*.md`) is generated from `agents/*.yaml` the same way.

**After changing any `.yaml` under `agents/` or `commands/`, regenerate and commit
the result:**

```bash
npm run generate            # rewrites the .md files from YAML
npm run generate -- --dry-run   # preview without writing
```

CI fails the PR if a generated `.md` does not match its YAML source.

### Versioning a Plugin

Every package carries its version in **three** places that must always match:

| File | Read by |
|------|---------|
| `packages/<name>/package.json` | npm |
| `packages/<name>/.claude-plugin/plugin.json` | the Claude Code plugin installer |
| `marketplace.json` (that plugin's entry) | the marketplace catalog |

Bump all three together. `plugin.json` is the one that matters most: `claude plugin
install/update` gates on its version *string*, not on content or commit hash. If it
lags behind a real change, consumers who already installed that version string never
re-sync — they silently keep running stale plugin content with no error.

`npm run validate` fails on any mismatch.

### Skill Development

Skills provide context-specific knowledge:

1. **SKILL.md**: Quick reference (target: <25KB)
2. **REFERENCE.md**: Comprehensive guide

### Skill Format

Skills follow the [Agent Skills specification](https://agentskills.io/specification):

- One skill is one directory, `packages/<pkg>/skills/<name>/SKILL.md`, and the directory name must equal the `name` in the frontmatter (lowercase letters, digits and hyphens).
- Frontmatter may only use `name`, `description` (max 1024 characters), `license`, `compatibility`, `metadata` and `allowed-tools`. Put a version in `metadata.version` (a quoted string), not a top-level `version:`.
- Keep `SKILL.md` under 500 lines; move detail into `REFERENCE.md` or other files in the skill directory.
- Run `npm run validate:skills` before opening a PR (it also runs as part of `npm run validate`). It checks the source skills and the generated pi and codex output, so regenerate first if you changed a skill.

One exemption: skills whose directory name starts with `ensemble-` may carry the host keys `user-invocable`, `disable-model-invocation`, `argument-hint`, `model` and `capabilities` at the top level. The generators emit these command-wrapper skills with such keys, and Claude Code reads `ensemble-assess` straight from the plugin directory, where the keys must stay top-level to hide it from the slash menu. Any other skill using them fails the gate.

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

### Prompt Tests

Do not write tests that pin prompt wording (`toContain`/`toMatch` on command, agent or SKILL text).
Test CLI/parser behavior, assert machine contracts structurally, and use `evals/` for model behavior.
Existing wording pins and their rewrite targets are inventoried in [docs/guides/prompt-testing.md](docs/guides/prompt-testing.md).

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
- **License**: Apache-2.0 license statement

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

## PR Flow

- **Size**: aim for fewer than ~400 changed hand-written lines. Generated output does not count: `packages/pi|codex|opencode/**`, generated command/agent `.md` files (those with a sibling `.yaml` source), `**/bundle/**`, lockfiles, `.beads/**` and `*.min.js`. `scripts/pr-size.js` posts an advisory warning when a PR is over; it never blocks.
- **New component** (package, plugin, hook, guard): its own PR with its own review bar, never bundled into a refactor or audit PR.
- **Stack small PRs** and merge each as it lands ([stacked PRs guide](docs/guides/stacked-prs.md)).
- **Short-lived branches**: when the base moves (a consolidation or version bump lands), merge or rebase `origin/dev` the same day rather than redoing work later.
- **Definition of done**: the required checks (`validate`, `test (22)`, `test (24)`) are green and the `pr-review-cycle` stopping rule is met. Blocking findings are only a proven break of a default-on control, data loss, or a failed required check; opt-in and best-effort findings become beads, not another review round.
- **Before pushing**: when available, run `npm run ci:local` (clean-clone CI parity) so Linux-only failures show up locally; otherwise run the full `npm run validate` and test suites.
- **Consumer check** before removing or renaming a command, skill, agent or CLI flag: search consumers in sibling repos and in the `packages/pi`, `packages/codex` and `packages/opencode` outputs (for example, Foreman invokes `/ensemble:create-trd-foreman`). Leave a thin deprecated shim for one release unless the consumer change merges in the same window.

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
- **Issues**: Search [GitHub Issues](https://github.com/Sunstone-Partners/ensemble/issues)
- **Discussions**: Ask in [GitHub Discussions](https://github.com/Sunstone-Partners/ensemble/discussions)
- **Email**: info@sunstonepartners.com

## License

By contributing, you agree that your contributions will be licensed under the Apache License 2.0.
