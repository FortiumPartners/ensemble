---
name: ensemble:generate-reqnroll-bindings
description: Scaffold a runnable Reqnroll + xUnit test project (features, step stubs, project files) from a PRD
version: 1.0.0
category: testing
last-updated: 2026-06-29
argument-hint: [prd-path] [--out <dir>] [--sut <csproj>] [--dry-run] [--force]
model: haiku
---
<!-- DO NOT EDIT - Generated from generate-reqnroll-bindings.yaml -->
<!-- To modify this file, edit the YAML source and run: npm run generate -->


Generate a runnable Reqnroll + xUnit acceptance-test project from a PRD's
acceptance criteria. Reuses the same deterministic PRD parse that produces the
.feature files, then emits one [Binding] step class per requirement (literal,
verbatim Given/When/Then attributes with Pending() bodies), a .csproj wired for
Reqnroll.xUnit, reqnroll.json, and a .reqnroll-trace.json manifest that
fingerprints every step for drift detection. The result builds and runs
immediately -- every scenario starts red (Pending), which is the correct
test-first starting point before bindings are filled in.

## Workflow

### Phase 1: Generate

**1. Resolve PRD and SUT**
   Determine the PRD to scaffold from and the system-under-test project to reference

   - If the user passed a PRD path, use it; otherwise look under docs/PRD/ and ask which to use if ambiguous
   - Ask for or accept --sut <path-to-SUT.csproj> so the test project can reference the code under test (optional; omit if the SUT does not exist yet)

**2. Run the generator**
   Invoke the deterministic CLI to scaffold the project

   - Resolve REQNROLL_CLI to first existing path among: ${CLAUDE_PLUGIN_ROOT}/lib/reqnroll-cli.js, packages/product/lib/reqnroll-cli.js. If missing, print error and HALT.
   - Run: node "$REQNROLL_CLI" generate-bindings <prd-path> --json
   - Pass through --out <dir> (default: tests/), --sut <csproj>, --dry-run, and --force as requested
   - The CLI writes Features/*.feature, Steps/*.Steps.cs, <Name>.Tests.csproj, reqnroll.json, and .reqnroll-trace.json under <out>/<prd-stem>/

**3. Report results**
   Summarize the scaffold and the next move

   - Report the output directory, feature count, and distinct step-binding count
   - List any step files that were preserved (write-once) versus newly created
   - Echo parser warnings and remind the user that needs-clarification ACs produce step-less scenarios until the PRD is fixed
   - Point the user to /ensemble:reqnroll-tdd to fill the Pending() bodies test-first, or /ensemble:check-binding-drift to audit coverage later

## Expected Output

**Format:** Reqnroll + xUnit test project

**Structure:**
- **<out>/<prd-stem>/Features/<REQ-NNN>.feature**: Gherkin features (one per requirement), tagged and hashed
- **<out>/<prd-stem>/Steps/<REQ-NNN>.Steps.cs**: [Binding] step classes: literal Given/When/Then attributes with Pending() bodies
- **<out>/<prd-stem>/*.Tests.csproj + reqnroll.json**: Reqnroll.xUnit-wired test project, optionally referencing the SUT
- **<out>/<prd-stem>/.reqnroll-trace.json**: Step fingerprint manifest used by check-binding-drift

## Usage

```
/ensemble:generate-reqnroll-bindings [prd-path] [--out <dir>] [--sut <csproj>] [--dry-run] [--force]
```
