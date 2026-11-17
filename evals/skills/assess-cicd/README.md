# assess-cicd eval

Scope: the `assess-cicd` skill (package `assessment`) asked, in plain language and without naming the skill, to assess the CI/CD pipeline and deployment automation of a small seeded repository and save the report to `docs/assessment/cicd.md`. Claude only: the skill defers its scoring scale to `skill://assessment-report-suite`, so it is not a self-contained SKILL.md that Pi can load alone.

Fixture (`fixture/`): `shipit`, a tiny Node service with one GitHub Actions workflow (`.github/workflows/ci.yml`: build, test, deploy-staging, deploy-prod), `scripts/deploy.sh`, a `Dockerfile` and Terraform in `infra/main.tf`. There is no GitLab, Jenkins, Azure DevOps or CircleCI configuration. Three problems are planted: a plaintext `REGISTRY_PASSWORD` in the workflow `env` block (ci.yml line 10; the other secrets use `secrets.*`), a production deploy that follows staging with no `environment:` protection or approval, and no rollback anywhere. The check script reads the line numbers from the shipped fixture. Nothing in the fixture is executed.

What the checks cover (`evals/checks/assess-cicd.js`):

| Check | Proves |
|---|---|
| report-saved | the report exists with the "CI/CD Analysis" title and is not a stub |
| sections-complete | the seven sections of the skill's Output Format are present, in order |
| score-format | `## Score: <1.0-5.0> / <Letter>`, numeric first, letter derived from the shared scale |
| discovery-correct | the Pipeline Discovery table marks GitHub Actions found and GitLab CI, Jenkins and Azure DevOps not found |
| stages-identified | the Pipeline Stages table has build, test and deploy rows; the report names the test command and the triggers |
| deploy-table (flaky) | the Deployment Strategy table shows production with no approval and no rollback, and staging with no rollback |
| plaintext-secret (flaky) | the plaintext credential is cited at its real line and called hard-coded or plain text |
| prod-gate (flaky) | the deploy-prod job is cited and described as lacking an approval or protection gate |
| rollback-gap (flaky) | the missing rollback is named in Weaknesses or Recommendations |
| iac-identified | Deployment Strategy reports the Terraform in `infra/main.tf` |
| citations-real (flaky) | at least five file:line citations over at least three files, all resolving to a real file and a line inside it |
| weaknesses-recommendations | at least one Strength, three numbered Weaknesses (two cited) and two Recommendations |
| no-stray-writes | no fixture file changed or removed, nothing written outside `docs/assessment/` |

Known limits: structure and fixture-fact checks do not show that the analysis is insightful or that the score is deserved (no ceiling is asserted). Table checks assume the skill's column layout (Platform, Config, Status; Stage, Strategy, Approval, Rollback) and read the last cell of a discovery row as its status. Keyword matching in the flaky checks can reject a correct report worded differently. The skill saves a report only when given a path, so the prompt supplies one; a report written elsewhere fails `report-saved`. The `REPORT_PREFIX` path (`<prefix>-cicd.md`) and the summary-only return are not exercised. The baseline arm gets the same prompt without the plugin and is expected to measure the plugin's conventions (section layout, discovery table, score format, citations), not general ability.

What a real trial must settle: whether a real run saves to the requested path in the seven-section layout; whether a run fills the Stage and Deployment tables for stages the repository lacks (a Dev row, for example) in a way the table checks tolerate; whether the flaky checks reject reports a reviewer would accept (citation line drift, wording of the secret, gate and rollback findings, a score line with extra text); whether the citation tolerance of one line for the planted lines is right; whether a baseline run without the plugin passes the same checks (a high baseline pass rate would mean they are not discriminating); and the repeat count, time and cost.
