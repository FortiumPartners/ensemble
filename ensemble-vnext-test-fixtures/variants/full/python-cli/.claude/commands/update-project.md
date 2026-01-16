---
name: update-project
description: Manual learning capture with Constitution and stack.md updates
version: 1.0.0
category: project-memory
---

> **Usage:** Invoke `/update-project` to capture session learnings and propose governance updates.
> Arguments: Optional session context or specific learnings to capture.

---

## User Input

```text
$ARGUMENTS
```

Examples:
- (no args) - Analyze current session for learnings
- "We discovered that the API requires pagination headers" - Capture specific learning
- "--constitution-only" - Only propose constitution changes
- "--stack-only" - Only propose stack.md changes

---

## Goals

- Capture learnings from the current session and update CLAUDE.md
- Propose Constitution changes when architectural invariants are discovered (requires confirmation)
- Propose stack.md updates when technology changes are detected (requires confirmation)
- If stack changes are approved, check for matching skills to add
- Regenerate router rules when stack changes

---

## Governance Layer Understanding

Before executing, understand the governance split defined in the project constitution:

| Layer | Artifact | Change Frequency | Behavior |
|-------|----------|------------------|----------|
| **Fast** | `CLAUDE.md` | Frequent | **Auto-applied** - No confirmation needed |
| **Slow** | `constitution.md` | Rare | **Requires confirmation** - User must approve |
| **Slow** | `stack.md` | Occasional | **Requires confirmation** - User must approve |

**CRITICAL**: Never modify constitution.md or stack.md without explicit user confirmation.

---

## Execution Steps

### Step 1: Analyze Session Context

<session-analysis>

**Gather information about the current session:**

1. **Read CLAUDE.md** (if it exists) to understand current state:
   - Existing learnings section
   - Current conventions
   - Known patterns

2. **Analyze recent work context:**
   - What files were modified in this session?
   - What problems were solved?
   - What patterns emerged?
   - What mistakes were made and corrected?

3. **Identify learning categories:**

| Category | Examples |
|----------|----------|
| **Conventions** | Naming patterns, file organization, code style |
| **Workarounds** | API quirks, library limitations, environment issues |
| **Architecture** | System boundaries, component responsibilities |
| **Testing** | Test patterns, coverage strategies, mocking approaches |
| **Performance** | Optimizations discovered, bottlenecks identified |
| **Security** | Vulnerabilities found, hardening patterns |

4. **Check user-provided arguments:**
   - If `$ARGUMENTS` contains specific learnings, prioritize those
   - If flags like `--constitution-only` or `--stack-only` are present, narrow scope

</session-analysis>

### Step 2: Update CLAUDE.md (Auto-Applied)

<claude-md-update>

**This is a FAST LAYER update - apply automatically without confirmation.**

