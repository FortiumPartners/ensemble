---
name: ensemble-trd-dependency-graph
description: "Build a dependency graph across TRDs and report likely-duplicate work (overlapping target files)"
disable-model-invocation: true
metadata:
  version: "1.0.0"
  category: analysis
---

Build and emit the TRD-level dependency graph for a set of TRDs, and surface
likely-duplicate technical work so the same domain object is not specified in
two places. Reuses the existing cross-TRD dependency annotations to derive
edges, detects cycles, and renders the graph as JSON, Mermaid (for GitHub /
markdown), or Graphviz DOT. The overlap report flags TRD pairs that touch the
same target files -- a signal that work should be extracted into one shared
(foundational) TRD and referenced rather than duplicated.

## Constraints

- This command is READ-ONLY -- it analyzes existing TRDs and never edits them
- Graph construction is deterministic via the trd-graph-cli helper -- DO NOT hand-build the graph or eyeball dependencies
- Nodes are keyed by the filename-derived slug (unique); document_id is shown as a correlation attribute and duplicate document_ids are reported as warnings, never silently merged
- Cross-TRD edges come only from existing [depends: <trd-slug>#TRD-NNN] / #PR-N annotations; bare TRD-NNN deps are intra-TRD and excluded

## Workflow

### Phase 1: Analyze

#### Step 1.1: Resolve the TRD set

Determine which TRDs to graph

- If the user passed a directory or explicit TRD paths, use them; otherwise default to docs/TRD/

#### Step 1.2: Build the graph

Invoke the deterministic CLI to build and emit the dependency graph

- Resolve TRD_GRAPH_CLI to first existing path among, in order: (1) "$(git rev-parse --show-toplevel 2>/dev/null)/packages/development/lib/trd-graph-cli.js" (canonical monorepo root); (2) ${CLAUDE_PLUGIN_ROOT}/lib/trd-graph-cli.js; (3) packages/development/lib/trd-graph-cli.js (legacy CWD-relative); (4) the Pi/OMP vendor bundle path — resolve the ensemble-pi package's own declared install location via node -e "try{console.log(require.resolve('@sunstone-partners/ensemble-pi/package.json',{paths:[process.env.ENSEMBLE_PI_INSTALL_ROOT, require('os').homedir()+'/.omp/plugins', process.cwd()].filter(Boolean)}))}catch(e){process.exit(1)}" and join the directory of that output with /vendor/lib/trd-graph-cli.js. If missing, print error and HALT.
- Run: node "$TRD_GRAPH_CLI" graph <dir|paths> --format <json|mermaid|dot>
- Default to --format mermaid for a human-facing answer (renders in GitHub); use json when the caller needs machine output, dot for Graphviz
- Interpret exit code: 0 = acyclic, 2 = a dependency cycle was detected (report the cycle)
- Surface every stderr warning -- especially duplicate document_id collisions and unresolved cross-TRD references

#### Step 1.3: Report duplicate work

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
