# incident-triage eval

Scope: the `incident-triage` skill (`packages/quality`), run non-interactively on a reported production incident. Claude only (the skill reads a sibling template via `skill://`, which Pi loading one SKILL.md may not resolve; unproven). Plain invocation: the with-skill arm loads `packages/quality`, the baseline loads nothing, and both get the same prompt.

Fixture: `ops/` holds an incident report, a deploy log (v2.8.0 deployed 14:02 UTC with `DB_POOL_SIZE 50 -> 5`, committed by a named person), an alerts log (first alert 14:09 UTC, a pool-timeout log line, a named on-call person) and `src/db.js` with the pool size. The error rate is not measured, no rollback or smoke test happened, and nothing is approved.

What the checks cover (`evals/checks/incident-triage.js`):

- `postmortem-saved`: exactly one file `docs/postmortems/<YYYY-MM-DD>-<slug>.md`.
- `postmortem-sections`: the template's seven sections exist with content beyond placeholders.
- `timeline-from-records`: at least three timestamps, including 14:02 and 14:09 from the records.
- `unknowns-marked` (wording-based): Impact says unknown or not measured instead of inventing a rate.
- `root-cause` (wording-based): a confidence word (confirmed, probable, unknown) and a mention of the pool.
- `blameless`: neither named person appears anywhere in the postmortem.
- `recovery-not-overclaimed` (wording-based): no verified rollback, passed smoke test or restored service claimed.
- `actions-proposed`: at least one action listed and no bead id in it.
- `no-beads-created` and `noForbiddenCommand`: no `.beads/` and no `br create`/`bd create` (`--help` allowed, as the skill tells the agent to read it).
- `no-production-change`: `src/db.js` unchanged and nothing written outside `docs/postmortems/`.

Known limits: structure and planted facts only, not the quality of the diagnosis. Stabilisation (roll back, disable a flag, approval, release-agent, smoke-test-runner) is not exercised: there is no `gh` and no way to approve. The git history is one commit, so the timeline can only use `ops/`. The three wording-based checks can reject a harmless phrasing. `blameless` rejects any mention of the two names, including in a source column. The uplift measures the plugin's conventions (location, template, blameless rule, bead rule) against an unaided agent, not a well-prompted one.

A real trial must settle: whether the with-skill arm finds and reads `postmortem-template.md`; whether the baseline writes to `docs/postmortems/` at all (the prompt names the directory, not the filename format); whether the wording-based checks and `blameless` are too strict; whether agents try `gh` or other network calls and how they report them; whether the Impact section really says unknown.
