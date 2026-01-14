---
name: init-project
description: Initialize project with vendored ensemble runtime for AI-augmented development
version: 1.0.0
category: scaffolding
---

> **Usage:** Invoke `/init-project` from the project root to scaffold AI-augmented development infrastructure.
> Optional hints: "minimal" (skip prompts, use defaults), "force" (overwrite existing)

---

## CRITICAL: All 15 Steps Must Be Completed

**DO NOT exit early. DO NOT skip steps. This command REQUIRES all 15 steps to complete successfully.**

The initialization is NOT complete until:
- Step 9 (Deploy Configuration Files) creates `router-rules.json`
- Step 12 (Generate Project Router Rules) runs `/generate-project-router-rules`
- Step 13 (Create CLAUDE.md) creates or verifies CLAUDE.md exists
- Step 14 (Validation) confirms ALL required files exist
- Step 15 (Completion Report) outputs the summary

**Common failure point:** Exiting after Step 8 (Deploy Hooks) leaves the project in an incomplete state without router rules or CLAUDE.md. YOU MUST CONTINUE through Steps 9-15.

---

## User Input

```text
$ARGUMENTS
```

Examples:
- (no args) - Interactive mode with prompts
- "minimal" - Use detected defaults, minimal prompts
- "force" - Overwrite existing files

---

## Goals

- Create vendored runtime in `.claude/` directory with project-tailored components
- Detect existing project structure and technology stack
- Generate governance files: constitution.md, stack.md, process.md
- Copy and customize 12 subagents for project-specific needs
- Select and copy relevant skills from plugin library
- Configure hooks (permitter, router, formatter, status, learning)
- Set up `.trd-state/` directory with current.json
- Configure `.gitignore` for proper tracking
- Run `generate-project-router-rules` for project-specific routing

---

## Pre-Flight Checks

### Step 0: Brownfield Detection

**Check for existing installation:**

1. If `.claude/` directory exists:
   - Detect existing ensemble installation
   - Present user with migration options (see Migration Prompt Flow section)
   - If user cancels, abort initialization

2. If `docs/standards/constitution.md` exists (legacy location):
   - Inform user of legacy installation
   - Offer to migrate to new `.claude/rules/` structure

3. If `.specify/` directory exists:
   - Detect speckit installation
   - Offer to incorporate existing constitution

4. If `.agent-os/` directory exists:
   - Detect agent-os patterns
   - Offer to incorporate tech-stack definitions

**Current Feature Pointer Housekeeping (if .trd-state/current.json exists):**

1. Read `.trd-state/current.json`
2. Check if `branch` field matches current git branch
3. If mismatched, offer options:
   - Update `current.json` to reflect current branch
   - Switch git branch to match `current.json`
   - Clear `current.json` (start fresh)
4. Validate that referenced files (prd, trd, status) exist
5. If files are missing, clear stale pointers

---

## Execution Steps

### Step 1: Analyze Project

**Repository Analysis via LLM**

This is an LLM function - you (Claude) comprehensively scan the project to understand its structure.

<repository-analysis>

**Scan for Dependency Files:**

| File | What to Extract |
|------|-----------------|
| `package.json` | Node.js; dependencies, devDependencies, scripts, engines |
| `requirements.txt` | Python; package names and versions |
| `pyproject.toml` | Python; dependencies, build system, tools |
| `Gemfile` | Ruby; gems and versions |
| `go.mod` | Go; module and requires |
| `Cargo.toml` | Rust; dependencies and features |
| `composer.json` | PHP; require and require-dev |
| `mix.exs` | Elixir; deps function |
| `*.csproj`, `*.sln` | .NET; PackageReference |
| `pubspec.yaml` | Dart/Flutter; dependencies |

**Identify Frameworks:**

Follow the instructions in `@packages/core/templates/stack-detection-instructions.md` for:
- Primary language detection
- Framework identification (React, Next.js, FastAPI, NestJS, Rails, Phoenix, etc.)
- Testing framework detection (Jest, Vitest, pytest, RSpec, etc.)
- Database detection (PostgreSQL, MySQL, MongoDB, Redis, etc.)
- Infrastructure detection (Docker, Vercel, Railway, etc.)

