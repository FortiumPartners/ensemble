# assess-testing eval

Scope: the `assess-testing` skill (package `assessment`) asked, in plain language and without naming the skill, to assess the test coverage and test quality of a small seeded repository and save the report to `docs/assessment/testing.md`. Claude only: the skill defers its scoring scale to `skill://assessment-report-suite`, so it is not a self-contained SKILL.md that Pi can load alone.

Fixture (`fixture/`): `ledgerly`, a small Node invoicing service. `src/` has six modules: `tax.js` and `invoice.js` (tested), `payments.js`, `auth.js`, `db.js` and `server.js` (no test). `test/` has two Jest files, named `*-check.js` (and selected by `testMatch` in `package.json`) so that the repository-wide jest run does not collect them. `package.json` configures Jest with a `coverageThreshold` of 80 lines. One GitHub Actions workflow runs `npm test`. Planted: a test with no assertion (`formats a total`) and a skipped test (`it.skip`) in `test/invoice-check.js`, state shared and mutated across tests there, no integration or end-to-end test and no mocks, and a CI test step with `continue-on-error: true` and no coverage collection (so the threshold is never enforced). The check script reads the line numbers from the shipped fixture. Nothing in the fixture is executed.

What the checks cover (`evals/checks/assess-testing.js`):

| Check | Proves |
|---|---|
| report-saved | the report exists with the "Testing Analysis" title and is not a stub |
| sections-complete | the eight sections of the skill's Output Format are present, in order |
| score-format | `## Score: <1.0-5.0> / <Letter>`, numeric first, letter derived from the shared scale |
| projects-table | the Test Projects table names Jest in its Framework column and no other framework |
| coverage-summary (flaky) | the four bullets carry a percentage, the figures are marked as estimates, and they are plausible (API Layer and Data Access at most 40, Overall at most 60, since nothing tests `server.js` or `db.js` and four of six modules have no test) |
| gaps-found (flaky) | Coverage Gaps reports `payments` and `auth` as lacking tests |
| no-false-gaps (flaky) | Coverage Gaps does not list `tax` or `invoice` as untested |
| quality-no-assertion (flaky) | the assertion-free test is reported, by citation of `test/invoice-check.js` near its line or by name, and described as having no assertion |
| quality-skipped (flaky) | the skipped test is reported |
| strategy-gaps (flaky) | Test Strategy mentions unit tests and says integration and end-to-end tests are missing |
| ci-nonblocking (flaky) | the `continue-on-error` test step is cited or named and described as letting failures through |
| citations-real (flaky) | at least four file:line citations over at least three files, all resolving to a real file and a line inside it |
| findings-recommendations | at least three numbered Key Findings (two cited) and two Recommendations |
| no-stray-writes | no fixture file changed or removed, nothing written outside `docs/assessment/` (no test was added or fixed) |

Known limits: structure and fixture-fact checks do not show that the analysis is insightful or that the score is deserved (no ceiling or floor is asserted). Nothing runs the tests or measures coverage, so the coverage figures are only bounded for plausibility, not checked for accuracy. Table checks assume the skill's column layout (a Framework column; Module, Coverage, Gap Type). The Coverage Summary check finds each bullet by its label (Overall, Business Logic, API Layer, Data Access) and accepts the skill's own `~N%` as the estimate marker. Keyword matching in the flaky checks can reject a correct report worded differently. The skill has no CI section in its Output Format, so the CI finding may land in Key Findings, Test Strategy or Recommendations (the check looks in all of them). The skill saves a report only when given a path, so the prompt supplies one; a report written elsewhere fails `report-saved`. The `REPORT_PREFIX` path (`<prefix>-testing.md`) and the summary-only return are not exercised. No real report of this kind ships in the repository, so the checks are calibrated only against the skill's own Output Format and a hand-written report. The baseline arm gets the same prompt without the plugin and is expected to measure the plugin's conventions (section layout, project table, score format, citations), not general ability.

What a real trial must settle: whether a real run saves to the requested path in the eight-section layout; whether the percentage bounds in coverage-summary reject a reasonable estimate (a model may give business logic a high figure and use `N/A` for layers); whether runs report the planted defects in words the flaky checks accept, and where they put the CI finding; whether the Coverage Gaps table is written per module or per layer, and whether the gaps checks tolerate that; whether a run lists a tested module as a gap because of the skipped or assertion-free tests; whether the citation tolerance of one line is right; whether a baseline run without the plugin passes the same checks (a high baseline pass rate would mean they are not discriminating); and the repeat count, time and cost.
