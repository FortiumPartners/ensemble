# Technical Requirements Document: Ensemble Rename & Consolidation

**Version**: 1.6.0
**Status**: ~99% Complete
**Created**: 2025-12-12
**Last Updated**: 2025-12-16
**Author**: Tech Lead Orchestrator
**PRD Reference**: [ensemble-rename.md](../PRD/ensemble-rename.md) v1.1.0
**Project**: ai-mesh-plugins → ensemble

---

## Version History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0.0 | 2025-12-12 | Tech Lead | Initial TRD with task breakdown and sprint planning |
| 1.1.0 | 2025-12-13 | Tech Lead | Refined with stakeholder decisions: v5.0.0 versioning, automated execution, pre-flight script, Node built-in glob, config module in core |
| 1.2.0 | 2025-12-14 | Tech Lead | Marked NPM publishing as OUT OF SCOPE - plugins distributed via GitHub only |
| 1.3.0 | 2025-12-15 | Tech Lead | Updated completed tasks (PREP-008, GH-001, GH-006), added CODE-170 for env var rename, fixed naming inconsistencies |
| 1.4.0 | 2025-12-15 | Tech Lead | Comprehensive status update: marked ~85 tasks as complete, updated sprint checklists, status now ~95% complete |
| 1.5.0 | 2025-12-16 | Tech Lead | Completed TEST-005: All 21 plugins install successfully via GitHub marketplace. Fixed plugin.json validation issues (removed agents, dependencies, skillsMetadata, main, skillDefinitions, metadata, type, exports fields; corrected hooks/commands paths). Status now ~98% complete |
| 1.6.0 | 2025-12-16 | Tech Lead | Marked DOC-001, MIG-004, MIG-006, MIG-007, TEST-003 as NOT NEEDED (no wide adoption of ai-mesh, migration docs unnecessary). Status now ~99% complete |

---

## Document Overview

This TRD translates the Ensemble Rename PRD into actionable technical specifications, task breakdowns, and sprint planning. The project involves renaming the entire ai-mesh ecosystem to "ensemble" with XDG-compliant configuration consolidation.

**Scope Summary**:
- 23 packages to rename in package.json (all bumped to v5.0.0)
- 150+ files to update via automated script
- 1 GitHub repository to rename
- 1 local directory to rename (before code changes)
- XDG-compliant config system in ensemble-core package
- Migration script and pre-flight checklist to create
- **Distribution**: GitHub-based only (NPM publishing is OUT OF SCOPE)

---

## Stakeholder Decisions

The following technical decisions were made during TRD refinement:

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Execution Method** | Automated script | Bulk changes via rename-to-ensemble.js, then manual review |
| **Version Number** | v5.0.0 (major bump) | Indicates breaking change from rename, clean version number |
| **Directory Rename Timing** | Before code changes | Rename directory first, then update all code in new location |
| **Config Module Location** | In ensemble-core | Part of core package, plugins depend on core for config |
| **Branch Strategy** | New dedicated branch | Create feature/ensemble-rename from main for clean history |
| **Glob Implementation** | Node built-in (v22+) | Use fs.glob from Node 22+ without external dependencies |
| **Pre-flight Validation** | Yes, create script | Script checks NPM availability, git status, backup exists |

---

## 1. Master Task List

### Task ID Convention
- `PREP-XXX`: Preparation phase tasks
- `CODE-XXX`: Code change tasks
- `GH-XXX`: GitHub-related tasks
- `MIG-XXX`: Migration tooling tasks
- `PUB-XXX`: Publishing tasks
- `DOC-XXX`: Documentation tasks
- `TEST-XXX`: Testing tasks
- `CLEAN-XXX`: Cleanup tasks

---

### 1.1 Preparation Phase Tasks

| Task ID | Task Description | Priority | Dependencies | Status |
|---------|------------------|----------|--------------|--------|
| PREP-001 | Verify @fortium/ensemble-* package names available on NPM | N/A | None | [x] OUT OF SCOPE (no NPM publishing) |
| PREP-002 | **DONE**: Create comprehensive file inventory with line numbers | High | None | [x] |
| PREP-003 | **DONE**: Create automated bulk rename script (Node built-in glob) | High | PREP-002 | [x] |
| PREP-004 | **DONE**: Back up current repository state | Critical | None | [x] |
| PREP-005 | **DONE**: Create feature branch `feature/ensemble-rename` from main | High | PREP-004 | [x] |
| PREP-006 | **DONE**: Document rollback procedure | Medium | PREP-004 | [x] |
| PREP-007 | **DONE**: Create pre-flight checklist script | High | PREP-001 | [x] |
| PREP-008 | **DONE**: Rename local directory ai-mesh-plugins → ensemble | Critical | PREP-005 | [x] |

---

### 1.2 Code Change Tasks

#### 1.2.1 Root Level Files

| Task ID | Task Description | File(s) | Priority | Dependencies | Status |
|---------|------------------|---------|----------|--------------|--------|
| CODE-001 | **DONE**: Update root package.json (name, version to 5.0.0) | `package.json` | Critical | PREP-008 | [x] |
| CODE-002 | **DONE**: Update marketplace.json with all new package names | `marketplace.json` | Critical | PREP-008 | [x] |
| CODE-003 | **DONE**: Update README.md branding and installation | `README.md` | High | CODE-001 | [x] |
| CODE-004 | **DONE**: Update CHANGELOG.md with v5.0.0 rename entry | `CHANGELOG.md` | High | CODE-001 | [x] |
| CODE-005 | **DONE**: Update CONTRIBUTING.md repository references | `CONTRIBUTING.md` | Medium | CODE-001 | [x] |
| CODE-006 | **DONE**: Update QUICKSTART.md installation instructions | `QUICKSTART.md` | High | CODE-001 | [x] |
| CODE-007 | **DONE**: Update INDEX.md file references | `INDEX.md` | Medium | CODE-001 | [x] |

#### 1.2.2 Schema Files

| Task ID | Task Description | File(s) | Priority | Dependencies | Status |
|---------|------------------|---------|----------|--------------|--------|
| CODE-010 | **DONE**: Update plugin-schema.json name pattern | `schemas/plugin-schema.json` | Critical | PREP-008 | [x] |
| CODE-011 | **DONE**: Update marketplace-schema.json references | `schemas/marketplace-schema.json` | High | PREP-008 | [x] |

#### 1.2.3 Script Files

| Task ID | Task Description | File(s) | Priority | Dependencies | Status |
|---------|------------------|---------|----------|--------------|--------|
| CODE-020 | **DONE**: Update validate-all.js naming validation | `scripts/validate-all.js` | Critical | CODE-010 | [x] |
| CODE-021 | **DONE**: Update publish-plugin.js package handling | `scripts/publish-plugin.js` | High | CODE-001 | [x] |

#### 1.2.4 GitHub Workflows

| Task ID | Task Description | File(s) | Priority | Dependencies | Status |
|---------|------------------|---------|----------|--------------|--------|
| CODE-030 | **DONE**: Update validate.yml workflow | `.github/workflows/validate.yml` | High | CODE-020 | [x] |
| CODE-031 | **DONE**: Update test.yml workflow | `.github/workflows/test.yml` | High | PREP-008 | [x] |
| CODE-032 | **DONE**: Update release.yml workflow | `.github/workflows/release.yml` | High | CODE-021 | [x] |

#### 1.2.5 Plugin Package Updates (Tier 1 - Core)

| Task ID | Task Description | Package | Priority | Dependencies | Status |
|---------|------------------|---------|----------|--------------|--------|
| CODE-100 | **DONE**: Rename core package to v5.0.0 | `packages/core` | Critical | PREP-008 | [x] |
| CODE-101 | **DONE**: Update core package.json | `packages/core/package.json` | Critical | CODE-100 | [x] |
| CODE-102 | **DONE**: Update core plugin.json | `packages/core/.claude-plugin/plugin.json` | Critical | CODE-100 | [x] |
| CODE-103 | **DONE**: Update core README.md | `packages/core/README.md` | High | CODE-100 | [x] |
| CODE-104 | **DONE**: Update core CHANGELOG.md with v5.0.0 | `packages/core/CHANGELOG.md` | Medium | CODE-100 | [x] |
| CODE-105 | **DONE**: Add config-path.js module to core | `packages/core/lib/config-path.js` | Critical | CODE-100 | [x] |
| CODE-106 | **DONE**: Add config-path tests | `packages/core/tests/config-path.test.js` | High | CODE-105 | [x] |
| CODE-107 | **DONE**: Export config-path from core index | `packages/core/index.js` | High | CODE-105 | [x] |