**Analyze Project Structure:**

- Directory layout and organization patterns
- Architecture style (MVC, Clean Architecture, microservices, monolith)
- Existing conventions (naming, file organization)
- Monorepo detection (workspaces, lerna, turborepo)

**Output: Detected Stack Summary**

Create a mental model of:
```
Primary Language: <language>
Framework: <framework>
Testing: <unit framework>, <integration framework>, <e2e framework>
Database: <database> via <orm/driver>
Infrastructure: <hosting>, <ci-cd>
Architecture: <pattern>
```

</repository-analysis>

### Step 2: Interactive Configuration (unless "minimal")

**Use AskUserQuestion tool to gather project-specific information:**

<interactive-configuration>

#### Question 1: Project Identity

```yaml
Questions:
  - "What is the project name?"
    Default: <directory name>
  - "Brief project description (1-2 sentences)?"
    Default: <inferred from README or package.json>
```

#### Question 2: Development Methodology

```yaml
Question: "What development methodology should be enforced?"
Options:
  - "TDD (Test-Driven Development)" - Tests before code, RED-GREEN-REFACTOR
  - "Flexible" - No strict ordering, trust developer judgment
  - "Characterization-first" - For brownfield, add tests without changing code
Default: "Flexible" for existing projects, "TDD" for new projects
```

#### Question 3: Quality Gates

```yaml
Question: "What test coverage targets?"
Options:
  - "High (80% unit, 70% integration)" - Recommended for production systems
  - "Standard (60% unit, 50% integration)" - Balanced coverage
  - "Minimal (40% unit)" - Prototypes and MVPs
  - "Custom" - Specify your own targets
Default: "Standard" for existing projects, "High" for new projects
```

#### Question 4: Approval Requirements

```yaml
Question: "What changes should require explicit approval?"
MultiSelect: true
Default: All selected
Options:
  - "Architecture changes"
  - "New dependencies"
  - "Database schema changes"
  - "Breaking API changes"
  - "Production deployments"
  - "Security-sensitive code"
```

</interactive-configuration>

### Step 3: Create Directory Structure and Copy Plugin Content

**Execute the scaffold script deterministically using shell commands:**

Run a single combined command to resolve the plugin path and execute the scaffold script:

- Scaffold project: !`PLUGIN_PATH="${ENSEMBLE_PLUGIN_DIR:-${CLAUDE_PLUGIN_ROOT:-$(cat /tmp/.ensemble-test/plugin-path 2>/dev/null || jq -r '.plugins | to_entries[] | select(.key | startswith("ensemble")) | .value[0].installPath' ~/.claude/plugins/installed_plugins.json 2>/dev/null)}}"; echo "Plugin path: $PLUGIN_PATH"; "${PLUGIN_PATH}/scripts/scaffold-project.sh" --plugin-dir "$PLUGIN_PATH" .`

**The scaffold script creates:**
- All `.claude/` subdirectories (agents, rules, skills, commands, hooks)
- All `docs/` subdirectories (PRD, TRD, standards)
- `.trd-state/` directory
- Template files: `CLAUDE.md`, `.claude/router-rules.json`, `.claude/settings.json`, `.trd-state/current.json`
- **12 agent files** copied to `.claude/agents/`
- **8 command files** copied to `.claude/commands/`
- **All hooks** copied to `.claude/hooks/` (including permitter with lib dependencies)

**Verify all directories and these files exist before proceeding:**
- `CLAUDE.md`
- `.claude/router-rules.json`
- `.claude/settings.json`
- `.trd-state/current.json`
- `.claude/agents/*.md` (12 files)
- `.claude/commands/*.md` (8 files)
- `.claude/hooks/` (permitter/, router.py, formatter.sh, status.js, wiggum.js, learning.sh)

### Step 4: Generate Governance Files

<governance-files>

#### 4.1 Generate stack.md

