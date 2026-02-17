---
name: ensemble:fix-issue
description: Lightweight workflow for bug fixes and small issues - orchestrates complete workflow from analysis to PR creation

---
<!-- DO NOT EDIT - Generated from fix-issue.yaml -->
<!-- To modify this file, edit the YAML source and run: npm run generate -->


This command provides a streamlined workflow for bug fixes and small issues, reducing workflow time
by 60-70% compared to the full PRD/TRD cycle. It assembles a virtual team of specialized agents
(Product Manager, Tech Lead, Architect, QA Lead) to ensure high-quality fixes with minimal user intervention.

## Parameters

- `description` (string, optional): Issue description in free text. Omit if using --issue flag.
- `issue` (number, optional): GitHub issue number (e.g., --issue 34)
- `branch` (string, optional): Custom branch name (default: auto-generated)
- `skip-tests` (boolean, default: false): Skip test validation (not recommended)
- `draft-pr` (boolean, default: false): Create draft PR instead of ready-for-review
- `interactive` (boolean, default: false): Enable detailed user interviews during planning

## Usage Examples

```bash
# Fix with issue description
/ensemble:fix-issue "Fix timeout bug in auth flow"

# Fix with GitHub issue number
/ensemble:fix-issue --issue 34

# Interactive mode with user interview
/ensemble:fix-issue "Fix pagination" --interactive

# Custom branch with skip tests
/ensemble:fix-issue "Quick fix" --branch hotfix/urgent --skip-tests

# Create draft PR
/ensemble:fix-issue --issue 42 --draft-pr
```

## Workflow

### Phase 1: Analysis & Planning

**1. Codebase Analysis**
   Explore codebase to identify affected files, patterns, and scope

   **Agent:** @general-purpose (Model: haiku)

   - Extract keywords from issue description
   - Search codebase for relevant files (Grep)
   - Identify related test files
   - Detect framework and testing patterns (package.json, imports)
   - Estimate scope (file count, estimated LOC)
   - Return structured analysis result

**2. Collaborative Planning**
   Assemble virtual team of 4 specialized agents to create comprehensive fix plan

   **Model:** sonnet

   Delegate planning to 4 agents in sequence:

   1. **@product-management-orchestrator**
      - Validate problem statement
      - Define acceptance criteria
      - Identify user impact and edge cases

   2. **@tech-lead-orchestrator**
      - Review technical approach
      - Ensure consistency with codebase patterns
      - Validate feasibility

   3. **@infrastructure-orchestrator**
      - Evaluate architecture implications
      - Identify dependencies and integration points
      - Assess scalability and maintainability

   4. **@qa-orchestrator**
      - Define test coverage requirements
      - Create test strategy
      - Identify quality gates

   Synthesize responses into unified plan with:
   - Approach summary
   - Files to modify
   - Test strategy
   - Edge cases to handle

**3. User Interview (Conditional)**
   If issue description is ambiguous or --interactive flag is set, ask clarifying questions

   **Conditional:** true

   **Trigger:**
   - Description < 20 words
   - Vague terms ("doesn't work", "broken", "issue")
   - Multiple possible interpretations
   - OR --interactive flag is set

   **Actions:**
   - Generate 3-5 focused questions
   - Use AskUserQuestion tool
   - Incorporate responses into plan
   - Update approach and acceptance criteria

### Phase 2: Execution

**1. Branch Creation**
   Create git branch with conventional naming

   **Tool:** Bash

   - Generate branch name:
     - IF --branch flag: Use custom name
     - ELIF --issue flag: `fix/issue-{number}-{slugified-description}`
     - ELSE: `fix/{slugified-description}`
   - Check if branch exists using `git branch --list`
   - Create branch using `git checkout -b {branch-name}`
   - Verify creation with `git branch --show-current`

**2. Task List Generation**
   Break down plan into actionable tasks

   **Tool:** TodoWrite

   Generate 3-10 specific, actionable tasks from plan:

   Format:
   ```
   - content: "Update timeout.ts constant from 30s to 60s"
     activeForm: "Updating timeout constant"
     status: "pending"
   ```

   Include:
   - Implementation tasks (file modifications)
   - Test update tasks
   - Validation tasks

   Each task should be:
   - Specific to a file or component
   - Actionable (clear what to do)
   - Testable (clear success criteria)

