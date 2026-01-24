---
name: init-project
description: Initialize project with vendored ensemble runtime for AI-augmented development
version: 1.0.0
category: scaffolding
---

> **Usage:** Invoke `/init-project` from the project root to scaffold AI-augmented development infrastructure.
> Optional hints: "minimal" (skip prompts, use defaults), "force" (overwrite existing)

---

## CRITICAL: Steps 1-14 Must Be Completed (Steps 15-16 are Optional)

**DO NOT exit early. DO NOT skip steps. This command REQUIRES steps 1-14 to complete successfully.**

The initialization is NOT complete until:
- Step 9 (Deploy Configuration Files) creates `router-rules.json`
- Step 12 (Update CLAUDE.md) updates placeholders with project information
- Step 13 (Validation) confirms ALL required files exist
- Step 14 (Completion Report) outputs the summary

Steps 15-16 are optional enhancements that improve routing but are not required for a functional installation.

**Common failure point:** Exiting after Step 8 (Deploy Hooks) leaves the project in an incomplete state without CLAUDE.md updated. YOU MUST CONTINUE through Steps 9-14.

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

**Agentic Repository Analysis**

This is a fully agentic LLM function. You (Claude) must explore the project comprehensively using your tools to understand its structure. DO NOT rely on a predefined checklist of files - instead, discover and reason about what you find.

<repository-analysis>

**Phase 1: Discover Project Structure**

Use **Glob** to discover the entire file structure:
```
**/*
```

This gives you visibility into all directories and files. Pay attention to:
- Top-level files (often contain project configuration)
- Directory names (reveal architecture: `src/`, `lib/`, `app/`, `packages/`, etc.)
- File extensions (reveal languages used)
- Configuration directories (`.github/`, `.vercel/`, `docker/`, etc.)

**Phase 2: Read and Reason About What You Find**

Based on the Glob results, read files that might indicate the technology stack. These are NOT limited to a predefined list - use your judgment:

- **Any dependency/manifest files** you discover (package.json, requirements.txt, go.mod, Cargo.toml, composer.json, Gemfile, mix.exs, pubspec.yaml, *.csproj, pom.xml, build.gradle, etc.)
- **Configuration files** that reveal frameworks or tools (next.config.*, vite.config.*, tsconfig.json, tailwind.config.*, docker-compose.yml, etc.)
- **Documentation files** that describe the project (README.md, CONTRIBUTING.md, docs/, etc.)
- **Source code samples** if dependency files are missing - infer from imports and patterns
- **Story or spec files** if present - these may describe intended technology even before implementation

**Phase 3: Reason and Infer**

As you read files, build understanding through reasoning:

1. **Primary Language(s)**: What languages are used? Look at file extensions, dependency files, and source code.

2. **Framework(s)**: What frameworks or libraries are central to the project? Reason about:
   - Direct dependencies in manifest files
   - Import statements in source code
   - Configuration files that imply frameworks
   - Directory structure patterns (e.g., `pages/` suggests Next.js or Nuxt)

3. **Testing Setup**: What testing approach is used?
   - Test directories and file naming patterns
   - Testing dependencies
   - Test configuration files

4. **Database/Data Layer**: What data storage is used?
   - Schema files (Prisma, Drizzle, migrations/)
   - Database driver dependencies
   - ORM patterns in code

5. **Infrastructure**: How is the project deployed/run?
   - Deployment config files
   - CI/CD workflows
   - Container definitions

6. **Architecture Style**: What patterns does the codebase follow?
   - Directory organization
   - Code structure (MVC, Clean Architecture, microservices, etc.)
   - Monorepo indicators (workspaces, multiple package.jsons)

**Handle Edge Cases Agentically:**

- **No dependency files found**: Read source code and infer from imports/syntax
- **Documentation only (no code)**: Infer intended stack from descriptions and stories
- **Mixed signals**: Note uncertainty and ask user for clarification in Step 2
- **Monorepo**: Explore each workspace/package to understand the full stack

**Output: Detected Stack Summary**

After your agentic exploration, synthesize your findings:
```
Primary Language: <language>
Framework: <framework>
Testing: <unit framework>, <integration framework>, <e2e framework>
Database: <database> via <orm/driver>
Infrastructure: <hosting>, <ci-cd>
Architecture: <pattern>
Confidence: <High/Medium/Low with reasoning>
```

If confidence is low for any component, note what additional information would help and prepare to ask in Step 2.

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

**Execute the scaffold script using Bash tool:**

Find the plugin path and run the scaffold script. The plugin path can be determined by:
1. Environment variable `ENSEMBLE_PLUGIN_DIR` (if set)
2. The `packages/full` directory within the ensemble-vnext project
3. The installed plugin path from `~/.claude/plugins/installed_plugins.json`

