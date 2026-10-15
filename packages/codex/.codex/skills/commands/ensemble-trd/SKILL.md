---
name: ensemble-trd
description: Dispatch to a TRD-authoring, analysis, or implementation subcommand by keyword (Codex skill for /ensemble:trd)
user-invocable: true
argument-hint: <create|foreman|refine|workstream|implement|analyze|complexity|validate|verify|status|graph> [subcommand args...]
---

# Ensemble Command: /ensemble:trd

This Codex skill mirrors the Ensemble slash command `/ensemble:trd`.
Follow the workflow below, adapt to the current repository, and keep outputs structured.

## Subcommands

- **`create`** - Create a Technical Requirements Document from a PRD. see the `ensemble-create-trd` skill (`packages/codex/.codex/skills/commands/ensemble-create-trd/SKILL.md`).
- **`foreman`** - Create a Foreman-native structured TRD from a PRD (no adversarial review phase, parser-compatible tables). see the `ensemble-create-trd-foreman` skill (`packages/codex/.codex/skills/commands/ensemble-create-trd-foreman/SKILL.md`).
- **`refine`** - Refine and enhance an existing TRD with stakeholder feedback. see the `ensemble-refine-trd` skill (`packages/codex/.codex/skills/commands/ensemble-refine-trd/SKILL.md`).
- **`workstream`** - Generate a normalized executable workstream TRD from multiple source TRDs. see the `ensemble-create-workstream-trd` skill (`packages/codex/.codex/skills/commands/ensemble-create-workstream-trd/SKILL.md`).
- **`implement`** - Implement a TRD with beads project management (persistent bead hierarchy, br/bv-driven execution, cross-session resumability). see the `ensemble-implement-trd-beads` skill (`packages/codex/.codex/skills/commands/ensemble-implement-trd-beads/SKILL.md`).
- **`analyze`** - Pre-implementation cross-artifact consistency sweep (PRD-TRD-beads alignment). see the `ensemble-analyze-requirements` skill (`packages/codex/.codex/skills/commands/ensemble-analyze-requirements/SKILL.md`).
- **`complexity`** - Score work complexity and choose an adaptive Ensemble planning route. see the `ensemble-analyze-complexity` skill (`packages/codex/.codex/skills/commands/ensemble-analyze-complexity/SKILL.md`).
- **`validate`** - Pre-implementation traceability gate (REQ-NNN coverage and TEST task pairing between PRD and TRD). see the `ensemble-validate-requirements` skill (`packages/codex/.codex/skills/commands/ensemble-validate-requirements/SKILL.md`).
- **`verify`** - Post-implementation REQ-AC-code traceability verifier with a proof report. see the `ensemble-verify-requirements` skill (`packages/codex/.codex/skills/commands/ensemble-verify-requirements/SKILL.md`).
- **`status`** - On-demand requirement satisfaction report scanned from bead comments. see the `ensemble-requirement-status` skill (`packages/codex/.codex/skills/commands/ensemble-requirement-status/SKILL.md`).
- **`graph`** - Build a dependency graph across TRDs and report likely-duplicate work. see the `ensemble-trd-dependency-graph` skill (`packages/codex/.codex/skills/commands/ensemble-trd-dependency-graph/SKILL.md`).

<!-- DO NOT EDIT - Generated from trd.yaml -->
<!-- To modify this file, edit the YAML source and run: npm run generate -->


Thin routing layer over the existing TRD-adjacent commands (authoring, Foreman-native
authoring, refinement, workstream normalization, beads-driven implementation, and the
cross-artifact analysis/validation/verification/status/dependency-graph tools). Reads
and follows the matching sibling command's own generated file for this runtime, passing
the rest of $ARGUMENTS unchanged, and does not re-implement any of their phases. This
group is intentionally heterogeneous -- not every subcommand below is a simple CRUD
variant of one workflow, so read each one's own description carefully before picking it.

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
