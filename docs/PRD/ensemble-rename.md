# Product Requirements Document: Ensemble Rename & Consolidation

**Version**: 1.1.0
**Status**: Approved
**Created**: 2025-12-12
**Last Updated**: 2025-12-12
**Author**: Product Management Orchestrator
**Project**: ensemble → ensemble
**Stakeholder Sign-off**: Pending

---

## Version History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0.0 | 2025-12-12 | Product Management | Initial draft |
| 1.1.0 | 2025-12-12 | Product Management | Refined with stakeholder decisions: NPM scope strategy, transition period, config paths, command prefixes |

---

## Executive Summary

This PRD defines the complete rename of the "ensemble" project to "ensemble" including:
- Renaming all 23 NPM packages from `@fortium/ensemble-*` to `@fortium/ensemble-*`
- Renaming the GitHub repository from `ensemble` to `ensemble`
- Renaming the local project directory
- Consolidating all configuration under `~/.ensemble/` (with XDG fallback)
- Updating all slash commands from `/ensemble:*` to `/ensemble:*`
- **Hard cutover** with no backward compatibility period
- **Unpublishing** old NPM packages after migration

---

## 1. Product Summary

### 1.1 Problem Statement

The current project naming ("ensemble") and scattered configuration structure present several challenges:

1. **Brand Clarity**: "ensemble" doesn't clearly communicate the product's value proposition of orchestrating AI agents working together harmoniously
2. **Configuration Fragmentation**: Settings, state, and configuration are spread across multiple locations (`~/.ensemble/plugins/task-progress-pane/`, individual plugin configs)
3. **Discoverability**: Users struggle to find and manage configuration files scattered across the filesystem
4. **Maintenance Overhead**: Multiple naming conventions (@fortium/ensemble-*, @fortium/ensemble-*) create confusion

### 1.2 Proposed Solution

Rename the project from "ensemble" to "ensemble" and consolidate all configuration under a unified `.ensemble` directory structure:

- **New Name**: "Ensemble" - Evokes the concept of multiple AI agents working together in harmony, like musicians in an orchestra
- **Unified Config**: All settings, state, and configuration consolidated under `~/.ensemble/` (with XDG support)
- **Consistent Naming**: Single namespace `@fortium/ensemble-*` for all packages
- **Clean Cutover**: No backward compatibility period - clean break with migration documentation

### 1.3 Value Proposition

- **Clearer Branding**: "Ensemble" better communicates the collaborative agent orchestration concept
- **Simplified Configuration**: Single `.ensemble` directory for all settings, state, and logs
- **Reduced Cognitive Load**: One naming convention, one config location
- **Professional Identity**: More memorable and distinctive brand name
- **XDG Compliance**: Follows Linux standards while maintaining simplicity

---

## 2. User Analysis

### 2.1 Primary Users

| User Type | Description | Primary Needs |
|-----------|-------------|---------------|
| **Developers** | Engineers using Claude Code with agent plugins | Easy installation, clear configuration, predictable behavior |
| **DevOps/SRE** | Infrastructure teams managing deployments | Centralized config, easy automation, consistent paths |
| **Technical Leads** | Engineering managers overseeing AI-assisted development | Clear documentation, professional tooling |

### 2.2 User Personas

#### Persona 1: Alex - Full-Stack Developer
- **Background**: 5 years experience, uses Claude Code daily
- **Pain Points**: Confused by multiple config locations, struggles to find where settings are stored
- **Goals**: Wants a clean, organized tool that just works
- **Success Criteria**: Can configure once and forget

#### Persona 2: Jordan - DevOps Engineer
- **Background**: Manages developer environments across team
- **Pain Points**: Hard to script configuration deployment with scattered files
- **Goals**: Centralized, scriptable configuration management
- **Success Criteria**: Single directory to backup/restore/deploy

#### Persona 3: Sam - Linux Power User
- **Background**: Prefers XDG-compliant applications
- **Pain Points**: Dislikes dotfiles cluttering home directory
- **Goals**: Applications that respect XDG Base Directory specification
- **Success Criteria**: Config in `~/.config/ensemble/` when XDG_CONFIG_HOME is set

### 2.3 User Journey

