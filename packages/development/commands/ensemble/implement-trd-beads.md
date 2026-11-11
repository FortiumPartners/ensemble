---
name: "ensemble:implement-trd-beads"
description: "Implement TRD with beads project management — persistent bead hierarchy, dependency-aware execution via toolchain-cli tracker/work-graph capabilities, and cross-session resumability"
version: "3.1.0"
category: "implementation"
last-updated: "2026-10-21"
allowed-tools: "Read, Write, Edit, Bash, Grep, Glob, Task"
capabilities-required: "tracker.list, tracker.create, tracker.comment, tracker.close, test-runner.run, package-runner.run-script, workflow.commit, workflow.merge-base"
capabilities-optional: "work-graph.plan, work-graph.graph-health, tracker.stage-export, tracker.comments, tracker.dep-add, tracker.sync"
argument-hint: "[trd-path] [--plan] [--execute] [--branch=<name>] [--use-current-branch] [--status] [--reset-task TRD-XXX] [--list] [max parallel N] [--foreman] [<trd-path> <trd-path>... --workstream [--generate-only [--out <path>] [--allow-invalid]]]"
model: "sonnet"
---
<!-- DO NOT EDIT - Generated from implement-trd-beads.yaml -->
<!-- To modify this file, edit the YAML source and run: npm run generate -->

Read the file ${CLAUDE_PLUGIN_ROOT}/skills/ensemble-implement-trd-beads/SKILL.md and follow its instructions exactly; resolve any relative paths in it against ${CLAUDE_PLUGIN_ROOT}/skills/ensemble-implement-trd-beads/. Wherever that file refers to its ARGUMENTS, use this value: $ARGUMENTS
