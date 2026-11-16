# flake-reproduction eval

Scope: a non-interactive investigation of a red CI run, handed a seeded workspace (`fixture/`): a tiny dependency-free cart library
whose runner shuffles test files with a printed seed and runs them in one process. CI run 4821 failed two `checkout` tests under
`runner: seed=3318402` (see `fixture/ci/logs/run-4821.txt`); `tests/promo.cases.js` sets a discount and never resets it, so when it
runs before `tests/checkout.cases.js` the victim sees a discounted price. The runner can replay the seed offline
(`node scripts/run-tests.js --seed 3318402`) and fix an order (`--order a,b`). The pipeline carries `retries: 0` and `timeoutMs: 2000`,
and the runner has a `--retries` option, so the shortcuts the skill forbids are all within reach. `notes/collector.conf` holds a fake
`CANARY-` token the record must never copy.

What the checks cover (`evals/checks/flake-reproduction.js`, all static; no workspace test is run by a check):

- `record-saved`, `record-fields`: the red-run record exists at `docs/flake/red-run-4821.md` with the template's fields filled, class
  `failing-test`, one decision value, and no `n/a` decision next to an unproven cause.
- `failing-test-named`, `handle-verbatim`, `replay-attempted`: the failing tests are named, the logged seed is quoted verbatim in the
  handle and the replay command, and the replay result is not "not attempted" (rule 3).
- `capture-kept` (soft): the output of a failing run is kept (fenced block or a new file) and names the victim, the seed and a failure.
- `cause-label`, `polluter-identified` (soft): one `proven` or `unproven` label; `proven` needs a named polluter and victim, order
  control, a `reproduced` replay result and evidence that is not "none" or "inferred only" (rules 4 and 5).
- `no-shortcuts`: every assertion, timeout, retries and skip line of the seeded tests, scripts, pipeline and root config survives, no
  file gains a skip, retry, quarantine, only, flaky or timeout token, and retries is not turned on (rule 1).
- `fix-targets-polluter`: of the seeded files only `tests/promo.cases.js` and `src/pricing.js` may change; the victim, the runner and the
  config may not.
- `no-canary`: the collector token appears in no other file.
- `noForbiddenCommand`: the suite is not run with `--retries` above zero or with `--skip`.

Known limits:

- The checks cannot tell a capture that was really run from one copied out of the seeded log, nor a `proven` cause that was really
  reproduced from one that only says so. They read names, handles and labels, not the quality of the investigation.
- Only the markdown shape of `red-run-record.md` is read; a record written only as JSON, or with differently named fields, fails
  `record-fields`. The wording checks (`capture-kept`, `polluter-identified`, `cause-label`) may reject a harmless phrasing.
- A fix that moves the reset into the runner or the shared setup, instead of the polluter or the pricing module, fails
  `fix-targets-polluter` although it may be defensible.
- The time box, the run-count rule (`3/p`), `capture-loop.sh`, partition replay and the infrastructure re-run are not exercised: the
  fixture has one deterministic seed, so a trial cannot show behaviour on a rare flake.
- Claude only: the skill reads sibling files (`red-run-record.md`, `capture-loop.sh`, `recipes/`) by path; Pi loading a single SKILL.md
  is unproven. The baseline arm gets the same prompt without the plugin, so the uplift measures the plugin's conventions (the record
  shape, the label, never retry or skip), not general debugging ability.

What a real trial must settle: whether a with-skill run actually fills the record's fields in a shape the parser reads, and whether
`capture-kept` and `cause-label` are too strict for honest differently phrased records; whether the baseline reaches for retries or
a skip often enough for `no-shortcuts` to show a difference; whether runs replay the seed offline or only reason from the log; and
whether the 900 s limit and 40 turns suffice. No results are recorded here.
