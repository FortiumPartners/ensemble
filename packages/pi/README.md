# @fortium/ensemble-pi

Pi runtime support — translates Ensemble YAML sources into Pi coding agent artifacts.

## Overview

`ensemble-pi` is the translation layer between the Ensemble plugin ecosystem and the
[Pi coding agent](https://github.com/mariozechner/pi). It reads Ensemble YAML command
definitions, agent manifests, and skill files from the monorepo and emits Pi-compatible
artifacts: prompt templates, agent definitions, skill directories, an agent mesh reference,
and a registered `ask_user` extension.

The generated output lives inside this package and is loaded by Pi at runtime via the
`pi` manifest field in `package.json`.

## Installation

**From the Pi package registry:**

```bash
pi install @fortium/ensemble-pi
```

**Local development install:**

```bash
pi install ./packages/pi
```

## Generated Artifacts

| Directory / File | Count | Description |
|-----------------|-------|-------------|
| `prompts/` | 23 files | Command prompt templates (one per Ensemble slash command) |
| `agents/` | 28 files | Agent definition markdown (one per Ensemble agent) |
| `skills/` | 49 directories | Skill documentation copied from all packages |
| `AGENTS.md` | 1 file | Agent mesh reference extracted from the monorepo |
| `extensions/ask-user.ts` | 1 file | Registers the `ask_user` tool via Pi `ExtensionAPI` |

All artifact counts reflect the current state after running `npm run generate:pi` from
the monorepo root.

## Usage

**Standard (via monorepo root):**

```bash
npm run generate:pi
```

**Direct CLI (after building):**

```bash
node packages/pi/dist/index.js
node packages/pi/dist/index.js --dry-run --verbose
node packages/pi/dist/index.js --validate
```

## CLI Flags

| Flag | Description |
|------|-------------|
| `--dry-run` | Preview all file writes without writing to disk |
| `--verbose` | Emit detailed progress for each transformer step |
| `--validate` | Validate generated output against Pi schema rules; exit 1 on errors |

Flags can be combined: `--dry-run --verbose` previews all output with full logging.

## Development

```bash
# Build TypeScript
npm run build

# Run tests
npm test

# Regenerate Pi artifacts from current Ensemble sources
npm run generate

# Validate versions are in sync (package.json vs plugin.json)
npm run validate:version
```

The `generate` script calls `node dist/index.js` after `build`. Run `npm run build &&
npm run generate` after any source changes.

## Architecture

```
Ensemble YAML sources (packages/*/commands/*.yaml, agents/*.yaml, skills/)
          |
          v
  Generator orchestrator (src/generator.ts)
          |
    ┌─────┴──────────────────────────────┐
    |             Transformer pipeline    |
    |  command-transformer   → prompts/  |
    |  agent-transformer     → agents/   |
    |  skill-copier          → skills/   |
    |  agents-md-generator   → AGENTS.md |
    |  ask-user extension    → extensions/ |
    └────────────────────────────────────┘
          |
          v
     Pi artifact output (this package)
```

**Transformer responsibilities:**

- **command-transformer** — converts Ensemble YAML `phases`/`steps`/`actions` into Pi
  prompt template markdown
- **agent-transformer** — converts YAML agent definitions into Pi agent markdown with
  Pi-compatible tool lists
- **skill-copier** — propagates `SKILL.md` files from all packages into `skills/`
- **agents-md-generator** — extracts the agent mesh overview from `packages/CLAUDE.md`
- **ask-user extension** — registers `ask_user` as a Pi tool via `ExtensionAPI` so
  agents can prompt users interactively during runs

## Contributing

Bug reports and feature requests: [https://github.com/FortiumPartners/ensemble/issues](https://github.com/FortiumPartners/ensemble/issues)

See the [main ensemble repository](https://github.com/FortiumPartners/ensemble) for
development conventions, commit standards, and the PR process.

## License

MIT
