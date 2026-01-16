---
name: cleanup-project
description: Review and prune CLAUDE.md and project artifacts with backup and dry-run support
version: 1.0.0
category: project-memory
---

> **Usage:** Invoke `/cleanup-project` to review and prune accumulated learnings and artifacts.
> Arguments: Optional flags to control behavior.

---

## User Input

```text
$ARGUMENTS
```

Supported flags:
- (no args) - Interactive cleanup with confirmation
- `--dry-run` - Preview changes without modifying files
- `--auto` - Apply recommended cleanup without confirmation
- `--backup-only` - Create backup without cleanup
- `--aggressive` - More aggressive pruning (removes older entries)

---

## Goals

- Review accumulated content in CLAUDE.md for relevance and freshness
- Prune outdated or superseded learnings
- Consolidate duplicate or similar entries
- Create backup before making changes
- Support dry-run for previewing changes

---

## Workflow

### Step 1: Pre-Flight Checks

<pre-flight>

1. **Parse arguments:**
   - Check for `--dry-run`, `--auto`, `--backup-only`, `--aggressive` flags
   - Set execution mode accordingly

2. **Verify CLAUDE.md exists:**
   - If missing, report and exit: "No CLAUDE.md found. Nothing to clean up."

3. **Read current content:**
   - Parse CLAUDE.md into sections
   - Identify learnings section
   - Count total entries

4. **Report initial state:**
   ```
   Cleanup Target: CLAUDE.md
   Current size: [X] lines
   Learnings entries: [Y]
   Last modified: [date]
   ```

</pre-flight>

### Step 2: Create Backup

<backup-creation>

**Always create backup before any cleanup operation.**

1. **Generate backup filename:**
   ```
   .claude/backups/CLAUDE.md.backup.[timestamp]
   ```

2. **Create backup directory if needed:**
   ```bash
   mkdir -p .claude/backups
   ```

3. **Copy current CLAUDE.md to backup:**
   - Preserve exact content
   - Record backup location

4. **Report:**
   ```
   Backup created: .claude/backups/CLAUDE.md.backup.2024-01-15T10:30:00
   ```

5. **If `--backup-only` flag:**
   - Report backup created
   - Exit without cleanup

</backup-creation>

### Step 3: Analyze Content for Cleanup

<content-analysis>

**Identify entries that should be pruned or consolidated.**

1. **Categorize each learning entry:**

| Category | Action | Criteria |
|----------|--------|----------|
| **Current** | Keep | Recently added, still relevant |
| **Outdated** | Remove | Superseded by newer entries |
| **Duplicate** | Consolidate | Same or similar to another entry |
| **Temporary** | Remove | Workaround for fixed issue |
| **Obsolete** | Remove | References removed code/features |

2. **Apply aggressiveness based on flag:**

| Flag | Behavior |
|------|----------|
| (default) | Only remove clearly outdated/duplicate |
| `--aggressive` | Also remove entries older than 30 days if not referenced |

3. **Build cleanup plan:**

   ```
   Cleanup Analysis:

   KEEP (current, relevant):
   - [entry 1]
   - [entry 2]

   REMOVE (outdated):
   - [entry 3] - Reason: Superseded by [entry 1]

   CONSOLIDATE (duplicates):
   - [entry 4] + [entry 5] -> [merged entry]

   REMOVE (temporary workaround):
   - [entry 6] - Reason: Issue fixed in commit abc123
   ```

4. **Calculate impact:**
   ```
   Cleanup Impact:
   - Entries before: [X]
   - Entries after: [Y]
   - Entries removed: [Z]
   - Lines reduced: [N]
   ```

</content-analysis>

### Step 4: Preview Changes (Dry Run)

<dry-run>

**If `--dry-run` flag is set, show changes without applying.**

1. **Display cleanup plan:**
   ```
   ## Dry Run - Proposed Changes

   ### Entries to Remove
   [list with reasons]

   ### Entries to Consolidate
   [before/after pairs]

   ### Entries to Keep
   [count]

   ---

   Would reduce CLAUDE.md from [X] to [Y] entries.

   To apply these changes, run: /cleanup-project
   ```

2. **Exit without modifying files**

</dry-run>

### Step 5: Confirm and Apply (Interactive)

<interactive-cleanup>

**If neither `--dry-run` nor `--auto`, get user confirmation.**

1. **Present cleanup summary:**
   ```
   ## Proposed Cleanup

   Entries to remove: [X]
   Entries to consolidate: [Y]
   Estimated reduction: [Z]%

   Backup already created at: [path]
   ```

