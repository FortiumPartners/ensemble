---
template_type: interview
template_name: branch-creation
version: 1.0.0
git_town_command: hack
fields:
  - name: branch_name
    type: string
    required: true
    validation: regex
    pattern: "^[a-z0-9-]+(/[a-z0-9-]+)*$"
    error_message: "Branch name must contain only lowercase letters, numbers, hyphens, and forward slashes for hierarchy"
    examples:
      - "feature/user-authentication"
      - "fix/login-bug"
      - "refactor/database-layer"
      - "feature/api/rate-limiting"
  - name: base_branch
    type: string
    required: false
    default: "main"
    validation: branch_exists
    error_message: "Base branch must exist in local repository"
    examples:
      - "main"
      - "master"
      - "develop"
      - "staging"
  - name: prototype
    type: boolean
    required: false
    default: false
    description: "Prototype branches are for experimentation and don't sync with remote"
    examples:
      - true
      - false
  - name: stacked
    type: boolean
    required: false
    default: false
    description: "Stacked branches use the current branch as parent instead of main"
    examples:
      - true
      - false
---

# Branch Creation Interview

## Purpose

This interview template guides agents through creating a new git-town feature branch using the `git town hack` command. It ensures proper branch naming conventions, validates base branch existence, and configures prototype or stacked branch workflows when needed.

## Context

Git-town manages feature branches with automatic syncing to main and remote tracking. Understanding the branch type helps configure the correct workflow:

- **Standard branches**: Regular feature/fix branches that sync with main
- **Prototype branches**: Experimental branches that don't sync remotely
- **Stacked branches**: Branches built on top of other feature branches

## Interview Questions

### Question 1: Branch Name (Required)

**Prompt**: "What is the name of the branch you want to create?"

**Guidance**:
- Use lowercase letters, numbers, and hyphens
- Use forward slashes for hierarchical organization
- Common prefixes: `feature/`, `fix/`, `refactor/`, `chore/`, `docs/`
- Be descriptive but concise (e.g., `feature/oauth-integration`)

**Validation**:
```javascript
const branchNamePattern = /^[a-z0-9-]+(?:\/[a-z0-9-]+)*$/;
if (!branchNamePattern.test(branch_name)) {
  throw new Error("Branch name must contain only lowercase letters, numbers, hyphens, and forward slashes");
}
```

**Examples**:
```
Valid:
  - feature/user-authentication
  - fix/login-bug
  - refactor/database-layer
  - feature/api/rate-limiting
  - chore/update-dependencies

Invalid:
  - Feature/Auth (uppercase not allowed)
  - fix_bug (underscores not allowed)
  - feature/spaces not allowed (spaces not allowed)
  - feature/ (trailing slash)
  - /feature (leading slash)
```

### Question 2: Base Branch (Optional)

**Prompt**: "What branch should this be based on? (default: main)"

**Guidance**:
- Usually `main` or `master` for standard workflows
- Use `develop` if following git-flow
- The base branch must exist locally
- Git-town will sync with this branch during `git town sync`

**Validation**:
```bash
# Check if branch exists locally
git rev-parse --verify "${base_branch}" >/dev/null 2>&1
if [ $? -ne 0 ]; then
  echo "Error: Branch '${base_branch}' does not exist locally"
  exit 1
fi
```

**Examples**:
```
Common values:
  - main (default)
  - master
  - develop
  - staging

Use cases:
  - main: Standard feature development
  - develop: Git-flow workflow
  - staging: Hotfix for staging environment
```

### Question 3: Prototype Branch (Optional)

**Prompt**: "Is this a prototype branch? (default: false)"

**Guidance**:
- Prototype branches are for experimentation and proof-of-concepts
- They don't sync with remote (won't be pushed automatically)
- Useful for exploratory work that may be discarded
- Can be converted to regular branch later if needed

**Examples**:
```
Use prototype=true when:
  - Experimenting with new architecture
  - Testing third-party library integration
  - Proof-of-concept work
  - Spike/research tasks

Use prototype=false (default) when:
  - Building a feature for production
  - Fixing a bug
  - Refactoring existing code
```

### Question 4: Stacked Branch (Optional)

**Prompt**: "Is this a stacked branch built on the current branch? (default: false)"

**Guidance**:
- Stacked branches use the current branch as parent instead of main
- Useful for breaking large features into smaller reviewable chunks
- Creates a dependency chain (must merge parent before child)
- Git-town manages the stack automatically

**Examples**:
```
Stacked workflow example:
  1. git town hack feature/auth-backend (stacked=false, base=main)
  2. git town hack feature/auth-frontend (stacked=true, current branch becomes parent)
  3. git town hack feature/auth-tests (stacked=true, builds on frontend)

Dependency chain: main → backend → frontend → tests

Benefits:
  - Smaller, focused PRs
  - Parallel review of related work
  - Incremental merging
```

## Validation Rules

### Pre-Execution Validation

1. **Branch name format**:
   - Pattern: `^[a-z0-9-]+(?:\/[a-z0-9-]+)*$`
   - No uppercase, spaces, underscores, special characters
   - Forward slashes allowed for hierarchy

2. **Base branch existence**:
   - Must exist in local repository
   - Verify with `git rev-parse --verify <branch>`

3. **Current branch state** (for stacked branches):
   - Cannot create stacked branch if on main/master
   - Current branch must be a feature branch

