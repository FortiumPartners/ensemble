# Git-Town Reference Documentation

> Quick reference for git-town commands, exit codes, and agent integration patterns

## Table of Contents

1. [Exit Codes](#exit-codes)
2. [Core Commands](#core-commands)
3. [Command-Specific Exit Codes](#command-specific-exit-codes)
4. [Agent Handling Logic](#agent-handling-logic)
5. [Error Detection Patterns](#error-detection-patterns)

---

## Exit Codes

Git-town uses standardized exit codes to communicate command results. Agents must handle these codes appropriately to ensure proper workflow execution.

### Standard Exit Codes

| Exit Code | Constant | Meaning | Agent Action |
|-----------|----------|---------|--------------|
| 0 | `EXIT_SUCCESS` | Command completed successfully | Continue workflow |
| 1 | `EXIT_NOT_FOUND` | git-town not installed or not in PATH | Install git-town, halt workflow |
| 2 | `EXIT_NOT_CONFIGURED` | git-town not configured for repository | Run `git town config setup`, halt workflow |
| 3 | `EXIT_OLD_VERSION` | git-town version < 14.0.0 | Upgrade git-town, halt workflow |
| 4 | `EXIT_NOT_GIT_REPO` | Not in a git repository | Navigate to git repo, halt workflow |
| 5 | `EXIT_MERGE_CONFLICT` | Merge conflict occurred | Resolve conflicts, continue or abort |
| 6 | `EXIT_UNCOMMITTED_CHANGES` | Uncommitted changes prevent operation | Commit or stash changes, retry |
| 7 | `EXIT_REMOTE_ERROR` | Remote operation failed (network, auth) | Check connectivity/credentials, retry |
| 8 | `EXIT_BRANCH_NOT_FOUND` | Specified branch does not exist | Verify branch name, halt workflow |
| 9 | `EXIT_INVALID_CONFIG` | Invalid git-town configuration | Fix configuration, retry |
| 10 | `EXIT_USER_ABORT` | User aborted operation | Acknowledge abort, halt workflow |

### Validation Script Exit Codes

The `validate-git-town.sh` script uses a subset of standard exit codes:

```bash
# Exit code constants
EXIT_SUCCESS=0           # All checks passed
EXIT_NOT_FOUND=1         # git-town not installed
EXIT_NOT_CONFIGURED=2    # git-town not configured
EXIT_OLD_VERSION=3       # git-town version too old
EXIT_NOT_GIT_REPO=4      # Not a git repository
```

**Usage Example:**

```bash
#!/usr/bin/env bash
source ./validate-git-town.sh

validate_git_town
EXIT_CODE=$?

case $EXIT_CODE in
    0)
        echo "Validation passed, proceeding with git-town operations"
        ;;
    1)
        echo "ERROR: git-town not installed. Install via: brew install git-town"
        exit 1
        ;;
    2)
        echo "WARNING: git-town not configured. Run: git town config setup"
        exit 2
        ;;
    3)
        echo "ERROR: git-town version too old. Upgrade via: brew upgrade git-town"
        exit 3
        ;;
    4)
        echo "ERROR: Not in a git repository"
        exit 4
        ;;
esac
```

---

## Core Commands

Git-town provides four primary commands that form the foundation of the development workflow. Each command has specific usage patterns, success scenarios, and error cases that agents must handle.

### `git town hack`

**Purpose**: Create a new feature branch from the main branch and sync with remote.

**Syntax**:
```bash
git town hack <branch-name> [--parent <parent-branch>]
```

**Options**:
- `<branch-name>`: Name for the new feature branch (required)
- `--parent <parent-branch>`: Specify parent branch (default: main branch)

**Workflow**:
1. Creates new branch from parent (default: main)
2. Pushes branch to remote origin
3. Sets up tracking relationship
4. Switches to the new branch

**Success Example**:
```bash
$ git town hack feature/user-authentication
✓ Creating feature branch 'feature/user-authentication'
✓ Pushing branch to origin
✓ Setting up tracking
✓ Switched to branch 'feature/user-authentication'
```

**Error Example 1: Uncommitted Changes**
```bash
$ git town hack feature/payment-gateway
✗ Error: You have uncommitted changes
  Please commit or stash your changes before creating a new branch

Exit Code: 6
Agent Action: Stash changes with git stash push -m "WIP", retry command
```

**Error Example 2: Branch Already Exists**
```bash
$ git town hack feature/user-authentication
✗ Error: Branch 'feature/user-authentication' already exists
  Use 'git checkout feature/user-authentication' to switch to it

Exit Code: 8
Agent Action: Switch to existing branch instead of creating new one
```

**Agent Implementation Pattern**:
```bash
# Attempt to create feature branch
git town hack feature/new-feature
EXIT_CODE=$?

case $EXIT_CODE in
    0)
        echo "✓ Feature branch created successfully"
        ;;
    6)
        echo "⚠ Uncommitted changes detected. Stashing..."
        git stash push -m "WIP before creating feature branch"
        git town hack feature/new-feature
        ;;
    8)
        echo "⚠ Branch already exists. Switching to it..."
        git checkout feature/new-feature
        ;;
    *)
        echo "✗ Failed to create feature branch (exit code: $EXIT_CODE)"
        exit $EXIT_CODE
        ;;
esac
```

---

### `git town sync`

**Purpose**: Synchronize current branch with its parent branch and remote repository.

**Syntax**:
```bash
git town sync [--all] [--stack]
```

**Options**:
- `--all`: Sync all feature branches (not just current)
- `--stack`: Sync entire branch stack (current + parent branches)

**Workflow**:
1. Fetches updates from remote
2. Rebases current branch onto parent
3. Pushes changes to remote
4. Updates tracking information

**Success Example**:
```bash
$ git town sync
✓ Fetching updates from origin
✓ Rebasing feature/user-auth onto main
✓ Pushing to origin/feature/user-auth
✓ Branch synchronized successfully
```

**Error Example 1: Merge Conflict**
```bash
$ git town sync
✓ Fetching updates from origin
✗ Error: Merge conflict in src/auth/login.ts

  Conflicting files:
  - src/auth/login.ts
  - src/auth/logout.ts

  Please resolve conflicts and run:
    git town continue  (to continue sync)
    git town abort     (to abort sync)

Exit Code: 5
Agent Action: Delegate to deep-debugger for conflict resolution
```

**Error Example 2: Network Failure**
```bash
$ git town sync
✓ Fetching updates from origin
✗ Error: Failed to fetch from remote
  fatal: unable to access 'https://github.com/user/repo.git/':
  Could not resolve host: github.com

Exit Code: 7
Agent Action: Retry with exponential backoff (3 attempts)
```

**Agent Implementation Pattern**:
```bash
# Sync current branch with parent
git town sync
EXIT_CODE=$?

case $EXIT_CODE in
    0)
        echo "✓ Branch synchronized successfully"
        ;;
    5)
        echo "✗ Merge conflict detected during sync"
        echo "Conflicting files:"
        git diff --name-only --diff-filter=U

        # Delegate to specialized conflict resolution agent
        Task(subagent_type="deep-debugger",
             prompt="Resolve merge conflicts in: $(git diff --name-only --diff-filter=U | tr '\n' ' ')")
        ;;
    6)
        echo "⚠ Uncommitted changes. Creating checkpoint commit..."
        git add -A
        git commit -m "chore: checkpoint before sync"
        git town sync
        ;;
    7)
        echo "⚠ Remote operation failed. Retrying..."
        retry_with_backoff "git town sync" 3
        ;;
    *)
        echo "✗ Sync failed (exit code: $EXIT_CODE)"
        exit $EXIT_CODE
        ;;
esac
```

---

### `git town propose`

**Purpose**: Create a pull request for the current feature branch.

**Syntax**:
```bash
git town propose [--title "PR title"] [--body "PR description"] [--draft]
```

**Options**:
- `--title "..."`: Custom PR title (default: branch name)
- `--body "..."`: Custom PR description (default: commit messages)
- `--draft`: Create as draft PR

**Workflow**:
1. Pushes current branch to remote
2. Opens GitHub/GitLab to create PR
3. Pre-fills PR title and description
4. Returns PR URL

**Success Example**:
```bash
$ git town propose --title "Add user authentication" --draft
✓ Pushing branch to origin
✓ Creating pull request
✓ PR created: https://github.com/user/repo/pull/42

  Pull Request #42: Add user authentication
  Status: Draft
  Base: main ← feature/user-authentication
```

**Error Example 1: No Commits to Propose**
```bash
$ git town propose
✗ Error: No commits to propose
  Your branch is up to date with 'origin/feature/user-auth'
  and has no commits ahead of 'main'

Exit Code: 6
Agent Action: Verify commits exist, inform user, halt workflow
```

**Error Example 2: Authentication Failure**
```bash
$ git town propose
✓ Pushing branch to origin
✗ Error: Failed to create pull request
  fatal: Authentication failed for 'https://github.com/user/repo.git/'

  Please verify your credentials:
  - GitHub token: gh auth login
  - SSH keys: ssh -T git@github.com

Exit Code: 7
Agent Action: Escalate to user for credential refresh
```

**Agent Implementation Pattern**:
```bash
# Create pull request for current feature branch
git town propose --title "$PR_TITLE" --draft
EXIT_CODE=$?

case $EXIT_CODE in
    0)
        # Extract PR URL from output
        PR_URL=$(git town propose --title "$PR_TITLE" --draft 2>&1 | grep -oP 'https://[^\s]+')
        echo "✓ Pull request created: $PR_URL"

        # Report to user
        echo "PR #$(basename $PR_URL) is ready for review"
        ;;
    6)
        echo "⚠ No commits to propose"
        echo "Current branch status:"
        git log --oneline main..HEAD

        if [ -z "$(git log --oneline main..HEAD)" ]; then
            echo "✗ No commits ahead of main. Nothing to propose."
            exit 6
        else
            echo "⚠ Committing staged changes..."
            git add -A
            git commit -m "feat: final changes for PR"
            git town propose --title "$PR_TITLE" --draft
        fi
        ;;
    7)
        echo "✗ Authentication failed"
        echo "Please verify GitHub credentials:"
        echo "  gh auth status"
        echo "  gh auth login"
        exit 7
        ;;
    *)
        echo "✗ Failed to create PR (exit code: $EXIT_CODE)"
        exit $EXIT_CODE
        ;;
esac
```

---

### `git town ship`

**Purpose**: Merge feature branch into parent branch and delete the feature branch.

**Syntax**:
```bash
git town ship [--message "commit message"]
```

**Options**:
- `--message "..."`: Custom merge commit message (default: PR title)

**Workflow**:
1. Syncs feature branch with parent
2. Merges feature branch into parent
3. Pushes parent branch to remote
4. Deletes feature branch (local and remote)
5. Switches to parent branch

**Success Example**:
```bash
$ git town ship --message "Add user authentication feature"
✓ Syncing feature/user-auth with main
✓ Merging feature/user-auth into main
✓ Pushing main to origin
✓ Deleting feature/user-auth (local and remote)
✓ Switched to branch 'main'

Feature branch shipped successfully!
```

**Error Example 1: PR Not Approved**
```bash
$ git town ship
✗ Error: Pull request #42 is not approved
  Required approvals: 2
  Current approvals: 1

  Please wait for PR approval before shipping

Exit Code: 9
Agent Action: Wait for approvals, retry after notification
```

**Error Example 2: Merge Conflict on Parent Branch**
```bash
$ git town ship
✓ Syncing feature/user-auth with main
✗ Error: Merge conflict when merging into main

  Conflicting files:
  - src/auth/config.ts
  - package.json

  Please resolve conflicts and run:
    git town continue  (to continue ship)
    git town abort     (to abort ship)

Exit Code: 5
Agent Action: Delegate to deep-debugger for conflict resolution
```

**Agent Implementation Pattern**:
```bash
# Ship feature branch to main
git town ship --message "$MERGE_MESSAGE"
EXIT_CODE=$?

case $EXIT_CODE in
    0)
        echo "✓ Feature branch shipped successfully"
        echo "Current branch: $(git branch --show-current)"

        # Report completion
        echo "Changes merged to main and feature branch deleted"
        ;;
    5)
        echo "✗ Merge conflict detected during ship"
        echo "Conflicting files:"
        git diff --name-only --diff-filter=U

        # Delegate to conflict resolution
        Task(subagent_type="deep-debugger",
             prompt="Resolve merge conflicts during ship operation: $(git diff --name-only --diff-filter=U | tr '\n' ' ')")

        # After resolution, continue ship
        echo "Continuing ship after conflict resolution..."
        git town continue
        ;;
    7)
        echo "⚠ Remote operation failed. Retrying..."
        retry_with_backoff "git town ship --message '$MERGE_MESSAGE'" 3
        ;;
    9)
        echo "✗ PR not ready to ship"
        echo "Checking PR status..."
        gh pr view --json state,reviews

        echo "Waiting for PR approval..."
        exit 9
        ;;
    10)
        echo "⚠ Ship operation aborted by user"
        echo "Feature branch preserved"
        ;;
    *)
        echo "✗ Ship failed (exit code: $EXIT_CODE)"
        exit $EXIT_CODE
        ;;
esac
```

---

## Command-Specific Exit Codes

Different git-town commands may return specific exit codes based on their context.

### `git town hack <branch-name>`

Creates a new feature branch and syncs with remote.

| Exit Code | Scenario | Agent Response |
|-----------|----------|----------------|
| 0 | Branch created and synced successfully | Continue development workflow |
| 6 | Uncommitted changes detected | Stash changes: `git stash push -m "WIP before hack"`, retry |
| 7 | Remote sync failed | Check network/auth, retry or work offline |
| 8 | Branch already exists locally | Switch to existing branch: `git checkout <branch>` |

**Example Agent Logic:**

```bash
git town hack feature/new-feature
EXIT_CODE=$?

if [ $EXIT_CODE -eq 6 ]; then
    echo "Stashing uncommitted changes..."
    git stash push -m "WIP before hack"
    git town hack feature/new-feature
elif [ $EXIT_CODE -eq 8 ]; then
    echo "Branch exists, switching instead..."
    git checkout feature/new-feature
fi
```

### `git town sync`

Syncs current branch with parent and remote.

| Exit Code | Scenario | Agent Response |
|-----------|----------|----------------|
| 0 | Sync completed successfully | Continue workflow |
| 5 | Merge conflict during sync | Delegate to `deep-debugger` for conflict resolution |
| 6 | Uncommitted changes block sync | Commit changes or stash, retry |
| 7 | Remote fetch/push failed | Check connectivity, retry with exponential backoff |

**Example Agent Logic:**

```bash
git town sync
EXIT_CODE=$?

case $EXIT_CODE in
    5)
        echo "Merge conflict detected. Resolving..."
        # Agent delegates to conflict resolution workflow
        Task(subagent_type="deep-debugger", prompt="Resolve merge conflicts in current branch")
        ;;
    6)
        echo "Uncommitted changes detected. Creating checkpoint commit..."
        git add -A
        git commit -m "chore: checkpoint before sync"
        git town sync
        ;;
    7)
        echo "Remote operation failed. Retrying in 5 seconds..."
        sleep 5
        git town sync
        ;;
esac
```

### `git town propose`

Creates a pull request for the current feature branch.

| Exit Code | Scenario | Agent Response |
|-----------|----------|----------------|
| 0 | PR created successfully | Report PR URL to user |
| 6 | Uncommitted changes detected | Commit changes, push, retry |
| 7 | Remote push failed | Check auth/network, retry |
| 9 | Missing PR template or invalid config | Fix configuration, retry |

**Example Agent Logic:**

```bash
git town propose
EXIT_CODE=$?

if [ $EXIT_CODE -eq 0 ]; then
    PR_URL=$(gh pr view --json url -q .url)
    echo "Pull request created: $PR_URL"
elif [ $EXIT_CODE -eq 6 ]; then
    echo "Committing changes before propose..."
    git add -A
    git commit -m "feat: final changes for PR"
    git push
    git town propose
fi
```

### `git town ship`

Merges feature branch to parent and deletes feature branch.

| Exit Code | Scenario | Agent Response |
|-----------|----------|----------------|
| 0 | Branch shipped successfully | Report success, continue to next task |
| 5 | Merge conflict on parent branch | Resolve conflicts, retry ship |
| 7 | Remote operations failed | Check connectivity, retry |
| 10 | User aborted ship | Acknowledge abort, preserve feature branch |

**Example Agent Logic:**

```bash
git town ship
EXIT_CODE=$?

case $EXIT_CODE in
    0)
        echo "Feature branch shipped successfully"
        ;;
    5)
        echo "Merge conflict on parent branch. Manual resolution required."
        git town ship --abort
        Task(subagent_type="deep-debugger", prompt="Resolve merge conflicts during ship")
        ;;
    10)
        echo "Ship operation aborted by user"
        ;;
esac
```

---

## Agent Handling Logic

### Decision Tree for Exit Code Handling

```
git-town command execution
│
├─ Exit Code 0 → ✓ Success
│                 └─ Continue workflow
│
├─ Exit Code 1 → ✗ Not Installed
│                 └─ Install git-town
│                     └─ Platform detection
│                         ├─ macOS: brew install git-town
│                         ├─ Linux: See https://www.git-town.com/install
│                         └─ Windows: scoop install git-town
│
├─ Exit Code 2 → ⚠ Not Configured
│                 └─ Run: git town config setup
│                     └─ Retry original command
│
├─ Exit Code 3 → ✗ Old Version
│                 └─ Upgrade git-town
│                     └─ Platform detection
│                         ├─ macOS: brew upgrade git-town
│                         ├─ Linux: See https://www.git-town.com/install
│                         └─ Windows: scoop update git-town
│
├─ Exit Code 4 → ✗ Not Git Repo
│                 └─ Navigate to git repository
│                     └─ Halt workflow
│
├─ Exit Code 5 → ⚠ Merge Conflict
│                 └─ Delegate to deep-debugger
│                     └─ Options:
│                         ├─ Resolve conflicts manually
│                         ├─ Continue: git town continue
│                         └─ Abort: git town abort
│
├─ Exit Code 6 → ⚠ Uncommitted Changes
│                 └─ Options:
│                     ├─ Commit: git add -A && git commit
│                     ├─ Stash: git stash push -m "WIP"
│                     └─ Retry original command
│
├─ Exit Code 7 → ⚠ Remote Error
│                 └─ Diagnose:
│                     ├─ Network: Check connectivity
│                     ├─ Auth: Verify credentials
│                     └─ Retry with exponential backoff
│
├─ Exit Code 8 → ✗ Branch Not Found
│                 └─ Verify branch name
│                     └─ Suggest alternatives: git branch -a
│
├─ Exit Code 9 → ✗ Invalid Config
│                 └─ Run: git town config setup
│                     └─ Fix configuration issues
│
└─ Exit Code 10 → ⚠ User Abort
                  └─ Acknowledge abort
                      └─ Preserve current state
```

### Recommended Agent Response Patterns

#### Pattern 1: Retry with Exponential Backoff (Exit Code 7)

```bash
retry_with_backoff() {
    local command="$1"
    local max_attempts=3
    local attempt=1
    local wait_time=2

    while [ $attempt -le $max_attempts ]; do
        echo "Attempt $attempt/$max_attempts: $command"

        eval "$command"
        local exit_code=$?

        if [ $exit_code -eq 0 ]; then
            return 0
        elif [ $exit_code -eq 7 ]; then
            if [ $attempt -lt $max_attempts ]; then
                echo "Remote error. Retrying in ${wait_time}s..."
                sleep $wait_time
                wait_time=$((wait_time * 2))
            fi
        else
            return $exit_code
        fi

        attempt=$((attempt + 1))
    done

    return 7
}

# Usage
retry_with_backoff "git town sync"
```

#### Pattern 2: Automatic Stash/Unstash (Exit Code 6)

```bash
safe_git_town_operation() {
    local command="$1"
    local stashed=false

    eval "$command"
    local exit_code=$?

    if [ $exit_code -eq 6 ]; then
        echo "Stashing uncommitted changes..."
        git stash push -m "Auto-stash before git-town operation"
        stashed=true

        eval "$command"
        exit_code=$?

        if [ $stashed = true ]; then
            echo "Restoring stashed changes..."
            git stash pop
        fi
    fi

    return $exit_code
}

# Usage
safe_git_town_operation "git town sync"
```

#### Pattern 3: Conflict Resolution Delegation (Exit Code 5)

```bash
handle_merge_conflict() {
    local command="$1"

    eval "$command"
    local exit_code=$?

    if [ $exit_code -eq 5 ]; then
        echo "Merge conflict detected during: $command"

        # Show conflict files
        git diff --name-only --diff-filter=U

        # Delegate to specialized agent
        echo "Delegating conflict resolution to deep-debugger..."
        # Agent uses Task tool here

        # After resolution, continue
        git town continue
    fi

    return $exit_code
}

# Usage
handle_merge_conflict "git town sync"
```

---

## Error Detection Patterns

### Parsing Git-Town Output

Git-town provides structured error messages that agents can parse for better error handling.

#### Common Error Patterns

| Error Pattern | Regex | Exit Code | Meaning |
|---------------|-------|-----------|---------|
| Not installed | `git-town.*not found\|command not found` | 1 | git-town not in PATH |
| Not configured | `not configured\|run.*git town config` | 2 | Missing configuration |
| Version error | `version.*too old\|upgrade.*git-town` | 3 | Outdated version |
| Merge conflict | `CONFLICT\|merge conflict` | 5 | Merge conflict occurred |
| Uncommitted | `uncommitted changes\|working tree.*not clean` | 6 | Dirty working tree |
| Remote error | `remote.*failed\|network.*error\|authentication failed` | 7 | Remote operation failed |
| Branch error | `branch.*not found\|does not exist` | 8 | Invalid branch reference |

#### Error Detection Script

```bash
#!/usr/bin/env bash
# detect-git-town-error.sh
# Parses git-town output to determine error type

detect_error_type() {
    local output="$1"
    local exit_code="$2"

    # First, check exit code
    if [ "$exit_code" -ne 0 ]; then
        # Parse output for specific error patterns
        if echo "$output" | grep -qE "git-town.*not found|command not found"; then
            echo "ERROR_NOT_INSTALLED"
            return 1
        elif echo "$output" | grep -qE "not configured|run.*git town config"; then
            echo "ERROR_NOT_CONFIGURED"
            return 2
        elif echo "$output" | grep -qE "version.*too old|upgrade.*git-town"; then
            echo "ERROR_OLD_VERSION"
            return 3
        elif echo "$output" | grep -qE "CONFLICT|merge conflict"; then
            echo "ERROR_MERGE_CONFLICT"
            return 5
        elif echo "$output" | grep -qE "uncommitted changes|working tree.*not clean"; then
            echo "ERROR_UNCOMMITTED"
            return 6
        elif echo "$output" | grep -qE "remote.*failed|network.*error|authentication failed"; then
            echo "ERROR_REMOTE"
            return 7
        elif echo "$output" | grep -qE "branch.*not found|does not exist"; then
            echo "ERROR_BRANCH_NOT_FOUND"
            return 8
        else
            echo "ERROR_UNKNOWN"
            return "$exit_code"
        fi
    else
        echo "SUCCESS"
        return 0
    fi
}

# Usage example
OUTPUT=$(git town sync 2>&1)
EXIT_CODE=$?

ERROR_TYPE=$(detect_error_type "$OUTPUT" "$EXIT_CODE")
echo "Error type: $ERROR_TYPE"
```

### Agent Integration Example

```bash
#!/usr/bin/env bash
# agent-git-town-wrapper.sh
# Wrapper for git-town commands with intelligent error handling

source ./validate-git-town.sh
source ./detect-git-town-error.sh

execute_git_town_command() {
    local command="$1"

    # Step 1: Validate git-town environment
    validate_git_town
    local validation_code=$?

    if [ $validation_code -ne 0 ]; then
        echo "Validation failed with code: $validation_code"
        return $validation_code
    fi

    # Step 2: Execute command
    OUTPUT=$(eval "$command" 2>&1)
    EXIT_CODE=$?

    # Step 3: Detect error type
    ERROR_TYPE=$(detect_error_type "$OUTPUT" "$EXIT_CODE")

    # Step 4: Handle based on error type
    case $ERROR_TYPE in
        SUCCESS)
            echo "✓ Command succeeded: $command"
            echo "$OUTPUT"
            return 0
            ;;
        ERROR_UNCOMMITTED)
            echo "⚠ Uncommitted changes detected. Auto-stashing..."
            git stash push -m "Auto-stash before $command"
            eval "$command"
            git stash pop
            ;;
        ERROR_MERGE_CONFLICT)
            echo "✗ Merge conflict detected. Manual intervention required."
            echo "Conflicts in:"
            git diff --name-only --diff-filter=U
            return 5
            ;;
        ERROR_REMOTE)
            echo "⚠ Remote error. Retrying in 5 seconds..."
            sleep 5
            eval "$command"
            ;;
        *)
            echo "✗ Command failed: $command"
            echo "$OUTPUT"
            return $EXIT_CODE
            ;;
    esac
}

# Usage
execute_git_town_command "git town hack feature/new-feature"
execute_git_town_command "git town sync"
execute_git_town_command "git town propose"
```

---

## Additional Resources

- **Git-Town Documentation**: https://www.git-town.com/
- **Git-Town Configuration Guide**: https://www.git-town.com/configuration
- **Git-Town Command Reference**: https://www.git-town.com/commands
- **Troubleshooting**: https://www.git-town.com/troubleshooting

---

*Last updated: 2025-12-29*
*Version: 1.0.0*
