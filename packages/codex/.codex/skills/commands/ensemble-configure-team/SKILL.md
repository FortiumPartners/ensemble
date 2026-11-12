---
name: ensemble-configure-team
description: "Analyze TRD complexity and auto-configure team roles, agent assignments, and marketplace plugins"
disable-model-invocation: true
metadata:
  version: "1.1.5"
  category: planning
---

Analyze a Technical Requirements Document (TRD) for complexity and automatically configure
team mode. Performs agent and skill discovery, marketplace gap analysis, and injects a
## Team Configuration section into the TRD when warranted by project complexity.
Reads the TRD Master Task List to determine team tier (Simple, Medium, Complex) and
selects appropriate agents for each detected technical domain.

## Constraints

- DO NOT modify TRD content other than injecting the Team Configuration section
- DO NOT implement, build, or execute any technical work
- This command configures team roles and agent assignments only

## Workflow

Work through the phases in numbered order. Each phase's full instructions are in its own file under `references/`, in this skill's directory: open the file with your file-reading tool (not a shell command) when you reach that phase and follow it exactly. Resolve the paths below relative to this SKILL.md. The phase files refer to the `team_configuration` block (`domain_keywords`, `default_agents`, `complexity_tiers`, `marketplace_mappings`); it is the data file `references/team-configuration.yaml` (see Team Configuration Data below).

| Phase | Instructions | Steps |
|---|---|---|
| 1. TRD Ingestion | `references/phase-1-trd-ingestion.md` | Read TRD Document; Extract Task List |
| 2. Complexity Analysis | `references/phase-2-complexity-analysis.md` | CLI Flag Parsing; Task Counter and Hour Estimator; Domain Detection; Team Mode Heuristic |
| 3. Agent and Skill Discovery | `references/phase-3-agent-and-skill-discovery.md` | Agent Auto-Discovery; Skill Auto-Discovery; Builder Agent Matching; Agent Existence Validation |
| 4. Marketplace Gap Analysis | `references/phase-4-marketplace-gap-analysis.md` | Read Marketplace Catalog; Installed Plugin Detection; Gap Analysis; Suggestion Presentation and Installation |
| 5. Team Configuration Injection | `references/phase-5-team-configuration-injection.md` | Generate Team Configuration Section; Inject into TRD Document; Summary and Next Steps |

## Expected Output

**Format:** Technical Requirements Document (TRD) with Team Configuration

**Structure:**

- **Team Configuration Section**: Injected section with complexity metrics, agent assignments by role, and YAML config block
- **Complexity Metrics**: Task count, estimated hours, domain count, domains list, cross-cutting count, dependency depth, tier
- **Agent Assignments**: Lead, builder, reviewer, and QA agent mappings with owned responsibilities
- **Marketplace Notes**: List of plugins installed during gap analysis with agents and skills provided

## Team Configuration Data

The `team_configuration` block is structured data, kept in `references/team-configuration.yaml` (one source, also read by `packages/development/lib/team-defaults.js`). Open it with your file-reading tool when a step names `domain_keywords`, `default_agents`, `complexity_tiers` or `marketplace_mappings`. Its top-level keys are:

- `domain_keywords`: per-domain keyword lists used for domain detection
- `default_agents`: domain and role to default agent name
- `complexity_tiers`: Simple, Medium and Complex conditions
- `marketplace_mappings`: `domain_to_plugins` and `framework_keyword_to_plugin`

## Expected Input

```yaml
format: Technical Requirements Document (TRD)
sections:
  - name: Master Task List
    required: true
    description: Task list with TRD-NNN IDs, hour estimates, and traceability annotations
```
