---
name: "ensemble:implement-bead"
description: "Implement one bead by ID on a feature branch using the same branching and commit policy as beads-build and implement-trd-beads, opening its change request through the configured host adapter"
version: "2.3.0"
category: "implementation"
last-updated: "2026-10-23"
allowed-tools: "Read, Write, Edit, Bash, Grep, Glob, Task"
capabilities-required: "tracker.show, tracker.set-status, tracker.close, tracker.comment, host.change-request-create, workflow.branch-create, workflow.status, workflow.commit, workflow.push"
capabilities-optional: "tracker.sync"
argument-hint: "<bead-id> [--foreman]"
model: "sonnet"
---
<!-- DO NOT EDIT - Generated from implement-bead.yaml -->
<!-- To modify this file, edit the YAML source and run: npm run generate -->

Read the file ${CLAUDE_PLUGIN_ROOT}/skills/ensemble-implement-bead/SKILL.md and follow its instructions exactly; resolve any relative paths in it against ${CLAUDE_PLUGIN_ROOT}/skills/ensemble-implement-bead/. Wherever that file refers to its ARGUMENTS, use this value: $ARGUMENTS
