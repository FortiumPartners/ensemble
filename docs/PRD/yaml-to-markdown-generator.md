# Product Requirements Document: YAML-to-Markdown Command Generator

| Field | Value |
|-------|-------|
| **PRD ID** | PRD-CORE-003 |
| **Feature** | YAML-to-Markdown Command Generator |
| **Plugin** | ensemble-core |
| **Version Target** | 5.1.0 |
| **Status** | Ready for Development |
| **Created** | 2025-12-19 |
| **Last Updated** | 2025-12-19 |
| **Author** | Fortium Partners |
| **Version** | 1.1 |

---

## 1. Executive Summary

### 1.0 Key Decisions Summary

This PRD has been updated with the following decisions from user interview (2025-12-19):

| Decision Area | Resolution | Section Reference |
|---------------|------------|-------------------|
| **File Discovery** | Use plugin manifest - only process files listed in each plugin.json | 4.1 |
| **Git Strategy** | Commit generated files with "DO NOT EDIT" warnings | 4.3.1 |
| **Error Handling** | Collect all errors - process all files, report all at end, exit with error code | 4.6.3 |
| **Schema Fit** | Existing files match schema - no migration needed | 4.6.1 |
| **Frontmatter Fields** | Keep separate - commands use `allowed-tools`, agents use `tools` | 4.2.1, 4.2.2 |
| **Orphan Cleanup** | Yes, auto-cleanup - generator removes Markdown files without YAML source | 4.4 |
| **Delegation Validation** | Yes, strict validation - fail if referenced agent doesn't exist | 4.6.1 |
| **Step Numbering** | Error on gaps - fail validation if step numbers have gaps | 4.6.1 |
| **Reverse Converter** | No, out of scope - manual migration only | 3.2 |
| **v1 Scope** | Full feature set - all features including validation, generation, cleanup, watch mode, CI integration | 3.1 |

### 1.1 Problem Statement

The ensemble plugin ecosystem contains 42 YAML files (28 agents, 14 commands) that serve as the authoritative source of truth for agent definitions and commands. However, Claude Code requires Markdown format for these files to be usable. Manual conversion from YAML to Markdown results in:

1. **Significant Context Loss**: `fold-prompt.yaml` (86 lines with rich metadata, workflow phases, ordered steps, actions) became `fold-prompt.md` (36 lines with minimal context) - a 58% reduction in detail
2. **Maintenance Overhead**: Changes must be made in both YAML and Markdown, leading to drift
3. **Inconsistent Format**: Manual conversion produces inconsistent Markdown structure
4. **Lost Structured Data**: Rich metadata (version, category, lastUpdated, workflow phases, delegation context) is discarded
5. **No Single Source of Truth**: Uncertainty about which file is authoritative

### 1.2 Solution

Build a YAML-to-Markdown generator that:
- **Preserves YAML as source of truth** - All edits happen in structured YAML
- **Generates Claude Code compatible Markdown** - Automated transformation at build time
- **Preserves rich context** - Workflow phases, ordered steps, actions, delegation details included in output
- **Integrates with existing build pipeline** - npm scripts for validation and generation
- **Supports both commands and agents** - Unified generator for both file types

### 1.3 Value Proposition

| Stakeholder | Benefit |
|-------------|---------|
| **Plugin Developers** | Single source of truth, rich metadata preserved, automated generation |
| **Agent Maintainers** | No manual sync, consistent format, easier updates |
| **Plugin Users** | Better context in generated Markdown, more complete documentation |
| **CI/CD Pipeline** | Automated validation and generation, no manual conversion errors |

---

## 2. User Analysis

### 2.1 Target Users

| User Type | Description | Primary Need |
|-----------|-------------|--------------|
| **Plugin Developer** | Creates new plugins with commands/agents | Easy YAML authoring, automated Markdown generation |
| **Agent Maintainer** | Updates existing agents with new capabilities | Single file to edit, no sync overhead |
| **Build Engineer** | Manages CI/CD and release process | Reliable build-time generation, validation |
| **Plugin Consumer** | Uses generated Markdown commands in Claude Code | Rich, detailed command/agent documentation |

### 2.2 User Personas

#### Persona 1: Plugin Developer - Sarah
- Creates new ensemble plugins with specialized agents
- Wants to focus on agent behavior, not Markdown formatting
- Needs rich metadata (version, category, workflow phases) for complex agents
- Values automation and consistency
- Works in YAML because it's easier to structure complex data

**Goals:**
- Define agents/commands in YAML with full context
- Automatically generate Claude Code compatible Markdown
- Validate YAML against schemas before build
- Never manually write Markdown frontmatter

#### Persona 2: Agent Maintainer - Marcus
- Updates ensemble-orchestrator and other core agents frequently
- Frustrated by maintaining both YAML and Markdown versions
- Has accidentally created drift between YAML and Markdown
- Wants a single source of truth

**Goals:**
- Edit only YAML files
- Trust that Markdown is always up-to-date
- See rich context preserved in generated Markdown
- Automatic regeneration on file changes

#### Persona 3: Build Engineer - Jenna
- Manages the ensemble monorepo CI/CD pipeline
- Needs reliable, reproducible builds
- Wants validation before generation
- Needs clear error messages when YAML is invalid

**Goals:**
- Integrate generation into existing npm scripts
- Validate YAML schemas before generation
- Fail builds on validation errors
- Generate Markdown as part of build/publish workflow

### 2.3 Pain Points

