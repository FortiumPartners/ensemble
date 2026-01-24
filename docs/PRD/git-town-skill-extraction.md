# Product Requirements Document: Git-Town Workflow Skill

**Version**: 1.1.0
**Created**: 2025-12-29
**Last Updated**: 2025-12-29
**Status**: Draft
**Owner**: Product Management
**Category**: Developer Tooling / Agent Skills

---

## 1. Product Summary

### 1.1 Problem Statement

Git-town workflow instructions are currently embedded directly within agent prompts and command definitions across the Ensemble plugin ecosystem. This creates several critical issues:

1. **Scattered Knowledge**: Git-town usage patterns exist in multiple locations (git-workflow agent, implement-trd command, ensemble-orchestrator), making maintenance difficult and creating inconsistency risks
2. **Interactive Mode Incompatibility**: Git-town's default interactive prompts (e.g., `git-town init`) are incompatible with Claude Code's automated agent execution environment
3. **Limited Reusability**: Teams cannot easily share, extend, or customize git-town workflows without modifying core agent definitions
4. **No Single Source of Truth**: Developers and agents reference different implementations of the same git-town patterns, leading to drift and confusion
5. **Difficult Testing**: Embedded instructions cannot be validated independently or tested in isolation
6. **Unclear Error Handling**: No standardized approach for handling git-town failures, leading to inconsistent error recovery across agents
7. **Limited Onboarding Support**: New team members lack structured guidance for adopting git-town in existing projects

### 1.2 Solution Overview

Extract all git-town workflow knowledge into a dedicated, modular skill within the `ensemble-git` plugin. This skill will:

- Provide a comprehensive reference for all git-town commands with non-interactive CLI arguments
- Serve as the single source of truth for git-town integration patterns
- Include user interview templates that agents can use to gather required information before executing commands
- Support both basic workflows (hack, sync, propose, ship) and advanced patterns (stacked branches, offline mode)
- Enable consistent git-town usage across all agents and commands
- Document comprehensive error scenarios with recovery workflows
- Support diverse team configurations (monorepos, CI/CD integration, migration from other workflows)

### 1.3 Value Proposition

**For Developers**:
- Faster onboarding to git-town workflows through clear, centralized documentation
- Predictable, non-interactive command execution in CI/CD and automation contexts
- Ability to customize workflows by modifying a single skill instead of multiple agents
- Clear guidance for error recovery and troubleshooting
- Structured migration paths from git-flow, GitHub Flow, and trunk-based development

**For Agents**:
- Consistent, validated git-town command patterns to reference
- Clear interview protocols for gathering user input before command execution
- Reduced prompt complexity by delegating git-town knowledge to a dedicated skill
- Comprehensive error handling decision trees for autonomous recovery
- Runtime skill loading mechanism for dynamic capability enhancement

**For the Ensemble Ecosystem**:
- Improved maintainability through separation of concerns
- Enhanced testability of git-town integration patterns
- Foundation for future workflow enhancements (custom strategies, hooks, validation)
- Cross-platform compatibility ensuring consistent behavior across macOS, Linux, and Windows (Git Bash)
- Extensible architecture supporting monorepo and CI/CD integration patterns

---

## 2. User Analysis

### 2.1 Primary Users

#### 2.1.1 Claude Code Agents
**Persona**: Autonomous execution agents (ensemble-orchestrator, tech-lead-orchestrator, git-workflow)

**Current Pain Points**:
- Must embed git-town command knowledge directly in mission prompts
- Cannot validate git-town commands before execution
- Limited ability to adapt commands based on repository state
- Risk of using interactive flags that block automated workflows
- No standardized error handling patterns
- Unclear how to load and reference skills at runtime

**Needs**:
- Quick reference for command syntax with all CLI flags
- Decision trees for workflow selection (when to use hack vs. append, sync vs. ship)
- User interview templates to gather branch names, commit messages, PR titles
- Error handling patterns for common git-town failures
- Clear skill loading mechanism documentation
- Cross-platform command compatibility assurance

**Success Metrics**:
- Zero interactive prompts triggered during automated execution
- 100% of git-town commands use explicit CLI arguments
- Reduced average agent prompt length by 30% (delegating to skill)
- 95% of errors handled autonomously without user intervention
- <100ms skill loading overhead

#### 2.1.2 Human Developers
**Persona**: Software engineers using Ensemble plugins via Claude Code

**Current Pain Points**:
- Unclear which git-town commands are supported by Ensemble
- Must learn git-town separately, then discover Ensemble's conventions
- No visibility into how agents will use git-town on their behalf
- Difficult to troubleshoot when git-town commands fail in agent workflows
- Uncertain how to onboard new team members to git-town workflows
- No guidance for monorepo or CI/CD integration scenarios

**Needs**:
- Clear documentation of supported git-town workflows
- Examples of common scenarios (feature branch creation, PR creation, shipping)
- Understanding of when agents will interview them vs. making autonomous decisions
- Troubleshooting guide for git-town configuration issues
- Migration guides from git-flow, GitHub Flow, and trunk-based development
- Monorepo workflow patterns and best practices
- First-time setup checklists for new developers
- CI/CD integration examples (GitHub Actions, GitLab CI, etc.)

