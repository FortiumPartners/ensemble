# Environment Variables Reference

This document lists every environment variable recognized by Ensemble — what each one does, its default value, and a usage example. Variables are grouped by who sets them.

## User-Facing Variables

Set these in your shell before invoking Ensemble commands. None are required unless you need to override a default.

| Variable | Default | Purpose | Example |
|---|---|---|---|
| `XDG_CONFIG_HOME` | `~/.config` | Base directory for user-level config. Ensemble looks for its config at `$XDG_CONFIG_HOME/ensemble/`. Standard XDG variable shared with other tools. | `XDG_CONFIG_HOME=/opt/config` |
| `ENSEMBLE_PERMITTER_DISABLE` | _(unset)_ | Disable the permission-expansion hook entirely. Set to any non-empty value (e.g., `1`). Useful when troubleshooting permission issues or when the hook conflicts with other tooling. | `ENSEMBLE_PERMITTER_DISABLE=1` |
| `PERMITTER_DEBUG` | _(unset)_ | Enable verbose debug logging from the permitter hook to stderr. Set to `1`. Shows detailed permission-matching info for each tool invocation. | `PERMITTER_DEBUG=1` |
| `ENSEMBLE_PANE_DISABLE` | _(unset)_ | Disable the pane-spawner hook. Set to any non-empty value. Prevents Ensemble from auto-opening terminal panes in WezTerm, Zellij, or tmux during agent execution. | `ENSEMBLE_PANE_DISABLE=1` |
| `METRICS_API_URL` | `http://localhost:3002/api/v1` | Endpoint for posting usage and metrics events. Only needed when using the metrics plugin. | `METRICS_API_URL=https://metrics.example.com/api/v1` |
| `METRICS_API_TOKEN` | _(none)_ | Bearer token for the metrics API. When set, sent as `Authorization: Bearer <token>`. Only needed when the metrics endpoint requires authentication. | `METRICS_API_TOKEN=secret-token` |
| `PROJECT_ID` | Current directory basename | Project identifier tag attached to all metric events. Defaults to the basename of the current working directory. | `PROJECT_ID=my-project` |
| `ENSEMBLE_USE_STACKED_PRS` | _(unset — single PR)_ | When `true`, `implement-trd` and `implement-trd-beads` create one stacked PR per `### PR N:` / sprint section (git-town append chain). When unset or any other value, all phases are implemented on a single branch and ONE PR is created for the whole TRD. Phase ordering is preserved either way. | `ENSEMBLE_USE_STACKED_PRS=true` then run `/ensemble:implement-trd-beads docs/TRD/my-trd.md` |

## Injected by Claude Code

Claude Code sets these automatically when a plugin loads or when a hook is invoked. Do not set them manually — their values are managed by the runtime.

| Variable | Purpose | Notes |
|---|---|---|
| `CLAUDE_PLUGIN_ROOT` | Absolute path to the installed plugin directory. Used in all hook `command` fields to locate hook scripts. | Referenced as `${CLAUDE_PLUGIN_ROOT}/hooks/router.py` in `hooks.json`. |
| `TOOL_NAME` | Name of the tool being invoked (e.g., `Bash`, `Read`, `Task`). | Injected into every hook process at invocation time. |
| `TOOL_INPUT` | JSON-encoded parameters for the current tool call. | Parse with `JSON.parse(process.env.TOOL_INPUT \|\| '{}')` inside hook scripts. |
| `CLAUDE_SESSION_ID` | Claude Code session identifier. | Read by the metrics hook to tag events with the originating session. |

## Auto-Detected (read only)

Ensemble reads these standard variables from the environment to detect the active terminal multiplexer, shell, and runtime context. Ensemble never sets or modifies them.

| Variable | Detected Context |
|---|---|
| `TMUX` / `TMUX_PANE` | Active tmux session |
| `WEZTERM_PANE` | WezTerm terminal |
| `ZELLIJ` / `ZELLIJ_PANE_ID` / `ZELLIJ_SESSION_NAME` | Zellij terminal multiplexer |
| `SHELL` | Current shell, used for framework and environment detection hints |
| `GIT_BRANCH` / `GIT_COMMIT` | Read by the metrics hook as event tags |
| `USER` / `USERNAME` | Read by the metrics hook for event identity |
| `NODE_ENV` | Standard Node environment flag, read by the metrics hook |

---

Related documentation:

- `packages/permitter/README.md` — permitter hook details and allowlist format
- `packages/full/HOOKS.md` — full hook system reference
