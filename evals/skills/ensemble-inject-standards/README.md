# ensemble-inject-standards eval

Scope: `/ensemble-core:ensemble:inject-standards` (the command that runs the `ensemble-inject-standards` skill) on a seeded `standards/index.yml` (TypeScript + NestJS, 14 rules in six categories). The task is a REST endpoint that also mentions a module import, so by the skill's scoring naming (+10), git (+10) and api (+8) are selected whole, imports (+5) is the optional second category, and testing and error_handling score 0.

The skill prints to stdout and writes nothing. The prompt therefore asks the agent to also save the printed block, as printed, to `standards-context.txt`; every check reads that file. That extra instruction is the only thing the eval adds to the skill's behaviour, and it is identical in both arms.

## What the checks cover

| Check | Proves |
|---|---|
| `context-saved` | the block was saved and is not blank |
| `header-stack` | the `=== RELEVANT STANDARDS FOR: ... ===` header carries the task, and `Stack: TypeScript + NestJS` matches the index |
| `rules-present` | every naming and git rule (universal) and every api rule (top-scoring category) is printed |
| `rules-absent` | no testing or error_handling rule (score 0) is printed: the block is a selection, not a dump |
| `rule-count` | 5 to 8 rule bullets |
| `example-inline` | rules whose index entry has an example carry `[example: ...]` |
| `footer-handoff` | `Full index: standards/index.yml`, `Standards injected`, and the refresh hint |
| `index-unchanged` | `standards/index.yml` is byte-identical to the seeded one (sha256 pinned in `eval.json`; change the fixture and the hash together) |
| `only-expected-files` | nothing but the index and the saved block exists: no implementation, no other file |

Rules are recognised by a short distinctive phrase from their text, as a case-insensitive substring.

## Known limits

- `header-stack`, `example-inline`, `rule-count` and `footer-handoff` depend on the printed format and may fail a faithful paraphrase.
- Whether the optional second category (imports) is included is not checked: the skill's "stop once between 5 and 8" is ambiguous there. A block of 6 to 8 bullets passes.
- Rules are matched by phrase, so a rule restated in other words counts as missing.
- Structure only: it does not show that the agent would then follow the injected rules.
- Claude Code only: the skill is `disable-model-invocation` and reached through the core package's command.
- The saved file is the agent's copy of its own output, not the raw stdout.

## What a real trial must settle

- Whether the with-skill arm resolves `/ensemble-core:ensemble:inject-standards` and reads `standards/index.yml` from the workspace.
- Whether the agent saves the block faithfully (format-sensitive checks).
- Whether the baseline arm, which has no command, prints a comparable block at all, or implements the task despite the prompt.
- Whether the counts, repeats and bar suit this skill (no measured results are recorded here).