**Success Metrics**:
- 80% of users successfully execute their first git-town workflow without external documentation
- Zero support tickets related to interactive git-town prompts
- Average time-to-resolution for git-town errors reduced by 50%
- 90% of new team members onboarded within 1 day
- 75% of migrations from other workflows completed without issues

### 2.2 Secondary Users

#### 2.2.1 Plugin Developers
**Persona**: Engineers extending Ensemble with custom plugins

**Needs**:
- Reusable git-town skill they can reference from custom agents
- Clear extension points for custom workflow strategies
- Validation helpers to ensure git-town configuration correctness
- Cross-platform compatibility utilities

**Success Metrics**:
- 90% of new workflow plugins reference git-town skill instead of reimplementing
- Zero duplicate git-town command implementations in new plugins

#### 2.2.2 Ensemble Contributors
**Persona**: Open-source contributors improving the Ensemble ecosystem

**Needs**:
- Centralized location to improve git-town integration
- Clear boundaries between skill (documentation) and agents (execution)
- Test fixtures for validating git-town command generation
- Cross-platform testing infrastructure

**Success Metrics**:
- 100% of git-town updates require changes to only one location
- Git-town skill has comprehensive test coverage (>85%)

### 2.3 New User Scenarios

#### 2.3.1 Monorepo Teams
**Scenario**: Development team managing multiple packages/services in a single repository

**Pain Points**:
- Unclear how git-town branch hierarchies map to monorepo package structure
- Need to coordinate releases across multiple packages
- CI/CD pipelines must detect which packages changed

**Requirements**:
- Document monorepo branching strategies (package-scoped vs. cross-package features)
- Provide examples of git-town workflows with path-based changesets
- Integration patterns with Nx, Turborepo, Lerna
- CI/CD examples using changed-files detection with git-town branches

**Success Criteria**:
- Monorepo teams can adopt git-town without modifying repository structure
- Clear guidance on when to create stacked vs. parallel branches for multi-package features

#### 2.3.2 New Developer Onboarding
**Scenario**: Developer joining a team that already uses git-town

**Pain Points**:
- Unfamiliar with git-town commands and workflows
- Unclear which git-town configuration settings are team standards vs. personal preferences
- Risk of using incorrect branching patterns (e.g., creating branches manually instead of `git-town hack`)

**Requirements**:
- Onboarding checklist for first-time git-town setup
- Team configuration templates (shared via `.git-town.toml` or documentation)
- Quick-start guide showing "first feature branch" workflow from clone to PR
- Common mistakes and how to fix them (e.g., undoing manual branch creation)

**Success Criteria**:
- New developers complete first git-town workflow within 1 hour of setup
- Zero onboarding-related git-town configuration errors after first week

#### 2.3.3 Migration from Other Workflows
**Scenario**: Team transitioning from git-flow, GitHub Flow, or trunk-based development to git-town

**Pain Points**:
- Existing branches don't follow git-town conventions
- Team members have muscle memory for old workflows
- CI/CD pipelines may rely on specific branch naming patterns

**Requirements**:
- Migration guides for each workflow type (git-flow, GitHub Flow, trunk-based)
- Branch conversion strategies (when to rebase vs. recreate)
- Side-by-side comparison tables (old workflow → git-town equivalent)
- Incremental adoption patterns (gradual rollout vs. all-at-once)

**Success Criteria**:
- Migration guides cover 90% of common scenarios
- Teams can adopt git-town incrementally without breaking existing workflows
- Clear rollback procedures if migration encounters issues

#### 2.3.4 CI/CD Integration
**Scenario**: Automated pipelines interacting with git-town workflows

**Pain Points**:
- Unclear how to trigger git-town commands in CI/CD environments
- Need non-interactive execution for automated testing and deployment
- Branch naming conventions must align with CI/CD triggers

**Requirements**:
- GitHub Actions workflow examples (e.g., auto-sync on schedule, auto-ship on approval)
- GitLab CI pipeline examples (e.g., run tests on stacked branches)
- Branch protection rule recommendations
- Environment variable configuration for CI/CD contexts

**Success Criteria**:
- Documented examples for 3+ major CI/CD platforms (GitHub Actions, GitLab CI, CircleCI)
- Automated sync/ship workflows tested in real CI/CD environments
- Zero interactive prompt failures in CI/CD pipelines

---

## 3. Goals & Non-Goals

### 3.1 Goals

#### 3.1.1 Primary Goals (Must Have - v1.0)

1. **Non-Interactive Command Reference**
   - Document all git-town commands with complete CLI flag reference
   - Provide non-interactive alternatives for every interactive workflow
   - Include command validation patterns (checking prerequisites before execution)

2. **User Interview Templates**
   - Define structured interview flows for branch creation (hack, append, prepend)
   - Provide templates for PR creation (propose with title, body)
   - Include merge/ship decision workflows with user confirmation

3. **Workflow Decision Trees**
   - When to use `hack` vs. `append` vs. `prepend` (branching strategy)
   - When to use `sync` vs. `sync --all` vs. `sync --stack` (sync scope)
   - When to use `propose` vs. manual PR creation (proposal strategy)
   - When to use `ship` vs. `merge` (completion strategy)

