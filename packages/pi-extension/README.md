# @sunstone-partners/ensemble-pi-extension

Thin Pi-specific extension providing native command completion for the
`prd`/`trd`/`issue`/`feature`/`reqnroll`/`standards` dispatcher commands, via Pi's native,
documented extension mechanism (`pi.registerCommand`, `pi.sendUserMessage`).
No fork or patch of Pi's agent loop. It also reports, loudly, an OMP model
role that an Ensemble agent needs and you have not set (see "Model role
check" below).

Each dispatcher registration (`registerDispatcherCommand` in
`src/dispatcher-commands.ts`) is a no-op in any repo that doesn't have the
corresponding dispatcher skill (`packages/product/skills/ensemble-{prd,reqnroll}/SKILL.md`,
`packages/development/skills/ensemble-{trd,issue,feature}/SKILL.md`,
`packages/core/skills/ensemble-standards/SKILL.md`), so this
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

## Model role check

Generated Ensemble agents name a model tier as an OMP role list:
`model: "@high,@default"` (8 agents) or `model: "@medium,@default"` (16
agents). `high` and `medium` are custom OMP roles, so they exist only once you
set them in `modelRoles` (see [Model tiers and OMP roles](../pi/README.md#model-tiers-and-omp-roles)).
OMP does not say when they are missing: the agent silently runs on
`modelRoles.default`, and with no usable default it dies with "No model
selected" and the advice to `/login`. A `SKILL.md` cannot check this, so this
extension does, in `src/model-roles.ts`.

It handles OMP's `before_subagent_spawn` event. OMP fires it once per child
agent, after it has applied the agent's `model:` list,
`task.agentModelOverrides` and the role expansion, and hands over the model
list it is about to try. A role nobody set stays in that list as a literal
`@high` or `@medium`. The check reads no settings file and no agent file, so
an agent you pinned with `task.agentModelOverrides` never triggers it.

| What the spawn asks for | What happens |
|---|---|
| A tier role you set, or an agent pinned by `task.agentModelOverrides` | Nothing: no message, no block. |
| A tier role that is not set, and a fallback model that resolves | The spawn runs. You get one warning per session (a UI notice, or stderr in print mode) that names the model the agent runs on instead, the `modelRoles.<role>` keys to set, `~/.omp/agent/config.yml` and an example. |
| A tier role that is not set, and nothing to fall back to | The spawn is refused with that message instead of OMP's "No model selected". The model sees it as the job's error, and you get it once per session. |

Limits:

- It needs an OMP that emits `before_subagent_spawn` (measured on omp
  18.16.0). Pi and older OMP never call the handler, so, like any host without
  this extension, they keep the quiet fallback. `pi install
  @sunstone-partners/ensemble-pi` does not install this extension; it is
  installed from a checkout (see "Installing globally").
- Only the user-facing session tells you. A child agent has no UI, so a
  fallback inside an orchestrator's children is not announced separately. The
  first warning lists every tier role with no usable model, so one edit of
  the config covers them all.
- `TIER_ROLES` in `src/model-roles.ts` mirrors the tiers in
  `packages/pi/src/transformers/agent-transformer.ts`. `tests/model-roles.test.ts`
  fails when a generated agent names a role the list lacks.

## Dependency note

This package depends on `@earendil-works/pi-coding-agent`, matching the
package actually resolved by the installed `pi` binary (0.87.1+). The
older `@mariozechner/pi-coding-agent` scope is deprecated upstream in
favor of `@earendil-works/*` — do not add a dependency on the
`@mariozechner` scope to this package.

## Testing

- `npm test` runs the jest unit suite against `dispatcher-commands.ts`,
  `extension.ts`'s native command registration, the lifecycle adapter and the
  model role check (`model-roles.ts`).
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
  `~/.omp/agent/extensions/`, so the dispatcher commands (in repositories
  that have them), the lifecycle hooks (in projects with a hooks file) and the
  model role check (everywhere) are available in every OMP/Pi session (see
  `scripts/install.mjs`).
- `npm run uninstall:extension` removes it.
