# .NET Framework Skill

**Framework**: .NET 8+ with ASP.NET Core
**Target Agent**: `backend-developer` (generic agent)
**Lazy Loading**: Framework-specific expertise loaded on-demand
**Skill Size**: SKILL.md (~15KB quick reference) + REFERENCE.md (~40KB comprehensive guide)

---

## Overview

This skill provides comprehensive .NET backend expertise for the `backend-developer` agent, enabling it to build production-ready web APIs and services with modern .NET patterns, including ASP.NET Core, Wolverine message handling, MartenDB document storage, and event sourcing.

### What This Skill Covers

- **ASP.NET Core Web APIs**: Controllers, minimal APIs, middleware, dependency injection
- **Wolverine**: Message-driven architectures, command/query handlers, message routing
- **MartenDB**: Document storage, event sourcing, CQRS patterns, projections
- **CQRS & Event Sourcing**: Command/Query separation, event streams, aggregates
- **Enterprise Patterns**: Repository pattern, unit of work, domain-driven design
- **API Development**: REST APIs, validation, error handling, versioning
- **Testing**: xUnit, FluentAssertions, integration testing, test containers

---

## Architecture

```
skills/dotnet-framework/
├── README.md                    # This file - overview and usage
├── SKILL.md                     # Quick reference guide (~15KB)
├── REFERENCE.md                 # Comprehensive guide (~40KB)
├── PATTERNS-EXTRACTED.md        # Pattern extraction from dotnet-backend-expert.yaml
├── VALIDATION.md                # Feature parity validation (≥95% target)
├── templates/
│   ├── controller.template.cs   # ASP.NET Core controller template
│   ├── minimal-api.template.cs  # Minimal API template
│   ├── entity.template.cs       # MartenDB document/entity template
│   ├── handler.template.cs      # Wolverine command/query handler
│   ├── event.template.cs        # Event sourcing event template
│   ├── projection.template.cs   # MartenDB projection template
│   └── test.template.cs         # xUnit test template
└── examples/
    ├── web-api.example.cs           # Complete ASP.NET Core Web API
    ├── event-sourcing.example.cs    # Event sourcing with MartenDB
    └── README.md                    # Examples documentation
```

---

## When to Use

The `backend-developer` agent **automatically loads this skill** when it detects .NET patterns:

### Detection Signals

**Primary Signals** (confidence: 0.4 each):
- `.csproj` file with .NET SDK
- `.cs` files with ASP.NET Core imports (`Microsoft.AspNetCore`, `WebApplication`)
- `Program.cs` with ASP.NET Core builder
- `.sln` solution file

**Secondary Signals** (confidence: 0.2 each):
- `appsettings.json` configuration file
- `Controllers/` directory with .NET controllers
- NuGet package references (Wolverine, Marten, etc.)
- `Startup.cs` or `Program.cs` with dependency injection

**Minimum Confidence**: 0.8 (framework detected when signals sum to ≥0.8)

---

## Usage Patterns

### Typical Workflow

1. **Framework Detection**: Agent detects .NET via `.csproj` + `.cs` files
2. **Skill Loading**: SKILL.md loaded for quick reference
3. **Implementation**: Agent uses patterns, templates, examples
4. **Deep Dive**: REFERENCE.md consulted for complex scenarios
5. **Validation**: Feature parity confirmed via VALIDATION.md

### Example Task

**User Request**: "Create a REST API for order management with event sourcing"

**Agent Flow**:
1. Detects .NET context (`.csproj`, ASP.NET Core imports)
2. Loads .NET skill (SKILL.md)
3. References ASP.NET Core Web API patterns
4. Uses `controller.template.cs` and `event.template.cs`
5. Consults `event-sourcing.example.cs` for reference
6. Implements with .NET conventions and Wolverine/MartenDB integration

---

## Skill Components

### SKILL.md (Quick Reference)

- **Size**: ~15KB (target: <100KB)
- **Purpose**: Fast lookup of common patterns
- **Contents**:
  - ASP.NET Core Web APIs & Controllers
  - Minimal APIs with route groups
  - Wolverine message handlers
  - MartenDB document storage & queries
  - Event sourcing patterns
  - Dependency injection & configuration
  - Testing with xUnit

### REFERENCE.md (Comprehensive Guide)