4. **Skill Integration**
   - Create `packages/git/skills/git-town/` directory structure
   - Write `SKILL.md` with quick reference and common patterns
   - Write `REFERENCE.md` with comprehensive command documentation
   - Include example scripts in `scripts/` for validation helpers
   - Document skill loading mechanism for agent runtime discovery

5. **Agent Refactoring**
   - Update `git-workflow.yaml` to reference git-town skill instead of embedding instructions
   - Update `implement-trd.yaml` to use skill-based workflow patterns
   - Remove duplicate git-town documentation from agent prompts

6. **Comprehensive Error Handling**
   - Document all common error scenarios with examples
   - Provide decision trees for error recovery (retry vs. escalate)
   - Include error messages and how to interpret them

7. **Cross-Platform Compatibility**
   - Ensure all scripts work on macOS, Linux, and Windows (Git Bash)
   - Document platform-specific considerations
   - Provide platform detection and adaptation patterns

#### 3.1.2 Secondary Goals (Should Have - v1.1)

1. **Configuration Validation**
   - Provide helper script to validate git-town configuration (`git-town config`)
   - Include templates for common configuration scenarios (GitHub, GitLab, Gitea)
   - Document offline mode setup for air-gapped environments

2. **Error Recovery Patterns**
   - Document common failure scenarios (merge conflicts, network errors, missing config)
   - Provide recovery workflows (continue, skip, undo, status)
   - Include decision logic for when to escalate to human intervention

3. **Advanced Workflow Support**
   - Stacked branches workflow (append, prepend, detach, swap)
   - Prototype branches for experimental work
   - Offline mode for disconnected development

4. **Onboarding & Migration**
   - First-time setup checklist for new developers
   - Migration guides from git-flow, GitHub Flow, trunk-based development
   - Team configuration templates

5. **Monorepo & CI/CD Integration**
   - Monorepo workflow patterns
   - CI/CD integration examples (GitHub Actions, GitLab CI, CircleCI)
   - Branch protection rule recommendations

#### 3.1.3 Stretch Goals (Could Have - v1.2+)

1. **Interactive Skill Builder**
   - CLI tool to generate interview templates from workflow requirements
   - Workflow visualization showing branch hierarchy

2. **Git-Town Configuration Manager**
   - Automated setup for new repositories
   - Template-based configuration for team standards

3. **Advanced CI/CD Patterns**
   - Auto-sync workflows on schedule
   - Auto-ship on PR approval
   - Automated conflict detection and notification

### 3.2 Non-Goals (Out of Scope)

1. **Custom Git-Town Development**
   - We will NOT fork or modify git-town itself
   - We will NOT implement git-town alternatives or wrappers
   - We will ONLY provide integration patterns for the official git-town CLI

2. **Interactive Mode Support**
   - We will NOT support git-town's interactive prompts in automated workflows
   - We will NOT create UI/TUI wrappers around git-town
   - We will ONLY provide non-interactive CLI argument patterns

3. **Git-Town Installation Management**
   - We will NOT handle git-town installation or version management
   - We will NOT provide fallback implementations if git-town is missing
   - We will ONLY validate that git-town is available and configured

4. **Alternative Workflow Systems**
   - We will NOT support git-flow, GitHub Flow, or other branching strategies natively
   - We will NOT provide generic branching abstraction layers
   - We will ONLY provide migration guides FROM other strategies TO git-town

5. **Repository Migration Automation**
   - We will NOT provide automated tools to migrate from other branching strategies
   - We will NOT automate conversion of existing branches to git-town conventions
   - We will ONLY provide manual migration guides and best practices

---

## 4. Acceptance Criteria

### 4.1 Functional Requirements

#### 4.1.1 Skill Structure (MUST)
- [ ] Create `packages/git/skills/git-town/` directory
- [ ] Include `SKILL.md` with mission, capabilities, and quick start (500-1000 words)
- [ ] Include `REFERENCE.md` with comprehensive command documentation (3000-4000 words)
- [ ] Include `ERROR_HANDLING.md` with comprehensive error scenarios and recovery workflows
- [ ] Include `scripts/validate-git-town.sh` for cross-platform configuration validation
- [ ] Include `templates/interview-branch-creation.md` for hack/append/prepend workflows
- [ ] Include `templates/interview-pr-creation.md` for propose workflows
- [ ] Include `templates/interview-completion.md` for ship/merge workflows
- [ ] Include `guides/onboarding.md` for new developer setup
- [ ] Include `guides/migration-git-flow.md` for git-flow to git-town migration
- [ ] Include `guides/migration-github-flow.md` for GitHub Flow to git-town migration
- [ ] Include `guides/migration-trunk-based.md` for trunk-based to git-town migration
- [ ] Include `guides/monorepo.md` for monorepo workflow patterns
- [ ] Include `guides/ci-cd-integration.md` for CI/CD integration examples
- [ ] Document skill loading mechanism in `SKILL.md`

#### 4.1.2 Command Coverage (MUST)
Document all commands with non-interactive CLI examples and error scenarios:
- [ ] `git-town hack <branch>` - Feature branch creation
  - Success example: Creating feature branch from main
  - Error example: Branch already exists (how to handle)
  - Error example: Uncommitted changes prevent branch creation (how to handle)
