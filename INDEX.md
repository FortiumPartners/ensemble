# Ensemble Plugins Monorepo - Complete File Index

## Root Directory

```
<project-root>/ensemble/
```

### Configuration Files
- `package.json` - NPM workspace configuration (820 bytes)
- `marketplace.json` - Plugin registry (1.0 KB)
- `.gitignore` - Git ignore patterns (72 bytes)
- `.npmrc` - NPM configuration (35 bytes)
- `LICENSE` - MIT license (1.0 KB)

### Documentation Files (Total: 34.8 KB)
- `README.md` - Main documentation (7.3 KB)
- `CHANGELOG.md` - Version history (4.9 KB)
- `CONTRIBUTING.md` - Contributor guidelines (8.2 KB)
- `SETUP_SUMMARY.md` - Setup details (8.0 KB)
- `QUICKSTART.md` - Quick start guide (6.4 KB)
- `INDEX.md` - This file

### Validation & Testing
- `verify-structure.sh` - Structure verification script (executable)

## Schemas Directory

```
schemas/
├── plugin-schema.json          # Plugin manifest validation
└── marketplace-schema.json     # Marketplace validation
```

## GitHub Workflows

```
.github/workflows/
├── validate.yml               # Plugin validation workflow
├── test.yml                   # Multi-version testing (Node 18, 20, 22)
└── release.yml                # Automated release on tags
```

## Automation Scripts

```
scripts/
├── validate-all.js            # Complete plugin validation
└── publish-plugin.js          # Selective plugin publishing
```

## Package Structure

All 20 packages follow this identical structure:

```
packages/<plugin-name>/
├── .claude-plugin/
│   └── plugin.json           # Plugin manifest
├── agents/
│   └── .gitkeep              # Placeholder for agent YAML files
├── commands/
│   └── .gitkeep              # Placeholder for command files
├── skills/
│   └── .gitkeep              # Placeholder for skill documentation
├── lib/
│   └── .gitkeep              # Placeholder for shared utilities
├── tests/
│   └── .gitkeep              # Placeholder for unit tests
├── package.json              # NPM package configuration
├── README.md                 # Plugin documentation
└── CHANGELOG.md              # Version history
```

## Complete Package Listing

### Tier 1: Core Foundation

#### packages/core/
- **NPM Name**: @fortium/ensemble-core
- **Version**: 4.0.0
- **Description**: Core orchestration and utilities
- **Dependencies**: None (foundation)

### Tier 2: Workflow Plugins

#### packages/product/
- **NPM Name**: @fortium/ensemble-product
- **Version**: 4.0.0
- **Description**: Product management agents and workflows
- **Dependencies**: ensemble-core@4.0.0

#### packages/development/
- **NPM Name**: @fortium/ensemble-development
- **Version**: 4.0.0
- **Description**: Development agents for frontend/backend
- **Dependencies**: ensemble-core@4.0.0

#### packages/quality/
- **NPM Name**: @fortium/ensemble-quality
- **Version**: 4.0.0
- **Description**: Quality assurance, code review, DoD
- **Dependencies**: ensemble-core@4.0.0

#### packages/infrastructure/
- **NPM Name**: @fortium/ensemble-infrastructure
- **Version**: 4.0.0
- **Description**: Infrastructure automation (AWS/K8s/Docker/Helm/Fly.io)
- **Dependencies**: ensemble-core@4.0.0

#### packages/git/
- **NPM Name**: @fortium/ensemble-git
- **Version**: 4.0.0
- **Description**: Git workflow automation
- **Dependencies**: ensemble-core@4.0.0

#### packages/e2e-testing/
- **NPM Name**: @fortium/ensemble-e2e-testing
- **Version**: 4.0.0
- **Description**: Playwright E2E testing integration
- **Dependencies**: ensemble-core@4.0.0

#### packages/metrics/
- **NPM Name**: @fortium/ensemble-metrics
- **Version**: 4.0.0
- **Description**: Productivity analytics dashboard
- **Dependencies**: ensemble-core@4.0.0

### Tier 3: Framework Skills

#### packages/react/
- **NPM Name**: @fortium/ensemble-react
- **Version**: 4.0.0
- **Description**: React framework skills
- **Dependencies**: ensemble-development@4.0.0

#### packages/nestjs/
- **NPM Name**: @fortium/ensemble-nestjs
- **Version**: 4.0.0
- **Description**: NestJS backend framework skills
- **Dependencies**: ensemble-development@4.0.0

#### packages/rails/
- **NPM Name**: @fortium/ensemble-rails
- **Version**: 4.0.0
- **Description**: Ruby on Rails backend skills
- **Dependencies**: ensemble-development@4.0.0

