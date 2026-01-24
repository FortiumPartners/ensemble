---
template_type: interview
template_name: pr-creation
version: 1.0.0
git_town_command: propose
fields:
  - name: title
    type: string
    required: true
    validation: length
    min_length: 10
    max_length: 100
    error_message: "PR title must be between 10 and 100 characters"
    examples:
      - "Add OAuth2 authentication integration"
      - "Fix login bug when using social media accounts"
      - "Refactor database connection pooling"
  - name: body
    type: string
    required: false
    validation: file_or_string
    error_message: "PR body must be a string or path to existing readable file"
    examples:
      - "Implements OAuth2 flow with Google and GitHub providers..."
      - "/path/to/pr-description.md"
      - "docs/pull-requests/pr-123-description.md"
  - name: draft
    type: boolean
    required: false
    default: false
    description: "Create PR as draft (not ready for review)"
    examples:
      - true
      - false
  - name: auto_merge
    type: boolean
    required: false
    default: false
    description: "Enable auto-merge when all checks pass and PR is approved"
    examples:
      - true
      - false
---

# PR Creation Interview

## Purpose

This interview template guides agents through creating a Pull Request (PR) using the `git town propose` command. It ensures PRs have descriptive titles, comprehensive descriptions, and appropriate settings for draft status and auto-merge configuration.

## Context

Git-town's `propose` command creates a PR for the current feature branch against its parent branch (usually main). It leverages GitHub CLI (`gh`) or similar tools to interact with the repository hosting platform.

Key concepts:

- **Title**: Brief summary of changes (appears in PR list)
- **Body**: Detailed description with context, testing notes, and screenshots
- **Draft**: Work-in-progress PR not ready for review
- **Auto-merge**: Automatically merge when approved and checks pass

## Interview Questions

### Question 1: PR Title (Required)

**Prompt**: "What is the title for this Pull Request?"

**Guidance**:
- Be concise but descriptive (10-100 characters)
- Use imperative mood ("Add feature" not "Added feature")
- Start with capital letter
- Don't end with period
- Follow conventional commit style if applicable:
  - `feat: Add user authentication`
  - `fix: Resolve login redirect issue`
  - `refactor: Simplify database queries`

**Validation**:
```javascript
const titleLength = title.length;
if (titleLength < 10 || titleLength > 100) {
  throw new Error(`PR title must be between 10-100 characters (got ${titleLength})`);
}
```

**Examples**:
```
Good titles:
  - "Add OAuth2 authentication integration"
  - "Fix login bug when using social media accounts"
  - "Refactor database connection pooling"
  - "feat: Implement rate limiting for API endpoints"
  - "docs: Add deployment guide for production"

Poor titles:
  - "Fix" (too vague, too short)
  - "Authentication" (not descriptive enough)
  - "Added the new OAuth2 authentication integration feature with Google and GitHub providers and updated tests" (too long)
  - "fix bug." (ends with period)
```

### Question 2: PR Body (Optional)

**Prompt**: "Provide the PR description (optional). You can provide text directly or a path to a markdown file."

**Guidance**:
- Include context: Why was this change needed?
- List key changes made
- Add testing instructions
- Include screenshots for UI changes
- Link related issues with `Fixes #123` or `Closes #456`
- Can provide file path instead of inline text

**Validation**:
```bash
# If body looks like a file path
if [[ "$BODY" == *.md ]] || [[ "$BODY" == /* ]] || [[ "$BODY" == ./* ]]; then
  if [ ! -f "$BODY" ]; then
    echo "Error: File not found: $BODY"
    exit 1
  fi
  if [ ! -r "$BODY" ]; then
    echo "Error: File not readable: $BODY"
    exit 2
  fi
  BODY_CONTENT=$(cat "$BODY")
else
  BODY_CONTENT="$BODY"
fi
```

**Examples**:

*Inline description*:
```markdown
## Summary
Implements OAuth2 authentication flow with support for Google and GitHub providers.

## Changes
- Add OAuth2 client configuration
- Implement callback handler for provider redirects
- Update user model with provider fields
- Add integration tests for auth flows

## Testing
1. Configure OAuth app credentials in .env
2. Visit /auth/google to test Google login
3. Visit /auth/github to test GitHub login
4. Verify user profile updates after login

## Screenshots
[Attach login flow screenshots]

Fixes #234
```

*File path*:
```
docs/pull-requests/pr-oauth-integration.md
```

*Minimal*:
```
Adds rate limiting middleware to prevent API abuse.
```

### Question 3: Draft PR (Optional)

**Prompt**: "Should this be created as a draft PR? (default: false)"

**Guidance**:
- Use draft when work is not ready for review
- Draft PRs can still run CI/CD checks
- Team members can see progress but won't be notified for review
- Convert to ready-for-review when complete

**Examples**:
```
Use draft=true when:
  - Work in progress, not complete
  - Want CI feedback before requesting review
  - Sharing progress with team
  - Tests not yet passing
  - Documentation not complete

Use draft=false (default) when:
  - Feature complete and tested
  - Ready for code review
  - All checks passing
  - Documentation updated
```