**Current State (Pain Points)**:
1. User installs ensemble plugins
2. Config files appear in `~/.ensemble/plugins/task-progress-pane/`
3. User doesn't know where other plugin configs live
4. User struggles to backup/migrate configuration
5. User confused by @fortium/ensemble-* vs @fortium/ensemble-* naming
6. Slash commands use inconsistent `/ensemble:` prefix

**Future State (With Ensemble)**:
1. User installs ensemble plugins
2. All config appears in `~/.ensemble/` (or `$XDG_CONFIG_HOME/ensemble/`)
3. Clear, predictable structure for all plugin settings
4. Easy backup: just copy the ensemble directory
5. Consistent `@fortium/ensemble-*` naming throughout
6. All commands use `/ensemble:` prefix

---

## 3. Stakeholder Decisions

The following decisions were made during PRD refinement:

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **NPM Scope** | `@fortium/ensemble-*` | Maintain Fortium brand identity while adopting new product name |
| **Transition Period** | None (hard cutover) | Clean break simplifies implementation; migration docs sufficient |
| **Old NPM Packages** | Unpublish | Remove confusion; force clean install of new packages |
| **Local Directory** | Rename to `ensemble` | Full consistency across all project references |
| **Command Prefix** | `/ensemble:*` | Consistent branding in user-facing commands |
| **GitHub Organization** | Keep FortiumPartners | Maintain existing organizational structure |
| **Config Directory** | XDG + fallback | `$XDG_CONFIG_HOME/ensemble/` preferred, `~/.ensemble/` fallback |
| **CLI Tool** | Not needed | Migration handled via documentation and scripts |

---

## 4. Goals & Non-Goals

### 4.1 Primary Goals

| ID | Goal | Success Metric |
|----|------|----------------|
| G1 | Rename all "ensemble" references to "ensemble" | 100% of references updated |
| G2 | Rename GitHub repository to "ensemble" | Repository accessible at `FortiumPartners/ensemble` |
| G3 | Rename local directory to "ensemble" | `/Users/ldangelo/Development/Fortium/ensemble` |
| G4 | Consolidate config under XDG-compliant paths | Single config directory with XDG support |
| G5 | Update all NPM package names | All packages published as `@fortium/ensemble-*` |
| G6 | Update all slash commands | Commands use `/ensemble:*` prefix |
| G7 | Unpublish old NPM packages | Old `@fortium/ensemble-*` packages removed from registry |

### 4.2 Success Criteria

- [ ] All 23 plugin packages renamed from `@fortium/ensemble-*` to `@fortium/ensemble-*`
- [ ] Internal packages renamed from `@fortium/ensemble-*` to `@fortium/ensemble-*` (unified scope)
- [ ] GitHub repository renamed from `ensemble` to `ensemble`
- [ ] Local directory renamed from `ensemble` to `ensemble`
- [ ] All configuration consolidated under `~/.ensemble/` or `$XDG_CONFIG_HOME/ensemble/`
- [ ] All slash commands updated from `/ensemble:*` to `/ensemble:*`
- [ ] Migration documentation provided for existing users
- [ ] Documentation fully updated
- [ ] All tests passing with new names
- [ ] CI/CD workflows updated
- [ ] Old NPM packages unpublished

### 4.3 Non-Goals (Out of Scope)

| Item | Reason |
|------|--------|
| Changing plugin functionality | This is a rename-only effort |
| Redesigning plugin architecture | Scope creep prevention |
| Adding new features | Focus on rename and consolidation |
| Changing the @fortium organization scope | Maintaining brand consistency |
| Breaking API changes | Preserve compatibility |
| Backward compatibility period | Stakeholder decision: hard cutover |
| Creating new CLI tool | Migration via documentation only |
| Changing GitHub organization | Keep FortiumPartners |

---

## 5. Functional Requirements

### 5.1 Naming Changes

#### 5.1.1 NPM Package Renames