Using the detected stack from Step 1, generate `.claude/rules/stack.md` using the template at `@packages/core/templates/stack.md.template`.

Fill in all placeholders with detected values:
- `{{PROJECT_NAME}}` - from user input or directory name
- `{{PRIMARY_PLATFORM}}` - detected platform
- `{{LANGUAGES}}` - detected languages with purposes
- `{{FRAMEWORKS}}` - detected frameworks
- `{{TESTING}}` - detected testing setup
- `{{GENERATED_DATE}}` - current date

#### 4.2 Generate constitution.md

Using user selections from Step 2 and the template at `@packages/core/templates/constitution.md.template`, generate `.claude/rules/constitution.md`.

Fill in all placeholders:
- `{{PROJECT_NAME}}` - from user input
- `{{PROJECT_DESCRIPTION}}` - from user input
- `{{UNIT_COVERAGE}}` - from quality gates selection
- `{{INTEGRATION_COVERAGE}}` - from quality gates selection
- `{{REQUIRES_APPROVAL}}` - from approval requirements selection
- `{{GENERATED_DATE}}` - current date

#### 4.3 Generate process.md

Copy and customize the template from `@packages/core/templates/process.md.template` to `.claude/rules/process.md`.

Fill in coverage placeholders from user selections.

</governance-files>

### Step 5: Deploy Subagents

<subagent-deployment>

**Copy and Customize All 12 Subagents**

For each agent in `@packages/full/agents/`:

1. Read the base agent .md file
2. Customize for the detected project stack:
   - Add project-specific framework references
   - Include detected testing framework in responsibilities
   - Reference detected database/ORM
   - Adjust examples to match project patterns
3. Write to `.claude/agents/<agent-name>.md`

**Agents to deploy:**
1. `product-manager.md` - PRD creation/refinement
2. `technical-architect.md` - TRD creation/refinement
3. `spec-planner.md` - Execution planning
4. `frontend-implementer.md` - UI/components
5. `backend-implementer.md` - APIs/services
6. `mobile-implementer.md` - Mobile apps
7. `verify-app.md` - Test execution
8. `code-simplifier.md` - Post-verification refactoring
9. `code-reviewer.md` - Security/quality review
10. `app-debugger.md` - Debug failures
11. `devops-engineer.md` - Infrastructure
12. `cicd-specialist.md` - Pipeline configuration

**Customization Guidelines:**

- Add detected framework to "Framework Detection" section
- Include project-specific testing commands
- Reference actual project structure in examples
- Preserve core responsibilities and boundaries

</subagent-deployment>

### Step 6: Select and Copy Skills

<skill-selection>

**Follow instructions in `@packages/core/templates/skill-selection-instructions.md`**

1. Parse the generated `stack.md` to extract:
   - Primary language(s)
   - Framework(s)
   - Testing framework(s)
   - Database/ORM
   - Infrastructure targets

2. Match against skill library at `@packages/skills/`:

| stack.md Entry | Skill to Copy |
|----------------|---------------|
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

3. Write selected skill names to `.claude/selected-skills.txt` (one skill per line):

```
developing-with-python
pytest
using-prisma
managing-railway
```

4. Call the scaffold script to copy the selected skills:

- Copy skills: !`PLUGIN_PATH="${ENSEMBLE_PLUGIN_DIR:-${CLAUDE_PLUGIN_ROOT:-$(cat /tmp/.ensemble-test/plugin-path 2>/dev/null || jq -r '.plugins | to_entries[] | select(.key | startswith("ensemble")) | .value[0].installPath' ~/.claude/plugins/installed_plugins.json 2>/dev/null)}}"; "${PLUGIN_PATH}/scripts/scaffold-project.sh" --plugin-dir "$PLUGIN_PATH" --copy-skills .`

5. Report selection to user with confidence levels

</skill-selection>

### Step 7: Verify Commands (Copied in Step 3)

<command-deployment>

**Commands were copied by scaffold script in Step 3. Verify they exist:**