- [ ] `git-town sync` - Branch synchronization
  - Success example: Syncing current branch with upstream
  - Error example: Merge conflicts during sync (recovery with `continue`)
  - Error example: Network failure during fetch (retry vs. offline mode)
- [ ] `git-town propose` - PR creation with `--title`, `--body`, `--body-file`
  - Success example: Creating PR with title and body
  - Error example: GitHub API authentication failure (troubleshooting)
  - Error example: No commits to propose (validation)
- [ ] `git-town ship` - Feature completion with `--message`, `--message-file`
  - Success example: Shipping feature to main
  - Error example: PR not merged yet (validation)
  - Error example: Merge conflicts during ship (recovery with `continue`)
- [ ] `git-town append <branch>` - Stacked branch creation
  - Success example: Creating child branch from parent
  - Error example: Parent branch not a feature branch (validation)
- [ ] `git-town continue` - Conflict resolution
  - Example: Continuing after resolving merge conflicts
  - Example: Continuing after manual intervention
- [ ] `git-town undo` - Command rollback
  - Example: Undoing failed sync operation
  - Example: Limitations and when undo is not available
- [ ] `git-town status` - Current operation status
  - Example: Checking status during interrupted sync
  - Example: Understanding status output for troubleshooting

#### 4.1.3 Error Handling Documentation (MUST)
Create comprehensive `ERROR_HANDLING.md` covering:
- [ ] **Merge Conflicts**
  - Detection: How to identify conflicts during sync/ship
  - Resolution: Step-by-step workflow (manual resolution → `git-town continue`)
  - Prevention: Best practices to minimize conflicts
  - Agent decision logic: When to auto-resolve vs. escalate to user
- [ ] **Network Errors**
  - Scenario: Remote fetch/push failures
  - Recovery: Retry logic with exponential backoff
  - Fallback: Offline mode for disconnected development
  - Agent decision logic: How many retries before escalation
- [ ] **Configuration Errors**
  - Scenario: Missing or invalid git-town configuration
  - Detection: Validation script error codes
  - Resolution: Configuration correction workflows
  - Agent decision logic: When to auto-configure vs. prompt user
- [ ] **Branch State Errors**
  - Scenario: Uncommitted changes, detached HEAD, etc.
  - Detection: Pre-flight checks before git-town commands
  - Resolution: Stashing, committing, or aborting
  - Agent decision logic: When to auto-stash vs. prompt user
- [ ] **Authentication Errors**
  - Scenario: GitHub/GitLab API failures during propose
  - Detection: Error message patterns
  - Resolution: Credential refresh workflows
  - Agent decision logic: When to use environment variables vs. prompt user
- [ ] **Git-Town Version Errors**
  - Scenario: Unsupported git-town version
  - Detection: Version checking in validation script
  - Resolution: Upgrade instructions
  - Agent decision logic: Fail fast with clear upgrade instructions

#### 4.1.4 User Interview Templates (MUST)
- [ ] Branch creation template asks: branch name, base branch (default: main), prototype flag
- [ ] PR creation template asks: title, body (optional file path), draft status
- [ ] Completion template asks: commit message (squash), confirmation before merge
- [ ] All templates include error validation (e.g., invalid branch name format)

#### 4.1.5 Decision Trees (MUST)
- [ ] Branching strategy flowchart (when to use hack/append/prepend)
- [ ] Sync scope decision logic (current branch vs. all vs. stack)
- [ ] Completion strategy matrix (ship vs. merge vs. manual)
- [ ] Error recovery decision trees (retry vs. escalate)

#### 4.1.6 Agent Integration (MUST)
- [ ] `git-workflow.yaml` references git-town skill in mission statement
- [ ] `implement-trd.yaml` uses skill-based interview templates for branch creation
- [ ] Remove embedded git-town instructions from agent prompts (reduce by >80%)
- [ ] Document skill loading mechanism in agent YAML frontmatter or mission

#### 4.1.7 Onboarding & Migration Guides (MUST)
- [ ] **Onboarding Guide** (`guides/onboarding.md`):
  - Installation checklist (git-town, configuration)
  - First feature branch walkthrough (hack → commit → propose → ship)
  - Common mistakes and how to fix them
  - Team configuration templates
- [ ] **Git-Flow Migration Guide** (`guides/migration-git-flow.md`):
  - Side-by-side comparison table (git-flow → git-town)
  - Branch conversion strategies (develop → main, feature → hack)
  - Release workflow mapping (release branches → git-town ship)
  - Incremental adoption patterns
- [ ] **GitHub Flow Migration Guide** (`guides/migration-github-flow.md`):
  - Workflow mapping (feature branch → git-town hack)
  - PR creation differences (manual → git-town propose)
  - Branch cleanup automation (manual delete → git-town ship)
- [ ] **Trunk-Based Migration Guide** (`guides/migration-trunk-based.md`):
  - Short-lived branch mapping (trunk → main, feature → hack)
  - CI/CD integration adjustments
  - Feature flag considerations

