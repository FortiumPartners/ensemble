---
name: ensemble-check-feature-drift
description: Detect drift between a PRD's acceptance criteria and its generated Gherkin feature files (Codex skill for /ensemble:check-feature-drift)
user-invocable: true
argument-hint: '[prd-path] [--out <dir>]'
model: gpt-5.1-codex
---

# Ensemble Command: /ensemble:check-feature-drift

This Codex skill mirrors the Ensemble slash command `/ensemble:check-feature-drift`.
Follow the workflow below, adapt to the current repository, and keep outputs structured.

<!-- DO NOT EDIT - Generated from check-feature-drift.yaml -->
<!-- To modify this file, edit the YAML source and run: npm run generate -->


Re-parse a PRD and compare its current acceptance criteria against the
.prd-trace.json manifest produced by /ensemble:generate-feature-tests. Reports
ADDED acceptance criteria with no feature scenario, REMOVED criteria whose
feature scenario is now orphaned, and CHANGED criteria whose wording has
materially diverged from the generated feature. This makes requirement/test
traceability continuous rather than a one-time snapshot, and the CLI exit code
(0 in-sync, 2 drift) lets the same check run as a CI or pre-commit gate.

## Workflow

### Phase 1: Check

**1. Resolve the PRD path**
   Determine which PRD to check

   - If the user passed a PRD path argument, use it
   - Otherwise look under docs/PRD/ and ask the user which PRD to check if ambiguous

**2. Run the drift check**
   Invoke the deterministic CLI to diff the PRD against its manifest

   - Resolve PRD_CLI to first existing path among: ${CLAUDE_PLUGIN_ROOT}/lib/prd-cli.js, packages/product/lib/prd-cli.js. If missing, print error and HALT.
   - Run: node "$PRD_CLI" check-drift <prd-path> --json
   - Pass through --out <dir> (default: features/) so the correct manifest is located
   - Interpret exit code: 0 = IN_SYNC, 2 = drift detected, 1 = no manifest yet

**3. Report and recommend**
   Explain the drift and the path back to sync

   - If IN_SYNC: confirm the feature files match the PRD
   - If ADDED/REMOVED/CHANGED: list the affected AC ids under each category
   - If no manifest exists: tell the user to run /ensemble:generate-feature-tests first
   - Recommend re-running /ensemble:generate-feature-tests to resync, then committing the updated features and manifest

## Expected Output

**Format:** Drift report

**Structure:**
- **Drift status**: IN_SYNC, or the lists of ADDED / REMOVED / CHANGED acceptance criteria ids

## Usage

```
/ensemble:check-feature-drift [prd-path] [--out <dir>]
```