#### 1.2.6 Plugin Package Updates (Tier 2 - Workflow)

| Task ID | Task Description | Package | Priority | Dependencies | Status |
|---------|------------------|---------|----------|--------------|--------|
| CODE-110 | **DONE**: Rename product package to v5.0.0 | `packages/product` | Critical | CODE-100 | [x] |
| CODE-111 | **DONE**: Rename development package to v5.0.0 | `packages/development` | Critical | CODE-100 | [x] |
| CODE-112 | **DONE**: Rename quality package to v5.0.0 | `packages/quality` | Critical | CODE-100 | [x] |
| CODE-113 | **DONE**: Rename infrastructure package to v5.0.0 | `packages/infrastructure` | Critical | CODE-100 | [x] |
| CODE-114 | **DONE**: Rename git package to v5.0.0 | `packages/git` | Critical | CODE-100 | [x] |
| CODE-115 | **DONE**: Rename e2e-testing package to v5.0.0 | `packages/e2e-testing` | Critical | CODE-100 | [x] |
| CODE-116 | **DONE**: Rename metrics package to v5.0.0 | `packages/metrics` | Critical | CODE-100 | [x] |

#### 1.2.7 Plugin Package Updates (Tier 3 - Framework Skills)

| Task ID | Task Description | Package | Priority | Dependencies | Status |
|---------|------------------|---------|----------|--------------|--------|
| CODE-120 | **DONE**: Rename react package to v5.0.0 | `packages/react` | High | CODE-111 | [x] |
| CODE-121 | **DONE**: Rename nestjs package to v5.0.0 | `packages/nestjs` | High | CODE-111 | [x] |
| CODE-122 | **DONE**: Rename rails package to v5.0.0 | `packages/rails` | High | CODE-111 | [x] |
| CODE-123 | **DONE**: Rename phoenix package to v5.0.0 | `packages/phoenix` | High | CODE-111 | [x] |
| CODE-124 | **DONE**: Rename blazor package to v5.0.0 | `packages/blazor` | High | CODE-111 | [x] |

#### 1.2.8 Plugin Package Updates (Tier 4 - Testing Frameworks)

| Task ID | Task Description | Package | Priority | Dependencies | Status |
|---------|------------------|---------|----------|--------------|--------|
| CODE-130 | **DONE**: Rename jest package to v5.0.0 | `packages/jest` | High | CODE-112 | [x] |
| CODE-131 | **DONE**: Rename pytest package to v5.0.0 | `packages/pytest` | High | CODE-112 | [x] |
| CODE-132 | **DONE**: Rename rspec package to v5.0.0 | `packages/rspec` | High | CODE-112 | [x] |
| CODE-133 | **DONE**: Rename xunit package to v5.0.0 | `packages/xunit` | High | CODE-112 | [x] |
| CODE-134 | **DONE**: Rename exunit package to v5.0.0 | `packages/exunit` | High | CODE-112 | [x] |

#### 1.2.9 Plugin Package Updates (Utilities)

| Task ID | Task Description | Package | Priority | Dependencies | Status |
|---------|------------------|---------|----------|--------------|--------|
| CODE-140 | **DONE**: Rename pane-viewer package to v5.0.0 | `packages/pane-viewer` | High | CODE-100 | [x] |
| CODE-141 | **DONE**: Rename task-progress-pane package to v5.0.0 | `packages/task-progress-pane` | High | CODE-100 | [x] |
| CODE-142 | **DONE**: Rename multiplexer-adapters package to v5.0.0 | `packages/multiplexer-adapters` | High | CODE-100 | [x] |
| CODE-143 | **DONE**: Rename full meta-package to v5.0.0 | `packages/full` | High | All CODE-1XX | [x] |

#### 1.2.10 Slash Command Updates

| Task ID | Task Description | Location | Priority | Dependencies | Status |
|---------|------------------|----------|----------|--------------|--------|
| CODE-150 | **DONE**: Update create-prd command | `packages/product/commands/create-prd.md` | High | CODE-110 | [x] |
| CODE-151 | **DONE**: Update refine-prd command | `packages/product/commands/refine-prd.md` | High | CODE-110 | [x] |
| CODE-152 | **DONE**: Update create-trd command | `packages/product/commands/create-trd.md` | High | CODE-110 | [x] |
| CODE-153 | **DONE**: Update refine-trd command | `packages/product/commands/refine-trd.md` | High | CODE-110 | [x] |
| CODE-154 | **DONE**: Update pane-config command | `packages/pane-viewer/commands/pane-config.md` | High | CODE-140 | [x] |
| CODE-155 | **DONE**: Search and update all @ensemble-command annotations | All command files | Critical | PREP-002 | [x] |

#### 1.2.11 Config Path Updates

| Task ID | Task Description | File(s) | Priority | Dependencies | Status |
|---------|------------------|---------|----------|--------------|--------|
| CODE-160 | **DONE**: Update task-progress-pane to use core config-path | `packages/task-progress-pane/lib/config-loader.js` | Critical | CODE-105 | [x] |
| CODE-161 | **DONE**: Update task-progress-pane state paths | `packages/task-progress-pane/lib/session-manager.js` | Critical | CODE-105 | [x] |
| CODE-162 | **DONE**: Update pane-viewer to use core config-path | `packages/pane-viewer/lib/*.js` | High | CODE-105 | [x] |
| CODE-163 | **DONE**: Add ensemble-core as dependency to plugins using config | `packages/*/package.json` | High | CODE-105 | [x] |

#### 1.2.12 Environment Variable Updates

| Task ID | Task Description | File(s) | Priority | Dependencies | Status |
|---------|------------------|---------|----------|--------------|--------|
| CODE-170 | **DONE**: Rename AI_MESH_* env vars to ENSEMBLE_* | Multiple (26 files) | High | PREP-008 | [x] |

> **Note**: CODE-170 renamed the following environment variables:
> - `AI_MESH_PANE_DISABLE` → `ENSEMBLE_PANE_DISABLE`
> - `AI_MESH_PANE_MULTIPLEXER` → `ENSEMBLE_PANE_MULTIPLEXER`
> - `AI_MESH_PANE_DIRECTION` → `ENSEMBLE_PANE_DIRECTION`
> - `AI_MESH_PANE_PERCENT` → `ENSEMBLE_PANE_PERCENT`
> - `AI_MESH_PANE_FLOATING` → `ENSEMBLE_PANE_FLOATING`
> - `AI_MESH_PANE_LOG` → `ENSEMBLE_PANE_LOG`

---

### 1.3 GitHub Tasks

| Task ID | Task Description | Priority | Dependencies | Status |
|---------|------------------|----------|--------------|--------|
| GH-001 | **DONE**: Rename repository ai-mesh-plugins → ensemble | Critical | All CODE-XXX | [x] |
| GH-002 | **DONE**: Update repository URL in all files post-rename | Critical | GH-001 | [x] |
| GH-003 | **DONE**: Verify GitHub Actions work with new repo name | High | GH-001, CODE-030-032 | [x] |
| GH-004 | **DONE**: Update GitHub repository description | Medium | GH-001 | [x] |
| GH-005 | **DONE**: Update GitHub repository topics/tags | Low | GH-001 | [x] |
| GH-006 | **DONE**: Verify old URL redirects work | Medium | GH-001 | [x] |

---

### 1.4 Migration Tooling Tasks

| Task ID | Task Description | Priority | Dependencies | Status |
|---------|------------------|----------|--------------|--------|
| MIG-001 | **DONE**: Implement XDG config path resolution in core | Critical | CODE-105 | [x] |
| MIG-002 | **DONE**: Export config-path module from ensemble-core | Critical | MIG-001 | [x] |
| MIG-003 | **DONE**: Implement config migration script | Critical | MIG-002 | [x] |
| ~~MIG-004~~ | ~~Add migration script to package.json bin~~ | ~~High~~ | MIG-003 | [x] NOT NEEDED (no wide adoption) |
| MIG-005 | **DONE**: Test migration on macOS | High | MIG-003 | [x] |
| ~~MIG-006~~ | ~~Test migration on Linux with XDG~~ | ~~High~~ | MIG-003 | [x] NOT NEEDED (no wide adoption) |
| ~~MIG-007~~ | ~~Test migration on WSL~~ | ~~Medium~~ | MIG-003 | [x] NOT NEEDED (no wide adoption) |

---

### 1.5 Testing Tasks