### Question 4: Auto-Merge (Optional)

**Prompt**: "Enable auto-merge when approved and checks pass? (default: false)"

**Guidance**:
- Auto-merge requires branch protection rules
- PR will merge automatically when:
  - All required reviews approved
  - All status checks passing
  - No merge conflicts
- Useful for reducing manual merge overhead
- Not recommended for complex or risky changes

**Examples**:
```
Use auto_merge=true when:
  - Simple dependency updates
  - Minor bug fixes
  - Documentation updates
  - Automated bot PRs (Dependabot, Renovate)
  - Low-risk refactoring

Use auto_merge=false (default) when:
  - Major features requiring careful merge timing
  - Breaking changes needing coordination
  - Database migrations
  - Security-sensitive changes
  - Want manual control over merge timing
```

## Validation Rules

### Pre-Execution Validation

1. **PR title length**:
   - Minimum: 10 characters
   - Maximum: 100 characters
   - No trailing punctuation

2. **PR body validation**:
   - If looks like file path: verify file exists and is readable
   - If inline text: no validation (can be empty)

3. **Current branch state**:
   - Must be on a feature branch (not main/master)
   - Branch must have commits ahead of base branch
   - Branch must be tracked on remote (pushed)

4. **Git-town prerequisites**:
   - GitHub CLI (`gh`) must be installed and authenticated
   - Repository must have remote configured
   - User must have push access to repository

### Validation Script

```bash
#!/usr/bin/env bash
set -e

# Validate PR title length
TITLE_LENGTH=${#TITLE}
if [ "$TITLE_LENGTH" -lt 10 ] || [ "$TITLE_LENGTH" -gt 100 ]; then
  echo "Error: PR title must be 10-100 characters (got $TITLE_LENGTH)"
  exit 1
fi

# Validate body if it looks like a file path
if [[ "$BODY" =~ \.(md|txt)$ ]] || [[ "$BODY" =~ ^[./] ]]; then
  if [ ! -f "$BODY" ]; then
    echo "Error: File not found: $BODY"
    exit 2
  fi
  if [ ! -r "$BODY" ]; then
    echo "Error: File not readable: $BODY"
    exit 3
  fi
fi

# Validate current branch
CURRENT_BRANCH=$(git symbolic-ref --short HEAD)
if [[ "$CURRENT_BRANCH" == "main" || "$CURRENT_BRANCH" == "master" ]]; then
  echo "Error: Cannot create PR from main/master branch"
  exit 4
fi

# Validate branch has commits
PARENT_BRANCH=$(git config "git-town.parent.$CURRENT_BRANCH" || echo "main")
AHEAD=$(git rev-list --count "$PARENT_BRANCH..$CURRENT_BRANCH")
if [ "$AHEAD" -eq 0 ]; then
  echo "Error: Branch has no new commits"
  exit 5
fi

# Validate GitHub CLI installed and authenticated
if ! command -v gh &> /dev/null; then
  echo "Error: GitHub CLI (gh) not installed"
  exit 6
fi

if ! gh auth status &> /dev/null; then
  echo "Error: GitHub CLI not authenticated. Run 'gh auth login'"
  exit 7
fi

echo "Validation passed"
```

## Example Workflows

### Workflow 1: Standard Feature PR

```
Current branch: feature/oauth-integration
Commits ahead of main: 8

Agent: "What is the title for this Pull Request?"
User: "Add OAuth2 authentication integration"

Agent: "Provide the PR description (optional). You can provide text directly or a path to a markdown file."
User: "## Summary
Implements OAuth2 flow with Google and GitHub providers.

## Changes
- Add OAuth2 client configuration
- Implement callback handlers
- Update user model

## Testing
Tested with both providers in staging environment.

Fixes #234"

Agent: "Should this be created as a draft PR? (default: false)"
User: [Enter] (uses default)

Agent: "Enable auto-merge when approved and checks pass? (default: false)"
User: [Enter] (uses default)

Agent executes:
  git town propose

Result:
  - PR created: "Add OAuth2 authentication integration"
  - Body includes summary, changes, testing notes
  - Ready for review (not draft)
  - Manual merge required
  - Issue #234 linked and will close on merge
```

### Workflow 2: Draft PR with File Description

```
Current branch: feature/api/rate-limiting
Commits ahead of main: 3

Agent: "What is the title for this Pull Request?"
User: "feat: Implement rate limiting for API endpoints"

Agent: "Provide the PR description (optional). You can provide text directly or a path to a markdown file."
User: "docs/prs/rate-limiting.md"

Agent: [Validates file exists and is readable]

Agent: "Should this be created as a draft PR? (default: false)"
User: "true"

Agent: "Enable auto-merge when approved and checks pass? (default: false)"
User: [Enter] (uses default)

Agent executes:
  git town propose --draft

Result:
  - PR created as draft
  - Description loaded from docs/prs/rate-limiting.md
  - Marked "Work in Progress"
  - CI checks run but no review requests sent
  - Can convert to ready later
```

### Workflow 3: Dependency Update with Auto-Merge

