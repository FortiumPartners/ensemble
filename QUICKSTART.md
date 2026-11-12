# Quickstart

## Install (Claude Code)

```bash
/plugin marketplace add Sunstone-Partners/ensemble
/plugin install ensemble-full@ensemble
```

Or install single plugins, e.g. `/plugin install ensemble-core@ensemble`. See README.md for the full list and scopes.

Local development: `claude --plugin-dir ./ensemble/packages/core`.

## Build a feature

```text
/ensemble-full:ensemble-feature new "add CSV export to reports"
```

This drives the feature lifecycle (PRD, TRD, implementation) and pauses at gates for your approval. Individual steps are also available: `/ensemble-full:ensemble-create-prd`, `/ensemble-full:ensemble-create-trd`.

`feature` is the front door to `ensemble-new-feature`, the engine that holds the run state: it turns `new`, `resume`, `status` and `abandon` into the engine's `--idea`, `--status` and `--abandon` flags. You only need `ensemble-new-feature` directly for a flag the keywords don't cover.

> With the `ensemble-full` bundle, Claude Code commands are `/ensemble-full:ensemble-<name>`. The `/ensemble:<name>` form applies to standalone plugins and the Pi, Codex and OpenCode runtimes.

## Where artifacts land

- PRDs: `docs/PRD/`
- TRDs: `docs/TRD/`
- Run state: `.ensemble/new-feature/`

## Resume / status / abandon

```text
/ensemble-full:ensemble-feature resume
/ensemble-full:ensemble-feature status
/ensemble-full:ensemble-feature abandon [reason]
```

`resume` continues the active or paused run from its last checkpoint.

## Uninstall

```bash
/plugin uninstall ensemble-full@ensemble
/plugin marketplace remove ensemble
```