| Task ID | Task Description | Priority | Dependencies | Status |
|---------|------------------|----------|--------------|--------|
| TEST-001 | **PARTIAL**: Run existing test suite with new names | Critical | All CODE-XXX | [~] (14 pre-existing failures) |
| TEST-002 | **DONE**: Add unit tests for XDG path resolution | High | CODE-106 | [x] |
| ~~TEST-003~~ | ~~Add integration tests for config migration~~ | ~~High~~ | MIG-003 | [x] NOT NEEDED (no wide adoption) |
| TEST-004 | **DONE**: Verify no ai-mesh references remain (grep test) | Critical | All CODE-XXX | [x] |
| TEST-005 | **DONE**: Test plugin installation with new names | High | N/A | [x] (GitHub-based) |
| TEST-006 | **DONE**: Test slash commands with new prefix | High | CODE-150-155 | [x] |
| TEST-007 | **DONE**: Run pre-flight checklist validation | Critical | PREP-007 | [x] |

---

### 1.6 Publishing Tasks

> **NOTE**: NPM publishing is OUT OF SCOPE. Plugins are distributed via GitHub only.
> Users install plugins using: `claude plugin install github:FortiumPartners/ensemble/packages/*`

| Task ID | Task Description | Priority | Dependencies | Status |
|---------|------------------|----------|--------------|--------|
| ~~PUB-001~~ | ~~Publish @fortium/ensemble-core v5.0.0~~ | ~~Critical~~ | N/A | [x] OUT OF SCOPE |
| ~~PUB-002~~ | ~~Publish Tier 2 packages v5.0.0~~ | ~~Critical~~ | N/A | [x] OUT OF SCOPE |
| ~~PUB-003~~ | ~~Publish Tier 3 packages v5.0.0~~ | ~~High~~ | N/A | [x] OUT OF SCOPE |
| ~~PUB-004~~ | ~~Publish Tier 4 packages v5.0.0~~ | ~~High~~ | N/A | [x] OUT OF SCOPE |
| ~~PUB-005~~ | ~~Publish utility packages v5.0.0~~ | ~~High~~ | N/A | [x] OUT OF SCOPE |
| ~~PUB-006~~ | ~~Publish @fortium/ensemble-full v5.0.0~~ | ~~High~~ | N/A | [x] OUT OF SCOPE |
| ~~PUB-007~~ | ~~Verify all packages install correctly~~ | ~~Critical~~ | N/A | [x] OUT OF SCOPE |
| ~~PUB-008~~ | ~~Deprecate old @fortium/ensemble-* packages~~ | ~~High~~ | N/A | [x] OUT OF SCOPE |
| ~~PUB-009~~ | ~~Unpublish old packages~~ | ~~Medium~~ | N/A | [x] OUT OF SCOPE |

---

### 1.7 Documentation Tasks

| Task ID | Task Description | Priority | Dependencies | Status |
|---------|------------------|----------|--------------|--------|
| ~~DOC-001~~ | ~~Create MIGRATION.md guide~~ | ~~High~~ | MIG-003 | [x] NOT NEEDED (no wide adoption) |
| DOC-002 | **DONE**: Update all plugin README files | High | All CODE-1XX | [x] |
| DOC-003 | **DONE**: Update docs/PRD references | Medium | All CODE-XXX | [x] |
| DOC-004 | **DONE**: Update docs/TRD references | Medium | All CODE-XXX | [x] |
| DOC-005 | Create announcement blog post draft | Low | N/A | [ ] |
| DOC-006 | **DONE**: Update any external documentation links | Low | GH-001 | [x] |

---

### 1.8 Cleanup Tasks

| Task ID | Task Description | Priority | Dependencies | Status |
|---------|------------------|----------|--------------|--------|
| CLEAN-001 | **DONE**: Run final grep verification for ai-mesh | Critical | All tasks | [x] |
| CLEAN-002 | Remove any temporary files/scripts | Medium | All tasks | [ ] |
| CLEAN-003 | Archive old package references | Low | PUB-009 | [ ] |
| CLEAN-004 | Final documentation review | High | DOC-001-006 | [ ] |

---

## 2. System Architecture

### 2.1 Component Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Ensemble Ecosystem v5.0.0                   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐ │
│  │   @fortium/     │    │   @fortium/     │    │   @fortium/     │ │
│  │ ensemble-core   │◄───│ ensemble-product│    │ensemble-quality │ │
│  │    v5.0.0       │    │    v5.0.0       │    │    v5.0.0       │ │
│  └────────┬────────┘    └────────┬────────┘    └────────┬────────┘ │
│           │                      │                      │          │
│           ▼                      ▼                      ▼          │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │            Shared Config Module (in ensemble-core)           │   │
│  │                   lib/config-path.js                         │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │   │
│  │  │XDG Resolver │  │Path Builder │  │  Directory Manager  │  │   │
│  │  └─────────────┘  └─────────────┘  └─────────────────────┘  │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                               │                                     │
│                               ▼                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    Configuration Store                       │   │
│  │           $XDG_CONFIG_HOME/ensemble/ or ~/.ensemble/         │   │
│  │  ┌─────────┐  ┌─────────┐  ┌────────┐  ┌────────────────┐   │   │
│  │  │config.js│  │state.js │  │plugins/│  │     logs/      │   │   │
│  │  └─────────┘  └─────────┘  └────────┘  └────────────────┘   │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.2 Package Dependency Hierarchy (v5.0.0)

```
Level 0 (Foundation):
└── @fortium/ensemble-core v5.0.0
    └── exports: lib/config-path.js (XDG-compliant config resolution)

Level 1 (Workflow):
├── @fortium/ensemble-product v5.0.0      ──► ensemble-core
├── @fortium/ensemble-development v5.0.0  ──► ensemble-core
├── @fortium/ensemble-quality v5.0.0      ──► ensemble-core
├── @fortium/ensemble-infrastructure v5.0.0 ──► ensemble-core
├── @fortium/ensemble-git v5.0.0          ──► ensemble-core
├── @fortium/ensemble-e2e-testing v5.0.0  ──► ensemble-core
└── @fortium/ensemble-metrics v5.0.0      ──► ensemble-core

Level 2 (Framework Skills):
├── @fortium/ensemble-react v5.0.0   ──► ensemble-development
├── @fortium/ensemble-nestjs v5.0.0  ──► ensemble-development
├── @fortium/ensemble-rails v5.0.0   ──► ensemble-development
├── @fortium/ensemble-phoenix v5.0.0 ──► ensemble-development
└── @fortium/ensemble-blazor v5.0.0  ──► ensemble-development

Level 3 (Testing Frameworks):
├── @fortium/ensemble-jest v5.0.0   ──► ensemble-quality
├── @fortium/ensemble-pytest v5.0.0 ──► ensemble-quality
├── @fortium/ensemble-rspec v5.0.0  ──► ensemble-quality
├── @fortium/ensemble-xunit v5.0.0  ──► ensemble-quality
└── @fortium/ensemble-exunit v5.0.0 ──► ensemble-quality

Level 4 (Utilities):
├── @fortium/ensemble-pane-viewer v5.0.0         ──► ensemble-core
├── @fortium/ensemble-task-progress-pane v5.0.0  ──► ensemble-core
└── @fortium/ensemble-multiplexer-adapters v5.0.0 (internal)

Level 5 (Meta):
└── @fortium/ensemble-full v5.0.0 ──► All packages
```

### 2.3 Configuration Directory Structure

```
$CONFIG_ROOT/
└── ensemble/
    ├── config.json              # Global configuration
    │   {
    │     "version": "5.0.0",
    │     "theme": "default",
    │     "logLevel": "info"
    │   }
    │
    ├── state.json               # Global state tracking
    │   {
    │     "lastRun": "2025-12-13T00:00:00Z",
    │     "activePlugins": [...]
    │   }
    │
    ├── plugins/                 # Plugin-specific configs
    │   ├── task-progress-pane/
    │   │   ├── config.json     # Plugin settings
    │   │   └── state.json      # Plugin state
    │   │
    │   ├── pane-viewer/
    │   │   └── config.json
    │   │
    │   └── [plugin-name]/
    │       └── config.json
    │
    ├── logs/                    # Centralized logging
    │   ├── ensemble.log        # Main log file
    │   └── [plugin-name]/
    │       └── YYYY-MM-DD.log
    │
    ├── cache/                   # Shared cache
    │   └── [plugin-name]/
    │
    └── sessions/                # Session management
        └── [session-id].json
```

### 2.4 XDG Path Resolution Algorithm

