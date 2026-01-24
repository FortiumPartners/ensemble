---
name: generate-router-rules
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
| `product_documentation` | PRD, TRD, docs, requirements | product-manager, technical-architect |
| `orchestration` | Coordination and planning | spec-planner |
| `development` | Code implementation | frontend-implementer, backend-implementer, mobile-implementer |
| `quality_testing` | Review, testing, debugging | code-reviewer, verify-app, app-debugger, code-simplifier |
| `infrastructure_build` | Deploy, build, release | devops-engineer, cicd-specialist |

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
          "purpose": "Brief purpose from description"
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
    "long_no_match": {"template": "..."}
  },
  "routing_rules": {
    "short_threshold_words": 5
  }
}
```

### 4.2 Write Rules File

Write the complete rules to `router-rules.json` in the router lib directory.

## Expected Output

A `router-rules.json` file containing:

1. **metadata** - Version, generated timestamp
2. **agent_categories** - Domain categories with trigger keywords and agent lists
3. **skills** - All discovered skills with keyword mappings
4. **injection_templates** - Templates for different scenarios
5. **routing_rules** - Configuration like short_threshold_words

## Usage

```
/generate-router-rules
```

Run this command to regenerate the rules whenever agents or skills are
added, removed, or updated.
