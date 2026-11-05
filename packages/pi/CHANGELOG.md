# Changelog

All notable changes to ensemble-pi will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed
- Generated agents now emit an OMP role-alias list (`model: "@high,@default"` / `"@medium,@default"`) for the abstract `high`/`medium` model tiers. OMP resolves a bare `model:` word as a model-name substring (`high` matched `openrouter/openai/o3-mini-high`), not as a role. `high` and `medium` are custom OMP roles: define `modelRoles.high` / `modelRoles.medium` (and `modelRoles.default`) in the OMP config to get tiered models. Without them the agent runs on `modelRoles.default`, and without `modelRoles.default` it has no model (see "Model tiers and OMP roles" in the README).
- Regenerated skills, prompts and the `code-reviewer` agent for the code-review final fixes (gate ledger-unavailable wording, `disposition` output field); re-vendored `lib/pr-review-*.js`.
- Preserve explicitly declared `Task` as native `task` in generated agents so OMP orchestrators can delegate, without granting delegation to agents whose source does not declare it.

### Changed
- README: "Model tiers and OMP roles" now says that the optional `@sunstone-partners/ensemble-pi-extension` reports an unset tier role (a once-per-session warning when the agent falls back, a refused spawn when nothing resolves), and that OMP stays quiet without it.

### Security
- Removed obsolete Claude Code/Agent SDK install guidance from the copied Anthropic skill.

## [1.0.0] - 2026-03-29

### Added

- `packages/pi` monorepo package with TypeScript generator
- Command transformer: translates Ensemble YAML command phases/steps/actions -> Pi prompt templates
- Agent transformer: converts YAML agent definitions -> Pi agent markdown with filtered tools
- Skill copier: propagates SKILL.md files from all packages to packages/pi/skills/
- AGENTS.md generator: extracts agent mesh overview from packages/CLAUDE.md
- `ask-user.ts` extension: registers `ask_user` tool via Pi ExtensionAPI for interactive interviews
- `--dry-run`, `--verbose`, `--validate` CLI flags
- `generate:pi` npm script in monorepo root
- Pi-compatible package manifest with `pi` manifest field
- Marketplace registration in marketplace.json
- CI drift detection in validate.yml workflow
