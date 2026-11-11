---
name: "ensemble:reqnroll"
description: "Dispatch to a PRD-to-Reqnroll acceptance-test subcommand by keyword (features, feature-drift, bindings, binding-drift, tdd)"
version: "1.0.0"
category: "testing"
last-updated: "2026-10-17"
argument-hint: "<features|feature-drift|bindings|binding-drift|tdd> [subcommand args...]"
---
<!-- DO NOT EDIT - Generated from reqnroll.yaml -->
<!-- To modify this file, edit the YAML source and run: npm run generate -->


Thin routing layer over the PRD-to-executable-acceptance-test commands: Gherkin
feature generation, PRD-vs-feature drift checking, Reqnroll + xUnit binding
scaffolding, feature-vs-binding drift checking, and the red-gated test-first loop
that drives scaffolded bindings to green. Reads and follows the matching sibling
command's own generated file for this runtime, passing the rest of $ARGUMENTS
unchanged, and does not re-implement any of their phases. The subcommands are
reached only through this dispatcher.

## Subcommands

- **`features`** - Generate Gherkin .feature files and a traceability manifest from a PRD's acceptance criteria. Invoke `/ensemble:generate-feature-tests` directly, or read and follow `packages/product/skills/ensemble-generate-feature-tests/SKILL.md`, passing the remaining arguments through as its $ARGUMENTS.
- **`feature-drift`** - Detect drift between a PRD's acceptance criteria and its generated Gherkin feature files. Invoke `/ensemble:check-feature-drift` directly, or read and follow `packages/product/skills/ensemble-check-feature-drift/SKILL.md`, passing the remaining arguments through as its $ARGUMENTS.
- **`bindings`** - Scaffold a runnable Reqnroll + xUnit test project (features, step stubs, project files) from a PRD. Invoke `/ensemble:generate-reqnroll-bindings` directly, or read and follow `packages/product/skills/ensemble-generate-reqnroll-bindings/SKILL.md`, passing the remaining arguments through as its $ARGUMENTS.
- **`binding-drift`** - Detect drift between a PRD's acceptance-criteria steps and the Reqnroll step bindings on disk. Invoke `/ensemble:check-binding-drift` directly, or read and follow `packages/product/skills/ensemble-check-binding-drift/SKILL.md`, passing the remaining arguments through as its $ARGUMENTS.
- **`tdd`** - Drive PRD acceptance criteria to green via an outside-in, red-gated Reqnroll + xUnit test-first loop. Invoke `/ensemble:reqnroll-tdd` directly, or read and follow `packages/product/skills/ensemble-reqnroll-tdd/SKILL.md`, passing the remaining arguments through as its $ARGUMENTS.

## Workflow

### Phase 1: Dispatch

**1. Route by first argument token**
   Parse $ARGUMENTS and hand off to the matching sibling command

- Parse $ARGUMENTS. The first whitespace-delimited token selects a subcommand by its keyword below; the remaining text, unmodified, becomes that subcommand's own argument input.
- If the first token matches a keyword below: read and follow that subcommand's own generated command file for this runtime (see the Subcommands section this file renders), passing the remaining argument text through unmodified. Do not re-implement its phases here.
- If the first token matches no keyword, or $ARGUMENTS is empty: print the keyword table below (keyword + one-line description) and HALT without side effects.

## Usage

```
/ensemble:reqnroll <features|feature-drift|bindings|binding-drift|tdd> [subcommand args...]
```
