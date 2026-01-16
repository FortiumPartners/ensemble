---
template_type: interview
template_name: completion
version: 1.0.0
git_town_command: ship
fields:
  - name: commit_message
    type: string
    required: false
    validation: length
    min_length: 10
    max_length: 500
    error_message: "Commit message must be 10-500 characters if provided"
    description: "Custom squash commit message (uses git-town default if not provided)"
    examples:
      - "feat: Add OAuth2 authentication with Google and GitHub providers"
      - "fix: Resolve login redirect issue after social auth callback"
      - "refactor: Simplify database connection pooling logic"
  - name: confirm
    type: boolean
    required: true
    validation: must_be_true
    error_message: "User must explicitly confirm before shipping branch"
    description: "Explicit confirmation required to proceed with ship operation"
    examples:
      - true
  - name: delete_remote
    type: boolean
    required: false
    default: true
    description: "Delete remote branch after successful ship (cleanup)"
    examples:
      - true
      - false
---

# Completion Interview

## Purpose

This interview template guides agents through completing a feature branch using the `git town ship` command. It ensures proper confirmation before merging, allows customization of the squash commit message, and manages remote branch cleanup. The ship operation is the final step in the git-town workflow.

## Context

Git-town's `ship` command performs these operations:

1. Syncs the feature branch with its parent (usually main)
2. Merges the feature branch into parent (squash merge by default)
3. Pushes the updated parent to remote
4. Deletes the local feature branch
5. Optionally deletes the remote feature branch
6. Switches back to parent branch

This is a **destructive operation** requiring explicit user confirmation.

## Interview Questions

### Question 1: Commit Message (Optional)

**Prompt**: "Provide a custom squash commit message (optional). If not provided, git-town will use the default from PR title or branch commits."

