---
template_type: interview
template_name: stack-creation
version: 1.0.0
jj_command: new
fields:
  - name: stack_description
    type: string
    required: true
    validation: length
    min_length: 5
    max_length: 200
    error_message: "Stack description must be between 5 and 200 characters"
    examples:
      - "Auth system refactor with OAuth and tests"
      - "Payment gateway integration"
      - "API rate limiting with middleware"
  - name: change_descriptions
    type: array
    required: true
    min_items: 2
    max_items: 10
    item_validation: length
    item_min_length: 10
    item_max_length: 100
    error_message: "Each change description must be 10-100 characters. Stack needs 2-10 changes."
    examples:
      - ["refactor: extract auth service", "feat: add OAuth provider support", "test: add auth integration tests"]
      - ["feat: add rate limit middleware", "feat: add rate limit configuration"]
  - name: base_revision
    type: string
    required: false
    default: "main"
    validation: revset
    error_message: "Base revision must be a valid jj revset expression"
    examples:
      - "main"
      - "trunk()"
      - "bookmark-name"
  - name: bookmark_prefix
    type: string
    required: false
    default: "stack"
    validation: regex
    pattern: "^[a-z0-9-]+$"
    error_message: "Bookmark prefix must contain only lowercase letters, numbers, and hyphens"
    examples:
      - "stack"
      - "auth"
      - "feature"
  - name: use_jst
    type: boolean
    required: false
    default: false
    description: "Use jj-stack (jst) for automated PR management if available"
    examples:
      - true
      - false
---

# Stack Creation Interview

## Purpose

This interview template guides agents through creating a new stack of jj changes for stacked PR workflows. It gathers information about the stack structure, change descriptions, and bookmark naming conventions before executing any jj commands.

## Context

A jj stack is a series of dependent changes built on top of each other. Each change in the stack becomes a separate PR targeting the previous change's branch. This enables incremental code review where each PR is small and focused.

Key concepts:
- **Stack**: A linear chain of dependent changes (change 1 -> change 2 -> change 3)
- **Bookmarks**: Named references to changes, mapped to git branches for PR creation
- **Change IDs**: Stable identifiers for each change that survive rebasing
- **Base revision**: Where the stack starts (usually `main` or `trunk()`)

## Interview Questions

### Question 1: Stack Description (Required)

**Prompt**: "Describe the overall goal of this stack of changes."

**Guidance**:
- Provide a high-level summary of what the stack accomplishes
- This is used for naming bookmarks and organizing work
- Keep it concise but descriptive

**Examples**:
```
Good descriptions:
  - "Auth system refactor with OAuth and tests"
  - "Payment gateway integration with Stripe"
  - "API rate limiting middleware and configuration"

Poor descriptions:
  - "Changes" (too vague)
  - "Fix" (not descriptive enough)
```

### Question 2: Change Descriptions (Required)

**Prompt**: "List the changes in this stack, in order from bottom to top. Each change should have a conventional commit-style description."

