---
name: ensemble-reinstall-plugins
description: Force-refresh installed plugins by uninstalling and reinstalling them, picking up marketplace content that version-gated updates miss (Codex skill for /ensemble:reinstall-plugins)
user-invocable: true
argument-hint: '[--all | <filter>]'
---

# Ensemble Command: /ensemble:reinstall-plugins

This Codex skill mirrors the Ensemble slash command `/ensemble:reinstall-plugins`.
Follow the workflow below, adapt to the current repository, and keep outputs structured.

<!-- DO NOT EDIT - Generated from reinstall-plugins.yaml -->
<!-- To modify this file, edit the YAML source and run: npm run generate -->


Force-refresh installed plugins so they pick up the latest marketplace content.

`claude plugin update` gates on the version string declared in a plugin's
manifest. When a marketplace's content changes but a plugin's declared version
does not, `update` silently reports success and installs nothing — the machine
keeps serving stale skills, commands, and agents indefinitely. The only
reliable refresh today is a full uninstall followed by a reinstall.

This command is a deliberate stopgap. Retire it once plugin updates resolve
against marketplace content rather than the declared version string.

## Workflow

### Phase 1: Target Selection

**1. Inventory Installed Plugins**
   Read the authoritative list of what is installed and where

- Run `claude plugin list --json` via Bash
- Parse each entry's id (in `plugin@marketplace` form), version, scope, and enabled fields
- If the command fails or returns an empty array, report that there is nothing to reinstall and stop

**2. Apply the Target Filter**
   Resolve which installed plugins this run touches

- With no argument, target every plugin whose id begins with `ensemble-`
- With `--all`, target every installed plugin, including third-party ones
- With any other argument, target every plugin whose id contains that string, matched case-insensitively
- If the filter matches nothing, list the installed ids so the user can correct the filter, then stop without changing anything

### Phase 2: Confirmation

**1. Present the Reinstall Plan**
   Get explicit approval before removing anything

- Print a table of each target's id, current version, scope, and enabled state
- State that every target is uninstalled and then reinstalled at the scope it is already installed at
- Warn that a failed reinstall leaves that plugin uninstalled until its install command is re-run by hand
- When the target set includes plugins outside the `ensemble-` family, call that out explicitly so the wider blast radius is a conscious choice
- Ask for approval once using AskUserQuestion, and stop without changes if the user declines

### Phase 3: Marketplace Refresh

**1. Pull Latest Marketplace Content**
   Refresh the local marketplace caches before anything is removed

- Run `claude plugin marketplace update` with no marketplace name so every configured marketplace refreshes
- If it exits non-zero, report the failure and stop before uninstalling anything — reinstalling from a stale cache achieves nothing while still risking leaving plugins uninstalled

### Phase 4: Reinstall

**1. Reinstall Each Target Sequentially**
   Uninstall and reinstall one plugin at a time, preserving scope and enabled state

- For each target in list order, run `claude plugin uninstall <id> -s <scope>` and then `claude plugin install <id> -s <scope>`
- Always pass the scope recorded for that plugin in the inventory, and never any other scope
- Passing a scope the plugin is not installed at does not no-op — `-s project` where only a user install exists creates a brand new project-scope copy rather than failing
- Never substitute `claude plugin update <id>`; it is version-gated and silently no-ops when marketplace content changed but the declared version did not, which is the exact failure this command works around
- If the inventory recorded a plugin as disabled, run `claude plugin disable <id> -s <scope>` after its reinstall to restore that state
- If an install fails, stop the loop immediately, report which plugin is now uninstalled along with the exact command that restores it, and leave the remaining targets untouched
- If an install fails because it needs a confirmation prompt that cannot be shown in a non-interactive shell, report that the plugin must be reinstalled manually in a terminal rather than retrying it with an auto-approval flag

### Phase 5: Report

**1. Summarize the Refresh**
   Report what changed and what the user must do next

- Print each reinstalled plugin with its before and after version
- Note that targets whose version was unchanged still picked up new marketplace content, which is the point of the command
- Tell the user the refreshed content only loads in a new session — a fresh start or `--continue` both re-run plugin discovery, `--bare` does not

## Expected Output

**Format:** Terminal Report

**Structure:**
- **Reinstall summary**: Per-plugin before and after version, scope, any failures with their recovery command, and the session-restart notice

## Usage

```
/ensemble:reinstall-plugins [--all | <filter>]
```
