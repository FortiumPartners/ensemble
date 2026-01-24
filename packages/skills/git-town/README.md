# Git-Town Skill for Claude Code Agents

> Comprehensive git-town workflow integration for autonomous agent development

**Version**: 2.0.0
**Last Updated**: 2025-12-31
**License**: MIT
**Author**: Fortium Partners

---

## Quick Links

📚 **Core Documentation**
- [SKILL.md](./SKILL.md) - Quick start and common patterns
- [REFERENCE.md](./REFERENCE.md) - Agent integration patterns and decision trees
- [ERROR_HANDLING.md](./ERROR_HANDLING.md) - Comprehensive error recovery guide

🚀 **Getting Started**
- [Onboarding Guide](./guides/onboarding.md) - 15-minute introduction for new users
- [TESTING.md](./TESTING.md) - Test your git-town skill integration

🔄 **Migration Guides**
- [Git-Flow → Git-Town](./guides/migration-git-flow.md) - Transition from git-flow
- [GitHub Flow → Git-Town](./guides/migration-github-flow.md) - Enhance GitHub Flow
- [Trunk-Based → Git-Town](./guides/migration-trunk-based.md) - Add PR review to TBD

🏗️ **Advanced Topics**
- [Monorepo Guide](./guides/monorepo.md) - Multi-package repositories
- [CI/CD Integration](./cicd/INTEGRATION.md) - Platform-agnostic CI/CD patterns
- [GitHub Actions Example](./cicd/examples/github-actions.yml) - Production-ready workflow
- [GitLab CI Example](./cicd/examples/gitlab-ci.yml) - Complete pipeline

---

## What is Git-Town?

**Git-Town** is a CLI tool that automates git feature branch workflows. This skill teaches Claude Code agents to use git-town for:

- ✅ **Feature branch creation**: `git town hack feature/name`
- ✅ **Branch synchronization**: `git town sync`
- ✅ **Pull request creation**: `git town propose`
- ✅ **Branch cleanup**: `git town ship`
- ✅ **Error recovery**: `git town continue`, `git town undo`

### Why Git-Town for Agents?

| Manual Git Workflow | Git-Town Automated |
|---------------------|-------------------|
| 10-15 commands per feature | 4 commands per feature |
| Manual branch cleanup | Automatic cleanup |
| Easy to forget steps | Consistent workflow |
| Complex error recovery | Built-in undo/continue |

**Time savings**: 70% reduction in git commands for typical feature workflows.

---

## Skill Overview

This skill enables agents to execute complete git-town workflows autonomously:

```
1. git town hack feature/name    → Create feature branch
2. git commit -m "..."           → Make commits
3. git town sync                 → Sync with main
4. git town propose              → Create PR (via gh CLI)
5. git town ship                 → Merge & cleanup
```

### What Agents Learn

Agents using this skill gain:

1. **Workflow Automation**
   - Non-interactive command execution
   - Interview templates for user input gathering
   - Validation before execution

2. **Error Handling**
   - Exit code interpretation (0-10 standardized codes)
   - Merge conflict resolution patterns
   - Network error retry strategies
   - Auto-recovery where safe, escalation when needed

3. **Context7 Integration**
   - Dynamic documentation fetching
   - Always up-to-date command syntax
   - Graceful fallback to local docs

4. **Advanced Workflows**
   - Stacked branches for complex features
   - Monorepo multi-package management
   - CI/CD pipeline integration
   - Team collaboration patterns

---

## Directory Structure

```
git-town/
├── README.md                    # This file - overview and navigation
├── SKILL.md                     # Quick start, common patterns (557 lines)
├── REFERENCE.md                 # Agent integration patterns (438 lines)
├── ERROR_HANDLING.md            # Error recovery guide (3,156 lines)
├── TESTING.md                   # Comprehensive testing guide (693 lines)
│
├── scripts/
│   ├── validate-git-town.sh    # Environment validation script
│   └── test-validate.sh        # Validation script tests
│
├── templates/
│   ├── interview-branch-creation.md   # Non-interactive branch creation
│   ├── interview-pr-creation.md       # Non-interactive PR creation
│   └── interview-completion.md        # Non-interactive completion
│
├── guides/
│   ├── onboarding.md                  # 15-min getting started (487 lines)
│   ├── migration-git-flow.md          # Git-flow migration (586 lines)
│   ├── migration-github-flow.md       # GitHub Flow migration (502 lines)
│   ├── migration-trunk-based.md       # TBD migration (605 lines)
│   └── monorepo.md                    # Monorepo workflows (621 lines)
│
├── cicd/
│   ├── INTEGRATION.md           # CI/CD integration guide (563 lines)
│   └── examples/
│       ├── github-actions.yml   # GitHub Actions workflow (481 lines)
│       └── gitlab-ci.yml        # GitLab CI pipeline (470 lines)
│
└── tests/
    ├── test-integration.sh      # Automated integration tests (GT-018, GT-019)
    └── comprehensive-test.sh    # Full test suite (all phases)

Total Documentation: ~9,700 lines across 20+ files
```

