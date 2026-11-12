# @sunstone-partners/ensemble-full

Complete ensemble ecosystem (meta-package with all plugins)

## Installation

```bash
claude plugin install @sunstone-partners/ensemble-full
```

## Description

Part of the ensemble plugin ecosystem for Claude Code. This plugin provides complete ensemble ecosystem (meta-package with all plugins).

## Features

- Mirrors every plugin's `lib/` modules under `packages/full/lib/` via symlink, including the `pr-review-*.js` libraries (`pr-review-policy`, `pr-review-rules`, `pr-review-paths`, `pr-review-description`, `pr-review-scope`, `pr-review-state`, `pr-review-status`, `pr-review-ledger`, `pr-review-remote`, `pr-review-cli`) that back the `pr-review-cycle` skill, so they resolve from a single install the same way as every other package.

## Usage

After installation, this plugin's agents and skills are available in Claude Code. It ships no command stubs: every command is a skill, invoked as `/ensemble-full:ensemble-<name>` (for example `/ensemble-full:ensemble-refine-prd`). The `/ensemble:<name>` form belongs to the standalone plugins and the Pi, Codex and OpenCode runtimes.

## Documentation

See the [main ensemble repository](https://github.com/Sunstone-Partners/ensemble) for complete documentation.

## License

Apache License 2.0. See the repository [LICENSE](../../LICENSE) and [NOTICE](../../NOTICE).