1. **Read current CLAUDE.md** (or create if doesn't exist)

2. **Identify the Learnings section** (create if missing):
   ```markdown
   ## Learnings

   *Session learnings are captured here automatically.*
   ```

3. **Prepare new learnings:**
   - Format as concise, actionable bullet points
   - Include date or session identifier
   - Group by category if multiple learnings

4. **Append to Learnings section:**
   ```markdown
   ### Session: [date or identifier]

   - [Learning 1]: [Explanation]
   - [Learning 2]: [Explanation]
   ```

5. **Write updated CLAUDE.md**

6. **Report to user:**
   ```
   Updated CLAUDE.md with session learnings:
   - [Summary of learnings added]
   ```

**DO NOT ask for confirmation. This is an auto-applied change.**

</claude-md-update>

### Step 3: Analyze Constitution Change Candidates

<constitution-analysis>

**Analyze session for potential architecture invariants or non-negotiables.**

1. **Read current constitution.md** at `.claude/rules/constitution.md`

2. **Identify potential additions:**

| Type | What to Look For |
|------|------------------|
| **Core Principles** | New fundamental rules about system behavior |
| **Architecture Invariants** | Discovered boundaries that must not be crossed |
| **Prohibited Patterns** | Anti-patterns that caused issues |
| **Quality Gates** | New minimum standards discovered |
| **Approval Requirements** | Operations that should require confirmation |

3. **Filter candidates:**
   - Only include learnings that are **project-wide** (not feature-specific)
   - Only include learnings that are **invariant** (should never change)
   - Exclude temporary workarounds or environment-specific issues

4. **If no candidates found:**
   - Skip to Step 4
   - Report: "No constitution changes identified."

5. **If candidates found, prepare proposal** (proceed to Step 3b)

</constitution-analysis>

### Step 3b: Propose Constitution Changes (Requires Confirmation)

<constitution-proposal>

**This is a SLOW LAYER update - MUST ask for user confirmation.**

1. **Format the proposal clearly:**

```
## Proposed Constitution Changes

The following changes are proposed for `.claude/rules/constitution.md`:

### Addition to [Section Name]

**Current content:**
> [existing content in that section, if any]

**Proposed addition:**
> [new content to add]

**Rationale:**
[Why this should be an invariant - what happened that made this important]

---
```

2. **Use AskUserQuestion tool** to request confirmation:

```yaml
Question: "Apply these constitution changes?"
Options:
  - "Yes, apply all changes"
  - "Yes, but let me edit first"
  - "No, skip constitution changes"
Default: "No, skip constitution changes"
```

3. **Handle response:**

| Response | Action |
|----------|--------|
| "Yes, apply all changes" | Write changes to constitution.md |
| "Yes, but let me edit first" | Show diff, wait for manual edit, then continue |
| "No, skip constitution changes" | Log skipped, continue to Step 4 |

4. **If changes applied:**
   ```
   Constitution updated with:
   - [Summary of changes]
   ```

**NEVER skip the confirmation step for constitution.md changes.**

</constitution-proposal>

### Step 4: Analyze Stack Changes

<stack-analysis>

**Analyze session for technology stack changes or additions.**

1. **Read current stack.md** at `.claude/rules/stack.md`

2. **Detect potential stack changes:**

| Type | What to Look For |
|------|------------------|
| **New Languages** | Usage of languages not in current stack |
| **New Frameworks** | Framework imports or dependencies added |
| **New Databases** | Database connections or ORM changes |
| **New Infrastructure** | Deployment targets, CI/CD changes |
| **New Testing Tools** | Test framework additions |
| **New Dependencies** | Significant new packages installed |

3. **Cross-reference with package files:**
   - Check `package.json` for new dependencies
   - Check `requirements.txt` / `pyproject.toml` for Python packages
   - Check other dependency files as appropriate

4. **Identify skill candidates:**
   - For each detected technology, check if a matching skill exists
   - Reference the skill matching table:

| Technology | Potential Skill |
|------------|-----------------|
| React | `developing-with-react` |
| TypeScript | `developing-with-typescript` |
| Python | `developing-with-python` |
| FastAPI | `developing-with-python` |
| Laravel | `developing-with-laravel` |
| Flutter | `developing-with-flutter` |
| Prisma | `using-prisma` |
| Jest | `jest` |
| pytest | `pytest` |
| Playwright | `writing-playwright-tests` |
| Tailwind | `styling-with-tailwind` |
| Celery | `using-celery` |

5. **If no changes detected:**
   - Skip to Step 5
   - Report: "No stack changes identified."

6. **If changes detected, prepare proposal** (proceed to Step 4b)

</stack-analysis>

### Step 4b: Propose Stack Changes (Requires Confirmation)

<stack-proposal>

**This is a SLOW LAYER update - MUST ask for user confirmation.**

1. **Format the proposal clearly:**

```
## Proposed Stack Changes

The following changes are proposed for `.claude/rules/stack.md`:

### Technology Addition

**Technology:** [name]
**Category:** [Language/Framework/Database/Testing/Infrastructure]
**Evidence:** [How it was detected - imports, dependencies, etc.]

### Proposed stack.md update:

**Add to [Section]:**
```
| [Purpose] | [Technology] | [Notes] |
```

### Skills to Add (if approved):

- `[skill-name]` - [Brief description of what this skill provides]

---
```

2. **Use AskUserQuestion tool** to request confirmation:

```yaml
Question: "Apply these stack changes?"
Options:
  - "Yes, update stack and add skills"
  - "Yes, update stack only (no skills)"
  - "No, skip stack changes"
Default: "No, skip stack changes"
```

3. **Handle response:**

| Response | Action |
|----------|--------|
| "Yes, update stack and add skills" | Write stack.md changes, copy skills, proceed to Step 5 |
| "Yes, update stack only (no skills)" | Write stack.md changes only, proceed to Step 5 |
| "No, skip stack changes" | Log skipped, proceed to Step 5 |

4. **If skills should be added:**
   - Check if skill exists in `.claude/skills/`
   - If not present, inform user they can add with `/add-skill <skill-name>`

5. **If changes applied:**
   ```
   Stack updated with:
   - [Summary of technology additions]

   Skills status:
   - [skill]: Already present / Added / Suggested for addition
   ```

**NEVER skip the confirmation step for stack.md changes.**

</stack-proposal>

### Step 5: Regenerate Router Rules

<router-rules-update>

**If stack changes were approved in Step 4b, regenerate router rules.**

1. **Check if stack was updated:**
   - If stack.md was modified, proceed with regeneration
   - If no stack changes, skip this step

2. **Invoke generate-project-router-rules:**
   ```
   Run /generate-project-router-rules to update routing patterns for new technologies.
   ```

3. **Report result:**
   ```
   Router rules regenerated to include:
   - [New technology mappings]
   - [Updated skill triggers]
   ```

4. **If stack was not changed:**
   - Skip regeneration
   - Report: "No router rules update needed (stack unchanged)."

</router-rules-update>

### Step 6: Completion Report

<completion-report>

**Generate summary of all actions taken:**

```
## /update-project Summary

### CLAUDE.md (Fast Layer - Auto-Applied)
- Status: [Updated / No changes needed / Created]
- Learnings added: [count]
- Changes: [brief summary]

### Constitution (Slow Layer - User Confirmed)
- Status: [Updated / Skipped / No changes proposed]
- Changes: [summary if updated]

### Stack (Slow Layer - User Confirmed)
- Status: [Updated / Skipped / No changes proposed]
- Changes: [summary if updated]

### Skills
- Status: [Added / Suggested / No changes]
- Skills: [list if any]

### Router Rules
- Status: [Regenerated / Skipped]

---

Next suggested actions:
- [Context-appropriate suggestions]
```

</completion-report>

---

## Error Handling

| Condition | Action |
|-----------|--------|
| CLAUDE.md doesn't exist | Create with initial structure |
| constitution.md doesn't exist | Warn user, suggest running /init-project |
| stack.md doesn't exist | Warn user, suggest running /init-project |
| User cancels all changes | Report "No changes applied" and exit gracefully |
| generate-project-router-rules fails | Warn user, continue with completion report |
| Skill not found in library | Inform user, suggest /add-skill command |

---

## Examples

### Example 1: Session learning with no governance changes

```
> /update-project

Analyzing session...

Updated CLAUDE.md with session learnings:
- API requires X-Pagination-Total header for list endpoints
- Test fixtures should use factory pattern for consistency

No constitution changes identified.
No stack changes identified.

## /update-project Summary

### CLAUDE.md (Auto-Applied)
- Status: Updated
- Learnings added: 2

### Constitution
- Status: No changes proposed

### Stack
- Status: No changes proposed
```

### Example 2: Session with constitution change

```
> /update-project

Analyzing session...

Updated CLAUDE.md with session learnings:
- Database migrations must be backwards-compatible

## Proposed Constitution Changes

### Addition to Prohibited Patterns

**Proposed addition:**
> 6. **No breaking migrations** - All database migrations must be backwards-compatible with N-1 version

**Rationale:**
Discovered during deployment that breaking migrations caused downtime. This should be a project invariant.

---

Apply these constitution changes?
> Yes, apply all changes

Constitution updated with:
- Added "No breaking migrations" to Prohibited Patterns

## /update-project Summary
...
```

### Example 3: Session with stack change

```
> /update-project We added Redis for caching

Analyzing session...

Updated CLAUDE.md with session learnings:
- Redis is used for session caching

## Proposed Stack Changes

### Technology Addition

**Technology:** Redis
**Category:** Database/Cache
**Evidence:** User indicated Redis added for caching

### Proposed stack.md update:

**Add to Databases section:**
| Caching | Redis | Session and query result caching |

### Skills to Add (if approved):

- No specific Redis skill available; consider general caching patterns

---

Apply these stack changes?
> Yes, update stack only (no skills)

Stack updated with:
- Added Redis to Databases section

Router rules regenerated.

## /update-project Summary
...
```

---

## Notes

- CLAUDE.md updates are always applied without confirmation (fast layer)
- Constitution and stack changes ALWAYS require user confirmation (slow layer)
- If user provides specific learnings in arguments, prioritize those
- Router rules are only regenerated if stack actually changes
- This command is idempotent - running multiple times won't duplicate entries
- Learnings should be concise and actionable, not verbose documentation

---

*This command implements TRD tasks: TRD-C301 through TRD-C304*