#### 4.1.8 Monorepo & CI/CD Integration (MUST)
- [ ] **Monorepo Guide** (`guides/monorepo.md`):
  - Package-scoped vs. cross-package branching strategies
  - Integration with Nx, Turborepo, Lerna
  - Changed-files detection patterns
  - Example: Feature affecting multiple packages with stacked branches
- [ ] **CI/CD Integration Guide** (`guides/ci-cd-integration.md`):
  - GitHub Actions workflow examples (auto-sync, auto-ship)
  - GitLab CI pipeline examples (test stacked branches)
  - CircleCI configuration examples
  - Branch protection rule recommendations
  - Environment variable configuration
  - Non-interactive execution patterns

#### 4.1.9 Cross-Platform Compatibility (MUST)
- [ ] Validation script (`scripts/validate-git-town.sh`) works on:
  - macOS (Bash 3.2+)
  - Linux (Bash 4.0+)
  - Windows Git Bash (Bash 4.4+)
- [ ] Document platform-specific considerations (e.g., line endings, path separators)
- [ ] Provide platform detection utilities for agents
- [ ] All script examples use POSIX-compliant syntax where possible

#### 4.1.10 Skill Loading Mechanism (MUST)
- [ ] Document how agents discover and load the git-town skill at runtime
- [ ] Provide example of agent YAML frontmatter referencing skill
- [ ] Document skill search paths (XDG-compliant directories)
- [ ] Include performance considerations (skill caching, lazy loading)
- [ ] Provide error handling for missing or corrupted skills

### 4.2 Quality Requirements

#### 4.2.1 Documentation Quality (MUST)
- [ ] All commands include at least 3 real-world usage examples (success + 2 error scenarios)
- [ ] All CLI flags are documented with their purpose and default values
- [ ] All interview templates include validation logic (required fields, format checks)
- [ ] All decision trees include clear exit conditions and error states
- [ ] All error scenarios include example error messages and recovery workflows

#### 4.2.2 Validation & Testing (SHOULD)
- [ ] `validate-git-town.sh` checks for git-town installation (exit code 0/1)
- [ ] `validate-git-town.sh` validates configuration (`git-town config`)
- [ ] `validate-git-town.sh` passes tests on macOS, Linux, Windows Git Bash
- [ ] Unit tests for interview template parsing (if implemented programmatically)
- [ ] Integration test: agent creates feature branch using skill reference
- [ ] Integration test: agent handles merge conflict error scenario
- [ ] Integration test: skill loading performance <100ms

#### 4.2.3 Consistency (MUST)
- [ ] All command examples use explicit CLI flags (no reliance on defaults)
- [ ] All interview templates follow same question format and validation pattern
- [ ] All decision trees use consistent notation (Mermaid diagrams)
- [ ] All error scenarios follow same structure (scenario → detection → resolution → agent logic)

### 4.3 Success Metrics (Measurable)

#### 4.3.1 Adoption Metrics
- [ ] 100% of git-workflow agent executions reference git-town skill (no embedded instructions)
- [ ] 80% of implement-trd command executions use non-interactive git-town commands
- [ ] Zero interactive git-town prompts triggered during agent workflows (measured via logs)
- [ ] 90% of new developers onboarded within 1 day using onboarding guide

#### 4.3.2 Quality Metrics
- [ ] Average agent prompt length reduced by 30% for agents using git-town
- [ ] Zero git-town command failures due to missing CLI arguments
- [ ] 90% of users successfully create feature branches on first attempt
- [ ] 95% of errors handled autonomously without user intervention
- [ ] 75% of migrations from other workflows completed without issues

#### 4.3.3 Maintenance Metrics
- [ ] All git-town documentation updates require changes to only 1 location (the skill)
- [ ] Average time to add new git-town command pattern: <1 hour
- [ ] Zero duplicate git-town command implementations across plugins

#### 4.3.4 Performance Metrics
- [ ] Skill loading overhead <100ms
- [ ] Validation script execution <500ms
- [ ] Cross-platform compatibility: 100% of scripts pass on macOS, Linux, Windows

### 4.4 Edge Cases & Error Handling

#### 4.4.1 Missing Git-Town (MUST)
- [ ] Skill documentation includes installation instructions (Homebrew, manual)
- [ ] Validation script provides clear error message if git-town not found
- [ ] Agents gracefully fallback or escalate if git-town unavailable
- [ ] Error message includes link to installation guide

#### 4.4.2 Unconfigured Repository (MUST)
- [ ] Skill includes minimal configuration example for quick setup
- [ ] Validation script detects missing main branch configuration
- [ ] Agents prompt user to run configuration before proceeding
- [ ] Configuration templates for common scenarios (GitHub, GitLab, Gitea)

#### 4.4.3 Conflict Resolution (MUST)
- [ ] Document `git-town continue` workflow after manual conflict resolution
- [ ] Document `git-town skip` for skipping conflicted branches
- [ ] Document `git-town undo` for reverting failed operations
- [ ] Provide agent decision tree for conflict severity assessment

#### 4.4.4 Offline Mode (SHOULD)
- [ ] Document `git-town offline` command for air-gapped development
- [ ] Include examples of sync workflows that don't require network access
- [ ] Provide network detection utilities for agents

