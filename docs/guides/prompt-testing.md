# Prompt Testing Policy

## Policy

Do not pin prompt wording. A test that does `expect(yamlText).toContain('If STARTED_COUNT == 0')` against a command, agent or SKILL.md (or its generated `.md`/pi/codex output) fails whenever the prompt is reworded or trimmed, and it proves nothing about model behavior.

- **Test behavior of code.** CLIs, parsers, planners and generators (`trd-parser`, `trd-cli`, `scaffold-planner`, transformers) get ordinary behavioral tests with fixtures.
- **Test machine contracts structurally.** If a parser, generator or loader depends on a prompt feature (required frontmatter keys, `name`, TRD grammar markers, declared arguments, agent references that must resolve), assert that feature by parsing the file, not by matching prose.
- **Test model behavior with evals.** Whether a model follows an instruction belongs in `evals/`, not in string matching.
- **Prompt size is a budget, not a wording check.** See `scripts/tests/prompt-budget.test.js`.

Classes used below: **WORDING-PIN** (delete or replace when its prompt is rewritten), **STRUCTURE-CONTRACT** (keep), **BEHAVIOR** (keep).

## Inventory method

Candidates: every test under `packages/*/tests` and `scripts/tests` that reads a prompt file and asserts on its text.

```
grep -cE "\.(toContain|toMatch)\(" <file>          # assertion count
grep -lE "(commands|agents)/[^ ]+\.yaml|SKILL\.md" packages/*/tests/*.{js,ts} scripts/tests/*
```

Each hit was opened and classified. Counts are `toContain`/`toMatch` calls in the whole file. Files marked *mixed* also contain structural or behavioral tests (e.g. parameter-schema checks, generated-parity checks); only their prose-matching tests are wording pins. `.not.toContain` guards on removed phrases count as wording pins.

## WORDING-PIN files (by rewrite target they block)

| Rewrite target | Test file (`packages/development/tests/` unless noted) | Pins | Assertions |
|---|---|---|---|
| implement-trd-beads | implement-trd-beads-command.test.js | commands/implement-trd-beads.yaml | 173 |
| implement-trd-beads | implement-trd-beads-generated-parity.test.js | implement-trd-beads.yaml + generated skill/md | 12 (mixed) |
| implement-trd-beads | beads-stage-commands.test.js | implement-trd-beads, beads-build, beads-build-wave (staging/gate lines) | 17 |
| implement-trd-beads | beads-scaffold-specialist.test.js | agents/beads-scaffold-specialist.yaml, implement-trd-beads.yaml | 7 (mixed) |
| implement-trd-beads, beads-build | subagent-dispatch-resolvable.test.js | beads-build.yaml, implement-trd-beads.yaml | 5 |
| create-trd | create-trd-command.test.js | commands/create-trd.yaml | 99 |
| refine-trd | refine-trd-command.test.js | commands/refine-trd.yaml | 19 |
| new-feature / feature | new-feature-command.test.js | commands/new-feature.yaml (+ md, pi output) | 78 (mixed) |
| new-feature / feature | feature-command.test.js | commands/feature.yaml + generated md | 24 (mixed) |
| new-feature / feature | feature-availability-guard.test.js | commands/feature.yaml | 10 |
| new-feature / feature | feature-input-validation-boundary.test.js | commands/feature.yaml | 8 |
| new-feature / feature | new-feature-retirement-convergence.test.js | new-feature.yaml, feature.yaml | 9 |
| new-feature / feature | feature-concurrency-passthrough.test.js | commands/feature.yaml | 5 |
| new-feature / feature | new-feature-foreman.test.js | new-feature.yaml + md | 2 (mixed) |
| new-feature / feature | feature-foreman-passthrough.test.js | feature.yaml + md | 2 (mixed) |
| new-feature / feature | legacy-feature-pipeline-retirement.test.js | feature.yaml | 2 (mixed) |
| fix-issue | fix-issue-command.test.js | commands/fix-issue.yaml | 238 (mixed: param schema checks) |
| fix-issue | fix-issue-generated-parity.test.js | fix-issue.yaml + generated skill | 12 (mixed) |
| fix-issue | issue-dispatch-completeness.test.js | commands/issue.yaml | 5 |
| release, release-agent | none found | | 0 |
| git-town skill | `packages/git/tests/git-town-skill-docs.test.js` | skills/git-town SKILL.md remediation text | 2 (mixed) |
| tech-lead-orchestrator | tech-lead-orchestrator.test.js | agents/tech-lead-orchestrator.yaml | 7 |
| beads-build | beads-build-command.test.js | commands/beads-build.yaml | 59 |
| beads-build | beads-build-wave-command.test.js | commands/beads-build-wave.yaml | 55 |
| beads-build | beads-build-label-scoping.test.js | beads-build(-wave), implement-trd-beads | 18 (mixed) |
| beads-build | beads-build-arguments.test.js | beads-build.yaml, implement-trd-beads.yaml | 10 (mixed) |
| framework skills, core agents | none found (agent/skill transformer tests use fixtures: BEHAVIOR) | | 0 |
| other | configure-team-command.test.js | commands/configure-team.yaml | 100 |
| other | verify-requirements-command.test.js | commands/verify-requirements.yaml | 72 |
| other | `packages/product/tests/create-prd-command.test.js` | commands/create-prd.yaml | 46 (mixed) |
| other | `packages/product/tests/refine-prd-command.test.js` | commands/refine-prd.yaml | 12 |
| other | pr-review-cycle-skill.test.js | skills/pr-review-cycle SKILL.md | 44 (mixed) |
| other | `packages/e2e-testing/tests/author-playwright-tests-workflow.test.js` | commands/author-playwright-tests.yaml | 13 |
| other | specialist-command-regression.test.js, product-action-list-invariant-audit.test.js | feature/issue/prd/trd command action lists | 3 + 3 |

## Kept classes (not pinned to wording)

- **STRUCTURE-CONTRACT:** `trd-parser.test.js` (grammar markers), `pi/tests/structural-equivalence.test.ts`, `scripts/tests/frontmatter-check.test.js`, `codex/tests/package-structure.test.js`. Contains a few prompt-text asserts (`complexity-analyzer`: ~10 of 29), kept until reviewed.
- **BEHAVIOR:** `scaffold-planner`, `workstream-trd`, `complexity-analyzer`, `trd-cli`, `trd-graph`, `doc-maintenance`, `pr-review-cycle-mutation`, `pr-review-vocabulary`, transformer/translator tests under `packages/pi`, `packages/opencode`, `scripts/tests`.

When a rewrite target above is trimmed, delete or replace its pins in the same PR, and add a structural or eval check only where a real contract exists.
