# Changelog

All notable changes to ensemble-pi will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
