---
name: "ensemble:trd"
description: "Dispatch to a TRD-authoring, analysis, or implementation subcommand by keyword"
version: "1.1.0"
category: "planning"
last-updated: "2026-10-17"
argument-hint: "<create|refine|implement|analyze|complexity|validate|verify|status|graph> [subcommand args...]"
---
<!-- DO NOT EDIT - Generated from trd.yaml -->
<!-- To modify this file, edit the YAML source and run: npm run generate -->


Thin routing layer over the existing TRD-adjacent commands (authoring, refinement,
beads-driven implementation, and the cross-artifact analysis/validation/verification/
status/dependency-graph tools). Reads and follows the matching sibling command's own
generated file for this runtime, passing the rest of $ARGUMENTS unchanged, and does not
re-implement any of their phases. Variants of a command are flags on that command rather
than keywords: `create --parser-tables` produces a Foreman-native structured TRD, and
`implement --workstream [--generate-only]` generates a normalized executable workstream TRD
from multiple source TRDs. This group is intentionally heterogeneous -- not every
subcommand below is a simple CRUD variant of one workflow, so read each one's own
description carefully before picking it.

## Subcommands

- **`create`** - Create a Technical Requirements Document from a PRD (add --parser-tables for a Foreman-native structured TRD with parser-compatible sprint/story tables and no adversarial review phase). Invoke `/ensemble:create-trd` directly, or read and follow `packages/development/skills/ensemble-create-trd/SKILL.md`, passing the remaining arguments through as its $ARGUMENTS.
- **`refine`** - Refine and enhance an existing TRD with stakeholder feedback. Invoke `/ensemble:refine-trd` directly, or read and follow `packages/development/skills/ensemble-refine-trd/SKILL.md`, passing the remaining arguments through as its $ARGUMENTS.
- **`implement`** - Implement a TRD with beads project management (persistent bead hierarchy, br/bv-driven execution, cross-session resumability); --workstream <trd1> <trd2> ... generates and implements one normalized workstream TRD from multiple source TRDs, and --workstream --generate-only [--out path] [--allow-invalid] only generates it. Invoke `/ensemble:implement-trd-beads` directly, or read and follow `packages/development/skills/ensemble-implement-trd-beads/SKILL.md`, passing the remaining arguments through as its $ARGUMENTS.
- **`analyze`** - Pre-implementation cross-artifact consistency sweep (PRD-TRD-beads alignment). Invoke `/ensemble:analyze-requirements` directly, or read and follow `packages/development/skills/ensemble-analyze-requirements/SKILL.md`, passing the remaining arguments through as its $ARGUMENTS.
- **`complexity`** - Score work complexity and choose an adaptive Ensemble planning route. Invoke `/ensemble:analyze-complexity` directly, or read and follow `packages/development/skills/ensemble-analyze-complexity/SKILL.md`, passing the remaining arguments through as its $ARGUMENTS.
- **`validate`** - Pre-implementation traceability gate (REQ-NNN coverage and TEST task pairing between PRD and TRD). Invoke `/ensemble:validate-requirements` directly, or read and follow `packages/development/skills/ensemble-validate-requirements/SKILL.md`, passing the remaining arguments through as its $ARGUMENTS.
- **`verify`** - Post-implementation REQ-AC-code traceability verifier with a proof report. Invoke `/ensemble:verify-requirements` directly, or read and follow `packages/development/skills/ensemble-verify-requirements/SKILL.md`, passing the remaining arguments through as its $ARGUMENTS.
- **`status`** - On-demand requirement satisfaction report scanned from bead comments. Invoke `/ensemble:requirement-status` directly, or read and follow `packages/development/skills/ensemble-requirement-status/SKILL.md`, passing the remaining arguments through as its $ARGUMENTS.
- **`graph`** - Build a dependency graph across TRDs and report likely-duplicate work. Invoke `/ensemble:trd-dependency-graph` directly, or read and follow `packages/development/skills/ensemble-trd-dependency-graph/SKILL.md`, passing the remaining arguments through as its $ARGUMENTS.

## Workflow

### Phase 1: Dispatch

**1. Route by first argument token**
   Parse $ARGUMENTS and hand off to the matching sibling command

- Parse $ARGUMENTS. The first whitespace-delimited token selects a subcommand by its keyword below; the remaining text, unmodified, becomes that subcommand's own argument input.
- If the first token matches a keyword below: read and follow that subcommand's own generated command file for this runtime (see the Subcommands section this file renders), passing the remaining argument text through unmodified. Do not re-implement its phases here.
- If the first token matches no keyword, or $ARGUMENTS is empty: print the keyword table below (keyword + one-line description) and HALT without side effects.

## Usage

```
/ensemble:trd <create|refine|implement|analyze|complexity|validate|verify|status|graph> [subcommand args...]
```
