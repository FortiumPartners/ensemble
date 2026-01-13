---
name: rebase-project
description: Upgrade vendored runtime to newer plugin version while preserving customizations
version: 1.0.0
category: generator
---

> **Usage:** Invoke `/rebase-project` from the project root to upgrade the vendored runtime.
>
> **Options:**
> - `--dry-run` - Preview changes without applying
> - `--force` - Skip confirmation prompts
> - `--preserve-all` - Keep all local modifications (agents, rules, settings)

---

## User Input

```text
$ARGUMENTS
```

Examples:
- (no args) - Interactive mode with confirmations
- "--dry-run" - Preview what would change
- "--force" - Apply all updates without confirmation
- "--preserve-all" - Update only commands/hooks, preserve everything else

---

## Goals

- Upgrade vendored runtime in `.claude/` to match newer plugin version
- Preserve customizations made to agents (ALWAYS preserved unless --force)
- Preserve governance files (constitution.md, stack.md, process.md)
- Recompute skills based on current stack.md
- Update commands and hooks (safe to replace - not customized per project)
- Merge new settings.json defaults while preserving local overrides
- Generate comprehensive rebase report showing all changes

---

## Pre-Flight Checks

### Step 0: Validate Installation

**Check for existing ensemble installation:**

1. If `.claude/` directory does NOT exist:
   - Report: "No ensemble installation found. Run /init-project first to initialize."
   - Abort rebase

2. Check for required files:
   ```
   .claude/settings.json       - Required for version detection
   .claude/rules/stack.md      - Required for skill recomputation
   .claude/rules/constitution.md - Governance file (preserve)
   ```

3. If missing required files:
   - List missing files
   - Offer: "Run /init-project to create missing files, or continue with partial rebase?"

---

## Execution Steps

### Step 1: Version Detection

<version-detection>

**TRD-C602: Implement version detection**

1. **Read current vendored version:**

   Check `.claude/settings.json` for version field:
   ```json
   {
     "ensemble": {
       "version": "1.0.0",
       "rebased_at": "2026-01-12T10:30:00Z"
     }
   }
   ```

   If no version field exists:
   - Treat as "unknown" version (pre-versioning installation)
   - Note: "Version unknown - treating as initial installation"

2. **Detect available plugin version:**

   Read version from plugin manifest. The current plugin version is defined in the plugin package.

   For this comparison, use the version in the command frontmatter or a known plugin version source.

3. **Compare versions:**

   | Current | Available | Action |
   |---------|-----------|--------|
   | Same | Same | Report "Already up to date" (unless --force) |
   | Older | Newer | Proceed with upgrade |
   | Unknown | Any | Proceed with full sync |
   | Newer | Older | Warn "Vendored version is newer than plugin" |

4. **Output version summary:**
   ```
   Version Detection:
   - Current vendored version: [version or "unknown"]
   - Available plugin version: [version]
   - Status: [Up to date / Upgrade available / Version mismatch]
   ```

5. **If `--dry-run`:**
   - Continue to generate full diff report
   - Do NOT apply any changes

</version-detection>

### Step 2: Component Diff

<component-diff>

**TRD-C603: Implement component diff**

Analyze each component category to identify changes.

#### 2.1 Agent Diff

**Behavior:** Agents are PRESERVED by default - only NEW agents are added.

1. **List plugin agents:**
   Read agent files from plugin source: `@packages/full/agents/`

2. **List vendored agents:**
   Read agent files from `.claude/agents/`

3. **Categorize:**

   | Category | Condition | Action |
   |----------|-----------|--------|
   | **New** | In plugin, not in vendored | Will be added |
   | **Existing** | In both | PRESERVED (not modified) |
   | **Removed** | In vendored, not in plugin | Report but do NOT remove |

4. **Generate agent diff:**
   ```
   Agents:
   - New agents to add: [list]
   - Existing agents (preserved): [count]
   - Custom agents (not in plugin): [list if any]
   ```

#### 2.2 Skill Diff

**Behavior:** Skills are RECOMPUTED based on current stack.md.

1. **Read current stack.md:**
   Parse `.claude/rules/stack.md` to extract technology declarations

