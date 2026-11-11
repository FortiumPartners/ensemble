# @sunstone-partners/ensemble-codex

Codex CLI runtime support for the Ensemble ecosystem.

## Overview

`ensemble-codex` adapts Ensemble's existing agents, commands, and skills for use with OpenAI Codex CLI.
It now ships a lean runtime bundle optimized for npm distribution.
It generates:

- `AGENTS.md` for project-level Codex instructions
- `.codex/config.toml` for custom agent registration
- `.codex/agents/*.toml` for 28 translated Ensemble agents
- `.codex/skills/<package>/` for lean framework and workflow skills (SKILL.md only for published runtime)
- `.codex/skills/commands/ensemble-*/SKILL.md` for Codex-invocable command skills (a skill-backed command's skill also ships its `references/*.md` beside it)

## Generate

From the monorepo root:

```bash
npm run generate:codex
```

Or from this package:

```bash
npm run generate --workspace=packages/codex
```

## Install into a Codex project

Codex reads `AGENTS.md` at project root and `.codex/` for project-scoped config.

### From this monorepo

```bash
npm run generate:codex
npm run install:codex -- /path/to/project
```

For symlink-based local development:

```bash
npm run install:codex -- /path/to/project --link --force
```

You can also run it from the package workspace:

```bash
npm run install:project --workspace=packages/codex -- /path/to/project --force
```

### From npm

```bash
npm install -D @sunstone-partners/ensemble-codex
npx ensemble-codex-install . --force
```

This makes the published package directly usable without cloning the Ensemble monorepo.

## What gets installed

- `AGENTS.md` — concise Codex-oriented project instructions
- `.codex/config.toml` — agent registry and default Codex settings
- `.codex/agents/*.toml` — 28 translated Ensemble agents with Codex-style configuration
- `.codex/skills/<name>/SKILL.md` — copied framework and test skills
- `.codex/skills/commands/ensemble-*/SKILL.md` — translated Ensemble commands as Codex skills

## Usage

- Use translated Ensemble agents from `.codex/agents/`
- Invoke command skills such as `/ensemble-create-prd`
- Let agents preload relevant framework/test skills automatically
- Re-run `npm run generate:codex` after changing source YAML, markdown, or skill content

Command skills whose source declares `disable-model-invocation: true` also ship `agents/openai.yaml` with `policy: allow_implicit_invocation: false`. Claude, Pi and OMP read the frontmatter key; Codex ignores it and reads this file instead, so these skills are not injected into the model context by default and run only when invoked explicitly (for example `$ensemble-create-prd`).

## Release automation

Sync versions across `packages/codex/package.json`, `.claude-plugin/plugin.json`, and `marketplace.json`:

```bash
npm run version:codex -- 5.3.1
```

Generate root Ensemble release notes locally:

```bash
npm run release-notes
npm run release-notes -- --update-changelog
```

The root `CHANGELOG.md` is now written in a cleaner Keep a Changelog format with standard sections like `Added`, `Changed`, and `Fixed`. General release notes also deduplicate similar commits, prioritize user-facing changes, hide merge commits by default, and collapse long sections into summary bullets.

Codex-specific notes are still available if needed:

```bash
npm run release-notes:codex
```

Then publish via GitHub Actions using either:

- a tag like `codex-v5.3.1`, or
- the `Publish Codex Package` workflow with an optional version input.

The main release workflow now generates general Ensemble release notes from conventional commits, and the Codex publish workflow still generates Codex package notes when publishing that package directly.

## License

Apache License 2.0. See the repository [LICENSE](../../LICENSE) and [NOTICE](../../NOTICE).
