# assess-purpose eval

Scope: the `assess-purpose` skill (package `assessment`) asked, in plain language and without naming the skill, to infer what a small seeded repository is for from its code alone and save the report to `docs/assessment/purpose.md`. Claude only: the skill defers its scoring scale to `skill://assessment-report-suite`, so it is not a self-contained SKILL.md that Pi can load alone.

Fixture (`fixture/`): `pawdesk`, a small Node/Express/SQLite service for a veterinary clinic (owners and patients, appointments with a veterinarian and a clash check, vaccinations, a daily Twilio SMS reminder job, invoices). It has no real documentation. Its only document, `README.md`, is stale and describes an unrelated bakery, so a correct report must infer the clinic purpose from the code and not follow it. The code is never executed.

What the checks cover (`evals/checks/assess-purpose.js`):

| Check | Proves |
|---|---|
| report-saved | the report exists with the "Repository Purpose Analysis" title and is not a stub |
| sections-complete | the seven sections of the skill's Output Format are present, in order |
| tech-stack | Tech Stack names Node/JavaScript, Express, SQLite and at least three of the four dependencies in the fixture's package.json |
| purpose-fields | Inferred Purpose has Primary Function, Domain, Target Users and Key Capabilities with 3-8 items |
| domain-inferred | Domain and Primary Function identify an animal-care / clinic service |
| stale-readme-not-trusted | purpose, domain and users do not follow the stale bakery README |
| users-inferred | Target Users names clinic staff (front desk, veterinarians) |
| capabilities-cover (flaky) | Key Capabilities covers at least three of appointments, records/vaccinations, SMS reminders, invoicing |
| evidence-real (flaky) | at least five distinct file:line citations (inline or in the File Evidence table), all resolving to a real file and line, over at least three files, and at least three Evidence table rows |
| evidence-domain-lines (flaky) | at least one citation lands within a line of a source line that shows the domain (species, vaccinations, veterinarian) |
| confidence-assessment | Purpose, Domain and Users rows each rated HIGH, MEDIUM or LOW |
| unknowns-listed | at least two numbered Unknowns |
| score-format | `## Score: <1.0-5.0> / <Letter>`, numeric first, letter derived from the shared scale |
| recommendations-docs | at least two numbered Recommendations, each naming a kind of document |
| no-stray-writes | no fixture file changed or removed (the stale README is not "fixed"), nothing written outside `docs/assessment/` |

Known limits: these are structure and fixture-fact checks. They do not show that the inference is insightful, that the confidence ratings or the score are deserved (no ceiling is asserted), or that the capability list is complete. Keyword matching in the flaky checks can reject a correct report worded differently. The skill saves a report only when given a path, so the prompt supplies one; a report written elsewhere fails `report-saved`. The `REPORT_PREFIX` path (`<prefix>-purpose.md`) and the 5-line Return Summary are not exercised. The baseline arm gets the same prompt without the plugin and is expected to infer the purpose too, so the uplift measures the plugin's conventions (section layout, confidence table, numeric/letter score, file:line evidence, documentation recommendations), not the ability to read code.

What a real trial must settle: whether a real run saves to the requested path in the seven-section layout; whether the flaky checks and the keyword lists (domain, users, capabilities) reject reports a reviewer would accept; whether the stale README trap discriminates (does a real run ever follow it, and does one that mentions it in Evidence trip `stale-readme-not-trusted`); whether a baseline run without the plugin passes the same checks (a high baseline pass rate would mean they are not discriminating); and the repeat count, time and cost.
