---
name: ensemble:fold-prompt
description: Optimize CLAUDE.md for token efficiency, standards discovery, and progressive context loading
version: 2.0.1
category: analysis
last-updated: 2026-05-31
---
<!-- DO NOT EDIT - Generated from fold-prompt.yaml -->
<!-- To modify this file, edit the YAML source and run: npm run generate -->


Analyze a project's codebase to extract coding conventions, optimize CLAUDE.md for minimal
token cost and maximum AI productivity, and organize context with progressive disclosure.
Every token in CLAUDE.md is loaded every session -- this command ensures none are wasted.

## Workflow

### Phase 1: Codebase Standards Discovery

**1. Detect Technology Stack**
   Identify languages, frameworks, package managers, and build tools

   - Read package.json, Gemfile, requirements.txt, go.mod, mix.exs, *.csproj, or equivalent
   - Identify primary language(s) and framework(s) (e.g., Next.js 14, Rails 7, Phoenix 1.7)
   - Detect test framework(s) and runner commands
   - Detect linter/formatter config (.eslintrc, .prettierrc, rustfmt.toml, .rubocop.yml)
   - Note monorepo structure if present (workspaces, packages/, apps/)

**2. Extract Coding Conventions**
   Mine the codebase for patterns that an AI assistant must follow

   - Sample 5-10 representative source files to detect naming conventions (camelCase vs snake_case, file naming)
   - Check for barrel exports, path aliases, import ordering conventions
   - Identify error handling patterns (Result types, try/catch style, custom error classes)
   - Detect API patterns (REST routes, GraphQL resolvers, RPC definitions)
   - Read existing CONTRIBUTING.md, .editorconfig, or style guides if present
   - Check commit history for conventional commit usage and scope patterns

**3. Build Standards Index**
   Create a compact index of discovered standards for token-efficient reference

   - Compile findings into a standards index -- one line per standard, format "standard-name: brief description"
   - Group standards by category (naming, testing, imports, error-handling, git)
   - Keep each entry under 80 characters -- the index is a lookup table, not documentation
   - If the project already has a .ensemble/standards.yml or similar, merge rather than replace

### Phase 2: CLAUDE.md Structure Optimization

**1. Audit Current CLAUDE.md**
   Measure token cost and identify bloat in the existing file

   - Read the current CLAUDE.md (or note its absence)
   - Identify prose paragraphs that can be converted to bullet points (3:1 compression typical)
   - Flag duplicated information (same command listed in multiple places)
   - Flag inlined reference material that belongs in separate files (long API docs, full schema definitions)
   - Estimate token count -- target under 2000 tokens for the core file

**2. Write Quick Reference Header**
   Put the most-used information in the first 20 lines

   - Create a Quick Reference section at the very top with: essential commands (build, test, lint, run), key paths (src/, tests/, config), and branch/deploy conventions
   - Use a markdown table for commands (columns: command, what it does) -- scannable and compact
   - Include the tech stack one-liner (e.g., "Next.js 14 + Prisma + PostgreSQL + Jest")
   - Add test run command prominently -- this is the single most-used command by AI assistants

**3. Write Standards Section**
   Inject the discovered coding conventions

   - Add a "## Coding Standards" section with the standards index from Phase 1
   - Use bullet points, not paragraphs -- each standard is one line
   - Include concrete examples only for non-obvious conventions (e.g., "Error classes extend AppError, not Error")
   - Omit standards that match language defaults (don't document that Python uses snake_case)

**4. Organize with Progressive Disclosure**
   Move detailed reference material out of CLAUDE.md into pointed-to files

   - Keep in CLAUDE.md only what applies to every session (commands, standards, architecture overview)
   - Move framework-specific patterns to .claude/patterns/<framework>.md and add a one-line pointer
   - Move agent delegation details to .claude/agents.md if they exceed 10 lines
   - Move API documentation references to .claude/api-guide.md
   - Use this pointer format: '> See .claude/patterns/react.md for component patterns'
   - Verify all pointed-to files exist after reorganization

### Phase 3: Context Budget and Freshness

**1. Add Context Budget Guidance**
   Help future sessions manage context consumption

   - Add a "## Context Notes" section at the bottom of CLAUDE.md
   - Include rule: 'For tasks touching >5 files, use Task tool to delegate to a subagent with scoped context'
   - Include rule: 'Prefer reading specific file sections (offset/limit) over full files for files >200 lines'
   - Include rule: 'When context exceeds 60%, suggest splitting into a new session with a handoff summary'
   - Keep this section under 5 bullet points -- it's guidance, not a manual

**2. Remove Context Rot**
   Strip outdated or low-value content

   - Remove TODO items older than 30 days that are still in CLAUDE.md
   - Remove references to deleted files, removed dependencies, or deprecated APIs
   - Remove "nice to know" information that doesn't change AI behavior (project history, team bios)
   - Verify all file paths mentioned in CLAUDE.md still exist on disk
   - Check that all listed commands actually work (run them if possible)

### Phase 4: Validation and Report

**1. Validate Output**
   Verify the optimized CLAUDE.md meets quality gates

   - Confirm Quick Reference section is in the first 20 lines
   - Confirm no prose paragraphs longer than 3 lines (convert to bullets)
   - Confirm all file path references resolve to existing files
   - Confirm standards section exists and has at least 3 entries
   - Run project's lint/test command to verify documented commands work

**2. Report Changes**
   Summarize what was done and the token impact

   - Print a summary: files modified, standards discovered, estimated token savings
   - List any files created in .claude/ for progressive disclosure
   - Flag any conventions that were ambiguous or need human confirmation
   - Suggest next steps (e.g., "Review .claude/patterns/react.md for accuracy")

## Expected Output

**Format:** Optimized CLAUDE.md with supporting reference files

**Structure:**
- **CLAUDE.md**: Token-optimized with quick reference header, standards index, progressive disclosure pointers, and context budget guidance
- **.claude/patterns/*.md**: Framework-specific patterns extracted from CLAUDE.md for selective loading
- **.claude/standards-index.yml**: Machine-readable standards index (standard-name, one-line description, category)
- **Change Report**: Summary of modifications, token savings estimate, and items needing human review

## Usage

```
/ensemble:fold-prompt
```
