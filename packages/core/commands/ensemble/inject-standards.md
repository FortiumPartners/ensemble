---
name: "ensemble:inject-standards"
description: "Selectively inject relevant standards from standards/index.yml into agent context based on current task"
user-invocable: false
version: "1.0.0"
category: "implementation"
last-updated: "2026-03-29"
allowed-tools: "Read"
argument-hint: "<task-description>"
model: "sonnet"
---
<!-- DO NOT EDIT - Generated from inject-standards.yaml -->
<!-- To modify this file, edit the YAML source and run: npm run generate -->

Read the file ${CLAUDE_PLUGIN_ROOT}/skills/ensemble-inject-standards/SKILL.md and follow its instructions exactly; resolve any relative paths in it against ${CLAUDE_PLUGIN_ROOT}/skills/ensemble-inject-standards/. Wherever that file refers to its ARGUMENTS, use this value: $ARGUMENTS
