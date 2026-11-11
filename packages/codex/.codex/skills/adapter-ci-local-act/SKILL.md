---
name: adapter-ci-local-act
description: nektos/act `ci-local` toolchain adapter (TRD-2026-8d825f54 TRD-042). Loaded by the toolchain resolver, not invoked directly by name. Shipped default ci-local adapter.
---

# Act Local CI Adapter

This is a `ci-local`-only toolchain adapter (`adapter: act`), the shipped default for the
`ci-local` category (`packages/development/toolchain/toolchain.default.yaml`), selectable
explicitly by setting `ci-local: act` in `toolchain.yaml`. A skill directory, not a command: the
toolchain resolver (`packages/development/lib/toolchain/adapters.js#loadAdapter`) loads
`adapter.yaml` and runs its capabilities through `packages/development/lib/toolchain/
runner.js#runCapability`.

Backing tool: the real `act` binary (`/opt/homebrew/bin/act`, v0.2.89 on this machine) --
the same tool `packages/git/skills/act-local-ci/SKILL.md` (and its `scripts/run-act.js` wrapper)
already document. This adapter wraps `act` directly, not that wrapper script.

## Vocabulary

- `ci-local.run-workflow`: run a workflow file locally (`act -W <workflow>`)
- `ci-local.list-jobs`: list every job this repository's local CI workflows define (`act -l`)

No environment variables are required (`env: []`): `act` needs Docker running locally, not a
credential this manifest's `env` field represents.

## Manifest

`adapter.yaml` declares `categories: [ci-local]` only, `contract: {ci-local: "1.0"}`.

`detect: []` -- act is the shipped DEFAULT for `ci-local`, not remote-detected, per TRD
interpretation I2: a shipped default with no detect signal at all never turns some other
unrelated adapter's unmatched signal into an `AMBIGUOUS_PROVIDER` error.

`binaries: [act]`. `allowlist: [{bin: act, sub: ["-W", "-l", "--version"]}]` -- `-W` and `-l` are
act's own real, documented flags this adapter's two capabilities use; `--version` is one extra
entry purely so the `act-installed` health check passes `validateAllowlist` (the same convention
`adapter-workflow-plain-git`/`adapter-host-github` use for their own `"--version"` entries).

## Known limits

- **`ci-local.run-workflow`'s `status`/`logs` outputs are never populated.** `act`'s own stdout
  on both success and failure is human-readable, multi-line job/step progress text interleaved
  with Docker pull/run logs, not a single field either declared output could honestly be mapped
  from with `mapping.js`'s dotted-path grammar (act does support a `--json` log-format flag, but
  that reformats per-event log lines, not a single terminal `status` value, and still has no
  primitive here to extract it); no `parse` block is declared, so the raw run log is returned as
  `data` instead.
- **`ci-local.list-jobs`'s `workflow` input is unreferenced.** `act -l` always lists every job
  across every workflow this repository defines; `act --help` documents no per-workflow-scoped
  variant of `-l`. `workflow` is declared solely because the category contract shares its input
  name with `ci-local.run-workflow` and the schema requires at least one input per capability.
- **`ci-local.list-jobs` has no `parse` block; its raw output includes the header row.** `act -l`
  prints a column-aligned text table (`Stage  Job ID  Job name  Workflow name  Workflow file
  Events`, one data row per job); `mapping.js` has no "skip first line" or column-split
  primitive, so no `parse` block is declared and the whole table (header included) is returned
  as `data`. Live-verified against this repository (`act -l`): printed every real job defined
  across this repository's actual `.github/workflows/*.yml` files, for example `implement`
  (`auto-implement.yml`), `claude-review` (`claude-code-review.yml`), `eslint`/`markdownlint`
  (`reviewdog.yml`). Confirmed `act -l --json` produces the byte-identical table: `--json` only
  reformats a real run's own logs, never `-l`'s listing output.
- **`ci-local.run-workflow` was never executed live** (side-effecting: would spin up real Docker
  containers and run this repository's actual CI workflow steps); its run template is grounded
  in `act`'s own real, documented `-W` flag, confirmed via `act --help`.
