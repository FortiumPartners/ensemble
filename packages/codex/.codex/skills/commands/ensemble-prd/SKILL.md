---
name: ensemble-prd
description: "Dispatch to a PRD-authoring or PRD-refinement subcommand by keyword"
disable-model-invocation: true
metadata:
  version: "1.1.0"
  category: planning
---

Thin routing layer over the existing create-prd / refine-prd commands. Reads and
follows the matching sibling command's own SKILL.md, passing
the rest of $ARGUMENTS unchanged, and does not re-implement any of their phases.
Meeting-sourced drafting and refinement are the --from-meeting flag on those two
commands, not separate keywords: `create --from-meeting <summary>` and
`refine <prd-path> --from-meeting <summary>`.

## Subcommands

- **`create`** - Create a new PRD through a live structured interview, or from a meeting summary with --from-meeting. Invoke `/ensemble:create-prd` directly, or read and follow `../ensemble-create-prd/SKILL.md` (relative to this skill's directory), passing the remaining arguments through as its $ARGUMENTS.
- **`refine`** - Refine an existing PRD with stakeholder feedback, or with a meeting summary as the feedback source via --from-meeting. Invoke `/ensemble:refine-prd` directly, or read and follow `../ensemble-refine-prd/SKILL.md` (relative to this skill's directory), passing the remaining arguments through as its $ARGUMENTS.

## Workflow

### Phase 1: Dispatch

#### Step 1.1: Route by first argument token

Parse $ARGUMENTS and hand off to the matching sibling command

- Parse $ARGUMENTS. The first whitespace-delimited token selects a subcommand by its keyword below; the remaining text, unmodified, becomes that subcommand's own argument input.
- If the first token matches a keyword below: read and follow that subcommand's own sibling skill (its path is in the Subcommands section above), passing the remaining argument text through unmodified. Do not re-implement its phases here.
- If the first token matches no keyword, or $ARGUMENTS is empty: print the keyword table below (keyword + one-line description) and HALT without side effects.
