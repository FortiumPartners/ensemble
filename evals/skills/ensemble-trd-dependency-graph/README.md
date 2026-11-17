# ensemble-trd-dependency-graph eval

Scope: `/ensemble-development:ensemble:trd-dependency-graph` (skill `ensemble-trd-dependency-graph`, package `development`) on four seeded TRDs in `fixture/docs/TRD/`. Claude only (step 1.2 resolves `trd-graph-cli` through tiers that fail in a Pi sandbox).

The fixture:

| TRD (short name) | role |
|---|---|
| inventory | foundational; no dependencies |
| checkout | depends on `inventory#TRD-001`; targets `src/Cart.js`, `src/Pricing.js` |
| promotions | depends on `inventory#TRD-001`; targets `src/Pricing.js`, `src/Promo.js` |
| reports | one dangling reference to `checkout#TRD-009` (no such task); one bare `[depends: TRD-001]` (intra-TRD, no edge) |

Expected (confirmed with `packages/development/lib/trd-graph-cli.js` against the fixture): edges `checkout --> inventory` and `promotions --> inventory`; one overlap, checkout and promotions on `src/Pricing.js`; one warning for `checkout#TRD-009`; no cycle.

The skill only prints. The prompt therefore asks for the report in `docs/trd-graph-report.md` so a script can read it.

## What the checks cover (`evals/checks/ensemble-trd-dependency-graph.js`)

- `report-saved`: the file exists, is not a stub, names all four TRDs.
- `graph-edges`: both real edges are drawn as arrow lines, dependent to dependency (Mermaid `-->` or DOT `->`; letter ids resolved through node definitions).
- `graph-edges-only`: no other edge (not for the dangling reference, not for the overlap, nothing reversed); fails when no edge can be read.
- `overlap-reported`: a passage names checkout, promotions and `src/Pricing.js` with an overlap word.
- `overlap-only-pair`: no line puts `src/Pricing.js` on inventory or reports.
- `extract-suggested`: a passage about the shared pricing work advises extracting or consolidating into a foundational or shared TRD and mentions depending on or referencing it. The most phrasing-sensitive check.
- `warning-surfaced`: a passage with `TRD-009` that calls it unresolved, unknown, missing or similar.
- `trds-untouched`: the four TRDs keep their sentinel lines and `docs/TRD` gains or loses no file (the skill is read-only).

## Known limits

- All checks are textual. They cannot tell whether the graph came from `trd-graph-cli` or was built by hand (the skill forbids that), and say nothing about the quality of the advice.
- A graph given only as prose, or as JSON, has no arrow lines and fails the edge checks. The prompt asks for Mermaid.
- Arrow direction (dependent to dependency) is the CLI's convention. A baseline that draws it the other way fails `graph-edges`; that is a convention the eval measures, not a bug.
- `overlap-reported` and `warning-surfaced` look at blank-line separated passages; a report without blank lines is one passage.
- Cycle detection is not exercised (the fixture is acyclic), and the exit codes (0 acyclic, 2 cycle or overlap) are not visible to the checks.
- The uplift is the package's, not the skill's alone: both the command and the skill live in `packages/development`.

## What a real trial must settle

- Whether the with-skill arm resolves `trd-graph-cli` in the sandbox (`${CLAUDE_PLUGIN_ROOT}` is the only tier that can work there). If it halts, every check but `trds-untouched` fails and the eval is not skill-attributable.
- Whether a real run writes the report where the prompt asks, and whether its wording passes `overlap-reported`, `extract-suggested` and `warning-surfaced` as written.
- Whether the baseline arm can pass at all, and which checks separate the arms.
- Whether the Mermaid shapes models produce (aliases, edge labels, subgraphs) are all read by the edge checks.
