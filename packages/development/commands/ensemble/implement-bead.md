---
name: ensemble:implement-bead
description: Implement a single beads task by ID through analysis, implementation, and PR creation
version: 1.0.0
category: implementation
last-updated: 2026-03-29
allowed-tools: Read, Write, Edit, Bash, Grep, Glob, Task
argument-hint: <bead-id>
---
<!-- DO NOT EDIT - Generated from implement-bead.yaml -->
<!-- To modify this file, edit the YAML source and run: npm run generate -->


Implement a single beads task identified by its bead ID. Fetches bead details,
creates a feature branch, analyses the codebase, implements the required changes,
runs tests, then closes the bead and creates a pull request.

Designed for focused single-task execution — use /ensemble:beads-build for
multi-task epic-level orchestration. Records all state transitions in beads
for cross-session visibility.

Key behaviors:
- Validates bead exists and is not already closed before starting
- Warns (does not halt) on dirty working directory
- Derives branch name from bead title with bead/<ID>- prefix
- Marks bead in_progress before implementing; closed on success
- Records br comments at each state transition
- Creates PR via gh pr create on completion

## Workflow

### Phase 1: Preflight

**1. Argument Parsing**
   Extract bead ID from arguments or prompt user if missing

   - Parse $ARGUMENTS: extract first token as BEAD_ID (e.g., "beads-042" or "42"); if $ARGUMENTS is empty, prompt user: "Please provide a bead ID (e.g., beads-042):" and store response as BEAD_ID
   - Normalise BEAD_ID: if numeric only (e.g., "42"), leave as-is — br accepts bare integers; store original input as BEAD_ID_RAW

**2. Tool Availability Check**
   Verify br is installed and functional

   - "which br || { echo 'ERROR: br (beads_rust) not installed. Install from https://github.com/Dicklesworthstone/beads_rust'; exit 1; }"
   - "br list --status=open > /dev/null 2>&1 || { echo 'ERROR: br not functional — check beads store'; exit 1; }"

**3. Bead Validation**
   Fetch bead details and verify it is actionable

   - Run: br show <BEAD_ID> — if exit code != 0 print "ERROR: Bead <BEAD_ID> not found." and EXIT
   - Parse bead fields from output: store BEAD_TITLE, BEAD_STATUS, BEAD_TYPE, BEAD_DESCRIPTION
   - If BEAD_STATUS == "closed": print "Bead <BEAD_ID> is already closed." and EXIT
   - Print bead summary: "Bead: <BEAD_ID> | Status: <BEAD_STATUS> | Type: <BEAD_TYPE> | Title: <BEAD_TITLE>"

**4. Working Directory Check**
   Check for a dirty working directory and warn if found

   - Run: git status --porcelain
   - If output is non-empty: print "WARNING: Working directory has uncommitted changes. Proceeding anyway — stage or stash if you want a clean baseline." (do NOT halt)

### Phase 2: Branch

**1. Feature Branch Creation**
   Derive branch name from bead title and create or switch to it

   - Derive BRANCH_NAME: take BEAD_TITLE, lowercase, replace spaces and non-alphanumeric characters with hyphens, collapse consecutive hyphens, strip leading/trailing hyphens; prepend "bead/<BEAD_ID>-"; example: "bead/42-fix-auth-timeout"
   - Run: git branch --list <BRANCH_NAME>
   - If branch already exists: run git switch <BRANCH_NAME> and print "Switched to existing branch: <BRANCH_NAME>"
   - If branch does not exist: run git town hack <BRANCH_NAME>; if git-town unavailable (exit code != 0) fallback to git switch -c <BRANCH_NAME>; print "Created branch: <BRANCH_NAME>"

### Phase 3: Analyse

**1. Mark In-Progress**
   Transition bead to in_progress state and record agent comment

   - Run: br update <BEAD_ID> --status=in_progress
   - Run: br comment add <BEAD_ID> "status:in_progress agent:implement-bead branch:<BRANCH_NAME>"

