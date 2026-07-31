---
name: ensemble:implement-bead
description: Implement a single beads task by ID through analysis, implementation, and PR creation
version: 1.0.0
category: implementation
last-updated: 2026-03-29
allowed-tools: Read, Write, Edit, Bash, Grep, Glob, Task
argument-hint: <bead-id>
model: sonnet
---
<!-- DO NOT EDIT - Generated from implement-bead.yaml -->
<!-- To modify this file, edit the YAML source and run: npm run generate -->


Implement a single beads task identified by its bead ID. Fetches bead details,
optionally creates a feature branch, analyses the codebase, implements the required
changes, runs tests, then closes the bead and optionally creates a pull request.

Two execution modes:
- Default (standalone): creates its own branch and PR — for direct single-task use.
- Orchestrated (--orchestrated --branch <name>): skips branch/PR creation, executes
  on a supervisor-owned branch — for use by implement-trd-beads TRD supervisor.

Designed for focused single-task execution — use /ensemble:beads-build for
multi-task epic-level orchestration. Records all state transitions in beads
for cross-session visibility.

Key behaviors:
- Validates bead exists and is not already closed before starting
- Warns (does not halt) on dirty working directory in standalone mode
- In standalone mode: derives branch name from bead title with bead/<ID>- prefix
- In orchestrated mode: uses the supervisor-owned branch passed via --branch
- Marks bead in_progress before implementing; closed on success
- Records br comments at each state transition
- In standalone mode: creates PR via gh pr create on completion
- In orchestrated mode: supervisor owns PR creation — worker does NOT create PRs

## Workflow

### Phase 1: Preflight

**1. Argument Parsing**
   Extract bead ID from arguments or prompt user if missing

   - Parse $ARGUMENTS: extract first token as BEAD_ID (e.g., "beads-042" or "42"); if $ARGUMENTS is empty, prompt user: "Please provide a bead ID (e.g., beads-042):" and store response as BEAD_ID
   - Normalise BEAD_ID: if numeric only (e.g., "42"), leave as-is — br accepts bare integers; store original input as BEAD_ID_RAW
   - Detect orchestrated mode: if "--orchestrated" is present in $ARGUMENTS: set ORCHESTRATED=true
   - If ORCHESTRATED=true: extract the value after "--branch" in $ARGUMENTS as ORCHESTRATED_BRANCH (required — supervisor must pass it). If --branch is missing: print "ERROR: --orchestrated requires --branch <branch-name> argument." and EXIT. Example: "--orchestrated --branch feat/trd-001-phase-1"
   - If ORCHESTRATED is not set: set ORCHESTRATED=false; ORCHESTRATED_BRANCH = ""
   - Print: "Mode: <standalone|orchestrated> | Bead: <BEAD_ID>"

**2. Tool Availability Check**
   Verify br is installed and functional

   - "which br || { echo 'ERROR: br (beads_rust) not installed. Install from https://github.com/Dicklesworthstone/beads_rust'; exit 1; }"
   - "br list --status=open > /dev/null 2>&1 || { echo 'ERROR: br not functional — check beads store'; exit 1; }"

**3. Bead Validation**
   Fetch bead details and verify it is actionable

   - Run: br show <BEAD_ID> — if exit code != 0 print "ERROR: Bead <BEAD_ID> not found." and EXIT

**4. Working Directory Check**
   Check for a dirty working directory and warn if found (standalone mode only)

   - If ORCHESTRATED=true: skip this step — supervisor manages working directory state
   - If ORCHESTRATED=false:
   -   Run: git status --porcelain
   -   If output is non-empty: print "WARNING: Working directory has uncommitted changes. Proceeding anyway — stage or stash if you want a clean baseline." (do NOT halt)

### Phase 2: Branch

**1. Feature Branch Creation**
   Derive branch name from bead title and create or switch to it (standalone mode only)

   - If ORCHESTRATED=true: skip this phase — supervisor owns the branch. Print "Branch: using supervisor-owned branch (<ORCHESTRATED_BRANCH>)" and proceed to Analyse.
   - If ORCHESTRATED=false:
   -   Derive BRANCH_NAME: take BEAD_TITLE, lowercase, replace spaces and non-alphanumeric characters with hyphens, collapse consecutive hyphens, strip leading/trailing hyphens; prepend "bead/<BEAD_ID>-"; example: "bead/42-fix-auth-timeout"
   -   Run: git branch --list <BRANCH_NAME>
   -   If branch already exists: run git switch <BRANCH_NAME> and print "Switched to existing branch: <BRANCH_NAME>"
   -   If branch does not exist: run git town hack <BRANCH_NAME>; if git-town unavailable (exit code != 0) fallback to git switch -c <BRANCH_NAME>; print "Created branch: <BRANCH_NAME>"

### Phase 3: Execute

**1. Delegate to implement-bead-worker**
   Core lifecycle runs in the shared worker command. Invoke it directly — Task() subagent_type requires a real agent, not a command. Branch already created/switched in Branch phase.

   - If ORCHESTRATED=true: set WORKER_BRANCH=<ORCHESTRATED_BRANCH>
   - If ORCHESTRATED=false: set WORKER_BRANCH=<BRANCH_NAME>
   - Invoke: /ensemble:implement-bead-worker <BEAD_ID> --branch <WORKER_BRANCH>
   - Wait for the command to complete and capture its response
   - The worker handles: mark in_progress, codebase analysis, specialist delegation, test validation, commit, and bead close — all modes go through the same worker

### Phase 4: Complete

**1. Create Pull Request**
   Push branch and create PR (standalone mode only; orchestrated mode supervisor owns PR)

   - If ORCHESTRATED=true: skip this step — supervisor owns PR creation. Print "Bead <BEAD_ID> complete (orchestrated). Supervisor will create PR."
   - If ORCHESTRATED=false:
   -   Run: git push -u origin <BRANCH_NAME>
   -   Run: gh pr create --title "<BEAD_TITLE>" --body "$(cat <<EOF\n## Bead\n<BEAD_ID>: <BEAD_TITLE>\n\n## Description\n<BEAD_DESCRIPTION>\n\n## Changes\n<summary of files changed and what was implemented>\n\n## Test Plan\n<what was tested>\n\nCloses bead <BEAD_ID>\n\nGenerated with [Ensemble implement-bead](https://github.com/FortiumPartners/ensemble)\nEOF\n)"
   -   Extract PR URL from gh output
   -   Run: br comment add <BEAD_ID> "status:closed agent:implement-bead mode:standalone pr:<PR_URL>"
   -   Print: "Bead <BEAD_ID> complete. PR: <PR_URL> | Branch: <BRANCH_NAME>"

## Expected Output

**Format:** Pull Request (standalone) or completion block (orchestrated)

**Structure:**
- **Git Branch**: Feature branch following bead/<ID>-<slug> convention (standalone mode only)
- **Code Changes**: Implementation of the bead with test coverage
- **Closed Bead**: Bead status updated to closed with completion comments
- **Pull Request**: PR with bead title, description, and changes summary (standalone mode only; orchestrated mode prints completion block and supervisor creates PR)

## Usage

```
/ensemble:implement-bead <bead-id>
```
