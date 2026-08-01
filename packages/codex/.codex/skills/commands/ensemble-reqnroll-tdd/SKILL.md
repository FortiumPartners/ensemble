---
name: ensemble-reqnroll-tdd
description: Drive PRD acceptance criteria to green via an outside-in, red-gated Reqnroll + xUnit test-first loop (Codex skill for /ensemble:reqnroll-tdd)
user-invocable: true
argument-hint: '[prd-path] [--sut <csproj>] [--out <dir>]'
model: gpt-5.1-codex
---

# Ensemble Command: /ensemble:reqnroll-tdd

This Codex skill mirrors the Ensemble slash command `/ensemble:reqnroll-tdd`.
Follow the workflow below, adapt to the current repository, and keep outputs structured.

<!-- DO NOT EDIT - Generated from reqnroll-tdd.yaml -->
<!-- To modify this file, edit the YAML source and run: npm run generate -->


Take a PRD all the way to executable, passing acceptance tests using an
outside-in, test-first loop: each acceptance criterion becomes a failing
Reqnroll scenario first (red), and that red drives the implementation to green.
The red gate is enforced by running the tests and asserting failure BEFORE any
production code is written, so test-first is structural rather than a convention.
Scaffolding and the step-matching layer are deterministic (reqnroll-cli); the
step bodies are authored by the reqnroll-binding-specialist and the
implementation by backend-developer using the test-driven-development skill.
Iterate per scenario / PR slice so bindings and implementation interleave.

## Workflow

### Phase 1: Scaffold

**1. Generate the Reqnroll project**
   Deterministically scaffold features, step stubs, and the xUnit project

   - Resolve the PRD (argument or docs/PRD/) and the SUT project (--sut <csproj>)
   - Resolve REQNROLL_CLI to first existing path among: ${CLAUDE_PLUGIN_ROOT}/lib/reqnroll-cli.js, packages/product/lib/reqnroll-cli.js. If missing, print error and HALT.
   - Run: node "$REQNROLL_CLI" generate-bindings <prd-path> --out <dir> --sut <csproj> --json
   - Confirm the project builds with all scenarios Pending (red): node "$REQNROLL_CLI" run --project <projectDir> --json (expect green=false)
   - Enumerate scenarios in PR-boundary order (or AC order) to drive the per-slice loop

### Phase 2: Test-First Loop

**1. Author the failing acceptance test**
   Fill this scenario's binding bodies against the contract you wish existed

   - Delegate: Task(subagent_type=reqnroll-binding-specialist, prompt='Fill the bindings for scenario <AC-id> in <Steps file>. Code against the intended SUT contract. Bodies only -- never edit attributes. Leave unmappable steps Pending and report them.')
   - Capture its structured return (bound, stillPending)

**2. RED gate (mandatory)**
   Prove the scenario fails before writing any implementation

   - Run: node "$REQNROLL_CLI" run --project <projectDir> --filter @<AC-id> --json
   - REQUIRE green=false (failing assertion, Pending, or undefined step). If green=true immediately, REJECT: the assertion is vacuous or the behavior already exists -- send back to the binding-specialist.

**3. Implement to green (inner TDD loop)**
   Write production code to satisfy the now-failing scenario

   - Delegate: Task(subagent_type=backend-developer, prompt='Make acceptance scenario <AC-id> pass. Use the test-driven-development skill: unit-test-first, then implement. Do not modify the acceptance test or its step attributes.')

**4. GREEN gate**
   Confirm the scenario passes and the proof is real

   - Run: node "$REQNROLL_CLI" run --project <projectDir> --filter @<AC-id> --json; REQUIRE green=true with zero Pending
   - Delegate: Task(subagent_type=code-reviewer, prompt='Confirm scenario <AC-id> Then steps assert the acceptance criterion meaningfully (not a no-op) and no [Given/When/Then] attribute was modified.')
   - Advance to the next scenario / PR slice and repeat from step 1

### Phase 3: Report

**1. Summarize outcomes**
   Report green scenarios, still-pending steps, and drift status

   - List scenarios now green, and any steps left Pending with the reported reason
   - Run: node "$REQNROLL_CLI" check-binding-drift <prd-path> --out <dir> to confirm bindings still cover the PRD
   - Recommend committing the test project alongside the implementation and wiring check-binding-drift into CI

## Expected Output

**Format:** Passing Reqnroll acceptance tests + implementation

**Structure:**
- **Green acceptance scenarios**: Each driven from red to green test-first, one slice at a time
- **Outcome report**: Scenarios green, steps still Pending (with reasons), and binding-drift status

## Usage

```
/ensemble:reqnroll-tdd [prd-path] [--sut <csproj>] [--out <dir>]
```
