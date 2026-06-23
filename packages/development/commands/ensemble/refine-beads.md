---
name: ensemble:refine-beads
description: Approval-gated Beads graph refinement before execution
version: 1.0.0
category: implementation
last-updated: 2026-06-18
allowed-tools: Bash, Read
argument-hint: [epic-id|release-train-id|slug] [--scope project]
model: sonnet
---
<!-- DO NOT EDIT - Generated from refine-beads.yaml -->
<!-- To modify this file, edit the YAML source and run: npm run generate -->


Refine a Beads dependency graph before execution. The command analyzes a selected
epic/release-train subtree by default, or the whole project when --scope project is
explicitly supplied. It detects hierarchy gaps, dependency issues, PR-boundary
mismatches, missing requirement/AC traceability, duplicate tasks, and priority/order
contradictions. Analysis is read-only until the user approves selected fixes.

All Beads updates use br. Graph analysis uses only bv --robot-* flags; never run
bare interactive bv. This command uses beads-scaffold-specialist semantics for
graph audit/repair work rather than backend-developer. It never executes implementation work,
tests, builders, reviewers, branches, commits, or PR creation.

## Workflow

### Phase 1: Preflight

**1. Argument Parsing**
   Parse scope and mode from arguments

   - Parse $ARGUMENTS. If --scope project is present, set SCOPE_MODE=project and warn: "Project scope may affect unrelated epics."
   - Otherwise extract first token as SCOPE_QUERY. It may be an epic ID, release train ID, or slug pattern.
   - If no SCOPE_QUERY and SCOPE_MODE is not project, prepare to list candidate open epics/release trains and ask the user to select one.

**2. Tool Availability Check**
   Verify br and detect bv without launching interactive tools

   - Run: which br || { echo "ERROR: br (beads_rust) not installed."; exit 1; }
   - Run: br list --status=open > /dev/null 2>&1 || { echo "ERROR: br not functional — check beads store."; exit 1; }
   - Run: which bv && BV_AVAILABLE=true || { echo "WARNING: bv unavailable; br-only analysis will run."; BV_AVAILABLE=false; }

**3. Scope Resolution**
   Resolve exactly one subtree scope or explicit project scope

   - Run: br list --json and capture ISSUE_JSON. This is read-only.
   - If SCOPE_MODE=project: continue with all issues and include affected epic/release-train context in every finding where possible.
   - If SCOPE_QUERY is empty: list open epic/release-train candidates from ISSUE_JSON and ask the user to select one; store selected bead ID as SCOPE_QUERY.
   - Run: node packages/development/lib/beads-refine-cli.js analyze --issues-json <ISSUE_JSON_FILE> --query <SCOPE_QUERY> only for scope validation; if zero or multiple matches, print candidates and HALT.

### Phase 2: Read-Only Graph Analysis

**1. Sync Before Graph Analysis**
   Flush Beads state before bv reads it

   - Run: br sync --flush-only

**2. Robot Graph Analysis**
   Collect bv robot outputs without running bare bv

   - If BV_AVAILABLE=true: run bv --robot-insights and capture JSON/text output. Do not run bare bv.
   - If BV_AVAILABLE=true: run bv --robot-plan and capture JSON/text output. Do not run bare bv.
   - If BV_AVAILABLE=true and supported: run bv --robot-alerts or bv --robot-suggest. Do not run bare bv.
   - If any bv --robot-* call fails, warn and continue with br-derived findings.

**3. Finding Detection**
   Detect graph, hierarchy, PR-boundary, traceability, duplicate, and order issues

   - Run: node packages/development/lib/beads-refine-cli.js analyze --issues-json <ISSUE_JSON_FILE> [--bv-json <BV_JSON_FILE>] [--query <SCOPE_QUERY>|--scope project] and capture FINDINGS_JSON.
   - Findings MUST include affected bead IDs, severity, issue type, recommendation, and source (br, bv, or derived).
   - Detect cycles, stale blockers, missing blockers, contradictory priority/order recommendations, orphaned tasks, missing parent/child links, PR-boundary mismatches, missing PR metadata, missing requirement/AC traceability, missing requirement detail, duplicate or near-duplicate tasks.
   - No br update, br dep add, br dep remove, br close, branch, test, builder, reviewer, or implementation command may run in this phase.