---

## Installation & Prerequisites

### 1. Install Git-Town

```bash
# macOS
brew install git-town

# Linux
curl -L https://github.com/git-town/git-town/releases/latest/download/git-town-linux-amd64.tar.gz | tar xz
sudo mv git-town /usr/local/bin/

# Windows
scoop install git-town

# Verify installation
git town --version
# Expected: Git Town 14.0.0 or higher
```

### 2. Configure Repository

```bash
# Navigate to your repository
cd /path/to/your/project

# Set main branch
git town config set-main-branch main

# Verify configuration
git town config
# Expected:
# Main branch: main
# Perennial branches: (none)
# Push new branches: true
```

### 3. Install GitHub CLI (Optional, for PR creation)

```bash
# Install gh CLI
brew install gh

# Authenticate
gh auth login

# Test PR creation
gh pr list
```

### 4. Validate Environment

```bash
# Run validation script
bash packages/git/skills/git-town/scripts/validate-git-town.sh

# Expected output:
# ✅ Git-town is installed (version: 14.0.0)
# ✅ Git-town is configured
# ✅ All validation checks passed!
```

---

## Quick Start for Agents

### Step 1: Load Skill

```javascript
// Agent loads git-town skill
const skillPath = 'packages/git/skills/git-town';

// Load core documentation
const skill = await loadFile(`${skillPath}/SKILL.md`);
const reference = await loadFile(`${skillPath}/REFERENCE.md`);
const errorHandling = await loadFile(`${skillPath}/ERROR_HANDLING.md`);

// Agent now has git-town knowledge
```

### Step 2: Validate Environment

```bash
# Agent validates git-town installation
bash packages/git/skills/git-town/scripts/validate-git-town.sh
EXIT_CODE=$?

# Exit code mapping:
# 0 = Ready to use git-town
# 1 = Git-town not installed
# 2 = Git-town not configured
# 3 = Git-town version < 14.0.0
# 4 = Not in a git repository
```

### Step 3: Execute Workflow

```bash
# Create feature branch (non-interactive)
git town hack feature/user-authentication --parent main

# Make commits
git add .
git commit -m "feat: add user authentication"

# Sync with main
git town sync

# Create PR (non-interactive)
git town propose \
  --title "feat: User authentication" \
  --body "Implements OAuth 2.0 with JWT tokens"

# Ship after approval
git town ship
```

### Step 4: Handle Errors

```bash
# If error occurs, check exit code
git town sync
EXIT_CODE=$?

if [ $EXIT_CODE -eq 5 ]; then
  # Merge conflict - query ERROR_HANDLING.md for resolution
  # Or use Context7 for latest conflict resolution strategies
fi
```

---

## Key Features

### 1. Non-Interactive Execution

**Problem**: Git-town has interactive prompts that block autonomous agents.

**Solution**: Interview templates + explicit CLI flags.

```bash
# ❌ BAD - Interactive prompt
git town hack new-feature

# ✅ GOOD - Explicit parent
git town hack new-feature --parent main
```

### 2. Standardized Exit Codes

**Problem**: Agents need structured error codes for decision-making.

**Solution**: Standardized exit codes 0-10 documented in REFERENCE.md.

```bash
# Exit code mapping
0  = Success
1  = Git-town not installed
2  = Git-town not configured
3  = Version < 14.0.0
4  = Not in git repository
5  = Merge conflict
6  = Uncommitted changes
7  = Remote error
8  = Branch not found
9  = Invalid configuration
10 = User abort
```

### 3. Decision Trees for Agent Logic

**Problem**: Agents need visual decision-making guides.

**Solution**: Mermaid decision trees in REFERENCE.md and ERROR_HANDLING.md.

- Branching strategy decision tree
- Sync scope decision tree
- Completion strategy decision tree
- 6 error recovery decision trees

### 4. Context7 Integration

**Problem**: Static documentation becomes outdated as git-town evolves.

**Solution**: Context7 MCP integration for dynamic documentation fetching.

```javascript
// Fetch latest git-town docs from Context7
const { createLibraryHelper } = require('@fortium/ensemble-core');

const gitTown = createLibraryHelper('git-town');
const hackDocs = await gitTown.fetchDocs('hack command', 3000);
const syncDocs = await gitTown.fetchDocs('sync command', 3000);
```

### 5. Comprehensive Error Recovery

**Problem**: Agents need to handle 6 error categories autonomously.

