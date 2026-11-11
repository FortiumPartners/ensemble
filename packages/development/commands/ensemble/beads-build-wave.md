---
name: "ensemble:beads-build-wave"
description: "Run a single beads-build wave (one work-graph.plan/work-graph.ready schedule + concurrent Task() dispatch + barrier) and emit a JSON summary suitable for the parent loop"
user-invocable: false
version: "1.4.0"
category: "implementation"
last-updated: "2026-10-23"
allowed-tools: "Read, Write, Edit, Bash, Grep, Glob, Task"
capabilities-required: "tracker.show, tracker.set-status, tracker.close, tracker.comment, work-graph.ready, workflow.status, workflow.commit"
capabilities-optional: "work-graph.plan, tracker.list, tracker.sync"
argument-hint: "--epic <id> [--max-parallel N] [--trd trd-path] [--strategy tdd|characterization|bug-fix|refactor|test-after|flexible] [--label <label>] [--team-roles <json>] [--foreman]"
model: "sonnet"
---
<!-- DO NOT EDIT - Generated from beads-build-wave.yaml -->
<!-- To modify this file, edit the YAML source and run: npm run generate -->

Read the file ${CLAUDE_PLUGIN_ROOT}/skills/ensemble-beads-build-wave/SKILL.md and follow its instructions exactly; resolve any relative paths in it against ${CLAUDE_PLUGIN_ROOT}/skills/ensemble-beads-build-wave/. Wherever that file refers to its ARGUMENTS, use this value: $ARGUMENTS
