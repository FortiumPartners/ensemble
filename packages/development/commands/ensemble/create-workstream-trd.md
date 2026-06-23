---
name: ensemble:create-workstream-trd
description: Generate a normalized executable workstream TRD from multiple source TRDs
version: 1.0.0
category: implementation
last-updated: 2026-06-20
allowed-tools: Bash, Read, Write
argument-hint: <trd-path> <trd-path> [more-trd-paths] [--out path]
model: sonnet
---
<!-- DO NOT EDIT - Generated from create-workstream-trd.yaml -->
<!-- To modify this file, edit the YAML source and run: npm run generate -->


Combine multiple canonical TRDs into one generated, executable workstream TRD
that preserves source PRD/TRD/REQ/AC provenance and can be passed as the
single input to /ensemble:implement-trd-beads.

Source TRDs remain canonical. The generated workstream TRD is an execution
artifact that normalizes the Master Task List and decomposes every referenced
PRD acceptance criterion into AC-level implementation, executable-test, and
validation tasks with Definition of Done evidence requirements. Generated workstream files
use micro UUID document IDs (TRD-YYYY-<8hex>-workstream-<slug>.md), not
sequence numbers, to avoid collisions across large teams.

## Workflow

### Phase 1: Generate Workstream TRD

**1. Parse Arguments**
   Validate source TRD paths and locate deterministic TRD CLI

   - Extract all .md paths from $ARGUMENTS in the order provided. Require at least two TRD paths.
   - If fewer than two paths are supplied: print 'ERROR: create-workstream-trd requires two or more TRD paths.' and HALT.
   - Resolve TRD_CLI to first existing path among: ${CLAUDE_PLUGIN_ROOT}/lib/trd-cli.js, packages/development/lib/trd-cli.js. If missing, print error and HALT.

**2. Generate**
   Create normalized executable workstream TRD

   - Run: node "$TRD_CLI" create-workstream-trd <TRD_PATHS...> plus --out <path> if provided.
   - Parse JSON stdout. If ok is false, process exits non-zero, or JSON malformed: print every error and HALT.
   - The generated file MUST contain a Source TRD Manifest, normalized Master Task List, source provenance, AC-level implementation tasks, AC-level executable test tasks, AC validation tasks, and Definition of Done evidence requirements. Default output path format is docs/TRD/workstreams/TRD-YYYY-<micro_uuid>-workstream-<slug>.md.

**3. Report**
   Tell the user how to execute the generated workstream

   - Print generated path, workstream slug, source TRD count, and next step: /ensemble:implement-trd-beads <generated-path>.
   - Do not start implementation automatically.

## Usage

```
/ensemble:create-workstream-trd <trd-path> <trd-path> [more-trd-paths] [--out path]
```
