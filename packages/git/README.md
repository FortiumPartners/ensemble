# @sunstone-partners/ensemble-git

Git workflow automation and conventional commits

## Installation

```bash
claude plugin install @sunstone-partners/ensemble-git
```

## Description

Part of the ensemble plugin ecosystem for Claude Code. This plugin provides git workflow automation and conventional commits.

## Features

- TBD (to be populated during plugin extraction)

## Commands

| Command | Description |
|---------|-------------|
| `/ensemble:pr-merge` | Drive an open PR to green and merged: discovers every failing CI check and unresolved review thread, routes each to the owning orchestrator (tech-lead-orchestrator for code, qa-orchestrator for tests, build-orchestrator/infrastructure-orchestrator for pipeline/infra checks, github-specialist for PR mechanics), dispatches remediation concurrently, re-verifies against live CI/review state, and loops (bounded by `--max-rounds`, default 5) until merged or escalated |
| `/ensemble:release` | Release workflow orchestration with quality gates and deployment coordination |
| `/ensemble:claude-changelog` | Generate a changelog from conventional commits |

## Usage

After installation, this plugin's agents, commands, and skills will be automatically available in Claude Code.

### PR Merge Remediation Loop

`/ensemble:pr-merge [pr-number-or-url] [--max-rounds=N] [--dry-run]` resolves the target PR (current branch if omitted), builds a Findings Manifest of every failing/pending CI check plus every unresolved review change-request thread, and classifies each into exactly one owning orchestrator via a fixed routing table (test-related findings -> `qa-orchestrator`; implementation code, build/lint/typecheck, and code-review comments -> `tech-lead-orchestrator`; CI pipeline infrastructure -> `build-orchestrator`; cloud/deploy -> `infrastructure-orchestrator`; PR mechanics -> `github-specialist`). Every finding in a round is dispatched concurrently and re-verified against fresh `gh pr checks`/`gh pr view` output before the next round -- a subagent's own success claim is never trusted. Merges only when every required check is green and every review thread is resolved.

**Hard constraint:** no finding may be resolved by deleting, skipping, disabling, or weakening a test. Failing tests, compiler warnings, and build failures must be fixed at their root cause; a subagent that believes a test is genuinely obsolete must HALT that finding and escalate it in the round report instead of deleting it.

## Documentation

See the [main ensemble repository](https://github.com/Sunstone-Partners/ensemble) for complete documentation.

## License

MIT