| Pain Point | Impact | Frequency | User |
|------------|--------|-----------|------|
| Manual YAML→Markdown conversion loses context | High | Every new command/agent | All |
| Drift between YAML and Markdown versions | High | Monthly | Maintainers |
| Inconsistent Markdown structure from manual edits | Medium | Weekly | Developers |
| No validation before Markdown generation | Medium | Per build | Build Engineers |
| Unclear which file (YAML vs MD) is authoritative | High | Constant | All |
| Lost metadata (version, lastUpdated, phases) | High | Every conversion | Consumers |

### 2.4 User Journey

**Current Flow (Manual Conversion):**
1. Developer creates `fold-prompt.yaml` with 86 lines of rich context
2. Developer manually converts to `fold-prompt.md`, loses 50 lines of detail
3. Developer commits both files
4. Later, developer updates YAML but forgets to update Markdown
5. Users see outdated Markdown in Claude Code
6. Confusion about which file is authoritative

**Improved Flow (Automated Generation):**
1. Developer creates `fold-prompt.yaml` with complete metadata
2. Developer runs `npm run generate:commands` or build runs it automatically
3. Generator validates YAML against schema
4. Generator transforms to `fold-prompt.md` with preserved context
5. Generated Markdown includes workflow phases, steps, actions
6. Developer commits YAML (Markdown can be gitignored or committed)
7. Users see complete, accurate Markdown in Claude Code

---

## 3. Goals and Non-Goals

### 3.1 Goals

| Priority | Goal | Success Criteria |
|----------|------|------------------|
| **P0** | Preserve YAML as single source of truth | 100% of commands/agents edited in YAML only |
| **P0** | Generate Claude Code compatible Markdown | Generated files work in Claude Code without errors |
| **P0** | Preserve rich context from YAML | Generated Markdown contains ≥80% of YAML content |
| **P0** | Integrate with npm build scripts | `npm run generate` produces all Markdown files |
| **P0** | Auto-cleanup orphaned Markdown files | Generated Markdown files without YAML source are removed |
| **P0** | Add "DO NOT EDIT" warnings | All generated files include auto-generation warning |
| **P1** | Validate YAML before generation | Invalid YAML fails build with clear error messages |
| **P1** | Strict delegation validation | Fail if referenced agent doesn't exist in ecosystem |
| **P1** | Strict step numbering validation | Fail if step numbers have gaps (e.g., 1,2,4) |
| **P1** | Support both commands and agents | Unified generator handles both file types |
| **P1** | Generate proper frontmatter | Description, allowed-tools/tools, argument-hint, model included |
| **P1** | Collect all errors before failing | Process all files, report all errors at end, exit with error code |
| **P1** | Watch mode for development | Auto-regenerate on YAML changes during development |
| **P1** | CI integration | Automated validation and generation in GitHub Actions |
| **P2** | Support incremental generation | Only regenerate changed YAML files |
| **P2** | Provide verbose mode for debugging | `--verbose` flag shows transformation details |

### 3.2 Non-Goals

| Non-Goal | Rationale |
|----------|-----------|
| Markdown-to-YAML reverse conversion | YAML is source of truth, manual migration only (user decision) |
| Custom YAML schema per plugin | Unified schema ensures consistency |
| Support for JSON or TOML sources | YAML is ecosystem standard |
| IDE plugins or syntax highlighting | Focus on generator, not tooling |

### 3.3 Future Considerations

- **Schema versioning**: Support schema evolution over time
- **Performance optimizations**: Caching, parallel processing for very large repos

---

## 4. Functional Requirements

### 4.1 File Discovery Strategy