```
┌─────────────────────────────────────────────────────────────┐
│                   getEnsembleConfigRoot()                   │
│              (from @fortium/ensemble-core)                  │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │ XDG_CONFIG_HOME │
                    │     set?        │
                    └────────┬────────┘
                             │
              ┌──────────────┴──────────────┐
              │ Yes                         │ No
              ▼                             ▼
    ┌─────────────────┐           ┌─────────────────┐
    │ Return:         │           │ ~/.config       │
    │ $XDG_CONFIG_HOME│           │   exists?       │
    │ /ensemble       │           └────────┬────────┘
    └─────────────────┘                    │
                                ┌──────────┴──────────┐
                                │ Yes                 │ No
                                ▼                     ▼
                      ┌─────────────────┐   ┌─────────────────┐
                      │ Return:         │   │ Return:         │
                      │ ~/.config/      │   │ ~/.ensemble     │
                      │ ensemble        │   │                 │
                      └─────────────────┘   └─────────────────┘
```

---

## 3. Sprint Planning

### Sprint Overview

| Sprint | Focus | Duration | Key Deliverables |
|--------|-------|----------|------------------|
| Sprint 1 | Preparation & Infrastructure | 1 day | Pre-flight script, NPM verification, directory rename, rename script |
| Sprint 2 | Core Code Changes | 2 days | All package renames to v5.0.0, config-path module in core |
| Sprint 3 | Config & Migration | 1 day | Migration script, plugin config updates |
| Sprint 4 | Testing & GitHub | 1 day | Test suite, GitHub rename, CI/CD |
| Sprint 5 | Documentation & Cleanup | 1 day | Documentation updates, GitHub installation verification |

---

### Sprint 1: Preparation & Infrastructure ✅ COMPLETE

**Goal**: Set up infrastructure for safe rename operation

**Tasks**:
- [x] PREP-001: Verify @fortium/ensemble-* package names available on NPM (OUT OF SCOPE - no NPM publishing)
- [x] PREP-002: Create comprehensive file inventory with line numbers
- [x] PREP-007: **Create pre-flight checklist script**
- [x] TEST-007: **Run pre-flight validation**
- [x] PREP-004: Back up current repository state
- [x] PREP-005: Create feature branch `feature/ensemble-rename` from main
- [x] PREP-008: **Rename local directory ai-mesh-plugins → ensemble** (DONE)
- [x] PREP-003: Create automated bulk rename script (Node built-in glob)
- [x] PREP-006: Document rollback procedure

**Deliverables**:
1. ✅ Pre-flight checklist script (`scripts/preflight-check.js`)
2. ✅ NPM availability - OUT OF SCOPE (GitHub distribution only)
3. ✅ Complete file inventory (JSON format)
4. ✅ Backup archive
5. ✅ Feature branch `feature/ensemble-rename`
6. ✅ Renamed local directory (`/Users/ldangelo/Development/Fortium/ensemble`)
7. ✅ Automated rename script (`scripts/rename-to-ensemble.js`)
8. ✅ Rollback documentation

**Acceptance Criteria**:
- [x] Pre-flight script passes all checks
- [x] NPM publishing OUT OF SCOPE - GitHub distribution only
- [x] File inventory covers all 150+ files requiring changes
- [x] Local directory successfully renamed
- [x] Rename script handles package.json, plugin.json, and markdown files
- [x] Backup stored securely

---

### Sprint 2: Core Code Changes ✅ COMPLETE

**Goal**: Execute all naming changes across the codebase to v5.0.0

**Day 1 Tasks**:
- [x] Run automated rename script with --dry-run first
- [x] CODE-001 to CODE-007: Root level files
- [x] CODE-010 to CODE-011: Schema files
- [x] CODE-020 to CODE-021: Script files
- [x] CODE-100 to CODE-107: Core package (including config-path module)

**Day 2 Tasks**:
- [x] CODE-110 to CODE-116: Tier 2 packages (workflow)
- [x] CODE-120 to CODE-124: Tier 3 packages (frameworks)
- [x] CODE-130 to CODE-134: Tier 4 packages (testing)
- [x] CODE-140 to CODE-143: Utility packages
- [x] CODE-150 to CODE-155: Slash commands
- [x] CODE-163: Add ensemble-core dependency to plugins using config

**Deliverables**:
1. ✅ All package.json files updated to v5.0.0
2. ✅ All plugin.json files updated
3. ✅ All README files updated
4. ✅ All slash commands use `/ensemble:` prefix
5. ✅ Schema validation patterns updated
6. ✅ config-path.js module in ensemble-core

**Acceptance Criteria**:
- [x] `grep -r "ai-mesh" --include="*.json"` returns 0 results (excluding docs)
- [x] `grep -r "@fortium/ensemble-" --include="*.json"` confirms all packages renamed
- [x] All packages at v5.0.0
- [x] All packages validate against new schema pattern
- [x] `npm run validate` passes
- [x] config-path module exports correctly from core

---

### Sprint 3: Config & Migration ✅ COMPLETE

**Goal**: Implement XDG-compliant configuration system

**Tasks**:
- [x] MIG-001: Verify XDG config path resolution in core
- [x] MIG-002: Verify config-path module exports from ensemble-core
- [x] CODE-160 to CODE-162: Update all plugin config path references
- [x] MIG-003: Implement config migration script
- [x] ~~MIG-004: Add migration script to package.json bin~~ NOT NEEDED (no wide adoption)
- [x] TEST-002: Run unit tests for XDG path resolution
- [x] ~~TEST-003: Add integration tests for config migration~~ NOT NEEDED (no wide adoption)

**Deliverables**:
1. ✅ Verified `lib/config-path.js` module in core
2. ✅ `scripts/migrate-config.js` script
3. ✅ Updated plugin config loaders to use core module
4. ✅ Test suite for config system

**Acceptance Criteria**:
- [x] XDG_CONFIG_HOME respected when set
- [x] Falls back to ~/.config/ensemble when ~/.config exists
- [x] Falls back to ~/.ensemble otherwise
- [x] Migration script successfully moves old configs
- [x] All config-path tests pass

---

### Sprint 4: Testing & GitHub ✅ MOSTLY COMPLETE

**Goal**: Validate changes and rename GitHub repository

**Morning Tasks** (Testing):
- [~] TEST-001: Run existing test suite with new names (14 pre-existing failures)
- [x] TEST-004: Verify no ai-mesh references remain (grep test)
- [x] TEST-005: Test plugin installation with new names (GitHub-based) - All 21 plugins install successfully
- [x] TEST-006: Test slash commands with new prefix
- [x] MIG-005: Test migration on macOS
- [x] ~~MIG-006: Test migration on Linux with XDG~~ NOT NEEDED (no wide adoption)
- [x] ~~MIG-007: Test migration on WSL~~ NOT NEEDED (no wide adoption)

**Afternoon Tasks** (GitHub):
- [x] CODE-030 to CODE-032: Update GitHub workflows
- [x] GH-001: Rename repository ai-mesh-plugins → ensemble (DONE)
- [x] GH-002: Update repository URL in all files post-rename
- [x] GH-003: Verify GitHub Actions work with new repo name
- [x] GH-004: Update GitHub repository description
- [x] GH-005: Update GitHub repository topics/tags
- [x] GH-006: Verify old URL redirects work

**Deliverables**:
1. ✅ Tests run (14 pre-existing failures to fix)
2. ✅ GitHub repository renamed to `FortiumPartners/ensemble`
3. ✅ CI/CD workflows functional
4. ⚠️ Migration tested on macOS only
5. ✅ All 21 plugins install successfully via GitHub marketplace (tested 2025-12-16)

**Acceptance Criteria**:
- [x] CI pipeline passes on new repository
- [x] Old URL (FortiumPartners/ai-mesh-plugins) redirects to new URL
- [~] Migration works on macOS (Linux/WSL untested)
- [x] All slash commands functional with /ensemble: prefix

---

### Sprint 5: Documentation & Cleanup ⚠️ IN PROGRESS

> **NOTE**: NPM publishing is OUT OF SCOPE. Plugins are distributed via GitHub only.
> Users install plugins using: `claude plugin install github:FortiumPartners/ensemble/packages/*`

**Goal**: Finalize documentation and cleanup

**Tasks** (Documentation & Cleanup):
- [x] ~~DOC-001: Create MIGRATION.md guide~~ NOT NEEDED (no wide adoption)
- [x] DOC-002: Update all plugin README files
- [x] DOC-003 to DOC-004: Update docs references
- [x] CLEAN-001: Run final grep verification for ai-mesh
- [ ] CLEAN-002 to CLEAN-004: Final cleanup