| Current Name | New Name |
|--------------|----------|
| `@fortium/ensemble-core` | `@fortium/ensemble-core` |
| `@fortium/ensemble-product` | `@fortium/ensemble-product` |
| `@fortium/ensemble-development` | `@fortium/ensemble-development` |
| `@fortium/ensemble-quality` | `@fortium/ensemble-quality` |
| `@fortium/ensemble-infrastructure` | `@fortium/ensemble-infrastructure` |
| `@fortium/ensemble-git` | `@fortium/ensemble-git` |
| `@fortium/ensemble-e2e-testing` | `@fortium/ensemble-e2e-testing` |
| `@fortium/ensemble-metrics` | `@fortium/ensemble-metrics` |
| `@fortium/ensemble-react` | `@fortium/ensemble-react` |
| `@fortium/ensemble-nestjs` | `@fortium/ensemble-nestjs` |
| `@fortium/ensemble-rails` | `@fortium/ensemble-rails` |
| `@fortium/ensemble-phoenix` | `@fortium/ensemble-phoenix` |
| `@fortium/ensemble-blazor` | `@fortium/ensemble-blazor` |
| `@fortium/ensemble-jest` | `@fortium/ensemble-jest` |
| `@fortium/ensemble-pytest` | `@fortium/ensemble-pytest` |
| `@fortium/ensemble-rspec` | `@fortium/ensemble-rspec` |
| `@fortium/ensemble-xunit` | `@fortium/ensemble-xunit` |
| `@fortium/ensemble-exunit` | `@fortium/ensemble-exunit` |
| `@fortium/ensemble-full` | `@fortium/ensemble-full` |
| `@fortium/ensemble-pane-viewer` | `@fortium/ensemble-pane-viewer` |
| `@fortium/ensemble-task-progress-pane` | `@fortium/ensemble-task-progress-pane` |
| `@fortium/ensemble-multiplexer-adapters` | `@fortium/ensemble-multiplexer-adapters` |

**Note**: All packages unified under `@fortium` scope - no more `@ensemble` secondary scope.

#### 5.1.2 Slash Command Renames

| Current Command | New Command |
|-----------------|-------------|
| `/ensemble:create-prd` | `/ensemble:create-prd` |
| `/ensemble:refine-prd` | `/ensemble:refine-prd` |
| `/ensemble:create-trd` | `/ensemble:create-trd` |
| `/ensemble:pane-config` | `/ensemble:pane-config` |
| All `/ensemble:*` commands | `/ensemble:*` |

#### 5.1.3 GitHub Repository Rename

| Current | New |
|---------|-----|
| `https://github.com/FortiumPartners/ensemble` | `https://github.com/FortiumPartners/ensemble` |

#### 5.1.4 Local Directory Rename

| Current | New |
|---------|-----|
| `/Users/ldangelo/Development/Fortium/ensemble` | `/Users/ldangelo/Development/Fortium/ensemble` |

#### 5.1.5 Plugin Name Pattern

| Current Pattern | New Pattern |
|-----------------|-------------|
| `^ensemble-[a-z0-9-]+$` | `^ensemble-[a-z0-9-]+$` |

### 5.2 Configuration Consolidation

#### 5.2.1 Config Path Resolution (XDG Compliant)

```
Priority Order:
1. $XDG_CONFIG_HOME/ensemble/  (if XDG_CONFIG_HOME is set)
2. ~/.config/ensemble/          (if ~/.config exists)
3. ~/.ensemble/                  (fallback)
```

#### 5.2.2 New Directory Structure

```
$CONFIG_ROOT/ensemble/          # ~/.ensemble or $XDG_CONFIG_HOME/ensemble
├── config.json                 # Global ensemble configuration
├── state.json                  # Global state tracking
├── plugins/                    # Plugin-specific configuration
│   ├── core/
│   │   └── config.json
│   ├── task-progress-pane/
│   │   ├── config.json
│   │   └── state.json
│   ├── pane-viewer/
│   │   └── config.json
│   └── [plugin-name]/
│       └── config.json
├── logs/                       # Centralized log directory
│   ├── ensemble.log
│   └── [plugin-name]/
│       └── [date].log
├── cache/                      # Shared cache directory
│   └── [plugin-name]/
└── sessions/                   # Session management
    └── [session-id].json
```

#### 5.2.3 Migration Mapping

