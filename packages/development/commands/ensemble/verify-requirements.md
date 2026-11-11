---
name: "ensemble:verify-requirements"
description: "Post-implementation REQ->AC->code traceability verifier - chains PRD requirements through TRD tasks to code and tests and writes a proof report"
version: "2.0.0"
category: "planning"
last-updated: "2026-10-20"
allowed-tools: "Read"
capabilities-optional: "tracker.list, tracker.comments"
argument-hint: "--trd <trd-path> [--prd <prd-path>] [--mode auto|beads|checkbox|both] [--report-path <path>] [--no-write-report] [--run-tests]"
model: "sonnet"
---
<!-- DO NOT EDIT - Generated from verify-requirements.yaml -->
<!-- To modify this file, edit the YAML source and run: npm run generate -->

Read the file ${CLAUDE_PLUGIN_ROOT}/skills/ensemble-verify-requirements/SKILL.md and follow its instructions exactly; resolve any relative paths in it against ${CLAUDE_PLUGIN_ROOT}/skills/ensemble-verify-requirements/. Wherever that file refers to its ARGUMENTS, use this value: $ARGUMENTS