```
Current branch: chore/update-dependencies
Commits ahead of main: 1

Agent: "What is the title for this Pull Request?"
User: "chore: Update npm dependencies to latest versions"

Agent: "Provide the PR description (optional). You can provide text directly or a path to a markdown file."
User: "Updated all npm packages to latest stable versions. All tests passing."

Agent: "Should this be created as a draft PR? (default: false)"
User: [Enter] (uses default)

Agent: "Enable auto-merge when approved and checks pass? (default: false)"
User: "true"

Agent executes:
  git town propose --auto-merge

Result:
  - PR created and ready for review
  - Auto-merge enabled
  - When approved + CI passes, merges automatically
  - Reduces manual overhead for routine updates
```

### Workflow 4: Minimal PR

```
Current branch: fix/typo-in-readme
Commits ahead of main: 1

Agent: "What is the title for this Pull Request?"
User: "docs: Fix typo in README installation section"

Agent: "Provide the PR description (optional). You can provide text directly or a path to a markdown file."
User: [Enter] (skips description)

Agent: "Should this be created as a draft PR? (default: false)"
User: [Enter] (uses default)

Agent: "Enable auto-merge when approved and checks pass? (default: false)"
User: [Enter] (uses default)

Agent executes:
  git town propose

Result:
  - PR created with title only
  - No description (GitHub shows commit messages)
  - Ready for quick review and merge
  - Good for trivial changes
```

## Error Handling

### Common Errors

1. **Title too short/long**:
```
Error: PR title must be 10-100 characters (got 5)
Received: "Fix"
Suggestion: Be more descriptive: "Fix login redirect after OAuth callback"
```

2. **Description file not found**:
```
Error: File not found: docs/prs/my-pr.md
Suggestion: Check file path or provide description inline
```

3. **Not on feature branch**:
```
Error: Cannot create PR from main/master branch
Current branch: main
Suggestion: Create a feature branch first with 'git town hack <branch-name>'
```

4. **No commits ahead**:
```
Error: Branch has no new commits
Current branch: feature/my-feature
Base branch: main
Suggestion: Make changes and commit before creating PR
```

5. **GitHub CLI not authenticated**:
```
Error: GitHub CLI not authenticated
Suggestion: Run 'gh auth login' to authenticate with GitHub
```

6. **Branch not pushed to remote**:
```
Error: Branch not tracked on remote
Suggestion: Run 'git push -u origin feature/my-feature' first
```

## Success Criteria

PR creation is successful when:

1. PR exists on GitHub: `gh pr view` shows PR details
2. PR has correct title matching input
3. PR body matches provided description or file contents
4. Draft status matches requested setting
5. Auto-merge status matches requested setting
6. PR is linked to current branch
7. PR targets correct base branch (parent)

## Post-Creation Actions

After successful PR creation, agents should:

1. Display PR URL:
   ```bash
   gh pr view --web
   # Opens PR in browser
   ```

2. Show PR details:
   ```bash
   gh pr view
   # Output:
   # title: Add OAuth2 authentication integration
   # state: OPEN
   # author: username
   # url: https://github.com/org/repo/pull/123
   ```

3. Inform user of next steps:
   - Wait for CI checks to complete
   - Address review comments if any
   - Update PR with additional commits if needed
   - Convert from draft if applicable: `gh pr ready`
   - Merge when approved: `git town ship`

4. Monitor PR status:
   ```bash
   gh pr checks
   # Shows CI check status
   ```

## Advanced Scenarios

### Linking Multiple Issues

```markdown
## Summary
Comprehensive auth system overhaul.

## Issues Resolved
Fixes #234, #245, #267
Closes #189

All issues will close automatically when PR merges.
```

### Including Screenshots

```markdown
## UI Changes

Before:
![before](https://user-images.githubusercontent.com/123/before.png)

After:
![after](https://user-images.githubusercontent.com/123/after.png)
```

### Stacked PRs

For stacked branches, each branch gets its own PR:

```
Branch stack:
  main → feature/backend → feature/frontend → feature/tests

Create 3 PRs:
  1. feature/backend → main
  2. feature/frontend → feature/backend
  3. feature/tests → feature/frontend

Merge order: bottom-up (backend, then frontend, then tests)
```

### PR Templates

If repository has `.github/PULL_REQUEST_TEMPLATE.md`, it's automatically used:

```markdown
## Description
[Describe your changes]

## Type of change
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change

## Checklist
- [ ] Tests added
- [ ] Documentation updated
- [ ] No console errors
```

## Configuration

Git-town PR creation uses these settings:

```bash
# Set GitHub remote
git config git-town.code-hosting-platform github

# Set GitHub origin type
git config git-town.github-origin origin

# Use custom PR template
git config git-town.pr-template-file .github/PR_TEMPLATE.md
```

## Reference

- Git-town documentation: https://www.git-town.com/commands/propose
- GitHub CLI documentation: https://cli.github.com/manual/gh_pr_create
- GitHub PR best practices: https://docs.github.com/en/pull-requests
- Conventional commits: https://www.conventionalcommits.org/