2. **Match against skill library:**
   Use skill matching table from skill-selection-instructions.md

   | stack.md Entry | Matching Skill |
   |----------------|----------------|
   | Language: Python | `developing-with-python` |
   | Language: TypeScript | `developing-with-typescript` |
   | Language: PHP | `developing-with-php` |
   | Framework: React | `developing-with-react` |
   | Framework: Laravel | `developing-with-laravel` |
   | Framework: Flutter | `developing-with-flutter` |
   | Framework: NestJS | `nestjs` |
   | Testing: Jest | `jest` |
   | Testing: pytest | `pytest` |
   | Testing: RSpec | `rspec` |
   | Testing: xUnit | `xunit` |
   | Testing: ExUnit | `exunit` |
   | Testing: Playwright | `writing-playwright-tests` |
   | Database: Prisma | `using-prisma` |
   | Database: Weaviate | `using-weaviate` |
   | Infrastructure: Railway | `managing-railway` |
   | Infrastructure: Vercel | `managing-vercel` |
   | Infrastructure: Supabase | `managing-supabase` |
   | AI: Anthropic/Claude | `using-anthropic-platform` |
   | AI: OpenAI | `using-openai-platform` |
   | AI: Perplexity | `using-perplexity-platform` |
   | AI: LangGraph | `building-langgraph-agents` |
   | Background Jobs: Celery | `using-celery` |
   | Styling: Tailwind | `styling-with-tailwind` |
   | Issue Tracker: Jira | `managing-jira-issues` |
   | Issue Tracker: Linear | `managing-linear-issues` |

3. **Compare with current skills:**
   ```
   Skills:
   - Skills to add: [list]
   - Skills to keep: [list - still match stack]
   - Skills to remove: [list - no longer match stack]
   ```

#### 2.3 Command Diff

**Behavior:** Commands are REPLACED (not customized per project).

1. **List plugin commands:**
   Read from `@packages/core/commands/` and `@packages/router/commands/`

2. **List vendored commands:**
   Read from `.claude/commands/`

3. **Categorize:**

   | Category | Condition | Action |
   |----------|-----------|--------|
   | **New** | In plugin, not in vendored | Will be added |
   | **Updated** | In both, content differs | Will be replaced |
   | **Unchanged** | In both, content same | No action |
   | **Custom** | In vendored, not in plugin | Report, preserve |

4. **Generate command diff:**
   ```
   Commands:
   - New commands: [list]
   - Updated commands: [list]
   - Unchanged commands: [count]
   - Custom commands (preserved): [list if any]
   ```

#### 2.4 Hook Diff

**Behavior:** Hooks are REPLACED (not customized per project).

1. **List plugin hooks:**
   Read from `@packages/permitter/hooks/`, `@packages/router/hooks/`, `@packages/core/hooks/`

2. **List vendored hooks:**
   Read from `.claude/hooks/`

3. **Categorize:**
   - Same categories as commands (new, updated, unchanged, custom)

4. **Generate hook diff:**
   ```
   Hooks:
   - New hooks: [list]
   - Updated hooks: [list]
   - Unchanged hooks: [count]
   - Custom hooks (preserved): [list if any]
   ```

#### 2.5 Settings Diff

**Behavior:** Settings are MERGED - new defaults added, local overrides preserved.

1. **Read plugin default settings:**
   Read from `@packages/core/templates/claude-directory/settings.json`

2. **Read vendored settings:**
   Read from `.claude/settings.json`

3. **Identify merge requirements:**
   ```
   Settings:
   - New configuration keys: [list]
   - Modified default values: [list - show old/new]
   - Local overrides preserved: [count]
   ```

#### 2.6 Generate Summary Diff

**Compile full diff report:**

```
## Rebase Diff Summary

Current Version: [version]
Target Version: [version]

### Components to Update

| Component | New | Updated | Removed | Preserved |
|-----------|-----|---------|---------|-----------|
| Agents | [n] | 0 | 0 | [n] |
| Skills | [n] | - | [n] | [n] |
| Commands | [n] | [n] | 0 | [n] |
| Hooks | [n] | [n] | 0 | [n] |
| Settings | [n] keys | [n] values | 0 | all |

### Detailed Changes

[Detailed list for each category as generated above]
```

</component-diff>

### Step 3: User Confirmation

<user-confirmation>

**If NOT `--dry-run` and NOT `--force`:**

1. **Present diff summary to user**

2. **Use AskUserQuestion tool:**

```yaml
Question: "Apply this rebase? This will update commands, hooks, and skills."
Options:
  - "Yes, apply all changes"
  - "Yes, but preserve existing skills"
  - "Show detailed diff first"
  - "Cancel rebase"
Default: "Cancel rebase"
```