4. **Workspace cleanliness**:
   - Git-town requires clean working directory
   - No uncommitted changes allowed

### Validation Script

```bash
#!/usr/bin/env bash
set -e

# Validate branch name
if ! echo "$BRANCH_NAME" | grep -Eq '^[a-z0-9-]+(/[a-z0-9-]+)*$'; then
  echo "Error: Invalid branch name format"
  exit 1
fi

# Validate base branch exists
if [ -n "$BASE_BRANCH" ] && ! git rev-parse --verify "$BASE_BRANCH" >/dev/null 2>&1; then
  echo "Error: Base branch '$BASE_BRANCH' does not exist"
  exit 2
fi

# Validate clean working directory
if ! git diff-index --quiet HEAD --; then
  echo "Error: Working directory must be clean"
  exit 3
fi

# Validate stacked branch prerequisites
if [ "$STACKED" = "true" ]; then
  current_branch=$(git symbolic-ref --short HEAD)
  if [[ "$current_branch" == "main" || "$current_branch" == "master" ]]; then
    echo "Error: Cannot create stacked branch from main/master"
    exit 4
  fi
fi

echo "Validation passed"
```

## Example Workflows

### Workflow 1: Standard Feature Branch

```
Agent: "What is the name of the branch you want to create?"
User: "feature/oauth-integration"

Agent: "What branch should this be based on? (default: main)"
User: [Enter] (uses default)

Agent: "Is this a prototype branch? (default: false)"
User: [Enter] (uses default)

Agent: "Is this a stacked branch built on the current branch? (default: false)"
User: [Enter] (uses default)

Agent executes:
  git town hack feature/oauth-integration

Result:
  - Creates branch from main
  - Configures as feature branch (syncs with main)
  - Tracks on remote when pushed
```

### Workflow 2: Prototype Branch

```
Agent: "What is the name of the branch you want to create?"
User: "prototype/new-architecture"

Agent: "What branch should this be based on? (default: main)"
User: "develop"

Agent: "Is this a prototype branch? (default: false)"
User: "true"

Agent: "Is this a stacked branch built on the current branch? (default: false)"
User: [Enter] (uses default)

Agent executes:
  git town hack --prototype prototype/new-architecture

Result:
  - Creates branch from develop
  - Configured as prototype (no remote sync)
  - Suitable for experimentation
```

### Workflow 3: Stacked Branch

```
Current branch: feature/auth-backend

Agent: "What is the name of the branch you want to create?"
User: "feature/auth-frontend"

Agent: "What branch should this be based on? (default: main)"
User: [Enter] (uses default, but will use current branch due to stacked=true)

Agent: "Is this a prototype branch? (default: false)"
User: [Enter] (uses default)

Agent: "Is this a stacked branch built on the current branch? (default: false)"
User: "true"

Agent executes:
  git town hack feature/auth-frontend

Result:
  - Creates branch from feature/auth-backend (current branch)
  - Parent branch: feature/auth-backend
  - Must merge parent before shipping child
```

### Workflow 4: Hierarchical Branch Names

```
Agent: "What is the name of the branch you want to create?"
User: "feature/api/rate-limiting"

Agent: "What branch should this be based on? (default: main)"
User: [Enter] (uses default)

Agent: "Is this a prototype branch? (default: false)"
User: [Enter] (uses default)

Agent: "Is this a stacked branch built on the current branch? (default: false)"
User: [Enter] (uses default)

Agent executes:
  git town hack feature/api/rate-limiting

Result:
  - Hierarchical organization: feature > api > rate-limiting
  - Easier filtering: git branch | grep feature/api
  - Clear categorization in PR lists
```

## Error Handling

### Common Errors

1. **Invalid branch name**:
```
Error: Branch name must contain only lowercase letters, numbers, hyphens, and forward slashes
Received: "Feature/Auth"
Expected format: "feature/auth"
```

2. **Base branch doesn't exist**:
```
Error: Base branch 'develop' does not exist locally
Suggestion: Run 'git branch -a' to see available branches
Or: Run 'git fetch' to update remote branches
```

3. **Dirty working directory**:
```
Error: Working directory must be clean before creating branch
Suggestion: Commit or stash your changes first
  git add .
  git commit -m "Your changes"
  OR
  git stash
```

4. **Stacked branch from main**:
```
Error: Cannot create stacked branch from main/master
Current branch: main
Suggestion: First create a feature branch, then create stacked branches from it
```

## Success Criteria

Branch creation is successful when:

1. New branch exists: `git rev-parse --verify <branch_name>`
2. Branch is on correct base: `git merge-base <branch_name> <base_branch>`
3. Git-town configuration updated: `git config --get git-town.feature-branch-type.<branch_name>`
4. Working directory is on new branch: `git symbolic-ref --short HEAD`

## Post-Creation Actions

After successful branch creation, agents should:

1. Confirm branch creation:
   ```bash
   git symbolic-ref --short HEAD
   # Output: feature/oauth-integration
   ```

2. Verify git-town configuration:
   ```bash
   git town config
   # Should show new branch in feature branches list
   ```

3. Inform user of next steps:
   - Make changes and commit
   - Use `git town sync` to keep in sync with main
   - Use `git town propose` to create PR
   - Use `git town ship` to merge when complete

## Reference

- Git-town documentation: https://www.git-town.com/commands/hack
- Command format: `git town hack [--prototype] <branch_name>`
- Config location: `.git/config` (git-town.feature-branches)
