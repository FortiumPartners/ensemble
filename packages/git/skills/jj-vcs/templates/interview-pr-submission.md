---
template_type: interview
template_name: pr-submission
version: 1.0.0
jj_command: git push
fields:
  - name: pr_titles
    type: array
    required: true
    min_items: 1
    max_items: 10
    item_validation: length
    item_min_length: 10
    item_max_length: 100
    error_message: "Each PR title must be 10-100 characters"
    examples:
      - ["refactor: Extract auth service", "feat: Add OAuth support", "test: Add auth tests"]
  - name: pr_body_template
    type: string
    required: false
    validation: file_or_string
    error_message: "PR body must be a string or path to a markdown file"
    examples:
      - "## Summary\n{description}\n\n## Stack\nPart {n} of {total} in stack."
      - "/path/to/pr-template.md"
  - name: draft
    type: boolean
    required: false
    default: false
    description: "Create PRs as drafts (not ready for review)"
    examples:
      - true
      - false
  - name: bookmark_pattern
    type: string
    required: false
    default: "glob:stack-*"
    validation: regex
    pattern: "^glob:.+$"
    error_message: "Bookmark pattern must use glob: prefix"
    examples:
      - "glob:stack-*"
      - "glob:auth-*"
      - "glob:feature-*"
  - name: use_jst
    type: boolean
    required: false
    default: false
    description: "Use jj-stack (jst) for automated PR submission"
    examples:
      - true
      - false
---

# PR Submission Interview

## Purpose

This interview template guides agents through submitting stacked PRs from a jj change stack. It gathers information about PR titles, descriptions, and submission preferences before creating PRs via git-town propose or jst.

## Context

In a stacked PR workflow, each change in the jj stack becomes a separate PR. PRs are chained: PR N targets the branch of PR N-1, with the bottom PR targeting `main`. This creates a reviewable chain where each PR shows only its incremental changes.

Key concepts:
- **Stacked PRs**: Each change gets its own PR targeting the previous change's branch
- **Bottom-up merge**: Merge the bottom PR first, then update bases and merge upward
- **Bookmark-to-branch mapping**: jj bookmarks map to git branches, which become PR head branches
- **jst submit**: Optional automated submission that handles bookmarks + PRs together

## Interview Questions

### Question 1: PR Titles (Required)

**Prompt**: "Provide a title for each PR in the stack, in order from bottom to top."

**Guidance**:
- One title per change in the stack
- Use imperative mood ("Add feature" not "Added feature")
- Follow conventional commit style when applicable
- Keep titles 10-100 characters
- Title count must match the number of changes in the stack

**Validation**:
```bash
STACK_SIZE=$(jj log -r "trunk()..@" --no-graph -T '"x"' | wc -c)
TITLE_COUNT=${#PR_TITLES[@]}

if [ "$TITLE_COUNT" -ne "$STACK_SIZE" ]; then
    echo "Error: Stack has $STACK_SIZE changes but $TITLE_COUNT titles provided"
    exit 1
fi
```

**Examples**:
```
Good titles (for 3-change stack):
  1. "refactor: Extract auth service from monolith"
  2. "feat: Add Google and GitHub OAuth providers"
  3. "test: Add comprehensive auth integration tests"

Poor titles:
  1. "Fix" (too vague)
  2. "Changes" (not descriptive)
```

### Question 2: PR Body Template (Optional)

**Prompt**: "Provide a PR body template or path to a template file. Use {description} for the change description, {n} for PR number in stack, and {total} for total PRs."

**Guidance**:
- Template variables: `{description}`, `{n}`, `{total}`, `{change_id}`, `{bookmark}`
- Include stack context so reviewers understand the dependency chain
- Can be a file path (`.md` extension) or inline markdown

**Examples**:

*Standard template*:
```markdown
## Summary
{description}

## Stack
Part {n} of {total} in this stack.

## Dependencies
{dependency_info}

## Test Plan
- [ ] Unit tests pass
- [ ] Integration tests pass
- [ ] Manual testing complete
```

### Question 3: Draft PRs (Optional)

**Prompt**: "Should these PRs be created as drafts? (default: false)"

**Guidance**:
- Use drafts when stack is not ready for full review
- Draft PRs still run CI checks
- Can convert to ready-for-review later

### Question 4: Bookmark Pattern (Optional)

**Prompt**: "What bookmark glob pattern identifies this stack? (default: glob:stack-*)"

**Guidance**:
- Must match the bookmarks assigned during stack creation
- Uses jj's glob pattern syntax
- Default `glob:stack-*` matches standard naming convention

### Question 5: Use jst (Optional)

**Prompt**: "Use jj-stack (jst) for automated PR submission? (default: false)"

**Guidance**:
- jst handles bookmark creation, pushing, and PR management automatically
- Recommended for stacks of 3+ changes
- Requires jst to be installed

## Validation Rules

### Pre-Execution Validation

1. **Stack exists**: Must have changes between trunk and working copy
2. **Bookmarks assigned**: Each change should have a bookmark
3. **No conflicts**: Stack must be conflict-free before PR creation
4. **gh authenticated**: GitHub CLI must be installed and authenticated
5. **Title count matches**: Number of titles must match number of changes

### Validation Script

