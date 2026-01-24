# Product Requirements Document: Rename pane-viewer to agent-progress-pane

**Product Name:** Ensemble Agent Progress Pane (Rename)
**Version:** 1.0.0
**Status:** Draft
**Created:** 2025-12-16
**Last Updated:** 2025-12-16
**Author:** Ensemble Product Team

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Problem Statement](#problem-statement)
3. [Solution Overview](#solution-overview)
4. [User Analysis](#user-analysis)
5. [Goals & Non-Goals](#goals--non-goals)
6. [Functional Requirements](#functional-requirements)
7. [Non-Functional Requirements](#non-functional-requirements)
8. [Migration Plan](#migration-plan)
9. [Acceptance Criteria](#acceptance-criteria)
10. [Dependencies & Risks](#dependencies--risks)
11. [Success Metrics](#success-metrics)

---

## Executive Summary

### Product Vision

Rename the `ensemble-pane-viewer` plugin to `ensemble-agent-progress-pane` to better reflect its primary purpose: real-time monitoring of subagent progress and tool invocations. This name aligns with its sibling plugin `ensemble-task-progress-pane` (which monitors TodoWrite task progress) and creates a clear, intuitive naming convention.

### Value Proposition

- **Clarity**: "Agent Progress Pane" immediately conveys that this plugin shows agent activity progress
- **Consistency**: Naming pattern matches `task-progress-pane` creating a cohesive pane family
- **Discoverability**: Users searching for "agent" or "progress" monitoring will find this plugin
- **Semantic Accuracy**: "pane-viewer" is generic; "agent-progress-pane" is descriptive

### Current vs Proposed Naming

| Current | Proposed |
|---------|----------|
| `ensemble-pane-viewer` | `ensemble-agent-progress-pane` |
| `pane-viewer` (package folder) | `agent-progress-pane` |
| "Subagent monitoring in terminal panes" | "Real-time agent progress visualization" |

---

## Problem Statement

### Current State

The `ensemble-pane-viewer` plugin provides real-time monitoring of subagent activity in terminal panes. However, its name creates several issues:

1. **Ambiguity**: "pane-viewer" could mean viewing any pane content, not specifically agent progress
2. **Inconsistency**: The sibling plugin for task monitoring is named `task-progress-pane`, creating asymmetry
3. **Poor Discoverability**: Users searching for "agent monitoring" or "subagent progress" may not find it
4. **Confusion**: Two related plugins with dissimilar naming conventions (`pane-viewer` vs `task-progress-pane`)

### Pain Points

| Pain Point | Impact | Frequency |
|------------|--------|-----------|
| Unclear purpose from name | Users skip over plugin during discovery | Every new user |
| Naming inconsistency with task-progress-pane | Mental overhead to remember both names | Daily use |
| Search/discovery issues | Users don't find the plugin when needed | Plugin installation |
| Documentation confusion | Hard to explain relationship between plugins | Onboarding |

### Impact

- **Adoption**: Potential users may not install because they don't understand its purpose
- **Usability**: Cognitive load to remember asymmetric naming
- **Documentation**: Extra effort explaining the relationship to task-progress-pane
- **Brand**: Inconsistent naming reflects poorly on ecosystem coherence

---

## Solution Overview

### High-Level Solution

Rename the plugin across all touchpoints:

1. **Package Name**: `ensemble-pane-viewer` → `ensemble-agent-progress-pane`
2. **Package Folder**: `packages/pane-viewer/` → `packages/agent-progress-pane/`
3. **NPM Package**: `@fortium/ensemble-pane-viewer` → `@fortium/ensemble-agent-progress-pane`
4. **Plugin Registry**: Update marketplace.json entry
5. **Documentation**: Update all references in README, CLAUDE.md, and other docs
6. **Configuration**: Update default config paths

### Naming Rationale

| Component | Rationale |
|-----------|-----------|
| "agent" | Monitors subagent (Task tool) activity, not generic terminal content |
| "progress" | Shows real-time progress of agent tool invocations |
| "pane" | Renders in a terminal multiplexer pane |

### Plugin Family After Rename

| Plugin | Purpose | Monitors |
|--------|---------|----------|
| `ensemble-agent-progress-pane` | Agent activity visualization | Task tool (subagent) invocations |
| `ensemble-task-progress-pane` | Task progress visualization | TodoWrite tool invocations |

---

## User Analysis

### Primary Users

#### Persona 1: Existing Users

**Profile:**
- Currently uses `ensemble-pane-viewer`
- Has configuration files referencing old name
- May have automation/scripts using plugin name

**Needs:**
- Seamless migration with minimal disruption
- Clear migration documentation
- Configuration paths that continue to work (or auto-migrate)

**Pain Points:**
- Breaking changes to workflows
- Manual configuration updates
- Confusion during transition period

#### Persona 2: New Users

**Profile:**
- Discovering Ensemble plugins for first time
- Looking for agent monitoring capabilities
- Comparing plugins to understand ecosystem

**Needs:**
- Clear, descriptive plugin names
- Consistent naming patterns
- Easy discovery through search

**Pain Points:**
- Ambiguous plugin names
- Unclear relationships between plugins

### User Journey

```
┌─────────────────────────────────────────────────────────────────────┐
│                     Migration User Journey                           │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  1. AWARENESS         2. MIGRATION          3. ADOPTION              │
│  ───────────          ──────────            ─────────               │
│                                                                      │
│  User sees rename     Auto-migration        Uses new name            │
│  announcement         scripts run           naturally                │
│        │                    │                    │                   │
│        ▼                    ▼                    ▼                   │
│  ┌──────────┐        ┌──────────────┐     ┌──────────────┐          │
│  │ Read     │───────▶│  Run migrate │────▶│  Update any  │          │
│  │ changelog│        │  command or  │     │  custom      │          │
│  └──────────┘        │  reinstall   │     │  references  │          │
│                      └──────────────┘     └──────────────┘          │
│                                                                      │
│  EMOTIONS:           EMOTIONS:            EMOTIONS:                  │
│  Curiosity           Confidence           Satisfaction               │
│  Concern             Relief               Clarity                    │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Goals & Non-Goals

### Goals

| ID | Goal | Priority | Success Metric |
|----|------|----------|----------------|
| G1 | Rename package to `agent-progress-pane` | P0 | All references updated |
| G2 | Maintain backward compatibility for config | P0 | Existing configs work |
| G3 | Update all documentation references | P0 | No broken links/refs |
| G4 | Provide migration path for existing users | P1 | Migration script works |
| G5 | Update marketplace.json registry | P0 | Plugin installable |
| G6 | Update CLAUDE.md and README.md | P0 | Docs accurate |
| G7 | Preserve git history where possible | P2 | `git log --follow` works |

### Non-Goals

| ID | Non-Goal | Rationale |
|----|----------|-----------|
| NG1 | Add new features during rename | Scope creep; pure rename operation |
| NG2 | Change internal API/interfaces | Only naming changes |
| NG3 | Rename multiplexer-adapters package | Shared library, name is appropriate |
| NG4 | Rename task-progress-pane | Already correctly named |
| NG5 | Create alias for old name permanently | Clean break preferred |

### Scope Boundaries

**In Scope:**
- Package folder rename: `pane-viewer/` → `agent-progress-pane/`
- NPM package name change
- Plugin manifest (plugin.json) updates
- marketplace.json updates
- Documentation updates (README.md, CLAUDE.md, etc.)
- Configuration path updates with backward compatibility
- Migration script for existing installations
- Update imports/references in dependent code

**Out of Scope:**
- Feature changes to the plugin
- API/interface modifications
- Changes to multiplexer-adapters package
- Renaming other packages
- Extended deprecation period with dual-naming

---

## Functional Requirements

### FR1: Package Renaming

**Description:** Rename the package folder and npm package name

**Requirements:**
| ID | Requirement | Priority |
|----|-------------|----------|
| FR1.1 | Rename folder from `packages/pane-viewer/` to `packages/agent-progress-pane/` | P0 |
| FR1.2 | Update `package.json` name to `@fortium/ensemble-agent-progress-pane` | P0 |
| FR1.3 | Update `plugin.json` name to `ensemble-agent-progress-pane` | P0 |
| FR1.4 | Update description to "Real-time agent progress visualization in terminal panes" | P0 |
| FR1.5 | Update keywords to include "agent", "progress", "monitoring" | P1 |

### FR2: Marketplace Registry Update

**Description:** Update the plugin marketplace entry

**Requirements:**
| ID | Requirement | Priority |
|----|-------------|----------|
| FR2.1 | Update `marketplace.json` plugin entry name | P0 |
| FR2.2 | Update plugin path reference | P0 |
| FR2.3 | Update plugin description | P0 |
| FR2.4 | Verify plugin can be installed with new name | P0 |

### FR3: Documentation Updates

**Description:** Update all documentation references

**Requirements:**
| ID | Requirement | Priority |
|----|-------------|----------|
| FR3.1 | Update main README.md references | P0 |
| FR3.2 | Update CLAUDE.md references | P0 |
| FR3.3 | Update package README.md | P0 |
| FR3.4 | Update IMPLEMENTATION.md | P0 |
| FR3.5 | Update CHANGELOG.md with rename entry | P0 |
| FR3.6 | Update any cross-references in other packages | P0 |

### FR4: Configuration Compatibility

**Description:** Handle configuration path changes gracefully

**Requirements:**
| ID | Requirement | Priority |
|----|-------------|----------|
| FR4.1 | New config path: `~/.config/ensemble/plugins/agent-progress-pane/` | P0 |
| FR4.2 | Fall back to old path if new doesn't exist | P1 |
| FR4.3 | Auto-migrate config on first run (optional) | P2 |
| FR4.4 | Document config migration in README | P0 |

**Config Path Migration:**
```
Old: ~/.config/ensemble/plugins/pane-viewer/config.json
New: ~/.config/ensemble/plugins/agent-progress-pane/config.json
```

### FR5: Internal Code Updates

**Description:** Update internal references

**Requirements:**
| ID | Requirement | Priority |
|----|-------------|----------|
| FR5.1 | Update imports in hooks that reference package name | P0 |
| FR5.2 | Update any hardcoded "pane-viewer" strings | P0 |
| FR5.3 | Update test file references | P0 |
| FR5.4 | Update command names if applicable | P1 |
| FR5.5 | Update skill names if applicable | P1 |

### FR6: Migration Support

**Description:** Provide migration path for existing users

**Requirements:**
| ID | Requirement | Priority |
|----|-------------|----------|
| FR6.1 | Update migration script for config paths | P1 |
| FR6.2 | Document uninstall/reinstall procedure | P0 |
| FR6.3 | Add upgrade notes to CHANGELOG | P0 |

---

## Non-Functional Requirements

### NFR1: Backward Compatibility

| ID | Requirement | Target |
|----|-------------|--------|
| NFR1.1 | Existing configs continue to work for 1 release | 100% compatibility |
| NFR1.2 | Clear migration path documented | Complete guide |
| NFR1.3 | No data loss during migration | Zero data loss |

### NFR2: Quality Assurance

| ID | Requirement | Target |
|----|-------------|--------|
| NFR2.1 | All existing tests pass after rename | 100% pass rate |
| NFR2.2 | Plugin validation passes | `npm run validate` succeeds |
| NFR2.3 | Installation test succeeds | Clean install works |

### NFR3: Documentation

| ID | Requirement | Target |
|----|-------------|--------|
| NFR3.1 | All doc references updated | Zero stale references |
| NFR3.2 | Migration guide complete | Step-by-step instructions |
| NFR3.3 | CHANGELOG documents rename | Entry added |

---

## Migration Plan

### Phase 1: Code Changes

1. Rename package folder
2. Update package.json and plugin.json
3. Update internal references
4. Update tests

### Phase 2: Registry Updates

1. Update marketplace.json
2. Test plugin installation

### Phase 3: Documentation

1. Update README.md (root)
2. Update CLAUDE.md
3. Update package README.md
4. Update other docs
5. Add CHANGELOG entry

### Phase 4: Release

1. Commit all changes
2. Tag release
3. Push to GitHub
4. Update marketplace from GitHub

### Migration Script Update

Update `scripts/migrate-config.js` to include:

```javascript
const migrations = [
  // Existing migrations...
  {
    source: '~/.config/ensemble/plugins/pane-viewer/',
    target: '~/.config/ensemble/plugins/agent-progress-pane/',
    description: 'Migrate pane-viewer config to agent-progress-pane'
  }
];
```

---

## Acceptance Criteria

### AC1: Package Rename

| ID | Criteria | Test Method |
|----|----------|-------------|
| AC1.1 | Package folder is `packages/agent-progress-pane/` | File system check |
| AC1.2 | npm package name is `@fortium/ensemble-agent-progress-pane` | package.json check |
| AC1.3 | Plugin name in manifest is `ensemble-agent-progress-pane` | plugin.json check |
| AC1.4 | `npm run validate` passes | CLI verification |

### AC2: Installation

| ID | Criteria | Test Method |
|----|----------|-------------|
| AC2.1 | Plugin installs with `claude plugin install github:FortiumPartners/ensemble/packages/agent-progress-pane` | CLI test |
| AC2.2 | Plugin appears in `claude plugin list` | CLI test |
| AC2.3 | Plugin hooks execute correctly | E2E test |

### AC3: Documentation

| ID | Criteria | Test Method |
|----|----------|-------------|
| AC3.1 | README.md references new name | Manual review |
| AC3.2 | CLAUDE.md references new name | Manual review |
| AC3.3 | No references to "pane-viewer" remain (except migration docs) | Grep search |
| AC3.4 | CHANGELOG includes rename entry | Manual review |

### AC4: Configuration

| ID | Criteria | Test Method |
|----|----------|-------------|
| AC4.1 | New config path works | Integration test |
| AC4.2 | Old config path falls back correctly | Integration test |
| AC4.3 | Migration script handles new paths | Script test |

### AC5: Tests

| ID | Criteria | Test Method |
|----|----------|-------------|
| AC5.1 | All existing tests pass | `npm test` |
| AC5.2 | Test files reference correct paths | Code review |

---

## Dependencies & Risks

### Dependencies

| Dependency | Type | Mitigation |
|------------|------|------------|
| Claude Code plugin system | External | Follow documented patterns |
| GitHub repository | External | Coordinate release |
| Existing user configurations | User | Migration script/docs |
| marketplace.json format | Internal | Test validation |

### Technical Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Broken links in documentation | Medium | Low | Thorough grep search |
| User config not migrated | Low | Medium | Clear migration docs |
| Git history loss | Low | Low | Use `git mv` for folder rename |
| Cached old version in Claude | Medium | Low | Document reinstall procedure |

### Assumptions

1. Users can reinstall plugins when needed
2. Breaking changes are acceptable with clear migration path
3. One-time migration effort is acceptable
4. Documentation will be updated across all affected files

---

## Success Metrics

### Quantitative Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Documentation references updated | 100% | Grep search |
| Tests passing | 100% | CI/CD |
| Plugin validation | Pass | npm run validate |
| Zero regressions | 0 new bugs | Testing |

### Qualitative Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Naming clarity | "Clear purpose" | User feedback |
| Naming consistency | "Matches task-progress-pane" | Review |
| Migration ease | "Straightforward" | User feedback |

---

## Files to Update

### Package Files

| File | Change |
|------|--------|
| `packages/pane-viewer/` | Rename to `packages/agent-progress-pane/` |
| `package.json` | Update name to `@fortium/ensemble-agent-progress-pane` |
| `.claude-plugin/plugin.json` | Update name and description |
| `README.md` (package) | Update all references |
| `CHANGELOG.md` (package) | Add rename entry |
| `IMPLEMENTATION.md` | Update references |

### Root Files

| File | Change |
|------|--------|
| `README.md` | Update package list and references |
| `CLAUDE.md` | Update package references |
| `marketplace.json` | Update plugin entry |
| `package.json` (root) | Update workspace reference if needed |

### Related Package Files

| File | Change |
|------|--------|
| `packages/task-progress-pane/README.md` | Update cross-references |
| Any files referencing `pane-viewer` | Update to `agent-progress-pane` |

### Scripts

| File | Change |
|------|--------|
| `scripts/migrate-config.js` | Add new migration path |

---

## Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0.0 | 2025-12-16 | Ensemble Team | Initial PRD for rename |

---

**Document Status:** Draft - Ready for Review

**Next Steps:**
1. Review PRD with stakeholders
2. Approve rename scope
3. Execute migration plan
4. Release v5.1.0 with rename