#### 4.4.5 Platform-Specific Issues (MUST)
- [ ] Document known Windows Git Bash limitations
- [ ] Provide workarounds for macOS Bash 3.2 limitations
- [ ] Include line ending normalization recommendations

---

## 5. Implementation Phases

### Phase 1: Core Skill Creation (Weeks 1-2)
**Deliverables**:
- Git-town skill directory structure created
- SKILL.md with mission, quick start, and skill loading mechanism
- REFERENCE.md with all basic commands (hack, sync, propose, ship)
- ERROR_HANDLING.md with comprehensive error scenarios (merge conflicts, network errors, config errors)
- Validation script for git-town installation check (cross-platform)
- Cross-platform compatibility testing infrastructure

**Acceptance**:
- Skill passes `npm run validate` (if schema exists)
- Documentation follows act-local-ci skill format
- All basic commands have 3+ examples (success + 2 error scenarios)
- Validation script passes on macOS, Linux, Windows Git Bash
- Skill loading overhead <100ms measured

**Time Estimate**: 2 weeks (extended from 1 week for comprehensive error documentation)

### Phase 2: Interview Templates & Decision Trees (Week 3)
**Deliverables**:
- Branch creation interview template (hack/append/prepend)
- PR creation interview template (propose)
- Completion interview template (ship/merge)
- Decision trees for workflow selection (Mermaid diagrams)
- Error recovery decision trees

**Acceptance**:
- Templates include all required fields and validation logic
- Decision trees cover 95% of common scenarios (including error scenarios)
- Templates are agent-readable (structured Markdown format)
- All decision trees use consistent Mermaid notation

**Time Estimate**: 1 week

### Phase 3: Agent Refactoring & Integration (Week 4)
**Deliverables**:
- Updated git-workflow.yaml referencing skill with loading mechanism
- Updated implement-trd.yaml using interview templates
- Removed duplicate git-town instructions from 3+ agents
- Skill loading integration tests

**Acceptance**:
- All agents pass existing test suites
- Agent prompt length reduced by 30%
- Zero regression in git-town functionality
- Skill loading performance meets <100ms target
- Integration tests demonstrate successful skill discovery

**Time Estimate**: 1 week

### Phase 4: Advanced Workflows & Onboarding (Weeks 5-6)
**Deliverables**:
- Stacked branches documentation (append, prepend, detach, swap)
- Advanced error recovery patterns (continue, skip, undo with scenarios)
- Offline mode configuration
- Onboarding guide for new developers
- Migration guides (git-flow, GitHub Flow, trunk-based)
- Monorepo workflow guide
- CI/CD integration guide (GitHub Actions, GitLab CI, CircleCI)

**Acceptance**:
- Advanced commands documented with 3+ examples each
- Error recovery tested with simulated conflicts
- Offline mode validated in disconnected environment
- Onboarding guide validated with 3+ new developers (<1 day to first workflow)
- Migration guides tested with real migration scenarios (75% success rate)
- CI/CD examples tested in real pipeline environments (zero interactive prompt failures)

**Time Estimate**: 2 weeks (extended from 1 week for comprehensive onboarding/migration content)

### Phase 5: Testing, Validation & Documentation (Weeks 7-8)
**Deliverables**:
- Enhanced validation script (configuration checks, platform detection)
- Integration tests for agent workflows (including error scenarios)
- Cross-platform testing (macOS, Linux, Windows)
- Performance benchmarks (skill loading, validation script)
- User acceptance testing with 5+ developers (including migration scenarios)
- Final documentation review and polish

**Acceptance**:
- 100% of success metrics met
- Zero critical bugs reported
- Documentation reviewed and approved by 2+ developers
- Cross-platform tests pass on all supported platforms
- Performance metrics validated (<100ms skill loading, <500ms validation)
- User acceptance testing shows 90%+ satisfaction

**Time Estimate**: 2 weeks (extended from 1 week for comprehensive testing)

**Total Timeline**: 6-8 weeks (extended from 5 weeks to include advanced workflows, extensive testing, and team onboarding documentation upfront)

---

## 6. Dependencies & Constraints

### 6.1 Technical Dependencies
- **Git-Town CLI**: Requires git-town >= 15.0.0 (for `--title`, `--body` flags on propose)
- **Git**: Requires git >= 2.30 for git-town compatibility
- **Ensemble Plugin System**: Follows AgentOS skill structure (SKILL.md, REFERENCE.md)
- **Shell Environment**: Bash 3.2+ (macOS), Bash 4.0+ (Linux), Bash 4.4+ (Windows Git Bash)
- **Platform Support**: macOS, Linux, Windows (Git Bash)

### 6.2 Integration Points
- **git-workflow agent**: Primary consumer of git-town skill
- **implement-trd command**: Uses skill for branch creation workflows
- **ensemble-orchestrator**: May delegate to git-workflow with skill context
- **CI/CD Systems**: GitHub Actions, GitLab CI, CircleCI integration examples
- **Monorepo Tools**: Nx, Turborepo, Lerna compatibility