```bash
#!/usr/bin/env bash
set -e

# Validate stack exists
STACK_SIZE=$(jj log -r "trunk()..@ ~ empty()" --no-graph -T '"x"' | wc -c)
if [ "$STACK_SIZE" -eq 0 ]; then
    echo "Error: No changes in stack (trunk()..@)"
    exit 1
fi
echo "Stack size: $STACK_SIZE changes"

# Validate no conflicts
CONFLICTS=$(jj log -r "trunk()..@ & conflicts()" --no-graph -T '"x"' | wc -c)
if [ "$CONFLICTS" -gt 0 ]; then
    echo "Error: Stack has $CONFLICTS conflicted changes"
    echo "Resolve conflicts before submitting PRs"
    exit 2
fi

# Validate bookmarks
BOOKMARK_PATTERN="${1:-glob:stack-*}"
BOOKMARKED=$(jj bookmark list "$BOOKMARK_PATTERN" 2>/dev/null | wc -l)
if [ "$BOOKMARKED" -eq 0 ]; then
    echo "Warning: No bookmarks matching pattern '$BOOKMARK_PATTERN'"
    echo "Assign bookmarks before creating PRs"
fi

# Validate gh CLI
if ! gh auth status > /dev/null 2>&1; then
    echo "Error: GitHub CLI not authenticated"
    echo "Run: gh auth login"
    exit 3
fi

echo "Validation passed"
```

## Example Workflows

### Workflow 1: Standard Stacked PR Submission

```
Current stack (jj log -r "trunk()..@"):
  Change 3: test: add auth tests (auth-3-tests)
  Change 2: feat: add OAuth (auth-2-oauth)
  Change 1: refactor: extract auth (auth-1-extract)

Agent: "Provide a title for each PR in the stack."
User:
  1. "refactor: Extract auth service from user controller"
  2. "feat: Add Google and GitHub OAuth providers"
  3. "test: Add comprehensive auth integration tests"

Agent: "Provide a PR body template."
User: [Enter] (uses default)

Agent: "Should these PRs be created as drafts?"
User: [Enter] (uses default: false)

Agent: "What bookmark pattern identifies this stack?"
User: "glob:auth-*"

Agent executes:
  # Push all bookmarks
  jj git push -b "glob:auth-*"

  # Configure git-town parent relationships
  git town config set-parent auth-1-extract main
  git town config set-parent auth-2-oauth auth-1-extract
  git town config set-parent auth-3-tests auth-2-oauth

  # Create PRs bottom-up with git-town (auto-targets configured parent)
  git checkout auth-1-extract
  git-town propose --title "refactor: Extract auth service from user controller"

  git checkout auth-2-oauth
  git-town propose --title "feat: Add Google and GitHub OAuth providers"

  git checkout auth-3-tests
  git-town propose --title "test: Add comprehensive auth integration tests"

  # Return to jj context
  jj new

Result:
  - 3 PRs created with correct base branches via git-town
  - git-town parent chain: main <- auth-1 <- auth-2 <- auth-3
  - Stack dependency chain: main <- PR1 <- PR2 <- PR3
  - Ready for incremental review
```

### Workflow 2: Draft Submission with jst

```
Agent: "Use jj-stack (jst) for automated PR submission?"
User: "true"

Agent: "Should these PRs be created as drafts?"
User: "true"

Agent executes:
  jst submit --draft

Result:
  - jst creates bookmarks, pushes, and creates draft PRs
  - All PRs are in draft state
  - Convert to ready-for-review with: gh pr ready <pr-number>
```

### Workflow 3: Update PRs After Review Feedback

```
# User edited a mid-stack change and wants to update PRs

Agent: "The stack has been updated. Push changes and update PRs?"
User: "Yes"

Agent executes:
  # Push updated bookmarks
  jj git push -b "glob:auth-*"

  # PRs automatically show updated diffs on GitHub
  # No need to recreate PRs - they track the bookmark/branch

Result:
  - GitHub PRs updated with latest changes
  - Review comments preserved
  - CI re-triggered on updated branches
```

## Error Handling

### Common Errors

1. **No changes in stack**:
```
Error: No changes in stack (trunk()..@)
Suggestion: Create changes first with 'jj new -m "..."'
```

2. **Stack has conflicts**:
```
Error: Stack has 2 conflicted changes
Suggestion: Resolve conflicts first: jj edit <change-id> && jj resolve
```

3. **Bookmarks not assigned**:
```
Warning: No bookmarks matching pattern 'glob:stack-*'
Suggestion: Assign bookmarks: jj bookmark create stack-1-name -r <change-id>
```

4. **gh CLI not authenticated**:
```
Error: GitHub CLI not authenticated
Suggestion: Run 'gh auth login' to authenticate
```

5. **PR already exists**:
```
Warning: PR already exists for branch 'stack-1-auth'
Suggestion: Push updates to existing PR: jj git push -b stack-1-auth
```

## Success Criteria

PR submission is successful when:

1. All bookmarks are pushed: `jj git push -b "glob:${pattern}"` succeeds
2. PRs are created for each change: `gh pr list --head ${bookmark}` shows PRs
3. PR bases are correct: Each PR targets the previous bookmark's branch
4. PR titles match provided titles
5. Draft status matches preference

## Post-Submission Actions

After successful PR submission:

1. Display PR URLs:
   ```bash
   gh pr list --search "head:${prefix}-"
   ```

2. Inform user of merge process:
   - Review each PR independently
   - Ship bottom PR first: `git checkout <bottom-branch> && git-town ship`
   - After ship: `jj git fetch && jj rebase -b <next-change> -d main`
   - Update git-town parent: `git town config set-parent <next-branch> main`
   - Push updated stack: `jj git push -b "glob:${prefix}-*"`
   - Repeat until all PRs shipped

3. Monitor CI:
   ```bash
   gh pr checks <pr-number>
   ```

## Reference

- jj git push: https://jj-vcs.github.io/jj/latest/cli-reference/#jj-git-push
- git-town propose: https://www.git-town.com/commands/propose
- git-town ship: https://www.git-town.com/commands/ship
- jj-stack: https://github.com/nicholasphair/jj-stack
