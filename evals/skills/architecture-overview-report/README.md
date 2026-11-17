# architecture-overview-report eval

Scope: the `architecture-overview-report` skill (package `assessment`) turning per-repo `<repo>-<date>-architecture.md` files into a portfolio overview. The fixture is a five-repo portfolio under `docs/assessment/`: `acme-console`, `acme-bff` (with a Layering Assessment) and `acme-contracts` are linked through a Keycloak realm and a shared schema package; `legacy-billing` is standalone with no cross-repo edge; `ops-inventory` has only structural signals. The prompt is plain (no command, no skill name) and says there is no network. Runtime: Claude only, because the skill names `mermaid-cli` through `npx` and `skill://assessment-report-suite`.

## What the checks cover (`evals/checks/architecture-overview-report.js`)

| Check | What it requires |
|---|---|
| `overview-saved` | exactly one `docs/assessment/architecture-overview-<YYYY-MM-DD>.md`, an "Architectural Overview" title, `**Date:**` equal to the file name date, `**Sources:**`, a Portfolio System Context section |
| `sources-listed` | every `*-architecture.md` in the workspace is named in the overview |
| `mermaid-wellformed` | at least two blocks, first is `graph TB`, each starts with a graph/flowchart header, balanced brackets, quotes and subgraph/end, at least 2 edges and 3 labelled nodes, no unclosed fence |
| `context-edges` | the portfolio diagram has the documented console-bff, console-keycloak, bff-keycloak and contracts-consumer edges (undirected, by node id or label) |
| `isolated-not-merged` | no edge joins the standalone product to another platform, and the text calls it isolated or standalone |
| `lower-confidence-marked` | the structural-only repo is labelled inferred or lower-confidence, and any edge touching it is dotted or marked |
| `diagram-grounded` | every 4-5 digit number (port) in a diagram appears in a source file |
| `platform-diagram` | a non-portfolio diagram has the documented layers (controller, service, repository) with edges |
| `integration-table` | Integration point / Consumers / Evidence / Risk columns, at least 3 filled rows, the Keycloak and contracts rows name both consumers and cite `file:line` |
| `risks-ranked` | 5-8 risk items, each naming a source repo or component, the contract risk listed before the single-host billing risk |
| `only-assessment-docs` | nothing written except the overview and scratch `.mmd/.svg/.png`, source files intact |

## Known limits

- Mermaid is **not rendered** (the skill's own step needs network). `mermaid-wellformed` is a structural lint; a diagram can pass it and still fail `mermaid-cli`. The run is told to say so rather than claim validation; no check reads that statement.
- `context-edges`, `platform-diagram` and `risks-ranked` depend on node labels and wording (flaky if the model names nodes or layers differently); `risks-ranked` ordering is the most judgement-adjacent.
- `diagram-grounded` only checks numbers, not invented component names; it proves no accuracy of the prose.
- Nothing judges quality, correctness of the risk ranking beyond the one pair, or whether edges are traced to citations.

## What a real trial must settle

- Whether the node-name patterns (`console`, `bff`, `keycloak`, `contracts`, `billing`, `inventory`) and layer terms match how a model really labels diagrams, or are too strict.
- Whether the baseline arm already produces `architecture-overview-<date>.md` and the four-column table without the plugin (the plugin's conventions are what the uplift measures).
- Whether a run that tries `npx mermaid-cli` offline stalls or exhausts turns within `maxTurns` 30 and the 900 s timeout.
- Whether a structural lint that passes correlates with diagrams that render.
