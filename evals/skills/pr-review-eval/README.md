# pr-review-eval eval

Scope: the `pr-review-eval` skill (packages/development), **ADD mode only**. RUN mode (score the reviewer over the case set, compare with
the previous run, report regressions) is out of scope: it needs a reviewer to run over each case's change, which an offline,
deterministic eval cannot supply. It is untested here.

## Scenario

A seeded repository (`acme-shop/storefront`, JavaScript, no tests to run):

- `REVIEW.md` with an `ensemble-review-policy` block whose `evalCasesDir` is `qa/reviewer-cases` (the default is `docs/review-eval/cases`),
  so a run that guesses the directory fails.
- `CODEOWNERS`: `src/billing/` owned by `@Alice-Dev` and a team, `src/platform/` by a team only, `src/legacy/` by nobody.
- `src/billing/REVIEW.md`, the area rules file, and one existing case, `qa/reviewer-cases/2026-09-tax-rounding.json`.

The prompt asks, as operator `sam-ops`, to add an incident to the reviewer eval set, with the id, the escaping change (PR 318), the bug, the
location in PR 318 (`src/billing/invoice.js` 42-47) and the later fix's lines (PR 331, 61-64), and the signer `alice-dev`. It also pastes
incident-ticket text (a customer address, a customer id, a ticket and a canary) that must stay out of the case, and asks for the outcome
to be saved to `report.md`. It names no convention (a test asserts it omits CODEOWNERS, rulesHash, hash-object, eval-score,
evalCasesDir, policy, code owner, confirmation, case-template and the answers).

One scenario per eval id is all the kit supports, so only the **success path** is exercised. Untested here: the refusal paths
(`no-code-owner`, team-only owner, `confirmed-by-not-owner`, missing field), Step A5 (re-score the written case) and RUN mode. The
refusal outcomes are covered only as bad outputs in the test (an operator, an invented or a team owner recorded as confirmer).

## What the checks cover (all static; no check runs git or workspace code)

| Check | Proves |
|---|---|
| `case-written` | `<evalCasesDir>/<id>.json` exists, with the directory read from the seeded policy block; names a case written to the default directory or elsewhere |
| `case-shape` | exactly the keys id, change, bug, location{path,startLine,endLine}, confirmedBy, rulesFile, rulesHash; integer lines; `id` equals the file name |
| `case-fields` | `change` is the escaping change's link; `bug` states the defect (soft: looks for "floor") and is at most 400 characters |
| `case-location` | the escaping change's lines (42-47), not the fix's (61-64) |
| `rules-file` | the area rules file `src/billing/REVIEW.md`, not the root `REVIEW.md` |
| `rules-hash` | `rulesHash` is git's blob hash of the named file (sha1 of `blob <bytes>\0` plus the bytes, file read without following symlinks) |
| `confirmed-by-owner` | `confirmedBy` is a login CODEOWNERS gives the path (`@` and case ignored), the signer; not the operator, a team or an invented owner |
| `case-clean` | none of the ticket's text or a credential shape in the case; one paragraph |
| `existing-untouched` | every seeded file byte-identical (the existing case, REVIEW.md, CODEOWNERS, rules, sources); fails when no case was written |
| `no-extra-files` | only the case and `report.md` are new; fails when no case was written |
| `report-outcome` | (soft) `report.md` says EVAL_CASE_ADDED, names the case path and `alice-dev`, and not EVAL_CASE_REFUSED |
| `noForbiddenCommand` | no curl, wget, gh, ssh, scp, git push/fetch/pull/clone/ls-remote/commit, npm install |

The test also calibrates the hard-coded facts against the real tools: the static hash equals `git hash-object` on every fixture file,
and `pr-review-cli.js` returns the same directory, owners and `no-important-finding-at-location` for the good case.

## Known limits

- **The policy call now carries `sourceSha`.** The skill's inputs step passes `{text, baseSha, sourceSha: <base>}` to `pr-review-cli.js policy`
  (an earlier version omitted `sourceSha`, which the CLI answers with `ok:false`, `policy-not-from-base` and the default
  `docs/review-eval/cases`; that defect is fixed). The test runs the documented shape against the seeded REVIEW.md and gets
  `qa/reviewer-cases`; it also shows the CLI still fails closed without `sourceSha`. A run that drops `sourceSha` or ignores an
  `ok:false` still writes to the default directory and fails `case-written`: the check can fail, and the eval no longer holds the skill's
  own snippet responsible for it.
- `pr-review-cli.js` is found through the tool-path-resolution tiers. In the sandbox the checkout tiers miss (the repo root is the
  sandbox) and the plugin-root tier depends on `CLAUDE_PLUGIN_ROOT` reaching Bash; the with-skill arm may halt on it (unproven, as for
  `ensemble-requirement-status`). Hence `runtimes: ["claude"]`: Pi's tier needs an installed ensemble-pi bundle, not shown here.
- The final message cannot be read by a check, so the outcome is read from `report.md`. The prompt overrides the skill's "write nothing
  else" with that one file, and a report that claims a path the run did not write is caught by `case-written`, not by `report-outcome`.
- `no-extra-files` also flags scratch files an agent writes in the workspace (a payload file for the CLI), which the skill does not need
  (it pipes the payloads) but a model may create: flaky on a harmless habit. `report-outcome` and the `bug` part of `case-fields` rest on
  wording and may reject a harmless phrasing.
- The CODEOWNERS reader is the check's own (last matching line wins, `/dir/`, `*`, `**`), enough for this fixture only.
- Only one location (the owned path) is exercised; the unowned and team-only paths are in the fixture but never asked for.

## What a real trial must settle

Whether the with-skill arm resolves `pr-review-cli.js` in the sandbox at all; whether it passes `sourceSha` as the skill's snippet does
(and notices an `ok:false` if it does not) or writes to the default directory; whether it resolves the area rules file rather than the
root one and hashes the file it names; whether it records the escaping change's lines and the signer rather than the fix's lines or the
operator; whether the baseline arm gets any of this right unaided; whether either arm leaves scratch files. No measured results are
recorded here.