Check that these commands exist in `.claude/commands/`:
- `create-prd.md`
- `refine-prd.md`
- `create-trd.md`
- `refine-trd.md`
- `implement-trd.md`
- `update-project.md`
- `cleanup-project.md`
- `fold-prompt.md`

If any are missing, re-run the scaffold: !`PLUGIN_PATH="${ENSEMBLE_PLUGIN_DIR:-${CLAUDE_PLUGIN_ROOT:-$(cat /tmp/.ensemble-test/plugin-path 2>/dev/null || jq -r '.plugins | to_entries[] | select(.key | startswith("ensemble")) | .value[0].installPath' ~/.claude/plugins/installed_plugins.json 2>/dev/null)}}"; "${PLUGIN_PATH}/scripts/scaffold-project.sh" --plugin-dir "$PLUGIN_PATH" .`

</command-deployment>

### Step 8: Verify Hooks (Copied in Step 3)

<hook-deployment>

**Hooks were copied by scaffold script in Step 3. Verify they exist:**

Check these hooks in `.claude/hooks/`:
1. **Permitter Hook** - `.claude/hooks/permitter/permitter.js` and `lib/` directory
2. **Router Hook** - `.claude/hooks/router.py`
3. **Formatter Hook** - `.claude/hooks/formatter.sh`
4. **Status Hook** - `.claude/hooks/status.js`
5. **Wiggum Hook** - `.claude/hooks/wiggum.js`
6. **Learning Hook** - `.claude/hooks/learning.sh`

If any are missing, re-run the scaffold: !`PLUGIN_PATH="${ENSEMBLE_PLUGIN_DIR:-${CLAUDE_PLUGIN_ROOT:-$(cat /tmp/.ensemble-test/plugin-path 2>/dev/null || jq -r '.plugins | to_entries[] | select(.key | startswith("ensemble")) | .value[0].installPath' ~/.claude/plugins/installed_plugins.json 2>/dev/null)}}"; "${PLUGIN_PATH}/scripts/scaffold-project.sh" --plugin-dir "$PLUGIN_PATH" .`

</hook-deployment>

---

**CHECKPOINT: Steps 1-8 complete. DO NOT STOP HERE. Continue with Steps 9-15.**

---

### Step 9: Deploy Configuration Files

<configuration-deployment>

**Deploy settings.json:**

Copy `@packages/core/templates/claude-directory/settings.json` to `.claude/settings.json`

**Deploy router-rules.json:**

Copy `@packages/core/templates/claude-directory/router-rules.json` to `.claude/router-rules.json`

**Initialize current.json:**

Copy `@packages/core/templates/trd-state/current.json.template` to `.trd-state/current.json`

</configuration-deployment>

### Step 10: Install and Configure Formatters

<formatter-installation>

**Based on detected tech stack, install missing formatters:**

| Detected Language | Formatter | Install Command |
|-------------------|-----------|-----------------|
| JavaScript/TypeScript | Prettier | `npm install -D prettier` |
| Python | Ruff | `pip install ruff` or `uv add --dev ruff` |
| Go | goimports | `go install golang.org/x/tools/cmd/goimports@latest` |
| Rust | rustfmt | (included with Rust) |
| Shell | shfmt | `brew install shfmt` or `go install mvdan.cc/sh/v3/cmd/shfmt@latest` |
| PHP | PHP-CS-Fixer | `composer require --dev friendsofphp/php-cs-fixer` |
| Ruby | RuboCop | `gem install rubocop` |
| Java | google-java-format | Manual download required |
| C# | CSharpier | `dotnet tool install csharpier` |
| Swift | swift-format | `brew install swift-format` |
| Lua | StyLua | `cargo install stylua` |

**For each detected language:**

1. Check if formatter is installed (run `which <formatter>`)
2. If not installed, show install command and ask user to install
3. Create or update formatter configuration files:
   - `.prettierrc` for Prettier
   - `ruff.toml` for Ruff
   - etc.

</formatter-installation>

### Step 11: Update .gitignore

<gitignore-update>

**Append to `.gitignore` if not already present:**

Read content from `@packages/core/templates/gitignore-additions.txt` and append to project's `.gitignore`.