#### packages/phoenix/
- **NPM Name**: @fortium/ensemble-phoenix
- **Version**: 4.0.0
- **Description**: Phoenix LiveView framework skills
- **Dependencies**: ensemble-development@4.0.0

#### packages/blazor/
- **NPM Name**: @fortium/ensemble-blazor
- **Version**: 4.0.0
- **Description**: Blazor .NET framework skills
- **Dependencies**: ensemble-development@4.0.0

### Tier 4: Testing Framework Integration

#### packages/jest/
- **NPM Name**: @fortium/ensemble-jest
- **Version**: 4.0.0
- **Description**: Jest testing framework
- **Dependencies**: ensemble-quality@4.0.0

#### packages/pytest/
- **NPM Name**: @fortium/ensemble-pytest
- **Version**: 4.0.0
- **Description**: Pytest testing framework
- **Dependencies**: ensemble-quality@4.0.0

#### packages/rspec/
- **NPM Name**: @fortium/ensemble-rspec
- **Version**: 4.0.0
- **Description**: RSpec testing framework
- **Dependencies**: ensemble-quality@4.0.0

#### packages/xunit/
- **NPM Name**: @fortium/ensemble-xunit
- **Version**: 4.0.0
- **Description**: xUnit testing framework (.NET)
- **Dependencies**: ensemble-quality@4.0.0

#### packages/exunit/
- **NPM Name**: @fortium/ensemble-exunit
- **Version**: 4.0.0
- **Description**: ExUnit testing framework (Elixir)
- **Dependencies**: ensemble-quality@4.0.0

### Utilities

#### packages/pane-viewer/
- **NPM Name**: @fortium/ensemble-pane-viewer
- **Version**: 0.1.0
- **Description**: Real-time subagent monitoring
- **Dependencies**: None (standalone)

### Meta-Package

#### packages/full/
- **NPM Name**: @fortium/ensemble-full
- **Version**: 4.0.0
- **Description**: Complete ecosystem (all plugins)
- **Dependencies**: All 19 other plugins

## File Statistics Summary

```
Total Files:                    197
├── Root configuration:          11
├── Schemas:                      2
├── GitHub workflows:             3
├── Scripts:                      2
├── Package manifests:           80 (4 per package × 20)
└── Placeholders:               100 (5 per package × 20)

Total Size:                   ~100 KB
├── Documentation:            34.8 KB
├── Configuration:            10 KB
├── Manifests:               40 KB
└── Schemas/Scripts:         15 KB
```

## Dependency Tree

```
ensemble-full (meta)
├── ensemble-core
├── ensemble-product
│   └── ensemble-core
├── ensemble-development
│   └── ensemble-core
├── ensemble-quality
│   └── ensemble-core
├── ensemble-infrastructure
│   └── ensemble-core
├── ensemble-git
│   └── ensemble-core
├── ensemble-e2e-testing
│   └── ensemble-core
├── ensemble-metrics
│   └── ensemble-core
├── ensemble-react
│   └── ensemble-development
│       └── ensemble-core
├── ensemble-nestjs
│   └── ensemble-development
│       └── ensemble-core
├── ensemble-rails
│   └── ensemble-development
│       └── ensemble-core
├── ensemble-phoenix
│   └── ensemble-development
│       └── ensemble-core
├── ensemble-blazor
│   └── ensemble-development
│       └── ensemble-core
├── ensemble-jest
│   └── ensemble-quality
│       └── ensemble-core
├── ensemble-pytest
│   └── ensemble-quality
│       └── ensemble-core
├── ensemble-rspec
│   └── ensemble-quality
│       └── ensemble-core
├── ensemble-xunit
│   └── ensemble-quality
│       └── ensemble-core
├── ensemble-exunit
│   └── ensemble-quality
│       └── ensemble-core
└── ensemble-pane-viewer (standalone)
```

## Next Steps Reference

See `QUICKSTART.md` for:
- Installation instructions
- Validation procedures
- Plugin extraction guidance
- Testing strategies
- Commit workflow

See `SETUP_SUMMARY.md` for:
- Detailed structure breakdown
- Created files checklist
- Validation checklist
- Migration from v3.x

See `CONTRIBUTING.md` for:
- Development workflow
- Plugin creation guide
- Testing requirements
- PR submission process

## Repository Information

- **Location**: /Users/ldangelo/Development/Fortium/ensemble
- **Status**: Structure complete, ready for plugin extraction
- **Version**: 4.0.0 (all core/workflow/framework/testing plugins)
- **License**: MIT
- **Created**: December 9, 2025

---

**Index Last Updated**: December 9, 2025