3. **Handle response:**

| Response | Action |
|----------|--------|
| "Yes, apply all changes" | Proceed to Step 4 |
| "Yes, but preserve existing skills" | Set skill_preserve=true, proceed |
| "Show detailed diff first" | Display full diff, re-prompt |
| "Cancel rebase" | Report "Rebase cancelled", exit |

**If `--dry-run`:**
- Skip confirmation
- Skip Step 4 (selective update)
- Proceed directly to Step 5 (report generation with dry-run indicator)

**If `--force`:**
- Skip confirmation
- Proceed to Step 4

**If `--preserve-all`:**
- Only update commands and hooks
- Set agent_preserve=true, skill_preserve=true, settings_preserve=true
- Proceed to Step 4

</user-confirmation>

### Step 4: Selective Update

<selective-update>

**TRD-C604: Implement selective update**

#### 4.1 Update Agents (Selective)

**Preservation Rule:** PRESERVE customizations, only add NEW base agents

1. **For each NEW agent in plugin:**
   - Copy from plugin source to `.claude/agents/`
   - Report: "Added new agent: [name]"

2. **For EXISTING agents:**
   - DO NOT overwrite
   - Report: "Preserved customized agent: [name]"

3. **For CUSTOM agents (not in plugin):**
   - DO NOT remove
   - Report: "Kept custom agent: [name]"

**If `--force` specified:**
- Replace ALL agents with plugin versions
- Create backup first: `.claude/agents.backup.<timestamp>/`
- Warn: "Force mode: All agent customizations replaced (backup created)"

#### 4.2 Update Skills (Recompute)

**Preservation Rule:** Recompute based on current stack.md

1. **Create backup:**
   - Copy `.claude/skills/` to `.claude/skills.backup.<timestamp>/`

2. **Remove outdated skills:**
   - Delete skills that no longer match stack.md

3. **Add new skills:**
   - For each skill matching stack.md:
     - Copy entire folder from `@packages/skills/<skill-name>/` to `.claude/skills/<skill-name>/`
     - Include SKILL.md, REFERENCE.md, templates/, examples/

4. **Report:**
   ```
   Skills recomputed:
   - Added: [list]
   - Removed: [list]
   - Retained: [list]
   ```

**If skill_preserve=true:**
- Only add NEW skills
- Do NOT remove existing skills
- Report: "Skill removal skipped (preserve mode)"

#### 4.3 Update Commands (Replace)

**Preservation Rule:** Safe to replace - not customized per project

1. **For each plugin command:**
   - Copy from plugin source to `.claude/commands/`
   - Overwrite existing

2. **For custom commands (not in plugin):**
   - DO NOT remove
   - Report: "Kept custom command: [name]"

3. **Commands to copy:**
   - From `@packages/core/commands/`:
     - create-prd.md
     - refine-prd.md
     - create-trd.md
     - refine-trd.md
     - implement-trd.md
     - update-project.md
     - cleanup-project.md
     - fold-prompt.md
   - From `@packages/router/commands/`:
     - generate-router-rules.md
     - generate-project-router-rules.md

#### 4.4 Update Hooks (Replace)

**Preservation Rule:** Safe to replace - not customized per project

1. **For each plugin hook:**
   - Copy from plugin source to `.claude/hooks/`
   - Overwrite existing
   - Ensure execute permission on shell scripts

2. **For custom hooks (not in plugin):**
   - DO NOT remove
   - Report: "Kept custom hook: [name]"

3. **Hooks to copy:**
   - `permitter.js` from `@packages/permitter/hooks/`
   - `router.py` from `@packages/router/hooks/`
   - `formatter.sh` from `@packages/core/hooks/`
   - `status.js` from `@packages/core/hooks/`
   - `learning.js` from `@packages/core/hooks/`

#### 4.5 Update Settings (Merge)

**Preservation Rule:** Merge new defaults, preserve local settings

1. **Read plugin default settings**

2. **Read current vendored settings**

3. **Merge strategy:**

   | Key Type | Action |
   |----------|--------|
   | New key in plugin | Add to settings |
   | Existing key, same value | No change |
   | Existing key, different value | **Preserve vendored value** |
   | Key only in vendored | Preserve (local customization) |

