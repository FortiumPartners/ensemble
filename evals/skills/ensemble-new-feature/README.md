# ensemble-new-feature eval

## Scope

One scenario: `/ensemble-development:ensemble:new-feature docs/TRD/TRD-2026-5c0de1a7-slugify.md --foreman` against a seeded run (`.ensemble/new-feature/7f3a9c1e5b2d4086.json`, with `active.lock`) that is parked at `implementation_approval` with an `approval_wait` outcome: PRD and TRD refined, three beads planned, no approval yet. The path is the resume-by-artifact entry (Step 1.3); the bare `--foreman` resume cannot be the prompt because the loader rejects a prompt that starts with `-`. Claude Code only: the skill names RunIndexStore and a plugin command, so it is not a self-contained SKILL.md for Pi.

It covers one checkpoint of the skill, the Foreman auto-grant of the implementation approval (Step 3.5). The document-producing stages, PR stages, `--status`, `--abandon`, event entry and `--skip-refine` rejection are not exercised.

## What the checks cover

All read only the run file, `active.lock`, the seeded PRD/TRD and the file list in the workspace. Nothing is executed.

| Check | Fails when |
|---|---|
| `approval-recorded` | status is not `active`, stage is not `implementation`, or `implementationApprovedAt` is missing, invalid, or older than the seed |
| `approval-labelled-foreman` | the outcome is not `approval_wait`, or its detail does not name foreman policy and an approval/grant (an auto-grant must not read as a human one) |
| `single-mutation` | `revision` is not seed+1 or `updatedAt` did not advance (the store owns the bump; one `mutate()` call) |
| `no-pr-approval` | `prApprovedAt` is set, a `pr:` reference exists, or stage is `pr_*`/`done` |
| `lineage-intact` | `artifacts[]`, `beadRefs[]`, `runId`, `idea`, `createdAt` or `projectRoot` differ from the seed |
| `one-run-and-lock` | a second run file appears, or `active.lock` is gone or names another run |
| `nothing-else-written` | any file other than the run record, lock and the two seeded documents exists, or a seeded document's version changed |

## Known limits

- The checks see the record, not what the agent printed. The ERROR that Step 2.2 prints when it reaches the unwired `implementation` stage is not checked.
- RunIndexStore is TypeScript in `packages/agent-core`; the sandbox does not provide it, so a run is expected to hand-edit the JSON. `single-mutation` (revision bump) is the most likely flaky check for that reason; `approval-labelled-foreman` accepts any wording that names foreman and a grant.
- `projectRoot` is `.` in the fixture (real records hold an absolute path); `lineage-intact` requires it unchanged.
- Skill-invocation (`disable-model-invocation: true`) means the baseline arm gets the prompt only. It is expected to measure the plugin's conventions, not the model's inability to edit a JSON file.
- The skill's Step 3.2 advances `stage` to the next entry with outcome `success`, while Step 2.1 then takes the successor of that stage; the seed uses `approval_wait` at `implementation_approval` to stay clear of that ambiguity.

## What a real trial must settle

- Whether the with-skill arm resolves the command and the skill at all (`${CLAUDE_PLUGIN_ROOT}`, the `references/` files) and gets to the checkpoint.
- Whether a run edits the JSON by hand, calls RunIndexStore some other way, or stops; and whether `single-mutation` and the exact detail wording are too strict.
- Whether the baseline arm does the same (then the uplift is the plugin's presence, not the skill).
- Whether the run goes on after the grant and prints the unwired-implementation halt, or writes anything past it.

No measured results are recorded here.