- **Size**: ~40KB (target: <500KB, max 1MB)
- **Purpose**: Deep-dive reference for complex scenarios
- **Contents**:
  - Complete .NET architecture guide
  - Advanced ASP.NET Core patterns (middleware, filters, model binding)
  - Wolverine message routing and sagas
  - MartenDB advanced queries, projections, and event store
  - CQRS and event sourcing architecture
  - Enterprise patterns (repository, unit of work, specifications)
  - Authentication and authorization (JWT, Identity, policies)
  - Production deployment and performance

### Templates (Code Generation)

7 production-ready templates with placeholder system:

- `{{ClassName}}` - Class name (e.g., `Order`)
- `{{Namespace}}` - Namespace (e.g., `MyApp.Orders`)
- `{{PropertyName}}` - Property name (e.g., `OrderId`)
- `{{propertyName}}` - Camel case (e.g., `orderId`)
- `{{EntityName}}` - Entity name (e.g., `OrderEntity`)

**Reduction**: 60-70% boilerplate reduction via template generation

### Examples (Real-World Code)

2 comprehensive examples demonstrating:
- Complete ASP.NET Core Web API with controllers and minimal APIs
- Event sourcing implementation with MartenDB and Wolverine

---

## Feature Parity

**Target**: ≥95% feature parity with `dotnet-backend-expert.yaml` agent

**Coverage Areas**:
1. **ASP.NET Core Web APIs** - Controllers, minimal APIs, middleware
2. **Wolverine Message Handling** - Commands, queries, events, handlers
3. **MartenDB Integration** - Document storage, event sourcing, projections
4. **CQRS Patterns** - Command/query separation, event streams
5. **Enterprise Patterns** - Repository, unit of work, DDD
6. **Testing** - xUnit, FluentAssertions, integration tests

**Validation**: See `VALIDATION.md` for detailed feature parity analysis

---

## Integration with Backend Developer

### Agent Loading Pattern

```yaml
# backend-developer.yaml (simplified)
mission: |
  Implement server-side logic across languages/stacks.

  Framework Detection:
  - Detect framework signals (.csproj, ASP.NET imports, Program.cs)
  - Load framework skill when confidence ≥0.8
  - Use skill patterns, templates, examples

  .NET Detection:
  - .csproj file with .NET SDK
  - .cs files with ASP.NET Core imports
  - Load skills/dotnet-framework/SKILL.md
```

### Skill Benefits

- **Generic Agent**: `backend-developer` stays framework-agnostic
- **Modular Expertise**: .NET knowledge separated and maintainable
- **Lazy Loading**: Skills loaded only when needed
- **Reduced Bloat**: 63% reduction in agent definition size

---

## Testing Standards

### Coverage Targets

- **Services/Handlers**: ≥80% (xUnit for business logic)
- **Controllers/APIs**: ≥70% (Integration tests for endpoints)
- **Domain Models**: ≥80% (Unit tests for domain logic)
- **Overall Coverage**: ≥75% (measured via coverlet)

### Testing Patterns

- **xUnit**: Primary testing framework for .NET
- **FluentAssertions**: Readable assertion syntax
- **Testcontainers**: Integration testing with real dependencies
- **WebApplicationFactory**: API integration testing

---

## Related Skills

- **Blazor Skill**: Frontend development with Blazor
- **PostgreSQL Skill**: Database optimization for MartenDB
- **Testing Skill**: Advanced testing patterns and strategies

---

## Maintenance

### Skill Updates

- **Pattern Extraction**: From production .NET code reviews
- **Template Refinement**: Based on usage analytics
- **Example Updates**: As .NET evolves (.NET 8, 9+)
- **Validation**: Continuous feature parity tracking

### Version Compatibility

- **.NET**: 8.0+ (with C# 12)
- **ASP.NET Core**: 8.0+
- **Wolverine**: Latest stable
- **MartenDB**: 7.0+ (PostgreSQL-based)

---

## References

- **Original Agent**: `agents/yaml/dotnet-backend-expert.yaml`
- **TRD**: `docs/TRD/skills-based-framework-agents-trd.md` (TRD-039 to TRD-042)
- **Architecture**: Skills-based framework architecture (Sprint 3)

---

**Status**: 🚧 **In Progress** - Sprint 3 (TRD-039)

**Progress**:
1. ✅ TRD-039: Create directory structure
2. ⏳ TRD-040: Extract patterns from dotnet-backend-expert.yaml
3. ⏳ TRD-041: Create templates (7 templates planned)
4. ⏳ TRD-042: Create examples and validation (2 examples planned)
