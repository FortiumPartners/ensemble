# Ensemble Plugins

Modular plugin ecosystem for Claude Code, enabling flexible, pay-what-you-need AI-augmented development workflows.

![The Spec-Driven Factory: Ensemble Plugin Ecosystem](docs/images/ensemble-architecture.png)

## Model Tier Selection

Command sources declare an abstract tier (`high`/`medium`/`low`) in their YAML
`metadata.model`. At generation time these map to Claude Code's portable model
aliases, which resolve per-provider at runtime (Anthropic API, Bedrock, Vertex)
and auto-forward as new model versions ship:

| Tier | Claude Code alias | Typical Use |
|------|-------------------|-------------|
| `high` | `opus` | Strategic reasoning, architecture, security review |
| `medium` | `sonnet` | Implementation, documentation, testing |
| `low` | `haiku` | Lightweight retrieval, file watching |

Because commands ship portable aliases instead of pinned model IDs, there is no
per-project model config to maintain — the same commands work on every backend.

## Overview

Ensemble Plugins v5.0.0 provides a modular plugin system for Claude Code, allowing developers to install only the capabilities they need—from core orchestration to framework-specific skills.

## Framework Comparison & Selection

Comparing Ensemble to other AI-driven development frameworks? See our comprehensive analysis:

- **[Ensemble vs. Spec-Kit](docs/comparison-other-frameworks.md)** — Quick reference table and detailed analysis of orchestration models, requirement traceability, task persistence, constitutional governance, runtime compatibility, and decision framework for choosing between the two.

- **[Ensemble vs. BMAD vs. Spec-Kit](docs/comparison-bmad.md)** — Three-way analysis covering scale-adaptive planning, agent specialization, documentation-first approaches, persistent task state, and migration paths between all three frameworks.

**TL;DR:** Choose Ensemble for persistent cross-session task state and deep requirement traceability; choose BMAD for scale-adaptive planning and lightweight core; choose Spec-Kit for 30+ runtime support and hard-enforced constitutional governance.

---

## Ensemble/Foreman Ownership Boundary

Ensemble is the portable behavior-definition, packaging, validation, and local
agent-harness project. It describes, validates, packages, simulates, and
locally runs behavior — it does not activate, govern, schedule, execute,
recover, or audit production behavior. That is Foreman's job, in a separate
repository:

```text
Ensemble = describe, validate, package, simulate, and locally run behavior
Foreman  = activate, govern, schedule, execute, recover, and audit production behavior
Pi/OMP   = provide the agent loop and invocation substrate
```

Ensemble explicitly does **not** own: durable production event ingestion,
durable activation decisions, deduplication leases or cooldown state,
production retries/recovery/execution scheduling, durable causal history,
approval enforcement for production mutations, or a second dispatcher
competing with Foreman.

This repository also contains an existing Elixir activation runner
(`packages/core`). **That runner is not a Pi/OMP adapter** and must not be
treated as the local agent-harness integration point; the Pi/OMP-facing
integration is implemented as a TypeScript Pi extension
(`packages/pi-extension`).



## Architecture

