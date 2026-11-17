# ensemble-prd eval

`ensemble-prd` is a thin router: the first argument token (`create` or `refine`) selects a sibling skill, which is read and followed with the rest of the arguments unchanged. An empty or unknown first token prints the keyword table and halts.

## Scope

One scenario: `create csv2json: ... --foreman`, invoked as `/ensemble-product:ensemble:prd` in the with-skill arm. The run must end as a create-prd run ends. Claude only: the router reads `../ensemble-create-prd/SKILL.md` by relative path, which a single-skill Pi load does not provide. The fixture is a README and a minimal `docs/standards/constitution.md` (the Constitution Gate halts without one).

## What the checks cover (`evals/checks/ensemble-prd.js`)

- `prd-saved`: exactly one `docs/PRD/PRD-*.md` was written.
- `prd-reqs`, `prd-gwt`, `prd-constitution`: REQ-NNN headings, Given/When/Then acceptance criteria on every requirement, `Constitution compliance: passed` (same rules as the create-prd eval).
- `prd-subject`: the PRD's title or label names csv2json, so the arguments after the keyword reached the sub-skill and the subject was not invented.
- `prd-keyword-stripped`: the title and label do not start with `create`, so the keyword was consumed by the router rather than passed on as part of the description. A weak, narrow proxy.
- `no-impl-files`: nothing outside `docs/` (and tool state) was written.

## Known limits

- The `refine` route and the no-keyword halt (keyword table, no side effects) are not exercised; one eval has one prompt.
- Checks read the saved PRD, not the transcript: they cannot prove the sibling skill was followed rather than re-implemented, only that its output shape appears.
- The create-prd output checks duplicate the create-prd eval's; what this eval adds is the dispatch path, and `prd-keyword-stripped` is the only check specific to it.
- The baseline arm (no plugin, plain prompt `create csv2json ...`) measures the plugin's conventions (ids, REQ/AC structure, the constitution line), not routing.

## What a real trial must settle

- Whether the model, given `/ensemble-product:ensemble:prd create ...`, actually follows the sibling skill and saves a PRD in 900 s / 40 turns, and whether `Task` use is needed.
- Whether `prd-keyword-stripped` ever fails on a correct run, and whether the baseline fails it for a reason that is not the router.
- Whether a second eval (refine route, or the halt path) is worth adding.