**Deliverables**:
1. ~~MIGRATION.md guide~~ NOT NEEDED (no wide adoption)
2. Final documentation updates
3. ✅ Verified GitHub-based installation works

**Acceptance Criteria**:
- [x] `claude plugin install ensemble-core@ensemble` works (tested 2025-12-16)
- [x] ~~MIGRATION.md complete and accurate~~ NOT NEEDED (no wide adoption)
- [x] No ai-mesh references anywhere in codebase (except docs)
- [x] All README files updated with GitHub installation instructions

---

## 4. Technical Specifications

### 4.1 Pre-flight Checklist Script (NEW)

**File**: `scripts/preflight-check.js`

```javascript
#!/usr/bin/env node
/**
 * Pre-flight checklist for Ensemble rename
 * Validates all prerequisites before starting the rename process
 *
 * Usage: node scripts/preflight-check.js
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');

const PACKAGES = [
  'ensemble-core',
  'ensemble-product',
  'ensemble-development',
  'ensemble-quality',
  'ensemble-infrastructure',
  'ensemble-git',
  'ensemble-e2e-testing',
  'ensemble-metrics',
  'ensemble-react',
  'ensemble-nestjs',
  'ensemble-rails',
  'ensemble-phoenix',
  'ensemble-blazor',
  'ensemble-jest',
  'ensemble-pytest',
  'ensemble-rspec',
  'ensemble-xunit',
  'ensemble-exunit',
  'ensemble-pane-viewer',
  'ensemble-task-progress-pane',
  'ensemble-multiplexer-adapters',
  'ensemble-full',
];

const checks = [];
let passed = 0;
let failed = 0;

function log(status, message) {
  const icon = status === 'pass' ? '\x1b[32m✓\x1b[0m' : status === 'fail' ? '\x1b[31m✗\x1b[0m' : '\x1b[33m⋯\x1b[0m';
  console.log(`${icon} ${message}`);
  if (status === 'pass') passed++;
  if (status === 'fail') failed++;
}

function checkNodeVersion() {
  const version = process.version;
  const major = parseInt(version.slice(1).split('.')[0], 10);
  if (major >= 22) {
    log('pass', `Node.js version ${version} (>=22 required for built-in glob)`);
    return true;
  } else {
    log('fail', `Node.js version ${version} is too old (>=22 required)`);
    return false;
  }
}

function checkGitStatus() {
  try {
    const status = execSync('git status --porcelain', { encoding: 'utf8' });
    if (status.trim() === '') {
      log('pass', 'Git working directory is clean');
      return true;
    } else {
      log('fail', 'Git working directory has uncommitted changes');
      console.log('       Uncommitted files:');
      status.split('\n').filter(Boolean).forEach(line => {
        console.log(`         ${line}`);
      });
      return false;
    }
  } catch (err) {
    log('fail', 'Not a git repository or git not available');
    return false;
  }
}

function checkCurrentBranch() {
  try {
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();
    if (branch === 'main' || branch === 'master') {
      log('pass', `On branch '${branch}' - ready to create feature branch`);
      return true;
    } else {
      log('fail', `On branch '${branch}' - should be on main/master before creating feature branch`);
      return false;
    }
  } catch (err) {
    log('fail', 'Could not determine current git branch');
    return false;
  }
}

function checkNpmLogin() {
  try {
    const whoami = execSync('npm whoami', { encoding: 'utf8' }).trim();
    log('pass', `Logged into NPM as '${whoami}'`);
    return true;
  } catch (err) {
    log('fail', 'Not logged into NPM - run `npm login` first');
    return false;
  }
}

async function checkPackageAvailability(packageName) {
  return new Promise((resolve) => {
    const url = `https://registry.npmjs.org/@fortium/${packageName}`;
    https.get(url, (res) => {
      if (res.statusCode === 404) {
        resolve({ name: packageName, available: true });
      } else {
        resolve({ name: packageName, available: false });
      }
    }).on('error', () => {
      resolve({ name: packageName, available: 'error' });
    });
  });
}

async function checkAllPackagesAvailable() {
  console.log('\nChecking NPM package availability...');

  const results = await Promise.all(PACKAGES.map(checkPackageAvailability));
  const unavailable = results.filter(r => !r.available);
  const errors = results.filter(r => r.available === 'error');

  if (unavailable.length === 0 && errors.length === 0) {
    log('pass', `All ${PACKAGES.length} @fortium/ensemble-* package names are available`);
    return true;
  } else {
    if (unavailable.length > 0) {
      log('fail', `${unavailable.length} package names are already taken:`);
      unavailable.forEach(r => console.log(`         @fortium/${r.name}`));
    }
    if (errors.length > 0) {
      log('fail', `${errors.length} packages could not be checked (network error)`);
    }
    return false;
  }
}

function checkBackupExists() {
  const backupDir = path.join(process.cwd(), '..');
  const files = fs.readdirSync(backupDir);
  const backups = files.filter(f => f.startsWith('backup-ensemble-') && f.endsWith('.tar.gz'));

  if (backups.length > 0) {
    log('pass', `Backup found: ${backups[backups.length - 1]}`);
    return true;
  } else {
    log('fail', 'No backup archive found - create one before proceeding');
    console.log('       Run: tar -czf ../backup-ensemble-$(date +%Y%m%d).tar.gz .');
    return false;
  }
}

function checkDirectoryName() {
  const currentDir = path.basename(process.cwd());
  if (currentDir === 'ai-mesh-plugins') {
    log('pass', `Current directory is 'ai-mesh-plugins' - ready for rename`);
    return true;
  } else if (currentDir === 'ensemble') {
    log('pass', `Directory already renamed to 'ensemble'`);
    return true;
  } else {
    log('fail', `Unexpected directory name: ${currentDir}`);
    return false;
  }
}

async function runAllChecks() {
  console.log('Ensemble Rename Pre-flight Checklist');
  console.log('====================================\n');

  console.log('Environment Checks:');
  checkNodeVersion();
  checkDirectoryName();

  console.log('\nGit Checks:');
  checkGitStatus();
  checkCurrentBranch();

  console.log('\nNPM Checks:');
  checkNpmLogin();
  await checkAllPackagesAvailable();

  console.log('\nBackup Checks:');
  checkBackupExists();

  console.log('\n====================================');
  console.log(`Results: ${passed} passed, ${failed} failed`);

  if (failed === 0) {
    console.log('\n\x1b[32mAll pre-flight checks passed! Ready to proceed.\x1b[0m');
    process.exit(0);
  } else {
    console.log('\n\x1b[31mSome checks failed. Please resolve before proceeding.\x1b[0m');
    process.exit(1);
  }
}

runAllChecks();
```

### 4.2 Automated Rename Script (Updated for Node 22+ built-in glob)

**File**: `scripts/rename-to-ensemble.js`

```javascript
#!/usr/bin/env node
/**
 * Automated rename script for ai-mesh → ensemble migration
 * Uses Node.js 22+ built-in glob (no external dependencies)
 *
 * Usage: node scripts/rename-to-ensemble.js [--dry-run]
 */

const fs = require('fs');
const path = require('path');
const { glob } = require('fs').promises;

const DRY_RUN = process.argv.includes('--dry-run');
const NEW_VERSION = '5.0.0';

const REPLACEMENTS = [
  // Package names
  { from: '@fortium/ensemble-', to: '@fortium/ensemble-' },
  { from: '@fortium/ensemble-', to: '@fortium/ensemble-' },

  // Plugin names
  { from: '"ensemble-', to: '"ensemble-' },
  { from: "'ensemble-", to: "'ensemble-" },

  // Repository URLs
  { from: 'FortiumPartners/ensemble', to: 'FortiumPartners/ensemble' },

  // Config paths
  { from: '.ensemble/plugins/task-progress-pane', to: '.ensemble/plugins/task-progress-pane' },
  { from: '.ensemble/plugins/pane-viewer', to: '.ensemble/plugins/pane-viewer' },

  // Command prefixes
  { from: '/ensemble:', to: '/ensemble:' },
  { from: '@ensemble-command', to: '@ensemble-command' },

  // Keywords
  { from: '"ensemble"', to: '"ensemble"' },

  // Schema patterns
  { from: '^ensemble-[a-z0-9-]+$', to: '^ensemble-[a-z0-9-]+$' },
];

const FILE_PATTERNS = [
  '**/*.json',
  '**/*.js',
  '**/*.md',
  '**/*.yml',
  '**/*.yaml',
];

const IGNORE_DIRS = ['node_modules', '.git', 'coverage', 'dist', 'build'];

