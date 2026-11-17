# ensemble-configure-team eval

## Scope

A non-interactive run of `/ensemble-development:ensemble:configure-team` on a seeded TRD (`fixture/docs/TRD/TRD-2026-c0ffee01-notes-api.md`): 12 tasks in the Master Task List (8 in the canonical checkbox shape, 4 in the nested-description shape), 72 estimated hours, a five-task dependency chain (TRD-001 to TRD-005), and backend, frontend, database, infrastructure, documentation and testing work. 72 hours exceeds the 60-hour Complex threshold, so the expected tier is Complex whatever the keyword matcher does with the domains. The skill should inject one `## 4.1 Team Configuration` section between the Master Task List and `## 5. Quality Requirements`.

The prompt does not pass `--team`, so the marketplace phase (Phase 4) does not run. The fixture has no constitution file: the skill does not read one.

## What the checks cover (`evals/checks/ensemble-configure-team.js`)

| Check | Proves |
|---|---|
| `section-injected` | Exactly one Team Configuration heading, after the Master Task List and before Quality Requirements. |
| `metrics-counts` | The section states 12 tasks and 72 hours (so the nested-description shape was counted). |
| `tier-complex` | The tier word is Complex. |
| `domains` | At least 3 domains stated, backend and frontend named in the metrics. |
| `depth` | Dependency depth 4 or 5 (links or tasks in the chain). |
| `lead-role` | tech-lead-orchestrator owns task-selection, architecture-review and final-approval. |
| `builders` | Builder role owns implementation; two or more distinct builder agents, each defined under `packages/*/agents/`. |
| `complex-roles` | A reviewer role (code-reviewer) and a qa role (test-runner) exist. |
| `trd-preserved` | With the section cut out, the TRD equals the seeded one (whitespace-normalised). |
| `no-stray-files` | No file other than the seeded TRD was written (`.ensemble/` and `.beads/` tool state aside). |

The yaml block is read by a small line parser (no YAML dependency) that accepts both the `roles:` list shape the skill prescribes and the `lead:` / `builders:` shape seen in shipped TRDs.

## Known limits

- Structure and derived numbers only. The checks do not judge whether the chosen builders are the best fit for each task, or whether the per-task assignments, if any, are sensible.
- Not covered: the Simple-tier skip, the Medium tier (lead and builder only), `--team` / `--no-team`, the marketplace gap analysis and plugin installation, replacing a stale `## 4.1 Team Configuration` block from an earlier run, and the `injection_ok` summary text.
- `depth` accepts both ways of counting a chain; `builders` needs two distinct builder agents (the default mapping gives three for this TRD; a registry with an unusual keyword match could collapse that, which would show as a spurious failure). `agent` names are validated against this repository's `packages/*/agents`, so a runtime-only agent of an installed plugin would be rejected.
- The reviewer and qa agents are held to the skill's own rule (code-reviewer, test-runner). A shipped TRD (`TRD-2026-020`) was hand-edited to use `qa-orchestrator` there and would fail `complex-roles`; that is intended, the check follows the skill, not that edit.
- The metric parsers read the first number after the label with a bounded run of punctuation, so table, `key=value` and prose forms all work; a wholly different layout (the number far from its label) would fail with a "not stated" reason.
- Claude only: the skill scans `packages/*/agents` and `~/.omp/plugins` directories, so a Pi arm would depend on the host install.

## What a real trial must settle

- Whether the with-skill arm reaches all ten checks reliably, and which check is the first to fail when it does not (a skill-prose problem or a check that is too strict).
- Whether the baseline arm, given the same prompt without the plugin, reproduces the section heading, position, role schema and Complex roles, or fails some of the checks; the difference is the uplift.
- Whether the skill, run from a bare sandbox with no vendored packages and no installed plugins, finds the full agent roster (it should fall back to the default mapping) or substitutes agents that `builders` rejects.
- Whether a real run is within the time and turn limits (`maxTurns` 40, `timeoutSec` 900), given the filesystem scans of Phase 3.
- Whether a TRD hand-edited after a prior run (stale block, Medium tier, `--team`) needs its own fixture.
