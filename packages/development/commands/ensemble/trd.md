---
name: "ensemble:trd"
description: "Dispatch to a TRD-authoring, analysis, or implementation subcommand by keyword"
version: "1.0.0"
category: "planning"
last-updated: "2026-10-05"
argument-hint: "<create|foreman|refine|workstream|implement|analyze|complexity|validate|verify|status|graph> [subcommand args...]"
---
<!-- DO NOT EDIT - Generated from trd.yaml -->
<!-- To modify this file, edit the YAML source and run: npm run generate -->


Thin routing layer over the existing TRD-adjacent commands (authoring, Foreman-native
authoring, refinement, workstream normalization, beads-driven implementation, and the
cross-artifact analysis/validation/verification/status/dependency-graph tools). Reads
and follows the matching sibling command's own generated file for this runtime, passing
the rest of $ARGUMENTS unchanged, and does not re-implement any of their phases. This
group is intentionally heterogeneous -- not every subcommand below is a simple CRUD
variant of one workflow, so read each one's own description carefully before picking it.

## Subcommands

- **`create`** - Create a Technical Requirements Document from a PRD. Invoke `/ensemble:create-trd` directly, or read and follow `packages/development/commands/ensemble/create-trd.md`, passing the remaining arguments through as its $ARGUMENTS.
- **`foreman`** - Create a Foreman-native structured TRD from a PRD (no adversarial review phase, parser-compatible tables). Invoke `/ensemble:create-trd-foreman` directly, or read and follow `packages/development/commands/ensemble/create-trd-foreman.md`, passing the remaining arguments through as its $ARGUMENTS.
- **`refine`** - Refine and enhance an existing TRD with stakeholder feedback. Invoke `/ensemble:refine-trd` directly, or read and follow `packages/development/commands/ensemble/refine-trd.md`, passing the remaining arguments through as its $ARGUMENTS.
- **`workstream`** - Generate a normalized executable workstream TRD from multiple source TRDs. Invoke `/ensemble:create-workstream-trd` directly, or read and follow `packages/development/commands/ensemble/create-workstream-trd.md`, passing the remaining arguments through as its $ARGUMENTS.
- **`implement`** - Implement a TRD with beads project management (persistent bead hierarchy, br/bv-driven execution, cross-session resumability). Invoke `/ensemble:implement-trd-beads` directly, or read and follow `packages/development/commands/ensemble/implement-trd-beads.md`, passing the remaining arguments through as its $ARGUMENTS.
- **`analyze`** - Pre-implementation cross-artifact consistency sweep (PRD-TRD-beads alignment). Invoke `/ensemble:analyze-requirements` directly, or read and follow `packages/development/commands/ensemble/analyze-requirements.md`, passing the remaining arguments through as its $ARGUMENTS.
- **`complexity`** - Score work complexity and choose an adaptive Ensemble planning route. Invoke `/ensemble:analyze-complexity` directly, or read and follow `packages/development/commands/ensemble/analyze-complexity.md`, passing the remaining arguments through as its $ARGUMENTS.
- **`validate`** - Pre-implementation traceability gate (REQ-NNN coverage and TEST task pairing between PRD and TRD). Invoke `/ensemble:validate-requirements` directly, or read and follow `packages/development/commands/ensemble/validate-requirements.md`, passing the remaining arguments through as its $ARGUMENTS.
- **`verify`** - Post-implementation REQ-AC-code traceability verifier with a proof report. Invoke `/ensemble:verify-requirements` directly, or read and follow `packages/development/commands/ensemble/verify-requirements.md`, passing the remaining arguments through as its $ARGUMENTS.
- **`status`** - On-demand requirement satisfaction report scanned from bead comments. Invoke `/ensemble:requirement-status` directly, or read and follow `packages/development/commands/ensemble/requirement-status.md`, passing the remaining arguments through as its $ARGUMENTS.
- **`graph`** - Build a dependency graph across TRDs and report likely-duplicate work. Invoke `/ensemble:trd-dependency-graph` directly, or read and follow `packages/development/commands/ensemble/trd-dependency-graph.md`, passing the remaining arguments through as its $ARGUMENTS.

## Workflow

### Phase 1: Dispatch

**1. Route by first argument token**
   Parse $ARGUMENTS and hand off to the matching sibling command

- Parse $ARGUMENTS. The first whitespace-delimited token selects a subcommand by its keyword below; the remaining text, unmodified, becomes that subcommand's own argument input.
- If the first token matches a keyword below: read and follow that subcommand's own generated command file for this runtime (see the Subcommands section this file renders), passing the remaining argument text through unmodified. Do not re-implement its phases here.
- If the first token matches no keyword, or $ARGUMENTS is empty: print the keyword table below (keyword + one-line description) and HALT without side effects.

## Usage

```
/ensemble:trd <create|foreman|refine|workstream|implement|analyze|complexity|validate|verify|status|graph> [subcommand args...]
```