**Guidance**:
- List changes in dependency order (first = bottom of stack, last = top)
- Use conventional commit prefixes: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`
- Each change should be a reviewable unit of work
- Aim for 2-5 changes per stack (max 10)

**Validation**:
```bash
# Validate change count
CHANGE_COUNT=${#CHANGE_DESCRIPTIONS[@]}
if [ "$CHANGE_COUNT" -lt 2 ] || [ "$CHANGE_COUNT" -gt 10 ]; then
    echo "Error: Stack must have 2-10 changes (got $CHANGE_COUNT)"
    exit 1
fi
```

**Examples**:
```
Good stack (3 changes):
  1. "refactor: extract auth service from monolith"
  2. "feat: add Google and GitHub OAuth providers"
  3. "test: add comprehensive auth integration tests"

Good stack (2 changes):
  1. "feat: add rate limit middleware with token bucket"
  2. "feat: add rate limit configuration and dashboard"
```

### Question 3: Base Revision (Optional)

**Prompt**: "What revision should this stack be based on? (default: main)"

**Guidance**:
- Usually `main` for new feature stacks
- Can be any valid jj revset expression
- Use a specific change ID if building on top of another stack

**Examples**:
```
Common values:
  - main (default, most common)
  - trunk() (jj's equivalent of main)
  - develop (if using git-flow)
  - <change-id> (build on existing stack)
```

### Question 4: Bookmark Prefix (Optional)

**Prompt**: "What prefix should be used for stack bookmarks? (default: stack)"

**Guidance**:
- Bookmarks follow the pattern: `{prefix}-{N}-{slug}`
- Example with prefix "auth": `auth-1-extract-service`, `auth-2-add-oauth`
- Use a descriptive prefix related to the feature area
- Keep it short (3-15 characters)

**Examples**:
```
Good prefixes:
  - stack (generic, default)
  - auth (for authentication changes)
  - payment (for payment changes)
  - api (for API changes)

Resulting bookmarks:
  auth-1-extract-service
  auth-2-add-oauth
  auth-3-add-tests
```

### Question 5: Use jj-stack (Optional)

**Prompt**: "Use jj-stack (jst) for automated PR management? (default: false)"

**Guidance**:
- jst automates bookmark creation, pushing, and PR management
- Only available if jst is installed (`cargo install jj-stack`)
- Recommended for stacks of 3+ changes
- Falls back to manual workflow if not installed

## Validation Rules

### Pre-Execution Validation

1. **jj repository exists**: Must be in a colocated jj/git repo
2. **Base revision valid**: Base revision must be resolvable by jj
3. **No conflicted changes**: Stack creation should start from clean state
4. **Bookmark prefix available**: No existing bookmarks with same prefix-N pattern

### Validation Script

```bash
#!/usr/bin/env bash
set -e

# Validate jj repo
if ! jj root > /dev/null 2>&1; then
    echo "Error: Not in a jj repository"
    echo "Run: jj git init --colocate"
    exit 1
fi

# Validate base revision
if ! jj log -r "$BASE_REVISION" --limit 1 > /dev/null 2>&1; then
    echo "Error: Invalid base revision: $BASE_REVISION"
    exit 2
fi

# Check for conflicts in current state
if jj log -r "@ & conflicts()" -T 'change_id' --no-graph | grep -q .; then
    echo "Error: Current change has conflicts. Resolve before creating stack."
    exit 3
fi

# Check for existing bookmarks with same prefix
EXISTING=$(jj bookmark list "glob:${BOOKMARK_PREFIX}-*" 2>/dev/null | wc -l)
if [ "$EXISTING" -gt 0 ]; then
    echo "Warning: Found $EXISTING existing bookmarks with prefix '${BOOKMARK_PREFIX}'"
    echo "Existing bookmarks will be preserved. New stack bookmarks may conflict."
fi

echo "Validation passed"
```

## Example Workflows

### Workflow 1: Standard Feature Stack

```
Agent: "Describe the overall goal of this stack of changes."
User: "Implement user authentication with OAuth"

Agent: "List the changes in this stack, in order from bottom to top."
User:
  1. "refactor: extract auth service from user controller"
  2. "feat: add Google OAuth provider integration"
  3. "feat: add GitHub OAuth provider integration"
  4. "test: add auth service unit and integration tests"

Agent: "What revision should this stack be based on? (default: main)"
User: [Enter] (uses default)

Agent: "What prefix should be used for stack bookmarks? (default: stack)"
User: "auth"

Agent: "Use jj-stack (jst) for automated PR management? (default: false)"
User: [Enter] (uses default)

Agent executes:
  jj new main -m "refactor: extract auth service from user controller"
  # ... (waits for user changes or makes changes) ...
  jj new -m "feat: add Google OAuth provider integration"
  # ...
  jj new -m "feat: add GitHub OAuth provider integration"
  # ...
  jj new -m "test: add auth service unit and integration tests"
  # ...

  # Assign bookmarks
  jj bookmark create auth-1-extract-auth-service -r <change-1>
  jj bookmark create auth-2-google-oauth -r <change-2>
  jj bookmark create auth-3-github-oauth -r <change-3>
  jj bookmark create auth-4-auth-tests -r <change-4>

  # Push
  jj git push -b "glob:auth-*" --allow-new

  # Configure git-town parent relationships
  git town config set-parent auth-1-extract-auth-service main
  git town config set-parent auth-2-google-oauth auth-1-extract-auth-service
  git town config set-parent auth-3-github-oauth auth-2-google-oauth
  git town config set-parent auth-4-auth-tests auth-3-github-oauth

  # Create PRs with git-town (auto-targets configured parent)
  git checkout auth-1-extract-auth-service
  git-town propose --title "refactor: extract auth service from user controller"
  git checkout auth-2-google-oauth
  git-town propose --title "feat: add Google OAuth provider"
  git checkout auth-3-github-oauth
  git-town propose --title "feat: add GitHub OAuth provider"
  git checkout auth-4-auth-tests
  git-town propose --title "test: add auth integration tests"

  # Return to jj context
  jj new

Result:
  - 4 changes created in linear stack
  - 4 bookmarks assigned and pushed
  - git-town parent chain configured
  - 4 PRs created targeting correct parent branches
  - Ready for incremental review
```

### Workflow 2: Quick Stack with jst

```
Agent: "Describe the overall goal of this stack of changes."
User: "Add API rate limiting"

Agent: "List the changes in this stack, in order from bottom to top."
User:
  1. "feat: add rate limit middleware"
  2. "feat: add rate limit configuration"

Agent: "Use jj-stack (jst) for automated PR management? (default: false)"
User: "true"

Agent executes:
  jj new main -m "feat: add rate limit middleware"
  # ... make changes ...
  jj new -m "feat: add rate limit configuration"
  # ... make changes ...
  jst submit

Result:
  - 2 changes created
  - jst automatically creates bookmarks, pushes, and creates PRs
```

## Error Handling

### Common Errors

1. **Not a jj repository**:
```
Error: Not in a jj repository
Suggestion: Run 'jj git init --colocate' to initialize jj on this git repo
```

2. **Invalid base revision**:
```
Error: Invalid base revision: 'nonexistent-branch'
Suggestion: Use 'jj log' to find valid revisions, or use 'main' as default
```

3. **Conflicts in current state**:
```
Error: Current change has conflicts. Resolve before creating stack.
Suggestion: Run 'jj resolve' to fix conflicts, or 'jj undo' to revert
```

4. **Bookmark prefix conflict**:
```
Warning: Found 3 existing bookmarks with prefix 'auth'
Suggestion: Use a different prefix or clean up old bookmarks with 'jj bookmark delete'
```

## Success Criteria

Stack creation is successful when:

1. All changes exist in the stack: `jj log -r "trunk()..@"` shows expected count
2. Each change has correct description
3. Bookmarks are assigned to each change: `jj bookmark list "glob:${prefix}-*"`
4. No conflicts in the stack: `jj log -r "trunk()..@ & conflicts()"` is empty
5. Bookmarks are pushed: `jj git push -b "glob:${prefix}-*"` succeeds

## Post-Creation Actions

After successful stack creation:

1. Verify the stack:
   ```bash
   jj log -r "trunk()..@"
   ```

2. Verify bookmarks:
   ```bash
   jj bookmark list "glob:${prefix}-*"
   ```

3. Configure git-town parents and create PRs (if not using jst):
   ```bash
   # Configure parent chain
   git town config set-parent ${prefix}-1-name main
   git town config set-parent ${prefix}-2-name ${prefix}-1-name

   # Create PRs with git-town (auto-targets correct parent)
   git checkout ${prefix}-1-name
   git-town propose --title "..."
   git checkout ${prefix}-2-name
   git-town propose --title "..."

   # Return to jj context
   jj new
   ```

4. Inform user of next steps:
   - Review each PR independently
   - Merge bottom-up (first PR first)
   - Use `jj edit <change-id>` to address review feedback
   - Push updates with `jj git push -b "glob:${prefix}-*"`

## Reference

- jj documentation: https://jj-vcs.github.io/jj/latest/
- jj new command: https://jj-vcs.github.io/jj/latest/cli-reference/#jj-new
- Bookmark management: https://jj-vcs.github.io/jj/latest/cli-reference/#jj-bookmark