**Guidance**:
- Follow conventional commit format if applicable
- Summarize all changes in the branch
- Include issue references (Fixes #123)
- 10-500 characters if provided
- If empty, git-town uses:
  - PR title if PR exists
  - First commit message if single commit
  - Generated summary if multiple commits

**Validation**:
```javascript
if (commit_message && (commit_message.length < 10 || commit_message.length > 500)) {
  throw new Error(`Commit message must be 10-500 characters if provided (got ${commit_message.length})`);
}
```

**Examples**:
```
Good custom messages:
  - "feat: Add OAuth2 authentication with Google and GitHub providers"
  - "fix: Resolve login redirect issue after social auth callback (#234)"
  - "refactor: Simplify database connection pooling for better performance"

Default messages (when not provided):
  - Uses PR title: "Add OAuth2 authentication integration"
  - Uses first commit: "implement oauth2 flow"
  - Generated: "Merge feature/oauth-integration"

When to provide custom:
  - Want different message than PR title
  - PR doesn't exist
  - Multiple commits need better summary
  - Want to include issue references

When to use default:
  - PR title is perfect
  - Single descriptive commit
  - Using git-town's smart defaults
```

### Question 2: Confirmation (Required)

**Prompt**: "This will merge your feature branch into main and delete the local branch. Are you sure you want to proceed? (yes/no)"

**Guidance**:
- Must explicitly confirm with "yes" or "true"
- Cannot proceed without confirmation
- Review changes before confirming
- Ensure PR is approved if required
- Verify CI checks passed

**Validation**:
```javascript
if (confirm !== true && confirm !== "yes") {
  throw new Error("Ship operation cancelled - user must explicitly confirm");
}
```

**Warning Checklist**:
```
Before confirming, verify:
  ✓ All changes committed
  ✓ PR approved (if required by branch protection)
  ✓ CI checks passing
  ✓ No merge conflicts with main
  ✓ Ready to delete feature branch
  ✓ Correct branch is being shipped
```

**Examples**:
```
Agent: "This will merge feature/oauth-integration into main and delete the local branch. Are you sure? (yes/no)"

User: "yes" → Proceeds ✅
User: "true" → Proceeds ✅
User: "no" → Cancelled ❌
User: [Enter] → Cancelled ❌
User: "maybe" → Cancelled ❌
```

### Question 3: Delete Remote Branch (Optional)

**Prompt**: "Delete the remote branch after shipping? (default: true)"

**Guidance**:
- Default is true (cleanup remote branch)
- Set to false if you want to preserve remote branch
- Remote branch typically deleted automatically by PR merge
- Keep remote branch for audit or reference purposes

**Examples**:
```
Use delete_remote=true (default) when:
  - Standard workflow (recommended)
  - Want clean remote branch list
  - Branch served its purpose
  - PR already merged and closed

Use delete_remote=false when:
  - Want to preserve branch history on remote
  - Need reference for audit purposes
  - Testing ship operation
  - Manual remote cleanup preferred
```

## Validation Rules

### Pre-Execution Validation

1. **Commit message validation** (if provided):
   - Length: 10-500 characters
   - No trailing whitespace
   - Should start with capital letter or conventional prefix

2. **Confirmation validation**:
   - Must be explicitly true/"yes"
   - Cannot be empty, null, or "no"
   - Required field

3. **Branch state validation**:
   - Must be on a feature branch (not main/master)
   - Working directory must be clean
   - Branch must be in sync with remote
   - PR must exist and be approved (if branch protection enabled)

4. **Parent branch validation**:
   - Parent branch (main) must exist
   - Parent must be up-to-date with remote
   - No merge conflicts between feature and parent

### Validation Script

```bash
#!/usr/bin/env bash
set -e

# Validate commit message if provided
if [ -n "$COMMIT_MESSAGE" ]; then
  MSG_LENGTH=${#COMMIT_MESSAGE}
  if [ "$MSG_LENGTH" -lt 10 ] || [ "$MSG_LENGTH" -gt 500 ]; then
    echo "Error: Commit message must be 10-500 characters (got $MSG_LENGTH)"
    exit 1
  fi
fi

# Validate confirmation (required)
if [ "$CONFIRM" != "true" ] && [ "$CONFIRM" != "yes" ]; then
  echo "Error: Ship operation cancelled - user must explicitly confirm"
  exit 2
fi

# Validate current branch
CURRENT_BRANCH=$(git symbolic-ref --short HEAD)
if [[ "$CURRENT_BRANCH" == "main" || "$CURRENT_BRANCH" == "master" ]]; then
  echo "Error: Cannot ship main/master branch"
  exit 3
fi

# Validate clean working directory
if ! git diff-index --quiet HEAD --; then
  echo "Error: Working directory must be clean"
  exit 4
fi

# Validate branch is in sync with remote
if ! git diff --quiet "@{u}"; then
  echo "Error: Local branch is out of sync with remote. Run 'git town sync' first"
  exit 5
fi

# Validate parent branch
PARENT_BRANCH=$(git config "git-town.parent.$CURRENT_BRANCH" || echo "main")
if ! git rev-parse --verify "$PARENT_BRANCH" >/dev/null 2>&1; then
  echo "Error: Parent branch '$PARENT_BRANCH' does not exist"
  exit 6
fi

# Check for merge conflicts
if ! git merge-tree "$(git merge-base "$CURRENT_BRANCH" "$PARENT_BRANCH")" "$PARENT_BRANCH" "$CURRENT_BRANCH" | grep -q "changed in both"; then
  echo "Warning: Possible merge conflicts detected"
fi

echo "Validation passed"
```

## Example Workflows

### Workflow 1: Standard Ship with Default Message

```
Current branch: feature/oauth-integration
PR: #234 (approved, checks passing)

Agent: "Provide a custom squash commit message (optional)."
User: [Enter] (uses default from PR title)

Agent: "This will merge feature/oauth-integration into main and delete the local branch. Are you sure? (yes/no)"
User: "yes"

Agent: "Delete the remote branch after shipping? (default: true)"
User: [Enter] (uses default)

Agent executes:
  git town ship

Result:
  1. Syncs feature/oauth-integration with main
  2. Squash merges into main with PR title as message
  3. Pushes main to remote
  4. Deletes local feature/oauth-integration
  5. Deletes remote feature/oauth-integration
  6. Switches to main branch

Output:
  - Main branch updated
  - Feature branch removed
  - Clean working directory
```

### Workflow 2: Custom Commit Message

```
Current branch: fix/login-redirect
PR: #245 (approved)

Agent: "Provide a custom squash commit message (optional)."
User: "fix: Resolve login redirect issue after OAuth callback (#245)"

Agent: "This will merge fix/login-redirect into main and delete the local branch. Are you sure? (yes/no)"
User: "yes"

Agent: "Delete the remote branch after shipping? (default: true)"
User: [Enter] (uses default)

Agent executes:
  git town ship -m "fix: Resolve login redirect issue after OAuth callback (#245)"

Result:
  - Custom commit message used for squash merge
  - Issue #245 referenced in commit
  - Standard ship workflow completed
```

### Workflow 3: Preserve Remote Branch

```
Current branch: prototype/new-architecture
PR: #267 (merged)

Agent: "Provide a custom squash commit message (optional)."
User: [Enter]

Agent: "This will merge prototype/new-architecture into main and delete the local branch. Are you sure? (yes/no)"
User: "yes"

Agent: "Delete the remote branch after shipping? (default: true)"
User: "false"

Agent executes:
  git town ship --no-delete-remote

Result:
  - Branch shipped successfully
  - Local branch deleted
  - Remote branch preserved for reference
  - Can manually delete remote later: git push origin --delete prototype/new-architecture
```

### Workflow 4: User Cancellation

```
Current branch: feature/incomplete-work
PR: Not created yet

Agent: "Provide a custom squash commit message (optional)."
User: [Enter]

Agent: "This will merge feature/incomplete-work into main and delete the local branch. Are you sure? (yes/no)"
User: "no"

Agent: Ship operation cancelled by user.

Result:
  - No changes made
  - Feature branch preserved
  - User can continue working or run 'git town sync'
```

## Error Handling

### Common Errors

1. **Not confirmed**:
```
Error: Ship operation cancelled - user must explicitly confirm
Suggestion: Type "yes" to confirm or "no" to cancel
```

2. **Dirty working directory**:
```
Error: Working directory must be clean
Uncommitted changes:
  modified: src/auth.js
  modified: tests/auth.test.js

Suggestion: Commit or stash changes first
  git add .
  git commit -m "Final changes"
  OR
  git stash
```

3. **Branch out of sync**:
```
Error: Local branch is out of sync with remote
Local commits: 3 ahead, 1 behind

Suggestion: Sync with remote first
  git town sync
```

4. **Merge conflicts**:
```
Error: Merge conflicts detected with main
Files with conflicts:
  - src/database.js
  - config/settings.yml

Suggestion: Sync branch and resolve conflicts
  git town sync
  [Resolve conflicts]
  git add .
  git commit
  git town ship
```

5. **PR not approved**:
```
Error: PR #234 not approved
Branch protection requires 1 approval

Suggestion: Wait for PR approval before shipping
  gh pr view 234
```

6. **CI checks failing**:
```
Warning: CI checks failing
  ✗ tests (failed)
  ✓ lint (passed)
  ✓ build (passed)

Suggestion: Fix failing tests before shipping
  npm test
```

7. **Invalid commit message**:
```
Error: Commit message must be 10-500 characters (got 5)
Received: "Fix"

Suggestion: Provide more descriptive message
  "fix: Resolve login redirect after OAuth callback"
  OR omit to use default from PR title
```

## Success Criteria

Ship operation is successful when:

1. Feature branch merged into parent: `git log main --oneline | grep <commit-message>`
2. Local feature branch deleted: `git branch | grep -v <branch-name>`
3. Remote branch deleted (if requested): `git ls-remote --heads origin | grep -v <branch-name>`
4. Working directory on parent branch: `git symbolic-ref --short HEAD` returns "main"
5. Working directory clean: `git status` shows "nothing to commit"
6. Parent branch pushed to remote: `git diff origin/main` shows no differences

## Post-Ship Actions

After successful ship, agents should:

1. Confirm completion:
   ```bash
   git symbolic-ref --short HEAD
   # Output: main

   git log --oneline -1
   # Output: abc1234 feat: Add OAuth2 authentication integration
   ```

2. Verify branch cleanup:
   ```bash
   git branch -a | grep oauth-integration
   # Output: (empty, branch deleted)
   ```

3. Verify PR status:
   ```bash
   gh pr view 234
   # Output: state: MERGED
   ```

4. Inform user of completion:
   - Branch successfully merged
   - Feature branch deleted
   - Working directory on main
   - Ready for next feature

5. Suggest next steps:
   - Pull latest main: `git pull`
   - Start new feature: `git town hack feature/next-task`
   - Check deployment status
   - Update project board

## Advanced Scenarios

### Shipping Without PR

If no PR exists (local-only development):

```bash
git town ship
# Ships without PR, uses commit messages for squash
```

### Shipping with Multiple Commits

Git-town creates intelligent squash message:

```
Commits in branch:
  - Add OAuth2 client configuration
  - Implement Google provider
  - Implement GitHub provider
  - Add integration tests

Squash message (if no custom provided):
  "Add OAuth2 authentication integration"
```

### Shipping Stacked Branches

For stacked branches, ship bottom-up:

```
Branch stack:
  main → feature/backend → feature/frontend

Ship order:
  1. git checkout feature/backend
     git town ship

  2. git checkout feature/frontend
     git town ship

Each ship merges one level at a time.
```

### Aborting Ship in Progress

If ship encounters issues mid-process:

```bash
git town ship --abort
# Rolls back to pre-ship state
# Feature branch preserved
# No changes to main
```

### Continuing Interrupted Ship

If ship interrupted (network issue, conflict):

```bash
# Resolve issue
git town ship --continue
# Resumes ship from where it stopped
```

## Safety Features

Git-town ship includes safety mechanisms:

1. **Confirmation prompts**: Prevents accidental merges
2. **Clean directory check**: Ensures no uncommitted work
3. **Sync before merge**: Updates with latest main
4. **Conflict detection**: Alerts before attempting merge
5. **Rollback support**: Can abort if issues arise

## Configuration

Git-town ship behavior can be configured:

```bash
# Use squash merge (default)
git config git-town.ship-strategy squash

# Use regular merge
git config git-town.ship-strategy merge

# Delete remote branch by default
git config git-town.ship-delete-remote true

# Keep remote branch by default
git config git-town.ship-delete-remote false
```

## Pre-Ship Checklist

Before shipping, verify:

- [ ] All changes committed and pushed
- [ ] PR created and reviewed
- [ ] PR approved (if required)
- [ ] CI checks passing
- [ ] No merge conflicts
- [ ] Documentation updated
- [ ] Tests passing locally
- [ ] CHANGELOG updated (if applicable)
- [ ] Ready to deploy
- [ ] Correct branch selected

## Reference

- Git-town documentation: https://www.git-town.com/commands/ship
- Git-town ship strategy: https://www.git-town.com/preferences/ship-strategy
- Squash merging: https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/incorporating-changes-from-a-pull-request/about-pull-request-merges#squash-and-merge-your-commits
- Branch protection: https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches
