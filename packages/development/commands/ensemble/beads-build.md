---
name: "ensemble:beads-build"
description: "Drive an existing bead hierarchy to completion through the full builder, code-review, and close pipeline"
version: "1.4.0"
category: "implementation"
last-updated: "2026-10-23"
allowed-tools: "Read, Write, Edit, Bash, Grep, Glob, Task"
capabilities-required: "tracker.show, tracker.list, tracker.comment, tracker.close, work-graph.ready, workflow.status, workflow.remote-url, workflow.commit"
capabilities-optional: "work-graph.plan, tracker.comments, tracker.sync, host.change-request-create, workflow.push, workflow.diff"
argument-hint: "[epic-id|slug-pattern | --epic <id>] [--max-parallel N | max parallel N] [--trd trd-path] [--strategy tdd|characterization|bug-fix|refactor|test-after|flexible] [--label <label>] [--defer-completion] [--plan]"
model: "sonnet"
---
<!-- DO NOT EDIT - Generated from beads-build.yaml -->
<!-- To modify this file, edit the YAML source and run: npm run generate -->

Read the file ${CLAUDE_PLUGIN_ROOT}/skills/ensemble-beads-build/SKILL.md and follow its instructions exactly; resolve any relative paths in it against ${CLAUDE_PLUGIN_ROOT}/skills/ensemble-beads-build/. Wherever that file refers to its ARGUMENTS, use this value: $ARGUMENTS
