# @sunstone-partners/ensemble-dotnet

.NET backend development agents and skills for ASP.NET Core, Wolverine CQRS, MartenDB event sourcing, and idiomatic C# patterns.

This package is separate from `@sunstone-partners/ensemble-blazor`, which covers Blazor frontend work. The `dotnet` package is focused exclusively on server-side .NET backend development.

## Installation

```bash
claude plugin install @sunstone-partners/ensemble-dotnet
```

## Agents

### `dotnet-backend-expert`

A specialist agent for .NET backend development. Invoke it when you need to:

- Design and implement ASP.NET Core Web API or Minimal API endpoints
- Build Wolverine command/query handlers and message routing
- Implement MartenDB document storage or event-sourced aggregates
- Write xUnit unit and integration tests (WebApplicationFactory, Testcontainers)
- Configure JWT authentication and policy-based authorisation
- Design Entity Framework Core schemas and migrations

The agent automatically loads the `dotnet` skill from
`packages/dotnet/skills/dotnet/SKILL.md` at task start.

**Delegation boundaries:**
- Blazor/frontend work → `dotnet-blazor-expert` (future agent)
- Infrastructure/deployment → `infrastructure-developer`
- Code review → `code-reviewer`
- PostgreSQL tuning → `postgresql-specialist`

## Skills

The shared `.NET` skill documentation lives in `packages/dotnet/skills/dotnet/` and covers:

- ASP.NET Core controller and Minimal API patterns
- Wolverine CQRS command/query handlers and sagas
- MartenDB event sourcing, projections, and snapshots
- C# records, pattern matching, nullable reference types
- xUnit, Moq/NSubstitute, FluentAssertions testing patterns
- EF Core code-first migrations and query optimisation

The `packages/dotnet/skills/` directory exists for future .NET-backend-specific skill additions.

## Usage

After installation, the `dotnet-backend-expert` agent is automatically available in Claude Code. The ensemble orchestration layer will route .NET backend tasks to this agent based on project detection signals (`*.csproj`, `Program.cs`, Wolverine/Marten references).

## Documentation

See the [main ensemble repository](https://github.com/Sunstone-Partners/ensemble) for complete documentation.

## License

Apache License 2.0. See the repository [LICENSE](../../LICENSE) and [NOTICE](../../NOTICE).