The plugin ecosystem is organized into 4 tiers; see the [wiki Architecture page](https://github.com/Sunstone-Partners/ensemble/wiki/02-Architecture) for the complete, current package count and dependency graph. Representative packages per tier:

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
- **ensemble-dotnet** - Broader .NET / ASP.NET Core skills

### Tier 4: Testing Framework Integration
- **ensemble-jest** - Jest testing patterns
- **ensemble-pytest** - Pytest testing patterns
- **ensemble-rspec** - RSpec testing patterns
- **ensemble-xunit** - xUnit testing patterns
- **ensemble-exunit** - ExUnit testing patterns
- **ensemble-reqnroll** - Reqnroll BDD step definitions

### Utilities
- **ensemble-permitter** - Permission-expansion hook with allowlist (opt-out via `ENSEMBLE_PERMITTER_DISABLE=1`)
- **ensemble-multiplexer-adapters** - Terminal multiplexer abstraction layer
- **ensemble-ai** - AI SDK skills for OpenAI, Anthropic, Perplexity, and Weaviate
- **ensemble-assessment** - Repository, team, and AI-readiness assessment and diagnostic reporting

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
/plugin marketplace add Sunstone-Partners/ensemble

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
git clone https://github.com/Sunstone-Partners/ensemble.git

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

Ensemble ships 48 slash-commands across six packages; this is a representative sample — see the [wiki Commands Reference](https://github.com/Sunstone-Partners/ensemble/wiki/07-Commands) for the full list.

- `/ensemble:feature` - Canonical front door for the feature lifecycle: `new`/`resume`/`status`/`abandon` (ensemble-development)
- `/ensemble:issue` - Canonical front door for issue work: `fix`/`list`/`resume`/`status`/`abandon` (ensemble-development)
- `/ensemble:prd` - Canonical front door for PRD authoring: `create`/`create-meeting`/`refine`/`refine-meeting` (ensemble-product)
- `/ensemble:trd` - Canonical front door for TRD authoring, analysis, and implementation (ensemble-development)
- `/ensemble:implement-trd-beads` - Beads-backed TRD implementation; accepts multiple TRD paths for combined workstream mode with a release train bead, one TRD epic per source TRD, cross-TRD dependency edges, and `bv --robot-*` validation (ensemble-development)
- `/ensemble:refine-beads` - Approval-gated Beads graph refinement before execution; detects hierarchy/dependency/traceability/PR-boundary gaps, proposes `br` repairs, and validates with `bv --robot-*` (ensemble-development)
- `/ensemble:fold-prompt` - Project optimization (ensemble-core)
- `/ensemble:manager-dashboard` - Metrics dashboard (ensemble-metrics)

### Collaborative Refinement Review

The `ensemble:refine-prd` and `ensemble:refine-trd` commands accept a
`--collab` flag that replaces the terminal AskUserQuestion interview
with a browser-based HTML review. Each refinement question renders in
a sidebar with anchor-linked comments; reviewers can answer the
question, select an option from a 2–5 item menu, and leave per-line
comments against the PRD/TRD document. The session produces an
artifact (`.response.json`) that the Enhancement phase reads directly.

```bash
# Local-only review (reviewer on same machine)
/ensemble:refine-prd --collab docs/PRD/PRD-2026-019.md

# Remote review over Cloudflare Quick Tunnel — no account, no DNS, no token
/ensemble:refine-prd --collab --tunnel=quick docs/PRD/PRD-2026-019.md
```

`--tunnel=quick` requires the [`cloudflared`](https://github.com/cloudflare/cloudflared)
binary on `PATH` (or set `CLOUDFLARED_PATH` to its absolute path). It
launches a `*.trycloudflare.com` QuickTunnel after the local server
binds, re-mints the share-nonce against the tunnel origin, and tears
down the tunnel on exit. The share URL has the shape
`<origin>/api/exchange?nonce=<id>` — the bearer token never appears
in the URL.

The session is iterative: completed sessions can be re-launched with
`--collab` against the same PRD path to revisit the prior answers,
comments, and revision history. To start over, delete the session
file under `~/.config/ensemble/logs/refinement-review/`.

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

Local `file://` installs load command definitions from the source YAML when
`dist/opencode/opencode.json` has not been generated yet. Commands are exposed
with both namespaced and plain aliases, so `/ensemble:create-prd` and
`/create-prd` both resolve to the PRD workflow.

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

## Multi-TRD Beads Workstreams

`/ensemble:implement-trd-beads` can scaffold and execute related TRDs as one graph-aware workstream without merging the source documents.

```bash
# Plan/scaffold — branch intent resolved automatically from TRD slug or explicit flag
# --use-current-branch: work on the current branch (no new branch created)
/ensemble:implement-trd-beads docs/TRD/TRD-2026-001-api.md docs/TRD/TRD-2026-002-ui.md --plan --use-current-branch

# Execute an existing scaffold
/ensemble:implement-trd-beads docs/TRD/TRD-2026-001-api.md docs/TRD/TRD-2026-002-ui.md --execute --use-current-branch

# Inspect combined status
/ensemble:implement-trd-beads docs/TRD/TRD-2026-001-api.md docs/TRD/TRD-2026-002-ui.md --status
```

> **Note:** `--branch=<name>` and `--use-current-branch` are mutually exclusive. `--branch=<name>` requires the branch to already exist (switches to it with `git switch`); `--use-current-branch` works on the currently checked-out branch. When neither flag is provided, the workflow (1) auto-detects a matching local branch by TRD slug, (2) reads saved branch intent from the TRD's frontmatter (`ensemble_implement_trd_beads: {branch_name, use_proposed, stacked_prs}`) if auto-detect found no single match, then (3) falls back to pr-plan's proposed branch. Priority: explicit flags > auto-detect > saved frontmatter > pr-plan. If exactly one local branch matches the slug, it is reused automatically. If multiple local branches match, a warning is printed and the workflow falls through to saved-frontmatter or normal branch-intent handling. Saved choices are written back to the TRD frontmatter after confirmation, so subsequent runs reuse the same branch and PR topology without re-prompting. CLI flags always override all other sources.

Behavior:

- one TRD path keeps existing single-TRD behavior;
- two or more TRD paths enable combined workstream mode;
- all TRDs are validated before side effects;
- Beads get one release train parent plus one root epic per TRD;
- each TRD's PR/story/task hierarchy stays under its own epic;
- cross-TRD dependencies use `<trd-slug>#TRD-NNN` or `<trd-slug>#PR-N`;
- graph checks use `bv --robot-*` only and prompt before ambiguous/cyclic dependency changes.

See `packages/development/README.md` for the user-facing command details.

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
git clone https://github.com/Sunstone-Partners/ensemble.git
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

Every plugin is versioned independently. `claude plugin install` and
`claude plugin update` gate on the plugin's own `.claude-plugin/plugin.json`
version string, so a package whose version does not move never re-syncs on a
consuming machine — which makes a per-package bump the mechanism that actually
ships a change, and a repo-wide lockstep bump pure churn for every plugin that
did not change.

What `npm run validate` enforces is that each package agrees with *itself*:
`packages/<name>/package.json`, `packages/<name>/.claude-plugin/plugin.json`,
and that package's `marketplace.json` entry must carry the same version
(`scripts/validate-version-sync.js`). Drift there is invisible and breaks
installs. The one exception is the release set — root `package.json`,
`packages/full/`, and the `ensemble-full` marketplace entry — which must match
each other before tagging.

When you change a package, bump that package. Nothing requires two different
packages to share a number.

## License

MIT - See [LICENSE](LICENSE) for details.

## Support

- **Documentation**: [https://github.com/Sunstone-Partners/ensemble](https://github.com/Sunstone-Partners/ensemble)
- **Issues**: [GitHub Issues](https://github.com/Sunstone-Partners/ensemble/issues)
- **Discussions**: [GitHub Discussions](https://github.com/Sunstone-Partners/ensemble/discussions)
- **Email**: info@sunstonepartners.com

## Acknowledgments

Built on the foundation of previous ensemble versions, which achieved:
- 35-40% productivity improvements
- 87-99% performance optimization
- 28 specialized agents (v5.0)
- Production validation across multiple teams

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for version history and release notes.

---

**Maintained by Sunstone Partners** | [Website](https://sunstonepartners.com) | [GitHub](https://github.com/Sunstone-Partners)
