---
name: ensemble:check-binding-drift
description: Detect drift between a PRD's acceptance-criteria steps and the Reqnroll step bindings on disk
version: 1.0.0
category: testing
last-updated: 2026-06-29
argument-hint: [prd-path] [--out <dir>]
model: haiku
---
<!-- DO NOT EDIT - Generated from check-binding-drift.yaml -->
<!-- To modify this file, edit the YAML source and run: npm run generate -->


Re-derive the step inventory from a PRD's current acceptance criteria and
compare it against the [Given/When/Then(@"...")] attributes actually present in
the generated Reqnroll step classes. Reports UNBOUND steps (in the PRD but with
no binding) and ORPHANED bindings (in code but no longer in the PRD). This is
the second tier of requirement traceability: /ensemble:check-feature-drift
covers PRD vs .feature, this covers .feature vs the step bindings. The CLI exit
code (0 in-sync, 2 drift) lets the same check gate CI or a pre-commit hook.

## Workflow

### Phase 1: Check

**1. Resolve PRD and project**
   Determine the PRD and the test project whose bindings to audit

   - If the user passed a PRD path, use it; otherwise look under docs/PRD/ and ask which to check
   - Pass through --out <dir> (default: tests/) so the correct Steps/ directory is located

**2. Run the drift check**
   Invoke the deterministic CLI to diff PRD steps against the bindings

   - Resolve REQNROLL_CLI to first existing path among: ${CLAUDE_PLUGIN_ROOT}/lib/reqnroll-cli.js, packages/product/lib/reqnroll-cli.js. If missing, print error and HALT.
   - Run: node "$REQNROLL_CLI" check-binding-drift <prd-path> --json
   - Interpret exit code: 0 = IN_SYNC, 2 = drift detected, 1 = no bindings generated yet

**3. Report and recommend**
   Explain the drift and how to resolve it

   - If IN_SYNC: confirm the bindings cover the PRD's steps
   - If UNBOUND: list the steps needing new bindings -- re-run /ensemble:generate-reqnroll-bindings to add stubs (write-once preserves filled bodies)
   - If ORPHANED: list bindings whose acceptance criterion was removed or reworded -- update or delete them
   - If no bindings exist yet: tell the user to run /ensemble:generate-reqnroll-bindings first

## Expected Output

**Format:** Binding drift report

**Structure:**
- **Drift status**: IN_SYNC, or the lists of UNBOUND (PRD step, no binding) and ORPHANED (binding, no PRD step) entries

## Usage

```
/ensemble:check-binding-drift [prd-path] [--out <dir>]
```
