---
name: ensemble:generate-router-rules
description: Generate router rules by introspecting installed agents and skills
allowed-tools: Read, Write, Grep, Glob
---

# Generate Router Rules

Introspect available agents and skills in this Claude Code session, then generate
a `router-rules.json` with categorized keyword mappings for the UserPromptSubmit
routing hook.

## Phase 1: Agent Discovery

### 1.1 Extract Available Agents

Examine your own Task tool documentation to extract all available `subagent_type`
values. Look in the Task tool description for the list of agent types.

**Actions:**
- Parse the subagent_type options from the Task tool description
- Extract agent name and description for each
- Note the tools each agent has access to

### 1.2 Categorize Agents by Domain

Group discovered agents into these functional domains:

| Domain | Description | Example Agents |
|--------|-------------|----------------|
| `product_documentation` | PRD, TRD, docs, requirements | product-management-orchestrator, documentation-specialist |
| `orchestration` | Coordination and planning | ensemble-orchestrator, tech-lead-orchestrator |
| `development` | Code implementation | frontend-developer, backend-developer, mobile-developer |
| `quality_testing` | Review, testing, debugging | code-reviewer, test-runner, deep-debugger |
| `infrastructure_build` | Deploy, build, release | deployment-orchestrator, build-orchestrator |
| `utility` | Support tasks | general-purpose, file-creator, git-workflow |
| `database` | Database operations | postgresql-specialist |

## Phase 2: Skill Discovery

### 2.1 Extract Available Skills

Examine the Skill tool documentation's `<available_skills>` section to extract
all available skills.

**Actions:**
- Parse skill names from the Skill tool's available_skills list
- Extract description and location for each skill
- Note any argument hints or usage patterns

### 2.2 Generate Skill Keywords

For each skill, create keyword mappings:

| Keyword Type | Example for `vercel` skill |
|--------------|---------------------------|
| Primary | vercel, nextjs, next.js |
| Technology | edge function, serverless, preview |
| Action | deploy, preview, domains |
| Diagnostic | vercel issue, vercel problem, not working |
| Pattern | `deploy.*react`, `next.*app`, `vercel.*issue` |

## Phase 3: Keyword Generation

### 3.1 Generate Agent Keywords

For each agent category, extract trigger keywords:

**Method:**
- Action verbs from descriptions (implement, review, deploy, test)
- Technology terms (React, Rails, Docker, PostgreSQL)
- Common synonyms (build/create, fix/debug, check/review)
- Command prefixes (create, build, deploy, run, fix)
- Infrastructure terms (environment, services, hosting, healthy)

### 3.2 Comprehensive Trigger Coverage

Ensure triggers cover:

```json
{
  "infrastructure_build": [
    "environment", "environments", "dev environment", "staging", "production",
    "services", "service", "connectivity", "communication", "healthy", "health check",
    "infrastructure", "hosted", "hosting", "CI/CD", "pipeline", "deploy", "release"
  ],
  "development": [
    "implement", "code", "build", "frontend", "backend", "BFF", "backend for frontend",
    "microservice", "microservices", "API", "endpoint"
  ]
}
```

## Phase 4: Rules Generation

### 4.1 Assemble Rules Structure

Create the rules with this structure:

```json
{
  "version": "1.0.0",
  "generated": "ISO-8601 timestamp",
  "agent_categories": {
    "product_documentation": {
      "triggers": ["PRD", "TRD", "requirements", "product", "documentation"],
      "agents": [
        {
          "name": "agent-name",
          "purpose": "Brief purpose from description",
          "tools": ["Tool1", "Tool2"]
        }
      ]
    }
  },
  "skills": {
    "skill-name": {
      "triggers": ["keyword1", "keyword2"],
      "patterns": ["regex.*pattern"],
      "purpose": "Brief purpose"
    }
  },
  "injection_templates": {
    "short_no_match": {"template": "..."},
    "agents_only": {"template": "..."},
    "agents_and_skills": {"template": "..."},
    "skills_only": {"template": "..."},
    "long_no_match": {"template": "..."},
    "project_agents_only": {"template": "..."},
    "project_skills_only": {"template": "..."},
    "project_agents_and_skills": {"template": "..."}
  },
  "routing_rules": {
    "short_threshold_words": 5
  }
}
```

### 4.2 Write Rules File

Write the complete rules to `router-rules.json` (or the path specified by ROUTER_RULES_PATH).

**Validation:**
- Validate output against the schema at `../lib/router-rules.schema.json`
- Ensure valid JSON structure
- Verify all agent names match discovered agents
- Verify all category objects have required `triggers` and `agents` arrays
- Verify all skill objects have required `triggers` and `purpose` fields
- Confirm skill names match available skills

**Schema Requirements** (from `router-rules.schema.json`):
- Required top-level keys: `agent_categories`, `skills`, `injection_templates`
- Each category must have `triggers` (array) and `agents` (array)
- Each agent must have `name` (string) and `purpose` (string)
- Each skill must have `triggers` (array) and `purpose` (string)

## Expected Output

A `router-rules.json` file containing:

1. **metadata** - Version, generated timestamp
2. **agent_categories** - Domain categories with trigger keywords and agent lists
3. **skills** - All discovered skills with keyword mappings and diagnostic patterns
4. **injection_templates** - 8 templates for different scenarios (including project-specific)
5. **routing_rules** - Configuration like short_threshold_words

## Usage

```
/generate-router-rules
```

Run this command to regenerate the rules whenever agents or skills are
added, removed, or updated.
