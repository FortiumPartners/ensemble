# @fortium/ensemble-development

Development agents for frontend/backend implementation

## Installation

```bash
claude plugin install @fortium/ensemble-development
```

## Description

Part of the ensemble plugin ecosystem for Claude Code. This plugin provides development agents for frontend/backend implementation.

## Features

- TBD (to be populated during plugin extraction)

## Commands

| Command | Description |
|---------|-------------|
| `/ensemble:implement-trd` | Complete TRD implementation using git-town workflow with TDD methodology |
| `/ensemble:implement-trd-beads` | TRD implementation with persistent beads project management — epic/story/task hierarchy, `bd ready` execution loop, cross-session resumability |
| `/ensemble:create-trd` | Create a Technical Requirements Document from a PRD |
| `/ensemble:create-trd-foreman` | Create a Foreman-native structured TRD that `foreman sling prd` can consume |
| `/ensemble:refine-trd` | Refine and improve an existing TRD |
| `/ensemble:fix-issue` | Lightweight bug fix workflow (analysis to PR) |
| `/ensemble:generate-api-docs` | Generate API documentation |

## Usage

After installation, this plugin's agents, commands, and skills will be automatically available in Claude Code.

### Multi-TRD Beads Workstreams

`/ensemble:implement-trd-beads` supports both single-TRD and multi-TRD execution.
Single-TRD invocation keeps the existing behavior:

```bash
/ensemble:implement-trd-beads docs/TRD/TRD-2026-001-feature.md --plan
/ensemble:implement-trd-beads docs/TRD/TRD-2026-001-feature.md --execute
```

Passing two or more TRD paths activates combined workstream mode:

```bash
/ensemble:implement-trd-beads docs/TRD/TRD-2026-001-api.md docs/TRD/TRD-2026-002-ui.md --plan
/ensemble:implement-trd-beads docs/TRD/TRD-2026-001-api.md docs/TRD/TRD-2026-002-ui.md --execute
/ensemble:implement-trd-beads docs/TRD/TRD-2026-001-api.md docs/TRD/TRD-2026-002-ui.md --status
```

Combined workstream mode:

- validates all TRDs before any Beads, branch, or scaffold side effect;
- creates one release train bead plus one TRD epic per source TRD;
- preserves each TRD's PR/story/task hierarchy under its own epic;
- supports source-qualified cross-TRD deps: `<trd-slug>#TRD-NNN` and `<trd-slug>#PR-N`;
- uses only `bv --robot-*` graph checks and prompts before unresolved/cyclic dependency changes;
- reports release train progress plus per-TRD ready/blocked/in-progress counts.

If stacked PR support is enabled with `ENSEMBLE_USE_STACKED_PRS=true`, combined mode prints `Combined workstream mode: stacked PRs enabled`; otherwise it offers scaffold-only or alternate execution paths.

## Documentation

See the [main ensemble repository](https://github.com/FortiumPartners/ensemble) for complete documentation.

## License

MIT