**Run the scaffold script:**
```bash
# Determine plugin path (adjust based on context)
# For ensemble-vnext development: packages/full
# For installed plugin: check ~/.claude/plugins/installed_plugins.json

PLUGIN_DIR="/path/to/packages/full"  # Set this to the actual plugin path

# Run scaffold script
"${PLUGIN_DIR}/scripts/scaffold-project.sh" --plugin-dir "$PLUGIN_DIR" .
```

The scaffold script is located at `packages/core/scripts/scaffold-project.sh` (symlinked from `packages/full/scripts/`).

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

**CRITICAL - Frontmatter Format Requirements:**

- **Never add a `tools:` line** - agents have all tools enabled by default
- **`skills:` must be single-line, comma-separated** - NOT a YAML array
  - Correct: `skills: pytest, jest, developing-with-python`
  - Wrong: `skills:\n  - pytest\n  - jest`
- Preserve the existing frontmatter structure (name, description, color, skills)

</subagent-deployment>

### Step 6: Select and Copy Skills

<skill-selection>

**Agentic Skill Selection**

This is a reasoning task, not a lookup table. You must analyze the detected stack and reason about which skills would genuinely help this specific project.

**Phase 1: Discover Available Skills**

First, explore the skill library to understand what's available:

- Use Glob to list: `@packages/skills/*/SKILL.md`
- Read the "When to Use" section of each skill to understand its purpose

**Phase 2: Reason About Skill Relevance**

For each available skill, consider:

1. **Direct Match**: Does the detected stack explicitly use this technology?
   - Example: Project has `prisma/schema.prisma` → `using-prisma` is directly relevant

2. **Complementary Value**: Would this skill help even if not explicitly used yet?
   - Example: Project uses React but no styling detected → `styling-with-tailwind` might be valuable
   - Example: Project has API but no deployment → `managing-railway` or `managing-vercel` could help

3. **Ecosystem Fit**: Does this skill fit the project's ecosystem?
   - Example: Python/FastAPI project → `pytest` is a natural fit even if not configured yet
   - Example: TypeScript project → `developing-with-typescript` provides foundational patterns

4. **Future Needs**: Based on project structure, what will likely be needed?
   - Example: Project has AI-related code → AI platform skills may be relevant
   - Example: Project has background job patterns → `using-celery` or similar may help

**Phase 3: Categorize by Confidence**

Group your selections:

- **High Confidence (Auto-include)**: Direct dependency/technology match found in codebase
- **Medium Confidence (Include with note)**: Strong ecosystem fit or likely to be needed
- **Low Confidence (Ask user)**: Tangentially related, could be useful but uncertain

**Phase 4: Handle Special Cases**

- **No clear stack detected**: Ask user what technologies they plan to use
- **Greenfield project**: Include foundational skills for stated intended stack
- **Brownfield project**: Focus on skills matching existing patterns
- **Monorepo**: Consider skills for ALL detected technology stacks

**Phase 5: Write Selection and Copy**

1. Write selected skill names to `.claude/selected-skills.txt` (one skill per line):

```
developing-with-python
pytest
using-prisma
managing-railway
```

2. Call the scaffold script to copy the selected skills:

- Copy skills: !`PLUGIN_PATH="${ENSEMBLE_PLUGIN_DIR:-${CLAUDE_PLUGIN_ROOT:-$(cat /tmp/.ensemble-test/plugin-path 2>/dev/null || jq -r '.plugins | to_entries[] | select(.key | startswith("ensemble")) | .value[0].installPath' ~/.claude/plugins/installed_plugins.json 2>/dev/null)}}"; "${PLUGIN_PATH}/scripts/scaffold-project.sh" --plugin-dir "$PLUGIN_PATH" --copy-skills .`

**Phase 6: Report to User**

Output your reasoning:

```markdown
## Skills Selected

### High Confidence (Direct Match)
- `developing-with-python` - Python 3.11 detected in pyproject.toml
- `using-prisma` - prisma/schema.prisma found

### Medium Confidence (Ecosystem Fit)
- `pytest` - Python project, standard testing approach

### Considered but Not Included
- `using-celery` - No background job patterns detected
- `managing-railway` - No deployment config found; can add later with `/add-skill`
```

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

If any are missing, re-run the scaffold (use `--force` to overwrite existing files):
```bash
PLUGIN_PATH="${ENSEMBLE_PLUGIN_DIR:-${CLAUDE_PLUGIN_ROOT:-...}}"; "${PLUGIN_PATH}/scripts/scaffold-project.sh" --plugin-dir "$PLUGIN_PATH" --force .
```

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

If any are missing, re-run the scaffold (use `--force` to overwrite existing files):
```bash
PLUGIN_PATH="${ENSEMBLE_PLUGIN_DIR:-${CLAUDE_PLUGIN_ROOT:-...}}"; "${PLUGIN_PATH}/scripts/scaffold-project.sh" --plugin-dir "$PLUGIN_PATH" --force .
```

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

