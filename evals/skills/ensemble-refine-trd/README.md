# ensemble-refine-trd eval

## Scope

A non-interactive (`--foreman`, explicit TRD path) refine-trd run on a small PR-format TRD, `docs/TRD/TRD-2026-c3d4e5f6-slugify.md`
(version 1.0.0), written against the locked slugify PRD it cites. The TRD is seeded with defects the skill's Synthesis step looks for:

- `TRD-003` has no `[satisfies REQ-NNN]` annotation;
- `TRD-002` has no paired `TRD-002-TEST`;
- `### PR 2:` has no `**Shippable State:**` line;
- the traceability matrix is stale (no REQ-003 row, no `TRD-002-TEST`);
- the frontmatter carries no Design Readiness score.

Under `--foreman` the skill applies every finding, so a good run fixes all of them. The eval is Claude only: the skill resolves `trd-cli`
through the tool-path-resolution tiers, which fail on Pi in a sandbox without an ensemble-pi bundle (same reason as `ensemble-create-trd`).
It is command-driven, so the with-skill arm types `/ensemble-development:ensemble:refine-trd` first; the baseline arm gets the same
prompt without it and is expected to measure the plugin's conventions (patch bump, changelog entry, Shippable State, matrix refresh).

## What the checks cover

`evals/checks/ensemble-refine-trd.js`, plus the built-in `trdParses` grader:

| Check | Proves |
|---|---|
| `trdParses` | the real trd-cli still parses the TRD with at least one task |
| `refine-in-place` | the seeded file is still there and is the only TRD (no regenerated copy) |
| `refine-identity` | Document ID and Label unchanged |
| `refine-version` | frontmatter version is 1.0.1 |
| `refine-changelog` | an entry for 1.0.1 and the 1.0.0 entry kept |
| `tasks-kept` | no seeded task removed; every task line keeps its `- [ ]` prefix |
| `task-links` | unique task ids; every `[satisfies]` names a PRD requirement; every `[Depends:]` resolves; `TRD-003` now has a `[satisfies]` |
| `test-paired` | `TRD-002` now has a `TRD-002-TEST` (or a test task `[Verifies TRD-002]`) |
| `shippable` | every `### PR N:` in the Master Task List is followed by a `**Shippable State:**` line |
| `traceability` | the traceability matrix names REQ-001..003 and `TRD-002-TEST` |
| `readiness` | `design_readiness_score` is a number from 1 to 5 |
| `prd-untouched` | the PRD keeps version 1.0.1 and status Locked |
| `no-impl-files` | nothing written outside `docs/` |

Each can fail on a wrong output; `evals/tests/skills/ensemble-refine-trd.test.js` holds one for each, and shows that the seeded TRD
alone fails the refinement checks. The check script was also run on a shipped TRD (`docs/TRD/TRD-2026-82b6a138-pr-review-cycle-time.md`).

## Known limits

- Structure and preservation only. Whether the chosen defaults, task splits or readiness score are good is not judged.
- `shippable` checks that the line exists and has text, not that the state is user-observable (the infrastructure-only rewrite is not checked).
- `traceability` checks that ids are mentioned in the section, not that each row is correct.
- The closing go/no-go (`--foreman` records GO and prints no implement command before it) and the configure-team suggestion are
  not checked: they depend on the transcript and on a task-count delta the small fixture does not reach.
- The `--collab`, `--long-lived` and `--list` paths and the `[NEEDS CLARIFICATION]` fallback are not exercised.
- The version, changelog and score checks assume the conventions in `references/phase-5-output-management.md`; a skill change to them needs the checks changed too.

## What a real trial must settle

- Whether a run resolves `trd-cli` in the sandbox (the Claude plugin root) and reaches the Validation step, or halts.
- Whether the baseline arm already applies the patch bump, changelog, Shippable State and matrix refresh, which decides if the uplift is the skill's.
- Whether a run may legitimately split or merge tasks, or add a second test task, in ways the `tasks-kept` and `test-paired` checks reject or accept wrongly.
- Whether the Design Readiness score is written in frontmatter as `design_readiness_score` as the seeded real TRDs do, or elsewhere.
- Run-to-run variance and cost: no run has been made.
