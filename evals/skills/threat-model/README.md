# threat-model eval

Skill: `threat-model` (`packages/quality/skills/threat-model/SKILL.md`). Invocation `plain`; runtimes `claude` and `pi` (the SKILL.md is self-contained: it names no CLI, script or plugin path).

## Scope

One positive case. The fixture is a locked PRD and a draft TRD for an account service (password sign-in with JWT, a profile holding email and phone number, an avatar upload to S3, a third-party email API), so authentication, PII and file upload are all triggered. The prompt asks, non-interactively, for a threat model in that TRD, edited in place. The seeded TRD has seven tasks in the checkbox grammar and no Threat Model section.

## What the checks cover (`evals/checks/threat-model.js`)

| Check | Proves |
|---|---|
| `trd-intact` | still exactly one TRD file; Master Task List heading and the seven seeded tasks survive |
| `trdParses` (built-in) | `trd-cli` still parses the TRD with at least seven tasks |
| `section-shape` | one level-2 `## Threat Model`; Assets, Trust Boundaries, Threats and Mitigations, Residual Risks, in order, none empty |
| `assets-boundaries` | at least two assets and two trust boundaries listed |
| `threat-table` | a table with Boundary, STRIDE, Threat, Likelihood/Impact, Mitigation and task columns; at least three rows; a STRIDE category and an L/M/H rating on each |
| `mitigations-concrete` | no N/A, empty, slogan ("best practices") or very thin mitigation; not one text repeated on every row |
| `mitigation-tasks` | every row names a `TRD-NNN` ID and each ID is a task defined in the TRD outside the section (a dangling ID fails) |
| `no-task-checkboxes` | no checkbox lines inside the section; no task ID defined twice |
| `new-tasks-grammar` | a task the table references that was not seeded is a `- [ ] **TRD-NNN**` line in the Master Task List with `[satisfies ...]` and `Implementation AC:` (passes vacuously when every mitigation maps to a seeded task) |
| `real-names` (soft) | at least three of the five real component names appear in the section |
| `covers-areas` (soft) | authentication, PII and upload each appear in the section |
| `residual-risks` | Residual Risks has content, not a bare placeholder |
| `no-impl-files` (from `pilot-checks.js`) | nothing written outside `docs/` |

`real-names` and `covers-areas` match words and can reject a harmless rewording; the others are structural. All checks are offline, read the workspace without following symlinks and run no workspace code.

## Known limits

- Structure and bookkeeping only. Nothing judges whether a threat is credible, a mitigation sound, or STRIDE applied correctly.
- No negative case: an eval has one prompt, so "a TRD with none of the trigger areas gets no section" is not exercised. The checks would not flag a section added to such a TRD.
- The skill's "do not duplicate controls" and "record unclear boundaries as open questions" rules are not checked.
- The Master Task List grammar is the checkbox form the skill names; a TRD in the heading form (`### TRD-NNN:`) is accepted for defined IDs, but a new task must use the checkbox form.
- The baseline arm is expected to measure the plugin's conventions (section layout, task-ID mapping, no checkbox lines), not threat-modelling ability. A model that knows STRIDE can pass several checks without the skill.

## What a real trial must settle

- Whether a real agent writes the table in a shape `threat-table` accepts (column names, `L/M/H` cells), or whether the checks are too strict on harmless layouts.
- Whether `real-names` and `covers-areas` reject good output for wording.
- Whether the with-skill arm actually adds missing tasks (exercising `new-tasks-grammar`) or maps everything to seeded tasks.
- Whether Pi, loading the skill alone, follows it.
- Baseline and with-skill pass rates and reliability. None are recorded here.
