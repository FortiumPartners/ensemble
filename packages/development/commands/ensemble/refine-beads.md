---
name: "ensemble:refine-beads"
description: "Approval-gated Beads graph refinement before execution"
version: "1.1.0"
category: "implementation"
last-updated: "2026-10-23"
allowed-tools: "Bash, Read"
capabilities-required: "tracker.list, tracker.update, tracker.comment"
capabilities-optional: "work-graph.graph-health, tracker.dep-add, tracker.dep-remove, tracker.sync"
argument-hint: "[epic-id|release-train-id|slug] [--scope project] [--foreman]"
model: "sonnet"
---
<!-- DO NOT EDIT - Generated from refine-beads.yaml -->
<!-- To modify this file, edit the YAML source and run: npm run generate -->

Read the file ${CLAUDE_PLUGIN_ROOT}/skills/ensemble-refine-beads/SKILL.md and follow its instructions exactly; resolve any relative paths in it against ${CLAUDE_PLUGIN_ROOT}/skills/ensemble-refine-beads/. Wherever that file refers to its ARGUMENTS, use this value: $ARGUMENTS
