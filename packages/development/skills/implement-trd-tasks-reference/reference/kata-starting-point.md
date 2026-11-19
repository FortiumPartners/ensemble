# Kata starting point

Shell commands are shown with a `$` prompt; do not type the prompt.

Read this when the project's tracker is kata (`tracker: kata`). It is the only place the kata prerequisites, the binding step and the unbound message are documented for this command.

## Prerequisites

- kata 0.23.0 or later on PATH. Preflight reads the output of `$ kata --version` and stops on an older kata.
- The workspace is bound. `$ kata init --project <name>`, run in the repository directory, creates the kata binding file `.kata.toml`; that file is what binds the workspace to a kata project.
- Kata is selected by configuration only, never auto-detected: set `tracker: kata` in `.ensemble/toolchain.yaml` (project) or `$XDG_CONFIG_HOME/ensemble/toolchain.yaml` (user).

## Fresh-project walkthrough

1. Install kata 0.23.0 or later and confirm `$ kata --version` reports it.
2. In the repository directory run `$ kata init --project <name>`; this creates `.kata.toml`.
3. Set `tracker: kata` in `.ensemble/toolchain.yaml`.
4. Run `/ensemble:implement-trd-tasks <trd-path>`: preflight passes the binding gate, then the scaffold phase creates the epic, stories and tasks as kata work items.

## Unbound workspace

Preflight runs `$ kata doctor --json` and requires `config.workspace` to be `ok`. When it is not, the flow prints this message (preflight prefixes it with the adapter name, so the printed line is the adapter name, a colon and a space, then the text below; the error code HEALTH_FAILED is not printed) and HALTs before any work item is written, so nothing is scaffolded into the wrong project:

```text
the kata workspace is not bound. Run `kata init --project <name>` in this directory to create the kata binding file (.kata.toml), then run again.
```

Printed by preflight, with the adapter prefix:

```text
Printed: kata: the kata workspace is not bound. Run `kata init --project <name>` in this directory to create the kata binding file (.kata.toml), then run again.
```

Run the init command as the message says, then run the command again.
