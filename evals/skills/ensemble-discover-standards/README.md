# ensemble-discover-standards eval

Scope: a non-interactive `/ensemble-core:ensemble:discover-standards` run (Claude Code) or the skill loaded alone (Pi) against a tiny JavaScript library. The fixture has the built-in node:test runner and eslint, kebab-case files, camelCase functions, a `ValidationError` class, `*-test.js` tests (not `*.test.js`, which the repository's jest run would pick up), a `src/index.js` barrel, a `CLAUDE.md` with no standards pointer, and a `standards/index.yml` that already holds two seeded rules (`naming-001` and `testing-001`). The skill's central promise, merge-first, is therefore exercised on every run; creating an index from nothing is not.

## What the checks cover

`evals/checks/ensemble-discover-standards.js`, tested in `evals/tests/skills/ensemble-discover-standards.test.js`.

| Check | Shows |
|---|---|
| `index-saved` | `standards/index.yml` exists with `version`, `generated`, `stack`, `standards`. The seed already satisfies it. |
| `index-stack` | `stack` has language, framework, test_framework, linter, and they match the fixture (JavaScript, node:test, eslint). |
| `rules-wellformed` | Only the six known categories; ids are `<category>-NNN` with that category's prefix, unique; rule under 80 characters; example under 60; at least 6 rules over at least 3 categories (more than the seed's 2). |
| `merge-preserved` | The seeded rules are still there under their ids with their key phrase, and no new rule in their category is numbered at or below them. |
| `rules-grounded` | At least 3 of 4 codebase facts (camelCase, a custom error class, `*-test.js`, a barrel export) appear in the rule text, and no rule names a stack the fixture lacks. Flaky-prone: it is a wording match. |
| `category-docs` | A category with more than 3 rules has a non-stub `standards/<category>.md`. |
| `claude-pointer` | `CLAUDE.md` keeps its original text and references `standards/index.yml` exactly once. |
| `scope-only` | Nothing is written outside `standards/` and `CLAUDE.md`; every other fixture file is byte-identical. |

## Known limits

- The index is read with a small line parser, not a YAML library. A block scalar (`rule: >`) or a flow-style list reads as an empty rule or no rules and fails; a trial should show whether runs do that.
- The fixture repository has one commit, so the commit-style rules (the `git` category) are not checked against history, and the skill's printed messages ("Standards discovered: N rules...") are not checked.
- Structure and grounding only: the checks do not show the rules are correct, complete or useful.
- The baseline arm has no plugin and is expected to measure the plugin's conventions (index format, merge-first, pointer in `CLAUDE.md`), not general ability.

## What a real trial must settle

- Whether the typed command runs at all: the command manifest is `user-invocable: false` and the skill is `disable-model-invocation: true`, so the with-skill arm may not reach the skill.
- Whether Pi can run it: the skill is a self-contained `SKILL.md`, but it names `/ensemble:standards` commands Pi does not have.
- Whether the thresholds (6 rules, 3 categories, 3 of 4 facts) sit below what a good run produces and above what the baseline produces; the length limits are the skill's own.
- Whether runs merge by editing the existing file or rewrite it with the seeded phrases reworded.