**CHECKPOINT: Steps 9-11 complete. DO NOT STOP HERE. Continue with Steps 12-14.**

---

### Step 12: Update CLAUDE.md

<claude-md-update>

**Agentic CLAUDE.md Customization**

The scaffolding script created CLAUDE.md from a template. You must now UPDATE it with project-specific information by reasoning about what context would be most valuable for future development sessions.

**Phase 1: Gather Context**

Synthesize what you learned during initialization:
- Project name and purpose from README, package.json description, or user input
- The full technology stack you detected in Step 1
- Key architectural patterns you observed
- Notable project conventions or unique aspects

**Phase 2: Replace Placeholders with Reasoned Content**

Read the existing `CLAUDE.md` and replace placeholders:

| Placeholder | How to Fill |
|-------------|-------------|
| `{{PROJECT_NAME}}` | Use actual project name - infer from directory, package.json name, or README title |
| `{{PROJECT_DESCRIPTION}}` | Synthesize a clear 1-2 sentence description that captures what the project does |
| `{{STACK_SUMMARY}}` | Craft a useful summary that highlights the key technologies, not just a list |

**Phase 3: Add Project-Specific Context**

Go beyond simple placeholder replacement. If the template has sections for:
- **Key Documents**: Reference any important docs you discovered (README, architecture docs, etc.)
- **Conventions**: Note any project-specific patterns you observed
- **Entry Points**: Identify main entry points, configuration files, or key directories

**Phase 4: Verify Completeness**

After updating:
1. Read CLAUDE.md and verify no `{{...}}` placeholders remain
2. Ensure the content accurately represents the project
3. Check that the information would be genuinely helpful for future sessions
4. If anything seems incomplete or unclear, enhance it

**Quality Check:**

A good CLAUDE.md should let a future session:
- Understand what the project does
- Know what technologies are used
- Find key files and entry points
- Follow project conventions

</claude-md-update>

### Step 13: Validation

<validation>

**CRITICAL: Verify ALL required files exist before proceeding to Step 14.**

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
| `CLAUDE.md` | Step 3 (scaffold), Step 12 (update) | YES |

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
   - If placeholders exist, go back to Step 12 and update them

**If validation fails:**
- Report specific issues
- Execute missing steps to create missing files
- If CLAUDE.md has placeholders, update them
- Re-run validation
- Do NOT proceed to Step 14 until ALL required files exist

**Only when ALL files exist:** Proceed to Step 14 (Completion Report)

</validation>

---

**FINAL REQUIRED STEP: You MUST complete Step 14 to finish initialization.**

---

### Step 14: Completion Report

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

**OPTIONAL ENHANCEMENTS: Steps 15-16 improve routing but are not required.**

---

### Step 15: Generate Project Router Rules (Optional Enhancement)

> **Note:** Steps 15-16 are optional enhancements. If the session ends here,
> the project initialization is still complete and functional.

<router-rules-generation>

**After all critical setup is complete, run generate-project-router-rules:**

Invoke `/generate-project-router-rules` to create project-specific routing patterns.

This command analyzes the project structure and creates routing rules in `.claude/router-rules.json` that help the Router hook route prompts to appropriate commands, skills, and agents.

</router-rules-generation>

### Step 16: Keyword Mapping Report (Optional)

> **Note:** This step is optional. If skipped, there is no impact on functionality.

<keyword-mapping-report>

**If router-rules.json was generated in Step 15, output a summary showing:**

1. **Keywords that route to specific agents:**
   - List keywords/patterns and their target agents
   - Example: `"database"` → `backend-implementer`

2. **Keywords that trigger specific skills:**
   - List keywords/patterns and their target skills
   - Example: `"railway deploy"` → `managing-railway`

3. **Project-specific patterns detected:**
   - Framework-specific routing (e.g., React components → `frontend-implementer`)
   - Technology-specific triggers (e.g., Prisma → `using-prisma` skill)

**Example Output Format:**

```
Keyword Mapping Summary:

Agent Routing:
  "api", "endpoint", "database" → backend-implementer
  "component", "ui", "style" → frontend-implementer
  "deploy", "ci", "pipeline" → cicd-specialist

Skill Triggers:
  "prisma", "schema" → using-prisma
  "railway", "deploy" → managing-railway
  "react", "component" → developing-with-react

Project-Specific Patterns:
  - Next.js detected: "page", "layout" → frontend-implementer
  - PostgreSQL detected: "migration" → using-prisma skill
```

</keyword-mapping-report>

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
2. Remove existing `.claude/` directory (or use `--force` flag with scaffold)
3. Continue with normal initialization

**Important:** If you cannot delete the directory first, use `--force`:
```bash
"${PLUGIN_DIR}/scripts/scaffold-project.sh" --plugin-dir "$PLUGIN_DIR" --force .
```

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
