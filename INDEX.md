# AI Mesh Plugins Monorepo - Complete File Index

## Root Directory

```
/Users/ldangelo/Development/Fortium/ai-mesh-plugins/
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
- **NPM Name**: @fortium/ai-mesh-core
- **Version**: 4.0.0
- **Description**: Core orchestration and utilities
- **Dependencies**: None (foundation)

### Tier 2: Workflow Plugins

#### packages/product/
- **NPM Name**: @fortium/ai-mesh-product
- **Version**: 4.0.0
- **Description**: Product management agents and workflows
- **Dependencies**: ai-mesh-core@4.0.0

#### packages/development/
- **NPM Name**: @fortium/ai-mesh-development
- **Version**: 4.0.0
- **Description**: Development agents for frontend/backend
- **Dependencies**: ai-mesh-core@4.0.0

#### packages/quality/
- **NPM Name**: @fortium/ai-mesh-quality
- **Version**: 4.0.0
- **Description**: Quality assurance, code review, DoD
- **Dependencies**: ai-mesh-core@4.0.0

#### packages/infrastructure/
- **NPM Name**: @fortium/ai-mesh-infrastructure
- **Version**: 4.0.0
- **Description**: Infrastructure automation (AWS/K8s/Docker/Helm/Fly.io)
- **Dependencies**: ai-mesh-core@4.0.0

#### packages/git/
- **NPM Name**: @fortium/ai-mesh-git
- **Version**: 4.0.0
- **Description**: Git workflow automation
- **Dependencies**: ai-mesh-core@4.0.0

#### packages/e2e-testing/
- **NPM Name**: @fortium/ai-mesh-e2e-testing
- **Version**: 4.0.0
- **Description**: Playwright E2E testing integration
- **Dependencies**: ai-mesh-core@4.0.0

#### packages/metrics/
- **NPM Name**: @fortium/ai-mesh-metrics
- **Version**: 4.0.0
- **Description**: Productivity analytics dashboard
- **Dependencies**: ai-mesh-core@4.0.0

### Tier 3: Framework Skills

#### packages/react/
- **NPM Name**: @fortium/ai-mesh-react
- **Version**: 4.0.0
- **Description**: React framework skills
- **Dependencies**: ai-mesh-development@4.0.0

#### packages/nestjs/
- **NPM Name**: @fortium/ai-mesh-nestjs
- **Version**: 4.0.0
- **Description**: NestJS backend framework skills
- **Dependencies**: ai-mesh-development@4.0.0

#### packages/rails/
- **NPM Name**: @fortium/ai-mesh-rails
- **Version**: 4.0.0
- **Description**: Ruby on Rails backend skills
- **Dependencies**: ai-mesh-development@4.0.0

#### packages/phoenix/
- **NPM Name**: @fortium/ai-mesh-phoenix
- **Version**: 4.0.0
- **Description**: Phoenix LiveView framework skills
- **Dependencies**: ai-mesh-development@4.0.0

#### packages/blazor/
- **NPM Name**: @fortium/ai-mesh-blazor
- **Version**: 4.0.0
- **Description**: Blazor .NET framework skills
- **Dependencies**: ai-mesh-development@4.0.0

### Tier 4: Testing Framework Integration

#### packages/jest/
- **NPM Name**: @fortium/ai-mesh-jest
- **Version**: 4.0.0
- **Description**: Jest testing framework
- **Dependencies**: ai-mesh-quality@4.0.0

#### packages/pytest/
- **NPM Name**: @fortium/ai-mesh-pytest
- **Version**: 4.0.0
- **Description**: Pytest testing framework
- **Dependencies**: ai-mesh-quality@4.0.0

#### packages/rspec/
- **NPM Name**: @fortium/ai-mesh-rspec
- **Version**: 4.0.0
- **Description**: RSpec testing framework
- **Dependencies**: ai-mesh-quality@4.0.0

#### packages/xunit/
- **NPM Name**: @fortium/ai-mesh-xunit
- **Version**: 4.0.0
- **Description**: xUnit testing framework (.NET)
- **Dependencies**: ai-mesh-quality@4.0.0

#### packages/exunit/
- **NPM Name**: @fortium/ai-mesh-exunit
- **Version**: 4.0.0
- **Description**: ExUnit testing framework (Elixir)
- **Dependencies**: ai-mesh-quality@4.0.0

### Utilities

#### packages/pane-viewer/
- **NPM Name**: @fortium/ai-mesh-pane-viewer
- **Version**: 0.1.0
- **Description**: Real-time subagent monitoring
- **Dependencies**: None (standalone)

### Meta-Package

#### packages/full/
- **NPM Name**: @fortium/ai-mesh-full
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
ai-mesh-full (meta)
├── ai-mesh-core
├── ai-mesh-product
│   └── ai-mesh-core
├── ai-mesh-development
│   └── ai-mesh-core
├── ai-mesh-quality
│   └── ai-mesh-core
├── ai-mesh-infrastructure
│   └── ai-mesh-core
├── ai-mesh-git
│   └── ai-mesh-core
├── ai-mesh-e2e-testing
│   └── ai-mesh-core
├── ai-mesh-metrics
│   └── ai-mesh-core
├── ai-mesh-react
│   └── ai-mesh-development
│       └── ai-mesh-core
├── ai-mesh-nestjs
│   └── ai-mesh-development
│       └── ai-mesh-core
├── ai-mesh-rails
│   └── ai-mesh-development
│       └── ai-mesh-core
├── ai-mesh-phoenix
│   └── ai-mesh-development
│       └── ai-mesh-core
├── ai-mesh-blazor
│   └── ai-mesh-development
│       └── ai-mesh-core
├── ai-mesh-jest
│   └── ai-mesh-quality
│       └── ai-mesh-core
├── ai-mesh-pytest
│   └── ai-mesh-quality
│       └── ai-mesh-core
├── ai-mesh-rspec
│   └── ai-mesh-quality
│       └── ai-mesh-core
├── ai-mesh-xunit
│   └── ai-mesh-quality
│       └── ai-mesh-core
├── ai-mesh-exunit
│   └── ai-mesh-quality
│       └── ai-mesh-core
└── ai-mesh-pane-viewer (standalone)
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

- **Location**: /Users/ldangelo/Development/Fortium/ai-mesh-plugins
- **Status**: Structure complete, ready for plugin extraction
- **Version**: 4.0.0 (all core/workflow/framework/testing plugins)
- **License**: MIT
- **Created**: December 9, 2025

---

**Index Last Updated**: December 9, 2025
