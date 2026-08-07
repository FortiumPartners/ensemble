---
name: ensemble-trd-dependency-graph
description: Build a dependency graph across TRDs and report likely-duplicate work (overlapping target files) (Codex skill for /ensemble:trd-dependency-graph)
user-invocable: true
argument-hint: '[trd-dir|paths...] [--format json|mermaid|dot] [--overlap]'
model: gpt-5.1-codex
---

# Ensemble Command: /ensemble:trd-dependency-graph

This Codex skill mirrors the Ensemble slash command `/ensemble:trd-dependency-graph`.
Follow the workflow below, adapt to the current repository, and keep outputs structured.

<!-- DO NOT EDIT - Generated from trd-dependency-graph.yaml -->
<!-- To modify this file, edit the YAML source and run: npm run generate -->


Build and emit the TRD-level dependency graph for a set of TRDs, and surface
likely-duplicate technical work so the same domain object is not specified in
two places. Reuses the existing cross-TRD dependency annotations to derive
edges, detects cycles, and renders the graph as JSON, Mermaid (for GitHub /
markdown), or Graphviz DOT. The overlap report flags TRD pairs that touch the
same target files -- a signal that work should be extracted into one shared
(foundational) TRD and referenced rather than duplicated.

## Workflow

### Phase 1: Analyze

**1. Resolve the TRD set**
   Determine which TRDs to graph

   - If the user passed a directory or explicit TRD paths, use them; otherwise default to docs/TRD/

**2. Build the graph**
   Invoke the deterministic CLI to build and emit the dependency graph

   - Resolve TRD_GRAPH_CLI to first existing path among: ${CLAUDE_PLUGIN_ROOT}/lib/trd-graph-cli.js, packages/development/lib/trd-graph-cli.js. If missing, print error and HALT.
   - Run: node "$TRD_GRAPH_CLI" graph <dir|paths> --format <json|mermaid|dot>
   - Default to --format mermaid for a human-facing answer (renders in GitHub); use json when the caller needs machine output, dot for Graphviz
   - Interpret exit code: 0 = acyclic, 2 = a dependency cycle was detected (report the cycle)
   - Surface every stderr warning -- especially duplicate document_id collisions and unresolved cross-TRD references

**3. Report duplicate work**
   Run the overlap report to flag probable duplication

   - Run: node "$TRD_GRAPH_CLI" overlap <dir|paths>
   - For each flagged pair, note the shared target files and suggest extracting the shared work into one foundational TRD that both reference via [depends: <trd-slug>#TRD-NNN]
   - Present the graph (rendered) plus the cycle and overlap findings; do not modify any TRD

## Expected Output

**Format:** TRD dependency graph + overlap report

**Structure:**
- **Dependency graph**: JSON / Mermaid / DOT graph of TRD-to-TRD dependencies, with cycle detection
- **Overlap report**: TRD pairs sharing target files (likely-duplicate work), with an extract-and-reference suggestion
- **Warnings**: Duplicate document_id collisions and unresolved cross-TRD references

## Usage

```
/ensemble:trd-dependency-graph [trd-dir|paths...] [--format json|mermaid|dot] [--overlap]
```
