# Technical Requirements Document: Rename pane-viewer to agent-progress-pane

**Project Name:** Ensemble Agent Progress Pane (Rename)
**Version:** 1.0.0
**Status:** Ready for Implementation
**Created:** 2025-12-16
**Last Updated:** 2025-12-16
**Author:** Ensemble Engineering Team
**PRD Reference:** [agent-progress-pane-rename.md](../PRD/agent-progress-pane-rename.md)

---

## Table of Contents

1. [Overview](#overview)
2. [Master Task List](#master-task-list)
3. [System Architecture](#system-architecture)
4. [Sprint Planning](#sprint-planning)
5. [Technical Specifications](#technical-specifications)
6. [Acceptance Criteria](#acceptance-criteria)
7. [Quality Requirements](#quality-requirements)
8. [Implementation Details](#implementation-details)

---

## Overview

### Objective

Rename the `ensemble-pane-viewer` plugin to `ensemble-agent-progress-pane` across all codebase touchpoints, ensuring backward compatibility for configuration and providing a clear migration path for existing users.

### Scope Summary

| Category | Items |
|----------|-------|
| Files to Rename | 1 directory |
| Files to Update | ~30 files |
| New Config Paths | 1 |
| Migration Scripts | 1 update |
| Tests to Update | ~6 test files |

### Naming Transformation

```
ensemble-pane-viewer        → ensemble-agent-progress-pane
@fortium/ensemble-pane-viewer → @fortium/ensemble-agent-progress-pane
packages/pane-viewer/       → packages/agent-progress-pane/
pane-viewer (config)        → agent-progress-pane
```

---

## Master Task List

### Task ID Convention

- `RENAME-XXX`: Core rename tasks
- `DOC-XXX`: Documentation updates
- `CONFIG-XXX`: Configuration and migration tasks
- `TEST-XXX`: Testing and validation tasks
- `RELEASE-XXX`: Release and deployment tasks

### Complete Task Registry

| Task ID | Description | Priority | Status | Dependencies | Estimate |
|---------|-------------|----------|--------|--------------|----------|
| RENAME-001 | Rename package directory | P0 | [ ] Pending | None | 5m |
| RENAME-002 | Update package.json name | P0 | [ ] Pending | RENAME-001 | 2m |
| RENAME-003 | Update plugin.json manifest | P0 | [ ] Pending | RENAME-001 | 2m |
| RENAME-004 | Update internal string references | P0 | [ ] Pending | RENAME-001 | 10m |
| RENAME-005 | Update marketplace.json entry | P0 | [ ] Pending | RENAME-001 | 5m |
| CONFIG-001 | Update config path in hooks | P0 | [ ] Pending | RENAME-001 | 10m |
| CONFIG-002 | Add backward compatibility fallback | P1 | [ ] Pending | CONFIG-001 | 15m |
| CONFIG-003 | Update migration script | P1 | [ ] Pending | CONFIG-001 | 10m |
| DOC-001 | Update root README.md | P0 | [ ] Pending | RENAME-001 | 5m |
| DOC-002 | Update CLAUDE.md | P0 | [ ] Pending | RENAME-001 | 5m |
| DOC-003 | Update package README.md | P0 | [ ] Pending | RENAME-001 | 10m |
| DOC-004 | Update IMPLEMENTATION.md | P0 | [ ] Pending | RENAME-001 | 5m |
| DOC-005 | Update CHANGELOG.md (package) | P0 | [ ] Pending | RENAME-001 | 5m |
| DOC-006 | Update CHANGELOG.md (root) | P0 | [ ] Pending | DOC-005 | 5m |
| DOC-007 | Update other doc references | P1 | [ ] Pending | RENAME-001 | 15m |
| DOC-008 | Update cross-package references | P1 | [ ] Pending | RENAME-001 | 10m |
| TEST-001 | Update test file references | P0 | [ ] Pending | RENAME-001 | 10m |
| TEST-002 | Run all tests | P0 | [ ] Pending | TEST-001 | 5m |
| TEST-003 | Run plugin validation | P0 | [ ] Pending | RENAME-005 | 2m |
| TEST-004 | Test backward compat config | P1 | [ ] Pending | CONFIG-002 | 10m |
| RELEASE-001 | Commit all changes | P0 | [ ] Pending | TEST-003 | 5m |
| RELEASE-002 | Push to GitHub | P0 | [ ] Pending | RELEASE-001 | 2m |
| RELEASE-003 | Test plugin installation | P0 | [ ] Pending | RELEASE-002 | 5m |

**Total Estimated Time:** ~2-3 hours

---

## System Architecture

### File Structure Transformation

```
BEFORE:                                 AFTER:
packages/                               packages/
├── pane-viewer/                       ├── agent-progress-pane/
│   ├── .claude-plugin/                │   ├── .claude-plugin/
│   │   └── plugin.json                │   │   └── plugin.json (updated)
│   ├── package.json                   │   ├── package.json (updated)
│   ├── hooks/                         │   ├── hooks/
│   │   ├── hooks.json                 │   │   ├── hooks.json
│   │   ├── pane-spawner.js            │   │   ├── pane-spawner.js (updated)
│   │   ├── pane-manager.js            │   │   ├── pane-manager.js (updated)
│   │   └── adapters/                  │   │   └── adapters/
│   ├── tests/                         │   ├── tests/ (updated refs)
│   ├── README.md                      │   ├── README.md (updated)
│   └── ...                            │   └── ...
```

### Configuration Path Migration

```
OLD CONFIG PATHS:
~/.config/ensemble/plugins/pane-viewer/config.json
~/.ensemble/plugins/pane-viewer/config.json

NEW CONFIG PATHS:
~/.config/ensemble/plugins/agent-progress-pane/config.json
~/.ensemble/plugins/agent-progress-pane/config.json

FALLBACK LOGIC:
1. Check new path first
2. If not found, check old path
3. If old path found, use it (backward compat)
4. Migration script available to move config
```

### Reference Dependency Graph

```
marketplace.json
      │
      ├── packages/agent-progress-pane/
      │   ├── .claude-plugin/plugin.json
      │   ├── package.json
      │   ├── hooks/pane-spawner.js ──► config path
      │   └── hooks/pane-manager.js ──► config path
      │
      ├── packages/full/
      │   ├── package.json ──► dependency reference
      │   └── lib/index.js ──► re-export reference
      │
      └── Root Files
          ├── README.md
          ├── CLAUDE.md
          └── scripts/migrate-config.js
```

---

## Sprint Planning

### Sprint 1: Core Rename (P0 Tasks)

**Duration:** 1-2 hours
**Goal:** Complete all critical rename operations

#### Phase 1.1: Directory Rename
- [ ] **RENAME-001**: Rename `packages/pane-viewer/` to `packages/agent-progress-pane/`
  ```bash
  git mv packages/pane-viewer packages/agent-progress-pane
  ```

#### Phase 1.2: Package Configuration
- [ ] **RENAME-002**: Update `packages/agent-progress-pane/package.json`
  - Change `name` from `@fortium/ensemble-pane-viewer` to `@fortium/ensemble-agent-progress-pane`
  - Update `description` to "Real-time agent progress visualization in terminal panes"
  - Add keywords: "agent", "progress", "monitoring"

- [ ] **RENAME-003**: Update `packages/agent-progress-pane/.claude-plugin/plugin.json`
  - Change `name` from `ensemble-pane-viewer` to `ensemble-agent-progress-pane`
  - Update `description`

#### Phase 1.3: Registry Update
- [ ] **RENAME-005**: Update `marketplace.json`
  - Change plugin `name` from `ensemble-pane-viewer` to `ensemble-agent-progress-pane`
  - Update `source` path from `./packages/pane-viewer` to `./packages/agent-progress-pane`
  - Update `description` and `tags`

#### Phase 1.4: Internal References
- [ ] **RENAME-004**: Update internal string references
  - `hooks/pane-spawner.js`: Update CONFIG_PATH constant
  - `hooks/pane-manager.js`: Update any hardcoded paths
  - `lib/config-loader.js`: Update plugin name references

### Sprint 2: Configuration & Migration (P1 Tasks)

**Duration:** 30-45 minutes
**Goal:** Ensure backward compatibility and migration support

- [ ] **CONFIG-001**: Update config path in hooks
  ```javascript
  // OLD
  const CONFIG_PATH = path.join(os.homedir(), '.ensemble/plugins/pane-viewer', 'config.json');

  // NEW
  const CONFIG_PATH = path.join(os.homedir(), '.ensemble/plugins/agent-progress-pane', 'config.json');
  ```

- [ ] **CONFIG-002**: Add backward compatibility fallback
  ```javascript
  function loadConfig() {
    const newPath = getConfigPath('agent-progress-pane');
    const oldPath = getConfigPath('pane-viewer');

    if (fs.existsSync(newPath)) {
      return JSON.parse(fs.readFileSync(newPath, 'utf-8'));
    }
    // Backward compatibility: check old path
    if (fs.existsSync(oldPath)) {
      return JSON.parse(fs.readFileSync(oldPath, 'utf-8'));
    }
    return getDefaultConfig();
  }
  ```

- [ ] **CONFIG-003**: Update `scripts/migrate-config.js`
  - Add migration entry for pane-viewer → agent-progress-pane

### Sprint 3: Documentation (P0-P1 Tasks)

**Duration:** 30-45 minutes
**Goal:** Update all documentation references

#### Critical Documentation (P0)
- [ ] **DOC-001**: Update `README.md` (root)
  - Change "ensemble-pane-viewer" to "ensemble-agent-progress-pane"
  - Update installation commands
  - Update package list

- [ ] **DOC-002**: Update `CLAUDE.md`
  - Update package references
  - Update quick reference section

- [ ] **DOC-003**: Update `packages/agent-progress-pane/README.md`
  - Update title and all internal references
  - Update installation instructions

- [ ] **DOC-004**: Update `packages/agent-progress-pane/IMPLEMENTATION.md`
  - Update file paths and references

- [ ] **DOC-005**: Add CHANGELOG entry in package
  ```markdown
  ## [5.1.0] - 2025-12-16

  ### Changed
  - **BREAKING**: Renamed plugin from `ensemble-pane-viewer` to `ensemble-agent-progress-pane`
  - Updated config path from `pane-viewer/` to `agent-progress-pane/`

  ### Added
  - Backward compatibility for old config path
  - Migration support via `scripts/migrate-config.js`
  ```

- [ ] **DOC-006**: Add CHANGELOG entry in root

#### Secondary Documentation (P1)
- [ ] **DOC-007**: Update other docs
  - `QUICKSTART.md`
  - `INDEX.md`
  - `docs/MIGRATION_DASHBOARD.md`
  - `docs/VERSIONING_STRATEGY.md`
  - `packages/agent-progress-pane/docs/CONFIGURATION.md`
  - `packages/agent-progress-pane/docs/TROUBLESHOOTING.md`

- [ ] **DOC-008**: Update cross-package references
  - `packages/task-progress-pane/README.md`
  - `packages/full/package.json`
  - `packages/full/lib/index.js`

### Sprint 4: Testing & Validation (P0 Tasks)

**Duration:** 15-20 minutes
**Goal:** Verify all changes work correctly

- [ ] **TEST-001**: Update test file references
  - `tests/config-loader.test.js`
  - `tests/pane-manager.test.js`
  - `tests/performance/benchmark.test.js`
  - `tests/e2e/workflow.test.js`

- [ ] **TEST-002**: Run all tests
  ```bash
  npm test
  ```

- [ ] **TEST-003**: Run plugin validation
  ```bash
  npm run validate
  ```

- [ ] **TEST-004**: Test backward compatibility
  - Create config at old path
  - Verify plugin reads it correctly
  - Test migration script

### Sprint 5: Release (P0 Tasks)

**Duration:** 10-15 minutes
**Goal:** Deploy changes

- [ ] **RELEASE-001**: Commit all changes
  ```bash
  git add -A
  git commit -m "feat: rename pane-viewer to agent-progress-pane

  BREAKING CHANGE: Plugin renamed for clarity and consistency
  - ensemble-pane-viewer → ensemble-agent-progress-pane
  - Config path: pane-viewer/ → agent-progress-pane/
  - Backward compatibility for old config path included

  Migration: Run 'node scripts/migrate-config.js' to migrate configs"
  ```

- [ ] **RELEASE-002**: Push to GitHub
  ```bash
  git push origin main
  ```

- [ ] **RELEASE-003**: Test plugin installation
  ```bash
  # Uninstall old plugin
  claude plugin uninstall ensemble-pane-viewer@ensemble

  # Install new plugin
  claude plugin install github:FortiumPartners/ensemble/packages/agent-progress-pane

  # Verify installation
  claude plugin list
  ```

---

## Technical Specifications

### Files to Modify

#### Package Files (agent-progress-pane)

| File | Changes Required |
|------|------------------|
| `package.json` | Update `name`, `description`, `keywords` |
| `.claude-plugin/plugin.json` | Update `name`, `description`, `keywords` |
| `hooks/pane-spawner.js` | Update CONFIG_PATH, add fallback |
| `hooks/pane-manager.js` | Update any path references |
| `lib/config-loader.js` | Update plugin name, add fallback |
| `README.md` | Update all references |
| `IMPLEMENTATION.md` | Update file paths |
| `CHANGELOG.md` | Add rename entry |
| `docs/CONFIGURATION.md` | Update config paths |
| `docs/TROUBLESHOOTING.md` | Update references |

#### Root Files

| File | Changes Required |
|------|------------------|
| `marketplace.json` | Update plugin entry |
| `README.md` | Update package list, installation |
| `CLAUDE.md` | Update package references |
| `CHANGELOG.md` | Add rename entry |
| `QUICKSTART.md` | Update references |
| `INDEX.md` | Update references |
| `scripts/migrate-config.js` | Add new migration path |

#### Related Package Files

| File | Changes Required |
|------|------------------|
| `packages/full/package.json` | Update dependency name |
| `packages/full/lib/index.js` | Update re-export |
| `packages/task-progress-pane/README.md` | Update cross-references |

#### Test Files

| File | Changes Required |
|------|------------------|
| `tests/config-loader.test.js` | Update path references |
| `tests/pane-manager.test.js` | Update path references |
| `tests/performance/benchmark.test.js` | Update imports |
| `tests/e2e/workflow.test.js` | Update references |

### Code Changes

#### pane-spawner.js Config Path Update

```javascript
// BEFORE
const CONFIG_PATH = path.join(os.homedir(), '.ensemble/plugins/pane-viewer', 'config.json');

// AFTER (with backward compatibility)
const NEW_CONFIG_PATH = path.join(os.homedir(), '.ensemble/plugins/agent-progress-pane', 'config.json');
const OLD_CONFIG_PATH = path.join(os.homedir(), '.ensemble/plugins/pane-viewer', 'config.json');

function loadConfig() {
  try {
    // Try new path first
    if (fs.existsSync(NEW_CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(NEW_CONFIG_PATH, 'utf-8'));
    }
    // Backward compatibility: check old path
    if (fs.existsSync(OLD_CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(OLD_CONFIG_PATH, 'utf-8'));
    }
  } catch {}
  return {
    enabled: true,
    direction: 'right',
    percent: 30,
    autoCloseTimeout: 0
  };
}
```

#### marketplace.json Entry Update

```json
// BEFORE
{
  "name": "ensemble-pane-viewer",
  "version": "5.0.0",
  "source": "./packages/pane-viewer",
  "description": "Real-time subagent monitoring in terminal panes",
  "category": "utilities",
  "tags": ["monitoring", "terminal", "panes"],
  "author": {"name": "Fortium Partners", "url": "https://github.com/FortiumPartners"}
}

// AFTER
{
  "name": "ensemble-agent-progress-pane",
  "version": "5.1.0",
  "source": "./packages/agent-progress-pane",
  "description": "Real-time agent progress visualization in terminal panes",
  "category": "utilities",
  "tags": ["agent", "progress", "monitoring", "terminal", "panes"],
  "author": {"name": "Fortium Partners", "url": "https://github.com/FortiumPartners"}
}
```

#### Migration Script Addition

```javascript
// In scripts/migrate-config.js, add to migrations array:
{
  source: path.join(ensembleDir, 'plugins', 'pane-viewer'),
  target: path.join(ensembleDir, 'plugins', 'agent-progress-pane'),
  description: 'Migrate pane-viewer config to agent-progress-pane'
}
```

---

## Acceptance Criteria

### AC1: Package Rename Verification

| ID | Criteria | Verification Command |
|----|----------|---------------------|
| AC1.1 | Package folder renamed | `ls packages/agent-progress-pane` |
| AC1.2 | npm package name updated | `grep -r "ensemble-agent-progress-pane" packages/agent-progress-pane/package.json` |
| AC1.3 | Plugin manifest updated | `grep -r "ensemble-agent-progress-pane" packages/agent-progress-pane/.claude-plugin/plugin.json` |
| AC1.4 | Marketplace entry updated | `grep -r "agent-progress-pane" marketplace.json` |

### AC2: No Stale References

| ID | Criteria | Verification Command |
|----|----------|---------------------|
| AC2.1 | No pane-viewer in package.json files | `grep -r '"pane-viewer"' packages/*/package.json` (should be empty except migration docs) |
| AC2.2 | No pane-viewer in plugin.json | `grep -r '"pane-viewer"' packages/*/.claude-plugin/plugin.json` (should be empty) |
| AC2.3 | No pane-viewer in marketplace | `grep "ensemble-pane-viewer" marketplace.json` (should be empty) |

### AC3: Validation Passes

| ID | Criteria | Verification Command |
|----|----------|---------------------|
| AC3.1 | Plugin validation passes | `npm run validate` |
| AC3.2 | All tests pass | `npm test` |
| AC3.3 | No linting errors | `npm run lint` (if available) |

### AC4: Installation Works

| ID | Criteria | Verification Command |
|----|----------|---------------------|
| AC4.1 | Plugin installs from GitHub | `claude plugin install github:FortiumPartners/ensemble/packages/agent-progress-pane` |
| AC4.2 | Plugin appears in list | `claude plugin list \| grep agent-progress-pane` |
| AC4.3 | Hooks execute correctly | Trigger Task tool, verify pane spawns |

### AC5: Backward Compatibility

| ID | Criteria | Verification Method |
|----|----------|---------------------|
| AC5.1 | Old config path works | Create config at old path, verify it's read |
| AC5.2 | New config path takes priority | Create both configs, verify new one is used |
| AC5.3 | Migration script works | Run `node scripts/migrate-config.js --dry-run` |

---

## Quality Requirements

### Code Quality

- [ ] All renamed files use consistent naming
- [ ] No hardcoded "pane-viewer" strings remain (except migration/changelog)
- [ ] Backward compatibility code is clean and documented
- [ ] Test coverage maintained

### Documentation Quality

- [ ] All installation commands updated
- [ ] Migration guide clear and complete
- [ ] CHANGELOG documents breaking change
- [ ] Cross-references updated

### Security

- [ ] No new permissions required
- [ ] Config file permissions unchanged (600)
- [ ] No sensitive data in logs

### Performance

- [ ] Backward compat fallback adds negligible overhead (<5ms)
- [ ] No performance regression in hook execution

---

## Implementation Details

### Git Commands for Rename

```bash
# Step 1: Rename directory with git (preserves history)
git mv packages/pane-viewer packages/agent-progress-pane

# Step 2: Update files (done via editor/Claude)
# ... file updates ...

# Step 3: Verify no stale references
grep -r "pane-viewer" packages/agent-progress-pane --include="*.json" --include="*.js" --include="*.md"

# Step 4: Run validation
npm run validate

# Step 5: Run tests
npm test

# Step 6: Commit
git add -A
git commit -m "feat: rename pane-viewer to agent-progress-pane

BREAKING CHANGE: Plugin renamed for clarity and consistency
- ensemble-pane-viewer → ensemble-agent-progress-pane
- Config path: pane-viewer/ → agent-progress-pane/
- Backward compatibility for old config path included"

# Step 7: Push
git push origin main
```

### Search and Replace Patterns

| Search | Replace | Scope |
|--------|---------|-------|
| `ensemble-pane-viewer` | `ensemble-agent-progress-pane` | All files |
| `pane-viewer` (as path) | `agent-progress-pane` | Paths only |
| `paneViewer` (camelCase) | `agentProgressPane` | Code only |
| `PaneViewer` (PascalCase) | `AgentProgressPane` | Classes only |

### Verification Checklist

```bash
# Final verification before commit
echo "=== Verification Checklist ==="

# 1. Directory exists
ls -la packages/agent-progress-pane && echo "✓ Directory renamed"

# 2. No old directory
! ls packages/pane-viewer 2>/dev/null && echo "✓ Old directory removed"

# 3. Package name updated
grep "ensemble-agent-progress-pane" packages/agent-progress-pane/package.json && echo "✓ package.json updated"

# 4. Plugin manifest updated
grep "ensemble-agent-progress-pane" packages/agent-progress-pane/.claude-plugin/plugin.json && echo "✓ plugin.json updated"

# 5. Marketplace updated
grep "agent-progress-pane" marketplace.json && echo "✓ marketplace.json updated"

# 6. Validation passes
npm run validate && echo "✓ Validation passed"

# 7. Tests pass
npm test && echo "✓ Tests passed"

echo "=== Ready for commit ==="
```

---

## Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0.0 | 2025-12-16 | Ensemble Team | Initial TRD |

---

**Document Status:** Ready for Implementation

**Implementation Priority:**
1. Sprint 1 (Core Rename) - CRITICAL
2. Sprint 2 (Configuration) - HIGH
3. Sprint 3 (Documentation) - HIGH
4. Sprint 4 (Testing) - CRITICAL
5. Sprint 5 (Release) - CRITICAL

**Estimated Total Time:** 2-3 hours

**Next Steps:**
1. [ ] Review TRD with team
2. [ ] Begin Sprint 1 (Core Rename)
3. [ ] Execute in order through Sprint 5