Ensure these patterns are added:
```gitignore
# Ensemble Runtime - Local Settings
.claude/settings.local.json
*.local.*
*.local.json

# Environment files with secrets
.env
.env.local
.env.*.local
```

**Important:** Do NOT add `.claude/` or `.trd-state/` to gitignore - these should be tracked.

</gitignore-update>

---

**CHECKPOINT: Steps 9-11 complete. DO NOT STOP HERE. Continue with Steps 12-15.**

---

### Step 12: Generate Project Router Rules

<router-rules-generation>

**After all other setup is complete, run generate-project-router-rules:**

Invoke `/generate-project-router-rules` to create project-specific routing patterns.

This command analyzes the project structure and creates routing rules in `.claude/router-rules.json` that help the Router hook route prompts to appropriate commands, skills, and agents.

</router-rules-generation>

### Step 13: Update CLAUDE.md

<claude-md-update>

**The scaffolding script created CLAUDE.md from a template. You must now UPDATE it with project-specific information.**

**Action Required:**

1. Read the existing `CLAUDE.md` file
2. Replace the placeholders with actual project information:
   - `{{PROJECT_NAME}}` → Actual project name from PROJECT.md or directory
   - `{{PROJECT_DESCRIPTION}}` → Brief description of the project
   - `{{STACK_SUMMARY}}` → Summary of detected tech stack
3. Use the Edit tool to update the file (preserve all other content)

**Placeholders to replace:**

| Placeholder | Replace With |
|-------------|--------------|
| `{{PROJECT_NAME}}` | Project name (e.g., "TaskFlow API") |
| `{{PROJECT_DESCRIPTION}}` | 1-2 sentence description |
| `{{STACK_SUMMARY}}` | Tech stack summary from Step 1 analysis |

**Verification:**

After updating, read CLAUDE.md and verify:
- No `{{...}}` placeholders remain
- Project name and description are filled in
- Tech stack section has content

</claude-md-update>

### Step 14: Validation

<validation>

**CRITICAL: Verify ALL required files exist before proceeding to Step 15.**

**Required Files Checklist - ALL must exist:**

| File/Directory | Created In Step | Required |
|----------------|-----------------|----------|
| `.claude/agents/` (12 files) | Step 5 | YES |
| `.claude/rules/constitution.md` | Step 4 | YES |
| `.claude/rules/stack.md` | Step 4 | YES |
| `.claude/rules/process.md` | Step 4 | YES |
| `.claude/skills/` (1+ skill folders) | Step 6 | YES |
| `.claude/commands/` (8 files) | Step 7 | YES |
| `.claude/hooks/permitter.js` | Step 8 | YES |
| `.claude/hooks/router.py` | Step 8 | YES |
| `.claude/hooks/formatter.sh` | Step 8 | YES |
| `.claude/hooks/status.js` | Step 8 | YES |
| `.claude/hooks/learning.js` | Step 8 | YES |
| `.claude/settings.json` | Step 3 (scaffold) | YES |
| `.claude/router-rules.json` | Step 3 (scaffold) | YES |
| `.trd-state/current.json` | Step 3 (scaffold) | YES |
| `CLAUDE.md` | Step 3 (scaffold), Step 13 (update) | YES |

**Validation Procedure:**

1. Check each file in the checklist above
2. For any MISSING file:
   - Report which file is missing
   - Identify which step should have created it
   - **LOOP BACK and execute that step to create the missing file**
   - Repeat validation until ALL files exist
3. Verify JSON files are valid (`.claude/settings.json`, `.claude/router-rules.json`, `.trd-state/current.json`)
4. Verify hooks have execute permissions
5. Verify `.gitignore` includes local settings patterns
6. **IMPORTANT: Verify CLAUDE.md has been updated:**
   - Read CLAUDE.md
   - Check that NO `{{...}}` placeholders remain
   - If placeholders exist, go back to Step 13 and update them

**If validation fails:**
- Report specific issues
- Execute missing steps to create missing files
- If CLAUDE.md has placeholders, update them
- Re-run validation
- Do NOT proceed to Step 15 until ALL required files exist

