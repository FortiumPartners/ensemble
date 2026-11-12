---
name: ensemble-assess
description: >-
  Single entry point for the ensemble-assessment skills. The first argument
  keyword (repo, team, config, report) loads the matching assessment skill by
  name and follows it; `repo --only <dimension>` runs one repository dimension
  through its leaf skill instead of the full parallel assessment. Passes the
  rest of $ARGUMENTS through unchanged and does not re-implement any assessment
  logic.
disable-model-invocation: true
user-invocable: false
metadata:
  version: "1.0.0"
---
<!-- Command: ensemble-assess | Version: 1.0.0 -->
<!-- Description: Dispatch to a repository, team, config, or report assessment by keyword; repo --only <dimension> runs a single dimension -->

# ensemble-assess

> **Mission:** Single entry point for the ensemble-assessment skills. The first argument keyword (repo, team, config, report) loads the matching assessment skill by name and follows it; `repo --only <dimension>` runs one repository dimension through its leaf skill instead of the full parallel assessment. Passes the rest of $ARGUMENTS through unchanged and does not re-implement any assessment logic.

## Phase 1: Dispatch

### Step 1: Route by first argument token

Parse $ARGUMENTS; the first token selects the assessment skill to load

**Actions:**
1. Parse $ARGUMENTS. The first whitespace-delimited token selects an assessment by its keyword below; the remaining text, unmodified, becomes that skill's own input (for example the path or scope the user wants assessed).
2. If the first token matches no keyword, or $ARGUMENTS is empty: print the keyword table below (keyword + one-line description) and HALT without side effects.
3. `repo` -> `skill://assess-repo` - Full repository assessment: purpose first, then architecture, code quality, testing, security, AI readiness and CI/CD in parallel, synthesized into one report under docs/assessment/
4. `team` -> `skill://assess-team` - Team assessment: commit messages, code quality, test coverage, AI adoption, documentation and code review (team-level by default)
5. `config` -> `skill://assess-config` - Create portfolio-local assessment configuration: code roots, repository and issue-tracker hosts, secret-safe credential wiring and local output paths
6. `report` -> `skill://assessment-report-suite` - End-to-end executive package: assess-repo and assess-team, the AI Readiness Diagnostic workbook, a markdown executive summary and a PowerPoint brief

### Step 2: Resolve a single-dimension repo run

--only <dimension> applies to repo only; it replaces the full assessment with one leaf skill

**Actions:**
1. `--only <dimension>` is accepted with `repo` only. When it is present, remove it and its value from the argument text that is passed through.
2. If `--only` is present with any other keyword: say that `--only` applies to `repo` only, and HALT without side effects.
3. If `--only` has no value, or its value is not a dimension below: print the dimension table below (dimension + leaf skill) and HALT without side effects.
4. `purpose` -> `skill://assess-purpose` - Infer the repository's purpose, domain and target audience from code alone
5. `architecture` (alias `architect`) -> `skill://assess-architect` - Architecture and structure
6. `code-quality` -> `skill://assess-code-quality` - Code quality, patterns and technical debt
7. `testing` -> `skill://assess-testing` - Test coverage and quality
8. `security` -> `skill://assess-security` - Security patterns and vulnerabilities
9. `ai-readiness` -> `skill://assess-ai-readiness` - AI agent compatibility
10. `cicd` -> `skill://assess-cicd` - CI/CD pipelines and deployment automation
11. A valid `--only <dimension>` replaces the `repo` route: load that dimension's leaf skill instead of `assess-repo` and run it stand-alone. Do not load `assess-repo`, do not launch the parallel dimension tasks and do not write the combined report. This command supplies no output path or REPORT_PREFIX, so the leaf reports its findings in the response and saves docs/assessment/<dimension>.md only if the user asks.

### Step 3: Load the skill and follow it

Hand off to the selected skill by name, with the remaining argument text

**Actions:**
1. Load the selected skill by name (the `skill://<name>` form above, or your runtime's skill loader) and follow it, passing the remaining argument text through unmodified. Do not re-implement any of its phases here.
2. If your runtime cannot load a skill by name, read that skill's `SKILL.md` file yourself (it ships under `skills/<name>/` in the ensemble-assessment package) and follow its full text.
