---
name: ensemble-generate-feature-tests
description: "Generate Gherkin .feature files and a traceability manifest from a PRD's acceptance criteria"
disable-model-invocation: true
metadata:
  version: "1.0.0"
  category: quality
---

Generate executable-shaped Gherkin .feature files directly from a PRD's
acceptance criteria, plus a .prd-trace.json manifest that fingerprints every
AC for later drift detection. PRD acceptance criteria are already written in
Given/When/Then form, so this is a faithful, deterministic translation rather
than a creative authoring step. The output is one .feature file per
requirement (REQ-NNN), with traceability tags linking each scenario back to
its PRD document id and AC id.

## Constraints

- This command ONLY generates test artifacts from an existing PRD -- it does not implement features or write step definitions
- Parsing is deterministic via the prd-cli helper -- DO NOT hand-author or hand-edit .feature files
- Every acceptance criterion (AC-NNN-M) maps to exactly one Gherkin Scenario; nothing is dropped
- Acceptance criteria that are not in Given/When/Then form are emitted as @needs-clarification scenarios, never silently skipped
- Regeneration is idempotent -- unchanged ACs produce byte-identical output

## Workflow

### Phase 1: Generate

#### Step 1.1: Resolve the PRD path

Determine which PRD to generate feature files from

- If the user passed a PRD path argument, use it
- Otherwise look under docs/PRD/ and ask the user which PRD to use if ambiguous

#### Step 1.2: Run the generator

Invoke the deterministic CLI to parse the PRD and write artifacts

- Resolve PRD_CLI to first existing path among: ${CLAUDE_PLUGIN_ROOT}/lib/prd-cli.js, packages/product/lib/prd-cli.js. If missing, print error and HALT.
- Run: node "$PRD_CLI" generate-features <prd-path> --json
- Pass through --out <dir> (default: features/) and --dry-run if the user requested a preview
- The CLI writes one <REQ-NNN>.feature per requirement plus a .prd-trace.json manifest under <out>/<prd-stem>/

#### Step 1.3: Report results

Summarize what was generated and surface gaps

- Report the output directory, number of feature files, and total scenarios
- List every AC tagged @needs-clarification (free-form or carrying a [NEEDS CLARIFICATION] marker) so the author can fix the PRD
- Echo any parser warnings (e.g. requirements with no acceptance criteria)
- Remind the user to commit the generated features and run /ensemble:reqnroll feature-drift after future PRD edits

## Expected Output

**Format:** Gherkin feature files + JSON manifest

**Structure:**

- **<out>/<prd-stem>/<REQ-NNN>.feature**: One Gherkin feature per requirement, one tagged+hashed scenario per acceptance criterion
- **<out>/<prd-stem>/.prd-trace.json**: Manifest mapping each AC id to its requirement, content hash, feature file, and clarification flag
