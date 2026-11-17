# ensemble-fold-prompt eval

Scope: a non-interactive `/ensemble-core:ensemble:fold-prompt` run on a small Express project (`fixture/`) whose `CLAUDE.md` is bloated on purpose: long prose paragraphs, the test command listed three times, a path to a file that does not exist, a TODO dated 2025-01-10, and a 40-line inlined Express pattern reference (about 11 KB, over the 8000-character budget). The skill rewrites `CLAUDE.md` and writes `.claude/` files. Claude only: the skill is run through its command, and a Pi run is not set up.

## What the checks cover (`evals/checks/ensemble-fold-prompt.js`)

| Check | Proves |
|---|---|
| `quick-reference` | a Quick Reference heading in the first 20 lines, with the test command and a markdown command table |
| `size-budget` | CLAUDE.md is at most 8000 characters (about 2000 tokens) and not emptied |
| `no-long-prose` | no prose paragraph over 3 rendered lines (lists, tables, quotes and code are not prose) |
| `standards-section` | a "Coding Standards" section with at least 3 entries that name this code's conventions (`AppError`, kebab-case files) |
| `paths-resolve` | every backticked path in CLAUDE.md exists (the deleted `src/legacy/old-parser.js` must go) |
| `progressive-disclosure` | CLAUDE.md points to `.claude/patterns/*.md` files that exist, are not stubs and hold route patterns; the inlined pattern lines are mostly gone |
| `context-notes` | a "Context Notes" section, last in the file, 1 to 5 bullets, carrying the >5 files / offset-limit / 60% rules |
| `standards-index` | `.claude/standards-index.yml` has at least 3 `key: value` lines and a category word |
| `stale-removed` | the 2025 TODO is gone |
| `sources-untouched` | only CLAUDE.md and files under `.claude/` or `.ensemble/` changed or were added; every other fixture file is byte-identical |

## Known limits

- Structure and limits, not quality: the checks cannot tell whether the standards are correct, whether the prose is good, or whether a moved pattern lost information.
- `standards-section`, `context-notes`, `standards-index` and `quick-reference` depend on phrasing or on the skill's prescribed shape (table, section names, rule wording). They are the checks most likely to fail a reasonable output; see the header of the check script.
- The index schema is loosely prescribed by the skill, so `standards-index` checks only that it is non-trivial YAML-like text.
- `sources-untouched` also fails on a `package-lock.json` or `node_modules`; the prompt says not to install.
- Step 3.2 ("check that listed commands work") and Step 4.1 ("run lint/test") are not checked: the fixture has no installed dependencies.
- The baseline arm gets no plugin and a plain request. It is expected to measure the plugin's conventions (index file, Context Notes wording, patterns directory); a model may meet some of them unprompted.
- The command's own Change Report (Step 4.2) is printed, not saved, so it is not checked.

## What a real trial must settle

- Whether the 8000-character budget and the 3-line paragraph limit are met by real runs of the skill, not just by the stub.
- Whether the skill reliably writes `.claude/standards-index.yml` and a `.claude/patterns/` file in a non-interactive run, and under which names (a different file name inside `.claude/patterns/` passes; a different directory fails `progressive-disclosure`).
- Whether the discovered standards mention `AppError` and kebab-case in wording the term lists accept.
- The with-skill and baseline pass rates, reliability and cost. None is measured here.
