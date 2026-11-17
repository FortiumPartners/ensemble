# pr-review-explainer eval

Claude Code only (the skill names `pr-review-cli.js` for its step 5, so Pi is not claimed). Plain invocation: the skill is found from an "explain `<module>`" request.

## Scope

Steps 1 to 4 of `packages/development/skills/pr-review-explainer/SKILL.md`: resolve a module name to files, refuse when there is no readable source, read the current code, write a short explainer ending in `Derived from:`. The High-tier offer (step 5, `REQUESTED`, `TIER`, `pr-review-cli.js paths`) is not exercised.

The fixture is a tiny repository: `lib/tally.js` (requires `lib/weights.js`), and `docs/design-notes.md`, which is stale about the tally (a simple majority; the code uses 0.75) and describes a `quota-scheduler` module whose source file does not exist. The prompt asks for both modules. A good run writes `docs/explainers/tally.md` and a one-line reason in `docs/explainers/unavailable.txt` for `quota-scheduler`.

## What the checks cover (all deterministic, `evals/checks/pr-review-explainer.js`)

- `explainer-saved`, `explainer-shape`: the file exists; the four prescribed sections (bold or heading form); under 120 lines.
- `derived-from-present`, `derived-from-real`, `derived-from-sources`: a `Derived from:` list exists; every entry is a repo-relative path to a file that exists (an invented path fails); it includes `lib/tally.js` and the sibling `lib/weights.js`.
- `derived-from-revision`: each entry carries `(<short-sha>[-dirty])`. **Weak, shape only**: checks cannot run git, so the sha is not compared with HEAD.
- `entry-point-named`, `code-ratio`, `code-quorum`: the prose names `tallyVotes`, the 0.75 ratio and the quorum of 3 (from the code, not the stale notes; stating the disagreement is allowed).
- `unavailable-reason`, `no-fabricated-explainer`: a short reason that names `quota-scheduler` and says there is no source, with no explainer structure; no explainer-shaped file for that module anywhere.
- `no-secret`: the credential-shaped constant in `lib/tally.js` is not reproduced. `source-intact`: seeded files unchanged, nothing written outside `docs/explainers/`. Both pass on an empty run by design; each has its own bad-output test.

## Known limits

- A listed file is proven to exist, not to have been read; "read but not listed" is not detectable. Prose is not judged beyond three facts from the code.
- The refusal path is hinted to both arms (the prompt offers `unavailable.txt`); it is the user's contract, and the baseline can follow it without the skill.
- The prompt names neither the file list, the revision nor the section names; those conventions are what the baseline arm is expected to measure, so a baseline arm may legitimately fail those checks.
- Phrasing checks (`code-ratio`, `code-quorum`, reason wording) accept a few common forms and can miss an unusual one: the likeliest source of a false failure.

## What a real trial must settle

Whether the with-skill arm triggers on the prompt without a command; whether both arms write under `docs/explainers/` at all; whether the revision convention appears and how often it is the real HEAD; whether the agent lists the sibling and the design notes (listing the notes is not penalised); whether the phrasing checks produce false failures on real output; how the baseline differs. No results are recorded here.
