### Phase 3: Task Breakdown and Planning

#### Step 3.1: Master Task List Generation

Generate task list with TRD-NNN IDs and traceability annotations

- If $ARGUMENTS contains '--parser-tables': skip this step -- Foreman table mode replaces this phase's task generation with the three steps titled '(--parser-tables)' at the end of this phase.
- Generate sequential TRD-NNN IDs.
- Every task line MUST begin with a GitHub checkbox -- `- [ ] ` (or `- [x] ` if already complete) -- immediately before **TRD-NNN**; without it trd-cli.js and implement-trd-beads create zero task beads.
- Each task includes: description, hour estimate (Nh), [satisfies REQ-NNN] annotation (use [satisfies INFRA] or [satisfies ARCH] when there is no direct REQ), a `Validates PRD ACs:` field listing the AC-NNN-M items covered, and an `Implementation AC:` checklist of Given/When/Then items.

#### Step 3.2: Test Task Generation

Generate a paired test task for every user-facing implementation task

- If $ARGUMENTS contains '--parser-tables': skip this step.
- For every user-facing TRD-NNN task generate a TRD-NNN-TEST task. Every TRD-NNN-TEST line MUST begin with the same checkbox-prefix requirement as implementation tasks -- `- [ ] ` (or `- [x] ` if already complete) -- immediately before **TRD-NNN-TEST**.
- Test tasks carry `[verifies TRD-NNN] [satisfies REQ-NNN] [depends: TRD-NNN]` annotations and a `Validates PRD ACs: AC-NNN-M, ...` field.
- Under each test task add a `Test AC:` checklist with one single-line `- [ ] Scenario: <title> -- Given <...>, When <...>, Then <...>` item per AC-NNN-M in its Validates PRD ACs, indented strictly deeper than the `Test AC:` label (items at the same or shallower indent are silently dropped by the parser). This is the only place scenario text goes; no separate `## Scenarios` heading.
- If BDD_MODE.enabled each test task carries >=3 scenario items and implement-trd-beads routes `-TEST` tasks through Reqnroll ("TRD commands" in `packages/reqnroll/skills/reqnroll/SKILL.md`); otherwise write one item per AC-NNN-M and never mention Reqnroll.

#### Step 3.3: Dependency Mapping and PR Boundary Design

Organize tasks into shippable PR stack boundaries based on dependency order

- If $ARGUMENTS contains '--parser-tables': skip this step.
- Add [depends: TRD-NNN] annotations, keep the graph acyclic, and flag 8h+ tasks for breakdown.
- Group tasks under `### PR N:` headings (not Phase/Sprint) -- each a shippable vertical slice that is independently reviewable, passes its tests in isolation, and leaves no user-visible route returning 404/500 because of later PRs.
- Immediately after each `### PR N:` heading write a `**Shippable State:**` line: one sentence describing the user-observable capability after the PR merges. Infrastructure-only statements ('scaffolding complete') are not acceptable. This section is machine-parsed by implement-trd-beads to create stacked PRs.

#### Step 3.4: Foreman Master Task List Generation (--parser-tables)

Generate a parser-compatible Foreman task breakdown with deterministic markdown tables

- Runs only when $ARGUMENTS contains '--parser-tables' (Foreman table mode). If it is absent, skip this step and the two steps after it. It replaces Master Task List Generation.
- Task IDs follow `[A-Z]+-T\d+` (e.g. `FSC-T001`, `AUTH-T001`). Organize work under `### N.M Sprint N` headers and `#### Story N.M` headers only.
- Immediately after each `### N.M Sprint N` heading write a **Shippable State:** line: one sentence on the visible capability available once every task in the sprint is done (e.g. 'Users can log in with email/password; profile editing is not yet available'). Infrastructure-only statements are not acceptable.
- For every story emit a markdown table with exact headers `id | task | estimate | dependencies | files | status`. **CRITICAL**: the first header must be exactly `id` (lowercase), not `ID`, `TRD ID` or `Task ID`; the second must be `task`, `description`, or `title`; `status` is required.
- Set every Status cell to `[ ]` so Foreman creates dispatchable native tasks, not completed ones. Dependencies reference other task IDs exactly as strings. Rows are implementation-oriented and deterministic, never prose narratives.

#### Step 3.5: Foreman Test Task Generation (--parser-tables)

Generate paired validation tasks that still satisfy Foreman table parsing

- Runs only when $ARGUMENTS contains '--parser-tables'. If it is absent, skip this step. It replaces Test Task Generation.
- For every user-facing implementation task add a validation/test task using the same table format (never narrative bullet lists), with the prerequisite implementation task IDs in the Dependencies column rather than free-form annotations. Cover at least one happy path and one edge case per major feature area. All test/validation Status cells must also be `[ ]`.

#### Step 3.6: Foreman Dependency Mapping (--parser-tables)

Organize tasks by dependencies and plan sprint phases

- Runs only when $ARGUMENTS contains '--parser-tables'. If it is absent, skip this step. It replaces Dependency Mapping and PR Boundary Design.
- Build a dependency graph from the Dependencies column values, identify the critical path, flag tasks estimated at 8h+ for breakdown, and organize tasks into sprints/phases by dependency order.
- Ensure no circular dependencies, no dependency points to a task ID absent from the final TRD tables, and dependency ordering holds (if Task A depends on Task B, B appears before A).