**2. Codebase Analysis**
   Read bead description and search codebase for relevant files

   - Read full bead description and any existing comments via br show <BEAD_ID>
   - Extract keywords from BEAD_TITLE and BEAD_DESCRIPTION (nouns, domain terms, file hints)
   - Search codebase with Grep and Glob using extracted keywords to locate relevant source files, test files, and configuration
   - Identify framework and language from package.json, mix.exs, Gemfile, or *.csproj as applicable
   - Identify related test files matching the source files found
   - Print an implementation plan: files to modify, approach, test strategy, and any edge cases

### Phase 4: Implement

**1. Execute Implementation**
   Implement the changes required by the bead

   - Select appropriate specialist by keyword matching against BEAD_TITLE and BEAD_DESCRIPTION:
   -   backend/api/endpoint/database/server/model/migration -> @backend-developer
   -   frontend/ui/component/react/vue/angular/svelte/css -> @frontend-developer
   -   infra/deploy/docker/k8s/kubernetes/aws/cloud/terraform -> @infrastructure-developer
   -   architecture/design/system/multi-component/cross-cutting -> @tech-lead-orchestrator
   -   default -> @backend-developer
   - Delegate implementation via Task(subagent_type=<specialist>, prompt="Implement bead <BEAD_ID>: <BEAD_TITLE>. Description: <BEAD_DESCRIPTION>. Target files: <relevant_files>. When done provide a structured summary: files changed, what was implemented, any issues encountered.")

**2. Test Validation**
   Run relevant tests and fix failures before proceeding

   - Detect test framework from package.json, mix.exs, Gemfile, or *.csproj
   - Run test suite (npm test, mix test, bundle exec rspec, dotnet test, or detected equivalent)
   - If tests fail: analyse failure output, attempt targeted fixes, re-run tests (max 2 attempts)
   - If tests still fail after 2 attempts: print test failure details and HALT — do not close bead or create PR

### Phase 5: Complete

**1. Commit Changes**
   Stage and commit changes with conventional commit message referencing bead ID

   - Run: git status to review changed files
   - Stage specific changed files (never use git add . or git add -A)
   - Generate commit message using conventional commit format: "feat: <BEAD_TITLE> [bead:<BEAD_ID>]" or "fix: <BEAD_TITLE> [bead:<BEAD_ID>]" depending on bead type
   - Run: git commit -m "<message>"

**2. Close Bead**
   Transition bead to closed state and record completion comment

   - Run: br update <BEAD_ID> --status=closed
   - Run: br comment add <BEAD_ID> "status:closed agent:implement-bead pr:pending"
   - Run: br sync --flush-only

**3. Create Pull Request**
   Push branch and create PR with bead title and description

   - Run: git push -u origin <BRANCH_NAME>
   - Generate PR body referencing bead ID, title, description, and files changed
   - Run: gh pr create --title "<BEAD_TITLE>" --body "$(cat <<EOF\n## Bead\n<BEAD_ID>: <BEAD_TITLE>\n\n## Description\n<BEAD_DESCRIPTION>\n\n## Changes\n<summary of files changed and what was implemented>\n\n## Test Plan\n<what was tested>\n\nCloses bead <BEAD_ID>\n\nGenerated with [Ensemble implement-bead](https://github.com/FortiumPartners/ensemble)\nEOF\n)"
   - Extract PR URL from gh output
   - Run: br comment add <BEAD_ID> "status:closed agent:implement-bead pr:<PR_URL>"
   - Print: "Bead <BEAD_ID> complete. PR: <PR_URL> | Branch: <BRANCH_NAME>"

## Expected Output

**Format:** Pull Request

**Structure:**
- **Git Branch**: Feature branch following bead/<ID>-<slug> convention
- **Code Changes**: Implementation of the bead with test coverage
- **Closed Bead**: Bead status updated to closed with completion comments
- **Pull Request**: PR with bead title, description, and changes summary

## Usage

```
/ensemble:implement-bead <bead-id>
```
