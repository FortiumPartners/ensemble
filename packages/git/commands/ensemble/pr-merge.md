---
name: "ensemble:pr-merge"
description: "Drive an open PR to green and merged by dispatching one subagent per failing CI check and unresolved review thread, routed through the correct orchestrator"
version: "2.4.2"
category: "git"
last-updated: "2026-11-10"
allowed-tools: "Read, Bash, Task, Grep, Glob, TodoWrite, AskUserQuestion"
capabilities-required: "host.change-request-view, host.change-request-checks, host.change-request-merge, host.change-request-reviews"
capabilities-optional: "host.change-request-threads"
argument-hint: "[pr-number-or-url] [--max-rounds=N] [--dry-run] [--foreman] [--method=squash|merge|rebase]"
model: "opus"
---
<!-- DO NOT EDIT - Generated from pr-merge.yaml -->
<!-- To modify this file, edit the YAML source and run: npm run generate -->

Read the file ${CLAUDE_PLUGIN_ROOT}/skills/ensemble-pr-merge/SKILL.md and follow its instructions exactly; resolve any relative paths in it against ${CLAUDE_PLUGIN_ROOT}/skills/ensemble-pr-merge/. Wherever that file refers to its ARGUMENTS, use this value: $ARGUMENTS