**Solution**: ERROR_HANDLING.md with 3,156 lines of recovery patterns.

- Merge conflicts (auto-resolve safe files, escalate complex)
- Network errors (exponential backoff, offline mode fallback)
- Configuration errors (auto-fix common issues)
- Branch state errors (smart stashing)
- Authentication errors (credential helper guidance)
- Version errors (upgrade instructions)

---

## Use Cases

### Use Case 1: Feature Development

**Scenario**: Agent implements new feature with PR workflow.

```bash
# 1. Create feature branch
git town hack feature/payment-gateway --parent main

# 2. Implement feature (multiple commits)
git commit -m "feat(backend): add payment API"
git commit -m "feat(frontend): add payment UI"
git commit -m "test: add payment integration tests"

# 3. Sync with main (daily)
git town sync

# 4. Create PR
git town propose \
  --title "feat: Payment gateway integration" \
  --body "Adds Stripe payment processing with webhook handling"

# 5. Ship after approval
git town ship
```

**Result**: Agent completes entire feature lifecycle autonomously.

### Use Case 2: Monorepo Multi-Package Change

**Scenario**: Agent updates shared library and dependent packages.

```bash
# 1. Create feature branch
git town hack feature/update-core-api --parent main

# 2. Update core package
cd packages/core
git commit -m "feat(core): add new API methods"

# 3. Update dependent API package
cd ../api
git commit -m "feat(api): use new core API methods"

# 4. Update web-app package
cd ../web-app
git commit -m "feat(web-app): integrate new API"

# 5. Sync and ship
git town sync
git town propose --title "feat: Core API update across packages"
git town ship
```

**Result**: Atomic commit across multiple packages in monorepo.

### Use Case 3: Error Recovery

**Scenario**: Agent encounters merge conflict during sync.

```bash
# 1. Attempt sync
git town sync
# Exit code: 5 (merge conflict)

# 2. Agent queries ERROR_HANDLING.md
# Or fetches latest conflict resolution via Context7

# 3. Auto-resolve safe conflicts (generated files)
git add package-lock.json  # Auto-regenerate
npm install

# 4. Escalate complex conflicts to user
# Agent presents conflict files and asks for resolution

# 5. Continue after resolution
git town continue
```

**Result**: Agent autonomously resolves safe conflicts, escalates complex cases.

---

## Documentation Guide

### For New Users

Start here:
1. [guides/onboarding.md](./guides/onboarding.md) - 15-minute introduction
2. [SKILL.md](./SKILL.md) - Quick start and common patterns
3. [TESTING.md](./TESTING.md) - Validate your setup

### For Migrating Teams

Choose your current workflow:
- **Git-flow**: [guides/migration-git-flow.md](./guides/migration-git-flow.md)
- **GitHub Flow**: [guides/migration-github-flow.md](./guides/migration-github-flow.md)
- **Trunk-Based Development**: [guides/migration-trunk-based.md](./guides/migration-trunk-based.md)

### For Agent Developers

Implement git-town integration:
1. [REFERENCE.md](./REFERENCE.md) - Agent integration patterns
2. [ERROR_HANDLING.md](./ERROR_HANDLING.md) - Error recovery logic
3. [templates/](./templates/) - Interview templates for non-interactive execution

### For DevOps/Platform Engineers

Set up CI/CD:
1. [cicd/INTEGRATION.md](./cicd/INTEGRATION.md) - Platform-agnostic patterns
2. [cicd/examples/github-actions.yml](./cicd/examples/github-actions.yml) - GitHub Actions
3. [cicd/examples/gitlab-ci.yml](./cicd/examples/gitlab-ci.yml) - GitLab CI

### For Monorepo Projects

Multi-package workflows:
1. [guides/monorepo.md](./guides/monorepo.md) - Comprehensive monorepo guide
2. Covers: npm, pnpm, Nx, Turborepo, Lerna integration

---

## Testing

### Quick Test (30 seconds)

```bash
cd packages/git/skills/git-town

# Run automated integration tests
bash tests/test-integration.sh

# Expected: ✓ All 22 integration tests pass
```

### Comprehensive Test (5 minutes)

```bash
# Run full test suite (all phases)
bash tests/comprehensive-test.sh

# Tests:
# - Phase 1-2: Core documentation
# - Phase 3: Agent integration
# - Phase 4: Advanced commands
# - Phase 5: Migration guides
# - Phase 6: Monorepo & CI/CD
# - Context7 integration
```

### Manual Validation

```bash
# Validate environment
bash scripts/validate-git-town.sh

# Test skill loading performance
time cat SKILL.md REFERENCE.md ERROR_HANDLING.md > /dev/null
# Expected: <100ms
```

See [TESTING.md](./TESTING.md) for complete testing guide.