**Plugin Manifest-Based Discovery** (User Decision #1)

The generator uses each plugin's `plugin.json` manifest to discover YAML files:

1. **Scan Strategy**: Read all `packages/*/.claude-plugin/plugin.json` files
2. **Agent Discovery**: If `agents` field is defined, scan that directory for `*.yaml` files
3. **Command Discovery**: If `commands` field is defined, scan that directory for `*.yaml` files
4. **No Manifest**: Plugins without manifests are skipped (not an error)
5. **Invalid Paths**: Manifest paths that don't exist are reported as warnings

**Benefits:**
- Only processes files that are part of active plugins
- Respects plugin configuration
- Avoids processing orphaned or experimental YAML files
- Aligns with existing plugin architecture

### 4.2 YAML Schema

#### 4.2.1 Command Schema

**Note on Frontmatter Fields** (User Decision #5): Commands use `allowed-tools` (hyphenated) in frontmatter, while agents use `tools` (no hyphen). This is maintained as separate fields to match Claude Code expectations.

```yaml
metadata:
  name: string                    # Required: command name (e.g., "fold-prompt")
  description: string             # Required: brief description (used in frontmatter)
  version: semver                 # Required: semantic version
  lastUpdated: date               # Required: ISO 8601 date
  category: string                # Required: analysis|workflow|infrastructure|quality
  output_path: string             # Optional: override default output path
  source: string                  # Required: "fortium"
  model: string                   # Optional: Claude model (default: current model)
  allowed_tools: string[]         # Optional: List of allowed tools (used in frontmatter)

mission:
  summary: string                 # Required: Detailed mission statement (multi-line)

workflow:
  phases:                         # Required: Array of workflow phases
    - name: string                # Required: Phase name
      order: integer              # Required: Execution order
      steps:                      # Required: Array of steps
        - order: integer          # Required: Step order within phase
          title: string           # Required: Step title
          description: string     # Optional: Step description
          actions: string[]       # Optional: List of concrete actions
          delegation:             # Optional: Delegation to agent
            agent: string         # Required if delegation: Agent name
            context: string       # Optional: Context to pass

expectedOutput:
  format: string                  # Required: Output format description
  structure:                      # Optional: Array of output components
    - name: string                # Required: Component name
      description: string         # Required: Component description
```

#### 4.2.2 Agent Schema

```yaml
metadata:
  name: string                    # Required: agent name (e.g., "ensemble-orchestrator")
  description: string             # Required: brief description (used in frontmatter)
  version: semver                 # Required: semantic version
  lastUpdated: date               # Required: ISO 8601 date
  category: string                # Required: orchestrator|specialist|developer
  tools: string[]                 # Required: List of allowed tools (used in frontmatter)

mission:
  summary: string                 # Required: Core mission statement (multi-line)
  boundaries:                     # Optional: Agent boundaries
    handles: string               # Optional: What agent handles
    doesNotHandle: string         # Optional: What agent doesn't handle
    collaboratesOn: string        # Optional: Collaboration patterns
  expertise:                      # Optional: Array of expertise areas
    - name: string                # Required: Expertise area name
      description: string         # Required: Detailed description

responsibilities:                 # Required: Array of responsibilities
  - priority: high|medium|low     # Required: Priority level
    title: string                 # Required: Responsibility title
    description: string           # Required: Detailed description

examples:                         # Optional: Array of examples
  - id: string                    # Required: Example ID
    category: string              # Required: patterns|antipatterns|workflow
    title: string                 # Required: Example title
    antiPattern:                  # Optional: Anti-pattern example
      language: string            # Required: "text" or code language
      code: string                # Required: Example code/text
      issues: string[]            # Required: List of issues
    bestPractice:                 # Optional: Best practice example
      language: string            # Required: "text" or code language
      code: string                # Required: Example code/text
      benefits: string[]          # Required: List of benefits

qualityStandards:                 # Optional: Quality standards
  codeQuality:                    # Optional: Code quality standards
    - name: string                # Required: Standard name
      description: string         # Required: Standard description
      enforcement: string         # Required: required|recommended
  testing:                        # Optional: Testing standards
    [key: string]: {              # Dynamic keys (e.g., "coordination", "approval")
      minimum: number,            # Required: Minimum percentage
      description: string         # Required: Description
    }
  performance:                    # Optional: Performance standards
    - name: string                # Required: Metric name
      target: string              # Required: Target value
      unit: string                # Required: Unit of measurement
      description: string         # Required: Description

delegationCriteria:               # Optional: When to delegate to this agent
  whenToUse: string[]             # Optional: List of use cases
  whenToDelegate:                 # Optional: Delegation rules
    - agent: string               # Required: Target agent name
      triggers: string[]          # Required: List of trigger conditions
```

### 4.3 Markdown Generation Rules

#### 4.3.1 Generated File Headers (User Decision #2)

All generated Markdown files MUST include a "DO NOT EDIT" warning:

```markdown
<!--
DO NOT EDIT THIS FILE DIRECTLY
This file is auto-generated from {source_yaml_file}
Any manual edits will be overwritten on next generation.
Edit the YAML source file instead.
-->
```

**Git Strategy** (User Decision #2): Generated Markdown files are committed to the repository with the warning header. This ensures:
- Users can view Markdown in GitHub
- Claude Code plugin system works immediately
- Clear attribution to YAML source prevents manual edits

#### 4.3.2 Command Markdown Structure

**Frontmatter:**
```markdown
---
name: ensemble:{metadata.name}
description: {metadata.description}
allowed-tools: [{metadata.allowed_tools or default tools}]
argument-hint: {derived from mission.summary or default}
model: {metadata.model or omit for default}
---
```

**Body Structure:**
```markdown
<!-- DO NOT EDIT warning header -->

{mission.summary}

## Mission

{Formatted mission details}

## Workflow

{For each workflow.phases[]:}
### {phase.order}. {phase.name}

{For each phase.steps[]:}
**{step.order}. {step.title}**
{step.description}

{If step.actions:}
- {action items as bullet list}

{If step.delegation:}
**Delegation:** @{delegation.agent}
{delegation.context}

## Expected Output

**Format:** {expectedOutput.format}

{If expectedOutput.structure:}
**Structure:**
{For each structure item:}
- **{item.name}**: {item.description}

## Usage

```
/ensemble:{metadata.name} [arguments]
```
```

#### 4.3.3 Agent Markdown Structure

**Frontmatter:**
```markdown
---
name: {metadata.name}
description: {metadata.description}
tools: [{metadata.tools}]
---
```

**Body Structure:**
```markdown
<!-- DO NOT EDIT warning header -->

## Mission

{mission.summary}

{If mission.boundaries:}
## Boundaries

**Handles:** {mission.boundaries.handles}

**Does Not Handle:** {mission.boundaries.doesNotHandle}

{If mission.boundaries.collaboratesOn:}
**Collaborates On:** {mission.boundaries.collaboratesOn}

{If mission.expertise:}
## Expertise

{For each expertise[]:}
### {expertise.name}
{expertise.description}

## Responsibilities

{For each responsibilities[] grouped by priority:}
### {Priority Level} Priority

{For each responsibility at this priority:}
#### {responsibility.title}
{responsibility.description}

{If examples:}
## Examples

{For each examples[]:}
### {example.title}

{If example.antiPattern:}
**Anti-Pattern:**
```{example.antiPattern.language}
{example.antiPattern.code}
```

**Issues:**
{For each issue:}
- {issue}

{If example.bestPractice:}
**Best Practice:**
```{example.bestPractice.language}
{example.bestPractice.code}
```

**Benefits:**
{For each benefit:}
- {benefit}

{If qualityStandards:}
## Quality Standards

{Formatted quality standards sections}

{If delegationCriteria:}
## Delegation Criteria

**When to Use:**
{For each whenToUse:}
- {item}

**When to Delegate:**
{For each whenToDelegate:}
**@{agent.agent}:**
{For each trigger:}
- {trigger}
```

### 4.4 Orphan Cleanup (User Decision #6)

**Auto-Cleanup Enabled**: The generator will automatically remove Markdown files that don't have corresponding YAML sources:

1. **Tracking**: Generator maintains a set of all generated Markdown files
2. **Discovery**: After generation, scan for `*.md` files in agent/command directories
3. **Comparison**: Identify Markdown files not in the generated set
4. **Removal**: Delete orphaned Markdown files with warning log
5. **Dry-Run Support**: Show what would be deleted in `--dry-run` mode

**Example:**
```
Processing agents for ensemble-git...
  Generated: git-workflow.md (from git-workflow.yaml)
  Generated: github-specialist.md (from github-specialist.yaml)
  Orphan detected: old-agent.md (no corresponding YAML source)
  Removed: old-agent.md
```

**Safety:**
- Only removes `.md` files in directories specified by plugin manifests
- Never removes files outside plugin agent/command directories
- Logs all deletions for audit trail

### 4.5 Generator CLI Interface

#### 4.5.1 Command Interface

```bash
# Generate all commands and agents
npm run generate

# Generate only commands
npm run generate:commands

# Generate only agents
npm run generate:agents

# Generate with validation
npm run generate -- --validate

# Verbose mode
npm run generate -- --verbose

# Dry run (show what would be generated and cleaned up)
npm run generate -- --dry-run

# Generate specific file
npm run generate -- --file packages/core/commands/fold-prompt.yaml

# Watch mode for development (User Decision #10 - v1 scope)
npm run generate:watch
```

#### 4.5.2 Script Location

- **Generator script**: `scripts/generate-markdown.js`
- **Watch script**: `scripts/generate-markdown-watch.js`
- **Integration**: Update `package.json` scripts section
- **Pre-build hook**: Run generator before validation

#### 4.5.3 Output Locations

- Commands: `{yaml_directory}/{name}.md` (same directory as YAML)
- Agents: `{yaml_directory}/{name}.md` (same directory as YAML)
- Override: Use `metadata.output_path` if specified

### 4.6 Validation Requirements

#### 4.6.1 Pre-Generation Validation

1. **YAML Syntax**: Valid YAML structure
2. **Schema Compliance**: Matches command or agent schema (User Decision #4 - existing files match)
3. **Required Fields**: All required fields present
4. **Semantic Version**: Valid semver format
5. **Date Format**: ISO 8601 format for lastUpdated
6. **Tool Names**: Valid Claude Code tool names (Read, Write, Edit, Bash, Grep, Glob, Task, TodoWrite)
7. **Category Values**: Valid category from enum
8. **Phase/Step Order**: Sequential integers starting from 1, NO GAPS (User Decision #9)
9. **Delegation References**: Strict validation - fail if referenced agent doesn't exist (User Decision #7)

**Step Numbering Validation** (User Decision #9):
```javascript
// Example: Detect gaps in step order
const steps = [1, 2, 4, 5]; // Invalid - gap at 3
// Error: "Step numbering has gaps in phase 'Workflow Phase 1': expected 3, found 4"
```

**Delegation Validation** (User Decision #7):
```javascript
// Example: Verify referenced agent exists
delegation:
  agent: "non-existent-agent"
// Error: "Referenced agent 'non-existent-agent' not found in agent ecosystem"
// Build all agent references from discovered YAML files
// Validate cross-references during generation
```

#### 4.6.2 Post-Generation Validation

1. **Frontmatter Valid**: Proper YAML frontmatter structure
2. **Markdown Lint**: Basic Markdown syntax validation
3. **Claude Code Compatibility**: Generated file works in Claude Code
4. **Content Preservation**: Generated Markdown contains key YAML content
5. **DO NOT EDIT Header**: Verify warning header is present in all generated files

#### 4.6.3 Error Handling (User Decision #3)

**Collect All Errors Strategy**: Process all files, collect all errors, report at end, exit with error code if any failed.

```javascript
// Error types
class ValidationError extends Error {
  constructor(file, field, message) {
    super(`${file}: ${field} - ${message}`);
    this.file = file;
    this.field = field;
  }
}

class GenerationError extends Error {
  constructor(file, message) {
    super(`${file}: ${message}`);
    this.file = file;
  }
}

class OrphanCleanupError extends Error {
  constructor(file, message) {
    super(`${file}: ${message}`);
    this.file = file;
  }
}

// Error collection pattern
const errors = [];

// Process all files
for (const yamlFile of yamlFiles) {
  try {
    generateMarkdown(yamlFile);
  } catch (error) {
    errors.push(error);
    // Continue processing other files
  }
}

// Report all errors at end
if (errors.length > 0) {
  console.error('\n=== Generation Errors Summary ===');
  for (const error of errors) {
    console.error(`❌ ${error.message}`);
  }
  console.error(`\nTotal errors: ${errors.length}`);
  process.exit(1); // Exit with error code
}
```

### 4.7 Integration with Existing Build Pipeline

#### 4.7.1 Updated npm Scripts (User Decision #10 - v1 scope includes all features)

```json
{
  "scripts": {
    "generate": "node scripts/generate-markdown.js",
    "generate:commands": "node scripts/generate-markdown.js --type commands",
    "generate:agents": "node scripts/generate-markdown.js --type agents",
    "generate:watch": "node scripts/generate-markdown-watch.js",
    "validate": "npm run generate -- --validate && node scripts/validate-all.js",
    "prebuild": "npm run generate",
    "test": "npm run test --workspaces --if-present"
  }
}
```

#### 4.7.2 CI/CD Integration (User Decision #10 - v1 scope)

**GitHub Actions** - Automated validation and generation in CI:

```yaml
# .github/workflows/validate.yml
- name: Generate Markdown
  run: npm run generate -- --validate

- name: Validate Generated Files
  run: npm run validate

- name: Check for uncommitted changes
  run: |
    git diff --exit-code || (echo "Generated Markdown out of sync" && exit 1)
```

**Pre-commit Hook** (optional, recommended):
```bash
#!/bin/bash
# .git/hooks/pre-commit
npm run generate -- --validate
git add packages/**/agents/*.md packages/**/commands/*.md
```

---

## 5. Non-Functional Requirements

### 5.1 Performance

| Metric | Target | Measurement |
|--------|--------|-------------|
| Generation time per file | <100ms | Time from YAML read to Markdown write |
| Total generation time (all 42 files) | <5s | End-to-end script execution |
| Validation time per file | <50ms | Schema validation duration |
| Memory usage | <100MB | Peak memory during generation |

### 5.2 Reliability

| Requirement | Standard | Implementation |
|-------------|----------|----------------|
| **Zero data loss** | 100% of YAML content preserved | Test with diff comparison |
| **Idempotent generation** | Same YAML produces identical Markdown | Hash comparison on repeated runs |
| **Error recovery** | Validation errors don't corrupt files | Atomic writes (temp file + rename) |
| **Backward compatibility** | Existing YAML files generate without changes | Test against all 42 existing files |

### 5.3 Maintainability

| Requirement | Standard |
|-------------|----------|
| **Clear error messages** | File, field, and issue clearly stated |
| **Modular design** | Separate modules for parsing, validation, transformation, writing |
| **Testable** | Unit tests for each transformation function |
| **Documented** | JSDoc comments on all public functions |
| **Schema versioning** | Support schema evolution with version field |

### 5.4 Compatibility

| Requirement | Standard |
|-------------|----------|
| **Node.js version** | >=20.0.0 (matching ensemble requirement) |
| **Claude Code version** | Compatible with Claude Code 2.0+ frontmatter format |
| **Operating systems** | macOS, Linux, Windows (cross-platform paths) |
| **YAML parser** | js-yaml library (already in use) |
| **Markdown lint** | Compatible with markdownlint-cli |

### 5.5 Security

| Requirement | Implementation |
|-------------|----------------|
| **No code execution from YAML** | Parse only, never eval |
| **Path traversal prevention** | Validate output paths within plugin directories |
| **Input validation** | Sanitize all YAML inputs against schema |
| **Dependency security** | Use only trusted, maintained libraries |

---

## 6. Acceptance Criteria

### 6.1 Core Functionality

| ID | Criterion | Test Scenario | Success Metric |
|----|-----------|---------------|----------------|
| **AC-1** | Generate Markdown from command YAML | Run generator on `fold-prompt.yaml` | Valid `fold-prompt.md` with ≥80% content preserved |
| **AC-2** | Generate Markdown from agent YAML | Run generator on `ensemble-orchestrator.yaml` | Valid agent Markdown with all sections |
| **AC-3** | Validate YAML before generation | Run generator on invalid YAML | Clear error message, exit code 1 |
| **AC-4** | Generate proper frontmatter | Inspect generated Markdown | Frontmatter has name, description, tools/allowed-tools |
| **AC-5** | Preserve workflow phases | Compare YAML and generated Markdown | All phases, steps, actions present in Markdown |
| **AC-6** | Support delegation context | Generate command with delegation | Delegation section in Markdown with agent reference |
| **AC-7** | Handle optional fields | Generate with minimal YAML | Required fields only, no errors |
| **AC-8** | Batch generate all files | Run `npm run generate` | All 42 files regenerated successfully |

### 6.2 Integration

| ID | Criterion | Test Scenario | Success Metric |
|----|-----------|---------------|----------------|
| **AC-9** | Integrate with npm scripts | Run `npm run generate` | All Markdown files generated in <5s |
| **AC-10** | Pre-build hook works | Run `npm run build` | Markdown generated before validation |
| **AC-11** | CI validation passes | Push with YAML changes | CI generates and validates successfully |
| **AC-12** | Idempotent generation | Run generator twice | Identical output (hash comparison) |

### 6.3 Content Preservation

| ID | Criterion | Test Scenario | Success Metric |
|----|-----------|---------------|----------------|
| **AC-13** | Preserve rich metadata | Generate from YAML with all fields | Metadata in Markdown body (version, lastUpdated, category) |
| **AC-14** | Preserve workflow detail | Generate `fold-prompt.yaml` (86 lines) | Generated Markdown ≥60 lines (vs current 36) |
| **AC-15** | Preserve agent responsibilities | Generate `ensemble-orchestrator.yaml` | All responsibilities with priorities preserved |
| **AC-16** | Preserve examples | Generate agent with examples | Anti-patterns and best practices in Markdown |
| **AC-17** | Preserve quality standards | Generate agent with qualityStandards | Quality standards section in Markdown |

### 6.4 Error Handling

| ID | Criterion | Test Scenario | Success Metric |
|----|-----------|---------------|----------------|
| **AC-18** | Invalid YAML syntax | Run generator on malformed YAML | Clear error: "YAML syntax error at line X" |
| **AC-19** | Missing required field | Run generator on YAML without `name` | Clear error: "Missing required field: metadata.name" |
| **AC-20** | Invalid tool name | Run generator with tool "InvalidTool" | Clear error: "Invalid tool name: InvalidTool" |
| **AC-21** | Invalid category | Run generator with category "invalid" | Clear error: "Invalid category: must be analysis|workflow..." |
| **AC-22** | Error summary | Run generator with multiple errors | Summary of all errors at end |

### 6.5 CLI Interface

| ID | Criterion | Test Scenario | Success Metric |
|----|-----------|---------------|----------------|
| **AC-23** | Generate only commands | Run `npm run generate:commands` | Only command Markdown files generated |
| **AC-24** | Generate only agents | Run `npm run generate:agents` | Only agent Markdown files generated |
| **AC-25** | Verbose mode | Run with `--verbose` flag | Detailed transformation logs displayed |
| **AC-26** | Dry run mode | Run with `--dry-run` flag | Shows what would be generated, no files written |
| **AC-27** | Specific file generation | Run with `--file` flag | Only specified file generated |
| **AC-28** | Help text | Run with `--help` flag | Usage instructions displayed |

### 6.6 Backward Compatibility

| ID | Criterion | Test Scenario | Success Metric |
|----|-----------|---------------|----------------|
| **AC-29** | Existing YAML files work | Run generator on all 42 existing YAML files | All generate without errors |
| **AC-30** | Generated Markdown works in Claude Code | Load generated commands in Claude Code | Commands/agents work without errors |
| **AC-31** | No breaking changes | Compare current and generated Markdown | Claude Code functionality identical |

---

## 7. Technical Approach

### 7.1 Architecture

```
scripts/
  generate-markdown.js         # Main CLI entry point
  lib/
    yaml-parser.js             # Parse YAML files
    schema-validator.js        # Validate against schemas
    markdown-generator.js      # Generate Markdown from YAML
    command-transformer.js     # Transform command YAML → Markdown
    agent-transformer.js       # Transform agent YAML → Markdown
    file-utils.js              # File I/O utilities
    error-handler.js           # Error types and formatting
```

### 7.2 Key Modules

#### 7.2.1 yaml-parser.js

```javascript
const yaml = require('js-yaml');
const fs = require('fs');

/**
 * Parse YAML file with error handling
 * @param {string} filePath - Path to YAML file
 * @returns {object} Parsed YAML object
 * @throws {ValidationError} If YAML is invalid
 */
function parseYamlFile(filePath) {
  // Implementation
}

/**
 * Detect if YAML is command or agent type
 * @param {object} yamlObject - Parsed YAML
 * @returns {'command'|'agent'} File type
 */
function detectYamlType(yamlObject) {
  // Has workflow → command
  // Has responsibilities → agent
}
```

#### 7.2.2 schema-validator.js

```javascript
/**
 * Validate YAML against command schema
 * @param {object} yamlObject - Parsed YAML
 * @param {string} filePath - Original file path for errors
 * @throws {ValidationError} If validation fails
 */
function validateCommandSchema(yamlObject, filePath) {
  // Validate required fields
  // Validate field types
  // Validate enums (category, priority)
  // Validate semver format
  // Validate date format
  // Validate tool names
}

/**
 * Validate YAML against agent schema
 * @param {object} yamlObject - Parsed YAML
 * @param {string} filePath - Original file path for errors
 * @throws {ValidationError} If validation fails
 */
function validateAgentSchema(yamlObject, filePath) {
  // Similar to command validation
}
```

#### 7.2.3 command-transformer.js

```javascript
/**
 * Transform command YAML to Markdown
 * @param {object} yamlObject - Parsed YAML
 * @returns {string} Generated Markdown
 */
function transformCommandToMarkdown(yamlObject) {
  const frontmatter = generateCommandFrontmatter(yamlObject);
  const body = generateCommandBody(yamlObject);
  return `${frontmatter}\n${body}`;
}

function generateCommandFrontmatter(yaml) {
  // Build frontmatter YAML block
}

function generateCommandBody(yaml) {
  // Generate mission section
  // Generate workflow section with phases/steps
  // Generate expected output section
  // Generate usage section
}
```

#### 7.2.4 agent-transformer.js

```javascript
/**
 * Transform agent YAML to Markdown
 * @param {object} yamlObject - Parsed YAML
 * @returns {string} Generated Markdown
 */
function transformAgentToMarkdown(yamlObject) {
  const frontmatter = generateAgentFrontmatter(yamlObject);
  const body = generateAgentBody(yamlObject);
  return `${frontmatter}\n${body}`;
}

function generateAgentFrontmatter(yaml) {
  // Build frontmatter with name, description, tools
}

function generateAgentBody(yaml) {
  // Generate mission section
  // Generate boundaries section
  // Generate expertise section
  // Generate responsibilities by priority
  // Generate examples section
  // Generate quality standards section
  // Generate delegation criteria section
}
```

### 7.3 Schema Files

Create JSON schemas for validation:

- `schemas/command-yaml-schema.json` - Schema for command YAML files
- `schemas/agent-yaml-schema.json` - Schema for agent YAML files

These complement existing:
- `schemas/plugin-schema.json` - Plugin manifest schema
- `schemas/marketplace-schema.json` - Marketplace schema

### 7.4 Testing Strategy

```
tests/
  unit/
    yaml-parser.test.js
    schema-validator.test.js
    command-transformer.test.js
    agent-transformer.test.js
  integration/
    generate-all.test.js
    idempotency.test.js
  fixtures/
    valid-command.yaml
    valid-agent.yaml
    invalid-syntax.yaml
    missing-required-field.yaml
    invalid-tool-name.yaml
```

**Test Coverage Targets:**
- Unit tests: ≥90% coverage
- Integration tests: All 42 existing YAML files
- Edge cases: Missing optional fields, minimal YAML, maximal YAML

---

## 8. Migration Path

### 8.1 Phase 1: Generator Development (Week 1)

1. Implement YAML parser with error handling
2. Create JSON schemas for command and agent YAML
3. Implement schema validators
4. Implement command transformer
5. Implement agent transformer
6. Unit tests for all modules

### 8.2 Phase 2: Integration (Week 2)

1. Create main CLI script with argument parsing
2. Integrate with npm scripts
3. Test on all 42 existing YAML files
4. Fix any validation errors in existing YAML
5. Update documentation

### 8.3 Phase 3: CI/CD Integration (Week 2)

1. Update GitHub Actions workflow
2. Add pre-build hook for generation
3. Add validation step to CI
4. Test full CI/CD pipeline
5. Ensure generated Markdown works in Claude Code

### 8.4 Phase 4: Adoption (Week 3)

1. Update CLAUDE.md with generator usage
2. Create migration guide for plugin developers
3. Decide: gitignore generated Markdown or commit it
4. Update existing Markdown files with new generator
5. Compare old vs new Markdown for regressions

### 8.5 Rollout Strategy

**Option A: Generate and Commit**
- Pros: Users see Markdown in repo, Claude Code plugin system works immediately
- Cons: Git diffs include generated files, potential for manual edits to Markdown

**Option B: Generate at Install Time**
- Pros: Cleaner git history, no generated files in repo
- Cons: Requires post-install script, Claude Code plugin system must support

**Recommendation: Option A** - Generate and commit Markdown, add note in header "This file is auto-generated from {yaml_file}. Do not edit manually."

---

## 9. Success Metrics

### 9.1 Adoption Metrics

| Metric | Target | Measurement Method |
|--------|--------|-------------------|
| YAML-only edits | 100% of updates after migration | Git commits touching only YAML |
| Context preservation | ≥80% of YAML content in Markdown | Character count and section comparison |
| Build success rate | 100% of builds pass generation | CI/CD pipeline success rate |
| Zero drift | 0 instances of YAML/Markdown drift | Automated validation in CI |

### 9.2 Quality Metrics

| Metric | Target | Measurement Method |
|--------|--------|-------------------|
| Generated files valid | 100% pass Claude Code validation | Test all 42 generated files |
| Schema compliance | 100% of YAML files pass validation | Pre-generation validation |
| Test coverage | ≥90% unit test coverage | Jest coverage report |
| Error clarity | 100% of errors provide actionable messages | Manual review of error messages |

### 9.3 Performance Metrics

| Metric | Target | Measurement Method |
|--------|--------|-------------------|
| Generation time | <5s for all 42 files | `time npm run generate` |
| CI/CD overhead | <10s added to pipeline | GitHub Actions timing |
| Developer iteration time | <1s for single file regeneration | Local development timing |

### 9.4 Outcome Metrics

| Metric | Target | Timeline |
|--------|--------|----------|
| Reduced maintenance overhead | 50% reduction in time spent syncing YAML/MD | 3 months post-launch |
| Improved documentation quality | 80% of generated Markdown rated "complete" by users | 3 months post-launch |
| Zero manual conversions | 100% of new commands/agents use generator | Immediate |

---

## 10. Dependencies and Constraints

### 10.1 Technical Dependencies

| Dependency | Version | Purpose |
|------------|---------|---------|
| Node.js | >=20.0.0 | Runtime environment |
| js-yaml | ^4.1.0 | YAML parsing (already in ensemble) |
| ajv | ^8.12.0 | JSON schema validation (already in ensemble) |
| ajv-formats | ^3.0.1 | Date/URI format validation (already in ensemble) |

### 10.2 Ecosystem Constraints

| Constraint | Impact | Mitigation |
|------------|--------|------------|
| Claude Code frontmatter format | Must match exact format | Test with Claude Code validation |
| Existing 42 YAML files | Must generate without breaking changes | Comprehensive testing |
| Monorepo structure | Must work with npm workspaces | Test in monorepo context |
| CI/CD pipeline | Must integrate without breaking builds | Gradual rollout, feature flag |

### 10.3 Timeline Constraints

| Phase | Duration | Dependencies |
|-------|----------|--------------|
| Development | 1 week | None |
| Testing | 1 week | Development complete |
| Integration | 1 week | Testing complete |
| Rollout | 1 week | Integration complete |
| **Total** | **4 weeks** | - |

---

## 11. Open Questions

| ID | Question | Owner | Status | Resolution |
|----|----------|-------|--------|------------|
| **Q1** | Should generated Markdown files be gitignored or committed? | Product Team | ✅ Resolved | **Commit with "DO NOT EDIT" warnings** - Users can view in GitHub, Claude Code works immediately |
| **Q2** | How should we discover YAML files? | Engineering Lead | ✅ Resolved | **Use plugin manifest** - Only process files listed in plugin.json |
| **Q3** | Do we need a reverse converter (Markdown → YAML) for migration? | Engineering Lead | ✅ Resolved | **No, out of scope** - Manual migration only |
| **Q4** | Should we add a pre-commit hook to regenerate Markdown? | DevOps | ✅ Resolved | **Optional, recommended** - Included in v1 CI integration |
| **Q5** | How to handle orphaned Markdown files without YAML sources? | Product Team | ✅ Resolved | **Auto-cleanup** - Generator removes orphans automatically |
| **Q6** | Should we validate delegation references? | Tech Lead | ✅ Resolved | **Yes, strict validation** - Fail if referenced agent doesn't exist |
| **Q7** | How to handle step numbering gaps? | Tech Lead | ✅ Resolved | **Error on gaps** - Fail validation if steps not sequential |
| **Q8** | What's the v1 feature scope? | Product Team | ✅ Resolved | **Full feature set** - All features including watch mode, CI integration |
| **Q9** | How should error handling work? | Engineering Lead | ✅ Resolved | **Collect all errors** - Process all files, report all at end, exit with error code |
| **Q10** | Should commands and agents use same frontmatter field names? | Tech Lead | ✅ Resolved | **Keep separate** - Commands use `allowed-tools`, agents use `tools` |

---

## 12. Stakeholder Sign-Off

| Role | Name | Sign-Off | Date |
|------|------|----------|------|
| Product Manager | - | ☐ Pending | - |
| Tech Lead | - | ☐ Pending | - |
| Engineering Lead | - | ☐ Pending | - |
| DevOps Lead | - | ☐ Pending | - |

---

## Appendix A: Example Transformations

### A.1 Command Example: fold-prompt.yaml

**Input YAML (86 lines):**
```yaml
metadata:
  name: fold-prompt
  description: Advanced Claude environment optimization...
  version: 2.0.0
  lastUpdated: "2025-10-13"
  category: analysis

mission:
  summary: |
    Advanced Claude environment optimization...

workflow:
  phases:
    - name: Intelligent Discovery
      order: 1
      steps:
        - order: 1
          title: Deep Project Analysis
          actions:
            - Analyze codebase architecture
            - Identify documentation gaps
```

**Generated Markdown (60+ lines):**
```markdown
---
name: ensemble:fold-prompt
description: Advanced Claude environment optimization through intelligent project analysis and context management
allowed-tools: [Read, Write, Edit, Bash, Grep, Glob]
---

Advanced Claude environment optimization through intelligent project analysis, context
management, and documentation enhancement for maximum productivity gains...

## Mission

Optimize CLAUDE.md, README.md, and agent configurations for improved Claude Code performance.

## Workflow

### 1. Intelligent Discovery & Context Mapping

**1. Deep Project Analysis**
Scan directory structure with pattern recognition

- Analyze codebase architecture and technology stack
- Identify documentation gaps
- Map agent mesh integration points
...
```

**Content Preservation:**
- YAML: 86 lines with metadata, workflow, actions
- Current Manual Markdown: 36 lines (58% loss)
- Generated Markdown: 60+ lines (70% preservation)

### A.2 Agent Example: ensemble-orchestrator.yaml

**Input YAML (490 lines):**
```yaml
metadata:
  name: ensemble-orchestrator
  description: Chief orchestrator for agent mesh coordination...
  version: 2.3.0
  tools: [Read, Task, Write, Edit, Bash, Grep, Glob, TodoWrite]

mission:
  summary: |
    You are the chief orchestrator responsible for high-level request analysis...
  boundaries:
    handles: |
      Strategic request analysis, task decomposition...
    doesNotHandle: |
      Direct implementation work...
  expertise:
    - name: Strategic Request Analysis
      description: |
        Analyze user requests to determine project classification...
```

**Generated Markdown (450+ lines):**
```markdown
---
name: ensemble-orchestrator
description: Chief orchestrator for agent mesh coordination, task delegation, and conflict resolution
tools: [Read, Task, Write, Edit, Bash, Grep, Glob, TodoWrite]
---

## Mission

You are the chief orchestrator responsible for high-level request analysis and strategic delegation
across a mesh of 29 specialized agents...

## Boundaries

**Handles:** Strategic request analysis, task decomposition and classification...

**Does Not Handle:** Direct implementation work (delegate to specialists)...

## Expertise

### Strategic Request Analysis
Analyze user requests to determine project classification (development project vs individual task
vs research), scope assessment (single domain vs multi-domain vs cross-cutting concerns)...
```

**Content Preservation:**
- YAML: 490 lines with full structure
- Generated Markdown: 450+ lines (92% preservation)
- All sections preserved: Mission, Boundaries, Expertise, Responsibilities, Examples, Quality Standards, Delegation Criteria

---

## Appendix B: Schema Definitions

### B.1 Command YAML Schema

See **Section 4.1.1** for detailed command schema.

### B.2 Agent YAML Schema

See **Section 4.1.2** for detailed agent schema.

---

## Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2025-12-19 | Fortium Partners | Initial PRD creation |
| 1.1 | 2025-12-19 | Fortium Partners | Updated with user interview decisions: plugin manifest discovery, auto-cleanup orphans, strict validation (delegation & step numbering), "DO NOT EDIT" warnings, collect-all-errors strategy, full v1 feature set including watch mode and CI integration, separate frontmatter fields (allowed-tools vs tools), no reverse converter |
