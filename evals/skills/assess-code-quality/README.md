# assess-code-quality eval

Scope: the `assess-code-quality` skill (package `assessment`) asked, in plain language and without naming the skill, to assess the code quality and technical debt of a small seeded repository and save the report to `docs/assessment/code-quality.md`. Claude only: the skill defers its scoring scale to `skill://assessment-report-suite`, so it is not a self-contained SKILL.md that Pi can load alone.

Fixture (`fixture/`): `ledgerly`, a small Node invoicing library. Planted facts: `src/billing.js` is over 300 lines and holds one oversized function (`buildStatement`); TODO, FIXME and HACK comments in several files (the check computes the exact counts from the fixture); `class customer_store` and `function Get_Customer` in `src/customers.js` break the naming convention; the same try/catch block (logging `operation failed:`) is repeated in `src/customers.js`, `src/reports.js` and `src/index.js`; an empty `catch {}` in `src/reports.js` swallows an error. Line numbers and counts are read from the shipped fixture at check time, so editing the fixture needs a check edit only if the planted text changes. The code is never executed.

What the checks cover (`evals/checks/assess-code-quality.js`):

| Check | Proves |
|---|---|
| report-saved | the report exists with the "Code Quality Analysis" title and is not a stub |
| sections-complete | the ten sections of the skill's Output Format are present, in order |
| score-format | `## Score: <1.0-5.0> / <Letter>`, numeric first, letter derived from the shared scale |
| largest-file | the first file in Largest Files is `src/billing.js`, with a size within 15% of its real line count |
| debt-counts | the TODO and FIXME counts equal the fixture's real counts (a HACK count, if given, too) |
| naming-violations | `customer_store` or `Get_Customer` is named and cited at its real line |
| duplication-found (flaky) | at least two of the three repeated try/catch blocks are cited, and the repetition is described |
| swallowed-error | the empty catch is cited at its real line and called out as empty or swallowed |
| complexity-hotspot | Complexity Concerns names `buildStatement` (or a range of `src/billing.js`) |
| before-after | Before/After Examples has a code block and labels a before and an after |
| citations-real (flaky) | at least six file:line citations over at least three files, all resolving to a real file and a line inside it |
| findings-recommendations | at least three numbered Key Findings (two cited) and two Recommendations |
| no-stray-writes | no fixture file changed or removed, nothing written outside `docs/assessment/` |

Known limits: structure and fixture-fact checks do not show that the analysis is insightful, that the score is deserved (no ceiling is asserted) or that the suggested refactorings are correct. Keyword matching in the flaky checks can reject a correct report worded differently, and the line windows around the duplicated block (a few lines either side) are a judgement call. The skill saves a report only when asked or given a path, so the prompt supplies the path; a report written elsewhere fails `report-saved`. The skill's `REPORT_PREFIX` path and its summary-only return are not exercised. The baseline arm gets the same prompt without the plugin and is expected to measure the plugin's conventions (section layout, score format, citations), not general ability.

What a real trial must settle: whether a real run saves to the requested path in the ten-section layout; whether `debt-counts` rejects reports that count differently from the fixture's `// MARKER` comments (for example counting the words in the report's own text, or reading `TODO:` only); whether the tolerances (15% on size, the duplication line window) are right; whether the flaky checks reject reports a reviewer would accept; whether a baseline run without the plugin passes the same checks (a high baseline pass rate would mean they are not discriminating); and the repeat count, time and cost.