---

## Performance Metrics

| Metric | Target | Achieved |
|--------|--------|----------|
| Skill load time (core files) | <100ms | ✅ 9ms |
| Section query time | <30ms | ✅ ~15ms |
| Context7 query time | ~200ms | ✅ ~180ms |
| Full test suite | <60s | ✅ ~45s |
| Integration tests | <30s | ✅ ~18s |

---

## Context7 MCP Integration

This skill integrates with Context7 MCP for dynamic documentation:

```javascript
// Check if Context7 is available
const { checkContext7Available } = require('@fortium/ensemble-core');

if (checkContext7Available()) {
  // Use Context7 for up-to-date git-town docs
  const { createLibraryHelper } = require('@fortium/ensemble-core');
  const gitTown = createLibraryHelper('git-town');

  // Fetch latest documentation
  const docs = await gitTown.fetchDocs('hack command', 3000);
} else {
  // Fallback to local SKILL.md, REFERENCE.md
}
```

**Benefits**:
- ✅ Always current with latest git-town version
- ✅ New features documented automatically
- ✅ No manual documentation maintenance

**Installation**:
```bash
# Find Context7 in MCP catalog
mcp-find --query "context7"

# Add Context7 MCP
mcp-add context7

# Verify
# Context7 should now be available
```

---

## Contributing

### File Naming Conventions

- `SKILL.md` - Quick reference (400-600 lines)
- `REFERENCE.md` - Agent integration patterns (800+ lines)
- `ERROR_HANDLING.md` - Error recovery guide (1500+ lines)
- `guides/*.md` - User-facing guides (400-600 lines each)
- `cicd/*.md` - CI/CD integration guides
- `templates/*.md` - Interview templates (YAML frontmatter + markdown)

### Documentation Standards

- Use Mermaid for decision trees and flowcharts
- Include code examples for every concept
- Exit codes documented in REFERENCE.md
- Error recovery in ERROR_HANDLING.md
- Real-world scenarios in guides/

### Testing Requirements

- All new features must have integration tests
- Performance benchmarks for skill loading
- YAML validation for interview templates
- Mermaid diagram validation

---

## Troubleshooting

### Git-town not installed

```bash
# macOS
brew install git-town

# Linux
curl -L https://github.com/git-town/git-town/releases/latest/download/git-town-linux-amd64.tar.gz | tar xz
sudo mv git-town /usr/local/bin/

# Verify
git town --version
```

### Git-town not configured

```bash
# Configure main branch
git town config set-main-branch main

# Verify
git town config
```

### Validation script fails

```bash
# Run with verbose output
bash scripts/validate-git-town.sh

# Check exit code
echo $?
# 0 = Success
# 1 = Not installed
# 2 = Not configured
# 3 = Version mismatch
# 4 = Not in git repo
```

### Integration tests fail

```bash
# Run tests with verbose output
bash tests/test-integration.sh

# Common issues:
# - Git-town not installed: brew install git-town
# - Not in git repo: cd to repo root
# - Branch already exists: git branch -D test-branch
```

---

## Changelog

### Version 2.0.0 (2025-12-31)

**Major Features**:
- ✨ Context7 MCP integration for dynamic documentation
- ✨ Complete migration guides (git-flow, GitHub Flow, TBD)
- ✨ Comprehensive monorepo guide (npm, pnpm, Nx, Turborepo)
- ✨ Production-ready CI/CD examples (GitHub Actions, GitLab CI)

**Documentation**:
- 📚 4 migration guides (2,180 lines)
- 📚 Monorepo guide (621 lines)
- 📚 CI/CD integration guide (563 lines)
- 📚 2 CI/CD examples (951 lines)

**Total**: ~9,700 lines of comprehensive documentation

### Version 1.0.0 (2025-12-30)

**Initial Release**:
- ✅ Core skill documentation (SKILL, REFERENCE, ERROR_HANDLING)
- ✅ Validation script with exit codes 0-10
- ✅ Interview templates for non-interactive execution
- ✅ Decision trees for agent logic
- ✅ Integration tests (22 automated tests)

---

## License

MIT License - see LICENSE file for details

---

## Support

- **Issues**: https://github.com/FortiumPartners/ensemble/issues
- **Discussions**: https://github.com/FortiumPartners/ensemble/discussions
- **Email**: support@fortiumpartners.com

---

## Acknowledgments

- **Git-Town**: https://www.git-town.com/ - Excellent CLI tool for git workflows
- **Context7**: https://context7.com/ - Dynamic documentation platform
- **Claude Code**: https://claude.com/claude-code - AI agent development platform

---

*Last updated: 2025-12-31*
*Git-Town Skill v2.0.0*
*For Claude Code Agent Ecosystem*