4. **Update version metadata:**
   ```json
   {
     "ensemble": {
       "version": "[new plugin version]",
       "rebased_at": "[current timestamp ISO8601]",
       "previous_version": "[old version]"
     }
   }
   ```

5. **Write merged settings.json**

**If settings_preserve=true:**
- Only add new keys
- Do NOT modify any existing values
- Report: "Settings merge minimal (preserve mode)"

#### 4.6 Preserve Rules (Always)

**Preservation Rule:** ALWAYS keep existing rules

**NEVER modify:**
- `.claude/rules/constitution.md`
- `.claude/rules/stack.md`
- `.claude/rules/process.md`

Report: "Governance files preserved (not modified by rebase)"

</selective-update>

### Step 5: Generate Rebase Report

<rebase-report>

**TRD-C605: Create rebase report**

1. **Generate comprehensive report:**

```markdown
## Rebase Report

**Date:** [timestamp]
**Mode:** [Normal / Dry-Run / Force / Preserve-All]

### Version Information

| | Before | After |
|---|--------|-------|
| Version | [old] | [new] |
| Rebased | [old timestamp] | [new timestamp] |

### Changes Applied

#### Agents
- Added: [list with descriptions]
- Preserved (customized): [list]
- Custom (not in plugin): [list if any]

#### Skills
- Added: [list]
- Removed: [list]
- Retained: [list]

#### Commands
- Updated: [list]
- Added: [list if any]
- Custom (preserved): [list if any]

#### Hooks
- Updated: [list]
- Added: [list if any]
- Custom (preserved): [list if any]

#### Settings
- New keys added: [list]
- Preserved overrides: [list]

### Files Preserved (Not Modified)
- `.claude/rules/constitution.md`
- `.claude/rules/stack.md`
- `.claude/rules/process.md`
- All custom agents
- All local settings overrides

### Recommended Manual Review

The following files may benefit from manual review:

1. **New agents** - Review and customize for your project:
   [list of new agent files]

2. **Updated commands** - Check for breaking changes:
   [list of updated commands if any major changes]

3. **Skills removed** - Verify these are no longer needed:
   [list of removed skills]

### Backups Created

| Backup | Location |
|--------|----------|
| Skills | `.claude/skills.backup.[timestamp]/` |
| Agents (if --force) | `.claude/agents.backup.[timestamp]/` |

### Next Steps

1. Review new agents and customize for your project context
2. Test commands to verify they work with your workflow
3. If skills were removed, verify they're not referenced in agents
4. Run `/generate-project-router-rules` if routing behavior changed
```

2. **If `--dry-run`:**

   Add header:
   ```markdown
   ## DRY RUN - No changes applied

   The following changes WOULD be applied:
   [rest of report]

   To apply these changes, run:
   `/rebase-project` (without --dry-run)
   ```

3. **Write report to console output**

4. **Optionally save report:**
   - Save to `.claude/rebase-report-[timestamp].md`
   - Inform user: "Full report saved to [path]"

</rebase-report>

---

## Error Handling

| Condition | Action |
|-----------|--------|
| `.claude/` doesn't exist | Report error, suggest /init-project |
| Plugin source not accessible | Report error, abort |
| Permission denied on file write | Report specific file, suggest permissions fix |
| Backup creation fails | Abort update for that component, report |
| JSON parse error in settings | Report error, offer to reset settings |
| Skill copy fails | Log warning, continue with other skills |
| Git conflicts detected | Warn user, suggest committing changes first |

---

## Flag Behavior Summary

| Flag | Agents | Skills | Commands | Hooks | Settings | Rules |
|------|--------|--------|----------|-------|----------|-------|
| (default) | Add new only | Recompute | Replace | Replace | Merge | Preserve |
| `--dry-run` | Report only | Report only | Report only | Report only | Report only | Report only |
| `--force` | Replace all | Recompute | Replace | Replace | Merge | Preserve |
| `--preserve-all` | Add new only | Add new only | Replace | Replace | Add new only | Preserve |

---

## Notes

- This command is safe to run multiple times
- Backups are created for destructive operations
- Rules files (constitution.md, stack.md, process.md) are NEVER modified
- Custom agents/commands/hooks (not from plugin) are NEVER removed
- Version tracking enables incremental upgrades
- Use `--dry-run` first to preview changes before applying
- If unsure, use `--preserve-all` for minimal changes

---

*This command implements TRD tasks: TRD-C601 through TRD-C605*