### 6.3 Constraints
- **No Interactive Prompts**: All workflows MUST use CLI arguments only
- **No Git-Town Modification**: We will NOT fork or patch git-town
- **Backward Compatibility**: Existing agent behaviors MUST NOT break during refactoring
- **Cross-Platform**: All scripts MUST work on macOS, Linux, Windows (Git Bash)
- **Performance**: Skill loading MUST complete in <100ms
- **XDG Compliance**: Skill files MUST follow XDG directory structure

### 6.4 Technical Constraints: Skill Loading Mechanism

#### 6.4.1 Skill Discovery
Agents discover skills using the following search paths (XDG-compliant):
1. `$CLAUDE_PLUGIN_ROOT/packages/git/skills/git-town/`
2. `$XDG_CONFIG_HOME/ensemble/skills/git-town/`
3. `~/.config/ensemble/skills/git-town/`
4. `~/.ensemble/skills/git-town/`

#### 6.4.2 Skill Loading Protocol
- **Lazy Loading**: Skills loaded on-demand when referenced by agent
- **Caching**: Parsed skill content cached in memory for subsequent uses
- **Cache Invalidation**: Cache invalidated on skill file modification (mtime check)
- **Error Handling**: Missing skills trigger graceful fallback with clear error message

#### 6.4.3 Agent Skill Reference
Agents reference skills via YAML frontmatter:
```yaml
---
name: git-workflow
skills:
  - git-town
---
```

Or via mission statement:
```markdown
## Mission
Reference the git-town skill for command syntax and workflows.
```

#### 6.4.4 Performance Requirements
- Skill file parsing: <50ms
- Skill caching overhead: <10ms
- Total loading overhead: <100ms (including disk I/O)

