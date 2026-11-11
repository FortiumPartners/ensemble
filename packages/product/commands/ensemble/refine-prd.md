---
name: "ensemble:refine-prd"
description: "Refine and enhance existing PRD with stakeholder feedback and additional detail, or from a meeting summary with --from-meeting"
version: "2.9.0"
category: "planning"
last-updated: "2026-10-17"
allowed-tools: "Read"
argument-hint: "<prd-path> [--from-meeting <meeting-summary-or-path> | --foreman | --collab [--tunnel=quick] [--reviewers N] [--no-open] | --long-lived [--ttl <duration>]]"
model: "opus"
---
<!-- DO NOT EDIT - Generated from refine-prd.yaml -->
<!-- To modify this file, edit the YAML source and run: npm run generate -->

Read the file ${CLAUDE_PLUGIN_ROOT}/skills/ensemble-refine-prd/SKILL.md and follow its instructions exactly; resolve any relative paths in it against ${CLAUDE_PLUGIN_ROOT}/skills/ensemble-refine-prd/. Wherever that file refers to its ARGUMENTS, use this value: $ARGUMENTS
