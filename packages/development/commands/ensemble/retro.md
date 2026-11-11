---
name: "ensemble:retro"
description: "Post-release retrospective - estimate accuracy, PRD success-metric status, incidents, and proposed follow-ups"
version: "2.0.0"
category: "planning"
last-updated: "2026-10-23"
allowed-tools: "Read"
capabilities-required: "tracker.list, workflow.log"
capabilities-optional: "tracker.create, host.change-request-list"
argument-hint: "--release vX.Y.Z | --since <ref>"
model: "sonnet"
---
<!-- DO NOT EDIT - Generated from retro.yaml -->
<!-- To modify this file, edit the YAML source and run: npm run generate -->

Read the file ${CLAUDE_PLUGIN_ROOT}/skills/ensemble-retro/SKILL.md and follow its instructions exactly; resolve any relative paths in it against ${CLAUDE_PLUGIN_ROOT}/skills/ensemble-retro/. Wherever that file refers to its ARGUMENTS, use this value: $ARGUMENTS