**4. Generate Repair Plan**
   Convert findings into approval-gated br repair commands

   - Run: node packages/development/lib/beads-refine-cli.js plan --findings <FINDINGS_JSON_FILE> and capture REPAIR_PLAN.
   - Each repair plan entry must include finding ID, proposed br command(s), expected graph effect, verification spec, risk, and inverse commands when available.
   - If a finding requires user resolution, the repair plan entry must be marked skipped/manual and must not include executable br commands.

### Phase 3: Approval and Repair Planning

**1. Present Findings and Proposed Fixes**
   Show consolidated findings before any mutation

   - Group findings by issue type. For each finding print finding ID, severity, affected bead IDs, recommendation, proposed br command(s) from REPAIR_PLAN, and expected graph effect.
   - If no findings are detected: print "Graph is refinement-ready" and suggest /ensemble:beads-plan or /ensemble:beads-build; then run br sync --flush-only and exit.

**2. User Approval**
   Apply only explicitly approved fixes

   - Ask user to approve none, selected fix IDs, or all non-dependency fixes.
   - If the user selects all and any fix contains br dep add or br dep remove, ask a separate explicit confirmation before dependency commands run.
   - For cycles or contradictory dependency recommendations, ask the user how to resolve: retry with chosen edge, skip, reverse selected edge, or abort.
   - If the user does not choose a cycle/contradiction resolution, skip or block the affected fix. Never guess.

### Phase 4: Apply Approved Repairs

**1. Ordered br Repair Plan**
   Execute approved br commands one at a time

   - Run: br sync --flush-only before applying fixes.
   - Print the ordered repair plan.
   - For each approved fix, run exactly one br command at a time. Supported mutations include br comments add, br update, br dep add, and br dep remove as generated by the repair plan.
   - After each successful br command, run node packages/development/lib/beads-refine-cli.js verify with the verification spec for that fix. Continue only if verification passes.

**2. Failure Recovery**
   Stop on failure and ask user how to proceed

   - If a br command fails, stop applying further fixes immediately.
   - Report failed command, stdout/stderr summary, fix ID, and progress count.
   - Offer recovery choices: retry failed command, skip failed fix, print/run inverse commands when possible, cancel remaining fixes, or abort.
   - Do not run remaining fixes before the user chooses a recovery option.

### Phase 5: Post-Repair Validation and Handoff

**1. Sync and Revalidate**
   Persist successful changes and rerun graph validation

   - If at least one fix succeeded, run br sync --flush-only.
   - If BV_AVAILABLE=true, rerun bv --robot-insights and bv --robot-plan. Do not run bare bv.
   - Summarize remaining cycles, blockers, hierarchy gaps, and risks.

**2. Final Refinement Summary**
   Print concise summary and next steps

   - Print counts: findings found, fixes approved, fixes applied, fixes skipped, failed fixes, and remaining graph issues.
   - If dependency updates were applied, list each changed dependency edge with source and target bead IDs.
   - Print next steps: /ensemble:beads-plan <scope> or /ensemble:beads-build <scope>.
   - Run: br sync --flush-only before exit.

## Expected Output

**Format:** Findings, approval prompts, applied repair report, and graph revalidation summary

**Structure:**
- **Findings**: Grouped issue findings with affected bead IDs and recommendations
- **Proposed Fixes**: br repair commands with expected graph effect and verification plan
- **Final Summary**: Counts for findings, approved/applied/skipped/failed fixes, remaining risks, and next steps

## Usage

```
/ensemble:refine-beads [epic-id|release-train-id|slug] [--scope project]
```
