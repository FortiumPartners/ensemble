# safe-migration eval

Skill: `packages/development/skills/safe-migration`. Scope: changing a database schema, a public API contract or a dependency (especially a major version); not ordinary refactors or new tables with no data.

## What the run does

The fixture is a small app: a TRD that asks for `users.fullname` to be split into `first_name` and `last_name`, one applied migration (`db/migrations/001_create_users.sql`), the code that reads `fullname`, and a constitution file. The prompt is non-interactive: write files only (there is no database), prepare the change for review, write no step that removes or renames `fullname`. The invocation is `plain`; the same prompt goes to both arms. Runtime: Claude only, because the skill names the `br` CLI (dependency upgrades), so it is not a self-contained SKILL.md for Pi.

## What the checks cover (`evals/checks/safe-migration.js`)

| Check | Proves |
|---|---|
| `plan-section` | a `## Migration Plan` (level 2 or 3) with at least 40 words exists in a TRD under `docs/TRD/` |
| `plan-phases` | the plan names expand, then migrate (or backfill, dual-write), then contract, in that order |
| `plan-dry-run` | the plan records a dry run on a copy or snapshot and row counts (word match; flaky) |
| `plan-approval-gate` | the plan ties the contract phase to approval, "approv" within 300 characters of "contract" (word match; flaky) |
| `expand-migration` | a new `.sql` file adds both new columns to `users`, nullable or with a default |
| `rollback-saved` | a rollback file (`docs/migrations/*rollback*`, or a down/rollback script under `db/`) with at least 3 non-blank lines |
| `rollback-content` | it names the real table or columns, has an undo command, and a document says how data is restored |
| `no-early-destructive` | outside `docs/` and rollback/down files, nothing drops or renames `fullname`, drops a table or truncates |
| `history-immutable` | the applied migration still creates `fullname` and was not edited to add the new columns (a guard: the seeded fixture passes it) |

## Known limits

- The checks test structure and safety gates, not whether the plan is right, the backfill is correct or the dry run was real. A plan that merely mentions the words passes `plan-phases`, `plan-dry-run` and `plan-approval-gate`.
- A run that edits the TRD but puts the plan under another heading fails by design: the skill prescribes `## Migration Plan`.
- The check script looks only at the SQL file layout the prompt names (`db/migrations/`); a run that ignores that instruction may fail `expand-migration` without being unsafe.
- `no-early-destructive` scans text files outside `docs/`; a destructive step written in a docs file or in a file named like a rollback is not seen. Nothing is executed and the checks cannot see commands a run would have issued.
- The dependency-upgrade and API-contract parts of the skill are not covered; one fixture covers the schema path only.

## What a real trial must settle

- Whether the baseline arm already writes a plan, a rollback file and an expand migration in these shapes (the eval then measures only the naming and location conventions).
- Whether the with-skill arm finds and follows the skill from a plain prompt without being named.
- Whether the prompt's sentence about not removing `fullname` leaves enough room for the run to plan the contract phase and write its rollback, and whether `plan-dry-run` and `plan-approval-gate` match the phrasing real runs use.
- Whether the 40-word floor, the 300-character window and the fixture's size suit real output, and how often a run saves its notes somewhere the checks do not look.
