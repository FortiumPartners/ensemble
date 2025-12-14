# Quick Start Guide - Ensemble Plugins Monorepo

## What Was Created

Complete monorepo structure for ensemble v4.0.0 plugin ecosystem:

- ✅ **20 plugin packages** ready for content extraction
- ✅ **197 total files** created with consistent structure
- ✅ **NPM workspace** configuration for monorepo management
- ✅ **GitHub Actions** workflows for validation, testing, and releases
- ✅ **Validation schemas** for plugin and marketplace manifests
- ✅ **Comprehensive documentation** (README, CONTRIBUTING, CHANGELOG)

## Directory Overview

```
ensemble/
├── packages/           # 20 plugin packages (core, product, development, etc.)
├── .github/workflows/  # CI/CD automation (validate, test, release)
├── schemas/           # JSON validation schemas
├── scripts/           # Automation scripts (validate-all, publish-plugin)
├── package.json       # NPM workspace configuration
├── marketplace.json   # Plugin registry
└── [documentation]    # README, CHANGELOG, CONTRIBUTING, LICENSE
```

## Immediate Next Steps

### 1. Verify Structure (Already Done ✅)

```bash
cd /Users/ldangelo/Development/Fortium/ensemble
./verify-structure.sh
```

**Result:** All 20 packages created with complete structure (197 files)

### 2. Install Dependencies

```bash
npm install
```

This will install:
- ajv (JSON schema validation)
- jest (testing framework)
- js-yaml (YAML parsing)

### 3. Validate All Plugins

```bash
npm run validate
```

This validates:
- marketplace.json against schema
- All plugin.json files against schema
- All YAML files for syntax errors
- package.json naming conventions

**Expected:** Will pass once dependencies are installed (schemas validate empty structure)

### 4. Begin Plugin Extraction

Extract content from ensemble v3.x monolith:

#### Core Plugin (Start Here)
```bash
# From ensemble v3.x repository
cp agents/ensemble-orchestrator.yaml packages/core/agents/
cp agents/general-purpose.yaml packages/core/agents/
cp agents/context-fetcher.yaml packages/core/agents/
cp commands/ensemble/create-trd.* packages/core/commands/
cp commands/ensemble/implement-trd.* packages/core/commands/
cp commands/ensemble/fold-prompt.* packages/core/commands/
```

#### Product Plugin
```bash
cp agents/product-management-orchestrator.yaml packages/product/agents/
cp commands/ensemble/create-prd.* packages/product/commands/
cp commands/ensemble/plan-product.* packages/product/commands/
cp commands/ensemble/analyze-product.* packages/product/commands/
```

#### Development Plugin
```bash
cp agents/frontend-developer.yaml packages/development/agents/
cp agents/backend-developer.yaml packages/development/agents/
cp agents/file-creator.yaml packages/development/agents/
```

#### Continue for all 20 plugins...

### 5. Update Plugin Manifests

After extracting content, update each plugin's:

**plugin.json** - Add specific agent/command/skill lists
**README.md** - Document features and usage
**CHANGELOG.md** - Add extraction notes

### 6. Write Tests

Add tests to each plugin's `tests/` directory:

```javascript
// packages/core/tests/core.test.js
describe('ensemble-core', () => {
  it('should have ensemble-orchestrator agent', () => {
    const fs = require('fs');
    expect(fs.existsSync('agents/ensemble-orchestrator.yaml')).toBe(true);
  });
});
```

### 7. Run Tests

```bash
npm test
npm run test:coverage
```

### 8. Create Initial Commit

```bash
git add .
git commit -m "chore: initialize ensemble monorepo with 20 packages

- Complete structure for v4.0.0 plugin architecture
- 20 packages across 4 tiers (Core, Workflow, Frameworks, Testing)
- NPM workspace configuration
- GitHub Actions workflows
- Validation schemas and automation scripts
- Comprehensive documentation"
```

## Plugin Extraction Priority

### Phase 1: Core Foundation (Week 1)
1. **ensemble-core** - Core orchestration (highest priority)
2. **ensemble-product** - Product management
3. **ensemble-development** - Development agents

### Phase 2: Workflow Essentials (Week 2)
4. **ensemble-quality** - Code review and testing
5. **ensemble-git** - Git workflows
6. **ensemble-infrastructure** - Infrastructure automation

### Phase 3: Framework Skills (Week 3)
7. **ensemble-react** - React skills
8. **ensemble-nestjs** - NestJS skills
9. **ensemble-rails** - Rails skills

### Phase 4: Testing & Utilities (Week 4)
10. **ensemble-jest** - Jest testing
11. **ensemble-pytest** - Pytest testing
12. **ensemble-metrics** - Analytics dashboard
13. **ensemble-pane-viewer** - Terminal monitoring

### Phase 5: Remaining Plugins (Week 5)
14-20. Complete all remaining framework and testing plugins

## Commands Available

```bash
# Validation
npm run validate          # Validate all plugins
./verify-structure.sh     # Verify directory structure

# Testing
npm test                  # Run all tests
npm run test:coverage     # Run with coverage

# Publishing (after content extraction)
npm run publish:changed   # Publish changed plugins to NPM
```

## File Locations

**Key Configuration:**
- Root package.json: `/Users/ldangelo/Development/Fortium/ensemble/package.json`
- Marketplace: `/Users/ldangelo/Development/Fortium/ensemble/marketplace.json`
- Validation schemas: `/Users/ldangelo/Development/Fortium/ensemble/schemas/`

**Plugin Packages:**
- All in: `/Users/ldangelo/Development/Fortium/ensemble/packages/`

**Documentation:**
- Main README: `/Users/ldangelo/Development/Fortium/ensemble/README.md`
- Setup Summary: `/Users/ldangelo/Development/Fortium/ensemble/SETUP_SUMMARY.md`
- Contributing: `/Users/ldangelo/Development/Fortium/ensemble/CONTRIBUTING.md`

## Current Status

✅ **COMPLETE** - Monorepo structure fully scaffolded
📦 **READY** - All 20 packages created with proper structure
⏭️ **NEXT** - Begin plugin extraction from ensemble v3.x

## Resources

- **Setup Summary**: See `SETUP_SUMMARY.md` for complete details
- **Contributing Guide**: See `CONTRIBUTING.md` for development workflow
- **Main README**: See `README.md` for user-facing documentation
- **v3.x Migration**: See migration table in `CHANGELOG.md`

## Questions?

- Check `SETUP_SUMMARY.md` for detailed structure information
- Review `CONTRIBUTING.md` for development guidelines
- See `README.md` for plugin ecosystem overview

---

**Created:** December 9, 2025  
**Status:** Scaffolding complete, ready for extraction  
**Total Files:** 197 files across 20 packages  
**Total Size:** ~100KB of configuration and documentation