**Only when ALL files exist:** Proceed to Step 15 (Completion Report)

</validation>

---

**FINAL STEP: You MUST complete Step 15 to finish initialization.**

---

### Step 15: Completion Report

<completion-report>

**Output comprehensive summary:**

```
Project initialized for AI-augmented development

Vendored Runtime Created:
  .claude/
    agents/       - 12 project-tailored subagents
    rules/        - constitution.md, stack.md, process.md
    skills/       - [N] stack-relevant skills
    commands/     - 8 workflow commands
    hooks/        - 5 hook scripts
    settings.json - Permissions and hook configuration
    router-rules.json - Project-specific routing

Documentation:
  docs/PRD/     - Product Requirements Documents
  docs/TRD/     - Technical Requirements Documents

State Management:
  .trd-state/   - Implementation tracking
    current.json - Current feature pointer

Tech Stack Detected:
  [summary of detected stack]

Skills Selected:
  [list of skills with confidence levels]

Next Steps:
  1. Review .claude/rules/constitution.md and customize if needed
  2. Review .claude/rules/stack.md for accuracy
  3. Create a PRD with /create-prd for new features
  4. Generate TRD with /create-trd from approved PRD
  5. Implement with /implement-trd

Commands Available:
  /create-prd     - Generate PRD from story/idea
  /refine-prd     - Iterate on existing PRD
  /create-trd     - Generate TRD from PRD
  /refine-trd     - Iterate on existing TRD
  /implement-trd  - Execute staged implementation
  /update-project - Capture learnings, update governance
  /cleanup-project - Prune CLAUDE.md and artifacts
  /fold-prompt    - Optimize context for continued work
```

</completion-report>

---

## Migration Prompt Flow

<migration-flow>

### When .claude/ directory exists:

**Present user with options:**

```yaml
Prompt: "Existing ensemble installation detected. What would you like to do?"
Options:
  1. "Replace All" - Replace entire vendored runtime with current plugin version
  2. "Preserve Rules" - Replace agents, skills, commands, hooks; keep rules/ untouched
  3. "Preserve Agents" - Replace skills, commands, hooks, rules; keep customized agents
  4. "Cancel" - Abort initialization
```

**On "Replace All":**
1. Create backup at `.claude.backup.<timestamp>/`
2. Remove existing `.claude/` directory
3. Continue with normal initialization

**On "Preserve Rules":**
1. Backup existing `.claude/rules/` to `.claude.rules.backup.<timestamp>/`
2. Remove all directories except `.claude/rules/`
3. Continue initialization, skip governance file generation (Step 4)
4. Restore rules from backup if initialization fails

**On "Preserve Agents":**
1. Backup existing `.claude/agents/` to `.claude.agents.backup.<timestamp>/`
2. Remove all directories except `.claude/agents/`
3. Continue initialization, skip agent deployment (Step 5)
4. Restore agents from backup if initialization fails

**On "Cancel":**
1. Report: "Initialization cancelled. Existing installation preserved."
2. Exit without changes

</migration-flow>

---

## Error Handling

<error-handling>

| Condition | Action |
|-----------|--------|
| Not a git repository | Warn but continue - state tracking still works |
| No package files found | Prompt for manual tech stack entry |
| Write permission denied | Report and suggest running with appropriate permissions |
| Existing .claude/ directory | Show migration prompt (see Migration Prompt Flow) |
| Formatter not installed | Show install command, continue without formatter |
| Validation fails | Report issues, suggest fixes, do not mark complete |
| Network error during skill copy | Retry 3 times, then continue without that skill |
| Invalid JSON in templates | Report error, abort initialization |

</error-handling>

---

## Notes

- This command is idempotent in "force" mode
- Constitution and stack.md are living documents - encourage regular updates
- Tech stack detection is best-effort; user should verify accuracy
- Quality gates can be adjusted as project matures
- Subagent customization is project-specific - review generated agents

---

*This command implements TRD tasks: TRD-C001 through TRD-C009*