**3. Task Execution**
   Execute all tasks with appropriate agent delegation and real-time progress tracking

   **Model:** sonnet

   FOR EACH task in task list:

   1. Mark task as in_progress using TodoWrite
   2. Select appropriate agent:
      - Backend code → @backend-developer
      - Frontend code → @frontend-developer
      - Infrastructure → @infrastructure-developer
      - Generic → @general-purpose
   3. Delegate task using Task tool
   4. Mark task as completed using TodoWrite
   5. IF task fails:
      - Keep status as "in_progress"
      - Log error details
      - Continue with remaining tasks
      - Report failures at end

### Phase 3: Validation & Delivery

**1. Test Validation**
   Run test suite with auto-fix retry logic

   **Agent:** @test-runner (Model: haiku)
   **Retry:** 2 attempts

   1. Detect test framework:
      - Check package.json for jest, pytest, rspec, etc.
      - Check for test files and imports
      - Determine test command (npm test, pytest, rspec)

   2. Run tests (Attempt 1):
      - Execute test command via Bash
      - Parse output for pass/fail

   3. IF tests fail:
      - Analyze failure output
      - Identify root causes
      - Attempt fixes (Edit files)
      - Run tests again (Attempt 2)

   4. IF tests still fail after 2 attempts:
      - Report failures to user with details
      - HALT workflow (do not create PR)
      - Provide recovery instructions

   5. IF --skip-tests flag:
      - Log warning message
      - Skip test execution
      - Proceed to PR creation

**2. PR Creation**
   Create comprehensive pull request with GitHub CLI

   **Tool:** Bash (Model: haiku)

   1. Generate commit message:
      - Format: `"Fix: {brief description}"`
      - OR if issue number: `"Fix #{number}: {description}"`
      - Use conventional commit format

   2. Commit changes:
      - `git add .`
      - `git commit -m "{message}"`

   3. Push branch:
      - `git push -u origin {branch-name}`
      - Handle push errors (auth, network)

   4. Generate PR title:
      - IF issue number: `"Fix #{number}: {description}"`
      - ELSE: `"Fix: {description}"`

   5. Generate PR body:
      ```markdown
      ## Problem
      {Issue description from user or GitHub issue}

      ## Solution
      {Summary of changes made, approach taken}

      ## Changes
      - {File 1}: {Description}
      - {File 2}: {Description}

      ## Test Plan
      {What was tested, coverage added}

      ## Checklist
      - [x] Tests pass locally
      - [x] Code follows project conventions
      - [x] No new warnings or errors

      Fixes #{issue-number}

      🤖 Generated with [Ensemble Fix-Issue](https://github.com/FortiumPartners/ensemble)
      ```

   6. Create PR:
      - IF --draft-pr: `gh pr create --draft --title "..." --body "..."`
      - ELSE: `gh pr create --title "..." --body "..."`

   7. Extract PR URL from output

   8. Display to user:
      - "✓ PR created: {url}"
      - "✓ Branch pushed: {branch-name}"
      - "✓ All tests passed"

## Mission

**Summary:**
Orchestrate a complete bug fix workflow from analysis to PR creation, assembling a virtual team
of specialized agents (Product Manager, Tech Lead, Architect, QA Lead) to ensure high-quality
fixes with minimal user intervention.

**Behavior:**
- Execute 3-phase workflow: Analysis & Planning, Execution, Validation & Delivery
- Delegate codebase analysis to general-purpose agent (Haiku for speed)
- Assemble 4-agent team for collaborative planning (Sonnet for quality)
- Conduct user interview only if description is ambiguous or --interactive flag set
- Create git branch following convention: fix/issue-{num}-{slug}
- Generate actionable task list and track progress with TodoWrite
- Delegate implementation to appropriate agents (backend, frontend, infrastructure)
- Run test suite with auto-fix retry logic (max 2 attempts)
- Create comprehensive PR with GitHub CLI
- Provide clear error messages and recovery guidance

**Constraints:**
- GitHub only (no GitLab/Bitbucket in v1.0)
- GitHub CLI (gh) must be installed and authenticated
- Tests must pass unless --skip-tests flag is used
- Maximum 2 auto-fix attempts for test failures
- User interview limited to 5 questions maximum
- Branch naming follows fixed convention (customizable via --branch)

## Required Tools

- Bash
- Read
- Write
- Edit
- Grep
- Glob
- Task
- TodoWrite

## Required Agents

- @general-purpose
- @product-management-orchestrator
- @tech-lead-orchestrator
- @infrastructure-orchestrator
- @qa-orchestrator
- @backend-developer
- @frontend-developer
- @infrastructure-developer
- @test-runner
- @git-workflow
- @github-specialist

## Required External Tools

- git (version 2.0+)
- gh (GitHub CLI, authenticated)

## Model Selection Strategy

