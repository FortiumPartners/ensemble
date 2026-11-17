# ensemble-list-issue eval

Scope: the flat form of `/ensemble-development:ensemble:list-issue` (no arguments). Claude Code only; the skill is command-driven and
needs toolchain-cli, so it is not loaded alone by Pi.

## How it runs offline

The sandbox has no tracker. `fixture/bin/br` and `fixture/bin/bv` (on PATH through `sandboxPath: ["bin"]`) are stubs. `br` answers
`--version` and `list` from `bin/canned/issues.json` (3 open issues, 1 closed) and refuses everything else with exit 2; `bv` answers only
`--version` (the beads adapter's preflight health check) and refuses `--robot-plan`, so `work-graph.plan` fails and the skill's documented
flat `tracker.list` path is the only one. Both stubs log each call outside the worktree (`br-calls.log`, `bv-calls.log` in the sandbox
root). The skill only prints its listing, so the prompt asks the run to also save it to `listing.md`; the checks read that file.
`fixture/.ensemble/toolchain.yaml` pins `tracker: beads` so no detection is needed. The stubs were exercised against the real
`packages/development/lib/toolchain-cli.js` in a scratch sandbox: `preflight --require tracker.list` returns ok and `run tracker.list`
returns the canned JSON.

## Checks (`evals/checks/ensemble-list-issue.js`)

- `listing-saved`: listing.md exists and is not a stub.
- `open-issues` (flaky, layout): each open issue appears with its id and title (same line or within two lines), and no other issue id appears.
- `no-closed` (flaky, layout): neither the id nor the title of the closed issue appears.
- `tracker-read`: the br stub saw a `list` call, so the listing came from the tracker.
- `read-only`: only read calls reached br and bv, the canned data is unchanged, nothing was written outside listing.md, `ensemble/`, `.ensemble/`, `bin/`.

Tests: `evals/tests/skills/ensemble-list-issue.test.js` (stub agents that write good and bad outputs).

## Known limits

- The ranked form (`--ranked`, `work-graph.plan`) is not covered: the beads adapter maps no `orderingSource` or `dependencyAware`
  (see `packages/development/skills/adapter-tracker-beads/adapter.yaml`), so there is nothing deterministic to check there.
- The order of the flat listing is not checked.
- A listing that names the closed issue only to say it was left out fails `no-closed`.
- Whether the with-skill arm gets past the tool-path-resolution step for toolchain-cli in the sandbox is unproven.

## What a real trial must settle

- Whether the with-skill run resolves toolchain-cli in the sandbox and reaches `tracker.list` at all, or halts with "could not locate toolchain-cli".
- Whether the run prints the listing in a layout the two flaky checks accept.
- Whether the baseline arm (no plugin, no skill) lists the open issues through the stub `br` and stays read-only.
- That the checks separate the two arms: this README states no measured results.
