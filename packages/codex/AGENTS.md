# Ensemble for Codex

Use this bundle to bring Ensemble into Codex CLI. It provides 32 custom agents, 36 command skills, and 11 framework/testing skills.

## What Codex Should Know

- Prefer the custom agents in `.codex/agents/` for specialized work.
- Treat `AGENTS.md` as the shared project contract and `.codex/config.toml` as the agent registry.
- Ensemble slash commands are exposed as Codex skills using `/ensemble-...` names such as `/ensemble-create-prd`.
- Framework and test skills live under `.codex/skills/` and should be consulted before framework-specific implementation.

## Recommended Workflow

1. Read the nearest `AGENTS.md` files that apply to files you touch.
2. Pick a specialized agent when the task clearly matches one.
3. Load relevant framework/test skills before editing implementation code.
4. Prefer small, verifiable changes and run focused tests after edits.
5. Summarize changed files, validation run, and any remaining risks.

## Agent Routing

- Product/spec work: `product-management-orchestrator`, `documentation-specialist`
- Application code: `backend-developer`, `frontend-developer`, `tech-lead-orchestrator`
- Quality: `code-reviewer`, `deep-debugger`, `test-runner`, `playwright-tester`
- Infra/release: `infrastructure-developer`, `build-orchestrator`, `deployment-orchestrator`, `release-agent`
- Research/general tasks: `general-purpose`, `context-fetcher`

## Key Skills

- Frameworks: `react`, `nestjs`, `rails`, `phoenix`, `blazor`
- Test frameworks: `jest`, `pytest`, `rspec`, `xunit`, `exunit`
- Commands: `.codex/skills/commands/ensemble-*/SKILL.md`

## Validation

- Run `npm test` for broad verification.
- Run package-specific tests when editing one package.
- Use `npm run generate`, `npm run generate:pi`, `npm run generate:opencode`, or `npm run generate:codex` after changing generators or source YAML.

## Beads

- Start with `bv --robot-triage` or `br ready` when working from the issue queue.
- Claim with `br update <id> --status in_progress` and close with `br close <id>` when done.
- Run `br sync --flush-only` before ending a work session that changed bead state.