- **Analysis Phase:** Haiku (fast, cost-effective exploration)
- **Planning Phase:** Sonnet (high-quality multi-agent collaboration)
- **Implementation Phase:** Sonnet (quality coding)
- **Testing Phase:** Haiku (fast test execution and basic fixes)
- **PR Creation:** Haiku (fast documentation generation)

## Decision Tree: When to Use Fix-Issue vs PRD/TRD

### Use `/ensemble:fix-issue` for:
- Bug fixes (single root cause)
- Small feature additions (1-3 files)
- Configuration changes
- Dependency updates
- Performance optimizations (localized)
- Documentation fixes
- Test additions

### Use `/ensemble:create-prd` + `/ensemble:create-trd` for:
- New features (multiple components)
- Architecture changes
- API design (multiple endpoints)
- Database schema changes
- Multi-service integration
- Major refactoring
- Security enhancements requiring design review

## Success Metrics (v1.0 Targets)

- **Workflow Time Reduction:** 60-70% vs manual PRD/TRD
- **Workflow Success Rate:** >90% (no manual intervention)
- **PR Quality Score:** 4+/5 (human review)
- **Test Pass Rate (First Try):** >80%
- **Time to PR (p90):** <90 minutes
- **Average Cost per Bug:** <$0.50

## Examples

### Example 1: Simple Bug Fix
```bash
/ensemble:fix-issue "Increase auth timeout from 30s to 60s"
```

Output:
- Analysis identifies `auth/timeout.ts` and related tests
- 4 agents create plan (increase constant, add edge case tests)
- Branch created: `fix/increase-auth-timeout`
- Tasks executed: Update constant, add tests
- Tests pass on first attempt
- PR created with comprehensive description

### Example 2: Bug Fix with GitHub Issue
```bash
/ensemble:fix-issue --issue 34
```

Output:
- Fetches issue #34 from GitHub API
- Analyzes issue description and comments
- Creates branch: `fix/issue-34-auth-timeout`
- Follows same workflow as Example 1
- PR automatically links to issue with `Fixes #34`

### Example 3: Interactive Mode
```bash
/ensemble:fix-issue "Fix pagination bug" --interactive
```

Output:
- Analysis finds multiple pagination implementations
- Ambiguity detected → triggers user interview
- Questions asked:
  1. "Which pagination component is affected? (ProductList, UserTable, OrderHistory)"
  2. "What is the expected behavior?"
  3. "Should we fix all pagination or just this component?"
- User responses integrated into plan
- Implementation proceeds with clarified requirements

### Example 4: Draft PR for Review
```bash
/ensemble:fix-issue --issue 42 --draft-pr
```

Output:
- Same workflow as standard fix
- PR created as draft (not ready for review)
- Allows for additional manual changes before marking ready

## Troubleshooting

### "Git authentication failed"
Ensure GitHub credentials are configured:
```bash
gh auth status
gh auth login  # if not authenticated
```

### "Tests still failing after 2 attempts"
The workflow halts to prevent creating a PR with failing tests. Review the test output:
1. Check the error messages from the test runner
2. Manually fix the issues
3. Run tests locally: `npm test` (or appropriate command)
4. Either:
   - Continue manually (commit, push, create PR)
   - OR re-run `/ensemble:fix-issue` with `--skip-tests` (not recommended)

### "Branch already exists"
Either:
- Switch to existing branch: `git checkout fix/issue-XX`
- Delete old branch: `git branch -D fix/issue-XX`
- Use custom branch name: `/ensemble:fix-issue --branch fix/issue-XX-v2`

### "Ambiguity detected but I don't want interview"
The command tries to be smart about when to ask questions. To skip:
- Provide more detailed description (>20 words)
- Be specific (avoid "doesn't work", "broken")
- If interview still triggers, provide dummy answers or cancel

### "Cost concerns"
Estimated costs per fix:
- Small bug fix: $0.20-0.40 (mostly Haiku usage)
- Medium complexity: $0.40-0.80 (more Sonnet for implementation)
- Complex/ambiguous: $0.80-1.50 (user interview + multiple iterations)

To reduce costs:
- Provide detailed descriptions (skip interview phase)
- Use `--skip-tests` for non-critical changes (saves retry attempts)
- Batch similar fixes together manually

## Version History

- **v1.0.0** (2026-02-17): Initial release
  - 3-phase workflow (Analysis, Execution, Validation)
  - 4-agent collaborative planning
  - Conditional user interview
  - Auto-fix test retry logic (max 2 attempts)
  - Comprehensive PR generation
  - GitHub-only support

---

🤖 Generated by Ensemble Development Plugin v5.2.3
