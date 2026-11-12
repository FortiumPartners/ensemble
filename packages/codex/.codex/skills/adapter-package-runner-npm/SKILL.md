---
name: adapter-package-runner-npm
description: npm `package-runner` toolchain adapter (TRD-2026-8d825f54 TRD-044). Loaded by the toolchain resolver, not invoked directly by name. Shipped default package-runner adapter.
---

# npm Package-Runner Adapter

This is a `package-runner`-only toolchain adapter (`adapter: npm`), the shipped default for the
`package-runner` category (`packages/development/toolchain/toolchain.default.yaml`), selectable
explicitly by setting `package-runner: npm` in `toolchain.yaml`. A skill directory, not a
command: the toolchain resolver (`packages/development/lib/toolchain/adapters.js#loadAdapter`)
loads `adapter.yaml` and runs its capabilities through `packages/development/lib/toolchain/
runner.js#runCapability`.

Backing tool: `npm`. Live-verified against this repository's own real, installed `npm`:
`npm --version` succeeded (confirming the `npm-installed` health check's own command is real and
reachable in this environment); `run-script`/`install` themselves were not executed live (see
"Known limits").

## Vocabulary

- `package-runner.run-script`: run a package script, forwarding extra arguments (`npm run <script> -- <args>`)
- `package-runner.install`: install the project's declared dependencies (`npm install`)

## Manifest

`adapter.yaml` declares `categories: [package-runner]` only, `contract: {package-runner:
"1.0"}`. `detect: []` -- shipped DEFAULT for `package-runner`, not remote-detected, per TRD
interpretation I2 (same convention as `adapter-workflow-plain-git`).

`binaries: [npm]`. `allowlist: [{bin: npm, sub: [run, install, "--version"]}]` -- `run`/
`install` back the two wired capabilities; `"--version"` exists purely so the `npm-installed`
health check passes `validateAllowlist`. `env: []` -- npm reads no single named credential env
var for ordinary `run`/`install` usage (registry auth tokens live in `.npmrc`, not a documented
single env var).

## Known limits

- **`package-runner.run-script`'s `args` input has no default and must always be supplied
  explicitly, even as an empty string.** `run-script`'s template references `${args}`
  directly (`npm run <script> -- ${args}`); `runner.js#buildArgv`/`resolveArg` has no manifest-
  level default mechanism for ANY placeholder (`category-contract-schema.json` input entries
  carry no `default`, see `runner.js`'s own "Design note"), so a caller that omits `args`
  entirely gets a fail-closed `INVALID_ARG` naming `args` -- never a literal, unsubstituted
  `${args}`/`$args` left in the argv (confirmed live and by
  `scripts/tests/toolchain-package-runner-args.test.js`, PR 10 fix round, item 4). Most npm
  scripts need no extra arguments at all, so a caller invoking a script with none must still
  pass `args: ''` explicitly (an empty string is a valid value: it does not begin with `-`, so
  `resolveArg` accepts it) to mean "no extra arguments" -- there is no way to omit it.

- **`package-runner.install`'s `args` input is unreferenced.** `npm install` with no arguments
  installs every dependency declared in `package.json`/locked in `package-lock.json` -- the safe,
  declared-dependencies-only case this capability's own category description names. The category
  contract declares no separate "install a specific package" capability this template could
  reuse `${args}` for without risking a caller silently installing an undeclared package instead
  of the project's own locked set.
- **Neither capability's `status` output is ever populated.** A script's (or `npm install`'s own)
  free-text stdout has no structured success/failure field beyond the process exit code, which
  `runCapability` already turns into `ok:false`/`TOOL_FAILED` on a non-zero exit -- not a value
  either capability's own mapped output could honestly re-represent.
- **`package-runner.run-script`/`install` were not executed live.** `run-script` would run an
  arbitrary, package-defined script with its own real side effects (this is a generic adapter
  with no specific script named); `install` would mutate this repository's real `node_modules`,
  a real side effect this bead does not take against the live working tree. Only the
  `npm-installed` health check's own command (`npm --version`) was actually run.
