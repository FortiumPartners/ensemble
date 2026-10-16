# @sunstone-partners/ensemble-pi-extension

Thin Pi-specific extension providing native command completion for the
`prd`/`trd`/`issue`/`feature` dispatcher commands, via Pi's native,
documented extension mechanism (`pi.registerCommand`, `pi.sendUserMessage`).
No fork or patch of Pi's agent loop.

Each dispatcher registration (`registerDispatcherCommand` in
`src/dispatcher-commands.ts`) is a no-op in any repo that doesn't have the
corresponding YAML (`packages/product/commands/prd.yaml`,
`packages/development/commands/{trd,issue,feature}.yaml`), so this
extension loading globally in every session never pollutes an unrelated
repo's command list.

A previous version of this package also loaded a behavior-runtime/autofix
loop (test-failure observation, automated fix dispatch, constitution
proposals). That subsystem has been removed from `dev` and is retained on
the `pi-behaviors` branch for future development.

## Command lifecycle hooks

This extension also carries the Pi adapter for command lifecycle hooks
(`src/lifecycle/`, on top of `packages/agent-core/src/lifecycle-hooks/`): a
project-level `.ensemble/hooks.yaml` can run `shell` and `prompt` handlers on
`command.start` and `command.end` for the Ensemble commands it names, and a
start handler can block the command. **Pi is the only supported harness.**
Nothing runs in Claude Code, Codex or OpenCode.

- It is inert unless the repository root holds `.ensemble/hooks.yaml` when Pi
  starts: nothing is registered and nothing is written otherwise.
- No handler runs until the file validates, Pi reports the project as trusted
  and you have trusted the hooks with `/ensemble-lifecycle-trust` in an
  interactive session. That trust is recorded outside the repository and is
  voided when the hooks file or a handler file it names changes.
- `node scripts/hooks-status.mjs [projectRoot]` prints the per-harness
  capability table and whether a project's hooks are absent, invalid, not
  trusted or trusted. It is a script, not a slash command.
- Read [`docs/guides/command-lifecycle-hooks.md`](../../docs/guides/command-lifecycle-hooks.md)
  for the payload, both handler types, exit and error semantics, redaction,
  trust and the known limits. It also says how this differs from the separate
  `pi-yaml-hooks` extension, which can be installed alongside.

## Dependency note

This package depends on `@earendil-works/pi-coding-agent`, matching the
package actually resolved by the installed `pi` binary (0.87.1+). The
older `@mariozechner/pi-coding-agent` scope is deprecated upstream in
favor of `@earendil-works/*` — do not add a dependency on the
`@mariozechner` scope to this package.

## Testing

- `npm test` runs the jest unit suite against `dispatcher-commands.ts` and
  `extension.ts`'s native command registration.
- `npm run test:smoke` runs `scripts/smoke-activate.mjs`, a real Node ESM
  subprocess that loads this extension through Pi's actual
  `discoverAndLoadExtensions` loader (AC-004-1). This must run outside
  jest: `@earendil-works/pi-coding-agent` ships ESM-only (no `require`
  export condition), so jest's CommonJS resolver cannot load it even via
  a dynamic `import()`.
- `npm test` and `npm run test:smoke` first build agent-core with
  `tsc -p ../agent-core` (their `pretest` and `pretest:smoke` scripts),
  because `scripts/hooks-status.mjs` imports the built
  `packages/agent-core/dist` and the lifecycle adapter uses the agent-core
  package. Run the tests through npm, not `jest` directly, so that build
  happens.
- `ENSEMBLE_LIVE_SMOKE=1 node scripts/smoke-lifecycle.mjs` runs the live
  lifecycle smoke (`scripts/smoke-lifecycle.mjs`, from this package's
  directory). Build agent-core first: `npm test` does, or run
  `tsc -p ../agent-core`.

## Installing globally

- `npm run install:extension` builds a bundle and installs a shim into
  `~/.omp/agent/extensions/`, so the dispatcher commands are available in
  every OMP/Pi session (see `scripts/install.mjs`).
- `npm run uninstall:extension` removes it.
