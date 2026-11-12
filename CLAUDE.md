@AGENTS.md

# Ensemble

Multi-runtime SDLC framework: Claude Code plugins under `packages/` (agents, commands, skills, hooks), plus generated Pi, Codex and OpenCode output. Package list, agent/command/skill inventory: see `packages/`.

## Command names

`ensemble-full` ships skills only (no command stubs), so in Claude Code its commands are `/ensemble-full:ensemble-<name>`. `/ensemble:<name>` is the form for standalone plugins and the Pi, Codex and OpenCode runtimes.

## Source of truth vs generated

- Edit `packages/*/agents/*.yaml`, `packages/*/commands/*.yaml`, and source `SKILL.md` files. The `.md` beside a YAML file is generated (`DO NOT EDIT`).
- Regenerate with `npm run generate`; runtimes separately: `npm run generate:pi`, `npm run generate:codex`, `npm run generate:opencode`. Never hand-edit `packages/pi`, `packages/codex`, `packages/opencode` output.

## Validate / test

- `npm run validate` (schemas, version sync, model ids), `npm run generate:validate`, `npm test` (workspaces), `npm run lint`, `npm run lint:md`.
- Single test: `npx jest <path>`.

## Versions

Bump per changed package: `packages/<name>/package.json`, `.claude-plugin/plugin.json`, and its `marketplace.json` entry must agree (`scripts/validate-version-sync.js`). Release set (root `package.json`, `packages/full/`, `ensemble-full` marketplace entry) must match each other before tagging.

## Hooks

Claude Code hooks receive JSON on stdin (not env vars like `TOOL_NAME`). Exit 0 = allow; exit 2 = block, with stderr fed back to the model. `hooks.json` has a top-level `hooks` wrapper; plugin scripts use `${CLAUDE_PLUGIN_ROOT}`. See `docs/HOOKS_GUIDE.md`.