| Current Location | New Location |
|------------------|--------------|
| `~/.ensemble/plugins/task-progress-pane/config.json` | `$CONFIG_ROOT/ensemble/plugins/task-progress-pane/config.json` |
| `~/.ensemble/plugins/task-progress-pane/state.json` | `$CONFIG_ROOT/ensemble/plugins/task-progress-pane/state.json` |
| `~/.ensemble/plugins/task-progress-pane/logs/` | `$CONFIG_ROOT/ensemble/logs/task-progress-pane/` |

### 5.3 File Updates Required

#### 5.3.1 Root Level Files

| File | Changes Required |
|------|------------------|
| `package.json` | Update name to `ensemble`, repository URL |
| `marketplace.json` | Update all plugin names, repository references |
| `README.md` | Update all references, branding, installation commands |
| `CHANGELOG.md` | Add major version entry for rename |
| `CONTRIBUTING.md` | Update repository references |
| `QUICKSTART.md` | Update installation instructions with new names |
| `INDEX.md` | Update all file references |

#### 5.3.2 Schema Files

| File | Changes Required |
|------|------------------|
| `schemas/plugin-schema.json` | Update name pattern regex to `^ensemble-[a-z0-9-]+$` |
| `schemas/marketplace-schema.json` | Update any ensemble references |

#### 5.3.3 Script Files

| File | Changes Required |
|------|------------------|
| `scripts/validate-all.js` | Update naming validation to `@fortium/ensemble-` |
| `scripts/publish-plugin.js` | Update package name handling |

#### 5.3.4 GitHub Workflows

| File | Changes Required |
|------|------------------|
| `.github/workflows/validate.yml` | Update any hardcoded references |
| `.github/workflows/test.yml` | Update any hardcoded references |
| `.github/workflows/release.yml` | Update any hardcoded references |

#### 5.3.5 Per-Plugin Updates (x23 plugins)

Each plugin requires updates to:

**package.json**:
- `name`: `@fortium/ensemble-*` → `@fortium/ensemble-*`
- `repository.url`: Update to new GitHub URL
- `keywords`: Replace `ensemble` with `ensemble`
- `dependencies`: Update any cross-plugin references

**.claude-plugin/plugin.json**:
- `name`: `ensemble-*` → `ensemble-*`
- `repository`: Update to new GitHub URL
- `keywords`: Replace `ensemble` with `ensemble`
- `dependencies`: Update plugin dependency names