#### 6.4.5 Cross-Platform Skill Paths
- **macOS**: `/Users/<user>/.config/ensemble/skills/git-town/`
- **Linux**: `/home/<user>/.config/ensemble/skills/git-town/`
- **Windows**: `C:\Users\<user>\.config\ensemble\skills\git-town\`
- Path separators normalized automatically by plugin system

### 6.5 Risks & Mitigation

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| Git-town version incompatibility | High | Medium | Document minimum version, validate in script, provide upgrade instructions |
| Agents ignore skill and embed instructions | Medium | Low | Code review enforcement, automated linting, integration tests |
| User confusion during interviews | Medium | Medium | Provide clear examples, validate input formats, error messages with suggestions |
| Skill becomes outdated with git-town updates | Medium | High | Quarterly review process, monitor git-town releases, version compatibility matrix |
| Platform-specific script failures | High | Medium | Cross-platform testing infrastructure, POSIX-compliant syntax, platform detection |
| Skill loading performance degradation | Medium | Low | Performance benchmarks, caching strategy, lazy loading |
| Migration guide incompleteness | Medium | High | User acceptance testing with real migrations, iterative refinement based on feedback |
| CI/CD integration issues | High | Medium | Test in real CI/CD environments, provide multiple platform examples, version pin recommendations |

---

## 7. Open Questions

1. **Skill Versioning**: Should git-town skill version track git-town CLI version or have independent versioning?
   - **Recommendation**: Independent versioning (skill v1.1 may support git-town 14.x-16.x)
   - **Rationale**: Decouples skill updates from git-town releases, allows iterative improvements

2. **Interview Automation**: Should we provide helper scripts to automate interview parsing, or keep templates as Markdown documentation?
   - **Recommendation**: Start with Markdown, evaluate programmatic helpers in v1.2
   - **Rationale**: Simpler maintenance, easier for humans to read/modify, sufficient for v1.1 scope

3. **Configuration Management**: Should skill include opinionated git-town configuration templates (e.g., GitHub-optimized)?
   - **Recommendation**: Yes, include 4 templates (GitHub, GitLab, Gitea, Minimal)
   - **Rationale**: Reduces onboarding friction, provides team standards starting point

4. **Fallback Strategy**: If git-town is unavailable, should agents fallback to raw git commands or fail fast?
   - **Recommendation**: Fail fast with clear installation instructions (avoid maintaining two implementations)
   - **Rationale**: Prevents subtle behavior differences, encourages proper git-town adoption

5. **Skill Discoverability**: How will agents discover the git-town skill when needed?
   - **Recommendation**: Explicit skill reference in agent YAML frontmatter, documented in ensemble-orchestrator delegation guide
   - **Rationale**: Clear, explicit, testable, follows existing plugin system patterns

6. **Migration Rollback**: Should migration guides include rollback procedures if teams want to revert to old workflows?
   - **Recommendation**: Yes, include rollback steps in all migration guides
   - **Rationale**: Reduces adoption risk, builds confidence, handles edge cases

7. **Monorepo Conventions**: Should we recommend specific branch naming patterns for monorepo scenarios?
   - **Recommendation**: Yes, recommend package-prefix pattern (e.g., `pkg-frontend/feature-name`)
   - **Rationale**: Improves clarity, simplifies CI/CD filtering, aligns with common monorepo practices

8. **CI/CD Branch Protection**: Should we recommend specific branch protection rules for git-town workflows?
   - **Recommendation**: Yes, include recommended rules in CI/CD integration guide
   - **Rationale**: Prevents common mistakes (direct commits to main, force pushes), enforces workflow discipline

---

## 8. Success Criteria Summary

**Launch Readiness**:
- [ ] All Phase 1-3 deliverables complete
- [ ] Zero critical bugs in validation testing
- [ ] Documentation reviewed by 2+ developers
- [ ] Integration tests passing for git-workflow and implement-trd
- [ ] Cross-platform tests passing on macOS, Linux, Windows
- [ ] Performance benchmarks meeting targets (<100ms skill loading)

**Post-Launch (30 days)**:
- [ ] 80% adoption by git-town-using agents
- [ ] <5 support tickets related to git-town workflows
- [ ] Positive feedback from 5+ users
- [ ] 90% of new developers onboarded within 1 day
- [ ] 75% of migrations from other workflows successful

**Long-Term (90 days)**:
- [ ] 100% adoption by git-town-using agents
- [ ] Zero duplicate git-town implementations
- [ ] Git-town skill referenced by 3+ community plugins (if ecosystem grows)
- [ ] Zero support tickets related to platform-specific issues
- [ ] 95% of errors handled autonomously

---

## 9. Appendix

### 9.1 Related Documents
- Ensemble Plugin Development Guide: `/Users/ldangelo/Development/Fortium/ensemble/CLAUDE.md`
- Git-Town Official Documentation: https://www.git-town.com/
- Act Local CI Skill (reference example): `packages/git/skills/act-local-ci/`
- XDG Base Directory Specification: https://specifications.freedesktop.org/basedir-spec/basedir-spec-latest.html

### 9.2 Glossary
- **Git-Town**: CLI tool providing high-level git workflow commands
- **Skill**: Reusable knowledge module in AgentOS/Ensemble ecosystem
- **Interview Template**: Structured questionnaire for agents to gather user input
- **Non-Interactive**: CLI commands using explicit arguments, not interactive prompts
- **Stacked Branches**: Git-town pattern for dependent feature branches (parent-child hierarchy)
- **Monorepo**: Single repository containing multiple packages/projects
- **XDG**: Cross-Desktop Group standard for directory structure
- **Skill Loading**: Runtime mechanism for agents to discover and reference skills

### 9.3 Revision History
| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0.0 | 2025-12-29 | Product Management Orchestrator | Initial PRD creation |
| 1.1.0 | 2025-12-29 | Product Management Orchestrator | Refinement based on stakeholder feedback: (1) Expanded error scenarios with comprehensive ERROR_HANDLING.md section including merge conflicts, network errors, config errors, branch state errors, authentication errors, and git-town version errors with agent decision logic, (2) Added new user scenarios: monorepo workflows, team onboarding, migration from git-flow/GitHub Flow/trunk-based, CI/CD integration patterns, (3) Extended timeline to 6-8 weeks incorporating advanced workflows, extensive testing, and team onboarding documentation upfront, (4) Added technical constraints: skill loading mechanism (XDG-compliant search paths, lazy loading, caching, performance <100ms), cross-platform compatibility (macOS/Linux/Windows Git Bash), (5) Updated all acceptance criteria to reflect new scope, (6) Incremented version to 1.1.0 |

---

## 10. Stakeholder Feedback & Resolution

### 10.1 Feedback Round 1 (2025-12-29)

#### 10.1.1 Requirements Needing More Detail
**Feedback**: Command examples need error scenarios

**Resolution**:
- Created comprehensive ERROR_HANDLING.md section (4.1.3) documenting 6 major error categories
- Added error examples to all command documentation (4.1.2)
- Included agent decision logic for retry vs. escalate scenarios
- Documented error detection, resolution workflows, and prevention best practices

#### 10.1.2 Missing User Scenarios to Address
**Feedback**: Need coverage for monorepo workflows, team onboarding, migration from other workflows, CI/CD integration patterns

**Resolution**:
- Added User Scenarios section (2.3) with 4 detailed scenarios:
  - Monorepo teams (2.3.1)
  - New developer onboarding (2.3.2)
  - Migration from other workflows (2.3.3)
  - CI/CD integration (2.3.4)
- Created corresponding acceptance criteria (4.1.7, 4.1.8)
- Updated implementation phases to include guides for each scenario (Phase 4)

#### 10.1.3 Timeline Adjustment
**Feedback**: Extend to 6-8 weeks (comprehensive)

**Resolution**:
- Extended Phase 1 from 1 to 2 weeks (comprehensive error documentation)
- Extended Phase 4 from 1 to 2 weeks (onboarding/migration guides)
- Extended Phase 5 from 1 to 2 weeks (comprehensive testing)
- Total timeline: 6-8 weeks (was 5 weeks)
- Adjusted deliverables to include advanced workflows, extensive testing, and team onboarding documentation upfront

#### 10.1.4 Additional Technical Constraints
**Feedback**: Need skill loading mechanism and cross-platform compatibility

**Resolution**:
- Added Skill Loading Mechanism section (6.4) documenting:
  - XDG-compliant skill discovery paths
  - Lazy loading and caching strategy
  - Agent skill reference patterns (YAML frontmatter)
  - Performance requirements (<100ms)
- Enhanced cross-platform compatibility requirements (4.1.9, 6.1, 6.4.5)
- Added platform-specific testing infrastructure
- Updated risks (6.5) to include platform-specific failures

---

**End of Document**