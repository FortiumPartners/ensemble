# Environment Variables Reference

This document lists every environment variable recognized by Ensemble — what each one does, its default value, and a usage example. Variables are grouped by who sets them.

## User-Facing Variables

Set these in your shell before invoking Ensemble commands. None are required unless you need to override a default.

| Variable | Default | Purpose | Example |
|---|---|---|---|
| `XDG_CONFIG_HOME` | `~/.config` | Base directory for user-level config. Ensemble looks for its config at `$XDG_CONFIG_HOME/ensemble/`. Standard XDG variable shared with other tools. | `XDG_CONFIG_HOME=/opt/config` |
| `ENSEMBLE_PERMITTER_DISABLE` | _(unset)_ | Disable the permission-expansion hook entirely. Only the exact value `1` disables it; any other value (`true`, `yes`, `0`, empty) leaves the hook enabled. Useful when troubleshooting permission issues or when the hook conflicts with other tooling. | `ENSEMBLE_PERMITTER_DISABLE=1` |
| `PERMITTER_DEBUG` | _(unset)_ | Enable verbose debug logging from the permitter hook to stderr. Set to `1`. Shows detailed permission-matching info for each tool invocation. | `PERMITTER_DEBUG=1` |
| `ENSEMBLE_USE_STACKED_PRS` | _(unset — single PR)_ | When `true`, `implement-trd-tasks` create one stacked PR per `### PR N:` / sprint section (git-town append chain). When unset or any other value, all phases are implemented on a single branch and ONE PR is created for the whole TRD. Phase ordering is preserved either way. | `ENSEMBLE_USE_STACKED_PRS=true` then run `/ensemble:implement-trd-tasks docs/TRD/my-trd.md` |
| `ENSEMBLE_BRANCHING_STRATEGY` | _(unset — auto-detect)_ | Overrides Preflight's auto-detected branching strategy for `implement-trd-tasks` and `beads-build`. `git-town` forces git-town (HALTs with instructions if git-town isn't installed or configured). `plain-git` forces plain git commands (`git checkout -b`/`git switch`/`git push`), skipping git-town entirely regardless of its state. When unset, Preflight auto-detects: uses `git-town` if installed and configured; otherwise falls back to `plain-git` (silently if git-town isn't installed, with one warning if it's installed but unconfigured). | `ENSEMBLE_BRANCHING_STRATEGY=plain-git` then run `/ensemble:implement-trd-tasks docs/TRD/my-trd.md` |
| `ENSEMBLE_PR_BACKEND` | _(unset — auto-detect, defaults to `gh`)_ | Controls how PRs are created, independent of `ENSEMBLE_BRANCHING_STRATEGY`. `gh` uses the GitHub CLI (today's default behavior). `ado` targets Azure DevOps. `manual` skips automated PR creation and prints instructions instead. When unset and the origin remote is on a host git-town can't support natively (e.g. `dev.azure.com`), Preflight prompts interactively or HALTs (non-interactive sessions) asking you to set this variable. | `ENSEMBLE_PR_BACKEND=ado` then run `/ensemble:implement-trd-tasks docs/TRD/my-trd.md` |
| `CLOUDFLARED_PATH` | Auto-detect (`~/.cloudflared/cloudflared`, `/usr/local/bin/cloudflared`, `/opt/homebrew/bin/cloudflared`, `/usr/bin/cloudflared`, then `PATH` lookup) | Absolute path to the `cloudflared` binary used by `--tunnel=quick` to expose the refinement-review server over a Cloudflare Quick Tunnel. Set this if `cloudflared` is installed in a non-standard location. | `CLOUDFLARED_PATH=/opt/local/bin/cloudflared` |
| `E2E_EVIDENCE_DIR` | `<temp>/e2e-evidence` | Where `/ensemble:author-playwright-tests` runs write each test's end-state screenshot (`<AC id>.png`, for a pass and for a failure). Read by the `EvidenceCapture` C# helper the command adds to the E2E test project. Kept outside the repo, so nothing is committed. | `E2E_EVIDENCE_DIR=/tmp/e2e-evidence` |
| `E2E_EVIDENCE_ATTACH_CMD` | _(unset — screenshots stay local and the missing capability is reported)_ | Command that attaches a screenshot to an Azure DevOps Test Case. The Azure DevOps MCP server cannot upload files, so `/ensemble:author-playwright-tests` runs this instead. It must contain both `{workItemId}` and `{path}`; `{path}` is substituted already double-quoted, so do not quote it. | `E2E_EVIDENCE_ATTACH_CMD=pwsh tools/Add-AdoAttachment.ps1 -WorkItemId {workItemId} -Project 'My Project' -Path {path} -ReplaceSameName` |

## Injected by Claude Code

Claude Code sets `CLAUDE_PLUGIN_ROOT` when a plugin loads or a hook is invoked. Do not set it manually; its value is managed by the runtime. A hook receives its event as JSON on stdin (not in environment variables), exits 0 to allow, and exits 2 to block, with stderr fed back to the model.

| Variable | Purpose | Notes |
|---|---|---|
| `CLAUDE_PLUGIN_ROOT` | Absolute path to the installed plugin directory. Used in all hook `command` fields to locate hook scripts. | Referenced as `${CLAUDE_PLUGIN_ROOT}/hooks/permitter.js` in `hooks.json`; the command string is quoted so a path with a space execs as one word. |
| `CLAUDE_SESSION_ID` | Claude Code session identifier. | Read by the toolchain confirmation code (`packages/development/lib/toolchain/confirm.js`) to identify the session. |

`TOOL_NAME` and `TOOL_INPUT` are not injected by Claude Code. The OpenCode hook bridge (`packages/opencode/src/hooks/bridge.js`) sets them for the hook processes it starts.

## Passed through (read only)

Ensemble passes these standard variables through unchanged. Ensemble never sets or modifies them.

| Variable | Use |
|---|---|
| `SHELL` | Passed through to the local CI gate and review runners in their environment allowlist (`USER`, `LOGNAME`, `SHELL`, `LANG`, `LC_ALL`, `TERM`, `TMPDIR`, `NODE_OPTIONS`); not read for detection |

---

Related documentation:

- `packages/permitter/README.md` — permitter hook details and allowlist format
