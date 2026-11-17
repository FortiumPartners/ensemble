# ensemble-reinstall-plugins skill eval

Scope: a non-interactive run refreshes the installed `ensemble-` plugins through a stub `claude` CLI. The skill (`disable-model-invocation: true`, so it only runs by name) force-refreshes plugins by uninstalling and reinstalling them, because `claude plugin update` is gated on the declared version. The eval drives `/ensemble-core:ensemble:reinstall-plugins` in the with-skill arm; the baseline arm gets the same prompt without the command and without the plugin.

Runtimes: `claude` only. The skill is reached through a package command, and Pi loads a single skill and has no package commands (`explicit` invocation is Claude-only in the harness).

## The prompt

The text after the command is the command's argument, and the skill reads any argument as a filter. The prompt therefore starts with the line `ensemble`, which selects every plugin whose id contains `ensemble` (here exactly the `ensemble-` family: no third-party id in the stub contains it, so the target set is the same as the skill's default). The rest is functional: refresh my installed ensemble plugins so they pick up the latest marketplace content, tell me what happened to each, `claude` on PATH is a local stand-in, I have already approved the reinstall (the skill's AskUserQuestion step cannot be answered in a non-interactive run), save the report to `report.md`. It names none of the skill's conventions; a test asserts the prompt omits the cue words (scope flag, uninstall, update, disable, `--all`, sequential, restart, new session, and so on).

## The stub

`fixture/bin/claude` (put first on the agent's PATH by `sandboxPath`; the harness locates the real `claude` before that, so the stub does not stand in for the agent). No network, no real plugin state. It logs every call, answered or refused, to `plugin-calls.log` in the sandbox root (outside the git worktree). It answers `plugin list --json` (canned: two third-party plugins; `ensemble-core`, `ensemble-development`, `ensemble-git` and `ensemble-product` at user scope; `ensemble-infrastructure` at project scope; `ensemble-jest` at user scope, disabled), `plugin marketplace update` and `list`, `plugin uninstall`, `plugin install` (prints the version it installed) and `plugin disable`. The install of `ensemble-git@ensemble` fails with exit 1, and it sits in the middle of the list, so `ensemble-product` comes after it and must never be touched. It refuses with exit 2 `plugin update`, any auto-approval flag (`--yes`, `-y`, `--auto-approve`, `--force`, ...) and every verb or flag it does not simulate. It enforces no convention: a missing scope, a wrong scope and a third-party plugin are answered like any other call.

## What the checks cover

From the log (`evals/checks/ensemble-reinstall-plugins.js`):

- `inventory-first`: `plugin list --json` ran, and before any change.
- `ensemble-only`: every uninstall, install and disable names an `ensemble-` plugin (the third-party ones are never touched without `--all`).
- `marketplace-first`: `plugin marketplace update` with no marketplace name, before the first uninstall.
- `sequential-pairs`: each uninstall is immediately followed by the install of the same plugin, optionally followed by a disable of that plugin; no interleaving; no plugin twice; inventory order.
- `targets-reinstalled`: each of the four targets before the failing one has an uninstall and a later install.
- `scope-recorded`: every uninstall, install and disable carries `-s`/`--scope` with the scope recorded in the inventory (the project plugin at `user` scope, which the skill says creates a new copy, fails).
- `no-plugin-update`: no `plugin update` or `upgrade`.
- `disabled-restored`: the plugin that was disabled is disabled again, at its scope, right after its reinstall and before the next plugin's uninstall; no enabled plugin is disabled.
- `stop-on-failure`: the failing install ran once, and no uninstall, install, disable or refresh ran after it.
- `no-auto-approve`: no auto-approval flag on any call, refused or not.

From `report.md` (the run is asked to save the report it prints; the skill itself only prints it):

- `failure-reported`: names `ensemble-git@ensemble`, says it is now uninstalled, and gives `claude plugin install ensemble-git@ensemble -s user` (or `--scope user`).
- `report-versions`: for each reinstalled plugin one line naming the plugin and both its before and after version.
- `report-new-session`: says the refreshed content needs a new session.

From the workspace: `workspace-untouched` (only `report.md` added, fixture files byte-identical and none removed) and `no-new-dependency` (no dependency manifest or `node_modules`).

## Known limits

- Shape and order of the commands, not behaviour: the real `claude plugin` is never run, so the stub's output formats, exit codes, the `plugin list --json` fields and the scope error text are assumptions.
- A call that bypasses PATH (an absolute path to a real binary) is not seen.
- Not exercised: `--all` and other filters, a failing `marketplace update`, an empty or failing inventory, a decline of the confirmation, and an install that fails because it needs a confirmation prompt (the prompt grants approval in advance, so there is no AskUserQuestion step to observe).
- Flaky-prone checks (a good run can fail them; the message says what was not found): `marketplace-first` (a named marketplace fails), `sequential-pairs` (inventory order is required; a run that sorts alphabetically fails), `report-versions` (before and after on one line; prose over several lines fails), `report-new-session` (phrase match), `failure-reported` (the restoring command literally as `claude plugin install <id> -s user`).
- The report checks need `report.md`; a run that prints the report but does not save it fails them although the command checks may pass.
- The after version is what the stub printed at install; a run that never read the install output cannot get it right.
- The baseline arm (no plugin, no command) is expected to measure the plugin's conventions (the recorded scope, no `plugin update`, stop on failure, re-disabling), not skill against a well-written prompt.

## What a real trial must settle

- Whether `/ensemble-core:ensemble:reinstall-plugins ensemble ...` resolves under `--plugin-dir` for packages/core (the registered name is an assumption, as for the other command-driven evals), and whether the whole prompt text after the first line is treated as extra arguments to the filter.
- Whether the with-skill arm treats the prompt's statement of approval as the answer to the confirmation step instead of stopping to ask (AskUserQuestion is not in `allowedTools`).
- Whether the nested Bash of the agent really gets the stub `claude` first on PATH, and the agent does not refuse to run `claude plugin ...` inside Claude Code.
- Whether the baseline arm happens to satisfy most checks (a well-written prompt, an obvious stub) so that the uplift is small.
- Whether the report wording in practice satisfies the report checks.
