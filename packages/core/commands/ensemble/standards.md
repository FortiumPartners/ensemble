---
name: "ensemble:standards"
description: "Dispatch to a coding-standards subcommand by keyword (discover, inject, fold)"
version: "1.0.0"
category: "analysis"
last-updated: "2026-10-17"
argument-hint: "<discover|inject|fold> [subcommand args...]"
---
<!-- DO NOT EDIT - Generated from standards.yaml -->
<!-- To modify this file, edit the YAML source and run: npm run generate -->


Thin routing layer over the project coding-standards commands: discovering
conventions into a standards/ index, injecting the task-relevant subset into agent
context, and folding CLAUDE.md for token efficiency. Reads and follows the matching
sibling command's own generated file for this runtime, passing the rest of
$ARGUMENTS unchanged, and does not re-implement any of their phases.

## Subcommands

- **`discover`** - Analyze the codebase and extract coding conventions into a standards/ directory with index.yml. Invoke `/ensemble:discover-standards` directly, or read and follow `packages/core/commands/ensemble/discover-standards.md`, passing the remaining arguments through as its $ARGUMENTS.
- **`inject`** - Selectively inject relevant standards from standards/index.yml into agent context based on the current task. Invoke `/ensemble:inject-standards` directly, or read and follow `packages/core/commands/ensemble/inject-standards.md`, passing the remaining arguments through as its $ARGUMENTS.
- **`fold`** - Optimize CLAUDE.md for token efficiency, standards discovery, and progressive context loading. Invoke `/ensemble:fold-prompt` directly, or read and follow `packages/core/skills/ensemble-fold-prompt/SKILL.md`, passing the remaining arguments through as its $ARGUMENTS.

## Workflow

### Phase 1: Dispatch

**1. Route by first argument token**
   Parse $ARGUMENTS and hand off to the matching sibling command

- Parse $ARGUMENTS. The first whitespace-delimited token selects a subcommand by its keyword below; the remaining text, unmodified, becomes that subcommand's own argument input.
- If the first token matches a keyword below: read and follow that subcommand's own generated command file for this runtime (see the Subcommands section this file renders), passing the remaining argument text through unmodified. Do not re-implement its phases here.
- If the first token matches no keyword, or $ARGUMENTS is empty: print the keyword table below (keyword + one-line description) and HALT without side effects.

## Usage

```
/ensemble:standards <discover|inject|fold> [subcommand args...]
```