**commands/*.md** (where applicable):
- Update `@ensemble-command` to `@ensemble-command`
- Update command names from `/ensemble:*` to `/ensemble:*`

**Source files** (lib/*.js):
- Update hardcoded paths from `~/.ensemble-*` to XDG-compliant paths
- Update any string references to "ensemble"

**Documentation**:
- `README.md`: Update all references
- `CHANGELOG.md`: Add rename entry

---

## 6. Non-Functional Requirements

### 6.1 Migration Support

| Requirement | Details |
|-------------|---------|
| NFR-1 | Provide migration script to move old configs to new locations |
| NFR-2 | Document migration path clearly in MIGRATION.md |
| NFR-3 | Script should detect and migrate `~/.ensemble-*` directories |
| NFR-4 | Script should respect XDG_CONFIG_HOME if set |

### 6.2 Performance

| Requirement | Details |
|-------------|---------|
| NFR-5 | No performance degradation from rename |
| NFR-6 | Config loading time unchanged |
| NFR-7 | XDG path resolution adds negligible overhead |

### 6.3 Security

| Requirement | Details |
|-------------|---------|
| NFR-8 | Maintain same permission model for config directory (0700) |
| NFR-9 | No sensitive data exposed in migration |
| NFR-10 | Migration script should not run with elevated privileges |

### 6.4 Compatibility

| Requirement | Details |
|-------------|---------|
| NFR-11 | Support macOS, Linux, and WSL environments |
| NFR-12 | XDG compliance for Linux users |
| NFR-13 | Simple `~/.ensemble` fallback for macOS |

---

## 7. Acceptance Criteria

### 7.1 Naming Acceptance Criteria

| ID | Criteria | Test Method |
|----|----------|-------------|
| AC-1 | All package.json files contain `@fortium/ensemble-*` names | Automated validation |
| AC-2 | All plugin.json files contain `ensemble-*` plugin names | Automated validation |
| AC-3 | No remaining references to "ensemble" in any source files | `grep -r "ensemble"` returns 0 results |
| AC-4 | GitHub repository accessible at `FortiumPartners/ensemble` | Manual verification |
| AC-5 | NPM packages published under new names | NPM registry check |
| AC-6 | Old NPM packages unpublished | NPM registry check returns 404 |
| AC-7 | All slash commands use `/ensemble:` prefix | Command listing verification |

### 7.2 Configuration Acceptance Criteria

| ID | Criteria | Test Method |
|----|----------|-------------|
| AC-8 | All plugins use XDG-compliant config paths | Unit tests |
| AC-9 | Plugin configs stored in `$CONFIG_ROOT/ensemble/plugins/[name]/` | Integration tests |
| AC-10 | Logs centralized in `$CONFIG_ROOT/ensemble/logs/` | Manual verification |
| AC-11 | XDG_CONFIG_HOME respected when set | Environment variable test |
| AC-12 | Fallback to `~/.ensemble/` works correctly | Fallback test |
| AC-13 | Migration script successfully moves old configs | Migration test |

### 7.3 Documentation Acceptance Criteria

| ID | Criteria | Test Method |
|----|----------|-------------|
| AC-14 | README.md updated with new branding | Manual review |
| AC-15 | QUICKSTART.md reflects new installation commands | Manual review |
| AC-16 | All plugin READMEs updated | Automated check |
| AC-17 | MIGRATION.md created with step-by-step guide | Manual review |
| AC-18 | CHANGELOG.md documents the rename as breaking change | Manual review |

### 7.4 Testing Acceptance Criteria

| ID | Criteria | Test Method |
|----|----------|-------------|
| AC-19 | All existing tests pass with new names | CI pipeline |
| AC-20 | New tests added for XDG path resolution | Test coverage |
| AC-21 | CI/CD workflows execute successfully | GitHub Actions |
| AC-22 | Local directory rename doesn't break git history | Git log verification |

---

## 8. Technical Specifications

### 8.1 XDG Config Path Resolution

```javascript
// lib/config-path.js
const os = require('os');
const path = require('path');
const fs = require('fs');

function getEnsembleConfigRoot() {
  // Priority 1: XDG_CONFIG_HOME if set
  if (process.env.XDG_CONFIG_HOME) {
    return path.join(process.env.XDG_CONFIG_HOME, 'ensemble');
  }

  // Priority 2: ~/.config/ensemble if ~/.config exists
  const xdgDefault = path.join(os.homedir(), '.config', 'ensemble');
  const configDir = path.join(os.homedir(), '.config');
  if (fs.existsSync(configDir)) {
    return xdgDefault;
  }

  // Priority 3: ~/.ensemble fallback
  return path.join(os.homedir(), '.ensemble');
}

function getPluginConfigPath(pluginName) {
  return path.join(getEnsembleConfigRoot(), 'plugins', pluginName);
}

function getLogsPath(pluginName) {
  const logsRoot = path.join(getEnsembleConfigRoot(), 'logs');
  return pluginName ? path.join(logsRoot, pluginName) : logsRoot;
}

module.exports = {
  getEnsembleConfigRoot,
  getPluginConfigPath,
  getLogsPath
};
```

### 8.2 Migration Script

```javascript
#!/usr/bin/env node
// scripts/migrate-config.js

const fs = require('fs');
const path = require('path');
const os = require('os');
const { getEnsembleConfigRoot, getPluginConfigPath, getLogsPath } = require('../lib/config-path');

const OLD_CONFIG_PATTERNS = [
  { pattern: '.ensemble/plugins/task-progress-pane', plugin: 'task-progress-pane' },
  { pattern: '.ensemble/plugins/pane-viewer', plugin: 'pane-viewer' },
];

function migrate() {
  console.log('Ensemble Config Migration');
  console.log('=========================\n');

  const homeDir = os.homedir();
  const newRoot = getEnsembleConfigRoot();

  console.log(`Target config directory: ${newRoot}\n`);

  let migrated = 0;
  let skipped = 0;

  for (const { pattern, plugin } of OLD_CONFIG_PATTERNS) {
    const oldPath = path.join(homeDir, pattern);

    if (!fs.existsSync(oldPath)) {
      console.log(`[SKIP] ${pattern} - not found`);
      skipped++;
      continue;
    }

    const newPluginPath = getPluginConfigPath(plugin);
    const newLogsPath = getLogsPath(plugin);

    // Create directories
    fs.mkdirSync(newPluginPath, { recursive: true, mode: 0o700 });
    fs.mkdirSync(newLogsPath, { recursive: true, mode: 0o700 });

    // Migrate config.json
    const oldConfig = path.join(oldPath, 'config.json');
    const newConfig = path.join(newPluginPath, 'config.json');
    if (fs.existsSync(oldConfig) && !fs.existsSync(newConfig)) {
      fs.copyFileSync(oldConfig, newConfig);
      console.log(`[MIGRATED] ${oldConfig} -> ${newConfig}`);
    }

    // Migrate state.json
    const oldState = path.join(oldPath, 'state.json');
    const newState = path.join(newPluginPath, 'state.json');
    if (fs.existsSync(oldState) && !fs.existsSync(newState)) {
      fs.copyFileSync(oldState, newState);
      console.log(`[MIGRATED] ${oldState} -> ${newState}`);
    }

    // Migrate logs
    const oldLogs = path.join(oldPath, 'logs');
    if (fs.existsSync(oldLogs)) {
      const logFiles = fs.readdirSync(oldLogs);
      for (const logFile of logFiles) {
        const oldLogPath = path.join(oldLogs, logFile);
        const newLogPath = path.join(newLogsPath, logFile);
        if (!fs.existsSync(newLogPath)) {
          fs.copyFileSync(oldLogPath, newLogPath);
          console.log(`[MIGRATED] ${oldLogPath} -> ${newLogPath}`);
        }
      }
    }

    migrated++;
  }

  console.log(`\nMigration complete: ${migrated} plugins migrated, ${skipped} skipped`);
  console.log('\nYou can now safely remove the old directories:');
  for (const { pattern } of OLD_CONFIG_PATTERNS) {
    const oldPath = path.join(homeDir, pattern);
    if (fs.existsSync(oldPath)) {
      console.log(`  rm -rf ${oldPath}`);
    }
  }
}

migrate();
```

### 8.3 NPM Unpublish Process

```bash
# After publishing new packages, unpublish old ones
# Note: NPM only allows unpublishing within 72 hours of publish
# For older packages, use npm deprecate instead

# Deprecate first (always works)
npm deprecate "@fortium/ensemble-core@*" "Package renamed to @fortium/ensemble-core"
npm deprecate "@fortium/ensemble-product@*" "Package renamed to @fortium/ensemble-product"
# ... repeat for all packages

# Unpublish if within 72 hours (or contact NPM support for older packages)
npm unpublish @fortium/ensemble-core --force
npm unpublish @fortium/ensemble-product --force
# ... repeat for all packages
```

---

## 9. Implementation Phases

### Phase 1: Preparation (Pre-rename)
- [ ] Verify `@fortium/ensemble-*` package names available on NPM
- [ ] Create comprehensive file inventory with exact line numbers
- [ ] Create automated rename script for bulk changes
- [ ] Back up current state

### Phase 2: Local Code Changes
- [ ] Rename local directory from `ensemble` to `ensemble`
- [ ] Update all package.json files (name, repository, keywords, dependencies)
- [ ] Update all plugin.json files (name, repository, keywords, dependencies)
- [ ] Update schema validation patterns
- [ ] Update config path constants to use XDG-compliant paths
- [ ] Update all slash commands from `/ensemble:*` to `/ensemble:*`
- [ ] Update documentation files
- [ ] Run all tests to verify

### Phase 3: GitHub Repository
- [ ] Rename repository in GitHub settings (ensemble → ensemble)
- [ ] Update all repository URL references in code
- [ ] Update CI/CD workflows
- [ ] Verify GitHub Actions work with new repo name
- [ ] Update any external links/bookmarks

### Phase 4: Migration Tooling
- [ ] Implement XDG-compliant config path resolution
- [ ] Implement config migration script
- [ ] Create MIGRATION.md documentation
- [ ] Test migration on fresh system

### Phase 5: Publishing
- [ ] Publish all packages to NPM under new `@fortium/ensemble-*` names
- [ ] Verify all packages install correctly
- [ ] Update marketplace.json
- [ ] Deprecate old NPM packages with rename notice
- [ ] Unpublish old packages (if within 72-hour window) or contact NPM support

### Phase 6: Announcement & Cleanup
- [ ] Announce rename in README and CHANGELOG
- [ ] Remove any temporary compatibility code
- [ ] Final documentation review
- [ ] Update any external documentation/wikis

---

## 10. Risks & Mitigations

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Breaking existing installations | High | High | Clear migration documentation, migration script |
| NPM package name conflicts | High | Low | Verify availability before starting |
| GitHub redirect issues | Medium | Low | GitHub auto-redirects for 1 year |
| Documentation drift | Medium | Medium | Automated grep checks in CI |
| User confusion | Medium | Medium | Clear announcement, migration guide |
| NPM unpublish restrictions | Medium | Medium | Use deprecate if >72 hours old |
| XDG path edge cases | Low | Low | Comprehensive fallback logic |
| Lost git history | High | Low | Use `git mv` where possible, keep same repo |

---

## 11. Success Metrics

| Metric | Target | Measurement Method |
|--------|--------|-------------------|
| Zero "ensemble" references in codebase | 0 | `grep -r "ensemble"` |
| All tests passing | 100% | CI pipeline |
| All packages published | 23 packages | NPM registry |
| Old packages deprecated/unpublished | 23 packages | NPM registry |
| Migration script success | Works on macOS, Linux, WSL | Manual testing |
| Documentation completeness | 100% | Manual review |
| XDG compliance | Passes on Linux | Environment tests |

---

## 12. Appendix

### A. Complete File Inventory

| Category | Count | Files |
|----------|-------|-------|
| Root config | 7 | package.json, marketplace.json, README.md, CHANGELOG.md, CONTRIBUTING.md, QUICKSTART.md, INDEX.md |
| Schemas | 2 | plugin-schema.json, marketplace-schema.json |
| Scripts | 2 | validate-all.js, publish-plugin.js |
| Workflows | 3 | validate.yml, test.yml, release.yml |
| Plugin packages | 23 | All packages/* directories |
| Documentation | 10+ | Various docs/*.md files |
| **Total estimated** | **150+** | All files requiring changes |

### B. Search Patterns for Verification

```bash
# Find all ensemble references (should return 0 after completion)
grep -r "ensemble" --include="*.json" --include="*.js" --include="*.md" --include="*.yml" --include="*.yaml"

# Find all old config path references
grep -r "\.ensemble" --include="*.js"

# Find all old GitHub URL references
grep -r "FortiumPartners/ensemble" --include="*.json" --include="*.md"

# Find all old command references
grep -r "/ensemble:" --include="*.md"

# Find all @ensemble scope references
grep -r "@fortium/ensemble-" --include="*.json"
```

### C. NPM Package Verification

```bash
# Check if new package names are available
npm view @fortium/ensemble-core 2>&1 | grep -q "404" && echo "Available" || echo "Taken"
npm view @fortium/ensemble-product 2>&1 | grep -q "404" && echo "Available" || echo "Taken"
# ... repeat for all packages
```

### D. Post-Migration User Instructions

```markdown
## Migrating from ensemble to ensemble

1. **Uninstall old packages**:
   ```bash
   npm uninstall @fortium/ensemble-core @fortium/ensemble-product # etc.
   ```

2. **Install new packages**:
   ```bash
   npm install @fortium/ensemble-core @fortium/ensemble-product # etc.
   # Or install all at once:
   npm install @fortium/ensemble-full
   ```

3. **Migrate configuration**:
   ```bash
   node scripts/migrate-config.js
   ```

4. **Update slash commands**:
   - Change `/ensemble:create-prd` to `/ensemble:create-prd`
   - Change `/ensemble:refine-prd` to `/ensemble:refine-prd`
   - etc.

5. **Remove old config directories** (after verifying migration):
   ```bash
   rm -rf ~/.ensemble/plugins/task-progress-pane
   rm -rf ~/.ensemble/plugins/pane-viewer
   ```
```

---

## 13. Sign-off

| Role | Name | Date | Signature |
|------|------|------|-----------|
| Product Owner | | | |
| Technical Lead | | | |
| Engineering | | | |

---

**Document End**
