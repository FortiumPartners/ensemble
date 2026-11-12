### Phase 2: Architecture Design

#### Step 2.1: Domain Analysis

Map requirements to technical domains and detect companion artifact domains

- Map REQ-NNN requirements to technical domains, identify needed architectural patterns, and determine greenfield vs brownfield.
- Record COMPANION_DOMAINS: `data-model` when requirements change persistence (entities, schemas, tables, migrations, backfills, durable state); `research` when requirements need comparative technology/vendor/integration decisions that deserve independent review. Not for incidental data mentions, routine brownfield description, or an already-selected stack. Empty means no companion files are created.
- If $ARGUMENTS contains '--parser-tables': ignore the classification above and record COMPANION_DOMAINS as empty -- Foreman table mode writes exactly one parser-compatible TRD file and no companion artifacts.

#### Step 2.2: Capability Reuse Check

Reuse existing foundational work instead of duplicating it (dedup-by-reference)

- Resolve TRD_GRAPH_CLI per the tool-path-resolution skill for packages/development/lib/trd-graph-cli.js (HALT with an error if unresolved). Run `node "$TRD_GRAPH_CLI" capabilities docs/TRD --json` (an absent docs/TRD means an empty registry) and, for implicit matches, `node "$TRD_GRAPH_CLI" overlap docs/TRD`.
- If a foundational TRD already provides a needed capability, generate no duplicate tasks: add `[depends: <foundational-slug>#TRD-NNN]` (or `#PR-N`) on the dependent task and record it under `## Reused Capabilities` (capability -> foundational TRD label + document id). Reference by slug/document id only, never by label.
- If $ARGUMENTS contains '--parser-tables': do NOT add `[depends: <foundational-slug>#...]` annotations or any cross-TRD dependency to a task row -- keep the Dependencies column local-only (task IDs of this TRD) and record external reuse only under `## Reused Capabilities` as capability -> foundational slug/document id/ref (`<foundational-slug>#TRD-NNN` or `#PR-N`).
- If a capability is clearly reusable but no foundational TRD exists, recommend `/ensemble:create-trd <prd> --foundational`.

#### Step 2.3: Architecture Alternatives

Present architecture options for selection when the choice is genuinely open

- For a greenfield or ambiguous PRD, present 2-3 options (simplest; most scalable; best fit for the existing codebase or balanced) with pros, cons, complexity and risk, and ask the user to choose or combine. If the PRD or codebase already dictates the approach, state it and skip the options.
- --foreman: auto-select Option C (best fit / balanced) and print `Foreman mode: auto-selected Option C (<summary>)`.
- If $ARGUMENTS contains '--parser-tables' and does NOT contain '--foreman': skip the ask -- choose the best balanced option automatically unless the caller explicitly requested an interactive architecture review.

#### Step 2.4: System Architecture Design

Design the chosen approach

- Define component boundaries, data flow, integration points, and technology choices with rationale; describe the component relationships.
- If the PRD touches auth, PII, payments, file upload, external network exposure or new third-party integrations, invoke the `threat-model` skill and add its `## Threat Model` section.