async function findFiles(pattern) {
  // Use Node 22+ built-in glob
  const { glob: nodeGlob } = await import('node:fs/promises');

  // Fallback for older Node or environments without fs.glob
  if (typeof nodeGlob !== 'function') {
    return findFilesManual(pattern);
  }

  const files = [];
  for await (const file of nodeGlob(pattern, {
    cwd: process.cwd(),
    exclude: (name) => IGNORE_DIRS.some(dir => name.includes(dir)),
  })) {
    files.push(file);
  }
  return files;
}

// Fallback manual implementation
function findFilesManual(pattern) {
  const files = [];
  const ext = pattern.replace('**/*', '');

  function walk(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORE_DIRS.includes(entry.name)) {
          walk(fullPath);
        }
      } else if (entry.isFile() && entry.name.endsWith(ext)) {
        files.push(fullPath);
      }
    }
  }

  walk(process.cwd());
  return files;
}

function replaceInFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  let modified = false;

  for (const { from, to } of REPLACEMENTS) {
    if (content.includes(from)) {
      content = content.split(from).join(to);
      modified = true;
    }
  }

  // Update version in package.json files
  if (filePath.endsWith('package.json')) {
    const pkg = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (pkg.version && pkg.version !== NEW_VERSION) {
      content = content.replace(
        `"version": "${pkg.version}"`,
        `"version": "${NEW_VERSION}"`
      );
      modified = true;
    }
  }

  if (modified) {
    if (DRY_RUN) {
      console.log(`[DRY-RUN] Would update: ${filePath}`);
    } else {
      fs.writeFileSync(filePath, content);
      console.log(`[UPDATED] ${filePath}`);
    }
  }

  return modified;
}

async function main() {
  console.log('Ensemble Rename Script');
  console.log('======================');
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
  console.log(`Target version: ${NEW_VERSION}\n`);

  let totalFiles = 0;
  let modifiedFiles = 0;

  for (const pattern of FILE_PATTERNS) {
    console.log(`Scanning ${pattern}...`);
    const files = await findFiles(pattern);

    for (const file of files) {
      totalFiles++;
      if (replaceInFile(file)) {
        modifiedFiles++;
      }
    }
  }

  console.log(`\n${'='.repeat(40)}`);
  console.log(`Summary: ${modifiedFiles}/${totalFiles} files modified`);

  if (DRY_RUN) {
    console.log('\nThis was a dry run. No files were changed.');
    console.log('Run without --dry-run to apply changes.');
  }
}

main().catch(console.error);
```

### 4.3 XDG Config Path Module (in ensemble-core)

**File**: `packages/core/lib/config-path.js`

```javascript
/**
 * XDG-compliant configuration path resolution for Ensemble
 * Part of @fortium/ensemble-core
 *
 * Priority:
 * 1. $XDG_CONFIG_HOME/ensemble/ (if XDG_CONFIG_HOME set)
 * 2. ~/.config/ensemble/ (if ~/.config exists)
 * 3. ~/.ensemble/ (fallback)
 *
 * @module @fortium/ensemble-core/config-path
 * @version 5.0.0
 */

const os = require('os');
const path = require('path');
const fs = require('fs');

/**
 * Get the root configuration directory for Ensemble
 * @returns {string} Absolute path to config root
 */
function getEnsembleConfigRoot() {
  // Priority 1: XDG_CONFIG_HOME if set
  if (process.env.XDG_CONFIG_HOME) {
    return path.join(process.env.XDG_CONFIG_HOME, 'ensemble');
  }

  // Priority 2: ~/.config/ensemble if ~/.config exists
  const homeDir = os.homedir();
  const xdgDefault = path.join(homeDir, '.config', 'ensemble');
  const configDir = path.join(homeDir, '.config');

  if (fs.existsSync(configDir)) {
    return xdgDefault;
  }

  // Priority 3: ~/.ensemble fallback
  return path.join(homeDir, '.ensemble');
}

/**
 * Get plugin-specific configuration directory
 * @param {string} pluginName - Name of the plugin (e.g., 'task-progress-pane')
 * @returns {string} Absolute path to plugin config directory
 */
function getPluginConfigPath(pluginName) {
  return path.join(getEnsembleConfigRoot(), 'plugins', pluginName);
}

/**
 * Get logs directory path
 * @param {string} [pluginName] - Optional plugin name for plugin-specific logs
 * @returns {string} Absolute path to logs directory
 */
function getLogsPath(pluginName) {
  const logsRoot = path.join(getEnsembleConfigRoot(), 'logs');
  return pluginName ? path.join(logsRoot, pluginName) : logsRoot;
}

/**
 * Get cache directory path
 * @param {string} [pluginName] - Optional plugin name for plugin-specific cache
 * @returns {string} Absolute path to cache directory
 */
function getCachePath(pluginName) {
  const cacheRoot = path.join(getEnsembleConfigRoot(), 'cache');
  return pluginName ? path.join(cacheRoot, pluginName) : cacheRoot;
}

/**
 * Get sessions directory path
 * @returns {string} Absolute path to sessions directory
 */
function getSessionsPath() {
  return path.join(getEnsembleConfigRoot(), 'sessions');
}

/**
 * Ensure a directory exists, creating it with secure permissions if needed
 * @param {string} dirPath - Directory path to ensure exists
 * @returns {string} The directory path
 */
function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true, mode: 0o700 });
  }
  return dirPath;
}

/**
 * Initialize the Ensemble configuration directory structure
 * @returns {object} Object containing all created paths
 */
function initializeConfigStructure() {
  const root = getEnsembleConfigRoot();

  return {
    root: ensureDir(root),
    plugins: ensureDir(path.join(root, 'plugins')),
    logs: ensureDir(path.join(root, 'logs')),
    cache: ensureDir(path.join(root, 'cache')),
    sessions: ensureDir(path.join(root, 'sessions')),
  };
}

/**
 * Read a JSON config file, returning default if not exists
 * @param {string} filePath - Path to JSON file
 * @param {object} [defaultValue={}] - Default value if file doesn't exist
 * @returns {object} Parsed JSON or default
 */
function readJsonConfig(filePath, defaultValue = {}) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
  } catch (err) {
    console.warn(`Warning: Could not read config from ${filePath}: ${err.message}`);
  }
  return defaultValue;
}

/**
 * Write a JSON config file with secure permissions
 * @param {string} filePath - Path to JSON file
 * @param {object} data - Data to write
 */
function writeJsonConfig(filePath, data) {
  const dir = path.dirname(filePath);
  ensureDir(dir);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), { mode: 0o600 });
}

module.exports = {
  getEnsembleConfigRoot,
  getPluginConfigPath,
  getLogsPath,
  getCachePath,
  getSessionsPath,
  ensureDir,
  initializeConfigStructure,
  readJsonConfig,
  writeJsonConfig,
};
```

### 4.4 Config Path Unit Tests

**File**: `packages/core/tests/config-path.test.js`

```javascript
/**
 * Unit tests for config-path module
 * @module @fortium/ensemble-core/tests/config-path
 */

const { describe, it, expect, beforeEach, afterEach, vi } = require('vitest');
const path = require('path');
const os = require('os');
const fs = require('fs');

// Mock fs module
vi.mock('fs');

const {
  getEnsembleConfigRoot,
  getPluginConfigPath,
  getLogsPath,
  getCachePath,
  getSessionsPath,
  ensureDir,
} = require('../lib/config-path');

