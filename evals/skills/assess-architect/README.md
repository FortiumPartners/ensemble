# assess-architect eval

Scope: the `assess-architect` skill (package `assessment`) asked, in plain language and without naming the skill, to analyse the architecture of a small seeded repository and save the report to `docs/assessment/architecture.md`. Claude only: the skill defers its scoring scale to `skill://assessment-report-suite`, so it is not a self-contained SKILL.md that Pi can load alone.

Fixture (`fixture/`): `orderdesk`, a small Node service (controllers, services, repositories, `src/shared`, a BullMQ worker, Postgres and Redis in `configs/app.json`). Two dependency problems are planted at known lines: `src/repositories/orderRepository.js` imports the controller (upward dependency and a cycle), and `src/controllers/orderController.js` imports the repository directly (skips the service layer). The check script reads those line numbers from the shipped fixture, so editing the fixture does not need a check edit unless the import text changes. The code is never executed.

What the checks cover (`evals/checks/assess-architect.js`):

| Check | Proves |
|---|---|
| report-saved | the report exists with the "Architecture Analysis" title and is not a stub |
| sections-complete | the nine sections of the skill's Output Format are present, in order |
| score-format | `## Score: <1.0-5.0> / <Letter>`, numeric first, letter derived from the shared scale |
| diagram-valid | a Mermaid `graph`/`flowchart` with a direction, at least four edges and balanced brackets |
| diagram-components (flaky) | the diagram names the entry point, the three layers and an external dependency |
| layers-identified | the Layering Assessment names presentation, business, data and shared layers |
| violation-upward | the repository-imports-controller problem is cited at its real line and described as a violation or cycle |
| violation-skip (flaky) | the controller-imports-repository problem is cited at its real line |
| citations-real (flaky) | at least six file:line citations over at least three files, all resolving to a real file and a line inside it |
| integrations-named | Postgres, Redis and the queue appear in Integration Patterns |
| scalability-constraints (flaky) | at least two of database connections, cache, background jobs, with a configured value |
| key-issues-recommendations | at least three numbered Key Issues (two cited) and two Recommendations |
| no-stray-writes | no fixture file changed or removed, nothing written outside `docs/assessment/` |

Known limits: structure and fixture-fact checks do not show that the analysis is insightful or that the score is deserved (no ceiling is asserted). Mermaid is only linted for structure, nothing renders it offline. Keyword matching in the flaky checks can reject a correct report worded differently. The skill says to save a report only when asked or given a path, so the prompt supplies the path; a report written elsewhere fails `report-saved`. The skill's `REPORT_PREFIX` path (`<prefix>-architecture.md`) is not exercised. The baseline arm gets the same prompt without the plugin and is expected to measure the plugin's conventions (section layout, score format, citations), not general ability.

What a real trial must settle: whether a real run saves to the requested path in the nine-section layout; whether the flaky checks reject reports a reviewer would accept (citation line drift, wording of the layers and constraints, a score line with extra text); whether the line tolerance of one for the planted imports is right; whether a baseline run without the plugin passes the same checks (a high baseline pass rate would mean they are not discriminating); and the repeat count, time and cost.