2. **Use AskUserQuestion for confirmation:**
   ```yaml
   Question: "Apply this cleanup?"
   Options:
     - "Yes, apply cleanup"
     - "Show detailed changes first"
     - "No, keep current content"
   ```

3. **Handle responses:**

| Response | Action |
|----------|--------|
| "Yes, apply cleanup" | Proceed to Step 6 |
| "Show detailed changes first" | Show diff, then re-ask |
| "No, keep current content" | Report "Cleanup cancelled" and exit |

</interactive-cleanup>

### Step 6: Apply Cleanup

<apply-cleanup>

**Write cleaned content to CLAUDE.md.**

1. **Build new content:**
   - Keep all non-learnings sections unchanged
   - Replace learnings section with pruned/consolidated version
   - Maintain proper formatting

2. **Write updated CLAUDE.md:**
   - Use atomic write if possible
   - Verify file was written correctly

3. **Report completion:**
   ```
   Cleanup Applied:

   - Entries removed: [X]
   - Entries consolidated: [Y]
   - Size reduction: [Z]%

   Backup preserved at: [path]

   To restore: cp [backup-path] CLAUDE.md
   ```

</apply-cleanup>

### Step 7: Auto Mode

<auto-cleanup>

**If `--auto` flag, apply recommended cleanup without confirmation.**

1. **Apply only conservative cleanup:**
   - Remove only clearly outdated entries
   - Consolidate exact duplicates
   - Skip ambiguous cases

2. **Apply changes directly**

3. **Report:**
   ```
   Auto-cleanup applied:
   - Entries removed: [X]
   - Entries consolidated: [Y]

   Backup at: [path]
   ```

</auto-cleanup>

---

## Expected Output

**Dry Run Mode:**
- Preview of proposed changes
- No files modified

**Interactive Mode:**
- Backup created
- User confirmation received
- CLAUDE.md updated
- Summary of changes

**Auto Mode:**
- Backup created
- Conservative cleanup applied
- Summary of changes

---

## Error Handling

| Condition | Action |
|-----------|--------|
| CLAUDE.md missing | Report "Nothing to clean" and exit |
| Backup directory creation fails | Error and abort |
| Write fails | Report error, point to backup |
| Parse error in CLAUDE.md | Warn and skip affected section |

---

## Examples

### Example 1: Dry run

```
> /cleanup-project --dry-run

Analyzing CLAUDE.md...

Current state:
- Total lines: 150
- Learnings entries: 25

## Dry Run - Proposed Changes

### Entries to Remove (5)

1. "API requires pagination" - Superseded by entry from Jan 12
2. "Workaround for auth bug" - Bug fixed in v2.1
3. "Temp: Use mock service" - Mock service replaced

### Entries to Consolidate (2)

- "Use factory pattern" + "Factories for test data" -> "Use factory pattern for test data"

---

Would reduce CLAUDE.md from 25 to 18 entries.

To apply, run: /cleanup-project
```

### Example 2: Interactive cleanup

```
> /cleanup-project

Creating backup...
Backup created: .claude/backups/CLAUDE.md.backup.2024-01-15T10:30:00

Analyzing CLAUDE.md...

## Proposed Cleanup

Entries to remove: 5
Entries to consolidate: 2
Estimated reduction: 28%

Apply this cleanup?
> Yes, apply cleanup

Cleanup Applied:
- Entries removed: 5
- Entries consolidated: 2
- Size reduction: 28%

Backup preserved at: .claude/backups/CLAUDE.md.backup.2024-01-15T10:30:00
```

### Example 3: Auto cleanup

```
> /cleanup-project --auto

Creating backup...
Backup created: .claude/backups/CLAUDE.md.backup.2024-01-15T10:30:00

Auto-cleanup applied:
- Entries removed: 3 (exact duplicates and clearly outdated)
- Entries consolidated: 1

Backup preserved at: .claude/backups/CLAUDE.md.backup.2024-01-15T10:30:00
```

---

## Notes

- Backup is ALWAYS created before any cleanup
- Dry run makes no changes to any files
- Auto mode is conservative to avoid removing valuable learnings
- Aggressive mode should be used sparingly
- Backups are kept indefinitely (user can clean up manually)
- This command only affects CLAUDE.md, not constitution.md or stack.md

---

## Related Commands

- `/update-project`: Capture new learnings
- `/init-project`: Initial project setup
- `/fold-prompt`: Context optimization (different purpose)

---

*This command implements TRD tasks: TRD-C702 through TRD-C704*