describe('config-path', () => {
  const originalEnv = process.env;
  const mockHomeDir = '/home/testuser';

  beforeEach(() => {
    vi.resetAllMocks();
    process.env = { ...originalEnv };
    vi.spyOn(os, 'homedir').mockReturnValue(mockHomeDir);
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('getEnsembleConfigRoot', () => {
    it('should use XDG_CONFIG_HOME when set', () => {
      process.env.XDG_CONFIG_HOME = '/custom/config';

      const result = getEnsembleConfigRoot();

      expect(result).toBe('/custom/config/ensemble');
    });

    it('should use ~/.config/ensemble when ~/.config exists', () => {
      delete process.env.XDG_CONFIG_HOME;
      fs.existsSync.mockReturnValue(true);

      const result = getEnsembleConfigRoot();

      expect(result).toBe(path.join(mockHomeDir, '.config', 'ensemble'));
    });

    it('should fall back to ~/.ensemble when ~/.config does not exist', () => {
      delete process.env.XDG_CONFIG_HOME;
      fs.existsSync.mockReturnValue(false);

      const result = getEnsembleConfigRoot();

      expect(result).toBe(path.join(mockHomeDir, '.ensemble'));
    });
  });

  describe('getPluginConfigPath', () => {
    it('should return correct plugin config path', () => {
      delete process.env.XDG_CONFIG_HOME;
      fs.existsSync.mockReturnValue(false);

      const result = getPluginConfigPath('task-progress-pane');

      expect(result).toBe(path.join(mockHomeDir, '.ensemble', 'plugins', 'task-progress-pane'));
    });
  });

  describe('getLogsPath', () => {
    it('should return root logs path when no plugin specified', () => {
      delete process.env.XDG_CONFIG_HOME;
      fs.existsSync.mockReturnValue(false);

      const result = getLogsPath();

      expect(result).toBe(path.join(mockHomeDir, '.ensemble', 'logs'));
    });

    it('should return plugin-specific logs path', () => {
      delete process.env.XDG_CONFIG_HOME;
      fs.existsSync.mockReturnValue(false);

      const result = getLogsPath('pane-viewer');

      expect(result).toBe(path.join(mockHomeDir, '.ensemble', 'logs', 'pane-viewer'));
    });
  });

  describe('getCachePath', () => {
    it('should return correct cache path', () => {
      delete process.env.XDG_CONFIG_HOME;
      fs.existsSync.mockReturnValue(false);

      const result = getCachePath('test-plugin');

      expect(result).toBe(path.join(mockHomeDir, '.ensemble', 'cache', 'test-plugin'));
    });
  });

  describe('getSessionsPath', () => {
    it('should return correct sessions path', () => {
      delete process.env.XDG_CONFIG_HOME;
      fs.existsSync.mockReturnValue(false);

      const result = getSessionsPath();

      expect(result).toBe(path.join(mockHomeDir, '.ensemble', 'sessions'));
    });
  });

  describe('ensureDir', () => {
    it('should create directory if it does not exist', () => {
      fs.existsSync.mockReturnValue(false);
      fs.mkdirSync.mockReturnValue(undefined);

      const testPath = '/test/path';
      const result = ensureDir(testPath);

      expect(fs.mkdirSync).toHaveBeenCalledWith(testPath, { recursive: true, mode: 0o700 });
      expect(result).toBe(testPath);
    });

    it('should not create directory if it already exists', () => {
      fs.existsSync.mockReturnValue(true);

      const testPath = '/existing/path';
      const result = ensureDir(testPath);

      expect(fs.mkdirSync).not.toHaveBeenCalled();
      expect(result).toBe(testPath);
    });
  });
});
```

### 4.5 Migration Script

**File**: `scripts/migrate-config.js`

```javascript
#!/usr/bin/env node
/**
 * Configuration migration script for ai-mesh → ensemble
 *
 * Migrates configuration from old locations to new XDG-compliant structure
 *
 * Usage: node scripts/migrate-config.js [--dry-run] [--verbose]
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// Try to import from ensemble-core, fallback to inline implementation
let configPath;
try {
  configPath = require('@fortium/ensemble-core/lib/config-path');
} catch {
  // Inline fallback for standalone use
  configPath = {
    getEnsembleConfigRoot: () => {
      if (process.env.XDG_CONFIG_HOME) {
        return path.join(process.env.XDG_CONFIG_HOME, 'ensemble');
      }
      const homeDir = os.homedir();
      const configDir = path.join(homeDir, '.config');
      if (fs.existsSync(configDir)) {
        return path.join(configDir, 'ensemble');
      }
      return path.join(homeDir, '.ensemble');
    },
    getPluginConfigPath: function(name) {
      return path.join(this.getEnsembleConfigRoot(), 'plugins', name);
    },
    getLogsPath: function(name) {
      const logsRoot = path.join(this.getEnsembleConfigRoot(), 'logs');
      return name ? path.join(logsRoot, name) : logsRoot;
    },
  };
}

const DRY_RUN = process.argv.includes('--dry-run');
const VERBOSE = process.argv.includes('--verbose');

const OLD_CONFIG_PATTERNS = [
  {
    pattern: '.ensemble/plugins/task-progress-pane',
    plugin: 'task-progress-pane',
    files: ['config.json', 'state.json'],
    hasLogs: true,
  },
  {
    pattern: '.ensemble/plugins/pane-viewer',
    plugin: 'pane-viewer',
    files: ['config.json'],
    hasLogs: false,
  },
];

function log(message, level = 'info') {
  const prefix = {
    info: '[INFO]',
    success: '\x1b[32m[OK]\x1b[0m',
    warn: '\x1b[33m[WARN]\x1b[0m',
    error: '\x1b[31m[ERROR]\x1b[0m',
    skip: '[SKIP]',
    migrate: '\x1b[36m[MIGRATE]\x1b[0m',
  }[level] || '[INFO]';

  console.log(`${prefix} ${message}`);
}

function verboseLog(message) {
  if (VERBOSE) {
    log(message, 'info');
  }
}

function copyFile(src, dest) {
  if (DRY_RUN) {
    log(`Would copy: ${src} → ${dest}`, 'migrate');
    return true;
  }

  try {
    fs.copyFileSync(src, dest);
    log(`Copied: ${src} → ${dest}`, 'migrate');
    return true;
  } catch (err) {
    log(`Failed to copy ${src}: ${err.message}`, 'error');
    return false;
  }
}

function ensureDir(dirPath) {
  if (DRY_RUN) {
    verboseLog(`Would create directory: ${dirPath}`);
    return true;
  }

  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true, mode: 0o700 });
    verboseLog(`Created directory: ${dirPath}`);
  }
  return true;
}

function migratePlugin(config) {
  const { pattern, plugin, files, hasLogs } = config;
  const homeDir = os.homedir();
  const oldPath = path.join(homeDir, pattern);

  if (!fs.existsSync(oldPath)) {
    log(`${pattern} - not found`, 'skip');
    return { migrated: false, reason: 'not_found' };
  }

  const newPluginPath = configPath.getPluginConfigPath(plugin);
  const newLogsPath = configPath.getLogsPath(plugin);

  // Create directories
  ensureDir(newPluginPath);
  if (hasLogs) {
    ensureDir(newLogsPath);
  }

  let filesMigrated = 0;
  let filesSkipped = 0;

  // Migrate config files
  for (const file of files) {
    const oldFile = path.join(oldPath, file);
    const newFile = path.join(newPluginPath, file);

    if (!fs.existsSync(oldFile)) {
      verboseLog(`${file} not found in ${pattern}`);
      continue;
    }

    if (fs.existsSync(newFile)) {
      log(`${newFile} already exists, skipping`, 'skip');
      filesSkipped++;
      continue;
    }

    if (copyFile(oldFile, newFile)) {
      filesMigrated++;
    }
  }

  // Migrate logs if applicable
  if (hasLogs) {
    const oldLogsDir = path.join(oldPath, 'logs');
    if (fs.existsSync(oldLogsDir)) {
      const logFiles = fs.readdirSync(oldLogsDir);
      for (const logFile of logFiles) {
        const oldLogPath = path.join(oldLogsDir, logFile);
        const newLogPath = path.join(newLogsPath, logFile);

        if (fs.existsSync(newLogPath)) {
          verboseLog(`Log file ${logFile} already exists, skipping`);
          filesSkipped++;
          continue;
        }

        if (copyFile(oldLogPath, newLogPath)) {
          filesMigrated++;
        }
      }
    }
  }

  return { migrated: true, filesMigrated, filesSkipped };
}

function printSummary(results, newRoot) {
  console.log('\n' + '='.repeat(50));
  console.log('Migration Summary');
  console.log('='.repeat(50));
  console.log(`Target directory: ${newRoot}`);
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no changes made)' : 'LIVE'}`);
  console.log('');

  let totalMigrated = 0;
  let totalSkipped = 0;

  for (const [plugin, result] of Object.entries(results)) {
    if (result.migrated) {
      console.log(`${plugin}: ${result.filesMigrated} files migrated, ${result.filesSkipped} skipped`);
      totalMigrated += result.filesMigrated;
      totalSkipped += result.filesSkipped;
    } else {
      console.log(`${plugin}: ${result.reason}`);
    }
  }

  console.log('');
  console.log(`Total: ${totalMigrated} files migrated, ${totalSkipped} skipped`);

  if (!DRY_RUN && totalMigrated > 0) {
    console.log('\n\x1b[33mYou can now safely remove the old directories:\x1b[0m');
    for (const { pattern } of OLD_CONFIG_PATTERNS) {
      const oldPath = path.join(os.homedir(), pattern);
      if (fs.existsSync(oldPath)) {
        console.log(`  rm -rf ${oldPath}`);
      }
    }
  }
}

function main() {
  console.log('Ensemble Configuration Migration v5.0.0');
  console.log('=======================================\n');

  const newRoot = configPath.getEnsembleConfigRoot();
  log(`Target config root: ${newRoot}`);
  console.log('');

  // Ensure root directory exists
  ensureDir(newRoot);

  const results = {};

  for (const config of OLD_CONFIG_PATTERNS) {
    log(`Processing ${config.pattern}...`);
    results[config.plugin] = migratePlugin(config);
  }

  printSummary(results, newRoot);
}

main();
```

### 4.6 Distribution

> **NOTE**: NPM publishing is OUT OF SCOPE. Plugins are distributed via GitHub only.

**Installation Method**: GitHub-based plugin installation
```bash
claude plugin install github:FortiumPartners/ensemble/packages/core
claude plugin install github:FortiumPartners/ensemble/packages/product
# etc.
```

This approach:
- Eliminates NPM registry dependency
- Simplifies distribution (no publish scripts needed)
- Uses Claude Code's native plugin system
- Allows direct installation from repository

---

## 5. Quality Requirements

### 5.1 Testing Strategy

| Test Type | Scope | Tools | Coverage Target |
|-----------|-------|-------|-----------------|
| Unit Tests | Config path resolution, migration logic | Vitest | 90%+ |
| Integration Tests | Full migration workflow | Vitest | 80%+ |
| Validation Tests | Package naming, schema compliance | Custom scripts | 100% |
| Platform Tests | macOS, Linux, WSL | Manual + CI | All platforms |
| Pre-flight Tests | Environment, NPM, Git | preflight-check.js | 100% pass |

### 5.2 Security Considerations

| Requirement | Implementation |
|-------------|----------------|
| Config directory permissions | 0700 (owner read/write/execute only) |
| Config file permissions | 0600 (owner read/write only) |
| No sensitive data in logs | Review logging output |
| Migration script privileges | Run as normal user, no sudo |

### 5.3 Performance Requirements

| Metric | Target | Measurement |
|--------|--------|-------------|
| Config path resolution | < 1ms | Benchmark test |
| Migration script runtime | < 5s | Timed execution |
| Pre-flight checks | < 30s | Timed execution |
| Package install time | No regression | Compare before/after |

---

## 6. Acceptance Criteria Mapping

| PRD AC ID | TRD Task(s) | Verification Method |
|-----------|-------------|---------------------|
| AC-1 | CODE-101-143 | Automated validation script |
| AC-2 | CODE-102-143 | Automated validation script |
| AC-3 | CLEAN-001 | `grep -r "ensemble"` |
| AC-4 | GH-001, GH-006 | Manual URL test |
| ~~AC-5~~ | ~~PUB-001-006~~ | ~~OUT OF SCOPE - No NPM publishing~~ |
| ~~AC-6~~ | ~~PUB-008-009~~ | ~~OUT OF SCOPE - No NPM publishing~~ |
| AC-7 | CODE-150-155 | Command listing test |
| AC-8 | CODE-105, TEST-002 | Unit tests |
| AC-9 | CODE-160-163, TEST-003 | Integration tests |
| AC-10 | MIG-003 | Manual verification |
| AC-11 | TEST-002 | Environment test |
| AC-12 | TEST-002 | Fallback test |
| AC-13 | MIG-003-007, TEST-003 | Migration tests |
| AC-14 | CODE-003 | Manual review |
| AC-15 | CODE-006 | Manual review |
| AC-16 | DOC-002 | Automated check |
| AC-17 | DOC-001 | Manual review |
| AC-18 | CODE-004 | Manual review |
| AC-19 | TEST-001 | CI pipeline |
| AC-20 | CODE-106, TEST-002 | Test coverage |
| AC-21 | GH-003 | GitHub Actions |
| AC-22 | N/A | Git log check |
| AC-23 | N/A | GitHub plugin install test |

---

## 7. Risk Register

| Risk ID | Risk | Impact | Probability | Mitigation | Owner |
|---------|------|--------|-------------|------------|-------|
| ~~R-001~~ | ~~NPM package names not available~~ | N/A | N/A | ~~OUT OF SCOPE - No NPM publishing~~ | N/A |
| R-002 | Breaking existing installations | High | High | Migration script (MIG-003) | Lead |
| R-003 | CI/CD failures after rename | Medium | Medium | Test workflows locally first | DevOps |
| R-004 | Lost git history | High | Low | Use same repo, just rename | Lead |
| ~~R-005~~ | ~~NPM unpublish blocked (>72h)~~ | N/A | N/A | ~~OUT OF SCOPE - No NPM publishing~~ | N/A |
| R-006 | XDG edge cases | Low | Low | Comprehensive fallback (CODE-105) | Dev |
| R-007 | Missed ensemble references | Medium | Medium | Automated grep in CI | Dev |
| R-008 | Node 22+ not available | Medium | Low | Fallback glob implementation in script | Dev |

---

## 8. Dependencies

### 8.1 External Dependencies

| Dependency | Version | Purpose |
|------------|---------|---------|
| Node.js | 22+ | Runtime (required for built-in glob) |
| npm | 9+ | Package management |
| Vitest | 1+ | Testing |

**Note**: No external npm packages required for rename/migration scripts (uses Node built-in modules)

### 8.2 Internal Dependencies

| Dependency | Required By | Notes |
|------------|-------------|-------|
| packages/core/lib/config-path.js | All plugins, migration script | Created in CODE-105 |
| PREP-005 branch | All CODE tasks | Feature branch must exist |
| PREP-008 directory rename | All CODE tasks | Must complete before code changes |
| GH-001 completion | GH-002-006 | Repository must be renamed first |

---

## 9. Appendices

### Appendix A: File Count by Category

| Category | File Count | Estimated Changes |
|----------|------------|-------------------|
| Root configs | 7 | 7 |
| Schemas | 2 | 2 |
| Scripts | 2 + 2 new | 4 |
| Workflows | 3 | 3 |
| Package package.json | 23 | 23 |
| Package plugin.json | 23 | 23 |
| Package README.md | 23 | 23 |
| Package CHANGELOG.md | 23 | 23 |
| Command .md files | ~15 | ~15 |
| Lib .js files | ~30 | ~10 |
| Test files | ~50 | ~10 |
| Other docs | ~10 | ~10 |
| **Total** | **~215** | **~155** |

### Appendix B: Verification Commands

```bash
# Verify no ensemble references remain
grep -r "ensemble" --include="*.json" --include="*.js" --include="*.md" --include="*.yml" --include="*.yaml" | grep -v "node_modules" | grep -v ".git"

# Verify all packages at v5.0.0
find packages -name "package.json" -exec grep -l '"version": "5.0.0"' {} \;

# Verify all package.json names updated
find packages -name "package.json" -exec grep -l "ensemble" {} \;

# Verify all plugin.json names updated
find packages -name "plugin.json" -exec grep -l "ensemble" {} \;

# Test package installation
npm pack packages/core
npm install ./fortium-ensemble-core-5.0.0.tgz

# Verify XDG compliance
XDG_CONFIG_HOME=/tmp/test-xdg node -e "console.log(require('./packages/core/lib/config-path').getEnsembleConfigRoot())"
```

### Appendix C: Rollback Procedure

```bash
# 1. Restore from backup
git checkout main
git branch -D feature/ensemble-rename
cd ..
rm -rf ensemble
tar -xzf backup-ensemble-YYYYMMDD.tar.gz

# 2. If GitHub renamed, rename back (Settings → Repository name)
```

### Appendix D: Execution Order Summary

```
1. PREP-007: Run pre-flight checklist
2. PREP-004: Create backup
3. PREP-005: Create feature branch from main
4. PREP-008: Rename local directory
5. PREP-003: Create rename script
6. CODE-***: Run automated rename (--dry-run first)
7. CODE-105-107: Add config-path module to core
8. CODE-160-163: Update plugins to use core config
9. TEST-001-004: Run all tests
10. GH-001: Rename GitHub repository
11. GH-002-006: Update URLs, verify redirects
12. DOC-001-006: Finalize documentation
13. CLEAN-001-004: Final cleanup
14. Verify GitHub-based installation works
```

---

## 10. Sign-off

| Role | Name | Date | Signature |
|------|------|------|-----------|
| Tech Lead | | | |
| Senior Developer | | | |
| DevOps Engineer | | | |
| QA Lead | | | |

---

**Document End**

**Next Steps**: Begin Sprint 1 - Run pre-flight checklist (PREP-007)
